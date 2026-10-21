'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');
const { createBackend } = require('../backend.cjs');
const { blockNetwork } = require('./offline-test-support.cjs');

const desktopRoot = path.resolve(__dirname, '..');
const projectRoot = path.resolve(desktopRoot, '..');
const businessPath = process.env.XJY_ACCEPTANCE_BUSINESS_PATH || path.join(desktopRoot, 'generated', 'business.cjs');
const migrationDir = process.env.XJY_ACCEPTANCE_MIGRATION_PATH || path.join(projectRoot, 'drizzle');

function pngFixture() {
  const crc = bytes => { let value = 0xffffffff; for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1; } return (value ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const tag = Buffer.from(type), size = Buffer.alloc(4), checksum = Buffer.alloc(4); size.writeUInt32BE(data.length); checksum.writeUInt32BE(crc(Buffer.concat([tag, data]))); return Buffer.concat([size, tag, data, checksum]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(Buffer.from([0, 255, 255, 255, 255]))), chunk('IEND', Buffer.alloc(0))]);
}

function dataFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => { const filename = path.join(directory, entry.name); return entry.isDirectory() ? dataFiles(filename) : entry.isFile() ? [filename] : []; });
}

test('Windows本机离线实际业务验收：真实SQLite、图片文件、密码账号与重启持久化', { timeout: 60000 }, async t => {
  assert.ok(fs.existsSync(businessPath), '请先运行桌面构建，生成 desktop/generated/business.cjs');
  const acceptanceRoot = path.resolve(__dirname, '.acceptance-data');
  fs.mkdirSync(acceptanceRoot, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(acceptanceRoot, 'run-'));
  const guard = blockNetwork();
  const adminPassword = 'Acceptance.Admin-984!';
  const workerPassword = 'Acceptance.Worker-731!';
  const changedPassword = 'Acceptance.Changed-526!';
  const bytes = pngFixture(), image = 'data:image/png;base64,' + bytes.toString('base64');
  let backend = null, completed = false;
  const state = {};
  const response = (route, method = 'GET', body) => backend.dispatch({ path: route, method, body });
  const api = async (route, method = 'GET', body) => {
    const result = await response(route, method, body);
    assert.equal(result.ok, true, `${method} ${route}：${result.data?.error || result.status}`);
    for (const password of [adminPassword, workerPassword, changedPassword]) assert.ok(!JSON.stringify(result.data).includes(password), '接口不能返回明文密码');
    return result.data;
  };
  const denied = async (route, method, body, status) => { const result = await response(route, method, body); assert.equal(result.ok, false); assert.equal(result.status, status, `${method} ${route}：${result.data?.error}`); return result; };
  const login = async (username, password) => { const value = await api('/auth/login', 'POST', { username, password }); assert.equal(value.authenticated, true); assert.equal(value.user.username, username); return value.user; };
  const step = async (label, action) => { let failure; await t.test(label, async () => { try { await action(); } catch (error) { failure = error; throw error; } }); if (failure) throw failure; };
  const sale = (customerId, patch = {}) => ({ type: 'sale', customerId, title: '离线多件报价', material: '旧根字段', weight: 999, goldPrice: 999, laborPrice: 999, extras: [{ id: 'legacy', name: '旧根附加费', amount: 999 }], image, discountType: 'amount', discountValue: 200, saleItems: [
    { id: 'ring', title: '铂金戒指', material: 'Pt950', specs: '圈号12', image, weight: 3, goldPrice: 450, laborPrice: 80, extras: [{ id: 'gem', name: '培育钻石', amount: 100 }], quantity: 2 },
    { id: 'pendant', title: '黄金吊坠', material: '黄金', specs: '圆形', image, weight: 2, goldPrice: 600, laborPrice: 50, extras: [], quantity: 1 },
  ], ...patch });
  try {
    backend = createBackend({ dataDir, migrationDir, businessPath });
    await step('首次本机启动没有默认管理员/口令；设置自己选择的账号，不需邮箱或外网', async () => {
      assert.deepEqual(await api('/auth/status'), { needsSetup: true, authenticated: false });
      await denied('/api/bootstrap', 'GET', undefined, 401);
      await denied('/auth/setup', 'POST', { username: '本机管理员', password: 'short' }, 400);
      assert.equal((await api('/auth/status')).needsSetup, true);
      const result = await api('/auth/setup', 'POST', { username: '本机管理员', password: adminPassword, name: '管理员' });
      assert.equal(result.user.username, '本机管理员'); assert.equal(result.user.role, 'admin'); assert.equal(result.needsSetup, false);
      state.admin = result.user;
      await denied('/auth/setup', 'POST', { username: 'another-admin', password: adminPassword }, 409);
    });
    await step('失败切换账号清理原管理员会话；未知账号和错误口令均不能进入业务', async () => {
      await denied('/auth/login', 'POST', { username: 'unknown-user', password: workerPassword }, 401);
      assert.equal((await api('/auth/status')).authenticated, false);
      await denied('/api/bootstrap', 'GET', undefined, 401);
      await login('本机管理员', adminPassword);
    });
    await step('管理员建立A/B本机员工，同一密码使用不同盐和哈希，接口不泄露凭据', async () => {
      state.a = (await api('/api/users', 'POST', { username: 'worker_a', password: workerPassword, name: '员工A' })).user;
      state.b = (await api('/api/users', 'POST', { username: 'worker_b', password: workerPassword, name: '员工B' })).user;
      const users = (await api('/api/users')).users;
      assert.equal(users.length, 3); assert.equal(users.find(user => user.id === state.a.id).role, 'employee');
      assert.doesNotMatch(JSON.stringify(users), /password_hash|password_salt/);
      const records = backend.runtime.sqlite.prepare('SELECT username,password_salt,password_hash FROM local_accounts WHERE staff_id IN (?,?)').all(state.a.id, state.b.id);
      assert.equal(records.length, 2); assert.notEqual(records[0].password_salt, records[1].password_salt); assert.notEqual(records[0].password_hash, records[1].password_hash);
    });
    await step('A保存多商品、私有照片及原图，服务端重算合计并忽略客户端假owner/total', async () => {
      await login('worker_a', workerPassword);
      state.customerA = (await api('/api/customers', 'POST', { name: '客户A', phone: '13800000000' })).customer;
      state.first = (await api('/api/quotes', 'POST', sale(state.customerA.id, { ownerId: state.b.id, total: 1 }))).quote;
      assert.equal(state.first.total, 4480); assert.equal(state.first.ownerId, state.a.id); assert.equal(state.first.snapshot.saleItems.length, 2);
      assert.deepEqual(state.first.totals.itemTotals.map(row => row.subtotal), [3380, 1300]);
      state.snapshot = structuredClone(state.first.snapshot);
      const attached = (await api(`/api/quotes/${state.first.id}/images`, 'POST', { images: [image] })).quote;
      state.imageUrl = attached.images[0]; state.imageId = state.imageUrl.split('/').pop();
      assert.equal(attached.number, state.first.number);
      const stored = await backend.imageResponse(state.imageId); assert.equal(stored.status, 200); assert.equal(stored.headers.get('Content-Type'), 'image/png'); assert.deepEqual(Buffer.from(await stored.arrayBuffer()), bytes);
      await denied(`/api/quotes/${state.first.id}/images`, 'POST', { images: [image] }, 409);
    });
    await step('B只能看自己客户/报价，不能读取A的记录、关联客户、版本或私有原图', async () => {
      await login('worker_b', workerPassword);
      state.customerB = (await api('/api/customers', 'POST', { name: '客户B' })).customer;
      state.quoteB = (await api('/api/quotes', 'POST', sale(state.customerB.id))).quote;
      const data = await api('/api/bootstrap');
      assert.deepEqual(data.customers.map(row => row.id), [state.customerB.id]); assert.deepEqual(data.quotes.map(row => row.id), [state.quoteB.id]); assert.equal(data.users.length, 0);
      await denied(`/api/quotes/${state.first.id}`, 'GET', undefined, 404);
      await denied('/api/customers', 'PATCH', { id: state.customerA.id, name: '越权改名' }, 404);
      await denied('/api/quotes', 'POST', sale(state.customerA.id), 404);
      await denied('/api/quotes', 'POST', sale(state.customerB.id, { baseQuoteId: state.first.id }), 404);
      assert.equal((await backend.imageResponse(state.imageId)).status, 404);
    });
    await step('员工不能调整公司默认值或创建、修改账号；个人收款设置彼此隔离', async () => {
      await denied('/api/settings', 'PATCH', { sale: { goldPrice: 1 } }, 403);
      await denied('/api/users', 'POST', { username: 'illegal_admin', password: workerPassword, role: 'admin' }, 403);
      await denied('/api/users', 'PATCH', { id: state.b.id, role: 'admin' }, 403);
      await denied('/api/users', 'GET', undefined, 403);
      await login('worker_a', workerPassword);
      const methods = [{ id: 'a-cash', name: '现金A', details: '员工A收款', image: '' }];
      await api('/api/preferences', 'PATCH', { paymentMethods: methods });
      assert.deepEqual((await api('/api/preferences')).paymentMethods, methods);
      await login('worker_b', workerPassword);
      assert.ok(!(await api('/api/preferences')).paymentMethods.some(value => value.id === 'a-cash'));
    });
    await step('管理员改默认金价、品牌及客户姓名，不改已经保存的多件快照和原图', async () => {
      await login('本机管理员', adminPassword);
      const data = await api('/api/bootstrap'); assert.equal(data.customers.length, 2); assert.equal(data.quotes.length, 2);
      await api('/api/settings', 'PATCH', { brand: { name: '本机新品牌' }, sale: { goldPrice: 900, laborPrice: 120 } });
      await api('/api/customers', 'PATCH', { id: state.customerA.id, name: '客户A新名' });
      const first = (await api(`/api/quotes/${state.first.id}`)).quote;
      assert.deepEqual(first.snapshot, state.snapshot); assert.equal(first.total, 4480); assert.deepEqual(first.images, [state.imageUrl]);
    });
    await step('A修改建立同root的V2，V1不可覆盖；日志包含原新值、操作者和时间', async () => {
      await login('worker_a', workerPassword);
      const updated = sale(state.customerA.id, { baseQuoteId: state.first.id }); updated.saleItems[1].weight = 3;
      state.second = (await api('/api/quotes', 'POST', updated)).quote;
      assert.equal(state.second.version, 2); assert.equal(state.second.rootId, state.first.rootId); assert.equal(state.second.total, 5130);
      assert.deepEqual((await api(`/api/quotes/${state.first.id}`)).quote.snapshot, state.snapshot);
      const logs = (await api(`/api/quotes/${state.second.id}`)).logs;
      const version = logs.find(value => value.action === 'new-version'); assert.ok(version); assert.equal(version.actorId, state.a.id); assert.ok(version.createdAt); assert.equal(version.oldValue.version, 1); assert.equal(version.newValue.version, 2);
      assert.ok(logs.some(value => value.action === 'default-price-override' && value.oldValue != null && value.newValue != null));
    });
    await step('本机图库文件和首页设置保存；停用共享图仍保留自己的历史照片引用', async () => {
      const asset = (await api('/api/media', 'POST', { name: '离线商品照片', category: '报价', image })).asset;
      state.media = asset;
      const body = sale(state.customerA.id); body.saleItems[0].image = asset.url;
      state.galleryQuote = (await api('/api/quotes', 'POST', body)).quote;
      await login('worker_b', workerPassword);
      assert.equal((await backend.imageResponse(asset.url.split('/').pop())).status, 200);
      await denied('/api/media', 'PATCH', { id: asset.id, active: false }, 404);
      await login('本机管理员', adminPassword);
      await api('/api/settings', 'PATCH', { home: { image: asset.url, headline: '本机首页' } });
      await api('/api/media', 'PATCH', { id: asset.id, active: false });
      await login('worker_a', workerPassword);
      assert.equal((await backend.imageResponse(asset.url.split('/').pop())).status, 200);
    });
    await step('管理员重置A密码、停用B；旧密码/停用账号均不能登录，历史不会被删', async () => {
      await login('本机管理员', adminPassword);
      await api('/api/users', 'PATCH', { id: state.a.id, password: changedPassword });
      await api('/api/users', 'PATCH', { id: state.b.id, active: false });
      await denied('/api/users', 'PATCH', { id: state.admin.id, active: false }, 400);
      await denied('/auth/login', 'POST', { username: 'worker_a', password: workerPassword }, 401);
      await denied('/auth/login', 'POST', { username: 'worker_b', password: workerPassword }, 401);
      await login('worker_a', changedPassword);
    });
    await step('真实关闭并重开同一数据目录：账号、设置、客户、V1/V2、原图和个人收款全部保留', async () => {
      await backend.close(); backend = null;
      assert.ok(fs.statSync(path.join(dataDir, 'jewelry.sqlite')).size > 0);
      for (const file of dataFiles(dataDir)) for (const password of [adminPassword, workerPassword, changedPassword]) assert.ok(!fs.readFileSync(file).includes(Buffer.from(password)), '数据库、日志与图片元数据不得保存明文密码');
      const cold = spawnSync(process.execPath, [path.join(__dirname, 'offline-cold-restart.cjs')], { windowsHide: true, encoding: 'utf8', timeout: 15000, maxBuffer: 2000000, input: JSON.stringify({ dataDir, migrationDir, businessPath, username: 'worker_a', password: changedPassword, quoteId: state.first.id, otherEmployeeQuoteId: state.quoteB.id, snapshot: state.snapshot, imageId: state.imageId, imageHash: crypto.createHash('sha256').update(bytes).digest('hex') }) });
      assert.equal(cold.status, 0, cold.error?.message || cold.stderr);
      assert.deepEqual(JSON.parse(cold.stdout), { confirmed: true, freshProcess: true, networkAttempts: 0 });
      backend = createBackend({ dataDir, migrationDir, businessPath });
      assert.deepEqual(await api('/auth/status'), { needsSetup: false, authenticated: false });
      await denied('/api/bootstrap', 'GET', undefined, 401);
      await login('worker_a', changedPassword);
      const data = await api('/api/bootstrap'); assert.equal(data.settings.brand.name, '本机新品牌'); assert.equal(data.settings.sale.goldPrice, 900); assert.equal(data.settings.home.headline, '本机首页'); assert.equal(data.customers[0].name, '客户A新名');
      assert.ok(data.quotes.some(row => row.id === state.first.id)); assert.ok(data.quotes.some(row => row.id === state.second.id)); assert.ok(!data.quotes.some(row => row.id === state.quoteB.id));
      const first = (await api(`/api/quotes/${state.first.id}`)).quote; assert.deepEqual(first.snapshot, state.snapshot); assert.deepEqual(first.images, [state.imageUrl]);
      assert.equal((await api(`/api/quotes/${state.second.id}`)).quote.version, 2);
      assert.ok((await api('/api/preferences')).paymentMethods.some(value => value.id === 'a-cash'));
      const response = await backend.imageResponse(state.imageId); assert.equal(response.status, 200); assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
      assert.equal((await backend.imageResponse(state.media.url.split('/').pop())).status, 200);
      await denied('/auth/login', 'POST', { username: 'worker_b', password: workerPassword }, 401);
      await login('本机管理员', adminPassword); assert.ok((await api('/api/bootstrap')).quotes.some(row => row.id === state.quoteB.id));
    });
    await step('所有地址和图片均受本机边界控制，拒绝外网URL与文件路径越界', async () => {
      await denied('https://example.invalid/api/bootstrap', 'GET', undefined, 400);
      await denied('//example.invalid/api/bootstrap', 'GET', undefined, 400);
      await denied('/api/quotes', 'POST', sale(state.customerA.id, { image: 'https://example.invalid/photo.jpg' }), 400);
      for (const id of ['../jewelry.sqlite', '..%2fjewelry.sqlite', 'C:\\Windows\\win.ini', '/etc/passwd']) assert.equal((await backend.imageResponse(id)).status, 404);
      assert.throws(() => backend.runtime.env.BUCKET.filename('images/../../jewelry.sqlite'));
      assert.deepEqual(guard.attempts, [], '从创建管理员到重启恢复所有流程都不应发出网络调用');
    });
    completed = true;
  } finally {
    if (backend) await backend.close();
    guard.restore();
    if (completed) {
      // Verify both lexical and real paths before a recursive cleanup on Windows.
      const target = fs.realpathSync(dataDir), base = fs.realpathSync(acceptanceRoot), relative = path.relative(base, target);
      assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), '验收清理目录必须留在专属测试目录');
      fs.rmSync(target, { recursive: true, force: true });
    } else t.diagnostic('失败验收数据保留于 ' + dataDir);
  }
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const esbuild = require('../../node_modules/esbuild');
const { createBackend } = require('../backend.cjs');
const { makeBackup, prepareRestore, commitRestore } = require('../backup.cjs');
const { createPrintSettings, validatePrintSettings, defaults: printDefaults } = require('../print-settings.cjs');
const { blockNetwork } = require('./offline-test-support.cjs');
const migrationDir = path.resolve(__dirname, '../../drizzle');
const testRoot = path.resolve(__dirname, '.extended-data');
fs.mkdirSync(testRoot, { recursive: true });

function png(red, green, blue) {
  const crc = bytes => { let result = 0xffffffff; for (const byte of bytes) { result ^= byte; for (let i = 0; i < 8; i++) result = result & 1 ? 0xedb88320 ^ result >>> 1 : result >>> 1; } return (result ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const tag = Buffer.from(type), size = Buffer.alloc(4), checksum = Buffer.alloc(4); size.writeUInt32BE(data.length); checksum.writeUInt32BE(crc(Buffer.concat([tag, data]))); return Buffer.concat([size, tag, data, checksum]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(Buffer.from([0, red, green, blue, 255]))), chunk('IEND', Buffer.alloc(0))]);
}
const red = png(255, 0, 0), blue = png(0, 0, 255), green = png(0, 255, 0);
const dataUrl = bytes => 'data:image/png;base64,' + bytes.toString('base64');

test('扩展真实离线业务：多件换新、客户确认截图、版本权限及备份恢复', { timeout: 30000 }, async t => {
  const directory = fs.mkdtempSync(path.join(testRoot, 'business-')), dataDir = path.join(directory, 'data');
  const backupParent = path.join(directory, 'backups'); fs.mkdirSync(backupParent);
  const network = blockNetwork();
  let backend = createBackend({ dataDir, migrationDir }), a = backend.createSession(), b = backend.createSession();
  const password = 'Extended.Password-529!';
  const state = {};
  const good = async (session, address, method = 'GET', body) => { const response = await session.dispatch({ path: address, method, body }); assert.equal(response.ok, true, `${address}: ${response.data?.error || response.status}`); return response.data; };
  const denied = async (session, address, method, body, status) => { const response = await session.dispatch({ path: address, method, body }); assert.equal(response.ok, false); assert.equal(response.status, status); };
  const imageBytes = async (session, image) => { const response = await session.imageResponse(image.split('/').pop()); assert.equal(response.status, 200); return Buffer.from(await response.arrayBuffer()); };
  const step = async (label, action) => { let failure; await t.test(label, async () => { try { await action(); } catch (error) { failure = error; throw error; } }); if (failure) throw failure; };
  try {
    await good(backend, '/auth/setup', 'POST', { username: 'admin', password });
    state.a = (await good(backend, '/api/users', 'POST', { username: 'worker_a', password })).user;
    state.b = (await good(backend, '/api/users', 'POST', { username: 'worker_b', password })).user;
    await good(a, '/auth/login', 'POST', { username: 'worker_a', password }); await good(b, '/auth/login', 'POST', { username: 'worker_b', password });
    state.customerA = (await good(a, '/api/customers', 'POST', { name: '客户确认A' })).customer;
    state.customerB = (await good(b, '/api/customers', 'POST', { name: '客户确认B' })).customer;
    await step('多件换新真实上传原图并权威核价，回收与优惠一次，逐item记录调价', async () => {
      state.trade = (await good(a, '/api/quotes', 'POST', { type: 'tradein', customerId: state.customerA.id, title: '多件换新验收', weight: 999, goldPrice: 999, laborPrice: 999, extras: [{ id: 'legacy', name: '旧字段不计费', amount: 999 }], discountType: 'amount', discountValue: 50, note: '旧料重量7克，客户已确认照片', tradeIn: { mode: 'gram', oldMaterial: 'gold', oldWeight: 7, depreciationPrice: 20, excessMode: 'recycle', excessGoldPrice: 450, excessCoefficient: .99 }, tradeInItems: [
        { id: 'new-a', title: '足金戒指', material: 'Au999', weight: 2, goldPrice: 460, laborPrice: 85, quantity: 1, image: dataUrl(red), extras: [{ id: 'stone', name: '配件', amount: 100 }] },
        { id: 'new-b', title: '足金项链', material: '足金', weight: 3, goldPrice: 600, laborPrice: 100, quantity: 1, image: dataUrl(blue), extras: [] },
      ], total: 999, ownerId: state.b.id })).quote;
      assert.equal(state.trade.ownerId, state.a.id); assert.equal(state.trade.total, -271); assert.equal(state.trade.totals.subtotal, 670); assert.equal(state.trade.totals.discount, 50); assert.equal(state.trade.totals.exchangeCredit, 891);
      assert.equal(state.trade.snapshot.note, '旧料重量7克，客户已确认照片');
      const photos = state.trade.snapshot.tradeInItems.map(item => item.image); assert.ok(photos.every(image => image.startsWith('/api/images/'))); assert.notEqual(photos[0], photos[1]);
      assert.deepEqual(await imageBytes(a, photos[0]), red); assert.deepEqual(await imageBytes(a, photos[1]), blue);
      const saved = await good(a, '/api/quotes/' + state.trade.id), overrides = saved.logs.filter(log => log.action === 'default-price-override');
      for (const [field, before, after] of [['tradeInItems.new-a.goldPrice', 450, 460], ['tradeInItems.new-a.laborPrice', 80, 85], ['tradeInItems.new-b.goldPrice', 450, 600], ['tradeInItems.new-b.laborPrice', 80, 100]]) {
        const log = overrides.find(entry => entry.newValue.field === field); assert.ok(log, field); assert.equal(log.oldValue.value, before); assert.equal(log.newValue.value, after); assert.equal(log.actorId, state.a.id);
      }
      await denied(b, '/api/quotes/' + state.trade.id, 'GET', undefined, 404);
      assert.equal((await b.imageResponse(photos[0].split('/').pop())).status, 404);
    });
    await step('定制2张确认截图真实落桶，时间由服务器确定且员工隔离', async () => {
      const before = Date.now();
      state.custom = (await good(a, '/api/quotes', 'POST', { type: 'custom', customerId: state.customerA.id, title: '客户已确认定制', material: 'Pt950', weight: 2, goldPrice: 450, laborPrice: 80, customDetails: '按客户截图制作', customConfirmations: [
        { id: 'design', name: '款式确认', image: dataUrl(red), createdAt: '2099-01-01T00:00:00.000Z' },
        { id: 'size', name: '尺寸确认', image: dataUrl(blue), createdAt: '2000-01-01T00:00:00.000Z' },
      ] })).quote;
      state.originalCustom = structuredClone(state.custom.snapshot);
      for (const [index, expected] of [[0, red], [1, blue]]) {
        const confirmation = state.custom.snapshot.customConfirmations[index]; assert.ok(confirmation.image.startsWith('/api/images/')); assert.ok(Date.parse(confirmation.createdAt) >= before && Date.parse(confirmation.createdAt) <= Date.now());
        assert.deepEqual(await imageBytes(a, confirmation.image), expected); assert.deepEqual(await imageBytes(backend, confirmation.image), expected);
        assert.equal((await b.imageResponse(confirmation.image.split('/').pop())).status, 404);
      }
      assert.equal((await good(a, '/api/quotes/' + state.custom.id)).quote.snapshot.customConfirmations.length, 2);
      assert.equal((await good(backend, '/api/quotes/' + state.custom.id)).quote.snapshot.customConfirmations.length, 2);
      await denied(b, '/api/quotes/' + state.custom.id, 'GET', undefined, 404);
      await denied(b, '/api/quotes', 'POST', { type: 'custom', customerId: state.customerB.id, title: '越权截图引用', weight: 1, goldPrice: 450, customConfirmations: [{ id: 'stolen', name: '不允许', image: state.custom.snapshot.customConfirmations[0].image }] }, 404);
    });
    await step('新版本替换一张截图保持V1原字节及时间，未替换截图保留原服务器时间', async () => {
      await new Promise(resolve => setTimeout(resolve, 5));
      const original = state.custom.snapshot.customConfirmations;
      state.customV2 = (await good(a, '/api/quotes', 'POST', { ...state.custom.snapshot, baseQuoteId: state.custom.id, title: '定制二次确认', customConfirmations: [{ id: 'design', name: '新款式确认', image: dataUrl(green), createdAt: '2099-01-01T00:00:00.000Z' }, { ...original[1], createdAt: '2099-01-01T00:00:00.000Z' }] })).quote;
      assert.equal(state.customV2.version, 2); assert.equal(state.customV2.rootId, state.custom.rootId);
      assert.notEqual(state.customV2.snapshot.customConfirmations[0].image, original[0].image); assert.notEqual(state.customV2.snapshot.customConfirmations[0].createdAt, original[0].createdAt);
      assert.equal(state.customV2.snapshot.customConfirmations[1].createdAt, original[1].createdAt);
      assert.deepEqual((await good(a, '/api/quotes/' + state.custom.id)).quote.snapshot, state.originalCustom);
      assert.deepEqual(await imageBytes(a, original[0].image), red); assert.deepEqual(await imageBytes(a, state.customV2.snapshot.customConfirmations[0].image), green);
    });
    await step('管理员来源图片冻结进A历史后A可读，B不可读，覆盖新字段历史图片ACL', async () => {
      const customer = (await good(backend, '/api/customers', 'POST', { name: '管理员图片来源' })).customer;
      const source = (await good(backend, '/api/quotes', 'POST', { type: 'custom', customerId: customer.id, title: '管理员内部确认', weight: 1, goldPrice: 450, customConfirmations: [{ id: 'source-custom', name: '定制来源', image: dataUrl(red) }, { id: 'source-trade', name: '换新来源', image: dataUrl(green) }] })).quote;
      const customImage = source.snapshot.customConfirmations[0].image, tradeImage = source.snapshot.customConfirmations[1].image;
      assert.equal((await a.imageResponse(customImage.split('/').pop())).status, 404);
      assert.equal((await a.imageResponse(tradeImage.split('/').pop())).status, 404);
      const customUpdated = (await good(backend, '/api/quotes', 'POST', { ...state.customV2.snapshot, baseQuoteId: state.customV2.id, customConfirmations: [{ id: 'admin-confirmation', name: '管理员已转交确认', image: customImage }] })).quote;
      const tradeUpdated = (await good(backend, '/api/quotes', 'POST', { ...state.trade.snapshot, baseQuoteId: state.trade.id, tradeInItems: state.trade.snapshot.tradeInItems.map((item, index) => ({ ...item, image: index === 0 ? tradeImage : item.image })) })).quote;
      assert.equal(customUpdated.ownerId, state.a.id); assert.equal(tradeUpdated.ownerId, state.a.id);
      assert.notEqual((await backend.runtime.env.BUCKET.head('images/' + customImage.split('/').pop())).customMetadata.ownerId, state.a.id);
      assert.deepEqual(await imageBytes(a, customImage), red); assert.deepEqual(await imageBytes(a, tradeImage), green);
      assert.equal((await b.imageResponse(customImage.split('/').pop())).status, 404); assert.equal((await b.imageResponse(tradeImage.split('/').pop())).status, 404);
      state.adminSourceImages = [customImage, tradeImage];
    });
    await step('关闭并cold重开仍保存换新准确合计和确认截图快照', async () => {
      await a.close(); await b.close(); await backend.close();
      backend = createBackend({ dataDir, migrationDir }); a = backend.createSession(); b = backend.createSession();
      await good(a, '/auth/login', 'POST', { username: 'worker_a', password }); await good(b, '/auth/login', 'POST', { username: 'worker_b', password }); await good(backend, '/auth/login', 'POST', { username: 'admin', password });
      const trade = (await good(a, '/api/quotes/' + state.trade.id)).quote; assert.equal(trade.total, -271); assert.equal(trade.totals.exchangeCredit, 891); assert.equal(trade.totals.discount, 50);
      assert.deepEqual((await good(a, '/api/quotes/' + state.custom.id)).quote.snapshot, state.originalCustom);
      assert.deepEqual(await imageBytes(a, state.customV2.snapshot.customConfirmations[0].image), green);
    });
    await step('完整备份和真实目录恢复后，确认截图与版本原字节保留', async () => {
      const saved = await backend.exclusive(() => makeBackup(backend.runtime, backupParent));
      await good(backend, '/api/customers', 'POST', { name: '备份后临时记录' });
      const stage = prepareRestore(saved, dataDir);
      await a.close(); await b.close(); await backend.close();
      commitRestore(stage, dataDir);
      backend = createBackend({ dataDir, migrationDir }); a = backend.createSession(); b = backend.createSession();
      await good(a, '/auth/login', 'POST', { username: 'worker_a', password }); await good(b, '/auth/login', 'POST', { username: 'worker_b', password }); await good(backend, '/auth/login', 'POST', { username: 'admin', password });
      assert.equal((await good(backend, '/api/bootstrap')).customers.some(customer => customer.name === '备份后临时记录'), false);
      assert.deepEqual((await good(a, '/api/quotes/' + state.custom.id)).quote.snapshot, state.originalCustom);
      assert.deepEqual(await imageBytes(a, state.custom.snapshot.customConfirmations[0].image), red); assert.deepEqual(await imageBytes(a, state.customV2.snapshot.customConfirmations[0].image), green);
      assert.deepEqual(await imageBytes(a, state.adminSourceImages[0]), red); assert.deepEqual(await imageBytes(a, state.adminSourceImages[1]), green);
      assert.equal((await b.imageResponse(state.customV2.snapshot.customConfirmations[0].image.split('/').pop())).status, 404);
      assert.equal((await good(a, '/api/quotes/' + state.trade.id)).quote.total, -271);
    });
    assert.deepEqual(network.attempts, [], '所有业务、图片、备份过程不得调用网络');
  } finally { await a?.close(); await b?.close(); await backend?.close(); network.restore(); }
});

test('打印设置持久化与白名单，不接受路径字段或越界参数', () => {
  const directory = fs.mkdtempSync(path.join(testRoot, 'print-')), file = path.join(directory, 'profile', 'print.json');
  const settings = createPrintSettings(file);
  assert.deepEqual(settings.read(), { ...printDefaults });
  const valid = settings.write({ deviceName: '测试打印机', mode: 'fields', widthMm: 210, heightMm: 297, offsetXmm: -2.5, offsetYmm: 1.25, scalePercent: 98, copies: 2, phone: '13800000000', standard: '测试标准', afterSalesWechat: 'test_wechat', outputPath: 'C:/Windows/ignored', file: 'outside-file' });
  assert.equal('outputPath' in valid, false); assert.equal('file' in valid, false); assert.deepEqual(createPrintSettings(file).read(), valid);
  const saved = fs.readFileSync(file, 'utf8'); assert.ok(!saved.includes('C:/Windows')); assert.deepEqual(Object.keys(valid).sort(), Object.keys(printDefaults).sort());
  for (const invalid of [{ widthMm: 59 }, { widthMm: Infinity }, { heightMm: 501 }, { offsetXmm: 31 }, { offsetYmm: -31 }, { scalePercent: 59 }, { copies: 0 }, { copies: 1.5 }, { mode: 'other' }, { deviceName: 'printer\npath' }, { phone: null }, { standard: 'a'.repeat(101) }]) {
    assert.throws(() => settings.write(invalid)); assert.equal(fs.readFileSync(file, 'utf8'), saved);
  }
  assert.throws(() => validatePrintSettings([]));
});

test('质保单逐商品优惠按币分分摊，所有件证书金额总和等于报价实付', async () => {
  const directory = fs.mkdtempSync(path.join(testRoot, 'warranty-')), outfile = path.join(directory, 'warranty-data.cjs');
  esbuild.buildSync({ entryPoints: [path.resolve(__dirname, '../renderer/warranty-data.ts')], outfile, bundle: true, platform: 'node', format: 'cjs', target: 'node22', logLevel: 'silent' });
  const { createWarrantySheets, allocatePayableCents, validateWarrantyData } = require(outfile);
  const defaults = { phone: '13800000000', standard: '测试标准', afterSalesWechat: 'fixture_wechat' };
  const sale = { type: 'sale', customerId: 'warranty', title: '测试销售', weight: 0, goldPrice: 0, laborPrice: 0, saleItems: [
    { id: 'a', title: '戒指', material: '黄金', weight: 3, goldPrice: 450, laborPrice: 80, quantity: 2, extras: [{ id: 'gem', name: '钻石', amount: 100 }] },
    { id: 'b', title: '项链', material: 'Pt950', weight: 2, goldPrice: 600, laborPrice: 100, quantity: 1, extras: [] },
  ], discountType: 'amount', discountValue: 199.99 };
  const backend = createBackend({ dataDir: path.join(directory, 'data'), migrationDir }), network = blockNetwork();
  let saved;
  try {
    assert.equal((await backend.dispatch({ path: '/auth/setup', method: 'POST', body: { username: 'warranty-admin', password: 'Warranty.Password-715!' } })).ok, true);
    const customer = (await backend.dispatch({ path: '/api/customers', method: 'POST', body: { name: '质保验收客户' } })).data.customer;
    const response = await backend.dispatch({ path: '/api/quotes', method: 'POST', body: { ...sale, customerId: customer.id } }); assert.equal(response.ok, true, response.data?.error); saved = response.data.quote;
    assert.deepEqual(network.attempts, []);
  } finally { await backend.close(); network.restore(); }
  const sheets = createWarrantySheets(saved.snapshot, defaults, { date: '2026-10-10' });
  assert.equal(sheets.length, 2); assert.equal(sheets[0].data.quantity, '2'); assert.equal(sheets[0].data.productName, '戒指');
  const sum = sheets.reduce((total, sheet) => total + Math.round(Number(sheet.data.amount.replace(/,/g, '')) * 100), 0);
  assert.equal(sum, Math.round(saved.total * 100)); assert.equal(sum, 458001); assert.equal(sheets[0].data.amount, sheets[0].data.total);
  assert.deepEqual(allocatePayableCents([.01, .01, .01], .02), [1n, 1n, 0n]);
  assert.deepEqual(allocatePayableCents([0, 0], 0), [0n, 0n]);
  for (const [rows, paid] of [[[1, 2], -1], [[1, 2], 4], [[-1, 2], 1]]) assert.throws(() => allocatePayableCents(rows, paid));
  const custom = createWarrantySheets({ type: 'custom', customerId: 'warranty', title: '定制戒指', weight: 2, goldPrice: 450, laborPrice: 80, discountType: 'percent', discountValue: 90 }, defaults, { date: '2026-10-10' });
  assert.equal(custom[0].data.amount, '954.00');
  const complete = { ...sheets[0].data, goodsNumber: 'FIXTURE-001' }; assert.doesNotThrow(() => validateWarrantyData(complete));
  for (const patch of [{ goodsNumber: '' }, { amount: '-1' }, { total: '1.123' }, { quantity: '0' }, { quantity: '1.5' }, { date: 'bad-date' }, { date: '2026-13-99' }, { date: '2026-02-29' }, { date: '1899-12-31' }, { productName: 'a'.repeat(101) }]) assert.throws(() => validateWarrantyData({ ...complete, ...patch }));
  assert.doesNotThrow(() => validateWarrantyData({ ...complete, date: '2028-02-29' }));
});

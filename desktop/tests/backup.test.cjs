'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createBackend } = require('../backend.cjs');
const { makeBackup, validateBackup, prepareRestore, commitRestore, inside } = require('../backup.cjs');
const { blockNetwork } = require('./offline-test-support.cjs');

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const desktopRoot = path.resolve(__dirname, '..');
const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB9cAAAAASUVORK5CYII=', 'base64');
const image = 'data:image/png;base64,' + imageBytes.toString('base64');

test('真实SQLite与图片的本机备份恢复：完整快照、拒绝篡改/链接/越界、失败不动原数据', { timeout: 60000 }, async t => {
  const testingRoot = path.resolve(__dirname, '.backup-acceptance'); fs.mkdirSync(testingRoot, { recursive: true });
  const work = fs.mkdtempSync(path.join(testingRoot, 'run-'));
  const live = path.join(work, '业务数据'), destination = path.join(work, "备份 O'Neil"); fs.mkdirSync(destination);
  const options = { dataDir: live, migrationDir: path.join(desktopRoot, 'migrations'), businessPath: path.join(desktopRoot, 'generated', 'business.cjs') };
  const network = blockNetwork(); const junctions = [];
  let backend, backupPath, first, original, completed = false, liveHash;
  const api = async (route, method = 'GET', body) => { const result = await backend.dispatch({ path: route, method, body }); assert.equal(result.ok, true, route + '：' + result.data?.error); return result.data; };
  const step = async (name, fn) => { let failure; await t.test(name, async () => { try { await fn(); } catch (error) { failure = error; throw error; } }); if (failure) throw failure; };
  const clone = name => { const target = path.join(work, name); fs.cpSync(backupPath, target, { recursive: true, dereference: false }); return target; };
  const manifest = target => JSON.parse(fs.readFileSync(path.join(target, 'manifest.json'), 'utf8'));
  const writeManifest = (target, value) => fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify(value));
  const marker = path.join(work, '越界哨兵.txt'); fs.writeFileSync(marker, 'outside-marker-must-not-change');
  const markerHash = hash(fs.readFileSync(marker));
  try {
    backend = createBackend(options);
    await api('/auth/setup', 'POST', { username: '备份管理员', password: 'Backup.Acceptance-491!', name: '备份管理员' });
    const customer = (await api('/api/customers', 'POST', { name: '备份客户', phone: '13800000000' })).customer;
    first = (await api('/api/quotes', 'POST', { type: 'sale', customerId: customer.id, title: '离线备份珠宝', material: '黄金', weight: 1, goldPrice: 450, laborPrice: 80, extras: [{ id: 'gem', name: '配件', amount: 50 }], image })).quote;
    await api('/api/quotes/' + first.id + '/images', 'POST', { images: [image] });
    original = (await api('/api/quotes/' + first.id)).quote;
    await step('SQLite仍打开且WAL有数据时生成完整备份，含真实账号、报价、图片与SHA清单', async () => {
      assert.ok(fs.statSync(path.join(live, 'jewelry.sqlite-wal')).size > 0);
      backupPath = makeBackup(backend.runtime, destination);
      assert.ok(inside(destination, backupPath)); assert.ok(!inside(live, backupPath));
      const value = validateBackup(backupPath);
      assert.ok(value.manifest.files.some(file => file.name === 'jewelry.sqlite'));
      assert.ok(value.manifest.files.some(file => file.name === 'images/metadata.json'));
      assert.ok(value.manifest.files.filter(file => file.name.startsWith('images/') && file.name !== 'images/metadata.json').length >= 1);
      const db = new DatabaseSync(path.join(backupPath, 'jewelry.sqlite'), { readOnly: true });
      try {
        assert.equal(db.prepare('SELECT customer_name FROM quotes WHERE id=?').get(first.id).customer_name, '备份客户');
        assert.equal(db.prepare('SELECT username FROM local_accounts').get().username, '备份管理员');
      } finally { db.close(); }
      for (const file of value.manifest.files) { const bytes = fs.readFileSync(path.join(backupPath, ...file.name.split('/'))); assert.equal(bytes.length, file.size); assert.equal(hash(bytes), file.sha256); }
    });
    await step('照片字节变更、缺图和重复清单均拒绝，不能生成恢复暂存或修改当前数据', async () => {
      const corrupted = clone('损坏照片'), entry = manifest(corrupted).files.find(file => file.name.startsWith('images/') && file.name !== 'images/metadata.json');
      const filename = path.join(corrupted, ...entry.name.split('/')), bytes = fs.readFileSync(filename); bytes[bytes.length - 1] ^= 1; fs.writeFileSync(filename, bytes);
      assert.throws(() => validateBackup(corrupted)); assert.throws(() => prepareRestore(corrupted, live));
      const missing = clone('缺失照片'); fs.unlinkSync(path.join(missing, ...entry.name.split('/'))); assert.throws(() => validateBackup(missing));
      const duplicate = clone('重复清单'), value = manifest(duplicate); value.files.push(value.files[0]); writeManifest(duplicate, value); assert.throws(() => validateBackup(duplicate));
      assert.deepEqual((await api('/api/quotes/' + first.id)).quote, original);
    });
    await step('图片索引不得删漏或单向缺失，即使数据库及其他文件SHA仍匹配也拒绝', async () => {
      const omitted = clone('漏掉图片索引'), value = manifest(omitted); value.files = value.files.filter(file => file.name !== 'images/metadata.json'); fs.unlinkSync(path.join(omitted, 'images', 'metadata.json')); writeManifest(omitted, value);
      assert.throws(() => validateBackup(omitted));
      const empty = clone('空图片索引'); const bytes = Buffer.from('{}'); fs.writeFileSync(path.join(empty, 'images', 'metadata.json'), bytes); const next = manifest(empty), index = next.files.find(file => file.name === 'images/metadata.json'); index.size = bytes.length; index.sha256 = hash(bytes); writeManifest(empty, next);
      assert.throws(() => validateBackup(empty));
    });
    await step('清单中的..、绝对路径、反斜线及越界写都拒绝；外部哨兵保持原字节', async () => {
      const before = fs.readdirSync(work).filter(name => name.includes('.restore-'));
      for (const [index, name] of ['../越界哨兵.txt', 'images/../../越界哨兵.txt', 'images\\..\\越界哨兵.txt', 'C:\\Windows\\win.ini', '/absolute-file'].entries()) {
        const target = clone('非法路径-' + index), value = manifest(target); const bytes = fs.readFileSync(marker); value.files.push({ name, size: bytes.length, sha256: hash(bytes) }); writeManifest(target, value);
        assert.throws(() => prepareRestore(target, live));
      }
      assert.deepEqual(fs.readdirSync(work).filter(name => name.includes('.restore-')), before);
      assert.equal(hash(fs.readFileSync(marker)), markerHash);
      assert.equal(inside(live, path.join(work, '业务数据-假目录')), false);
      assert.throws(() => makeBackup(backend.runtime, live));
    });
    await step('普通目录不能用NTFS junction/符号链接替代，验证过程不跟随到外部', async () => {
      const target = clone('链接图片目录'), originalImages = path.join(target, 'images'), moved = path.join(work, '外部图片'); fs.renameSync(originalImages, moved);
      fs.symlinkSync(moved, originalImages, process.platform === 'win32' ? 'junction' : 'dir'); junctions.push(originalImages);
      assert.equal(fs.lstatSync(originalImages).isSymbolicLink(), true);
      assert.throws(() => validateBackup(target)); assert.throws(() => prepareRestore(target, live));
      assert.ok(fs.existsSync(path.join(moved, 'metadata.json'))); assert.equal(hash(fs.readFileSync(marker)), markerHash);
    });
    await step('准备恢复后暂存数据库被损坏，commit再次校验并保留现有数据库不动', async () => {
      await api('/api/customers', 'PATCH', { id: first.customerId, name: '当前更新客户' });
      await backend.close(); backend = null;
      liveHash = hash(fs.readFileSync(path.join(live, 'jewelry.sqlite')));
      const stage = prepareRestore(backupPath, live); assert.ok(fs.existsSync(path.join(stage, 'manifest.json')));
      const filename = path.join(stage, 'jewelry.sqlite'), bytes = fs.readFileSync(filename); bytes[100] ^= 1; fs.writeFileSync(filename, bytes);
      assert.throws(() => commitRestore(stage, live)); assert.equal(hash(fs.readFileSync(path.join(live, 'jewelry.sqlite'))), liveHash);
    });
    await step('正确恢复原子替换本机目录，保留完整旧副本，重新登录后账户/报价/原图都可读', async () => {
      const stage = prepareRestore(backupPath, live), result = commitRestore(stage, live);
      assert.ok(inside(work, result.previous)); assert.equal(hash(fs.readFileSync(path.join(result.previous, 'jewelry.sqlite'))), liveHash);
      backend = createBackend(options);
      assert.equal((await api('/auth/status')).authenticated, false);
      await api('/auth/login', 'POST', { username: '备份管理员', password: 'Backup.Acceptance-491!' });
      const restored = (await api('/api/quotes/' + first.id)).quote; assert.deepEqual(restored, original);
      assert.equal((await api('/api/bootstrap')).customers[0].name, '备份客户');
      const response = await backend.imageResponse(restored.images[0].split('/').pop()); assert.equal(response.status, 200); assert.deepEqual(Buffer.from(await response.arrayBuffer()), imageBytes);
      assert.deepEqual(network.attempts, []);
    });
    completed = true;
  } finally {
    if (backend) await backend.close(); network.restore();
    for (const junction of junctions) if (fs.lstatSync(junction, { throwIfNoEntry: false })?.isSymbolicLink()) fs.unlinkSync(junction);
    if (completed) {
      const target = fs.realpathSync(work), base = fs.realpathSync(testingRoot), relative = path.relative(base, target);
      assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), '递归清理只允许专属验收目录');
      fs.rmSync(target, { recursive: true, force: true });
    } else t.diagnostic('失败备份验收数据保留于 ' + work);
  }
});

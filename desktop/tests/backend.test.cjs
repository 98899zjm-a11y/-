'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRuntime } = require('../runtime.cjs');
const { createAuth } = require('../local-auth.cjs');
const migrationDir = path.resolve(__dirname, '../../drizzle');
const testRoot = path.resolve('E:/codex/2026-10-10/ce/work/offline-unit-tests');
fs.mkdirSync(testRoot, { recursive: true });
const temporary = () => fs.mkdtempSync(path.join(testRoot, 'backend-'));

test('SQLite真实迁移只应用一次，事务回滚完整并启用外键', async () => {
  const dataDir = temporary();
  const runtime = createRuntime({ dataDir, migrationDir });
  assert.equal(runtime.sqlite.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  assert.equal(runtime.sqlite.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
  assert.equal(runtime.sqlite.prepare('SELECT count(*) AS count FROM desktop_migrations').get().count, 2);
  await assert.rejects(runtime.env.DB.batch([
    runtime.env.DB.prepare("INSERT INTO staff_users(id,user_id,email,name,role,active,created_at,updated_at) VALUES('rollback','rollback','rollback','rollback','admin',1,'now','now')"),
    runtime.env.DB.prepare("INSERT INTO customers(id,name,owner_id,created_at,updated_at) VALUES('invalid','invalid','not-an-owner','now','now')"),
  ]), /FOREIGN KEY/);
  assert.equal(await runtime.env.DB.prepare("SELECT id FROM staff_users WHERE id='rollback'").first(), null);
  runtime.close();
  const reopened = createRuntime({ dataDir, migrationDir });
  assert.equal(reopened.sqlite.prepare('SELECT count(*) AS count FROM desktop_migrations').get().count, 2);
  reopened.close();
});

test('本机密码无明文，首次管理员保护、员工管理、重启登录和停用即时生效', () => {
  const dataDir = temporary();
  let runtime = createRuntime({ dataDir, migrationDir }), auth = createAuth(runtime);
  assert.deepEqual(auth.status(), { needsSetup: true, authenticated: false });
  assert.throws(() => auth.setup({ username: 'someone@example.com', password: 'secret-password' }), error => error.status === 400);
  assert.throws(() => auth.setup({ username: '店长', password: 'short' }), error => error.status === 400);
  const setup = auth.setup({ username: '店长', password: 'admin-password', name: '管理员' });
  assert.equal(setup.user.role, 'admin');
  assert.equal(setup.user.username, '店长');
  assert.throws(() => auth.setup({ username: 'second', password: 'admin-password' }), error => error.status === 409);
  const a = auth.createUser({ username: '员工A', password: 'employee-password', name: '店员A' });
  const b = auth.createUser({ username: '员工B', password: 'employee-password', name: '店员B' });
  const credentialRows = runtime.sqlite.prepare('SELECT * FROM local_accounts').all();
  assert.ok(credentialRows.every(row => row.password_hash.length === 128 && row.password_salt.length === 48));
  assert.ok(!JSON.stringify(credentialRows).includes('employee-password'));
  assert.notEqual(credentialRows[1].password_hash, credentialRows[2].password_hash);
  assert.throws(() => auth.updateUser({ id: setup.user.id, active: false }), error => error.status === 400);
  assert.throws(() => auth.updateUser({ id: setup.user.id, role: 'employee' }), error => error.status === 400);
  auth.logout();
  assert.equal(auth.identity(), null);
  assert.throws(() => auth.login({ username: '员工A', password: 'wrong-password' }), error => error.status === 401);
  auth.login({ username: '员工A', password: 'employee-password' });
  assert.equal(auth.identity().userId, a.userId);
  assert.throws(() => auth.createUser({ username: 'not-allowed', password: 'employee-password' }), error => error.status === 403);
  assert.throws(() => auth.updateUser({ id: b.id, active: false }), error => error.status === 403);
  runtime.sqlite.prepare('UPDATE staff_users SET active=0 WHERE id=?').run(a.id);
  assert.equal(auth.identity(), null);
  assert.throws(() => auth.login({ username: '员工A', password: 'employee-password' }), error => error.status === 401);
  auth.login({ username: '店长', password: 'admin-password' });
  const anotherSession = createAuth(runtime);
  anotherSession.login({ username: '员工B', password: 'employee-password' });
  auth.updateUser({ id: b.id, password: 'reset-employee-password' });
  assert.equal(anotherSession.identity(), null, '重置密码须撤销旧会话');
  assert.equal(auth.identity().displayName, '管理员', '其他账号会话保留');
  auth.updateUser({ id: a.id, active: true, password: 'new-employee-password' });
  auth.logout();
  runtime.close();
  runtime = createRuntime({ dataDir, migrationDir }); auth = createAuth(runtime);
  assert.equal(auth.status().needsSetup, false);
  assert.equal(auth.status().authenticated, false);
  assert.throws(() => auth.login({ username: '员工A', password: 'employee-password' }), error => error.status === 401);
  auth.login({ username: '员工A', password: 'new-employee-password' });
  assert.equal(auth.status().user.id, a.id);
  const audits = runtime.sqlite.prepare('SELECT old_value,new_value FROM audit_logs').all();
  assert.ok(!JSON.stringify(audits).includes('password_hash'));
  assert.ok(!JSON.stringify(audits).includes('employee-password'));
  runtime.close();
});

test('原图和权限元数据持久化且拒绝路径穿越', async () => {
  const dataDir = temporary();
  let runtime = createRuntime({ dataDir, migrationDir });
  const image = Uint8Array.from([137,80,78,71,13,10,26,10,1,2,3]);
  const key = 'images/12345678-1234-1234-1234-123456789012';
  await runtime.env.BUCKET.put(key, image, { httpMetadata: { contentType: 'image/png' }, customMetadata: { ownerId: 'staffA', quoteId: 'q1' } });
  await assert.rejects(runtime.env.BUCKET.get('images/../../jewelry.sqlite'), /无效/);
  await assert.rejects(runtime.env.BUCKET.put('images/metadata.json', image), /无效/);
  runtime.close();
  runtime = createRuntime({ dataDir, migrationDir });
  const stored = await runtime.env.BUCKET.get(key);
  assert.deepEqual(stored.body, image);
  assert.equal(stored.customMetadata.ownerId, 'staffA');
  assert.equal(stored.httpMetadata.contentType, 'image/png');
  await runtime.env.BUCKET.delete(key);
  assert.equal(await runtime.env.BUCKET.get(key), null);
  runtime.close();
});

test('异步业务上下文并发隔离：不同数据库和身份不交叉', async () => {
  const a = createRuntime({ dataDir: temporary(), migrationDir }), b = createRuntime({ dataDir: temporary(), migrationDir });
  try {
    const results = await Promise.all([
      a.withIdentity({ userId: 'A' }, async () => { await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(globalThis.__xjyDesktopContext().env, a.env); return a.getIdentity().userId; }),
      b.withIdentity({ userId: 'B' }, async () => { await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(globalThis.__xjyDesktopContext().env, b.env); return b.getIdentity().userId; }),
    ]);
    assert.deepEqual(results, ['A', 'B']);
    assert.equal(a.getIdentity(), null);
  } finally { a.close(); b.close(); }
});

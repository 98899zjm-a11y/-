'use strict';
// Guest-only RED: real backend/local-auth/administration + real LocalD1,
// fictitious accounts and SQLite :memory:. Never opens a product database.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
if (process.platform !== 'win32' || ROOT.toLowerCase() !== 'c:\\xjy-work\\xjy-web-stage1') throw Error('Login scope RED requires the actual fixed Windows Sandbox');
const guardFile = path.join(ROOT, 'stage1/guest-candidate-cdp.cjs');
if (crypto.createHash('sha256').update(fs.readFileSync(guardFile)).digest('hex') !== '59840b638d8797fb55241616cd0b8e4098075a76834a201b0e93c1a748f1bb32') throw Error('Actual Sandbox guard source changed');
require(guardFile).actualGuard();
const test = require('node:test'), assert = require('node:assert/strict'), http = require('node:http'), vm = require('node:vm');
const { createRequire } = require('node:module'), { DatabaseSync } = require('node:sqlite');
const { LocalD1 } = require('../project/desktop/runtime.cjs');
const { createGateway } = require('../stage1/web-gateway.cjs');
const CODE = path.join(ROOT, 'project/desktop/backend.cjs'), realRequire = createRequire(CODE), BACKEND = { exports: {} };
// Even a broken constructor/default injection cannot open a file database.
vm.runInNewContext(fs.readFileSync(CODE, 'utf8'), { module: BACKEND, exports: BACKEND.exports,
  require: address => address === './runtime.cjs' ? { createRuntime() { throw Error('FILE_DATABASE_RUNTIME_MUST_NOT_RUN'); } } : realRequire(address),
  __dirname: path.dirname(CODE), Buffer, Request, Response, URL, URLSearchParams, setImmediate, setTimeout, clearTimeout, console }, { filename: CODE });
const { createBackend } = BACKEND.exports;
const AUTH = 'xjy_stage1', BOOT = 'xjy_stage1_bootstrap', PASSWORD = 'Fictitious-Only-2026!', SALT = 'owned-in-memory-login-scope';
const PASSWORD_HASH = crypto.scryptSync(PASSWORD, SALT, 64).toString('hex');
class Jar {
  constructor(other) { this.values = new Map(other ? other.values : []); }
  header() { return [...this.values].map(([name, value]) => name + '=' + value).join('; '); }
  apply(lines) { for (const line of lines) { const [pair, ...attributes] = line.split(';'), split = pair.indexOf('='); assert(split > 0); const key = pair.slice(0, split), value = pair.slice(split + 1); if (attributes.some(item => /^\s*Max-Age=0\s*$/i.test(item))) this.values.delete(key); else this.values.set(key, value); } }
}
const noAuthWrite = result => assert.equal(result.cookies.filter(line => line.startsWith(AUTH + '=')).length, 0, 'a rejected/read-only request cannot write or clear the authority cookie');
async function fixture(t, withHttp = false) {
  const base = path.join(ROOT, 'runtime/login-scope-tests'); fs.mkdirSync(base, { recursive: true });
  const directory = fs.mkdtempSync(path.join(base, 'owned-')); assert.equal(path.dirname(directory), base); fs.mkdirSync(path.join(directory, 'logs'));
  const db = new DatabaseSync(':memory:'), migrations = path.join(ROOT, 'project/desktop/migrations');
  for (const file of fs.readdirSync(migrations).filter(file => /^\d+_[\w-]+\.sql$/.test(file)).sort()) db.exec(fs.readFileSync(path.join(migrations, file), 'utf8'));
  db.exec('CREATE TABLE local_accounts(staff_id TEXT PRIMARY KEY,username TEXT UNIQUE,password_salt TEXT,password_hash TEXT,created_at TEXT,updated_at TEXT)');
  const created = '2026-10-16T00:00:00Z';
  for (const [index, username, role] of [[1, 'fictional-admin', 'admin'], [2, 'fictional-sales', 'employee']]) {
    const id = '10000000-0000-4000-8000-00000000000' + index;
    db.prepare('INSERT INTO staff_users VALUES(?,?,?,?,?,?,?,?)').run(id, 'local-' + id, username, '虚构-' + username, role, 1, created, created);
    db.prepare('INSERT INTO local_accounts VALUES(?,?,?,?,?,?)').run(id, username, SALT, PASSWORD_HASH, created, created);
    db.prepare('INSERT INTO module_permissions VALUES(?,?,?,?,?,?)').run(id, 'operate', 'disabled', 'disabled', 1, created);
  }
  let runtimeClosed = false;
  const runtime = { sqlite: db, dataDir: directory, env: { DB: new LocalD1(db), BUCKET: { get: async () => null, put: async () => { throw Error('NO_ATTACHMENTS_IN_AUTH_FIXTURE'); }, delete: async () => { throw Error('NO_ATTACHMENTS_IN_AUTH_FIXTURE'); } } },
    withIdentity: (_identity, action) => action(), close() { if (!runtimeClosed) { runtimeClosed = true; db.close(); } } };
  const backend = createBackend({ dataDir: directory, migrationDir: migrations, runtimeFactory: () => runtime, businessCore: {}, pollsAdapter: {}, aiAdapter: {} });
  let server, gateway;
  t.after(async () => { if (gateway) await gateway.close(); if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await backend.close(); });
  const native = await backend.dispatch({ path: '/auth/login', method: 'POST', body: { username: 'fictional-admin', password: PASSWORD } }); assert.equal(native.status, 200);
  const session = (loginScopeId, sourcePeer = 'owned-scope-peer') => backend.createSession({ sourcePeer, ...(loginScopeId === undefined ? {} : { loginScopeId }) });
  const login = (target, username, password = 'wrong-fictitious-password') => target.dispatch({ path: '/auth/login', method: 'POST', body: { username, password } });
  const result = { backend, db, session, login };
  if (!withHttp) return result;
  server = http.createServer(); await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  assert.equal(server.address().address, '127.0.0.1'); assert.notEqual(server.address().port, 31831);
  const origin = 'http://127.0.0.1:' + server.address().port;
  gateway = createGateway({ backend, server, root: directory, allowLocalControls: false });
  async function call(jar, address, options = {}) {
    const method = options.body === undefined ? 'GET' : 'POST', headers = { cookie: options.cookie ?? jar.header() };
    if (method === 'POST') Object.assign(headers, { origin, 'content-type': 'application/json', 'x-xjy-csrf': options.csrf || '' });
    const response = await fetch(origin + address, { method, headers, ...(method === 'POST' ? { body: JSON.stringify(options.body) } : {}), redirect: 'error', signal: AbortSignal.timeout(10000) });
    const cookies = response.headers.getSetCookie(); jar.apply(cookies); return { status: response.status, data: await response.json(), cookies };
  }
  async function bootstrap(jar) { const response = await call(jar, '/session'); assert.equal(response.status, 200); assert.match(response.data.csrf, /^[a-f0-9]{64}$/); return response; }
  async function browserLogin(jar, csrf, body = { username: 'fictional-sales', password: PASSWORD }) { return call(jar, '/auth/login', { csrf, body }); }
  return { ...result, call, bootstrap, browserLogin };
}

test('L1 one server-issued login scope retains the real ten-failure limit across closed temporary backend sessions', { timeout: 20000 }, async t => {
  const f = await fixture(t), scope = crypto.randomUUID();
  for (let i = 0; i < 10; i++) { const temporary = f.session(scope); try { assert.equal((await f.login(temporary, 'scope-missing-' + i)).status, 401); } finally { await temporary.close(); } }
  const blocked = f.session(scope), independent = f.session(crypto.randomUUID());
  assert.equal((await f.login(blocked, 'scope-missing-10')).status, 429, 'changing the temporary object cannot reset the same internal login scope');
  assert.equal((await f.login(independent, 'different-scope')).status, 401, 'fewer than twenty source failures must leave another scope unblocked');
});

test('L2 internal scope accepts only a generated UUID; omission preserves independent default sessions', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  for (const loginScopeId of ['', 'not-a-uuid', 'a'.repeat(64), 0, null, {}]) assert.throws(() => f.backend.createSession({ loginScopeId }), /scope|UUID|会话|标识/i, 'invalid internal scope must be rejected before creating auth');
  const first = f.session(), second = f.session();
  for (let i = 0; i < 10; i++) assert.equal((await f.login(first, 'default-first-' + i)).status, 401);
  assert.equal((await f.login(first, 'default-first-10')).status, 429);
  assert.equal((await f.login(second, 'default-second')).status, 401);
});

test('L3 original username and source-peer limits remain independent of internal scopes', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  for (let i = 0; i < 6; i++) assert.equal((await f.login(f.session(crypto.randomUUID(), 'name-peer'), 'same-missing-name')).status, 401);
  assert.equal((await f.login(f.session(crypto.randomUUID(), 'name-peer'), 'same-missing-name')).status, 429);
  for (let i = 0; i < 20; i++) assert.equal((await f.login(f.session(crypto.randomUUID(), 'source-peer'), 'source-missing-' + i)).status, 401);
  assert.equal((await f.login(f.session(crypto.randomUUID(), 'source-peer'), 'source-missing-20')).status, 429);
});

test('L4 original failed relogin clears that employee before validation while native admin remains separate', { timeout: 20000 }, async t => {
  const f = await fixture(t), employee = f.session(crypto.randomUUID());
  assert.equal((await f.login(employee, 'fictional-sales', PASSWORD)).status, 200);
  assert.equal((await f.login(employee, 'fictional-sales')).status, 401);
  assert.equal(employee.auth.status().authenticated, false); assert.equal(employee.auth.status().user, undefined);
  assert.equal((await employee.dispatch({ path: '/api/employee-profiles' })).status, 401);
  assert.equal(f.backend.auth.status().user.username, 'fictional-admin');
});

test('L5 blocked relogin also clears the former employee, including when the failures came from other temporary objects', { timeout: 20000 }, async t => {
  const f = await fixture(t), scope = crypto.randomUUID(), employee = f.session(scope);
  assert.equal((await f.login(employee, 'fictional-sales', PASSWORD)).status, 200);
  for (let i = 0; i < 10; i++) { const temporary = f.session(scope); try { assert.equal((await f.login(temporary, 'blocked-missing-' + i)).status, 401); } finally { await temporary.close(); } }
  assert.equal((await f.login(employee, 'fictional-sales', PASSWORD)).status, 429);
  assert.equal(employee.auth.status().authenticated, false, '429 must retain the original clear-before-check semantics');
  assert.equal(f.backend.auth.status().user.username, 'fictional-admin');
});

test('L6 HTTP callers cannot choose the internal scope and evade real per-session login throttling', { timeout: 20000 }, async t => {
  const f = await fixture(t, true), jar = new Jar(), boot = await f.bootstrap(jar);
  for (let i = 0; i < 10; i++) { const response = await f.browserLogin(jar, boot.data.csrf, { username: 'http-missing-' + i, password: 'wrong-fictitious-password', loginScopeId: crypto.randomUUID() }); assert.equal(response.status, 401); noAuthWrite(response); }
  const blocked = await f.browserLogin(jar, boot.data.csrf, { username: 'http-missing-10', password: 'wrong-fictitious-password', loginScopeId: crypto.randomUUID() });
  assert.equal(blocked.status, 429); noAuthWrite(blocked); assert.equal(f.backend.auth.status().user.username, 'fictional-admin');
});

test('L7 rejected authenticated HTTP relogin revokes old authority and publishes only fresh anonymous retry state', { timeout: 20000 }, async t => {
  const f = await fixture(t, true), jar = new Jar(), boot = await f.bootstrap(jar), oldBootstrap = jar.values.get(BOOT), logged = await f.browserLogin(jar, boot.data.csrf); assert.equal(logged.status, 200);
  const old = new Jar(jar), oldAuth = old.values.get(AUTH); assert.match(oldAuth, /^[a-f0-9]{64}$/);
  const rejected = await f.browserLogin(jar, logged.data.csrf, { username: 'fictional-sales', password: 'wrong-fictitious-password' });
  assert.equal(rejected.status, 401); noAuthWrite(rejected);
  assert.equal(rejected.cookies.filter(line => line.startsWith(BOOT + '=')).length, 1, 'the rejected relogin response itself must publish anonymous retry state');
  assert.match(jar.values.get(BOOT), /^[a-f0-9]{64}$/); assert.notEqual(jar.values.get(BOOT), oldBootstrap, 'the revoked old bootstrap cannot be reused');
  assert.equal((await f.call(old, '/api/employee-profiles')).status, 401, 'the old authority must not retain its former employee');
  const retry = await f.bootstrap(jar); assert.equal(retry.data.authenticated, false); assert.notEqual(retry.data.csrf, logged.data.csrf);
  assert.equal(retry.cookies.filter(line => line.startsWith(BOOT + '=')).length, 0, 'session must reuse the failure-published scope instead of silently allocating another');
  assert.equal((await f.browserLogin(jar, retry.data.csrf)).status, 200);
  assert.notEqual(jar.values.get(AUTH), oldAuth); assert.equal((await f.call(old, '/auth/status')).data.authenticated, false);
  assert.equal(f.backend.auth.status().user.username, 'fictional-admin');
});

test('L8 login query aliases are refused before backend authentication and cannot bypass publication/rotation', { timeout: 20000 }, async t => {
  const f = await fixture(t, true), jar = new Jar(), boot = await f.bootstrap(jar);
  const response = await f.call(jar, '/auth/login?x=1', { csrf: boot.data.csrf, body: { username: 'fictional-sales', password: PASSWORD } });
  assert.equal(response.status, 400, 'only the exact login route can authenticate'); noAuthWrite(response);
  const status = await f.call(jar, '/auth/status'); assert.equal(status.data.authenticated, false); assert.equal(status.data.user, undefined);
  assert.equal(f.backend.auth.status().user.username, 'fictional-admin');
});

test('L9 duplicate authority/bootstrap cookie names are rejected instead of choosing an ambiguous first value', { timeout: 20000 }, async t => {
  const f = await fixture(t, true), jar = new Jar(), boot = await f.bootstrap(jar), logged = await f.browserLogin(jar, boot.data.csrf); assert.equal(logged.status, 200);
  const authority = jar.values.get(AUTH), other = crypto.randomBytes(32).toString('hex');
  for (const cookie of [AUTH + '=' + authority + '; ' + AUTH + '=' + other, AUTH + '=' + authority + '; ' + BOOT + '=' + other + '; ' + BOOT + '=' + other]) {
    const response = await f.call(new Jar(), '/auth/status', { cookie }); assert.equal(response.status, 400); noAuthWrite(response); assert.equal(response.data.user, undefined);
  }
  assert.equal((await f.call(jar, '/auth/status')).data.user.username, 'fictional-sales');
});

test('L10 authenticated failure and its replacement bootstrap retain one real limiter scope across later temporary verifications', { timeout: 20000 }, async t => {
  const f = await fixture(t, true), jar = new Jar(), boot = await f.bootstrap(jar), logged = await f.browserLogin(jar, boot.data.csrf); assert.equal(logged.status, 200);
  const failedRelogin = await f.browserLogin(jar, logged.data.csrf, { username: 'transfer-missing-0', password: 'wrong-fictitious-password' }); assert.equal(failedRelogin.status, 401); noAuthWrite(failedRelogin);
  assert.equal(failedRelogin.cookies.filter(line => line.startsWith(BOOT + '=')).length, 1, 'relogin failure must publish the same-scope retry bootstrap');
  const retry = await f.bootstrap(jar); assert.equal(retry.data.authenticated, false);
  assert.equal(retry.cookies.filter(line => line.startsWith(BOOT + '=')).length, 0);
  for (let i = 1; i < 10; i++) { const response = await f.browserLogin(jar, retry.data.csrf, { username: 'transfer-missing-' + i, password: 'wrong-fictitious-password' }); assert.equal(response.status, 401); noAuthWrite(response); }
  assert.equal((await f.browserLogin(jar, retry.data.csrf, { username: 'transfer-missing-10', password: 'wrong-fictitious-password' })).status, 429, 'A failure plus nine B failures must reach ten for the same internal scope');
  const independent = new Jar(), separate = await f.bootstrap(independent);
  assert.equal((await f.browserLogin(independent, separate.data.csrf, { username: 'transfer-independent', password: 'wrong-fictitious-password' })).status, 401, 'source failures remain below twenty, isolating the transferred scope limit');
  assert.equal(f.backend.auth.status().user.username, 'fictional-admin');
});

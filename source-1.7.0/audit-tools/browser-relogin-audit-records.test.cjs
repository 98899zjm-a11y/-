'use strict';

// DRAFT: Root must review and run RED in the actual fixed Guest.
// Admission precedes product imports, SQLite, password derivation, or HTTP.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const ROOT = path.resolve(__dirname, '..');
if (process.platform !== 'win32' || os.userInfo().username.toLowerCase() !== 'wdagutilityaccount' || ROOT.toLowerCase() !== 'c:\\xjy-work\\xjy-web-stage1') throw Error('Relogin audit records require the fixed actual Windows Sandbox');
const guard = require('../stage1/isolation.cjs').createIsolationGuard(ROOT);
const admission = require('node:child_process').spawnSync('C:\\Python314\\python.exe', ['-I', '-B', guard.assertPath(path.join(ROOT, 'stage1/validate-sandbox-context.py'))], { cwd: ROOT, windowsHide: true, encoding: 'utf8' });
if (admission.status !== 0) throw Error('Unchanged actual Sandbox admission failed');

const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto'), http = require('node:http'), vm = require('node:vm');
const { createRequire } = require('node:module'), { DatabaseSync } = require('node:sqlite');
const { LocalD1 } = require(guard.assertPath(path.join(ROOT, 'project/desktop/runtime.cjs')));
const { createGateway } = require(guard.assertPath(path.join(ROOT, 'stage1/web-gateway.cjs')));
const FILE = guard.assertPath(path.join(ROOT, 'project/desktop/backend.cjs')), realRequire = createRequire(FILE), BACKEND = { exports: {} };
// Exact backend source, with a hard refusal if any default file DB is selected.
// Authentication, administration, SQL, permissions, and audit logging are real.
vm.runInNewContext(fs.readFileSync(FILE, 'utf8'), { module: BACKEND, exports: BACKEND.exports,
  require: name => name === './runtime.cjs' ? { createRuntime() { throw Error('FILE_DATABASE_RUNTIME_MUST_NOT_RUN'); } } : realRequire(name),
  __dirname: path.dirname(FILE), Buffer, Request, Response, URL, URLSearchParams, setImmediate, setTimeout, clearTimeout, console }, { filename: FILE });
const { createBackend } = BACKEND.exports;
const AUTH = 'xjy_stage1', BOOT = 'xjy_stage1_bootstrap', PASSWORD = 'Only-Fictional-Relogin-2026!', SALT = 'owned-fictitious-audit-salt';
const HASH = crypto.scryptSync(PASSWORD, SALT, 64).toString('hex');
const IDS = { native: '10000000-0000-4000-8000-000000000001', a: '10000000-0000-4000-8000-000000000002', b: '10000000-0000-4000-8000-000000000003', c: '10000000-0000-4000-8000-000000000004' };
const NAMES = { native: '虚构本机管理员', a: '虚构销售甲', b: '虚构销售乙', c: '虚构只看首页员工' };
class Jar {
  constructor(other) { this.values = new Map(other ? other.values : []); }
  header() { return [...this.values].map(([key, value]) => key + '=' + value).join('; '); }
  apply(lines) { for (const line of lines) { const [pair, ...attributes] = line.split(';'), split = pair.indexOf('='); assert(split > 0); const key = pair.slice(0, split), value = pair.slice(split + 1); if (attributes.some(item => /^\s*Max-Age=0\s*$/i.test(item))) this.values.delete(key); else this.values.set(key, value); } }
}
const noAuthorityWrite = result => assert.equal(result.cookies.filter(line => line.startsWith(AUTH + '=')).length, 0, 'failure or late response must not publish/clear the authority cookie');
function deferred() { let resolve; const promise = new Promise(accept => { resolve = accept; }); return { promise, resolve }; }

async function fixture(t) {
  const base = guard.assertPath(path.join(ROOT, 'runtime/browser-relogin-audit-records')); fs.mkdirSync(base, { recursive: true });
  const directory = fs.mkdtempSync(path.join(base, 'owned-')); assert.equal(path.dirname(directory), base); fs.mkdirSync(path.join(directory, 'logs'));
  const db = new DatabaseSync(':memory:'), migrations = guard.assertPath(path.join(ROOT, 'project/desktop/migrations')); db.exec('PRAGMA foreign_keys=ON');
  for (const file of fs.readdirSync(migrations).filter(file => /^\d+_[\w-]+\.sql$/.test(file)).sort()) db.exec(fs.readFileSync(guard.assertPath(path.join(migrations, file)), 'utf8'));
  db.exec('CREATE TABLE local_accounts(staff_id TEXT PRIMARY KEY NOT NULL REFERENCES staff_users(id),username TEXT UNIQUE NOT NULL,password_salt TEXT NOT NULL,password_hash TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)');
  const stamp = '2026-10-16T00:00:00.000Z';
  for (const key of Object.keys(IDS)) {
    db.prepare('INSERT INTO staff_users VALUES(?,?,?,?,?,?,?,?)').run(IDS[key], 'local-' + IDS[key], 'fictional-' + key, NAMES[key], key === 'native' ? 'admin' : 'employee', 1, stamp, stamp);
    db.prepare('INSERT INTO local_accounts VALUES(?,?,?,?,?,?)').run(IDS[key], 'fictional-' + key, SALT, HASH, stamp, stamp);
    db.prepare('INSERT INTO module_permissions VALUES(?,?,?,?,?,?)').run(IDS[key], key === 'c' ? 'disabled' : 'operate', 'disabled', 'disabled', 1, stamp);
  }
  let runtimeClosed = false;
  const runtime = { sqlite: db, dataDir: directory, env: { DB: new LocalD1(db), BUCKET: { async get() { return null; }, async put() { throw Error('AUTH_TEST_MUST_NOT_WRITE_ATTACHMENTS'); }, async delete() { throw Error('AUTH_TEST_MUST_NOT_DELETE_ATTACHMENTS'); } } },
    withIdentity: (_identity, action) => action(), close() { if (!runtimeClosed) { runtimeClosed = true; db.close(); } } };
  const backend = createBackend({ dataDir: directory, migrationDir: migrations, runtimeFactory: () => runtime, businessCore: {}, pollsAdapter: {}, aiAdapter: {} });
  // A pass-through factory observer collects only known secret scope strings for
  // negative export assertions. It never replaces auth, SQL, or a log function.
  const scopes = new Set(), actualCreate = backend.createSession.bind(backend); let failNextCreation = false, sessionCreations = 0;
  const createdSessions = [];
  backend.createSession = options => { sessionCreations++; if (failNextCreation) { failNextCreation = false; throw Error('synthetic trusted session factory failure'); } const session = actualCreate(options); createdSessions.push({ session, options: { ...options } }); if (options?.loginScopeId) scopes.add(options.loginScopeId); return session; };
  let server, gateway; const finishBodies = [], pendingBodies = [], secrets = new Set([PASSWORD, SALT, HASH]), bodyGates = new Map();
  t.after(async () => {
    for (const finish of finishBodies) finish(); await Promise.allSettled(pendingBodies);
    if (gateway) await gateway.close(); if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await backend.close();
  });
  assert.equal((await backend.dispatch({ path: '/auth/login', method: 'POST', body: { username: 'fictional-native', password: PASSWORD } })).status, 200);
  const nativeUsage = backend.auth.sessionId;
  server = http.createServer(req => {
    const gate = bodyGates.get(req.headers['x-owned-body-gate']);
    if (gate) { const on = req.on.bind(req); req.on = (event, listener) => { const value = on(event, listener); if (event === 'data') gate.resolve(); return value; }; }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  assert.equal(server.address().address, '127.0.0.1'); assert.notEqual(server.address().port, 31831);
  const origin = 'http://127.0.0.1:' + server.address().port;
  gateway = createGateway({ backend, server, root: directory, allowLocalControls: false });
  async function call(jar, address, options = {}) {
    const method = options.body === undefined ? 'GET' : 'POST', headers = { cookie: options.cookie ?? jar.header(), ...options.headers };
    if (method === 'POST') Object.assign(headers, { origin, 'content-type': 'application/json', 'x-xjy-csrf': options.csrf || '' });
    const response = await fetch(origin + address, { method, headers, ...(method === 'POST' ? { body: JSON.stringify(options.body) } : {}), redirect: 'error', signal: AbortSignal.timeout(10000) });
    const cookies = response.headers.getSetCookie(); jar.apply(cookies); const data = await response.json();
    for (const value of jar.values.values()) if (value) secrets.add(value); if (data.csrf) secrets.add(data.csrf);
    return { status: response.status, data, cookies };
  }
  const checkpoint = () => Number(db.prepare('SELECT coalesce(max(rowid),0) AS n FROM operation_logs').get().n);
  const authOperations = after => db.prepare("SELECT rowid AS sequence,* FROM operation_logs WHERE rowid>? AND action='auth.login' ORDER BY rowid").all(after);
  const links = () => db.prepare("SELECT * FROM audit_logs WHERE entity_type='auth-relogin' ORDER BY rowid").all();
  const usage = id => db.prepare('SELECT * FROM usage_sessions WHERE id=?').get(id);
  const openUsage = staff => db.prepare('SELECT * FROM usage_sessions WHERE staff_id=? AND ended_at IS NULL ORDER BY rowid').all(staff);
  async function bootstrap(jar) { const result = await call(jar, '/session'); assert.equal(result.status, 200); assert.equal(result.data.authenticated, false); return result; }
  async function login(jar, csrf, username = 'a', extra = {}) { return call(jar, '/auth/login', { csrf, body: { username: 'fictional-' + username, password: PASSWORD, ...extra } }); }
  async function browser(key = 'a') { const jar = new Jar(), boot = await bootstrap(jar), result = await login(jar, boot.data.csrf, key); assert.equal(result.status, 200); assert.equal(result.data.user.id, IDS[key]); const active = openUsage(IDS[key]); assert.equal(active.length, 1); return { jar, csrf: result.data.csrf, user: result.data.user, usage: { ...active[0] } }; }
  function partialLogout(source) {
    const gate = deferred(), key = crypto.randomUUID(); bodyGates.set(key, gate); let req, ended = false;
    const result = new Promise((resolve, reject) => {
      req = http.request(origin + '/auth/logout', { method: 'POST', headers: { cookie: source.jar.header(), origin, 'content-type': 'application/json', 'x-xjy-csrf': source.csrf, 'x-owned-body-gate': key } }, res => {
        const chunks = []; res.on('data', bytes => chunks.push(bytes)); res.on('end', () => { try { resolve({ status: res.statusCode, cookies: [].concat(res.headers['set-cookie'] || []), data: JSON.parse(Buffer.concat(chunks).toString()) }); } catch (error) { reject(error); } });
      }); req.on('error', reject); req.flushHeaders(); req.write('{');
    });
    result.catch(() => {}); pendingBodies.push(result);
    const finish = () => { if (!ended) { ended = true; req.end('}'); } }; finishBodies.push(finish);
    return { entered: gate.promise, finish, result };
  }
  return { backend, db, call, bootstrap, login, browser, checkpoint, authOperations, links, usage, openUsage, nativeUsage, partialLogout, secrets, scopes, get sessionCreations() { return sessionCreations; }, failNextCreation() { failNextCreation = true; },
    get createdSessions() { return createdSessions.slice(); },
    ownedInfo(usageSessionId) { const owned = createdSessions.find(item => item.session.auth.sessionId === usageSessionId); assert(owned, 'real owned session for the stored usage'); return owned; },
    async closeExpectedFailureStop() {
      // Real gateway.close performs owned cleanup, then deliberately reports
      // sticky failure-stop. Do not turn this expected rejection into an orphan
      // HTTP server/DB or alter cleanup for any of the original fifteen cases.
      const owned = gateway; gateway = null; assert(owned, 'one real gateway close');
      await assert.rejects(owned.close(), /清理未完成|审计.*(?:未完成|未能保存)/);
    },
  };
}
function singleOperation(f, after, status) {
  const rows = f.authOperations(after); assert.equal(rows.length, 1, 'one terminal auth.login operation must be really stored');
  assert.equal(rows[0].status, status); assert.equal(rows[0].success, status === 200 ? 1 : 0); assert.equal(rows[0].resource, '/auth/login'); return rows[0];
}
function association(f, operation, source, status, verified = null) {
  const rows = f.links().filter(row => row.entity_id === operation.id); assert.equal(rows.length, 1, 'one stored trusted link must join the actual operation');
  const row = rows[0]; assert.equal(row.action, 'auth.relogin-attempt'); assert.equal(row.actor_id, source.user.id); assert.equal(row.actor_name, source.user.name);
  assert.match(operation.id, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.equal(JSON.parse(row.old_value).usageSessionId, source.usage.id);
  const result = JSON.parse(row.new_value); assert.equal(result.status, status); assert.equal(result.success, status === 200); assert.equal(result.verifiedStaffId, verified);
  const ended = f.usage(source.usage.id); assert.equal(ended.id, source.usage.id); assert.equal(ended.staff_id, source.usage.staff_id); assert.equal(ended.started_at, source.usage.started_at); assert(ended.ended_at); assert.equal(ended.ended_reason, 'switch-user');
}
async function stillNative(f) { assert.equal(f.backend.auth.status().user.id, IDS.native); assert.equal(f.usage(f.nativeUsage).ended_at, null); }
async function revoked(f, oldJar) {
  // S3 deliberately keeps read-only status anonymous 200 without allocation.
  // Revocation is proved at a protected business route, not by changing that
  // established status contract to 401 and breaking late-read safety.
  const before = f.sessionCreations, status = await f.call(oldJar, '/auth/status');
  assert.equal(status.status, 200); assert.equal(status.data.authenticated, false); assert.equal(status.data.user, undefined); assert.equal(status.cookies.length, 0);
  const response = await f.call(oldJar, '/api/bootstrap');
  assert.equal(response.status, 401); assert.equal(response.data.user, undefined); assert.equal(response.cookies.length, 0); noAuthorityWrite(response);
  assert.equal(f.sessionCreations, before, 'stale authority cannot allocate a backend session on status or protected data reads');
}

test('R1 real success records B as login actor and separately links initiating A plus immutable switch-user usage', { timeout: 30000 }, async t => {
  const f = await fixture(t), source = await f.browser(), oldJar = new Jar(source.jar), oldCookie = source.jar.values.get(AUTH), after = f.checkpoint();
  const result = await f.login(source.jar, source.csrf, 'b'); assert.equal(result.status, 200); assert.equal(result.data.user.id, IDS.b); assert.notEqual(source.jar.values.get(AUTH), oldCookie);
  const operation = singleOperation(f, after, 200); assert.equal(operation.actor_id, IDS.b); association(f, operation, source, 200, IDS.b);
  assert.equal(f.openUsage(IDS.b).length, 1); assert.notEqual(f.openUsage(IDS.b)[0].id, source.usage.id); await revoked(f, oldJar); await stillNative(f);
});
for (const [name, body, status] of [['R2 local 400', { username: '!', password: PASSWORD }, 400], ['R3 password 401', { username: 'fictional-b', password: 'wrong-fictitious-password' }, 401]]) {
  test(name + ' stores initiating A while independent T never restores old authority', { timeout: 30000 }, async t => {
    const f = await fixture(t), source = await f.browser(), old = new Jar(source.jar), after = f.checkpoint();
    const result = await f.call(source.jar, '/auth/login', { csrf: source.csrf, body }); assert.equal(result.status, status); noAuthorityWrite(result);
    const operation = singleOperation(f, after, status); assert.equal(operation.actor_id, IDS.a); association(f, operation, source, status); assert.equal(f.openUsage(IDS.a).length, 0); await revoked(f, old); await stillNative(f);
  });
}
test('R4 real username limiter 429 still preserves A initiator and switch-user reason', { timeout: 40000 }, async t => {
  const f = await fixture(t);
  for (let i = 0; i < 6; i++) { const s = f.backend.createSession({ sourcePeer: 'owned-seed-peer' }); assert.equal((await s.dispatch({ path: '/auth/login', method: 'POST', body: { username: 'fictional-b', password: 'wrong-fictitious-password' } })).status, 401); await s.close(); }
  const source = await f.browser(), old = new Jar(source.jar), after = f.checkpoint(), result = await f.login(source.jar, source.csrf, 'b');
  assert.equal(result.status, 429); noAuthorityWrite(result); const operation = singleOperation(f, after, 429); assert.equal(operation.actor_id, IDS.a); association(f, operation, source, 429); await revoked(f, old); await stillNative(f);
});
test('R5 actual SQLite usage-start exception stores failed A relation and no published B or revived A', { timeout: 30000 }, async t => {
  const f = await fixture(t), source = await f.browser(), old = new Jar(source.jar), after = f.checkpoint();
  f.db.exec("CREATE TRIGGER synthetic_usage_failure BEFORE INSERT ON usage_sessions WHEN NEW.staff_id='" + IDS.b + "' BEGIN SELECT RAISE(ABORT,'synthetic usage start rejected'); END");
  const result = await f.login(source.jar, source.csrf, 'b'); assert.equal(result.status, 500); noAuthorityWrite(result);
  const operation = singleOperation(f, after, 500); assert.equal(operation.actor_id, IDS.a); association(f, operation, source, 500); assert.equal(f.openUsage(IDS.b).length, 0); await revoked(f, old); await stillNative(f);
});
test('R6 a trusted T factory exception cannot make the initiating attempt disappear from real audit storage', { timeout: 30000 }, async t => {
  const f = await fixture(t), source = await f.browser(), old = new Jar(source.jar), after = f.checkpoint(); f.failNextCreation();
  const result = await f.login(source.jar, source.csrf, 'b'); assert.equal(result.status, 500); noAuthorityWrite(result);
  const operation = singleOperation(f, after, 500); assert.equal(operation.actor_id, IDS.a); association(f, operation, source, 500); await revoked(f, old); await stillNative(f);
});
test('R7 HTTP actor and correlation claims cannot override the owned A initiator or authenticate as Native', { timeout: 30000 }, async t => {
  const f = await fixture(t), source = await f.browser(), after = f.checkpoint();
  const result = await f.call(source.jar, '/auth/login', { csrf: source.csrf, headers: { 'x-audit-actor': IDS.native, 'x-relogin-ticket': 'attacker-serialized-claim' }, body: { username: 'fictional-b', password: PASSWORD, actor: { id: IDS.native, role: 'admin' }, priorUser: { id: IDS.native }, reloginTicket: { actorId: IDS.native }, auditCorrelation: { actorId: IDS.native } } });
  assert.equal(result.status, 200); assert.equal(result.data.user.id, IDS.b); assert.equal(result.data.user.role, 'employee');
  const operation = singleOperation(f, after, 200); assert.equal(operation.actor_id, IDS.b); association(f, operation, source, 200, IDS.b); await stillNative(f);
});
test('R8 anonymous first failure and login never acquire a fictitious authenticated initiator from HTTP claims', { timeout: 30000 }, async t => {
  const f = await fixture(t), jar = new Jar(), boot = await f.bootstrap(jar); let after = f.checkpoint();
  const bad = await f.call(jar, '/auth/login', { csrf: boot.data.csrf, body: { username: 'fictional-missing', password: PASSWORD, actor: { id: IDS.a }, reloginTicket: { usageSessionId: f.nativeUsage } } });
  assert.equal(bad.status, 401); assert.equal(singleOperation(f, after, 401).actor_id, null); assert.equal(f.links().length, 0); noAuthorityWrite(bad);
  after = f.checkpoint(); const result = await f.login(jar, boot.data.csrf, 'b', { priorUser: { id: IDS.a } }); assert.equal(result.status, 200); assert.equal(singleOperation(f, after, 200).actor_id, IDS.b); assert.equal(f.links().length, 0); await stillNative(f);
});
test('R9 Native failure keeps its actual prior actor and does not close either independent browser usage', { timeout: 30000 }, async t => {
  const f = await fixture(t), a = await f.browser('a'), b = await f.browser('b'), after = f.checkpoint();
  const result = await f.backend.dispatch({ path: '/auth/login', method: 'POST', body: { username: '!', password: PASSWORD } }); assert.equal(result.status, 400);
  assert.equal(singleOperation(f, after, 400).actor_id, IDS.native); assert.equal(f.usage(f.nativeUsage).ended_reason, 'switch-user');
  for (const source of [a, b]) { assert.equal((await f.call(source.jar, '/auth/status')).data.user.id, source.user.id); assert.equal(f.usage(source.usage.id).ended_at, null); }
  assert.equal(f.links().length, 0, 'Native same-session login must not borrow a browser relogin association');
});
test('R10 switching A to sales-disabled C leaves Native and browser B intact without carrying A permissions', { timeout: 30000 }, async t => {
  const f = await fixture(t), source = await f.browser('a'), b = await f.browser('b'), after = f.checkpoint(), result = await f.login(source.jar, source.csrf, 'c');
  assert.equal(result.status, 200); assert.equal(result.data.user.id, IDS.c); assert.equal(result.data.user.moduleAccess.sales, 'disabled');
  assert.equal((await f.call(source.jar, '/api/customers/search?q=')).status, 403);
  assert.equal((await f.call(b.jar, '/auth/status')).data.user.id, IDS.b); assert.equal(f.usage(b.usage.id).ended_at, null);
  const operation = f.authOperations(after).find(row => row.status === 200); assert(operation); association(f, operation, source, 200, IDS.c); await stillNative(f);
});
test('R11 a genuinely late old-A logout cannot rewrite switch-user usage or terminate newly published B', { timeout: 30000 }, async t => {
  const f = await fixture(t), source = await f.browser(), after = f.checkpoint(), partial = f.partialLogout(source); await partial.entered;
  const result = await f.login(source.jar, source.csrf, 'b'); assert.equal(result.status, 200); const nextUsage = f.openUsage(IDS.b)[0]; assert(nextUsage);
  partial.finish(); const late = await partial.result; assert.equal(late.status, 401); noAuthorityWrite(late);
  const operation = singleOperation(f, after, 200); association(f, operation, source, 200, IDS.b); assert.equal(f.usage(nextUsage.id).ended_at, null); assert.equal((await f.call(source.jar, '/auth/status')).data.user.id, IDS.b); assert.equal(f.links().length, 1); await stillNative(f);
});
test('R12 late anonymous logout is unrelated to a successful initial A login and cannot manufacture a relogin source', { timeout: 30000 }, async t => {
  const f = await fixture(t), jar = new Jar(), boot = await f.bootstrap(jar), old = new Jar(jar), result = await f.login(jar, boot.data.csrf, 'a');
  assert.equal(result.status, 200); const active = f.openUsage(IDS.a)[0]; assert(active);
  const late = await f.call(old, '/auth/logout', { csrf: boot.data.csrf, body: {} }); assert.equal(late.status, 401); noAuthorityWrite(late);
  assert.equal((await f.call(jar, '/auth/status')).data.user.id, IDS.a); assert.equal(f.usage(active.id).ended_at, null); assert.equal(f.links().length, 0); await stillNative(f);
});
test('R13 authenticated failure uses A once, anonymous retries retain the real scope limit without inheriting A actor', { timeout: 40000 }, async t => {
  const f = await fixture(t), source = await f.browser(), old = new Jar(source.jar), after = f.checkpoint();
  const first = await f.call(source.jar, '/auth/login', { csrf: source.csrf, body: { username: 'scope-missing-0', password: PASSWORD } }); assert.equal(first.status, 401);
  const firstOperation = singleOperation(f, after, 401); assert.equal(firstOperation.actor_id, IDS.a); association(f, firstOperation, source, 401);
  for (let i = 1; i < 10; i++) { const boot = await f.bootstrap(source.jar), result = await f.call(source.jar, '/auth/login', { csrf: boot.data.csrf, body: { username: 'scope-missing-' + i, password: PASSWORD } }); assert.equal(result.status, 401); noAuthorityWrite(result); }
  const boot = await f.bootstrap(source.jar), blocked = await f.call(source.jar, '/auth/login', { csrf: boot.data.csrf, body: { username: 'scope-missing-10', password: PASSWORD } }); assert.equal(blocked.status, 429); noAuthorityWrite(blocked);
  const operations = f.authOperations(after); assert.equal(operations.length, 11); assert(operations.slice(1).every(row => row.actor_id === null)); assert.equal(f.links().length, 1);
  assert(f.db.prepare('SELECT * FROM login_failures WHERE failures=10').all().length >= 2, 'actual same-scope and source counters survive independent T objects'); await revoked(f, old); await stillNative(f);
});
test('R14 actual audit records contain no passwords, cookies, CSRF, password hashes or internal limiter scopes', { timeout: 30000 }, async t => {
  const f = await fixture(t), source = await f.browser(), after = f.checkpoint(), result = await f.login(source.jar, source.csrf, 'b'); assert.equal(result.status, 200);
  const operation = singleOperation(f, after, 200); association(f, operation, source, 200, IDS.b);
  const dump = JSON.stringify({ operations: f.db.prepare('SELECT * FROM operation_logs').all(), audits: f.db.prepare('SELECT * FROM audit_logs').all() });
  for (const secret of [...f.secrets, ...f.scopes]) assert.equal(dump.includes(secret), false, 'sensitive authority or credential text must not enter stored/exportable logs');
});

test('R15 noncanonical HTTP query actor claims are rejected before any accepted relogin or source revocation', { timeout: 30000 }, async t => {
  const f = await fixture(t), source = await f.browser(), after = f.checkpoint();
  const result = await f.call(source.jar, '/auth/login?actor=' + IDS.native + '&reloginTicket=serialized-claim', { csrf: source.csrf, body: { username: 'fictional-b', password: PASSWORD } });
  assert.equal(result.status, 400); noAuthorityWrite(result); assert.equal(f.authOperations(after).length, 0); assert.equal(f.links().length, 0);
  assert.equal(f.usage(source.usage.id).ended_at, null); assert.equal((await f.call(source.jar, '/auth/status')).data.user.id, IDS.a); await stillNative(f);
});


// Independent extra fault controls. The original R1-R15 and Root's revoked()
// helper above remain unchanged; these cases require their own Guest evidence.
const extraLoginInput = key => ({ path: '/auth/login', method: 'POST', body: { username: 'fictional-' + key, password: PASSWORD } });
const extraInternalRefusal = /relogin|ticket|owned|会话|票据|来源/i;
async function extraAssertAuditFailureStop(f, source, sourceInfo, oldJar, beforeCreations) {
  const ended = f.usage(source.usage.id);
  assert.equal(ended.id, source.usage.id); assert.equal(ended.staff_id, source.user.id); assert.equal(ended.started_at, source.usage.started_at);
  assert(ended.ended_at); assert.equal(ended.ended_reason, 'switch-user');
  assert.equal(sourceInfo.session.auth.status().authenticated, false, 'old owned A must have no current identity');
  assert.equal(sourceInfo.session.auth.sessionId, null, 'old A must retain no usage authority');
  assert.equal((await sourceInfo.session.dispatch({ path: '/api/bootstrap' })).status, 401, 'the real closed source rejects protected dispatch');
  assert.equal(f.sessionCreations, beforeCreations + 1, 'only one independent T; no retry allocation after trusted audit failure');
  const target = f.createdSessions.at(-1).session; assert.notEqual(target, sourceInfo.session);
  assert.equal(target.auth.status().authenticated, false, 'the unpublished T must really close');
  assert.equal(target.auth.sessionId, null); assert.equal((await target.dispatch({ path: '/api/bootstrap' })).status, 401);
  assert.equal(f.openUsage(IDS.a).length, 0); assert.equal(f.openUsage(IDS.b).length, 0);
  // Sticky failure-stop takes precedence over normal public anonymous status200.
  // Do not weaken or repurpose Root's original revoked() contract for this case.
  const count = f.sessionCreations;
  for (const address of ['/auth/status', '/api/bootstrap']) {
    const response = await f.call(oldJar, address); assert.equal(response.status, 503); assert.equal(response.data.user, undefined); assert.equal(response.cookies.length, 0); noAuthorityWrite(response);
  }
  assert.equal(f.sessionCreations, count, 'failed-state stale reads allocate nothing');
  await stillNative(f);
}

test('E16 Native usage INSERT exception returns500 with no residual B identity or usage authority', { timeout: 30000 }, async t => {
  const f = await fixture(t), browser = await f.browser('a'), after = f.checkpoint();
  f.db.exec("CREATE TRIGGER extra_native_usage_abort BEFORE INSERT ON usage_sessions WHEN NEW.staff_id='" + IDS.b + "' BEGIN SELECT RAISE(ABORT,'synthetic Native usage start rejected'); END");
  const result = await f.backend.dispatch(extraLoginInput('b')); assert.equal(result.status, 500);
  const status = f.backend.auth.status();
  assert.equal(status.authenticated, false, 'failed Native session establishment must not leave verified B authenticated');
  assert.equal(status.user, undefined); assert.equal(f.backend.auth.sessionId, null, 'a failed INSERT must not leave a non-persisted usage UUID as authority');
  assert.equal(f.openUsage(IDS.b).length, 0); assert.equal(f.usage(f.nativeUsage).ended_reason, 'switch-user');
  assert.equal(singleOperation(f, after, 500).actor_id, IDS.native);
  assert.equal((await f.call(browser.jar, '/auth/status')).data.user.id, IDS.a); assert.equal(f.usage(browser.usage.id).ended_at, null);
});

for (const [number, table, mode] of [[17, 'operation_logs', 'ABORT'], [18, 'operation_logs', 'IGNORE'], [19, 'audit_logs', 'ABORT'], [20, 'audit_logs', 'IGNORE']]) {
  test('E' + number + ' actual ' + table + ' ' + mode + ' rolls back both audit rows, returns503, publishes no T and revokes A', { timeout: 30000 }, async t => {
    const f = await fixture(t), source = await f.browser('a'), sourceInfo = f.ownedInfo(source.usage.id), oldJar = new Jar(source.jar), after = f.checkpoint(), beforeCreations = f.sessionCreations;
    const linkCount = f.links().length, condition = table === 'operation_logs' ? "NEW.action='auth.login'" : "NEW.entity_type='auth-relogin'";
    const raise = mode === 'ABORT' ? "RAISE(ABORT,'synthetic trusted audit insert rejected')" : 'RAISE(IGNORE)';
    f.db.exec('CREATE TRIGGER extra_audit_' + number + ' BEFORE INSERT ON ' + table + ' WHEN ' + condition + ' BEGIN SELECT ' + raise + '; END');
    try {
      const result = await f.login(source.jar, source.csrf, 'b'); assert.equal(result.status, 503); noAuthorityWrite(result); assert.equal(result.data.user, undefined);
      assert.equal(f.authOperations(after).length, 0, 'neither an ignored/aborted operation nor a rolled-back partial operation may remain');
      assert.equal(f.links().length, linkCount, 'the paired trusted association must also roll back');
      await extraAssertAuditFailureStop(f, source, sourceInfo, oldJar, beforeCreations);
    } finally {
      await f.closeExpectedFailureStop();
    }
  });
}

test('E21 direct opaque ticket rejects clones, mismatched targets and concurrent/replayed credential use without duplicate audit', { timeout: 40000 }, async t => {
  const f = await fixture(t), source = await f.browser('a'), info = f.ownedInfo(source.usage.id), api = f.backend.reloginAudit, ticket = api.capture(info.session);
  assert(ticket); assert(Object.isFrozen(ticket)); assert.equal(Object.getPrototypeOf(ticket), null);
  assert.throws(() => api.capture(info.session), extraInternalRefusal, 'one pending ticket per owned source');
  const clone = JSON.parse(JSON.stringify(ticket));
  assert.throws(() => api.closeSource(clone), extraInternalRefusal, 'serialized data is not a server ticket');
  assert.throws(() => api.fail(clone, 401), extraInternalRefusal);
  assert.equal(info.session.auth.status().user.id, IDS.a, 'rejected forged calls cannot change source identity');
  await api.closeSource(ticket);
  for (const options of [{ ...info.options, loginScopeId: crypto.randomUUID() }, { ...info.options, sourcePeer: 'different-owned-peer' }]) {
    const wrong = f.backend.createSession(options); assert.throws(() => api.attach(ticket, wrong), extraInternalRefusal); assert.equal(wrong.auth.status().authenticated, false); await wrong.close();
  }
  const closed = f.backend.createSession(info.options); await closed.close(); assert.throws(() => api.attach(ticket, closed), extraInternalRefusal);
  const authenticated = f.backend.createSession(info.options); assert.equal((await authenticated.dispatch(extraLoginInput('b'))).status, 200); assert.throws(() => api.attach(ticket, authenticated), extraInternalRefusal); await authenticated.close();
  const target = f.backend.createSession(info.options), other = f.backend.createSession(info.options), after = f.checkpoint();
  api.attach(ticket, target); assert.throws(() => api.attach(ticket, other), extraInternalRefusal, 'a second target cannot consume the same ticket');
  const first = target.dispatch(extraLoginInput('b')), concurrentReplay = target.dispatch(extraLoginInput('b'));
  await assert.rejects(concurrentReplay, /one credential check|票据|一次|relogin/i);
  const result = await first; assert.equal(result.status, 200); assert.equal(result.data.user.id, IDS.b);
  const operation = singleOperation(f, after, 200); association(f, operation, source, 200, IDS.b);
  const beforeOperations = f.authOperations(after).length, beforeLinks = f.links().length;
  assert.throws(() => api.attach(ticket, other), extraInternalRefusal, 'completed ticket cannot attach again');
  assert.throws(() => api.closeSource(ticket), extraInternalRefusal, 'completed ticket cannot reopen or re-close its source');
  await api.fail(ticket, 401); await api.fail(ticket, 500); // Completion repeats are idempotent, never new authority.
  assert.equal(f.authOperations(after).length, beforeOperations); assert.equal(f.links().length, beforeLinks);
  assert.equal(info.session.auth.status().authenticated, false); assert.equal(info.session.auth.sessionId, null);
  await target.close(); await other.close(); await revoked(f, new Jar(source.jar)); await stillNative(f);
});

test('E22 a ticket and owned source cannot cross real backend instances even with matching fictitious account IDs and scope', { timeout: 40000 }, async t => {
  const f = await fixture(t), foreign = await fixture(t), source = await f.browser('a'), info = f.ownedInfo(source.usage.id), api = f.backend.reloginAudit, otherApi = foreign.backend.reloginAudit;
  const after = f.checkpoint(), foreignAfter = foreign.checkpoint(), ticket = api.capture(info.session);
  const foreignTarget = foreign.backend.createSession(info.options), localTarget = f.backend.createSession(info.options);
  assert.throws(() => otherApi.capture(info.session), extraInternalRefusal, 'a foreign source is never owned');
  assert.throws(() => otherApi.closeSource(ticket), extraInternalRefusal);
  assert.throws(() => otherApi.attach(ticket, foreignTarget), extraInternalRefusal);
  assert.throws(() => otherApi.fail(ticket, 401), extraInternalRefusal);
  await api.closeSource(ticket);
  assert.throws(() => api.attach(ticket, foreignTarget), extraInternalRefusal, 'matching IDs/scope do not replace instance ownership');
  assert.throws(() => otherApi.attach(ticket, localTarget), extraInternalRefusal);
  assert.equal(f.authOperations(after).length, 0); assert.equal(f.links().length, 0); assert.equal(foreign.authOperations(foreignAfter).length, 0); assert.equal(foreign.links().length, 0);
  assert.equal(localTarget.auth.status().authenticated, false); assert.equal(foreignTarget.auth.status().authenticated, false);
  await api.fail(ticket, 401); const operation = singleOperation(f, after, 401); assert.equal(operation.actor_id, IDS.a); association(f, operation, source, 401);
  assert.equal(foreign.links().length, 0); assert.equal(foreign.authOperations(foreignAfter).length, 0);
  await localTarget.close(); await foreignTarget.close(); await revoked(f, new Jar(source.jar)); await stillNative(f); await stillNative(foreign);
});

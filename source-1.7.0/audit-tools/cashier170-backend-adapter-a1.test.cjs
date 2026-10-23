'use strict';

// Real backend/session/administration/audit SQL; only the sidecar transport is
// observed. These contracts do not execute a cash transaction or start an EXE.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
if (process.platform !== 'win32' || os.userInfo().username.toLowerCase() !== 'wdagutilityaccount' || ROOT.toLowerCase() !== 'c:\\xjy-work\\xjy-web-stage1') throw Error('Cashier backend contracts require the fixed actual offline Windows Sandbox');
const guardFile = path.join(ROOT, 'stage1/guest-candidate-cdp.cjs');
if (crypto.createHash('sha256').update(fs.readFileSync(guardFile)).digest('hex') !== '59840b638d8797fb55241616cd0b8e4098075a76834a201b0e93c1a748f1bb32') throw Error('Actual Sandbox guard source changed');
require(guardFile).actualGuard();
const guard = require('../stage1/isolation.cjs').createIsolationGuard(ROOT);
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm');
const { createRequire } = require('node:module'), { DatabaseSync } = require('node:sqlite');
const CODE = guard.assertPath(path.join(ROOT, 'project/desktop/backend.cjs')), realRequire = createRequire(CODE), loaded = { exports: {} };
vm.runInThisContext('(function(require,module,exports,__filename,__dirname){\n' + fs.readFileSync(CODE, 'utf8') + '\n})', { filename: CODE })(name => name === './runtime.cjs' ? { createRuntime() { throw Error('FILE_DATABASE_RUNTIME_MUST_NOT_RUN'); } } : realRequire(name), loaded, loaded.exports, CODE, path.dirname(CODE));
const ID = '40000000-0000-4000-8000-000000000010', OTHER = '40000000-0000-4000-8000-000000000011';
const PASSWORD = 'Synthetic-Cashier-Backend-2026!', SALT = 'fixture-cashier-only', DATE = '2026-10-19T12:00:00.000Z';
const CAPS = ['cashier.read', 'cashier.amounts.sensitive', 'cashier.documents.prepare'];
function body(kind = 'receive') { return { requestId: '40000000-0000-4000-8000-000000000002', kind, accountId: OTHER, businessDate: '2026-10-19', amountCents: '100', allocations: [{ releaseId: OTHER, amountCents: '100' }], note: '仅传输合同，不记账' }; }
function request(url = '/cashier/api/bootstrap', method = 'GET', value, module = 'cashier') {
  return { path: '/api/internal-modules/proxy', method: 'POST', body: { module, path: url, method,
    ...(value === undefined ? {} : { headers: { 'content-type': 'application/json' }, bodyBase64: Buffer.from(JSON.stringify(value)).toString('base64') }) } };
}
async function fixture(t, { cashier = 'operate', ledger = 'disabled', caps = CAPS, withAdapter = true } = {}) {
  const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON');
  const migrations = guard.assertPath(path.join(ROOT, 'project/desktop/migrations'));
  for (const file of fs.readdirSync(migrations).filter(file => /^\d{4}_[a-z0-9_]+\.sql$/.test(file)).sort()) db.exec(fs.readFileSync(guard.assertPath(path.join(migrations, file)), 'utf8'));
  db.exec('CREATE TABLE local_accounts(staff_id TEXT PRIMARY KEY,username TEXT UNIQUE,password_salt TEXT,password_hash TEXT,created_at TEXT,updated_at TEXT)');
  db.prepare('INSERT INTO staff_users VALUES(?,?,?,?,?,1,?,?)').run(ID, 'synthetic-' + ID, 'cashier@example.invalid', '虚构出纳', 'employee', DATE, DATE);
  db.prepare('INSERT INTO local_accounts VALUES(?,?,?,?,?,?)').run(ID, 'synthetic-cashier', SALT, crypto.scryptSync(PASSWORD, SALT, 64).toString('hex'), DATE, DATE);
  db.prepare('INSERT INTO module_permissions VALUES(?,?,?,?,?,?)').run(ID, 'disabled', ledger, 'disabled', 1, DATE);
  db.prepare('INSERT INTO cashier_module_permissions(staff_id,level,updated_at) VALUES(?,?,?)').run(ID, cashier, DATE);
  const saveCaps = value => db.prepare('INSERT OR REPLACE INTO staff_capabilities VALUES(?,?,?)').run(ID, JSON.stringify(Object.fromEntries(value.map(key => [key, true]))), DATE);
  saveCaps(caps);
  const directory = guard.assertPath(path.join(ROOT, 'runtime/cashier170-backend-adapter-a1', crypto.randomUUID())); fs.mkdirSync(directory, { recursive: true });
  let runtimeClosed = false;
  const runtime = { sqlite: db, dataDir: directory, withIdentity: (_identity, action) => action(), close() { if (!runtimeClosed) { runtimeClosed = true; db.close(); } } };
  const calls = [], sent = [], hooks = {};
  const moduleAdapter = {
    status() { return { dataDir: 'SECRET-ROOT', users: [{ name: 'SECRET-OLD-USER' }], modules: [{ id: 'ledger', label: '财务系统', version: '1.3.0', configured: true, running: true, dataDir: 'SECRET-LEDGER-DIR', users: ['SECRET-OLD-USER'], error: 'SECRET-STORAGE-DIAGNOSTIC' }, { id: 'inventory', label: '库管管理', version: '1.9.0', configured: true, running: false, dataDir: 'SECRET-INVENTORY-DIR' }] }; },
    async proxy(input, authority) {
      calls.push({ input, actor: authority.actor });
      if (hooks.beforeActor) await hooks.beforeActor(input, authority);
      const actor = await authority.getActor(); sent.push({ input, actor });
      if (hooks.afterActor) await hooks.afterActor(input, actor);
      return { status: 200, headers: { 'content-type': 'application/json' }, bodyBase64: Buffer.from('{"ok":true}').toString('base64'), outcome: 'success' };
    },
    createData() { throw Error('CASHIER_MUST_NOT_INITIALIZE'); }, start() { throw Error('BACKEND_MUST_USE_EXISTING_PROXY'); },
  };
  const backend = loaded.exports.createBackend({ dataDir: directory, migrationDir: migrations, runtimeFactory: () => runtime, businessCore: {}, pollsAdapter: {}, aiAdapter: {}, ...(withAdapter ? { moduleAdapter } : {}) });
  t.after(() => backend.close());
  const session = backend.createSession({ sourcePeer: 'fictional-cashier-contract' });
  assert.equal((await session.dispatch({ path: '/auth/login', method: 'POST', body: { username: 'synthetic-cashier', password: PASSWORD } })).status, 200);
  return { db, backend, session, calls, sent, hooks, saveCaps, call: value => session.dispatch(value) };
}

test('B01 cashier-only session uses ledger storage with an unchanged independent cashier principal', async t => {
  const f = await fixture(t), result = await f.call(request('/cashier/api/documents', 'POST', body()));
  assert.equal(result.status, 200); assert.equal(f.sent.length, 1);
  const { input, actor } = f.sent[0]; assert.equal(input.module, 'ledger'); assert.equal(input.path, '/cashier/api/documents');
  assert.equal(actor.module, 'cashier'); assert.equal(actor.authorityModule, 'cashier'); assert.equal(actor.storageModule, 'ledger'); assert.equal(actor.protocolVersion, 3);
  assert.equal(actor.staffId, ID); assert.equal(actor.access, 'operate'); assert.deepEqual(actor.capabilities, CAPS);
  assert(!Object.hasOwn(actor, 'accountIds')); assert(!Object.hasOwn(actor, 'scopeRevision'));
  assert.equal(f.db.prepare('SELECT ledger FROM module_permissions WHERE staff_id=?').get(ID).ledger, 'disabled');
});
test('B02 every transport getActor rereads capability grants before sending', async t => {
  const f = await fixture(t); f.hooks.beforeActor = async (_input, authority) => { assert((await authority.getActor()).capabilities.includes('cashier.documents.prepare')); f.saveCaps(['cashier.read']); };
  assert.equal((await f.call(request('/cashier/api/documents', 'POST', body()))).status, 403); assert.equal(f.calls.length, 1); assert.equal(f.sent.length, 0);
});
test('B03 ledger ERP grants never substitute for a disabled cashier grant', async t => {
  const f = await fixture(t, { cashier: 'disabled', ledger: 'manage', caps: [...CAPS, 'erp.read', 'erp.cashier.release'] });
  assert.equal((await f.call(request())).status, 403); assert.equal(f.calls.length, 0);
});
test('B04 cashier cannot address ERP financial lifecycle or arbitrary paths', async t => {
  const f = await fixture(t);
  for (const route of ['/erp/api/bootstrap', '/finance', '/_xjy/initialize', '/_xjy/shutdown', '/xjy/collaboration/source', '/static/anything.js']) assert([400, 403].includes((await f.call(request(route))).status), route);
  assert.equal(f.calls.length, 0);
});
test('B05 ordinary ledger principal cannot borrow cashier paths', async t => {
  const f = await fixture(t, { ledger: 'manage', caps: [...CAPS, 'erp.read'] });
  assert.equal((await f.call(request('/cashier/api/accounts', 'GET', undefined, 'ledger'))).status, 403); assert.equal(f.calls.length, 0);
});
test('B06 ended session during module startup never obtains a fresh principal', async t => {
  const f = await fixture(t); f.hooks.beforeActor = () => f.session.auth.logout();
  assert.equal((await f.call(request())).status, 401); assert.equal(f.sent.length, 0);
});
test('B07 status exposes a separate cashier row without disabled storage directories or legacy users', async t => {
  const f = await fixture(t), result = await f.call({ path: '/api/internal-modules/status', method: 'GET' });
  assert.equal(result.status, 200); assert(!JSON.stringify(result.data).includes('SECRET'));
  const cash = result.data.modules.find(item => item.id === 'cashier'), ledger = result.data.modules.find(item => item.id === 'ledger');
  assert.equal(cash.access, 'operate'); assert.equal(cash.configured, true); assert.equal(cash.running, true);
  assert.equal(ledger.access, 'disabled'); assert.equal(ledger.configured, false); assert.equal(ledger.running, false);
});
test('B08 cashier proxy outcome is audited under cashier rather than sales or ledger', async t => {
  const f = await fixture(t); assert.equal((await f.call(request('/cashier/api/documents', 'POST', body()))).status, 200);
  const rows = f.db.prepare('SELECT module,resource,success FROM operation_logs WHERE actor_id=? AND resource=?').all(ID, '/cashier/api/documents');
  assert(rows.some(row => row.module === 'cashier' && row.success === 1)); assert(!rows.some(row => row.module === 'sales' || row.module === 'ledger'));
});
test('B09 late capability revocation prevents response exposure', async t => {
  const f = await fixture(t); f.hooks.afterActor = () => f.saveCaps(['cashier.read']);
  assert.equal((await f.call(request('/cashier/api/documents', 'POST', body()))).status, 403); assert.equal(f.sent.length, 1);
});
test('B10 queued cashier snapshot binds both transport and audit despite caller mutation', async t => {
  const f = await fixture(t), value = request('/cashier/api/documents', 'POST', body());
  f.hooks.beforeActor = () => { value.body.module = 'ledger'; value.body.path = '/finance'; value.body.bodyBase64 = ''; };
  assert.equal((await f.call(value)).status, 200); assert.equal(f.sent[0].input.path, '/cashier/api/documents'); assert(f.sent[0].input.bodyBase64);
  assert(f.db.prepare('SELECT 1 FROM operation_logs WHERE module=? AND resource=?').get('cashier', '/cashier/api/documents'));
});
test('B11 view cashier cannot write even with stale write capability booleans', async t => {
  const f = await fixture(t, { cashier: 'view' });
  assert.equal((await f.call(request('/cashier/api/accounts'))).status, 200);
  assert.equal((await f.call(request('/cashier/api/documents', 'POST', body()))).status, 403); assert.equal(f.sent.length, 1);
});
test('B12 missing module adapter is a controlled failure and cannot initialize a ledger', async t => {
  const f = await fixture(t, { withAdapter: false });
  assert.equal((await f.call(request())).status, 503); assert.equal(f.calls.length, 0);
});
test('B13 ordinary ERP reads retain their ledger protocol2 authority', async t => {
  const f = await fixture(t, { cashier: 'disabled', ledger: 'view', caps: ['erp.read'] });
  assert.equal((await f.call(request('/erp/api/bootstrap', 'GET', undefined, 'ledger'))).status, 200);
  assert.equal(f.sent[0].input.module, 'ledger'); assert.equal(f.sent[0].actor.module, 'ledger'); assert.equal(f.sent[0].actor.protocolVersion, 2);
  assert.deepEqual(f.sent[0].actor.capabilities, ['erp.read']); assert(!Object.hasOwn(f.sent[0].actor, 'authorityModule')); assert(!Object.hasOwn(f.sent[0].actor, 'storageModule'));
});
test('B14 cashier source publication cannot borrow ledger authority in either virtual module form', async t => {
  const f = await fixture(t);
  const release = { requestId: OTHER, billId: OTHER, revision: 1, hash: 'a'.repeat(64), note: '虚构来源，禁止发布' };
  assert.equal((await f.call(request('/erp/api/cashier-source-releases', 'POST', release, 'ledger'))).status, 403);
  assert([400, 403].includes((await f.call(request('/erp/api/cashier-source-releases', 'POST', release))).status));
  assert.equal(f.calls.length, 0);
});

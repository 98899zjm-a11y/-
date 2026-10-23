'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { AsyncLocalStorage } = require('node:async_hooks');
const { DatabaseSync } = require('node:sqlite');
const { randomUUID, scryptSync, createHash } = require('node:crypto');
const { createPrintComposition, toAgentPresentation } = require('../project/desktop/print-composition.cjs');
const { fingerprintPrintPayload } = require('../project/desktop/print-agent.cjs');
const ROOT = path.resolve(__dirname, '../runtime/central-backend-tests');
const CODE = path.resolve(__dirname, '../project/desktop/backend.cjs');
const realRequire = createRequire(CODE);
const BACKEND = { exports: {} };
// The original runtime factory is a hard trap: even a failing RED run cannot
// open a file database. The real backend constructor/session logic is executed.
vm.runInNewContext(fs.readFileSync(CODE, 'utf8'), { module: BACKEND, exports: BACKEND.exports, require: address => address === './runtime.cjs' ? { createRuntime: () => { throw new Error('FILE_DATABASE_RUNTIME_MUST_NOT_RUN'); } } : realRequire(address), __dirname: path.dirname(CODE), Buffer, Request, Response, URL, URLSearchParams, setImmediate, setTimeout, clearTimeout, console }, { filename: CODE });
const { createBackend } = BACKEND.exports;
const S = { admin: '10000000-0000-4000-8000-000000000001', sales: '10000000-0000-4000-8000-000000000002', finance: '10000000-0000-4000-8000-000000000003', inventory: '10000000-0000-4000-8000-000000000004', readonly: '10000000-0000-4000-8000-000000000005' };
const Q = '20000000-0000-4000-8000-000000000001';
const PWD = 'FixturePassword-2026!';
const SALT = 'owned-fake-salt';
const PASSWORD_HASH = scryptSync(PWD, SALT, 64).toString('hex');
const stable = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const sha = value => createHash('sha256').update(value).digest('hex');
const tick = () => new Promise(resolve => setImmediate(resolve));
function request(source, extras = {}) { return { version: 2, requestId: randomUUID(), source, copies: 1, ...extras }; }
async function fixture(t, options = {}) {
  fs.mkdirSync(ROOT, { recursive: true });
  const directory = fs.mkdtempSync(path.join(ROOT, 'run-'));
  assert.equal(path.dirname(directory), ROOT);
  const db = new DatabaseSync(':memory:');
  for (const name of fs.readdirSync(path.resolve(__dirname, '../project/desktop/migrations')).filter(name => /^\d+_[\w-]+\.sql$/.test(name)).sort()) db.exec(fs.readFileSync(path.resolve(__dirname, '../project/desktop/migrations', name), 'utf8'));
  db.exec('CREATE TABLE local_accounts(staff_id TEXT PRIMARY KEY,username TEXT UNIQUE,password_salt TEXT,password_hash TEXT,created_at TEXT,updated_at TEXT);');
  for (const [name, id] of Object.entries(S)) {
    const date = '2026-10-14T00:00:00Z';
    db.prepare('INSERT INTO staff_users VALUES(?,?,?,?,?,?,?,?)').run(id, 'local-' + id, name, '虚构-' + name, name === 'admin' ? 'admin' : 'employee', 1, date, date);
    db.prepare('INSERT INTO local_accounts VALUES(?,?,?,?,?,?)').run(id, name, SALT, PASSWORD_HASH, date, date);
    const access = name === 'admin' ? ['manage', 'manage', 'manage'] : name === 'sales' ? ['operate', 'disabled', 'disabled'] : name === 'finance' ? ['disabled', 'operate', 'disabled'] : name === 'inventory' ? ['disabled', 'disabled', 'operate'] : ['view', 'view', 'view'];
    db.prepare('INSERT INTO module_permissions VALUES(?,?,?,?,?,?)').run(id, ...access, 1, date);
    db.prepare('INSERT INTO staff_capabilities VALUES(?,?,?)').run(id, JSON.stringify({ 'erp.read': true, 'erp.reports.view': true, 'erp.reports.sensitive': false }), date);
  }
  const context = new AsyncLocalStorage(); let runtimeClosed = false;
  const runtime = { sqlite: db, dataDir: directory, withIdentity: (identity, action) => context.run(identity, action), getIdentity: () => context.getStore() ?? null, close: () => { if (!runtimeClosed) { runtimeClosed = true; db.close(); } } };
  const preferences = new Map(), coreCalls = [], printed = [], moduleCalls = [], memorySettings = { mode: 'fields', widthMm: 180, heightMm: 240, offsetXmm: 1, offsetYmm: 2, scalePercent: 95, phone: '010-old', standard: '原标准', afterSalesWechat: 'old-contact', layoutOffsets: {}, fontSizes: {} };
  let day = '2026-10-14', backend, active = 0, maxActive = 0, gateHook, moduleReadHook, nativeSubmitHook;
  const currentUser = () => { const identity = runtime.getIdentity(); assert(identity?.userId, 'core calls must run in their actual session identity'); const row = db.prepare('SELECT * FROM staff_users WHERE user_id=?').get(identity.userId); assert(row, 'core identity must be a fixture staff member'); return { id: row.id, userId: row.user_id, name: row.name, role: row.role, active: Boolean(row.active) }; };
  const businessCore = {
    authenticated: async () => ({ user: currentUser() }),
    getQuote: async id => { const user = currentUser(); coreCalls.push({ type: 'quote', user: user.id, id }); if (id !== Q || user.id !== S.sales && user.role !== 'admin') { const error = new Error('报价不可访问'); error.status = 403; throw error; } return { quote: { id, number: 'FAKE-1', type: 'sale', createdAt: '2026-10-14T00:00:00Z', snapshot: { customer: { name: '虚构客户' }, saleItems: [{ productName: '素链', weight: 1.234, amount: 456.78 }], total: 456.78 } } }; },
    getWarrantyPreferences: async () => preferences.get(currentUser().id) || { phone: '', afterSalesWechat: '', inherited: true },
    updateWarrantyPreferences: async req => { const value = await req.json(); preferences.set(currentUser().id, { phone: value.phone, afterSalesWechat: value.afterSalesWechat, inherited: false }); },
    getPreferences: async () => ({ marker: 'original-business-request', staffId: currentUser().id }),
    api: async (action, status = 200) => { try { return Response.json(await action(), { status }); } catch (error) { return Response.json({ error: error.message }, { status: error.status || 500 }); } },
  };
  const moduleAdapter = { proxy: async (input, authority) => { await tick(); const actor = await authority.getActor(); moduleCalls.push({ input, actor }); moduleReadHook?.(moduleCalls.length); if (input.path.startsWith('/erp/api/reports')) return { status: 200, headers: { 'content-type': 'application/json' }, bodyBase64: Buffer.from(JSON.stringify({ ok: true, report: { asOf: new URL(input.path, 'http://fixture.invalid').searchParams.get('asOf') || day, amountCents: 45678, rows: [] } })).toString('base64') }; if (input.path.startsWith('/erp/api/documents/')) return { status: 200, headers: { 'content-type': 'application/json' }, bodyBase64: Buffer.from(JSON.stringify({ ok: true, document: { id: input.path.split('/').at(-1), kind: options.documentKind || 'receivable', payload: { note: '原业务备注' }, amountCents: 45678, lines: [] } })).toString('base64') }; if (input.path.startsWith('/reports/pdf?')) return { status: 200, headers: { 'content-type': 'application/pdf' }, bodyBase64: Buffer.from('%PDF-1.7\nFAKE original finance\n%%EOF').toString('base64') }; if (input.path === '/api/metal-stats') return { status: 200, headers: { 'content-type': 'application/json' }, bodyBase64: Buffer.from(JSON.stringify({ rows: [], totals: [], grades: [] })).toString('base64') }; return { status: 200, headers: { 'content-type': 'text/html' }, bodyBase64: Buffer.from('<html><body>虚构盘点表</body></html>').toString('base64') }; } };
  let legacyCalls = 0;
  options.seed?.({ db, directory });
  const printServices = options.unavailable ? undefined : ({ administration, loadActor }) => {
    const composition = createPrintComposition({
      core: businessCore, moduleAdapter, loadActor, withIdentity: runtime.withIdentity,
      authorizeSource: (actor, rule) => { administration.requireAccess(actor, rule.module, 'operate'); for (const key of rule.capabilities) administration.requireCapability(actor, key, { readOnly: true }); return true; },
      authorizeModule: (actor, rule) => administration.requireAccess(actor, rule.module, rule.level),
      routing: { getProfiles: () => ({ revision: 1, warranty: { deviceName: 'Fixture EPSON', paper: { widthMm: 180, heightMm: 240 } }, a4: { deviceName: 'Fixture Deli', paper: 'A4' } }), getOptions: async () => ({ canManage: false, profiles: { warranty: {}, a4: {} }, printers: [] }) },
      enumerate: async () => [{ name: 'Fixture EPSON' }, { name: 'Fixture Deli' }], defaultsProvider: () => ({ phone: memorySettings.phone, standard: memorySettings.standard, afterSalesWechat: memorySettings.afterSalesWechat }), clock: () => new Date(day + 'T01:00:00Z'),
    });
    return { ...composition, agentTimeoutMs: options.agentTimeoutMs, fingerprintPayload: fingerprintPrintPayload, getWarrantyDefaults: () => ({ phone: memorySettings.phone, standard: memorySettings.standard, afterSalesWechat: memorySettings.afterSalesWechat }), capturePresentation: (kind, presentation, route, copies) => toAgentPresentation(kind, presentation, { settings: memorySettings, route, copies }), agent: { print: async (payload, control) => { active++; maxActive = Math.max(active, maxActive); try { if (options.hold) await options.hold; if (gateHook) await gateHook(payload); const receipt = await control.assertAuthorized(); nativeSubmitHook?.(payload, receipt); printed.push(payload); return { status: 'submitted' }; } finally { active--; } } } };
  };
  const argumentsForBackend = { dataDir: directory, migrationDir: path.resolve(__dirname, '../project/desktop/migrations'), runtimeFactory: () => runtime, businessCore, moduleAdapter, pollsAdapter: {}, aiAdapter: {}, printServices, printAdapter: { getOptions: async () => { legacyCalls++; throw new Error('old sender must never exist'); }, print: async () => { legacyCalls++; throw new Error('old sender must never exist'); } } };
  t.after(async () => { if (backend) await backend.close(); else runtime.close(); });
  assert.doesNotThrow(() => { backend = createBackend(argumentsForBackend); }, 'trusted in-memory runtime injection must bypass the file database factory');
  const sessions = new Map();
  for (const name of Object.keys(S)) { const session = backend.createSession({ sourcePeer: 'owned-test' }); const result = await session.dispatch({ path: '/auth/login', method: 'POST', body: { username: name, password: PWD } }); assert.equal(result.status, 200); sessions.set(name, session); }
  return { backend, db, runtime, directory, sessions, printed, moduleCalls, coreCalls, memorySettings, maxActive: () => maxActive, legacyCalls: () => legacyCalls, setDay: value => { day = value; }, setGateHook: value => { gateHook = value; }, setModuleReadHook: value => { moduleReadHook = value; }, setNativeSubmitHook: value => { nativeSubmitHook = value; }, submit: (name, body) => sessions.get(name).dispatch({ path: '/api/print-jobs', method: 'POST', body }), drain: () => backend.printing.drain() };
}

test('default backend is explicitly unavailable without constructing an old physical sender', async t => {
  const f = await fixture(t, { unavailable: true });
  const options = await f.sessions.get('sales').dispatch({ path: '/api/print-options' }); assert.equal(options.status, 200); assert.equal(options.data.available, false); assert.equal(options.data.types.warranty.available, false);
  assert.equal((await f.submit('sales', request({ type: 'quotation-a4', quoteId: Q }))).status, 503); assert.equal(f.legacyCalls(), 0);
});

test('the unavailable backend still exposes retained history only to its owner or an admin', async t => {
  const id = randomUUID(), requestId = randomUUID();
  const f = await fixture(t, { unavailable: true, seed: ({ directory }) => fs.writeFileSync(directory + '.print-ledger.json', JSON.stringify({ version: 1, jobs: [{ id, actorId: S.sales, requestId, quoteId: Q, kind: 'quotation-a4', paramsHash: 'a'.repeat(64), status: 'submitted', createdAt: '2026-10-14T00:00:00Z', updatedAt: '2026-10-14T00:00:00Z' }] })) });
  const own = await f.sessions.get('sales').dispatch({ path: '/api/print-jobs/by-request/' + requestId }); assert.equal(own.status, 200); assert.equal(own.data.job.status, 'submitted');
  assert.equal((await f.sessions.get('finance').dispatch({ path: '/api/print-jobs/' + id })).status, 404);
  const list = await f.sessions.get('admin').dispatch({ path: '/api/print-jobs/list' }); assert.equal(list.data.total, 1); assert.equal(f.legacyCalls(), 0);
});

test('actual backend sessions submit finance and inventory without sales access or nested queue deadlock', async t => {
  const f = await fixture(t);
  const jobs = await Promise.race([Promise.all([f.submit('finance', request({ type: 'erp-report-a4', filters: {} })), f.submit('inventory', request({ type: 'inventory-count-a4', id: 12, blind: '1' }))]), new Promise((_resolve, reject) => setTimeout(() => reject(new Error('PRINT_DISPATCH_DEADLOCK')), 1000))]);
  assert.deepEqual(jobs.map(job => job.status), [201, 201]); await f.drain(); assert.equal(f.printed.length, 2); assert.equal(f.maxActive(), 1); assert.equal(f.legacyCalls(), 0);
  assert.deepEqual(f.moduleCalls.map(call => call.actor.staffId).filter((id, index, all) => all.indexOf(id) === index).sort(), [S.finance, S.inventory].sort());
  assert.equal((await f.submit('finance', request({ type: 'quotation-a4', quoteId: Q }))).status, 403);
});

test('view-only actors cannot submit or see an enabled physical print type', async t => {
  const f = await fixture(t);
  for (const source of [{ type: 'quotation-a4', quoteId: Q }, { type: 'erp-report-a4', filters: {} }, { type: 'inventory-count-a4', id: 12 }]) assert.equal((await f.submit('readonly', request(source))).status, 403);
  const options = await f.sessions.get('readonly').dispatch({ path: '/api/print-options' }); assert.equal(options.data.available, false); assert.deepEqual(options.data.sourceTypes, []); assert.equal(f.printed.length, 0);
});

test('the private session actor rejects caller identity fields and separates UUID namespaces', async t => {
  const f = await fixture(t), id = randomUUID();
  assert.equal((await f.submit('finance', { ...request({ type: 'erp-report-a4', filters: {} }), actor: { id: S.admin, role: 'admin' } })).status, 400);
  const [a, b] = await Promise.all([f.submit('finance', request({ type: 'erp-report-a4', filters: {} }, { requestId: id })), f.submit('inventory', request({ type: 'inventory-count-a4', id: 12 }, { requestId: id }))]);
  assert.notEqual(a.data.job.id, b.data.job.id); await f.drain();
  assert.equal((await f.sessions.get('finance').dispatch({ path: '/api/print-jobs/' + b.data.job.id })).status, 404);
  const own = await f.sessions.get('finance').dispatch({ path: '/api/print-jobs/list' }); assert.equal(own.data.total, 1);
  const all = await f.sessions.get('admin').dispatch({ path: '/api/print-jobs?limit=10' }); assert.equal(all.data.total, 2);
  assert(!JSON.stringify(all.data).includes('credential')); assert(!JSON.stringify(all.data).includes('prepared_json')); assert(!JSON.stringify(all.data).includes('bodyBase64'));
});

test('accepted date metadata is retained while retry hashing still uses the original request', async t => {
  const f = await fixture(t), input = request({ type: 'inventory-report-a4', range: '30' });
  const first = await f.submit('inventory', input); await f.drain(); f.setDay('2026-10-15');
  const again = await f.submit('inventory', input); assert.equal(again.status, 201); assert.equal(again.data.job.id, first.data.job.id); assert(again.data.job.requestMeta, 'accepted request metadata must be public'); assert.equal(again.data.job.requestMeta.asOf, '2026-10-14'); assert.equal(again.data.job.source.since, '2026-09-15');
  assert.equal((await f.submit('inventory', { ...input, copies: 2 })).status, 409); assert.equal(f.printed.length, 1);
  const retained = JSON.parse(fs.readFileSync(f.directory + '.central-print-ledger.json', 'utf8')); assert.equal(retained.jobs[0].acceptedSource.since, '2026-09-15'); assert.equal(retained.jobs[0].requestMeta.asOf, '2026-10-14');
});

test('warranty snapshots server presentation at acceptance and preserves original preference read/write', async t => {
  let release; const hold = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, { hold }), input = request({ type: 'warranty', quoteId: Q }, { presentation: { language: 'zh', warranty: { itemIndexes: [0], overrides: [{ itemIndex: 0, phone: '020-this' }] } } });
  const result = await f.submit('sales', input); assert.equal(result.status, 201);
  f.memorySettings.offsetXmm = 9; f.memorySettings.phone = '030-later'; release(); await f.drain();
  assert(f.printed[0].presentation.settings, 'the trusted agent presentation snapshot is required'); assert.equal(f.printed[0].presentation.settings.offsetXmm, 1); assert.equal(f.printed[0].presentation.settings.phone, '010-old'); assert.equal(f.printed[0].presentation.warranty.overrides[0].phone, '020-this');
  assert.equal(fingerprintPrintPayload(f.printed[0]), f.printed[0].payloadHash);
  const patched = await f.sessions.get('sales').dispatch({ path: '/api/warranty-preferences', method: 'PATCH', body: { phone: '021-remembered', afterSalesWechat: 'remembered-contact' } }); assert.equal(patched.status, 200); assert.equal(patched.data.phone, '021-remembered');
  const read = await f.sessions.get('sales').dispatch({ path: '/api/warranty-preferences' }); assert.equal(read.data.afterSalesWechat, 'remembered-contact');
  const business = await f.sessions.get('sales').dispatch({ path: '/api/preferences' }); assert.equal(business.data.marker, 'original-business-request');
});

test('one global twenty-job limit applies across actual module sessions', async t => {
  let release; const hold = new Promise(resolve => { release = resolve; }); const f = await fixture(t, { hold });
  for (let index = 0; index < 20; index++) assert.equal((await f.submit(index % 2 ? 'inventory' : 'finance', request(index % 2 ? { type: 'inventory-count-a4', id: 12 } : { type: 'erp-report-a4', filters: {} }))).status, 201);
  assert.equal((await f.submit('sales', request({ type: 'quotation-a4', quoteId: Q }))).status, 429); release(); await f.drain(); assert.equal(f.printed.length, 20); assert.equal(f.maxActive(), 1);
});

test('credential changes and source-module revocation stop queued work before the final gate', async t => {
  const f = await fixture(t);
  f.setGateHook(async () => { await f.sessions.get('admin').dispatch({ path: '/api/admin/module-permissions', method: 'PATCH', body: { staffId: S.finance, moduleAccess: { ledger: 'view' } } }); });
  const job = await f.submit('finance', request({ type: 'erp-report-a4', filters: {} })); await f.drain(); assert.equal(f.printed.length, 0);
  const failed = await f.sessions.get('finance').dispatch({ path: '/api/print-jobs/' + job.data.job.id }); assert.equal(failed.data.job.status, 'failed');
  f.setGateHook(async () => { await f.sessions.get('admin').dispatch({ path: '/api/users', method: 'PATCH', body: { id: S.inventory, password: 'ChangedFixture-2026!' } }); });
  const second = await f.submit('inventory', request({ type: 'inventory-count-a4', id: 12 })); await f.drain(); assert.equal(f.printed.length, 0); assert.equal((await f.sessions.get('inventory').dispatch({ path: '/api/print-jobs/' + second.data.job.id })).status, 401);
});

test('old DB history without a ledger cannot be forgotten or resumed', async t => {
  const legacy = { requestId: randomUUID(), quoteId: Q, kind: 'quotation-a4', printerId: 'p_' + sha('xjy-native-printer:Fixture Deli').slice(0, 32), copies: 1 }, id = randomUUID();
  const f = await fixture(t, { seed: ({ db }) => { db.exec('CREATE TABLE remote_print_jobs(id TEXT PRIMARY KEY,actor_id TEXT,actor_name TEXT,actor_password_hash TEXT,request_id TEXT,params_json TEXT,warranty_json TEXT,quote_id TEXT,kind TEXT,copies INTEGER,printer_id TEXT,status TEXT,error TEXT,created_at TEXT,updated_at TEXT)'); db.prepare('INSERT INTO remote_print_jobs VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, S.sales, '虚构-sales', PASSWORD_HASH, legacy.requestId, stable(legacy), null, Q, legacy.kind, 1, legacy.printerId, 'printing', '', '2026-10-14T00:00:00Z', '2026-10-14T00:00:00Z'); } });
  const again = await f.submit('sales', legacy); assert.equal(again.status, 201); assert.equal(again.data.job.id, id); assert.equal(again.data.job.status, 'uncertain'); await f.drain(); assert.equal(f.printed.length, 0);
  const ledger = JSON.parse(fs.readFileSync(f.directory + '.print-ledger.json', 'utf8')); assert.equal(ledger.version, 1); assert.deepEqual(Object.keys(ledger.jobs[0]).sort(), ['actorId', 'createdAt', 'id', 'kind', 'paramsHash', 'quoteId', 'requestId', 'status', 'updatedAt'].sort());
});

test('retained 1.5.1 metadata supplies the request hash after business DB rollback', async t => {
  const legacy = { requestId: randomUUID(), quoteId: Q, kind: 'quotation-a4', printerId: 'p_' + sha('xjy-native-printer:Fixture Deli').slice(0, 32), copies: 2 }, id = randomUUID(), originalHash = sha(stable({ version: 2, request: legacy, route: { old: true } }));
  const f = await fixture(t, { seed: ({ directory }) => { fs.writeFileSync(directory + '.print-ledger.json', JSON.stringify({ version: 1, jobs: [{ id, actorId: S.sales, requestId: legacy.requestId, quoteId: Q, kind: legacy.kind, paramsHash: originalHash, status: 'submitted', createdAt: '2026-10-14T00:00:00Z', updatedAt: '2026-10-14T00:00:00Z' }] })); fs.writeFileSync(directory + '.print-ledger.metadata.json', JSON.stringify({ version: 1, jobs: [{ id, paramsHash: originalHash, requestParamsHash: sha(stable(legacy)), copies: 2, printerId: legacy.printerId, printerLabel: '旧A4', routingRevision: 1 }] })); } });
  const again = await f.submit('sales', legacy); assert.equal(again.status, 201); assert.equal(again.data.job.id, id); assert.equal(again.data.job.status, 'submitted'); assert.equal(again.data.job.copies, 2);
  assert.equal((await f.submit('sales', { ...legacy, copies: 1 })).status, 409); await f.drain(); assert.equal(f.printed.length, 0);
});

test('new sales tasks keep the original strict nine-field rollback ledger', async t => {
  const f = await fixture(t), result = await f.submit('sales', request({ type: 'quotation-a4', quoteId: Q })); assert.equal(result.status, 201); await f.drain();
  assert(fs.existsSync(f.directory + '.print-ledger.json'), 'original compatibility ledger must exist'); const ledger = JSON.parse(fs.readFileSync(f.directory + '.print-ledger.json', 'utf8')); assert.equal(ledger.version, 1); assert.equal(ledger.jobs[0].status, 'submitted'); assert.equal(ledger.jobs[0].quoteId, Q); assert.deepEqual(Object.keys(ledger.jobs[0]).sort(), ['actorId', 'createdAt', 'id', 'kind', 'paramsHash', 'quoteId', 'requestId', 'status', 'updatedAt'].sort());
  const legacyReader = new vm.Script(fs.readFileSync(path.resolve(__dirname, '../project/desktop/remote-print-jobs.cjs'), 'utf8') + '\nmodule.exports.testRead = createLedger;'); const oldModule = { exports: {} }; legacyReader.runInNewContext({ module: oldModule, exports: oldModule.exports, require: createRequire(path.resolve(__dirname, '../project/desktop/remote-print-jobs.cjs')), Buffer, __dirname: path.resolve(__dirname, '../project/desktop') });
  assert.doesNotThrow(() => oldModule.exports.testRead(f.directory));
});

test('closing a request session rejects new print calls without leaking an old actor', async t => {
  const f = await fixture(t), session = f.sessions.get('inventory'); await session.close();
  assert.equal((await session.dispatch({ path: '/api/print-options' })).status, 401); assert.equal((await session.dispatch({ path: '/api/print-jobs', method: 'POST', body: request({ type: 'inventory-count-a4', id: 12 }) })).status, 401); assert.equal(f.printed.length, 0);
});

test('logout of the accepting session invalidates its unsent job instead of borrowing another login', async t => {
  const f = await fixture(t); f.setGateHook(async () => { const result = await f.sessions.get('finance').dispatch({ path: '/auth/logout', method: 'POST' }); assert.equal(result.status, 200); });
  const result = await f.submit('finance', request({ type: 'erp-report-a4', filters: {} })); assert.equal(result.status, 201); await f.drain(); assert.equal(f.printed.length, 0);
  const lookup = await f.sessions.get('admin').dispatch({ path: '/api/print-jobs/' + result.data.job.id }); assert.equal(lookup.data.job.status, 'failed');
});

test('all eight registered source kinds traverse actual session routes with module-specific authority', async t => {
  const f = await fixture(t), cases = [
    ['sales', { type: 'quotation-a4', quoteId: Q }],
    ['sales', { type: 'warranty', quoteId: Q }],
    ['finance', { type: 'erp-document-a4', id: Q }],
    ['finance', { type: 'erp-report-a4', filters: {} }],
    ['finance', { type: 'ledger-report-a4', filters: {} }],
    ['inventory', { type: 'inventory-count-a4', id: 12 }],
    ['inventory', { type: 'inventory-report-a4', range: '90' }],
    ['inventory', { type: 'inventory-metal-a4' }],
  ];
  for (const [name, source] of cases) { const extra = source.type === 'warranty' ? { presentation: { warranty: { itemIndexes: [0], overrides: [] } } } : {}; assert.equal((await f.submit(name, request(source, extra))).status, 201); }
  await f.drain(); assert.equal(f.printed.length, 8); assert.equal(f.printed.find(item => item.kind === 'warranty').route.deviceName, 'Fixture EPSON'); assert(f.printed.filter(item => item.kind !== 'warranty').every(item => item.route.deviceName === 'Fixture Deli')); assert.equal(f.maxActive(), 1);
  assert(f.moduleCalls.some(call => call.input.path === '/reports?r=90&since=2026-07-17')); assert(f.moduleCalls.every(call => call.actor.role === 'employee'));
});

test('sensitive finance print contents cannot borrow an admin capability', async t => {
  const f = await fixture(t, { documentKind: 'purchase' });
  assert.equal((await f.submit('finance', request({ type: 'erp-document-a4', id: Q }))).status, 403);
  assert.equal((await f.submit('finance', request({ type: 'ledger-report-a4', filters: { domain: ['sales'], sales_metric: ['profit'] } }))).status, 403); await f.drain(); assert.equal(f.printed.length, 0);
});

test('explicit reprints use a new UUID and retain the original accepted report snapshot and relationship', async t => {
  const f = await fixture(t), original = request({ type: 'erp-report-a4', filters: {} });
  const first = await f.submit('finance', original); await f.drain(); f.setDay('2026-10-15');
  const second = await f.submit('finance', request(original.source, { reprintOf: first.data.job.id, reprintConfirmed: true })); assert.equal(second.status, 201); await f.drain();
  assert.notEqual(second.data.job.id, first.data.job.id); assert.equal(second.data.job.requestMeta.reprintOf, first.data.job.id); assert.equal(second.data.job.requestMeta.reprintConfirmed, true); assert.equal(second.data.job.requestMeta.asOf, '2026-10-14'); assert.deepEqual(second.data.job.requestedSource, { type: 'erp-report-a4', filters: {} });
  assert.equal(f.printed[1].document.data.asOf, '2026-10-14');
  const retained = JSON.parse(fs.readFileSync(f.directory + '.central-print-ledger.json', 'utf8')); assert.equal(retained.jobs[1].requestMeta.reprintOf, first.data.job.id);
  assert.equal((await f.submit('finance', { ...original, reprintOf: first.data.job.id, reprintConfirmed: true })).status, 409);
});

test('reprints require an explicit declaration, a terminal original task and the same source', async t => {
  let release; const hold = new Promise(resolve => { release = resolve; }), f = await fixture(t, { hold });
  try {
    const source = { type: 'inventory-count-a4', id: 12 }, first = await f.submit('inventory', request(source));
    assert.equal((await f.submit('inventory', request(source, { reprintOf: first.data.job.id, reprintConfirmed: true }))).status, 409);
    release(); await f.drain();
    assert.equal((await f.submit('inventory', request(source, { reprintOf: first.data.job.id }))).status, 400);
    assert.equal((await f.submit('inventory', request({ type: 'inventory-count-a4', id: 13 }, { reprintOf: first.data.job.id, reprintConfirmed: true }))).status, 409);
    assert.equal((await f.submit('finance', request(source, { reprintOf: first.data.job.id, reprintConfirmed: true }))).status, 403);
  } finally { release(); }
});

test('the final receipt keeps the SQL gate until native submission rather than yielding to a queued revocation', async t => {
  const f = await fixture(t); let revocation, authorityAtNative;
  f.setModuleReadHook(count => { if (count === 3) revocation = f.sessions.get('admin').dispatch({ path: '/api/admin/module-permissions', method: 'PATCH', body: { staffId: S.finance, moduleAccess: { ledger: 'view' } } }); });
  f.setNativeSubmitHook((_payload, receipt) => { authorityAtNative = f.db.prepare('SELECT ledger FROM module_permissions WHERE staff_id=?').get(S.finance).ledger; assert(Number.isSafeInteger(receipt.expiresAt)); assert(receipt.expiresAt > Date.now() && receipt.expiresAt <= Date.now() + 5000); });
  assert.equal((await f.submit('finance', request({ type: 'erp-report-a4', filters: {} }))).status, 201); await f.drain(); assert.equal((await revocation).status, 200);
  assert.equal(authorityAtNative, 'operate'); assert.equal(f.db.prepare('SELECT ledger FROM module_permissions WHERE staff_id=?').get(S.finance).ledger, 'view');
});

test('an agent deadline prevents a late gate from authorizing a retry or blocking future business requests', async t => {
  let release; const hold = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, { hold, agentTimeoutMs: 20 });
  const result = await f.submit('sales', request({ type: 'quotation-a4', quoteId: Q })); await f.drain();
  const lookup = await f.sessions.get('sales').dispatch({ path: '/api/print-jobs/' + result.data.job.id }); assert.equal(lookup.data.job.status, 'uncertain');
  release(); await tick(); await tick(); assert.equal(f.printed.length, 0);
  const business = await f.sessions.get('sales').dispatch({ path: '/api/preferences' }); assert.equal(business.status, 200); assert.equal(business.data.marker, 'original-business-request');
});

'use strict';

// Source/--check only on Host. Root alone may run this file in the newly
// admitted offline Guest. Every row, account, date and archive is invented.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
if (process.platform !== 'win32' || os.userInfo().username.toLowerCase() !== 'wdagutilityaccount' || ROOT.toLowerCase() !== 'c:\\xjy-work\\xjy-web-stage1') throw Error('Fixed actual Windows Sandbox required before business imports or writes');
const assert = require('node:assert/strict'), sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const SELF = 'audit-tools/strict-round2-sales-request-terminal-a2.test.cjs';
const GUARDS = Object.freeze({
  'stage1/guest-candidate-cdp.cjs': '59840b638d8797fb55241616cd0b8e4098075a76834a201b0e93c1a748f1bb32',
  'stage1/sandbox-context.py': '09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249',
  'stage1/validate-sandbox-context.py': '867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207',
});
const BASE_FILES = Object.freeze([
  'project/desktop/sales-orders.cjs', 'project/desktop/runtime.cjs',
  'project/desktop/business-maintenance-layout.cjs', 'project/desktop/business-backups.cjs',
  'project/desktop/business-restore.cjs', 'project/desktop/business-authority-preserve.cjs',
  'project/desktop/business-erp-backup-integrity.cjs', 'project/desktop/administration.cjs',
  'project/desktop/erp-policy.cjs',
]);
function read(relative) {
  assert.equal(typeof relative, 'string');
  const file = path.join(ROOT, ...relative.split('/')), local = path.relative(ROOT, file);
  if (local === '..' || local.startsWith('..' + path.sep) || path.isAbsolute(local)) throw Error('Source escaped fixed Root');
  for (let current = file;; current = path.dirname(current)) {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || stat.isFile() && stat.nlink !== 1) throw Error('Source links refused');
    if (current === path.dirname(current)) break;
  }
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > 4 * 1024 * 1024) throw Error('Bounded ordinary source required');
  return fs.readFileSync(file);
}
for (const [file, pin] of Object.entries(GUARDS)) assert.equal(sha(read(file)), pin, 'Unchanged actual admission source required: ' + file);
const selfPin = process.env.XJY_STRICT_ROUND2_TERMINAL_TEST_SHA256;
assert.match(selfPin || '', /^[a-f0-9]{64}$/); assert.equal(sha(read(SELF)), selfPin, 'Root-reviewed exact new contract required');
const pins = JSON.parse(process.env.XJY_STRICT_ROUND2_TERMINAL_SOURCE_PINS || 'null');
assert(pins && typeof pins === 'object' && !Array.isArray(pins));
const migrations = fs.readdirSync(path.join(ROOT, 'project', 'desktop', 'migrations')).filter(name => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort().map(name => 'project/desktop/migrations/' + name);
assert(migrations.includes('project/desktop/migrations/0010_sales_orders.sql'), 'Real sales order schema required');
// A future implementation may add a small preserve helper. This contract must
// then be preserved and revised to name/pin that helper before Root runs it;
// unreviewed extra JS is never admitted via a permissive manifest entry.
assert.deepEqual(Object.keys(pins).sort(), [...BASE_FILES, ...migrations].sort(), 'Exact reviewed dependency and complete migration inventory required');
for (const [file, pin] of Object.entries(pins)) { assert.match(pin || '', /^[a-f0-9]{64}$/); assert.equal(sha(read(file)), pin, 'Frozen candidate changed: ' + file); }
const actualContext = require('../stage1/guest-candidate-cdp.cjs').actualGuard();
const test = require('node:test'), { DatabaseSync } = require('node:sqlite');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const api = file => { const relative = 'project/desktop/' + file; assert(Object.hasOwn(pins, relative)); return require(path.join(ROOT, ...relative.split('/'))); };
const { createSalesOrders } = api('sales-orders.cjs');
const S = Object.freeze({ admin: 'a1000000-0000-4000-8000-000000000001', a: 'a1000000-0000-4000-8000-000000000002', b: 'a1000000-0000-4000-8000-000000000003', finance: 'a1000000-0000-4000-8000-000000000004', readonly: 'a1000000-0000-4000-8000-000000000005' });
const CUSTOMER = 'a2000000-0000-4000-8000-000000000001', STAMP = '2030-01-01T00:00:00.000Z', DATE = '2030-01-01';
const status = expected => problem => problem?.status === expected;

function fixture(t) {
  const base = path.join(ROOT, 'runtime', 'strict-round2-terminal-tests'); fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, 'owned-')), layout = {};
  for (const [field, name] of Object.entries({ dataDir: 'sales', ledgerDir: 'ledger', inventoryDir: 'inventory', profileDir: 'profile', configDir: 'config', runtimeDir: 'runtime', logDir: 'logs', backupDir: 'backups', documentsDir: 'documents', quoteImagesDir: 'quote-images' })) { layout[field] = path.join(root, name); fs.mkdirSync(layout[field]); }
  const salesFile = path.join(layout.dataDir, 'jewelry.sqlite');
  let db = new DatabaseSync(salesFile); db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=0;');
  for (const file of migrations) db.exec(read(file).toString('utf8'));
  const local = /sqlite\.exec\(`(CREATE TABLE IF NOT EXISTS local_accounts[\s\S]*?)`\);/.exec(read('project/desktop/runtime.cjs').toString('utf8'));
  assert(local && !local[1].includes('${'), 'Exact known local account DDL required'); db.exec(local[1]);
  for (const [name, id] of Object.entries(S)) {
    db.prepare('INSERT INTO staff_users(id,user_id,email,name,role,active,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?)').run(id, null, 'terminal-' + name + '@example.invalid', '终态虚构-' + name, name === 'admin' ? 'admin' : 'employee', STAMP, STAMP);
    db.prepare('INSERT INTO local_accounts VALUES(?,?,?,?,?,?)').run(id, 'terminal-' + name, '01'.repeat(16), 'ab'.repeat(64), STAMP, STAMP);
    db.prepare('INSERT INTO module_permissions VALUES(?,?,?,?,?,?)').run(id, name === 'finance' ? 'disabled' : name === 'readonly' ? 'view' : 'operate', name === 'finance' || name === 'admin' ? 'manage' : 'disabled', 'disabled', 1, STAMP);
    db.prepare('INSERT INTO staff_capabilities VALUES(?,?,?)').run(id, JSON.stringify({ 'sales.orders.review': name === 'finance' || name === 'admin', 'personal.sales.view': true }), STAMP);
  }
  db.prepare('INSERT INTO customers(id,name,phone,notes,owner_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(CUSTOMER, '终态虚构客户', '00000000000', '', S.a, STAMP, STAMP);
  db.prepare('INSERT INTO customer_collaborators(customer_id,staff_id,active,granted_by,granted_at) VALUES(?,?,1,?,?)').run(CUSTOMER, S.b, S.admin, STAMP);
  for (const [field, filename] of [['ledgerDir', 'ledger.db'], ['inventoryDir', 'stockcheck.db']]) { const other = new DatabaseSync(path.join(layout[field], filename)); other.exec('CREATE TABLE strict_round2_proof(value TEXT);'); other.close(); }
  t.after(() => { try { db.close(); } catch { /* An earlier lifecycle failure may already have closed it. */ } });
  function denied(code, message) { throw Object.assign(Error(message), { status: code }); }
  const levels = ['disabled', 'view', 'operate', 'manage'];
  const administration = {
    requireAccess(user, module, requested = 'view') {
      const current = db.prepare('SELECT active FROM staff_users WHERE id=?').get(user.id), grant = db.prepare('SELECT sales,ledger,inventory FROM module_permissions WHERE staff_id=?').get(user.id);
      if (!current?.active) denied(401, 'synthetic actor inactive');
      if (!grant || !levels.includes(requested) || levels.indexOf(grant[module]) < levels.indexOf(requested)) denied(403, 'synthetic live module denied');
    },
    requireCapability(user, key) { const current = db.prepare('SELECT active FROM staff_users WHERE id=?').get(user.id), grant = db.prepare('SELECT data FROM staff_capabilities WHERE staff_id=?').get(user.id); if (!current?.active) denied(401, 'synthetic actor inactive'); if (!grant || !JSON.parse(grant.data)[key]) denied(403, 'synthetic live capability denied'); },
    requireAdmin(user) { const current = db.prepare('SELECT role,active FROM staff_users WHERE id=?').get(user.id); if (!current?.active) denied(401, 'synthetic actor inactive'); if (current.role !== 'admin') denied(403, 'synthetic admin denied'); },
  };
  const users = Object.fromEntries(Object.entries(S).map(([name, id]) => [name, { id, role: name === 'admin' ? 'admin' : 'employee', name: '终态虚构-' + name, active: true }]));
  const service = () => createSalesOrders({ runtime: { sqlite: db }, administration, clock: () => Date.parse(STAMP) });
  function call(who, address, method = 'GET', body) { return service().handle(users[who], { path: address, method, ...(body === undefined ? {} : { body }) }); }
  function quote({ owner = 'a', rootId, version = 1 } = {}) {
    const id = crypto.randomUUID(), item = { id: 'terminal-line', weight: 1, quantity: 1 }, line = { id: item.id, metal: 100, labor: 0, extras: 0, subtotal: 100, weight: 1, quantity: 1 };
    const calculation = { metal: 100, labor: 0, extras: 0, subtotal: 100, discount: 0, total: 100, itemTotals: [line] }, snapshot = { type: 'sale', customerId: CUSTOMER, saleItems: [item], calculation };
    db.prepare('INSERT INTO quotes(id,number,type,customer_id,customer_name,owner_id,title,snapshot,totals,total_cents,root_id,base_quote_id,version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, 'TERMINAL-' + id, 'sale', CUSTOMER, '终态虚构客户', S[owner], '终态虚构来源', JSON.stringify(snapshot), JSON.stringify(calculation), 10000, rootId || id, rootId || null, version, STAMP);
    return id;
  }
  const input = (quoteId, requestId = crypto.randomUUID(), extra = {}) => ({ requestId, quoteId, businessDate: DATE, ...extra });
  const issue = (body, who = 'a') => call(who, '/api/sales-orders', 'POST', body);
  const get = (requestId, who = 'a') => call(who, '/api/sales-orders/by-request/' + requestId);
  const cancel = (requestId, who = 'a', body = {}) => call(who, '/api/sales-orders/by-request/' + requestId + '/cancel', 'POST', body);
  const count = () => db.prepare('SELECT count(*) AS n FROM sales_orders').get().n;
  const sequence = () => db.prepare('SELECT last_value FROM sales_order_sequences WHERE business_date=?').get(DATE)?.last_value || 0;
  function reopen() { db.close(); db = new DatabaseSync(salesFile); db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=0;'); }
  const context = api('business-maintenance-layout.cjs').createBusinessMaintenanceContext({ root, layout, hostId: 'strict-round2-synthetic-host', profileId: 'strict-round2-profile', provisionOwner: true });
  const backups = api('business-backups.cjs').createBusinessBackups({ context, salesDatabase: () => db, withFrozen: action => action() });
  const restore = api('business-restore.cjs').createBusinessRestore({ context, backups, freeze: action => action(), prepare: action => action(), database: () => db, stop: async () => db.close(), resume: async () => { db = new DatabaseSync(salesFile); db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=0;'); }, invalidateSessions: async () => {} });
  return { root, layout, salesFile, users, call, quote, input, issue, get, cancel, count, sequence, reopen, backups, restore, get db() { return db; } };
}

function ok(result) { assert.equal(result?.ok, true); assert(result.status >= 200 && result.status < 300); return result.data; }
function terminal(result, requestId, state) { const data = ok(result); assert.equal(data.request?.id, requestId, 'Response must identify the original exact request'); assert.equal(data.request?.state, state); return data; }
function cancelled(result, requestId) { const data = terminal(result, requestId, 'cancelled'); assert.equal(data.order ?? null, null, 'Cancelling an unissued request cannot invent an order'); assert.equal(typeof data.request.cancelledAt, 'string'); assert(Number.isFinite(Date.parse(data.request.cancelledAt))); return data; }
function issued(result, requestId, original) { const data = terminal(result, requestId, 'issued'); assert.equal(data.order?.id, original.id); assert.equal(data.order?.number, original.number); return data.order; }
function restored(result, requestId, original) { const data = terminal(result, requestId, 'restored'); assert.equal(data.order ?? null, null, 'A consciously restored-away order is not a current effective order'); assert.equal(data.receipt?.orderId, original.id); assert.equal(data.receipt?.number, original.number); assert.equal(data.receipt?.sourceQuoteId, original.sourceQuoteId); assert.equal(data.receipt?.sourceHash, original.sourceHash); assert.equal(data.receipt?.businessDate, original.businessDate); return data; }

if (!isMainThread) {
  // A real second SQLite connection in an actual Guest worker. The common
  // admission and complete source-pin checks above have already run here too.
  assert.equal(workerData?.strictRound2Terminal, true); assert(['create', 'cancel'].includes(workerData.operation));
  const file = path.resolve(workerData.file), expectedParent = path.join(ROOT, 'runtime', 'strict-round2-terminal-tests');
  assert.equal(path.dirname(path.dirname(path.dirname(file))), expectedParent); assert.match(path.basename(path.dirname(path.dirname(file))), /^owned-/); assert.equal(path.basename(path.dirname(file)), 'sales'); assert.equal(path.basename(file), 'jewelry.sqlite');
  for (let current = file;; current = path.dirname(current)) { const stat = fs.lstatSync(current); assert.equal(stat.isSymbolicLink(), false); if (stat.isFile()) assert.equal(stat.nlink, 1); if (current === path.dirname(current)) break; }
  const db = new DatabaseSync(file); db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  const administration = {
    requireAccess(user, module, requested = 'view') { const staff = db.prepare('SELECT active FROM staff_users WHERE id=?').get(user.id), grant = db.prepare('SELECT sales,ledger,inventory FROM module_permissions WHERE staff_id=?').get(user.id), levels = ['disabled', 'view', 'operate', 'manage']; assert.equal(staff?.active, 1); assert(grant && levels.indexOf(grant[module]) >= levels.indexOf(requested)); },
    requireCapability() { throw Error('Concurrency contract must not use finance or personal capabilities'); },
    requireAdmin() { throw Error('Concurrency contract must not use administrator powers'); },
  };
  const service = createSalesOrders({ runtime: { sqlite: db }, administration, clock: () => Date.parse(STAMP) }), signal = new Int32Array(workerData.signal);
  parentPort.postMessage({ ready: true });
  assert.notEqual(Atomics.wait(signal, 0, 0, 10000), 'timed-out', 'Root contract start barrier required');
  try {
    const request = workerData.operation === 'create' ? { path: '/api/sales-orders', method: 'POST', body: workerData.body } : { path: '/api/sales-orders/by-request/' + workerData.body.requestId + '/cancel', method: 'POST', body: {} };
    try { parentPort.postMessage({ result: service.handle({ id: S.a }, request) }); } catch (error) { parentPort.postMessage({ problem: { status: error.status, code: error.code, message: error.message } }); }
  } finally { db.close(); parentPort.close(); }
} else {
console.log(JSON.stringify({ purpose: 'strict-round2-durable-request-cancel-create-and-restore', actualContext, testSha256: selfPin, sourcePins: pins, guardPins: GUARDS, methods: 15, productionDataUsed: false, actualUiVerified: false, nativeExecuted: false }));

test('H00 healthy real SQLite fixture creates and retries the same current order without a second event', { concurrency: false }, t => {
  const f = fixture(t), body = f.input(f.quote()), first = ok(f.issue(body));
  assert.equal(first.order.number, 'SO20300101-000001'); assert.equal(first.order.status, 'pending');
  assert.equal(ok(f.issue(body)).order.id, first.order.id); assert.equal(f.count(), 1); assert.equal(f.sequence(), 1);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM sales_order_events').get().n, 1);
  assert.throws(() => f.issue({ ...body, note: '虚构不同内容' }), status(409));
});

test('C01 unknown GET remains nonterminal; explicit cancellation creates a durable tombstone and bars a late original POST', { concurrency: false }, t => {
  const f = fixture(t), body = f.input(f.quote()); assert.throws(() => f.get(body.requestId), status(404));
  const first = cancelled(f.cancel(body.requestId), body.requestId); assert.equal(f.count(), 0); assert.equal(f.sequence(), 0);
  assert.deepEqual(cancelled(f.cancel(body.requestId), body.requestId).request, first.request, 'Idempotent cancellation keeps its first durable time');
  f.reopen(); assert.deepEqual(cancelled(f.get(body.requestId), body.requestId).request, first.request);
  assert.throws(() => f.issue(body), status(409)); assert.equal(f.count(), 0); assert.equal(f.sequence(), 0);
  const next = ok(f.issue({ ...body, requestId: crypto.randomUUID() })); assert.equal(next.order.number, 'SO20300101-000001');
});

test('C02 when creation wins cancellation returns the actual issued order and never voids or overwrites it', { concurrency: false }, t => {
  const f = fixture(t), body = f.input(f.quote()), original = ok(f.issue(body)).order;
  const before = f.db.prepare('SELECT * FROM sales_orders WHERE id=?').get(original.id);
  const returned = issued(f.cancel(body.requestId), body.requestId, original); assert.equal(returned.status, 'pending');
  f.reopen(); issued(f.get(body.requestId), body.requestId, original); issued(f.cancel(body.requestId), body.requestId, original);
  assert.deepEqual(f.db.prepare('SELECT * FROM sales_orders WHERE id=?').get(original.id), before);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM sales_order_events').get().n, 1);
  assert.equal(ok(f.issue(body)).order.id, original.id); assert.equal(f.count(), 1); assert.equal(f.sequence(), 1);
});

test('C03 identical UUIDs are isolated by the live requester; cancelling one actor never observes or blocks another actor', { concurrency: false }, t => {
  const f = fixture(t), requestId = crypto.randomUUID(), a = f.input(f.quote(), requestId), b = f.input(f.quote({ owner: 'b' }), requestId);
  const aTerminal = cancelled(f.cancel(requestId, 'a'), requestId); assert.throws(() => f.get(requestId, 'b'), status(404));
  const bOrder = ok(f.issue(b, 'b')).order; issued(f.cancel(requestId, 'b'), requestId, bOrder);
  assert.equal(JSON.stringify(cancelled(f.get(requestId, 'a'), requestId)).includes(bOrder.id), false);
  assert.deepEqual(cancelled(f.get(requestId, 'a'), requestId).request, aTerminal.request);
  assert.throws(() => f.issue(a), status(409)); assert.equal(f.count(), 1); assert.equal(f.sequence(), 1);
  assert.throws(() => f.get(requestId, 'admin'), status(404), 'Admin has its own request namespace; no caller-selected actor override');
});

test('C04 cancellation rechecks live sales write permission and stopped identities cannot read a cached terminal', { concurrency: false }, t => {
  const f = fixture(t), requestId = crypto.randomUUID();
  assert.throws(() => f.cancel(requestId, 'readonly'), status(403)); assert.throws(() => f.cancel(requestId, 'finance'), status(403));
  cancelled(f.cancel(requestId), requestId); f.db.prepare("UPDATE module_permissions SET sales='disabled' WHERE staff_id=?").run(S.a);
  assert.throws(() => f.get(requestId), status(403)); assert.throws(() => f.cancel(requestId), status(403));
  f.db.prepare("UPDATE module_permissions SET sales='operate' WHERE staff_id=?").run(S.a); f.db.prepare('UPDATE staff_users SET active=0 WHERE id=?').run(S.a);
  assert.throws(() => f.get(requestId), status(401)); assert.throws(() => f.cancel(requestId), status(401));
  f.db.prepare('UPDATE staff_users SET active=1 WHERE id=?').run(S.a); cancelled(f.get(requestId), requestId);
});

test('C05 strict cancellation body cannot select another actor, another order or a false outcome', { concurrency: false }, t => {
  const f = fixture(t);
  for (const body of [{ actorId: S.b }, { ownerId: S.b }, { state: 'cancelled' }, { orderId: crypto.randomUUID() }, [], null]) {
    const requestId = crypto.randomUUID(); assert.throws(() => f.cancel(requestId, 'a', body), status(400)); assert.throws(() => f.get(requestId), status(404));
  }
  assert.equal(f.count(), 0); assert.equal(f.sequence(), 0);
});

test('C06 cancellation ends a stale-source request without requiring the rejected source to become valid', { concurrency: false }, t => {
  const f = fixture(t), v1 = f.quote(), v2 = f.quote({ rootId: v1, version: 2 }), body = f.input(v1);
  assert.throws(() => f.issue(body), status(409)); assert.throws(() => f.get(body.requestId), status(404));
  cancelled(f.cancel(body.requestId), body.requestId); assert.throws(() => f.issue(body), status(409));
  assert.equal(ok(f.issue(f.input(v2))).order.sourceQuoteId, v2); assert.equal(f.count(), 1); assert.equal(f.sequence(), 1);
});

test('C07 a lost cancellation reply is recovered through the same request after reopening the physical database', { concurrency: false }, t => {
  const f = fixture(t), body = f.input(f.quote());
  f.cancel(body.requestId); // Deliberately discard only the network-level reply.
  f.reopen(); const current = cancelled(f.get(body.requestId), body.requestId);
  assert.deepEqual(cancelled(f.cancel(body.requestId), body.requestId).request, current.request);
  assert.throws(() => f.issue(body), status(409)); assert.equal(f.count(), 0); assert.equal(f.sequence(), 0);
});

test('C08 an external real IMMEDIATE writer prevents cancellation acknowledgement until its transaction can commit', { concurrency: false }, t => {
  const f = fixture(t), requestId = crypto.randomUUID(), blocker = new DatabaseSync(f.salesFile); let locked = false;
  try {
    blocker.exec('PRAGMA busy_timeout=0; BEGIN IMMEDIATE;'); locked = true;
    assert.throws(() => f.cancel(requestId), problem => /busy|locked/i.test(String(problem?.code) + ' ' + String(problem?.message)), 'No durable success may be returned without obtaining the sales writer transaction');
    blocker.exec('ROLLBACK'); locked = false;
    assert.throws(() => f.get(requestId), status(404), 'A failed write transaction cannot leave a half terminal');
    cancelled(f.cancel(requestId), requestId); assert.equal(f.count(), 0); assert.equal(f.sequence(), 0);
  } finally { if (locked) blocker.exec('ROLLBACK'); blocker.close(); }
});

test('C09 actual competing SQLite workers yield one terminal when the original POST and cancellation start together', { concurrency: false }, async t => {
  const f = fixture(t);
  for (let round = 0; round < 8; round++) {
    const body = f.input(f.quote()), signal = new SharedArrayBuffer(4), gate = new Int32Array(signal), before = f.count();
    function contender(operation) {
      const worker = new Worker(__filename, { workerData: { strictRound2Terminal: true, operation, body, file: f.salesFile, signal } });
      let readyResolve, doneResolve, rejectBoth, terminal;
      const ready = new Promise((resolve, reject) => { readyResolve = resolve; rejectBoth = reject; });
      const done = new Promise((resolve, reject) => { doneResolve = resolve; const rejectReady = rejectBoth; rejectBoth = error => { rejectReady(error); reject(error); }; });
      // Observe early rejection while preserving the original rejected done for the actual assertion path.
      done.catch(() => {});
      worker.on('message', message => { if (message.ready === true) readyResolve(); else terminal = message; });
      worker.on('error', rejectBoth);
      worker.on('exit', code => { if (code !== 0 || !terminal) rejectBoth(Error('Actual terminal contender exited without a result: ' + code)); else doneResolve(terminal); });
      return { ready, done };
    }
    const create = contender('create'), cancel = contender('cancel');
    await Promise.all([create.ready, cancel.ready]); Atomics.store(gate, 0, 1); Atomics.notify(gate, 0, 2);
    const [creation, cancellation] = await Promise.all([create.done, cancel.done]); assert.equal(cancellation.problem, undefined);
    const data = ok(cancellation.result); assert(['cancelled', 'issued'].includes(data.request?.state));
    if (data.request.state === 'cancelled') {
      cancelled(cancellation.result, body.requestId); assert.equal(creation.problem?.status, 409); cancelled(f.get(body.requestId), body.requestId); assert.equal(f.count(), before);
      assert.throws(() => f.issue(body), status(409));
    } else {
      assert.equal(creation.problem, undefined); const original = ok(creation.result).order;
      issued(cancellation.result, body.requestId, original); issued(f.get(body.requestId), body.requestId, original); assert.equal(f.count(), before + 1);
      assert.equal(ok(f.issue(body)).order.id, original.id);
    }
  }
});

for (const selection of ['sales', 'allBusiness']) test('R01-' + selection + ' preserves both cancellation and issued receipt across repeated real restore without reviving restored orders', { concurrency: false }, async t => {
  const f = fixture(t), q1 = f.quote(), q2 = f.quote(), saved = await f.backups.create();
  const abandoned = f.input(q1), accepted = f.input(q1); const cancellation = cancelled(f.cancel(abandoned.requestId), abandoned.requestId);
  const old = ok(f.issue(accepted)).order; assert.equal(f.count(), 1); assert.equal(old.number, 'SO20300101-000001');
  assert.equal((await f.restore.restore(saved.file, selection)).ok, true); assert.equal(f.count(), 0, 'The explicit business rollback is retained');
  assert.deepEqual(cancelled(f.get(abandoned.requestId), abandoned.requestId).request, cancellation.request);
  restored(f.get(accepted.requestId), accepted.requestId, old); restored(f.cancel(accepted.requestId), accepted.requestId, old);
  for (const body of [accepted, abandoned]) assert.throws(() => f.issue(body), status(409));
  assert.equal(f.count(), 0); assert.equal(ok(f.call('a', '/api/sales-orders?month=2030-01')).summary.effective.orderCount, 0);
  const nextBody = f.input(q2), next = ok(f.issue(nextBody)).order; assert.notEqual(next.number, old.number); assert.equal(next.number, 'SO20300101-000002');
  assert.equal((await f.restore.restore(saved.file, selection)).ok, true); assert.equal(f.count(), 0);
  f.reopen(); cancelled(f.get(abandoned.requestId), abandoned.requestId); restored(f.get(accepted.requestId), accepted.requestId, old); restored(f.get(nextBody.requestId), nextBody.requestId, next);
  for (const body of [accepted, abandoned, nextBody]) assert.throws(() => f.issue(body), status(409));
  assert.equal(f.count(), 0); assert.equal(f.sequence(), 2);
});

test('R02 a still-present restored order returns its actual restored state rather than a stale cached approved reply', { concurrency: false }, async t => {
  const f = fixture(t), body = f.input(f.quote()), original = ok(f.issue(body)).order, saved = await f.backups.create();
  const approved = ok(f.call('finance', '/api/finance/sales-orders/' + original.id + '/review', 'POST', { requestId: crypto.randomUUID(), revision: original.revision, contentHash: original.contentHash, decision: 'approve', note: '终态虚构独立财务审核' })).order;
  assert.equal(approved.status, 'approved'); await f.restore.restore(saved.file, 'sales');
  const actual = issued(f.get(body.requestId), body.requestId, original); assert.equal(actual.status, 'pending'); assert.equal(actual.revision, 1);
  assert.equal(issued(f.cancel(body.requestId), body.requestId, original).status, 'pending'); assert.equal(f.count(), 1);
  assert.equal(ok(f.call('a', '/api/sales-orders?month=2030-01')).summary.effective.orderCount, 1);
});

test('R03 restore retains live read revocation while still retaining request knowledge for later authorised access', { concurrency: false }, async t => {
  const f = fixture(t), saved = await f.backups.create(), requestId = crypto.randomUUID(); cancelled(f.cancel(requestId), requestId);
  f.db.prepare("UPDATE module_permissions SET sales='disabled' WHERE staff_id=?").run(S.a); await f.restore.restore(saved.file, 'sales');
  assert.throws(() => f.get(requestId), status(403)); assert.throws(() => f.cancel(requestId), status(403));
  f.db.prepare("UPDATE module_permissions SET sales='operate' WHERE staff_id=?").run(S.a); cancelled(f.get(requestId), requestId);
});

test('R04 cancellation receipt survives when the business archive already contained an issued different actors identical UUID', { concurrency: false }, async t => {
  const f = fixture(t), requestId = crypto.randomUUID(), bBody = f.input(f.quote({ owner: 'b' }), requestId), bOrder = ok(f.issue(bBody, 'b')).order;
  const saved = await f.backups.create(); cancelled(f.cancel(requestId, 'a'), requestId); await f.restore.restore(saved.file, 'sales');
  cancelled(f.get(requestId, 'a'), requestId); issued(f.get(requestId, 'b'), requestId, bOrder); issued(f.cancel(requestId, 'b'), requestId, bOrder);
  assert.equal(f.count(), 1); assert.equal(f.sequence(), 1);
});
}

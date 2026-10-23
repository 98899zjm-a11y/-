'use strict';

// Root-only admitted Guest contracts. Never import business code or open SQLite
// on Host. Both reused fixture prefixes are frozen, synthetic and register no old
// tests; the original 23 service/migration contracts remain unchanged.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
if (process.platform !== 'win32' || os.userInfo().username.toLowerCase() !== 'wdagutilityaccount' || ROOT.toLowerCase() !== 'c:\\xjy-work\\xjy-web-stage1') throw Error('Fixed actual Windows Sandbox required before business imports');
const assert = require('node:assert/strict'), vm = require('node:vm'), { createRequire } = require('node:module');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function read(relative) {
  const file = path.join(ROOT, ...relative.split('/')), relativePath = path.relative(ROOT, file);
  if (relativePath === '..' || relativePath.startsWith('..' + path.sep) || path.isAbsolute(relativePath)) throw Error('Source escaped Root');
  for (let current = file;; current = path.dirname(current)) {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || stat.isFile() && stat.nlink !== 1) throw Error('Source link refused');
    if (current === path.dirname(current)) break;
  }
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > 4 * 1024 * 1024) throw Error('Bounded ordinary source required');
  return fs.readFileSync(file);
}
const SELF = 'audit-tools/strict-170-sales-staff-scope.test.cjs';
const selfPin = process.env.XJY_STRICT_170_SALES_STAFF_TEST_SHA256;
const pins = JSON.parse(process.env.XJY_STRICT_170_SALES_STAFF_SOURCE_PINS || 'null');
const FILES = ['project/desktop/sales-orders.cjs', 'project/desktop/administration.cjs', 'project/desktop/backend.cjs', 'project/lib/server.ts', 'project/desktop/runtime.cjs', 'audit-tools/finance-guards-loader.cjs', 'tests/history-snapshot-fixtures.cjs', 'project/desktop/migrations/0010_sales_orders.sql', 'project/drizzle/0010_sales_orders.sql'];
assert.match(selfPin || '', /^[a-f0-9]{64}$/); assert.equal(sha(read(SELF)), selfPin);
assert(pins && typeof pins === 'object' && !Array.isArray(pins));
assert.deepEqual(Object.keys(pins).sort(), FILES.slice().sort());
for (const file of FILES) { assert.match(pins[file] || '', /^[a-f0-9]{64}$/); assert.equal(sha(read(file)), pins[file], 'Exact candidate source required: ' + file); }
const FIXTURES = {
  service: { file: 'audit-tools/sales-orders-v2-test.cjs', hash: '9a8cf4ce66398aebbd35897ce9e7533fa95fbf18696c60a0f1995ea875ebb1af', marker: "\ntest('quotation ", exports: 'fixture,S,C,Q,hasStatus,stamp' },
  history: { file: 'audit-tools/sales-orders-history-test.cjs', hash: 'bb2fb1c9a40b9d422f99cb293c8c4b7377b3d1b4ce3d6bd8b378b9ecc613d27e', marker: "\ntest('legacy marker ", exports: 'fixture,A,B,ADMIN,C,DATE,server' },
};
function fixturePrefix(spec) {
  const source = read(spec.file); assert.equal(sha(source), spec.hash, 'Unchanged original synthetic fixture required');
  const text = source.toString('utf8'), cut = text.indexOf(spec.marker);
  assert(cut > 0 && text.indexOf(spec.marker, cut + 1) === -1);
  const prefix = text.slice(0, cut); assert.equal(/^\s*test\s*\(/m.test(prefix), false, 'No original tests may be registered');
  const filename = path.join(ROOT, ...spec.file.split('/')), module = { exports: {} };
  // Includes the original isolation guard and actual Python admission before
  // either prefix imports its SQLite/business dependencies.
  vm.runInThisContext('(function(require,module,exports,__filename,__dirname){\n' + prefix + '\nmodule.exports={' + spec.exports + '};\n})', { filename })(createRequire(filename), module, module.exports, filename, path.dirname(filename));
  return module.exports;
}
const serviceFixture = fixturePrefix(FIXTURES.service), historyFixture = fixturePrefix(FIXTURES.history);
const { S, C } = serviceFixture, { randomUUID } = crypto;
const test = require('node:test');
console.log(JSON.stringify({ purpose: 'strict-170-sales-attribution-and-private-order-scope', testSha256: selfPin, sourcePins: pins, fixturePins: Object.fromEntries(Object.values(FIXTURES).map(spec => [spec.file, spec.hash])), methods: 11, actualUiVerified: false, productionDataRead: false, database: 'synthetic-memory-only' }));
const success = result => { assert(result && result.ok === true && result.status >= 200 && result.status < 300); assert(result.data?.order); return result.data.order; };
const fourXX = problem => Number.isInteger(problem?.status) && problem.status >= 400 && problem.status < 500;
function grantReview(f, who) { const grants = f.grants.get(S[who]); grants.ledger = 'manage'; grants.capabilities['sales.orders.review'] = true; }
function orderFor(f, who, id) { return f.call(who, '/api/sales-orders/' + id).data.order; }

test('O01 omitted salesStaffId preserves the old actual-operator default', t => {
  const f = serviceFixture.fixture(t); f.quote();
  const employee = success(f.create());
  assert.equal(employee.ownerId, S.a); assert.equal(employee.createdBy, S.a);
  const other = f.quote(); const admin = success(f.create('admin', other.id));
  assert.equal(admin.ownerId, S.admin); assert.equal(admin.createdBy, S.admin);
});

test('O02 admin may explicitly assign an active salesperson while preserving the true maker', t => {
  const f = serviceFixture.fixture(t); f.quote();
  const order = success(f.create('admin', undefined, { salesStaffId: S.b }));
  assert.equal(order.ownerId, S.b); assert.equal(order.ownerName, '虚构-b');
  assert.equal(order.createdBy, S.admin); assert.equal(order.createdName, '虚构-admin');
  assert.equal(order.status, 'pending');
  const event = f.db.prepare('SELECT actor_id,actor_name,action FROM sales_order_events WHERE order_id=?').get(order.id);
  assert.equal(event.actor_id, S.admin); assert.equal(event.actor_name, '虚构-admin'); assert.equal(event.action, 'create');
  assert.equal(f.call('b', '/api/collaboration/personal-sales-orders?month=2026-10').data.summary.pending.orderCount, 1);
  assert.equal(f.call('a', '/api/collaboration/personal-sales-orders?month=2026-10').data.summary.pending.orderCount, 0);
});

test('O03 attribution grants only this order and does not transfer customer ownership or collaboration', t => {
  const f = serviceFixture.fixture(t); f.quote();
  const beforeCustomer = f.db.prepare('SELECT * FROM customers WHERE id=?').get(C);
  const beforeCollaborators = f.db.prepare('SELECT * FROM customer_collaborators WHERE customer_id=? ORDER BY staff_id').all(C);
  const order = success(f.create('admin', undefined, { salesStaffId: S.b }));
  assert.equal(orderFor(f, 'b', order.id).id, order.id);
  assert.throws(() => orderFor(f, 'a', order.id), serviceFixture.hasStatus(404));
  assert.equal(orderFor(f, 'admin', order.id).id, order.id);
  assert.deepEqual(f.db.prepare('SELECT * FROM customers WHERE id=?').get(C), beforeCustomer);
  assert.deepEqual(f.db.prepare('SELECT * FROM customer_collaborators WHERE customer_id=? ORDER BY staff_id').all(C), beforeCollaborators);
  assert.equal(f.db.prepare('SELECT owner_id FROM quotes WHERE id=?').get(order.sourceQuoteId).owner_id, S.a);
});

test('O04 employee can select only self and cannot forge another salesperson or source', t => {
  const f = serviceFixture.fixture(t); f.quote();
  assert.throws(() => f.create('a', undefined, { salesStaffId: S.b }), serviceFixture.hasStatus(403));
  assert.equal(f.count('sales_orders'), 0);
  const own = success(f.create('a', undefined, { salesStaffId: S.a }));
  assert.equal(own.ownerId, S.a); assert.equal(own.createdBy, S.a);
  const foreign = f.quote({ ownerId: S.b });
  assert.throws(() => f.create('a', foreign.id, { salesStaffId: S.a }), serviceFixture.hasStatus(404));
  assert.equal(f.count('sales_orders'), 1);
});

test('O05 selected salesperson must be a real currently active staff member and is not accepted from cached names', t => {
  const f = serviceFixture.fixture(t); f.quote();
  f.db.prepare('UPDATE staff_users SET active=0 WHERE id=?').run(S.b);
  for (const salesStaffId of [S.b, '10000000-0000-4000-8000-999999999999', 'not-a-staff-id', null]) {
    assert.throws(() => f.create('admin', undefined, { salesStaffId }), fourXX);
    assert.equal(f.count('sales_orders'), 0); assert.equal(f.count('sales_order_events'), 0);
  }
  f.db.prepare('UPDATE staff_users SET active=1,name=? WHERE id=?').run('虚构-b-当前真实姓名', S.b);
  const order = success(f.create('admin', undefined, { salesStaffId: S.b }));
  assert.equal(order.ownerName, '虚构-b-当前真实姓名'); assert.equal(order.createdName, '虚构-admin');
});

test('O06 attribution is part of the durable creation identity and cannot change under one request', t => {
  const f = serviceFixture.fixture(t); f.quote(); const requestId = randomUUID();
  const first = f.create('admin', undefined, { requestId, salesStaffId: S.a });
  const order = success(first), again = f.create('admin', undefined, { requestId, salesStaffId: S.a });
  assert.equal(again.data.duplicate, true); assert.equal(again.data.order.id, order.id);
  assert.throws(() => f.create('admin', undefined, { requestId, salesStaffId: S.b }), serviceFixture.hasStatus(409));
  assert.equal(f.count('sales_orders'), 1); assert.equal(f.count('sales_order_events'), 1);
});

test('O07 neither true maker nor assigned salesperson may approve or reject their own order', t => {
  const f = serviceFixture.fixture(t); f.quote(); grantReview(f, 'b');
  const order = success(f.create('admin', undefined, { salesStaffId: S.b }));
  for (const who of ['admin', 'b']) for (const decision of ['approve', 'reject']) {
    assert.throws(() => f.review(order, who, { decision }), serviceFixture.hasStatus(403));
    assert.equal(orderFor(f, 'admin', order.id).status, 'pending');
    assert.equal(f.count('sales_order_events'), 1);
  }
  const approved = success(f.review(order, 'finance'));
  assert.equal(approved.status, 'approved'); assert.equal(approved.ownerId, S.b); assert.equal(approved.createdBy, S.admin);
});

test('O08 independent finance may reject an attribution error then reopen with corrected ownership and retained audit history', t => {
  const f = serviceFixture.fixture(t); f.quote();
  const wrong = success(f.create('admin', undefined, { salesStaffId: S.b }));
  const rejected = success(f.review(wrong, 'finance', { decision: 'reject', note: '虚构所属销售选择有误，退回后重新开单' }));
  assert.equal(rejected.status, 'rejected');
  const corrected = success(f.create('admin', undefined, { salesStaffId: S.a }));
  assert.notEqual(corrected.id, wrong.id); assert.equal(corrected.previousId, wrong.id); assert.equal(corrected.ownerId, S.a);
  assert.equal(orderFor(f, 'admin', wrong.id).ownerId, S.b);
  assert.equal(orderFor(f, 'admin', wrong.id).status, 'rejected');
  const events = f.db.prepare('SELECT order_id,actor_id,action,note FROM sales_order_events ORDER BY rowid').all();
  assert.deepEqual(events.map(event => event.action), ['create', 'reject', 'create']);
  assert.equal(events[1].actor_id, S.finance); assert.match(events[1].note, /选择有误/);
  assert.equal(f.call('a', '/api/collaboration/personal-sales-orders?month=2026-10').data.summary.effective.orderCount, 1);
  assert.equal(f.call('b', '/api/collaboration/personal-sales-orders?month=2026-10').data.summary.effective.orderCount, 0);
});

test('O09 source quotation owner cannot read another owners order ID number or status through quotation detail or list', async t => {
  const f = historyFixture.fixture(t), q = f.quote(), order = f.create(q, historyFixture.ADMIN);
  f.actor(historyFixture.A);
  const detail = await historyFixture.server.getQuote(q.id), listing = await f.page({ status: 'all' });
  for (const record of [detail.quote, ...listing.quotes]) {
    assert.equal(record.salesOrder ?? null, null, 'A source-root association does not grant another owner order metadata');
    assert.equal(JSON.stringify(record).includes(order.id), false);
    assert.equal(JSON.stringify(record).includes(order.number), false);
  }
  f.actor(historyFixture.ADMIN);
  const authorized = await historyFixture.server.getQuote(q.id);
  assert.equal(authorized.quote.salesOrder.id, order.id); assert.equal(authorized.quote.salesOrder.status, 'pending');
});

test('O10 confirmed quotation filtering is scoped to the viewers own attributed orders while admin may see all', async t => {
  const f = historyFixture.fixture(t), q = f.quote(), order = f.create(q, historyFixture.ADMIN);
  assert.equal((await f.page({ status: 'confirmed' })).total, 0, 'Foreign owner status must not leak through a count filter');
  const unconfirmed = await f.page({ status: 'unconfirmed' }); assert.equal(unconfirmed.total, 1); assert.equal(unconfirmed.quotes[0].id, q.id);
  f.actor(historyFixture.ADMIN);
  const admin = await historyFixture.server.quotePage(f.request('/api/quotes?status=confirmed'));
  assert.equal(admin.total, 1); assert.equal(admin.quotes[0].salesOrder.id, order.id);
});

test('O11 assigned order ownership does not grant the original private source quote or alter its owner', async t => {
  const f = historyFixture.fixture(t), q = f.quote();
  const order = f.create(q, historyFixture.ADMIN, { salesStaffId: historyFixture.B });
  assert.equal(order.ownerId, historyFixture.B); assert.equal(order.createdBy, historyFixture.ADMIN);
  assert.equal(f.sqlite.prepare('SELECT owner_id FROM quotes WHERE id=?').get(q.id).owner_id, historyFixture.A);
  f.actor(historyFixture.B);
  await assert.rejects(historyFixture.server.getQuote(q.id), problem => problem?.status === 404);
  const ownedOrder = f.orders.handle({ id: historyFixture.B }, { path: '/api/sales-orders/' + order.id });
  assert.equal(ownedOrder.data.order.id, order.id);
  assert.equal(f.sqlite.prepare('SELECT owner_id FROM customers WHERE id=?').get(historyFixture.C).owner_id, historyFixture.A);
  f.actor(historyFixture.A);
  assert.equal((await historyFixture.server.getQuote(q.id)).quote.salesOrder ?? null, null);
});

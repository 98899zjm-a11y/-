'use strict';

// Guard before importing any business module or opening even an in-memory DB.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const root = path.resolve(__dirname, '..');
if (process.platform !== 'win32' || os.userInfo().username.toLowerCase() !== 'wdagutilityaccount' || root.toLowerCase() !== 'c:\\xjy-work\\xjy-web-stage1') throw Error('Customer directory tests require the fixed actual Windows Sandbox');
const guard = require('../stage1/isolation.cjs').createIsolationGuard(root);
const proof = require('node:child_process').spawnSync('C:\\Python314\\python.exe', ['-I', '-B', guard.assertPath(path.join(root, 'stage1/validate-sandbox-context.py'))], { cwd: root, windowsHide: true, encoding: 'utf8' });
if (proof.status !== 0) throw Error('Unchanged actual Sandbox admission failed');

const test = require('node:test'), assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { LocalD1 } = require('../project/desktop/runtime.cjs');
const { normalizePhone } = require(guard.assertPath(path.join(root, 'project/desktop/customer-identity.cjs')));
const server = require('../audit-tools/finance-guards-loader.cjs').load('server');
const history = require('./history-snapshot-fixtures.cjs');
const uuid = (prefix, n) => prefix + '0000000-0000-4000-8000-' + String(n).padStart(12, '0');
const ADMIN = uuid('1', 1), A = uuid('1', 2), B = uuid('1', 3);
const stamp = n => new Date(Date.UTC(2026, 9, 1) + n * 1000).toISOString();

function fixture(t) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  const migrations = guard.assertPath(path.join(root, 'project/desktop/migrations'));
  for (const name of fs.readdirSync(migrations).filter(name => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort()) sqlite.exec(fs.readFileSync(guard.assertPath(path.join(migrations, name)), 'utf8'));
  for (const [id, role, name] of [[ADMIN, 'admin', '虚构管理员'], [A, 'employee', '虚构员工甲'], [B, 'employee', '虚构员工乙']]) sqlite.prepare('INSERT INTO staff_users(id,user_id,email,name,role,active,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?)').run(id, 'synthetic-' + id, id + '@example.invalid', name, role, stamp(0), stamp(0));
  const db = new LocalD1(sqlite), originalPrepare = db.prepare.bind(db), trace = [];
  let quoteSerial = 0, confirmationSerial = 0;
  const f = { sqlite, db, trace, failQuoteReads: false };
  db.prepare = sql => {
    if (f.failQuoteReads && /\bquotes\b/i.test(sql)) throw Error('Synthetic directory statistics unavailable');
    const statement = originalPrepare(sql), event = { sql, bindings: [] };
    trace.push(event);
    const bind = statement.bind;
    statement.bind = function (...values) {
      assert(values.length <= 100, 'real D1 binding ceiling: ' + values.length);
      event.bindings = values;
      return bind.apply(this, values);
    };
    // Return the actual LocalD1 statement, including _execute used by batch.
    return statement;
  };
  f.actor = id => { globalThis.__financeGuardFixture = { env: { DB: db }, identity: { userId: 'synthetic-' + id, email: id + '@example.invalid', displayName: '虚构测试身份' } }; };
  f.customer = (n, options = {}) => {
    const c = { id: uuid('2', n), name: '虚构目录客户' + n, phone: '000' + String(n).padStart(8, '0'), notes: '', ownerId: A, updatedAt: stamp(n), ...options };
    // Use the real stored canonical key, not bare digits. The first Guest run's
    // normalized-phone failure was an invalid fixture, not a product defect.
    sqlite.prepare('INSERT INTO customers(id,name,phone,phone_key,notes,owner_id,created_at,updated_at,revision,deleted_at) VALUES(?,?,?,?,?,?,?,?,1,?)').run(c.id, c.name, c.phone, normalizePhone(c.phone), c.notes, c.ownerId, stamp(0), c.updatedAt, c.deletedAt || null);
    return c;
  };
  f.quote = (customer, options = {}) => {
    const n = ++quoteSerial, id = uuid('3', n), q = { id, rootId: id, version: 1, ownerId: A, type: 'sale', deletedAt: null, ...options };
    const snapshot = history.saved({ type: q.type, customerId: customer.id, customer: { id: customer.id, name: customer.name, phone: customer.phone }, issuedBy: { id: q.ownerId, name: '虚构测试员工' } });
    sqlite.prepare('INSERT INTO quotes(id,number,type,customer_id,customer_name,owner_id,title,snapshot,totals,total_cents,root_id,base_quote_id,version,created_at,deleted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(q.id, 'SYNTHETIC-DIR-' + n, q.type, customer.id, customer.name, q.ownerId, '虚构报价' + n, JSON.stringify(snapshot), JSON.stringify(snapshot.calculation), 51999, q.rootId, q.version > 1 ? q.rootId : null, q.version, stamp(n), q.deletedAt);
    return q;
  };
  f.confirm = (q, cancelled = false) => {
    sqlite.prepare('INSERT INTO sale_confirmations(id,root_id,quote_id,owner_id,confirmed_by,confirmed_at,cancelled_at,cancelled_by) VALUES(?,?,?,?,?,?,?,?)').run(uuid('4', ++confirmationSerial), q.rootId, q.id, q.ownerId, ADMIN, stamp(2000 + confirmationSerial), cancelled ? stamp(3000 + confirmationSerial) : null, cancelled ? ADMIN : null);
  };
  f.collaborate = (c, staff = B) => sqlite.prepare('INSERT INTO customer_collaborators(customer_id,staff_id,active,granted_by,granted_at) VALUES(?,?,1,?,?)').run(c.id, staff, ADMIN, stamp(0));
  f.search = async (actor = A, params = {}) => { f.actor(actor); return server.searchCustomers(new Request('http://fixture.invalid/api/customers/search?' + new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)])))); };
  t.after(() => { delete globalThis.__financeGuardFixture; sqlite.close(); });
  return f;
}
function counts(result, customer) {
  assert(result.counts && typeof result.counts === 'object', 'search response must carry true authorized record counts');
  assert.deepEqual(Object.keys(result.counts).sort(), result.customers.map(c => c.id).sort(), 'statistics keys must be exactly this authorized page');
  const value = result.counts[customer.id];
  assert(value, 'returned customer must have statistics, including legitimate zero');
  for (const key of ['quoteVersionCount', 'confirmedRecordCount']) assert(Number.isSafeInteger(value[key]) && value[key] >= 0, key + ' must be a nonnegative safe integer');
  return value;
}
const body = value => new Request('http://fixture.invalid/api/customers/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });

test('directory finds name, normalized phone and notes outside the bootstrap 1000 without exposing hidden customers', async t => {
  const f = fixture(t); let oldest;
  for (let n = 1; n <= 1005; n++) { const c = f.customer(n, n === 1 ? { name: '虚构超出首千目标', phone: '138 0000 0001', notes: '独特备注铂金项链' } : {}); if (n === 1) oldest = c; }
  f.customer(2001, { ownerId: B, name: '虚构超出首千目标', notes: '独特备注铂金项链' });
  f.customer(2002, { name: '虚构超出首千目标', deletedAt: stamp(0) });
  f.actor(A);
  const bootstrap = await server.bootstrap();
  assert.equal(bootstrap.customers.length, 1000); assert.equal(bootstrap.customers.some(c => c.id === oldest.id), false);
  for (const q of ['超出首千目标', '13800000001', '独特备注铂金项链']) {
    const page = await f.search(A, { q, pageSize: 20 });
    assert.equal(page.total, 1, 'full authorized search for ' + q);
    assert.deepEqual(page.customers.map(c => c.id), [oldest.id]);
  }
});

test('directory reports full scoped total and stable nonoverlapping pages rather than bootstrap length', async t => {
  const f = fixture(t);
  for (let n = 1; n <= 1005; n++) f.customer(n, { updatedAt: stamp(1) });
  f.customer(2001, { ownerId: B }); f.customer(2002, { deletedAt: stamp(0) });
  const first = await f.search(A, { page: 1, pageSize: 200 }), second = await f.search(A, { page: 2, pageSize: 200 }), last = await f.search(A, { page: 6, pageSize: 200 });
  assert.equal(first.total, 1005); assert.equal(second.total, 1005); assert.equal(last.total, 1005);
  assert.equal(first.customers.length, 200); assert.equal(last.customers.length, 5);
  assert(first.customers.every((c, i, values) => !i || values[i - 1].id > c.id));
  assert.equal(first.customers.some(c => second.customers.some(other => c.id === other.id)), false);
  for (const c of last.customers) assert.deepEqual(counts(last, c), { quoteVersionCount: 0, confirmedRecordCount: 0 });
});

test('record counts include all 205 saved versions and match complete activity totals beyond the recent 200', async t => {
  const f = fixture(t), c = f.customer(1);
  for (let n = 0; n < 205; n++) f.quote(c);
  f.actor(A); assert.equal((await server.listQuotes(f.db, { id: A, role: 'employee' })).length, 200);
  const result = await f.search(A, { q: c.phone }), stats = counts(result, c);
  assert.deepEqual(stats, { quoteVersionCount: 205, confirmedRecordCount: 0 });
  f.actor(A);
  const activity = await server.customerActivity(new Request('http://fixture.invalid/api/customers/' + c.id + '/activity?basis=quotes&pageSize=20'), c.id);
  assert.equal(activity.total, stats.quoteVersionCount); assert.equal(activity.orders.length, 20);
  assert.equal(activity.summary.orderCount, 205); assert.equal(activity.summary.total, 106597.95); assert.equal(activity.summary.netBalance, 106597.95);
});

test('versions count separately while active exact confirmed version counts once, cancel and soft-delete remove it', async t => {
  const f = fixture(t), c = f.customer(1), v1 = f.quote(c), v2 = f.quote(c, { rootId: v1.id, version: 2 }), v3 = f.quote(c, { rootId: v1.id, version: 3 });
  f.quote(c, { type: 'custom' }); f.quote(c, { type: 'tradein' }); f.quote(c, { type: 'recycling' }); f.quote(c, { type: 'repair' });
  f.confirm(v1, true); f.confirm(v2);
  const deleted = f.quote(c, { deletedAt: stamp(999) }); f.confirm(deleted);
  assert.deepEqual(counts(await f.search(A), c), { quoteVersionCount: 7, confirmedRecordCount: 1 });
  f.actor(A);
  const confirmed = await server.customerActivity(new Request('http://fixture.invalid/api/customers/' + c.id + '/activity?basis=confirmed'), c.id);
  assert.equal(confirmed.total, 1); assert.equal(confirmed.orders[0].id, v2.id);
  // Existing history status intentionally matches all three series versions.
  const historyPage = await server.quotePage(new Request('http://fixture.invalid/api/quotes?customerId=' + c.id + '&status=confirmed'));
  assert.equal(historyPage.total, 3);
  f.sqlite.prepare('UPDATE sale_confirmations SET cancelled_at=?,cancelled_by=? WHERE quote_id=? AND cancelled_at IS NULL').run(stamp(4000), ADMIN, v2.id);
  assert.equal(counts(await f.search(A), c).confirmedRecordCount, 0);
  f.confirm(v3);
  assert.deepEqual(counts(await f.search(A), c), { quoteVersionCount: 7, confirmedRecordCount: 1 });
});

test('collaboration exposes the customer but never another employee record count or readable quote', async t => {
  const f = fixture(t), c = f.customer(1); f.collaborate(c);
  let aQuote;
  for (let n = 0; n < 202; n++) { const q = f.quote(c); if (!n) aQuote = q; }
  for (let n = 0; n < 3; n++) f.quote(c, { ownerId: B });
  f.confirm(aQuote);
  const expected = [[ADMIN, 205, 1], [A, 202, 1], [B, 3, 0]];
  for (const [actor, versions, confirmed] of expected) {
    const page = await f.search(actor);
    assert.equal(page.total, 1); assert.deepEqual(counts(page, c), { quoteVersionCount: versions, confirmedRecordCount: confirmed });
    if (actor === B) { assert.equal(page.customers[0].access.canEdit, false); f.actor(B); await assert.rejects(server.getQuote(aQuote.id), error => error.status === 404); }
  }
});

test('revocation and responsibility transfer change customer visibility without transferring historic quote ownership', async t => {
  const f = fixture(t), c = f.customer(1); f.collaborate(c);
  const qa = f.quote(c), qb = f.quote(c, { ownerId: B });
  f.actor(ADMIN); await server.manageCustomerCollaborator(body({ staffId: B, granted: false, revision: 1 }), c.id);
  const revoked = await f.search(B); assert.equal(revoked.total, 0); assert.deepEqual(revoked.customers, []); assert.deepEqual(revoked.counts, {});
  f.actor(B); await assert.rejects(server.customerActivity(new Request('http://fixture.invalid/api/customers/' + c.id + '/activity'), c.id), error => error.status === 404);
  const state = (await f.search(ADMIN)).customers[0];
  f.actor(ADMIN); await server.transferCustomer(body({ ownerId: B, expectedOwnerId: A, revision: state.revision, reason: '虚构目录权限交接验收' }), c.id);
  assert.deepEqual(counts(await f.search(B), c), { quoteVersionCount: 1, confirmedRecordCount: 0 });
  assert.equal((await f.search(A)).total, 0);
  f.actor(A); assert.equal((await server.getQuote(qa.id)).quote.ownerId, A);
  f.actor(B); assert.equal((await server.getQuote(qb.id)).quote.ownerId, B);
});

test('200-row page uses bounded grouped real SQL through LocalD1.batch and statistics keys never leak another page', async t => {
  const f = fixture(t);
  for (let n = 1; n <= 205; n++) { const c = f.customer(n); f.quote(c); }
  const hidden = f.customer(999, { ownerId: B }); f.quote(hidden);
  f.trace.length = 0;
  const page = await f.search(A, { pageSize: 200 });
  assert.equal(page.total, 205); assert.equal(page.customers.length, 200);
  for (const c of page.customers) assert.deepEqual(counts(page, c), { quoteVersionCount: 1, confirmedRecordCount: 0 });
  assert.equal(Object.hasOwn(page.counts, hidden.id), false);
  const quoteReads = f.trace.filter(entry => /\bquotes\b/i.test(entry.sql));
  assert(quoteReads.length >= 1 && quoteReads.length <= 3, 'page statistics must be grouped, at most 3 queries for 200 customers');
  assert(quoteReads.every(entry => entry.bindings.length <= 91), '90 IDs plus at most current staff binding');
  f.trace.length = 0;
  const empty = await f.search(A, { page: 20, pageSize: 200 });
  assert.equal(empty.total, 205); assert.deepEqual(empty.customers, []); assert.deepEqual(empty.counts, {});
  assert.equal(f.trace.some(entry => /\bquotes\b/i.test(entry.sql)), false, 'empty pages need no quotes query');
});

test('search bounds and literal SQL-like strings preserve the existing strict API contract', async t => {
  const f = fixture(t); f.customer(1, { name: '虚构字面量%_客户' });
  for (const params of [{ q: 'x'.repeat(121) }, { page: 0 }, { page: 100001 }, { pageSize: 0 }, { pageSize: 201 }, { unknown: '1' }]) await assert.rejects(f.search(A, params), error => error.name === 'ZodError');
  assert.equal((await f.search(A, { q: '%_' })).total, 1);
  assert.equal((await f.search(A, { q: "' OR 1=1 --" })).total, 0);
});

test('statistics query failures fail explicitly instead of manufacturing valid zero counts', async t => {
  const f = fixture(t); f.customer(1); f.failQuoteReads = true;
  await assert.rejects(f.search(A), /Synthetic directory statistics unavailable/);
});

test('inactive actors are rejected before any customer or statistics result is returned', async t => {
  const f = fixture(t); f.customer(1); f.sqlite.prepare('UPDATE staff_users SET active=0 WHERE id=?').run(A);
  await assert.rejects(f.search(A), error => error.status === 403);
});

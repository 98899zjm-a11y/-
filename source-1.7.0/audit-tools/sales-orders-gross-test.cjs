'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const ROOT = path.resolve(__dirname, '..');
if (process.platform !== 'win32' || os.userInfo().username.toLowerCase() !== 'wdagutilityaccount' || ROOT.toLowerCase() !== 'c:\\xjy-work\\xjy-web-stage1') throw Error('Saved order gross tests require the fixed actual Windows Sandbox');
const guard = require('../stage1/isolation.cjs').createIsolationGuard(ROOT);
const proof = require('node:child_process').spawnSync('C:\\Python314\\python.exe', ['-I', '-B', guard.assertPath(path.join(ROOT, 'stage1/validate-sandbox-context.py'))], { cwd: ROOT, windowsHide: true, encoding: 'utf8' });
if (proof.status !== 0) throw Error('Unchanged actual Sandbox admission failed');
const test = require('node:test'), assert = require('node:assert/strict'), { DatabaseSync } = require('node:sqlite'), { randomUUID } = require('node:crypto');
const { LocalD1 } = require('../project/desktop/runtime.cjs'), { createSalesOrders } = require('../project/desktop/sales-orders.cjs'), history = require('../tests/history-snapshot-fixtures.cjs');
const core = require('./finance-guards-loader.cjs').load('server');
const A = '10000000-0000-4000-8000-000000000001', C = '20000000-0000-4000-8000-000000000001', DATE = '2026-10-19T09:30:00.000Z';
function fixture(t) {
  const sqlite = new DatabaseSync(':memory:'); t.after(() => { delete globalThis.__financeGuardFixture; sqlite.close(); }); sqlite.exec('PRAGMA foreign_keys=ON');
  const migrations = guard.assertPath(path.join(ROOT, 'project/desktop/migrations'));
  for (const name of fs.readdirSync(migrations).filter(name => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort()) sqlite.exec(fs.readFileSync(guard.assertPath(path.join(migrations, name)), 'utf8'));
  sqlite.prepare("INSERT INTO staff_users(id,user_id,email,name,role,active,created_at,updated_at) VALUES(?,?,?,?, 'employee',1,?,?)").run(A, 'synthetic-' + A, A + '@example.invalid', '虚构快照员工', DATE, DATE);
  sqlite.prepare('INSERT INTO customers(id,name,phone,notes,owner_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(C, '虚构克换克客户', '00000000000', '', A, DATE, DATE);
  globalThis.__financeGuardFixture = { env: { DB: new LocalD1(sqlite) }, identity: { userId: 'synthetic-' + A, email: A + '@example.invalid', displayName: '虚构快照员工' } };
  const orders = createSalesOrders({ runtime: { sqlite }, administration: { requireAccess() {}, requireCapability() {}, requireAdmin() { throw Error('fixture does not grant admin'); } }, clock: () => Date.parse(DATE) });
  function quote(type = 'tradein', gross = undefined) {
    const id = randomUUID(), snapshot = type === 'custom' ? history.saved({ type: 'custom' }) : history.singleItem(); snapshot.type = type; snapshot.customerId = C; snapshot.customer = { id: C, name: '虚构克换克客户', phone: '00000000000' }; snapshot.issuedBy = { id: A, name: '虚构快照员工' };
    if (type === 'tradein') {
      const item = { id: 'synthetic-gram-line', title: '虚构十克换新', material: '足金', specs: '', image: '', weight: 10, quantity: 1, goldPrice: 500, laborPrice: 20, extras: [] };
      snapshot.saleItems = []; snapshot.tradeInItems = [item]; snapshot.weight = 10; snapshot.goldPrice = 500; snapshot.laborPrice = 20;
      snapshot.tradeIn = { mode: 'gram', oldMaterial: 'gold', oldWeight: 10, depreciationPrice: 5, excessMode: 'recycle', excessGoldPrice: 0, excessCoefficient: 1 };
      snapshot.calculation = history.totals({ metal: 0, labor: 200, extras: 0, subtotal: 250, discount: 0, total: 250, balance: 250, depreciation: 50, exchangeWeight: 10, additionalWeight: 0, excessWeight: 0, exchangeCredit: 0, itemTotals: [{ id: item.id, metal: 0, labor: 200, extras: 0, depreciation: 50, subtotal: 250, total: 250, weight: 10, quantity: 1, exchangeWeight: 10, additionalWeight: 0 }] });
    }
    if (gross !== undefined) snapshot.calculation.grossNewJewelryValue = gross;
    sqlite.prepare('INSERT INTO quotes(id,number,type,customer_id,customer_name,owner_id,title,snapshot,totals,total_cents,root_id,version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, 'SYNTHETIC-GROSS-' + id, type, C, snapshot.customer.name, A, snapshot.title, JSON.stringify(snapshot), JSON.stringify(snapshot.calculation), Math.round(snapshot.calculation.total * 100), id, 1, DATE);
    return { id, snapshot };
  }
  const create = (q, businessDate = '2026-10-19') => orders.handle({ id: A }, { path: '/api/sales-orders', method: 'POST', body: { requestId: randomUUID(), quoteId: q.id, businessDate } }).data.order;
  const report = () => core.salesReport(new Request('http://fixture.invalid/api/reports/sales?basis=confirmed&month=2026-10'));
  const activity = () => core.customerActivity(new Request('http://fixture.invalid/api/customers/' + C + '/activity?basis=confirmed'), C);
  return { sqlite, quote, create, report, activity };
}
function unavailable(value) { assert.equal(value.grossNewJewelryValue, null); assert.equal(value.amountBreakdown.grossNewJewelryValue.available, false); assert.equal(value.amountBreakdown.grossNewJewelryValue.reason, 'not-saved'); }

test('gram-exchange saved charges are not a saved complete-goods price in detail total staff or day', async t => { const f = fixture(t); f.create(f.quote()); const report = await f.report(); unavailable(report.orders[0]); unavailable(report.summary); unavailable(report.staff[0]); unavailable(report.daily[0]); assert.equal(report.orders[0].amountBreakdown.savedSubtotal, 250); assert.equal(report.orders[0].netBalance, 250); assert.equal(report.summary.netBalance, 250); const activity = await f.activity(); unavailable(activity.orders[0]); unavailable(activity.summary); unavailable(activity.byType[0]); });
test('current source price and totals cannot reconstruct an unavailable frozen gross after opening', async t => { const f = fixture(t), q = f.quote(), order = f.create(q); q.snapshot.tradeInItems[0].goldPrice = 9999; q.snapshot.calculation.subtotal = 99999; f.sqlite.prepare('UPDATE quotes SET snapshot=?,totals=?,total_cents=? WHERE id=?').run(JSON.stringify(q.snapshot), JSON.stringify(q.snapshot.calculation), 9999900, q.id); const report = await f.report(); unavailable(report.orders[0]); assert.equal(report.orders[0].id, order.id); assert.equal(report.orders[0].netBalance, 250); assert.equal(report.orders[0].amountBreakdown.savedSubtotal, 250); });
test('an explicitly saved sale or custom gross remains available without recalculating unit prices', async t => { const f = fixture(t); const sale = f.quote('sale', 519.99), custom = f.quote('custom', 519.99); f.create(sale); f.create(custom); f.sqlite.prepare('UPDATE quotes SET snapshot=?,totals=?,total_cents=1').run('{}', '{}'); const report = await f.report(); assert.equal(report.orders.length, 2); for (const value of [...report.orders, report.summary, report.staff[0], report.daily[0]]) { assert.equal(value.amountBreakdown.grossNewJewelryValue.available, true); assert.equal(value.amountBreakdown.grossNewJewelryValue.source, 'saved'); } assert(report.orders.every(row => row.grossNewJewelryValue === 519.99)); assert.equal(report.summary.grossNewJewelryValue, 1039.98); });
test('mixed known and missing prices do not publish a partial gross as a complete aggregate', async t => { const f = fixture(t); f.create(f.quote('sale', 519.99)); f.create(f.quote()); const report = await f.report(); unavailable(report.summary); unavailable(report.staff[0]); unavailable(report.daily[0]); assert.equal(report.summary.netBalance, 769.99); assert(report.orders.some(row => row.grossNewJewelryValue === 519.99)); assert(report.orders.some(row => row.grossNewJewelryValue === null)); });
test('empty confirmed data can report zero while no order or missing source is invented', async t => { const f = fixture(t), report = await f.report(); assert.equal(report.total, 0); assert.equal(report.summary.orderCount, 0); assert.equal(report.summary.grossNewJewelryValue, 0); assert.deepEqual(report.staff, []); assert.deepEqual(report.daily, []); });
test('malformed explicit saved gross is rejected rather than coerced to a number or replaced by subtotal', async t => { const f = fixture(t); f.create(f.quote('sale', '519.99')); await assert.rejects(f.report(), error => error.status === 409); });

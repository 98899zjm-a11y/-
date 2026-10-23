'use strict';

// Root-only actual offline Sandbox admission precedes imports and every DB.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const ROOT = path.resolve(__dirname, '..');
if (process.platform !== 'win32' || os.userInfo().username.toLowerCase() !== 'wdagutilityaccount' || ROOT.toLowerCase() !== 'c:\\xjy-work\\xjy-web-stage1') throw Error('Sales order migration tests require the fixed actual Windows Sandbox');
const guard = require('../stage1/isolation.cjs').createIsolationGuard(ROOT);
const proof = require('node:child_process').spawnSync('C:\\Python314\\python.exe', ['-I', '-B', guard.assertPath(path.join(ROOT, 'stage1/validate-sandbox-context.py'))], { cwd: ROOT, windowsHide: true, encoding: 'utf8' });
if (proof.status !== 0) throw Error('Unchanged actual Sandbox admission failed');

const test = require('node:test'), assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { randomUUID, createHash } = require('node:crypto');
const { createSalesOrders } = require('../project/desktop/sales-orders.cjs');
const history = require('../tests/history-snapshot-fixtures.cjs');
const DATE = '2026-10-19T08:00:00.000Z';
const A = '10000000-0000-4000-8000-000000000001', REVIEWER = '10000000-0000-4000-8000-000000000002';
const C = '20000000-0000-4000-8000-000000000001', Q = '30000000-0000-4000-8000-000000000001';
const MIGRATION = path.join(ROOT, 'project/desktop/migrations/0010_sales_orders.sql');
const bytes = file => fs.readFileSync(guard.assertPath(file));
const sql = () => bytes(MIGRATION).toString('utf8');

function fixture(t) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close()); db.exec('PRAGMA foreign_keys=ON');
  const directory = guard.assertPath(path.join(ROOT, 'project/desktop/migrations'));
  for (const file of fs.readdirSync(directory).filter(file => /^000[0-9]_[a-z0-9_]+\.sql$/.test(file)).sort()) db.exec(bytes(path.join(directory, file)).toString('utf8'));
  const oldSchema = db.prepare("SELECT name,type,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();
  db.exec(sql());
  for (const [id, name] of [[A, '虚构开单员'], [REVIEWER, '虚构审核员']]) db.prepare("INSERT INTO staff_users(id,user_id,email,name,role,active,created_at,updated_at) VALUES(?,?,?,?, 'employee',1,?,?)").run(id, 'synthetic-' + id, id + '@example.invalid', name, DATE, DATE);
  db.prepare('INSERT INTO customers(id,name,phone,notes,owner_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(C, '虚构迁移客户', '00000000000', '', A, DATE, DATE);
  const snapshot = history.singleItem(); snapshot.customerId = C; snapshot.customer = { id: C, name: '虚构迁移客户', phone: '00000000000' }; snapshot.issuedBy = { id: A, name: '虚构开单员' };
  db.prepare('INSERT INTO quotes(id,number,type,customer_id,customer_name,owner_id,title,snapshot,totals,total_cents,root_id,base_quote_id,version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(Q, 'SYNTHETIC-MIGRATION', 'sale', C, snapshot.customer.name, A, snapshot.title, JSON.stringify(snapshot), JSON.stringify(snapshot.calculation), 51999, Q, null, 1, DATE);
  const users = { a: { id: A }, reviewer: { id: REVIEWER } };
  const authority = {
    requireAccess(user, module, level) { const row = db.prepare('SELECT active FROM staff_users WHERE id=?').get(user.id); if (!row?.active) throw Object.assign(Error('fixture inactive'), { status: 401 }); if (module === 'sales' && user.id === A || module === 'ledger' && user.id === REVIEWER) return {}; throw Object.assign(Error('fixture denied'), { status: 403 }); },
    requireCapability(user, key) { if (key === 'personal.sales.view') return {}; if (key === 'sales.orders.review' && user.id === REVIEWER) return {}; throw Object.assign(Error('fixture capability denied'), { status: 403 }); },
    requireAdmin() { throw Object.assign(Error('fixture admin denied'), { status: 403 }); },
  };
  const service = createSalesOrders({ runtime: { sqlite: db }, administration: authority, clock: () => Date.parse(DATE) });
  const call = (name, address, method = 'GET', body) => service.handle(users[name], { path: address, method, ...(body === undefined ? {} : { body }) });
  const create = () => call('a', '/api/sales-orders', 'POST', { requestId: randomUUID(), quoteId: Q, businessDate: '2026-10-19' }).data.order;
  const count = table => db.prepare('SELECT count(*) n FROM ' + table).get().n;
  return { db, service, oldSchema, call, create, count };
}

test('desktop and drizzle sales order migration sources have identical bytes', () => {
  const desktop = bytes(MIGRATION), drizzle = bytes(path.join(ROOT, 'project/drizzle/0010_sales_orders.sql'));
  assert(desktop.equals(drizzle)); assert.equal(createHash('sha256').update(desktop).digest('hex'), '328d22077a9fbb5e59ee4001a680433aaf2fb4df69773b35bcbb026dd3586356');
});

test('migration can execute twice before and after orders without changing old schema or records', t => {
  const f = fixture(t); f.db.exec(sql());
  const order = f.create(), tables = ['sales_orders', 'sales_order_events', 'sales_order_sequences', 'quotes', 'sale_confirmations', 'sales_publications'];
  const before = tables.map(table => [table, f.db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all()]);
  f.db.exec(sql());
  for (const [table, rows] of before) assert.deepEqual(f.db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all(), rows, table + ' must remain unchanged');
  for (const original of f.oldSchema) assert.deepEqual(f.db.prepare('SELECT name,type,sql FROM sqlite_master WHERE name=?').get(original.name), original, 'original schema object ' + original.name);
  assert.equal(f.count('sales_orders'), 1); assert.equal(f.count('sales_order_events'), 1); assert.equal(order.number, 'SO20261019-000001');
});

test('submitted source identity and snapshot plus existing order events cannot be rewritten or deleted', t => {
  const f = fixture(t), order = f.create(), original = f.db.prepare('SELECT * FROM sales_orders WHERE id=?').get(order.id), event = f.db.prepare('SELECT * FROM sales_order_events WHERE order_id=?').get(order.id);
  for (const [column, value] of [['number', 'SYNTHETIC-REWRITE'], ['owner_id', REVIEWER], ['created_by', REVIEWER], ['snapshot_json', '{}'], ['totals_json', '{}'], ['amount_cents', '1'], ['weight_micros', '1'], ['content_hash', '0'.repeat(64)], ['source_quote_id', randomUUID()], ['request_id', randomUUID()]]) {
    assert.throws(() => f.db.prepare('UPDATE sales_orders SET ' + column + '=? WHERE id=?').run(value, order.id), /immutable/);
  }
  assert.throws(() => f.db.prepare('DELETE FROM sales_orders WHERE id=?').run(order.id), /retained/);
  assert.throws(() => f.db.prepare('UPDATE sales_order_events SET note=? WHERE id=?').run('不能重写', event.id), /immutable/);
  assert.throws(() => f.db.prepare('DELETE FROM sales_order_events WHERE id=?').run(event.id), /retained/);
  assert.deepEqual(f.db.prepare('SELECT * FROM sales_orders WHERE id=?').get(order.id), original); assert.deepEqual(f.db.prepare('SELECT * FROM sales_order_events WHERE id=?').get(event.id), event);
});

test('SQL rejects a second effective source root while explicit void retains the original and releases the root', t => {
  const f = fixture(t), order = f.create(), original = f.db.prepare('SELECT * FROM sales_orders WHERE id=?').get(order.id);
  const duplicate = { ...original, id: randomUUID(), number: 'SO20261019-999999', request_id: randomUUID() }, columns = Object.keys(duplicate);
  assert(columns.every(column => /^[a-z_]+$/.test(column)));
  assert.throws(() => f.db.prepare('INSERT INTO sales_orders(' + columns.join(',') + ') VALUES(' + columns.map(() => '?').join(',') + ')').run(...columns.map(column => duplicate[column])), /UNIQUE constraint/);
  assert.equal(f.count('sales_orders'), 1);
  f.call('a', '/api/sales-orders/' + order.id + '/void', 'POST', { requestId: randomUUID(), revision: order.revision, contentHash: order.contentHash, note: '虚构主动核对后作废' });
  const next = f.create(); assert.notEqual(next.id, order.id); assert.equal(next.previousId, order.id); assert.equal(next.number, 'SO20261019-000002'); assert.equal(f.count('sales_orders'), 2); assert.equal(f.db.prepare('SELECT status FROM sales_orders WHERE id=?').get(order.id).status, 'voided');
});

test('event failure after repeated migration rolls back order and sequence then permits one clean retry', t => {
  const f = fixture(t); f.db.exec(sql());
  f.db.exec("CREATE TRIGGER synthetic_migration_event_failure BEFORE INSERT ON sales_order_events BEGIN SELECT RAISE(ABORT,'synthetic migrated event failure'); END");
  assert.throws(() => f.create(), /synthetic migrated event failure/);
  assert.equal(f.count('sales_orders'), 0); assert.equal(f.count('sales_order_events'), 0); assert.equal(f.count('sales_order_sequences'), 0);
  f.db.exec(sql()); assert.equal(f.count('sales_orders'), 0); f.db.exec('DROP TRIGGER synthetic_migration_event_failure');
  const order = f.create(); assert.equal(order.number, 'SO20261019-000001'); assert.equal(f.count('sales_orders'), 1); assert.equal(f.count('sales_order_events'), 1); assert.equal(f.count('sales_order_sequences'), 1);
});

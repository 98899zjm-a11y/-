'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./finance-guards-loader.cjs');
const server = load('server');
const history = require('../tests/history-snapshot-fixtures.cjs');
const STAFF = '10000000-0000-4000-8000-000000000001';
const QUOTE = '30000000-0000-4000-8000-000000000001';

function fixture(t, savedTotals) {
  const snapshot = history.saved();
  delete snapshot.calculation;
  const row = { id: QUOTE, number: 'FAKE-HISTORY-001', type: 'sale', customer_id: snapshot.customerId, customer_name: snapshot.customer.name, owner_id: STAFF, title: snapshot.title, snapshot: JSON.stringify(snapshot), totals: JSON.stringify(savedTotals), total_cents: 51999, root_id: QUOTE, base_quote_id: null, version: 1, created_at: '2026-10-12T12:00:00Z' };
  const db = { prepare(sql) {
    let values = [];
    return { bind(...args) { values = args; return this; },
      async first() {
        if (sql === 'SELECT * FROM staff_users WHERE user_id=?') { assert.deepEqual(values, ['fixture-identity']); return { id: STAFF, user_id: 'fixture-identity', email: 'fixture@example.invalid', name: '虚构管理员', role: 'admin', active: 1, created_at: '2026-10-15', updated_at: '2026-10-15' }; }
        if (sql.startsWith('SELECT q.*,a.images AS attached_images,') && sql.endsWith(' WHERE q.id=? AND q.deleted_at IS NULL')) { assert.deepEqual(values, [QUOTE]); return row; }
        throw Error('Unexpected synthetic first query: ' + sql);
      },
      async run() { assert.match(sql, /^INSERT OR IGNORE INTO company_settings/); return { meta: { changes: 0 } }; },
      async all() { assert.equal(sql, "SELECT * FROM audit_logs WHERE entity_type='quote' AND entity_id=? ORDER BY created_at,id"); assert.deepEqual(values, [QUOTE]); return { results: [] }; },
    };
  } };
  globalThis.__financeGuardFixture = { env: { DB: db }, identity: { userId: 'fixture-identity', email: 'fixture@example.invalid', displayName: '虚构管理员' } };
  t.after(() => { delete globalThis.__financeGuardFixture; });
}

test('F2 getQuote fills missing snapshot calculation from the complete stored row totals', async t => {
  fixture(t, history.totals());
  const { quote } = await server.getQuote(QUOTE);
  // The frozen input says 500+20=520, but the actual saved total was 519.99.
  assert.equal(quote.snapshot.calculation.subtotal, 519.99);
  assert.equal(quote.snapshot.calculation.metal, 499.99);
  assert.equal(quote.snapshot.calculation.labor, 20);
  assert.equal(quote.snapshot.calculation.total, 519.99);
  assert.equal(quote.data.calculation.total, 519.99);
  assert.equal(quote.total, 519.99);
});

test('F2 getQuote preserves missing historical detail instead of inventing a zero subtotal', async t => {
  fixture(t, {});
  const { quote } = await server.getQuote(QUOTE);
  assert.equal(quote.total, 519.99, 'the stored authoritative total remains readable');
  assert.equal(quote.snapshot.calculation.total, 519.99);
  assert.equal(Object.hasOwn(quote.snapshot.calculation, 'subtotal'), false, 'missing saved subtotal must stay missing so presentation can explain incomplete history');
  assert.equal(Object.hasOwn(quote.snapshot.calculation, 'metal'), false);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./finance-guards-loader.cjs');
const domain = load('domain');
const server = load('server');
const preview = load('preview');
const STAFF = '10000000-0000-4000-8000-000000000001';
const CUSTOMER = '20000000-0000-4000-8000-000000000001';
function input(patch = {}) {
  return { type: 'tradein', customerId: CUSTOMER, title: '虚构换新', material: '黄金', specs: '', image: '', images: [], weight: 12, goldPrice: 500, laborPrice: 20, extras: [{ id: 'extra', name: '虚构配件', amount: 35.5 }], discountType: 'none', discountValue: 0, recyclingCoefficient: 1, repairItems: [], insured: false, insuredValue: 0, insuranceRate: 6, note: '', paymentMethods: [], saleItems: [], recyclingItems: [], tradeInItems: [], customConfirmations: [], tradeIn: { mode: 'gram', oldMaterial: 'gold', oldWeight: 10, depreciationPrice: 20, excessMode: 'recycle', excessGoldPrice: 450, excessCoefficient: 0.99 }, ...patch };
}
function item(id, weight, material = '黄金', extras = []) { return { id, title: '虚构首饰', material, specs: '', image: '', weight, goldPrice: 500, laborPrice: 20, extras, quantity: 1 }; }

for (const [material, oldMaterial] of [['Pt950', 'gold'], ['黄金', 'platinum'], ['Au750', 'gold'], ['Pt900', 'platinum']]) {
  test(`F1 schema rejects single gram exchange ${material}/${oldMaterial} with material-specific guidance`, () => {
    const result = domain.quoteInputSchema.safeParse(input({ material, tradeIn: { ...input().tradeIn, oldMaterial } }));
    assert.equal(result.success, false, 'single gram exchange must reject incompatible metal/grade');
    assert(result.error.issues.some(issue => issue.path.join('.') === 'material' && /折价/.test(issue.message)), 'the field issue must guide an explicit change to value exchange');
  });
  test(`F1 direct calculator rejects single gram exchange ${material}/${oldMaterial}`, () => {
    assert.throws(() => domain.calculateQuote(input({ material, tradeIn: { ...input().tradeIn, oldMaterial } })), error => error instanceof RangeError && /相同材质.*成色/.test(error.message) && /折价/.test(error.message));
  });
}
test('F1 exact reported ten-gram Pt950/gold mismatch is rejected instead of quoted as 400', () => {
  const quote = input({ material: 'Pt950', weight: 10, extras: [] });
  assert.equal(domain.quoteInputSchema.safeParse(quote).success, false);
  assert.throws(() => domain.calculateQuote(quote), RangeError);
});
test('F1 editor preview exposes mismatched single gram exchange as validation without throwing', () => {
  let result;
  assert.doesNotThrow(() => { result = preview.calculateQuote(input({ material: 'Pt950' })); });
  assert.match(result.validationMessage, /相同材质.*成色/);
  assert.match(result.validationMessage, /折价/);
});
test('F1 valid single gram exchange preserves metal labor depreciation and accessory formula', () => {
  const quote = domain.quoteInputSchema.parse(input()), result = domain.calculateQuote(quote);
  assert.equal(result.metal, 1000); assert.equal(result.labor, 240); assert.equal(result.depreciation, 200);
  assert.equal(result.extras, 35.5); assert.equal(result.total, 1475.5); assert.equal(result.exchangeWeight, 10); assert.equal(result.additionalWeight, 2);
});
test('F1 normalized same-grade alias remains valid and ungraded aliases are not widened', () => {
  const platinum = input({ material: ' ｐｔ９５０ ', weight: 10, extras: [], tradeIn: { ...input().tradeIn, oldMaterial: 'platinum' } });
  assert.equal(domain.quoteInputSchema.safeParse(platinum).success, true); assert.equal(domain.calculateQuote(platinum).total, 400);
  assert.equal(domain.quoteInputSchema.safeParse(input({ material: 'Au750' })).success, false);
});
test('F1 existing multi gram exchange still rejects a mismatched line', () => {
  const quote = input({ tradeInItems: [item('one', 10), item('two', 2, 'Pt950')] });
  const parsed = domain.quoteInputSchema.safeParse(quote);
  assert.equal(parsed.success, false); assert(parsed.error.issues.some(issue => issue.path.join('.') === 'tradeInItems.1.material'));
  assert.throws(() => domain.calculateQuote(quote), RangeError);
});
test('F1 valid multi gram exchange retains existing matched-weight and total behavior', () => {
  const quote = domain.quoteInputSchema.parse(input({ tradeInItems: [item('one', 10, '黄金', input().extras), item('two', 2)] }));
  const result = domain.calculateQuote(quote);
  assert.equal(result.total, 1475.5); assert.equal(result.itemTotals[0].subtotal, 435.5); assert.equal(result.itemTotals[1].subtotal, 1040);
});
test('F1 explicit cross-material value exchange retains normal new sale less old recycling credit', () => {
  const quote = domain.quoteInputSchema.parse(input({ material: 'Pt950', tradeIn: { ...input().tradeIn, mode: 'value' } }));
  const result = domain.calculateQuote(quote);
  // 12*(500+20)+35.50 = 6275.50; old credit 10*450*0.99 = 4455.00.
  assert.equal(result.subtotal, 6275.5); assert.equal(result.depreciation, 0); assert.equal(result.exchangeCredit, 4455); assert.equal(result.total, 1820.5);
});
test('F1 sale formula and whole-order discount remain unchanged outside gram exchange', () => {
  const quote = domain.quoteInputSchema.parse(input({ type: 'sale', weight: 10, discountType: 'percent', discountValue: 90 }));
  const result = domain.calculateQuote(quote);
  // (10*(500+20)+35.50)*0.90 = 4711.95.
  assert.equal(result.subtotal, 5235.5); assert.equal(result.discount, 523.55); assert.equal(result.total, 4711.95);
});

const zeroTotals = { metal: 0, labor: 0, extras: 0, repair: 0, subtotal: 0, discount: 0, insurance: 0, recyclingUnitPrice: 0, total: 0, depreciation: 0, exchangeWeight: 0, additionalWeight: 0, excessWeight: 0, exchangeCredit: 0, balance: 0, itemTotals: [] };
function row({ type = 'sale', totalCents = '100000000001', goldPrice = 1000000, weight = 1000, extras = [{ id: 'penny', name: '虚构附加费', amount: 0.01 }], totals = {} } = {}) {
  const total = Number(totalCents) / 100;
  const calculation = { ...zeroTotals, metal: 1000000000, extras: 0.01, subtotal: total, total, balance: total, ...totals };
  const quote = input({ type, weight, goldPrice, laborPrice: 0, extras, calculation, customer: { id: CUSTOMER, name: '虚构客户', phone: '' }, brand: domain.defaultSettings.brand, issuedBy: { id: STAFF, name: '虚构管理员' } });
  return { id: 'fake-quote', number: 'FAKE-001', type, customer_id: CUSTOMER, customer_name: '虚构客户', owner_id: STAFF, owner_name: '虚构管理员', title: '虚构销售', snapshot: JSON.stringify(quote), totals: JSON.stringify(calculation), total_cents: totalCents, root_id: 'fake-root', base_quote_id: null, version: 1, created_at: '2026-10-15T01:00:00.000Z', confirmation_id: null, confirmation_quote_id: null, confirmation_at: null, confirmation_by: null };
}
function fixture(t, rows) {
  const db = { prepare(sql) {
    let args = [];
    return { bind(...values) { args = values; return this; },
      async first() {
        if (sql === 'SELECT * FROM staff_users WHERE user_id=?') { assert.deepEqual(args, ['fixture-identity']); return { id: STAFF, user_id: 'fixture-identity', email: 'fixture@example.invalid', name: '虚构管理员', role: 'admin', active: 1, created_at: '2026-10-15', updated_at: '2026-10-15' }; }
        if (sql === 'SELECT * FROM customers WHERE id=? AND deleted_at IS NULL') { assert.deepEqual(args, [CUSTOMER]); return { id: CUSTOMER, name: '虚构客户', phone: '', notes: '', owner_id: STAFF, created_at: '2026-10-15', updated_at: '2026-10-15', revision: 1 }; }
        throw Error('Unexpected synthetic first query: ' + sql);
      },
      async run() { assert.match(sql, /^INSERT OR IGNORE INTO company_settings/); return { meta: { changes: 0 } }; },
      async all() { assert(sql.startsWith('SELECT q.id,q.number,q.type,') && sql.endsWith('LIMIT 100001'), 'only report SELECT is allowed'); return { results: rows }; },
    };
  } };
  globalThis.__financeGuardFixture = { env: { DB: db }, identity: { userId: 'fixture-identity', email: 'fixture@example.invalid', displayName: '虚构管理员' } };
  t.after(() => { delete globalThis.__financeGuardFixture; });
}
const request = () => new Request('http://fixture.invalid/api/sales-report?month=2026-10');
function safeRangeError(error) { return error instanceof server.ApiError && error.status === 413 && /缩小|按.*查看|范围/.test(error.message); }

test('F3 sales report rejects 99999 legal billion-and-one-cent orders before returning an imprecise summary', async t => {
  // Exact independent sum: 99999 * 100000000001 cents = 9999900000099999 cents.
  const single = row();
  fixture(t, Array.from({ length: 99999 }, (_, index) => ({ ...single, id: 'large-' + index, root_id: 'root-' + index })));
  await assert.rejects(server.salesReport(request()), safeRangeError);
});
test('F3 customer activity rejects the same unsafe aggregation through its public API', async t => {
  const single = row({ type: 'recycling' });
  fixture(t, Array.from({ length: 99999 }, (_, index) => ({ ...single, id: 'large-' + index, root_id: 'root-' + index })));
  await assert.rejects(server.customerActivity(new Request('http://fixture.invalid/api/customers/' + CUSTOMER + '/activity'), CUSTOMER), safeRangeError);
});
test('F3 rejects a safe-integer cent sum if the public number cannot retain its decimal cents', async t => {
  // 90071 * 100000000001 = 9007100000090071 cents, below MAX_SAFE_INTEGER.
  // At this magnitude dividing into yuan can still collapse the final cent.
  const single = row({ type: 'recycling' });
  fixture(t, Array.from({ length: 90071 }, (_, index) => ({ ...single, id: 'cent-' + index, root_id: 'root-' + index })));
  await assert.rejects(server.customerActivity(new Request('http://fixture.invalid/api/customers/' + CUSTOMER + '/activity'), CUSTOMER), safeRangeError);
});
test('F3 safe summary preserves number fields, one-cent additions and three-decimal weights', async t => {
  fixture(t, [row({ totalCents: '101', goldPrice: 1, weight: 1, totals: { metal: 1, extras: 0.01 } }), row({ totalCents: '102', goldPrice: 2, weight: 0.5, extras: [{ id: 'extra', name: '虚构附加费', amount: 0.02 }], totals: { metal: 1, extras: 0.02 } })]);
  const result = await server.salesReport(request());
  assert.equal(result.summary.orderCount, 2); assert.equal(result.summary.weight, 1.5); assert.equal(result.summary.total, 2.03);
  assert.equal(result.summary.grossNewJewelryValue, 2.03); assert.equal(result.summary.netBalance, 2.03); assert.equal(result.staff[0].total, 2.03); assert.equal(result.daily[0].total, 2.03);
  for (const value of Object.values(result.summary)) assert.equal(typeof value, 'number');
});
test('F3 refund remains signed while refund and amount-due metrics keep their original meaning', async t => {
  fixture(t, [row({ type: 'tradein', totalCents: '-101', weight: 1, goldPrice: 1, extras: [], totals: { metal: 1, extras: 0, subtotal: 1, exchangeCredit: 2.01 } })]);
  const result = await server.salesReport(request());
  assert.equal(result.summary.total, -1.01); assert.equal(result.summary.netBalance, -1.01); assert.equal(result.summary.refund, 1.01); assert.equal(result.summary.amountDue, 0); assert.equal(result.summary.oldCredit, 2.01);
});
test('F3 ordinary decimal cents and milligrams are accepted without blanket float-product rejection', async t => {
  fixture(t, [row({ type: 'recycling', totalCents: '29', weight: 0.029, goldPrice: 10, extras: [], totals: { metal: 0.29, extras: 0 } })]);
  const result = await server.customerActivity(new Request('http://fixture.invalid/api/customers/' + CUSTOMER + '/activity'), CUSTOMER);
  assert.equal(result.summary.total, 0.29); assert.equal(result.summary.weight, 0.029); assert.equal(result.byType[0].total, 0.29);
});
test('F3 empty results preserve the existing complete zero summary', async t => {
  fixture(t, []);
  const result = await server.salesReport(request());
  assert.deepEqual(result.summary, { orderCount: 0, itemCount: 0, weight: 0, total: 0, discount: 0, grossNewJewelryValue: 0, netBalance: 0, oldCredit: 0, refund: 0, amountDue: 0, oldWeight: 0, depreciation: 0 });
});

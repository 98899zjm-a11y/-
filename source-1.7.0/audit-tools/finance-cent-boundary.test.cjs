'use strict';
// F5 independent Guest behavior/controls. Expected cents below are literal
// integer ledgers, never computed from calculateQuote output. No file DB or
// real accounts/images, product entrypoint, service, Electron or pyc.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
if (process.platform !== 'win32' || ROOT.toLowerCase() !== 'c:\\xjy-work\\xjy-web-stage1') throw Error('F5 requires the actual fixed Windows Sandbox');
const guardFile = path.join(ROOT, 'stage1/guest-candidate-cdp.cjs');
if (crypto.createHash('sha256').update(fs.readFileSync(guardFile)).digest('hex') !== '59840b638d8797fb55241616cd0b8e4098075a76834a201b0e93c1a748f1bb32') throw Error('Actual Sandbox guard source changed');
require(guardFile).actualGuard();
const test = require('node:test'), assert = require('node:assert/strict');
const { load } = require('./finance-guards-loader.cjs');
const domain = load('domain'), preview = load('preview'), server = load('server');
const { DatabaseSync } = require('node:sqlite'), { LocalD1 } = require('../project/desktop/runtime.cjs');
const guard = require('../stage1/isolation.cjs').createIsolationGuard(ROOT);
const STAFF = '10000000-0000-4000-8000-000000000051', CUSTOMER = '20000000-0000-4000-8000-000000000051';
const PRECISION_CODE = 'QUOTE_AMOUNT_PRECISION_UNSAFE'; // Proposed stable input-refusal contract, pending Root approval.
const MAXIMUM = 9007199254740991n, EXACT_A = 19980000000000999n, EXACT_B = 8990000000000899n;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
function sale(patch = {}) { return domain.quoteInputSchema.parse({ type: 'sale', customerId: CUSTOMER, title: '虚构F5报价', material: '黄金', weight: 1, goldPrice: 0, laborPrice: 0, ...patch }); }
function item(id, patch = {}) { return { id, title: '虚构F5商品', material: '黄金', weight: 1, goldPrice: 0, laborPrice: 0, quantity: 1, extras: [], ...patch }; }
function extreme(kind, patch = {}) {
  return sale({ weight: 0, saleItems: [item('synthetic-f5-' + kind, { weight: 100000, goldPrice: 1000000, laborPrice: kind === 'A' ? 1000000 : 0, quantity: kind === 'A' ? 999 : 899, extras: [{ id: 'per-piece-cent', name: '虚构每件一分附加费', amount: 0.01 }] })], ...patch });
}
function nearBoundary(extra) {
  // Row1: 9,000,000,000,000,000 cents. Row2 metal:
  // 71,992,547 milligrams * 100,000,000 cents/g / 1000
  // = 7,199,254,700,000 cents. Their metal sum is
  // 9,007,199,254,700,000 cents; add literal extra cents below.
  return sale({ weight: 0, saleItems: [item('near-large', { weight: 100000, goldPrice: 1000000, quantity: 900 }), item('near-remainder', { weight: 71992.547, goldPrice: 1000000, extras: [{ id: 'remainder', name: '虚构余数费用', amount: extra }] })] });
}
function publicCents(value) {
  assert.equal(typeof value, 'number'); assert(Number.isFinite(value));
  // Test oracle reads the public decimal; no binary multiplication by 100,
  // implementation helper import, toFixed rounding or calculator-derived expected.
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value.toString());
  assert(match, 'the public amount must contain at most two decimal places');
  const magnitude = BigInt(match[2] + (match[3] || '').padEnd(2, '0'));
  return match[1] ? -magnitude : magnitude;
}
function precisionError(error) { return error instanceof RangeError && error.code === PRECISION_CODE && /金额|精确|精度/.test(error.message); }
function rejectCalculation(t, input, exact) {
  assert.throws(() => { const observed = domain.calculateQuote(input); t.diagnostic(JSON.stringify({ observedPublicSubtotal: observed.subtotal, observedPublicTotal: observed.total, independentExpectedCents: exact.toString() })); }, precisionError, 'unsafe cents must be rejected before their first lossy public conversion');
}

test('F5 documented extremes and near-boundary sales are accepted by the unchanged schema', () => {
  assert.equal(100000n * (100000000n + 100000000n) * 999n + 999n, EXACT_A);
  assert.equal(100000n * 100000000n * 899n + 899n, EXACT_B);
  for (const input of [extreme('A'), extreme('B'), nearBoundary(409.89), nearBoundary(409.90), nearBoundary(409.91), nearBoundary(409.92)]) assert.equal(domain.quoteInputSchema.safeParse(input).success, true);
  assert(EXACT_A > MAXIMUM); assert(EXACT_B < MAXIMUM);
});
test('F5 A rejects beyond-safe integer cents instead of silently changing 999 per-piece cents', t => rejectCalculation(t, extreme('A'), EXACT_A));
test('F5 B rejects safe integer cents when the public yuan decimal loses one cent', t => rejectCalculation(t, extreme('B'), EXACT_B));
test('F5 MAX_SAFE cents are rejected when their public decimal represents MAX_SAFE minus one', t => rejectCalculation(t, nearBoundary(409.91), MAXIMUM));
test('F5 MAX_SAFE plus one cents remain rejected even where the large integer happens to be representable', t => rejectCalculation(t, nearBoundary(409.92), MAXIMUM + 1n));

test('F5 near-boundary correct public decimal and complete fee ledger remain accepted', () => {
  const result = domain.calculateQuote(nearBoundary(409.89));
  assert.equal(publicCents(result.subtotal), 9007199254740989n); assert.equal(publicCents(result.total), 9007199254740989n);
  assert.equal(publicCents(result.metal), 9007199254700000n); assert.equal(publicCents(result.extras), 40989n); assert.equal(result.labor, 0);
});
test('F5 MAX_SAFE minus one is a correct public amount and must not be rejected merely for magnitude', () => {
  const result = domain.calculateQuote(nearBoundary(409.90));
  assert.equal(publicCents(result.subtotal), 9007199254740990n); assert.equal(publicCents(result.total), 9007199254740990n);
  assert.equal(publicCents(result.balance), 9007199254740990n);
});
test('F5 separate fee-ledger boundary must not invent a labor cent when re-scaling a correct public subtotal', () => {
  const result = domain.calculateQuote(nearBoundary(409.90));
  // This is a separate second-conversion defect, not evidence that this total
  // was already wrong or that a fromCents-only guard would fix the ledger.
  assert.equal(publicCents(result.total), 9007199254740990n);
  assert.equal(publicCents(result.metal), 9007199254700000n); assert.equal(publicCents(result.extras), 40990n);
  assert.equal(result.labor, 0, 'zero labor inputs cannot acquire a penny through floating multiplication of an already-public subtotal');
  assert.equal(publicCents(result.metal) + publicCents(result.labor) + publicCents(result.extras) + publicCents(result.depreciation), 9007199254740990n);
});
test('F5 ordinary 29 cents, one cent, zero and 520 yuan retain their existing number contract', () => {
  for (const [amount, cents] of [[0.29, 29n], [0.01, 1n], [0, 0n], [520, 52000n]]) {
    const result = domain.calculateQuote(sale({ extras: [{ id: 'ordinary', name: '虚构普通费用', amount }] }));
    assert.equal(result.total, amount); assert.equal(publicCents(result.total), cents); assert.equal(publicCents(result.extras), cents);
  }
});
test('F5 existing per-line half-cent rounding remains unchanged', () => {
  const input = sale({ weight: 0, saleItems: [item('half-one', { weight: 0.001, goldPrice: 5 }), item('half-two', { weight: 0.001, goldPrice: 5 })] });
  const result = domain.calculateQuote(input);
  assert.equal(result.total, 0.02); assert.equal(result.itemTotals[0].subtotal, 0.01); assert.equal(result.itemTotals[1].subtotal, 0.01);
});
test('F5 legal signed trade-in refund keeps minus 29 cents and separate recycling credit', () => {
  const input = sale({ type: 'tradein', goldPrice: 0.71, tradeIn: { mode: 'value', oldMaterial: 'gold', oldWeight: 1, depreciationPrice: 20, excessMode: 'recycle', excessGoldPrice: 1, excessCoefficient: 1 } });
  const result = domain.calculateQuote(input);
  assert.equal(result.subtotal, 0.71); assert.equal(result.exchangeCredit, 1); assert.equal(result.total, -0.29); assert.equal(result.balance, -0.29); assert.equal(publicCents(result.total), -29n);
});

for (const kind of ['A', 'B']) test('F5 unsaved preview ' + kind + ' refuses an imprecise amount and cannot create a customer quotation page', () => {
  const input = extreme(kind); let result, problem;
  try { result = preview.calculateQuote(input); } catch (error) { problem = error; }
  if (problem) assert(precisionError(problem), 'preview must expose only the known financial precision refusal');
  else assert.match(result?.validationMessage || '', /精确|精度/, 'an imprecise preview cannot return as a valid quote or silently replace its amount with zero');
  assert.throws(() => preview.createQuotePages(input, domain.defaultSettings), error => precisionError(error) || error instanceof Error && /精确|精度/.test(error.message), 'customer output must not be generated from the unsafe preview');
});

function databaseFixture(t) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => { delete globalThis.__financeGuardFixture; sqlite.close(); });
  sqlite.exec('PRAGMA foreign_keys=ON');
  const migrations = guard.assertPath(path.join(ROOT, 'project/desktop/migrations'));
  for (const file of fs.readdirSync(migrations).filter(file => /^\d{4}_[a-z0-9_]+\.sql$/.test(file)).sort()) sqlite.exec(fs.readFileSync(guard.assertPath(path.join(migrations, file)), 'utf8'));
  const stamp = '2026-10-16T00:00:00Z';
  sqlite.prepare('INSERT INTO staff_users(id,user_id,email,name,role,active,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?)').run(STAFF, 'f5-fixture-identity', 'f5@example.invalid', '虚构F5管理员', 'admin', stamp, stamp);
  sqlite.prepare('INSERT INTO customers(id,name,phone,notes,owner_id,created_at,updated_at,revision,phone_key) VALUES(?,?,?,?,?,?,?,1,NULL)').run(CUSTOMER, '虚构F5客户', '', '', STAFF, stamp, stamp);
  sqlite.prepare("INSERT INTO company_settings(id,data,updated_by,updated_at) VALUES('default',?,?,?)").run(JSON.stringify(domain.defaultSettings), STAFF, stamp);
  const objects = new Map(), bucketCalls = { put: 0, delete: 0, head: 0 };
  const bucket = {
    async put(key, bytes, options) { bucketCalls.put++; objects.set(key, { bytes: new Uint8Array(bytes), customMetadata: options.customMetadata }); },
    async delete(key) { bucketCalls.delete++; objects.delete(key); },
    async head(key) { bucketCalls.head++; return objects.get(key) || null; },
    async get(key) { return objects.get(key) || null; },
  };
  globalThis.__financeGuardFixture = { env: { DB: new LocalD1(sqlite), BUCKET: bucket }, identity: { userId: 'f5-fixture-identity', email: 'f5@example.invalid', displayName: '虚构F5管理员' } };
  async function save(input) {
    const request = new Request('http://fixture.invalid/api/quotes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...input, image: PNG }) });
    const response = await server.api(() => server.createQuote(request), 201); return { status: response.status, data: await response.json() };
  }
  function nothingSaved() {
    for (const table of ['quotes', 'quote_attachments', 'quote_image_uploads', 'quote_image_pages', 'media_assets', 'audit_logs']) assert.equal(sqlite.prepare('SELECT count(*) AS n FROM ' + table).get().n, 0, table + ' must remain empty on rejection');
    assert.equal(objects.size, 0); assert.equal(bucketCalls.put, 0); assert.equal(bucketCalls.delete, 0);
  }
  return { sqlite, save, nothingSaved, objects, bucketCalls };
}
for (const kind of ['A', 'B']) test('F5 saved-data control ' + kind + ': createQuote already rejects the extreme before quote/image writes', async t => {
  const f = databaseFixture(t), response = await f.save(extreme(kind));
  assert.equal(response.status, 400, 'existing save refusal must remain a controlled client error after precision protection');
  assert.match(response.data.error, /金额|精确|精度/); f.nothingSaved();
});
test('F5 existing one-billion-yuan inclusive save boundary still persists correctly', async t => {
  const f = databaseFixture(t), input = sale({ weight: 1000, goldPrice: 1000000 }), response = await f.save(input);
  assert.equal(domain.calculateQuote(input).total, 1000000000); assert.equal(response.status, 201); assert.equal(response.data.quote.total, 1000000000);
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM quotes').get().n, 1); assert.equal(f.sqlite.prepare('SELECT total_cents FROM quotes').get().total_cents, 100000000000);
  assert.equal(f.objects.size, 1); assert.equal(f.bucketCalls.put, 1);
});
test('F5 one billion plus one cent is a precise preview but remains rejected by the separate business save limit', async t => {
  const f = databaseFixture(t), input = sale({ weight: 1000, goldPrice: 1000000, extras: [{ id: 'over-save-limit', name: '虚构一分附加费', amount: 0.01 }] });
  assert.equal(publicCents(domain.calculateQuote(input).total), 100000000001n, 'the numerical guard cannot be replaced by the lower business save cap');
  const response = await f.save(input); assert.equal(response.status, 400); assert.match(response.data.error, /报价金额超出支持范围/); f.nothingSaved();
});
test('F5 ordinary 0.29 persists as exactly 29 cents rather than failing binary multiplication equality', async t => {
  const f = databaseFixture(t), response = await f.save(sale({ extras: [{ id: 'saved-cent', name: '虚构普通费用', amount: 0.29 }] }));
  assert.equal(response.status, 201); assert.equal(response.data.quote.total, 0.29); assert.equal(f.sqlite.prepare('SELECT total_cents FROM quotes').get().total_cents, 29);
  assert.equal(f.bucketCalls.put, 1);
});

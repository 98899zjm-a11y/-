'use strict';
// Root-only execution in the real handed-back offline Windows Sandbox.
// Fixed C:/xjy-work/xjy-web-stage1, original actual guard, no SQLite/app/pyc/EXE.
// Only source-provenance-checked domain.cjs is loaded by the existing loader.
// Root first rebuilds finance-guards-generated from the EXACT current sources.
// Run as a script: node this-file --expected-namespace <real handed-back namespace>.
// Literal expected amounts below are independent reference bills, not results
// calculated by the subject, shared helper, current prices or production data.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
if (process.platform !== 'win32' || os.userInfo().username.toLowerCase() !== 'wdagutilityaccount' || ROOT.toLowerCase() !== 'c:\\xjy-work\\xjy-web-stage1') throw Error('Fixed actual Guest only; Host business execution refused');
const argv = process.argv.slice(2);
if (argv.length !== 2 || argv[0] !== '--expected-namespace' || !/^[A-Za-z0-9_.-]{8,160}$/.test(argv[1])) throw Error('Root must pin actual handed-back namespace');
const PINS = {
  'stage1/isolation.cjs': 'dd1eea05233607ca20bf19d931e4a5bd10dccd2cbe80ef4697685b6a4fdf759a',
  'stage1/validate-sandbox-context.py': '867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207',
  'stage1/sandbox-context.py': '09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249',
  'project/lib/domain.ts': '984a9655bc7330728863cecd542ffa09d4724614f92bad3f708ad8017318d56c',
  'audit-tools/finance-guards-loader.cjs': 'ecf6aae22cb501aead1e141ef89c1137bed51705c97e3d389060a62bca13a099',
};
function read(relative) {
  const file = path.join(ROOT, relative);
  for (let current = file; ; current = path.dirname(current)) {
    const s = fs.lstatSync(current);
    if (s.isSymbolicLink() || s.isFile() && s.nlink !== 1) throw Error('Ordinary single-link source required');
    if (path.dirname(current) === current) break;
  }
  return fs.readFileSync(file);
}
for (const [relative, expected] of Object.entries(PINS)) if (crypto.createHash('sha256').update(read(relative)).digest('hex') !== expected) throw Error('Root source pin changed: ' + relative);
const guard = require('../stage1/isolation.cjs').createIsolationGuard(ROOT);
const proof = require('node:child_process').spawnSync('C:\\Python314\\python.exe', ['-I', '-B', guard.assertPath(path.join(ROOT, 'stage1/validate-sandbox-context.py'))], { cwd: ROOT, windowsHide: true, encoding: 'utf8' });
if (proof.status !== 0) throw Error('Unchanged actual Guest admission failed');
const identity = JSON.parse(fs.readFileSync(guard.assertPath(path.join(ROOT, 'isolation-identity.json')), 'utf8').replace(/^\uFEFF/, ''));
if (identity.namespace !== argv[1]) throw Error('Handed-back actual Guest namespace changed');
const test = require('node:test'), assert = require('node:assert/strict');
const domain = require('./finance-guards-loader.cjs').load('domain');
function quote(patch = {}) {
  return { type: 'sale', customerId: '20000000-0000-4000-8000-000000000001', title: '虚构独立算例', material: '足金', specs: '', image: '', images: [], weight: 3.12, goldPrice: 500, laborPrice: 20,
    extras: [{ id: 'stone', name: '虚构钻石及配件价', amount: 35.5 }], discountType: 'none', discountValue: 0, recyclingCoefficient: 1, repairItems: [], insured: false, insuredValue: 0, insuranceRate: 6,
    note: '', paymentMethods: [], saleItems: [], recyclingItems: [], tradeInItems: [], customConfirmations: [],
    tradeIn: { mode: 'gram', oldMaterial: 'gold', oldWeight: 10, depreciationPrice: 5, excessMode: 'recycle', excessGoldPrice: 450, excessCoefficient: 0.99 }, ...patch };
}
function item(id, patch = {}) {
  return { id, title: '虚构商品' + id, material: '足金', specs: '', image: '', weight: 2.5, goldPrice: 500, laborPrice: 20, extras: [{ id: id + '-stone', name: '虚构钻石价', amount: 15 }], quantity: 2, ...patch };
}
function parsed(value) { return domain.quoteInputSchema.parse(value); }
test('R01 single sale 3.12g times 520 plus 35.50 and ninety-percent order payment', () => {
  const result = domain.calculateQuote(parsed(quote({ discountType: 'percent', discountValue: 90 })));
  assert.equal(result.metal, 1560); assert.equal(result.labor, 62.4); assert.equal(result.extras, 35.5);
  assert.equal(result.subtotal, 1657.9); assert.equal(result.discount, 165.79); assert.equal(result.total, 1492.11);
});
test('R02 two pieces and one distinct item count per-piece extras once and order reduction once', () => {
  const first = item('a'), second = item('b', { weight: 1.25, goldPrice: 480, laborPrice: 30, extras: [{ id: 'b-stone', name: '虚构钻石价', amount: 7.5 }], quantity: 1 });
  const result = domain.calculateQuote(parsed(quote({ weight: 0, extras: [], saleItems: [first, second], discountType: 'amount', discountValue: 25 })));
  assert.deepEqual(result.itemTotals.map(row => row.subtotal), [2630, 645]);
  assert.equal(result.metal, 3100); assert.equal(result.labor, 137.5); assert.equal(result.extras, 37.5);
  assert.equal(result.subtotal, 3275); assert.equal(result.discount, 25); assert.equal(result.total, 3250);
});
test('R03 separate half-cent lines retain original per-line rounding instead of recomputing from combined grams', () => {
  const result = domain.calculateQuote(parsed(quote({ weight: 0, extras: [], saleItems: [item('a', { weight: 0.001, goldPrice: 5, laborPrice: 0, extras: [], quantity: 1 }), item('b', { weight: 0.001, goldPrice: 5, laborPrice: 0, extras: [], quantity: 1 })] })));
  assert.deepEqual(result.itemTotals.map(row => row.subtotal), [0.01, 0.01]); assert.equal(result.total, 0.02);
});
test('R04 gram exchange equal ten grams charges 200 labor and 50 depreciation without cash credit', () => {
  const result = domain.calculateQuote(parsed(quote({ type: 'tradein', weight: 10, extras: [] })));
  assert.equal(result.metal, 0); assert.equal(result.labor, 200); assert.equal(result.depreciation, 50); assert.equal(result.subtotal, 250); assert.equal(result.exchangeCredit, 0); assert.equal(result.total, 250);
  assert.equal(result.exchangeWeight, 10); assert.equal(result.additionalWeight, 0); assert.equal(result.excessWeight, 0);
});
test('R05 gram exchange twelve grams includes only two additional gold grams', () => {
  const result = domain.calculateQuote(parsed(quote({ type: 'tradein', weight: 12 })));
  assert.equal(result.metal, 1000); assert.equal(result.labor, 240); assert.equal(result.depreciation, 50); assert.equal(result.extras, 35.5); assert.equal(result.subtotal, 1325.5); assert.equal(result.total, 1325.5);
  assert.equal(result.exchangeWeight, 10); assert.equal(result.additionalWeight, 2);
});
test('R06 value exchange preserves negative twenty-nine-cent customer refund distinctly', () => {
  const result = domain.calculateQuote(parsed(quote({ type: 'tradein', weight: 1, goldPrice: 0.71, laborPrice: 0, extras: [], tradeIn: { mode: 'value', oldMaterial: 'gold', oldWeight: 1, depreciationPrice: 5, excessMode: 'recycle', excessGoldPrice: 1, excessCoefficient: 1 } })));
  assert.equal(result.subtotal, 0.71); assert.equal(result.exchangeCredit, 1); assert.equal(result.total, -0.29); assert.equal(result.balance, -0.29); assert.equal(result.depreciation, 0);
});
test('R07 recycling keeps coefficient before final cents rounding', () => {
  const result = domain.calculateQuote(parsed(quote({ type: 'recycling', material: 'gold', weight: 2.345, goldPrice: 500, laborPrice: 0, extras: [], recyclingCoefficient: 0.99 })));
  assert.equal(result.recyclingUnitPrice, 495); assert.equal(result.subtotal, 1160.78); assert.equal(result.total, 1160.78);
});
test('R08 repair fixed and count pricing plus insurance stays separate from sales discounts', () => {
  const result = domain.calculateQuote(parsed(quote({ type: 'repair', weight: 0, extras: [], discountType: 'percent', discountValue: 1, insured: true, insuredValue: 1000, insuranceRate: 6,
    repairItems: [{ id: 'repair-fixed', categoryId: 'fixed', name: '虚构固定维修', mode: 'fixed', quantity: 1, price: 120, note: '' }, { id: 'repair-count', categoryId: 'count', name: '虚构按次维修', mode: 'count', quantity: 3, price: 80, note: '' }] })));
  assert.deepEqual(result.repairItemTotals.map(row => row.subtotal), [120, 240]); assert.equal(result.repair, 360); assert.equal(result.insurance, 60); assert.equal(result.total, 420); assert.equal(result.discount, 0);
});
test('R09 zero-metal diamond-only candidate characterizes calculator and existing save-schema difference without changing policy', () => {
  const input = quote({ weight: 0, goldPrice: 0, laborPrice: 0, extras: [{ id: 'stone-only', name: '虚构裸石候选', amount: 1280.5 }], discountType: 'percent', discountValue: 90 });
  const result = domain.calculateQuote(input); assert.equal(result.subtotal, 1280.5); assert.equal(result.discount, 128.05); assert.equal(result.total, 1152.45);
  const schema = domain.quoteInputSchema.safeParse(input); assert.equal(schema.success, false); assert(schema.error.issues.some(issue => issue.path.join('.') === 'weight'));
  // A passing characterization does not authorize zero-weight sales or prove
  // a new regression: current createQuote already rejects before saving.
});
console.log(JSON.stringify({ purpose: 'finance-erp-170-independent-algorithm-reference', namespace: argv[1], sourcePins: PINS, realDataReadOrChanged: false, originalPycExecuted: false, fullWorkflowAcceptance: false }));

'use strict';

// Root-only admitted actual Guest. All rows are the frozen v2 synthetic fixture;
// no Host business execution, production DB, external image, key or log access.
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
const SELF = 'audit-tools/strict-170-tradein-saved-depreciation.test.cjs';
const FIXTURE = 'audit-tools/sales-orders-v2-test.cjs';
const FIXTURE_SHA = '9a8cf4ce66398aebbd35897ce9e7533fa95fbf18696c60a0f1995ea875ebb1af';
const selfPin = process.env.XJY_STRICT_170_TRADEIN_SAVED_TEST_SHA256;
const pins = JSON.parse(process.env.XJY_STRICT_170_TRADEIN_SAVED_SOURCE_PINS || 'null');
const FILES = ['project/desktop/sales-orders.cjs', 'project/desktop/runtime.cjs', 'project/lib/server.ts', 'project/lib/domain.ts', 'audit-tools/finance-guards-loader.cjs', 'project/desktop/migrations/0010_sales_orders.sql', 'project/drizzle/0010_sales_orders.sql'];
assert.match(selfPin || '', /^[a-f0-9]{64}$/); assert.equal(sha(read(SELF)), selfPin);
assert(pins && typeof pins === 'object' && !Array.isArray(pins));
assert.deepEqual(Object.keys(pins).sort(), FILES.slice().sort());
for (const file of FILES) { assert.match(pins[file] || '', /^[a-f0-9]{64}$/); assert.equal(sha(read(file)), pins[file], 'Exact candidate source required: ' + file); }
const fixtureBytes = read(FIXTURE); assert.equal(sha(fixtureBytes), FIXTURE_SHA);
const fixtureText = fixtureBytes.toString('utf8'), marker = "\ntest('quotation ", cut = fixtureText.indexOf(marker);
assert(cut > 0 && fixtureText.indexOf(marker, cut + 1) === -1);
const prefix = fixtureText.slice(0, cut); assert.equal(/^\s*test\s*\(/m.test(prefix), false, 'Do not register any original test');
const fixtureFile = path.join(ROOT, ...FIXTURE.split('/')), fixtureModule = { exports: {} };
// Preserve the original actual Guest/validator gates before SQLite and service
// imports, with exactly the original fictional row builder and permission ports.
vm.runInThisContext('(function(require,module,exports,__filename,__dirname){\n' + prefix + '\nmodule.exports={fixture,S,C,stamp};\n})', { filename: fixtureFile })(createRequire(fixtureFile), fixtureModule, fixtureModule.exports, fixtureFile, path.dirname(fixtureFile));
const { fixture, S, C } = fixtureModule.exports;
const { LocalD1 } = require('../project/desktop/runtime.cjs');
// The reviewed loader enforces build manifest/source/output hashes before import.
const server = require('./finance-guards-loader.cjs').load('server');
const test = require('node:test');
console.log(JSON.stringify({ purpose: 'strict-170-tradein-required-saved-depreciation', testSha256: selfPin, fixtureSha256: FIXTURE_SHA, sourcePins: pins, methods: 2, actualUiVerified: false, productionDataRead: false, database: 'synthetic-memory-only' }));
function history(f, t) {
  const db = new LocalD1(f.db);
  const actor = () => { globalThis.__financeGuardFixture = { env: { DB: db }, identity: { userId: 'synthetic-' + S.a, email: 'a@example.invalid', displayName: '虚构-a' } }; };
  t.after(() => { delete globalThis.__financeGuardFixture; });
  return {
    async report() { actor(); return server.salesReport(new Request('http://fixture.invalid/api/reports/sales?basis=confirmed&month=2026-10')); },
    async activity() { actor(); return server.customerActivity(new Request('http://fixture.invalid/api/customers/' + C + '/activity?basis=confirmed'), C); },
  };
}

test('D01 explicitly saved zero depreciation remains valid and both trade-in histories use the frozen negative balance', async t => {
  const f = fixture(t), saved = f.quote({ type: 'tradein' }), records = history(f, t);
  assert.equal(saved.totals.depreciation, 0); assert(Object.hasOwn(saved.totals, 'depreciation'));
  const created = f.create('a', saved.id);
  assert.equal(created.status, 201); assert.equal(created.data.order.amountCents, '-20001');
  // Changing a quotation later must not change the accepted order's saved zero.
  const changed = JSON.parse(JSON.stringify(saved.snapshot)); changed.calculation.depreciation = 77.77;
  f.db.prepare('UPDATE quotes SET snapshot=?,totals=? WHERE id=?').run(JSON.stringify(changed), JSON.stringify(changed.calculation), saved.id);
  for (const result of [await records.report(), await records.activity()]) {
    assert.equal(result.total, 1); assert.equal(result.orders[0].id, created.data.order.id);
    assert.equal(result.orders[0].total, -200.01); assert.equal(result.summary.netBalance, -200.01);
    assert.equal(result.orders[0].depreciation, 0); assert.equal(result.summary.depreciation, 0);
  }
});

test('D02 missing saved depreciation is refused before creation or explicitly unavailable in both histories without zero fabrication', async t => {
  const f = fixture(t), saved = f.quote({ type: 'tradein', mutate(_snapshot, totals) { delete totals.depreciation; } });
  const records = history(f, t), requestId = crypto.randomUUID();
  assert.equal(Object.hasOwn(saved.snapshot.calculation, 'depreciation'), false);
  assert.equal(Object.hasOwn(saved.totals, 'depreciation'), false);
  let created;
  try { created = f.create('a', saved.id, { requestId }); }
  catch (problem) {
    assert.equal(problem?.status, 409, 'An incomplete saved monetary detail must be identified before any order is committed');
    assert.equal(f.count('sales_orders'), 0); assert.equal(f.count('sales_order_events'), 0); assert.equal(f.count('sales_order_sequences'), 0);
    assert.equal((await records.report()).total, 0); assert.equal((await records.activity()).total, 0);
    // The same request may be retried after fixing the synthetic saved source;
    // a refusal must not consume an order identity or its first daily number.
    saved.totals.depreciation = 0;
    f.db.prepare('UPDATE quotes SET snapshot=?,totals=? WHERE id=?').run(JSON.stringify(saved.snapshot), JSON.stringify(saved.totals), saved.id);
    const corrected = f.create('a', saved.id, { requestId });
    assert.equal(corrected.status, 201); assert.equal(corrected.data.order.number, 'SO20261019-000001');
    assert.equal(f.count('sales_orders'), 1); assert.equal(f.count('sales_order_events'), 1);
    return;
  }
  assert.equal(created.status, 201);
  assert.equal(Object.hasOwn(created.data.order.totals, 'depreciation'), false, 'Do not synthesize a saved zero or a current-price calculation');
  // Acceptance is also safe if the product explicitly supports unavailable
  // historical detail. A later report 409 is not an acceptable success path.
  for (const result of [await records.report(), await records.activity()]) {
    assert.equal(result.total, 1); assert.equal(result.orders[0].id, created.data.order.id);
    assert.equal(result.orders[0].total, -200.01); assert.equal(result.summary.netBalance, -200.01);
    assert.equal(result.orders[0].depreciation, null, 'Missing saved detail must be explicitly unavailable, never zero');
    assert.equal(result.summary.depreciation, null, 'A summary containing unavailable detail must not fabricate a complete amount');
  }
});

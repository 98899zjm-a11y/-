'use strict';

// Root-only actual admitted Guest; no Host business import or SQLite execution.
// These additional contracts preserve all earlier fixture/test bytes and use
// only their synthetic fixture prefixes, before any original tests register.
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
const SELF = 'audit-tools/sales-order-accuracy-170-additional.test.cjs', selfPin = process.env.XJY_SALES_ACCURACY_TEST_SHA256;
const pins = JSON.parse(process.env.XJY_SALES_ACCURACY_SOURCE_PINS || 'null');
const FILES = ['project/desktop/sales-orders.cjs', 'project/lib/server.ts', 'project/lib/domain.ts'];
assert.match(selfPin || '', /^[a-f0-9]{64}$/); assert.equal(sha(read(SELF)), selfPin);
assert(pins && typeof pins === 'object' && !Array.isArray(pins)); assert.deepEqual(Object.keys(pins).sort(), FILES.slice().sort());
for (const file of FILES) { assert.match(pins[file] || '', /^[a-f0-9]{64}$/); assert.equal(sha(read(file)), pins[file], 'Exact source required: ' + file); }
function fixturePrefix(file, hash, marker, exports) {
  const bytes = read(file); assert.equal(sha(bytes), hash, 'Unchanged original synthetic fixture required');
  const source = bytes.toString('utf8'), cut = source.indexOf(marker);
  assert(cut > 0 && source.indexOf(marker, cut + 1) === -1);
  const prefix = source.slice(0, cut); assert.equal(/^\s*test\s*\(/m.test(prefix), false);
  const filename = path.join(ROOT, ...file.split('/')), module = { exports: {} };
  // Each original prefix admits the real Guest before importing its business
  // dependencies. Its finance loader also checks the built server manifest.
  vm.runInThisContext('(function(require,module,exports,__filename,__dirname){\n' + prefix + '\nmodule.exports={' + exports + '};\n})', { filename })(createRequire(filename), module, module.exports, filename, path.dirname(filename));
  return module.exports;
}
const gross = fixturePrefix('audit-tools/sales-orders-gross-test.cjs', '87394ed58ea92abf8cd9ccc54a349866e245c23853c6e2ef8bf0d9cd2935e034', "\ntest('gram-exchange ", 'fixture');
const history = fixturePrefix('audit-tools/sales-orders-history-test.cjs', 'bb2fb1c9a40b9d422f99cb293c8c4b7377b3d1b4ce3d6bd8b378b9ecc613d27e', "\ntest('legacy marker ", 'fixture,A,B,ADMIN,C,DATE,server');
const test = require('node:test');
console.log(JSON.stringify({ purpose: 'sales-order-accuracy-additional-boundaries', testSha256: selfPin, sourcePins: pins, methods: 6, productionDataRead: false, actualUiVerified: false, database: 'synthetic-memory-only' }));

test('A01 saved gross zero remains available in order monthly staff daily and customer totals', async t => {
  const f = gross.fixture(t); f.create(f.quote('sale', 0));
  const report = await f.report(), activity = await f.activity();
  for (const row of [...report.orders, report.summary, ...report.staff, ...report.daily, ...activity.orders, activity.summary, ...activity.byType]) {
    assert.equal(row.grossNewJewelryValue, 0);
    assert.deepEqual(row.amountBreakdown.grossNewJewelryValue, { available: true, source: 'saved' });
  }
  assert.equal(report.summary.netBalance, 519.99);
});

test('A02 one missing depreciation keeps frozen balances and makes only its complete aggregates unavailable', async t => {
  const f = gross.fixture(t), known = f.quote(), missing = f.quote();
  delete missing.snapshot.calculation.depreciation;
  f.sqlite.prepare('UPDATE quotes SET snapshot=?,totals=? WHERE id=?').run(JSON.stringify(missing.snapshot), JSON.stringify(missing.snapshot.calculation), missing.id);
  f.create(known); const incomplete = f.create(missing);
  for (const result of [await f.report(), await f.activity()]) {
    assert.equal(result.total, 2); assert.equal(result.summary.netBalance, 500); assert.equal(result.summary.depreciation, null);
    assert.deepEqual(result.summary.amountBreakdown.depreciation, { available: false, reason: 'not-saved' });
    const absent = result.orders.find(row => row.id === incomplete.id), saved = result.orders.find(row => row.id !== incomplete.id);
    assert.equal(absent.total, 250); assert.equal(absent.depreciation, null);
    assert.deepEqual(absent.amountBreakdown.depreciation, { available: false, reason: 'not-saved' });
    assert.equal(saved.depreciation, 50); assert.equal(saved.amountBreakdown.depreciation.available, true);
    for (const group of [...(result.staff || []), ...(result.daily || []), ...(result.byType || [])]) {
      assert.equal(group.depreciation, null); assert.equal(group.netBalance, 500);
    }
  }
});

test('A03 unpaged quote list and bootstrap hide foreign attributed order metadata while admin sees it', async t => {
  const f = history.fixture(t), q = f.quote(), order = f.create(q, history.ADMIN);
  f.actor(history.A);
  const unpaged = await history.server.quotePage(f.request('/api/quotes')), bootstrap = await history.server.bootstrap();
  for (const record of [...unpaged.quotes, ...bootstrap.quotes]) {
    assert.equal(record.id, q.id); assert.equal(record.salesOrder ?? null, null);
    assert.equal(JSON.stringify(record).includes(order.id), false); assert.equal(JSON.stringify(record).includes(order.number), false);
  }
  f.actor(history.ADMIN);
  const admin = await history.server.quotePage(f.request('/api/quotes'));
  assert.equal(admin.quotes[0].salesOrder.id, order.id);
});

test('A04 combined quote filters keep count and page parameters aligned with private order scope', async t => {
  const f = history.fixture(t), foreign = f.quote({ createdAt: history.DATE }), own = f.quote({ createdAt: history.DATE });
  f.create(foreign, history.ADMIN); const ownOrder = f.create(own);
  const filters = { customerId: history.C, staffId: history.A, from: '2026-10-01', to: '2026-10-31', date: '2026-10-19', type: 'sale', search: '虚构订单历史客户', page: '1', pageSize: '1' };
  const yes = await f.page({ ...filters, status: 'confirmed' }), no = await f.page({ ...filters, status: 'unconfirmed' });
  assert.equal(yes.total, 1); assert.equal(yes.quotes[0].id, own.id); assert.equal(yes.quotes[0].salesOrder.id, ownOrder.id);
  assert.equal(no.total, 1); assert.equal(no.quotes[0].id, foreign.id); assert.equal(no.quotes[0].salesOrder ?? null, null);
  f.actor(history.ADMIN);
  const admin = await history.server.quotePage(f.request('/api/quotes?' + new URLSearchParams({ ...filters, pageSize: '10', status: 'confirmed' })));
  assert.equal(admin.total, 2); assert.equal(admin.quotes.length, 2);
});

test('A05 quote-basis activity and monthly report preserve accessible source quotations after order attribution', async t => {
  const f = history.fixture(t), q = f.quote({ createdAt: history.DATE }); f.create(q, history.ADMIN);
  for (const who of [history.A, history.ADMIN]) {
    const activity = await f.activity({ basis: 'quotes' }, who), report = await f.report({ basis: 'quotes' }, who);
    assert.equal(activity.total, 1); assert.equal(activity.orders[0].id, q.id); assert.equal(activity.summary.netBalance, 519.99);
    assert.equal(report.total, 1); assert.equal(report.orders[0].id, q.id); assert.equal(report.summary.netBalance, 519.99);
  }
});

test('A06 assigned owner report is visible without granting the private source customer or its quotation', async t => {
  const f = history.fixture(t), q = f.quote(), order = f.create(q, history.ADMIN, { salesStaffId: history.B });
  const own = await f.report({}, history.B); assert.equal(own.total, 1); assert.equal(own.orders[0].id, order.id); assert.equal(own.orders[0].ownerId, history.B);
  assert.equal((await f.report({}, history.A)).total, 0);
  await assert.rejects(f.activity({}, history.B), error => error.status === 404);
  f.actor(history.B); await assert.rejects(history.server.getQuote(q.id), error => error.status === 404);
  const inaccessible = await history.server.searchCustomers(f.request('/api/customers/search?q=虚构订单历史客户'));
  assert.equal(inaccessible.total, 0); assert.equal(inaccessible.counts[history.C], undefined);
  f.actor(history.A);
  const sourceOwner = await history.server.searchCustomers(f.request('/api/customers/search?q=虚构订单历史客户'));
  assert.equal(sourceOwner.counts[history.C].quoteVersionCount, 1); assert.equal(sourceOwner.counts[history.C].confirmedRecordCount, 0);
});

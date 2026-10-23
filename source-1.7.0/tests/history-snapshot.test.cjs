'use strict';

// Only the root's verified Windows Sandbox may execute this business test.
if (process.env.XJY_HISTORY_GUEST !== '1') throw Error('Run history snapshot business tests only in the verified isolated Windows Sandbox');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const fixture = require('./history-snapshot-fixtures.cjs');
const project = path.resolve(__dirname, '../project');
const dependencyRoot = process.env.XJY_HISTORY_DEPS || path.join(project, 'node_modules');
if (!path.isAbsolute(dependencyRoot)) throw Error('XJY_HISTORY_DEPS must be an absolute dependency directory');
const dependencyRequire = createRequire(path.join(dependencyRoot, '__history_snapshot_test__.cjs'));
const ts = dependencyRequire('typescript');
const cache = new Map();

// Execute the real TS/TSX source in memory. No backend, database, app entry,
// Electron, generated old artifact, or product process is loaded. Fixed CSS and
// JPEG imports are resolved from the same source tree as the worker build.
function load(filename) {
  filename = path.resolve(filename);
  const relative = path.relative(project, filename);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw Error('History test source escaped isolated project');
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = { exports: {} }; cache.set(filename, module);
  const source = fs.readFileSync(filename, 'utf8');
  const result = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename, reportDiagnostics: true });
  const diagnostics = (result.diagnostics || []).filter(item => item.category === ts.DiagnosticCategory.Error);
  if (diagnostics.length) throw Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCanonicalFileName: f => f, getCurrentDirectory: () => project, getNewLine: () => '\n' }));
  function localRequire(request) {
    if (request.endsWith('?worker-inline')) return fs.readFileSync(path.resolve(path.dirname(filename), request.split('?')[0]), 'utf8');
    if (request.endsWith('?worker-image')) return 'data:image/jpeg;base64,' + fs.readFileSync(path.resolve(path.dirname(filename), request.split('?')[0])).toString('base64');
    if (request.endsWith('.css')) return {};
    if (request.startsWith('@/') || request.startsWith('.')) {
      const base = request.startsWith('@/') ? path.join(project, request.slice(2)) : path.resolve(path.dirname(filename), request);
      for (const candidate of [base, base + '.ts', base + '.tsx']) if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return load(candidate);
      throw Error('Missing real history test source: ' + request);
    }
    return dependencyRequire(request);
  }
  vm.runInThisContext('(function(require,module,exports){' + result.outputText + '\n})', { filename })(localRequire, module, module.exports);
  return module.exports;
}
const { createQuotePages } = load(path.join(project, 'components/quote-card.tsx'));
const { createWarrantySheets } = load(path.join(project, 'desktop/renderer/warranty-data.ts'));
const { buildSalesTemplate } = load(path.join(project, 'desktop/renderer/print-worker-templates.tsx'));
const { defaultSettings } = load(path.join(project, 'lib/domain.ts'));
const settings = { ...defaultSettings, sale: { goldPrice: 999999, laborPrice: 9999 }, brand: fixture.brand };
const meta = { customerName: '虚构历史客户', date: '2026-10-12', number: 'XS-SYNTHETIC-HISTORY' };
const warrantyDefaults = { phone: '', afterSalesWechat: '', standard: '999999.00 元/克' };
const warrantyPayload = snapshot => ({ kind: 'warranty', document: { quote: fixture.record(snapshot) }, route: { paper: { widthMm: 210, heightMm: 297 } }, presentation: { settings: { mode: 'fields', widthMm: 210, heightMm: 297, offsetXmm: 0, offsetYmm: 0, scalePercent: 100, phone: '', afterSalesWechat: '', fontSizes: {}, layoutOffsets: {} }, warranty: { itemIndexes: [0], overrides: [{ itemIndex: 0, goodsNumber: 'SYNTHETIC-1' }] } } });
const paperText = papers => JSON.stringify(papers);

test('unsaved draft still calculates the existing legal 520.00 quotation', () => {
  const papers = createQuotePages(fixture.input(), settings, meta);
  assert.equal(papers[0].total, 520);
  const sheets = createWarrantySheets(fixture.input(), warrantyDefaults, { date: meta.date });
  assert.equal(sheets[0].data.amount, '520.00');
});

test('history preview and the original-image regeneration path retain saved 519.99 and row values', () => {
  const snapshot = fixture.singleItem(), before = structuredClone(snapshot);
  const papers = createQuotePages(snapshot, settings, meta);
  assert.equal(papers[0].total, 519.99, 'saved amount must not become current calculated 520.00');
  assert.equal(papers.flatMap(p => p.products || [])[0].total, 519.99);
  assert.match(paperText(papers), /499\.99 元/);
  assert.deepEqual(snapshot, before, 'rendering must not rewrite its immutable source');
});

test('single saved warranty uses saved payable and original per-gram price', () => {
  const sheets = createWarrantySheets(fixture.singleItem(), warrantyDefaults, { date: meta.date });
  assert.equal(sheets[0].data.amount, '519.99');
  assert.equal(sheets[0].data.total, '519.99');
  assert.equal(sheets[0].data.standard, '500.00 元/克');
  assert.equal(sheets[0].data.date, '2026-10-12');
});

test('passive A4 worker preserves calculation through parsing and renders saved amount', () => {
  const html = buildSalesTemplate({ kind: 'quotation-a4', document: { quote: fixture.record(fixture.singleItem()) }, presentation: { language: 'zh-CN' } }).html;
  assert.match(html, /519\.99/);
  assert.doesNotMatch(html, /520\.00/);
  assert.match(html, /2026-10-12/);
});

test('passive warranty worker preserves saved payable through parsing', () => {
  const html = buildSalesTemplate(warrantyPayload(fixture.singleItem())).html;
  assert.match(html, /519\.99/);
  assert.doesNotMatch(html, /520\.00/);
  assert.match(html, /500\.00 元\/克/);
});

test('saved multi-item order keeps saved line subtotals and order discount separately', () => {
  const papers = createQuotePages(fixture.discountedMulti(), settings, meta);
  assert.equal(papers[0].total, 499.99);
  assert.deepEqual(papers.flatMap(p => p.products || []).map(p => p.total), [300.01, 220]);
  assert.match(paperText(papers), /20\.02 元/);
});

test('complete old multi-item snapshot derives the existing V1 allocation and labels its provenance', () => {
  // Independent integer ledger: floor(49999*30001/52001)=28845 remainder
  // 51154; second floor=21153 remainder847. One remainder cent goes to A.
  const sheets = createWarrantySheets(fixture.discountedMulti(), warrantyDefaults, { date: meta.date });
  assert.deepEqual(sheets.map(sheet => sheet.data.amount), ['288.46', '211.53']);
  assert.ok(sheets.every(sheet => sheet.amountSource === 'derived-v1'), 'derived compatibility amounts must not claim saved per-item net amounts');
});

test('old no-discount multi-item certificates use recorded row subtotals without repricing', () => {
  const snapshot = fixture.discountedMulti();
  snapshot.discountType = 'none'; snapshot.discountValue = 0;
  snapshot.calculation.discount = 0; snapshot.calculation.total = 520.01; snapshot.calculation.balance = 520.01;
  assert.deepEqual(createWarrantySheets(snapshot, warrantyDefaults, { date: meta.date }).map(s => s.data.amount), ['300.01', '220.00']);
});

test('legacy scalar-only saved calculation prints and issues a single certificate', () => {
  assert.equal(createQuotePages(fixture.legacySingle(), settings, meta)[0].total, 519.99);
  assert.equal(createWarrantySheets(fixture.legacySingle(), warrantyDefaults, { date: meta.date })[0].data.amount, '519.99');
});

test('legacy missing item totals keeps saved order amount and clearly degrades monetary detail', () => {
  const snapshot = fixture.discountedMulti(); snapshot.calculation.itemTotals = [];
  const papers = createQuotePages(snapshot, settings, meta);
  assert.equal(papers[0].total, 499.99);
  assert.equal(papers.flatMap(p => p.products || []).length, 0, 'missing saved row amounts must not be reconstructed');
  assert.match(paperText(papers), /明细.*(?:缺失|未保存|不完整)|未保存.*明细/);
  assert.match(paperText(papers), /虚构保存款甲/);
  assert.match(paperText(papers), /虚构保存款乙/);
  assert.throws(() => createWarrantySheets(snapshot, warrantyDefaults, { date: meta.date }), /明细|快照|保存/);
});

test('negative trade-in reprint retains saved refund and old-metal credit, certificate uses new-item payable', () => {
  const snapshot = fixture.negativeTradeIn(), papers = createQuotePages(snapshot, settings, meta);
  assert.equal(papers[0].total, 200.01);
  assert.equal(papers[0].totalLabel, '应退客户金额');
  assert.match(paperText(papers), /700\.01 元/);
  const sheet = createWarrantySheets(snapshot, warrantyDefaults, { date: meta.date })[0];
  assert.equal(sheet.data.amount, '500.00');
  assert.equal(sheet.data.standard, '500.00 元/克');
  assert.match(sheet.data.tradeInNote, /700\.01 元/);
  assert.match(sheet.data.tradeInNote, /应退客户 200\.01 元/);
});

test('saved identity without any saved calculation fails clearly instead of silently repricing', () => {
  const snapshot = fixture.saved(); delete snapshot.calculation;
  assert.throws(() => createQuotePages(snapshot, settings, meta), /历史|快照|保存/);
  assert.throws(() => createWarrantySheets(snapshot, warrantyDefaults, { date: meta.date }), /历史|快照|保存/);
});

test('invalid saved monetary detail is rejected instead of triggering current calculation fallback', () => {
  const snapshot = fixture.singleItem(); snapshot.calculation.itemTotals[0].subtotal = NaN;
  assert.throws(() => createQuotePages(snapshot, settings, meta), /历史|快照|金额|明细/);
});

test('saved repair detail does not recalculate unrecorded per-service amounts', () => {
  const snapshot = fixture.saved({ type: 'repair', repairItems: [{ id: 'repair-fixed', categoryId: 'fixed', name: '虚构固定维修', mode: 'fixed', quantity: 1, price: 120, note: '' }, { id: 'repair-count', categoryId: 'count', name: '虚构按次维修', mode: 'count', quantity: 3, price: 80, note: '' }], calculation: fixture.totals({ metal: 0, labor: 0, repair: 359.99, subtotal: 359.99, total: 359.99, balance: 359.99 }) });
  const papers = createQuotePages(snapshot, settings, meta);
  assert.equal(papers[0].total, 359.99);
  assert.doesNotMatch(paperText(papers), /240\.00 元/, 'no historical per-service computed total was saved');
  assert.match(paperText(papers), /80\.00 元/);
  assert.match(paperText(papers), /3 次/);
});

test('editing a copied saved quotation removes historical identity and reprices the new draft', () => {
  const { stripSavedQuoteCalculation } = load(path.join(project, 'lib/quote-presentation.ts'));
  const snapshot = fixture.saved(), draft = stripSavedQuoteCalculation(snapshot);
  for (const key of ['calculation', 'customer', 'brand', 'issuedBy']) assert.ok(!Object.hasOwn(draft, key));
  assert.equal(draft.customerId, snapshot.customerId);
  draft.goldPrice = 600;
  assert.equal(createQuotePages(draft, settings, meta)[0].total, 620);
  assert.equal(snapshot.goldPrice, 500);
  assert.equal(snapshot.calculation.total, 519.99);
});

test('inconsistent saved line and order amounts cannot derive warranty certificates', () => {
  const snapshot = fixture.discountedMulti(); snapshot.calculation.itemTotals[0].subtotal = 300;
  assert.throws(() => createWarrantySheets(snapshot, warrantyDefaults, { date: meta.date }), /明细|一致|快照/);
});

test('an explicit saved worker record cannot treat a missing historical calculation as a draft', () => {
  const quote = fixture.record(fixture.saved());
  delete quote.snapshot.calculation; delete quote.snapshot.customer; delete quote.snapshot.brand; delete quote.snapshot.issuedBy; delete quote.totals;
  assert.throws(() => buildSalesTemplate({ kind: 'quotation-a4', document: { quote } }), /历史|快照|保存/);
});

test('worker can restore missing snapshot calculation only from the same saved record totals', () => {
  const quote = fixture.record(fixture.singleItem());
  delete quote.snapshot.calculation;
  assert.match(buildSalesTemplate({ kind: 'quotation-a4', document: { quote } }).html, /519\.99/);
});

test('single-item invalid gram trade-in cannot generate a zero-price customer preview', () => {
  const input = { ...fixture.input(), type: 'tradein', material: 'Pt950', tradeIn: { mode: 'gram', oldMaterial: 'gold', oldWeight: 1, depreciationPrice: 20, excessMode: 'recycle', excessGoldPrice: 500, excessCoefficient: 1 } };
  assert.throws(() => createQuotePages(input, settings, meta), /同.*材质|成色|折价/);
});

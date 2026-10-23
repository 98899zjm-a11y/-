'use strict';
if (process.env.XJY_HISTORY_GUEST !== '1') throw Error('Run history snapshot business tests only in the verified isolated Windows Sandbox');
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module');
const fixture = require('./history-snapshot-fixtures.cjs');
const project = path.resolve(__dirname, '../project');
const dependencyRoot = process.env.XJY_HISTORY_DEPS || path.join(project, 'node_modules');
if (!path.isAbsolute(dependencyRoot)) throw Error('Absolute history dependency directory required');
const dependencyRequire = createRequire(path.join(dependencyRoot, '__history_missing_detail__.cjs'));
const ts = dependencyRequire('typescript'), cache = new Map();
function load(filename) {
  filename = path.resolve(filename);
  const relative = path.relative(project, filename);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw Error('History test source escaped isolated project');
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = { exports: {} }; cache.set(filename, module);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename }).outputText;
  function localRequire(request) {
    if (request.endsWith('.css')) return {};
    if (request.startsWith('@/') || request.startsWith('.')) {
      const base = request.startsWith('@/') ? path.join(project, request.slice(2)) : path.resolve(path.dirname(filename), request);
      for (const candidate of [base, base + '.ts', base + '.tsx']) if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return load(candidate);
      throw Error('Missing real source: ' + request);
    }
    return dependencyRequire(request);
  }
  vm.runInThisContext('(function(require,module,exports){' + compiled + '\n})', { filename })(localRequire, module, module.exports);
  return module.exports;
}
const { createQuotePages } = load(path.join(project, 'components/quote-card.tsx'));
const { createWarrantySheets } = load(path.join(project, 'desktop/renderer/warranty-data.ts'));
const { defaultSettings } = load(path.join(project, 'lib/domain.ts'));
const meta = { customerName: '虚构缺失明细客户', date: '2026-10-12', number: 'XS-SYNTHETIC-MISSING' };

test('legacy recycling keeps saved 445.50 without fabricating a missing unit price as zero', () => {
  const snapshot = fixture.saved({ type: 'recycling', material: 'gold', weight: 0.9, goldPrice: 500, recyclingCoefficient: 0.99, calculation: { subtotal: 445.5, discount: 0, total: 445.5 } });
  const papers = createQuotePages(snapshot, defaultSettings, meta);
  assert.equal(papers[0].total, 445.5);
  assert.ok(!papers.flatMap(paper => paper.parameters).some(parameter => /实际.*单价/.test(parameter.label)), 'missing stored unit price must be hidden, not zero-filled or recalculated');
  assert.match(JSON.stringify(papers), /明细.*(?:缺失|未保存|不完整)|未保存.*明细/);
});

test('legacy gram trade-in keeps saved order amount and suppresses missing exchange and depreciation detail', () => {
  const snapshot = fixture.saved({ type: 'tradein', tradeIn: { mode: 'gram', oldMaterial: 'gold', oldWeight: 1, depreciationPrice: 20, excessMode: 'return', excessGoldPrice: 0, excessCoefficient: 1 }, calculation: { metal: 0, labor: 20, extras: 0, subtotal: 40, discount: 0, exchangeCredit: 0, total: 40, balance: 40 } });
  const papers = createQuotePages(snapshot, defaultSettings, meta);
  assert.equal(papers[0].total, 40);
  assert.ok(!papers.flatMap(paper => paper.lines).some(line => line.label === '折旧费'), 'missing depreciation must not be presented as a saved zero charge');
  assert.ok(!papers.flatMap(paper => paper.parameters).some(parameter => /抵换金重/.test(parameter.label)), 'missing exchange weight must not be presented as zero');
  assert.match(JSON.stringify(papers), /明细.*(?:缺失|未保存|不完整)|未保存.*明细/);
  assert.throws(() => createWarrantySheets(snapshot, { phone: '', afterSalesWechat: '' }, { date: meta.date }), /明细|缺失|快照|保存/);
});

test('legacy recycling rows without stored unit prices degrade to the saved order amount', () => {
  const row = (id, title) => ({ id, title, material: 'gold', specs: '', image: '', weight: 0.5, goldPrice: 450, recyclingCoefficient: 0.99 });
  const amount = id => ({ id, metal: 222.75, labor: 0, extras: 0, subtotal: 222.75, total: 222.75, weight: 0.5, quantity: 1 });
  const snapshot = fixture.saved({ type: 'recycling', material: 'gold', recyclingItems: [row('recycle-a', '虚构缺单价甲'), row('recycle-b', '虚构缺单价乙')], calculation: { subtotal: 445.5, discount: 0, total: 445.5, recyclingUnitPrice: 0, itemTotals: [amount('recycle-a'), amount('recycle-b')] } });
  const papers = createQuotePages(snapshot, defaultSettings, meta);
  assert.equal(papers[0].total, 445.5);
  assert.equal(papers.flatMap(paper => paper.products || []).length, 0, 'do not display a guessed per-row zero unit price');
  assert.match(JSON.stringify(papers), /明细.*(?:缺失|未保存|不完整)|未保存.*明细/);
  assert.match(JSON.stringify(papers), /虚构缺单价甲/);
  assert.match(JSON.stringify(papers), /虚构缺单价乙/);
});

test('legacy gram trade-in rows without recorded exchange details cannot fabricate item certificates', () => {
  const row = (id, title) => ({ ...fixture.item(id, title, 500, 20), weight: 0.5 });
  const amount = id => ({ id, metal: 0, labor: 10, extras: 0, subtotal: 20, total: 20, weight: 0.5, quantity: 1 });
  const snapshot = fixture.saved({ type: 'tradein', tradeIn: { mode: 'gram', oldMaterial: 'gold', oldWeight: 1, depreciationPrice: 20, excessMode: 'return', excessGoldPrice: 0, excessCoefficient: 1 }, tradeInItems: [row('gram-a', '虚构缺换重甲'), row('gram-b', '虚构缺换重乙')], calculation: { metal: 0, labor: 20, extras: 0, subtotal: 40, discount: 0, exchangeCredit: 0, total: 40, balance: 40, depreciation: 20, exchangeWeight: 1, additionalWeight: 0, excessWeight: 0, itemTotals: [amount('gram-a'), amount('gram-b')] } });
  const papers = createQuotePages(snapshot, defaultSettings, meta);
  assert.equal(papers[0].total, 40);
  assert.equal(papers.flatMap(paper => paper.products || []).length, 0, 'missing item depreciation and exchange weight must not become zero');
  assert.match(JSON.stringify(papers), /明细.*(?:缺失|未保存|不完整)|未保存.*明细/);
  assert.throws(() => createWarrantySheets(snapshot, { phone: '', afterSalesWechat: '' }, { date: meta.date }), /明细|缺失|快照|保存/);
});

test('optional trade-in input uses the same effective gram mode for missing-detail checks as the page', () => {
  for (const tradeIn of [undefined, {}]) {
    const snapshot = fixture.saved({ type: 'tradein', calculation: { metal: 0, labor: 20, extras: 0, subtotal: 40, discount: 0, exchangeCredit: 0, total: 40, balance: 40 } });
    if (tradeIn !== undefined) snapshot.tradeIn = tradeIn;
    const papers = createQuotePages(snapshot, defaultSettings, meta);
    assert.equal(papers[0].total, 40);
    assert.ok(!papers.flatMap(paper => paper.lines).some(line => line.label === '折旧费'), 'the page defaults to gram mode, so missing gram fields must be hidden');
    assert.ok(!papers.flatMap(paper => paper.parameters).some(parameter => parameter.label === '抵换金重'));
    assert.match(JSON.stringify(papers), /明细.*(?:缺失|未保存|不完整)|未保存.*明细/);
  }
});

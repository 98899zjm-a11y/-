'use strict';
// Guest-only P2 source behavior. Real LocalD1/SQL + real workspace callbacks and
// quote-card; finance identity is a trusted TEST platform double, not HTTP auth.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const ROOT = path.resolve(__dirname, '..');
if (process.platform !== 'win32' || os.userInfo().username.toLowerCase() !== 'wdagutilityaccount' || ROOT.toLowerCase() !== 'c:\\xjy-work\\xjy-web-stage1') throw Error('Customer/style P2 requires the fixed actual Windows Sandbox');
const guard = require('../stage1/isolation.cjs').createIsolationGuard(ROOT);
const proof = require('node:child_process').spawnSync('C:\\Python314\\python.exe', ['-I', '-B', guard.assertPath(path.join(ROOT, 'stage1/validate-sandbox-context.py'))], { cwd: ROOT, windowsHide: true, encoding: 'utf8' });
if (proof.error || proof.status !== 0) throw Error('Unchanged actual Guest admission failed');
JSON.parse(proof.stdout);
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm');
const crypto = require('node:crypto'), Module = require('node:module');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = file => fs.readFileSync(guard.assertPath(file), 'utf8');

// Trap EVERY subsequent sqlite import before the frozen fixture/runtime loads.
// No file database, URI, backup, ATTACH, extension or SQL file IO is admitted.
const nativeSqlite = require('node:sqlite'), RawDB = nativeSqlite.DatabaseSync;
function RamOnlyDatabase(filename, options = {}) {
  if (filename !== ':memory:') throw Error('P2_RAM_ONLY: database filename refused');
  const db = new RawDB(':memory:', { ...options, allowExtension: false });
  const rawExec = db.exec.bind(db), rawPrepare = db.prepare.bind(db);
  rawExec('PRAGMA temp_store=MEMORY');
  db.setAuthorizer((action, ...args) => action === nativeSqlite.constants.SQLITE_ATTACH || action === nativeSqlite.constants.SQLITE_DETACH || action === nativeSqlite.constants.SQLITE_PRAGMA && ['temp_store', 'temp_store_directory', 'data_store_directory'].includes(String(args[0]).toLowerCase()) && args[1] !== null && args[1] !== undefined || action === nativeSqlite.constants.SQLITE_FUNCTION && args.some(value => /^(load_extension|readfile|writefile)$/i.test(String(value))) ? nativeSqlite.constants.SQLITE_DENY : nativeSqlite.constants.SQLITE_OK);
  function sql(value) { if (typeof value !== 'string' || /\b(?:ATTACH|DETACH|load_extension|readfile|writefile)\b|\bVACUUM\s+(?:[\w"`]+\s+)?INTO\b/i.test(value)) throw Error('P2_RAM_ONLY: SQL file access refused'); }
  Object.defineProperties(db, {
    exec: { value: value => { sql(value); return rawExec(value); } },
    prepare: { value: value => { sql(value); return rawPrepare(value); } },
    setAuthorizer: { value: () => { throw Error('P2_RAM_ONLY: authorizer replacement refused'); } },
    enableLoadExtension: { value: () => { throw Error('P2_RAM_ONLY: extension refused'); } },
    loadExtension: { value: () => { throw Error('P2_RAM_ONLY: extension refused'); } },
    constructor: { value: RamOnlyDatabase },
  });
  return db;
}
const sqliteFacade = new Proxy(nativeSqlite, { get(target, key) { if (key === 'DatabaseSync') return RamOnlyDatabase; if (key === 'backup') return () => { throw Error('P2_RAM_ONLY: backup refused'); }; return target[key]; } });
const originalLoad = Module._load;
Module._load = function (name, ...args) { return name === 'node:sqlite' || name === 'sqlite' ? sqliteFacade : originalLoad.call(this, name, ...args); };
test.after(() => { Module._load = originalLoad; delete globalThis.__financeGuardFixture; });

// Reuse only the SHA-pinned, already tested directory fixture prelude. Its test
// registrations never execute and its source is not rewritten or exported in prod.
const FROZEN = guard.assertPath(path.join(ROOT, 'tests/customer-directory.cjs'));
const frozen = read(FROZEN);
assert.equal(sha(Buffer.from(frozen)), '7ec0d239a0b3eb0437607ffbe55e70d9a196340067ee938b5f3b0b3adabc2f1c');
const boundary = '\nfunction counts(result, customer) {';
const end = frozen.indexOf(boundary);
assert.ok(end > 0 && frozen.indexOf(boundary, end + 1) === -1, 'unique frozen fixture boundary');
const preludeModule = { exports: {} };
vm.runInThisContext('(function(require,module,exports,__dirname){' + frozen.slice(0, end) + '\nmodule.exports={fixture,server,history,ADMIN,A,B};\n})', { filename: FROZEN })(Module.createRequire(FROZEN), preludeModule, preludeModule.exports, path.dirname(FROZEN));
const { fixture: directoryFixture, server, history, ADMIN, A } = preludeModule.exports;
const { load } = require('./finance-guards-loader.cjs'), domain = load('domain'), preview = load('preview');
const ts = require(guard.assertPath(path.join(ROOT, 'audit-tools/dependencies/node_modules/typescript')));
const PROJECT = path.join(ROOT, 'project'), WORKSPACE = path.join(PROJECT, 'desktop/renderer/workspace.tsx');
const workspaceSource = read(WORKSPACE), ast = ts.createSourceFile(WORKSPACE, workspaceSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
assert.equal(ast.parseDiagnostics.length, 0);
function walk(node, predicate, found = []) { if (predicate(node)) found.push(node); ts.forEachChild(node, child => { walk(child, predicate, found); }); return found; }
function compile(source, filename = WORKSPACE) { const result = ts.transpileModule(source, { fileName: filename, reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }); assert.equal((result.diagnostics || []).filter(row => row.category === ts.DiagnosticCategory.Error).length, 0); return result.outputText; }
function expression(text, scope) { const module = { exports: {} }; vm.runInNewContext(compile('module.exports=(' + text + ');'), { module, exports: module.exports, ...scope }, { filename: WORKSPACE }); return module.exports; }
function initializer(name, scope) { const found = walk(ast, node => ts.isVariableDeclaration(node) && node.name.getText(ast) === name); assert.equal(found.length, 1, 'real workspace declaration ' + name); assert.ok(found[0].initializer); return expression(found[0].initializer.getText(ast), scope); }
function pureModule(relative, imports = {}) { const file = path.join(PROJECT, relative), module = { exports: {} }; vm.runInNewContext(compile(read(file), file), { module, exports: module.exports, require: name => { if (Object.hasOwn(imports, name)) return imports[name]; throw Error('P2 unreviewed pure import ' + name); } }, { filename: file }); return module.exports; }
const presentation = pureModule('lib/quote-presentation.ts', { './domain': domain });
const clientDrafts = pureModule('lib/client-drafts.ts');
const uid = () => '90000000-0000-4000-8000-000000000001';
const styleId = n => '50000000-0000-4000-8000-' + String(n).padStart(12, '0');
const QUOTE_ID = '30000000-0000-4000-8000-000000009001';
function snapshot(customer) {
  return history.saved({ customerId: customer.id, customer: { id: customer.id, name: customer.name, phone: customer.phone }, saleItems: [history.item('one', '虚构报价商品', 500, 20)], calculation: history.totals({ metal: 500, subtotal: 520, total: 520, balance: 520, itemTotals: [{ id: 'one', metal: 500, labor: 20, extras: 0, subtotal: 520, total: 520, weight: 1, quantity: 1 }] }) });
}
function fixture(t, { customers = false, styles = false } = {}) {
  const f = directoryFixture(t);
  const files = f.sqlite.prepare('PRAGMA database_list').all();
  assert.equal(files.length, 1); assert.equal(files[0].name, 'main'); assert.equal(files[0].file, '');
  assert.equal(f.sqlite.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  if (customers) { for (let n = 1; n <= 1001; n++) { const row = f.customer(n, n === 1 ? { name: '虚构老客户' } : {}); if (n === 1) f.old = row; if (n === 1001) f.recent = row; } }
  if (styles) {
    const put = f.sqlite.prepare('INSERT INTO styles(id,data,active,created_at,updated_at) VALUES(?,?,?,?,?)');
    for (let n = 1; n <= 302; n++) { const active = n !== 1, stamp = new Date(Date.UTC(2026, 9, 1) + n * 1000).toISOString(); const value = { name: n === 1 ? '虚构停用旧款' : n === 2 ? '虚构启用旧款' : '虚构新款' + n, material: '足金', specs: '虚构规格', image: '', weight: 1, extras: [], active }; put.run(styleId(n), JSON.stringify(value), active ? 1 : 0, stamp, stamp); }
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM styles').get().n, 302);
  }
  f.reply = async (parameters = {}, actor = ADMIN) => { f.actor(actor); const response = await server.api(() => server.searchStyles(new Request('http://fixture.invalid/api/styles/search?' + new URLSearchParams(parameters)))); return { status: response.status, ok: response.ok, data: await response.json() }; };
  f.seedQuote = async customer => { const saved = snapshot(customer), stamp = '2026-10-16T00:00:00Z'; f.sqlite.prepare('INSERT INTO quotes(id,number,type,customer_id,customer_name,owner_id,title,snapshot,totals,total_cents,root_id,base_quote_id,version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(QUOTE_ID, 'SYNTHETIC-P2-QUOTE', 'sale', customer.id, customer.name, A, saved.title, JSON.stringify(saved), JSON.stringify(saved.calculation), 52000, QUOTE_ID, null, 1, stamp); f.actor(A); return (await server.getQuote(QUOTE_ID)).quote; };
  f.rawQuote = () => JSON.stringify(f.sqlite.prepare('SELECT id,customer_id,customer_name,snapshot,totals,total_cents FROM quotes WHERE id=?').get(QUOTE_ID));
  return f;
}

function customerScope(f, initial, draft) {
  const h = { data: initial, drafts: { sale: draft }, saved: null, revision: 0, navigated: null };
  h.scope = () => {
    const scope = { data: h.data, drafts: h.drafts, draft: h.drafts.sale, kind: 'sale', saved: h.saved, settings: domain.defaultSettings, defaultTradeIn: domain.defaultTradeIn, uid, activeItems: { sale: 0, tradein: 0, recycling: 0 }, useMemo: make => make(), ...presentation, ...clientDrafts,
      setData: update => { h.data = typeof update === 'function' ? update(h.data) : update; }, setDataRevision: update => { h.revision = typeof update === 'function' ? update(h.revision) : update; },
      setDrafts: update => { h.drafts = update(h.drafts); }, setSaved: value => { h.saved = value; }, setGenerated: () => {}, setNotice: () => {}, setPaperPage: () => {}, setA4Papers: () => {},
      navigate: page => { h.navigated = page; }, kindPage: { sale: 'sales' },
      api: async address => { assert.equal(address, '/api/bootstrap'); f.actor(A); return server.bootstrap(); },
    };
    scope.calculateQuote = preview.calculateQuote; scope.createQuotePages = preview.createQuotePages;
    const ensure = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'ensureItems'); assert.ok(ensure);
    scope.ensureItems = expression(ensure.getText(ast).replace(/^function ensureItems/, 'function'), scope);
    scope.patchDraft = initializer('patchDraft', scope); scope.edit = initializer('edit', scope);
    return scope;
  };
  h.select = customer => { const picker = walk(ast, node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === 'CustomerPicker'); assert.equal(picker.length, 1); const attr = picker[0].attributes.properties.find(item => ts.isJsxAttribute(item) && item.name.getText(ast) === 'onSelect'); assert.ok(attr && ts.isJsxExpression(attr.initializer) && attr.initializer.expression); expression(attr.initializer.expression.getText(ast), h.scope())(customer); };
  h.refresh = () => initializer('refresh', h.scope())();
  h.copy = (record, newVersion) => initializer('copyQuote', h.scope())(record, newVersion);
  h.paper = () => { const scope = h.scope(); scope.emptyProducts = clientDrafts.hasEmptyProductList(scope.draft); scope.draftTotals = initializer('draftTotals', scope); scope.selectedCustomer = initializer('selectedCustomer', scope); const state = initializer('paperState', scope); assert.equal(state.error, '', 'valid literal quote fixture must produce paper'); assert.ok(state.papers.length); return state.papers[0]; };
  return h;
}

test('H00 RAM trap refuses file/URI, ATTACH, backup and policy replacement', t => {
  const f = fixture(t);
  for (const name of [path.join(ROOT, 'runtime/forbidden-p2.sqlite'), 'file::memory:?cache=shared']) assert.throws(() => new RamOnlyDatabase(name), /P2_RAM_ONLY/);
  assert.throws(() => f.sqlite.exec("ATTACH DATABASE ':memory:' AS other"), /P2_RAM_ONLY/);
  assert.throws(() => sqliteFacade.backup(f.sqlite, path.join(ROOT, 'runtime/forbidden-copy.sqlite')), /P2_RAM_ONLY/);
  assert.throws(() => f.sqlite.setAuthorizer(null), /P2_RAM_ONLY/);
  assert.equal(f.sqlite.prepare('PRAGMA temp_store').get().temp_store, 2);
  for (const statement of ["PRAGMA temp_store=FILE", "PRAGMA temp_store_directory='C:/xjy-work/xjy-web-stage1/runtime/forbidden-temp'", "PRAGMA data_store_directory='C:/xjy-work/xjy-web-stage1/runtime/forbidden-data'"]) assert.throws(() => f.sqlite.exec(statement), /not authorized|authorization denied/i);
  assert.equal(f.sqlite.prepare('PRAGMA temp_store').get().temp_store, 2);
  assert.equal(f.sqlite.prepare('PRAGMA database_list').all()[0].file, '');
});

test('C01 selected customer outside bootstrap1000 keeps paper name after real refresh', async t => {
  const f = fixture(t, { customers: true }); f.actor(A); const initial = await server.bootstrap();
  assert.equal(initial.customers.length, 1000); assert.equal(initial.customers.some(row => row.id === f.old.id), false);
  const found = await f.search(A, { q: '虚构老客户' }); assert.equal(found.customers[0].id, f.old.id);
  const record = await f.seedQuote(f.old), original = f.rawQuote();
  const h = customerScope(f, initial, { ...history.input(), saleItems: [history.item('one', '虚构报价商品', 500, 20)], customerId: '' });
  h.select(found.customers[0]); assert.equal(h.paper().customerName, '虚构老客户');
  await h.refresh(); assert.equal(h.drafts.sale.customerId, f.old.id); assert.equal(f.rawQuote(), original); assert.equal(record.customerName, '虚构老客户');
  assert.equal(h.paper().total, 520); assert.equal(h.paper().customerName, '虚构老客户', 'refresh must not erase selected customer paper metadata');
});

test('C02 copyQuote keeps old customer paper name while original saved history stays byte-identical', async t => {
  const f = fixture(t, { customers: true }), record = await f.seedQuote(f.old); f.actor(A); const initial = await server.bootstrap(), before = f.rawQuote(), objectBefore = JSON.stringify(record);
  for (const newVersion of [false, true]) {
    const h = customerScope(f, initial, history.input()); h.copy(record, newVersion);
    assert.equal(h.navigated, 'sales'); assert.equal(h.drafts.sale.customerId, f.old.id); assert.equal(h.drafts.sale.baseQuoteId, newVersion ? record.id : undefined);
    assert.equal(Object.hasOwn(h.drafts.sale, 'calculation'), false, 'copy remains editable and does not reuse historical calculation');
    assert.equal(f.rawQuote(), before); assert.equal(JSON.stringify(record), objectBefore);
    assert.equal(h.paper().total, 520); assert.equal(h.paper().customerName, '虚构老客户');
  }
});

test('C03 recent selected customer still resolves by real workspace and quote-card', async t => {
  const f = fixture(t, { customers: true }); f.actor(A); const initial = await server.bootstrap();
  const h = customerScope(f, initial, { ...history.input(), customerId: f.recent.id, saleItems: [history.item('one', '虚构报价商品', 500, 20)] });
  await h.refresh(); assert.equal(h.paper().customerName, f.recent.name); assert.equal(h.paper().total, 520);
});

test('C04 manual unassociated draft remains explicitly unnamed and does not inherit another customer', async t => {
  const f = fixture(t, { customers: true }); f.actor(A);
  const h = customerScope(f, await server.bootstrap(), { ...history.input(), customerId: '', saleItems: [history.item('one', '虚构报价商品', 500, 20)] });
  await h.refresh(); assert.equal(h.drafts.sale.customerId, ''); assert.equal(h.paper().customerName, '未填写客户'); assert.equal(h.paper().total, 520);
});

test('S01 admin management search includes inactive style beyond bootstrap300', async t => {
  const f = fixture(t, { styles: true }); f.actor(ADMIN); const initial = await server.bootstrap();
  assert.equal(initial.styles.length, 300); assert.equal(initial.styles.some(row => row.id === styleId(1)), false);
  const result = await f.reply({ q: '停用旧款', includeInactive: '1', page: '1', pageSize: '20' });
  assert.equal(result.status, 200, 'new admin management source contract'); assert.equal(result.data.total, 1);
  assert.equal(result.data.styles[0].id, styleId(1)); assert.equal(result.data.styles[0].active, false);
});

test('S02 admin management pages include all302 styles exactly once in stable order', async t => {
  const f = fixture(t, { styles: true });
  const first = await f.reply({ includeInactive: '1', page: '1', pageSize: '200' }), second = await f.reply({ includeInactive: '1', page: '2', pageSize: '200' });
  assert.equal(first.status, 200); assert.equal(second.status, 200); assert.equal(first.data.total, 302); assert.equal(second.data.total, 302);
  const ids = [...first.data.styles, ...second.data.styles].map(row => row.id);
  assert.deepEqual(ids, Array.from({ length: 302 }, (_, index) => styleId(302 - index))); assert.equal(new Set(ids).size, 302);
});

test('S03 employee cannot request the new inactive-management source', async t => {
  const f = fixture(t, { styles: true }), result = await f.reply({ includeInactive: '1', q: '停用旧款' }, A);
  assert.equal(result.status, 403, 'new management parameter must require actual server assertAdmin');
  assert.equal(result.data.styles, undefined);
});

test('S04 original opening search remains active-only for employee and admin', async t => {
  const f = fixture(t, { styles: true });
  for (const actor of [A, ADMIN]) {
    const active = await f.reply({ q: '旧款' }, actor), inactive = await f.reply({ q: '停用旧款' }, actor);
    assert.equal(active.status, 200); assert.equal(active.data.total, 1); assert.equal(active.data.styles[0].id, styleId(2)); assert.equal(active.data.styles[0].active, true);
    assert.equal(inactive.status, 200); assert.equal(inactive.data.total, 0);
  }
});

const jsx = (type, props, key) => ({ type, props: props || {}, key }), jsxRuntime = { jsx, jsxs: jsx, Fragment: Symbol.for('p2.fragment') };
function nodes(node, out = []) { if (Array.isArray(node)) node.forEach(child => nodes(child, out)); else if (node && typeof node === 'object') { out.push(node); nodes(node.props?.children, out); } return out; }
function text(node) { return Array.isArray(node) ? node.map(text).join(' ') : node == null || typeof node === 'boolean' ? '' : typeof node === 'object' ? text(node.props?.children) : String(node); }
function managementHarness(f, initial) {
  const h = { dirty: true, tree: null, requests: [], forms: [], time: 0 }, slots = [], pending = [], timers = new Map(), modules = new Map(); let cursor = 0, timerId = 0;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const slot = (kind, make) => { const index = cursor++; if (!slots[index]) slots[index] = { kind, ...make() }; assert.equal(slots[index].kind, kind); return slots[index]; };
  const react = {
    useState(initialValue) { const state = slot('state', () => ({ value: typeof initialValue === 'function' ? initialValue() : initialValue })); return [state.value, update => { const next = typeof update === 'function' ? update(state.value) : update; if (!Object.is(next, state.value)) { state.value = next; h.dirty = true; } }]; },
    useRef(value) { return slot('ref', () => ({ value: { current: value } })).value; },
    useMemo(make, deps) { const state = slot('memo', () => ({ deps: undefined, value: undefined })); if (!same(state.deps, deps)) { state.value = make(); state.deps = deps; } return state.value; },
    useEffect(effect, deps) { const state = slot('effect', () => ({ deps: undefined, cleanup: undefined })); if (!same(state.deps, deps)) pending.push({ state, effect, deps }); },
  };
  react.useCallback = (fn, deps) => react.useMemo(() => fn, deps); react.useLayoutEffect = react.useEffect;
  const api = async (address, method = 'GET', body) => { assert.equal(method, 'GET'); assert.equal(body, undefined); const url = new URL(address, 'http://fixture.invalid'); assert.equal(url.pathname, '/api/styles/search'); const row = { address, method, params: url.searchParams }; h.requests.push(row); const result = await f.reply(Object.fromEntries(url.searchParams)); row.result = result; if (!result.ok) throw Error(result.data.error || 'synthetic API error'); return result.data; };
  const setTimeout = (fn, delay = 0) => { const id = ++timerId; timers.set(id, { at: h.time + delay, fn }); return id; }, clearTimeout = id => timers.delete(id);
  const icons = new Proxy({}, { get: () => props => jsx('svg', props) });
  function loadComponent(file) {
    file = guard.assertPath(file); assert.ok(file.startsWith(PROJECT + path.sep)); if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} }; modules.set(file, module);
    const requireSource = name => { if (name === 'react') return react; if (name === 'react/jsx-runtime') return jsxRuntime; if (name === 'lucide-react') return icons; if (name === './bridge') return { api }; if (name.endsWith('.css')) return {}; if (name.startsWith('./') || name.startsWith('../') || name.startsWith('@/')) { const base = name.startsWith('@/') ? path.join(PROJECT, name.slice(2)) : path.resolve(path.dirname(file), name); const found = [base, base + '.tsx', base + '.ts'].find(value => fs.existsSync(guard.assertPath(value))); assert.ok(found, 'actual imported component/helper exists: ' + name); return loadComponent(found); } throw Error('P2 unreviewed component import ' + name); };
    vm.runInNewContext(compile(read(file), file), { module, exports: module.exports, require: requireSource, setTimeout, clearTimeout, URLSearchParams, console }, { filename: file }); return module.exports;
  }
  const isStyleCheck = node => ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken && ts.isIdentifier(node.left) && node.left.text === 'settingsTab' && ts.isStringLiteral(node.right) && node.right.text === 'styles';
  const branches = walk(ast, node => ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && (ts.isJsxElement(node.right) || ts.isJsxSelfClosingElement(node.right)) && walk(node.left, isStyleCheck).length > 0);
  assert.equal(branches.length, 1, 'actual management JSX branch');
  const scope = { admin: true, settingsTab: 'styles', data: initial, dataRevision: 0, busy: false, canWriteSales: true, setStyleForm: value => h.forms.push(value), Button: props => jsx('button', props), Empty: props => jsx('div', { children: [props.title, props.text] }), Plus: icons.Plus, Pencil: icons.Pencil, Search: icons.Search, useState: react.useState, useEffect: react.useEffect, useMemo: react.useMemo, useRef: react.useRef, setTimeout, clearTimeout };
  // Any imported component used by this real branch is loaded from its actual
  // file. Current legacy inline branch needs no fabricated future component.
  for (const item of ast.statements.filter(ts.isImportDeclaration)) {
    const clause = item.importClause; if (!clause || clause.isTypeOnly || !ts.isStringLiteral(item.moduleSpecifier)) continue;
    const names = []; if (clause.name) names.push([clause.name.text, 'default']); if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) for (const element of clause.namedBindings.elements) if (!element.isTypeOnly) names.push([element.name.text, element.propertyName?.text || element.name.text]);
    for (const [local, exported] of names) if (walk(branches[0], node => (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(ast) === local).length && item.moduleSpecifier.text.startsWith('./')) { const base = path.resolve(path.dirname(WORKSPACE), item.moduleSpecifier.text), file = [base, base + '.tsx', base + '.ts'].find(value => fs.existsSync(guard.assertPath(value))); assert.ok(file); scope[local] = loadComponent(file)[exported]; }
  }
  const Render = expression('()=>(' + branches[0].getText(ast) + ')', { ...scope, require: name => { assert.equal(name, 'react/jsx-runtime'); return jsxRuntime; } });
  const realize = node => Array.isArray(node) ? node.map(realize) : !node || typeof node !== 'object' ? node : typeof node.type === 'function' ? realize(node.type(node.props)) : { ...node, props: { ...node.props, children: realize(node.props?.children) } };
  h.flush = () => { for (let count = 0; h.dirty || pending.length; count++) { assert.ok(count < 50, 'controlled hook component settles'); if (h.dirty) { h.dirty = false; cursor = 0; h.tree = realize(Render()); } while (pending.length) { const next = pending.shift(); next.state.cleanup?.(); next.state.deps = next.deps; next.state.cleanup = next.effect(); } } };
  h.advance = time => { h.time += time; for (;;) { const due = [...timers].filter(([, value]) => value.at <= h.time).sort((a, b) => a[1].at - b[1].at)[0]; if (!due) break; timers.delete(due[0]); due[1].fn(); h.flush(); } };
  h.settle = async () => { for (let n = 0; n < 12; n++) { await new Promise(resolve => setImmediate(resolve)); h.flush(); } };
  h.find = predicate => { const found = nodes(h.tree).find(predicate); assert.ok(found, 'actual management control exists'); return found; };
  h.click = node => { assert.ok(!node.props.disabled); node.props.onClick(); h.flush(); };
  h.dispose = () => { for (const state of slots) state.cleanup?.(); timers.clear(); };
  h.flush(); return h;
}

test('U01 actual styles management branch requests admin source, pages, searches and renders inactive old style', async t => {
  const f = fixture(t, { styles: true }); f.actor(ADMIN); const initial = await server.bootstrap(), h = managementHarness(f, initial); t.after(h.dispose);
  h.advance(200); await h.settle();
  assert.equal(h.requests.length, 1, 'management UI must fetch the full source instead of rendering bootstrap300 only');
  assert.equal(h.requests[0].params.get('includeInactive'), '1'); assert.equal(h.requests[0].params.get('page'), '1');
  h.click(h.find(node => node.type === 'button' && /下一页/.test(node.props['aria-label'] || text(node)))); h.advance(200); await h.settle();
  assert.equal(h.requests.at(-1).params.get('page'), '2'); assert.equal(h.requests.at(-1).params.get('includeInactive'), '1');
  const input = h.find(node => node.type === 'input' && /搜索/.test(node.props['aria-label'] || node.props.placeholder || ''));
  input.props.onChange({ target: { value: '停用旧款' } }); h.flush(); h.advance(200); await h.settle();
  const last = h.requests.at(-1); assert.equal(last.params.get('q'), '停用旧款'); assert.equal(last.params.get('page'), '1'); assert.equal(last.params.get('includeInactive'), '1');
  assert.equal(last.result.status, 200); assert.match(text(h.tree), /虚构停用旧款/);
  h.click(h.find(node => node.type === 'button' && text(node).includes('虚构停用旧款')));
  assert.equal(h.forms.at(-1).id, styleId(1)); assert.equal(h.forms.at(-1).active, false);
});

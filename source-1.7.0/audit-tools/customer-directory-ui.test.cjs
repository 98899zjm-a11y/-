'use strict';

// No Host execution, browser/service startup or file-backed business database.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const root = path.resolve(__dirname, '..');
if (process.platform !== 'win32' || os.userInfo().username.toLowerCase() !== 'wdagutilityaccount' || root.toLowerCase() !== 'c:\\xjy-work\\xjy-web-stage1') throw Error('Customer directory UI tests require the fixed actual Windows Sandbox');
const guard = require('../stage1/isolation.cjs').createIsolationGuard(root);
const proof = require('node:child_process').spawnSync('C:\\Python314\\python.exe', ['-I', '-B', guard.assertPath(path.join(root, 'stage1/validate-sandbox-context.py'))], { cwd: root, windowsHide: true, encoding: 'utf8' });
if (proof.status !== 0) throw Error('Unchanged actual Sandbox admission failed');
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm');
const deps = path.resolve(process.env.XJY_DIRECTORY_DEPS || path.join(root, 'audit-tools/dependencies/node_modules'));
if (deps.toLowerCase() !== path.join(root, 'audit-tools/dependencies/node_modules').toLowerCase()) throw Error('Only the approved Guest public dependency directory is allowed');
const ts = require(guard.assertPath(path.join(deps, 'typescript')));
const project = guard.assertPath(path.join(root, 'project'));
const componentFile = path.join(project, 'desktop/renderer/customer-directory.tsx');
const workspaceFile = path.join(project, 'desktop/renderer/workspace.tsx');
const jsx = (type, props, key) => ({ type, props: props || {}, key });
const jsxRuntime = { jsx, jsxs: jsx, Fragment: Symbol.for('test.fragment') };
const customer = (id, name = '虚构客户' + id) => ({ id, name, phone: '00000000001', notes: '', ownerId: 'synthetic-staff', createdAt: '2026-10-01', updatedAt: '2026-10-01', revision: 1, access: { canEdit: true, canManage: false, relation: 'owner' } });
function reply(customers, total = customers.length, stats = {}, page = 1) {
  return { customers, total, page, pageSize: 20, counts: Object.fromEntries(customers.map(c => [c.id, stats[c.id] || { quoteVersionCount: 0, confirmedRecordCount: 0 }])) };
}
function allNodes(node, found = []) {
  if (Array.isArray(node)) { for (const child of node) allNodes(child, found); return found; }
  if (!node || typeof node !== 'object') return found;
  found.push(node); allNodes(node.props?.children, found); return found;
}
function text(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (Array.isArray(node)) return node.map(text).join(' ');
  if (typeof node !== 'object') return String(node);
  return text(node.props?.children);
}
const accessibleName = node => String(node.props?.['aria-label'] || text(node));

// This adapter models React state/effect cleanup and controllable bridge/timers.
// It executes actual source handlers; it does not implement directory behavior.
function harness({ workspace = false, props = {}, bootstrap } = {}) {
  const h = { tree: null, requests: [], opened: [], deleted: [], created: 0, dirty: true, disposed: false, writes: 0, time: 0 };
  const slots = [], pending = [], timers = new Map(), modules = new Map(); let cursor = 0, timerId = 0;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const slot = (kind, make) => { const index = cursor++; if (!slots[index]) slots[index] = { kind, ...make() }; assert.equal(slots[index].kind, kind, 'stable actual hook order'); return [slots[index], index]; };
  const react = {
    useState(initial) { const [state] = slot('state', () => ({ value: typeof initial === 'function' ? initial() : initial })); return [state.value, update => { h.writes++; const next = typeof update === 'function' ? update(state.value) : update; if (!Object.is(next, state.value)) { state.value = next; h.dirty = true; } }]; },
    useRef(initial) { const [state] = slot('ref', () => ({ value: { current: initial } })); return state.value; },
    useEffect(effect, dependencies) { const [state, index] = slot('effect', () => ({ dependencies: undefined, cleanup: undefined })); if (!same(state.dependencies, dependencies)) pending.push({ index, effect, dependencies }); },
    useLayoutEffect(effect, dependencies) { return react.useEffect(effect, dependencies); },
    useMemo(make, dependencies) { const [state] = slot('memo', () => ({ dependencies: undefined, value: undefined })); if (!same(state.dependencies, dependencies)) { state.dependencies = dependencies; state.value = make(); } return state.value; },
    useCallback(fn, dependencies) { return react.useMemo(() => fn, dependencies); },
    useId() { const [state, index] = slot('id', () => ({})); return 'synthetic-id-' + index; },
  };
  h.setTimeout = (fn, delay = 0) => { const id = ++timerId; timers.set(id, { at: h.time + delay, fn }); return id; };
  h.clearTimeout = id => timers.delete(id);
  h.api = (address, method = 'GET', body) => {
    const request = { address, method, body, params: new URL('http://fixture.invalid' + address).searchParams };
    request.promise = new Promise((resolve, reject) => { request.resolve = resolve; request.reject = reject; });
    h.requests.push(request); return request.promise;
  };
  const icons = new Proxy({}, { get(_target, name) { return props => jsx('svg', { ...props, 'data-test-icon': String(name) }); } });
  function compile(source, filename) {
    const compiled = ts.transpileModule(source, { fileName: filename, reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } });
    assert.equal((compiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0, 'actual source transpiles without syntax diagnostics');
    return compiled.outputText;
  }
  function load(file) {
    file = guard.assertPath(file);
    assert(file.startsWith(project + path.sep), 'component imports stay in the isolated project');
    if (modules.has(file)) return modules.get(file).exports;
    assert(fs.existsSync(file), 'approved CustomerDirectory source is missing; current directory still uses bootstrap');
    const module = { exports: {} }; modules.set(file, module);
    function localRequire(name) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return jsxRuntime;
      if (name === 'lucide-react') return icons;
      if (name === './bridge') return { api: h.api };
      if (name.endsWith('.css')) return {};
      if (name.startsWith('.') || name.startsWith('@/')) {
        const base = name.startsWith('@/') ? path.join(project, name.slice(2)) : path.resolve(path.dirname(file), name);
        for (const candidate of [base, base + '.ts', base + '.tsx']) if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return load(candidate);
      }
      throw Error('Unreviewed component test import: ' + name);
    }
    vm.runInNewContext(compile(fs.readFileSync(file, 'utf8'), file), { module, exports: module.exports, require: localRequire, console, Error, URLSearchParams, URL, Promise, AbortController, setTimeout: h.setTimeout, clearTimeout: h.clearTimeout }, { filename: file });
    return module.exports;
  }
  const directory = props => load(componentFile).default(props);
  h.props = { revision: 0, scopeKey: 'synthetic-staff:1', admin: false, canWriteSales: true, busy: false, onOpen: c => h.opened.push(c), onDelete: c => h.deleted.push(c), onNew: () => h.created++, ...props };
  const Button = props => jsx('button', props), Empty = props => jsx('section', { children: [props.title, props.text] });
  let branch, scope;
  if (workspace) {
    // Compile only the current actual JSX customer branch, not unrelated app code.
    const source = fs.readFileSync(workspaceFile, 'utf8'), tree = ts.createSourceFile(workspaceFile, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); let expression;
    function visit(node) { if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && node.left.getText(tree) === 'activePage === "customers"') expression = node.getText(tree); ts.forEachChild(node, visit); }
    visit(tree); assert(expression, 'actual workspace customer branch exists');
    const data = bootstrap || { customers: [], quotes: [], user: { id: 'synthetic-staff', role: 'employee', grantRevision: 1 } };
    scope = { module: { exports: {} }, require: name => { assert.equal(name, 'react/jsx-runtime'); return jsxRuntime; }, activePage: 'customers', data, search: '', setSearch: value => { scope.search = value; h.dirty = true; }, dataRevision: h.props.revision, admin: h.props.admin, busy: h.props.busy, canWriteSales: h.props.canWriteSales, CustomerDirectory: directory, Search: icons.Search, Plus: icons.Plus, ChevronRight: icons.ChevronRight, Trash2: icons.Trash2, Button, Empty, showCustomer: () => h.created++, setCustomerDetail: c => h.opened.push(c), setRecordAction: action => h.deleted.push(action.customer) };
    scope.exports = scope.module.exports;
    vm.runInNewContext(compile('module.exports=()=>(' + expression + ');', workspaceFile), scope, { filename: workspaceFile }); branch = scope.module.exports;
  }
  function realize(node) {
    if (Array.isArray(node)) return node.map(realize);
    if (!node || typeof node !== 'object') return node;
    if (typeof node.type === 'function') return realize(node.type(node.props));
    return { ...node, props: { ...node.props, children: realize(node.props?.children) } };
  }
  h.flush = () => {
    if (h.disposed) return;
    for (let attempts = 0; h.dirty || pending.length; attempts++) {
      assert(attempts < 40, 'actual component settles without an effect loop');
      if (h.dirty) { h.dirty = false; cursor = 0; h.tree = realize(workspace ? branch() : directory(h.props)); }
      while (pending.length) { const next = pending.shift(), state = slots[next.index]; if (state.cleanup) state.cleanup(); state.dependencies = next.dependencies; state.cleanup = next.effect(); }
    }
  };
  h.advance = milliseconds => { h.time += milliseconds; for (;;) { const due = [...timers].filter(([, timer]) => timer.at <= h.time).sort((a, b) => a[1].at - b[1].at)[0]; if (!due) break; timers.delete(due[0]); due[1].fn(); h.flush(); } h.flush(); };
  h.settle = async () => { for (let n = 0; n < 8; n++) { await Promise.resolve(); h.flush(); } };
  h.respond = async (index, data) => { assert(h.requests[index], 'expected actual request ' + index); h.requests[index].resolve(data); await h.settle(); };
  h.reject = async (index, error) => { assert(h.requests[index], 'expected actual request ' + index); h.requests[index].reject(error); await h.settle(); };
  h.nodes = () => allNodes(h.tree);
  h.input = () => { const value = h.nodes().find(node => node.type === 'input'); assert(value, 'customer search input'); return value; };
  h.button = pattern => { const value = h.nodes().find(node => node.type === 'button' && pattern.test(accessibleName(node))); assert(value, 'accessible button ' + pattern); return value; };
  h.change = value => { h.input().props.onChange({ target: { value } }); h.flush(); };
  h.click = node => { assert.equal(node.props.disabled, undefined === node.props.disabled ? undefined : false, 'test clicks an enabled button'); node.props.onClick(); h.flush(); };
  h.update = patch => { Object.assign(h.props, patch); if (scope) { scope.dataRevision = h.props.revision; scope.admin = h.props.admin; scope.busy = h.props.busy; scope.canWriteSales = h.props.canWriteSales; } h.dirty = true; h.flush(); };
  h.dispose = () => { for (const state of slots) if (state.kind === 'effect' && state.cleanup) state.cleanup(); h.disposed = true; };
  h.flush(); return h;
}
async function start(h, data = reply([customer('first')])) { h.advance(250); assert.equal(h.requests.length, 1, 'directory requests full authorized server data'); await h.respond(0, data); return h; }

test('actual workspace customer branch requests the full server list instead of searching cached 1000 and counting cached 200', async () => {
  const target = customer('outside', '虚构首千之外客户'), bootstrap = { customers: Array.from({ length: 1000 }, (_, n) => customer('local-' + n)), quotes: Array.from({ length: 200 }, () => ({ customerId: target.id })), user: { id: 'synthetic-staff', role: 'employee', grantRevision: 1 } };
  const h = harness({ workspace: true, bootstrap });
  await start(h, reply([target], 1005, { outside: { quoteVersionCount: 205, confirmedRecordCount: 1 } }));
  assert.match(text(h.tree), /虚构首千之外客户/); assert.match(text(h.tree), /205/); assert.match(text(h.tree), /报价记录/); assert.match(text(h.tree), /已成交记录/); assert.match(text(h.tree), /1005/);
  h.click(h.button(/虚构首千之外客户/)); assert.equal(h.opened[0].id, target.id);
  h.dispose();
});

test('query changes invalidate old buttons immediately and reversed responses cannot replace current results', async () => {
  const h = await start(harness()), oldButton = h.button(/虚构客户first/);
  h.change('甲'); oldButton.props.onClick(); assert.equal(h.opened.length, 0, 'stale rendered handler cannot select old customer');
  h.advance(250); h.change('乙'); h.advance(250);
  assert.equal(h.requests[1].params.get('q'), '甲'); assert.equal(h.requests[2].params.get('q'), '乙');
  await h.respond(2, reply([customer('new', '虚构最新乙客户')]));
  await h.respond(1, reply([customer('old', '虚构过时甲客户')]));
  assert.match(text(h.tree), /虚构最新乙客户/); assert.doesNotMatch(text(h.tree), /虚构过时甲客户/);
  h.click(h.button(/虚构最新乙客户/)); assert.equal(h.opened[0].id, 'new'); h.dispose();
});

test('page responses cannot overwrite a new query and query resets server page to one', async () => {
  const h = await start(harness(), reply([customer('first')], 41));
  assert.equal(h.button(/上一页/).props.disabled, true);
  h.click(h.button(/下一页/)); h.advance(250); assert.equal(h.requests[1].params.get('page'), '2');
  h.change('新查询'); h.advance(250); assert.equal(h.requests[2].params.get('page'), '1'); assert.equal(h.requests[2].params.get('pageSize'), '20');
  await h.respond(2, reply([customer('query', '虚构新查询客户')])); await h.respond(1, reply([customer('page-old', '虚构过时第二页')], 41, {}, 2));
  assert.match(text(h.tree), /虚构新查询客户/); assert.doesNotMatch(text(h.tree), /虚构过时第二页/); h.dispose();
});

test('revision and scope changes reject previous reads, and unmount stops late state writes', async () => {
  const h = harness(); h.advance(250);
  h.update({ revision: 1 }); h.advance(250);
  h.update({ scopeKey: 'synthetic-other-staff:2' }); h.advance(250);
  assert.equal(h.requests.length, 3);
  await h.respond(2, reply([customer('current', '虚构当前受权客户')]));
  await h.respond(1, reply([customer('old-revision', '虚构旧修订客户')])); await h.respond(0, reply([customer('old-scope', '虚构旧账号客户')]));
  assert.match(text(h.tree), /虚构当前受权客户/); assert.doesNotMatch(text(h.tree), /虚构旧修订客户|虚构旧账号客户/);
  h.change('卸载后'); h.advance(250); h.dispose(); const writes = h.writes;
  await h.respond(3, reply([customer('after-unmount')])); assert.equal(h.writes, writes, 'late completion must not mutate disposed component state');
});

test('503 remains an explicit failure, does not become an empty success, and retry obtains fresh counts', async () => {
  const h = await start(harness()); h.change('故障查询'); h.advance(250);
  await h.reject(1, Error('客户搜索失败（503）'));
  assert.match(text(h.tree), /503/); assert(h.nodes().some(node => node.props.role === 'alert'), 'request error is announced');
  assert.doesNotMatch(text(h.tree), /虚构客户first/);
  h.click(h.button(/重试/)); h.advance(250);
  await h.respond(2, reply([customer('recovered', '虚构恢复客户')], 1, { recovered: { quoteVersionCount: 205, confirmedRecordCount: 1 } }));
  assert.match(text(h.tree), /虚构恢复客户/); assert.match(text(h.tree), /205/); assert.doesNotMatch(text(h.tree), /503/); h.dispose();
});

test('old or invalid missing statistics display unavailable rather than fake zero or cached record counts', async () => {
  for (const kind of ['missing', 'invalid']) {
    const c = customer('legacy'), data = reply([c]);
    if (kind === 'missing') delete data.counts; else data.counts[c.id] = { quoteVersionCount: -1, confirmedRecordCount: NaN };
    const h = await start(harness(), data), card = h.button(/虚构客户legacy/), rendered = text(card);
    assert.match(rendered, /—|统计暂不可用/); assert.doesNotMatch(rendered, /NaN|-1|\b0\s*(?:条|次)?\s*(?:报价|成交)/);
    h.click(card); assert.equal(h.opened[0].id, c.id, 'legacy statistics absence does not invent a customer access denial'); h.dispose();
  }
});

test('empty customer library, no matching search and loading/error are separate states', async () => {
  const h = harness(); assert.match(text(h.tree), /读取|加载|搜索|正在/);
  await start(h, reply([])); const emptyLibrary = text(h.tree); assert.match(emptyLibrary, /还没有|暂无客户/);
  h.change('不存在的虚构客户'); h.advance(250); await h.respond(1, reply([]));
  const noMatch = text(h.tree); assert.match(noMatch, /没有.*(?:匹配|找到)|无匹配/); assert.notEqual(noMatch, emptyLibrary);
  assert.equal(h.button(/下一页/).props.disabled, true); h.dispose();
});

test('deleting the last record on the final page refreshes to a valid page instead of a permanent false empty state', async () => {
  const h = await start(harness(), reply([customer('first')], 21));
  h.click(h.button(/下一页/)); h.advance(250); await h.respond(1, reply([customer('last')], 21, {}, 2));
  h.update({ revision: 1 }); h.advance(250); assert.equal(h.requests[2].params.get('page'), '2');
  await h.respond(2, reply([], 20, {}, 2)); h.advance(250);
  assert.equal(h.requests[3].params.get('page'), '1', 'out-of-range page must be refetched using actual total');
  await h.respond(3, reply([customer('remaining', '虚构仍然存在客户')], 20));
  assert.match(text(h.tree), /虚构仍然存在客户/); assert.doesNotMatch(text(h.tree), /还没有客户/); h.dispose();
});

test('open and delete remain sibling actions, admin only, and busy/read-only states disable writes', async () => {
  const c = customer('card', '虚构长客户姓名用于手机换行验收');
  const h = await start(harness({ props: { admin: true } }), reply([c]));
  const button = h.button(/删除客户/); h.click(button); assert.equal(h.deleted[0].id, c.id); assert.equal(h.opened.length, 0);
  for (const node of h.nodes().filter(node => node.type === 'button')) assert.equal(allNodes(node.props.children).some(child => child.type === 'button'), false, 'interactive buttons must never be nested');
  h.update({ busy: true }); assert.equal(h.button(/删除客户/).props.disabled, true); assert.equal(h.button(/新建客户/).props.disabled, true);
  h.update({ busy: false, canWriteSales: false }); assert.equal(h.button(/删除客户/).props.disabled, true); assert.equal(h.button(/新建客户/).props.disabled, true);
  h.update({ admin: false, canWriteSales: true }); assert.equal(h.nodes().some(node => node.type === 'button' && /删除客户/.test(accessibleName(node))), false);
  assert.equal(h.input().props.maxLength, 120); assert(h.input().props['aria-label'], 'search input needs an accessible name'); h.dispose();
});

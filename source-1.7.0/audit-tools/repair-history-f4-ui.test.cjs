'use strict';

// Draft executable component tests. Actual Guest admission before any TSX import.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const root = path.resolve(__dirname, '..');
if (process.platform !== 'win32' || os.userInfo().username.toLowerCase() !== 'wdagutilityaccount' || root.toLowerCase() !== 'c:\\xjy-work\\xjy-web-stage1') throw Error('F4 UI tests require the fixed actual Windows Sandbox');
const guard = require('../stage1/isolation.cjs').createIsolationGuard(root);
const admission = require('node:child_process').spawnSync('C:\\Python314\\python.exe', ['-I', '-B', guard.assertPath(path.join(root, 'stage1/validate-sandbox-context.py'))], { cwd: root, windowsHide: true, encoding: 'utf8' });
if (admission.status !== 0) throw Error('Unchanged actual Sandbox admission failed');
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm');
const deps = path.resolve(process.env.XJY_DIRECTORY_DEPS || path.join(root, 'audit-tools/dependencies/node_modules'));
const ts = require(guard.assertPath(path.join(deps, 'typescript')));
const project = guard.assertPath(path.join(root, 'project')), sourceFile = path.join(project, 'desktop/renderer/customer-activity.tsx');
const jsx = (type, props, key) => ({ type, props: props || {}, key }), jsxRuntime = { jsx, jsxs: jsx, Fragment: Symbol.for('test.fragment') };
function text(node) { if (Array.isArray(node)) return node.map(text).join(' '); if (node === null || node === undefined || typeof node === 'boolean') return ''; return typeof node === 'object' ? text(node.props?.children) : String(node); }
function nodes(node, result = []) { if (Array.isArray(node)) node.forEach(item => nodes(item, result)); else if (node && typeof node === 'object') { result.push(node); nodes(node.props?.children, result); } return result; }
const metric = (total = 420) => ({ orderCount: 1, itemCount: 4, weight: 0, total, discount: 0, grossNewJewelryValue: 0, netBalance: total, oldCredit: 0, refund: 0, amountDue: total, oldWeight: 0, depreciation: 0 });
function reply({ total = 420, subtotal = 360, insurance = 60, complete = true, legacy = false, unknown = false } = {}) {
  const items = [
    { id: 'fixed', title: '虚构固定维修', mode: 'fixed', quantity: 1, billQuantity: 1, unitPrice: 120, subtotal: unknown ? null : 120, weight: 0, material: '', goldPrice: 0, laborPrice: 0, extras: 0 },
    { id: 'count', title: '虚构按次维修', mode: 'count', quantity: 3, billQuantity: 3, unitPrice: 80, subtotal: unknown ? null : 240, weight: 0, material: '', goldPrice: 0, laborPrice: 0, extras: 0 },
  ];
  if (!legacy) for (const item of items) item.amountSource = unknown ? 'unavailable' : 'saved';
  const order = { ...metric(total), id: 'repair', rootId: 'repair', number: 'SYNTHETIC-F4-UI', version: 1, customerId: 'customer', customerName: '虚构客户', ownerId: 'staff', ownerName: '虚构员工', createdAt: '2026-10-01T00:00:00Z', confirmedAt: null, date: '2026-10-01', type: 'repair', title: '虚构维修记录', items, saleConfirmation: null, amountLabel: '维修报价', weightLabel: '按克维修计价量', insurance };
  if (!legacy) order.repairBreakdown = { source: 'saved', subtotal, insurance, itemsComplete: complete };
  return { customer: { id: 'customer', name: '虚构客户', phone: '', notes: '' }, basis: 'quotes', orders: [order], total: 1, page: 1, pageSize: 20, summary: metric(total), byType: [], metadata: { sourceNote: '虚构已保存版本；非收款账务', weightNote: '虚构计价量说明' } };
}

function harness() {
  const h = { dirty: true, tree: null, requests: [], opened: [], disposed: false }, slots = [], pending = [], modules = new Map(); let cursor = 0;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const slot = (kind, make) => { const index = cursor++; if (!slots[index]) slots[index] = { kind, ...make() }; assert.equal(slots[index].kind, kind); return [slots[index], index]; };
  const react = {
    useState(initial) { const [state] = slot('state', () => ({ value: typeof initial === 'function' ? initial() : initial })); return [state.value, update => { const next = typeof update === 'function' ? update(state.value) : update; if (!Object.is(next, state.value)) { state.value = next; h.dirty = true; } }]; },
    useEffect(effect, dependencies) { const [state, index] = slot('effect', () => ({ dependencies: undefined, cleanup: undefined })); if (!same(state.dependencies, dependencies)) pending.push({ index, effect, dependencies }); },
    useRef(initial) { const [state] = slot('ref', () => ({ value: { current: initial } })); return state.value; },
    useMemo(make, dependencies) { const [state] = slot('memo', () => ({ dependencies: undefined, value: undefined })); if (!same(state.dependencies, dependencies)) { state.dependencies = dependencies; state.value = make(); } return state.value; },
  };
  const api = address => { const request = { address, params: new URL('http://fixture.invalid' + address).searchParams }; request.promise = new Promise((resolve, reject) => { request.resolve = resolve; request.reject = reject; }); h.requests.push(request); return request.promise; };
  const icons = new Proxy({}, { get: (_target, name) => props => jsx('svg', { ...props, 'data-test-icon': String(name) }) });
  function load(file) {
    file = guard.assertPath(file); assert(file.startsWith(project + path.sep), 'actual imports stay inside isolated project');
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} }; modules.set(file, module);
    const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { fileName: file, reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } });
    assert.equal((compiled.diagnostics || []).filter(item => item.category === ts.DiagnosticCategory.Error).length, 0, 'actual source has no syntax diagnostics');
    const localRequire = name => {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return jsxRuntime;
      if (name === 'lucide-react') return icons;
      if (name === './bridge') return { api };
      if (name.endsWith('.css')) return {};
      if (name.startsWith('.') || name.startsWith('@/')) { const base = name.startsWith('@/') ? path.join(project, name.slice(2)) : path.resolve(path.dirname(file), name); for (const candidate of [base, base + '.ts', base + '.tsx']) if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return load(candidate); }
      throw Error('Unreviewed F4 UI import: ' + name);
    };
    vm.runInNewContext(compiled.outputText, { module, exports: module.exports, require: localRequire, Error, URL, URLSearchParams, Promise, console }, { filename: file }); return module.exports;
  }
  const Component = load(sourceFile).default;
  function realize(node) { if (Array.isArray(node)) return node.map(realize); if (!node || typeof node !== 'object') return node; if (typeof node.type === 'function') return realize(node.type(node.props)); return { ...node, props: { ...node.props, children: realize(node.props?.children) } }; }
  h.flush = () => { if (h.disposed) return; for (let count = 0; h.dirty || pending.length; count++) { assert(count < 40, 'component settles'); if (h.dirty) { h.dirty = false; cursor = 0; h.tree = realize(Component({ customerId: 'customer', revision: 0, onOpen: id => h.opened.push(id) })); } while (pending.length) { const next = pending.shift(), state = slots[next.index]; if (state.cleanup) state.cleanup(); state.dependencies = next.dependencies; state.cleanup = next.effect(); } } };
  h.settle = async () => { for (let n = 0; n < 8; n++) { await Promise.resolve(); h.flush(); } };
  h.respond = async (index, data) => { assert(h.requests[index]); h.requests[index].resolve(data); await h.settle(); };
  h.reject = async (index, error) => { assert(h.requests[index]); h.requests[index].reject(error); await h.settle(); };
  h.button = pattern => { const button = nodes(h.tree).find(node => node.type === 'button' && pattern.test(String(node.props['aria-label'] || text(node)))); assert(button, 'actual accessible button ' + pattern); return button; };
  h.click = button => { assert(!button.props.disabled); button.props.onClick(); h.flush(); };
  h.dispose = () => { for (const state of slots) if (state.kind === 'effect' && state.cleanup) state.cleanup(); h.disposed = true; };
  h.flush(); return h;
}
async function start(data) { const h = harness(); assert.equal(h.requests.length, 1); assert.equal(h.requests[0].params.get('basis'), 'quotes'); await h.respond(0, data); return h; }

test('F4 actual activity component explains saved repair360 plus insurance60 and total420', async () => {
  const h = await start(reply()), rendered = text(h.tree);
  assert.match(rendered, /(?:维修.*合计|维修费用).*360\.00/s); assert.match(rendered, /保价费.*60\.00/s); assert.match(rendered, /420\.00/);
  h.click(h.button(/虚构维修记录/)); assert.equal(h.opened[0], 'repair'); h.dispose();
});
test('F4 unknown service amounts show unavailable, never money(null) as historical 0.00', async () => {
  const h = await start(reply({ total: 359.99, subtotal: 359.99, insurance: 0, complete: false, unknown: true })), rendered = text(h.tree);
  assert.match(rendered, /(?:逐项|分项|明细).*(?:未保存|不可用|缺失)/s); assert.match(rendered, /359\.99/); assert.doesNotMatch(rendered, /小计\s*[¥￥]?\s*(?:0\.00|240\.00)/); h.dispose();
});
test('F4 legacy host numeric service subtotals without provenance are not accepted as saved facts', async () => {
  const h = await start(reply({ total: 359.99, subtotal: 359.99, insurance: 0, legacy: true })), rendered = text(h.tree);
  assert.match(rendered, /(?:逐项|分项|明细).*(?:未保存|不可用|缺失)/s); assert.doesNotMatch(rendered, /小计\s*[¥￥]?\s*240\.00/); assert.match(rendered, /80\.00/); h.dispose();
});
test('F4 a genuinely saved zero service amount is not mistaken for missing history', async () => {
  const data = reply({ total: 0, subtotal: 0, insurance: 0 }); data.orders[0].items = [{ ...data.orders[0].items[0], unitPrice: 0, subtotal: 0 }];
  const h = await start(data), rendered = text(h.tree); assert.match(rendered, /小计\s*[¥￥]?\s*0\.00/); assert.doesNotMatch(rendered, /逐项.*(?:未保存|不可用)/s); h.dispose();
});
test('F4 historical-source failure remains an announced error instead of empty success or recomputed details', async () => {
  const h = harness(); await h.reject(0, Error('历史报价保存的金额快照缺失，请核对原始单据，不能按当前规则重算'));
  assert(nodes(h.tree).some(node => node.props.role === 'alert')); assert.match(text(h.tree), /历史报价保存的金额快照缺失/); assert.doesNotMatch(text(h.tree), /正在读取|暂无符合条件/); h.dispose();
});
test('F4 sales numeric rows and actual basis/open handlers remain intact beside repair degradation', async () => {
  const data = reply({ total: 359.99, subtotal: 359.99, insurance: 0, complete: false, unknown: true });
  data.orders.push({ ...data.orders[0], ...metric(519.99), id: 'sale', rootId: 'sale', type: 'sale', title: '虚构销售记录', repairBreakdown: undefined, items: [{ id: 'sale-item', title: '虚构保存商品', material: '足金', weight: 1, quantity: 1, goldPrice: 500, laborPrice: 20, extras: 0, subtotal: 519.99 }] }); data.total = 2;
  const h = await start(data); assert.match(text(h.tree), /小计\s*[¥￥]?\s*519\.99/); h.click(h.button(/虚构销售记录/)); assert.equal(h.opened[0], 'sale');
  h.click(h.button(/^成交明细$/)); assert.equal(h.requests.length, 2); assert.equal(h.requests[1].params.get('basis'), 'confirmed'); h.dispose();
});

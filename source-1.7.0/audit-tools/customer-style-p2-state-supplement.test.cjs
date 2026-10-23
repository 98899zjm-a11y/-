'use strict';
// Four independent supplements. No Host execution, real UI, file DB or service.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const ROOT = path.resolve(__dirname, '..');
if (process.platform !== 'win32' || os.userInfo().username.toLowerCase() !== 'wdagutilityaccount' || ROOT.toLowerCase() !== 'c:\\xjy-work\\xjy-web-stage1') throw Error('P2 state supplement requires the fixed actual Windows Sandbox');
const guard = require('../stage1/isolation.cjs').createIsolationGuard(ROOT);
const crypto = require('node:crypto'), vm = require('node:vm'), Module = require('node:module');
const FROZEN = guard.assertPath(path.join(ROOT, 'audit-tools/customer-style-data-path-p2.test.cjs'));
const stat = fs.lstatSync(FROZEN); if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw Error('Frozen P2 source must be an ordinary file');
const source = fs.readFileSync(FROZEN, 'utf8');
if (crypto.createHash('sha256').update(source).digest('hex') !== 'd7dfd7281dae9c99e0f76e6f2cadc4d2c895ab7c7aa3a8f9d4ffee37078e13cb') throw Error('Frozen ten-case P2 harness changed');
const marker = "\ntest('H00 ", at = source.indexOf(marker);
if (at < 0 || source.indexOf(marker, at + 1) !== -1) throw Error('Unique frozen prelude boundary required');
const prelude = { exports: {} };
// Original prelude performs its actual Guest proof BEFORE sqlite/runtime imports,
// installs RAM-only/temp_store=MEMORY policy, and registers no original tests.
vm.runInThisContext('(function(require,module,exports,__dirname){' + source.slice(0, at) + '\nmodule.exports={fixture,customerScope,initializer,pureModule,domain,preview,server,history,ADMIN,A,compile,guard,PROJECT};\n})', { filename: FROZEN })(Module.createRequire(FROZEN), prelude, prelude.exports, path.dirname(FROZEN));
const { fixture, customerScope, initializer, pureModule, domain, preview, server, history, ADMIN, A, compile, PROJECT } = prelude.exports;
const test = require('node:test'), assert = require('node:assert/strict');
const itemDraft = () => ({ ...history.input(), customerId: '', saleItems: [history.item('one', '虚构状态商品', 500, 20)] });

test('P01 changing or clearing customerId cannot inherit the prior brief name', async t => {
  const f = fixture(t, { customers: true }); f.actor(A);
  const h = customerScope(f, await server.bootstrap(), itemDraft()); h.select(f.old); assert.equal(h.paper().customerName, '虚构老客户');
  h.scope().edit({ customerId: f.recent.id });
  assert.equal(h.drafts.sale.customerId, f.recent.id); assert.equal(h.drafts.sale.customerBrief, undefined); assert.equal(h.paper().customerName, f.recent.name);
  h.select(f.old); h.scope().edit({ customerId: '' });
  assert.equal(h.drafts.sale.customerId, ''); assert.equal(h.drafts.sale.customerBrief, undefined); assert.equal(h.paper().customerName, '未填写客户');
  assert.equal(h.paper().total, 520);
});

test('P02 actual persist strips UI brief and rebuilds same-ID canonical customer from real server', async t => {
  const f = fixture(t, { customers: true }); f.actor(A);
  const h = customerScope(f, await server.bootstrap(), itemDraft()); h.select(f.old);
  // A master-data edit while a draft is open makes the canonical response
  // distinguishable from the old UI brief, without inventing a saved response.
  f.sqlite.prepare('UPDATE customers SET name=? WHERE id=?').run('虚构主机更正名', f.old.id);
  const scope = h.scope(), access = pureModule('desktop/renderer/module-access.ts'); let posted;
  scope.accessRef = { current: { sales: 'operate' } }; scope.mayOperate = access.mayOperate;
  scope.requireSalesWrite = initializer('requireSalesWrite', scope);
  scope.quoteInputSchema = domain.quoteInputSchema; scope.draftTotals = initializer('draftTotals', scope);
  scope.validatePreview = initializer('validatePreview', scope);
  scope.readPhoto = async () => { throw Error('P2_STATE_MUST_NOT_READ_OR_WRITE_IMAGES'); };
  scope.isCurrentSavedQuote = () => { throw Error('Fresh-save fixture must not enter saved-resume branch'); };
  scope.api = async (address, method = 'GET', body) => {
    f.actor(A); globalThis.__financeGuardFixture.env.BUCKET = { put() { throw Error('P2_STATE_IMAGE_WRITE_DENIED'); }, get() { throw Error('P2_STATE_IMAGE_READ_DENIED'); }, delete() { throw Error('P2_STATE_IMAGE_DELETE_DENIED'); } };
    if (address === '/api/bootstrap' && method === 'GET') return server.bootstrap();
    assert.equal(address, '/api/quotes'); assert.equal(method, 'POST');
    assert.equal(posted, undefined, 'one fresh quote POST'); posted = body;
    assert.equal(Object.hasOwn(body, 'customerBrief'), false, 'UI-only brief must not cross the POST boundary');
    const response = await server.api(() => server.createQuote(new Request('http://fixture.invalid/api/quotes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })));
    const result = await response.json(); assert.equal(response.status, 200, 'real RAM server accepts the literal valid quote'); return result;
  };
  scope.refresh = initializer('refresh', scope);
  const record = await initializer('persistCurrentQuote', scope)();
  assert.equal(posted.customerId, f.old.id); assert.equal(record.customerId, f.old.id); assert.equal(record.customerName, '虚构主机更正名');
  assert.equal(h.data.customers.some(customer => customer.id === f.old.id), false, 'old customer still falls outside real bootstrap1000');
  assert.equal(h.drafts.sale.customerBrief.id, f.old.id); assert.equal(h.drafts.sale.customerBrief.name, '虚构主机更正名');
  assert.equal(h.paper().customerName, '虚构主机更正名'); assert.equal(h.paper().total, 520);
  const stored = f.sqlite.prepare('SELECT customer_id,snapshot,total_cents FROM quotes WHERE id=?').get(record.id), saved = JSON.parse(stored.snapshot);
  assert.equal(stored.customer_id, f.old.id); assert.equal(stored.total_cents, 52000); assert.equal(saved.customer.name, '虚构主机更正名'); assert.equal(Object.hasOwn(saved, 'customerBrief'), false);
});

const jsx = (type, props, key) => ({ type, props: props || {}, key }), jsxRuntime = { jsx, jsxs: jsx, Fragment: Symbol.for('p2.state.fragment') };
function nodes(node, result = []) { if (Array.isArray(node)) node.forEach(child => nodes(child, result)); else if (node && typeof node === 'object') { result.push(node); nodes(node.props?.children, result); } return result; }
function text(node) { return Array.isArray(node) ? node.map(text).join(' ') : node == null || typeof node === 'boolean' ? '' : typeof node === 'object' ? text(node.props?.children) : String(node); }
function holdActualReplies(f) {
  const original = f.reply, held = [];
  f.reply = async (...args) => { const entry = { args }; held.push(entry); entry.value = await original(...args); return new Promise(resolve => { entry.release = () => resolve(entry.value); }); };
  held.release = index => { const entry = held[index]; assert.equal(entry?.value?.status, 200, 'real response ready before release'); assert.equal(typeof entry.release, 'function'); entry.release(); };
  return held;
}

// Same controlled-hook/element boundary as frozen U01, with layout commit and
// passive cleanup split explicitly. No product callback body is substituted.
function stylePhases(f) {
  const h = { props: { revision: 0, busy: false, onNew() {}, onEdit: value => h.opened.push(value) }, tree: null, dirty: true, disposed: false, opened: [], writes: [], time: 0 };
  const slots = [], layout = [], passive = [], timers = new Map(); let cursor = 0, timerId = 0;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  function slot(kind, make) { const index = cursor++; if (!slots[index]) slots[index] = { kind, ...make() }; assert.equal(slots[index].kind, kind); return slots[index]; }
  function effect(queue, kind, run, deps) { const state = slot(kind, () => ({ deps: undefined, cleanup: undefined })); if (!same(state.deps, deps)) queue.push({ state, run, deps }); }
  const react = {
    useState(initial) { const state = slot('state', () => ({ value: typeof initial === 'function' ? initial() : initial })); return [state.value, update => { const next = typeof update === 'function' ? update(state.value) : update; h.writes.push({ afterDispose: h.disposed }); if (!Object.is(next, state.value)) { state.value = next; if (!h.disposed) h.dirty = true; } }]; },
    useRef(value) { return slot('ref', () => ({ value: { current: value } })).value; },
    useEffect(run, deps) { effect(passive, 'effect', run, deps); },
    useLayoutEffect(run, deps) { effect(layout, 'layout', run, deps); },
  };
  const file = guard.assertPath(path.join(PROJECT, 'desktop/renderer/style-management.tsx')), module = { exports: {} };
  const api = async (address, method = 'GET') => { assert.equal(method, 'GET'); const url = new URL(address, 'http://fixture.invalid'); assert.equal(url.pathname, '/api/styles/search'); const result = await f.reply(Object.fromEntries(url.searchParams), ADMIN); if (!result.ok) throw Error(result.data.error); return result.data; };
  const setTimeout = (run, delay = 0) => { const id = ++timerId; timers.set(id, { at: h.time + delay, run }); return id; }, clearTimeout = id => timers.delete(id);
  const icons = new Proxy({}, { get: () => props => jsx('svg', props) });
  vm.runInNewContext(compile(fs.readFileSync(file, 'utf8'), file), { module, exports: module.exports, require: name => { if (name === 'react') return react; if (name === 'react/jsx-runtime') return jsxRuntime; if (name === 'lucide-react') return icons; if (name === './bridge') return { api }; throw Error('Unreviewed state-component import ' + name); }, setTimeout, clearTimeout, URLSearchParams, console }, { filename: file });
  const Component = module.exports.default;
  const realize = node => Array.isArray(node) ? node.map(realize) : !node || typeof node !== 'object' ? node : typeof node.type === 'function' ? realize(node.type(node.props)) : { ...node, props: { ...node.props, children: realize(node.props?.children) } };
  const commit = queue => { while (queue.length) { const next = queue.shift(); next.state.cleanup?.(); next.state.deps = next.deps; next.state.cleanup = next.run(); } };
  h.render = patch => { assert.equal(h.disposed, false); Object.assign(h.props, patch); cursor = 0; layout.length = 0; passive.length = 0; h.dirty = false; h.tree = realize(Component(h.props)); };
  h.commitLayout = () => commit(layout); h.flushPassive = () => commit(passive);
  h.flush = () => { if (h.disposed) return; for (let n = 0; h.dirty || layout.length || passive.length; n++) { assert.ok(n < 50, 'phase fixture settles'); if (h.dirty) h.render(); h.commitLayout(); h.flushPassive(); } };
  h.advance = value => { h.time += value; for (;;) { const due = [...timers].filter(([, row]) => row.at <= h.time).sort((a, b) => a[1].at - b[1].at)[0]; if (!due) break; timers.delete(due[0]); due[1].run(); h.flush(); } };
  h.tick = async () => { for (let n = 0; n < 12; n++) await new Promise(resolve => setImmediate(resolve)); };
  h.settle = async () => { for (let n = 0; n < 12; n++) { await new Promise(resolve => setImmediate(resolve)); h.flush(); } };
  h.find = predicate => { const result = nodes(h.tree).find(predicate); assert.ok(result, 'real component control exists'); return result; };
  h.dispose = () => { if (h.disposed) return; h.disposed = true; for (const state of slots) state.cleanup?.(); timers.clear(); layout.length = 0; passive.length = 0; };
  h.flush(); return h;
}

test('P03 new query and committed revision reject late reply and queued old card action', async t => {
  const f = fixture(t, { styles: true }), held = holdActualReplies(f), h = stylePhases(f); t.after(h.dispose);
  h.advance(200); await h.tick(); held.release(0); await h.settle();
  const oldCard = h.find(node => node.type === 'button' && text(node).includes('虚构新款302'));
  h.find(node => node.type === 'input').props.onChange({ target: { value: '启用旧款' } }); h.flush(); h.advance(200); await h.tick();
  oldCard.props.onClick(); assert.equal(h.opened.length, 0, 'queued old card cannot open after query changes');
  h.render({ revision: 1 }); h.commitLayout();
  // Real layout effect has committed the key. Old passive cleanup has NOT run.
  const before = h.writes.length; held.release(1); await h.tick();
  assert.equal(h.writes.length, before, 'late result/finally cannot publish during the committed-key / passive-cleanup gap');
  assert.equal(h.opened.length, 0);
  h.flushPassive(); h.flush(); h.advance(200); await h.tick(); held.release(2); await h.settle();
  const currentCard = h.find(node => node.type === 'button' && text(node).includes('虚构启用旧款')); currentCard.props.onClick();
  assert.equal(h.opened.length, 1); assert.equal(h.opened[0].name, '虚构启用旧款');
});

test('P04 old finally cannot clear new loading after revision or write after unmount', async t => {
  const f = fixture(t, { styles: true }), held = holdActualReplies(f), h = stylePhases(f); t.after(h.dispose);
  h.advance(200); await h.tick();
  h.render({ revision: 1 }); h.commitLayout(); h.flushPassive(); h.flush(); h.advance(200); await h.tick();
  assert.equal(held.length, 2); const beforeOld = h.writes.length;
  held.release(0); await h.tick(); assert.equal(h.writes.length, beforeOld, 'old finally must not set loading=false for the new pending request'); h.flush();
  assert.match(text(h.find(node => node.props?.role === 'status')), /正在读取款式库/);
  h.dispose(); const beforeUnmounted = h.writes.length; held.release(1); await h.tick();
  assert.equal(h.writes.length, beforeUnmounted, 'unmounted response/finally must not attempt React state writes'); assert.equal(h.opened.length, 0);
});

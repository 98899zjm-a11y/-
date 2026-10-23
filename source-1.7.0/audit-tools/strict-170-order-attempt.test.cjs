'use strict';

// Root-only finite renderer contracts. This file is source-only on Host.
// The admitted Guest evaluates the unchanged v2 hook harness without registering
// any old test. It opens no database, listener, native app or real browser.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
if (process.platform !== 'win32' || ROOT.toLowerCase() !== 'c:\\xjy-work\\xjy-web-stage1') throw Error('Fixed actual Guest required before renderer evaluation');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function read(relative, maximum = 4 * 1024 * 1024) {
  const file = path.join(ROOT, ...relative.split('/')), relativePath = path.relative(ROOT, file);
  if (relativePath === '..' || relativePath.startsWith('..' + path.sep) || path.isAbsolute(relativePath)) throw Error('Source escaped Root');
  for (let current = file;; current = path.dirname(current)) {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || stat.isFile() && stat.nlink !== 1) throw Error('Source link refused');
    if (current === path.dirname(current)) break;
  }
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > maximum) throw Error('Bounded ordinary source required');
  return fs.readFileSync(file);
}
const assert = require('node:assert/strict'), vm = require('node:vm'), { createRequire } = require('node:module');
const SELF = 'audit-tools/strict-170-order-attempt.test.cjs';
const HARNESS = 'audit-tools/sales-orders-ui-contract-v2.test.cjs';
const HARNESS_SHA = '4487e9a8ee20d09a4cc2f2eff0dc82e0aa6aad8c94f697e728a8dfd5d60875dd';
const COMPILER_SHA = '3ae902c92cc44dace175c0e69e13a4b0899f6983c6121d76b9ab8dd5795e7675';
const FILES = ['project/desktop/renderer/workspace.tsx', 'project/desktop/renderer/sales-orders.tsx', 'project/desktop/renderer/personal-sales.tsx', 'project/desktop/renderer/sales-report.tsx', 'project/desktop/renderer/module-access.ts', 'project/desktop/renderer/collaboration-types.ts'];
const BRIDGE = 'project/desktop/renderer/bridge.ts';
const selfPin = process.env.XJY_STRICT_170_ORDER_ATTEMPT_TEST_SHA256;
const pins = JSON.parse(process.env.XJY_STRICT_170_ORDER_ATTEMPT_SOURCE_PINS || 'null');
assert.match(selfPin || '', /^[a-f0-9]{64}$/);
assert.equal(sha(read(SELF)), selfPin, 'Exact new test source required');
assert(pins && typeof pins === 'object' && !Array.isArray(pins));
assert.deepEqual(Object.keys(pins).sort(), [...FILES, BRIDGE].sort());
for (const file of [...FILES, BRIDGE]) {
  assert.match(pins[file] || '', /^[a-f0-9]{64}$/);
  assert.equal(sha(read(file)), pins[file], 'Exact candidate source required: ' + file);
}
assert.equal(process.env.XJY_STRICT_170_ORDER_ATTEMPT_TYPESCRIPT_SHA256, COMPILER_SHA);
assert.equal(sha(read(HARNESS)), HARNESS_SHA, 'Unchanged reviewed v2 hook harness required');
const harnessSource = read(HARNESS).toString('utf8'), marker = "\ntest('S01 ";
const cut = harnessSource.indexOf(marker);
assert(cut > 0 && harnessSource.indexOf(marker, cut + 1) === -1, 'One exact old-test boundary required');
const harnessPrefix = harnessSource.slice(0, cut), harnessModule = { exports: {} };
assert.equal(/^\s*test\s*\(/m.test(harnessPrefix), false, 'No old tests may be registered');
let admission;
const harnessProcess = { platform: process.platform, env: {
  ...process.env,
  XJY_SALES_ORDERS_UI_TEST_SHA256: HARNESS_SHA,
  XJY_SALES_ORDERS_UI_SOURCE_PINS: JSON.stringify(Object.fromEntries(FILES.map(file => [file, pins[file]]))),
  XJY_SALES_ORDERS_UI_TYPESCRIPT_SHA256: COMPILER_SHA,
} };
const harnessConsole = { ...console, log(value) { admission = JSON.parse(value); } };
const harnessFile = path.join(ROOT, ...HARNESS.split('/'));
// Prefix retains the original admission hashes, actualGuard(), compiler check,
// exact candidate reads and real TSX evaluation. Only its ten test calls are cut.
vm.runInThisContext('(function(require,module,exports,__filename,__dirname,process,console){\n' + harnessPrefix + '\nmodule.exports={rendererHarness,nodes,name,text,SALES,QUOTE,REQUEST,user,quote,compile};\n})', { filename: harnessFile })(createRequire(harnessFile), harnessModule, harnessModule.exports, harnessFile, path.dirname(harnessFile), harnessProcess, harnessConsole);
assert(admission && admission.actualContext, 'Original actual Guest admission must complete');
const { rendererHarness, nodes, name, SALES, QUOTE, REQUEST, user, quote, compile } = harnessModule.exports;
const test = require('node:test');
console.log(JSON.stringify({ purpose: 'strict-170-order-attempt-contracts', actualContext: admission.actualContext, testSha256: selfPin, harnessSha256: HARNESS_SHA, sourcePins: pins, compilerSha256: COMPILER_SHA, methods: 2, actualUiVerified: false, listenerStarted: false, dbOpened: false }));

// An HTTP rejection goes through the actual pinned bridge implementation. This
// deliberately does not invent an error.status that today's api() discards.
async function bridgeRejection(status, message) {
  const module = { exports: {} }, requests = [];
  vm.runInNewContext(compile(read(BRIDGE).toString('utf8'), BRIDGE), {
    module, exports: module.exports,
    require(imported) { throw Error('Unreviewed bridge import: ' + imported); },
    window: { jewelryDesktop: { async request(input) { requests.push(input); return { ok: false, status, data: { error: message } }; } }, dispatchEvent() {} },
    Error, CustomEvent: class CustomEvent {},
  }, { filename: BRIDGE });
  try { await module.exports.api('/api/sales-orders', 'POST', {}); }
  catch (problem) { assert.equal(requests.length, 1); assert.match(problem.message, new RegExp(message)); return problem; }
  throw Error('Actual bridge must reject the explicit HTTP failure');
}
async function issuingFixture(t) {
  let choices = 0;
  const h = rendererHarness(SALES, { user: user('operate'), users: [], sourceQuoteId: QUOTE, scopeKey: 'strict-170-fictional-order-attempt', revision: 0, onChooseQuote() { choices++; }, onOpenQuote() {}, onOpenWarranty() {} });
  t.after(() => h.dispose());
  const source = h.requests.findIndex(request => request.address === '/api/quotes/' + QUOTE);
  assert(source >= 0, 'The actual component must load the canonical quote');
  await h.respond(source, { quote: quote() });
  h.click(h.findButton(/^开单并送财务审核$/));
  await h.settle();
  const post = h.requests.findIndex(request => request.address === '/api/sales-orders' && request.method === 'POST');
  assert(post >= 0);
  assert.equal(h.requests[post].body.requestId, REQUEST);
  assert(h.writeOrder.indexOf('durable-request') < h.writeOrder.indexOf('api:POST'));
  return { h, post, choices: () => choices };
}
function storedAttempt(h) {
  const attempts = [...h.storage.entries()].filter(([key]) => key.startsWith('sales-order-attempt-v1:'));
  assert.equal(attempts.length, 1, 'The original unresolved request remains durable');
  return JSON.parse(attempts[0][1]);
}
async function notFoundQuery(h) {
  h.click(h.findButton(/^查询本次开单结果$/));
  await h.settle();
  const query = h.requests.findIndex(request => request.address === '/api/sales-orders/by-request/' + REQUEST && request.method === 'GET');
  assert(query >= 0, 'Recovery queries the exact original identity');
  await h.reject(query, await bridgeRejection(404, '该开单请求不存在'));
}

test('A01 explicit 409 then request 404 offers a safe server cancellation exit instead of locking all future orders', async t => {
  const { h, post, choices } = await issuingFixture(t);
  await h.reject(post, await bridgeRejection(409, '来源报价已有新版本'));
  await notFoundQuery(h);
  assert.equal(storedAttempt(h).input.requestId, REQUEST);
  assert.equal(h.findButton(/^选择报价开单$/).props.disabled, true, '404 alone cannot erase in-flight knowledge');
  const recovery = nodes(h.tree).find(node => node.type === 'button' && /(?:放弃|结束|取消).*请求/.test(name(node)) && !node.props.disabled);
  assert(recovery, 'FEATURE_REQUIRED: an explicit safe exit for a definitively rejected request; a permanent local lock is not recovery');
  const before = h.requests.length;
  h.click(recovery);
  await h.settle();
  const cancellation = h.requests.slice(before).find(request => request.method !== 'GET' && request.address !== '/api/sales-orders' && (request.address.includes(REQUEST) || request.body?.requestId === REQUEST));
  assert(cancellation, 'A safe exit must ask the host to persist cancellation for the original identity');
  assert.equal(storedAttempt(h).input.requestId, REQUEST, 'Keep the original request until the host confirms a durable tombstone');
  assert.equal(h.findButton(/^选择报价开单$/).props.disabled, true, 'A pending cancellation is not confirmation');
  assert.equal(choices(), 0);
  assert.equal(h.requests.filter(request => request.address === '/api/sales-orders' && request.method === 'POST').length, 1, 'No replacement order may be issued implicitly');
  // The host cancellation API and its confirmed tombstone response are not yet
  // agreed. A later backend contract must prove that a delayed old POST cannot
  // create another order after cancellation. This test does not fake that proof.
});

test('A02 network-uncertain result including a later 404 retains one durable request and retries only that identity', async t => {
  const { h, post, choices } = await issuingFixture(t);
  const original = JSON.stringify(h.requests[post].body);
  await h.reject(post, Error('虚构连接中断，主机受理结果未知'));
  await notFoundQuery(h);
  assert.equal(JSON.stringify(storedAttempt(h).input), original);
  assert.equal(h.findButton(/^选择报价开单$/).props.disabled, true);
  assert.equal(h.findButton(/^开单并送财务审核$/).props.disabled, true);
  assert.equal(choices(), 0);
  assert.equal(h.requests.filter(request => request.address === '/api/sales-orders' && request.method === 'POST').length, 1);
  const retry = h.findButton(/^使用原请求重试开单$/);
  // Invoke the actual handler twice before its render settles: busyRef must
  // prevent the second click, even before disabled reaches the DOM.
  retry.props.onClick(); retry.props.onClick(); h.flush();
  await h.settle();
  const posts = h.requests.filter(request => request.address === '/api/sales-orders' && request.method === 'POST');
  assert.equal(posts.length, 2, 'One explicit retry, no duplicate click or implicit new request');
  assert.equal(JSON.stringify(posts[1].body), original);
  assert.equal(storedAttempt(h).input.requestId, REQUEST);
});

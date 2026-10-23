'use strict';
// Guest-only real BrowserBridge bundle, verified by renderer-test-loader.
// Transport replies are a declared memory model. No product process or DB.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
if (process.platform !== 'win32' || ROOT.toLowerCase() !== 'c:\\xjy-work\\xjy-web-stage1') throw Error('Bridge epoch RED requires the actual fixed Windows Sandbox');
const guardFile = path.join(ROOT, 'stage1/guest-candidate-cdp.cjs');
if (crypto.createHash('sha256').update(fs.readFileSync(guardFile)).digest('hex') !== '59840b638d8797fb55241616cd0b8e4098075a76834a201b0e93c1a748f1bb32') throw Error('Actual Sandbox guard source changed');
require(guardFile).actualGuard();
const test = require('node:test'), assert = require('node:assert/strict');
const { installBrowserBridge } = require('../tests/renderer-test-loader.cjs').loadRenderer('browser-bridge');
const TOKEN = ['a', 'b', 'c', 'd'].map(value => value.repeat(64));
function bridgeFor(fetch) {
  return installBrowserBridge({ target: {}, fetch, location: { origin: 'http://127.0.0.1:29991', href: 'http://127.0.0.1:29991/browser/', assign() {} },
    navigator: {}, storage: { getItem: () => null, setItem() {}, removeItem() {} }, isSecureContext: true, File, Blob });
}
function reply(data, status = 200) { return Response.json(data, { status }); }
function microtaskBoundaryReply(onBoundary) {
  // Real bridge readJson/boundedBytes consumes this normal asynchronous reader.
  // Three microtasks after releaseLock put invalidation after session's inner
  // epoch check, before its outer await/execute continuation. No source rewrite,
  // private-state access, timer, arbitrary sleep or hook in production code.
  const bytes = new TextEncoder().encode(JSON.stringify({ needsSetup: false, authenticated: false, csrf: TOKEN[0] }));
  let read = false;
  return { ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), body: { getReader() { return {
    async read() { if (read) return { done: true }; read = true; return { done: false, value: bytes }; },
    async cancel() {}, releaseLock() { queueMicrotask(() => queueMicrotask(() => queueMicrotask(onBoundary))); },
  }; } } };
}

test('E1 an epoch change in the outer await session window cannot publish an obsolete auth/status result', async () => {
  const events = []; let bridge;
  bridge = bridgeFor(async url => { assert.equal(new URL(url).pathname, '/session'); return microtaskBoundaryReply(() => { events.push('invalidate'); bridge.destroySession(); }); });
  const result = await bridge.request({ path: '/auth/status' }); events.push('returned');
  assert.deepEqual(events, ['invalidate', 'returned']);
  assert.equal(result.ok, false, 'the outer auth/status continuation must check the epoch captured before awaiting session');
  assert.equal(result.data?.authenticated, undefined, 'stale anonymous state cannot overwrite the newer phase');
});

test('E2 an epoch change while acquiring CSRF cannot dispatch a protected write in the new epoch with obsolete state', async () => {
  const events = []; let bridge, protectedCalls = 0;
  bridge = bridgeFor(async (url, init) => {
    if (new URL(url).pathname === '/session') return microtaskBoundaryReply(() => { events.push('invalidate'); bridge.destroySession(); });
    protectedCalls++; events.push('protected-fetch'); return reply({ fixture: 'must-not-be-requested', tokenWasEmpty: !new Headers(init.headers).get('x-xjy-csrf') });
  });
  const result = await bridge.request({ path: '/api/presence/heartbeat', method: 'POST', body: {} });
  assert.equal(events[0], 'invalidate'); assert.equal(protectedCalls, 0, 'request must fail instead of capturing the new epoch only after await session');
  assert.equal(result.ok, false);
});

for (const failedStatus of [400, 429, 500]) test('E3 failed authenticated relogin ' + failedStatus + ' drops old cached CSRF and acquires anonymous retry state', async () => {
  let sessions = 0, logins = 0;
  const bridge = bridgeFor(async (url, init) => {
    const endpoint = new URL(url).pathname;
    if (endpoint === '/session') { sessions++; return reply({ needsSetup: false, authenticated: false, csrf: sessions === 1 ? TOKEN[0] : TOKEN[2] }); }
    assert.equal(endpoint, '/auth/login'); logins++;
    const token = new Headers(init.headers).get('x-xjy-csrf');
    if (logins === 1) { assert.equal(token, TOKEN[0]); return reply({ authenticated: true, user: { username: 'fictional-sales' }, csrf: TOKEN[1] }); }
    if (logins === 2) { assert.equal(token, TOKEN[1]); return reply({ error: 'synthetic rejected relogin' }, failedStatus); }
    if (token !== TOKEN[2]) return reply({ error: 'obsolete authority CSRF cannot authorize anonymous retry' }, 403);
    return reply({ authenticated: true, user: { username: 'fictional-sales' }, csrf: TOKEN[3] });
  });
  const input = { path: '/auth/login', method: 'POST', body: { username: 'fictional-sales', password: 'Fictitious-Only-2026!' } };
  assert.equal((await bridge.request(input)).ok, true);
  const rejected = await bridge.request(input); assert.equal(rejected.ok, false); assert.equal(rejected.status, failedStatus);
  const retry = await bridge.request(input); assert.equal(retry.ok, true, 'failed relogin revoked its old authority; retry must acquire the new bootstrap CSRF');
  assert.equal(sessions, 2); assert.equal(logins, 3);
});

test('E4 BrowserBridge rejects a login query alias before sending any authentication request', async () => {
  let authCalls = 0;
  const bridge = bridgeFor(async url => { if (new URL(url).pathname === '/session') return reply({ authenticated: false, needsSetup: false, csrf: TOKEN[0] }); authCalls++; return reply({ authenticated: true, user: { username: 'fictional-sales' }, csrf: TOKEN[1] }); });
  const result = await bridge.request({ path: '/auth/login?x=1', method: 'POST', body: { username: 'fictional-sales', password: 'Fictitious-Only-2026!' } });
  assert.equal(result.ok, false); assert.equal(authCalls, 0, 'authentication aliases must not bypass the exact gateway transition');
});

for (const fault of ['transport', 'parser']) test('E5 a sent authenticated relogin with ' + fault + ' failure discards its former CSRF before retry', async () => {
  let sessions = 0, logins = 0;
  const bridge = bridgeFor(async (url, init) => {
    if (new URL(url).pathname === '/session') { sessions++; return reply({ needsSetup: false, authenticated: false, csrf: sessions === 1 ? TOKEN[0] : TOKEN[2] }); }
    assert.equal(new URL(url).pathname, '/auth/login'); logins++;
    const token = new Headers(init.headers).get('x-xjy-csrf');
    if (logins === 1) { assert.equal(token, TOKEN[0]); return reply({ authenticated: true, user: { username: 'fictional-sales' }, csrf: TOKEN[1] }); }
    if (logins === 2) {
      assert.equal(token, TOKEN[1]);
      if (fault === 'transport') throw Error('synthetic connection lost after relogin was sent');
      return new Response('{invalid-synthetic-json', { status: 500, headers: { 'content-type': 'application/json' } });
    }
    if (token !== TOKEN[2]) return reply({ error: 'obsolete authority CSRF cannot authorize retry after uncertain relogin' }, 403);
    return reply({ authenticated: true, user: { username: 'fictional-sales' }, csrf: TOKEN[3] });
  });
  const input = { path: '/auth/login', method: 'POST', body: { username: 'fictional-sales', password: 'Fictitious-Only-2026!' } };
  assert.equal((await bridge.request(input)).ok, true);
  assert.equal((await bridge.request(input)).ok, false);
  assert.equal((await bridge.request(input)).ok, true, 'an uncertain sent login must reinitialize before retrying instead of retaining old authority CSRF');
  assert.equal(sessions, 2); assert.equal(logins, 3);
});

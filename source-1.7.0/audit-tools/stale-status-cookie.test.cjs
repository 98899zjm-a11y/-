'use strict';
// Actual HTTP gateway regression. No DB, Electron, real credentials or product
// entrypoint. The backend is an explicit in-memory session model; only real
// gateway cookie/session routing and delayed HTTP delivery are under test.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
if (process.platform !== 'win32' || ROOT.toLowerCase() !== 'c:\\xjy-work\\xjy-web-stage1') throw Error('Stale-cookie tests require the actual fixed Windows Sandbox');
const helperFile = path.join(ROOT, 'stage1/guest-candidate-cdp.cjs');
if (crypto.createHash('sha256').update(fs.readFileSync(helperFile)).digest('hex') !== '59840b638d8797fb55241616cd0b8e4098075a76834a201b0e93c1a748f1bb32') throw Error('Actual Sandbox guard changed');
require(helperFile).actualGuard();
const test = require('node:test'), assert = require('node:assert/strict'), http = require('node:http');
const { createGateway } = require('../stage1/web-gateway.cjs');
const AUTH = 'xjy_stage1', BOOT = 'xjy_stage1_bootstrap';
function deferred() { let resolve; const promise = new Promise(accept => { resolve = accept; }); return { promise, resolve }; }
const loginBody = { username: 'demo-sales-a', fixture: 'in-memory-cookie-boundary' };
class CookieJar {
  constructor(other) { this.values = new Map(other ? other.values : []); }
  header() { return [...this.values].map(([name, value]) => name + '=' + value).join('; '); }
  value(name) { return this.values.get(name); }
  apply(lines) {
    for (const line of lines) { const [pair, ...attributes] = line.split(';'), split = pair.indexOf('='); assert(split > 0); const name = pair.slice(0, split), value = pair.slice(split + 1); if (attributes.some(part => /^\s*Max-Age=0\s*$/i.test(part))) this.values.delete(name); else this.values.set(name, value); }
  }
}

function backendModel() {
  const calls = { created: 0, logins: 0, dataReads: 0 };
  const nativeUser = { id: 'fixture-native-admin', username: 'demo-admin', role: 'admin', active: true };
  return { calls, auth: { status: () => ({ needsSetup: false, authenticated: true, user: { ...nativeUser } }) },
    createSession() {
      calls.created++; let user = null;
      const auth = { status: () => ({ needsSetup: false, authenticated: Boolean(user), ...(user ? { user: { ...user } } : {}) }) };
      return { auth,
        async dispatch(input) {
          if (input.path === '/auth/status') return { ok: true, status: 200, data: auth.status() };
          if (input.path === '/auth/login' && input.method === 'POST') {
            calls.logins++;
            assert.deepEqual(input.body, loginBody);
            user = { id: 'fixture-employee', username: 'demo-sales-a', role: 'employee', active: true };
            return { ok: true, status: 200, data: auth.status() };
          }
          if (input.path === '/api/customers') {
            calls.dataReads++;
            return user ? { ok: true, status: 200, data: { owner: user.username, customers: ['synthetic-owned-row'] } } : { ok: false, status: 401, data: { error: 'not authenticated' } };
          }
          return { ok: false, status: 404, data: { error: 'unsupported fixture endpoint' } };
        },
        imageResponse: async () => new Response(null, { status: 404 }), close: async () => { user = null; },
      };
    },
  };
}

async function fixture(t, sessionLimit = 8) {
  const base = path.join(ROOT, 'runtime/stale-status-cookie-tests'); fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, 'owned-')); fs.mkdirSync(path.join(root, 'logs'));
  const backend = backendModel(), queued = new Map(); let gatewayHandler;
  const server = http.createServer((request, response) => {
    const gate = queued.get(request.headers['x-fixture-queued-request']);
    if (!gate) return gatewayHandler(request, response);
    gate.arrived.resolve();
    // This models an old-header request queued before login, delivered to the
    // real gateway after rotation, with its response arriving even later.
    gate.dispatch.promise.then(() => {
      const end = response.end.bind(response);
      response.end = (...args) => {
        gate.responseReady.resolve({ status: response.statusCode, setCookie: response.getHeader('set-cookie') || null });
        gate.deliver.promise.then(() => end(...args)); return response;
      };
      gatewayHandler(request, response);
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  assert.equal(server.address().address, '127.0.0.1'); assert.notEqual(server.address().port, 31831);
  const origin = 'http://127.0.0.1:' + server.address().port;
  // The real gateway receives genuine Node request/response objects. Only the
  // transport delivery timing is controlled, not gateway source or decisions.
  const gatewayServer = { address: () => server.address(), on(event, handler) { assert.equal(event, 'request'); gatewayHandler = handler; }, off(event, handler) { assert.equal(event, 'request'); assert.equal(handler, gatewayHandler); } };
  const gateway = createGateway({ backend, server: gatewayServer, root, sessionLimit, allowLocalControls: false });
  const pending = [];
  async function call(address, { cookie = '', jar, csrf = '', body, delay } = {}) {
    if (jar) cookie = jar.header();
    const response = await fetch(origin + address, { method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(7000), headers: { ...(cookie ? { cookie } : {}), ...(delay ? { 'x-fixture-queued-request': delay } : {}), ...(body === undefined ? {} : { origin, 'content-type': 'application/json', 'x-xjy-csrf': csrf }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    assert.equal(typeof response.headers.getSetCookie, 'function');
    const setCookie = response.headers.get('set-cookie'), cookies = response.headers.getSetCookie();
    if (jar) jar.apply(cookies);
    return { status: response.status, data: await response.json(), setCookie, cookies, cookie: cookies.length === 1 ? cookies[0].split(';')[0] : null };
  }
  function queue(id) { const gate = { arrived: deferred(), dispatch: deferred(), responseReady: deferred(), deliver: deferred() }; queued.set(id, gate); return gate; }
  async function initialized() {
    const jar = new CookieJar(), response = await call('/session', { jar }); assert.equal(response.status, 200);
    assert.match(response.cookie, /^xjy_stage1_bootstrap=[a-f0-9]{64}$/); assert.match(response.data.csrf, /^[a-f0-9]{64}$/);
    assert.equal(response.cookies.length, 1); assert.equal(jar.value(AUTH), undefined); assert.equal(response.data.authenticated, false); assert.equal(response.data.user, undefined);
    return { cookie: jar.header(), csrf: response.data.csrf, jar };
  }
  async function login(session) {
    const jar = new CookieJar(session.jar), response = await call('/auth/login', { ...session, jar, body: loginBody });
    assert.equal(response.status, 200); assert.equal(response.data.user.username, 'demo-sales-a');
    assert.notEqual(response.cookie, session.cookie); assert.notEqual(response.data.csrf, session.csrf);
    assert.equal(response.cookies.filter(line => line.startsWith(AUTH + '=')).length, 1);
    assert.equal(response.cookies.filter(line => line.startsWith(BOOT + '=')).length, 0);
    assert.equal(jar.value(AUTH) === session.jar.value(BOOT), false, 'authentication cannot alias the old bootstrap id');
    return { cookie: jar.header(), csrf: response.data.csrf, jar, cookies: response.cookies };
  }
  t.after(async () => { for (const gate of queued.values()) { gate.dispatch.resolve(); gate.deliver.resolve(); } await Promise.allSettled(pending); await gateway.close(); await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
  return { backend, call, queue, initialized, login, pending };
}

test('stale status after login rotation is explicitly anonymous and cannot set or allocate another cookie', { timeout: 15000 }, async t => {
  const f = await fixture(t), old = await f.initialized(), current = await f.login(old), count = f.backend.calls.created;
  const stale = await f.call('/auth/status', { cookie: old.cookie });
  assert.equal(stale.status, 200); assert.equal(stale.data.authenticated, false); assert.equal(stale.data.needsSetup, false);
  assert.equal(stale.data.user, undefined, 'no native or newly authenticated user may leak to the old token');
  assert.equal(stale.setCookie, null, 'a late read-only status response must not replace a successful login cookie');
  assert.equal(f.backend.calls.created, count, 'anonymous status cannot allocate an unauthenticated entry');
  assert.equal((await f.call('/auth/status', { cookie: current.cookie })).data.user.username, 'demo-sales-a');
  assert.equal(f.backend.auth.status().user.username, 'demo-admin');
});

test('unauthenticated status requests cannot exhaust the explicit browser session pool', { timeout: 15000 }, async t => {
  const f = await fixture(t, 2);
  for (let i = 0; i < 6; i++) {
    const response = await f.call('/auth/status');
    assert.equal(response.status, 200); assert.equal(response.data.authenticated, false); assert.equal(response.data.user, undefined); assert.equal(response.setCookie, null);
  }
  assert.equal(f.backend.calls.created, 0);
  await f.initialized(); await f.initialized();
  assert.equal((await f.call('/session')).status, 429, 'explicit bootstrap must still enforce its unchanged session limit');
});

test('old tokens remain denied data access and cannot alias the new authenticated or native identity', { timeout: 15000 }, async t => {
  const f = await fixture(t), old = await f.initialized(), current = await f.login(old);
  const created = f.backend.calls.created, reads = f.backend.calls.dataReads;
  const rejected = await f.call('/api/customers', { cookie: old.cookie });
  assert.equal(rejected.status, 401); assert.equal(rejected.data.customers, undefined); assert.equal(rejected.data.user, undefined);
  assert.equal(rejected.setCookie, null); assert.equal(f.backend.calls.created, created); assert.equal(f.backend.calls.dataReads, reads, 'rejected old data token must not reach the business backend');
  const allowed = await f.call('/api/customers', { cookie: current.cookie });
  assert.equal(allowed.status, 200); assert.equal(allowed.data.owner, 'demo-sales-a');
  assert.equal(f.backend.auth.status().user.username, 'demo-admin');
  // Explicit reinitialization writes only the independent bootstrap cookie.
  // Applying that late header to a logged-in jar cannot overwrite authority.
  const bootstrap = await f.call('/session', { cookie: old.cookie });
  assert.equal(bootstrap.status, 200); assert.equal(bootstrap.data.authenticated, false); assert.equal(bootstrap.data.user, undefined);
  assert.notEqual(bootstrap.cookie, current.cookie, 'no stale-token alias to the authenticated session');
  assert.match(bootstrap.cookie, /^xjy_stage1_bootstrap=[a-f0-9]{64}$/);
  assert.equal(bootstrap.cookies.filter(line => line.startsWith(AUTH + '=')).length, 0);
  const authority = current.jar.value(AUTH); current.jar.apply(bootstrap.cookies);
  assert.equal(current.jar.value(AUTH) === authority, true);
  assert.equal((await f.call('/api/customers', { jar: current.jar })).data.owner, 'demo-sales-a');
});

test('a truly queued old-cookie status response cannot overwrite the real HTTP login response in a browser cookie jar', { timeout: 15000 }, async t => {
  const f = await fixture(t), old = await f.initialized(), gate = f.queue('old-status'), jar = new CookieJar(old.jar);
  const delayed = f.call('/auth/status', { cookie: old.cookie, delay: 'old-status' }).then(response => { jar.apply(response.cookies); return response; });
  f.pending.push(delayed); await gate.arrived.promise;
  const current = await f.login(old); jar.apply(current.cookies);
  gate.dispatch.resolve(); await gate.responseReady.promise;
  assert.equal((await f.call('/auth/status', { cookie: current.cookie })).data.user.username, 'demo-sales-a');
  gate.deliver.resolve(); const stale = await delayed;
  assert.equal(stale.data.authenticated, false); assert.equal(stale.data.user, undefined); assert.equal(stale.setCookie, null);
  assert.equal(jar.value(AUTH) === current.jar.value(AUTH), true, 'later anonymous status Set-Cookie must not replace the authenticated cookie');
  assert.equal(jar.header() === current.cookie, true);
  assert.equal((await f.call('/api/customers', { jar })).status, 200);
});

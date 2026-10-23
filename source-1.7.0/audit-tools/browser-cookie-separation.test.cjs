'use strict';
// TEMPORARY HTTP CONTRACT, awaiting Root/security-reviewer approval.
// Real gateway + HTTP + multi-cookie jar + current BrowserBridge bundle.
// Backend accounts are a declared memory model: no DB, product entry, Electron,
// real passwords or pyc. Delays affect transport/model awaits, not gateway code.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
if (process.platform !== 'win32' || ROOT.toLowerCase() !== 'c:\\xjy-work\\xjy-web-stage1') throw Error('Cookie separation RED requires the actual fixed Windows Sandbox');
const guardFile = path.join(ROOT, 'stage1/guest-candidate-cdp.cjs');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
if (hash(fs.readFileSync(guardFile)) !== '59840b638d8797fb55241616cd0b8e4098075a76834a201b0e93c1a748f1bb32') throw Error('Actual Sandbox guard source changed');
require(guardFile).actualGuard();
const test = require('node:test'), assert = require('node:assert/strict'), http = require('node:http');
const { createGateway } = require('../stage1/web-gateway.cjs');
const AUTH = 'xjy_stage1', BOOT = 'xjy_stage1_bootstrap';
function deferred() { let resolve; const promise = new Promise(accept => { resolve = accept; }); return { promise, resolve }; }
const same = (actual, expected, message) => assert.equal(actual === expected, true, message);
const loginInput = username => ({ username, fixture: 'cookie-contract-only' });

class CookieJar {
  constructor(other) { this.values = new Map(other ? other.values : []); }
  header() { return [...this.values].map(([name, value]) => name + '=' + value).join('; '); }
  value(name) { return this.values.get(name); }
  apply(lines) {
    for (const line of lines) {
      const [pair, ...attributes] = line.split(';'), split = pair.indexOf('=');
      assert(split > 0, 'well-formed synthetic Set-Cookie required');
      const name = pair.slice(0, split).trim(), value = pair.slice(split + 1);
      if (attributes.some(attribute => /^\s*max-age\s*=\s*0\s*$/i.test(attribute))) this.values.delete(name);
      else this.values.set(name, value);
    }
  }
}
const writes = (response, name) => response.cookies.filter(line => line.startsWith(name + '='));
const noAuthWrite = (response, label) => assert.equal(writes(response, AUTH).length, 0, label || 'only successful login may write the authenticated cookie');

function model() {
  const calls = { created: 0, logins: [], closed: 0 }, sessions = new Set();
  const behavior = { beforeAuth: null, afterAuth: null };
  const native = { id: 'native-admin', username: 'demo-admin', role: 'admin', active: true };
  return { calls, behavior, auth: { status: () => ({ needsSetup: false, authenticated: true, user: { ...native } }) },
    createSession() {
      calls.created++; let user = null, closed = false;
      const instance = { auth: { status: () => ({ needsSetup: false, authenticated: Boolean(user), ...(user ? { user: { ...user } } : {}) }) },
        async dispatch(input) {
          if (input.path === '/auth/status') return { ok: true, status: 200, data: instance.auth.status() };
          if (input.path === '/auth/login' && input.method === 'POST') {
            calls.logins.push(input.body?.username);
            const before = behavior.beforeAuth; behavior.beforeAuth = null;
            if (before) { before.entered.resolve(); await before.release.promise; }
            if (input.body?.fixture !== 'cookie-contract-only' || !['demo-sales-a', 'demo-sales-b'].includes(input.body?.username)) return { ok: false, status: 401, data: { error: 'synthetic account rejected' } };
            user = { id: 'id-' + input.body.username, username: input.body.username, role: 'employee', active: true };
            const after = behavior.afterAuth; behavior.afterAuth = null;
            if (after) { after.entered.resolve(); await after.release.promise; }
            return { ok: true, status: 200, data: instance.auth.status() };
          }
          if (input.path === '/auth/logout') { user = null; return { ok: true, status: 200, data: instance.auth.status() }; }
          if (input.path === '/api/customers' || input.path === '/api/presence/heartbeat') return user ? { ok: true, status: 200, data: { owner: user.username, customers: ['synthetic-row'] } } : { ok: false, status: 401, data: { error: 'not authenticated' } };
          return { ok: false, status: 404, data: { error: 'unexpected fixture endpoint' } };
        },
        imageResponse: async () => new Response(null, { status: 401 }),
        async close() { if (!closed) { closed = true; calls.closed++; sessions.delete(instance); } user = null; },
      };
      sessions.add(instance); return instance;
    },
  };
}

async function fixture(t, options = {}) {
  const base = path.join(ROOT, 'runtime/browser-cookie-separation-tests'); fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, 'owned-')); fs.mkdirSync(path.join(root, 'logs'));
  const backend = model(), gates = new Map(), pending = [], released = []; let handler, clock = 0;
  const server = http.createServer((request, response) => {
    const gate = gates.get(request.headers['x-cookie-contract-gate']);
    const dispatch = () => {
      if (gate) {
        const end = response.end.bind(response);
        response.end = (...args) => {
          gate.responseReady.resolve();
          gate.deliver.promise.then(() => end(...args)); return response;
        };
      }
      handler(request, response);
    };
    if (gate) { gate.arrived.resolve(); gate.dispatch.promise.then(dispatch); } else dispatch();
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  assert.equal(server.address().address, '127.0.0.1'); assert.notEqual(server.address().port, 31831);
  const origin = 'http://127.0.0.1:' + server.address().port;
  const facade = { address: () => server.address(), on(event, callback) { assert.equal(event, 'request'); handler = callback; }, off(event, callback) { assert.equal(event, 'request'); assert.equal(callback, handler); } };
  const gateway = createGateway({ backend, server: facade, root, clock: () => clock, sessionLimit: options.limit || 8, sessionTtlMs: options.ttl || 1000, allowLocalControls: false });
  function transportGate(id, responseOnly = false) {
    const gate = { arrived: deferred(), dispatch: deferred(), responseReady: deferred(), deliver: deferred() };
    gates.set(id, gate); if (responseOnly) gate.dispatch.resolve(); return gate;
  }
  function authGate(where) {
    const gate = { entered: deferred(), release: deferred() }; backend.behavior[where] = gate; released.push(() => gate.release.resolve()); return gate;
  }
  async function wire(jar, address, init = {}, gateId) {
    const method = init.method || 'GET', headers = new Headers(init.headers);
    if (jar.header()) headers.set('cookie', jar.header());
    if (method !== 'GET') headers.set('origin', origin);
    if (gateId) headers.set('x-cookie-contract-gate', gateId);
    const response = await fetch(origin + address, { ...init, method, headers, redirect: 'error', signal: AbortSignal.timeout(8000) });
    assert.equal(typeof response.headers.getSetCookie, 'function', 'Node multi-cookie header support required');
    const cookies = response.headers.getSetCookie(); jar.apply(cookies);
    return { response, cookies };
  }
  async function call(jar, address, options2 = {}) {
    const { body, csrf, gate: gateId } = options2;
    const result = await wire(jar, address, { method: body === undefined ? 'GET' : 'POST', ...(body === undefined ? {} : { headers: { 'content-type': 'application/json', 'x-xjy-csrf': csrf || '' }, body: JSON.stringify(body) }) }, gateId);
    return { status: result.response.status, data: await result.response.json(), cookies: result.cookies };
  }
  async function bootstrap(jar) {
    const response = await call(jar, '/session'); assert.equal(response.status, 200); assert.match(response.data.csrf, /^[a-f0-9]{64}$/);
    return { response, csrf: response.data.csrf, oldHeader: jar.header() };
  }
  async function login(jar, csrf, username = 'demo-sales-a') {
    const response = await call(jar, '/auth/login', { csrf, body: loginInput(username) });
    assert.equal(response.status, 200); assert.equal(response.data.authenticated, true); assert.equal(response.data.user.username, username);
    assert.match(jar.value(AUTH), /^[a-f0-9]{64}$/); assert.match(response.data.csrf, /^[a-f0-9]{64}$/); return response;
  }
  function remember(promise) { pending.push(promise); promise.catch(() => {}); return promise; }
  t.after(async () => { for (const release of released) release(); for (const gate of gates.values()) { gate.dispatch.resolve(); gate.deliver.resolve(); } await Promise.allSettled(pending); await gateway.close(); await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
  return { backend, origin, gateway, call, wire, bootstrap, login, transportGate, authGate, remember, setClock: value => { clock = value; } };
}

test('C1 temporary contract: anonymous initialization sets bootstrap only, and protected reads allocate nothing', { timeout: 20000 }, async t => {
  const f = await fixture(t), anonymous = new CookieJar(), before = f.backend.calls.created;
  const denied = await f.call(anonymous, '/api/customers'); assert.equal(denied.status, 401); noAuthWrite(denied); assert.equal(denied.cookies.length, 0); assert.equal(f.backend.calls.created, before);
  const boot = await f.bootstrap(anonymous);
  assert.match(anonymous.value(BOOT), /^[a-f0-9]{64}$/); assert.equal(anonymous.value(AUTH), undefined); noAuthWrite(boot.response);
  assert.equal(boot.response.data.authenticated, false); assert.equal(boot.response.data.user, undefined);
});

test('C1 a queued old /session response arriving after login can modify bootstrap but cannot overwrite auth in the real jar', { timeout: 20000 }, async t => {
  const f = await fixture(t), jar = new CookieJar(), boot = await f.bootstrap(jar), old = new CookieJar(jar), gate = f.transportGate('late-bootstrap');
  const delayed = f.remember(f.call(old, '/session', { gate: 'late-bootstrap' })); await gate.arrived.promise;
  const logged = await f.login(jar, boot.csrf), authority = jar.value(AUTH);
  gate.dispatch.resolve(); await gate.responseReady.promise; gate.deliver.resolve(); const late = await delayed;
  jar.apply(late.cookies);
  noAuthWrite(late, 'late anonymous /session must never write the authority cookie');
  same(jar.value(AUTH), authority, 'late bootstrap changed authority cookie'); assert.equal(late.data.authenticated, false); assert.equal(late.data.user, undefined);
  assert.equal((await f.call(jar, '/api/customers')).data.owner, 'demo-sales-a');
  const status = await f.call(jar, '/session'); same(status.data.csrf, logged.data.csrf, 'valid auth must take priority over the replacement bootstrap'); noAuthWrite(status);
});

test('C2 valid auth wins over foreign bootstrap; old ids and stale/cross-session CSRF remain denied', { timeout: 20000 }, async t => {
  const f = await fixture(t), a = new CookieJar(), b = new CookieJar(), bootA = await f.bootstrap(a), bootB = await f.bootstrap(b), oldA = new CookieJar(a);
  const logged = await f.login(a, bootA.csrf), mixed = new CookieJar(a);
  if (b.value(BOOT)) mixed.values.set(BOOT, b.value(BOOT));
  const status = await f.call(mixed, '/session'); assert.equal(status.data.user.username, 'demo-sales-a'); same(status.data.csrf, logged.data.csrf, 'foreign bootstrap must not select another CSRF'); noAuthWrite(status);
  for (const csrf of [bootA.csrf, bootB.csrf]) assert.equal((await f.call(mixed, '/api/presence/heartbeat', { csrf, body: {} })).status, 403);
  const forbidden = await f.call(oldA, '/api/customers'); assert.equal(forbidden.status, 401); noAuthWrite(forbidden); assert.equal(forbidden.data.customers, undefined);
  assert.equal((await f.call(b, '/auth/status')).data.authenticated, false); assert.equal(f.backend.auth.status().user.username, 'demo-admin');
});

test('C3 verified login cannot expose its user through the original anonymous entry before publication', { timeout: 20000 }, async t => {
  const f = await fixture(t), jar = new CookieJar(), boot = await f.bootstrap(jar), old = new CookieJar(jar), held = f.authGate('afterAuth');
  const loggingIn = f.remember(f.login(jar, boot.csrf)); await held.entered.promise;
  const status = await f.call(old, '/auth/status'); assert.equal(status.data.authenticated, false); assert.equal(status.data.user, undefined); noAuthWrite(status);
  const data = await f.call(old, '/api/customers'); assert.equal(data.status, 401); assert.equal(data.data.customers, undefined);
  held.release.resolve(); await loggingIn;
});

test('C3 two tabs sharing bootstrap cannot publish two overlapping logins or change native identity', { timeout: 20000 }, async t => {
  const f = await fixture(t), jar = new CookieJar(), boot = await f.bootstrap(jar), firstTab = new CookieJar(jar), secondTab = new CookieJar(jar), held = f.authGate('beforeAuth');
  const first = f.remember(f.login(firstTab, boot.csrf)); await held.entered.promise;
  const second = await f.call(secondTab, '/auth/login', { csrf: boot.csrf, body: loginInput('demo-sales-b') });
  assert([403, 409].includes(second.status), 'temporary contract: overlapping login must be refused before another verification/publication'); noAuthWrite(second);
  assert.equal(f.backend.calls.logins.length, 1, 'overlap reached the auth backend twice');
  held.release.resolve(); const completed = await first; jar.apply(completed.cookies);
  assert.equal((await f.call(jar, '/auth/status')).data.user.username, 'demo-sales-a'); assert.equal(f.backend.auth.status().user.username, 'demo-admin');
});

test('C4 current BrowserBridge rejects late anonymous session body after successful login epoch', { timeout: 20000 }, async t => {
  const f = await fixture(t), jar = new CookieJar();
  const { installBrowserBridge } = require('../tests/renderer-test-loader.cjs').loadRenderer('browser-bridge');
  let sessionRequests = 0; const late = f.transportGate('bridge-old-session', true);
  const bridge = installBrowserBridge({ target: {}, location: { origin: f.origin, href: f.origin + '/browser/', assign() {} }, navigator: {}, storage: { getItem: () => null, setItem() {}, removeItem() {} }, isSecureContext: true, File, Blob,
    fetch: async (url, init) => { const pathname = new URL(url).pathname; const gate = pathname === '/session' && ++sessionRequests === 2 ? 'bridge-old-session' : undefined; return (await f.wire(jar, pathname, init, gate)).response; },
  });
  assert.equal((await bridge.request({ path: '/auth/status' })).ok, true);
  const oldRead = f.remember(bridge.request({ path: '/auth/status' })); await late.responseReady.promise;
  const logged = await bridge.request({ path: '/auth/login', method: 'POST', body: loginInput('demo-sales-a') }); assert.equal(logged.ok, true);
  const authority = jar.value(AUTH); late.deliver.resolve(); assert.equal((await oldRead).ok, false, 'late pre-login status body must not be accepted in the new epoch');
  same(jar.value(AUTH), authority, 'late response changed auth cookie');
  const result = await bridge.request({ path: '/api/presence/heartbeat', method: 'POST', body: {} }); assert.equal(result.ok, true); assert.equal(result.data.owner, 'demo-sales-a');
});

test('C5 a delayed old logout response cannot clear a subsequent successful login cookie', { timeout: 20000 }, async t => {
  const f = await fixture(t), jar = new CookieJar(), boot = await f.bootstrap(jar), firstLogin = await f.login(jar, boot.csrf), old = new CookieJar(jar), gate = f.transportGate('late-logout', true);
  const loggingOut = f.remember(f.call(old, '/auth/logout', { csrf: firstLogin.data.csrf, body: {}, gate: 'late-logout' })); await gate.responseReady.promise;
  const nextBoot = await f.bootstrap(jar); await f.login(jar, nextBoot.csrf, 'demo-sales-b'); const currentAuth = jar.value(AUTH);
  gate.deliver.resolve(); const late = await loggingOut; jar.apply(late.cookies);
  noAuthWrite(late, 'late logout must revoke its server entry without deleting the new login cookie'); same(jar.value(AUTH), currentAuth, 'late logout erased the new authority cookie');
  assert.equal((await f.call(jar, '/auth/status')).data.user.username, 'demo-sales-b'); assert.equal((await f.call(old, '/api/customers')).status, 401);
});

test('C6 expiry and combined quota do not revive ids, allocate on protected reads, or block an existing bootstrap promotion', { timeout: 20000 }, async t => {
  const f = await fixture(t, { limit: 2, ttl: 100 }), a = new CookieJar(), b = new CookieJar(), fresh = new CookieJar();
  const bootA = await f.bootstrap(a); await f.bootstrap(b); const count = f.backend.calls.created;
  const rejected = await f.call(fresh, '/api/customers'); assert.equal(rejected.status, 401); assert.equal(rejected.cookies.length, 0); assert.equal(f.backend.calls.created, count);
  assert.equal((await f.call(fresh, '/session')).status, 429);
  const logged = await f.login(a, bootA.csrf); f.setClock(90); assert.equal((await f.call(a, '/auth/status')).data.user.username, 'demo-sales-a');
  f.setClock(101); assert.equal((await f.call(fresh, '/session')).status, 200, 'expired anonymous slot must be reclaimed');
  f.setClock(191); const expired = await f.call(a, '/api/customers'); assert.equal(expired.status, 401); noAuthWrite(expired); assert.equal(expired.data.customers, undefined);
  const staleWrite = await f.call(a, '/api/presence/heartbeat', { csrf: logged.data.csrf, body: {} }); assert([401, 403].includes(staleWrite.status)); noAuthWrite(staleWrite);
  assert.equal(f.backend.auth.status().user.username, 'demo-admin');
});

test('C6 rejected login creates no auth cookie and freeze failures preserve separate browser/native authority', { timeout: 20000 }, async t => {
  const f = await fixture(t), jar = new CookieJar(), boot = await f.bootstrap(jar);
  const rejected = await f.call(jar, '/auth/login', { csrf: boot.csrf, body: { username: 'rejected', fixture: 'cookie-contract-only' } }); assert.equal(rejected.status, 401); noAuthWrite(rejected); assert.equal((await f.call(jar, '/auth/status')).data.authenticated, false);
  const logged = await f.login(jar, boot.csrf), authority = jar.value(AUTH), release = deferred(), entered = deferred();
  const freezing = f.remember(f.gateway.withFrozen(async () => { entered.resolve(); await release.promise; throw Error('synthetic freeze fault'); })); await entered.promise;
  try { const busy = await f.call(jar, '/auth/status'); assert.equal(busy.status, 503); noAuthWrite(busy); }
  finally { release.resolve(); }
  await assert.rejects(freezing, /synthetic freeze fault/); same(jar.value(AUTH), authority, 'failed freeze modified authority cookie');
  assert.equal((await f.call(jar, '/auth/status')).data.user.username, 'demo-sales-a');
  assert.equal((await f.call(jar, '/api/presence/heartbeat', { csrf: logged.data.csrf, body: {} })).status, 200);
  assert.equal(f.backend.auth.status().user.username, 'demo-admin');
});

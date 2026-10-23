'use strict';
// Actual gateway/HTTP in the fixed Guest. Only synthetic in-memory auth is
// injected; close gates model the real backend.close await-queue boundary.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
if (process.platform !== 'win32' || ROOT.toLowerCase() !== 'c:\\xjy-work\\xjy-web-stage1') throw Error('Gateway budget RED requires the actual fixed Windows Sandbox');
const guardFile = path.join(ROOT, 'stage1/guest-candidate-cdp.cjs');
if (crypto.createHash('sha256').update(fs.readFileSync(guardFile)).digest('hex') !== '59840b638d8797fb55241616cd0b8e4098075a76834a201b0e93c1a748f1bb32') throw Error('Actual Sandbox guard source changed');
require(guardFile).actualGuard();
const test = require('node:test'), assert = require('node:assert/strict'), http = require('node:http');
const { createGateway } = require('../stage1/web-gateway.cjs');
const AUTH = 'xjy_stage1', BOOT = 'xjy_stage1_bootstrap';
function deferred() { let resolve, reject; const promise = new Promise((accept, deny) => { resolve = accept; reject = deny; }); promise.catch(() => {}); return { promise, resolve, reject }; }
class Jar {
  constructor(other) { this.values = new Map(other ? other.values : []); }
  header() { return [...this.values].map(([key, value]) => key + '=' + value).join('; '); }
  apply(lines) { for (const line of lines) { const [pair] = line.split(';'), split = pair.indexOf('='); if (/;\s*Max-Age=0(?:;|$)/i.test(line)) this.values.delete(pair.slice(0, split)); else this.values.set(pair.slice(0, split), pair.slice(split + 1)); } }
}
async function fixture(t) {
  const base = path.join(ROOT, 'runtime/gateway-session-budget-tests'); fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, 'owned-')); fs.mkdirSync(path.join(root, 'logs'));
  const created = [], loginCalls = [], gates = [], pending = []; let clock = 0, closed = 0;
  const native = { username: 'fictional-native-admin', role: 'admin' };
  const backend = { auth: { status: () => ({ needsSetup: false, authenticated: true, user: native }) },
    createSession(options) {
      const index = created.length + 1; let user = null, closing;
      const instance = { auth: { status: () => ({ needsSetup: false, authenticated: Boolean(user), ...(user ? { user } : {}) }) },
        async dispatch(input) {
          if (input.path === '/auth/login') { loginCalls.push({ index, username: input.body?.username }); user = null; if (input.body?.username !== 'fictional-sales') return { status: 401, ok: false, data: { error: 'synthetic rejected account' } }; user = { username: 'fictional-sales', id: 'fixture-sales', role: 'employee' }; return { status: 200, ok: true, data: instance.auth.status() }; }
          if (input.path === '/api/customers') return user ? { status: 200, ok: true, data: { owner: user.username } } : { status: 401, ok: false, data: { error: 'anonymous' } };
          return { status: 404, ok: false, data: { error: 'unexpected fixture route' } };
        },
        close() {
          if (!closing) { user = null; const gate = gates.find(item => item.index === index && !item.used); if (gate) { gate.used = true; gate.entered.resolve(); closing = gate.release.promise.then(() => { closed++; }); } else { closed++; closing = Promise.resolve(); } }
          return closing;
        },
      }; created.push({ index, options, instance }); return instance;
    },
  };
  const server = http.createServer(); await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  assert.equal(server.address().address, '127.0.0.1'); assert.notEqual(server.address().port, 31831);
  const origin = 'http://127.0.0.1:' + server.address().port;
  const gateway = createGateway({ backend, server, root, clock: () => clock, sessionLimit: 1, sessionTtlMs: 100, allowLocalControls: false });
  function holdClose(index) { const gate = { index, entered: deferred(), release: deferred(), used: false }; gates.push(gate); return gate; }
  function remember(promise) { pending.push(promise); promise.catch(() => {}); return promise; }
  async function call(jar, address, options = {}) {
    const method = options.body === undefined ? 'GET' : 'POST', headers = { cookie: jar.header() };
    if (method === 'POST') Object.assign(headers, { origin, 'content-type': 'application/json', 'x-xjy-csrf': options.csrf || '' });
    const response = await fetch(origin + address, { method, headers, ...(method === 'POST' ? { body: JSON.stringify(options.body) } : {}), redirect: 'error', signal: AbortSignal.timeout(8000) });
    const cookies = response.headers.getSetCookie(); jar.apply(cookies); return { status: response.status, data: await response.json(), cookies };
  }
  async function bootstrap(jar) { const result = await call(jar, '/session'); assert.equal(result.status, 200); return result; }
  const login = (jar, csrf, username = 'fictional-sales') => call(jar, '/auth/login', { csrf, body: { username, fixture: 'in-memory-only' } });
  t.after(async () => { for (const gate of gates) gate.release.resolve(); await Promise.allSettled(pending); await Promise.allSettled([gateway.close()]); await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
  return { backend, gateway, created, loginCalls, call, bootstrap, login, holdClose, remember, setClock: value => { clock = value; }, closed: () => closed };
}

test('B1 a logged-out backend whose close is pending keeps its one capacity slot until it actually closes', { timeout: 20000 }, async t => {
  const f = await fixture(t), jar = new Jar(), boot = await f.bootstrap(jar), gate = f.holdClose(1);
  const logout = f.remember(f.call(jar, '/auth/logout', { csrf: boot.data.csrf, body: {} })); await gate.entered.promise;
  const during = await f.call(new Jar(), '/session'); assert.equal(during.status, 429); assert.equal(during.cookies.length, 0); assert.equal(f.created.length, 1, 'pending close must remain in the resource budget');
  gate.release.resolve(); assert.equal((await logout).status, 200);
  assert.equal((await f.bootstrap(new Jar())).status, 200); assert.equal(f.created.length, 2);
});

test('B2 concurrent expired-session reclamation cannot free a capacity slot before its close gate resolves', { timeout: 20000 }, async t => {
  const f = await fixture(t), jar = new Jar(); await f.bootstrap(jar); const gate = f.holdClose(1); f.setClock(101);
  const reclaiming = f.remember(f.call(new Jar(), '/session')); await gate.entered.promise;
  const racing = await f.call(new Jar(), '/session'); assert.equal(racing.status, 429); assert.equal(f.created.length, 1);
  gate.release.resolve(); assert.equal((await reclaiming).status, 200); assert.equal(f.created.length, 2);
});

test('B3 a rejected backend close cannot silently release its capacity and admit unlimited replacement sessions', { timeout: 20000 }, async t => {
  const f = await fixture(t), jar = new Jar(), boot = await f.bootstrap(jar), gate = f.holdClose(1);
  const logout = f.remember(f.call(jar, '/auth/logout', { csrf: boot.data.csrf, body: {} })); await gate.entered.promise; gate.release.reject(Error('synthetic close rejected'));
  assert.equal((await logout).status, 500);
  for (let i = 0; i < 5; i++) { const response = await f.call(new Jar(), '/session'); assert([429, 503].includes(response.status), 'failed cleanup must retain a bounded slot or fail-stop admission'); assert.equal(response.cookies.length, 0); }
  assert.equal(f.created.length, 1); assert.equal(f.backend.auth.status().user.username, 'fictional-native-admin');
});

test('B4 a failed provisional close blocks further verification instead of creating another unclosed temporary on every retry', { timeout: 20000 }, async t => {
  const f = await fixture(t), jar = new Jar(), boot = await f.bootstrap(jar), gate = f.holdClose(2);
  const rejected = f.remember(f.login(jar, boot.data.csrf, 'synthetic-missing')); await gate.entered.promise; gate.release.reject(Error('synthetic provisional close rejected'));
  assert.equal((await rejected).status, 401);
  const next = await f.login(jar, boot.data.csrf, 'synthetic-missing-again'); assert([429, 503].includes(next.status), 'a failed temporary cleanup must stop new verification allocation');
  assert.equal(f.created.length, 2); assert.equal(f.loginCalls.length, 1);
});

test('B5 an existing full-pool bootstrap can still promote after its own close, without a competing request stealing its reserved slot', { timeout: 20000 }, async t => {
  const f = await fixture(t), jar = new Jar(), boot = await f.bootstrap(jar), gate = f.holdClose(1);
  const loggingIn = f.remember(f.login(jar, boot.data.csrf)); await gate.entered.promise;
  assert.equal((await f.call(new Jar(), '/session')).status, 429); assert.equal(f.created.length, 2);
  gate.release.resolve(); const logged = await loggingIn; assert.equal(logged.status, 200); assert.equal(logged.data.user.username, 'fictional-sales');
  assert.equal((await f.call(jar, '/api/customers')).status, 200); assert.equal(f.created.length, 2);
});

test('B6 freeze after an accepted relogin revokes old A, drains its flight, and publishes only same-scope retry B', { timeout: 20000 }, async t => {
  const f = await fixture(t), jar = new Jar(), boot = await f.bootstrap(jar), logged = await f.login(jar, boot.data.csrf); assert.equal(logged.status, 200);
  const old = new Jar(jar), authority = jar.values.get(AUTH), scope = f.created[1].options.loginScopeId, gate = f.holdClose(2);
  const relogin = f.remember(f.login(jar, logged.data.csrf)); await gate.entered.promise;
  const action = deferred(), releaseAction = deferred(); let actionStarted = false;
  const freezing = f.remember(f.gateway.withFrozen(async () => { actionStarted = true; action.resolve(); await releaseAction.promise; throw Error('synthetic freeze action failure'); }));
  try {
    assert.equal((await f.call(old, '/auth/status')).status, 503); assert.equal(actionStarted, false, 'consistent snapshot action must wait for the accepted relogin flight');
    gate.release.resolve(); const rejected = await relogin; assert.equal(rejected.status, 503); assert.equal(rejected.cookies.filter(value => value.startsWith(AUTH + '=')).length, 0);
    assert.equal(rejected.cookies.filter(value => value.startsWith(BOOT + '=')).length, 1); assert.notEqual(jar.values.get(BOOT), old.values.get(BOOT));
    await action.promise; assert.equal(f.loginCalls.length, 1, 'maintenance gate must prevent dispatch/publication of a provisional authenticated T');
    assert.equal(f.created.length, 3); assert.equal(f.created[2].options.loginScopeId, scope); assert.equal(f.created[1].instance.auth.status().authenticated, false);
  } finally { gate.release.resolve(); releaseAction.resolve(); }
  await assert.rejects(freezing, /synthetic freeze action failure/);
  assert.equal((await f.call(old, '/auth/status')).data.authenticated, false); assert.equal(jar.values.get(AUTH), authority, 'failed relogin must not rewrite the stale auth cookie');
  const retry = await f.bootstrap(jar); assert.equal(retry.data.authenticated, false); assert.equal((await f.login(jar, retry.data.csrf)).status, 200);
  assert.equal(f.created.at(-1).options.loginScopeId, scope); assert.equal(f.backend.auth.status().user.username, 'fictional-native-admin');
});

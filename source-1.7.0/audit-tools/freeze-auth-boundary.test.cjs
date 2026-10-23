'use strict';
// Guest-only characterization of the existing daily -> host/network/gateway
// freeze boundary. Snapshot work, SQL/backend auth and hardware are explicit
// test doubles. This does NOT test SQLite, real passwords, archive encryption,
// attachment integrity, restore, Electron UI or unknown pyc algorithms.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
if (process.platform !== 'win32' || ROOT.toLowerCase() !== 'c:\\xjy-work\\xjy-web-stage1') throw Error('Freeze/auth behavior tests require the actual fixed Windows Sandbox');
const guardFile = path.join(ROOT, 'stage1/guest-candidate-cdp.cjs');
if (crypto.createHash('sha256').update(fs.readFileSync(guardFile)).digest('hex') !== '59840b638d8797fb55241616cd0b8e4098075a76834a201b0e93c1a748f1bb32') throw Error('Actual Sandbox admission helper changed');
require(guardFile).actualGuard();
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createDesktopHostRuntime } = require('../project/desktop/desktop-host-runtime.cjs');
const { createNetworkWorkspace } = require('../project/desktop/network-workspace.cjs');
const { createBusinessDailyBackups } = require('../project/desktop/business-daily-backup.cjs');
const NOW = new Date('2030-01-09T12:00:00Z');
function deferred() { let resolve; const promise = new Promise(accept => { resolve = accept; }); return { promise, resolve }; }
const turn = () => new Promise(resolve => setImmediate(resolve));

// This model deliberately tests whether real routing calls the independent
// session factory; it is not a substitute for production createAuth tests.
function syntheticBackend() {
  const calls = { login: 0, status: 0, sessions: 0, exclusive: 0 };
  const accounts = {
    'demo-admin': { id: 'synthetic-native-admin', username: 'demo-admin', role: 'admin', active: true },
    'demo-sales-a': { id: 'synthetic-browser-staff', username: 'demo-sales-a', role: 'employee', active: true },
  };
  function session() {
    let user = null;
    const auth = { status: () => ({ needsSetup: false, authenticated: Boolean(user), ...(user ? { user } : {}) }) };
    return { auth,
      async dispatch(input) {
        if (input.path === '/auth/status') { calls.status++; return { ok: true, status: 200, data: auth.status() }; }
        if (input.path === '/auth/login' && input.method === 'POST') {
          calls.login++;
          // No real password or credentials are used by this boundary fixture.
          if (input.body?.fixture !== 'boundary-only' || !accounts[input.body?.username]) return { ok: false, status: 401, data: { error: 'synthetic fixture rejected' } };
          user = { ...accounts[input.body.username] }; return { ok: true, status: 200, data: auth.status() };
        }
        return { ok: false, status: 404, data: { error: 'unexpected boundary fixture endpoint' } };
      },
      imageResponse: async () => new Response(null, { status: 404 }),
      async close() { user = null; },
    };
  }
  const native = session();
  return { ...native, calls, runtime: { sqlite: { syntheticNeverOpened: true } },
    administration: { requireAdmin(user) { assert.equal(user.role, 'admin'); } },
    createSession() { calls.sessions++; return session(); },
    async exclusive(action) { calls.exclusive++; return action(); },
  };
}

async function availablePort() {
  const server = http.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  if (port === 31831) return availablePort();
  return port;
}

async function fixture(t) {
  const base = path.join(ROOT, 'runtime/freeze-auth-boundary-tests'); fs.mkdirSync(base, { recursive: true });
  const owned = fs.mkdtempSync(path.join(base, 'owned-'));
  const storage = { root: owned, dataDir: path.join(owned, 'data/sales'), profileDir: path.join(owned, 'profile') };
  const codeDir = path.join(owned, 'code'), resourcesDir = path.join(owned, 'resources');
  for (const directory of [storage.dataDir, storage.profileDir, path.join(owned, 'data/ledger'), path.join(owned, 'data/inventory'), path.join(codeDir, 'migrations'), path.join(codeDir, 'renderer-dist'), resourcesDir]) fs.mkdirSync(directory, { recursive: true });
  // Admission checks file existence only. These are plain sentinels, never
  // valid DBs, and no SQLite constructor or real backend is invoked.
  for (const [directory, name] of [[storage.dataDir, 'jewelry.sqlite'], [path.join(owned, 'data/ledger'), 'ledger.db'], [path.join(owned, 'data/inventory'), 'stockcheck.db']]) fs.writeFileSync(path.join(directory, name), 'SYNTHETIC NEVER OPENED DATABASE SENTINEL');
  const backend = syntheticBackend();
  const network = await createNetworkWorkspace({ backend, configFile: path.join(storage.profileDir, 'network.json'), validateConfig: value => assert.equal(value.mode, 'standalone') });
  const entered = deferred(), release = deferred(), archives = [];
  const behavior = { error: null }, counts = { snapshot: 0, probe: 0, modulesStopped: 0, modulesConfigured: 0 };
  let daily, server, context, dailyPromise;
  const cleanupResources = [];
  const runtime = await createDesktopHostRuntime({ storage, codeDir, resourcesDir, admission: Object.freeze({ mode: 'sandbox', root: owned, dataDir: storage.dataDir, publicAccess: false }), assertAdmission: () => true,
    hostId: 'freeze-auth-synthetic-host', profileId: 'freeze-auth-synthetic-profile', provisionOwner: true, port: await availablePort(),
    backendFactory: () => backend, recoverBeforeBusinessOpen: async () => {},
    getLocalActor: () => backend.auth.status().user, isLocal: () => true,
    withNetworkFrozen: action => network.withFrozen(action),
    onBackendReplaced: next => network.setBackend(next), onSessionsInvalidated: async () => {},
    serverFactory: () => { server = http.createServer(); return server; },
    legacyModulesFactory: () => ({ status: () => ({ modules: [{ id: 'ledger', configured: true }, { id: 'inventory', configured: true }] }), configure: async () => { counts.modulesConfigured++; }, close: async () => { counts.modulesStopped++; } }),
    printWorkerLauncher: async () => ({ close: async () => {} }),
    printerSettings: { read: () => ({}) },
    printServicesFactory: () => ({ routing: {} }),
    maintenanceFactory(options) {
      context = options.context;
      const service = {
        list: () => archives.slice(),
        create: options2 => options.withFrozen(async () => {
          counts.snapshot++; entered.resolve(); await release.promise;
          if (behavior.error) throw behavior.error;
          const file = context.policy.check(path.join(context.layout.backupDir, 'boundary-' + counts.snapshot + '.fixture'));
          context.policy.io.writeFileSync(file, 'PLAIN BOUNDARY SENTINEL: NOT AN ENCRYPTED ARCHIVE', { flag: 'wx' });
          const row = { file, kind: options2.kind, createdAt: options2.now.toISOString() }; archives.push(row); return row;
        }),
        async probe(file, options2) {
          counts.probe++; assert.equal(options2.requireCurrentSlots, true);
          assert.equal(context.policy.io.readFileSync(file, 'utf8'), 'PLAIN BOUNDARY SENTINEL: NOT AN ENCRYPTED ARCHIVE');
        },
        cleanup: async () => [],
      };
      daily = createBusinessDailyBackups({ context, service, markerName: 'daily-backup-test.json' });
      return { daily, close: () => daily.stop() };
    },
  });
  assert.equal(server.address().address, '127.0.0.1'); assert.notEqual(server.address().port, 31831);
  const origin = 'http://127.0.0.1:' + server.address().port;
  t.after(async () => { for (const cleanup of cleanupResources) cleanup(); release.resolve(); await dailyPromise?.catch(() => {}); await runtime.close(); await network.close(); });
  function browser() {
    const state = { cookie: '', csrf: '' };
    return { state, async call(address, body) {
      const response = await fetch(origin + address, { method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(5000), headers: { ...(state.cookie ? { cookie: state.cookie } : {}), ...(body === undefined ? {} : { origin, 'content-type': 'application/json', 'x-xjy-csrf': state.csrf }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const setCookie = response.headers.get('set-cookie'), data = await response.json();
      if (setCookie) state.cookie = setCookie.split(';')[0];
      if (data.csrf) state.csrf = data.csrf;
      return { status: response.status, data, setCookie };
    } };
  }
  return { runtime, network, backend, counts, behavior, context, origin, server, browser, entered: entered.promise, release: release.resolve,
    cleanup: action => cleanupResources.push(action),
    startDaily() { dailyPromise = daily.tick(NOW); dailyPromise.catch(() => {}); return dailyPromise; },
    sameDay: () => daily.tick(NOW), marker: path.join(context.layout.configDir, 'daily-backup-test.json') };
}
const credentials = username => ({ username, fixture: 'boundary-only' });
const nativeLogin = f => f.network.request({ path: '/auth/login', method: 'POST', body: credentials('demo-admin') });

test('daily freeze rejects auth without executing login or rotating a browser session, then resumes independent accounts', { timeout: 20000 }, async t => {
  const f = await fixture(t); assert.equal((await nativeLogin(f)).status, 200);
  const a = f.browser(), b = f.browser(); await a.call('/session'); await b.call('/session');
  const original = { ...a.state }, beforeLogin = f.backend.calls.login, pending = f.startDaily();
  await f.entered;
  assert.equal(f.sameDay(), pending, 'simultaneous ticks must share the existing frozen snapshot');
  assert.equal((await f.network.request({ path: '/auth/status' })).status, 503);
  for (const [address, body] of [['/session'], ['/auth/status'], ['/auth/login', credentials('demo-sales-a')]]) {
    const response = await a.call(address, body);
    assert.equal(response.status, 503); assert.match(response.data.error, /备份|维护/); assert.equal(response.setCookie, null);
  }
  assert.equal(f.backend.calls.login, beforeLogin, 'blocked login must not reach the auth boundary');
  assert.deepEqual(a.state, original, 'a maintenance response must not replace the session or CSRF');
  f.release(); assert.equal((await pending).created, true);
  assert.equal((await a.call('/auth/status')).data.authenticated, false);
  const logged = await a.call('/auth/login', credentials('demo-sales-a'));
  assert.equal(logged.status, 200); assert.equal(logged.data.user.username, 'demo-sales-a');
  assert.notEqual(a.state.cookie, original.cookie); assert.notEqual(a.state.csrf, original.csrf);
  assert.equal((await b.call('/auth/status')).data.authenticated, false);
  assert.equal((await f.network.request({ path: '/auth/status' })).data.user.username, 'demo-admin');
  assert.equal((await f.runtime.withRequest(backend => backend.dispatch({ path: '/auth/status' }))).data.user.username, 'demo-admin');
  const employeeCookie = a.state.cookie; assert.equal((await f.sameDay()).created, false);
  assert.equal(f.counts.snapshot, 1); assert.equal((await a.call('/auth/status')).data.user.username, 'demo-sales-a'); assert.equal(a.state.cookie, employeeCookie);
});

test('snapshot rejection unwinds all freeze flags while keeping existing employee and native sessions', { timeout: 20000 }, async t => {
  const f = await fixture(t); await nativeLogin(f);
  const a = f.browser(); await a.call('/session'); await a.call('/auth/login', credentials('demo-sales-a'));
  const original = { ...a.state }; f.behavior.error = new Error('synthetic snapshot boundary failure');
  const pending = f.startDaily(); await f.entered;
  assert.equal((await a.call('/auth/status')).status, 503); assert.deepEqual(a.state, original);
  f.release(); await assert.rejects(pending, /synthetic snapshot boundary failure/);
  assert.equal(fs.existsSync(f.marker), false, 'a failed snapshot cannot publish the daily success marker');
  assert.equal((await a.call('/auth/status')).data.user.username, 'demo-sales-a'); assert.deepEqual(a.state, original);
  assert.equal((await f.network.request({ path: '/auth/status' })).data.user.username, 'demo-admin');
  assert.equal((await f.runtime.withRequest(backend => backend.dispatch({ path: '/auth/status' }))).status, 200);
  const b = f.browser(); await b.call('/session'); assert.equal((await b.call('/auth/login', credentials('demo-sales-a'))).status, 200);
  assert.notEqual(b.state.cookie, a.state.cookie);
  f.behavior.error = null; assert.equal((await f.startDaily()).created, true, 'daily active/freeze leases must also be released after rejection');
});

test('daily freeze drains an already accepted slow HTTP body before snapshot work and prevents its login mutation', { timeout: 20000 }, async t => {
  const f = await fixture(t); await nativeLogin(f);
  const browser = f.browser(); await browser.call('/session');
  const body = JSON.stringify(credentials('demo-sales-a')), arrived = deferred();
  f.server.once('request', () => arrived.resolve());
  let request;
  const response = new Promise((resolve, reject) => {
    request = http.request(f.origin + '/auth/login', { method: 'POST', headers: { cookie: browser.state.cookie, origin: f.origin, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'x-xjy-csrf': browser.state.csrf } }, result => { result.resume(); result.once('end', () => resolve(result.statusCode)); });
    request.once('error', reject); request.write(body.slice(0, 8));
  });
  f.cleanup(() => request.destroy()); await arrived.promise; await turn();
  const beforeLogin = f.backend.calls.login, pending = f.startDaily(); await turn();
  assert.equal(f.counts.snapshot, 0, 'snapshot must wait until the accepted request finishes its body');
  request.end(body.slice(8)); assert.equal(await response, 503); await f.entered;
  assert.equal(f.backend.calls.login, beforeLogin, 'a request drained during pause cannot perform login');
  f.release(); await pending;
  assert.equal((await browser.call('/auth/status')).data.authenticated, false);
  assert.equal((await browser.call('/auth/login', credentials('demo-sales-a'))).status, 200);
});

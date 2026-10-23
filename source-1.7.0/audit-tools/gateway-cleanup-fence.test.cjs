'use strict';
// Guest-only actual HTTP/gateway. In-memory backend exposes explicit close and
// body gates; no database, product process, transaction replay or pyc.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
if (process.platform !== 'win32' || ROOT.toLowerCase() !== 'c:\\xjy-work\\xjy-web-stage1') throw Error('Cleanup fence RED requires the actual fixed Windows Sandbox');
const guardFile = path.join(ROOT, 'stage1/guest-candidate-cdp.cjs');
if (crypto.createHash('sha256').update(fs.readFileSync(guardFile)).digest('hex') !== '59840b638d8797fb55241616cd0b8e4098075a76834a201b0e93c1a748f1bb32') throw Error('Actual Sandbox guard source changed');
require(guardFile).actualGuard();
const test = require('node:test'), assert = require('node:assert/strict'), http = require('node:http');
const { createGateway } = require('../stage1/web-gateway.cjs');
function deferred() { let resolve, reject; const promise = new Promise((accept, deny) => { resolve = accept; reject = deny; }); promise.catch(() => {}); return { promise, resolve, reject }; }
class Jar {
  constructor() { this.values = new Map(); }
  header() { return [...this.values].map(([name, value]) => name + '=' + value).join('; '); }
  apply(lines) { for (const line of lines) { const [pair] = line.split(';'), split = pair.indexOf('='); this.values.set(pair.slice(0, split), pair.slice(split + 1)); } }
}
async function fixture(t) {
  const base = path.join(ROOT, 'runtime/gateway-cleanup-fence-tests'); fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, 'owned-')); fs.mkdirSync(path.join(root, 'logs'));
  const created = [], mutations = [], gates = new Map(), bodyGates = new Map(), pending = [], finishBodies = [];
  const backend = { auth: { status: () => ({ needsSetup: false, authenticated: true, user: { username: 'fictional-native-admin' } }) },
    createSession(options) {
      const index = created.length + 1; let user = null, closing;
      const session = { auth: { status: () => ({ needsSetup: false, authenticated: Boolean(user), ...(user ? { user } : {}) }) },
        async dispatch(input) {
          if (input.path === '/auth/login') { user = { id: 'synthetic-employee', username: 'fictional-sales', role: 'employee' }; return { ok: true, status: 200, data: session.auth.status() }; }
          if (input.path === '/api/customers' && input.method === 'POST') { mutations.push({ index, body: input.body }); return { ok: true, status: 201, data: { fixture: 'synthetic mutation dispatched' } }; }
          return { ok: false, status: 404, data: { error: 'unexpected fixture route' } };
        },
        close() { if (!closing) { user = null; const gate = gates.get(index); if (gate) { gate.entered.resolve(); closing = gate.release.promise; } else closing = Promise.resolve(); } return closing; },
      }; created.push({ index, options, session, invalidate: () => { user = null; } }); return session;
    },
  };
  const server = http.createServer((req) => {
    const gate = bodyGates.get(req.headers['x-cleanup-body-gate']);
    if (gate) {
      const on = req.on.bind(req);
      req.on = (event, callback) => { const result = on(event, callback); if (event === 'data') gate.entered.resolve(); return result; };
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  assert.equal(server.address().address, '127.0.0.1'); assert.notEqual(server.address().port, 31831);
  const origin = 'http://127.0.0.1:' + server.address().port;
  const gateway = createGateway({ backend, server, root, sessionLimit: 2, allowLocalControls: false });
  function holdClose(index) { const gate = { entered: deferred(), release: deferred() }; gates.set(index, gate); return gate; }
  function remember(promise) { pending.push(promise); promise.catch(() => {}); return promise; }
  async function call(jar, address, options = {}) {
    const method = options.body === undefined ? 'GET' : 'POST', headers = { cookie: jar.header() };
    if (method === 'POST') Object.assign(headers, { origin, 'content-type': 'application/json', 'x-xjy-csrf': options.csrf || '' });
    const response = await fetch(origin + address, { method, headers, ...(method === 'POST' ? { body: JSON.stringify(options.body) } : {}), redirect: 'error', signal: AbortSignal.timeout(8000) });
    const cookies = response.headers.getSetCookie(); jar.apply(cookies); return { status: response.status, data: await response.json(), cookies };
  }
  function partialMutation(jar, csrf) {
    const gate = { entered: deferred() }; bodyGates.set('partial-a', gate); let request, finished = false;
    const result = remember(new Promise((resolve, reject) => {
      request = http.request(origin + '/api/customers', { method: 'POST', headers: { cookie: jar.header(), origin, 'content-type': 'application/json', 'x-xjy-csrf': csrf, 'x-cleanup-body-gate': 'partial-a' } }, response => {
        const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => { try { resolve({ status: response.statusCode, data: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); } catch (error) { reject(error); } }); response.on('error', reject);
      }); request.on('error', reject); request.flushHeaders(); request.write('{"fixture":');
    }));
    const finish = () => { if (!finished) { finished = true; request.end('true}'); } }; finishBodies.push(finish);
    return { entered: gate.entered.promise, finish, result };
  }
  t.after(async () => { for (const finish of finishBodies) finish(); for (const gate of gates.values()) gate.release.resolve(); await Promise.allSettled(pending); await Promise.allSettled([gateway.close()]); await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
  const a = new Jar(), first = await call(a, '/session'); assert.equal(first.status, 200);
  const logged = await call(a, '/auth/login', { csrf: first.data.csrf, body: { username: 'fictional-sales', fixture: 'in-memory-only' } }); assert.equal(logged.status, 200);
  const b = new Jar(), bootB = await call(b, '/session'); assert.equal(bootB.status, 200); assert.equal(created.length, 3);
  async function failB() {
    const close = holdClose(3), loggingOut = remember(call(b, '/auth/logout', { csrf: bootB.data.csrf, body: {} })); await close.entered.promise;
    close.release.reject(Error('synthetic B close rejected')); assert.equal((await loggingOut).status, 500);
    // Establish through HTTP that cleanupFailed is already active before the
    // held A continuation is released; no guessed sleep/microtask timing.
    assert.equal((await call(b, '/auth/status')).status, 503);
  }
  return { a, b, logged, created, mutations, call, partialMutation, holdClose, remember, failB, backend };
}

test('F1 a partial authenticated JSON write cannot dispatch after another session close has activated failure-stop', { timeout: 20000 }, async t => {
  const f = await fixture(t), partial = f.partialMutation(f.a, f.logged.data.csrf); await partial.entered;
  assert.equal(f.mutations.length, 0); await f.failB(); partial.finish();
  assert.equal((await partial.result).status, 503, 'body completion must recheck failed cleanup before starting the business action');
  assert.equal(f.mutations.length, 0, 'a known cleanup failure must fence mutations that have not dispatched yet');
  assert.equal(f.backend.auth.status().user.username, 'fictional-native-admin');
});

test('F2 authority-close await cannot allocate a new bootstrap after a different close has activated failure-stop', { timeout: 20000 }, async t => {
  const f = await fixture(t), gate = f.holdClose(2); f.created[1].invalidate();
  const waiting = f.remember(f.call(f.a, '/session')); await gate.entered.promise;
  await f.failB(); gate.release.resolve();
  const result = await waiting; assert.equal(result.status, 503); assert.equal(result.cookies.length, 0);
  assert.equal(f.created.length, 3, 'the post-authority-close continuation must not create another backend object in failed state');
});

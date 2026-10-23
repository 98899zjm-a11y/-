'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), { EventEmitter } = require('node:events');
const { createGateway } = require('../stage1/web-gateway.cjs');
const base = path.resolve(__dirname, '../runtime/browser-gateway-tests');
const AUTH = 'xjy_stage1', BOOT = 'xjy_stage1_bootstrap', origin = 'http://127.0.0.1:41771';
function owned(value) { const full = path.resolve(value); assert.equal(full.startsWith(base + path.sep) || full === base, true); return full; }
class CookieJar {
  constructor() { this.values = new Map(); }
  header() { return [...this.values].map(([name, value]) => name + '=' + value).join('; '); }
  value(name) { return this.values.get(name); }
  apply(lines) {
    for (const line of lines) { const [pair, ...attributes] = line.split(';'), split = pair.indexOf('='); assert(split > 0); const name = pair.slice(0, split), value = pair.slice(split + 1); if (attributes.some(part => /^\s*Max-Age=0\s*$/i.test(part))) this.values.delete(name); else this.values.set(name, value); }
  }
}
const cookieLines = response => response['set-cookie'] === undefined ? [] : [].concat(response['set-cookie']);
function fixture(t, options = {}) {
  fs.mkdirSync(owned(base), { recursive: true });
  const root = fs.mkdtempSync(path.join(base, 'case-')), staticRoot = path.join(root, 'static');
  for (const dir of ['logs', 'stage1/web', 'static/assets']) fs.mkdirSync(owned(path.join(root, dir)), { recursive: true });
  fs.writeFileSync(owned(path.join(root, 'stage1/web/index.html')), 'ORIGINAL-DIAGNOSTIC');
  fs.writeFileSync(owned(path.join(staticRoot, 'browser.html')), 'BROWSER-ENTRY');
  fs.writeFileSync(owned(path.join(staticRoot, 'central.html')), 'CENTRAL-ENTRY');
  fs.writeFileSync(owned(path.join(staticRoot, 'assets/fake.js')), 'fictional code only');
  const server = new EventEmitter(); server.address = () => ({ port: 41771 });
  const calls = [], authCalls = []; let created = 0, imageCalls = 0;
  const native = { id: '33333333-3333-4333-8333-333333333333', username: 'fixture-native-admin', role: 'admin', active: true };
  const backend = {
    auth: { status: () => ({ authenticated: true, needsSetup: false, user: native }) },
    createSession() {
      created++; let user = null, closed = false;
      const session = { auth: { status: () => ({ authenticated: Boolean(user) && !closed, needsSetup: false, ...(user && !closed ? { user } : {}) }) },
        async dispatch(input) {
          if (closed) return { ok: false, status: 401, data: { error: 'fixture session closed' } };
          if (input.path === '/auth/login' && input.method === 'POST') {
            authCalls.push(input);
            if (input.body?.fixture !== 'browser-gateway-only' || !['fixture-employee', 'fixture-admin'].includes(input.body?.username)) return { ok: false, status: 401, data: { error: 'synthetic credentials rejected' } };
            const admin = input.body.username === 'fixture-admin';
            user = { id: admin ? '22222222-2222-4222-8222-222222222222' : '11111111-1111-4111-8111-111111111111', username: input.body.username, role: admin ? 'admin' : 'employee', active: true, moduleAccess: { ledger: admin ? 'manage' : 'operate', inventory: admin ? 'manage' : 'operate' } };
            return { ok: true, status: 200, data: session.auth.status() };
          }
          calls.push(input);
          if (!user) return { ok: false, status: 401, data: { error: 'fixture anonymous' } };
          return { ok: true, status: 200, data: input.path === '/api/internal-modules/proxy' ? { status: 200, headers: { 'content-type': 'text/html' }, bodyBase64: Buffer.from('<html><head></head><body>VIRTUAL MODULE</body></html>').toString('base64') } : { ok: true } };
        },
        async imageResponse() { imageCalls++; return user && !closed ? new Response(Buffer.from('fake-image'), { headers: { 'content-type': 'image/png', 'cache-control': 'private,max-age=3600' } }) : Response.json({ error: 'fixture anonymous' }, { status: 401 }); },
        async close() { closed = true; user = null; },
      };
      if (options.minimal) delete session.dispatch;
      return session;
    },
  };
  const gateway = createGateway({ backend, server, root, browserStaticRoot: options.diagnosticOnly ? null : staticRoot });
  t.after(() => gateway.close());
  async function request(url, method = 'GET', headers = {}, body = '') {
    const req = new EventEmitter(); Object.assign(req, { url, method, headers: { host: '127.0.0.1:41771', ...headers }, socket: { remoteAddress: '127.0.0.1' }, resume() {} });
    const out = {};
    return new Promise(resolve => {
      const res = { headersSent: false, setHeader(key, value) { out[key.toLowerCase()] = value; }, writeHead(status, values) { res.headersSent = true; out.status = status; for (const [key, value] of Object.entries(values || {})) out[key.toLowerCase()] = value; }, end(bytes) { resolve({ ...out, bytes: Buffer.from(bytes || '') }); } };
      server.emit('request', req, res); setImmediate(() => { if (body) req.emit('data', Buffer.from(body)); req.emit('end'); });
    });
  }
  async function login(role = 'employee') {
    const jar = new CookieJar(), first = await request('/session'), anonymous = JSON.parse(first.bytes); jar.apply(cookieLines(first));
    assert.equal(first.status, 200); assert.equal(anonymous.authenticated, false); assert.equal(anonymous.user, undefined);
    assert.match(jar.value(BOOT), /^[a-f0-9]{64}$/); assert.equal(jar.value(AUTH), undefined);
    const response = await request('/auth/login', 'POST', { cookie: jar.header(), origin, 'content-type': 'application/json', 'x-xjy-csrf': anonymous.csrf }, JSON.stringify({ username: 'fixture-' + role, fixture: 'browser-gateway-only' }));
    const data = JSON.parse(response.bytes); jar.apply(cookieLines(response));
    assert.equal(response.status, 200); assert.equal(data.authenticated, true); assert.equal(data.user.username, 'fixture-' + role);
    assert.match(jar.value(AUTH), /^[a-f0-9]{64}$/); assert.equal(jar.value(AUTH) === jar.value(BOOT), false); assert.notEqual(data.csrf, anonymous.csrf);
    assert.equal(cookieLines(response).filter(line => line.startsWith(BOOT + '=')).length, 0);
    return { jar, csrf: data.csrf, user: data.user, headers: { cookie: jar.header() } };
  }
  const writeHeaders = session => ({ ...session.headers, origin, 'content-type': 'application/json', 'x-xjy-csrf': session.csrf });
  return { gateway, request, login, writeHeaders, calls, authCalls, created: () => created, imageCalls: () => imageCalls };
}

test('compiled browser entry is selectable while original isolated diagnosis home remains unchanged', async t => {
  const f = fixture(t);
  assert.equal((await f.request('/')).bytes.toString(), 'ORIGINAL-DIAGNOSTIC');
  assert.equal((await f.request('/browser/')).bytes.toString(), 'BROWSER-ENTRY');
  assert.equal((await f.request('/home')).bytes.toString(), 'BROWSER-ENTRY');
  assert.equal((await f.request('/assets/fake.js')).bytes.toString(), 'fictional code only');
  assert.equal(f.created(), 0, 'static UI does not allocate an auth/backend session');
});

test('browser modules use a private browser session and original signed proxy without TCP service', async t => {
  const f = fixture(t), denied = await f.request('/modules/ledger/sales');
  assert.equal(denied.status, 401); assert.equal(denied['set-cookie'], undefined); assert.equal(f.created(), 0); assert.equal(f.calls.length, 0);
  const session = await f.login(), res = await f.request('/modules/ledger/sales', 'GET', session.headers);
  assert.equal(res.status, 200); assert.equal(res['cache-control'], 'no-store');
  assert.equal(f.calls[0].body.module, 'ledger'); assert.equal(f.calls[0].body.path, '/sales');
  assert.equal(f.calls[0].body.headers.cookie, undefined, 'neither authority nor bootstrap cookie is forwarded to the legacy module');
});

test('private image response explicitly overrides legacy cache headers', async t => {
  const f = fixture(t), denied = await f.request('/api/images/11111111-1111-4111-8111-111111111111');
  assert.equal(denied.status, 401); assert.equal(f.imageCalls(), 0); assert.equal(f.created(), 0); assert.equal(denied['set-cookie'], undefined);
  const session = await f.login(), res = await f.request('/api/images/11111111-1111-4111-8111-111111111111', 'GET', session.headers);
  assert.equal(res.status, 200); assert.equal(res.bytes.toString(), 'fake-image'); assert.equal(f.imageCalls(), 1);
  assert.equal(res['cache-control'], 'no-store');
});

test('browser maintenance endpoints are disabled even when caller owns a session', async t => {
  const f = fixture(t), session = await f.login('admin'); assert.equal(session.user.role, 'admin');
  const res = await f.request('/api/local/restore', 'POST', f.writeHeaders(session), '{}');
  assert.equal(res.status, 403); assert.equal(f.calls.length, 0); assert.equal(f.authCalls.length, 1);
});

test('module print intent is bound to that browser session and opens only the compiled central panel', async t => {
  const f = fixture(t), session = await f.login();
  const created = await f.request('/modules/inventory/_central-print', 'POST', f.writeHeaders(session), JSON.stringify({ source: { type: 'inventory-count-a4', id: 17 } }));
  assert.equal(created.status, 200); const intent = JSON.parse(created.bytes).intent;
  const panel = await f.request('/browser-central-print?intent=' + intent, 'GET', session.headers);
  assert.equal(panel.bytes.toString(), 'CENTRAL-ENTRY'); assert.equal(panel['x-frame-options'], 'SAMEORIGIN');
  const source = await f.request('/api/browser-print-intents/' + intent, 'GET', session.headers); assert.equal(JSON.parse(source.bytes).source.id, 17);
  const otherSession = await f.login(); assert.equal(otherSession.user.id, session.user.id, 'same account, independent browser session'); assert.equal(otherSession.jar.value(AUTH) === session.jar.value(AUTH), false);
  const other = await f.request('/api/browser-print-intents/' + intent, 'GET', otherSession.headers); assert.equal(other.status, 404); assert.equal(JSON.parse(other.bytes).source, undefined);
  const before = f.created(), anonymous = await f.request('/api/browser-print-intents/' + intent);
  assert.equal(anonymous.status, 401); assert.equal(anonymous['set-cookie'], undefined); assert.equal(f.created(), before);
});

test('diagnostic-only session admission does not require an unused module business dispatcher', async t => {
  const f = fixture(t, { diagnosticOnly: true, minimal: true }), response = await f.request('/session');
  assert.equal(response.status, 200); assert.equal(JSON.parse(response.bytes).authenticated, false); assert.equal(JSON.parse(response.bytes).user, undefined);
  assert.equal(cookieLines(response).length, 1); assert.match(cookieLines(response)[0], /^xjy_stage1_bootstrap=/); assert.equal(f.calls.length, 0);
});

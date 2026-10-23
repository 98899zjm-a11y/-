'use strict';

// Run only in the disconnected Windows Sandbox prepared by the root task.
// HTTP sockets and business sessions below are synthetic; LAN crypto is real.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');

const LIMITS = Object.freeze({
  replayGlobalEntries: 12, replayPeerEntries: 4,
  anonymousReplayGlobalEntries: 12, anonymousReplayPeerEntries: 4,
  maxConnections: 24, maxPeerConnections: 12,
  maxRequests: 24, maxPeerRequests: 12,
  maxBufferedBytes: 40 * 1024, maxPeerBufferedBytes: 24 * 1024,
  bodyTimeoutMs: 40,
});
const SOURCE = path.resolve(__dirname, '../project/desktop/lan.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const packet = (input = { path: '/api/bootstrap' }, extra = {}) => ({
  id: crypto.randomUUID(), timestamp: Date.now(), token: null, op: 'request', input, ...extra,
});

function syntheticBackend() {
  const backend = {
    revoked: false,
    auth: { status: () => ({ needsSetup: false, user: { role: 'admin' } }) },
    createSession() {
      let authenticated = false;
      return {
        async dispatch(input) {
          if (input.path === '/auth/login') {
            authenticated = input.body?.password === 'synthetic-ok';
            return { ok: authenticated, status: authenticated ? 200 : 401, data: { authenticated } };
          }
          if (!authenticated || backend.revoked) return { ok: false, status: 401, data: { error: 'synthetic revoked' } };
          if (input.path === '/api/throw') throw new Error('synthetic operation error');
          if (input.path === '/api/wait') await backend.gate;
          return { ok: true, status: 200, data: { accepted: true, length: input.body?.text?.length || 0 } };
        },
        async imageResponse() { return new Response('synthetic-image', { status: backend.revoked ? 401 : 200 }); },
        async close() { authenticated = false; },
      };
    },
  };
  return backend;
}

class FakeSocket extends EventEmitter {
  constructor(peer) { super(); this.remoteAddress = peer; this.destroyed = false; }
  destroy() { if (!this.destroyed) { this.destroyed = true; this.emit('close'); } return this; }
  setTimeout(_ms, callback) { if (callback) this.on('timeout', callback); return this; }
  setNoDelay() { return this; }
}

async function fixture(overrides = {}) {
  let server, listener;
  let clockOffset = 0;
  const limits = { ...LIMITS, ...overrides };
  const peers = new Set();
  const fakeHttp = {
    createServer(handler) {
      listener = handler; server = new EventEmitter();
      server.listen = (_options, done) => done();
      server.address = () => ({ port: 31831 });
      server.close = done => done();
      return server;
    },
    request(options, callback) {
      const clientRequest = new EventEmitter();
      clientRequest.setTimeout = () => clientRequest;
      clientRequest.destroy = error => { clientRequest.destroyed = true; if (error) clientRequest.emit('error', error); clientRequest.emit('close'); };
      clientRequest.end = content => {
        const pending = open({ declared: Number(options.headers?.['Content-Length'] || 0), method: options.method, url: options.path });
        if (!pending.response.writableEnded && !pending.socket.destroyed) { if (content) pending.data(content); pending.end(); }
        pending.done.then(response => setImmediate(() => {
          if (clientRequest.destroyed) return;
          const incoming = new EventEmitter(); incoming.statusCode = response.statusCode;
          incoming.resume = () => incoming;
          incoming.destroy = () => incoming.emit('error', new Error('synthetic response cancelled'));
          callback(incoming); incoming.emit('data', Buffer.from(response.body)); incoming.emit('end'); clientRequest.emit('close');
        }));
        return clientRequest;
      };
      return clientRequest;
    },
  };
  const exports = {};
  // Only test policy numbers are shrunk, never crypto or the operation/receive
  // algorithm. The baseline's inline replay bound is shrunk for a cheap RED.
  // Future RESOURCE_LIMITS is the same private production default, not an API.
  let source = fs.readFileSync(SOURCE, 'utf8')
    .replace('const MAX_WIRE_BYTES = 128 * 1024 * 1024;', 'const MAX_WIRE_BYTES = 16 * 1024;')
    .replace(/replay\.size >= 10000/g, 'replay.size >= ' + limits.replayGlobalEntries)
    .replace(/const RESOURCE_LIMITS = Object\.freeze\(\{[\s\S]*?\}\);/,
      'const RESOURCE_LIMITS = Object.freeze(' + JSON.stringify(limits) + ');');
  const context = vm.createContext({
    require: name => name === 'node:http' ? fakeHttp : require(name),
    module: { exports }, exports, Buffer, Response, URL,
    setTimeout, clearTimeout, setImmediate, clearImmediate, console,
    Date: class extends Date { static now() { return Date.now() + clockOffset; } },
  });
  new vm.Script(source, { filename: SOURCE }).runInContext(context);
  const backend = syntheticBackend();
  const lan = await context.module.exports.startLanServer({ backend, host: '127.0.0.1', port: 0 });
  const serverDER = Buffer.from(lan.identity.publicKey, 'base64url');
  const serverPublic = crypto.createPublicKey({ key: serverDER, format: 'der', type: 'spki' });

  function wire(value) {
    const pair = crypto.generateKeyPairSync('x25519');
    const ephemeralDER = pair.publicKey.export({ type: 'spki', format: 'der' });
    const secret = crypto.diffieHellman({ privateKey: pair.privateKey, publicKey: serverPublic });
    const salt = crypto.createHash('sha256').update(serverDER).update(ephemeralDER).digest();
    const key = Buffer.from(crypto.hkdfSync('sha256', secret, salt, 'xjy-lan-v1-x25519-aes256gcm', 32));
    const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from('xjy-lan-v1:request'));
    const bytes = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    const content = Buffer.from(JSON.stringify({ publicKey: ephemeralDER.toString('base64url'),
      iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), data: bytes.toString('base64url') }));
    return { content, key };
  }

  function connect(peer = '192.168.1.10') {
    const socket = new FakeSocket(peer); peers.add(socket); socket.once('close', () => peers.delete(socket));
    server.emit('connection', socket);
    return socket;
  }
  function open({ peer = '192.168.1.10', declared = 0, method = 'POST', url = '/jewelry-lan', socket: suppliedSocket } = {}) {
    const socket = suppliedSocket || connect(peer);
    const request = new EventEmitter();
    Object.assign(request, { socket, headers: { 'content-length': String(declared) }, method, url, complete: false,
      resume() { this.resumed = true; return this; },
      setTimeout(_ms, callback) { if (callback) this.on('timeout', callback); return this; },
      destroy(error) { this.destroyed = true; if (error) this.emit('error', error); this.emit('aborted'); this.emit('close'); socket.destroy(); },
    });
    const response = new EventEmitter();
    let resolve;
    const done = new Promise(accept => { resolve = accept; });
    Object.assign(response, { destroyed: false, writableEnded: false, statusCode: null, body: null,
      writeHead(status, headers) { this.statusCode = status; this.headers = headers; return this; },
      end(content) { if (this.writableEnded || this.destroyed) return; this.body = String(content || ''); this.writableEnded = true;
        this.emit('finish'); this.emit('close'); socket.destroy(); resolve(this); },
      destroy() { if (this.destroyed) return; this.destroyed = true; this.emit('close'); socket.destroy(); resolve(this); },
    });
    if (!socket.destroyed) listener(request, response);
    return { socket, request, response, done,
      data(value) { request.emit('data', Buffer.isBuffer(value) ? value : Buffer.from(value)); },
      end() { request.complete = true; request.emit('end'); request.emit('close'); },
      abort() { request.destroy(); },
    };
  }

  async function send(value, peer) {
    const sealed = wire(value), pending = open({ peer, declared: sealed.content.length });
    if (!pending.response.writableEnded && !pending.socket.destroyed) { pending.data(sealed.content); pending.end(); }
    const response = await pending.done;
    const envelope = JSON.parse(response.body);
    if (!envelope.iv) return { result: { status: response.statusCode, data: envelope } };
    const decipher = crypto.createDecipheriv('aes-256-gcm', sealed.key, Buffer.from(envelope.iv, 'base64url'));
    decipher.setAAD(Buffer.from('xjy-lan-v1:response')); decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64url')), decipher.final()]).toString('utf8'));
  }
  async function login(peer, extra = {}) {
    const result = await send(packet({ path: '/auth/login', method: 'POST', body: { password: 'synthetic-ok' } }, extra), peer);
    assert.equal(result.result.status, 200, 'another peer must still be able to log in');
    assert.equal(typeof result.token, 'string'); return result.token;
  }
  return { backend, lan, open, wire, send, login, connect,
    client: () => context.module.exports.createLanClient({ host: '127.0.0.1', port: 31831, code: lan.code }),
    advance(ms) { clockOffset += ms; }, now() { return Date.now() + clockOffset; },
    async close() { for (const socket of peers) socket.destroy(); await lan.stop(); },
  };
}

test('S1 invalid operation flood cannot consume the normal employee replay budget', async () => {
  const h = await fixture();
  try {
    for (let i = 0; i < 15; i++) assert.equal((await h.send(packet(undefined, { op: 'invalid' }))).result.status, 400);
    await h.login('192.168.1.20');
  } finally { await h.close(); }
});

test('S1 malformed routes and unknown tokens cannot poison a later valid request ID', async () => {
  const h = await fixture();
  try {
    for (const input of [{ path: '/api/../auth/login' }, { path: '/api/bootstrap' }]) {
      const id = crypto.randomUUID();
      const denied = await h.send(packet(input, { id, token: 'unknown-token' }));
      assert.ok([400, 401].includes(denied.result.status));
      await h.login('192.168.1.10', { id });
    }
  } finally { await h.close(); }
});

test('S1 unauthenticated traffic from peer A cannot block peer B login', async () => {
  const h = await fixture();
  try {
    for (let i = 0; i < 15; i++) {
      const denied = await h.send(packet(undefined, { token: 'unknown-token' }), '192.168.1.10');
      assert.ok([401, 429].includes(denied.result.status));
    }
    await h.login('192.168.1.20');
  } finally { await h.close(); }
});

test('S1 one authenticated peer reaches its own quota without blocking another employee', async () => {
  const h = await fixture();
  try {
    const tokenA = await h.login('192.168.1.10');
    for (let i = 0; i < 4; i++) assert.equal((await h.send(packet(undefined, { token: tokenA }), '192.168.1.10')).result.status, 200);
    assert.equal((await h.send(packet(undefined, { token: tokenA }), '192.168.1.10')).result.status, 429);
    const tokenB = await h.login('192.168.1.20');
    assert.equal((await h.send(packet(undefined, { token: tokenB }), '192.168.1.20')).result.status, 200);
  } finally { await h.close(); }
});

test('S1 accepted requests still reject duplicate IDs, stale clocks, peer theft and live revocation', async () => {
  const h = await fixture();
  try {
    const token = await h.login('192.168.1.10');
    const request = packet(undefined, { token });
    assert.equal((await h.send(request)).result.status, 200);
    assert.equal((await h.send(request)).result.status, 409);
    assert.equal((await h.send(packet(undefined, { token, timestamp: Date.now() - 301000 }))).result.status, 400);
    assert.equal((await h.send(packet(undefined, { token }), '192.168.1.20')).result.status, 401);
    h.backend.revoked = true;
    assert.equal((await h.send(packet(undefined, { token }))).result.status, 401);
    assert.equal((await h.send(packet(undefined, { token }))).result.status, 401);
  } finally { await h.close(); }
});

test('S1 failed login replays cannot repeat dispatch and do not block another peer', async () => {
  const h = await fixture();
  try {
    const bad = packet({ path: '/auth/login', method: 'POST', body: { password: 'wrong' } });
    assert.equal((await h.send(bad)).result.status, 401);
    assert.equal((await h.send(bad)).result.status, 409);
    for (let i = 0; i < 8; i++) await h.send(packet(bad.input));
    await h.login('192.168.1.20');
  } finally { await h.close(); }
});

test('S1 an accepted ID remains protected for ten minutes without extending the clock window', async () => {
  const h = await fixture();
  try {
    const token = await h.login(); const id = crypto.randomUUID();
    assert.equal((await h.send(packet(undefined, { id, token }))).result.status, 200);
    h.advance(5 * 60 * 1000 + 1);
    assert.equal((await h.send(packet(undefined, { id, token, timestamp: h.now() }))).result.status, 409);
    assert.equal((await h.send(packet(undefined, { token }))).result.status, 400);
    h.advance(5 * 60 * 1000 + 1);
    assert.equal((await h.send(packet(undefined, { id, token, timestamp: h.now() }))).result.status, 200);
  } finally { await h.close(); }
});

test('S2 declared bodies reserve peer bytes before data and leave room for another peer', async () => {
  const h = await fixture();
  try {
    h.open({ declared: 12 * 1024 }); h.open({ declared: 12 * 1024 });
    const denied = h.open({ declared: 1024 });
    assert.equal(denied.response.statusCode, 503);
    assert.match(denied.response.body, /繁忙|稍后|重试/);
    await h.login('192.168.1.20');
  } finally { await h.close(); }
});

test('S2 cumulative chunk bytes cannot exceed a peer budget and rejection releases its reservation', async () => {
  const h = await fixture();
  try {
    const held = h.open({ declared: 16 * 1024 });
    const chunked = h.open(); chunked.data(Buffer.alloc(8 * 1024)); chunked.data(Buffer.alloc(1024));
    assert.equal(chunked.response.statusCode, 503, 'check cumulative buffered bytes before retaining a chunk');
    held.abort();
    await h.login('192.168.1.10');
  } finally { await h.close(); }
});

test('S2 global bytes are bounded across peers and cancellation releases them exactly once', async () => {
  const h = await fixture();
  try {
    const a = h.open({ peer: '192.168.1.10', declared: 12 * 1024 });
    h.open({ peer: '192.168.1.20', declared: 12 * 1024 });
    h.open({ peer: '192.168.1.30', declared: 12 * 1024 });
    const denied = h.open({ peer: '192.168.1.40', declared: 8 * 1024 });
    assert.equal(denied.response.statusCode, 503);
    a.abort(); a.request.emit('close'); a.request.emit('error', new Error('late synthetic socket error'));
    const admitted = h.open({ peer: '192.168.1.40', declared: 8 * 1024 });
    assert.equal(admitted.response.writableEnded, false, 'cancellation must return the exact reserved bytes');
    const stillDenied = h.open({ peer: '192.168.1.50', declared: 12 * 1024 });
    assert.equal(stillDenied.response.statusCode, 503, 'late close/error must not double-release bytes');
  } finally { await h.close(); }
});

test('S2 abandoned body timeout returns a Chinese error and releases receive resources', async () => {
  const h = await fixture();
  try {
    const pending = h.open({ declared: 16 * 1024 }); pending.data(Buffer.alloc(512));
    await pause(80);
    assert.equal(pending.response.statusCode, 408);
    assert.match(pending.response.body, /超时/);
    await h.login('192.168.1.10');
  } finally { await h.close(); }
});

test('S2 receive errors and invalid encryption release resources for the next employee request', async () => {
  const h = await fixture();
  try {
    for (let i = 0; i < 6; i++) {
      const pending = h.open({ declared: 16 * 1024 }); pending.data(Buffer.alloc(512));
      pending.request.emit('error', new Error('synthetic receive error')); pending.request.emit('close');
    }
    for (let i = 0; i < 6; i++) {
      const pending = h.open({ declared: 16 * 1024 }); pending.data('{}'); pending.end(); await pending.done;
      assert.equal(pending.response.statusCode, 403);
    }
    await h.login('192.168.1.20');
  } finally { await h.close(); }
});

test('S2 incomplete sockets have per-peer and global connection budgets', async () => {
  const h = await fixture();
  try {
    const raw = [];
    for (let i = 0; i < 12; i++) raw.push(h.connect());
    assert.equal(h.connect().destroyed, true);
    assert.equal(h.connect('192.168.1.20').destroyed, false);
    for (let i = 0; i < 11; i++) h.connect('192.168.1.20');
    assert.equal(h.connect('192.168.1.30').destroyed, true);
    raw[0].destroy();
    assert.equal(h.connect('192.168.1.30').destroyed, false);
  } finally { await h.close(); }
});

test('S2 pipelined empty bodies cannot bypass the peer in-flight request budget', async () => {
  const h = await fixture({ maxPeerRequests: 4 });
  try {
    const socket = h.connect();
    for (let i = 0; i < 4; i++) h.open({ socket });
    const denied = h.open({ socket });
    assert.equal(denied.response.statusCode, 503);
    await h.login('192.168.1.20');
  } finally { await h.close(); }
});

test('S2 normal larger content, dispatch errors and ten simultaneous employees retain service', async () => {
  const h = await fixture({ replayGlobalEntries: 40, anonymousReplayGlobalEntries: 40 });
  try {
    const employees = await Promise.all(Array.from({ length: 10 }, (_, i) => h.login('192.168.1.' + (30 + i))));
    const result = await h.send(packet({ path: '/api/media', method: 'POST', body: { text: 'x'.repeat(8 * 1024) } }, { token: employees[0] }), '192.168.1.30');
    assert.equal(result.result.status, 200); assert.equal(result.result.data.length, 8192);
    assert.equal((await h.send(packet({ path: '/api/throw' }, { token: employees[0] }), '192.168.1.30')).result.status, 503);
    let release; h.backend.gate = new Promise(resolve => { release = resolve; });
    const pending = employees.map((token, i) => h.send(packet({ path: '/api/wait' }, { token }), '192.168.1.' + (30 + i)));
    await tick(); release();
    for (const response of await Promise.all(pending)) assert.equal(response.result.status, 200);
  } finally { await h.close(); }
});

test('S2 the wire cap still rejects declared and chunked overflow with 413', async () => {
  const h = await fixture();
  try {
    const declared = h.open({ declared: 16 * 1024 + 1 });
    assert.equal(declared.response.statusCode, 413);
    const chunked = h.open(); chunked.data(Buffer.alloc(16 * 1024)); chunked.data('x');
    assert.equal(chunked.response.statusCode, 413);
    await h.login('192.168.1.20');
  } finally { await h.close(); }
});

test('S2 the normal client reports Chinese busy errors and keeps its authenticated session', async () => {
  const h = await fixture(); const client = h.client();
  try {
    assert.equal((await client.dispatch({ path: '/auth/login', method: 'POST', body: { password: 'synthetic-ok' } })).status, 200);
    const a = h.open({ declared: 12 * 1024 }), b = h.open({ declared: 12 * 1024 });
    const busy = await client.dispatch({ path: '/api/bootstrap' });
    assert.equal(busy.status, 503); assert.match(busy.data.error, /繁忙|稍后|重试/);
    assert.equal(client.connected, true, 'resource rejection must preserve a previously verified host/session');
    a.abort(); b.abort();
    assert.equal((await client.dispatch({ path: '/api/bootstrap' })).status, 200);
  } finally { await client.close(); await h.close(); }
});

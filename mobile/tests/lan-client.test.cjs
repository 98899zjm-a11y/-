'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const esbuild = require('../../node_modules/esbuild');
const { generateVectors } = require('./protocol-fixtures.cjs');
const { createBackend } = require('../../desktop/backend.cjs');
const { startLanServer } = require('../../desktop/lan.cjs');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xjy-mobile-client-test-'));
const bundle = path.join(directory, 'lan-client.mjs');
esbuild.buildSync({ entryPoints: [path.resolve(__dirname, '../lan-client.ts')], outfile: bundle, bundle: true, platform: 'browser', format: 'esm', target: 'es2022', logLevel: 'silent' });
const loaded = import(pathToFileURL(bundle).href);
const vectors = generateVectors(), bytes = hex => Uint8Array.from(Buffer.from(hex, 'hex'));

test('pure noble移动加密无Node/subtle依赖，与交付Node协议golden vectors逐字节一致', async () => {
  const client = await loaded;
  const context = client.deriveMobileKey(bytes(vectors.ephemeral.privateRawHex), client.decodeBase64url(vectors.host.publicSpkiBase64url), client.decodeBase64url(vectors.ephemeral.publicSpkiBase64url));
  assert.equal(Buffer.from(context.sharedSecret).toString('hex'), vectors.derivation.sharedSecretHex);
  assert.equal(Buffer.from(context.salt).toString('hex'), vectors.derivation.saltSha256Hex);
  assert.equal(Buffer.from(context.key).toString('hex'), vectors.derivation.aes256KeyHex);
  assert.equal(client.identityPin(client.decodeBase64url(vectors.host.publicSpkiBase64url)), vectors.host.pin);
  assert.deepEqual(client.encryptMobileEnvelope(context.key, vectors.request.plaintextUtf8, 'request', bytes('000102030405060708090a0b'), vectors.ephemeral.publicSpkiBase64url), vectors.request.envelope);
  assert.deepEqual(client.encryptMobileEnvelope(context.key, vectors.response.plaintextUtf8, 'response', bytes('101112131415161718191a1b')), vectors.response.envelope);
  assert.equal(client.decryptMobileEnvelope(context.key, vectors.request.envelope, 'request'), vectors.request.plaintextUtf8);
  assert.equal(client.decryptMobileEnvelope(context.key, vectors.response.envelope, 'response'), vectors.response.plaintextUtf8);
  const image = JSON.parse(client.decryptMobileEnvelope(context.key, vectors.imageResponse.envelope, 'response'));
  assert.equal(crypto.createHash('sha256').update(Buffer.from(image.image.bytes, 'base64')).digest('hex'), vectors.imageResponse.imageSha256Hex);
  assert.throws(() => client.decryptMobileEnvelope(context.key, vectors.response.envelope, 'request'));
  assert.throws(() => client.decryptMobileEnvelope(context.key, { ...vectors.response.envelope, tag: 'A'.repeat(22) }, 'response'));
  assert.throws(() => client.deriveMobileKey(bytes(vectors.ephemeral.privateRawHex), client.spkiFromRaw(new Uint8Array(32)), client.decodeBase64url(vectors.ephemeral.publicSpkiBase64url)));
  assert.ok(!fs.readFileSync(bundle, 'utf8').includes('node:crypto'));
});

function createTransport() {
  const calls = []; let failure = false, spoofIdentity = null, tamper = false;
  async function request(url, body) {
    const address = new URL(url);
    assert.equal(address.hostname, '127.0.0.1'); assert.ok(['/jewelry-identity', '/jewelry-lan'].includes(address.pathname));
    calls.push({ url, body });
    if (failure) throw new Error('fixture transport offline');
    if (spoofIdentity && body === undefined) return JSON.stringify(spoofIdentity);
    return new Promise((resolve, reject) => {
      const req = http.request({ hostname: address.hostname, port: address.port, path: address.pathname, method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, res => {
        const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('error', reject); res.on('end', () => { const text = Buffer.concat(chunks).toString(); resolve(tamper && body !== undefined ? JSON.stringify({ ...JSON.parse(text), tag: 'A'.repeat(22) }) : text); });
      });
      req.setTimeout(5000, () => req.destroy(new Error('fixture timeout'))); req.once('error', reject); req.end(body);
    });
  }
  return { calls, setFailure(value) { failure = value; }, setIdentity(value) { spoofIdentity = value; }, setTamper(value) { tamper = value; }, get(url) { return request(url); }, post(url, body) { return request(url, body); } };
}

test('移动纯客户端实际TCP联测：无subtle、独立账号、原图、401、错误pin及断线注销', { timeout: 30000 }, async t => {
  const api = await loaded, backend = createBackend({ dataDir: path.join(directory, 'data'), migrationDir: path.resolve(__dirname, '../../drizzle') });
  const password = 'Mobile.Unit-Password-985!'; let server, a, b, wrong;
  const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { getRandomValues: crypto.webcrypto.getRandomValues.bind(crypto.webcrypto) } });
  const state = {}, transportA = createTransport(), transportB = createTransport(), transportWrong = createTransport();
  const good = async (client, address, method = 'GET', body) => { const result = await client.dispatch({ path: address, method, body }); assert.equal(result.ok, true, result.data?.error); return result.data; };
  const step = async (label, action) => { let failure; await t.test(label, async () => { try { await action(); } catch (error) { failure = error; throw error; } }); if (failure) throw failure; };
  try {
    await backend.dispatch({ path: '/auth/setup', method: 'POST', body: { username: 'admin', password } });
    state.a = (await backend.dispatch({ path: '/api/users', method: 'POST', body: { username: 'mobile_a', password } })).data.user;
    state.b = (await backend.dispatch({ path: '/api/users', method: 'POST', body: { username: 'mobile_b', password } })).data.user;
    server = await startLanServer({ backend, host: '127.0.0.1', port: 0 });
    a = api.createMobileLanClient(server, transportA); b = api.createMobileLanClient(server, transportB);
    await step('仅私网literal与规范地址；拒绝外网/DNS/别名且不发包', async () => {
      for (const host of ['8.8.8.8', 'example.com', '0177.0.0.1', '127.1', '::1', '192.168.0.1@evil']) assert.throws(() => api.createMobileLanClient({ ...server, host }, transportWrong));
      for (const address of ['/api/../auth/setup', '/api/%2e%2e/auth/login', '/auth/login#fragment', '/api\\..\\auth\\login', '//outside/api/bootstrap']) assert.equal((await a.dispatch({ path: address })).status, 400);
      assert.equal(transportA.calls.length, 0); assert.equal(transportWrong.calls.length, 0);
      assert.match(api.mobileRequestUuid(), /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    });
    await step('错误连接码/伪公钥只GET公开身份，绝不POST账号密码', async () => {
      wrong = api.createMobileLanClient({ ...server, code: 'a'.repeat(32) }, transportWrong);
      assert.equal((await wrong.dispatch({ path: '/auth/login', method: 'POST', body: { username: 'mobile_a', password } })).status, 403);
      assert.equal(transportWrong.calls.filter(call => call.body).length, 0);
      const spoofTransport = createTransport(); spoofTransport.setIdentity({ version: 1, publicKey: vectors.host.publicSpkiBase64url });
      const spoofClient = api.createMobileLanClient(server, spoofTransport);
      assert.equal((await spoofClient.dispatch({ path: '/auth/login', method: 'POST', body: { username: 'mobile_a', password } })).status, 403);
      assert.equal(spoofTransport.calls.filter(call => call.body).length, 0); await spoofClient.close();
    });
    await step('不依赖subtle/randomUUID仍能两员工并行登录，每包公钥不同且无明文', async () => {
      assert.equal(globalThis.crypto.subtle, undefined); assert.equal(globalThis.crypto.randomUUID, undefined);
      const result = await Promise.all([good(a, '/auth/login', 'POST', { username: 'mobile_a', password }), good(b, '/auth/login', 'POST', { username: 'mobile_b', password })]);
      assert.equal(result[0].user.id, state.a.id); assert.equal(result[1].user.id, state.b.id);
      const captured = [...transportA.calls, ...transportB.calls].filter(call => call.body).map(call => call.body);
      assert.ok(captured.every(body => !body.includes(password) && !body.includes('mobile_a') && !body.includes('mobile_b')));
      assert.equal(new Set(captured.map(body => JSON.parse(body).publicKey)).size, captured.length);
      assert.equal((await good(a, '/api/bootstrap')).user.id, state.a.id); assert.equal((await good(b, '/api/bootstrap')).user.id, state.b.id);
      assert.equal(backend.auth.status().user.username, 'admin');
      // Real devices have separate runtimes. This same-process test restores the
      // desktop core's UUID API; the mobile helper always uses getRandomValues.
      globalThis.crypto.randomUUID = crypto.randomUUID;
    });
    await step('手机保存真实多件报价及原图，其他员工无法读，合法编码query有效', async () => {
      state.customer = (await good(a, '/api/customers', 'POST', { name: '手机客户A' })).customer;
      state.quote = (await good(a, '/api/quotes', 'POST', { type: 'sale', customerId: state.customer.id, title: '手机多件', weight: 0, saleItems: [{ id: 'a', title: '戒指', material: '黄金', weight: 2, goldPrice: 450, laborPrice: 80, quantity: 2, extras: [] }, { id: 'b', title: '吊坠', material: '黄金', weight: 1, goldPrice: 600, laborPrice: 100, quantity: 1, extras: [] }] })).quote;
      assert.equal(state.quote.total, 2820);
      const image = Buffer.from(JSON.parse(vectors.imageResponse.plaintextUtf8).image.bytes, 'base64');
      const saved = (await good(a, '/api/quotes/' + state.quote.id + '/images', 'POST', { images: ['data:image/png;base64,' + image.toString('base64')] })).quote;
      state.imageId = saved.images[0].split('/').pop();
      const response = await a.imageResponse(state.imageId); assert.equal(response.status, 200); assert.deepEqual(Buffer.from(await response.arrayBuffer()), image);
      assert.equal((await b.imageResponse(state.imageId)).status, 404); assert.equal((await b.dispatch({ path: '/api/quotes/' + state.quote.id })).status, 404);
      assert.equal((await good(a, '/api/quotes?' + new URLSearchParams({ search: '手机', page: '1' }))).quotes[0].id, state.quote.id);
      assert.equal((await b.dispatch({ path: '/api/users', method: 'POST', body: { username: 'forbidden', password } })).status, 403);
      assert.equal((await good(b, '/auth/status')).authenticated, true, '权限403不应把正常员工登出');
    });
    await step('停用或重置密码立即401并清token，B与主机身份不串台', async () => {
      await backend.dispatch({ path: '/api/users', method: 'PATCH', body: { id: state.a.id, password: 'Mobile.Changed-Password-277!' } });
      assert.equal((await a.imageResponse(state.imageId)).status, 401); assert.equal((await good(a, '/auth/status')).authenticated, false);
      assert.equal((await good(b, '/auth/status')).authenticated, true);
      assert.equal((await a.dispatch({ path: '/auth/login', method: 'POST', body: { username: 'mobile_a', password } })).status, 401);
      await good(a, '/auth/login', 'POST', { username: 'mobile_a', password: 'Mobile.Changed-Password-277!' });
      await backend.dispatch({ path: '/api/users', method: 'PATCH', body: { id: state.b.id, active: false } });
      assert.equal((await b.dispatch({ path: '/api/bootstrap' })).status, 401);
    });
    await step('断线logout始终本机成功且清token，恢复连接仍需重登', async () => {
      transportA.setFailure(true);
      const logout = await a.dispatch({ path: '/auth/logout', method: 'POST' }); assert.equal(logout.ok, true); assert.equal(logout.data.authenticated, false);
      transportA.setFailure(false); assert.equal((await good(a, '/auth/status')).authenticated, false);
      await good(a, '/auth/login', 'POST', { username: 'mobile_a', password: 'Mobile.Changed-Password-277!' });
      transportA.setFailure(true);
      assert.equal((await a.dispatch({ path: '/auth/login', method: 'POST', body: { username: 'mobile_b', password } })).status, 503);
      transportA.setFailure(false); assert.equal((await good(a, '/auth/status')).authenticated, false, '失败切换账号不能继续旧身份');
    });
    await step('篡改GCM tag拒绝，logout取消排队登录且close不能被迟到响应恢复', async () => {
      transportA.setTamper(true); assert.equal((await a.dispatch({ path: '/auth/status' })).status, 403); transportA.setTamper(false);
      const queuedLogin = a.dispatch({ path: '/auth/login', method: 'POST', body: { username: 'mobile_a', password: 'Mobile.Changed-Password-277!' } });
      const logout = a.logout(); assert.equal((await queuedLogin).status, 401); assert.equal((await logout).ok, true);
      assert.equal((await good(a, '/auth/status')).authenticated, false);
      await a.close(); assert.equal((await a.dispatch({ path: '/api/bootstrap' })).status, 401);
    });
    await step('正确AEAD但requestId不匹配的响应也拒绝', async () => {
      const real = createTransport();
      const wrongId = api.createMobileLanClient(server, { get: url => real.get(url), post: async (_url, body) => {
        const envelope = JSON.parse(body), serverDER = Buffer.from(server.identity.publicKey, 'base64url'), ephemeralDER = Buffer.from(envelope.publicKey, 'base64url');
        const privateKey = crypto.createPrivateKey({ key: Buffer.from(server.identity.privateKey, 'base64url'), format: 'der', type: 'pkcs8' });
        const publicKey = crypto.createPublicKey({ key: ephemeralDER, format: 'der', type: 'spki' });
        const secret = crypto.diffieHellman({ privateKey, publicKey }), salt = crypto.createHash('sha256').update(serverDER).update(ephemeralDER).digest();
        const key = Buffer.from(crypto.hkdfSync('sha256', secret, salt, 'xjy-lan-v1-x25519-aes256gcm', 32));
        return JSON.stringify(api.encryptMobileEnvelope(key, JSON.stringify({ requestId: 'different-request', result: { ok: true, status: 200, data: { authenticated: true } } }), 'response', crypto.randomBytes(12)));
      } });
      assert.equal((await wrongId.dispatch({ path: '/auth/status' })).status, 403); await wrongId.close();
    });
    await step('迟到的成功登录响应在close后不能写回token', async () => {
      const transport = createTransport(); let responseReady, release;
      const received = new Promise(resolve => { responseReady = resolve; }), releaseResponse = new Promise(resolve => { release = resolve; });
      const delayed = api.createMobileLanClient(server, { get: url => transport.get(url), post: async (url, body) => { const text = await transport.post(url, body); responseReady(); await releaseResponse; return text; } });
      const pending = delayed.dispatch({ path: '/auth/login', method: 'POST', body: { username: 'mobile_a', password: 'Mobile.Changed-Password-277!' } });
      await received; await delayed.close(); release();
      assert.equal((await pending).status, 401); assert.equal(delayed.connected, false);
      assert.equal((await delayed.dispatch({ path: '/auth/status' })).status, 401);
    });
    await step('没有安全RNG时拒绝发送密码，超时与64MB限制均不降级明文', async () => {
      const transport = createTransport(), unsafe = api.createMobileLanClient(server, transport);
      const previous = globalThis.crypto;
      Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {} });
      try { assert.equal((await unsafe.dispatch({ path: '/auth/login', method: 'POST', body: { username: 'mobile_a', password } })).status, 503); assert.equal(transport.calls.filter(call => call.body).length, 0); }
      finally { Object.defineProperty(globalThis, 'crypto', { configurable: true, value: previous }); await unsafe.close(); }
      let posts = 0;
      const hanging = api.createMobileLanClient({ ...server, timeoutMs: 100 }, { get: () => new Promise(() => {}), post: async () => { posts++; return ''; } });
      assert.equal((await hanging.dispatch({ path: '/auth/login', method: 'POST', body: { username: 'mobile_a', password } })).status, 503); assert.equal(posts, 0); await hanging.close();
      const limitedTransport = createTransport(), limited = api.createMobileLanClient(server, limitedTransport);
      assert.equal((await limited.dispatch({ path: '/api/quotes', method: 'POST', body: { note: 'x'.repeat(50 * 1024 * 1024) } })).status, 413);
      assert.equal(limitedTransport.calls.filter(call => call.body).length, 0); await limited.close();
    });
  } finally {
    await a?.close(); await b?.close(); await wrong?.close(); await server?.stop(); await backend.close();
    if (originalCrypto) Object.defineProperty(globalThis, 'crypto', originalCrypto); else delete globalThis.crypto;
  }
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createHash, createCipheriv, createDecipheriv, randomBytes, randomUUID, generateKeyPairSync, createPublicKey, diffieHellman, hkdfSync } = require('node:crypto');
const { createBackend } = require('../backend.cjs');
const { startLanServer, createLanClient, isPrivateIPv4 } = require('../lan.cjs');

const dataRoot = path.resolve(__dirname, '.lan-data');
const migrationDir = path.resolve(__dirname, '../../drizzle');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
function seal(identity, value) {
  const ephemeral = generateKeyPairSync('x25519'), publicDER = ephemeral.publicKey.export({ type: 'spki', format: 'der' });
  const serverDER = Buffer.from(identity.publicKey, 'base64url'), publicKey = createPublicKey({ key: serverDER, format: 'der', type: 'spki' });
  const secret = diffieHellman({ privateKey: ephemeral.privateKey, publicKey });
  const key = Buffer.from(hkdfSync('sha256', secret, createHash('sha256').update(serverDER).update(publicDER).digest(), 'xjy-lan-v1-x25519-aes256gcm', 32));
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from('xjy-lan-v1:request'));
  const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return { content: JSON.stringify({ publicKey: publicDER.toString('base64url'), iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), data: data.toString('base64url') }), key };
}
function open(key, text, direction = 'response') {
  const value = JSON.parse(text), decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(value.iv, 'base64url'));
  decipher.setAAD(Buffer.from('xjy-lan-v1:' + direction)); decipher.setAuthTag(Buffer.from(value.tag, 'base64url'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.data, 'base64url')), decipher.final()]).toString());
}
function raw(port, content, contentLength = Buffer.byteLength(content), statusOnly = false) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/jewelry-lan', headers: { 'Content-Length': contentLength } }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => resolve(statusOnly ? { status: res.statusCode, content: Buffer.concat(chunks).toString() } : Buffer.concat(chunks).toString())); res.on('error', reject);
    });
    req.setTimeout(3000, () => req.destroy(new Error('test timeout'))); req.once('error', reject); req.end(content);
  });
}
async function encryptedRequest(server, packet) { const request = seal(server.identity, packet); return open(request.key, await raw(server.port, request.content)); }

test('真实局域网TCP：两员工独立会话、加密、重放拒绝、权限与断线', { timeout: 30000 }, async t => {
  fs.mkdirSync(dataRoot, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(dataRoot, 'run-'));
  const backend = createBackend({ dataDir, migrationDir });
  const adminPassword = 'Lan.Admin-882!', workerPassword = 'Lan.Worker-615!';
  let server, a, b, wrong;
  const step = async (label, action) => { let failure; await t.test(label, async () => { try { await action(); } catch (error) { failure = error; throw error; } }); if (failure) throw failure; };
  const good = async (client, address, method = 'GET', body) => { const result = await client.dispatch({ path: address, method, body }); assert.equal(result.ok, true, result.data?.error); return result.data; };
  const state = {};
  state.aPassword = workerPassword;
  try {
    await backend.dispatch({ path: '/auth/setup', method: 'POST', body: { username: 'admin', password: adminPassword } });
    state.a = (await backend.dispatch({ path: '/api/users', method: 'POST', body: { username: 'worker_a', password: workerPassword } })).data.user;
    state.b = (await backend.dispatch({ path: '/api/users', method: 'POST', body: { username: 'worker_b', password: workerPassword } })).data.user;
    await step('只接受局域网IPv4和本机网卡，不解析互联网域名', async () => {
      assert.equal(isPrivateIPv4('192.168.1.5'), true); assert.equal(isPrivateIPv4('::ffff:10.1.2.3'), true);
      assert.equal(isPrivateIPv4('172.32.1.1'), false); assert.equal(isPrivateIPv4('8.8.8.8'), false);
      assert.throws(() => createLanClient({ host: 'example.com', code: 'a'.repeat(32) }), /互联网|域名/);
      assert.throws(() => createLanClient({ host: '8.8.8.8', code: 'a'.repeat(32) }), /互联网|域名/);
      await assert.rejects(startLanServer({ backend, host: '192.168.254.253', port: 0 }), /这台电脑/);
      server = await startLanServer({ backend, host: '127.0.0.1', port: 0 });
      a = createLanClient(server); b = createLanClient(server);
      wrong = createLanClient({ ...server, code: 'a'.repeat(32) });
    });
    await step('匿名status不泄露主机管理员；远程禁止首次setup；错误连接码拒绝', async () => {
      assert.deepEqual(await good(a, '/auth/status'), { needsSetup: false, authenticated: false });
      assert.equal((await a.dispatch({ path: '/auth/setup', method: 'POST', body: { username: 'remote', password: workerPassword } })).status, 403);
      for (const address of ['/api/../auth/setup', '/api/%2e%2e/auth/setup', '/api/../auth/login', '/auth/./login', '/auth/login#alias', '/api\\..\\auth\\setup']) {
        const alias = { id: randomUUID(), timestamp: Date.now(), op: 'request', input: { path: address, method: 'POST', body: { username: 'worker_a', password: workerPassword } } };
        assert.equal((await encryptedRequest(server, alias)).result.status, 400, address);
      }
      assert.equal((await a.dispatch({ path: '/api/bootstrap' })).status, 401);
      assert.equal((await wrong.dispatch({ path: '/auth/status' })).status, 403);
    });
    await step('AES加密口令/数据，重复包、过期时间、未知操作和超大包均拒绝', async () => {
      const packet = { id: randomUUID(), timestamp: Date.now(), op: 'request', input: { path: '/auth/login', method: 'POST', body: { username: 'worker_a', password: workerPassword } } };
      const encrypted = seal(server.identity, packet);
      assert.ok(!encrypted.content.includes('worker_a')); assert.ok(!encrypted.content.includes(workerPassword));
      const resultText = await raw(server.port, encrypted.content); assert.ok(!resultText.includes('worker_a')); assert.ok(!resultText.includes('token'));
      const result = open(encrypted.key, resultText); assert.equal(result.result.ok, true); assert.ok(result.token);
      const sharedCodeKey = createHash('sha256').update(server.code).digest();
      assert.throws(() => open(sharedCodeKey, encrypted.content, 'request'), /authenticate|Unsupported|unable/i);
      assert.throws(() => open(sharedCodeKey, resultText), /authenticate|Unsupported|unable/i);
      assert.equal(open(encrypted.key, await raw(server.port, encrypted.content)).result.status, 409);
      const expired = { id: randomUUID(), timestamp: Date.now() - 10 * 60 * 1000, op: 'request', input: { path: '/auth/status' } };
      const stale = await encryptedRequest(server, expired); assert.equal(stale.result.status, 400); assert.match(stale.result.data.error, /时间/);
      assert.equal((await encryptedRequest(server, { id: randomUUID(), timestamp: Date.now(), op: 'shell' })).result.status, 400);
      assert.equal((await raw(server.port, '{}', 64 * 1024 * 1024 + 1, true)).status, 413);
    });
    await step('两员工同时登录、并发录客户，各自独立且主机管理员会话不变', async () => {
      const captured = [], originalRequest = http.request;
      http.request = function (options, callback) { const request = originalRequest.call(this, options, callback), originalEnd = request.end; request.end = function (content, ...args) { if (options.path === '/jewelry-lan' && content) captured.push(String(content)); return originalEnd.call(this, content, ...args); }; return request; };
      let result;
      try { result = await Promise.all([good(a, '/auth/login', 'POST', { username: 'worker_a', password: workerPassword }), good(b, '/auth/login', 'POST', { username: 'worker_b', password: workerPassword })]); }
      finally { http.request = originalRequest; }
      assert.equal(captured.length, 2); assert.notEqual(JSON.parse(captured[0]).publicKey, JSON.parse(captured[1]).publicKey);
      for (const content of captured) assert.throws(() => open(createHash('sha256').update(server.code).digest(), content, 'request'), /authenticate|Unsupported|unable/i);
      assert.equal(result[0].user.id, state.a.id); assert.equal(result[1].user.id, state.b.id);
      const pairs = await Promise.all([good(a, '/api/customers', 'POST', { name: 'A私有客户' }), good(b, '/api/customers', 'POST', { name: 'B私有客户' })]);
      state.customerA = pairs[0].customer; state.customerB = pairs[1].customer;
      await Promise.all(Array.from({ length: 12 }, (_, i) => good(i % 2 ? a : b, '/api/customers', 'POST', { name: '并发客户' + i })));
      const views = await Promise.all([good(a, '/api/bootstrap'), good(b, '/api/bootstrap')]);
      assert.ok(views[0].customers.every(customer => customer.ownerId === state.a.id)); assert.ok(views[1].customers.every(customer => customer.ownerId === state.b.id));
      assert.equal(views[0].customers.length, 7); assert.equal(views[1].customers.length, 7);
      assert.equal(backend.auth.status().user.username, 'admin');
      assert.equal((await a.dispatch({ path: '/api/users', method: 'POST', body: { username: 'forbidden', password: workerPassword } })).status, 403);
    });
    await step('主机备份独占队列会阻止局域网写入，释放后才提交', async () => {
      let started, release, written = false;
      const startedPromise = new Promise(resolve => { started = resolve; });
      const releasePromise = new Promise(resolve => { release = resolve; });
      const exclusive = backend.exclusive(async () => { started(); await releasePromise; });
      await startedPromise;
      const pending = good(b, '/api/customers', 'POST', { name: '备份后提交客户' }).then(value => { written = true; return value; });
      await new Promise(resolve => setTimeout(resolve, 20));
      assert.equal(written, false);
      release(); await exclusive;
      assert.equal((await pending).customer.ownerId, state.b.id);
    });
    await step('同一SQLite保报价，原图经加密传输，其他员工不可看且logout彼此独立', async () => {
      state.quote = (await good(a, '/api/quotes', 'POST', { type: 'sale', customerId: state.customerA.id, title: '局域网铂金戒指', material: 'Pt950', weight: 3, goldPrice: 450, laborPrice: 80, extras: [{ id: 'diamond', name: '钻石', amount: 900 }] })).quote;
      assert.equal(state.quote.total, 2490);
      const query = '/api/quotes?' + new URLSearchParams({ search: '局域网', type: 'sale', page: '1', pageSize: '20' });
      assert.equal((await good(a, query)).quotes[0].id, state.quote.id);
      const saved = (await good(a, '/api/quotes/' + state.quote.id + '/images', 'POST', { images: ['data:image/png;base64,' + png.toString('base64')] })).quote;
      state.imageId = saved.images[0].split('/').pop();
      const ownImage = await a.imageResponse(state.imageId); assert.equal(ownImage.status, 200); assert.deepEqual(Buffer.from(await ownImage.arrayBuffer()), png);
      assert.equal((await b.imageResponse(state.imageId)).status, 404);
      assert.equal((await b.dispatch({ path: '/api/quotes/' + state.quote.id })).status, 404);
      await good(a, '/auth/logout', 'POST'); assert.equal((await a.imageResponse(state.imageId)).status, 401);
      assert.equal((await good(b, '/auth/status')).authenticated, true);
      assert.equal((await backend.imageResponse(state.imageId)).status, 200);
    });
    await step('重置A密码撤销A旧token和原图访问，B及主机管理员仍保持登录', async () => {
      await good(a, '/auth/login', 'POST', { username: 'worker_a', password: workerPassword });
      state.aPassword = 'Lan.Changed-472!';
      assert.equal((await backend.dispatch({ path: '/api/users', method: 'PATCH', body: { id: state.a.id, password: state.aPassword } })).ok, true);
      assert.equal((await a.imageResponse(state.imageId)).status, 401);
      assert.equal((await a.dispatch({ path: '/api/bootstrap' })).status, 401);
      assert.equal((await a.dispatch({ path: '/auth/login', method: 'POST', body: { username: 'worker_a', password: workerPassword } })).status, 401);
      assert.equal((await good(b, '/auth/status')).authenticated, true);
      assert.equal(backend.auth.status().user.username, 'admin');
      await good(a, '/auth/login', 'POST', { username: 'worker_a', password: state.aPassword });
    });
    await step('主机停用员工后其已有局域网会话立即失效', async () => {
      assert.equal((await backend.dispatch({ path: '/api/users', method: 'PATCH', body: { id: state.b.id, active: false } })).ok, true);
      assert.equal((await b.dispatch({ path: '/api/bootstrap' })).status, 401);
      assert.equal((await b.dispatch({ path: '/auth/login', method: 'POST', body: { username: 'worker_b', password: workerPassword } })).status, 401);
    });
    await step('停止服务清会话，断线明确失败，管理员保存模式允许开机恢复但须重新登录', async () => {
      await good(a, '/auth/login', 'POST', { username: 'worker_a', password: state.aPassword });
      const previousPort = server.port, code = server.code, identity = server.identity;
      await server.stop(); assert.equal((await a.dispatch({ path: '/api/bootstrap' })).status, 503);
      await backend.dispatch({ path: '/auth/logout', method: 'POST' });
      await assert.rejects(startLanServer({ backend, host: '127.0.0.1', port: previousPort, code }), /管理员/);
      server = await startLanServer({ backend, host: '127.0.0.1', port: previousPort, code, identity, resume: true });
      assert.equal((await a.dispatch({ path: '/api/bootstrap' })).status, 401);
      await good(a, '/auth/login', 'POST', { username: 'worker_a', password: state.aPassword });
      assert.equal((await good(a, '/api/quotes/' + state.quote.id)).quote.id, state.quote.id);
      assert.equal((await a.imageResponse(state.imageId)).status, 200);
    });
  } finally {
    await Promise.all([a?.close(), b?.close(), wrong?.close()]);
    await server?.stop(); await backend.close();
  }
});

test('局域网公钥身份持久与指纹配对，伪公钥不能诱骗发送账号密码', async () => {
  fs.mkdirSync(dataRoot, { recursive: true });
  const directory = fs.mkdtempSync(path.join(dataRoot, 'identity-')), identityFile = path.join(directory, 'profile', 'identity.json');
  const backend = createBackend({ dataDir: path.join(directory, 'data'), migrationDir });
  await backend.dispatch({ path: '/auth/setup', method: 'POST', body: { username: 'admin', password: 'Identity.Password-438!' } });
  let server, client, spoof, fakeClient;
  try {
    server = await startLanServer({ backend, host: '127.0.0.1', port: 0, identityFile });
    const expectedCode = createHash('sha256').update(Buffer.from(server.identity.publicKey, 'base64url')).digest().subarray(0, 24).toString('base64url');
    assert.equal(server.code, expectedCode); assert.ok(fs.existsSync(identityFile));
    const saved = fs.readFileSync(identityFile, 'utf8'), previousCode = server.code;
    await server.stop();
    server = await startLanServer({ backend, host: '127.0.0.1', port: 0, identityFile, code: previousCode, resume: true });
    assert.equal(server.code, previousCode); assert.equal(fs.readFileSync(identityFile, 'utf8'), saved);
    await assert.rejects(startLanServer({ backend, host: '127.0.0.1', port: 0, identityFile, code: 'a'.repeat(32), resume: true }), /身份/);
    client = createLanClient(server); assert.equal((await client.dispatch({ path: '/auth/status' })).ok, true);
    const fakePublic = generateKeyPairSync('x25519').publicKey.export({ type: 'spki', format: 'der' }).toString('base64url');
    let passwordPackets = 0;
    spoof = http.createServer((request, response) => { if (request.method === 'POST') passwordPackets++; response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ version: 1, publicKey: fakePublic })); request.resume(); });
    await new Promise(resolve => spoof.listen(0, '127.0.0.1', resolve));
    fakeClient = createLanClient({ host: '127.0.0.1', port: spoof.address().port, code: previousCode });
    const rejected = await fakeClient.dispatch({ path: '/auth/login', method: 'POST', body: { username: 'admin', password: 'Identity.Password-438!' } });
    assert.equal(rejected.status, 403); assert.equal(passwordPackets, 0, '错误公钥时只能获取公开身份，不能发送加密登录包');
  } finally { await client?.close(); await fakeClient?.close(); await server?.stop(); if (spoof) await new Promise(resolve => spoof.close(resolve)); await backend.close(); }
});

test('网络故障时退出登录仍清本机token，恢复连接不会自动恢复旧账号', async () => {
  fs.mkdirSync(dataRoot, { recursive: true }); const directory = fs.mkdtempSync(path.join(dataRoot, 'logout-'));
  const backend = createBackend({ dataDir: directory, migrationDir });
  await backend.dispatch({ path: '/auth/setup', method: 'POST', body: { username: 'admin', password: 'Logout.Password-361!' } });
  const server = await startLanServer({ backend, host: '127.0.0.1', port: 0 }), client = createLanClient(server);
  const original = http.request;
  try {
    assert.equal((await client.dispatch({ path: '/auth/login', method: 'POST', body: { username: 'admin', password: 'Logout.Password-361!' } })).ok, true);
    http.request = () => { throw new Error('fixture network failure'); };
    assert.equal((await client.dispatch({ path: '/auth/logout', method: 'POST' })).status, 503);
    http.request = original;
    const status = await client.dispatch({ path: '/auth/status' }); assert.equal(status.ok, true); assert.equal(status.data.authenticated, false);
  } finally { http.request = original; await client.close(); await server.stop(); await backend.close(); }
});

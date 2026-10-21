'use strict';

const http = require('node:http');
const os = require('node:os');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, randomUUID, createHash, createCipheriv, createDecipheriv, createPublicKey, createPrivateKey, generateKeyPairSync, diffieHellman, hkdfSync } = require('node:crypto');

const ENDPOINT = '/jewelry-lan';
const IDENTITY_ENDPOINT = '/jewelry-identity';
const MAX_WIRE_BYTES = 64 * 1024 * 1024;
const TIME_WINDOW_MS = 5 * 60 * 1000;
const SESSION_IDLE_MS = 12 * 60 * 60 * 1000;
const AAD = direction => Buffer.from('xjy-lan-v1:' + direction);
const errorResult = (status, error) => ({ ok: false, status, data: { error } });

function privateIPv4(address) {
  if (typeof address !== 'string') return false;
  const value = address.startsWith('::ffff:') ? address.slice(7) : address;
  if (net.isIP(value) !== 4) return false;
  const bytes = value.split('.').map(Number);
  return bytes[0] === 10 || bytes[0] === 192 && bytes[1] === 168 || bytes[0] === 172 && bytes[1] >= 16 && bytes[1] <= 31 || bytes[0] === 127;
}
function localAddresses() {
  return [...new Set(Object.values(os.networkInterfaces()).flat().filter(item => item && item.family === 'IPv4' && privateIPv4(item.address)).map(item => item.address))];
}
function validateHost(host, local = false) {
  if (!privateIPv4(host) || host.startsWith('::')) throw new Error('主机地址须为局域网 IPv4 地址，不能填写互联网地址或域名');
  if (local && !localAddresses().includes(host)) throw new Error('请选择这台电脑的局域网 IPv4 地址');
  return host;
}
function validatePort(port, server = false) {
  if (!Number.isInteger(port) || port < (server ? 0 : 1) || port > 65535) throw new Error('端口须为1至65535的整数');
  return port;
}
function validatePin(code) {
  if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{32}$/.test(code)) throw new Error('请填写主机显示的完整连接码');
  return code;
}
const publicPin = der => createHash('sha256').update(der).digest().subarray(0, 24).toString('base64url');
function publicObject(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{40,128}$/.test(value)) throw new Error('主机身份或连接通信无效');
  const key = createPublicKey({ key: Buffer.from(value, 'base64url'), format: 'der', type: 'spki' });
  if (key.asymmetricKeyType !== 'x25519') throw new Error('主机身份或连接通信无效');
  return key;
}
function keyFrom(privateKey, publicKey, serverDER, ephemeralDER) {
  const secret = diffieHellman({ privateKey, publicKey });
  const salt = createHash('sha256').update(serverDER).update(ephemeralDER).digest();
  return Buffer.from(hkdfSync('sha256', secret, salt, 'xjy-lan-v1-x25519-aes256gcm', 32));
}
function serverIdentity(identityFile, supplied) {
  const existed = Boolean(supplied || identityFile && fs.existsSync(identityFile));
  let value = supplied;
  if (!value && identityFile && existed) {
    const bytes = fs.readFileSync(identityFile); if (bytes.length > 8192) throw new Error('主机身份文件无效');
    value = JSON.parse(bytes.toString('utf8'));
  }
  if (!value) {
    const pair = generateKeyPairSync('x25519');
    value = { version: 1, privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64url'), publicKey: pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url') };
  }
  if (value.version !== 1 || typeof value.privateKey !== 'string' || !/^[A-Za-z0-9_-]{40,128}$/.test(value.privateKey)) throw new Error('主机身份文件无效');
  const privateKey = createPrivateKey({ key: Buffer.from(value.privateKey, 'base64url'), type: 'pkcs8', format: 'der' });
  const publicKey = publicObject(value.publicKey);
  const publicDER = publicKey.export({ type: 'spki', format: 'der' });
  if (privateKey.asymmetricKeyType !== 'x25519' || !createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).equals(publicDER)) throw new Error('主机身份文件的密钥不匹配');
  if (identityFile && !existed) {
    fs.mkdirSync(path.dirname(identityFile), { recursive: true });
    const temporary = identityFile + '.' + randomUUID() + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 }); fs.renameSync(temporary, identityFile);
  }
  return { identity: { ...value }, privateKey, publicDER, code: publicPin(publicDER), existed };
}
function encrypt(key, value, direction, publicKey) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(AAD(direction));
  const bytes = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  const result = JSON.stringify({ ...(publicKey ? { publicKey } : {}), iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), data: bytes.toString('base64url') });
  if (Buffer.byteLength(result) > MAX_WIRE_BYTES) throw new Error('局域网内容超过64MB，请减少图片后重试');
  return result;
}
function decrypt(key, text, direction) {
  const value = typeof text === 'string' ? JSON.parse(text) : text;
  if (!value || typeof value !== 'object' || !/^[A-Za-z0-9_-]{16}$/.test(value.iv) || !/^[A-Za-z0-9_-]{22}$/.test(value.tag) || typeof value.data !== 'string' || !/^[A-Za-z0-9_-]*$/.test(value.data)) throw new Error('连接码不正确或通信内容无效');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(value.iv, 'base64url'));
  decipher.setAAD(AAD(direction));
  decipher.setAuthTag(Buffer.from(value.tag, 'base64url'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.data, 'base64url')), decipher.final()]).toString('utf8'));
}

async function startLanServer({ backend, host, port = 31831, code, resume = false, identityFile, identity }) {
  validateHost(host, true); validatePort(port, true);
  if (resume !== true && backend.auth.status().user?.role !== 'admin') throw new Error('请先由本机管理员登录并启用局域网主机');
  const credentials = serverIdentity(identityFile, identity);
  if (credentials.existed && code !== undefined && validatePin(code) !== credentials.code) throw new Error('连接码与保存的主机身份不一致，请核对主机连接码');
  code = credentials.code;
  const tokens = new Map(), replay = new Map(), sockets = new Set(), inflight = new Set();
  let stopped = false;
  async function retire(token) {
    const value = tokens.get(token);
    if (value) { tokens.delete(token); await value.session.close(); }
  }
  async function operation(packet, peer) {
    if (stopped) return { result: errorResult(503, '局域网主机已停止') };
    if (!packet || typeof packet !== 'object' || !/^[a-f0-9-]{36}$/.test(packet.id) || !Number.isFinite(packet.timestamp)) return { result: errorResult(400, '局域网请求格式无效') };
    const now = Date.now();
    if (Math.abs(now - packet.timestamp) > TIME_WINDOW_MS) return { result: errorResult(400, '主机与客户端时间相差超过5分钟，请校准电脑时间后重试') };
    for (const [id, time] of replay) if (now - time > TIME_WINDOW_MS * 2) replay.delete(id);
    if (replay.has(packet.id)) return { result: errorResult(409, '重复请求已拒绝，请重新操作') };
    if (replay.size >= 10000) return { result: errorResult(429, '局域网请求过于频繁，请稍后重试') };
    replay.set(packet.id, now);
    for (const [token, entry] of tokens) if (now - entry.usedAt > SESSION_IDLE_MS) await retire(token);
    if (!['request', 'image'].includes(packet.op)) return { result: errorResult(400, '局域网操作无效') };
    const token = typeof packet.token === 'string' ? packet.token : '';
    const entry = token ? tokens.get(token) : null;
    if (entry && entry.peer !== peer) return { result: errorResult(401, '账号会话无效，请重新登录') };
    if (entry) entry.usedAt = now;
    if (packet.op === 'image') {
      if (!entry) return { result: errorResult(401, '请先登录局域网账号') };
      const response = await entry.session.imageResponse(packet.imageId);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (response.status === 401) await retire(token);
      return { result: { ok: response.ok, status: response.status }, image: { bytes: bytes.toString('base64'), headers: Object.fromEntries(response.headers) } };
    }
    const input = packet.input;
    if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.path !== 'string') return { result: errorResult(400, '局域网请求格式无效') };
    if (input.path.length > 2500 || input.path.includes('\\') || !/^\/(?:api|auth)(?:\/|$)/.test(input.path)) return { result: errorResult(400, '局域网请求地址无效') };
    let address;
    try { address = new URL(input.path, 'http://offline.invalid'); } catch { return { result: errorResult(400, '局域网请求地址无效') }; }
    // Route policy must use the same canonical path as backend.handle. Reject
    // dot segments, encoded dot aliases and fragments before applying it.
    if (address.origin !== 'http://offline.invalid' || address.hash || address.pathname + address.search !== input.path) return { result: errorResult(400, '局域网请求地址须为规范地址') };
    const method = String(input.method || 'GET').toUpperCase(), pathname = address.pathname;
    if (pathname === '/auth/setup') return { result: errorResult(403, '首次管理员须在主机电脑上创建') };
    if (pathname === '/auth/login' && method === 'POST') {
      if (token) await retire(token);
      if (tokens.size >= 100) return { result: errorResult(503, '局域网登录数量已达上限，请稍后重试') };
      const session = backend.createSession();
      const result = await session.dispatch(input);
      if (!result.ok || !result.data.authenticated) { await session.close(); return { result }; }
      if (stopped) { await session.close(); return { result: errorResult(503, '局域网主机已停止') }; }
      const freshToken = randomBytes(32).toString('base64url');
      tokens.set(freshToken, { session, peer, usedAt: now });
      return { result, token: freshToken };
    }
    if (pathname === '/auth/status' && method === 'GET' && !token) return { result: { ok: true, status: 200, data: { needsSetup: backend.auth.status().needsSetup, authenticated: false } } };
    if (pathname === '/auth/logout' && method === 'POST') {
      if (token) await retire(token);
      return { result: { ok: true, status: 200, data: { needsSetup: backend.auth.status().needsSetup, authenticated: false } }, token: null };
    }
    if (!entry) return { result: errorResult(401, '账号会话已结束，请重新登录') };
    const result = await entry.session.dispatch(input);
    if (result.status === 401) await retire(token);
    return { result };
  }
  const server = http.createServer((request, response) => {
    const peer = request.socket.remoteAddress || '';
    let requestKey = null;
    const plain = (value, status = 200) => {
      const content = JSON.stringify(value);
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(content), 'X-Content-Type-Options': 'nosniff' }); response.end(content);
    };
    const respond = (value, status = 200) => {
      if (response.destroyed || response.writableEnded) return;
      // Public identity and invalid transport rejection contain no business data.
      // Every valid request's result uses its independently derived ECDH key.
      if (!requestKey) { plain({ error: value.result?.data?.error || '连接通信无效' }, status); return; }
      const content = encrypt(requestKey, value, 'response');
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(content), 'X-Content-Type-Options': 'nosniff' });
      response.end(content);
    };
    if (stopped || !privateIPv4(peer)) { respond({ requestId: null, result: errorResult(403, '仅允许局域网连接') }, 403); request.resume(); return; }
    if (request.method === 'GET' && request.url === IDENTITY_ENDPOINT) { plain({ version: 1, publicKey: credentials.identity.publicKey }); request.resume(); return; }
    if (request.method !== 'POST' || request.url !== ENDPOINT) { respond({ requestId: null, result: errorResult(404, '连接入口无效') }, 404); request.resume(); return; }
    const declared = Number(request.headers['content-length'] || 0);
    if (declared > MAX_WIRE_BYTES) { respond({ requestId: null, result: errorResult(413, '局域网内容超过64MB') }, 413); request.resume(); return; }
    let size = 0, exceeded = false;
    const chunks = [];
    request.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_WIRE_BYTES) { exceeded = true; chunks.length = 0; respond({ requestId: null, result: errorResult(413, '局域网内容超过64MB') }, 413); }
      else if (!exceeded) chunks.push(chunk);
    });
    request.on('error', () => { if (!response.writableEnded) response.destroy(); });
    request.on('end', () => {
      const task = (async () => {
      if (exceeded || response.writableEnded) return;
      let packet;
      try {
        const envelope = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const ephemeral = publicObject(envelope.publicKey), ephemeralDER = ephemeral.export({ type: 'spki', format: 'der' });
        requestKey = keyFrom(credentials.privateKey, ephemeral, credentials.publicDER, ephemeralDER);
        packet = decrypt(requestKey, envelope, 'request');
      } catch { respond({ requestId: null, result: errorResult(403, '通信内容无效或主机身份已经变更') }, 403); return; }
      try { respond({ requestId: packet.id, ...await operation(packet, peer) }); }
      catch { respond({ requestId: packet?.id, result: errorResult(503, '主机操作未完成，请稍后重试') }, 503); }
      })();
      inflight.add(task); task.finally(() => inflight.delete(task)).catch(() => {});
    });
  });
  server.requestTimeout = 60000;
  server.headersTimeout = 10000;
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen({ host, port, exclusive: true }, () => { server.removeListener('error', reject); resolve(); }); });
  server.on('error', () => {});
  return {
    host, port: server.address().port, code, identity: credentials.identity,
    async stop() {
      if (stopped) return;
      stopped = true;
      const done = new Promise(resolve => server.close(resolve));
      for (const socket of sockets) socket.destroy();
      await done;
      await Promise.allSettled([...inflight]);
      await Promise.all([...tokens.keys()].map(retire));
      replay.clear();
    },
  };
}

function createLanClient({ host, port = 31831, code, timeoutMs = 30000 }) {
  validateHost(host); validatePort(port);
  validatePin(code);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > 120000) throw new Error('连接超时时间无效');
  let token = null, closed = false, connected = false, queue = Promise.resolve();
  const active = new Set();
  let identity = null, identityPending = null;
  async function verifiedIdentity(requestTimeout) {
    if (identity) return identity;
    if (identityPending) return identityPending;
    identityPending = new Promise((resolve, reject) => {
      const request = http.request({ host, port, method: 'GET', path: IDENTITY_ENDPOINT, family: 4, agent: false }, response => {
        const chunks = []; let size = 0;
        response.on('data', chunk => { size += chunk.length; if (size > 8192) { response.destroy(); reject(new Error('连接码或主机身份无效')); } else chunks.push(chunk); });
        response.on('error', reject);
        response.on('end', () => {
          try {
            if (response.statusCode !== 200) throw new Error('主机身份不可读取');
            const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (value.version !== 1) throw new Error('主机身份版本无效');
            const publicKey = publicObject(value.publicKey), publicDER = publicKey.export({ type: 'spki', format: 'der' });
            if (publicPin(publicDER) !== code) throw new Error('连接码与主机身份不一致，请重新核对连接码');
            identity = { publicKey, publicDER }; resolve(identity);
          } catch { reject(new Error('连接码与主机身份不一致，请重新核对连接码')); }
        });
      });
      active.add(request); request.once('close', () => active.delete(request));
      request.setTimeout(requestTimeout, () => request.destroy(new Error('局域网连接超时'))); request.once('error', reject); request.end();
    }).finally(() => { identityPending = null; });
    return identityPending;
  }
  async function transport(packet, requestTimeout = timeoutMs, allowClosed = false) {
    if (closed && !allowClosed) throw new Error('局域网连接已关闭');
    const serverIdentity = await verifiedIdentity(requestTimeout);
    if (closed && !allowClosed) throw new Error('局域网连接已关闭');
    const ephemeral = generateKeyPairSync('x25519'), publicDER = ephemeral.publicKey.export({ type: 'spki', format: 'der' });
    const key = keyFrom(ephemeral.privateKey, serverIdentity.publicKey, serverIdentity.publicDER, publicDER);
    return new Promise((resolve, reject) => {
      let content;
      try { content = encrypt(key, packet, 'request', publicDER.toString('base64url')); } catch (error) { reject(error); return; }
      const request = http.request({ host, port, method: 'POST', path: ENDPOINT, family: 4, agent: false, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(content) } }, response => {
        const chunks = []; let size = 0;
        response.on('data', chunk => { size += chunk.length; if (size > MAX_WIRE_BYTES) { response.destroy(); reject(new Error('局域网响应超过64MB')); } else chunks.push(chunk); });
        response.on('error', reject);
        response.on('end', () => {
          try {
            const result = decrypt(key, Buffer.concat(chunks).toString('utf8'), 'response');
            if (result.requestId !== packet.id) throw new Error('连接码不正确或主机响应无效');
            resolve(result);
          } catch { reject(new Error('连接码不正确或主机响应无效')); }
        });
      });
      active.add(request); request.once('close', () => active.delete(request));
      request.setTimeout(requestTimeout, () => request.destroy(new Error('局域网连接超时')));
      request.once('error', reject);
      request.end(content);
    });
  }
  async function perform(op, input) {
    if (closed) return { result: errorResult(503, '局域网连接已经关闭') };
    const packet = { id: randomUUID(), timestamp: Date.now(), token, op, ...(op === 'image' ? { imageId: input } : { input }) };
    if (op === 'request' && input?.path?.split('?')[0] === '/auth/logout') token = null;
    try {
      const value = await transport(packet);
      connected = true;
      if ('token' in value) token = value.token;
      if (value.result.status === 401) token = null;
      if (op === 'request' && input?.path === '/auth/login' && !value.result.ok) token = null;
      return value;
    } catch (error) {
      connected = false;
      if (/连接码/.test(error.message)) { token = null; return { result: errorResult(403, error.message) }; }
      return { result: errorResult(/64MB/.test(error.message) ? 413 : 503, /64MB/.test(error.message) ? error.message : '无法连接局域网主机，请确认主机程序已开启、地址端口正确且电脑在同一局域网') };
    }
  }
  function enqueue(action) { const pending = queue.then(action); queue = pending.catch(() => {}); return pending; }
  return {
    get connected() { return connected && !closed; },
    dispatch(input) { return enqueue(async () => (await perform('request', input)).result); },
    imageResponse(id) {
      return enqueue(async () => {
        const response = await perform('image', String(id));
        if (response.image) return new Response(Buffer.from(response.image.bytes, 'base64'), { status: response.result.status, headers: response.image.headers });
        return Response.json(response.result.data || { error: '图片读取失败' }, { status: response.result.status });
      });
    },
    async close() {
      if (closed) return;
      const oldToken = token, wasConnected = connected;
      closed = true; connected = false; token = null;
      for (const request of active) request.destroy();
      if (oldToken && wasConnected) {
        try { await transport({ id: randomUUID(), timestamp: Date.now(), token: oldToken, op: 'request', input: { path: '/auth/logout', method: 'POST' } }, 1000, true); } catch { /* Host might already have stopped; no local data is changed. */ }
      }
    },
  };
}

module.exports = { startLanServer, createLanClient, localAddresses, privateIPv4, isPrivateIPv4: privateIPv4 };

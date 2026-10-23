'use strict';

const http = require('node:http');
const os = require('node:os');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, randomUUID, createHash, createCipheriv, createDecipheriv, createPublicKey, createPrivateKey, generateKeyPairSync, diffieHellman, hkdfSync } = require('node:crypto');

const ENDPOINT = '/jewelry-lan';
const IDENTITY_ENDPOINT = '/jewelry-identity';
const MAX_WIRE_BYTES = 128 * 1024 * 1024;
const RESOURCE_LIMITS = Object.freeze({
  replayGlobalEntries: 10000, replayPeerEntries: 1000,
  anonymousReplayGlobalEntries: 2048, anonymousReplayPeerEntries: 256,
  maxConnections: 64, maxPeerConnections: 24,
  maxRequests: 64, maxPeerRequests: 16,
  maxBufferedBytes: 256 * 1024 * 1024, maxPeerBufferedBytes: 128 * 1024 * 1024,
  bodyTimeoutMs: 60000,
});
const TIME_WINDOW_MS = 5 * 60 * 1000;
const SESSION_IDLE_MS = 12 * 60 * 60 * 1000;
const AAD = direction => Buffer.from('xjy-lan-v1:' + direction);
const errorResult = (status, error) => ({ ok: false, status, data: { error } });
const sizeError = message => Object.assign(new Error(message), { status: 413, code: 'LAN_SIZE_LIMIT' });

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
  if (Buffer.byteLength(result) > MAX_WIRE_BYTES) throw sizeError('局域网内容超过128MB，请减少图片后重试');
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
  const tokens = new Map(), replay = new Map(), anonymousReplay = new Map(), sockets = new Set(), inflight = new Set();
  const replayPeers = new Map(), anonymousReplayPeers = new Map(), resourcePeers = new Map(), socketLeases = new Map();
  const resources = { requests: 0, bytes: 0 };
  let stopped = false;
  function peerResources(peer) {
    let value = resourcePeers.get(peer);
    if (!value) { value = { connections: 0, requests: 0, bytes: 0 }; resourcePeers.set(peer, value); }
    return value;
  }
  function discardPeer(peer, value) {
    if (!value.connections && !value.requests && !value.bytes) resourcePeers.delete(peer);
  }
  function pruneReplay(entries, peers, now) {
    for (const [id, entry] of entries) {
      if (now - entry.time <= TIME_WINDOW_MS * 2) continue;
      entries.delete(id);
      const count = peers.get(entry.peer) - 1;
      if (count) peers.set(entry.peer, count); else peers.delete(entry.peer);
    }
  }
  function rememberRequest(packet, peer, now, authenticated) {
    // Idle-session retirement may await; repeat this check at the atomic insert.
    if (replay.has(packet.id) || anonymousReplay.has(packet.id)) return { result: errorResult(409, '重复请求已拒绝，请重新操作') };
    const entries = authenticated ? replay : anonymousReplay;
    const peers = authenticated ? replayPeers : anonymousReplayPeers;
    const globalLimit = authenticated ? RESOURCE_LIMITS.replayGlobalEntries : RESOURCE_LIMITS.anonymousReplayGlobalEntries;
    const peerLimit = authenticated ? RESOURCE_LIMITS.replayPeerEntries : RESOURCE_LIMITS.anonymousReplayPeerEntries;
    const count = peers.get(peer) || 0;
    if (count >= peerLimit || entries.size >= globalLimit) return { result: errorResult(429, '局域网请求过于频繁，请稍后重试') };
    entries.set(packet.id, { time: now, peer }); peers.set(peer, count + 1);
    return null;
  }
  async function retire(token) {
    const value = tokens.get(token);
    if (value) { tokens.delete(token); await value.session.close(); }
  }
  async function operation(packet, peer) {
    if (stopped) return { result: errorResult(503, '局域网主机已停止') };
    if (!packet || typeof packet !== 'object' || Array.isArray(packet) || !/^[a-f0-9-]{36}$/.test(packet.id) || !Number.isFinite(packet.timestamp)) return { result: errorResult(400, '局域网请求格式无效') };
    const now = Date.now();
    if (Math.abs(now - packet.timestamp) > TIME_WINDOW_MS) return { result: errorResult(400, '主机与客户端时间相差超过5分钟，请校准电脑时间后重试') };
    if (!['request', 'image'].includes(packet.op)) return { result: errorResult(400, '局域网操作无效') };
    let input, method, pathname;
    if (packet.op === 'request') {
      input = packet.input;
      if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.path !== 'string') return { result: errorResult(400, '局域网请求格式无效') };
      if (input.path.length > 2500 || input.path.includes('\\') || !/^\/(?:api|auth)(?:\/|$)/.test(input.path)) return { result: errorResult(400, '局域网请求地址无效') };
      let address;
      try { address = new URL(input.path, 'http://offline.invalid'); } catch { return { result: errorResult(400, '局域网请求地址无效') }; }
      // Use backend.handle's canonical path before admitting any replay entry.
      if (address.origin !== 'http://offline.invalid' || input.path.includes('#') || address.pathname !== input.path.split('?')[0]) return { result: errorResult(400, '局域网请求地址须为规范地址') };
      method = String(input.method || 'GET').toUpperCase(); pathname = address.pathname;
      if (pathname === '/auth/setup') return { result: errorResult(403, '首次管理员须在主机电脑上创建') };
    }
    pruneReplay(replay, replayPeers, now); pruneReplay(anonymousReplay, anonymousReplayPeers, now);
    if (replay.has(packet.id) || anonymousReplay.has(packet.id)) return { result: errorResult(409, '重复请求已拒绝，请重新操作') };
    for (const [oldToken, oldEntry] of tokens) if (now - oldEntry.usedAt > SESSION_IDLE_MS) await retire(oldToken);
    const token = typeof packet.token === 'string' ? packet.token : '';
    const entry = token ? tokens.get(token) : null;
    if (entry && entry.peer !== peer) return { result: errorResult(401, '账号会话无效，请重新登录') };
    if (packet.op === 'image') {
      if (!entry) return { result: errorResult(401, '请先登录局域网账号') };
      const denied = rememberRequest(packet, peer, now, true); if (denied) return denied;
      entry.usedAt = now;
      const response = await entry.session.imageResponse(packet.imageId);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (response.status === 401) await retire(token);
      return { result: { ok: response.ok, status: response.status }, image: { bytes: bytes.toString('base64'), headers: Object.fromEntries(response.headers) } };
    }
    if (pathname === '/auth/login' && method === 'POST') {
      const denied = rememberRequest(packet, peer, now, false); if (denied) return denied;
      if (token) await retire(token);
      if (tokens.size >= 100) return { result: errorResult(503, '局域网登录数量已达上限，请稍后重试') };
      const session = backend.createSession({ sourcePeer: peer });
      const result = await session.dispatch(input);
      if (!result.ok || !result.data.authenticated) { await session.close(); return { result }; }
      if (stopped) { await session.close(); return { result: errorResult(503, '局域网主机已停止') }; }
      const freshToken = randomBytes(32).toString('base64url');
      tokens.set(freshToken, { session, peer, usedAt: now });
      return { result, token: freshToken };
    }
    if (pathname === '/auth/status' && method === 'GET' && !token) {
      const denied = rememberRequest(packet, peer, now, false); if (denied) return denied;
      return { result: { ok: true, status: 200, data: { needsSetup: backend.auth.status().needsSetup, authenticated: false } } };
    }
    if (pathname === '/auth/logout' && method === 'POST') {
      const denied = rememberRequest(packet, peer, now, Boolean(entry)); if (denied) return denied;
      if (token) await retire(token);
      return { result: { ok: true, status: 200, data: { needsSetup: backend.auth.status().needsSetup, authenticated: false } }, token: null };
    }
    if (!entry) return { result: errorResult(401, '账号会话已结束，请重新登录') };
    const denied = rememberRequest(packet, peer, now, true); if (denied) return denied;
    entry.usedAt = now;
    const result = await entry.session.dispatch(input);
    if (result.status === 401) await retire(token);
    return { result };
  }
  const server = http.createServer((request, response) => {
    const peer = request.socket.remoteAddress || '';
    let requestKey = null, cancel = null;
    const plain = (value, status = 200) => {
      const content = JSON.stringify(value);
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(content), 'X-Content-Type-Options': 'nosniff', Connection: 'close' }); response.end(content);
    };
    const respond = (value, status = 200) => {
      if (response.destroyed || response.writableEnded) return;
      // Public identity and invalid transport rejection contain no business data.
      // Every valid request's result uses its independently derived ECDH key.
      if (!requestKey) { plain({ error: value.result?.data?.error || '连接通信无效' }, status); return; }
      const content = encrypt(requestKey, value, 'response');
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(content), 'X-Content-Type-Options': 'nosniff', Connection: 'close' });
      response.end(content);
    };
    request.on('error', () => { if (cancel) cancel(); if (!response.writableEnded) response.destroy(); });
    request.on('close', () => { if (!request.complete && cancel) cancel(); });
    if (stopped || !privateIPv4(peer)) { respond({ requestId: null, result: errorResult(403, '仅允许局域网连接') }, 403); request.resume(); return; }
    if (request.method === 'GET' && request.url === IDENTITY_ENDPOINT) { plain({ version: 1, publicKey: credentials.identity.publicKey }); request.resume(); return; }
    if (request.method !== 'POST' || request.url !== ENDPOINT) { respond({ requestId: null, result: errorResult(404, '连接入口无效') }, 404); request.resume(); return; }
    const declared = Number(request.headers['content-length'] || 0);
    if (!Number.isSafeInteger(declared) || declared < 0) { respond({ result: errorResult(400, '局域网内容长度无效') }, 400); request.resume(); return; }
    if (declared > MAX_WIRE_BYTES) { respond({ requestId: null, result: errorResult(413, '局域网内容超过128MB') }, 413); request.resume(); return; }
    const peerState = peerResources(peer);
    if (resources.requests >= RESOURCE_LIMITS.maxRequests || peerState.requests >= RESOURCE_LIMITS.maxPeerRequests) {
      respond({ result: errorResult(503, '局域网主机繁忙，请稍后重试') }, 503); request.resume(); return;
    }
    resources.requests++; peerState.requests++;
    let size = 0, reserved = 0, receiving = true, running = false, cancelled = false, released = false, timer = null;
    const chunks = [];
    const release = () => {
      if (released) return;
      released = true; receiving = false; clearTimeout(timer); chunks.length = 0;
      resources.requests--; peerState.requests--; resources.bytes -= reserved; peerState.bytes -= reserved;
      socketLeases.get(request.socket)?.delete(cancel); discardPeer(peer, peerState);
    };
    cancel = () => {
      cancelled = true; receiving = false; clearTimeout(timer); chunks.length = 0;
      // A disconnected caller cannot cancel a business dispatch already begun.
      // Keep its memory/request reservation until that dispatch's finally.
      if (!running) release();
    };
    socketLeases.get(request.socket)?.add(cancel);
    response.once('finish', () => { if (!running) release(); });
    response.once('close', cancel);
    const reserve = total => {
      const additional = Math.max(0, total - reserved);
      if (resources.bytes + additional > RESOURCE_LIMITS.maxBufferedBytes || peerState.bytes + additional > RESOURCE_LIMITS.maxPeerBufferedBytes) return false;
      resources.bytes += additional; peerState.bytes += additional; reserved += additional; return true;
    };
    const rejectBody = (status, message) => {
      if (!receiving) return;
      receiving = false; release();
      respond({ requestId: null, result: errorResult(status, message) }, status); request.resume();
    };
    // Reserve declared bytes before retaining any data. Chunked requests reserve
    // incrementally below. Hold the lease through concat/decrypt and dispatch.
    if (!reserve(declared)) { rejectBody(503, '局域网主机繁忙，请稍后重试'); return; }
    timer = setTimeout(() => rejectBody(408, '局域网内容接收超时，请检查网络后重试'), RESOURCE_LIMITS.bodyTimeoutMs);
    timer.unref?.();
    request.on('data', chunk => {
      if (!receiving) return;
      size += chunk.length;
      if (size > MAX_WIRE_BYTES) { rejectBody(413, '局域网内容超过128MB'); return; }
      if (!reserve(size)) { rejectBody(503, '局域网主机繁忙，请稍后重试'); return; }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (!receiving || cancelled || response.writableEnded || response.destroyed) return;
      receiving = false; running = true; clearTimeout(timer);
      const task = (async () => {
      let packet;
      try {
        const text = Buffer.concat(chunks, size).toString('utf8'); chunks.length = 0;
        const envelope = JSON.parse(text);
        const ephemeral = publicObject(envelope.publicKey), ephemeralDER = ephemeral.export({ type: 'spki', format: 'der' });
        requestKey = keyFrom(credentials.privateKey, ephemeral, credentials.publicDER, ephemeralDER);
        packet = decrypt(requestKey, envelope, 'request');
      } catch { respond({ requestId: null, result: errorResult(403, '通信内容无效或主机身份已经变更') }, 403); return; }
      try { respond({ requestId: packet?.id, ...await operation(packet, peer) }); }
      catch { respond({ requestId: packet?.id, result: errorResult(503, '主机操作未完成，请稍后重试') }, 503); }
      })().finally(() => { running = false; release(); });
      inflight.add(task); task.finally(() => inflight.delete(task)).catch(() => {});
    });
  });
  server.requestTimeout = 60000;
  server.headersTimeout = 10000;
  server.on('connection', socket => {
    const peer = socket.remoteAddress || '';
    if (stopped || !privateIPv4(peer)) { socket.destroy(); return; }
    const peerState = peerResources(peer);
    if (sockets.size >= RESOURCE_LIMITS.maxConnections || peerState.connections >= RESOURCE_LIMITS.maxPeerConnections) {
      discardPeer(peer, peerState); socket.destroy(); return;
    }
    sockets.add(socket); peerState.connections++; socketLeases.set(socket, new Set());
    socket.once('close', () => {
      sockets.delete(socket); peerState.connections--;
      for (const cancel of socketLeases.get(socket) || []) cancel();
      socketLeases.delete(socket); discardPeer(peer, peerState);
    });
  });
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
      replay.clear(); anonymousReplay.clear(); replayPeers.clear(); anonymousReplayPeers.clear();
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
        if(response.statusCode===413){response.resume();reject(sizeError('局域网内容超过128MB，请减少图片后重试'));return;}
        // Receive admission can reject before an ECDH request key is available.
        // These generic transport errors do not invalidate the verified pin/token.
        if ([408, 429, 503].includes(response.statusCode)) {
          response.resume();
          reject(Object.assign(new Error(response.statusCode === 408 ? '局域网内容接收超时，请检查网络后重试' : '局域网主机繁忙，请稍后重试'), { code: 'LAN_RESOURCE_LIMIT', status: response.statusCode }));
          return;
        }
        const chunks = []; let size = 0;
        response.on('data', chunk => { size += chunk.length; if (size > MAX_WIRE_BYTES) { response.destroy(); reject(sizeError('局域网响应超过128MB')); } else chunks.push(chunk); });
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
      if(error.code==='LAN_SIZE_LIMIT')return {result:errorResult(413,error.message)};
      if (error.code === 'LAN_RESOURCE_LIMIT') return { result: errorResult(error.status, error.message) };
      connected = false;
      if (/连接码/.test(error.message)) { token = null; return { result: errorResult(403, error.message) }; }
      return { result: errorResult(503, /超时/.test(error.message) ? '局域网连接超时，请检查网络或稍后重试' : '无法连接局域网主机，请确认主机程序已开启、地址端口正确且电脑在同一局域网') };
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

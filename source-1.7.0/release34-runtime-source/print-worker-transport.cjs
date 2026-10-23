'use strict';
const net = require('node:net');
const { randomUUID, randomBytes, createHmac, timingSafeEqual } = require('node:crypto');
const { serializePrintValue } = require('./print-agent.cjs');
const { createAuthenticatedPrintChannel } = require('./print-agent-channel.cjs');
const MAX_FRAME = 96 * 1024 * 1024;
function error(code, message) { return Object.assign(new Error(message), { code }); }
function createWireAuthenticator({ secret, clock = Date.now, maxSkewMs = 30000 }) {
  const key = Buffer.from(secret || ''); if (key.length < 32 || key.length > 512) throw TypeError('Private worker secret required');
  const used = new Map();
  function normalize(value, signed) {
    const p = JSON.parse(serializePrintValue(value)); const keys = ['version','type','requestId','issuedAt','nonce','body', ...(signed ? ['mac'] : [])];
    if (!p || Object.keys(p).some(k => !keys.includes(k)) || p.version !== 1 || !['request','gate','receipt','result'].includes(p.type) || !/^[a-f0-9-]{36}$/.test(p.requestId) || !Number.isSafeInteger(p.issuedAt) || !/^[A-Za-z0-9_-]{16,128}$/.test(p.nonce) || !p.body || typeof p.body !== 'object' || Array.isArray(p.body) || signed && !/^[a-f0-9]{64}$/.test(p.mac)) throw error('PRINT_WORKER_MESSAGE_INVALID', '打印代理消息格式无效');
    return p;
  }
  function mac(p) { return createHmac('sha256', key).update(serializePrintValue(p)).digest('hex'); }
  return { sign(type, requestId, body) { const p = normalize({ version: 1, type, requestId, issuedAt: clock(), nonce: randomBytes(24).toString('base64url'), body }, false); return { ...p, mac: mac(p) }; },
    verify(value) { const p = normalize(value, true), unsigned = { ...p }; delete unsigned.mac;
      if (!timingSafeEqual(Buffer.from(mac(unsigned), 'hex'), Buffer.from(p.mac, 'hex'))) throw error('PRINT_WORKER_AUTH_FAILED', '打印代理消息签名无效');
      const now = clock(); if (Math.abs(now - p.issuedAt) > maxSkewMs) throw error('PRINT_WORKER_EXPIRED', '打印代理消息已过期');
      for (const [nonce, expiry] of used) if (expiry < now) used.delete(nonce);
      if (used.has(p.nonce)) throw error('PRINT_WORKER_REPLAY', '打印代理消息已使用'); if (used.size >= 10000) throw error('PRINT_WORKER_CAPACITY', '打印代理消息校验已满');
      used.set(p.nonce, p.issuedAt + maxSkewMs + 1); return p;
    }, close() { key.fill(0); used.clear(); } };
}
function bindWire(socket, auth, onMessage, onDisconnect) {
  let chunks = [], bytes = 0, dead = false;
  socket.on('data', chunk => {
    if (dead) return;
    let start = 0;
    for (let i = 0; i < chunk.length; i++) if (chunk[i] === 10) {
      const part = chunk.subarray(start, i); chunks.push(part); bytes += part.length;
      if (bytes > MAX_FRAME) { socket.destroy(error('PRINT_WORKER_FRAME_LIMIT', '打印代理消息过大')); return; }
      try { const packet = auth.verify(JSON.parse(Buffer.concat(chunks, bytes).toString('utf8'))); chunks = []; bytes = 0; Promise.resolve(onMessage(packet)).catch(e => socket.destroy(e)); }
      catch (e) { socket.destroy(e); return; }
      start = i + 1;
    }
    if (start < chunk.length) { chunks.push(chunk.subarray(start)); bytes += chunk.length - start; if (bytes > MAX_FRAME) socket.destroy(error('PRINT_WORKER_FRAME_LIMIT', '打印代理消息过大')); }
  });
  socket.on('error', () => {});
  socket.once('close', () => { dead = true; chunks = []; bytes = 0; onDisconnect(); });
  return { send(type, requestId, body) { if (dead || socket.destroyed) throw error('PRINT_WORKER_DISCONNECTED', '独立打印代理已断开'); const frame = serializePrintValue(auth.sign(type, requestId, body)); if (Buffer.byteLength(frame) > MAX_FRAME) throw error('PRINT_WORKER_FRAME_LIMIT', '打印代理消息过大'); socket.write(frame + '\n'); }, destroy() { socket.destroy(); } };
}
function validateEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || process.platform === 'win32' && !/^\\\\\.\\pipe\\xjy-(?:test|print-worker)-[a-zA-Z0-9_-]{1,100}$/.test(endpoint) || process.platform !== 'win32' && (!endpoint.startsWith('/') || !endpoint.endsWith('.sock') || endpoint.length > 240)) throw TypeError('Fixed local worker endpoint required');
}
function createPrintWorkerServer({ endpoint, secret, agent, gateTimeoutMs = 30000, onClosed = () => {} }) {
  validateEndpoint(endpoint); const auth = createWireAuthenticator({ secret }); const gates = new Map(), connections = new Set(); let owner = null, activePrint = null, closed = false;
  const channel = createAuthenticatedPrintChannel({ secret, agent, authorizeClose: async () => true,
    authorizePrint: payload => {
      const active = activePrint;
      if (!active || active.payload.jobId !== payload.jobId || !active.wire) throw error('PRINT_WORKER_GATE_MISSING', '缺少打印后台最终授权通道');
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { gates.delete(active.requestId); reject(error('PRINT_WORKER_GATE_TIMEOUT', '最终打印授权响应超时')); }, gateTimeoutMs);
        gates.set(active.requestId, { resolve, reject, timer, connection: active.socket });
        try { active.wire.send('gate', active.requestId, { jobId: payload.jobId, payloadHash: payload.payloadHash, route: payload.route, copies: payload.copies }); }
        catch (e) { clearTimeout(timer); gates.delete(active.requestId); reject(e); }
      });
    } });
  const server = net.createServer(socket => {
    // One authenticated backend owns this process; a second connection never
    // creates a second consumer or replaces a backend with an in-flight job.
    if (closed || owner) { socket.destroy(); return; } owner = socket; connections.add(socket);
    const wire = bindWire(socket, auth, async packet => {
      if (packet.type === 'receipt') {
        const gate = gates.get(packet.requestId); if (!gate || gate.connection !== socket) throw error('PRINT_WORKER_GATE_INVALID', '打印授权回复无匹配任务');
        if (Object.keys(packet.body).some(k => !['ok','receipt','error'].includes(k)) || typeof packet.body.ok !== 'boolean') throw error('PRINT_WORKER_GATE_INVALID', '打印授权回复格式无效');
        clearTimeout(gate.timer); gates.delete(packet.requestId);
        if (packet.body.ok) {const expiresAt=packet.body.receipt?.expiresAt,now=Date.now();if(!Number.isSafeInteger(expiresAt)||expiresAt<=now||expiresAt>now+5000)gate.reject(error('PRINT_AUTH_RECEIPT_EXPIRED','最终打印授权已过期或有效期不受限'));else gate.resolve(packet.body.receipt);} else gate.reject(error('PRINT_AUTH_REVOKED', typeof packet.body.error === 'string' ? packet.body.error.slice(0,800) : '最终业务权限未通过'));
        return;
      }
      if (packet.type !== 'request' || Object.keys(packet.body).length !== 1 || !packet.body.envelope || packet.body.envelope.requestId !== packet.requestId) throw error('PRINT_WORKER_MESSAGE_INVALID', '打印代理仅接受固定签名操作');
      const envelope = packet.body.envelope; let ownsPrint = false;
      try {
        if (envelope.op === 'print') { if (activePrint) throw error('PRINT_AGENT_BUSY', '主机正在处理另一打印任务'); activePrint = { requestId: packet.requestId, payload: envelope.payload, wire, socket }; ownsPrint = true; }
        const value = await channel.handle(envelope); wire.send('result', packet.requestId, { ok: true, value });
        if (envelope.op === 'close') onClosed();
      } catch (e) { if (!socket.destroyed) wire.send('result', packet.requestId, { ok: false, error: { code: e.code || 'PRINT_WORKER_ERROR', message: String(e.message).slice(0,800) } }); }
      finally { if (ownsPrint) activePrint = null; }
    }, () => { connections.delete(socket); if (owner === socket) owner = null; for (const [id, gate] of gates) if (gate.connection === socket) { clearTimeout(gate.timer); gates.delete(id); gate.reject(error('PRINT_WORKER_DISCONNECTED', '后台授权连接已断开')); } });
  });
  return { listen: () => new Promise((resolve, reject) => { server.once('error', reject); server.listen(endpoint, () => { server.removeListener('error', reject); resolve(); }); }),
    disconnect() { for (const socket of connections) socket.destroy(); },
    async close() { if (closed) return; closed = true; for (const socket of connections) socket.destroy(); await agent.close(); await new Promise(resolve => server.listening ? server.close(resolve) : resolve()); auth.close(); } };
}
module.exports = { createWireAuthenticator, bindWire, validateEndpoint, createPrintWorkerServer };

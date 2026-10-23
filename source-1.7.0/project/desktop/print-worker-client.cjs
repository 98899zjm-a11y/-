'use strict';
const net = require('node:net');
const { randomUUID, randomBytes } = require('node:crypto');
const { serializePrintValue, fingerprintPrintPayload } = require('./print-agent.cjs');
const { signPrintEnvelope } = require('./print-agent-channel.cjs');
const { createWireAuthenticator, bindWire, validateEndpoint } = require('./print-worker-transport.cjs');
function error(code, message) { return Object.assign(new Error(message), { code }); }
function createPrintWorkerClient({ endpoint, secret, timeoutMs = 60000, connectTimeoutMs = 5000 }) {
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000||!Number.isSafeInteger(connectTimeoutMs)||connectTimeoutMs<1||connectTimeoutMs>5000)throw TypeError('Worker timeout deadline must stay within the central lease');
  validateEndpoint(endpoint); const auth = createWireAuthenticator({ secret }); const pending = new Map(), dispatchedJobs = new Map(); let socket, wire, connecting, closed = false, disconnected = false;
  function loseConnection() { disconnected = true; for (const [id,p] of pending) { clearTimeout(p.timer); pending.delete(id); p.reject(error('PRINT_WORKER_DISCONNECTED','独立打印代理连接中断，请先核对已提交任务')); } }
  async function connect() {
    if (closed || disconnected) throw error('PRINT_WORKER_DISCONNECTED','独立打印代理连接已关闭，需要人工检查并重建代理连接');
    if (wire) return; if (connecting) return connecting;
    connecting = new Promise((resolve,reject) => {
      socket = net.createConnection(endpoint); const timer = setTimeout(() => { socket.destroy(); reject(error('PRINT_WORKER_CONNECT_TIMEOUT','独立打印代理连接超时')); }, connectTimeoutMs);
      socket.once('error', e => { clearTimeout(timer); reject(e); });
      wire = bindWire(socket, auth, async packet => {
        const p = pending.get(packet.requestId); if (!p) throw error('PRINT_WORKER_MESSAGE_INVALID','打印代理回复没有对应请求');
        if (packet.type === 'gate') {
          if (p.op !== 'print' || p.gated || serializePrintValue(packet.body) !== serializePrintValue({jobId:p.payload.jobId,payloadHash:p.payload.payloadHash,route:p.payload.route,copies:p.payload.copies})) throw error('PRINT_WORKER_GATE_INVALID','打印代理最终授权摘要与任务不一致');
          p.gated = true;
          try { const receipt = await p.assertAuthorized(); if (!pending.has(packet.requestId) || closed || disconnected) return;
            // No native send can happen while a backend callback is unresolved.
            wire.send('receipt',packet.requestId,{ok:true,receipt});
          } catch(e) { if (pending.has(packet.requestId) && !socket.destroyed) wire.send('receipt',packet.requestId,{ok:false,error:String(e.message || e).slice(0,800)}); }
          return;
        }
        if (packet.type !== 'result' || typeof packet.body.ok !== 'boolean') throw error('PRINT_WORKER_MESSAGE_INVALID','打印代理回复格式无效');
        clearTimeout(p.timer); pending.delete(packet.requestId);
        if (packet.body.ok) p.resolve(packet.body.value); else p.reject(error(packet.body.error?.code || 'PRINT_WORKER_ERROR', packet.body.error?.message || '打印代理未能处理'));
      }, loseConnection);
      socket.once('connect',() => { clearTimeout(timer); resolve(); });
    });
    return connecting;
  }
  async function request(op, payload, assertAuthorized, deadline) {
    await connect(); const requestId = randomUUID();
    return new Promise((resolve,reject) => {
      const remaining=deadline===undefined?timeoutMs:Math.max(1,deadline-Date.now());
      const timer = setTimeout(() => { pending.delete(requestId); reject(error('PRINT_WORKER_RESPONSE_TIMEOUT','打印代理结果超时，请核对是否已出纸')); socket.destroy(); }, remaining);
      pending.set(requestId,{op,payload,assertAuthorized,gated:false,resolve,reject,timer});
      try { const envelope = signPrintEnvelope(secret,{version:1,op,requestId,issuedAt:Date.now(),nonce:randomBytes(24).toString('base64url'), ...(op==='print'?{payload}:{})}); wire.send('request',requestId,{envelope}); }
      catch(e) { clearTimeout(timer); pending.delete(requestId); reject(e); }
    });
  }
  return { getDevices: () => request('getDevices'),
    async print(input, control = {}) {
      let dispatched = false;const deadline=Date.now()+timeoutMs;
      try { const payload = JSON.parse(serializePrintValue(input));
        if (typeof control.assertAuthorized !== 'function') throw error('PRINT_AUTH_RECEIPT_REQUIRED','缺少最终业务授权');
        if (fingerprintPrintPayload(payload) !== payload.payloadHash) throw error('PRINT_PAYLOAD_CHANGED','打印载荷摘要不一致');
        if (dispatchedJobs.has(payload.jobId)) return {status:dispatchedJobs.get(payload.jobId)==='uncertain'?'uncertain':'failed',code:'PRINT_JOB_ALREADY_ATTEMPTED',error:'此连接已发送过该任务，请查询保留任务记录并核对出纸'};
        await connect(); dispatchedJobs.set(payload.jobId,'uncertain'); dispatched = true;
        const result=await request('print',payload,control.assertAuthorized,deadline);dispatchedJobs.set(payload.jobId,result.status);return result;
      } catch(e) { return {status:dispatched || disconnected?'uncertain':'failed',code:e.code || 'PRINT_WORKER_ERROR',error:String(e.message || e).slice(0,800)}; }
    },
    async close() { if (closed) return; try { if (wire && !disconnected) await request('close'); }
      catch (failure) { if (failure.code !== 'PRINT_WORKER_DISCONNECTED') throw failure; }
      finally { closed = true; socket?.destroy(); auth.close(); } }
  };
}
module.exports = { createPrintWorkerClient };

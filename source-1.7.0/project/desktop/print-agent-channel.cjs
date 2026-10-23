'use strict';
const { createHmac, timingSafeEqual } = require('node:crypto');
const { serializePrintValue } = require('./print-agent.cjs');

function fail(code, message, status = 400) { const error = new Error(message); error.code = code; error.status = status; throw error; }
function secretBytes(secret) {
  if (typeof secret !== 'string' && !Buffer.isBuffer(secret)) throw new TypeError('A private shared secret is required');
  const result = Buffer.from(secret);
  if (result.length < 32 || result.length > 512) throw new TypeError('Print channel secret must contain 32 to 512 bytes');
  return result;
}
function plainEnvelope(value, signed = false) {
  const result = JSON.parse(serializePrintValue(value));
  const keys = ['version', 'op', 'requestId', 'issuedAt', 'nonce', 'payload', ...(signed ? ['mac'] : [])];
  if (!result || typeof result !== 'object' || Array.isArray(result) || Object.keys(result).some(key => !keys.includes(key)) || result.version !== 1 ||
      !['getDevices', 'print', 'close'].includes(result.op) || typeof result.requestId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(result.requestId) ||
      !Number.isSafeInteger(result.issuedAt) || result.issuedAt < 0 || typeof result.nonce !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(result.nonce) ||
      result.op === 'print' && (!result.payload || typeof result.payload !== 'object' || Array.isArray(result.payload)) ||
      result.op !== 'print' && Object.hasOwn(result, 'payload')) fail('PRINT_CHANNEL_ENVELOPE_INVALID', '打印代理只接受已登记的签名操作');
  if (signed && (typeof result.mac !== 'string' || !/^[a-f0-9]{64}$/.test(result.mac))) fail('PRINT_CHANNEL_AUTH_FAILED', '打印代理签名无效', 401);
  return result;
}
function digest(secret, unsigned) { return createHmac('sha256', secret).update(serializePrintValue(unsigned)).digest('hex'); }
function signPrintEnvelope(secret, value) {
  const key = secretBytes(secret), unsigned = plainEnvelope(value);
  return { ...unsigned, mac: digest(key, unsigned) };
}

function createAuthenticatedPrintChannel({ secret, agent, clock = Date.now, maxSkewMs = 30000, maxNonces = 1024, authorizePrint, authorizeClose }) {
  const key = secretBytes(secret);
  if (!agent || typeof clock !== 'function' || !Number.isSafeInteger(maxSkewMs) || maxSkewMs < 1 || maxSkewMs > 60000 || !Number.isSafeInteger(maxNonces) || maxNonces < 1 || maxNonces > 10000) throw new TypeError('Controlled agent and bounded channel policy are required');
  const nonces = new Map(); let closed = false;
  async function handle(value) {
    if (closed) fail('PRINT_CHANNEL_CLOSED', '本机打印通道已关闭', 503);
    const envelope = plainEnvelope(value, true), unsigned = { ...envelope }; delete unsigned.mac;
    const expected = Buffer.from(digest(key, unsigned), 'hex');
    if (!timingSafeEqual(expected, Buffer.from(envelope.mac, 'hex'))) fail('PRINT_CHANNEL_AUTH_FAILED', '打印代理签名无效', 401);
    const now = clock();
    if (!Number.isSafeInteger(now) || Math.abs(now - envelope.issuedAt) > maxSkewMs) fail('PRINT_CHANNEL_EXPIRED', '打印代理签名已过期', 401);
    for (const [nonce, expires] of nonces) if (expires < now) nonces.delete(nonce);
    if (nonces.has(envelope.nonce)) fail('PRINT_CHANNEL_REPLAY', '打印代理已处理此签名，请查询任务状态', 409);
    if (nonces.size >= maxNonces) fail('PRINT_CHANNEL_CAPACITY', '打印签名校验繁忙，请稍后再试', 429);
    // Retain a used nonce through the full interval in which its signed time
    // could still be accepted; never evict live entries to make capacity.
    nonces.set(envelope.nonce, envelope.issuedAt + maxSkewMs + 1);
    if (envelope.op === 'getDevices') {
      if (typeof agent.getDevices !== 'function') fail('PRINT_CHANNEL_OPERATION_UNAVAILABLE', '打印设备接口未接入', 503);
      return agent.getDevices();
    }
    if (envelope.op === 'print') {
      if (typeof agent.print !== 'function' || typeof authorizePrint !== 'function') fail('PRINT_CHANNEL_PRINT_FORBIDDEN', '打印通道未接入最终业务授权', 403);
      return agent.print(envelope.payload, { assertAuthorized: () => authorizePrint(envelope.payload) });
    }
    if (typeof authorizeClose !== 'function' || await authorizeClose() !== true) fail('PRINT_CHANNEL_MANAGE_FORBIDDEN', '关闭代理需要单独的主机管理授权', 403);
    if (typeof agent.close !== 'function') fail('PRINT_CHANNEL_OPERATION_UNAVAILABLE', '打印关闭接口未接入', 503);
    await agent.close(); closed = true; nonces.clear(); key.fill(0);
    return { status: 'closed' };
  }
  return { handle };
}

module.exports = { createAuthenticatedPrintChannel, signPrintEnvelope };

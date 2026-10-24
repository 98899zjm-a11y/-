'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomBytes } = require('node:crypto');
const { startLanServer, createLanClient, isPrivateIPv4, normalizeMaterialsInput, materialsErrorEnvelope, materialsCsrfMatches, validateMaterialsOutput, stripMaterialsReadFinalizer } = require('./lan.cjs');

function localAddresses() {
  return Object.entries(os.networkInterfaces()).flatMap(([name, entries]) => (entries || []).filter(entry => entry.family === 'IPv4' && !entry.internal && isPrivateIPv4(entry.address)).map(entry => ({ name, address: entry.address })));
}
function configInput(input) {
  if (!input || typeof input !== 'object' || !['standalone', 'host', 'client'].includes(input.mode)) throw new Error('请选择本机、主机或连接主机');
  const port = input.port === undefined ? 31831 : Number(input.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('端口须为1024至65535之间的整数');
  const address = typeof input.host === 'string' ? input.host.trim() : '';
  const code = typeof input.code === 'string' ? input.code.trim() : '';
  if (input.mode !== 'standalone' && !(address === '127.0.0.1' || isPrivateIPv4(address))) throw new Error('请输入店内主机的局域网IPv4地址');
  if (input.mode === 'client' && !/^[A-Za-z0-9_-]{32}$/.test(code)) throw new Error('请输入主机显示的完整连接码');
  if (input.mode === 'host' && code && !/^[A-Za-z0-9_-]{32}$/.test(code)) throw new Error('连接码格式无效');
  return { version: 1, mode: input.mode, host: address, port, code };
}
async function createNetworkWorkspace({ backend, configFile, clientOnly = false, validateConfig, materialsHandler }) {
  let currentBackend = backend, config = { version: 1, mode: clientOnly ? 'client' : 'standalone', host: '', port: 31831, code: '' }, server = null, client = null, lastError = '', readError = '', frozen = false, closed = false;
  const pending = new Set();
  let closePromise, lifecycleGeneration = 0, localScope = null;
  function invalidateLocalScope() { lifecycleGeneration++; localScope = null; }
  function actualSessionId(auth) {
    try {
      if (auth && auth.sessionId !== undefined && auth.sessionId !== null) return auth.sessionId;
      const status = auth && typeof auth.status === 'function' ? auth.status() : null;
      return status && status.sessionId !== undefined ? status.sessionId : undefined;
    } catch { return undefined; }
  }
  async function tracked(action) { const work=Promise.resolve().then(action);pending.add(work);try{return await work;}finally{pending.delete(work);} }
  if (fs.existsSync(configFile)) {
    try { const bytes = fs.readFileSync(configFile); if (bytes.length > 8192) throw new Error(); const saved = configInput(JSON.parse(bytes.toString('utf8'))); if (clientOnly && saved.mode !== 'client') throw new Error(); config = saved; }
    catch { readError = clientOnly ? '连接设置未能读取，请重新填写主机连接。' : '连接设置未能读取，已使用本机数据。请重新设置连接。'; }
  }
  async function start(resume = true) {
    try {
      if (config.mode === 'host') {
        const previousCode = config.code;
        server = await startLanServer({ backend: currentBackend, host: config.host, port: config.port, code: config.code || undefined, resume, identityFile: configFile + '.identity.json', materialsHandler });
        config.code = server.code;
        if (previousCode !== config.code && fs.existsSync(configFile)) {
          const temporary = configFile + '.tmp'; fs.writeFileSync(temporary, JSON.stringify(config, null, 2), { mode: 0o600 }); fs.renameSync(temporary, configFile);
        }
      }
      if (config.mode === 'client' && config.host && config.code) client = createLanClient({ host: config.host, port: config.port, code: config.code });
      lastError = readError;
    } catch (error) { if (server) { await server.stop(); server = null; } lastError = error.message; }
  }
  async function stop() { invalidateLocalScope(); if (client) { await client.close(); client = null; } if (server) { await server.stop(); server = null; } }
  async function localMaterialsRequest(normalized) {
    const capturedBackend = currentBackend;
    const auth = capturedBackend && capturedBackend.auth;
    let authStatus;
    try { authStatus = auth && typeof auth.status === 'function' ? auth.status() : null; }
    catch { authStatus = null; }
    if (!authStatus || !authStatus.user) return materialsErrorEnvelope(401, '请先登录本机账号');
    if (!materialsHandler) return materialsErrorEnvelope(503, '材料服务未启用');
    const sessionId = actualSessionId(auth);
    let scope = localScope;
    if (!scope || scope.backend !== capturedBackend || scope.generation !== lifecycleGeneration || scope.sessionId !== sessionId) {
      scope = { backend: capturedBackend, generation: lifecycleGeneration, sessionId, session: Object.freeze({ auth }), gatewayCsrf: randomBytes(32).toString('hex') };
      localScope = scope;
    }
    if (normalized.method !== 'GET' && !materialsCsrfMatches(normalized.headers, scope.gatewayCsrf)) return materialsErrorEnvelope(403, '材料请求校验失败');
    const context = Object.freeze({
      session: scope.session,
      administration: capturedBackend.administration,
      gatewayCsrf: scope.gatewayCsrf,
      isLive: () => !closed && !frozen && currentBackend === capturedBackend && lifecycleGeneration === scope.generation && actualSessionId(auth) === sessionId,
    });
    let output;
    try { output = await materialsHandler(normalized, context); }
    catch { return materialsErrorEnvelope(503, '材料服务暂时不可用'); }
    try {
      return normalized.method === 'GET'
        ? validateMaterialsOutput(output, { trustedFinalizer: true })
        : validateMaterialsOutput(stripMaterialsReadFinalizer(output));
    }
    catch (error) {
      const status = error && error.status === 413 ? 413 : 502;
      return materialsErrorEnvelope(status, status === 413 ? '材料服务返回内容过大' : '材料服务返回内容无效');
    }
  }
  if(validateConfig!==undefined&&typeof validateConfig!=='function')throw TypeError('Trusted network configuration policy required');
  if (materialsHandler !== undefined && typeof materialsHandler !== 'function') throw new TypeError('Trusted materials handler required');
  if(validateConfig)validateConfig(config);
  await start();
  return {
    async request(input) {
      if(frozen||closed)return {ok:false,status:503,data:{error:'主机维护中，请稍后重试'}};
      if (clientOnly && !client && input?.path === '/auth/status') return { ok: true, status: 200, data: { needsSetup: false, authenticated: false } };
      if (config.mode === 'client' && input?.path === '/auth/logout' && String(input.method || 'GET').toUpperCase() === 'POST') {
        if (client) await client.close();
        if (config.host && config.code) client = createLanClient({ host: config.host, port: config.port, code: config.code });
        return { ok: true, status: 200, data: { needsSetup: false, authenticated: false } };
      }
      try { return await tracked(()=>(config.mode === 'client' ? client || { dispatch: () => { throw new Error(lastError || '尚未连接店内主机'); } } : currentBackend).dispatch(input)); }
      catch (error) { return { ok: false, status: 503, data: { error: error.message || '主机无法连接，请确认主机程序已打开且电脑在同一局域网' } }; }
    },
    materialsRequest(input) {
      if (frozen || closed) return Promise.resolve(materialsErrorEnvelope(503, '主机维护中，请稍后重试'));
      let normalized;
      try { normalized = normalizeMaterialsInput(input); }
      catch (error) {
        const status = error && Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 400;
        return Promise.resolve(materialsErrorEnvelope(status, error && error.message ? error.message : '材料请求格式无效'));
      }
      return tracked(async () => {
        if (frozen || closed) return materialsErrorEnvelope(503, '主机维护中，请稍后重试');
        if (config.mode === 'client') {
          if (!client) return materialsErrorEnvelope(503, lastError || '尚未连接店内主机');
          return client.materialsRequest(normalized);
        }
        return localMaterialsRequest(normalized);
      });
    },
    async imageResponse(id) { if(frozen||closed)return Response.json({error:'主机维护中，请稍后重试'},{status:503});try { return await tracked(()=>(config.mode === 'client' ? client : currentBackend).imageResponse(id)); } catch { return Response.json({ error: '本机或主机图片暂时不可读取' }, { status: 503 }); } },
    info() {
      const admin = currentBackend.auth.status().user?.role === 'admin';
      return { mode: config.mode, host: config.host, port: config.port, addresses: localAddresses(), running: config.mode === 'host' ? Boolean(server) : config.mode === 'standalone', error: lastError, ...(clientOnly ? { clientOnly: true } : {}), ...(config.mode === 'host' && admin ? { code: config.code } : {}) };
    },
    async configure(input) {
      if(frozen||closed)throw Error('主机维护中，连接设置暂不可修改');
      invalidateLocalScope();
      const next = configInput(input);
      if(validateConfig)validateConfig(next);
      if (clientOnly && next.mode !== 'client') throw new Error('员工专用入口只连接主机，不建立本地工作室');
      const localUser = currentBackend.auth.status().user;
      if ((config.mode === 'host' || next.mode === 'host') && localUser?.role !== 'admin') throw new Error('只有主机管理员可以启用或修改主机服务');
      if (next.mode === 'host' && !localAddresses().some(item => item.address === next.host) && next.host !== '127.0.0.1') throw new Error('所选主机地址不在这台电脑上，请选择本机局域网地址');
      if (next.mode === 'client') {
        const probe = createLanClient(next);
        try { const status = await probe.dispatch({ path: '/auth/status' }); if (!status.ok) throw new Error(status.data?.error || '主机验证未通过'); }
        finally { await probe.close(); }
      }
      const previous = config, previousReadError = readError;
      readError = '';
      await stop(); config = next;
      await start(next.mode !== 'host');
      if (lastError) { const failure = lastError; await stop(); config = previous; readError = previousReadError; await start(); throw new Error(failure); }
      try {
        fs.mkdirSync(path.dirname(configFile), { recursive: true });
        const temporary = configFile + '.tmp'; fs.writeFileSync(temporary, JSON.stringify(config, null, 2), { mode: 0o600 }); fs.renameSync(temporary, configFile);
      } catch (error) { await stop(); config = previous; readError = previousReadError; await start(); throw new Error('连接设置未能保存，已保留原设置。' + error.message); }
      currentBackend.auth.logout();
      return { ok: true, ...this.info() };
    },
    assertLocal() { if (config.mode === 'client') throw new Error('请在保存数据的主机上备份或恢复'); },
    async pause() { await stop(); },
    async setBackend(next) { invalidateLocalScope(); currentBackend = next; if(!frozen&&!closed){await stop();await start();} },
    async withFrozen(action) { if(closed){await closePromise;return action();}if(frozen)throw Error('主机维护任务已在运行');frozen=true;try{await stop();await Promise.allSettled([...pending]);return await action();}finally{frozen=false;if(!closed)await start();} },
    close() {if(!closePromise){closed=true;closePromise=(async()=>{await stop();await Promise.allSettled([...pending]);})();}return closePromise;},
  };
}

module.exports = { createNetworkWorkspace, configInput, localAddresses };

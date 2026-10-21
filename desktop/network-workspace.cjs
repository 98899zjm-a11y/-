'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { startLanServer, createLanClient, isPrivateIPv4 } = require('./lan.cjs');

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
async function createNetworkWorkspace({ backend, configFile }) {
  let currentBackend = backend, config = { version: 1, mode: 'standalone', host: '', port: 31831, code: '' }, server = null, client = null, lastError = '', readError = '';
  if (fs.existsSync(configFile)) {
    try { const bytes = fs.readFileSync(configFile); if (bytes.length > 8192) throw new Error(); config = configInput(JSON.parse(bytes.toString('utf8'))); }
    catch { readError = '连接设置未能读取，已使用本机数据。请重新设置连接。'; }
  }
  async function start(resume = true) {
    try {
      if (config.mode === 'host') {
        const previousCode = config.code;
        server = await startLanServer({ backend: currentBackend, host: config.host, port: config.port, code: config.code || undefined, resume, identityFile: configFile + '.identity.json' });
        config.code = server.code;
        if (previousCode !== config.code && fs.existsSync(configFile)) {
          const temporary = configFile + '.tmp'; fs.writeFileSync(temporary, JSON.stringify(config, null, 2), { mode: 0o600 }); fs.renameSync(temporary, configFile);
        }
      }
      if (config.mode === 'client') client = createLanClient({ host: config.host, port: config.port, code: config.code });
      lastError = readError;
    } catch (error) { if (server) { await server.stop(); server = null; } lastError = error.message; }
  }
  async function stop() { if (client) { await client.close(); client = null; } if (server) { await server.stop(); server = null; } }
  await start();
  return {
    async request(input) {
      if (config.mode === 'client' && input?.path === '/auth/logout' && String(input.method || 'GET').toUpperCase() === 'POST') {
        if (client) await client.close();
        client = createLanClient({ host: config.host, port: config.port, code: config.code });
        return { ok: true, status: 200, data: { needsSetup: false, authenticated: false } };
      }
      try { return await (config.mode === 'client' ? client || { dispatch: () => { throw new Error(lastError || '尚未连接店内主机'); } } : currentBackend).dispatch(input); }
      catch (error) { return { ok: false, status: 503, data: { error: error.message || '主机无法连接，请确认主机程序已打开且电脑在同一局域网' } }; }
    },
    async imageResponse(id) { try { return await (config.mode === 'client' ? client : currentBackend).imageResponse(id); } catch { return Response.json({ error: '本机或主机图片暂时不可读取' }, { status: 503 }); } },
    info() {
      const admin = currentBackend.auth.status().user?.role === 'admin';
      return { mode: config.mode, host: config.host, port: config.port, addresses: localAddresses(), running: config.mode === 'host' ? Boolean(server) : config.mode === 'standalone', error: lastError, ...(config.mode === 'host' && admin ? { code: config.code } : {}) };
    },
    async configure(input) {
      const next = configInput(input);
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
    async setBackend(next) { currentBackend = next; await start(); },
    close: stop,
  };
}

module.exports = { createNetworkWorkspace, configInput, localAddresses };

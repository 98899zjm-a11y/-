'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { createBackend } = require('../backend.cjs');
const { createNetworkWorkspace } = require('../network-workspace.cjs');

const migrationDir = path.resolve(__dirname, '../../drizzle');
const dataRoot = path.resolve(__dirname, '.network-workspace-data');
async function unusedPort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve); });
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  return port;
}

test('真实主机/客户端工作区：持久配置、权限、自动恢复与断线隔离', { timeout: 30000 }, async t => {
  fs.mkdirSync(dataRoot, { recursive: true });
  const directory = fs.mkdtempSync(path.join(dataRoot, 'run-'));
  const hostData = path.join(directory, 'host-data'), clientData = path.join(directory, 'client-data');
  const hostConfig = path.join(directory, 'host-profile', 'network.json'), clientConfig = path.join(directory, 'client-profile', 'network.json');
  const adminPassword = 'Manager.Admin-556!', workerPassword = 'Manager.Worker-482!';
  let hostBackend = createBackend({ dataDir: hostData, migrationDir }), clientBackend = createBackend({ dataDir: clientData, migrationDir });
  let hostWorkspace = await createNetworkWorkspace({ backend: hostBackend, configFile: hostConfig }), clientWorkspace = await createNetworkWorkspace({ backend: clientBackend, configFile: clientConfig });
  const state = {};
  const step = async (label, action) => { let failure; await t.test(label, async () => { try { await action(); } catch (error) { failure = error; throw error; } }); if (failure) throw failure; };
  const good = async (workspace, address, method = 'GET', body) => { const result = await workspace.request({ path: address, method, body }); assert.equal(result.ok, true, `${address}: ${result.data?.error}`); return result.data; };
  const adminLogin = () => good(hostWorkspace, '/auth/login', 'POST', { username: 'manager', password: adminPassword });
  try {
    await step('主机由本机管理员启用；客户端本地数据库没有预设账号', async () => {
      assert.equal(hostWorkspace.info().mode, 'standalone');
      assert.deepEqual(await good(clientWorkspace, '/auth/status'), { needsSetup: true, authenticated: false });
      await good(hostWorkspace, '/auth/setup', 'POST', { username: 'manager', password: adminPassword });
      state.worker = (await good(hostWorkspace, '/api/users', 'POST', { username: 'counter', password: workerPassword, name: '柜台员工' })).user;
      state.port = await unusedPort();
      const enabled = await hostWorkspace.configure({ mode: 'host', host: '127.0.0.1', port: state.port });
      assert.equal(enabled.mode, 'host'); assert.equal(enabled.running, true);
      assert.equal((await good(hostWorkspace, '/auth/status')).authenticated, false);
      await adminLogin(); state.code = hostWorkspace.info().code;
      assert.match(state.code, /^[A-Za-z0-9_-]{32}$/);
      assert.equal(JSON.parse(fs.readFileSync(hostConfig, 'utf8')).code, state.code);
    });
    await step('客户端配对后使用主机员工登录与同一数据库，账号不复制到客户端', async () => {
      await clientWorkspace.configure({ mode: 'client', host: '127.0.0.1', port: state.port, code: state.code });
      assert.equal(clientWorkspace.info().mode, 'client');
      assert.deepEqual(await good(clientWorkspace, '/auth/status'), { needsSetup: false, authenticated: false });
      const login = await good(clientWorkspace, '/auth/login', 'POST', { username: 'counter', password: workerPassword });
      assert.equal(login.user.id, state.worker.id);
      state.customer = (await good(clientWorkspace, '/api/customers', 'POST', { name: '局域网同库客户' })).customer;
      const hostView = await good(hostWorkspace, '/api/bootstrap');
      assert.equal(hostView.customers.find(customer => customer.id === state.customer.id).ownerId, state.worker.id);
      assert.equal(clientBackend.runtime.sqlite.prepare('SELECT count(*) AS count FROM staff_users').get().count, 0);
      assert.equal(clientBackend.runtime.sqlite.prepare('SELECT count(*) AS count FROM customers').get().count, 0);
    });
    await step('客户机不能备份或恢复主机数据；本机和主机允许进入本地备份流程', async () => {
      assert.throws(() => clientWorkspace.assertLocal(), /主机.*备份|主机上备份/);
      assert.doesNotThrow(() => hostWorkspace.assertLocal());
      assert.equal((await clientWorkspace.request({ path: '/api/users', method: 'POST', body: { username: 'blocked', password: workerPassword } })).status, 403);
    });
    await step('错误连接码不改变原配置或当前正确会话', async () => {
      const before = fs.readFileSync(clientConfig, 'utf8');
      await assert.rejects(clientWorkspace.configure({ mode: 'client', host: '127.0.0.1', port: state.port, code: 'a'.repeat(32) }), /连接码|验证/);
      assert.equal(fs.readFileSync(clientConfig, 'utf8'), before);
      assert.equal((await good(clientWorkspace, '/auth/status')).user.id, state.worker.id);
      assert.equal((await good(clientWorkspace, '/api/bootstrap')).customers[0].id, state.customer.id);
    });
    await step('未登录和普通员工均不能开启、改动或退出主机服务', async () => {
      await good(hostWorkspace, '/auth/logout', 'POST');
      const before = fs.readFileSync(hostConfig, 'utf8');
      await assert.rejects(hostWorkspace.configure({ mode: 'standalone' }), /管理员/);
      await good(hostWorkspace, '/auth/login', 'POST', { username: 'counter', password: workerPassword });
      await assert.rejects(hostWorkspace.configure({ mode: 'host', host: '127.0.0.1', port: state.port + 1 }), /管理员/);
      await assert.rejects(hostWorkspace.configure({ mode: 'standalone' }), /管理员/);
      assert.equal(fs.readFileSync(hostConfig, 'utf8'), before);
      assert.equal(hostWorkspace.info().running, true); assert.equal('code' in hostWorkspace.info(), false);
      await adminLogin();
    });
    await step('关闭主机后的客户端写入明确503，不会退回本机保存', async () => {
      await hostWorkspace.close();
      const failure = await clientWorkspace.request({ path: '/api/customers', method: 'POST', body: { name: '断线禁止写入' } });
      assert.equal(failure.ok, false); assert.equal(failure.status, 503);
      assert.equal(clientWorkspace.info().mode, 'client');
      assert.equal(clientBackend.runtime.sqlite.prepare('SELECT count(*) AS count FROM customers').get().count, 0);
      assert.equal(hostBackend.runtime.sqlite.prepare("SELECT count(*) AS count FROM customers WHERE name='断线禁止写入'").get().count, 0);
      assert.equal((await clientWorkspace.imageResponse('00000000-0000-0000-0000-000000000000')).status, 503);
    });
    await step('主机配置重启自动恢复，无需主机再次登录；客户机重启后重新登录使用原同库', async () => {
      await hostBackend.close();
      hostBackend = createBackend({ dataDir: hostData, migrationDir });
      hostWorkspace = await createNetworkWorkspace({ backend: hostBackend, configFile: hostConfig });
      assert.equal(hostBackend.auth.status().authenticated, false);
      assert.equal(hostWorkspace.info().mode, 'host'); assert.equal(hostWorkspace.info().running, true);
      assert.equal((await clientWorkspace.request({ path: '/api/bootstrap' })).status, 401);
      await clientWorkspace.close(); await clientBackend.close();
      clientBackend = createBackend({ dataDir: clientData, migrationDir });
      clientWorkspace = await createNetworkWorkspace({ backend: clientBackend, configFile: clientConfig });
      assert.equal(clientWorkspace.info().mode, 'client');
      assert.equal((await good(clientWorkspace, '/auth/status')).authenticated, false);
      await good(clientWorkspace, '/auth/login', 'POST', { username: 'counter', password: workerPassword });
      assert.equal((await good(clientWorkspace, '/api/bootstrap')).customers[0].id, state.customer.id);
      assert.equal(clientBackend.runtime.sqlite.prepare('SELECT count(*) AS count FROM customers').get().count, 0);
    });
    await step('管理员退出主机后停止监听，原数据保留且仍可独立本机使用', async () => {
      await adminLogin();
      await hostWorkspace.configure({ mode: 'standalone' });
      assert.equal(hostWorkspace.info().mode, 'standalone');
      assert.equal(JSON.parse(fs.readFileSync(hostConfig, 'utf8')).mode, 'standalone');
      assert.equal((await clientWorkspace.request({ path: '/api/bootstrap' })).status, 503);
      await adminLogin();
      assert.equal((await good(hostWorkspace, '/api/bootstrap')).customers[0].id, state.customer.id);
    });
  } finally {
    await clientWorkspace?.close(); await hostWorkspace?.close();
    await clientBackend?.close(); await hostBackend?.close();
  }
});

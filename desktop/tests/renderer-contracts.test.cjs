'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('../../node_modules/esbuild');

function loadRenderer(name) {
  const filename = path.resolve(__dirname, '../renderer', name);
  const result = esbuild.buildSync({ entryPoints: [filename], bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic', tsconfig: path.resolve(__dirname, '../../tsconfig.json'), loader: { '.css': 'empty' }, external: ['react', 'react-dom', 'react-dom/client', 'react-dom/server', 'lucide-react'], logLevel: 'silent' });
  const loaded = new Module(filename, module);
  loaded.filename = filename; loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(result.outputFiles[0].text, filename);
  return loaded.exports;
}

const { connectionInput } = loadRenderer('network-settings.tsx');
const { api } = loadRenderer('bridge.ts');
const { readConfirmation } = loadRenderer('workspace.tsx');
const info = { mode: 'standalone', host: '', port: 31831, addresses: [{ name: '店内网卡', address: '192.168.1.20' }], running: true, error: '' };
const code = 'AbCdEfGhIjKlMnOpQrStUvWxYz-_0123';

test('客户端可在创建本机账号之前配对；完整连接码原样传给原生层', () => {
  assert.equal(code.length, 32);
  assert.deepEqual(connectionInput('client', '192.168.1.20', '31831', code, info, false), { mode: 'client', host: '192.168.1.20', port: 31831, code });
  assert.throws(() => connectionInput('client', '8.8.8.8', '31831', code, info, false), /局域网/);
  assert.throws(() => connectionInput('client', '192.168.1.20', '31831', code.slice(1), info, false), /32位/);
  assert.throws(() => connectionInput('client', '192.168.1.20', '65536', code, info, false), /端口/);
});

test('共享主机设置仅本机管理员可变更，原有连接码保持不变', () => {
  const host = { ...info, mode: 'host', host: '192.168.1.20', code };
  assert.throws(() => connectionInput('host', '192.168.1.20', '31831', '', info, false), /管理员/);
  assert.throws(() => connectionInput('standalone', '', '', '', host, false), /管理员/);
  assert.throws(() => connectionInput('host', '192.168.1.21', '31831', '', info, true), /这台电脑/);
  assert.throws(() => connectionInput('host', '192.168.1.20', '31831', '', { ...info, mode: 'client' }, true), /管理员/);
  assert.deepEqual(connectionInput('host', '192.168.1.20', '31832', '', host, true), { mode: 'host', host: '192.168.1.20', port: 31832, code });
  assert.deepEqual(connectionInput('standalone', '', '', '', host, true), { mode: 'standalone' });
});

test('业务401退出旧工作台；密码错误和权限403不误退出其他会话', async () => {
  const events = [], originalWindow = global.window, originalCustomEvent = global.CustomEvent;
  global.CustomEvent = class { constructor(type, data) { this.type = type; this.detail = data.detail; } };
  global.window = { dispatchEvent(event) { events.push(event); }, jewelryDesktop: { request: async () => ({ ok: false, status: 401, data: { error: '登录已失效' } }) } };
  try {
    await assert.rejects(api('/api/quotes'), /登录已失效/);
    assert.equal(events.length, 1); assert.equal(events[0].type, 'desktop-auth-lost');
    await assert.rejects(api('/auth/login', 'POST'), /登录已失效/);
    assert.equal(events.length, 1);
    window.jewelryDesktop.request = async () => ({ ok: false, status: 403, data: { error: '没有权限' } });
    await assert.rejects(api('/api/settings', 'PATCH'), /没有权限/);
    assert.equal(events.length, 1);
  } finally { global.window = originalWindow; global.CustomEvent = originalCustomEvent; }
});

test('确认截图导入保留PNG/JPEG/WebP原字节，不经过图片缩放或JPEG重编码', async () => {
  const previousReader = global.FileReader, previousImage = global.Image, previousDocument = global.document;
  global.FileReader = class {
    readAsDataURL(file) { file.arrayBuffer().then(bytes => { this.result = `data:${file.type};base64,${Buffer.from(bytes).toString('base64')}`; this.onload(); }).catch(error => this.onerror(error)); }
  };
  global.Image = class { constructor() { throw new Error('归档截图不能图片缩放'); } };
  global.document = { createElement() { throw new Error('归档截图不能创建canvas'); } };
  try {
    for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
      const bytes = Buffer.from([0, 255, 128, 47, 9, 7, 220, 16]);
      const file = new File([bytes], '客户确认原图', { type });
      const source = await readConfirmation(file);
      assert.equal(source.split(',')[0], `data:${type};base64`);
      assert.deepEqual(Buffer.from(source.split(',')[1], 'base64'), bytes);
    }
    await assert.rejects(readConfirmation(new File(['<svg/>'], '截图.svg', { type: 'image/svg+xml' })), /PNG/);
    await assert.rejects(readConfirmation(new File([Buffer.alloc(1_125_001)], '超大截图.png', { type: 'image/png' })), /不会压缩/);
  } finally { global.FileReader = previousReader; global.Image = previousImage; global.document = previousDocument; }
});

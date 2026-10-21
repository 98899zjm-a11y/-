'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createBridgeFixture, reply, privateImage, configKey, oldConfig, newConfig, pictureBytes, settle } = require('./native-bridge-fixture.cjs');
const source = '/api/images/' + privateImage;

test('WKWebView自定义scheme的origin差异不影响私有图片，其他来源和非规范URL不得下载或分享', async () => {
  for (const origin of ['capacitor://localhost', 'null']) {
    const fixture = await createBridgeFixture({ location: { href: 'capacitor://localhost/home', origin } }), client = fixture.clients[0];
    for (const address of [source, 'capacitor://localhost' + source]) {
      const image = fixture.newImage(); image.src = address; await settle();
      assert.match(image.src, /^blob:/, `${origin}: ${address}`);
      assert.deepEqual(Buffer.from(await fixture.blobs.get(image.src).arrayBuffer()), pictureBytes.png);
    }
    assert.equal(client.imageCalls.length, 1, '相对与绝对私有地址共享同一缓存');
    const before = client.imageCalls.length;
    for (const address of ['http://localhost' + source, 'https://localhost' + source, 'capacitor://another-host' + source, 'capacitor://localhost:8080' + source, 'capacitor://staff:password@localhost' + source, source + '?token=old', source + '#fragment']) {
      const image = fixture.newImage(); image.src = address; await settle();
      assert.ok(!image.src.startsWith('blob:'), `${origin}: ${address}`);
      const result = await fixture.bridge.saveImage({ src: address, name: '非法来源截图' });
      assert.equal(result.ok, false, `${origin}: ${address}`);
    }
    assert.equal(client.imageCalls.length, before, '非规范来源不能交给私有图片传输');
    assert.equal(fixture.writes.length, 0); assert.equal(fixture.shares.length, 0);
  }
});

test('手机首次打开不创建账号；连接配置只接受店内私有IPv4、合法端口和完整连接码', async () => {
  const fixture = await createBridgeFixture({ saved: null });
  assert.equal(fixture.clients.length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(await fixture.bridge.request({ path: '/auth/status' }))), { ok: true, status: 200, data: { needsSetup: false, authenticated: false } });
  for (const host of ['8.8.8.8', 'localhost', 'example.com', '127.0.0.1', '169.254.0.1', '172.32.0.1', '192.168.1.256']) {
    const result = await fixture.bridge.setConnection({ mode: 'client', ...newConfig, host });
    assert.equal(result.ok, false, host); assert.equal(fixture.clients.length, 0, host);
  }
  for (const patch of [{ mode: 'host' }, { port: 65536 }, { code: 'short' }]) assert.equal((await fixture.bridge.setConnection({ mode: 'client', ...newConfig, ...patch })).ok, false);
  const result = await fixture.bridge.setConnection({ mode: 'client', ...newConfig });
  assert.equal(result.ok, true); assert.equal(result.host, newConfig.host);
  assert.equal(JSON.parse(fixture.storage.get(configKey)).code, newConfig.code);
});

test('Capacitor原生HTTP只允许两个固定协议路径，并禁止互联网、凭证、query/hash和重定向', async () => {
  const fixture = await createBridgeFixture(), transport = fixture.clients[0].transport;
  const base = 'http://192.168.1.20:31831';
  assert.equal(await transport.get(base + '/jewelry-identity'), '{"native":true}');
  await transport.post(base + '/jewelry-lan', '{"encrypted":"fixture"}');
  assert.equal(fixture.http.length, 2);
  assert.equal(fixture.http[0].disableRedirects, true); assert.equal(fixture.http[0].responseType, 'text');
  assert.equal(fixture.http[1].method, 'POST'); assert.equal(fixture.http[1].data.encrypted, 'fixture');
  for (const address of ['https://192.168.1.20/jewelry-identity', 'http://8.8.8.8/jewelry-identity', 'http://localhost/jewelry-identity', 'http://192.168.1.20/other', 'http://192.168.1.20/jewelry-lan?leak=1', 'http://192.168.1.20/jewelry-lan#fragment', 'http://staff:password@192.168.1.20/jewelry-identity', 'http://192.168.1.20@evil.example/jewelry-identity']) await assert.rejects(transport.get(address), /地址无效/, address);
  assert.equal(fixture.http.length, 2, '非法目的地不得调用原生HTTP插件');
  fixture.state.nextHttpReply = { status: 200, url: 'http://192.168.1.21:31831/jewelry-identity', data: '{}' };
  await assert.rejects(transport.get(base + '/jewelry-identity'), /跳转/);
  fixture.state.nextHttpReply = { status: 302, url: base + '/jewelry-identity', data: '{}' };
  await assert.rejects(transport.get(base + '/jewelry-identity'), /主机/);
  fixture.state.native = false;
  const before = fixture.http.length;
  await assert.rejects(transport.get(base + '/jewelry-identity'), /安装版/);
  assert.equal(fixture.http.length, before);
});

test('连接状态遵循LAN客户端的验证结果，403通信失败不能误显示已连接', async () => {
  const fixture = await createBridgeFixture(), client = fixture.clients[0];
  await fixture.bridge.request({ path: '/auth/status' }); assert.equal((await fixture.bridge.getConnection()).running, true);
  client.dispatchHandler = async () => reply(403, { error: '主机身份验证失败' });
  await fixture.bridge.request({ path: '/api/bootstrap' });
  assert.equal(client.connected, false); assert.equal((await fixture.bridge.getConnection()).running, false);
});

test('私有图片转换成原字节blob并缓存；业务401、登录切换和退出撤销全部旧blob', async () => {
  const fixture = await createBridgeFixture(), client = fixture.clients[0];
  await fixture.bridge.request({ path: '/auth/login', method: 'POST' });
  const first = fixture.newImage(); first.src = source; await settle();
  assert.match(first.src, /^blob:/); assert.equal(first.dataset.xjyPrivateSource, source);
  assert.deepEqual(Buffer.from(await fixture.blobs.get(first.src).arrayBuffer()), pictureBytes.png);
  const second = fixture.newImage(); second.src = source; await settle();
  assert.equal(second.src, first.src); assert.equal(client.imageCalls.length, 1);
  const firstBlob = first.src;
  client.dispatchHandler = async () => reply(401, { error: '登录已失效' });
  await fixture.bridge.request({ path: '/api/quotes' }); assert.ok(fixture.revoked.includes(firstBlob));
  client.dispatchHandler = async () => reply(200, { authenticated: true, user: { id: 'staff-B' } });
  await fixture.bridge.request({ path: '/auth/login', method: 'POST' });
  const next = fixture.newImage(); next.src = source; await settle();
  assert.notEqual(next.src, firstBlob); assert.equal(client.imageCalls.length, 2);
  await fixture.bridge.request({ path: '/auth/logout', method: 'POST' }); assert.ok(fixture.revoked.includes(next.src));
});

test('图片加载401通知登录失效并撤销已经缓存的私有图片', async () => {
  const fixture = await createBridgeFixture(), client = fixture.clients[0];
  const cached = fixture.newImage(); cached.src = source; await settle(); const oldBlob = cached.src;
  client.imageHandler = async () => new Response('{}', { status: 401, headers: { 'content-type': 'application/json' } });
  const denied = fixture.newImage(); denied.src = '/api/images/22345678-1234-4234-8234-123456789abc'; await settle();
  assert.equal(fixture.authEvents.length, 1); assert.ok(fixture.revoked.includes(oldBlob));
  assert.ok(!denied.src.startsWith('blob:'));
});

test('已验证主机返回图片权限403保留会话，身份未验证的403清空私有缓存', async () => {
  const fixture = await createBridgeFixture(), client = fixture.clients[0];
  await fixture.bridge.request({ path: '/auth/login', method: 'POST' });
  const cached = fixture.newImage(); cached.src = source; await settle();
  client.imageHandler = async () => new Response('{}', { status: 403, headers: { 'content-type': 'application/json' } });
  const forbidden = fixture.newImage(); forbidden.src = '/api/images/42345678-1234-4234-8234-123456789abc'; await settle();
  assert.equal(fixture.authEvents.length, 0); assert.equal(fixture.revoked.length, 0);
  client.connected = false;
  const unverified = fixture.newImage(); unverified.src = '/api/images/52345678-1234-4234-8234-123456789abc'; await settle();
  assert.equal(fixture.authEvents.length, 1); assert.ok(fixture.revoked.includes(cached.src));
});

test('退出时仍在下载的旧私有图片不得在新会话创建blob', async () => {
  const fixture = await createBridgeFixture(), client = fixture.clients[0];
  let complete;
  client.imageHandler = () => new Promise(resolve => { complete = resolve; });
  const pending = fixture.newImage(); pending.src = source; await settle();
  await fixture.bridge.request({ path: '/auth/logout', method: 'POST' });
  complete(new Response(pictureBytes.png, { headers: { 'content-type': 'image/png' } })); await settle();
  assert.equal(fixture.blobs.size, 0); assert.ok(!pending.src.startsWith('blob:'));
});

test('旧图片任务结束不能移除新会话中同一图片的新缓存任务', async () => {
  const fixture = await createBridgeFixture(), client = fixture.clients[0], completions = [];
  client.imageHandler = () => new Promise(resolve => completions.push(resolve));
  const previous = fixture.newImage(); previous.src = source; await settle();
  await fixture.bridge.request({ path: '/auth/logout', method: 'POST' });
  const current = fixture.newImage(); current.src = source; await settle();
  assert.equal(client.imageCalls.length, 2);
  completions[0](new Response(pictureBytes.png, { headers: { 'content-type': 'image/png' } })); await settle();
  const shared = fixture.newImage(); shared.src = source; await settle();
  assert.equal(client.imageCalls.length, 2, '旧任务catch不得删除当前会话的缓存');
  completions[1](new Response(pictureBytes.png, { headers: { 'content-type': 'image/png' } })); await settle();
  assert.equal(current.src, shared.src); assert.match(current.src, /^blob:/);
  assert.ok(!previous.src.startsWith('blob:'));
});

test('保存PNG/JPEG/WebP截图通过原生文件与分享接口，保持全部原字节及真实扩展名', async () => {
  const fixture = await createBridgeFixture(), client = fixture.clients[0];
  for (const [extension, bytes] of Object.entries(pictureBytes)) {
    const type = extension === 'jpg' ? 'jpeg' : extension;
    const result = await fixture.bridge.saveImage({ src: `data:image/${type};base64,${bytes.toString('base64')}`, name: '客户/确认.png' });
    assert.equal(result.ok, true);
    const write = fixture.writes.at(-1);
    assert.equal(write.directory, 'CACHE'); assert.equal(write.path, `quotes/客户确认.${extension}`);
    assert.deepEqual(Buffer.from(write.data, 'base64'), bytes);
    assert.equal(fixture.shares.at(-1).files[0], 'file:///native-cache/' + write.path);
  }
  client.imageHandler = async () => new Response(pictureBytes.webp, { headers: { 'content-type': 'image/webp' } });
  const result = await fixture.bridge.saveImage({ src: source, name: '历史确认.jpg' });
  assert.equal(result.ok, true); assert.equal(fixture.writes.at(-1).path, 'quotes/历史确认.webp');
  assert.deepEqual(Buffer.from(fixture.writes.at(-1).data, 'base64'), pictureBytes.webp);
});

test('保存原图遇图片401也通知失效、清理旧缓存，且不得写文件或打开分享', async () => {
  const fixture = await createBridgeFixture(), client = fixture.clients[0];
  const cached = fixture.newImage(); cached.src = source; await settle(); const oldBlob = cached.src;
  client.imageHandler = async () => new Response('{}', { status: 401, headers: { 'content-type': 'application/json' } });
  const result = await fixture.bridge.saveImage({ src: '/api/images/32345678-1234-4234-8234-123456789abc', name: '历史截图' });
  assert.equal(result.ok, false); assert.equal(fixture.authEvents.length, 1); assert.ok(fixture.revoked.includes(oldBlob));
  assert.equal(fixture.writes.length, 0); assert.equal(fixture.shares.length, 0);
});

test('原图body还未读取完便退出登录，应取消保存且不得把旧会话图片送入系统分享', async () => {
  const fixture = await createBridgeFixture(), client = fixture.clients[0];
  let complete, reading = false;
  client.imageHandler = async () => ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'image/png' }), arrayBuffer: () => { reading = true; return new Promise(resolve => { complete = resolve; }); } });
  const pending = fixture.bridge.saveImage({ src: source, name: '私有旧会话截图' }); await settle();
  assert.equal(reading, true);
  await fixture.bridge.request({ path: '/auth/logout', method: 'POST' });
  complete(Uint8Array.from(pictureBytes.png).buffer);
  const result = await pending;
  assert.equal(result.ok, false); assert.equal(fixture.writes.length, 0); assert.equal(fixture.shares.length, 0);
});

test('文件正在写入本机缓存时退出，也不能继续打开旧会话截图的系统分享', async () => {
  const fixture = await createBridgeFixture(); let complete;
  fixture.state.writeFile = input => { fixture.writes.push(input); return new Promise(resolve => { complete = resolve; }); };
  const pending = fixture.bridge.saveImage({ src: source, name: '私有历史确认' }); await settle();
  assert.equal(fixture.writes.length, 1);
  await fixture.bridge.request({ path: '/auth/logout', method: 'POST' });
  complete({ uri: 'file:///native-cache/private-old.png' });
  assert.equal((await pending).ok, false); assert.equal(fixture.shares.length, 0);
});

test('新主机验证失败或连接配置无法持久化时，保留原client和缓存，仅关闭候选连接', async () => {
  const fixture = await createBridgeFixture(), previous = fixture.clients[0];
  await fixture.bridge.request({ path: '/auth/login', method: 'POST' });
  const cached = fixture.newImage(); cached.src = source; await settle();
  const oldStorage = fixture.storage.get(configKey);
  fixture.state.failStorage = true;
  const result = await fixture.bridge.setConnection({ mode: 'client', ...newConfig });
  assert.equal(result.ok, false); assert.match(result.error, /保存/);
  assert.equal(fixture.clients[1].closed, true); assert.equal(previous.closed, false);
  assert.equal((await fixture.bridge.getConnection()).host, oldConfig.host); assert.equal(fixture.storage.get(configKey), oldStorage);
  assert.ok(!fixture.revoked.includes(cached.src));
  const next = fixture.newImage(); next.src = source; await settle(); assert.equal(next.src, cached.src); assert.equal(previous.imageCalls.length, 1);
  const clientCount = fixture.clients.length;
  assert.equal((await fixture.bridge.setConnection({ mode: 'client', ...newConfig, host: 'example.com' })).ok, false);
  assert.equal(fixture.clients.length, clientCount); assert.equal(previous.closed, false);
  fixture.state.failStorage = false;
  fixture.state.configureClient = client => { client.dispatchHandler = async () => reply(403, { error: '主机身份不匹配' }); };
  const rejected = await fixture.bridge.setConnection({ mode: 'client', ...newConfig });
  assert.equal(rejected.ok, false); assert.match(rejected.error, /身份/);
  assert.equal(fixture.clients.at(-1).closed, true); assert.equal(previous.closed, false);
  assert.equal(fixture.storage.get(configKey), oldStorage); assert.ok(!fixture.revoked.includes(cached.src));
});

'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
let built;
async function exportsOfBridge() {
  if (!built) built = Promise.resolve(require('./renderer-test-loader.cjs').loadRenderer('browser-bridge')); return built;
}
const csrfA = 'a'.repeat(64), csrfB = 'b'.repeat(64), origin = 'https://fictional-workspace.invalid';
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
async function fixture(options = {}) {
  const ui = await exportsOfBridge(); assert.equal(typeof ui.installBrowserBridge, 'function', 'browser bridge is missing');
  const calls = [], navigations = [], downloads = [], copied = [], shares = [], memory = new Map();
  const target = {}, location = { origin, href: origin + '/home', assign: value => navigations.push(value) };
  const navigator = options.navigator || {};
  const bridge = ui.installBrowserBridge({
    target, location, navigator, isSecureContext: options.secure !== false, gesture: () => options.gesture !== false,
    storage: { getItem: key => memory.get(key) || null, setItem: (key, value) => memory.set(key, value), removeItem: key => memory.delete(key) },
    fetch: async (url, input) => {
      calls.push({ url, input });
      if (options.fetch) return options.fetch(url, input, calls);
      if (url === origin + '/session') return response({ authenticated: false, needsSetup: false, csrf: csrfA });
      if (url === origin + '/auth/login') return response({ authenticated: true, needsSetup: false, csrf: csrfB, user: { id: 'fictional-staff' } });
      if (url === origin + '/api/internal-modules/status') return response({ modules: [{ id: 'ledger', label: '财务系统', version: 'fake', configured: true, running: true, access: 'operate' }], hostMode: true });
      if (/\/api\/images\//.test(url)) return new Response(Buffer.from(png.split(',')[1], 'base64'), { headers: { 'content-type': 'image/png' } });
      return response({ fixture: 'only fictional data' });
    },
    download: async (blob, name) => { downloads.push({ blob, name }); return true; },
    File, Blob, ClipboardItem: options.ClipboardItem,
    ...options.overrides
  });
  return { bridge, target, calls, navigations, downloads, copied, shares, memory };
}

test('browser API writes acquire a private session and send only same origin JSON with CSRF', async () => {
  const f = await fixture(); const result = await f.bridge.request({ path: '/api/customers', method: 'POST', body: { name: '虚构客户' } });
  assert.equal(result.ok, true); assert.equal(f.calls[0].url, origin + '/session');
  const request = f.calls[1]; assert.equal(request.url, origin + '/api/customers');
  assert.equal(request.input.headers['x-xjy-csrf'], csrfA); assert.equal(request.input.headers['content-type'], 'application/json');
  assert.equal(request.input.credentials, 'same-origin'); assert.equal(request.input.cache, 'no-store'); assert.equal(request.input.redirect, 'error');
  assert.equal(f.target.jewelryDesktop.surface, 'browser');
});
test('successful login rotates the token before the next modification and logout discards cached session', async () => {
  const f = await fixture(); await f.bridge.request({ path: '/auth/login', method: 'POST', body: { username: 'fake', password: 'fictional' } });
  await f.bridge.request({ path: '/api/customers', method: 'PATCH', body: { id: 'fake', name: '虚构' } });
  assert.equal(f.calls.at(-1).input.headers['x-xjy-csrf'], csrfB);
  await f.bridge.request({ path: '/auth/logout', method: 'POST' }); await f.bridge.request({ path: '/api/bootstrap' });
  assert.equal(f.calls.filter(call => call.url.endsWith('/session')).length, 2);
  assert.equal([...f.memory.values()].some(value => value.includes('fictional')), false);
});
test('unsafe URL, encoded traversal, extra native path or setup are refused before any fetch', async () => {
  const f = await fixture();
  for (const input of [{ path: 'https://evil.invalid/api/customers' }, { path: '//evil.invalid/api/customers' }, { path: '/api/../auth/setup' }, { path: '/api/%2e%2e/settings' }, { path: '/api/%2fsecret' }, { path: '/api/customers#frag' }, { path: '/auth/setup', method: 'POST' }, { path: '/api/local/restore', method: 'POST' }, { path: '/api/customers', host: 'evil' }]) {
    assert.equal((await f.bridge.request(input)).ok, false);
  }
  assert.equal(f.calls.length, 0);
});
test('missing or invalid server CSRF token never becomes an authenticated write', async () => {
  const f = await fixture({ fetch: async () => response({ authenticated: true, csrf: 'weak' }) });
  const result = await f.bridge.request({ path: '/api/customers', method: 'POST', body: {} });
  assert.equal(result.ok, false); assert.equal(f.calls.length, 1);
});
test('mobile cannot reconfigure the host, create workspaces, back up databases or install a Windows EXE', async () => {
  const f = await fixture();
  for (const result of [await f.bridge.setConnection({ mode: 'host', host: 'evil' }), await f.bridge.configureModule({ id: 'ledger' }), await f.bridge.createModuleData({ id: 'inventory' }), await f.bridge.backup(), await f.bridge.restore(), await f.bridge.employeeUpdate({ intent: 'install' })]) assert.equal(result.ok, false);
  assert.equal((await f.bridge.getEmployeeUpdateCapability()).canInstall, false); assert.equal(f.calls.length, 0);
  const connection = await f.bridge.getConnection(); assert.equal(connection.host, 'fictional-workspace.invalid'); assert.equal(connection.mode, 'client'); assert.equal(connection.code, undefined);
});
test('module browser entry accepts fixed IDs and never a URL; closing does not undo navigation or stop host', async () => {
  const f = await fixture(); assert.equal((await f.bridge.openModule({ id: 'ledger' })).ok, true);
  assert.deepEqual(f.navigations, ['/modules/ledger/']);
  assert.equal((await f.bridge.openModule({ id: 'https://evil.invalid' })).ok, false);
  assert.equal((await f.bridge.openModule({ id: 'inventory', url: 'https://evil.invalid' })).ok, false);
  await f.bridge.closeModule(); assert.deepEqual(f.navigations, ['/modules/ledger/']);
});
test('module status preserves server permission and does not expose host configuration controls', async () => {
  const f = await fixture(); const status = await f.bridge.getModuleStatus();
  assert.equal(status.hostMode, false); assert.equal(status.modules[0].access, 'operate');
  assert.equal(f.calls.at(-1).url, origin + '/api/internal-modules/status');
});
test('browser remembers only username and leaves password management to the operating system', async () => {
  const f = await fixture(); await f.bridge.rememberLogin({ username: 'fake.staff', password: 'do-not-store', rememberPassword: true });
  const memory = await f.bridge.readLoginMemory(); assert.equal(memory.username, 'fake.staff'); assert.equal(memory.password, ''); assert.equal(memory.hasPassword, false);
  assert.deepEqual([...f.memory.values()], ['fake.staff']);
});
test('image download receives a real validated PNG blob and a filename without filesystem paths', async () => {
  const f = await fixture(); const result = await f.bridge.saveImage({ src: png, name: '../客户报价.png' });
  assert.equal(result.ok, true); assert.equal(result.downloadStarted, true); assert.equal(f.downloads.length, 1);
  assert.equal(f.downloads[0].blob.type, 'image/png'); assert.equal(f.downloads[0].blob.size > 8, true);
  assert.doesNotMatch(f.downloads[0].name, /[\\/]/); assert.match(result.message, /下载|确认/);
});
test('same origin protected images use cookies without browser or server cache', async () => {
  const f = await fixture(); assert.equal((await f.bridge.saveImage({ src: '/api/images/11111111-1111-4111-8111-111111111111', name: '报价.png' })).ok, true);
  const request = f.calls.at(-1); assert.equal(request.input.credentials, 'same-origin'); assert.equal(request.input.cache, 'no-store'); assert.equal(request.input.redirect, 'error');
});
test('image helper refuses remote hosts, SVG data and mislabeled PNG bytes', async () => {
  const f = await fixture();
  for (const src of ['https://evil.invalid/photo.png', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', 'data:image/png;base64,aW52YWxpZA==']) assert.equal((await f.bridge.saveImage({ src, name: '报价.png' })).ok, false);
  assert.equal(f.downloads.length, 0); assert.equal(f.calls.length, 0);
});
test('real clipboard copying writes image/png ClipboardItem and never base64 text', async () => {
  const writes = []; class ClipboardItemFixture { constructor(items) { this.items = items; } }
  const f = await fixture({ ClipboardItem: ClipboardItemFixture, navigator: { clipboard: { write: async items => { writes.push(items); } }, userActivation: { isActive: true } } });
  const result = await f.bridge.copyImage({ src: png, name: '报价.png' }); assert.equal(result.ok, true); assert.equal(writes.length, 1);
  const blob = await writes[0][0].items['image/png']; assert.equal(blob instanceof Blob, true); assert.equal(blob.type, 'image/png');
});
test('clipboard denial, insecure origin or absent gesture never reports success or writes text', async () => {
  class ClipboardItemFixture { constructor(items) { this.items = items; } }
  for (const options of [{ secure: false }, { gesture: false }, { ClipboardItem: ClipboardItemFixture, navigator: { clipboard: { write: async () => { throw new Error('denied'); } } } }]) {
    const f = await fixture(options); const result = await f.bridge.copyImage({ src: png, name: '报价.png' }); assert.equal(result.ok, false); assert.match(result.error, /安全|点|复制|浏览器/);
  }
});
test('system sharing passes a real image file and only resolves success after navigator share completes', async () => {
  const shares = [], f = await fixture({ navigator: { canShare: () => true, share: async value => { shares.push(value); }, userActivation: { isActive: true } } });
  const result = await f.bridge.shareImage({ src: png, name: '报价.png' }); assert.equal(result.ok, true); assert.equal(shares.length, 1);
  assert.equal(shares[0].files[0] instanceof File, true); assert.equal(shares[0].files[0].type, 'image/png'); assert.equal(shares[0].text, undefined);
});
test('cancelled share returns cancelled and failed capability offers explicit save instead of claiming copied', async () => {
  const f = await fixture({ navigator: { canShare: () => true, share: async () => { const e = new Error('cancelled'); e.name = 'AbortError'; throw e; } } });
  const canceled = await f.bridge.shareImage({ src: png, name: '报价.png' }); assert.equal(canceled.ok, false); assert.equal(canceled.canceled, true);
  const unsupported = await fixture(); assert.equal((await unsupported.bridge.shareImage({ src: png, name: '报价.png' })).ok, false); assert.equal(unsupported.downloads.length, 0);
});
test('stale session reads after logout cannot resurrect the previous CSRF cache', async () => {
  let release, sessionCount = 0;
  const f = await fixture({ fetch: async url => { if (url.endsWith('/session')) { sessionCount++; if (sessionCount === 2) return new Promise(resolve => { release = () => resolve(response({ authenticated: true, csrf: csrfA })); }); return response({ authenticated: false, csrf: csrfA }); } return response({}); } });
  await f.bridge.request({ path: '/api/bootstrap' }); await f.bridge.request({ path: '/auth/logout', method: 'POST' });
  const pending = f.bridge.request({ path: '/api/bootstrap' }); await new Promise(resolve => setImmediate(resolve));
  f.bridge.destroySession(); release(); assert.equal((await pending).ok, false);
});
test('failed logout still destroys local CSRF cache instead of continuing the old session', async () => {
  const f = await fixture({ fetch: async url => { if (url.endsWith('/session')) return response({ authenticated: true, csrf: csrfA }); if (url.endsWith('/auth/logout')) throw new Error('fictional network interruption'); return response({}); } });
  await f.bridge.request({ path: '/api/bootstrap' }); assert.equal((await f.bridge.request({ path: '/auth/logout', method: 'POST' })).ok, false);
  await f.bridge.request({ path: '/api/customers', method: 'POST', body: { name: '虚构客户' } });
  assert.equal(f.calls.filter(call => call.url.endsWith('/session')).length, 2);
});

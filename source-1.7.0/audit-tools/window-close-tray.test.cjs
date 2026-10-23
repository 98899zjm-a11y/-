'use strict';
// Guest-only real release-app glue. All Electron/IO/business factories below
// are explicit boundary doubles; no SQL, socket, EXE, real tray or product runs.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const ROOT = path.resolve(__dirname, '..');
if (process.platform !== 'win32' || os.userInfo().username.toLowerCase() !== 'wdagutilityaccount' || ROOT.toLowerCase() !== 'c:\\xjy-work\\xjy-web-stage1') throw Error('Tray lifecycle tests require the fixed actual Windows Sandbox');
const guard = require('../stage1/isolation.cjs').createIsolationGuard(ROOT);
const proof = require('node:child_process').spawnSync('C:\\Python314\\python.exe', ['-I', '-B', guard.assertPath(path.join(ROOT, 'stage1/validate-sandbox-context.py'))], { cwd: ROOT, windowsHide: true, encoding: 'utf8' });
if (proof.error || proof.status !== 0) throw Error('Unchanged actual Guest admission failed before source evaluation');
JSON.parse(proof.stdout);
const test = require('node:test'), assert = require('node:assert/strict');
const vm = require('node:vm'), { EventEmitter } = require('node:events'), crypto = require('node:crypto');
const SOURCE_FILE = guard.assertPath(path.join(ROOT, 'project/desktop/release-app.cjs'));
const sourceStat = fs.lstatSync(SOURCE_FILE);
if (!sourceStat.isFile() || sourceStat.isSymbolicLink() || sourceStat.nlink !== 1) throw Error('Real release-app must be an ordinary source file');
const SOURCE = fs.readFileSync(SOURCE_FILE, 'utf8');
const SOURCE_SHA = crypto.createHash('sha256').update(SOURCE).digest('hex');
const PID = 4242; // VM-only process identity. No process with this PID is touched.
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function cancelEvent() { return { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } }; }

async function fixture(options = {}) {
  const role = options.role || 'host', employee = role === 'employee';
  const virtualRoot = guard.assertPath(path.join(ROOT, 'runtime/tray-lifecycle-virtual'));
  const calls = [], closeOrder = [], errors = [], immediate = [], handlers = new Map(), windows = [], trays = [];
  const ready = deferred(), pendingRequest = deferred();
  let pendingEntered = false, updaterOptions, hostOptions, networkOptions, terminal = null;
  let user = { id: employee ? 'fictional-employee' : 'fictional-admin', username: employee ? 'fixture-employee' : 'fixture-admin', role: employee ? 'employee' : 'admin', active: true };
  let authenticated = true, networkMode = employee ? 'client' : 'standalone';
  let confirmation = async () => ({ response: 1 });
  const count = name => calls.filter(item => item === name).length;
  const boundary = name => { calls.push('DENIED:' + name); throw Error('TRAY_FIXTURE_BOUNDARY: forbidden real dependency or side effect: ' + name); };
  const closePart = async name => { calls.push(name); closeOrder.push(name); if (options.cleanupFailure === name) throw Error('TRAY_INJECTED_CLEANUP_FAILURE:' + name); };
  const storage = Object.freeze({ root: virtualRoot, profileDir: path.join(virtualRoot, employee ? 'employee-profile' : 'host-profile'), dataDir: employee ? null : path.join(virtualRoot, 'fictional-sales'), employeeClient: employee, imageDir: path.join(virtualRoot, 'fictional-images') });
  const clientBackend = { close: () => closePart('client-backend.close') };
  const hostBackend = { close: () => boundary('host backend must be closed through hostRuntime') };
  const network = {
    request: async input => {
      calls.push('network.request:' + input?.path);
      if (input?.path === '/auth/status') return { ok: true, status: 200, data: { needsSetup: false, authenticated, ...(authenticated ? { user: { ...user } } : {}) } };
      if (input?.path === '/api/tray-fixture/pending') { pendingEntered = true; await pendingRequest.promise; return { ok: true, status: 200, data: { finished: true } }; }
      return boundary('unregistered network request ' + input?.path);
    },
    info: () => ({ mode: networkMode, clientOnly: employee }),
    assertLocal: () => { calls.push('network.assertLocal'); if (networkMode === 'client') throw Error('FICTIONAL_CLIENT_IS_NOT_HOST'); },
    close: () => closePart('network.close'),
  };
  const hostRuntime = { backend: hostBackend, moduleAdapter: {}, withRequest: action => action(), close: () => closePart('host.close') };
  const updater = { getCapability: async () => ({ supported: true, canInstall: employee }), getState: () => ({ phase: 'idle' }), run: () => boundary('real updater run'), close: () => closePart('updater.close') };
  const moduleViews = { close: () => closePart('modules.close'), clear: async () => { calls.push('modules.clear'); }, hide: () => { calls.push('modules.hide'); } };

  class FakeWindow extends EventEmitter {
    constructor(input) {
      super(); this.options = input; this.visible = false; this.destroyed = false; this.minimized = false; this.loaded = null;
      const web = new EventEmitter(); web.mainFrame = { url: 'jewelry://app/home' };
      web.setWindowOpenHandler = fn => { this.openHandler = fn; };
      web.session = { clearStorageData: () => boundary('real session storage') };
      this.webContents = web; windows.push(this); calls.push('window.create');
    }
    setMenu(value) { assert.equal(value, null); }
    isDestroyed() { return this.destroyed; }
    isMinimized() { return this.minimized; }
    restore() { this.minimized = false; calls.push('window.restore'); }
    hide() { this.visible = false; calls.push('window.hide'); }
    show() { assert.equal(this.destroyed, false, 'a destroyed window cannot be restored'); this.visible = true; calls.push('window.show'); }
    focus() { assert.equal(this.destroyed, false); calls.push('window.focus'); }
    async loadURL(url) { assert.equal(url, 'jewelry://app/home'); this.loaded = url; calls.push('window.loadURL'); }
    close() {
      if (this.destroyed) return null;
      const event = cancelEvent(); this.emit('close', event);
      if (!event.defaultPrevented) { this.destroyed = true; this.visible = false; calls.push('window.closed'); this.emit('closed'); if (windows.every(item => item.destroyed)) app.emit('window-all-closed'); }
      return event;
    }
  }
  class FakeTray extends EventEmitter {
    constructor(icon) {
      super(); calls.push('tray.construct');
      assert.equal(icon, path.join(path.dirname(SOURCE_FILE), 'assets/icon.png'));
      if (options.trayFailure) throw Error('TRAY_INJECTED_CONSTRUCTOR_FAILURE');
      this.destroyed = false; this.menu = null; this.toolTip = ''; trays.push(this);
    }
    setToolTip(value) { this.toolTip = value; }
    setContextMenu(menu) { this.menu = menu; }
    destroy() { calls.push('tray.destroy'); closeOrder.push('tray.destroy'); this.destroyed = true; }
    isDestroyed() { return this.destroyed; }
  }
  const app = new EventEmitter();
  Object.assign(app, {
    isPackaged: true,
    getVersion: () => '1.6.0',
    getPath: name => { if (name === 'userData' || name === 'sessionData') return storage.profileDir; if (name === 'exe') return path.join(virtualRoot, 'program/XJY-fixture.exe'); return boundary('unregistered app path ' + name); },
    setPath: (name, value) => { assert.ok(['userData', 'sessionData'].includes(name)); assert.equal(value, storage.profileDir); calls.push('app.setPath:' + name); },
    requestSingleInstanceLock: () => { calls.push('app.lock'); return options.duplicate !== true; },
    whenReady: () => { calls.push('app.whenReady'); return ready.promise; },
    quit: () => {
      calls.push('app.quit.request'); if (terminal) return;
      if (count('app.quit.request') > 20) throw Error('TRAY_FIXTURE_RECURSIVE_QUIT');
      const event = cancelEvent(); app.emit('before-quit', event); if (event.defaultPrevented) return;
      for (const win of windows) if (!win.destroyed) win.close();
      if (windows.some(win => !win.destroyed)) return;
      terminal = { mode: 'quit', code: 0 }; calls.push('app.terminal');
    },
    exit: code => { calls.push('app.exit.request'); if (terminal) return; for (const win of windows) { win.destroyed = true; win.visible = false; } terminal = { mode: 'exit', code }; calls.push('app.terminal'); },
  });
  const localSession = {
    setPermissionRequestHandler: fn => { calls.push('permission.request.install'); localSession.permissionRequest = fn; },
    setPermissionCheckHandler: fn => { calls.push('permission.check.install'); localSession.permissionCheck = fn; },
    webRequest: { onBeforeRequest: fn => { localSession.beforeRequest = fn; } },
    protocol: { handle: (scheme, fn) => { assert.equal(scheme, 'jewelry'); localSession.handler = fn; } },
  };
  const electron = {
    app, BrowserWindow: FakeWindow, Tray: FakeTray,
    Menu: { buildFromTemplate: items => ({ items: items.map(item => ({ ...item })) }) },
    dialog: { showErrorBox: (title, message) => { errors.push({ title, message }); }, showMessageBox: async (_window, input) => { calls.push('dialog.confirm'); return confirmation(input); } },
    ipcMain: { handle: (name, fn) => { assert.equal(handlers.has(name), false, 'native channels register once'); handlers.set(name, fn); }, on: () => {} },
    protocol: { registerSchemesAsPrivileged: input => { assert.equal(input[0].scheme, 'jewelry'); } },
    session: { defaultSession: localSession },
    clipboard: {}, nativeImage: {}, safeStorage: {}, ClipboardItem: class {}, WebContentsView: class {},
  };
  const forbiddenFs = new Proxy({}, { get: (_target, key) => boundary('node:fs.' + String(key)) });
  const dependencies = new Map([
    ['./app-info.cjs', { createAppInfoProvider: input => {
      if (!input || typeof input.getVersion !== 'function' || Object.keys(input).length !== 1) return boundary('unexpected app-info factory input');
      return Object.freeze({ getAppInfo: () => Object.freeze({ appVersion: input.getVersion() }) });
    } }],
    ['./release-storage.cjs', { resolveReleaseStorage: input => { calls.push('storage.resolve'); assert.equal(input.employeeClient, employee); return storage; } }],
    ['./storage-locations.cjs', { createClientBackend: () => { if (!employee) return boundary('client backend on Host'); calls.push('client-backend.create'); return clientBackend; } }],
    ['./release-host-services.cjs', { createReleaseHostServices: async input => { if (employee) return boundary('Host services on employee'); calls.push('host.create'); hostOptions = input; return hostRuntime; } }],
    ['./network-workspace.cjs', { createNetworkWorkspace: async input => { calls.push('network.create'); assert.equal(input.clientOnly, employee); assert.equal(input.backend, employee ? clientBackend : hostBackend); networkOptions = input; return network; } }],
    ['./native-employee-update.cjs', { createNativeEmployeeUpdate: input => { calls.push('updater.create'); assert.equal(input.employeeClient, employee); updaterOptions = input; return updater; } }],
    ['./module-views.cjs', { createModuleViews: input => { calls.push('modules.create'); assert.equal(input.network, network); assert.equal(input.window, windows[0]); return moduleViews; } }],
    ['./print-settings.cjs', { createPrintSettings: () => ({ read: () => ({}) }) }],
    ['./image-output.cjs', { createImageOutput: () => ({}) }],
    ['./clipboard-output.cjs', { copyQuoteImage: () => boundary('clipboard output') }],
    ['./warranty-docx.cjs', { createWarrantyDocx: () => boundary('DOCX output') }],
    ['./credentials.cjs', { createLoginMemory: () => ({}), createLoginReceipt: () => ({ clear: () => { calls.push('login-receipt.clear'); }, record: () => boundary('login receipt record') }), scopeForConnection: () => boundary('unneeded credential scope') }],
    ['./backup.cjs', { inside: () => boundary('unneeded filesystem protocol') }],
    ['./generated/release-pins.cjs', Object.freeze({})],
  ]);
  function requireBoundary(name) {
    if (name === 'electron') return electron;
    if (name === 'node:path') return path;
    if (name === 'node:fs') return forbiddenFs;
    if (dependencies.has(name)) return dependencies.get(name);
    return boundary('require ' + name);
  }
  const context = vm.createContext({
    require: requireBoundary, module: { exports: {} }, exports: {}, __dirname: path.dirname(SOURCE_FILE),
    process: Object.freeze({ pid: PID, argv: ['fixture', 'release-entry.cjs'], env: Object.freeze({}), resourcesPath: path.join(virtualRoot, 'program/resources') }),
    Buffer, URL, Response, Headers, console,
    setImmediate: fn => { immediate.push(fn); return immediate.length; },
    setTimeout: () => boundary('unregistered timer'), clearTimeout: () => {},
  });
  // Installed is only an immutable VM role fixture. No real activation, profile
  // or installed storage is read; the actual outer test remains Guest-only.
  Object.defineProperty(context, '__xjyReleaseAdmission', { value: Object.freeze({ mode: 'installed', role, publicAccess: false }), writable: false, configurable: false });
  vm.runInContext(SOURCE, context, { filename: SOURCE_FILE, timeout: 3000 });
  ready.resolve();
  async function flush() { for (let turn = 0; turn < 60; turn++) { await Promise.resolve(); if (immediate.length) immediate.shift()(); } }
  await flush();
  if (!options.duplicate && !options.trayFailure) {
    assert.equal(errors.length, 0, 'Unexpected startup failure is a harness/dependency issue, not the target employee tray RED: ' + JSON.stringify(errors));
    assert.equal(windows.length, 1, 'real whenReady must create its BrowserWindow');
    assert.equal(windows[0].loaded, 'jewelry://app/home');
    assert.equal(count('app.whenReady'), 1);
  }
  function tray() { assert.equal(trays.length, 1, 'one recoverable tray must exist for this role'); assert.equal(trays[0].destroyed, false); return trays[0]; }
  function item(kind) {
    const menu = tray().menu; assert.ok(menu && Array.isArray(menu.items), 'real startup installs the role menu');
    const matches = menu.items.filter(row => kind === 'open' ? /^打开/.test(row.label || '') : /退出|关闭/.test(row.label || ''));
    assert.equal(matches.length, 1, 'one ' + kind + ' menu action must exist'); return matches[0];
  }
  function invoke(name, input) { const handler = handlers.get(name); assert.equal(typeof handler, 'function'); const win = windows[0]; return handler({ sender: win.webContents, senderFrame: win.webContents.mainFrame }, input); }
  return {
    role, calls, errors, windows, trays, count, closeOrder, flush, app, localSession, requireBoundary,
    get window() { return windows[0]; }, get terminal() { return terminal; },
    get updaterOptions() { return updaterOptions; }, get hostOptions() { return hostOptions; }, get networkOptions() { return networkOptions; },
    get pendingEntered() { return pendingEntered; }, resolvePending: () => pendingRequest.resolve(),
    setUser: value => { user = { ...user, ...value }; }, setAuthenticated: value => { authenticated = value; }, setMode: value => { networkMode = value; }, setConfirmation: fn => { confirmation = fn; },
    tray, item, invoke, click: async kind => { await item(kind).click(); await flush(); },
  };
}

function assertRoleIsolation(f, role) {
  assert.equal(f.count('host.create'), role === 'host' ? 1 : 0);
  assert.equal(f.count('client-backend.create'), role === 'employee' ? 1 : 0);
  assert.equal(f.networkOptions.clientOnly, role === 'employee');
  assert.equal(f.count('window.create'), 1);
  assert.equal(f.calls.some(name => name.startsWith('DENIED:')), false, 'no real factory, SQL, service, filesystem or process escape');
}
function assertStopped(f, expected) {
  assert.equal(f.terminal?.code, expected);
  assert.equal(f.count('app.terminal'), 1, 'normal terminal state occurs once');
  assert.equal(f.windows.every(win => win.destroyed), true, 'no hidden live VM window may remain after termination');
  assert.equal(f.count('modules.close'), 1); assert.equal(f.count('updater.close'), 1); assert.equal(f.count('network.close'), 1);
  assert.equal(f.count(f.role === 'employee' ? 'client-backend.close' : 'host.close'), 1);
}

test('H00 existing Host startup, X-to-tray restore and authorized normal shutdown smoke', async t => {
  const f = await fixture(); t.diagnostic('real release-app source SHA256=' + SOURCE_SHA);
  assertRoleIsolation(f, 'host'); assert.match(f.tray().toolTip, /主机/);
  assert.equal(f.localSession.permissionCheck(), false);
  let allowed; f.localSession.permissionRequest(null, 'camera', result => { allowed = result; }); assert.equal(allowed, false);
  const event = f.window.close(); assert.equal(event.defaultPrevented, true); assert.equal(f.window.destroyed, false); assert.equal(f.window.visible, false); assert.equal(f.terminal, null);
  f.window.minimized = true; f.tray().emit('double-click'); assert.equal(f.window.visible, true); assert.equal(f.window.minimized, false); assert.equal(f.count('window.focus'), 1);
  await f.click('exit'); assertStopped(f, 0);
  assert.deepEqual(f.closeOrder, ['modules.close', 'updater.close', 'network.close', 'host.close', 'tray.destroy']);
  assert.equal(f.count('network.assertLocal'), 1); assert.equal(f.count('network.request:/auth/status'), 2); assert.equal(f.count('dialog.confirm'), 1);
});

test('H01 Host tray construction failure uses original startup error and drained exit1 control', async () => {
  const f = await fixture({ trayFailure: true });
  assert.equal(f.errors.length, 1); assert.match(f.errors[0].message, /TRAY_INJECTED_CONSTRUCTOR_FAILURE/);
  assert.equal(f.count('tray.construct'), 1); assert.equal(f.trays.length, 0); assertStopped(f, 1);
});

test('H02 Host local, admin and post-confirmation permissions remain live', async () => {
  for (const mode of ['staff', 'client', 'revoked-after-confirm']) {
    const f = await fixture();
    if (mode === 'staff') f.setUser({ role: 'employee' });
    if (mode === 'client') f.setMode('client');
    if (mode === 'revoked-after-confirm') f.setConfirmation(async () => { f.setAuthenticated(false); return { response: 1 }; });
    await f.click('exit');
    assert.equal(f.terminal, null, mode); assert.equal(f.count('host.close'), 0, mode); assert.equal(f.tray().destroyed, false);
    assert.equal(f.errors.length, 1, mode); assert.equal(f.window.visible, true, mode);
    assert.equal(f.count('dialog.confirm'), mode === 'revoked-after-confirm' ? 1 : 0);
    assert.equal(f.count('network.request:/auth/status'), mode === 'client' ? 0 : mode === 'staff' ? 1 : 2);
  }
});

test('H03 duplicate release-app instance never initializes factories or windows', async () => {
  const f = await fixture({ duplicate: true });
  assert.equal(f.terminal?.code, 0); assert.equal(f.count('app.lock'), 1); assert.equal(f.count('app.whenReady'), 0);
  assert.equal(f.count('host.create'), 0); assert.equal(f.count('client-backend.create'), 0); assert.equal(f.windows.length, 0); assert.equal(f.trays.length, 0);
  for (const name of ['node:sqlite', 'node:child_process', 'node:net', './backend.cjs', './runtime.cjs']) assert.throws(() => f.requireBoundary(name), /TRAY_FIXTURE_BOUNDARY/);
});

test('E01 employee ordinary X only hides and does not close connection or updater', async () => {
  const f = await fixture({ role: 'employee' }); const event = f.window.close(); await f.flush();
  assert.equal(event.defaultPrevented, true, 'employee ordinary close must be cancelled before window destruction');
  assert.equal(f.window.visible, false); assert.equal(f.window.destroyed, false); assert.equal(f.terminal, null);
  assert.equal(f.count('app.quit.request'), 0); assert.equal(f.closeOrder.length, 0);
  f.window.close(); assert.equal(f.count('window.create'), 1); assert.equal(f.trays.length, 1); assert.equal(f.count('updater.close'), 0);
  assertRoleIsolation(f, 'employee');
});

test('E02 employee tray double-click and Open restore the same window', async () => {
  const f = await fixture({ role: 'employee' }), original = f.window;
  assert.match(f.tray().toolTip, /员工/); assert.doesNotMatch(f.tray().toolTip, /主机后台/);
  original.hide(); original.minimized = true; f.tray().emit('double-click'); await f.flush();
  assert.equal(f.window, original); assert.equal(original.visible, true); assert.equal(original.minimized, false); assert.equal(f.count('window.focus'), 1);
  original.hide(); await f.click('open');
  assert.equal(f.window, original); assert.equal(original.visible, true); assert.equal(f.count('window.focus'), 2);
  assert.equal(f.closeOrder.length, 0); assertRoleIsolation(f, 'employee');
});

test('E03 second-instance restores the existing hidden employee without another factory', async () => {
  const f = await fixture({ role: 'employee' }), original = f.window;
  // Direct hide isolates the existing second-instance handler from E01's X bug.
  original.hide(); original.minimized = true; f.app.emit('second-instance'); await f.flush();
  assert.equal(f.window, original); assert.equal(original.visible, true); assert.equal(original.minimized, false); assert.equal(f.count('window.focus'), 1);
  assertRoleIsolation(f, 'employee'); assert.equal(f.terminal, null);
});

test('E04 employee explicit Exit drains the original taskQueue and repeated exit closes once', async () => {
  const f = await fixture({ role: 'employee' });
  assert.match(f.item('exit').label, /员工/); assert.doesNotMatch(f.item('exit').label, /主机/);
  const work = f.invoke('jewelry:request', { path: '/api/tray-fixture/pending' }); await f.flush(); assert.equal(f.pendingEntered, true);
  f.window.hide(); f.item('exit').click(); f.item('exit').click(); await f.flush();
  assert.equal(f.terminal, null, 'pending original taskQueue must delay actual shutdown'); assert.equal(f.closeOrder.length, 0); assert.equal(f.window.destroyed, false);
  f.resolvePending(); assert.equal((await work).ok, true); await f.flush(); assertStopped(f, 0);
  assert.deepEqual(f.closeOrder, ['modules.close', 'updater.close', 'network.close', 'client-backend.close', 'tray.destroy']);
  assert.equal(f.count('network.assertLocal'), 0); assert.equal(f.count('host.close'), 0); assert.equal(f.count('network.request:/auth/status'), 0);
});

test('E05 original upgrade PID and normalExit guard still reaches true shutdown while hidden', async () => {
  const f = await fixture({ role: 'employee' });
  await assert.rejects(f.updaterOptions.requestExit({ pid: PID + 1, normalExit: true }), /升级只能正常退出当前员工程序/);
  await assert.rejects(f.updaterOptions.requestExit({ pid: PID, normalExit: false }), /升级只能正常退出当前员工程序/);
  await f.flush(); assert.equal(f.count('app.quit.request'), 0); assert.equal(f.closeOrder.length, 0);
  f.window.hide(); const result = await f.updaterOptions.requestExit({ pid: PID, normalExit: true }); assert.equal(result.accepted, true);
  await f.flush(); assertStopped(f, 0); assert.equal(f.count('host.close'), 0);
});

test('E06 employee cannot use Host exit even with a fictional admin login', async () => {
  const f = await fixture({ role: 'employee' }); f.setUser({ role: 'admin' });
  const result = await f.invoke('jewelry:exit-host'); await f.flush();
  assert.equal(result.ok, false); assert.equal(f.count('network.assertLocal'), 1); assert.equal(f.count('dialog.confirm'), 0);
  assert.equal(f.count('host.create'), 0); assert.equal(f.count('host.close'), 0); assert.equal(f.terminal, null);
});

test('E07 employee tray construction failure drains startup and leaves no hidden live process model', async () => {
  const f = await fixture({ role: 'employee', trayFailure: true });
  assert.equal(f.count('tray.construct'), 1, 'employee startup must attempt its role tray');
  assert.equal(f.errors.length, 1); assert.match(f.errors[0].message, /TRAY_INJECTED_CONSTRUCTOR_FAILURE/);
  assert.equal(f.trays.length, 0); assertStopped(f, 1); assert.equal(f.count('host.create'), 0);
});

test('E08 cleanup failure keeps employee tray recovery and does not report a terminal exit', async () => {
  const f = await fixture({ role: 'employee', cleanupFailure: 'network.close' });
  f.window.hide(); await f.click('exit');
  assert.equal(f.terminal, null); assert.equal(f.window.destroyed, false); assert.equal(f.count('tray.destroy'), 0);
  assert.equal(f.errors.length, 1); assert.match(f.errors[0].message, /TRAY_INJECTED_CLEANUP_FAILURE/);
  await f.click('open'); assert.equal(f.window.visible, true); assert.equal(f.count('window.create'), 1);
  assert.equal(f.count('client-backend.close'), 0); assert.equal(f.count('host.close'), 0);
});

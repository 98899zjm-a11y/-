'use strict';
// Actual Guest only. Four behavior contracts; no SQLite, business DB, real
// Electron, listener, print worker, archive encryption, cleanup or restore.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..'), hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
if (process.platform !== 'win32' || os.userInfo().username.toLowerCase() !== 'wdagutilityaccount' || ROOT.toLowerCase() !== 'c:\\xjy-work\\xjy-web-stage1') throw Error('Fixed actual offline Guest required; no Host test execution');
const guard = require('../stage1/isolation.cjs').createIsolationGuard(ROOT);
for (const [file, pin] of Object.entries({ 'stage1/sandbox-context.py': '09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249', 'stage1/validate-sandbox-context.py': '867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207' })) if (hash(fs.readFileSync(guard.assertPath(path.join(ROOT, file)))) !== pin) throw Error('Original Guest admission source changed');
const admission = require('node:child_process').spawnSync('C:\\Python314\\python.exe', ['-I', '-B', '-S', guard.assertPath(path.join(ROOT, 'stage1/validate-sandbox-context.py'))], { cwd: ROOT, windowsHide: true, encoding: 'utf8' });
if (admission.error || admission.status !== 0) throw Error('Actual Guest admission failed');
JSON.parse(admission.stdout);
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), { EventEmitter } = require('node:events');
const { createBusinessMaintenanceContext } = require('../project/desktop/business-maintenance-layout.cjs');
const { createBusinessDailyBackups } = require('../project/desktop/business-daily-backup.cjs');
const NOW = new Date('2030-01-09T12:00:00.000Z'), NEXT = new Date('2030-01-09T16:00:00.000Z');
const SECRET = 'SYNTHETIC_BACKUP_CREDENTIAL_DO_NOT_RENDER';
const SOURCES = {}, BASE = guard.assertPath(path.join(ROOT, 'runtime', 'backup-health-tests'));
fs.mkdirSync(BASE, { recursive: true });
const turn = () => new Promise(resolve => setImmediate(resolve));
const clone = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const denied = name => () => { throw Error('NO_SQLITE_OR_REAL_BUSINESS:' + name); };
function source(relative) { const bytes = fs.readFileSync(guard.assertPath(path.join(ROOT, relative))); SOURCES[relative] = hash(bytes); return bytes.toString('utf8'); }

// Same genuine owned context + authenticated synthetic attachment ports as
// tests/business-daily-cache.test.cjs; its test suite is never required.
function fakeService(context) {
  const rows = [], key = crypto.randomBytes(32), calls = { create: 0, probe: 0, cleanup: 0 };
  const behavior = { createGate: null, probeGate: null, createError: null, cleanupError: null };
  const service = {
    list: () => rows.filter(row => context.policy.io.existsSync(row.file)).map(row => ({ ...row })),
    async create({ kind, now = NOW }) {
      calls.create++;
      if (behavior.createGate) await behavior.createGate.promise;
      if (behavior.createError) { const error = behavior.createError; behavior.createError = null; throw error; }
      const file = context.policy.check(path.join(context.layout.backupDir, kind.toUpperCase() + '-' + crypto.randomUUID() + '.xjybak'));
      const body = Buffer.from('SYNTHETIC authenticated attachment; no database or real credential');
      const mac = crypto.createHmac('sha256', key).update(body).digest();
      context.policy.io.writeFileSync(file, Buffer.concat([mac, body]), { flag: 'wx' });
      const row = { file, createdAt: now.toISOString(), kind }; rows.push(row); return { ...row };
    },
    async probe(file, options) {
      calls.probe++;
      assert.equal(options?.requireCurrentSlots, true);
      const bytes = context.policy.io.readFileSync(file), body = bytes.subarray(32);
      assert.ok(crypto.timingSafeEqual(bytes.subarray(0, 32), crypto.createHmac('sha256', key).update(body).digest()));
      if (behavior.probeGate) await behavior.probeGate.promise;
      return true;
    },
    async cleanup() { calls.cleanup++; if (behavior.cleanupError) { const error = behavior.cleanupError; behavior.cleanupError = null; throw error; } return []; },
  };
  return { context, service, rows, calls, behavior };
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(BASE, 'owned-')), layout = {};
  for (const [name, directory] of Object.entries({ dataDir: 'sales', ledgerDir: 'ledger', inventoryDir: 'inventory', profileDir: 'profile', configDir: 'config', runtimeDir: 'runtime', logDir: 'logs', backupDir: 'backups', documentsDir: 'documents', quoteImagesDir: 'quote-images' })) { layout[name] = path.join(root, directory); fs.mkdirSync(layout[name]); }
  const context = createBusinessMaintenanceContext({ root, layout, hostId: 'health-toy-host', profileId: 'health-toy-profile', provisionOwner: true });
  const f = { ...fakeService(context), root, layout, schedulers: [] };
  f.scheduler = () => { const daily = createBusinessDailyBackups({ context, service: f.service, markerName: 'daily-backup-test.json' }); f.schedulers.push(daily); return daily; };
  t.after(async () => { f.behavior.createGate?.resolve(); f.behavior.probeGate?.resolve(); for (const daily of f.schedulers) await daily.stop(); });
  return f; // Retain every synthetic owned fixture for Root's failure evidence.
}
function status(daily, now = NOW) {
  assert.equal(typeof daily.getStatus, 'function', 'DAILY_BACKUP_HEALTH_REQUIRED: actual scheduler.getStatus(now)');
  const value = clone(daily.getStatus(now));
  assert.equal(value.version, 1);
  assert.ok(['running', 'verified-today', 'failed', 'unverified'].includes(value.state));
  assert.match(value.day, /^\d{4}-\d{2}-\d{2}$/);
  for (const key of ['lastAttemptAt', 'lastVerifiedAt']) assert.ok(value[key] === null || typeof value[key] === 'string' && Number.isFinite(Date.parse(value[key])));
  assert.ok(value.lastError === null || value.lastError && typeof value.lastError.code === 'string' && value.lastError.code && typeof value.lastError.message === 'string' && value.lastError.message && Number.isFinite(Date.parse(value.lastError.at)));
  assert.doesNotMatch(JSON.stringify(value), /[A-Za-z]:[\\/]|\\\\|SYNTHETIC_BACKUP_CREDENTIAL_DO_NOT_RENDER|password=|token=/i);
  return value;
}

test('B01 actual daily health waits for full verification and preserves last success after a sanitized failure', async t => {
  const f = fixture(t), daily = f.scheduler(), initial = status(daily);
  assert.equal(initial.state, 'unverified'); assert.equal(initial.day, '2030-01-09');
  assert.equal(initial.lastAttemptAt, null); assert.equal(initial.lastVerifiedAt, null); assert.equal(initial.lastError, null);
  daily.start(); assert.equal(status(daily).state, 'unverified', 'Starting a timer cannot earn verification');
  f.behavior.createGate = deferred(); f.behavior.probeGate = deferred();
  const pending = daily.tick(NOW); await turn();
  assert.equal(status(daily).state, 'running'); assert.equal(status(daily).lastAttemptAt, NOW.toISOString());
  assert.equal(status(daily).lastVerifiedAt, null);
  f.behavior.createGate.resolve(); await turn(); assert.equal(f.calls.probe, 1);
  assert.equal(status(daily).state, 'running', 'create() returning is not full verification');
  assert.equal(status(daily).lastVerifiedAt, null);
  f.behavior.probeGate.resolve(); await pending;
  const verified = status(daily); assert.equal(verified.state, 'verified-today'); assert.equal(verified.lastVerifiedAt, NOW.toISOString());
  const counts = clone(f.calls); status(daily); status(daily); assert.deepEqual(f.calls, counts, 'GET health must be read-only');
  const snapshot = daily.getStatus(NOW); try { snapshot.state = 'failed'; snapshot.lastVerifiedAt = null; } catch {}
  assert.equal(status(daily).state, 'verified-today'); assert.equal(status(daily).lastVerifiedAt, verified.lastVerifiedAt);
  f.behavior.createGate = null; f.behavior.probeGate = null;
  f.behavior.createError = Object.assign(Error('EACCES C:\\sensitive-fixture\\backup.key password=' + SECRET + ' token=' + SECRET), { code: 'EACCES' });
  await assert.rejects(daily.tick(NEXT), /EACCES/);
  const failed = status(daily, NEXT); assert.equal(failed.state, 'failed'); assert.equal(failed.day, '2030-01-10');
  assert.equal(failed.lastAttemptAt, NEXT.toISOString()); assert.equal(failed.lastVerifiedAt, verified.lastVerifiedAt);
  assert.ok(failed.lastError); assert.equal(failed.lastError.at, NEXT.toISOString());
});

test('B02 marker/restart/date and retention failures never become invented automatic success or duplicate snapshots', async t => {
  const f = fixture(t), first = f.scheduler(); status(first);
  await first.tick(NOW); await first.stop();
  const restarted = f.scheduler(); assert.equal(status(restarted).state, 'unverified', 'A persisted marker alone is not validation');
  f.behavior.probeGate = deferred(); const pending = restarted.tick(NOW); await turn();
  assert.equal(status(restarted).state, 'running'); assert.equal(status(restarted).lastVerifiedAt, null);
  f.behavior.probeGate.resolve(); await pending; f.behavior.probeGate = null;
  assert.equal(status(restarted).state, 'verified-today'); assert.equal(f.calls.create, 1);
  const previous = status(restarted).lastVerifiedAt;
  assert.equal(status(restarted, NEXT).state, 'unverified', 'Shanghai midnight invalidates the today label');
  assert.equal(status(restarted, NEXT).lastVerifiedAt, previous);
  f.behavior.cleanupError = Error('synthetic retention failure ' + SECRET);
  await assert.rejects(restarted.tick(NEXT), /synthetic retention failure/);
  const failed = status(restarted, NEXT); assert.equal(failed.state, 'failed'); assert.equal(failed.lastVerifiedAt, NEXT.toISOString());
  assert.ok(failed.lastError); assert.equal(f.calls.create, 2);
  await restarted.tick(NEXT);
  const recovered = status(restarted, NEXT); assert.equal(recovered.state, 'verified-today'); assert.equal(recovered.lastError, null);
  assert.equal(f.calls.create, 2, 'Health instrumentation must preserve the existing cleanup-only retry');
  const before = clone(f.calls); status(restarted, NEXT); assert.deepEqual(f.calls, before);
});

// Actual maintenance composition with the already-supported fake backup and
// restore ports. Its real SQLite/encryption/restore modules are never loaded.
function maintenance(options, f) {
  const module = { exports: {} }, requireSource = name => {
    if (name === 'node:path') return path; if (name === 'node:crypto') return crypto;
    if (name === './business-maintenance-layout.cjs') return require('../project/desktop/business-maintenance-layout.cjs');
    if (name === './business-daily-backup.cjs') return { createBusinessDailyBackups };
    if (name === './business-backups.cjs') return { createBusinessBackups: () => f.service };
    if (name === './business-restore.cjs') return { createBusinessRestore: () => ({ restore: denied('restore'), recover: denied('recover') }) };
    throw Error('UNREVIEWED_MAINTENANCE_TEST_IMPORT:' + name);
  };
  vm.runInNewContext(source('project/desktop/business-maintenance.cjs'), { module, exports: module.exports, require: requireSource, Buffer, setImmediate, Date, console }, { filename: path.join(ROOT, 'project/desktop/business-maintenance.cjs') });
  return module.exports.createBusinessMaintenance(options);
}
async function runtimeFixture(t) {
  const root = fs.mkdtempSync(path.join(BASE, 'host-')), codeDir = path.join(root, 'code'), resourcesDir = path.join(root, 'resources');
  const storage = { root, dataDir: path.join(root, 'data/sales'), profileDir: path.join(root, 'config') };
  for (const p of [codeDir, resourcesDir, storage.profileDir, storage.dataDir, path.join(root, 'data/ledger'), path.join(root, 'data/inventory'), path.join(codeDir, 'renderer-dist')]) fs.mkdirSync(p, { recursive: true });
  for (const [directory, file] of [[storage.dataDir, 'jewelry.sqlite'], [path.join(root, 'data/ledger'), 'ledger.db'], [path.join(root, 'data/inventory'), 'stockcheck.db']]) fs.writeFileSync(path.join(directory, file), 'SENTINEL; NEVER OPENED BY SQLITE', { flag: 'wx' });
  const current = { actor: { id: 'health-toy-admin', username: 'fictional-admin', role: 'admin', active: true }, local: true };
  const server = new EventEmitter(); server.address = () => ({ port: 42831 }); server.listen = (_options, done) => { queueMicrotask(done); return server; }; server.close = done => queueMicrotask(done);
  const f = { current, gatewayOptions: null, maintenance: null, service: null };
  const backend = { runtime: { sqlite: Object.freeze({ synthetic: true }) }, auth: { status: () => ({ user: current.actor }) }, administration: { requireAdmin: actor => { if (actor.role !== 'admin') throw Error('denied'); } }, exclusive: action => action(), close: async () => {} };
  const runtime = await require('../project/desktop/desktop-host-runtime.cjs').createDesktopHostRuntime({
    storage, codeDir, resourcesDir, admission: Object.freeze({ mode: 'sandbox', root, publicAccess: false }), assertAdmission: () => true,
    hostId: 'health-toy-host', profileId: 'health-toy-profile', provisionOwner: true,
    getLocalActor: () => current.actor, isLocal: () => current.local, withNetworkFrozen: action => action(),
    serverFactory: () => server, backendFactory: () => backend, contextFactory: createBusinessMaintenanceContext, recoverBeforeBusinessOpen: () => {},
    legacyModulesFactory: () => ({ status: () => ({ modules: ['ledger', 'inventory'].map(id => ({ id, configured: true })) }), configure: async () => {}, close: async () => {}, createData: denied('createData') }),
    gatewayFactory: options => { f.gatewayOptions = options; return { withFrozen: action => action(), replaceBackend: async () => {}, close: async () => {} }; },
    printWorkerLauncher: async () => ({ close: async () => {} }), printerSettings: { read: () => ({}) }, printServicesFactory: () => Object.assign(() => ({}), { routing: {} }),
    maintenanceFactory: options => { Object.assign(f, fakeService(options.context)); const m = maintenance(options, f); f.maintenance = m; return m; },
  });
  t.after(() => runtime.close()); return { ...f, runtime, backend, root };
}
function nativeFixture(runtime, current, backend, root) {
  const handlers = new Map(), frame = { url: 'jewelry://app/home' }, contents = { mainFrame: frame }, window = { webContents: contents, isDestroyed: () => false };
  const network = { request: async () => ({ ok: true, data: { authenticated: Boolean(current.actor), user: current.actor } }), assertLocal: () => { if (!current.local) throw Error('not local'); }, info: () => ({ mode: 'standalone' }) };
  const electron = { app: { getPath: () => root, getVersion: () => '1.6.1', isPackaged: true, setPath() {}, requestSingleInstanceLock: () => true, on() {}, whenReady: () => new Promise(() => {}), quit() {}, exit() {} }, dialog: { showMessageBox: async () => ({ response: 1 }), showErrorBox() {} }, ipcMain: { handle: (name, fn) => handlers.set(name, fn), on() {} }, protocol: { registerSchemesAsPrivileged() {} }, session: {}, safeStorage: {} };
  const mocks = { './release-storage.cjs': { resolveReleaseStorage: () => ({ root, profileDir: root, dataDir: root, imageDir: root }) }, './storage-locations.cjs': { prepareStorage: () => ({ root, profileDir: root, dataDir: root, imageDir: root }) }, './print-settings.cjs': { createPrintSettings: () => ({ read: () => ({}) }) }, './image-output.cjs': { createImageOutput: () => ({}) }, './credentials.cjs': { createLoginMemory: () => ({}), createLoginReceipt: () => ({ clear() {} }), scopeForConnection: () => '' } };
  const context = vm.createContext({ module: { exports: {} }, exports: {}, process: { ...process, argv: [], env: {}, resourcesPath: root }, __dirname: root, require: name => name === 'electron' ? electron : name.startsWith('node:') ? require(name) : mocks[name] || {}, console, setTimeout: () => 0, clearTimeout, URL, Response, Headers, Buffer, setImmediate: () => 0 });
  Object.defineProperty(context, '__xjyReleaseAdmission', { value: Object.freeze({ mode: 'installed', role: 'host', publicAccess: false }), writable: false, configurable: false });
  vm.runInContext(source('project/desktop/release-app.cjs') + '\nmodule.exports={registerIpc,wire(value){window=value.window;network=value.network;hostRuntime=value.hostRuntime;backend=value.backend;employeeUpdater={};}};', context);
  context.module.exports.wire({ window, network, hostRuntime: runtime, backend }); context.module.exports.registerIpc();
  return { invoke: (event = { sender: contents, senderFrame: frame }) => handlers.get('jewelry:host-maintenance')(event) };
}

test('B03 existing local admin API/native path carries actual health while employee/mobile/frozen access stays refused', async t => {
  const f = await runtimeFixture(t), m = f.maintenance;
  const response = await m.handle(f.current.actor, { method: 'GET', path: '/api/local/backups' });
  assert.equal(response.status, 200);
  assert.ok(response.data.dailyBackup, 'MAINTENANCE_DAILY_HEALTH_REQUIRED: existing GET must expose scheduler health');
  assert.equal(response.data.dailyBackup.state, 'unverified');
  const before = clone(f.calls), local = await f.runtime.getMaintenance();
  assert.deepEqual(clone(local.dailyBackup), clone(response.data.dailyBackup)); assert.deepEqual(f.calls, before, 'Listing health cannot perform backups');
  const native = nativeFixture(f.runtime, f.current, f.backend, f.root), visible = await native.invoke();
  assert.equal(visible.ok, true); assert.deepEqual(clone(visible.dailyBackup), clone(local.dailyBackup));
  f.current.actor = { ...f.current.actor, role: 'employee' };
  const refused = await m.handle(f.current.actor, { method: 'GET', path: '/api/local/backups' }); assert.equal(refused.status, 403); assert.equal(refused.data.dailyBackup, undefined);
  await assert.rejects(f.runtime.getMaintenance(), /管理员/); const ipcDenied = await native.invoke(); assert.equal(ipcDenied.ok, false); assert.equal(ipcDenied.dailyBackup, undefined);
  f.current.actor = { ...f.current.actor, role: 'admin' }; f.current.local = false;
  await assert.rejects(f.runtime.getMaintenance(), /本机|主机|local/); assert.equal((await native.invoke()).ok, false);
  f.current.local = true; await assert.rejects(native.invoke({ sender: {}, senderFrame: {} }), /窗口/);
  const hold = deferred(); const frozen = f.runtime.withFrozen(() => hold.promise); await turn();
  try { const blocked = await native.invoke(); assert.equal(blocked.ok, false); assert.equal(blocked.dailyBackup, undefined); }
  finally { hold.resolve(); await frozen; }
  assert.equal(f.gatewayOptions.allowLocalControls, false);
  const browser = require('../tests/renderer-test-loader.cjs').loadRenderer('browser-bridge'); let fetches = 0;
  const bridge = browser.installBrowserBridge({ target: {}, location: { origin: 'https://fictional-workspace.invalid', href: 'https://fictional-workspace.invalid/home', assign() {} }, navigator: {}, isSecureContext: true, File, Blob, storage: { getItem: () => null, setItem() {}, removeItem() {} }, fetch: async () => { fetches++; throw Error('MOBILE_LOCAL_HEALTH_MUST_NOT_FETCH'); } });
  assert.equal(typeof bridge.getHostMaintenance, 'undefined');
  assert.equal((await bridge.request({ path: '/api/local/backups', method: 'GET' })).ok, false);
  assert.equal((await bridge.backup()).ok, false); assert.equal((await bridge.restore()).ok, false); assert.equal(fetches, 0);
});

function nodes(value, result = []) { if (!value || typeof value !== 'object') return result; if (Array.isArray(value)) { for (const child of value) nodes(child, result); return result; } if (value.props) { result.push(value); nodes(value.props.children, result); } return result; }
function text(value) { if (value === null || value === undefined || typeof value === 'boolean') return ''; if (typeof value === 'string' || typeof value === 'number') return String(value); if (Array.isArray(value)) return value.map(text).join(' '); return value.props ? text(value.props.children) : ''; }

test('B04 actual panel status view renders facts/times/errors and treats old or scheduled fields as unverified', async () => {
  const ui = require('../tests/renderer-test-loader.cjs').loadRenderer('host-maintenance-panel');
  assert.equal(typeof ui.DailyBackupStatus, 'function', 'DAILY_BACKUP_STATUS_VIEW_REQUIRED: actual panel pure status component');
  const base = { version: 1, day: '2030-01-09', lastAttemptAt: NOW.toISOString(), lastVerifiedAt: null, lastError: null };
  const cases = [
    [{ ...base, state: 'unverified', lastAttemptAt: null }, /尚无成功记录/],
    [{ ...base, state: 'running' }, /运行中|正在.*备份|正在.*验证/],
    [{ ...base, state: 'verified-today', lastVerifiedAt: NOW.toISOString() }, /今天.*已验证|今日.*已验证/],
    [{ ...base, state: 'failed', lastVerifiedAt: NOW.toISOString(), lastError: { at: NEXT.toISOString(), code: 'BACKUP_FAILED', message: '自动备份未完成，请稍后重试。' } }, /失败|未完成/],
    [{ ...base, state: 'unverified', lastVerifiedAt: '2030-01-08T12:00:00.000Z' }, /今天.*未验证|今日.*未验证/],
  ];
  for (const [health, label] of cases) {
    const element = ui.DailyBackupStatus({ health }), rendered = text(element); assert.match(rendered, label);
    const dates = nodes(element).filter(node => node.type === 'time').map(node => node.props.dateTime);
    for (const date of [health.lastAttemptAt, health.lastVerifiedAt].filter(Boolean)) assert.ok(dates.includes(date), 'Actual view must render the declared time as a time element');
    if (health.lastError) assert.ok(rendered.includes(health.lastError.message));
  }
  for (const health of [undefined, { scheduled: true }, { ...base, version: 2, state: 'verified-today' }, { ...base, state: 'scheduled' }, { ...base, state: 'verified-today', lastVerifiedAt: 'invalid' }]) {
    const rendered = text(ui.DailyBackupStatus({ health })); assert.match(rendered, /待核对/); assert.doesNotMatch(rendered, /今天.*已验证|今日.*已验证|备份已完成/);
  }
  const listing = { ok: true, available: true, retentionDays: 7, encrypted: true, backups: [], jobs: [] }; let state;
  const controller = ui.createHostMaintenanceController({ bridge: { getHostMaintenance: async () => listing, backup: async () => ({ ok: true, status: 'queued' }), restore: async () => ({ ok: true }) }, onChange: value => { state = value; } });
  await controller.load(); assert.equal(state.error, '', 'Old host health absence must not disable existing list/manual controls');
  await controller.backup(); assert.equal(state.notice, ''); assert.match(state.error, /尚未.*完成|未确认完成/); controller.dispose();
  assert.match(source('project/desktop/renderer/host-maintenance-panel.tsx'), /<DailyBackupStatus\b/, 'The real panel must include the tested status view');
  assert.match(source('project/desktop/renderer/bridge.ts'), /dailyBackup\?\s*:/, 'The existing native bridge type must carry optional health');
  console.log(JSON.stringify({ purpose: 'backup-health-status-contract', scope: 'actual-Guest-fake-ports-only', tests: 4, sources: SOURCES, sqliteOpened: false, businessBackupOrRestoreVerified: false, desktopGuiVerified: false, formalReleaseAuthorized: false }));
});

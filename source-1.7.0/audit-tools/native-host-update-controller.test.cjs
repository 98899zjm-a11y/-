'use strict';
// DEFERRED 2026-10-16: Host in-app updater is outside the current employee-first release; no RED/GREEN requested.
// Guest-only pure controller contract; no filesystem update, launcher, DB or product execution.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..'), hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
if (process.platform !== 'win32' || os.userInfo().username.toLowerCase() !== 'wdagutilityaccount' || ROOT.toLowerCase() !== 'c:\\xjy-work\\xjy-web-stage1') throw Error('Host controller tests require the fixed actual Windows Sandbox');
const guard = require('../stage1/isolation.cjs').createIsolationGuard(ROOT);
for (const [file, pin] of Object.entries({ 'stage1/sandbox-context.py': '09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249', 'stage1/validate-sandbox-context.py': '867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207' })) if (hash(fs.readFileSync(guard.assertPath(path.join(ROOT, file)))) !== pin) throw Error('Original actual Guest guard changed');
const admission = require('node:child_process').spawnSync('C:\\Python314\\python.exe', ['-I', '-B', guard.assertPath(path.join(ROOT, 'stage1/validate-sandbox-context.py'))], { cwd: ROOT, windowsHide: true, encoding: 'utf8' });
if (admission.error || admission.status !== 0) throw Error('Actual Guest admission failed'); JSON.parse(admission.stdout);
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm');
const CURRENT = '1.6.0', TARGET = '1.6.1', SUBJECT = 'project/desktop/native-host-update.cjs', SECRET = 'synthetic-private-path-must-not-enter-renderer-state';
const sourcePins = { 'project/desktop/employee-update-cache.cjs': '5cb70079bf161a002a2701694e4774c2a11bf8d54efc6674ccb5c7b2c6729815', 'project/desktop/employee-recovery-entry.cjs': 'd984126ad08263aa4ae6be3bc547db758e4d75b6b94bd3346ead21f8121f6fce' };
const forbiddenCalls = [], sources = {}, modules = new Map();
const forbidden = name => (..._args) => { forbiddenCalls.push(name); throw Error('DIRECT_HOST_UPDATE_IO_DENIED:' + name); };
const deniedFs = new Proxy({}, { get(_target, name) { if (name === 'promises') return deniedFs; if (name === 'then') return undefined; return forbidden('fs.' + String(name)); } });
function loadActual(relative) {
  if (modules.has(relative)) return modules.get(relative).exports;
  const file = guard.assertPath(path.join(ROOT, relative));
  assert.ok(fs.existsSync(file), 'NEW_HOST_UPDATE_CONTROLLER_REQUIRED: ' + relative);
  const info = fs.lstatSync(file); assert.ok(info.isFile() && !info.isSymbolicLink() && info.nlink === 1 && info.size <= 1048576, 'ordinary reviewed source required');
  const bytes = fs.readFileSync(file), sha256 = hash(bytes); if (sourcePins[relative]) assert.equal(sha256, sourcePins[relative], 'trusted verifier source is frozen'); sources[relative] = sha256;
  const module = { exports: {} }; modules.set(relative, module);
  const requireSource = name => {
    if (name === 'node:crypto') return crypto; if (name === 'node:path') return path;
    if (name === 'node:fs' || name === 'node:fs/promises' || name === 'original-fs') return deniedFs;
    if (name === 'node:os') return { userInfo: forbidden('os.userInfo') };
    if (name === './employee-update-cache.cjs') return loadActual('project/desktop/employee-update-cache.cjs');
    if (name === './employee-recovery-entry.cjs') return loadActual('project/desktop/employee-recovery-entry.cjs');
    throw Error('UNREVIEWED_HOST_CONTROLLER_IMPORT:' + name);
  };
  vm.runInNewContext(bytes.toString('utf8'), { module, exports: module.exports, require: requireSource, Buffer, process: Object.freeze({ platform: 'win32', versions: Object.freeze({}) }), URL, URLSearchParams, structuredClone }, { filename: file });
  return module.exports;
}
const trust = loadActual('project/desktop/employee-update-cache.cjs'), recovery = loadActual('project/desktop/employee-recovery-entry.cjs');
const clone = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function signedFixture() {
  const keys = crypto.generateKeyPairSync('ed25519');
  const f = { clock: Date.parse('2026-10-16T04:00:00Z'), host: true, local: true, actor: { id: '10000000-0000-4000-8000-000000000001', username: 'synthetic-admin', role: 'admin', active: true, authenticated: true, sessionRef: 'synthetic-session-a' }, calls: { metadata: 0, chunks: 0, handoffs: [] } };
  f.catalog = { schemaVersion: 1, app: 'xjy-jewelry-offline', channel: 'stable', version: TARGET, sourceVersions: [CURRENT], platform: 'win32', arch: 'x64', sequence: 7, publishedAt: '2026-10-16T03:59:00.000Z', expiresAt: '2026-10-17T04:00:00.000Z', archive: { size: 64, sha256: hash('synthetic archive metadata only') }, files: [{ path: 'resources/app.asar', size: 32, sha256: hash('synthetic app metadata only') }] };
  f.envelope = (patch = {}, privateKey = keys.privateKey) => { const catalog = JSON.stringify({ ...f.catalog, ...patch }); return { available: true, catalog, signature: crypto.sign(null, Buffer.from(catalog), privateKey).toString('base64') }; };
  f.data = f.envelope();
  const publisherPublicKey = keys.publicKey.export({ type: 'spki', format: 'pem' });
  f.pins = { version: 1, product: 'xjy-jewelry-offline', programVersion: CURRENT, executableName: '鑫金源珠宝报价.exe', publisherPublicKey, publisherPublicKeySha256: hash(keys.publicKey.export({ type: 'spki', format: 'der' })), allowedFiles: ['resources/app.asar'], bootstrapSha256: '1'.repeat(64), files: ['updater-helper.cjs', 'employee-update-installer.cjs', 'employee-update-cache.cjs', 'bootstrap.json'].map(name => ({ name, sha256: '1'.repeat(64), size: 1 })) };
  f.publication = { getCatalog: async () => { f.calls.metadata++; return f.onRead ? f.onRead() : clone(f.data); }, getChunk: async () => { f.calls.chunks++; throw Error('HOST_CHECK_MUST_NOT_READ_CHUNKS'); } };
  f.options = { currentVersion: CURRENT, helperPins: f.pins, profileDir: path.join(ROOT, 'runtime/synthetic-host-profile'), executablePath: path.join(ROOT, 'runtime/synthetic-host-program/鑫金源珠宝报价.exe'), host: () => f.host === true, isLocal: () => f.local === true, resolveActor: async () => f.actor && { ...f.actor }, publication: f.publication, now: () => f.clock,
    installPublication: async input => { f.calls.handoffs.push(input); return f.onInstall ? f.onInstall(input) : { accepted: true, ready: true }; } };
  return f;
}
function controller(f, t) { const factory = loadActual(SUBJECT).createNativeHostUpdate; assert.equal(typeof factory, 'function', 'actual createNativeHostUpdate required'); const value = factory(f.options); for (const name of ['getCapability', 'getState', 'run', 'close']) assert.equal(typeof value[name], 'function', 'same native controller boundary: ' + name); t.after(() => value.close()); return value; }
function clean(f, value) { assert.equal(f.calls.chunks, 0); assert.deepEqual(forbiddenCalls, []); if (value !== undefined) assert.doesNotMatch(JSON.stringify(value), /BEGIN PUBLIC KEY|synthetic-host-profile|synthetic-host-program|synthetic-private-path/); }
async function rejected(native, input = { intent: 'install' }) { const result = await native.run(input); assert.equal(result.ok, false); assert.equal(typeof result.code, 'string'); assert.ok(result.code); return result; }

test('H00 actual installed-pin and signed-catalog verifiers accept RAM control and reject forged trust', () => {
  const f = signedFixture(), pins = recovery.validateHelperPins(f.pins, { currentVersion: CURRENT, executablePath: f.options.executablePath });
  const policy = trust.createTrustedUpdatePolicy({ trustedPublicKey: pins.publisherPublicKey, allowedFiles: pins.allowedFiles, currentVersion: CURRENT, now: () => f.clock });
  const { available: _available, ...envelope } = f.data, catalog = trust.verifySignedCatalog(envelope, policy);
  assert.equal(catalog.version, TARGET); assert.equal(catalog.sequence, 7); assert.ok(Object.isFrozen(catalog));
  assert.throws(() => trust.verifySignedCatalog({ ...envelope, catalog: envelope.catalog + ' ' }, policy));
  assert.throws(() => recovery.validateHelperPins({ ...f.pins, programVersion: TARGET }, { currentVersion: CURRENT }));
  clean(f); console.log(JSON.stringify({ scope: 'actual-Guest-host-update-controller-only', sources, launcherOrResourceMutationVerified: false }));
});

test('H01 only explicit local Host and current authenticated active admin can install exact intents', async t => {
  const mutations = [f => { f.host = false; }, f => { f.host = undefined; }, f => { f.local = false; }, f => { f.local = undefined; }, f => { f.actor = null; }, f => { f.actor.role = 'employee'; }, f => { f.actor.active = false; }, f => { f.actor.authenticated = false; }, f => { f.actor.id = ''; }];
  for (const mutate of mutations) { const f = signedFixture(); mutate(f); const native = controller(f, t); assert.equal((await native.getCapability()).canInstall, false); await rejected(native); assert.equal(f.calls.handoffs.length, 0); assert.equal(f.calls.metadata, 0); clean(f, native.getState()); }
  const f = signedFixture(), native = controller(f, t); assert.equal((await native.getCapability()).canInstall, true);
  for (const input of [{ intent: 'download' }, { intent: 'install', role: 'host' }, { intent: 'check', catalogFile: 'caller-path' }, { intent: 'install', verifiedCatalog: f.catalog }, { intent: 'install', publisherPublicKey: f.pins.publisherPublicKey }]) assert.equal((await rejected(native, input)).code, 'INVALID_INTENT');
  assert.equal(f.calls.metadata, 0); assert.equal(f.calls.handoffs.length, 0);
  const missing = signedFixture(); delete missing.options.installPublication; const unavailable = controller(missing, t); assert.equal((await unavailable.getCapability()).canInstall, false); await rejected(unavailable); clean(f);
});

test('H02 check reads metadata only and rejects same old expired unsupported or attacker-signed publication', async t => {
  const f = signedFixture(), native = controller(f, t), result = await native.run({ intent: 'check' });
  assert.equal(result.ok, true); assert.equal(result.state.phase, 'available'); assert.equal(result.state.targetVersion, TARGET); assert.equal(native.getState().phase, 'available'); assert.equal(f.calls.metadata, 1); assert.equal(f.calls.handoffs.length, 0); clean(f, result);
  const variants = [
    item => { item.data = item.envelope({ version: CURRENT }); }, item => { item.data = item.envelope({ version: '1.5.9' }); },
    item => { item.data = item.envelope({ expiresAt: '2026-10-16T03:59:30.000Z' }); }, item => { item.data = item.envelope({ sourceVersions: ['1.5.0'] }); },
    item => { item.data.catalog += ' '; }, item => { const rogue = crypto.generateKeyPairSync('ed25519'); item.data = { ...item.envelope({}, rogue.privateKey), publisherPublicKey: rogue.publicKey.export({ type: 'spki', format: 'pem' }) }; },
    item => { item.data = item.envelope({ files: [{ path: 'resources/data/accounts.json', size: 1, sha256: '2'.repeat(64) }] }); }, item => { item.options.helperPins = { ...item.pins, publisherPublicKeySha256: '0'.repeat(64) }; },
  ];
  for (let index = 0; index < variants.length; index++) { const item = signedFixture(); variants[index](item); const subject = controller(item, t), response = await subject.run({ intent: 'check' }); if (index === 0) assert.notEqual(response.state.phase, 'available'); else assert.equal(response.ok, false); await rejected(subject); assert.equal(item.calls.handoffs.length, 0); clean(item, response); }
});

test('H03 install awaits the fixed repeat-core composition and cannot duplicate or claim installed', async t => {
  const f = signedFixture(), native = controller(f, t); assert.equal((await native.run({ intent: 'check' })).ok, true);
  const entered = deferred(), finish = deferred(); f.onInstall = input => { entered.resolve(input); return finish.promise; };
  let settled = false; const running = native.run({ intent: 'install' }).then(value => { settled = true; return value; }); const input = await entered.promise;
  assert.deepEqual(Object.keys(input).sort(), ['closeHostApp', 'expectedVersion', 'requiresBackup', 'role', 'stopHost', 'verifiedCatalog'].sort()); assert.ok(Object.isFrozen(input)); assert.ok(Object.isFrozen(input.verifiedCatalog));
  assert.equal(input.role, 'host'); assert.equal(input.expectedVersion, CURRENT); assert.equal(input.closeHostApp, true); assert.equal(input.requiresBackup, true); assert.equal(input.stopHost, true); assert.equal(input.verifiedCatalog.sequence, 7); assert.equal(input.verifiedCatalog.version, TARGET);
  await tick(); assert.equal(settled, false); assert.equal(native.getState().phase, 'installing'); assert.equal((await rejected(native)).code, 'BUSY'); assert.equal(f.calls.handoffs.length, 1);
  finish.resolve({ accepted: true, ready: true }); const result = await running; assert.equal(result.ok, true); assert.ok(['handoff', 'installing'].includes(result.state.phase)); assert.notEqual(result.installed, true); assert.notEqual(result.state.phase, 'installed'); assert.notEqual(result.state.phase, 'completed');
  await rejected(native); assert.equal(f.calls.handoffs.length, 1); assert.ok(f.calls.metadata >= 2, 'install re-reads the actual publication'); clean(f, result);
});

test('H04 install rechecks actor locality signature expiry and exact publication sequence before handoff', async t => {
  const mutations = [
    f => { f.actor.id = '10000000-0000-4000-8000-000000000002'; }, f => { f.actor.sessionRef = 'synthetic-session-b'; }, f => { f.actor.role = 'employee'; }, f => { f.local = false; }, f => { f.host = false; },
    f => { f.data.catalog += ' '; }, f => { f.data = f.envelope({ sequence: 6 }); }, f => { f.data = f.envelope({ sequence: 8 }); },
    f => { f.data = f.envelope({ archive: { ...f.catalog.archive, sha256: '3'.repeat(64) } }); }, f => { f.clock = Date.parse('2026-10-18T00:00:00Z'); },
  ];
  for (const mutate of mutations) { const f = signedFixture(), native = controller(f, t); assert.equal((await native.run({ intent: 'check' })).ok, true); const entered = deferred(), release = deferred(); f.onRead = () => { entered.resolve(); return release.promise; }; const pending = native.run({ intent: 'install' }); await entered.promise; mutate(f); release.resolve(clone(f.data)); await rejected({ run: () => pending }); assert.equal(f.calls.handoffs.length, 0); clean(f, native.getState()); }
});

test('H05 failed or late handoff stays failure and account change or disposal cannot publish success', async t => {
  for (const outcome of ['throw', 'bad-ready', 'session', 'close']) {
    const f = signedFixture(), native = controller(f, t); assert.equal((await native.run({ intent: 'check' })).ok, true); const entered = deferred(), release = deferred();
    f.onInstall = () => { entered.resolve(); return release.promise; }; const pending = native.run({ intent: 'install' }); await entered.promise;
    if (outcome === 'session') f.actor.sessionRef = 'synthetic-session-b'; if (outcome === 'close') await native.close();
    if (outcome === 'throw') release.reject(Error(SECRET)); else release.resolve(outcome === 'bad-ready' ? { accepted: true, ready: false } : { accepted: true, ready: true });
    const result = await rejected({ run: () => pending }); assert.notEqual(result.state.phase, 'handoff'); assert.notEqual(result.state.phase, 'installed'); assert.notEqual(result.installed, true); clean(f, result);
  }
});

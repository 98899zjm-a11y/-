'use strict';
// Root alone runs this in the admitted offline Guest. All documents/devices and
// executable files below are synthetic; no Electron/EXE/DB/native print starts.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..'), hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
if (process.platform !== 'win32' || ROOT.toLowerCase() !== 'c:\\xjy-work\\xjy-web-stage1') throw Error('Fixed actual Guest required before product evaluation');
for (const [relative, pin] of Object.entries({
  'stage1/guest-candidate-cdp.cjs': '59840b638d8797fb55241616cd0b8e4098075a76834a201b0e93c1a748f1bb32',
  'stage1/sandbox-context.py': '09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249',
  'stage1/validate-sandbox-context.py': '867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207',
})) if (hash(fs.readFileSync(path.join(ROOT, relative))) !== pin) throw Error('Original actual-Guest guard changed');
require('../stage1/guest-candidate-cdp.cjs').actualGuard();
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm');
const { EventEmitter } = require('node:events'), Module = require('node:module');
const { createPrintWorkerServer, createWireAuthenticator, bindWire } = require('../project/desktop/print-worker-transport.cjs');
const { signPrintEnvelope } = require('../project/desktop/print-agent-channel.cjs');
const { createPrintWorkerClient } = require('../project/desktop/print-worker-client.cjs');
const { createPrintAgent, fingerprintPrintPayload } = require('../project/desktop/print-agent.cjs');
const { launchManagedPrintWorker } = require('../project/desktop/managed-print-worker.cjs');
const SECRET = 'SYNTHETIC_WORKER_SECRET_LONGER_THAN_32_BYTES';
const DEVICE = 'Deli M2500ADW-35J04Y(WLAN)';
const endpoint = () => '\\\\.\\pipe\\xjy-test-' + crypto.randomUUID();
const pause = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
async function until(check, label, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(check(), label);
}
function payload() {
  const value = { jobId: crypto.randomUUID(), kind: 'erp-document-a4', document: { format: 'erp-json', sourceType: 'erp-document-a4', data: { number: 'SYNTHETIC-OWNER-1', amountCents: 123 } },
    route: { printerId: 'p_00cdbc15a3cb6379e92c9d5128eb6c18', deviceName: DEVICE, label: DEVICE, routingRevision: 1, paper: 'A4' }, copies: 1, presentation: {} };
  value.payloadHash = fingerprintPrintPayload(value); return value;
}
const receipt = value => ({ jobId: value.jobId, payloadHash: value.payloadHash, route: structuredClone(value.route), copies: 1, expiresAt: Date.now() + 5000 });
function agentFixture({ render = async () => ({}), submit = async () => ({ status: 'submitted' }) } = {}) {
  const calls = { render: 0, submit: 0, close: 0 };
  const agent = createPrintAgent({ enumerate: async () => [{ name: DEVICE, displayName: DEVICE, status: 0, options: {} }],
    renderer: { render: async input => { calls.render++; return render(input); }, destroy: async () => {} },
    submit: async (...input) => { calls.submit++; return submit(...input); } });
  const close = agent.close; agent.close = async () => { calls.close++; await close(); };
  return { agent, calls };
}

test('O01 lost owner retires the listening worker and notifies lifecycle once', async () => {
  const fx = agentFixture(), address = endpoint(); let retired = 0;
  const server = createPrintWorkerServer({ endpoint: address, secret: SECRET, agent: fx.agent, onClosed: () => { retired++; } });
  await server.listen(); const client = createPrintWorkerClient({ endpoint: address, secret: SECRET, connectTimeoutMs: 100, timeoutMs: 300 });
  let replacement;
  try {
    assert.equal((await client.getDevices())[0].name, DEVICE); server.disconnect();
    await until(() => retired === 1, 'Owner disconnect must retire worker rather than retain the profile lock');
    assert.equal(fx.calls.close, 1, 'Lost owner must close the agent immediately');
    replacement = createPrintWorkerClient({ endpoint: address, secret: SECRET, connectTimeoutMs: 100, timeoutMs: 300 });
    await assert.rejects(replacement.getDevices());
    await server.close(); await pause(); assert.equal(retired, 1);
  } finally { await replacement?.close(); await client.close(); await server.close(); }
});

test('O02 disconnect during preparation forbids a late native submit and retires worker', async () => {
  const render = deferred(), entered = deferred(), fx = agentFixture({ render: () => { entered.resolve(); return render.promise; } });
  const address = endpoint(); let retired = 0;
  const server = createPrintWorkerServer({ endpoint: address, secret: SECRET, agent: fx.agent, onClosed: () => { retired++; } }); await server.listen();
  const client = createPrintWorkerClient({ endpoint: address, secret: SECRET, timeoutMs: 500 });
  try {
    const job = payload(), pending = client.print(job, { assertAuthorized: async () => receipt(job) });
    await entered.promise; server.disconnect(); assert.equal((await pending).status, 'uncertain');
    render.resolve({}); await pause(); await pause();
    assert.equal(fx.calls.submit, 0, 'Disconnected backend must never authorize a late preparation');
    await until(() => retired === 1, 'Preparation disconnect must also retire worker');
  } finally { render.resolve({}); await client.close(); await server.close(); }
});

test('O03 disconnect during native callback preserves uncertain and never resubmits', async () => {
  const native = deferred(), entered = deferred(), fx = agentFixture({ submit: () => { entered.resolve(); return native.promise; } });
  const address = endpoint(); let retired = 0;
  const server = createPrintWorkerServer({ endpoint: address, secret: SECRET, agent: fx.agent, onClosed: () => { retired++; } }); await server.listen();
  const client = createPrintWorkerClient({ endpoint: address, secret: SECRET, timeoutMs: 500 });
  try {
    const job = payload(), pending = client.print(job, { assertAuthorized: async () => receipt(job) });
    await entered.promise; server.disconnect(); assert.equal((await pending).status, 'uncertain');
    native.resolve({ status: 'submitted' }); await pause();
    assert.equal((await client.print(job, { assertAuthorized: async () => receipt(job) })).status, 'uncertain');
    assert.equal(fx.calls.submit, 1, 'Physical submit knowledge must not cause automatic resend');
    await until(() => retired === 1, 'Native callback disconnect must retire the orphan worker');
  } finally { native.resolve({ status: 'submitted' }); await client.close(); await server.close(); }
});

function managedFixture() {
  const owned = path.join(ROOT, 'runtime', 'review-print-owner-contract'); fs.mkdirSync(owned, { recursive: true });
  const root = fs.mkdtempSync(path.join(owned, 'synthetic-'));
  const codeDir = path.join(root, 'code'), resourcesDir = path.join(root, 'resources'), profileDir = path.join(root, '后台运行', '打印缓存');
  for (const value of [codeDir, resourcesDir, profileDir]) fs.mkdirSync(value, { recursive: true });
  const executable = path.join(root, 'synthetic-never-run.exe'); fs.writeFileSync(executable, 'SYNTHETIC FILE, NOT AN EXECUTABLE', { flag: 'wx' });
  fs.writeFileSync(path.join(codeDir, 'print-worker-entry.cjs'), 'SYNTHETIC ENTRY, NEVER EXECUTED', { flag: 'wx' });
  return { root, codeDir, resourcesDir, profileDir, executable, admission: Object.freeze({ mode: 'sandbox', root, publicAccess: false }), assertAdmission: () => true };
}
function childFixture({ ready = true, handshakeError } = {}) {
  const child = new EventEmitter(); child.pid = 17001; child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  const calls = { spawned: 0, killed: 0, handshakes: 0, prints: 0 };
  child.kill = () => { calls.killed++; queueMicrotask(() => child.emit('exit', 0)); return true; };
  const client = { async getDevices() { calls.handshakes++; if (handshakeError) throw handshakeError; return []; }, async print() { calls.prints++; }, async close() { child.emit('exit', 0); } };
  return { child, calls, clientFactory: () => client, spawn() { calls.spawned++; if (ready) queueMicrotask(() => child.stdout.emit('data', Buffer.from('{"event":"xjy-print-worker-ready","sandbox":true}\n'))); return child; } };
}

test('O04 managed readiness proves a real owner handshake before reporting ready', async () => {
  const fx = managedFixture(), fake = childFixture(); let worker;
  try { worker = await launchManagedPrintWorker({ ...fx, spawn: fake.spawn, clientFactory: fake.clientFactory });
    assert.equal(fake.calls.handshakes, 1, 'Lazy client creation leaves a ready worker without an owner');
    assert.equal(worker.status().state, 'ready'); assert.equal(fake.calls.prints, 0);
  } finally { await worker?.close(); }
});

test('O05 failed owner handshake rejects startup and stops only its own child without print or restart', async () => {
  const fx = managedFixture(), failure = Object.assign(Error('SYNTHETIC owner channel rejected'), { code: 'PRINT_WORKER_AUTH_FAILED' });
  const fake = childFixture({ handshakeError: failure }); let worker;
  try { await assert.rejects(async () => { worker = await launchManagedPrintWorker({ ...fx, spawn: fake.spawn, clientFactory: fake.clientFactory, stopTimeoutMs: 20 }); }, { code: 'PRINT_WORKER_AUTH_FAILED' });
    assert.equal(fake.calls.spawned, 1); assert.equal(fake.calls.killed, 1); assert.equal(fake.calls.prints, 0);
  } finally { await worker?.close(); }
});

function loadEntry(diagnostics) {
  const file = path.join(ROOT, 'project/desktop/print-worker-entry.cjs'), localRequire = Module.createRequire(file), moduleObject = { exports: {} };
  const processPort = Object.create(process); Object.defineProperties(processPort, { argv: { value: [] }, stderr: { value: { write: text => { diagnostics.push(String(text)); return true; } } } });
  function dependency(id) {
    if (id === './generated/print-worker-templates.cjs') return { buildSalesTemplate: () => '<html><body>SYNTHETIC</body></html>' };
    if (id === './print-source-assets.cjs') return { loadFixedPrintRegistry: () => Object.freeze({}), getPrintSourcePolicy: () => ({ widthMm: 210, heightMm: 297 }) };
    return localRequire(id);
  }
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { module: moduleObject, exports: moduleObject.exports, require: dependency, process: processPort, __filename: file, __dirname: path.dirname(file), Buffer, setTimeout, clearTimeout }, { filename: file });
  return moduleObject.exports;
}
function electronFixture(locked) {
  const app = new EventEmitter(), calls = { quit: 0, paths: {}, rendererClose: 0 };
  app.setPath = (name, value) => { calls.paths[name] = value; }; app.requestSingleInstanceLock = () => locked;
  app.quit = () => { calls.quit++; app.emit('before-quit'); }; app.whenReady = async () => {};
  const electron = { app, protocol: { registerSchemesAsPrivileged() {} } };
  const rendererFactory = () => ({ render: async () => ({}), destroy: async () => {}, enumerate: async () => [], submit: async () => { throw Error('Native print forbidden'); }, close: async () => { calls.rendererClose++; } });
  return { electron, calls, rendererFactory };
}
const entryConfig = fx => ({ version: 1, endpoint: endpoint(), secret: SECRET, sandbox: true, profileDir: fx.profileDir });

test('O06 occupied worker lock emits a bounded structured reason without bootstrap secrets', async () => {
  const diagnostics = [], entry = loadEntry(diagnostics), fx = managedFixture(), electron = electronFixture(false);
  assert.equal(await entry.bootPrintWorker({ ...electron, config: entryConfig(fx) }), null);
  const event = diagnostics.flatMap(text => text.trim().split('\n')).map(text => { try { return JSON.parse(text); } catch { return null; } }).find(value => value?.event === 'xjy-print-worker-error');
  assert.equal(event?.code, 'PRINT_WORKER_ALREADY_RUNNING', 'A held profile lock must not look like an unexplained readiness timeout');
  assert.equal(typeof event.message, 'string'); assert.ok(event.message.length > 0 && event.message.length <= 800);
  assert.equal(diagnostics.join('').includes(SECRET), false); assert.equal(electron.calls.quit, 1);
});

test('O07 parent propagates the specific lock refusal instead of replacing it with a generic startup error', async () => {
  const fx = managedFixture(), fake = childFixture({ ready: false });
  fake.spawn = () => { fake.calls.spawned++; queueMicrotask(() => {
    fake.child.stderr.emit('data', Buffer.from('{"event":"xjy-print-worker-error","code":"PRINT_WORKER_ALREADY_RUNNING","message":"打印专属缓存仍由另一打印代理占用，请先核对打印任务"}\n'));
    fake.child.emit('exit', 0);
  }); return fake.child; };
  await assert.rejects(launchManagedPrintWorker({ ...fx, spawn: fake.spawn, clientFactory: fake.clientFactory, readyTimeoutMs: 200, stopTimeoutMs: 20 }), { code: 'PRINT_WORKER_ALREADY_RUNNING' });
  assert.equal(fake.calls.spawned, 1); assert.equal(fake.calls.killed, 0); assert.equal(fake.calls.prints, 0);
});

test('O08 entry releases renderer and quits once when its owner connection disappears', async () => {
  const diagnostics = [], entry = loadEntry(diagnostics), fx = managedFixture(), electron = electronFixture(true), config = entryConfig(fx);
  const worker = await entry.bootPrintWorker({ ...electron, config });
  const socket = require('node:net').createConnection(config.endpoint), auth = createWireAuthenticator({ secret: SECRET }), result = deferred();
  const wire = bindWire(socket, auth, packet => { if (packet.type === 'result') result.resolve(packet); }, () => {});
  try { await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); });
    const requestId = crypto.randomUUID(), envelope = signPrintEnvelope(SECRET, { version: 1, op: 'getDevices', requestId, issuedAt: Date.now(), nonce: crypto.randomBytes(24).toString('base64url') });
    wire.send('request', requestId, { envelope }); await result.promise; socket.destroy();
    await until(() => electron.calls.quit === 1, 'Abrupt owner loss must end the standalone app');
    assert.equal(electron.calls.rendererClose, 1); await worker.stop(); assert.equal(electron.calls.quit, 1);
  } finally { socket.destroy(); auth.close(); await worker.stop(); }
});

test('O09 unowned worker has a bounded startup lifetime if its parent dies before opening the pipe', async () => {
  const fx = agentFixture(), address = endpoint(); let retired = 0;
  const server = createPrintWorkerServer({ endpoint: address, secret: SECRET, agent: fx.agent, ownerTimeoutMs: 40, onClosed: () => { retired++; } }); await server.listen();
  try { await until(() => retired === 1, 'No backend owner must not retain a worker profile indefinitely'); assert.equal(fx.calls.close, 1); }
  finally { await server.close(); }
});

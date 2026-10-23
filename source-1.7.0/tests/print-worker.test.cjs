'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { EventEmitter } = require('node:events');
const root = path.resolve(__dirname, '../project/desktop');
function api(name) { const file = path.join(root, name); assert.ok(fs.existsSync(file), 'Independent worker module missing: ' + name); return require(file); }
const secret = 'test-only-shared-secret-with-more-than-32-bytes';
const device = 'Deli M2500ADW-35J04Y(WLAN)';
function payload() { const p = { jobId: randomUUID(), kind: 'erp-document-a4', document: { format: 'erp-json', sourceType: 'erp-document-a4', data: { number: 'SH-1', amountCents: 10000 } }, route: { printerId: 'p_00cdbc15a3cb6379e92c9d5128eb6c18', deviceName: device, label: device, routingRevision: 1, paper: 'A4' }, copies: 1, presentation: {} }; p.payloadHash = require(path.join(root, 'print-agent.cjs')).fingerprintPrintPayload(p); return p; }
function receipt(p) { return { jobId: p.jobId, payloadHash: p.payloadHash, route: structuredClone(p.route), copies: p.copies, expiresAt: Date.now()+5000 }; }
function endpoint() { return process.platform === 'win32' ? '\\\\.\\pipe\\xjy-test-' + randomUUID() : path.join(os.tmpdir(), 'xjy-test-' + randomUUID() + '.sock'); }
function agentFixture(options = {}) { const events = []; const agent = require(path.join(root, 'print-agent.cjs')).createPrintAgent({ enumerate: async () => { events.push('devices'); return [{ name: device, displayName: device, status: 0, options: {} }]; }, renderer: { render: async () => { events.push('render'); return {}; }, destroy: async () => { events.push('destroy'); } }, submit: (_rendered, nativeOptions) => { events.push('native:' + nativeOptions.copies); return Promise.resolve({ status: 'submitted' }); }, ...options }); return { agent, events }; }

test('wire authentication rejects altered bodies, expired timestamps and replay before dispatch', () => {
  const { createWireAuthenticator } = api('print-worker-transport.cjs'); let now = 1000;
  const auth = createWireAuthenticator({ secret, clock: () => now });
  const packet = auth.sign('result', randomUUID(), { value: ['only-fake-device'] });
  const changed = structuredClone(packet); changed.body.value[0] = 'attacker';
  assert.throws(() => auth.verify(changed), { code: 'PRINT_WORKER_AUTH_FAILED' });
  assert.equal(auth.verify(packet).body.value[0], 'only-fake-device');
  assert.throws(() => auth.verify(packet), { code: 'PRINT_WORKER_REPLAY' });
  const expired = auth.sign('result', randomUUID(), { value: [] }); now = 40001;
  assert.throws(() => auth.verify(expired), { code: 'PRINT_WORKER_EXPIRED' });
  assert.throws(() => auth.sign('execute', randomUUID(), { command: 'anything' }), { code: 'PRINT_WORKER_MESSAGE_INVALID' });
});
test('worker client refuses a deadline exceeding the central sixty-second lease',()=>{const {createPrintWorkerClient}=api('print-worker-client.cjs');assert.throws(()=>createPrintWorkerClient({endpoint:endpoint(),secret,timeoutMs:60001}),/deadline|timeout|期限/i);});

test('real local pipe performs exactly one backend gate after all preparation and before native submit', async () => {
  const { createPrintWorkerServer } = api('print-worker-transport.cjs'); const { createPrintWorkerClient } = api('print-worker-client.cjs');
  const { agent, events } = agentFixture(); const address = endpoint();
  const server = createPrintWorkerServer({ endpoint: address, secret, agent }); await server.listen();
  const client = createPrintWorkerClient({ endpoint: address, secret });
  try {
    assert.equal((await client.getDevices())[0].name, device); events.length = 0; const p = payload();
    const result = await client.print(p, { assertAuthorized: async () => { events.push('business-gate'); return receipt(p); } });
    assert.equal(result.status, 'submitted');
    assert.deepEqual(events, ['devices', 'render', 'devices', 'business-gate', 'native:1', 'destroy']);
    const duplicate = await client.print(p, { assertAuthorized: async () => { throw Error('must not be requested twice'); } });
    assert.equal(duplicate.status, 'failed'); assert.equal(duplicate.code, 'PRINT_JOB_ALREADY_ATTEMPTED');
  } finally { await client.close(); await server.close(); }
});

test('wrong gate receipt and arbitrary file payload never reach native print', async () => {
  const { createPrintWorkerServer } = api('print-worker-transport.cjs'); const { createPrintWorkerClient } = api('print-worker-client.cjs');
  const { agent, events } = agentFixture(); const address = endpoint(); const server = createPrintWorkerServer({ endpoint: address, secret, agent }); await server.listen(); const client = createPrintWorkerClient({ endpoint: address, secret });
  try { const p = payload(); const result = await client.print(p, { assertAuthorized: async () => ({ ...receipt(p), copies: 2 }) }); assert.equal(result.status, 'failed');
    const bad = payload(); bad.filePath = 'F:\\must-not-read'; const rejected = await client.print(bad, { assertAuthorized: async () => receipt(bad) }); assert.equal(rejected.status, 'failed'); assert.equal(events.some(e => e.startsWith('native')), false);
  } finally { await client.close(); await server.close(); }
});

test('expired or unbounded final receipts fail synchronously before the native call', async()=>{
  const {createPrintWorkerServer}=api('print-worker-transport.cjs');const {createPrintWorkerClient}=api('print-worker-client.cjs');
  for(const expiration of ['missing','past','unbounded']){const {agent,events}=agentFixture(),address=endpoint(),server=createPrintWorkerServer({endpoint:address,secret,agent});await server.listen();const client=createPrintWorkerClient({endpoint:address,secret});
    try{const p=payload();const result=await client.print(p,{assertAuthorized:async()=>{const value=receipt(p);if(expiration==='missing')delete value.expiresAt;else value.expiresAt=Date.now()+(expiration==='past'?-1:60000);return value;}});assert.equal(result.status,'failed');assert.equal(events.some(e=>e.startsWith('native:')),false);}finally{await client.close();await server.close();}}
});

test('disconnect during native callback is uncertain and is never automatically dispatched again', async () => {
  const { createPrintWorkerServer } = api('print-worker-transport.cjs'); const { createPrintWorkerClient } = api('print-worker-client.cjs'); let resolveNative, nativeStarted;
  const started = new Promise(r => { nativeStarted = r; }); const { agent, events } = agentFixture({ submit: () => { events.push('native'); nativeStarted(); return new Promise(r => { resolveNative = r; }); } });
  const address = endpoint(); const server = createPrintWorkerServer({ endpoint: address, secret, agent }); await server.listen(); const client = createPrintWorkerClient({ endpoint: address, secret, timeoutMs: 1000 });
  try { const p = payload(); const pending = client.print(p, { assertAuthorized: async () => receipt(p) }); await started; server.disconnect();
    assert.equal((await pending).status, 'uncertain'); resolveNative({ status: 'submitted' });
    const again = await client.print(p, { assertAuthorized: async () => receipt(p) }); assert.equal(again.status, 'uncertain'); assert.equal(events.filter(e => e === 'native').length, 1);
  } finally { await client.close(); await server.close(); }
});

function fakeElectron() {
  const sessions = [], windows = [], ipc = new Map(); let id = 0;
  class Window extends EventEmitter { constructor(options) { super(); this.options = options; this.dead = false; this.webContents = new EventEmitter(); this.webContents.id = ++id; this.webContents.mainFrame = { url: '' }; this.webContents.setWindowOpenHandler = handler => { this.popup = handler; }; this.webContents.getPrintersAsync = async () => [{ name: device, status: 0, options: {} }]; this.webContents.print = (_options, cb) => cb(true); windows.push(this); }
    setMenu() {} isDestroyed() { return this.dead; } destroy() { this.dead = true; this.emit('closed'); }
    async loadURL(url) { this.webContents.mainFrame.url = url; const handler = ipc.get('xjy-worker:ready'); if (handler) handler({ sender: this.webContents, senderFrame: this.webContents.mainFrame }, { ok: true, pages: 1 }); }
  }
  return { BrowserWindow: Window, windows, sessions, ipcMain: { handle: (key, value) => ipc.set(key, value), removeHandler: key => ipc.delete(key) }, session: { fromPartition: name => { const s = { name, protocol: { handle: (_scheme, handler) => { s.request = handler; }, unhandle() {} }, webRequest: { onBeforeRequest: fn => { s.filter = fn; } }, setPermissionRequestHandler(fn) { this.permission = fn; }, setPermissionCheckHandler() {} }; sessions.push(s); return s; } } };
}

test('Electron adapter uses a fixed passive scheme and sandbox and cleans all windows after render', async () => {
  const { createElectronPrintRenderer } = api('print-worker-renderer.cjs'); const electron = fakeElectron();
  const renderer = createElectronPrintRenderer({ electron, buildTemplate: () => '<html><body>fake report</body></html>', readyTimeoutMs: 200 });
  try { const p = payload(); const rendered = await renderer.render({ ...p, html: '<html><body>test</body></html>', renderMode: 'passive-html' });
    const w = electron.windows[0]; assert.equal(w.options.webPreferences.sandbox, true); assert.equal(w.options.webPreferences.contextIsolation, true); assert.equal(w.options.webPreferences.plugins, false); assert.equal(w.options.show, false);
    assert.deepEqual(w.popup(), { action: 'deny' }); const session = electron.sessions[0]; let decision;
    session.filter({ url: 'https://must-not-load.example' }, value => { decision = value; }); assert.equal(decision.cancel, true);
    const response = await session.request({ url: 'xjy-print://document/anything', method: 'GET' }); assert.equal(response.status, 403);
    const documentResponse=await session.request({url:w.webContents.mainFrame.url,method:'GET'});assert.match(documentResponse.headers.get('Content-Security-Policy'),/script-src 'none'/);assert.match(documentResponse.headers.get('Content-Security-Policy'),/form-action 'none'/);
    assert.equal((await renderer.submit(rendered, { copies: 1, deviceName: device })).status, 'submitted'); await renderer.destroy(rendered); assert.equal(w.dead, true);
  } finally { await renderer.close(); }
});

test('missing PDF rasterizer fails closed before any Electron window is constructed', async () => {
  const { createElectronPrintRenderer } = api('print-worker-renderer.cjs'); const electron = fakeElectron(); const renderer = createElectronPrintRenderer({ electron });
  try { await assert.rejects(renderer.render({ ...payload(), renderMode: 'passive-pdf-pages', document: { bodyBase64: Buffer.from('%PDF-1.7\n%%EOF').toString('base64') } }), { code: 'PRINT_PDF_RENDERER_UNAVAILABLE' }); assert.equal(electron.windows.length, 0); } finally { await renderer.close(); }
});

test('passive DOM policy rejects external CSS and images rather than claiming a complete template', () => {
  const { validatePassiveCss, validatePassiveImage } = api('print-worker-passive-dom.cjs');
  assert.throws(() => validatePassiveCss('@import "/static/report.css";'), { code: 'PRINT_RESOURCE_MISSING' });
  assert.throws(() => validatePassiveCss('body{background:url(https://example.test/tracker)}'), { code: 'PRINT_RESOURCE_MISSING' });
  assert.throws(() => validatePassiveImage('data:image/svg+xml;base64,PHN2Zy8+'), { code: 'PRINT_RESOURCE_MISSING' });
  assert.throws(() => validatePassiveImage('/api/images/private'), { code: 'PRINT_RESOURCE_MISSING' });
  assert.equal(validatePassiveCss('@page{size:A4;margin:14mm}body{overflow-wrap:anywhere}'), true);
});

test('fixed landscape source policy sizes the passive page and immediately submits matching native orientation',async()=>{const electron=fakeElectron(),{createElectronPrintRenderer}=api('print-worker-renderer.cjs');const renderer=createElectronPrintRenderer({electron,getSourcePolicy:()=>({widthMm:297,heightMm:210,landscape:true})});try{const p={...payload(),kind:'inventory-report-a4',document:{format:'trusted-html',sourceType:'inventory-report-a4'},html:'<html><body>仅虚构横向报表</body></html>',renderMode:'passive-html'};const state=await renderer.render(p);assert.equal(state.policy.widthMm,297);assert.equal(state.policy.heightMm,210);assert.equal(electron.windows[0].options.width,Math.ceil(297*96/25.4));let native;state.window.webContents.print=(options,cb)=>{native=options;cb(true);};const result=renderer.submit(state,{pageSize:'A4',landscape:false,copies:1});assert.equal(native.landscape,true);assert.equal((await result).status,'submitted');}finally{await renderer.close();}});
test('prepared old HTML viewport uses the fixed page content area so root viewport cannot falsely exceed its margin guard',async()=>{const electron=fakeElectron(),renderer=api('print-worker-renderer.cjs').createElectronPrintRenderer({electron,getSourcePolicy:()=>({widthMm:210,heightMm:297,landscape:false,contentWidthMm:190,contentHeightMm:273})});try{const state=await renderer.render({...payload(),kind:'inventory-count-a4',document:{format:'trusted-html'},html:'<html><body>虚构盘点表</body></html>',renderMode:'passive-html'});assert.equal(electron.windows[0].options.width,Math.ceil(190*96/25.4));assert.equal(electron.windows[0].options.height,Math.ceil(273*96/25.4));assert.equal(state.policy.widthMm,210);}finally{await renderer.close();}});
test('nonprinting menu-button SVG is removed before remaining SVG is checked as a missing printable pixel resource',()=>{let svg=true;const button={tagName:'BUTTON',remove:()=>{svg=false;}},doc={querySelectorAll:selector=>selector==='button,input,select,textarea'?[button]:[],querySelector:()=>svg?{}:null};assert.doesNotThrow(()=>api('print-worker-passive-dom.cjs').sanitizePassiveDocument(doc));});
test('a registered font which failed native decoding cannot be reported as a complete passive page',async()=>{const fonts=[{status:'error'}];fonts.ready=Promise.resolve();const doc={fonts,images:[],querySelectorAll:()=>[],querySelector:()=>null,body:{querySelectorAll:()=>[]},documentElement:{scrollWidth:0}};await assert.rejects(api('print-worker-passive-dom.cjs').preparePassiveDocument(doc,{widthMm:210,heightMm:297}),{code:'PRINT_RESOURCE_MISSING'});});

const actualGuestTestRoot=path.resolve(__dirname,'..').toLowerCase()===path.resolve('C:/xjy-work/xjy-web-stage1').toLowerCase();
const bundled=actualGuestTestRoot?path.join(path.resolve(__dirname,'..'),'release-candidate','resources','print-dependencies','node_modules'):'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
function smallPdf() { const objs = ['<< /Type /Catalog /Pages 2 0 R /OpenAction << /S /JavaScript /JS (throw Error\(unsafe\)) >> >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << >> >>', '<< /Length 29 >>\nstream\n0 0 0 rg 20 20 120 120 re f\nendstream']; let text = '%PDF-1.4\n'; const offsets = [0]; objs.forEach((body, i) => { offsets.push(Buffer.byteLength(text)); text += `${i + 1} 0 obj\n${body}\nendobj\n`; }); const start = Buffer.byteLength(text); text += 'xref\n0 5\n0000000000 65535 f \n' + offsets.slice(1).map(v => `${String(v).padStart(10, '0')} 00000 n \n`).join('') + `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`; return Buffer.from(text); }
test('real offline pdf.js rasterizes page marks to PNG without exposing PDF actions or a plugin', async () => {
  if(actualGuestTestRoot)require('../stage1/guest-candidate-cdp.cjs').actualGuard();
  const { createPdfRasterizer } = api('print-worker-pdf.cjs'); const rasterize = createPdfRasterizer({ dependenciesRoot: bundled, timeoutMs: 10000 });
  const pages = await rasterize(smallPdf()); assert.equal(pages.length, 1); assert.equal(pages[0].widthMm > 200 && pages[0].widthMm < 220, true); const bytes = Buffer.from(pages[0].pngBase64, 'base64'); assert.deepEqual([...bytes.subarray(0, 8)], [137,80,78,71,13,10,26,10]); assert.equal(bytes.length > 1000, true);
  await assert.rejects(rasterize(Buffer.from('%PDF-1.7\n%%EOF')), /PDF|Invalid/i);
});

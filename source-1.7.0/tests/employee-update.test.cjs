const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { createEmployeeUpdate } = require('../project/desktop/employee-update.cjs');

// Independent, real ZIP fixtures. No production files, network, EXE or account is used.
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const value of bytes) {
    crc ^= value;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function makeZip(items) {
  const locals = [], centrals = []; let offset = 0;
  for (const item of items) {
    const name = Buffer.from(item.path), body = Buffer.from(item.body), crc = crc32(body), extra = item.extra || Buffer.alloc(0);
    const compressed = item.deflate ? zlib.deflateRawSync(body) : body, method = item.deflate ? 8 : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(method, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(extra.length, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(0x314, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8); central.writeUInt16LE(method, 10); central.writeUInt32LE(crc, 16); central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(body.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt16LE(extra.length, 30);
    central.writeUInt32LE(item.link ? (0xa000 << 16) >>> 0 : (0x8000 << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, extra, compressed); centrals.push(central, name, extra); offset += local.length + name.length + extra.length + compressed.length;
  }
  const directory = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(items.length, 8); end.writeUInt16LE(items.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
function fixture(options = {}) {
  const keys = crypto.generateKeyPairSync('ed25519');
  const entries = options.entries || [{ path: 'app.asar', body: 'fictional application' }, { path: 'Update-Jewelry.ps1', body: 'fictional safe installer' }];
  const archive = makeZip(entries), now = Date.UTC(2026, 9, 14);
  const catalog = {
    schemaVersion: 1, app: 'xjy-jewelry-offline', channel: 'stable', version: '1.5.2',
    sourceVersions: ['1.5.0', '1.5.1'], platform: 'win32', arch: 'x64', sequence: 3,
    publishedAt: new Date(now - 60000).toISOString(), expiresAt: new Date(now + 86400000).toISOString(),
    archive: { size: archive.length, sha256: hash(archive) },
    files: entries.map(item => ({ path: item.path, size: Buffer.byteLength(item.body), sha256: hash(item.body) })),
    ...options.catalog
  };
  let currentActor = { id: 'fake-staff', active: true, authenticated: true };
  let employeeClient = options.employeeClient !== false, acceptedSequence = options.acceptedSequence || 0;
  const cache = new Map([['retained-old-cache', Buffer.from('old cache must survive')]]);
  const calls = { fetches: 0, chunks: [], launches: [], seals: [], removed: [] };
  let serial = 0;
  const signed = () => {
    const raw = JSON.stringify(catalog);
    return { catalog: raw, signature: crypto.sign(null, Buffer.from(raw), keys.privateKey).toString('base64') };
  };
  const controller = createEmployeeUpdate({
    currentVersion: options.currentVersion || '1.5.0', platform: 'win32', arch: 'x64',
    trustedPublicKey: keys.publicKey, allowedFiles: options.allowedFiles || ['app.asar', 'Update-Jewelry.ps1'], now: () => now,
    resolveActor: async () => currentActor, isEmployeeClient: () => employeeClient,
    fetchCatalog: async () => { calls.fetches++; return options.fetchCatalog ? options.fetchCatalog(signed) : options.envelope || signed(); },
    fetchChunk: async ({ offset, length }) => { calls.chunks.push({ offset, length }); return options.chunk ? options.chunk({ offset, length }, archive) : archive.subarray(offset, offset + length); },
    storage: {
      async begin() { const id = 'test-stage-' + ++serial; cache.set(id, Buffer.alloc(0)); return id; },
      async write(id, offset, bytes) { assert.equal(offset, cache.get(id).length); cache.set(id, Buffer.concat([cache.get(id), bytes])); },
      async read(id, offset, length) { return cache.get(id).subarray(offset, offset + length); },
      async size(id) { return cache.get(id).length; },
      async seal(id, proof) { calls.seals.push({ id, proof }); },
      async remove(id) { calls.removed.push(id); cache.delete(id); },
      async getAcceptedSequence() { return acceptedSequence; },
      async setAcceptedSequence(value) { acceptedSequence = value; }
    },
    installer: async input => { calls.launches.push(input); return { scheduled: true }; }
  });
  return { controller, catalog, archive, cache, calls, setActor: actor => { currentActor = actor; }, setEmployee: value => { employeeClient = value; } };
}

test('real employee install checks signature, downloads bytes, seals and hands off only the verified stage', async () => {
  const f = fixture(); const result = await f.controller.run({ intent: 'install' });
  assert.equal(result.ok, true); assert.equal(result.state.phase, 'handoff');
  assert.equal(f.calls.launches.length, 1); assert.equal(f.calls.seals.length, 1);
  const request = f.calls.launches[0]; assert.equal(request.stageId, 'test-stage-1');
  assert.equal(request.expectedVersion, '1.5.0'); assert.equal(request.employee, true);
  assert.equal(request.closeEmployeeApp, true); assert.equal(request.requiresBackup, true); assert.equal(request.stopHost, false);
  assert.equal(f.cache.get('retained-old-cache').toString(), 'old cache must survive');
});
test('host machine employee login cannot upgrade the host app', async () => {
  const f = fixture({ employeeClient: false }); const result = await f.controller.run({ intent: 'install' });
  assert.equal(result.ok, false); assert.equal(result.code, 'EMPLOYEE_DEVICE_REQUIRED');
  assert.equal(f.calls.fetches, 0); assert.equal(f.calls.launches.length, 0);
});
test('inactive or unauthenticated staff cannot access the update channel', async () => {
  for (const actor of [null, { id: 'x', active: false, authenticated: true }, { id: 'x', active: true, authenticated: false }]) {
    const f = fixture(); f.setActor(actor); const result = await f.controller.run({ intent: 'check' });
    assert.equal(result.code, 'LOGIN_REQUIRED'); assert.equal(f.calls.fetches, 0);
  }
});
test('UI input cannot supply a path, URL, role or arbitrary installer intent', async () => {
  for (const input of [{ intent: 'install', path: 'F:\\business' }, { intent: 'check', url: 'https://example.invalid' }, { intent: 'install', role: 'host' }, { intent: 'shell' }]) {
    const f = fixture(); assert.equal((await f.controller.run(input)).code, 'INVALID_INTENT'); assert.equal(f.calls.fetches, 0);
  }
});
test('invalid publisher signature is rejected before reading any archive chunks', async () => {
  const f = fixture({ envelope: { catalog: '{}', signature: Buffer.alloc(64).toString('base64') } });
  const result = await f.controller.run({ intent: 'download' });
  assert.equal(result.code, 'BAD_SIGNATURE'); assert.equal(f.calls.chunks.length, 0); assert.equal(f.calls.launches.length, 0);
});
test('signed expired, stale or downgrade catalogs are rejected', async () => {
  for (const opts of [{ catalog: { expiresAt: '2026-10-13T00:00:00.000Z' } }, { acceptedSequence: 4 }, { currentVersion: '1.5.3' }, { catalog: { version: '9.0.0' } }]) {
    const f = fixture(opts); const result = await f.controller.run({ intent: 'download' });
    assert.equal(result.ok, false); assert.equal(f.calls.chunks.length, 0);
  }
});
test('already latest catalog reports latest without downloading or launching', async () => {
  const f = fixture({ currentVersion: '1.5.2', catalog: { sourceVersions: ['1.5.2'] } });
  const result = await f.controller.run({ intent: 'install' });
  assert.equal(result.ok, true); assert.equal(result.state.phase, 'latest'); assert.equal(f.calls.chunks.length, 0);
});
test('signed archive paths still cannot escape the fixed native whitelist', async () => {
  for (const path of ['../app.asar', 'C:/app.asar', 'extra.exe', 'APP.ASAR', 'app.asar:stream']) {
    const f = fixture({ entries: [{ path, body: 'bad path' }] });
    assert.equal((await f.controller.run({ intent: 'download' })).code, 'BAD_MANIFEST'); assert.equal(f.calls.chunks.length, 0);
  }
});
test('oversized chunk or tampered archive keeps previous cache and never installs', async () => {
  for (const chunk of [(_, archive) => Buffer.concat([archive, Buffer.alloc(1)]), (_, archive) => { const changed = Buffer.from(archive); changed[20] ^= 1; return changed; }]) {
    const f = fixture({ chunk }); const result = await f.controller.run({ intent: 'install' });
    assert.equal(result.ok, false); assert.equal(f.calls.launches.length, 0); assert.equal(f.calls.seals.length, 0);
    assert.equal(f.cache.get('retained-old-cache').toString(), 'old cache must survive');
  }
});
test('archive cannot contain duplicate or symlink ZIP entries', async () => {
  for (const entries of [[{ path: 'app.asar', body: 'a' }, { path: 'app.asar', body: 'b' }], [{ path: 'app.asar', body: 'x', link: true }]]) {
    const f = fixture({ entries }); const result = await f.controller.run({ intent: 'install' });
    assert.equal(result.ok, false); assert.equal(f.calls.launches.length, 0);
  }
});
test('archive entry must match the signed per-file digest', async () => {
  const f = fixture(); f.catalog.files[0].sha256 = '0'.repeat(64);
  const result = await f.controller.run({ intent: 'install' });
  assert.equal(result.code, 'BAD_ARCHIVE'); assert.equal(f.calls.launches.length, 0);
});
test('revoke employee login or employee role after download prevents install', async () => {
  const f = fixture(); assert.equal((await f.controller.run({ intent: 'download' })).state.phase, 'ready');
  f.setEmployee(false); assert.equal((await f.controller.run({ intent: 'install' })).code, 'EMPLOYEE_DEVICE_REQUIRED');
  assert.equal(f.calls.launches.length, 0);
});
test('modified staged cache is rehashed and refused immediately before install', async () => {
  const f = fixture(); await f.controller.run({ intent: 'download' });
  f.cache.set('test-stage-1', Buffer.alloc(f.archive.length));
  assert.equal((await f.controller.run({ intent: 'install' })).code, 'BAD_ARCHIVE'); assert.equal(f.calls.launches.length, 0);
});
test('capability is readonly and discloses no account secret, path, URL or signing key', async () => {
  const f = fixture(); const result = await f.controller.getCapability();
  assert.equal(result.canInstall, true); assert.equal(result.currentVersion, '1.5.0'); assert.equal(f.calls.fetches, 0);
  for (const key of ['id', 'path', 'url', 'key', 'trustedPublicKey', 'password']) assert.equal(Object.hasOwn(result, key), false);
});
test('download progress counts actual received bytes and never treats a staged file as installed', async () => {
  let f; const observed = [];
  f = fixture({ chunk: ({ offset, length }, archive) => { observed.push(f.controller.getState()); return archive.subarray(offset, offset + length); } });
  const result = await f.controller.run({ intent: 'download' });
  assert.equal(observed[0].phase, 'downloading'); assert.equal(observed[0].received, 0); assert.equal(observed[0].total, f.archive.length);
  assert.equal(result.state.received, f.archive.length); assert.equal(result.state.phase, 'ready'); assert.equal(f.calls.launches.length, 0);
});

test('verified upgrade accepts explicit 1.5.0 to 1.6.0 and 1.6.0 to 1.6.1 migrations', async () => {
  for (const [source, target] of [['1.5.0', '1.6.0'], ['1.6.0', '1.6.1']]) {
    const f = fixture({ currentVersion: source, catalog: { version: target, sourceVersions: [source] } });
    const result = await f.controller.run({ intent: 'install' });
    assert.equal(result.ok, true); assert.equal(f.calls.launches[0].verifiedCatalog.version, target);
  }
});
test('noncanonical semver or unapproved source never starts download', async () => {
  for (const catalog of [{ version: '1.06.0' }, { version: '1.6.0-beta' }, { version: '1.6.0', sourceVersions: ['1.5.1'] }]) {
    const f = fixture({ catalog }); assert.equal((await f.controller.run({ intent: 'install' })).ok, false); assert.equal(f.calls.chunks.length, 0);
  }
});
test('deflated files are checked against actual decompressed bytes and digest', async () => {
  const f = fixture({ entries: [{ path: 'app.asar', body: 'fictional compressed code '.repeat(2000), deflate: true }, { path: 'Update-Jewelry.ps1', body: 'fake installer', deflate: true }] });
  assert.equal((await f.controller.run({ intent: 'install' })).ok, true); assert.equal(f.calls.launches.length, 1);
});
test('ZIP Unicode or unknown extra fields cannot override a validated filename at extraction', async () => {
  const f = fixture({ entries: [{ path: 'app.asar', body: 'fake', extra: Buffer.from([0x75, 0x70, 0x00, 0x00]) }, { path: 'Update-Jewelry.ps1', body: 'fake' }] });
  assert.equal((await f.controller.run({ intent: 'install' })).code, 'BAD_ARCHIVE'); assert.equal(f.calls.launches.length, 0);
});
test('signed download fetch never asks the provider for more than four MiB and records actual bytes', async () => {
  const f = fixture({ entries: [{ path: 'app.asar', body: Buffer.alloc(4 * 1024 * 1024 + 50, 0x61) }, { path: 'Update-Jewelry.ps1', body: 'fake' }] });
  const result = await f.controller.run({ intent: 'download' }); assert.equal(result.ok, true);
  assert.equal(f.calls.chunks.length, 2); assert.equal(f.calls.chunks[0].length, 4194304); assert.equal(result.state.received, f.archive.length);
});
test('a second concurrent native action reports busy instead of downloading or installing twice', async () => {
  let release; const f = fixture({ fetchCatalog: signed => new Promise(resolve => { release = () => resolve(signed()); }) });
  const first = f.controller.run({ intent: 'check' }); await new Promise(resolve => setImmediate(resolve));
  assert.equal((await f.controller.run({ intent: 'install' })).code, 'BUSY'); release(); await first;
  assert.equal(f.calls.fetches, 1); assert.equal(f.calls.launches.length, 0);
});
test('native allowlist cannot contain Windows case collisions or reserved filename characters', () => {
  for (const allowedFiles of [['app.asar', 'APP.ASAR'], ['app.asar', 'bad?.exe'], ['app.asar', 'folder/aux.txt']]) {
    assert.throws(() => fixture({ allowedFiles }), /safe native filename allowlist/);
  }
});

// Verified local program artifacts work inside Sandbox without host dependencies.
let compiledUI;
async function uiExports() {
  if (!compiledUI) compiledUI = Promise.resolve(require('./renderer-test-loader.cjs').loadRenderer('employee-update'));
  return compiledUI;
}
async function uiModel(bridge, states, mobileSurface = false, refreshPage = () => {}) {
  const ui = await uiExports(); assert.equal(typeof ui.createEmployeeUpdatePanelController, 'function', 'employee update UI controller is missing');
  return ui.createEmployeeUpdatePanelController({ bridge, onChange: state => states.push(state), mobileSurface, refreshPage });
}
test('one click panel sends only install intent and suppresses a double click while native update is pending', async () => {
  let release, calls = []; const states = [], model = await uiModel({
    getEmployeeUpdateCapability: async () => ({ supported: true, canInstall: true, currentVersion: '1.6.0', message: 'ready' }),
    getEmployeeUpdateState: async () => ({ phase: 'available', currentVersion: '1.6.0', targetVersion: '1.6.1', message: '可升级' }),
    employeeUpdate: input => { calls.push(input); return new Promise(resolve => { release = resolve; }); }
  }, states);
  await model.load(); const first = model.run('install'), second = model.run('install');
  assert.deepEqual(calls, [{ intent: 'install' }]); assert.equal(states.at(-1).busy, true);
  release({ ok: true, state: { phase: 'handoff', currentVersion: '1.6.0', targetVersion: '1.6.1', message: '已交给本机更新助手' } });
  await Promise.all([first, second]); assert.equal(states.at(-1).status.phase, 'handoff'); assert.equal(calls.length, 1);
});
test('phone refresh ignores native EXE update bridge and refreshes only the page', async () => {
  const states = []; let nativeCalls = 0, refreshes = 0;
  const model = await uiModel({ getEmployeeUpdateCapability: async () => { nativeCalls++; return { canInstall: true }; }, employeeUpdate: async () => { nativeCalls++; } }, states, true, () => { refreshes++; });
  await model.load(); await model.run('install'); model.refresh();
  assert.equal(nativeCalls, 0); assert.equal(refreshes, 1); assert.equal(states.at(-1).capability.canInstall, false);
});
test('closing panel ignores late native update and cannot revive disposed UI', async () => {
  let release; const states = [], model = await uiModel({
    getEmployeeUpdateCapability: async () => ({ supported: true, canInstall: true, currentVersion: '1.6.0' }),
    getEmployeeUpdateState: async () => ({ phase: 'available', currentVersion: '1.6.0' }),
    employeeUpdate: () => new Promise(resolve => { release = resolve; })
  }, states);
  await model.load(); const pending = model.run('install'); model.dispose(); const count = states.length;
  release({ ok: true, state: { phase: 'handoff', currentVersion: '1.6.0' } }); await pending;
  assert.equal(states.length, count);
});
test('unsupported native bridge stops the loading message and shows a clear unavailable state', async () => {
  const states = [], model = await uiModel(undefined, states); await model.load();
  assert.equal(states.at(-1).loading, false); assert.equal(states.at(-1).capability.canInstall, false);
  assert.doesNotMatch(states.at(-1).status.message, /正在读取/);
});
test('default one click upgrade delegates automatic check download verification and install in one intent',async()=>{const calls=[],states=[],model=await uiModel({getEmployeeUpdateCapability:async()=>({supported:true,canInstall:true,currentVersion:'1.6.0'}),getEmployeeUpdateState:async()=>({phase:'idle',currentVersion:'1.6.0'}),employeeUpdate:async input=>{calls.push(input);return{ok:true,state:{phase:'handoff',currentVersion:'1.6.0',message:'助手已受理'}};}},states);await model.load();await model.upgrade();assert.deepEqual(calls,[{intent:'install'}]);assert.equal(states.at(-1).status.phase,'handoff');});
test('one click rechecks latest and stops without installation when still latest',async()=>{const calls=[],states=[],model=await uiModel({getEmployeeUpdateCapability:async()=>({supported:true,canInstall:true,currentVersion:'1.6.0'}),getEmployeeUpdateState:async()=>({phase:'latest',currentVersion:'1.6.0'}),employeeUpdate:async input=>{calls.push(input);return{ok:true,state:{phase:'latest',currentVersion:'1.6.0',message:'已是最新'}};}},states);await model.load();await model.upgrade();assert.deepEqual(calls,[{intent:'check'}]);assert.equal(states.at(-1).busy,false);});
test('one click latest to available continues install under the same pending lock',async()=>{const calls=[],states=[];let release;const model=await uiModel({getEmployeeUpdateCapability:async()=>({supported:true,canInstall:true,currentVersion:'1.6.0'}),getEmployeeUpdateState:async()=>({phase:'latest',currentVersion:'1.6.0'}),employeeUpdate:input=>{calls.push(input);if(input.intent==='check')return Promise.resolve({ok:true,state:{phase:'available',currentVersion:'1.6.0',targetVersion:'1.6.1'}});return new Promise(r=>release=r);}},states);await model.load();const first=model.upgrade();await new Promise(setImmediate);await model.upgrade();assert.deepEqual(calls,[{intent:'check'},{intent:'install'}]);assert.equal(states.at(-1).busy,true);release({ok:true,state:{phase:'handoff',currentVersion:'1.6.0'}});await first;});
test('one click failed latest check and unpublished install stop without a second native request',async()=>{for(const phase of ['latest','idle']){const calls=[],states=[],model=await uiModel({getEmployeeUpdateCapability:async()=>({supported:true,canInstall:true,currentVersion:'1.6.0'}),getEmployeeUpdateState:async()=>({phase,currentVersion:'1.6.0'}),employeeUpdate:async input=>{calls.push(input);return{ok:false,error:'主机未发布或检查失败',state:{phase:'error',currentVersion:'1.6.0'}};}},states);await model.load();await model.upgrade();assert.equal(calls.length,1);assert.equal(states.at(-1).busy,false);assert.match(states.at(-1).error,/未发布|失败/);}});
test('one click mobile only refreshes and a host cannot install',async()=>{let calls=0,refresh=0;const states=[],bridge={getEmployeeUpdateCapability:async()=>({supported:true,canInstall:false,currentVersion:'1.6.0',message:'主机不可在这里升级'}),getEmployeeUpdateState:async()=>({phase:'idle',currentVersion:'1.6.0'}),employeeUpdate:async()=>{calls++;return{ok:true};}},mobile=await uiModel(bridge,states,true,()=>refresh++),host=await uiModel(bridge,states);await mobile.load();await mobile.upgrade();await host.load();await host.upgrade();assert.equal(refresh,1);assert.equal(calls,0);});
test('a late progress poll cannot make a failed one click operation busy again',async()=>{const states=[];let reads=0,finishUpdate,finishPoll;const model=await uiModel({getEmployeeUpdateCapability:async()=>({supported:true,canInstall:true,currentVersion:'1.6.0'}),getEmployeeUpdateState:()=>{reads++;return reads===1?Promise.resolve({phase:'available',currentVersion:'1.6.0'}):new Promise(r=>finishPoll=r);},employeeUpdate:()=>new Promise(r=>finishUpdate=r)},states);await model.load();const update=model.upgrade(),poll=model.poll();finishUpdate({ok:false,error:'本次检查失败',state:{phase:'error',currentVersion:'1.6.0'}});await update;finishPoll({phase:'checking',currentVersion:'1.6.0'});await poll;assert.equal(states.at(-1).busy,false);assert.equal(states.at(-1).status.phase,'error');assert.match(states.at(-1).error,/失败/);});

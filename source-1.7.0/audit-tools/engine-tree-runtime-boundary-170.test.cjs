'use strict';
// Six actual-Guest-only contracts. Tiny fictional files and DI lifecycle only;
// never run a program/EXE, SQLite, business service, or the packaged engine.
const fs = require('node:fs'), io = fs.promises, path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..'), hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
if (process.platform !== 'win32' || os.userInfo().username.toLowerCase() !== 'wdagutilityaccount' || ROOT.toLowerCase() !== 'c:\\xjy-work\\xjy-web-stage1') throw Error('Fixed actual offline Guest required; no Host test/import');
const guard = require('../stage1/isolation.cjs').createIsolationGuard(ROOT);
for (const [file, pin] of Object.entries({ 'stage1/sandbox-context.py': '09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249', 'stage1/validate-sandbox-context.py': '867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207' })) if (hash(fs.readFileSync(guard.assertPath(path.join(ROOT, file)))) !== pin) throw Error('Original Guest admission source changed');
const PYTHON = 'C:/Python314/python.exe';
if (hash(fs.readFileSync(PYTHON)) !== '434b361fe0c5960d404974feed493db47f2603a1ace2574312104fbed0182c6f') throw Error('Public Guest Python changed');
const admission = require('node:child_process').execFileSync(PYTHON, ['-I', '-B', '-S', guard.assertPath(path.join(ROOT, 'stage1/validate-sandbox-context.py'))], { cwd: ROOT, windowsHide: true, encoding: 'utf8' });
JSON.parse(admission);
const test = require('node:test'), assert = require('node:assert/strict');

const SELF='audit-tools/engine-tree-runtime-boundary-170.test.cjs';
const readPinned=name=>{const file=guard.assertPath(path.join(ROOT,...name.split('/'))),s=fs.lstatSync(file);assert(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1&&s.size<=4*1024*1024);return fs.readFileSync(file);};
const sourcePins=JSON.parse(process.env.XJY_ENGINE_RUNTIME_SOURCE_PINS||'null');
const exactSources=['stage1/isolation.cjs','stage1/sandbox-context.py','stage1/validate-sandbox-context.py','project/desktop/employee-update-cache.cjs','project/desktop/employee-update-installer.cjs','delivery-tools/initial-patch-core.cjs','delivery-tools/engine-tree-candidate.cjs','tests/employee-update-fixtures.cjs'];
assert.deepEqual(Object.keys(sourcePins||{}).sort(),exactSources.sort());
for(const[name,pin]of Object.entries(sourcePins)){assert.match(pin,/^[a-f0-9]{64}$/);assert.equal(hash(readPinned(name)),pin);}
assert.equal(hash(readPinned(SELF)),process.env.XJY_ENGINE_RUNTIME_TEST_SHA256);
assert.equal(hash(readPinned('audit-tools/engine-tree-candidate.test.cjs')),'f8f3654ae3f83c6b420b01b7a57a64c9f3cca2dab282053e84612c313e0506c8');
const expectedNamespace=process.env.XJY_ENGINE_RUNTIME_NAMESPACE;
assert.match(expectedNamespace||'',/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
assert.equal(JSON.parse(readPinned('isolation-identity.json').toString('utf8').replace(/^\uFEFF/, '')).namespace,expectedNamespace);

const u = require('../project/desktop/employee-update-cache.cjs'), core = require('../delivery-tools/initial-patch-core.cjs');
const { asar } = require('../tests/employee-update-fixtures.cjs');
const SUBJECT = path.join(ROOT, 'delivery-tools/engine-tree-candidate.cjs');
const BASE = guard.assertPath(path.join(ROOT, 'runtime/engine-tree-tests'));
const CURRENT = '1.6.1', TARGET = '1.6.2', OLD_ENGINE = '44.7.0', NEW_ENGINE = '44.9.0', EXE = 'Toy Jewelry.exe';
const MARKER = 'xjy-install-activation.json', NOW = Date.UTC(2026, 9, 18, 4), AUTH = 'fictional-sandbox-user';
fs.mkdirSync(BASE, { recursive: true });
let API;
function subject() {
  assert.ok(fs.existsSync(SUBJECT), 'ENGINE_TREE_CANDIDATE_REQUIRED: missing isolated transaction core');
  API ||= require(SUBJECT);
  assert.equal(typeof API.createEngineTreeCandidate, 'function', 'Actual isolated engine tree factory required');
  return API;
}
async function put(root, relative, body) { const file = path.join(root, ...relative.split('/')); await io.mkdir(path.dirname(file), { recursive: true }); await io.writeFile(file, body, { flag: 'wx' }); return { path: relative, size: Buffer.byteLength(body), sha256: hash(body) }; }
async function absent(file) { try { await io.lstat(file); return false; } catch (error) { if (error.code === 'ENOENT') return true; throw error; } }
async function snapshot(root) { const tree = await core.inspectArtifactTree({ artifactDir: root }); return tree.files.map(({ path: relative, size, sha256 }) => ({ path: relative, size, sha256 })); }
const signed = (catalog, key) => { const raw = JSON.stringify(catalog); return { catalog: raw, signature: crypto.sign(null, Buffer.from(raw), key).toString('base64') }; };
function journal(file) { const envelope = JSON.parse(fs.readFileSync(file, 'utf8')); assert.equal(typeof envelope.payload, 'string', 'Journal must be authenticated, not raw mutable JSON'); assert.match(envelope.mac, /^[0-9a-f]{64}$/); return JSON.parse(envelope.payload); }
function programBodies(version, engine, obsolete = false) {
  return {
    [EXE]: Buffer.from('MZ fictional ' + engine + ' executable; NEVER EXECUTED'),
    'ffmpeg.dll': Buffer.from('fictional DLL ' + engine), 'icudtl.dat': Buffer.from('fictional ICU ' + engine),
    'resources.pak': Buffer.from('fictional PAK ' + engine), 'snapshot_blob.bin': Buffer.from('fictional snapshot ' + engine),
    'v8_context_snapshot.bin': Buffer.from('fictional V8 ' + engine), 'version': Buffer.from(engine),
    'locales/zh-CN.pak': Buffer.from('fictional Chinese locale ' + engine),
    'resources/app.asar': asar(version, 'fictional resources paired with ' + engine),
    'resources/print-dependencies/fixture.txt': Buffer.from('fictional dependency ' + engine),
    ...(obsolete ? { 'old-only.dll': Buffer.from('old engine only; never leak into target') } : { 'new-only.dll': Buffer.from('new engine only') }),
  };
}
async function fixture(role = 'employee') {
  const root = await io.mkdtemp(path.join(BASE, 'case-')), installationDir = path.join(root, 'program'), artifactDir = path.join(root, 'candidate'), stateDir = path.join(root, 'engine-state'), dataDir = path.join(root, 'data'), profileDir = path.join(root, 'profile');
  for (const dir of [installationDir, artifactDir, stateDir, dataDir, profileDir]) await io.mkdir(dir);
  const keys = crypto.generateKeyPairSync('ed25519'), oldBodies = programBodies(CURRENT, OLD_ENGINE, true), newBodies = programBodies(TARGET, NEW_ENGINE), oldFiles = [], targetFiles = [];
  for (const [relative, body] of Object.entries(oldBodies)) oldFiles.push(await put(installationDir, relative, body));
  for (const [relative, body] of Object.entries(newBodies)) targetFiles.push(await put(artifactDir, relative, body));
  const activation = { version: 1, product: 'xjy-jewelry-offline', programVersion: CURRENT, role, installationDir };
  await put(installationDir, MARKER, JSON.stringify(activation));
  await put(dataDir, 'fictional-business.sqlite', 'SYNTHETIC DATA; NEVER OPENED BY SQLITE');
  await put(dataDir, 'images/fictional.png', 'SYNTHETIC IMAGE');
  await put(profileDir, 'launch-role.json', JSON.stringify({ role }));
  await put(profileDir, 'workspace-connection.json', JSON.stringify({ mode: role === 'employee' ? 'client' : 'standalone', host: 'synthetic-host' }));
  const catalog = (version, files, sequence) => ({ schemaVersion: 1, app: 'xjy-jewelry-offline', channel: 'stable', version, sourceVersions: [CURRENT], platform: 'win32', arch: 'x64', sequence, publishedAt: new Date(NOW - 1000).toISOString(), expiresAt: new Date(NOW + 86400000).toISOString(), archive: { size: 22, sha256: 'a'.repeat(64) }, files });
  const sourceCatalog = catalog(CURRENT, oldFiles, 20), targetCatalog = catalog(TARGET, targetFiles, 21);
  const trust = { schemaVersion: 1, purpose: 'xjy-isolated-engine-tree', publisherPublicKey: keys.publicKey, publisherPublicKeySha256: hash(keys.publicKey.export({ type: 'spki', format: 'der' })), executableName: EXE,
    source: { programVersion: CURRENT, engineVersion: OLD_ENGINE, catalogSha256: hash(JSON.stringify(sourceCatalog)), allowedFiles: oldFiles.map(file => file.path) },
    target: { programVersion: TARGET, engineVersion: NEW_ENGINE, catalogSha256: hash(JSON.stringify(targetCatalog)), allowedFiles: targetFiles.map(file => file.path) } };
  const events = [], renames = [], restarts = [], f = { root, installationDir, artifactDir, stateDir, dataDir, profileDir, keys, activation, oldBodies, newBodies, sourceCatalog, targetCatalog, trust, events, renames, restarts, role };
  f.source = await snapshot(installationDir); f.data = await snapshot(dataDir); f.profile = await snapshot(profileDir); f.artifact = await snapshot(artifactDir); f.oldInode = (await io.stat(installationDir, { bigint: true })).ino;
  const targetMarker = Buffer.from(JSON.stringify({ ...activation, programVersion: TARGET }));
  f.target = [...targetFiles, { path: MARKER, size: targetMarker.length, sha256: hash(targetMarker) }].sort((a, b) => a.path.localeCompare(b.path, 'en'));
  const targetRows = () => f.target.slice().sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const processBarrier = {
    getCurrent: async () => ({ pid: 7301, creationMarker: 'synthetic-external-helper' }), isAssistantAlive: async () => false,
    waitClosed: async input => { events.push({ kind: 'wait', input }); if (f.waitError) throw f.waitError; },
    assertClosed: async input => { events.push({ kind: 'closed', input }); if (f.closedError) throw f.closedError; return true; },
    restart: async input => {
      const rows = await snapshot(installationDir), engine = (await io.readFile(path.join(installationDir, 'version'), 'utf8'));
      assert.deepEqual(rows, engine === NEW_ENGINE ? targetRows() : f.source, 'No process may start against a mixed engine/resources tree');
      assert.deepEqual(input, { executablePath: path.join(installationDir, EXE), args: role === 'employee' ? ['--employee-client'] : [], role }, 'The exact original role must survive both new and old restarts');
      restarts.push({ input: { ...input }, engine });
      return f.restartResult ? f.restartResult(engine) : { started: true, ready: true };
    },
  };
  const fileSystem = { ...io, rename: async (from, to) => { renames.push({ from, to }); if (f.renameError) await f.renameError(from, to); return io.rename(from, to); } };
  f.options = { fileSystem, isolationRoot: root, installationDir, artifactDir, stateDir, dataDir, profileDir, role, sourceEnvelope: signed(sourceCatalog, keys.privateKey), targetEnvelope: signed(targetCatalog, keys.privateKey), trust, processBarrier, now: () => NOW, checkpoint: async (name, record) => { events.push({ kind: name }); if (f.checkpoint) await f.checkpoint(name, record); } };
  f.targetRows = targetRows;
  f.resignTarget = () => { f.options.targetEnvelope = signed(targetCatalog, keys.privateKey); trust.target.catalogSha256 = hash(JSON.stringify(targetCatalog)); trust.target.allowedFiles = targetCatalog.files.map(file => file.path); };
  return f; // Never delete failures, backup trees, journals or original fixtures.
}
function runner(f, options = {}) { return subject().createEngineTreeCandidate({ ...f.options, ...options }); }
const install = (f, options) => Promise.resolve().then(() => runner(f, options).install());
const recover = (f, options) => Promise.resolve().then(() => runner(f, options).recover());
async function preserved(f, { original = true } = {}) { assert.deepEqual(await snapshot(f.dataDir), f.data); assert.deepEqual(await snapshot(f.profileDir), f.profile); if (original) assert.deepEqual(await snapshot(f.installationDir), f.source); }
async function publication(f, result) {
  assert.deepEqual(await snapshot(f.installationDir), f.targetRows());
  assert.deepEqual(await snapshot(result.backupDir), f.source);
  assert.equal((await io.stat(result.backupDir, { bigint: true })).ino, f.oldInode, 'Backup must be the original complete directory object');
  assert.notEqual((await io.stat(f.installationDir, { bigint: true })).ino, f.oldInode);
  await preserved(f, { original: false }); assert.deepEqual(await snapshot(f.artifactDir), f.artifact);
}

test('E01 complete signed engine/resources tree switches by directory rename and restarts the unchanged host or employee role', async () => {
  subject();
  for (const role of ['employee', 'host']) {
    const f = await fixture(role), result = await install(f);
    assert.equal(result.installed, true); assert.equal(result.version, TARGET); assert.equal(result.engineVersion, NEW_ENGINE); assert.equal(result.role, role); assert.equal(result.restarted, true);
    await publication(f, result); assert.deepEqual(f.restarts.map(entry => entry.engine), [NEW_ENGINE]);
    const liveMoves = f.renames.filter(move => move.from === f.installationDir || move.to === f.installationDir);
    assert.equal(liveMoves.length, 2); assert.equal(liveMoves[0].from, f.installationDir); assert.equal(liveMoves[0].to, result.backupDir); assert.equal(liveMoves[1].to, f.installationDir);
    assert.equal(path.dirname(result.backupDir), f.root); assert.equal(path.dirname(liveMoves[1].from), f.root);
    assert.equal(f.renames.some(move => move.to.startsWith(f.installationDir + path.sep) || move.from.startsWith(f.installationDir + path.sep)), false, 'No per-file live engine replacements');
    assert.equal(journal(path.join(f.stateDir, 'journal.json')).phase, 'committed');
    const complete = await recover(f); assert.equal(complete.completed, true); await publication(f, result);
    assert.deepEqual(f.restarts.map(entry => entry.engine), [NEW_ENGINE], 'Reading committed recovery must not restart twice or roll back a valid target');
  }
});

test('E02 signature, complete tree, source identity, role and ordinary separated path failures stop before process wait or live mutation', async () => {
  subject();
  for (const mode of ['signature', 'target-dll', 'missing-pak', 'extra-file', 'old-source', 'engine-version', 'role', 'data-inside', 'profile-inside', 'signed-data', 'hardlink', 'junction']) {
    const f = await fixture(); let options = {};
    if (mode === 'signature') f.options.targetEnvelope = { ...f.options.targetEnvelope, signature: Buffer.alloc(64).toString('base64') };
    if (mode === 'target-dll') await io.appendFile(path.join(f.artifactDir, 'ffmpeg.dll'), 'tamper');
    if (mode === 'missing-pak') await io.unlink(path.join(f.artifactDir, 'resources.pak'));
    if (mode === 'extra-file') await put(f.artifactDir, 'undeclared.dll', 'unexpected');
    if (mode === 'old-source') await io.appendFile(path.join(f.installationDir, 'resources/app.asar'), 'unapproved source');
    if (mode === 'engine-version') f.trust.target.engineVersion = '44.9.1';
    if (mode === 'role') options.role = 'host';
    if (mode === 'data-inside') options.dataDir = path.join(f.installationDir, 'data');
    if (mode === 'profile-inside') options.profileDir = path.join(f.installationDir, 'profile');
    if (mode === 'signed-data') { const row = await put(f.artifactDir, 'data/business.sqlite', 'signed business data must still be rejected'); f.targetCatalog.files.push(row); f.resignTarget(); }
    if (mode === 'hardlink') await io.link(path.join(f.artifactDir, 'ffmpeg.dll'), path.join(f.root, 'aliased-dll'));
    if (mode === 'junction') { const outside = path.join(f.root, 'external-resource'); await io.mkdir(outside); await put(outside, 'fixture.txt', 'external untouched'); await io.rename(path.join(f.artifactDir, 'resources/print-dependencies'), path.join(f.artifactDir, 'original-dependencies')); await io.symlink(outside, path.join(f.artifactDir, 'resources/print-dependencies'), 'junction'); }
    const before = await snapshot(f.installationDir);
    await assert.rejects(install(f, options));
    assert.deepEqual(await snapshot(f.installationDir), before, mode); await preserved(f, { original: false });
    assert.equal(f.events.some(event => event.kind === 'wait'), false, mode + ': trust/path refusal must precede process wait'); assert.equal(f.restarts.length, 0);
    assert.equal(f.renames.some(move => move.from === f.installationDir || move.to === f.installationDir), false);
  }
});

test('E03 normal-exit denial, live recheck, stage ENOSPC and locked source directory never begin a partial engine switch', async () => {
  subject();
  for (const mode of ['exit', 'recheck', 'disk', 'directory-lock']) {
    const f = await fixture();
    if (mode === 'exit') f.waitError = Object.assign(Error('synthetic app still running'), { code: 'PROGRAM_IN_USE' });
    if (mode === 'recheck') f.closedError = Object.assign(Error('synthetic unrelated process appeared'), { code: 'PROGRAM_IN_USE' });
    if (mode === 'disk') f.options.fileSystem.open = async (file, flags, permissions) => {
      const handle = await io.open(file, flags, permissions);
      if (String(flags).includes('w') && path.basename(file) === 'ffmpeg.dll') return new Proxy(handle, { get(target, key) { if (key === 'write') return async () => { throw Object.assign(Error('synthetic stage disk full'), { code: 'ENOSPC' }); }; const value = target[key]; return typeof value === 'function' ? value.bind(target) : value; } });
      return handle;
    };
    if (mode === 'directory-lock') f.renameError = async from => { if (from === f.installationDir) throw Object.assign(Error('synthetic external file lock'), { code: 'EACCES' }); };
    await assert.rejects(install(f)); await preserved(f); assert.equal(f.restarts.length, 0, mode);
    assert.equal((await io.stat(f.installationDir, { bigint: true })).ino, f.oldInode);
    assert.equal(f.renames.filter(move => move.to === f.installationDir).length, 0);
  }
});

test('E04 failed candidate publish restores the complete original directory and exact activation before a source-role restart', async () => {
  subject(); const f = await fixture(); let failed = false;
  f.renameError = async (from, to) => { if (!failed && to === f.installationDir && from !== f.installationDir) { failed = true; throw Object.assign(Error('synthetic second rename failure'), { code: 'EACCES' }); } };
  await assert.rejects(install(f)); assert.equal(failed, true); await preserved(f);
  assert.equal((await io.stat(f.installationDir, { bigint: true })).ino, f.oldInode); assert.deepEqual(f.restarts.map(entry => entry.engine), [OLD_ENGINE]);
  const record = journal(path.join(f.stateDir, 'journal.json')); assert.equal(record.phase, 'rolledback');
  assert.deepEqual(await snapshot(record.stageDir), f.targetRows(), 'The failed complete stage remains for inspection');
});

test('E05 restart acknowledgement failure rolls back the entire target tree and never reports the update committed', async () => {
  subject();
  for (const started of [false, true]) {
    const f = await fixture('host'); f.restartResult = engine => engine === NEW_ENGINE ? { started, ready: false } : { started: true, ready: true };
    await assert.rejects(install(f)); await preserved(f);
    assert.deepEqual(f.restarts.map(entry => entry.engine), [NEW_ENGINE, OLD_ENGINE]);
    const record = journal(path.join(f.stateDir, 'journal.json')); assert.equal(record.phase, 'rolledback');
    assert.deepEqual(await snapshot(record.failedDir), f.targetRows(), 'Rejected candidate is preserved as one complete tree');
    const firstStart = f.events.findIndex(event => event.kind === 'new-tree-published');
    assert.ok(firstStart >= 0); assert.ok(f.events.slice(firstStart + 1).some(event => event.kind === 'wait'), 'A candidate must close normally before rollback rename');
  }
});

test('E06 cold recovery authenticates both trees and journal; rollback failure retains evidence and refuses every restart', async () => {
  subject();
  for (const point of ['old-tree-renamed', 'new-tree-published']) {
    const f = await fixture(); f.checkpoint = async name => { if (name === point) throw Object.assign(Error('synthetic power interruption'), { code: 'SIMULATED_POWER_LOSS' }); };
    await assert.rejects(install(f), error => error.code === 'SIMULATED_POWER_LOSS'); assert.equal(f.restarts.length, 0);
    f.checkpoint = null; const result = await recover(f); assert.equal(result.recovered, true); assert.equal(result.rolledBack, true); await preserved(f);
    assert.deepEqual(f.restarts.map(entry => entry.engine), [OLD_ENGINE]); assert.equal(journal(path.join(f.stateDir, 'journal.json')).phase, 'rolledback');
  }
  for (const tamper of ['journal', 'backup', 'target']) {
    const f = await fixture(); f.checkpoint = async name => { if (name === 'old-tree-renamed') throw Object.assign(Error('synthetic power interruption'), { code: 'SIMULATED_POWER_LOSS' }); };
    await assert.rejects(install(f)); f.checkpoint = null;
    const file = path.join(f.stateDir, 'journal.json'), record = journal(file);
    if (tamper === 'journal') { const wrapper = JSON.parse(await io.readFile(file, 'utf8')); wrapper.payload = JSON.stringify({ ...record, phase: 'committed' }); await io.writeFile(file, JSON.stringify(wrapper)); }
    if (tamper === 'backup') await io.appendFile(path.join(record.backupDir, 'ffmpeg.dll'), 'tampered old engine');
    if (tamper === 'target') await io.appendFile(path.join(f.artifactDir, 'ffmpeg.dll'), 'tampered signed candidate');
    const moves = f.renames.length; await assert.rejects(recover(f)); assert.equal(f.renames.length, moves, 'Validate every recovery input before the first rename');
    assert.equal(await absent(f.installationDir), true); assert.equal(f.restarts.length, 0); await preserved(f, { original: false });
  }
  const f = await fixture(); let publishFailed = false;
  f.renameError = async (from, to) => { if (to === f.installationDir) { if (!publishFailed) { publishFailed = true; throw Object.assign(Error('synthetic publish failure'), { code: 'EACCES' }); } throw Object.assign(Error('synthetic rollback rename failure'), { code: 'EACCES' }); } };
  await assert.rejects(install(f), error => error.code === 'ROLLBACK_FAILED'); assert.equal(f.restarts.length, 0);
  const record = journal(path.join(f.stateDir, 'journal.json')); assert.deepEqual(await snapshot(record.backupDir), f.source); assert.equal(await absent(f.installationDir), true); await preserved(f, { original: false });
  f.renameError = null; const recovered = await recover(f); assert.equal(recovered.recovered, true); await preserved(f); assert.deepEqual(f.restarts.map(entry => entry.engine), [OLD_ENGINE]);
  console.log(JSON.stringify({ purpose: 'isolated-engine-tree-candidate-contract', tests: 6, executionScope: 'actual-Guest-fictional-files-and-lifecycle-DI', fictionalFilesOnly: true, executableLaunched: false, sqliteOpened: false, realWindowsHelperVerified: false, formalDeploymentAuthorized: false }));
});


// Two new methods. All six original fixture/contract bodies remain unchanged.
test('E07 normal-close checkpoint establishes the baseline only after exit; switch-time mutation still stops', async () => {
  const f=await fixture('employee'),originalWait=f.options.processBarrier.waitClosed;
  await put(f.dataDir,'fictional-business.sqlite-wal','SYNTHETIC WAL before normal close');
  f.options.processBarrier.waitClosed=async input=>{await originalWait(input);await io.writeFile(path.join(f.dataDir,'fictional-business.sqlite'),'SYNTHETIC checkpointed main after normal close');await io.unlink(path.join(f.dataDir,'fictional-business.sqlite-wal'));await io.writeFile(path.join(f.profileDir,'workspace-connection.json'),'SYNTHETIC profile flushed on close');f.data=await snapshot(f.dataDir);f.profile=await snapshot(f.profileDir);};
  const result=await install(f);assert.equal(result.installed,true);await publication(f,result);
  assert.equal(await io.readFile(path.join(f.dataDir,'fictional-business.sqlite'),'utf8'),'SYNTHETIC checkpointed main after normal close');
  const record=journal(path.join(f.stateDir,'journal.json'));assert.deepEqual(record.dataFiles,f.data);assert.deepEqual(record.profileFiles,f.profile);
  const changed=await fixture('host');changed.checkpoint=async point=>{if(point==='old-tree-renamed')await io.writeFile(path.join(changed.dataDir,'fictional-business.sqlite'),'UNAUTHORISED switch-time change');};
  await assert.rejects(install(changed),error=>error.code==='ROLLBACK_FAILED');assert.equal(changed.restarts.length,0);
  assert.equal(await io.readFile(path.join(changed.dataDir,'fictional-business.sqlite'),'utf8'),'UNAUTHORISED switch-time change');
  const failed=journal(path.join(changed.stateDir,'journal.json'));assert.equal(failed.phase,'rollback-failed');assert.deepEqual(await snapshot(failed.backupDir),changed.source);
});

test('E08 startup writes survive ready or normal-close rollback; an unclosed candidate is never renamed', async () => {
  for(const mode of ['ready','failed','close-denied']){
    const f=await fixture('host'),originalWait=f.options.processBarrier.waitClosed;let waits=0,candidateClosed=false;
    f.options.processBarrier.waitClosed=async input=>{await originalWait(input);waits++;if(waits===2){if(mode==='close-denied')throw Object.assign(Error('synthetic candidate still running'),{code:'PROGRAM_IN_USE'});await io.writeFile(path.join(f.dataDir,'fictional-business.sqlite'),'SYNTHETIC candidate checkpoint after normal close');await io.writeFile(path.join(f.profileDir,'workspace-connection.json'),'SYNTHETIC candidate close profile');candidateClosed=true;}};
    f.restartResult=async engine=>{if(engine===NEW_ENGINE){await io.writeFile(path.join(f.dataDir,'fictional-business.sqlite'),'SYNTHETIC normal startup business write');await io.writeFile(path.join(f.profileDir,'workspace-connection.json'),'SYNTHETIC normal startup profile write');return{started:true,ready:mode==='ready'};}assert(candidateClosed,'Candidate must close before source-role restart');await io.writeFile(path.join(f.profileDir,'workspace-connection.json'),'SYNTHETIC source startup profile write');return{started:true,ready:true};};
    f.renameError=async(from,to)=>{if(from===f.installationDir&&path.basename(to).startsWith('.engine-failed-'))assert(candidateClosed,'No rollback rename before normal close');};
    if(mode==='ready'){
      const result=await install(f);assert.equal(result.installed,true);assert.equal(journal(path.join(f.stateDir,'journal.json')).phase,'committed');
      assert.equal(await io.readFile(path.join(f.dataDir,'fictional-business.sqlite'),'utf8'),'SYNTHETIC normal startup business write');
      assert.equal(await io.readFile(path.join(f.profileDir,'workspace-connection.json'),'utf8'),'SYNTHETIC normal startup profile write');
      f.data=await snapshot(f.dataDir);f.profile=await snapshot(f.profileDir);await publication(f,result);assert.equal((await recover(f)).completed,true);assert.deepEqual(f.restarts.map(x=>x.engine),[NEW_ENGINE]);
    }else if(mode==='failed'){
      await assert.rejects(install(f),error=>error.code==='TARGET_RESTART_FAILED');assert(candidateClosed);assert.deepEqual(await snapshot(f.installationDir),f.source);
      assert.equal(await io.readFile(path.join(f.dataDir,'fictional-business.sqlite'),'utf8'),'SYNTHETIC candidate checkpoint after normal close');
      assert.equal(await io.readFile(path.join(f.profileDir,'workspace-connection.json'),'utf8'),'SYNTHETIC source startup profile write');
      const record=journal(path.join(f.stateDir,'journal.json'));assert.equal(record.phase,'rolledback');assert.deepEqual(await snapshot(record.failedDir),f.targetRows());
      assert.equal((await recover(f)).rolledBack,true);assert.deepEqual(f.restarts.map(x=>x.engine),[NEW_ENGINE,OLD_ENGINE]);
    }else{
      await assert.rejects(install(f),error=>error.code==='ROLLBACK_FAILED');assert.equal(candidateClosed,false);assert.deepEqual(f.restarts.map(x=>x.engine),[NEW_ENGINE]);
      const record=journal(path.join(f.stateDir,'journal.json'));assert.equal(record.phase,'rollback-failed');assert.deepEqual(await snapshot(f.installationDir),f.targetRows());assert.deepEqual(await snapshot(record.backupDir),f.source);
      assert.equal(f.renames.some(x=>x.from===f.installationDir&&path.basename(x.to).startsWith('.engine-failed-')),false);
    }
  }
  console.log(JSON.stringify({purpose:'engine-tree-runtime-boundary',originalMethods:6,newMethods:2,actualNamespace:expectedNamespace,sourcePins,sqliteOpened:false,executableLaunched:false,lifecycle:'DI with real fictional file writes'}));
});

'use strict';
// Prepared benchmark only. Execution is admitted by daily-cache-perf.py in the
// sealed offline Guest; there is no Host or production fallback.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const crypto = require('node:crypto'), vm = require('node:vm'), assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const ROOT = path.resolve(__dirname, '..');
const DESKTOP = path.join(ROOT, 'project', 'desktop');
const NOW = '2030-01-09T12:00:00.000Z';
const PIN = Object.freeze({ baseline: '5df6a30fc250b974a6e6dc8acd45de76aa3f2b7918834fe12eaffc227e097e83', current: '43ee94b5252ebae4486a702e821cbeeab83be7685789ebd49b94bbafbc96d0db' });
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6rAAAAABJRU5ErkJggg==', 'base64');

function ordinary(target) {
  let cursor = path.resolve(target);
  while (true) {
    if (fs.existsSync(cursor)) assert.equal(fs.lstatSync(cursor).isSymbolicLink(), false, 'Guest benchmark paths cannot be links');
    const parent = path.dirname(cursor); if (parent === cursor) break; cursor = parent;
  }
  return target;
}
function admit() {
  assert.equal(process.platform, 'win32');
  assert.equal(ROOT.toLowerCase(), 'c:\\xjy-work\\xjy-web-stage1', 'Host benchmark execution is forbidden');
  assert.equal(os.userInfo().username.toLowerCase(), 'wdagutilityaccount'); ordinary(ROOT);
  const proof = JSON.parse(process.env.XJY_DAILY_PERF_GUEST_CONTEXT || 'null');
  assert.equal(proof?.model, 'Virtual Machine'); assert.equal(proof.productionDrivePresent, false);
  assert.equal(proof.nonLoopbackAddressCount, 0); assert.equal(proof.inputMarkerPresent, true);
  assert.ok(proof.userName?.toLowerCase().endsWith('\\wdagutilityaccount'));
  assert.equal(fs.existsSync('F:\\'), false);
  assert.equal(Object.values(os.networkInterfaces()).flat().filter(item => item && item.address !== '::1' && !item.address.startsWith('127.')).length, 0);
  const input = JSON.parse(fs.readFileSync('C:\\xjy-input\\synthetic-marker.json', 'utf8').replace(/^\uFEFF/, ''));
  const identity = JSON.parse(fs.readFileSync(path.join(ROOT, 'isolation-identity.json'), 'utf8').replace(/^\uFEFF/, ''));
  assert.equal(input.synthetic, true); assert.equal(input.namespace, identity.namespace);
}
function hashFile(file) {
  const fd = fs.openSync(ordinary(file), 'r'), hash = crypto.createHash('sha256'), buffer = Buffer.alloc(64 * 1024);
  try { let count; while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, count)); }
  finally { fs.closeSync(fd); }
  return hash.digest('hex');
}
function validateInputs() {
  const file = path.join(__dirname, 'daily-cache-perf-inputs.json');
  const inputs = JSON.parse(fs.readFileSync(ordinary(file), 'utf8'));
  const expected = ['audit-tools/daily-cache-baseline-e0b9464.cjs', 'project/desktop/business-daily-backup.cjs', 'project/desktop/business-backups.cjs', 'project/desktop/business-maintenance-layout.cjs', 'project/desktop/business-erp-backup-integrity.cjs'];
  assert.equal(inputs.version, 1); assert.equal(inputs.baselineCommit, 'e0b9464'); assert.equal(inputs.baselineBlob, '3d7382aadaf756f2a3b70adffbd4cb68c157043d');
  assert.deepEqual(inputs.files.map(row => row.path), expected);
  for (const row of inputs.files) {
    assert.match(row.sha256, /^[a-f0-9]{64}$/); const target = ordinary(path.join(ROOT, row.path));
    assert.equal(fs.statSync(target).size, row.size); assert.equal(hashFile(target), row.sha256, 'Benchmark input changed: ' + row.path);
  }
  assert.equal(inputs.files[0].sha256, PIN.baseline); assert.equal(inputs.files[1].sha256, PIN.current);
  return { ...inputs, manifestSHA256: hashFile(file) };
}
function layoutFor(root) {
  return Object.fromEntries(Object.entries({ dataDir: 'sales', ledgerDir: 'ledger', inventoryDir: 'inventory', profileDir: 'profile', configDir: 'config', runtimeDir: 'runtime', logDir: 'logs', backupDir: 'backups', documentsDir: 'documents', quoteImagesDir: 'quote-images' }).map(([key, name]) => [key, path.join(root, name)]));
}
function fixtureRoot(run, mib) { return path.join(ROOT, 'runtime', 'daily-cache-perf', run, 'mib-' + mib); }
function markerData(context, archive) { return JSON.stringify({ version: 1, namespace: context.namespace, day: '2030-01-09', file: archive.file, createdAt: archive.createdAt }); }
function physical(file) {
  const s = fs.statSync(file, { bigint: true }); assert.ok(s.isFile()); assert.equal(s.nlink, 1n);
  return Object.fromEntries(['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].map(name => [name, String(s[name])]));
}
function fence() {
  let frozen = false;
  return async action => {
    assert.equal(frozen, false, 'Synthetic freeze must not overlap'); frozen = true;
    try { return await action(); } finally { frozen = false; }
  };
}

async function setup(run, mib, inputs) {
  const { DatabaseSync } = require('node:sqlite');
  const { createBusinessMaintenanceContext } = require(path.join(DESKTOP, 'business-maintenance-layout.cjs'));
  const { createBusinessBackups } = require(path.join(DESKTOP, 'business-backups.cjs'));
  const owned = fixtureRoot(run, mib); ordinary(owned); assert.equal(fs.existsSync(owned), false, 'A fresh benchmark fixture is required');
  fs.mkdirSync(owned, { recursive: true }); const layout = layoutFor(owned);
  for (const directory of Object.values(layout)) fs.mkdirSync(directory);
  const hostId = 'daily-perf-synthetic-host', profileId = 'daily-perf-synthetic-profile';
  const context = createBusinessMaintenanceContext({ root: owned, layout, hostId, profileId, provisionOwner: true });
  const files = [['sales', layout.dataDir, 'jewelry.sqlite'], ['ledger', layout.ledgerDir, 'ledger.db'], ['inventory', layout.inventoryDir, 'stockcheck.db']];
  let sales;
  try {
    for (const [name, directory, filename] of files) {
      const db = new DatabaseSync(context.policy.check(path.join(directory, filename)));
      db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; CREATE TABLE toy_parent(id INTEGER PRIMARY KEY,value TEXT); CREATE TABLE toy_child(id INTEGER PRIMARY KEY,parent_id INTEGER REFERENCES toy_parent(id));');
      db.prepare('INSERT INTO toy_parent VALUES(?,?)').run(1, 'synthetic-' + name); db.prepare('INSERT INTO toy_child VALUES(?,?)').run(1, 1);
      if (name === 'ledger') {
        const id = '31000000-0000-4000-8000-000000000001';
        const directory = path.join(layout.ledgerDir, 'erp-attachments'); context.policy.io.mkdirSync(directory);
        context.policy.io.writeFileSync(path.join(directory, id + '.bin'), PIXEL);
        db.exec('CREATE TABLE erp_attachments(id TEXT PRIMARY KEY,name TEXT,mime TEXT,size INTEGER,sha256 TEXT); CREATE TABLE erp_documents(id TEXT PRIMARY KEY,payload TEXT);');
        db.prepare('INSERT INTO erp_attachments VALUES(?,?,?,?,?)').run(id, 'synthetic.png', 'image/png', PIXEL.length, crypto.createHash('sha256').update(PIXEL).digest('hex'));
        db.prepare('INSERT INTO erp_documents VALUES(?,?)').run('synthetic-document', JSON.stringify({ attachments: [id] }));
      }
      if (name === 'sales') sales = db; else db.close();
    }
    const imageId = '32000000-0000-4000-8000-000000000002', images = path.join(layout.dataDir, 'images');
    context.policy.io.mkdirSync(images); context.policy.io.writeFileSync(path.join(images, imageId), PIXEL);
    context.policy.io.writeFileSync(path.join(images, 'metadata.json'), JSON.stringify({ ['images/' + imageId]: { synthetic: true } }));
    context.policy.io.writeFileSync(path.join(layout.quoteImagesDir, 'synthetic.png'), PIXEL);
    context.policy.io.writeFileSync(path.join(layout.configDir, 'settings.json'), '{"synthetic":true}');
    const payload = context.policy.check(path.join(layout.documentsDir, 'payload.bin'));
    const fd = context.policy.io.openSync(payload, 'wx'), chunk = Buffer.alloc(64 * 1024);
    for (let i = 0; i < chunk.length; i++) chunk[i] = (i * 31 + mib) % 251;
    try { for (let i = 0; i < mib * 16; i++) context.policy.io.writeSync(fd, chunk); context.policy.io.fsyncSync(fd); }
    finally { context.policy.io.closeSync(fd); }
    const backups = createBusinessBackups({ context, withFrozen: fence(), salesDatabase: () => sales });
    const archive = await backups.create({ kind: 'auto', now: new Date(NOW) });
    await backups.probe(archive.file, { requireCurrentSlots: true });
    const staged = await backups.verifyAndStage(archive.file);
    try {
      assert.equal(staged.databases.length, 3); assert.ok(staged.databases.every(row => row.integrity === 'ok'));
      assert.equal(staged.erpAttachments.legacy, false); assert.equal(staged.erpAttachments.checkedAttachments, 1); assert.equal(staged.erpAttachments.linkedReferences, 1);
      assert.equal(hashFile(path.join(staged.directory, 'documents', 'payload.bin')), hashFile(payload));
      assert.equal(staged.capturedSlots.length, 6);
    } finally { backups.discardStage(staged.directory); }
    const marker = path.join(layout.configDir, 'daily-backup-test.json'); context.policy.io.writeFileSync(marker, markerData(context, archive));
    const description = { version: 1, synthetic: true, root: owned, layout, hostId, profileId, namespace: context.namespace, now: NOW,
      payloadMiB: mib, payloadBytes: mib * 1024 * 1024, payloadSHA256: hashFile(payload), archive, archiveSHA256: hashFile(archive.file),
      archivePhysical: physical(archive.file), markerSHA256: hashFile(marker), inputManifestSHA256: inputs.manifestSHA256,
      verificationModel: 'real AES-GCM/frame/attachment hashes, real three SQLite integrity/FK checks, one ERP attachment/reference, six captured slots; toy schemas and quiescent in-process write fence' };
    fs.writeFileSync(path.join(owned, 'fixture.json'), JSON.stringify(description, null, 2), { flag: 'wx' });
    return { setup: true, fixture: owned, payloadMiB: mib, archiveBytes: Number(description.archivePhysical.size), archiveSHA256: description.archiveSHA256, synthetic: true };
  } finally { sales?.close(); }
}

function instrument(layout) {
  const original = Object.fromEntries(['openSync', 'closeSync', 'readSync', 'writeSync', 'mkdirSync', 'rmSync'].map(name => [name, fs[name]]));
  const handles = new Map(); let phase = 'scheduler', counts;
  const backupPrefix = layout.backupDir + path.sep, stageRoot = path.join(layout.runtimeDir, 'restore-stage'), stagePrefix = stageRoot + path.sep;
  const fresh = () => ({ create: 0, probe: 0, cleanup: 0, list: 0, archiveReadBytes: 0, archiveReadCalls: 0, archiveReadsByPhase: {}, stagePayloadWriteBytes: 0, stagePayloadWriteCalls: 0, stagesCreated: 0, stagesRemoved: 0 });
  counts = fresh();
  fs.openSync = function (filename, ...args) {
    const fd = original.openSync.call(fs, filename, ...args);
    if (typeof filename === 'string') {
      const target = path.resolve(filename);
      handles.set(fd, target.startsWith(backupPrefix) ? 'archive' : target.startsWith(stagePrefix) && path.basename(target) !== '.owner.json' ? 'stage' : 'other');
    }
    return fd;
  };
  fs.closeSync = function (fd, ...args) { try { return original.closeSync.call(fs, fd, ...args); } finally { handles.delete(fd); } };
  fs.readSync = function (fd, ...args) {
    const n = original.readSync.call(fs, fd, ...args);
    if (handles.get(fd) === 'archive') { counts.archiveReadCalls++; counts.archiveReadBytes += n; counts.archiveReadsByPhase[phase] = (counts.archiveReadsByPhase[phase] || 0) + n; }
    return n;
  };
  fs.writeSync = function (fd, ...args) {
    const n = original.writeSync.call(fs, fd, ...args);
    if (handles.get(fd) === 'stage') { counts.stagePayloadWriteCalls++; counts.stagePayloadWriteBytes += n; }
    return n;
  };
  const directStage = target => typeof target === 'string' && path.dirname(path.resolve(target)) === stageRoot && /^[a-f0-9-]{36}$/.test(path.basename(target));
  fs.mkdirSync = function (target, ...args) { const result = original.mkdirSync.call(fs, target, ...args); if (directStage(target)) counts.stagesCreated++; return result; };
  fs.rmSync = function (target, ...args) { const result = original.rmSync.call(fs, target, ...args); if (directStage(target)) counts.stagesRemoved++; return result; };
  return {
    reset() { counts = fresh(); }, get counts() { return counts; },
    async call(name, action) { counts[name]++; const old = phase; phase = name; try { return await action(); } finally { phase = old; } },
    list(action) { counts.list++; const old = phase; phase = 'list'; try { return action(); } finally { phase = old; } },
    restore() { for (const [name, value] of Object.entries(original)) fs[name] = value; },
  };
}
function loadScheduler(arm) {
  if (arm === 'current') return require(path.join(DESKTOP, 'business-daily-backup.cjs'));
  const source = fs.readFileSync(path.join(__dirname, 'daily-cache-baseline-e0b9464.cjs'), 'utf8'), module = { exports: {} };
  const fn = vm.compileFunction(source, ['require', 'module', 'exports'], { filename: path.join(DESKTOP, 'business-daily-baseline-e0b9464.cjs') });
  fn(createRequire(path.join(DESKTOP, 'business-daily-backup.cjs')), module, module.exports); return module.exports;
}
async function measure(run, mib, arm, ticks, inputs) {
  const { createBusinessMaintenanceContext } = require(path.join(DESKTOP, 'business-maintenance-layout.cjs'));
  const { createBusinessBackups } = require(path.join(DESKTOP, 'business-backups.cjs'));
  const owned = fixtureRoot(run, mib), description = JSON.parse(fs.readFileSync(ordinary(path.join(owned, 'fixture.json')), 'utf8'));
  assert.equal(description.synthetic, true); assert.equal(description.root, owned); assert.deepEqual(description.layout, layoutFor(owned));
  assert.equal(description.inputManifestSHA256, inputs.manifestSHA256);
  const context = createBusinessMaintenanceContext({ root: owned, layout: description.layout, hostId: description.hostId, profileId: description.profileId });
  const marker = path.join(context.layout.configDir, 'daily-backup-test.json'), archive = context.policy.check(description.archive.file);
  assert.equal(hashFile(archive), description.archiveSHA256); assert.deepEqual(physical(archive), description.archivePhysical);
  assert.equal(hashFile(marker), description.markerSHA256);
  const sales = new context.policy.DatabaseSync(path.join(context.layout.dataDir, 'jewelry.sqlite'), { readOnly: true });
  const backups = createBusinessBackups({ context, withFrozen: fence(), salesDatabase: () => sales });
  assert.equal(backups.list().length, 1, 'Only one recent auto archive may influence retention');
  const factory = loadScheduler(arm), observer = instrument(context.layout);
  const service = {
    create: (...args) => observer.call('create', () => backups.create(...args)),
    probe: (file, options) => { assert.equal(options?.requireCurrentSlots, true); return observer.call('probe', () => backups.probe(file, options)); },
    cleanup: (...args) => observer.call('cleanup', () => backups.cleanup(...args)), list: () => observer.list(() => backups.list()),
  };
  const daily = factory.createBusinessDailyBackups({ service, context, markerName: 'daily-backup-test.json' });
  const rows = [];
  try {
    for (let i = 0; i <= ticks; i++) {
      observer.reset(); const memoryBefore = process.memoryUsage(), usageBefore = process.resourceUsage(), cpuBefore = process.cpuUsage(), began = process.hrtime.bigint();
      const result = await daily.tick(new Date(Date.parse(description.now) + i * 60000));
      const elapsedMs = Number(process.hrtime.bigint() - began) / 1e6, cpu = process.cpuUsage(cpuBefore), usageAfter = process.resourceUsage(), memoryAfter = process.memoryUsage();
      const count = JSON.parse(JSON.stringify(observer.counts));
      assert.equal(result.created, false); assert.equal(count.create, 0);
      assert.equal(count.probe, arm === 'baseline' || i === 0 ? 1 : 0);
      assert.equal(count.cleanup, arm === 'current' && i === 0 ? 1 : 0);
      assert.ok(count.archiveReadBytes >= Number(description.archivePhysical.size), 'Archive logical I/O observation must cover at least one complete read');
      assert.equal(count.stagesCreated, count.probe); assert.equal(count.stagesRemoved, count.probe);
      assert.equal(count.stagePayloadWriteBytes > 0, count.probe > 0);
      rows.push({ phase: i === 0 ? 'firstProcessTick' : 'steadyTick', tick: i, elapsedMs, cpuMicroseconds: cpu,
        maxRSSKiB: usageAfter.maxRSS > 0 ? usageAfter.maxRSS : null, maxRSSMeasured: usageAfter.maxRSS > 0,
        maxRSSScope: 'process lifetime, includes imports/untimed validation/first tick; not an isolated phase peak',
        maxRSSHighwaterIncreaseKiB: Math.max(0, usageAfter.maxRSS - usageBefore.maxRSS), memoryBefore, memoryAfter,
        rawResourceFsReadDelta: usageAfter.fsRead - usageBefore.fsRead, rawResourceFsWriteDelta: usageAfter.fsWrite - usageBefore.fsWrite,
        logicalNodeIO: count });
    }
  } finally { await daily.stop(); observer.restore(); sales.close(); }
  assert.equal(hashFile(archive), description.archiveSHA256); assert.deepEqual(physical(archive), description.archivePhysical);
  assert.equal(hashFile(marker), description.markerSHA256);
  const stages = path.join(context.layout.runtimeDir, 'restore-stage'); assert.equal(fs.existsSync(stages) ? fs.readdirSync(stages).length : 0, 0);
  validateInputs();
  return { version: 1, model: description.verificationModel, arm, payloadMiB: mib, archiveBytes: Number(description.archivePhysical.size),
    archiveSHA256: description.archiveSHA256, fixture: owned, node: process.version, versions: process.versions, windowsRelease: os.release(), arch: process.arch, cpuCount: os.cpus().length,
    inputManifestSHA256: inputs.manifestSHA256, schedulerSHA256: PIN[arm], rows,
    observationLimits: { processFresh: true, diskCold: false, archiveHashReadBeforeMeasurement: true, instrumentationEnabled: true,
      ioMeasured: 'successful Node sync archive read and restore-stage payload write calls only',
      physicalDiskIOBytesMeasured: false, sqliteNativeIOBytesMeasured: false, metadataAndOwnerJSONIOBytesMeasured: false,
      peakStageDiskOccupancyMeasured: false, stagePayloadWriteBytesMeasured: true, otherBusinessProcessesStarted: false,
      productionBackendDrainOrPycModuleStopMeasured: false } };
}

(async () => {
  admit(); const inputs = validateInputs();
  const [mode, run, rawMiB, arm, rawTicks] = process.argv.slice(2), mib = Number(rawMiB), ticks = Number(rawTicks);
  assert.match(run || '', /^[a-f0-9-]{36}$/); assert.ok([1, 64].includes(mib));
  if (mode === 'setup') console.log(JSON.stringify(await setup(run, mib, inputs)));
  else { assert.equal(mode, 'measure'); assert.ok(['baseline', 'current'].includes(arm)); assert.ok(Number.isInteger(ticks) && ticks >= 1 && ticks <= 10); console.log(JSON.stringify(await measure(run, mib, arm, ticks, inputs))); }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });

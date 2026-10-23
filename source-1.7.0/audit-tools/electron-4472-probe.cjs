'use strict';
// Guest-only, memory SQLite and built-in APIs. No product, business ASAR or pyc imports.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const ROOT = path.resolve('C:/xjy-work/xjy-web-stage1');
const INPUT = path.resolve('C:/xjy-input/electron-4472-capability-a1');
const BASE = path.join(ROOT, 'runtime/electron-4472-capability-a1');
const PURPOSE = 'electron-4472-memory-capability-only';
const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const assert = (condition, message) => { if (!condition) throw Error(message); };
function ordinary(file, boundary) {
  const relative = path.relative(boundary, file);
  assert(relative !== '..' && !relative.startsWith('..'+path.sep) && !path.isAbsolute(relative), 'Owned probe path required');
  for (let current = file; ; current = path.dirname(current)) {
    const stat = fs.lstatSync(current);
    assert(!stat.isSymbolicLink() && (!stat.isFile() || stat.nlink === 1), 'Probe links refused');
    if (current === path.dirname(current)) break;
  }
  return file;
}
function read(file, boundary) { return JSON.parse(fs.readFileSync(ordinary(file, boundary), 'utf8')); }
function cancelled() {
  const file = path.join(BASE, 'control/stop-request.json');
  if (fs.existsSync(file)) {
    const stop = read(file, BASE);
    assert(stop.purpose === PURPOSE && stop.pid === process.pid, 'Invalid owned stop request');
    throw Error('Reviewed driver requested natural cancellation');
  }
}
function guard(seal) {
  assert(process.platform === 'win32' && process.arch === 'x64', 'Actual Windows x64 Guest required');
  assert(process.versions.electron === '44.7.2' && process.env.ELECTRON_RUN_AS_NODE === '1' && process.type === undefined,
    'Only new Electron 44.7.2 Node mode is accepted');
  assert(process.argv.length === 3 && /^[0-9a-f]{64}$/.test(seal), 'Fixed probe invocation and reviewed seal required');
  assert(same(process.execPath, path.join(BASE, 'engine/electron.exe')) && same(__filename, path.join(INPUT, 'tools/electron-4472-probe.cjs')) && same(process.cwd(), ROOT), 'Fixed independent engine/probe paths required');
  const manifestFile = ordinary(path.join(INPUT, 'capsule-manifest.json'), INPUT);
  const raw = fs.readFileSync(manifestFile);
  assert(crypto.createHash('sha256').update(raw).digest('hex') === seal, 'Capsule review seal mismatch');
  const manifest = JSON.parse(raw);
  assert(manifest.purpose === PURPOSE && manifest.electronAuthenticode === 'NotSigned' && manifest.independentArtifactSignatureVerified === false && manifest.businessResourcesIncluded === false, 'Public source is not artifact signing or business admission');
  const driver = ordinary(path.join(INPUT, 'tools/electron-4472-guest.py'), INPUT);
  const result = spawnSync('C:/Python314/python.exe', ['-I', '-B', '-X', 'utf8', driver, 'context', '--manifest-sha256', seal],
    { cwd: ROOT, shell: false, windowsHide: true, encoding: 'utf8', timeout: 30000, maxBuffer: 1048576 });
  assert(!result.error && result.status === 0, 'Actual Guest recheck refused before SQLite');
  const proof = JSON.parse(result.stdout);
  assert(proof.model === 'Virtual Machine' && proof.productionDrivePresent === false && proof.nonLoopbackAddressCount === 0 && proof.inputMarkerPresent === true && /\\wdagutilityaccount$/i.test(proof.userName), 'Actual Guest proof invalid');
  const owner = read(path.join(BASE, 'owner.json'), BASE);
  assert(owner.purpose === PURPOSE && owner.capsuleSha256 === seal && owner.runId === 'a1', 'Independent probe owner mismatch');
  return proof;
}
async function admission(seal) {
  const ready = path.join(BASE, 'control/ready.json');
  ordinary(path.dirname(ready), BASE);
  fs.writeFileSync(ready, JSON.stringify({ purpose: PURPOSE, pid: process.pid, capsuleSha256: seal }), { flag: 'wx' });
  const until = Date.now()+30000;
  const file = path.join(BASE, 'control/admitted.json');
  while (!fs.existsSync(file)) {
    cancelled();
    assert(Date.now() < until, 'CIM admission timed out; exiting naturally');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const record = read(file, BASE);
  assert(record.version === 1 && record.purpose === PURPOSE && record.pid === process.pid && record.driverPid === process.ppid && record.capsuleSha256 === seal && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}Z$/.test(record.creationUtc), 'Exact PID/creation/parent CIM admission required');
  cancelled();
  return { pid: process.pid, parentPid: process.ppid, creationUtc: record.creationUtc };
}
function mustThrow(action, message) {
  let caught;
  try { action(); } catch (error) { caught = error; }
  assert(caught, message);
  return caught;
}
function sqliteMemory() {
  const sqlite = require('node:sqlite'); // Only after both actual Guest and CIM gates.
  assert(typeof sqlite.DatabaseSync === 'function' && typeof sqlite.backup === 'function', 'Current SQLite constructor/backup symbol missing');
  const database = new sqlite.DatabaseSync(':memory:', { allowExtension: false, enableForeignKeyConstraints: true });
  try {
    for (const name of ['setAuthorizer', 'enableDefensive', 'enableLoadExtension']) assert(typeof database[name] === 'function', 'Current SQLite method missing: '+name);
    database.enableDefensive(true);
    database.exec('PRAGMA temp_store=MEMORY; PRAGMA foreign_keys=ON; CREATE TABLE parent(id INTEGER PRIMARY KEY); CREATE TABLE child(id INTEGER PRIMARY KEY,parent_id INTEGER REFERENCES parent(id),value TEXT NOT NULL); INSERT INTO parent VALUES(1)');
    database.prepare('INSERT INTO child VALUES(?,?,?)').run(1, 1, '完全虚构的内存测试');
    const foreignKeyError = mustThrow(() => database.prepare('INSERT INTO child VALUES(?,?,?)').run(2, 999, 'invalid FK'), 'Memory foreign key was not enforced');
    assert(/FOREIGN KEY constraint failed/i.test(foreignKeyError.message), 'Foreign-key test failed for an unrelated reason');
    database.exec("BEGIN IMMEDIATE; INSERT INTO parent VALUES(2); ROLLBACK");
    assert(database.prepare('SELECT count(*) AS n FROM parent').get().n === 1, 'Memory rollback failed');
    const bigint = database.prepare('SELECT ? AS n');
    assert(typeof bigint.setReadBigInts === 'function', 'SQLite BigInt result option unavailable');
    bigint.setReadBigInts(true);
    assert(bigint.get(9007199254740993n).n === 9007199254740993n, 'SQLite BigInt lost precision');
    const c = sqlite.constants;
    assert(c && ['SQLITE_ATTACH', 'SQLITE_DETACH', 'SQLITE_DENY', 'SQLITE_OK'].every(name => Number.isInteger(c[name])), 'SQLite authorizer constants unavailable');
    let attachDenials = 0;
    database.setAuthorizer(action => {
      if (action === c.SQLITE_ATTACH || action === c.SQLITE_DETACH) { attachDenials++; return c.SQLITE_DENY; }
      return c.SQLITE_OK;
    });
    mustThrow(() => database.exec("ATTACH DATABASE ':memory:' AS rejected"), 'Memory ATTACH authorizer failed');
    assert(attachDenials === 1, 'ATTACH must reach the real authorizer denial');
    mustThrow(() => database.enableLoadExtension(true), 'Constructor extension prohibition failed');
    const integrity = Object.values(database.prepare('PRAGMA integrity_check').get())[0];
    const foreignKeyRows = database.prepare('PRAGMA foreign_key_check').all();
    assert(integrity === 'ok' && foreignKeyRows.length === 0, 'Memory SQLite integrity/FK failed');
    const version = database.prepare('SELECT sqlite_version() AS version').get().version;
    const databases = database.prepare('PRAGMA database_list').all();
    assert(databases.every(row => row.file === ''), 'Memory-only SQLite unexpectedly has a file');
    return { version, integrity, foreignKeyViolations: foreignKeyRows.length, transactionRollback: true,
      bigIntRoundtrip: true, authorizerAttachDenied: true, extensionEnableDenied: true, defensiveMethodCalled: true,
      databaseFiles: databases.map(row => ({ name: row.name, file: row.file })), backupFunctionPresent: true,
      backupExercised: false, walExercised: false, businessPolicyWrapperLoaded: false };
  } finally { database.close(); }
}
async function nodeAPIs() {
  const a = crypto.generateKeyPairSync('x25519'), b = crypto.generateKeyPairSync('x25519');
  const shared = crypto.diffieHellman({ privateKey: a.privateKey, publicKey: b.publicKey });
  assert(shared.equals(crypto.diffieHellman({ privateKey: b.privateKey, publicKey: a.publicKey })), 'X25519 agreement failed');
  const key = Buffer.from(crypto.hkdfSync('sha256', shared, Buffer.from('synthetic-salt'), 'synthetic-probe', 32));
  const iv = crypto.randomBytes(12), plain = Buffer.from('仅内存，不是业务密钥'), aad = Buffer.from('fictitious');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(aad);
  const wire = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  function decrypt(auth) { const d = crypto.createDecipheriv('aes-256-gcm', key, iv); d.setAAD(aad); d.setAuthTag(auth); return Buffer.concat([d.update(wire), d.final()]); }
  assert(decrypt(tag).equals(plain), 'AES-GCM roundtrip failed');
  const bad = Buffer.from(tag); bad[0] ^= 1;
  mustThrow(() => decrypt(bad), 'AES-GCM tamper was accepted');
  const signer = crypto.generateKeyPairSync('ed25519'), signature = crypto.sign(null, plain, signer.privateKey);
  assert(crypto.verify(null, plain, signer.publicKey, signature) && !crypto.verify(null, Buffer.from('changed'), signer.publicKey, signature), 'Ed25519 verification failed');
  assert(crypto.createHash('sha256').update('abc').digest('hex') === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'SHA256 vector failed');
  const zlib = require('node:zlib');
  assert(zlib.inflateRawSync(zlib.deflateRawSync(plain)).equals(plain) && zlib.gunzipSync(zlib.gzipSync(plain)).equals(plain), 'Compression roundtrip failed');
  const { Readable, Writable } = require('node:stream'), { pipeline } = require('node:stream/promises');
  const chunks = [];
  await pipeline(Readable.from([plain]), new Writable({ write(chunk, encoding, done) { chunks.push(Buffer.from(chunk)); done(); } }));
  assert(Buffer.concat(chunks).equals(plain), 'Stream pipeline failed');
  const original = require('original-fs');
  const stamp = original.statSync(__filename, { bigint: true });
  assert(typeof stamp.mtimeNs === 'bigint' && typeof stamp.ctimeNs === 'bigint' && typeof stamp.ino === 'bigint', 'BigInt Ns/identity stat unavailable');
  for (const name of ['open', 'rename', 'stat', 'lstat']) assert(typeof original.promises[name] === 'function', 'Current original-fs promise API missing: '+name);
  assert(typeof original.fsyncSync === 'function' && typeof original.fstatSync === 'function', 'Current fs durability symbols missing');
  assert(typeof require('node:http').createServer === 'function' && typeof require('node:net').createServer === 'function', 'Current HTTP/net symbols missing');
  const controller = new AbortController(); controller.abort(); assert(controller.signal.aborted, 'AbortController failed');
  return { x25519HkdfAesGcm: true, gcmTamperRejected: true, ed25519: true, sha256Vector: true,
    deflateGzip: true, streamPipeline: true, originalFsImported: true,
    bigIntStat: { dev: String(stamp.dev), ino: String(stamp.ino), size: String(stamp.size), mtimeNs: String(stamp.mtimeNs), ctimeNs: String(stamp.ctimeNs) },
    fsDurabilitySymbolsPresent: true, fsDurabilityWriteExercised: false, httpNetSymbolsPresent: true,
    listenersOpenedByProbe: false, abortController: true };
}
async function main() {
  const result = { version: 1, purpose: PURPOSE, passed: false, engineVersionExpected: '44.7.2',
    versions: { ...process.versions }, platform: process.platform, arch: process.arch,
    businessLoaded: false, databaseFilesOpened: false, backupExercised: false,
    sourcePolicyCapabilitiesEligible: false, productionDeploymentAuthorized: false };
  try {
    const seal = process.argv[2] || '';
    result.actualContext = guard(seal);
    result.cimAdmission = await admission(seal);
    result.sqlite = sqliteMemory();
    cancelled();
    result.nodeAPIs = await nodeAPIs();
    cancelled();
    result.passed = true;
  } catch (error) { result.error = String(error.stack || error); }
  process.stdout.write(JSON.stringify(result)+'\n');
  process.exitCode = result.passed ? 0 : 1; // Natural event-loop exit; no forced termination.
}
if (require.main === module) main().catch(error => { process.stderr.write(String(error.stack || error)+'\n'); process.exitCode = 1; });

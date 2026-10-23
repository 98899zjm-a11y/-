'use strict';
// Fixed engine44.9 compatibility resource candidate, app1.6.1, unsigned and not deployed. Root alone runs each phase in actual Guest.
// prepare -> freeze-only -> Root reviews the saved freeze SHA -> seal --freeze-sha256 <SHA>.
// public-key may run separately; seal also verifies/materializes the same original public key.
// No signing key, database, application launch, installation, repair or retry mode.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..'), VERSION = '1.6.1';
if (process.platform !== 'win32' || os.userInfo().username.toLowerCase() !== 'wdagutilityaccount' || ROOT.toLowerCase() !== 'c:\\xjy-work\\xjy-web-stage1') throw Error('Fixed actual Windows Sandbox required before candidate preparation');
const { createIsolationGuard } = require('../stage1/isolation.cjs'), rootGuard = createIsolationGuard(ROOT);
const RESULTS = 'C:/xjy-results', WORK = path.join(ROOT, 'release-work/engine-4490-a1/build'), OUTPUT = path.join(ROOT, 'release/engine-4490-a1');
const DEPS = path.join(ROOT, 'audit-tools/dependencies/node_modules'), MODULES = path.join(ROOT, 'release-work/finance-repack-green-a2/modules-input');
const PUBLIC_DATA = path.join(ROOT, 'audit-tools/issuer-public.data'), PUBLIC_KEY = path.join(ROOT, 'config/release-signing/issuer-public.pem');
const PUBLIC_SHA = 'bc6c3d2b42871e42d3eb91371034b410d507a228eeccb1d714acca60e8141b30';
const BUILDER = path.join(ROOT, 'stage1/build-full-release.cjs'), BUILDER_SHA = '5f4c030baf6d3f63ebc23786073b8782fd10d6a11d62654a6b51eeb5c3bbdac1';
const PREPARATION = path.join(WORK, 'preparation.json'), PREP_REPORT = path.join(RESULTS, 'engine-4490-preparation-a1.json');
const FREEZE_FILE = path.join(RESULTS, 'engine-4490-source-freeze-a1.json'), CANDIDATE_REPORT = path.join(RESULTS, 'engine-4490-candidate-a1.json');
const PUBLIC_REPORT = path.join(RESULTS, 'engine-4490-public-key-a1.json'), EXPORT = path.join(RESULTS, 'engine-4490-artifact-a1');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function requireTrue(value, message) { if (!value) throw Error(message); }
function stamp(stat) { return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs, stat.nlink, stat.birthtimeNs].map(String).join(':'); }
function readStable(file, guard, limit = 16777216) {
  file = guard.assertPath(file); const before = fs.lstatSync(file, { bigint: true });
  requireTrue(before.isFile() && !before.isSymbolicLink() && before.nlink === 1n && before.size >= 0n && before.size <= BigInt(limit), 'Bounded ordinary single-link input required');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const opened = fs.fstatSync(fd, { bigint: true }), common = ['dev', 'ino', 'size', 'mtimeNs', 'nlink'];
    requireTrue(common.every(key => before[key] === opened[key]) && (before.birthtimeNs === undefined || opened.birthtimeNs === undefined || before.birthtimeNs === opened.birthtimeNs), 'Input changed before read');
    const bytes = Buffer.alloc(Number(before.size)); let position = 0;
    while (position < bytes.length) { const count = fs.readSync(fd, bytes, position, bytes.length - position, position); requireTrue(count > 0, 'Input ended early'); position += count; }
    requireTrue(fs.readSync(fd, Buffer.alloc(1), 0, 1, position) === 0 && stamp(fs.fstatSync(fd, { bigint: true })) === stamp(opened), 'Input changed during read');
    requireTrue(stamp(fs.lstatSync(guard.assertPath(file), { bigint: true })) === stamp(before), 'Input changed after read'); return bytes;
  } finally { fs.closeSync(fd); }
}
function writeNew(file, bytes, guard) {
  file = guard.assertPath(file); fs.mkdirSync(guard.assertPath(path.dirname(file)), { recursive: true }); guard.assertPath(path.dirname(file));
  const fd = fs.openSync(file, 'wx', 0o600); try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  requireTrue(readStable(file, guard, Math.max(bytes.length, 1)).equals(bytes), 'CreateNew output differs from the written bytes'); return { file, size: bytes.length, sha256: sha(bytes) };
}
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
function fresh(file, guard) { file = guard.assertPath(file); requireTrue(!fs.existsSync(file), 'CreateNew evidence already exists: ' + file); }
function builderStillPinned() { requireTrue(sha(readStable(BUILDER, rootGuard, 1048576)) === BUILDER_SHA, 'Root-reviewed builder changed'); }
function readJson(file, guard) { return JSON.parse(readStable(file, guard).toString('utf8')); }
function sameFreeze(left, right) {
  return left?.version === 1 && right?.version === 1 && left.purpose === 'xjy-full-release-' + VERSION && right.purpose === left.purpose &&
    JSON.stringify(Object.keys(left).sort()) === JSON.stringify(Object.keys(right).sort()) &&
    JSON.stringify(Object.entries(left.files || {}).sort()) === JSON.stringify(Object.entries(right.files || {}).sort());
}

for (const [relative, pin] of Object.entries({ 'stage1/sandbox-context.py': '09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249', 'stage1/validate-sandbox-context.py': '867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207' })) requireTrue(sha(readStable(path.join(ROOT, relative), rootGuard, 1048576)) === pin, 'Original actual Guest admission source changed');
const proof = require('node:child_process').spawnSync('C:\\Python314\\python.exe', ['-I', '-B', rootGuard.assertPath(path.join(ROOT, 'stage1/validate-sandbox-context.py'))], { cwd: ROOT, windowsHide: true, encoding: 'utf8' });
requireTrue(!proof.error && proof.status === 0, 'Original actual Guest admission refused'); const actualGuest = JSON.parse(proof.stdout);
builderStillPinned(); const builder = require('../stage1/build-full-release.cjs'); builderStillPinned();
if (!fs.existsSync(RESULTS)) fs.mkdirSync(RESULTS); const resultGuard = createIsolationGuard(RESULTS);

function ensurePublicKey() {
  const bytes = readStable(PUBLIC_DATA, rootGuard, 8192), text = bytes.toString('utf8');
  requireTrue(sha(bytes) === PUBLIC_SHA && /^-----BEGIN PUBLIC KEY-----\r?\n/.test(text) && !/PRIVATE KEY/.test(text), 'Exact original Root-approved public key data required');
  const key = crypto.createPublicKey(bytes); requireTrue(key.type === 'public' && key.asymmetricKeyType === 'ed25519', 'Original Ed25519 public key required');
  rootGuard.assertPath(PUBLIC_KEY); let created = false;
  if (fs.existsSync(PUBLIC_KEY)) requireTrue(readStable(PUBLIC_KEY, rootGuard, 8192).equals(bytes), 'Existing isolated public key differs; never overwrite it');
  else { writeNew(PUBLIC_KEY, bytes, rootGuard); created = true; }
  return { file: PUBLIC_KEY, source: PUBLIC_DATA, sha256: PUBLIC_SHA, publisherPublicKeySha256: sha(key.export({ type: 'spki', format: 'der' })), created, privateMaterial: false, originalIssuerReused: true };
}
function savedPreparation() {
  const bytes = readStable(PREPARATION, rootGuard), preparation = JSON.parse(bytes.toString('utf8')), report = readJson(PREP_REPORT, resultGuard);
  requireTrue(report.phase === 'prepare' && report.prepared === true && report.builderSha256 === BUILDER_SHA && report.savedPreparation?.sha256 === sha(bytes), 'Saved preparation must match its original CreateNew evidence');
  requireTrue(preparation.version === 1 && preparation.programVersion === VERSION && preparation.workDir === WORK && preparation.app === path.join(WORK, 'app-input') && preparation.resources === path.join(WORK, 'resources-input') && preparation.serviceStarted === false && preparation.dataIncluded === false, 'Fixed 1.6.1 preparation identity required');
  requireTrue(JSON.stringify(preparation) === JSON.stringify(report.preparation), 'Original preparation metadata changed'); return { preparation, sha256: sha(bytes) };
}
function exportResources(manifest) {
  fresh(EXPORT, resultGuard); fs.mkdirSync(resultGuard.assertPath(EXPORT)); const exportGuard = createIsolationGuard(EXPORT);
  for (const entry of manifest.files) {
    const name = builder.assertProgramPath(entry.path), source = rootGuard.assertPath(path.join(OUTPUT, ...name.split('/'))), bytes = readStable(source, rootGuard, 805306368);
    requireTrue(bytes.length === entry.size && sha(bytes) === entry.sha256, 'Sealed resource changed before export: ' + name);
    const copied = writeNew(path.join(EXPORT, ...name.split('/')), bytes, exportGuard); requireTrue(copied.size === entry.size && copied.sha256 === entry.sha256, 'Export resource verification failed: ' + name);
  }
  const actual = builder.artifactList(EXPORT); requireTrue(JSON.stringify(actual) === JSON.stringify(manifest.files), 'Export has extra, missing or changed resource files');
  const manifestRecord = writeNew(path.join(EXPORT, 'release-manifest.json'), jsonBytes(manifest), exportGuard);
  const evidence = { version: 1, purpose: 'engine-4490-data-free-resource-export', programVersion: VERSION, unsigned: true, signed: false, installed: false, programExecuted: false, servicesStarted: false, resourcesOnly: true, dataIncluded: false, fileCount: actual.length, files: actual, sourceManifestSha256: manifestRecord.sha256, allResourceBytesVerified: true, extraResourceFiles: false, financeCsvBinaryUpdateIncluded: true };
  const proofRecord = writeNew(path.join(EXPORT, 'data-free-proof.json'), jsonBytes(evidence), exportGuard); return { directory: EXPORT, manifest: manifestRecord, proof: proofRecord, resourceFileCount: actual.length };
}
async function main() {
  const args = process.argv.slice(2), phase = args[0];
  requireTrue((args.length === 1 && ['prepare', 'freeze-only', 'public-key'].includes(phase)) || (args.length === 3 && phase === 'seal' && args[1] === '--freeze-sha256' && /^[a-f0-9]{64}$/.test(args[2])), 'Only fixed prepare, freeze-only, public-key or seal --freeze-sha256 <Root-approved saved-freeze SHA> is allowed');
  const destination = phase === 'prepare' ? PREP_REPORT : phase === 'freeze-only' ? FREEZE_FILE : phase === 'public-key' ? PUBLIC_REPORT : CANDIDATE_REPORT; fresh(destination, resultGuard);
  const common = { version: 1, phase, programVersion: VERSION, actualGuest, harnessSha256: sha(readStable(__filename, rootGuard, 1048576)), builderSha256: BUILDER_SHA, unsigned: true, signed: false, installed: false, programExecuted: false, servicesStarted: false, dataIncluded: false };
  if (phase === 'public-key') {
    const key = ensurePublicKey(); builderStillPinned(); const output = writeNew(PUBLIC_REPORT, jsonBytes({ ...common, publicKey: key, privateMaterial: false }), resultGuard); console.log(JSON.stringify({ ...output, phase, privateMaterial: false, installed: false })); return;
  }
  if (phase === 'prepare') {
    const preparation = await builder.prepareFullRelease({ programVersion: VERSION, workDir: WORK, dependenciesRoot: DEPS, bundledDependenciesRoot: DEPS });
    const saved = readStable(PREPARATION, rootGuard); requireTrue(JSON.stringify(JSON.parse(saved.toString('utf8'))) === JSON.stringify(preparation) && preparation.programVersion === VERSION && preparation.serviceStarted === false && preparation.dataIncluded === false, 'Actual preparation evidence mismatch'); builderStillPinned();
    const output = writeNew(PREP_REPORT, jsonBytes({ ...common, prepared: true, sealed: false, dependenciesRoot: DEPS, savedPreparation: { file: PREPARATION, sha256: sha(saved) }, sourceHashes: preparation.sourceHashes, preparation, rootFreezeApprovalRequired: true }), resultGuard); console.log(JSON.stringify({ ...output, phase, prepared: true, sealed: false, signed: false })); return;
  }
  const saved = savedPreparation();
  if (phase === 'freeze-only') {
    const freeze = builder.sourceFreeze({ programVersion: VERSION }); requireTrue(freeze.version === 1 && freeze.purpose === 'xjy-full-release-' + VERSION, 'Actual 1.6.1 sourceFreeze required'); builderStillPinned();
    const output = writeNew(FREEZE_FILE, jsonBytes(freeze), resultGuard); console.log(JSON.stringify({ ...output, phase, runtimeSourceCount: Object.keys(freeze.files).length, preparationSha256: saved.sha256, rootApprovalGranted: false, signed: false, installed: false })); return;
  }
  const freezeBytes = readStable(FREEZE_FILE, resultGuard); requireTrue(sha(freezeBytes) === args[2], 'Saved freeze does not match Root-approved SHA; no automatic replacement');
  const freeze = JSON.parse(freezeBytes.toString('utf8')); requireTrue(sameFreeze(freeze, builder.sourceFreeze({ programVersion: VERSION })), 'Current runtime source differs from Root-approved saved freeze');
  fresh(OUTPUT, rootGuard); fresh(EXPORT, resultGuard); const publicKey = ensurePublicKey();
  const manifest = await builder.sealFullRelease({ programVersion: VERSION, preparation: saved.preparation, freeze, outputDir: OUTPUT, publicKeyFile: PUBLIC_KEY, moduleResourcesRoot: MODULES, asarDependenciesRoot: DEPS });
  requireTrue(manifest.programVersion === VERSION && manifest.resourcesOnly === true && manifest.outputDir === OUTPUT && manifest.asar?.allEntriesExtracted === true && manifest.asar.entryCount > 0 && manifest.asar.entryCount === manifest.asar.entries.length && manifest.publicPins?.programVersion === VERSION && manifest.publicPins.publisherPublicKeySha256 === publicKey.publisherPublicKeySha256, 'Actual ASAR/pin/manifest verification incomplete');
  requireTrue(JSON.stringify([...manifest.publicPins.allowedFiles].sort()) === JSON.stringify(manifest.files.map(entry => entry.path).sort()), 'Helper pins and final resource paths differ');
  const bootstrapBytes = readStable(path.join(OUTPUT, 'resources/update-helper/bootstrap.json'), rootGuard, 1048576), bootstrap = JSON.parse(bootstrapBytes.toString('utf8'));
  requireTrue(sha(bootstrapBytes) === manifest.publicPins.bootstrapSha256 && bootstrap.programVersion === VERSION && sha(crypto.createPublicKey(bootstrap.publisherPublicKey).export({ type: 'spki', format: 'der' })) === publicKey.publisherPublicKeySha256 && JSON.stringify(bootstrap.allowedFiles) === JSON.stringify(manifest.publicPins.allowedFiles), 'Actual helper bootstrap does not match selected version/trusted publisher/paths');
  requireTrue(sha(readStable(PREPARATION, rootGuard)) === saved.sha256 && sameFreeze(freeze, builder.sourceFreeze({ programVersion: VERSION })), 'Original preparation or frozen source changed during seal'); builderStillPinned();
  const exported = { directory: OUTPUT, verifiedResourcesInGuest: true, copiedToHost: false }, output = writeNew(CANDIDATE_REPORT, jsonBytes({ ...common, prepared: true, sealed: true, dependenciesRoot: DEPS, asarDependenciesRoot: DEPS, moduleResourcesRoot: MODULES, legacyModules: 'verified finance404-to56 candidate; complete inventory retained', financeCsvBinaryUpdateIncluded: true, preparationSha256: saved.sha256, freeze: { file: FREEZE_FILE, rootApprovedSha256: args[2] }, publicKey, sourceHashes: saved.preparation.sourceHashes, manifest, exported }), resultGuard);
  console.log(JSON.stringify({ ...output, phase, outputDir: OUTPUT, exported: EXPORT, fileCount: manifest.fileCount, asarSha256: manifest.asar.sha256, signed: false, installed: false, programExecuted: false }));
}
main().catch(error => { console.error(JSON.stringify({ purpose: 'engine-4490-candidate', passed: false, unsigned: true, installed: false, programExecuted: false, error: error.message })); process.exitCode = 1; });

'use strict';
// One fixed unsigned 1.6.2 candidate. Root alone runs each phase in actual Guest.
// prepare -> freeze-only -> Root reviews the saved freeze SHA -> seal --freeze-sha256 <SHA>.
// public-key may run separately; seal also verifies/materializes the same original public key.
// Exact platinum-ledger-repack-a2 modules only; no fallback to original modules.
// No signing key, database, application launch, installation, repair or retry mode.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..'), VERSION = '1.6.2';
if (process.platform !== 'win32' || os.userInfo().username.toLowerCase() !== 'wdagutilityaccount' || ROOT.toLowerCase() !== 'c:\\xjy-work\\xjy-web-stage1') throw Error('Fixed actual Windows Sandbox required before candidate preparation');
const { createIsolationGuard } = require('../stage1/isolation.cjs'), rootGuard = createIsolationGuard(ROOT);
const RESULTS = 'C:/xjy-results', WORK = path.join(ROOT, 'release-work/release-162-a4'), OUTPUT = path.join(ROOT, 'release/release-162-a4');
const DEPS = path.join(ROOT, 'audit-tools/dependencies/node_modules'), MODULE_RUN = path.join(ROOT, 'release-work/platinum-ledger-repack-a2');
const MODULES = path.join(MODULE_RUN, 'modules-input'), MODULE_PROOF = path.join(MODULE_RUN, 'candidate-proof.json');
const MODULE_PINS = Object.freeze({ manifest: 'a32e4fd6ffa7da5842b5e5364396736c6b80d4775d3b5ebd10a9d78465418d16', proof: '186619f9af8678165f1d21a3e0c67fc494a99d860bd0d767fb1539096477a36b', ledger: '58a654849f11bc7e8bdd12e1b48a24f4cef0b6cacef89be307c95d238e557945', template: '3b574daa8d6969d87dd2401b09f325f8a6c1ca25f0db21251bae0867831ca57f' });
const MODULE_SOURCES = Object.freeze({
  'project/desktop/legacy-source/ledger/inventory_dashboard.py': '5a2616a55beadf3a4b89c380074e83daa0fb2e99c3b639d01e2df56cf34101ad',
  'project/desktop/legacy-source/sidecar_release.py': '380dd17d8c1eee99faba7fce67ff3eb68326d5bef2e35c329d59784fabb0f9f5',
  'project/desktop/legacy-source/ledger/app/templates/stock.html': MODULE_PINS.template,
});
const PUBLIC_DATA = path.join(ROOT, 'audit-tools/issuer-public.data'), PUBLIC_KEY = path.join(ROOT, 'config/release-signing/issuer-public.pem');
const PUBLIC_SHA = 'bc6c3d2b42871e42d3eb91371034b410d507a228eeccb1d714acca60e8141b30';
const BUILDER = path.join(ROOT, 'stage1/build-full-release.cjs'), BUILDER_SHA = '943e69bd503d43c7b7fc816f3c0a39ee1f00a8ab4cc63a8196cddd743239bc01';
const PREPARATION = path.join(WORK, 'preparation.json'), PREP_REPORT = path.join(RESULTS, 'release-162-preparation-a4.json');
const FREEZE_FILE = path.join(RESULTS, 'release-162-source-freeze-a4.json'), CANDIDATE_REPORT = path.join(RESULTS, 'release-162-candidate-a4.json');
const PUBLIC_REPORT = path.join(RESULTS, 'release-162-public-key-a4.json'), EXPORT = path.join(RESULTS, 'release-162-artifact-a4');
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
function verifiedModuleInputs() {
  const manifestFile = path.join(MODULES, 'manifest.json'), manifestBytes = readStable(manifestFile, rootGuard, 1048576), proofBytes = readStable(MODULE_PROOF, rootGuard, 1048576);
  requireTrue(sha(manifestBytes) === MODULE_PINS.manifest && sha(proofBytes) === MODULE_PINS.proof, 'Exact reviewed platinum-ledger-repack-a2 manifest/proof required; no older module fallback');
  const proof = JSON.parse(proofBytes.toString('utf8'));
  requireTrue(proof.candidateExeSha256 === MODULE_PINS.ledger && proof.candidateSize === 8522437 && proof.programFileCount === 496 && proof.unchangedOriginalProgramFiles === 494 && proof.unknownCodeObjectsVerified === 925 && proof.namespacesVerified === 6 && proof.prefixExceptChecksumIdentical === true && proof.archivePayloadExecuted === false && proof.businessModulesImported === false && proof.originalInputsUnchanged === true, 'Reviewed module proof identity incomplete');
  requireTrue(proof.sourcePins?.newInventory === MODULE_SOURCES['project/desktop/legacy-source/ledger/inventory_dashboard.py'] && proof.sourcePins?.newSidecar === MODULE_SOURCES['project/desktop/legacy-source/sidecar_release.py'] && proof.sourcePins?.newTemplate === MODULE_PINS.template, 'Reviewed module proof and finance sources differ');
  const records = builder.collectModuleResources(MODULES), find = name => records.find(item => item.relative === 'resources/release-modules/' + name);
  const manifest = find('manifest.json'), ledger = find('xjy-ledger/xjy-ledger.exe'), template = find('xjy-ledger/_internal/app/templates/stock.html');
  requireTrue(records.length === 497 && manifest?.sha256 === MODULE_PINS.manifest && ledger?.sha256 === MODULE_PINS.ledger && ledger.size === proof.candidateSize && template?.sha256 === MODULE_PINS.template, 'Complete two-module tree does not match the reviewed candidate');
  for (const [relative, pin] of Object.entries(MODULE_SOURCES)) requireTrue(sha(readStable(path.join(ROOT, ...relative.split('/')), rootGuard, 1048576)) === pin, 'Reviewed finance source changed: ' + relative);
  requireTrue(readStable(manifestFile, rootGuard, 1048576).equals(manifestBytes) && readStable(MODULE_PROOF, rootGuard, 1048576).equals(proofBytes), 'Module manifest or proof changed during complete-tree verification');
  return { root: MODULES, manifest: { file: manifestFile, size: manifestBytes.length, sha256: MODULE_PINS.manifest }, proof: { file: MODULE_PROOF, size: proofBytes.length, sha256: MODULE_PINS.proof }, ledgerExe: { file: ledger.file, size: ledger.size, sha256: ledger.sha256 }, template: { file: template.file, size: template.size, sha256: template.sha256 }, sourcePins: MODULE_SOURCES, programFileCount: 496, allModuleBytesVerified: true };
}
function modulesStillPinned(expected) { requireTrue(JSON.stringify(verifiedModuleInputs()) === JSON.stringify(expected), 'Original reviewed module inputs changed; no automatic re-pin'); }
function preparedSourcesStillPinned(preparation) {
  requireTrue(preparation.sourceHashes && Object.keys(preparation.sourceHashes).length > 0, 'Original compiler source hashes required');
  for (const [name, pin] of Object.entries(preparation.sourceHashes)) {
    requireTrue(typeof name === 'string' && !name.split('/').some(part => !part || part === '.' || part === '..' || /[\\:\x00-\x1f]/.test(part)) && /^[a-f0-9]{64}$/.test(pin), 'Canonical prepared source identity required');
    requireTrue(sha(readStable(path.join(ROOT, 'project', ...name.split('/')), rootGuard, 16777216)) === pin, 'Compiler source changed since preparation: ' + name);
  }
}
function savedPreparation(moduleInputs) {
  const bytes = readStable(PREPARATION, rootGuard), preparation = JSON.parse(bytes.toString('utf8')), report = readJson(PREP_REPORT, resultGuard);
  requireTrue(report.phase === 'prepare' && report.prepared === true && report.builderSha256 === BUILDER_SHA && report.savedPreparation?.sha256 === sha(bytes), 'Saved preparation must match its original CreateNew evidence');
  requireTrue(JSON.stringify(report.moduleInputs) === JSON.stringify(moduleInputs), 'Saved preparation did not select these exact reviewed module inputs');
  requireTrue(preparation.version === 1 && preparation.programVersion === VERSION && preparation.workDir === WORK && preparation.app === path.join(WORK, 'app-input') && preparation.resources === path.join(WORK, 'resources-input') && preparation.serviceStarted === false && preparation.dataIncluded === false, 'Fixed 1.6.2 preparation identity required');
  requireTrue(JSON.stringify(preparation) === JSON.stringify(report.preparation), 'Original preparation metadata changed'); preparedSourcesStillPinned(preparation); return { preparation, sha256: sha(bytes) };
}
function exportResources(manifest, moduleInputs) {
  fresh(EXPORT, resultGuard); fs.mkdirSync(resultGuard.assertPath(EXPORT)); const exportGuard = createIsolationGuard(EXPORT);
  for (const entry of manifest.files) {
    const name = builder.assertProgramPath(entry.path), source = rootGuard.assertPath(path.join(OUTPUT, ...name.split('/'))), bytes = readStable(source, rootGuard, 805306368);
    requireTrue(bytes.length === entry.size && sha(bytes) === entry.sha256, 'Sealed resource changed before export: ' + name);
    const copied = writeNew(path.join(EXPORT, ...name.split('/')), bytes, exportGuard); requireTrue(copied.size === entry.size && copied.sha256 === entry.sha256, 'Export resource verification failed: ' + name);
  }
  const actual = builder.artifactList(EXPORT); requireTrue(JSON.stringify(actual) === JSON.stringify(manifest.files), 'Export has extra, missing or changed resource files');
  const manifestRecord = writeNew(path.join(EXPORT, 'release-manifest.json'), jsonBytes(manifest), exportGuard);
  const evidence = { version: 1, purpose: 'release-162-data-free-resource-export', programVersion: VERSION, unsigned: true, signed: false, installed: false, programExecuted: false, servicesStarted: false, resourcesOnly: true, dataIncluded: false, fileCount: actual.length, files: actual, sourceManifestSha256: manifestRecord.sha256, allResourceBytesVerified: true, extraResourceFiles: false, financeCsvBinaryUpdateIncluded: true, inventoryStateAndFilteredCsvIncluded: true, moduleInputs };
  const proofRecord = writeNew(path.join(EXPORT, 'data-free-proof.json'), jsonBytes(evidence), exportGuard); return { directory: EXPORT, manifest: manifestRecord, proof: proofRecord, resourceFileCount: actual.length };
}
async function main() {
  const args = process.argv.slice(2), phase = args[0];
  requireTrue((args.length === 1 && ['prepare', 'freeze-only', 'public-key'].includes(phase)) || (args.length === 3 && phase === 'seal' && args[1] === '--freeze-sha256' && /^[a-f0-9]{64}$/.test(args[2])), 'Only fixed prepare, freeze-only, public-key or seal --freeze-sha256 <Root-approved saved-freeze SHA> is allowed');
  const destination = phase === 'prepare' ? PREP_REPORT : phase === 'freeze-only' ? FREEZE_FILE : phase === 'public-key' ? PUBLIC_REPORT : CANDIDATE_REPORT; fresh(destination, resultGuard);
  const moduleInputs = verifiedModuleInputs();
  const common = { version: 1, phase, programVersion: VERSION, actualGuest, harnessSha256: sha(readStable(__filename, rootGuard, 1048576)), builderSha256: BUILDER_SHA, unsigned: true, signed: false, installed: false, programExecuted: false, servicesStarted: false, dataIncluded: false, moduleInputs };
  if (phase === 'public-key') {
    const key = ensurePublicKey(); builderStillPinned(); modulesStillPinned(moduleInputs); const output = writeNew(PUBLIC_REPORT, jsonBytes({ ...common, publicKey: key, privateMaterial: false }), resultGuard); console.log(JSON.stringify({ ...output, phase, privateMaterial: false, installed: false })); return;
  }
  if (phase === 'prepare') {
    const preparation = await builder.prepareFullRelease({ programVersion: VERSION, workDir: WORK, dependenciesRoot: DEPS, bundledDependenciesRoot: DEPS });
    const saved = readStable(PREPARATION, rootGuard); requireTrue(JSON.stringify(JSON.parse(saved.toString('utf8'))) === JSON.stringify(preparation) && preparation.programVersion === VERSION && preparation.serviceStarted === false && preparation.dataIncluded === false, 'Actual preparation evidence mismatch'); builderStillPinned(); modulesStillPinned(moduleInputs); preparedSourcesStillPinned(preparation);
    const output = writeNew(PREP_REPORT, jsonBytes({ ...common, prepared: true, sealed: false, dependenciesRoot: DEPS, savedPreparation: { file: PREPARATION, sha256: sha(saved) }, sourceHashes: preparation.sourceHashes, preparation, rootFreezeApprovalRequired: true }), resultGuard); console.log(JSON.stringify({ ...output, phase, prepared: true, sealed: false, signed: false })); return;
  }
  const saved = savedPreparation(moduleInputs);
  if (phase === 'freeze-only') {
    const freeze = builder.sourceFreeze({ programVersion: VERSION }); requireTrue(freeze.version === 1 && freeze.purpose === 'xjy-full-release-' + VERSION, 'Actual 1.6.2 sourceFreeze required'); builderStillPinned(); modulesStillPinned(moduleInputs); preparedSourcesStillPinned(saved.preparation);
    const output = writeNew(FREEZE_FILE, jsonBytes(freeze), resultGuard); console.log(JSON.stringify({ ...output, phase, runtimeSourceCount: Object.keys(freeze.files).length, preparationSha256: saved.sha256, rootApprovalGranted: false, signed: false, installed: false })); return;
  }
  const freezeBytes = readStable(FREEZE_FILE, resultGuard); requireTrue(sha(freezeBytes) === args[2], 'Saved freeze does not match Root-approved SHA; no automatic replacement');
  const freeze = JSON.parse(freezeBytes.toString('utf8')); requireTrue(sameFreeze(freeze, builder.sourceFreeze({ programVersion: VERSION })), 'Current runtime source differs from Root-approved saved freeze');
  fresh(OUTPUT, rootGuard); fresh(EXPORT, resultGuard); const publicKey = ensurePublicKey();
  const manifest = await builder.sealFullRelease({ programVersion: VERSION, preparation: saved.preparation, freeze, outputDir: OUTPUT, publicKeyFile: PUBLIC_KEY, moduleResourcesRoot: MODULES, asarDependenciesRoot: DEPS });
  requireTrue(manifest.programVersion === VERSION && manifest.resourcesOnly === true && manifest.outputDir === OUTPUT && manifest.asar?.allEntriesExtracted === true && manifest.asar.entryCount > 0 && manifest.asar.entryCount === manifest.asar.entries.length && manifest.publicPins?.programVersion === VERSION && manifest.publicPins.publisherPublicKeySha256 === publicKey.publisherPublicKeySha256, 'Actual ASAR/pin/manifest verification incomplete');
  requireTrue(JSON.stringify([...manifest.publicPins.allowedFiles].sort()) === JSON.stringify(manifest.files.map(entry => entry.path).sort()), 'Helper pins and final resource paths differ');
  for (const [name, pin] of Object.entries({ 'manifest.json': MODULE_PINS.manifest, 'xjy-ledger/xjy-ledger.exe': MODULE_PINS.ledger, 'xjy-ledger/_internal/app/templates/stock.html': MODULE_PINS.template })) requireTrue(manifest.files.find(entry => entry.path === 'resources/release-modules/' + name)?.sha256 === pin, 'Sealed output did not contain the exact reviewed module file: ' + name);
  const bootstrapBytes = readStable(path.join(OUTPUT, 'resources/update-helper/bootstrap.json'), rootGuard, 1048576), bootstrap = JSON.parse(bootstrapBytes.toString('utf8'));
  requireTrue(sha(bootstrapBytes) === manifest.publicPins.bootstrapSha256 && bootstrap.programVersion === VERSION && sha(crypto.createPublicKey(bootstrap.publisherPublicKey).export({ type: 'spki', format: 'der' })) === publicKey.publisherPublicKeySha256 && JSON.stringify(bootstrap.allowedFiles) === JSON.stringify(manifest.publicPins.allowedFiles), 'Actual helper bootstrap does not match selected version/trusted publisher/paths');
  requireTrue(sha(readStable(PREPARATION, rootGuard)) === saved.sha256 && sameFreeze(freeze, builder.sourceFreeze({ programVersion: VERSION })), 'Original preparation or frozen source changed during seal'); builderStillPinned(); modulesStillPinned(moduleInputs); preparedSourcesStillPinned(saved.preparation);
  const exported = exportResources(manifest, moduleInputs);
  requireTrue(sha(readStable(PREPARATION, rootGuard)) === saved.sha256 && sameFreeze(freeze, builder.sourceFreeze({ programVersion: VERSION })), 'Original preparation or frozen source changed during export'); builderStillPinned(); modulesStillPinned(moduleInputs); preparedSourcesStillPinned(saved.preparation);
  const output = writeNew(CANDIDATE_REPORT, jsonBytes({ ...common, prepared: true, sealed: true, dependenciesRoot: DEPS, asarDependenciesRoot: DEPS, moduleResourcesRoot: MODULES, legacyModules: 'complete reviewed platinum-ledger-repack-a2 onedir packages; no archive rebuild in this tool', financeCsvBinaryUpdateIncluded: true, inventoryStateAndFilteredCsvIncluded: true, preparationSha256: saved.sha256, freeze: { file: FREEZE_FILE, rootApprovedSha256: args[2] }, publicKey, sourceHashes: saved.preparation.sourceHashes, manifest, exported }), resultGuard);
  console.log(JSON.stringify({ ...output, phase, outputDir: OUTPUT, exported: EXPORT, fileCount: manifest.fileCount, asarSha256: manifest.asar.sha256, signed: false, installed: false, programExecuted: false }));
}
main().catch(error => { console.error(JSON.stringify({ purpose: 'release-162-candidate', passed: false, unsigned: true, installed: false, programExecuted: false, error: error.message })); process.exitCode = 1; });

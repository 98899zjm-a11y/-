// build-fixture.cjs -- builds a SYNTHETIC post-upgrade state dir used only to
// rehearse verify-production.ps1. It never touches real production paths.
// argv: <fixtureRoot> <bindingPath> <businessReleased:true|false>
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const fixtureRoot = process.argv[2];
const bindingPath = process.argv[3];
const businessReleased = String(process.argv[4] || 'true') === 'true';

const installName = 'xjy-jewelry-offline';
const installDir = path.join(fixtureRoot, installName);
const stateDir = path.join(fixtureRoot, '.' + installName + '.xjy-engine-state');
const dataDir = path.join(fixtureRoot, 'data');

const binding = JSON.parse(fs.readFileSync(bindingPath, 'utf8'));
const catalogText = binding.native.targetEnvelope.catalog;
const signature = binding.native.targetEnvelope.signature;
const PUB = binding.native.trust.publisherPublicKeySha256;
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const catalogSha = sha(Buffer.from(catalogText, 'utf8'));
const catalog = JSON.parse(catalogText);

fs.mkdirSync(stateDir, { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(path.join(dataDir, 'ledger.json'), '{"synthetic":true}');

const key = crypto.randomBytes(32);
fs.writeFileSync(path.join(stateDir, 'journal-key.bin'), key);

fs.writeFileSync(path.join(stateDir, 'target-catalog-envelope.json'),
  JSON.stringify({ catalog: catalogText, signature }));

const activation = {
  version: 1,
  product: 'xjy-jewelry-offline',
  programVersion: '1.7.0',
  role: 'host',
  installationDir: installDir
};
fs.writeFileSync(path.join(installDir, 'xjy-install-activation.json'), JSON.stringify(activation));

const transactionId = crypto.randomUUID();
const ns = (os.hostname() + '\\' + (process.env.USERNAME || 'user')).toLowerCase();

const record = {
  version: 5,
  purpose: 'xjy-engine-tree170',
  transactionId,
  phase: 'committed',
  runtimeWrites: true,
  rollbackForbidden: true,
  paths: { installDir, stateDir, dataDir },
  role: 'host',
  publisherPublicKeySha256: PUB,
  sourceCatalogSha256: sha(Buffer.from('source-catalog-fixture')),
  targetCatalogSha256: catalogSha,
  sourceVersion: '1.6.2',
  targetVersion: '1.7.0',
  sourceEngineVersion: '44.7.0',
  targetEngineVersion: '44.9.0',
  identities: { fixed: '11:22:33', source: '11:22:33', stage: '11:22:33' },
  sourceFiles: [{ path: 'version', size: 6, sha256: sha(Buffer.from('44.7.0')) }],
  targetFiles: catalog.files.map((f) => ({ path: f.path, size: f.size, sha256: f.sha256 })),
  sourceActivation: { version: 1, product: 'xjy-jewelry-offline', programVersion: '1.6.2', role: 'host', installationDir: installDir },
  targetActivation: activation,
  dataFiles: [],
  profileFiles: [],
  stageDir: path.join(fixtureRoot, '.stage-fixture'),
  backupDir: path.join(fixtureRoot, '.backup-fixture'),
  failedDir: path.join(fixtureRoot, '.failed-fixture'),
  sourceMutableFiles: [],
  sourceMutableDirectories: [],
  targetMutableFiles: [],
  sourceEvidence: {}
};

const journalPayload = JSON.stringify(record);
const journalMac = crypto.createHmac('sha256', key).update(journalPayload, 'utf8').digest('hex');
const journalJson = JSON.stringify({ payload: journalPayload, mac: journalMac });
fs.writeFileSync(path.join(stateDir, 'journal.json'), journalJson);
const journalSha = sha(fs.readFileSync(path.join(stateDir, 'journal.json')));

const receipt = {
  version: 2,
  purpose: 'xjy-engine-startup-v1',
  transactionId,
  phase: 'committed',
  rollbackForbidden: true,
  installationDir: installDir,
  installationIdentity: '11:22:33',
  stateDir,
  stateIdentity: '11:22:33',
  role: 'host',
  programVersion: '1.7.0',
  engineVersion: '44.9.0',
  catalogSha256: catalogSha,
  publisherPublicKeySha256: PUB,
  osUserNamespace: ns,
  mode: 'upgrade',
  journalSha256: journalSha,
  businessReleased
};
const receiptPayload = JSON.stringify(receipt);
const receiptMac = crypto.createHmac('sha256', key).update('xjy-engine-startup-v1\u0000' + receiptPayload, 'utf8').digest('hex');
fs.writeFileSync(path.join(stateDir, 'engine-startup-status.json'),
  JSON.stringify({ payload: receiptPayload, mac: receiptMac }));

console.log(JSON.stringify({
  fixtureRoot, installDir, stateDir, dataDir,
  targetFiles: record.targetFiles.length,
  catalogSha,
  businessReleased,
  journalSha
}, null, 1));

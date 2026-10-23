'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const core170 = require('../delivery-approval/approval-core-170.cjs');
const transaction = require('../delivery-tools/initial-patch-core.cjs');

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function fixture({ sourceVersion = '1.6.2', targetVersion = '1.7.0', sourceVersions = ['1.6.0', '1.6.1', '1.6.2'], sourceProgramVersions = ['1.6.0', '1.6.1', '1.6.2'], role = 'employee' } = {}) {
  const keys = crypto.generateKeyPairSync('ed25519');
  const engine = { ...core170.ENGINE };
  const now = Date.UTC(2026, 9, 19, 0, 0, 0), targetBytes = Buffer.from('synthetic-1.7-app-asar');
  const sources = Object.fromEntries(sourceProgramVersions.map(version => [version, Buffer.from('synthetic-asar-' + version)]));
  const row = (path, bytes) => ({ path, size: bytes.length, sha256: hash(bytes) });
  const targetFile = row('resources/app.asar', targetBytes), tool = Buffer.from('synthetic-update-tool');
  const toolFile = row('delivery-tools/Initial-Full-Upgrade.ps1', tool);
  const reviewerTools = ['approval-core-170.cjs', 'approval-archive-170.cjs', 'approval-io-170.cjs', 'Prepare-Repeat-Approval-170.ps1'].map(name => row('delivery-approval/' + name, Buffer.from('synthetic reviewer ' + name)));
  const catalog = { schemaVersion: 1, app: 'xjy-jewelry-offline', channel: 'stable', version: targetVersion, sourceVersions, platform: 'win32', arch: 'x64', sequence: 1, publishedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 86400000).toISOString(), archive: { size: 123, sha256: 'a'.repeat(64) }, files: [targetFile] };
  const publicKeyPem = Buffer.from(keys.publicKey.export({ format: 'pem', type: 'spki' }));
  const publicKeySha = hash(keys.publicKey.export({ format: 'der', type: 'spki' }));
  const sign = (field, value) => { const raw = JSON.stringify(value); return Buffer.from(JSON.stringify({ [field]: raw, signature: crypto.sign(null, Buffer.from(raw), keys.privateKey).toString('base64') })); };
  const catalogBytes = sign('catalog', catalog);
  const policy = { schemaVersion: 1, purpose: 'xjy-repeat-program-patch', app: 'xjy-jewelry-offline', targetVersion, catalogSha256: hash(Buffer.from(JSON.stringify(catalog))), publisherPublicKeySha256: publicKeySha, executableName: '鑫金源珠宝报价.exe', engine, sourcePrograms: sourceProgramVersions.map(version => ({ version, main: 'release-entry.cjs', asarSize: sources[version].length, asarSha256: hash(sources[version]) })), tools: [toolFile, ...reviewerTools] };
  const policyBytes = sign('policy', policy);
  const treeFiles = [row('publisher-public.pem', publicKeyPem), row('catalog-envelope.json', catalogBytes), row('source-policy-envelope.json', policyBytes), toolFile, ...reviewerTools, { ...targetFile, path: 'payload/resources/app.asar' }];
  const options = { now, approvalId: '11111111-1111-4111-8111-111111111111', operation: 'initial', independent: { artifactSha256: 'b'.repeat(64), publisherPublicKeySha256: publicKeySha, verifiedPublisherName: '独立核验的鑫金源发布者' }, archive: { sha256: 'b'.repeat(64), files: structuredClone(treeFiles) }, treeFiles: structuredClone(treeFiles), metadata: { publicKeyPem, catalogBytes, policyBytes }, installation: { installationDir: 'C:\\XJY', osUser: 'S-1-5-21-100-200-300-1001', role, engine, transactionState: 'none', source: { name: 'xjy-jewelry-offline', version: sourceVersion, main: 'release-entry.cjs', size: sources[sourceVersion]?.length ?? 0, sha256: hash(sources[sourceVersion] ?? Buffer.from('unsupported')) }, target: { name: 'xjy-jewelry-offline', version: targetVersion, main: 'release-entry.cjs' } }, previousApproval: null, transactionExists: false };
  function refreshPolicy() {
    options.metadata.policyBytes = sign('policy', policy);
    const file = options.treeFiles.find(item => item.path === 'source-policy-envelope.json');
    file.size = options.metadata.policyBytes.length;
    file.sha256 = hash(options.metadata.policyBytes);
    options.archive.files = structuredClone(options.treeFiles);
  }
  return { options, policy, catalog, sources, publicKeySha, engine, refreshPolicy };
}

test('signed 1.7 review accepts an exact supported 1.6 source and emits an approval compatible with the unchanged updater core', () => {
  const f = fixture(), result = core170.review170PublicationApproval(f.options);
  assert.ok(result && typeof result === 'object', 'review must return an explicit approval result');
  assert.equal(result.targetVersion, '1.7.0');
  assert.equal(result.publicationId, f.policy.catalogSha256);
  assert.equal(result.record.role, 'employee');
  assert.equal(result.record.installationDir, 'C:\\XJY');
  assert.equal(transaction.validateApproval(result.record, { osUser: f.options.installation.osUser, now: () => f.options.now, upgradeMode: 'repeat' }).approvalId, result.record.approvalId);
});

test('signed 1.7 review accepts each exact supported 1.6 source tuple', () => {
  for (const version of ['1.6.0', '1.6.1', '1.6.2']) {
    const f = fixture({ sourceVersion: version });
    assert.doesNotThrow(() => core170.review170PublicationApproval(f.options), version);
  }
});

test('signed policy cannot introduce an arbitrary source version even when its tuple and signatures are valid', () => {
  const f = fixture({ sourceVersion: '1.6.9', sourceVersions: ['1.6.9'], sourceProgramVersions: ['1.6.9'] });
  assert.throws(() => core170.review170PublicationApproval(f.options), error => error.code === 'BAD_SOURCE_POLICY' || error.code === 'BAD_CATALOG');
});

test('signed policy cannot change the supported target away from the fixed 1.7.0 package', () => {
  const f = fixture({ targetVersion: '1.7.1' });
  assert.throws(() => core170.review170PublicationApproval(f.options), error => error.code === 'BAD_SOURCE_POLICY' || error.code === 'BAD_CATALOG');
});

test('signed 1.6 source tuple must identify the actual release-entry program, not an arbitrary main module', () => {
  const f = fixture(); f.policy.sourcePrograms[0].main = 'main.cjs'; f.refreshPolicy();
  assert.throws(() => core170.review170PublicationApproval(f.options), error => error.code === 'BAD_SOURCE_POLICY');
});

test('changed engine, ASAR, role, SID, or installation path cannot produce an approval', () => {
  for (const mutate of [
    f => { f.options.installation.engine.sha256 = 'f'.repeat(64); },
    f => { f.options.installation.source.sha256 = 'f'.repeat(64); },
    f => { f.options.installation.role = 'unexpected'; },
    f => { f.options.installation.osUser = 'Administrator'; },
    f => { f.options.installation.installationDir = 'C:\\XJY\\..\\Other'; },
  ]) { const f = fixture(); mutate(f); assert.throws(() => core170.review170PublicationApproval(f.options)); }
});

test('tampered catalog or policy signatures never produce an approval', () => {
  for (const which of ['catalogBytes', 'policyBytes']) {
    const f = fixture(); f.options.metadata[which] = Buffer.from(f.options.metadata[which]); f.options.metadata[which][f.options.metadata[which].length - 3] ^= 1;
    const file = f.options.treeFiles.find(row => row.path === (which === 'catalogBytes' ? 'catalog-envelope.json' : 'source-policy-envelope.json'));
    file.size = f.options.metadata[which].length; file.sha256 = hash(f.options.metadata[which]); f.options.archive.files = structuredClone(f.options.treeFiles);
    assert.throws(() => core170.review170PublicationApproval(f.options), error => ['BAD_SIGNATURE', 'BAD_METADATA', 'BAD_CATALOG', 'BAD_SOURCE_POLICY'].includes(error.code));
  }
});

test('a prior approval bound to another package or source policy cannot authorize the 1.7 package', () => {
  const f = fixture(), original = core170.review170PublicationApproval(f.options).record;
  const request = { ...f.options, operation: 'reapprove-original', previousApproval: { ...original, artifactSha256: 'c'.repeat(64), sourcePolicySha256: 'd'.repeat(64) }, transactionExists: true };
  assert.throws(() => core170.review170PublicationApproval(request), error => error.code === 'PRIOR_APPROVAL_MISMATCH');
});

test('pending or unknown program transactions block a new 1.7 approval; committed/rolledback source states can proceed', () => {
  for (const state of ['prepared', 'mutating', 'unknown']) {
    const f = fixture(); f.options.installation.transactionState = state;
    assert.throws(() => core170.review170PublicationApproval(f.options), error => error.code === 'RECOVERY_REQUIRED');
  }
  for (const state of ['committed', 'rolledback']) {
    const f = fixture(); f.options.installation.transactionState = state;
    assert.doesNotThrow(() => core170.review170PublicationApproval(f.options), state);
  }
});


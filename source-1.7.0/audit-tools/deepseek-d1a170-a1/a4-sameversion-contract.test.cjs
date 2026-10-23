// 保存路径：<a4树根>/tests/a4-sameversion-contract.test.cjs
'use strict';
// a4 同版外置补丁合同测试。用法：node tests/a4-sameversion-contract.test.cjs [a4树根]
const crypto = require('node:crypto'), fs = require('node:fs'), path = require('node:path');

function findRoot(start) {
  let dir = path.resolve(start);
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'worker-draft/delivery-approval/approval-core-170.cjs')) &&
        fs.existsSync(path.join(dir, 'worker-draft/delivery-tools/initial-patch-core.cjs'))) return dir;
    const up = path.dirname(dir); if (up === dir) break; dir = up;
  }
  return null;
}
const ROOT = findRoot(process.argv[2] || __dirname);
if (!ROOT) { console.error('[BLOCKED] 未找到 a4 树根（需 worker-draft/...）'); process.exit(2); }

const approval = require(path.join(ROOT, 'worker-draft/delivery-approval/approval-core-170.cjs'));
const core = require(path.join(ROOT, 'worker-draft/delivery-tools/initial-patch-core.cjs'));
const { ENGINE, SOURCE_VERSIONS } = approval;

let pass = 0, fail = 0; const FAILED = [];
function t(id, ok, detail) {
  if (ok) { pass++; console.log('[PASS] ' + id + (detail ? ' ' + detail : '')); }
  else { fail++; FAILED.push(id); console.log('[FAIL] ' + id + (detail ? ' ' + detail : '')); }
}
function expectCode(id, fn, codes) {
  try { fn(); t(id, false, '未拒绝'); }
  catch (e) {
    const list = [].concat(codes);
    t(id, list.includes(e.code), 'code=' + e.code + (list.includes(e.code) ? '' : ' 期望 ' + list.join('/')));
  }
}

// ---- 虚构成分 ----
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const PEM = publicKey.export({ type: 'spki', format: 'pem' });
const PUB_SHA = crypto.createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const sign = s => crypto.sign(null, Buffer.from(s, 'utf8'), privateKey).toString('base64');
const hex = c => c.repeat(64);
const APP170 = { size: 247184896, sha256: 'c99a56d653220a8bf209b0b9ae2424ec1f1580946d1bf3395a968eb211a4f1b5' };
const PROD = 'xjy-jewelry-offline', EXE = '鑫金源珠宝报价.exe';
const INSTALL_DIR = 'C:\\XjyFixture\\Employee';
const SID = 'S-1-5-21-1111111111-2222222222-3333333333-1001';
const NOW = Date.UTC(2026, 9, 20, 0, 0, 0);
const TOOLS = [
  { path: 'delivery-tools/initial-patch-entry.cjs', size: 11, sha256: hex('1') },
  { path: 'delivery-tools/initial-patch-core.cjs', size: 12, sha256: hex('2') },
  { path: 'project/desktop/employee-update-cache.cjs', size: 13, sha256: hex('3') },
  { path: 'project/desktop/employee-update-installer.cjs', size: 14, sha256: hex('4') }
];
const ASAR_OLD = { size: 12582052, sha256: '20b597c6405ecb92592eb11a7db5ad8a3fe3a0a9d7ac83e430f25afd9040e375' };
const ASAR_NEW = { size: 13421531, sha256: 'c37887dca5a4fe8dcda94b41de10e41634ad04d3ace799e7c4be4748cf9bf723' };
const OLD_PROGRAMS = [
  { version: '1.6.0', main: 'release-entry.cjs', asarSize: 1000, asarSha256: hex('a') },
  { version: '1.6.1', main: 'release-entry.cjs', asarSize: 1001, asarSha256: hex('b') },
  { version: '1.6.2', main: 'release-entry.cjs', asarSize: 1002, asarSha256: hex('c') }
];
const NEW_PROGRAM = { version: '1.7.0', main: 'release-entry.cjs', asarSize: ASAR_OLD.size, asarSha256: ASAR_OLD.sha256 };

function catalogFor(program, over) {
  const c = Object.assign({
    schemaVersion: 1, app: PROD, channel: 'stable', version: '1.7.0',
    sourceVersions: SOURCE_VERSIONS.slice(),
    platform: 'win32', arch: 'x64', sequence: 21,
    publishedAt: new Date(NOW - 3600000).toISOString(),
    expiresAt: new Date(NOW + 86400000).toISOString(),
    archive: { size: 4096, sha256: hex('d') },
    files: [{ path: 'resources/app.asar', size: program.asarSize, sha256: program.asarSha256 }]
  }, over || {});
  const raw = JSON.stringify(c);
  return { raw, bytes: Buffer.from(JSON.stringify({ catalog: raw, signature: sign(raw) })) };
}
function policyEnvelope(policy) {
  const raw = JSON.stringify(policy);
  return { raw, bytes: Buffer.from(JSON.stringify({ policy: raw, signature: sign(raw) })) };
}

function build(tree, catalog, policy) {
  const tools = policy.tools;
  const files = [
    { path: 'publisher-public.pem', size: PEM.length, sha256: sha(PEM) },
    { path: 'catalog-envelope.json', size: catalog.bytes.length, sha256: sha(catalog.bytes) },
    { path: 'source-policy-envelope.json', size: policy.bytes.length, sha256: sha(policy.bytes) },
    ...tools,
    { path: 'payload/resources/app.asar', size: tree.asarSize, sha256: tree.asarSha256 }
  ];
  return { files, metadata: { publicKeyPem: Buffer.from(PEM), catalogBytes: catalog.bytes, policyBytes: policy.bytes } };
}
function review(options) { return approval.review170PublicationApproval(options); }
function baseReviewArgs(program, tree, catalog, policy, installedEngine, extra) {
  const treeFiles = tree.files;
  return Object.assign({
    operation: 'initial',
    now: NOW,
    approvalId: crypto.randomUUID(),
    independent: { artifactSha256: hex('e'), publisherPublicKeySha256: PUB_SHA, verifiedPublisherName: 'Fixture Publisher' },
    archive: { sha256: hex('e'), files: treeFiles },
    treeFiles,
    metadata: tree.metadata,
    installation: {
      installationDir: INSTALL_DIR, executableName: EXE, osUser: SID, role: 'employee',
      engine: installedEngine,
      source: { name: PROD, version: program.version, main: program.main, size: program.asarSize, sha256: program.asarSha256 },
      activationMissing: false, transactionState: 'none',
      target: { name: PROD, version: '1.7.0', main: 'release-entry.cjs' }
    }
  }, extra || {});
}

// ---- G 组：a4 旧语义回归守卫（补丁前后都必须通过） ----
const catOld = catalogFor(OLD_PROGRAMS[1]);
const polV1 = policyEnvelope(Object.assign({
  schemaVersion: 1, purpose: core.REPEAT_PURPOSE, app: PROD, targetVersion: '1.7.0',
  catalogSha256: sha(Buffer.from(catOld.raw)), publisherPublicKeySha256: PUB_SHA,
  executableName: EXE, engine: { ...ENGINE }, sourcePrograms: OLD_PROGRAMS.slice(), tools: TOOLS
}));
const treeOld = build(OLD_PROGRAMS[1], catOld, polV1);
let v1Result = null;
try { v1Result = review(baseReviewArgs(OLD_PROGRAMS[1], treeOld, catOld, polV1, { ...ENGINE })); }
catch (e) { v1Result = { error: e }; }
t('G1 v1 旧版来源（1.6.1）同版合同仍通过', !!v1Result && !v1Result.error && v1Result.record.role === 'employee',
  v1Result.error ? v1Result.error.code + ' ' + v1Result.error.message : v1Result.record.purpose);
expectCode('G2 v1 策略在 initial 模式被拒', () => core.verifySourcePolicy({ policy: polV1.raw, signature: polV1.bytes ? JSON.parse(polV1.bytes).signature : '' }, publicKey, { upgradeMode: 'initial' }), 'BAD_SOURCE_POLICY');

// ---- F1：同版 1.7.0 合同（补丁前应失败，补丁后应通过） ----
function v2Programs(appEngine) {
  return OLD_PROGRAMS.map(p => ({ ...p, applicationEngine: { size: appEngine.size, sha256: appEngine.sha256 } }))
    .concat([{ ...NEW_PROGRAM, applicationEngine: { size: appEngine.size, sha256: appEngine.sha256 } }]);
}
const catSame = catalogFor(NEW_PROGRAM, { sourceVersions: ['1.6.0', '1.6.1', '1.6.2', '1.7.0'] });
const polV2 = policyEnvelope({
  schemaVersion: 2, purpose: core.REPEAT_PURPOSE, app: PROD, targetVersion: '1.7.0',
  catalogSha256: sha(Buffer.from(catSame.raw)), publisherPublicKeySha256: PUB_SHA,
  executableName: EXE, workerEngine: { ...ENGINE },
  sourcePrograms: [
    ...OLD_PROGRAMS.map(p => ({ ...p, applicationEngine: { size: ENGINE.size, sha256: ENGINE.sha256 } })),
    { ...NEW_PROGRAM, applicationEngine: { size: APP170.size, sha256: APP170.sha256 } }
  ],
  tools: TOOLS
});
const treeSame = build(NEW_PROGRAM, catSame, polV2);
let same = null;
try { same = review(baseReviewArgs(NEW_PROGRAM, treeSame, catSame, polV2, { ...APP170 })); }
catch (e) { same = { error: e }; }
t('F1 同版 1.7.0 重复补丁可获独立审定记录', !!same && !same.error && same.record.purpose === core.REPEAT_PURPOSE,
  same.error ? same.error.code + ' ' + same.error.message : same.mode);
t('F2 审定记录绑定 v2 来源与发布',
  !!same && !same.error && same.record.engine.sha256 === ENGINE.sha256 && same.publicationId === sha(Buffer.from(catSame.raw)),
  same.error ? same.error.code : '');

// F3 应用引擎不符：应为 ENGINE_MISMATCH（补丁前为 BAD_SOURCE_POLICY，故本项先失败）
expectCode('F3 同版来源但已装 EXE 不是 44.9.0 目标引擎必须 ENGINE_MISMATCH',
  () => review(baseReviewArgs(NEW_PROGRAM, treeSame, catSame, polV2, { ...ENGINE })),
  'ENGINE_MISMATCH');

// F4 v2 维护引擎必须是原受信 44.7.0 构建
const polV2BadWorker = policyEnvelope(Object.assign(JSON.parse(polV2.raw), { workerEngine: { size: APP170.size, sha256: APP170.sha256 } }));
const treeV2BadWorker = build(NEW_PROGRAM, catSame, polV2BadWorker);
expectCode('F4 v2 workerEngine 非 44.7.0 构建必须拒绝',
  () => review(baseReviewArgs(NEW_PROGRAM, treeV2BadWorker, catSame, polV2BadWorker, { ...APP170 })),
  ['BAD_SOURCE_POLICY']);

// F5 旧 v1 语义不得接受 1.7.0 来源
const polV1a170 = policyEnvelope(Object.assign(JSON.parse(polV1.raw), { sourcePrograms: OLD_PROGRAMS.concat([NEW_PROGRAM]) }));
const catV1a170 = catalogFor(NEW_PROGRAM, { sourceVersions: ['1.6.0', '1.6.1', '1.6.2', '1.7.0'] });
const treeV1a170 = build(NEW_PROGRAM, catV1a170, polV1a170);
expectCode('F5 v1 策略混入 1.7.0 来源必须拒绝',
  () => review(baseReviewArgs(NEW_PROGRAM, treeV1a170, catV1a170, polV1a170, { ...APP170 })),
  'BAD_SOURCE_POLICY');

// ---- F6/F7：core 策略校验层（补丁前应失败） ----
let parsedV2 = null;
try { parsedV2 = core.verifySourcePolicy({ policy: polV2.raw, signature: JSON.parse(polV2.bytes).signature }, publicKey, { upgradeMode: 'repeat' }); }
catch (e) { parsedV2 = { error: e }; }
t('F6 core 接受 v2 重复补丁策略并保留逐源应用引擎', !!parsedV2 && !parsedV2.error &&
  parsedV2.engine && parsedV2.engine.sha256 === ENGINE.sha256 &&
  parsedV2.applicationEngines instanceof Map && parsedV2.applicationEngines.get('1.7.0').sha256 === APP170.sha256,
  parsedV2.error ? parsedV2.error.code + ' ' + parsedV2.error.message : 'ok');
expectCode('F7 v2 策略禁止用于 initial 模式',
  () => core.verifySourcePolicy({ policy: polV2.raw, signature: JSON.parse(polV2.bytes).signature }, publicKey, { upgradeMode: 'initial' }),
  'BAD_SOURCE_POLICY');

// ---- G3/G4：既有闸门回归 ----
expectCode('G3 旧版目录降级仍被拒', () => require(path.join(ROOT, 'worker-draft/project/desktop/employee-update-cache.cjs'))
  .verifySignedCatalog(JSON.parse(catalogFor(NEW_PROGRAM, { version: '1.6.2' }).bytes),
    require(path.join(ROOT, 'worker-draft/project/desktop/employee-update-cache.cjs')).createTrustedUpdatePolicy({
      trustedPublicKey: publicKey, currentVersion: '1.7.0', allowedFiles: ['resources/app.asar'], platform: 'win32', arch: 'x64', now: () => NOW })), 'DOWNGRADE_REJECTED');
const cacheText = fs.readFileSync(path.join(ROOT, 'worker-draft/project/desktop/employee-update.cjs'), 'utf8');
t('G4 employee-update.cjs 鉴权语义未被本补丁触及',
  /actor\.active !== true \|\| actor\.authenticated !== true/.test(cacheText) && /catalog\.version === currentVersion|version === currentVersion/.test(cacheText), 'authorize+latest');

console.log('\n合计 ' + (pass + fail) + ' 项：PASS ' + pass + '，FAIL ' + fail + (fail ? ' → ' + FAILED.join(',') : ''));
process.exit(fail === 0 ? 0 : 1);
// delivery-tools/Employee-Update-Launch-170.cjs
// 由已装 44.9.0 应用 EXE 以 ELECTRON_RUN_AS_NODE=1 运行；校验包外审批、包树、已装 EXE 后调用 runInitialPatch。
// 不接受 role/path/key/engine 参数；全部由包外审批与签名 policy 推导。
// 用法：<已装EXE> Employee-Update-Launch-170.cjs --artifact-dir <包根> [--dry-run]
'use strict';
const fsp = process.versions.electron ? require('original-fs').promises : require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const entry = require('./initial-patch-entry.cjs');
const core = require('./initial-patch-core.cjs');
const baselineModule = require('./initial-patch-baseline-170.cjs');
const u = require('../project/desktop/employee-update-cache.cjs');

const APP_ENGINE = Object.freeze({ size: 247184896, sha256: 'c99a56d653220a8bf209b0b9ae2424ec1f1580946d1bf3395a968eb211a4f1b5' });
const WORKER_ENGINE = Object.freeze({ size: 246302720, sha256: 'db3ad2066a55546f9b6737da3c7f011370e4856fb36888055b544d45653e4f40' });
const EXE = '鑫金源珠宝报价.exe';
const APPROVAL_FIELDS = ['schemaVersion', 'purpose', 'approvalId', 'artifactSha256', 'treeSha256', 'publisherPublicKeySha256', 'sourcePolicySha256', 'verifiedPublisherName', 'role', 'installationDir', 'osUser', 'engine', 'approvedAt', 'expiresAt'];
const SHA = /^[a-f0-9]{64}$/;

function fail(code, message) { const e = new Error(message); e.code = code; throw e; }
const exact = (v, keys) => !!v && typeof v === 'object' && !Array.isArray(v) &&
  Object.keys(v).length === keys.length && keys.every(k => Object.prototype.hasOwnProperty.call(v, k));
const samePath = (a, b) => typeof a === 'string' && typeof b === 'string' && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : '';
}

(async function main() {
  if (process.platform !== 'win32' || process.arch !== 'x64') fail('UNTRUSTED_LAUNCH', '仅允许 Windows x64');
  if (process.versions.electron !== '44.9.0') fail('UNTRUSTED_LAUNCH', '目标应用引擎必须为 44.9.0');
  if (process.env.ELECTRON_RUN_AS_NODE !== '1') fail('UNTRUSTED_LAUNCH', '必须由已装应用的 RUN_AS_NODE 运行');
  if (process.env.NODE_OPTIONS || process.env.NODE_PATH) fail('UNTRUSTED_LAUNCH', '禁止 NODE_OPTIONS/NODE_PATH');
  const dryRun = process.argv.includes('--dry-run');
  const artifactDir = u.safeAbsolute(arg('--artifact-dir') || path.dirname(__dirname));
  await u.assertPath(fsp, artifactDir, { directory: true });

  const authority = await entry.resolveRepeatNativeAuthority({ artifactDir });
  const approvalFile = path.join(authority.approvalRoot, 'initial-upgrade-approval.json');
  const recordBytes = await u.readSmall(fsp, approvalFile, 8192);
  let record;
  try { record = JSON.parse(recordBytes.toString('utf8')); } catch { fail('INDEPENDENT_APPROVAL_REQUIRED', '包外审批不是有效 JSON'); }
  if (!exact(record, APPROVAL_FIELDS)) fail('INDEPENDENT_APPROVAL_REQUIRED', '包外审批字段不符');
  if (record.role !== 'employee') fail('INDEPENDENT_APPROVAL_REQUIRED', '本启动器只承接员工角色补丁');
  if (record.osUser !== authority.osUser) fail('INDEPENDENT_APPROVAL_REQUIRED', '包外审批 Windows SID 不符');
  if (record.publisherPublicKeySha256 !== '6e8b9cadb59aeb53f30d41f4471f70f644f0dfc7376ffb9d8a4c62defb98458c') fail('INDEPENDENT_APPROVAL_REQUIRED', '发行者不符');
  if (JSON.stringify(record.engine) !== JSON.stringify({ size: WORKER_ENGINE.size, sha256: WORKER_ENGINE.sha256, electronRunAsNode: true, nodeSqliteBackup: true })) fail('INDEPENDENT_APPROVAL_REQUIRED', '包外审批维护引擎必须是 44.7.0 构建');

  const tree = await core.inspectArtifactTree({ artifactDir, fileSystem: fsp });
  if (tree.sha256 !== record.treeSha256) fail('ARTIFACT_CHANGED', '包树与包外审批不符');

  const policyBytes = await u.readSmall(fsp, path.join(artifactDir, 'source-policy-envelope.json'), 2097152);
  let policyWrapper;
  try { policyWrapper = JSON.parse(policyBytes.toString('utf8')); } catch { fail('BAD_SOURCE_POLICY', '源策略不是有效 JSON'); }
  if (!exact(policyWrapper, ['policy', 'signature']) || typeof policyWrapper.policy !== 'string' || typeof policyWrapper.signature !== 'string') fail('BAD_SOURCE_POLICY', '源策略包装格式不符');
  if (crypto.createHash('sha256').update(Buffer.from(policyWrapper.policy)).digest('hex') !== record.sourcePolicySha256) fail('BAD_SOURCE_POLICY', '源策略摘要与包外审批不符');
  let policy;
  try { policy = JSON.parse(policyWrapper.policy); } catch { fail('BAD_SOURCE_POLICY', '源策略内容不符'); }
  if (policy.schemaVersion !== 2 || policy.purpose !== core.REPEAT_PURPOSE || policy.targetVersion !== '1.7.0') fail('BAD_SOURCE_POLICY', '同版补丁必须使用 V2 重复补丁策略');
  if (!policy.workerEngine || policy.workerEngine.size !== WORKER_ENGINE.size || policy.workerEngine.sha256 !== WORKER_ENGINE.sha256) fail('BAD_SOURCE_POLICY', 'V2 维护引擎必须为 44.7.0 构建');
  const row = Array.isArray(policy.sourcePrograms) ? policy.sourcePrograms.find(x => x.version === '1.7.0') : null;
  if (!row || !row.applicationEngine || row.applicationEngine.size !== APP_ENGINE.size || row.applicationEngine.sha256 !== APP_ENGINE.sha256) fail('BAD_SOURCE_POLICY', 'V2 必须精确声明 1.7.0 应用引擎 44.9.0');

  const install = u.safeAbsolute(record.installationDir);
  await u.assertPath(fsp, install, { directory: true });
  const exe = path.join(install, EXE);
  if (!samePath(process.execPath, exe)) fail('UNTRUSTED_LAUNCH', '当前运行时不是已装员工程序 EXE');
  const info = await core.fileHash(fsp, exe, install);
  if (info.size !== APP_ENGINE.size || info.sha256 !== APP_ENGINE.sha256) fail('SOURCE_ENGINE_MISMATCH', '已装应用 EXE 不是 44.9.0 目标构建');

  const baseline = await baselineModule.ensureBaseline({
    installationDir: install, role: 'employee', programVersion: '1.7.0', engineVersion: '44.9.0',
    publisherPublicKeySha256: record.publisherPublicKeySha256,
    publisherPublicKey: crypto.createPublicKey(await u.readSmall(fsp, path.join(artifactDir, 'publisher-public.pem'), 4096)),
    fileSystem: fsp
  });

  const summary = {
    ok: true, dryRun, publicationId: authority.publicationId,
    installationDir: install, treeSha256: tree.sha256,
    installedEngine: info, workerEngine: WORKER_ENGINE, applicationEngine: APP_ENGINE,
    baselineKind: baseline.kind, baselineFile: baseline.baselineFile || null
  };
  if (dryRun) { process.stdout.write(JSON.stringify(summary) + '\n'); return; }

  const environment = Object.assign({}, process.env, {
    ELECTRON_RUN_AS_NODE: '1', XJY_INITIAL_APPROVAL_LAUNCH: '1', XJY_INITIAL_ROLE: 'employee',
    NODE_OPTIONS: undefined, NODE_PATH: undefined
  });
  delete environment.NODE_OPTIONS;
  delete environment.NODE_PATH;
  const result = await entry.runInitialPatch({
    artifactDir, approvalRoot: authority.approvalRoot, osUser: authority.osUser,
    roleConfirmed: 'employee', mode: 'install', upgradeMode: 'repeat',
    publicationId: authority.publicationId, currentExecutable: process.execPath, environment
  });
  process.stdout.write(JSON.stringify(Object.assign(summary, { result })) + '\n');
})().catch(error => {
  process.stderr.write('员工一键升级未完成：' + (error.code || 'FAILED') + ' ' + error.message + '\n');
  process.exitCode = 1;
});
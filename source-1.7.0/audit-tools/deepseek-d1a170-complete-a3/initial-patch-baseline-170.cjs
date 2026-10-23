// delivery-tools/initial-patch-baseline-170.cjs
// fresh engine-state 基线只读验证 + 一次性基线标记。不创建/改写 legacy canonical。
// 未知、缺件、HMAC 失败、签名失败、物理身份不符一律 RECOVERY_REQUIRED 失败关闭。
'use strict';
const fsp = process.versions.electron ? require('original-fs').promises : require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const u = require('../project/desktop/employee-update-cache.cjs');
const startup = require('../project/desktop/engine-startup-gate.cjs');

const KIND = 'fresh-engine-state-v1';
const JOURNAL_PURPOSE = 'xjy-engine-fresh170';
const STARTUP_PURPOSE = 'xjy-engine-startup-v1';
const DOMAIN = 'xjy-engine-startup-v1\u0000';
const MARKER = 'xjy-install-activation.json';
const STATE_FILE = '.fresh-baseline-v1.json';
const SHA = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const FILES = ['engine-startup-status.json', 'journal-key.bin', 'journal.json', 'target-catalog-envelope.json'].sort();

function fail(code, message) { const e = new Error(message); e.code = code; throw e; }
const exact = (v, keys) => !!v && typeof v === 'object' && !Array.isArray(v) &&
  Object.keys(v).length === keys.length && keys.every(k => Object.prototype.hasOwnProperty.call(v, k));
const samePath = (a, b) => typeof a === 'string' && typeof b === 'string' && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const digest = b => crypto.createHash('sha256').update(b).digest('hex');
const physicalIdentity = s => s.dev.toString(16).padStart(8, '0') + ':' + s.ino.toString(16).padStart(16, '0');
const stateIdentity = s => [s.dev, s.ino, s.birthtimeNs ?? s.birthtimeMs].map(String).join(':');
const namespace = () => (os.hostname() + '\\' + os.userInfo().username).toLowerCase();
const stateDirectory = installationDir => startup.stateDirectory(installationDir);

async function readOrFail(io, file, max, label) {
  try { return await u.readSmall(io, file, max); }
  catch (e) { if (e.code === 'ENOENT') fail('RECOVERY_REQUIRED', '缺少 ' + label); throw e; }
}

async function inspectFreshEngineState(options) {
  const io = options.fileSystem || fsp;
  const install = u.safeAbsolute(options.installationDir);
  const role = options.role;
  const programVersion = options.programVersion || '1.7.0';
  const engineVersion = options.engineVersion || '44.9.0';
  const publisherPublicKeySha256 = options.publisherPublicKeySha256;
  if (!['host', 'employee'].includes(role)) fail('RECOVERY_REQUIRED', 'fresh 基线角色必须明确');
  if (!SHA.test(publisherPublicKeySha256 || '')) fail('RECOVERY_REQUIRED', 'fresh 基线缺少已签发行公钥摘要');

  let installStat;
  try { installStat = await u.assertPath(io, install, { directory: true }); }
  catch (e) { fail('RECOVERY_REQUIRED', '安装目录不是普通目录：' + e.message); }
  const stateDir = stateDirectory(install);
  let stateStat;
  try { stateStat = await u.assertPath(io, stateDir, { directory: true }); }
  catch (e) { fail('RECOVERY_REQUIRED', 'fresh 状态目录缺失或不可信：' + e.message); }

  const names = (await io.readdir(stateDir)).sort();
  if (JSON.stringify(names) !== JSON.stringify(FILES)) fail('RECOVERY_REQUIRED', 'fresh 状态目录文件集合不符：' + names.join(','));

  const key = await readOrFail(io, path.join(stateDir, 'journal-key.bin'), 32, 'journal-key.bin');
  if (key.length !== 32) fail('RECOVERY_REQUIRED', 'fresh 认证密钥长度不符');

  const journalBytes = await readOrFail(io, path.join(stateDir, 'journal.json'), 16384, 'journal.json');
  let journalWrapper;
  try { journalWrapper = JSON.parse(journalBytes.toString('utf8')); }
  catch { fail('RECOVERY_REQUIRED', 'fresh journal 不是有效 JSON'); }
  if (!exact(journalWrapper, ['payload', 'mac']) || typeof journalWrapper.payload !== 'string' || !SHA.test(journalWrapper.mac || ''))
    fail('RECOVERY_REQUIRED', 'fresh journal 包装格式不符');
  const journalMac = crypto.createHmac('sha256', key).update(journalWrapper.payload).digest();
  if (!crypto.timingSafeEqual(journalMac, Buffer.from(journalWrapper.mac, 'hex')))
    fail('RECOVERY_REQUIRED', 'fresh journal 认证失败');
  let journal;
  try { journal = JSON.parse(journalWrapper.payload); } catch { fail('RECOVERY_REQUIRED', 'fresh journal 内容不符'); }
  const JOURNAL_KEYS = ['version', 'purpose', 'transactionId', 'phase', 'rollbackForbidden', 'targetVersion',
    'targetEngineVersion', 'role', 'installationDir', 'installationIdentity', 'stateIdentity',
    'catalogSha256', 'publisherPublicKeySha256', 'osUserNamespace'];
  if (!exact(journal, JOURNAL_KEYS)) fail('RECOVERY_REQUIRED', 'fresh journal 字段不符');
  if (journal.version !== 1 || journal.purpose !== JOURNAL_PURPOSE) fail('RECOVERY_REQUIRED', 'fresh journal 用途不符');
  if (journal.phase !== 'committed' || journal.rollbackForbidden !== true) fail('RECOVERY_REQUIRED', 'fresh journal 未提交');
  if (journal.targetVersion !== programVersion || journal.targetEngineVersion !== engineVersion) fail('RECOVERY_REQUIRED', 'fresh journal 目标版本不符');
  if (journal.role !== role) fail('RECOVERY_REQUIRED', 'fresh journal 角色不符');
  if (!samePath(journal.installationDir, install)) fail('RECOVERY_REQUIRED', 'fresh journal 安装目录不符');
  if (journal.installationIdentity !== physicalIdentity(installStat)) fail('RECOVERY_REQUIRED', 'fresh journal 安装目录物理身份不符');
  if (journal.stateIdentity !== stateIdentity(stateStat)) fail('RECOVERY_REQUIRED', 'fresh journal 状态目录物理身份不符');
  if (journal.publisherPublicKeySha256 !== publisherPublicKeySha256) fail('RECOVERY_REQUIRED', 'fresh journal 发行公钥摘要不符');
  if (journal.osUserNamespace !== namespace()) fail('RECOVERY_REQUIRED', 'fresh journal 用户命名空间不符');
  if (!UUID.test(journal.transactionId || '')) fail('RECOVERY_REQUIRED', 'fresh journal 事务号非法');

  const catalogBytes = await readOrFail(io, path.join(stateDir, 'target-catalog-envelope.json'), 2097152, 'target-catalog-envelope.json');
  let catalogWrapper;
  try { catalogWrapper = JSON.parse(catalogBytes.toString('utf8')); }
  catch { fail('RECOVERY_REQUIRED', 'fresh 目标目录不是有效 JSON'); }
  if (!exact(catalogWrapper, ['catalog', 'signature']) || typeof catalogWrapper.catalog !== 'string' || typeof catalogWrapper.signature !== 'string')
    fail('RECOVERY_REQUIRED', 'fresh 目标目录包装格式不符');
  if (digest(Buffer.from(catalogWrapper.catalog)) !== journal.catalogSha256) fail('RECOVERY_REQUIRED', 'fresh 目标目录摘要不符');
  let catalog;
  try { catalog = JSON.parse(catalogWrapper.catalog); } catch { fail('RECOVERY_REQUIRED', 'fresh 目标目录内容不符'); }
  if (catalog.version !== programVersion) fail('RECOVERY_REQUIRED', 'fresh 目标目录版本不符');
  if (!Array.isArray(catalog.sourceVersions) || !catalog.sourceVersions.includes(programVersion))
    fail('RECOVERY_REQUIRED', 'fresh 目标目录未声明当前来源');
  let publicKey;
  try { publicKey = options.publisherPublicKey && options.publisherPublicKey.type === 'public' ? options.publisherPublicKey : crypto.createPublicKey(options.publisherPublicKey); }
  catch { fail('RECOVERY_REQUIRED', 'fresh 发行公钥无效'); }
  if (publicKey.asymmetricKeyType !== 'ed25519' || digest(publicKey.export({ type: 'spki', format: 'der' })) !== publisherPublicKeySha256)
    fail('RECOVERY_REQUIRED', 'fresh 发行公钥摘要不符');
  if (!crypto.verify(null, Buffer.from(catalogWrapper.catalog), publicKey, Buffer.from(catalogWrapper.signature, 'base64')))
    fail('RECOVERY_REQUIRED', 'fresh 目标目录签名不符');

  const statusBytes = await readOrFail(io, path.join(stateDir, 'engine-startup-status.json'), 16384, 'engine-startup-status.json');
  let statusWrapper;
  try { statusWrapper = JSON.parse(statusBytes.toString('utf8')); }
  catch { fail('RECOVERY_REQUIRED', 'fresh 启动收据不是有效 JSON'); }
  if (!exact(statusWrapper, ['payload', 'mac']) || typeof statusWrapper.payload !== 'string' || !SHA.test(statusWrapper.mac || ''))
    fail('RECOVERY_REQUIRED', 'fresh 启动收据包装格式不符');
  const statusMac = crypto.createHmac('sha256', key).update(DOMAIN).update(statusWrapper.payload).digest();
  if (!crypto.timingSafeEqual(statusMac, Buffer.from(statusWrapper.mac, 'hex'))) fail('RECOVERY_REQUIRED', 'fresh 启动收据认证失败');
  let status;
  try { status = JSON.parse(statusWrapper.payload); } catch { fail('RECOVERY_REQUIRED', 'fresh 启动收据内容不符'); }
  const STATUS_KEYS = ['version', 'purpose', 'transactionId', 'phase', 'rollbackForbidden', 'installationDir',
    'installationIdentity', 'stateDir', 'stateIdentity', 'role', 'programVersion', 'engineVersion',
    'catalogSha256', 'publisherPublicKeySha256', 'osUserNamespace', 'mode', 'journalSha256', 'businessReleased'];
  if (!exact(status, STATUS_KEYS)) fail('RECOVERY_REQUIRED', 'fresh 启动收据字段不符');
  if (status.version !== 2 || status.purpose !== STARTUP_PURPOSE) fail('RECOVERY_REQUIRED', 'fresh 启动收据版本或用途不符');
  if (status.transactionId !== journal.transactionId) fail('RECOVERY_REQUIRED', 'fresh 启动收据事务号不符');
  if (status.phase !== 'committed' || status.rollbackForbidden !== true) fail('RECOVERY_REQUIRED', 'fresh 启动收据未提交');
  if (!samePath(status.installationDir, install) || !samePath(status.stateDir, stateDir)) fail('RECOVERY_REQUIRED', 'fresh 启动收据目录不符');
  if (status.installationIdentity !== journal.installationIdentity || status.stateIdentity !== journal.stateIdentity) fail('RECOVERY_REQUIRED', 'fresh 启动收据物理身份不符');
  if (status.role !== role || status.programVersion !== programVersion || status.engineVersion !== engineVersion) fail('RECOVERY_REQUIRED', 'fresh 启动收据角色或版本不符');
  if (status.catalogSha256 !== journal.catalogSha256 || status.publisherPublicKeySha256 !== publisherPublicKeySha256) fail('RECOVERY_REQUIRED', 'fresh 启动收据发布绑定不符');
  if (status.osUserNamespace !== namespace() || status.mode !== 'fresh') fail('RECOVERY_REQUIRED', 'fresh 启动收据用户或模式不符');
  if (status.journalSha256 !== digest(journalBytes)) fail('RECOVERY_REQUIRED', 'fresh 启动收据与 journal 不一致');
  if (status.businessReleased !== true) fail('RECOVERY_REQUIRED', 'fresh 收据未放行业务，不能作为已提交基线');

  const markerBytes = await readOrFail(io, path.join(install, MARKER), 4096, MARKER);
  let activation;
  try { activation = JSON.parse(markerBytes.toString('utf8')); } catch { fail('RECOVERY_REQUIRED', 'fresh activation 不是有效 JSON'); }
  if (!exact(activation, ['version', 'product', 'programVersion', 'role', 'installationDir'])) fail('RECOVERY_REQUIRED', 'fresh activation 字段不符');
  if (activation.version !== 1 || activation.product !== 'xjy-jewelry-offline' ||
      activation.programVersion !== programVersion || activation.role !== role ||
      !samePath(activation.installationDir, install)) fail('RECOVERY_REQUIRED', 'fresh activation 与安装不符');

  return Object.freeze({
    kind: KIND,
    installationDir: install,
    installationIdentity: journal.installationIdentity,
    stateDir,
    stateIdentity: journal.stateIdentity,
    transactionId: journal.transactionId,
    role,
    programVersion,
    engineVersion,
    catalogSha256: journal.catalogSha256,
    publisherPublicKeySha256,
    journalSha256: digest(journalBytes),
    statusSha256: digest(statusBytes),
    markerSha256: digest(markerBytes)
  });
}

async function ensureBaseline(options) {
  const io = options.fileSystem || fsp;
  const install = u.safeAbsolute(options.installationDir);
  const stateRoot = path.join(install, '.xjy-initial-upgrade');
  let hasLegacy = false;
  try { await u.assertPath(io, path.join(stateRoot, 'journal.json'), { root: install }); hasLegacy = true; }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (hasLegacy) return Object.freeze({ kind: 'legacy-canonical' });

  const descriptor = await inspectFreshEngineState(options);
  const baselineDir = stateRoot;
  await u.assertPath(io, install, { directory: true });
  try { await io.mkdir(baselineDir, { mode: 0o700 }); }
  catch (e) { if (e.code !== 'EEXIST') throw e; }
  await u.assertPath(io, baselineDir, { directory: true, root: install });
  const baselineFile = path.join(baselineDir, STATE_FILE);
  const body = Buffer.from(JSON.stringify(Object.assign({ schemaVersion: 1 }, descriptor)) + '\n', 'utf8');
  let existing = null;
  try { existing = await u.readSmall(io, baselineFile, 65536); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (existing) {
    if (!existing.equals(body)) fail('RECOVERY_REQUIRED', 'fresh 基线记录与当前状态不符，不覆盖');
  } else {
    await u.atomicWrite(io, baselineFile, body, install);
    const written = await u.readSmall(io, baselineFile, 65536);
    if (!written.equals(body)) fail('RECOVERY_REQUIRED', 'fresh 基线记录读回不符');
  }
  return Object.freeze({ kind: KIND, descriptor, baselineFile, baselineSha256: digest(body) });
}

module.exports = { inspectFreshEngineState, ensureBaseline, stateDirectory, KIND, JOURNAL_PURPOSE, STARTUP_PURPOSE, DOMAIN, STATE_FILE };
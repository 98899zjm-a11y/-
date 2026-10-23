'use strict';
// Independent170 full-tree transaction. No business imports or termination.
// Derived from frozen19db; authenticated commit and readback precede all target starts.
const native = process.versions.electron ? require('original-fs') : require('node:fs'), fs = native.promises, path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..'), BASE = path.join(ROOT, 'runtime/engine-tree-tests');
const u = require('../project/desktop/employee-update-cache.cjs');
const core = require('./initial-patch-core.cjs');
const { programPath } = require('../project/desktop/employee-update-installer.cjs');
const PURPOSE = 'xjy-engine-tree170', MARKER = 'xjy-install-activation.json', SHA = /^[a-f0-9]{64}$/;
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
const requireValue = (value, code, message) => { if (!value) u.fail(code, message); };
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const inside = (root, target) => { const rel = path.relative(root, target); return rel === '' || rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel); };
const rows = files => files.map(({ path: name, size, sha256 }) => ({ path: name, size, sha256 })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

const startup = require('../project/desktop/engine-startup-gate.cjs');
const nativeCapabilities = new WeakMap();
const deferredCapabilities = new WeakSet();
const guestBridgeContexts = new WeakMap();

// BEGIN APPROVED_EMPTY_SOURCE_DIRECTORIES
// Exact empty directory metadata only. No unsigned files or arbitrary subtree.
const approvedEmptyDirectoryPaths = Object.freeze(['resources/NVIDIA Corporation','resources/NVIDIA Corporation/umdlogs']);
const approvedEmptyDirectory = name => approvedEmptyDirectoryPaths.includes(name);
async function captureApprovedEmptyDirectories(io, root) {
  const parent = path.join(root,...approvedEmptyDirectoryPaths[0].split('/'));
  let parentStat;try { parentStat = await u.assertPath(io,parent,{directory:true,root}); }
  catch(error) { if(error.code==='ENOENT')return [];throw error; }
  const names = await io.readdir(parent);
  requireValue(names.length<=1&&names.every(name=>name==='umdlogs'),'UNEXPECTED_SOURCE_DIRECTORY','已知空目录中出现未经允许的内容');
  const result=[{path:approvedEmptyDirectoryPaths[0],identity:u.statIdentity(parentStat)}];
  if(names.length){const leaf=path.join(parent,'umdlogs'),stat=await u.assertPath(io,leaf,{directory:true,root});requireValue((await io.readdir(leaf)).length===0,'UNEXPECTED_SOURCE_DIRECTORY','已知日志目录必须为空');result.push({path:approvedEmptyDirectoryPaths[1],identity:u.statIdentity(stat)});}
  return result;
}
// END APPROVED_EMPTY_SOURCE_DIRECTORIES

// BEGIN EMPTY_DIRECTORY_ALLOWLIST_170
// 安装/备份阶段会在可变历史前缀下新建空目录（例如
// .xjy-patches/<hash>/<uuid>/data-backup/files/工作室数据/images），
// 它们不是任何 targetFiles 记录的祖先，旧逻辑会把提交后的复查判成
// TREE_CHANGED 完整树含未声明空目录。这里只放行"空目录 + 可写历史前缀"，
// 以及已知 GPU 日志空链；非空前缀目录、前缀之外的未知目录仍然拒绝。
const emptyMutableDirectoryPrefixes = Object.freeze(['.xjy-initial-upgrade/', '.xjy-patches/', '员工本地设置/', '.xjy-employee-updates/']);
const emptyDirectoryAlwaysAllowed = name => approvedEmptyDirectory(name);
const emptyMutableDirectoryAllowed = name => emptyMutableDirectoryPrefixes.some(prefix => name.startsWith(prefix));
// END EMPTY_DIRECTORY_ALLOWLIST_170

// BEGIN KNOWN_EXTRA_SOURCE_FILES_170
// 真实 1.6.2 安装树里有 3 个文件不在已签 catalog 内（Electron 自带的
// resources/default_app.asar 与 resources/elevate.exe，以及安装器写入根目录的
// "Uninstall 鑫金源珠宝报价.exe"）。它们既非可变资料也非用户数据，旧逻辑直接报
// UNEXPECTED_SOURCE_FILE 拒绝整个升级。这里只放行这三个确切路径（不做前缀/通配），
// 它们只保留在备份树里，不复制进目标树。
const knownExtraSourceFiles = Object.freeze([
  'resources/default_app.asar',
  'resources/elevate.exe',
  'Uninstall 鑫金源珠宝报价.exe'
]);
const knownExtraSourceFile = name => knownExtraSourceFiles.includes(name);
// END KNOWN_EXTRA_SOURCE_FILES_170

function enginePath(name, executableName) {
  if (!u.safeRelative(name) || name.toLowerCase() === MARKER || /\.(?:db(?:-wal|-shm)?|sqlite3?(?:-wal|-shm)?|pem|key|pfx|docx?|xlsx?|wps|et)$/i.test(name)) return false;
  if (name.startsWith('resources/')) return programPath(name);
  if (/^locales\/[A-Za-z0-9_-]+\.pak$/.test(name)) return true;
  if (name.includes('/') || /^(?:data|profiles?|configs?|configuration|accounts?|customers?|credentials|private|backup|cache|logs?)(?:\.|$)/i.test(name)) return false;
  return name === executableName || name === 'version' || name === 'LICENSE' || /\.(?:dll|pak|bin|dat|json|txt|html)$/i.test(name);
}

// BEGIN KNOWN14_19_SLOT_SOURCE_PURE
// Only consumes a sourceAuthority already authenticated by shared location or
// authenticated recovery. This selector never creates source identity/grants.
//
// 2026-10-23（sequence 28）来源判定修订。旧实现只认两个写死的历史目录摘要：default14
// a067dd03… 与 default/active19 c049bc4d…。真实员工安装只要经过任何一次已签完整发布装成
// （本机 round40 就是装成 sequence 22，回执摘要 c4608f0a…），两个写死摘要都匹配不上，
// 于是每次「交给受信助手」都必然 BAD_SLOT_SOURCE，升级永远走不到复制那一步。
// 现在判据是「来源与包自洽即接受」：
//   1. 两个历史摘要照旧接受（摘要、信封摘要、序号全部写死，历史行为不变）；
//   2. 否则只接受本次安装目录自带的已签目标目录回执
//      <state>/target-catalog-envelope.json，且必须同时满足：同一发行公钥验签通过、
//      1079 行、version 1.7.0、每行都是合法 enginePath、序号严格旧于本包目标、
//      可执行文件与本包目标逐字节相同、除已审 ASAR 修订 resources/app.asar 外
//      每一行都与本包目标逐字节相同、回执摘要等于 location 认证声称的摘要；
//   3. 若真实来源的摘要恰好等于本包目标目录摘要，它已经不是"来源"而是"已装成本包目标"，
//      由调用方 alreadyInstalled 分支直接放行，不在这里当成可复制的旧来源。
// 这不是放宽到"任意来源"：验签、行数、行范围、可执行文件、序号五重对不上就仍然拒绝；
// 也不创建任何来源身份或授权，只承认 location / recovery 已经认证过的真实位置。
function verifyEmployeeSlotSource170(envelope,{sha256,envelopeSha256,targetCatalog,publicKey,executableName,now=Date.now}){
  requireValue(exact(envelope,['catalog','signature'])&&typeof envelope.catalog==='string','BAD_SLOT_SOURCE','来源必须保留原发行签名字段');
  const raw=JSON.parse(envelope.catalog);requireValue(Array.isArray(raw.files)&&raw.files.length===1079,'BAD_SLOT_SOURCE','来源必须完整1079行');
  const catalog=u.verifySignedCatalog(envelope,u.createTrustedUpdatePolicy({trustedPublicKey:publicKey,currentVersion:'1.7.0',allowedFiles:raw.files.map(f=>f.path),now}),{allowExpired:true});
  requireValue(u.digest(Buffer.from(envelope.catalog))===sha256&&(envelopeSha256===undefined||u.digest(Buffer.from(JSON.stringify({catalog:envelope.catalog,signature:envelope.signature})))===envelopeSha256)&&catalog.version==='1.7.0'&&catalog.files.every(f=>enginePath(f.path,executableName)),'BAD_SLOT_SOURCE','来源目录摘要、版本或行范围不符');
  requireValue(Number.isSafeInteger(catalog.sequence)&&targetCatalog.sequence>catalog.sequence,'BAD_SLOT_SOURCE','来源序号必须严格旧于本包目标');
  requireValue(same(rows(catalog.files.filter(f=>f.path!=='resources/app.asar')),rows(targetCatalog.files.filter(f=>f.path!=='resources/app.asar'))),'SLOT_SCOPE_CHANGED','来源只允许已审ASAR修订，其他完整字节必须与本包目标相同');
  const sourceExe=catalog.files.find(f=>f.path===executableName),targetExe=targetCatalog.files.find(f=>f.path===executableName);requireValue(sourceExe?.size===247184896&&sourceExe.sha256===targetExe?.sha256,'BAD_SLOT_SOURCE','来源44.9完整引擎不符');
  return u.freeze({envelope:{catalog:envelope.catalog,signature:envelope.signature},catalog,catalogSha256:sha256});
}
function verifyKnownEmployeeSlotSources170({primaryEnvelope,defaultEnvelope,publicKey,targetCatalog,executableName,now=Date.now}){
  requireValue(targetCatalog?.version==='1.7.0'&&Number.isSafeInteger(targetCatalog.sequence)&&Array.isArray(targetCatalog.files)&&targetCatalog.files.length===1079,'BAD_SLOT_SOURCE','双来源必须指向已核完整170目标');
  const primary=verifyEmployeeSlotSource170(primaryEnvelope,{sha256:'c049bc4d886a1aefd4100e0e397fb12a94293838609712ce6404d6227c294535',envelopeSha256:'53f6fa7017185acd9c25b7139b558db0daf923e0d72bece4e6a34d1e7820bc03',targetCatalog,publicKey,executableName,now}),
    defaultSource=verifyEmployeeSlotSource170(defaultEnvelope,{sha256:'a067dd03b72f7139b87632b59df5609336c3d75b980d38dba8e2cc9367444669',envelopeSha256:'f26f880854d70a535d99f485fbfad990e27c04d0ef76354223d206afc052430f',targetCatalog,publicKey,executableName,now});
  return u.freeze({primary,default:defaultSource});
}
// 本次安装目录自带的已签目标目录回执。读不到、验不过、行范围不符时一律返回 null 而不是抛错，
// 让调用方按"不是已核来源"统一拒绝；只有仍被同一发行公钥签中且与包自洽时才成为可复制来源。
async function readEmployeeSlotReceipt170({install,publicKey,targetCatalog,executableName,now=Date.now}){
  let envelope;try{envelope=JSON.parse(await u.readSmall(fs,path.join(startup.stateDirectory(install),startup.CATALOG),2097152));}catch(error){if(error.code==='ENOENT'||error instanceof SyntaxError)return null;throw error;}
  const sha256=typeof envelope?.catalog==='string'?u.digest(Buffer.from(envelope.catalog)):null;
  try{return verifyEmployeeSlotSource170(envelope,{sha256,targetCatalog,publicKey,executableName,now});}catch(error){if(error&&typeof error.code==='string'&&['BAD_SLOT_SOURCE','SLOT_SCOPE_CHANGED','BAD_MANIFEST','BAD_SIGNATURE','EXPIRED_CATALOG','DOWNGRADE_REJECTED','SOURCE_UNSUPPORTED'].includes(error.code))return null;throw error;}
}
function selectEmployeeSlotSource170(sources,sourceAuthority,receipt=null){
  const kind=sourceAuthority?.kind,sha256=sourceAuthority?.catalogSha256;
  if((kind==='default'||kind==='active-slot')&&sha256==='c049bc4d886a1aefd4100e0e397fb12a94293838609712ce6404d6227c294535'&&sources.primary?.catalogSha256===sha256)return sources.primary;
  if(kind==='default'&&sha256==='a067dd03b72f7139b87632b59df5609336c3d75b980d38dba8e2cc9367444669'&&sources.default?.catalogSha256===sha256)return sources.default;
  if((kind==='default'||kind==='active-slot')&&sha256&&receipt&&receipt.catalogSha256===sha256)return receipt;
  requireValue(false,'BAD_SLOT_SOURCE','当前真实来源既不是已核default14/active19，也不是与本次安装包自洽的已签来源');
}
// END KNOWN14_19_SLOT_SOURCE_PURE

function createEngineTreeRuntime170(options, nativeCapability) {
  const nativeAuthority = nativeCapabilities.has(nativeCapability);
  const nativeContext = nativeCapabilities.get(nativeCapability)||guestBridgeContexts.get(nativeCapability);
  const bridgeSource = nativeContext?.bridgeSource;
  const deferred = deferredCapabilities.has(nativeCapability);
  if (!nativeAuthority) startup.actualGuest();
  const allowed = ['fileSystem', 'isolationRoot', 'installationDir', 'artifactDir', 'stateDir', 'dataDir', 'profileDir', 'role', 'sourceEnvelope', 'targetEnvelope', 'trust', 'processBarrier', 'now', 'checkpoint', 'legacyRoleConfirmation'];
  requireValue(options && typeof options === 'object' && Object.keys(options).every(key => allowed.includes(key)), 'BAD_OPTIONS', '只允许固定隔离候选参数');
  requireValue(!nativeAuthority || options.fileSystem === undefined,'BAD_OPTIONS','原生权能不接受替换文件系统');
  const io = options.fileSystem || fs, now = options.now || Date.now, checkpoint = options.checkpoint || (() => {}), barrier = options.processBarrier;
  requireValue(typeof now === 'function' && typeof checkpoint === 'function' && barrier && ['getCurrent', 'isAssistantAlive', 'waitClosed', 'assertClosed', 'restart'].every(key => typeof barrier[key] === 'function'), 'BAD_LIFECYCLE', '外置受信助手和正常退出屏障缺失');
  const paths = Object.fromEntries(['isolationRoot', 'installationDir', 'artifactDir', 'stateDir', 'dataDir', 'profileDir'].map(key => [key, u.safeAbsolute(options[key])]));
  const root = paths.isolationRoot, install = paths.installationDir, artifact = paths.artifactDir, state = paths.stateDir;
  if (!nativeAuthority) requireValue(u.samePath(path.dirname(root), BASE) && /^case-[A-Za-z0-9_-]{1,80}$/.test(path.basename(root)), 'ISOLATION', '候选事务只允许专属Guest case目录');
  const names = { installationDir: 'program', artifactDir: 'candidate', stateDir: 'engine-state', dataDir: 'data', profileDir: 'profile' };
  if (!nativeAuthority) for (const [key, name] of Object.entries(names)) requireValue(u.samePath(paths[key], path.join(root, name)), 'ISOLATION', '程序、候选、事务和资料必须分离在固定隔离目录');
  const movingRoots = nativeAuthority ? [install,artifact] : [root];
  requireValue(movingRoots.every(dir => !inside(dir, process.execPath) && !inside(dir, __filename) && (!process.argv[1] || !inside(dir,path.resolve(process.argv[1])))), 'EXTERNAL_ASSISTANT_REQUIRED', '维护助手不能从将被切换的程序或候选目录运行');
  const role = options.role;
  requireValue(['host', 'employee'].includes(role), 'BAD_ROLE', '必须明确保留原主机或员工角色');
  const trust = readTrust(options.trust), sourceEnvelope = copyEnvelope(options.sourceEnvelope), targetEnvelope = copyEnvelope(options.targetEnvelope);
  const sourceMutableFiles = nativeContext ? rows(nativeContext.sourceMutableFiles||[]) : [];
  const sourceMutableDirectories = nativeContext ? nativeContext.sourceMutableDirectories||[] : [];
  const mutablePrefixes=['.xjy-initial-upgrade','.xjy-patches','员工本地设置',...(bridgeSource?['.xjy-employee-updates']:[])];
  const mutableAllowed=name=>bridgeSource&&name==='xjy-employee-recovery.json'||knownExtraSourceFile(name)||mutablePrefixes.some(prefix=>name.startsWith(prefix+'/'));
  requireValue(validRows(sourceMutableFiles) && sourceMutableFiles.every(f => mutableAllowed(f.path)), 'BAD_MUTABLE_SCOPE', '旧可变资料只能取自已核恢复/profile子树');
  requireValue(Array.isArray(sourceMutableDirectories) && sourceMutableDirectories.length <= 8192 && sourceMutableDirectories.every(d => exact(d,['path','identity']) && (u.safeRelative(d.path) || core.safeHistoryRelative(d.path)) && typeof d.identity === 'string' && (mutablePrefixes.some(prefix => d.path === prefix || d.path.startsWith(prefix+'/')) || approvedEmptyDirectory(d.path))), 'BAD_MUTABLE_SCOPE','旧可变目录身份范围错误');
  const targetMutableFiles=nativeContext?rows(nativeContext.targetMutableFiles||[]):[];
  requireValue(validRows(targetMutableFiles)&&targetMutableFiles.every(f=>mutableAllowed(f.path)),'BAD_MUTABLE_SCOPE','目标只能保全已核原profile/恢复文件');
  const journalVersion = nativeAuthority ? 5 : 3;
  const journalPath = path.join(state, 'journal.json'), keyPath = path.join(state, 'journal-key.bin'), lockPath = path.join(state, 'install.lock');
  const launch = { executablePath: path.join(install, trust.executableName), args: role === 'employee' ? ['--employee-client'] : [], role };
  let busy = false, keyBytes = null;
  requireValue(trust.target.programVersion === '1.7.0' && trust.target.engineVersion === '44.9.0' && (['1.6.0','1.6.1','1.6.2'].includes(trust.source.programVersion)||(nativeAuthority||guestBridgeContexts.has(nativeCapability))&&bridgeSource?.kind==='authenticated-bridge-stage1'&&trust.source.programVersion==='1.7.0'&&trust.source.catalogSha256===bridgeSource.catalogSha256), 'BAD_TRUST', '此完整事务只允许明确旧版或认证维护桥到1.7.0/44.9.0');
  requireValue(u.samePath(state, startup.stateDirectory(install)), 'BAD_STATE_PATH', '启动状态必须在固定独立目录');

  function copyEnvelope(value) {
    requireValue(exact(value, ['catalog', 'signature']) && typeof value.catalog === 'string' && typeof value.signature === 'string', 'BAD_SIGNATURE', '固定签名目录缺失');
    return Object.freeze({ catalog: value.catalog, signature: value.signature });
  }
  function readTrust(value) {
    requireValue(exact(value, ['schemaVersion', 'purpose', 'publisherPublicKey', 'publisherPublicKeySha256', 'executableName', 'source', 'target']) && value.schemaVersion === 1 && value.purpose === (nativeAuthority ? PURPOSE : 'xjy-isolated-engine-tree') && SHA.test(value.publisherPublicKeySha256 || '') && u.safeRelative(value.executableName) && !value.executableName.includes('/') && /\.exe$/i.test(value.executableName), 'BAD_TRUST', '独立完整引擎信任输入无效');
    requireValue(value.publisherPublicKey?.type !== 'private' && !(typeof value.publisherPublicKey === 'string' && value.publisherPublicKey.includes('PRIVATE KEY')), 'BAD_PUBLIC_KEY', '本工具只接受独立发行公钥');
    const key = value.publisherPublicKey?.type === 'public' ? value.publisherPublicKey : crypto.createPublicKey(value.publisherPublicKey);
    requireValue(key.asymmetricKeyType === 'ed25519' && u.digest(key.export({ type: 'spki', format: 'der' })) === value.publisherPublicKeySha256, 'BAD_PUBLIC_KEY', '发行公钥摘要不符');
    const result = { publisherPublicKey: key, publisherPublicKeySha256: value.publisherPublicKeySha256, executableName: value.executableName };
    for (const which of ['source', 'target']) {
      const meta = value[which];
      requireValue(exact(meta, ['programVersion', 'engineVersion', 'catalogSha256', 'allowedFiles']) && /^1\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(meta.programVersion) && /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(meta.engineVersion) && SHA.test(meta.catalogSha256 || '') && Array.isArray(meta.allowedFiles) && meta.allowedFiles.length > 0 && meta.allowedFiles.length <= 4096, 'BAD_TRUST', '原目标完整目录信任清单无效');
      const files = meta.allowedFiles.slice();
      requireValue(new Set(files.map(name => String(name).toLowerCase())).size === files.length && files.every(name => enginePath(name, value.executableName)), 'BAD_TRUST', '完整引擎名单含数据、别名或未经允许的文件');
      for (const name of [value.executableName, 'version', 'ffmpeg.dll', 'icudtl.dat', 'resources.pak', 'snapshot_blob.bin', 'v8_context_snapshot.bin', 'locales/zh-CN.pak', 'resources/app.asar']) requireValue(files.includes(name), 'BAD_TRUST', '完整引擎或发布入口缺失');
      result[which] = Object.freeze({ programVersion: meta.programVersion, engineVersion: meta.engineVersion, catalogSha256: meta.catalogSha256, allowedFiles: Object.freeze(files) });
    }
    const oldParts = result.source.engineVersion.split('.').map(Number), newParts = result.target.engineVersion.split('.').map(Number);
    requireValue(oldParts.every(Number.isSafeInteger) && newParts.every(Number.isSafeInteger) && newParts.some((number, index) => newParts.slice(0, index).every((part, at) => part === oldParts[at]) && number > oldParts[index]), 'ENGINE_DOWNGRADE', '候选必须是明确更新的引擎版本');
    return Object.freeze(result);
  }
  function catalogs(recovery = false) {
    const out = {};
    for (const which of ['source', 'target']) {
      const envelope = which === 'source' ? sourceEnvelope : targetEnvelope, meta = trust[which];
      if(which==='source'&&bridgeSource){
        const original=bridgeSource.originalBinding;
        requireValue(meta.catalogSha256===bridgeSource.catalogSha256&&envelope.catalog===original.envelope.catalog&&envelope.signature===original.envelope.signature&&same(meta.allowedFiles,bridgeSource.programFiles.map(f=>f.path)),'BAD_BRIDGE_PROOF','认证桥来源不能由普通170或未签完整树替代');
        u.verifySignedCatalog(original.envelope,u.createTrustedUpdatePolicy({trustedPublicKey:trust.publisherPublicKey,currentVersion:original.meta.programVersion,allowedFiles:original.meta.allowedFiles,now}),{allowExpired:true});
        u.verifySignedCatalog(bridgeSource.bridgeEnvelope,u.createTrustedUpdatePolicy({trustedPublicKey:trust.publisherPublicKey,currentVersion:original.meta.programVersion,allowedFiles:bridgeSource.sourceCatalog.files.filter(f=>f.path.startsWith('resources/')).map(f=>f.path),now}),{allowExpired:true});
        out.source=bridgeSource.sourceCatalog;continue;
      }
      requireValue(u.digest(Buffer.from(envelope.catalog)) === meta.catalogSha256, 'BAD_CATALOG', '签名目录与独立信任摘要不符');
      const policy = u.createTrustedUpdatePolicy({ trustedPublicKey: trust.publisherPublicKey, currentVersion: trust.source.programVersion, allowedFiles: meta.allowedFiles, platform: 'win32', arch: 'x64', now });
      const catalog = u.verifySignedCatalog(envelope, policy, { allowExpired: which === 'source' || recovery });
      requireValue(catalog.version === meta.programVersion && catalog.files.length === meta.allowedFiles.length && catalog.files.every(file => enginePath(file.path, trust.executableName)), 'BAD_CATALOG', '签名必须完整覆盖同一版本引擎及资源');
      out[which] = catalog;
    }
    requireValue(out.target.sequence > out.source.sequence, 'STALE_CATALOG', '目标发布序号必须更新');
    return out;
  }
  async function exists(file) { try { await io.lstat(file, { bigint: true }); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
  async function directory(file, expected) {
    const stat = await u.assertPath(io, file, { directory: true, ...(nativeAuthority ? {} : {root}) });
    const identity = u.statIdentity(stat);
    if (expected) requireValue(identity === expected, 'DIRECTORY_CHANGED', '完整程序或资料目录物理身份已变化');
    return { identity, device: String(stat.dev) };
  }
  async function fixedDirectories() {
    if (!nativeAuthority) await u.assertPath(io, BASE, { directory: true, root: ROOT });
    const top = await directory(root), fixed = {};
    for (const key of ['artifactDir', 'stateDir', 'dataDir', 'profileDir']) {
      fixed[key] = await directory(paths[key]);
      if (!nativeAuthority || key === 'stateDir') requireValue(fixed[key].device === top.device, 'CROSS_VOLUME', '待rename程序/事务目录必须同卷');
    }
    return { root: top.identity, artifact: fixed.artifactDir.identity, state: fixed.stateDir.identity, data: fixed.dataDir.identity, profile: fixed.profileDir.identity };
  }
  function validRows(files) {
    return Array.isArray(files) && files.length <= 8192 && new Set(files.map(file => String(file?.path).toLowerCase())).size === files.length && files.every(file => exact(file, ['path', 'size', 'sha256']) && (u.safeRelative(file.path) || core.safeHistoryRelative(file.path)) && Number.isSafeInteger(file.size) && file.size >= 0 && file.size <= 1073741824 && SHA.test(file.sha256 || ''));
  }
  async function exactTree(dir, expected, expectedIdentity, extraDirectories = [], pathPolicy = 'program') {
    requireValue(validRows(expected), 'BAD_JOURNAL', '完整文件清单无效');
    const before = await directory(dir, expectedIdentity), tree = await core.inspectArtifactTree({ artifactDir: dir, fileSystem: io, pathPolicy });
    requireValue(same(rows(tree.files), rows(expected)), 'TREE_CHANGED', '完整树有缺失、额外文件或摘要变化');
    const directories = new Set();
    const directoryIdentities = new Map(extraDirectories.map(d => [d.path,d.identity]));
    for (const spec of extraDirectories) directories.add(spec.path);
    for (const file of expected) { let name = path.posix.dirname(file.path); while (name !== '.') { directories.add(name); name = path.posix.dirname(name); } }
    async function walk(current, prefix = '') {
      for (const name of await io.readdir(current)) {
        const relative = prefix + name, file = path.join(current, name), stat = await io.lstat(file, { bigint: true });
        if (stat.isDirectory()) { requireValue(directories.has(relative)||emptyDirectoryAlwaysAllowed(relative)||emptyMutableDirectoryAllowed(relative)&&(await io.readdir(file)).length===0, 'TREE_CHANGED', '完整树含未声明空目录'); if (directoryIdentities.has(relative)) requireValue(u.statIdentity(stat) === directoryIdentities.get(relative),'DIRECTORY_CHANGED','旧可变资料目录身份变化'); await u.assertPath(io, file, { directory: true, ...(nativeAuthority ? {} : {root}) }); await walk(file, relative + '/'); }
      }
    }
    await walk(dir); await directory(dir, before.identity);
    for (const spec of extraDirectories) requireValue(u.statIdentity(await u.assertPath(io,path.join(dir,...spec.path.split('/')),{directory:true,root:dir})) === spec.identity,'DIRECTORY_CHANGED','旧可变资料目录缺失或被替换');
    return before.identity;
  }
  async function snapshot(dir) {
    const identity = (await directory(dir)).identity, tree = await core.inspectArtifactTree({ artifactDir: dir, fileSystem: io, pathPolicy: 'preserved-history' }), files = rows(tree.files);
    await exactTree(dir, files, identity, [], 'preserved-history');
    return { identity, files };
  }
  function activation(bytes, version) {
    let value; try { value = JSON.parse(bytes); } catch { u.fail('BAD_ACTIVATION', '原安装角色记录无效'); }
    requireValue(exact(value, ['version', 'product', 'programVersion', 'role', 'installationDir']) && value.version === 1 && value.product === core.PRODUCT && value.programVersion === version && value.role === role && u.samePath(value.installationDir, install), 'BAD_ACTIVATION', '完整引擎升级不能改变原安装身份或角色');
    return value;
  }
  function markerRow(bytes) { return { path: MARKER, size: bytes.length, sha256: u.digest(bytes) }; }
  function originalRows(catalog, marker) { return rows([...catalog.files,...sourceMutableFiles,...(marker ? [markerRow(marker)] : [])]); }
  function confirmLegacy(identity) {
    const c = options.legacyRoleConfirmation;
    const fields=['confirmed','source','role','installationDir','installationIdentity','sourceVersion','osUserNamespace'];if(nativeAuthority)fields.push('approvalId');
    requireValue(exact(c, fields) && c.confirmed === true && c.source === (nativeAuthority?'independent-approval':'explicit') && (!nativeAuthority||c.approvalId===nativeContext.approvalId) && c.role === role && typeof c.installationDir === 'string' && u.samePath(c.installationDir, install) && c.installationIdentity === identity && c.sourceVersion === trust.source.programVersion && c.osUserNamespace === startup.namespace(), 'LEGACY_ROLE_CONFIRMATION_REQUIRED', '旧版缺少activation，必须对本机用户、原角色、源版本和物理目录作明确审定');
  }
  async function originalMarker() {
    let bytes;
    try { bytes = await u.readSmall(io, path.join(install, MARKER), 4096); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (bytes) {
      requireValue(options.legacyRoleConfirmation === undefined, 'BAD_ACTIVATION', '已有activation不得用legacy确认覆盖');
      activation(bytes, trust.source.programVersion); return bytes;
    }
    confirmLegacy((await directory(install)).identity); return null;
  }
  async function program(dir, which, files, expectedIdentity, markerBytes, allowMutable=false, pathPolicy='program') {
    let checked=files;
    if(which==='target'&&allowMutable&&targetMutableFiles.length){const fixed=new Set(files.filter(f=>!mutableAllowed(f.path)).map(f=>f.path)),current=(await core.inspectArtifactTree({artifactDir:dir,fileSystem:io,pathPolicy})).files;requireValue(current.every(f=>fixed.has(f.path)||mutableAllowed(f.path)),'TREE_CHANGED','启动后出现未知程序路径');checked=rows([...files.filter(f=>fixed.has(f.path)),...current.filter(f=>!fixed.has(f.path))]);}
    let extraDirectories=which==='source'?sourceMutableDirectories:[];
    if(which==='target'&&nativeAuthority&&files.some(f=>f.path===MARKER)){
      extraDirectories=[];
      async function currentDirs(current,prefix=''){for(const name of await io.readdir(current)){const file=path.join(current,name),relative=prefix+name,s=await io.lstat(file,{bigint:true});if(s.isDirectory()){await u.assertPath(io,file,{directory:true,root:dir});if(mutableAllowed(relative+'/'))extraDirectories.push({path:relative,identity:u.statIdentity(s)});await currentDirs(file,relative+'/');}}}
      if(allowMutable){await currentDirs(dir);extraDirectories.push(...await captureApprovedEmptyDirectories(io,dir));}
      else for(const spec of sourceMutableDirectories.filter(spec=>!approvedEmptyDirectory(spec.path)))extraDirectories.push({path:spec.path,identity:u.statIdentity(await u.assertPath(io,path.join(dir,...spec.path.split('/')),{directory:true,root:dir}))});
    }
    const identity = await exactTree(dir, checked, expectedIdentity, extraDirectories, pathPolicy), meta = trust[which];
    const pkg = await core.packageIdentity(io, path.join(dir, 'resources/app.asar'), dir);
    requireValue(pkg.version === meta.programVersion && pkg.main === 'release-entry.cjs', 'BAD_PROGRAM', '引擎与完整发布ASAR身份不符');
    requireValue((await u.readSmall(io, path.join(dir, 'version'), 64)).toString('utf8').trim() === meta.engineVersion, 'BAD_ENGINE', 'root version与受信引擎不符');
    const opened = await u.openChecked(io, path.join(dir, trust.executableName), 'r', { root: dir });
    try { await u.assertHandle(io, opened, { root: dir }); requireValue((await u.readExactly(opened.handle, 0, 2)).toString() === 'MZ', 'BAD_ENGINE', '固定引擎EXE头无效'); await u.assertHandle(io, opened, { root: dir }); } finally { await opened.handle.close(); }
    if (markerBytes) { const bytes = await u.readSmall(io, path.join(dir, MARKER), 4096); requireValue(bytes.equals(markerBytes), 'BAD_ACTIVATION', '安装角色记录原字节已变化'); activation(bytes, meta.programVersion); }
    await directory(dir, identity); return identity;
  }
  async function artifactTree(catalog, identity) { return program(artifact, 'target', rows(catalog.files), identity); }
  async function readKey(create = false) {
    await directory(state);
    if (!await exists(keyPath)) {
      requireValue(create && (await io.readdir(state)).length === 0, 'BAD_JOURNAL', '事务认证密钥缺失，拒绝重建旧证据');
      const opened = await u.openChecked(io, keyPath, 'wx+', { missing: true, root: state });
      try { await u.writeExactly(opened.handle, 0, crypto.randomBytes(32)); await opened.handle.sync(); await u.assertHandle(io, opened, { snapshot: false, root: state }); } finally { await opened.handle.close(); }
    }
    const bytes = await u.readSmall(io, keyPath, 32);
    requireValue(bytes.length === 32 && (!keyBytes || keyBytes.equals(bytes)), 'BAD_JOURNAL', '事务认证密钥已变化');
    keyBytes = bytes; return bytes;
  }
  async function pack(value) { const payload = JSON.stringify(value), key = await readKey(); return Buffer.from(JSON.stringify({ payload, mac: crypto.createHmac('sha256', key).update(payload).digest('hex') })); }
  async function unpack(file, limit) {
    let envelope; try { envelope = JSON.parse(await u.readSmall(io, file, limit)); } catch (error) { if (error.code === 'ENOENT') throw error; u.fail('BAD_JOURNAL', '事务认证记录不可读'); }
    requireValue(exact(envelope, ['payload', 'mac']) && typeof envelope.payload === 'string' && SHA.test(envelope.mac || ''), 'BAD_JOURNAL', '事务认证记录格式无效');
    const key = await readKey(), mac = crypto.createHmac('sha256', key).update(envelope.payload).digest();
    requireValue(crypto.timingSafeEqual(mac, Buffer.from(envelope.mac, 'hex')), 'BAD_JOURNAL', '事务认证记录已被修改');
    try { return JSON.parse(envelope.payload); } catch { u.fail('BAD_JOURNAL', '事务认证内容无效'); }
  }
  async function save(record) { await u.atomicWrite(io, journalPath, await pack(record), state); }
  async function readJournal() { return await exists(journalPath) ? unpack(journalPath, 16777216) : null; }
  async function startupRecord(record, phase) {
    const value = { version: deferred ? 2 : 1, purpose: startup.PURPOSE, transactionId: record.transactionId, phase,
      rollbackForbidden: phase === 'committed', installationDir: install, installationIdentity: record.identities.stage,
      stateDir: state, stateIdentity: record.identities.state, role, programVersion: trust.target.programVersion,
      engineVersion: trust.target.engineVersion, catalogSha256: trust.target.catalogSha256,
      publisherPublicKeySha256: trust.publisherPublicKeySha256, osUserNamespace: startup.namespace(), mode: 'upgrade',
      journalSha256: u.digest(await u.readSmall(io, journalPath, 16777216)) };
    if (deferred) value.businessReleased = false;
    return value;
  }
  async function writeStartup(record, phase, release = false) {
    const catalogFile = path.join(state, startup.CATALOG), catalogBytes = Buffer.from(JSON.stringify(targetEnvelope));
    if (await exists(catalogFile)) requireValue((await u.readSmall(io, catalogFile, 2097152)).equals(catalogBytes), 'BAD_SIGNATURE', '已保存完整目录不可替换');
    else await u.atomicWrite(io, catalogFile, catalogBytes, state);
    const file = path.join(state, startup.STATUS), key = await readKey(), value = await startupRecord(record, phase);
    if (deferred && release) value.businessReleased = true;
    if (await exists(file)) {
      const previous = startup.decode(await u.readSmall(io, file, 16384), key);
      if (deferred && previous.version === 2 && previous.phase === 'committed' && previous.businessReleased === true) value.businessReleased = true;
      const normalized = { ...previous, phase: value.phase, rollbackForbidden: value.rollbackForbidden, journalSha256: value.journalSha256 };
      if (deferred && release && previous.phase === 'committed' && previous.businessReleased === false) normalized.businessReleased = true;
      requireValue(['prepared','committed'].includes(previous.phase) && previous.rollbackForbidden === (previous.phase === 'committed') && SHA.test(previous.journalSha256 || '') && same(normalized, value), 'RECOVERY_CONFLICT', '旧启动收据不属于此事务，拒绝覆盖');
      if (previous.phase === 'committed' && same(previous, value)) return;
      if (previous.phase === 'committed') requireValue(deferred && release && previous.businessReleased === false && value.businessReleased === true, 'RECOVERY_CONFLICT', '已提交启动收据不可擅自更改');
    }
    await u.atomicWrite(io, file, startup.envelope(value, key), state);
    requireValue(same(startup.decode(await u.readSmall(io, file, 16384), key), value), 'STARTUP_READBACK_FAILED', '启动收据读回不符');
  }
  async function commit(record) {
    await layout(record, false, true); await closed(); await layout(record, false, true);
    if (nativeAuthority) await nativeContext.verifyBackup();
    Object.assign(record, { version: journalVersion, phase: 'committed', runtimeWrites: true, rollbackForbidden: true });
    await save(record);
    requireValue(same(await readJournal(), record), 'COMMIT_READBACK_FAILED', '完整提交记录读回不符');
    await layout(record, true, false); await writeStartup(record, 'committed');
    await checkpoint('commit-readback', u.freeze(JSON.parse(JSON.stringify(record))));
  }
  const transactionPrefix = nativeAuthority ? '.' + path.basename(install) + '.engine-' : '.engine-';
  function transactionPaths(id) { return { stageDir: path.join(root, transactionPrefix + 'stage-' + id), backupDir: path.join(root, transactionPrefix + 'backup-' + id), failedDir: path.join(root, transactionPrefix + 'failed-' + id) }; }
  const STAGE_INTENT_PURPOSE = 'xjy-engine-stage-create170', STAGE_INTENT_LIMIT = 16384;
  const STAGE_INTENT_PREFIX = 'stage-create-intent-', STAGE_INTENT_ARCHIVED_PREFIX = 'stage-create-intent-archived-';
  const STAGE_INTENT_FIELDS = ['version','purpose','transactionId','parentDir','stageDir','quarantineDir','parentIdentity','stateIdentity','sourceIdentity','sourceCatalogSha256','targetCatalogSha256','role','sid','stageIdentity','disposition','nativeEvidence'];
  const NATIVE_STAGE_EVIDENCE_FIELDS = ['nativeIntentSha256','dataProofIdentity','dataProofSha256','profileProofIdentity','profileProofSha256','sourceLeaseDirIdentity','backupName','backupIdentity','backupManifestSha256'];
  const stageIntentName = id => STAGE_INTENT_PREFIX + id + '.json';
  const archivedStageIntentName = id => STAGE_INTENT_ARCHIVED_PREFIX + id + '.json';
  const stageIntentFile = id => path.join(state, stageIntentName(id));
  const archivedStageIntentFile = id => path.join(state, archivedStageIntentName(id));
  const orphanStageDir = id => path.join(root, transactionPrefix + 'orphan-stage-' + id);
  const stageIdentityValue = value => typeof value === 'string' && value.length > 0 && value.length < 240;
  function validateStageIntent(value) {
    requireValue(exact(value, STAGE_INTENT_FIELDS) && value.version === 1 && value.purpose === STAGE_INTENT_PURPOSE && u.UUID.test(value.transactionId || '') && typeof value.parentDir === 'string' && typeof value.stageDir === 'string' && typeof value.quarantineDir === 'string' && stageIdentityValue(value.parentIdentity) && stageIdentityValue(value.stateIdentity) && stageIdentityValue(value.sourceIdentity) && value.sourceCatalogSha256 === trust.source.catalogSha256 && value.targetCatalogSha256 === trust.target.catalogSha256 && value.role === role && value.sid === (nativeContext?.sid || startup.namespace()) && typeof value.sid === 'string' && value.sid.length > 0 && value.sid.length <= 1024 && ['pending','bound','quarantined','journal','missing'].includes(value.disposition), 'BAD_STAGE_INTENT', 'stage创建意图字段或认证输入无效');
    const derived = transactionPaths(value.transactionId);
    requireValue(u.samePath(value.parentDir, root) && u.samePath(value.stageDir, derived.stageDir) && u.samePath(value.quarantineDir, orphanStageDir(value.transactionId)), 'BAD_STAGE_INTENT', 'stage创建意图路径必须由事务UUID派生');
    if (value.disposition === 'pending' || value.disposition === 'missing') requireValue(value.stageIdentity === null, 'BAD_STAGE_INTENT', '未绑定的stage意图不能带目录身份');
    else requireValue(stageIdentityValue(value.stageIdentity), 'BAD_STAGE_INTENT', '已创建stage意图必须绑定实际目录身份');
    if (value.nativeEvidence === null) requireValue(!nativeAuthority, 'BAD_STAGE_INTENT', '原生stage意图缺少恢复元数据');
    else requireValue(nativeAuthority && exact(value.nativeEvidence, NATIVE_STAGE_EVIDENCE_FIELDS) && SHA.test(value.nativeEvidence.nativeIntentSha256 || '') && stageIdentityValue(value.nativeEvidence.dataProofIdentity) && SHA.test(value.nativeEvidence.dataProofSha256 || '') && stageIdentityValue(value.nativeEvidence.profileProofIdentity) && SHA.test(value.nativeEvidence.profileProofSha256 || '') && (role === 'host' ? stageIdentityValue(value.nativeEvidence.sourceLeaseDirIdentity) : value.nativeEvidence.sourceLeaseDirIdentity === null) && typeof value.nativeEvidence.backupName === 'string' && value.nativeEvidence.backupName.startsWith(value.role === 'host' ? 'host-backup-' : 'employee-profile-') && /^(?:host-backup|employee-profile)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value.nativeEvidence.backupName) && stageIdentityValue(value.nativeEvidence.backupIdentity) && SHA.test(value.nativeEvidence.backupManifestSha256 || ''), 'BAD_STAGE_INTENT', '原生stage恢复元数据字段无效');
    return value;
  }
  async function packStageIntent(value) {
    validateStageIntent(value);
    const payload = JSON.stringify(value), key = await readKey();
    return Buffer.from(JSON.stringify({ payload, mac: crypto.createHmac('sha256', key).update('xjy-engine-stage-intent170|').update(payload).digest('hex') }));
  }
  async function unpackStageIntentBytes(bytes, limit = STAGE_INTENT_LIMIT) {
    requireValue(Buffer.isBuffer(bytes) && bytes.length <= limit, 'BAD_STAGE_INTENT', 'stage创建意图超出固定读写上限');
    let envelope; try { envelope = JSON.parse(bytes); } catch { u.fail('BAD_STAGE_INTENT', 'stage创建意图不可解析'); }
    requireValue(exact(envelope, ['payload','mac']) && typeof envelope.payload === 'string' && SHA.test(envelope.mac || ''), 'BAD_STAGE_INTENT', 'stage创建意图格式无效');
    const key = await readKey(), mac = crypto.createHmac('sha256', key).update('xjy-engine-stage-intent170|').update(envelope.payload).digest();
    requireValue(crypto.timingSafeEqual(mac, Buffer.from(envelope.mac, 'hex')), 'BAD_STAGE_INTENT', 'stage创建意图认证失败');
    let value; try { value = JSON.parse(envelope.payload); } catch { u.fail('BAD_STAGE_INTENT', 'stage创建意图内容无效'); }
    return validateStageIntent(value);
  }
  async function readStageIntent(file) { return unpackStageIntentBytes(await u.readSmall(io, file, STAGE_INTENT_LIMIT)); }
  async function writeStageIntent(file, value) {
    const bytes = await packStageIntent(value);
    requireValue(bytes.length <= STAGE_INTENT_LIMIT, 'BAD_STAGE_INTENT', 'stage创建意图超过固定写入上限');
    await u.atomicWrite(io, file, bytes, state);
    const readback = await u.readSmall(io, file, STAGE_INTENT_LIMIT);
    requireValue(readback.equals(bytes), 'STAGE_INTENT_READBACK_FAILED', 'stage创建意图读回字节不符');
    requireValue(same(await unpackStageIntentBytes(readback), value), 'STAGE_INTENT_READBACK_FAILED', 'stage创建意图读回认证不符');
    return bytes;
  }
  async function verifyStageIntentFile(file, expected) {
    const value = await readStageIntent(file);
    requireValue(same(value, expected), 'STAGE_INTENT_CHANGED', 'stage创建意图已被改变，保留现场');
    return value;
  }
  async function transitionStageIntent(intent, disposition, stageIdentity = intent.stageIdentity) {
    const next = { ...intent, disposition, stageIdentity };
    validateStageIntent(next);
    const active = stageIntentFile(intent.transactionId);
    await verifyStageIntentFile(active, intent);
    await writeStageIntent(active, next);
    return next;
  }
  async function archiveStageIntentFile(intent) {
    const active = stageIntentFile(intent.transactionId), archived = archivedStageIntentFile(intent.transactionId);
    const activeExists = await exists(active), archivedExists = await exists(archived);
    requireValue(!(activeExists && archivedExists), 'RECOVERY_CONFLICT', 'stage创建意图归档位置冲突');
    requireValue(activeExists || archivedExists, 'RECOVERY_CONFLICT', 'stage创建意图归档缺失');
    await directory(state, intent.stateIdentity);
    if (archivedExists) { await verifyStageIntentFile(archived, intent); return archived; }
    const bytes = await u.readSmall(io, active, STAGE_INTENT_LIMIT);
    requireValue(same(await unpackStageIntentBytes(bytes), intent), 'STAGE_INTENT_CHANGED', 'stage创建意图归档前变化');
    requireValue(!await exists(archived), 'RECOVERY_CONFLICT', 'stage创建意图归档目标已存在');
    await io.rename(active, archived);
    requireValue(!await exists(active), 'RECOVERY_CONFLICT', 'stage创建意图归档后源仍存在');
    const readback = await u.readSmall(io, archived, STAGE_INTENT_LIMIT);
    requireValue(readback.equals(bytes), 'STAGE_INTENT_READBACK_FAILED', 'stage创建意图归档读回字节不符');
    await verifyStageIntentFile(archived, intent);
    await directory(state, intent.stateIdentity);
    return archived;
  }
  async function stageIntentJournal(intent) {
    const live = await readJournal();
    if (live && live.transactionId === intent.transactionId) return live;
    const archived = path.join(state, 'journal-rolledback-' + intent.transactionId + '.json');
    return await exists(archived) ? await unpack(archived, ROLLBACK_ARCHIVE_LIMIT) : null;
  }
  function validateJournalForStageIntent(record, intent) {
    requireValue(record && record.transactionId === intent.transactionId && record.identities?.stage === intent.stageIdentity && u.samePath(record.stageDir, intent.stageDir), 'STAGE_INTENT_CONFLICT', 'stage意图journal身份不符，保留现场');
    validateJournal(record, catalogs(true));
    return record;
  }
  async function verifyStageIntentJournal(intent) {
    const record = await stageIntentJournal(intent);
    return validateJournalForStageIntent(record, intent);
  }
  async function validateArchivedStageIntent(intent) {
    validateStageIntent(intent);
    await directory(root, intent.parentIdentity);
    await directory(state, intent.stateIdentity);
    const stageExists = await exists(intent.stageDir), quarantineExists = await exists(intent.quarantineDir);
    if (intent.disposition === 'missing') {
      requireValue(intent.stageIdentity === null && !stageExists && !quarantineExists, 'STAGE_INTENT_CONFLICT', '未创建stage的归档出现目录对象，保留现场');
      return;
    }
    if (intent.disposition === 'quarantined') {
      requireValue(!stageExists && quarantineExists, 'STAGE_INTENT_CONFLICT', '隔离stage目录身份证据不完整，保留现场');
      await directory(intent.quarantineDir, intent.stageIdentity);
      return;
    }
    if (intent.disposition === 'journal') {
      requireValue(!quarantineExists, 'STAGE_INTENT_CONFLICT', '已入journal的stage不应同时存在隔离目录');
      await verifyStageIntentJournal(intent);
      if (stageExists) await directory(intent.stageDir, intent.stageIdentity);
      return;
    }
    u.fail('STAGE_INTENT_CONFLICT', '未完成stage意图被归档，保留现场');
  }
  async function preserveStageIntent(intent) {
    let value = intent;
    requireValue(stageIdentityValue(value.stageIdentity) && ['bound','quarantined'].includes(value.disposition), 'STAGE_INTENT_CONFLICT', '无法认证为已创建stage，保留现场');
    if (value.disposition === 'bound') {
      await verifyStageIntentFile(stageIntentFile(value.transactionId), value);
      value = await transitionStageIntent(value, 'quarantined');
    }
    await directory(root, value.parentIdentity);
    await directory(state, value.stateIdentity);
    const stageExists = await exists(value.stageDir), quarantineExists = await exists(value.quarantineDir);
    requireValue(stageExists || quarantineExists, 'STAGE_INTENT_CONFLICT', 'stage保全目标缺失，保留现场');
    requireValue(!(stageExists && quarantineExists), 'STAGE_INTENT_CONFLICT', 'stage同时位于原位置和隔离位置，保留现场');
    if (stageExists) {
      await directory(value.stageDir, value.stageIdentity);
      requireValue(!await exists(value.quarantineDir), 'RECOVERY_CONFLICT', 'stage隔离目标已存在');
      await io.rename(value.stageDir, value.quarantineDir);
      requireValue(!await exists(value.stageDir), 'RECOVERY_CONFLICT', 'stage隔离rename后原位置仍存在');
    }
    await directory(value.quarantineDir, value.stageIdentity);
    await archiveStageIntentFile(value);
    await validateArchivedStageIntent(value);
    return value.quarantineDir;
  }
  async function archiveMissingStageIntent(intent) {
    requireValue(intent.disposition === 'pending' && intent.stageIdentity === null, 'STAGE_INTENT_CONFLICT', '未创建stage的意图状态不符');
    await directory(root, intent.parentIdentity);
    await directory(state, intent.stateIdentity);
    requireValue(!await exists(intent.stageDir) && !await exists(intent.quarantineDir), 'STAGE_OWNERSHIP_UNPROVEN', 'mkdir窗口内目录出现但无法证明归属，停止并保留');
    const next = await transitionStageIntent(intent, 'missing', null);
    await archiveStageIntentFile(next);
    await validateArchivedStageIntent(next);
    return next;
  }
  async function reconcileStageIntent(intent) {
    if (intent.disposition === 'pending') return archiveMissingStageIntent(intent);
    if (intent.disposition === 'missing') { await archiveStageIntentFile(intent); await validateArchivedStageIntent(intent); return; }
    if (intent.disposition === 'bound') {
      const live = await readJournal();
      if (live && live.transactionId === intent.transactionId && live.identities?.stage === intent.stageIdentity) {
        validateJournalForStageIntent(live, intent);
        const next = await transitionStageIntent(intent, 'journal');
        await archiveStageIntentFile(next);
        await validateArchivedStageIntent(next);
        return;
      }
      return preserveStageIntent(intent);
    }
    if (intent.disposition === 'quarantined') return preserveStageIntent(intent);
    if (intent.disposition === 'journal') {
      await verifyStageIntentJournal(intent);
      await archiveStageIntentFile(intent);
      await validateArchivedStageIntent(intent);
      return;
    }
    u.fail('STAGE_INTENT_CONFLICT', '未知stage意图状态，保留现场');
  }
  async function adoptStageIntent(intent) {
    requireValue(intent && intent.disposition === 'bound' && stageIdentityValue(intent.stageIdentity), 'STAGE_INTENT_CONFLICT', '只有已绑定实际目录身份的stage意图可随journal归档');
    await verifyStageIntentJournal(intent);
    const next = await transitionStageIntent(intent, 'journal');
    await archiveStageIntentFile(next);
    await validateArchivedStageIntent(next);
    return next;
  }
  async function listActiveStageIntentIds() {
    const ids = [];
    for (const name of await io.readdir(state)) {
      if (name.startsWith(STAGE_INTENT_ARCHIVED_PREFIX)) continue;
      if (!name.startsWith(STAGE_INTENT_PREFIX)) continue;
      const id = name.slice(STAGE_INTENT_PREFIX.length, -'.json'.length);
      requireValue(name === stageIntentName(id) && u.UUID.test(id), 'RECOVERY_CONFLICT', 'stage创建意图名称无效，保留现场');
      ids.push(id);
    }
    return ids.sort();
  }
  async function listArchivedStageIntents() {
    const intents = [];
    for (const name of await io.readdir(state)) {
      if (!name.startsWith(STAGE_INTENT_ARCHIVED_PREFIX)) continue;
      const id = name.slice(STAGE_INTENT_ARCHIVED_PREFIX.length, -'.json'.length);
      requireValue(name === archivedStageIntentName(id) && u.UUID.test(id), 'RECOVERY_CONFLICT', 'stage创建意图归档名称无效，保留现场');
      const intent = await readStageIntent(archivedStageIntentFile(id));
      requireValue(intent.transactionId === id, 'BAD_STAGE_INTENT', 'stage创建意图归档事务ID不符');
      await validateArchivedStageIntent(intent);
      intents.push(intent);
    }
    intents.sort((a,b)=>a.transactionId<b.transactionId?-1:a.transactionId>b.transactionId?1:0);
    return intents;
  }
  async function verifyRetainedStageArchives() {
    const intents = await listArchivedStageIntents(), archivedIds = intents.map(intent => intent.transactionId);
    const orphanPrefix = transactionPrefix + 'orphan-stage-', known = new Set(archivedIds);
    for (const name of await io.readdir(root)) {
      if (!name.startsWith(orphanPrefix)) continue;
      const id = name.slice(orphanPrefix.length);
      requireValue(u.UUID.test(id) && known.has(id), 'RECOVERY_CONFLICT', '存在无认证stage意图的隔离目录，保留现场');
    }
    return archivedIds.length;
  }
  async function retainedStageStateAllowed(stateNames, intents, rollbackIds = []) {
    const allowed = new Set([path.basename(keyPath)]);
    for (const intent of intents) allowed.add(archivedStageIntentName(intent.transactionId));
    for (const id of rollbackIds) {
      requireValue(u.UUID.test(id), 'BAD_JOURNAL', '回退归档事务ID无效');
      const archived = rollbackArchiveNames(id);
      for (const key of ['journal', 'status', 'catalog', 'data', 'profile']) allowed.add(path.basename(archived[key]));
    }
    if (nativeAuthority) {
      requireValue(intents.length > 0, 'BAD_JOURNAL', '原生恢复缺少已认证stage意图');
      const installStat = native.lstatSync(install, { bigint: true });
      requireValue(installStat.isDirectory() && !installStat.isSymbolicLink(), 'BAD_JOURNAL', '当前安装目录不是普通目录');
      const installPhysicalIdentity = physicalIdentity(installStat), installStatIdentity = u.statIdentity(installStat);
      const nativeIntentFile = path.join(state, 'native-intent.json'), dataProofDir = path.join(state, 'data-proof'), profileProofDir = path.join(state, 'profile-proof');
      let sourceLeaseDirIdentity = null;
      if (role === 'host') {
        const sourceLeaseDir = path.join(state, '.xjy-initial-upgrade');
        const sourceLeaseStat = native.lstatSync(sourceLeaseDir, { bigint: true });
        requireValue(sourceLeaseStat.isDirectory() && !sourceLeaseStat.isSymbolicLink(), 'BAD_JOURNAL', '源锁辅助目录不是普通目录');
        sourceLeaseDirIdentity = u.statIdentity(sourceLeaseStat);
        allowed.add('.xjy-initial-upgrade');
        // 仅认证固定辅助目录的身份；不读取、执行或修改其内容，源锁释放后内容可变。
      }
      const nativeIntentBytes = await u.readSmall(io, nativeIntentFile, 16384), dataProofBytes = await u.readSmall(io, path.join(dataProofDir, 'backup.json'), 16384), profileProofBytes = await u.readSmall(io, path.join(profileProofDir, 'profile.json'), 16384);
      const nativeIntentSha256 = u.digest(nativeIntentBytes), dataProofSha256 = u.digest(dataProofBytes), profileProofSha256 = u.digest(profileProofBytes), dataProofIdentity = (await directory(dataProofDir)).identity, profileProofIdentity = (await directory(profileProofDir)).identity;
      const dataProofNames = await io.readdir(dataProofDir), profileProofNames = await io.readdir(profileProofDir);
      requireValue(same(dataProofNames.slice().sort(), ['backup.json']) && same(profileProofNames.slice().sort(), ['profile.json']), 'BAD_JOURNAL', 'proof目录含未认证对象，保留现场');
      let wrapper; try { wrapper = JSON.parse(nativeIntentBytes); } catch { u.fail('BAD_JOURNAL', '原生intent不可解析'); }
      requireValue(exact(wrapper, ['payload','mac']) && typeof wrapper.payload === 'string' && SHA.test(wrapper.mac || ''), 'BAD_JOURNAL', '原生intent格式无效');
      const key = await readKey(), mac = crypto.createHmac('sha256', key).update('xjy-native-engine-intent170\0').update(wrapper.payload).digest();
      requireValue(crypto.timingSafeEqual(mac, Buffer.from(wrapper.mac, 'hex')), 'BAD_JOURNAL', '原生intent认证失败');
      let payload; try { payload = JSON.parse(wrapper.payload); } catch { u.fail('BAD_JOURNAL', '原生intent内容无效'); }
      requireValue(exact(payload, ['version','purpose','publicationId','authorizationKind','approvalId','installationDir','role','osUser','sourceVersion','sourceIdentity']) && payload.version === 1 && payload.purpose === 'xjy-native-engine-intent170' && u.samePath(payload.installationDir, install) && payload.role === role && typeof payload.osUser === 'string' && payload.osUser.length > 0 && (payload.sourceIdentity === null || stageIdentityValue(payload.sourceIdentity)), 'BAD_JOURNAL', '原生intent不属于当前安装/角色');
      requireValue(payload.sourceIdentity === null || payload.sourceIdentity === installPhysicalIdentity, 'BAD_JOURNAL', '原生intent源身份与当前安装不符');
      requireValue(nativeContext && payload.approvalId === nativeContext.approvalId, 'BAD_JOURNAL', '原生intent审批身份与当前恢复不符');
      allowed.add('native-intent.json'); allowed.add('data-proof'); allowed.add('profile-proof');
      let currentProof = false;
      for (const intent of intents) {
        const evidence = intent.nativeEvidence;
        requireValue(evidence && evidence.nativeIntentSha256 === nativeIntentSha256 && evidence.dataProofIdentity === dataProofIdentity && evidence.profileProofIdentity === profileProofIdentity && (role === 'host' ? evidence.sourceLeaseDirIdentity === sourceLeaseDirIdentity : evidence.sourceLeaseDirIdentity === null) && payload.role === intent.role && payload.osUser === intent.sid && (payload.sourceIdentity === null || payload.sourceIdentity === installPhysicalIdentity) && intent.sourceIdentity === installStatIdentity, 'BAD_JOURNAL', '原生恢复元数据不属于此stage事务');
        await directory(path.join(state, evidence.backupName), evidence.backupIdentity);
        allowed.add(evidence.backupName);
        if (evidence.dataProofSha256 === dataProofSha256 && evidence.profileProofSha256 === profileProofSha256) currentProof = true;
      }
      requireValue(currentProof, 'BAD_JOURNAL', '当前proof文件未被任何已认证stage意图覆盖');
    }
    requireValue(stateNames.every(name => allowed.has(name)), 'BAD_JOURNAL', '存在无认证状态文件，拒绝重建');
  }
  async function recoverStageIntentsLocked() {
    const live = await readJournal();
    const activeIds = await listActiveStageIntentIds();
    for (const id of activeIds) {
      const intent = await readStageIntent(stageIntentFile(id));
      requireValue(intent.transactionId === id, 'BAD_STAGE_INTENT', 'stage创建意图事务ID不符');
      if (intent.disposition === 'bound' && !(live && live.transactionId === id && live.identities?.stage === intent.stageIdentity)) {
        await preserveStageIntent(intent);
        continue;
      }
      await reconcileStageIntent(intent);
    }
    return await verifyRetainedStageArchives();
  }
  function validateJournal(record, catalog) {
    const keys = ['version', 'purpose', 'transactionId', 'phase', 'paths', 'role', 'publisherPublicKeySha256', 'sourceCatalogSha256', 'targetCatalogSha256', 'sourceVersion', 'targetVersion', 'sourceEngineVersion', 'targetEngineVersion', 'identities', 'sourceFiles', 'targetFiles', 'sourceActivation', 'targetActivation', 'dataFiles', 'profileFiles', 'stageDir', 'backupDir', 'failedDir'];
    keys.push('runtimeWrites', 'rollbackForbidden');
    if (nativeAuthority) keys.push('sourceMutableFiles','sourceMutableDirectories','targetMutableFiles','sourceEvidence');
    requireValue(exact(record, keys) && record.version === journalVersion && (!nativeAuthority || same(record.sourceMutableFiles,sourceMutableFiles) && same(record.sourceMutableDirectories,sourceMutableDirectories)&&same(record.targetMutableFiles,targetMutableFiles)&&same(record.sourceEvidence,bridgeSource?.descriptor||null)) && typeof record.runtimeWrites === 'boolean' && typeof record.rollbackForbidden === 'boolean' && record.purpose === PURPOSE && u.UUID.test(record.transactionId || '') && ['prepared', 'old-renamed', 'new-published', 'committed', 'rolling-back', 'rolledback', 'rollback-failed'].includes(record.phase) && same(record.paths, paths) && record.role === role && record.publisherPublicKeySha256 === trust.publisherPublicKeySha256 && record.sourceCatalogSha256 === trust.source.catalogSha256 && record.targetCatalogSha256 === trust.target.catalogSha256 && record.sourceVersion === trust.source.programVersion && record.targetVersion === trust.target.programVersion && record.sourceEngineVersion === trust.source.engineVersion && record.targetEngineVersion === trust.target.engineVersion, 'BAD_JOURNAL', '恢复记录不属于此完整候选事务');
    requireValue(record.rollbackForbidden === (record.phase === 'committed') && (record.phase !== 'committed' || record.runtimeWrites === true), 'BAD_JOURNAL', '提交与禁止回退边界不符');
    requireValue(record.runtimeWrites !== true || ['committed', 'rolledback', 'rollback-failed'].includes(record.phase), 'BAD_JOURNAL', '切换阶段不能授权业务资料写入');
    requireValue(exact(record.identities, ['root', 'artifact', 'state', 'data', 'profile', 'source', 'stage']) && Object.values(record.identities).every(value => typeof value === 'string' && value.length > 0 && value.length < 240), 'BAD_JOURNAL', '恢复物理身份无效');
    const derived = transactionPaths(record.transactionId);
    for (const key of Object.keys(derived)) requireValue(record[key] === derived[key], 'BAD_JOURNAL', '恢复目录不能由journal选择任意路径');
    requireValue((record.sourceActivation === null || typeof record.sourceActivation === 'string' && record.sourceActivation.length <= 8192) && typeof record.targetActivation === 'string' && record.targetActivation.length <= 8192, 'BAD_JOURNAL', '恢复角色原字节无效');
    const sourceBytes = record.sourceActivation === null ? null : Buffer.from(record.sourceActivation, 'base64'), targetBytes = Buffer.from(record.targetActivation, 'base64');
    requireValue((sourceBytes === null || sourceBytes.toString('base64') === record.sourceActivation) && targetBytes.toString('base64') === record.targetActivation, 'BAD_JOURNAL', '恢复角色原字节编码无效');
    if (sourceBytes) activation(sourceBytes, trust.source.programVersion); activation(targetBytes, trust.target.programVersion);
    requireValue(same(record.sourceFiles, originalRows(catalog.source,sourceBytes)) && same(record.targetFiles, rows([...catalog.target.files,...targetMutableFiles, markerRow(targetBytes)])) && validRows(record.dataFiles) && validRows(record.profileFiles), 'BAD_JOURNAL', '恢复文件清单不能更换已签程序或资料摘要');
    return { sourceBytes, targetBytes };
  }
  async function protectedTrees(record, contents = record.runtimeWrites !== true) {
    const current = await fixedDirectories();
    for (const key of ['root', 'artifact', 'state', 'data', 'profile']) requireValue(current[key] === record.identities[key], 'DIRECTORY_CHANGED', '恢复根或资料目录身份不符');
    if (contents) {
      await exactTree(paths.dataDir, record.dataFiles, record.identities.data, [], 'preserved-history');
      await exactTree(paths.profileDir, record.profileFiles, record.identities.profile, [], 'preserved-history');
    }
  }
  async function layout(record, recovery = true, contents = record.runtimeWrites !== true) {
    const catalog = catalogs(recovery), bytes = validateJournal(record, catalog);
    await protectedTrees(record, contents); await artifactTree(catalog.target, record.identities.artifact);
    const locations = { live: install, stage: record.stageDir, backup: record.backupDir, failed: record.failedDir, retired: rollbackArchiveNames(record.transactionId).dir }, found = { source: null, target: null };
    for (const [name, file] of Object.entries(locations)) {
      if (!await exists(file)) continue;
      const identity = (await directory(file)).identity;
      if (identity === record.identities.source && ['live', 'backup'].includes(name)) {
        requireValue(found.source === null, 'RECOVERY_CONFLICT', '出现多个旧程序对象');
        await program(file, 'source', record.sourceFiles, identity, bytes.sourceBytes, false, 'preserved-history'); found.source = name;
      } else if (identity === record.identities.stage && ['live', 'stage', 'failed', 'retired'].includes(name)) {
        requireValue(found.target === null, 'RECOVERY_CONFLICT', '出现多个目标程序对象');
        let released=!deferred;if(deferred&&record.phase==='committed'){try{released=startup.decode(await u.readSmall(io,path.join(state,startup.STATUS),16384),await readKey()).businessReleased===true;}catch(error){if(error.code!=='ENOENT')throw error;}}
        await program(file, 'target', record.targetFiles, identity, bytes.targetBytes,record.runtimeWrites&&released,'preserved-history'); found.target = name;
      } else u.fail('RECOVERY_CONFLICT', '程序位置存在未知或替换的目录对象');
    }
    requireValue(found.source && found.target && (found.source === 'live' ? found.target !== 'live' : found.source === 'backup'), 'RECOVERY_CONFLICT', '恢复所需原目标完整树缺失');
    if (record.phase === 'committed') requireValue(found.source === 'backup' && found.target === 'live', 'RECOVERY_CONFLICT', '完成记录与完整目标位置不符');
    if (record.phase === 'rolledback') requireValue(found.source === 'live' && ['stage', 'failed', 'retired'].includes(found.target), 'RECOVERY_CONFLICT', '回退记录与完整原程序位置不符');
    return found;
  }
  async function acquireLock(recordId, identities, createKey) {
    if (await exists(lockPath)) {
      const before = await u.assertPath(io, lockPath, { root: state }), old = await unpack(lockPath, 8192);
      requireValue(exact(old, ['version', 'purpose', 'rootIdentity', 'stateIdentity', 'transactionId', 'pid', 'creationMarker']) && old.version === 1 && old.purpose === PURPOSE && old.rootIdentity === identities.root && old.stateIdentity === identities.state && u.UUID.test(old.transactionId || '') && Number.isSafeInteger(old.pid) && old.pid > 0 && typeof old.creationMarker === 'string' && old.creationMarker.length > 0, 'BAD_JOURNAL', '原助手锁身份无效');
      requireValue(await barrier.isAssistantAlive(old) === false, 'BUSY', '原维护助手仍在运行或身份未确认');
      requireValue(u.statIdentity(await u.assertPath(io, lockPath, { root: state })) === u.statIdentity(before), 'FILE_CHANGED', '原助手锁已变化');
      await io.unlink(lockPath);
    }
    await readKey(createKey);
    const current = await barrier.getCurrent();
    requireValue(current && Number.isSafeInteger(current.pid) && current.pid > 0 && typeof current.creationMarker === 'string' && current.creationMarker.length > 0 && current.creationMarker.length <= 240, 'BAD_LIFECYCLE', '当前外置助手物理进程身份缺失');
    const owner = { version: 1, purpose: PURPOSE, rootIdentity: identities.root, stateIdentity: identities.state, transactionId: recordId, pid: current.pid, creationMarker: current.creationMarker }, body = await pack(owner);
    const opened = await u.openChecked(io, lockPath, 'wx+', { missing: true, root: state });
    try { await u.writeExactly(opened.handle, 0, body); await opened.handle.sync(); await u.assertHandle(io, opened, { snapshot: false, root: state }); } finally { await opened.handle.close(); }
    return async () => { requireValue(u.statIdentity(await u.assertPath(io, lockPath, { root: state })) === opened.identity && same(await unpack(lockPath, 8192), owner), 'FILE_CHANGED', '安装锁不再属于本助手'); await io.unlink(lockPath); };
  }
  async function closed(wait = false) {
    if (nativeAuthority) await nativeContext.revalidate();
    if (wait) await barrier.waitClosed({ ...launch, args: launch.args.slice() });
    requireValue(await barrier.assertClosed({ ...launch, args: launch.args.slice() }) === true, 'PROGRAM_IN_USE', '未确认全部原程序及相关子进程正常退出');
  }
  const ROLLBACK_ARCHIVE_LIMIT = 16777216, ROLLBACK_PROOF_LIMIT = 4194304;
  async function unpackBytes(bytes, limit) {
    requireValue(Buffer.isBuffer(bytes) && bytes.length <= limit, 'BAD_JOURNAL', '事务认证记录超出固定界限');
    let envelope; try { envelope = JSON.parse(bytes); } catch { u.fail('BAD_JOURNAL', '事务认证记录不可解析'); }
    requireValue(exact(envelope, ['payload', 'mac']) && typeof envelope.payload === 'string' && SHA.test(envelope.mac || ''), 'BAD_JOURNAL', '事务认证记录格式无效');
    const key = await readKey(), mac = crypto.createHmac('sha256', key).update(envelope.payload).digest();
    requireValue(crypto.timingSafeEqual(mac, Buffer.from(envelope.mac, 'hex')), 'BAD_JOURNAL', '事务认证记录已被修改');
    try { return JSON.parse(envelope.payload); } catch { u.fail('BAD_JOURNAL', '事务认证内容无效'); }
  }
  function rollbackArchiveNames(transactionId) {
    return {
      dir: path.join(root, transactionPrefix + 'retired-' + transactionId),
      journal: path.join(state, 'journal-rolledback-' + transactionId + '.json'),
      status: path.join(state, 'status-rolledback-' + transactionId + '.json'),
      catalog: path.join(state, 'catalog-rolledback-' + transactionId + '.json'),
      data: path.join(state, 'data-proof-rolledback-' + transactionId),
      profile: path.join(state, 'profile-proof-rolledback-' + transactionId)
    };
  }
  async function locateRollbackTarget(record, names) {
    let found = null;
    for (const dir of [record.failedDir, record.stageDir, names.dir]) {
      if (!await exists(dir)) continue;
      const identity = (await directory(dir)).identity;
      requireValue(identity === record.identities.stage, 'RECOVERY_CONFLICT', '回退目标位置存在未知目录对象，保留现场');
      requireValue(found === null, 'RECOVERY_CONFLICT', '回退目标目录重复，保留现场');
      found = dir;
    }
    requireValue(found !== null, 'RECOVERY_CONFLICT', '回退目标完整树缺失');
    return found;
  }
  async function verifyRolledbackStatus(bytes, record) {
    const value = startup.decode(bytes, await readKey());
    requireValue(value && typeof value === 'object' && !Array.isArray(value), 'RECOVERY_REQUIRED', '回退启动收据格式无效');
    const allowed = ['version','purpose','transactionId','phase','rollbackForbidden','installationDir','installationIdentity','stateDir','stateIdentity','role','programVersion','engineVersion','catalogSha256','publisherPublicKeySha256','osUserNamespace','mode','journalSha256','businessReleased'];
    requireValue(Object.keys(value).every(key => allowed.includes(key)) && [1,2].includes(value.version), 'RECOVERY_REQUIRED', '回退启动收据字段无效');
    requireValue(value.purpose === startup.PURPOSE && value.transactionId === record.transactionId && value.phase === 'prepared' && value.rollbackForbidden === false, 'RECOVERY_REQUIRED', '回退启动收据不属于该回退事务');
    requireValue(u.samePath(value.installationDir, install) && value.installationIdentity === record.identities.stage && u.samePath(value.stateDir, state) && value.stateIdentity === record.identities.state && value.role === role, 'RECOVERY_REQUIRED', '回退启动收据目录或角色不符');
    requireValue(value.programVersion === record.targetVersion && value.engineVersion === record.targetEngineVersion && value.catalogSha256 === record.targetCatalogSha256 && value.publisherPublicKeySha256 === record.publisherPublicKeySha256 && value.osUserNamespace === startup.namespace() && ['upgrade','fresh'].includes(value.mode) && SHA.test(value.journalSha256 || ''), 'RECOVERY_REQUIRED', '回退启动收据版本或认证不符');
    requireValue(value.version !== 2 || value.businessReleased === false, 'RECOVERY_REQUIRED', '回退启动收据业务放行状态无效');
    return value;
  }
  async function verifyRolledbackCatalog(bytes, record) {
    let envelope; try { envelope = JSON.parse(bytes); } catch { u.fail('RECOVERY_REQUIRED', '回退完整目录不是JSON'); }
    requireValue(exact(envelope, ['catalog','signature']) && typeof envelope.catalog === 'string' && typeof envelope.signature === 'string', 'RECOVERY_REQUIRED', '回退完整目录格式不符');
    requireValue(u.digest(Buffer.from(envelope.catalog)) === record.targetCatalogSha256, 'RECOVERY_REQUIRED', '回退完整目录摘要不属于该事务');
    let raw; try { raw = JSON.parse(envelope.catalog); } catch { u.fail('RECOVERY_REQUIRED', '回退完整目录内容不是JSON'); }
    requireValue(Array.isArray(raw.files) && raw.files.length > 0, 'RECOVERY_REQUIRED', '回退完整目录文件清单无效');
    const catalog = u.verifySignedCatalog(envelope, u.createTrustedUpdatePolicy({ trustedPublicKey: trust.publisherPublicKey, currentVersion: record.sourceVersion, allowedFiles: raw.files.map(file => file.path), platform: 'win32', arch: 'x64', now }), { allowExpired: true });
    requireValue(catalog.version === record.targetVersion, 'RECOVERY_REQUIRED', '回退完整目录版本不符');
    requireValue(same(rows(catalog.files), rows(record.targetFiles.filter(file => file.path !== MARKER && !mutableAllowed(file.path)))), 'RECOVERY_REQUIRED', '回退完整目录文件清单不属于该事务');
  }
  async function inspectArchiveFile(source, target, limit, label, validate) {
    const sourceExists = await exists(source), targetExists = await exists(target);
    requireValue(sourceExists || targetExists, 'RECOVERY_CONFLICT', label + '源文件与归档均缺失');
    requireValue(!(sourceExists && targetExists), 'RECOVERY_CONFLICT', label + '源文件与归档同时存在，保留现场');
    const bytes = sourceExists ? await u.readSmall(io, source, limit) : await u.readSmall(io, target, limit);
    await validate(bytes);
    return { sourceExists, targetExists, bytes };
  }
  async function archiveVerifiedFile(source, target, limit, label, stateIdentity, validate) {
    const checked = await inspectArchiveFile(source, target, limit, label, validate);
    if (checked.targetExists) return checked.bytes;
    await directory(state, stateIdentity);
    await io.rename(source, target);
    requireValue(!await exists(source), 'RECOVERY_CONFLICT', label + '归档后源文件仍存在');
    const readback = await u.readSmall(io, target, limit);
    requireValue(readback.equals(checked.bytes), 'RECOVERY_CONFLICT', label + '归档读回字节不符');
    await validate(readback);
    await directory(state, stateIdentity);
    return readback;
  }
  async function inspectProofFiles(sourceDir, sourceIdentity, files, archiveDir) {
    await exactTree(sourceDir, files, sourceIdentity, [], 'preserved-history');
    await inspectProofArchiveSubset(archiveDir, files, sourceDir);
    await directory(sourceDir, sourceIdentity);
  }

  async function proofCopyLstat(file) {
    try {
      return await io.lstat(file, { bigint: true });
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  function proofCopyLayout(files) {
    const byPath = new Map();
    const directories = new Set();
    for (const file of files) {
      byPath.set(file.path, file);
      const parts = file.path.split('/');
      let relative = '';
      for (let index = 0; index < parts.length - 1; index += 1) {
        relative = relative ? `${relative}/${parts[index]}` : parts[index];
        directories.add(relative);
      }
    }
    return { byPath, directories };
  }

  async function proofCopyResume(sourceDir, sourceIdentity, file, archiveDir, archiveIdentity, append) {
    const parts = file.path.split('/');
    const from = path.join(sourceDir, ...parts), to = path.join(archiveDir, ...parts);
    u.within(sourceDir, from);
    u.within(archiveDir, to);
    await directory(archiveDir, archiveIdentity);
    if (sourceIdentity) await directory(sourceDir, sourceIdentity);
    else await directory(sourceDir);
    const source = await u.openChecked(io, from, 'r', { root: sourceDir });
    let target;
    try {
      const sourceStat = await u.assertHandle(io, source, { root: sourceDir });
      requireValue(Number(sourceStat.size) === file.size, 'RECOVERY_CONFLICT', '回退proof源文件大小与认证清单不符，保留现场');
      const sourceSha = await u.hashHandle(source.handle, file.size);
      await u.assertHandle(io, source, { root: sourceDir });
      requireValue(sourceSha === file.sha256, 'RECOVERY_CONFLICT', '回退proof源文件摘要与认证清单不符，保留现场');
      const targetStat = await proofCopyLstat(to);
      requireValue(targetStat && targetStat.isFile() && !targetStat.isSymbolicLink(), 'RECOVERY_CONFLICT', '回退proof归档目标必须是普通文件，保留现场');
      requireValue(targetStat.nlink === 1n, 'RECOVERY_CONFLICT', '回退proof归档目标必须是单硬链接文件，保留现场');
      requireValue(targetStat.size <= BigInt(file.size), 'RECOVERY_CONFLICT', '回退proof归档目标超出认证长度，保留现场');
      const existing = Number(targetStat.size);
      target = await u.openChecked(io, to, append ? 'r+' : 'r', { root: archiveDir });
      const openedStat = await u.assertHandle(io, target, { root: archiveDir });
      requireValue(openedStat.nlink === 1n, 'RECOVERY_CONFLICT', '回退proof归档目标必须是单硬链接文件，保留现场');
      requireValue(target.identity === u.statIdentity(targetStat) && Number(openedStat.size) === existing, 'FILE_CHANGED', '回退proof归档目标在检查期间变化，保留现场');
      let offset = 0;
      while (offset < existing) {
        const length = Math.min(u.CHUNK, existing - offset);
        const sourceBytes = await u.readExactly(source.handle, offset, length);
        const targetBytes = await u.readExactly(target.handle, offset, length);
        requireValue(sourceBytes.equals(targetBytes), 'RECOVERY_CONFLICT', '回退proof归档目标前缀与源不符，保留现场');
        offset += length;
      }
      await u.assertHandle(io, source, { root: sourceDir });
      await u.assertHandle(io, target, { root: archiveDir });
      if (!append || existing === file.size) {
        if (existing === file.size) {
          const targetSha = await u.hashHandle(target.handle, file.size);
          await u.assertHandle(io, target, { root: archiveDir });
          requireValue(targetSha === file.sha256, 'RECOVERY_CONFLICT', '回退proof归档目标摘要与源不符，保留现场');
        }
        await directory(archiveDir, archiveIdentity);
        if (sourceIdentity) await directory(sourceDir, sourceIdentity);
        return { complete: existing === file.size, size: existing, identity: target.identity };
      }
      let current = existing;
      while (current < file.size) {
        const before = await u.assertHandle(io, target, { root: archiveDir });
        requireValue(Number(before.size) === current, 'FILE_CHANGED', '回退proof归档目标在续写前变化，保留现场');
        await u.assertHandle(io, source, { root: sourceDir });
        const length = Math.min(u.CHUNK, file.size - current);
        const bytes = await u.readExactly(source.handle, current, length);
        await u.assertHandle(io, source, { root: sourceDir });
        await u.writeExactly(target.handle, current, bytes);
        await target.handle.sync();
        const after = await u.assertHandle(io, target, { snapshot: false, root: archiveDir });
        requireValue(Number(after.size) === current + length, 'FILE_CHANGED', '回退proof归档目标在续写后变化，保留现场');
        target.snapshot = u.statState(after);
        current += length;
      }
      const targetSha = await u.hashHandle(target.handle, file.size);
      await u.assertHandle(io, target, { root: archiveDir });
      requireValue(targetSha === file.sha256, 'RECOVERY_CONFLICT', '回退proof归档目标摘要与源不符，保留现场');
      const sourceShaAfter = await u.hashHandle(source.handle, file.size);
      await u.assertHandle(io, source, { root: sourceDir });
      requireValue(sourceShaAfter === file.sha256, 'RECOVERY_CONFLICT', '回退proof源文件在续写期间变化，保留现场');
      await directory(archiveDir, archiveIdentity);
      if (sourceIdentity) await directory(sourceDir, sourceIdentity);
      return { complete: true, size: file.size, identity: target.identity };
    } finally {
      await source.handle.close().catch(() => {});
      if (target) await target.handle.close().catch(() => {});
    }
  }

  async function inspectProofArchiveSubset(archiveDir, files, sourceDir) {
    const rootStat = await proofCopyLstat(archiveDir);
    if (!rootStat) return { exists: false, identity: null, present: new Set(), partials: new Map() };
    requireValue(rootStat.isDirectory() && !rootStat.isSymbolicLink(), 'RECOVERY_CONFLICT', '回退proof归档目录必须是普通目录，保留现场');
    const before = await directory(archiveDir);
    const { byPath, directories } = proofCopyLayout(files);
    const present = new Set();
    const partials = new Map();
    async function walk(current, prefix = '') {
      for (const name of (await io.readdir(current)).sort()) {
        const relative = prefix ? `${prefix}/${name}` : name;
        const file = path.join(current, name);
        u.within(archiveDir, file);
        const stat = await io.lstat(file, { bigint: true });
        if (stat.isDirectory()) {
          requireValue(!stat.isSymbolicLink(), 'RECOVERY_CONFLICT', '回退proof归档含链接目录，保留现场');
          requireValue(directories.has(relative), 'RECOVERY_CONFLICT', '回退proof归档含额外目录，保留现场');
          await u.assertPath(io, file, { directory: true, ...(nativeAuthority ? {} : { root: archiveDir }) });
          await walk(file, relative);
        } else if (stat.isFile()) {
          requireValue(!stat.isSymbolicLink(), 'RECOVERY_CONFLICT', '回退proof归档含链接文件，保留现场');
          requireValue(stat.nlink === 1n, 'RECOVERY_CONFLICT', '回退proof归档文件必须是单硬链接，保留现场');
          const spec = byPath.get(relative);
          requireValue(spec, 'RECOVERY_CONFLICT', '回退proof归档含未知对象，保留现场');
          if (stat.size === BigInt(spec.size)) {
            const archived = await core.fileHash(io, file, archiveDir);
            requireValue(archived.identity === u.statIdentity(stat), 'FILE_CHANGED', '回退proof归档文件在检查期间变化，保留现场');
            requireValue(archived.size === spec.size && archived.sha256 === spec.sha256, 'RECOVERY_CONFLICT', '回退proof归档与源不符');
            present.add(relative);
          } else {
            requireValue(stat.size < BigInt(spec.size), 'RECOVERY_CONFLICT', '回退proof归档目标超出认证长度，保留现场');
            requireValue(sourceDir, 'RECOVERY_CONFLICT', '回退proof归档部分文件缺少源目录，保留现场');
            const checked = await proofCopyResume(sourceDir, null, spec, archiveDir, before.identity, false);
            requireValue(checked.size === Number(stat.size) && checked.identity === u.statIdentity(stat), 'FILE_CHANGED', '回退proof归档部分文件在检查期间变化，保留现场');
            partials.set(relative, { size: Number(stat.size), identity: checked.identity });
          }
        } else {
          requireValue(false, 'RECOVERY_CONFLICT', '回退proof归档含非普通对象，保留现场');
        }
      }
    }
    await walk(archiveDir);
    await directory(archiveDir, before.identity);
    return { exists: true, identity: before.identity, present, partials };
  }

  async function ensureProofCopyDirectory(dir, root, isRoot = false) {
    if (!isRoot) u.within(root, dir);
    const before = await proofCopyLstat(dir);
    if (before) {
      requireValue(before.isDirectory() && !before.isSymbolicLink(), 'RECOVERY_CONFLICT', 'proof归档路径必须是普通目录，保留现场');
      if (!isRoot) await u.assertPath(io, dir, { directory: true, ...(nativeAuthority ? {} : { root }) });
      return;
    }
    try {
      if (nativeAuthority) {
        requireValue(nativeContext && typeof nativeContext.createOwnedDirectory === 'function', 'NATIVE_ACL_REQUIRED', 'proof归档目录必须由原生受信ACL创建');
        await nativeContext.createOwnedDirectory(dir);
      } else await io.mkdir(dir, { mode: 0o700 });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    const after = await io.lstat(dir, { bigint: true });
    requireValue(after.isDirectory() && !after.isSymbolicLink(), 'RECOVERY_CONFLICT', 'proof归档目录创建结果不是普通目录，保留现场');
    if (!isRoot) await u.assertPath(io, dir, { directory: true, ...(nativeAuthority ? {} : { root }) });
  }
  async function archiveProofCopies(sourceDir, sourceIdentity, files, archiveDir) {
    await directory(sourceDir, sourceIdentity);
    await exactTree(sourceDir, files, sourceIdentity, [], 'preserved-history');
    const archive = await inspectProofArchiveSubset(archiveDir, files, sourceDir);
    let archiveIdentity, present, partials;
    if (archive.exists) {
      archiveIdentity = archive.identity;
      present = archive.present;
      partials = archive.partials;
      await directory(archiveDir, archiveIdentity);
    } else {
      await ensureProofCopyDirectory(archiveDir, archiveDir, true);
      const created = await inspectProofArchiveSubset(archiveDir, files, sourceDir);
      requireValue(created.exists, 'RECOVERY_CONFLICT', 'proof归档目录创建后不可见，保留现场');
      archiveIdentity = created.identity;
      present = created.present;
      partials = created.partials;
    }
    for (const file of files) {
      await directory(archiveDir, archiveIdentity);
      const parts = file.path.split('/');
      let parent = archiveDir;
      for (let index = 0; index < parts.length - 1; index += 1) {
        parent = path.join(parent, parts[index]);
        await ensureProofCopyDirectory(parent, archiveDir);
      }
      const from = path.join(sourceDir, ...parts), to = path.join(archiveDir, ...parts);
      u.within(sourceDir, from);
      u.within(archiveDir, to);
      const target = await proofCopyLstat(to);
      if (target) {
        requireValue(target.isFile() && !target.isSymbolicLink(), 'RECOVERY_CONFLICT', '回退proof归档目标必须是普通文件，保留现场');
        requireValue(target.nlink === 1n, 'RECOVERY_CONFLICT', '回退proof归档目标必须是单硬链接文件，保留现场');
        if (present.has(file.path)) {
          requireValue(target.size === BigInt(file.size), 'FILE_CHANGED', '回退proof归档完整目标在检查期间变化，保留现场');
          continue;
        }
        const partial = partials.get(file.path);
        requireValue(partial, 'RECOVERY_CONFLICT', '回退proof归档目标未通过完整或前缀核验，保留现场');
        requireValue(target.size === BigInt(partial.size) && u.statIdentity(target) === partial.identity, 'FILE_CHANGED', '回退proof归档部分目标在检查期间变化，保留现场');
        await proofCopyResume(sourceDir, sourceIdentity, file, archiveDir, archiveIdentity, true);
        continue;
      }
      // core.copy(io, from, to, expected, fromRoot, toRoot); preserved-history is enforced by exactTree below.
      await core.copy(io, from, to, file, sourceDir, archiveDir);
    }
    await exactTree(sourceDir, files, sourceIdentity, [], 'preserved-history');
    await exactTree(archiveDir, files, archiveIdentity, [], 'preserved-history');
  }
  async function verifyJournalBytes(bytes, record, limit) {
    requireValue(Buffer.isBuffer(bytes) && bytes.length <= limit, 'BAD_JOURNAL', '回退journal超出固定界限');
    requireValue(same(await unpackBytes(bytes, limit), record), 'BAD_JOURNAL', '回退journal在归档前变化');
    return u.digest(bytes);
  }
  async function archiveRolledback(record) {
    requireValue(record && record.phase === 'rolledback' && record.rollbackForbidden === false, 'RECOVERY_REQUIRED', '只有已认证回退事务可归档；committed不得退役');
    const catalog = catalogs(true), bytes = validateJournal(record, catalog), names = rollbackArchiveNames(record.transactionId);
    requireValue(!await exists(record.backupDir), 'RECOVERY_CONFLICT', '回退后备份位置仍有目录，保留现场');
    await closed(true); await closed();
    let found = await layout(record);
    requireValue(found.source === 'live' && found.target !== 'live', 'RECOVERY_CONFLICT', '回退归档前程序位置不符');
    let targetDir = found.target === 'retired' ? names.dir : found.target === 'failed' ? record.failedDir : record.stageDir;
    await program(targetDir, 'target', record.targetFiles, record.identities.stage, bytes.targetBytes, false, 'preserved-history');
    const statusPath = path.join(state, startup.STATUS), catalogPath = path.join(state, startup.CATALOG);
    const journalBytes = await u.readSmall(io, journalPath, ROLLBACK_ARCHIVE_LIMIT), journalSha = await verifyJournalBytes(journalBytes, record, ROLLBACK_ARCHIVE_LIMIT);
    await inspectArchiveFile(statusPath, names.status, 16384, '回退启动收据', value => verifyRolledbackStatus(value, record));
    await inspectArchiveFile(catalogPath, names.catalog, 2097152, '回退完整目录', value => verifyRolledbackCatalog(value, record));
    await inspectProofFiles(paths.dataDir, record.identities.data, record.dataFiles, names.data);
    await inspectProofFiles(paths.profileDir, record.identities.profile, record.profileFiles, names.profile);
    const release = await acquireLock(record.transactionId, record.identities, false);
    try {
      await closed();
      found = await layout(record);
      targetDir = found.target === 'retired' ? names.dir : found.target === 'failed' ? record.failedDir : record.stageDir;
      await program(targetDir, 'target', record.targetFiles, record.identities.stage, bytes.targetBytes, false, 'preserved-history');
      const again = await u.readSmall(io, journalPath, ROLLBACK_ARCHIVE_LIMIT);
      requireValue(u.digest(again) === journalSha && same(await unpackBytes(again, ROLLBACK_ARCHIVE_LIMIT), record), 'FILE_CHANGED', '回退journal在归档期间变化');
      await inspectArchiveFile(statusPath, names.status, 16384, '回退启动收据', value => verifyRolledbackStatus(value, record));
      await inspectArchiveFile(catalogPath, names.catalog, 2097152, '回退完整目录', value => verifyRolledbackCatalog(value, record));
      await inspectProofFiles(paths.dataDir, record.identities.data, record.dataFiles, names.data);
      await inspectProofFiles(paths.profileDir, record.identities.profile, record.profileFiles, names.profile);
      await archiveProofCopies(paths.dataDir, record.identities.data, record.dataFiles, names.data);
      await archiveProofCopies(paths.profileDir, record.identities.profile, record.profileFiles, names.profile);
      await archiveVerifiedFile(statusPath, names.status, 16384, '回退启动收据', record.identities.state, value => verifyRolledbackStatus(value, record));
      await archiveVerifiedFile(catalogPath, names.catalog, 2097152, '回退完整目录', record.identities.state, value => verifyRolledbackCatalog(value, record));
      if (targetDir !== names.dir) {
        requireValue(!await exists(names.dir), 'RECOVERY_CONFLICT', '回退目标归档目录已存在但目标仍在原位置');
        await directory(targetDir, record.identities.stage);
        await directory(root, record.identities.root);
        await io.rename(targetDir, names.dir);
        requireValue(!await exists(targetDir), 'RECOVERY_CONFLICT', '回退目标归档后原位置仍存在');
      }
      await directory(names.dir, record.identities.stage);
      await program(names.dir, 'target', record.targetFiles, record.identities.stage, bytes.targetBytes, false, 'preserved-history');
      await archiveVerifiedFile(journalPath, names.journal, ROLLBACK_ARCHIVE_LIMIT, '回退journal', record.identities.state, async value => {
        requireValue(u.digest(value) === journalSha && same(await unpackBytes(value, ROLLBACK_ARCHIVE_LIMIT), record), 'BAD_JOURNAL', '回退journal归档认证不符');
      });
      return { transactionId: record.transactionId, sourceVersion: record.sourceVersion, targetVersion: record.targetVersion };
    } finally { await release(); }
  }
  async function verifyArchivedRollback(record, names, journalBytes) {
    requireValue(record && record.phase === 'rolledback' && record.rollbackForbidden === false, 'RECOVERY_REQUIRED', '归档记录不是回退事务');
    const catalog = catalogs(true), bytes = validateJournal(record, catalog);
    await artifactTree(catalog.target, record.identities.artifact);
    await program(names.dir, 'target', record.targetFiles, record.identities.stage, bytes.targetBytes, false, 'preserved-history');
    await verifyRolledbackStatus(await u.readSmall(io, names.status, 16384), record);
    await verifyRolledbackCatalog(await u.readSmall(io, names.catalog, 2097152), record);
    await exactTree(names.data, record.dataFiles, null, [], 'preserved-history');
    await exactTree(names.profile, record.profileFiles, null, [], 'preserved-history');
    const archivedJournal = await u.readSmall(io, names.journal, ROLLBACK_ARCHIVE_LIMIT);
    requireValue(archivedJournal.equals(journalBytes) && same(await unpackBytes(archivedJournal, ROLLBACK_ARCHIVE_LIMIT), record), 'BAD_JOURNAL', '回退归档journal认证不符');
    const liveIdentity = (await directory(install)).identity;
    if (liveIdentity === record.identities.source) { await program(install, 'source', record.sourceFiles, record.identities.source, bytes.sourceBytes, false, 'preserved-history'); return true; }
    return false;
  }
  async function verifyArchivedRollbacks() {
    const namesInState = await io.readdir(state), archived = new Map();
    for (const name of namesInState) {
      if (!name.startsWith('journal-rolledback-')) continue;
      requireValue(name.endsWith('.json'), 'RECOVERY_REQUIRED', '归档journal名称无效');
      const id = name.slice('journal-rolledback-'.length, -'.json'.length);
      requireValue(u.UUID.test(id), 'RECOVERY_REQUIRED', '归档journal事务ID无效');
      const file = path.join(state, name), bytes = await u.readSmall(io, file, ROLLBACK_ARCHIVE_LIMIT), record = await unpackBytes(bytes, ROLLBACK_ARCHIVE_LIMIT);
      requireValue(record && record.transactionId === id, 'BAD_JOURNAL', '归档journal事务ID不符');
      const archive = rollbackArchiveNames(id);
      requireValue(u.samePath(archive.journal, file), 'RECOVERY_REQUIRED', '归档journal路径不能被选择');
      archived.set(id, { record, names: archive, journalBytes: bytes });
    }
    const proofPrefixes = ['status-rolledback-', 'catalog-rolledback-', 'data-proof-rolledback-', 'profile-proof-rolledback-'];
    for (const name of namesInState) for (const prefix of proofPrefixes) if (name.startsWith(prefix)) {
      const id = (name.endsWith('.json') ? name.slice(0, -5) : name).slice(prefix.length);
      requireValue(u.UUID.test(id) && archived.has(id), 'RECOVERY_REQUIRED', '存在无认证journal的归档证据，保留现场');
    }
    const retired = [];
    for (const name of await io.readdir(root)) if (name.startsWith(transactionPrefix + 'retired-')) {
      const id = name.slice((transactionPrefix + 'retired-').length);
      requireValue(u.UUID.test(id), 'RECOVERY_REQUIRED', '退役目录名称无效');
      retired.push(id);
    }
    for (const id of retired) requireValue(archived.has(id), 'RECOVERY_REQUIRED', '存在未认证的退役目录，保留现场');
    for (const id of archived.keys()) requireValue(retired.includes(id), 'RECOVERY_CONFLICT', '归档journal缺少退役目标目录');
    let sourceMatched = false;
    for (const id of retired) sourceMatched = (await verifyArchivedRollback(archived.get(id).record, archived.get(id).names, archived.get(id).journalBytes)) || sourceMatched;
    if (archived.size > 0) requireValue(sourceMatched, 'RECOVERY_CONFLICT', '当前安装不是任何已认证回退事务的原程序位置');
    requireValue(!await exists(path.join(state, startup.STATUS)) && !await exists(path.join(state, startup.CATALOG)), 'RECOVERY_REQUIRED', '存在无journal的启动收据，保留现场');
    return { count: archived.size, ids: [...archived.keys()].sort() };
  }
  async function move(record, from, to, which, changed, recovery = true) {
    await layout(record, recovery); await closed(); await layout(record, recovery);
    requireValue(!await exists(to), 'RECOVERY_CONFLICT', '整树rename目标必须不存在');
    const identity = record.identities[which === 'source' ? 'source' : 'stage'];
    await directory(from, identity); await directory(root, record.identities.root);
    await io.rename(from, to); changed?.();
    requireValue(!await exists(from), 'RECOVERY_CONFLICT', '整树rename后原位置仍存在'); await directory(to, identity); await layout(record, recovery);
  }
  async function restart(record, which) {
    await layout(record, which !== 'target', which !== 'target'); await closed();
    if (which === 'target') {
      requireValue(record.phase === 'committed' && record.rollbackForbidden === true && same(await readJournal(), record), 'COMMIT_READBACK_FAILED', '目标启动前必须读回完整提交');
      const gate = startup.readEngineStartupGate({ installDir: install, installedRole: role, programVersion: trust.target.programVersion, trustedPublicKey: trust.publisherPublicKey });
      requireValue(gate.blocked === false && gate.transactionId === record.transactionId, 'ENGINE_STARTUP_BLOCKED', gate.message || '目标启动收据尚未就绪');
    } else {
      requireValue(record.rollbackForbidden === false, 'ROLLBACK_FORBIDDEN', '已提交目标不可启动旧程序');
      const launching = { ...record, version: journalVersion, runtimeWrites: true };
      await save(launching); Object.assign(record, launching);
    }
    const result = await barrier.restart({ executablePath: launch.executablePath, args: launch.args.slice(), role });
    requireValue(result?.started === true, which === 'target' ? 'TARGET_RESTART_FAILED' : 'SOURCE_RESTART_FAILED', '完整程序尚未确认按原角色启动，保留已提交程序');
    await layout(record, which !== 'target', false);
  }
  async function rollback(record) {
    requireValue(record.phase !== 'committed' && record.rollbackForbidden === false, 'ROLLBACK_FORBIDDEN', '已提交或可能已启动170，禁止回退旧代码');
    // Authenticate and validate every input before the first rollback rename.
    await layout(record); await closed(true);
    if (record.runtimeWrites === true) {
      // Only an authorized startup may advance the data baseline. Stop it
      // normally first, retaining all business/profile writes and checkpointing.
      const data = await snapshot(paths.dataDir), profile = await snapshot(paths.profileDir);
      requireValue(data.identity === record.identities.data && profile.identity === record.identities.profile, 'DIRECTORY_CHANGED', '关闭后资料目录物理身份已变化');
      const stopped = { ...record, version: journalVersion, runtimeWrites: false, dataFiles: data.files, profileFiles: profile.files };
      await closed(); await layout(stopped); await save(stopped); Object.assign(record, stopped);
    }
    let found = await layout(record);
    record.phase = 'rolling-back'; await save(record);
    if (found.target === 'live') {
      await move(record, install, record.failedDir, 'target');
      await save(record); found = await layout(record);
    }
    if (found.source === 'backup') { await move(record, record.backupDir, install, 'source'); await save(record); }
    await layout(record); record.phase = 'rolledback'; await save(record); await layout(record);
    await restart(record, 'source');
  }
  function rollbackFailure(cause) { const error = new Error('完整引擎候选回退未完成，已保留原目录和事务；请先恢复后再启动。'); error.code = 'ROLLBACK_FAILED'; error.cause = cause; return error; }
  async function newStage(catalog, recordPaths, stageAuthority) {
    requireValue(exact(stageAuthority, ['transactionId','sourceIdentity','sourceCatalogSha256','targetCatalogSha256','sid']) && u.UUID.test(stageAuthority.transactionId || '') && stageIdentityValue(stageAuthority.sourceIdentity) && SHA.test(stageAuthority.sourceCatalogSha256 || '') && SHA.test(stageAuthority.targetCatalogSha256 || '') && typeof stageAuthority.sid === 'string' && stageAuthority.sid.length > 0 && stageAuthority.sid.length <= 1024, 'BAD_STAGE_INTENT', 'stage创建意图输入不完整');
    const transactionId = stageAuthority.transactionId;
    requireValue(same(recordPaths, transactionPaths(transactionId)), 'BAD_STAGE_INTENT', 'stage路径必须由事务UUID派生');
    for (const file of Object.values(recordPaths)) requireValue(!await exists(file), 'RECOVERY_CONFLICT', '新事务目录必须CreateNew');
    requireValue(!await exists(orphanStageDir(transactionId)), 'RECOVERY_CONFLICT', '隔离目录必须不存在');
    requireValue(!await exists(stageIntentFile(transactionId)) && !await exists(archivedStageIntentFile(transactionId)), 'RECOVERY_CONFLICT', 'stage创建意图必须CreateNew');
    const parent = await directory(root), stateDir = await directory(state);
    await directory(install, stageAuthority.sourceIdentity);
    const nativeEvidence = nativeAuthority ? await nativeContext?.captureStageEvidence?.() : null;
    requireValue(!nativeAuthority || nativeEvidence, 'NATIVE_EVIDENCE_REQUIRED', '原生stage缺少恢复元数据');
    let intent = { version: 1, purpose: STAGE_INTENT_PURPOSE, transactionId, parentDir: root, stageDir: recordPaths.stageDir, quarantineDir: orphanStageDir(transactionId), parentIdentity: parent.identity, stateIdentity: stateDir.identity, sourceIdentity: stageAuthority.sourceIdentity, sourceCatalogSha256: stageAuthority.sourceCatalogSha256, targetCatalogSha256: stageAuthority.targetCatalogSha256, role, sid: stageAuthority.sid, stageIdentity: null, disposition: 'pending', nativeEvidence };
    const active = stageIntentFile(transactionId);
    await writeStageIntent(active, intent);
    let stageExists = false, createdIdentity = null;
    try {
      if (nativeAuthority) await nativeContext.createOwnedDirectory(recordPaths.stageDir); else await io.mkdir(recordPaths.stageDir, { mode: 0o700 });
      stageExists = await exists(recordPaths.stageDir);
      requireValue(stageExists, 'STAGE_CREATE_FAILED', 'stage目录创建未落盘');
      createdIdentity = (await directory(recordPaths.stageDir)).identity;
      intent = { ...intent, stageIdentity: createdIdentity, disposition: 'bound' };
      await writeStageIntent(active, intent);
      for (const spec of catalog.files) {
        await core.mkdirs(io, recordPaths.stageDir, path.posix.dirname(spec.path) === '.' ? '' : path.posix.dirname(spec.path));
        await core.copy(io, path.join(artifact, ...spec.path.split('/')), path.join(recordPaths.stageDir, ...spec.path.split('/')), spec, artifact, recordPaths.stageDir);
        await directory(recordPaths.stageDir, createdIdentity);
      }
      if(nativeAuthority)for(const spec of sourceMutableDirectories.filter(spec=>!approvedEmptyDirectory(spec.path)))await core.mkdirs(io,recordPaths.stageDir,spec.path);
      for(const spec of targetMutableFiles){await core.mkdirs(io,recordPaths.stageDir,path.posix.dirname(spec.path)==='.'?'':path.posix.dirname(spec.path));await core.copy(io,path.join(install,...spec.path.split('/')),path.join(recordPaths.stageDir,...spec.path.split('/')),spec,install,recordPaths.stageDir);}
      const marker = Buffer.from(JSON.stringify({ version: 1, product: core.PRODUCT, programVersion: trust.target.programVersion, role, installationDir: install }));
      const opened = await u.openChecked(io, path.join(recordPaths.stageDir, MARKER), 'wx+', { missing: true, root: recordPaths.stageDir });
      try { await u.writeExactly(opened.handle, 0, marker); await opened.handle.sync(); await u.assertHandle(io, opened, { snapshot: false, root: recordPaths.stageDir }); } finally { await opened.handle.close(); }
      const files = rows([...catalog.files,...targetMutableFiles, markerRow(marker)]);
      await program(recordPaths.stageDir, 'target', files, createdIdentity, marker, false, 'preserved-history');
      return { identity: createdIdentity, marker, files, intent };
    } catch (error) {
      if (!stageExists) { try { stageExists = await exists(recordPaths.stageDir); } catch { /* keep */ } }
      let persisted = null; try { persisted = await readStageIntent(active); } catch { persisted = null; }
      if (stageExists && createdIdentity && persisted && ['bound','quarantined','journal'].includes(persisted.disposition) && persisted.stageIdentity === createdIdentity) {
        try { await preserveStageIntent(persisted); } catch (preserve) { error.stagePreserveError = preserve; }
      } else if (stageExists && (!persisted || persisted.disposition === 'pending')) {
        error.code = 'STAGE_OWNERSHIP_UNPROVEN';
        error.message = 'stage目录已落盘但身份绑定未持久化；按窄窗口停止并保留，不伪造认证';
      } else if (!stageExists && (!persisted || persisted.disposition === 'pending') && await exists(active)) {
        try { await archiveMissingStageIntent(persisted || intent); } catch (preserve) { error.stageArchiveError = preserve; }
      } else if (!stageExists && createdIdentity && persisted && persisted.stageIdentity === createdIdentity) {
        error.code = 'STAGE_INTENT_CONFLICT';
        error.message = '已绑定stage目录在异常处理时缺失，保留认证并停止';
      }
      throw error;
    }
  }
  async function installCandidate() {
    if (busy) u.fail('BUSY', '此候选助手已有事务'); busy = true;
    let release, record, moved = false, committed = false, retain = false;
    try {
      const catalog = catalogs(), fixed = await fixedDirectories(); await artifactTree(catalog.target, fixed.artifact);
      let existing = await readJournal();
      if (existing && existing.phase === 'rolledback') {
        await archiveRolledback(existing);
        existing = null;
      }
      if (!existing) await verifyArchivedRollbacks();
      if (existing) {
        await layout(existing);
        requireValue(existing.phase === 'committed', 'RECOVERY_REQUIRED', '旧事务须先明确恢复；不覆盖已保留的失败现场');
        const gate = startup.readEngineStartupGate({ installDir: install, installedRole: role, programVersion: trust.target.programVersion, trustedPublicKey: trust.publisherPublicKey });
        requireValue(gate.blocked === false && gate.transactionId === existing.transactionId, 'RECOVERY_REQUIRED', '已提交安装的启动收据缺失或异常，请走认证恢复入口');
        return { installed: false, alreadyInstalled: true, version: trust.target.programVersion, engineVersion: trust.target.engineVersion, role, backupDir: existing.backupDir, restarted: false, candidateOnly: true };
      }
      const sourceMarker = await originalMarker();
      const sourceFiles = originalRows(catalog.source,sourceMarker), sourceIdentity = await program(install, 'source', sourceFiles, null, sourceMarker, false, 'preserved-history');
      if (sourceMarker === null) confirmLegacy(sourceIdentity);
      const transactionId = bridgeSource?.operationId||crypto.randomUUID(), recordPaths = transactionPaths(transactionId);
      release = await acquireLock(transactionId, fixed, true); await closed(true);
      requireValue(!await readJournal(), 'RECOVERY_REQUIRED', '持锁后出现事务记录，停止且不修改stage');
      await recoverStageIntentsLocked();
      requireValue(!(await io.readdir(root)).some(name => ['stage-','backup-','failed-'].some(kind => name.startsWith(transactionPrefix + kind))), 'RECOVERY_REQUIRED', '存在未绑定的旧事务目录，请先保留并核对');
      if (nativeAuthority) await nativeContext.prepare();
      const data = await snapshot(paths.dataDir), profile = await snapshot(paths.profileDir); await closed();
      const staged = await newStage(catalog.target, recordPaths, { transactionId, sourceIdentity, sourceCatalogSha256: trust.source.catalogSha256, targetCatalogSha256: trust.target.catalogSha256, sid: nativeContext?.sid || startup.namespace() });
      record = { version: journalVersion, purpose: PURPOSE, transactionId, phase: 'prepared', runtimeWrites: false, rollbackForbidden: false, paths, role, publisherPublicKeySha256: trust.publisherPublicKeySha256, sourceCatalogSha256: trust.source.catalogSha256, targetCatalogSha256: trust.target.catalogSha256, sourceVersion: trust.source.programVersion, targetVersion: trust.target.programVersion, sourceEngineVersion: trust.source.engineVersion, targetEngineVersion: trust.target.engineVersion, identities: { ...fixed, source: sourceIdentity, stage: staged.identity }, sourceFiles, targetFiles: staged.files, sourceActivation: sourceMarker === null ? null : sourceMarker.toString('base64'), targetActivation: staged.marker.toString('base64'), dataFiles: data.files, profileFiles: profile.files, ...recordPaths };
      if (nativeAuthority) { record.sourceMutableFiles = sourceMutableFiles; record.sourceMutableDirectories = sourceMutableDirectories;record.targetMutableFiles=targetMutableFiles;record.sourceEvidence=bridgeSource?.descriptor||null; }
      await save(record); await adoptStageIntent(staged.intent); await writeStartup(record, 'prepared'); await layout(record, false); await closed(); await layout(record, false);
      await move(record, install, record.backupDir, 'source', () => { moved = true; }, false);
      record.phase = 'old-renamed'; await save(record); await checkpoint('old-tree-renamed', u.freeze(JSON.parse(JSON.stringify(record))));
      catalogs(); await move(record, record.stageDir, install, 'target', undefined, false);
      record.phase = 'new-published'; await save(record); await checkpoint('new-tree-published', u.freeze(JSON.parse(JSON.stringify(record))));
      // A failed fsync/readback cannot prove that a commit did not persist.
      // Retain the target and let authenticated recovery classify the disk.
      committed = true; await commit(record);
      if (!deferred) await restart(record, 'target');
      return { installed: true, committed: true, rollbackForbidden: true, version: trust.target.programVersion, engineVersion: trust.target.engineVersion, role, restarted: !deferred, backupDir: record.backupDir, transactionId };
    } catch (error) {
      if (error.code === 'SIMULATED_POWER_LOSS') { retain = true; throw error; }
      if (committed) { retain = true; error.rollbackForbidden = true; error.committed = record?.phase === 'committed'; throw error; }
      if (record && !moved && await exists(record.backupDir)) moved = true;
      if (record && moved && !committed) {
        try { await rollback(record); }
        catch (recovery) {
          retain = true;
          try { record.phase = 'rollback-failed'; await save(record); } catch { /* Preserve earlier authenticated state and the original error. */ }
          throw rollbackFailure(recovery);
        }
      }
      throw error;
    } finally { try { if (release && !retain) await release(); } finally { busy = false; } }
  }
  async function recoverCandidate(request = {}) {
    requireValue(exact(request, []) || exact(request, ['restartTarget']) && request.restartTarget === true, 'BAD_OPTIONS', '恢复只接受明确的目标重启意图');
    if (busy) u.fail('BUSY', '此候选助手已有事务'); busy = true;
    let release, retain = false;
    try {
      const catalog = catalogs(true), fixed = await fixedDirectories(); await artifactTree(catalog.target, fixed.artifact);
      let record = await readJournal();
      if (!record) {
        const activeStageIds = await listActiveStageIntentIds();
        let retainedStages = 0;
        if (activeStageIds.length > 0) {
          release = await acquireLock(activeStageIds[0], fixed, false);
          const live = await readJournal();
          requireValue(!live, 'RECOVERY_REQUIRED', '持锁后出现事务记录，停止且不修改stage');
          retainedStages = await recoverStageIntentsLocked();
          await release(); release = null;
        } else {
          retainedStages = await verifyRetainedStageArchives();
        }
        const archivedRollbacks = await verifyArchivedRollbacks();
        const stateNames = await io.readdir(state);
        if (retainedStages > 0 || archivedRollbacks.count > 0) {
          await retainedStageStateAllowed(stateNames, await listArchivedStageIntents(), archivedRollbacks.ids);
        }
        requireValue(archivedRollbacks.count > 0 || retainedStages > 0 || stateNames.length === 0, 'BAD_JOURNAL', '已有认证状态但事务记录缺失，拒绝重建');
        return { recovered: false, phase: 'none', archivedRollbacks: archivedRollbacks.count, retainedStages };
      }
      // No stage rename or journal rewrite precedes these read-only checks.
      await layout(record);
      release = await acquireLock(record.transactionId, record.identities, false);
      const live = await readJournal();
      requireValue(live && live.transactionId === record.transactionId, 'FILE_CHANGED', '持锁后事务记录变化，停止且不修改stage');
      record = live;
      await recoverStageIntentsLocked();
      await layout(record);
      if (record.phase === 'committed') {
        await writeStartup(record, 'committed');
        let restarted = false;
        if (request.restartTarget) {
          const receipt = deferred ? await requiredStartup(record) : null;
          const businessReleased = deferred && receipt.businessReleased === true;
          let running = false;
          try {
            const isClosed = await barrier.assertClosed({ ...launch, args: launch.args.slice() });
            requireValue(typeof isClosed === 'boolean', 'BAD_LIFECYCLE', '目标进程状态未确认');
            running = !isClosed;
          } catch (error) {
            if (error.code === 'PROGRAM_IN_USE') running = true;
            else throw error;
          }
          if (running) requireValue(!deferred || businessReleased, 'PROGRAM_IN_USE', '业务尚未放行但目标进程已在运行，拒绝当作已释放成功');
          if (nativeAuthority) await nativeContext.revalidate();
          if (!running) {
            if (deferred && !businessReleased) await writeStartup(record, 'committed', true);
            await restart(record, 'target');
            restarted = true;
          }
        }
        return { recovered: true, completed: true, phase: 'committed', rollbackForbidden: true, version: trust.target.programVersion, engineVersion: trust.target.engineVersion, role, restarted, backupDir: record.backupDir };
      }
      if (record.phase === 'rolledback') return { recovered: true, rolledBack: true, phase: 'rolledback', version: trust.source.programVersion, engineVersion: trust.source.engineVersion, role, restarted: false, candidateOnly: true };
      try { await rollback(record); }
      catch (error) {
        retain = true;
        try { record.phase = 'rollback-failed'; await save(record); } catch { /* Keep authenticated prior evidence. */ }
        throw rollbackFailure(error);
      }
      return { recovered: true, rolledBack: true, phase: 'rolledback', version: trust.source.programVersion, engineVersion: trust.source.engineVersion, role, restarted: true, candidateOnly: true, formalDeploymentAuthorized: false };
    } finally { try { if (release && !retain) await release(); } finally { busy = false; } }
  }
  async function requiredStartup(record) {
    let bytes;
    try { bytes = await u.readSmall(io,path.join(state,startup.STATUS),16384); }
    catch (error) { if (error.code !== 'ENOENT') throw error; u.fail('STARTUP_RECEIPT_REQUIRED','启动收据缺失，放行入口不能重建；请走认证恢复'); }
    const value = startup.decode(bytes,await readKey()), expected = await startupRecord(record,'committed');
    requireValue(value.version === 2 && typeof value.businessReleased === 'boolean','BAD_STARTUP_RECEIPT','deferred收据版本或状态错误');
    expected.businessReleased = value.businessReleased;
    requireValue(same(value,expected),'BAD_STARTUP_RECEIPT','deferred收据与实际提交不符');
    return value;
  }
  async function assertStartupHeld() {
    requireValue(deferred,'BAD_LIFECYCLE','只有受信deferred事务可证明阻断');
    const record = await readJournal();requireValue(record?.phase === 'committed' && record.rollbackForbidden === true,'RECOVERY_REQUIRED','完整提交尚未就绪');
    await layout(record,true,false);const value = await requiredStartup(record);
    requireValue(value.businessReleased === false,'STARTUP_ALREADY_RELEASED','业务已持久放行，不能声称仍被阻断');
    const decision = startup.readEngineStartupGate({installDir:install,programVersion:trust.target.programVersion,installedRole:role,trustedPublicKey:trust.publisherPublicKey});
    requireValue(decision.blocked === true && decision.code === 'ENGINE_STARTUP_HELD','BAD_STARTUP_RECEIPT','持久启动阻断无法独立核验');
    await closed();
    requireValue(same(await readJournal(),record) && (await requiredStartup(record)).businessReleased === false,'FILE_CHANGED','进程核验期间提交或阻断状态变化');
    return {held:true,transactionId:record.transactionId,phase:'committed',role,receiptSha256:u.digest(await u.readSmall(io,path.join(state,startup.STATUS),16384))};
  }
  async function startCommitted() {
    requireValue(deferred,'BAD_LIFECYCLE','独立放行只允许受信deferred事务');
    if (busy) u.fail('BUSY','完整目录事务仍在处理');busy = true;
    let release, retain = false, record;
    try {
      catalogs(true);await fixedDirectories();record = await readJournal();
      requireValue(record?.phase === 'committed' && record.rollbackForbidden === true,'RECOVERY_REQUIRED','只有完整提交可放行业务');
      await layout(record,true,false);const value = await requiredStartup(record);
      release = await acquireLock(record.transactionId,record.identities,false);
      const lockedRecord = await readJournal(), lockedValue = await requiredStartup(lockedRecord);
      requireValue(same(lockedRecord,record) && same(lockedValue,value),'FILE_CHANGED','助手锁内认证记录或启动收据已变化');
      if (lockedValue.businessReleased === true) {
        if (nativeAuthority) await nativeContext.revalidate();
        let running = false;
        try { const stopped = await barrier.assertClosed({ ...launch, args: launch.args.slice() }); requireValue(typeof stopped === 'boolean','BAD_LIFECYCLE','目标进程状态未确认'); running = !stopped; }
        catch (error) { if (error.code === 'PROGRAM_IN_USE') running = true; else throw error; }
        if (running) return {started:false,alreadyReleased:true,transactionId:record.transactionId,role,version:trust.target.programVersion};
        await restart(record,'target');
        return {started:true,alreadyReleased:true,transactionId:record.transactionId,role,version:trust.target.programVersion};
      }
      await closed(true);await assertStartupHeld();
      await writeStartup(record,'committed',true);await restart(record,'target');
      return {started:true,alreadyReleased:false,transactionId:record.transactionId,role,version:trust.target.programVersion};
    } catch (error) { if (error.code === 'SIMULATED_POWER_LOSS') retain = true; if (record?.phase === 'committed') { error.rollbackForbidden = true; error.committed = true; } throw error; }
    finally { try { if (release && !retain) await release(); } finally { busy = false; } }
  }
  return Object.freeze({ install: installCandidate, recover: recoverCandidate, assertStartupHeld, startCommitted,
    retireRolledBack: async record => {
      const current = record || await readJournal();
      requireValue(current && current.phase === 'rolledback' && current.rollbackForbidden === false, 'RECOVERY_REQUIRED', '只有已认证回退事务可归档；committed不得退役');
      return archiveRolledback(current);
    }
  });
}

function createDeferredEngineTreeRuntime170ForGuest(options) {
  startup.actualGuest();const capability = {};deferredCapabilities.add(capability);
  return createEngineTreeRuntime170(options,capability);
}

async function createDeferredBridgeEngineTreeRuntime170ForGuest(options,proofRequest){
  startup.actualGuest();
  requireValue(options&&options.fileSystem===undefined&&options.role==='employee'&&exact(proofRequest,['oldBinding','handoffFile','bridgeEntrySha256','publicationId']),'BAD_OPTIONS','Guest桥只能使用实际文件及明确证明，不接受权限布尔');
  const root=u.safeAbsolute(options.isolationRoot);requireValue(u.samePath(path.dirname(root),BASE)&&/^case-[A-Za-z0-9_-]{1,80}$/.test(path.basename(root)),'ISOLATION','Guest桥必须位于原固定case范围');
  requireValue(u.samePath(options.installationDir,path.join(root,'program'))&&u.samePath(options.profileDir,path.join(root,'profile'))&&u.samePath(proofRequest.handoffFile,path.join(root,'engine-bridge-handoff.json')),'ISOLATION','Guest桥安装、profile和交接路径不可任意映射');
  const bridge=require('./engine-bridge-source170.cjs'),proof=await bridge.inspectInstalledBridge({installationDir:options.installationDir,profileDir:options.profileDir,expectedProfileDir:options.profileDir,handoffFile:proofRequest.handoffFile,bridgeEntrySha256:proofRequest.bridgeEntrySha256,publicationId:proofRequest.publicationId,targetCatalogSha256:u.digest(Buffer.from(options.targetEnvelope.catalog)),oldBinding:proofRequest.oldBinding,publicKey:options.trust.publisherPublicKey,now:options.now});
  const capability={};guestBridgeContexts.set(capability,{bridgeSource:proof,sourceMutableFiles:proof.mutableFiles,sourceMutableDirectories:[],targetMutableFiles:proof.mutableFiles});deferredCapabilities.add(capability);
  const selected={...options,sourceEnvelope:proof.originalBinding.envelope,trust:{...options.trust,source:{programVersion:'1.7.0',engineVersion:'44.7.0',catalogSha256:proof.catalogSha256,allowedFiles:proof.programFiles.map(f=>f.path)}}};
  // This is the unchanged actualGuest file transaction boundary. A separate
  // audit adapter must supply real CIM/ACL/launch ports to claim native tests.
  return createEngineTreeRuntime170(selected,capability);
}

async function initializeFreshEngineReceipt170(options, nativeCapability) {
  const nativeAuthority = nativeCapabilities.has(nativeCapability);
  if (!nativeAuthority) startup.actualGuest();
  const allowed = ['installationDir','stateDir','role','envelope','trust','now','fileSystem'];
  requireValue(options && typeof options === 'object' && Object.keys(options).every(k => allowed.includes(k)), 'BAD_OPTIONS', 'fresh收据只能从固定受信安装流程初始化');
  const io = options.fileSystem || fs, now = options.now || Date.now, install = u.safeAbsolute(options.installationDir), state = u.safeAbsolute(options.stateDir), role = options.role, trust = options.trust;
  requireValue(typeof now === 'function' && ['host','employee'].includes(role) && u.samePath(state, startup.stateDirectory(install)), 'BAD_OPTIONS', 'fresh角色或独立状态目录未绑定');
  if (!nativeAuthority) {
    const root = path.dirname(install);
    requireValue(u.samePath(path.dirname(root), BASE) && /^case-[A-Za-z0-9_-]{1,80}$/.test(path.basename(root)) && path.basename(install) === 'program', 'ISOLATION', '测试初始化只允许实际Guest固定case');
  }
  requireValue(exact(trust, ['schemaVersion','purpose','publisherPublicKey','publisherPublicKeySha256','executableName','target']) && trust.schemaVersion === 1 && trust.purpose === 'xjy-engine-fresh170' && SHA.test(trust.publisherPublicKeySha256 || '') && u.safeRelative(trust.executableName) && !trust.executableName.includes('/') && /\.exe$/i.test(trust.executableName), 'BAD_TRUST', 'fresh完整引擎信任输入错误');
  requireValue(trust.publisherPublicKey?.type !== 'private' && !(typeof trust.publisherPublicKey === 'string' && trust.publisherPublicKey.includes('PRIVATE KEY')), 'BAD_PUBLIC_KEY', '只接受受审发行公钥');
  const publicKey = trust.publisherPublicKey?.type === 'public' ? trust.publisherPublicKey : crypto.createPublicKey(trust.publisherPublicKey);
  requireValue(publicKey.asymmetricKeyType === 'ed25519' && u.digest(publicKey.export({type:'spki',format:'der'})) === trust.publisherPublicKeySha256, 'BAD_PUBLIC_KEY', 'fresh发行公钥摘要不符');
  const target = trust.target;
  requireValue(exact(target, ['programVersion','engineVersion','catalogSha256','allowedFiles']) && target.programVersion === '1.7.0' && target.engineVersion === '44.9.0' && SHA.test(target.catalogSha256 || '') && Array.isArray(target.allowedFiles) && target.allowedFiles.length > 0 && target.allowedFiles.length <= 4096 && new Set(target.allowedFiles.map(x => String(x).toLowerCase())).size === target.allowedFiles.length && target.allowedFiles.every(x => enginePath(x, trust.executableName)), 'BAD_TRUST', 'fresh必须绑定完整170/44.9引擎与程序');
  for (const name of [trust.executableName,'version','ffmpeg.dll','icudtl.dat','resources.pak','snapshot_blob.bin','v8_context_snapshot.bin','locales/zh-CN.pak','resources/app.asar']) requireValue(target.allowedFiles.includes(name), 'BAD_TRUST', 'fresh完整引擎文件缺失');
  requireValue(exact(options.envelope, ['catalog','signature']) && typeof options.envelope.catalog === 'string' && u.digest(Buffer.from(options.envelope.catalog)) === target.catalogSha256, 'BAD_SIGNATURE', 'fresh完整目录摘要不符');
  const envelope = Object.freeze({catalog:options.envelope.catalog,signature:options.envelope.signature});
  const catalog = u.verifySignedCatalog(envelope, u.createTrustedUpdatePolicy({trustedPublicKey:publicKey,currentVersion:'1.7.0',allowedFiles:target.allowedFiles,platform:'win32',arch:'x64',now}));
  requireValue(catalog.version === '1.7.0' && catalog.files.length === target.allowedFiles.length, 'BAD_CATALOG', 'fresh目录身份或覆盖不完整');
  const installStat = await u.assertPath(io, install, {directory:true}), installIdentity = u.statIdentity(installStat);
  let activationBytes;
  try { activationBytes = await u.readSmall(io, path.join(install, MARKER), 4096); }
  catch (error) { if (error.code !== 'ENOENT') throw error; u.fail('BAD_ACTIVATION','fresh必须先由安装事务建立明确角色activation，收据不能补造'); }
  let activation;
  try { activation = JSON.parse(activationBytes); } catch { u.fail('BAD_ACTIVATION','fresh角色记录无效'); }
  requireValue(exact(activation, ['version','product','programVersion','role','installationDir']) && activation.version === 1 && activation.product === core.PRODUCT && activation.programVersion === '1.7.0' && activation.role === role && typeof activation.installationDir === 'string' && u.samePath(activation.installationDir, install), 'BAD_ACTIVATION', 'fresh明确角色与安装身份不符');
  const expected = rows([...catalog.files,{path:MARKER,size:activationBytes.length,sha256:u.digest(activationBytes)}]), tree = await core.inspectArtifactTree({artifactDir:install,fileSystem:io});
  requireValue(same(rows(tree.files), expected), 'TREE_CHANGED', 'fresh完整程序有缺失、额外文件或摘要变化');
  const directories = new Set();
  for (const spec of expected) { let name = path.posix.dirname(spec.path); while (name !== '.') { directories.add(name); name = path.posix.dirname(name); } }
  async function checkedDirectories(dir, prefix = '') {
    for (const name of await io.readdir(dir)) { const relative = prefix + name, file = path.join(dir,name), stat = await io.lstat(file,{bigint:true}); if (stat.isDirectory()) { requireValue(directories.has(relative), 'TREE_CHANGED', 'fresh含未声明目录'); await u.assertPath(io,file,{directory:true,root:install}); await checkedDirectories(file,relative+'/'); } }
  }
  await checkedDirectories(install);
  const pkg = await core.packageIdentity(io,path.join(install,'resources/app.asar'),install);
  requireValue(pkg.version === '1.7.0' && pkg.main === 'release-entry.cjs' && (await u.readSmall(io,path.join(install,'version'),64)).toString('utf8').trim() === '44.9.0', 'BAD_PROGRAM', 'fresh程序入口或引擎版本错误');
  const exe = await u.openChecked(io,path.join(install,trust.executableName),'r',{root:install});
  try { requireValue((await u.readExactly(exe.handle,0,2)).toString() === 'MZ','BAD_ENGINE','fresh引擎EXE头错误'); await u.assertHandle(io,exe,{root:install}); } finally { await exe.handle.close(); }
  requireValue(u.statIdentity(await u.assertPath(io,install,{directory:true})) === installIdentity,'DIRECTORY_CHANGED','fresh核验期间物理目录变化');
  // Every signature, full-tree and role check precedes key/receipt writes.
  const stateStat = await u.assertPath(io,state,{directory:true}), stateIdentity = u.statIdentity(stateStat), keyPath = path.join(state,'journal-key.bin'), journalPath = path.join(state,'journal.json'), statusPath = path.join(state,startup.STATUS), catalogPath = path.join(state,startup.CATALOG);
  const names = await io.readdir(state);let key, record;
  if (names.length === 0) {
    const opened = await u.openChecked(io,keyPath,'wx+',{missing:true,root:state});
    try { await u.writeExactly(opened.handle,0,crypto.randomBytes(32)); await opened.handle.sync(); await u.assertHandle(io,opened,{snapshot:false,root:state}); } finally { await opened.handle.close(); }
    key = await u.readSmall(io,keyPath,32);
    record = {version:1,purpose:'xjy-engine-fresh170',transactionId:crypto.randomUUID(),phase:'committed',rollbackForbidden:true,targetVersion:'1.7.0',targetEngineVersion:'44.9.0',role,installationDir:install,installationIdentity:installIdentity,stateIdentity,catalogSha256:target.catalogSha256,publisherPublicKeySha256:trust.publisherPublicKeySha256,osUserNamespace:startup.namespace()};
    const payload = JSON.stringify(record), raw = Buffer.from(JSON.stringify({payload,mac:crypto.createHmac('sha256',key).update(payload).digest('hex')}));
    await u.atomicWrite(io,catalogPath,JSON.stringify(envelope),state);await u.atomicWrite(io,journalPath,raw,state);
    requireValue((await u.readSmall(io,journalPath,16384)).equals(raw),'COMMIT_READBACK_FAILED','fresh提交读回不符');
  } else {
    requireValue(names.every(x => ['journal-key.bin','journal.json',startup.STATUS,startup.CATALOG].includes(x)), 'BAD_JOURNAL', 'fresh状态目录含未知恢复材料，不清理或重建');
    try { key = await u.readSmall(io,keyPath,32); const raw = JSON.parse(await u.readSmall(io,journalPath,16384)); requireValue(exact(raw,['payload','mac']) && typeof raw.payload === 'string' && SHA.test(raw.mac || '') && key.length === 32 && crypto.timingSafeEqual(crypto.createHmac('sha256',key).update(raw.payload).digest(),Buffer.from(raw.mac,'hex')), 'BAD_JOURNAL','fresh提交认证失败'); record = JSON.parse(raw.payload); }
    catch (error) { if (error.code === 'BAD_JOURNAL') throw error; u.fail('BAD_JOURNAL','fresh旧认证状态不完整，不补造密钥'); }
    const expectedRecord = {version:1,purpose:'xjy-engine-fresh170',transactionId:record.transactionId,phase:'committed',rollbackForbidden:true,targetVersion:'1.7.0',targetEngineVersion:'44.9.0',role,installationDir:install,installationIdentity:installIdentity,stateIdentity,catalogSha256:target.catalogSha256,publisherPublicKeySha256:trust.publisherPublicKeySha256,osUserNamespace:startup.namespace()};
    requireValue(u.UUID.test(record.transactionId || '') && same(record,expectedRecord), 'BAD_JOURNAL','fresh提交不属于此安装/角色/版本');
    requireValue((await u.readSmall(io,catalogPath,2097152)).equals(Buffer.from(JSON.stringify(envelope))),'BAD_SIGNATURE','fresh原完整目录变化');
  }
  requireValue(key.length === 32,'BAD_JOURNAL','fresh认证密钥长度错误');
  const value = {version:nativeAuthority?2:1,purpose:startup.PURPOSE,transactionId:record.transactionId,phase:'committed',rollbackForbidden:true,installationDir:install,installationIdentity:installIdentity,stateDir:state,stateIdentity,role,programVersion:'1.7.0',engineVersion:'44.9.0',catalogSha256:target.catalogSha256,publisherPublicKeySha256:trust.publisherPublicKeySha256,osUserNamespace:startup.namespace(),mode:'fresh',journalSha256:u.digest(await u.readSmall(io,journalPath,16384))};
  if(nativeAuthority)value.businessReleased=true;
  let old;
  try { old = await u.readSmall(io,statusPath,16384); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (old) requireValue(same(startup.decode(old,key),value),'RECOVERY_CONFLICT','fresh已有收据不符，拒绝覆盖');
  else await u.atomicWrite(io,statusPath,startup.envelope(value,key),state);
  requireValue(same(startup.decode(await u.readSmall(io,statusPath,16384),key),value),'STARTUP_READBACK_FAILED','fresh收据读回不符');
  const decision = startup.readEngineStartupGate({installDir:install,programVersion:'1.7.0',installedRole:role,trustedPublicKey:publicKey});
  requireValue(decision.blocked === false && decision.transactionId === record.transactionId,'ENGINE_STARTUP_BLOCKED',decision.message || 'fresh启动收据仍被阻断');
  return {committed:true,mode:'fresh',transactionId:record.transactionId,version:'1.7.0',engineVersion:'44.9.0',role,installationDir:install};
}

const NATIVE_PUBLISHER = '6e8b9cadb59aeb53f30d41f4471f70f644f0dfc7376ffb9d8a4c62defb98458c';
const NATIVE_POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
function physicalIdentity(stat) {
  requireValue(typeof stat.dev === 'bigint' && typeof stat.ino === 'bigint' && stat.dev >= 0n && stat.dev <= 0xffffffffn && stat.ino > 0n && stat.ino <= 0xffffffffffffffffn,'BAD_INSTALLATION_IDENTITY','无法确认Windows物理目录');
  return stat.dev.toString(16).padStart(8,'0')+':'+stat.ino.toString(16).padStart(16,'0');
}
async function readPackedText(file, name) {
  const opened = await u.openChecked(fs,file,'r');
  try {
    const stat = await u.assertHandle(fs,opened),first = await u.readExactly(opened.handle,0,8),size = first.readUInt32LE(4);
    requireValue(first.readUInt32LE(0) === 4 && size >= 8 && size <= 33554432 && BigInt(8+size) <= stat.size,'BAD_PROGRAM','目标ASAR头错误');
    const header = await u.readExactly(opened.handle,8,size),tree = JSON.parse(header.subarray(8,8+header.readUInt32LE(4)));let entry = tree;
    for (const part of name.split('/')) entry = entry?.files?.[part];
    requireValue(entry && !entry.link && !entry.unpacked && Number.isSafeInteger(entry.size) && entry.size > 0 && entry.size <= 1048576 && /^(0|[1-9]\d*)$/.test(entry.offset || ''),'BAD_PROGRAM','目标启动门必须在已签ASAR内');
    const offset = 8+size+Number(entry.offset);requireValue(Number.isSafeInteger(offset) && BigInt(offset+entry.size) <= stat.size,'BAD_PROGRAM','目标ASAR偏移错误');
    const bytes = await u.readExactly(opened.handle,offset,entry.size);await u.assertHandle(fs,opened);return bytes;
  } finally { await opened.handle.close(); }
}
async function nativeAcl(workerRoot, authority, targets, createPaths = []) {
  // Reuse the already-reviewed ACL policy bodies, not the GUI or an injected
  // boolean predicate. The signed helper manifest covers this exact PS file.
  const source = (await u.readSmall(fs,path.join(workerRoot,'delivery-approval/Prepare-Repeat-Approval-170.ps1'),131072)).toString('utf8').replace(/\r\n/g,'\n');
  const policy = source.slice(source.indexOf('function Test-TrustedWindowsRoot'),source.indexOf('function New-ApprovalAcl'));
  const creation = source.slice(source.indexOf('function New-ApprovalAcl'),source.indexOf('function Get-FixedApprovalBase'));
  requireValue(u.digest(Buffer.from(policy)) === '9e4c6488cc8a12c3d05b94cfa91f41d9e36a3bae7524f8c7bfad326fde583ede' && u.digest(Buffer.from(creation)) === 'dbf4b7e508d2bf2b168c3eac122fa7196f7249daa2b962a045bb74f21af9d035','BAD_ACL_TOOL','原审定ACL策略正文已变化');
  const checks = new Map();
  for (const target of targets) for (let p = target;;p = path.dirname(p)) { const key = p.toLowerCase(),ancestor = !u.samePath(p,target); if (!checks.has(key) || !ancestor) checks.set(key,{path:p,ancestor}); if (p === path.dirname(p)) break; }
  const request = JSON.stringify({sid:authority.osUser,checks:[...checks.values()],createPaths});
  requireValue(Buffer.byteLength(request)<=2097152,'BAD_ACL_TOOL','ACL请求超过固定界限');
  const functions = Buffer.from(policy+creation).toString('base64');
  const script = "[Console]::InputEncoding=[Text.UTF8Encoding]::new($false);[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$ErrorActionPreference='Stop';"+
    "$r=[Console]::In.ReadToEnd()|ConvertFrom-Json;"+
    "$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;if($sid -cne $r.sid){throw 'SID changed'};"+
    ". ([ScriptBlock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('"+functions+"'))));"+
    "foreach($c in $r.checks){if(Test-Path -LiteralPath $c.path){Assert-ApprovalAcl $c.path $sid ([bool]$c.ancestor)}};"+
    "foreach($p in $r.createPaths){if(Test-Path -LiteralPath $p){throw 'Owned directory already exists'};Create-ApprovalDirectory $p (New-ApprovalAcl $sid);Assert-ApprovalAcl $p $sid $false};"+
    "@{sid=$sid;checked=@($r.checks).Count;created=@($r.createPaths).Count}|ConvertTo-Json -Compress";
  const output = await new Promise((resolve,reject)=>{const child=require('node:child_process').execFile(NATIVE_POWERSHELL,['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,shell:false,encoding:'utf8',timeout:15000,maxBuffer:65536,env:{SystemRoot:'C:\\Windows',WINDIR:'C:\\Windows',SystemDrive:'C:',PATHEXT:'.EXE'}},(error,stdout)=>error?reject(Object.assign(Error('Windows权限核验/专属目录创建失败，未改变原有ACL'),{code:'NATIVE_ACL_REFUSED',cause:error})):resolve(stdout));child.stdin.on('error',reject);child.stdin.end(Buffer.from(request,'utf8'));});
  const proof = JSON.parse(output);requireValue(proof.sid === authority.osUser && proof.checked === checks.size && proof.created === createPaths.length,'NATIVE_ACL_REFUSED','Windows权限核验回执不完整');
  for (const target of [...targets,...createPaths]) await u.assertPath(fs,target,{directory:(await fs.lstat(target,{bigint:true})).isDirectory()});
  return proof;
}
function helperProgramPath(name, executableName) {
  if (!u.safeRelative(name) || /\.(db(?:-wal|-shm)?|sqlite3?(?:-wal|-shm)?|key|pfx|pyc)$/i.test(name) || name.split('/').some(part=>/^(data|profiles?|accounts?|credentials|backup|logs?)$/i.test(part))) return false;
  if (name === 'publisher-public.pem') return true;
  if (/^(delivery-tools|delivery-approval)\/[^/]+\.(cjs|ps1|json)$/.test(name) || /^project\/desktop\/[A-Za-z0-9_-]+\.cjs$/.test(name)) return true;
  return enginePath(name,executableName) || name === 'resources/default_app.asar' || name === 'chrome_crashpad_handler.exe';
}
function createNativeEngineTreeProvider170(input) {
  const inputKeys=['publication','paths','trust','sourceBindings','targetEnvelope','workerEnvelope','workerCatalogSha256','startupEntrySha256'];if(input?.bridgeEntrySha256!==undefined)inputKeys.push('bridgeEntrySha256');if(input?.slotSourceEnvelope!==undefined)inputKeys.push('slotSourceEnvelope');if(input?.slotDefaultSourceEnvelope!==undefined)inputKeys.push('slotDefaultSourceEnvelope');
  requireValue(exact(input,inputKeys)&&(input.bridgeEntrySha256===undefined||SHA.test(input.bridgeEntrySha256)),'BAD_NATIVE_BINDING','只接受已封原生交付绑定');
  const config = JSON.parse(JSON.stringify(input)),publication = config.publication,p = config.paths,meta = config.trust;
  requireValue(exact(p,['artifactDir','archiveFile','engineArtifactDir','workerRoot']) && Object.values(p).every(x=>typeof x === 'string'),'BAD_NATIVE_BINDING','原生交付路径缺失');
  for (const key of Object.keys(p)) p[key] = u.safeAbsolute(p[key]);
  requireValue(publication?.schemaVersion === 1 && publication.product === core.PRODUCT && publication.targetVersion === '1.7.0' && publication.targetEngineVersion === '44.9.0' && publication.publisherPublicKeySha256 === NATIVE_PUBLISHER && ['publicationId','artifactSha256','treeSha256','sourcePolicySha256','engineTreeSha256'].every(k=>SHA.test(publication[k] || '')) && SHA.test(config.workerCatalogSha256 || '') && SHA.test(config.startupEntrySha256 || ''),'BAD_NATIVE_BINDING','原生交付必须固定170/44.9/原发行摘要');
  requireValue(exact(meta,['schemaVersion','purpose','publisherPublicKeySha256','executableName','target']) && meta.schemaVersion === 1 && meta.purpose === PURPOSE && meta.publisherPublicKeySha256 === NATIVE_PUBLISHER && meta.target?.catalogSha256 === publication.engineTreeSha256 && meta.target?.programVersion === '1.7.0' && meta.target?.engineVersion === '44.9.0','BAD_NATIVE_BINDING','完整引擎策略不符');
  requireValue(Array.isArray(config.sourceBindings) && config.sourceBindings.length === 3 && same(config.sourceBindings.map(b=>b.meta?.programVersion).sort(),['1.6.0','1.6.1','1.6.2']) && config.sourceBindings.every(b=>exact(b,['meta','envelope']) && b.meta?.engineVersion === '44.7.0'),'BAD_NATIVE_BINDING','通用升级必须绑定三个确切旧完整目录');
  const entry = require('./initial-patch-entry.cjs'),controllers = new Map();
  async function publicProof(recovery = false) {
    requireValue(process.platform === 'win32' && process.env.ELECTRON_RUN_AS_NODE === '1' && !process.env.NODE_OPTIONS && !process.env.NODE_PATH,'UNTRUSTED_NATIVE_RUNTIME','只允许已核外置原引擎的固定原生助手');
    for (const dir of [p.artifactDir,p.engineArtifactDir,p.workerRoot]) await u.assertPath(fs,dir,{directory:true});
    const publicKey = crypto.createPublicKey(await u.readSmall(fs,path.join(p.artifactDir,'publisher-public.pem'),4096));
    requireValue(publicKey.type === 'public' && publicKey.asymmetricKeyType === 'ed25519' && u.digest(publicKey.export({type:'spki',format:'der'})) === NATIVE_PUBLISHER,'BAD_PUBLIC_KEY','原发行公钥不符');
    const policyEnvelope = JSON.parse(await u.readSmall(fs,path.join(p.artifactDir,'source-policy-envelope.json'),2097152)),policy = core.verifySourcePolicy(policyEnvelope,publicKey,{upgradeMode:'repeat'});
    requireValue(policy.catalogSha256 === publication.publicationId && policy.targetVersion === '1.7.0' && u.digest(Buffer.from(policyEnvelope.policy)) === publication.sourcePolicySha256 && policy.publisherPublicKeySha256 === NATIVE_PUBLISHER && policy.executableName === meta.executableName,'BAD_SOURCE_POLICY','原生源策略未绑定本发布');
    const artifact = await core.inspectArtifactTree({artifactDir:p.artifactDir});requireValue(artifact.sha256 === publication.treeSha256,'ARTIFACT_CHANGED','已审资源/工具树变化');
    requireValue((await core.fileHash(fs,p.archiveFile,path.dirname(p.archiveFile))).sha256 === publication.artifactSha256,'ARTIFACT_CHANGED','已审归档变化');
    const resourceEnvelope = JSON.parse(await u.readSmall(fs,path.join(p.artifactDir,'catalog-envelope.json'),2097152));requireValue(u.digest(Buffer.from(resourceEnvelope.catalog || '')) === publication.publicationId,'BAD_CATALOG','资源catalog不属于本发布');
    const resourceRaw = JSON.parse(resourceEnvelope.catalog),resourceCatalog = u.verifySignedCatalog(resourceEnvelope,u.createTrustedUpdatePolicy({trustedPublicKey:publicKey,currentVersion:'1.6.0',allowedFiles:resourceRaw.files.map(f=>f.path),now:Date.now}),{allowExpired:recovery});
    requireValue(resourceCatalog.version === '1.7.0' && resourceCatalog.files.every(f=>programPath(f.path)),'BAD_CATALOG','资源范围或版本不符');
    const allowedArtifact = new Set(['publisher-public.pem','source-policy-envelope.json','catalog-envelope.json',...policy.tools.map(f=>f.path),...resourceCatalog.files.map(f=>'payload/'+f.path)]);
    requireValue(artifact.files.length === allowedArtifact.size && artifact.files.every(f=>allowedArtifact.has(f.path)),'ARTIFACT_CHANGED','审批包有未知或缺失内容');
    for (const spec of [...policy.tools,...resourceCatalog.files.map(f=>({...f,path:'payload/'+f.path}))]) {const row=artifact.files.find(f=>f.path===spec.path);requireValue(row?.sha256===spec.sha256&&row.size===spec.size,'ARTIFACT_CHANGED','已签资源/工具变化');}
    const sources = new Map();
    for (const binding of config.sourceBindings) {const bound=binding.meta;requireValue(exact(bound,['programVersion','engineVersion','catalogSha256','allowedFiles'])&&Array.isArray(bound.allowedFiles)&&u.digest(Buffer.from(binding.envelope.catalog || ''))===bound.catalogSha256,'BAD_CATALOG','完整源目录绑定变化');const catalog=u.verifySignedCatalog(binding.envelope,u.createTrustedUpdatePolicy({trustedPublicKey:publicKey,currentVersion:bound.programVersion,allowedFiles:bound.allowedFiles,now:Date.now}),{allowExpired:true});requireValue(catalog.version===bound.programVersion&&catalog.files.length===bound.allowedFiles.length&&catalog.files.every(f=>enginePath(f.path,meta.executableName)),'BAD_CATALOG','完整源引擎范围不符');const original=policy.sourcePrograms.find(x=>x.version===bound.programVersion),sourceAsar=catalog.files.find(x=>x.path==='resources/app.asar'),sourceExe=catalog.files.find(x=>x.path===meta.executableName);requireValue(original?.main==='release-entry.cjs'&&original.asarSha256===sourceAsar?.sha256&&original.asarSize===sourceAsar?.size&&sourceExe?.sha256===policy.engine.sha256&&sourceExe.size===policy.engine.size,'BAD_SOURCE_POLICY','完整原树与已审EXE/ASAR来源不符');sources.set(bound.programVersion,{binding,catalog});}
    requireValue(u.digest(Buffer.from(config.targetEnvelope.catalog || ''))===meta.target.catalogSha256,'BAD_CATALOG','完整目标绑定变化');
    const full = {target:u.verifySignedCatalog(config.targetEnvelope,u.createTrustedUpdatePolicy({trustedPublicKey:publicKey,currentVersion:'1.6.0',allowedFiles:meta.target.allowedFiles,now:Date.now}),{allowExpired:true})};
    requireValue(full.target.version==='1.7.0'&&full.target.sourceVersions.includes('1.7.0')&&full.target.files.length===meta.target.allowedFiles.length&&full.target.files.every(f=>enginePath(f.path,meta.executableName))&&[...sources.values()].every(s=>full.target.sequence>s.catalog.sequence)&&same(rows(full.target.files.filter(f=>f.path.startsWith('resources/'))),rows(resourceCatalog.files)),'BAD_CATALOG','完整目标须同时允许170首次安装，且与已审资源是同一发布');
    requireValue(u.digest(Buffer.from(config.workerEnvelope.catalog || '')) === config.workerCatalogSha256,'BAD_HELPER','外置助手目录绑定不符');
    const workerRaw=JSON.parse(config.workerEnvelope.catalog),workerCatalog=u.verifySignedCatalog(config.workerEnvelope,u.createTrustedUpdatePolicy({trustedPublicKey:publicKey,currentVersion:'1.7.0',allowedFiles:workerRaw.files.map(f=>f.path),now:Date.now}),{allowExpired:recovery});
    requireValue(workerCatalog.version==='1.7.0'&&workerCatalog.files.every(f=>helperProgramPath(f.path,meta.executableName)),'BAD_HELPER','外置助手目录包含非程序或未知内容');
    requireValue(same(rows((await core.inspectArtifactTree({artifactDir:p.workerRoot})).files),rows(workerCatalog.files)),'BAD_HELPER','外置完整助手树变化');
    if(config.bridgeEntrySha256!==undefined){const signedBridge=workerCatalog.files.find(f=>f.path==='delivery-tools/bridge-entry-170.cjs');requireValue(signedBridge?.sha256===config.bridgeEntrySha256,'BRIDGE_ENTRY_UNBOUND','桥入口必须与已签完整助手中的代码副本相同，不能由CLI绑定任意170');}
    const reviewerDir=path.join(path.dirname(p.workerRoot),'审批工具'),reviewerFiles=[];
    for(const name of ['Prepare-Repeat-Approval-170.ps1','approval-core-170.cjs','approval-io-170.cjs','approval-archive-170.cjs']){const source=workerCatalog.files.find(f=>f.path==='delivery-approval/'+name),file=path.join(reviewerDir,name);requireValue(source,'BAD_HELPER','已签助手缺少独立审定器副本');const actual=await core.fileHash(fs,file,reviewerDir);requireValue(actual.size===source.size&&actual.sha256===source.sha256,'BAD_HELPER','树外实际审定器与已签副本不符');reviewerFiles.push(file);}
    for(const file of [process.execPath,__filename,process.argv[1]]){requireValue(typeof file==='string'&&inside(p.workerRoot,path.resolve(file)),'EXTERNAL_ASSISTANT_REQUIRED','当前运行时/入口不属于已签外置助手');const name=path.relative(p.workerRoot,path.resolve(file)).replaceAll('\\','/');requireValue(workerCatalog.files.some(f=>f.path===name),'BAD_HELPER','当前运行代码不在助手完整目录');}
    const engine=await core.fileHash(fs,process.execPath,p.workerRoot);requireValue(engine.size===policy.engine.size&&engine.sha256===policy.engine.sha256&&u.samePath(process.execPath,path.join(p.workerRoot,meta.executableName)),'SOURCE_ENGINE_MISMATCH','外置当前EXE不是已批准原引擎');
    const targetAsar=path.join(p.engineArtifactDir,'resources/app.asar'),targetTree=await core.inspectArtifactTree({artifactDir:p.engineArtifactDir});requireValue(same(rows(targetTree.files),rows(full.target.files)),'TREE_CHANGED','完整引擎目标树不符');
    const gateBytes=await readPackedText(targetAsar,'engine-startup-gate.cjs'),entryBytes=await readPackedText(targetAsar,'release-entry.cjs'),helperGate=workerCatalog.files.find(f=>f.path==='project/desktop/engine-startup-gate.cjs');
    requireValue(helperGate?.sha256===u.digest(gateBytes)&&u.digest(entryBytes)===config.startupEntrySha256&&entryBytes.toString('utf8').includes('./engine-startup-gate.cjs')&&entryBytes.toString('utf8').includes('readEngineStartupGate'),'STARTUP_FENCE_UNAVAILABLE','已签目标未包含本批启动门和已审主入口');
    let slotSourceCatalog=null,slotSources=null;
    if(config.slotDefaultSourceEnvelope!==undefined){
      slotSources=verifyKnownEmployeeSlotSources170({primaryEnvelope:config.slotSourceEnvelope,defaultEnvelope:config.slotDefaultSourceEnvelope,publicKey,targetCatalog:full.target,executableName:meta.executableName,now:Date.now});slotSourceCatalog=slotSources.primary.catalog;
    }else if(config.slotSourceEnvelope!==undefined){
      const slot=require('./native-employee-slot170.cjs'),envelope=config.slotSourceEnvelope;
      requireValue(exact(envelope,['catalog','signature'])&&typeof envelope.catalog==='string'&&SHA.test(u.digest(Buffer.from(envelope.catalog))),'BAD_SLOT_SOURCE','员工slot必须包含绑定文件已固定的原170完整目录');
      const raw=JSON.parse(envelope.catalog);
      requireValue(Array.isArray(raw.files)&&raw.files.length===1079,'BAD_SLOT_SOURCE','原fresh完整范围错误');
      slotSourceCatalog=u.verifySignedCatalog(envelope,u.createTrustedUpdatePolicy({trustedPublicKey:publicKey,currentVersion:'1.7.0',allowedFiles:raw.files.map(f=>f.path),now:Date.now}),{allowExpired:true});
      requireValue(slotSourceCatalog.version==='1.7.0'&&slotSourceCatalog.sequence>=14&&slotSourceCatalog.files.every(f=>enginePath(f.path,meta.executableName))&&full.target.sequence>slotSourceCatalog.sequence,'BAD_SLOT_SOURCE','员工slot来源身份或新目录序号错误');
      const sourceRows=rows(slotSourceCatalog.files.filter(f=>f.path!=='resources/app.asar')),targetRows=rows(full.target.files.filter(f=>f.path!=='resources/app.asar'));
      requireValue(same(sourceRows,targetRows),'SLOT_SCOPE_CHANGED','首批slot仅允许已审ASAR界面修订，其他完整程序字节必须一致');
      const sourceExe=slotSourceCatalog.files.find(f=>f.path===meta.executableName),targetExe=full.target.files.find(f=>f.path===meta.executableName);
      requireValue(sourceExe?.size===247184896&&sourceExe.sha256===targetExe?.sha256,'BAD_SLOT_SOURCE','原员工44.9完整引擎身份错误');
    }
    return {publicKey,policy,resourceCatalog,full,sources,engine,workerCatalog,reviewerDir,reviewerFiles,slotSourceCatalog,slotSources};
  }
  async function approvalProof(context, facts, createState = false, recovery = false) {
    const authority = await entry.resolveInitialNativeAuthority({upgradeMode:'repeat',publicationId:publication.publicationId}),file=path.join(authority.approvalRoot,'initial-upgrade-approval.json');
    await nativeAcl(p.workerRoot,authority,[authority.approvalRoot,file,p.workerRoot,...facts.workerCatalog.files.map(f=>path.join(p.workerRoot,...f.path.split('/'))),p.artifactDir,p.engineArtifactDir,facts.reviewerDir,...facts.reviewerFiles]);
    const before=await core.fileHash(fs,file,authority.approvalRoot),record=core.validateApproval(JSON.parse(await u.readSmall(fs,file,8192)),{osUser:authority.osUser,now:Date.now,upgradeMode:'repeat'});
    requireValue(record.publisherPublicKeySha256===NATIVE_PUBLISHER&&record.artifactSha256===publication.artifactSha256&&record.treeSha256===publication.treeSha256&&record.sourcePolicySha256===publication.sourcePolicySha256&&same(record.engine,facts.policy.engine)&&Date.parse(record.expiresAt)-Date.parse(record.approvedAt)<=86460000,'INDEPENDENT_APPROVAL_REQUIRED','包外原生审批与本发布不符');
    const install=u.safeAbsolute(record.installationDir),state=startup.stateDirectory(install);
    requireValue(!inside(install,p.workerRoot)&&!inside(p.workerRoot,install)&&!inside(p.engineArtifactDir,p.workerRoot)&&!inside(p.workerRoot,p.engineArtifactDir)&&!inside(install,p.artifactDir),'EXTERNAL_ASSISTANT_REQUIRED','原生运行时/材料不能位于待切换程序树');
    if(context){requireValue(context.authority?.osUser===authority.osUser&&u.samePath(context.authority.approvalRoot,authority.approvalRoot)&&context.protectedApproval?.sha256===before.sha256&&context.receipt?.approvalId===record.approvalId&&context.candidate?.role===record.role&&u.samePath(context.candidate.installationDir,install),'APPROVAL_MISMATCH','真实审批与当前一次按钮上下文不符');}
    const installed=await u.assertPath(fs,install,{directory:true,missing:recovery});let exists=true;try{await fs.lstat(state);}catch(error){if(error.code!=='ENOENT')throw error;exists=false;}
    if(!exists){requireValue(!recovery,'RECOVERY_REQUIRED','原生恢复状态缺失');if(createState)await nativeAcl(p.workerRoot,authority,[install,path.dirname(state)],[state]);else await nativeAcl(p.workerRoot,authority,[install,path.dirname(state)]);}
    else await nativeAcl(p.workerRoot,authority,[...(installed?[install]:[path.dirname(install)]),state]);
    requireValue((await core.fileHash(fs,file,authority.approvalRoot)).sha256===before.sha256,'APPROVAL_CHANGED','原生权限核验期间审批变化');
    return {authority,record,approvalFile:file,approvalSha256:before.sha256,install,state};
  }
  async function authenticatedJournal(state) {
    let bytes;try{bytes=await u.readSmall(fs,path.join(state,'journal.json'),16777216);}catch(error){if(error.code==='ENOENT')return null;throw error;}
    const key=await u.readSmall(fs,path.join(state,'journal-key.bin'),32),wrapper=JSON.parse(bytes);
    requireValue(key.length===32&&exact(wrapper,['payload','mac'])&&typeof wrapper.payload==='string'&&SHA.test(wrapper.mac||'')&&crypto.timingSafeEqual(crypto.createHmac('sha256',key).update(wrapper.payload).digest(),Buffer.from(wrapper.mac,'hex')),'BAD_JOURNAL','原生恢复记录认证失败');return JSON.parse(wrapper.payload);
  }
  async function captureMutable(install,catalog,bridge=false) {
    const tree=await core.inspectArtifactTree({artifactDir:install,pathPolicy:'preserved-history'}),base=new Map(catalog.files.map(f=>[f.path,f]));
    const extra=tree.files.filter(f=>f.path!==MARKER&&!base.has(f.path));
    requireValue(extra.every(f=>knownExtraSourceFile(f.path)||['.xjy-initial-upgrade/','.xjy-patches/','员工本地设置/',...(bridge?['.xjy-employee-updates/']:[])].some(prefix=>f.path.startsWith(prefix))||bridge&&f.path==='xjy-employee-recovery.json'),'UNEXPECTED_SOURCE_FILE','旧程序有未知可变资料，不能忽略或复制进目标');
    for(const spec of catalog.files){const row=tree.files.find(f=>f.path===spec.path);requireValue(row?.size===spec.size&&row.sha256===spec.sha256,'SOURCE_CHANGED','旧完整程序与已签目录不符');}
    const directories=[];
    async function walk(dir,prefix=''){for(const name of await fs.readdir(dir)){const file=path.join(dir,name),stat=await fs.lstat(file,{bigint:true});if(stat.isDirectory()){await u.assertPath(fs,file,{directory:true,root:install});directories.push({path:prefix+name,identity:u.statIdentity(stat)});await walk(file,prefix+name+'/');}}}
    for(const name of ['.xjy-initial-upgrade','.xjy-patches','员工本地设置',...(bridge?['.xjy-employee-updates']:[])]){const dir=path.join(install,name);try{const stat=await u.assertPath(fs,dir,{directory:true,root:install});directories.push({path:name,identity:u.statIdentity(stat)});await walk(dir,name+'/');}catch(error){if(error.code!=='ENOENT')throw error;}}
    directories.push(...await captureApprovedEmptyDirectories(fs,install));
    return {files:rows(extra),directories:directories.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0)};
  }
  async function openController(context, recovery = false, bridgeGrant) {
    const facts=bridgeGrant?.facts||await publicProof(recovery),approved=bridgeGrant?.approved||await approvalProof(context,facts,!recovery,recovery),{authority,record,install,state}=approved;
    const authorizationId=bridgeGrant?bridgeGrant.proof.operationId:record.approvalId;
    const broker=entry.createInitialInventoryBroker(),environment={...entry.cleanInitialEnvironment(process.env),SystemRoot:'C:\\Windows',WINDIR:'C:\\Windows',LOCALAPPDATA:authority.local,APPDATA:authority.roaming};
    let lease=null,backup=null,backupModule=null,verifyDatabases=null,prepared=false,tx=null,closed=false,creationMarker=null;
    const real=entry.createInitialProcessBarrier({installationDir:install,executablePath:path.join(install,meta.executableName),role:record.role,environment,helperPid:process.pid,inspectAll:()=>broker.list()});
    async function current(){const row=(await broker.list()).find(x=>x.pid===process.pid);requireValue(row&&u.samePath(row.executablePath,process.execPath)&&typeof row.creationMarker==='string'&&row.creationMarker.length>0&&(!creationMarker||creationMarker===row.creationMarker),'BAD_PROCESS','外置已签助手PID/创建标识不符');creationMarker=row.creationMarker;return{pid:row.pid,creationMarker:row.creationMarker};}
    async function releaseLease(){if(lease){const owned=lease;await owned.close();lease=null;}}
    const barrier={waitClosed:x=>real.waitClosed(x),assertClosed:x=>real.assertClosed(x),getCurrent:current,isAssistantAlive:async owner=>(await broker.list()).some(x=>x.pid===owner.pid&&x.creationMarker===owner.creationMarker),restart:async request=>{await releaseLease();return real.restart(request);}};
    async function revalidate(){const live=await entry.resolveInitialNativeAuthority({upgradeMode:'repeat',publicationId:publication.publicationId});requireValue(live.osUser===authority.osUser&&u.samePath(live.approvalRoot,authority.approvalRoot),'AUTHORITY_CHANGED','原生SID发生变化');if(bridgeGrant){const bytes=await u.readSmall(fs,bridgeGrant.handoffFile,16384),liveHandoff=require('./engine-bridge-source170.cjs').decodeAuthenticatedRecord(bytes,bridgeGrant.integrityKey);requireValue(u.digest(bytes)===bridgeGrant.handoffSha256&&liveHandoff.operationId===bridgeGrant.proof.operationId&&liveHandoff.publicationId===publication.publicationId&&liveHandoff.targetCatalogSha256===publication.engineTreeSha256,'BRIDGE_CHANGED','桥接交接认证或绑定发生变化');}else requireValue((await core.fileHash(fs,approved.approvalFile,authority.approvalRoot)).sha256===approved.approvalSha256,'AUTHORITY_CHANGED','原生审批发生变化');await current();if(lease)requireValue(await lease.assertHeld()===true,'SOURCE_LOCK_LOST','真实三库源锁丢失');}
    try {
      await current();await barrier.waitClosed();await barrier.assertClosed();
      let oldJournal=await authenticatedJournal(state);let sourceVersion=bridgeGrant?'1.7.0':context?.candidate?.version;
      if(oldJournal){requireValue(oldJournal.purpose===PURPOSE&&oldJournal.role===record.role&&oldJournal.paths?.installationDir===install&&oldJournal.paths?.stateDir===state&&oldJournal.publisherPublicKeySha256===NATIVE_PUBLISHER,'BAD_JOURNAL','原生恢复不属于本机角色与目录');sourceVersion=oldJournal.sourceVersion;}
      if(!sourceVersion)sourceVersion=(await core.packageIdentity(fs,path.join(install,'resources/app.asar'),install)).version;
      let selected=facts.sources.get(sourceVersion);requireValue(selected,'SOURCE_UNSUPPORTED','原生恢复的旧版本未获完整签名绑定');
      let sourceIdentity=context?.candidate?.identity||null;
      const currentIdentity=physicalIdentity(await u.assertPath(fs,install,{directory:true}));
      if(context&&!oldJournal)requireValue(sourceIdentity===currentIdentity,'SOURCE_CHANGED','审定后的原目录物理身份变化');
      let mutable;
      if(oldJournal&&oldJournal.phase!=='rolledback')mutable={files:oldJournal.sourceMutableFiles,directories:oldJournal.sourceMutableDirectories};
      else{
        if(oldJournal)requireValue(u.statIdentity(await u.assertPath(fs,install,{directory:true}))===oldJournal.identities?.source,'SOURCE_CHANGED','回退后原目录物理身份变化');
        mutable=await captureMutable(install,selected.catalog,Boolean(bridgeGrant));
        if(oldJournal)requireValue(same(mutable.files,oldJournal.sourceMutableFiles)&&same(mutable.directories,oldJournal.sourceMutableDirectories),'BAD_JOURNAL','回退现场可变资料与认证journal不符，保留现场');
      }
      requireValue(Array.isArray(mutable.files)&&Array.isArray(mutable.directories),'BAD_JOURNAL','旧可变资料恢复范围缺失');
      const dataProof=path.join(state,'data-proof'),profileProof=path.join(state,'profile-proof');
      let key;try{key=await u.readSmall(fs,path.join(state,'journal-key.bin'),32);}catch(error){if(error.code!=='ENOENT')throw error;requireValue((await fs.readdir(state)).length===0,'BAD_JOURNAL','已有恢复材料但密钥缺失');const o=await u.openChecked(fs,path.join(state,'journal-key.bin'),'wx+',{missing:true,root:state});try{await u.writeExactly(o.handle,0,crypto.randomBytes(32));await o.handle.sync();}finally{await o.handle.close();}key=await u.readSmall(fs,path.join(state,'journal-key.bin'),32);}
      requireValue(key.length===32,'BAD_JOURNAL','原生认证密钥长度错误');
      for(const dir of [dataProof,profileProof])try{await u.assertPath(fs,dir,{directory:true,root:state});}catch(error){if(error.code!=='ENOENT')throw error;requireValue(!recovery,'BAD_JOURNAL','认证恢复资料目录缺失，不补造原现场');await nativeAcl(p.workerRoot,authority,[state],[dir]);}
      let profileDir=null;
      if(record.role==='employee'){profileDir=bridgeGrant?.profileReadDir||await entry.resolveInitialEmployeeProfile({installDir:install,localAppData:authority.local,roamingAppData:authority.roaming});requireValue(profileDir,'KNOWN_PROFILE_REQUIRED','原员工profile缺失，不能创建空配置');}
      async function prepare(){
        if(prepared)return;await revalidate();await barrier.assertClosed();
        if(record.role==='host'){
          backupModule=require('./initial-patch-backup.cjs');const layout=backupModule.deriveInitialHostLayout({fixedRoot:'F:\\鑫金源珠宝资料'});await core.mkdirs(fs,state,'.xjy-initial-upgrade');
          lease=await require('./initial-source-lease.cjs').createInitialSourceLease({installDir:state,artifactDir:p.workerRoot,role:'host',root:layout.root,databases:layout.databases,environment});requireValue(await lease.assertHeld()===true,'SOURCE_LOCK_UNAVAILABLE','真实源锁未就绪');
          const engineState=native.statSync(process.execPath,{bigint:true}),engineApproved=()=>u.statIdentity(native.statSync(process.execPath,{bigint:true}))===u.statIdentity(engineState)&&facts.engine.sha256===facts.policy.engine.sha256;
          const sqlite=require('node:sqlite');verifyDatabases=backupModule.createNodeSqliteVerifier({sqlite,assertEngineApproved:engineApproved});
          const backupDir=path.join(state,'host-backup-'+crypto.randomUUID());backup=await backupModule.createInitialBackup({layout,backupDir,snapshotDatabases:backupModule.createNodeSqliteSnapshotter({sqlite,assertEngineApproved:engineApproved}),verifyDatabases,assertQuiescent:()=>barrier.assertClosed()});
          backup={...backup,directory:backupDir};const verified=await backupModule.verifyInitialBackup({backupDir,expectedManifestSha256:backup.manifestSha256,verifyDatabases});
          // Inspect only the newly owned, verified backup. A 162 ASAR alone
          // cannot establish that an external data directory never saw170.
          requireValue(!verified.manifest.files.some(f=>/(?:^|\/)(?:\.?cashier[^/]*|restore-transaction\.json)$/i.test(f.path)),'POST_BASELINE_RECOVERY_STATE','发现出纳或恢复事务资料；首批不处理这些状态，已保留备份并停止');
          for(const item of verified.manifest.databases){
            const file=path.join(backupDir,'files',...item.path.split('/'));await u.assertPath(fs,file,{root:backupDir});
            const db=new sqlite.DatabaseSync(path.toNamespacedPath(file),{readOnly:true,allowExtension:false});
            try{db.setDefensive?.(true);requireValue(!db.prepare("SELECT name FROM sqlite_master WHERE lower(name) GLOB 'cashier_*' LIMIT 1").get(),'POST_BASELINE_CASHIER_SCHEMA','发现首批范围外出纳schema；不降级、不删表，已保留备份并停止');}finally{db.close();}
          }
          await u.atomicWrite(fs,path.join(dataProof,'backup.json'),JSON.stringify({version:1,directory:backupDir,manifestSha256:backup.manifestSha256}),state);
          await u.atomicWrite(fs,path.join(profileProof,'profile.json'),JSON.stringify({version:1,role:'host',preservedByBackup:backup.manifestSha256}),state);
        } else {
          const before=await core.inspectArtifactTree({artifactDir:profileDir}),destination=await core.mkdirs(fs,state,'employee-profile-'+crypto.randomUUID());
          for(const spec of before.files){await core.mkdirs(fs,destination,path.posix.dirname(spec.path)==='.'?'':path.posix.dirname(spec.path));await core.copy(fs,path.join(profileDir,...spec.path.split('/')),path.join(destination,...spec.path.split('/')),spec,profileDir,destination);}
          const after=await core.inspectArtifactTree({artifactDir:profileDir}),copy=await core.inspectArtifactTree({artifactDir:destination});requireValue(before.sha256===after.sha256&&copy.sha256===before.sha256,'PROFILE_CHANGED','员工原profile备份不一致');backup={directory:destination,manifestSha256:before.sha256,profileDir};
          await u.atomicWrite(fs,path.join(profileProof,'profile.json'),JSON.stringify({version:1,profileDir,directory:destination,treeSha256:before.sha256}),state);await u.atomicWrite(fs,path.join(dataProof,'backup.json'),JSON.stringify({version:1,role:'employee',hostDataOpened:false}),state);
        }
        prepared=true;
      }
      async function verifyBackup(){requireValue(prepared&&backup,'BACKUP_REQUIRED','原生完整备份未完成');await revalidate();if(record.role==='host')await backupModule.verifyInitialBackup({backupDir:backup.directory,expectedManifestSha256:backup.manifestSha256,verifyDatabases});else requireValue((await core.inspectArtifactTree({artifactDir:backup.directory})).sha256===backup.manifestSha256&&(await core.inspectArtifactTree({artifactDir:backup.profileDir})).sha256===backup.manifestSha256,'PROFILE_CHANGED','员工备份或原配置变化');}
      async function captureStageEvidence(){
        requireValue(prepared&&backup,'BACKUP_REQUIRED','原生完整备份未完成');
        const nativeIntentFile=path.join(state,'native-intent.json');
        const nativeIntentBytes=await u.readSmall(fs,nativeIntentFile,16384);
        const dataProofFile=path.join(dataProof,'backup.json'),profileProofFile=path.join(profileProof,'profile.json');
        const dataProofBytes=await u.readSmall(fs,dataProofFile,16384),profileProofBytes=await u.readSmall(fs,profileProofFile,16384);
        const backupName=path.basename(backup.directory);
        const backupId=backupName.startsWith('host-backup-')?backupName.slice('host-backup-'.length):backupName.startsWith('employee-profile-')?backupName.slice('employee-profile-'.length):'';
        requireValue(u.samePath(path.dirname(backup.directory),state)&&u.UUID.test(backupId)&&backupName===(backupName.startsWith('host-backup-')?'host-backup-'+backupId:'employee-profile-'+backupId),'BAD_JOURNAL','原生备份目录身份不固定');
        return {nativeIntentSha256:u.digest(nativeIntentBytes),dataProofIdentity:u.statIdentity(await u.assertPath(fs,dataProof,{directory:true,root:state})),dataProofSha256:u.digest(dataProofBytes),profileProofIdentity:u.statIdentity(await u.assertPath(fs,profileProof,{directory:true,root:state})),profileProofSha256:u.digest(profileProofBytes),sourceLeaseDirIdentity:record.role === 'host' ? u.statIdentity(await u.assertPath(fs,path.join(state,'.xjy-initial-upgrade'),{directory:true,root:state})) : null,backupName,backupIdentity:u.statIdentity(await u.assertPath(fs,backup.directory,{directory:true,root:state})),backupManifestSha256:backup.manifestSha256};
      }
      let capability={},nativeContext={approvalId:authorizationId,sid:authority.osUser,sourceMutableFiles:mutable.files,sourceMutableDirectories:mutable.directories,targetMutableFiles:oldJournal?.targetMutableFiles||mutable.files,bridgeSource:bridgeGrant?.proof,revalidate,prepare,verifyBackup,captureStageEvidence,createOwnedDirectory:dir=>nativeAcl(p.workerRoot,authority,[path.dirname(dir)],[dir])};nativeCapabilities.set(capability,nativeContext);deferredCapabilities.add(capability);
      const runtimeOptions=async activeJournal=>{
        const value={isolationRoot:path.dirname(install),installationDir:install,artifactDir:p.engineArtifactDir,stateDir:state,dataDir:dataProof,profileDir:profileProof,role:record.role,sourceEnvelope:selected.binding.envelope,targetEnvelope:config.targetEnvelope,trust:{...meta,source:selected.binding.meta,publisherPublicKey:facts.publicKey},processBarrier:barrier};
        if(!activeJournal){
          let marker=false;try{await fs.lstat(path.join(install,MARKER));marker=true;}catch(error){if(error.code!=='ENOENT')throw error;}
          if(!marker)value.legacyRoleConfirmation={confirmed:true,source:'independent-approval',approvalId:authorizationId,role:record.role,installationDir:install,installationIdentity:u.statIdentity(await u.assertPath(fs,install,{directory:true})),sourceVersion,osUserNamespace:startup.namespace()};
        }
        return value;
      };
      let options=await runtimeOptions(oldJournal);
      tx=createEngineTreeRuntime170(options,capability);
      if(oldJournal&&oldJournal.phase==='rolledback'){
        await tx.retireRolledBack(oldJournal);
        oldJournal=null;
        const archivedVersion=(await core.packageIdentity(fs,path.join(install,'resources/app.asar'),install)).version;
        requireValue(archivedVersion===sourceVersion,'SOURCE_CHANGED','归档后原程序版本变化');
        selected=facts.sources.get(sourceVersion);requireValue(selected,'SOURCE_UNSUPPORTED','回退归档后的原版本未获完整签名绑定');
        sourceIdentity=currentIdentity;
        mutable=await captureMutable(install,selected.catalog,Boolean(bridgeGrant));
        const freshCapability={},freshNativeContext={...nativeContext,sourceMutableFiles:mutable.files,sourceMutableDirectories:mutable.directories,targetMutableFiles:mutable.files};
        nativeCapabilities.set(freshCapability,freshNativeContext);deferredCapabilities.add(freshCapability);
        capability=freshCapability;nativeContext=freshNativeContext;
        options=await runtimeOptions(null);
        tx=createEngineTreeRuntime170(options,capability);
      }
      const intent={version:1,purpose:'xjy-native-engine-intent170',publicationId:publication.publicationId,authorizationKind:bridgeGrant?'authenticated-bridge-stage1':'repeat-approval',approvalId:authorizationId,installationDir:install,role:record.role,osUser:authority.osUser,sourceVersion,sourceIdentity};
      const intentPath=path.join(state,'native-intent.json'),payload=JSON.stringify(intent);let intentBytes=Buffer.from(JSON.stringify({payload,mac:crypto.createHmac('sha256',key).update('xjy-native-engine-intent170\0').update(payload).digest('hex')}));
      let previous;try{previous=await u.readSmall(fs,intentPath,16384);}catch(error){if(error.code!=='ENOENT')throw error;}
      if(previous){const wrapper=JSON.parse(previous);requireValue(exact(wrapper,['payload','mac'])&&typeof wrapper.payload==='string'&&SHA.test(wrapper.mac||'')&&crypto.timingSafeEqual(crypto.createHmac('sha256',key).update('xjy-native-engine-intent170\0').update(wrapper.payload).digest(),Buffer.from(wrapper.mac,'hex')),'BAD_JOURNAL','原生intent认证失败');const old=JSON.parse(wrapper.payload);const normalized={...old,approvalId:authorizationId,sourceIdentity:intent.sourceIdentity};requireValue(same(normalized,intent)&&u.UUID.test(old.approvalId||'')&&(!context||oldJournal||old.sourceIdentity===intent.sourceIdentity),'RECOVERY_CONFLICT','原生intent不属于此发布/来源，不能覆盖');intentBytes=previous;}else await u.atomicWrite(fs,intentPath,intentBytes,state);
      async function held(){await revalidate();const j=await authenticatedJournal(state);if(j?.phase==='committed')return tx.assertStartupHeld();requireValue((await u.readSmall(fs,intentPath,16384)).equals(intentBytes),'BAD_JOURNAL','持久原生intent变化');requireValue(!j||['prepared','old-renamed','new-published'].includes(j.phase),'RECOVERY_REQUIRED','原生事务不处于持久阻断阶段');await barrier.assertClosed();if(!j){const nowMutable=await captureMutable(install,selected.catalog,Boolean(bridgeGrant));requireValue(same(nowMutable,mutable),'SOURCE_CHANGED','intent后旧程序/profile资料变化');}return{held:true,publicationId:publication.publicationId,authorizationId};}
      async function close(){if(closed)return;await releaseLease();await broker.close();closed=true;}
      return {tx,held,close,record,install,state,authority,backup:()=>backup,inspect:async()=>{await tx.assertStartupHeld();const j=await authenticatedJournal(state);return{committed:true,engineTreeSha256:publication.engineTreeSha256,version:'1.7.0',engineVersion:'44.9.0',role:record.role,installationDir:install,installationIdentity:physicalIdentity(await u.assertPath(fs,install,{directory:true})),transactionId:j.transactionId};}};
    } catch(error){try{await releaseLease();}catch(close){error.sourceLeaseCloseError=close.message;}try{await broker.close();}catch(close){error.inventoryCloseError=close.message;}throw error;}
  }
  function contextController(context){const controller=controllers.get(context.operationId);requireValue(controller&&controller.record.approvalId===context.receipt.approvalId&&controller.record.role===context.candidate.role&&u.samePath(controller.install,context.candidate.installationDir),'UNTRUSTED_NATIVE_CONTEXT','原生事务上下文未建立或发生变化');return controller;}
  async function freshDestination(request, allowInstalled=false){
    requireValue(exact(request,['role','installationDir'])&&['host','employee'].includes(request.role),'BAD_FRESH_ROLE','首次安装必须一次明确主机或员工角色');
    const facts=await publicProof(),authority=await entry.resolveInitialNativeAuthority(),install=u.safeAbsolute(request.installationDir),expected=path.join(authority.local,'鑫金源珠宝',request.role==='host'?'主机程序':'员工程序');
    requireValue(u.samePath(install,expected),'BAD_FRESH_DESTINATION','首次安装仅使用本机用户的固定新程序目录；已有程序请用升级入口');
    if(request.role==='host'){
      try{await u.assertPath(fs,'F:\\',{directory:true});}catch(error){if(error.code!=='ENOENT')throw error;u.fail('HOST_DATA_LOCATION_UNAVAILABLE','主机固定资料盘不可用，首次安装停止；不自动改资料位置或创建替代账套');}
      let dataExists=false;try{await fs.lstat('F:\\鑫金源珠宝资料');dataExists=true;}catch(error){if(error.code!=='ENOENT')throw error;}
      requireValue(!dataExists,'EXISTING_HOST_DATA','已存在主机资料，首次安装停止；请使用经验证的原程序升级，不创建或覆盖账套');
    }
    let exists=false;try{await u.assertPath(fs,install,{directory:true});exists=true;}catch(error){if(error.code!=='ENOENT')throw error;}
    requireValue(allowInstalled?exists:!exists,'EXISTING_INSTALLATION',allowInstalled?'首次安装完整程序目录缺失':'程序目录已存在，请使用升级入口，不覆盖');
    await nativeAcl(p.workerRoot,authority,[p.workerRoot,authority.local,...(exists?[install]:[])]);
    return{facts,authority,install};
  }
  async function resolveEmployeeSlotSource(options={}){
    requireValue(exact(options,[])||exact(options,['recovery'])&&typeof options.recovery==='boolean','BAD_SLOT_REQUEST','员工源发现只接受固定恢复意图');
    const facts=await publicProof(),authority=await entry.resolveInitialNativeAuthority();requireValue(facts.slotSourceCatalog,'SLOT_UNAVAILABLE','本包没有已绑定员工170来源');
    const name=(os.hostname()+'-'+os.userInfo().username).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,90),profileDir=path.join(authority.local,'鑫金源珠宝员工端',name),shared=require('../project/desktop/native-employee-location170.cjs'),hintFile=path.join(authority.local,'鑫金源珠宝安装','verified-location-'+authority.osUser+'.json'),anchor=path.join(authority.local,'鑫金源珠宝','员工程序');
    let candidate=anchor;try{const hint=JSON.parse(await u.readSmall(fs,hintFile,8192));requireValue(exact(hint,['version','product','role','osUser','installationDir','installationIdentity'])&&hint.version===1&&hint.product===core.PRODUCT&&hint.role==='employee'&&hint.osUser===authority.osUser&&typeof hint.installationDir==='string','LOCATION_HINT_CONFLICT','员工位置提示字段不符');const chosen=u.safeAbsolute(hint.installationDir);requireValue(u.samePath(chosen,anchor)||u.samePath(path.dirname(chosen),path.dirname(anchor))&&/^员工程序-slot-[a-f0-9]{64}$/.test(path.basename(chosen)),'LOCATION_HINT_CONFLICT','员工位置提示越出固定目录范围');candidate=chosen;}catch(error){if(error.code!=='ENOENT')throw error;}
    if(!options.recovery){const proof=await shared.verifyActiveEmployeeSlot170({local:authority.local,osUser:authority.osUser,installationDir:candidate,profileDir,publicKey:facts.publicKey});return{installationDir:proof.installationDir,role:'employee'};}
    try{const active=await shared.verifyActiveEmployeeSlot170({local:authority.local,osUser:authority.osUser,installationDir:candidate,profileDir,publicKey:facts.publicKey});if(active.kind==='active-slot'&&active.catalogSha256===publication.engineTreeSha256)return{installationDir:active.installationDir,role:'employee'};}catch(error){if(error.code!=='UNVERIFIED_EMPLOYEE_LOCATION')throw error;}
    requireValue(typeof shared.verifyEmployeeSlotRecoverySource170==='function','SLOT_RECOVERY_UNAVAILABLE','共享认证恢复源组件尚未绑定');
    const proof=await shared.verifyEmployeeSlotRecoverySource170({local:authority.local,osUser:authority.osUser,profileDir,publicKey:facts.publicKey,targetCatalogSha256:publication.engineTreeSha256});return{installationDir:proof.installationDir,role:'employee'};
  }
  async function employeeSlot(action,request){
    const facts=await publicProof(),authority=await entry.resolveInitialNativeAuthority();
    requireValue(facts.slotSourceCatalog,'SLOT_UNAVAILABLE','本发布未固定已签原员工fresh170来源');
    requireValue(exact(request,['installationDir']),'BAD_SLOT_REQUEST','slot仅接收入口已选择的员工目录，不接受目的位置');
    const profileName=(os.hostname()+'-'+os.userInfo().username).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,90),profileDir=path.join(authority.local,'鑫金源珠宝员工端',profileName),shared=require('../project/desktop/native-employee-location170.cjs');let sourceAuthority;
    try{sourceAuthority=await shared.verifyActiveEmployeeSlot170({local:authority.local,osUser:authority.osUser,installationDir:request.installationDir,profileDir,publicKey:facts.publicKey});}catch(error){if(action!=='recover'||error.code!=='UNVERIFIED_EMPLOYEE_LOCATION')throw error;requireValue(typeof shared.verifyEmployeeSlotRecoverySource170==='function','SLOT_RECOVERY_UNAVAILABLE','共享恢复源组件尚未绑定');sourceAuthority=await shared.verifyEmployeeSlotRecoverySource170({local:authority.local,osUser:authority.osUser,profileDir,publicKey:facts.publicKey,targetCatalogSha256:publication.engineTreeSha256});requireValue(u.samePath(sourceAuthority.installationDir,request.installationDir),'BAD_SLOT_SOURCE','恢复源不属于此已认证待完成事务');}
    requireValue(u.samePath(sourceAuthority.sourceAnchorDir,path.join(authority.local,'鑫金源珠宝','员工程序')),'BAD_SLOT_ANCHOR','员工slot没有固定真实default anchor');
    requireValue(sourceAuthority.sourceAnchorStateIdentity===u.statIdentity(await u.assertPath(fs,startup.stateDirectory(sourceAuthority.sourceAnchorDir),{directory:true})),'BAD_SLOT_ANCHOR','员工default anchor状态物理身份变化');
    await nativeAcl(p.workerRoot,authority,[request.installationDir,profileDir,sourceAuthority.sourceAnchorDir,startup.stateDirectory(sourceAuthority.sourceAnchorDir)]);
    const operationKey=await u.readSmall(fs,path.join(startup.stateDirectory(sourceAuthority.sourceAnchorDir),'journal-key.bin'),32);requireValue(operationKey.length===32,'BAD_SLOT_ANCHOR','default anchor认证密钥不完整');
    // 来源与包自洽：本次安装目录自己的已签回执就是这一份安装的真实来源证明，
    // 不再要求它命中两个写死的历史摘要（详见 verifyEmployeeSlotSource170 上的注释）。
    const receiptSource=await readEmployeeSlotReceipt170({install:request.installationDir,publicKey:facts.publicKey,targetCatalog:facts.full.target,executableName:meta.executableName});
    // 真实来源摘要等于本包目标摘要，说明这个位置已经装成本包目标（不再是可复制的旧来源），
    // 直接按已装完成放行；default anchor 与 active slot 同样适用。
    if(['update','recover'].includes(action)&&['active-slot','default'].includes(sourceAuthority.kind)&&sourceAuthority.catalogSha256===publication.engineTreeSha256){
      const install=u.safeAbsolute(request.installationDir),marker=await u.readSmall(fs,path.join(install,MARKER),4096),tree=await core.inspectArtifactTree({artifactDir:install,pathPolicy:'preserved-history'});
      requireValue(same(rows(tree.files),rows([...facts.full.target.files,{path:MARKER,size:marker.length,sha256:u.digest(marker)}])),'TREE_CHANGED','当前active slot未完整匹配本包目标');
      return{completed:true,activated:true,alreadyInstalled:true,...(action==='recover'?{recovered:false,committed:true,rollbackForbidden:true}:{}),installationDir:install,role:'employee',version:'1.7.0',engineVersion:'44.9.0'};
    }
    function currentPair(verifiedFacts){
      if(verifiedFacts.slotSources)return selectEmployeeSlotSource170(verifiedFacts.slotSources,sourceAuthority,receiptSource);
      requireValue(sourceAuthority.catalogSha256===u.digest(Buffer.from(config.slotSourceEnvelope.catalog)),'BAD_SLOT_SOURCE','当前真实active来源不是本包已绑定的原完整目录');
      return {envelope:config.slotSourceEnvelope,catalog:verifiedFacts.slotSourceCatalog,catalogSha256:u.digest(Buffer.from(config.slotSourceEnvelope.catalog))};
    }
    const selectedSource=currentPair(facts);
    const slot=require('./native-employee-slot170.cjs'),broker=entry.createInitialInventoryBroker(),environment={...entry.cleanInitialEnvironment(process.env),SystemRoot:'C:\\Windows',WINDIR:'C:\\Windows',LOCALAPPDATA:authority.local,APPDATA:authority.roaming};
    async function revalidate(){const live=await entry.resolveInitialNativeAuthority();requireValue(live.osUser===authority.osUser&&u.samePath(live.local,authority.local)&&u.samePath(live.roaming,authority.roaming),'AUTHORITY_CHANGED','slot当前Windows用户改变');const liveSelected=currentPair(await publicProof());requireValue(liveSelected.catalogSha256===selectedSource.catalogSha256&&liveSelected.envelope.catalog===selectedSource.envelope.catalog&&liveSelected.envelope.signature===selectedSource.envelope.signature,'BAD_SLOT_SOURCE','slot已选来源签名发生变化');}
    const closed=async(...dirs)=>{for(const dir of dirs){const barrier=entry.createInitialProcessBarrier({installationDir:dir,executablePath:path.join(dir,meta.executableName),role:'employee',environment,helperPid:process.pid,inspectAll:()=>broker.list()});await barrier.assertClosed();}};
    const currentAssistant=async()=>{const row=(await broker.list()).find(r=>r.pid===process.pid);requireValue(row&&u.samePath(row.executablePath,process.execPath)&&typeof row.creationMarker==='string'&&row.creationMarker,'BAD_PROCESS','slot外置助手进程身份不符');return{pid:row.pid,creationMarker:row.creationMarker};};
    const launch=async install=>entry.createInitialProcessBarrier({installationDir:install,executablePath:path.join(install,meta.executableName),role:'employee',environment,helperPid:process.pid,inspectAll:()=>broker.list()}).restart({executablePath:path.join(install,meta.executableName),args:['--employee-client'],role:'employee'});
    const health=async install=>{const rows=(await broker.list()).filter(r=>typeof r.executablePath==='string'&&r.executablePath.length>0&&u.samePath(r.executablePath,path.join(install,meta.executableName))&&typeof r.commandLine==='string'&&!/--type(?:=|\s)|--xjy-print-worker|ELECTRON_RUN_AS_NODE|--host/i.test(r.commandLine)&&/(?:^|\s)--employee-client(?:\s|$)/.test(r.commandLine));requireValue(rows.length===1&&typeof rows[0].creationMarker==='string','SLOT_HEALTH_UNCERTAIN','未确认唯一新员工主进程');const first=rows[0],window=await require('./native-employee-slot-windows170.cjs').windowHealth(first.pid),again=(await broker.list()).find(r=>r.pid===first.pid);requireValue(again?.creationMarker===first.creationMarker&&typeof again.executablePath==='string'&&again.executablePath.length>0&&u.samePath(again.executablePath,first.executablePath),'BAD_PROCESS','新员工窗口核验期间进程身份改变');return window;};
    try{return await slot.dispatchEmployeeSlot170({request,authority,publication,sourceAuthority,operationKey,sourceEnvelope:selectedSource.envelope,sourceCatalog:selectedSource.catalog,sourceBindings:config.sourceBindings,targetCatalog:facts.full.target,publicKey:facts.publicKey,
      acl:(targets,creates=[])=>nativeAcl(p.workerRoot,authority,targets,creates),closed,revalidate,launch,health,currentAssistant,isAssistantAlive:async owner=>(await broker.list()).some(r=>r.pid===owner.pid&&r.creationMarker===owner.creationMarker),physicalIdentity:async install=>physicalIdentity(await u.assertPath(fs,install,{directory:true})),
      copyTarget:async install=>{
        for(const name of ['release-entry.cjs','release-app.cjs','release-storage.cjs','storage-locations.cjs','launch-role.cjs','employee-recovery-entry.cjs','credentials.cjs']){
          const original=await readPackedText(path.join(request.installationDir,'resources/app.asar'),name),target=await readPackedText(path.join(p.engineArtifactDir,'resources/app.asar'),name);
          requireValue(original.equals(target),'SLOT_PROFILE_COMPATIBILITY_REQUIRED','共享员工profile相关代码有变化，首批slot拒绝');
        }
        const marker=Buffer.from(JSON.stringify({version:1,product:core.PRODUCT,programVersion:'1.7.0',role:'employee',installationDir:install}));
        const expected=new Map([...facts.full.target.files,{path:MARKER,size:marker.length,sha256:u.digest(marker)}].map(f=>[f.path,f])),present=await core.inspectArtifactTree({artifactDir:install,pathPolicy:'preserved-history'});
        requireValue(present.files.every(f=>expected.has(f.path)),'SLOT_TARGET_UNEXPECTED','新slot存在未声明文件，不覆盖或清理');
        requireValue(present.files.every(f=>f.size===expected.get(f.path).size&&f.sha256===expected.get(f.path).sha256),'SLOT_PARTIAL_FILE_REVIEW','新slot有半文件或已变文件，仅允许认证的新slot独立清理');
        const presentNames=new Set(present.files.map(f=>f.path));
        for(const spec of facts.full.target.files){if(presentNames.has(spec.path))continue;await core.mkdirs(fs,install,path.posix.dirname(spec.path)==='.'?'':path.posix.dirname(spec.path));await core.copy(fs,path.join(p.engineArtifactDir,...spec.path.split('/')),path.join(install,...spec.path.split('/')),spec,p.engineArtifactDir,install);}
        if(!presentNames.has(MARKER))await u.atomicWrite(fs,path.join(install,MARKER),marker,install);
      },
      createTargetState:async install=>{
        const derived=slot.deriveEmployeeSlot170({local:authority.local,sourceInstallationDir:request.installationDir,targetCatalogSha256:publication.engineTreeSha256,sourceCatalogSha256:selectedSource.catalogSha256,sourceAuthority});requireValue(u.samePath(install,derived.target),'BAD_SLOT_TARGET','slot状态创建目的位置不符');
        const state=startup.stateDirectory(install);await nativeAcl(p.workerRoot,authority,[install,path.dirname(install)],[state]);return u.statIdentity(await u.assertPath(fs,state,{directory:true}));
      },
      initializeTarget:async(install,stateIdentity)=>{
        const derived=slot.deriveEmployeeSlot170({local:authority.local,sourceInstallationDir:request.installationDir,targetCatalogSha256:publication.engineTreeSha256,sourceCatalogSha256:selectedSource.catalogSha256,sourceAuthority});requireValue(u.samePath(install,derived.target),'BAD_SLOT_TARGET','slot目的位置不属于完整目标目录');
        const state=startup.stateDirectory(install);requireValue(typeof stateIdentity==='string'&&stateIdentity===u.statIdentity(await u.assertPath(fs,state,{directory:true})),'DIRECTORY_CHANGED','slot状态目录没有已落盘的新建物理身份证据');await nativeAcl(p.workerRoot,authority,[install,state]);
        const capability={};nativeCapabilities.set(capability,{approvalId:null});
        try{return await initializeFreshEngineReceipt170({installationDir:install,stateDir:state,role:'employee',envelope:config.targetEnvelope,trust:{schemaVersion:1,purpose:'xjy-engine-fresh170',publisherPublicKey:facts.publicKey,publisherPublicKeySha256:NATIVE_PUBLISHER,executableName:meta.executableName,target:meta.target}},capability);}finally{nativeCapabilities.delete(capability);}
      }},action);
    }finally{await broker.close();}
  }
  async function continueCommittedBridge(){
    requireValue(SHA.test(config.bridgeEntrySha256||''),'BRIDGE_ENTRY_UNBOUND','本发布未固定无业务桥入口，普通170不能继续');
    const facts=await publicProof(true),bridge=require('./engine-bridge-source170.cjs'),bundleRoot=path.dirname(p.workerRoot),handoffFile=path.join(bundleRoot,'engine-bridge-handoff.json'),raw=await u.readSmall(fs,handoffFile,16384);
    let hint;try{const wrapped=JSON.parse(raw);hint=JSON.parse(wrapped.payload);}catch{u.fail('BAD_BRIDGE_PROOF','桥交接格式无效');}
    requireValue(hint?.role==='employee'&&u.UUID.test(hint.operationId||'')&&typeof hint.installationDir==='string'&&typeof hint.profileDir==='string','BAD_BRIDGE_PROOF','桥交接没有明确员工/目录/操作');
    const install=u.safeAbsolute(hint.installationDir),profileDir=u.safeAbsolute(hint.profileDir),state=startup.stateDirectory(install),authority=await entry.resolveInitialNativeAuthority({upgradeMode:'repeat',publicationId:publication.publicationId});
    requireValue(!inside(install,bundleRoot)&&!inside(bundleRoot,install)&&!inside(profileDir,bundleRoot)&&!inside(bundleRoot,profileDir),'EXTERNAL_ASSISTANT_REQUIRED','桥完整包必须与待切换程序和原profile分离');
    let oldJournal=null;try{await u.assertPath(fs,state,{directory:true});oldJournal=await authenticatedJournal(state);}catch(error){if(error.code!=='ENOENT')throw error;}
    let sourceDirectory=install,profileReadDir=profileDir,expectedProfileDir;
    if(oldJournal){
      requireValue(oldJournal.version===5&&oldJournal.purpose===PURPOSE&&oldJournal.role==='employee'&&oldJournal.transactionId===hint.operationId&&oldJournal.paths?.installationDir===install&&oldJournal.paths?.stateDir===state&&oldJournal.sourceEvidence?.kind==='authenticated-bridge-stage1'&&oldJournal.sourceEvidence.publicationId===publication.publicationId&&oldJournal.sourceEvidence.targetCatalogSha256===publication.engineTreeSha256&&oldJournal.sourceEvidence.profileDir===profileDir,'BAD_JOURNAL','已有native恢复不是本次认证桥，不能覆盖');
      const backup=path.join(path.dirname(install),'.'+path.basename(install)+'.engine-backup-'+oldJournal.transactionId);requireValue(oldJournal.backupDir===backup,'BAD_JOURNAL','桥备份路径不是由认证事务派生');
      let found=false;for(const candidate of[install,backup]){try{if(u.statIdentity(await u.assertPath(fs,candidate,{directory:true}))===oldJournal.identities?.source){sourceDirectory=candidate;found=true;break;}}catch(error){if(error.code!=='ENOENT')throw error;}}
      requireValue(found,'RECOVERY_CONFLICT','认证桥原完整树缺失');
      if(inside(install,profileDir))profileReadDir=path.join(sourceDirectory,path.relative(install,profileDir));
      expectedProfileDir=profileDir;
    }else expectedProfileDir=await entry.resolveInitialEmployeeProfile({installDir:install,localAppData:authority.local,roamingAppData:authority.roaming});
    requireValue(expectedProfileDir&&u.samePath(profileDir,expectedProfileDir),'KNOWN_PROFILE_REQUIRED','交接profile不是当前用户的已核员工目录');
    await nativeAcl(p.workerRoot,authority,[sourceDirectory,profileReadDir,bundleRoot,handoffFile,p.workerRoot,...facts.workerCatalog.files.map(f=>path.join(p.workerRoot,...f.path.split('/'))),...(oldJournal?[state]:[])]);
    const journal=await u.authenticatedRead(fs,path.join(sourceDirectory,bridge.STATE,'journal.json'),profileReadDir,8388608),selected=facts.sources.get(journal.expectedVersion);
    requireValue(selected,'BRIDGE_ORIGINAL_SOURCE_MISMATCH','桥原helper的旧版来源不在本次三旧版完整树中');
    const inspect=()=>bridge.inspectInstalledBridge({installationDir:install,sourceDirectory,profileDir,profileReadDir,expectedProfileDir,handoffFile,bridgeEntrySha256:config.bridgeEntrySha256,publicationId:publication.publicationId,targetCatalogSha256:publication.engineTreeSha256,oldBinding:selected.binding,publicKey:facts.publicKey});
    let proof=await inspect();requireValue(proof.operationId===hint.operationId,'BAD_BRIDGE_PROOF','桥操作ID与原helper提交不符');
    if(oldJournal)requireValue(same(oldJournal.sourceEvidence,proof.descriptor),'BAD_JOURNAL','认证桥证据与原native事务不符');
    if(!oldJournal){const legacy=await require('../delivery-approval/approval-io-170.cjs').readTransactionState(install,'employee',authority.osUser);requireValue(!['prepared','mutating'].includes(legacy.transactionState),'RECOVERY_REQUIRED','旧独立恢复事务未完成，不能交叉继续');}
    // The original user-approved signed resource update is the authorization
    // for this exact bridge continuation. No repeat approval record is forged.
    const integrityKey=await u.readSmall(fs,path.join(profileReadDir,'employee-update-cache/.native-integrity-key'),32),ackFile=path.join(bundleRoot,'engine-bridge-accepted.json');let previousAck;
    try{previousAck=bridge.decodeAuthenticatedRecord(await u.readSmall(fs,ackFile,16384),integrityKey);requireValue(exact(previousAck,['version','purpose','operationId','publicationId','targetCatalogSha256','helperPid','helperParentPid','helperCreationMarker','helperExecutableSha256'])&&previousAck.version===1&&previousAck.purpose===bridge.ACK&&previousAck.operationId===proof.operationId&&previousAck.publicationId===publication.publicationId&&previousAck.targetCatalogSha256===publication.engineTreeSha256&&previousAck.helperExecutableSha256===facts.engine.sha256&&Number.isSafeInteger(previousAck.helperPid)&&previousAck.helperPid>0&&Number.isSafeInteger(previousAck.helperParentPid)&&previousAck.helperParentPid>0&&typeof previousAck.helperCreationMarker==='string','BAD_BRIDGE_ACK','旧ACK不属于同一认证桥，保留现场');}catch(error){if(error.code!=='ENOENT')throw error;}
    const broker=entry.createInitialInventoryBroker();let processIdentity;
    try{const inventory=await broker.list();processIdentity=inventory.find(row=>row.pid===process.pid&&u.samePath(row.executablePath,process.execPath));requireValue(processIdentity?.creationMarker,'BAD_PROCESS','实际树外助手进程身份缺失');requireValue(!previousAck||!inventory.some(row=>row.pid===previousAck.helperPid&&row.creationMarker===previousAck.helperCreationMarker),'BUSY','原认证桥助手仍在运行，不能覆盖ACK');}finally{await broker.close();}
    requireValue(Number.isSafeInteger(processIdentity.parentPid)&&processIdentity.parentPid>0,'BAD_PROCESS','实际PS父进程身份缺失');
    await u.authenticatedWrite(fs,ackFile,{version:1,purpose:bridge.ACK,operationId:proof.operationId,publicationId:publication.publicationId,targetCatalogSha256:publication.engineTreeSha256,helperPid:process.pid,helperParentPid:processIdentity.parentPid,helperCreationMarker:processIdentity.creationMarker,helperExecutableSha256:facts.engine.sha256},profileReadDir,bundleRoot);
    let stateExists=true;try{await u.assertPath(fs,state,{directory:true});}catch(error){if(error.code!=='ENOENT')throw error;stateExists=false;}
    if(!stateExists)await nativeAcl(p.workerRoot,authority,[path.dirname(install)],[state]);
    // Signature and HMAC proofs are retained as distinct evidence. This is not
    // a fabricated signed full-tree catalog for170.
    const bridgeMeta={programVersion:'1.7.0',engineVersion:'44.7.0',catalogSha256:proof.catalogSha256,allowedFiles:proof.programFiles.map(f=>f.path)};
    facts.sources.set('1.7.0',{binding:{meta:bridgeMeta,envelope:selected.binding.envelope},catalog:proof.sourceCatalog});
    const approved={authority,record:{authorizationKind:'authenticated-bridge-stage1',authorizationId:proof.operationId,role:'employee',installationDir:install},install,state};
    const grant={facts,approved,proof,profileReadDir,handoffFile,handoffSha256:u.digest(raw),integrityKey};
    const controller=await openController(null,Boolean(oldJournal),grant);
    try{
      // Re-read after the bridge's normal exit; the open controller checks the
      // real process barrier before taking its data/profile baseline.
      proof=await inspect();requireValue(same(proof.descriptor,grant.proof.descriptor),'BRIDGE_CHANGED','退出后桥的认证提交记录发生变化');
      if(oldJournal){const recovered=await controller.tx.recover();if(recovered.rolledBack)return{completed:false,recovered:true,rolledBack:true,role:'employee',operationId:proof.operationId,maintenanceBridgeRetained:true};if(recovered.recovered===false)await controller.tx.install();}
      else await controller.tx.install();
      const j=await authenticatedJournal(state);requireValue(j?.phase==='committed'&&j.rollbackForbidden===true,'COMMIT_READBACK_FAILED','桥完整事务未持久提交');
      const result=await controller.tx.startCommitted();
      return{completed:result.started===true,installed:true,version:'1.7.0',engineVersion:'44.9.0',role:'employee',installationDir:install,operationId:proof.operationId,alreadyReleased:result.alreadyReleased===true,restartUncertain:result.alreadyReleased===true};
    }finally{await controller.close();}
  }
  return Object.freeze({strategy:'full-engine-tree',targetVersion:'1.7.0',targetEngineVersion:'44.9.0',
    verifyPublication:async({publication:value,paths})=>{requireValue(value.publicationId===publication.publicationId&&value.engineTreeSha256===publication.engineTreeSha256&&u.samePath(paths.artifactDir,p.artifactDir)&&u.samePath(paths.archiveFile,p.archiveFile),'BAD_NATIVE_BINDING','按钮配置与原生发布绑定不符');await publicProof();return{publicationId:publication.publicationId,engineTreeSha256:publication.engineTreeSha256,targetVersion:'1.7.0',engineVersion:'44.9.0'};},
    assertWorkerRuntime:async({candidate})=>{await publicProof();requireValue(!inside(candidate.installationDir,process.execPath)&&!inside(candidate.installationDir,__filename),'EXTERNAL_ASSISTANT_REQUIRED','原生助手仍在待切换树');return true;},
    verifyApprovalAuthority:async context=>{await approvalProof(context,await publicProof());return true;},
    startupFence:Object.freeze({protocol:'xjy-pre-business-commit-fence-v1',gatePoint:'before-business-import',acquire:async context=>{requireValue(u.UUID.test(context.operationId||'')&&!controllers.has(context.operationId),'BUSY','原生操作ID重复');const controller=await openController(context);controllers.set(context.operationId,controller);return{assertHeld:async()=>{const proof=await controller.held();return proof.held===true;},releaseAfterCommit:async request=>{requireValue(request.proof?.committed===true&&request.proof.transactionId===(await controller.inspect()).transactionId,'COMMIT_READBACK_FAILED','按钮放行proof不符');try{const result=await controller.tx.startCommitted();return{released:result.started===true||result.alreadyReleased===true,role:controller.record.role,version:'1.7.0'};}finally{await controller.close();}},retainOnFailure:async()=>{await controller.close();}};}}),
    createTransaction:async context=>{const c=contextController(context);return{install:()=>c.tx.install(),recover:()=>c.tx.recover()};},
    createLegacyTransaction:async context=>{const c=contextController(context);return{install:()=>c.tx.install(),recover:()=>c.tx.recover()};},
    verifyInstalled:async context=>contextController(context).inspect(),
    recoverApproved:async({restartTarget=false}={})=>{requireValue(typeof restartTarget==='boolean','BAD_OPTIONS','恢复只接受明确目标重启意图');const controller=await openController(null,true);try{return await controller.tx.recover(restartTarget?{restartTarget:true}:{});}finally{await controller.close();}},
    continueCommittedBridge,
    prepareEmployeeSlot170:request=>employeeSlot('prepare',request),
    launchEmployeeSlot170:request=>employeeSlot('launch',request),
    activateEmployeeSlot170:request=>employeeSlot('activate',request),
    recoverEmployeeSlot170:request=>employeeSlot('recover',request),
    updateEmployeeSlot170:request=>employeeSlot('update',request),
    resolveEmployeeSlotSource170:resolveEmployeeSlotSource,
    verifyFreshDestination:async request=>{const checked=await freshDestination(request);return{role:request.role,installationDir:checked.install,version:'1.7.0',engineVersion:'44.9.0'};},
    initializeFreshInstalled:async request=>{
      const checked=await freshDestination(request,true),state=startup.stateDirectory(checked.install);let exists=false;
      try{await u.assertPath(fs,state,{directory:true});exists=true;}catch(error){if(error.code!=='ENOENT')throw error;}
      await nativeAcl(p.workerRoot,checked.authority,[checked.install,path.dirname(checked.install),...(exists?[state]:[])],exists?[]:[state]);
      const capability={};nativeCapabilities.set(capability,{approvalId:null});
      try{return await initializeFreshEngineReceipt170({installationDir:checked.install,stateDir:state,role:request.role,envelope:config.targetEnvelope,trust:{schemaVersion:1,purpose:'xjy-engine-fresh170',publisherPublicKey:checked.facts.publicKey,publisherPublicKeySha256:NATIVE_PUBLISHER,executableName:meta.executableName,target:meta.target}},capability);}
      finally{nativeCapabilities.delete(capability);}
    }
  });
}

module.exports = { verifyKnownEmployeeSlotSources170, selectEmployeeSlotSource170, captureApprovedEmptyDirectories, approvedEmptyDirectory, createEngineTreeRuntime170, createDeferredEngineTreeRuntime170ForGuest, createDeferredBridgeEngineTreeRuntime170ForGuest, initializeFreshEngineReceipt170, createNativeEngineTreeProvider170 };

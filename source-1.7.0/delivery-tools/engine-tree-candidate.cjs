'use strict';
// Isolated engine-directory transaction only. No production entry point, IPC,
// resource-updater integration, business/SQLite import or process termination.
// The actual Windows assistant must run outside every directory being moved.
const native = require('node:fs'), fs = native.promises, path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..'), BASE = path.join(ROOT, 'runtime/engine-tree-tests');
if (process.platform !== 'win32' || ROOT.toLowerCase() !== 'c:\\xjy-work\\xjy-web-stage1' || os.userInfo().username.toLowerCase() !== 'wdagutilityaccount') throw Error('Fixed actual offline Guest required; no Host engine transaction');
const u = require('../project/desktop/employee-update-cache.cjs');
const core = require('./initial-patch-core.cjs');
const { programPath } = require('../project/desktop/employee-update-installer.cjs');
const PURPOSE = 'xjy-isolated-engine-tree', MARKER = 'xjy-install-activation.json', SHA = /^[a-f0-9]{64}$/;
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
const requireValue = (value, code, message) => { if (!value) u.fail(code, message); };
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const inside = (root, target) => { const rel = path.relative(root, target); return rel === '' || rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel); };
const rows = files => files.map(({ path: name, size, sha256 }) => ({ path: name, size, sha256 })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

// Reuse the unchanged actual admission tool, not an environment switch. This
// metadata helper is the only child process started by this module.
for (const [relative, expected] of Object.entries({ 'stage1/sandbox-context.py': '09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249', 'stage1/validate-sandbox-context.py': '867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207' })) {
  const file = path.join(ROOT, relative), stat = native.lstatSync(file);
  requireValue(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && u.digest(native.readFileSync(file)) === expected, 'ISOLATION', '原隔离准入工具已变化');
}
const PYTHON = 'C:/Python314/python.exe';
requireValue(u.digest(native.readFileSync(PYTHON)) === '434b361fe0c5960d404974feed493db47f2603a1ace2574312104fbed0182c6f', 'ISOLATION', '公开隔离Python已变化');
const proof = JSON.parse(require('node:child_process').execFileSync(PYTHON, ['-I', '-B', '-S', path.join(ROOT, 'stage1/validate-sandbox-context.py')], { cwd: ROOT, windowsHide: true, encoding: 'utf8', maxBuffer: 65536 }));
requireValue(proof.model === 'Virtual Machine' && proof.productionDrivePresent === false && proof.nonLoopbackAddressCount === 0 && proof.inputMarkerPresent === true, 'ISOLATION', '实际离线Guest准入未通过');

function createEngineTreeCandidate(options) {
  const allowed = ['fileSystem', 'isolationRoot', 'installationDir', 'artifactDir', 'stateDir', 'dataDir', 'profileDir', 'role', 'sourceEnvelope', 'targetEnvelope', 'trust', 'processBarrier', 'now', 'checkpoint'];
  requireValue(options && typeof options === 'object' && Object.keys(options).every(key => allowed.includes(key)), 'BAD_OPTIONS', '只允许固定隔离候选参数');
  const io = options.fileSystem || fs, now = options.now || Date.now, checkpoint = options.checkpoint || (() => {}), barrier = options.processBarrier;
  requireValue(typeof now === 'function' && typeof checkpoint === 'function' && barrier && ['getCurrent', 'isAssistantAlive', 'waitClosed', 'assertClosed', 'restart'].every(key => typeof barrier[key] === 'function'), 'BAD_LIFECYCLE', '外置受信助手和正常退出屏障缺失');
  const paths = Object.fromEntries(['isolationRoot', 'installationDir', 'artifactDir', 'stateDir', 'dataDir', 'profileDir'].map(key => [key, u.safeAbsolute(options[key])]));
  const root = paths.isolationRoot, install = paths.installationDir, artifact = paths.artifactDir, state = paths.stateDir;
  requireValue(u.samePath(path.dirname(root), BASE) && /^case-[A-Za-z0-9_-]{1,80}$/.test(path.basename(root)), 'ISOLATION', '候选事务只允许专属Guest case目录');
  const names = { installationDir: 'program', artifactDir: 'candidate', stateDir: 'engine-state', dataDir: 'data', profileDir: 'profile' };
  for (const [key, name] of Object.entries(names)) requireValue(u.samePath(paths[key], path.join(root, name)), 'ISOLATION', '程序、候选、事务和资料必须分离在固定隔离目录');
  requireValue(!inside(root, process.execPath) && !inside(root, __filename) && (!process.argv[1] || !inside(root, path.resolve(process.argv[1]))), 'EXTERNAL_ASSISTANT_REQUIRED', '维护助手不能从将被切换的程序或候选目录运行');
  const role = options.role;
  requireValue(['host', 'employee'].includes(role), 'BAD_ROLE', '必须明确保留原主机或员工角色');
  const trust = readTrust(options.trust), sourceEnvelope = copyEnvelope(options.sourceEnvelope), targetEnvelope = copyEnvelope(options.targetEnvelope);
  const journalPath = path.join(state, 'journal.json'), keyPath = path.join(state, 'journal-key.bin'), lockPath = path.join(state, 'install.lock');
  const launch = { executablePath: path.join(install, trust.executableName), args: role === 'employee' ? ['--employee-client'] : [], role };
  let busy = false, keyBytes = null;

  function copyEnvelope(value) {
    requireValue(exact(value, ['catalog', 'signature']) && typeof value.catalog === 'string' && typeof value.signature === 'string', 'BAD_SIGNATURE', '固定签名目录缺失');
    return Object.freeze({ catalog: value.catalog, signature: value.signature });
  }
  function enginePath(name, executableName) {
    if (!u.safeRelative(name) || name.toLowerCase() === MARKER || /\.(?:db(?:-wal|-shm)?|sqlite3?(?:-wal|-shm)?|pem|key|pfx|docx?|xlsx?|wps|et)$/i.test(name)) return false;
    if (name.startsWith('resources/')) return programPath(name);
    if (/^locales\/[A-Za-z0-9_-]+\.pak$/.test(name)) return true;
    if (name.includes('/') || /^(?:data|profiles?|configs?|configuration|accounts?|customers?|credentials|private|backup|cache|logs?)(?:\.|$)/i.test(name)) return false;
    return name === executableName || name === 'version' || name === 'LICENSE' || /\.(?:dll|pak|bin|dat|json|txt|html)$/i.test(name);
  }
  function readTrust(value) {
    requireValue(exact(value, ['schemaVersion', 'purpose', 'publisherPublicKey', 'publisherPublicKeySha256', 'executableName', 'source', 'target']) && value.schemaVersion === 1 && value.purpose === PURPOSE && SHA.test(value.publisherPublicKeySha256 || '') && u.safeRelative(value.executableName) && !value.executableName.includes('/') && /\.exe$/i.test(value.executableName), 'BAD_TRUST', '独立完整引擎信任输入无效');
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
      requireValue(u.digest(Buffer.from(envelope.catalog)) === meta.catalogSha256, 'BAD_CATALOG', '签名目录与独立信任摘要不符');
      const policy = u.createTrustedUpdatePolicy({ trustedPublicKey: trust.publisherPublicKey, currentVersion: trust.source.programVersion, allowedFiles: meta.allowedFiles, platform: 'win32', arch: 'x64', now });
      const catalog = u.verifySignedCatalog(envelope, policy, { allowExpired: recovery });
      requireValue(catalog.version === meta.programVersion && catalog.files.length === meta.allowedFiles.length && catalog.files.every(file => enginePath(file.path, trust.executableName)), 'BAD_CATALOG', '签名必须完整覆盖同一版本引擎及资源');
      out[which] = catalog;
    }
    requireValue(out.target.sequence > out.source.sequence, 'STALE_CATALOG', '目标发布序号必须更新');
    return out;
  }
  async function exists(file) { try { await io.lstat(file, { bigint: true }); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
  async function directory(file, expected) {
    const stat = await u.assertPath(io, file, { directory: true, root });
    const identity = u.statIdentity(stat);
    if (expected) requireValue(identity === expected, 'DIRECTORY_CHANGED', '完整程序或资料目录物理身份已变化');
    return { identity, device: String(stat.dev) };
  }
  async function fixedDirectories() {
    await u.assertPath(io, BASE, { directory: true, root: ROOT });
    const top = await directory(root), fixed = {};
    for (const key of ['artifactDir', 'stateDir', 'dataDir', 'profileDir']) {
      fixed[key] = await directory(paths[key]);
      requireValue(fixed[key].device === top.device, 'CROSS_VOLUME', '候选、资料和事务目录必须同卷');
    }
    return { root: top.identity, artifact: fixed.artifactDir.identity, state: fixed.stateDir.identity, data: fixed.dataDir.identity, profile: fixed.profileDir.identity };
  }
  function validRows(files) {
    return Array.isArray(files) && files.length <= 8192 && new Set(files.map(file => String(file?.path).toLowerCase())).size === files.length && files.every(file => exact(file, ['path', 'size', 'sha256']) && u.safeRelative(file.path) && Number.isSafeInteger(file.size) && file.size >= 0 && file.size <= 1073741824 && SHA.test(file.sha256 || ''));
  }
  async function exactTree(dir, expected, expectedIdentity) {
    requireValue(validRows(expected), 'BAD_JOURNAL', '完整文件清单无效');
    const before = await directory(dir, expectedIdentity), tree = await core.inspectArtifactTree({ artifactDir: dir, fileSystem: io });
    requireValue(same(rows(tree.files), rows(expected)), 'TREE_CHANGED', '完整树有缺失、额外文件或摘要变化');
    const directories = new Set();
    for (const file of expected) { let name = path.posix.dirname(file.path); while (name !== '.') { directories.add(name); name = path.posix.dirname(name); } }
    async function walk(current, prefix = '') {
      for (const name of await io.readdir(current)) {
        const relative = prefix + name, file = path.join(current, name), stat = await io.lstat(file, { bigint: true });
        if (stat.isDirectory()) { requireValue(directories.has(relative), 'TREE_CHANGED', '完整树含未声明空目录'); await u.assertPath(io, file, { directory: true, root }); await walk(file, relative + '/'); }
      }
    }
    await walk(dir); await directory(dir, before.identity);
    return before.identity;
  }
  async function snapshot(dir) {
    const identity = (await directory(dir)).identity, tree = await core.inspectArtifactTree({ artifactDir: dir, fileSystem: io }), files = rows(tree.files);
    await exactTree(dir, files, identity);
    return { identity, files };
  }
  function activation(bytes, version) {
    let value; try { value = JSON.parse(bytes); } catch { u.fail('BAD_ACTIVATION', '原安装角色记录无效'); }
    requireValue(exact(value, ['version', 'product', 'programVersion', 'role', 'installationDir']) && value.version === 1 && value.product === core.PRODUCT && value.programVersion === version && value.role === role && u.samePath(value.installationDir, install), 'BAD_ACTIVATION', '完整引擎升级不能改变原安装身份或角色');
    return value;
  }
  function markerRow(bytes) { return { path: MARKER, size: bytes.length, sha256: u.digest(bytes) }; }
  async function program(dir, which, files, expectedIdentity, markerBytes) {
    const identity = await exactTree(dir, files, expectedIdentity), meta = trust[which];
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
  function transactionPaths(id) { return { stageDir: path.join(root, '.engine-stage-' + id), backupDir: path.join(root, '.engine-backup-' + id), failedDir: path.join(root, '.engine-failed-' + id) }; }
  function validateJournal(record, catalog) {
    const keys = ['version', 'purpose', 'transactionId', 'phase', 'paths', 'role', 'publisherPublicKeySha256', 'sourceCatalogSha256', 'targetCatalogSha256', 'sourceVersion', 'targetVersion', 'sourceEngineVersion', 'targetEngineVersion', 'identities', 'sourceFiles', 'targetFiles', 'sourceActivation', 'targetActivation', 'dataFiles', 'profileFiles', 'stageDir', 'backupDir', 'failedDir'];
    if (record?.version === 2) keys.push('runtimeWrites');
    requireValue(exact(record, keys) && (record.version === 1 || record.version === 2 && typeof record.runtimeWrites === 'boolean') && record.purpose === PURPOSE && u.UUID.test(record.transactionId || '') && ['prepared', 'old-renamed', 'new-published', 'starting', 'committed', 'rolling-back', 'rolledback', 'rollback-failed'].includes(record.phase) && same(record.paths, paths) && record.role === role && record.publisherPublicKeySha256 === trust.publisherPublicKeySha256 && record.sourceCatalogSha256 === trust.source.catalogSha256 && record.targetCatalogSha256 === trust.target.catalogSha256 && record.sourceVersion === trust.source.programVersion && record.targetVersion === trust.target.programVersion && record.sourceEngineVersion === trust.source.engineVersion && record.targetEngineVersion === trust.target.engineVersion, 'BAD_JOURNAL', '恢复记录不属于此完整候选事务');
    requireValue(record.runtimeWrites !== true || ['starting', 'committed', 'rolledback', 'rollback-failed'].includes(record.phase), 'BAD_JOURNAL', '切换阶段不能授权业务资料写入');
    requireValue(exact(record.identities, ['root', 'artifact', 'state', 'data', 'profile', 'source', 'stage']) && Object.values(record.identities).every(value => typeof value === 'string' && value.length > 0 && value.length < 240), 'BAD_JOURNAL', '恢复物理身份无效');
    const derived = transactionPaths(record.transactionId);
    for (const key of Object.keys(derived)) requireValue(record[key] === derived[key], 'BAD_JOURNAL', '恢复目录不能由journal选择任意路径');
    requireValue(typeof record.sourceActivation === 'string' && typeof record.targetActivation === 'string' && record.sourceActivation.length <= 8192 && record.targetActivation.length <= 8192, 'BAD_JOURNAL', '恢复角色原字节无效');
    const sourceBytes = Buffer.from(record.sourceActivation, 'base64'), targetBytes = Buffer.from(record.targetActivation, 'base64');
    requireValue(sourceBytes.toString('base64') === record.sourceActivation && targetBytes.toString('base64') === record.targetActivation, 'BAD_JOURNAL', '恢复角色原字节编码无效');
    activation(sourceBytes, trust.source.programVersion); activation(targetBytes, trust.target.programVersion);
    requireValue(same(record.sourceFiles, rows([...catalog.source.files, markerRow(sourceBytes)])) && same(record.targetFiles, rows([...catalog.target.files, markerRow(targetBytes)])) && validRows(record.dataFiles) && validRows(record.profileFiles), 'BAD_JOURNAL', '恢复文件清单不能更换已签程序或资料摘要');
    return { sourceBytes, targetBytes };
  }
  async function protectedTrees(record, contents = record.runtimeWrites !== true) {
    const current = await fixedDirectories();
    for (const key of ['root', 'artifact', 'state', 'data', 'profile']) requireValue(current[key] === record.identities[key], 'DIRECTORY_CHANGED', '恢复根或资料目录身份不符');
    if (contents) {
      await exactTree(paths.dataDir, record.dataFiles, record.identities.data);
      await exactTree(paths.profileDir, record.profileFiles, record.identities.profile);
    }
  }
  async function layout(record, recovery = true, contents = record.runtimeWrites !== true) {
    const catalog = catalogs(recovery), bytes = validateJournal(record, catalog);
    await protectedTrees(record, contents); await artifactTree(catalog.target, record.identities.artifact);
    const locations = { live: install, stage: record.stageDir, backup: record.backupDir, failed: record.failedDir }, found = { source: null, target: null };
    for (const [name, file] of Object.entries(locations)) {
      if (!await exists(file)) continue;
      const identity = (await directory(file)).identity;
      if (identity === record.identities.source && ['live', 'backup'].includes(name)) {
        requireValue(found.source === null, 'RECOVERY_CONFLICT', '出现多个旧程序对象');
        await program(file, 'source', record.sourceFiles, identity, bytes.sourceBytes); found.source = name;
      } else if (identity === record.identities.stage && ['live', 'stage', 'failed'].includes(name)) {
        requireValue(found.target === null, 'RECOVERY_CONFLICT', '出现多个目标程序对象');
        await program(file, 'target', record.targetFiles, identity, bytes.targetBytes); found.target = name;
      } else u.fail('RECOVERY_CONFLICT', '程序位置存在未知或替换的目录对象');
    }
    requireValue(found.source && found.target && (found.source === 'live' ? found.target !== 'live' : found.source === 'backup'), 'RECOVERY_CONFLICT', '恢复所需原目标完整树缺失');
    if (record.phase === 'committed') requireValue(found.source === 'backup' && found.target === 'live', 'RECOVERY_CONFLICT', '完成记录与完整目标位置不符');
    if (record.phase === 'rolledback') requireValue(found.source === 'live' && ['stage', 'failed'].includes(found.target), 'RECOVERY_CONFLICT', '回退记录与完整原程序位置不符');
    return found;
  }
  async function acquireLock(recordId, identities, createKey) {
    await readKey(createKey);
    if (await exists(lockPath)) {
      const before = await u.assertPath(io, lockPath, { root: state }), old = await unpack(lockPath, 8192);
      requireValue(exact(old, ['version', 'purpose', 'rootIdentity', 'stateIdentity', 'transactionId', 'pid', 'creationMarker']) && old.version === 1 && old.purpose === PURPOSE && old.rootIdentity === identities.root && old.stateIdentity === identities.state && u.UUID.test(old.transactionId || '') && Number.isSafeInteger(old.pid) && old.pid > 0 && typeof old.creationMarker === 'string' && old.creationMarker.length > 0, 'BAD_JOURNAL', '原助手锁身份无效');
      requireValue(await barrier.isAssistantAlive(old) === false, 'BUSY', '原维护助手仍在运行或身份未确认');
      requireValue(u.statIdentity(await u.assertPath(io, lockPath, { root: state })) === u.statIdentity(before), 'FILE_CHANGED', '原助手锁已变化');
      await io.unlink(lockPath);
    }
    const current = await barrier.getCurrent();
    requireValue(current && Number.isSafeInteger(current.pid) && current.pid > 0 && typeof current.creationMarker === 'string' && current.creationMarker.length > 0 && current.creationMarker.length <= 240, 'BAD_LIFECYCLE', '当前外置助手物理进程身份缺失');
    const owner = { version: 1, purpose: PURPOSE, rootIdentity: identities.root, stateIdentity: identities.state, transactionId: recordId, pid: current.pid, creationMarker: current.creationMarker }, body = await pack(owner);
    const opened = await u.openChecked(io, lockPath, 'wx+', { missing: true, root: state });
    try { await u.writeExactly(opened.handle, 0, body); await opened.handle.sync(); await u.assertHandle(io, opened, { snapshot: false, root: state }); } finally { await opened.handle.close(); }
    return async () => { requireValue(u.statIdentity(await u.assertPath(io, lockPath, { root: state })) === opened.identity && same(await unpack(lockPath, 8192), owner), 'FILE_CHANGED', '安装锁不再属于本助手'); await io.unlink(lockPath); };
  }
  async function closed(wait = false) {
    if (wait) await barrier.waitClosed({ ...launch, args: launch.args.slice() });
    requireValue(await barrier.assertClosed({ ...launch, args: launch.args.slice() }) === true, 'PROGRAM_IN_USE', '未确认全部原程序及相关子进程正常退出');
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
    await layout(record, which !== 'target', true); await closed();
    // Persist the trusted launch boundary before the signed program may write.
    // A failed journal save does not change the in-memory protection policy.
    const launching = { ...record, version: 2, runtimeWrites: true };
    await save(launching); record.version = 2; record.runtimeWrites = true;
    const result = await barrier.restart({ executablePath: launch.executablePath, args: launch.args.slice(), role });
    requireValue(result?.started === true && result.ready === true, which === 'target' ? 'TARGET_RESTART_FAILED' : 'SOURCE_RESTART_FAILED', '完整程序尚未确认按原角色正常启动');
    await layout(record, which !== 'target', false);
  }
  async function rollback(record) {
    // Authenticate and validate every input before the first rollback rename.
    await layout(record); await closed(true);
    if (record.runtimeWrites === true) {
      // Only an authorized startup may advance the data baseline. Stop it
      // normally first, retaining all business/profile writes and checkpointing.
      const data = await snapshot(paths.dataDir), profile = await snapshot(paths.profileDir);
      requireValue(data.identity === record.identities.data && profile.identity === record.identities.profile, 'DIRECTORY_CHANGED', '关闭后资料目录物理身份已变化');
      const stopped = { ...record, version: 2, runtimeWrites: false, dataFiles: data.files, profileFiles: profile.files };
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
  async function newStage(catalog, recordPaths) {
    for (const file of Object.values(recordPaths)) requireValue(!await exists(file), 'RECOVERY_CONFLICT', '新事务目录必须CreateNew');
    await directory(root); await io.mkdir(recordPaths.stageDir, { mode: 0o700 }); const stageIdentity = (await directory(recordPaths.stageDir)).identity;
    for (const spec of catalog.files) {
      await core.mkdirs(io, recordPaths.stageDir, path.posix.dirname(spec.path) === '.' ? '' : path.posix.dirname(spec.path));
      await core.copy(io, path.join(artifact, ...spec.path.split('/')), path.join(recordPaths.stageDir, ...spec.path.split('/')), spec, artifact, recordPaths.stageDir);
      await directory(recordPaths.stageDir, stageIdentity);
    }
    const marker = Buffer.from(JSON.stringify({ version: 1, product: core.PRODUCT, programVersion: trust.target.programVersion, role, installationDir: install }));
    const opened = await u.openChecked(io, path.join(recordPaths.stageDir, MARKER), 'wx+', { missing: true, root: recordPaths.stageDir });
    try { await u.writeExactly(opened.handle, 0, marker); await opened.handle.sync(); await u.assertHandle(io, opened, { snapshot: false, root: recordPaths.stageDir }); } finally { await opened.handle.close(); }
    const files = rows([...catalog.files, markerRow(marker)]);
    await program(recordPaths.stageDir, 'target', files, stageIdentity, marker);
    return { identity: stageIdentity, marker, files };
  }
  async function installCandidate() {
    if (busy) u.fail('BUSY', '此候选助手已有事务'); busy = true;
    let release, record, moved = false, committed = false, retain = false;
    try {
      const catalog = catalogs(), fixed = await fixedDirectories(); await artifactTree(catalog.target, fixed.artifact);
      const existing = await readJournal();
      if (existing) {
        await layout(existing);
        requireValue(existing.phase === 'committed', 'RECOVERY_REQUIRED', '旧事务须先明确恢复；不覆盖已保留的失败现场');
        return { installed: false, alreadyInstalled: true, version: trust.target.programVersion, engineVersion: trust.target.engineVersion, role, backupDir: existing.backupDir, restarted: false, candidateOnly: true };
      }
      requireValue(!(await io.readdir(root)).some(name => /^\.engine-(?:stage|backup|failed)-/.test(name)), 'RECOVERY_REQUIRED', '存在未绑定的旧事务目录，请先保留并核对');
      const sourceMarker = await u.readSmall(io, path.join(install, MARKER), 4096); activation(sourceMarker, trust.source.programVersion);
      const sourceFiles = rows([...catalog.source.files, markerRow(sourceMarker)]), sourceIdentity = await program(install, 'source', sourceFiles, null, sourceMarker);
      const transactionId = crypto.randomUUID(), recordPaths = transactionPaths(transactionId);
      release = await acquireLock(transactionId, fixed, true); await closed(true);
      const data = await snapshot(paths.dataDir), profile = await snapshot(paths.profileDir); await closed();
      const staged = await newStage(catalog.target, recordPaths);
      record = { version: 2, purpose: PURPOSE, transactionId, phase: 'prepared', runtimeWrites: false, paths, role, publisherPublicKeySha256: trust.publisherPublicKeySha256, sourceCatalogSha256: trust.source.catalogSha256, targetCatalogSha256: trust.target.catalogSha256, sourceVersion: trust.source.programVersion, targetVersion: trust.target.programVersion, sourceEngineVersion: trust.source.engineVersion, targetEngineVersion: trust.target.engineVersion, identities: { ...fixed, source: sourceIdentity, stage: staged.identity }, sourceFiles, targetFiles: staged.files, sourceActivation: sourceMarker.toString('base64'), targetActivation: staged.marker.toString('base64'), dataFiles: data.files, profileFiles: profile.files, ...recordPaths };
      await save(record); await layout(record, false); await closed(); await layout(record, false);
      await move(record, install, record.backupDir, 'source', () => { moved = true; }, false);
      record.phase = 'old-renamed'; await save(record); await checkpoint('old-tree-renamed', u.freeze(JSON.parse(JSON.stringify(record))));
      catalogs(); await move(record, record.stageDir, install, 'target', undefined, false);
      record.phase = 'new-published'; await save(record); await checkpoint('new-tree-published', u.freeze(JSON.parse(JSON.stringify(record))));
      record.phase = 'starting'; await save(record); await restart(record, 'target');
      record.phase = 'committed'; await save(record); committed = true; await layout(record);
      return { installed: true, version: trust.target.programVersion, engineVersion: trust.target.engineVersion, role, restarted: true, backupDir: record.backupDir, transactionId, candidateOnly: true, formalDeploymentAuthorized: false };
    } catch (error) {
      if (error.code === 'SIMULATED_POWER_LOSS') { retain = true; throw error; }
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
  async function recoverCandidate() {
    if (busy) u.fail('BUSY', '此候选助手已有事务'); busy = true;
    let release, retain = false;
    try {
      const catalog = catalogs(true), fixed = await fixedDirectories(); await artifactTree(catalog.target, fixed.artifact);
      const record = await readJournal(); if (!record) return { recovered: false, phase: 'none', candidateOnly: true };
      // No lock write, rename, restart or journal rewrite precedes these checks.
      await layout(record);
      release = await acquireLock(record.transactionId, record.identities, false); await layout(record);
      if (record.phase === 'committed') return { recovered: true, completed: true, phase: 'committed', version: trust.target.programVersion, engineVersion: trust.target.engineVersion, role, restarted: false, backupDir: record.backupDir, candidateOnly: true };
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
  return Object.freeze({ install: installCandidate, recover: recoverCandidate });
}

module.exports = { createEngineTreeCandidate };

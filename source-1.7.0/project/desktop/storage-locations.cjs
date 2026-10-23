'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID, createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { spawnSync } = require('node:child_process');
const { resolveLaunchRole, clientProfile, plainPath, employeeIdentity, localEmployeeRoot } = require('./launch-role.cjs');
const DEFAULT_ROOT = 'F:\\鑫金源珠宝资料';
function inside(root, target) { const relative = path.relative(root, target); return relative === '' || relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative); }
function checked(root, file) {
  root = path.resolve(root); file = path.resolve(file);
  if (!inside(root, file)) throw new Error('资料路径超出工作室目录');
  for (let current = file; ; current = path.dirname(current)) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error('资料目录不能使用链接');
    if (current === path.dirname(current)) break;
  }
  return file;
}
function copyTree(source, target) {
  if (fs.lstatSync(source).isSymbolicLink()) throw new Error('旧资料包含链接，迁移已停止');
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name), to = path.join(target, entry.name);
    if (entry.isSymbolicLink()) throw new Error('旧资料包含链接，迁移已停止');
    if (entry.isDirectory()) copyTree(from, to);
    else if (entry.isFile()) fs.copyFileSync(from, to);
    else throw new Error('旧资料包含不支持的文件');
  }
}
function manifest(directory) {
  const result = [];
  function visit(folder) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isSymbolicLink()) throw new Error('资料包含链接');
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) result.push({ file: path.relative(directory, file).replaceAll('\\', '/'), bytes: fs.statSync(file).size, sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex') });
    }
  }
  visit(directory); return result.sort((a, b) => a.file.localeCompare(b.file));
}
function logicalCounts(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('旧数据库完整性检查未通过');
    const result = {};
    for (const table of ['staff_users', 'local_accounts', 'customers', 'quotes', 'audit_logs']) result[table] = Number(db.prepare('SELECT COUNT(*) AS count FROM ' + table).get().count);
    return result;
  } finally { db.close(); }
}
function legacyRunning(legacyProfile) {
  if (process.platform !== 'win32') return false;
  const script = "$items=@(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq '鑫金源珠宝报价.exe' -and $_.ProcessId -ne [int]$env:XJY_MIGRATION_PID -and $_.CommandLine -and $_.CommandLine.IndexOf($env:XJY_MIGRATION_PROFILE,[StringComparison]::OrdinalIgnoreCase) -ge 0 }); if($items.Count){exit 23}else{exit 0}";
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { env: { ...process.env, XJY_MIGRATION_PROFILE: legacyProfile, XJY_MIGRATION_PID: String(process.pid) }, windowsHide: true, timeout: 15000, encoding: 'utf8' });
  if (result.error || ![0, 23].includes(result.status)) throw new Error('无法确认旧版是否已退出，请关闭旧版程序后重试');
  return result.status === 23;
}
function migrateLegacy({ root, legacyProfile, running = legacyRunning }) {
  const profileDir = checked(root, path.join(root, '程序设置')), dataDir = checked(root, path.join(root, '工作室数据'));
  const legacyData = path.join(legacyProfile, 'business-data'), legacyDb = path.join(legacyData, 'jewelry.sqlite');
  checked(root, path.join(dataDir, 'jewelry.sqlite'));
  checked(path.parse(path.resolve(legacyProfile)).root, legacyDb);
  if (fs.existsSync(path.join(dataDir, 'jewelry.sqlite'))) return { migrated: false, reason: 'F盘资料已存在，继续使用；旧C盘资料未覆盖' };
  if (fs.existsSync(checked(root, dataDir + '.print-ledger.json'))) throw new Error('F盘已有打印防重记录，但未找到对应数据库，迁移不会覆盖，请先核对资料');
  if (!fs.existsSync(legacyDb)) { fs.mkdirSync(profileDir, { recursive: true }); return { migrated: false, reason: '首次使用' }; }
  if (running(legacyProfile)) throw new Error('请先正常关闭旧版“鑫金源珠宝报价”，再打开新版。新版会迁移到F盘，C盘原资料保留。');
  const stage = checked(root, path.join(root, '.迁移暂存-' + randomUUID()));
  fs.mkdirSync(stage, { recursive: true });
  const stagedData = checked(root, path.join(stage, '工作室数据')), stagedProfile = checked(root, path.join(stage, '程序设置'));
  fs.mkdirSync(stagedData); fs.mkdirSync(stagedProfile);
  const before = logicalCounts(legacyDb);
  const sourceDb = new DatabaseSync(legacyDb, { readOnly: true });
  try { sourceDb.prepare('VACUUM INTO ?').run(path.join(stagedData, 'jewelry.sqlite')); } finally { sourceDb.close(); }
  if (fs.existsSync(path.join(legacyData, 'images'))) copyTree(path.join(legacyData, 'images'), path.join(stagedData, 'images'));
  for (const name of ['Local Storage', 'Session Storage']) if (fs.existsSync(path.join(legacyProfile, name))) copyTree(path.join(legacyProfile, name), path.join(stagedProfile, name));
  for (const name of ['workspace-connection.json', 'workspace-connection.json.identity.json', 'warranty-print-settings.json', 'image-output-settings.json', 'Local State', 'Preferences']) {
    const file = path.join(legacyProfile, name);
    if (fs.existsSync(file)) { if (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) throw new Error('旧设置文件格式无效'); fs.copyFileSync(file, path.join(stagedProfile, name)); }
  }
  const ledgerSource = legacyData + '.print-ledger.json', ledgerTarget = stagedData + '.print-ledger.json';
  if (fs.existsSync(ledgerSource)) { if (fs.lstatSync(ledgerSource).isSymbolicLink()) throw new Error('打印记录不能是链接'); fs.copyFileSync(ledgerSource, ledgerTarget); }
  const after = logicalCounts(path.join(stagedData, 'jewelry.sqlite'));
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('迁移前后数据数量不一致，原资料未修改');
  const imageSource = fs.existsSync(path.join(legacyData, 'images')) ? manifest(path.join(legacyData, 'images')) : [];
  const imageTarget = fs.existsSync(path.join(stagedData, 'images')) ? manifest(path.join(stagedData, 'images')) : [];
  if (JSON.stringify(imageSource) !== JSON.stringify(imageTarget)) throw new Error('图片迁移校验未通过，原资料未修改');
  const backups = checked(root, path.join(root, '迁移备份')); fs.mkdirSync(backups, { recursive: true });
  const backup = checked(root, path.join(backups, '旧C盘资料-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8)));
  copyTree(stage, backup);
  if (fs.existsSync(dataDir) && fs.readdirSync(dataDir).length) throw new Error('F盘目标目录已有资料，未覆盖');
  if (fs.existsSync(profileDir) && fs.readdirSync(profileDir).length) throw new Error('F盘已有设置，未覆盖；请先核对目标目录');
  // Each move target is resolved and checked inside the intended root.
  if (fs.existsSync(dataDir)) fs.rmdirSync(checked(root, dataDir));
  if (fs.existsSync(profileDir)) fs.rmdirSync(checked(root, profileDir));
  const published = [];
  try {
    // Publish the database last. It is the startup commit marker, so a failed
    // profile/ledger move cannot make the next run mistake a partial migration
    // for an already complete F-drive workspace.
    fs.renameSync(checked(root, stagedProfile), checked(root, profileDir)); published.push([profileDir, stagedProfile]);
    if (fs.existsSync(ledgerTarget)) { fs.renameSync(checked(root, ledgerTarget), checked(root, dataDir + '.print-ledger.json')); published.push([dataDir + '.print-ledger.json', ledgerTarget]); }
    fs.renameSync(checked(root, stagedData), checked(root, dataDir)); published.push([dataDir, stagedData]);
  } catch (failure) {
    let rollbackFailed = false;
    for (const [destination, original] of published.reverse()) {
      try { fs.renameSync(checked(root, destination), checked(root, original)); } catch { rollbackFailed = true; }
    }
    throw new Error('迁移发布未完成，C盘原资料和F盘备份保留。' + (rollbackFailed ? '请核对迁移暂存和备份后再启动。' : '已回退，可重新启动重试。') + failure.message);
  }
  const receipt = { migrated: true, source: legacyProfile, destination: root, backup, counts: after, imageFiles: imageTarget.length, verified: true, originalPreserved: true };
  fs.writeFileSync(checked(root, path.join(root, '迁移核验.json')), JSON.stringify(receipt, null, 2));
  return receipt;
}
function writableDirectory(directory) {
  const target = plainPath(directory); let probe;
  try { fs.mkdirSync(target, { recursive: true }); if (!fs.statSync(target).isDirectory()) return false; probe = path.join(target, '.写入检查-' + randomUUID()); fs.writeFileSync(probe, '', { flag: 'wx', mode: 0o600 }); fs.unlinkSync(probe); return true; }
  catch { if (probe) { try { fs.unlinkSync(probe); } catch {} } return false; }
}
function preserveClientSettings(source, destination) {
  plainPath(source); plainPath(destination);
  for (const name of ['workspace-connection.json', 'warranty-print-settings.json', 'image-output-settings.json', 'Local State', 'Preferences']) {
    const from = path.join(source, name), to = path.join(destination, name); plainPath(from); plainPath(to);
    if (!fs.existsSync(from) || fs.existsSync(to)) continue;
    if (!fs.lstatSync(from).isFile()) throw new Error('旧员工设置文件无效'); fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
  }
  for (const name of ['Local Storage', 'Session Storage']) {
    const from = path.join(source, name), to = path.join(destination, name); plainPath(from); plainPath(to);
    if (fs.existsSync(from) && !fs.existsSync(to)) copyTree(from, to);
  }
}
function prepareStorage({ legacyProfile, employeeClient = false, overrideDataDir, preferredRoot = DEFAULT_ROOT, portableDirectory, employeeLocalRoot, autoEmployee = false, preferredDriveAvailable, writable = writableDirectory }) {
  if (overrideDataDir) {
    const dataDir = path.resolve(overrideDataDir), root = path.dirname(dataDir), profileDir = checked(root, path.join(root, 'diagnostic-user-data'));
    fs.mkdirSync(profileDir, { recursive: true }); return { root, profileDir, dataDir: employeeClient ? null : dataDir, employeeClient, role: employeeClient ? 'employee' : 'host', imageDir: checked(root, path.join(root, '报价图片')), migration: { migrated: false, reason: '隔离诊断' } };
  }
  const root = path.resolve(preferredRoot), identity = employeeIdentity(), localRoot = path.resolve(employeeLocalRoot || localEmployeeRoot()), defaultProfile = path.join(localRoot, identity);
  const oldProfiles = [path.join(root, '员工客户端缓存', identity), ...(portableDirectory ? [path.join(path.resolve(portableDirectory), '员工本地设置', '员工客户端缓存', identity)] : []), legacyProfile].filter(Boolean);
  const candidates = [...new Set([defaultProfile, ...oldProfiles])];
  const selection = resolveLaunchRole({ employeeClient, preferredRoot: root, autoEmployee, preferredDriveAvailable, clientProfiles: candidates });
  if (selection.employeeClient) {
    const existing = candidates.filter(clientProfile);
    const selected = existing.find(profile => writable(profile));
    const profileDir = selected || plainPath(defaultProfile);
    if (!selected && !writable(profileDir)) throw new Error('当前用户的员工缓存目录无法写入，请检查本机用户权限；员工端不需要F盘');
    const wasRemembered = clientProfile(profileDir);
    if (!selected && existing[0] && existing[0] !== profileDir) preserveClientSettings(existing[0], profileDir);
    const roleFile = plainPath(path.join(profileDir, 'launch-role.json'));
    if (!fs.existsSync(roleFile)) { const temporary = roleFile + '.' + randomUUID() + '.tmp'; fs.writeFileSync(temporary, JSON.stringify({ version: 1, role: 'employee' }), { flag: 'wx', mode: 0o600 }); fs.renameSync(temporary, roleFile); }
    return { root: path.dirname(profileDir), profileDir, dataDir: null, employeeClient: true, role: 'employee', roleReason: selection.reason, startupMessage: !employeeClient && !wasRemembered ? '当前为员工连接模式。这台电脑不需要F盘，请在连接设置中填写店内主机地址和连接码，再使用自己的员工账号登录。客户和报价保存在主机，本机只保存连接设置、草稿及图片缓存。' : '', imageDir: plainPath(path.join(profileDir, '报价图片')), migration: { migrated: false, reason: '员工端只连接主机，不建立本地业务库' } };
  }
  if (!(preferredDriveAvailable ?? fs.existsSync(path.parse(root).root))) throw new Error('没有找到F盘。主机业务资料不会自动改写到其他磁盘。');
  checked(root, root); fs.mkdirSync(root, { recursive: true });
  const migration = migrateLegacy({ root, legacyProfile });
  return { root, profileDir: checked(root, path.join(root, '程序设置')), dataDir: checked(root, path.join(root, '工作室数据')), employeeClient: false, role: 'host', roleReason: selection.reason, imageDir: checked(root, path.join(root, '报价图片')), migration };
}
function createClientBackend() {
  return { auth: { status: () => ({ needsSetup: false, authenticated: false }), logout: () => {} }, dispatch: async input => input?.path === '/auth/status' ? { ok: true, status: 200, data: { needsSetup: false, authenticated: false } } : { ok: false, status: 503, data: { error: '请先连接店内主机' } }, imageResponse: async () => Response.json({ error: '请先连接主机' }, { status: 503 }), close: async () => {}, exclusive: async action => action() };
}
module.exports = { prepareStorage, migrateLegacy, createClientBackend, DEFAULT_ROOT };

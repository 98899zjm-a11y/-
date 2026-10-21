'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
function inside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}
function plainDirectory(directory) {
  const stats = fs.lstatSync(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error('请选择普通文件夹，不使用快捷链接');
  return fs.realpathSync(directory);
}
function plainFile(file, root) {
  if (!inside(root, file)) throw new Error('备份文件路径无效');
  const stats = fs.lstatSync(file);
  if (!stats.isFile() || stats.isSymbolicLink() || !inside(fs.realpathSync(root), fs.realpathSync(file))) throw new Error('备份包含无效文件或链接');
  return fs.readFileSync(file);
}
function makeBackup(runtime, destination) {
  const parent = plainDirectory(destination), live = plainDirectory(runtime.dataDir);
  if (inside(live, parent)) throw new Error('请选择本机数据文件夹以外的位置存放备份');
  const directory = path.join(parent, '鑫金源备份-' + stamp() + '-' + randomUUID().slice(0, 8));
  fs.mkdirSync(directory);
  const dbFile = path.join(directory, 'jewelry.sqlite');
  runtime.sqlite.prepare('VACUUM INTO ?').run(dbFile);
  const images = path.join(directory, 'images');
  fs.mkdirSync(images);
  const sourceImages = path.join(live, 'images');
  plainDirectory(sourceImages);
  const entries = [];
  for (const name of fs.readdirSync(sourceImages)) {
    if (name !== 'metadata.json' && !UUID.test(name)) throw new Error('本机图片文件夹包含异常文件，请检查后重新备份');
    const bytes = plainFile(path.join(sourceImages, name), sourceImages);
    fs.writeFileSync(path.join(images, name), bytes, { mode: 0o600 });
    entries.push({ name: 'images/' + name, size: bytes.length, sha256: hash(bytes) });
  }
  const dbBytes = plainFile(dbFile, directory);
  entries.unshift({ name: 'jewelry.sqlite', size: dbBytes.length, sha256: hash(dbBytes) });
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({ format: 'xjy-offline-backup', version: 1, createdAt: new Date().toISOString(), files: entries }, null, 2));
  validateBackup(directory);
  return directory;
}
function validateBackup(directory) {
  const root = plainDirectory(directory);
  let manifest;
  try { manifest = JSON.parse(plainFile(path.join(root, 'manifest.json'), root).toString('utf8')); }
  catch { throw new Error('这不是有效的鑫金源离线备份文件夹'); }
  if (manifest.format !== 'xjy-offline-backup' || manifest.version !== 1 || !Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > 100000) throw new Error('备份版本或清单无效');
  const names = new Set();
  plainDirectory(path.join(root, 'images'));
  if (fs.readdirSync(root).some(name => !['manifest.json', 'jewelry.sqlite', 'images'].includes(name))) throw new Error('备份包含清单之外的文件');
  for (const file of manifest.files) {
    if (!file || typeof file.name !== 'string' || !(file.name === 'jewelry.sqlite' || file.name === 'images/metadata.json' || (file.name.startsWith('images/') && UUID.test(file.name.slice(7)))) || names.has(file.name) || !Number.isSafeInteger(file.size) || file.size < 0 || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error('备份文件清单无效');
    const bytes = plainFile(path.join(root, ...file.name.split('/')), root);
    if (bytes.length !== file.size || hash(bytes) !== file.sha256) throw new Error('备份文件缺失或已损坏，请使用另一份完整备份');
    names.add(file.name);
  }
  if (!names.has('jewelry.sqlite')) throw new Error('备份数据库缺失');
  const pictureNames = fs.readdirSync(path.join(root, 'images'));
  if (pictureNames.some(name => !names.has('images/' + name))) throw new Error('备份图片文件清单不完整');
  if (pictureNames.some(name => UUID.test(name)) && !names.has('images/metadata.json')) throw new Error('备份图片索引缺失');
  const header = plainFile(path.join(root, 'jewelry.sqlite'), root).subarray(0, 16).toString('binary');
  if (header !== 'SQLite format 3\0') throw new Error('备份数据库格式无效');
  const database = new DatabaseSync(path.join(root, 'jewelry.sqlite'), { readOnly: true });
  try {
    if (database.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('备份数据库完整性检查未通过');
    const tables = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
    for (const table of ['staff_users', 'local_accounts', 'customers', 'quotes', 'company_settings', 'media_assets', 'audit_logs', 'desktop_migrations', 'quote_attachments', 'styles', 'staff_preferences']) if (!tables.has(table)) throw new Error('备份缺少本机业务数据表');
    if (database.prepare('PRAGMA foreign_key_check').all().length) throw new Error('备份记录关系检查未通过');
  } finally { database.close(); }
  const metadataFile = path.join(root, 'images', 'metadata.json');
  const metadata = names.has('images/metadata.json') ? JSON.parse(plainFile(metadataFile, root).toString('utf8')) : {};
  if (!metadata || Array.isArray(metadata) || typeof metadata !== 'object') throw new Error('备份图片索引无效');
  for (const key of Object.keys(metadata)) {
    if (!key.startsWith('images/') || !UUID.test(key.slice(7)) || !names.has(key)) throw new Error('备份图片不完整');
  }
  for (const name of pictureNames) if (UUID.test(name) && !metadata['images/' + name]) throw new Error('备份图片索引不完整');
  return { directory: root, manifest };
}
function prepareRestore(backupDirectory, liveDirectory) {
  const verified = validateBackup(backupDirectory), live = path.resolve(liveDirectory);
  const parent = plainDirectory(path.dirname(live));
  if (inside(live, verified.directory) || inside(verified.directory, live)) throw new Error('备份文件夹必须与当前数据文件夹分开');
  const stage = path.join(parent, path.basename(live) + '.restore-' + randomUUID());
  if (!inside(parent, stage)) throw new Error('恢复目标路径无效');
  fs.mkdirSync(stage); fs.mkdirSync(path.join(stage, 'images'));
  for (const entry of verified.manifest.files) {
    const bytes = plainFile(path.join(verified.directory, ...entry.name.split('/')), verified.directory);
    if (hash(bytes) !== entry.sha256) throw new Error('备份文件在恢复时发生变化，请重新选择');
    fs.writeFileSync(path.join(stage, ...entry.name.split('/')), bytes, { mode: 0o600 });
  }
  fs.writeFileSync(path.join(stage, 'manifest.json'), JSON.stringify(verified.manifest, null, 2));
  validateBackup(stage);
  return stage;
}
function commitRestore(stageDirectory, liveDirectory) {
  const live = path.resolve(liveDirectory), parent = plainDirectory(path.dirname(live));
  const stage = plainDirectory(stageDirectory);
  if (path.dirname(stage) !== parent || !path.basename(stage).startsWith(path.basename(live) + '.restore-')) throw new Error('恢复暂存位置无效');
  validateBackup(stage);
  plainDirectory(live);
  const previous = path.join(parent, path.basename(live) + '.before-restore-' + stamp() + '-' + randomUUID().slice(0, 8));
  if (!inside(parent, previous) || !inside(parent, live)) throw new Error('恢复路径无效');
  fs.renameSync(live, previous);
  try { fs.renameSync(stage, live); }
  catch (error) { fs.renameSync(previous, live); throw error; }
  return { previous, live };
}

module.exports = { makeBackup, validateBackup, prepareRestore, commitRestore, inside };

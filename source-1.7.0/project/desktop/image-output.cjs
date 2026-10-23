'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
function folder(value,guardPath) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0')) throw new Error('图片保存目录无效');
  const result = guardPath?guardPath(path.resolve(value)):path.resolve(value);
  for (let current = result; ; current = path.dirname(current)) { if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error('图片目录不能是链接'); if (current === path.dirname(current)) break; }
  fs.mkdirSync(result, { recursive: true });
  if(guardPath)guardPath(result);
  if (!fs.statSync(result).isDirectory()) throw new Error('图片保存位置不是文件夹');
  return result;
}
function safeName(value, extension) {
  const name = typeof value === 'string' ? value.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\.(png|jpe?g|webp|csv|txt)$/i, '').replace(/[. ]+$/, '').trim().slice(0, 85) : '';
  return (name && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ? name : '珠宝报价') + '.' + extension;
}
function createImageOutput({ settingsFile, defaultFolder,guardPath }) {
  if(guardPath!==undefined&&typeof guardPath!=='function')throw TypeError('Output isolation requires a trusted path guard');
  const checked=file=>guardPath?guardPath(path.resolve(file)):file;checked(settingsFile);checked(defaultFolder);
  function read() { checked(settingsFile);if (!fs.existsSync(settingsFile)) return {}; const value = JSON.parse(fs.readFileSync(settingsFile, 'utf8')); if (value.version !== 1 || !value.folders || typeof value.folders !== 'object') throw new Error('图片目录设置无法读取，请重新选择保存目录'); return value.folders; }
  function directory(user) {
    const selected = read()[user.id];
    if(selected)checked(selected);
    const label = (user.name || user.username || '员工').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 30);
    const available = selected && path.isAbsolute(selected) && fs.existsSync(path.parse(path.resolve(selected)).root) ? selected : undefined;
    return folder(available || path.join(defaultFolder, label + '-' + user.id.slice(0, 8)),guardPath);
  }
  function select(user, selected) {
    const location = folder(selected,guardPath), folders = { ...read(), [user.id]: location };
    fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
    const temporary = checked(settingsFile + '.' + randomUUID() + '.tmp'); fs.writeFileSync(temporary, JSON.stringify({ version: 1, folders }, null, 2), { mode: 0o600 }); fs.renameSync(temporary, checked(settingsFile));
    return location;
  }
  function save(user, bytes, requestedName, extension) {
    if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 45 * 1024 * 1024 || !['png', 'jpg', 'webp', 'csv', 'txt'].includes(extension)) throw new Error('保存文件格式或大小无效');
    const location = directory(user), base = safeName(requestedName, extension);
    const suffix = new Date().toISOString().replace(/[-:.]/g, '') + '-' + randomUUID().slice(0, 8);
    const file = path.join(location, base.slice(0, -(extension.length + 1)) + '-' + suffix + '.' + extension);
    fs.writeFileSync(checked(file), bytes, { flag: 'wx', mode: 0o600 });
    return file;
  }
  return { directory, select, save };
}
module.exports = { createImageOutput };

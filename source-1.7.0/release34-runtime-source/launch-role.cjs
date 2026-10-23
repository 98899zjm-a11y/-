'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
function plainPath(value) {
  const result = path.resolve(value);
  for (let current = result; ; current = path.dirname(current)) { if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error('员工缓存和资料目录不能使用链接'); if (current === path.dirname(current)) break; }
  return result;
}
function readSmall(file) {
  plainPath(file);
  if (!fs.existsSync(file)) return null;
  const stat = fs.lstatSync(file); if (!stat.isFile() || stat.size > 8192) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}
function clientProfile(profile) {
  if (!profile || !fs.existsSync(profile)) return false;
  plainPath(profile); if (!fs.lstatSync(profile).isDirectory()) return false;
  return readSmall(path.join(profile, 'launch-role.json'))?.role === 'employee' || readSmall(path.join(profile, 'workspace-connection.json'))?.mode === 'client';
}
function employeeIdentity() { return (os.hostname() + '-' + os.userInfo().username).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 90); }
function localEmployeeRoot() { return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), '鑫金源珠宝员工端'); }
function resolveLaunchRole({ employeeClient = false, explicitHost = false, preferredRoot, autoEmployee = false, preferredDriveAvailable, clientProfiles = [] }) {
  if (employeeClient) return { employeeClient: true, reason: '明确使用员工连接入口' };
  if (explicitHost) return { employeeClient: false, reason: '明确选择本机主机模式' };
  if (clientProfiles.some(clientProfile)) return { employeeClient: true, reason: '继续使用已记忆的员工连接模式' };
  const database = plainPath(path.join(preferredRoot, '工作室数据', 'jewelry.sqlite'));
  if (fs.existsSync(database)) return { employeeClient: false, reason: '使用已有F盘主机工作室' };
  const driveAvailable = preferredDriveAvailable ?? fs.existsSync(path.parse(path.resolve(preferredRoot)).root);
  if (autoEmployee && !driveAvailable) return { employeeClient: true, reason: '这台电脑没有F盘，自动使用员工连接模式' };
  return { employeeClient: true, reason: '尚未明确选择主机，使用员工连接模式；盘符存在不代表主机身份' };
}
module.exports = { resolveLaunchRole, clientProfile, plainPath, employeeIdentity, localEmployeeRoot };

'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash, randomUUID, timingSafeEqual } = require('node:crypto');
const { plainPath } = require('./launch-role.cjs');
const fail = message => { throw new Error(message); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
function username(value, empty = false) {
  if (typeof value !== 'string') fail('请输入要记住的用户名');
  const result = value.trim().normalize('NFKC').toLowerCase();
  if (empty && !result) return '';
  if (!/^[\p{L}\p{N}._-]{2,48}$/u.test(result)) fail('用户名格式无效');
  return result;
}
function scopeForConnection(info, dataDir) {
  if (!info || !['standalone', 'host', 'client'].includes(info.mode)) fail('连接信息尚未就绪');
  if (info.mode === 'client') {
    const host = info.host, port = info.port;
    if (typeof host !== 'string' || !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.split('.').some(part => Number(part) > 255 || String(Number(part)) !== part) || !Number.isInteger(port) || port < 1024 || port > 65535) fail('先设置主机连接，再记住该主机的登录信息');
    return 'lan:' + host + ':' + port;
  }
  if (!dataDir) fail('本机资料位置尚未就绪');
  return 'local:' + path.resolve(dataDir).toLowerCase();
}
function createLoginMemory({ file, safeStorage, platform = process.platform, deviceId = os.hostname() + '\\' + os.userInfo().username }) {
  file = plainPath(file);
  const deviceBinding = createHash('sha256').update(platform + ':' + deviceId).digest('hex');
  const scopeHash = scope => { if (typeof scope !== 'string' || !/^(?:local|lan):/.test(scope) || scope.length > 4096) fail('登录记忆作用域无效'); return createHash('sha256').update(scope).digest('hex'); };
  function available() { try { return platform === 'win32' && typeof safeStorage?.encryptString === 'function' && typeof safeStorage?.decryptString === 'function' && safeStorage.isEncryptionAvailable() === true; } catch { return false; } }
  function readFile() {
    plainPath(file); if (!fs.existsSync(file)) return { version: 1, scopes: [] };
    try {
      const stat = fs.lstatSync(file); if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw new Error();
      const value = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!object(value) || value.version !== 1 || Object.keys(value).some(key => !['version', 'scopes'].includes(key)) || !Array.isArray(value.scopes) || value.scopes.length > 256) throw new Error();
      const hashes = new Set(); let total = 0;
      for (const entry of value.scopes) {
        if (!object(entry) || Object.keys(entry).some(key => !['key', 'lastUsername', 'accounts'].includes(key)) || !/^[a-f0-9]{64}$/.test(entry.key) || hashes.has(entry.key) || username(entry.lastUsername, true) !== entry.lastUsername || !Array.isArray(entry.accounts)) throw new Error();
        hashes.add(entry.key); const names = new Set();
        for (const account of entry.accounts) { if (!object(account) || Object.keys(account).some(key => !['username', 'ciphertext'].includes(key)) || username(account.username) !== account.username || names.has(account.username) || account.ciphertext !== undefined && (typeof account.ciphertext !== 'string' || account.ciphertext.length > 4096 || !/^[A-Za-z0-9+/]+={0,2}$/.test(account.ciphertext))) throw new Error(); names.add(account.username); total++; }
      }
      if (total > 1024) throw new Error(); return value;
    } catch { fail('登录记忆文件无法读取；可继续手动登录，请检查本机登录记忆文件'); }
  }
  function write(value) {
    plainPath(file); fs.mkdirSync(path.dirname(file), { recursive: true }); const temporary = file + '.' + randomUUID() + '.tmp'; let handle;
    try { handle = fs.openSync(temporary, 'wx', 0o600); fs.writeFileSync(handle, JSON.stringify(value)); fs.fsyncSync(handle); fs.closeSync(handle); handle = undefined; fs.renameSync(temporary, file); }
    catch { if (handle !== undefined) fs.closeSync(handle); try { fs.unlinkSync(temporary); } catch {} fail('登录信息未能保存，请检查本机缓存目录权限'); }
  }
  function entry(data, key) { let found = data.scopes.find(item => item.key === key); if (!found) { if (data.scopes.length >= 256) fail('已记忆的工作室过多，请清理旧登录信息'); found = { key, lastUsername: '', accounts: [] }; data.scopes.push(found); } return found; }
  function account(entry, name) { let found = entry.accounts.find(item => item.username === name); if (!found) { found = { username: name }; entry.accounts.push(found); } return found; }
  function read(scope, requestedUsername) {
    const key = scopeHash(scope), data = readFile(), found = data.scopes.find(item => item.key === key), name = requestedUsername === undefined ? found?.lastUsername || '' : username(requestedUsername, true);
    const saved = found?.accounts.find(item => item.username === name), hasPassword = Boolean(saved?.ciphertext), result = { username: name, hasPassword, available: available(), scopeKey: key, password: '' };
    if (!hasPassword) return result;
    if (!result.available) return { ...result, error: '本机安全加密不可用，无法读取记住的密码；可清除后手动登录' };
    try {
      const decrypted = JSON.parse(safeStorage.decryptString(Buffer.from(saved.ciphertext, 'base64')));
      if (!object(decrypted) || decrypted.version !== 1 || decrypted.deviceBinding !== deviceBinding || decrypted.scopeKey !== key || decrypted.username !== name || typeof decrypted.password !== 'string' || decrypted.password.length < 8 || decrypted.password.length > 128 || Object.keys(decrypted).some(key => !['version', 'deviceBinding', 'scopeKey', 'username', 'password'].includes(key))) throw new Error();
      return { ...result, password: decrypted.password };
    } catch { return { ...result, error: '记住的密码无法在当前Windows用户或设备上解密；请清除后重新输入' }; }
  }
  function rememberUsername(scope, value) { const data = readFile(), found = entry(data, scopeHash(scope)), name = username(value); found.lastUsername = name; account(found, name); write(data); return { ok: true, username: name }; }
  function forgetPassword(scope, value) { const data = readFile(), key = scopeHash(scope), found = data.scopes.find(item => item.key === key), name = value === undefined ? found?.lastUsername || '' : username(value, true); if (!found || !name) return { ok: true, username: name }; const saved = found.accounts.find(item => item.username === name); if (saved) delete saved.ciphertext; found.lastUsername = name; write(data); return { ok: true, username: name }; }
  async function rememberLogin(scope, input, verify) {
    if (!object(input) || Object.keys(input).some(key => !['username', 'password', 'rememberPassword'].includes(key)) || typeof input.rememberPassword !== 'boolean') fail('记住登录信息格式无效');
    const name = username(input.username); rememberUsername(scope, name);
    if (!input.rememberPassword) return forgetPassword(scope, name);
    if (!available()) fail('本机安全加密不可用，已仅记住用户名，密码未保存');
    if (typeof input.password !== 'string' || input.password.length < 8 || input.password.length > 128 || typeof verify !== 'function') fail('密码未通过验证，未保存');
    let verified; try { verified = await verify({ username: name, password: input.password }); } catch { fail('登录验证暂时不可用，已仅记住用户名，密码未保存'); }
    if (!verified || username(verified.username || '') !== name) fail('当前密码未通过工作室验证，密码未保存；请重新输入或清除记忆');
    const key = scopeHash(scope); let ciphertext;
    try { ciphertext = safeStorage.encryptString(JSON.stringify({ version: 1, deviceBinding, scopeKey: key, username: name, password: input.password })).toString('base64'); }
    catch { fail('本机密码加密失败，已仅记住用户名，密码未保存'); }
    const data = readFile(), found = entry(data, key); account(found, name).ciphertext = ciphertext; found.lastUsername = name; write(data); return { ok: true, username: name };
  }
  return { available, scopeKey: scopeHash, read, rememberUsername, forgetPassword, rememberLogin };
}
function createLoginReceipt({ clock = Date.now } = {}) {
  let current = null, timer = null;
  const digest = value => createHash('sha256').update(value).digest();
  const clear = () => { current = null; if (timer) clearTimeout(timer); timer = null; };
  return {
    clear,
    record(scope, input, response) {
      clear();
      try {
        if (!response?.ok || !response.data?.authenticated || !response.data.user?.id || typeof input?.password !== 'string' || input.password.length < 8 || input.password.length > 128 || username(input.username) !== username(response.data.user.username)) return;
        current = { scope, user: { id: response.data.user.id, username: username(response.data.user.username) }, digest: digest(input.password), createdAt: clock() };
        timer = setTimeout(clear, 60000); timer.unref?.();
      } catch { current = null; }
    },
    consume(scope, userId, credentials) {
      const saved = current; clear();
      try { if (!saved || clock() - saved.createdAt > 60000 || clock() < saved.createdAt || saved.scope !== scope || saved.user.id !== userId || saved.user.username !== username(credentials.username) || typeof credentials.password !== 'string' || !timingSafeEqual(saved.digest, digest(credentials.password))) return null; return saved.user; }
      catch { return null; }
    },
  };
}
module.exports = { createLoginMemory, createLoginReceipt, scopeForConnection };

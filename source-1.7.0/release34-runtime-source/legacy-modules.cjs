'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const erpPolicy = require('./erp-policy.cjs');

const MODULES = Object.freeze({
  ledger: { label: '财务系统', version: '1.3.0', file: 'xjy-ledger.exe', db: 'ledger.db', environment: 'LEDGER_DATA', tables: ['users', 'sales', 'stock_items', 'material_stock', 'settings'] },
  inventory: { label: '珠宝库管', version: '1.9.0', file: 'xjy-inventory.exe', db: 'stockcheck.db', environment: 'STOCKCHECK_DATA', tables: ['users', 'skus', 'stock_moves', 'count_sessions', 'settings'] },
});
const MAX_UPLOAD = 48 * 1024 * 1024;
const MAX_DOWNLOAD = 64 * 1024 * 1024;
const HOP_HEADERS = new Set(['host', 'connection', 'proxy-connection', 'keep-alive', 'transfer-encoding', 'te', 'trailer', 'upgrade', 'content-length', 'x-xjy-module-token', 'forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto']);

function failure(message, status = 400) { const error = new Error(message); error.status = status; return error; }
function known(id) { if (!Object.hasOwn(MODULES, id)) throw failure('未知的业务模块。'); return MODULES[id]; }
function sha(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function assertNoLinks(value) {
  if (globalThis.__xjyStage1Guard) return globalThis.__xjyStage1Guard.assertPath(value);
  const absolute = path.resolve(value);
  if (!path.isAbsolute(value) || absolute.startsWith('\\\\')) throw failure('请选择本机的完整数据目录。');
  let current = absolute;
  while (true) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw failure('数据与程序路径不能使用链接或目录联接。');
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return absolute;
}
function ensurePrivateDirectory(directory) {
  const absolute = assertNoLinks(directory);
  fs.mkdirSync(absolute, { recursive: true, mode: 0o700 });
  if (!fs.statSync(absolute).isDirectory()) throw failure('程序缓存位置不是目录。');
  return absolute;
}
function validateDataDirectory(id, directory) {
  const definition = known(id);
  if (typeof directory !== 'string' || !directory.trim()) throw failure('请选择已有模块的数据目录。');
  const absolute = assertNoLinks(directory);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isDirectory()) throw failure('数据目录不存在，不会自动建立空账套。');
  for (const filename of [definition.db, 'secret.key']) {
    const file = path.join(absolute, filename);
    assertNoLinks(file);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw failure(`数据目录必须包含 ${definition.db} 和 secret.key。`);
  }
  const database = path.join(absolute, definition.db);
  const descriptor = fs.openSync(database, 'r');
  const signature = Buffer.alloc(16);
  try { fs.readSync(descriptor, signature, 0, 16, 0); } finally { fs.closeSync(descriptor); }
  if (signature.toString('binary') !== 'SQLite format 3\0') throw failure('所选文件不是有效的模块数据库。');
  const key = fs.readFileSync(path.join(absolute, 'secret.key'), 'utf8').trim();
  if (!key || key.length > 4096) throw failure('所选目录的登录密钥无效。');
  let db;
  try {
    db = new DatabaseSync(database, { readOnly: true });
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
    if (!definition.tables.every(name => tables.has(name))) throw failure('所选数据库属于其他模块。');
    if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) throw failure('所选模块没有已有账号，不会新建默认管理员。');
  } catch (error) {
    if (error.status) throw error;
    throw failure('所选数据库无法读取，请检查完整的数据目录。');
  } finally { db?.close(); }
  return absolute;
}
function canonicalPath(input) {
  if (typeof input !== 'string' || input.length > 8192 || !input.startsWith('/') || input.startsWith('//') || /[\\\u0000-\u001f\u007f#]/.test(input)) throw failure('模块页面地址无效。');
  let url;
  try { url = new URL(input, 'http://127.0.0.1'); } catch { throw failure('模块页面地址无效。'); }
  if (url.origin !== 'http://127.0.0.1' || url.pathname + url.search !== input) throw failure('模块页面地址必须是规范的相对路径。');
  let decoded;
  try { decoded = decodeURIComponent(url.pathname); } catch { throw failure('模块页面地址编码无效。'); }
  if (/[\\\u0000-\u001f\u007f]/.test(decoded) || decoded.startsWith('//') || decoded.split('/').some(item => item === '.' || item === '..')) throw failure('模块页面地址无效。');
  if (decoded.startsWith('/_xjy/')) throw failure('内部模块管理页面不可直接访问。', 403);
  return input;
}
function decodeBody(value) {
  if (value === undefined || value === '') return Buffer.alloc(0);
  if (typeof value !== 'string' || value.length > Math.ceil(MAX_UPLOAD / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw failure('上传内容无效或超过48MB。', 413);
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length > MAX_UPLOAD) throw failure('上传内容超过48MB。', 413);
  return bytes;
}
function safeRequestHeaders(headers) {
  if (headers === undefined) return {};
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) throw failure('模块请求头无效。');
  const output = {};
  let size = 0;
  for (const [name, value] of Object.entries(headers)) {
    const normalized = name.toLowerCase();
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(normalized)) throw failure('模块请求头无效。');
    if (HOP_HEADERS.has(normalized) || normalized.startsWith('x-xjy-')) continue;
    if (typeof value !== 'string' || /[\r\n\u0000]/.test(value)) throw failure('模块请求头无效。');
    size += name.length + value.length;
    if (size > 64 * 1024) throw failure('模块请求头过大。');
    // Origin and Referer come from the controlled gateway. They must never be
    // interpreted as proxy destinations; originals may use them for CSRF.
    output[normalized] = value;
  }
  return output;
}
function requestLocal(port, token, input, timeout = 120000) {
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port, path: input.path, method: input.method || 'GET',
      headers: { ...input.headers, 'x-xjy-module-token': token, 'content-length': input.body?.length || 0 }, agent: false }, response => {
      const chunks = []; let size = 0;
      response.on('data', chunk => { size += chunk.length; if (size > MAX_DOWNLOAD) response.destroy(failure('模块下载文件超过64MB。', 413)); else chunks.push(chunk); });
      response.on('error', reject);
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, bytes: Buffer.concat(chunks) }));
    });
    request.on('error', reject);
    request.setTimeout(timeout, () => request.destroy(failure('业务模块响应超时，请稍后重试。', 503)));
    request.end(input.body || undefined);
  });
}
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer(); server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(error => error ? reject(error) : resolve(port)); });
  });
}
function wait(milliseconds) { return new Promise(resolve => setTimeout(resolve, milliseconds)); }
function alive(child) { return Boolean(child && child.exitCode === null && child.signalCode === null && !child.killed); }
function validateActor(actor, id) {
  if (!actor || typeof actor !== 'object' || actor.module !== id || !['admin', 'employee'].includes(actor.role) ||
      !['disabled', 'view', 'operate', 'manage'].includes(actor.access) ||
      !['staffId', 'userId'].every(key => typeof actor[key] === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(actor[key])) ||
      typeof actor.name !== 'string' || !actor.name.trim() || actor.name.length > 100 || /[\x00-\x1f\x7f]/.test(actor.name) ||
      !Number.isSafeInteger(actor.grantRevision) || actor.grantRevision < 0 || (actor.role === 'admin' && actor.access !== 'manage')) throw failure('主账号权限身份无效。', 403);
  if (actor.access === 'disabled') throw failure('管理员尚未授权此业务模块。', 403);
  return actor;
}
function signPrincipal(token, actor, requestedPath, method, body, issuedAt = Date.now()) {
  validateActor(actor, actor.module);
  const url = new URL(requestedPath, 'http://127.0.0.1');
  const principal = { v: 1, module: actor.module, staffId: actor.staffId, userId: actor.userId, name: actor.name,
    role: actor.role, access: actor.access, grantRevision: actor.grantRevision, issuedAt, expiresAt: issuedAt + 30000,
    nonce: crypto.randomUUID(), method, decodedPath: decodeURIComponent(url.pathname), query: url.search.slice(1), bodySha256: sha(body) };
  if (erpPolicy.isErpPath(requestedPath)) {
    erpPolicy.routeFor(requestedPath, method);
    if (actor.module !== 'ledger') throw failure('ERP需要财务模块身份。', 403);
    principal.protocolVersion = 2;
    principal.capabilities = [...erpPolicy.validateCapabilities(actor)];
  }
  const encoded = Buffer.from(JSON.stringify(principal)).toString('base64url');
  return { 'x-xjy-principal': encoded, 'x-xjy-principal-signature': crypto.createHmac('sha256', token).update(encoded).digest('hex') };
}
async function terminate(child, state, strict = false) {
  if (!alive(child)) return;
  if (state?.ready && state.child === child) {
    try {
      const response = await requestLocal(state.port, state.token, { path: '/_xjy/shutdown', method: 'POST' }, 3000);
      if (response.status === 202) {
        for (let i = 0; i < 250 && alive(child); i++) await wait(100);
        if (!alive(child)) return;
      }
    } catch { /* Escalate only this registered owned process tree. */ }
  }
  if (strict && alive(child)) throw failure('业务模块未确认结束写入，已取消一致性备份。',503);
  if (process.platform === 'win32') {
    if (globalThis.__xjyStage1Guard) { child.kill(); }
    else {
    await new Promise(resolve => {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, shell: false, stdio: 'ignore' });
      killer.once('error', resolve); killer.once('exit', resolve);
    });
    }
  } else child.kill('SIGTERM');
  for (let i = 0; i < 50 && alive(child); i++) await wait(100);
  if (alive(child)) throw failure('内部模块尚未退出，请稍后再关闭程序。', 503);
}

function createLegacyModules({ settingsFile, runtimeDir, packagedDir, releaseContext, ocrServiceFactory }) {
  settingsFile = assertNoLinks(settingsFile);
  runtimeDir = assertNoLinks(runtimeDir);
  packagedDir = assertNoLinks(packagedDir);
  if (releaseContext && globalThis.__xjyStage1Guard) throw failure('隔离模块不能使用发布入口。', 503);
  const ocrLifecycle=require('./module-ocr-lifecycle.cjs').createModuleOcrLifecycle({factory:ocrServiceFactory});
  async function childEnvironment(id, directory, executable, token) {
    const env=releaseContext?require('./legacy-release-context.cjs').prepareReleaseEnvironment({ moduleId:id,dataDir:directory,codeDir:path.dirname(executable),token,releaseContext }):{ ...process.env, [MODULES[id].environment]:directory, XJY_MODULE_TOKEN:token };
    return ocrLifecycle.environment(id,env);
  }
  const settings = { version: 1, modules: {} };
  const states = new Map(Object.keys(MODULES).map(id => [id, { child: null, port: null, token: null, ready: false, starting: null, error: null }]));
  let closing = false; let closePromise;
  if (fs.existsSync(settingsFile)) {
    let saved;
    try {
      saved = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
      if (saved.version !== 1 || !saved.modules || typeof saved.modules !== 'object' || Array.isArray(saved.modules) || Object.keys(saved.modules).some(id => !Object.hasOwn(MODULES, id))) throw failure('模块配置格式无效。');
      for (const [id, entry] of Object.entries(saved.modules)) {
        if (!entry || Object.keys(entry).some(key => key !== 'dataDir') || typeof entry.dataDir !== 'string') throw failure('模块配置格式无效。');
        settings.modules[id] = { dataDir: assertNoLinks(entry.dataDir) };
      }
    } catch (error) {
      if (error.code === 'ISOLATION') throw error;
      settings.modules = {};
      for (const state of states.values()) state.error = '模块配置损坏，请重新选择已有数据目录；销售功能可正常使用。';
    }
  }
  function status() {
    return { modules: Object.entries(MODULES).map(([id, definition]) => {
      const state = states.get(id);
      return { id, label: definition.label, version: definition.version, configured: Boolean(settings.modules[id]), running: state.ready && alive(state.child), ...(state.error ? { error: state.error } : {}) };
    }) };
  }
  function persist() {
    ensurePrivateDirectory(path.dirname(settingsFile));
    const temporary = settingsFile + '.' + crypto.randomUUID() + '.tmp';
    try {
      const descriptor = fs.openSync(temporary, 'wx', 0o600);
      try { fs.writeFileSync(descriptor, JSON.stringify(settings, null, 2)); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
      fs.renameSync(temporary, settingsFile);
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
  async function configure(id, dataDir) {
    if (closing) throw failure('程序正在关闭。', 503);
    known(id);
    const valid = validateDataDirectory(id, dataDir);
    const state = states.get(id);
    if (state.starting) await state.starting.catch(() => {});
    await terminate(state.child, state);
    state.child = null; state.ready = false; state.error = null;
    const previous = settings.modules[id];
    settings.modules[id] = { dataDir: valid };
    try { persist(); } catch (error) { if (previous) settings.modules[id] = previous; else delete settings.modules[id]; throw error; }
    return status();
  }
  function verifiedExecutable(id) {
    const definition = known(id);
    if (releaseContext) {
      ensurePrivateDirectory(runtimeDir);
      return require('./module-bundle.cjs').materializeModuleBundle({id,version:definition.version,packagedDir,runtimeDir}).executable;
    }
    const manifestPath = path.join(packagedDir, 'manifest.json');
    assertNoLinks(manifestPath);
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch { throw failure('内部模块安装文件缺失或损坏。', 503); }
    const entries = manifest?.modules;
    const entry = Array.isArray(entries) ? entries.find(item => item.id === id) : null;
    if (manifest.version !== 1 || !entry || entry.version !== definition.version || entry.file !== definition.file || !/^[a-f0-9]{64}$/.test(entry.sha256) || !Number.isSafeInteger(entry.size) || entry.size < 1024 || entry.size > 256 * 1024 * 1024) throw failure('内部模块安装清单无效。', 503);
    const source = globalThis.__xjyStage1Guard ? path.join(packagedDir,'xjy-'+id,definition.file) : path.join(packagedDir, definition.file);
    assertNoLinks(source);
    const bytes = fs.readFileSync(source);
    if (bytes.length !== entry.size || sha(bytes) !== entry.sha256 || bytes.subarray(0, 2).toString() !== 'MZ') throw failure('内部模块安装文件校验失败。', 503);
    if (globalThis.__xjyStage1Guard) {
      if(entry.runtimeMode!=='onedir'||!Array.isArray(entry.files)||!entry.files.length)throw failure('隔离模块目录清单缺失。',503);
      for(const item of entry.files){if(typeof item.path!=='string'||item.path.split('/').some(x=>!x||x==='.'||x==='..'||/[\\:]/.test(x))||!/^[a-f0-9]{64}$/.test(item.sha256))throw failure('隔离模块文件路径无效。',503);const file=assertNoLinks(path.join(path.dirname(source),item.path));if(fs.statSync(file).size!==item.size||sha(fs.readFileSync(file))!==item.sha256)throw failure('隔离模块文件被修改。',503);}
      return source;
    }
    ensurePrivateDirectory(runtimeDir);
    const target = path.join(runtimeDir, `${id}-${definition.version}-${entry.sha256.slice(0, 16)}.exe`);
    assertNoLinks(target);
    if (fs.existsSync(target)) {
      if (!fs.statSync(target).isFile() || sha(fs.readFileSync(target)) !== entry.sha256) throw failure('内部模块运行文件被修改，已拒绝启动。', 503);
    } else {
      const temporary = target + '.' + crypto.randomUUID() + '.tmp';
      try { fs.writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o700 }); fs.renameSync(temporary, target); }
      finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    }
    return target;
  }
  async function createData(id, directory, authority = {}) {
    known(id);
    const actor = validateActor(authority.actor, id);
    if (actor.role !== 'admin' || actor.access !== 'manage') throw failure('只有主程序管理员可以新建业务资料。', 403);
    if (closing) throw failure('程序正在关闭。', 503);
    const target = assertNoLinks(directory);
    if (fs.existsSync(target) && (!fs.statSync(target).isDirectory() || fs.readdirSync(target).length)) throw failure('新建资料必须选择新的或完全空的目录，不能覆盖已有或残缺资料。');
    const existed = fs.existsSync(target);
    const parent = ensurePrivateDirectory(path.dirname(target));
    const staging = path.join(parent, '.' + path.basename(target) + '.xjy-init-' + crypto.randomUUID());
    ensurePrivateDirectory(staging);
    let installed = false;
    try {
      const executable = verifiedExecutable(id);
      const token = crypto.randomBytes(32).toString('base64url');
      const headers = signPrincipal(token, actor, '/_xjy/initialize', 'INIT', Buffer.alloc(0));
      const initializationEnvironment=await childEnvironment(id,staging,executable,token);
      await new Promise((resolve, reject) => {
        const child = spawn(executable, ['--module', id, '--initialize-only'], { windowsHide: true, shell: false, stdio: 'ignore', cwd: path.dirname(executable),
          env: { ...initializationEnvironment,
            XJY_INITIAL_PRINCIPAL: headers['x-xjy-principal'], XJY_INITIAL_SIGNATURE: headers['x-xjy-principal-signature'] } });
        const timer = setTimeout(() => { terminate(child).then(() => reject(failure('新建资料超时，原目录未改动。', 503)), reject); }, 90000);
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('exit', code => { clearTimeout(timer); if (code === 0) resolve(); else reject(failure('新建资料失败，原目录未改动。', 503)); });
      });
      validateDataDirectory(id, staging);
      if (fs.existsSync(target) && (!fs.statSync(target).isDirectory() || fs.readdirSync(target).length)) throw failure('目标目录已被其他程序使用，已取消新建。');
      assertNoLinks(target);
      if (existed && fs.existsSync(target)) fs.rmdirSync(target);
      fs.renameSync(staging, target); installed = true;
      try { await configure(id, target); }
      catch (error) { fs.renameSync(target, staging); installed = false; if (existed) fs.mkdirSync(target); throw error; }
      return { created: true, path: target, status: status() };
    } finally {
      // This exact private staging path is generated above and contains only
      // this initialization's files; no selected/existing data is removed.
      if (!installed && fs.existsSync(staging)) { assertNoLinks(staging); fs.rmSync(staging, { recursive: true, force: true }); }
    }
  }
  async function start(id) {
    known(id);
    if (closing) throw failure('程序正在关闭。', 503);
    const state = states.get(id);
    if (state.ready && alive(state.child)) return state;
    if (state.starting) return state.starting;
    state.starting = (async () => {
      const entry = settings.modules[id];
      if (!entry) throw failure('请先选择该模块已有的数据目录。', 409);
      const directory = validateDataDirectory(id, entry.dataDir);
      const executable = verifiedExecutable(id);
      const port = await freePort();
      if (closing) throw failure('程序正在关闭。', 503);
      const token = crypto.randomBytes(32).toString('base64url');
      const instance = sha(Buffer.from(process.platform === 'win32' ? path.resolve(directory).toLowerCase() : path.resolve(directory)));
      const child = spawn(executable, ['--module', id, '--host', '127.0.0.1', '--port', String(port)], {
        windowsHide: true, shell: false, stdio: 'ignore', cwd: path.dirname(executable),
        env: await childEnvironment(id,directory,executable,token),
      });
      state.child = child; state.port = port; state.token = token; state.ready = false; state.error = null;
      let spawnError;
      child.once('error', error => { spawnError = error; });
      child.once('exit', () => { if (state.child === child) { state.ready = false; if (!closing && !state.error) state.error = '内部模块已退出，重新进入页面可重试。'; } });
      try {
        const deadline = Date.now() + 45000;
        while (Date.now() < deadline) {
          if (spawnError || !alive(child)) throw failure('内部模块启动失败，请检查数据目录和安装文件。', 503);
          try {
            const response = await requestLocal(port, token, { path: '/_xjy/health', method: 'GET' }, 800);
            if (!alive(child)) throw failure('内部模块启动进程已退出。', 503);
            if (response.status === 200) {
              let health;
              try { health = JSON.parse(response.bytes.toString('utf8')); } catch { throw failure('端口被其他程序占用，已拒绝连接。', 503); }
              if (health.module !== id || health.version !== MODULES[id].version || health.nonce !== token || health.instance !== instance) throw failure('内部模块身份校验失败，已拒绝连接其他程序。', 503);
              state.ready = true;
              return state;
            }
            // A listener with a different token is never treated as this module.
            throw failure('端口被其他程序占用，已拒绝连接。', 503);
          } catch (error) {
            if (error.status) throw error;
          }
          await wait(200);
        }
        throw failure('内部模块启动超时，请稍后重试。', 503);
      } catch (error) {
        state.error = error.status ? error.message : '内部模块启动失败。';
        await terminate(child);
        state.ready = false;
        throw error;
      }
    })();
    try { return await state.starting; }
    catch (error) { state.error = error.status ? error.message : '内部模块不可用，请检查数据目录与安装文件。'; throw error; }
    finally { state.starting = null; }
  }
  async function proxy(input, authority = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['module', 'path', 'method', 'headers', 'bodyBase64'].includes(key))) throw failure('模块请求参数无效。');
    known(input.module);
    const requestedPath = canonicalPath(input.path);
    if (decodeURIComponent(new URL(requestedPath, 'http://127.0.0.1').pathname).startsWith('/xjy/collaboration/source')) throw failure('原资料导出只能由主程序协作服务发起。', 403);
    const method = input.method || 'GET';
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(method)) throw failure('模块请求方法无效。');
    const body = decodeBody(input.bodyBase64);
    if (['GET', 'HEAD'].includes(method) && body.length) throw failure('该请求不能携带上传内容。');
    const headers = safeRequestHeaders(input.headers);
    const enteredAt = Date.now();
    validateActor(authority.actor, input.module);
    function requireErpActor(current) {
      if (erpPolicy.isErpPath(requestedPath)) {
        erpPolicy.validateCapabilities(current);
        erpPolicy.authorizeRequest(input, { moduleAccess: { ledger: current.access }, capabilities: Object.fromEntries(current.capabilities.map(key => [key, true])) });
      }
    }
    requireErpActor(authority.actor);
    const state = await start(input.module);
    const actor = validateActor(typeof authority.getActor === 'function' ? await authority.getActor() : authority.actor, input.module);
    requireErpActor(actor);
    if (typeof authority.getActor !== 'function' && Date.now() - enteredAt >= 30000) throw failure('模块启动较久，请重新进入以验证当前权限。', 403);
    Object.assign(headers, signPrincipal(state.token, actor, requestedPath, method, body, typeof authority.getActor === 'function' ? Date.now() : enteredAt));
    if (!alive(state.child) || !state.ready) throw failure('内部模块已断开，请重新进入。', 503);
    let response;
    try { response = await requestLocal(state.port, state.token, { path: requestedPath, method, headers, body }); }
    catch (error) { if (error.status) throw error; throw failure('内部模块连接中断，请检查后重试。', 503); }
    if (!alive(state.child)) throw failure('内部模块已退出，未接受其他程序的响应。', 503);
    const output = {};
    for (const [name, value] of Object.entries(response.headers)) {
      if (HOP_HEADERS.has(name) || name.startsWith('x-xjy-') || value === undefined) continue;
      if (name === 'location') {
        const resolved = new URL(String(value), `http://127.0.0.1:${state.port}${requestedPath}`);
        if (resolved.origin !== `http://127.0.0.1:${state.port}` || resolved.username || resolved.password) throw failure('业务模块返回了不允许的外部跳转。', 502);
        output[name] = resolved.pathname + resolved.search + resolved.hash;
      } else output[name] = value;
    }
    return { status: response.status, headers: output, bodyBase64: response.bytes.toString('base64'),
      ...(['success', 'rejected', 'warning'].includes(response.headers['x-xjy-outcome']) ? { outcome: response.headers['x-xjy-outcome'] } : {}) };
  }
  function close({ strict = false } = {}) {
    if (closePromise) return closePromise;
    closing = true;
    closePromise = (async () => {
      await Promise.allSettled([...states.values()].map(state => state.starting).filter(Boolean));
      const outcomes = await Promise.allSettled([...states.values()].map(async state => {
        try { await terminate(state.child, state, strict); } finally { state.ready = false; state.token = null; }
      }));
      await ocrLifecycle.close();
      if (outcomes.some(result => result.status === 'rejected')) throw failure('部分内部模块尚未退出，请稍后再关闭程序。', 503);
    })();
    return closePromise;
  }
  async function collaborationSnapshot(id, authority = {}) {
    known(id);
    if (!authority || typeof authority !== 'object' || Object.keys(authority).some(key => !['actor','getActor','from','to','includeProfit'].includes(key)) || typeof authority.getActor !== 'function') throw failure('协作导出需要实时主账号授权。', 403);
    if (authority.includeProfit !== undefined && typeof authority.includeProfit !== 'boolean') throw failure('利润导出参数无效。');
    function permitted(value) {
      const actor = validateActor(value, id);
      if (!['operate','manage'].includes(actor.access)) throw failure('协作导出需要模块操作权限。', 403);
      if (authority.includeProfit && (id !== 'ledger' || actor.role !== 'admin')) throw failure('只有总管理员可明确选择导出原利润。', 403);
      return actor;
    }
    const initial = permitted(authority.actor);
    const date = value => {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw failure('请选择有效的起止日期。');
      const stamp = Date.parse(value + 'T00:00:00Z');
      if (!Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0,10) !== value) throw failure('请选择有效的起止日期。');
      return stamp;
    };
    const first = date(authority.from), last = date(authority.to);
    if (first > last || last - first > 365*86400000) throw failure('请选择不超过366天的有效起止日期。');
    const state = await start(id), actor = permitted(await authority.getActor());
    if (actor.staffId !== initial.staffId || actor.userId !== initial.userId) throw failure('主账号已切换，未导出原资料。', 401);
    const address = '/xjy/collaboration/source?' + new URLSearchParams({from:authority.from,to:authority.to,includeProfit:authority.includeProfit?'1':'0'}).toString();
    const headers = signPrincipal(state.token, actor, address, 'GET', Buffer.alloc(0));
    headers['x-xjy-source-permit'] = crypto.createHmac('sha256', state.token).update('collaboration-source:'+headers['x-xjy-principal']).digest('hex');
    const response = await requestLocal(state.port, state.token, {path:address,method:'GET',headers});
    const current = permitted(await authority.getActor());
    if (current.staffId !== actor.staffId || current.userId !== actor.userId || current.grantRevision !== actor.grantRevision) throw failure('权限或账号刚被调整，未保存协作资料。', 403);
    let snapshot;
    try { snapshot = JSON.parse(response.bytes.toString('utf8')); } catch { throw failure('原模块返回了无效的协作资料。', 502); }
    if (response.status !== 200) throw failure(typeof snapshot.error === 'string' ? snapshot.error : '原资料暂时无法导出。', response.status || 503);
    const directory = settings.modules[id]?.dataDir;
    const instance = sha(Buffer.from(process.platform === 'win32' ? path.resolve(directory).toLowerCase() : path.resolve(directory)));
    if (!alive(state.child) || !state.ready || snapshot.schemaVersion !== 1 || snapshot.module !== id || snapshot.version !== MODULES[id].version || snapshot.instance !== instance || snapshot.from !== authority.from || snapshot.to !== authority.to || snapshot.truncated !== false) throw failure('原资料身份或完整性验证失败。', 502);
    return snapshot;
  }
  return { status, configure, createData, proxy, collaborationSnapshot, close };
}

module.exports = { createLegacyModules, validateDataDirectory, canonicalPath, validateActor, signPrincipal, MAX_UPLOAD, MAX_DOWNLOAD };

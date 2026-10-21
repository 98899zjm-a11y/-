'use strict';

const { app, BrowserWindow, dialog, ipcMain, protocol, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { createBackend } = require('./backend.cjs');
const { createNetworkWorkspace } = require('./network-workspace.cjs');
const { createPrintSettings } = require('./print-settings.cjs');
const { makeBackup, validateBackup, prepareRestore, commitRestore, inside } = require('./backup.cjs');

protocol.registerSchemesAsPrivileged([{ scheme: 'jewelry', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
const selfCheck = process.argv.includes('--self-check');
if (selfCheck && (!process.env.XJY_DATA_DIR || !process.env.XJY_SELF_CHECK_OUTPUT)) throw new Error('诊断模式必须指定独立数据与输出文件夹');
if (selfCheck) app.setPath('userData', path.join(path.resolve(process.env.XJY_DATA_DIR), '..', 'diagnostic-user-data'));
const dataDir = path.resolve(process.env.XJY_DATA_DIR || path.join(app.getPath('userData'), 'business-data'));
const rendererDir = path.join(__dirname, 'renderer-dist');
const localOrigin = 'jewelry://app';
const printerSettings = createPrintSettings(path.join(app.getPath('userData'), 'warranty-print-settings.json'));
const pages = new Set(['/', '/home', '/sales', '/custom', '/tradein', '/recycling', '/repairs', '/gallery', '/customers', '/history', '/settings']);
const contentTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' data: blob:; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
let window, backend, network, closing = false, taskQueue = Promise.resolve();
const blockedNetwork = [];
const rendererErrors = [];
function exclusive(action) { const work = taskQueue.then(action); taskQueue = work.catch(() => {}); return work; }
function trustedUrl(address) { try { const url = new URL(address); return url.protocol === 'jewelry:' && url.hostname === 'app' && !url.port && !url.username && !url.password; } catch { return false; } }
function trustedSender(event) {
  if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !trustedUrl(event.senderFrame.url)) throw new Error('本机窗口验证失败');
}
async function requireLogin(admin = false) {
  const response = await network.request({ path: '/auth/status' });
  if (!response.ok) throw new Error(response.data?.error || '主机暂时无法连接');
  const status = response.data;
  if (!status.authenticated) throw new Error('请先登录本机账号');
  if (admin && status.user.role !== 'admin') throw new Error('只有管理员可以备份或恢复本机数据');
  return status.user;
}
function nativeHandler(channel, action) {
  ipcMain.handle(channel, async (event, input) => {
    trustedSender(event);
    try { return await action(input); }
    catch (error) { return { ok: false, error: error.message || '操作未完成，请重试' }; }
  });
}
function safeName(value, extension) {
  const name = typeof value === 'string' ? value.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim().slice(0, 100).replace(/[. ]+$/, '') : '';
  return (name && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ? name.replace(new RegExp('\\.' + extension + '$', 'i'), '') : '鑫金源报价单') + '.' + extension;
}
async function localProtocol(request) {
  try {
    if (!trustedUrl(request.url) || !['GET', 'HEAD'].includes(request.method)) return new Response('Forbidden', { status: 403 });
    const url = new URL(request.url), pathname = decodeURIComponent(url.pathname);
    if (pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').some(part => part === '..')) return new Response('Forbidden', { status: 403 });
    const picture = /^\/api\/images\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.exec(pathname);
    if (picture) {
      const response = await network.imageResponse(picture[1]);
      const headers = new Headers(response.headers); headers.set('Cache-Control', 'no-store'); headers.set('X-Content-Type-Options', 'nosniff');
      return new Response(request.method === 'HEAD' ? null : response.body, { status: response.status, headers });
    }
    if (pathname.startsWith('/api/') || pathname.startsWith('/auth/')) return new Response('Not Found', { status: 404 });
    const file = pages.has(pathname) ? path.join(rendererDir, 'index.html') : path.resolve(rendererDir, '.' + pathname);
    if (!inside(rendererDir, file) || !fs.existsSync(file) || !fs.statSync(file).isFile() || !inside(fs.realpathSync(rendererDir), fs.realpathSync(file))) return new Response('Not Found', { status: 404 });
    const headers = { 'Content-Type': contentTypes[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Security-Policy': csp, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' };
    return new Response(request.method === 'HEAD' ? null : fs.readFileSync(file), { headers });
  } catch { return new Response('本机资源未能读取', { status: 500 }); }
}
async function imageBytes(input) {
  if (!input || typeof input.src !== 'string' || input.src.length > 60 * 1024 * 1024) throw new Error('报价图片格式无效或过大');
  const data = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(input.src);
  let bytes;
  if (data) bytes = Buffer.from(data[2], 'base64');
  else {
    const image = /^\/api\/images\/([a-f0-9-]{36})$/.exec(input.src);
    if (!image) throw new Error('仅支持本机报价图片');
    const response = await network.imageResponse(image[1]);
    if (!response.ok) throw new Error('该图片不可读取');
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (!bytes.length || bytes.length > 45 * 1024 * 1024) throw new Error('图片为空或过大');
  const extension = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'png' : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'jpg' : bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP' ? 'webp' : '';
  if (!extension) throw new Error('不是有效的PNG、JPEG或WebP图片');
  return { bytes, extension };
}
function registerIpc() {
  ipcMain.handle('jewelry:request', (event, input) => {
    trustedSender(event);
    if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.path !== 'string' || !/^\/(api|auth)\//.test(input.path)) return { ok: false, status: 400, data: { error: '本机请求无效' } };
    return exclusive(() => network.request(input));
  });
  nativeHandler('jewelry:get-connection', () => network.info());
  nativeHandler('jewelry:set-connection', input => exclusive(async () => {
    const result = await network.configure(input);
    setTimeout(() => { if (window && !window.isDestroyed()) void window.loadURL(localOrigin + '/home'); }, 150);
    return result;
  }));
  ipcMain.handle('jewelry:get-printers', async event => {
    trustedSender(event); await requireLogin();
    return (await window.webContents.getPrintersAsync()).map(printer => ({ name: printer.name, displayName: printer.displayName || printer.name, isDefault: printer.isDefault }));
  });
  ipcMain.handle('jewelry:get-print-settings', async event => { trustedSender(event); await requireLogin(); return printerSettings.read(); });
  nativeHandler('jewelry:save-print-settings', async input => {
    await requireLogin();
    if (input?.deviceName && !(await window.webContents.getPrintersAsync()).some(printer => printer.name === input.deviceName)) throw new Error('这台电脑没有所选打印机，请重新选择');
    return { ok: true, settings: printerSettings.write(input) };
  });
  nativeHandler('jewelry:print-warranty', async input => {
    await requireLogin(); await requireWarranty();
    const settings = printerSettings.read(), printers = await window.webContents.getPrintersAsync();
    const selected = settings.deviceName && printers.find(printer => printer.name === settings.deviceName);
    if (settings.deviceName && !selected) throw new Error('已设置的打印机不可用，请检查连接后重新选择');
    const silent = Boolean(selected && !input?.showDialog && !/pdf|xps|onenote/i.test(selected.name));
    return new Promise(resolve => window.webContents.print({ silent, ...(selected ? { deviceName: selected.name } : {}), copies: settings.copies, printBackground: true, margins: { marginType: 'none' }, pageSize: { width: Math.round(settings.widthMm * 1000), height: Math.round(settings.heightMm * 1000) } }, (success, failure) => resolve(success ? { ok: true } : /cancel/i.test(failure || '') ? { ok: false, canceled: true } : { ok: false, error: failure || '打印未完成，请检查打印机' })));
  });
  nativeHandler('jewelry:export-warranty-pdf', async () => {
    await requireLogin(); await requireWarranty();
    const choice = await dialog.showSaveDialog(window, { title: '保存质保单', defaultPath: path.join(app.getPath('documents'), '鑫金源珠宝质保单.pdf'), filters: [{ name: 'PDF文件', extensions: ['pdf'] }] });
    if (choice.canceled || !choice.filePath) return { ok: false, canceled: true };
    const settings = printerSettings.read();
    const bytes = await window.webContents.printToPDF({ printBackground: true, pageSize: { width: settings.widthMm / 25.4, height: settings.heightMm / 25.4 }, margins: { top: 0, left: 0, bottom: 0, right: 0 }, preferCSSPageSize: true });
    fs.writeFileSync(choice.filePath, bytes); return { ok: true, path: choice.filePath };
  });
  ipcMain.handle('jewelry:print', async event => {
    trustedSender(event); await requireLogin();
    await requireA4();
    return new Promise((resolve, reject) => window.webContents.print({ silent: false, printBackground: true, pageSize: 'A4' }, (success, failure) => {
      if (success || /cancel/i.test(failure || '')) resolve(); else reject(new Error(failure || '打印未能完成，请检查打印机'));
    }));
  });
  nativeHandler('jewelry:export-pdf', async () => {
    await requireLogin(); await requireA4();
    const selected = await dialog.showSaveDialog(window, { title: '保存A4报价单', defaultPath: path.join(app.getPath('documents'), '鑫金源报价单.pdf'), filters: [{ name: 'PDF文件', extensions: ['pdf'] }] });
    if (selected.canceled || !selected.filePath) return { ok: false, canceled: true };
    const bytes = await window.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true });
    fs.writeFileSync(selected.filePath, bytes); return { ok: true, path: selected.filePath };
  });
  nativeHandler('jewelry:save-image', async input => {
    await requireLogin(); const { bytes, extension } = await imageBytes(input);
    const imageName = typeof input.name === 'string' ? input.name.replace(/\.(?:png|jpe?g|webp)$/i, '') : input.name;
    const selected = await dialog.showSaveDialog(window, { title: '保存报价图片或确认截图', defaultPath: path.join(app.getPath('pictures'), safeName(imageName, extension)), filters: [{ name: extension.toUpperCase() + '图片', extensions: [extension] }] });
    if (selected.canceled || !selected.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(selected.filePath, bytes); return { ok: true, path: selected.filePath };
  });
  nativeHandler('jewelry:data-info', async () => { network.assertLocal(); await requireLogin(true); return { path: dataDir }; });
  nativeHandler('jewelry:backup', () => exclusive(async () => {
    network.assertLocal(); await requireLogin(true);
    const selected = await dialog.showOpenDialog(window, { title: '选择备份存放位置', properties: ['openDirectory', 'createDirectory'] });
    if (selected.canceled || !selected.filePaths[0]) return { ok: false, canceled: true };
    const target = await backend.exclusive(() => makeBackup(backend.runtime, selected.filePaths[0]));
    return { ok: true, path: target };
  }));
  nativeHandler('jewelry:restore', () => exclusive(async () => {
    network.assertLocal(); await requireLogin(true);
    const selected = await dialog.showOpenDialog(window, { title: '选择鑫金源备份文件夹', properties: ['openDirectory'] });
    if (selected.canceled || !selected.filePaths[0]) return { ok: false, canceled: true };
    validateBackup(selected.filePaths[0]);
    const answer = await dialog.showMessageBox(window, { type: 'question', title: '恢复本机工作室', message: '使用这份备份恢复客户、报价、图片和账号？', detail: '当前数据会另存为完整副本。恢复后需要使用备份中的账号重新登录。', buttons: ['取消', '恢复备份'], defaultId: 0, cancelId: 0, noLink: true });
    if (answer.response !== 1) return { ok: false, canceled: true };
    await network.pause();
    let stage;
    try { stage = prepareRestore(selected.filePaths[0], dataDir); }
    catch (error) { await network.setBackend(backend); throw error; }
    await backend.close();
    let restored;
    try {
      restored = commitRestore(stage, dataDir);
      backend = createBackend({ dataDir, migrationDir: path.join(__dirname, 'migrations') });
      await network.setBackend(backend);
    } catch (error) {
      if (restored) {
        const rejected = path.join(path.dirname(dataDir), path.basename(dataDir) + '.rejected-restore-' + Date.now());
        if (!inside(path.dirname(dataDir), rejected)) throw error;
        fs.renameSync(dataDir, rejected); fs.renameSync(restored.previous, dataDir);
      }
      backend = createBackend({ dataDir, migrationDir: path.join(__dirname, 'migrations') });
      await network.setBackend(backend);
      throw new Error('备份未能打开，当前数据已保留。' + error.message);
    }
    // Reload the local window, not the portable launcher. New auth starts logged out.
    setTimeout(() => { if (window && !window.isDestroyed()) { window.webContents.session.clearStorageData({ storages: ['localstorage'] }).then(() => window.loadURL(localOrigin + '/home')).catch(() => window.loadURL(localOrigin + '/home')); } }, 150);
    return { ok: true, reloadRequired: true };
  }));
}
async function requireA4() {
  const open = await window.webContents.executeJavaScript("Boolean(document.querySelector('.a4-print-root .a4-sheet'))", true);
  if (!open) throw new Error('请先打开报价单的A4预览');
}
async function requireWarranty() {
  const ready = await window.webContents.executeJavaScript("Boolean(document.querySelector('.warranty-print-root .warranty-sheet')) && [...document.querySelectorAll('.warranty-print-root [data-warranty-field]')].every(field=>field.dataset.warrantyReady==='true' && field.dataset.warrantyOverflow!=='true') && [...document.querySelectorAll('.warranty-print-root img')].every(image=>image.complete && image.naturalWidth>0)", true);
  if (!ready) throw new Error('请先打开并核对质保单预览，确保字段完整且没有超出位置');
}
async function diagnostics() {
  const output = path.resolve(process.env.XJY_SELF_CHECK_OUTPUT); fs.mkdirSync(output, { recursive: true });
  const deadline = Date.now() + 25000; let state;
  while (Date.now() < deadline) {
    state = await window.webContents.executeJavaScript(`({title:document.title,text:document.body.innerText,bridge:typeof window.jewelryDesktop?.request === 'function',images:[...document.images].map(i=>({src:i.getAttribute('src'),loaded:i.complete&&i.naturalWidth>0})),ready:!!document.querySelector('.auth-submit')})`);
    if (state.ready && state.images.every(image => image.loaded)) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  const capture = await window.webContents.capturePage(); fs.writeFileSync(path.join(output, '离线程序-首次启动.png'), capture.toPNG());
  const ok = Boolean(state?.ready && state.bridge && state.text.includes('建立你的珠宝工作室') && state.images.every(image => image.loaded) && !rendererErrors.length && !blockedNetwork.length);
  fs.writeFileSync(path.join(output, 'startup-check.json'), JSON.stringify({ ok, electron: process.versions.electron, node: process.versions.node, sqlite: process.versions.sqlite, state, rendererErrors, blockedNetwork }, null, 2));
  app.exit(ok ? 0 : 1);
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window && !window.isDestroyed()) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.whenReady().then(async () => {
    backend = createBackend({ dataDir, migrationDir: path.join(__dirname, 'migrations') });
    network = await createNetworkWorkspace({ backend, configFile: path.join(app.getPath('userData'), 'workspace-connection.json') });
    const localSession = session.defaultSession;
    localSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    localSession.setPermissionCheckHandler(() => false);
    localSession.webRequest.onBeforeRequest((details, callback) => {
      const allowed = trustedUrl(details.url) || /^(data|blob|devtools):/.test(details.url);
      if (!allowed && selfCheck) blockedNetwork.push(details.url);
      callback({ cancel: !allowed });
    });
    localSession.protocol.handle('jewelry', localProtocol);
    registerIpc();
    window = new BrowserWindow({ width: 1440, height: 980, minWidth: 1024, minHeight: 720, title: '鑫金源 · 珠宝报价工作室', icon: path.join(__dirname, 'assets', 'icon.png'), backgroundColor: '#f7f6f3', show: false, autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, devTools: !app.isPackaged } });
    window.setMenu(null);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, address) => { if (!trustedUrl(address)) event.preventDefault(); });
    window.webContents.on('will-redirect', (event, address) => { if (!trustedUrl(address)) event.preventDefault(); });
    window.webContents.on('will-attach-webview', event => event.preventDefault());
    window.webContents.on('console-message', (_event, details) => { if (selfCheck && details.level === 'error') rendererErrors.push(details.message); });
    window.on('closed', () => { window = null; });
    await window.loadURL(localOrigin + '/home');
    if (selfCheck) await diagnostics(); else window.show();
  }).catch(error => { if (selfCheck) { fs.mkdirSync(process.env.XJY_SELF_CHECK_OUTPUT, { recursive: true }); fs.writeFileSync(path.join(process.env.XJY_SELF_CHECK_OUTPUT, 'startup-error.txt'), error.stack || error.message); } else dialog.showErrorBox('程序未能打开', error.message + '\n请确认程序文件完整、本机数据文件夹可写。'); app.exit(1); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', event => { if (!closing && backend) { event.preventDefault(); closing = true; taskQueue.then(async () => { if (network) await network.close(); await backend.close(); }).finally(() => app.quit()); } });
}

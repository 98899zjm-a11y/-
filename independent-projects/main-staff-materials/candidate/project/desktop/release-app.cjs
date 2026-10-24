'use strict';
// Loaded only after release-entry admission; original stage main remains blocked.
const admissionDescriptor=Object.getOwnPropertyDescriptor(globalThis,'__xjyReleaseAdmission');
if(!admissionDescriptor||admissionDescriptor.writable!==false||admissionDescriptor.configurable!==false||!Object.isFrozen(admissionDescriptor.value)||!['sandbox','installed'].includes(admissionDescriptor.value.mode))throw new Error('候选主程序只能通过已核验的发布入口启动；未打开任何业务资料。');

const { app, BrowserWindow, WebContentsView, dialog, ipcMain, protocol, session, clipboard, nativeImage, safeStorage, ClipboardItem, Tray, Menu } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL}=require('node:url');
const {readMaterialsRuntimeCapability}=require('./materials-capability.cjs');
const materialsEnabled=readMaterialsRuntimeCapability({codeDir:__dirname});
const { createNetworkWorkspace } = require('./network-workspace.cjs');
const { createPrintSettings } = require('./print-settings.cjs');
const { createClientBackend } = require('./storage-locations.cjs');
const { resolveReleaseStorage } = require('./release-storage.cjs');
const { createReleaseHostServices } = require('./release-host-services.cjs');
const { createNativeEmployeeUpdate } = require('./native-employee-update.cjs');
const { createAppInfoProvider } = require('./app-info.cjs');
const appInfoProvider = createAppInfoProvider({ getVersion: () => app.getVersion() });
const { createImageOutput } = require('./image-output.cjs');
const { copyQuoteImage } = require('./clipboard-output.cjs');
const { createWarrantyDocx } = require('./warranty-docx.cjs');
const { createLoginMemory, createLoginReceipt, scopeForConnection } = require('./credentials.cjs');
const {createModuleViews}=require('./module-views.cjs');
const { inside } = require('./backup.cjs');

const selfCheck = process.argv.includes('--self-check');
if (selfCheck && (!process.env.XJY_DATA_DIR || !process.env.XJY_SELF_CHECK_OUTPUT)) throw new Error('诊断模式必须指定独立数据与输出文件夹');
if(selfCheck){if(admissionDescriptor.value.mode!=='sandbox')throw Error('诊断只允许实际 Sandbox');require('./managed-print-worker.cjs').createOwnedPathGuard(admissionDescriptor.value.root).check(process.env.XJY_SELF_CHECK_OUTPUT);}
const requestedEmployeeClient = admissionDescriptor.value.mode==='installed'?admissionDescriptor.value.role==='employee':process.argv.includes('--employee-client');
const oldProfile = app.getPath('userData');
const storage = (() => { try { return resolveReleaseStorage({admission:admissionDescriptor.value,legacyProfile:oldProfile,employeeClient:requestedEmployeeClient,portableDirectory:path.dirname(app.getPath('exe'))}); } catch (error) { dialog.showErrorBox('资料目录未能打开', error.message); app.exit(1); throw error; } })();
const employeeClient = storage.employeeClient;
app.setPath('userData', storage.profileDir);
app.setPath('sessionData', storage.profileDir);
const dataDir = storage.dataDir;
const rendererDir = path.join(__dirname, 'renderer-dist');
const localOrigin = 'jewelry://app';
const outputGuard=admissionDescriptor.value.mode==='sandbox'?require('./managed-print-worker.cjs').createOwnedPathGuard(admissionDescriptor.value.root):null;
const nativeOutput=file=>outputGuard?outputGuard.check(file):file;
const printerSettings = createPrintSettings(path.join(app.getPath('userData'), 'warranty-print-settings.json'));
const imageOutput = createImageOutput({ settingsFile: path.join(storage.profileDir, 'image-output-settings.json'), defaultFolder: storage.imageDir,...(outputGuard?{guardPath:outputGuard.check}:{}) });
const loginMemory = createLoginMemory({ file: path.join(storage.profileDir, 'remembered-login.json'), safeStorage });
const loginReceipt = createLoginReceipt();
const pages = new Set(['/', '/home', '/sales', '/salesOrders', '/custom', '/tradein', '/recycling', '/repairs', '/gallery', '/customers', '/history', '/reports', '/settings', '/permissions', '/operationLogs', '/usage', '/personalSales', '/employeeProfile', '/notes']);
const contentTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' data: blob:; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
let window, backend, network, hostRuntime, materialsProtocol, employeeUpdater, tray, legacyModules, moduleViews, nativeSessionRevision=0, shutdownExitCode, closing = false, quitAllowed=false, taskQueue = Promise.resolve();
let helperPins;try{helperPins=require('./generated/release-pins.cjs');}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;}
function businessRequest(action){if(closing)throw Error('程序正在正常关闭，请稍后重试');return hostRuntime?hostRuntime.withRequest(()=>action()):action();}
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
  if (admin && status.user.role !== 'admin') throw new Error('只有管理员可以执行此操作');
  return status.user;
}
async function requireSales(level='view'){
 const user=await requireLogin(),levels=['disabled','view','operate','manage'],access=user.role==='admin'?'manage':user.moduleAccess?.sales||'operate';
 if(levels.indexOf(access)<levels.indexOf(level))throw new Error(access==='disabled'?'管理员尚未授权销售模块':'当前账号仅可查看，不能执行打印操作');return user;
}
function principal(user,module){return{module,staffId:user.id,userId:user.userId||'local-'+user.id,name:user.name||user.username,role:user.role,access:user.role==='admin'?'manage':user.moduleAccess?.[module]||'disabled',grantRevision:user.grantRevision||1};}
function nativeHandler(channel, action, { maintenance = false } = {}) {
  ipcMain.handle(channel, async (event, input) => {
    trustedSender(event);
    try { if(closing)throw Error('程序正在正常关闭，请稍后重试');return await (maintenance?action(input):businessRequest(()=>action(input))); }
    catch (error) { return { ok: false, error: error.message || '操作未完成，请重试' }; }
  });
}
async function readNativePrinters() {
  let timer;
  try { return await Promise.race([window.webContents.getPrintersAsync(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('打印机列表读取超时，请检查驱动或保存PDF后重试')), 10000); })]); }
  finally { clearTimeout(timer); }
}
function safeName(value, extension) {
  const name = typeof value === 'string' ? value.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim().slice(0, 100).replace(/[. ]+$/, '') : '';
  return (name && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ? name.replace(new RegExp('\\.' + extension + '$', 'i'), '') : '鑫金源报价单') + '.' + extension;
}
async function localProtocol(request) {
  try {
    if (!trustedUrl(request.url)) return new Response('Forbidden', { status: 403 });
    const url = new URL(request.url), pathname = decodeURIComponent(url.pathname);
    if (pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').some(part => part === '..')) return new Response('Forbidden', { status: 403 });
    if(pathname==='/materials'||pathname.startsWith('/materials/')){
      if(!materialsProtocol)return new Response('素材功能尚未启用',{status:503});
      return businessRequest(()=>materialsProtocol(request));
    }
    if(!['GET','HEAD'].includes(request.method))return new Response('Forbidden',{status:403});
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
  const loginScope = () => scopeForConnection(network.info(), dataDir);
  const checkedLoginScope = input => { const scope = loginScope(); if (input?.scopeKey && input.scopeKey !== loginMemory.scopeKey(scope)) throw new Error('工作室连接已切换，原登录记忆未修改'); return scope; };
  nativeHandler('jewelry:read-login-memory', input => exclusive(() => loginMemory.read(loginScope(), input?.username)));
  nativeHandler('jewelry:remember-login-username', input => exclusive(() => loginMemory.rememberUsername(checkedLoginScope(input), input?.username)));
  nativeHandler('jewelry:forget-login-password', input => exclusive(() => { loginReceipt.clear(); return loginMemory.forgetPassword(checkedLoginScope(input), input?.username); }));
  nativeHandler('jewelry:remember-login', input => exclusive(async () => {
    const scope = checkedLoginScope(input);
    if (input?.rememberPassword && (!input.scopeKey || typeof input.userId !== 'string')) throw new Error('登录验证已失效，密码未保存');
    if (input?.rememberPassword) { const current = await requireLogin(); if (current.id !== input.userId || current.username !== String(input.username).trim().normalize('NFKC').toLowerCase()) throw new Error('当前登录账号已切换，密码未保存'); }
    else loginReceipt.clear();
    return loginMemory.rememberLogin(scope, { username: input?.username, password: input?.password, rememberPassword: input?.rememberPassword }, async credentials => loginScope() === scope ? loginReceipt.consume(scope, input.userId, credentials) : null);
  }));
  ipcMain.handle('jewelry:request', (event, input) => {
    trustedSender(event);
    if(closing)return{ok:false,status:503,data:{error:'程序正在正常关闭'}};
    if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.path !== 'string' || !/^\/(api|auth)\//.test(input.path)) return { ok: false, status: 400, data: { error: '本机请求无效' } };
    return businessRequest(()=>exclusive(async () => {
      const pathname = new URL(input.path, 'http://offline.invalid').pathname, method = String(input.method || 'GET').toUpperCase();
      let rememberedScope;
      if (method === 'POST' && ['/auth/login', '/auth/setup', '/auth/logout'].includes(pathname)) { nativeSessionRevision++;loginReceipt.clear(); try { rememberedScope = loginScope(); } catch {} }
      const result = await network.request(input);
      if(method==='POST'&&['/auth/login','/auth/setup','/auth/logout'].includes(pathname)&&result.ok&&moduleViews)await moduleViews.clear();
      if (method === 'POST' && ['/auth/login', '/auth/setup'].includes(pathname) && rememberedScope && rememberedScope === loginScope()) loginReceipt.record(rememberedScope, input.body, result);
      return result;
    }));
  });
  nativeHandler('jewelry:get-connection', () => network.info());
  nativeHandler('jewelry:get-modules',async()=>{await requireLogin();const response=await network.request({path:'/api/internal-modules/status'});if(!response.ok)throw new Error(response.data?.error||'模块配置暂时无法读取');return{...response.data,hostMode:network.info().mode!=='client'};});
  nativeHandler('jewelry:open-module',async input=>{await requireLogin();return moduleViews.open(input?.id);});
  nativeHandler('jewelry:close-module',()=>moduleViews.hide());
  nativeHandler('jewelry:module-activity-info',async()=>{await requireLogin();return moduleViews.activity();});
  ipcMain.on('jewelry:module-activity',(event)=>{void moduleViews?.noteActivity(event.sender,event.senderFrame).catch(()=>{});});
  nativeHandler('jewelry:create-module-data',input=>exclusive(async()=>{
    const user=await requireLogin(true);network.assertLocal();if(!legacyModules||!['ledger','inventory'].includes(input?.id))throw new Error('请在保存资料的主机新建模块资料');
    const label=input.id==='ledger'?'内账':'库管';
    const choice=await dialog.showOpenDialog(window,{title:'选择新建'+label+'资料的空文件夹',defaultPath:storage.root,properties:['openDirectory','createDirectory']});
    if(choice.canceled||!choice.filePaths[0])return{ok:false,canceled:true};
    const current=await requireLogin(true);if(current.id!==user.id)throw new Error('账号已切换，资料未创建');network.assertLocal();await moduleViews.clear();
    const result=await legacyModules.createData(input.id,choice.filePaths[0],{actor:principal(current,input.id)});
    return{ok:true,path:result.path,message:label+'空资料已创建，按主账号分配权限进入'};
  }));
  nativeHandler('jewelry:configure-module',input=>exclusive(async()=>{
    const user=await requireLogin(true);network.assertLocal();if(!legacyModules||!['ledger','inventory'].includes(input?.id))throw new Error('请在保存资料的主机上配置模块');
    const label=input.id==='ledger'?'内账':'库管';
    const selection=await dialog.showOpenDialog(window,{title:'选择原'+label+'程序的完整data文件夹（先退出旧程序）',properties:['openDirectory']});
    if(selection.canceled||!selection.filePaths[0])return{ok:false,canceled:true};
    if((await requireLogin(true)).id!==user.id)throw new Error('主程序账号已切换，资料目录未修改');
    network.assertLocal();await moduleViews.clear();await legacyModules.configure(input.id,selection.filePaths[0]);return{ok:true,message:label+'原资料目录已关联，账号与业务记录继续保留'};
  }));
  ipcMain.handle('jewelry:module-print',async(event,input)=>{try{return await moduleViews.print(event.sender,event.senderFrame,input);}catch(error){return{ok:false,error:error.message||'模块打印未完成'};}});
  ipcMain.handle('jewelry:module-workspace-request',async(event,input)=>{try{return await moduleViews.workspaceRequest(event.sender,event.senderFrame,input);}catch(error){return{ok:false,status:403,data:{error:error.message||'模块协作请求未完成'}};}});
  nativeHandler('jewelry:set-connection', input => exclusive(async () => {
    nativeSessionRevision++;
    const result = await network.configure(input);
    if(moduleViews)await moduleViews.clear();
    loginReceipt.clear();
    setTimeout(() => { if (window && !window.isDestroyed()) void window.loadURL(localOrigin + '/home'); }, 150);
    return result;
  }));
  nativeHandler('jewelry:get-printers',async()=>{const actor=await requireSales();if(!hostRuntime)return[];const local=actor.role==='admin'&&network.info().mode!=='client',result=await hostRuntime.printRouting.getOptions({...actor,local});return result.printers.map(p=>({name:p.deviceName||p.label,displayName:p.label}));});
  nativeHandler('jewelry:host-print-routing',async()=>{network.assertLocal();const actor=await requireLogin(true);if(!hostRuntime)throw Error('请在主机设置打印设备');return hostRuntime.printRouting.getOptions({...actor,local:true});});
  nativeHandler('jewelry:host-print-routing-save',async input=>{network.assertLocal();const actor=await requireLogin(true);if(!hostRuntime)throw Error('请在主机设置打印设备');return hostRuntime.printRouting.update({...actor,local:true},input);});
  nativeHandler('jewelry:host-maintenance',async()=>{network.assertLocal();await requireLogin(true);if(!hostRuntime)throw Error('请在主机管理备份');return hostRuntime.getMaintenance();});
  ipcMain.handle('jewelry:app-info',(event,input)=>{trustedSender(event);if(input!==undefined)throw Error('版本信息只接受只读查询。');return appInfoProvider.getAppInfo();});
  nativeHandler('jewelry:employee-update-capability',()=>employeeUpdater.getCapability());
  nativeHandler('jewelry:employee-update-state',()=>employeeUpdater.getState());
  nativeHandler('jewelry:employee-update',input=>employeeUpdater.run(input),{maintenance:true});
  nativeHandler('jewelry:exit-host',async()=>{network.assertLocal();await requireLogin(true);if(!hostRuntime)throw Error('请在主机关闭后台');setImmediate(()=>app.quit());return{ok:true,message:'主机后台正在正常关闭，员工连接将停止'};},{maintenance:true});
  ipcMain.handle('jewelry:get-print-settings', async event => { trustedSender(event); await requireSales(); return printerSettings.read(); });
  nativeHandler('jewelry:save-print-settings', async input => {
    const user=await requireSales();
    if((await requireSales()).id!==user.id)throw new Error('账号已切换，打印设置未修改');
    return { ok: true, settings: require('./native-print-policy.cjs').saveEditablePrintSettings(printerSettings,input) };
  });
  nativeHandler('jewelry:print-warranty', async input => {
    await requireSales('operate'); return require('./native-print-policy.cjs').rejectLegacyNativePrint();
  });
  nativeHandler('jewelry:export-warranty-pdf', async () => {
    const user=await requireSales(); await requireWarranty();
    const choice = await dialog.showSaveDialog(window, { title: '保存质保单', defaultPath: path.join(imageOutput.directory(user), '鑫金源珠宝质保单.pdf'), filters: [{ name: 'PDF文件', extensions: ['pdf'] }] });
    if (choice.canceled || !choice.filePath) return { ok: false, canceled: true };
    if((await requireSales()).id!==user.id)throw new Error('账号已切换，请重新导出质保单');
    const settings = printerSettings.read();
    const bytes = await window.webContents.printToPDF({ printBackground: true, pageSize: { width: settings.widthMm / 25.4, height: settings.heightMm / 25.4 }, margins: { top: 0, left: 0, bottom: 0, right: 0 }, preferCSSPageSize: true });
    if((await requireSales()).id!==user.id)throw new Error('账号已切换，请重新导出质保单');
    const file=nativeOutput(path.resolve(choice.filePath));fs.writeFileSync(file, bytes); return { ok: true, path: file };
  });
  ipcMain.handle('jewelry:print', async event => {
    trustedSender(event); await requireSales('operate'); return require('./native-print-policy.cjs').rejectLegacyNativePrint();
  });
  nativeHandler('jewelry:export-pdf', async () => {
    const user=await requireSales(); await requireA4();
    const selected = await dialog.showSaveDialog(window, { title: '保存A4报价单', defaultPath: path.join(imageOutput.directory(user), '鑫金源报价单.pdf'), filters: [{ name: 'PDF文件', extensions: ['pdf'] }] });
    if (selected.canceled || !selected.filePath) return { ok: false, canceled: true };
    if((await requireSales()).id!==user.id)throw new Error('账号已切换，请重新导出报价单');
    const bytes = await window.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true });
    if((await requireSales()).id!==user.id)throw new Error('账号已切换，请重新导出报价单');
    const file=nativeOutput(path.resolve(selected.filePath));fs.writeFileSync(file, bytes); return { ok: true, path: file };
  });
  nativeHandler('jewelry:save-image-as', async input => {
    const user = await requireSales(), { bytes, extension } = await imageBytes(input);
    const choice = await dialog.showSaveDialog(window, { title: '报价图片另存为', defaultPath: path.join(imageOutput.directory(user), safeName(input.name, extension)), filters: [{ name: '报价图片', extensions: [extension] }] });
    if (choice.canceled || !choice.filePath) return { ok: false, canceled: true };
    if ((await requireSales()).id !== user.id) throw new Error('登录已切换，请重新保存图片');
    const file = nativeOutput(path.resolve(choice.filePath)), temporary = file + '.xjy-' + require('node:crypto').randomUUID() + '.tmp';
    try { fs.writeFileSync(temporary, bytes, { flag: 'wx' }); fs.renameSync(temporary, file); }
    finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    return { ok: true, path: file };
  });
  nativeHandler('jewelry:export-warranty-docx', async input => {
    const user = await requireSales();
    const bytes = createWarrantyDocx(input, { templateBytes: fs.readFileSync(path.join(rendererDir, 'warranty-template.jpg')) });
    const choice = await dialog.showSaveDialog(window, { title: '导出可编辑Word质保单', defaultPath: path.join(imageOutput.directory(user), safeName(input?.number || '鑫金源质保单', 'docx')), filters: [{ name: 'Word文档', extensions: ['docx'] }] });
    if (choice.canceled || !choice.filePath) return { ok: false, canceled: true };
    if ((await requireSales()).id !== user.id) throw new Error('登录已切换，请重新导出质保单');
    const file = nativeOutput(path.resolve(choice.filePath)), temporary = file + '.xjy-' + require('node:crypto').randomUUID() + '.tmp';
    try { fs.writeFileSync(temporary, bytes, { flag: 'wx' }); fs.renameSync(temporary, file); }
    finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    return { ok: true, path: file };
  });
  nativeHandler('jewelry:save-image', async input => {
    const user = await requireSales(), { bytes, extension } = await imageBytes(input);
    if ((await requireSales()).id !== user.id) throw new Error('登录已切换，请重新生成图片');
    return { ok: true, path: imageOutput.save(user, bytes, input.name, extension) };
  });
  nativeHandler('jewelry:get-image-save-settings', async () => { const user = await requireSales(); return { path: imageOutput.directory(user) }; });
  nativeHandler('jewelry:choose-image-save-folder', async () => {
    const user = await requireSales();
    const choice = await dialog.showOpenDialog(window, { title: '选择报价图片自动保存文件夹', defaultPath: imageOutput.directory(user), properties: ['openDirectory', 'createDirectory'] });
    if (choice.canceled || !choice.filePaths[0]) return { ok: false, canceled: true };
    if ((await requireSales()).id !== user.id) throw new Error('登录已切换，图片目录未修改');
    return { ok: true, path: imageOutput.select(user, choice.filePaths[0]) };
  });
  nativeHandler('jewelry:share-image', async input => {
    const user = await requireSales(), { bytes, extension } = await imageBytes(input);
    if ((await requireSales()).id !== user.id) throw new Error('登录已切换，请重新选择图片');
    await copyQuoteImage(bytes, { nativeImage, clipboard, ClipboardItem });
    return { ok: true, message: '图片已复制。请打开微信聊天窗口，按 Ctrl+V 粘贴后发送。' };
  });
  nativeHandler('jewelry:save-text-file', async input => {
    const user = await requireSales();
    if (!input || typeof input.text !== 'string' || Buffer.byteLength(input.text) > 5 * 1024 * 1024 || !['csv', 'txt'].includes(input.extension)) throw new Error('统计文件格式或大小无效');
    return { ok: true, path: imageOutput.save(user, Buffer.from(input.text, 'utf8'), input.name, input.extension) };
  });
  nativeHandler('jewelry:data-info', async () => { network.assertLocal(); await requireLogin(true); return { path: dataDir }; });
  // Do not track these calls as business requests: the maintenance service
  // itself drains that barrier, so waiting inside it would deadlock.
  nativeHandler('jewelry:backup',async()=>{
    network.assertLocal();await requireLogin(true);if(!hostRuntime)throw Error('请在主机创建统一备份');
    return hostRuntime.performMaintenance({method:'POST',path:'/api/local/backups'});
  },{maintenance:true});
  nativeHandler('jewelry:restore',async input=>{
    network.assertLocal();const actor=await requireLogin(true);if(!hostRuntime)throw Error('请在主机恢复统一备份');
    if(!input||Object.keys(input).some(k=>!['name','selection'].includes(k))||typeof input.name!=='string'||input.name!==path.basename(input.name)||/[\\/:\x00-\x1f]/.test(input.name)||!['sales','ledger','inventory','documents','allBusiness'].includes(input.selection))throw Error('请选择已核验的备份与恢复范围');
    const answer=await dialog.showMessageBox(window,{type:'question',title:'恢复主机业务资料',message:'恢复所选备份中的业务资料？',detail:'当前业务会先另存备份。账号权限、当前打印防重记录和编号预留不会回退；完成后员工需要重新登录。',buttons:['取消','确认恢复'],defaultId:0,cancelId:0,noLink:true});
    if(answer.response!==1)return{ok:false,canceled:true};
    if((await requireLogin(true)).id!==actor.id)throw Error('管理员账号已切换，恢复未执行');network.assertLocal();
    await moduleViews?.clear();loginReceipt.clear();nativeSessionRevision++;
    const result=await hostRuntime.performMaintenance({method:'POST',path:'/api/local/restore',body:{name:input.name,selection:input.selection,confirmation:'确认恢复所选业务资料'}});
    if(result.ok)setTimeout(()=>{if(window&&!window.isDestroyed())void window.loadURL(localOrigin+'/home');},150);
    return result;
  },{maintenance:true});
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
  const ok = Boolean(state?.ready && state.bridge && state.text.includes('登录') && !state.text.includes('建立你的珠宝工作室') && state.images.every(image => image.loaded) && !rendererErrors.length && !blockedNetwork.length);
  fs.writeFileSync(path.join(output, 'startup-check.json'), JSON.stringify({ ok, electron: process.versions.electron, node: process.versions.node, sqlite: process.versions.sqlite, state, rendererErrors, blockedNetwork }, null, 2));
  shutdownExitCode=ok?0:1;app.quit();
}
if (!globalThis.__xjyReleaseOwnsInstanceLock&&!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window && !window.isDestroyed()) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.whenReady().then(async () => {
    if(employeeClient)backend=createClientBackend();
    else{
      const materialsFactory=materialsEnabled?(await import(pathToFileURL(path.join(__dirname,'materials-runtime','materials-runtime-entry.mjs')).href)).createMaterialRuntimeSuite:undefined;
      if(materialsEnabled&&typeof materialsFactory!=='function')throw Error('素材运行时来源未就绪');
      hostRuntime=await createReleaseHostServices({storage,admission:admissionDescriptor.value,assertAdmission:value=>value===admissionDescriptor.value,...(materialsFactory?{materialsServiceFactory:materialsFactory}:{}),appVersion:appInfoProvider.getAppInfo().appVersion,codeDir:__dirname,resourcesDir:process.resourcesPath,executablePath:app.getPath('exe'),isPackaged:app.isPackaged,printerSettings,helperPins,getNetwork:()=>network,
        onBackendReplaced:async value=>{backend=value;if(network)await network.setBackend(value);},
        onSessionsInvalidated:async()=>{nativeSessionRevision++;loginReceipt.clear();await moduleViews?.clear();if(window&&!window.isDestroyed())await window.webContents.session.clearStorageData({storages:['localstorage']});}});
      backend=hostRuntime.backend;legacyModules=hostRuntime.moduleAdapter;
    }
    network = await createNetworkWorkspace({ backend, configFile: path.join(app.getPath('userData'), 'workspace-connection.json'), clientOnly: employeeClient,...(materialsEnabled&&!employeeClient?{materialsHandler:(input,context)=>hostRuntime.materialsRequest(input,context)}:{}),...(admissionDescriptor.value.mode==='sandbox'?{validateConfig:value=>{if(value.mode!=='standalone'&&(value.host!=='127.0.0.1'||value.port===31831))throw Error('Sandbox 局域网测试只允许独立端口与127.0.0.1');}}:{}) });
    employeeUpdater=createNativeEmployeeUpdate({employeeClient,currentVersion:app.getVersion(),profileDir:storage.profileDir,installDir:path.dirname(app.getPath('exe')),executablePath:app.getPath('exe'),helperPins,network,
      resolveActor:async()=>{const result=await network.request({path:'/auth/status'}),status=result?.data;return result?.ok&&status?.authenticated===true&&status.user?{...status.user,authenticated:true,sessionRef:String(nativeSessionRevision)}:null;},
      requestExit:async request=>{if(request?.pid!==process.pid||request.normalExit!==true)throw Error('升级只能正常退出当前员工程序');setImmediate(()=>app.quit());return{accepted:true};}});
    if(materialsEnabled)materialsProtocol=require('./materials-native-protocol.cjs').createMaterialNativeProtocol({network,assetsRoot:path.join(__dirname,'assets','sales-materials'),getGeneration:()=>nativeSessionRevision});
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
    window = new BrowserWindow({ width: 1440, height: 980, minWidth: 1024, minHeight: 720, title: employeeClient ? '鑫金源 · 员工连接主机' : '鑫金源 · 珠宝报价工作室', icon: path.join(__dirname, 'assets', 'icon.png'), backgroundColor: '#f7f6f3', show: false, autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), additionalArguments:materialsEnabled?['--xjy-sales-materials-enabled']:[], contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, devTools: !app.isPackaged } });
    window.setMenu(null);
    moduleViews=createModuleViews({electron:{WebContentsView,BrowserWindow,session,dialog},window,network,requireLogin,assetsDir:path.join(__dirname,'assets/integration'),profileDir:storage.profileDir});
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, address) => { if (!trustedUrl(address)) event.preventDefault(); });
    window.webContents.on('will-redirect', (event, address) => { if (!trustedUrl(address)) event.preventDefault(); });
    window.webContents.on('will-attach-webview', event => event.preventDefault());
    window.webContents.on('console-message', (_event, details) => { if (selfCheck && details.level === 'error') rendererErrors.push(details.message); });
    window.on('close',event=>{if(!closing){event.preventDefault();window.hide();}});
    window.on('closed', () => { window = null; if(employeeClient&&!closing)app.quit(); });
    tray=new Tray(path.join(__dirname,'assets','icon.png'));tray.setToolTip(employeeClient?'鑫金源 · 员工端运行中':'鑫金源 · 主机后台运行中');
    const show=()=>{if(window&&!window.isDestroyed()){if(window.isMinimized())window.restore();window.show();window.focus();}};
    tray.on('double-click',show);
    if(employeeClient)tray.setContextMenu(Menu.buildFromTemplate([{label:'打开鑫金源珠宝',click:show},{label:'退出员工端',click:()=>app.quit()}]));
    else tray.setContextMenu(Menu.buildFromTemplate([{label:'打开鑫金源珠宝',click:show},{label:'关闭主机后台（管理员）',click:async()=>{try{network.assertLocal();await requireLogin(true);const reply=await dialog.showMessageBox(window,{type:'question',title:'关闭主机后台',message:'关闭后员工将暂时无法连接，确认关闭？',buttons:['继续运行','关闭后台'],defaultId:0,cancelId:0,noLink:true});if(reply.response===1){await requireLogin(true);app.quit();}}catch(error){dialog.showErrorBox('主机仍在运行',error.message);show();}}}]));
    await window.loadURL(localOrigin + '/home');
    if (selfCheck) await diagnostics(); else { window.show(); if (storage.startupMessage) await dialog.showMessageBox(window, { type: 'info', title: '员工连接模式', message: '这台电脑可以直接作为员工端使用', detail: storage.startupMessage, buttons: ['连接店内主机'], noLink: true }); }
  }).catch(error => { if (selfCheck) { fs.mkdirSync(process.env.XJY_SELF_CHECK_OUTPUT, { recursive: true }); fs.writeFileSync(path.join(process.env.XJY_SELF_CHECK_OUTPUT, 'startup-error.txt'), error.stack || error.message); } else dialog.showErrorBox('程序未能打开', error.message + '\n业务资料不会被替换。请核对程序文件和主机后台日志。'); shutdownExitCode=1;app.quit(); });
  app.on('window-all-closed', () => {if(employeeClient&&!closing)app.quit();});
  app.on('before-quit', event => { if (!quitAllowed && (backend||hostRuntime)) { event.preventDefault();if(closing)return; closing = true; taskQueue.then(async () => {await moduleViews?.close();await employeeUpdater?.close();await network?.close();if(hostRuntime)await hostRuntime.close();else await backend?.close();tray?.destroy();}).then(()=>{quitAllowed=true;shutdownExitCode===undefined?app.quit():app.exit(shutdownExitCode);},error=>{closing=false;dialog.showErrorBox('后台尚未完全停止',error.message+'\n为保护业务资料，程序未强制退出。');}); } });
}

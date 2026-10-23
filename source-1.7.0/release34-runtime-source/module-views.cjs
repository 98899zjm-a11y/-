'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createModuleGateway}=require('./module-gateway.cjs');
const {authorizeModuleRequest}=require('./module-workspace-policy.cjs');
const {normalizeModulePrintLocation}=require('./module-print-source.cjs');
const {normalizePrintSource}=require('./print-sources.cjs');
function resolveModulePrintInput(module,input,relative){
 if(!['ledger','inventory'].includes(module))throw Error('打印模块不存在');
 if(input!==undefined&&(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>key!=='source')))throw Error('打印只接受类型化来源，不接受URL或HTML');
 const source=normalizePrintSource(input?.source||normalizeModulePrintLocation(module,relative)||(()=>{throw Error('请使用有明确单据编号或报表筛选的主机打印按钮，不能猜测当前单据来源');})());
 if(module==='ledger'?!['erp-document-a4','erp-report-a4','ledger-report-a4'].includes(source.type):!source.type.startsWith('inventory-'))throw Error('打印来源不属于当前业务模块');return source;
}
function createModuleViews({electron:{WebContentsView,BrowserWindow,session,dialog},window,network,requireLogin,assetsDir,profileDir}){
 const entries=new Map(),popups=new Map();let active=null,closing=false,serial=Promise.resolve();
 const safeFile=value=>{const name=path.basename(value||'导出文件').replace(/[<>:"/\\|?*\x00-\x1f]/g,'').trim().slice(0,160).replace(/[. ]+$/,'');return name&&!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)?name:'导出文件';};
 function sameOrigin(url,origin){try{return new URL(url).origin===origin;}catch{return false;}}
 function bounds(){if(!active||active.view.webContents.isDestroyed())return;const [width,height]=window.getContentSize();let zoom=1;try{const current=window.webContents.getZoomFactor?.();if(Number.isFinite(current)&&current>0)zoom=current;}catch{}const footer=Math.ceil(24*zoom);active.view.setBounds({x:0,y:84,width,height:Math.max(0,height-84-footer)});}
 function hide(){if(active){if(!window.isDestroyed())window.contentView.removeChildView(active.view);active=null;}return{ok:true};}
 const access=user=>user.role==='admin'?{sales:'manage',ledger:'manage',inventory:'manage'}:user.moduleAccess||{sales:'operate',ledger:'disabled',inventory:'disabled'};
 async function valid(entry){try{const user=await requireLogin();return !closing&&user.id===entry.userId&&access(user)[entry.id]!=='disabled'&&JSON.stringify(network.info().mode==='client'?[network.info().host,network.info().port]:['local',profileDir])===entry.scope;}catch{return false;}}
 async function applyTheme(contents,id){if(contents.isDestroyed())return;const file=path.join(assetsDir,id+'-theme.css');if(fs.existsSync(file))await contents.insertCSS(fs.readFileSync(file,'utf8'));}
 function guard(contents,entry){
  contents.on('will-navigate',(event,url)=>{if(!sameOrigin(url,entry.gateway.origin))event.preventDefault();});
  contents.on('will-redirect',(event,url)=>{if(!sameOrigin(url,entry.gateway.origin))event.preventDefault();});
  contents.on('will-attach-webview',event=>event.preventDefault());
  contents.on('did-finish-load',()=>{void applyTheme(contents,entry.id);});
  contents.on('before-input-event',(event,input)=>{if((input.control||input.meta)&&input.key.toLowerCase()==='p'){event.preventDefault();void print(contents,contents.mainFrame).catch(error=>{if(!contents.isDestroyed())void contents.executeJavaScript('window.alert('+JSON.stringify(error.message||'请从明确单据或报表的主机打印入口提交')+')').catch(()=>{});});}});
  contents.setWindowOpenHandler(({url})=>sameOrigin(url,entry.gateway.origin)?{action:'allow',overrideBrowserWindowOptions:{width:1100,height:850,show:false,autoHideMenuBar:true,webPreferences:{session:entry.session,preload:path.join(__dirname,'module-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,spellcheck:false}}}:{action:'deny'});
  contents.on('did-create-window',popup=>{const popupId=popup.webContents.id;popups.set(popupId,{window:popup,entry});popup.setMenu(null);guard(popup.webContents,entry);popup.once('ready-to-show',()=>{if(!closing&&popup&&!popup.isDestroyed())popup.show();});popup.on('closed',()=>popups.delete(popupId));});
 }
 async function make(id){
  if(!['ledger','inventory'].includes(id))throw new Error('模块不存在');
  const user=await requireLogin(),info=network.info(),scope=JSON.stringify(info.mode==='client'?[info.host,info.port]:['local',profileDir]),key=id+':'+user.id+':'+scope;
  if(access(user)[id]==='disabled')throw new Error('管理员尚未授权此模块');
  const existing=entries.get(key);if(existing&&!existing.view.webContents.isDestroyed())return existing;
  const state=await network.request({path:'/api/internal-modules/status'});if(!state.ok)throw new Error(state.data?.error||'主机模块暂时无法连接');
  const status=state.data.modules?.find(m=>m.id===id);if(!status?.configured)throw new Error('请先由主机管理员在设置－模块资料中选择原'+(id==='ledger'?'内账':'库管')+'data文件夹');
  const entry={id,userId:user.id,scope,lastActivityAt:Date.now()};
  entry.gateway=await createModuleGateway({module:id,checkUser:()=>valid(entry),proxy:async input=>{const response=await network.request({path:'/api/internal-modules/proxy',method:'POST',body:input});if(!response.ok)throw new Error(response.data?.error||'主机模块暂时未能连接');return response.data;}});
  const partition='xjy-module-'+crypto.createHash('sha256').update(key).digest('hex').slice(0,32)+'-'+crypto.randomUUID();entry.session=session.fromPartition(partition);
  const permissions=new Set(),supported=new Set(['clipboard-read','clipboard-sanitized-write','media','fullscreen']);
  entry.session.setPermissionCheckHandler((contents,permission)=>supported.has(permission)&&!!contents&&sameOrigin(contents.getURL(),entry.gateway.origin));
  entry.session.setPermissionRequestHandler(async(contents,permission,callback,details)=>{
   if(!supported.has(permission)||!contents||!sameOrigin(contents.getURL(),entry.gateway.origin)||!await valid(entry))return callback(false);
   if(permission==='media'&&details.mediaTypes?.some(type=>type!=='video'))return callback(false);
   if(['clipboard-sanitized-write','fullscreen'].includes(permission)||permissions.has(permission))return callback(true);
   try{const choice=await dialog.showMessageBox(window,{type:'question',title:'模块使用权限',message:permission==='media'?'允许此模块使用摄像头进行扫码？':'允许此模块读取剪贴板，用于粘贴表格内容？',buttons:['允许','取消'],defaultId:1,cancelId:1});if(choice.response===0&&await valid(entry)){permissions.add(permission);callback(true);}else callback(false);}catch{callback(false);}
  });
  entry.session.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!sameOrigin(details.url,entry.gateway.origin)&&!details.url.startsWith('data:')&&!details.url.startsWith('blob:')}));
  entry.session.webRequest.onBeforeSendHeaders((details,callback)=>{const headers={...details.requestHeaders};if(sameOrigin(details.url,entry.gateway.origin))headers['X-XJY-Gateway-Token']=entry.gateway.token;callback({requestHeaders:headers});});
  entry.downloadHandler=async(_event,item)=>{
   item.pause();try{if(!await valid(entry))return item.cancel();const choice=await dialog.showSaveDialog(window,{title:'保存'+(id==='ledger'?'内账':'库管')+'导出文件',defaultPath:safeFile(item.getFilename())});if(choice.canceled||!choice.filePath||!await valid(entry))return item.cancel();item.setSavePath(choice.filePath);item.resume();}catch{item.cancel();}
  };entry.session.on('will-download',entry.downloadHandler);
  entry.view=new WebContentsView({webPreferences:{session:entry.session,preload:path.join(__dirname,'module-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,spellcheck:false,devTools:false}});guard(entry.view.webContents,entry);entries.set(key,entry);
  try{await entry.view.webContents.loadURL(entry.gateway.origin+'/');await applyTheme(entry.view.webContents,id);if(!await valid(entry))throw new Error('主程序账号已经切换');return entry;}catch(error){entries.delete(key);entry.view.webContents.close();await entry.gateway.close();entry.session.removeListener('will-download',entry.downloadHandler);throw error;}
 }
 async function open(id){const work=serial.catch(()=>{}).then(async()=>{
  if(closing)throw new Error('程序正在关闭');const entry=await make(id);if(!await valid(entry))throw new Error('主账号或模块权限已经变化，请重新进入');
  hide();window.contentView.addChildView(entry.view);active=entry;bounds();entry.view.webContents.focus();
  // Screen-only CSS owns the transition so a print started during a switch
  // still uses the original unanimated print layout.
  void entry.view.webContents.executeJavaScript("(()=>{const body=document.body;if(!body||matchMedia('(prefers-reduced-motion: reduce)').matches)return;body.classList.remove('xjy-module-enter');void body.offsetWidth;body.classList.add('xjy-module-enter');setTimeout(()=>body.classList.remove('xjy-module-enter'),240);})()").catch(()=>{});
  return{ok:true};
 });serial=work;return work;}
 async function print(contents,frame,input){const entry=[...entries.values()].find(e=>e.view.webContents===contents)||popups.get(contents.id)?.entry;if(!entry||frame!==contents.mainFrame||!sameOrigin(contents.getURL(),entry.gateway.origin)||!await valid(entry))throw new Error('打印页面或登录验证失败');const location=new URL(contents.getURL()),source=resolveModulePrintInput(entry.id,input,location.pathname+location.search);if(!await valid(entry)||window.isDestroyed())throw Error('打印账号或主窗口已结束');hide();const received=await window.webContents.executeJavaScript('(()=>{const event=new CustomEvent("desktop-central-print",{cancelable:true,detail:'+JSON.stringify({source,module:entry.id})+'});return !window.dispatchEvent(event);})()');if(!received)throw Error('主窗口尚未提供统一打印面板，请更新完整程序');return{ok:true,message:'请在统一主机打印面板核对并提交'};}
 async function noteActivity(contents,frame){const entry=[...entries.values()].find(e=>e.view.webContents===contents)||popups.get(contents.id)?.entry;if(!entry||frame!==contents.mainFrame||!sameOrigin(contents.getURL(),entry.gateway.origin)||!await valid(entry))return false;entry.lastActivityAt=Date.now();return true;}
 async function workspaceRequest(contents,frame,input){
  const entry=[...entries.values()].find(e=>e.view.webContents===contents)||popups.get(contents.id)?.entry;
  if(!entry||frame!==contents.mainFrame||!sameOrigin(contents.getURL(),entry.gateway.origin)||!await valid(entry))throw new Error('协作页面或主账号验证失败');
  const request=authorizeModuleRequest(entry.id,input);const response=await network.request(request);
  if(!await valid(entry))throw new Error('主账号或模块权限已经变化，请重新进入');
  entry.lastActivityAt=Date.now();return response;
 }
 async function activity(){
  if(!active)return{module:null,lastActivityAt:0,visible:false};
  if(!await valid(active)){hide();if(!window.isDestroyed())void window.webContents.executeJavaScript("window.dispatchEvent(new CustomEvent('desktop-module-permission-lost'))").catch(()=>{});return{module:null,lastActivityAt:0,visible:false};}
  const visible=!window.isDestroyed()&&!window.isMinimized()&&(window.isFocused()||[...popups.values()].some(p=>p.entry===active&&!p.window.isDestroyed()&&p.window.isFocused()));return{module:active.id,lastActivityAt:active.lastActivityAt,visible};
 }
 async function clear(){
  hide();for(const popup of popups.values())if(!popup.window.isDestroyed())popup.window.destroy();popups.clear();
  const oldEntries=[...entries.values()];entries.clear();
  await Promise.all(oldEntries.map(async entry=>{
   await entry.gateway.close();entry.session.removeListener('will-download',entry.downloadHandler);
   let cleanupTimer;
   try{
    // Clear module authentication while its browser context is still alive.
    // Electron 44 can leave clearStorageData pending after the last view closes.
    const cleanup=(async()=>{const cookies=await entry.session.cookies.get({});await Promise.all(cookies.map(cookie=>entry.session.cookies.remove(entry.gateway.origin+(cookie.path||'/'),cookie.name)));})();
    await Promise.race([cleanup,new Promise((_,reject)=>{cleanupTimer=setTimeout(()=>reject(new Error('浏览器会话清理超时')),3000);})]);
   }catch{
    // Every new view gets a fresh non-persistent partition. With the gateway
    // closed and the old view removed, an expired context cannot be reused.
   }finally{clearTimeout(cleanupTimer);if(!entry.view.webContents.isDestroyed())entry.view.webContents.close({waitForBeforeUnload:false});}
  }));
 }
 window.on('resize',bounds);
 return{open,hide,print,noteActivity,workspaceRequest,activity,clear,async close(){closing=true;await serial.catch(()=>{});await clear();}};
}
module.exports={createModuleViews,resolveModulePrintInput};

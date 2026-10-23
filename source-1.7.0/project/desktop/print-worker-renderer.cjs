'use strict';
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const CSP="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";
function failure(code,message){return Object.assign(new Error(message),{code});}
function rasterHtml(pages){
  if(!Array.isArray(pages)||!pages.length||pages.length>200)throw failure('PRINT_PDF_INVALID','PDF页数无效');
  const {validatePassiveImage}=require('./print-worker-passive-dom.cjs');
  const html=pages.map(page=>{if(!Number.isFinite(page.widthMm)||!Number.isFinite(page.heightMm)||page.widthMm<=0||page.heightMm<=0||page.widthMm>420||page.heightMm>500)throw failure('PRINT_PDF_INVALID','PDF纸张尺寸无效');const src='data:image/png;base64,'+page.pngBase64;validatePassiveImage(src);return '<section class="xjy-pdf-page"><img alt="原报表页面" src="'+src+'" style="width:100%;height:100%;object-fit:contain"></section>';}).join('');
  return '<!doctype html><html><head><meta charset="utf-8"><style>@page{size:A4;margin:0}html,body{margin:0;padding:0;width:210mm}.xjy-pdf-page{width:210mm;height:296mm;break-after:page;overflow:visible}.xjy-pdf-page:last-child{break-after:auto}img{display:block}</style></head><body>'+html+'</body></html>';
}
function createElectronPrintRenderer({electron,buildTemplate,rasterizePdf,getSourcePolicy,readyTimeoutMs=15000,preloadPath=path.join(__dirname,'generated/print-worker-preload.cjs')}){
  const {BrowserWindow,session,ipcMain}=electron, states=new Map(),deviceWindows=new Set();let closed=false;
  function trusted(event){const state=states.get(event.sender.id);if(!state||state.window.isDestroyed()||event.senderFrame!==event.sender.mainFrame||event.senderFrame.url!==state.url)throw failure('PRINT_RENDER_UNTRUSTED','被动打印页面来源验证失败');return state;}
  ipcMain.handle('xjy-worker:policy',event=>trusted(event).policy);
  ipcMain.handle('xjy-worker:ready',(event,result)=>{const state=trusted(event);if(result?.ok===true&&Number.isInteger(result.pages)&&result.pages>0&&result.pages<=200){state.resolve(result);}else state.reject(failure(typeof result?.code==='string'?result.code:'PRINT_RENDER_ERROR',String(result?.error||'被动打印文档未准备').slice(0,800)));return true;});
  async function destroy(state){if(!state)return;clearTimeout(state.timer);states.delete(state.window.webContents.id);state.session.protocol.unhandle('xjy-print');if(!state.window.isDestroyed())state.window.destroy();}
  async function render(payload){
    if(closed)throw failure('PRINT_AGENT_CLOSED','被动打印适配已关闭');
    let html,templatePolicy={};
    if(payload.renderMode==='passive-pdf-pages'){if(typeof rasterizePdf!=='function')throw failure('PRINT_PDF_RENDERER_UNAVAILABLE','真正被动PDF页面渲染依赖未配置，不能使用浏览器PDF插件');html=rasterHtml(await rasterizePdf(Buffer.from(payload.document.bodyBase64,'base64')));}
    else if(payload.html!==undefined)html=payload.html;
    else{if(typeof buildTemplate!=='function')throw failure('PRINT_TEMPLATE_UNAVAILABLE','销售被动模板未构建');const result=await buildTemplate(payload);if(typeof result==='string')html=result;else{html=result.html;templatePolicy=result.policy||{};}}
    if(typeof html!=='string'||Buffer.byteLength(html)>64*1024*1024)throw failure('PRINT_DOCUMENT_LIMIT','被动页面内容无效或过大');
    const token=randomUUID(),url='xjy-print://document/'+token, partition=session.fromPartition('xjy-print-worker-'+token);
    partition.setPermissionRequestHandler((_wc,_permission,cb)=>cb(false));partition.setPermissionCheckHandler(()=>false);
    partition.webRequest.onBeforeRequest((details,cb)=>cb({cancel:details.url!==url&&!/^data:(?:image\/(?:png|jpeg|webp|gif)|font\/(?:woff2?|ttf|otf));base64,/.test(details.url)}));
    partition.protocol.handle('xjy-print',request=>request.url===url&&request.method==='GET'?new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':CSP,'X-Content-Type-Options':'nosniff'}}):new Response('',{status:403}));
    let paper=payload.kind==='warranty'?{...payload.route.paper,landscape:false}:{widthMm:210,heightMm:297,landscape:false};
    if(payload.document?.format==='trusted-html'&&typeof getSourcePolicy==='function'){
      const fixed=getSourcePolicy(payload.kind);if(!fixed||typeof fixed.landscape!=='boolean'||fixed.widthMm!==(fixed.landscape?297:210)||fixed.heightMm!==(fixed.landscape?210:297)||fixed.contentWidthMm!==undefined&&(!Number.isFinite(fixed.contentWidthMm)||fixed.contentWidthMm<=0||fixed.contentWidthMm>fixed.widthMm)||fixed.contentHeightMm!==undefined&&(!Number.isFinite(fixed.contentHeightMm)||fixed.contentHeightMm<=0||fixed.contentHeightMm>fixed.heightMm))throw failure('PRINT_RESOURCE_MISSING','固定原模板A4方向policy无效');paper=fixed;
    }
    // Chromium's JavaScript engine must run the trusted isolated preload.
    // Document scripts and handlers remain disabled by the immutable response
    // CSP script-src 'none', with no bridge exposed to the page context.
    const window=new BrowserWindow({width:Math.ceil((paper.contentWidthMm||paper.widthMm)*96/25.4),height:Math.ceil((paper.contentHeightMm||paper.heightMm)*96/25.4),show:false,backgroundColor:'#ffffff',autoHideMenuBar:true,webPreferences:{session:partition,preload:preloadPath,javascript:true,contextIsolation:true,nodeIntegration:false,sandbox:true,plugins:false,webviewTag:false,devTools:false,spellcheck:false,backgroundThrottling:false,disableDialogs:true,navigateOnDragDrop:false}});
    window.setMenu(null);window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    for(const event of ['will-navigate','will-frame-navigate','will-redirect','will-attach-webview'])window.webContents.on(event,e=>e.preventDefault());
    let resolve,reject;const ready=new Promise((a,b)=>{resolve=a;reject=b;});ready.catch(()=>{});
    const state={window,session:partition,url,resolve,reject,policy:{...templatePolicy,...paper,kind:payload.kind,fontSizes:payload.presentation?.settings?.fontSizes||{},scalePercent:payload.presentation?.settings?.scalePercent||100}};
    states.set(window.webContents.id,state);state.timer=setTimeout(()=>reject(failure('PRINT_RENDER_TIMEOUT','被动打印页面准备超时')),readyTimeoutMs);
    window.webContents.on('render-process-gone',()=>reject(failure('PRINT_RENDER_CRASHED','被动打印页面进程中断')));window.once('closed',()=>reject(failure('PRINT_RENDER_CLOSED','被动打印页面提前关闭')));
    try{await window.loadURL(url);state.readiness=await ready;clearTimeout(state.timer);return state;}catch(e){await destroy(state);throw e;}
  }
  // Intentionally not async: native print is invoked synchronously by this
  // function before the Promise returns to the final-gate agent continuation.
  function submit(state,options){if(closed||!states.has(state.window.webContents.id)||state.window.isDestroyed())throw failure('PRINT_RENDER_CLOSED','被动打印页面已失效');return new Promise(resolve=>{state.window.webContents.print({...options,landscape:state.policy.landscape===true},(success,reason)=>resolve(success?{status:'submitted'}:{status:'failed',error:String(reason||'系统打印队列未接收').slice(0,800)}));});}
  async function enumerate(){if(closed)throw failure('PRINT_AGENT_CLOSED','被动打印适配已关闭');const window=new BrowserWindow({show:false,webPreferences:{javascript:false,nodeIntegration:false,sandbox:true,contextIsolation:true,plugins:false,devTools:false}});deviceWindows.add(window);try{return await window.webContents.getPrintersAsync();}finally{deviceWindows.delete(window);if(!window.isDestroyed())window.destroy();}}
  return {render,destroy,submit,enumerate,async close(){closed=true;for(const state of [...states.values()])await destroy(state);for(const window of deviceWindows)if(!window.isDestroyed())window.destroy();deviceWindows.clear();ipcMain.removeHandler('xjy-worker:policy');ipcMain.removeHandler('xjy-worker:ready');}};
}
module.exports={createElectronPrintRenderer,rasterHtml};

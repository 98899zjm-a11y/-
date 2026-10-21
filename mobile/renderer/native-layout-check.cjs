'use strict';
const {app,BrowserWindow,protocol,session}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve('E:/codex/2026-10-10/ce/work/mobile-ui-fixture'),output=path.resolve('E:/codex/2026-10-10/ce/work/mobile-ui-qa');
fs.mkdirSync(output,{recursive:true});app.setPath('userData',path.join(output,'isolated-test-profile'));
app.on('window-all-closed',()=>{});
protocol.registerSchemesAsPrivileged([{scheme:'jewelry',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}}]);
const blocked=[],errors=[];
app.whenReady().then(async()=>{
 session.defaultSession.setPermissionRequestHandler((_a,_b,done)=>done(false));session.defaultSession.webRequest.onBeforeRequest((request,done)=>{const ok=request.url.startsWith('jewelry://app/')||/^(blob|data):/.test(request.url);if(!ok)blocked.push(request.url);done({cancel:!ok});});
 protocol.handle('jewelry',request=>{const u=new URL(request.url),file=path.resolve(root,decodeURIComponent(u.pathname).slice(1)),relation=path.relative(root,file);if(u.hostname!=='app'||relation.startsWith('..')||!fs.existsSync(file)||!fs.statSync(file).isFile())return new Response('',{status:404});const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml'};return new Response(fs.readFileSync(file),{headers:{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'}});});
 const records=[];
 for(const width of [390,430]){
  const win=new BrowserWindow({show:false,frame:false,width,height:844,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false,spellcheck:false}});win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('console-message',(_event,d)=>{if(d.level==='error')errors.push(d.message);});
  for(const page of ['home','sales','tradein','recycling','repairs','custom','gallery','customers','history','settings','connect','login']){
   await win.loadURL(`jewelry://app/fixture.html?page=${['connect','login'].includes(page)?'home':page}${['connect','login'].includes(page)?'&access='+page:''}`);const until=Date.now()+5000;while(Date.now()<until){const ready=await win.webContents.executeJavaScript('!!window.__xjyMobileFixture?.ready');if(ready)break;await new Promise(resolve=>setTimeout(resolve,30));}
   if(['sales','tradein','recycling','repairs','custom'].includes(page)){await win.webContents.executeJavaScript(`document.querySelector('.paper-stage')?.scrollIntoView({block:'center'});`);await new Promise(resolve=>setTimeout(resolve,100));}
   const state=await win.webContents.executeJavaScript(`({width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,pageTitle:document.querySelector('.page-header h1,.mobile-access-heading h1')?.textContent,buttons:[...document.querySelectorAll('.preview-actions button')].map(x=>x.textContent),tabs:[...document.querySelectorAll('.settings-tabs button')].map(x=>x.textContent),paper:document.querySelector('.qp-paper')?{width:document.querySelector('.qp-paper').getBoundingClientRect().width,height:document.querySelector('.qp-paper').getBoundingClientRect().height}:null,forbidden:window.__xjyMobileFixture.forbiddenCalls,touchTargets:[...document.querySelectorAll('.mobile-dock button,.draft-item-remove')].map(x=>({width:x.getBoundingClientRect().width,height:x.getBoundingClientRect().height}))})`);
   if(state.paper&&state.paper.width===0){state.paperDebug=await win.webContents.executeJavaScript(`(()=>{let e=document.querySelector('.qp-paper'),r=[];while(e){const s=getComputedStyle(e);r.push({tag:e.tagName,class:e.className,isConnected:e.isConnected,namespace:e.namespaceURI,constructor:e.constructor.name,display:s.display,contentVisibility:s.contentVisibility,width:s.width,height:s.height,visibility:s.visibility,transform:s.transform,hidden:e.hidden,rect:e.getBoundingClientRect().toJSON()});e=e.parentElement;}return r;})()`);}
   records.push({viewport:width,page,...state});if(['home','sales','gallery','settings','connect','login'].includes(page))fs.writeFileSync(path.join(output,`${width}-${page}.png`),(await win.webContents.capturePage()).toPNG());
  }
  win.destroy();
 }
 const ok=!blocked.length&&!errors.length&&records.every(record=>!record.overflow&&!record.forbidden.length&&!record.tabs.some(tab=>/本机数据|局域网/.test(tab))&&!record.buttons.some(button=>/A4|质保/.test(button))&&(!record.paper||record.paper.width===0||Math.abs(record.paper.width/record.paper.height-9/16)<.001)&&record.touchTargets.every(target=>target.width>=44&&target.height>=44));
 const unmeasuredPapers=records.filter(record=>record.paper?.width===0).map(record=>({viewport:record.viewport,page:record.page}));
 fs.writeFileSync(path.join(output,'mobile-layout-check.json'),JSON.stringify({ok,scope:'390/430 touch targets, horizontal overflow, hidden PC tools; offscreen geometry omitted where the hidden renderer reports no layout box',unmeasuredPapers,records,blocked,errors},null,2));app.exit(ok?0:1);
}).catch(error=>{fs.writeFileSync(path.join(output,'error.txt'),error.stack||error.message);app.exit(1);});

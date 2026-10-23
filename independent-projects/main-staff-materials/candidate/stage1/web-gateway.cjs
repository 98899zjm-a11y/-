'use strict';
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {appInfoFromVersion}=require('../project/desktop/app-info.cjs');
function createGateway({backend,server,root,appVersion,clock=Date.now,sessionLimit=256,sessionTtlMs=12*60*60*1000,browserStaticRoot=null,browserDefault=false,allowLocalControls}){
 const sessionCookiePrefix=arguments[0].sessionCookiePrefix;
 if(sessionCookiePrefix!==undefined&&(typeof sessionCookiePrefix!=='string'||sessionCookiePrefix.trim()!==sessionCookiePrefix||!/^[a-z][a-z0-9_]{7,47}$/.test(sessionCookiePrefix)||sessionCookiePrefix==='xjy_stage1'))throw new TypeError('Invalid or reserved session Cookie namespace prefix');
 const authCookieName=sessionCookiePrefix===undefined?'xjy_stage1':sessionCookiePrefix+'_auth',bootstrapCookieName=sessionCookiePrefix===undefined?'xjy_stage1_bootstrap':sessionCookiePrefix+'_bootstrap';
 const materialsHandler=arguments[0].materialsHandler;if(materialsHandler!==undefined&&typeof materialsHandler!=='function')throw new TypeError('Trusted materials handler must be a function');
 const gatewayLogDir=arguments[0].logDir===undefined?path.join(root,'logs'):arguments[0].logDir;
 if(typeof gatewayLogDir!=='string'||!path.isAbsolute(gatewayLogDir))throw new TypeError('Gateway logDir must be an owned absolute directory');
 const logRelative=path.relative(path.resolve(root),path.resolve(gatewayLogDir));
 if(!logRelative||logRelative==='..'||logRelative.startsWith('..'+path.sep)||path.isAbsolute(logRelative))throw new TypeError('Gateway logDir must remain within its owned root');
 function appendGatewayError(error){
  let descriptor;
  try{
   for(let cursor=path.resolve(gatewayLogDir);;){const info=fs.lstatSync(cursor);if(info.isSymbolicLink()||!info.isDirectory())throw Error('Unsafe gateway log directory');const parent=path.dirname(cursor);if(parent===cursor)break;cursor=parent;}
   const file=path.join(gatewayLogDir,'gateway-errors.log');
   let prior;try{prior=fs.lstatSync(file);}catch(error){if(error.code!=='ENOENT')throw error;}if(prior&&(!prior.isFile()||prior.isSymbolicLink()||prior.nlink!==1))throw Error('Unsafe gateway log file');
   descriptor=fs.openSync(file,'a',0o600);const opened=fs.fstatSync(descriptor),current=fs.lstatSync(file);
   if(!opened.isFile()||opened.nlink!==1||current.isSymbolicLink()||opened.ino!==current.ino||opened.dev!==current.dev||path.resolve(fs.realpathSync.native(file)).toLowerCase()!==path.resolve(file).toLowerCase())throw Error('Gateway log identity changed');
   fs.writeSync(descriptor,String(error.stack||error)+'\n');
  }catch{/* Logging must not replace the original HTTP failure or follow aliases. */}
  finally{if(descriptor!==undefined)try{fs.closeSync(descriptor);}catch{}}
 }
 function reportError(res,error){appendGatewayError(error);try{if(!res.headersSent&&!res.destroyed)respond(res,error.status||500,{error:error.status?error.message:'隔离服务操作失败，查看本地测试日志'});else if(!res.writableEnded&&!res.destroyed)res.end();}catch{if(!res.destroyed)res.destroy();}}
 let controls=null;if(typeof clock!=='function'||!Number.isInteger(sessionLimit)||sessionLimit<1||sessionLimit>256||!Number.isFinite(sessionTtlMs)||sessionTtlMs<=0||sessionTtlMs>12*60*60*1000)throw new Error('Invalid private session policy');
 const sessions=new Map(),loginLeases=new Map(),closingSessions=new Map(),pending=new Set(),origin='http://127.0.0.1:'+server.address().port,expires=sessionTtlMs,localControls=allowLocalControls===undefined?!browserStaticRoot:allowLocalControls;let paused=false,replacing=false,accepting=true,cleanupFailed=false,generation=0;
 const browserRoutes=new Set(['home','sales','salesOrders','trade-in','tradein','recycling','repair','repairs','custom','customers','history','gallery','styles','settings','reports','permissions','operationLogs','usage','personalSales','employeeProfile','notes']);
 function body(req,max,raw=false){return new Promise((resolve,reject)=>{let bytes=0,chunks=[],failed=false;req.on('data',x=>{bytes+=x.length;if(bytes>max){failed=true;chunks=[];const e=new Error('请求内容超过本地限制');e.status=413;reject(e);req.resume();}else if(!failed)chunks.push(x);});req.on('end',()=>{if(failed)return;const value=Buffer.concat(chunks);if(raw)return resolve(value);try{resolve(JSON.parse(value.toString()||'{}'));}catch{const e=new Error('JSON格式错误');e.status=400;reject(e);}});req.on('error',reject);});}
 function staticFile(relative){if(!browserStaticRoot)throw Object.assign(new Error('浏览器程序尚未构建'),{status:503});const base=path.resolve(browserStaticRoot),file=path.resolve(base,relative);if(!file.startsWith(base+path.sep))throw Object.assign(new Error('浏览器静态文件必须位于已核验的程序目录'),{status:403});for(let p=file;p!==path.dirname(p);p=path.dirname(p)){const item=fs.lstatSync(p);if(item.isSymbolicLink()||p===file&&(!item.isFile()||item.nlink!==1))throw Object.assign(new Error('静态程序不能包含链接'),{status:403});}const actual=fs.realpathSync(file),actualBase=fs.realpathSync(base);if(!path.relative(actualBase,actual)||path.relative(actualBase,actual).startsWith('..')||path.isAbsolute(path.relative(actualBase,actual)))throw Object.assign(new Error('静态程序越界'),{status:403});return fs.readFileSync(file);}
 function serveBrowser(res,name,type='text/html; charset=utf-8'){const bytes=staticFile(name);res.setHeader('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'");res.writeHead(200,{'content-type':type,'cache-control':'no-store'});return res.end(bytes);}
 const respond=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(data));};
 const anonymousStatus=()=>({needsSetup:backend.auth?.status?.()?.needsSetup===true,authenticated:false});
 const isLive=entry=>!entry.revoked&&sessions.get(entry.id)===entry;
 function cookieIds(header){
  const result={};
  for(const part of String(header||'').split(';')){const split=part.indexOf('=');const name=(split<0?part:part.slice(0,split)).trim();if(name!==authCookieName&&name!==bootstrapCookieName)continue;if(Object.prototype.hasOwnProperty.call(result,name))throw Object.assign(new Error('会话 Cookie 重复，请重新打开页面'),{status:400});result[name]=split<0?'':part.slice(split+1).trim();}
  return result;
 }
 function createEntry(kind,session,loginScopeId){
  const entry={csrf:crypto.randomBytes(32).toString('hex'),touched:clock(),busy:0,revoked:false,printIntents:new Map()};
  // Entry identity and its owned backend object never change during promotion.
  Object.defineProperties(entry,{id:{value:crypto.randomBytes(32).toString('hex'),enumerable:true},kind:{value:kind,enumerable:true},session:{value:session,enumerable:true},loginScopeId:{value:loginScopeId}});
  if(browserStaticRoot&&kind==='auth')entry.moduleProxy=require('./browser-module-proxy.cjs').createBrowserModuleProxy({appVersion,session,origin,getCsrf:()=>entry.csrf,registerPrintIntent(source,module){if(!isLive(entry))throw Object.assign(new Error('打印登录已结束'),{status:401});const user=session.auth.status().user;if(!user)throw Object.assign(new Error('打印登录已结束'),{status:401});for(const[id,value]of entry.printIntents)if(clock()-value.created>30*60*1000)entry.printIntents.delete(id);if(entry.printIntents.size>=64)throw Object.assign(new Error('打印面板过多，请关闭旧窗口'),{status:429});const id=crypto.randomUUID();entry.printIntents.set(id,{source,module,actorId:user.id,created:clock()});return id;}});
  return entry;
 }
 const cleanupMessage='会话清理未完成，请由管理员正常重启主机后重试';
 function closeOwned(session,scope){
  const prior=closingSessions.get(session);if(prior)return prior.promise;
  const record={scope,promise:null};closingSessions.set(session,record);
  try{record.promise=Promise.resolve(session.close()).then(()=>{closingSessions.delete(session);},error=>{cleanupFailed=true;throw error;});}
  catch(error){cleanupFailed=true;record.promise=Promise.reject(error);}
  // Rejected records remain charged. Retrying HTTP cannot create an unbounded
  // set of objects whose backend close is still pending or has failed.
  return record.promise;
 }
 function closeEntry(entry){
  if(sessions.get(entry.id)===entry)sessions.delete(entry.id);
  entry.revoked=true;
  if(!entry.closing)entry.closing=closeOwned(entry.session,entry.loginScopeId);
  try{entry.printIntents.clear();entry.moduleProxy?.clear();}catch(error){cleanupFailed=true;entry.closing=entry.closing.then(()=>{throw error;});}
  return entry.closing;
 }
 function occupiedSlots(){
  const scopes=new Set([...sessions.values()].map(entry=>entry.loginScopeId));
  for(const lease of loginLeases.values())scopes.add(lease.source.loginScopeId);
  for(const record of closingSessions.values())scopes.add(record.scope);
  return scopes.size;
 }
 async function closeAll(){
  const promises=[...sessions.values()].map(closeEntry);for(const record of closingSessions.values())promises.push(record.promise);
  const results=await Promise.allSettled([...new Set(promises)]),failure=results.find(result=>result.status==='rejected');
  if(failure)throw failure.reason;
  if(cleanupFailed)throw new Error(cleanupMessage);
 }
 function rejectUnavailable(res,entry){
  if(cleanupFailed){respond(res,503,{error:cleanupMessage});return true;}
  if(!accepting||paused||replacing){respond(res,503,{error:'主机正在维护，请稍后重试'});return true;}
  if(entry&&!isLive(entry)){respond(res,401,{error:'会话已失效，请重新登录'});return true;}
  return false;
 }
 function setCookie(res,name,entry){res.setHeader('set-cookie',`${name}=${entry.id}; Path=/; HttpOnly; SameSite=Strict`);}
 async function reclaimExpired(){const closing=[];for(const entry of sessions.values())if(!entry.busy&&clock()-entry.touched>expires)closing.push(closeEntry(entry));await Promise.allSettled(closing);}
 async function login(entry,input,req,res){
  if(!isLive(entry))return respond(res,401,{error:'会话已失效，请重新登录'});
  if(loginLeases.has(entry.loginScopeId))return respond(res,409,{error:'此会话正在登录，请稍后重试'});
  const audit=backend.reloginAudit;
  if(audit&&['capture','closeSource','attach','fail','isFailure'].some(name=>typeof audit[name]!=='function'))throw Object.assign(new Error('可信重登录审计尚未就绪'),{status:503});
  const lease={source:entry,slotEntry:entry,generation,detached:false};loginLeases.set(entry.loginScopeId,lease);
  let temporary=null,published=false,retryAttempted=false,auditTicket=null;
  const current=()=>loginLeases.get(entry.loginScopeId)===lease&&lease.generation===generation;
  function ensureCurrent(){
   if(cleanupFailed)throw Object.assign(new Error(cleanupMessage),{status:503});
   if(!accepting||paused||replacing)throw Object.assign(new Error('主机正在维护，请稍后重试'),{status:503});
   if(!current()||req.aborted===true||res.destroyed===true||!lease.detached&&!isLive(entry))throw Object.assign(new Error('登录会话已失效，请重新登录'),{status:401});
  }
  async function publishRetry(){
   if(published||retryAttempted||entry.kind!=='auth'||!current()||!accepting||replacing||cleanupFailed||req.aborted===true||res.destroyed===true)return;
   retryAttempted=true;
   const session=backend.createSession({sourcePeer:'isolated-loopback',loginScopeId:entry.loginScopeId});
   let next;try{next=createEntry('anonymous',session,entry.loginScopeId);}catch(error){await closeOwned(session,entry.loginScopeId);throw error;}
   sessions.set(next.id,next);lease.slotEntry=next;setCookie(res,bootstrapCookieName,next);
  }
  try{
   // local-auth.login clears its old identity before any validation, including
   // 400/401/429. Revoke the old browser authority before independent checking.
   if(entry.kind==='auth'){
    lease.detached=true;
    try{if(audit)auditTicket=audit.capture(entry.session);if(auditTicket)audit.closeSource(auditTicket);}
    finally{await closeEntry(entry);}
   }
   ensureCurrent();
   temporary=backend.createSession({sourcePeer:'isolated-loopback',loginScopeId:entry.loginScopeId});
   if(auditTicket)audit.attach(auditTicket,temporary);
   const result=await temporary.dispatch(input);ensureCurrent();
   if(result.status===200&&temporary.auth.status().authenticated){
    if(entry.kind==='anonymous'){lease.detached=true;await closeEntry(entry);ensureCurrent();}
    const next=createEntry('auth',temporary,entry.loginScopeId);sessions.set(next.id,next);lease.slotEntry=next;published=true;
    setCookie(res,authCookieName,next);return respond(res,200,{...result.data,csrf:next.csrf});
   }
   await publishRetry();
   if(result.status===200)return respond(res,500,{error:'登录验证未建立账号会话，请重试'});
   return respond(res,result.status,result.data);
  }catch(error){
   let failure=error;
   if(auditTicket)try{await audit.fail(auditTicket,error.status);}catch(auditError){failure=auditError;}
   // Only this backend's branded internal audit error activates failure-stop.
   // Arbitrary HTTP body/header fields never become actors or audit authority.
   if(audit?.isFailure(failure))cleanupFailed=true;
   await publishRetry();throw failure;
  }
  finally{
   try{if(temporary&&!published)await closeOwned(temporary,entry.loginScopeId);}
   finally{if(loginLeases.get(entry.loginScopeId)===lease)loginLeases.delete(entry.loginScopeId);}
  }
 }
 async function handler(req,res){let usedEntry=null;
  res.setHeader('x-content-type-options','nosniff');res.setHeader('referrer-policy','no-referrer');res.setHeader('x-frame-options','DENY');res.setHeader('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try{
   if(req.headers.host!==origin.slice(7)||!['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress))return respond(res,403,{error:'仅允许隔离本机访问'});
   if(!accepting)return respond(res,503,{error:'主机正在正常关闭，请稍后重新连接'});
   if(req.url.split('?')[0]==='/app-info'){
    if(req.method!=='GET'){res.setHeader('allow','GET');return respond(res,405,{error:'版本信息只接受只读查询。'});}
    if(req.url!=='/app-info')return respond(res,400,{error:'版本信息查询不接受参数。'});
    try{return respond(res,200,appInfoFromVersion(appVersion));}catch{return respond(res,503,{error:'版本信息暂不可用。'});}
   }
   if(req.url==='/health'&&req.method==='GET')return respond(res,200,{ok:true,mode:'isolated-local',publicAccess:false});
   if(req.url==='/'&&req.method==='GET'){if(browserDefault)return serveBrowser(res,'browser.html');res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});return res.end(fs.readFileSync(path.join(root,'stage1','web','index.html')));}
   if(browserStaticRoot&&req.method==='GET'){
    const location=new URL(req.url,origin),pathname=location.pathname;
    if(pathname!==req.url.split('?')[0]||pathname.includes('%')||pathname.includes('\\')||pathname.includes('//'))return respond(res,400,{error:'浏览器页面地址不正确'});
    if(pathname==='/browser/'||browserRoutes.has(pathname.slice(1)))return serveBrowser(res,'browser.html');
    const staticAsset=/^\/assets\/([A-Za-z0-9._-]+\.(?:js|css|png|jpg|jpeg|webp|svg|woff2?))$/.exec(pathname);
    if(staticAsset){const ext=path.extname(pathname),type=ext==='.js'?'text/javascript':ext==='.css'?'text/css':ext==='.svg'?'image/svg+xml':ext.startsWith('.woff')?'font/woff2':'image/'+ext.slice(1);return serveBrowser(res,'assets/'+staticAsset[1],type);}
    if(/^\/[A-Za-z0-9._-]+\.(?:png|jpg|jpeg|webp|avif|ico|svg)$/.test(pathname)&&fs.existsSync(path.join(browserStaticRoot,pathname.slice(1))))return serveBrowser(res,pathname.slice(1),pathname.endsWith('.svg')?'image/svg+xml':'image/'+path.extname(pathname).slice(1));
   }
   const asset=!browserStaticRoot&&/^\/(app\.js|style\.css)$/.exec(req.url);if(asset&&req.method==='GET'){res.writeHead(200,{'content-type':asset[1].endsWith('.js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8'});return res.end(fs.readFileSync(path.join(root,'stage1','web',asset[1])));}
   if(paused||replacing)return respond(res,503,{error:'主机正在制作一致性备份，请稍后再操作'});
   if(cleanupFailed)return respond(res,503,{error:cleanupMessage});
   const ids=cookieIds(req.headers.cookie),pathname=req.url.split('?')[0];
   const materialNavigation=Boolean(materialsHandler)&&req.method==='GET'&&(req.url==='/materials'||req.url==='/materials/');
   const unauthenticated=message=>{if(materialNavigation){res.writeHead(303,{location:'/', 'cache-control':'no-store'});return res.end();}return respond(res,401,{error:message});};
   if(['/auth/login','/auth/logout'].includes(pathname)&&req.url!==pathname)return respond(res,400,{error:'登录或退出须使用规范地址'});
   if(pathname==='/auth/setup')return respond(res,403,{error:'浏览器不可初始化主机账号'});
   if((['/auth/login','/auth/logout'].includes(pathname)&&req.method!=='POST')||(pathname==='/auth/status'&&req.method!=='GET'))return respond(res,405,{error:'登录请求方式不正确'});
   await reclaimExpired();
   if(rejectUnavailable(res))return;
   const lookup=(id,kind)=>/^[a-f0-9]{64}$/.test(id||'')&&sessions.get(id)?.kind===kind?sessions.get(id):null;
   let authority=lookup(ids[authCookieName],'auth'),bootstrap=lookup(ids[bootstrapCookieName],'anonymous');
   if(authority&&!authority.session.auth.status().authenticated){await closeEntry(authority);authority=null;}
   if(rejectUnavailable(res))return;
   if(bootstrap&&!isLive(bootstrap))bootstrap=null;
   let entry=authority||bootstrap;
   // Status is read-only. An old token never allocates a replacement or reveals
   // the native account. A bootstrap always projects as anonymous.
   if(pathname==='/auth/status'&&req.method==='GET'){
    if(entry){entry.touched=clock();return respond(res,200,entry.kind==='auth'?entry.session.auth.status():anonymousStatus());}
    return respond(res,200,anonymousStatus());
   }
   if(!entry&&req.url==='/session'&&req.method==='GET'){
    if(occupiedSlots()>=sessionLimit)return respond(res,429,{error:'测试会话过多，请稍后重试'});
    const scope=crypto.randomUUID(),session=backend.createSession({sourcePeer:'isolated-loopback',loginScopeId:scope});
    try{entry=createEntry('anonymous',session,scope);}catch(error){await closeOwned(session,scope);throw error;}
    sessions.set(entry.id,entry);setCookie(res,bootstrapCookieName,entry);
   }
   if(!entry)return unauthenticated('会话已失效，请重新登录');
   entry.busy=(entry.busy||0)+1;usedEntry=entry;entry.touched=clock();
   if(req.url==='/session'&&req.method==='GET')return respond(res,200,{...(entry.kind==='auth'?entry.session.auth.status():anonymousStatus()),csrf:entry.csrf});
   if(entry.kind!=='auth'&&!['/auth/login','/auth/logout'].includes(req.url))return unauthenticated('请先登录测试员工账号');
   if(materialsHandler&&(pathname==='/materials'||pathname.startsWith('/materials/'))){
    const location=new URL(req.url,origin);
    if(location.origin!==origin||location.pathname!==pathname||pathname.includes('%')||pathname.includes('\\')||pathname.includes('//')||req.url.includes('#'))return respond(res,400,{error:'素材地址须为规范的同源路径'});
    if(!['GET','POST','PATCH','PUT','DELETE'].includes(req.method))return respond(res,405,{error:'不支持此素材请求方法'});
    if(req.headers.origin&&req.headers.origin!==origin||req.headers['sec-fetch-site']==='cross-site'||req.method!=='GET'&&(req.headers.origin!==origin||req.headers['x-xjy-csrf']!==entry.csrf))return respond(res,403,{error:'素材请求来源或防伪令牌无效'});
    if(rejectUnavailable(res,entry))return;
    if(!entry.session.auth.status().authenticated)return respond(res,401,{error:'请先登录员工账号'});
    const materialGeneration=generation;
    const context=Object.freeze({origin,session:entry.session,administration:backend.administration,gatewayCsrf:entry.csrf,isLive:()=>accepting&&!paused&&!replacing&&!cleanupFailed&&generation===materialGeneration&&isLive(entry)});
    // The trusted handler owns binary limits and rechecks context/actor immediately
    // before each mutation or response; the original busy/pending lifecycle remains.
    await materialsHandler(req,res,context);return;
   }
   if(req.url.startsWith('/modules/')){if(!browserStaticRoot)return respond(res,503,{error:'手机模块页面尚未构建'});const bytes=await body(req,48*1024*1024,true);if(rejectUnavailable(res,entry))return;const result=await entry.moduleProxy.handle({url:req.url,method:req.method,headers:req.headers,bytes});res.setHeader('x-frame-options','SAMEORIGIN');res.writeHead(result.status,{...result.headers,'cache-control':'no-store'});return res.end(result.bytes);}
   const intentPath=/^\/api\/browser-print-intents\/([a-f0-9-]{36})$/.exec(req.url),panel=/^\/browser-central-print\?intent=([a-f0-9-]{36})$/.exec(req.url);
   if((intentPath||panel)&&req.method==='GET'){const key=(intentPath||panel)[1],intent=entry.printIntents.get(key),auth=entry.session.auth.status();if(!intent||!auth.authenticated||auth.user?.id!==intent.actorId||clock()-intent.created>30*60*1000)return respond(res,404,{error:'打印面板来源不存在或已过期'});if(panel){res.setHeader('x-frame-options','SAMEORIGIN');return serveBrowser(res,'central.html');}return respond(res,200,{source:intent.source,module:intent.module});}
   if(!['GET','POST','PATCH','PUT','DELETE'].includes(req.method))return respond(res,405,{error:'不支持此方法'});
   if(req.method!=='GET'&&(req.headers.origin!==origin||req.headers['x-xjy-csrf']!==entry.csrf||req.headers['content-type']!=='application/json'))return respond(res,403,{error:'请求来源或防伪令牌无效'});
   if(req.url==='/auth/setup')return respond(res,403,{error:'浏览器不可初始化主机账号'});
   if(!req.url.startsWith('/auth/')&&!entry.session.auth.status().authenticated)return respond(res,401,{error:'请先登录测试员工账号'});
   if(require('../project/desktop/erp-policy.cjs').isErpPath(req.url)){
    const input={path:req.url,method:req.method,...(req.method==='GET'?{}:{body:await body(req,req.url==='/erp/api/attachments'?3*1024*1024:2*1024*1024)})};
    if(rejectUnavailable(res,entry))return;
    const result=await require('./erp-web-adapter.cjs').createErpAdapter(entry.session)(input);
    res.writeHead(result.status,{...result.headers,'cache-control':'no-store'});return res.end(result.bytes);
   }
   if(req.url.startsWith('/native/')){
    if(req.method!=='GET')return respond(res,405,{error:'设计检测预览只允许读取，不接受保存或打印'});
    let preview;try{preview=require('./native-preview.cjs').parsePreview(req.url);}catch{return respond(res,400,{error:'设计预览地址不在允许范围'});}
    const result=await entry.session.dispatch({path:'/api/internal-modules/proxy',method:'POST',body:{module:preview.module,path:preview.path,method:'GET'}});
    if(!result.ok)return respond(res,result.status,result.data);
    const value=result.data,type=String(value.headers['content-type']||'application/octet-stream'),nonce=crypto.randomBytes(18).toString('base64');let bytes=Buffer.from(value.bodyBase64,'base64');
    if(type.includes('text/html')){bytes=Buffer.from(require('./native-preview.cjs').rewriteHtml(bytes.toString(),preview.module,nonce));res.setHeader('content-security-policy',"default-src 'self'; script-src 'self' 'nonce-"+nonce+"'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");}
    else if(type.includes('javascript'))bytes=Buffer.from(require('./native-preview.cjs').rewriteScript(bytes.toString(),preview.module));
    if(value.headers.location)res.setHeader('location','/native/'+preview.module+value.headers.location);
    res.writeHead(value.status,{'content-type':type,'cache-control':'no-store'});return res.end(bytes);
   }
   const input={path:req.url,method:req.method,...(req.method==='GET'?{}:{body:await body(req,req.url.startsWith('/auth/')?8192:/^\/api\/employee-profiles\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/avatar$/.test(req.url)&&req.method==='POST'?3*1024*1024:browserStaticRoot&&/^\/api\/(quotes|media|settings)(\/|$)/.test(req.url)?32*1024*1024:2*1024*1024)})};
   if(rejectUnavailable(res,entry))return;
   if(req.url==='/auth/login')return await login(entry,input,req,res);
   if(req.url==='/auth/logout'){
    // The captured immutable entry owns only its own backend session. Do not
    // clear a cookie header: a delayed response could erase a newer login.
    await closeEntry(entry);return respond(res,200,anonymousStatus());
   }
   if(req.url.startsWith('/api/local/')){if(!localControls)return respond(res,403,{error:'手机网页不能维护主机备份与本机配置'});const actor=entry.session.auth.status().user;if(actor?.role!=='admin')return respond(res,403,{error:'只有隔离测试管理员可进行备份恢复'});if(!controls)return respond(res,503,{error:'本地维护入口尚未就绪'});const result=controls(actor,input);return respond(res,result.status,result.data);}
   if(/^\/api\/images\/([a-f0-9-]{36})$/.test(req.url)&&req.method==='GET'){const result=await entry.session.imageResponse(req.url.split('/').pop());res.writeHead(result.status,{...Object.fromEntries(result.headers),'cache-control':'no-store'});return res.end(Buffer.from(await result.arrayBuffer()));}
   if(rejectUnavailable(res,entry))return;const result=await entry.session.dispatch(input);
   respond(res,result.status,result.data);
  }catch(e){reportError(res,e);}finally{if(usedEntry){usedEntry.busy--;usedEntry.touched=clock();}}
 }
 function tracked(req,res){let end;const flight=new Promise(resolve=>{end=resolve;});pending.add(flight);handler(req,res).catch(error=>reportError(res,error)).finally(()=>{pending.delete(flight);end();});}
 server.on('request',tracked);server.requestTimeout=30000;server.headersTimeout=15000;server.keepAliveTimeout=5000;server.maxHeadersCount=50;
 return{setControls(value){controls=value;},stopAccepting(){accepting=false;},async withFrozen(action){if(paused)throw new Error('Another exclusive operation is active');paused=true;try{await Promise.allSettled([...pending]);if(cleanupFailed)throw new Error(cleanupMessage);return await action();}finally{paused=false;}},async replaceBackend(next){if(replacing)throw new Error('Another backend replacement is active');replacing=true;generation++;try{await closeAll();sessions.clear();backend=next;}finally{replacing=false;}},async close(){accepting=false;generation++;server.off('request',tracked);await Promise.allSettled([...pending]);await closeAll();sessions.clear();}};
}
module.exports={createGateway};

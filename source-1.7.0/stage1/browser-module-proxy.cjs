'use strict';
const crypto=require('node:crypto');
const {appInfoFromVersion}=require('../project/desktop/app-info.cjs');
const {normalizePrintSource}=require('../project/desktop/print-sources.cjs');
const {normalizeModulePrintLocation}=require('../project/desktop/module-print-source.cjs');
const {authorizeModuleRequest}=require('../project/desktop/module-workspace-policy.cjs');
const LIMIT=48*1024*1024,RESPONSE_LIMIT=64*1024*1024,CSRF=/^[a-f0-9]{64}$/;
function fail(status,message){const e=new Error(message);e.status=status;throw e;}
function relative(value){
 if(typeof value!=='string'||value.length>8192||!value.startsWith('/')||value.startsWith('//')||/[\\#\x00-\x20\x7f]/.test(value))fail(400,'模块地址必须为同源规范地址');
 const pathname=value.split('?')[0],url=new URL(value,'http://module.invalid');
 if(url.origin!=='http://module.invalid'||url.pathname!==pathname||pathname.includes('%')||pathname.includes('//')||pathname.split('/').some(x=>x==='.'||x==='..'))fail(400,'模块地址不能跳出当前模块');return value;
}
function parseModuleUrl(value){relative(value);const match=/^\/modules\/(ledger|inventory|cashier)(\/.*)$/.exec(value);if(!match)fail(400,'模块入口不存在');return{module:match[1],path:relative(match[2])};}
function tokenEqual(actual,expected){return typeof actual==='string'&&CSRF.test(actual)&&CSRF.test(expected)&&crypto.timingSafeEqual(Buffer.from(actual),Buffer.from(expected));}
function strippedForm(type,bytes){
 if(type.startsWith('application/x-www-form-urlencoded')){const values=new URLSearchParams(bytes.toString('utf8')),tokens=values.getAll('_xjy_csrf');if(tokens.length>1)fail(403,'防伪令牌重复');values.delete('_xjy_csrf');return{token:tokens[0],bytes:Buffer.from(values.toString())};}
 if(type.startsWith('multipart/form-data')){
  const match=/(?:^|;)\s*boundary=(?:"([A-Za-z0-9'()+_,./:=?-]{1,70})"|([A-Za-z0-9'()+_,./:=?-]{1,70}))(?:;|$)/.exec(type);if(!match)fail(400,'上传边界无效');
  const boundary=Buffer.from('--'+(match[1]||match[2])),parts=[];let cursor=0,token;
  while(cursor<bytes.length){if(!bytes.subarray(cursor,cursor+boundary.length).equals(boundary))fail(400,'上传正文边界不一致');const start=cursor;cursor+=boundary.length;
   if(bytes.subarray(cursor,cursor+2).toString()==='--'){parts.push(bytes.subarray(start));cursor=bytes.length;break;}
   if(bytes.subarray(cursor,cursor+2).toString()!=='\r\n')fail(400,'上传正文无效');cursor+=2;const headerEnd=bytes.indexOf('\r\n\r\n',cursor);if(headerEnd<0||headerEnd-cursor>8192)fail(400,'上传字段头无效');
   const header=bytes.subarray(cursor,headerEnd).toString('utf8'),next=bytes.indexOf(Buffer.concat([Buffer.from('\r\n'),boundary]),headerEnd+4);if(next<0)fail(400,'上传字段未结束');
   const isToken=/^content-disposition:\s*form-data;\s*name="_xjy_csrf"\s*$/im.test(header);
   if(isToken){if(token!==undefined)fail(403,'防伪令牌重复');token=bytes.subarray(headerEnd+4,next).toString('utf8');}else parts.push(bytes.subarray(start,next+2));cursor=next+2;
  }
  return{token,bytes:Buffer.concat(parts)};
 }
 return{token:undefined,bytes};
}
function moduleBrowserRuntime(config){
 const prefix='/modules/'+config.module,origin=location.origin,nativeFetch=window.fetch.bind(window);
 function scoped(value){const raw=typeof value==='string'?value:value.url,url=new URL(raw,location.href);if(url.origin!==origin||url.username||url.password)throw Error('只能访问当前模块');if(url.pathname==='/session')return url.href;if(url.pathname===prefix||url.pathname.startsWith(prefix+'/'))return url.href;if(url.pathname.startsWith('/modules/'))throw Error('不能跳到其他模块');return origin+prefix+url.pathname+url.search;}
 window.fetch=(input,init={})=>{const method=String(init.method||(typeof input==='object'?input.method:'GET')||'GET').toUpperCase(),headers=new Headers(init.headers||(typeof input==='object'?input.headers:undefined));if(!['GET','HEAD'].includes(method))headers.set('x-xjy-csrf',config.csrf);return nativeFetch(scoped(input),{...init,method,headers,credentials:'same-origin',cache:'no-store',redirect:'error'});};
 const nativeOpen=XMLHttpRequest.prototype.open,nativeSend=XMLHttpRequest.prototype.send;
 XMLHttpRequest.prototype.open=function(method,url,...args){this._xjyWrite=!['GET','HEAD'].includes(String(method).toUpperCase());return nativeOpen.call(this,method,scoped(String(url)),...args);};
 XMLHttpRequest.prototype.send=function(body){if(this._xjyWrite)this.setRequestHeader('x-xjy-csrf',config.csrf);return nativeSend.call(this,body);};
 window.xjyModuleNavigate=value=>location.assign(scoped(value));
 const nativeWindowOpen=window.open.bind(window);window.open=(url,target,features)=>nativeWindowOpen(scoped(String(url)),target,features);
 document.addEventListener('click',event=>{const anchor=event.target?.closest?.('a[href]');if(!anchor)return;try{const destination=new URL(anchor.getAttribute('href'),location.href);if(destination.origin!==origin||!['http:','https:','blob:'].includes(destination.protocol))event.preventDefault();}catch{event.preventDefault();}},true);
 window.addEventListener('pagehide',()=>{document.documentElement.style.visibility='hidden';});window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();else document.documentElement.style.visibility='';});
 window.xjyModuleWorkspace=Object.freeze({request:async input=>{const response=await nativeFetch(prefix+'/_workspace',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{'content-type':'application/json','x-xjy-csrf':config.csrf},body:JSON.stringify(input)});return response.json();}});
 window.xjyModulePrint=Object.freeze({print:async source=>{
  if(!source)source=config.source;if(!source)return{ok:false,error:'请使用有明确单据编号或报表筛选的“提交主机打印”按钮，不能猜测当前财务单据。'};
  const response=await nativeFetch(prefix+'/_central-print',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{'content-type':'application/json','x-xjy-csrf':config.csrf},body:JSON.stringify({source})});const result=await response.json();if(!response.ok)return{ok:false,error:result.error||'主机打印入口未能打开'};
  const frame=document.createElement('iframe');frame.src='/browser-central-print?intent='+encodeURIComponent(result.intent);frame.title='提交主机统一打印';frame.setAttribute('style','position:fixed;inset:0;width:100%;height:100%;border:0;background:transparent;z-index:2147483647');document.body.append(frame);
  const close=event=>{if(event.origin===origin&&event.source===frame.contentWindow&&event.data?.type==='xjy-central-print-close'){frame.remove();window.removeEventListener('message',close);}};window.addEventListener('message',close);return{ok:true,message:'请在统一打印面板核对并提交'};
 }});
 window.print=()=>{void window.xjyModulePrint.print().then(result=>{if(!result.ok)window.alert(result.error);}).catch(()=>window.alert('主机打印入口暂不可用，请重试。'));};
 document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='p'){event.preventDefault();window.print();}},true);
 function prepare(){for(const form of document.forms){if(String(form.method).toLowerCase()==='get')continue;if(!form.querySelector('input[name="_xjy_csrf"]')){const field=document.createElement('input');field.type='hidden';field.name='_xjy_csrf';field.value=config.csrf;form.append(field);}}}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',prepare,{once:true});else prepare();
 document.addEventListener('submit',prepare,true);
 let lastActivity=Date.now(),heartbeatBusy=false;for(const name of ['pointerdown','keydown','scroll','touchstart'])window.addEventListener(name,()=>{lastActivity=Date.now();},{capture:true,passive:true});
 const heartbeat=async()=>{if(heartbeatBusy)return;heartbeatBusy=true;try{const status=await(await nativeFetch('/session',{credentials:'same-origin',cache:'no-store',redirect:'error'})).json(),user=status.user;const access=user?.role==='admin'?'manage':user?.moduleAccess?.[config.module];if(!status.authenticated||user?.id!==config.actorId||!['view','operate','manage'].includes(access)||Number(user.grantRevision||0)!==config.grantRevision){document.body.replaceChildren();location.assign('/home');return;}await nativeFetch('/api/presence/heartbeat',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{'content-type':'application/json','x-xjy-csrf':config.csrf},body:JSON.stringify({module:config.module,active:!document.hidden&&document.hasFocus()&&Date.now()-lastActivity<300000})});}catch{}finally{heartbeatBusy=false;}};const heartbeatTimer=setInterval(()=>void heartbeat(),30000);window.addEventListener('pagehide',()=>clearInterval(heartbeatTimer),{once:true});
}
function rewriteScript(text,module){
 const prefix='/modules/'+module;
 return text.replace(/((?:window\.)?location\.href\s*=\s*)(['"])(\/(?!\/)[^'"\r\n]*)\2/g,(_all,left,quote,path)=>left+quote+prefix+path+quote)
 .replace(/((?:window\.)?location\.(?:assign|replace)\(\s*)(['"])(\/(?!\/)[^'"\r\n]*)\2/g,(_all,left,quote,path)=>left+quote+prefix+path+quote);
}
function rewriteHtml(text,module,csrf,source,nonce,actorId='',grantRevision=0,appVersion){
 const prefix='/modules/'+module;
 let html=text.replace(/\b(href|src|action)=(['"])(\/(?!\/)[^'"]*)\2/gi,(_all,name,quote,value)=>name+'='+quote+prefix+value+quote);
 for(const match of html.matchAll(/<script\b([^>]*)>/gi)){const src=/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(match[1]);if(!src)continue;const value=src[1]??src[2]??src[3];if(!value||/[&\\\x00-\x20]/.test(value))fail(502,'模块脚本地址含不允许的编码');const resolved=new URL(value,'http://module.invalid'+prefix+'/');if(resolved.origin!=='http://module.invalid'||!resolved.pathname.startsWith(prefix+'/')||resolved.username||resolved.password)fail(502,'模块脚本只能读取同源模块程序');}
 html=rewriteScript(html,module).replace(/<script\b(?![^>]*\bnonce=)([^>]*)>/gi,'<script nonce="'+nonce+'"$1>');
 const runtime='<script nonce="'+nonce+'">('+moduleBrowserRuntime.toString()+')('+JSON.stringify({module,csrf,source,actorId,grantRevision}).replace(/</g,'\\u003c')+');</script>';
 if(/<head[^>]*>/i.test(html))html=html.replace(/<head[^>]*>/i,match=>match+runtime);else html=runtime+html;
 let info;try{info=appInfoFromVersion(appVersion);}catch{return html;}
 // Strict numeric semver is the only interpolated value; module HTML cannot set it.
 const footer='<style data-xjy-app-version-style>@media screen{body{padding-bottom:calc(24px + env(safe-area-inset-bottom,0px))!important}.app-version-footer{position:fixed;inset:auto 0 0;z-index:90;box-sizing:border-box;height:calc(24px + env(safe-area-inset-bottom,0px));padding:0 calc(14px + env(safe-area-inset-right,0px)) env(safe-area-inset-bottom,0px) 14px;display:flex;align-items:center;justify-content:flex-end;border-top:1px solid #e8e5de;background:#faf9f6;color:#777164;font:10px/1.2 system-ui,"Microsoft YaHei",sans-serif;pointer-events:none}}@media print{.app-version-footer{display:none!important}}</style><footer class="app-version-footer" aria-label="软件总版本" data-xjy-app-version="'+info.appVersion+'"><span>主机总版本 v'+info.appVersion+'</span></footer>';
 return /<\/body\s*>/i.test(html)?html.replace(/<\/body\s*>/i,footer+'$&'):html+footer;
}
function inlineHandlerHashes(html){const values=new Set();for(const match of html.matchAll(/\bon[a-z]+=(['"])([\s\S]*?)\1/gi)){const code=match[2].replace(/&quot;/g,'"').replace(/&#(?:39|x27);/gi,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');values.add("'sha256-"+crypto.createHash('sha256').update(code).digest('base64')+"'");if(values.size>256)fail(502,'模块事件脚本过多，请缩小页面范围');}return[...values].join(' ');}
function createBrowserModuleProxy({session,origin,getCsrf,registerPrintIntent,appVersion}){
 if(!session?.auth?.status||typeof session.dispatch!=='function'||typeof getCsrf!=='function'||new URL(origin).origin!==origin)throw Error('独立浏览器模块会话配置不正确');
 const jars=new Map();let userId='';
 function actor(module){const auth=session.auth.status(),user=auth.user;if(!auth.authenticated||!user?.id||user.active===false)fail(401,'请先登录员工工作室');if(user.role!=='admin'&&(!['view','operate','manage'].includes(user.moduleAccess?.[module])))fail(403,'管理员尚未授权当前模块');if(userId!==user.id){jars.clear();userId=user.id;}return user.id;}
 async function handle({url,method='GET',headers={},bytes=Buffer.alloc(0)}){
  const route=parseModuleUrl(url),id=actor(route.module),token=getCsrf();
  if(!CSRF.test(token)||!['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'].includes(method)||!Buffer.isBuffer(bytes)||bytes.length>LIMIT||['GET','HEAD'].includes(method)&&bytes.length)fail(400,'模块请求方法或正文无效');
  let forwarded=bytes;const type=String(headers['content-type']||'');
  if(!['GET','HEAD'].includes(method)){if(headers.origin!==origin)fail(403,'模块写入来源无效');const stripped=strippedForm(type,bytes);if(!tokenEqual(headers['x-xjy-csrf']||stripped.token,token))fail(403,'模块写入防伪令牌无效');if(stripped.token!==undefined&&!tokenEqual(stripped.token,token))fail(403,'表单防伪令牌无效');forwarded=stripped.bytes;}
  if(route.path==='/_central-print'){
   if(route.module==='cashier')fail(403,'出纳单据请先使用已授权的报表导出，不能借用其他模块打印来源');
   if(method!=='POST'||type!=='application/json'||typeof registerPrintIntent!=='function')fail(405,'此打印入口仅接受类型化请求');let input;try{input=JSON.parse(forwarded);}catch{fail(400,'打印参数JSON无效');}
   if(!input||Object.keys(input).some(key=>key!=='source'))fail(400,'打印参数无效');const source=normalizePrintSource(input.source);
   if(route.module==='ledger'?!['ledger-report-a4','erp-document-a4','erp-report-a4'].includes(source.type):!source.type.startsWith('inventory-'))fail(403,'打印来源不属于当前模块');
   const intent=await registerPrintIntent(source,route.module);actor(route.module);return{status:200,headers:{'content-type':'application/json','cache-control':'no-store'},bytes:Buffer.from(JSON.stringify({ok:true,intent}))};
  }
  if(route.path==='/_workspace'){
   if(method!=='POST'||type!=='application/json')fail(405,'协作入口仅接受JSON请求');let input;try{input=JSON.parse(forwarded);}catch{fail(400,'协作JSON无效');}const request=authorizeModuleRequest(route.module,input),result=await session.dispatch(request);if(actor(route.module)!==id)fail(401,'员工账号已改变');return{status:result.status,headers:{'content-type':'application/json','cache-control':'no-store'},bytes:Buffer.from(JSON.stringify(result))};
  }
  if(route.path.startsWith('/_xjy/')||route.path.startsWith('/xjy/collaboration/source'))fail(403,'内部维护接口不能通过网页访问');
  const safeHeaders={};for(const key of ['content-type','accept','accept-language','x-csrf-token','x-requested-with'])if(typeof headers[key]==='string'&&!/[\r\n\x00]/.test(headers[key]))safeHeaders[key]=headers[key];
  const jar=jars.get(route.module)||new Map();jars.set(route.module,jar);if(jar.size)safeHeaders.cookie=[...jar].map(([name,value])=>name+'='+value).join('; ');
  const result=await session.dispatch({path:'/api/internal-modules/proxy',method:'POST',body:{module:route.module,path:route.path,method,headers:safeHeaders,bodyBase64:forwarded.toString('base64')}});
  if(actor(route.module)!==id)fail(401,'员工账号已改变');if(!result.ok)return{status:result.status,headers:{'content-type':'application/json','cache-control':'no-store'},bytes:Buffer.from(JSON.stringify(result.data))};
  const value=result.data;if(!value||!Number.isInteger(value.status)||typeof value.bodyBase64!=='string'||value.bodyBase64.length>RESPONSE_LIMIT*4/3+4||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.bodyBase64))fail(502,'模块返回内容无效');
  const out={'cache-control':'no-store','x-content-type-options':'nosniff'};for(const key of ['content-type','content-disposition'])if(typeof value.headers?.[key]==='string'&&!/[\r\n\x00]/.test(value.headers[key]))out[key]=value.headers[key];
  for(const cookie of [].concat(value.headers?.['set-cookie']||[])){if(typeof cookie!=='string'||cookie.length>8192||/[\r\n\x00]/.test(cookie))fail(502,'模块Cookie无效');const first=/^([A-Za-z0-9_-]{1,80})=([^;]*)/.exec(cookie);if(first){if(/(?:^|;)\s*max-age=0(?:;|$)/i.test(cookie))jar.delete(first[1]);else jar.set(first[1],first[2]);if(jar.size>64)fail(502,'模块Cookie数量超限');}}
  if(value.headers?.location){const destination=relative(value.headers.location);if(destination.startsWith('/modules/')||destination.startsWith('/api/local/'))fail(502,'模块重定向不能跳出当前模块');out.location='/modules/'+route.module+destination;}
  let body=Buffer.from(value.bodyBase64,'base64');const content=String(out['content-type']||'application/octet-stream');
  if(content.includes('text/html')){const nonce=crypto.randomBytes(18).toString('base64');body=Buffer.from(rewriteHtml(body.toString('utf8'),route.module,token,normalizeModulePrintLocation(route.module,route.path),nonce,id,Number(session.auth.status().user?.grantRevision||0),value.status>=200&&value.status<300?appVersion:undefined));out['content-security-policy']="default-src 'self'; script-src 'self' 'nonce-"+nonce+"'; script-src-elem 'self' 'nonce-"+nonce+"'; script-src-attr 'unsafe-hashes' "+inlineHandlerHashes(body.toString('utf8'))+"; object-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'";}
  else if(content.includes('javascript'))body=Buffer.from(rewriteScript(body.toString('utf8'),route.module));
  return{status:value.status,headers:out,bytes:method==='HEAD'?Buffer.alloc(0):body};
 }
 return{handle,clear(){jars.clear();userId='';}};
}
module.exports={createBrowserModuleProxy,parseModuleUrl,strippedForm,rewriteHtml,rewriteScript,moduleBrowserRuntime,inlineHandlerHashes};

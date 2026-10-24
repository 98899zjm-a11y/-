'use strict';
const fs=require('node:fs/promises');
const {constants:FS_CONSTANTS}=require('node:fs');
const path=require('node:path');
const {validateMaterialsOutput,invokeMaterialsFinalizer}=require('./lan.cjs');
const READ_FINALIZE=Symbol.for('xjy.materials.finalizeRead');

const MAX_UPLOAD=20*1024*1024,MAX_PATCH=64*1024,MAX_RESPONSE=24*1024*1024,MAX_STATIC=8*1024*1024;
const SAFE_HEADERS=new Set(['content-type','cache-control','x-content-type-options','x-frame-options','referrer-policy','cross-origin-resource-policy','content-security-policy','content-length']);
const REQUEST_HEADERS=['content-type','x-xjy-csrf','x-csrf-token'];
const CSP=`default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'self'`;
const STATIC_FILES=new Map([['/materials','index.html'],['/materials/','index.html'],['/materials/app.js','app.js'],['/materials/styles.css','styles.css']]);
const MIME=new Map([['index.html','text/html; charset=utf-8'],['app.js','text/javascript; charset=utf-8'],['styles.css','text/css; charset=utf-8']]);
const NOFOLLOW=process.platform==='win32'?0:(FS_CONSTANTS.O_NOFOLLOW||0);
const ABORT=Symbol('abort');

function errorResponse(status,message){
 const body=Buffer.from(JSON.stringify({error:message}),'utf8');
 return new Response(body,{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','content-length':String(body.length)}});
}
function staticResponse(file,body){
 return new Response(body,{status:200,headers:{'content-type':MIME.get(file),'cache-control':'no-store','x-content-type-options':'nosniff','x-frame-options':'SAMEORIGIN','referrer-policy':'no-referrer','cross-origin-resource-policy':'same-origin','content-security-policy':CSP,'content-length':String(body.length)}});
}
function checkEnvelope(value,read=true){
 try{
  let input=value;
  if(!read&&value&&typeof value==='object'){
   const descriptors=Object.getOwnPropertyDescriptors(value);delete descriptors[READ_FINALIZE];
   input=Object.create(Object.getPrototypeOf(value));Object.defineProperties(input,descriptors);
  }
  const safe=validateMaterialsOutput(input,read?{trustedFinalizer:true}:undefined);
  return{status:safe.status,headers:safe.headers,body:Buffer.from(safe.bodyBase64,'base64'),finalizeRead:read?safe[READ_FINALIZE]??null:null,finalizerSource:safe};
 }catch{return null;}
}
function responseFromChecked(checked,read=true){
 try{if(read&&checked.finalizeRead)invokeMaterialsFinalizer(checked.finalizerSource);}catch(error){return errorResponse([401,403].includes(error?.status)?error.status:503,'当前素材会话或权限已变化');}
 const headers=new Headers();
 for(const name of Object.keys(checked.headers))headers.set(name,checked.headers[name]);
 headers.set('cache-control','no-store');
 headers.set('x-content-type-options','nosniff');
 let body=checked.body;
 if(checked.status===204||checked.status===205||checked.status===304||body.length===0)body=null;
 return new Response(body,{status:checked.status,headers});
}
function envelopeResponse(value,read=true){
 const checked=checkEnvelope(value,read);
 return checked?responseFromChecked(checked,read):null;
}
function readRequestHeaders(request){
 const headers={};
 for(const name of REQUEST_HEADERS){
  const item=request.headers.get(name);
  if(item===null)continue;
  if(item.length>4096||/[\x00-\x1f\x7f]/.test(item))return null;
  headers[name]=item;
 }
 return headers;
}
function rawPathOf(value){
 let text=value;
 const hash=text.indexOf('#');if(hash>=0)text=text.slice(0,hash);
 const query=text.indexOf('?');if(query>=0)text=text.slice(0,query);
 const scheme=text.indexOf('://');if(scheme<0)return '';
 const slash=text.indexOf('/',scheme+3);
 return slash<0?'/':text.slice(slash);
}
function unsafeRawPath(raw){
 if(raw.length>4096)return true;
 if(/[\x00-\x1f\x7f\\]/.test(raw))return true;
 if(raw.includes('%'))return true;
 if(/(?:^|\/)\.{1,2}(?:\/|$)/.test(raw))return true;
 if(raw.includes('//'))return true;
 return false;
}
function matchRoute(pathname){
 if(pathname==='/materials/staff-auth/status')return {kind:'read',methods:['GET'],query:false};
 if(pathname==='/materials/api/bootstrap')return {kind:'read',methods:['GET'],query:false};
 if(pathname==='/materials/api/search')return {kind:'read',methods:['GET'],query:true};
 if(pathname==='/materials/api/assets')return {kind:'assets',methods:['GET','POST'],query:true};
 const asset=/^\/materials\/api\/assets\/([A-Za-z0-9_-]{1,100})(\/image|\/retry)?$/.exec(pathname);
 if(asset){
  if(asset[2]==='/image')return {kind:'image',methods:['GET'],query:false};
  if(asset[2]==='/retry')return {kind:'retry',methods:['POST'],query:false};
  return {kind:'patch',methods:['PATCH'],query:false};
 }
 if(pathname.startsWith('/materials/api/assets/'))return {invalid:true};
 return null;
}
async function readBounded(request,limit,stale){
 if(request.signal?.aborted)return {error:'abort'};
 if(!request.body)return {body:Buffer.alloc(0)};
 let reader;
 try{reader=request.body.getReader();}catch{return {error:'read'};}
 let total=0;
 const parts=[];
 let onAbort=null;
 let abortPromise=null;
 if(request.signal){
  abortPromise=new Promise((resolve,reject)=>{onAbort=()=>reject(ABORT);request.signal.addEventListener('abort',onAbort,{once:true});});
  abortPromise.catch(()=>{});
 }
 const cancel=async()=>{try{await reader.cancel();}catch{}};
 try{
  while(true){
   if(request.signal?.aborted){await cancel();return {error:'abort'};}
   if(stale()){await cancel();return {error:'epoch'};}
   let result;
   if(abortPromise){
    try{result=await Promise.race([reader.read(),abortPromise]);}
    catch(error){await cancel();return {error:error===ABORT||request.signal?.aborted?'abort':'read'};}
   }else result=await reader.read();
   if(result.done)break;
   const value=result.value;
   if(!value||typeof value.byteLength!=='number'){await cancel();return {error:'read'};}
   total+=value.byteLength;
   if(total>limit){await cancel();return {error:'tooLarge'};}
   parts.push(Buffer.from(value));
  }
  if(stale()){await cancel();return {error:'epoch'};}
  return {body:Buffer.concat(parts,total)};
 }catch{await cancel();return {error:'read'};}
 finally{
  if(onAbort)request.signal.removeEventListener('abort',onAbort);
  try{reader.releaseLock();}catch{}
 }
}
function inside(root,target){
 const rel=path.relative(root,target);
 return rel!==''&&rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel);
}
async function readStaticFile(root,file){
 try{
  const rootReal=await fs.realpath(root);
  const rootInfo=await fs.lstat(root);
  if(!rootInfo.isDirectory()||rootInfo.isSymbolicLink()||rootReal.toLowerCase()!==path.resolve(root).toLowerCase())return null;
  const candidate=path.join(rootReal,file);
  const info=await fs.lstat(candidate);
  if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size>MAX_STATIC)return null;
  const canonical=await fs.realpath(candidate);
  if(!inside(rootReal,canonical))return null;
  const handle=await fs.open(candidate,FS_CONSTANTS.O_RDONLY|NOFOLLOW);
  try{
   const stat=await handle.stat();
   if(!stat.isFile()||stat.nlink!==1||stat.size>MAX_STATIC||stat.dev!==info.dev||stat.ino!==info.ino)return null;
   const opened=await fs.realpath(candidate);
   if(!inside(rootReal,opened))return null;
   const body=await handle.readFile();
   const after=await handle.stat(),current=await fs.lstat(candidate);
   if(body.length>MAX_STATIC||body.length!==after.size||after.dev!==stat.dev||after.ino!==stat.ino||after.mtimeMs!==stat.mtimeMs||current.isSymbolicLink()||!current.isFile()||current.nlink!==1||current.dev!==stat.dev||current.ino!==stat.ino)return null;
   return body;
  }finally{await handle.close().catch(()=>{});}
 }catch{return null;}
}
function discardBody(request){
 try{
  if(request.body&&typeof request.body.cancel==='function'){
   const pending=request.body.cancel();
   if(pending&&typeof pending.catch==='function')pending.catch(()=>{});
  }
 }catch{}
}
function createMaterialNativeProtocol({network,assetsRoot,getGeneration}={}){
 if(typeof network?.materialsRequest!=='function')throw new TypeError('Materials network bridge required');
 if(typeof assetsRoot!=='string'||!assetsRoot)throw new TypeError('Materials assets root required');
 if(typeof getGeneration!=='function')throw new TypeError('Session generation callback required');
 const root=path.resolve(assetsRoot);
 const stale=captured=>{try{return getGeneration()!==captured;}catch{return true;}};
 async function checkSession(version){
  let envelope;
  try{envelope=await network.materialsRequest({path:'/materials/staff-auth/status',method:'GET',headers:{}});}catch{return errorResponse(503,'素材服务暂不可用');}
  if(stale(version))return errorResponse(401,'会话已变更');
  const checked=checkEnvelope(envelope);
  if(!checked)return errorResponse(502,'素材响应无效');
  if(checked.status!==200)return responseFromChecked(checked);
  let data;try{data=JSON.parse(checked.body.toString('utf8'));}catch{return errorResponse(401,'会话已变更');}
  if(!data||data.authenticated!==true||typeof data.authCsrfToken!=='string'||!/^[a-f0-9]{64}$/.test(data.authCsrfToken))return errorResponse(401,'会话已变更');
  return {finalizeRead:checked.finalizeRead,finalizerSource:checked.finalizerSource};
 }
 return async function handle(request){
  let version;
  try{version=getGeneration();}catch{return errorResponse(503,'素材会话不可用');}
  try{
   let url;
   try{url=new URL(request.url);}catch{return errorResponse(400,'请求地址无效');}
   try{
    const initiator=request.initiatorOrigin;
    if(initiator!==undefined&&initiator!=='jewelry://app')return errorResponse(403,'来源不允许');
   }catch{return errorResponse(403,'来源不允许');}
   if(url.protocol!=='jewelry:')return errorResponse(403,'来源不允许');
   if(url.hostname!=='app'||url.port||url.username||url.password)return errorResponse(403,'来源不允许');
   const raw=rawPathOf(request.url);
   if(/[\x00-\x1f\x7f\\]/.test(raw))return errorResponse(400,'请求路径无效');
   const rawMaterials=raw==='/materials'||raw.startsWith('/materials/')||/^\/materials%/i.test(raw);
   const normalizedMaterials=url.pathname==='/materials'||url.pathname.startsWith('/materials/');
   if(raw.startsWith('//'))return errorResponse(400,'请求路径无效');
   if(!rawMaterials&&!normalizedMaterials)return null;
   if(unsafeRawPath(raw)||url.hash)return errorResponse(400,'请求路径无效');
   const fullPath=url.pathname+url.search;
   if(fullPath.length>4096||/[\x00-\x1f\x7f\\#]/.test(fullPath))return errorResponse(400,'请求路径无效');
   if(/%(?![0-9a-fA-F]{2})/.test(fullPath))return errorResponse(400,'请求路径无效');
   const file=STATIC_FILES.get(url.pathname);
   if(file){
    if(url.search)return errorResponse(400,'请求参数无效');
    if(request.method!=='GET')return errorResponse(405,'不支持此操作');
    if(request.signal?.aborted)return errorResponse(400,'请求已中断');
    const auth=await checkSession(version);
    if(auth instanceof Response)return auth;
    if(request.signal?.aborted)return errorResponse(400,'请求已中断');
    if(stale(version))return errorResponse(401,'会话已变更');
    const body=await readStaticFile(root,file);
    if(!body)return errorResponse(404,'未找到素材页面');
    if(stale(version))return errorResponse(401,'会话已变更');
    if(request.signal?.aborted)return errorResponse(400,'请求已中断');
    try{if(auth.finalizeRead)invokeMaterialsFinalizer(auth.finalizerSource);}catch(error){return errorResponse([401,403].includes(error?.status)?error.status:503,'当前素材会话或权限已变化');}
    return staticResponse(file,body);
   }
   const route=matchRoute(url.pathname);
   if(!route)return errorResponse(404,'未找到此素材入口');
   if(route.invalid)return errorResponse(400,'请求路径无效');
   if(!route.methods.includes(request.method))return errorResponse(405,'不支持此操作');
   if(url.search&&!route.query)return errorResponse(400,'请求参数无效');
   const headers=readRequestHeaders(request);
   if(!headers)return errorResponse(400,'请求头无效');
   const bodyLimit=route.kind==='assets'&&request.method==='POST'?MAX_UPLOAD:route.kind==='patch'?MAX_PATCH:0;
   let body=Buffer.alloc(0);
   if(bodyLimit>0){
    const lengthHeader=request.headers.get('content-length');
    if(lengthHeader!==null){
     if(!/^\d+$/.test(lengthHeader))return errorResponse(400,'请求体无效');
     if(Number(lengthHeader)>bodyLimit){discardBody(request);return errorResponse(413,'请求体过大');}
    }
    const read=await readBounded(request,bodyLimit,()=>stale(version));
    if(read.error==='epoch')return errorResponse(401,'会话已变更');
    if(read.error==='abort')return errorResponse(400,'请求已中断');
    if(read.error==='tooLarge')return errorResponse(413,'请求体过大');
    if(read.error)return errorResponse(400,'请求体读取失败');
    body=read.body;
   }else{
    const lengthHeader=request.headers.get('content-length');
    if(lengthHeader!==null&&Number(lengthHeader)>0){discardBody(request);return errorResponse(400,'请求体不允许');}
    if(request.signal?.aborted)return errorResponse(400,'请求已中断');
    if(stale(version))return errorResponse(401,'会话已变更');
   }
   if(request.signal?.aborted)return errorResponse(400,'请求已中断');
   if(stale(version))return errorResponse(401,'会话已变更');
   const input={path:fullPath,method:request.method,headers};
   if(bodyLimit>0)input.bodyBase64=body.toString('base64');
   const write=request.method==='POST'||request.method==='PATCH';
   let envelope;
   try{envelope=await network.materialsRequest(input);}catch{return errorResponse(503,'素材服务暂不可用');}
   if(!write){
    if(request.signal?.aborted)return errorResponse(400,'请求已中断');
    if(stale(version))return errorResponse(401,'会话已变更');
   }
   return envelopeResponse(envelope,!write)||errorResponse(502,'素材响应无效');
  }catch{return errorResponse(503,'素材桥接暂不可用');}
 };
}
module.exports={createMaterialNativeProtocol};

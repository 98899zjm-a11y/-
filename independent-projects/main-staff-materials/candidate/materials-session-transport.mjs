import {Readable} from 'node:stream';
import {createRequire} from 'node:module';
import {createMountedMaterials} from './mounted-materials.mjs';
import {createLocalAuthAuthority,MaterialAuthError} from './materials/auth/lib/access-adapter.mjs';
const require=createRequire(import.meta.url),{decodeMaterialsBase64}=require('./project/desktop/lan.cjs');
const READ_FINALIZE=Symbol.for('xjy.materials.finalizeRead');

const MAX_UPLOAD=20*1024*1024,MAX_PATCH=64*1024,MAX_ENVELOPE=24*1024*1024;
const INPUT_KEYS=new Set(['path','method','headers','bodyBase64']);
const INPUT_HEADERS=new Set(['content-type','x-xjy-csrf','x-csrf-token']);
const SAFE_HEADERS=new Set(['content-type','cache-control','x-content-type-options','x-frame-options','referrer-policy','cross-origin-resource-policy','content-security-policy','content-length']);

function jsonError(status,code,message){
 const body=Buffer.from(JSON.stringify({error:message,code}),'utf8');
 return {status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','content-length':String(body.length)},bodyBase64:body.toString('base64')};
}
function isObject(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function decodeBase64(value,max){
 try{return {buffer:decodeMaterialsBase64(value,max,413,400,'素材内容编码无效','素材内容过大')};}
 catch(error){return {status:error?.status===413?413:400};}
}
function parseRoute(path,method){
 if(typeof path!=='string'||path.length===0||path.length>4096)return null;
 if(path.includes('#')||path.includes('\\')||/[\x00-\x1f\x7f]/.test(path))return null;
 const q=path.indexOf('?'),pathname=q<0?path:path.slice(0,q),query=q<0?'':path.slice(q+1);
 if(pathname.includes('%')||pathname.includes('//')||/(?:^|\/)\.{1,2}(?:\/|$)/.test(pathname))return null;
 if(pathname!=='/materials'&&!pathname.startsWith('/materials/'))return null;
 if(query.length>4096||/%(?![0-9a-fA-F]{2})/.test(query)||/[\x00-\x1f\x7f\\#]/.test(query))return null;
 let route=null;
 if(pathname==='/materials'||pathname==='/materials/')route={methods:['GET'],query:false};
 else if(pathname==='/materials/app.js'||pathname==='/materials/styles.css')route={methods:['GET'],query:false};
 else if(pathname==='/materials/staff-auth/status'||pathname==='/materials/api/bootstrap')route={methods:['GET'],query:false};
 else if(pathname==='/materials/api/search')route={methods:['GET'],query:true};
 else if(pathname==='/materials/api/assets')route={methods:['GET','POST'],query:true};
 else{
  const asset=/^\/materials\/api\/assets\/([A-Za-z0-9_-]{1,100})(\/image|\/retry)?$/.exec(pathname);
  if(!asset)return null;
  if(asset[2]==='/image')route={methods:['GET'],query:false};
  else if(asset[2]==='/retry')route={methods:['POST'],query:false};
  else route={methods:['PATCH'],query:false};
 }
 if(!route||!route.methods.includes(method))return null;
 if(q>=0&&!route.query)return null;
 return {pathname};
}
function readHeaders(value){
 if(value===undefined)return {headers:{}};
 if(!isObject(value))return null;
 const headers={};
 for(const key of Object.keys(value)){
  if(key!==key.toLowerCase()||!INPUT_HEADERS.has(key))return null;
  const item=value[key];
  if(typeof item!=='string'||item.length>4096||/[\x00-\x1f\x7f]/.test(item))return null;
  headers[key]=item;
 }
 return {headers};
}
function prepare(input,context){
 if(!isObject(input))return {error:jsonError(400,'INVALID_INPUT','素材请求格式无效')};
 for(const key of Object.keys(input))if(!INPUT_KEYS.has(key))return {error:jsonError(400,'INVALID_INPUT','素材请求包含不支持字段')};
 const method=input.method,path=input.path;
 if(typeof method!=='string'||!['GET','POST','PATCH'].includes(method))return {error:jsonError(400,'INVALID_METHOD','不支持此请求方法')};
 if(!parseRoute(path,method))return {error:jsonError(400,'INVALID_PATH','素材地址无效')};
 const headerResult=readHeaders(input.headers);
 if(!headerResult)return {error:jsonError(400,'INVALID_HEADERS','素材请求头无效')};
 const hasBody=Object.prototype.hasOwnProperty.call(input,'bodyBase64');
 if(method==='GET'&&hasBody&&input.bodyBase64!=='')return {error:jsonError(400,'INVALID_BODY','GET请求不能包含请求体')};
 let body=Buffer.alloc(0);
 if(hasBody){
  const decoded=decodeBase64(input.bodyBase64,method==='PATCH'?MAX_PATCH:MAX_UPLOAD);
  if(decoded.status)return {error:jsonError(decoded.status,decoded.status===413?'PAYLOAD_TOO_LARGE':'INVALID_BODY',decoded.status===413?'请求体超过大小限制':'请求体不是有效Base64')};
  body=decoded.buffer;
 }
 const headers=headerResult.headers,write=method==='POST'||method==='PATCH';
 if(write){
  if(headers['x-xjy-csrf']!==context.gatewayCsrf)return {error:jsonError(403,'CSRF_REJECTED','请求校验失败')};
  if(headers['x-csrf-token']!==undefined&&!/^[a-f0-9]{64}$/.test(headers['x-csrf-token']))return {error:jsonError(403,'CSRF_REJECTED','请求校验失败')};
 }
 return {path,method,headers,body};
}
function readContext(context,origin){
 try{
  if(!isObject(context)||!isObject(context.session)||!isObject(context.administration))return null;
  if(typeof context.session.auth?.status!=='function'||typeof context.administration.requireAccess!=='function'||typeof context.isLive!=='function')return null;
  if(typeof context.gatewayCsrf!=='string'||!/^[a-f0-9]{64}$/.test(context.gatewayCsrf))return null;
  return {origin,session:context.session,administration:context.administration,isLive:context.isLive,gatewayCsrf:context.gatewayCsrf};
 }catch{return null;}
}
function createCollector(){
 let status=200,headers=Object.create(null),parts=[],total=0,ended=false,invalid=false;
 const setHeader=(name,value)=>{
  if(ended||invalid)return;
  if(typeof name!=='string'){invalid=true;return;}
  const key=name.toLowerCase();
  if(!SAFE_HEADERS.has(key))return;
  if(typeof value!=='string'&&typeof value!=='number'){invalid=true;return;}
  const text=String(value);
  if(/[\r\n]/.test(text)){invalid=true;return;}
  headers[key]=text;
 };
 const writeHead=(code,values)=>{
  if(ended)return;
  if(!Number.isInteger(code)||code<200||code>599)invalid=true;else status=code;
  res.headersSent=true;
  if(values&&typeof values==='object'){
   if(Array.isArray(values)){
    if(values.length%2!==0)invalid=true;
    for(let i=0;i+1<values.length;i+=2)setHeader(values[i],values[i+1]);
   }else for(const key of Object.keys(values))setHeader(key,values[key]);
  }else if(values!==undefined)invalid=true;
 };
 const end=(data)=>{
  if(ended)return;
  ended=true;res.headersSent=true;
  if(data===undefined||data===null)return;
  let buffer;
  if(Buffer.isBuffer(data))buffer=data;
  else if(typeof data==='string')buffer=Buffer.from(data);
  else if(data instanceof Uint8Array)buffer=Buffer.from(data.buffer,data.byteOffset,data.byteLength);
  else{invalid=true;return;}
  if(total+buffer.length>MAX_ENVELOPE){invalid=true;return;}
  parts.push(buffer);total+=buffer.length;
 };
 const res={headersSent:false,setHeader,writeHead,end};
 const finish=()=>{
  if(!ended||invalid||!Number.isInteger(status)||status<200||status>599)return null;
  const body=Buffer.concat(parts,total),out={};
  for(const key of Object.keys(headers)){
   const value=headers[key];
   if(key==='content-length'&&(!/^\d+$/.test(value)||Number(value)!==body.length))continue;
   out[key]=value;
  }
  return {status,headers:out,body};
 };
 return {res,finish};
}
export function createMaterialSessionTransport({library,origin}={}){
 const mounted=createMountedMaterials({library,origin});
 const host=new URL(origin).host;
 return async function transport(input,context){
  try{
   const safeContext=readContext(context,origin);
   if(!safeContext)return jsonError(401,'SESSION_ENDED','主系统登录已结束');
   let request;
   try{request=prepare(input,safeContext);}catch{return jsonError(400,'INVALID_INPUT','素材请求格式无效');}
   if(request.error)return request.error;
   let finalizeRead=null;
   if(request.method==='GET'){
    const authority=createLocalAuthAuthority({auth:safeContext.session.auth,administration:safeContext.administration,isLive:safeContext.isLive});
    const initial=authority.read('view');
    finalizeRead=()=>{const current=authority.read('view');if(current.staffId!==initial.staffId||current.sessionRef!==initial.sessionRef||current.userId!==initial.userId)throw new MaterialAuthError(401,'SESSION_CHANGED','账号会话已更换');if(current.level!==initial.level||current.grantRevision!==initial.grantRevision)throw new MaterialAuthError(403,'ACCESS_CHANGED','素材权限已变更');};
   }
   let sent=false;
   const req=new Readable({read(){if(sent)return;sent=true;if(request.body.length)this.push(request.body);this.push(null);}});
   req.method=request.method;req.url=request.path;
   req.headers={...request.headers,host,origin,['content-length']:String(request.body.length)};
   const collected=createCollector();
   try{await mounted(req,collected.res,safeContext);}finally{try{req.destroy();}catch{}}
   const response=collected.finish();
   if(!response)return jsonError(503,'BRIDGE_RESPONSE_INVALID','素材桥接响应无效');
   const envelope={status:response.status,headers:response.headers,bodyBase64:response.body.toString('base64')};
   if(finalizeRead&&response.status>=200&&response.status<300)Object.defineProperty(envelope,READ_FINALIZE,{value:finalizeRead,enumerable:false,writable:false,configurable:false});
   return envelope;
  }catch(error){if(error instanceof MaterialAuthError)return jsonError(error.status,error.code,error.message);return jsonError(503,'BRIDGE_UNAVAILABLE','素材桥接暂不可用');}
 };
}

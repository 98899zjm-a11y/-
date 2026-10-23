import {createMaterialRequestHandler} from './materials/server.mjs';
import {createMaterialAccessAdapter,createLocalAuthAuthority,checkRequestOrigin,MaterialAuthError} from './materials/auth/lib/access-adapter.mjs';

const respond=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(data));};
// This entry is called only by the captured main gateway. HTTP inputs cannot
// create authorities, choose a backend, or select an employee/session object.
export function createMountedMaterials({library,origin}={}){
 if(typeof library?.list!=='function'||typeof library?.get!=='function')throw TypeError('Owned material library required');
 const requests=new WeakMap(),sessions=new WeakMap();
 const access=createMaterialAccessAdapter({origin,resolveAuthority:req=>requests.get(req)||null});
 const handler=createMaterialRequestHandler({library,origin,access,basePath:'/materials'});
 return async function mounted(req,res,context){
  try{
   if(context?.origin!==origin||typeof context.isLive!=='function'||!context.isLive()||!context.session||typeof context.gatewayCsrf!=='string'||!/^[a-f0-9]{64}$/.test(context.gatewayCsrf))throw new MaterialAuthError(401,'SESSION_ENDED','主系统登录已结束，请返回工作台登录');
   checkRequestOrigin(req,origin,{write:req.method!=='GET'});
   let authority=sessions.get(context.session);
   if(!authority){authority=createLocalAuthAuthority({auth:context.session.auth,administration:context.administration,isLive:context.isLive});sessions.set(context.session,authority);}
   requests.set(req,authority);const actor=authority.read('view');
   if(req.url==='/materials/staff-auth/status'&&req.method==='GET'){
    const user=context.session.auth.status().user;authority.read('view');
    return respond(res,200,{authenticated:true,user:{name:user.name,username:user.username,level:actor.level},authCsrfToken:context.gatewayCsrf,candidate:true,mainSystemSession:true});
   }
   await handler(req,res);
  }catch(error){
   if(!res.headersSent)respond(res,error instanceof MaterialAuthError?error.status:503,{error:error instanceof MaterialAuthError?error.message:'主系统素材授权暂不可核实',code:error instanceof MaterialAuthError?error.code:'MATERIAL_AUTH_UNAVAILABLE'});
   else res.end();
  }finally{requests.delete(req);}
 };
}

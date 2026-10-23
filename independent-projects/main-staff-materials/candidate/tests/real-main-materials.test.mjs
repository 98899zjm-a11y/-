import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import sharp from '../materials/node_modules/sharp/dist/index.mjs';
import {openLibrary} from '../materials/lib/library.mjs';
import * as materialModule from '../mounted-materials.mjs';
const require=createRequire(import.meta.url),{createBackend}=require('../project/desktop/backend.cjs'),{createGateway}=require('../stage1/web-gateway.cjs');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const password='Synthetic-only-test-pass!';
const gate=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
const jpeg=await sharp({create:{width:20,height:20,channels:3,background:'#dddddd'}}).jpeg().toBuffer();
async function fixture(t,{pauseImage=false}={}){
 const dir=await fs.mkdtemp(path.join(root,'runtime','main-session-test-'));
 const backend=createBackend({dataDir:path.join(dir,'main'),migrationDir:path.join(root,'project','desktop','migrations')});
 backend.auth.setup({username:'main_admin',name:'虚构主系统管理员',password});
 const users={};for(const level of ['view','operate','manage','disabled']){const username='main_'+level,user=backend.auth.createUser({username,name:'虚构主系统员工',password,role:'employee'});users[level]=user;backend.administration.updatePermissions(backend.auth.status().user,{staffId:user.id,moduleAccess:{sales:level}},()=>backend.auth.listUsers());}
 const library=await openLibrary({root:path.join(root,'materials','runtime',path.basename(dir)),classify:async({sha256})=>({sha256,decision:'uncertain',category:'吊坠',tags:['心形','镂空'],reason:'虚构分类器，仅测试会话'})});
 const entered=gate(),release=gate();let hold=pauseImage;const serving=Object.freeze({...library,async file(id){const value=await library.file(id);if(hold){entered.resolve();await release.promise;}return value;}});
 const server=http.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const mounted=typeof materialModule.createMountedMaterials==='function'?materialModule.createMountedMaterials({library:serving,origin}):null;
 const seen=[];
 const gateway=createGateway({backend,server,root,appVersion:'1.7.0',allowLocalControls:false,sessionCookiePrefix:'xjy_materials_candidate_20261023',materialsHandler:async(req,res,context)=>{seen.push(context);if(mounted)return mounted(req,res,context);res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({error:'Main-session material mount is absent'}));}});
 t.after(async()=>{hold=false;release.resolve();await gateway.close();await library.close();await backend.close();await new Promise(r=>server.close(r));});
 function browser(){const cookies=new Map();let csrf='';return{
  get csrf(){return csrf;},
  async request(url,{method='GET',json,bytes,headers={},materialToken}={}){const h={...headers};if(cookies.size)h.cookie=[...cookies].map(([k,v])=>k+'='+v).join('; ');if(method!=='GET'){h.origin=origin;h['x-xjy-csrf']=csrf;}if(materialToken!==undefined)h['x-csrf-token']=materialToken;if(json!==undefined)h['content-type']='application/json';if(bytes)h['content-type']='application/octet-stream';Object.assign(h,headers);const response=await fetch(origin+url,{method,headers:h,...(json!==undefined?{body:JSON.stringify(json)}:bytes?{body:bytes}:{})});for(const cookie of response.headers.getSetCookie()){const[k,v]=cookie.split(';')[0].split('=');cookies.set(k,v);}const buffer=Buffer.from(await response.arrayBuffer());let data;try{data=JSON.parse(buffer);}catch{}if(data?.csrf)csrf=data.csrf;return{status:response.status,data,bytes:buffer,headers:response.headers};},
  async login(level){await this.request('/session');const result=await this.request('/auth/login',{method:'POST',json:{username:level==='admin'?'main_admin':'main_'+level,password}});assert.equal(result.status,200);return result;},
  async bootstrap(){return this.request('/materials/api/bootstrap');}
 };}
 async function upload(client){const boot=await client.bootstrap();assert.equal(boot.status,200);const result=await client.request('/materials/api/assets?name=synthetic.jpg',{method:'POST',bytes:jpeg,materialToken:boot.data.csrfToken});assert.equal(result.status,202);await library.idle();return{asset:library.get(result.data.asset.id),token:boot.data.csrfToken};}
 return{backend,library,gateway,origin,browser,users,seen,upload,entered,release,unhold(){hold=false;release.resolve();}};
}

test('one real main-system login opens materials using exactly its server-owned backend session',async t=>{
 const f=await fixture(t),a=f.browser();await a.login('view');const main=await a.request('/auth/status'),status=await a.request('/materials/staff-auth/status'),boot=await a.bootstrap();
 assert.equal(status.status,200);assert.equal(status.data.mainSystemSession,true);assert.equal(status.data.user.username,main.data.user.username);assert.equal(status.data.authCsrfToken,a.csrf);
 assert.equal(boot.status,200);assert.equal(boot.data.permissions.level,'view');assert.equal(f.seen.at(-1).session.auth.status().user.id,main.data.user.id);
 assert.equal(status.headers.get('set-cookie'),null);
});
test('anonymous and forged roles cannot read or import; sales disabled is denied by real administration',async t=>{
 const f=await fixture(t),a=f.browser();assert.equal((await a.request('/materials/api/assets',{headers:{'x-user-role':'admin'}})).status,401);
 await a.login('disabled');assert.equal((await a.bootstrap()).status,403);
 const view=f.browser();await view.login('view');const boot=await view.bootstrap();assert.equal(boot.status,200);
 assert.equal((await view.request('/materials/api/assets?name=synthetic.jpg',{method:'POST',bytes:jpeg,materialToken:boot.data.csrfToken,headers:{'x-user-role':'admin'}})).status,403);
 assert.equal(f.library.list().length,0);
});
test('binary upload needs both original main CSRF and material credential; another browser cannot reuse it',async t=>{
 const f=await fixture(t),a=f.browser(),b=f.browser();await a.login('operate');await b.login('operate');const aa=await a.bootstrap(),bb=await b.bootstrap();assert.equal(aa.status,200);assert.equal(bb.status,200);
 assert.equal((await a.request('/materials/api/assets',{method:'POST',bytes:jpeg,materialToken:aa.data.csrfToken,headers:{'x-xjy-csrf':''}})).status,403);
 assert.equal((await a.request('/materials/api/assets',{method:'POST',bytes:jpeg})).status,401);
 assert.equal((await b.request('/materials/api/assets',{method:'POST',bytes:jpeg,materialToken:aa.data.csrfToken})).status,401);
 const uploaded=await a.request('/materials/api/assets?name=synthetic.jpg',{method:'POST',bytes:jpeg,materialToken:aa.data.csrfToken});assert.equal(uploaded.status,202);await f.library.idle();assert.equal(f.library.list().length,1);
});
test('original main admin grants govern edit, review and supply confirmation without a second employee store',async t=>{
 const f=await fixture(t),editor=f.browser(),manager=f.browser(),admin=f.browser();await editor.login('operate');await manager.login('manage');await admin.login('admin');const {asset,token}=await f.upload(editor);
 assert.equal((await editor.request('/materials/api/assets/'+asset.id,{method:'PATCH',materialToken:token,json:{availability:'in_stock',evidence:'虚构测试依据',confirmed:true}})).status,403);
 const managerBoot=await manager.bootstrap();assert.equal(managerBoot.status,200);
 assert.equal((await manager.request('/materials/api/assets/'+asset.id,{method:'PATCH',materialToken:managerBoot.data.csrfToken,json:{reviewDecision:'jewelry',confirmed:true}})).status,200);
 assert.equal((await admin.request('/api/admin/module-permissions',{method:'PATCH',json:{staffId:f.users.operate.id,moduleAccess:{sales:'view'}}})).status,200);
 assert.equal((await editor.request('/materials/api/assets/'+asset.id,{method:'PATCH',materialToken:token,json:{tags:['花形']}})).status,403);
 assert.deepEqual(f.library.get(asset.id).tags,['心形','镂空']);
});
test('logout and same-user relogin through original routes invalidate all old material write credentials',async t=>{
 const f=await fixture(t),a=f.browser();await a.login('operate');const {asset,token}=await f.upload(a);
 assert.equal((await a.request('/auth/logout',{method:'POST',json:{}})).status,200);
 assert.equal((await a.request('/materials/api/assets')).status,401);await a.login('operate');
 assert.equal((await a.request('/materials/api/assets/'+asset.id,{method:'PATCH',materialToken:token,json:{tags:['花形']}})).status,401);
 const boot=await a.bootstrap();assert.equal(boot.status,200);assert.equal((await a.request('/materials/api/assets/'+asset.id,{method:'PATCH',materialToken:boot.data.csrfToken,json:{tags:['花形']}})).status,200);
});
test('an in-flight real image read is denied after main admin downgrade, not served from an earlier actor',async t=>{
 const f=await fixture(t,{pauseImage:true}),a=f.browser(),admin=f.browser();await a.login('operate');await admin.login('admin');const {asset}=await f.upload(a);
 const response=a.request('/materials/api/assets/'+asset.id+'/image');await f.entered.promise;
 const change=await admin.request('/api/admin/module-permissions',{method:'PATCH',json:{staffId:f.users.operate.id,moduleAccess:{sales:'view'}}});assert.equal(change.status,200);f.unhold();assert.equal((await response).status,403);
});
test('maintenance revokes an in-flight main-session read until it ends and waits for the handler',async t=>{
 const f=await fixture(t,{pauseImage:true}),a=f.browser();await a.login('operate');const {asset}=await f.upload(a);const response=a.request('/materials/api/assets/'+asset.id+'/image');await f.entered.promise;
 const frozen=f.gateway.withFrozen(async()=>true);f.unhold();assert.equal((await response).status,401);assert.equal(await frozen,true);
});
for(const change of ['active','password'])test('original main admin '+change+' change blocks an already running material image read',async t=>{
 const f=await fixture(t,{pauseImage:true}),a=f.browser(),admin=f.browser();await a.login('operate');await admin.login('admin');const {asset}=await f.upload(a);
 const response=a.request('/materials/api/assets/'+asset.id+'/image');await f.entered.promise;
 const update={id:f.users.operate.id,...(change==='active'?{active:false}:{password:'Different-synthetic-password!'})};
 assert.equal((await admin.request('/api/users',{method:'PATCH',json:update})).status,200);f.unhold();assert.equal((await response).status,401);
 assert.equal((await a.request('/materials/api/assets')).status,401);
});
test('same-user main relogin blocks an old in-flight image and does not inherit material write tokens',async t=>{
 const f=await fixture(t,{pauseImage:true}),a=f.browser();await a.login('operate');const {asset,token}=await f.upload(a);
 const response=a.request('/materials/api/assets/'+asset.id+'/image');await f.entered.promise;await a.login('operate');f.unhold();assert.equal((await response).status,401);
 assert.equal((await a.request('/materials/api/assets/'+asset.id,{method:'PATCH',materialToken:token,json:{tags:['花形']}})).status,401);
 assert.equal((await a.bootstrap()).status,200);
});
test('a failed switch through main login revokes the old material session before password checking completes',async t=>{
 const f=await fixture(t,{pauseImage:true}),a=f.browser();await a.login('operate');const {asset}=await f.upload(a);const response=a.request('/materials/api/assets/'+asset.id+'/image');await f.entered.promise;
 const failed=await a.request('/auth/login',{method:'POST',json:{username:'main_view',password:'Wrong-synthetic-password!'}});assert.equal(failed.status,401);f.unhold();assert.equal((await response).status,401);
 assert.equal((await a.request('/auth/status')).data.authenticated,false);
 assert.equal((await a.request('/materials/api/assets')).status,401);
});

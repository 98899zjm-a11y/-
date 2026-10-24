import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import sharp from '../materials/node_modules/sharp/dist/index.mjs';
import {openLibrary} from '../materials/lib/library.mjs';
import {createMaterialSessionTransport} from '../materials-session-transport.mjs';
const require=createRequire(import.meta.url),{createBackend}=require('../project/desktop/backend.cjs');
const root=path.resolve(import.meta.dirname,'..');
const origin='http://127.0.0.1:21965';
const password='Synthetic-transport-test-only!';
const data=envelope=>JSON.parse(Buffer.from(envelope.bodyBase64,'base64').toString('utf8'));
async function fixture(t){
 const temporary=await fs.mkdtemp(path.join(root,'runtime','transport-test-'));
 const backend=createBackend({dataDir:path.join(temporary,'main'),migrationDir:path.join(root,'project/desktop/migrations')});
 backend.auth.setup({username:'fixture_admin',name:'虚构管理员',password});
 const people={};for(const level of ['view','operate','manage']){const user=backend.auth.createUser({username:'fixture_'+level,name:'虚构测试员工',password,role:'employee'});people[level]=user;backend.administration.updatePermissions(backend.auth.status().user,{staffId:user.id,moduleAccess:{sales:level}},()=>backend.auth.listUsers());}
 const library=await openLibrary({root:path.join(root,'materials/runtime',path.basename(temporary)),classify:async({sha256})=>({sha256,decision:'uncertain',category:'吊坠',tags:['心形'],reason:'虚构像素分类'})});
 const sessions=[];t.after(async()=>{for(const session of sessions)await session.close();await library.close();await backend.close();});
 const transport=createMaterialSessionTransport({library,origin});
 async function actor(level){const session=backend.createSession({sourcePeer:'127.0.0.1'});sessions.push(session);const login=await session.dispatch({path:'/auth/login',method:'POST',body:{username:'fixture_'+level,password}});assert.equal(login.ok,true);let live=true;const csrf=randomBytes(32).toString('hex'),context={session,administration:backend.administration,isLive:()=>live,gatewayCsrf:csrf};const status=await transport({path:'/materials/staff-auth/status',method:'GET'},context);assert.equal(status.status,200);assert.equal(data(status).authCsrfToken,csrf);const boot=await transport({path:'/materials/api/bootstrap',method:'GET'},context);assert.equal(boot.status,200);return{context,csrf,token:data(boot).csrfToken,stop:()=>{live=false;},async request(url,{method='GET',json,bytes,headers={}}={}){return transport({path:url,method,headers:{...(method!=='GET'?{'x-xjy-csrf':csrf,'x-csrf-token':this.token}:{}),...(json?{'content-type':'application/json'}:{}),...(bytes?{'content-type':'application/octet-stream'}:{}),...headers},...(json?{bodyBase64:Buffer.from(JSON.stringify(json)).toString('base64')}:bytes?{bodyBase64:bytes.toString('base64')}:{})},context);}};}
 return{backend,library,transport,actor,people};
}
test('transport requires actual live main authority and refuses input identity/header/path injection',async t=>{
 const f=await fixture(t),actor=await f.actor('manage');
 assert.equal((await f.transport({path:'/materials/api/assets',method:'GET'},{})).status,401);
 for(const input of [
  {path:'/materials/api/assets',method:'GET',userId:1},
  {path:'/materials/../auth/status',method:'GET'},
  {path:'/materials/%2e%2e/auth/status',method:'GET'},
  {path:'http://127.0.0.1:31831/materials/api/assets',method:'GET'},
  {path:'/materials/api/assets',method:'GET',headers:{host:'attacker.invalid'}},
  {path:'/materials/api/assets',method:'POST',bodyBase64:'%%%'}
 ])assert.equal((await f.transport(input,actor.context)).status,400);
 actor.stop();assert.equal((await actor.request('/materials/api/assets')).status,401);
});
test('same main session uploads then manager confirms; viewer gets pixels and safe projection with two CSRF gates',async t=>{
 const f=await fixture(t),operator=await f.actor('operate'),manager=await f.actor('manage'),viewer=await f.actor('view');
 const bytes=await sharp({create:{width:30,height:30,channels:3,background:'#eeeeee'}}).jpeg().toBuffer(),sourceHash=createHash('sha256').update(bytes).digest('hex');
 assert.equal((await operator.request('/materials/api/assets?name=fixture.jpg',{method:'POST',bytes,headers:{'x-xjy-csrf':'invalid'}})).status,403);
 assert.equal((await operator.request('/materials/api/assets?name=fixture.jpg',{method:'POST',bytes,headers:{'x-csrf-token':'invalid'}})).status,403);
 const upload=await operator.request('/materials/api/assets?name=fixture.jpg',{method:'POST',bytes});assert.equal(upload.status,202);const id=data(upload).asset.id;await f.library.idle();
 assert.equal((await viewer.request('/materials/api/assets/'+id,{method:'PATCH',json:{tags:['心形']}})).status,403);
 const confirmation=await manager.request('/materials/api/assets/'+id,{method:'PATCH',json:{category:'吊坠',tags:['心形','镂空'],reviewDecision:'jewelry',confirmed:true}});assert.equal(confirmation.status,200);assert.deepEqual(Object.keys(data(confirmation)).sort(),['accepted','asset']);
 const visible=data(await viewer.request('/materials/api/assets')).assets;assert.equal(visible.length,1);for(const field of ['name','sourceLabel','sha256','reason','error','evidence'])assert.equal(Object.hasOwn(visible[0],field),false);
 const image=await viewer.request('/materials/api/assets/'+id+'/image');assert.equal(image.status,200);assert.equal(image.headers['content-type'],'image/jpeg');assert.ok(Buffer.from(image.bodyBase64,'base64').length>0);assert.equal(visible[0].availability,'unknown');
 assert.equal(createHash('sha256').update(bytes).digest('hex'),sourceHash);
});
test('live server permission and account disable change are enforced without second material login',async t=>{
 const f=await fixture(t),actor=await f.actor('operate');
 f.backend.administration.updatePermissions(f.backend.auth.status().user,{staffId:f.people.operate.id,moduleAccess:{sales:'disabled'}},()=>f.backend.auth.listUsers());
 assert.equal((await actor.request('/materials/api/assets')).status,403);
 f.backend.auth.updateUser({id:f.people.operate.id,active:false});
 assert.equal((await actor.request('/materials/api/assets')).status,401);
});
test('transport preserves legal large image bodies and encoded slashes in data fields',async t=>{
 const f=await fixture(t),operator=await f.actor('operate');
 const image=await sharp(randomBytes(1400*1400*3),{raw:{width:1400,height:1400,channels:3}}).png({compressionLevel:0}).toBuffer();assert.ok(image.length>5*1024*1024&&image.length<20*1024*1024);
 const upload=await operator.request('/materials/api/assets?name=synthetic.png',{method:'POST',bytes:image});assert.equal(upload.status,202);await f.library.idle();
 const query='/materials/api/search?'+new URLSearchParams({q:'戒指/吊坠'});assert.equal((await operator.request(query)).status,200);
 const note='/materials/api/assets?'+new URLSearchParams({name:'reference/style.jpg',sourceLabel:'虚构来源/已批准本地测试'});const small=await sharp({create:{width:17,height:17,channels:3,background:'#aaa'}}).jpeg().toBuffer();assert.equal((await operator.request(note,{method:'POST',bytes:small})).status,202);
});

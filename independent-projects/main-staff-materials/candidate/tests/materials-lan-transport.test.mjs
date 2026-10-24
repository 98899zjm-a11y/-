import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {randomUUID,randomBytes,generateKeyPairSync,createPublicKey,createHash,diffieHellman,hkdfSync,createCipheriv,createDecipheriv} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const {createBackend}=require('../project/desktop/backend.cjs');
const {startLanServer,createLanClient,validateMaterialsOutput,stripMaterialsReadFinalizer}=require('../project/desktop/lan.cjs');
const {createNetworkWorkspace}=require('../project/desktop/network-workspace.cjs');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const evidence=path.resolve(root,'..','evidence','storage-client-lan-20261024','lan');
const password='Synthetic-lan-only-test!';
const readSeal=Symbol.for('xjy.materials.finalizeRead');
const sealed=(envelope,fn)=>Object.defineProperty(envelope,readSeal,{value:fn,enumerable:false});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
const decode=value=>JSON.parse(Buffer.from(value.bodyBase64,'base64').toString('utf8'));
async function fixture(t,handler){
 await fs.mkdir(path.join(evidence,'runtime'),{recursive:true});
 const dir=await fs.mkdtemp(path.join(evidence,'runtime','case-'));
 const backend=createBackend({dataDir:path.join(dir,'main'),migrationDir:path.join(root,'project','desktop','migrations')});
 backend.auth.setup({username:'lan_admin',name:'虚构LAN管理员',password});
 const users={};for(const level of ['view','operate','manage','disabled']){const user=backend.auth.createUser({username:'lan_'+level,name:'虚构LAN员工',password,role:'employee'});users[level]=user;backend.administration.updatePermissions(backend.auth.status().user,{staffId:user.id,moduleAccess:{sales:level}},()=>backend.auth.listUsers());}
 let calls=0;const seen=[];
 const server=await startLanServer({backend,host:'127.0.0.1',port:0,materialsHandler:async(input,context)=>{calls++;seen.push({input,context});if(handler)return handler(input,context);return{status:200,headers:{'content-type':'application/json'},bodyBase64:Buffer.from(JSON.stringify({user:context.session.auth.status().user.username,csrf:context.gatewayCsrf})).toString('base64')};}});
 const clients=[];function client(){const c=createLanClient({host:'127.0.0.1',port:server.port,code:server.code});clients.push(c);return c;}
 async function login(c,level='operate'){const r=await c.dispatch({path:'/auth/login',method:'POST',body:{username:level==='admin'?'lan_admin':'lan_'+level,password}});assert.equal(r.status,200);return r;}
 t.after(async()=>{await Promise.all(clients.map(c=>c.close()));await server.stop();await backend.close();});
 return{backend,server,client,login,users,seen,dir,get calls(){return calls;}};
}
test('anonymous real encrypted LAN cannot enter the trusted materials callback',async t=>{
 const f=await fixture(t),c=f.client();assert.equal(typeof c.materialsRequest,'function','LAN materials API is absent');
 const r=await c.materialsRequest({path:'/materials/api/bootstrap'});assert.equal(r.status,401);assert.equal(f.calls,0);
 assert.equal((await c.dispatch({path:'/auth/status'})).data.authenticated,false);
});
test('one original login supplies the actual backend session and logout retires materials access',async t=>{
 const f=await fixture(t),c=f.client();assert.equal(typeof c.materialsRequest,'function','LAN materials API is absent');await f.login(c);
 const r=await c.materialsRequest({path:'/materials/api/bootstrap'});assert.equal(r.status,200);assert.equal(decode(r).user,'lan_operate');assert.equal(f.calls,1);
 assert.equal(f.seen[0].context.administration,f.backend.administration);assert.equal(f.seen[0].context.isLive(),true);
 assert.equal((await c.dispatch({path:'/auth/logout',method:'POST'})).status,200);assert.equal(f.seen[0].context.isLive(),false);
 assert.equal((await c.materialsRequest({path:'/materials/api/bootstrap'})).status,401);assert.equal(f.calls,1);
});
test('different employees and two logins of one employee keep server sessions and main CSRF isolated',async t=>{
 const f=await fixture(t),a=f.client(),b=f.client(),same=f.client();await f.login(a,'operate');await f.login(b,'view');await f.login(same,'operate');
 const aa=decode(await a.materialsRequest({path:'/materials/api/bootstrap'})),bb=decode(await b.materialsRequest({path:'/materials/api/bootstrap'})),ss=decode(await same.materialsRequest({path:'/materials/api/bootstrap'}));
 assert.equal(aa.user,'lan_operate');assert.equal(bb.user,'lan_view');assert.equal(ss.user,'lan_operate');assert.notEqual(aa.csrf,ss.csrf);assert.notEqual(aa.csrf,bb.csrf);
 assert.notEqual(f.seen[0].context.session,f.seen[1].context.session);assert.notEqual(f.seen[0].context.session,f.seen[2].context.session);
 const initial=f.calls;
 assert.equal((await same.materialsRequest({path:'/materials/api/assets/proof/retry',method:'POST',headers:{'x-xjy-csrf':aa.csrf,'x-csrf-token':'a'.repeat(64)}})).status,403);assert.equal(f.calls,initial);
 assert.equal((await a.dispatch({path:'/auth/logout',method:'POST'})).status,200);assert.equal((await b.materialsRequest({path:'/materials/api/bootstrap'})).status,200);assert.equal((await same.materialsRequest({path:'/materials/api/bootstrap'})).status,200);
 assert.equal(Object.hasOwn(a,'token'),false);assert.equal(Object.hasOwn(a,'code'),false);assert.doesNotMatch(JSON.stringify(bb),/privateKey|connectionCode|accessToken/);
});
test('same-user relogin and failed account switch invalidate captured material contexts',async t=>{
 const f=await fixture(t),a=f.client();await f.login(a);const first=decode(await a.materialsRequest({path:'/materials/api/bootstrap'})),old=f.seen.at(-1).context;
 await f.login(a);assert.equal(old.isLive(),false);const current=decode(await a.materialsRequest({path:'/materials/api/bootstrap'}));assert.notEqual(first.csrf,current.csrf);
 const calls=f.calls;assert.equal((await a.materialsRequest({path:'/materials/api/assets/proof/retry',method:'POST',headers:{'x-xjy-csrf':first.csrf}})).status,403);assert.equal(f.calls,calls);
 const prior=f.seen.at(-1).context;assert.equal((await a.dispatch({path:'/auth/login',method:'POST',body:{username:'lan_view',password:'Synthetic-wrong-password!'}})).status,401);assert.equal(prior.isLive(),false);
 assert.equal((await a.materialsRequest({path:'/materials/api/bootstrap'})).status,401);assert.equal(f.calls,calls);
});
test('fixed material whitelist rejects paths headers query pollution identities and invalid payloads before callback',async t=>{
 const f=await fixture(t),a=f.client();await f.login(a);const base='/materials/api/bootstrap';
 const bad=[
 {path:'/auth/status'},{path:'/api/customers'},{path:'http://example.invalid/materials/api/bootstrap'},{path:'//127.0.0.1/materials/api/bootstrap'},
 {path:'/materials/../api/bootstrap'},{path:'/materials/%2e%2e/api/bootstrap'},{path:'/materials/api/assets/a%2fb/image'},{path:'/materials\\api/bootstrap'},
 {path:base+'#x'},{path:base+'?x=1'},{path:'/materials/api/search?q=a&q=b'},{path:'/materials/api/search?unknown=x'},
 {path:base,headers:{origin:'http://evil.invalid'}},{path:base,headers:{authorization:'Bearer synthetic'}},{path:base,headers:{cookie:'synthetic=x'}},
 {path:base,headers:{'x-user-role':'admin'}},{path:base,role:'admin'},{path:base,sessionId:'forged'},{path:base,user:{id:'forged'}},
 {path:base,method:'DELETE'},{path:base,bodyBase64:'eA=='},{path:base,headers:{'x-csrf-token':'x\r\ny'}},
 {path:'/materials/api/assets/a/retry',method:'POST',bodyBase64:'eA=='},
 {path:'/materials/api/assets/a',method:'PATCH',headers:{'content-type':'application/json'},bodyBase64:'!!!'},
 {path:'/materials/api/assets/a',method:'PATCH',headers:{'content-type':'application/json'},bodyBase64:Buffer.from('[]').toString('base64')},
 {path:'/materials/api/assets',method:'POST',headers:{'content-type':'text/plain'},bodyBase64:'eA=='},
 ];
 for(const input of bad){const r=await a.materialsRequest(input);assert.ok(r.status>=400&&r.status<500,JSON.stringify(input)+' yielded '+r.status);}
 assert.equal(f.calls,0);
 assert.equal((await a.materialsRequest({path:'/materials/api/search?q='+encodeURIComponent('戒指')+'&offset=0&limit=10'})).status,200);assert.equal(f.calls,1);
});
test('main CSRF is required for writes while the trusted callback receives material CSRF unchanged',async t=>{
 const f=await fixture(t),a=f.client();await f.login(a);const boot=decode(await a.materialsRequest({path:'/materials/api/bootstrap'}));const calls=f.calls;
 for(const headers of [{},{'x-xjy-csrf':'b'.repeat(64)},{'x-csrf-token':'c'.repeat(64)}])assert.equal((await a.materialsRequest({path:'/materials/api/assets/proof/retry',method:'POST',headers})).status,403);
 assert.equal(f.calls,calls);
 const r=await a.materialsRequest({path:'/materials/api/assets/proof/retry',method:'POST',headers:{'x-xjy-csrf':boot.csrf,'x-csrf-token':'c'.repeat(64)}});assert.equal(r.status,200);assert.equal(f.seen.at(-1).input.headers['x-csrf-token'],'c'.repeat(64));
});
test('binary upload traverses the original encryption and enforces bounded request size',async t=>{
 const payload=Buffer.alloc(5*1024*1024,0x5a);
 const f=await fixture(t,(input)=>({status:202,headers:{'content-type':'application/json'},bodyBase64:Buffer.from(JSON.stringify({size:Buffer.from(input.bodyBase64,'base64').length,head:input.bodyBase64.slice(0,12)})).toString('base64')})),a=f.client();await f.login(a);
 const boot=await a.materialsRequest({path:'/materials/api/bootstrap'});const csrf=f.seen.at(-1).context.gatewayCsrf;
 const r=await a.materialsRequest({path:'/materials/api/assets?name=synthetic.jpg',method:'POST',headers:{'content-type':'application/octet-stream','x-xjy-csrf':csrf},bodyBase64:payload.toString('base64')});assert.equal(r.status,202);assert.deepEqual(decode(r),{size:payload.length,head:payload.toString('base64').slice(0,12)});
 const calls=f.calls;assert.equal((await a.materialsRequest({path:'/materials/api/assets',method:'POST',headers:{'content-type':'application/octet-stream','x-xjy-csrf':csrf},bodyBase64:Buffer.alloc(20*1024*1024+1).toString('base64')})).status,413);assert.equal(f.calls,calls);
 assert.equal((await a.dispatch({path:'/auth/status'})).data.authenticated,true);assert.equal(boot.status,202);
});
test('material responses enforce canonical bounded bytes and safe header whitelist',async t=>{
 let output={status:200,headers:{'content-type':'image/jpeg'},bodyBase64:Buffer.alloc(2*1024*1024,0x5b).toString('base64')};const f=await fixture(t,()=>output),a=f.client();await f.login(a);
 let r=await a.materialsRequest({path:'/materials/api/assets/proof/image'});assert.equal(r.status,200);assert.deepEqual(Buffer.from(r.bodyBase64,'base64'),Buffer.alloc(2*1024*1024,0x5b));
 for(const value of [
 {status:200,headers:{'set-cookie':'secret=synthetic'},bodyBase64:''},
 {status:200,headers:{location:'https://example.invalid'},bodyBase64:''},
 {status:200,headers:{'content-type':'application/json\r\nX-Test: x'},bodyBase64:''},
 {status:200,headers:{},bodyBase64:'not-base64'},
 {status:200,headers:{},bodyBase64:'',token:'must-not-return'},
 {status:999,headers:{},bodyBase64:''},
 ]){output=value;r=await a.materialsRequest({path:'/materials/api/bootstrap'});assert.equal(r.status,502);assert.doesNotMatch(JSON.stringify(r),/secret=|must-not-return|example.invalid/);}
 output={status:200,headers:{},bodyBase64:Buffer.alloc(24*1024*1024+1).toString('base64')};assert.equal((await a.materialsRequest({path:'/materials/api/bootstrap'})).status,413);
});
test('a committed write acknowledgement survives lifecycle change after handler commit',async t=>{
 let close;
 const f=await fixture(t,async(input,context)=>{if(input.method==='POST'){await context.session.close();close=true;return{status:202,headers:{'content-type':'application/json'},bodyBase64:Buffer.from('{"accepted":true,"asset":{"id":"proof"}}').toString('base64')};}return{status:200,headers:{'content-type':'application/json'},bodyBase64:Buffer.from(JSON.stringify({csrf:context.gatewayCsrf})).toString('base64')};}),a=f.client();await f.login(a);
 const boot=decode(await a.materialsRequest({path:'/materials/api/bootstrap'}));const r=await a.materialsRequest({path:'/materials/api/assets/proof/retry',method:'POST',headers:{'x-xjy-csrf':boot.csrf}});assert.equal(close,true);assert.equal(r.status,202);assert.equal(decode(r).accepted,true);
});
test('legacy request and image operations retain original authenticated and anonymous behavior',async t=>{
 const f=await fixture(t),a=f.client();assert.equal((await a.dispatch({path:'/auth/status'})).status,200);assert.equal((await a.dispatch({path:'/auth/setup',method:'POST'})).status,403);
 assert.equal((await a.dispatch({path:'/materials/api/bootstrap'})).status,400);assert.equal((await a.imageResponse('missing')).status,401);
 await f.login(a);assert.equal((await a.dispatch({path:'/auth/status'})).data.user.username,'lan_operate');assert.ok([403,404].includes((await a.imageResponse('missing')).status));
 assert.equal((await a.dispatch({path:'/auth/logout',method:'POST'})).data.authenticated,false);
});
test('local workspace wrapper is stable per usage session and regenerated after relogin maintenance and backend replacement',async t=>{
 const f=await fixture(t);const contexts=[];
 const handler=async(input,context)=>{contexts.push(context);return{status:200,headers:{'content-type':'application/json'},bodyBase64:Buffer.from(JSON.stringify({csrf:context.gatewayCsrf,user:context.session.auth.status().user.username})).toString('base64')};};
 const w=await createNetworkWorkspace({backend:f.backend,configFile:path.join(f.dir,'network.json'),materialsHandler:handler});t.after(()=>w.close());
 assert.equal(typeof w.materialsRequest,'function');const aa=decode(await w.materialsRequest({path:'/materials/api/bootstrap'}));await w.materialsRequest({path:'/materials/api/bootstrap'});assert.equal(contexts[0].session,contexts[1].session);assert.equal(contexts[0].gatewayCsrf,contexts[1].gatewayCsrf);
 assert.equal((await w.materialsRequest({path:'/materials/api/assets/proof/retry',method:'POST',headers:{'x-xjy-csrf':'d'.repeat(64)}})).status,403);
 assert.equal((await w.request({path:'/auth/login',method:'POST',body:{username:'lan_operate',password}})).status,200);assert.equal(contexts[0].isLive(),false);
 const bb=decode(await w.materialsRequest({path:'/materials/api/bootstrap'}));assert.notEqual(aa.csrf,bb.csrf);assert.notEqual(contexts[0].session,contexts[2].session);
 const prior=contexts.at(-1);await w.withFrozen(async()=>{assert.equal(prior.isLive(),false);assert.equal((await w.materialsRequest({path:'/materials/api/bootstrap'})).status,503);});
 const cc=decode(await w.materialsRequest({path:'/materials/api/bootstrap'}));assert.notEqual(bb.csrf,cc.csrf);
 const current=contexts.at(-1);await w.setBackend(f.backend);assert.equal(current.isLive(),false);const dd=decode(await w.materialsRequest({path:'/materials/api/bootstrap'}));assert.notEqual(dd.csrf,cc.csrf);
 await w.close();assert.equal(contexts.at(-1).isLive(),false);assert.equal((await w.materialsRequest({path:'/materials/api/bootstrap'})).status,503);
});
test('remote workspace delegates materials through the same client login and logout',async t=>{
 const f=await fixture(t),configFile=path.join(f.dir,'remote-network.json');await fs.writeFile(configFile,JSON.stringify({version:1,mode:'client',host:'127.0.0.1',port:f.server.port,code:f.server.code}));
 const w=await createNetworkWorkspace({backend:f.backend,configFile,clientOnly:true});t.after(()=>w.close());
 assert.equal((await w.materialsRequest({path:'/materials/api/bootstrap'})).status,401);
 assert.equal((await w.request({path:'/auth/login',method:'POST',body:{username:'lan_operate',password}})).status,200);
 const r=await w.materialsRequest({path:'/materials/api/bootstrap'});assert.equal(r.status,200);assert.equal(decode(r).user,'lan_operate');
 assert.equal((await w.request({path:'/auth/logout',method:'POST'})).status,200);assert.equal((await w.materialsRequest({path:'/materials/api/bootstrap'})).status,401);
});
async function wired(t,{holdImage=false,holdWrite=false,closeAfterCommit=false,holdAfterEnvelopePath=null}={}){
 const {createMaterialSessionTransport}=await import('../materials-session-transport.mjs');
 const entered=deferred(),release=deferred(),envelopeEntered=deferred(),envelopeRelease=deferred();let asset={id:'proof',name:'synthetic-internal.jpg',sourceLabel:'synthetic-source',status:'imported',category:'戒指',tags:['简约'],availability:'unknown',createdAt:'2026-10-24',updatedAt:'2026-10-24'};
 const library={list:()=>[asset],get:id=>id==='proof'?asset:null,async file(){if(holdImage){entered.resolve();await release.promise;}return{bytes:Buffer.from([0xff,0xd8,0xff,0xd9]),mime:'image/jpeg'};},async update(id,patch,{beforeCommit}={}){if(holdWrite){entered.resolve();await release.promise;}beforeCommit?.();asset={...asset,...patch};if(closeAfterCommit)await afterCommit();return asset;},async retry(id,{beforeCommit}={}){beforeCommit?.();return asset;}};
 let afterCommit=async()=>{};const transport=createMaterialSessionTransport({library,origin:'http://127.0.0.1:43123'});
 const f=await fixture(t,async(input,context)=>{afterCommit=()=>context.session.close();const output=await transport(input,context);if(input.path===holdAfterEnvelopePath){envelopeEntered.resolve(output);await envelopeRelease.promise;}return output;});
 t.after(()=>{release.resolve();envelopeRelease.resolve();});
 async function bootstrap(c){const status=await c.materialsRequest({path:'/materials/staff-auth/status'});assert.equal(status.status,200);const boot=await c.materialsRequest({path:'/materials/api/bootstrap'});assert.equal(boot.status,200);return{main:decode(status).authCsrfToken,material:decode(boot).csrfToken,permissions:decode(boot).permissions};}
 const edit=(c,tokens,patch={tags:['花形']},headers={})=>c.materialsRequest({path:'/materials/api/assets/proof',method:'PATCH',headers:{'content-type':'application/json',...(tokens?.main?{'x-xjy-csrf':tokens.main}:{}),...(tokens?.material?{'x-csrf-token':tokens.material}:{}),...headers},bodyBase64:Buffer.from(JSON.stringify(patch)).toString('base64')});
 return{...f,bootstrap,edit,entered,release,envelopeEntered,envelopeRelease,get asset(){return asset;}};
}
test('actual mounted authority requires both CSRF layers and rejects another same-user session credential',async t=>{
 const f=await wired(t),a=f.client(),b=f.client();await f.login(a);await f.login(b);const aa=await f.bootstrap(a),bb=await f.bootstrap(b);assert.equal(aa.permissions.level,'operate');assert.notEqual(aa.material,bb.material);
 assert.equal((await f.edit(a,{material:aa.material})).status,403);assert.equal((await f.edit(a,{main:aa.main})).status,401);
 assert.equal((await f.edit(b,{main:bb.main,material:aa.material})).status,401);assert.deepEqual(f.asset.tags,['简约']);
 await f.login(a);const fresh=await f.bootstrap(a);assert.equal((await f.edit(a,fresh)).status,200);assert.deepEqual(f.asset.tags,['花形']);
});
test('actual backend sales grants govern view operate manage and disabled through encrypted materials',async t=>{
 const f=await wired(t);for(const level of ['view','operate','manage','disabled']){const a=f.client();await f.login(a,level);const b=await a.materialsRequest({path:'/materials/api/bootstrap'});assert.equal(b.status,level==='disabled'?403:200);if(level==='disabled')continue;
 const tokens=await f.bootstrap(a);assert.equal(tokens.permissions.level,level);assert.equal((await f.edit(a,tokens)).status,level==='view'?403:200);
 const result=await f.edit(a,tokens,{availability:'in_stock',evidence:'虚构LAN测试依据',confirmed:true});assert.equal(result.status,level==='manage'?200:403);
 }
});
test('actual authority rereads revoked grants immediately before a delayed write commit',async t=>{
 const f=await wired(t,{holdWrite:true}),a=f.client();await f.login(a);const tokens=await f.bootstrap(a),pending=f.edit(a,tokens);await f.entered.promise;
 f.backend.administration.updatePermissions(f.backend.auth.status().user,{staffId:f.users.operate.id,moduleAccess:{sales:'view'}},()=>f.backend.auth.listUsers());f.release.resolve();assert.equal((await pending).status,403);assert.deepEqual(f.asset.tags,['简约']);
});
test('actual authority rereads revoked grants before sending a delayed image response',async t=>{
 const f=await wired(t,{holdImage:true}),a=f.client();await f.login(a);await f.bootstrap(a);const pending=a.materialsRequest({path:'/materials/api/assets/proof/image'});await f.entered.promise;
 f.backend.administration.updatePermissions(f.backend.auth.status().user,{staffId:f.users.operate.id,moduleAccess:{sales:'disabled'}},()=>f.backend.auth.listUsers());f.release.resolve();assert.equal((await pending).status,403);
});
test('real disabled account and password reset invalidate previously bootstrapped material sessions',async t=>{
 const f=await wired(t),a=f.client(),b=f.client();await f.login(a,'operate');await f.login(b,'manage');const aa=await f.bootstrap(a),bb=await f.bootstrap(b);
 f.backend.auth.updateUser({id:f.users.operate.id,active:false});assert.equal((await f.edit(a,aa)).status,401);
 f.backend.auth.updateUser({id:f.users.manage.id,password:'Synthetic-new-password!'});assert.equal((await f.edit(b,bb)).status,401);assert.deepEqual(f.asset.tags,['简约']);
});
test('actual material credentials expire on same-user relogin and unsuccessful switch without another login layer',async t=>{
 const f=await wired(t),a=f.client();await f.login(a);const aa=await f.bootstrap(a);await f.login(a);const bb=await f.bootstrap(a);assert.notEqual(aa.main,bb.main);assert.notEqual(aa.material,bb.material);
 assert.equal((await f.edit(a,{main:bb.main,material:aa.material})).status,401);await f.login(a);const fresh=await f.bootstrap(a);assert.equal((await f.edit(a,fresh)).status,200);
 assert.equal((await a.dispatch({path:'/auth/login',method:'POST',body:{username:'lan_view',password:'Synthetic-wrong-password!'}})).status,401);assert.equal((await a.materialsRequest({path:'/materials/api/assets'})).status,401);
});
test('actual mounted write keeps accepted receipt after authorization ended following its commit',async t=>{
 const f=await wired(t,{closeAfterCommit:true}),a=f.client();await f.login(a);const aa=await f.bootstrap(a),response=await f.edit(a,aa);assert.equal(response.status,200);assert.deepEqual(decode(response),{accepted:true,asset:{id:'proof'}});assert.deepEqual(f.asset.tags,['花形']);
 assert.equal((await a.materialsRequest({path:'/materials/api/assets'})).status,401);
});
async function rawRequest(server,packet){
 const serverKey=createPublicKey({key:Buffer.from(server.identity.publicKey,'base64url'),format:'der',type:'spki'}),serverDER=serverKey.export({type:'spki',format:'der'}),ephemeral=generateKeyPairSync('x25519'),publicDER=ephemeral.publicKey.export({type:'spki',format:'der'});
 const secret=diffieHellman({privateKey:ephemeral.privateKey,publicKey:serverKey}),salt=createHash('sha256').update(serverDER).update(publicDER).digest(),key=Buffer.from(hkdfSync('sha256',secret,salt,'xjy-lan-v1-x25519-aes256gcm',32));
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from('xjy-lan-v1:request'));const bytes=Buffer.concat([cipher.update(JSON.stringify(packet),'utf8'),cipher.final()]),content=JSON.stringify({publicKey:publicDER.toString('base64url'),iv:iv.toString('base64url'),tag:cipher.getAuthTag().toString('base64url'),data:bytes.toString('base64url')});
 const response=await new Promise((resolve,reject)=>{const r=http.request({host:'127.0.0.1',port:server.port,method:'POST',path:'/jewelry-lan',agent:false,headers:{'content-type':'application/json','content-length':Buffer.byteLength(content)}},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve(Buffer.concat(chunks)));res.on('error',reject);});r.on('error',reject);r.end(content);});
 const envelope=JSON.parse(response),decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(envelope.iv,'base64url'));decipher.setAAD(Buffer.from('xjy-lan-v1:response'));decipher.setAuthTag(Buffer.from(envelope.tag,'base64url'));return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data,'base64url')),decipher.final()]).toString('utf8'));
}
test('new materials op retains encrypted replay protection and unknown-token isolation server-side',async t=>{
 const f=await fixture(t);const login=await rawRequest(f.server,{id:randomUUID(),timestamp:Date.now(),op:'request',input:{path:'/auth/login',method:'POST',body:{username:'lan_operate',password}}});assert.equal(login.result.status,200);assert.equal(typeof login.token,'string');
 const packet={id:randomUUID(),timestamp:Date.now(),token:login.token,op:'materials',input:{path:'/materials/api/bootstrap'}};const r=await rawRequest(f.server,packet);assert.equal(r.result.status,200);assert.equal(f.calls,1);
 assert.equal((await rawRequest(f.server,packet)).result.status,409);assert.equal(f.calls,1);
 assert.equal((await rawRequest(f.server,{...packet,id:randomUUID(),token:'synthetic-invalid-token'})).result.status,401);assert.equal(f.calls,1);
 const invalid=await rawRequest(f.server,{...packet,id:randomUUID(),input:{path:'/auth/status',headers:{authorization:'forged'}}});assert.equal(invalid.result.status,400);assert.equal(f.calls,1);
 assert.equal((await rawRequest(f.server,{id:randomUUID(),timestamp:Date.now(),token:login.token,op:'request',input:{path:'/auth/logout',method:'POST'}})).result.status,200);
 assert.equal((await rawRequest(f.server,{...packet,id:randomUUID()})).result.status,401);assert.equal(f.calls,1);
});
test('queued material requests use an immutable validated snapshot before caller mutation',async t=>{
 const entered=deferred(),release=deferred();let first=true;
 const f=await fixture(t,async(input)=>{if(first){first=false;entered.resolve();await release.promise;}return{status:200,headers:{'content-type':'application/json'},bodyBase64:Buffer.from(JSON.stringify({path:input.path,headers:input.headers})).toString('base64')};}),a=f.client();t.after(()=>release.resolve());await f.login(a);
 const pending=a.materialsRequest({path:'/materials/api/bootstrap'});await entered.promise;
 const input={path:'/materials/api/search?q='+encodeURIComponent('戒指'),headers:{'x-csrf-token':'a'.repeat(64)}};const queued=a.materialsRequest(input);input.path='/auth/setup';input.headers.origin='http://evil.invalid';input.headers['x-csrf-token']='b'.repeat(64);release.resolve();assert.equal((await pending).status,200);
 const result=await queued;assert.equal(result.status,200);assert.deepEqual(decode(result),{path:'/materials/api/search?q='+encodeURIComponent('戒指'),headers:{'x-csrf-token':'a'.repeat(64)}});
});
test('local maintenance invalidates and drains an already-running material handler',async t=>{
 const f=await fixture(t),entered=deferred(),release=deferred();let context;
 const w=await createNetworkWorkspace({backend:f.backend,configFile:path.join(f.dir,'drain-network.json'),materialsHandler:async(input,ctx)=>{context=ctx;entered.resolve();await release.promise;return{status:ctx.isLive()?200:401,headers:{'content-type':'application/json'},bodyBase64:Buffer.from('{}').toString('base64')};}});t.after(async()=>{release.resolve();await w.close();});
 const pending=w.materialsRequest({path:'/materials/api/bootstrap'});await entered.promise;let ran=false;const frozen=w.withFrozen(async()=>{ran=true;});assert.equal(context.isLive(),false);assert.equal(ran,false);release.resolve();assert.equal((await pending).status,401);await frozen;assert.equal(ran,true);
});
test('local original logout prevents anonymous material callback and revokes its captured scope',async t=>{
 const f=await fixture(t);let calls=0,context;
 const w=await createNetworkWorkspace({backend:f.backend,configFile:path.join(f.dir,'logout-network.json'),materialsHandler:async(input,ctx)=>{calls++;context=ctx;return{status:200,headers:{'content-type':'application/json'},bodyBase64:Buffer.from('{}').toString('base64')};}});t.after(()=>w.close());
 assert.equal((await w.materialsRequest({path:'/materials/api/bootstrap'})).status,200);assert.equal(context.isLive(),true);assert.equal((await w.request({path:'/auth/logout',method:'POST'})).status,200);assert.equal(context.isLive(),false);
 assert.equal((await w.materialsRequest({path:'/materials/api/bootstrap'})).status,401);assert.equal(calls,1);
});
test('optional handler defaults keep legacy login working and reject malformed trusted handlers',async t=>{
 const f=await fixture(t);await assert.rejects(startLanServer({backend:f.backend,host:'127.0.0.1',port:0,materialsHandler:{}}),TypeError);
 await assert.rejects(createNetworkWorkspace({backend:f.backend,configFile:path.join(f.dir,'bad-handler.json'),materialsHandler:{}}),TypeError);
 const server=await startLanServer({backend:f.backend,host:'127.0.0.1',port:0}),a=createLanClient({host:'127.0.0.1',port:server.port,code:server.code});
 t.after(async()=>{await a.close();await server.stop();});await f.login(a);assert.equal((await a.dispatch({path:'/auth/status'})).data.authenticated,true);assert.equal((await a.materialsRequest({path:'/materials/api/bootstrap'})).status,503);
 const w=await createNetworkWorkspace({backend:f.backend,configFile:path.join(f.dir,'no-handler.json')});t.after(()=>w.close());assert.equal((await w.request({path:'/auth/status'})).data.authenticated,true);assert.equal((await w.materialsRequest({path:'/materials/api/bootstrap'})).status,503);
});
test('a 300-character Chinese query remains valid after URLSearchParams encoding',async t=>{
 const f=await fixture(t),a=f.client();await f.login(a);const query=new URLSearchParams({q:'中'.repeat(300)}),url='/materials/api/search?'+query;assert.ok(url.length>2500&&url.length<=4096);
 assert.equal((await a.materialsRequest({path:url})).status,200);assert.equal(f.calls,1);
});
test('both 200-character Chinese upload metadata fields remain valid after encoding',async t=>{
 const f=await fixture(t),a=f.client();await f.login(a);const boot=decode(await a.materialsRequest({path:'/materials/api/bootstrap'}));
 const url='/materials/api/assets?'+new URLSearchParams({name:'中'.repeat(200),sourceLabel:'华'.repeat(200)});assert.ok(url.length>2500&&url.length<=4096);
 const response=await a.materialsRequest({path:url,method:'POST',headers:{'content-type':'application/octet-stream','x-xjy-csrf':boot.csrf},bodyBase64:Buffer.from('synthetic-transport-payload').toString('base64')});assert.equal(response.status,200);assert.equal(f.calls,2);
});
test('material raw URLs exceeding 4096 are rejected even when each decoded parameter is within its bound',async t=>{
 const f=await fixture(t),a=f.client();await f.login(a);const base='/materials/api/search?'+new URLSearchParams({q:'中'.repeat(300),category:'华'.repeat(100),availability:'繁'.repeat(40),offset:'0',limit:'1'}),url=base+'&'.repeat(Math.max(1,4097-base.length));assert.ok(url.length>4096);
 assert.equal((await a.materialsRequest({path:url})).status,400);assert.equal(f.calls,0);
});
test('actual image GET denies a downgrade after bridge collection before encrypted wire send',async t=>{
 const imagePath='/materials/api/assets/proof/image',f=await wired(t,{holdAfterEnvelopePath:imagePath}),a=f.client();await f.login(a);
 const pending=a.materialsRequest({path:imagePath}),collected=await f.envelopeEntered.promise;assert.equal(collected.status,200,'actual bridge must finish a successful image before the late downgrade');assert.equal(Buffer.from(collected.bodyBase64,'base64').length,4);
 f.backend.administration.updatePermissions(f.backend.auth.status().user,{staffId:f.users.operate.id,moduleAccess:{sales:'view'}},()=>f.backend.auth.listUsers());f.envelopeRelease.resolve();const response=await pending;assert.equal(response.status,403);assert.doesNotMatch(Buffer.from(response.bodyBase64,'base64').toString('utf8'),/synthetic-internal/);
});
test('actual asset GET denies logout after bridge collection before encrypted wire send',async t=>{
 const assetsPath='/materials/api/assets',f=await wired(t,{holdAfterEnvelopePath:assetsPath}),a=f.client();await f.login(a);
 const pending=a.materialsRequest({path:assetsPath}),collected=await f.envelopeEntered.promise;assert.equal(collected.status,200,'actual bridge must finish a successful list before late logout');assert.match(Buffer.from(collected.bodyBase64,'base64').toString('utf8'),/synthetic-internal/);
 await f.seen.at(-1).context.session.close();f.envelopeRelease.resolve();const response=await pending;assert.equal(response.status,401);assert.doesNotMatch(Buffer.from(response.bodyBase64,'base64').toString('utf8'),/synthetic-internal/);
});
test('only explicit trusted validation preserves a hidden synchronous read finalizer',()=>{
 const fn=()=>{},input=sealed({status:200,headers:{'content-type':'application/json'},bodyBase64:'e30='},fn);
 assert.throws(()=>validateMaterialsOutput(input),e=>e.status===502);const output=validateMaterialsOutput(input,{trustedFinalizer:true});assert.equal(output[readSeal],fn);assert.equal(Object.getOwnPropertyDescriptor(output,readSeal).enumerable,false);assert.equal(Object.isFrozen(output),true);assert.equal(Object.getOwnPropertySymbols(JSON.parse(JSON.stringify(output))).length,0);
 for(const candidate of [
 Object.defineProperty({status:200,headers:{},bodyBase64:''},readSeal,{get(){return fn;}}),
 Object.defineProperty({status:200,headers:{},bodyBase64:''},Symbol('forged'),{value:fn}),
 sealed({status:200,headers:{},bodyBase64:''},async()=>{}),
 sealed({status:200,headers:{},bodyBase64:''},function*(){yield 1;}),
 ])assert.throws(()=>validateMaterialsOutput(candidate,{trustedFinalizer:true}),e=>e.status===502);
});
test('wire clients receive no read-finalizer Symbol while the server executes the trusted finalizer once',async t=>{
 let calls=0;const f=await fixture(t,()=>sealed({status:200,headers:{'content-type':'application/json'},bodyBase64:'e30='},()=>{calls++;})),a=f.client();await f.login(a);const result=await a.materialsRequest({path:'/materials/api/bootstrap'});assert.equal(result.status,200);assert.equal(calls,1);assert.equal(Object.getOwnPropertySymbols(result).length,0);
});
test('a trusted late-read 401 retires the real token before another raw encrypted request',async t=>{
 const f=await fixture(t,()=>sealed({status:200,headers:{'content-type':'application/json'},bodyBase64:'e30='},()=>{throw Object.assign(Error('synthetic late session ended'),{status:401});}));
 const login=await rawRequest(f.server,{id:randomUUID(),timestamp:Date.now(),op:'request',input:{path:'/auth/login',method:'POST',body:{username:'lan_operate',password}}});assert.equal(login.result.status,200);
 const result=await rawRequest(f.server,{id:randomUUID(),timestamp:Date.now(),token:login.token,op:'materials',input:{path:'/materials/api/bootstrap'}});assert.equal(result.result.status,401);assert.equal(result.materials.status,401);
 const status=await rawRequest(f.server,{id:randomUUID(),timestamp:Date.now(),token:login.token,op:'request',input:{path:'/auth/status'}});assert.equal(status.result.status,401);
});
test('Promise-returning read finalizers fail synchronously without publishing the collected body',async t=>{
 const f=await fixture(t,()=>sealed({status:200,headers:{'content-type':'application/json'},bodyBase64:Buffer.from('{"private":"synthetic-only"}').toString('base64')},()=>Promise.resolve())),a=f.client();await f.login(a);
 const response=await a.materialsRequest({path:'/materials/api/bootstrap'});assert.equal(response.status,503);assert.doesNotMatch(Buffer.from(response.bodyBase64,'base64').toString('utf8'),/synthetic-only/);
});
test('write acknowledgements never invoke even a supplied trusted read finalizer',async t=>{
 let calls=0;const f=await fixture(t,(input,context)=>input.method==='GET'?{status:200,headers:{'content-type':'application/json'},bodyBase64:Buffer.from(JSON.stringify({csrf:context.gatewayCsrf})).toString('base64')}:sealed({status:202,headers:{'content-type':'application/json'},bodyBase64:Buffer.from('{"accepted":true,"asset":{"id":"proof"}}').toString('base64')},()=>{calls++;throw Object.assign(Error('must not run after commit'),{status:403});})),a=f.client();await f.login(a);
 const boot=decode(await a.materialsRequest({path:'/materials/api/bootstrap'})),response=await a.materialsRequest({path:'/materials/api/assets/proof/retry',method:'POST',headers:{'x-xjy-csrf':boot.csrf}});assert.equal(response.status,202);assert.equal(decode(response).accepted,true);assert.equal(calls,0);assert.equal(Object.getOwnPropertySymbols(response).length,0);
});
test('local network preserves the trusted seal for the actual native send boundary',async t=>{
 const f=await fixture(t);let calls=0,context;const w=await createNetworkWorkspace({backend:f.backend,configFile:path.join(f.dir,'sealed-local-network.json'),materialsHandler:async(input,ctx)=>{context=ctx;return sealed({status:200,headers:{'content-type':'application/json'},bodyBase64:'e30='},()=>{calls++;if(!ctx.isLive())throw Object.assign(Error('synthetic ended scope'),{status:401});});}});t.after(()=>w.close());
 const envelope=await w.materialsRequest({path:'/materials/api/bootstrap'});assert.equal(envelope.status,200);assert.equal(typeof envelope[readSeal],'function');assert.equal(calls,0);assert.equal(Object.getOwnPropertyDescriptor(envelope,readSeal).enumerable,false);
 await w.withFrozen(async()=>{});assert.equal(context.isLive(),false);assert.throws(()=>envelope[readSeal](),e=>e.status===401);assert.equal(calls,1);
});
test('real encrypted writes ignore async and accessor read seals before response validation',async t=>{
 let kind='async',commits=0,sealCalls=0;
 const f=await fixture(t,(input,context)=>{
  if(input.method==='GET')return{status:200,headers:{'content-type':'application/json'},bodyBase64:Buffer.from(JSON.stringify({csrf:context.gatewayCsrf})).toString('base64')};
  commits++;const output={status:input.method==='PATCH'?200:202,headers:{'content-type':'application/json'},bodyBase64:Buffer.from('{"accepted":true,"asset":{"id":"proof"}}').toString('base64')};
  return Object.defineProperty(output,readSeal,kind==='async'?{value:async()=>{sealCalls++;}}:{get(){sealCalls++;throw Error('write acknowledgement must ignore read metadata');}});
 }),a=f.client();await f.login(a);const boot=decode(await a.materialsRequest({path:'/materials/api/bootstrap'}));
 for(const method of ['POST','PATCH'])for(const type of ['async','accessor'])await t.test(method+' '+type,async()=>{
  kind=type;const before=commits,input={path:'/materials/api/assets/proof'+(method==='POST'?'/retry':''),method,headers:{'x-xjy-csrf':boot.csrf,...(method==='PATCH'?{'content-type':'application/json'}:{})},...(method==='PATCH'?{bodyBase64:Buffer.from('{"tags":["花形"]}').toString('base64')}:{})};
  const output=await a.materialsRequest(input);assert.equal(commits,before+1);assert.equal(output.status,method==='PATCH'?200:202);assert.equal(decode(output).accepted,true);assert.equal(sealCalls,0);assert.equal(Object.getOwnPropertySymbols(output).length,0);
 });
});
test('real local workspace writes ignore async and accessor read seals before response validation',async t=>{
 const f=await fixture(t);let kind='async',commits=0,sealCalls=0;
 const w=await createNetworkWorkspace({backend:f.backend,configFile:path.join(f.dir,'write-seal-network.json'),materialsHandler:async(input,context)=>{
  if(input.method==='GET')return{status:200,headers:{'content-type':'application/json'},bodyBase64:Buffer.from(JSON.stringify({csrf:context.gatewayCsrf})).toString('base64')};
  commits++;const output={status:input.method==='PATCH'?200:202,headers:{'content-type':'application/json'},bodyBase64:Buffer.from('{"accepted":true,"asset":{"id":"proof"}}').toString('base64')};
  return Object.defineProperty(output,readSeal,kind==='async'?{value:async()=>{sealCalls++;}}:{get(){sealCalls++;throw Error('write acknowledgement must ignore read metadata');}});
 }});t.after(()=>w.close());const boot=decode(await w.materialsRequest({path:'/materials/api/bootstrap'}));
 for(const method of ['POST','PATCH'])for(const type of ['async','accessor'])await t.test(method+' '+type,async()=>{
  kind=type;const before=commits,input={path:'/materials/api/assets/proof'+(method==='POST'?'/retry':''),method,headers:{'x-xjy-csrf':boot.csrf,...(method==='PATCH'?{'content-type':'application/json'}:{})},...(method==='PATCH'?{bodyBase64:Buffer.from('{"tags":["花形"]}').toString('base64')}:{})};
  const output=await w.materialsRequest(input);assert.equal(commits,before+1);assert.equal(output.status,method==='PATCH'?200:202);assert.equal(decode(output).accepted,true);assert.equal(sealCalls,0);assert.equal(Object.getOwnPropertySymbols(output).length,0);
 });
});
test('write seal stripping preserves strict rejection of every other unknown output field',()=>{
 assert.equal(typeof stripMaterialsReadFinalizer,'function');let calls=0;
 const source=Object.defineProperty({status:202,headers:{'content-type':'application/json'},bodyBase64:'e30='},readSeal,{get(){calls++;throw Error('must not read write metadata');}}),clean=stripMaterialsReadFinalizer(source);
 assert.notEqual(clean,source);assert.equal(Object.getPrototypeOf(clean),Object.getPrototypeOf(source));assert.equal(Object.hasOwn(source,readSeal),true);assert.equal(Object.hasOwn(clean,readSeal),false);assert.equal(validateMaterialsOutput(clean).status,202);assert.equal(calls,0);
 for(const key of ['unapproved','__proto__',Symbol('unapproved')]){
  const value=Object.defineProperty(Object.defineProperty({status:202,headers:{},bodyBase64:''},readSeal,{get(){calls++;throw Error('must not read write metadata');}}),key,{value:'synthetic-extra',enumerable:false});
  assert.throws(()=>validateMaterialsOutput(stripMaterialsReadFinalizer(value)),error=>error.status===502);assert.equal(calls,0);
 }
 const hostile=Object.defineProperty({status:202,headers:{'set-cookie':'synthetic-only'},bodyBase64:''},readSeal,{value:async()=>{calls++;}});assert.throws(()=>validateMaterialsOutput(stripMaterialsReadFinalizer(hostile)),error=>error.status===502);assert.equal(calls,0);
});

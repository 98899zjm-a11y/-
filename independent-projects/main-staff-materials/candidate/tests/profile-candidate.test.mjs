import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import sharp from '../materials/node_modules/sharp/dist/index.mjs';
const require=createRequire(import.meta.url);
const {createBackend}=require('../project/desktop/backend.cjs');
const {createLanClient}=require('../project/desktop/lan.cjs');
const candidate=path.resolve(import.meta.dirname,'..');
const base=path.join(candidate,'runtime','profile-candidate-tests');
const password='Synthetic-profile-bootstrap-only-pass!';
const classify=async({sha256})=>({sha256,decision:'jewelry',category:'戒指',tags:['简约'],reason:'虚构启动测试'});
await fs.mkdir(base,{recursive:true});
const entry=await import('../start-profile-candidate.mjs');
function api(){assert.equal(typeof entry.startProfileMaterialsCandidate,'function');return entry.startProfileMaterialsCandidate;}
async function makeFixture({database=true}={}){
 const fixtureRoot=await fs.mkdtemp(path.join(base,'profile-'));
 const main=path.join(fixtureRoot,'main-data');
 await fs.mkdir(main);
 const accounts=[['main_admin','admin','manage'],['main_view','employee','view'],['main_operate','employee','operate'],['main_manage','employee','manage']].map(([username,role,level])=>({username,role,level,name:'虚构启动员工',password}));
 if(database){
  const backend=createBackend({dataDir:main,migrationDir:path.join(candidate,'project/desktop/migrations')});
  try{
   backend.auth.setup(accounts[0]);
   const owner=backend.auth.status().user;
   for(const account of accounts.slice(1)){
    const user=backend.auth.createUser(account);
    backend.administration.updatePermissions(owner,{staffId:user.id,moduleAccess:{sales:account.level}},()=>backend.auth.listUsers());
   }
   backend.auth.logout();
  }finally{await backend.close();}
 }
 await fs.writeFile(path.join(main,'synthetic-candidate.json'),JSON.stringify({kind:'xjy-main-materials-synthetic-candidate-v1',synthetic:true}),{flag:'wx'});
 await fs.writeFile(path.join(fixtureRoot,'main-candidate-accounts.json'),JSON.stringify(accounts),{flag:'wx',mode:0o600});
 return {fixtureRoot,main,accounts};
}
function httpRequest({port,path:urlPath,method='GET',headers={},body}={}){
 return new Promise((resolve,reject)=>{
  const payload=body===undefined?null:Buffer.isBuffer(body)?body:Buffer.from(typeof body==='string'?body:JSON.stringify(body));
  const requestHeaders={...headers};
  if(payload)requestHeaders['content-length']=payload.length;
  const request=http.request({host:'127.0.0.1',port,path:urlPath,method,headers:requestHeaders},response=>{
   const chunks=[];
   response.on('data',chunk=>chunks.push(chunk));
   response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,body:Buffer.concat(chunks)}));
  });
  request.setTimeout(5000,()=>request.destroy(Error('HTTP超时')));
  request.on('error',reject);
  if(payload)request.write(payload);
  request.end();
 });
}
function browser(origin){
 const cookies=new Map();
 let csrf='';
 return {
  get csrf(){return csrf;},
  async request(url,{method='GET',json,bytes,headers={},materialToken}={}){
   const requestHeaders={...headers};
   if(cookies.size)requestHeaders.cookie=[...cookies].map(([key,value])=>key+'='+value).join('; ');
   if(method!=='GET'){requestHeaders.origin=origin;requestHeaders['x-xjy-csrf']=csrf;}
   if(materialToken!==undefined)requestHeaders['x-csrf-token']=materialToken;
   if(json!==undefined)requestHeaders['content-type']='application/json';
   if(bytes)requestHeaders['content-type']='application/octet-stream';
   const response=await fetch(origin+url,{method,headers:requestHeaders,...(json!==undefined?{body:JSON.stringify(json)}:bytes?{body:bytes}:{})});
   for(const item of response.headers.getSetCookie()){const [key,value]=item.split(';')[0].split('=');cookies.set(key,value);}
   const buffer=Buffer.from(await response.arrayBuffer());
   let data;
   try{data=JSON.parse(buffer);}catch{}
   if(data&&typeof data.csrf==='string')csrf=data.csrf;
   return {status:response.status,data,bytes:buffer,headers:response.headers};
  },
  async login(username,pwd){
   await this.request('/session');
   const result=await this.request('/auth/login',{method:'POST',json:{username,password:pwd}});
   return result;
  },
  bootstrap(){return this.request('/materials/api/bootstrap');}
 };
}
async function settle(promise,timeout,message){
 let timer;
 try{await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(message)),timeout);})]);}
 finally{clearTimeout(timer);}
}
test('profile candidate exposes trusted startup and nonce stop',()=>{
 assert.equal(typeof entry.startProfileMaterialsCandidate,'function');
 assert.equal(typeof entry.requestProfileCandidateStop,'function');
});
test('ephemeral ports require a bounded fixture',{timeout:20000},async()=>{
 await assert.rejects(api()({port:0,lanPort:0,classify}));
 for(const fixtureRoot of ['relative','F:/unapproved','C:/unapproved',path.join(candidate,'runtime')])await assert.rejects(api()({port:0,lanPort:0,fixtureRoot,classify}));
});
test('unknown port overrides are rejected before profile data opens',{timeout:20000},async()=>{
 const {fixtureRoot}=await makeFixture();
 for(const options of [{port:31831,lanPort:0},{port:0,lanPort:31831},{port:21964,lanPort:0},{port:0,lanPort:21967}])await assert.rejects(api()({...options,fixtureRoot,classify}));
 await assert.rejects(fs.stat(path.join(fixtureRoot,'profile-materials-candidate')),{code:'ENOENT'});
});
test('missing business database is refused without creating a blank one',{timeout:20000},async()=>{
 const {fixtureRoot,main}=await makeFixture({database:false});
 await assert.rejects(api()({port:0,lanPort:0,fixtureRoot,classify}));
 await assert.rejects(fs.stat(path.join(main,'jewelry.sqlite')),{code:'ENOENT'});
});
test('missing synthetic main marker retains the existing database',{timeout:20000},async()=>{
 const {fixtureRoot,main}=await makeFixture();
 const file=path.join(main,'jewelry.sqlite');
 const before=await fs.readFile(file);
 await fs.rename(path.join(main,'synthetic-candidate.json'),path.join(fixtureRoot,'retained-marker.json'));
 await assert.rejects(api()({port:0,lanPort:0,fixtureRoot,classify}));
 assert.deepEqual(await fs.readFile(file),before);
});
test('hardlinked private account file is refused',{timeout:20000},async()=>{
 const {fixtureRoot}=await makeFixture();
 await fs.link(path.join(fixtureRoot,'main-candidate-accounts.json'),path.join(fixtureRoot,'main-candidate-accounts-hardlink.json'));
 await assert.rejects(api()({port:0,lanPort:0,fixtureRoot,classify}));
});
test('junction fixture alias is refused',{timeout:20000},async t=>{
 const {fixtureRoot}=await makeFixture();
 let alias=null;
 t.after(async()=>{if(alias)await fs.unlink(alias).catch(()=>{});});
 try{alias=path.join(base,'alias-'+randomUUID());await fs.symlink(fixtureRoot,alias,'junction');}
 catch(error){if(['EPERM','EACCES','ENOTSUP'].includes(error.code)){t.skip('junction creation is unavailable');return;}throw error;}
 await assert.rejects(api()({port:0,lanPort:0,fixtureRoot:alias,classify}));
});
test('real fixtures share HTTP and LAN materials, then nonce stop retires old sessions',{timeout:30000},async t=>{
 const {fixtureRoot,main}=await makeFixture();
 let app=null;
 let lan=null;
 t.after(async()=>{
  if(lan)await lan.close().catch(()=>{});
  if(app)await app.close().catch(()=>{});
 });
 app=await api()({port:0,lanPort:0,fixtureRoot,classify});
 assert.ok(Object.isFrozen(app));
 const origin=new URL(app.origin);
 assert.equal(origin.hostname,'127.0.0.1');
 assert.ok(Number(origin.port)>0);
 assert.ok(Number.isInteger(app.lanPort)&&app.lanPort>0);
 assert.equal(app.profileRoot,path.join(fixtureRoot,'profile-materials-candidate','销售素材'));
 assert.equal(app.backend.auth.status().authenticated,false);
 assert.equal(app.backend.auth.status().needsSetup,false);
 assert.equal(app.instance.pid,process.pid);
 assert.equal(app.instance.kind,'xjy-profile-materials-candidate-v1');
 assert.equal(typeof app.instance.nonce,'string');
 assert.equal(app.instance.nonce.length,36);
 assert.equal(app.instance.productionConnected,false);
 assert.equal(app.instance.mainSystemSession,true);
 assert.equal(typeof app.instance.sourceHashes,'object');
 const instanceText=await fs.readFile(app.instanceFile,'utf8');
 assert.equal(instanceText.includes(password),false);
 assert.equal(instanceText.includes('privateKey'),false);
 assert.equal(instanceText.includes('password'),false);
 assert.equal(instanceText.includes('code'),false);
 assert.equal(instanceText.includes('pin'),false);
 const marker=JSON.parse(await fs.readFile(path.join(fixtureRoot,'profile-materials-candidate','synthetic-profile-candidate.json'),'utf8'));
 assert.equal(marker.kind,'xjy-profile-materials-synthetic-candidate-v1');
 assert.equal(marker.version,1);
 assert.equal(marker.synthetic,true);
 assert.equal(marker.mainDataRoot,path.resolve(main));
 assert.equal(marker.profileRoot,app.profileRoot);
 await assert.rejects(fs.stat(path.join(app.profileRoot,'synthetic-profile-candidate.json')),{code:'ENOENT'});
 const connection=JSON.parse(await fs.readFile(app.connectionFile,'utf8'));
 assert.equal(connection.host,'127.0.0.1');
 assert.equal(connection.port,app.lanPort);
 assert.equal(typeof connection.code,'string');
 assert.equal(connection.code.length,32);
 assert.equal(connection.privateKey,undefined);
 assert.equal(connection.pin,undefined);
 const client=browser(app.origin);
 const login=await client.login('main_admin',password);
 assert.equal(login.status,200);
 assert.ok(client.csrf.length>0);
 const boot=await client.bootstrap();
 assert.equal(boot.status,200);
 assert.equal(typeof boot.data.csrfToken,'string');
 const image=await sharp({create:{width:18,height:18,channels:3,background:'#bbb'}}).jpeg().toBuffer();
 const upload=await client.request('/materials/api/assets?name=profile-candidate.jpg',{method:'POST',bytes:image,materialToken:boot.data.csrfToken});
 assert.equal(upload.status,202);
 lan=createLanClient({host:'127.0.0.1',port:connection.port,code:connection.code});
 const lanLogin=await lan.dispatch({path:'/auth/login',method:'POST',body:{username:'main_operate',password}});
 assert.equal(lanLogin.status,200);
 const lanBoot=await lan.materialsRequest({path:'/materials/api/bootstrap',method:'GET'});
 assert.equal(lanBoot.status,200);
 const lanAssets=await lan.materialsRequest({path:'/materials/api/assets',method:'GET'});
 assert.equal(lanAssets.status,200);
 const decoded=JSON.parse(Buffer.from(lanAssets.bodyBase64,'base64').toString('utf8'));
 assert.ok(Array.isArray(decoded.assets));
 assert.ok(decoded.assets.length>=1);
 await assert.rejects(entry.requestProfileCandidateStop({fixtureRoot,nonce:'00000000-0000-4000-8000-000000000000'}));
 const still=JSON.parse(await fs.readFile(app.instanceFile,'utf8'));
 assert.equal(still.state,'ready');
 const receipt=await entry.requestProfileCandidateStop({fixtureRoot,nonce:app.instance.nonce});
 assert.equal(receipt.accepted,true);
 await settle(app.stopped,8000,'owned nonce stop did not drain');
 let lanDenied=false;
 try{const response=await lan.materialsRequest({path:'/materials/api/bootstrap',method:'GET'});lanDenied=response.status>=400;}catch{lanDenied=true;}
 assert.equal(lanDenied,true);
 let httpDenied=false;
 try{const response=await client.bootstrap();httpDenied=response.status>=400;}catch{httpDenied=true;}
 assert.equal(httpDenied,true);
 await app.close();
 await app.close();
 await app.stopped;
 const final=JSON.parse(await fs.readFile(app.instanceFile,'utf8'));
 assert.equal(final.state,'closed');
 assert.equal(final.nonce,app.instance.nonce);
 assert.equal(app.instance.state,'closed');
});
test('prototype bind failure releases only this startup listener and leaves the occupier',{timeout:20000},async()=>{
 const fixtureRoot=await fs.mkdtemp(path.join(base,'bind-'));
 const originalHttpListen=http.Server.prototype.listen;
 const hadOwnHttpListen=Object.hasOwn(http.Server.prototype,'listen');
 const originalNetListen=net.Server.prototype.listen;
 let startupHttp=null;
 let blocker=null;
 let injected=false;
 http.Server.prototype.listen=function(...args){
  if(!startupHttp)startupHttp=this;
  return originalHttpListen.apply(this,args);
 };
 net.Server.prototype.listen=function(...args){
  if(!injected&&!(this instanceof http.Server)&&args[0]&&typeof args[0]==='object'&&args[0].port===0&&args[0].host==='127.0.0.1'){
   injected=true;
   const target=this;
   blocker=net.createServer();
   originalNetListen.call(blocker,{port:0,host:'127.0.0.1',exclusive:true},()=>{
    const held=blocker.address().port;
    originalNetListen.call(target,{port:held,host:'127.0.0.1',exclusive:true});
   });
   return this;
  }
  return originalNetListen.apply(this,args);
 };
 try{
  await assert.rejects(api()({port:0,lanPort:0,fixtureRoot,classify}));
  assert.equal(injected,true);
  assert.ok(startupHttp);
  assert.equal(startupHttp.listening,false);
  assert.equal(blocker.listening,true);
 }finally{
  if(hadOwnHttpListen)http.Server.prototype.listen=originalHttpListen;else delete http.Server.prototype.listen;
  net.Server.prototype.listen=originalNetListen;
  if(blocker&&blocker.listening)await new Promise(resolve=>blocker.close(()=>resolve()));
 }
});
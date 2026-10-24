import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {createRequire} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
const require=createRequire(import.meta.url),{createBackend}=require('../project/desktop/backend.cjs');
const candidate=path.resolve(import.meta.dirname,'..'),base=path.join(candidate,'runtime','profile-candidate-tests');
const entry=await import('../start-profile-candidate.mjs').catch(error=>({loadError:error}));
await fs.mkdir(base,{recursive:true});
const password='Synthetic-profile-bootstrap-failure-only!';
async function fixture(){
 const fixtureRoot=await fs.mkdtemp(path.join(base,'failure-')),main=path.join(fixtureRoot,'main-data'),backend=createBackend({dataDir:main,migrationDir:path.join(candidate,'project/desktop/migrations')});
 const accounts=[['main_admin','admin','manage'],['main_view','employee','view'],['main_operate','employee','operate'],['main_manage','employee','manage']].map(([username,role,level])=>({username,role,level,name:'虚构启动故障员工',password}));
 try{backend.auth.setup(accounts[0]);for(const account of accounts.slice(1)){const user=backend.auth.createUser(account);backend.administration.updatePermissions(backend.auth.status().user,{staffId:user.id,moduleAccess:{sales:account.level}},()=>backend.auth.listUsers());}backend.auth.logout();}finally{await backend.close();}
 await fs.writeFile(path.join(main,'synthetic-candidate.json'),JSON.stringify({kind:'xjy-main-materials-synthetic-candidate-v1',synthetic:true}),{flag:'wx'});await fs.writeFile(path.join(fixtureRoot,'main-candidate-accounts.json'),JSON.stringify(accounts),{flag:'wx',mode:0o600});return{fixtureRoot,main};
}
const listen=server=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen({host:'127.0.0.1',port:0,exclusive:true},()=>resolve(server.address().port));});
const close=server=>new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
async function sentinel(port){return new Promise((resolve,reject)=>{const socket=net.connect({host:'127.0.0.1',port},()=>{});let text='';socket.on('data',part=>text+=part);socket.on('end',()=>resolve(text));socket.on('error',reject);});}
for(const bindNumber of [1,2,3])test('real bind failure '+bindNumber+' cleans only the new candidate and retains the existing listener',async t=>{
 assert.equal(typeof entry.startProfileMaterialsCandidate,'function','profile startup API missing');
 const {fixtureRoot,main}=await fixture(),blocker=net.createServer(socket=>socket.end('synthetic existing listener'));const blockerPort=await listen(blocker);t.after(()=>close(blocker));
 const originalListen=net.Server.prototype.listen,owned=[],ports=[];let calls=0,injected=false,opened,error;
 net.Server.prototype.listen=function(...args){
  const options=args[0],isTarget=typeof options==='object'&&options!==null&&options.host==='127.0.0.1'||typeof options==='number'&&args[1]==='127.0.0.1';
  if(isTarget){calls++;owned.push(this);this.once('listening',()=>ports.push(this.address().port));if(calls===bindNumber){injected=true;if(typeof options==='object')args[0]={...options,port:blockerPort};else args[0]=blockerPort;}}
  return originalListen.apply(this,args);
 };
 try{opened=await entry.startProfileMaterialsCandidate({port:0,lanPort:0,fixtureRoot,classify:async({sha256})=>({sha256,decision:'uncertain',category:'戒指',tags:[],reason:'虚构故障'})});}catch(value){error=value;}finally{net.Server.prototype.listen=originalListen;}
 t.after(()=>opened?.close());assert.equal(injected,true,'the requested real socket collision must occur');assert.ok(error,'candidate must fail rather than reuse the occupied listener');assert.equal(await sentinel(blockerPort),'synthetic existing listener');
 for(const server of owned)assert.equal(server.listening,false,'all candidate-owned reservations/listeners must be closed');
 for(const port of new Set(ports)){const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen({host:'127.0.0.1',port,exclusive:true},resolve);});await close(probe);}
 if(bindNumber<=2)await assert.rejects(fs.stat(path.join(fixtureRoot,'profile-materials-candidate')),{code:'ENOENT'});
 const db=new DatabaseSync(path.join(main,'jewelry.sqlite'),{readOnly:true,allowExtension:false});try{assert.equal(db.prepare('SELECT COUNT(*) AS n FROM usage_sessions WHERE ended_at IS NULL').get().n,0,'temporary root administrator must not retain a live usage session');}finally{db.close();}
 if(bindNumber===3){const retried=await entry.startProfileMaterialsCandidate({port:0,lanPort:0,fixtureRoot,classify:async({sha256})=>({sha256,decision:'uncertain',category:'戒指',tags:[],reason:'虚构重试'})});await retried.close();await retried.stopped;}
 console.log(JSON.stringify({bindNumber,injected,ownedListenersClosed:owned.every(server=>!server.listening),existingListenerRetained:true,rootAdminUsageEnded:true}));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {createRequire,syncBuiltinESMExports} from 'node:module';
import {pathToFileURL} from 'node:url';
import * as entry from '../start-profile-candidate.mjs';
const require=createRequire(import.meta.url),{createBackend}=require('../project/desktop/backend.cjs'),children=require('node:child_process'),promises=require('node:fs/promises');
const candidate=path.resolve(import.meta.dirname,'..'),base=path.join(candidate,'runtime/profile-candidate-tests'),entryFile=path.join(candidate,'start-profile-candidate.mjs'),password='Synthetic-launch-ownership-only-pass!';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function bounded(promise,ms,fallback){let timer;try{return await Promise.race([promise,new Promise(resolve=>{timer=setTimeout(()=>resolve(fallback),ms);})]);}finally{clearTimeout(timer);}}
function api(){assert.equal(typeof entry.launchProfileMaterialsCandidate,'function','bounded private-IPC fixture launcher API must exist');return entry.launchProfileMaterialsCandidate;}
async function fixture(){const fixtureRoot=await fs.mkdtemp(path.join(base,'launch-')),main=path.join(fixtureRoot,'main-data'),backend=createBackend({dataDir:main,migrationDir:path.join(candidate,'project/desktop/migrations')});const accounts=[['main_admin','admin','manage'],['main_view','employee','view'],['main_operate','employee','operate'],['main_manage','employee','manage']].map(([username,role,level])=>({username,role,level,name:'虚构启动归属员工',password}));try{backend.auth.setup(accounts[0]);for(const account of accounts.slice(1)){const user=backend.auth.createUser(account);backend.administration.updatePermissions(backend.auth.status().user,{staffId:user.id,moduleAccess:{sales:account.level}},()=>backend.auth.listUsers());}backend.auth.logout();}finally{await backend.close();}await fs.writeFile(path.join(main,'synthetic-candidate.json'),JSON.stringify({kind:'xjy-main-materials-synthetic-candidate-v1',synthetic:true}),{flag:'wx'});await fs.writeFile(path.join(fixtureRoot,'main-candidate-accounts.json'),JSON.stringify(accounts),{flag:'wx',mode:0o600});await fs.mkdir(path.join(fixtureRoot,'tmp'));return fixtureRoot;}
function alive(pid){if(!Number.isSafeInteger(pid)||pid<=0)return false;try{process.kill(pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;throw error;}} // Signal 0 is a read-only liveness probe; no terminating signal is sent.
async function gone(pid,timeout=10000){const end=Date.now()+timeout;while(alive(pid)&&Date.now()<end)await delay(50);assert.equal(alive(pid),false,'the exact fixture-owned child must exit normally');}
async function stopOwn(fixtureRoot,pid){try{const record=JSON.parse(await fs.readFile(path.join(fixtureRoot,'profile-materials-candidate/instance.json'),'utf8'));if(record.pid===pid&&record.state!=='closed'&&record.state!=='close_failed')await entry.requestProfileCandidateStop({fixtureRoot,nonce:record.nonce});}catch{}if(pid)await gone(pid);}
async function controller(fixtureRoot,stage){
 const file=path.join(fixtureRoot,'controller.mjs'),module=pathToFileURL(entryFile).href;
 const hook=stage==='spawn'?`afterSpawn:snapshot=>new Promise(()=>{process.send({pid:snapshot.pid,stage:'spawn'},()=>process.exit(0));})`:stage==='ready'?`beforeAdopt:snapshot=>new Promise(()=>{process.send({pid:snapshot.pid,stage:'ready'},()=>process.exit(0));})`:'';
 const source=`import {launchProfileMaterialsCandidate} from ${JSON.stringify(module)};\ntry{const result=await launchProfileMaterialsCandidate({fixtureRoot:${JSON.stringify(fixtureRoot)},open:false,readyTimeoutMs:10000,leaseMs:10000,${hook}});process.send({pid:result.pid,origin:result.origin,stage:'adopted'},()=>process.exit(0));}catch(error){process.send({failed:true,message:String(error?.message||'controller failed')},()=>process.exit(1));}\n`;
 await fs.writeFile(file,source,{flag:'wx'});
 const child=children.spawn(process.execPath,[file],{cwd:candidate,env:{...process.env,TEMP:path.join(fixtureRoot,'tmp'),TMP:path.join(fixtureRoot,'tmp')},windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
 let message=null;child.on('message',value=>{message=value;});child.stdout.on('data',()=>{});child.stderr.on('data',()=>{});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('fixture controller did not exit')),15000);child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error('fixture controller rejected launch'));});});
 assert.ok(message&&Number.isSafeInteger(message.pid)&&message.pid>0,'controller must report only its exact owned child PID');return message;
}
test('bounded fixture launcher API is available without adding CLI path overrides',()=>{assert.equal(typeof entry.launchProfileMaterialsCandidate,'function');});
for(const stage of ['spawn','ready'])test('private child closes normally when its parent exits at '+stage+' before adopt',{timeout:20000},async()=>{
 api();const fixtureRoot=await fixture(),message=await controller(fixtureRoot,stage);await gone(message.pid);
 let record;try{record=JSON.parse(await fs.readFile(path.join(fixtureRoot,'profile-materials-candidate/instance.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
 if(record)assert.equal(record.state,'closed');console.log(JSON.stringify({parentExitStage:stage,ownedChildExited:true,instanceCreated:!!record,terminatingSignalsSent:0}));
});
test('ready but unadopted private child lease expires and is normally reclaimed',{timeout:20000},async t=>{
 const launch=api(),fixtureRoot=await fixture();let pid,ready=false;t.after(()=>stopOwn(fixtureRoot,pid));
 await assert.rejects(launch({fixtureRoot,open:false,readyTimeoutMs:10000,leaseMs:2000,afterSpawn:snapshot=>{pid=snapshot.pid;},beforeAdopt:async()=>{ready=true;await delay(4000);}}));
 assert.equal(ready,true);await gone(pid);console.log(JSON.stringify({readyBeforeLeaseExpiry:true,adopted:false,ownedChildExited:true,terminatingSignalsSent:0}));
});
test('fixture afterSpawn wait is bounded by the owned child exit rather than an unending callback',{timeout:15000},async t=>{
 const launch=api(),fixtureRoot=await fixture();let pid;t.after(()=>stopOwn(fixtureRoot,pid));
 const pending=launch({fixtureRoot,open:false,readyTimeoutMs:2000,leaseMs:1000,afterSpawn:snapshot=>{pid=snapshot.pid;return new Promise(()=>{});}}).then(()=>({status:'fulfilled'}),()=>({status:'rejected'}));
 const result=await bounded(pending,5000,{status:'still-pending'});if(pid)await gone(pid);
 console.log(JSON.stringify({afterSpawnOutcome:result.status,ownedChildExited:true,terminatingSignalsSent:0}));assert.equal(result.status,'rejected','lease/child exit must bound the fixture hook wait');
});
test('selected source drift after spawning reclaims only the owned fixture child',{timeout:20000},async t=>{
 const launch=api(),fixtureRoot=await fixture(),read=promises.readFile;let active=false,injected=false,pid;t.after(()=>stopOwn(fixtureRoot,pid));
 promises.readFile=async function(file,...args){if(active&&typeof file==='string'&&path.resolve(file)===entryFile){injected=true;return Buffer.from('synthetic selected-source fingerprint drift');}return read.call(this,file,...args);};syncBuiltinESMExports();
 try{await assert.rejects(launch({fixtureRoot,open:false,readyTimeoutMs:10000,leaseMs:10000,afterSpawn:snapshot=>{pid=snapshot.pid;active=true;}}));}finally{promises.readFile=read;syncBuiltinESMExports();}
 assert.equal(injected,true);await gone(pid);console.log(JSON.stringify({selectedSourceDriftDetected:true,ownedChildExited:true,terminatingSignalsSent:0}));
});
for(const mode of ['error','no-response'])test('opener '+mode+' never reports an opened page and normally reclaims the unadopted child',{timeout:20000},async t=>{
 const launch=api(),fixtureRoot=await fixture(),spawn=children.spawn,lstat=promises.lstat;let pid,attempts=0;t.after(()=>stopOwn(fixtureRoot,pid));
 promises.lstat=async function(file,...args){if(path.basename(String(file)).toLowerCase()==='rundll32.exe')return{isSymbolicLink:()=>false,isFile:()=>true};return lstat.call(this,file,...args);};
 children.spawn=function(file,...args){if(path.basename(String(file)).toLowerCase()==='rundll32.exe'){attempts++;const fake=new EventEmitter();fake.unref=()=>{};if(mode==='error')queueMicrotask(()=>fake.emit('error',Error('synthetic URL handler start failure')));else fake.pid=999999;return fake;}return spawn.call(this,file,...args);};syncBuiltinESMExports();
 try{await assert.rejects(launch({fixtureRoot,open:true,readyTimeoutMs:10000,leaseMs:10000,openerTimeoutMs:100,afterSpawn:snapshot=>{pid=snapshot.pid;}}));}finally{children.spawn=spawn;promises.lstat=lstat;syncBuiltinESMExports();}
 assert.equal(attempts,1);await gone(pid);console.log(JSON.stringify({openerMode:mode,openedClaim:false,ownedChildExited:true,terminatingSignalsSent:0}));
});
test('adopted child survives its parent exit and later honors its own nonce stop',{timeout:20000},async t=>{
 api();const fixtureRoot=await fixture(),message=await controller(fixtureRoot,'adopted');t.after(()=>stopOwn(fixtureRoot,message.pid));
 assert.equal(alive(message.pid),true);const response=await fetch(message.origin+'/session',{signal:AbortSignal.timeout(3000)});assert.equal(response.status,200);await response.arrayBuffer();
 const file=path.join(fixtureRoot,'profile-materials-candidate/instance.json'),record=JSON.parse(await fs.readFile(file,'utf8'));assert.equal(record.pid,message.pid);assert.equal(record.state,'ready');await entry.requestProfileCandidateStop({fixtureRoot,nonce:record.nonce});await gone(message.pid);assert.equal(JSON.parse(await fs.readFile(file,'utf8')).state,'closed');console.log(JSON.stringify({adoptedSurvivedParentExit:true,httpSessionStatus:200,nonceStopClosed:true,terminatingSignalsSent:0}));
});

for(const suppressSpawn of [false,true])test('N2 real waiting OS helper '+(suppressSpawn?'with intentionally suppressed event releases its launcher handle':'still emits spawn independently of its body'),{timeout:20000},async t=>{
 const launch=api(),fixtureRoot=await fixture(),spawn=children.spawn,lstat=promises.lstat;let candidatePid,helper,unrefCalled=false,eventSuppressed=false,result,error;
 t.after(()=>stopOwn(fixtureRoot,candidatePid));
 promises.lstat=async function(file,...args){if(path.basename(String(file)).toLowerCase()==='rundll32.exe')return{isSymbolicLink:()=>false,isFile:()=>true};return lstat.call(this,file,...args);};
 children.spawn=function(file,...args){if(path.basename(String(file)).toLowerCase()==='rundll32.exe'){
  helper=spawn.call(this,process.execPath,['-e','process.stdin.on("end",()=>process.exit(0));process.stdin.resume();'],{cwd:candidate,env:{...process.env,TEMP:path.join(fixtureRoot,'tmp'),TMP:path.join(fixtureRoot,'tmp')},windowsHide:true,stdio:['pipe','ignore','ignore']});
  const unref=helper.unref;helper.unref=function(){unrefCalled=true;return unref.call(this);};
  if(suppressSpawn){const emit=helper.emit;helper.emit=function(event,...values){if(event==='spawn'){eventSuppressed=true;return false;}return emit.call(this,event,...values);};}
  return helper;
 }return spawn.call(this,file,...args);};syncBuiltinESMExports();
 try{try{result=await launch({fixtureRoot,open:true,readyTimeoutMs:10000,leaseMs:10000,openerTimeoutMs:100,afterSpawn:snapshot=>{candidatePid=snapshot.pid;}});}catch(value){error=value;}
  assert.ok(helper);assert.equal(helper.exitCode,null,'the benign helper body intentionally waits for stdin');
  console.log(JSON.stringify({realOSHelperBodyWaiting:true,spawnEventIntentionallySuppressed:suppressSpawn,eventSuppressed,openRequested:result?.openRequested===true,launchRejected:!!error,helperHandleUnreferenced:unrefCalled,terminatingSignalsSent:0}));
  if(suppressSpawn){assert.ok(error);assert.equal(eventSuppressed,true);assert.equal(unrefCalled,true,'a missing-event fault must not keep the launcher ChildProcess handle referenced');}
  else{assert.equal(error,undefined);assert.equal(result.openRequested,true);assert.equal(Object.hasOwn(result,'opened'),false);assert.equal(unrefCalled,true);}
 }finally{children.spawn=spawn;promises.lstat=lstat;syncBuiltinESMExports();if(helper){const ended=new Promise(resolve=>helper.once('exit',resolve));helper.stdin.end();await bounded(ended,3000,false);}await stopOwn(fixtureRoot,candidatePid);}
});

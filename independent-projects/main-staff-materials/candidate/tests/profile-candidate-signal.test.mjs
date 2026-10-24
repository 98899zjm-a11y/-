import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {requestProfileCandidateStop} from '../start-profile-candidate.mjs';
const require=createRequire(import.meta.url),{createBackend}=require('../project/desktop/backend.cjs');
const candidate=path.resolve(import.meta.dirname,'..'),base=path.join(candidate,'runtime/profile-candidate-tests'),password='Synthetic-startup-signal-only-pass!';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function bounded(promise,ms,fallback){let timer;try{return await Promise.race([promise,new Promise(resolve=>{timer=setTimeout(()=>resolve(fallback),ms);})]);}finally{clearTimeout(timer);}}
async function fixture(){const fixtureRoot=await fs.mkdtemp(path.join(base,'signal-')),main=path.join(fixtureRoot,'main-data'),backend=createBackend({dataDir:main,migrationDir:path.join(candidate,'project/desktop/migrations')});const accounts=[['main_admin','admin','manage'],['main_view','employee','view'],['main_operate','employee','operate'],['main_manage','employee','manage']].map(([username,role,level])=>({username,role,level,name:'虚构启动事件员工',password}));try{backend.auth.setup(accounts[0]);for(const account of accounts.slice(1)){const user=backend.auth.createUser(account);backend.administration.updatePermissions(backend.auth.status().user,{staffId:user.id,moduleAccess:{sales:account.level}},()=>backend.auth.listUsers());}backend.auth.logout();}finally{await backend.close();}await fs.writeFile(path.join(main,'synthetic-candidate.json'),JSON.stringify({kind:'xjy-main-materials-synthetic-candidate-v1',synthetic:true}),{flag:'wx'});await fs.writeFile(path.join(fixtureRoot,'main-candidate-accounts.json'),JSON.stringify(accounts),{flag:'wx',mode:0o600});await fs.mkdir(path.join(fixtureRoot,'tmp'));return fixtureRoot;}
test('N1 the actual startup signal handler defers final shutdown until its app exists',{timeout:20000},async()=>{
 const fixtureRoot=await fixture(),preload=path.join(fixtureRoot,'emit-startup-event.cjs'),nonce=randomUUID(),instanceFile=path.join(fixtureRoot,'profile-materials-candidate/instance.json');
 await fs.writeFile(preload,"const once=process.once;let fired=false;process.once=function(name,listener){const result=once.call(this,name,listener);if(name==='SIGINT'&&!fired){fired=true;queueMicrotask(()=>{if(process.connected)process.send({probe:'startup-handler-event'});process.emit('SIGINT');});}return result;};\n",{flag:'wx'});
 const child=spawn(process.execPath,['--require',preload,path.join(candidate,'start-profile-candidate.mjs'),'--owned-child'],{cwd:candidate,env:{...process.env,TEMP:path.join(fixtureRoot,'tmp'),TMP:path.join(fixtureRoot,'tmp')},windowsHide:true,detached:true,stdio:['ignore','pipe','pipe','ipc']});
 let observed=false,stoppedMessage=false;child.on('message',message=>{if(message?.probe==='startup-handler-event')observed=true;if(message?.nonce===nonce&&message.type==='stopped')stoppedMessage=true;});child.stdout.on('data',()=>{});child.stderr.on('data',()=>{});child.on('error',()=>{});
 const exited=new Promise(resolve=>child.once('exit',()=>resolve(true)));child.send({type:'init',nonce,fixtureRoot,leaseMs:10000});
 let exitedBeforeCleanup=false,record=null;
 try{exitedBeforeCleanup=await bounded(exited,3000,false);try{record=JSON.parse(await fs.readFile(instanceFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  console.log(JSON.stringify({startupHandlerInvoked:observed,stoppedMessage,childExitedBeforeTestCleanup:exitedBeforeCleanup,instanceState:record?.state,terminatingSignalsSent:0}));
  assert.equal(observed,true);assert.equal(exitedBeforeCleanup,true,'app-null shutdown cannot leave a later startup listening');if(record)assert.equal(record.state,'closed');
 }finally{if(child.exitCode===null){try{const current=JSON.parse(await fs.readFile(instanceFile,'utf8'));if(current.pid===child.pid&&current.state==='ready')await requestProfileCandidateStop({fixtureRoot,nonce:current.nonce});}catch{}await bounded(exited,6000,false);}try{if(child.connected)child.disconnect();}catch{}}
});

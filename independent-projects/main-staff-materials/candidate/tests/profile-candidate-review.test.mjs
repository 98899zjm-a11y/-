import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import {createHash} from 'node:crypto';
import nativeFs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createRequire,syncBuiltinESMExports} from 'node:module';
import {startProfileMaterialsCandidate,requestProfileCandidateStop} from '../start-profile-candidate.mjs';
const require=createRequire(import.meta.url),{createBackend}=require('../project/desktop/backend.cjs');
const promises=require('node:fs/promises');
const candidate=path.resolve(import.meta.dirname,'..'),base=path.join(candidate,'runtime/profile-candidate-tests'),password='Synthetic-bootstrap-review-only-pass!';
const classify=async({sha256})=>({sha256,decision:'uncertain',category:'戒指',tags:[],reason:'虚构启动复查'});
async function fixture(){const fixtureRoot=await fs.mkdtemp(path.join(base,'review-')),main=path.join(fixtureRoot,'main-data'),backend=createBackend({dataDir:main,migrationDir:path.join(candidate,'project/desktop/migrations')});const accounts=[['main_admin','admin','manage'],['main_view','employee','view'],['main_operate','employee','operate'],['main_manage','employee','manage']].map(([username,role,level])=>({username,role,level,name:'虚构启动复查员工',password}));try{backend.auth.setup(accounts[0]);for(const account of accounts.slice(1)){const user=backend.auth.createUser(account);backend.administration.updatePermissions(backend.auth.status().user,{staffId:user.id,moduleAccess:{sales:account.level}},()=>backend.auth.listUsers());}backend.auth.logout();}finally{await backend.close();}await fs.writeFile(path.join(main,'synthetic-candidate.json'),JSON.stringify({kind:'xjy-main-materials-synthetic-candidate-v1',synthetic:true}),{flag:'wx'});await fs.writeFile(path.join(fixtureRoot,'main-candidate-accounts.json'),JSON.stringify(accounts),{flag:'wx',mode:0o600});return fixtureRoot;}
async function start(fixtureRoot,capture){const listen=net.Server.prototype.listen;net.Server.prototype.listen=function(...args){const value=args[0],port=typeof value==='object'?value.port:value,host=typeof value==='object'?value.host:args[1];if(host!=='127.0.0.1'||!Number.isInteger(port)||[21965,21966,31831].includes(port))throw Error('fixture fixed/non-loopback bind rejected before OS call');capture?.(this);return listen.apply(this,args);};try{return await startProfileMaterialsCandidate({port:0,lanPort:0,fixtureRoot,classify});}finally{net.Server.prototype.listen=listen;}}
async function acceptsConnection(port){return new Promise(resolve=>{let done=false;const socket=net.connect({host:'127.0.0.1',port}),timer=setTimeout(()=>finish(false),600);function finish(accepted){if(done)return;done=true;clearTimeout(timer);socket.destroy();resolve(accepted);}socket.once('connect',()=>finish(true));socket.once('error',()=>finish(false));});}
test('closing stops new HTTP connections before waiting for the original backend queue to drain',async t=>{
 const fixtureRoot=await fixture(),app=await start(fixtureRoot);t.after(()=>app.close());
 let enter,release;const entered=new Promise(resolve=>{enter=resolve;}),held=new Promise(resolve=>{release=resolve;});
 const pending=app.backend.exclusive(async()=>{enter();await held;});await entered;const closing=app.close();let accepted;
 try{await new Promise(resolve=>setTimeout(resolve,25));accepted=await acceptsConnection(Number(new URL(app.origin).port));}
 finally{release();await pending;await closing;}
 console.log(JSON.stringify({backendDrainHeld:true,newHTTPConnectionAcceptedWhileClosing:accepted,normalDrainCompleted:true}));
 assert.equal(accepted,false,'a new HTTP connection must not be admitted while close waits for accepted backend work');
});

test('B2 failed-close stop rejects immediately without creating an unconsumed request',async t=>{
 const fixtureRoot=await fixture();let server;const app=await start(fixtureRoot,value=>{if(!server&&value instanceof http.Server)server=value;});t.after(()=>app.close().catch(()=>{}));
 const close=server.close;server.close=function(callback){return close.call(this,error=>callback(error||Error('synthetic close failure for stop receipt')));};
 app.stopped.catch(()=>{});await assert.rejects(app.close());let error,receipt;try{receipt=await requestProfileCandidateStop({fixtureRoot,nonce:app.instance.nonce});}catch(value){error=value;}
 let wroteRequest=true;try{await fs.stat(path.join(fixtureRoot,'profile-materials-candidate/stop-request.json'));}catch(value){if(value.code==='ENOENT')wroteRequest=false;else throw value;}
 console.log(JSON.stringify({finding:'B2',failedClose:true,stopRejected:!!error,unconsumedRequestWritten:wroteRequest,accepted:receipt?.accepted===true}));
 assert.ok(error,'a failed-close record cannot accept a stop request with no live consumer');assert.equal(wroteRequest,false);
});

test('B4 unknown crash-like atomic residue is retained and blocks opening without changing main data',async()=>{
 const fixtureRoot=await fixture(),app=await start(fixtureRoot);await app.close();const home=path.join(fixtureRoot,'profile-materials-candidate'),file=path.join(home,'.instance.json.00000000-0000-4000-8000-000000000000.tmp'),bytes=Buffer.from('synthetic unknown atomic residue retained'),main=path.join(fixtureRoot,'main-data/jewelry.sqlite'),before=createHash('sha256').update(await fs.readFile(main)).digest('hex');await fs.writeFile(file,bytes);
 await assert.rejects(start(fixtureRoot));assert.deepEqual(await fs.readFile(file),bytes);assert.equal(createHash('sha256').update(await fs.readFile(main)).digest('hex'),before);
 console.log(JSON.stringify({finding:'B4',unknownResidueRetained:true,startRefused:true,mainDatabaseUnchanged:true,classification:'explicit preservation limit; no automatic cleanup'}));
});

test('B7 a concurrent fixture starter loses ownership before opening its main database',async()=>{
 const fixtureRoot=await fixture(),main=path.resolve(fixtureRoot,'main-data/jewelry.sqlite').toLowerCase(),marker=path.resolve(fixtureRoot,'profile-materials-candidate/销售素材/materials-profile.json'),open=promises.open,exec=DatabaseSync.prototype.exec,prepare=DatabaseSync.prototype.prepare,listen=net.Server.prototype.listen;
 const databases=new Set();let blocked=false,enter,release;const entered=new Promise(resolve=>{enter=resolve;}),hold=new Promise(resolve=>{release=resolve;});
 promises.open=async function(file,...args){if(!blocked&&path.resolve(file)===marker&&args[0]==='wx'){blocked=true;enter();await hold;}return open.call(this,file,...args);};
 DatabaseSync.prototype.exec=function(sql,...args){const row=prepare.call(this,'PRAGMA database_list').all().find(value=>value.name==='main');if(row?.file&&path.resolve(row.file).toLowerCase()===main)databases.add(this);return exec.call(this,sql,...args);};syncBuiltinESMExports();
 const outcomes=[];let first,second,timer;const settled=promise=>promise.then(value=>({status:'fulfilled',value}),reason=>({status:'rejected',reason}));
 try{first=settled(start(fixtureRoot));await Promise.race([entered,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('first material marker gate not reached')),5000);})]);clearTimeout(timer);second=settled(start(fixtureRoot));const secondResult=await Promise.race([second,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('second starter did not settle')),5000);})]);clearTimeout(timer);release();outcomes.push(await first,secondResult);}
 finally{clearTimeout(timer);release();promises.open=open;DatabaseSync.prototype.exec=exec;net.Server.prototype.listen=listen;syncBuiltinESMExports();if(first&&!outcomes.length)outcomes.push(await first);if(second&&outcomes.length<2)outcomes.push(await second);for(const value of outcomes)if(value.status==='fulfilled')await value.value.close();}
 console.log(JSON.stringify({finding:'B7',gatedFirst:true,mainDatabaseOwnersOpened:databases.size,statuses:outcomes.map(value=>value.status)}));assert.equal(databases.size,1,'losing starter must fail before opening a second main SQLite connection');assert.equal(outcomes.filter(value=>value.status==='fulfilled').length,1);
});

test('B8 a failed LAN reservation handoff retains its reference for owned cleanup retry',async()=>{
 const fixtureRoot=await fixture();let reservation,originalClose,calls=0,error,app;
 try{app=await start(fixtureRoot,server=>{if(!reservation&&!(server instanceof http.Server)){reservation=server;originalClose=server.close;server.close=function(callback){calls++;if(calls===1){queueMicrotask(()=>callback(Error('synthetic reservation handoff close failure')));return this;}return originalClose.call(this,callback);};}});}catch(value){error=value;}
 const stillListening=reservation?.listening===true;
 try{console.log(JSON.stringify({finding:'B8',startRejected:!!error,reservationCloseCalls:calls,reservationStillListening:stillListening}));assert.ok(error);assert.equal(stillListening,false,'startup cleanup must retry its own failed LAN reservation close');assert.ok(calls>=2);}
 finally{if(app)await app.close();if(reservation?.listening)await new Promise(resolve=>originalClose.call(reservation,resolve));}
});

test('fixture validation rejects canonical outside-drive paths before any outside lstat',async()=>{
 const lstat=nativeFs.lstatSync;let outsideRead=false;
 nativeFs.lstatSync=function(value,...args){if(typeof value==='string'&&/^[FC]:[\\/]/i.test(value)){outsideRead=true;throw Error('synthetic outside metadata read blocked before OS');}return lstat.call(this,value,...args);};
 try{for(const fixtureRoot of [path.normalize('F:/unapproved-fixture'),path.normalize('C:/unapproved-fixture')])await assert.rejects(startProfileMaterialsCandidate({port:0,lanPort:0,fixtureRoot,classify}));}finally{nativeFs.lstatSync=lstat;}
 console.log(JSON.stringify({outsideMetadataReadAttempted:outsideRead,actualOutsideOSReads:0}));assert.equal(outsideRead,false,'lexical subtree check must run before outside-drive filesystem metadata');
});

test('claim creation failure cannot unlink a replacement unknown owner file',async()=>{
 const fixtureRoot=await fixture(),claim=path.join(fixtureRoot,'profile-materials-candidate/owner-claim.json'),retained=path.join(fixtureRoot,'retained-created-claim.json'),unknown=Buffer.from('synthetic unknown replacement owner must remain'),open=promises.open;let injected=false;
 promises.open=async function(file,...args){const handle=await open.call(this,file,...args);if(!injected&&path.resolve(file)===claim&&args[0]==='wx'){injected=true;const write=handle.writeFile.bind(handle);handle.writeFile=async function(...values){await write(...values);await fs.rename(claim,retained);await fs.writeFile(claim,unknown,{flag:'wx'});throw Error('synthetic claim creation failure after replacement');};}return handle;};syncBuiltinESMExports();
 try{await assert.rejects(start(fixtureRoot));}finally{promises.open=open;syncBuiltinESMExports();}
 let after;try{after=await fs.readFile(claim);}catch(error){if(error.code!=='ENOENT')throw error;}
 console.log(JSON.stringify({claimCreationFaultInjected:injected,unknownReplacementRetained:after?.equals(unknown)===true}));assert.equal(injected,true);assert.deepEqual(after,unknown,'only this attempt original claim identity may ever be released');
});

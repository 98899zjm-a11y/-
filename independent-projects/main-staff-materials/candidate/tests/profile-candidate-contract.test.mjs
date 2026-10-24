import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{createBackend}=require('../project/desktop/backend.cjs');
const candidate=path.resolve(import.meta.dirname,'..'),base=path.join(candidate,'runtime','profile-candidate-tests');
await fs.mkdir(base,{recursive:true});
const entry=await import('../start-profile-candidate.mjs').catch(error=>({loadError:error}));
const password='Synthetic-profile-bootstrap-only-pass!';
function api(){assert.equal(typeof entry.startProfileMaterialsCandidate,'function','profile candidate startup API must exist');return async options=>{const listen=net.Server.prototype.listen;net.Server.prototype.listen=function(...args){const value=args[0],port=typeof value==='object'?value.port:value,host=typeof value==='object'?value.host:args[1];if(host!=='127.0.0.1'||!Number.isInteger(port)||[21965,21966,31831].includes(port))throw Error('fixture refuses any non-loopback or fixed-port bind before OS call');return listen.apply(this,args);};try{return await entry.startProfileMaterialsCandidate(options);}finally{net.Server.prototype.listen=listen;}};}
async function fixture({database=true}={}){
 const fixtureRoot=await fs.mkdtemp(path.join(base,'contract-')),main=path.join(fixtureRoot,'main-data');await fs.mkdir(main);
 const accounts=[['main_admin','admin','manage'],['main_view','employee','view'],['main_operate','employee','operate'],['main_manage','employee','manage']].map(([username,role,level])=>({username,role,level,name:'虚构启动员工',password}));
 if(database){const backend=createBackend({dataDir:main,migrationDir:path.join(candidate,'project/desktop/migrations')});try{backend.auth.setup(accounts[0]);for(const account of accounts.slice(1)){const user=backend.auth.createUser(account);backend.administration.updatePermissions(backend.auth.status().user,{staffId:user.id,moduleAccess:{sales:account.level}},()=>backend.auth.listUsers());}backend.auth.logout();}finally{await backend.close();}}
 await fs.writeFile(path.join(main,'synthetic-candidate.json'),JSON.stringify({kind:'xjy-main-materials-synthetic-candidate-v1',synthetic:true}),{flag:'wx'});
 await fs.writeFile(path.join(fixtureRoot,'main-candidate-accounts.json'),JSON.stringify(accounts),{flag:'wx',mode:0o600});return{fixtureRoot,main};
}
const classify=async({sha256})=>({sha256,decision:'jewelry',category:'戒指',tags:['简约'],reason:'虚构启动测试'});

test('profile candidate exposes the trusted startup and nonce-stop APIs',()=>{
 assert.equal(typeof entry.startProfileMaterialsCandidate,'function',entry.loadError?.message);assert.equal(typeof entry.requestProfileCandidateStop,'function');
});

test('ephemeral ports require a bounded fixture and never fall through to demo',async()=>{
 await assert.rejects(api()({port:0,lanPort:0,classify}));
 for(const fixtureRoot of ['relative','F:/unapproved','C:/unapproved',path.join(candidate,'runtime')])await assert.rejects(api()({port:0,lanPort:0,fixtureRoot,classify}));
});

test('unknown port overrides and 31831 are rejected before opening fixture data',async()=>{
 const {fixtureRoot}=await fixture();
 for(const options of [{port:31831,lanPort:0},{port:0,lanPort:31831},{port:21964,lanPort:0},{port:0,lanPort:21967}])await assert.rejects(api()({...options,fixtureRoot,classify}));
 await assert.rejects(fs.stat(path.join(fixtureRoot,'profile-materials-candidate')),{code:'ENOENT'});
});

test('a marked fixture missing its existing business database is refused without creating a blank one',async()=>{
 const {fixtureRoot,main}=await fixture({database:false});await assert.rejects(api()({port:0,lanPort:0,fixtureRoot,classify}));
 await assert.rejects(fs.stat(path.join(main,'jewelry.sqlite')),{code:'ENOENT'});
});

test('missing synthetic main marker refuses and retains the existing fixture database',async()=>{
 const {fixtureRoot,main}=await fixture(),file=path.join(main,'jewelry.sqlite'),before=await fs.readFile(file);await fs.rename(path.join(main,'synthetic-candidate.json'),path.join(fixtureRoot,'retained-marker.json'));
 await assert.rejects(api()({port:0,lanPort:0,fixtureRoot,classify}));assert.deepEqual(await fs.readFile(file),before);
});

test('malformed private account data refuses without echoing its credential-like content',async()=>{
 const {fixtureRoot}=await fixture(),file=path.join(fixtureRoot,'main-candidate-accounts.json'),bytes=Buffer.from('SensitiveBootstrapTokenNoLog123 invalid JSON');await fs.writeFile(file,bytes);
 let error;try{await api()({port:0,lanPort:0,fixtureRoot,classify});}catch(value){error=value;}
 assert.ok(error);assert.doesNotMatch(String(error.message),/SensitiveBootstrap/);assert.deepEqual(await fs.readFile(file),bytes);
});

test('successful fixture stays in its own profile and exposes no connection secret in its instance',async t=>{
 const {fixtureRoot}=await fixture(),app=await api()({port:0,lanPort:0,fixtureRoot,classify});t.after(()=>app.close());
 assert.ok(Object.isFrozen(app));assert.match(app.origin,/^http:\/\/127\.0\.0\.1:[1-9][0-9]*$/);assert.ok(Number.isInteger(app.lanPort)&&app.lanPort>0);assert.equal(app.profileRoot,path.join(fixtureRoot,'profile-materials-candidate','销售素材'));
 assert.equal(app.backend.auth.status().authenticated,false,'temporary root administrator must be logged out after LAN enable');
 for(const key of ['nonce','kind','pid','sourceHashes'])assert.ok(Object.hasOwn(app.instance,key));assert.equal(app.instance.pid,process.pid);assert.doesNotMatch(JSON.stringify(app.instance),/privateKey|password|"code"|"pin"/);
 const connection=JSON.parse(await fs.readFile(app.connectionFile,'utf8'));assert.equal(connection.host,'127.0.0.1');assert.equal(connection.port,app.lanPort);assert.equal(typeof connection.code,'string');assert.match(connection.code,/^[A-Za-z0-9_-]{32}$/);
 await app.close();await app.close();await app.stopped;
});

test('nonce stop refuses another nonce and normally drains its own fixture instance',async t=>{
 const {fixtureRoot}=await fixture(),app=await api()({port:0,lanPort:0,fixtureRoot,classify});t.after(()=>app.close());
 assert.equal(typeof entry.requestProfileCandidateStop,'function');
 await assert.rejects(entry.requestProfileCandidateStop({fixtureRoot,nonce:'00000000-0000-4000-8000-000000000000'}));
 assert.equal(app.backend.auth.status().needsSetup,false);
 await entry.requestProfileCandidateStop({fixtureRoot,nonce:app.instance.nonce});
 let timer;try{await Promise.race([app.stopped,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('owned nonce stop did not drain')),5000);})]);}finally{clearTimeout(timer);}
 const record=JSON.parse(await fs.readFile(app.instanceFile,'utf8'));assert.equal(record.nonce,app.instance.nonce);assert.equal(record.state,'closed');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import {createRequire} from 'node:module';
import {startProfileMaterialsCandidate} from '../start-profile-candidate.mjs';
const require=createRequire(import.meta.url),{createBackend}=require('../project/desktop/backend.cjs');
const candidate=path.resolve(import.meta.dirname,'..'),base=path.join(candidate,'runtime','profile-candidate-tests'),password='Synthetic-bootstrap-close-failure-only!';
const classify=async({sha256})=>({sha256,decision:'uncertain',category:'戒指',tags:[],reason:'虚构关闭测试'});
async function fixture(){const fixtureRoot=await fs.mkdtemp(path.join(base,'close-')),main=path.join(fixtureRoot,'main-data'),backend=createBackend({dataDir:main,migrationDir:path.join(candidate,'project/desktop/migrations')});const accounts=[['main_admin','admin','manage'],['main_view','employee','view'],['main_operate','employee','operate'],['main_manage','employee','manage']].map(([username,role,level])=>({username,role,level,name:'虚构关闭员工',password}));try{backend.auth.setup(accounts[0]);for(const account of accounts.slice(1)){const user=backend.auth.createUser(account);backend.administration.updatePermissions(backend.auth.status().user,{staffId:user.id,moduleAccess:{sales:account.level}},()=>backend.auth.listUsers());}backend.auth.logout();}finally{await backend.close();}await fs.writeFile(path.join(main,'synthetic-candidate.json'),JSON.stringify({kind:'xjy-main-materials-synthetic-candidate-v1',synthetic:true}),{flag:'wx'});await fs.writeFile(path.join(fixtureRoot,'main-candidate-accounts.json'),JSON.stringify(accounts),{flag:'wx',mode:0o600});return fixtureRoot;}
function assertEphemeral(args){const value=args[0],port=typeof value==='object'?value.port:value,host=typeof value==='object'?value.host:args[1];if(host!=='127.0.0.1'||!Number.isInteger(port)||[21965,21966,31831].includes(port))throw Error('fixture refuses fixed or non-loopback bind before OS');}
async function start(fixtureRoot,{capture}={}){const oldNet=net.Server.prototype.listen,oldHttp=http.Server.prototype.listen,hadOwnHttp=Object.hasOwn(http.Server.prototype,'listen');net.Server.prototype.listen=function(...args){assertEphemeral(args);return oldNet.apply(this,args);};http.Server.prototype.listen=function(...args){assertEphemeral(args);capture?.(this);return oldHttp.apply(this,args);};try{return await startProfileMaterialsCandidate({port:0,lanPort:0,fixtureRoot,classify});}finally{net.Server.prototype.listen=oldNet;if(hadOwnHttp)http.Server.prototype.listen=oldHttp;else delete http.Server.prototype.listen;}}
test('cleanup callback failure cannot publish closed or resolve stopped successfully',async t=>{
 const fixtureRoot=await fixture();let httpServer;const app=await start(fixtureRoot,{capture:server=>{httpServer??=server;}});t.after(()=>app.close().catch(()=>{}));
 const originalClose=httpServer.close;let injected=false;httpServer.close=function(callback){return originalClose.call(this,error=>{injected=true;callback(error||Error('synthetic owned HTTP close callback failure'));});};
 const stopped=app.stopped.then(()=>({status:'fulfilled'}),()=>({status:'rejected'}));let error;try{await app.close();}catch(value){error=value;}const ended=await stopped,record=JSON.parse(await fs.readFile(app.instanceFile,'utf8'));
 console.log(JSON.stringify({injected,closeRejected:!!error,stopped:ended.status,instanceState:record.state,httpListenerClosed:!httpServer.listening}));
 assert.equal(injected,true);assert.ok(error,'cleanup failure must reject close');assert.equal(ended.status,'rejected');assert.equal(record.state,'close_failed');assert.equal(httpServer.listening,false);
});
test('malformed private LAN identity is rejected without echoing its credential-like content',async()=>{
 const fixtureRoot=await fixture(),app=await start(fixtureRoot);await app.close();const file=path.join(fixtureRoot,'profile-materials-candidate','lan-identity.json'),bytes=Buffer.from('SensitiveLanIdentityMarker invalid JSON');await fs.writeFile(file,bytes);
 let error;try{await start(fixtureRoot);}catch(value){error=value;}
 console.log(JSON.stringify({rejected:!!error,leakedCredentialMarker:/SensitiveL/.test(String(error?.message))}));
 assert.ok(error);assert.doesNotMatch(String(error.message),/SensitiveL/);assert.deepEqual(await fs.readFile(file),bytes);
});

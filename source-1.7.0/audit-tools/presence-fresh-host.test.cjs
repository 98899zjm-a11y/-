'use strict';
// Root-only Guest supplement. Reuse the frozen 71cc admission/compiler prelude;
// do not register P01 or run hooks/DOM/native providers/backend/SQLite/network.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const vm=require('node:vm'),{createRequire}=require('node:module');
const ROOT=path.resolve(__dirname,'..'),sha=body=>crypto.createHash('sha256').update(body).digest('hex');
if(process.platform!=='win32'||ROOT.toLowerCase()!=='c:\\xjy-work\\xjy-web-stage1')throw Error('Fixed actual Guest required before renderer evaluation');
function source(relative){const file=path.join(ROOT,...relative.split('/')),rel=path.relative(ROOT,file);if(rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))throw Error('Reviewed source escaped Root');for(let p=file;;p=path.dirname(p)){const info=fs.lstatSync(p);if(info.isSymbolicLink()||info.isFile()&&info.nlink!==1)throw Error('Ordinary reviewed source required');if(p===path.dirname(p))break;}const info=fs.statSync(file);if(!info.isFile()||info.size>64*1024)throw Error('Bounded reviewed source required');return fs.readFileSync(file);}
const SELF='audit-tools/presence-fresh-host.test.cjs',SELF_SHA=process.env.XJY_PRESENCE_FRESH_HOST_TEST_SHA256;
if(!/^[a-f0-9]{64}$/.test(SELF_SHA||'')||sha(source(SELF))!==SELF_SHA)throw Error('Root-pinned fresh-host test SHA required');
const FROZEN=path.join(__dirname,'presence-metadata-pending.test.cjs'),FROZEN_SHA='71cc66a05d75f3348a1f6902b16e7ffd112f1cdad39b2df086c9e18aa92b4203';
const bytes=source('audit-tools/presence-metadata-pending.test.cjs');
if(sha(bytes)!==FROZEN_SHA)throw Error('Frozen 71cc reporter harness changed');
const frozen=bytes.toString('utf8'),marker="test('P01 one unresolved optional version getter cannot block or multiply ordinary heartbeats and a disposed late result cannot cross scope',async()=>{";
const at=frozen.indexOf(marker),PRELUDE_SHA='96c61f510e7538bad8bd2142f9f37ba2700c2e396a23fbe9740ab4bc8566ea19';
if(at<1||frozen[at-1]!=='\n'||frozen.indexOf(marker,at+1)!==-1||sha(Buffer.from(frozen.slice(0,at)))!==PRELUDE_SHA)throw Error('Exact frozen reporter prelude required');
const loaded={exports:{}};
vm.runInNewContext(frozen.slice(0,at)+'\nmodule.exports={createReporter:subject.exports.createPresenceClientReporter,A,B,plain,turn,deferred,storage};\n',{
 module:loaded,exports:loaded.exports,require:createRequire(FROZEN),__dirname,__filename:FROZEN,
 process,Buffer,URL,URLSearchParams,TextEncoder,TextDecoder,setImmediate,clearImmediate,setTimeout,clearTimeout,setInterval,clearInterval,console,
},{filename:FROZEN+'[admission-and-compiler-only]'});
// The exact prelude performs actualGuard before esbuild write:false and verifies
// Root's source SHA, all compiler inputs, and the unchanged original 55d test.
const {createReporter,A,B,turn,deferred,storage}=loaded.exports;
const plain=value=>JSON.parse(JSON.stringify(value));
const test=require('node:test'),assert=require('node:assert/strict');
console.log(JSON.stringify({purpose:'presence-fresh-host-version',testSha256:SELF_SHA,frozenHarnessSha256:FROZEN_SHA,preludeSha256:PRELUDE_SHA,sourceSha256:process.env.XJY_PRESENCE_PENDING_SOURCE_SHA256,methods:1,originalPendingTestRegistered:false,reactHooksRun:false,domVerified:false,nativeProviderRun:false,databaseUsed:false}));

test('F01 a live web reporter refreshes changed Host versions, clears invalid results, and keeps one nonblocking disposable query',async()=>{
 assert.equal(typeof createReporter,'function','Actual delivered reporter is required for the Host refresh regression');
 const waiting=deferred(),calls=[],tracked=[];let getterCalls=0,inFlight=0,peakInFlight=0;
 let next=()=>Promise.resolve({appVersion:'1.6.1'});
 const reporter=createReporter({request:async body=>{calls.push(plain(body));return{accepted:true,clientMetadataVersion:1};},getAppInfo:()=>{
  getterCalls++;inFlight++;peakInFlight=Math.max(peakInFlight,inFlight);
  return Promise.resolve(next()).finally(()=>{inFlight--;});
 },storage:storage(),surface:'web',createDeviceId:()=>B});
 function observe(operation){const state={settled:false,error:null},promise=Promise.resolve().then(operation);promise.then(()=>{state.settled=true;},error=>{state.error=error;state.settled=true;});tracked.push(promise);return state;}
 async function send(active=false){const state=observe(()=>reporter.send({module:'home',active}));await turn();await turn();assert.equal(state.settled,true,'PRESENCE_FRESH_HOST_BLOCKS_HEARTBEAT');assert.ifError(state.error);return calls.at(-1);}
 const legacy=active=>({module:'home',active}),reported=(version,active=false)=>({module:'home',active,client:{schemaVersion:1,deviceId:A,kind:'web',clientVersion:version,versionSource:'host-web'}});
 try{
  assert.deepEqual(await send(),legacy(false),'A live reporter still begins with the original body');
  assert.deepEqual(await send(),reported('1.6.1'));
  const beforeUpgrade=getterCalls;next=()=>Promise.resolve({appVersion:'1.6.2'});
  await send(true);
  assert.deepEqual(await send(),reported('1.6.2'),'PRESENCE_FRESH_HOST_VERSION_REQUIRED: a later heartbeat must report the newly read Host version');
  assert(getterCalls>beforeUpgrade,'A changed Host version must come from another actual getter call');

  next=()=>Promise.resolve({appVersion:' invalid version '});
  await send();
  assert.deepEqual(await send(true),legacy(true),'An invalid refresh must not keep presenting the old Host version as valid metadata');
  next=()=>Promise.resolve({appVersion:'1.6.2'});await send();
  assert.deepEqual(await send(),reported('1.6.2'),'A later valid refresh may restore diagnostic metadata');
  next=()=>Promise.reject(Error('synthetic optional Host version unavailable'));
  await send();
  assert.deepEqual(await send(),legacy(false),'A rejected refresh must leave ordinary presence working without stale client metadata');
  next=()=>Promise.resolve({appVersion:'1.6.2'});await send();
  assert.deepEqual(await send(),reported('1.6.2'));

  const beforePending=getterCalls;next=()=>waiting.promise;await send();
  assert.equal(getterCalls,beforePending+1,'A valid cache cannot permanently suppress the next Host refresh');
  assert.equal(inFlight,1);
  const pendingCount=getterCalls,beforeSend=calls.length;await send(true);await send();
  assert.equal(calls.length,beforeSend+2,'A pending refresh cannot stop normal heartbeat requests');
  assert.equal(getterCalls,pendingCount,'Only one unresolved metadata query may remain in flight');
  assert.equal(peakInFlight,1,'No overlapping metadata RPCs are allowed');
  reporter.dispose();const stopped=calls.length;waiting.resolve({appVersion:'9.9.9'});
  await Promise.allSettled(tracked);await turn();await turn();
  await send(true);
  assert.equal(calls.length,stopped,'A disposed late Host result must not append another heartbeat');
  assert(!JSON.stringify(calls).includes('9.9.9'));
 }finally{
  // Release the only possible pending getter before awaiting sends, including RED.
  reporter.dispose();waiting.resolve({appVersion:'9.9.9'});
  await Promise.allSettled(tracked);await turn();
 }
});

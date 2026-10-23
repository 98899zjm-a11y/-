'use strict';
// One Root-only Guest regression. Reuse 71cc admission/compiler definitions;
// no hooks/DOM, native provider, backend, SQLite, network or product execution.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const vm=require('node:vm'),{createRequire}=require('node:module');
const ROOT=path.resolve(__dirname,'..'),sha=body=>crypto.createHash('sha256').update(body).digest('hex');
if(process.platform!=='win32'||ROOT.toLowerCase()!=='c:\\xjy-work\\xjy-web-stage1')throw Error('Fixed actual Guest required before renderer evaluation');
function source(relative){const file=path.join(ROOT,...relative.split('/')),rel=path.relative(ROOT,file);if(rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))throw Error('Reviewed source escaped Root');for(let p=file;;p=path.dirname(p)){const info=fs.lstatSync(p);if(info.isSymbolicLink()||info.isFile()&&info.nlink!==1)throw Error('Ordinary reviewed source required');if(p===path.dirname(p))break;}const info=fs.statSync(file);if(!info.isFile()||info.size>64*1024)throw Error('Bounded reviewed source required');return fs.readFileSync(file);}
const SELF='audit-tools/presence-metadata-recovery.test.cjs',SELF_SHA=process.env.XJY_PRESENCE_RECOVERY_TEST_SHA256;
if(!/^[a-f0-9]{64}$/.test(SELF_SHA||'')||sha(source(SELF))!==SELF_SHA)throw Error('Root-pinned recovery test SHA required');
const FROZEN=path.join(__dirname,'presence-metadata-pending.test.cjs'),FROZEN_SHA='71cc66a05d75f3348a1f6902b16e7ffd112f1cdad39b2df086c9e18aa92b4203';
const bytes=source('audit-tools/presence-metadata-pending.test.cjs');
if(sha(bytes)!==FROZEN_SHA)throw Error('Frozen 71cc reporter harness changed');
if(sha(source('audit-tools/presence-fresh-host.test.cjs'))!=='84e92c4210e4f7decb3147e8e296e550cbf29a5c1fce32d8a245014b43dfa36a')throw Error('Frozen 84e Host-refresh regression changed');
const frozen=bytes.toString('utf8'),marker="test('P01 one unresolved optional version getter cannot block or multiply ordinary heartbeats and a disposed late result cannot cross scope',async()=>{";
const at=frozen.indexOf(marker),PRELUDE_SHA='96c61f510e7538bad8bd2142f9f37ba2700c2e396a23fbe9740ab4bc8566ea19';
if(at<1||frozen[at-1]!=='\n'||frozen.indexOf(marker,at+1)!==-1||sha(Buffer.from(frozen.slice(0,at)))!==PRELUDE_SHA)throw Error('Exact frozen reporter prelude required');
const loaded={exports:{}};
vm.runInNewContext(frozen.slice(0,at)+'\nmodule.exports={createReporter:subject.exports.createPresenceClientReporter,A,B,turn,storage};\n',{
 module:loaded,exports:loaded.exports,require:createRequire(FROZEN),__dirname,__filename:FROZEN,
 process,Buffer,URL,URLSearchParams,TextEncoder,TextDecoder,setImmediate,clearImmediate,setTimeout,clearTimeout,setInterval,clearInterval,console,
},{filename:FROZEN+'[admission-and-compiler-only]'});
const {createReporter,A,B,turn,storage}=loaded.exports;
const plain=value=>JSON.parse(JSON.stringify(value)),test=require('node:test'),assert=require('node:assert/strict');
const BASELINE_SOURCE_SHA='65e5536b84051c2c6281edf4213bc500c4d8fd7eee3cb9600c067278a21d8f8f';
console.log(JSON.stringify({purpose:'presence-metadata-recovery-after-failed-heartbeat',testSha256:SELF_SHA,frozenHarnessSha256:FROZEN_SHA,preludeSha256:PRELUDE_SHA,baselineSourceSha256:BASELINE_SOURCE_SHA,sourceSha256:process.env.XJY_PRESENCE_PENDING_SOURCE_SHA256,methods:1,originalPendingTestRegistered:false,reactHooksRun:false,domVerified:false,nativeProviderRun:false,databaseUsed:false}));
function controlled(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}

test('R01 a failed heartbeat invalidates a stuck metadata epoch, renegotiates versions, and isolates late results without overlapping POSTs',async t=>{
 assert.equal(typeof createReporter,'function','Actual delivered reporter is required for metadata recovery');
 for(const late of ['resolve','reject']){
  t.diagnostic('late metadata settlement: '+late);
  const old=controlled(),fresh=controlled(),refresh=controlled(),heldPost=controlled(),calls=[],tracked=[];
  const networkError=Error('synthetic presence failure');let getterCalls=0,rejectNext=false,holdNext=false,posts=0,peakPosts=0;
  const reply=()=>({accepted:true,clientMetadataVersion:1});
  const reporter=createReporter({request:async body=>{
   posts++;peakPosts=Math.max(peakPosts,posts);calls.push(plain(body));
   try{if(rejectNext){rejectNext=false;throw networkError;}if(holdNext){holdNext=false;await heldPost.promise;}return reply();}
   finally{posts--;}
  },getAppInfo:()=>{getterCalls++;if(getterCalls===1)return old.promise;if(getterCalls===2)return fresh.promise;if(getterCalls===3)return refresh.promise;throw Error('Unexpected duplicate metadata refresh');},storage:storage(),surface:'web',createDeviceId:()=>B});
  function observe(operation){const state={settled:false,error:null},promise=Promise.resolve().then(operation);promise.then(()=>{state.settled=true;},error=>{state.error=error;state.settled=true;});tracked.push(promise);return state;}
  async function settled(state,expected=null){await turn();await turn();assert.equal(state.settled,true,'PRESENCE_RECOVERY_BLOCKS_HEARTBEAT');if(expected)assert.equal(state.error,expected);else assert.ifError(state.error);}
  async function send(active=false,expected=null){const state=observe(()=>reporter.send({module:'home',active}));await settled(state,expected);return calls.at(-1);}
  const legacy=active=>({module:'home',active}),reported=active=>({module:'home',active,client:{schemaVersion:1,deviceId:A,kind:'web',clientVersion:'1.6.2',versionSource:'host-web'}});
  try{
   assert.deepEqual(await send(),legacy(false));assert.equal(getterCalls,1,'Initial negotiation starts exactly one optional lookup');
   rejectNext=true;assert.deepEqual(await send(true,networkError),legacy(true));
   assert.equal(getterCalls,1,'A pending lookup must not multiply before the heartbeat failure');
   assert.deepEqual(await send(),legacy(false),'Successful renegotiation still uses the original body');
   assert.deepEqual(await send(true),legacy(true),'A still-pending replacement lookup cannot block presence');
   assert.equal(getterCalls,2,'PRESENCE_METADATA_RECOVERY_REQUIRED: after failure and successful renegotiation, a new epoch must request metadata despite the obsolete unresolved lookup');
   fresh.resolve({appVersion:'1.6.2'});await turn();await turn();
   assert.deepEqual(await send(),reported(false),'A later ordinary heartbeat reports the recovered actual version');
   assert.equal(getterCalls,3,'A valid recovered cache still permits the next background refresh');
   const beforeLate=calls.length;
   if(late==='resolve')old.resolve({appVersion:'9.9.9'});else old.reject(Error('synthetic obsolete metadata rejection'));
   await turn();await turn();assert.equal(calls.length,beforeLate,'Old completion cannot issue an unsolicited heartbeat');
   assert.deepEqual(await send(true),reported(true),'Obsolete success or rejection cannot replace or clear the recovered version');
   assert.equal(getterCalls,3,'The obsolete task finalizer cannot release the replacement refresh lease');

   holdNext=true;const held=observe(()=>reporter.send({module:'home',active:true}));await turn();await turn();
   assert.equal(held.settled,false,'The explicit request port must still be holding this POST');
   const heldCount=calls.length;assert.equal(posts,1);
   const concurrent=observe(()=>reporter.send({module:'home',active:false}));await settled(concurrent);
   assert.equal(calls.length,heldCount,'A concurrent send remains conservatively skipped, without merging or starting another POST');
   heldPost.resolve();await settled(held);assert.equal(posts,0);assert.equal(peakPosts,1,'Only one presence POST may be in flight');
   assert.equal(getterCalls,3,'Stable-epoch pending refreshes cannot pile up');
   assert.deepEqual(await send(),reported(false));assert.equal(getterCalls,3);
   assert(!JSON.stringify(calls).includes('9.9.9'),'No body may contain an obsolete version');
  }finally{
   // Preserve a genuine RED, but release every owned fake Promise and drain sends.
   reporter.dispose();old.resolve({appVersion:'9.9.9'});fresh.resolve({appVersion:'1.6.2'});refresh.resolve({appVersion:'1.6.2'});heldPost.resolve();
   await Promise.allSettled(tracked);await turn();await turn();
  }
 }
});

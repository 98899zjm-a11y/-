'use strict';
// One Root-only Guest regression. Public compiler + actual reporter definitions;
// no hooks/DOM, native provider, backend, SQLite, network or business database.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'..'),sha=body=>crypto.createHash('sha256').update(body).digest('hex');
if(process.platform!=='win32'||ROOT.toLowerCase()!=='c:\\xjy-work\\xjy-web-stage1')throw Error('Fixed actual Guest required before renderer evaluation');
function read(relative,max=1024*1024){const file=path.join(ROOT,...relative.split('/')),rel=path.relative(ROOT,file);if(rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))throw Error('Input escaped reviewed Root');for(let p=file;;p=path.dirname(p)){const info=fs.lstatSync(p);if(info.isSymbolicLink()||info.isFile()&&info.nlink!==1)throw Error('Input link refused');if(p===path.dirname(p))break;}const info=fs.statSync(file);if(!info.isFile()||info.size>max)throw Error('Bounded ordinary input required');return fs.readFileSync(file);}
const GUARDS={
 'stage1/guest-candidate-cdp.cjs':'59840b638d8797fb55241616cd0b8e4098075a76834a201b0e93c1a748f1bb32',
 'stage1/sandbox-context.py':'09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249',
 'stage1/validate-sandbox-context.py':'867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207',
};
for(const [file,pin]of Object.entries(GUARDS))if(sha(read(file))!==pin)throw Error('Original actual Guest guard changed');
const actualContext=require('../stage1/guest-candidate-cdp.cjs').actualGuard();
const assert=require('node:assert/strict'),test=require('node:test'),vm=require('node:vm'),{createRequire}=require('node:module');
const SELF='audit-tools/presence-metadata-pending.test.cjs',SOURCE='project/desktop/renderer/presence-heartbeat.ts';
const TEST_SHA=process.env.XJY_PRESENCE_PENDING_TEST_SHA256,SOURCE_SHA=process.env.XJY_PRESENCE_PENDING_SOURCE_SHA256;
for(const value of [TEST_SHA,SOURCE_SHA])assert.match(value||'',/^[a-f0-9]{64}$/,'Root-pinned test and reporter source SHA required');
assert.equal(sha(read(SELF)),TEST_SHA);assert.equal(sha(read(SOURCE)),SOURCE_SHA);
assert.equal(sha(read('audit-tools/employee-client-version.test.cjs')),'55d67432de85d1749d6fe2de38053a491746d1207083fb5b74a98830f695595d','Original four-method test remains unchanged');
const DEPS=path.join(ROOT,'audit-tools/dependencies/node_modules'),metadata=JSON.parse(read('audit-tools/dependencies/node_modules/esbuild/package.json'));
assert.equal(metadata.name,'esbuild');assert.equal(metadata.version,'0.28.0');
const esbuild=require(path.join(DEPS,'esbuild')),entry=path.join(ROOT,SOURCE);
const built=esbuild.buildSync({absWorkingDir:ROOT,entryPoints:[entry],bundle:true,write:false,metafile:true,platform:'node',format:'cjs',target:'node24',jsx:'automatic',loader:{'.css':'empty'},alias:{'@':path.join(ROOT,'project')},nodePaths:[DEPS],logLevel:'silent'});
const inside=(root,file)=>{const rel=path.relative(root,file);return rel===''||rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel);};
const inputs=Object.keys(built.metafile.inputs).map(name=>path.resolve(ROOT,name));
for(const file of inputs){assert(inside(path.join(ROOT,'project'),file)||inside(DEPS,file),'Compiler input escaped project/deps');read(path.relative(ROOT,file).replaceAll('\\','/'),8*1024*1024);}
assert.equal(sha(read(SOURCE)),SOURCE_SHA,'Reporter source changed during compilation');
const subject={exports:{}},bytes=built.outputFiles[0].contents;
vm.runInNewContext(Buffer.from(bytes).toString('utf8'),{module:subject,exports:subject.exports,require:createRequire(entry),__dirname:path.dirname(entry),process,Buffer,URL,URLSearchParams,TextEncoder,TextDecoder,setTimeout,clearTimeout,setInterval,clearInterval,console},{filename:entry+'[pending-regression]'});
console.log(JSON.stringify({purpose:'presence-metadata-pending-does-not-block-heartbeat',actualContext,testSha256:TEST_SHA,sourceSha256:SOURCE_SHA,compiledSha256:sha(bytes),sources:inputs.filter(file=>inside(path.join(ROOT,'project'),file)).map(file=>({file:path.relative(ROOT,file).replaceAll('\\','/'),sha256:sha(fs.readFileSync(file))})),methods:1,reactHooksRun:false,domVerified:false,nativeProviderRun:false,databaseUsed:false}));

const A='22000000-0000-4000-8000-000000000001',B='22000000-0000-4000-8000-000000000002';
const plain=value=>JSON.parse(JSON.stringify(value)),turn=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};}
function storage(){const values=new Map([['xjy-client-device-id-v1',A]]);return{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};}

test('P01 one unresolved optional version getter cannot block or multiply ordinary heartbeats and a disposed late result cannot cross scope',async()=>{
 assert.equal(typeof subject.exports.createPresenceClientReporter,'function','Actual delivered reporter is required for the pending regression');
 const waiting=deferred(),calls=[],tracked=[];let getterCalls=0,fresh=null;
 const reporter=subject.exports.createPresenceClientReporter({request:async body=>{calls.push(plain(body));return{accepted:true,clientMetadataVersion:1};},getAppInfo:()=>{getterCalls++;return waiting.promise;},storage:storage(),surface:'desktop',createDeviceId:()=>B});
 function observe(operation){const state={settled:false,error:null};const promise=Promise.resolve().then(operation);promise.then(()=>{state.settled=true;},error=>{state.error=error;state.settled=true;});tracked.push(promise);return state;}
 async function completed(state,label){await turn();await turn();assert.equal(state.settled,true,'PRESENCE_METADATA_PENDING_BLOCKS_HEARTBEAT: '+label);assert.ifError(state.error);}
 try{
  await completed(observe(()=>reporter.send({module:'home',active:false})),'initial legacy negotiation must finish');
  assert.deepEqual(calls,[{module:'home',active:false}]);
  await completed(observe(()=>reporter.send({module:'home',active:false})),'metadata is still pending; second legacy heartbeat must finish');
  assert.deepEqual(calls,[{module:'home',active:false},{module:'home',active:false}]);
  await completed(observe(()=>reporter.send({module:'home',active:true})),'a later legacy heartbeat must also finish');
  assert.deepEqual(calls,[{module:'home',active:false},{module:'home',active:false},{module:'home',active:true}]);
  assert.equal(getterCalls,1,'Only one metadata request may remain in flight; ordinary sends cannot enqueue more RPCs');
  reporter.dispose();const stopped=calls.length;waiting.resolve({appVersion:'9.9.9'});
  await Promise.allSettled(tracked);await turn();await turn();
  await completed(observe(()=>reporter.send({module:'home',active:true})),'disposed send must finish without a request');
  assert.equal(calls.length,stopped,'A late metadata resolution cannot append a heartbeat after dispose');
  const freshCalls=[];
  fresh=subject.exports.createPresenceClientReporter({request:async body=>{freshCalls.push(plain(body));return{accepted:true,clientMetadataVersion:1};},getAppInfo:async()=>({appVersion:'1.6.2'}),storage:storage(),surface:'desktop',createDeviceId:()=>B});
  await completed(observe(()=>fresh.send({module:'home',active:false})),'new scope negotiation must finish');
  assert.deepEqual(freshCalls[0],{module:'home',active:false},'A new scope starts with the original body');
  await completed(observe(()=>fresh.send({module:'home',active:false})),'new scope uses only its own resolved version');
  assert.equal(freshCalls[1]?.client?.clientVersion,'1.6.2');assert(!JSON.stringify(freshCalls).includes('9.9.9'));
 }finally{
  // The known RED implementation awaits the getter. Always release it and
  // await its sends, preserving the assertion failure without a hanging test.
  reporter.dispose();fresh?.dispose();waiting.resolve({appVersion:'9.9.9'});
  await Promise.allSettled(tracked);await turn();
 }
});

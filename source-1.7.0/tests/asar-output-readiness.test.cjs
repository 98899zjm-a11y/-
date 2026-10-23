'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{Writable}=require('node:stream');
const {createAsarAndWait}=require('../stage1/build-full-release.cjs');

test('ASAR readiness waits for delayed archive bytes and the file handle to close',async()=>{
 const base=path.resolve(__dirname,'../runtime/asar-output-readiness-tests');
 fs.mkdirSync(base,{recursive:true});
 const root=fs.mkdtempSync(path.join(base,'owned-')),app=path.join(root,'synthetic-app'),archive=path.join(root,'synthetic.asar'),payload=Buffer.from('complete synthetic archive bytes');
 fs.mkdirSync(app);
 let releaseWrite,writeStarted,output,pending,settled=false;
 const gate=new Promise(resolve=>{releaseWrite=resolve;}),started=new Promise(resolve=>{writeStarted=resolve;});
 const asar={async createPackage(source,destination){
  assert.equal(source,app);assert.equal(destination,archive);
  output=fs.createWriteStream(destination,{flags:'wx',fs:{...fs,write(...args){writeStarted();gate.then(()=>fs.write(...args));}}});
  output.end(payload);
  return output;
 }};
 try{
  pending=createAsarAndWait({asar,app,archive}).then(()=>{settled=true;});
  await started;
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(settled,false,'pending output bytes must keep archive readiness pending');
  releaseWrite();
  await pending;
  assert.equal(output.closed,true,'archive readiness must include closing the output handle');
  assert.deepEqual(fs.readFileSync(archive),payload);
 }finally{
  releaseWrite();
  if(pending)await pending.catch(()=>{});
  if(output&&!output.destroyed)output.destroy();
 }
});

test('ASAR readiness propagates the archive output write error',async()=>{
 const failure=new Error('synthetic archive output I/O failure');
 const output=new Writable({write(_chunk,_encoding,callback){setImmediate(()=>callback(failure));}});
 const asar={async createPackage(){output.end(Buffer.from('synthetic bytes'));return output;}};
 await assert.rejects(createAsarAndWait({asar,app:'synthetic-app',archive:'synthetic.asar'}),error=>error===failure);
});

test('ASAR readiness propagates a packaging rejection before any output exists',async()=>{
 const failure=new Error('synthetic packaging failure'),asar={async createPackage(){throw failure;}};
 await assert.rejects(createAsarAndWait({asar,app:'synthetic-app',archive:'synthetic.asar'}),error=>error===failure);
});

test('ASAR readiness refuses a package tool without an actual Writable output',async()=>{
 for(const output of [undefined,null,true,{},'synthetic.asar']){
  const asar={async createPackage(){return output;}};
  await assert.rejects(createAsarAndWait({asar,app:'synthetic-app',archive:'synthetic.asar'}),/Writable|可写|输出流/);
 }
});

test('ASAR readiness rejects an output closed before its bytes finish',async()=>{
 const output=new Writable({write(_chunk,_encoding,_callback){}});
 const asar={async createPackage(){output.end(Buffer.from('pending synthetic bytes'));setImmediate(()=>output.destroy());return output;}};
 await assert.rejects(createAsarAndWait({asar,app:'synthetic-app',archive:'synthetic.asar'}),error=>error.code==='ERR_STREAM_PREMATURE_CLOSE');
});

test('ASAR readiness has a bounded wait for an output that never finishes',async()=>{
 let stalledWrite;
 const output=new Writable({write(_chunk,_encoding,callback){stalledWrite=setTimeout(callback,5000);}});
 const asar={async createPackage(){output.end(Buffer.from('pending synthetic bytes'));return output;}};
 try{
  await assert.rejects(createAsarAndWait({asar,app:'synthetic-app',archive:'synthetic.asar',timeoutMs:25}),error=>error.name==='AbortError'||error.name==='TimeoutError');
  assert.equal(output.writableFinished,false);
 }finally{clearTimeout(stalledWrite);output.destroy();}
});

test('ASAR readiness rejects invalid timeout bounds before invoking the packager',async()=>{
 const asar={async createPackage(){throw Error('invalid timeout must be rejected before packaging');}};
 for(const timeoutMs of [0,-1,1.5,NaN,Infinity,60001,Number.MAX_SAFE_INTEGER+1]){
  await assert.rejects(createAsarAndWait({asar,app:'synthetic-app',archive:'synthetic.asar',timeoutMs}),RangeError);
 }
});

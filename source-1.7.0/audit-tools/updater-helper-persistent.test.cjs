'use strict';
// Guest-only source-bound contracts. VM child/clock doubles are test-owned;
// production factory receives no new actor, filesystem or process injection.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'..'),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
if(process.platform!=='win32'||ROOT.toLowerCase()!=='c:\\xjy-work\\xjy-web-stage1')throw Error('Fixed actual no-F Guest required');
if(hash(fs.readFileSync(path.join(ROOT,'stage1/guest-candidate-cdp.cjs')))!=='59840b638d8797fb55241616cd0b8e4098075a76834a201b0e93c1a748f1bb32')throw Error('Original guard pin changed');
require('../stage1/guest-candidate-cdp.cjs').actualGuard();
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),{EventEmitter}=require('node:events'),{PassThrough,Writable}=require('node:stream');
assert.equal(hash(fs.readFileSync(__filename)),process.env.XJY_PERSISTENT_TEST_SHA256,'Root must freeze this contract');
const relative=process.env.XJY_PERSISTENT_SOURCE||'audit-tools/updater-helper-persistent.cjs';
assert(['audit-tools/updater-helper-persistent.cjs','project/desktop/updater-helper.cjs'].includes(relative));
const SOURCE=path.join(ROOT,relative),bytes=fs.readFileSync(SOURCE);
assert.match(process.env.XJY_PERSISTENT_SOURCE_SHA256||'',/^[a-f0-9]{64}$/);
assert.equal(hash(bytes),process.env.XJY_PERSISTENT_SOURCE_SHA256,'Root must freeze tested source');
const EXE=path.join(ROOT,'runtime/中文员工程序','鑫金源珠宝报价.exe'),CREATED='2026-10-19T06:00:00.0000000Z';
function row(pid=123){return {ProcessId:pid,ParentProcessId:1,ExecutablePath:EXE,CreationMarker:CREATED,CommandLine:'"'+EXE+'" --employee-client'};}
function load(child,clock=setTimeout){const module={exports:{}};vm.runInNewContext(bytes.toString('utf8'),{module,exports:module.exports,require:id=>id==='node:child_process'?child:require(id),process,Buffer,TextDecoder,setTimeout:clock,clearTimeout,queueMicrotask,console},{filename:SOURCE});return module.exports;}
function fixture(mode='normal'){
 const calls=[],requests=[];let alive=false,ended=false,killCount=0,sequence=0;
 const child={execFile(){throw Error('Native persistent path must not use execFile');},spawn(file,args,options){
  calls.push({file,args,options});alive=true;const p=new EventEmitter();p.stdout=new PassThrough();p.stderr=new PassThrough();p.kill=()=>{killCount++;throw Error('No force kill');};p.unref=()=>{};
  p.stdin=new Writable({write(chunk,enc,done){const value=chunk.toString('ascii');requests.push(value);sequence++;done();if(mode==='timeout')return;setImmediate(()=>{p.stdout.write(mode==='malformed'?'BROKEN\n':mode==='oversize'?Buffer.alloc(4194305,65):JSON.stringify([row(123),row(123+sequence)])+'\n');});},final(done){ended=true;alive=false;done();setImmediate(()=>{p.stdout.end();p.stderr.end();p.emit('exit',0,null);p.emit('close',0,null);});}});
  setImmediate(()=>p.emit('spawn'));return p;
 }};
 const api=load(child,mode==='timeout'?(fn,ms)=>setTimeout(fn,ms===15000?30:ms):setTimeout),adapter=api.createWindowsUpdateProcessAdapter({executablePath:EXE,spawn(){throw Error('options.spawn is exclusively helper/restart');}});
 return {adapter,calls,requests,state:()=>({alive,ended,killCount})};
}
test('P01 default inventory reuses one internal fixed PowerShell and every queued request obtains fresh CIM data',async()=>{
 const f=fixture();assert.equal(typeof f.adapter.close,'function','Persistent adapter must expose normal close');
 try{const [a,b,c]=await Promise.all([f.adapter.inspect(123),f.adapter.listForInstallation(),f.adapter.listForInstallation()]);assert.equal(a.executablePath,EXE);assert.equal(a.creationMarker,CREATED);assert.deepEqual(Array.from(a.args),['--employee-client']);assert.equal(b[1].pid,125);assert.equal(c[1].pid,126);assert.equal(f.calls.length,1);assert.equal(f.requests.length,3);const launch=f.calls[0],script=Buffer.from(launch.args.at(-1),'base64').toString('utf16le');assert.equal(launch.file,path.resolve('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'));assert.equal(launch.options.shell,false);assert.equal(launch.options.windowsHide,true);assert(script.startsWith('[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);'));assert(script.includes('Get-CimInstance Win32_Process'));assert(script.includes("CreationDate.ToUniversalTime().ToString('o')"));assert(script.includes('ReadLine'));assert.equal(launch.options.env.NODE_OPTIONS,undefined);assert.equal(launch.options.env.XJY_UPDATE_CAPABILITY,undefined);}finally{await f.adapter.close();}assert.deepEqual(f.state(),{alive:false,ended:true,killCount:0});await assert.rejects(f.adapter.inspect(123),e=>e.code==='PROCESS_PROBE_CLOSED');
});
for(const mode of ['malformed','oversize','timeout'])test('P02 '+mode+' rejects pending and queued probes without inventing empty inventory or killing',async()=>{
 const f=fixture(mode);assert.equal(typeof f.adapter.close,'function');const results=await Promise.allSettled([f.adapter.inspect(123),f.adapter.listForInstallation()]);for(const r of results){assert.equal(r.status,'rejected');assert.equal(r.reason.code,'PROCESS_PROBE_FAILED');}await f.adapter.close().catch(e=>assert.equal(e.code,'PROCESS_PROBE_FAILED'));assert.equal(f.calls.length,1);assert.equal(f.state().killCount,0);assert.equal(f.state().ended,true);
});
test('P03 original execFile adapter port preserves UTF8 identity and the original 4MiB/15s policy',async()=>{
 let call;const api=load(require('node:child_process')),adapter=api.createWindowsUpdateProcessAdapter({executablePath:EXE,execFile:async(file,args,options)=>{call={file,args,options};return{stdout:JSON.stringify([row()])};}});const p=await adapter.inspect(123);assert.equal(p.creationMarker,CREATED);assert.equal(p.parentPid,1);assert.equal(p.executablePath,EXE);assert.equal(call.options.maxBuffer,4194304);assert.equal(call.options.timeout,15000);if(adapter.close)await adapter.close();
});
test('P04 actual Windows CIM queries use one real PowerShell process, then close normally',async()=>{
 const native=require('node:child_process'),calls=[],api=load({...native,spawn(...args){calls.push(args);return native.spawn(...args);}}),adapter=api.createWindowsUpdateProcessAdapter({executablePath:process.execPath,spawn(){throw Error('Probe cannot use helper launcher');}});assert.equal(typeof adapter.close,'function');
 try{const a=await adapter.inspect(process.pid),b=await adapter.inspect(process.pid);assert.equal(a.pid,process.pid);assert.equal(b.creationMarker,a.creationMarker);assert.match(a.creationMarker,/^\d{4}-\d\d-\d\dT.*Z$/);assert.equal(path.resolve(a.executablePath).toLowerCase(),path.resolve(process.execPath).toLowerCase());assert.equal(calls.length,1);}finally{await adapter.close();}
});

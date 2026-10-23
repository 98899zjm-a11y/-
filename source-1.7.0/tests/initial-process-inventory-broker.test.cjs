'use strict';
// Unit cases use real stream objects and controlled child events only. The sole
// native case is opt-in AND requires the actual immutable Guest context guard.
const test=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
const path=require('node:path'),{spawn,spawnSync}=require('node:child_process');
const entry=require('../delivery-tools/initial-patch-entry.cjs');
const core=require('../delivery-tools/initial-patch-core.cjs');
const PS='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const rawRow=pid=>({ProcessId:pid,ParentProcessId:1,ExecutablePath:'C:\\Toy\\鑫金源.exe',CreationDate:'fixture-'+pid,CommandLine:'toy.exe --fixture'});
const mappedRow=pid=>({pid,parentPid:1,executablePath:'C:\\Toy\\鑫金源.exe',creationMarker:'fixture-'+pid,commandLine:'toy.exe --fixture'});
const refused=error=>error&&error.code==='PROCESS_PROBE_FAILED';

function fixture(options={}){
 assert.equal(typeof entry.createInitialInventoryBroker,'function','Persistent inventory broker factory must exist');
 const child=new EventEmitter();child.pid=12345;child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();
 const state={spawnCalls:[],checks:[],writes:[],stdinEnds:0,kills:0,unrefs:0,child};
 child.kill=()=>{state.kills++;throw Error('A readonly inventory worker must never be killed');};
 child.unref=()=>{state.unrefs++;};
 state.exit=(code=0,signal=null)=>{child.exitCode=code;child.signalCode=signal;child.emit('exit',code,signal);child.stdout.end();child.stderr.end();child.emit('close',code,signal);};
 child.stdin.on('data',chunk=>state.writes.push(Buffer.from(chunk)));
 child.stdin.on('finish',()=>{state.stdinEnds++;if(options.autoExit!==false)setImmediate(()=>state.exit(0));});
 state.broker=entry.createInitialInventoryBroker({
  environment:{SystemRoot:'C:\\Windows',WINDIR:'C:\\Windows',TEMP:'C:\\SyntheticTemp',USERPROFILE:'C:\\Users\\Synthetic',NODE_OPTIONS:'--require attacker',NODE_PATH:'bad',PATH:'bad',PSModulePath:'bad',ELECTRON_RUN_AS_NODE:'1',XJY_DATA_DIR:'F:\\real'},
  assertSystemPowerShellAdapter:async file=>{state.checks.push(file);},
  spawnAdapter:(file,args,opts)=>{state.spawnCalls.push({file,args,opts});queueMicrotask(()=>{if(options.spawnError)child.emit('error',Error('spawn refused'));else child.emit('spawn');});return child;},
  requestTimeoutMs:options.requestTimeoutMs||250,
  closeTimeoutMs:options.closeTimeoutMs||250
 });
 state.tokens=()=>Buffer.concat(state.writes).toString('ascii');
 state.respond=rows=>child.stdout.write(Buffer.from(JSON.stringify(rows)+'\n','utf8'));
 state.cleanup=async()=>{try{await state.broker.close();}catch{}};
 return state;
}

test('persistent inventory uses one fixed system worker with clean environment and data-only protocol',async()=>{
 const f=fixture();const pending=f.broker.list();await tick();
 assert.equal(f.spawnCalls.length,1);assert.deepEqual(f.checks,[PS]);
 const call=f.spawnCalls[0];assert.equal(call.file,PS);assert.deepEqual(call.args.slice(0,4),['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand']);assert.equal(call.args.length,5);
 const worker=Buffer.from(call.args[4],'base64').toString('utf16le');
 assert(worker.includes('Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,ExecutablePath,CreationDate,CommandLine'));
 assert(worker.includes('explicitclose'));assert.match(worker,/-cne\s+'list'/);assert.match(worker,/\[Console\]::Out\.Flush\(\)/);
 assert.match(worker,/\$ProgressPreference='SilentlyContinue'/);
 assert(!/Invoke-Expression|Stop-Process|taskkill|Start-Process|Set-ExecutionPolicy/i.test(worker));
 assert.equal(call.opts.shell,false);assert.equal(call.opts.windowsHide,true);assert.deepEqual(call.opts.stdio,['pipe','pipe','pipe']);
 assert.equal(call.opts.env.SystemDrive,'C:');assert.equal(call.opts.env.PATHEXT,'.EXE');
 for(const key of ['NODE_OPTIONS','NODE_PATH','PATH','ELECTRON_RUN_AS_NODE','XJY_DATA_DIR'])assert.equal(call.opts.env[key],undefined,key);
 assert.equal(call.opts.env.PSModulePath,path.win32.join(path.win32.dirname(PS),'Modules'));
 assert.equal(f.tokens(),'list\n');f.respond([rawRow(101)]);assert.deepEqual(await pending,[mappedRow(101)]);
 await f.broker.close();assert.equal(f.stdinEnds,1);assert.equal(f.child.exitCode,0);assert.equal(f.kills,0);
});

test('three concurrent requests are FIFO with exactly one outstanding and a fresh response per request',async()=>{
 const f=fixture(),one=f.broker.list(),two=f.broker.list(),three=f.broker.list();await tick();assert.equal(f.tokens(),'list\n');
 const bytes=Buffer.from(JSON.stringify([rawRow(11)])+'\r\n','utf8'),split=bytes.indexOf(Buffer.from('鑫'))+1;
 f.child.stdout.write(bytes.subarray(0,split));await tick();assert.equal(f.tokens(),'list\n');
 f.child.stdout.write(bytes.subarray(split));assert.deepEqual(await one,[mappedRow(11)]);await tick();assert.equal(f.tokens(),'list\nlist\n');
 f.respond([rawRow(12)]);assert.deepEqual(await two,[mappedRow(12)]);await tick();assert.equal(f.tokens(),'list\nlist\nlist\n');
 f.respond([rawRow(13)]);assert.deepEqual(await three,[mappedRow(13)]);assert.equal(f.spawnCalls.length,1);
 await f.broker.close();assert.equal(f.kills,0);
});

test('close drains already queued requests, rejects new work, sends EOF once and waits for normal worker exit',async()=>{
 const f=fixture(),first=f.broker.list(),second=f.broker.list(),closing=f.broker.close();
 await assert.rejects(f.broker.list(),error=>error.code==='PROCESS_PROBE_CLOSED');await tick();assert.equal(f.stdinEnds,0);
 f.respond([]);assert.deepEqual(await first,[]);await tick();assert.equal(f.stdinEnds,0);
 f.respond([rawRow(2)]);assert.deepEqual(await second,[mappedRow(2)]);await closing;await f.broker.close();
 assert.equal(f.tokens(),'list\nlist\n');assert.equal(f.stdinEnds,1);assert.equal(f.kills,0);
});

test('closing an unused broker never creates a system process',async()=>{
 const f=fixture();await f.broker.close();await f.broker.close();assert.equal(f.spawnCalls.length,0);
 await assert.rejects(f.broker.list(),error=>error.code==='PROCESS_PROBE_CLOSED');
});

for(const [name,emit] of [
 ['malformed JSON',f=>f.child.stdout.write('{bad}\n')],
 ['invalid UTF8',f=>f.child.stdout.write(Buffer.from([0xff,0x0a]))],
 ['wrong row fields',f=>f.respond([{...rawRow(5),untrustedExtra:true}])],
 ['two responses for one request',f=>f.child.stdout.write('[]\n[]\n')],
 ['more than 8 MiB before a response delimiter',f=>f.child.stdout.write(Buffer.alloc(8388609,0x20))],
 ['worker error',f=>f.child.emit('error',Error('read-only worker failed'))],
 ['unexpected even-zero worker exit',f=>f.exit(0)]
])test('inventory fails closed without fallback or kill on '+name,async()=>{
 const f=fixture();const one=f.broker.list(),two=f.broker.list();const rejectedOne=assert.rejects(one,refused),rejectedTwo=assert.rejects(two,refused);await tick();emit(f);
 await Promise.all([rejectedOne,rejectedTwo]);await assert.rejects(f.broker.list(),refused);await f.cleanup();
 assert.equal(f.spawnCalls.length,1);assert.equal(f.kills,0);
});

test('request timeout permanently refuses the inventory, closes stdin and never restarts or kills it',async()=>{
 const f=fixture({requestTimeoutMs:25});await assert.rejects(f.broker.list(),refused);
 await assert.rejects(f.broker.list(),refused);await f.cleanup();assert.equal(f.spawnCalls.length,1);assert.equal(f.stdinEnds,1);assert.equal(f.kills,0);
});

test('a worker stuck after EOF cannot keep the failed helper referenced after bounded close',async()=>{
 const f=fixture({autoExit:false,requestTimeoutMs:25,closeTimeoutMs:25});
 await assert.rejects(f.broker.list(),refused);await assert.rejects(f.broker.close(),refused);
 assert.equal(f.stdinEnds,1);assert.equal(f.kills,0);assert.equal(f.unrefs,1);
 assert.equal(f.child.stdin.destroyed,true);assert.equal(f.child.stdout.destroyed,true);assert.equal(f.child.stderr.destroyed,true);
 await assert.rejects(f.broker.list(),refused);assert.equal(f.spawnCalls.length,1);
});

test('spawn error refuses queued requests without a second process attempt',async()=>{
 const f=fixture({spawnError:true});const a=assert.rejects(f.broker.list(),refused),b=assert.rejects(f.broker.list(),refused);
 await Promise.all([a,b]);await f.cleanup();assert.equal(f.spawnCalls.length,1);assert.equal(f.kills,0);
});

test('the inspectAll unit branch creates no inventory broker and every barrier call still inspects afresh',async()=>{
 let created=0,reads=0;
 const adapter=entry.createInitialProcessBarrier({installationDir:'C:\\Toy',executablePath:'C:\\Toy\\quote.exe',role:'employee',platform:'win32',helperPid:8,
  inspectAll:async()=>{reads++;return[];},inventoryBrokerFactory:()=>{created++;throw Error('Unit inspectAll must not create a worker');}});
 await adapter.assertClosed();await adapter.assertClosed();assert.equal(reads,2);assert.equal(created,0);assert.equal(typeof adapter.close,'function');await adapter.close();assert.equal(created,0);
});

test('the live barrier invokes the persistent inventory for every assertion and owns its normal close',async()=>{
 assert.equal(typeof entry.createInitialInventoryBroker,'function','Persistent inventory broker factory must exist before any native branch');
 let made=0,reads=0,closes=0;
 const adapter=entry.createInitialProcessBarrier({installationDir:'C:\\Toy',executablePath:'C:\\Toy\\quote.exe',role:'employee',platform:'win32',helperPid:8,
  inventoryBrokerFactory:()=>{made++;return{list:async()=>{reads++;return reads===2?[{pid:7,parentPid:1,executablePath:'C:\\Toy\\quote.exe',creationMarker:'new-live-process',commandLine:'quote'}]:[];},close:async()=>{closes++;}};}});
 assert.equal(made,0);await adapter.assertClosed();await assert.rejects(adapter.assertClosed(),error=>error.code==='PROGRAM_IN_USE');await adapter.assertClosed();
 assert.equal(made,1);assert.equal(reads,3);await adapter.close();assert.equal(closes,1);
});

test('runInitialPatch awaits operation and adapter.close on install/recover success and operation failure',async t=>{
 for(const scenario of [{mode:'install',failure:false},{mode:'recover',failure:false},{mode:'install',failure:true}]){
  const events=[];let built=0,closed=false;
  const fake=t.mock.method(core,'createInitialPatchInstaller',()=>++built===1?{inspect:async()=>({exe:'C:\\Toy\\quote.exe',install:'C:\\Toy',approval:{role:'employee'}})}:{
   [scenario.mode]:async()=>{events.push('operation');await delay(5);events.push('operation-finished');if(scenario.failure)throw Object.assign(Error('controlled operation failure'),{code:'TOY_FAILURE'});return{installed:true};}
  });
  const adapter={getCurrent:async()=>({pid:8,creationMarker:'fixture'}),close:async()=>{events.push('close');await delay(5);closed=true;events.push('closed');}};
  const operation=entry.runInitialPatch({artifactDir:'C:\\ToyPatch',approvalRoot:'C:\\ToyApproval',osUser:'S-1-5-21-123',currentExecutable:'C:\\Toy\\quote.exe',roleConfirmed:'employee',mode:scenario.mode,
   environment:{ELECTRON_RUN_AS_NODE:'1',XJY_INITIAL_APPROVAL_LAUNCH:'1'},processAdapter:adapter});
  if(scenario.failure)await assert.rejects(operation,error=>error.code==='TOY_FAILURE');else assert.deepEqual(await operation,{installed:true});
  assert.equal(closed,true);assert.deepEqual(events,['operation','operation-finished','close','closed']);fake.mock.restore();
 }
});

test('actual Guest system PowerShell performs ten fresh full inventories in one normally closed process',{
 skip:process.env.XJY_BROKER_ACTUAL_GUEST!=='1'
},async t=>{
 const guard=spawnSync('C:/Python314/python.exe',['-I','-B','-X','utf8','C:/xjy-work/xjy-web-stage1/stage1/validate-sandbox-context.py'],{encoding:'utf8',windowsHide:true,shell:false,timeout:40000});
 assert.equal(guard.status,0,guard.stderr);const actual=JSON.parse(guard.stdout);
 assert.equal(actual.model,'Virtual Machine');assert.equal(actual.productionDrivePresent,false);assert.equal(actual.nonLoopbackAddressCount,0);assert.match(actual.userName,/\\WDAGUtilityAccount$/i);
 let starts=0,child,kills=0;
 const broker=entry.createInitialInventoryBroker({environment:process.env,spawnAdapter:(file,args,opts)=>{
  starts++;child=spawn(file,args,opts);child.kill=()=>{kills++;throw Error('Actual inventory QA forbids kill');};return child;
 }});
 const started=Date.now(),counts=[];
 try{for(let n=0;n<10;n++){const rows=await broker.list();assert(Array.isArray(rows));assert(rows.some(row=>row.pid===process.pid));counts.push(rows.length);}}
 finally{await broker.close();}
 assert.equal(starts,1);assert.equal(child.exitCode,0);assert.equal(child.signalCode,null);assert.equal(kills,0);
 t.diagnostic(JSON.stringify({actualGuest:true,queries:10,workerStarts:starts,rowCounts:counts,elapsedMs:Date.now()-started,normalExitCode:child.exitCode,kills}));
});

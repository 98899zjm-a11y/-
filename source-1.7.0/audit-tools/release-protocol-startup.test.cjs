'use strict';
// Real entry + real release-app module glue in one VM. Electron, recovery and
// unrelated business boundaries are doubles. No real app, SQL, helper or socket.
const fs=process.versions.electron?require('original-fs'):require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'..'),sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
if(process.platform!=='win32'||ROOT.toLowerCase()!=='c:\\xjy-work\\xjy-web-stage1')throw Error('Fixed actual no-F Guest required');
const PINS={
 'stage1/guest-candidate-cdp.cjs':'59840b638d8797fb55241616cd0b8e4098075a76834a201b0e93c1a748f1bb32',
 'tests/release-entry-recovery.test.cjs':'dde7600033d68edf077cebbeec6cd6762b3f5db7d346320ca293fcc870978344',
 'tests/native-update-fixtures.cjs':'c3a63f79be90ccaccf56bf6ce821ec6d75d9c237026ba01151463a68b04b7b19',
 'tests/employee-update-fixtures.cjs':'c8b7b124ea0523257c564161dcea18698ab8a0a00db9f73ebcb4fea333eab572',
 'project/desktop/build-update-helper.cjs':'f1c4dde58b537361c0a1cfd9aadc4423571bbddfabab9ab06b8d4e068ea1024d',
 'project/desktop/employee-update-cache.cjs':'5cb70079bf161a002a2701694e4774c2a11bf8d54efc6674ccb5c7b2c6729815',
 'project/desktop/employee-update-installer.cjs':'96ba3df08a0f706e599da7d452374b1f894d401c0a6ff605fc01255d01445bd0'
};
for(const [file,pin]of Object.entries(PINS))if(sha(fs.readFileSync(path.join(ROOT,file)))!==pin)throw Error('Frozen input changed: '+file);
require('../stage1/guest-candidate-cdp.cjs').actualGuard();
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
assert.equal(sha(fs.readFileSync(__filename)),process.env.XJY_PROTOCOL_STARTUP_TEST_SHA256,'Root must pin this test');
const ENTRY=path.join(ROOT,'project/desktop/release-entry.cjs'),APP=path.join(ROOT,'project/desktop/release-app.cjs');
assert.equal(sha(fs.readFileSync(ENTRY)),process.env.XJY_PROTOCOL_ENTRY_SHA256,'Root must pin actual entry');
assert.equal(sha(fs.readFileSync(APP)),process.env.XJY_PROTOCOL_APP_SHA256,'Root must pin actual app glue');
const {installedUpdate}=require('../tests/native-update-fixtures.cjs');
const EXPECTED=[{scheme:'jewelry',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}}];
const clone=value=>JSON.parse(JSON.stringify(value));
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};}
async function fixture(t,settings={}){
 // Reuse the original installed fixture; retain it rather than invoking its
 // normal recursive after-cleanup. It contains toy bytes, never an executable.
 const f=await installedUpdate({after:()=>{}});await fs.promises.writeFile(path.join(f.profile,'launch-role.json'),'{"role":"employee"}');
 if(settings.host)await fs.promises.writeFile(path.join(f.install,'xjy-install-activation.json'),JSON.stringify({...f.activation,role:'host'}));
 const calls=[],registrations=[],events=new Map(),gateEntered=deferred(),modules=new Map();
 const fileSystem={...fs,existsSync:file=>/^[Ff]:/.test(String(file))?false:String(file).endsWith('isolation-identity.json')?false:fs.existsSync(file)};
 const app={ready:false,isPackaged:settings.packaged!==false,isReady(){return this.ready;},getVersion:()=>f.currentVersion,getPath:name=>name==='exe'?f.exe:f.profile,setPath:(name,value)=>calls.push(['setPath',name,value]),requestSingleInstanceLock:()=>{calls.push(['lock']);return !settings.duplicate;},quit:()=>calls.push(['quit']),exit:code=>calls.push(['exit',code]),on:(name,fn)=>events.set(name,fn),whenReady:()=>new Promise(()=>{})};
 const protocol={registerSchemesAsPrivileged:input=>{registrations.push({input:clone(input),ready:app.ready});calls.push(['protocol']);assert.equal(app.ready,false,'protocol registration occurred after app readiness');assert.equal(registrations.length,1,'the real entry/app chain must register jewelry once');assert.deepEqual(clone(input),EXPECTED,'the original exact privileges must be preserved');if(settings.protocolFailure)throw Error('synthetic protocol rejection');}};
 const electron={app,protocol,dialog:{showErrorBox:(title,message)=>calls.push(['dialog',message])},ipcMain:{handle:()=>{},on:()=>{}},session:{},safeStorage:{}};
 const storage={root:f.root,profileDir:f.profile,dataDir:settings.host?path.join(f.root,'data'):null,employeeClient:!settings.host,imageDir:path.join(f.profile,'images')};
 const forbiddenFs=new Proxy({},{get:(_target,key)=>{throw Error('Unrelated app filesystem access: '+String(key));}});
 const appBoundaries={
  './network-workspace.cjs':{},'./storage-locations.cjs':{},'./release-host-services.cjs':{},'./native-employee-update.cjs':{},
  './release-storage.cjs':{resolveReleaseStorage:()=>storage},'./app-info.cjs':{createAppInfoProvider:()=>({getAppInfo:()=>({appVersion:f.currentVersion})})},
  './print-settings.cjs':{createPrintSettings:()=>({read:()=>({})})},'./image-output.cjs':{createImageOutput:()=>({})},
  './credentials.cjs':{createLoginMemory:()=>({}),createLoginReceipt:()=>({clear(){}}),scopeForConnection:()=>''},
  './clipboard-output.cjs':{},'./warranty-docx.cjs':{},'./module-views.cjs':{},'./backup.cjs':{},'./generated/release-pins.cjs':f.helperPins
 };
 const context=vm.createContext({console,Buffer,URL,Response,Headers,process:{argv:[],env:{},platform:'win32',pid:4242,resourcesPath:path.join(f.install,'resources')},setTimeout:()=>{throw Error('No unrelated timer');},clearTimeout(){},setImmediate:()=>{throw Error('No unrelated exit/worker scheduling');}});
 function evaluate(file,appModule=false){
  if(modules.has(file))return modules.get(file).exports;const module={exports:{}};modules.set(file,module);
  const boundary=name=>{if(name==='electron')return electron;if(name==='node:path')return path;if(name==='node:fs')return appModule?forbiddenFs:fileSystem;if(name==='node:child_process')return{spawnSync(){throw Error('No internal OS execution');}};if(appModule&&Object.hasOwn(appBoundaries,name))return appBoundaries[name];throw Error('Unregistered VM dependency '+name);};
  vm.runInContext('(function(require,module,exports,__dirname){'+fs.readFileSync(file,'utf8')+'\n})',context,{filename:file,timeout:3000})(boundary,module,module.exports,path.dirname(file));return module.exports;
 }
 const recovery={resolveKnownEmployeeProfile:async()=>{calls.push(['resolve']);return settings.profilePause?settings.profilePause.promise:f.profile;},runEmployeeRecoveryGate:async()=>{calls.push(['gate']);gateEntered.resolve();return settings.gatePause?settings.gatePause.promise:settings.gate||{requiresExit:false,blocked:false};}};
 const requireProgram=name=>{calls.push(['require',name]);if(name==='./release-admission.cjs')return evaluate(path.join(ROOT,'project/desktop/release-admission.cjs'));if(name==='./employee-recovery-entry.cjs')return recovery;if(name==='./generated/release-pins.cjs')return f.helperPins;if(name==='./print-worker-entry.cjs')return{runStandalone:async()=>{calls.push(['worker']);}};if(name==='./release-app.cjs'){calls.push(['business-import']);const value=evaluate(APP,true);calls.push(['app-evaluated']);return value;}throw Error('Unregistered entry dependency '+name);};
 const opts={requireProgram,fileSystem,codeDir:path.join(f.install,'resources','app.asar'),environment:{},argv:[],globalObject:context,initialUpgradeGate:()=>{calls.push(['initialGate']);return settings.initialStatus||{blocked:false};}};
 if(settings.packaged===false){opts.environment={XJY_RELEASE_TEST_ROOT:f.root,XJY_DATA_DIR:path.join(f.root,'data/sales')};opts.argv=['--employee-client'];opts.validateSandbox=()=>{calls.push(['actualSandbox']);if(settings.rejectSandbox)throw Error('synthetic context rejection');return{sandbox:true};};}
 context.process.argv=opts.argv;if(settings.worker)opts.argv.push('--xjy-print-worker');
 const start=evaluate(ENTRY).startReleaseEntry;assert.equal(typeof start,'function');
 return{...f,app,context,calls,registrations,gateEntered,options:opts,start:()=>start(opts),count:name=>calls.filter(row=>row[0]===name).length};
}
function registered(f){assert.equal(f.registrations.length,1,'jewelry must register synchronously before the first recovery await');assert.equal(f.registrations[0].ready,false);assert.deepEqual(f.registrations[0].input,EXPECTED);}
function releaseAfter(t,pause,pending,value){t.after(async()=>{pause.resolve(value);await pending.catch(()=>{});});}

test('S01 delayed known-profile lookup cannot move real scheme registration past the first await or duplicate it in real app glue',async t=>{
 const pause=deferred(),f=await fixture(t,{profilePause:pause}),pending=f.start();releaseAfter(t,pause,pending,f.profile);
 registered(f);assert.ok(f.calls.findIndex(x=>x[0]==='protocol')<f.calls.findIndex(x=>x[0]==='resolve'));
 f.app.ready=true;pause.resolve(f.profile);const result=await pending;assert.equal(result.mode,'installed');assert.equal(f.count('app-evaluated'),1);registered(f);
});
test('S02 delayed recovery completion after app readiness still loads the actual release-app with one original registration',async t=>{
 const pause=deferred(),f=await fixture(t,{gatePause:pause}),pending=f.start();releaseAfter(t,pause,pending,{requiresExit:false,blocked:false});await f.gateEntered.promise;
 registered(f);f.app.ready=true;pause.resolve({requiresExit:false,blocked:false});const result=await pending;assert.equal(result.mode,'installed');assert.equal(f.count('app-evaluated'),1);registered(f);
});
test('S03 synchronous Host path registers before importing real app glue and preserves exactly-once registration',async t=>{
 const f=await fixture(t,{host:true}),result=await f.start();assert.equal(result.mode,'installed');registered(f);assert.equal(f.count('resolve'),0);assert.equal(f.count('gate'),0);assert.equal(f.count('app-evaluated'),1);
 assert.ok(f.calls.findIndex(x=>x[0]==='protocol')<f.calls.findIndex(x=>x[0]==='business-import'),'entry must own pre-import registration');
});
test('S04 blocked or scheduled recovery after a ready transition never imports business and preserves the early registration',async t=>{
 for(const gate of [{requiresExit:false,blocked:true,message:'synthetic blocked recovery'},{requiresExit:true,blocked:false}]){
  const pause=deferred(),f=await fixture(t,{gatePause:pause}),pending=f.start();releaseAfter(t,pause,pending,gate);await f.gateEntered.promise;registered(f);f.app.ready=true;pause.resolve(gate);const result=await pending;
  assert.equal(f.count('business-import'),0);assert.equal(f.context.__xjyReleaseAdmission,undefined);assert.equal(gate.blocked?result.blocked:result.requiresExit,true);registered(f);
 }
});
test('S05 protocol rejection, rejected actual-context boundary and initial upgrade gate cannot import business or access recovery',async t=>{
 for(const settings of [{protocolFailure:true},{packaged:false,rejectSandbox:true},{initialStatus:{blocked:true,message:'synthetic initial gate'}}]){
  const f=await fixture(t,settings),result=await f.start();assert.equal(result.blocked,true);assert.equal(f.count('business-import'),0);assert.equal(f.count('resolve'),0);assert.equal(f.count('gate'),0);assert.equal(f.count('lock'),0);assert.equal(f.count('exit'),1);assert.equal(f.context.__xjyReleaseAdmission,undefined);
  assert.ok(f.registrations.length<=1);for(const row of f.registrations){assert.equal(row.ready,false);assert.deepEqual(row.input,EXPECTED);}
 }
});
test('S06 print worker does not register jewelry or load business; a delayed duplicate quits itself before recovery/business',async t=>{
 const worker=await fixture(t,{worker:true}),result=await worker.start();assert.equal(result.mode,'worker');assert.equal(worker.count('worker'),1);assert.equal(worker.registrations.length,0);assert.equal(worker.count('business-import'),0);assert.equal(worker.count('initialGate'),0);
 const pause=deferred(),f=await fixture(t,{profilePause:pause,duplicate:true}),pending=f.start();releaseAfter(t,pause,pending,f.profile);registered(f);f.app.ready=true;pause.resolve(f.profile);const duplicate=await pending;
 assert.equal(duplicate.mode,'duplicate');assert.equal(f.count('quit'),1);assert.equal(f.count('gate'),0);assert.equal(f.count('business-import'),0);registered(f);
});

'use strict';
// Source-level entry sequencing in the real admitted Guest. All application,
// filesystem and printing calls below are inert fakes, never business imports.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),vm=require('node:vm');
const ROOT=path.resolve(__dirname,'..'),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
if(process.platform!=='win32'||os.userInfo().username.toLowerCase()!=='wdagutilityaccount'||ROOT.toLowerCase()!=='c:\\xjy-work\\xjy-web-stage1')throw Error('Fixed actual Guest required');
const guard=require('../stage1/isolation.cjs').createIsolationGuard(ROOT);
for(const [rel,sha] of Object.entries({'stage1/sandbox-context.py':'09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249','stage1/validate-sandbox-context.py':'867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207'}))if(hash(fs.readFileSync(guard.assertPath(path.join(ROOT,rel))))!==sha)throw Error('Original admission changed');
const py='C:/Python314/python.exe';if(hash(fs.readFileSync(py))!=='434b361fe0c5960d404974feed493db47f2603a1ace2574312104fbed0182c6f')throw Error('Python pin changed');
JSON.parse(require('node:child_process').execFileSync(py,['-I','-B','-S',guard.assertPath(path.join(ROOT,'stage1/validate-sandbox-context.py'))],{cwd:ROOT,windowsHide:true,encoding:'utf8'}));
const test=require('node:test'),assert=require('node:assert/strict');
const subjectPath=path.join(ROOT,'audit-tools/desktop-first170-entry-subject.cjs'),raw=fs.readFileSync(guard.assertPath(subjectPath));
if(!/^[a-f0-9]{64}$/.test(process.env.XJY_ENTRY_SUBJECT_SHA256||'')||hash(raw)!==process.env.XJY_ENTRY_SUBJECT_SHA256)throw Error('Exact entry source required');
const moduleBox={exports:{}};vm.runInThisContext('(function(require,module,exports,__dirname){'+raw.toString('utf8')+'\n})',{filename:subjectPath})(require,moduleBox,moduleBox.exports,path.dirname(subjectPath));
const start=moduleBox.exports.startReleaseEntry;
function fixture({role='employee',blocked=false,printing=false,badSandbox=false}={}){
 const calls=[],install='C:\\fictional-xjy\\program',exe=path.join(install,'jewelry.exe'),profile='C:\\fictional-xjy\\profile';
 const activation=Buffer.from(JSON.stringify({version:1,product:'xjy-jewelry-offline',programVersion:'1.7.0',role,installationDir:install}));
 const fakeFs={existsSync:p=>!String(p).startsWith('F:')&&!String(p).endsWith('isolation-identity.json'),realpathSync:{native:p=>path.resolve(p)},
  lstatSync:p=>({dev:1,ino:2,nlink:1,size:activation.length,mtimeMs:1,ctimeMs:1,isSymbolicLink:()=>false,isDirectory:()=>!/[.](exe|json|asar)$/.test(String(p)),isFile:()=>/[.](exe|json|asar)$/.test(String(p))}),
  openSync:()=>77,fstatSync:()=>({dev:1,ino:2,nlink:1,size:activation.length,mtimeMs:1,ctimeMs:1}),readFileSync:fd=>{assert.equal(fd,77);return activation;},closeSync:fd=>assert.equal(fd,77)};
 const app={isPackaged:!badSandbox,getVersion:()=> '1.7.0',getPath:name=>name==='exe'?exe:profile,setPath:()=>calls.push('profile'),requestSingleInstanceLock:()=>true,quit:()=>calls.push('quit'),exit:()=>calls.push('exit')};
 const options={app,protocol:{registerSchemesAsPrivileged:()=>calls.push('normal-protocol')},dialog:{showErrorBox:()=>calls.push('error')},fileSystem:fakeFs,codeDir:path.join(install,'resources/app.asar'),environment:badSandbox?{XJY_RELEASE_TEST_ROOT:'C:/fictional-xjy'}:{},argv:printing?['--xjy-print-worker']:[],globalObject:{},
  engineUpgradeGate:input=>{calls.push('engine');assert.equal(input.programVersion,'1.7.0');assert.equal(input.installedRole,role);assert.equal(input.installDir,install);return {blocked,message:'synthetic held update'};},
  initialUpgradeGate:()=>{calls.push('initial');return{blocked:false};},
  requireProgram:name=>{
   if(name==='./release-admission.cjs')return{admitRelease:()=>{calls.push('admit');if(badSandbox)throw Error('Synthetic rejected sandbox proof');return{mode:'installed',role};}};
   if(name==='./employee-recovery-entry.cjs')return{resolveKnownEmployeeProfile:async()=>{calls.push('resolve');return profile;},runEmployeeRecoveryGate:async()=>{calls.push('employee-recovery');return{};}};
   if(name==='./generated/release-pins.cjs')return{};
   if(name==='./release-app.cjs'){calls.push('business');return{};}
   if(name==='./print-worker-entry.cjs')return{runStandalone:async()=>calls.push('print-worker')};
   throw Error('Unexpected dependency '+name);
  }};
 return{options,calls};
}
test('E01 held170 blocks both roles before profile, employee recovery or business',async()=>{
 for(const role of ['employee','host']){const f=fixture({role,blocked:true});const r=await start(f.options);assert.equal(r.blocked,true);assert.ok(f.calls.includes('engine'));assert.ok(!f.calls.some(x=>['profile','resolve','employee-recovery','business'].includes(x)));}
});
test('E02 print child cannot bypass the held170 startup gate',async()=>{
 const f=fixture({printing:true,blocked:true}),r=await start(f.options);assert.equal(r.blocked,true);assert.ok(f.calls.includes('engine'));assert.ok(!f.calls.includes('print-worker'));assert.ok(!f.calls.includes('normal-protocol'));
});
test('E03 committed170 reaches original business only after gate and keeps early normal protocol',async()=>{
 for(const role of ['employee','host']){const f=fixture({role}),r=await start(f.options);assert.equal(r.mode,'installed');assert.equal(f.calls.filter(x=>x==='business').length,1);assert.ok(f.calls.indexOf('engine')>=0);assert.ok(f.calls.indexOf('engine')<f.calls.indexOf('business'));assert.ok(f.calls.indexOf('normal-protocol')<f.calls.indexOf('engine'));}
});
test('E04 permitted print child has gate and its own protocol without main business',async()=>{
 const f=fixture({printing:true}),r=await start(f.options);assert.equal(r.mode,'worker');assert.ok(f.calls.indexOf('engine')>=0);assert.ok(f.calls.indexOf('engine')<f.calls.indexOf('print-worker'));assert.ok(!f.calls.some(x=>['normal-protocol','business','employee-recovery'].includes(x)));
});
test('E05 rejected actual-sandbox admission also prevents print branch',async()=>{
 const f=fixture({printing:true,badSandbox:true}),r=await start(f.options);assert.equal(r.blocked,true);assert.ok(f.calls.includes('admit'));assert.ok(!f.calls.includes('print-worker'));
});

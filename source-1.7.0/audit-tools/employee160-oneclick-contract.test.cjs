'use strict';
// Source/behavior contracts only. Root owns actual Guest and full workflow tests.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),test=require('node:test'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..'),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
if(process.platform!=='win32'||ROOT.toLowerCase()!=='c:\\xjy-work\\xjy-web-stage1')throw Error('Fixed actual Guest required');
assert.equal(sha(fs.readFileSync(__filename)),process.env.XJY_ONECLICK160_TEST_SHA256,'Root must pin this test');
const guard=path.join(ROOT,'stage1/guest-candidate-cdp.cjs');assert.equal(sha(fs.readFileSync(guard)),'59840b638d8797fb55241616cd0b8e4098075a76834a201b0e93c1a748f1bb32');require(guard).actualGuard();
const SUBJECT=path.join(ROOT,'audit-tools/employee160-oneclick-worker.cjs');
function subject(){assert(fs.existsSync(SUBJECT),'ONECLICK_WORKER_REQUIRED: actual worker source is missing');assert.equal(sha(fs.readFileSync(SUBJECT)),process.env.XJY_ONECLICK160_WORKER_SHA256,'Root must pin worker source');return require(SUBJECT);}
test('C01 only five fixed operations and exact install/self arguments are accepted',()=>{
 const api=subject();
 for(const phase of ['check','prepare','handoff','finish','launch162'])assert.equal(api.argumentsOf(['--phase',phase,'--installation-dir','C:\\Employees\\Program','--source-sha256','a'.repeat(64)]).phase,phase);
 for(const args of [[],['--phase','sign'],['--phase','check','--installation-dir','C:\\A','--source-sha256','0'.repeat(64)],['--phase','check','--installation-dir','C:\\A','--source-sha256','a'.repeat(64),'--output','F:\\A']])assert.throws(()=>api.argumentsOf(args));
});
test('C02 exact employee activation is required and cannot turn Host into employee',()=>{
 const api=subject(),a={version:1,product:'xjy-jewelry-offline',programVersion:'1.6.0',role:'employee',installationDir:'C:\\Employees\\Program'};
 assert.equal(api.validateActivation(a,'C:\\Employees\\Program','1.6.0'),true);
 for(const changed of [{...a,role:'host'},{...a,programVersion:'1.5.1'},{...a,installationDir:'C:\\Other'},{...a,extra:true}])assert.throws(()=>api.validateActivation(changed,'C:\\Employees\\Program','1.6.0'));
});
test('C03 independent sequence11 remains unbound and exact v7 sources are pinned',()=>{
 const api=subject(),r=api.releaseConfig();assert.equal(r.sequence,11);assert.equal(r.bound,false);assert.equal(r.compatibilityHelperVerified,false);for(const k of ['catalogSha256','policySha256','treeSha256'])assert.equal(r[k],'0'.repeat(64));
 assert.equal(r.sourceVersion,'1.6.0');assert.deepEqual(r.sourceAsar,{size:12449330,sha256:'ea677d9ea14583a01161ac9b27eba2e0d490ab28d1cb24ebbff42c7fa7afc9ef'});
 assert.equal(r.preflight,'audit-tools/employee160-rescue-preflight.cjs');assert.equal(r.controller,'audit-tools/employee160-rescue-controller.cjs');
 for(const name of [r.preflight,r.controller,'audit-tools/employee160-utf8-compat-helper.cjs'])assert.equal(r.codePins[name],sha(fs.readFileSync(path.join(ROOT,name))));assert(!Object.keys(r.codePins).some(k=>k.includes('employee161-')));
 assert.throws(()=>api.requireBoundRelease(),e=>e.code==='UNBOUND_RELEASE');
});

test('C04 a real non-Electron test process cannot impersonate the installed original engine',()=>{assert.throws(()=>subject().requireRuntime(),e=>e.code==='UNTRUSTED_LAUNCH');});
test('C05 permission, in-use, pending and handoff messages distinguish safe stop from completion',()=>{
 const api=subject();for(const code of ['EACCES','PROGRAM_IN_USE','RECOVERY_REQUIRED','HANDOFF_FAILED','UNBOUND_RELEASE']){const text=api.chineseError(code);assert(text&&/[\u3400-\u9fff]/.test(text));assert(!text.includes('升级成功'));}
});
test('C06 shipping worker does not use the Guest parent, bypass policies, generate private keys or force exit',()=>{
 subject();const text=fs.readFileSync(SUBJECT,'utf8');assert(!/employee161-native-parent|ExecutionPolicy\s+Bypass|Set-ExecutionPolicy|taskkill|\.kill\(|process\.exit\(/i.test(text));assert(!/crypto\.(?:sign|generateKeyPair)/.test(text));assert(text.includes('runEmployee160RescuePreflight'));assert(text.includes('runEmployee160Rescue'));assert(text.includes('authenticatedRead'));
});
test('C07 check/prepare results from another publication, install or version cannot authorize the next phase',()=>{
 const api=subject(),install='C:\\Employees\\Program',r=api.releaseConfig(),facts={checked:true,prepared:true,publicationId:r.catalogSha256,sourceVersion:r.sourceVersion,targetVersion:r.version,installationDir:install};
 assert.equal(api.validatePreflightResult(facts,install,true),true);
 for(const changed of [{...facts,checked:false},{...facts,prepared:false},{...facts,publicationId:'a'.repeat(64)},{...facts,sourceVersion:'1.5.1'},{...facts,targetVersion:'1.6.0'},{...facts,installationDir:'C:\\Other'}])assert.throws(()=>api.validatePreflightResult(changed,install,true),e=>e.code==='PREFLIGHT_FAILED');
});
test('C08 handoff must carry the exact sequence and owned-helper identity rather than readiness alone',()=>{
 const api=subject(),exe='C:\\Employees\\Program\\鑫金源珠宝报价.exe',result={scheduled:true,requiresNormalExit:true,sequence:11,ownedHelper:{pid:1234,creationMarker:'2026-10-19T07:00:00.0000000Z',executablePath:exe}};
 assert.equal(api.validateHandoffResult(result,exe),true);
 for(const changed of [{...result,sequence:9},{...result,ownedHelper:undefined},{...result,ownedHelper:{...result.ownedHelper,pid:0}},{...result,ownedHelper:{...result.ownedHelper,creationMarker:''}},{...result,ownedHelper:{...result.ownedHelper,executablePath:'C:\\Other\\鑫金源珠宝报价.exe'}}])assert.throws(()=>api.validateHandoffResult(changed,exe),e=>e.code==='HANDOFF_FAILED');
});

test('C09 launcher identifies 160 explicitly and pins worker plus exact dependency closure',()=>{
 subject();const file=path.join(ROOT,'audit-tools/employee160-oneclick-launcher.cs');assert.equal(sha(fs.readFileSync(file)),process.env.XJY_ONECLICK160_LAUNCHER_SHA256);const text=fs.readFileSync(file,'utf8');assert(text.includes('1.6.0 员工端一键升级至 1.6.2'));assert(!text.includes('employee161-'));assert(text.includes('employee160-oneclick-worker.cjs'));
 const worker=text.match(/const string WorkerSha="([a-f0-9]{64})";/);assert(worker);assert.equal(worker[1],sha(fs.readFileSync(SUBJECT)));const rows=JSON.parse(Buffer.from(text.match(/const string ClosureRows="([^"]+)";/)[1],'base64').toString('utf8'));for(const row of rows){const bytes=fs.readFileSync(path.join(ROOT,row.path));assert.equal(bytes.length,row.size);assert.equal(sha(bytes),row.sha256);}const canonical=rows.map(row=>row.path+'\0'+row.size+'\0'+row.sha256+'\n').join('');assert.equal(sha(Buffer.from(canonical)),text.match(/const string ClosureSha="([a-f0-9]{64})";/)[1]);assert(text.includes('if(!Yes(release,"bound")||!Yes(release,"compatibilityHelperVerified"))'));assert(text.indexOf('if(!Yes(release,"bound")')<text.indexOf('VerifyClosure();PinReleaseData(release)'));
});

'use strict';
// Source/behavior contracts only. Root owns actual Guest and full workflow tests.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),test=require('node:test'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..'),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
if(process.platform!=='win32'||ROOT.toLowerCase()!=='c:\\xjy-work\\xjy-web-stage1')throw Error('Fixed actual Guest required');
assert.equal(sha(fs.readFileSync(__filename)),process.env.XJY_ONECLICK_TEST_SHA256,'Root must pin this test');
const guard=path.join(ROOT,'stage1/guest-candidate-cdp.cjs');assert.equal(sha(fs.readFileSync(guard)),'59840b638d8797fb55241616cd0b8e4098075a76834a201b0e93c1a748f1bb32');require(guard).actualGuard();
const SUBJECT=path.join(ROOT,'audit-tools/employee161-oneclick-worker-a2.cjs');
function subject(){assert(fs.existsSync(SUBJECT),'ONECLICK_WORKER_REQUIRED: actual worker source is missing');assert.equal(sha(fs.readFileSync(SUBJECT)),process.env.XJY_ONECLICK_WORKER_SHA256,'Root must pin worker source');return require(SUBJECT);}
test('C01 only five fixed operations and exact install/self arguments are accepted',()=>{
 const api=subject();
 for(const phase of ['check','prepare','handoff','finish','launch162'])assert.equal(api.argumentsOf(['--phase',phase,'--installation-dir','C:\\Employees\\Program','--source-sha256','a'.repeat(64)]).phase,phase);
 for(const args of [[],['--phase','sign'],['--phase','check','--installation-dir','C:\\A','--source-sha256','0'.repeat(64)],['--phase','check','--installation-dir','C:\\A','--source-sha256','a'.repeat(64),'--output','F:\\A']])assert.throws(()=>api.argumentsOf(args));
});
test('C02 exact employee activation is required and cannot turn Host into employee',()=>{
 const api=subject(),a={version:1,product:'xjy-jewelry-offline',programVersion:'1.6.1',role:'employee',installationDir:'C:\\Employees\\Program'};
 assert.equal(api.validateActivation(a,'C:\\Employees\\Program','1.6.1'),true);
 for(const changed of [{...a,role:'host'},{...a,programVersion:'1.5.1'},{...a,installationDir:'C:\\Other'},{...a,extra:true}])assert.throws(()=>api.validateActivation(changed,'C:\\Employees\\Program','1.6.1'));
});
test('C03 only a4 sequence10 metadata and the exact new preflight/controller are configured',()=>{
 const api=subject(),r=api.releaseConfig();assert.equal(r.sequence,10);assert.equal(r.catalogSha256,'898e15209abeddd038eeb353a27dd1cb3526148419558ea6f1d53c298a3aa9a8');
 assert.equal(r.preflight,'audit-tools/employee161-rescue-preflight-a4.cjs');assert.equal(r.codePins[r.preflight],'980441c0f7972cbd3d53ac0d8daae54d3c6130514f3600f79abb7d6badba4374');assert.equal(r.codePins[r.controller],'ce4c5ea6815c86217bdef1b42d261c8fba730f2898be0381c5dfca69c8a1dc4f');
 if(r.bound&&r.compatibilityHelperVerified)assert.doesNotThrow(()=>api.requireBoundRelease());else assert.throws(()=>api.requireBoundRelease(),e=>e.code==='UNBOUND_RELEASE');
});
test('C04 a real non-Electron test process cannot impersonate the installed original engine',()=>{assert.throws(()=>subject().requireRuntime(),e=>e.code==='UNTRUSTED_LAUNCH');});
test('C05 permission, in-use, pending and handoff messages distinguish safe stop from completion',()=>{
 const api=subject();for(const code of ['EACCES','PROGRAM_IN_USE','RECOVERY_REQUIRED','HANDOFF_FAILED','UNBOUND_RELEASE']){const text=api.chineseError(code);assert(text&&/[\u3400-\u9fff]/.test(text));assert(!text.includes('升级成功'));}
});
test('C06 shipping worker does not use the Guest parent, bypass policies, generate private keys or force exit',()=>{
 subject();const text=fs.readFileSync(SUBJECT,'utf8');assert(!/employee161-native-parent|ExecutionPolicy\s+Bypass|Set-ExecutionPolicy|taskkill|\.kill\(|process\.exit\(/i.test(text));assert(!/crypto\.(?:sign|generateKeyPair)/.test(text));assert(text.includes('runEmployee161RescuePreflight'));assert(text.includes('runEmployee161Rescue'));assert(text.includes('authenticatedRead'));
});
test('C07 check/prepare results from another publication, install or version cannot authorize the next phase',()=>{
 const api=subject(),install='C:\\Employees\\Program',r=api.releaseConfig(),facts={checked:true,prepared:true,publicationId:r.catalogSha256,sourceVersion:r.sourceVersion,targetVersion:r.version,installationDir:install};
 assert.equal(api.validatePreflightResult(facts,install,true),true);
 for(const changed of [{...facts,checked:false},{...facts,prepared:false},{...facts,publicationId:'a'.repeat(64)},{...facts,sourceVersion:'1.5.1'},{...facts,targetVersion:'1.6.1'},{...facts,installationDir:'C:\\Other'}])assert.throws(()=>api.validatePreflightResult(changed,install,true),e=>e.code==='PREFLIGHT_FAILED');
});
test('C08 handoff must carry the exact sequence and owned-helper identity rather than readiness alone',()=>{
 const api=subject(),exe='C:\\Employees\\Program\\鑫金源珠宝报价.exe',result={scheduled:true,requiresNormalExit:true,sequence:10,ownedHelper:{pid:1234,creationMarker:'2026-10-19T07:00:00.0000000Z',executablePath:exe}};
 assert.equal(api.validateHandoffResult(result,exe),true);
 for(const changed of [{...result,sequence:9},{...result,ownedHelper:undefined},{...result,ownedHelper:{...result.ownedHelper,pid:0}},{...result,ownedHelper:{...result.ownedHelper,creationMarker:''}},{...result,ownedHelper:{...result.ownedHelper,executablePath:'C:\\Other\\鑫金源珠宝报价.exe'}}])assert.throws(()=>api.validateHandoffResult(changed,exe),e=>e.code==='HANDOFF_FAILED');
});

'use strict';
// Pure RAM tests of exact public source. No OS files are created, no Guest,
// business module, installer, SQLite, key, permission or process is invoked.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),test=require('node:test'),assert=require('node:assert/strict');
const W=String.raw`E:\codex\2026-10-15\work\xjy-v16-deep-audit`,D=path.join(W,'release-work/deepseek-stage1-development-a1');
const [corePath,runtimePath]=process.argv.slice(2);assert.equal(process.argv.length,4,'two exact source arguments');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const cache=fs.readFileSync(path.join(D,'handoff-input/c26-history-path-task-a1/employee-update-cache-reference.cjs'));
assert.equal(sha(cache),'5cb70079bf161a002a2701694e4774c2a11bf8d54efc6674ccb5c7b2c6729815');
const line=cache.toString('utf8').split(/\r?\n/).filter(s=>s.startsWith('function safeRelative('));assert.equal(line.length,1);
const safeRelative=vm.runInNewContext('('+line[0]+')',{}, {timeout:1000});
const fail=(code,message)=>{throw Object.assign(Error(message||code),{code});};
const u={safeRelative,fail,safeAbsolute:s=>path.resolve(s),digest:sha,
 assertPath:async(io,p)=>io.__entry(p).stat,
 openChecked:async(io,p)=>({handle:{entry:io.__entry(p),close:async()=>{}},identity:'ram-fixture'}),
 assertHandle:async(io,o)=>({size:BigInt(o.handle.entry.body.length)}),hashHandle:async h=>sha(h.entry.body)};
const coreBytes=fs.readFileSync(corePath),runtimeBytes=fs.readFileSync(runtimePath);
assert(['0f9de31c8ad8ec7e1b870a92d025909f4606363801a31ee3582b903c5704bbce','018cf44ee14dd405ecb09cee2e352bd62b224ba73e6ad2810aa9705e2dc9b713','cbda18fd8d447610ed5a686c66d1d1bc904c889ace6f83b44b70fba573023d53'].includes(sha(coreBytes)),'known reviewed core bytes');
assert(['ca4deb26be7d30e3a08844eac80b7f689e72cbbebdb1824abf2a90de0329e475','3ee19071dd8229c0e78f64eb5f97b79a402f226e1c2b87c4ba7335e2b09dab00','67cf3275f00c65150f784e92e8628b1896eb674b752b6e9bfc893c41273ebb8b'].includes(sha(runtimeBytes)),'known exact runtime bytes');
const m={exports:{}};
const restrictedRequire=id=>{if(id==='node:fs/promises')return Object.freeze({});if(id==='node:path')return path;if(id==='node:crypto')return crypto;if(id==='../project/desktop/employee-update-cache.cjs')return u;if(id==='../project/desktop/employee-update-installer.cjs')return Object.freeze({programPath:()=>fail('UNEXPECTED_INSTALLER_CALL')});throw Error('Unexpected import: '+id);};
vm.runInNewContext(coreBytes.toString('utf8'),{module:m,exports:m.exports,require:restrictedRequire,process:{versions:{}},Buffer,TextDecoder},{filename:corePath,timeout:1000});const core=m.exports;
const caseBytes=fs.readFileSync(path.join(D,'handoff-output/c26-history-path-fix-a1/history-path-cases.json'));assert.equal(sha(caseBytes),'735278446faa9c420afd4f918cbae81b48e397b4519fe51107f312a71ac5d42d');const cases=JSON.parse(caseBytes);
// These literal DS cases describe the history-only component, not its union
// with ordinary short program paths. The union is separately tested below.
for(const [i,c] of cases.entries())test('independent component case '+i+' / '+c.policy+' / '+c.path.length,()=>{
 let actual;if(c.policy==='program')actual=safeRelative(c.path);else if(c.policy==='preserved-history'){assert.equal(typeof core.safeHistoryRelative,'function','new explicit history validator');actual=core.safeHistoryRelative(c.path);}else{assert.equal(typeof core.pathPolicy,'function');assert.throws(()=>core.pathPolicy(c.policy),e=>e.code==='BAD_PATH_POLICY');actual=false;}assert.equal(actual,c.allowed);
});
const diagnostic=JSON.parse(fs.readFileSync(path.join(D,'handoff-input/c26-history-path-task-a1/actual-path-diagnostic.json'))),long=diagnostic.observations.find(x=>x.kind==='genuine162-history').firstBad.path;
function ramTree(relative){const root=String.raw`C:\fixture`,map=new Map(),body=Buffer.from('x');const directory=p=>{if(map.has(p))return;map.set(p,{children:[],stat:{isDirectory:()=>true}});};directory(root);let current=root;const parts=relative.split('/');for(let i=0;i<parts.length;i++){const next=path.join(current,parts[i]);map.get(current).children.push(parts[i]);if(i<parts.length-1)directory(next);else map.set(next,{body,stat:{isDirectory:()=>false}});current=next;}return{root,io:{__entry:p=>{assert(map.has(p));return map.get(p);},readdir:async p=>[...map.get(p).children],lstat:async p=>map.get(p).stat}};}
test('actual 301 historical path is rejected by the old strict default',async()=>{assert.equal(long.length,301);const f=ramTree(long);await assert.rejects(core.inspectArtifactTree({artifactDir:f.root,fileSystem:f.io}),e=>e.code==='UNSAFE_ARTIFACT');});
test('actual 301 history is completely enumerated under explicit history policy',async()=>{const f=ramTree(long),r=await core.inspectArtifactTree({artifactDir:f.root,fileSystem:f.io,pathPolicy:'preserved-history'});assert.equal(r.files.length,1);assert.equal(r.files[0].path,long);assert.equal(r.files[0].size,1);assert.equal(r.files[0].sha256,'2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881');});
test('history union retains ordinary short program paths and history root directories',async()=>{for(const name of ['resources/app.asar','.xjy-patches','.xjy-patchesX/short.cache']){assert.equal(typeof core.relativeByPolicy,'function');assert.equal(core.relativeByPolicy('preserved-history',name),true,name);}const f=ramTree('resources/app.asar'),r=await core.inspectArtifactTree({artifactDir:f.root,fileSystem:f.io,pathPolicy:'preserved-history'});assert.equal(r.files[0].path,'resources/app.asar');});
test('non-history long path stays rejected by the combined tree policy',async()=>{const name='resources/'+long;const f=ramTree(name);await assert.rejects(core.inspectArtifactTree({artifactDir:f.root,fileSystem:f.io,pathPolicy:'preserved-history'}),e=>e.code==='UNSAFE_ARTIFACT');});
test('unknown path policy is rejected before any directory enumeration',async()=>{let reads=0;await assert.rejects(core.inspectArtifactTree({artifactDir:String.raw`C:\fixture`,fileSystem:{readdir:async()=>{reads++;return[];}},pathPolicy:'preserve'}),e=>e.code==='BAD_PATH_POLICY');assert.equal(reads,0);});
const runtime=runtimeBytes.toString('utf8');
test('actual layout source call passes false at argument six and policy at seven',async()=>{const call=runtime.match(/await program\(file, 'source', record\.sourceFiles, identity, bytes\.sourceBytes[^;]*\); found\.source = name;/);assert(call);let got;const fn=vm.runInNewContext('(async()=>{'+call[0]+'})',{program:async(...args)=>{got=args;},file:'source-dir',record:{sourceFiles:[]},identity:'identity',bytes:{sourceBytes:Buffer.from('marker')},found:{},name:'backup'},{timeout:1000});await fn();assert.equal(got.length,7);assert.equal(got[5],false);assert.equal(got[6],'preserved-history');});
test('actual captureMutable explicitly uses historical policy and retains the historical row',async()=>{const start=runtime.indexOf('  async function captureMutable('),end=runtime.indexOf('\n  async function openController(',start);assert(start>=0&&end>start);let got;const fixed={path:'resources/app.asar',size:1,sha256:'a'.repeat(64)},history={path:long,size:1,sha256:'b'.repeat(64)};const fn=vm.runInNewContext('(()=>{'+runtime.slice(start,end)+';return captureMutable;})()',{core:{inspectArtifactTree:async opts=>{got=opts;return{files:[fixed,history]};}},u:{assertPath:async()=>{throw Object.assign(Error('fixture absent'),{code:'ENOENT'});}},fs:{},MARKER:'xjy-install-activation.json',path,rows:x=>x,requireValue:(v,c)=>{assert(v,c);}},{timeout:1000});const r=await fn(String.raw`C:\fixture`,{files:[fixed]},false);assert.equal(got.pathPolicy,'preserved-history');assert.equal(r.files.length,1);assert.equal(r.files[0].path,long);});
console.log(JSON.stringify({sourceOnlyRamTests:true,coreSha256:sha(coreBytes),runtimeSha256:sha(runtimeBytes),caseSha256:sha(caseBytes),realFilesystemGuardsTested:false,realInstallTested:false}));

test('actual protectedTrees verifies captured data and profile with the same history policy',async()=>{
 const start=runtime.indexOf('  async function protectedTrees('),end=runtime.indexOf('\n  async function layout(',start);assert(start>=0&&end>start);
 const ids={root:'r',artifact:'a',state:'s',data:'d',profile:'p'},expected=[{path:long,size:1,sha256:'2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881'}];let checks=0;
 const fn=vm.runInNewContext('(()=>{'+runtime.slice(start,end)+';return protectedTrees;})()',{
  fixedDirectories:async()=>({...ids}),paths:{dataDir:'data',profileDir:'profile'},requireValue:(v,c)=>assert(v,c),
  exactTree:async(dir,rows,id,extra,policy)=>{checks++;const f=ramTree(long),r=await core.inspectArtifactTree({artifactDir:f.root,fileSystem:f.io,...(policy===undefined?{}:{pathPolicy:policy})});assert.equal(r.files.length,rows.length);assert.equal(r.files[0].path,rows[0].path);assert.equal(r.files[0].sha256,rows[0].sha256);}
 },{timeout:1000});
 await fn({runtimeWrites:false,identities:ids,dataFiles:expected,profileFiles:expected});assert.equal(checks,2);
});
'use strict';
// Worker/launcher contract only. Native ports below are observations, not an
// installed-engine/startup-fence/migration/GUI acceptance result.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'..');
if(process.platform!=='win32'||os.userInfo().username.toLowerCase()!=='wdagutilityaccount'||ROOT.toLowerCase()!=='c:\\xjy-work\\xjy-web-stage1')throw Error('Actual fixed offline Guest required');
const guardFile=path.join(ROOT,'stage1/guest-candidate-cdp.cjs');
if(crypto.createHash('sha256').update(fs.readFileSync(guardFile)).digest('hex')!=='59840b638d8797fb55241616cd0b8e4098075a76834a201b0e93c1a748f1bb32')throw Error('Original Guest guard changed');
require(guardFile).actualGuard();
const test=require('node:test'),assert=require('node:assert/strict');
const {createUniversalWorker170}=require('../delivery-tools/universal-worker-170.cjs');
const {createUniversalLauncher170}=require('../delivery-tools/universal-launcher-170.cjs');
const {ENGINE}=require('../delivery-approval/approval-core-170.cjs');
const PUB='a'.repeat(64),SID='S-1-5-21-100-200-300-1001',APP='11111111-1111-4111-8111-111111111111',NOW=Date.UTC(2026,9,19),PUBLISHER='6e8b9cadb59aeb53f30d41f4471f70f644f0dfc7376ffb9d8a4c62defb98458c';
function fixture({count=1,role='employee',legacy=false,pending=false}={}){
 const publication={schemaVersion:1,product:'xjy-jewelry-offline',targetVersion:'1.7.0',targetEngineVersion:'44.9.0',publicationId:PUB,artifactSha256:'b'.repeat(64),treeSha256:'c'.repeat(64),sourcePolicySha256:'d'.repeat(64),publisherPublicKeySha256:PUBLISHER,engineTreeSha256:'e'.repeat(64),sourcePrograms:['1.6.0','1.6.1','1.6.2'].map((version,i)=>({version,main:'release-entry.cjs',asarSize:100,asarSha256:String(i+1).repeat(64)}))};
 const authority={approvalRoot:'C:\\ProgramData\\鑫金源珠宝补丁审定-'+SID+'\\'+PUB,osUser:SID,local:'C:\\LocalAppData',roaming:'C:\\Roaming',publicationId:PUB};
 const rows=Array.from({length:count},(_,i)=>({source:i?'shortcut':'running-exe',path:'C:\\Synthetic170\\'+i,outcome:legacy?'needs-role':'valid',knownProduct:true,candidate:{installationDir:'C:\\Synthetic170\\'+i,identity:'12345678:'+String(i+1).padStart(16,'0'),version:'1.6.2',...(legacy?{}:{role})}}));
 const events=[],hooks={},hintsSaved=[];let selected=rows[0],receipt;
 const state={transactionState:legacy?'none':pending?'mutating':'committed',transactionPublicationId:pending?PUB:null,transactionApprovalId:pending?APP:null,fingerprint:legacy?'none':'9'.repeat(64)};
 const native={
  getAuthority:async()=>structuredClone(authority),defaultTarget:async()=>({installationDir:'C:\\LocalAppData\\鑫金源珠宝\\员工程序',exists:false}),
  collectCandidates:async()=>rows.map(r=>({source:r.source,path:r.path})),
  inspectCandidate:async hint=>{events.push('inspect');if(hooks.inspect)return hooks.inspect(hint);const r=rows.find(r=>r.path===hint.path);return structuredClone(r);},
  chooseCandidate:async candidates=>{events.push('choose');selected=rows.at(-1);return selected.candidate.identity;},
  readState:async()=>structuredClone(state),
  requestApproval:async({candidate})=>{events.push('approval');if(hooks.approval)return hooks.approval(candidate);if(!candidate.role)events.push('confirm-role');receipt={purpose:'xjy-oneclick-approval-written',written:true,artifactSha256:publication.artifactSha256,publisherPublicKeySha256:PUBLISHER,publicationId:PUB,installationDir:candidate.installationDir,osUser:SID,role:candidate.role||role,installationIdentity:candidate.identity,sourceVersion:candidate.version,requiresLegacyBootstrap:legacy,requiredInstallationStrategy:'full-engine-tree',approvalId:APP,expiresAt:new Date(NOW+86400000).toISOString()};return{processExited:true,exitCode:0,stdout:JSON.stringify(receipt),stderr:''};},
  readApproval:async({candidate})=>{events.push('read-protected');const record={schemaVersion:1,purpose:'xjy-repeat-program-patch',approvalId:APP,artifactSha256:publication.artifactSha256,treeSha256:publication.treeSha256,publisherPublicKeySha256:PUBLISHER,sourcePolicySha256:publication.sourcePolicySha256,verifiedPublisherName:'虚构发布者',role:candidate.role,installationDir:candidate.installationDir,osUser:SID,engine:{...ENGINE},approvedAt:new Date(NOW).toISOString(),expiresAt:receipt.expiresAt};if(hooks.record)hooks.record(record);return{record,sha256:'8'.repeat(64),approvalFile:authority.approvalRoot+'\\initial-upgrade-approval.json',authority:structuredClone(authority)};},
  saveVerifiedHint:async hint=>{events.push('remember');if(hooks.remember)throw Error('synthetic hint write error');hintsSaved.push(hint);},
  measureDirectory:async()=> '12345678:0000000000000090',
  launchFresh:async()=>({started:true}),installFreshEmployee:async options=>{events.push('fresh');if(hooks.fresh)return hooks.fresh(options);return{installed:true,version:'1.7.0',role:'employee',installationDir:options.installDir,launched:true};},
 };
 const fence={assertHeld:async()=>{events.push('held');return hooks.fenceLost?false:true;},releaseAfterCommit:async context=>{events.push('release-business');if(hooks.release)throw Error('synthetic unknown release');return{released:true,role:context.candidate.role,version:'1.7.0'};},retainOnFailure:async()=>events.push('retain-fence')};
 const transaction={install:async()=>{events.push('backup','wait-normal-exit','install-tree','fenced-start','commit');if(hooks.install)throw Object.assign(Error('synthetic rollback retained'),{code:'ROLLBACK_FAILED'});return{installed:true,version:'1.7.0',engineVersion:'44.9.0',role};},recover:async()=>{events.push('recover-only');return{recovered:true,rolledBack:true};}};
 const create=async()=>{events.push('create-tree');return transaction;};
 const engineTree={strategy:'full-engine-tree',targetVersion:'1.7.0',targetEngineVersion:'44.9.0',
  verifyPublication:async()=>{events.push('verify-publication');return{publicationId:PUB,engineTreeSha256:publication.engineTreeSha256,targetVersion:'1.7.0',engineVersion:'44.9.0'};},
  assertWorkerRuntime:async()=>{events.push('outside-runtime');return true;},
  verifyApprovalAuthority:async()=>{events.push('acl');return hooks.badAcl?false:true;},createTransaction:create,
  createLegacyTransaction:async()=>{events.push('legacy-tree');return transaction;},
  verifyInstalled:async context=>{events.push('verify-committed-tree');return{committed:!hooks.uncommitted,engineTreeSha256:publication.engineTreeSha256,version:'1.7.0',engineVersion:'44.9.0',role:context.candidate.role,installationDir:context.candidate.installationDir,installationIdentity:'12345678:0000000000000090'};},
  startupFence:{protocol:'xjy-pre-business-commit-fence-v1',gatePoint:'before-business-import',acquire:async()=>{events.push('acquire-fence');return fence;}},
 };
 const config={publication,paths:{artifactDir:'C:\\Delivery170\\artifact',archiveFile:'C:\\Delivery170\\package.zip',reviewerDir:'C:\\Delivery170\\reviewer',freshArtifactDir:'C:\\Delivery170\\fresh'},native,engineTree,freshTrust:{targetVersion:'1.7.0',engineVersion:'44.9.0',publisherPublicKeySha256:PUBLISHER},now:()=>NOW};
 return{config,events,hooks,hintsSaved,rows,state,engineTree,native,publication,worker:()=>createUniversalWorker170(config)};
}
const code=value=>error=>error?.code===value;

test('W01 DI contract: unique verified source is automatic and business release follows commit and full-target proof',async()=>{
 const f=fixture(),r=await f.worker().run();assert.equal(r.completed,true);assert.equal(r.role,'employee');assert(!f.events.includes('choose'));
 for(const [a,b]of [['approval','create-tree'],['commit','verify-committed-tree'],['verify-committed-tree','release-business'],['release-business','remember']])assert(f.events.indexOf(a)<f.events.indexOf(b),a+' before '+b);
 assert.equal(f.hintsSaved[0].installationIdentity,'12345678:0000000000000090');assert.notEqual(f.hintsSaved[0].installationIdentity,f.rows[0].candidate.identity);
});
test('W02 missing complete-engine port blocks before approval and every mutation port',async()=>{
 const f=fixture();delete f.config.engineTree;await assert.rejects(f.worker().run(),code('FULL_ENGINE_UPGRADE_UNAVAILABLE'));assert(!f.events.includes('approval'));assert(!f.events.includes('create-tree'));assert(!f.events.includes('fresh'));
});
test('W03 existing restart-only adapter without a pre-business fence is refused',async()=>{
 const f=fixture();delete f.engineTree.startupFence;await assert.rejects(f.worker().run(),code('STARTUP_FENCE_UNAVAILABLE'));assert(!f.events.includes('approval'));
});
test('W04 multiple verified candidates ask exactly once and cannot select an arbitrary path',async()=>{
 const f=fixture({count:2}),r=await f.worker().run();assert.equal(r.installationDir,f.rows[1].path);assert.equal(f.events.filter(x=>x==='choose').length,1);
 const bad=fixture({count:2});bad.native.chooseCandidate=async()=> '12345678:0000000000000099';await assert.rejects(bad.worker().run(),code('CANDIDATE_SELECTION_MISMATCH'));assert(!bad.events.includes('approval'));
});
test('W05 activation-less legacy gets one explicit role and the legacy full-tree branch without canonical creation',async()=>{
 const f=fixture({legacy:true}),r=await f.worker().run();assert.equal(r.completed,true);assert.equal(f.events.filter(x=>x==='confirm-role').length,1);assert(f.events.includes('legacy-tree'));assert(!f.events.includes('create-tree'));
});
test('W06 missing legacy branch stops before approval instead of making a canonical record or using resources',async()=>{
 const f=fixture({legacy:true});delete f.engineTree.createLegacyTransaction;await assert.rejects(f.worker().run(),code('LEGACY_FULL_ENGINE_UPGRADE_UNAVAILABLE'));assert(!f.events.includes('approval'));assert(!f.events.includes('fresh'));
});
test('W07 known Host role is retained and cannot be changed by employee intent',async()=>{
 const f=fixture({role:'host'});assert.equal((await f.worker().run()).role,'host');assert(!f.events.includes('confirm-role'));
 const bad=fixture({role:'host'});await assert.rejects(bad.worker().run({requestedRole:'employee'}),code('ROLE_MISMATCH'));assert(!bad.events.includes('approval'));
});
test('W08 cancelled or still-running approval never reaches a transaction',async()=>{
 const f=fixture();f.hooks.approval=async()=>({processExited:true,exitCode:2,stdout:'',stderr:''});assert.equal((await f.worker().run()).status,'cancelled');assert(!f.events.includes('create-tree'));
 const bad=fixture();bad.hooks.approval=async()=>({processExited:false,exitCode:0,stdout:'{}'});await assert.rejects(bad.worker().run(),code('APPROVAL_NOT_EXITED'));assert(!bad.events.includes('create-tree'));
});
test('W09 protected approval source-policy mismatch is rejected even after a valid receipt',async()=>{
 const f=fixture();f.hooks.record=record=>{record.sourcePolicySha256='f'.repeat(64);};await assert.rejects(f.worker().run(),code('APPROVAL_MISMATCH'));assert(!f.events.includes('acquire-fence'));
});
test('W10 source physical identity changes during approval stop every install',async()=>{
 const f=fixture();let reads=0;f.hooks.inspect=hint=>{const row=structuredClone(f.rows[0]);if(++reads===3)row.candidate.identity='12345678:0000000000000009';return row;};await assert.rejects(f.worker().run(),code('SOURCE_CHANGED'));assert(!f.events.includes('create-tree'));
});
test('W11 exact pending transaction recovers only and does not auto-reinstall or release business',async()=>{
 const f=fixture({pending:true}),r=await f.worker().run();assert.equal(r.completed,false);assert(f.events.includes('recover-only'));assert(!f.events.includes('install-tree'));assert(!f.events.includes('release-business'));assert(f.events.includes('retain-fence'));
});
test('W12 native transaction failure retains the fence and original rollback error without retry',async()=>{
 const f=fixture();f.hooks.install=true;await assert.rejects(f.worker().run(),code('ROLLBACK_FAILED'));assert(f.events.includes('retain-fence'));assert(!f.events.includes('release-business'));assert.equal(f.events.filter(x=>x==='install-tree').length,1);
});
test('W13 committed but unverified target never opens business or asks an old-version rollback',async()=>{
 const f=fixture();f.hooks.uncommitted=true;await assert.rejects(f.worker().run(),e=>e.code==='TARGET_NOT_VERIFIED'&&e.rollbackForbidden===true);assert(!f.events.includes('release-business'));assert(f.events.includes('retain-fence'));
});
test('W14 uncertain release forbids automatic rollback and keeps evidence',async()=>{
 const f=fixture();f.hooks.release=true;await assert.rejects(f.worker().run(),e=>e.rollbackForbidden===true);assert(f.events.includes('retain-fence'));assert(!f.events.includes('recover-only'));
});
test('W15 post-commit location/UI errors do not turn a released transaction into rollback',async()=>{
 const f=fixture();f.hooks.remember=true;f.config.onProgress=()=>{throw Error('synthetic UI event failed');};const r=await f.worker().run();assert.equal(r.completed,true);assert(r.warnings.length>0);assert(!f.events.includes('recover-only'));
});
test('W16 fresh path calls only the complete170/449 API and cannot use old-engine trust',async()=>{
 const f=fixture({count:0});delete f.config.engineTree;const r=await f.worker().run({mode:'first-install'});assert.equal(r.completed,true);assert.deepEqual(f.events,['fresh','remember']);
 const bad=fixture({count:0});bad.config.freshTrust.engineVersion='44.7.0';await assert.rejects(bad.worker().run({mode:'first-install'}),code('FRESH_DELIVERY_UNAVAILABLE'));assert(!bad.events.includes('fresh'));
});
test('W17 fresh installed-but-not-started result remains distinct and does not reinstall',async()=>{
 const f=fixture({count:0});f.hooks.fresh=options=>({installed:true,version:'1.7.0',role:'employee',installationDir:options.installDir,launched:false});const r=await f.worker().run({mode:'first-install'});assert.equal(r.completed,false);assert.equal(r.status,'installed-not-started');assert.equal(f.events.filter(x=>x==='fresh').length,1);
});
test('W18 launcher runs one pending button action and does not convert exit-zero or UI errors into install proof',async()=>{
 let release;const held=new Promise(resolve=>{release=resolve;});let calls=0;const launcher=createUniversalLauncher170({worker:{run:async()=>{calls++;await held;return{status:'installed-not-started',completed:false};}},showResult:()=>{throw Error('UI failed');}});
 const pending=launcher.click();await assert.rejects(launcher.click(),code('BUSY'));release();const r=await pending;assert.equal(calls,1);assert.equal(r.completed,false);assert.equal(launcher.busy,false);
});
test('W19 installed-tree worker or an after-window gate is rejected before approval',async()=>{
 const f=fixture();f.engineTree.assertWorkerRuntime=async()=>false;await assert.rejects(f.worker().run(),code('EXTERNAL_HELPER_REQUIRED'));assert(!f.events.includes('approval'));
 const late=fixture();late.engineTree.startupFence.gatePoint='after-window-ready';await assert.rejects(late.worker().run(),code('STARTUP_FENCE_UNAVAILABLE'));assert(!late.events.includes('approval'));
});
test('W20 public button cannot choose trust, source paths or a resource-only installation strategy',async()=>{
 const f=fixture();for(const request of [null,{installationDir:'C:\\Other'},{strategy:'resources'},{role:'host'}])await assert.rejects(f.worker().run(request),code('INVALID_DELIVERY_REQUEST'));
 const old=fixture();old.engineTree.strategy='resources';await assert.rejects(old.worker().run(),code('FULL_ENGINE_UPGRADE_UNAVAILABLE'));assert(!old.events.includes('approval'));
});
test('W21 actual native hint helpers retain SID and physical-directory scope with controlled IO only',async()=>{
 const vm=require('node:vm'),location=require('../delivery-tools/install-location.cjs');
 const file=path.join(ROOT,'delivery-tools/delivery-native-170.cjs'),loaded={exports:{}},identity='12345678:0000000000000090';
 const installationDir='C:\\Synthetic170\\remembered',local='C:\\Synthetic170\\Local',hint=location.createLocationHint({candidate:{installationDir,identity,role:'employee'},osUser:SID}),writes=[];
 let stored=hint;
 const fakeIO={mkdir:async()=>{}},fakeUpdates={
  readSmall:async()=>Buffer.from(JSON.stringify(stored)),assertPath:async()=>({}),
  atomicWrite:async(io,target,bytes,root)=>writes.push({target,value:JSON.parse(bytes),root}),
 };
 const modules={'node:fs/promises':fakeIO,'node:path':path,'node:os':os,'node:child_process':{},
  './initial-patch-core.cjs':{},'./initial-patch-entry.cjs':{resolveInitialNativeAuthority:async()=>({osUser:SID,local})},
  '../project/desktop/employee-update-cache.cjs':fakeUpdates,'./install-location.cjs':location,
  './install-location-windows.cjs':{collectNativeWindowsInstallCandidates:async()=>[]},
  '../delivery-approval/approval-core-170.cjs':{},'../delivery-approval/approval-io-170.cjs':{physicalIdentity:()=>identity}};
 vm.runInNewContext(fs.readFileSync(file,'utf8'),{module:loaded,exports:loaded.exports,require:name=>{assert(Object.hasOwn(modules,name),'unexpected native dependency '+name);return modules[name];},process:{versions:{}},Buffer,TextDecoder,TextEncoder,URL,console},{filename:file+'[controlled-native-IO]'});
 const api=loaded.exports,authority={osUser:SID,local};
 assert.deepEqual(JSON.parse(JSON.stringify(await api.collectCandidates({authority}))),[{source:'remembered',path:installationDir}]);
 for(const invalid of [{...hint,osUser:'S-1-5-21-999-999-999-1001'},{...hint,installationIdentity:'12345678:0000000000000099'}]){stored=invalid;assert.equal((await api.collectCandidates({authority})).length,0);}
 await api.saveVerifiedHint(hint);assert.equal(writes.length,1);assert.equal(writes[0].value.installationIdentity,identity);assert.equal(writes[0].target,path.join(local,'鑫金源珠宝安装','verified-location-'+SID+'.json'));
 await assert.rejects(api.saveVerifiedHint({...hint,osUser:'S-1-5-21-999-999-999-1001'}),code('LOCATION_HINT_INVALID'));assert.equal(writes.length,1);
});

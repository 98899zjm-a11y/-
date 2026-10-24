'use strict';
// Data-free host state preservation and startup fencing. Business backups and
// program switching are deliberately delegated to the existing native services.
const physical=process.versions.electron?require('original-fs'):require('node:fs'),fs=physical.promises,path=require('node:path');
const u=require('../project/desktop/employee-update-cache.cjs'),core=require('./initial-patch-core.cjs'),startup=require('../project/desktop/engine-startup-gate.cjs');
const stateApi=require('./host20-startup-snapshot170.cjs'),{nativeAcl}=require('./engine-tree-runtime170.cjs');
const {assertHostReceiptDirectoryIdentity170}=require('./host20-directory-identity170.cjs');
const fail=(code,message)=>{throw Object.assign(Error(message),{code});};
const trustedIo=new WeakMap();
async function inspectHistoricalDirectoryPath170({install,name,installationIdentity,inspect}){
 if(typeof inspect!=='function'||!(u.safeRelative(name)||core.safeHistoryRelative(name)))fail('BAD_HOST_HISTORY','Safe authenticated history path required');
 let current=install,parentId;try{parentId=await inspect(install,installationIdentity);}catch(initial){if(initial.code==='ENOENT')fail('HOST_STATE_CHANGED','Installation root disappeared before history inspection');throw initial;}for(const segment of name.split('/')){const parent=current;current=path.join(parent,segment);try{parentId=await inspect(current);}catch(e){if(e.code==='ENOENT'){try{await inspect(parent,parentId);await inspect(install,installationIdentity);}catch(recheck){if(recheck.code==='ENOENT')fail('HOST_STATE_CHANGED','History ancestor disappeared while confirming optional absence');throw recheck;}}throw e;}}return parentId;
}
function createHost20StateIo170({sourceToken,operationId,workerRoot,authority,processBarrier}){
 const source=stateApi.describeHost20State170(sourceToken);
 const history=stateApi.host20SourceHistory170(sourceToken);
 const publisherPublicKey=stateApi.host20PublisherPublicKey170(sourceToken);
 if(!u.UUID.test(operationId||'')||!authority||!/^S-1-\d+(?:-\d+)+$/.test(authority.osUser||'')||!processBarrier||typeof processBarrier.assertClosed!=='function')fail('BAD_HOST_STATE_IO','Owned operation, current SID and normal-exit barrier required');
 const state=u.safeAbsolute(source.stateDir),install=u.safeAbsolute(source.installationDir),worker=u.safeAbsolute(workerRoot),parent=path.join(state,'host-program-updates'),directory=path.join(parent,operationId);
 if(u.samePath(worker,install)||u.samePath(worker,state)||path.relative(install,worker).split(path.sep)[0]!=='..'&&!path.isAbsolute(path.relative(install,worker)))fail('BAD_HOST_STATE_IO','Trusted worker must be outside original program and state');
 const snapshotPlan=stateApi.createHost20RestorePlan170(sourceToken,{publicationCommitted:false,sourceTreeSha256:source.expectedSourceTreeSha256,installationIdentity:source.installationIdentity,stateIdentity:source.stateIdentity});
 const parts=stateApi.host20PreservationParts170(sourceToken),names=Object.keys(parts),gateNames=Object.keys(snapshotPlan.files),blocked=stateApi.createHost20BlockReceipt170(sourceToken),journal=path.join(directory,'operation.json');let snapshotIdentity=null;
 async function directoryIdentity(dir,expected){const s=await u.assertPath(fs,dir,{directory:true}),identity=u.statIdentity(s);if(expected&&identity!==expected)fail('HOST_STATE_CHANGED','Host directory physical identity changed');return identity;}
 async function sourceStable({allowBlocked=false}={}){
  assertHostReceiptDirectoryIdentity170(await u.assertPath(fs,install,{directory:true}),source.installationIdentity);
  assertHostReceiptDirectoryIdentity170(await u.assertPath(fs,state,{directory:true}),source.stateIdentity);
  for(const name of gateNames){const b=await u.readSmall(fs,path.join(state,name),name==='journal.json'?16777216:2097152),expected=snapshotPlan.files[name];if(!b.equals(expected)&&!(allowBlocked&&name===startup.STATUS&&b.equals(blocked)))fail('HOST_STATE_CHANGED','Original host state bytes changed: '+name);}
  if(!(await u.readSmall(fs,path.join(install,'xjy-install-activation.json'),4096)).equals(parts['source-activation.json']))fail('HOST_STATE_CHANGED','Original activation bytes changed');
 }
 async function ownSnapshot(){
  const id=await directoryIdentity(directory,snapshotIdentity);if(!snapshotIdentity)snapshotIdentity=id;
  const record=stateApi.decodeHost20Operation170(sourceToken,await u.readSmall(fs,journal,2097152));
  if(record.operationId!==operationId||record.snapshotIdentity!==snapshotIdentity)fail('HOST_STATE_CHANGED','Host operation directory ownership changed');
  const allowed=new Set([...names,'operation.json']);for(const name of await fs.readdir(directory))if(!allowed.has(name))fail('HOST_SNAPSHOT_EXTRA','Unknown file in host source snapshot');
  for(const name of names){const actual=await u.readSmall(fs,path.join(directory,name),name==='journal.json'?16777216:2097152);if(!actual.equals(parts[name]))fail('HOST_SNAPSHOT_CHANGED','Preserved original host state changed');}
  return record;
 }
 async function save(record){await u.atomicWrite(fs,journal,stateApi.encodeHost20Operation170(sourceToken,record),directory);const again=await ownSnapshot();if(JSON.stringify(again)!==JSON.stringify(record))fail('HOST_OPERATION_READBACK','Host operation did not persist exactly');}
 async function preserve(){
  await processBarrier.assertClosed();await sourceStable();
  await nativeAcl(worker,authority,[state,worker]);
  const sourceDirectories=await stateApi.captureHost20HistoryDirectories170(sourceToken,name=>inspectHistoricalDirectoryPath170({install,name,installationIdentity:source.installationIdentity,inspect:directoryIdentity}));
  let parentExists=true;try{await directoryIdentity(parent);}catch(e){if(e.code!=='ENOENT')throw e;parentExists=false;}
  if(!parentExists)await nativeAcl(worker,authority,[state],[parent]);else await nativeAcl(worker,authority,[parent]);
  try{await fs.lstat(directory);fail('HOST_OPERATION_EXISTS','Existing host operation retained; use authenticated recovery');}catch(e){if(e.code!=='ENOENT')throw e;}
  await nativeAcl(worker,authority,[parent],[directory]);snapshotIdentity=await directoryIdentity(directory);
  for(const name of names){const expected=parts[name],activation=name==='source-activation.json',sourceFile=activation?path.join(install,'xjy-install-activation.json'):path.join(state,name),target=path.join(directory,name);await core.copy(fs,sourceFile,target,{path:name,size:expected.length,sha256:u.digest(expected)},activation?install:state,directory);const actual=await u.readSmall(fs,target,name==='journal.json'?16777216:2097152);if(!actual.equals(expected))fail('HOST_SNAPSHOT_CHANGED','Original state snapshot readback failed');}
  await sourceStable();await processBarrier.assertClosed();
  const checkedDirectories=await stateApi.captureHost20HistoryDirectories170(sourceToken,name=>inspectHistoricalDirectoryPath170({install,name,installationIdentity:source.installationIdentity,inspect:directoryIdentity}));if(JSON.stringify(checkedDirectories)!==JSON.stringify(sourceDirectories))fail('HOST_STATE_CHANGED','History directories changed during preservation');
  const record={version:1,purpose:source.purpose,operationId,phase:'source-snapshotted',installationDir:install,installationIdentity:source.installationIdentity,stateDir:state,stateIdentity:source.stateIdentity,sourceCatalogSha256:source.catalogSha256,targetCatalogSha256:source.targetCatalogSha256,snapshotDirectory:directory,snapshotIdentity,files:Object.fromEntries(names.map(name=>[name,{size:parts[name].length,sha256:u.digest(parts[name])}])),coreState:null,...(history.directoryPaths.length?{sourceDirectories}:{})};
  const opened=await u.openChecked(fs,journal,'wx+',{missing:true,root:directory});try{await u.writeExactly(opened.handle,0,stateApi.encodeHost20Operation170(sourceToken,record));await opened.handle.sync();await u.assertHandle(fs,opened,{snapshot:false,root:directory});}finally{await opened.handle.close();}
  await ownSnapshot();return{preserved:true,directory,snapshotIdentity,phase:record.phase,programChanged:false};
 }
 async function prepareCoreOperationDirectories(){
  await processBarrier.assertClosed();const record=await ownSnapshot();
  if(record.coreState!==null){if(record.coreState.phase!=='bound')fail('HOST_CORE_OWNERSHIP_UNPROVEN','Core mkdir was interrupted before identity binding; preserve the directory');await coreDirectories(record);return{...record.coreState};}
  if(!['source-snapshotted','source-blocked'].includes(record.phase))fail('HOST_STATE_PHASE','Cannot allocate new core state after target commit or source restore');
  await sourceStable({allowBlocked:record.phase==='source-blocked'});
  const coreParent=path.join(state,'host-program-transactions'),coreDir=path.join(coreParent,operationId);
  let parentExists=true;try{await directoryIdentity(coreParent);}catch(e){if(e.code!=='ENOENT')throw e;parentExists=false;}
  if(!parentExists)await nativeAcl(worker,authority,[state],[coreParent]);else await nativeAcl(worker,authority,[coreParent]);
  try{await fs.lstat(coreDir);fail('HOST_OPERATION_EXISTS','Core destination already exists without authenticated identity');}catch(e){if(e.code!=='ENOENT')throw e;}
  await save({...record,coreState:{phase:'pending',directory:coreDir,identity:null,dataProofIdentity:null,profileProofIdentity:null,sourceLeaseIdentity:null}});
  await nativeAcl(worker,authority,[coreParent],[coreDir]);
  await nativeAcl(worker,authority,[coreDir],[path.join(coreDir,'data-proof'),path.join(coreDir,'profile-proof'),path.join(coreDir,'.xjy-initial-upgrade')]);
  const bound={phase:'bound',directory:coreDir,identity:await directoryIdentity(coreDir),dataProofIdentity:await directoryIdentity(path.join(coreDir,'data-proof')),profileProofIdentity:await directoryIdentity(path.join(coreDir,'profile-proof')),sourceLeaseIdentity:await directoryIdentity(path.join(coreDir,'.xjy-initial-upgrade'))};
  await save({...record,coreState:bound});return{...bound};
 }
 async function coreDirectories(record){const c=record.coreState;if(c?.phase!=='bound')fail('HOST_CORE_OWNERSHIP_UNPROVEN','Authenticated core directory identity is absent');await directoryIdentity(c.directory,c.identity);await directoryIdentity(path.join(c.directory,'data-proof'),c.dataProofIdentity);await directoryIdentity(path.join(c.directory,'profile-proof'),c.profileProofIdentity);await directoryIdentity(path.join(c.directory,'.xjy-initial-upgrade'),c.sourceLeaseIdentity);return c;}
 async function blockAfterVerifiedBackup({backupDirectory,backupManifestSha256,verifyDatabases,sourceLease}){
  if(!sourceLease||typeof sourceLease.assertHeld!=='function'||await sourceLease.assertHeld()!==true)fail('SOURCE_LOCK_UNAVAILABLE','Existing host source database lease must be held');
  await processBarrier.assertClosed();await sourceStable();const record=await ownSnapshot();
  if(record.phase!=='source-snapshotted')fail('HOST_STATE_PHASE','Source block may begin only after exact snapshot persistence');
  await require('./initial-patch-backup.cjs').verifyInitialBackup({backupDir:backupDirectory,expectedManifestSha256:backupManifestSha256,verifyDatabases});
  await processBarrier.assertClosed();if(await sourceLease.assertHeld()!==true)fail('SOURCE_LOCK_UNAVAILABLE','Source lease lost before startup fence');
  await save({...record,phase:'blocking-source'});await sourceStable();
  await u.atomicWrite(fs,path.join(state,startup.STATUS),blocked,state);
  if(!(await u.readSmall(fs,path.join(state,startup.STATUS),16384)).equals(blocked))fail('HOST_FENCE_READBACK','Prepared source fence did not persist');
  const gate=startup.readEngineStartupGate({installDir:install,programVersion:'1.7.0',installedRole:'host',trustedPublicKey:publisherPublicKey});
  if(gate.blocked!==true||gate.phase!=='prepared')fail('HOST_FENCE_FAILED','Original host must block before any program rename');
  await save({...record,phase:'source-blocked'});return{blocked:true,phase:'source-blocked',programChanged:false};
 }
 async function restoreBeforeProgramSwitch(){
  await processBarrier.assertClosed();const record=await ownSnapshot();
  if(!['source-snapshotted','blocking-source','source-blocked','source-restored'].includes(record.phase))fail('HOST_RESTORE_FORBIDDEN','Source startup restore is outside authenticated pre-switch phases');
  await sourceStable({allowBlocked:true});
  const tree=await core.inspectArtifactTree({artifactDir:install,pathPolicy:'preserved-history'});
  if(tree.sha256!==source.expectedSourceTreeSha256)fail('HOST_SOURCE_NOT_RESTORED','Complete original source tree must match before old startup permission returns');
  await processBarrier.assertClosed();await sourceStable({allowBlocked:true});
  // Journal and catalog are still exact source bytes. Restore permission last.
  await u.atomicWrite(fs,path.join(state,startup.STATUS),snapshotPlan.files[startup.STATUS],state);
  await sourceStable();const gate=startup.readEngineStartupGate({installDir:install,programVersion:'1.7.0',installedRole:'host',trustedPublicKey:publisherPublicKey});
  if(gate.blocked!==false||gate.transactionId!==source.transactionId)fail('HOST_SOURCE_GATE_READBACK','Original committed host startup permission did not restore');
  await save({...record,phase:'source-restored'});return{restored:true,phase:'source-restored',programChanged:false};
 }
 async function ensureOriginalStartupAfterRollback(){
  const record=await ownSnapshot();if(!['source-blocked','source-restored'].includes(record.phase))fail('HOST_RESTORE_FORBIDDEN','Committed/newer host operation cannot restore original startup');
  await sourceStable({allowBlocked:true});
  const ownedCore=await coreDirectories(record),tree=await core.inspectArtifactTree({artifactDir:install,pathPolicy:'preserved-history'});
  const plan=stateApi.planHost20RolledbackStartup170(sourceToken,{operationId,operationBytes:await u.readSmall(fs,journal,2097152),coreJournalBytes:await u.readSmall(fs,path.join(ownedCore.directory,'journal.json'),16777216),currentJournalBytes:await u.readSmall(fs,path.join(state,'journal.json'),16777216),currentCatalogBytes:await u.readSmall(fs,path.join(state,startup.CATALOG),2097152),currentStatusBytes:await u.readSmall(fs,path.join(state,startup.STATUS),16384),sourceTreeSha256:tree.sha256,installationIdentity:await directoryIdentity(install),stateIdentity:await directoryIdentity(state)});
  if(plan.alreadyRestored){
   const gate=startup.readEngineStartupGate({installDir:install,programVersion:'1.7.0',installedRole:'host',trustedPublicKey:publisherPublicKey});if(gate.blocked!==false||gate.transactionId!==source.transactionId)fail('HOST_SOURCE_GATE_READBACK','Already restored original gate no longer authenticates');
   // Observe an existing released source; never rewrite it to a prepared fence.
   if(record.phase!=='source-restored')await save({...record,phase:'source-restored'});
   return{restored:false,alreadyRestored:true,businessReleased:true,programChanged:false};
  }
  return restoreBeforeProgramSwitch();
 }
 async function assertSourceBlocked(){await directoryIdentity(state,source.stateIdentity);const r=await ownSnapshot();if(r.phase!=='source-blocked')fail('HOST_FENCE_FAILED','Owned source fence phase missing');for(const name of gateNames){const actual=await u.readSmall(fs,path.join(state,name),name==='journal.json'?16777216:2097152),expected=name===startup.STATUS?blocked:snapshotPlan.files[name];if(!actual.equals(expected))fail('HOST_FENCE_FAILED','Owned source gate changed');}return{blocked:true};}
 async function assertOperationState(){assertHostReceiptDirectoryIdentity170(await u.assertPath(fs,state,{directory:true}),source.stateIdentity);const r=await ownSnapshot();await coreDirectories(r);return{verified:true,phase:r.phase};}
 async function openExistingForRecovery(){
  await processBarrier.assertClosed();assertHostReceiptDirectoryIdentity170(await u.assertPath(fs,state,{directory:true}),source.stateIdentity);
  await nativeAcl(worker,authority,[state,worker,directory]);const record=await ownSnapshot();await coreDirectories(record);
  if(record.phase==='source-blocked'){try{await assertSourceBlocked();}catch(error){if(error.code!=='HOST_FENCE_FAILED')throw error;await ensureOriginalStartupAfterRollback();}}
  else if(record.phase==='source-restored')await sourceStable();
  else if(!['target-committed','target-released'].includes(record.phase))fail('HOST_RECOVERY_PHASE','Incomplete snapshot/core ownership must be preserved; it cannot open an arbitrary transaction');
  return{...record.coreState,operationPhase:record.phase};
 }
 async function publishCommittedStartup(input){
  const old=await ownSnapshot();if(!['source-blocked','target-committed','target-released'].includes(old.phase))fail('HOST_FENCE_FAILED','Target publication cannot replace an unowned source state');
  const verified=stateApi.verifyHost20TargetStartup170(sourceToken,{operationId,...input});
  async function publicationPlan(){return stateApi.planHost20RootPublication170(sourceToken,{operationId,operationPhase:old.phase,...input,currentJournalBytes:await u.readSmall(fs,path.join(state,'journal.json'),16777216),currentCatalogBytes:await u.readSmall(fs,path.join(state,startup.CATALOG),2097152),currentStatusBytes:await u.readSmall(fs,path.join(state,startup.STATUS),16384)});}
  const plan=await publicationPlan(),release=plan.businessReleased;
  assertHostReceiptDirectoryIdentity170(await u.assertPath(fs,state,{directory:true}),source.stateIdentity);
  assertHostReceiptDirectoryIdentity170(await u.assertPath(fs,install,{directory:true}),verified.journal.identities.stage);
  // Recovery must not re-block an already released target or require it to be
  // closed merely to observe the existing authenticated release permission.
  if(plan.alreadyReleased){const gate=startup.readEngineStartupGate({installDir:install,programVersion:'1.7.0',installedRole:'host',trustedPublicKey:publisherPublicKey});if(gate.blocked!==false||gate.transactionId!==operationId)fail('HOST_TARGET_GATE_READBACK','Previously released target no longer authenticates');if(old.phase!=='target-released')await save({...old,phase:'target-released'});return{published:false,alreadyReleased:true,businessReleased:true,operationId};}
  await processBarrier.assertClosed();
  const marker=await u.readSmall(fs,path.join(install,'xjy-install-activation.json'),4096),expectedRows=[...verified.targetCatalog.files,...history.files,{path:'xjy-install-activation.json',size:marker.length,sha256:u.digest(marker)}].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0),tree=await core.inspectArtifactTree({artifactDir:install,pathPolicy:'preserved-history'});
  if(JSON.stringify(tree.files.map(({path,size,sha256})=>({path,size,sha256})).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0))!==JSON.stringify(expectedRows))fail('HOST_TARGET_CHANGED','Complete target tree changed before root startup publication');
  const activation=JSON.parse(marker);if(activation.role!=='host'||activation.programVersion!=='1.7.0'||!u.samePath(activation.installationDir,install))fail('HOST_TARGET_CHANGED','New target activation is not the same host');
  if(old.phase==='source-blocked')await assertSourceBlocked();
  await publicationPlan();
  await save({...old,phase:'target-committed'});
  // Never remove the state directory or startup receipt. The old prepared fence
  // remains until the new journal and catalog are durable; receipt is written last.
  await u.atomicWrite(fs,path.join(state,'journal.json'),plan.journalBytes,state);
  await u.atomicWrite(fs,path.join(state,startup.CATALOG),plan.catalogBytes,state);
  await u.atomicWrite(fs,path.join(state,startup.STATUS),plan.statusBytes,state);
  for(const [name,bytes]of [['journal.json',plan.journalBytes],[startup.CATALOG,plan.catalogBytes],[startup.STATUS,plan.statusBytes]])if(!(await u.readSmall(fs,path.join(state,name),name==='journal.json'?16777216:2097152)).equals(bytes))fail('HOST_TARGET_GATE_READBACK','New root startup state readback failed');
  const gate=startup.readEngineStartupGate({installDir:install,programVersion:'1.7.0',installedRole:'host',trustedPublicKey:publisherPublicKey});
  if(release?gate.blocked!==false||gate.transactionId!==operationId:gate.blocked!==true||gate.code!=='ENGINE_STARTUP_HELD')fail('HOST_TARGET_GATE_READBACK','New startup gate did not match release permission');
  if(release)await save({...old,phase:'target-released'});
  return{published:true,businessReleased:release,operationId};
 }
 const api=Object.freeze({preserve,prepareCoreOperationDirectories,blockAfterVerifiedBackup,restoreBeforeProgramSwitch,openExistingForRecovery,verifySnapshot:ownSnapshot,directory});
 trustedIo.set(api,{sourceToken,source,operationId,worker,authority,processBarrier,snapshotIdentity:()=>snapshotIdentity,readOwnedOperation:ownSnapshot,coreDirectories,assertSourceBlocked,assertOperationState,publishCommittedStartup,restoreOriginalStartupAfterSourceRestored:restoreBeforeProgramSwitch,ensureOriginalStartupAfterRollback});return api;
}
async function getHost20StateIoContext170(api,sourceToken,{recovery=false}={}){const c=trustedIo.get(api);if(!c||c.sourceToken!==sourceToken||typeof recovery!=='boolean')fail('UNTRUSTED_HOST_STATE_IO','Native host state I/O capability is not genuine');if(recovery)await api.openExistingForRecovery();else await c.assertSourceBlocked();const operation=await c.readOwnedOperation(),ownedCore=await c.coreDirectories(operation),history=stateApi.host20SourceHistory170(sourceToken);return{...c,kind:'authenticated-host20-program',sourceMutableFiles:history.files,sourceMutableDirectories:operation.sourceDirectories||[],targetMutableFiles:history.files,startupStateDir:c.source.stateDir,startupStateIdentity:c.source.stateIdentity,keyFile:path.join(c.source.stateDir,'journal-key.bin'),sourceCatalogSha256:c.source.catalogSha256,targetCatalogSha256:c.source.targetCatalogSha256,operationStateDir:ownedCore.directory,operationStateIdentity:ownedCore.identity,descriptor:{kind:'authenticated-host20-program',operationId:c.operationId,sourceCatalogSha256:c.source.catalogSha256,sourceTransactionId:c.source.transactionId,snapshotDirectory:api.directory,snapshotIdentity:c.snapshotIdentity()}};}
async function inspectUnstartedHost20Snapshot170({facts,operationId,assertNoOtherAssistant,archived=false}){
 if(!u.UUID.test(operationId||'')||typeof assertNoOtherAssistant!=='function')fail('HOST_RECOVERY_REQUIRED','Fixed snapshot identifier and live maintenance check required');
 if(typeof archived!=='boolean')fail('HOST_RECOVERY_REQUIRED','Fixed archive selection required');
 const install=u.safeAbsolute(facts.installationDir),state=startup.stateDirectory(install),parent=path.join(state,archived?'host-program-preflight-archives':'host-program-updates'),directory=path.join(parent,operationId),coreDirectory=path.join(state,'host-program-transactions',operationId),names=['journal.json',startup.STATUS,startup.CATALOG,'source-activation.json'];
 await assertNoOtherAssistant();await nativeAcl(facts.workerRoot,facts.authority,[state,install,parent,directory,...names.map(n=>path.join(directory,n))]);
 const directoryId=u.statIdentity(await u.assertPath(fs,directory,{directory:true}));
 async function noCore(){try{await inspectHistoricalDirectoryPath170({install:state,name:'host-program-transactions/'+operationId,installationIdentity:u.statIdentity(await u.assertPath(fs,state,{directory:true})),inspect:async(p,expected)=>{const id=u.statIdentity(await u.assertPath(fs,p,{directory:true}));if(expected&&id!==expected)fail('HOST_STATE_CHANGED','Core parent identity changed');return id;}});fail('HOST_RECOVERY_REQUIRED','A corresponding core operation exists; do not skip');}catch(e){if(e.code!=='ENOENT')throw e;}}
 async function current(){return{publisherPublicKey:facts.publicKey,sourceEnvelope:facts.sourceEnvelope,catalogEnvelopeBytes:await u.readSmall(fs,path.join(state,startup.CATALOG),2097152),targetEnvelope:facts.targetEnvelope,expectedTarget:{catalogSha256:facts.policy.target.catalogSha256,sequence:facts.policy.target.sequence},journalBytes:await u.readSmall(fs,path.join(state,'journal.json'),16777216),statusBytes:await u.readSmall(fs,path.join(state,startup.STATUS),16384),activationBytes:await u.readSmall(fs,path.join(install,'xjy-install-activation.json'),4096),integrityKey:await u.readSmall(fs,path.join(state,'journal-key.bin'),32),installationDir:install,stateDir:state,installationIdentity:u.statIdentity(await u.assertPath(fs,install,{directory:true})),stateIdentity:u.statIdentity(await u.assertPath(fs,state,{directory:true})),namespace:startup.namespace()};}
 await noCore();const first=await current(),token=stateApi.authenticateHost20State170(first),preserved={};for(const n of names)preserved[n]=await u.readSmall(fs,path.join(directory,n),n==='journal.json'?16777216:2097152);
 const entries=await fs.readdir(directory),hasOperation=entries.includes('operation.json');let operationBytes;if(hasOperation){await nativeAcl(facts.workerRoot,facts.authority,[path.join(directory,'operation.json')]);operationBytes=await u.readSmall(fs,path.join(directory,'operation.json'),2097152);}
 stateApi.verifyHost20SnapshotOnly170(token,{preserved,entries,coreExists:false,...(hasOperation?{operationBytes,snapshotIdentity:directoryId,operationId}:{})});
 const tree=await core.inspectArtifactTree({artifactDir:install,pathPolicy:'preserved-history'});if(tree.sha256!==stateApi.describeHost20State170(token).expectedSourceTreeSha256)fail('HOST_SOURCE_CHANGED','Original source tree changed; retain incomplete attempt');
 await assertNoOtherAssistant();await noCore();const final=await current();stateApi.authenticateHost20State170(final);for(const n of ['journalBytes','statusBytes','catalogEnvelopeBytes','activationBytes','integrityKey'])if(!first[n].equals(final[n]))fail('HOST_STATE_CHANGED','Committed source changed during snapshot preflight');if(first.installationIdentity!==final.installationIdentity||first.stateIdentity!==final.stateIdentity||directoryId!==u.statIdentity(await u.assertPath(fs,directory,{directory:true})))fail('HOST_STATE_CHANGED','Source or snapshot physical identity changed');
 const again={};for(const n of names)again[n]=await u.readSmall(fs,path.join(directory,n),n==='journal.json'?16777216:2097152);const finalEntries=await fs.readdir(directory);if(JSON.stringify([...finalEntries].sort())!==JSON.stringify([...entries].sort()))fail('HOST_SNAPSHOT_CHANGED','Snapshot entries changed');let finalOperation;if(hasOperation){finalOperation=await u.readSmall(fs,path.join(directory,'operation.json'),2097152);if(!finalOperation.equals(operationBytes))fail('HOST_SNAPSHOT_CHANGED','Unstarted operation changed');}stateApi.verifyHost20SnapshotOnly170(token,{preserved:again,entries:finalEntries,coreExists:false,...(hasOperation?{operationBytes:finalOperation,snapshotIdentity:directoryId,operationId}:{})});
 return{snapshotOnly:true,retained:true,modified:false,operationId,directory,snapshotIdentity:directoryId};
}
async function archiveUnstartedHost20Snapshot170(input){
 const {facts,operationId,assertNoOtherAssistant}=input,before=await inspectUnstartedHost20Snapshot170(input),state=startup.stateDirectory(facts.installationDir),parent=path.join(state,'host-program-preflight-archives'),target=path.join(parent,operationId);
 let parentExists=true;try{await u.assertPath(fs,parent,{directory:true});}catch(e){if(e.code!=='ENOENT')throw e;parentExists=false;}
 if(!parentExists)await nativeAcl(facts.workerRoot,facts.authority,[state],[parent]);else await nativeAcl(facts.workerRoot,facts.authority,[parent]);
 try{await fs.lstat(target);fail('HOST_ARCHIVE_EXISTS','Existing archive is preserved; never overwrite');}catch(e){if(e.code!=='ENOENT')throw e;}
 await assertNoOtherAssistant();if(before.snapshotIdentity!==u.statIdentity(await u.assertPath(fs,before.directory,{directory:true})))fail('HOST_STATE_CHANGED','Snapshot identity changed before archival');
 // Windows directory rename is atomic and cannot replace an existing directory.
 // A racing mover loses with ENOENT/EEXIST; do not delete, overwrite or retry it.
 await fs.rename(before.directory,target);
 const after=await inspectUnstartedHost20Snapshot170({...input,archived:true});if(after.snapshotIdentity!==before.snapshotIdentity)fail('HOST_STATE_CHANGED','Archived snapshot physical identity changed');
 return{snapshotOnly:true,archived:true,retained:true,originalDirectory:before.directory,archiveDirectory:target,snapshotIdentity:after.snapshotIdentity,operationId,receiptModified:false};
}
module.exports={archiveUnstartedHost20Snapshot170,inspectHistoricalDirectoryPath170,inspectUnstartedHost20Snapshot170,createHost20StateIo170,getHost20StateIoContext170};

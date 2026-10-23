'use strict';
// Source-only persistent compatibility candidate. Catalog sequence remains inherited; Root must bind a final signed publication before deployment.
// Parent retains original one-shot adapter; the owned child uses the fixed persistent adapter.
// No CLI, actor, approval creation, canonical fabrication or process killing.
const fs=process.versions.electron?require('original-fs'):require('node:fs');
const io=fs.promises,path=require('node:path'),crypto=require('node:crypto'),os=require('node:os'),childProcess=require('node:child_process');
const core=require('../delivery-tools/initial-patch-core.cjs');
const entry=require('../delivery-tools/initial-patch-entry.cjs');
const u=require('../project/desktop/employee-update-cache.cjs');
const installerModule=require('../project/desktop/employee-update-installer.cjs');
const recovery=require('../project/desktop/employee-recovery-entry.cjs');
const helper=require('../project/desktop/updater-helper.cjs');
const {readInitialUpgradeGate}=require('../project/desktop/initial-upgrade-gate.cjs');
const PRODUCT='xjy-jewelry-offline',SOURCE='1.6.1',TARGET='1.6.2',SEQUENCE=10;
const EXE='鑫金源珠宝报价.exe',PUBLISHER='6e8b9cadb59aeb53f30d41f4471f70f644f0dfc7376ffb9d8a4c62defb98458c';
const ENGINE={size:246302720,sha256:'db3ad2066a55546f9b6737da3c7f011370e4856fb36888055b544d45653e4f40'};
const SOURCE_ASAR={size:12541824,sha256:'7e4b04ef51c741f7da66da7e55cd5a280b792f32cd0a0fe8d19606f0996de07d'};
const HELPERS=Object.freeze([
 {name:'updater-helper.cjs',size:12823,sha256:'adb25b58eaa56b022e6c758cfc2bde7a7fe437a5688dc942e1bdb67aacc9e830'},
 {name:'employee-update-installer.cjs',size:30460,sha256:'96ba3df08a0f706e599da7d452374b1f894d401c0a6ff605fc01255d01445bd0'},
 {name:'employee-update-cache.cjs',size:17326,sha256:'5cb70079bf161a002a2701694e4774c2a11bf8d54efc6674ccb5c7b2c6729815'},
 {name:'bootstrap.json',size:87430,sha256:'7f3362659908e5cedc1c8bf846901778bb622544c4b1c615c02d87c441cc54fa'}
].map(Object.freeze));
const SHA=/^[a-f0-9]{64}$/;
const COMPAT_ENTRY=path.resolve(__dirname,'employee161-utf8-compat-helper-persistent-a1.cjs');
const COMPAT_SHA='0795ccdef13d2a62b2473c9722ba418be15feb7c88996758d3027ee32cbf4ce4';
const UTF8_SOURCE=path.resolve(__dirname,'updater-helper-persistent-a2.cjs');
const UTF8_SHA='d7c7c877dc8bcec3bb07250a252485d8f81b943ed9fb5ddb73f7364912bc2e5c';
let active=false,scheduled=false;
function requireValue(condition,code,message){if(!condition)u.fail(code,message);}
function exact(value,keys){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&Object.keys(value).every(k=>keys.includes(k));}
function beneath(root,file){const rel=path.relative(root.toLowerCase(),file.toLowerCase());return rel===''||rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel);}
function matching(actual,pin){return actual&&actual.size===pin.size&&actual.sha256===pin.sha256;}
function publicKey(value){
 requireValue(typeof value==='string'&&/^-----BEGIN PUBLIC KEY-----\r?\n/.test(value)&&!value.includes('PRIVATE KEY'),'BAD_PUBLIC_KEY','Only the original public publisher key is permitted');
 const key=crypto.createPublicKey(value);
 requireValue(key.asymmetricKeyType==='ed25519'&&u.digest(key.export({type:'spki',format:'der'}))===PUBLISHER,'BAD_PUBLIC_KEY','Original publisher fingerprint mismatch');return key;
}
function authorityValue(value){
 requireValue(exact(value,['approvalRoot','osUser','local','roaming','publicationId'])&&/^S-1-5-21-\d+-\d+-\d+-\d+$/.test(value.osUser||'')&&SHA.test(value.publicationId||''),'BAD_NATIVE_AUTHORITY','Original native SID and publication authority required');
 for(const k of ['approvalRoot','local','roaming'])u.safeAbsolute(value[k]);
 requireValue(path.basename(value.approvalRoot)===value.publicationId&&path.basename(path.dirname(value.approvalRoot))==='鑫金源珠宝补丁审定-'+value.osUser,'BAD_NATIVE_AUTHORITY','Fixed external approval directory required');
 return value;
}
function requireCurrent(current,exe,expected){
 requireValue(current&&current.pid===process.pid&&typeof current.creationMarker==='string'&&current.creationMarker.length>0&&u.samePath(current.executablePath,exe)&&(!expected||current.creationMarker===expected.creationMarker)&&Array.isArray(current.args)&&!current.args.some(a=>/host|xjy-print-worker|module-sidecar/i.test(a)),'BAD_PROCESS','Actual original employee EXE parent identity required');
}
async function employeeStatus(install,profile){
 const file=path.join(install,'.xjy-employee-updates','recovery-status.json');let status;
 try{status=await u.authenticatedRead(io,file,profile,4096);}catch(error){
  // ENOENT from the integrity key must not masquerade as an absent status.
  if(error.code==='ENOENT'&&!fs.existsSync(file))return;throw error;
 }
 requireValue(exact(status,['version','phase','transactionId','expectedVersion','targetVersion'])&&status.version===1&&u.UUID.test(status.transactionId||'')&&['prepared','mutating','committed','rolledback'].includes(status.phase),'BAD_METADATA','Employee recovery status is invalid');
 requireValue(['committed','rolledback'].includes(status.phase),'RECOVERY_REQUIRED','Complete the original employee recovery before rescue');
 requireValue((status.phase==='committed'?status.targetVersion:status.expectedVersion)===SOURCE,'RECOVERY_CONFLICT','Employee completion record does not match installed 1.6.1');
}
async function installedSource(trusted){
 const asar=path.join(trusted.install,'resources','app.asar'),pkg=await core.packageIdentity(io,asar,trusted.install),info=await core.fileHash(io,asar,trusted.install);
 requireValue(pkg.name===PRODUCT&&pkg.version===SOURCE&&pkg.main==='release-entry.cjs'&&matching(info,SOURCE_ASAR)&&trusted.sourcePolicy.sourcePrograms.some(row=>row.version===pkg.version&&row.main===pkg.main&&row.asarSize===info.size&&row.asarSha256===info.sha256)&&trusted.catalog.sourceVersions.includes(SOURCE),'SOURCE_PROGRAM_MISMATCH','Approved original installed 1.6.1 source tuple required');
 requireValue(matching(await core.fileHash(io,trusted.exe,trusted.install),ENGINE)&&matching(trusted.engine,ENGINE)&&matching(trusted.sourcePolicy.engine,ENGINE)&&trusted.sourcePolicy.engine.electronRunAsNode===true&&trusted.sourcePolicy.engine.nodeSqliteBackup===true,'SOURCE_ENGINE_MISMATCH','Original approved Electron engine required');
 const activation=JSON.parse(await u.readSmall(io,path.join(trusted.install,'xjy-install-activation.json'),4096));
 requireValue(exact(activation,['version','product','programVersion','role','installationDir'])&&activation.version===1&&activation.product===PRODUCT&&activation.programVersion===SOURCE&&activation.role==='employee'&&u.samePath(activation.installationDir,trusted.install),'BAD_ACTIVATION','Exact original employee activation required');
}
async function helperPolicy(install,exe){
 const directory=path.join(install,'resources','update-helper');
 for(const pin of HELPERS)requireValue(matching(await core.fileHash(io,path.join(directory,pin.name),install),pin),'BAD_HELPER','Original installed 1.6.1 helper bytes changed: '+pin.name);
 const b=JSON.parse(await u.readSmall(io,path.join(directory,'bootstrap.json'),1048576));
 requireValue(exact(b,['version','product','programVersion','executableName','platform','arch','publisherPublicKey','allowedFiles','dependencies'])&&b.version===1&&b.product===PRODUCT&&b.programVersion===SOURCE&&b.executableName===EXE&&b.platform==='win32'&&b.arch==='x64'&&Array.isArray(b.dependencies)&&b.dependencies.length===2,'BAD_BOOTSTRAP','Original installed bootstrap required');
 const dependencies=HELPERS.filter(row=>['employee-update-installer.cjs','employee-update-cache.cjs'].includes(row.name));
 requireValue(new Set(b.dependencies.map(row=>row.name)).size===2&&b.dependencies.every(row=>exact(row,['name','sha256'])&&dependencies.some(pin=>pin.name===row.name&&pin.sha256===row.sha256)),'BAD_BOOTSTRAP','Original helper dependency pins required');
 const key=publicKey(b.publisherPublicKey);
 requireValue(Array.isArray(b.allowedFiles)&&b.allowedFiles.length===1007&&b.allowedFiles.includes('resources/app.asar')&&b.allowedFiles.every(installerModule.programPath),'BAD_BOOTSTRAP','Original complete program-only resource allowlist required');
 const pins=recovery.validateHelperPins({version:1,product:PRODUCT,programVersion:SOURCE,executableName:EXE,publisherPublicKey:b.publisherPublicKey,publisherPublicKeySha256:PUBLISHER,allowedFiles:b.allowedFiles,bootstrapSha256:HELPERS[3].sha256,files:HELPERS.map(row=>({...row}))},{currentVersion:SOURCE,executablePath:exe});
 return{pins,policyOptions:{trustedPublicKey:key,allowedFiles:[...b.allowedFiles],currentVersion:SOURCE,platform:'win32',arch:'x64'}};
}
async function compatSources(){
 for(const [file,pin]of [[COMPAT_ENTRY,COMPAT_SHA],[UTF8_SOURCE,UTF8_SHA]]){const read=await core.fileHash(io,file,path.dirname(file));requireValue(read.sha256===pin&&read.size>0&&read.size<=1048576,'COMPAT_SOURCE_CHANGED','Fixed compatibility source changed');}
}
async function originalHandoff(launch,{install,profile,exe,current,stageId,catalog,envelope}){
 await compatSources();
 const handoff=path.dirname(launch.args[0]);
 for(const pin of HELPERS)requireValue(matching(await core.fileHash(io,path.join(handoff,pin.name),profile),pin),'BAD_HELPER','Original copied helper changed: '+pin.name);
 const record=JSON.parse(await u.readSmall(io,launch.args[1],4194304)),capability=launch.env.XJY_UPDATE_CAPABILITY;
 requireValue(exact(record,['request','mac'])&&typeof record.request==='string'&&SHA.test(record.mac||'')&&u.digest(Buffer.from(record.request))===launch.requestHash&&crypto.timingSafeEqual(crypto.createHmac('sha256',Buffer.from(capability,'hex')).update(record.request).digest(),Buffer.from(record.mac,'hex')),'BAD_REQUEST','Original request hash or HMAC changed');
 const r=JSON.parse(record.request);
 requireValue(exact(r,['version','operation','installDir','profileDir','executablePath','currentVersion','currentProcess','stage','employee','expectedVersion'])&&r.version===1&&r.operation==='install'&&r.employee===true&&r.currentVersion===SOURCE&&r.expectedVersion===SOURCE&&u.samePath(r.installDir,install)&&u.samePath(r.profileDir,profile)&&u.samePath(r.executablePath,exe)&&exact(r.currentProcess,['pid','creationMarker'])&&r.currentProcess.pid===current.pid&&r.currentProcess.creationMarker===current.creationMarker&&r.stage?.stageId===stageId&&u.samePath(r.stage.profileDir,profile)&&JSON.stringify(r.stage.catalog)===JSON.stringify(catalog)&&JSON.stringify(r.stage.envelope)===JSON.stringify(envelope),'BAD_REQUEST','Request does not bind this original authenticated stage and parent');
}
async function runEmployee161Rescue(input){
 requireValue(exact(input,['artifactDir','archivePath','nativeAuthority']),'INVALID_RESCUE_INPUT','Only artifactDir, archivePath and original nativeAuthority are accepted');
 requireValue(!active&&!scheduled,'BUSY','This controller already owns or scheduled a rescue');
 requireValue(process.platform==='win32'&&process.versions.electron&&process.env.ELECTRON_RUN_AS_NODE==='1'&&!process.env.NODE_OPTIONS&&!process.env.NODE_PATH,'UNTRUSTED_LAUNCH','Run only the approved original Electron EXE as Node');
 active=true;
 let barrier=null,cache=null,archive=null,owned=null,ownedClosed=null,operationError=null,result=null;
 try{
  const artifact=u.safeAbsolute(input.artifactDir),archivePath=u.safeAbsolute(input.archivePath),passed=authorityValue(input.nativeAuthority);
  requireValue(!beneath(artifact,archivePath),'UNSAFE_PATH','The approved ZIP must be outside the exact inspected artifact tree');
  const authority=authorityValue(await entry.resolveRepeatNativeAuthority({artifactDir:artifact}));
  requireValue(['osUser','publicationId'].every(k=>passed[k]===authority[k])&&['approvalRoot','local','roaming'].every(k=>u.samePath(passed[k],authority[k])),'BAD_NATIVE_AUTHORITY','Passed authority does not match the actual native SID and known folders');
  const deferred={waitClosed:value=>barrier.waitClosed(value),assertClosed:value=>barrier.assertClosed(value),restart:value=>barrier.restart(value)};
  const inspector=core.createInitialPatchInstaller({upgradeMode:'repeat',artifactDir:artifact,approvalRoot:authority.approvalRoot,approvalFile:path.join(authority.approvalRoot,'initial-upgrade-approval.json'),osUser:authority.osUser,osUserNamespace:entry.osNamespace(),confirmRole:async()=> 'employee',processBarrier:deferred});
  const trusted=await inspector.inspect();
  requireValue(trusted.approval.role==='employee'&&trusted.approval.osUser===authority.osUser&&trusted.approval.purpose==='xjy-repeat-program-patch'&&trusted.sourcePolicy.purpose==='xjy-repeat-program-patch'&&trusted.sourcePolicy.targetVersion===TARGET&&trusted.sourcePolicy.publisherPublicKeySha256===PUBLISHER&&trusted.approval.publisherPublicKeySha256===PUBLISHER&&trusted.sourcePolicy.executableName===EXE,'EMPLOYEE_DEVICE_REQUIRED','Only the separately approved original employee installation may be repaired');
  requireValue(u.samePath(trusted.install,trusted.approval.installationDir)&&u.samePath(trusted.exe,path.join(trusted.install,EXE))&&u.samePath(process.execPath,trusted.exe),'SOURCE_ENGINE_MISMATCH','Controller must run inside the actual approved original EXE');
  for(const root of [trusted.install,authority.approvalRoot])requireValue(!beneath(root,archivePath)&&!beneath(root,artifact)&&!beneath(artifact,root),'UNSAFE_PATH','Artifact, ZIP, installation and external approval must be separate');
  requireValue(trusted.upgrade?.publicationId===authority.publicationId&&['none','committed','rolledback'].includes(trusted.upgrade.phase),'RECOVERY_REQUIRED','Pending or unknown program patch must be recovered first');
  requireValue(trusted.sourcePolicy.catalogSha256===authority.publicationId&&typeof trusted.envelope.catalog==='string'&&u.digest(Buffer.from(trusted.envelope.catalog))===authority.publicationId,'BAD_NATIVE_AUTHORITY','Signed catalog must match this external publication authority');
  await installedSource(trusted);
  await compatSources();
  const environment={...entry.cleanInitialEnvironment(process.env),SystemRoot:'C:\\Windows',WINDIR:'C:\\Windows',LOCALAPPDATA:authority.local,APPDATA:authority.roaming};
  barrier=entry.createInitialProcessBarrier({installationDir:trusted.install,executablePath:trusted.exe,role:'employee',helperPid:process.pid,artifactDir:artifact,environment});
  let current=null,handoffReady=false,exitRequested=false,compatPermission=null;
  // The original adapter still authenticates ready. Its single owned spawn is
  // explicitly redirected to the sealed compatibility CLI, never a fake PID.
  const observeSpawn=(exe,args,options)=>{
   requireValue(!owned,'BAD_HANDOFF','Only one original helper child may be launched');
   const permission=compatPermission;
   requireValue(permission&&u.samePath(exe,trusted.exe)&&Array.isArray(args)&&args.length===2&&args.every((value,index)=>u.samePath(value,permission.args[index]))&&exact(options,['cwd','env','shell','windowsHide','detached','stdio'])&&u.samePath(options.cwd,trusted.install)&&options.shell===false&&options.windowsHide===true&&options.detached===true&&options.stdio==='ignore'&&options.env?.ELECTRON_RUN_AS_NODE==='1'&&options.env.XJY_UPDATE_CAPABILITY===permission.capability&&Object.keys(options.env).every(key=>['SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','PATH','ELECTRON_RUN_AS_NODE','XJY_UPDATE_CAPABILITY'].includes(key)),'BAD_HANDOFF','Actual spawn must match the validated original handoff');
   compatPermission=null;
   owned=childProcess.spawn(exe,[COMPAT_ENTRY,'--source-sha256',COMPAT_SHA,'--request-path',permission.args[1]],options);
   ownedClosed=new Promise(resolve=>{owned.once('close',resolve);owned.once('error',()=>{if(!owned.pid)resolve();});});return owned;
  };
  const native=helper.createWindowsUpdateProcessAdapter({executablePath:trusted.exe,environment,spawn:observeSpawn,requestExit:async request=>{
   requireValue(handoffReady&&exact(request,['pid','creationMarker','normalExit'])&&request.pid===current.pid&&request.creationMarker===current.creationMarker&&request.normalExit===true,'BAD_PROCESS','Only an authenticated ready helper may request this parent normal exit');
   exitRequested=true;return{accepted:true};
  }});
  current=await native.inspect(process.pid);requireCurrent(current,trusted.exe);
  await barrier.assertClosed();
  requireValue(!(await native.listForInstallation()).some(row=>row.pid!==process.pid),'PROGRAM_IN_USE','Close other installed employee processes normally before rescue');
  const initial=readInitialUpgradeGate({installDir:trusted.install,installedRole:'employee'});
  requireValue(initial?.blocked===false,'RECOVERY_REQUIRED','Original initial-upgrade gate requires recovery');
  const profile=await entry.resolveInitialEmployeeProfile({installDir:trusted.install,localAppData:authority.local,roamingAppData:authority.roaming});
  requireValue(typeof profile==='string','KNOWN_PROFILE_REQUIRED','An existing known employee profile is required; fresh-profile preparation is separate');
  u.safeAbsolute(profile);await u.assertPath(io,profile,{directory:true});
  requireValue(!beneath(profile,archivePath)&&!beneath(profile,artifact)&&!beneath(artifact,profile),'UNSAFE_PATH','The approved source materials must be separate from the employee profile');
  await employeeStatus(trusted.install,profile);
  const {pins,policyOptions}=await helperPolicy(trusted.install,trusted.exe);
  publicKey((await u.readSmall(io,path.join(artifact,'publisher-public.pem'),4096)).toString('utf8'));
  const catalog=u.verifySignedCatalog(trusted.envelope,u.createTrustedUpdatePolicy(policyOptions));
  requireValue(catalog.version===TARGET&&catalog.sequence===SEQUENCE&&catalog.sourceVersions.includes(SOURCE)&&catalog.files.length===policyOptions.allowedFiles.length&&new Set(catalog.files.map(row=>row.path)).size===policyOptions.allowedFiles.length&&catalog.files.every(row=>policyOptions.allowedFiles.includes(row.path)&&installerModule.programPath(row.path))&&JSON.stringify(catalog)===JSON.stringify(trusted.catalog),'BAD_CATALOG','Exact approved sequence 10 complete 1.6.2 program catalog required');
  const zip=await core.fileHash(io,archivePath,path.dirname(archivePath));
  requireValue(matching(zip,catalog.archive),'BAD_ARCHIVE','Approved signed ZIP size or SHA mismatch');
  archive=await u.openChecked(io,archivePath,'r',{root:path.dirname(archivePath)});
  requireValue(archive.identity===zip.identity&&Number((await u.assertHandle(io,archive,{root:path.dirname(archivePath)})).size)===catalog.archive.size,'FILE_CHANGED','Approved ZIP identity changed before staging');
  cache=u.createEmployeeUpdateCache({...policyOptions,profileDir:profile,resolveCatalogEnvelope:async value=>{
   requireValue(JSON.stringify(value)===JSON.stringify(catalog),'BAD_CATALOG','Only this approved catalog may enter the cache');return trusted.envelope;
  }});
  requireValue(catalog.sequence>=await cache.getAcceptedSequence(),'STALE_CATALOG','A newer release was already accepted');
  await cache.setAcceptedSequence(catalog.sequence);
  const stageId=await cache.begin(catalog);
  for(let offset=0;offset<catalog.archive.size;offset+=u.CHUNK){
   await u.assertHandle(io,archive,{root:path.dirname(archivePath)});
   await cache.write(stageId,offset,await u.readExactly(archive.handle,offset,Math.min(u.CHUNK,catalog.archive.size-offset)));
  }
  await u.assertHandle(io,archive,{root:path.dirname(archivePath)});
  await cache.seal(stageId,{archiveSha256:catalog.archive.sha256,sequence:catalog.sequence,version:catalog.version,fileCount:catalog.files.length});
  await installedSource(trusted);requireCurrent(await native.inspect(process.pid),trusted.exe,current);await barrier.assertClosed();
  await employeeStatus(trusted.install,profile);
  const adapter={...native,launchHelper:async launch=>{
   requireValue(launch&&u.samePath(launch.executablePath,trusted.exe)&&launch.args?.length===2&&path.basename(launch.args[0])==='updater-helper.cjs'&&path.basename(launch.args[1])==='request.json'&&u.samePath(path.dirname(launch.args[0]),path.dirname(launch.args[1]))&&u.samePath(path.dirname(path.dirname(launch.args[0])),path.join(profile,'employee-update-handoffs'))&&u.UUID.test(path.basename(path.dirname(launch.args[0])))&&SHA.test(launch.requestHash||'')&&SHA.test(launch.env?.XJY_UPDATE_CAPABILITY||'')&&launch.env.ELECTRON_RUN_AS_NODE==='1','BAD_HANDOFF','Only the original authenticated fixed helper handoff is permitted');
   await originalHandoff(launch,{install:trusted.install,profile,exe:trusted.exe,current,stageId,catalog,envelope:trusted.envelope});
   await recovery.writeEmployeeRecoveryPointer({profileDir:profile,installDir:trusted.install,executablePath:trusted.exe,helperPins:pins,currentOsUser:os.userInfo().username,launch});
   compatPermission={args:[...launch.args],capability:launch.env.XJY_UPDATE_CAPABILITY};
   let ready;try{ready=await native.launchHelper(launch);}finally{compatPermission=null;}
   requireValue(ready?.ready===true&&owned&&Number.isSafeInteger(owned.pid)&&owned.pid>0,'HANDOFF_FAILED','Original helper did not authenticate readiness after an actual owned spawn');handoffReady=true;return ready;
  }};
  const installer=installerModule.createEmployeeUpdateInstaller({...policyOptions,profileDir:profile,installDir:trusted.install,executablePath:trusted.exe,clientRole:'employee',currentProcess:{pid:current.pid,creationMarker:current.creationMarker},cache,helperFiles:HELPERS.map(row=>({...row,sourcePath:path.join(trusted.install,'resources','update-helper',row.name)})),processAdapter:adapter});
  const receipt=await installer.install({stageId,verifiedCatalog:catalog,expectedVersion:SOURCE,employee:true,closeEmployeeApp:true,requiresBackup:true,stopHost:false});
  requireValue(receipt?.scheduled===true&&handoffReady&&exitRequested,'HANDOFF_FAILED','Original typed handoff and normal-exit request must both succeed');
  const child=await native.inspect(owned.pid);
  requireValue(child&&child.pid===owned.pid&&child.pid!==current.pid&&typeof child.creationMarker==='string'&&child.creationMarker&&u.samePath(child.executablePath,trusted.exe),'BAD_PROCESS','Owned ready helper identity cannot be confirmed');
  scheduled=true;result={scheduled:true,requiresNormalExit:true,sourceVersion:SOURCE,targetVersion:TARGET,sequence:catalog.sequence,stageId,ownedHelper:{pid:child.pid,creationMarker:child.creationMarker,executablePath:child.executablePath}};
 }catch(error){operationError=error;}
 finally{
  for(const [name,close]of [['archive',()=>archive?.handle.close()],['cache',()=>cache?.close()],['inventory',()=>barrier?.close()]]){
   try{await close();}catch(error){if(!operationError)operationError=error;else operationError[name+'CloseError']=error.message;}
  }
  if(operationError&&ownedClosed){owned.ref();await ownedClosed;}
  active=false;
 }
 if(operationError)throw operationError;
 return result;
}
module.exports={runEmployee161Rescue};

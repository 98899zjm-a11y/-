'use strict';
// Package-external approval preparation only. The original controller remains
// a separate consumer; this module never installs, recovers, starts or kills.
const fs=process.versions.electron?require('original-fs'):require('node:fs');
const io=fs.promises,path=require('node:path'),crypto=require('node:crypto');
const core=require('../delivery-tools/initial-patch-core.cjs'),entry=require('../delivery-tools/initial-patch-entry.cjs');
const u=require('../project/desktop/employee-update-cache.cjs'),{programPath}=require('../project/desktop/employee-update-installer.cjs');
const {createWindowsUpdateProcessAdapter}=require('../project/desktop/updater-helper.cjs');
const {readInitialUpgradeGate}=require('../project/desktop/initial-upgrade-gate.cjs'),{employeeIdentity}=require('../project/desktop/launch-role.cjs');
const PRODUCT='xjy-jewelry-offline',PURPOSE='xjy-repeat-program-patch',EXE='鑫金源珠宝报价.exe';
const FIX=Object.freeze({"publisher":"6e8b9cadb59aeb53f30d41f4471f70f644f0dfc7376ffb9d8a4c62defb98458c","catalog":"230b9825c9c05749d193d9fdcb30906b084186fe7fdee3a22884085399001000","policy":"848927d754427c7b6017233d63327ab6799bf08221b33b98522e8d5db879c3f5","envelope":"3def76cbdab9f83696c8af4a56e5e4673d045b514b5ed1e0069ba9db7a9a7817","tree":"9f99df54812f26696c971f26a81403dc9c093cb85c1aefb1bf6dc7f41b2892aa","artifact":"55b5f65e41928657e192884dae38ebf13a33c6774e3d55268d7daa077e485334"});
const ENGINE=Object.freeze({size:246302720,sha256:'db3ad2066a55546f9b6737da3c7f011370e4856fb36888055b544d45653e4f40',electronRunAsNode:true,nodeSqliteBackup:true});
const SOURCE=Object.freeze({size:12541824,sha256:'7e4b04ef51c741f7da66da7e55cd5a280b792f32cd0a0fe8d19606f0996de07d'});
const TARGET=Object.freeze({size:12570325,sha256:'28e24d0dea9416258b67edc2b6fe6aca8683c68d02c9fc305626660dd4c55e6f'});
const ZIP=Object.freeze({size:163521799,sha256:'752d780b2a460ecb10bb1dbeee53187dd8486f697d0d9c9f082c8408888e866a'});
const HELPERS=Object.freeze([
 {name:'updater-helper.cjs',size:12823,sha256:'adb25b58eaa56b022e6c758cfc2bde7a7fe437a5688dc942e1bdb67aacc9e830'},
 {name:'employee-update-installer.cjs',size:30460,sha256:'96ba3df08a0f706e599da7d452374b1f894d401c0a6ff605fc01255d01445bd0'},
 {name:'employee-update-cache.cjs',size:17326,sha256:'5cb70079bf161a002a2701694e4774c2a11bf8d54efc6674ccb5c7b2c6729815'},
 {name:'bootstrap.json',size:87430,sha256:'7f3362659908e5cedc1c8bf846901778bb622544c4b1c615c02d87c441cc54fa'}
].map(Object.freeze));
const APPROVAL_FIELDS=['schemaVersion','purpose','approvalId','artifactSha256','treeSha256','publisherPublicKeySha256','sourcePolicySha256','verifiedPublisherName','role','installationDir','osUser','engine','approvedAt','expiresAt'];
const BINDING_FIELDS=['version','purpose','osUser','publicationId','role','installationDir','installationIdentity','approvalId'];
let active=false;
function need(value,code,message){if(!value)u.fail(code,message);}
function exact(value,keys){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&Object.keys(value).every(k=>keys.includes(k));}
function matches(info,pin){return info&&info.size===pin.size&&info.sha256===pin.sha256;}
function beneath(root,file){const rel=path.relative(root.toLowerCase(),file.toLowerCase());return rel===''||rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel);}
function separate(a,b){return !beneath(a,b)&&!beneath(b,a);}
async function present(file,{directory=false,root}={}){try{return await u.assertPath(io,file,{directory,root});}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function optionalBytes(file,max){try{return await u.readSmall(io,file,max);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function ordinaryAncestor(directory){for(let p=directory;;p=path.dirname(p)){if(await present(p,{directory:true}))return;need(p!==path.dirname(p),'UNSAFE_PATH','No ordinary existing ancestor');}}
function publisher(bytes){
 const text=bytes.toString('utf8');need(/^-----BEGIN PUBLIC KEY-----\r?\n/.test(text)&&!text.includes('PRIVATE KEY'),'BAD_PUBLIC_KEY','Original public key required');
 const key=crypto.createPublicKey(text);need(key.asymmetricKeyType==='ed25519'&&u.digest(key.export({type:'spki',format:'der'}))===FIX.publisher,'BAD_PUBLIC_KEY','Original publisher fingerprint mismatch');return key;
}
async function signedMaterials(artifact,archive){
 const pem=await u.readSmall(io,path.join(artifact,'publisher-public.pem'),4096),key=publisher(pem);
 const policyBytes=await u.readSmall(io,path.join(artifact,'source-policy-envelope.json'),2097152);
 need(u.digest(policyBytes)===FIX.envelope,'BAD_SOURCE_POLICY','Reviewed signed policy envelope changed');
 const pe=JSON.parse(policyBytes);need(typeof pe.policy==='string'&&u.digest(Buffer.from(pe.policy))===FIX.policy,'BAD_SOURCE_POLICY','Reviewed policy bytes changed');
 const policy=core.verifySourcePolicy(pe,key,{upgradeMode:'repeat'});
 need(policy.purpose===PURPOSE&&policy.app===PRODUCT&&policy.targetVersion==='1.6.2'&&policy.catalogSha256===FIX.catalog&&policy.publisherPublicKeySha256===FIX.publisher&&policy.executableName===EXE&&JSON.stringify(policy.engine)===JSON.stringify(ENGINE)&&Array.isArray(policy.tools)&&policy.tools.length===10,'BAD_SOURCE_POLICY','Only this reviewed release policy is permitted');
 const catalogBytes=await u.readSmall(io,path.join(artifact,'catalog-envelope.json'),2097152),envelope=JSON.parse(catalogBytes);
 need(typeof envelope.catalog==='string'&&u.digest(Buffer.from(envelope.catalog))===FIX.catalog,'BAD_CATALOG','Reviewed sequence 11 catalog changed');
 const parsed=JSON.parse(envelope.catalog);need(Array.isArray(parsed.files),'BAD_CATALOG','Program files required');
 const catalog=u.verifySignedCatalog(envelope,u.createTrustedUpdatePolicy({trustedPublicKey:key,allowedFiles:parsed.files.map(row=>row.path),currentVersion:'1.6.1',platform:'win32',arch:'x64'}));
 need(catalog.version==='1.6.2'&&catalog.sequence===11&&catalog.files.length===1007&&catalog.files.every(row=>programPath(row.path))&&matches(catalog.archive,ZIP),'BAD_CATALOG','Only the full reviewed sequence 11 program release is permitted');
 const target=catalog.files.find(row=>row.path==='resources/app.asar');
 need(matches(target,TARGET)&&policy.sourcePrograms.some(row=>row.version==='1.6.2'&&row.main==='release-entry.cjs'&&row.asarSize===TARGET.size&&row.asarSha256===TARGET.sha256),'BAD_PROGRAM','Target ASAR must match the reviewed release tuple');
 const tree=await core.inspectArtifactTree({artifactDir:artifact});
 const metadata=[{path:'publisher-public.pem',size:pem.length,sha256:u.digest(pem)},{path:'catalog-envelope.json',size:catalogBytes.length,sha256:u.digest(catalogBytes)},{path:'source-policy-envelope.json',size:policyBytes.length,sha256:u.digest(policyBytes)}];
 const expected=new Map([...metadata,...policy.tools,...catalog.files.map(row=>({...row,path:'payload/'+row.path}))].map(row=>[row.path,row]));
 need(tree.sha256===FIX.tree&&tree.files.length===1020&&expected.size===1020&&new Set(tree.files.map(row=>row.path.toLowerCase())).size===1020&&tree.files.every(row=>matches(row,expected.get(row.path))),'ARTIFACT_CHANGED','Exact reviewed 1020-file tree required');
 const targetPackage=await core.packageIdentity(io,path.join(artifact,'payload/resources/app.asar'),artifact);
 need(targetPackage.name===PRODUCT&&targetPackage.version==='1.6.2'&&targetPackage.main==='release-entry.cjs','BAD_PROGRAM','Target release entry mismatch');
 need(matches(await core.fileHash(io,archive,path.dirname(archive)),ZIP),'BAD_ARCHIVE','Reviewed resource ZIP changed');
 return{policy,catalog};
}
async function originalEmployee(install,policy){
 const asar=path.join(install,'resources/app.asar'),pkg=await core.packageIdentity(io,asar,install),info=await core.fileHash(io,asar,install);
 need(pkg.name===PRODUCT&&pkg.version==='1.6.1'&&pkg.main==='release-entry.cjs'&&matches(info,SOURCE)&&policy.sourcePrograms.some(row=>row.version===pkg.version&&row.main===pkg.main&&row.asarSize===info.size&&row.asarSha256===info.sha256),'SOURCE_PROGRAM_MISMATCH','Original installed 1.6.1 source tuple required');
 const exe=path.join(install,EXE);need(matches(await core.fileHash(io,exe,install),ENGINE)&&u.samePath(process.execPath,exe),'SOURCE_ENGINE_MISMATCH','Run only the exact original installed engine');
 const activation=JSON.parse(await u.readSmall(io,path.join(install,'xjy-install-activation.json'),4096));
 need(exact(activation,['version','product','programVersion','role','installationDir'])&&activation.version===1&&activation.product===PRODUCT&&activation.programVersion==='1.6.1'&&activation.role==='employee'&&u.samePath(activation.installationDir,install),'BAD_ACTIVATION','Exact employee activation required');
 for(const pin of HELPERS)need(matches(await core.fileHash(io,path.join(install,'resources/update-helper',pin.name),install),pin),'BAD_HELPER','Original installed helper changed: '+pin.name);
 const bootstrap=JSON.parse(await u.readSmall(io,path.join(install,'resources/update-helper/bootstrap.json'),1048576));
 need(exact(bootstrap,['version','product','programVersion','executableName','platform','arch','publisherPublicKey','allowedFiles','dependencies'])&&bootstrap.version===1&&bootstrap.product===PRODUCT&&bootstrap.programVersion==='1.6.1'&&bootstrap.executableName===EXE&&bootstrap.platform==='win32'&&bootstrap.arch==='x64'&&Array.isArray(bootstrap.dependencies)&&bootstrap.dependencies.length===2,'BAD_BOOTSTRAP','Original bootstrap required');
 publisher(Buffer.from(bootstrap.publisherPublicKey));u.createTrustedUpdatePolicy({trustedPublicKey:bootstrap.publisherPublicKey,allowedFiles:bootstrap.allowedFiles,currentVersion:'1.6.1',platform:'win32',arch:'x64'});
 need(bootstrap.allowedFiles.length===1007&&bootstrap.allowedFiles.every(programPath)&&new Set(bootstrap.dependencies.map(row=>row.name)).size===2&&bootstrap.dependencies.every(row=>exact(row,['name','sha256'])&&HELPERS.some(pin=>['employee-update-installer.cjs','employee-update-cache.cjs'].includes(pin.name)&&pin.name===row.name&&pin.sha256===row.sha256)),'BAD_BOOTSTRAP','Original program-only helper policy required');
 return{exe,allowedFiles:bootstrap.allowedFiles};
}
async function profileState(install,authority){
 const known=await entry.resolveInitialEmployeeProfile({installDir:install,localAppData:authority.local,roamingAppData:authority.roaming});
 if(typeof known==='string'){u.safeAbsolute(known);await u.assertPath(io,known,{directory:true});return{profileDir:known,known:true};}
 const identity=employeeIdentity();need(u.safeRelative(identity)&&!/[\\/]/.test(identity)&&identity.length<=90,'BAD_NAMESPACE','Original employee namespace required');
 const profileDir=path.join(authority.local,'鑫金源珠宝员工端',identity);await ordinaryAncestor(profileDir);const stat=await present(profileDir,{directory:true});
 if(stat)need((await io.readdir(profileDir)).length===0,'UNKNOWN_PROFILE','Existing unknown employee profile must be preserved');
 return{profileDir,known:false,identity,existingIdentity:stat?u.statIdentity(stat):null};
}
async function pendingGates(install,profile){
 need(readInitialUpgradeGate({installDir:install,installedRole:'employee'}).blocked===false,'RECOVERY_REQUIRED','Original initial gate requires recovery');
 await ordinaryAncestor(path.join(install,'.xjy-patches',FIX.catalog));await ordinaryAncestor(path.join(install,'.xjy-employee-updates'));
 need(!await present(path.join(install,'.xjy-patches',FIX.catalog,'journal.json'),{root:install}),'RECOVERY_REQUIRED','Existing publication journal requires its original recovery entry');
 const statusFile=path.join(install,'.xjy-employee-updates/recovery-status.json'),journal=path.join(install,'.xjy-employee-updates/journal.json');
 const statusExists=await present(statusFile,{root:install});
 if(!statusExists){need(!await present(journal,{root:install}),'RECOVERY_REQUIRED','Employee journal exists without authenticated status');return;}
 need(profile.known,'KNOWN_PROFILE_REQUIRED','Pending employee metadata requires its original known profile');
 const status=await u.authenticatedRead(io,statusFile,profile.profileDir,4096);
 need(exact(status,['version','phase','transactionId','expectedVersion','targetVersion'])&&status.version===1&&u.UUID.test(status.transactionId||'')&&['committed','rolledback'].includes(status.phase)&&(status.phase==='committed'?status.targetVersion:status.expectedVersion)==='1.6.1','RECOVERY_REQUIRED','Existing employee transaction must be recovered first');
}
async function approvalState(authority,install,identity,profile){
 const approvalFile=path.join(authority.approvalRoot,'initial-upgrade-approval.json'),bindingFile=path.join(authority.approvalRoot,'employee161-rescue-approval-binding.json');
 const bytes=await optionalBytes(approvalFile,8192),bindingBytes=await optionalBytes(bindingFile,4096);
 if(!bytes&&!bindingBytes)return{approvalFile,bindingFile,reuse:false};
 need(bytes&&bindingBytes,'APPROVAL_CONFLICT','Incomplete approval/binding must be preserved for review');
 const approval=JSON.parse(bytes),binding=JSON.parse(bindingBytes);
 need(exact(approval,APPROVAL_FIELDS),'APPROVAL_CONFLICT','Approval must retain its original fourteen fields');
 core.validateApproval(approval,{osUser:authority.osUser,now:Date.now,upgradeMode:'repeat'});
 need(approval.schemaVersion===1&&approval.purpose===PURPOSE&&u.UUID.test(approval.approvalId||'')&&approval.artifactSha256===FIX.artifact&&approval.treeSha256===FIX.tree&&approval.publisherPublicKeySha256===FIX.publisher&&approval.sourcePolicySha256===FIX.policy&&approval.role==='employee'&&approval.osUser===authority.osUser&&u.samePath(approval.installationDir,install)&&JSON.stringify(approval.engine)===JSON.stringify(ENGINE)&&typeof approval.verifiedPublisherName==='string'&&approval.verifiedPublisherName.trim()&&Date.parse(approval.expiresAt)>Date.now()&&Date.parse(approval.approvedAt)<=Date.now()+300000,'APPROVAL_CONFLICT','Existing approval is expired or does not bind this operation');
 need(exact(binding,BINDING_FIELDS)&&binding.version===1&&binding.purpose==='employee161-rescue-approval-binding'&&binding.osUser===authority.osUser&&binding.publicationId===FIX.catalog&&binding.role==='employee'&&u.samePath(binding.installationDir,install)&&binding.installationIdentity===identity&&binding.approvalId===approval.approvalId&&profile.known,'APPROVAL_CONFLICT','Existing approval identity binding or original profile mismatch');
 return{approvalFile,bindingFile,reuse:true};
}
async function createNew(file,value,root){
 const bytes=Buffer.from(JSON.stringify(value)+'\n'),opened=await u.openChecked(io,file,'wx+',{missing:true,root});
 try{await u.writeExactly(opened.handle,0,bytes);await opened.handle.sync();const stat=await u.assertHandle(io,opened,{snapshot:false,root});need(Number(stat.size)===bytes.length&&(await u.readExactly(opened.handle,0,bytes.length)).equals(bytes),'METADATA_WRITE_FAILED','CreateNew metadata readback failed');}
 finally{await opened.handle.close();}
 need((await u.readSmall(io,file,8192)).equals(bytes),'METADATA_WRITE_FAILED','Created metadata changed');
}
async function acquireLock(authority,install,identity){
 const file=path.join(authority.local,'.xjy-employee161-rescue-preflight-'+FIX.catalog+'.lock');let opened;
 try{opened=await u.openChecked(io,file,'wx+',{missing:true,root:authority.local});}catch(error){if(error.code==='EEXIST')u.fail('BUSY','An existing preflight lock must not be replaced');throw error;}
 const bytes=Buffer.from(JSON.stringify({version:1,osUser:authority.osUser,publicationId:FIX.catalog,installationDir:install,installationIdentity:identity,token:crypto.randomBytes(16).toString('hex')}));
 try{await u.writeExactly(opened.handle,0,bytes);await opened.handle.sync();await u.assertHandle(io,opened,{snapshot:false,root:authority.local});}catch(error){await opened.handle.close();throw error;}
 return async()=>{
  try{await u.assertHandle(io,opened,{snapshot:false,root:authority.local});need((await u.readExactly(opened.handle,0,bytes.length)).equals(bytes),'LOCK_CONFLICT','Own preflight lock changed');}finally{await opened.handle.close();}
  const live=await u.assertPath(io,file,{root:authority.local});need(u.statIdentity(live)===opened.identity&&(await u.readSmall(io,file,4096)).equals(bytes),'LOCK_CONFLICT','Own preflight lock was replaced');await io.unlink(file);
 };
}
async function runEmployee161RescuePreflight(input){
 need(exact(input,['phase','artifactDir','archivePath','installationDir'])&&['check','prepare'].includes(input.phase),'INVALID_PREFLIGHT_INPUT','Only explicit check/prepare and the three source paths are accepted');
 need(!active,'BUSY','A preflight operation is already active');
 need(process.platform==='win32'&&process.arch==='x64'&&process.versions.electron==='44.7.0'&&process.versions.node==='24.21.0'&&process.env.ELECTRON_RUN_AS_NODE==='1'&&!process.env.NODE_OPTIONS&&!process.env.NODE_PATH&&!process.env.XJY_UPDATE_CAPABILITY,'UNTRUSTED_LAUNCH','Use only the original clean installed Electron Node engine');
 active=true;let barrier=null,releaseLock=null,result=null,operationError=null;
 try{
  const artifact=u.safeAbsolute(input.artifactDir),archive=u.safeAbsolute(input.archivePath),install=u.safeAbsolute(input.installationDir);
  need(separate(artifact,install)&&!beneath(artifact,archive)&&!beneath(install,archive),'UNSAFE_PATH','Artifact, resource ZIP and installation must be separate');
  const authority=await entry.resolveRepeatNativeAuthority({artifactDir:artifact});
  need(exact(authority,['approvalRoot','osUser','local','roaming','publicationId'])&&/^S-1-5-21-\d+-\d+-\d+-\d+$/.test(authority.osUser||'')&&authority.publicationId===FIX.catalog,'BAD_NATIVE_AUTHORITY','Actual native SID and this publication required');
  for(const k of ['approvalRoot','local','roaming'])u.safeAbsolute(authority[k]);
  need(path.basename(authority.approvalRoot)===FIX.catalog&&path.basename(path.dirname(authority.approvalRoot))==='鑫金源珠宝补丁审定-'+authority.osUser&&separate(authority.approvalRoot,artifact)&&separate(authority.approvalRoot,install)&&!beneath(authority.approvalRoot,archive),'BAD_NATIVE_AUTHORITY','Fixed independent approval leaf required');
  await u.assertPath(io,authority.local,{directory:true});await u.assertPath(io,authority.roaming,{directory:true});await ordinaryAncestor(authority.approvalRoot);
  const materials=await signedMaterials(artifact,archive),original=await originalEmployee(install,materials.policy);
  need(materials.catalog.files.length===original.allowedFiles.length&&materials.catalog.files.every(row=>original.allowedFiles.includes(row.path)),'BAD_CATALOG','Target must retain the original exact resource allowlist');
  const installationIdentity=u.statIdentity(await u.assertPath(io,install,{directory:true}));
  const environment={...entry.cleanInitialEnvironment(process.env),SystemRoot:'C:\\Windows',WINDIR:'C:\\Windows',LOCALAPPDATA:authority.local,APPDATA:authority.roaming};
  barrier=entry.createInitialProcessBarrier({installationDir:install,executablePath:original.exe,role:'employee',helperPid:process.pid,artifactDir:artifact,environment});
  const native=createWindowsUpdateProcessAdapter({executablePath:original.exe,environment});
  async function closed(){
   const current=await native.inspect(process.pid);need(current&&current.pid===process.pid&&typeof current.creationMarker==='string'&&current.creationMarker&&u.samePath(current.executablePath,original.exe)&&Array.isArray(current.args)&&!current.args.some(a=>/host|xjy-print-worker|module-sidecar/i.test(a)),'BAD_PROCESS','Actual original parent process required');
   await barrier.assertClosed();need(!(await native.listForInstallation()).some(row=>row.pid!==process.pid),'PROGRAM_IN_USE','Close other installed programs normally');
   need(u.statIdentity(await u.assertPath(io,install,{directory:true}))===installationIdentity,'FILE_CHANGED','Original installation directory changed');
  }
  await closed();let profile=await profileState(install,authority);
  need(separate(profile.profileDir,artifact)&&!beneath(profile.profileDir,archive),'UNSAFE_PATH','Profile and approved materials must be separate');
  await pendingGates(install,profile);let approval=await approvalState(authority,install,installationIdentity,profile);
  const facts={checked:true,prepared:false,sourceVersion:'1.6.1',targetVersion:'1.6.2',publicationId:FIX.catalog,installationDir:install,profileDir:profile.profileDir,nativeAuthority:authority,approvalFile:approval.approvalFile,reusedApproval:approval.reuse};
  if(input.phase==='check')result=facts;
  else if(approval.reuse)result={...facts,prepared:true};
  else{
   releaseLock=await acquireLock(authority,install,installationIdentity);
   await closed();profile=await profileState(install,authority);await pendingGates(install,profile);approval=await approvalState(authority,install,installationIdentity,profile);
   if(approval.reuse)result={...facts,prepared:true,profileDir:profile.profileDir,reusedApproval:true};
   else{
    // Nothing before acquiring our lock creates an approval or profile. All
    // CreateNew evidence stays in place if any later operation is interrupted.
    if(!profile.known){
     await core.mkdirs(io,authority.local,'鑫金源珠宝员工端/'+profile.identity);
     const stat=await u.assertPath(io,profile.profileDir,{directory:true,root:authority.local});
     need(!profile.existingIdentity||u.statIdentity(stat)===profile.existingIdentity,'FILE_CHANGED','Existing empty profile directory changed');
     need((await io.readdir(profile.profileDir)).length===0,'UNKNOWN_PROFILE','Profile gained unknown content before initialization');
     await createNew(path.join(profile.profileDir,'launch-role.json'),{role:'employee'},profile.profileDir);
    }
    const approvedAt=new Date().toISOString(),expiresAt=new Date(Date.parse(approvedAt)+86400000).toISOString(),approvalId=crypto.randomUUID();
    const record={schemaVersion:1,purpose:PURPOSE,approvalId,artifactSha256:FIX.artifact,treeSha256:FIX.tree,publisherPublicKeySha256:FIX.publisher,sourcePolicySha256:FIX.policy,verifiedPublisherName:'鑫金源原发行者 Ed25519 6e8b9cad；固定1.6.2兼容预检',role:'employee',installationDir:install,osUser:authority.osUser,engine:{...ENGINE},approvedAt,expiresAt};
    core.validateApproval(record,{osUser:authority.osUser,now:Date.now,upgradeMode:'repeat'});
    const common=path.dirname(path.dirname(authority.approvalRoot));
    await core.mkdirs(io,common,path.basename(path.dirname(authority.approvalRoot))+'/'+FIX.catalog);
    await createNew(approval.bindingFile,{version:1,purpose:'employee161-rescue-approval-binding',osUser:authority.osUser,publicationId:FIX.catalog,role:'employee',installationDir:install,installationIdentity,approvalId},authority.approvalRoot);
    await closed();await pendingGates(install,{...profile,known:true});await originalEmployee(install,materials.policy);
    await createNew(approval.approvalFile,record,authority.approvalRoot);
    const finalProfile=await profileState(install,authority);await approvalState(authority,install,installationIdentity,finalProfile);
    result={...facts,prepared:true,profileDir:finalProfile.profileDir,reusedApproval:false};
   }
  }
 }catch(error){operationError=error;}
 finally{
  for(const [name,close]of [['lock',()=>releaseLock?.()],['inventory',()=>barrier?.close()]])try{await close();}catch(error){if(!operationError)operationError=error;else operationError[name+'CloseError']=error.message;}
  active=false;
 }
 if(operationError)throw operationError;return result;
}
module.exports={runEmployee161RescuePreflight};

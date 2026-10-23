'use strict';
// Concrete existing read-only/native APIs. No work occurs merely on import.
// The 160/161 a5 controllers stay intact: their target/sequence are not 1.7.
const fs=process.versions.electron?require('original-fs').promises:require('node:fs/promises');
const path=require('node:path'),os=require('node:os'),childProcess=require('node:child_process');
const core=require('./initial-patch-core.cjs'),entry=require('./initial-patch-entry.cjs');
const u=require('../project/desktop/employee-update-cache.cjs');
const location=require('./install-location.cjs'),windows=require('./install-location-windows.cjs');
const approval=require('../delivery-approval/approval-core-170.cjs'),reviewIO=require('../delivery-approval/approval-io-170.cjs');
const EXE='鑫金源珠宝报价.exe',REVIEWER_FILES=['Prepare-Repeat-Approval-170.ps1','approval-core-170.cjs','approval-io-170.cjs','approval-archive-170.cjs'];
const failure=(code,message)=>Object.assign(Error(message),{code});
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&path.win32.resolve(a).toLowerCase()===path.win32.resolve(b).toLowerCase();
const parse=bytes=>JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(bytes));
async function optional(file,max=4096){try{return await u.readSmall(fs,file,max);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function inspectCandidate(hint,{publication}){
 const install=location.normalizeInstallPath(hint?.path);
 const invalid=(knownProduct,code)=>{const safe=(f)=>{try{return f();}catch(e){return null;}};const v=safe(()=>pkg&&typeof pkg.version==='string'?pkg.version:null);const r=safe(()=>{if(!markerBytes)return null;const a=JSON.parse(markerBytes);return a&&(a.role==='host'||a.role==='employee')?a.role:null;});const id=safe(()=>stat?reviewIO.physicalIdentity(stat):null);return {source:hint?.source,path:hint?.path,outcome:'invalid',knownProduct,code,...(v?{version:v}:{}),...(r?{role:r}:{}),...(id?{identity:id}:{})};};
 if(!install)return invalid(false,'UNSAFE_PATH');
 let stat;try{stat=await u.assertPath(fs,install,{directory:true});}catch(error){if(error.code==='ENOENT')return invalid(false,'NOT_FOUND');throw error;}
 const markerBytes=await optional(path.join(install,'xjy-install-activation.json'));
 let pkg;try{pkg=await core.packageIdentity(fs,path.join(install,'resources/app.asar'),install);}catch(error){if(error.code==='ENOENT'&&!markerBytes)return invalid(false,'NOT_FOUND');return invalid(Boolean(markerBytes),'BAD_SOURCE_ASAR');}
 if(pkg.name!=='xjy-jewelry-offline')return invalid(Boolean(markerBytes),'WRONG_PRODUCT');
 const source=publication.sourcePrograms.find(row=>row.version===pkg.version&&row.main===pkg.main);
 if(!source)return invalid(true,'UNSUPPORTED_SOURCE_VERSION');
 const asar=await core.fileHash(fs,path.join(install,'resources/app.asar'),install),engine=await core.fileHash(fs,path.join(install,EXE),install);
 if(asar.size!==source.asarSize||asar.sha256!==source.asarSha256)return invalid(true,'SOURCE_PROGRAM_MISMATCH');
 if(engine.size!==approval.ENGINE.size||engine.sha256!==approval.ENGINE.sha256)return invalid(true,'SOURCE_ENGINE_MISMATCH');
 const identity=reviewIO.physicalIdentity(stat);let role;
 if(markerBytes){const activation=parse(markerBytes);reviewIO.validateActivationRecord(activation,{installationDir:install,role:activation.role,sourceVersion:pkg.version});role=activation.role;}
 else{
  const name=(os.hostname()+'-'+os.userInfo().username).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,90);
  const bytes=await optional(path.join(install,'员工本地设置','员工客户端缓存',name,'launch-role.json'));
  if(bytes){const marker=parse(bytes);if(Object.keys(marker).length!==2||marker.version!==1||marker.role!=='employee')return invalid(true,'CONFLICTING_LEGACY_ROLE_MARKERS');role='employee';}
 }
 if(reviewIO.physicalIdentity(await u.assertPath(fs,install,{directory:true}))!==identity)throw failure('SOURCE_CHANGED','核验期间原程序目录发生变化。');
 return{source:hint.source,path:install,outcome:role?'valid':'needs-role',knownProduct:true,candidate:{installationDir:install,identity,version:pkg.version,...(role?{role}:{})}};
}
async function getAuthority(publicationId){return entry.resolveInitialNativeAuthority({upgradeMode:'repeat',publicationId});}
async function collectCandidates({hints=[],authority}={}){
 const rows=[...await windows.collectNativeWindowsInstallCandidates(),...hints];
 if(authority){const file=path.join(authority.local,'鑫金源珠宝安装','verified-location-'+authority.osUser+'.json'),raw=await optional(file,8192);
  if(raw){let hint;try{hint=parse(raw);}catch{hint=null;}if(hint&&location.normalizeInstallPath(hint.installationDir)){
   let stat;try{stat=await u.assertPath(fs,hint.installationDir,{directory:true});}catch(error){if(error.code!=='ENOENT')throw error;}
   if(stat&&location.validateLocationHint(hint,{osUser:authority.osUser,currentIdentity:reviewIO.physicalIdentity(stat)}))rows.push({source:'remembered',path:hint.installationDir});
  }}
 }
 return rows;
}
async function measureDirectory(directory){return reviewIO.physicalIdentity(await u.assertPath(fs,directory,{directory:true}));}
async function saveVerifiedHint(hint){
 const authority=await entry.resolveInitialNativeAuthority(),currentIdentity=await measureDirectory(hint.installationDir);
 const value=location.validateLocationHint(hint,{osUser:authority.osUser,currentIdentity});
 if(!value)throw failure('LOCATION_HINT_INVALID','已验证位置的用户或物理目录发生变化，未记忆。');
 const root=path.join(authority.local,'鑫金源珠宝安装');await u.assertPath(fs,authority.local,{directory:true});
 try{await fs.mkdir(root,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
 await u.assertPath(fs,root,{directory:true});await u.atomicWrite(fs,path.join(root,'verified-location-'+authority.osUser+'.json'),JSON.stringify(value),root);
}
async function defaultTarget(authority){
 const installationDir=path.join(authority.local,'鑫金源珠宝','员工程序');let exists=true;
 try{await fs.lstat(installationDir);}catch(error){if(error.code==='ENOENT')exists=false;else throw error;}
 return{installationDir,exists};
}
async function readState(candidate,authority){
 if(candidate.role)return reviewIO.readTransactionState(candidate.installationDir,candidate.role,authority.osUser);
 // Before the one legacy role choice in the existing reviewer, authenticate
 // any existing gate without guessing a role from drives or profile names.
 const valid=[];let refusal;
 for(const role of ['host','employee'])try{valid.push(await reviewIO.readTransactionState(candidate.installationDir,role,authority.osUser));}catch(error){if(error.code!=='RECOVERY_REQUIRED')throw error;refusal=error;}
 if(!valid.length)throw refusal;
 if(valid.length>1&&valid.some(value=>value.transactionState!=='none'))throw failure('RECOVERY_REQUIRED','原恢复记录的角色不唯一，停止。');
 return valid[0];
}
async function readApproval({candidate,authority,publication,receipt,now=Date.now}){
 const actual=await getAuthority(publication.publicationId);
 if(actual.osUser!==authority.osUser||!same(actual.approvalRoot,authority.approvalRoot))throw failure('AUTHORITY_CHANGED','当前Windows用户或审批目录发生变化。');
 const file=path.join(actual.approvalRoot,'initial-upgrade-approval.json');
 const before=await core.fileHash(fs,file,actual.approvalRoot),record=parse(await u.readSmall(fs,file,8192)),after=await core.fileHash(fs,file,actual.approvalRoot);
 if(before.sha256!==after.sha256||before.identity!==after.identity)throw failure('APPROVAL_CHANGED','审批记录读取期间发生变化。');
 core.validateApproval(record,{osUser:actual.osUser,now,upgradeMode:'repeat'});
 const expected={purpose:'xjy-repeat-program-patch',artifactSha256:publication.artifactSha256,treeSha256:publication.treeSha256,
  sourcePolicySha256:publication.sourcePolicySha256,publisherPublicKeySha256:publication.publisherPublicKeySha256,approvalId:receipt.approvalId,role:candidate.role,osUser:actual.osUser};
 if(Object.entries(expected).some(([key,value])=>record[key]!==value)||!same(record.installationDir,candidate.installationDir)||JSON.stringify(record.engine)!==JSON.stringify(approval.ENGINE))throw failure('APPROVAL_MISMATCH','包外审批未绑定本次发布、用户、位置和角色。');
 return{record,sha256:after.sha256,approvalFile:file,authority:actual};
}
async function requestApproval({candidate,authority,reviewerDir,reviewerPins,requestedRole}){
 if(!reviewerDir||!reviewerPins||Object.keys(reviewerPins).length!==REVIEWER_FILES.length||REVIEWER_FILES.some(name=>!/^[a-f0-9]{64}$/.test(reviewerPins[name]||'')))throw failure('APPROVAL_REVIEWER_UNBOUND','审定组件尚未绑定独立核验摘要，未启动。');
 await u.assertPath(fs,reviewerDir,{directory:true});
 for(const name of REVIEWER_FILES)if((await core.fileHash(fs,path.join(reviewerDir,name),reviewerDir)).sha256!==reviewerPins[name])throw failure('REVIEWER_CHANGED','独立审定组件发生变化，未启动。');
 const args=['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(reviewerDir,'Prepare-Repeat-Approval-170.ps1'),'-OneClick','-CandidateExecutable',path.join(candidate.installationDir,EXE),'-CandidateInstallationIdentity',candidate.identity];
 if(candidate.role||requestedRole)args.push('-CandidateRole',candidate.role||requestedRole);
 const env={SystemRoot:'C:\\Windows',WINDIR:'C:\\Windows',SystemDrive:'C:',PATHEXT:'.EXE',LOCALAPPDATA:authority.local,APPDATA:authority.roaming};
 for(const name of ['TEMP','TMP','USERPROFILE'])if(process.env[name])env[name]=process.env[name];
 return new Promise((resolve,reject)=>{
  const child=childProcess.spawn('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',args,{cwd:reviewerDir,env,shell:false,windowsHide:false,stdio:['ignore','pipe','pipe']});
  const stdout=[],stderr=[];let outSize=0,errSize=0,tooLarge=false;
  child.stdout.on('data',bytes=>{outSize+=bytes.length;if(outSize>65536)tooLarge=true;else stdout.push(bytes);});
  child.stderr.on('data',bytes=>{errSize+=bytes.length;if(errSize>65536)tooLarge=true;else stderr.push(bytes);});
  child.once('error',reject);child.once('close',exitCode=>tooLarge?reject(failure('APPROVAL_OUTPUT_INVALID','审定返回过大，未调用安装器。')):resolve({processExited:true,exitCode,stdout:Buffer.concat(stdout).toString('utf8'),stderr:Buffer.concat(stderr).toString('utf8')}));
 });
}
// Exact existing APIs for Root's native full-tree adapter. The worker does not
// call old resource installers or manufacture the missing legacy canonical.
const reuse=Object.freeze({
 createInitialSourceLease:options=>require('./initial-source-lease.cjs').createInitialSourceLease(options),
 createInitialProcessBarrier:entry.createInitialProcessBarrier,
 resolveInitialEmployeeProfile:entry.resolveInitialEmployeeProfile,
 createInitialBackup:options=>require('./initial-patch-backup.cjs').createInitialBackup(options),
 verifyInitialBackup:options=>require('./initial-patch-backup.cjs').verifyInitialBackup(options),
 createNodeSqliteSnapshotter:options=>require('./initial-patch-backup.cjs').createNodeSqliteSnapshotter(options),
 createNodeSqliteVerifier:options=>require('./initial-patch-backup.cjs').createNodeSqliteVerifier(options),
});
module.exports={inspectCandidate,getAuthority,collectCandidates,measureDirectory,saveVerifiedHint,defaultTarget,readState,readApproval,requestApproval,reuse};

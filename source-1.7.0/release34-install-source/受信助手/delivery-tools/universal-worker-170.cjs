'use strict';
// Native composition only. The public request chooses a fixed mode/intent;
// it cannot supply paths, principals, trust roots or an installation strategy.
const path=require('node:path'),crypto=require('node:crypto');
const locations=require('./install-location.cjs'),nativeDefaults=require('./delivery-native-170.cjs');
const approval=require('../delivery-approval/approval-core-170.cjs');
const approvalRecord=require('./initial-patch-core.cjs').validateApproval;
const SHA=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const PUBLISHER='6e8b9cadb59aeb53f30d41f4471f70f644f0dfc7376ffb9d8a4c62defb98458c',EXE='鑫金源珠宝报价.exe';
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&path.win32.resolve(a).toLowerCase()===path.win32.resolve(b).toLowerCase();
const fail=(code,message)=>{throw Object.assign(Error(message),{code});};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&Object.keys(v).every(k=>keys.includes(k));
function freeze(value){if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
function publicationValue(value){
 const keys=['schemaVersion','product','targetVersion','targetEngineVersion','publicationId','artifactSha256','treeSha256','sourcePolicySha256','publisherPublicKeySha256','engineTreeSha256','sourcePrograms'];
 if(!exact(value,keys)||value.schemaVersion!==1||value.product!=='xjy-jewelry-offline'||value.targetVersion!=='1.7.0'||value.targetEngineVersion!=='44.9.0'||value.publisherPublicKeySha256!==PUBLISHER||['publicationId','artifactSha256','treeSha256','sourcePolicySha256','engineTreeSha256'].some(k=>!SHA.test(value[k]||'')||/^0+$/.test(value[k]))||!Array.isArray(value.sourcePrograms)||value.sourcePrograms.length!==3)fail('UNBOUND_DELIVERY','本次完整1.7交付尚未绑定独立核验摘要。');
 const seen=new Set();for(const row of value.sourcePrograms){if(!exact(row,['version','main','asarSize','asarSha256'])||!approval.SOURCE_VERSIONS.includes(row.version)||seen.has(row.version)||row.main!=='release-entry.cjs'||!Number.isSafeInteger(row.asarSize)||row.asarSize<16||!SHA.test(row.asarSha256||''))fail('UNBOUND_DELIVERY','旧程序精确来源清单不完整。');seen.add(row.version);}
 return freeze(structuredClone(value));
}
function authorityValue(value,publication){
 if(!exact(value,['approvalRoot','osUser','local','roaming','publicationId'])||!/^S-1-\d+(?:-\d+)+$/.test(value.osUser||'')||value.publicationId!==publication.publicationId||['approvalRoot','local','roaming'].some(k=>!locations.normalizeInstallPath(value[k])))fail('BAD_NATIVE_AUTHORITY','当前Windows用户与固定审批目录未核验。');
 if(path.win32.basename(value.approvalRoot)!==publication.publicationId||path.win32.basename(path.win32.dirname(value.approvalRoot))!=='鑫金源珠宝补丁审定-'+value.osUser)fail('BAD_NATIVE_AUTHORITY','审批目录不属于当前用户和本次发布。');
 return value;
}
function requireEnginePort(port){
 if(!port||port.strategy!=='full-engine-tree'||port.targetVersion!=='1.7.0'||port.targetEngineVersion!=='44.9.0'||['verifyPublication','assertWorkerRuntime','verifyApprovalAuthority','createTransaction','verifyInstalled'].some(k=>typeof port[k]!=='function'))fail('FULL_ENGINE_UPGRADE_UNAVAILABLE','完整引擎升级组件尚未接通，原程序和资料保持；不会改用资源补丁。');
 if(!port.startupFence||port.startupFence.protocol!=='xjy-pre-business-commit-fence-v1'||port.startupFence.gatePoint!=='before-business-import'||typeof port.startupFence.acquire!=='function')fail('STARTUP_FENCE_UNAVAILABLE','新版本业务启动门尚未接通，未开始升级。');
 return port;
}
function receiptValue(processResult,{candidate,authority,publication,now,allowRoleChoice=false}){
 if(!processResult||processResult.processExited!==true)fail('APPROVAL_NOT_EXITED','审定进程尚未正常结束，未调用安装器。');
 if(processResult.exitCode===2)return null;
 if(processResult.exitCode!==0)fail('APPROVAL_FAILED','审定未完成，原程序保持。');
 let r;try{r=JSON.parse(processResult.stdout);}catch{fail('APPROVAL_RECEIPT_INVALID','审定未返回完整记录。');}
 const keys=['purpose','written','artifactSha256','publisherPublicKeySha256','publicationId','installationDir','osUser','role','installationIdentity','sourceVersion','requiresLegacyBootstrap','requiredInstallationStrategy','approvalId','expiresAt'];
 const expires=Date.parse(r?.expiresAt);
 if(!exact(r,keys)||r.purpose!=='xjy-oneclick-approval-written'||r.written!==true||r.artifactSha256!==publication.artifactSha256||r.publisherPublicKeySha256!==PUBLISHER||r.publicationId!==publication.publicationId||!same(r.installationDir,candidate.installationDir)||r.osUser!==authority.osUser||!['host','employee'].includes(r.role)||!allowRoleChoice&&r.role!==candidate.role||r.installationIdentity!==candidate.identity||r.sourceVersion!==candidate.version||typeof r.requiresLegacyBootstrap!=='boolean'||r.requiredInstallationStrategy!=='full-engine-tree'||!UUID.test(r.approvalId||'')||!Number.isFinite(expires)||expires<=now()||expires>now()+86460000)fail('APPROVAL_RECEIPT_INVALID','审定记录未绑定本次发布、角色、用户和物理目录。');
 return freeze(r);
}
function createUniversalWorker170({publication:input,paths,native={},engineTree,freshTrust,onProgress=()=>{},now=Date.now,hints=[]}={}){
 const publication=publicationValue(input),api={...nativeDefaults,...native};
 if(!paths||Object.keys(paths).some(k=>!['artifactDir','archiveFile','reviewerDir','reviewerPins','freshArtifactDir'].includes(k))||!locations.normalizeInstallPath(paths.artifactDir)||!locations.normalizeInstallPath(paths.archiveFile)||paths.reviewerDir!==undefined&&!locations.normalizeInstallPath(paths.reviewerDir)||paths.freshArtifactDir!==undefined&&!locations.normalizeInstallPath(paths.freshArtifactDir))fail('UNBOUND_DELIVERY','固定交付目录缺失。');
 if(!Array.isArray(hints)||hints.length>256)fail('BAD_CANDIDATES','安装位置提示数量或格式无效。');
 const fixedPaths=freeze(structuredClone(paths)),fixedFresh=freshTrust?freeze(structuredClone(freshTrust)):null,fixedHints=freeze(structuredClone(hints));
 let active=false;
 async function run(request={}){
  if(!request||typeof request!=='object'||Array.isArray(request)||Object.keys(request).some(k=>!['mode','requestedRole'].includes(k))||request.mode!==undefined&&!['maintenance','first-install'].includes(request.mode)||request.requestedRole!==undefined&&!['host','employee'].includes(request.requestedRole))fail('INVALID_DELIVERY_REQUEST','只能选择安装或维护入口与明确角色。');
  if(active)fail('BUSY','本次安装或维护仍在处理，请保留窗口。');active=true;
  const operationId=crypto.randomUUID(),warnings=[];let fence=null,releaseAttempted=false,committed=false,transactionStarted=false,stage='checking';
  const emit=(phase,message)=>{stage=phase;try{onProgress({phase,message,operationId});}catch(error){warnings.push({kind:'progress',message:error.message});}};
  try{
   emit('checking','正在核验发布、现有程序和Windows用户。');
   const authority=freeze(structuredClone(authorityValue(await api.getAuthority(publication.publicationId),publication))),target=await api.defaultTarget(authority);
   const candidateHints=await api.collectCandidates({hints:fixedHints,authority});if(!Array.isArray(candidateHints)||candidateHints.length>256)fail('BAD_CANDIDATES','安装位置候选过多或格式无效。');
   const rows=[];for(const hint of candidateHints)rows.push(await api.inspectCandidate(hint,{publication,authority}));
   const mode=request.mode||'maintenance',requestedRole=request.requestedRole||(mode==='first-install'?'employee':undefined);
   const input={mode,requestedRole,candidateResults:rows,supportedVersions:[...approval.SOURCE_VERSIONS],osUser:authority.osUser,defaultEmployeeDirectory:target.installationDir,defaultDirectoryExists:target.exists};
   let resolution=locations.resolveInstallLocation(input),selectedIdentity;
   if(resolution.kind==='blocked')fail(resolution.code,resolution.message);
   if(resolution.kind==='first-install'){
    if(!fixedFresh||fixedFresh.targetVersion!=='1.7.0'||fixedFresh.engineVersion!=='44.9.0'||fixedFresh.publisherPublicKeySha256!==PUBLISHER||!fixedPaths.freshArtifactDir||typeof api.launchFresh!=='function')fail('FRESH_DELIVERY_UNAVAILABLE','完整1.7员工安装包或正确角色启动接口尚未绑定。');
    emit('installing','正在核验完整引擎和程序并安装员工端。');
    const install=native.installFreshEmployee||require('./fresh-employee-install-170.cjs').installFreshEmployee;
    const result=await install({artifactDir:fixedPaths.freshArtifactDir,installDir:resolution.installationDir,localAppData:authority.local,trust:fixedFresh,now,launch:api.launchFresh});
    if(result?.installed!==true||result.version!=='1.7.0'||result.role!=='employee'||!same(result.installationDir,resolution.installationDir))fail('FRESH_RESULT_INVALID','安装结果尚未核验，请保留当前目录，不要覆盖重装。');
    try{const identity=await api.measureDirectory(result.installationDir);await api.saveVerifiedHint(locations.createLocationHint({candidate:{installationDir:result.installationDir,identity,role:'employee'},osUser:authority.osUser}));}catch(error){warnings.push({kind:'remember-location',message:error.message});}
    return{status:result.launched===true?'installed':'installed-not-started',completed:result.launched===true,...result,operationId,warnings};
   }
   // This must precede any approval creation, backup or installation write.
   const port=requireEnginePort(engineTree);
   const verified=await port.verifyPublication({publication,paths:fixedPaths});
   if(!verified||verified.publicationId!==publication.publicationId||verified.engineTreeSha256!==publication.engineTreeSha256||verified.targetVersion!=='1.7.0'||verified.engineVersion!=='44.9.0')fail('FULL_ENGINE_PROOF_INVALID','完整引擎与本次发布身份未核验。');
   if(resolution.kind==='choose'){
    if(typeof api.chooseCandidate!=='function')fail('CANDIDATE_SELECTION_REQUIRED','找到多份已核程序，请在中文选择窗口选择一次。');
    selectedIdentity=await api.chooseCandidate(resolution.candidates.map(c=>({...c})));if(selectedIdentity===null)return{status:'cancelled',completed:false,operationId,warnings};
    resolution=locations.resolveInstallLocation({...input,selectedIdentity});
   }
   const rolePending=resolution.kind==='confirm-role';
   if(resolution.kind!=='existing'&&!rolePending)fail(resolution.code||'CANDIDATE_CHANGED',resolution.message||'原程序候选发生变化，停止。');
   let candidate=freeze({...resolution.candidate});const original=rows.find(row=>row.candidate?.identity?.toLowerCase()===candidate.identity);
   if(await port.assertWorkerRuntime({publication,paths:fixedPaths,candidate,authority})!==true)fail('EXTERNAL_HELPER_REQUIRED','完整引擎助手必须在原安装树之外运行；未开始升级。');
   const recheck=async()=>{
    const current=await api.inspectCandidate({source:original.source,path:candidate.installationDir},{publication,authority});
    if(current.outcome!==original.outcome||current.knownProduct!==true||current.candidate?.identity?.toLowerCase()!==candidate.identity||current.candidate.version!==candidate.version||current.candidate.role!==original.candidate.role)fail('SOURCE_CHANGED','选择后的原程序身份或角色发生变化。');
    const currentAuthority=authorityValue(await api.getAuthority(publication.publicationId),publication);
    if(currentAuthority.osUser!==authority.osUser||!same(currentAuthority.approvalRoot,authority.approvalRoot))fail('AUTHORITY_CHANGED','Windows用户或审批目录已变化。');
   };
   await recheck();const beforeState=await api.readState(candidate,authority);
   if(!['none','committed','rolledback','prepared','mutating'].includes(beforeState.transactionState))fail('RECOVERY_REQUIRED','未知升级恢复状态，未开始新升级。');
   if(beforeState.transactionState==='none'&&typeof port.createLegacyTransaction!=='function')fail('LEGACY_FULL_ENGINE_UPGRADE_UNAVAILABLE','旧版缺少原恢复门禁；受审完整引擎恢复分支尚未接通，未补造记录。');
   emit('approval','正在核验本发布的独立审批，请先保存原软件中的单据。');
   // The already-reviewed PS dialog performs the one legacy role choice.
   // Do not ask once in the launcher and a second time in that reviewer.
   const receipt=receiptValue(await api.requestApproval({candidate,authority,publication,requestedRole,reviewerDir:fixedPaths.reviewerDir,reviewerPins:fixedPaths.reviewerPins}),{candidate,authority,publication,now,allowRoleChoice:rolePending});
   if(!receipt)return{status:'cancelled',completed:false,operationId,warnings};
   if(rolePending){
    const confirmation={confirmed:true,installationIdentity:candidate.identity,installationDir:candidate.installationDir,role:receipt.role,osUser:authority.osUser};
    resolution=locations.resolveInstallLocation({...input,selectedIdentity,legacyRoleConfirmation:confirmation});
    if(resolution.kind!=='existing')fail(resolution.code||'LEGACY_ROLE_CONFIRMATION_REQUIRED',resolution.message||'旧版角色确认未匹配当前目录。');
    candidate=freeze({...resolution.candidate});
   }
   await recheck();const state=await api.readState(candidate,authority);
   if(state.fingerprint!==beforeState.fingerprint||receipt.requiresLegacyBootstrap!==(state.transactionState==='none'))fail('RECOVERY_REQUIRED','审批期间恢复状态改变，停止；不会替换原门禁。');
   const protectedApproval=await api.readApproval({candidate,authority,publication,receipt,now});
   if(!exact(protectedApproval,['record','sha256','approvalFile','authority'])||!SHA.test(protectedApproval.sha256||'')||!same(protectedApproval.approvalFile,path.win32.join(authority.approvalRoot,'initial-upgrade-approval.json')))fail('APPROVAL_MISMATCH','包外审批原记录未核验。');
   authorityValue(protectedApproval.authority,publication);
   if(protectedApproval.authority.osUser!==authority.osUser||!same(protectedApproval.authority.approvalRoot,authority.approvalRoot))fail('APPROVAL_MISMATCH','包外审批当前用户绑定不符。');
   approvalRecord(protectedApproval.record,{osUser:authority.osUser,now,upgradeMode:'repeat'});
   const expected={approvalId:receipt.approvalId,purpose:'xjy-repeat-program-patch',artifactSha256:publication.artifactSha256,treeSha256:publication.treeSha256,sourcePolicySha256:publication.sourcePolicySha256,publisherPublicKeySha256:PUBLISHER,role:candidate.role,osUser:authority.osUser,expiresAt:receipt.expiresAt};
   if(Object.entries(expected).some(([key,value])=>protectedApproval.record[key]!==value)||!same(protectedApproval.record.installationDir,candidate.installationDir)||JSON.stringify(protectedApproval.record.engine)!==JSON.stringify(approval.ENGINE))fail('APPROVAL_MISMATCH','包外审批与本次发布、物理目录或角色不符。');
   const context=freeze({operationId,publication,paths:fixedPaths,candidate,authority,receipt,protectedApproval,state});
   const acl=await port.verifyApprovalAuthority(context);if(acl!==true)fail('APPROVAL_AUTHORITY_INVALID','审批目录或当前用户权限未通过原生检查。');
   fence=await port.startupFence.acquire(context);
   if(!fence||['assertHeld','releaseAfterCommit','retainOnFailure'].some(name=>typeof fence[name]!=='function')||await fence.assertHeld()!==true)fail('STARTUP_FENCE_UNAVAILABLE','无法证明新程序在事务完成前保持业务封锁，未安装。');
   const create=state.transactionState==='none'?port.createLegacyTransaction:port.createTransaction;
   const transaction=await create.call(port,{...context,startupFence:fence,reuse:nativeDefaults.reuse,onProgress:emit});
   if(!transaction||typeof transaction.install!=='function'||typeof transaction.recover!=='function')fail('FULL_ENGINE_UPGRADE_UNAVAILABLE','完整目录事务接口未接通。');
   if(['prepared','mutating'].includes(state.transactionState)){
    if(state.transactionPublicationId!==publication.publicationId||state.transactionApprovalId!==receipt.approvalId)fail('RECOVERY_REQUIRED','未完成事务属于另一审批或发布，停止。');
    emit('recovering','正在按原记录恢复，完成后保留结果供核对。');transactionStarted=true;const result=await transaction.recover();await fence.retainOnFailure({operationId,recovered:true,committed:false,releaseAttempted:false});
    return{status:'recovery-needs-review',completed:false,recovered:result,operationId,warnings};
   }
   emit('installing','正在一致性备份、等待正常退出并切换完整程序；请勿关闭此窗口。');
   transactionStarted=true;const result=await transaction.install();
   if(result?.installed!==true||result.version!=='1.7.0'||result.engineVersion!=='44.9.0'||result.role!==candidate.role)fail('INSTALL_NOT_CONFIRMED','完整程序事务未确认，请保留原始备份和失败记录。');
   committed=true;emit('verifying','正在复核完整程序、提交记录和业务启动门。');
   if(await fence.assertHeld()!==true)fail('STARTUP_FENCE_LOST','事务核验前业务封锁证明丢失，禁止回退旧程序接单。');
   const proof=await port.verifyInstalled({...context,result});
   if(!proof||proof.committed!==true||proof.engineTreeSha256!==publication.engineTreeSha256||proof.version!=='1.7.0'||proof.engineVersion!=='44.9.0'||proof.role!==candidate.role||!same(proof.installationDir,candidate.installationDir)||!/^[a-f0-9]{8}:[a-f0-9]{16}$/.test(proof.installationIdentity||''))fail('TARGET_NOT_VERIFIED','目标程序或事务提交仍未通过核验，业务入口保持关闭。');
   emit('starting','事务已提交，正在按原角色放行业务启动。');releaseAttempted=true;
   const release=await fence.releaseAfterCommit({...context,proof});
   if(release?.released!==true||release.role!==candidate.role||release.version!=='1.7.0')fail('BUSINESS_RELEASE_UNCERTAIN','业务放行结果尚不明确，请保留现场；禁止自动回退旧版本。');
   const hint=locations.createLocationHint({candidate:{...candidate,identity:proof.installationIdentity,version:'1.7.0'},osUser:authority.osUser});
   if(typeof api.saveVerifiedHint==='function')try{await api.saveVerifiedHint(hint);}catch(error){warnings.push({kind:'remember-location',message:error.message});}
   emit('completed','完整程序已提交并按原角色启动。');
   return{status:'installed',completed:true,version:'1.7.0',engineVersion:'44.9.0',role:candidate.role,installationDir:candidate.installationDir,operationId,warnings,result};
  }catch(error){
   if(fence)try{await fence.retainOnFailure({operationId,committed,releaseAttempted,transactionStarted});}catch(retain){error.fenceRetentionError=retain.message;}
   // An exception cannot prove that a native commit did not happen. Only the
   // owned durable transaction may decide recovery; the launcher must not.
   error.stage=stage;error.operationId=operationId;if(transactionStarted||committed||releaseAttempted)error.rollbackForbidden=true;
   emit('failed','处理已停止，请保留原程序、备份和错误记录。');throw error;
  }finally{active=false;}
 }
 return Object.freeze({run});
}
module.exports={createUniversalWorker170,publicationValue,receiptValue,requireEnginePort};

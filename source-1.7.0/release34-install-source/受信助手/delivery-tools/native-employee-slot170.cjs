'use strict';
// Called only by the verified native provider. No production work on import.
const fs=process.versions.electron?require('original-fs').promises:require('node:fs/promises');
const path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const u=require('../project/desktop/employee-update-cache.cjs');
const core=require('./initial-patch-core.cjs'),startup=require('../project/desktop/engine-startup-gate.cjs');
const SOURCE='a067dd03b72f7139b87632b59df5609336c3d75b980d38dba8e2cc9367444669';
const PUBLISHER='6e8b9cadb59aeb53f30d41f4471f70f644f0dfc7376ffb9d8a4c62defb98458c';
const EXE='鑫金源珠宝报价.exe',MARKER='xjy-install-activation.json',DOMAIN='xjy-employee-slot170-v1\0';
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&Object.keys(v).every(k=>keys.includes(k));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const need=(v,c,m)=>{if(!v)u.fail(c,m);};
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const rows=files=>files.map(f=>({path:f.path,size:f.size,sha256:f.sha256})).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
const SHA=/^[a-f0-9]{64}$/;
const runtime170=()=>require('./engine-tree-runtime170.cjs');
const mutablePath=name=>typeof name==='string'&&['.xjy-initial-upgrade/','.xjy-patches/','员工本地设置/'].some(prefix=>name.startsWith(prefix));
const validRows=files=>Array.isArray(files)&&files.length<=16384&&new Set(files.map(f=>f?.path?.toLowerCase())).size===files.length&&files.every(f=>exact(f,['path','size','sha256'])&&u.safeRelative(f.path)&&Number.isSafeInteger(f.size)&&f.size>=0&&SHA.test(f.sha256||''));

// Pure byte contract, intentionally separate from native path/signature proof.
function authenticateFreshSourceState170({key,journalBytes,statusBytes,catalogBytes,sourceEnvelope,sourceCatalogSha256=digest(Buffer.from(sourceEnvelope.catalog)),installationDir,installationIdentity,stateDir,stateIdentity,namespace}){
 need(Buffer.isBuffer(key)&&key.length===32,'BAD_JOURNAL','原fresh认证密钥不完整');
 const wrapper=JSON.parse(journalBytes);
 need(exact(wrapper,['payload','mac'])&&typeof wrapper.payload==='string'&&/^[a-f0-9]{64}$/.test(wrapper.mac||'')&&crypto.timingSafeEqual(crypto.createHmac('sha256',key).update(wrapper.payload).digest(),Buffer.from(wrapper.mac,'hex')),'BAD_JOURNAL','原fresh提交认证失败');
 const record=JSON.parse(wrapper.payload),expected={version:1,purpose:'xjy-engine-fresh170',transactionId:record.transactionId,phase:'committed',rollbackForbidden:true,targetVersion:'1.7.0',targetEngineVersion:'44.9.0',role:'employee',installationDir,installationIdentity,stateIdentity,catalogSha256:sourceCatalogSha256,publisherPublicKeySha256:PUBLISHER,osUserNamespace:namespace};
 need(u.UUID.test(record.transactionId||'')&&same(record,expected),'SOURCE_FRESH_REQUIRED','只接受本机员工原生fresh170的完整提交，不改写其他状态');
 const receipt=startup.decode(statusBytes,key),expectedReceipt={version:2,purpose:startup.PURPOSE,transactionId:record.transactionId,phase:'committed',rollbackForbidden:true,installationDir,installationIdentity,stateDir,stateIdentity,role:'employee',programVersion:'1.7.0',engineVersion:'44.9.0',catalogSha256:sourceCatalogSha256,publisherPublicKeySha256:PUBLISHER,osUserNamespace:namespace,mode:'fresh',journalSha256:digest(journalBytes),businessReleased:true};
 need(same(receipt,expectedReceipt),'BAD_STARTUP_RECEIPT','原fresh启动收据不属于本机完整员工程序');
 const envelope=JSON.parse(catalogBytes);
 need(SHA.test(sourceCatalogSha256||'')&&exact(envelope,['catalog','signature'])&&envelope.catalog===sourceEnvelope.catalog&&envelope.signature===sourceEnvelope.signature&&digest(Buffer.from(envelope.catalog))===sourceCatalogSha256,'BAD_SIGNATURE','原fresh目录不是受审原完整目录');
 return Object.freeze({kind:'fresh-native170',mode:'fresh',transactionId:record.transactionId,journalSha256:digest(journalBytes),statusSha256:digest(statusBytes),catalogEnvelopeSha256:digest(catalogBytes)});
}

function authenticateCommittedFullSourceState170(input){
 const {key,journalBytes,statusBytes,catalogBytes,sourceEnvelope,installationDir,installationIdentity,stateDir,stateIdentity,rootIdentity,namespace,sourceBindings,markerBytes}=input,sourceCatalogSha256=digest(Buffer.from(sourceEnvelope.catalog));
 need(Buffer.isBuffer(key)&&key.length===32,'BAD_JOURNAL','原完整升级认证密钥不完整');
 const wrapper=JSON.parse(journalBytes);need(exact(wrapper,['payload','mac'])&&typeof wrapper.payload==='string'&&SHA.test(wrapper.mac||'')&&crypto.timingSafeEqual(crypto.createHmac('sha256',key).update(wrapper.payload).digest(),Buffer.from(wrapper.mac,'hex')),'BAD_JOURNAL','原完整升级提交认证失败');
 const record=JSON.parse(wrapper.payload),keys=['version','purpose','transactionId','phase','paths','role','publisherPublicKeySha256','sourceCatalogSha256','targetCatalogSha256','sourceVersion','targetVersion','sourceEngineVersion','targetEngineVersion','identities','sourceFiles','targetFiles','sourceActivation','targetActivation','dataFiles','profileFiles','stageDir','backupDir','failedDir','runtimeWrites','rollbackForbidden','sourceMutableFiles','sourceMutableDirectories','targetMutableFiles','sourceEvidence'];
 need(exact(record,keys)&&record.version===5&&record.purpose==='xjy-engine-tree170'&&u.UUID.test(record.transactionId||'')&&record.phase==='committed'&&record.runtimeWrites===true&&record.rollbackForbidden===true&&record.role==='employee'&&record.publisherPublicKeySha256===PUBLISHER&&record.targetVersion==='1.7.0'&&record.targetEngineVersion==='44.9.0'&&record.targetCatalogSha256===sourceCatalogSha256&&record.sourceEngineVersion==='44.7.0'&&record.sourceEvidence===null,'SOURCE_COMMITTED_FULL_REQUIRED','只接受原真实native5完整升级已提交并放行的员工来源；隔离v3/桥/进行中状态不接纳');
 const bound=Array.isArray(sourceBindings)&&sourceBindings.find(b=>b.meta?.programVersion===record.sourceVersion&&b.meta?.engineVersion===record.sourceEngineVersion&&b.meta?.catalogSha256===record.sourceCatalogSha256);
 need(bound&&['1.6.0','1.6.1','1.6.2'].includes(record.sourceVersion)&&digest(Buffer.from(bound.envelope.catalog))===record.sourceCatalogSha256,'BAD_SOURCE_METADATA','原完整升级的160/161/162签名来源未绑定');
 need(exact(record.paths,['isolationRoot','installationDir','artifactDir','stateDir','dataDir','profileDir'])&&u.samePath(record.paths.isolationRoot,path.dirname(installationDir))&&u.samePath(record.paths.installationDir,installationDir)&&u.samePath(record.paths.stateDir,stateDir)&&u.samePath(record.paths.dataDir,path.join(stateDir,'data-proof'))&&u.samePath(record.paths.profileDir,path.join(stateDir,'profile-proof')),'BAD_JOURNAL','原完整升级物理布局不符');
 u.safeAbsolute(record.paths.artifactDir);
 need(exact(record.identities,['root','artifact','state','data','profile','source','stage'])&&Object.values(record.identities).every(v=>typeof v==='string'&&v.length>0&&v.length<240)&&record.identities.root===rootIdentity&&record.identities.state===stateIdentity&&record.identities.stage===installationIdentity,'DIRECTORY_CHANGED','原完整升级的安装/状态/父目录身份不符');
 const prefix='.'+path.basename(installationDir)+'.engine-';for(const [field,kind]of [['stageDir','stage-'],['backupDir','backup-'],['failedDir','failed-']])need(u.samePath(record[field],path.join(path.dirname(installationDir),prefix+kind+record.transactionId)),'BAD_JOURNAL','原完整升级事务路径不是原runtime派生位置');
 for(const name of ['sourceFiles','targetFiles','dataFiles','profileFiles','sourceMutableFiles','targetMutableFiles'])need(validRows(record[name]),'BAD_JOURNAL','原完整升级文件摘要列表无效');
 need(record.sourceMutableFiles.every(f=>mutablePath(f.path))&&record.targetMutableFiles.every(f=>mutablePath(f.path))&&Array.isArray(record.sourceMutableDirectories)&&record.sourceMutableDirectories.length<=8192&&record.sourceMutableDirectories.every(d=>exact(d,['path','identity'])&&u.safeRelative(d.path)&&(mutablePath(d.path+'/')||runtime170().approvedEmptyDirectory(d.path))&&typeof d.identity==='string'&&d.identity.length>0),'BAD_MUTABLE_SCOPE','原完整升级可变资料范围不符');
 need(Buffer.isBuffer(markerBytes)&&typeof record.targetActivation==='string'&&record.targetActivation===markerBytes.toString('base64'),'BAD_ACTIVATION','原完整升级目标角色原字节不符');
 let oldMarker=[];if(record.sourceActivation!==null){need(typeof record.sourceActivation==='string'&&record.sourceActivation.length<=8192,'BAD_ACTIVATION','原源角色字节无效');const bytes=Buffer.from(record.sourceActivation,'base64');need(bytes.toString('base64')===record.sourceActivation,'BAD_ACTIVATION','原源角色编码无效');const a=JSON.parse(bytes);need(exact(a,['version','product','programVersion','role','installationDir'])&&a.version===1&&a.product===core.PRODUCT&&a.programVersion===record.sourceVersion&&a.role==='employee'&&u.samePath(a.installationDir,installationDir),'BAD_ACTIVATION','原源角色记录不符');oldMarker=[{path:MARKER,size:bytes.length,sha256:digest(bytes)}];}
 const oldCatalog=JSON.parse(bound.envelope.catalog),currentCatalog=JSON.parse(sourceEnvelope.catalog),targetMarker={path:MARKER,size:markerBytes.length,sha256:digest(markerBytes)};
 need(same(rows(record.sourceFiles),rows([...oldCatalog.files,...record.sourceMutableFiles,...oldMarker]))&&same(rows(record.targetFiles),rows([...currentCatalog.files,...record.targetMutableFiles,targetMarker])),'BAD_JOURNAL','原完整升级目录不能替换原签名文件或未审资料');
 const receipt=startup.decode(statusBytes,key),expected={version:2,purpose:startup.PURPOSE,transactionId:record.transactionId,phase:'committed',rollbackForbidden:true,installationDir,installationIdentity,stateDir,stateIdentity,role:'employee',programVersion:'1.7.0',engineVersion:'44.9.0',catalogSha256:sourceCatalogSha256,publisherPublicKeySha256:PUBLISHER,osUserNamespace:namespace,mode:'upgrade',journalSha256:digest(journalBytes),businessReleased:true};
 need(same(receipt,expected),'BAD_STARTUP_RECEIPT','原完整升级启动收据未放行或不属于本机员工');
 const envelope=JSON.parse(catalogBytes);need(exact(envelope,['catalog','signature'])&&envelope.catalog===sourceEnvelope.catalog&&envelope.signature===sourceEnvelope.signature&&digest(Buffer.from(envelope.catalog))===sourceCatalogSha256,'BAD_SIGNATURE','原完整升级目标完整目录不符');
 return {proof:Object.freeze({kind:'committed-native-full170',mode:'upgrade',transactionId:record.transactionId,journalSha256:digest(journalBytes),statusSha256:digest(statusBytes),catalogEnvelopeSha256:digest(catalogBytes)}),record};
}

function deriveEmployeeSlot170({local,sourceInstallationDir,targetCatalogSha256,sourceCatalogSha256,sourceAuthority}){
 need(SHA.test(targetCatalogSha256||'')&&SHA.test(sourceCatalogSha256||'')&&targetCatalogSha256!==sourceCatalogSha256,'BAD_SLOT_TARGET','新slot必须属于不同的完整目标目录');
 const parent=path.join(u.safeAbsolute(local),'鑫金源珠宝'),anchor=path.join(parent,'员工程序'),source=u.safeAbsolute(sourceInstallationDir);
 const active=sourceAuthority?.kind==='active-slot'&&u.samePath(sourceAuthority.installationDir,source)&&u.samePath(path.dirname(source),parent)&&/^员工程序-slot-[a-f0-9]{64}$/.test(path.basename(source));
 need(u.samePath(source,anchor)||active,'SOURCE_SLOT_UNSUPPORTED','只接受固定员工目录或已认证active slot；不使用任意安装位置');
 const target=path.join(parent,'员工程序-slot-'+targetCatalogSha256),r=path.relative(source,target),back=path.relative(target,source);
 need(r!==''&&back!==''&&(r==='..'||r.startsWith('..'+path.sep))&&(back==='..'||back.startsWith('..'+path.sep)),'BAD_SLOT_TARGET','新slot与真实源必须是互不包含的独立目录');
 return {source,target,parent};
}

// 2026-10-23（sequence 28）：原员工安装的 resources/app.asar 允许存在"已审 ASAR 修订"——
// 回执自己声明的那个修订，或本次安装包目标声明的那个修订。真实员工安装的 asar 会被已审补丁
// 改写（本机回执 0366ff38…、磁盘 2ea40525…，尺寸同为 13,501,798 B），原实现要求逐行相同，
// 于是每次升级都在复制阶段之前被 SOURCE_CHANGED 挡住。这里只放开这一行：除 asar 外每一行
// 仍必须与回执逐字节相同；asar 必须是上面两个已签修订之一且尺寸不变，其他摘要一律拒绝。
const APP_ASAR='resources/app.asar';
function reviewedSourceAsar170(expected,tree,targetCatalog){
 const asarRow=list=>Array.isArray(list)?list.find(f=>f.path===APP_ASAR):undefined;
 const allowed=new Set(),want=asarRow(expected);
 if(want&&Number.isSafeInteger(want.size)&&SHA.test(want.sha256||''))allowed.add(want.size+':'+want.sha256);
 const target=asarRow(targetCatalog?.files);
 if(target&&Number.isSafeInteger(target.size)&&SHA.test(target.sha256||''))allowed.add(target.size+':'+target.sha256);
 const withoutAsar=list=>rows(list.filter(f=>f.path!==APP_ASAR));
 if(!same(withoutAsar(tree.files),withoutAsar(expected)))return false;
 const disk=asarRow(tree.files);
 if(!disk||!want)return !disk&&!want;
 return allowed.has(disk.size+':'+disk.sha256);
}

async function inspectSource170({install,authority,sourceEnvelope,sourceCatalog,sourceBindings=[],operationKey,publicKey,targetCatalog=null}){
 const state=startup.stateDirectory(install),installIdentity=u.statIdentity(await u.assertPath(fs,install,{directory:true})),stateIdentity=u.statIdentity(await u.assertPath(fs,state,{directory:true}));
 const names=(await fs.readdir(state)).sort();
 const key=await u.readSmall(fs,path.join(state,'journal-key.bin'),32),journalBytes=await u.readSmall(fs,path.join(state,'journal.json'),16777216),statusBytes=await u.readSmall(fs,path.join(state,startup.STATUS),16384),catalogBytes=await u.readSmall(fs,path.join(state,startup.CATALOG),2097152);
 const markerBytes=await u.readSmall(fs,path.join(install,MARKER),4096),marker=JSON.parse(markerBytes);
 need(exact(marker,['version','product','programVersion','role','installationDir'])&&marker.version===1&&marker.product===core.PRODUCT&&marker.programVersion==='1.7.0'&&marker.role==='employee'&&u.samePath(marker.installationDir,install),'BAD_ACTIVATION','原员工角色或路径不符');
 const input={key,journalBytes,statusBytes,catalogBytes,sourceEnvelope,installationDir:install,installationIdentity:installIdentity,stateDir:state,stateIdentity,rootIdentity:u.statIdentity(await u.assertPath(fs,path.dirname(install),{directory:true})),namespace:startup.namespace(),sourceBindings,markerBytes};
 const kind=JSON.parse(JSON.parse(journalBytes).payload)?.purpose;let stateProof,fullRecord=null;
 if(kind==='xjy-engine-fresh170'){
  need(same(names,['engine-startup-status.json','journal-key.bin','journal.json','target-catalog-envelope.json'].sort()),'SOURCE_FRESH_REQUIRED','原fresh状态有其他恢复事务，保持原现场');stateProof=authenticateFreshSourceState170(input);
 }else{
  const full=authenticateCommittedFullSourceState170(input);stateProof=full.proof;fullRecord=full.record;
  const base=['engine-startup-status.json','journal-key.bin','journal.json','target-catalog-envelope.json','native-intent.json','data-proof','profile-proof'];
  need(base.every(n=>names.includes(n))&&names.every(n=>base.includes(n)||/^employee-profile-[a-f0-9-]{36}$/.test(n)),'SOURCE_COMMITTED_FULL_REQUIRED','原完整升级状态有未知/进行中恢复材料，不忽略或清理');
  for(const name of names)await u.assertPath(fs,path.join(state,name),{directory:['data-proof','profile-proof'].includes(name)||name.startsWith('employee-profile-'),root:state});
  need(u.statIdentity(await u.assertPath(fs,path.join(state,'data-proof'),{directory:true}))===fullRecord.identities.data&&u.statIdentity(await u.assertPath(fs,path.join(state,'profile-proof'),{directory:true}))===fullRecord.identities.profile,'DIRECTORY_CHANGED','原完整升级资料证明目录身份改变');
  const wrapped=JSON.parse(await u.readSmall(fs,path.join(state,'native-intent.json'),16384));need(exact(wrapped,['payload','mac'])&&typeof wrapped.payload==='string'&&SHA.test(wrapped.mac||'')&&crypto.timingSafeEqual(crypto.createHmac('sha256',key).update('xjy-native-engine-intent170\0').update(wrapped.payload).digest(),Buffer.from(wrapped.mac,'hex')),'BAD_JOURNAL','原完整升级native意图认证失败');
  const intent=JSON.parse(wrapped.payload);need(exact(intent,['version','purpose','publicationId','authorizationKind','approvalId','installationDir','role','osUser','sourceVersion','sourceIdentity'])&&intent.version===1&&intent.purpose==='xjy-native-engine-intent170'&&SHA.test(intent.publicationId||'')&&intent.authorizationKind==='repeat-approval'&&u.UUID.test(intent.approvalId||'')&&u.samePath(intent.installationDir,install)&&intent.role==='employee'&&intent.osUser===authority.osUser&&intent.sourceVersion===fullRecord.sourceVersion&&(intent.sourceIdentity===null||typeof intent.sourceIdentity==='string'),'BAD_JOURNAL','原完整升级native意图不属于本机已认证来源');
 }
 const expected=fullRecord?rows(fullRecord.targetFiles):rows([...sourceCatalog.files,{path:MARKER,size:markerBytes.length,sha256:digest(markerBytes)}]),tree=await core.inspectArtifactTree({artifactDir:install});
 need(reviewedSourceAsar170(expected,tree,targetCatalog),'SOURCE_CHANGED','原员工完整程序与原签名目录不同');
 const approvedEmpty=await runtime170().captureApprovedEmptyDirectories(fs,install);
 const directoryIdentities=new Map(approvedEmpty.map(d=>[d.path,d.identity]));
 const directories=new Set(directoryIdentities.keys());for(const spec of expected){let name=path.posix.dirname(spec.path);while(name!=='.'){directories.add(name);name=path.posix.dirname(name);}}
 if(fullRecord)for(const d of fullRecord.sourceMutableDirectories)directories.add(d.path);
 // 2026-10-23（sequence 31）：只放行完全空的未知目录。显卡驱动等外部程序会在安装目录留下空目录
 // （本机 NVIDIA Corporation/umdlogs/，10-22 22:56 创建，不在签名目录里），原实现一律 SOURCE_CHANGED，
 // 这类机器永远无法升级。空目录不含任何程序内容，跳过不影响原程序完整性；一旦里面出现任何文件，
 // 仍按原样以 SOURCE_CHANGED 拒绝，不迁移也不清理。
 async function holdsAnyFile(dir){for(const name of await fs.readdir(dir)){const file=path.join(dir,name),s=await fs.lstat(file,{bigint:true});if(!s.isDirectory())return true;if(await holdsAnyFile(file))return true;}return false;}
 async function walk(dir,prefix=''){for(const name of await fs.readdir(dir)){const file=path.join(dir,name),s=await fs.lstat(file,{bigint:true}),relative=prefix+name;if(s.isDirectory()){if(!directories.has(relative)){if(!await holdsAnyFile(file))continue;need(false,'SOURCE_CHANGED','原员工程序含未知目录，不忽略或迁移');}if(directoryIdentities.has(relative))need(u.statIdentity(s)===directoryIdentities.get(relative),'DIRECTORY_CHANGED','原员工已知空目录身份变化');await u.assertPath(fs,file,{directory:true,root:install});await walk(file,relative+'/');}}}await walk(install);
 const approvedEmptyAfter=await runtime170().captureApprovedEmptyDirectories(fs,install);
 need(same(approvedEmptyAfter,approvedEmpty),'DIRECTORY_CHANGED','原员工已知空目录在一次核验中变化');
 const gate=startup.readEngineStartupGate({installDir:install,programVersion:'1.7.0',installedRole:'employee',trustedPublicKey:publicKey});
 need(gate.blocked===false&&gate.transactionId===stateProof.transactionId&&gate.mode===stateProof.mode,'SOURCE_STARTUP_BLOCKED','原员工真实完整启动门尚未认证通过');
 const identity=(os.hostname()+'-'+os.userInfo().username).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,90),profile=path.join(authority.local,'鑫金源珠宝员工端',identity),profileIdentity=u.statIdentity(await u.assertPath(fs,profile,{directory:true}));
 const roleFile=path.join(profile,'launch-role.json'),role=JSON.parse(await u.readSmall(fs,roleFile,8192));
 need(exact(role,['version','role'])&&role.version===1&&role.role==='employee','KNOWN_PROFILE_REQUIRED','独立默认员工profile缺少明确原角色，不新建或迁移');
 if(fullRecord){
  need(fullRecord.profileFiles.length===1&&fullRecord.profileFiles[0].path==='profile.json'&&fullRecord.dataFiles.length===1&&fullRecord.dataFiles[0].path==='backup.json','SOURCE_PROFILE_PROOF_REQUIRED','原完整升级缺少原runtime明确员工profile证明');
  const profileBytes=await u.readSmall(fs,path.join(state,'profile-proof','profile.json'),65536),dataBytes=await u.readSmall(fs,path.join(state,'data-proof','backup.json'),8192),p=JSON.parse(profileBytes),d=JSON.parse(dataBytes),pr=fullRecord.profileFiles[0],dr=fullRecord.dataFiles[0];
  need(profileBytes.length===pr.size&&digest(profileBytes)===pr.sha256&&dataBytes.length===dr.size&&digest(dataBytes)===dr.sha256,'BAD_JOURNAL','原完整升级profile/资料证明字节不符');
  need(exact(p,['version','profileDir','directory','treeSha256'])&&p.version===1&&u.samePath(p.profileDir,profile)&&u.samePath(path.dirname(u.safeAbsolute(p.directory)),state)&&/^employee-profile-[a-f0-9-]{36}$/.test(path.basename(p.directory))&&SHA.test(p.treeSha256||'')&&exact(d,['version','role','hostDataOpened'])&&d.version===1&&d.role==='employee'&&d.hostDataOpened===false,'KNOWN_PROFILE_REQUIRED','原完整升级没有使用同一独立默认员工profile；不迁移或改读其他资料');
 }
 // Check write access by opening an existing role file, without modifying any byte.
 const writable=await u.openChecked(fs,roleFile,'r+',{root:profile});try{await u.assertHandle(fs,writable,{root:profile});}finally{await writable.handle.close();}
 need(u.statIdentity(await u.assertPath(fs,install,{directory:true}))===installIdentity&&u.statIdentity(await u.assertPath(fs,state,{directory:true}))===stateIdentity&&u.statIdentity(await u.assertPath(fs,profile,{directory:true}))===profileIdentity,'DIRECTORY_CHANGED','原程序/状态/profile身份变化');
 need(operationKey===undefined||Buffer.isBuffer(operationKey)&&operationKey.length===32,'BAD_SLOT_ANCHOR','默认source anchor认证密钥不完整');
 return {key:operationKey||key,install,state,installIdentity,stateIdentity,profile,profileIdentity,treeSha256:tree.sha256,stateProof};
}

function encodeOperation(record,key){const payload=JSON.stringify(record);return Buffer.from(JSON.stringify({payload,mac:crypto.createHmac('sha256',key).update(DOMAIN).update(payload).digest('hex')}));}
function decodeOperation(bytes,key){const w=JSON.parse(bytes);need(exact(w,['payload','mac'])&&typeof w.payload==='string'&&/^[a-f0-9]{64}$/.test(w.mac||'')&&crypto.timingSafeEqual(crypto.createHmac('sha256',key).update(DOMAIN).update(w.payload).digest(),Buffer.from(w.mac,'hex')),'BAD_SLOT_JOURNAL','slot恢复记录认证失败');return JSON.parse(w.payload);}
async function retireCommittedSourceLock170(context,source,file){
 const bytes=await optionalBytes(file,8192);if(bytes===null)return false;
 const owner=decodeOperation(bytes,source.key);if(context.sourceAuthority?.kind!=='active-slot'||owner.targetCatalogSha256!==context.sourceAuthority.catalogSha256)return false;
 need(exact(owner,['version','purpose','sourceIdentity','profileIdentity','targetCatalogSha256','operationId'])&&owner.version===1&&owner.purpose==='xjy-employee-slot-lock170'&&owner.profileIdentity===source.profileIdentity&&u.UUID.test(owner.operationId||''),'BAD_SLOT_LOCK','上一代已提交源锁字段无效');
 const priorFile=path.join(context.authority.local,'鑫金源珠宝安装','employee-slot-'+owner.targetCatalogSha256,'journal.json'),priorBytes=await u.readSmall(fs,priorFile,1048576),prior=decodeOperation(priorBytes,source.key),hintFile=path.join(context.authority.local,'鑫金源珠宝安装','verified-location-'+context.authority.osUser+'.json');
 need(prior.version===1&&prior.purpose==='xjy-employee-slot170'&&prior.phase==='committed'&&prior.role==='employee'&&prior.osUser===context.authority.osUser&&prior.namespace===startup.namespace()&&prior.operationId===owner.operationId&&prior.sourceInstallationIdentity===owner.sourceIdentity&&u.samePath(prior.targetInstallationDir,source.install)&&prior.targetInstallationIdentity===source.installIdentity&&prior.targetStateIdentity===source.stateIdentity&&prior.targetTransactionId===source.stateProof.transactionId&&prior.profileIdentity===source.profileIdentity&&u.samePath(prior.profileDir,source.profile)&&prior.targetCatalogSha256===context.sourceAuthority.catalogSha256&&prior.switch&&u.samePath(prior.switch.hintFile,hintFile)&&typeof prior.switch.hintAfter==='string'&&(await u.readSmall(fs,hintFile,8192)).equals(Buffer.from(prior.switch.hintAfter,'base64')),'BAD_SLOT_LOCK','上一代源锁没有当前真实active提交证明');
 need((await u.readSmall(fs,priorFile,1048576)).equals(priorBytes)&&(await u.readSmall(fs,file,8192)).equals(bytes),'BAD_SLOT_LOCK','上一代提交/源锁在核验期间变化');await fs.unlink(file);return true;
}

// Internal native-provider composition only; callbacks are closed over the verified
// provider and never accepted from a CLI, request JSON, environment or renderer.
async function prepareEmployeeSlot170(context){
 const {authority,publication,sourceEnvelope,sourceCatalog,sourceBindings,sourceAuthority,operationKey,publicKey,targetCatalog,request,acl,closed,copyTarget,createTargetState,initializeTarget,revalidate}=context;
 need(exact(request,['installationDir']),'BAD_SLOT_REQUEST','slot只接收已核原安装位置');
 const derived=deriveEmployeeSlot170({local:authority.local,sourceInstallationDir:request.installationDir,targetCatalogSha256:publication.engineTreeSha256,sourceCatalogSha256:digest(Buffer.from(sourceEnvelope.catalog)),sourceAuthority});
 await closed(derived.source,derived.target);
 const source=await inspectSource170({install:derived.source,authority,sourceEnvelope,sourceCatalog,sourceBindings,operationKey,publicKey,targetCatalog});
 await acl([derived.parent,source.install,source.state,source.profile]);
 await revalidate();await closed(derived.source,derived.target);
 const next=await inspectSource170({install:derived.source,authority,sourceEnvelope,sourceCatalog,sourceBindings,operationKey,publicKey,targetCatalog});
 need(next.installIdentity===source.installIdentity&&next.stateIdentity===source.stateIdentity&&next.profileIdentity===source.profileIdentity&&same(next.stateProof,source.stateProof)&&next.treeSha256===source.treeSha256,'SOURCE_CHANGED','写前原完整员工状态已变化');
 const operationRoot=path.join(authority.local,'鑫金源珠宝安装','employee-slot-'+publication.engineTreeSha256),journalFile=path.join(operationRoot,'journal.json');
 // A source bound lock is shared across publications. It is retained on failure;
 // a later operation must first authenticate recovery rather than guess ownership.
 const lockFile=path.join(derived.parent,'.employee-slot170.lock');
 let hintRootExists=true;try{await u.assertPath(fs,path.dirname(operationRoot),{directory:true});}catch(error){if(error.code!=='ENOENT')throw error;hintRootExists=false;}
 if(!hintRootExists)await acl([authority.local],[path.dirname(operationRoot)]);
 await retireCommittedSourceLock170(context,source,lockFile);
 const owner={version:1,purpose:'xjy-employee-slot-lock170',sourceIdentity:source.installIdentity,profileIdentity:source.profileIdentity,targetCatalogSha256:publication.engineTreeSha256,operationId:crypto.randomUUID()};
 const lock=await u.openChecked(fs,lockFile,'wx+',{missing:true,root:derived.parent});
 try{await u.writeExactly(lock.handle,0,encodeOperation(owner,source.key));await lock.handle.sync();await u.assertHandle(fs,lock,{snapshot:false,root:derived.parent});}finally{await lock.handle.close();}
 let record;
 try{
  await acl([path.dirname(operationRoot)],[operationRoot]);
  record={version:1,purpose:'xjy-employee-slot170',operationId:owner.operationId,phase:'prepared',publicationId:publication.publicationId,sourceCatalogSha256:digest(Buffer.from(sourceEnvelope.catalog)),targetCatalogSha256:publication.engineTreeSha256,sourceInstallationDir:source.install,sourceInstallationIdentity:source.installIdentity,sourceStateIdentity:source.stateIdentity,sourceStateProof:source.stateProof,sourceTreeSha256:source.treeSha256,targetInstallationDir:derived.target,profileDir:source.profile,profileIdentity:source.profileIdentity,osUser:authority.osUser,namespace:startup.namespace(),role:'employee'};
  await u.atomicWrite(fs,journalFile,encodeOperation(record,source.key),operationRoot);
  await closed(derived.source,derived.target);await revalidate();
  await acl([derived.parent], [derived.target]);
  record={...record,phase:'target-created',targetInstallationIdentity:u.statIdentity(await u.assertPath(fs,derived.target,{directory:true})),targetTransactionId:null};await u.atomicWrite(fs,journalFile,encodeOperation(record,source.key),operationRoot);
  await copyTarget(derived.target);
  record={...record,phase:'state-created',targetStateIdentity:await createTargetState(derived.target)};await u.atomicWrite(fs,journalFile,encodeOperation(record,source.key),operationRoot);
  const committed=await initializeTarget(derived.target,record.targetStateIdentity);
  need(committed?.committed===true&&committed.role==='employee'&&committed.version==='1.7.0'&&u.samePath(committed.installationDir,derived.target),'SLOT_COMMIT_FAILED','新slot真实fresh提交未确认');
  const gate=startup.readEngineStartupGate({installDir:derived.target,programVersion:'1.7.0',installedRole:'employee',trustedPublicKey:publicKey});
  need(gate.blocked===false&&gate.mode==='fresh'&&gate.transactionId===committed.transactionId,'SLOT_STARTUP_BLOCKED','新slot启动门未通过');
  record={...record,phase:'target-ready',targetInstallationIdentity:u.statIdentity(await u.assertPath(fs,derived.target,{directory:true})),targetTransactionId:committed.transactionId};
  await u.atomicWrite(fs,journalFile,encodeOperation(record,source.key),operationRoot);
  const after=await inspectSource170({install:source.install,authority,sourceEnvelope,sourceCatalog,sourceBindings,operationKey,publicKey,targetCatalog});
  need(after.installIdentity===source.installIdentity&&same(after.stateProof,source.stateProof)&&after.profileIdentity===source.profileIdentity,'SOURCE_CHANGED','新slot准备期间原程序/状态/profile身份变化');
  // No launch, remembered-location write or shortcut switch occurs here. The
  // authenticated transaction remains pending until actual health/activation.
  return {prepared:true,activated:false,healthRequired:true,operationId:record.operationId,installationDir:derived.target,sourceInstallationDir:source.install,profileDir:source.profile,version:'1.7.0',engineVersion:'44.9.0'};
 }catch(error){error.slotOperationId=owner.operationId;error.sourcePreserved=true;throw error;}
}

async function optionalBytes(file,max){try{return await u.readSmall(fs,file,max);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
const packed=bytes=>bytes===null?null:bytes.toString('base64');
function unpacked(value,max){need(value===null||typeof value==='string'&&value.length<=Math.ceil(max/3)*4,'BAD_SLOT_JOURNAL','slot原文件快照无效');if(value===null)return null;const b=Buffer.from(value,'base64');need(b.toString('base64')===value&&b.length<=max,'BAD_SLOT_JOURNAL','slot快照编码无效');return b;}
async function bytesEqual(file,expected,max){const current=await optionalBytes(file,max);return current===null?expected===null:expected!==null&&current.equals(expected);}
async function assertDesktopOutput170(desktop,identity){need(typeof identity==='string'&&u.statIdentity(await u.assertPath(fs,desktop,{directory:true}))===identity,'DESKTOP_CHANGED','系统Desktop目录身份变化或含路径链接');}
async function outputMatches170({desktop,desktopIdentity,file,bytes,identity}){
 await assertDesktopOutput170(desktop,desktopIdentity);need(u.samePath(path.dirname(file),desktop),'BAD_SHORTCUT','输出文件不能离开已绑定KnownFolder');
 let stat;try{stat=await u.assertPath(fs,file,{root:desktop});}catch(error){if(error.code!=='ENOENT')throw error;return bytes===null&&identity===null;}
 if(bytes===null||typeof identity!=='string'||u.statIdentity(stat)!==identity)return false;
 const actual=await u.readSmall(fs,file,65536);await assertDesktopOutput170(desktop,desktopIdentity);return actual.equals(bytes)&&u.statIdentity(await u.assertPath(fs,file,{root:desktop}))===identity;
}
async function createOutputStage170({desktop,desktopIdentity,file}){
 await assertDesktopOutput170(desktop,desktopIdentity);need(u.samePath(path.dirname(file),desktop)&&/^\.xjy-employee-slot-[a-f0-9-]{36}(?:-restore)?(?:-[a-f0-9-]{36})?\.lnk$/.test(path.basename(file)),'BAD_SHORTCUT','临时输出不是本事务派生的KnownFolder文件');
 const opened=await u.openChecked(fs,file,'wx+',{missing:true,root:desktop});try{await opened.handle.sync();await u.assertHandle(fs,opened,{snapshot:false,root:desktop});}finally{await opened.handle.close();}await assertDesktopOutput170(desktop,desktopIdentity);return opened.identity;
}
function validOutputAttemptPath170({desktop,file,operationId,restore=false}){
 if(!u.UUID.test(operationId||'')||typeof file!=='string'||!u.samePath(path.dirname(file),desktop))return false;
 const prefix='.xjy-employee-slot-'+operationId+(restore?'-restore':''),name=path.basename(file);
 // Keep exact legacy bound paths readable; new attempts never generate them.
 if(name===prefix+'.lnk')return true;
 return name.startsWith(prefix+'-')&&name.endsWith('.lnk')&&u.UUID.test(name.slice(prefix.length+1,-4));
}
async function createOutputAttempt170({desktop,desktopIdentity,operationId,restore=false}){
 need(u.UUID.test(operationId||'')&&typeof restore==='boolean','BAD_SHORTCUT','输出尝试必须绑定本事务和固定用途');
 for(let attempt=0;attempt<8;attempt++){
  const file=path.join(desktop,'.xjy-employee-slot-'+operationId+(restore?'-restore':'')+'-'+crypto.randomUUID()+'.lnk');
  try{return{file,identity:await createOutputStage170({desktop,desktopIdentity,file})};}catch(error){if(error.code!=='EEXIST')throw error;}
 }
 u.fail('OUTPUT_ATTEMPT_COLLISION','独占输出名称连续冲突，未认领或清理任何既有文件');
}
async function writeOutputStage170({desktop,desktopIdentity,file,identity,bytes}){
 await assertDesktopOutput170(desktop,desktopIdentity);need(u.samePath(path.dirname(file),desktop)&&Buffer.isBuffer(bytes)&&bytes.length<=65536,'BAD_SHORTCUT','临时输出内容/路径无效');
 const opened=await u.openChecked(fs,file,'r+',{root:desktop});try{need(opened.identity===identity,'SHORTCUT_CHANGED','临时快捷方式被竞争替换');const stat=await opened.handle.stat({bigint:true});need(stat.size<=BigInt(bytes.length),'SHORTCUT_CHANGED','临时快捷方式出现未知内容');if(stat.size>0n){const prefix=await u.readExactly(opened.handle,0,Number(stat.size));need(prefix.equals(bytes.subarray(0,prefix.length)),'SHORTCUT_CHANGED','临时快捷方式已被其他内容修改');}await u.writeExactly(opened.handle,0,bytes);await opened.handle.truncate(bytes.length);await opened.handle.sync();await u.assertHandle(fs,opened,{snapshot:false,root:desktop});}finally{await opened.handle.close();}
 need(await outputMatches170({desktop,desktopIdentity,file,bytes,identity}),'SHORTCUT_CHANGED','临时快捷方式写入读回不符');
}
async function publishOutputStage170({desktop,desktopIdentity,file,beforeBytes,beforeIdentity,stage,afterBytes,afterIdentity}){
 need(path.basename(file)==='鑫金源珠宝（员工端）.lnk'&&u.samePath(path.dirname(file),desktop)&&u.samePath(path.dirname(stage),desktop),'BAD_SHORTCUT','快捷方式发布只能使用已绑定KnownFolder固定名称');
 need(await outputMatches170({desktop,desktopIdentity,file,bytes:beforeBytes,identity:beforeIdentity})&&await outputMatches170({desktop,desktopIdentity,file:stage,bytes:afterBytes,identity:afterIdentity}),'SHORTCUT_CHANGED','快捷方式目标/原字节/物理身份或临时文件已被竞争修改');
 await fs.rename(stage,file);need(await outputMatches170({desktop,desktopIdentity,file,bytes:afterBytes,identity:afterIdentity}),'SHORTCUT_CHANGED','发布后快捷方式身份或字节变化，不视为成功');
}
async function discardOutputStage170({desktop,desktopIdentity,file,identity,bytes}){
 await assertDesktopOutput170(desktop,desktopIdentity);let stat;try{stat=await u.assertPath(fs,file,{root:desktop});}catch(error){if(error.code==='ENOENT')return;throw error;}
 need(u.samePath(path.dirname(file),desktop)&&u.statIdentity(stat)===identity&&stat.size<=BigInt(bytes.length),'SHORTCUT_CHANGED','临时输出已被替换或扩展，不清理');
 if(stat.size>0n){const prefix=await u.readSmall(fs,file,65536);need(prefix.equals(bytes.subarray(0,prefix.length)),'SHORTCUT_CHANGED','临时输出有未知内容，不清理');}
 need(u.statIdentity(await u.assertPath(fs,file,{root:desktop}))===identity,'SHORTCUT_CHANGED','清理前临时输出身份变化');await fs.unlink(file);
}
async function loadOperation(context){
 const {authority,publication,request,sourceEnvelope,sourceCatalog,sourceBindings,sourceAuthority,operationKey,publicKey,targetCatalog}=context;
 need(exact(request,['installationDir']),'BAD_SLOT_REQUEST','slot只接收原已核员工位置');
 const derived=deriveEmployeeSlot170({local:authority.local,sourceInstallationDir:request.installationDir,targetCatalogSha256:publication.engineTreeSha256,sourceCatalogSha256:digest(Buffer.from(sourceEnvelope.catalog)),sourceAuthority}),source=await inspectSource170({install:derived.source,authority,sourceEnvelope,sourceCatalog,sourceBindings,operationKey,publicKey,targetCatalog});
 const operationRoot=path.join(authority.local,'鑫金源珠宝安装','employee-slot-'+publication.engineTreeSha256),journalFile=path.join(operationRoot,'journal.json'),lockFile=path.join(derived.parent,'.employee-slot170.lock');
 const record=decodeOperation(await u.readSmall(fs,journalFile,1048576),source.key),lockBytes=await optionalBytes(lockFile,8192),owner=lockBytes===null?null:decodeOperation(lockBytes,source.key);
 const keys=['version','purpose','operationId','phase','publicationId','sourceCatalogSha256','targetCatalogSha256','sourceInstallationDir','sourceInstallationIdentity','sourceStateIdentity','sourceStateProof','sourceTreeSha256','targetInstallationDir','profileDir','profileIdentity','osUser','namespace','role'];
 if(record.targetInstallationIdentity!==undefined)keys.push('targetInstallationIdentity','targetTransactionId');if(record.targetStateIdentity!==undefined)keys.push('targetStateIdentity');if(record.switch!==undefined)keys.push('switch');
 need(exact(record,keys)&&record.version===1&&record.purpose==='xjy-employee-slot170'&&u.UUID.test(record.operationId||'')&&['prepared','target-created','state-created','target-ready','cleaning-target','switch-prepared','hint-switched','shortcut-switched','restoring-shortcut','shortcut-restored','committed','rolledback'].includes(record.phase)&&record.publicationId===publication.publicationId&&record.sourceCatalogSha256===digest(Buffer.from(sourceEnvelope.catalog))&&record.targetCatalogSha256===publication.engineTreeSha256&&u.samePath(record.sourceInstallationDir,source.install)&&record.sourceInstallationIdentity===source.installIdentity&&record.sourceStateIdentity===source.stateIdentity&&same(record.sourceStateProof,source.stateProof)&&record.sourceTreeSha256===source.treeSha256&&u.samePath(record.targetInstallationDir,derived.target)&&u.samePath(record.profileDir,source.profile)&&record.profileIdentity===source.profileIdentity&&record.osUser===authority.osUser&&record.namespace===startup.namespace()&&record.role==='employee','BAD_SLOT_JOURNAL','slot恢复记录不属于当前员工/原完整来源/目标发布');
 need(record.phase==='committed'||exact(owner,['version','purpose','sourceIdentity','profileIdentity','targetCatalogSha256','operationId'])&&owner.version===1&&owner.purpose==='xjy-employee-slot-lock170'&&owner.sourceIdentity===source.installIdentity&&owner.profileIdentity===source.profileIdentity&&owner.targetCatalogSha256===publication.engineTreeSha256&&owner.operationId===record.operationId,'BAD_SLOT_JOURNAL','slot源/profile锁不属于此认证事务');
 return {source,derived,operationRoot,journalFile,lockFile,record};
}
async function verifyTarget(context,operation){
 const {record,derived}=operation,{targetCatalog,publicKey}=context;
 need(record.targetInstallationIdentity===u.statIdentity(await u.assertPath(fs,derived.target,{directory:true})),'DIRECTORY_CHANGED','新slot物理身份改变');
 need(typeof record.targetStateIdentity==='string'&&record.targetStateIdentity===u.statIdentity(await u.assertPath(fs,startup.stateDirectory(derived.target),{directory:true})),'DIRECTORY_CHANGED','新slot状态目录物理身份改变');
 const marker=await u.readSmall(fs,path.join(derived.target,MARKER),4096),activation=JSON.parse(marker);
 need(exact(activation,['version','product','programVersion','role','installationDir'])&&activation.version===1&&activation.product===core.PRODUCT&&activation.programVersion==='1.7.0'&&activation.role==='employee'&&u.samePath(activation.installationDir,derived.target),'BAD_ACTIVATION','新slot角色改变');
 const tree=await core.inspectArtifactTree({artifactDir:derived.target});need(same(rows(tree.files),rows([...targetCatalog.files,{path:MARKER,size:marker.length,sha256:digest(marker)}])),'TREE_CHANGED','新slot完整目标改变');
 const gate=startup.readEngineStartupGate({installDir:derived.target,programVersion:'1.7.0',installedRole:'employee',trustedPublicKey:publicKey});
 need(gate.blocked===false&&gate.transactionId===record.targetTransactionId&&gate.mode==='fresh','SLOT_STARTUP_BLOCKED','新slot真实fresh启动门不符');
 const envelope=JSON.parse(await u.readSmall(fs,path.join(startup.stateDirectory(derived.target),startup.CATALOG),2097152));need(digest(Buffer.from(envelope.catalog))===record.targetCatalogSha256,'BAD_SIGNATURE','新slot启动目录不是本次完整目标');
}
function validateSwitch(s,context,operation){
 need(exact(s,['hintFile','hintBefore','hintAfter','shortcutFile','shortcutBefore','shortcutAfter','desktopIdentity','shortcutBeforeIdentity','shortcutAfterIdentity','shortcutTemporaryPath','shortcutRestoreIdentity','shortcutRestorePath']),'BAD_SLOT_JOURNAL','slot切换快照字段不完整');
 need(u.samePath(s.hintFile,path.join(context.authority.local,'鑫金源珠宝安装','verified-location-'+context.authority.osUser+'.json')),'BAD_SLOT_JOURNAL','slot位置记录路径改变');
 need(path.basename(s.shortcutFile)==='鑫金源珠宝（员工端）.lnk','BAD_SLOT_JOURNAL','slot快捷方式文件名改变');
 const beforeHint=unpacked(s.hintBefore,8192),afterHint=unpacked(s.hintAfter,8192),beforeShortcut=unpacked(s.shortcutBefore,65536),afterShortcut=unpacked(s.shortcutAfter,65536);
 need(typeof s.desktopIdentity==='string'&&s.desktopIdentity.length>0&&(beforeShortcut===null?s.shortcutBeforeIdentity===null:typeof s.shortcutBeforeIdentity==='string'&&s.shortcutBeforeIdentity.length>0)&&typeof s.shortcutAfterIdentity==='string'&&s.shortcutAfterIdentity.length>0&&(s.shortcutRestoreIdentity===null||typeof s.shortcutRestoreIdentity==='string'&&s.shortcutRestoreIdentity.length>0)&&validOutputAttemptPath170({desktop:path.dirname(s.shortcutFile),file:s.shortcutTemporaryPath,operationId:operation.record.operationId})&&validOutputAttemptPath170({desktop:path.dirname(s.shortcutFile),file:s.shortcutRestorePath,operationId:operation.record.operationId,restore:true}),'BAD_SLOT_JOURNAL','slot输出目录/文件身份或派生临时路径无效');
 need(afterHint!==null&&afterShortcut!==null,'BAD_SLOT_JOURNAL','slot目标切换字节缺失');
 const hint=JSON.parse(afterHint);need(hint.version===1&&hint.product===core.PRODUCT&&hint.role==='employee'&&hint.osUser===context.authority.osUser&&u.samePath(hint.installationDir,operation.derived.target)&&hint.installationIdentity===context.physicalIdentityOfTarget,'BAD_SLOT_JOURNAL','slot目标位置记录身份错误');
 return {beforeHint,afterHint,beforeShortcut,afterShortcut};
}
async function releaseCommittedSourceLock(operation){
 const bytes=await optionalBytes(operation.lockFile,8192);if(bytes===null)return;
 const owner=decodeOperation(bytes,operation.source.key);if(owner.operationId!==operation.record.operationId)return;
 need(exact(owner,['version','purpose','sourceIdentity','profileIdentity','targetCatalogSha256','operationId'])&&owner.purpose==='xjy-employee-slot-lock170'&&owner.sourceIdentity===operation.source.installIdentity&&owner.profileIdentity===operation.source.profileIdentity&&owner.targetCatalogSha256===operation.record.targetCatalogSha256,'BAD_SLOT_LOCK','已提交slot源锁绑定不符');
 need((await u.readSmall(fs,operation.lockFile,8192)).equals(bytes),'BAD_SLOT_LOCK','提交源锁变化');await fs.unlink(operation.lockFile);
}
async function activateEmployeeSlot170(context){
 const op=await loadOperation(context),{source,derived,operationRoot,journalFile}=op;let record=op.record;
 need(record.phase==='target-ready'||record.phase==='committed','SLOT_RECOVERY_REQUIRED','slot切换尚未完成，先使用认证恢复入口');
 await context.revalidate();await context.closed(derived.source);await verifyTarget(context,op);await context.health(derived.target);
 const windows=require('./native-employee-slot-windows170.cjs'),snapshot=await windows.snapshotShortcut();
 if(record.phase==='committed'){
  context.physicalIdentityOfTarget=await context.physicalIdentity(derived.target);const bytes=validateSwitch(record.switch,context,op);
  need(u.samePath(snapshot.path,record.switch.shortcutFile)&&await bytesEqual(record.switch.hintFile,bytes.afterHint,8192)&&await outputMatches170({desktop:snapshot.desktop,desktopIdentity:record.switch.desktopIdentity,file:record.switch.shortcutFile,bytes:bytes.afterShortcut,identity:record.switch.shortcutAfterIdentity}),'SLOT_LOCATION_CHANGED','已提交slot位置/快捷方式改变，保持现场');
  await releaseCommittedSourceLock(op);
  return {completed:true,activated:true,alreadyActivated:true,installationDir:derived.target,role:'employee',version:'1.7.0'};
 }
 if(snapshot.exists)need(u.samePath(snapshot.target,path.join(derived.source,EXE))&&snapshot.arguments==='--employee-client'&&u.samePath(snapshot.workingDirectory,derived.source),'SHORTCUT_CONFLICT','员工同名快捷方式不属于原程序，拒绝覆盖');
 const desktopIdentity=u.statIdentity(await u.assertPath(fs,snapshot.desktop,{directory:true})),hintFile=path.join(context.authority.local,'鑫金源珠宝安装','verified-location-'+context.authority.osUser+'.json'),hintBefore=await optionalBytes(hintFile,8192),beforeStat=snapshot.exists?await u.assertPath(fs,snapshot.path,{root:snapshot.desktop}):null,shortcutBefore=await optionalBytes(snapshot.path,65536),shortcutBeforeIdentity=beforeStat===null?null:u.statIdentity(beforeStat);
 need(snapshot.exists===(shortcutBefore!==null),'SHORTCUT_CHANGED','读取期间员工快捷方式出现或消失');
 const secondSnapshot=await windows.snapshotShortcut();need(u.samePath(secondSnapshot.path,snapshot.path)&&secondSnapshot.exists===snapshot.exists&&(!snapshot.exists||u.samePath(secondSnapshot.target,path.join(derived.source,EXE))&&secondSnapshot.arguments==='--employee-client'&&u.samePath(secondSnapshot.workingDirectory,derived.source))&&await outputMatches170({desktop:snapshot.desktop,desktopIdentity,file:snapshot.path,bytes:shortcutBefore,identity:shortcutBeforeIdentity}),'SHORTCUT_CHANGED','读取期间既有员工快捷方式归属、字节或身份变化');
 if(hintBefore){const old=JSON.parse(hintBefore),locations=require('./install-location.cjs');need(locations.validateLocationHint(old,{osUser:context.authority.osUser,currentIdentity:await context.physicalIdentity(derived.source)})&&u.samePath(old.installationDir,derived.source),'LOCATION_HINT_CONFLICT','已记忆位置不属于原员工程序，拒绝覆盖');}
 // Desktop is an output, never an authority. Keep existing private hint/source
 // ACLs; do not impose the program-source ancestor ACL on the user's Desktop.
 await context.acl([path.dirname(hintFile),operationRoot]);await assertDesktopOutput170(snapshot.desktop,desktopIdentity);
 const temporaryPath=path.join(operationRoot,'target-shortcut.lnk');await windows.renderShortcut({installationDir:derived.target,temporaryPath});const shortcutAfter=await u.readSmall(fs,temporaryPath,65536);
 const hintAfter=Buffer.from(JSON.stringify(require('./install-location.cjs').createLocationHint({candidate:{installationDir:derived.target,identity:await context.physicalIdentity(derived.target),role:'employee'},osUser:context.authority.osUser})));
 const stage=await createOutputAttempt170({desktop:snapshot.desktop,desktopIdentity,operationId:record.operationId}),shortcutTemporaryPath=stage.file,shortcutAfterIdentity=stage.identity,shortcutRestorePath=path.join(snapshot.desktop,'.xjy-employee-slot-'+record.operationId+'-restore-'+crypto.randomUUID()+'.lnk');
 record={...record,phase:'switch-prepared',switch:{hintFile,hintBefore:packed(hintBefore),hintAfter:packed(hintAfter),shortcutFile:snapshot.path,shortcutBefore:packed(shortcutBefore),shortcutAfter:packed(shortcutAfter),desktopIdentity,shortcutBeforeIdentity,shortcutAfterIdentity,shortcutTemporaryPath,shortcutRestoreIdentity:null,shortcutRestorePath}};
 await u.atomicWrite(fs,journalFile,encodeOperation(record,source.key),operationRoot);
 await writeOutputStage170({desktop:snapshot.desktop,desktopIdentity,file:shortcutTemporaryPath,identity:shortcutAfterIdentity,bytes:shortcutAfter});
 await context.revalidate();await context.closed(derived.source);await context.health(derived.target);await verifyTarget(context,{...op,record});
 need(await bytesEqual(hintFile,hintBefore,8192)&&await outputMatches170({desktop:snapshot.desktop,desktopIdentity,file:snapshot.path,bytes:shortcutBefore,identity:shortcutBeforeIdentity}),'SLOT_LOCATION_CHANGED','slot切换前原位置/快捷方式变化，未覆盖');
 await u.atomicWrite(fs,hintFile,hintAfter,path.dirname(hintFile));record={...record,phase:'hint-switched'};await u.atomicWrite(fs,journalFile,encodeOperation(record,source.key),operationRoot);
 await publishOutputStage170({desktop:snapshot.desktop,desktopIdentity,file:snapshot.path,beforeBytes:shortcutBefore,beforeIdentity:shortcutBeforeIdentity,stage:shortcutTemporaryPath,afterBytes:shortcutAfter,afterIdentity:shortcutAfterIdentity});record={...record,phase:'shortcut-switched'};await u.atomicWrite(fs,journalFile,encodeOperation(record,source.key),operationRoot);
 need(await bytesEqual(hintFile,hintAfter,8192)&&await outputMatches170({desktop:snapshot.desktop,desktopIdentity,file:snapshot.path,bytes:shortcutAfter,identity:shortcutAfterIdentity}),'SLOT_LOCATION_CHANGED','slot切换读回失败，需认证恢复');
 await context.health(derived.target);await verifyTarget(context,{...op,record});record={...record,phase:'committed'};await u.atomicWrite(fs,journalFile,encodeOperation(record,source.key),operationRoot);
 await releaseCommittedSourceLock({...op,record});
 return {completed:true,activated:true,installationDir:derived.target,sourceInstallationDir:derived.source,role:'employee',version:'1.7.0',engineVersion:'44.9.0'};
}
async function removeOwnedUnactivatedTarget(context,op){
 const {record,derived,source}=op;need(!record.switch&&record.phase==='cleaning-target'&&typeof record.targetInstallationIdentity==='string','SLOT_CLEANUP_UNPROVEN','新slot创建/清理身份未落盘或已切换，不自动清理');
 const state=startup.stateDirectory(derived.target);let stateExists=true;try{await u.assertPath(fs,state,{directory:true});}catch(error){if(error.code!=='ENOENT')throw error;stateExists=false;}
 need(!stateExists||typeof record.targetStateIdentity==='string','SLOT_CLEANUP_UNPROVEN','新slot状态目录身份未落盘，保持现场');
 const roots=[{dir:derived.target,identity:record.targetInstallationIdentity,files:[...context.targetCatalog.files.map(f=>f.path),MARKER]},...(stateExists?[{dir:state,identity:record.targetStateIdentity,files:['journal-key.bin','journal.json',startup.STATUS,startup.CATALOG]}]:[])],plans=[];
 const inside=(root,value)=>{const r=path.relative(root,value);return r===''||r!=='..'&&!r.startsWith('..'+path.sep)&&!path.isAbsolute(r);};
 for(const spec of roots){
  // Exact derived sibling roots, never source/profile/old engine-state or any
  // caller-computed subtree. All paths are checked before the first deletion.
  need((u.samePath(spec.dir,derived.target)||u.samePath(spec.dir,state))&&[source.install,source.state,source.profile].every(p=>!inside(p,spec.dir)&&!inside(spec.dir,p)),'SLOT_CLEANUP_UNPROVEN','清理路径可能覆盖原程序、原状态或员工profile');
  let stat;try{stat=await u.assertPath(fs,spec.dir,{directory:true});}catch(error){if(error.code!=='ENOENT')throw error;continue;}need(u.statIdentity(stat)===spec.identity,'DIRECTORY_CHANGED','待清理新slot物理身份改变');
  const allowedFiles=new Set(spec.files),allowedDirs=new Set();for(const file of spec.files){let d=path.posix.dirname(file);while(d!=='.'){allowedDirs.add(d);d=path.posix.dirname(d);}}
  const entries=[];async function walk(dir,prefix=''){for(const name of await fs.readdir(dir)){const file=path.join(dir,name),relative=prefix+name,s=await fs.lstat(file,{bigint:true});if(s.isDirectory()){need(allowedDirs.has(relative),'SLOT_TARGET_UNEXPECTED','新slot有未声明目录，不清理');await u.assertPath(fs,file,{directory:true,root:spec.dir});await walk(file,relative+'/');entries.push({file,directory:true,identity:u.statIdentity(s)});}else{need(allowedFiles.has(relative),'SLOT_TARGET_UNEXPECTED','新slot有未声明文件，不清理');await u.assertPath(fs,file,{root:spec.dir});entries.push({file,directory:false,identity:u.statIdentity(s)});}}}await walk(spec.dir);plans.push({spec,entries});
 }
 await context.revalidate();await context.closed(derived.source,derived.target);
 for(const {spec,entries}of plans){for(const row of entries){need(u.statIdentity(await u.assertPath(fs,spec.dir,{directory:true}))===spec.identity&&u.statIdentity(await u.assertPath(fs,row.file,{directory:row.directory,root:spec.dir}))===row.identity,'DIRECTORY_CHANGED','新slot清理期间文件或根身份改变，停止');if(row.directory)await fs.rmdir(row.file);else await fs.unlink(row.file);}need(u.statIdentity(await u.assertPath(fs,spec.dir,{directory:true}))===spec.identity,'DIRECTORY_CHANGED','新slot清理完成前根身份改变');await fs.rmdir(spec.dir);}
}
async function recoverEmployeeSlot170(context){
 const op=await loadOperation(context),{source,derived,journalFile,operationRoot}=op;let record=op.record;
 await context.revalidate();await context.closed(derived.source,derived.target);
 if(record.phase==='committed')return {recovered:false,committed:true,rollbackForbidden:true,installationDir:derived.target};
 if(!record.switch){
  if(record.phase==='rolledback')return{recovered:true,rolledBack:true,sourcePreserved:true,installationDir:derived.source,retryAvailable:true};
  if(record.phase==='cleaning-target'){await removeOwnedUnactivatedTarget(context,op);await u.atomicWrite(fs,journalFile,encodeOperation({...record,phase:'rolledback'},source.key),operationRoot);return{recovered:true,rolledBack:true,newSlotCleaned:true,sourcePreserved:true,installationDir:derived.source,retryAvailable:true};}
  if(record.phase==='target-ready'){await verifyTarget(context,op);return{recovered:true,prepared:true,activated:false,installationDir:derived.target,sourcePreserved:true};}
  if(!['target-created','state-created'].includes(record.phase))return {recovered:false,sourcePreserved:true,targetRetained:true,phase:record.phase,reason:'TARGET_CREATION_IDENTITY_REQUIRED',installationDir:derived.target};
  need(u.statIdentity(await u.assertPath(fs,derived.target,{directory:true}))===record.targetInstallationIdentity,'DIRECTORY_CHANGED','断电后新slot物理身份改变');
  try{
   await context.copyTarget(derived.target);
   if(record.phase==='target-created'){record={...record,phase:'state-created',targetStateIdentity:await context.createTargetState(derived.target)};await u.atomicWrite(fs,journalFile,encodeOperation(record,source.key),operationRoot);}
   const committed=await context.initializeTarget(derived.target,record.targetStateIdentity);need(committed?.committed===true&&committed.role==='employee'&&u.samePath(committed.installationDir,derived.target),'SLOT_COMMIT_FAILED','恢复后的新slot提交不符');
   record={...record,phase:'target-ready',targetTransactionId:committed.transactionId};await u.atomicWrite(fs,journalFile,encodeOperation(record,source.key),operationRoot);await verifyTarget(context,{...op,record});
   return{recovered:true,prepared:true,activated:false,installationDir:derived.target,sourcePreserved:true};
  }catch(error){
   if(!['SLOT_PARTIAL_FILE_REVIEW','BAD_JOURNAL','BAD_STARTUP_RECEIPT','STARTUP_READBACK_FAILED','COMMIT_READBACK_FAILED'].includes(error.code))throw error;
   record={...record,phase:'cleaning-target'};await u.atomicWrite(fs,journalFile,encodeOperation(record,source.key),operationRoot);await removeOwnedUnactivatedTarget(context,{...op,record});
   const after=await inspectSource170({install:derived.source,authority:context.authority,sourceEnvelope:context.sourceEnvelope,sourceCatalog:context.sourceCatalog,sourceBindings:context.sourceBindings,operationKey:context.operationKey,publicKey:context.publicKey,targetCatalog:context.targetCatalog});need(same(after.stateProof,source.stateProof),'SOURCE_CHANGED','独立清理后原启动状态改变');
   await u.atomicWrite(fs,journalFile,encodeOperation({...record,phase:'rolledback'},source.key),operationRoot);
   return{recovered:true,rolledBack:true,newSlotCleaned:true,sourcePreserved:true,installationDir:derived.source,retryAvailable:true};
  }
 }
 context.physicalIdentityOfTarget=await context.physicalIdentity(derived.target);const bytes=validateSwitch(record.switch,context,op),snapshot=await require('./native-employee-slot-windows170.cjs').snapshotShortcut();
 need(u.samePath(snapshot.path,record.switch.shortcutFile),'BAD_SLOT_JOURNAL','恢复快捷方式不属于当前用户KnownFolder');await assertDesktopOutput170(snapshot.desktop,record.switch.desktopIdentity);await context.acl([path.dirname(record.switch.hintFile),operationRoot]);
 async function restore(file,before,after,max){need(await bytesEqual(file,before,max)||await bytesEqual(file,after,max),'SLOT_LOCATION_CHANGED','恢复位置文件不是原字节或本次新字节，不覆盖');if(before===null){if(await optionalBytes(file,max)!==null)await fs.unlink(file);}else await u.atomicWrite(fs,file,before,path.dirname(file));need(await bytesEqual(file,before,max),'SLOT_RESTORE_FAILED','slot原位置恢复读回失败');}
 // Restore launch link first, then remembered selector. Both old/new programs
 // are closed; each partial state is authenticated and reentrant on retry.
 const output={desktop:snapshot.desktop,desktopIdentity:record.switch.desktopIdentity,file:record.switch.shortcutFile};
 const originalPresent=await outputMatches170({...output,bytes:bytes.beforeShortcut,identity:record.switch.shortcutBeforeIdentity}),alreadyRestored=record.switch.shortcutRestoreIdentity!==null&&await outputMatches170({...output,bytes:bytes.beforeShortcut,identity:record.switch.shortcutRestoreIdentity});
 if(!originalPresent&&!alreadyRestored){
  need(await outputMatches170({...output,bytes:bytes.afterShortcut,identity:record.switch.shortcutAfterIdentity}),'SHORTCUT_CHANGED','恢复只触本次已绑定LNK，不覆盖未知或竞争替换文件');
  if(bytes.beforeShortcut===null){record={...record,phase:'restoring-shortcut'};await u.atomicWrite(fs,journalFile,encodeOperation(record,source.key),operationRoot);need(await outputMatches170({...output,bytes:bytes.afterShortcut,identity:record.switch.shortcutAfterIdentity}),'SHORTCUT_CHANGED','删除本次新LNK前身份变化');await fs.unlink(record.switch.shortcutFile);need(await outputMatches170({...output,bytes:null,identity:null}),'SHORTCUT_CHANGED','恢复原空LNK位置时出现竞争文件');}
  else{
   if(record.switch.shortcutRestoreIdentity===null){const stage=await createOutputAttempt170({desktop:snapshot.desktop,desktopIdentity:record.switch.desktopIdentity,operationId:record.operationId,restore:true});record={...record,phase:'restoring-shortcut',switch:{...record.switch,shortcutRestoreIdentity:stage.identity,shortcutRestorePath:stage.file}};await u.atomicWrite(fs,journalFile,encodeOperation(record,source.key),operationRoot);}
   await writeOutputStage170({desktop:snapshot.desktop,desktopIdentity:record.switch.desktopIdentity,file:record.switch.shortcutRestorePath,identity:record.switch.shortcutRestoreIdentity,bytes:bytes.beforeShortcut});
   await publishOutputStage170({...output,beforeBytes:bytes.afterShortcut,beforeIdentity:record.switch.shortcutAfterIdentity,stage:record.switch.shortcutRestorePath,afterBytes:bytes.beforeShortcut,afterIdentity:record.switch.shortcutRestoreIdentity});
  }
 }
 record={...record,phase:'shortcut-restored'};await u.atomicWrite(fs,journalFile,encodeOperation(record,source.key),operationRoot);
 await discardOutputStage170({desktop:snapshot.desktop,desktopIdentity:record.switch.desktopIdentity,file:record.switch.shortcutTemporaryPath,identity:record.switch.shortcutAfterIdentity,bytes:bytes.afterShortcut});
 if(record.switch.shortcutRestoreIdentity!==null)await discardOutputStage170({desktop:snapshot.desktop,desktopIdentity:record.switch.desktopIdentity,file:record.switch.shortcutRestorePath,identity:record.switch.shortcutRestoreIdentity,bytes:bytes.beforeShortcut});
 await restore(record.switch.hintFile,bytes.beforeHint,bytes.afterHint,8192);
 const after=await inspectSource170({install:derived.source,authority:context.authority,sourceEnvelope:context.sourceEnvelope,sourceCatalog:context.sourceCatalog,sourceBindings:context.sourceBindings,operationKey:context.operationKey,publicKey:context.publicKey,targetCatalog:context.targetCatalog});need(same(after.stateProof,source.stateProof),'SOURCE_CHANGED','恢复时原完整状态改变');
 await u.atomicWrite(fs,journalFile,encodeOperation({...record,phase:'rolledback'},source.key),operationRoot);
 return {recovered:true,rolledBack:true,sourcePreserved:true,targetRetained:true,installationDir:derived.source};
}
async function launchEmployeeSlot170(context){
 const op=await loadOperation(context);need(['target-ready','committed'].includes(op.record.phase),'SLOT_RECOVERY_REQUIRED','仅准备完成或已提交的slot可进入真实启动验收');
 await context.revalidate();await context.closed(op.derived.source,op.derived.target);await verifyTarget(context,op);
 await context.launch(op.derived.target);
 return {started:true,completed:false,activated:false,healthRequired:true,installationDir:op.derived.target,role:'employee',version:'1.7.0'};
}
async function dispatchEmployeeSlot170(context,action){
 need(['prepare','launch','activate','recover','update'].includes(action),'BAD_SLOT_ACTION','员工slot操作无效');
 need(exact(context.request,['installationDir']),'BAD_SLOT_REQUEST','slot只接收原已核位置');
 const d=deriveEmployeeSlot170({local:context.authority.local,sourceInstallationDir:context.request.installationDir,targetCatalogSha256:context.publication.engineTreeSha256,sourceCatalogSha256:digest(Buffer.from(context.sourceEnvelope.catalog)),sourceAuthority:context.sourceAuthority});
 await context.closed(d.source,...(['activate','update'].includes(action)?[]:[d.target]));
 // Complete source proof precedes even the short-lived execution-lock write.
 const source=await inspectSource170({install:d.source,authority:context.authority,sourceEnvelope:context.sourceEnvelope,sourceCatalog:context.sourceCatalog,sourceBindings:context.sourceBindings,operationKey:context.operationKey,publicKey:context.publicKey,targetCatalog:context.targetCatalog});
 await context.acl([d.parent,source.install,source.state,source.profile]);
 const file=path.join(d.parent,'.employee-slot170-execution.lock');let old;
 try{old=await u.readSmall(fs,file,8192);}catch(error){if(error.code!=='ENOENT')throw error;}
 if(old){const held=decodeOperation(old,source.key);need(exact(held,['version','purpose','pid','creationMarker','sourceIdentity','profileIdentity'])&&held.version===1&&held.purpose==='xjy-employee-slot-execution170'&&Number.isSafeInteger(held.pid)&&typeof held.creationMarker==='string'&&typeof held.sourceIdentity==='string'&&held.sourceIdentity.length>0&&held.profileIdentity===source.profileIdentity,'BAD_SLOT_LOCK','slot执行锁不属于当前默认anchor/profile');need(await context.isAssistantAlive(held)===false,'BUSY','原slot受信助手仍在运行，不并发恢复或切换');need((await u.readSmall(fs,file,8192)).equals(old),'BAD_SLOT_LOCK','slot旧执行锁改变');await fs.unlink(file);}
 const current=await context.currentAssistant(),owner={version:1,purpose:'xjy-employee-slot-execution170',pid:current.pid,creationMarker:current.creationMarker,sourceIdentity:source.installIdentity,profileIdentity:source.profileIdentity},bytes=encodeOperation(owner,source.key),opened=await u.openChecked(fs,file,'wx+',{missing:true,root:d.parent});
 try{await u.writeExactly(opened.handle,0,bytes);await opened.handle.sync();await u.assertHandle(fs,opened,{snapshot:false,root:d.parent});}finally{await opened.handle.close();}
 try{
  if(action==='update'){
   const journal=path.join(context.authority.local,'鑫金源珠宝安装','employee-slot-'+context.publication.engineTreeSha256,'journal.json');
   const priorBytes=await optionalBytes(journal,1048576);
   if(priorBytes===null){
    const sourceLock=path.join(d.parent,'.employee-slot170.lock'),oldLock=await optionalBytes(sourceLock,8192);
    if(oldLock&&!await retireCommittedSourceLock170(context,source,sourceLock)){
     const owner=decodeOperation(oldLock,source.key);need(exact(owner,['version','purpose','sourceIdentity','profileIdentity','targetCatalogSha256','operationId'])&&owner.version===1&&owner.purpose==='xjy-employee-slot-lock170'&&owner.sourceIdentity===source.installIdentity&&owner.profileIdentity===source.profileIdentity&&owner.targetCatalogSha256===context.publication.engineTreeSha256&&u.UUID.test(owner.operationId||''),'BAD_SLOT_LOCK','旧源锁不是本批已认证员工slot');
     const archive=path.dirname(journal)+'-aborted-'+owner.operationId,archived=decodeOperation(await u.readSmall(fs,path.join(archive,'journal.json'),1048576),source.key);
     need(archived.version===1&&archived.purpose==='xjy-employee-slot170'&&archived.phase==='rolledback'&&!archived.switch&&archived.operationId===owner.operationId&&archived.publicationId===context.publication.publicationId&&archived.sourceInstallationIdentity===source.installIdentity&&same(archived.sourceStateProof,source.stateProof)&&u.samePath(archived.sourceInstallationDir,d.source)&&u.samePath(archived.targetInstallationDir,d.target)&&archived.sourceCatalogSha256===digest(Buffer.from(context.sourceEnvelope.catalog))&&archived.targetCatalogSha256===context.publication.engineTreeSha256&&archived.profileIdentity===source.profileIdentity&&u.samePath(archived.profileDir,source.profile)&&archived.role==='employee'&&archived.osUser===context.authority.osUser&&archived.namespace===startup.namespace(),'SLOT_RECOVERY_REQUIRED','无主事务源锁缺少已认证回退归档，保持现场');
     for(const target of[d.target,startup.stateDirectory(d.target)]){try{await fs.lstat(target);u.fail('SLOT_RECOVERY_REQUIRED','回退归档后目标目录重新出现，不重建');}catch(error){if(error.code!=='ENOENT')throw error;}}
     need((await u.readSmall(fs,sourceLock,8192)).equals(oldLock),'BAD_SLOT_LOCK','回退归档源锁变化');await fs.unlink(sourceLock);
    }
   }
   if(priorBytes){
    const prior=await loadOperation(context);
    if(prior.record.phase==='rolledback'){
     await context.closed(d.source,d.target);
     if(prior.record.switch){
      await verifyTarget(context,prior);context.physicalIdentityOfTarget=await context.physicalIdentity(d.target);const previous=validateSwitch(prior.record.switch,context,prior);
      need(await bytesEqual(prior.record.switch.hintFile,previous.beforeHint,8192)&&await bytesEqual(prior.record.switch.shortcutFile,previous.beforeShortcut,65536),'SLOT_LOCATION_CHANGED','回退后的原位置又有变化，不自动重试切换');
      const history=path.join(prior.operationRoot,'rollback-history-'+prior.record.operationId+'.json'),old=await optionalBytes(history,1048576);if(old)need(old.equals(priorBytes),'SLOT_HISTORY_CONFLICT','原回退历史不同，不覆盖');else{const out=await u.openChecked(fs,history,'wx+',{missing:true,root:prior.operationRoot});try{await u.writeExactly(out.handle,0,priorBytes);await out.handle.sync();await u.assertHandle(fs,out,{snapshot:false,root:prior.operationRoot});}finally{await out.handle.close();}}
      await u.atomicWrite(fs,journal,encodeOperation({...prior.record,phase:'target-ready'},source.key),prior.operationRoot);
     }else{
      for(const target of[d.target,startup.stateDirectory(d.target)]){try{await fs.lstat(target);u.fail('SLOT_RECOVERY_REQUIRED','已清理回退目录再次出现，保持现场');}catch(error){if(error.code!=='ENOENT')throw error;}}
      const archive=prior.operationRoot+'-aborted-'+prior.record.operationId;need(u.samePath(path.dirname(archive),path.dirname(prior.operationRoot)),'BAD_SLOT_JOURNAL','slot回退归档路径越界');
      try{await fs.lstat(archive);u.fail('SLOT_HISTORY_CONFLICT','slot回退归档已存在，保持现场');}catch(error){if(error.code!=='ENOENT')throw error;}
      const lockBytes=await u.readSmall(fs,prior.lockFile,8192);need(decodeOperation(lockBytes,source.key).operationId===prior.record.operationId,'BAD_SLOT_LOCK','回退源锁已变化');
      // Preserve the authenticated failed operation, then release only its exact
      // source lock. Neither source program nor source engine-state is moved.
      await fs.rename(prior.operationRoot,archive);need((await u.readSmall(fs,prior.lockFile,8192)).equals(lockBytes),'BAD_SLOT_LOCK','回退归档期间源锁改变');await fs.unlink(prior.lockFile);
     }
    }
   }
   if(await optionalBytes(journal,1048576)===null)await prepareEmployeeSlot170(context);
   const operation=await loadOperation(context);need(['target-ready','committed'].includes(operation.record.phase),'SLOT_RECOVERY_REQUIRED','slot有未完成位置切换，先正常退出新程序再认证恢复');
   let healthy=false;try{await context.health(d.target);healthy=true;}catch(error){if(!['SLOT_HEALTH_UNCERTAIN','SLOT_WINDOWS_REFUSED'].includes(error.code))throw error;}
   if(!healthy){await launchEmployeeSlot170(context);const deadline=Date.now()+15000;while(Date.now()<deadline){try{await context.health(d.target);healthy=true;break;}catch(error){if(!['SLOT_HEALTH_UNCERTAIN','SLOT_WINDOWS_REFUSED'].includes(error.code))throw error;await new Promise(resolve=>setTimeout(resolve,250));}}}
   if(!healthy)return {completed:false,activated:false,started:true,healthRequired:true,installationDir:d.target,sourcePreserved:true,reason:'TARGET_WINDOW_UNCONFIRMED'};
   return activateEmployeeSlot170(context);
  }
  return await ({prepare:prepareEmployeeSlot170,launch:launchEmployeeSlot170,activate:activateEmployeeSlot170,recover:recoverEmployeeSlot170})[action](context);
 }
 finally{need(u.statIdentity(await u.assertPath(fs,file,{root:d.parent}))===opened.identity&&(await u.readSmall(fs,file,8192)).equals(bytes),'BAD_SLOT_LOCK','slot执行锁不再属于本助手，保持现场');await fs.unlink(file);}
}

module.exports={SOURCE,PUBLISHER,deriveEmployeeSlot170,authenticateFreshSourceState170,authenticateCommittedFullSourceState170,inspectSource170,encodeOperation,decodeOperation,prepareEmployeeSlot170,activateEmployeeSlot170,recoverEmployeeSlot170,dispatchEmployeeSlot170,removeOwnedUnactivatedTarget,createOutputStage170,createOutputAttempt170,validOutputAttemptPath170,writeOutputStage170,publishOutputStage170,outputMatches170,discardOutputStage170};

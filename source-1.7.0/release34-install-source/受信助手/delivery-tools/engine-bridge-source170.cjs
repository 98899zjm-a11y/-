'use strict';
// Reuses the original employee updater's authenticated committed journal. It
// never creates a key, signature, approval, marker, database or source record.
const native=process.versions.electron?require('original-fs'):require('node:fs'),fs=native.promises,path=require('node:path'),crypto=require('node:crypto');
const u=require('../project/desktop/employee-update-cache.cjs'),core=require('./initial-patch-core.cjs');
const PURPOSE='xjy-engine-bridge-handoff170',ACK='xjy-engine-bridge-accepted170',STATE='.xjy-employee-updates',MARKER='xjy-install-activation.json';
const SHA=/^[a-f0-9]{64}$/,OLD=['1.6.0','1.6.1','1.6.2'];
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===keys.length&&Object.keys(o).every(k=>keys.includes(k));
const fail=(code,message)=>{throw Object.assign(Error(message),{code});};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const equalPath=(a,b)=>typeof a==='string'&&typeof b==='string'&&u.samePath(a,b);
const rows=files=>files.map(({path:name,size,sha256})=>({path:name,size,sha256})).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
const digestRows=files=>u.digest(Buffer.from(rows(files).map(f=>f.path+'\0'+f.size+'\0'+f.sha256+'\n').join('')));
function parse(raw,code='BAD_BRIDGE_PROOF'){try{return JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(raw));}catch{fail(code,'桥接证明不是完整UTF8 JSON');}}
function unpack(raw,key){
 const e=parse(raw);if(!exact(e,['payload','mac'])||typeof e.payload!=='string'||!SHA.test(e.mac||'')||!Buffer.isBuffer(key)||key.length!==32||!crypto.timingSafeEqual(crypto.createHmac('sha256',key).update(e.payload).digest(),Buffer.from(e.mac,'hex')))fail('BAD_BRIDGE_PROOF','原员工更新记录认证失败');
 return parse(Buffer.from(e.payload));
}
function allowedMutable(name){if(/(?:^|\/)(?:\.?cashier[^/]*\.json|restore-transaction\.json)$/i.test(name))return false;return name==='xjy-employee-recovery.json'||['.xjy-employee-updates/','.xjy-initial-upgrade/','.xjy-patches/','员工本地设置/'].some(prefix=>name.startsWith(prefix));}
function validateBridgeStage1(o){
 if(!o||typeof o!=='object')fail('BAD_BRIDGE_CONTEXT','桥接证明输入缺失');
 const c=o.context,a=o.actual;
 if(!exact(c,['installationDir','profileDir','expectedProfileDir','role','bridgeEntrySha256','publicationId','targetCatalogSha256'])||!exact(a,['program','entrySha256','engineVersion','activationBytes','files'])||!SHA.test(c.bridgeEntrySha256||'')||!SHA.test(c.publicationId||'')||!SHA.test(c.targetCatalogSha256||'')||!equalPath(c.profileDir,c.expectedProfileDir)||c.role!=='employee')fail('BAD_BRIDGE_CONTEXT','桥接必须绑定本机已核员工profile、入口和本次完整发布');
 const j=unpack(o.journalBytes,o.integrityKey),s=unpack(o.statusBytes,o.integrityKey),h=unpack(o.handoffBytes,o.integrityKey);
 const jk=['version','transactionId','installDir','phase','envelope','expectedVersion','oldFiles','activation','activationSha256'];
 const hk=['version','purpose','operationId','installationDir','profileDir','role','sourceVersion','bridgeCatalogSha256','publicationId','targetCatalogSha256'];
 if(!exact(j,jk)||j.version!==1||j.phase!=='committed'||!u.UUID.test(j.transactionId||'')||!OLD.includes(j.expectedVersion)||!equalPath(j.installDir,c.installationDir)||!Array.isArray(j.oldFiles)||!exact(s,['version','phase','transactionId','expectedVersion','targetVersion'])||s.version!==1||s.phase!=='committed'||s.transactionId!==j.transactionId||s.expectedVersion!==j.expectedVersion||s.targetVersion!=='1.7.0')fail('BRIDGE_NOT_COMMITTED','只有原helper已认证提交的170资源桥可自动续交');
 if(!exact(h,hk)||h.version!==1||h.purpose!==PURPOSE||h.operationId!==j.transactionId||h.role!=='employee'||!equalPath(h.installationDir,c.installationDir)||!equalPath(h.profileDir,c.profileDir)||h.sourceVersion!==j.expectedVersion||h.publicationId!==c.publicationId||h.targetCatalogSha256!==c.targetCatalogSha256||!exact(j.envelope,['catalog','signature'])||h.bridgeCatalogSha256!==u.digest(Buffer.from(j.envelope.catalog||'')))fail('BRIDGE_HANDOFF_MISMATCH','桥接交接不属于同一操作、目录、员工角色或完整目标');
 const old=o.oldBinding;
 if(!old||old.meta?.programVersion!==j.expectedVersion||old.meta.engineVersion!=='44.7.0'||u.digest(Buffer.from(old.envelope?.catalog||''))!==old.meta.catalogSha256)fail('BRIDGE_ORIGINAL_SOURCE_MISMATCH','原资源来源没有对应受审旧完整树');
 const policy=meta=>u.createTrustedUpdatePolicy({trustedPublicKey:o.publicKey,currentVersion:j.expectedVersion,allowedFiles:meta,platform:'win32',arch:'x64',now:o.now||Date.now});
 const original=u.verifySignedCatalog(old.envelope,policy(old.meta.allowedFiles),{allowExpired:true}),resources=original.files.filter(f=>f.path.startsWith('resources/')),engine=original.files.filter(f=>!f.path.startsWith('resources/'));
 if(original.version!==j.expectedVersion||engine.length!==72||!resources.some(f=>f.path==='resources/app.asar'))fail('BRIDGE_ORIGINAL_SOURCE_MISMATCH','原完整引擎72项或资源集合不完整');
 const bridge=u.verifySignedCatalog(j.envelope,policy(resources.map(f=>f.path)),{allowExpired:true});
 if(bridge.version!=='1.7.0'||bridge.files.length!==resources.length||!same(bridge.files.map(f=>f.path).sort(),resources.map(f=>f.path).sort())||j.oldFiles.length!==resources.length||new Set(j.oldFiles.map(f=>f.path)).size!==resources.length)fail('BAD_BRIDGE_CATALOG','桥必须沿原资源精确全集，不扩旧allowedFiles');
 for(const f of j.oldFiles){const oldRow=resources.find(r=>r.path===f.path);if(!exact(f,['path','existed','size','sha256','identity'])||f.existed!==true||!oldRow||f.size!==oldRow.size||f.sha256!==oldRow.sha256||typeof f.identity!=='string'||!f.identity)fail('BRIDGE_ORIGINAL_SOURCE_MISMATCH','原helper的旧资源备份身份与已签完整源不符');}
 if(typeof j.activation!=='string'||u.digest(Buffer.from(j.activation,'base64'))!==j.activationSha256)fail('BAD_BRIDGE_ACTIVATION','原安装身份备份不完整');
 const before=parse(Buffer.from(j.activation,'base64')),activation=parse(a.activationBytes),ak=['version','product','programVersion','role','installationDir'];
 for(const [v,version]of[[before,j.expectedVersion],[activation,'1.7.0']])if(!exact(v,ak)||v.version!==1||v.product!=='xjy-jewelry-offline'||v.programVersion!==version||v.role!=='employee'||!equalPath(v.installationDir,c.installationDir))fail('BAD_BRIDGE_ACTIVATION','桥不能变更原员工角色或目录');
 const asar=bridge.files.find(f=>f.path==='resources/app.asar');
 if(a.program?.name!=='xjy-jewelry-offline'||a.program.version!=='1.7.0'||a.program.main!=='release-entry.cjs'||a.entrySha256!==c.bridgeEntrySha256||a.engineVersion!=='44.7.0')fail('UNKNOWN170_SOURCE','当前170不是本次审定的无业务桥入口');
 const expected=rows([...engine,...bridge.files]),programNames=new Set(expected.map(f=>f.path)),actualProgram=rows(a.files.filter(f=>programNames.has(f.path)));
 if(!same(actualProgram,expected)||a.files.some(f=>!programNames.has(f.path)&&f.path!==MARKER&&!allowedMutable(f.path)))fail('BRIDGE_TREE_MISMATCH','桥的实际引擎/资源与两条已签来源不符或有未知文件');
 const marker=a.files.find(f=>f.path===MARKER);if(!marker||marker.size!==a.activationBytes.length||marker.sha256!==u.digest(a.activationBytes)||!asar)fail('BAD_BRIDGE_ACTIVATION','当前员工activation与实际树不符');
 const descriptor={version:1,kind:'authenticated-bridge-stage1',operationId:j.transactionId,installationDir:c.installationDir,profileDir:c.profileDir,role:'employee',originalVersion:j.expectedVersion,originalCatalogSha256:old.meta.catalogSha256,bridgeCatalogSha256:h.bridgeCatalogSha256,bridgeEntrySha256:c.bridgeEntrySha256,publicationId:c.publicationId,targetCatalogSha256:c.targetCatalogSha256,journalSha256:u.digest(o.journalBytes),statusSha256:u.digest(o.statusBytes),handoffSha256:u.digest(o.handoffBytes),programTreeSha256:digestRows(expected)};
 return u.freeze({kind:descriptor.kind,operationId:j.transactionId,descriptor,catalogSha256:u.digest(Buffer.from(JSON.stringify(descriptor))),programFiles:expected,mutableFiles:rows(a.files.filter(f=>!programNames.has(f.path)&&f.path!==MARKER)),sourceCatalog:{...bridge,files:expected},originalBinding:old,bridgeEnvelope:j.envelope,profileDir:c.profileDir,installationDir:c.installationDir});
}
async function readPackedEntry(file,entryName='release-entry.cjs'){
 const opened=await u.openChecked(fs,file,'r');
 try{const stat=await u.assertHandle(fs,opened),first=await u.readExactly(opened.handle,0,8),size=first.readUInt32LE(4);if(first.readUInt32LE(0)!==4||size<8||size>33554432||BigInt(8+size)>stat.size)fail('BAD_BRIDGE_ASAR','桥ASAR头错误');const header=await u.readExactly(opened.handle,8,size),tree=JSON.parse(header.subarray(8,8+header.readUInt32LE(4)));let item=tree;for(const part of entryName.split('/'))item=item?.files?.[part];if(!item||item.link||item.unpacked||!Number.isSafeInteger(item.size)||item.size<1||item.size>1048576||!/^(0|[1-9]\d*)$/.test(item.offset||''))fail('BAD_BRIDGE_ASAR','桥入口不是完整受核ASAR成员');const at=8+size+Number(item.offset);if(!Number.isSafeInteger(at)||BigInt(at+item.size)>stat.size)fail('BAD_BRIDGE_ASAR','桥入口偏移错误');const bytes=await u.readExactly(opened.handle,at,item.size);await u.assertHandle(fs,opened);return bytes;}finally{await opened.handle.close();}
}
async function inspectInstalledBridge(o){
 const install=u.safeAbsolute(o.sourceDirectory||o.installationDir),profile=u.safeAbsolute(o.profileReadDir||o.profileDir);
 if(!u.samePath(o.profileDir,o.expectedProfileDir))fail('BAD_BRIDGE_PROFILE','profile不属于本机已核员工目录');
 const before=await u.assertPath(fs,install,{directory:true}),profileBefore=await u.assertPath(fs,profile,{directory:true});
 const journalBytes=await u.readSmall(fs,path.join(install,STATE,'journal.json'),8388608),statusBytes=await u.readSmall(fs,path.join(install,STATE,'recovery-status.json'),4096),handoffBytes=await u.readSmall(fs,o.handoffFile,16384),integrityKey=await u.readSmall(fs,path.join(profile,'employee-update-cache/.native-integrity-key'),32);
 const actual={program:await core.packageIdentity(fs,path.join(install,'resources/app.asar'),install),entrySha256:u.digest(await readPackedEntry(path.join(install,'resources/app.asar'))),engineVersion:(await u.readSmall(fs,path.join(install,'version'),64)).toString('utf8').trim(),activationBytes:await u.readSmall(fs,path.join(install,MARKER),4096),files:(await core.inspectArtifactTree({artifactDir:install})).files};
 const result=validateBridgeStage1({context:{installationDir:o.installationDir,profileDir:o.profileDir,expectedProfileDir:o.expectedProfileDir,role:'employee',bridgeEntrySha256:o.bridgeEntrySha256,publicationId:o.publicationId,targetCatalogSha256:o.targetCatalogSha256},actual,journalBytes,statusBytes,handoffBytes,integrityKey,oldBinding:o.oldBinding,publicKey:o.publicKey,now:o.now});
 const originalJournal=unpack(journalBytes,integrityKey),originalBackup=path.join(install,STATE,originalJournal.transactionId,'backup');
 for(const row of originalJournal.oldFiles){const file=path.join(originalBackup,...row.path.split('/'));let info;try{await u.assertPath(fs,file,{root:originalBackup});info=await core.fileHash(fs,file,originalBackup);}catch(error){if(error.code!=='ENOENT')throw error;fail('BRIDGE_ORIGINAL_BACKUP_MISMATCH','原helper旧资源实际备份缺失，保留现场停止');}if(info.size!==row.size||info.sha256!==row.sha256)fail('BRIDGE_ORIGINAL_BACKUP_MISMATCH','原helper的旧资源实际备份已变化，保留现场停止');}
 if(u.statIdentity(await u.assertPath(fs,install,{directory:true}))!==u.statIdentity(before)||u.statIdentity(await u.assertPath(fs,profile,{directory:true}))!==u.statIdentity(profileBefore))fail('BRIDGE_CHANGED','桥或profile物理目录在核验期间变化');
 return result;
}
module.exports={validateBridgeStage1,inspectInstalledBridge,readPackedEntry,decodeAuthenticatedRecord:unpack,PURPOSE,ACK,STATE,allowedMutable,digestRows};

'use strict';
// Read-only adapter for the separately reviewed PowerShell GUI. No writes,
// business imports, subprocesses, SQLite or fixed-drive identity probes. Reads
// only the explicitly selected program, its role/recovery metadata and package.
const fs=process.versions.electron?require('original-fs').promises:require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),os=require('node:os');
const core=require('./approval-core-170.cjs'),archive=require('./approval-archive-170.cjs'),CHUNK=4194304;
function fail(code,message){const e=new Error(message);e.code=code;throw e;}
function exact(value,keys){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&Object.keys(value).every(key=>keys.includes(key));}
function parseBytes(bytes,max=2097152){if(!Buffer.isBuffer(bytes)||bytes.length>max)fail('BAD_METADATA','元数据字节或大小无效。');try{return JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(bytes));}catch{fail('BAD_METADATA','元数据必须是完整 UTF8 JSON。');}}
function sameWindowsPath(a,b){return typeof a==='string'&&typeof b==='string'&&path.win32.resolve(a).toLowerCase()===path.win32.resolve(b).toLowerCase();}
function validateActivationRecord(activation,{installationDir,installationIdentity,role,sourceVersion,operation='initial',legacyRoleConfirmation,osUser,profileMarkerValidated=false}={}){
 const IDENTITY=/^[a-f0-9]{8}:[a-f0-9]{16}$/i,SID=/^S-1-\d+(?:-\d+)+$/;
const keys=['version','product','programVersion','role','installationDir'];
 if(activation===null){
  const c=legacyRoleConfirmation;
  if(!exact(c,['confirmed','source','role','osUser','installationDir','installationIdentity','sourceVersion'])||c.confirmed!==true||!['explicit','employee-profile-marker'].includes(c.source)||c.role!==role||typeof osUser!=='string'||!SID.test(osUser)||c.osUser!==osUser||!core.plainWindowsDirectory(c.installationDir)||!sameWindowsPath(c.installationDir,installationDir)||!IDENTITY.test(installationIdentity||'')||!IDENTITY.test(c.installationIdentity||'')||c.installationIdentity.toLowerCase()!==installationIdentity.toLowerCase()||c.sourceVersion!==sourceVersion||!core.SOURCE_VERSIONS.includes(c.sourceVersion))fail('LEGACY_ROLE_CONFIRMATION_REQUIRED','旧版没有安装身份标记；必须对正确目录和角色作一次明确确认。');
  if(c.source==='employee-profile-marker'&&(role!=='employee'||profileMarkerValidated!==true))fail('LEGACY_ROLE_CONFIRMATION_REQUIRED','员工角色标记未能在本机用户资料中独立核验。');
  return true;
 }
 if(legacyRoleConfirmation!==undefined)fail('BAD_ACTIVATION','程序已有安装身份标记，不得用旧版角色确认覆盖。');
 if(!exact(activation,keys)||activation.version!==1||activation.product!=='xjy-jewelry-offline'||!['host','employee'].includes(activation.role)||activation.role!==role||!core.plainWindowsDirectory(activation.installationDir)||!sameWindowsPath(activation.installationDir,installationDir)||typeof activation.programVersion!=='string')fail('BAD_ACTIVATION','安装标记必须精确绑定产品、版本、角色和程序目录。');
 if(operation==='initial'&&activation.programVersion!==sourceVersion)fail('BAD_ACTIVATION','安装标记版本与实际旧程序不符。');
 if(operation==='reapprove-original'&&activation.programVersion!==core.TARGET_VERSION&&!core.SOURCE_VERSIONS.includes(activation.programVersion))fail('BAD_ACTIVATION','恢复记录中的安装版本不受支持。');
 return true;
}
const identity=s=>[s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs,s.nlink].map(String).join(':');
async function plain(file,{directory=false,missing=false}={}){
 if(typeof file!=='string'||!path.isAbsolute(file)||/^[\\/]{2}/.test(file)||/[\x00-\x1f"<>|?*]/.test(file)||file.slice(2).includes(':')||path.normalize(file)!==file||file.slice(path.parse(file).root.length).split(/[\\/]/).some(p=>!p||p==='.'||p==='..'||/[. ]$/.test(p)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))fail('UNSAFE_PATH','必须使用普通本机规范路径。');
 let result;for(let p=file;;p=path.dirname(p)){let s;try{s=await fs.lstat(p,{bigint:true});}catch(e){if(!(missing&&p===file&&e.code==='ENOENT'))throw e;}if(s){if(s.isSymbolicLink()||p!==file&&!s.isDirectory()||(await fs.realpath(p)).toLowerCase()!==p.toLowerCase())fail('UNSAFE_PATH','路径不能经过链接或重解析点。');if(p===file)result=s;}if(p===path.dirname(p))break;}
 if(result&&(directory?!result.isDirectory():!result.isFile()||result.nlink!==1n))fail('UNSAFE_PATH','文件必须是单链接普通文件。');return result;
}
async function openRead(file){const before=await plain(file),h=await fs.open(file,'r');try{const stat=await h.stat({bigint:true}),current=await plain(file);if(identity(stat)!==identity(before)||identity(current)!==identity(stat))fail('FILE_CHANGED','文件打开期间发生变化。');const source={size:Number(stat.size),read:async(at,n)=>{const b=Buffer.alloc(n);let done=0;while(done<n){const r=await h.read(b,done,n-done,at+done);if(!r.bytesRead)fail('INCOMPLETE_FILE','读取不完整。');done+=r.bytesRead;}return b;},check:async()=>{if(identity(await h.stat({bigint:true}))!==identity(stat)||identity(await plain(file))!==identity(stat))fail('FILE_CHANGED','文件读取期间发生变化。');},close:()=>h.close()};return source;}catch(e){await h.close();throw e;}}
async function digestSource(source){if(source.size>1073741824)fail('FILE_TOO_LARGE','单个输入超过安全限制。');const h=crypto.createHash('sha256');for(let at=0;at<source.size;at+=CHUNK)h.update(await source.read(at,Math.min(CHUNK,source.size-at)));await source.check();return{size:source.size,sha256:h.digest('hex')};}
async function fileInfo(file){const r=await openRead(file);try{return await digestSource(r);}finally{await r.close();}}
async function small(file,max=2097152){const r=await openRead(file);try{if(r.size>max)fail('BAD_METADATA','元数据过大。');const b=await r.read(0,r.size);await r.check();return b;}finally{await r.close();}}
async function inspectTree(root,zipFiles){await plain(root,{directory:true});const allowed=new Set(zipFiles.map(f=>f.path)),directories=new Set(),files=[];for(const n of allowed){const parts=n.split('/');while(parts.length>1){parts.pop();directories.add(parts.join('/'));}}async function walk(dir,relative=''){for(const n of(await fs.readdir(dir)).sort()){const name=relative+n;if(!core.safeRelative(name))fail('UNSAFE_PATH','补丁相对路径无效。');const f=path.join(dir,n),stat=await fs.lstat(f);if(stat.isDirectory()){if(!directories.has(name))fail('UNEXPECTED_FILE','解包目录含 ZIP 外目录；未读取其内容。');await plain(f,{directory:true});await walk(f,name+'/');}else{if(!allowed.has(name)||files.length>=8192)fail('UNEXPECTED_FILE','解包目录含 ZIP 外文件；未读取其内容。');files.push({path:name,...await fileInfo(f)});}}}await walk(root);return files;}
async function program(file){const r=await openRead(file);try{const pkg=await archive.readPackedIdentity(r),info=await digestSource(r);return{...pkg,...info};}finally{await r.close();}}
function physicalIdentity(stat){
 if(typeof stat?.dev!=='bigint'||typeof stat.ino!=='bigint'||stat.dev<0n||stat.dev>0xffffffffn||stat.ino<1n||stat.ino>0xffffffffffffffffn)fail('BAD_INSTALLATION_IDENTITY','无法核验所选目录的物理身份。');
 return stat.dev.toString(16).padStart(8,'0')+':'+stat.ino.toString(16).padStart(16,'0');
}
async function optionalSmall(file,max){try{return await small(file,max);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function legacyEmployeeMarker(installationDir){
 const name=(os.hostname()+'-'+os.userInfo().username).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,90);
 const profile=path.join(installationDir,'员工本地设置','员工客户端缓存',name);
 try{await plain(profile,{directory:true});}catch(e){if(e.code==='ENOENT')return false;throw e;}
 const raw=await optionalSmall(path.join(profile,'launch-role.json'),4096);if(raw===null)return false;
 const marker=parseBytes(raw,4096);if(!exact(marker,['version','role'])||marker.version!==1||marker.role!=='employee')fail('BAD_ROLE_MARKER','所选旧版程序的角色标记冲突或格式未知；请先核对。');
 return true;
}
const JOURNAL_KEYS=['version','transactionId','approvalId','treeSha256','sourcePolicySha256','installDir','osUser','role','sourceVersion','targetVersion','phase','oldFiles','activation','activationSha256','dataBackup'];
const ANCHOR_KEYS=['version','purpose','publicationId','installationDir','role','targetVersion','transactionId','phase','osUserNamespace'];
const STATUS_KEYS=['version','product','installationDir','role','targetVersion','transactionId','phase','osUserNamespace'];
function validateTransactionRecords({key,journalBytes,statusBytes,patchJournals={},installationDir,role,osUser,osUserNamespace}){
 const SHA=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
 const version=v=>typeof v==='string'&&/^1\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(v)&&v.split('.').every(n=>Number.isSafeInteger(Number(n)));
 const stop=()=>fail('RECOVERY_REQUIRED','现有升级恢复记录未知、不完整或绑定冲突；停止本次审定。');
 if(!Buffer.isBuffer(key)||key.length!==32||!patchJournals||typeof patchJournals!=='object'||Array.isArray(patchJournals)||Object.keys(patchJournals).length>256)stop();
 function unpack(bytes){let e;try{e=parseBytes(bytes);}catch(error){if(error.code==='BAD_METADATA')stop();throw error;}if(!exact(e,['payload','mac'])||typeof e.payload!=='string'||!SHA.test(e.mac||'')||!crypto.timingSafeEqual(crypto.createHmac('sha256',key).update(e.payload).digest(),Buffer.from(e.mac,'hex')))stop();try{return JSON.parse(e.payload);}catch(error){if(error instanceof SyntaxError)stop();throw error;}}
 function row(j){if(!exact(j,JOURNAL_KEYS)||j.version!==1||!UUID.test(j.transactionId||'')||!UUID.test(j.approvalId||'')||!SHA.test(j.treeSha256||'')||!SHA.test(j.sourcePolicySha256||'')||!core.plainWindowsDirectory(j.installDir)||!sameWindowsPath(j.installDir,installationDir)||j.role!==role||j.osUser!==osUser||!['prepared','mutating','committed','rolledback'].includes(j.phase)||!Array.isArray(j.oldFiles)||j.oldFiles.length>4096||!version(j.sourceVersion)||!version(j.targetVersion))stop();return j;}
 const j=unpack(journalBytes),s=unpack(statusBytes);
 if(!exact(s,STATUS_KEYS)||s.version!==1||s.product!=='xjy-jewelry-offline'||!core.plainWindowsDirectory(s.installationDir)||!sameWindowsPath(s.installationDir,installationDir)||s.role!==role||s.osUserNamespace!==osUserNamespace||!UUID.test(s.transactionId||''))stop();
 if(j.version===1)row(j);
 else if(!exact(j,ANCHOR_KEYS)||j.version!==2||j.purpose!=='xjy-repeat-program-patch'||!SHA.test(j.publicationId||'')||!core.plainWindowsDirectory(j.installationDir)||!sameWindowsPath(j.installationDir,installationDir)||j.role!==role||j.osUserNamespace!==osUserNamespace||!UUID.test(j.transactionId||'')||!['prepared','mutating','committed','rolledback'].includes(j.phase))stop();
 if(j.transactionId!==s.transactionId||j.targetVersion!==s.targetVersion||j.phase!==s.phase)stop();
 const patches=Object.entries(patchJournals).map(([publication,bytes])=>{if(!SHA.test(publication))stop();return{publication,...row(unpack(bytes))};});
 if(j.version===2&&!patches.some(p=>p.publication===j.publicationId&&p.transactionId===j.transactionId&&p.phase===j.phase&&p.targetVersion===j.targetVersion))stop();
 const pending=patches.filter(p=>['prepared','mutating'].includes(p.phase));if(pending.length>1||pending.length&&j.version===2&&pending[0].publication!==j.publicationId)stop();
 const owner=j.version===2?patches.find(p=>p.publication===j.publicationId):j,current=pending[0]||owner;
 return{transactionState:current.phase,transactionPublicationId:pending[0]?.publication||(j.version===2?j.publicationId:null),transactionApprovalId:current.approvalId||null,sourceVersion:current.sourceVersion||null,transactionTargetVersion:current.targetVersion};
}
async function readTransactionState(installationDir,role,osUser){
 const state=path.join(installationDir,'.xjy-initial-upgrade'),patchRoot=path.join(installationDir,'.xjy-patches');
 let present=true;try{await plain(state,{directory:true});}catch(e){if(e.code==='ENOENT')present=false;else throw e;}
 let patchesPresent=true;try{await plain(patchRoot,{directory:true});}catch(e){if(e.code==='ENOENT')patchesPresent=false;else throw e;}
 if(!present){if(patchesPresent)fail('RECOVERY_REQUIRED','补丁事务目录存在但原恢复门禁缺失；不会创建替代门禁。');return{transactionState:'none',transactionPublicationId:null,transactionApprovalId:null,sourceVersion:null,fingerprint:'none'};}
 let key,journalBytes,statusBytes;try{key=await small(path.join(state,'.journal-key'),32);journalBytes=await small(path.join(state,'journal.json'));statusBytes=await small(path.join(state,'recovery-status.json'),8192);}catch(e){if(e.code==='ENOENT')fail('RECOVERY_REQUIRED','恢复记录不完整；不会补造恢复记录。');throw e;}
 const patchJournals={};if(patchesPresent){const names=await fs.readdir(patchRoot);if(names.length>256)fail('RECOVERY_REQUIRED','历史补丁数量超过核验范围。');for(const name of names){if(!/^[a-f0-9]{64}$/.test(name))fail('RECOVERY_REQUIRED','补丁事务目录格式未知。');await plain(path.join(patchRoot,name),{directory:true});try{patchJournals[name]=await small(path.join(patchRoot,name,'journal.json'));}catch(e){if(e.code==='ENOENT')fail('RECOVERY_REQUIRED','补丁事务记录缺失。');throw e;}}}
 const value=validateTransactionRecords({key,journalBytes,statusBytes,patchJournals,installationDir,role,osUser,osUserNamespace:(os.hostname()+'\\'+os.userInfo().username).toLowerCase()});
 const fingerprint=crypto.createHash('sha256').update(key).update(journalBytes).update(statusBytes);for(const name of Object.keys(patchJournals).sort())fingerprint.update(name).update(patchJournals[name]);return{...value,fingerprint:fingerprint.digest('hex')};
}
async function runReadonlyReview(request){
 const requestKeys=['operation','archiveFile','artifactDir','executablePath','osUser','role','expectedArtifactSha256','expectedPublisherPublicKeySha256','verifiedPublisherName','previousApprovalBase64','legacyRoleConfirmation'];
 if(!request||typeof request!=='object'||Array.isArray(request)||Object.keys(request).some(k=>!requestKeys.includes(k))||!['initial','reapprove-original'].includes(request.operation)||typeof request.osUser!=='string'||!/^S-1-\d+(?:-\d+)+$/.test(request.osUser)||!['host','employee'].includes(request.role))fail('BAD_REQUEST','审定请求无效。');
 const zipFile=request.archiveFile,root=request.artifactDir,exe=request.executablePath;await plain(root,{directory:true});const installStat=await plain(path.dirname(exe),{directory:true}),installationIdentity=physicalIdentity(installStat);
 if(root.toLowerCase()===path.dirname(exe).toLowerCase()||path.relative(root,path.dirname(exe)).split(path.sep)[0]!=='..'&&!path.isAbsolute(path.relative(root,path.dirname(exe))))fail('UNSAFE_PATH','补丁目录不能包含正式程序目录。');
 const r=await openRead(zipFile);let zip;try{zip=await archive.inspectStoredZip(r);await r.check();}finally{await r.close();}
 const treeFiles=await inspectTree(root,zip.files),metadata={publicKeyPem:await small(path.join(root,'publisher-public.pem'),4096),catalogBytes:await small(path.join(root,'catalog-envelope.json')),policyBytes:await small(path.join(root,'source-policy-envelope.json'))};
 const installationDir=path.dirname(exe),transaction=await readTransactionState(installationDir,request.role,request.osUser);
 let previousApproval=null;if(request.previousApprovalBase64){const b=Buffer.from(request.previousApprovalBase64,'base64');if(b.length>8192)fail('BAD_REQUEST','原审定记录过大。');previousApproval=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(b));}
 const activationBytes=await optionalSmall(path.join(installationDir,'xjy-install-activation.json'),4096),activation=activationBytes===null?null:parseBytes(activationBytes,4096);
 if(activation!==null&&transaction.transactionState==='committed'&&activation.programVersion!==transaction.transactionTargetVersion||activation!==null&&transaction.transactionState==='rolledback'&&activation.programVersion!==transaction.sourceVersion)fail('RECOVERY_REQUIRED','完成或回退记录与当前安装版本不一致。');
 const pending=['prepared','mutating'].includes(transaction.transactionState),source=request.operation==='initial'||activation===null&&!pending?await program(path.join(installationDir,'resources','app.asar')):null;
 const sourceVersion=source?.version||transaction.sourceVersion;let confirmation=request.legacyRoleConfirmation,profileMarkerValidated=false;
 if(activation===null){profileMarkerValidated=await legacyEmployeeMarker(installationDir);if(profileMarkerValidated&&request.role!=='employee')fail('BAD_ROLE_MARKER','所选旧程序含员工角色标记，不能改为主机。');if(confirmation!==undefined){if(!exact(confirmation,['confirmed','source','role','osUser','installationDir','installationIdentity']))fail('LEGACY_ROLE_CONFIRMATION_REQUIRED','旧版角色确认字段无效。');confirmation={...confirmation,sourceVersion};}else if(profileMarkerValidated)confirmation={confirmed:true,source:'employee-profile-marker',role:'employee',osUser:request.osUser,installationDir,installationIdentity,sourceVersion};}
 validateActivationRecord(activation,{installationDir,installationIdentity,role:request.role,sourceVersion,operation:request.operation,osUser:request.osUser,legacyRoleConfirmation:confirmation,profileMarkerValidated});
 const options={operation:request.operation,now:Date.now(),approvalId:crypto.randomUUID(),independent:{artifactSha256:request.expectedArtifactSha256,publisherPublicKeySha256:request.expectedPublisherPublicKeySha256,verifiedPublisherName:request.verifiedPublisherName},archive:zip,treeFiles,metadata,installation:{installationDir,executableName:path.basename(exe),osUser:request.osUser,role:request.role,engine:await fileInfo(exe),source,activationMissing:activation===null,...transaction,target:await program(path.join(root,'payload','resources','app.asar'))},previousApproval};
 const result=core.review170PublicationApproval(options);if(result.executableName!==path.basename(exe))fail('ENGINE_MISMATCH','选定 EXE 文件名与已签名引擎策略不符。');if(!core.plainWindowsDirectory(result.record.installationDir))fail('UNSAFE_PATH','安装路径无效。');
 const activationAfter=await optionalSmall(path.join(installationDir,'xjy-install-activation.json'),4096);
 if(physicalIdentity(await plain(installationDir,{directory:true}))!==installationIdentity||(activationBytes===null?activationAfter!==null:activationAfter===null||!activationBytes.equals(activationAfter))||transaction.fingerprint!==(await readTransactionState(installationDir,request.role,request.osUser)).fingerprint||activation===null&&profileMarkerValidated!==await legacyEmployeeMarker(installationDir))fail('FILE_CHANGED','审定期间安装身份、角色或恢复记录发生变化。');
 return{...result,installationIdentity,sourceVersion:sourceVersion||activation?.programVersion,legacyRoleSource:activation===null?confirmation.source:null,requiresLegacyBootstrap:transaction.transactionState==='none',filePaths:treeFiles.map(f=>f.path)};
}
if(require.main===module){
 if(process.argv.length!==3||process.argv[2]!=='--review'||process.env.ELECTRON_RUN_AS_NODE!=='1'||process.env.XJY_INDEPENDENT_APPROVAL_REVIEW!=='1'||process.env.NODE_OPTIONS||process.env.NODE_PATH){process.stderr.write('仅由独立负责人审定界面启动。\n');process.exitCode=1;}else{
  const chunks=[];let length=0;process.stdin.on('data',b=>{length+=b.length;if(length>16384){process.stderr.write('审定请求过大。\n');process.exit(1);}chunks.push(b);});process.stdin.on('end',()=>Promise.resolve().then(()=>JSON.parse(Buffer.concat(chunks).toString('utf8'))).then(runReadonlyReview).then(result=>process.stdout.write(JSON.stringify(result)+'\n'),e=>{process.stderr.write((e.code||'REVIEW_FAILED')+' '+e.message+'\n');process.exitCode=1;}));
 }
}
module.exports={runReadonlyReview,validateActivationRecord,physicalIdentity,validateTransactionRecords,readTransactionState};


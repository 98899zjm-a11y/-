'use strict';
// Small authenticated startup decision only. No application/storage/database
// imports. The production caller supplies its compiled publisher public key.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const PUBLISHER='6e8b9cadb59aeb53f30d41f4471f70f644f0dfc7376ffb9d8a4c62defb98458c';
const PURPOSE='xjy-engine-startup-v1',DOMAIN='xjy-engine-startup-v1\0',STATUS='engine-startup-status.json',CATALOG='target-catalog-envelope.json';
const SHA=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&Object.keys(v).every(k=>keys.includes(k));
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
const namespace=()=> (os.hostname()+'\\'+os.userInfo().username).toLowerCase();
const identity=s=>[s.dev,s.ino,s.birthtimeNs??s.birthtimeMs].map(String).join(':');
function fail(code,message){throw Object.assign(Error(message),{code});}
let guestVerified=false;
function actualGuest(){
 if(guestVerified)return;
 const root=path.resolve(__dirname,'../..');
 if(process.platform!=='win32'||root.toLowerCase()!=='c:\\xjy-work\\xjy-web-stage1'||os.userInfo().username.toLowerCase()!=='wdagutilityaccount')fail('ISOLATION','真实离线Guest准入缺失。');
 for(const [rel,pin]of Object.entries({'stage1/sandbox-context.py':'09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249','stage1/validate-sandbox-context.py':'867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207'}))if(digest(small(fs,path.join(root,rel),65536))!==pin)fail('ISOLATION','原隔离工具已变化。');
 const python='C:/Python314/python.exe';if(digest(fs.readFileSync(python))!=='434b361fe0c5960d404974feed493db47f2603a1ace2574312104fbed0182c6f')fail('ISOLATION','公开隔离运行时已变化。');
 const proof=JSON.parse(require('node:child_process').execFileSync(python,['-I','-B','-S',path.join(root,'stage1/validate-sandbox-context.py')],{cwd:root,windowsHide:true,shell:false,encoding:'utf8',maxBuffer:65536}));
 if(proof.model!=='Virtual Machine'||proof.productionDrivePresent!==false||proof.nonLoopbackAddressCount!==0||proof.inputMarkerPresent!==true)fail('ISOLATION','真实离线Guest准入失败。');guestVerified=true;
}
function ordinary(io,value,directory=false){
 if(typeof value!=='string'||!path.isAbsolute(value)||/^[\\/]{2}|[\x00-\x1f"<>|?*]/.test(value)||process.platform==='win32'&&value.slice(2).includes(':')||value.slice(path.parse(value).root.length).split(/[\\/]/).some(x=>!x||x==='.'||x==='..'||/[. ]$/.test(x)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(x)))fail('UNSAFE_PATH','启动记录必须使用普通规范本机路径。');
 let result;for(let p=value;;p=path.dirname(p)){const s=io.lstatSync(p,{bigint:true});if(s.isSymbolicLink()||p!==value&&!s.isDirectory()||!same(io.realpathSync.native(p),p))fail('UNSAFE_PATH','启动记录不能使用链接、别名或重解析路径。');if(p===value){if(directory?!s.isDirectory():!s.isFile()||s.nlink!==1n)fail('UNSAFE_PATH','启动记录类型或链接数错误。');result=s;}if(p===path.dirname(p))break;}return result;
}
function small(io,file,max){
 const before=ordinary(io,file),fd=io.openSync(file,'r');
 try{const opened=io.fstatSync(fd,{bigint:true});if(opened.size<1n||opened.size>BigInt(max)||opened.nlink!==1n||identity(opened)!==identity(before))fail('FILE_CHANGED','启动记录大小或身份错误。');const bytes=io.readFileSync(fd),after=io.fstatSync(fd,{bigint:true}),live=ordinary(io,file);for(const k of ['dev','ino','size','mtimeNs','ctimeNs','nlink'])if(opened[k]!==after[k]||opened[k]!==live[k])fail('FILE_CHANGED','启动记录读取期间变化。');return bytes;}finally{io.closeSync(fd);}
}
function stateDirectory(installDir){
 // Only the unchanged, actual Guest proof permits the original file fixture
 // layout. No environment flag or caller-selected state path opens this branch.
 const fixtureBase=path.resolve(__dirname,'../../runtime/engine-tree-tests'),parent=path.dirname(installDir);
 if(same(path.dirname(parent),fixtureBase)&&/^case-[A-Za-z0-9_-]{1,80}$/.test(path.basename(parent))&&path.basename(installDir)==='program'){actualGuest();return path.join(parent,'engine-state');}
 return path.join(path.dirname(installDir),'.'+path.basename(installDir)+'.xjy-engine-state');
}
function envelope(payload,key){const body=JSON.stringify(payload);return Buffer.from(JSON.stringify({payload:body,mac:crypto.createHmac('sha256',key).update(DOMAIN).update(body).digest('hex')}));}
function decode(bytes,key){
 let e;try{e=JSON.parse(bytes);}catch{fail('BAD_STARTUP_RECEIPT','启动收据不是完整JSON。');}
 if(!exact(e,['payload','mac'])||typeof e.payload!=='string'||!SHA.test(e.mac||'')||!Buffer.isBuffer(key)||key.length!==32)fail('BAD_STARTUP_RECEIPT','启动收据或认证密钥格式错误。');
 if(!crypto.timingSafeEqual(crypto.createHmac('sha256',key).update(DOMAIN).update(e.payload).digest(),Buffer.from(e.mac,'hex')))fail('BAD_STARTUP_RECEIPT','启动收据认证失败。');
 try{return JSON.parse(e.payload);}catch{fail('BAD_STARTUP_RECEIPT','启动收据内容错误。');}
}
function readEngineStartupGate(options={}){
 const allowed=['installDir','programVersion','installedRole','trustedPublicKey','fileSystem'];let phase;
 try{
  if(!options||Object.keys(options).some(k=>!allowed.includes(k)))fail('BAD_STARTUP_OPTIONS','启动门只接受固定安装和发布参数。');
  const {installDir,programVersion,installedRole}=options,io=options.fileSystem||fs;
  if(io!==fs)actualGuest();
  if(programVersion!=='1.7.0'||!['host','employee'].includes(installedRole))fail('STARTUP_IDENTITY_REQUIRED','完整1.7安装身份或原角色缺失。');
  const install=ordinary(io,installDir,true),stateDir=stateDirectory(installDir),state=ordinary(io,stateDir,true);
  let supplied=options.trustedPublicKey;
  if(!supplied)supplied=require('./generated/release-pins.cjs').publisherPublicKey;
  const publicKey=supplied?.type==='public'?supplied:crypto.createPublicKey(supplied),publisher=digest(publicKey.export({type:'spki',format:'der'}));
  if(publicKey.asymmetricKeyType!=='ed25519')fail('BAD_PUBLIC_KEY','发行公钥类型错误。');
  if(publisher!==PUBLISHER)actualGuest();
  const key=small(io,path.join(stateDir,'journal-key.bin'),32);if(key.length!==32)fail('BAD_STARTUP_RECEIPT','启动认证密钥长度错误。');
  const r=decode(small(io,path.join(stateDir,STATUS),16384),key);phase=r?.phase;
  const keys=['version','purpose','transactionId','phase','rollbackForbidden','installationDir','installationIdentity','stateDir','stateIdentity','role','programVersion','engineVersion','catalogSha256','publisherPublicKeySha256','osUserNamespace','mode','journalSha256'];
  if(!exact(r,keys)||r.version!==1||r.purpose!==PURPOSE||!UUID.test(r.transactionId||'')||!['prepared','committed'].includes(r.phase)||typeof r.rollbackForbidden!=='boolean'||!same(r.installationDir,installDir)||!same(r.stateDir,stateDir)||r.stateIdentity!==identity(state)||r.role!==installedRole||r.programVersion!==programVersion||r.engineVersion!=='44.9.0'||r.publisherPublicKeySha256!==publisher||r.osUserNamespace!==namespace()||!['upgrade','fresh'].includes(r.mode)||!SHA.test(r.catalogSha256||'')||!SHA.test(r.journalSha256||''))fail('BAD_STARTUP_RECEIPT','启动收据与安装、角色、用户或发布不符。');
  if(r.phase!=='committed'||r.rollbackForbidden!==true)fail('ENGINE_RECOVERY_REQUIRED','完整程序尚未提交；业务资料未打开。');
  if(r.installationIdentity!==identity(install))fail('INSTALLATION_CHANGED','启动收据不属于此物理程序目录。');
  const journalBytes=small(io,path.join(stateDir,'journal.json'),16777216);if(digest(journalBytes)!==r.journalSha256)fail('JOURNAL_CHANGED','提交记录与启动收据不一致。');
  const j=JSON.parse(journalBytes);if(!exact(j,['payload','mac'])||!SHA.test(j.mac||'')||typeof j.payload!=='string'||!crypto.timingSafeEqual(crypto.createHmac('sha256',key).update(j.payload).digest(),Buffer.from(j.mac,'hex')))fail('BAD_JOURNAL','提交记录认证失败。');
  const record=JSON.parse(j.payload);if(record.transactionId!==r.transactionId||record.phase!=='committed'||record.rollbackForbidden!==true||record.targetVersion!==programVersion||record.role!==installedRole)fail('BAD_JOURNAL','提交记录未授权此目标启动。');
  const e=JSON.parse(small(io,path.join(stateDir,CATALOG),2097152));
  if(!exact(e,['catalog','signature'])||typeof e.catalog!=='string'||typeof e.signature!=='string'||digest(Buffer.from(e.catalog))!==r.catalogSha256||!crypto.verify(null,Buffer.from(e.catalog),publicKey,Buffer.from(e.signature,'base64')))fail('BAD_SIGNATURE','完整目标目录签名错误。');
  const catalog=JSON.parse(e.catalog);if(catalog.schemaVersion!==1||catalog.app!=='xjy-jewelry-offline'||catalog.version!==programVersion||catalog.platform!=='win32'||catalog.arch!=='x64'||!Array.isArray(catalog.files))fail('BAD_CATALOG','完整目标目录身份错误。');
  const version=small(io,path.join(installDir,'version'),64),spec=catalog.files.filter(x=>x.path==='version');if(spec.length!==1||spec[0].size!==version.length||spec[0].sha256!==digest(version)||version.toString('utf8').trim()!=='44.9.0')fail('BAD_ENGINE','启动引擎版本与签名不符。');
  const activation=JSON.parse(small(io,path.join(installDir,'xjy-install-activation.json'),4096));if(!exact(activation,['version','product','programVersion','role','installationDir'])||activation.version!==1||activation.product!=='xjy-jewelry-offline'||activation.programVersion!==programVersion||activation.role!==installedRole||!same(activation.installationDir,installDir))fail('BAD_ACTIVATION','安装角色记录与提交不符。');
  return{blocked:false,phase:'committed',committed:true,rollbackForbidden:true,role:installedRole,version:programVersion,transactionId:r.transactionId,mode:r.mode};
 }catch(error){return{blocked:true,phase:phase||'unknown',code:error.code||'ENGINE_STARTUP_BLOCKED',message:'完整升级启动收据无法核验：'+error.message+' 请重新打开已审定完整安装器恢复，业务资料尚未打开。'};}
}
module.exports={readEngineStartupGate,stateDirectory,envelope,decode,PURPOSE,STATUS,CATALOG,namespace,identity,actualGuest};

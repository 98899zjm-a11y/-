'use strict';
// Pure verifier shared by the employee main and Host distribution. No filesystem,
// network, process, database, mutable state or bundled-key self trust.
const crypto=require('node:crypto');
const PUBLISHER='6e8b9cadb59aeb53f30d41f4471f70f644f0dfc7376ffb9d8a4c62defb98458c';
const SHA=/^[a-f0-9]{64}$/,MAX_ARCHIVE=1610612736,MAX_EXPANDED=3221225472;
const BOOTSTRAP='安装组件/native-delivery-170.ps1',BINDING='engine-native170-binding.json',WORKER='受信助手/鑫金源珠宝报价.exe';
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
function fail(code,message){throw Object.assign(Error(message),{code});}
function freeze(v){if(v&&typeof v==='object'){Object.freeze(v);for(const c of Object.values(v))freeze(c);}return v;}
function safeRelative(v){return typeof v==='string'&&v.length>0&&v.length<=240&&!/[\\:*?"<>|\x00-\x1f]/.test(v)&&!v.startsWith('/')&&v.split('/').every(p=>p&&p!=='.'&&p!=='..'&&!/[. ]$/.test(p)&&!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p));}
const u={digest:b=>crypto.createHash('sha256').update(b).digest('hex'),freeze,safeRelative};
function publisherKey(pem){const key=pem?.type==='public'?pem:crypto.createPublicKey(pem);if(key.asymmetricKeyType!=='ed25519'||u.digest(key.export({format:'der',type:'spki'}))!==PUBLISHER)fail('BAD_PUBLIC_KEY','原生更新发行公钥不符');return key;}
function validateManifestPayload(m,now=Date.now()){
 const keys=['schemaVersion','purpose','app','platform','arch','role','targetVersion','engineVersion','sequence','publishedAt','expiresAt','fullTargetCatalogSha256','bindingSha256','archive','files'];
 if(!exact(m,keys)||m.schemaVersion!==1||m.purpose!=='xjy-native-employee-update-v1'||m.app!=='xjy-jewelry-offline'||m.platform!=='win32'||m.arch!=='x64'||m.role!=='employee'||m.targetVersion!=='1.7.0'||m.engineVersion!=='44.9.0'||!Number.isSafeInteger(m.sequence)||m.sequence<1||!SHA.test(m.fullTargetCatalogSha256||'')||!SHA.test(m.bindingSha256||''))fail('BAD_NATIVE_MANIFEST','原生员工更新身份不符');
 const published=Date.parse(m.publishedAt),expires=Date.parse(m.expiresAt);if(typeof m.publishedAt!=='string'||typeof m.expiresAt!=='string'||!Number.isFinite(published)||!Number.isFinite(expires)||published>now+300000||expires<=now||expires<=published)fail('EXPIRED_NATIVE_MANIFEST','原生更新清单已过期或时间无效');
 if(!exact(m.archive,['size','sha256'])||!Number.isSafeInteger(m.archive.size)||m.archive.size<22||m.archive.size>MAX_ARCHIVE||!SHA.test(m.archive.sha256||'')||!Array.isArray(m.files)||!m.files.length||m.files.length>8192)fail('BAD_NATIVE_MANIFEST','完整包大小或清单不符');
 const names=new Set();let total=0;for(const f of m.files){if(!exact(f,['path','size','sha256'])||!u.safeRelative(f.path)||names.has(f.path.toLowerCase())||!Number.isSafeInteger(f.size)||f.size<0||f.size>MAX_ARCHIVE||!SHA.test(f.sha256||''))fail('BAD_NATIVE_MANIFEST','完整包包含不规范、重复或未知文件');names.add(f.path.toLowerCase());total+=f.size;}
 if(total>MAX_EXPANDED)fail('BAD_NATIVE_MANIFEST','完整包展开大小超限');
 for(const n of [BOOTSTRAP,BINDING,WORKER,'受信助手/delivery-tools/engine-native-entry170.cjs','delivery-tools/XjyWorkerResult.ps1'])if(!m.files.some(f=>f.path===n))fail('BAD_NATIVE_MANIFEST','缺少固定受信维护入口');
 const worker=m.files.find(f=>f.path===WORKER);if(worker.size!==246302720||worker.sha256!=='db3ad2066a55546f9b6737da3c7f011370e4856fb36888055b544d45653e4f40')fail('BAD_NATIVE_MANIFEST','外置维护引擎必须是固定44.7.0构建');
 const binding=m.files.find(f=>f.path===BINDING);if(binding.sha256!==m.bindingSha256)fail('BAD_NATIVE_MANIFEST','固定绑定文件摘要不符');return u.freeze(m);
}
function verifyNativeManifest(envelope,options){
 if(!options||Object.keys(options).some(k=>!['publicKey','now','minimumSequence','installedCatalogSha256'].includes(k)))fail('BAD_NATIVE_OPTIONS','原生清单核验参数无效');
 const now=typeof options.now==='function'?options.now():options.now===undefined?Date.now():options.now,minimum=options.minimumSequence===undefined?0:options.minimumSequence;
 if(!Number.isFinite(now)||!Number.isSafeInteger(minimum)||minimum<0||options.installedCatalogSha256!==undefined&&!SHA.test(options.installedCatalogSha256))fail('BAD_NATIVE_OPTIONS','时间、序号或已装发布身份无效');
 if(!exact(envelope,['manifest','signature'])||typeof envelope.manifest!=='string'||Buffer.byteLength(envelope.manifest)>2097152||typeof envelope.signature!=='string'||!/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature))fail('BAD_NATIVE_SIGNATURE','原生更新签名包装不符');
 const pub=publisherKey(options.publicKey),signature=Buffer.from(envelope.signature,'base64');if(signature.length!==64||signature.toString('base64')!==envelope.signature||!crypto.verify(null,Buffer.from(envelope.manifest),pub,signature))fail('BAD_NATIVE_SIGNATURE','原生更新签名无效');
 let m;try{m=JSON.parse(envelope.manifest);}catch{fail('BAD_NATIVE_MANIFEST','原生更新清单不是JSON');}const manifest=validateManifestPayload(m,now);if(manifest.sequence<minimum)fail('STALE_NATIVE_MANIFEST','原生清单序号已被取代');return manifest;
}
function publicationDecision(manifest,installed,highWater=0){
 if(!installed||!Number.isSafeInteger(installed.sequence)||!SHA.test(installed.fullTargetCatalogSha256||''))fail('NATIVE_SOURCE_UNVERIFIED','当前完整安装收据未核验');
 if(manifest.sequence<installed.sequence||manifest.sequence<highWater)fail('STALE_NATIVE_MANIFEST','该原生发布已被较新的发布取代');
 if(manifest.fullTargetCatalogSha256===installed.fullTargetCatalogSha256){if(manifest.sequence!==installed.sequence)fail('BAD_NATIVE_MANIFEST','目标目录与发布序号矛盾');return'latest';}
 if(manifest.sequence<=installed.sequence)fail('STALE_NATIVE_MANIFEST','同一发布序号不能替换完整程序');return'available';
}
module.exports={verifyNativeManifest,validateManifestPayload,publicationDecision,publisherKey,MAX_ARCHIVE,MAX_EXPANDED,BOOTSTRAP,BINDING,WORKER};

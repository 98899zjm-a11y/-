'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {requireHostAdmission,createOwnedPathGuard}=require('./managed-print-worker.cjs');
async function createReleaseHostServices(options){
 const {storage,admission,assertAdmission,getNetwork,helperPins}=options;requireHostAdmission(admission,assertAdmission);
 const guard=createOwnedPathGuard(storage.root),file=guard.check(path.join(storage.profileDir,'business-maintenance-owner.json'));let identity,provisionOwner=false;
 if(fs.existsSync(file)){
  const stat=fs.lstatSync(file);if(!stat.isFile()||stat.nlink!==1||stat.size>8192)throw Error('主机备份身份记录无效');identity=JSON.parse(fs.readFileSync(file,'utf8'));
  if(identity.version!==1||Object.keys(identity).some(k=>!['version','hostId','profileId'].includes(k))||typeof identity.hostId!=='string'||typeof identity.profileId!=='string')throw Error('主机备份身份记录无效');
 }else{identity={hostId:crypto.randomUUID(),profileId:'desktop-profile'};provisionOwner=true;}
 const updateServices=helperPins?()=>{
  const resources=(options.updateFactory||require('./update-distribution.cjs').createUpdateDistribution)({catalogFile:guard.check(path.join(storage.profileDir,'员工升级','catalog.json')),archiveFile:guard.check(path.join(storage.profileDir,'员工升级','package.zip')),trustedPublicKey:helperPins.publisherPublicKey,allowedFiles:helperPins.allowedFiles,platform:'win32',arch:'x64'});
  let native;
  try{native=(options.nativeUpdateFactory||require('./native-update-distribution.cjs').createNativeUpdateDistribution)({manifestFile:guard.check(path.join(storage.profileDir,'员工升级','native-manifest.json')),archiveFile:guard.check(path.join(storage.profileDir,'员工升级','native-package.zip')),trustedPublicKey:helperPins.publisherPublicKey});if(!native||native.then||['getNativeManifest','getNativeChunk','close'].some(name=>typeof native[name]!=='function'))throw new TypeError('A ready fixed native distributor is required');}
  catch(error){Promise.resolve().then(()=>resources.close?.()).catch(()=>{});Promise.resolve().then(()=>native?.close?.()).catch(()=>{});throw error;}
  return{getCatalog:(...args)=>resources.getCatalog(...args),getChunk:(...args)=>resources.getChunk(...args),getNativeManifest:()=>native.getNativeManifest(),getNativeChunk:input=>native.getNativeChunk(input),close:async()=>{const results=await Promise.allSettled([Promise.resolve().then(()=>resources.close?.()),Promise.resolve().then(()=>native.close())]);const failed=results.find(r=>r.status==='rejected');if(failed)throw failed.reason;}};
 }:undefined;
 const ocrServiceFactory=async()=>{
  const ocr=require('./ocr.cjs'),run=ocr.createWinRtRunner({script:path.join(options.resourcesDir,'app.asar.unpacked','ocr.winrt.ps1')}),controller=ocr.createOcrController({run,timeoutMs:25000}),token=crypto.randomBytes(48).toString('base64url'),broker=ocr.createOcrBroker({controller,token});
  try{const address=await broker.listen();return{port:address.port,token,close:()=>broker.close()};}catch(error){await broker.close();throw error;}
 };
 return (options.runtimeFactory||require('./desktop-host-runtime.cjs').createDesktopHostRuntime)({storage,admission,assertAdmission,appVersion:options.appVersion,codeDir:options.codeDir,resourcesDir:options.resourcesDir,executable:options.executablePath,isPackaged:options.isPackaged,hostId:identity.hostId,profileId:identity.profileId,provisionOwner,port:42831,printerSettings:options.printerSettings,ocrServiceFactory,updateServices,
  getLocalActor:b=>b.auth.status().user,isLocal:()=>{try{getNetwork().assertLocal();return true;}catch{return false;}},withNetworkFrozen:action=>{const network=getNetwork();if(!network||typeof network.withFrozen!=='function')throw Error('主机连接服务尚未就绪');return network.withFrozen(action);},onBackendReplaced:options.onBackendReplaced,onSessionsInvalidated:options.onSessionsInvalidated});
}
module.exports={createReleaseHostServices};

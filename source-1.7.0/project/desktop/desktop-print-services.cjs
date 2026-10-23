'use strict';
const fs=require('node:fs'),path=require('node:path');
const {createPrintRouting}=require('./print-routing.cjs');
const {createPrintComposition,toAgentPresentation}=require('./print-composition.cjs');
const DEFAULT_WARRANTY='\\\\192.168.1.196\\EPSON LQ-630K ESC/P2',DEFAULT_A4='Deli M2500ADW-35J04Y(WLAN)';
function createDesktopPrintServices({routingFile,printerSettings,worker,moduleAdapter,reauthorizeManage,auditRouting}){
 if(typeof routingFile!=='string'||!path.isAbsolute(routingFile)||!printerSettings||typeof printerSettings.read!=='function'||!worker||typeof worker.getDevices!=='function'||typeof worker.print!=='function'||typeof reauthorizeManage!=='function'||typeof auditRouting!=='function')throw new TypeError('Explicit trusted desktop printing dependencies required');
 // These are exact queues already selected by the owner, not fuzzy guesses or
 // Windows default-printer changes. Enumeration still decides availability.
 if(!fs.existsSync(routingFile)){
  for(let p=path.dirname(routingFile);;p=path.dirname(p)){if(fs.existsSync(p)&&fs.lstatSync(p).isSymbolicLink())throw Error('打印配置目录不能使用链接');if(p===path.dirname(p))break;}
  const setting=printerSettings.read(),bytes=JSON.stringify({version:1,revision:0,warrantyDeviceName:setting.deviceName||DEFAULT_WARRANTY,a4DeviceName:DEFAULT_A4,history:[]});
  fs.writeFileSync(routingFile,bytes,{flag:'wx',mode:0o600});
 }
 const routing=createPrintRouting({file:routingFile,enumerate:()=>worker.getDevices(),audit:auditRouting,reauthorizeManage,legacySettingsProvider:()=>printerSettings.read(),warrantySettingsProvider:()=>printerSettings.read()});
 const factory=({runtime,core,getSalesOrder,administration,loadActor})=>{
  const composition=createPrintComposition({routing,enumerate:()=>worker.getDevices(),defaultsProvider:()=>{const p=printerSettings.read();return{phone:p.phone||'',standard:'',afterSalesWechat:p.afterSalesWechat||''};},core,getSalesOrder,moduleAdapter,loadActor,withIdentity:runtime.withIdentity.bind(runtime),
   authorizeSource:(actor,rule)=>{administration.requireAccess(actor,rule.module,'operate');for(const capability of rule.capabilities||[])administration.requireCapability(actor,capability,{readOnly:true});return true;},
   authorizeModule:(actor,scope)=>{administration.requireAccess(actor,scope.module,'operate');return{moduleAccess:actor.moduleAccess,capabilities:actor.capabilities};}});
  return{...composition,sources:require('./print-asset-source-wrapper.cjs').wrapPrintAssetSources(composition.sources),agent:worker,capturePresentation:(kind,value,route,copies)=>toAgentPresentation(kind,value,{settings:printerSettings.read(),route,copies}),retainedFile:path.resolve(runtime.dataDir)+'.central-print-ledger.json',legacyRetainedFile:path.resolve(runtime.dataDir)+'.print-ledger.json',legacyMetadataFile:path.resolve(runtime.dataDir)+'.print-ledger.metadata.json'};
 };
 factory.routing=routing;return factory;
}
module.exports={createDesktopPrintServices};

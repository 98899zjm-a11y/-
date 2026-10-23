'use strict';
function createModuleOcrLifecycle({factory}={}){
 if(factory!==undefined&&typeof factory!=='function')throw TypeError('OCR service factory must be trusted code');
 let service,opening,closed=false,closing;
 async function start(){
  if(closed)throw Error('识别服务正在关闭');
  if(!opening)opening=Promise.resolve().then(factory).then(async result=>{
   if(!result||!Number.isInteger(result.port)||result.port<1024||result.port>65535||result.port===31831||typeof result.token!=='string'||Buffer.byteLength(result.token)<32||Buffer.byteLength(result.token)>512||typeof result.close!=='function'){
    if(result&&typeof result.close==='function')await result.close();throw Error('本地识别端口或私有配置无效');
   }
   service=result;if(closed)throw Error('识别服务正在关闭');return result;
  });
  return opening;
 }
 return{async environment(module,original){
  const env=Object.fromEntries(Object.entries(original).filter(([key])=>!['XJY_MODULE_OCR_PORT','XJY_MODULE_OCR_TOKEN'].includes(key.toUpperCase())));
  if(module!=='ledger'||!factory)return env;const current=await start();return{...env,XJY_MODULE_OCR_PORT:String(current.port),XJY_MODULE_OCR_TOKEN:current.token};
 },close(){if(!closing)closing=(async()=>{closed=true;if(opening)await opening.catch(()=>{});if(service){const current=service;service=null;await current.close();}})();return closing;}};
}
module.exports={createModuleOcrLifecycle};

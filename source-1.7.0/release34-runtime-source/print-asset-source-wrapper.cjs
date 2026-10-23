'use strict';
const {serializePrintValue}=require('./print-agent.cjs');
function wrapPrintAssetSources(base,{prepareAssets,fixedRegistry}={}){
 if(typeof base?.prepare!=='function'||typeof base?.revalidate!=='function')throw TypeError('Trusted original print source required');
 const transform=prepareAssets||((document)=>require('./print-source-assets.cjs').preparePrintAssets(document,fixedRegistry?{fixedRegistry}:{}));
 function original(prepared){
  const snapshot=prepared?.snapshot;if(!snapshot||snapshot.contentType!=='text/html'||typeof snapshot.bodyBase64!=='string')throw Object.assign(Error('原打印快照缺失，无法核验打印资产'),{status:409});
  return{...prepared,document:{...prepared.document,contentType:snapshot.contentType,bodyBase64:snapshot.bodyBase64}};
 }
 return Object.freeze({async prepare(actor,input){const value=await base.prepare(actor,input);if(value.document?.format!=='trusted-html')return value;return{...value,document:transform(value.document)};},async revalidate(actor,value){
  if(value?.document?.format!=='trusted-html')return base.revalidate(actor,value);
  const raw=original(value),expected=transform(raw.document);
  if(serializePrintValue(expected)!==serializePrintValue(value.document))throw Object.assign(Error('准备的打印资产已改变，请重新核对后打印'),{status:409});
  return base.revalidate(actor,raw);
 }});
}
module.exports={wrapPrintAssetSources};

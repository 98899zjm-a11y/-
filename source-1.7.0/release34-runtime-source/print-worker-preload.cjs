'use strict';
// Bundled into generated/print-worker-preload.cjs for Electron's sandboxed
// preload. No contextBridge API is exposed to document/page JavaScript.
const {ipcRenderer}=require('electron');
const {preparePassiveDocument}=require('./print-worker-passive-dom.cjs');
window.addEventListener('DOMContentLoaded',()=>{
  void (async()=>{const policy=await ipcRenderer.invoke('xjy-worker:policy');const result=await preparePassiveDocument(document,policy);await ipcRenderer.invoke('xjy-worker:ready',result);})().catch(e=>ipcRenderer.invoke('xjy-worker:ready',{ok:false,code:e.code||'PRINT_RENDER_ERROR',error:String(e.message||e).slice(0,800)}));
},{once:true});

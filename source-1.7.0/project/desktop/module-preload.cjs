'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('xjyModulePrint',Object.freeze({print:source=>ipcRenderer.invoke('jewelry:module-print',source===undefined?undefined:{source})}));
contextBridge.exposeInMainWorld('xjyModuleWorkspace',Object.freeze({request:input=>ipcRenderer.invoke('jewelry:module-workspace-request',input)}));
let activitySent=0;
for(const name of ['pointerdown','keydown','wheel','touchstart'])window.addEventListener(name,()=>{const now=Date.now();if(now-activitySent>=5000){activitySent=now;ipcRenderer.send('jewelry:module-activity');}},{capture:true,passive:true});
contextBridge.executeInMainWorld({func:()=>{window.print=()=>{void window.xjyModulePrint.print().then(result=>{if(!result?.ok&&result?.error)window.alert(result.error);}).catch(()=>window.alert('打印暂时未完成，请重试。'));};}});

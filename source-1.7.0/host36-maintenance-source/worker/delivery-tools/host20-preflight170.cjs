'use strict';
// Reuse the original process inventory; conservatively refuse concurrent maintainers.
// This is not a cross-version OS mutex. Old workers started after this check are
// still rejected by later repeated source/receipt/tree and process checks where observable.
const path=require('node:path'),entry=require('./initial-patch-entry.cjs');
function checkHost20Maintainers170(rows,{pid=process.pid,executablePath=process.execPath}={}){
 const fail=(code,message)=>{throw Object.assign(Error(message),{code});};
 if(!Array.isArray(rows))fail('PROCESS_PROBE_FAILED','Process inventory unavailable');
 const current=rows.find(p=>p.pid===pid);if(!current||typeof current.executablePath!=='string'||path.win32.resolve(current.executablePath).toLowerCase()!==path.win32.resolve(executablePath).toLowerCase()||typeof current.creationMarker!=='string'||!current.creationMarker)fail('BAD_PROCESS','Current updater identity not established');
 for(const p of rows){if(p.pid===pid)continue;const command=p.commandLine;if(typeof command==='string'&&/(?:host20-native-entry170|engine-native-entry170|initial-patch-entry)\.cjs(?:[\s"']|$)/i.test(command))fail('HOST_MAINTENANCE_BUSY','Another maintenance process is alive; preserve its snapshots and retry after it exits');if(typeof p.executablePath==='string'&&/[\\/]受信助手[\\/]鑫金源珠宝报价\.exe$/i.test(p.executablePath)&&typeof command!=='string')fail('HOST_MAINTENANCE_BUSY','Another helper cannot be identified safely');}
 return{pid:current.pid,creationMarker:current.creationMarker};
}
async function assertNoOtherHostMaintenance170(){const broker=entry.createInitialInventoryBroker();try{return checkHost20Maintainers170(await broker.list());}finally{await broker.close();}}
module.exports={checkHost20Maintainers170,assertNoOtherHostMaintenance170};

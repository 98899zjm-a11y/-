'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function dayKey(now){if(!(now instanceof Date)||!Number.isFinite(now.getTime()))throw new Error('Invalid scheduler time');const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now).map(x=>[x.type,x.value]));return parts.year+'-'+parts.month+'-'+parts.day;}
function createDailyBackups({service,root,policy,markerName='daily-backup.json'}){
 if(!/^daily-backup(?:-test)?\.json$/.test(markerName))throw new Error('Unknown daily backup marker');
 const marker=policy.check(path.join(root,'config',markerName),true),namespace=JSON.parse(fs.readFileSync(path.join(root,'isolation-identity.json'),'utf8')).namespace;let active=null,timer=null,stopping=false;
 function tick(now=new Date()){
  if(stopping)return Promise.resolve({created:false,stopped:true});if(active)return active;
  active=(async()=>{const day=dayKey(now);if(fs.existsSync(marker)){const old=JSON.parse(fs.readFileSync(marker,'utf8'));if(old.namespace!==namespace||old.version!==1||typeof old.file!=='string')throw new Error('Invalid daily backup state; no fallback');policy.check(old.file);if(old.day===day&&service.list().some(x=>x.file===old.file&&x.kind==='auto')){try{await service.probe(old.file);return{created:false,day};}catch{ /* corrupt body requires a new complete snapshot */ }}}
   const backup=await service.create({kind:'auto',now});const temporary=policy.check(marker+'.'+crypto.randomUUID()+'.tmp',true);fs.writeFileSync(temporary,JSON.stringify({version:1,namespace,day,file:backup.file,createdAt:backup.createdAt}),{flag:'wx',mode:0o600});fs.renameSync(temporary,marker);await service.cleanup(now);return{created:true,...backup,day};
  })().finally(()=>{active=null;});return active;
 }
 return{tick,start(){if(timer)return;timer=setInterval(()=>tick().catch(error=>fs.appendFileSync(path.join(root,'logs','daily-backup-errors.log'),new Date().toISOString()+' '+error.message+'\n')),60000);timer.unref();},async stop(){stopping=true;if(timer)clearInterval(timer);await active?.catch(()=>{});}};
}
module.exports={createDailyBackups,dayKey};

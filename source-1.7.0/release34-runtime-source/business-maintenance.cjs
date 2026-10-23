'use strict';
const path=require('node:path'),crypto=require('node:crypto');
const {requireContext}=require('./business-maintenance-layout.cjs');
const {createBusinessBackups}=require('./business-backups.cjs');
const {createBusinessRestore}=require('./business-restore.cjs');
const {createBusinessDailyBackups}=require('./business-daily-backup.cjs');
function recoverBeforeBusinessOpen({context}){requireContext(context);return createBusinessRestore({context}).recover();}
function createBusinessMaintenance({context,database,authorize,withFrozen,freeze,prepare,stop,resume,invalidateSessions}){
 requireContext(context);for(const fn of [database,authorize,withFrozen,freeze,prepare,stop,resume,invalidateSessions])if(typeof fn!=='function')throw TypeError('Explicit trusted maintenance lifecycle callbacks required');
 const backups=createBusinessBackups({context,salesDatabase:database,withFrozen}),restore=createBusinessRestore({context,backups,freeze,prepare,stop,resume,database,invalidateSessions}),daily=createBusinessDailyBackups({context,service:backups});
 const jobs=new Map(),io=context.policy.io;let tail=Promise.resolve(),closing=false;
 const log=(name,text)=>io.appendFileSync(path.join(context.layout.logDir,name),text);
 async function allowed(actor){return actor&&typeof actor.id==='string'&&actor.active!==false&&actor.role==='admin'&&await authorize(actor)===true;}
 function submit(actor,kind,action){
  if(closing)return{status:503,data:{error:'主机维护正在关闭'}};
  for(const [id,job]of jobs)if(jobs.size>=32&&['completed','failed'].includes(job.status))jobs.delete(id);
  if(jobs.size>=32)return{status:429,data:{error:'维护任务已满，请等待当前任务完成'}};
  const id=crypto.randomUUID(),job={id,kind,status:'queued',actorId:actor.id,at:new Date().toISOString()};jobs.set(id,job);
  // The maintenance queue is private. No shared SQL lock is held while the
  // injected freeze/drain/module-stop callbacks wait on backend work.
  tail=tail.then(()=>new Promise(resolve=>setImmediate(resolve))).then(async()=>{
   try{if(!await allowed(actor))throw Error('管理员权限已变化');job.status='running';job.result=await action();job.status='completed';}
   catch(e){job.status='failed';job.error=String(e.message||'维护未完成').slice(0,800);log('business-maintenance-errors.log',job.at+' '+job.id+' '+String(e.stack||e)+'\n');}
   finally{log('business-maintenance-events.jsonl',JSON.stringify(job)+'\n');}
  });return{status:202,data:{jobId:id,status:'queued'}};
 }
 async function handle(actor,input){
  if(!await allowed(actor))return{status:403,data:{error:'统一备份和恢复仅主机管理员可操作'}};
  if(input?.path==='/api/local/backups'&&input.method==='GET')return{status:200,data:{backups:backups.list().map(x=>({name:path.basename(x.file),createdAt:x.createdAt,kind:x.kind})),jobs:[...jobs.values()].map(x=>({...x})),retentionDays:7,encrypted:true,dailyBackup:daily.getStatus()}};
  if(input?.path==='/api/local/backups'&&input.method==='POST'){if(input.body&&Object.keys(input.body).length)return{status:400,data:{error:'备份不接受客户端路径或配置'}};return submit(actor,'backup',()=>backups.create({kind:'manual'}));}
  if(input?.path==='/api/local/restore'&&input.method==='POST'){
   const body=input.body;if(!body||Object.keys(body).some(k=>!['name','selection','confirmation'].includes(k))||typeof body.name!=='string'||body.name!==path.basename(body.name)||body.confirmation!=='确认恢复所选业务资料'||!['sales','ledger','inventory','documents','allBusiness'].includes(body.selection))return{status:400,data:{error:'请选择已有备份和业务资料，并确认恢复'}};
   const archive=backups.list().find(x=>path.basename(x.file)===body.name);if(!archive)return{status:404,data:{error:'备份不存在或完整签名未通过'}};
   return submit(actor,'restore',()=>restore.restore(archive.file,body.selection));
  }
  return{status:404,data:{error:'主机维护功能不存在'}};
 }
 return{handle,backups,restore,daily,jobs:()=>[...jobs.values()].map(x=>({...x})),async close(){closing=true;await daily.stop();await tail;}};
}
module.exports={createBusinessMaintenance,recoverBeforeBusinessOpen};

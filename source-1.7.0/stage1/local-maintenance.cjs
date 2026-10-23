'use strict';
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
function createMaintenance({root,backups,restore,database}){
 const jobs=new Map();let queue=Promise.resolve(),closing=false;
 function submit(actor,kind,action){
  if(closing||jobs.size>=32)return{status:429,data:{error:'维护任务已满，请等待或重新启动隔离服务'}};
  const id=crypto.randomUUID(),job={id,kind,status:'queued',actorId:actor.id,at:new Date().toISOString()};jobs.set(id,job);
  setTimeout(()=>{queue=queue.then(async()=>{try{const live=database().prepare('SELECT role,active FROM staff_users WHERE id=?').get(actor.id);if(!live?.active||live.role!=='admin')throw new Error('管理员权限已变化');job.status='running';await action();job.status='completed';}catch(e){job.status='failed';job.error='维护未完成，请查看隔离主机日志';fs.appendFileSync(path.join(root,'logs','local-maintenance-errors.log'),job.at+' '+job.id+' '+e.stack+'\n');}finally{fs.appendFileSync(path.join(root,'logs','local-maintenance-events.jsonl'),JSON.stringify(job)+'\n');}});},0);
  return{status:202,data:{jobId:id,status:'queued'}};
 }
 return{handle(actor,input){
  if(input.path==='/api/local/backups'&&input.method==='GET')return{status:200,data:{backups:backups.list().map(x=>({name:path.basename(x.file),createdAt:x.createdAt,kind:x.kind})),jobs:[...jobs.values()],syntheticOnly:true}};
  if(input.path==='/api/local/backups'&&input.method==='POST')return submit(actor,'backup',()=>backups.create({kind:'manual'}));
  if(input.path==='/api/local/restore'&&input.method==='POST'){
   const {name,selection,confirmation}=input.body||{};if(confirmation!=='仅恢复虚构测试数据'||typeof name!=='string'||name!==path.basename(name)||!['sales','ledger','inventory','allBusiness'].includes(selection))return{status:400,data:{error:'请选择备份、数据集并确认仅恢复虚构测试数据'}};
   const archive=backups.list().find(x=>path.basename(x.file)===name);if(!archive)return{status:404,data:{error:'备份不存在或签名不完整'}};
   return submit(actor,'restore',()=>restore.restore(archive.file,selection));
  }
  return{status:404,data:{error:'本地维护功能不存在'}};
 },async close(){closing=true;await new Promise(r=>setTimeout(r,5));await queue;}};
}
module.exports={createMaintenance};

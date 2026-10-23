'use strict';
// This composition is called only after release admission by the trusted main
// process. It never initializes a missing business database or starts on import.
const fs=require('node:fs'),path=require('node:path');
const {requireHostAdmission,createOwnedPathGuard}=require('./managed-print-worker.cjs');
const DATABASES=Object.freeze({sales:'jewelry.sqlite',ledger:'ledger.db',inventory:'stockcheck.db'});
function publicMaintenanceWarnings(job){
 const result=[],seen=new Set();
 for(const values of [job?.warnings,job?.result?.warnings])if(Array.isArray(values))for(const value of values){
  if(result.length>=20)break;
  if(!value||typeof value.code!=='string'||!/^[A-Z0-9_]{1,80}$/.test(value.code)||typeof value.message!=='string'||!value.message.trim())continue;
  const message=value.message.replace(/[\x00-\x1f\x7f]/g,'').slice(0,800),key=value.code+'\n'+message;
  if(!seen.has(key)){seen.add(key);result.push({code:value.code,message});}
 }
 return result;
}
function deriveDesktopHostLayout({storage,admission,assertAdmission}){
 requireHostAdmission(admission,assertAdmission);
 if(!storage||typeof storage.root!=='string'||typeof storage.dataDir!=='string'||typeof storage.profileDir!=='string')throw Error('主机资料目录未核验');
 const guard=createOwnedPathGuard(admission.mode==='sandbox'?admission.root:storage.root);
 if(admission.mode==='sandbox'&&guard.check(storage.root)!==guard.root)throw Error('Sandbox 资料根与准入根不一致');
 const dataDir=guard.check(storage.dataDir),profileDir=guard.check(storage.profileDir);
 if(admission.mode==='sandbox'&&dataDir!==guard.check(path.join(guard.root,'data','sales')))throw Error('Sandbox 销售目录必须独立');
 const settingsFile=guard.check(path.join(profileDir,'legacy-module-settings.json')),saved={};
 if(fs.existsSync(settingsFile)){
  const input=JSON.parse(fs.readFileSync(guard.check(settingsFile),'utf8'));
  if(input?.version!==1||!input.modules||typeof input.modules!=='object'||Array.isArray(input.modules)||Object.keys(input).some(x=>!['version','modules'].includes(x))||Object.keys(input.modules).some(x=>!['ledger','inventory'].includes(x)))throw Error('内部模块配置格式无效，拒绝猜测数据位置');
  for(const [id,value]of Object.entries(input.modules)){if(!value||Object.keys(value).some(x=>x!=='dataDir')||typeof value.dataDir!=='string')throw Error('内部模块配置格式无效');saved[id]=guard.check(value.dataDir);}
 }
 const ledgerDir=guard.check(saved.ledger||path.join(guard.root,...(admission.mode==='sandbox'?['data','ledger']:['内帐']))),inventoryDir=guard.check(saved.inventory||path.join(guard.root,...(admission.mode==='sandbox'?['data','inventory']:['库管'])));
 if(admission.mode==='sandbox'&&(ledgerDir!==guard.check(path.join(guard.root,'data','ledger'))||inventoryDir!==guard.check(path.join(guard.root,'data','inventory'))))throw Error('Sandbox 模块目录必须独立');
 const layout={dataDir,ledgerDir,inventoryDir,profileDir,configDir:profileDir,runtimeDir:guard.check(path.join(guard.root,'后台运行')),logDir:guard.check(path.join(guard.root,'运行日志')),backupDir:guard.check(path.join(guard.root,'统一备份')),documentsDir:guard.check(path.join(guard.root,'工作文档')),quoteImagesDir:guard.check(storage.imageDir??path.join(guard.root,'报价图片'))};
 const names=['dataDir','ledgerDir','inventoryDir','configDir','runtimeDir','logDir','backupDir','documentsDir','quoteImagesDir'];
 for(const a of names)for(const b of names)if(a!==b){const r=path.relative(layout[a].toLowerCase(),layout[b].toLowerCase());if(!r||r!=='..'&&!r.startsWith('..'+path.sep)&&!path.isAbsolute(r))throw Error('业务、配置、后台和备份目录不能重叠');}
 function databaseExists(id){const dir=layout[id==='sales'?'dataDir':id+'Dir'],file=guard.check(path.join(dir,DATABASES[id]));return fs.existsSync(file)&&fs.lstatSync(file).isFile();}
 return{root:guard.root,layout:Object.freeze(layout),guard,settingsFile,databaseExists};
}
async function createDesktopHostRuntime(options){
 const {storage,admission,assertAdmission,codeDir,resourcesDir,hostId,profileId,port=42831,getLocalActor,isLocal,withNetworkFrozen,onBackendReplaced=async()=>{},onSessionsInvalidated=async()=>{},provisionOwner=false,printerSettings,nativePins,ocrServiceFactory}=options;
 requireHostAdmission(admission,assertAdmission);
 if(!Number.isInteger(port)||port<1024||port>65535||port===31831)throw Error('浏览器服务只能使用独立本机端口');
 if([getLocalActor,isLocal,withNetworkFrozen,onBackendReplaced,onSessionsInvalidated].some(x=>typeof x!=='function'))throw Error('实际本机身份与请求冻结回调缺失');
 if(ocrServiceFactory!==undefined&&typeof ocrServiceFactory!=='function')throw Error('OCR 只接受经过核验的本机服务工厂');
 if(options.maintenanceWait!==undefined&&typeof options.maintenanceWait!=='function')throw Error('维护等待只接受可信内部回调');
 if(typeof hostId!=='string'||!/^[-A-Za-z0-9_]{8,120}$/.test(hostId)||typeof profileId!=='string'||!/^[-A-Za-z0-9_]{3,120}$/.test(profileId))throw Error('主机及资料身份缺失');
 const owned=deriveDesktopHostLayout({storage,admission,assertAdmission}),{root,layout,guard,settingsFile}=owned;
 for(const key of ['profileDir','runtimeDir','logDir','backupDir','documentsDir','quoteImagesDir']){const target=guard.check(layout[key]);fs.mkdirSync(target,{recursive:true});guard.check(target);}
 const workerProfileDir=guard.check(path.join(layout.runtimeDir,'打印缓存'));fs.mkdirSync(workerProfileDir,{recursive:true});guard.check(workerProfileDir);
 const contextFactory=options.contextFactory||require('./business-maintenance-layout.cjs').createBusinessMaintenanceContext;
 const recover=options.recoverBeforeBusinessOpen||require('./business-maintenance.cjs').recoverBeforeBusinessOpen;
 const backendFactory=options.backendFactory||require('./backend.cjs').createBackend;
 const legacyFactory=options.legacyModulesFactory||require('./legacy-modules.cjs').createLegacyModules;
 const gatewayFactory=options.gatewayFactory||require('./web-runtime/web-gateway.cjs').createGateway;
 const printFactory=options.printServicesFactory||require('./desktop-print-services.cjs').createDesktopPrintServices;
 const maintenanceFactory=options.maintenanceFactory||require('./business-maintenance.cjs').createBusinessMaintenance;
 const context=contextFactory({root,layout,hostId,profileId,provisionOwner});
 const moduleAvailable=id=>owned.databaseExists(id);
 let missing,maintenanceReason;
 const server=(options.serverFactory||(()=>require('node:http').createServer()))();let listening=false,backend,gateway,worker,maintenance,currentModules,printServices,closed=false,shuttingDown=false,closePromise,paused=false,stopped=false,startupRecovering=false;
 const pending=new Set();
 const makeModules=()=>legacyFactory({settingsFile,runtimeDir:guard.check(path.join(layout.runtimeDir,'内部模块')),packagedDir:path.join(resourcesDir,'release-modules'),releaseContext:{hostId,profileDir:layout.profileDir},...(ocrServiceFactory?{ocrServiceFactory}:{})});
 async function attachConfigured(manager){for(const id of ['ledger','inventory'])if(moduleAvailable(id)&&!manager.status().modules.find(x=>x.id===id)?.configured)await manager.configure(id,layout[id+'Dir']);}
 async function resetModules(){if(closed)throw Error('主机正在关闭');currentModules=makeModules();await attachConfigured(currentModules);return currentModules.status();}
 async function closeModules(){if(currentModules)await currentModules.close({strict:true});}
 function requireModuleData(id){if(!['ledger','inventory'].includes(id))throw Error('未知模块');if(!moduleAvailable(id))throw Object.assign(Error('现有数据库未关联，禁止自动新建空业务库'),{status:503});}
 const moduleAdapter={status(){const value=currentModules.status();return{...value,modules:value.modules.map(item=>moduleAvailable(item.id)?item:{...item,configured:false,running:false,error:'现有数据库未关联，禁止自动新建空业务库'})};},async configure(id,directory){if(!['ledger','inventory'].includes(id))throw Error('未知模块');const checked=guard.check(directory);if(checked.toLowerCase()!==layout[id+'Dir'].toLowerCase())throw Error('数据目录变更需关闭主机后重新核验备份清单');requireModuleData(id);return currentModules.configure(id,checked);},async createData(){throw Error('禁止在升级主机中自动新建空业务库，请先由管理员关联已有数据');},async proxy(input,...rest){requireModuleData(input?.module);return currentModules.proxy(input,...rest);},async collaborationSnapshot(id,...rest){requireModuleData(id);return currentModules.collaborationSnapshot(id,...rest);},async executeCashierMaintenance(input){if(!paused&&!startupRecovering)throw Error('出纳恢复必须先冻结全部业务请求');requireModuleData('ledger');const manager=makeModules();try{await attachConfigured(manager);if(typeof manager.executeCashierMaintenance!=='function')throw Error('当前内部模块尚未提供出纳恢复核验');return await manager.executeCashierMaintenance(input);}finally{await manager.close({strict:true});}},close:closeModules,reset:resetModules,async withStopped(action){await closeModules();try{return await action();}finally{await resetModules();}}};
 async function localAdmin(expected){if(isLocal()!==true)throw Error('只有本机管理员可以设置主机或恢复资料');const actual=await getLocalActor(backend);if(!actual?.id||actual.active===false||actual.role!=='admin'||expected&&expected.id!==actual.id)throw Error('本机管理员身份已变化，请重新登录');backend.administration.requireAdmin(actual);return actual;}
 if(options.backendOptions&&Object.keys(options.backendOptions).some(x=>!['businessCore','runtimeFactory','updateServices','pollsAdapter','aiAdapter'].includes(x)))throw Error('业务后台只接受固定路径与经过核验的注入服务');
 const makeBackend=()=>backendFactory({...options.backendOptions,dataDir:layout.dataDir,migrationDir:path.join(codeDir,'migrations'),moduleAdapter,printServices,nativePins,...(options.updateServices!==undefined?{updateServices:options.updateServices}:{})});
 async function withRequest(action){if(closed||shuttingDown||paused||stopped)throw Error('主机维护或关闭中，请稍后重试');const promise=Promise.resolve().then(()=>action(backend));pending.add(promise);try{return await promise;}finally{pending.delete(promise);}}
 async function freeze(action){if(paused||closed)throw Error('另一个主机维护任务正在运行');paused=true;try{await Promise.allSettled([...pending]);return await withNetworkFrozen(()=>gateway.withFrozen(action));}finally{paused=false;}}
 async function withFrozen(action){return freeze(()=>backend.exclusive(()=>moduleAdapter.withStopped(action)));}
 async function invalidateSessions(){await gateway.replaceBackend(backend);await onSessionsInvalidated();}
 async function stopBusiness(){stopped=true;await closeModules();await backend.close();}
 async function resumeBusiness(){await resetModules();backend=makeBackend();await gateway.replaceBackend(backend);await onBackendReplaced(backend);stopped=false;}
 async function performMaintenance(input){
  if(shuttingDown||closed)return{ok:false,error:'主机正在关闭，未受理新维护任务'};
  // Capture the admitted local administrator once. A successful restore closes
  // that session; only this call may still obtain its own accepted job result.
  const actor=await localAdmin();if(!maintenance)return{ok:false,error:maintenanceReason};
  if(input?.method!=='POST'||!['/api/local/backups','/api/local/restore'].includes(input.path))return{ok:false,error:'请选择主机备份或恢复操作'};
  const response=await maintenance.handle(actor,input);if(response?.status!==202)return{ok:false,error:response?.data?.error||'主机维护任务未受理'};
  const jobId=response.data?.jobId;if(typeof jobId!=='string'||! /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(jobId))return{ok:false,error:'主机维护任务编号无效'};
  const wait=options.maintenanceWait||((ms)=>new Promise(resolve=>setTimeout(resolve,ms)));
  while(true){const job=maintenance.jobs().find(value=>value.id===jobId);if(!job||job.actorId!==actor.id)return{ok:false,jobId,error:'未找到本次受理的主机维护任务，或任务归属不一致'};
   if(job.status==='completed')return{ok:true,jobId,status:'completed',...(typeof job.result?.file==='string'?{path:job.result.file}:{}),...(input.path==='/api/local/restore'?{reloadRequired:true}:{}),result:job.result,warnings:publicMaintenanceWarnings(job)};
   if(job.status==='failed')return{ok:false,jobId,status:'failed',error:job.error||'主机维护未完成',warnings:publicMaintenanceWarnings(job)};
   if(!['queued','running'].includes(job.status))return{ok:false,jobId,error:'主机维护任务状态无效'};
   if(closed)return{ok:false,jobId,status:job.status,error:'主机正在关闭，维护任务尚未确认完成'};
   await wait(100);
  }
 }
 async function shutdown(){shuttingDown=true;gateway?.stopAccepting?.();await Promise.allSettled([...pending]);const errors=[];try{await maintenance?.close();}catch(error){errors.push(error);}closed=true;paused=true;for(const action of [()=>gateway?.close(),()=>backend?.close(),closeModules,()=>worker?.close(),()=>listening?new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve())):undefined])try{await action();}catch(error){errors.push(error);}listening=false;if(errors.length)throw new AggregateError(errors,'主机部分后台未正常停止，请检查后再启动');}
 try{
  await new Promise((resolve,reject)=>{function error(e){server.off('error',error);reject(e);}server.once('error',error);server.listen({port,host:'127.0.0.1',exclusive:true},()=>{server.off('error',error);listening=true;resolve();});});
  // Reserve the unique listener before recovery can write a journal. A second
  // host must not roll back an active restore owned by the first process.
  startupRecovering=true;try{await recover({context,cashierExecute:input=>moduleAdapter.executeCashierMaintenance(input)});}finally{startupRecovering=false;}
  if(!owned.databaseExists('sales'))throw Error('现有销售数据库缺失，禁止自动创建空工作室');
  missing=['ledger','inventory'].filter(id=>!moduleAvailable(id));
  maintenanceReason=missing.length?missing.map(id=>id==='ledger'?'财务':'库管').join('、')+'现有数据库未关联，统一备份及恢复暂不可用；销售仍可使用':'';
  await resetModules();
  const launch=options.printWorkerLauncher||require('./managed-print-worker.cjs').launchManagedPrintWorker;
  worker=await launch({admission,assertAdmission,storageRoot:root,executable:options.executable,isPackaged:options.isPackaged??admission.mode==='installed',codeDir,resourcesDir,profileDir:workerProfileDir});
  if(!printerSettings||typeof printerSettings.read!=='function')throw Error('主机打印版式配置未提供');
  printServices=printFactory({routingFile:guard.check(path.join(layout.configDir,'central-print-routing.json')),printerSettings,worker,moduleAdapter,reauthorizeManage:async actor=>{try{await localAdmin(actor);return true;}catch{return false;}},auditRouting:async event=>backend.exclusive(async()=>{const actor=await localAdmin(event?.actorId?{id:event.actorId}:undefined);return backend.administration.noteAction(actor,{module:'system',action:'printing.routing.update',label:'调整主机打印机绑定',resource:String(event?.revision??''),summary:'管理员更新质保单与 A4 打印机绑定'});})});
  backend=makeBackend();
  gateway=gatewayFactory({backend,server,root:context.root,appVersion:options.appVersion,logDir:context.layout.logDir,applicationMode:admission.mode==='sandbox'?'isolated-local':'installed-private',browserStaticRoot:path.join(codeDir,'renderer-dist'),browserDefault:true,allowLocalControls:false});
  if(!missing.length){maintenance=maintenanceFactory({context,cashierExecute:input=>moduleAdapter.executeCashierMaintenance(input),database:()=>backend.runtime.sqlite,authorize:async actor=>{try{await localAdmin(actor);return true;}catch{return false;}},withFrozen,freeze,prepare:action=>backend.exclusive(()=>moduleAdapter.withStopped(action)),stop:stopBusiness,resume:resumeBusiness,invalidateSessions});maintenance.daily.start();}
  return Object.freeze({root,layout,origin:'http://127.0.0.1:'+port,moduleAdapter,get backend(){return backend;},get gateway(){return gateway;},get printRouting(){return printServices.routing;},getBackend:()=>backend,withRequest,withFrozen,performMaintenance,maintenanceStatus:()=>({available:Boolean(maintenance),reason:maintenanceReason,retentionDays:7,encrypted:true}),async handleMaintenance(input){const actor=await localAdmin();if(!maintenance)return{status:503,data:{error:maintenanceReason}};return maintenance.handle(actor,input);},async getMaintenance(){const actor=await localAdmin();if(!maintenance)return{ok:true,available:false,reason:maintenanceReason,retentionDays:7,encrypted:true,backups:[],jobs:[]};const result=await maintenance.handle(actor,{method:'GET',path:'/api/local/backups'});if(result.status!==200)return{ok:false,available:false,error:result.data?.error||'主机维护列表未能读取'};return{ok:true,available:true,...result.data};},close(){if(!closePromise)closePromise=shutdown();return closePromise;}});
 }catch(error){try{await shutdown();}catch(cleanup){error.cleanupError=cleanup.message;}throw error;}
}
module.exports={publicMaintenanceWarnings,createDesktopHostRuntime,deriveDesktopHostLayout};

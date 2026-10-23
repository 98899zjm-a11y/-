'use strict';
// No business module may be loaded before the bootstrap and actual token proof.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'..');
let bootstrapGuard;
async function start({port=41831}={}){
 bootstrapGuard=require('./isolation.cjs').createIsolationGuard(ROOT);
 if(process.env.XJY_STAGE1_ROOT!==ROOT)throw new Error('ISOLATION: owned restricted launcher is required');
 const identity=JSON.parse(fs.readFileSync(bootstrapGuard.assertPath(path.join(ROOT,'isolation-identity.json')),'utf8'));
 if(identity.namespace!==process.env.XJY_STAGE1_NAMESPACE)throw new Error('ISOLATION: namespace mismatch');
 const privateDirs=['data','config','cache','logs','runtime','backups'].map(x=>path.join(ROOT,x));
 const scripts=['token-info.py','create-fixture.py','verify-finance.py','verify-guards.py','verify-exports.py','verify-erp.py'].map(x=>path.join(__dirname,x));
 const runtimeDir=path.join(ROOT,'runtime','modules'),packagedDir=path.join(ROOT,'project','desktop','legacy-modules');
 const manifest=JSON.parse(fs.readFileSync(bootstrapGuard.assertPath(path.join(packagedDir,'manifest.json')),'utf8'));
 if(manifest.version!==1||manifest.modules.length!==2||manifest.modules.some(x=>!['ledger','inventory'].includes(x.id)||!/^\d+\.\d+\.\d+$/.test(x.version)||!/^xjy-(ledger|inventory)\.exe$/.test(x.file)||!/^[a-f0-9]{64}$/.test(x.sha256)))throw new Error('ISOLATION: guarded sidecars must be rebuilt');
 const childPrograms=manifest.modules.map(x=>({program:path.join(packagedDir,'xjy-'+x.id,x.file),validate:args=>(args.length===6&&args[0]==='--module'&&args[1]===x.id&&args[2]==='--host'&&args[3]==='127.0.0.1'&&args[4]==='--port'&&/^\d+$/.test(args[5])&&Number(args[5])>=1024&&Number(args[5])<=65535&&Number(args[5])!==31831)||(x.id==='ledger'&&args.length===4&&args[0]==='--module'&&args[1]==='ledger'&&args[2]==='--cashier-maintenance'&&['merge','verify','verify-rollback'].includes(args[3]))}));
 childPrograms.push({program:'C:\\Python314\\python.exe',validate:args=>args[0]==='-B'&&scripts.includes(args[1])&&(args.length===2||args[1]===scripts[1]&&args.length===3&&['ledger','inventory'].includes(args[2])||args[1]===scripts[5]&&args.length===3&&['values','baseline','check','exports','volume'].includes(args[2]))});
 const policy=require('./io-guard.cjs').install({root:ROOT,writeDirs:privateDirs,readDirs:['C:\\Python314'],childPrograms});
 Object.defineProperty(globalThis,'__xjyStage1Guard',{value:policy.guard,writable:false,configurable:false});
 const cp=require('node:child_process');
 async function python(script,args=[]){return new Promise((resolve,reject)=>{const id=crypto.randomUUID(),input=path.join(ROOT,'runtime','stdin-'+id),output=path.join(ROOT,'logs','stdout-'+id),errors=path.join(ROOT,'logs','stderr-'+id);fs.writeFileSync(input,'');const handles=[fs.openSync(input,'r'),fs.openSync(output,'w'),fs.openSync(errors,'w')];let child;try{child=cp.spawn('C:\\Python314\\python.exe',['-B',path.join(__dirname,script),...args],{cwd:ROOT,env:process.env,stdio:handles});}catch(e){handles.forEach(x=>fs.closeSync(x));return reject(e);}handles.forEach(x=>fs.closeSync(x));child.on('error',reject);child.on('close',code=>{const stdout=fs.readFileSync(output,'utf8'),stderr=fs.readFileSync(errors,'utf8');if(code){fs.writeFileSync(path.join(ROOT,'logs','python-'+script+'.log'),stderr);reject(new Error('Protected Python step failed: '+script));}else resolve(stdout.trim());});});}
 const token=JSON.parse(await python('token-info.py'));
 if(!token.restricted||!token.restrictingSids.includes(identity.sid))throw new Error('ISOLATION: actual OS restriction missing');
 const layout={dataDir:path.join(ROOT,'data','sales'),ledgerDir:path.join(ROOT,'data','ledger'),inventoryDir:path.join(ROOT,'data','inventory'),configDir:path.join(ROOT,'config'),cacheDir:path.join(ROOT,'cache'),logDir:path.join(ROOT,'logs'),backupDir:path.join(ROOT,'backups')};
 const savedLayout=path.join(ROOT,'config','isolated-layout.json');if(fs.existsSync(savedLayout)){const saved=JSON.parse(fs.readFileSync(savedLayout,'utf8'));policy.guard.validateLayout(saved);if(JSON.stringify(saved)!==JSON.stringify(layout))throw new Error('ISOLATION: sealed layout cannot be replaced by fallback configuration');}
 for(const v of Object.values(layout)){policy.guard.assertPath(v);fs.mkdirSync(v,{recursive:true});}
 policy.guard.validateLayout(layout);policy.guard.validatePort(port,'127.0.0.1');
 fs.writeFileSync(savedLayout,JSON.stringify(layout));
 const marker=path.join(layout.dataDir,'synthetic-fixture.json'),database=path.join(layout.dataDir,'jewelry.sqlite');
 if(fs.existsSync(database)&&!fs.existsSync(marker))throw new Error('ISOLATION: unmarked sales database refused');
 // Reserve the host port before initializing any writer. A second host fails
 // before creating/opening a database; the supervisor owns all child lifetimes.
 const http=require('node:http'),server=http.createServer();
 await new Promise((resolve,reject)=>server.once('error',reject).listen({port,host:'127.0.0.1',exclusive:true},resolve));
 let backend,gateway,moduleAdapter;
 try{
  require('./restore-service.cjs').createRestoreService({root:ROOT,layout,policy}).recover();
  for(const module of ['ledger','inventory']){const result=await python('create-fixture.py',[module]);fs.writeFileSync(path.join(ROOT,'logs',module+'-fixture-result.json'),result);}
  if(process.argv.includes('finance-test')){await python('verify-guards.py');await python('verify-finance.py');}
  const makeModules=()=>require('../project/desktop/legacy-modules.cjs').createLegacyModules({settingsFile:path.join(ROOT,'config','internal-modules.json'),runtimeDir,packagedDir});let currentModules=makeModules();
  moduleAdapter={status:()=>currentModules.status(),configure:(...args)=>currentModules.configure(...args),proxy:(...args)=>currentModules.proxy(...args),collaborationSnapshot:(...args)=>currentModules.collaborationSnapshot(...args),close:(...args)=>currentModules.close(...args),async reset(){currentModules=makeModules();await currentModules.configure('ledger',layout.ledgerDir);await currentModules.configure('inventory',layout.inventoryDir);},async withStopped(action){await currentModules.close({strict:true});try{return await action();}finally{currentModules=makeModules();}}};
  await moduleAdapter.configure('ledger',layout.ledgerDir);await moduleAdapter.configure('inventory',layout.inventoryDir);
  const {createBackend}=require('../project/desktop/backend.cjs');
  const makeBackend=()=>createBackend({dataDir:layout.dataDir,migrationDir:path.join(ROOT,'project','desktop','migrations'),moduleAdapter,aiAdapter:require('./ai-bridge.cjs').createAiBridge(),printAdapter:{async getPrinters(){return[];},async print(){throw new Error('隔离环境禁用真实打印');}}});backend=makeBackend();
  if(backend.auth.status().needsSetup){
   backend.auth.setup({username:'demo-admin',name:'虚构管理员',password:'DemoAdmin-2026!'});
   backend.auth.createUser({username:'demo-sales-a',name:'虚构员工甲',password:'DemoEmployee-A-2026!',role:'employee'});
   backend.auth.createUser({username:'demo-sales-b',name:'虚构员工乙',password:'DemoEmployee-B-2026!',role:'employee'});
   backend.auth.createUser({username:'demo-reviewer',name:'虚构审批管理员',password:'DemoReviewer-2026!',role:'admin'});
   backend.auth.logout();
  }
  fs.writeFileSync(marker,JSON.stringify({synthetic:true,namespace:identity.namespace,version:'1.5.0-isolated'}));
  const {createGateway}=require('./web-gateway.cjs');gateway=createGateway({backend,server,root:ROOT});
  const ready={namespace:identity.namespace,host:'127.0.0.1',port:server.address().port,origin:'http://127.0.0.1:'+server.address().port,pid:process.pid,startedAt:new Date().toISOString(),productionDeployment:false};
  fs.writeFileSync(path.join(ROOT,'runtime','host-ready.json'),JSON.stringify(ready));
  const withFrozen=async action=>gateway.withFrozen(()=>backend.exclusive(()=>moduleAdapter.withStopped(action)));
  const backupService=require('./backups.cjs').createBackupService({root:ROOT,layout,policy,withFrozen,salesDatabase:()=>backend.runtime.sqlite});
  backupService.cleanupOrphans();
  const restoreService=require('./restore-service.cjs').createRestoreService({root:ROOT,layout,policy,backups:backupService,freeze:action=>gateway.withFrozen(action),prepare:action=>backend.exclusive(()=>moduleAdapter.withStopped(action)),stop:async()=>{await gateway.replaceBackend(backend);await moduleAdapter.close({strict:true});await backend.close();},resume:async()=>{await moduleAdapter.reset();backend=makeBackend();await gateway.replaceBackend(backend);},database:()=>backend.runtime.sqlite});
  const maintenance=require('./local-maintenance.cjs').createMaintenance({root:ROOT,backups:backupService,restore:restoreService,database:()=>backend.runtime.sqlite});gateway.setControls((actor,input)=>maintenance.handle(actor,input));
  const dailyBackups=require('./daily-backup.cjs').createDailyBackups({service:backupService,root:ROOT,policy});if(process.argv.includes('serve'))dailyBackups.start();
  return{...ready,get backend(){return backend;},gateway,root:ROOT,layout,policy,withFrozen,backupService,restoreService,verifyExports:()=>python('verify-exports.py'),verifyErp:mode=>python('verify-erp.py',[mode]),async close(){await maintenance.close();await dailyBackups.stop();await gateway.close();await backend.close();await moduleAdapter.close();await new Promise(r=>server.close(r));fs.rmSync(path.join(ROOT,'runtime','host-ready.json'),{force:true});}};
 }catch(e){await backend?.close();await moduleAdapter?.close();await new Promise(r=>server.close(r));throw e;}
}
if(require.main===module){(async()=>{
 const mode=process.argv[process.argv.indexOf('--mode')+1]||'smoke';const host=await start({port:mode==='serve'?41831:0});
 if(mode!=='serve'){try{await require('../tests/host-smoke.cjs').verify(host);if(mode==='backup-test')await require('../tests/backups.cjs').verify(host);if(mode==='daily-test')await require('../tests/daily-backup.cjs').verify(host);if(mode==='lan-test')await require('../tests/lan-limit.cjs').verify(host);if(mode==='numbers-test')await require('../tests/quote-numbers.cjs').verify(host);if(mode==='collaboration-test')await require('../tests/collaboration-regressions.cjs').verify(host);if(mode==='export-test')await require('../tests/history-export.cjs').verify(host);if(mode==='security-test')await require('../tests/gateway-freeze.cjs').verify(host);if(mode==='restore-test')await require('../tests/cashier-native-maintenance170.cjs').verify(host,{selfSha256:'866da489cd90f0fda33bcb2343c968d417cb80339f7a7bcb7c81456957fccb7f',pinsSha256:'3ff06138cb93954bb40b8eaa2fb45573c3bc89a403954cb02308010dc64ecda9'});if(mode==='customers-test')await require('../tests/customer-collaboration.cjs').verify(host);if(mode==='erp-test')await require('../tests/erp-integration.cjs').verify(host);if(mode==='erp-reset-fixture')await host.restoreService.restore(path.join(ROOT,'backups','MANUAL-2026-10-14-610ce567-ff30-483f-9719-772fc2f5b3bf.xjybak'),'ledger');fs.writeFileSync(path.join(ROOT,'logs','host-smoke-result.json'),JSON.stringify({passed:true,mode,at:new Date().toISOString()}));}finally{await host.close();}}
 else{const stop=path.join(ROOT,'runtime','stop-request.json');fs.rmSync(stop,{force:true});let closing=false;const timer=setInterval(async()=>{if(!closing&&fs.existsSync(stop)){const request=JSON.parse(fs.readFileSync(stop,'utf8'));if(request.namespace===host.namespace){closing=true;clearInterval(timer);await host.close();fs.rmSync(stop,{force:true});}}},500);}
})().catch(e=>{try{if(bootstrapGuard)fs.writeFileSync(bootstrapGuard.assertPath(path.join(ROOT,'logs','host-error.log')),new Date().toISOString()+'\n'+String(e.stack||e));}catch{}process.exitCode=1;});}
module.exports={start};

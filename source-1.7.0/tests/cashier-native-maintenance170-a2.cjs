'use strict';
// Invoked ONLY by the original restricted stage1/host.cjs restore-test branch.
// The normal path always expects real product CLI success. Current RED is
// recorded, then remains a failing assertion. The separate old-env diagnostic
// uses a real registered child with allowed file descriptors, not the product
// executor; it must not be reported as native product restore success.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..'),SELF='tests/cashier-native-maintenance170-a2.cjs',PINS='audit-tools/cashier-native-maintenance170-red-pins.json';
const PROFILE='synthetic-cashier-native170',UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const CASH_TABLES=['cashier_documents','cashier_postings','cashier_allocations','cashier_erp_links','cashier_refund_links','cashier_reversals','cashier_requests','erp_postings','erp_allocations','erp_reversals'];
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
function regular(file){for(let p=file;;p=path.dirname(p)){const st=fs.lstatSync(p);assert(!st.isSymbolicLink(),'Links are not test inputs');if(p===file)assert(st.isFile()&&st.nlink===1);if(p===path.dirname(p))break;}return fs.statSync(file);}
function digestFile(file,max=256*1024*1024){const before=regular(file);assert(before.size<=max);const bytes=fs.readFileSync(file),after=regular(file);assert.equal(bytes.length,before.size);assert.equal(before.dev,after.dev);assert.equal(before.ino,after.ino);assert.equal(before.mtimeMs,after.mtimeMs);return crypto.createHash('sha256').update(bytes).digest('hex');}
function readJson(file,max=2*1024*1024){const st=regular(file);assert(st.size>0&&st.size<=max);return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}
function pin(relative,expected){assert(/^[a-f0-9]{64}$/.test(expected));const file=path.join(ROOT,...relative.split('/'));assert.equal(digestFile(file),expected,relative);return file;}
function errorRecord(error){return{type:error?.constructor?.name||typeof error,code:error?.code||null,message:String(error?.message||error).slice(0,1200)};}

async function verify(host,expected){
 assert.equal(process.platform,'win32');assert.equal(ROOT.toLowerCase(),'c:\\xjy-work\\xjy-web-stage1');
 assert(process.argv.includes('restore-test'),'Original registered restore-test mode required');
 assert.equal(path.resolve(process.env.XJY_STAGE1_ROOT||'').toLowerCase(),ROOT.toLowerCase());
 assert(globalThis.__xjyStage1Guard&&host.policy?.guard===globalThis.__xjyStage1Guard,'Original once-installed IO guard required');
 assert.equal(typeof host.withFrozen,'function');assert.equal(path.resolve(host.root).toLowerCase(),ROOT.toLowerCase());
 assert.deepEqual(Object.keys(expected||{}).sort(),['pinsSha256','selfSha256']);pin(SELF,expected.selfSha256);pin(PINS,expected.pinsSha256);
 const identity=readJson(path.join(ROOT,'isolation-identity.json')),identityHash=digestFile(path.join(ROOT,'isolation-identity.json'));
 assert.equal(identity.namespace,host.namespace);assert.equal(identity.namespace,process.env.XJY_STAGE1_NAMESPACE);
 assert(/^[A-Za-z0-9_-]{8,120}$/.test(identity.namespace),'Actual Stage namespace must satisfy the unchanged maintenance hostId contract');
 const proof=readJson(path.join(ROOT,'reports','restricted-token-check.json'));
 assert.equal(proof.isolationMethod,'windows-sandbox');assert.equal(proof.codeWritesDenied,true);assert.equal(proof.dataWritesAllowed,true);assert.equal(proof.productionDriveVisible,false);
 const pins=readJson(path.join(ROOT,PINS));assert.equal(pins.version,1);assert.equal(pins.purpose,'native-cashier-maintenance-red-via-original-restore-test');
 for(const[name,sha]of Object.entries(pins.sources))pin(name,sha);
 const packagedDir=path.join(ROOT,'project','desktop','legacy-modules'),manifestFile=path.join(packagedDir,'manifest.json');
 assert.equal(digestFile(manifestFile),pins.native.manifestSha256,'Keep the actual reviewed Guest bundle; do not copy the older W manifest');
 const bundle=readJson(manifestFile),entry=bundle.modules.find(x=>x.id==='ledger');
 assert.equal(entry.sha256,pins.native.ledgerExeSha256);assert.equal(entry.runtimeMode,'onedir');assert.equal(entry.files.length,pins.native.runtimeFileCount);
 const executable=path.join(packagedDir,'xjy-ledger',entry.file);
 function verifyBundle(){assert.equal(digestFile(manifestFile),pins.native.manifestSha256);for(const item of entry.files){assert(item.path.split('/').every(x=>x&&x!=='.'&&x!=='..'&&!/[\\:]/.test(x)));const file=path.join(path.dirname(executable),...item.path.split('/'));assert.equal(regular(file).size,item.size);assert.equal(digestFile(file),item.sha256);}assert.equal(digestFile(executable),entry.sha256);}
 verifyBundle();
 for(const slot of ['sales','ledger','inventory']){const directory=host.layout[slot==='sales'?'dataDir':slot+'Dir'];assert.equal(path.resolve(directory).toLowerCase(),path.join(ROOT,'data',slot).toLowerCase());const marker=readJson(path.join(directory,'synthetic-fixture.json'));assert.equal(marker.synthetic,true);assert.equal(marker.namespace,identity.namespace);}
 const sqlite=require('node:sqlite'),{createBusinessMaintenanceContext}=require('../project/desktop/business-maintenance-layout.cjs');
 const{createBusinessBackups}=require('../project/desktop/business-backups.cjs');
 const{createCashierMaintenance}=require('../project/desktop/cashier-maintenance.cjs');
 const{createLegacyModules}=require('../project/desktop/legacy-modules.cjs');
 const runId=crypto.randomUUID(),home=host.policy.check(path.join(ROOT,'runtime','cashier-native-maintenance170',runId),true);
 fs.mkdirSync(home,{recursive:true});const resultFile=path.join(home,'results.json');
 const report={version:1,stageNamespace:identity.namespace,hostId:identity.namespace,profileId:PROFILE,
  selfSha256:expected.selfSha256,pinsSha256:expected.pinsSha256,hostSourceSha256:digestFile(path.join(ROOT,'stage1','host.cjs')),
  ledgerExeSha256:entry.sha256,runtimeFiles:entry.files.length,actualRestrictedNode:true,productExecutorIsReal:true,
  oldStageRestoreControllerUsedForThisContract:false,nativeSuccess:false,completeProductRestoreVerified:false,cases:[],startedAt:new Date().toISOString()};
 let primaryFailure,unexpectedFailure;
 try{
  await host.withFrozen(async()=>{
   const original={};for(const slot of ['sales','ledger','inventory']){const field=slot==='sales'?'dataDir':slot+'Dir',name={sales:'jewelry.sqlite',ledger:'ledger.db',inventory:'stockcheck.db'}[slot];original[slot]=digestFile(path.join(host.layout[field],name));}
   const layout={};for(const[field,name]of Object.entries({dataDir:'sales',ledgerDir:'ledger',inventoryDir:'inventory',profileDir:'profile',configDir:'config',runtimeDir:'runtime',logDir:'logs',backupDir:'backups',documentsDir:'documents',quoteImagesDir:'quote-images'})){layout[field]=host.policy.check(path.join(home,name),true);fs.mkdirSync(layout[field]);}
   // Manual bounded copy through the original registered file APIs. The DB
   // itself is a real SQLite backup, never a guessed DDL or a raw WAL copy.
   const copied={files:0,bytes:0};
   function copyTree(source,target,skip=new Set()){
    for(const name of fs.readdirSync(source)){
     if(skip.has(name))continue;const from=host.policy.check(path.join(source,name)),to=host.policy.check(path.join(target,name),true),st=fs.lstatSync(from);
     assert(!st.isSymbolicLink());if(st.isDirectory()){fs.mkdirSync(to);copyTree(from,to);}else{assert(st.isFile()&&st.nlink===1);copied.files++;copied.bytes+=st.size;assert(copied.files<=5000&&copied.bytes<=256*1024*1024,'Fictional dataset exceeds the reviewed bounded clone');fs.copyFileSync(from,to,fs.constants.COPYFILE_EXCL);assert.equal(digestFile(to),digestFile(from));}
    }
   }
   for(const[slot,field,name]of [['sales','dataDir','jewelry.sqlite'],['ledger','ledgerDir','ledger.db'],['inventory','inventoryDir','stockcheck.db']]){
    copyTree(host.layout[field],layout[field],new Set([name,name+'-wal',name+'-shm',name+'-journal']));
    const source=slot==='sales'?host.backend.runtime.sqlite:new sqlite.DatabaseSync(path.join(host.layout[field],name),{readOnly:true});
    try{await sqlite.backup(source,path.join(layout[field],name));}finally{if(slot!=='sales')source.close();}
   }
   const context=createBusinessMaintenanceContext({root:home,layout,hostId:identity.namespace,profileId:PROFILE,provisionOwner:true});
   report.businessNamespace=context.namespace;report.clone={files:copied.files,bytes:copied.bytes};
   assert.equal(context.namespace,identity.namespace+':'+PROFILE);
   const sales=new sqlite.DatabaseSync(path.join(layout.dataDir,'jewelry.sqlite'));
   try{
   const backups=createBusinessBackups({context,salesDatabase:()=>sales,withFrozen:action=>action()});
   const saved=await backups.createFrozen({kind:'manual'}),staged=await backups.verifyAndStage(saved.file);
   assert.equal(staged.header.namespace,context.namespace);report.archive=path.basename(saved.file);
   function moneyDigest(){const db=new sqlite.DatabaseSync(path.join(layout.ledgerDir,'ledger.db'),{readOnly:true});try{const rows={};for(const table of CASH_TABLES){assert(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table),'Existing fictional cashier/ERP fixture required: '+table);rows[table]=db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all();}assert(rows.cashier_postings.length>0,'Use the existing H01-H06 confirmed cash fixture, do not invent an opening balance');return crypto.createHash('sha256').update(canonical(rows)).digest('hex');}finally{db.close();}}
   const before=moneyDigest(),privateSettings=path.join(layout.profileDir,'native-ledger-modules.json');
   async function executeProduct(invocation){
    const manager=createLegacyModules({settingsFile:privateSettings,runtimeDir:path.join(layout.runtimeDir,'module-cache'),packagedDir});
    try{await manager.configure('ledger',layout.ledgerDir);assert(manager.status().modules.every(x=>!x.running));return await manager.executeCashierMaintenance(invocation);}
    finally{await manager.close({strict:true});}
   }
   const service=createCashierMaintenance({context,execute:executeProduct}),txId=crypto.randomUUID();let receipt,swapped=false;
   try{
    receipt=await service.merge(staged,txId);assert.equal(receipt.version,1,'A real successful product merge receipt is mandatory');
    const job=path.join(layout.runtimeDir,'restorations',txId);
    fs.renameSync(context.policy.check(layout.ledgerDir,true),context.policy.check(path.join(job,'previous-ledger'),true));
    fs.renameSync(context.policy.check(path.join(staged.directory,'ledger'),true),context.policy.check(layout.ledgerDir,true));swapped=true;
    assert.equal((await service.verify(txId,receipt)).verified,true,'Real private verify must succeed after publication');
    assert.equal(moneyDigest(),before,'A normal native merge/swap/verify cannot change cash or ERP facts');
    report.cases.push({id:'N01',name:'real product merge -> directory swap -> verify',passed:true});
   }catch(error){
    primaryFailure=error;report.cases.push({id:'N01',name:'real product merge -> directory swap -> verify',passed:false,error:errorRecord(error),swapped});
    if(swapped){const job=path.join(layout.runtimeDir,'restorations',txId);fs.renameSync(layout.ledgerDir,path.join(job,'rejected-ledger-'+crypto.randomUUID()));fs.renameSync(path.join(job,'previous-ledger'),layout.ledgerDir);assert.equal((await service.verifyRollback(txId,receipt)).verified,true,'Failed private verification must not bypass real rollback verification');}
    assert.equal(moneyDigest(),before,'Rejected primary input must not alter funds');
   }
   if(primaryFailure){
    report.cases.push({id:'N02',name:'old-env direct registered CLI negative control',passed:false,notRun:'Deferred until the mandatory normal product CLI path succeeds'});
    report.cases.push({id:'N03',name:'real product rejects missing confirmed funds before swap',passed:false,notRun:'Blocked by the failed mandatory normal product CLI path'});
    report.cases.push({id:'N04',name:'signed-directory replacement identity rejection',passed:false,notRun:'Blocked by the failed mandatory normal product CLI path'});
    throw primaryFailure;
   }
   // Independent diagnostic: actual registered CLI + allowed file handles.
   // This intentionally is not executeCashierMaintenance and never constitutes
   // a positive product test. It proves old ticket env names remain rejected.
   const rawCalls=[];
   const envProbe=createCashierMaintenance({context,execute:async invocation=>{
    const id=crypto.randomUUID(),input=path.join(layout.runtimeDir,'probe-'+id+'.stdin'),output=path.join(layout.logDir,'probe-'+id+'.stdout'),errors=path.join(layout.logDir,'probe-'+id+'.stderr');fs.writeFileSync(input,'',{flag:'wx'});
    const descriptors=[fs.openSync(input,'r'),fs.openSync(output,'wx'),fs.openSync(errors,'wx')];
    let child;try{child=require('node:child_process').spawn(executable,['--module','ledger','--cashier-maintenance',invocation.phase],
     {cwd:path.dirname(executable),windowsHide:true,shell:false,stdio:descriptors,env:{...process.env,LEDGER_DATA:layout.ledgerDir,XJY_MODULE_TOKEN:invocation.token,XJY_CASHIER_MAINTENANCE_REQUEST:invocation.request,XJY_CASHIER_MAINTENANCE_SIGNATURE:invocation.signature}});}finally{for(const fd of descriptors)fs.closeSync(fd);}
    const observed=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(exitCode,signal)=>resolve({exitCode,signal,pid:child.pid}));});
    assert.equal(observed.signal,null);assert(Number.isInteger(observed.exitCode));assert(regular(output).size<=65536);assert(regular(errors).size<=16384);
    const response={exitCode:observed.exitCode,stdout:fs.readFileSync(output,'utf8'),stderr:fs.readFileSync(errors,'utf8')};rawCalls.push({...observed,stdout:response.stdout,stderr:response.stderr});return response;
   }});
   const probeStage=await backups.verifyAndStage(saved.file);let probeError;
   try{await envProbe.merge(probeStage,crypto.randomUUID());}catch(error){probeError=error;}
   report.legacyEnvDiagnostic={productExecutorUsed:false,calls:rawCalls,serviceError:probeError?errorRecord(probeError):null};
   assert.equal(rawCalls.length,1,'Old-env diagnostic must really launch and await one registered child');
   assert.notEqual(rawCalls[0].exitCode,0,'Old unregistered ticket names must not be admitted');
   assert.match(rawCalls[0].stderr,/Signed private maintenance ticket required/,'Record unexpected prerequisites separately; do not relabel them as env stripping');
   assert(probeError,'Unsigned/missing ticket response cannot be accepted by the real service');
   assert.equal(moneyDigest(),before);report.cases.push({id:'N02',name:'old-env direct registered CLI negative control',passed:true,productExecutorUsed:false,child:rawCalls[0],serviceError:errorRecord(probeError)});
   if(!primaryFailure){
    const negative=await backups.verifyAndStage(saved.file),db=new sqlite.DatabaseSync(path.join(negative.directory,'ledger','ledger.db'));
    try{
     db.exec('PRAGMA foreign_keys=ON');const posting=db.prepare("SELECT p.id FROM cashier_postings p JOIN cashier_documents d ON d.id=p.doc_id WHERE d.status='confirmed' AND NOT EXISTS(SELECT 1 FROM cashier_reconciliation_locks l WHERE l.posting_id=p.id) ORDER BY p.id LIMIT 1").get();assert(posting,'Existing un-reconciled fictional confirmed posting required');
     const trigger=db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='cashier_postings_no_delete'").get();assert(trigger?.sql);db.exec('BEGIN IMMEDIATE');
     try{db.exec('DROP TRIGGER cashier_postings_no_delete');db.prepare('DELETE FROM cashier_postings WHERE id=?').run(posting.id);db.exec(trigger.sql);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
    }finally{db.close();}
    let moneyError;try{await service.merge(negative,crypto.randomUUID());}catch(error){moneyError=error;}
    assert(moneyError,'A staged archive missing confirmed funds must be rejected');assert.match(moneyError.message,/恢复已停止.*出纳已确认资金|归档缺少已确认资金/);assert.equal(moneyDigest(),before);
    report.cases.push({id:'N03',name:'real product rejects missing confirmed funds before swap',passed:true,error:errorRecord(moneyError)});
   }else report.cases.push({id:'N03',name:'real product rejects missing confirmed funds before swap',passed:false,notRun:'Blocked by the failed mandatory normal CLI path'});
   // N04 is the sole new scenario. N01/N02/N03 above are unchanged repeat
   // regression. Never refresh/re-sign the ticket after replacing its directory.
   const n04Stage=await backups.verifyAndStage(saved.file),n04Tx=crypto.randomUUID();
   const n04StageDb=path.join(n04Stage.directory,'ledger','ledger.db'),n04StageHash=digestFile(n04StageDb);
   const n04Calls=[];let n04ServiceError,n04Failure;
   const n04Identity=directory=>{const st=fs.statSync(context.policy.check(directory),{bigint:true});assert(st.isDirectory());return{dev:st.dev.toString(),ino:st.ino.toString()};};
   const n04Before=n04Identity(layout.ledgerDir),n04Money=moneyDigest();assert.equal(n04Money,before);
   const n04Service=createCashierMaintenance({context,execute:async invocation=>{
    assert.equal(invocation.phase,'merge');
    const ticket=JSON.parse(Buffer.from(invocation.request,'base64url').toString('utf8'));
    assert.equal(ticket.txId,n04Tx);assert.equal(ticket.namespace,context.namespace);assert.equal(ticket.stageId,path.basename(n04Stage.directory));
    assert(UUID.test(ticket.nonce));assert.deepEqual(ticket.identities.ledger,n04Before,'The real service must bind the original directory before replacement');
    assert.equal(invocation.signature,crypto.createHmac('sha256',Buffer.from(invocation.token,'utf8')).update('xjy-cashier-maintenance-v1\0').update(invocation.request,'ascii').digest('hex'),'Ticket must already be genuinely signed');
    const job=context.policy.check(path.join(layout.runtimeDir,'restorations',n04Tx));
    const held=context.policy.check(path.join(job,'n04-held-original-ledger'),true);
    const prepared=context.policy.check(path.join(job,'n04-complete-replacement'),true);
    const rejected=context.policy.check(path.join(job,'n04-retained-replacement'),true);
    const nonceFile=context.policy.check(path.join(job,'cashier-nonce-'+ticket.nonce+'.json'));
    assert(!fs.existsSync(held)&&!fs.existsSync(prepared)&&!fs.existsSync(rejected));assert(!fs.existsSync(nonceFile),'Fresh signed nonce must not be consumed before launch');
    const observed={txId:n04Tx,nonce:ticket.nonce,originalIdentity:n04Before,productExecutorUsed:true,nonceConsumedBefore:false,originalRestored:false};
    n04Calls.push(observed);let moved=false,replacementIdentity;
    try{
     fs.renameSync(context.policy.check(layout.ledgerDir,true),held);moved=true;assert.deepEqual(n04Identity(held),n04Before);
     fs.mkdirSync(prepared);copyTree(held,prepared); // full ordinary-file copy; no DDL, omitted files, links or algorithm stub
     replacementIdentity=n04Identity(prepared);assert.equal(replacementIdentity.dev,n04Before.dev);assert.notEqual(replacementIdentity.ino,n04Before.ino,'Replacement must be a different real directory object');
     fs.renameSync(prepared,context.policy.check(layout.ledgerDir,true));observed.replacementIdentity=replacementIdentity;
     assert.deepEqual(n04Identity(layout.ledgerDir),replacementIdentity);assert.equal(moneyDigest(),n04Money,'Complete replacement copy must contain identical funds before execution');
     assert(Date.now()<ticket.expiresAt,'Fixture copying exhausted the original ticket lifetime; do not replace the identity assertion with expiry or re-sign the ticket');
     const reply=await executeProduct(invocation); // unchanged original signed bytes/token, real product executor and compiled ledger
     observed.reply={exitCode:reply.exitCode,stdout:reply.stdout,stderr:reply.stderr};observed.nonceConsumedAfter=fs.existsSync(nonceFile);
     assert(Number.isInteger(reply.exitCode)&&reply.exitCode!==0,'Native worker must reject the replaced directory');
     assert.equal(reply.stderr.trim(),'CASHIER_DIRECTORY_IDENTITY_MISMATCH','Only the exact stable identity rejection proves this negative control');
     assert.equal(reply.stdout.trim(),'','Identity rejection must not emit any success receipt');
     assert.equal(observed.nonceConsumedAfter,false,'Directory rejection must happen before consuming the signed nonce');
     return reply;
    }finally{
     // Restore only this case's private fixture. Retain the complete substituted
     // copy as evidence; never remove or overwrite an unknown directory.
     if(moved){
      assert.deepEqual(n04Identity(held),n04Before,'Original retained directory identity must remain exact');
      if(fs.existsSync(layout.ledgerDir)){
       assert(replacementIdentity,'An unexpected live directory cannot be replaced during cleanup');
       assert.deepEqual(n04Identity(layout.ledgerDir),replacementIdentity,'Refuse to overwrite an unexpected replacement');
       assert(!fs.existsSync(rejected));fs.renameSync(context.policy.check(layout.ledgerDir,true),rejected);
      }
      fs.renameSync(held,context.policy.check(layout.ledgerDir,true));
      assert.deepEqual(n04Identity(layout.ledgerDir),n04Before);assert.equal(moneyDigest(),n04Money);
      observed.originalRestored=true;
     }
     observed.nonceConsumedFinally=fs.existsSync(nonceFile);
    }
   }});
   try{
    try{await n04Service.merge(n04Stage,n04Tx);}catch(error){n04ServiceError=error;}
    assert.equal(n04Calls.length,1,'Exactly one actual signed invocation must reach the replacement callback');
    assert(n04ServiceError,'The real maintenance service must refuse the rejected worker result');
    assert(n04Calls[0].reply,'A setup/guard error before the real worker reply is not the identity negative control');
    assert.equal(n04Calls[0].reply.stderr.trim(),'CASHIER_DIRECTORY_IDENTITY_MISMATCH');
    assert(Number.isInteger(n04Calls[0].reply.exitCode)&&n04Calls[0].reply.exitCode!==0);assert.equal(n04Calls[0].reply.stdout.trim(),'');
    assert.equal(n04Calls[0].originalRestored,true);assert.equal(n04Calls[0].nonceConsumedFinally,false);
    assert(!fs.existsSync(context.policy.check(path.join(layout.runtimeDir,'restorations',n04Tx,'cashier-receipt.json'))),'No accepted merge receipt may be published');
    assert.deepEqual(n04Identity(layout.ledgerDir),n04Before);assert.equal(moneyDigest(),before);assert.equal(digestFile(n04StageDb),n04StageHash,'Rejected ticket must not change staged funds');
   }catch(error){n04Failure=error;throw error;}
   finally{report.cases.push({id:'N04',name:'signed-directory replacement identity rejection',passed:!n04Failure,productExecutorUsed:true,calls:n04Calls,serviceError:n04ServiceError?errorRecord(n04ServiceError):null,...(n04Failure?{error:errorRecord(n04Failure)}:{})});}
   }finally{sales.close();
    for(const slot of ['sales','ledger','inventory']){const field=slot==='sales'?'dataDir':slot+'Dir',name={sales:'jewelry.sqlite',ledger:'ledger.db',inventory:'stockcheck.db'}[slot];assert.equal(digestFile(path.join(host.layout[field],name)),original[slot],'Original existing fictional dataset changed: '+slot);}
    report.originalDatasetsUnchanged=true;
   }
  });
  assert.ifError(primaryFailure);assert.equal(report.cases.length,4);assert(report.cases.every(x=>x.passed));report.nativeSuccess=true;
 }catch(error){unexpectedFailure=error;report.error=errorRecord(error);}
 finally{
  try{verifyBundle();for(const[name,sha]of Object.entries(pins.sources))pin(name,sha);pin(SELF,expected.selfSha256);pin(PINS,expected.pinsSha256);assert.equal(digestFile(path.join(ROOT,'isolation-identity.json')),identityHash);report.sourcePinsStable=true;}catch(error){unexpectedFailure=unexpectedFailure||error;report.finalSourceError=errorRecord(error);report.nativeSuccess=false;}
  report.finishedAt=new Date().toISOString();fs.writeFileSync(resultFile,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({nativeSuccess:report.nativeSuccess,cases:report.cases.map(x=>({id:x.id,passed:x.passed})),results:resultFile}));
 }
 if(unexpectedFailure)throw Object.assign(new Error('真实出纳维护CLI验收失败；已保留 '+resultFile+'；'+unexpectedFailure.message),{cause:unexpectedFailure});
 return report;
}
module.exports={verify};

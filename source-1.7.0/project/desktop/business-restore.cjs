'use strict';
// Owned business-data publisher. Never accepts a user-supplied destination.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{DatabaseSync}=require('node:sqlite');
const {capturedSlots}=require('./business-backups.cjs');
function createBusinessRestore({context,backups,freeze,prepare,stop,resume,database,invalidateSessions,cashierMaintenance}){
 const {root,layout,policy,namespace}=require("./business-maintenance-layout.cjs").requireContext(context);
 const fs=policy.io;
 const DatabaseSync=policy.DatabaseSync;
 const cashier=require('./cashier-maintenance.cjs');
 if(cashierMaintenance!==undefined)cashier.requireCashierMaintenance(cashierMaintenance,context);

 const slots={sales:layout.dataDir,ledger:layout.ledgerDir,inventory:layout.inventoryDir,documents:layout.documentsDir,quoteImages:layout.quoteImagesDir};
 const journal=path.join(layout.runtimeDir,'restore-transaction.json'),reservationFile=path.join(layout.configDir,'document-number-reservations.json');let active=false;
 const checked=(x,write=false)=>policy.check(x,write);
 function save(file,value){checked(file,true);const temporary=checked(file+'.'+crypto.randomUUID()+'.tmp',true),fd=fs.openSync(temporary,'wx',0o600);try{fs.writeSync(fd,JSON.stringify(value));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temporary,checked(file,true));}
 function validate(tx){
  if(tx.version!==1||tx.namespace!==namespace||! /^[a-f0-9-]{36}$/.test(tx.id)||!Array.isArray(tx.selected)||!tx.selected.length||new Set(tx.selected).size!==tx.selected.length||tx.selected.some(x=>typeof x!=='string'||!Object.hasOwn(slots,x)))throw new Error('Invalid recovery journal');
  if(!['PREPARED','SWAPPING','PUBLISHED','COMMITTED','ROLLED_BACK','ROLLBACK_VERIFY_REQUIRED'].includes(tx.state))throw new Error('Invalid recovery state');
  const stage=checked(tx.stage,true);if(path.dirname(stage)!==path.join(layout.runtimeDir,'restore-stage')||! /^[a-f0-9-]{36}$/.test(path.basename(stage)))throw new Error('Invalid recovery stage');
  if(tx.cashier!==undefined){if(!tx.selected.includes('ledger'))throw Error('Cashier recovery requires the ledger slot');cashier.validateRecoveryRecord(tx.cashier);}
  if(tx.cashierRollbackVerified!==undefined&&(!tx.cashier||typeof tx.cashierRollbackVerified!=='boolean'))throw Error('Cashier rollback verification marker invalid');
  if(tx.state==='ROLLBACK_VERIFY_REQUIRED'&&(!tx.cashier||tx.cashierRollbackVerified!==false)||tx.cashierRollbackVerified===true&&tx.state!=='ROLLED_BACK')throw Error('Cashier rollback verification state invalid');
  return tx;
 }
 function previous(tx,name){return checked(path.join(layout.runtimeDir,'restorations',tx.id,'previous-'+name),true);}
 function rollbackFiles(){
  if(!fs.existsSync(checked(journal)))return{recovered:false};const tx=validate(JSON.parse(fs.readFileSync(journal)));
  if(['COMMITTED','ROLLED_BACK','ROLLBACK_VERIFY_REQUIRED'].includes(tx.state))return{recovered:false,state:tx.state,transaction:tx};
  for(const name of [...tx.selected].reverse()){
   const old=previous(tx,name),live=checked(slots[name],true);
   if(fs.existsSync(old)){if(fs.existsSync(live))fs.renameSync(live,checked(path.join(path.dirname(old),'rejected-'+name+'-'+crypto.randomUUID()),true));fs.renameSync(old,live);}
   if(!fs.existsSync(live))throw new Error('Recovery incomplete; refusing empty initialization');
  }
  if(tx.cashier)cashier.verifyCashierRollbackFiles(context,tx.cashier,tx.id);
  if(tx.cashier)tx.cashierRollbackVerified=false;
  tx.state=tx.cashier?'ROLLBACK_VERIFY_REQUIRED':'ROLLED_BACK';save(journal,tx);return{recovered:true,state:tx.state,transaction:tx};
 }
 function recover(){
  const result=rollbackFiles(),tx=result.transaction;
  const publicResult={recovered:result.recovered,...(result.state?{state:result.state}:{})};
  if(tx?.cashier&&['ROLLED_BACK','ROLLBACK_VERIFY_REQUIRED'].includes(tx.state)&&tx.cashierRollbackVerified!==true){
   if(!cashierMaintenance)throw Object.assign(Error('出纳回滚原件已保留，但受信恢复核验尚未完成，禁止开启业务'),{code:'CASHIER_ROLLBACK_VERIFY_REQUIRED',status:503});
   return cashierMaintenance.verifyRollback(tx.id,tx.cashier).then(()=>{tx.cashierRollbackVerified=true;tx.state='ROLLED_BACK';save(journal,tx);return{...publicResult,state:tx.state};});
  }
  return publicResult;
 }
 function reserve(staged){
  const current=database(),db=new DatabaseSync(checked(path.join(staged.directory,'sales','jewelry.sqlite'),true));let transaction=false;
  try{
   // The caller still holds its live SQL prepare lease. This synchronous helper
   // only edits the checked staged handle; current identities/passwords/grants
   // and logs cannot be rolled back with older business records.
   require('./business-authority-preserve.cjs').preserveCurrentAuthority({current,staged:db,now:new Date().toISOString()});
   const sequences=current.prepare('SELECT scope,last_value FROM document_sequences').all(),numbers=current.prepare('SELECT * FROM document_number_ledger').all();
   const old=fs.existsSync(checked(reservationFile))?JSON.parse(fs.readFileSync(reservationFile)):{version:1,namespace,sequences:{},numbers:{}};
   if(old.version!==1||old.namespace!==namespace)throw new Error('Invalid number reservation store');
   for(const item of sequences)old.sequences[item.scope]=Math.max(old.sequences[item.scope]||0,item.last_value);
   for(const item of numbers){const prior=old.numbers[item.number];if(prior&&prior.quote_id!==item.quote_id)throw new Error('Document number identity conflict');old.numbers[item.number]={...item,reservedAt:new Date().toISOString()};}
   save(reservationFile,old);db.exec('BEGIN IMMEDIATE');transaction=true;
   require('./sales-request-knowledge.cjs').preserveSalesRequests({current,staged:db});
   for(const[scope,value]of Object.entries(old.sequences))db.prepare('INSERT INTO document_sequences(scope,last_value) VALUES(?,?) ON CONFLICT(scope) DO UPDATE SET last_value=max(last_value,excluded.last_value)').run(scope,value);
   db.exec('COMMIT');transaction=false;
  }catch(error){if(transaction)db.exec('ROLLBACK');throw error;}finally{db.close();}
 }
 function validateOwnedArchive(staged,selected){if(staged.header.namespace!==namespace||selected.some(name=>!fs.existsSync(checked(path.join(staged.directory,name)))))throw Error('Archive ownership or complete business data invalid');}
 function cashierPresent(staged){
  for(const file of [path.join(layout.ledgerDir,'ledger.db'),path.join(staged.directory,'ledger','ledger.db')]){
   const db=new DatabaseSync(checked(file),{readOnly:true});
   try{if(db.prepare("SELECT 1 FROM sqlite_master WHERE name LIKE 'cashier_%' LIMIT 1").get())return true;}finally{db.close();}
  }
  return false;
 }
 function failureWarning(error,warning){
  // Secondary diagnostics must never replace a real transaction/recovery error.
  if(error&&typeof error==='object')try{if(!Object.hasOwn(error,'restoreWarnings'))Object.defineProperty(error,'restoreWarnings',{value:[],enumerable:true,configurable:true});if(Array.isArray(error.restoreWarnings))error.restoreWarnings.push(warning);}catch{}
 }
 async function restore(filename,selection){
  if([backups?.verifyAndStage,freeze,prepare,stop,resume,database,invalidateSessions].some(fn=>typeof fn!=='function'))throw TypeError('Trusted restore lifecycle and invalidation callbacks required');
  if(!['sales','ledger','inventory','documents','allBusiness'].includes(selection))throw new Error('Invalid restore selection');if(active)throw new Error('Restore already active');active=true;let stopped=false,tx,staged,committedResult,rollbackComplete=false,failed=false,failure;
  try{
   staged=await backups.verifyAndStage(filename);const captured=capturedSlots(staged.header),selected=selection==='allBusiness'?Object.keys(slots).filter(name=>captured.includes(name)):selection==='documents'?['documents',...(captured.includes('quoteImages')?['quoteImages']:[])]:[selection];validateOwnedArchive(staged,selected);
   return await freeze(async()=>{
    const restoreId=crypto.randomUUID();let cashierRecord;
    const preRestore=await prepare(async()=>{const backup=await backups.createFrozen({kind:'pre-restore'});if(selected.includes('sales'))reserve(staged);
     if(selected.includes('ledger')){if(cashierMaintenance)cashierRecord=await cashierMaintenance.merge(staged,restoreId);else if(cashierPresent(staged))throw Error('出纳恢复安全服务尚未接入，已停止恢复，请先完成受审升级');}
     return backup;});
    tx={version:1,namespace,id:restoreId,selected,stage:staged.directory,state:'PREPARED',at:new Date().toISOString(),preRestore:path.basename(preRestore.file),...(cashierRecord?{cashier:cashierRecord}:{})};validate(tx);
    fs.mkdirSync(checked(path.join(layout.runtimeDir,'restorations',tx.id),true),{recursive:true});save(journal,tx);
    await stop();stopped=true;
    try{
     tx.state='SWAPPING';save(journal,tx);
     for(const [index,name]of selected.entries()){const live=checked(slots[name],true),source=checked(path.join(staged.directory,name),true);if(!fs.existsSync(live)||!fs.existsSync(source))throw new Error('Restore dataset missing');fs.renameSync(live,previous(tx,name));fs.renameSync(source,live);}
     tx.state='PUBLISHED';save(journal,tx);if(tx.cashier)await cashierMaintenance.verify(tx.id,tx.cashier);await invalidateSessions();await resume();stopped=false;tx.state='COMMITTED';save(journal,tx);
    }catch(error){
     if(!stopped){await stop();stopped=true;}const recovered=rollbackFiles();tx=recovered.transaction||tx;
     if(tx.cashier){await cashierMaintenance.verifyRollback(tx.id,tx.cashier);tx.cashierRollbackVerified=true;tx.state='ROLLED_BACK';save(journal,tx);}
     await resume();stopped=false;rollbackComplete=tx.state==='ROLLED_BACK';
     try{fs.appendFileSync(checked(path.join(layout.logDir,'restore-operations.jsonl'),true),JSON.stringify({id:tx.id,at:tx.at,selected,status:'rolled-back',error:error.message})+'\n');}
     catch(logError){failureWarning(error,{code:'RESTORE_ROLLBACK_LOG_FAILED',log:'restore-operations.jsonl',message:'恢复未完成，回滚后的操作日志未写入',detail:String(logError.message||logError).slice(0,800)});}
     throw error;
    }
     // This boundary is reached only after save(COMMITTED) returned. An
     // in-memory state assignment is not evidence of a durable commit.
     const result=committedResult={ok:true,selected,preRestore:preRestore.file,sessionsInvalidated:true};
     try{fs.appendFileSync(checked(path.join(layout.logDir,'restore-operations.jsonl'),true),JSON.stringify({id:tx.id,at:tx.at,selected,status:'committed',preRestore:tx.preRestore})+'\n');}
     catch(error){result.warnings=[{code:'RESTORE_OPERATION_LOG_FAILED',log:'restore-operations.jsonl',message:'业务资料已恢复，但恢复操作日志未写入',detail:String(error.message||error).slice(0,800)}];}
     return result;
   });
  }catch(error){failed=true;failure=error;throw error;}
  finally{
   try{
    // A failed save may leave tx.state='COMMITTED' only in memory. Never use
    // that assignment to clean a stage still needed by real recovery.
    if(staged&&(!tx||committedResult||rollbackComplete)){
     try{if(fs.existsSync(checked(staged.directory)))backups.discardStage(staged.directory);}
     catch(error){
      const warning={code:'RESTORE_STAGE_CLEANUP_FAILED',stage:staged.directory,message:committedResult&&!failed?'业务资料已恢复，但暂存目录清理未完成，已保留原目录':'恢复未完成，暂存目录清理未完成，已保留原目录',detail:String(error.message||error).slice(0,800)};
      if(committedResult&&!failed)(committedResult.warnings??=[]).push(warning);
      else if(failed)failureWarning(failure,warning);
      else throw error;
     }
    }
   }finally{active=false;}
  }
 }
 return{restore,recover};
}
module.exports={createBusinessRestore};

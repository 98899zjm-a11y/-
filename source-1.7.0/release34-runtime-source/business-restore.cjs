'use strict';
// Owned business-data publisher. Never accepts a user-supplied destination.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{DatabaseSync}=require('node:sqlite');
const {capturedSlots}=require('./business-backups.cjs');
function createBusinessRestore({context,backups,freeze,prepare,stop,resume,database,invalidateSessions}){
 const {root,layout,policy,namespace}=require("./business-maintenance-layout.cjs").requireContext(context);
 const fs=policy.io;
 const DatabaseSync=policy.DatabaseSync;

 const slots={sales:layout.dataDir,ledger:layout.ledgerDir,inventory:layout.inventoryDir,documents:layout.documentsDir,quoteImages:layout.quoteImagesDir};
 const journal=path.join(layout.runtimeDir,'restore-transaction.json'),reservationFile=path.join(layout.configDir,'document-number-reservations.json');let active=false;
 const checked=(x,write=false)=>policy.check(x,write);
 function save(file,value){checked(file,true);const temporary=checked(file+'.'+crypto.randomUUID()+'.tmp',true),fd=fs.openSync(temporary,'wx',0o600);try{fs.writeSync(fd,JSON.stringify(value));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temporary,checked(file,true));}
 function validate(tx){
  if(tx.version!==1||tx.namespace!==namespace||! /^[a-f0-9-]{36}$/.test(tx.id)||!Array.isArray(tx.selected)||!tx.selected.length||new Set(tx.selected).size!==tx.selected.length||tx.selected.some(x=>typeof x!=='string'||!Object.hasOwn(slots,x)))throw new Error('Invalid recovery journal');
  if(!['PREPARED','SWAPPING','PUBLISHED','COMMITTED','ROLLED_BACK'].includes(tx.state))throw new Error('Invalid recovery state');
  const stage=checked(tx.stage,true);if(path.dirname(stage)!==path.join(layout.runtimeDir,'restore-stage')||! /^[a-f0-9-]{36}$/.test(path.basename(stage)))throw new Error('Invalid recovery stage');
  return tx;
 }
 function previous(tx,name){return checked(path.join(layout.runtimeDir,'restorations',tx.id,'previous-'+name),true);}
 function recover(){
  if(!fs.existsSync(checked(journal)))return{recovered:false};const tx=validate(JSON.parse(fs.readFileSync(journal)));
  if(['COMMITTED','ROLLED_BACK'].includes(tx.state))return{recovered:false,state:tx.state};
  for(const name of [...tx.selected].reverse()){
   const old=previous(tx,name),live=checked(slots[name],true);
   if(fs.existsSync(old)){if(fs.existsSync(live))fs.renameSync(live,checked(path.join(path.dirname(old),'rejected-'+name+'-'+crypto.randomUUID()),true));fs.renameSync(old,live);}
   if(!fs.existsSync(live))throw new Error('Recovery incomplete; refusing empty initialization');
  }
  tx.state='ROLLED_BACK';save(journal,tx);return{recovered:true,state:tx.state};
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
   for(const[scope,value]of Object.entries(old.sequences))db.prepare('INSERT INTO document_sequences(scope,last_value) VALUES(?,?) ON CONFLICT(scope) DO UPDATE SET last_value=max(last_value,excluded.last_value)').run(scope,value);
   db.exec('COMMIT');transaction=false;
  }catch(error){if(transaction)db.exec('ROLLBACK');throw error;}finally{db.close();}
 }
 function validateOwnedArchive(staged,selected){if(staged.header.namespace!==namespace||selected.some(name=>!fs.existsSync(checked(path.join(staged.directory,name)))))throw Error('Archive ownership or complete business data invalid');}
 async function restore(filename,selection){
  if([backups?.verifyAndStage,freeze,prepare,stop,resume,database,invalidateSessions].some(fn=>typeof fn!=='function'))throw TypeError('Trusted restore lifecycle and invalidation callbacks required');
  if(!['sales','ledger','inventory','documents','allBusiness'].includes(selection))throw new Error('Invalid restore selection');if(active)throw new Error('Restore already active');active=true;let stopped=false,tx,staged;
  try{
   staged=await backups.verifyAndStage(filename);const captured=capturedSlots(staged.header),selected=selection==='allBusiness'?Object.keys(slots).filter(name=>captured.includes(name)):selection==='documents'?['documents',...(captured.includes('quoteImages')?['quoteImages']:[])]:[selection];validateOwnedArchive(staged,selected);
   return await freeze(async()=>{
    const preRestore=await prepare(async()=>{const backup=await backups.createFrozen({kind:'pre-restore'});if(selected.includes('sales'))reserve(staged);return backup;});
    tx={version:1,namespace,id:crypto.randomUUID(),selected,stage:staged.directory,state:'PREPARED',at:new Date().toISOString(),preRestore:path.basename(preRestore.file)};validate(tx);
    fs.mkdirSync(checked(path.join(layout.runtimeDir,'restorations',tx.id),true),{recursive:true});save(journal,tx);
    await stop();stopped=true;
    try{
     tx.state='SWAPPING';save(journal,tx);
     for(const [index,name]of selected.entries()){const live=checked(slots[name],true),source=checked(path.join(staged.directory,name),true);if(!fs.existsSync(live)||!fs.existsSync(source))throw new Error('Restore dataset missing');fs.renameSync(live,previous(tx,name));fs.renameSync(source,live);}
     tx.state='PUBLISHED';save(journal,tx);await invalidateSessions();await resume();stopped=false;tx.state='COMMITTED';save(journal,tx);
     fs.appendFileSync(checked(path.join(layout.logDir,'restore-operations.jsonl'),true),JSON.stringify({id:tx.id,at:tx.at,selected,status:'committed',preRestore:tx.preRestore})+'\n');
     return{ok:true,selected,preRestore:preRestore.file,sessionsInvalidated:true};
    }catch(error){if(!stopped){await stop();stopped=true;}tx.state=recover().state||tx.state;await resume();stopped=false;fs.appendFileSync(checked(path.join(layout.logDir,'restore-operations.jsonl'),true),JSON.stringify({id:tx.id,at:tx.at,selected,status:'rolled-back',error:error.message})+'\n');throw error;}
   });
  }finally{active=false;if(staged&&(!tx||['COMMITTED','ROLLED_BACK'].includes(tx.state))&&fs.existsSync(checked(staged.directory)))backups.discardStage(staged.directory);}
 }
 return{restore,recover};
}
module.exports={createBusinessRestore};

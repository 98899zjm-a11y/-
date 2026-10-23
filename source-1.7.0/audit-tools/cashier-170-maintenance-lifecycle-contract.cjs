'use strict';
// Root calls registerContracts only after real Guest admission and exact pins.
// Real owned paths, SQLite, encrypted archives, swaps and recovery are used.
// execute is explicitly a non-monetary process-result port in these three
// ordering tests. Python worker contracts separately exercise actual cash math;
// this file does NOT claim native signed-worker integration is verified.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}':JSON.stringify(value);
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
function registerContracts({root,admitted,test,assert,DatabaseSync,createContext,createBackups,createRestore,createCashierMaintenance}){
 if(admitted!==true||process.platform!=='win32'||path.resolve(root).toLowerCase()!=='c:\\xjy-work\\xjy-web-stage1')throw Error('Actual admitted Guest required');
 function fixture(t,failVerify=false,failRollback=false){
  const base=path.join(root,'runtime','cashier-maintenance-contracts');fs.mkdirSync(base,{recursive:true});const home=fs.mkdtempSync(path.join(base,'owned-')),layout={};
  for(const[key,name]of Object.entries({dataDir:'sales',ledgerDir:'ledger',inventoryDir:'inventory',profileDir:'profile',configDir:'config',runtimeDir:'runtime',logDir:'logs',backupDir:'backups',documentsDir:'documents',quoteImagesDir:'quote-images'})){layout[key]=path.join(home,name);fs.mkdirSync(layout[key]);}
  let sales;for(const[key,name]of [['dataDir','jewelry.sqlite'],['ledgerDir','ledger.db'],['inventoryDir','stockcheck.db']]){const db=new DatabaseSync(path.join(layout[key],name));db.exec("CREATE TABLE fictional_proof(value TEXT);INSERT INTO fictional_proof VALUES('archive')");if(key==='dataDir')sales=db;else db.close();}
  t.after(()=>{try{sales.close();}catch{}});
  const context=createContext({root:home,layout,hostId:'cashier-maintenance-synthetic',profileId:'fixture-profile',provisionOwner:true}),events=[];
  const backups=createBackups({context,salesDatabase:()=>sales,withFrozen:action=>action()});
  const currentProof=()=>{const db=new DatabaseSync(path.join(layout.ledgerDir,'ledger.db'),{readOnly:true});try{return db.prepare('SELECT value FROM fictional_proof').get().value;}finally{db.close();}};
  const execute=async invocation=>{
   const p=JSON.parse(Buffer.from(invocation.request,'base64url').toString('utf8'));
   assert.equal(invocation.signature,crypto.createHmac('sha256',invocation.token).update('xjy-cashier-maintenance-v1\0').update(invocation.request).digest('hex'));
   events.push(invocation.phase);assert.equal(p.namespace,context.namespace);assert.equal(p.action,invocation.phase);
   if(invocation.phase==='merge'){assert(events.includes('prepare-enter'));assert.equal(currentProof(),'current');}
   if(invocation.phase==='verify'){assert(events.includes('stop'));assert(!events.includes('resume'));assert.equal(currentProof(),'archive');}
   if(invocation.phase==='verify-rollback'){assert(!events.includes('resume'));assert.equal(currentProof(),'current');}
   const failed=invocation.phase==='verify'&&failVerify||invocation.phase==='verify-rollback'&&failRollback;
   const result=invocation.phase==='merge'?{receipt:{version:1,expectedHash:'b'.repeat(64),requiredDispatchGuard:false},currentHash:'a'.repeat(64),numbers:{'cashier-number-reservations.json':null,'erp-number-reservations.json':null},lostCount:0}:{verified:true};
   const body={version:1,purpose:'xjy-cashier-maintenance-result',action:p.action,txId:p.txId,nonce:p.nonce,requestHash:hash(Buffer.from(invocation.request,'ascii')),ok:!failed,result:failed?null:result,error:failed?'虚构已签名子进程拒绝':null};
   const encoded=Buffer.from(canonical(body)).toString('base64url'),signature=crypto.createHmac('sha256',invocation.token).update('xjy-cashier-maintenance-result-v1\0').update(encoded).digest('hex');
   return{exitCode:failed?1:0,stdout:JSON.stringify({encoded,signature})};
  };
  const cashierMaintenance=createCashierMaintenance({context,execute});
  const restore=createRestore({context,backups,cashierMaintenance,database:()=>sales,
   freeze:async action=>{events.push('freeze-enter');try{return await action();}finally{events.push('freeze-exit');}},
   prepare:async action=>{events.push('prepare-enter');try{return await action();}finally{events.push('prepare-exit');}},
   stop:async()=>{events.push('stop');sales.close();},resume:async()=>{events.push('resume');sales=new DatabaseSync(path.join(layout.dataDir,'jewelry.sqlite'));},invalidateSessions:async()=>events.push('invalidate')});
  return{context,layout,backups,restore,events,currentProof,mutate(){const db=new DatabaseSync(path.join(layout.ledgerDir,'ledger.db'));db.exec("UPDATE fictional_proof SET value='current'");db.close();}};
 }
 test('CM01 actual archive swap verifies before invalidation/resume under freeze',{concurrency:false},async t=>{const f=fixture(t),saved=await f.backups.create();f.mutate();const result=await f.restore.restore(saved.file,'ledger');assert.equal(result.ok,true);assert.equal(f.currentProof(),'archive');assert.deepEqual(f.events,['freeze-enter','prepare-enter','merge','prepare-exit','stop','verify','invalidate','resume','freeze-exit']);});
 test('CM02 failed publication verify restores original files then verifies rollback before resume',{concurrency:false},async t=>{const f=fixture(t,true),saved=await f.backups.create();f.mutate();await assert.rejects(f.restore.restore(saved.file,'ledger'),/虚构已签名子进程拒绝/);assert.equal(f.currentProof(),'current');assert.deepEqual(f.events,['freeze-enter','prepare-enter','merge','prepare-exit','stop','verify','verify-rollback','resume','freeze-exit']);});
 test('CM03 failed rollback verification never resumes business or permits an unchecked restart',{concurrency:false},async t=>{const f=fixture(t,true,true),saved=await f.backups.create();f.mutate();await assert.rejects(f.restore.restore(saved.file,'ledger'),/虚构已签名子进程拒绝/);assert.equal(f.currentProof(),'current');assert(!f.events.includes('resume'));assert(!f.events.includes('invalidate'));const journal=JSON.parse(fs.readFileSync(path.join(f.layout.runtimeDir,'restore-transaction.json'),'utf8'));assert.equal(journal.state,'ROLLBACK_VERIFY_REQUIRED');assert.equal(journal.cashierRollbackVerified,false);assert.throws(()=>createRestore({context:f.context}).recover(),error=>error.code==='CASHIER_ROLLBACK_VERIFY_REQUIRED');});
}
module.exports={registerContracts};

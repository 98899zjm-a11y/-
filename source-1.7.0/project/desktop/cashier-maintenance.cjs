'use strict';
// Private restore service. It receives an owned context and trusted process
// callback, never a renderer actor or a user-selected database destination.
const path=require('node:path'),crypto=require('node:crypto');
const services=new WeakMap(),UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const FILES=['ledger.db','ledger.db-wal','ledger.db-shm','ledger.db-journal'];
function canonical(value){if(Array.isArray(value))return'['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';return JSON.stringify(value);}
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
function fingerprint(context,file){const io=context.policy.io,checked=context.policy.check;if(!io.existsSync(checked(file)))return null;const fd=io.openSync(checked(file),'r');try{const before=io.fstatSync(fd),hash=crypto.createHash('sha256'),buffer=Buffer.alloc(65536);let size=0,n;while((n=io.readSync(fd,buffer,0,buffer.length,null))>0){size+=n;hash.update(buffer.subarray(0,n));}const after=io.fstatSync(fd);if(size!==before.size||before.dev!==after.dev||before.ino!==after.ino||before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw Error('出纳恢复核验文件在读取时变化');return{size,sha256:hash.digest('hex')};}finally{io.closeSync(fd);}}
function dataFiles(context){return Object.fromEntries(FILES.map(name=>[name,fingerprint(context,path.join(context.layout.ledgerDir,name))]));}
function validateRecoveryRecord(record){if(!record||Object.keys(record).sort().join(',')!=='beforeFiles,receiptSha256,version'||record.version!==1||! /^[a-f0-9]{64}$/.test(record.receiptSha256)||Object.keys(record.beforeFiles||{}).sort().join(',')!==[...FILES].sort().join(','))throw Error('出纳恢复日志无效');for(const[name,item]of Object.entries(record.beforeFiles)){if(item===null&&name!=='ledger.db')continue;if(!item||Object.keys(item).sort().join(',')!=='sha256,size'||!Number.isSafeInteger(item.size)||item.size<0||! /^[a-f0-9]{64}$/.test(item.sha256))throw Error('出纳恢复前文件指纹无效');}return record;}
function verifyCashierRollbackFiles(context,record,txId){require('./business-maintenance-layout.cjs').requireContext(context);validateRecoveryRecord(record);if(!UUID.test(txId))throw Error('出纳恢复事务编号无效');const file=context.policy.check(path.join(context.layout.runtimeDir,'restorations',txId,'cashier-receipt.json'));if(fingerprint(context,file)?.sha256!==record.receiptSha256)throw Error('已审核出纳恢复回执变化');const saved=JSON.parse(context.policy.io.readFileSync(file,'utf8'));if(saved.namespace!==context.namespace||saved.txId!==txId||canonical(saved.beforeFiles)!==canonical(record.beforeFiles))throw Error('出纳回滚回执归属不符');if(canonical(dataFiles(context))!==canonical(record.beforeFiles))throw Error('回滚后的财务原件与恢复前指纹不同，保持关闭并等待核对');return true;}
function requireCashierMaintenance(service,context){if(services.get(service)!==context)throw TypeError('Owned private cashier maintenance service required');return service;}
function createCashierMaintenance({context,execute}){
 require('./business-maintenance-layout.cjs').requireContext(context);if(typeof execute!=='function')throw TypeError('Trusted fixed ledger maintenance process callback required');
 const{layout,namespace,hostId,profileId,policy}=context,io=policy.io,check=policy.check;
 function identity(directory){const value=io.statSync(check(directory),{bigint:true});if(!value.isDirectory())throw Error('出纳维护目录缺失');return{dev:value.dev.toString(),ino:value.ino.toString()};}
 function writeNew(file,value){const fd=io.openSync(check(file,true),'wx',0o600);try{io.writeSync(fd,canonical(value));io.fsyncSync(fd);}finally{io.closeSync(fd);}}
 function stageFor(staged){const directory=check(staged.directory);if(path.dirname(directory)!==path.join(layout.runtimeDir,'restore-stage')||!UUID.test(path.basename(directory))||staged.header?.namespace!==namespace)throw Error('出纳恢复只接受已核验的本账套暂存区');const owner=JSON.parse(io.readFileSync(check(path.join(directory,'.owner.json')),'utf8'));if(owner.version!==1||owner.namespace!==namespace||owner.type!=='stage')throw Error('出纳暂存区归属不符');return directory;}
 function jobFor(txId){if(!UUID.test(txId))throw Error('出纳恢复事务编号无效');return check(path.join(layout.runtimeDir,'restorations',txId));}
 function receiptFile(txId){return check(path.join(jobFor(txId),'cashier-receipt.json'));}
 async function invoke(phase,record){
  const job=jobFor(record.txId),now=Date.now(),nonce=crypto.randomUUID(),token=crypto.randomBytes(32).toString('base64url');
  const identities={ledger:phase==='verify'?record.identities.stageLedger:record.identities.ledger,
   stageRoot:record.identities.stageRoot,stageLedger:phase==='merge'?record.identities.stageLedger:null,
   job:record.identities.job,previousLedger:phase==='verify'?record.identities.ledger:null};
  const payload={version:1,purpose:'xjy-cashier-maintenance',action:phase,namespace,hostId,profileId,txId:record.txId,stageId:record.stageId,
   root:context.root,profileDir:layout.profileDir,maintenanceRuntimeDir:layout.runtimeDir,ledgerDir:layout.ledgerDir,
   identities,issuedAt:now,expiresAt:now+30000,nonce,verification:phase==='merge'?null:{receipt:phase==='verify'?record.receipt:{version:1,expectedHash:record.currentHash,requiredDispatchGuard:record.receipt.requiredDispatchGuard},numbers:record.numbers}};
  const request=Buffer.from(canonical(payload),'utf8').toString('base64url');if(request.length>24000)throw Error('出纳维护票据超过限定长度');
  const signature=crypto.createHmac('sha256',Buffer.from(token,'utf8')).update('xjy-cashier-maintenance-v1\0').update(request,'ascii').digest('hex');
  const result=await execute(Object.freeze({phase,token,request,signature}));
  if(!result||!Number.isInteger(result.exitCode)||typeof result.stdout!=='string'||Buffer.byteLength(result.stdout)>65536)throw Error('出纳维护子进程未返回受限结果');
  let envelope;try{envelope=JSON.parse(result.stdout.trim());}catch{throw Error('出纳维护子进程结果不是单一JSON回执');}
  if(!envelope||Object.keys(envelope).sort().join(',')!=='encoded,signature'||typeof envelope.encoded!=='string'||! /^[A-Za-z0-9_-]{1,64000}$/.test(envelope.encoded)||! /^[a-f0-9]{64}$/.test(envelope.signature))throw Error('出纳维护回执格式无效');
  const expected=crypto.createHmac('sha256',Buffer.from(token,'utf8')).update('xjy-cashier-maintenance-result-v1\0').update(envelope.encoded,'ascii').digest('hex');
  if(!crypto.timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(envelope.signature,'hex')))throw Error('出纳维护回执签名不符');
  const body=JSON.parse(Buffer.from(envelope.encoded,'base64url').toString('utf8'));
  if(!body||Object.keys(body).sort().join(',')!=='action,error,nonce,ok,purpose,requestHash,result,txId,version'||body.version!==1||body.purpose!=='xjy-cashier-maintenance-result'||body.txId!==record.txId||body.action!==phase||body.nonce!==nonce||body.requestHash!==sha(Buffer.from(request,'ascii'))||typeof body.ok!=='boolean')throw Error('出纳维护回执与本次事务不符');
  if(result.exitCode!==0||body.ok!==true)throw Error(typeof body.error==='string'?body.error.slice(0,800):'出纳恢复核验未通过');
  if(phase==='merge')return body.result;
  if(body.result?.verified!==true)throw Error('出纳恢复后未确认核验通过');return body.result;
 }
 async function merge(staged,txId){
  const stage=stageFor(staged),job=jobFor(txId);io.mkdirSync(check(path.dirname(job),true),{recursive:true});if(!io.existsSync(job))io.mkdirSync(check(job,true));
  writeNew(path.join(job,'.cashier-owner.json'),{version:1,namespace,txId});
  const record={version:1,namespace,txId,stageId:path.basename(stage),identities:{ledger:identity(layout.ledgerDir),stageRoot:identity(stage),stageLedger:identity(path.join(stage,'ledger')),job:identity(job)}};
  const result=await invoke('merge',record);
  if(!result||Object.keys(result).sort().join(',')!=='currentHash,lostCount,numbers,receipt'||! /^[a-f0-9]{64}$/.test(result.currentHash)||result.receipt?.version!==1||Object.keys(result.receipt).sort().join(',')!=='expectedHash,requiredDispatchGuard,version'||! /^[a-f0-9]{64}$/.test(result.receipt.expectedHash)||typeof result.receipt.requiredDispatchGuard!=='boolean'||!Number.isSafeInteger(result.lostCount)||result.lostCount<0||!result.numbers||Object.keys(result.numbers).sort().join(',')!=='cashier-number-reservations.json,erp-number-reservations.json')throw Error('出纳合并回执不完整');
  for(const item of Object.values(result.numbers))if(item!==null&&(!item||Object.keys(item).sort().join(',')!=='sha256,size'||!Number.isSafeInteger(item.size)||item.size<0||! /^[a-f0-9]{64}$/.test(item.sha256)))throw Error('出纳编号保留记录指纹无效');
  Object.assign(record,result,{beforeFiles:dataFiles(context)});if(!record.beforeFiles['ledger.db'])throw Error('恢复前财务原件缺失');
  writeNew(receiptFile(txId),record);const receiptSha256=fingerprint(context,receiptFile(txId)).sha256;
  return Object.freeze({version:1,receiptSha256,beforeFiles:record.beforeFiles});
 }
 function readReceipt(txId,publicRecord){validateRecoveryRecord(publicRecord);const file=receiptFile(txId);if(fingerprint(context,file)?.sha256!==publicRecord.receiptSha256)throw Error('已审核出纳恢复回执变化');const record=JSON.parse(io.readFileSync(file,'utf8'));if(record.version!==1||record.namespace!==namespace||record.txId!==txId||canonical(record.beforeFiles)!==canonical(publicRecord.beforeFiles))throw Error('出纳恢复回执归属变化');return record;}
 const service=Object.freeze({merge,async verify(txId,record){return invoke('verify',readReceipt(txId,record));},async verifyRollback(txId,record){verifyCashierRollbackFiles(context,record,txId);return invoke('verify-rollback',readReceipt(txId,record));}});
 services.set(service,context);return service;
}
module.exports={createCashierMaintenance,requireCashierMaintenance,validateRecoveryRecord,verifyCashierRollbackFiles};

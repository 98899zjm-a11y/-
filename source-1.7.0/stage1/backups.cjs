'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),sqlite=require('node:sqlite');
const MAGIC=Buffer.from('XJYBK001'),CHUNK=64*1024;
function createBackupService({root,layout,policy,withFrozen,salesDatabase}){
 const namespace=JSON.parse(fs.readFileSync(path.join(root,'isolation-identity.json'),'utf8')).namespace;
 const keyFile=policy.guard.assertPath(path.join(layout.configDir,'backup-key.bin'));
 if(!fs.existsSync(keyFile))fs.writeFileSync(keyFile,crypto.randomBytes(32),{flag:'wx',mode:0o600});
 const key=fs.readFileSync(keyFile);if(key.length!==32)throw new Error('Invalid isolated backup key');
 const slots={sales:layout.dataDir,ledger:layout.ledgerDir,inventory:layout.inventoryDir,config:layout.configDir,documents:path.join(root,'data','documents')};
 const databases={sales:{file:'jewelry.sqlite',directory:layout.dataDir},ledger:{file:'ledger.db',directory:layout.ledgerDir},inventory:{file:'stockcheck.db',directory:layout.inventoryDir}};
 for(const directory of Object.values(slots)){policy.guard.assertPath(directory);if(!fs.existsSync(directory))fs.mkdirSync(directory,{recursive:true});}
 const canonical=value=>JSON.stringify(value);
 const headerMac=value=>crypto.createHmac('sha256',key).update('xjy-header-v1\0').update(canonical(value)).digest('hex');
 const readExact=(fd,size,position)=>{const b=Buffer.alloc(size);let n=0;while(n<size){const count=fs.readSync(fd,b,n,size-n,position+n);if(!count)throw new Error('Truncated archive record');n+=count;}return b;};
 function header(filename){policy.check(filename);const fd=fs.openSync(filename,'r');try{const start=readExact(fd,12,0);if(!start.subarray(0,8).equals(MAGIC))throw new Error('Unknown archive format');const length=start.readUInt32BE(8);if(length>8192)throw new Error('Invalid archive header');const raw=readExact(fd,length,12),data=JSON.parse(raw.toString());const{mac,...signed}=data;if(!/^[a-f0-9]{64}$/.test(mac||'')||!crypto.timingSafeEqual(Buffer.from(mac,'hex'),Buffer.from(headerMac(signed),'hex'))||signed.namespace!==namespace||signed.version!==1||!['auto','manual','pre-restore'].includes(signed.kind)||!Number.isFinite(Date.parse(signed.createdAt)))throw new Error('Archive header integrity failed');return{data,raw,start:12+length};}finally{fs.closeSync(fd);}}
 function walk(directory,prefix,entries,snapshots){
  policy.check(directory);for(const name of fs.readdirSync(directory)){const file=policy.check(path.join(directory,name)),stat=fs.lstatSync(file);if(stat.isDirectory()){walk(file,prefix+'/'+name,entries,snapshots);continue;}if(!stat.isFile())throw new Error('Unsupported backup dependency');
   if(file===keyFile||snapshots.some(x=>file===x.original+'-wal'||file===x.original+'-shm'||file===x.original+'-journal'))continue;
   const substitution=snapshots.find(x=>x.original===file);entries.push({path:prefix+'/'+name,file:substitution?substitution.snapshot:file});}
 }
 function hashFile(filename){const fd=fs.openSync(policy.check(filename),'r'),hash=crypto.createHash('sha256'),buffer=Buffer.alloc(CHUNK);try{let size=0;while(true){const count=fs.readSync(fd,buffer,0,buffer.length,null);if(!count)break;hash.update(buffer.subarray(0,count));size+=count;}return{size,sha256:hash.digest('hex')};}finally{fs.closeSync(fd);}}
 async function create(options={}){return withFrozen(()=>createFrozen(options));}
 async function createFrozen({kind='manual',now=new Date()}={}){
  if(!['auto','manual','pre-restore'].includes(kind)||!Number.isFinite(now.getTime()))throw new Error('Invalid backup operation');
  {
   const id=crypto.randomUUID(),scratch=policy.check(path.join(root,'runtime','snapshots',id),true);fs.mkdirSync(scratch,{recursive:true});fs.writeFileSync(path.join(scratch,'.owner.json'),JSON.stringify({version:1,namespace,type:'snapshot'}));let temporary=null;try{const snapshots=[];
   for(const[name,item]of Object.entries(databases)){const original=policy.check(path.join(item.directory,item.file)),snapshot=policy.check(path.join(scratch,name+'.sqlite'),true);const db=name==='sales'?salesDatabase():new sqlite.DatabaseSync(original,{readOnly:true});try{await sqlite.backup(db,snapshot);}finally{if(name!=='sales')db.close();}snapshots.push({original,snapshot});}
   require('./erp-backup-integrity.cjs').validateErpAttachments({DatabaseSync:sqlite.DatabaseSync,database:snapshots.find(x=>x.original===path.join(layout.ledgerDir,'ledger.db')).snapshot,attachmentsDirectory:path.join(layout.ledgerDir,'erp-attachments'),check:policy.check});
   const entries=[];for(const[name,directory]of Object.entries(slots))walk(directory,name,entries,snapshots);
   const printLedger=layout.dataDir+'.print-ledger.json';if(fs.existsSync(policy.check(printLedger)))entries.push({path:'printing/print-ledger.json',file:printLedger});
   entries.sort((a,b)=>a.path.localeCompare(b.path));if(entries.length>100000)throw new Error('Backup dependency count exceeds safety limit');
   const basename=(kind==='auto'?'AUTO':kind==='pre-restore'?'PRE':'MANUAL')+'-'+now.toISOString().slice(0,10)+'-'+id+'.xjybak';
   const destination=policy.check(path.join(layout.backupDir,basename),true);temporary=destination+'.tmp';const fd=fs.openSync(temporary,'wx',0o600);
   const signed={version:1,namespace,kind,createdAt:now.toISOString(),nonce:crypto.randomBytes(12).toString('base64')},raw=Buffer.from(canonical({...signed,mac:headerMac(signed)})),length=Buffer.alloc(4);length.writeUInt32BE(raw.length);
   const cipher=crypto.createCipheriv('aes-256-gcm',key,Buffer.from(signed.nonce,'base64'));cipher.setAAD(raw);const manifest=crypto.createHash('sha256');
   const frame=(type,value)=>{const data=Buffer.from(canonical(value)),prefix=Buffer.alloc(5);prefix[0]=type;prefix.writeUInt32BE(data.length,1);fs.writeSync(fd,cipher.update(prefix));fs.writeSync(fd,cipher.update(data));};
   try{
    fs.writeSync(fd,MAGIC);fs.writeSync(fd,length);fs.writeSync(fd,raw);
    for(const entry of entries){const meta={path:entry.path,...hashFile(entry.file)};manifest.update(canonical(meta)+'\n');frame(1,meta);const source=fs.openSync(policy.check(entry.file),'r'),buffer=Buffer.alloc(CHUNK),hash=crypto.createHash('sha256');let count,size=0;try{while((count=fs.readSync(source,buffer,0,buffer.length,null))>0){size+=count;hash.update(buffer.subarray(0,count));fs.writeSync(fd,cipher.update(buffer.subarray(0,count)));}}finally{fs.closeSync(source);}if(size!==meta.size||hash.digest('hex')!==meta.sha256)throw new Error('Attachment changed during frozen backup');}
    frame(255,{count:entries.length,manifest:manifest.digest('hex')});fs.writeSync(fd,cipher.final());fs.writeSync(fd,cipher.getAuthTag());fs.fsyncSync(fd);
   }finally{fs.closeSync(fd);}
   policy.check(destination,true);fs.renameSync(temporary,destination);temporary=null;return{file:destination,createdAt:signed.createdAt,kind,files:entries.length,encrypted:true};
   }finally{if(temporary&&fs.existsSync(policy.check(temporary,true)))fs.unlinkSync(temporary);removeManaged(scratch,'snapshots','snapshot');}
  }
 }
 function safeRelative(value){if(typeof value!=='string'||!value||value.length>2048||value.startsWith('/')||value.split('/').some(x=>!x||x==='.'||x==='..'||/[\\:\x00-\x1f]/.test(x))||!['sales','ledger','inventory','config','documents','printing'].includes(value.split('/')[0]))throw new Error('Invalid archive record path');return value;}
 function removeManaged(directory,parent,type){
  policy.check(directory,true);if(path.dirname(directory)!==path.join(root,'runtime',parent)||! /^[a-f0-9-]{36}$/.test(path.basename(directory)))throw new Error('Invalid owned cleanup target');
  function scan(folder){for(const name of fs.readdirSync(policy.check(folder))){const item=policy.check(path.join(folder,name),true);if(fs.lstatSync(item).isDirectory())scan(item);}}
  const marker=path.join(directory,'.owner.json');if(fs.existsSync(policy.check(marker))){const owner=JSON.parse(fs.readFileSync(marker));if(owner.version!==1||owner.namespace!==namespace||owner.type!==type)throw new Error('Cleanup ownership mismatch');}
  else if(type==='snapshot'){const names=fs.readdirSync(directory).sort();if(names.length&&JSON.stringify(names)!==JSON.stringify(['inventory.sqlite','ledger.sqlite','sales.sqlite']))throw new Error('Unrecognized legacy snapshot');}
  else{for(const name of ['sales','ledger','inventory']){const fixture=JSON.parse(fs.readFileSync(policy.check(path.join(directory,name,'synthetic-fixture.json'))));if(fixture.synthetic!==true||fixture.namespace&&fixture.namespace!==namespace)throw new Error('Unrecognized legacy stage');}}
  scan(directory);fs.rmSync(policy.check(directory,true),{recursive:true,force:false});
 }
 function discardStage(directory){removeManaged(directory,'restore-stage','stage');}
 function cleanupOrphans(){
  let protectedStage=null;const journal=path.join(root,'runtime','restore-transaction.json');if(fs.existsSync(policy.check(journal))){const tx=JSON.parse(fs.readFileSync(journal));if(tx.namespace!==namespace)throw new Error('Foreign restore transaction');if(!['COMMITTED','ROLLED_BACK'].includes(tx.state))protectedStage=tx.stage;}
  for(const[parent,type]of [['snapshots','snapshot'],['restore-stage','stage']]){const folder=policy.check(path.join(root,'runtime',parent),true);if(!fs.existsSync(folder))continue;for(const name of fs.readdirSync(folder)){if(! /^[a-f0-9-]{36}$/.test(name))continue;const item=policy.check(path.join(folder,name),true);if(item===protectedStage)continue;try{removeManaged(item,parent,type);}catch(error){fs.appendFileSync(path.join(root,'logs','orphan-cleanup.log'),new Date().toISOString()+' retained unrecognized stage: '+name+' '+error.message+'\n');}}}
 }
 async function probe(filename){const staged=await verifyAndStage(filename);discardStage(staged.directory);return true;}
 async function verifyAndStage(filename){
  const info=header(filename),directory=policy.check(path.join(root,'runtime','restore-stage',crypto.randomUUID()),true);fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'.owner.json'),JSON.stringify({version:1,namespace,type:'stage'}));const fd=fs.openSync(policy.check(filename),'r');try{const size=fs.fstatSync(fd).size,cipherEnd=size-16;
  const decrypt=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(info.data.nonce,'base64'));decrypt.setAAD(info.raw);decrypt.setAuthTag(readExact(fd,16,cipherEnd));
  let pending=Buffer.alloc(0),record=null,remaining=0,out=null,hash=null,footer=null,count=0;const manifest=crypto.createHash('sha256'),seen=new Set();
  function feed(chunk){pending=Buffer.concat([pending,chunk]);while(pending.length){
   if(record){const length=Math.min(remaining,pending.length);if(length){const bytes=pending.subarray(0,length);fs.writeSync(out,bytes);hash.update(bytes);pending=pending.subarray(length);remaining-=length;}if(remaining)break;fs.closeSync(out);out=null;if(hash.digest('hex')!==record.sha256)throw new Error('Archive attachment integrity failed');record=null;continue;}
   if(footer)throw new Error('Trailing archive record');if(pending.length<5)break;const type=pending[0],length=pending.readUInt32BE(1);if(length>32768)throw new Error('Invalid archive record size');if(pending.length<5+length)break;const data=JSON.parse(pending.subarray(5,5+length).toString());pending=pending.subarray(5+length);
   if(type===255){footer=data;continue;}if(type!==1)throw new Error('Unknown archive record');safeRelative(data.path);if(!Number.isSafeInteger(data.size)||data.size<0||data.size>100*1024**3||!/^[a-f0-9]{64}$/.test(data.sha256))throw new Error('Invalid archive attachment');const folded=data.path.toLowerCase();if(seen.has(folded)||++count>100000)throw new Error('Duplicate archive record');seen.add(folded);manifest.update(canonical(data)+'\n');const target=policy.check(path.join(directory,...data.path.split('/')),true);fs.mkdirSync(path.dirname(target),{recursive:true});out=fs.openSync(target,'wx',0o600);hash=crypto.createHash('sha256');record=data;remaining=data.size;
  }}
  try{for(let position=info.start;position<cipherEnd;){const length=Math.min(CHUNK,cipherEnd-position);feed(decrypt.update(readExact(fd,length,position)));position+=length;}feed(decrypt.final());if(out&&remaining===0)feed(Buffer.alloc(0));if(record&&remaining===0){fs.closeSync(out);out=null;if(hash.digest('hex')!==record.sha256)throw new Error('Archive attachment integrity failed');record=null;}if(record||pending.length||!footer||footer.count!==count||footer.manifest!==manifest.digest('hex'))throw new Error('Incomplete archive integrity manifest');}finally{if(out!==null)fs.closeSync(out);}
  const validated=[];for(const[name,item]of Object.entries(databases)){const file=policy.check(path.join(directory,name,item.file));const db=new sqlite.DatabaseSync(file,{readOnly:true});try{const integrity=db.prepare('PRAGMA integrity_check').get().integrity_check;if(integrity!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Database integrity failed');validated.push({module:name,integrity});}finally{db.close();}}
  const erpAttachments=require('./erp-backup-integrity.cjs').validateErpAttachments({DatabaseSync:sqlite.DatabaseSync,database:path.join(directory,'ledger','ledger.db'),attachmentsDirectory:path.join(directory,'ledger','erp-attachments'),check:policy.check});
  // An extracted attachment must be physically present before any publication.
  const metadata=path.join(directory,'sales','images','metadata.json');if(fs.existsSync(metadata)){for(const key of Object.keys(JSON.parse(fs.readFileSync(metadata,'utf8')))){if(!/^images\/[a-f0-9-]{36}$/.test(key)||!fs.existsSync(policy.check(path.join(directory,'sales','images',key.slice(7)))))throw new Error('Image attachment integrity failed');}}
  for(const name of Object.keys(slots))fs.mkdirSync(policy.check(path.join(directory,name),true),{recursive:true});return{directory,databases:validated,files:count,header:info.data,erpAttachments};
  }catch(error){try{discardStage(directory);}catch{}throw error;}finally{fs.closeSync(fd);}
 }
 async function cleanup(now=new Date()){
  const removed=[];for(const name of fs.readdirSync(layout.backupDir)){if(!/^AUTO-\d{4}-\d{2}-\d{2}-[a-f0-9-]{36}\.xjybak$/.test(name))continue;const file=policy.check(path.join(layout.backupDir,name),true);try{const info=header(file),stamp=Date.parse(info.data.createdAt);if(info.data.kind!=='auto'||stamp>now.getTime()||now.getTime()-stamp<7*86400000)continue;const before=fs.statSync(file);await probe(file);policy.check(file,true);const after=fs.statSync(file);if(before.ino!==after.ino||before.dev!==after.dev||before.size!==after.size||before.mtimeMs!==after.mtimeMs)continue;fs.unlinkSync(file);removed.push(file);}catch(error){fs.appendFileSync(path.join(layout.logDir,'backup-retention.log'),new Date().toISOString()+' skip invalid AUTO snapshot: '+error.message+'\n');}}
  return removed;
 }
 function list(){return fs.readdirSync(layout.backupDir).filter(x=>/^(AUTO|MANUAL|PRE)-.*\.xjybak$/.test(x)).flatMap(name=>{try{const file=policy.check(path.join(layout.backupDir,name)),info=header(file);return[{file,kind:info.data.kind,createdAt:info.data.createdAt}];}catch{return[];}}).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
 return{create,createFrozen,verifyAndStage,probe,discardStage,cleanupOrphans,cleanup,list};
}
module.exports={createBackupService};

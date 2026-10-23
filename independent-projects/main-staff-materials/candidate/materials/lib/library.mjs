import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createIntakeMachine } from '../vendor/intake-state/intake-state.mjs';
const base=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../runtime');
const categories=['戒指','项链','吊坠','耳饰','手链','手镯','胸针','其他首饰'];
const statuses=['queued','classifying','imported','skipped','needs_review','awaiting_model'];
const supplies=['unknown','in_stock','order_only','reference_only'];
const hash=b=>createHash('sha256').update(b).digest('hex');
const now=()=>new Date().toISOString();
const isHash=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const isId=s=>typeof s==='string'&&/^[a-f0-9-]{36}$/.test(s);
function text(value,max,fallback=''){if(value===undefined||value===null)return fallback;if(typeof value!=='string')throw new Error('文字格式无效');const clean=value.trim();if(clean.length>max)throw new Error('文字过长');if(/[A-Za-z]:[\\/]|\\\\|(^|[^:])\/\/[^/]/.test(clean))throw new Error('不能保存绝对磁盘路径');return clean;}
function tags(value){if(!Array.isArray(value)||value.length>30)throw new Error('标签格式无效');return [...new Set(value.map(x=>text(x,40)).filter(Boolean))];}
function category(value){if(!categories.includes(value))throw new Error('分类无效');return value;}
async function safePath(target,{create=false,missing=false,directory=false}={}){let cursor=path.parse(target).root;const parts=target.slice(cursor.length).split(path.sep);for(let i=0;i<parts.length;i++){cursor=path.join(cursor,parts[i]);let info;try{info=await fs.lstat(cursor);}catch(e){if(e.code!=='ENOENT')throw e;if(create){await fs.mkdir(cursor);info=await fs.lstat(cursor);}else if(missing&&i===parts.length-1)return false;else throw e;}if(info.isSymbolicLink())throw new Error('拒绝符号链接或目录联接');if(info.isFile()&&info.nlink!==1)throw new Error('拒绝文件硬链接或别名');if((i<parts.length-1||directory)&&!info.isDirectory())throw new Error('目录无效');}return true;}
const assetsDDL=`CREATE TABLE assets(id TEXT PRIMARY KEY NOT NULL,sha256 TEXT NOT NULL UNIQUE,payload_sha TEXT NOT NULL,name TEXT NOT NULL,source_label TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('queued','classifying','imported','skipped','needs_review','awaiting_model')),category TEXT NOT NULL,tags TEXT NOT NULL,reason TEXT NOT NULL,availability TEXT NOT NULL CHECK(availability IN ('unknown','in_stock','order_only','reference_only')),evidence TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,error TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0) STRICT`;
const auditDDL='CREATE TABLE changes(id INTEGER PRIMARY KEY,asset_id TEXT NOT NULL,action TEXT NOT NULL,evidence TEXT NOT NULL,details TEXT NOT NULL,created_at TEXT NOT NULL) STRICT';
const normalize=s=>s.replace(/\s+/g,' ').trim();
function asset(row){
 if(!row)return null;
 const parsed=JSON.parse(row.tags);
 if(!isId(row.id)||!isHash(row.sha256)||!isHash(row.payload_sha)||!statuses.includes(row.status)||!supplies.includes(row.availability)||!Number.isSafeInteger(row.revision)||row.revision<0)throw new Error('图库记录损坏');
 category(row.category);
 const normalizedTags=tags(parsed);
 if(JSON.stringify(normalizedTags)!==JSON.stringify(parsed))throw new Error('图库标签损坏');
 for(const [field,max] of [['name',200],['source_label',300],['reason',500],['evidence',500],['error',300]]){
  if(typeof row[field]!=='string'||text(row[field],max)!==row[field])throw new Error('图库文字记录损坏');
 }
 if(!row.name||(row.availability!=='unknown'&&!row.evidence))throw new Error('图库依据记录损坏');
 for(const field of ['created_at','updated_at'])if(typeof row[field]!=='string'||!Number.isFinite(Date.parse(row[field]))||new Date(row[field]).toISOString()!==row[field])throw new Error('图库时间记录损坏');
 return {id:row.id,name:row.name,sourceLabel:row.source_label,sha256:row.sha256,status:row.status,category:row.category,tags:parsed,reason:row.reason,availability:row.availability,evidence:row.evidence,createdAt:row.created_at,updatedAt:row.updated_at,...(row.error?{error:row.error}:{})};
}
export async function openLibrary({root,classify}={}){
 if(typeof root!=='string'||!path.isAbsolute(root))throw new Error('需要独立图库目录');root=path.resolve(root);const relative=path.relative(base,root);if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw new Error('图库目录必须位于候选runtime内');
 await safePath(root,{create:true,directory:true});const images=path.join(root,'images');await safePath(images,{create:true,directory:true});const filename=path.join(root,'library.sqlite');const existed=await safePath(filename,{missing:true});
 for(const suffix of ['-journal','-wal','-shm']){const exists=await safePath(filename+suffix,{missing:true});if(exists&&(!existed||suffix!=='-journal'))throw new Error('数据库日志现场不支持自动打开，已保留');}
 if(existed){const handle=await fs.open(filename,'r');try{const b=Buffer.alloc(100);const {bytesRead}=await handle.read(b,0,100,0);if(bytesRead<100||b.subarray(0,16).toString('ascii')!=='SQLite format 3\0')throw new Error('图库数据库格式损坏，已保留');if(b[18]!==1||b[19]!==1||b.readUInt32BE(60)!==1)throw new Error('未知图库版本或日志格式，已保留');}finally{await handle.close();}}
 const db=new DatabaseSync(filename,{allowExtension:false});let closed=false,closing=false,fatal=null,worker=null,enqueueTail=Promise.resolve();
 const transaction=fn=>{let begun=false;try{db.exec('BEGIN IMMEDIATE');begun=true;const result=fn();db.exec('COMMIT');return result;}catch(e){if(begun)try{db.exec('ROLLBACK');}catch{}throw e;}};
 try{db.exec('PRAGMA busy_timeout=500; PRAGMA synchronous=FULL; PRAGMA locking_mode=EXCLUSIVE');if(!existed)transaction(()=>{db.exec(assetsDDL);db.exec(auditDDL);db.exec('PRAGMA user_version=1');});
  if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw new Error('图库数据库损坏');
  const objects=db.prepare('SELECT type,name,sql FROM sqlite_schema').all();
  if(objects.length!==4||normalize(objects.find(x=>x.name==='assets')?.sql||'')!==normalize(assetsDDL)||normalize(objects.find(x=>x.name==='changes')?.sql||'')!==normalize(auditDDL)||objects.some(x=>!['table','index'].includes(x.type)))throw new Error('未知图库结构，拒绝自动修改');
  db.prepare('SELECT * FROM assets').all().forEach(asset);
  transaction(()=>db.prepare("UPDATE assets SET status='queued',error='',updated_at=?,revision=revision+1 WHERE status='classifying'").run(now()));
 }catch(e){db.close();throw e;}
 const live=()=>{if(closed||closing)throw new Error('图库已关闭');if(fatal)throw new Error('图库写入异常，请重启并核查');};
 const raw=id=>isId(id)?db.prepare('SELECT * FROM assets WHERE id=?').get(id):undefined;
 const get=id=>{live();return asset(raw(id));};
 const log=(id,action,evidence,details)=>db.prepare('INSERT INTO changes(asset_id,action,evidence,details,created_at) VALUES(?,?,?,?,?)').run(id,action,evidence,JSON.stringify(details),now());
 async function stored(row){const target=path.join(images,row.id+'.jpg');await safePath(images,{directory:true});await safePath(target);const info=await fs.lstat(target);if(!info.isFile())throw new Error('素材文件无效');const b=await fs.readFile(target);if(hash(b)!==row.payload_sha)throw new Error('素材内容校验失败');return {path:target,bytes:b,mime:'image/jpeg'};}
 function updateStatus(row,state,fields={}){transaction(()=>{const result=db.prepare('UPDATE assets SET status=?,category=?,tags=?,reason=?,error=?,updated_at=?,revision=revision+1 WHERE id=? AND revision=?').run(state,fields.category??row.category,JSON.stringify(fields.tags??JSON.parse(row.tags)),fields.reason??row.reason,fields.error??'',now(),row.id,row.revision);if(result.changes!==1)throw new Error('素材已变化，请刷新');});}
 async function run(){while(!closed){const row=db.prepare("SELECT * FROM assets WHERE status='queued' ORDER BY created_at,id LIMIT 1").get();if(!row)return;updateStatus(row,'classifying');let current=raw(row.id);try{
   const {bytes}=await stored(current);let classification;
   const machine=createIntakeMachine({classify:async()=>{if(typeof classify!=='function')throw new Error('model unavailable');classification=await classify({bytes,sha256:current.sha256});return classification;}});
   const decision=await machine.evaluate(machine.create({taskId:current.id,scopeId:'isolated-sales-library',deviceId:'local-candidate',sha256:current.sha256}));
   if(decision.state==='awaiting_model'){updateStatus(current,'awaiting_model',{error:'识别服务暂不可用或结果无效，可重试'});continue;}
   const state={ready:'imported',skipped:'skipped',needs_review:'needs_review'}[decision.state];
   const fields={category:category(classification.category||'其他首饰'),tags:tags(classification.tags||[]),reason:text(classification.reason,500)};
   updateStatus(current,state,fields);
  }catch{current=raw(row.id);if(current?.status==='classifying')updateStatus(current,'awaiting_model',{error:'识别或素材校验失败，已保留待处理'});}
 }}
 function schedule(){if(worker||closed)return;worker=Promise.resolve().then(run).catch(e=>{fatal=e;}).finally(()=>{worker=null;});}
 const library={
  enqueue(input,{beforeCommit}={}){live();const task=enqueueTail.then(async()=>{beforeCommit?.();if(!input||!Buffer.isBuffer(input.bytes)||input.bytes.length===0||input.bytes.length>20*1024*1024||!isHash(input.sha256))throw new Error('素材内容或摘要无效');const name=text(input.name,200,'素材图片')||'素材图片',sourceLabel=text(input.sourceLabel,300);
   const prior=db.prepare('SELECT * FROM assets WHERE sha256=?').get(input.sha256);if(prior){beforeCommit?.();return {...asset(prior),duplicate:true};}
   if(input.bytes[0]!==255||input.bytes[1]!==216||input.bytes[2]!==255)throw new Error('需要已转码JPEG');
   const id=randomUUID(),target=path.join(images,id+'.jpg'),temporary=path.join(images,id+'.tmp'),b=Buffer.from(input.bytes);await safePath(images,{directory:true});const handle=await fs.open(temporary,'wx',0o600);try{await handle.writeFile(b);await handle.sync();}finally{await handle.close();}await safePath(images,{directory:true});await fs.rename(temporary,target);const time=now();
   const actor=beforeCommit?.()??null;
   try{transaction(()=>{db.prepare("INSERT INTO assets(id,sha256,payload_sha,name,source_label,status,category,tags,reason,availability,evidence,created_at,updated_at,error) VALUES(?,?,?,?,?,'queued','其他首饰','[]','','unknown','',?,?,'')").run(id,input.sha256,hash(b),name,sourceLabel,time,time);log(id,'enqueue','员工主动上传',{sha256:input.sha256,actor});});}catch(e){fatal=e;throw new Error('素材持久保存失败，文件已保留');}
   const result={...asset(raw(id)),duplicate:false};schedule();return result;
  });enqueueTail=task.catch(()=>{});return task;},
  list(){live();return db.prepare('SELECT * FROM assets ORDER BY created_at DESC,id').all().map(asset);},get,
  async file(id){live();const row=raw(id);if(!row)return null;const f=await stored(row);return {path:f.path,mime:f.mime,bytes:f.bytes};},
  async update(id,patch,{beforeCommit}={}){live();const row=raw(id);if(!row)throw new Error('素材不存在');if(!patch||typeof patch!=='object'||Array.isArray(patch))throw new Error('修改格式无效');const allowed=['category','tags','sourceLabel','availability','evidence','confirmed','reviewDecision'];if(Object.keys(patch).some(x=>!allowed.includes(x)))throw new Error('不允许修改该字段');if(['queued','classifying'].includes(row.status))throw new Error('素材正在处理，请稍后修改');
   let state=row.status;const evidence=text(patch.evidence,500);
   if(patch.evidence!==undefined){if(patch.confirmed!==true)throw new Error('依据修改需要明确确认');if(!evidence)throw new Error('不能清空已登记依据');}
   if(patch.reviewDecision!==undefined){if(patch.confirmed!==true)throw new Error('需要明确确认人工复核');if(!['jewelry','not_jewelry'].includes(patch.reviewDecision))throw new Error('复核决定无效');if(patch.reviewDecision==='jewelry')await stored(row);state=patch.reviewDecision==='jewelry'?'imported':'skipped';}
   let availability=row.availability;if(patch.availability!==undefined){if(patch.confirmed!==true)throw new Error('供货修改需要确认');if(!evidence)throw new Error('供货修改需要依据');if(!supplies.includes(patch.availability))throw new Error('供货状态无效');availability=patch.availability;}
   const cat=patch.category===undefined?row.category:category(patch.category),newTags=patch.tags===undefined?JSON.parse(row.tags):tags(patch.tags),source=patch.sourceLabel===undefined?row.source_label:text(patch.sourceLabel,300);
   const actor=beforeCommit?.()??null;
   transaction(()=>{const result=db.prepare('UPDATE assets SET status=?,category=?,tags=?,source_label=?,availability=?,evidence=?,error=?,updated_at=?,revision=revision+1 WHERE id=? AND revision=?').run(state,cat,JSON.stringify(newTags),source,availability,evidence||row.evidence,patch.reviewDecision?'':row.error,now(),id,row.revision);if(result.changes!==1)throw new Error('素材已变化，请刷新');log(id,'manual-update',evidence||(patch.reviewDecision?'员工明确复核':'员工修正分类或备注'),{changes:patch,actor});});return asset(raw(id));
  },
  async retry(id,{beforeCommit}={}){live();const row=raw(id);if(!row)throw new Error('素材不存在');if(!['awaiting_model','needs_review'].includes(row.status))throw new Error('已跳过素材须经明确人工复核，当前状态不能重试');beforeCommit?.();updateStatus(row,'queued',{error:''});const value=asset(raw(id));schedule();return value;},
  async idle(){await enqueueTail;while(worker)await worker;if(fatal)throw new Error('图库处理异常，请核查后重启');},
  async close(){if(closed)return;closing=true;await enqueueTail;while(worker)await worker;db.close();closed=true;}
 };
 schedule();return Object.freeze(library);
}

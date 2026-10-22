'use strict';
// Native-only storage. No API/renderer ever receives paths, envelopes or handles.
const fs=process.versions.electron?require('original-fs').promises:require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const CHUNK=4194304,MAX_ARCHIVE=805306368,SHA=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
function fail(code,message,detail){const error=new Error(message);error.code=code;if(detail!==undefined)error.detail=detail;throw error;}
function plain(v){return v&&typeof v==='object'&&!Array.isArray(v);}
function exact(v,keys){return plain(v)&&Object.keys(v).every(k=>keys.includes(k));}
function freeze(v){if(plain(v)||Array.isArray(v)){Object.freeze(v);for(const c of Object.values(v))freeze(c);}return v;}
function digest(v){return crypto.createHash('sha256').update(v).digest('hex');}
function safeRelative(v){return typeof v==='string'&&v.length>0&&v.length<=240&&!/[\\:*?"<>|\x00-\x1f]/.test(v)&&!v.startsWith('/')&&v.split('/').every(p=>p&&p!=='.'&&p!=='..'&&!/[. ]$/.test(p)&&!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p));}
function safeAbsolute(v){
 if(typeof v!=='string'||!path.isAbsolute(v)||/^[\\/]{2}/.test(v)||/[\x00-\x1f"<>|?*]/.test(v)||process.platform==='win32'&&v.slice(2).includes(':'))fail('UNSAFE_PATH','Update path must be a fixed local absolute path');
 const suffix=v.slice(path.parse(v).root.length);if(suffix.split(/[\\/]/).some(p=>p==='.'||p==='..'||/[. ]$/.test(p)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))fail('UNSAFE_PATH','Ambiguous update path');
 return path.resolve(v);
}
function samePath(a,b){return process.platform==='win32'?path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase():path.resolve(a)===path.resolve(b);}
function within(root,value){const rel=path.relative(root,value);if(rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))fail('UNSAFE_PATH','Update path escaped trusted root');return value;}
function statIdentity(s){return [s.dev,s.ino,s.birthtimeNs??s.birthtimeMs].map(String).join(':');}
function statState(s){return [statIdentity(s),s.size,s.mtimeNs??s.mtimeMs,s.ctimeNs??s.ctimeMs,s.nlink].map(String).join(':');}
async function assertPath(io,file,{directory=false,missing=false,root}={}){
 safeAbsolute(file);if(root)within(root,file);let target,parent;
 for(let p=file;;p=path.dirname(p)){
  let s;try{s=await io.lstat(p,{bigint:true});}catch(e){if(e.code==='ENOENT'&&p===file&&missing){}else throw e;}
  if(s){if(s.isSymbolicLink()||p!==file&&!s.isDirectory())fail('UNSAFE_PATH','Update path contains a link or non-directory');if(p===file)target=s;else if(!parent&&p===path.dirname(file))parent=s;if(!samePath(await io.realpath(p),p))fail('UNSAFE_PATH','Update path alias rejected');}
  if(p===path.dirname(p))break;
 }
 if(target){
  if(directory){if(!target.isDirectory())fail('UNSAFE_PATH','Update object is not an ordinary single-link file','not-a-directory ino='+String(target.ino));}
  else{
   if(!target.isFile())fail('UNSAFE_PATH','Update object is not an ordinary single-link file','not-a-file ino='+String(target.ino));
   if(target.nlink<1n)fail('UNSAFE_PATH','Update object is not an ordinary single-link file','nlink='+String(target.nlink)+' dev='+String(target.dev)+' ino='+String(target.ino));
   if(parent&&target.dev!==parent.dev)fail('UNSAFE_PATH','Update object is not an ordinary single-link file','cross-volume dev='+String(target.dev)+' parent-dev='+String(parent.dev));
   if(target.nlink>1n)await assertExclusiveRegularFile(io,target,file);
  }
 }
 return target;
}
// 单个文件的"可独占打开"判定。旧代码把 nlink!==1n 当硬拒绝，同步盘/备份工具（OneDrive、
// 坚果云、Veeam 等）给合法缓存文件加硬链接后，员工机就卡在 Update object is not an
// ordinary single-link file 上只能人工删缓存。放宽后仍不降安全性：
//  1) lstat 必须还是普通文件、不是符号链接/重解析点（assertPath 已判，这里复核）；
//  2) 必须与父目录同卷（dev 相同），排除目录联接/挂载点把文件换到别的卷上；
//  3) 必须以读写方式独占打开并 fsync 成功：Windows 上 fs.open(path,'r+') 需要 GENERIC_WRITE，
//     被别的进程占用、只读属性、删除挂起(del-pending)的文件都会打不开；打不开即判
//     被占用/被劫持，仍报 UNSAFE_PATH 原错误码，只是多带一个 detail 供日志取证。
// 可信任集合没有变大：打不开的文件照旧进不了后面的 hash 与序号校验。
async function assertExclusiveRegularFile(io,stat,file){
 const detail=()=>'nlink='+String(stat.nlink)+' dev='+String(stat.dev)+' ino='+String(stat.ino);
 if(stat.isSymbolicLink()||!stat.isFile())fail('UNSAFE_PATH','Update object is not an ordinary single-link file','not-regular '+detail());
 let handle;try{handle=await io.open(file,'r+',0o600);}catch(e){fail('UNSAFE_PATH','Update object is not an ordinary single-link file','exclusive-open '+(e&&e.code||'FAILED')+' '+detail());}
 try{const opened=await handle.stat({bigint:true});if(!opened.isFile()||opened.isSymbolicLink()||statIdentity(opened)!==statIdentity(stat))fail('UNSAFE_PATH','Update object is not an ordinary single-link file','swapped '+detail()+' -> '+statIdentity(opened));if(typeof handle.sync==='function')await handle.sync();}catch(e){await handle.close().catch(()=>{});throw e;}
 await handle.close().catch(()=>{});return stat;
}
async function openChecked(io,file,flags='r',limits={}){
 const before=await assertPath(io,file,limits),handle=await io.open(file,flags,0o600);
 try{const opened=await handle.stat({bigint:true}),after=await assertPath(io,file,limits);if(!opened.isFile()||opened.nlink<1n||statIdentity(opened)!==statIdentity(after)||before&&statIdentity(before)!==statIdentity(opened))fail('FILE_CHANGED','Update file changed while opening');return {handle,identity:statIdentity(opened),snapshot:statState(opened),file};}catch(e){await handle.close();throw e;}
}
async function assertHandle(io,opened,{snapshot=true,root}={}){
 const stat=await assertPath(io,opened.file,{root}),fd=await opened.handle.stat({bigint:true});if(statIdentity(stat)!==opened.identity||statIdentity(fd)!==opened.identity||statState(stat)!==statState(fd)||snapshot&&statState(fd)!==opened.snapshot)fail('FILE_CHANGED','Update file descriptor identity or content state changed');return fd;
}
async function readExactly(handle,offset,length){const bytes=Buffer.alloc(length);let done=0;while(done<length){const r=await handle.read(bytes,done,length-done,offset+done);if(!r.bytesRead)fail('INCOMPLETE_FILE','Update file is incomplete');done+=r.bytesRead;}return bytes;}
async function writeExactly(handle,offset,bytes){let done=0;while(done<bytes.length){const r=await handle.write(bytes,done,bytes.length-done,offset+done);if(!r.bytesWritten)fail('WRITE_FAILED','Update write made no progress');done+=r.bytesWritten;}}
async function hashHandle(handle,size){const h=crypto.createHash('sha256');for(let offset=0;offset<size;offset+=CHUNK)h.update(await readExactly(handle,offset,Math.min(CHUNK,size-offset)));return h.digest('hex');}
async function readSmall(io,file,max=1048576){const o=await openChecked(io,file);try{const s=await assertHandle(io,o);if(s.size>BigInt(max))fail('BAD_METADATA','Update metadata is oversized');const b=await readExactly(o.handle,0,Number(s.size));await assertHandle(io,o);return b;}finally{await o.handle.close();}}
async function atomicWrite(io,file,bytes,root){
 await assertPath(io,path.dirname(file),{directory:true,root});await assertPath(io,file,{missing:true,root});const temp=path.join(path.dirname(file),'.update-'+crypto.randomUUID()+'.tmp'),o=await openChecked(io,temp,'wx+',{missing:true,root});
 try{await writeExactly(o.handle,0,Buffer.from(bytes));await o.handle.sync();await assertHandle(io,o,{snapshot:false,root});await o.handle.close();await assertPath(io,file,{missing:true,root});await assertPath(io,temp,{root});await io.rename(temp,file);}catch(e){await o.handle.close().catch(()=>{});try{await assertPath(io,temp,{root});await io.unlink(temp);}catch{}throw e;}
}
async function integrityKey(io,profile,{create=false}={}){
 const root=path.join(safeAbsolute(profile),'employee-update-cache'),file=path.join(root,'.native-integrity-key');await assertPath(io,root,{directory:true,root:profile});
 try{const bytes=await readSmall(io,file,32);if(bytes.length!==32)fail('BAD_METADATA','Invalid native update integrity key');return bytes;}catch(e){if(e.code!=='ENOENT'||!create)throw e;}
 if((await io.readdir(root)).length)fail('BAD_METADATA','Native integrity key missing from retained cache');const o=await openChecked(io,file,'wx+',{missing:true,root});try{await writeExactly(o.handle,0,crypto.randomBytes(32));await o.handle.sync();}finally{await o.handle.close();}return readSmall(io,file,32);
}
async function authenticatedWrite(io,file,value,profile,root){const payload=JSON.stringify(value),key=await integrityKey(io,profile),mac=crypto.createHmac('sha256',key).update(payload).digest('hex');await atomicWrite(io,file,JSON.stringify({payload,mac}),root);}
async function authenticatedRead(io,file,profile,max=1048576){let record;try{record=JSON.parse(await readSmall(io,file,max));}catch(e){if(e.code==='ENOENT')throw e;fail('BAD_METADATA','Invalid native update record');}if(!exact(record,['payload','mac'])||typeof record.payload!=='string'||!SHA.test(record.mac||''))fail('BAD_METADATA','Invalid native update record');const key=await integrityKey(io,profile),mac=crypto.createHmac('sha256',key).update(record.payload).digest();if(!crypto.timingSafeEqual(mac,Buffer.from(record.mac,'hex')))fail('BAD_METADATA','Native update record authentication failed');try{return JSON.parse(record.payload);}catch{fail('BAD_METADATA','Invalid native update record payload');}}
function createTrustedUpdatePolicy(options){
 const allowed=new Set(options.allowedFiles);if(!Array.isArray(options.allowedFiles)||!allowed.size||allowed.size>4096||allowed.size!==options.allowedFiles.length||new Set([...allowed].map(v=>v.toLowerCase())).size!==allowed.size||[...allowed].some(v=>!safeRelative(v)))throw new TypeError('Exact safe program allowlist required');
 const key=options.trustedPublicKey?.type==='public'?options.trustedPublicKey:crypto.createPublicKey(options.trustedPublicKey);if(key.asymmetricKeyType!=='ed25519')throw new TypeError('Pinned Ed25519 public key required');
 const semver=v=>{if(typeof v!=='string'||!/^1\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(v))fail('BAD_MANIFEST','Unsupported program version');const parts=v.split('.').map(Number);if(parts.some(p=>!Number.isSafeInteger(p)))fail('BAD_MANIFEST','Unsupported program version');return parts;};semver(options.currentVersion);
 return {key,allowed,currentVersion:options.currentVersion,platform:options.platform||'win32',arch:options.arch||'x64',now:options.now||Date.now,semver};
}
function verifySignedCatalog(envelope,policy,{allowExpired=false}={}){
 if(!exact(envelope,['catalog','signature'])||typeof envelope.catalog!=='string'||Buffer.byteLength(envelope.catalog)>1048576||typeof envelope.signature!=='string'||!/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature))fail('BAD_SIGNATURE','Publisher signature is invalid');
 const signature=Buffer.from(envelope.signature,'base64');if(signature.toString('base64')!==envelope.signature||!crypto.verify(null,Buffer.from(envelope.catalog),policy.key,signature))fail('BAD_SIGNATURE','Publisher signature is invalid');
 let c;try{c=JSON.parse(envelope.catalog);}catch{fail('BAD_MANIFEST','Invalid update catalog');}
 if(!exact(c,['schemaVersion','app','channel','version','sourceVersions','platform','arch','sequence','publishedAt','expiresAt','archive','files'])||c.schemaVersion!==1||c.app!=='xjy-jewelry-offline'||c.channel!=='stable'||c.platform!==policy.platform||c.arch!==policy.arch)fail('BAD_MANIFEST','Update catalog does not match program');
 const target=policy.semver(c.version),source=policy.semver(policy.currentVersion);if(target.some((p,i)=>target.slice(0,i).every((v,j)=>v===source[j])&&p<source[i]))fail('DOWNGRADE_REJECTED','Older program rejected');
 if(!Array.isArray(c.sourceVersions)||!c.sourceVersions.length||c.sourceVersions.length>128||new Set(c.sourceVersions).size!==c.sourceVersions.length||!c.sourceVersions.includes(policy.currentVersion))fail('SOURCE_UNSUPPORTED','Source program version not approved');c.sourceVersions.forEach(policy.semver);
 const published=Date.parse(c.publishedAt),expires=Date.parse(c.expiresAt);if(!Number.isSafeInteger(c.sequence)||c.sequence<1||typeof c.publishedAt!=='string'||typeof c.expiresAt!=='string'||!Number.isFinite(published)||!Number.isFinite(expires)||published>policy.now()+300000||expires<=published||!allowExpired&&expires<=policy.now())fail('EXPIRED_CATALOG','Update catalog expired or invalid');
 if(!exact(c.archive,['size','sha256'])||!Number.isSafeInteger(c.archive.size)||c.archive.size<22||c.archive.size>MAX_ARCHIVE||!SHA.test(c.archive.sha256)||!Array.isArray(c.files)||!c.files.length||c.files.length>4096)fail('BAD_MANIFEST','Invalid update file metadata');
 const seen=new Set();let total=0;for(const f of c.files){if(!exact(f,['path','size','sha256'])||!safeRelative(f.path)||!policy.allowed.has(f.path)||seen.has(f.path.toLowerCase())||!Number.isSafeInteger(f.size)||f.size<0||f.size>MAX_ARCHIVE||!SHA.test(f.sha256))fail('BAD_MANIFEST','Unapproved update file');seen.add(f.path.toLowerCase());total+=f.size;}if(total>1073741824)fail('BAD_MANIFEST','Expanded program too large');return freeze(c);
}
function createEmployeeUpdateCache(options){
 const profile=safeAbsolute(options.profileDir),root=path.join(profile,'employee-update-cache'),io=options.fileSystem||fs,policy=createTrustedUpdatePolicy(options);if(typeof options.resolveCatalogEnvelope!=='function')throw new TypeError('Native signed envelope resolver required');
 const stages=new Map();let tail=Promise.resolve(),closed=false,ready=false;
 const enqueue=fn=>{const task=tail.then(async()=>{if(closed)fail('CACHE_CLOSED','Update cache closed');await init();return fn();});tail=task.catch(()=>{});return task;};
 // ---------------------------------------------------------------- cache self-heal
 // 现场故障：员工机缓存目录里留下异常残留（<root> 本身变成文件、stage 里 archive.zip
 // 变成目录、混进别的文件），旧代码一进来就 UNSAFE_PATH/BAD_METADATA，只能人工删目录。
 // 自愈原则：只隔离、不删除——可疑对象整体搬到 <profile>/employee-update-cache.repair-<ts>/
 // 里（<root> 本身坏了就改名成 <root>.broken-<ts>），留在原卷供取证，然后继续用干净的目录。
 // 为什么搬到 root 之外而不是就地改名：integrityKey() 在 key 缺失时要求 root 必须为空才能建
 // 新 key（否则 BAD_METADATA "Native integrity key missing from retained cache"），就地留
 // 一个隔离目录会让 key 永远建不出来，等于没自愈。
 // 安全边界：过不了原有断言（isFile/isSymbolicLink/realpath/路径前缀）的东西一律不信任、
 // 不复用；本函数不碰 .native-integrity-key、accepted-sequence.json、native-sequence.json，
 // 所以 hash、序号、防回滚这些安全结论完全不变。日志要等 key 建好之后才写进 root，
 // 否则自己那行 self-heal.log 会把"root 必须为空"卡死。
 const healLog=path.join(root,'self-heal.log'),KEEP_ENTRY=new Set(['.native-integrity-key','accepted-sequence.json','native-sequence.json','self-heal.log']);
 let healLines=[],healSafeLog=false,healBox=null;
 function healStamp(){return new Date().toISOString().replace(/[^0-9]/g,'');}
 function healEvent(action,original,target,note){healLines.push(new Date().toISOString()+' '+action+' '+original+' -> '+target+(note?' ('+note+')':''));}
 async function healExists(file){try{await io.lstat(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
 async function healMove(original,kind,note){
  if(!healBox){const base=path.join(profile,'employee-update-cache.repair-'+healStamp());let box=base,n=1;while(await healExists(box))box=base+'-'+n++;await io.mkdir(box,{mode:0o700});healBox=box;}
  const base=path.join(healBox,path.basename(original));let target=base,n=1;while(await healExists(target))target=base+'-'+n++;
  await io.rename(original,target);healEvent(kind,original,target,note);return target;
 }
 async function healFlush(){
  if(!healLines.length)return;const text=healLines.join('\n');healLines=[];
  if(!healSafeLog)return;
  try{const handle=await io.open(healLog,'a',0o600);try{await writeExactly(handle,0,Buffer.from(text+'\n'));await handle.sync();}finally{await handle.close();}}catch{}
 }
 async function selfHeal(reason){
  let s=null;try{s=await io.lstat(root,{bigint:true});}catch(e){if(e.code!=='ENOENT')throw e;}
  if(!s)return;
  if(s.isSymbolicLink()||!s.isDirectory()){
   let target=root+'.broken-'+healStamp();if(await healExists(target))target=target+'-'+Date.now();
   await io.rename(root,target);healEvent('broken',root,target,reason||'cache root is not a directory');
   await io.mkdir(root,{mode:0o700});return;
  }
  try{healSafeLog=(await io.lstat(path.join(root,'.native-integrity-key'),{bigint:true})).isFile();}catch(e){if(e.code!=='ENOENT')throw e;healSafeLog=false;}
  for(const name of await io.readdir(root)){
   if(KEEP_ENTRY.has(name))continue;
   const entry=path.join(root,name);let st;try{st=await io.lstat(entry,{bigint:true});}catch(e){if(e.code==='ENOENT')continue;throw e;}
   if(!UUID.test(name)||st.isSymbolicLink()||!st.isDirectory()){await healMove(entry,'entry','unexpected cache entry');continue;}
   let bad=null,items=[];try{items=await io.readdir(entry);}catch{bad='unreadable stage';}
   if(!bad)for(const item of items){if(item!=='archive.zip'&&item!=='sealed.json'){bad='unexpected file '+item;break;}let f;try{f=await io.lstat(path.join(entry,item),{bigint:true});}catch{bad='unreadable '+item;break;}if(f.isSymbolicLink()||!f.isFile()){bad=item+' is not a regular file';break;}}
   if(bad)await healMove(entry,'stage',bad);
  }
  await healFlush();
 }
 async function mkdirFresh(dir,mode,reason){try{await io.mkdir(dir,{mode});}catch(e){if(e.code!=='EEXIST')throw e;await selfHeal(reason);await io.mkdir(dir,{mode});}}
 async function init(){if(ready)return;await assertPath(io,profile,{directory:true});try{await io.mkdir(root,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;await selfHeal('cache root exists');}await assertPath(io,root,{directory:true,root:profile});await integrityKey(io,profile,{create:true});healSafeLog=true;await healFlush();ready=true;}
 function lookup(id){if(!UUID.test(id||'')||!stages.has(id))fail('UNKNOWN_STAGE','Unknown native update stage');const s=stages.get(id);if(s.poisoned)fail('BAD_STAGE','Update stage write failed');return s;}
 async function check(s){await assertPath(io,s.dir,{directory:true,root});return assertHandle(io,s.opened,{root});}
 async function accepted(){const file=path.join(root,'accepted-sequence.json');try{const marker=await authenticatedRead(io,file,profile,4096);if(!exact(marker,['version','sequence'])||marker.version!==1||!Number.isSafeInteger(marker.sequence)||marker.sequence<0)fail('BAD_METADATA','Invalid accepted update sequence');return marker.sequence;}catch(e){if(e.code==='ENOENT')return 0;throw e;}}
 const api={
  begin:c=>enqueue(async()=>{const envelope=await options.resolveCatalogEnvelope(c),catalog=verifySignedCatalog(envelope,policy);if(JSON.stringify(c)!==JSON.stringify(catalog)||catalog.sequence<await accepted())fail('BAD_MANIFEST','Catalog proof mismatch or stale sequence');const id=crypto.randomUUID(),dir=path.join(root,id);await mkdirFresh(dir,0o700,'duplicate stage');await assertPath(io,dir,{directory:true,root});const opened=await openChecked(io,path.join(dir,'archive.zip'),'wx+',{missing:true,root});stages.set(id,{id,dir,opened,catalog,envelope:freeze({...envelope}),length:0,sealed:false,poisoned:false});return id;}),
  write:(id,offset,bytes)=>enqueue(async()=>{const s=lookup(id);if(s.sealed||!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>CHUNK||!Number.isSafeInteger(offset)||offset!==s.length||offset+bytes.length>s.catalog.archive.size)fail('BAD_OFFSET','Update chunks must be sequential and bounded');await check(s);try{await writeExactly(s.opened.handle,offset,bytes);await s.opened.handle.sync();s.length+=bytes.length;const stat=await assertHandle(io,s.opened,{snapshot:false,root});if(stat.size!==BigInt(s.length))fail('WRITE_FAILED','Partial update write');s.opened.snapshot=statState(stat);}catch(e){s.poisoned=true;throw e;}}),
  read:(id,offset,length)=>enqueue(async()=>{const s=lookup(id);if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(length)||offset<0||length<0||length>CHUNK||offset+length>s.length)fail('BAD_OFFSET','Invalid cache read');await check(s);const bytes=await readExactly(s.opened.handle,offset,length);await check(s);return bytes;}),
  size:id=>enqueue(async()=>{const s=lookup(id);await check(s);return s.length;}),
  seal:(id,proof)=>enqueue(async()=>{const s=lookup(id);const expected={archiveSha256:s.catalog.archive.sha256,sequence:s.catalog.sequence,version:s.catalog.version,fileCount:s.catalog.files.length};if(s.sealed||JSON.stringify(proof)!==JSON.stringify(expected)||s.length!==s.catalog.archive.size)fail('BAD_PROOF','Update seal proof does not match signed catalog');verifySignedCatalog(s.envelope,policy);await check(s);if(await hashHandle(s.opened.handle,s.length)!==expected.archiveSha256)fail('BAD_ARCHIVE','Update cache digest mismatch');await check(s);await authenticatedWrite(io,path.join(s.dir,'sealed.json'),{version:1,stageId:id,envelope:s.envelope,proof:expected,archiveIdentity:s.opened.identity},profile,root);await s.opened.handle.close();s.opened=await openChecked(io,s.opened.file,'r',{root});s.sealed=true;s.proof=freeze(expected);}),
  getInstallStage:id=>enqueue(async()=>{const s=lookup(id);if(!s.sealed)fail('NOT_SEALED','Update stage not sealed');verifySignedCatalog(s.envelope,policy);if(s.catalog.sequence<await accepted())fail('STALE_CATALOG','Staged release has been superseded');await check(s);const marker=await authenticatedRead(io,path.join(s.dir,'sealed.json'),profile,4194304);if(marker.stageId!==id||marker.archiveIdentity!==s.opened.identity||JSON.stringify(marker.envelope)!==JSON.stringify(s.envelope)||JSON.stringify(marker.proof)!==JSON.stringify(s.proof))fail('BAD_PROOF','Update sealed marker changed');return freeze({stageId:id,stageDir:s.dir,archivePath:s.opened.file,envelope:s.envelope,catalog:s.catalog,proof:s.proof,archiveIdentity:s.opened.identity,profileDir:profile});}),
  remove:id=>enqueue(async()=>{if(!UUID.test(id||'')||!stages.has(id))fail('UNKNOWN_STAGE','Unknown native update stage');const s=stages.get(id);await assertPath(io,s.dir,{directory:true,root});await s.opened.handle.close().catch(()=>{});const entries=await io.readdir(s.dir);if(entries.some(name=>!['archive.zip','sealed.json'].includes(name)))fail('BAD_STAGE','Unexpected file in own update stage');for(const name of entries){const file=path.join(s.dir,name);await assertPath(io,file,{root});await io.unlink(file);}await assertPath(io,s.dir,{directory:true,root});await io.rmdir(s.dir);stages.delete(id);}),
  getAcceptedSequence:()=>enqueue(accepted),
  // 手动自愈入口：上层遇到 UNSAFE_PATH/BAD_METADATA 时先清残留再重试一次，避免人工删目录。
  selfHeal:()=>enqueue(()=>selfHeal('manual')),
  setAcceptedSequence:value=>enqueue(async()=>{if(!Number.isSafeInteger(value)||value<0||value<await accepted())fail('STALE_CATALOG','Accepted update sequence cannot go backwards');await authenticatedWrite(io,path.join(root,'accepted-sequence.json'),{version:1,sequence:value},profile,root);}),
  close:()=>{const task=tail.then(async()=>{closed=true;for(const s of stages.values())await s.opened.handle.close().catch(()=>{});});tail=task.catch(()=>{});return task;}
 };return api;
}
module.exports={createEmployeeUpdateCache,createTrustedUpdatePolicy,verifySignedCatalog,safeAbsolute,safeRelative,samePath,within,assertPath,openChecked,assertHandle,readExactly,writeExactly,hashHandle,readSmall,atomicWrite,authenticatedWrite,authenticatedRead,statIdentity,statState,digest,freeze,fail,UUID,CHUNK,MAX_ARCHIVE};

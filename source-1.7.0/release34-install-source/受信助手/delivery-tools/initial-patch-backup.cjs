'use strict';
// Initial installation uses an independent, pinned backup manifest. This module
// never initializes business data, imports node:sqlite, or restores live paths.
const fs=process.versions.electron?require('original-fs'):require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const CHUNK=256*1024,MAX_FILES=100000,MAX_FILE=100*1024**3,MAX_TOTAL=1024**4,MAX_MANIFEST=32*1024**2;
const MODULES=Object.freeze(['sales','ledger','inventory']),NAMES=Object.freeze({sales:'jewelry.sqlite',ledger:'ledger.db',inventory:'stockcheck.db'});
const PRINT_SUFFIXES=Object.freeze(['.print-ledger.json','.print-ledger.metadata.json','.central-print-ledger.json']);
const SHA=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function fail(message){const error=new Error(message);error.code='XJY_INITIAL_BACKUP';throw error;}
function fold(value){return process.platform==='win32'?value.toLowerCase():value;}
function isInside(root,file){const r=path.relative(fold(root),fold(file));return !r||r!=='..'&&!r.startsWith('..'+path.sep)&&!path.isAbsolute(r);}
function samePath(a,b){return typeof a==='string'&&typeof b==='string'&&fold(path.resolve(a))===fold(path.resolve(b));}
function safePart(value){return typeof value==='string'&&value.length>0&&value.length<=255&&!/[\\/:<>"|?*\x00-\x1f]/.test(value)&&value!=='.'&&value!=='..'&&!/[. ]$/.test(value)&&!/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value);}
function absolute(value){if(typeof value!=='string'||!path.isAbsolute(value)||value.includes('\0'))fail('An absolute owned path is required');const resolved=path.resolve(value);if(value.split(/[\\/]/).some(x=>x==='..'||x==='.')||!samePath(resolved,value))fail('Path aliases are forbidden');const parsed=path.parse(resolved);for(const part of resolved.slice(parsed.root.length).split(path.sep).filter(Boolean))if(!safePart(part))fail('Unsafe physical path');return resolved;}
function relative(value){if(typeof value!=='string'||!value||value.length>2048||value.startsWith('/')||value.split('/').some(x=>!safePart(x)))fail('Invalid manifest relative path');return value;}
function exists(io,file){try{io.lstatSync(file,{bigint:true});return true;}catch(error){if(error?.code==='ENOENT')return false;throw error;}}
function stat(io,file){return io.lstatSync(file,{bigint:true});}
function regular(value){return value?.isFile()&&!value.isSymbolicLink()&&Number(value.nlink)===1;}
function identity(value){return{dev:String(value.dev),ino:String(value.ino),birthtime:String(value.birthtimeNs??value.birthtimeMs)};}
function state(value){return{...identity(value),size:String(value.size),mtime:String(value.mtimeNs??value.mtimeMs),ctime:String(value.ctimeNs??value.ctimeMs),mode:String(value.mode),nlink:String(value.nlink)};}
function equal(a,b){return JSON.stringify(a)===JSON.stringify(b);}
function physical(io,file,{allowMissing=false,kind}={}){
 const target=absolute(file),parents=[];let current=target;
 while(true){parents.push(current);const next=path.dirname(current);if(next===current)break;current=next;}
 for(const item of parents.reverse()){
  if(!exists(io,item)){if(allowMissing)continue;fail('Required physical path is missing: '+item);}
  const value=stat(io,item);if(value.isSymbolicLink())fail('Physical path contains a link');
  if(!value.isDirectory()&&!regular(value))fail('Physical path is linked or unsupported');
  const real=io.realpathSync.native?io.realpathSync.native(item):io.realpathSync(item);if(!samePath(real,item))fail('Physical path alias is forbidden');
 }
 if(exists(io,target)){const value=stat(io,target);if(kind==='directory'&&!value.isDirectory())fail('Expected an existing directory');if(kind==='file'&&!regular(value))fail('Expected a single-link regular file');}
 return target;
}
function guardFor(root,io){const checked=physical(io,root,{kind:'directory'});return file=>{const target=absolute(file);if(!isInside(checked,target))fail('Path is outside fixed root; manual review is required');return physical(io,target,{allowMissing:true});};}
function writeAll(io,fd,bytes){let offset=0;while(offset<bytes.length){const n=io.writeSync(fd,bytes,offset,bytes.length-offset,null);if(!Number.isInteger(n)||n<=0||n>bytes.length-offset)fail('Incomplete owned output write');offset+=n;}}
function readStable(io,file,{collect=false,max=MAX_FILE,destination}={}){
 physical(io,file,{kind:'file'});const before=stat(io,file);if(Number(before.size)>max||Number(before.size)<0||!Number.isSafeInteger(Number(before.size)))fail('Source file exceeds bounded stream limit');
 const fd=io.openSync(file,'r'),hash=crypto.createHash('sha256'),buffer=Buffer.alloc(CHUNK),chunks=[];let size=0,out;
 try{
  if(!regular(io.fstatSync(fd,{bigint:true}))||!equal(state(before),state(io.fstatSync(fd,{bigint:true}))))fail('Source identity changed before read');
  if(destination){physical(io,path.dirname(destination),{kind:'directory'});physical(io,destination,{allowMissing:true});if(exists(io,destination))fail('Owned backup output already exists');out=io.openSync(destination,'wx',0o600);}
  while(true){const count=io.readSync(fd,buffer,0,buffer.length,null);if(!Number.isInteger(count)||count<0||count>buffer.length)fail('Invalid bounded source stream');if(!count)break;size+=count;if(size>max||size>Number(before.size))fail('Source changed during read');const bytes=buffer.subarray(0,count);hash.update(bytes);if(collect)chunks.push(Buffer.from(bytes));if(out!==undefined)writeAll(io,out,bytes);}
  const held=io.fstatSync(fd,{bigint:true});physical(io,file,{kind:'file'});const after=stat(io,file);
  if(size!==Number(before.size)||!equal(state(before),state(held))||!equal(state(before),state(after)))fail('Source changed during read');
  if(out!==undefined)io.fsyncSync(out);
  return{size,sha256:hash.digest('hex'),state:state(before),...(collect?{bytes:Buffer.concat(chunks)}:{})};
 }finally{if(out!==undefined)io.closeSync(out);io.closeSync(fd);}
}
function jsonFile(io,file,max=8*1024**2){try{return JSON.parse(readStable(io,file,{collect:true,max}).bytes.toString('utf8'));}catch(error){if(error?.code==='XJY_INITIAL_BACKUP')throw error;fail('Persistent configuration JSON is invalid');}}
function freeze(value){if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;}
function deriveInitialHostLayout({fixedRoot,fileSystem=fs}={}){
 const io=fileSystem,root=physical(io,absolute(fixedRoot),{kind:'directory'}),check=guardFor(root,io);
 const dataDir=check(path.join(root,'工作室数据')),configDir=check(path.join(root,'程序设置')),settingsFile=check(path.join(configDir,'legacy-module-settings.json'));
 for(const file of [dataDir,configDir])physical(io,file,{kind:'directory'});
 const saved={};if(exists(io,settingsFile)){
  const value=jsonFile(io,settingsFile);if(value?.version!==1||!value.modules||typeof value.modules!=='object'||Array.isArray(value.modules)||Object.keys(value).some(k=>!['version','modules'].includes(k))||Object.keys(value.modules).some(k=>!['ledger','inventory'].includes(k)))fail('Internal module configuration is invalid');
  for(const [id,entry]of Object.entries(value.modules)){if(!entry||typeof entry!=='object'||Array.isArray(entry)||Object.keys(entry).some(k=>k!=='dataDir')||typeof entry.dataDir!=='string')fail('Internal module directory configuration is invalid');saved[id]=check(absolute(entry.dataDir));}
 }
 const ledgerDir=check(saved.ledger||path.join(root,'内帐')),inventoryDir=check(saved.inventory||path.join(root,'库管'));
 for(const directory of [ledgerDir,inventoryDir])physical(io,directory,{kind:'directory'});
 const base=[dataDir,ledgerDir,inventoryDir,configDir];for(let i=0;i<base.length;i++)for(let j=i+1;j<base.length;j++)if(isInside(base[i],base[j])||isInside(base[j],base[i]))fail('Business and configuration directories cannot overlap');
 const databases=MODULES.map(module=>{const directory=module==='sales'?dataDir:module==='ledger'?ledgerDir:inventoryDir,file=check(path.join(directory,NAMES[module]));if(!exists(io,file)||!regular(stat(io,file)))fail('Complete existing database is missing: '+module);return{module,file,path:relative(path.relative(root,file).split(path.sep).join('/'))};});
 const documentsDir=check(path.join(root,'工作文档')),imageDir=check(path.join(root,'报价图片')),outputSettingsFile=check(path.join(configDir,'image-output-settings.json')),outputs=[imageDir];
 if(exists(io,outputSettingsFile)){
  const value=jsonFile(io,outputSettingsFile);if(value?.version!==1||!value.folders||typeof value.folders!=='object'||Array.isArray(value.folders)||Object.keys(value).some(k=>!['version','folders'].includes(k)))fail('Image output configuration is invalid');
  for(const selected of Object.values(value.folders)){if(typeof selected!=='string')fail('Image output directory configuration is invalid');outputs.push(check(absolute(selected)));}
 }
 const directories=[...base,documentsDir,...outputs].filter((file,index,items)=>items.findIndex(x=>samePath(x,file))===index);
 for(const file of directories)if(exists(io,file))physical(io,file,{kind:'directory'});
 // Optional output directories may overlap covered folders; the scanner deduplicates
 // the same physical file rather than omitting any configured persistent folder.
 const printing=PRINT_SUFFIXES.map(suffix=>check(dataDir+suffix));
 return freeze({schemaVersion:1,root,dataDir,ledgerDir,inventoryDir,configDir,documentsDir,imageDir,outputDirectories:outputs,directories,printing,databases,settingsFiles:[settingsFile,outputSettingsFile]});
}
function layoutValidated(layout,io){if(!layout||layout.schemaVersion!==1||typeof layout.root!=='string'||!Array.isArray(layout.databases)||layout.databases.length!==3||!Array.isArray(layout.directories)||!Array.isArray(layout.printing))fail('Trusted host backup layout is required');const live=deriveInitialHostLayout({fixedRoot:layout.root,fileSystem:io});if(!equal(layout,live))fail('Host layout changed after admission');return live;}
function scanSources(layout,io){
 const check=guardFor(layout.root,io),files=new Map(),directories=new Map();let total=0;
 const excluded=new Set(layout.databases.flatMap(entry=>[entry.file+'-wal',entry.file+'-shm',entry.file+'-journal']).map(fold));
 function add(file){check(file);const value=stat(io,file);if(!regular(value))fail('Source dependency contains a link or unsupported file');const key=relative(path.relative(layout.root,file).split(path.sep).join('/'));if(files.has(fold(key)))return;
  // SQLite read-only WAL readers may create/update SHM read marks and create an
  // empty WAL. They contain no committed business pages. Their physical safety
  // is still checked; DB bytes and every nonempty WAL/journal remain fingerprinted.
  if(layout.databases.some(entry=>samePath(file,entry.file+'-shm')))return;const proof=readStable(io,file);if(proof.size===0&&layout.databases.some(entry=>samePath(file,entry.file+'-wal')))return;
  total+=proof.size;if(files.size>=MAX_FILES||total>MAX_TOTAL)fail('Complete backup exceeds bounded file or total size limit');files.set(fold(key),{path:key,file,...proof,excluded:excluded.has(fold(file))});}
 function walk(directory){check(directory);if(directories.has(fold(directory)))return;if(directories.size>=MAX_FILES)fail('Backup directory count exceeds bounded limit');if(!exists(io,directory)){directories.set(fold(directory),{file:directory,missing:true});return;}physical(io,directory,{kind:'directory'});const value=stat(io,directory);directories.set(fold(directory),{file:directory,state:{...identity(value),mode:String(value.mode)}});const names=io.readdirSync(directory).sort();for(const name of names){if(!safePart(name))fail('Unsupported source dependency name');const file=check(path.join(directory,name)),entry=stat(io,file);if(entry.isDirectory())walk(file);else add(file);}if(!equal(state(value),state(stat(io,directory))))fail('Source directory changed during enumeration');}
 for(const directory of layout.directories)walk(directory);for(const file of layout.printing){check(file);if(exists(io,file))add(file);else files.set('missing:'+fold(file),{file,missing:true});}
 return{files:[...files.values()].sort((a,b)=>String(a.path||a.file).localeCompare(String(b.path||b.file))),directories:[...directories.values()].sort((a,b)=>a.file.localeCompare(b.file))};
}
function sourcesEqual(a,b){return equal(a,b);}
function changedDependency(a,b){for(const key of ['files','directories']){for(const first of a[key]){const other=b[key].find(item=>item.file===first.file);if(!equal(first,other))return String(first.path||path.basename(first.file))+': '+(!other?'membership':Object.keys(first).filter(name=>!equal(first[name],other[name])).join(','));}const added=b[key].find(item=>!a[key].some(first=>first.file===item.file));if(added)return String(added.path||path.basename(added.file))+': new membership';}return 'source inventory';}
async function quiescent(callback){if(typeof callback!=='function'||await callback()!==true)fail('Old applications must be normally closed; source quiescence was not proved');}
function mkdir(io,file){physical(io,file,{allowMissing:true});io.mkdirSync(file,{recursive:true,mode:0o700});physical(io,file,{kind:'directory'});}
function writeNew(io,file,bytes){physical(io,file,{allowMissing:true});const fd=io.openSync(file,'wx',0o600);try{writeAll(io,fd,bytes);io.fsyncSync(fd);}finally{io.closeSync(fd);}physical(io,file,{kind:'file'});}
function validateEvidence(proof,databases,snapshot){if(!Array.isArray(proof)||proof.length!==3)fail('Complete three-database verification evidence is required');const known=new Set();for(const item of proof){const expected=databases.find(x=>x.module===item?.module);if(!expected||known.has(item.module)||item.integrity!=='ok'||item.foreignKeyCount!==0)fail('Database integrity verification failed');known.add(item.module);if(snapshot){if(!samePath(item.source,expected.source)||!samePath(item.snapshot,expected.snapshot)||item.readOnly!==true||item.walConsistent!==true||item.busy!==false)fail('Read-only WAL-consistent snapshot evidence is missing');}else if(!samePath(item.file,expected.file)||item.dependenciesVerified!==true)fail('Database dependencies verification failed');}return proof.map(item=>({...item}));}
function backupPaths(backupDir,io,sourceRoot){const directory=absolute(backupDir);physical(io,path.dirname(directory),{kind:'directory'});physical(io,directory,{allowMissing:true});if(sourceRoot&&(isInside(sourceRoot,directory)||isInside(directory,sourceRoot)))fail('Backup directory must be outside live business root');return{directory,filesDir:path.join(directory,'files'),manifestFile:path.join(directory,'manifest.json'),ownerFile:path.join(directory,'.initial-backup-owner.json')};}
async function createInitialBackup({layout,backupDir,snapshotDatabases,verifyDatabases,assertQuiescent,fileSystem=fs,now=()=>new Date()}={}){
 const io=fileSystem,live=layoutValidated(layout,io),paths=backupPaths(backupDir,io,live.root);
 if(typeof snapshotDatabases!=='function'||typeof verifyDatabases!=='function')fail('Trusted read-only database snapshot and verification callbacks are required');
 if(exists(io,paths.directory))fail('Initial backup directory already exists');await quiescent(assertQuiescent);layoutValidated(live,io);
 const original=scanSources(live,io);await quiescent(assertQuiescent);io.mkdirSync(paths.directory,{mode:0o700});physical(io,paths.directory,{kind:'directory'});mkdir(io,paths.filesDir);
 const id=crypto.randomUUID(),stamp=now();if(!(stamp instanceof Date)||!Number.isFinite(stamp.getTime()))fail('Backup timestamp is invalid');
 const owner={schemaVersion:1,type:'initial-patch-data-backup',id};writeNew(io,paths.ownerFile,Buffer.from(JSON.stringify(owner)));
 const requested=live.databases.map(entry=>{const snapshot=path.join(paths.filesDir,...entry.path.split('/'));mkdir(io,path.dirname(snapshot));return{module:entry.module,source:entry.file,snapshot};});
 const evidence=validateEvidence(await snapshotDatabases({databases:freeze(requested.map(x=>({...x}))),root:live.root}),requested,true);await quiescent(assertQuiescent);
 const afterSnapshots=scanSources(live,io);if(!sourcesEqual(original,afterSnapshots))fail('Source changed during read-only snapshots; no completed backup is published ('+changedDependency(original,afterSnapshots)+')');
 const entries=[],databaseRecords=[];let bytes=0;
 for(const source of original.files){if(source.missing||source.excluded)continue;const database=live.databases.find(x=>samePath(x.file,source.file)),target=path.join(paths.filesDir,...source.path.split('/'));mkdir(io,path.dirname(target));let proof;
  if(database){physical(io,target,{kind:'file'});proof=readStable(io,target);databaseRecords.push({module:database.module,path:source.path,integrity:'ok',foreignKeyCount:0,readOnly:true,walConsistent:true,busy:false});}
  else{proof=readStable(io,source.file,{destination:target});if(proof.sha256!==source.sha256||proof.size!==source.size||!equal(proof.state,source.state))fail('Source changed during backup copy');}
  bytes+=proof.size;if(bytes>MAX_TOTAL)fail('Backup exceeds bounded total size');entries.push({path:source.path,size:proof.size,sha256:proof.sha256});
 }
 entries.sort((a,b)=>a.path.localeCompare(b.path));databaseRecords.sort((a,b)=>MODULES.indexOf(a.module)-MODULES.indexOf(b.module));
 const copiedDatabases=databaseRecords.map(entry=>({module:entry.module,file:path.join(paths.filesDir,...entry.path.split('/'))}));validateEvidence(await verifyDatabases({databases:freeze(copiedDatabases),root:paths.filesDir}),copiedDatabases,false);await quiescent(assertQuiescent);
 if(!sourcesEqual(original,scanSources(live,io)))fail('Source changed during backup verification; no completed backup is published');
 const emptyDirectories=original.directories.filter(x=>!x.missing&&!samePath(x.file,live.root)).map(x=>relative(path.relative(live.root,x.file).split(path.sep).join('/'))).sort();for(const name of emptyDirectories)mkdir(io,path.join(paths.filesDir,...name.split('/')));
 const payload=listPayload(paths.filesDir,io),manifest={schemaVersion:1,application:'xjy-jewelry-offline',kind:'initial-host-pre-update',id,createdAt:stamp.toISOString(),originalRoot:live.root,owner,directories:payload.directories,databases:databaseRecords,files:entries,bytes};validatePayload(payload,manifest);
 const raw=Buffer.from(JSON.stringify(manifest));if(raw.length>MAX_MANIFEST)fail('Backup manifest exceeds bounded size');const manifestSha256=crypto.createHash('sha256').update(raw).digest('hex');
 // The expected digest must be bound by the independently approved installer
 // transaction. An unpinned self-authored manifest is never accepted as trust.
 writeNew(io,paths.manifestFile,raw);
 return freeze({directory:paths.directory,manifestSha256,files:entries.length,bytes,databases:databaseRecords.map(x=>({...x}))});
}
function parseManifest(paths,expected,io){
 if(typeof expected!=='string'||!SHA.test(expected))fail('Independently pinned manifest SHA256 is required');const raw=readStable(io,paths.manifestFile,{collect:true,max:MAX_MANIFEST});if(raw.sha256!==expected)fail('Pinned backup manifest integrity failed');let value;try{value=JSON.parse(raw.bytes.toString('utf8'));}catch{fail('Backup manifest JSON is invalid');}
 const keys=['schemaVersion','application','kind','id','createdAt','originalRoot','owner','directories','databases','files','bytes'];if(!value||Object.keys(value).some(x=>!keys.includes(x))||value.schemaVersion!==1||value.application!=='xjy-jewelry-offline'||value.kind!=='initial-host-pre-update'||!UUID.test(value.id||'')||!Number.isFinite(Date.parse(value.createdAt))||typeof value.originalRoot!=='string'||!Array.isArray(value.files)||value.files.length>MAX_FILES||!Array.isArray(value.databases)||value.databases.length!==3||!Array.isArray(value.directories)||value.directories.length>MAX_FILES||!Number.isSafeInteger(value.bytes)||value.bytes<0||value.bytes>MAX_TOTAL)fail('Backup manifest schema is invalid');absolute(value.originalRoot);
 if(!equal(value.owner,{schemaVersion:1,type:'initial-patch-data-backup',id:value.id})||!equal(jsonFile(io,paths.ownerFile,8192),value.owner))fail('Backup directory ownership differs from pinned manifest');
 const seen=new Set();let total=0;for(const item of value.files){if(!item||Object.keys(item).some(x=>!['path','size','sha256'].includes(x))||!Number.isSafeInteger(item.size)||item.size<0||item.size>MAX_FILE||!SHA.test(item.sha256||''))fail('Backup file manifest is invalid');relative(item.path);const name=fold(item.path);if(seen.has(name))fail('Duplicate backup manifest path');seen.add(name);total+=item.size;}if(total!==value.bytes)fail('Backup manifest byte total differs');
 const dirSeen=new Set();for(const name of value.directories){relative(name);if(dirSeen.has(fold(name))||seen.has(fold(name)))fail('Invalid duplicate backup directory path');dirSeen.add(fold(name));}
 const modules=new Set();for(const entry of value.databases){if(!entry||Object.keys(entry).some(x=>!['module','path','integrity','foreignKeyCount','readOnly','walConsistent','busy'].includes(x))||!MODULES.includes(entry.module)||modules.has(entry.module)||entry.integrity!=='ok'||entry.foreignKeyCount!==0||entry.readOnly!==true||entry.walConsistent!==true||entry.busy!==false||path.posix.basename(relative(entry.path))!==NAMES[entry.module]||!seen.has(fold(entry.path)))fail('Complete database snapshot manifest is invalid');modules.add(entry.module);}
 return value;
}
function listPayload(filesDir,io){physical(io,filesDir,{kind:'directory'});const check=guardFor(filesDir,io),items=[],directories=[];
 function walk(folder){physical(io,folder,{kind:'directory'});const before=state(stat(io,folder));for(const name of io.readdirSync(folder).sort()){if(!safePart(name))fail('Invalid backup payload name');const file=check(path.join(folder,name)),value=stat(io,file),r=relative(path.relative(filesDir,file).split(path.sep).join('/'));if(value.isDirectory()){if(directories.length>=MAX_FILES)fail('Backup directory count exceeds bounded limit');directories.push(r);walk(file);}else{if(!regular(value))fail('Backup payload contains a link');if(items.length>=MAX_FILES)fail('Backup payload exceeds bounded count');items.push({path:r,...readStable(io,file)});}}if(!equal(before,state(stat(io,folder))))fail('Backup payload changed during enumeration');}
 walk(filesDir);return{items:items.sort((a,b)=>a.path.localeCompare(b.path)),directories:directories.sort()};
}
function validatePayload(payload,manifest){if(payload.items.length!==manifest.files.length)fail('Unlisted or missing backup payload differs from manifest');for(let i=0;i<payload.items.length;i++){const item=payload.items[i],record=manifest.files[i];if(!record||item.path!==record.path||item.size!==record.size||item.sha256!==record.sha256)fail('Backup payload hash integrity failed');}if(!equal(payload.directories,manifest.directories))fail('Backup directory manifest differs');}
async function verifyInitialBackup({backupDir,expectedManifestSha256,verifyDatabases,fileSystem=fs}={}){
 const io=fileSystem,paths=backupPaths(backupDir,io);physical(io,paths.directory,{kind:'directory'});if(typeof verifyDatabases!=='function')fail('Trusted database verifier is required');const manifest=parseManifest(paths,expectedManifestSha256,io),names=io.readdirSync(paths.directory).sort();if(!equal(names,['.initial-backup-owner.json','files','manifest.json'].sort()))fail('Unlisted backup root file differs from manifest');
 const payload=listPayload(paths.filesDir,io);validatePayload(payload,manifest);
 const databases=manifest.databases.map(entry=>({module:entry.module,file:path.join(paths.filesDir,...entry.path.split('/'))}));validateEvidence(await verifyDatabases({databases:freeze(databases),root:paths.filesDir}),databases,false);
 // Verification callbacks cannot replace the pinned archive or a dependency.
 const after=listPayload(paths.filesDir,io);if(!equal(payload,after))fail('Backup payload changed during database verification');if(readStable(io,paths.manifestFile,{max:MAX_MANIFEST}).sha256!==expectedManifestSha256)fail('Backup manifest changed during verification');if(!equal(jsonFile(io,paths.ownerFile,8192),manifest.owner)||!equal(io.readdirSync(paths.directory).sort(),names))fail('Backup ownership or root membership changed during verification');
 return freeze({directory:paths.directory,manifestSha256:expectedManifestSha256,files:manifest.files.length,bytes:manifest.bytes,databases:manifest.databases.map(x=>({...x})),manifest});
}
async function restoreToOwnedDirectory({backupDir,expectedManifestSha256,destinationDir,verifyDatabases,fileSystem=fs}={}){
 const io=fileSystem,verified=await verifyInitialBackup({backupDir,expectedManifestSha256,verifyDatabases,fileSystem:io}),destination=absolute(destinationDir);physical(io,path.dirname(destination),{kind:'directory'});physical(io,destination,{allowMissing:true});if(exists(io,destination))fail('Restore destination already exists; live or existing paths are never overwritten');if(isInside(verified.directory,destination)||isInside(destination,verified.directory)||isInside(verified.manifest.originalRoot,destination)||isInside(destination,verified.manifest.originalRoot))fail('Restore destination must be an independent owned directory');
 io.mkdirSync(destination,{mode:0o700});physical(io,destination,{kind:'directory'});const owned=guardFor(destination,io);for(const directory of verified.manifest.directories)mkdir(io,owned(path.join(destination,...directory.split('/'))));
 for(const item of verified.manifest.files){const source=path.join(verified.directory,'files',...item.path.split('/')),target=owned(path.join(destination,...item.path.split('/')));mkdir(io,path.dirname(target));const copy=readStable(io,source,{destination:target});if(copy.size!==item.size||copy.sha256!==item.sha256)fail('Pinned backup changed during owned restore');}
 const databases=verified.manifest.databases.map(entry=>({module:entry.module,file:owned(path.join(destination,...entry.path.split('/')))}));validateEvidence(await verifyDatabases({databases:freeze(databases),root:destination}),databases,false);
 validatePayload(listPayload(destination,io),verified.manifest);
 writeNew(io,owned(path.join(destination,'.initial-backup-restored.json')),Buffer.from(JSON.stringify({schemaVersion:1,type:'initial-patch-owned-replica',manifestSha256:expectedManifestSha256,id:verified.manifest.id})));
 return freeze({directory:destination,manifestSha256:expectedManifestSha256,files:verified.files,bytes:verified.bytes,databases:verified.databases});
}
function sqliteApproved(sqlite,predicate){if(typeof predicate!=='function'||predicate()!==true||typeof sqlite?.DatabaseSync!=='function'||typeof sqlite?.backup!=='function')fail('Independently approved source engine with Node SQLite is required');}
function databaseInputs(input,snapshot,io){if(!Array.isArray(input)||input.length!==3)fail('Exactly three explicit owned database paths are required');const modules=new Set(),files=new Set();for(const item of input){if(!MODULES.includes(item?.module)||modules.has(item.module))fail('Duplicate or unknown database');modules.add(item.module);const file=physical(io,absolute(snapshot?item.source:item.file),{kind:'file'});if(files.has(fold(file)))fail('Duplicate physical database');files.add(fold(file));if(snapshot){physical(io,path.dirname(absolute(item.snapshot)),{kind:'directory'});if(exists(io,item.snapshot))fail('Database snapshot already exists');}}return input;}
// Only called after existing canonical/physical validation; never a caller path policy.
function sqliteNativePath(file){return process.platform==='win32'?path.toNamespacedPath(file):file;}
function probeDatabase(sqlite,file){const db=new sqlite.DatabaseSync(sqliteNativePath(file),{readOnly:true,allowExtension:false});try{db.setDefensive?.(true);const rows=db.prepare('PRAGMA quick_check(1)').all(),keys=rows.flatMap(row=>Object.values(row));if(keys.length!==1||keys[0]!=='ok'||db.prepare('SELECT * FROM pragma_foreign_key_check LIMIT 1').get())fail('Read-only database quick_check or foreign-key check failed');return{integrity:'ok',foreignKeyCount:0};}finally{db.close();}}
function makePortableSnapshot(sqlite,file){const db=new sqlite.DatabaseSync(sqliteNativePath(file),{allowExtension:false});try{const result=db.prepare('PRAGMA journal_mode=DELETE').get();if(Object.values(result||{})[0]!=='delete')fail('Owned database snapshot could not become a portable single file');}finally{db.close();}}
function createNodeSqliteSnapshotter({sqlite,assertEngineApproved,fileSystem=fs}={}){
 // The caller must provide a signed-engine predicate. No require(node:sqlite)
 // or executable launch occurs here, including when the module is imported.
 return async({databases})=>{sqliteApproved(sqlite,assertEngineApproved);databaseInputs(databases,true,fileSystem);const held=[];try{for(const item of databases){const db=new sqlite.DatabaseSync(sqliteNativePath(item.source),{readOnly:true,allowExtension:false});held.push({db,item});db.setDefensive?.(true);db.exec('BEGIN');db.prepare('SELECT count(*) AS count FROM sqlite_master').get();}const proof=[];for(const {db,item}of held){await sqlite.backup(db,sqliteNativePath(item.snapshot));physical(fileSystem,item.snapshot,{kind:'file'});makePortableSnapshot(sqlite,item.snapshot);proof.push({module:item.module,source:item.source,snapshot:item.snapshot,readOnly:true,walConsistent:true,busy:false,...probeDatabase(sqlite,item.snapshot)});}return proof;}finally{for(const {db}of held.reverse()){try{db.exec('ROLLBACK');}finally{db.close();}}}};
}
function validateSalesImages({sales,root,io}){
 const check=guardFor(root,io),images=check(path.join(path.dirname(sales),'images')),metadata=check(path.join(images,'metadata.json'));if(!exists(io,images))return;
 const names=io.readdirSync(images);if(!exists(io,metadata)){if(names.some(name=>UUID.test(name)))fail('Saved sales image metadata is missing');return;}
 const index=jsonFile(io,metadata,MAX_MANIFEST);if(!index||typeof index!=='object'||Array.isArray(index))fail('Saved sales image metadata is invalid');for(const name of Object.keys(index)){if(!name.startsWith('images/')||!UUID.test(name.slice(7))||!index[name])fail('Saved sales image metadata identity is invalid');physical(io,check(path.join(images,name.slice(7))),{kind:'file'});}for(const name of names)if(UUID.test(name)&&!index['images/'+name])fail('Saved sales image index is incomplete');
}
function validateErpDependencies({sqlite,ledger,root,io}){
 const check=guardFor(root,io),db=new sqlite.DatabaseSync(sqliteNativePath(ledger),{readOnly:true,allowExtension:false});try{
  if(!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='erp_attachments'").get())return;
  const attachments=db.prepare('SELECT id,name,mime,size,sha256 FROM erp_attachments ORDER BY id LIMIT ?').all(MAX_FILES+1);if(attachments.length>MAX_FILES)fail('ERP attachment metadata exceeds bounded count');const known=new Set(),mimes={'image/png':['.png'],'image/jpeg':['.jpg','.jpeg'],'application/pdf':['.pdf']};
  for(const row of attachments){if(!UUID.test(row.id||'')||known.has(row.id)||typeof row.name!=='string'||!safePart(row.name)||row.name!==row.name.normalize('NFKC').trim()||row.name.length>150||!mimes[row.mime]?.includes(path.extname(row.name).toLowerCase())||!Number.isSafeInteger(row.size)||row.size<1||row.size>2*1024**2||!SHA.test(row.sha256||''))fail('ERP attachment metadata is invalid');known.add(row.id);const file=check(path.join(path.dirname(ledger),'erp-attachments',row.id+'.bin')),proof=readStable(io,file,{max:2*1024**2});if(proof.size!==row.size||proof.sha256!==row.sha256)fail('ERP attachment hash integrity failed');}
  const documents=db.prepare('SELECT id,payload FROM erp_documents ORDER BY id LIMIT ?').all(MAX_FILES+1);if(documents.length>MAX_FILES)fail('ERP document metadata exceeds bounded count');let references=0;for(const row of documents){if(typeof row.payload!=='string'||Buffer.byteLength(row.payload)>8*1024**2)fail('ERP document payload exceeds bounded size');let value;try{value=JSON.parse(row.payload);}catch{fail('ERP document payload is invalid JSON');}if(!value||typeof value!=='object'||Array.isArray(value))fail('ERP document payload is invalid');if(!Object.hasOwn(value,'attachments'))continue;const ids=value.attachments;if(!Array.isArray(ids)||ids.length>MAX_FILES||new Set(ids).size!==ids.length)fail('ERP attachment references are invalid');references+=ids.length;if(references>MAX_FILES||ids.some(id=>!UUID.test(id||'')||!known.has(id)))fail('ERP document references missing attachment metadata');}
 }finally{db.close();}
}
function createNodeSqliteVerifier({sqlite,assertEngineApproved,fileSystem=fs}={}){
 return async({databases,root})=>{sqliteApproved(sqlite,assertEngineApproved);databaseInputs(databases,false,fileSystem);physical(fileSystem,root,{kind:'directory'});const check=guardFor(root,fileSystem);for(const item of databases)check(item.file);
  const proof=databases.map(item=>({module:item.module,file:item.file,...probeDatabase(sqlite,item.file),dependenciesVerified:true}));validateSalesImages({sales:databases.find(x=>x.module==='sales').file,root,io:fileSystem});validateErpDependencies({sqlite,ledger:databases.find(x=>x.module==='ledger').file,root,io:fileSystem});return proof;
 };
}
module.exports={deriveInitialHostLayout,createInitialBackup,verifyInitialBackup,restoreToOwnedDirectory,createNodeSqliteSnapshotter,createNodeSqliteVerifier};

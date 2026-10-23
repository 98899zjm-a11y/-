'use strict';
// Explicit162 feed publication only. Import is inert: no F access, business,
// signing keys, services, processes or program installation. Root owns CLI use.
const fs0=process.versions.electron?require('original-fs'):require('node:fs'),fs=fs0.promises;
const path=require('node:path'),crypto=require('node:crypto');
let u,core,programPath;
function loadLibraries(){if(!u){u=require('../project/desktop/employee-update-cache.cjs');core=require('../delivery-tools/initial-patch-core.cjs');programPath=require('../project/desktop/employee-update-installer.cjs').programPath;}}
const ROOT=path.resolve(__dirname,'..'),EXPECTED='E:\\codex\\2026-10-15\\work\\xjy-v16-deep-audit';
const VERSION='1.6.2',SOURCES=Object.freeze(['1.6.1','1.6.2']),SEQUENCE=8,SHA=/^[a-f0-9]{64}$/;
const NAMES=Object.freeze(['package.zip','catalog.json']),LOCK='.xjy-publish-162.lock';
const FEED=path.join(ROOT,'release-work/initial-162-feed-a1'),FEED_REPORT=path.join(ROOT,'reports/release-162-signed-feed-a1.json');
const MANIFEST=path.join(ROOT,'sandbox/results/post161-session-a1/release-162-artifact-a2/release-manifest.json');
const PROFILE='F:\\鑫金源珠宝资料\\程序设置';
const FIXED=Object.freeze({
 report:'cb52d793977ac937a4ca27d688c677681ce13ff6698ab0e0069fb49865f6a25d',
 manifest:'fe20ea7d83f2e2200624bf81364078ca8b206d1efcc8dbad03b1841d0fab9da2',
 publisher:'6e8b9cadb59aeb53f30d41f4471f70f644f0dfc7376ffb9d8a4c62defb98458c',
 publicPem:'bc6c3d2b42871e42d3eb91371034b410d507a228eeccb1d714acca60e8141b30',
 envelope:'1b40a19c9ba5ba9f5fded9123173682246a12d0982287fc4c34db1ce68db3fc8',
 catalog:'e4e294fa7e56641636e75c6c5417ff10dafaf4dae41664e858c7e667793d1ac5',
 archive:'f629a566956b87f6041e8428ee1747d108f7620e7ef4c1f2648b8f9dd57eaea6',
 archiveSize:163521368,asar:'02a3dc5128203889fa88205020c39970f08305b4496e64507ca5ec5eab7f7568'
});
const CODE_PINS=Object.freeze({
 'project/desktop/employee-update-cache.cjs':'5cb70079bf161a002a2701694e4774c2a11bf8d54efc6674ccb5c7b2c6729815',
 'project/desktop/employee-update-installer.cjs':'96ba3df08a0f706e599da7d452374b1f894d401c0a6ff605fc01255d01445bd0',
 'delivery-tools/initial-patch-core.cjs':'0f9de31c8ad8ec7e1b870a92d025909f4606363801a31ee3582b903c5704bbce'
});
function problem(code,message,cause){const error=new Error(message);error.code=code;if(cause)error.cause=cause;return error;}
function need(value,code,message){if(!value)throw problem(code,message);}
function equal(a,b){return JSON.stringify(a)===JSON.stringify(b);}
function overlaps(a,b){const rel=path.relative(a,b);return rel===''||rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel);}
function sameRecord(a,b){return !a||!b?a===b:a.size===b.size&&a.sha256===b.sha256&&a.identity===b.identity&&(!a.state||!b.state||a.state===b.state);}
async function fileRecord(io,file,root){
 try{await u.assertPath(io,file,{root});}catch(error){if(error.code==='ENOENT')return null;throw error;}
 const value=await core.fileHash(io,file,root),stat=await u.assertPath(io,file,{root});
 need(value.identity===u.statIdentity(stat),'FILE_CHANGED','Publication file changed after hashing');
 return{...value,state:u.statState(stat)};
}
async function checkedBytes(io,file,root,max=2097152){
 const bytes=await u.readSmall(io,file,max),record=await fileRecord(io,file,root);
 need(record&&record.size===bytes.length&&record.sha256===u.digest(bytes),'FILE_CHANGED','Public metadata changed during validation');return{bytes,record};
}
function catalogShape(catalog){
 need(catalog.version===VERSION&&catalog.sequence===SEQUENCE&&equal(catalog.sourceVersions,SOURCES),'BAD_CATALOG','Only the reviewed162 publication and161/162 source scope are admitted');
}
async function inspectSource({io,source,policy}){
 await u.assertPath(io,source,{directory:true});
 const selected=await checkedBytes(io,path.join(source,'catalog.json'),source);let envelope;
 try{envelope=JSON.parse(selected.bytes);}catch(error){throw problem('BAD_SIGNATURE','Signed publication envelope is not JSON',error);}
 const catalog=u.verifySignedCatalog(envelope,policy);catalogShape(catalog);
 need(catalog.files.length===policy.allowed.size&&catalog.files.every(file=>programPath(file.path))&&catalog.files.some(file=>file.path==='resources/app.asar'),'BAD_CATALOG','Publication must contain the exact approved program resources');
 const archive=await fileRecord(io,path.join(source,'package.zip'),source);
 need(archive&&archive.size===catalog.archive.size&&archive.sha256===catalog.archive.sha256,'BAD_ARCHIVE','Publication archive differs from signed metadata');
 return{envelope,catalog,rows:{'catalog.json':selected.record,'package.zip':archive}};
}
async function assertRecords(io,directory,expected,code='PUBLISH_CONFLICT'){
 for(const name of NAMES){let current;try{current=await fileRecord(io,path.join(directory,name),directory);}catch(error){throw problem(code,'Publication file cannot be revalidated: '+name,error);}need(sameRecord(current,expected[name]),code,'Publication file was changed by another writer: '+name);}
}
async function acquireLock(io,destination){
 const file=path.join(destination,LOCK),raw=Buffer.from(JSON.stringify({version:1,purpose:'xjy-feed-162-publication',owner:crypto.randomUUID(),pid:process.pid}));let opened;
 try{opened=await u.openChecked(io,file,'wx+',{missing:true,root:destination});}catch(error){if(error.code==='EEXIST')throw problem('BUSY','Another publication owns the on-disk lock; existing locks are never reclaimed',error);throw error;}
 try{await u.writeExactly(opened.handle,0,raw);await opened.handle.sync();await u.assertHandle(io,opened,{snapshot:false,root:destination});}catch(error){await opened.handle.close();throw error;}
 const saved=await fileRecord(io,file,destination);let closed=false;
 async function assertOwned(){
  try{need(!closed,'PUBLISH_CONFLICT','Publication lock has closed');await u.assertHandle(io,opened,{snapshot:false,root:destination});need(sameRecord(await fileRecord(io,file,destination),saved),'PUBLISH_CONFLICT','Publication lock ownership changed');}
  catch(error){if(error.code==='PUBLISH_CONFLICT')throw error;throw problem('PUBLISH_CONFLICT','Publication lock cannot be authenticated',error);}
 }
 return{assertOwned,async release(){
  try{await assertOwned();await opened.handle.close();closed=true;need(sameRecord(await fileRecord(io,file,destination),saved),'PUBLISH_CONFLICT','Publication lock changed before release');await io.unlink(file);}
  finally{if(!closed){await opened.handle.close();closed=true;}}
 }};
}
async function readPrevious(io,destination,policy){
 const rows={};for(const name of NAMES)rows[name]=await fileRecord(io,path.join(destination,name),destination);
 need(Boolean(rows[NAMES[0]])===Boolean(rows[NAMES[1]]),'INCOMPLETE_PUBLICATION','The existing publication is incomplete; preserve it for inspection');
 if(!rows[NAMES[0]])return{rows,catalog:null};
 const value=await checkedBytes(io,path.join(destination,'catalog.json'),destination);need(sameRecord(value.record,rows['catalog.json']),'PUBLISH_CONFLICT','Existing catalog changed');
 let envelope;try{envelope=JSON.parse(value.bytes);}catch(error){throw problem('BAD_PREVIOUS_PUBLICATION','Existing catalog is invalid; no replacement was made',error);}
 const catalog=u.verifySignedCatalog(envelope,policy,{allowExpired:true});
 need(SOURCES.includes(catalog.version)&&catalog.sequence<=SEQUENCE,'STALE_CATALOG','Existing publication is newer or outside the approved source scope');
 need(catalog.files.every(file=>programPath(file.path))&&catalog.archive.size===rows['package.zip'].size&&catalog.archive.sha256===rows['package.zip'].sha256,'BAD_PREVIOUS_PUBLICATION','The old publication pair is not complete and signed');
 await assertRecords(io,destination,rows);return{rows,catalog};
}
async function publishFeed(options){
 loadLibraries();
 const allowedKeys=['sourceDirectory','destinationDirectory','trustedPublicKey','allowedFiles','currentVersion','fileSystem','now','checkpoint'];
 need(options&&typeof options==='object'&&Object.keys(options).every(key=>allowedKeys.includes(key)),'INVALID_OPTIONS','Only the typed publication inputs are supported');
 const io=options.fileSystem||fs,source=u.safeAbsolute(options.sourceDirectory),destination=u.safeAbsolute(options.destinationDirectory),currentVersion=options.currentVersion||'1.6.1';
 need(!overlaps(source,destination)&&!overlaps(destination,source),'UNSAFE_PATH','Source and destination publications must be independent');
 need(SOURCES.includes(currentVersion)&&Array.isArray(options.allowedFiles)&&options.allowedFiles.every(programPath),'BAD_CATALOG','Only approved program resources and supported source versions are allowed');
 need(options.checkpoint===undefined||typeof options.checkpoint==='function','INVALID_OPTIONS','Checkpoint must be a trusted function');
 const policy=u.createTrustedUpdatePolicy({trustedPublicKey:options.trustedPublicKey,allowedFiles:options.allowedFiles,currentVersion,platform:'win32',arch:'x64',now:options.now||Date.now});
 const selected=await inspectSource({io,source,policy}); // Invalid sources never create a destination lock.
 await u.assertPath(io,destination,{directory:true});const lock=await acquireLock(io,destination);
 let previous,history=null,backupRows=null,mutated=false,committed=false;const expected={},temps={},changed=new Set();
 async function sourceUnchanged(){const after=await inspectSource({io,source,policy});need(equal(after.rows,selected.rows)&&equal(after.catalog,selected.catalog),'SOURCE_CHANGED','Source publication changed while publishing');}
 async function historyUnchanged(){if(history)await assertRecords(io,history,backupRows,'BAD_BACKUP');}
 async function gate(){await lock.assertOwned();await assertRecords(io,destination,expected);}
 async function stageCopy(from,fromRoot,name,spec,suffix){
  const file=path.join(destination,'.publish-162-'+crypto.randomUUID()+'-'+suffix);
  await core.copy(io,from,file,spec,fromRoot,destination);const record=await fileRecord(io,file,destination);need(record&&record.size===spec.size&&record.sha256===spec.sha256,'BAD_COPY','Staged publication does not match');return{file,record};
 }
 async function replace(name,staged){
  await gate();need(sameRecord(await fileRecord(io,staged.file,destination),staged.record),'FILE_CHANGED','Staged publication changed');
  await io.rename(staged.file,path.join(destination,name));changed.add(name);mutated=true;
  // Rename preserves file identity; record it before the read-back so a failure
  // cannot make rollback treat a possibly replaced file as the old one.
  expected[name]={...staged.record,state:null};
  const live=await fileRecord(io,path.join(destination,name),destination);
  need(sameRecord(live,expected[name]),'PUBLISH_CONFLICT','Publication changed immediately after rename');expected[name]=live;
 }
 async function rollback(){
  // Preflight the whole live pair and every retained backup before any restore.
  // A foreign package OR catalog prevents all rollback writes.
  await gate();await historyUnchanged();
  for(const name of NAMES){if(!changed.has(name))continue;
   if(previous.rows[name]){const staged=await stageCopy(path.join(history,name),history,name,backupRows[name],'restore.tmp');await replace(name,staged);}
   else{await gate();await io.unlink(path.join(destination,name));expected[name]=null;}
  }
  const restored={};for(const name of NAMES)restored[name]=await fileRecord(io,path.join(destination,name),destination);
  for(const name of NAMES)need(previous.rows[name]?restored[name]&&restored[name].size===previous.rows[name].size&&restored[name].sha256===previous.rows[name].sha256:restored[name]===null,'ROLLBACK_FAILED','Previous publication was not restored');
 }
 try{
  previous=await readPrevious(io,destination,policy);Object.assign(expected,previous.rows);
  const identical=NAMES.every(name=>previous.rows[name]&&previous.rows[name].size===selected.rows[name].size&&previous.rows[name].sha256===selected.rows[name].sha256);
  if(identical){await sourceUnchanged();await gate();return{published:false,alreadyPublished:true,version:VERSION,sequence:SEQUENCE,previousPublicationBackup:null};}
  need(!previous.catalog||previous.catalog.sequence!==SEQUENCE,'PUBLISH_CONFLICT','The same sequence may not publish different bytes');
  for(const name of NAMES)temps[name]=await stageCopy(path.join(source,name),source,name,selected.rows[name],name+'.tmp');
  await sourceUnchanged();await gate();
  if(previous.catalog){
   history=path.join(destination,'历史发布-'+crypto.randomUUID());await io.mkdir(history,{mode:0o700});await u.assertPath(io,history,{directory:true,root:destination});backupRows={};
   for(const name of NAMES){await core.copy(io,path.join(destination,name),path.join(history,name),previous.rows[name],destination,destination);backupRows[name]=await fileRecord(io,path.join(history,name),destination);}
   await gate();await historyUnchanged();
  }
  await sourceUnchanged();await replace('package.zip',temps['package.zip']);await options.checkpoint?.('package-replaced');
  await sourceUnchanged();await historyUnchanged();await replace('catalog.json',temps['catalog.json']);await options.checkpoint?.('catalog-replaced');
  await sourceUnchanged();await historyUnchanged();await gate();committed=true;
  return{published:true,alreadyPublished:false,version:VERSION,sequence:SEQUENCE,previousPublicationBackup:history};
 }catch(error){
  if(mutated&&!committed){try{await rollback();}catch(recovery){if(recovery.code==='PUBLISH_CONFLICT'){recovery.cause=error;throw recovery;}throw problem('ROLLBACK_FAILED','Publication failed; retained history requires inspection: '+recovery.message,error);}}
  throw error;
 }finally{await lock.release();}
}
function argumentsOf(argv){
 need(Array.isArray(argv),'INVALID_ARGUMENTS','Explicit CLI argument list required');const result={};
 const values=new Set(['phase','source-sha256','signed-feed-report-sha256']);
 for(let index=0;index<argv.length;index++){
  const token=argv[index],name=typeof token==='string'&&token.startsWith('--')?token.slice(2):'';
  need((values.has(name)||name==='authorized-employee-feed-publication')&&!Object.hasOwn(result,name),'INVALID_ARGUMENTS','Unknown or duplicate CLI argument');
  if(name==='authorized-employee-feed-publication'){result[name]=true;continue;}
  need(typeof argv[index+1]==='string'&&!argv[index+1].startsWith('--'),'INVALID_ARGUMENTS','Explicit CLI value required');result[name]=argv[++index];
 }
 need(['check-only','publish'].includes(result.phase)&&SHA.test(result['source-sha256']||'')&&SHA.test(result['signed-feed-report-sha256']||''),'INVALID_ARGUMENTS','Explicit phase and full reviewed source/report SHA256 pins are required');
 need(result.phase==='publish'?result['authorized-employee-feed-publication']===true:!result['authorized-employee-feed-publication'],'PUBLICATION_NOT_AUTHORIZED','Publish requires this invocation authorization flag; check-only cannot publish');return Object.freeze(result);
}
async function verifyCodePins(options){
 need(process.platform==='win32'&&u.samePath(ROOT,EXPECTED),'WRONG_WORKSPACE','The publication CLI only runs in the fixed reviewed Windows workspace');
 for(const [relative,pin]of Object.entries({...CODE_PINS,'audit-tools/publish-162-feed.cjs':options['source-sha256']})){
  const value=await checkedBytes(fs,path.join(ROOT,...relative.split('/')),ROOT);need(value.record.sha256===pin,'SOURCE_CHANGED','Reviewed tool changed: '+relative);
 }
}
function verifyMainEntryPins(options){
 // The CLI verifies all local dependency bytes before importing them. Library
 // tests separately freeze these same inputs through the original Guest gate.
 need(process.platform==='win32'&&ROOT.toLowerCase()===EXPECTED.toLowerCase(),'WRONG_WORKSPACE','Fixed reviewed Windows workspace required');
 for(const [relative,pin]of Object.entries({...CODE_PINS,'audit-tools/publish-162-feed.cjs':options['source-sha256']})){
  const file=path.join(ROOT,...relative.split('/'));
  for(let item=file;;item=path.dirname(item)){const stat=fs0.lstatSync(item);need(!stat.isSymbolicLink()&&(item===file?stat.isFile()&&stat.nlink===1:stat.isDirectory())&&path.resolve(fs0.realpathSync.native(item)).toLowerCase()===path.resolve(item).toLowerCase(),'UNSAFE_PATH','Reviewed source must be a canonical ordinary local file');if(item===path.dirname(item))break;}
  const before=fs0.lstatSync(file,{bigint:true});need(before.size<=2097152n,'SOURCE_CHANGED','Reviewed source is oversized');const fd=fs0.openSync(file,'r');
  try{const start=fs0.fstatSync(fd,{bigint:true}),bytes=fs0.readFileSync(fd),end=fs0.fstatSync(fd,{bigint:true}),after=fs0.lstatSync(file,{bigint:true});for(const key of ['dev','ino','size','mtimeNs','ctimeNs','nlink'])need(before[key]===start[key]&&start[key]===end[key]&&start[key]===after[key],'SOURCE_CHANGED','Reviewed source changed while opening');need(crypto.createHash('sha256').update(bytes).digest('hex')===pin,'SOURCE_CHANGED','Reviewed source digest differs: '+relative);}finally{fs0.closeSync(fd);}
 }
}
async function publicInputs(options){
 await verifyCodePins(options);need(options['signed-feed-report-sha256']===FIXED.report,'REPORT_CHANGED','Only the reviewed original162 signing report is accepted');
 const reportBytes=await checkedBytes(fs,FEED_REPORT,ROOT),manifestBytes=await checkedBytes(fs,MANIFEST,ROOT);
 need(reportBytes.record.sha256===FIXED.report&&manifestBytes.record.sha256===FIXED.manifest,'REPORT_CHANGED','Reviewed public signing report or manifest changed');
 const report=JSON.parse(reportBytes.bytes),manifest=JSON.parse(manifestBytes.bytes);
 need(report.purpose==='root-signed-162-resource-feed'&&report.programVersion===VERSION&&u.samePath(report.directory,FEED)&&report.signed===true&&report.signatureVerified===true&&report.privateKeyIncluded===false&&report.published===false&&report.installed===false&&report.programExecuted===false,'BAD_REPORT','Public signing report has an unexpected identity or state');
 need(manifest.programVersion===VERSION&&manifest.resourcesOnly===true&&manifest.fileCount===1007&&manifest.files?.length===1007&&manifest.files.every(file=>programPath(file.path))&&manifest.asar?.sha256===FIXED.asar,'BAD_MANIFEST','Only the exact1007 reviewed162 resources are admitted');
 const pem=await checkedBytes(fs,path.join(FEED,'publisher-public.pem'),FEED,4096);need(pem.record.sha256===FIXED.publicPem&&!pem.bytes.includes(Buffer.from('PRIVATE KEY')),'BAD_PUBLIC_KEY','Public issuer material changed');
 const key=crypto.createPublicKey(pem.bytes);need(key.asymmetricKeyType==='ed25519'&&u.digest(key.export({type:'spki',format:'der'}))===FIXED.publisher,'BAD_PUBLIC_KEY','Original publisher differs');
 const allowedFiles=manifest.files.map(file=>file.path),policy=u.createTrustedUpdatePolicy({trustedPublicKey:key,allowedFiles,currentVersion:'1.6.1',platform:'win32',arch:'x64'}),selected=await inspectSource({io:fs,source:FEED,policy});
 u.verifySignedCatalog(selected.envelope,u.createTrustedUpdatePolicy({trustedPublicKey:key,allowedFiles,currentVersion:'1.6.2',platform:'win32',arch:'x64'}));
 need(equal(selected.catalog.files,manifest.files)&&selected.rows['catalog.json'].sha256===FIXED.envelope&&u.digest(Buffer.from(selected.envelope.catalog))===FIXED.catalog&&selected.rows['package.zip'].size===FIXED.archiveSize&&selected.rows['package.zip'].sha256===FIXED.archive,'FEED_CHANGED','Reviewed162 feed differs from the original signed package');
 need(report.manifestSha256===FIXED.manifest&&report.asarSha256===FIXED.asar&&report.publisherPublicKeySha256===FIXED.publisher&&report.publicKeyFileSha256===FIXED.publicPem&&report.catalogEnvelopeSha256===FIXED.envelope&&report.catalogSha256===FIXED.catalog&&equal(report.archive,{size:FIXED.archiveSize,sha256:FIXED.archive})&&report.fileCount===1007&&report.sequence===SEQUENCE&&equal(report.sourceVersions,SOURCES)&&report.publishedAt===selected.catalog.publishedAt&&report.expiresAt===selected.catalog.expiresAt,'BAD_REPORT','Signing report and reviewed feed do not agree');
 await verifyCodePins(options);return{key,allowedFiles,rows:selected.rows};
}
async function writeReport(file,value){
 const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n'),opened=await u.openChecked(fs,file,'wx+',{missing:true,root:ROOT});
 try{await u.writeExactly(opened.handle,0,bytes);await opened.handle.sync();await u.assertHandle(fs,opened,{snapshot:false,root:ROOT});}finally{await opened.handle.close();}
 const record=await core.fileHash(fs,file,ROOT);need(record.size===bytes.length&&record.sha256===u.digest(bytes),'REPORT_WRITE_FAILED','Publication report did not verify');return{file,size:record.size,sha256:record.sha256};
}
async function main(){
 const options=argumentsOf(process.argv.slice(2));verifyMainEntryPins(options);loadLibraries();const checked=await publicInputs(options);
 // No reference to PROFILE is inspected or created before this return. This
 // branch only reads the fixed workspace public source and writes no report.
 if(options.phase==='check-only'){console.log(JSON.stringify({phase:'check-only',checkedOnly:true,programVersion:VERSION,sequence:SEQUENCE,sourceSha256:options['source-sha256'],signedFeedReportSha256:FIXED.report,sourceFiles:NAMES.map(name=>({path:name,size:checked.rows[name].size,sha256:checked.rows[name].sha256})),privateKeyRead:false,published:false,productionProfileAccessed:false}));return;}
 need(options['authorized-employee-feed-publication']===true,'PUBLICATION_NOT_AUTHORIZED','Explicit invocation authorization required');
 const reportFile=path.join(ROOT,'reports/release-162-publication-'+crypto.randomUUID()+'.json');await u.assertPath(fs,reportFile,{missing:true,root:ROOT});
 await u.assertPath(fs,PROFILE,{directory:true});const destination=await core.mkdirs(fs,PROFILE,'员工升级');await verifyCodePins(options);
 const result=await publishFeed({sourceDirectory:FEED,destinationDirectory:destination,trustedPublicKey:checked.key,allowedFiles:checked.allowedFiles,currentVersion:'1.6.1',fileSystem:fs,checkpoint:async()=>{
  // Keep the CLI's exact outside source/report pins inside the transaction too;
  // failure here uses the same retained-backup rollback as the tested fault.
  const current=await publicInputs(options);need(equal(current.rows,checked.rows),'FEED_CHANGED','The reviewed original feed changed during publication');
 }});
 const proof={version:1,purpose:'root-published-162-employee-feed',phase:'publish',sourceSha256:options['source-sha256'],signedFeedReportSha256:FIXED.report,...result,directory:destination,files:NAMES.map(name=>({path:name,size:checked.rows[name].size,sha256:checked.rows[name].sha256})),businessRecordApiUsed:false,programInstalled:false,privateKeyRead:false,internetDeployment:false,publicationAuthorizationIsExternal:true};
 try{const output=await writeReport(reportFile,proof);console.log(JSON.stringify({...proof,report:output}));}catch(error){error.publicationResult=proof;throw error;}
}
module.exports={publishFeed,argumentsOf};
if(require.main===module)main().catch(error=>{console.error(JSON.stringify({purpose:'root-published-162-employee-feed',completed:false,code:error.code||'PUBLICATION_FAILED',error:error.message,publicationResult:error.publicationResult||null,publicationOutcome:error.publicationResult?'PAIR_VERIFIED_REPORT_FAILED':'UNCONFIRMED',privateKeyRead:false,businessRecordApiUsed:false,programInstalled:false}));process.exitCode=1;});

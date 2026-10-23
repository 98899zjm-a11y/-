'use strict';
// Source-only delivery. Root alone runs these actual-FS contracts in the old
// no-F Guest. No business/EXE/helper/DB, production path, signing key or cleanup.
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),crypto=require('node:crypto');
const nativeFs=process.versions.electron?require('original-fs'):require('node:fs'),io=nativeFs.promises;
const ROOT=path.resolve(__dirname,'..'),GUEST='C:\\xjy-work\\xjy-web-stage1',SHA=/^[a-f0-9]{64}$/;
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
if(process.platform!=='win32'||ROOT.toLowerCase()!==GUEST.toLowerCase())throw Error('Fixed no-F actual Guest required; Host import refused');
assert(SHA.test(process.env.XJY_PUBLISH162_TEST_SHA256||''),'Root must freeze this test SHA');
assert.equal(hash(nativeFs.readFileSync(__filename)),process.env.XJY_PUBLISH162_TEST_SHA256,'Test source changed');
const PINS=Object.freeze({
 'stage1/guest-candidate-cdp.cjs':'59840b638d8797fb55241616cd0b8e4098075a76834a201b0e93c1a748f1bb32',
 'project/desktop/employee-update-cache.cjs':'5cb70079bf161a002a2701694e4774c2a11bf8d54efc6674ccb5c7b2c6729815',
 'project/desktop/employee-update-installer.cjs':'96ba3df08a0f706e599da7d452374b1f894d401c0a6ff605fc01255d01445bd0',
 'delivery-tools/initial-patch-core.cjs':'0f9de31c8ad8ec7e1b870a92d025909f4606363801a31ee3582b903c5704bbce',
 'tests/employee-update-fixtures.cjs':'c8b7b124ea0523257c564161dcea18698ab8a0a00db9f73ebcb4fea333eab572'
});
for(const [relative,pin] of Object.entries(PINS))assert.equal(hash(nativeFs.readFileSync(path.join(ROOT,relative))),pin,'Original input changed: '+relative);
const actualContext=require('../stage1/guest-candidate-cdp.cjs').actualGuard();
assert.equal(actualContext.productionDrivePresent,false);assert.equal(actualContext.nonLoopbackAddressCount,0);
const u=require('../project/desktop/employee-update-cache.cjs'),core=require('../delivery-tools/initial-patch-core.cjs');
// Only the existing pure ZIP/ASAR encoders are used. Its cleanup-owning fixture()
// is never called; every test directory and failed publication is retained.
const {zip,asar}=require('../tests/employee-update-fixtures.cjs');
const SUBJECT=path.join(ROOT,'audit-tools/publish-162-feed-a3.cjs'),NOW=Date.UTC(2026,9,19,4);
function subject(){
 if(!nativeFs.existsSync(SUBJECT))throw Object.assign(Error('PUBLISH_162_FEATURE_MISSING: actual publisher module/export required'),{code:'PUBLISH_162_FEATURE_MISSING'});
 assert(SHA.test(process.env.XJY_PUBLISH162_SUBJECT_SHA256||''),'Root must freeze actual publisher SHA');
 assert.equal(hash(nativeFs.readFileSync(SUBJECT)),process.env.XJY_PUBLISH162_SUBJECT_SHA256,'Actual publisher changed');
 const api=require(SUBJECT);assert.equal(typeof api.publishFeed,'function','Actual publishFeed export required');return api;
}
async function put(root,name,bytes){await u.assertPath(io,root,{directory:true,root:ROOT});await io.writeFile(path.join(root,name),bytes,{flag:'wx'});}
async function fixture(){
 const parent=await core.mkdirs(io,ROOT,'runtime/publish-162-feed-a3-tests'),root=path.join(parent,'case-'+crypto.randomUUID());
 await io.mkdir(root);await u.assertPath(io,root,{directory:true,root:parent});
 await put(root,'owner.json',Buffer.from(JSON.stringify({purpose:'synthetic-publish162-contract',root,synthetic:true,productionTouched:false})));
 const source=await core.mkdirs(io,root,'source'),destination=await core.mkdirs(io,root,'destination');
 const keys=crypto.generateKeyPairSync('ed25519');
 const entries=[{path:'resources/app.asar',body:asar('1.6.2','synthetic162'),deflate:true},{path:'resources/print-dependencies/test.txt',body:Buffer.from('new synthetic dependency'),deflate:true}];
 const archive=zip(entries),catalog={schemaVersion:1,app:'xjy-jewelry-offline',channel:'stable',version:'1.6.2',sourceVersions:['1.6.1','1.6.2'],platform:'win32',arch:'x64',sequence:9,publishedAt:new Date(NOW-1000).toISOString(),expiresAt:new Date(NOW+86400000).toISOString(),archive:{size:archive.length,sha256:hash(archive)},files:entries.map(e=>({path:e.path,size:e.body.length,sha256:hash(e.body)}))};
 function sign(value=catalog,key=keys.privateKey){const raw=JSON.stringify(value);return Buffer.from(JSON.stringify({catalog:raw,signature:crypto.sign(null,Buffer.from(raw),key).toString('base64')}));}
 const envelope=sign();await put(source,'catalog.json',envelope);await put(source,'package.zip',archive);
 // The real feed also contains a public PEM. Its presence must not be mistaken
 // for an extra resource. No private key is exported or saved anywhere.
 await put(source,'publisher-public.pem',Buffer.from(keys.publicKey.export({type:'spki',format:'pem'})));
 const sentinel=Buffer.from('preserve unrelated synthetic destination file');await put(destination,'keep.txt',sentinel);
 const options={sourceDirectory:source,destinationDirectory:destination,trustedPublicKey:keys.publicKey,allowedFiles:entries.map(e=>e.path),currentVersion:'1.6.1',fileSystem:io,now:()=>NOW};
 return{root,source,destination,keys,entries,archive,catalog,envelope,sign,sentinel,options};
}
async function sourceSnapshot(f){return snapshot(f.source);}
async function snapshot(directory){
 const result=[];
 async function visit(dir,relative=''){
  await u.assertPath(io,dir,{directory:true,root:ROOT});
  for(const name of (await io.readdir(dir)).sort()){
   const file=path.join(dir,name),rel=relative+name,s=await io.lstat(file,{bigint:true});
   if(s.isDirectory()){await u.assertPath(io,file,{directory:true,root:ROOT});result.push({path:rel,kind:'directory'});await visit(file,rel+'/');}
   else{const value=await core.fileHash(io,file,directory);result.push({path:rel,kind:'file',...value,mtimeNs:String(s.mtimeNs),ctimeNs:String(s.ctimeNs)});}
  }
 }
 await visit(directory);return result;
}
async function pair(directory){return{catalog:await io.readFile(path.join(directory,'catalog.json')),archive:await io.readFile(path.join(directory,'package.zip'))};}
async function assertPair(directory,expected){const got=await pair(directory);assert.deepEqual(got.catalog,expected.catalog);assert.deepEqual(got.archive,expected.archive);}
async function oldPair(f){
 const archive=zip([{path:'resources/app.asar',body:asar('1.6.1','old synthetic program'),deflate:true}]);
 const raw=JSON.stringify({...f.catalog,version:'1.6.1',sourceVersions:['1.6.0','1.6.1'],sequence:3,archive:{size:archive.length,sha256:hash(archive)},files:[{path:'resources/app.asar',size:asar('1.6.1','old synthetic program').length,sha256:hash(asar('1.6.1','old synthetic program'))}]});
 const catalog=Buffer.from(JSON.stringify({catalog:raw,signature:crypto.sign(null,Buffer.from(raw),f.keys.privateKey).toString('base64')}));
 await put(f.destination,'catalog.json',catalog);await put(f.destination,'package.zip',archive);return{catalog,archive};
}
async function histories(f){return(await io.readdir(f.destination,{withFileTypes:true})).filter(e=>e.isDirectory()&&/^历史发布-/.test(e.name)).map(e=>path.join(f.destination,e.name)).sort();}
async function oneBackup(f,previous){const dirs=await histories(f);assert.equal(dirs.length,1,'Exactly one retained previous pair required');await assertPair(dirs[0],previous);return dirs[0];}
async function preservedSentinel(f){assert.deepEqual(await io.readFile(path.join(f.destination,'keep.txt')),f.sentinel);}
const conflict=error=>error?.code==='PUBLISH_CONFLICT';

test('P01 standard-library signed two-resource ZIP publishes a first pair without a private key or invented history',async()=>{
 const {publishFeed}=subject(),f=await fixture(),before=await sourceSnapshot(f);
 const result=await publishFeed(f.options);
 assert.equal(result.published,true);assert.equal(result.version,'1.6.2');assert.equal(result.sequence,9);assert.equal(result.previousPublicationBackup,null);
 await assertPair(f.destination,{catalog:f.envelope,archive:f.archive});assert.deepEqual(await histories(f),[]);await preservedSentinel(f);assert.deepEqual(await sourceSnapshot(f),before);
});

test('P02 replacement backs up the complete old pair before package replacement and switches catalog last',async()=>{
 const {publishFeed}=subject(),f=await fixture(),previous=await oldPair(f),before=await sourceSnapshot(f);let packageCheckpoint=0;
 const result=await publishFeed({...f.options,checkpoint:async stage=>{if(stage==='package-replaced'){packageCheckpoint++;await assertPair(f.destination,{catalog:previous.catalog,archive:f.archive});await oneBackup(f,previous);}}});
 assert.equal(packageCheckpoint,1,'Actual package-replaced checkpoint required');assert.equal(result.published,true);
 assert.equal(result.previousPublicationBackup,await oneBackup(f,previous));await assertPair(f.destination,{catalog:f.envelope,archive:f.archive});await preservedSentinel(f);assert.deepEqual(await sourceSnapshot(f),before);
});

test('P03 wrong issuer, expired signed catalog and unsigned envelope are rejected before destination changes',async()=>{
 const {publishFeed}=subject();
 for(const mode of ['wrong-issuer','expired','unsigned']){
  const f=await fixture();await oldPair(f);const before=await snapshot(f.destination);
  const bytes=mode==='wrong-issuer'?f.sign(f.catalog,crypto.generateKeyPairSync('ed25519').privateKey):mode==='expired'?f.sign({...f.catalog,publishedAt:new Date(NOW-20000).toISOString(),expiresAt:new Date(NOW-1000).toISOString()}):Buffer.from(JSON.stringify({catalog:JSON.stringify(f.catalog)}));
  await io.writeFile(path.join(f.source,'catalog.json'),bytes);await assert.rejects(publishFeed(f.options));assert.deepEqual(await snapshot(f.destination),before,mode+' changed destination');
 }
});

test('P04 altered archive and a signed non-program resource are rejected even when a caller includes it in allowedFiles',async()=>{
 const {publishFeed}=subject();
 for(const mode of ['archive-digest','non-program']){
  const f=await fixture();await oldPair(f);const before=await snapshot(f.destination);let options=f.options;
  if(mode==='archive-digest')await io.writeFile(path.join(f.source,'package.zip'),Buffer.concat([f.archive,Buffer.from('changed')]));
  else{
   const bad={path:'data/jewelry.sqlite',body:Buffer.from('synthetic forbidden bytes; not a database')},archive=zip([...f.entries,bad]);
   const catalog={...f.catalog,archive:{size:archive.length,sha256:hash(archive)},files:[...f.catalog.files,{path:bad.path,size:bad.body.length,sha256:hash(bad.body)}]};
   await io.writeFile(path.join(f.source,'package.zip'),archive);await io.writeFile(path.join(f.source,'catalog.json'),f.sign(catalog));options={...options,allowedFiles:[...options.allowedFiles,bad.path]};
  }
  await assert.rejects(publishFeed(options));assert.deepEqual(await snapshot(f.destination),before,mode+' changed destination');
 }
});

test('P05 identical source is idempotent: no pair rewrite, new history, or replacement checkpoint',async()=>{
 const {publishFeed}=subject(),f=await fixture();await oldPair(f);await publishFeed(f.options);const before=await snapshot(f.destination),sourceBefore=await sourceSnapshot(f);let replaced=0;
 const result=await publishFeed({...f.options,checkpoint:async stage=>{if(stage==='package-replaced'||stage==='catalog-replaced')replaced++;}});
 assert.equal(result.published,false);assert.equal(result.alreadyPublished,true);assert.equal(replaced,0);assert.deepEqual(await snapshot(f.destination),before);assert.deepEqual(await sourceSnapshot(f),sourceBefore);
});

test('P06 concurrent actual filesystem publication returns BUSY while the first owner holds its package checkpoint',async()=>{
 const {publishFeed}=subject(),f=await fixture();await oldPair(f);let entered,release;
 // Load a second real module instance: a closure-local busy boolean cannot
 // satisfy cross-instance exclusion. Neither module/function is simulated.
 delete require.cache[require.resolve(SUBJECT)];const otherPublish=subject().publishFeed;assert.notEqual(otherPublish,publishFeed);
 const reached=new Promise(resolve=>{entered=resolve;}),resume=new Promise(resolve=>{release=resolve;});
 const first=publishFeed({...f.options,checkpoint:async stage=>{if(stage==='package-replaced'){entered();await resume;}}});
 try{
  const event=await Promise.race([reached.then(()=>'checkpoint'),first.then(()=>'completed')]);assert.equal(event,'checkpoint','First publisher bypassed the required checkpoint');
  await assert.rejects(otherPublish(f.options),error=>error?.code==='BUSY');
 }finally{release();await first;}
 await assertPair(f.destination,{catalog:f.envelope,archive:f.archive});
});

test('P07 a real checkpoint exception after package rename restores the old pair, retains complete backup, and releases ownership',async()=>{
 const {publishFeed}=subject(),f=await fixture(),previous=await oldPair(f);let calls=0;
 const injected=Object.assign(Error('synthetic failure after real package replacement'),{code:'SYNTHETIC_PUBLICATION_FAILURE'});
 await assert.rejects(publishFeed({...f.options,checkpoint:async stage=>{if(stage==='package-replaced'){calls++;await assertPair(f.destination,{catalog:previous.catalog,archive:f.archive});await oneBackup(f,previous);throw injected;}}}),error=>error===injected||error?.code===injected.code);
 assert.equal(calls,1);await assertPair(f.destination,previous);await oneBackup(f,previous);await preservedSentinel(f);
 // A later real publication must succeed; the failed lock must not be silently
 // reclaimed by the test, and the first backup must still exist afterwards.
 const saved=await histories(f);assert.equal((await publishFeed(f.options)).published,true);for(const dir of saved)await assertPair(dir,previous);
});

test('P08 third-party package or catalog changes are preserved and reported as conflicts, never overwritten by commit or rollback',async()=>{
 const {publishFeed}=subject();
 for(const name of ['package.zip','catalog.json']){
  const f=await fixture(),previous=await oldPair(f),foreign=Buffer.from('unrelated synthetic third-party '+name);let calls=0;
  await assert.rejects(publishFeed({...f.options,checkpoint:async stage=>{if(stage==='package-replaced'){calls++;await io.writeFile(path.join(f.destination,name),foreign);if(name==='package.zip')throw Object.assign(Error('rollback required after foreign package change'),{code:'SYNTHETIC_PUBLICATION_FAILURE'});}}}),conflict);
  assert.equal(calls,1);assert.deepEqual(await io.readFile(path.join(f.destination,name)),foreign);await oneBackup(f,previous);await preservedSentinel(f);
 }
});

test('P09 an incomplete previous publication is refused without deleting or repairing unrelated old files',async()=>{
 const {publishFeed}=subject();
 for(const existing of ['package.zip','catalog.json']){
  const f=await fixture();await put(f.destination,existing,existing==='package.zip'?f.archive:f.envelope);const before=await snapshot(f.destination);
  await assert.rejects(publishFeed(f.options));assert.deepEqual(await snapshot(f.destination),before);
 }
});

test('P10 CLI requires an explicit phase and pins; rejects default, arbitrary path/key/version overrides and unauthorized publish',()=>{
 const api=subject();assert.equal(typeof api.argumentsOf,'function','Actual strict CLI parser export required');
 const pins=['--source-sha256','a'.repeat(64),'--signed-feed-report-sha256','b'.repeat(64)];
 assert.equal(api.argumentsOf(['--phase','check-only',...pins]).phase,'check-only');
 assert.equal(api.argumentsOf(['--phase','publish',...pins,'--authorized-employee-feed-publication']).phase,'publish');
 for(const args of [[],pins,['--phase','publish',...pins],['--phase','check-only'],['--phase','check-only',...pins,'--phase','publish'],['--phase','check-only',...pins,'--sourceDirectory','C:/untrusted'],['--phase','check-only',...pins,'--destination','F:/untrusted'],['--phase','check-only',...pins,'--public-key','C:/untrusted.pem'],['--phase','check-only',...pins,'--version','1.6.3'],['--phase','check-only','--source-sha256','bad','--signed-feed-report-sha256','b'.repeat(64)]])assert.throws(()=>api.argumentsOf(args),'Unsafe/default CLI arguments accepted: '+JSON.stringify(args));
});

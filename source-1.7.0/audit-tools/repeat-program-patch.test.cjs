'use strict';
// Guest-only installer component regression. Never launches the toy EXE,
// imports business/pyc, starts a service or reads any production path.
const fs0=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'..'),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
if(process.platform!=='win32'||ROOT.toLowerCase()!=='c:\\xjy-work\\xjy-web-stage1')throw Error('Repeat patch tests require the fixed actual Guest');
const guardFile=path.join(ROOT,'stage1/guest-candidate-cdp.cjs');
if(sha(fs0.readFileSync(guardFile))!=='59840b638d8797fb55241616cd0b8e4098075a76834a201b0e93c1a748f1bb32')throw Error('Actual Guest guard source changed');
require(guardFile).actualGuard();
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),{createRequire}=require('node:module');
const fs=process.versions.electron?require('original-fs').promises:require('node:fs/promises');
const pins={
 'audit-tools/repeat-v8-core.reference.txt':'a86cfdd7ac7110f0fb428e954adb542e2b84533efc6e0448c686dd5a5e0d372a',
 'project/desktop/employee-update-cache.cjs':'5cb70079bf161a002a2701694e4774c2a11bf8d54efc6674ccb5c7b2c6729815',
 'delivery-tools/initial-patch-backup.cjs':'f2d7262eae5ba3b3048e42753f96e49cd53746940ea22bbe32b0b1f93f3de8e0',
 'project/desktop/initial-upgrade-gate.cjs':'b74a80b83dfaf78f493671bf4bc339f68eeec4f2f89a71410e6cd7d7f78a1980',
 'tests/employee-update-fixtures.cjs':'c8b7b124ea0523257c564161dcea18698ab8a0a00db9f73ebcb4fea333eab572'
};
for(const [relative,expected]of Object.entries(pins))if(sha(fs0.readFileSync(path.join(ROOT,relative)))!==expected)throw Error('Pinned fixture/dependency changed: '+relative);
const originalFile=path.join(ROOT,'delivery-tools/initial-patch-core.cjs'),legacyModule={exports:{}},legacyBytes=fs0.readFileSync(path.join(ROOT,'audit-tools/repeat-v8-core.reference.txt'));
// Exact public source from fixed f1a7ff0, no replacements or copied algorithm.
vm.runInThisContext('(function(exports,require,module,__filename,__dirname){\n'+legacyBytes.toString('utf8')+'\n})',{filename:'repeat-v8-core.reference.txt'})(legacyModule.exports,createRequire(originalFile),legacyModule,originalFile,path.dirname(originalFile));
const legacy=legacyModule.exports,candidate=require('../delivery-tools/initial-patch-core.cjs');
const backup=require('../delivery-tools/initial-patch-backup.cjs'),{readInitialUpgradeGate}=require('../project/desktop/initial-upgrade-gate.cjs');
const {asar,zip}=require('../tests/employee-update-fixtures.cjs');
const PURPOSE='xjy-repeat-program-patch',OSUSER='repeat-owned-os-user',OSNAMESPACE='repeat-fixture\\owned-user',now=Date.UTC(2026,9,16);
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
function legacyAsar(){const pkg=Buffer.from(JSON.stringify({name:'xjy-jewelry-offline',version:'1.5.0',main:'main.cjs'})),tree=Buffer.from(JSON.stringify({files:{'package.json':{size:pkg.length,offset:'0'}}})),head=Buffer.alloc(8+tree.length),first=Buffer.alloc(8);first.writeUInt32LE(4);first.writeUInt32LE(head.length,4);head.writeUInt32LE(head.length-4);head.writeUInt32LE(tree.length,4);tree.copy(head,8);return Buffer.concat([first,head,pkg]);}
function inside(root,file){const r=path.relative(root,file);assert(r&&r!=='..'&&!r.startsWith('..'+path.sep)&&!path.isAbsolute(r),'Owned fixture escaped');return file;}
async function ordinary(file,directory=false){const s=await fs.lstat(file);assert(!s.isSymbolicLink());assert(directory?s.isDirectory():s.isFile()&&s.nlink===1);assert.equal((await fs.realpath(file)).toLowerCase(),path.resolve(file).toLowerCase());return s;}
async function put(file,body){await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,body,{flag:'wx'});}
async function readJson(file){return JSON.parse(await fs.readFile(file,'utf8'));}
function signed(f,field,value){const raw=JSON.stringify(value);return{[field]:raw,signature:crypto.sign(null,Buffer.from(raw),f.keys.privateKey).toString('base64')};}
async function tree(root){const rows=[];async function walk(dir,rel=''){for(const d of(await fs.readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const file=path.join(dir,d.name),r=rel+d.name;if(d.isDirectory()){await ordinary(file,true);await walk(file,r+'/');}else{await ordinary(file);const b=await fs.readFile(file);rows.push({path:r,size:b.length,sha256:sha(b)});}}}await walk(root);return rows;}
async function gate(f){return readInitialUpgradeGate({installDir:f.install,installedRole:f.role,osUserNamespace:OSNAMESPACE});}
function options(f,p,extra={}){return{artifactDir:p.artifact,approvalRoot:p.approvalRoot,approvalFile:p.approvalFile,osUser:OSUSER,osUserNamespace:OSNAMESPACE,now:()=>now,confirmRole:async()=>f.role,processBarrier:f.barrier,currentProcess:{pid:process.pid,creationMarker:'owned-current-test-process'},...(f.role==='host'?{fixedHostRoot:f.host,snapshotDatabases:f.snapshotDatabases,verifyDatabases:f.verifyDatabases}: {employeeProfileDir:f.profile}),...extra};}
function repeat(f,extra={}){return candidate.createInitialPatchInstaller(options(f,f.next,{upgradeMode:'repeat',...extra}));}
async function publication(f,label,target,source,repeatMode=false){
 const artifact=path.join(f.root,label),approvalRoot=path.join(f.root,label+'-external-approval');await fs.mkdir(artifact);await fs.mkdir(approvalRoot);
 // Deliberately dependency-first signed order. Installer must make ASAR-first
 // mutation and ASAR-last rollback independently of catalog ordering.
 const entries=[{path:'resources/print-dependencies/fixture.txt',body:Buffer.from(label+' dependency')},{path:'resources/app.asar',body:asar(target,label+' synthetic app')},...(repeatMode?[{path:'resources/print-dependencies/added.txt',body:Buffer.from('new owned resource')}]:[])];
 for(const row of entries)await put(path.join(artifact,'payload',...row.path.split('/')),row.body);
 const tool=Buffer.from('// inert signed fixture tool\n');await put(path.join(artifact,'delivery-tools/fixed-fixture.cjs'),tool);
 const archive=zip(entries),catalog={schemaVersion:1,app:'xjy-jewelry-offline',channel:'stable',version:target,sourceVersions:[source.version],platform:'win32',arch:'x64',sequence:repeatMode?8:7,publishedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+86400000).toISOString(),archive:{size:archive.length,sha256:sha(archive)},files:entries.map(e=>({path:e.path,size:e.body.length,sha256:sha(e.body)}))};
 const envelope=signed(f,'catalog',catalog),policy={schemaVersion:1,purpose:repeatMode?PURPOSE:legacy.PURPOSE,app:'xjy-jewelry-offline',targetVersion:target,catalogSha256:sha(Buffer.from(envelope.catalog)),publisherPublicKeySha256:f.publicSha,executableName:path.basename(f.exe),engine:f.engine,sourcePrograms:[source],tools:[{path:'delivery-tools/fixed-fixture.cjs',size:tool.length,sha256:sha(tool)}]},policyEnvelope=signed(f,'policy',policy);
 await put(path.join(artifact,'publisher-public.pem'),f.keys.publicKey.export({type:'spki',format:'pem'}));await put(path.join(artifact,'catalog-envelope.json'),JSON.stringify(envelope));await put(path.join(artifact,'source-policy-envelope.json'),JSON.stringify(policyEnvelope));
 const approval={schemaVersion:1,purpose:policy.purpose,approvalId:crypto.randomUUID(),artifactSha256:sha(archive),treeSha256:(await legacy.inspectArtifactTree({artifactDir:artifact})).sha256,publisherPublicKeySha256:f.publicSha,sourcePolicySha256:sha(Buffer.from(policyEnvelope.policy)),verifiedPublisherName:'合成签名发布者，仅Guest组件测试',role:f.role,installationDir:f.install,osUser:OSUSER,engine:f.engine,approvedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+86400000).toISOString()},approvalFile=path.join(approvalRoot,'initial-upgrade-approval.json');await put(approvalFile,JSON.stringify(approval));
 return{artifact,approvalRoot,approvalFile,approval,catalog,envelope,policy,policyEnvelope,entries,publicationId:policy.catalogSha256};
}
async function fixture(t,{host=false,installOld=true,initialTarget='1.6.0'}={}){
 const runtime=path.join(ROOT,'runtime');await ordinary(ROOT,true);if(!fs0.existsSync(runtime))await fs.mkdir(runtime);await ordinary(runtime,true);
 const parent=path.join(runtime,'initial-patch-tests');if(!fs0.existsSync(parent))await fs.mkdir(parent);await ordinary(parent,true);
 const root=inside(parent,path.join(parent,'repeat-'+crypto.randomUUID()));await fs.mkdir(root);await ordinary(root,true);t.diagnostic('Guest owned fixture retained: '+root);
 await put(path.join(root,'repeat-fixture-owner.json'),JSON.stringify({purpose:'guest-repeat-program-patch-test',root,synthetic:true}));
 const install=path.join(root,'program'),profile=path.join(root,'employee-profile');await fs.mkdir(install);await fs.mkdir(profile);await put(path.join(profile,'workspace-connection.json'),'original synthetic employee profile');
 const exe=path.join(install,'鑫金源珠宝报价.exe'),engineBytes=Buffer.from('MZ inert fixture bytes; never execute'),old=legacyAsar();await put(exe,engineBytes);await put(path.join(install,'resources/app.asar'),old);
 const keys=crypto.generateKeyPairSync('ed25519'),f={root,install,profile,exe,role:host?'host':'employee',keys,publicSha:sha(keys.publicKey.export({type:'spki',format:'der'})),engine:{size:engineBytes.length,sha256:sha(engineBytes),electronRunAsNode:true,nodeSqliteBackup:true},handles:[],events:[],hostReads:0};
 t.after(()=>{for(const db of f.handles)db.close();});
 f.barrier={waitClosed:async()=>{f.events.push('waitClosed');},assertClosed:async()=>{f.events.push('assertClosed');return true;},isAssistantAlive:async()=>false,holdSourceDatabases:async input=>{f.hostReads++;assert.equal(input.root,f.host);return{assertHeld:async()=>true,close:async()=>{}};},restart:async input=>{f.events.push({restart:input});return{started:true};}};
 if(host){
  f.host=path.join(root,'synthetic-host');for(const dir of ['工作室数据/images','内帐/erp-attachments','库管/workbooks','程序设置','工作文档','报价图片'])await fs.mkdir(path.join(f.host,dir),{recursive:true});
  await put(path.join(f.host,'程序设置/original-setting.txt'),'synthetic original configuration');await put(path.join(f.host,'内帐/erp-attachments/fixture.bin'),'synthetic attachment');
  const sqlite=require('node:sqlite');f.sqlite=sqlite;f.dbFiles=[];
  for(const [module,relative]of [['sales','工作室数据/jewelry.sqlite'],['ledger','内帐/ledger.db'],['inventory','库管/stockcheck.db']]){const file=inside(f.root,path.join(f.host,relative)),db=new sqlite.DatabaseSync(file,{allowExtension:false});db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; CREATE TABLE repeat_fixture(value TEXT NOT NULL)');db.prepare('INSERT INTO repeat_fixture VALUES(?)').run('original '+module);f.handles.push(db);f.dbFiles.push({module,file});}
  f.snapshotDatabases=backup.createNodeSqliteSnapshotter({sqlite,assertEngineApproved:()=>true});f.verifyDatabases=backup.createNodeSqliteVerifier({sqlite,assertEngineApproved:()=>true});
 }
 f.previous=await publication(f,'previous',initialTarget,{version:'1.5.0',main:'main.cjs',asarSize:old.length,asarSha256:sha(old)});
 if(installOld){
  f.previousResult=await legacy.createInitialPatchInstaller(options(f,f.previous)).install();assert.equal(f.previousResult.installed,true);
  const state=path.join(install,'.xjy-initial-upgrade');f.original={journal:await fs.readFile(path.join(state,'journal.json')),status:await fs.readFile(path.join(state,'recovery-status.json')),key:await fs.readFile(path.join(state,'.journal-key')),activation:await fs.readFile(path.join(install,'xjy-install-activation.json'))};
  const oldJournal=JSON.parse(JSON.parse(f.original.journal).payload);f.previousTransaction=path.join(state,oldJournal.transactionId);f.previousTree=await tree(f.previousTransaction);
  const body=await fs.readFile(path.join(install,'resources/app.asar'));f.next=await publication(f,'patch','1.6.1',{version:initialTarget,main:'release-entry.cjs',asarSize:body.length,asarSha256:sha(body)},true);f.patchState=path.join(install,'.xjy-patches',f.next.publicationId);
 }
 return f;
}
async function assertOldRetained(f){assert.deepEqual(await tree(f.previousTransaction),f.previousTree,'Original completed transaction/backup must be retained');assert.deepEqual(await fs.readFile(path.join(f.install,'.xjy-initial-upgrade/.journal-key')),f.original.key,'Native original gate key must remain unchanged');}
async function assertOriginalRestored(f){assert.deepEqual(await fs.readFile(path.join(f.install,'.xjy-initial-upgrade/journal.json')),f.original.journal);assert.deepEqual(await fs.readFile(path.join(f.install,'.xjy-initial-upgrade/recovery-status.json')),f.original.status);assert.deepEqual(await fs.readFile(path.join(f.install,'xjy-install-activation.json')),f.original.activation);assert.equal((await gate(f)).blocked,false);await assertOldRetained(f);}
async function archivedBytes(f,expected){const rows=await tree(f.patchState),matches=[];for(const row of rows){const bytes=await fs.readFile(path.join(f.patchState,...row.path.split('/')));if(bytes.equals(expected))matches.push(row.path);}assert(matches.length>=1,'Exact original canonical bytes must have a retained archive in this publication');return matches;}
async function liveProgram(f){const out={};for(const row of f.next.entries){const file=path.join(f.install,...row.path.split('/'));try{out[row.path]=sha(await fs.readFile(file));}catch(e){if(e.code!=='ENOENT')throw e;out[row.path]=null;}}return out;}
function filesystemObserver(f,events){return new Proxy(fs,{get(target,key){if(key==='rename')return async(from,to)=>{await target.rename(from,to);const rel=path.relative(f.install,to).split(path.sep).join('/');if(f.next.entries.some(e=>e.path===rel))events.push({kind:'rename',path:rel,hash:sha(await target.readFile(to)),gateBlocked:(await gate(f)).blocked});};if(key==='unlink')return async file=>{await target.unlink(file);const rel=path.relative(f.install,file).split(path.sep).join('/');if(f.next.entries.some(e=>e.path===rel))events.push({kind:'unlink',path:rel,hash:null,gateBlocked:(await gate(f)).blocked});};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});}

test('H00 actual frozen V8 fixture commits and demonstrates why a status-only bridge is insufficient',async t=>{
 const f=await fixture(t);assert.equal((await gate(f)).blocked,false);
 const payload=JSON.stringify({version:1,product:legacy.PRODUCT,installationDir:f.install,role:f.role,targetVersion:'1.6.1',transactionId:crypto.randomUUID(),phase:'prepared',osUserNamespace:OSNAMESPACE});
 await fs.writeFile(path.join(f.install,'.xjy-initial-upgrade/recovery-status.json'),JSON.stringify({payload,mac:crypto.createHmac('sha256',f.original.key).update(payload).digest('hex')}));
 assert.equal((await gate(f)).blocked,true,'The real old gate must recognize the exact bridge schema');
 const r=await legacy.createInitialPatchInstaller(options(f,f.previous)).recover();assert.equal(r.completed,true);assert.equal((await gate(f)).blocked,false,'Unchanged V8 can overwrite a status-only bridge using its completed journal');
 await assertOriginalRestored(f);
});

test('R01 repeat employee patch archives old canonical bytes, rejects old V8 and is idempotent',async t=>{
 const f=await fixture(t),events=[];let prepared=false;
 const r=await repeat(f,{fileSystem:filesystemObserver(f,events),deriveHostLayout:()=>{throw Error('Employee patch must never read a host path');},checkpoint:async(name,j)=>{if(name==='journal-written'&&j.phase==='prepared'){
  prepared=true;assert.equal((await gate(f)).blocked,true);f.barrier.isAssistantAlive=async()=>true;
  try{await assert.rejects(legacy.createInitialPatchInstaller(options(f,f.previous)).recover(),e=>e.code==='BUSY','A live patch must hold the original V8 canonical lock');}finally{f.barrier.isAssistantAlive=async()=>false;}
 }}}).install();
 assert.equal(prepared,true);
 assert.equal(r.installed,true);assert.equal(r.version,'1.6.1');assert.equal(r.role,'employee');assert.equal(f.hostReads,0);assert.equal(events[0]?.path,'resources/app.asar','ASAR must be the first live program replacement');
 for(const row of f.next.entries)assert.equal(sha(await fs.readFile(path.join(f.install,...row.path.split('/')))),sha(row.body));
 assert.equal(sha(await fs.readFile(f.exe)),f.engine.sha256);assert.equal(await fs.readFile(path.join(f.profile,'workspace-connection.json'),'utf8'),'original synthetic employee profile');
 await archivedBytes(f,f.original.journal);await archivedBytes(f,f.original.status);await assertOldRetained(f);
 await assert.rejects(legacy.createInitialPatchInstaller(options(f,f.previous)).recover(),e=>e.code==='BAD_JOURNAL','Strict canonical repeat journal must make real V8 fail closed');
 assert.equal((await gate(f)).blocked,false);assert.equal((await readJson(path.join(f.install,'xjy-install-activation.json'))).programVersion,'1.6.1');
 const before=await tree(f.patchState),again=await repeat(f).install();assert.equal(again.installed,false);assert.equal(again.alreadyInstalled,true);assert.deepEqual(await tree(f.patchState),before,'Repeated click cannot replace archives or create a second transaction');
 assert.deepEqual(f.events.filter(e=>e?.restart).at(-1).restart.args,['--employee-client']);
});

test('R02 crash after prepared bridge but before first file cannot be cleared by real old V8',async t=>{
 const f=await fixture(t),before=await liveProgram(f);let stopped=false;
 await assert.rejects(repeat(f,{checkpoint:async(name,j)=>{if(name==='journal-written'&&j.phase==='prepared'){stopped=true;assert.equal((await gate(f)).blocked,true);throw Object.assign(Error('synthetic loss before first rename'),{code:'SIMULATED_POWER_LOSS'});}}}).install(),e=>e.code==='SIMULATED_POWER_LOSS');
 assert.equal(stopped,true);assert.deepEqual(await liveProgram(f),before);const status=await fs.readFile(path.join(f.install,'.xjy-initial-upgrade/recovery-status.json'));
 await assert.rejects(legacy.createInitialPatchInstaller(options(f,f.previous)).recover(),e=>e.code==='BAD_JOURNAL');assert.deepEqual(await fs.readFile(path.join(f.install,'.xjy-initial-upgrade/recovery-status.json')),status);assert.equal((await gate(f)).blocked,true);
 const r=await repeat(f).recover();assert.equal(r.recovered,true);await assertOriginalRestored(f);
});

test('R03 mutation is ASAR first, rollback is ASAR last and never restores business database contents',async t=>{
 const f=await fixture(t,{host:true}),events=[],before=await liveProgram(f);let replacements=0;
 await assert.rejects(repeat(f,{fileSystem:filesystemObserver(f,events),checkpoint:async name=>{if(name==='file-replaced'&&++replacements===3){f.handles[1].prepare('INSERT INTO repeat_fixture VALUES(?)').run('later synthetic business value');throw Object.assign(Error('synthetic program failure'),{code:'PROGRAM_FAULT'});}}}).install(),e=>e.code==='PROGRAM_FAULT');
 assert.equal(replacements,3);assert.equal(events[0]?.path,'resources/app.asar');assert.equal(events.at(-1)?.path,'resources/app.asar','Deleting newly added resources also precedes restoring the old ASAR');assert(events.every(e=>e.gateBlocked),'Old gate must block during every observed program rename/unlink');
 assert.deepEqual(await liveProgram(f),before);assert.equal(f.handles[1].prepare('SELECT count(*) AS n FROM repeat_fixture WHERE value=?').get('later synthetic business value').n,1);await assertOriginalRestored(f);
});

test('R04 repeat host patch uses real SQLite three-database snapshots before replacing any program file',async t=>{
 const f=await fixture(t,{host:true}),proofs=[];let first=false;
 const r=await repeat(f,{snapshotDatabases:async input=>{const p=await f.snapshotDatabases(input);proofs.push(p);return p;},checkpoint:async name=>{if(name==='file-replaced'&&!first){first=true;assert.equal(proofs.length,1);assert.deepEqual(proofs[0].map(p=>p.module).sort(),['inventory','ledger','sales']);assert(proofs[0].every(p=>p.readOnly===true&&p.walConsistent===true&&p.integrity==='ok'&&p.foreignKeyCount===0));}}}).install();
 assert.equal(r.installed,true);assert.equal(r.role,'host');assert(first);assert(r.dataBackup&&r.programBackup);inside(f.patchState,r.dataBackup.directory);inside(f.patchState,r.programBackup);
 const verified=await backup.verifyInitialBackup({backupDir:r.dataBackup.directory,expectedManifestSha256:r.dataBackup.manifestSha256,verifyDatabases:f.verifyDatabases});assert.equal(verified.databases.length,3);
 for(const [i,module]of ['sales','ledger','inventory'].entries())assert.equal(f.handles[i].prepare('SELECT value FROM repeat_fixture').get().value,'original '+module);
 assert.deepEqual(f.events.filter(e=>e?.restart).at(-1).restart.args,[]);await assertOldRetained(f);
});

test('R05 repeat host snapshot failure and altered publisher/source cannot publish or replace program',async t=>{
 for(const mode of ['snapshot','signature','source','role']){
  const f=await fixture(t,{host:mode==='snapshot'}),before=await liveProgram(f),extra={};
  if(mode==='snapshot')extra.snapshotDatabases=async()=>{throw Object.assign(Error('synthetic snapshot failure'),{code:'BACKUP_FAILED'});};
  if(mode==='signature'){f.next.policyEnvelope.signature='A'.repeat(86)+'==';await fs.writeFile(path.join(f.next.artifact,'source-policy-envelope.json'),JSON.stringify(f.next.policyEnvelope));f.next.approval.treeSha256=(await legacy.inspectArtifactTree({artifactDir:f.next.artifact})).sha256;await fs.writeFile(f.next.approvalFile,JSON.stringify(f.next.approval));}
  if(mode==='source')await fs.appendFile(path.join(f.install,'resources/app.asar'),'unapproved source');
  if(mode==='role')extra.confirmRole=async()=>f.role==='host'?'employee':'host';
  const unchanged=await liveProgram(f),code={snapshot:'BACKUP_FAILED',signature:'BAD_SOURCE_SIGNATURE',source:'SOURCE_PROGRAM_MISMATCH',role:'ROLE_NOT_CONFIRMED'}[mode];
  await assert.rejects(repeat(f,extra).install(),e=>e.code===code);assert.deepEqual(await liveProgram(f),unchanged);assert.equal((await readJson(path.join(f.install,'xjy-install-activation.json'))).programVersion,'1.6.0');await assertOldRetained(f);assert.equal((await gate(f)).blocked,false);
  if(mode!=='source')assert.deepEqual(unchanged,before);
 }
});

test('R06 corrupt repeat rollback backup fails before any restoration and retains a blocking gate',async t=>{
 const f=await fixture(t);await assert.rejects(repeat(f,{checkpoint:async name=>{if(name==='file-replaced')throw Object.assign(Error('synthetic loss'),{code:'SIMULATED_POWER_LOSS'});}}).install(),e=>e.code==='SIMULATED_POWER_LOSS');
 const dirs=(await fs.readdir(f.patchState,{withFileTypes:true})).filter(d=>d.isDirectory()&&uuid.test(d.name));assert.equal(dirs.length,1);
 await fs.appendFile(path.join(f.patchState,dirs[0].name,'program-backup/resources/print-dependencies/fixture.txt'),'corrupt');const before=await liveProgram(f);
 await assert.rejects(repeat(f).recover(),e=>['BAD_BACKUP','ROLLBACK_FAILED'].includes(e.code));assert.deepEqual(await liveProgram(f),before);assert.equal((await gate(f)).blocked,true);await assertOldRetained(f);
});

test('L01 default first-upgrade mode still accepts inspected 1.5 employee to 1.6.1 without Host access',async t=>{
 const f=await fixture(t,{installOld:false,initialTarget:'1.6.1'}),r=await candidate.createInitialPatchInstaller(options(f,f.previous,{deriveHostLayout:()=>{throw Error('Host path forbidden');}})).install();
 assert.equal(r.installed,true);assert.equal(r.version,'1.6.1');assert.equal(r.role,'employee');assert.equal(f.hostReads,0);assert.equal((await gate(f)).blocked,false);assert.equal((await readJson(path.join(f.install,'xjy-install-activation.json'))).programVersion,'1.6.1');assert.equal(sha(await fs.readFile(f.exe)),f.engine.sha256);
});

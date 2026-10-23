'use strict';
// Root-only Guest component contract. No production path, native EXE, product
// startup, private issuer, F drive, new restore API or business-data restore.
// Three inert program resources, RAM issuer and injected process/source lease;
// the reused Host fixture has only tiny fictional SQLite marker tables.
const fs0=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'..'),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
if(process.platform!=='win32'||ROOT.toLowerCase()!=='c:\\xjy-work\\xjy-web-stage1')throw Error('Fixed actual offline Guest required');
const guard=path.join(ROOT,'stage1/guest-candidate-cdp.cjs');
if(sha(fs0.readFileSync(guard))!=='59840b638d8797fb55241616cd0b8e4098075a76834a201b0e93c1a748f1bb32')throw Error('Frozen actual Guest guard changed');
require(guard).actualGuard();
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),{createRequire}=require('node:module');
const fs=require('node:fs/promises');
const SUBJECT=path.join(ROOT,'audit-tools/repeat-program-patch.test.cjs');
const pins={
 'audit-tools/repeat-program-patch.test.cjs':'ba165dffb9e3b7bcc2c52b28ad267fdc43492f6ddf67824901c69a203272fd3f',
 'delivery-tools/initial-patch-core.cjs':'0f9de31c8ad8ec7e1b870a92d025909f4606363801a31ee3582b903c5704bbce',
 'project/desktop/initial-upgrade-gate.cjs':'b74a80b83dfaf78f493671bf4bc339f68eeec4f2f89a71410e6cd7d7f78a1980',
 'project/desktop/employee-update-cache.cjs':'5cb70079bf161a002a2701694e4774c2a11bf8d54efc6674ccb5c7b2c6729815'
};
for(const [name,pin]of Object.entries(pins))assert.equal(sha(fs0.readFileSync(path.join(ROOT,name))),pin,'Original source changed: '+name);
// Reuse the exact original fixture source, without replacements or copied
// installer/authentication algorithms. Suppress only its eight registrations;
// Root runs the original eight regressions separately. Its real guard still runs.
const originalRequire=createRequire(SUBJECT),fixtureModule={exports:{}},source=fs0.readFileSync(SUBJECT,'utf8');let registrations=0;
const originalTestRegistration=()=>{registrations++;};
vm.runInThisContext('(function(require,module,exports,__filename,__dirname){\n'+source+'\nmodule.exports={fixture,publication,repeat,readJson,tree,gate,liveProgram,assertOldRetained,assertOriginalRestored};\n})',{filename:SUBJECT})(name=>name==='node:test'?originalTestRegistration:originalRequire(name),fixtureModule,fixtureModule.exports,SUBJECT,path.dirname(SUBJECT));
assert.equal(registrations,8,'Original fixture test registration contract changed');
const fx=fixtureModule.exports,core=require('../delivery-tools/initial-patch-core.cjs'),u=require('../project/desktop/employee-update-cache.cjs');

test('P01 committed synthetic162 retains enough authentic material for exact161 program restoration and original gate admission',async t=>{
 const f=await fx.fixture(t,{host:true}),asarFile=path.join(f.install,'resources/app.asar'),initialKey=f.original.key;
 // Use the actual repeat core to establish161, so its source canonical journal
 // is authenticated version2, matching the real repeat161 deployment shape.
 assert.equal((await fx.repeat(f).install()).version,'1.6.1');
 const publication161=f.patchState,forensic161=await fx.tree(publication161),initialState=path.join(f.install,'.xjy-initial-upgrade');
 f.original={journal:await fs.readFile(path.join(initialState,'journal.json')),status:await fs.readFile(path.join(initialState,'recovery-status.json')),key:await fs.readFile(path.join(initialState,'.journal-key')),activation:await fs.readFile(path.join(f.install,'xjy-install-activation.json'))};
 assert.deepEqual(f.original.key,initialKey);assert.equal(JSON.parse(JSON.parse(f.original.journal).payload).version,2);
 const sourceAsar=await fs.readFile(asarFile),engineBefore=await fs.readFile(f.exe);
 f.next=await fx.publication(f,'committed162','1.6.2',{version:'1.6.1',main:'release-entry.cjs',asarSize:sourceAsar.length,asarSha256:sha(sourceAsar)},true);
 f.patchState=path.join(f.install,'.xjy-patches',f.next.publicationId);
 const liveBefore=await fx.liveProgram(f);
 assert.equal((await core.packageIdentity(fs,asarFile,f.install)).version,'1.6.1');
 assert.equal((await fx.gate(f)).blocked,false);

 const installed=await fx.repeat(f).install();assert.equal(installed.installed,true);assert.equal(installed.version,'1.6.2');
 const record=await fx.readJson(path.join(f.patchState,'journal.json')),journal=JSON.parse(record.payload);
 assert.equal(journal.phase,'committed');assert.equal(journal.sourceVersion,'1.6.1');assert.equal(journal.targetVersion,'1.6.2');
 // Original core's committed path authenticates canonical ownership AND the
 // legacy archive. No replacement HMAC verifier is implemented in this test.
 assert.equal((await fx.repeat(f).install()).alreadyInstalled,true);
 const completed=await fx.repeat(f).recover();assert.equal(completed.completed,true);
 assert.equal((await core.packageIdentity(fs,asarFile,f.install)).version,'1.6.2','recover on committed must NOT be described as downgrade');
 const archiveRoot=path.join(f.patchState,'legacy-canonical');
 const oldJournal=await u.readSmall(fs,path.join(archiveRoot,'journal.json'),2097152);
 const oldStatus=await u.readSmall(fs,path.join(archiveRoot,'recovery-status.json'),8192);
 assert.deepEqual(oldJournal,f.original.journal);assert.deepEqual(oldStatus,f.original.status);
 const oldActivation=Buffer.from(journal.activation,'base64');assert.deepEqual(oldActivation,f.original.activation);assert.equal(sha(oldActivation),journal.activationSha256);
 await fx.assertOldRetained(f);

 // Check every source backup before the FIRST restore write. All names are
 // exactly the three inert resource paths produced by the original fixture.
 const expectedPaths=['resources/print-dependencies/fixture.txt','resources/print-dependencies/added.txt','resources/app.asar'];
 assert.deepEqual(journal.oldFiles.map(x=>x.path).slice().sort(),expectedPaths.slice().sort());
 const oldBodies=new Map();
 for(const old of journal.oldFiles){
  const live=path.join(f.install,...old.path.split('/')),target=f.next.catalog.files.find(x=>x.path===old.path);
  const current=await core.fileHash(fs,live,f.install);assert.equal(current.sha256,target.sha256);
  if(old.existed){
   const backupFile=path.join(installed.programBackup,...old.path.split('/')),proof=await core.fileHash(fs,backupFile,f.install);
   assert.equal(proof.size,old.size);assert.equal(proof.sha256,old.sha256);assert.equal(old.sha256,liveBefore[old.path]);
   oldBodies.set(old.path,await u.readSmall(fs,backupFile,1048576));
  }else{assert.equal(liveBefore[old.path],null);assert.equal(old.size,0);assert.equal(old.sha256,null);}
 }
 const forensic162=await fx.tree(f.patchState);
 // Marker changes are deliberately later than the install snapshot. Exact
 // PROGRAM restoration must retain current fictional business rows.
 for(const db of f.handles)db.prepare('INSERT INTO repeat_fixture VALUES(?)').run('post162 marker must survive program restoration');
 const businessRows=f.handles.map(db=>db.prepare('SELECT value FROM repeat_fixture ORDER BY rowid').all());

 // Fixture-only replay of the already preserved bytes using the original
 // atomic-write primitive; this is NOT a public/general restore implementation.
 // ASAR last, then original activation, then original canonical status last.
 for(const relative of expectedPaths){
  const live=path.join(f.install,...relative.split('/'));
  if(oldBodies.has(relative))await u.atomicWrite(fs,live,oldBodies.get(relative),f.install);
  else{await u.assertPath(fs,live,{root:f.install});await fs.unlink(live);}
 }
 await u.atomicWrite(fs,path.join(f.install,'xjy-install-activation.json'),oldActivation,f.install);
 await u.atomicWrite(fs,path.join(f.install,'.xjy-initial-upgrade/journal.json'),oldJournal,f.install);
 await u.atomicWrite(fs,path.join(f.install,'.xjy-initial-upgrade/recovery-status.json'),oldStatus,f.install);

 assert.deepEqual(await fx.liveProgram(f),liveBefore);assert.deepEqual(await fs.readFile(f.exe),engineBefore);
 assert.equal((await core.packageIdentity(fs,asarFile,f.install)).version,'1.6.1');
 await fx.assertOriginalRestored(f); // Exact two canonical bytes, activation,
 // original key, old retained transaction AND unchanged original gate.
 assert.deepEqual(f.handles.map(db=>db.prepare('SELECT value FROM repeat_fixture ORDER BY rowid').all()),businessRows);
 assert.deepEqual(await fx.tree(publication161),forensic161,'Original completed repeat161 publication is retained');
 assert.deepEqual(await fx.tree(f.patchState),forensic162,'Committed162 evidence/backups are retained; no fake rolledback status or re-signing');
 await assert.rejects(fx.repeat(f).install(),e=>e.code==='RECOVERY_CONFLICT','Same committed publication must not be silently reused after manual restoration');
 assert.deepEqual(await fx.liveProgram(f),liveBefore);assert.deepEqual(await fx.tree(f.patchState),forensic162);

 // The old gate is still authenticating, not merely trusting a terminal string.
 const statusFile=path.join(f.install,'.xjy-initial-upgrade/recovery-status.json'),bad=JSON.parse(oldStatus);
 bad.mac=(bad.mac[0]==='0'?'1':'0')+bad.mac.slice(1);await u.atomicWrite(fs,statusFile,JSON.stringify(bad),f.install);
 assert.equal((await fx.gate(f)).blocked,true);await u.atomicWrite(fs,statusFile,oldStatus,f.install);await fx.assertOriginalRestored(f);
 t.diagnostic(JSON.stringify({componentOnly:true,programResources:3,source:'1.6.1',sourceCanonicalVersion:2,committedTarget:'1.6.2',restoredProgram:'1.6.1',originalCanonicalAndKeyUnchanged:true,retained161And162Evidence:true,fictionalBusinessRowsPreserved:true,ramIssuer:true,processAndSourceLeaseDI:true,nativeExeExecuted:false,real1007ProgramRestoreVerified:false,realBusinessSchemaCompatibilityVerified:false,restoreCrashSafetyVerified:false}));
});

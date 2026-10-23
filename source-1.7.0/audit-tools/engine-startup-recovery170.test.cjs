'use strict';
// Actual fictional files and signed tree; process launch remains DI. No native
// engine, SQLite, account, real profile, registry or production data execution.
const fs=require('node:fs'),io=fs.promises,path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),vm=require('node:vm'),{createRequire}=require('node:module');
const ROOT=path.resolve(__dirname,'..'),FROZEN='audit-tools/engine-commit-before-start170-a2.test.cjs',SELF='audit-tools/engine-startup-recovery170.test.cjs',hash=b=>crypto.createHash('sha256').update(b).digest('hex');
if(process.platform!=='win32'||os.userInfo().username.toLowerCase()!=='wdagutilityaccount'||ROOT.toLowerCase()!=='c:\\xjy-work\\xjy-web-stage1')throw Error('Actual fixed offline Guest required');
const original=fs.readFileSync(path.join(ROOT,FROZEN));
if(hash(original)!=='e1d9c416dcc91d2385348edec22c566584deafbb7c304082e3688b85a8c3057b')throw Error('Frozen two-assertion fixture changed');
if(hash(fs.readFileSync(path.join(ROOT,SELF)))!==process.env.XJY_ENGINE_RECOVERY_TEST_SHA256)throw Error('Exact new contract pin required');
const text=original.toString('utf8'),at=text.indexOf("test('S01");
if(at<1||hash(Buffer.from(text.slice(0,at)))!=='1410dd64e391f6f3fbaea024b94a66a82f8646a8c42d992274397cfd5a0c31c1')throw Error('Exact original admission/prelude required');
const loaded={exports:{}};
vm.runInThisContext('(function(require,module,exports,__filename,__dirname){\n'+text.slice(0,at)+'\nmodule.exports={revision170,factory,snapshot,readAuthenticatedJournal,signed,api};\n})',{filename:path.join(ROOT,FROZEN)+'[exact-prelude-only]'})(createRequire(path.join(ROOT,FROZEN)),loaded,loaded.exports,path.join(ROOT,FROZEN),path.dirname(path.join(ROOT,FROZEN)));
const {revision170,factory,snapshot,readAuthenticatedJournal,signed,api}=loaded.exports;
const test=require('node:test'),assert=require('node:assert/strict'),gate=require('../project/desktop/engine-startup-gate.cjs'),core=require('../delivery-tools/initial-patch-core.cjs');
const readGate=(f,role=f.role)=>gate.readEngineStartupGate({installDir:f.installationDir,programVersion:'1.7.0',installedRole:role,trustedPublicKey:f.keys.publicKey});
const code=value=>error=>error?.code===value;
const persisted=f=>fs.readFileSync(path.join(f.stateDir,'journal.json'));

test('P01 every target callback sees committed journal and authenticated pre-business receipt for both roles',async()=>{
 for(const role of ['host','employee']){
  const f=await revision170(role),restart=f.options.processBarrier.restart;let seen=0;
  f.options.processBarrier.restart=async input=>{const j=await readAuthenticatedJournal(f),g=readGate(f);assert.equal(j.phase,'committed');assert.equal(j.rollbackForbidden,true);assert.equal(g.blocked,false);assert.equal(g.transactionId,j.transactionId);seen++;return restart(input);};
  const r=await factory(f.options).install();assert.equal(r.committed,true);assert.equal(seen,1);assert.equal(readGate(f).blocked,false);
 }
});
test('P02 missing receipt blocks startup and only authenticated committed recovery reconstructs it',async()=>{
 const f=await revision170('employee');await factory(f.options).install();const journal=persisted(f),key=await io.readFile(path.join(f.stateDir,'journal-key.bin'));
 await io.rename(path.join(f.stateDir,gate.STATUS),path.join(f.root,'retained-original-startup-status.json'));
 assert.equal(readGate(f).blocked,true);assert.equal(f.restarts.length,1);
 const r=await factory(f.options).recover();assert.equal(r.completed,true);assert.equal(r.restarted,false);assert.equal(readGate(f).blocked,false);assert.deepEqual(persisted(f),journal);assert.deepEqual(await io.readFile(path.join(f.stateDir,'journal-key.bin')),key);assert.equal(f.restarts.length,1);
});
test('P03 missing key or journal refuses re-entry without regenerating evidence or changing program',async()=>{
 for(const name of ['journal-key.bin','journal.json']){
  const f=await revision170('host');await factory(f.options).install();await io.rename(path.join(f.stateDir,name),path.join(f.root,'retained-'+name));
  const before=await snapshot(f.stateDir),program=await snapshot(f.installationDir);assert.equal(readGate(f).blocked,true);
  await assert.rejects(factory(f.options).recover(),code('BAD_JOURNAL'));assert.deepEqual(await snapshot(f.stateDir),before);assert.deepEqual(await snapshot(f.installationDir),program);assert.equal(f.restarts.length,1);
 }
});
test('P04 tampered receipt is not overwritten and role mismatch is refused after a valid commit',async()=>{
 const f=await revision170('employee');await factory(f.options).install();assert.equal(readGate(f,'host').blocked,true);
 const file=path.join(f.stateDir,gate.STATUS),r=JSON.parse(await io.readFile(file,'utf8'));r.payload=r.payload.replace('"role":"employee"','"role":"host"');await io.writeFile(file,JSON.stringify(r));const bad=await io.readFile(file),program=await snapshot(f.installationDir);
 assert.equal(readGate(f).blocked,true);await assert.rejects(factory(f.options).recover(),code('BAD_STARTUP_RECEIPT'));assert.deepEqual(await io.readFile(file),bad);assert.deepEqual(await snapshot(f.installationDir),program);assert.equal(f.restarts.length,1);
});
test('P05 repeated committed recovery retains legitimate170 data/profile writes and does not launch twice',async()=>{
 const f=await revision170('host');await factory(f.options).install();await io.writeFile(path.join(f.dataDir,'fictional-business.sqlite'),'SYNTHETIC POST170 WRITE');await io.writeFile(path.join(f.profileDir,'post170.json'),'SYNTHETIC PROFILE WRITE');
 const data=await snapshot(f.dataDir),profile=await snapshot(f.profileDir),program=await snapshot(f.installationDir),journal=persisted(f);
 for(let i=0;i<2;i++){const r=await factory(f.options).recover();assert.equal(r.completed,true);assert.equal(r.restarted,false);assert.equal(readGate(f).blocked,false);}
 assert.deepEqual(await snapshot(f.dataDir),data);assert.deepEqual(await snapshot(f.profileDir),profile);assert.deepEqual(await snapshot(f.installationDir),program);assert.deepEqual(persisted(f),journal);assert.equal(f.restarts.length,1);
});
test('P06 power loss after publish blocks170; power loss after commit permits only170 authenticated re-entry',async()=>{
 for(const phase of ['new-tree-published','commit-readback']){
  const f=await revision170('employee');f.checkpoint=async name=>{if(name===phase)throw Object.assign(Error('synthetic power loss'),{code:'SIMULATED_POWER_LOSS'});};
  await assert.rejects(factory(f.options).install(),code('SIMULATED_POWER_LOSS'));assert.equal(f.restarts.length,0);
  if(phase==='new-tree-published'){
   assert.equal(readGate(f).blocked,true);const r=await factory(f.options).recover();assert.equal(r.rolledBack,true);assert.deepEqual(await snapshot(f.installationDir),f.source);assert.deepEqual(f.restarts.map(x=>x.engine),['44.7.0']);
  }else{
   assert.equal((await readAuthenticatedJournal(f)).phase,'committed');assert.equal(readGate(f).blocked,false);const r=await factory(f.options).recover({restartTarget:true});assert.equal(r.completed,true);assert.equal(r.restarted,true);assert.deepEqual(f.restarts.map(x=>x.engine),['44.9.0']);assert.equal(readGate(f).blocked,false);
  }
 }
});
test('P07 failed commit or receipt persistence starts no target and recovery follows authenticated disk phase',async()=>{
 for(const target of ['journal.json',gate.STATUS]){
  const f=await revision170('host'),rename=f.options.fileSystem.rename;let injected=false;
  f.options.fileSystem.rename=async(from,to)=>{if(!injected&&path.basename(to)===target){const raw=JSON.parse(await io.readFile(from,'utf8'));if(JSON.parse(raw.payload).phase==='committed'){injected=true;throw Object.assign(Error('synthetic commit/receipt disk full'),{code:'ENOSPC'});}}return rename(from,to);};
  await assert.rejects(factory(f.options).install(),code('ENOSPC'));assert.equal(injected,true);assert.equal(f.restarts.length,0);assert.equal(readGate(f).blocked,true);
  const phase=(await readAuthenticatedJournal(f)).phase,r=await factory(f.options).recover();
  if(target==='journal.json'){assert.equal(phase,'new-published');assert.equal(r.rolledBack,true);assert.deepEqual(f.restarts.map(x=>x.engine),['44.7.0']);}
  else{assert.equal(phase,'committed');assert.equal(r.completed,true);assert.equal(f.restarts.length,0);assert.equal(readGate(f).blocked,false);}
 }
});
test('P08 legacy missing activation requires exact explicit scope and keeps absence on precommit rollback',async()=>{
 const bad=await revision170('employee');await io.rename(path.join(bad.installationDir,'xjy-install-activation.json'),path.join(bad.root,'retained-old-activation.json'));bad.source=await snapshot(bad.installationDir);
 await assert.rejects(factory(bad.options).install(),code('LEGACY_ROLE_CONFIRMATION_REQUIRED'));assert.equal(bad.restarts.length,0);assert.deepEqual(await snapshot(bad.installationDir),bad.source);
 const good=await revision170('employee');await io.rename(path.join(good.installationDir,'xjy-install-activation.json'),path.join(good.root,'retained-old-activation.json'));good.source=await snapshot(good.installationDir);
 const stat=await io.lstat(good.installationDir,{bigint:true});good.options.legacyRoleConfirmation={confirmed:true,source:'explicit',role:'employee',installationDir:good.installationDir,installationIdentity:gate.identity(stat),sourceVersion:'1.6.2',osUserNamespace:gate.namespace()};
 good.checkpoint=async name=>{if(name==='new-tree-published')throw Object.assign(Error('synthetic power loss'),{code:'SIMULATED_POWER_LOSS'});};
 await assert.rejects(factory(good.options).install(),code('SIMULATED_POWER_LOSS'));const r=await factory(good.options).recover();assert.equal(r.rolledBack,true);assert.deepEqual(await snapshot(good.installationDir),good.source);assert.equal(fs.existsSync(path.join(good.installationDir,'xjy-install-activation.json')),false);
});
async function freshFixture(role){
 const f=await revision170(role);await io.rename(f.installationDir,path.join(f.root,'retained-original-source'));await io.mkdir(f.installationDir);
 for(const spec of f.targetCatalog.files){await core.mkdirs(io,f.installationDir,path.posix.dirname(spec.path)==='.'?'':path.posix.dirname(spec.path));await core.copy(io,path.join(f.artifactDir,...spec.path.split('/')),path.join(f.installationDir,...spec.path.split('/')),spec,f.artifactDir,f.installationDir);}
 await io.writeFile(path.join(f.installationDir,'xjy-install-activation.json'),JSON.stringify({...f.activation,programVersion:'1.7.0'}),{flag:'wx'});
 const catalog={...f.targetCatalog,sourceVersions:['1.7.0']},trust={schemaVersion:1,purpose:'xjy-engine-fresh170',publisherPublicKey:f.keys.publicKey,publisherPublicKeySha256:f.trust.publisherPublicKeySha256,executableName:f.trust.executableName,target:f.trust.target};trust.target={...trust.target,catalogSha256:hash(Buffer.from(JSON.stringify(catalog)))};
 return{f,options:{installationDir:f.installationDir,stateDir:f.stateDir,role,envelope:signed(catalog,f.keys.privateKey),trust,now:f.options.now}};
}
test('P09 fresh170 uses the same authenticated receipt before launch, idempotently for explicit host/employee roles',async()=>{
 assert.equal(typeof api.initializeFreshEngineReceipt170,'function','FRESH_RECEIPT_REQUIRED: missing trusted initialization');
 for(const role of ['host','employee']){const {f,options}=await freshFixture(role),before=await snapshot(f.installationDir);assert.equal(readGate(f).blocked,true);const r=await api.initializeFreshEngineReceipt170(options);assert.equal(r.committed,true);assert.equal(readGate(f).blocked,false);assert.equal(readGate(f).mode,'fresh');const state=await snapshot(f.stateDir);assert.equal((await api.initializeFreshEngineReceipt170(options)).transactionId,r.transactionId);assert.deepEqual(await snapshot(f.stateDir),state);assert.deepEqual(await snapshot(f.installationDir),before);assert.equal(f.restarts.length,0);}
});
test('P10 fresh signature or missing activation stops before writing receipt/key and never creates a role',async()=>{
 assert.equal(typeof api.initializeFreshEngineReceipt170,'function','FRESH_RECEIPT_REQUIRED: missing trusted initialization');
 for(const mode of ['signature','activation']){const {f,options}=await freshFixture('employee');if(mode==='signature')options.envelope={...options.envelope,signature:Buffer.alloc(64).toString('base64')};else await io.rename(path.join(f.installationDir,'xjy-install-activation.json'),path.join(f.root,'retained-fresh-activation.json'));const before=await snapshot(f.installationDir);await assert.rejects(api.initializeFreshEngineReceipt170(options),code(mode==='signature'?'BAD_SIGNATURE':'BAD_ACTIVATION'));assert.deepEqual(await snapshot(f.installationDir),before);assert.deepEqual(await io.readdir(f.stateDir),[]);assert.equal(readGate(f).blocked,true);assert.equal(f.restarts.length,0);}
});

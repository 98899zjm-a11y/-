'use strict';
// Real fictional files, original signed full-tree algorithms and DI process
// boundary. No EXE/business/SQLite, Host execution or production data access.
const fs=require('node:fs'),io=fs.promises,path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),vm=require('node:vm'),{createRequire}=require('node:module');
const ROOT=path.resolve(__dirname,'..'),SELF='audit-tools/engine-commit-before-start170-a2.test.cjs',sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
if(process.platform!=='win32'||os.userInfo().username.toLowerCase()!=='wdagutilityaccount'||ROOT.toLowerCase()!=='c:\\xjy-work\\xjy-web-stage1')throw Error('Actual fixed offline Guest required; no Host test/import');
const EXPECTED_NAMESPACE='36fcbe9c-ece1-4be3-af35-309a2ee19e05',guard=require('../stage1/isolation.cjs').createIsolationGuard(ROOT);
const BASE_PINS={
 'stage1/isolation.cjs':'dd1eea05233607ca20bf19d931e4a5bd10dccd2cbe80ef4697685b6a4fdf759a',
 'stage1/sandbox-context.py':'09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249',
 'stage1/validate-sandbox-context.py':'867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207',
 'project/desktop/employee-update-cache.cjs':'5cb70079bf161a002a2701694e4774c2a11bf8d54efc6674ccb5c7b2c6729815',
 'project/desktop/employee-update-installer.cjs':'96ba3df08a0f706e599da7d452374b1f894d401c0a6ff605fc01255d01445bd0',
 'delivery-tools/initial-patch-core.cjs':'0f9de31c8ad8ec7e1b870a92d025909f4606363801a31ee3582b903c5704bbce',
 'delivery-tools/engine-tree-candidate.cjs':'19db998cd63b7d5ce8eb1acd360d320ea123882f22a3ab0badfa6a56406edbb5',
 'tests/employee-update-fixtures.cjs':'c8b7b124ea0523257c564161dcea18698ab8a0a00db9f73ebcb4fea333eab572',
 'audit-tools/engine-tree-candidate.test.cjs':'f8f3654ae3f83c6b420b01b7a57a64c9f3cca2dab282053e84612c313e0506c8',
};
const test=require('node:test'),assert=require('node:assert/strict');
const read=name=>fs.readFileSync(guard.assertPath(path.join(ROOT,...name.split('/'))));
const pins=JSON.parse(process.env.XJY_ENGINE_COMMIT_SOURCE_PINS||'null'),subjectName=process.env.XJY_ENGINE_COMMIT_SUBJECT;
assert(['delivery-tools/engine-tree-candidate.cjs','delivery-tools/engine-tree-runtime170.cjs'].includes(subjectName),'Only the reviewed original or independent170 engine source may be selected');
const expectedKeys=[...Object.keys(BASE_PINS),SELF,...(subjectName.endsWith('/engine-tree-runtime170.cjs')?['delivery-tools/engine-tree-runtime170.cjs','project/desktop/engine-startup-gate.cjs']:[])];
assert.deepEqual(Object.keys(pins||{}).sort(),expectedKeys.sort());
for(const[name,expected]of Object.entries(BASE_PINS))assert.equal(pins[name],expected,'Frozen original dependency changed');
for(const[name,pin]of Object.entries(pins)){assert.match(pin,/^[a-f0-9]{64}$/);assert.equal(sha(read(name)),pin,name);}
assert.equal(pins[SELF],process.env.XJY_ENGINE_COMMIT_TEST_SHA256);
assert.equal(JSON.parse(read('isolation-identity.json').toString('utf8').replace(/^\uFEFF/,'')).namespace,EXPECTED_NAMESPACE);

// Exact old prelude performs original actual Python/WMI/network/user admission
// before fixture creation. Only its factory is evaluated; six tests stay frozen.
const FROZEN='audit-tools/engine-tree-candidate.test.cjs',text=read(FROZEN).toString('utf8'),marker="test('E01 complete signed engine/resources tree switches by directory rename and restarts the unchanged host or employee role', async () => {",at=text.indexOf(marker);
assert(at>0);assert.equal(sha(Buffer.from(text.slice(0,at))),'a7bddec556f83dc78b2099743ef11abd543c8dca79070f5becda38b17ad7c000');
const loaded={exports:{}};
vm.runInThisContext('(function(require,module,exports,__filename,__dirname){\n'+text.slice(0,at)+'\nmodule.exports={fixture,snapshot,journal,signed,asar};\n})',{filename:path.join(ROOT,FROZEN)+'[exact-factory-only]'})(createRequire(path.join(ROOT,FROZEN)),loaded,loaded.exports,path.join(ROOT,FROZEN),path.dirname(path.join(ROOT,FROZEN)));
const {fixture,snapshot,signed,asar}=loaded.exports;
const plain=value=>JSON.parse(JSON.stringify(value)),SOURCE='1.6.2',TARGET='1.7.0',OLD_ENGINE='44.7.0',NEW_ENGINE='44.9.0';
const api=require(path.join(ROOT,subjectName)),factory=api[subjectName.endsWith('/engine-tree-runtime170.cjs')?'createEngineTreeRuntime170':'createEngineTreeCandidate'];
assert.equal(typeof factory,'function','Actual full-tree transaction factory required');
async function revision170(role){
 const f=await fixture(role);
 for(const [dir,version,catalog,which]of [[f.installationDir,SOURCE,f.sourceCatalog,'source'],[f.artifactDir,TARGET,f.targetCatalog,'target']]){
  const bytes=asar(version,'fictional '+version+' release-entry; no executable business');await io.writeFile(path.join(dir,'resources/app.asar'),bytes);
  const row=catalog.files.find(x=>x.path==='resources/app.asar');row.size=bytes.length;row.sha256=sha(bytes);
  catalog.version=version;catalog.sourceVersions=[SOURCE];f.trust[which].programVersion=version;
  f.trust[which].catalogSha256=sha(Buffer.from(JSON.stringify(catalog)));f.options[which+'Envelope']=signed(catalog,f.keys.privateKey);
 }
 f.activation.programVersion=SOURCE;await io.writeFile(path.join(f.installationDir,'xjy-install-activation.json'),JSON.stringify(f.activation));
 const targetMarker=Buffer.from(JSON.stringify({...f.activation,programVersion:TARGET}));
 f.target=[...f.targetCatalog.files,{path:'xjy-install-activation.json',size:targetMarker.length,sha256:sha(targetMarker)}];
 f.source=await snapshot(f.installationDir);f.artifact=await snapshot(f.artifactDir);
 return f;
}
async function readAuthenticatedJournal(f){
 const envelope=JSON.parse(await io.readFile(path.join(f.stateDir,'journal.json'),'utf8')),key=await io.readFile(path.join(f.stateDir,'journal-key.bin'));
 assert.equal(typeof envelope.payload,'string');assert.match(envelope.mac,/^[a-f0-9]{64}$/);assert.equal(key.length,32);
 assert.equal(crypto.createHmac('sha256',key).update(envelope.payload).digest('hex'),envelope.mac,'Observe only an authenticated persisted journal');
 return JSON.parse(envelope.payload);
}
async function evidence(f,name,value){await io.writeFile(path.join(f.root,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});}

test('S01 actual162→170 full-tree callback observes durable authenticated commit before any target start',async()=>{
 for(const role of ['host','employee']){
  const f=await revision170(role),observed=[],oldRestart=f.options.processBarrier.restart;
  f.options.processBarrier.restart=async input=>{
   const journal=await readAuthenticatedJournal(f),version=(await io.readFile(path.join(f.installationDir,'version'),'utf8')).trim();
   observed.push({engineVersion:version,phase:journal.phase,transactionId:journal.transactionId,sourceVersion:journal.sourceVersion,targetVersion:journal.targetVersion,role:input.role});
   return oldRestart(input);
  };
  const result=await factory(f.options).install(),finalJournal=await readAuthenticatedJournal(f);
  await evidence(f,'commit-before-start-observations.json',{observed,finalPhase:finalJournal.phase,result});
  assert.equal(result.installed,true);assert.equal(result.version,TARGET);assert.equal(result.engineVersion,NEW_ENGINE);
  assert.equal(observed.filter(x=>x.engineVersion===NEW_ENGINE).length,1,'Positive control: target callback actually ran');
  assert.equal(finalJournal.phase,'committed','Positive control: transaction eventually committed');
  assert.equal(observed[0].phase,'committed','COMMIT_BEFORE_START_REQUIRED: target callback read a noncommitted authenticated journal');
  assert.equal(observed[0].targetVersion,TARGET);assert.equal(observed[0].sourceVersion,SOURCE);assert.equal(observed[0].role,role);
 }
});

test('S02 unknown target-start result after a170 write preserves committed170 and never restarts or restores162',async()=>{
 const f=await revision170('host'),oldRestart=f.options.processBarrier.restart,callbacks=[],migration='SYNTHETIC SCHEMA170 WRITE; NEVER OPENED BY SQLITE';
 f.options.processBarrier.restart=async input=>{
  const journal=await readAuthenticatedJournal(f),engine=(await io.readFile(path.join(f.installationDir,'version'),'utf8')).trim();callbacks.push({engine,phase:journal.phase});
  const started=await oldRestart(input);
  if(engine===NEW_ENGINE){await io.writeFile(path.join(f.dataDir,'fictional-business.sqlite'),migration);throw Object.assign(Error('synthetic target may have started; result channel lost'),{code:'SIMULATED_START_RESULT_UNKNOWN'});}
  return started;
 };
 let result=null,error=null;try{result=await factory(f.options).install();}catch(value){error={name:value.name,code:value.code||null,message:value.message};}
 const finalJournal=await readAuthenticatedJournal(f),engine=(await io.readFile(path.join(f.installationDir,'version'),'utf8')).trim(),data=await io.readFile(path.join(f.dataDir,'fictional-business.sqlite'),'utf8');
 await evidence(f,'unknown-start-observations.json',{callbacks,finalPhase:finalJournal.phase,finalEngine:engine,simulated170WriteRetained:data===migration,result,error,renames:f.renames});
 assert.equal(callbacks.filter(x=>x.engine===NEW_ENGINE).length,1,'Positive control: target launch boundary was reached');
 assert.equal(data,migration,'The simulated170 write must be retained');
 assert.equal(callbacks.filter(x=>x.engine===OLD_ENGINE).length,0,'OLD_CODE_AFTER_POSSIBLE170_START: source162 was restarted after a170 write');
 assert.equal(engine,NEW_ENGINE,'Possible target start permanently forbids automatic engine downgrade');
 assert.equal(finalJournal.phase,'committed','Committed target must remain the recovery authority after an unknown launch result');
 assert.equal((await readAuthenticatedJournal(f)).targetVersion,TARGET);
});

'use strict';
// Real fictional signed full trees and persistent startup records; launch is
// DI. This file never launches an EXE or opens SQLite/business/native services.
const fs=require('node:fs'),io=fs.promises,path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),vm=require('node:vm'),{createRequire}=require('node:module');
const ROOT=path.resolve(__dirname,'..'),FROZEN='audit-tools/engine-commit-before-start170-a2.test.cjs',SELF='audit-tools/engine-deferred-start170.test.cjs',hash=b=>crypto.createHash('sha256').update(b).digest('hex');
if(process.platform!=='win32'||os.userInfo().username.toLowerCase()!=='wdagutilityaccount'||ROOT.toLowerCase()!=='c:\\xjy-work\\xjy-web-stage1')throw Error('Actual fixed offline Guest required');
const raw=fs.readFileSync(path.join(ROOT,FROZEN));if(hash(raw)!=='e1d9c416dcc91d2385348edec22c566584deafbb7c304082e3688b85a8c3057b')throw Error('Frozen original2 changed');
if(hash(fs.readFileSync(path.join(ROOT,SELF)))!==process.env.XJY_ENGINE_DEFERRED_TEST_SHA256)throw Error('Exact deferred contract pin required');
const text=raw.toString('utf8'),at=text.indexOf("test('S01");if(at<1||hash(Buffer.from(text.slice(0,at)))!=='1410dd64e391f6f3fbaea024b94a66a82f8646a8c42d992274397cfd5a0c31c1')throw Error('Exact original admission/prelude required');
const loaded={exports:{}};
vm.runInThisContext('(function(require,module,exports,__filename,__dirname){\n'+text.slice(0,at)+'\nmodule.exports={revision170,snapshot,readAuthenticatedJournal,api};\n})',{filename:path.join(ROOT,FROZEN)+'[exact-prelude-only]'})(createRequire(path.join(ROOT,FROZEN)),loaded,loaded.exports,path.join(ROOT,FROZEN),path.dirname(path.join(ROOT,FROZEN)));
const {revision170,snapshot,readAuthenticatedJournal,api}=loaded.exports;
const test=require('node:test'),assert=require('node:assert/strict'),gate=require('../project/desktop/engine-startup-gate.cjs');
const code=value=>error=>error?.code===value;
function transaction(f){assert.equal(typeof api.createDeferredEngineTreeRuntime170ForGuest,'function','DEFERRED_ENGINE_TRANSACTION_REQUIRED: actual persistent deferred transaction absent');return api.createDeferredEngineTreeRuntime170ForGuest(f.options);}
const decision=f=>gate.readEngineStartupGate({installDir:f.installationDir,programVersion:'1.7.0',installedRole:f.role,trustedPublicKey:f.keys.publicKey});
async function receipt(f){return gate.decode(await io.readFile(path.join(f.stateDir,gate.STATUS)),await io.readFile(path.join(f.stateDir,'journal-key.bin')));}

test('D01 deferred install commits complete170 but persists business hold and starts no target for both roles',async()=>{
 for(const role of ['host','employee']){const f=await revision170(role),tx=transaction(f),r=await tx.install(),j=await readAuthenticatedJournal(f),s=await receipt(f);assert.equal(r.installed,true);assert.equal(r.restarted,false);assert.equal(j.phase,'committed');assert.equal(j.rollbackForbidden,true);assert.equal(s.version,2);assert.equal(s.phase,'committed');assert.equal(s.businessReleased,false);assert.equal(decision(f).blocked,true);assert.equal(decision(f).code,'ENGINE_STARTUP_HELD');assert.equal(f.restarts.length,0);const held=await tx.assertStartupHeld();assert.equal(held.held,true);assert.equal(held.transactionId,j.transactionId);assert.deepEqual(await snapshot(f.installationDir),f.targetRows());assert.throws(()=>api.createEngineTreeRuntime170({...f.options,deferStart:true}),code('BAD_OPTIONS'));}
});
test('D02 startCommitted persists release before target callback and never repeats a completed release',async()=>{
 const f=await revision170('host'),tx=transaction(f),restart=f.options.processBarrier.restart;let observations=0;
 f.options.processBarrier.restart=async input=>{const j=await readAuthenticatedJournal(f),s=await receipt(f);assert.equal(j.phase,'committed');assert.equal(j.rollbackForbidden,true);assert.equal(s.businessReleased,true);assert.equal(decision(f).blocked,false);observations++;return restart(input);};
 await tx.install();assert.equal(observations,0);const r=await tx.startCommitted();assert.equal(r.started,true);assert.equal(observations,1);assert.deepEqual(f.restarts.map(x=>x.engine),['44.9.0']);await assert.rejects(tx.assertStartupHeld(),code('STARTUP_ALREADY_RELEASED'));const again=await tx.startCommitted();assert.equal(again.alreadyReleased,true);assert.equal(again.started,false);assert.equal(observations,1);assert.equal((await readAuthenticatedJournal(f)).phase,'committed');
});
test('D03 a live process prevents held proof and committed release without changing the held receipt',async()=>{
 const f=await revision170('employee'),tx=transaction(f);await tx.install();const status=await io.readFile(path.join(f.stateDir,gate.STATUS)),journal=await io.readFile(path.join(f.stateDir,'journal.json'));f.closedError=Object.assign(Error('synthetic live process returned by actual-boundary port'),{code:'PROGRAM_IN_USE'});
 await assert.rejects(tx.assertStartupHeld(),code('PROGRAM_IN_USE'));await assert.rejects(tx.startCommitted(),code('PROGRAM_IN_USE'));assert.deepEqual(await io.readFile(path.join(f.stateDir,gate.STATUS)),status);assert.deepEqual(await io.readFile(path.join(f.stateDir,'journal.json')),journal);assert.equal((await receipt(f)).businessReleased,false);assert.equal(decision(f).blocked,true);assert.equal(f.restarts.length,0);
});
test('D04 release refuses missing or corrupted receipt without reconstruction, spawn or old-code fallback',async()=>{
 for(const mode of ['missing','tamper']){const f=await revision170('host'),tx=transaction(f);await tx.install();const file=path.join(f.stateDir,gate.STATUS);let bad;
  if(mode==='missing')await io.rename(file,path.join(f.root,'retained-held-receipt.json'));else{const r=JSON.parse(await io.readFile(file,'utf8'));r.payload=r.payload.replace('"businessReleased":false','"businessReleased":true');await io.writeFile(file,JSON.stringify(r));bad=await io.readFile(file);}
  const journal=await io.readFile(path.join(f.stateDir,'journal.json')),program=await snapshot(f.installationDir);assert.equal(decision(f).blocked,true);await assert.rejects(tx.startCommitted(),code(mode==='missing'?'STARTUP_RECEIPT_REQUIRED':'BAD_STARTUP_RECEIPT'));assert.deepEqual(await io.readFile(path.join(f.stateDir,'journal.json')),journal);assert.deepEqual(await snapshot(f.installationDir),program);assert.equal(f.restarts.length,0);if(mode==='missing')assert.equal(fs.existsSync(file),false);else assert.deepEqual(await io.readFile(file),bad);assert.equal((await readAuthenticatedJournal(f)).rollbackForbidden,true);
 }
});

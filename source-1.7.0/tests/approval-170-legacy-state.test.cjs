'use strict';
// Actual Guest only. Synthetic role/HMAC records and ordinary temporary files;
// no registry, production paths, issuer key, business process or SQLite.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'..');
if(process.platform!=='win32'||os.userInfo().username.toLowerCase()!=='wdagutilityaccount'||ROOT.toLowerCase()!=='c:\\xjy-work\\xjy-web-stage1')throw Error('Actual fixed offline Guest required');
const guardFile=path.join(ROOT,'stage1/guest-candidate-cdp.cjs');
if(crypto.createHash('sha256').update(fs.readFileSync(guardFile)).digest('hex')!=='59840b638d8797fb55241616cd0b8e4098075a76834a201b0e93c1a748f1bb32')throw Error('Original Guest guard changed');
require(guardFile).actualGuard();
const guard=require('../stage1/isolation.cjs').createIsolationGuard(ROOT);
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),{createRequire}=require('node:module');
const io=require('../delivery-approval/approval-io-170.cjs'),core=require('../delivery-approval/approval-core-170.cjs');
const fixtureFile=guard.assertPath(path.join(ROOT,'tests/approval-170-contract.test.cjs')),fixtureSource=fs.readFileSync(fixtureFile,'utf8');
assert.equal(crypto.createHash('sha256').update(fs.readFileSync(fixtureFile)).digest('hex'),'c7507f93a46cf7a7d9fe17a80fd49c10802c0a905d1f30b517e9207319acecb1');
const beforeTests=fixtureSource.indexOf('\ntest(');assert(beforeTests>0);
const fixtureModule={exports:{}};
vm.runInThisContext('(function(require,module,exports,__filename,__dirname){\n'+fixtureSource.slice(0,beforeTests)+'\nmodule.exports=fixture;\n})',{filename:fixtureFile})(createRequire(fixtureFile),fixtureModule,fixtureModule.exports,fixtureFile,path.dirname(fixtureFile));
const fixture=fixtureModule.exports;
const SID='S-1-5-21-100-200-300-1001',DIR='C:\\Synthetic170',NAMESPACE='fixture\\employee',KEY=Buffer.alloc(32,31),PUB='a'.repeat(64),TX='11111111-1111-4111-8111-111111111111',APPROVAL='22222222-2222-4222-8222-222222222222';
const signed=value=>{const payload=JSON.stringify(value);return Buffer.from(JSON.stringify({payload,mac:crypto.createHmac('sha256',KEY).update(payload).digest('hex')}));};
const journal=(phase='committed',patch={})=>({version:1,transactionId:TX,approvalId:APPROVAL,treeSha256:'b'.repeat(64),sourcePolicySha256:'c'.repeat(64),installDir:DIR,osUser:SID,role:'employee',sourceVersion:'1.6.1',targetVersion:'1.6.2',phase,oldFiles:[],activation:null,activationSha256:null,dataBackup:null,...patch});
const status=(phase='committed',patch={})=>({version:1,product:'xjy-jewelry-offline',installationDir:DIR,role:'employee',targetVersion:'1.6.2',transactionId:TX,phase,osUserNamespace:NAMESPACE,...patch});
function records(j=journal(),s=status(),patchJournals={}){return{key:KEY,journalBytes:signed(j),statusBytes:signed(s),patchJournals,installationDir:DIR,role:'employee',osUser:SID,osUserNamespace:NAMESPACE};}
const recovery=e=>e?.code==='RECOVERY_REQUIRED';

test('L01 legacy role confirmation requires an independently measured physical directory identity',()=>{
 const c={confirmed:true,source:'explicit',role:'employee',osUser:SID,installationDir:DIR,installationIdentity:'12345678:0000000000000001',sourceVersion:'1.6.0'};
 const expected={installationDir:DIR,installationIdentity:c.installationIdentity,role:'employee',sourceVersion:'1.6.0',osUser:SID,legacyRoleConfirmation:c};
 assert.equal(io.validateActivationRecord(null,expected),true);
 for(const patch of [{installationIdentity:undefined},{installationIdentity:'12345678:0000000000000002'},{osUser:'S-1-5-21-999'},{sourceVersion:'1.6.1'}])assert.throws(()=>io.validateActivationRecord(null,{...expected,...patch}),e=>e.code==='LEGACY_ROLE_CONFIRMATION_REQUIRED');
 assert.equal(io.physicalIdentity({dev:0x12345678n,ino:1n}),c.installationIdentity);
});
test('L02 client marker-validation and transaction claims cannot enter the read-only review request',async()=>{
 for(const extra of [{profileMarkerValidated:true},{transactionState:'committed'},{activation:{role:'employee'}},{installationIdentity:'12345678:0000000000000001'}])await assert.rejects(io.runReadonlyReview({operation:'initial',osUser:SID,role:'employee',...extra}),e=>e.code==='BAD_REQUEST');
});
test('L03 authenticated completed and rolled-back original state is classified without replacing the gate',()=>{
 for(const phase of ['committed','rolledback']){const r=io.validateTransactionRecords(records(journal(phase),status(phase)));assert.equal(r.transactionState,phase);assert.equal(r.transactionPublicationId,null);}
});
test('L04 malformed HMAC or a different path SID role namespace and state is rejected',()=>{
 const tampered=records();const envelope=JSON.parse(tampered.journalBytes);envelope.payload+=' ';tampered.journalBytes=Buffer.from(JSON.stringify(envelope));assert.throws(()=>io.validateTransactionRecords(tampered),recovery);
 for(const patch of [{installDir:'C:\\Other'},{osUser:'S-1-5-21-999'},{role:'host'},{phase:'unknown'},{version:9}])assert.throws(()=>io.validateTransactionRecords(records(journal('committed',patch))),recovery);
 assert.throws(()=>io.validateTransactionRecords(records(journal(),status('committed',{osUserNamespace:'other\\user'}))),recovery);
 assert.throws(()=>io.validateTransactionRecords(records(journal(),status('mutating'))),recovery);
});
test('L05 a repeat anchor must have its exact authenticated publication leaf',()=>{
 const anchor={version:2,purpose:'xjy-repeat-program-patch',publicationId:PUB,installationDir:DIR,role:'employee',targetVersion:'1.7.0',transactionId:TX,phase:'mutating',osUserNamespace:NAMESPACE};
 const s=status('mutating',{targetVersion:'1.7.0'}),leaf=journal('mutating',{sourceVersion:'1.6.2',targetVersion:'1.7.0'});
 const value=records(anchor,s,{[PUB]:signed(leaf)}),r=io.validateTransactionRecords(value);assert.equal(r.transactionState,'mutating');assert.equal(r.transactionPublicationId,PUB);assert.equal(r.transactionApprovalId,APPROVAL);
 assert.throws(()=>io.validateTransactionRecords({...value,patchJournals:{}}),recovery);
 assert.throws(()=>io.validateTransactionRecords({...value,patchJournals:{[PUB]:signed({...leaf,transactionId:APPROVAL})}}),recovery);
 assert.throws(()=>io.validateTransactionRecords({...value,patchJournals:{[PUB]:signed(leaf),['d'.repeat(64)]:signed(leaf)}}),recovery);
});
test('L06 only exact original publication and approval can be reapproved while pending',()=>{
 const f=fixture(),original=core.review170PublicationApproval(f.options).record;
 const request={...f.options,operation:'reapprove-original',previousApproval:original,installation:{...f.options.installation,transactionState:'mutating',transactionPublicationId:f.policy.catalogSha256,transactionApprovalId:original.approvalId}};
 assert.equal(core.review170PublicationApproval(request).record.approvalId,original.approvalId);assert.equal(core.review170PublicationApproval(request).requiredInstallationStrategy,'full-engine-tree');
 for(const patch of [{transactionPublicationId:'f'.repeat(64)},{transactionApprovalId:APPROVAL},{transactionState:'unknown'}])assert.throws(()=>core.review170PublicationApproval({...request,installation:{...request.installation,...patch}}),recovery);
 assert.throws(()=>core.review170PublicationApproval({...request,operation:'initial',previousApproval:null}),recovery);
});
test('L07 activation-less reapproval still needs an exact supported source unless recovering its own pending transaction',()=>{
 const f=fixture(),original=core.review170PublicationApproval(f.options).record,request={...f.options,operation:'reapprove-original',previousApproval:original,installation:{...f.options.installation,activationMissing:true}};
 assert.equal(core.review170PublicationApproval(request).record.approvalId,original.approvalId);
 assert.throws(()=>core.review170PublicationApproval({...request,installation:{...request.installation,source:{...request.installation.source,sha256:'f'.repeat(64)}}}),e=>e.code==='SOURCE_PROGRAM_MISMATCH');
});
test('L08 the PS flow locks verified roles but requests one explicit legacy selection without trusting the candidate role hint',()=>{
 const source=fs.readFileSync(guard.assertPath(path.join(ROOT,'delivery-approval/Prepare-Repeat-Approval-170.ps1')),'utf8');
 assert(source.includes('if($existingActivation){$role.SelectedIndex='));assert(source.includes('elseif($legacyMarker){$role.SelectedIndex=2;$role.Enabled=$false}'));
 assert(source.includes('else{$role.SelectedIndex=0;$role.Enabled=$true;'));assert(source.includes('installationIdentity=$installationIdentity'));
 assert(!source.includes("WriteAllText($activation"));assert(!source.includes("New-Item -ItemType File -Path $activation"));
});
test('L09 real ordinary-file state reading distinguishes absent gate, authentic completion and missing journal',async()=>{
 const base=guard.assertPath(path.join(ROOT,'runtime/approval170-legacy-state'));fs.mkdirSync(base,{recursive:true});const installation=fs.mkdtempSync(path.join(base,'owned-'));
 assert.equal((await io.readTransactionState(installation,'employee',SID)).transactionState,'none');assert.equal(fs.existsSync(path.join(installation,'.xjy-initial-upgrade')),false);
 const state=path.join(installation,'.xjy-initial-upgrade');fs.mkdirSync(state);fs.writeFileSync(path.join(state,'.journal-key'),KEY,{flag:'wx'});
 await assert.rejects(io.readTransactionState(installation,'employee',SID),recovery);
 const j=journal('committed',{installDir:installation}),s=status('committed',{installationDir:installation,osUserNamespace:(os.hostname()+'\\'+os.userInfo().username).toLowerCase()});
 fs.writeFileSync(path.join(state,'journal.json'),signed(j),{flag:'wx'});fs.writeFileSync(path.join(state,'recovery-status.json'),signed(s),{flag:'wx'});
 const before=fs.readdirSync(state).sort(),r=await io.readTransactionState(installation,'employee',SID);assert.equal(r.transactionState,'committed');assert.match(r.fingerprint,/^[a-f0-9]{64}$/);assert.deepEqual(fs.readdirSync(state).sort(),before);
});
test('L10 Windows handle and Node directory identity agree on an actual fictional directory',()=>{
 const base=guard.assertPath(path.join(ROOT,'runtime/approval170-legacy-state'));fs.mkdirSync(base,{recursive:true});const directory=fs.mkdtempSync(path.join(base,'identity-'));
 const source=fs.readFileSync(guard.assertPath(path.join(ROOT,'delivery-approval/Prepare-Repeat-Approval-170.ps1')),'utf8'),match=/Add-Type -TypeDefinition @'\r?\n([\s\S]*?)\r?\n'@/.exec(source);assert(match);
 const encoded=Buffer.from(match[1]).toString('base64'),quoted=directory.replace(/'/g,"''");
 const script="$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);Add-Type -TypeDefinition ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('"+encoded+"')));$h=[XjyReviewerPathGuard]::Directory('"+quoted+"');try{@{identity=[XjyReviewerPathGuard]::Identity($h,'"+quoted+"')}|ConvertTo-Json -Compress}finally{$h.Dispose()}";
 const result=require('node:child_process').spawnSync('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,shell:false,encoding:'utf8'});
 assert.equal(result.status,0,result.stderr||result.stdout);assert.equal(JSON.parse(result.stdout.trim()).identity,io.physicalIdentity(fs.lstatSync(directory,{bigint:true})));
});

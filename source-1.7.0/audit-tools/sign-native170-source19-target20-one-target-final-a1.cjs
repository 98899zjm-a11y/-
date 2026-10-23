'use strict';
// FIXED SOURCE: FIXED only one exact new target.catalog20 payload; separately authorized current Root scope; no author execution.
// Authority is the current user delivery delegation record, not historical a10 digest approval.
// --check-public reads public bytes only; --sign-internal uses only current internal acceptance delegation and reuses six exact old public envelopes.
const fs0=require('node:fs'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const ROOT='E:\\codex\\2026-10-15\\work\\xjy-v16-deep-audit',PROPOSAL=path.join(ROOT,'release-work/native170-source19-target20-candidate-a1/proposal');
const ISSUER='E:\\codex\\2026-10-13\\work\\xjy-web-stage1',KEY=path.join(ISSUER,'config/release-signing/issuer-private.pem');
const OUT=path.join(ROOT,'release-work/native170-source19-target20-candidate-a1/approvals'),REPORT=path.join(ROOT,'reports/native170-source19-target20-one-target-internal-signatures-a1.json');
const PUBLISHER='6e8b9cadb59aeb53f30d41f4471f70f644f0dfc7376ffb9d8a4c62defb98458c';
const PINS=Object.freeze({
 'source-1.6.0.catalog':'907ee7af50f0bb88d16136ffb8e04f5ddc09e1be6f4821c57c6e9466fcf632f5',
 'source-1.6.1.catalog':'861cf1f8e31b958a95a06886fae38f8983afd0191eddb64bf3bc39e06ff52025',
 'source-1.6.2.catalog':'59114d6e72154df1e9ad3aacec757dc4a50067512db3f24cae749d0833232e1e',
 'resource.catalog':'f2a76c739b5b78975d03c82ac6bacb8e65719c8d0d5192f2bf69ae62955fe0b3',
 'target.catalog':'4d78cbbac07b05f267fabb870a10376a2c1158a8b4623ba4ea35d3334cb828ef',
 'source-policy':'0beedfaa41b633d9d6874bae524a409c28c4918b87d4b2576d0a9fa3d779daf7',
 'worker.catalog':'bb6542243b8b39631fc67a92ce414f9355fb6547df55704f419ff83a4fe133ae'
});
const PROPOSAL_SHA='3d78b182886e282954e23a144de1b1a20bd62a3860d0f3d5e6b12ec1426605ab',SIGN_REQUESTS_SHA='e83f13778c4566dee27c1a81a59c54995245a945e009adb8b97de685ca7affdc';
const APPROVED_PAYLOADS=Object.freeze({'target.catalog':Object.freeze({field:'catalog',sequence:20,size:230255})}); // Root actual bytes frozen after prepare
const AUTHORIZATION_RECORD=path.join(ROOT,'reports/2026-10-20-autonomous-delivery-user-authorization.md'),AUTHORIZATION_SHA='7dfc073888846668db2be629a35a23a6db8a52fbcfbb9b934a67b4579cbbc9e0';

const BASELINE=path.join(ROOT,'release-work/native170-target19-worker20-repair-a1');
const NODE=String.raw`C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe`,NODE_SHA='3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237';
const ROOT_SCOPE_REPORT=path.join(ROOT,'reports/native170-source19-target20-root-one-target-signing-scope-a1.json'),ROOT_SCOPE_SHA='5a36f908995863db106ca4cf76e9bec1247e8c3e629c9df42dbac907f0c4e741';
const BUILDER_SHA='cbdfd0b772c066a01a16246043e2dfd6cbd0e22d1694757f7d0ecf0988dc87ce',REVIEW_INPUT_SHA='4e7584e11fd22e68248019a4e4897559ad83862d08974c700331e4538b5dac46';
const OLD_ENVELOPES=Object.freeze({
 'source-1.6.0.catalog-envelope.json':{size:246597,sha256:'cde82451fb53ece189f15b513e2d1fa9c50098295921fa6635ebf7376a84b4b2'},
 'source-1.6.1.catalog-envelope.json':{size:246597,sha256:'71f19964c429b06da6870c218ddf30cb125f4e2d371e4fb7136cd18d68339d99'},
 'source-1.6.2.catalog-envelope.json':{size:246597,sha256:'7bd59deb9b90b3ca0f55af433e54404f40e060ea507dc8f905b1cc7a6d83237e'},
 'resource.catalog-envelope.json':{size:234672,sha256:'5195eaf598946dfcdf672e4886254978b27e681f2c8733992f1cb584c03c1d79'},
 'source-policy-envelope.json':{size:3261,sha256:'6bdfe409f352d65247d68860961e52c8805d583e45d3305ab252002e76340be2'},
 'worker.catalog-envelope.json':{size:18087,sha256:'5e840ca8af71f4efaf27761d7d8cfb242e71a7ea74b8af4bfc605a43a26870f7'}
});
async function verifyTarget20Scope(read,index,requests,actualTree,key){
 const rawReport=await read(ROOT_SCOPE_REPORT);assert.equal(sha(rawReport),ROOT_SCOPE_SHA);const report=JSON.parse(rawReport);assert.equal(report.schemaVersion,1);assert.equal(report.purpose,'native170-current-source19-target20-internal-one-target-signing');assert.equal(report.approved,true);assert.equal(report.authorityRecordSha256,AUTHORIZATION_SHA);assert.equal(report.proposalSha256,PROPOSAL_SHA);assert.equal(report.requestIndexSha256,SIGN_REQUESTS_SHA);assert.equal(report.preparationToolSha256,BUILDER_SHA);assert.equal(report.reviewedInputSha256,REVIEW_INPUT_SHA);assert.deepEqual(report.exactlyNewPayloads,[{id:'target.catalog',sha256:PINS['target.catalog'],bytes:APPROVED_PAYLOADS['target.catalog'].size,sequence:20}]);for(const flag of['notHistoricalPerDigestUserClick','source19AuthenticatedCommitted','program1079BytesUnchanged','worker20All101ExactReuse','resource17AndPolicyExactReuse','internalGuestWorkflowOnly','feedPublicationForbidden','formalInstallForbidden','privateKeyReadOnlyOnHost','noKeyCopy','outerSignatureNotIncluded'])assert.equal(report[flag],true);assert.equal(report.oldPublicSignatureReuseCount,6);assert.equal(report.source19OriginalSignedCatalogSha256,'c049bc4d886a1aefd4100e0e397fb12a94293838609712ce6404d6227c294535');assert.equal(report.source19ActualPostProofSha256,'133ce31ad6f33c6557fd5c3e9a78223d0f568032f5874e0a5a19858192f3e7ae');assert.equal(report.source19OriginalCmdNaturalExitVerified,false);assert.equal(report.finalWholeAudit,'PENDING');
 assert.equal(index.preparationToolSha256,BUILDER_SHA);assert.equal(index.reviewedInputsManifestSha256,REVIEW_INPUT_SHA);assert.equal(sha(await read(path.join(PROPOSAL,'reviewed-inputs.json'))),REVIEW_INPUT_SHA);assert.deepEqual(index.sequenceProposal,{bridge:12,resource:17,target:20,worker:20});assert.equal(index.newSignatureCount,1);assert.equal(index.reusedExactPublicSignatureCount,6);assert.deepEqual(index.internalBytesActuallyAffected,['target.catalog']);assert.equal(index.targetArchiveAndAll1079ProgramRowsExactBytesReused,true);assert.equal(index.workerCatalogExactBytesReused,true);assert.equal(index.workerArchiveExactBytesReused,true);assert.equal(index.defaultAnchor14MustRemainAuthenticOnDisk,true);assert.equal(index.sourceAuthorityStateCreated,false);assert.equal(index.slotSignatureCoverage.catalogSha256,'c049bc4d886a1aefd4100e0e397fb12a94293838609712ce6404d6227c294535');assert.equal(index.slotSignatureCoverage.sourceSequence,19);assert.equal(index.slotSignatureCoverage.defaultAnchorIsNotCurrentSource,true);
 const oldRaw=await read(path.join(BASELINE,'proposal/requests/target.catalog.json'));assert.equal(sha(oldRaw),'c049bc4d886a1aefd4100e0e397fb12a94293838609712ce6404d6227c294535');assert.equal(oldRaw.length,230255);const old=JSON.parse(oldRaw),target=requests.find(r=>r.id==='target.catalog').value;assert.equal(old.sequence,19);assert.equal(target.sequence,20);assert.equal(target.files.length,1079);assert.deepEqual(target,{...old,sequence:20,publishedAt:target.publishedAt,expiresAt:target.expiresAt});assert.notEqual(sha(requests.find(r=>r.id==='target.catalog').raw),sha(oldRaw));const asar=target.files.find(r=>r.path==='resources/app.asar');assert(asar&&asar.size===13495963&&asar.sha256==='d017ceb9947ec3ead43de68a2da1e9aac928c56129bb5c2abafa36238026141d');
 const worker=requests.find(r=>r.id==='worker.catalog').value,policy=requests.find(r=>r.id==='source-policy').value,resource=requests.find(r=>r.id==='resource.catalog').value;assert.equal(worker.sequence,20);assert.equal(worker.files.length,101);assert.equal(policy.tools.length,10);assert.equal(policy.catalogSha256,PINS['resource.catalog']);assert.equal(resource.sequence,17);assert.equal(resource.files.length,1007);assert.deepEqual(target.files.filter(r=>r.path.startsWith('resources/')),resource.files);
 const tree=new Map(actualTree.files.map(r=>[r.path,r]));assert.equal(actualTree.files.filter(r=>r.path.startsWith('worker-draft/')).length,101);for(const r of worker.files){const a=tree.get('worker-draft/'+r.path);assert(a&&a.size===r.size&&a.sha256===r.sha256);}for(const r of policy.tools){const a=tree.get('artifact-tools/'+r.path);assert(a&&a.size===r.size&&a.sha256===r.sha256);}for(const [name,archive]of[['archives/worker-program.zip',worker.archive],['archives/target-program.zip',target.archive],['archives/final-resources.zip',resource.archive]]){const a=tree.get(name);assert(a&&a.size===archive.size&&a.sha256===archive.sha256);}
 const typed=await read(path.join(PROPOSAL,'slot-source.catalog.json')),typedBytes=await read(path.join(PROPOSAL,'slot-source.catalog-envelope.json'));assert(typed.equals(oldRaw));assert.equal(typedBytes.length,246632);assert.equal(sha(typedBytes),'53f6fa7017185acd9c25b7139b558db0daf923e0d72bece4e6a34d1e7820bc03');const e=JSON.parse(typedBytes);assert.deepEqual(Object.keys(e).sort(),['catalog','signature']);assert.equal(e.catalog,typed.toString('utf8'));assert(crypto.verify(null,typed,key,Buffer.from(e.signature,'base64')));assert.equal(JSON.parse(typed).sequence,19);
}

function bindingsReady(){const valid=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);assert(Object.keys(APPROVED_PAYLOADS).join(',')==='target.catalog'&&valid(ROOT_SCOPE_SHA)&&valid(NODE_SHA)&&valid(PROPOSAL_SHA)&&valid(SIGN_REQUESTS_SHA)&&Object.entries(APPROVED_PAYLOADS).every(([id,s])=>valid(PINS[id])&&Number.isSafeInteger(s.size)&&s.size>0),'TARGET20_FIXED_BINDINGS_REQUIRED: actual single target/proposal/index/new Root scope SHA and length required before filesystem/key access');}
let keyReads=0;
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function source(file,pin,max=1048576){assert(path.isAbsolute(file)&&!/^[/\\]{2}/.test(file));let before;for(let p=path.resolve(file);;p=path.dirname(p)){const s=fs0.lstatSync(p,{bigint:true});assert(!s.isSymbolicLink()&&fs0.realpathSync.native(p).toLowerCase()===p.toLowerCase(),'ordinary public input');if(!before){assert(s.isFile()&&s.nlink===1n);before=s;}else assert(s.isDirectory());if(p===path.dirname(p))break;}const fd=fs0.openSync(file,'r');try{const a=fs0.fstatSync(fd,{bigint:true});assert.equal(a.dev,before.dev);assert.equal(a.ino,before.ino);assert(a.nlink===1n&&a.size<=BigInt(max));const b=fs0.readFileSync(fd);for(let p=path.resolve(file);;p=path.dirname(p)){const live=fs0.lstatSync(p,{bigint:true});assert(!live.isSymbolicLink()&&fs0.realpathSync.native(p).toLowerCase()===p.toLowerCase(),'public input alias after read');if(p===path.resolve(file))assert(live.isFile()&&live.nlink===1n);else assert(live.isDirectory());if(p===path.dirname(p))break;}const other=fs0.openSync(file,'r');try{const end=fs0.fstatSync(fd,{bigint:true}),live=fs0.fstatSync(other,{bigint:true});for(const k of['dev','ino','size','mtimeNs','ctimeNs','nlink']){assert.equal(a[k],end[k]);assert.equal(a[k],live[k]);}}finally{fs0.closeSync(other);}assert.equal(sha(b),pin,'fixed public source changed');return b;}finally{fs0.closeSync(fd);}}
async function main(){
 bindingsReady(); // First operation: standard-library imports only above; no filesystem/key input before this gate.
 assert.equal(path.resolve(__dirname,'..').toLowerCase(),ROOT.toLowerCase());assert.equal(process.platform,'win32');assert.equal(process.execPath.toLowerCase(),NODE.toLowerCase());assert(!process.env.NODE_OPTIONS&&!process.env.NODE_PATH&&!process.env.ELECTRON_RUN_AS_NODE,'plain fixed Host Node only');source(NODE,NODE_SHA,134217728);
 const [mode,selfPin,authorization,...extra]=process.argv.slice(2);const indexPin=SIGN_REQUESTS_SHA,manifestPin=PROPOSAL_SHA;
 assert(['--check-public','--sign-internal'].includes(mode)&&extra.length===0,'explicit bounded action required');
 for(const pin of [selfPin,indexPin,manifestPin])assert.match(pin||'',/^[a-f0-9]{64}$/);
 assert.equal(indexPin,SIGN_REQUESTS_SHA,'only this exact source19-to20 index');
 assert.equal(manifestPin,PROPOSAL_SHA,'only this exact source19-to20 proposal');
 if(mode==='--sign-internal')assert.equal(authorization,'--authorized-source19-target20-one-target-under-delegation');else assert.equal(authorization,undefined);
 source(__filename,selfPin);
 source(path.join(ROOT,'project/desktop/employee-update-cache.cjs'),'5cb70079bf161a002a2701694e4774c2a11bf8d54efc6674ccb5c7b2c6729815');
 source(path.join(ROOT,'delivery-tools/initial-patch-core.cjs'),'0f9de31c8ad8ec7e1b870a92d025909f4606363801a31ee3582b903c5704bbce');
 const u=require('../project/desktop/employee-update-cache.cjs'),core=require('../delivery-tools/initial-patch-core.cjs');
 async function read(file,max=4194304,root=ROOT){await u.assertPath(fs,file,{root});return u.readSmall(fs,file,max);}
 async function absent(file){await u.assertPath(fs,path.dirname(file),{directory:true});try{await fs.lstat(file);throw Error('CreateNew output already exists');}catch(e){if(e.code!=='ENOENT')throw e;}}
 async function publicInputs(){
  source(__filename,selfPin);
  assert.equal(sha(await read(AUTHORIZATION_RECORD)),AUTHORIZATION_SHA,'current delivery delegation record changed');
  const indexBytes=await read(path.join(PROPOSAL,'signing-requests.json')),manifestBytes=await read(path.join(PROPOSAL,'proposal-manifest.json'));
  assert.equal(sha(indexBytes),indexPin);assert.equal(sha(manifestBytes),manifestPin);
  const index=JSON.parse(indexBytes),manifest=JSON.parse(manifestBytes);
  assert.equal(index.round,'source19to20');assert.equal(index.signed,false);assert.equal(index.requests.length,7);assert.equal(manifest.round,'source19to20');
  const names=Object.keys(PINS).sort();assert.deepEqual(index.requests.map(r=>r.id).sort(),names);
  const actualTree=await core.inspectArtifactTree({artifactDir:PROPOSAL});
  const expected=new Map([...manifest.files,{path:'proposal-manifest.json',size:manifestBytes.length,sha256:manifestPin}].map(r=>[r.path,r]));
  assert.equal(actualTree.files.length,expected.size);
  for(const row of actualTree.files){const e=expected.get(row.path);assert(e&&e.size===row.size&&e.sha256===row.sha256,'proposal file changed: '+row.path);}
  const pem=await read(path.join(PROPOSAL,'worker-draft/publisher-public.pem'),4096);assert(!pem.toString().includes('PRIVATE KEY'));const key=crypto.createPublicKey(pem);
  assert.equal(key.asymmetricKeyType,'ed25519');assert.equal(sha(key.export({type:'spki',format:'der'})),PUBLISHER);
  const requests=[],reusable=[];
  for(const r of index.requests){
   const field=r.id==='source-policy'?'policy':'catalog';assert.equal(r.field,field);assert.equal(r.path,'requests/'+r.id+'.json');assert.equal(r.expectedEnvelopeFile,r.id==='source-policy'?'source-policy-envelope.json':r.id+'-envelope.json');
   const isNew=r.id==='target.catalog';assert.equal(r.independentApprovalRequired,isNew);if(isNew){const fixed=APPROVED_PAYLOADS[r.id];assert.equal(r.field,fixed.field);assert.equal(r.size,fixed.size,'fixed exact payload length');}
   const raw=await read(path.join(PROPOSAL,r.path));assert.equal(raw.length,r.size);assert.equal(sha(raw),PINS[r.id]);assert.equal(r.payloadSha256,PINS[r.id]);
   const value=JSON.parse(raw);if(field==='catalog'){assert.equal(value.app,'xjy-jewelry-offline');assert.equal(value.platform,'win32');assert.equal(value.arch,'x64');assert(Date.parse(value.expiresAt)>Date.now());if(isNew)assert.equal(value.sequence,APPROVED_PAYLOADS[r.id].sequence);}
   if(!isNew){const bytes=await read(path.join(BASELINE,'approvals',r.expectedEnvelopeFile));const fixed=OLD_ENVELOPES[r.expectedEnvelopeFile];assert(fixed);assert.equal(bytes.length,fixed.size);assert.equal(sha(bytes),fixed.sha256,'exact old public envelope bytes');const old=JSON.parse(bytes);assert.deepEqual(Object.keys(old).sort(),[field,'signature'].sort());assert.equal(old[field],raw.toString('utf8'));assert(crypto.verify(null,raw,key,Buffer.from(old.signature,'base64')));reusable.push({name:r.expectedEnvelopeFile,bytes,payloadSha256:PINS[r.id],reused:true});}
   if(r.id==='source-policy'){assert.equal(value.purpose,'xjy-repeat-program-patch');assert.equal(value.targetVersion,'1.7.0');assert.equal(value.catalogSha256,PINS['resource.catalog']);assert.deepEqual(value.sourcePrograms.map(x=>x.version).sort(),['1.6.0','1.6.1','1.6.2']);}requests.push({...r,raw,value});
  }
  assert.equal(reusable.length,6);assert.equal(requests.filter(r=>r.independentApprovalRequired===true).length,1);await verifyTarget20Scope(read,index,requests,actualTree,key);return{key,requests,reusable,treeSha256:actualTree.sha256};
 }
 const checked=await publicInputs();
 if(mode==='--check-public'){process.stdout.write(JSON.stringify({publicInputsVerified:true,requests:7,requestIndexSha256:indexPin,proposalSha256:manifestPin,privateKeyRead:false,KeyReads:keyReads,signed:false,newSignatureScope:1,reusedPublicScope:6,rootScopeReportSha256:ROOT_SCOPE_SHA,nodeSha256:NODE_SHA,outerSignatureIncluded:false})+'\n');return;}
 await absent(OUT);await absent(REPORT);
 // All public checks precede the first private-key access. This fixed path is
 // not passed by CLI, copied to Guest, printed, or used for another payload.
 keyReads++;const opened=await u.openChecked(fs,KEY,'r',{root:ISSUER});let privateKey,keyBytes;const envelopes=[...checked.reusable];
 try{
  const stat=await u.assertHandle(fs,opened,{root:ISSUER});assert(stat.size>0n&&stat.size<=4096n);
  keyBytes=await u.readExactly(opened.handle,0,Number(stat.size));
  try{privateKey=crypto.createPrivateKey(keyBytes);}finally{keyBytes.fill(0);keyBytes=null;}
  assert.equal(privateKey.asymmetricKeyType,'ed25519');assert.equal(sha(crypto.createPublicKey(privateKey).export({type:'spki',format:'der'})),PUBLISHER);
  for(const r of checked.requests.filter(r=>r.independentApprovalRequired===true)){const signature=crypto.sign(null,r.raw,privateKey).toString('base64');assert(crypto.verify(null,r.raw,checked.key,Buffer.from(signature,'base64')));const e={[r.field]:r.raw.toString('utf8'),signature};
   if(r.field==='policy')assert.deepEqual(core.verifySourcePolicy(e,checked.key,{upgradeMode:'repeat'}),r.value);
   else assert.deepEqual(u.verifySignedCatalog(e,u.createTrustedUpdatePolicy({trustedPublicKey:checked.key,currentVersion:r.value.sourceVersions[0],allowedFiles:r.value.files.map(f=>f.path),platform:'win32',arch:'x64'})),r.value);
   envelopes.push({name:r.expectedEnvelopeFile,bytes:Buffer.from(JSON.stringify(e)),payloadSha256:PINS[r.id]});
  }
  privateKey=null;await u.assertHandle(fs,opened,{root:ISSUER});assert.equal((await publicInputs()).treeSha256,checked.treeSha256);
 }finally{if(keyBytes)keyBytes.fill(0);privateKey=null;await opened.handle.close();}
 await absent(OUT);await fs.mkdir(OUT,{mode:0o700});await u.assertPath(fs,OUT,{directory:true,root:ROOT});
 const written=[];
 for(const item of envelopes){const file=path.join(OUT,item.name),o=await u.openChecked(fs,file,'wx+',{missing:true,root:OUT});try{await u.writeExactly(o.handle,0,item.bytes);await o.handle.sync();await u.assertHandle(fs,o,{root:OUT,snapshot:false});}finally{await o.handle.close();}assert((await read(file)).equals(item.bytes));written.push({name:item.name,size:item.bytes.length,sha256:sha(item.bytes),payloadSha256:item.payloadSha256,reused:item.reused===true});}
 const report={purpose:'native170-internal-only-signatures',requestIndexSha256:indexPin,proposalSha256:manifestPin,sourceSha256:selfPin,files:written,newSignatures:1,reusedPublicSignatures:6,signaturesVerified:true,privateKeyIncluded:false,published:false,installed:false,programExecuted:false,KeyReads:keyReads,authorizationExternal:true,authorizationRecordSha256:AUTHORIZATION_SHA,rootScopeReportSha256:ROOT_SCOPE_SHA,nodeSha256:NODE_SHA,feedPublicationForbidden:true,formalInstallForbidden:true,outerSignatureNotIncluded:true,finalDeepseekAuditIncluded:false,actualWorkflowAcceptanceInferred:false,sourceAuthorityStateCreated:false,authorizationScope:'Current delegation plus separate exact new Root single-target20 scope; no final DeepSeek audit, formal feed/install, or outer20 signature'};
 await fs.writeFile(REPORT,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});process.stdout.write(JSON.stringify({signed:true,newSignatures:1,reusedPublicSignatures:6,report:REPORT,published:false,installed:false})+'\n');
}
main().catch(error=>{process.stderr.write('Signing step stopped: '+error.message+'\n');process.exitCode=1;});

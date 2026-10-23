'use strict';
// FIXED SOURCE: only exact repair19 policy and worker20 internal payloads; no author execution.
// Authority is the current user delivery delegation record, not historical a10 digest approval.
// --check-public reads public bytes only; --sign-two-exact uses only current internal acceptance delegation and reuses five exact old public envelopes.
const fs0=require('node:fs'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const ROOT='E:\\codex\\2026-10-15\\work\\xjy-v16-deep-audit',PROPOSAL=path.join(ROOT,'release-work/native170-target19-worker20-repair-a1/proposal');
const ISSUER='E:\\codex\\2026-10-13\\work\\xjy-web-stage1',KEY=path.join(ISSUER,'config/release-signing/issuer-private.pem');
const OUT=path.join(ROOT,'release-work/native170-target19-worker20-repair-a1/approvals'),REPORT=path.join(ROOT,'reports/native170-repair19-two-internal-signatures-a1.json');
const PUBLISHER='6e8b9cadb59aeb53f30d41f4471f70f644f0dfc7376ffb9d8a4c62defb98458c';
const PINS=Object.freeze({
 'source-1.6.0.catalog':'907ee7af50f0bb88d16136ffb8e04f5ddc09e1be6f4821c57c6e9466fcf632f5',
 'source-1.6.1.catalog':'861cf1f8e31b958a95a06886fae38f8983afd0191eddb64bf3bc39e06ff52025',
 'source-1.6.2.catalog':'59114d6e72154df1e9ad3aacec757dc4a50067512db3f24cae749d0833232e1e',
 'resource.catalog':'f2a76c739b5b78975d03c82ac6bacb8e65719c8d0d5192f2bf69ae62955fe0b3',
 'target.catalog':'c049bc4d886a1aefd4100e0e397fb12a94293838609712ce6404d6227c294535',
 'source-policy':'0beedfaa41b633d9d6874bae524a409c28c4918b87d4b2576d0a9fa3d779daf7',
 'worker.catalog':'bb6542243b8b39631fc67a92ce414f9355fb6547df55704f419ff83a4fe133ae'
});
const PROPOSAL_SHA='46affb3addddbdd9ec26f495c8b991b31ea4eea17ea1aea2dae18e328fa99a2d',SIGN_REQUESTS_SHA='2b936e814335e6759ee24778db15ed57e62aa7809a546ab132cd61a84c890566';
const APPROVED_PAYLOADS=Object.freeze({
 'source-policy':Object.freeze({field:'policy',sequence:null,size:2874}),
 'worker.catalog':Object.freeze({field:'catalog',sequence:20,size:16389})
});
const AUTHORIZATION_RECORD=path.join(ROOT,'reports/2026-10-20-autonomous-delivery-user-authorization.md'),AUTHORIZATION_SHA='7dfc073888846668db2be629a35a23a6db8a52fbcfbb9b934a67b4579cbbc9e0';

const BASELINE=path.join(ROOT,'release-work/native170-package-closure-a12-candidate-a2');
const NODE=String.raw`C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe`,NODE_SHA='3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237';
const ROOT_SCOPE_REPORT=path.join(ROOT,'reports/native170-repair19-root-two-signing-scope-a1.json'),ROOT_SCOPE_SHA='1daa1fcc6bfbba539af56a24668588154729b4a19275c451d486292dde842ed7';
const BUILDER_SHA='9fe01547e74cab6e4f41e224be76716377220e9c068bcede173a9b9b51b93e5c',REVIEW_INPUT_SHA='f8bfcda66064622b1366c611c8a740f2d35c579491003e0e011ca8bea52ebacf';
const OLD_ENVELOPES=Object.freeze({
 'source-1.6.0.catalog-envelope.json':{size:246597,sha256:'cde82451fb53ece189f15b513e2d1fa9c50098295921fa6635ebf7376a84b4b2'},
 'source-1.6.1.catalog-envelope.json':{size:246597,sha256:'71f19964c429b06da6870c218ddf30cb125f4e2d371e4fb7136cd18d68339d99'},
 'source-1.6.2.catalog-envelope.json':{size:246597,sha256:'7bd59deb9b90b3ca0f55af433e54404f40e060ea507dc8f905b1cc7a6d83237e'},
 'resource.catalog-envelope.json':{size:234672,sha256:'5195eaf598946dfcdf672e4886254978b27e681f2c8733992f1cb584c03c1d79'},
 'target.catalog-envelope.json':{size:246632,sha256:'53f6fa7017185acd9c25b7139b558db0daf923e0d72bece4e6a34d1e7820bc03'}
});
async function verifyRepairScope(read,index,requests,actualTree,key){
 const rawReport=await read(ROOT_SCOPE_REPORT);assert.equal(sha(rawReport),ROOT_SCOPE_SHA);const report=JSON.parse(rawReport);assert.equal(report.schemaVersion,1);assert.equal(report.purpose,'native170-target19-worker20-internal-repair-two-payload-signing');assert.equal(report.approved,true);assert.equal(report.authorityRecordSha256,AUTHORIZATION_SHA);assert.equal(report.proposalSha256,PROPOSAL_SHA);assert.equal(report.requestIndexSha256,SIGN_REQUESTS_SHA);assert.equal(report.preparationToolSha256,BUILDER_SHA);assert.equal(report.reviewedInputSha256,REVIEW_INPUT_SHA);for(const n of['notHistoricalPerDigestUserClick','oldResourceAndTargetMustRemainExact','internalGuestRecoveryOnly','feedPublicationForbidden','formalInstallForbidden','privateKeyReadOnlyOnHost','noKeyCopy','outerSignatureNotIncluded'])assert.equal(report[n],true);
 const sorted=a=>a.sort((x,y)=>x.id.localeCompare(y.id));assert.deepEqual(sorted(report.exactlyNewPayloads.map(r=>({id:r.id,sha256:r.sha256,bytes:r.bytes}))),sorted(Object.keys(APPROVED_PAYLOADS).map(id=>({id,sha256:PINS[id],bytes:APPROVED_PAYLOADS[id].size}))));assert.equal(index.preparationToolSha256,BUILDER_SHA);assert.equal(index.reviewedInputsManifestSha256,REVIEW_INPUT_SHA);assert.equal(sha(await read(path.join(PROPOSAL,'reviewed-inputs.json'))),REVIEW_INPUT_SHA);assert.deepEqual(index.sequenceProposal,{bridge:12,resource:17,target:19,worker:20});assert.equal(index.newSignatureCount,2);assert.equal(index.reusedExactPublicSignatureCount,5);assert.equal(index.internalCliRepairOnly,true);assert.equal(index.feedPublicationForbidden,true);assert.equal(index.pendingJournalEdited,false);
 const oldP=await read(path.join(BASELINE,'proposal/requests/source-policy.json'));assert.equal(sha(oldP),'0365b1daf31ae6fb6a9025230a3662233630fcbb34e2847d51f477ee494401bd');const oldPolicy=JSON.parse(oldP),policy=requests.find(r=>r.id==='source-policy').value;assert.equal(oldPolicy.tools.length,10);assert.equal(policy.tools.length,10);assert.equal(oldPolicy.tools.filter(r=>r.path==='delivery-tools/initial-patch-entry.cjs'&&r.size===21710&&r.sha256==='4c0008c6f070c22255f3a2819ac82e9be774fbaf631030bb414c95bbcac6b161').length,1);const nextTools=oldPolicy.tools.map(r=>r.path==='delivery-tools/initial-patch-entry.cjs'?{path:r.path,size:21711,sha256:'33d8d219b5153816dc802797ca0d5940e6bf03e1f1403e288dd4b5bbea0ec426'}:r);assert.deepEqual(policy,{...oldPolicy,tools:nextTools});assert(!policy.tools.some(r=>r.path==='delivery-tools/engine-tree-runtime170.cjs'));
 const oldW=await read(path.join(BASELINE,'proposal/requests/worker.catalog.json'));assert.equal(sha(oldW),'f3b5b8e810859c13761c721f81c3b838ec787c48a984b28a8096024552be131c');const oldWorker=JSON.parse(oldW),worker=requests.find(r=>r.id==='worker.catalog').value;const delta={'delivery-tools/initial-patch-entry.cjs':{before:'4c0008c6f070c22255f3a2819ac82e9be774fbaf631030bb414c95bbcac6b161',size:21711,sha256:'33d8d219b5153816dc802797ca0d5940e6bf03e1f1403e288dd4b5bbea0ec426'},'delivery-tools/engine-tree-runtime170.cjs':{before:'fcb032c24702d991263757e6c984222d48fe0caa83742b6d2ba795701617962d',size:131005,sha256:'f6ed11c51015f5458db1605dde1f715e1895e5ae8569e31ed7e7627ad4752266'}};assert.equal(oldWorker.files.length,101);assert.equal(worker.files.length,101);const files=oldWorker.files.map(r=>{const d=delta[r.path];if(!d)return r;assert.equal(r.sha256,d.before);return{path:r.path,size:d.size,sha256:d.sha256};});assert.deepEqual(worker,{...oldWorker,sequence:20,publishedAt:worker.publishedAt,expiresAt:worker.expiresAt,archive:worker.archive,files});assert.deepEqual(worker.files.filter((r,i)=>JSON.stringify(r)!==JSON.stringify(oldWorker.files[i])).map(r=>r.path).sort(),Object.keys(delta).sort());
 const tree=new Map(actualTree.files.map(r=>[r.path,r]));assert.equal(actualTree.files.filter(r=>r.path.startsWith('worker-draft/')).length,101);for(const r of worker.files){const a=tree.get('worker-draft/'+r.path);assert(a&&a.size===r.size&&a.sha256===r.sha256);}for(const r of policy.tools){const a=tree.get('artifact-tools/'+r.path);assert(a&&a.size===r.size&&a.sha256===r.sha256);}const wa=tree.get('archives/worker-program.zip');assert(wa&&wa.size===worker.archive.size&&wa.sha256===worker.archive.sha256);
 const typed=await read(path.join(PROPOSAL,'slot-source.catalog.json')),envelope=await read(path.join(PROPOSAL,'slot-source.catalog-envelope.json'));assert.equal(typed.length,230255);assert.equal(sha(typed),'a067dd03b72f7139b87632b59df5609336c3d75b980d38dba8e2cc9367444669');assert.equal(envelope.length,246632);assert.equal(sha(envelope),'f26f880854d70a535d99f485fbfad990e27c04d0ef76354223d206afc052430f');const te=JSON.parse(envelope);assert.deepEqual(Object.keys(te).sort(),['catalog','signature']);assert.equal(te.catalog,typed.toString('utf8'));assert(crypto.verify(null,typed,key,Buffer.from(te.signature,'base64')));assert.equal(JSON.parse(typed).sequence,14);
}

function bindingsReady(){const valid=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);assert(Object.keys(APPROVED_PAYLOADS).sort().join(',')==='source-policy,worker.catalog'&&valid(ROOT_SCOPE_SHA)&&valid(NODE_SHA)&&valid(PROPOSAL_SHA)&&valid(SIGN_REQUESTS_SHA)&&Object.entries(APPROVED_PAYLOADS).every(([id,s])=>valid(PINS[id])&&Number.isSafeInteger(s.size)&&s.size>0),'REPAIR19_TEMPLATE_UNBOUND: exact proposal/index/two payload SHA+length required before any key access');}
let keyReads=0;
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function source(file,pin,max=1048576){assert(path.isAbsolute(file)&&!/^[/\\]{2}/.test(file));let before;for(let p=path.resolve(file);;p=path.dirname(p)){const s=fs0.lstatSync(p,{bigint:true});assert(!s.isSymbolicLink()&&fs0.realpathSync.native(p).toLowerCase()===p.toLowerCase(),'ordinary public input');if(!before){assert(s.isFile()&&s.nlink===1n);before=s;}else assert(s.isDirectory());if(p===path.dirname(p))break;}const fd=fs0.openSync(file,'r');try{const a=fs0.fstatSync(fd,{bigint:true});assert.equal(a.dev,before.dev);assert.equal(a.ino,before.ino);assert(a.nlink===1n&&a.size<=BigInt(max));const b=fs0.readFileSync(fd);for(let p=path.resolve(file);;p=path.dirname(p)){const live=fs0.lstatSync(p,{bigint:true});assert(!live.isSymbolicLink()&&fs0.realpathSync.native(p).toLowerCase()===p.toLowerCase(),'public input alias after read');if(p===path.resolve(file))assert(live.isFile()&&live.nlink===1n);else assert(live.isDirectory());if(p===path.dirname(p))break;}const other=fs0.openSync(file,'r');try{const end=fs0.fstatSync(fd,{bigint:true}),live=fs0.fstatSync(other,{bigint:true});for(const k of['dev','ino','size','mtimeNs','ctimeNs','nlink']){assert.equal(a[k],end[k]);assert.equal(a[k],live[k]);}}finally{fs0.closeSync(other);}assert.equal(sha(b),pin,'fixed public source changed');return b;}finally{fs0.closeSync(fd);}}
async function main(){
 bindingsReady(); // First operation: standard-library imports only above; no filesystem/key input before this gate.
 assert.equal(path.resolve(__dirname,'..').toLowerCase(),ROOT.toLowerCase());assert.equal(process.platform,'win32');assert.equal(process.execPath.toLowerCase(),NODE.toLowerCase());assert(!process.env.NODE_OPTIONS&&!process.env.NODE_PATH&&!process.env.ELECTRON_RUN_AS_NODE,'plain fixed Host Node only');source(NODE,NODE_SHA,134217728);
 const [mode,selfPin,authorization,...extra]=process.argv.slice(2);const indexPin=SIGN_REQUESTS_SHA,manifestPin=PROPOSAL_SHA;
 assert(['--check-public','--sign-two-exact'].includes(mode)&&extra.length===0,'explicit bounded action required');
 for(const pin of [selfPin,indexPin,manifestPin])assert.match(pin||'',/^[a-f0-9]{64}$/);
 assert.equal(indexPin,SIGN_REQUESTS_SHA,'only this exact repair19 index');
 assert.equal(manifestPin,PROPOSAL_SHA,'only this exact repair19 proposal');
 if(mode==='--sign-two-exact')assert.equal(authorization,'--authorized-repair19-two-internal-under-delegation');else assert.equal(authorization,undefined);
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
  assert.equal(index.round,'repair19');assert.equal(index.signed,false);assert.equal(index.requests.length,7);assert.equal(manifest.round,'repair19');
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
   const isNew=['source-policy','worker.catalog'].includes(r.id);assert.equal(r.independentApprovalRequired,isNew);if(isNew){const fixed=APPROVED_PAYLOADS[r.id];assert.equal(r.field,fixed.field);assert.equal(r.size,fixed.size,'fixed exact payload length');}
   const raw=await read(path.join(PROPOSAL,r.path));assert.equal(raw.length,r.size);assert.equal(sha(raw),PINS[r.id]);assert.equal(r.payloadSha256,PINS[r.id]);
   const value=JSON.parse(raw);if(field==='catalog'){assert.equal(value.app,'xjy-jewelry-offline');assert.equal(value.platform,'win32');assert.equal(value.arch,'x64');assert(Date.parse(value.expiresAt)>Date.now());if(isNew)assert.equal(value.sequence,APPROVED_PAYLOADS[r.id].sequence);}
   if(!isNew){const bytes=await read(path.join(BASELINE,'approvals',r.expectedEnvelopeFile));const fixed=OLD_ENVELOPES[r.expectedEnvelopeFile];assert(fixed);assert.equal(bytes.length,fixed.size);assert.equal(sha(bytes),fixed.sha256,'exact old public envelope bytes');const old=JSON.parse(bytes);assert.deepEqual(Object.keys(old).sort(),[field,'signature'].sort());assert.equal(old[field],raw.toString('utf8'));assert(crypto.verify(null,raw,key,Buffer.from(old.signature,'base64')));reusable.push({name:r.expectedEnvelopeFile,bytes,payloadSha256:PINS[r.id],reused:true});}
   if(r.id==='source-policy'){assert.equal(value.purpose,'xjy-repeat-program-patch');assert.equal(value.targetVersion,'1.7.0');assert.equal(value.catalogSha256,PINS['resource.catalog']);assert.deepEqual(value.sourcePrograms.map(x=>x.version).sort(),['1.6.0','1.6.1','1.6.2']);}requests.push({...r,raw,value});
  }
  assert.equal(reusable.length,5);assert.equal(requests.filter(r=>r.independentApprovalRequired===true).length,2);await verifyRepairScope(read,index,requests,actualTree,key);return{key,requests,reusable,treeSha256:actualTree.sha256};
 }
 const checked=await publicInputs();
 if(mode==='--check-public'){process.stdout.write(JSON.stringify({publicInputsVerified:true,requests:7,requestIndexSha256:indexPin,proposalSha256:manifestPin,privateKeyRead:false,KeyReads:keyReads,signed:false,newSignatureScope:2,reusedPublicScope:5,rootScopeReportSha256:ROOT_SCOPE_SHA,nodeSha256:NODE_SHA,outerSignatureIncluded:false})+'\n');return;}
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
 const report={purpose:'native170-internal-only-signatures',requestIndexSha256:indexPin,proposalSha256:manifestPin,sourceSha256:selfPin,files:written,newSignatures:2,reusedPublicSignatures:5,signaturesVerified:true,privateKeyIncluded:false,published:false,installed:false,programExecuted:false,KeyReads:keyReads,authorizationExternal:true,authorizationRecordSha256:AUTHORIZATION_SHA,rootScopeReportSha256:ROOT_SCOPE_SHA,nodeSha256:NODE_SHA,feedPublicationForbidden:true,formalInstallForbidden:true,outerSignatureNotIncluded:true,authorizationScope:'Current delivery delegation and exact Root repair scope; only policy and worker20; no feed/formal install/outer signature'};
 await fs.writeFile(REPORT,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});process.stdout.write(JSON.stringify({signed:true,newSignatures:2,reusedPublicSignatures:5,report:REPORT,published:false,installed:false})+'\n');
}
main().catch(error=>{process.stderr.write('Signing step stopped: '+error.message+'\n');process.exitCode=1;});

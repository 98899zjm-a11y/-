'use strict';
// SOURCE TEMPLATE: no mode is executable until exact a12 public payload pins are newly Root-bound.
// Authority is the current user delivery delegation record, not historical a10 digest approval.
// check is read-only public verification; sign-approved signs only four exact a12 payloads under the current delegation and reuses three old public envelopes.
const fs0=require('node:fs'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const ROOT='E:\\codex\\2026-10-15\\work\\xjy-v16-deep-audit',PROPOSAL=path.join(ROOT,'release-work/native170-package-closure-a12-candidate-a2/proposal');
const ISSUER='E:\\codex\\2026-10-13\\work\\xjy-web-stage1',KEY=path.join(ISSUER,'config/release-signing/issuer-private.pem');
const OUT=path.join(ROOT,'release-work/native170-package-closure-a12-candidate-a2/approvals'),REPORT=path.join(ROOT,'reports/native170-internal-signatures-a12.json');
const PUBLISHER='6e8b9cadb59aeb53f30d41f4471f70f644f0dfc7376ffb9d8a4c62defb98458c';
const PINS=Object.freeze({
 'source-1.6.0.catalog':'907ee7af50f0bb88d16136ffb8e04f5ddc09e1be6f4821c57c6e9466fcf632f5',
 'source-1.6.1.catalog':'861cf1f8e31b958a95a06886fae38f8983afd0191eddb64bf3bc39e06ff52025',
 'source-1.6.2.catalog':'59114d6e72154df1e9ad3aacec757dc4a50067512db3f24cae749d0833232e1e',
 'resource.catalog':'UNBOUND',
 'target.catalog':'UNBOUND',
 'source-policy':'UNBOUND',
 'worker.catalog':'UNBOUND'
});
const PROPOSAL_SHA='UNBOUND',SIGN_REQUESTS_SHA='UNBOUND';
const APPROVED_PAYLOADS=Object.freeze({
 'resource.catalog':Object.freeze({field:'catalog',sequence:17,size:0}),
 'target.catalog':Object.freeze({field:'catalog',sequence:19,size:0}),
 'source-policy':Object.freeze({field:'policy',sequence:null,size:0}),
 'worker.catalog':Object.freeze({field:'catalog',sequence:19,size:0})
});
const AUTHORIZATION_RECORD=path.join(ROOT,'reports/2026-10-20-autonomous-delivery-user-authorization.md'),AUTHORIZATION_SHA='7dfc073888846668db2be629a35a23a6db8a52fbcfbb9b934a67b4579cbbc9e0';
function bindingsReady(){const valid=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);assert(valid(PROPOSAL_SHA)&&valid(SIGN_REQUESTS_SHA)&&Object.entries(APPROVED_PAYLOADS).every(([id,s])=>valid(PINS[id])&&Number.isSafeInteger(s.size)&&s.size>0),'A12_TEMPLATE_UNBOUND: exact proposal/index/four payload SHA+length required before any key access');}
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function source(file,pin){const bytes=fs0.readFileSync(file);assert.equal(sha(bytes),pin,'fixed source changed');}
async function main(){
 bindingsReady(); // First operation: standard-library imports only above; no filesystem/key input before this gate.
 assert.equal(path.resolve(__dirname,'..').toLowerCase(),ROOT.toLowerCase());assert.equal(process.platform,'win32');
 const [mode,selfPin,indexPin,manifestPin,authorization,...extra]=process.argv.slice(2);
 assert(['check','sign-approved'].includes(mode)&&extra.length===0,'explicit bounded action required');
 for(const pin of [selfPin,indexPin,manifestPin])assert.match(pin||'',/^[a-f0-9]{64}$/);
 assert.equal(indexPin,SIGN_REQUESTS_SHA,'only this exact a12 request index');
 assert.equal(manifestPin,PROPOSAL_SHA,'only this exact a12 proposal');
 if(mode==='sign-approved')assert.equal(authorization,'--authorized-a12-four-internal-under-delegation');else assert.equal(authorization,undefined);
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
  assert.equal(index.round,'a12');assert.equal(index.signed,false);assert.equal(index.requests.length,7);assert.equal(manifest.round,'a12');
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
   const isNew=['resource.catalog','target.catalog','source-policy','worker.catalog'].includes(r.id);assert.equal(r.independentApprovalRequired,isNew);if(isNew){const fixed=APPROVED_PAYLOADS[r.id];assert.equal(r.field,fixed.field);assert.equal(r.size,fixed.size,'fixed exact payload length');}
   const raw=await read(path.join(PROPOSAL,r.path));assert.equal(raw.length,r.size);assert.equal(sha(raw),PINS[r.id]);assert.equal(r.payloadSha256,PINS[r.id]);
   const value=JSON.parse(raw);if(field==='catalog'){assert.equal(value.app,'xjy-jewelry-offline');assert.equal(value.platform,'win32');assert.equal(value.arch,'x64');assert(Date.parse(value.expiresAt)>Date.now());if(isNew)assert.equal(value.sequence,APPROVED_PAYLOADS[r.id].sequence);}
   if(!isNew){const bytes=await read(path.join(ROOT,'release-work/native170-bundle-approvals-a4',r.expectedEnvelopeFile));const old=JSON.parse(bytes);assert.deepEqual(Object.keys(old).sort(),[field,'signature'].sort());assert.equal(old[field],raw.toString('utf8'));assert(crypto.verify(null,raw,key,Buffer.from(old.signature,'base64')));reusable.push({name:r.expectedEnvelopeFile,bytes,payloadSha256:PINS[r.id],reused:true});}
   if(r.id==='source-policy'){assert.equal(value.purpose,'xjy-repeat-program-patch');assert.equal(value.targetVersion,'1.7.0');assert.equal(value.catalogSha256,PINS['resource.catalog']);assert.deepEqual(value.sourcePrograms.map(x=>x.version).sort(),['1.6.0','1.6.1','1.6.2']);}requests.push({...r,raw,value});
  }
  assert.equal(reusable.length,3);assert.equal(requests.filter(r=>r.independentApprovalRequired===true).length,4);return{key,requests,reusable,treeSha256:actualTree.sha256};
 }
 const checked=await publicInputs();
 if(mode==='check'){process.stdout.write(JSON.stringify({publicInputsVerified:true,requests:7,requestIndexSha256:indexPin,proposalSha256:manifestPin,privateKeyRead:false,signed:false,newSignatureScope:4,reusedPublicScope:3})+'\n');return;}
 await absent(OUT);await absent(REPORT);
 // All public checks precede the first private-key access. This fixed path is
 // not passed by CLI, copied to Guest, printed, or used for another payload.
 const opened=await u.openChecked(fs,KEY,'r',{root:ISSUER});let privateKey,keyBytes;const envelopes=[...checked.reusable];
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
 const report={purpose:'native170-internal-only-signatures',requestIndexSha256:indexPin,proposalSha256:manifestPin,sourceSha256:selfPin,files:written,newSignatures:4,reusedPublicSignatures:3,signaturesVerified:true,privateKeyIncluded:false,published:false,installed:false,programExecuted:false,authorizationExternal:true,authorizationRecordSha256:AUTHORIZATION_SHA,authorizationScope:'Current full-delivery delegation; only exact four a12 internal payloads; no publication/install/outer signature'};
 await fs.writeFile(REPORT,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});process.stdout.write(JSON.stringify({signed:true,newSignatures:4,reusedPublicSignatures:3,report:REPORT,published:false,installed:false})+'\n');
}
main().catch(error=>{process.stderr.write('Signing step stopped: '+error.message+'\n');process.exitCode=1;});

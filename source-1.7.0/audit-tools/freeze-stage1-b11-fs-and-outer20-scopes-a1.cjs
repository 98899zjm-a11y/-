'use strict';
// Root-only public metadata scopes. No private-key, product, database or Guest access.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const W='E:/codex/2026-10-15/work/xjy-v16-deep-audit',hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function read(rel,pin){const p=path.join(W,rel);for(let at=p;;at=path.dirname(at)){assert(!fs.lstatSync(at).isSymbolicLink());assert.equal(fs.realpathSync.native(at).toLowerCase(),path.resolve(at).toLowerCase());if(at===path.dirname(at))break;}const s=fs.statSync(p);assert(s.isFile()&&s.nlink===1);const b=fs.readFileSync(p);if(pin)assert.equal(hash(b),pin);return b;}
function put(rel,v){const b=Buffer.from(JSON.stringify(v,null,2)+'\n'),p=path.join(W,rel);const fd=fs.openSync(p,'wx',0o600);try{fs.writeFileSync(fd,b);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}assert(fs.readFileSync(p).equals(b));console.log(JSON.stringify({file:rel,size:b.length,sha256:hash(b)}));}
assert.equal(hash(read('reports/2026-10-20-autonomous-delivery-user-authorization.md')),'7dfc073888846668db2be629a35a23a6db8a52fbcfbb9b934a67b4579cbbc9e0');
const prefix='release-work/native150-original-api-initializer-b11-physical-fs-a3/';
read(prefix+'initialize-genuine150-original-api.cjs','c38fd6e4959db48dabd574216b433ab9027a6bc903f9f7221588f20956ff0d3a');
read(prefix+'launch-genuine150-api-fixture.cjs','bde590926f5e22b5d6467130d5ad364ec1286505d65d0a5effc6d7babb24778a');
const s=JSON.parse(read('reports/native150-b11-root-fictional-api-data-scope-a4.json','33e707f95950ce8564ca71f48e8b2c077ad974fa6d3c0d0aa6cb75d55f3c3358'));
s.initializerSha256='c38fd6e4959db48dabd574216b433ab9027a6bc903f9f7221588f20956ff0d3a';s.launcherSha256='bde590926f5e22b5d6467130d5ad364ec1286505d65d0a5effc6d7babb24778a';
s.sourceCorrection='Actual02700c33 readonly original Electron diagnostic exit0 proves node:fs virtual145 vs original-fs physical73. Initializer changes only local fs import, launcher only initializer pin. Global ASAR require, exact73 hashes, no-existing-data, live owner, ACL and original business API checks unchanged. Both earlier failures preserved. New UUID required.';
s.actualReadonlyDiagnosticRun='02700c33-9d30-4855-8bd8-6e6b37a9522c';
put('reports/native150-b11-root-fictional-api-data-scope-a5.json',s);
const pub='release-work/native170-source19-target20-candidate-a1/native-publication/',payload=read(pub+'native-manifest-payload.json','4f4879899c928411e4388956943cafad3918c85a31a809b45e3ac66d25a4842b'),request=read(pub+'signing-request.json'),r=JSON.parse(request);
assert.equal(payload.length,757289);assert.equal(r.payloadSha256,hash(payload));assert.equal(r.sequence,20);
put('reports/native170-source19-target20-root-outer-signing-scope-a1.json',{
 schemaVersion:1,purpose:'native170-source19-target20-single-outer-internal-signing',approved:true,
 authorityRecordSha256:'7dfc073888846668db2be629a35a23a6db8a52fbcfbb9b934a67b4579cbbc9e0',
 rawPayloadSha256:hash(payload),rawPayloadBytes:payload.length,requestSha256:hash(request),
 archiveSha256:r.archive.sha256,archiveBytes:r.archive.size,assemblySha256:r.assemblySha256,bindingSha256:r.bindingSha256,preparationToolSha256:r.preparationToolSha256,sequence:20,
 targetCatalogSha256:r.fullTargetCatalogSha256,resourceCatalogSha256:r.internalVerification.resourceCatalogSha256,
 oneTargetInternalSignatureReportSha256:'a22d8eaebf1f321ba5d72de0c4b4e3a3bd075d3875c05f9736b260f78ae65d99',
 notHistoricalDigestClick:true,internalSource19Target20CandidateOnly:true,noFormalInstall:true,noFeedPublication:true,noArchiveModification:true,noPrivateKeyCopy:true,noOtherPayloadSigning:true,
 authorizationBasis:'Current user autonomous first-stage delivery delegation; this new exact scope is not a historical digest click.',
 actualOuterPreparation:'Root independent ZIP3293 CRC/SHA scan exit0; actual seven internal signatures independently verified. New outer only; no runtime or UI acceptance claim.',
 fullDeepSeekReview:'PENDING',formalHostUnchanged:true
});

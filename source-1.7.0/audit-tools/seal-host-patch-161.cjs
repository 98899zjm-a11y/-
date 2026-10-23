'use strict';
// Root-only signed internal host artifact. Does not install or open databases.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const W=path.resolve(__dirname,'..'),R='E:\\codex\\2026-10-13\\work\\xjy-web-stage1',u=require('../project/desktop/employee-update-cache.cjs'),core=require('../delivery-tools/initial-patch-core.cjs'),build=require('../stage1/build-initial-patch.cjs');
const PIN='6e8b9cadb59aeb53f30d41f4471f70f644f0dfc7376ffb9d8a4c62defb98458c';
const sha=u.digest;
async function put(file,value){await u.assertPath(fs,path.dirname(file),{directory:true,root:W});const f=await u.openChecked(fs,file,'wx+',{missing:true,root:W});try{await u.writeExactly(f.handle,0,Buffer.from(JSON.stringify(value,null,2)+'\n'));await f.handle.sync();}finally{await f.handle.close();}}
async function main(){
 if(W.toLowerCase()!=='e:\\codex\\2026-10-15\\work\\xjy-v16-deep-audit')throw Error('Fixed isolated build workspace required');
 const feed=JSON.parse(await u.readSmall(fs,path.join(W,'reports/release-161-signed-feed-a1.json'),1048576)),old=JSON.parse(await u.readSmall(fs,path.join(W,'baseline/release-manifest-v16.json'),2097152));
 if(!feed.signed||feed.installed||feed.catalogSha256!=='b39a6fda20b038149601177f5af03849efb820548ce15076b87dc8713b726881'||feed.publisherPublicKeySha256!==PIN)throw Error('Root signed 1.6.1 feed required');
 const source=old.files.find(x=>x.path==='resources/app.asar');if(source?.sha256!=='ea677d9ea14583a01161ac9b27eba2e0d490ab28d1cb24ebbff42c7fa7afc9ef')throw Error('Frozen actual 1.6.0 source ASAR required');
 const engine={size:246302720,sha256:'db3ad2066a55546f9b6737da3c7f011370e4856fb36888055b544d45653e4f40',electronRunAsNode:true,nodeSqliteBackup:true};
 const preparation=await build.prepareInitialPatch({upgradeMode:'repeat',resourceRoot:feed.resourceRoot,catalogEnvelopeFile:path.join(feed.directory,'catalog.json'),publicKeyFile:path.join(feed.directory,'publisher-public.pem'),outputDir:path.join(W,'release-work/initial-161-host-preparation-a1'),engine,sourcePrograms:[{version:'1.6.0',main:'release-entry.cjs',asarSize:source.size,asarSha256:source.sha256}]});
 const publicBytes=await u.readSmall(fs,path.join(R,'config/release-signing/issuer-public.pem'),4096),publicKey=crypto.createPublicKey(publicBytes);if(sha(publicKey.export({type:'spki',format:'der'}))!==PIN)throw Error('Original publisher pin differs');
 const keyFile=path.join(R,'config/release-signing/issuer-private.pem');await u.assertPath(fs,keyFile,{root:R});const bytes=await u.readSmall(fs,keyFile,4096);let privateKey;try{privateKey=crypto.createPrivateKey(bytes);}finally{bytes.fill(0);}if(sha(crypto.createPublicKey(privateKey).export({type:'spki',format:'der'}))!==PIN)throw Error('Original key pair differs');
 const raw=JSON.stringify(preparation.sourcePolicyTemplate),envelope={policy:raw,signature:crypto.sign(null,Buffer.from(raw),privateKey).toString('base64')};core.verifySourcePolicy(envelope,publicKey,{upgradeMode:'repeat'});
 const policyFile=path.join(W,'release-work/initial-161-host-policy-a1.json');await put(policyFile,envelope);await core.mkdirs(fs,W,'release');
 const sealed=await build.sealInitialPatch({upgradeMode:'repeat',preparation,sourcePolicyEnvelopeFile:policyFile,outputDir:path.join(W,'release-work/initial-161-host-sealed-a1'),archiveFile:path.join(W,'release/initial-161-host-internal.zip')});
 if(sealed.approvalTemplate.purpose!==core.REPEAT_PURPOSE)throw Error('Repeat approval must retain repeat purpose');
 const result={purpose:'Root signed internal 1.6.1 host repeat patch',programVersion:'1.6.1',signed:true,published:false,installed:false,internalOperatorOnly:true,employeePublicFeedSeparate:true,privateKeyIncluded:false,...sealed};
 await put(path.join(W,'reports/release-161-host-seal-a1.json'),result);console.log(JSON.stringify({directory:sealed.directory,treeSha256:sealed.treeSha256,artifactSha256:sealed.artifactSha256,artifactSize:sealed.artifactSize,sourcePolicySha256:sha(Buffer.from(raw)),installed:false}));
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});

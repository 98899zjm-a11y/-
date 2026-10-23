'use strict';
// Root-only data packaging/signing. No product launch, DB or deployment.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const W=path.resolve(__dirname,'..'),R='E:\\codex\\2026-10-13\\work\\xjy-web-stage1';
const u=require('../project/desktop/employee-update-cache.cjs'),core=require('../delivery-tools/initial-patch-core.cjs'),build=require('../stage1/build-initial-patch.cjs');
const PIN='6e8b9cadb59aeb53f30d41f4471f70f644f0dfc7376ffb9d8a4c62defb98458c';
const MANIFEST_SHA='e1ff037d5fdb819561719c44487455c676fb90f8e8c18ff54509fbe155828095';
const EXPORT=path.join(W,'sandbox/results/release-161-artifact-a1'),CLEAN=path.join(W,'release-work/initial-161-resource-input-a1'),FEED=path.join(W,'release-work/initial-161-feed-a1');
function requireTrue(value,message){if(!value)throw Error(message);}
async function create(file,bytes){await u.assertPath(fs,path.dirname(file),{directory:true,root:W});const out=await u.openChecked(fs,file,'wx+',{missing:true,root:W});try{await u.writeExactly(out.handle,0,bytes);await out.handle.sync();await u.assertHandle(fs,out,{snapshot:false,root:W});}finally{await out.handle.close();}}
async function main(){
 requireTrue(process.platform==='win32'&&W.toLowerCase()==='e:\\codex\\2026-10-15\\work\\xjy-v16-deep-audit','Fixed Root signing workspace required');
 const raw=await u.readSmall(fs,path.join(EXPORT,'release-manifest.json'),2097152);requireTrue(u.digest(raw)===MANIFEST_SHA,'Root-reviewed resource manifest changed');const manifest=JSON.parse(raw);
 requireTrue(manifest.programVersion==='1.6.1'&&manifest.resourcesOnly===true&&manifest.fileCount===1007&&manifest.asar.sha256==='7e4b04ef51c741f7da66da7e55cd5a280b792f32cd0a0fe8d19606f0996de07d'&&manifest.asar.allEntriesExtracted===true,'Actual 1.6.1 sealing evidence required');
 const old=JSON.parse(await u.readSmall(fs,path.join(W,'baseline/release-manifest-v16.json'),2097152));
 requireTrue(old.programVersion==='1.6.0'&&old.publicPins.publisherPublicKeySha256===PIN&&JSON.stringify([...old.publicPins.allowedFiles].sort())===JSON.stringify(manifest.files.map(x=>x.path).sort()),'1.6.0 installed updater filename/public-key compatibility required');
 await core.mkdirs(fs,W,'release-work');await fs.mkdir(CLEAN);await fs.mkdir(FEED);await u.assertPath(fs,CLEAN,{directory:true,root:W});await u.assertPath(fs,FEED,{directory:true,root:W});
 for(const item of manifest.files){requireTrue(require('../project/desktop/employee-update-installer.cjs').programPath(item.path),'Program resource scope required');const dest=path.join(CLEAN,...item.path.split('/'));await core.mkdirs(fs,CLEAN,item.path.split('/').slice(0,-1).join('/'));await core.copy(fs,path.join(EXPORT,...item.path.split('/')),dest,item,EXPORT,CLEAN);}
 const tree=await core.inspectArtifactTree({artifactDir:CLEAN}),expected=new Map(manifest.files.map(x=>[x.path,x]));requireTrue(tree.files.length===expected.size&&tree.files.every(x=>expected.get(x.path)?.size===x.size&&expected.get(x.path)?.sha256===x.sha256),'Clean signed-resource tree differs from sealed manifest');
 const archive=await build.writeStoredZip({artifactDir:CLEAN,archiveFile:path.join(FEED,'package.zip')});
 const publicBytes=await u.readSmall(fs,path.join(R,'config/release-signing/issuer-public.pem'),4096),publicKey=crypto.createPublicKey(publicBytes);requireTrue(publicKey.asymmetricKeyType==='ed25519'&&u.digest(publicKey.export({type:'spki',format:'der'}))===PIN,'Original publisher pin required');
 const privateFile=path.join(R,'config/release-signing/issuer-private.pem');await u.assertPath(fs,privateFile,{root:R});const privateBytes=await u.readSmall(fs,privateFile,4096);let privateKey;try{privateKey=crypto.createPrivateKey(privateBytes);}finally{privateBytes.fill(0);}requireTrue(u.digest(crypto.createPublicKey(privateKey).export({type:'spki',format:'der'}))===PIN,'Original signing pair differs');
 const now=Date.now(),catalog={schemaVersion:1,app:'xjy-jewelry-offline',channel:'stable',version:'1.6.1',sourceVersions:['1.6.0','1.6.1'],platform:'win32',arch:'x64',sequence:3,publishedAt:new Date(now).toISOString(),expiresAt:new Date(now+90*86400000).toISOString(),archive:{size:archive.size,sha256:archive.sha256},files:manifest.files};
 const text=JSON.stringify(catalog),envelope={catalog:text,signature:crypto.sign(null,Buffer.from(text),privateKey).toString('base64')};
 for(const currentVersion of ['1.6.0','1.6.1'])u.verifySignedCatalog(envelope,u.createTrustedUpdatePolicy({trustedPublicKey:publicKey,allowedFiles:old.publicPins.allowedFiles,currentVersion,platform:'win32',arch:'x64'}));
 await create(path.join(FEED,'catalog.json'),Buffer.from(JSON.stringify(envelope)));await create(path.join(FEED,'publisher-public.pem'),publicBytes);
 const proof={purpose:'root-signed-161-employee-resource-feed',version:'1.6.1',directory:FEED,resourceRoot:CLEAN,manifestSha256:MANIFEST_SHA,catalogSha256:u.digest(Buffer.from(text)),archive:catalog.archive,fileCount:manifest.files.length,publisherPublicKeySha256:PIN,sequence:catalog.sequence,old160FileScopeVerified:true,signatureVerified:true,signed:true,published:false,installed:false,privateKeyIncluded:false,financeCsvBinaryUpdateIncluded:false};
 await create(path.join(W,'reports/release-161-signed-feed-a1.json'),Buffer.from(JSON.stringify(proof,null,2)+'\n'));console.log(JSON.stringify(proof));
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});

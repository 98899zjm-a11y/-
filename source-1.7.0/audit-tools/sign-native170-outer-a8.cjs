'use strict';
// One exact, separately authorized detached payload. No publishing/installing.
const fs0=require('node:fs'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const ROOT='E:/codex/2026-10-15/work/xjy-v16-deep-audit',ISSUER='E:/codex/2026-10-13/work/xjy-web-stage1';
const DIR=path.join(ROOT,'release-work/native170-package-closure-a8/native-publication'),ZIP=path.join(ROOT,'release-work/native170-package-closure-a8/build/native-package.zip');
const KEY=path.join(ISSUER,'config/release-signing/issuer-private.pem'),OUTPUT=path.join(DIR,'native-manifest.json'),REPORT=path.join(ROOT,'reports/native170-outer-signature-a8.json');
const PUBLISHER='6e8b9cadb59aeb53f30d41f4471f70f644f0dfc7376ffb9d8a4c62defb98458c',PAYLOAD='05cb3840b08c554b21a9e91c38a6a569f8c0afe8cfa7ca47ef6b44a51235d4a7',ARCHIVE='2eef0b911f19bbc41e86435e243480debbf6d952da14e9e55fdf53370668d706';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
async function main(){
 assert.equal(path.resolve(__dirname,'..').toLowerCase(),path.resolve(ROOT).toLowerCase());assert.equal(process.platform,'win32');
 const [mode,selfPin,authorization,...extra]=process.argv.slice(2);assert.equal(extra.length,0);assert.ok(['check','sign-approved'].includes(mode));assert.match(selfPin||'',/^[a-f0-9]{64}$/);assert.equal(sha(fs0.readFileSync(__filename)),selfPin);
 if(mode==='sign-approved')assert.equal(authorization,'--authorized-a8-one-outer-payload');else assert.equal(authorization,undefined);
 assert.equal(sha(fs0.readFileSync(path.join(ROOT,'project/desktop/employee-update-cache.cjs'))),'5cb70079bf161a002a2701694e4774c2a11bf8d54efc6674ccb5c7b2c6729815');
 const u=require('../project/desktop/employee-update-cache.cjs');
 async function absent(file){await u.assertPath(fs,path.dirname(file),{directory:true,root:ROOT});try{await fs.lstat(file);throw Error('CreateNew output already exists');}catch(e){if(e.code!=='ENOENT')throw e;}}
 async function hashZip(){const opened=await u.openChecked(fs,ZIP,'r',{root:ROOT});try{const stat=await u.assertHandle(fs,opened,{root:ROOT});assert.equal(stat.size,781430724n);assert.equal(await u.hashHandle(opened.handle,Number(stat.size)),ARCHIVE);await u.assertHandle(fs,opened,{root:ROOT});}finally{await opened.handle.close();}}
 async function inputs(){
  const bytes=await u.readSmall(fs,path.join(DIR,'native-manifest-payload.json'),2097152);assert.equal(bytes.length,757289);assert.equal(sha(bytes),PAYLOAD);
  const r=JSON.parse(await u.readSmall(fs,path.join(DIR,'signing-request.json'),65536)),m=JSON.parse(bytes);assert.equal(r.field,'manifest');assert.equal(r.payloadSha256,PAYLOAD);assert.equal(r.payloadSize,bytes.length);
  assert.equal(m.purpose,'xjy-native-employee-update-v1');assert.equal(m.role,'employee');assert.equal(m.sequence,16);assert.equal(m.targetVersion,'1.7.0');assert.equal(m.engineVersion,'44.9.0');assert.equal(m.files.length,3293);assert.equal(m.archive.sha256,ARCHIVE);assert.equal(m.archive.size,781430724);assert.equal(m.fullTargetCatalogSha256,'76276a45d5e714f088260593dba9b613bcb9e95cdcfe34a86c36eb2335f3aed5');assert.equal(m.bindingSha256,'253c4a7e4f17a18c1745e6d70b55def74fc4b237bf4faea1fb921792ce703b05');assert.ok(Date.parse(m.expiresAt)>Date.now());
  const pem=await u.readSmall(fs,path.join(ROOT,'release-work/native170-package-closure-a8/proposal/worker-draft/publisher-public.pem'),4096),key=crypto.createPublicKey(pem);assert.equal(sha(key.export({type:'spki',format:'der'})),PUBLISHER);await hashZip();return{bytes,key};
 }
 const checked=await inputs();if(mode==='check'){console.log(JSON.stringify({verified:true,payloadSha256:PAYLOAD,archiveSha256:ARCHIVE,privateKeyRead:false,signed:false}));return;}
 await absent(OUTPUT);await absent(REPORT);const opened=await u.openChecked(fs,KEY,'r',{root:ISSUER});let keyBytes,privateKey,envelope;
 try{const stat=await u.assertHandle(fs,opened,{root:ISSUER});assert.ok(stat.size>0n&&stat.size<=4096n);keyBytes=await u.readExactly(opened.handle,0,Number(stat.size));try{privateKey=crypto.createPrivateKey(keyBytes);}finally{keyBytes.fill(0);keyBytes=null;}
  assert.equal(privateKey.asymmetricKeyType,'ed25519');assert.equal(sha(crypto.createPublicKey(privateKey).export({type:'spki',format:'der'})),PUBLISHER);
  const signature=crypto.sign(null,checked.bytes,privateKey).toString('base64');assert.ok(crypto.verify(null,checked.bytes,checked.key,Buffer.from(signature,'base64')));envelope=Buffer.from(JSON.stringify({manifest:checked.bytes.toString('utf8'),signature}));privateKey=null;await u.assertHandle(fs,opened,{root:ISSUER});await inputs();
 }finally{if(keyBytes)keyBytes.fill(0);privateKey=null;await opened.handle.close();}
 await absent(OUTPUT);const out=await u.openChecked(fs,OUTPUT,'wx+',{missing:true,root:DIR});try{await u.writeExactly(out.handle,0,envelope);await out.handle.sync();await u.assertHandle(fs,out,{snapshot:false,root:DIR});}finally{await out.handle.close();}
 assert.equal((await u.readSmall(fs,OUTPUT,2097152)).equals(envelope),true);const readback=JSON.parse(envelope);assert.ok(crypto.verify(null,Buffer.from(readback.manifest),checked.key,Buffer.from(readback.signature,'base64')));
 const report={signed:true,newSignatures:1,payloadSha256:PAYLOAD,archiveSha256:ARCHIVE,envelopeSha256:sha(envelope),sourceSha256:selfPin,privateKeyIncluded:false,zipModified:false,published:false,installed:false};await fs.writeFile(REPORT,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(report));
}
main().catch(error=>{console.error('Outer signing stopped: '+error.message);process.exitCode=1;});

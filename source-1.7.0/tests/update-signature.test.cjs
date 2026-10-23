'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
test('patch trust is pinned outside the package and rejects unsigned, tampered and substituted keys',()=>{
 const{verifyManifest}=require('../stage1/update-trust.cjs'),pair=crypto.generateKeyPairSync('ed25519');
 const manifest={schema:1,application:'xjy-jewelry',version:'1.5.1',fromVersions:['1.5.0','1.4.0'],files:[{path:'resources/app.asar',size:4,sha256:crypto.createHash('sha256').update('fake').digest('hex')}]};
 const bytes=Buffer.from(JSON.stringify(manifest)),signature=crypto.sign(null,bytes,pair.privateKey).toString('base64url'),trusted=new Map([['test-only',pair.publicKey]]);
 assert.equal(verifyManifest({bytes,signature,keyId:'test-only'},trusted).version,'1.5.1');
 assert.throws(()=>verifyManifest({bytes,keyId:'test-only'},trusted),/signature|trust/);
 assert.throws(()=>verifyManifest({bytes:Buffer.from(JSON.stringify({...manifest,version:'9.9.9'})),signature,keyId:'test-only'},trusted),/signature|trust/);
 const other=crypto.generateKeyPairSync('ed25519');assert.throws(()=>verifyManifest({bytes,signature:crypto.sign(null,bytes,other.privateKey).toString('base64url'),keyId:'test-only',publicKey:other.publicKey},trusted),/signature|trust/);
 const bad=Buffer.from(JSON.stringify({...manifest,files:[{...manifest.files[0],path:'../data/jewelry.sqlite'}]}));assert.throws(()=>verifyManifest({bytes:bad,signature:crypto.sign(null,bad,pair.privateKey).toString('base64url'),keyId:'test-only'},trusted),/path/);
});

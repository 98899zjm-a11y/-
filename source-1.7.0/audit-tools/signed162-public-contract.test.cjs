'use strict';
// Actual-Guest-only, public signatures/protocol. Reads exactly three public
// files. No issuer key, signing, install, approval, DB, PS, EXE or network use.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'..'),sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
if(process.platform!=='win32'||ROOT.toLowerCase()!=='c:\\xjy-work\\xjy-web-stage1')throw Error('Fixed actual Guest required');
const GUARD=path.join(ROOT,'stage1/guest-candidate-cdp.cjs');
if(sha(fs.readFileSync(GUARD))!=='59840b638d8797fb55241616cd0b8e4098075a76834a201b0e93c1a748f1bb32')throw Error('Actual Guest guard changed');
require(GUARD).actualGuard();
const test=require('node:test'),assert=require('node:assert/strict'),io=require('node:fs/promises');
const CACHE=path.join(ROOT,'project/desktop/employee-update-cache.cjs'),CORE=path.join(ROOT,'delivery-tools/initial-patch-core.cjs');
for(const [file,pin]of [[CACHE,'5cb70079bf161a002a2701694e4774c2a11bf8d54efc6674ccb5c7b2c6729815'],[CORE,'0f9de31c8ad8ec7e1b870a92d025909f4606363801a31ee3582b903c5704bbce'],[path.join(ROOT,'project/desktop/employee-update-installer.cjs'),'96ba3df08a0f706e599da7d452374b1f894d401c0a6ff605fc01255d01445bd0']])assert.equal(sha(fs.readFileSync(file)),pin,'Frozen protocol dependency changed');
const u=require(CACHE),core=require(CORE),INPUT='C:/xjy-input/signed162-public-a1';
const FILE_PINS=Object.freeze({'catalog.json':'1b40a19c9ba5ba9f5fded9123173682246a12d0982287fc4c34db1ce68db3fc8','publisher-public.pem':'bc6c3d2b42871e42d3eb91371034b410d507a228eeccb1d714acca60e8141b30','source-policy-envelope.json':'0b4e2648ca69487a0c05cc595f0927282dc935c25806d942ff706d0da4111a49'});
const CATALOG_SHA='e4e294fa7e56641636e75c6c5417ff10dafaf4dae41664e858c7e667793d1ac5',POLICY_SHA='40abc3aeb5fb954c3aa52f4d443f07a00957476b1a51c0ea09ece9e73f7e8b17',SPKI='6e8b9cadb59aeb53f30d41f4471f70f644f0dfc7376ffb9d8a4c62defb98458c';
const ENGINE={size:246302720,sha256:'db3ad2066a55546f9b6737da3c7f011370e4856fb36888055b544d45653e4f40',electronRunAsNode:true,nodeSqliteBackup:true};
const SOURCE_PROGRAMS=[{version:'1.6.1',main:'release-entry.cjs',asarSize:12541824,asarSha256:'7e4b04ef51c741f7da66da7e55cd5a280b792f32cd0a0fe8d19606f0996de07d'},{version:'1.6.2',main:'release-entry.cjs',asarSize:12569953,asarSha256:'02a3dc5128203889fa88205020c39970f08305b4496e64507ca5ec5eab7f7568'}];
const TOOLS=[
 {path:'delivery-tools/initial-patch-core.cjs',size:40767,sha256:'0f9de31c8ad8ec7e1b870a92d025909f4606363801a31ee3582b903c5704bbce'},
 {path:'delivery-tools/initial-patch-backup.cjs',size:33497,sha256:'f2d7262eae5ba3b3048e42753f96e49cd53746940ea22bbe32b0b1f93f3de8e0'},
 {path:'delivery-tools/initial-patch-entry.cjs',size:21710,sha256:'4c0008c6f070c22255f3a2819ac82e9be774fbaf631030bb414c95bbcac6b161'},
 {path:'delivery-tools/Initial-Full-Upgrade.ps1',size:14600,sha256:'85548e5843c6bb074949602019fa7569acd80344d02811fd275b260cf82365ac'},
 {path:'delivery-tools/Initial-Path-Guard.ps1',size:2459,sha256:'47b1bfe622460f2d0240702c9757544218c249f1b2be092bf5aecafd6789293e'},
 {path:'delivery-tools/Initial-Source-Lock.ps1',size:2729,sha256:'18c08ffad7cdd87c598692719cdfe5a9cdfef806f79a141fc6bd8a080723beb9'},
 {path:'delivery-tools/initial-source-lease.cjs',size:3713,sha256:'5a6a84eaaae2e10c11c1473a2da8ef6b9ba70f41378094e83054ee67ae7d6ce2'},
 {path:'一键完整升级.cmd',size:200,sha256:'e277a10b691b9d0a102a0c8fd714253e45fb5b7186e5ae8a430a8277d1b970b5'},
 {path:'project/desktop/employee-update-cache.cjs',size:17326,sha256:'5cb70079bf161a002a2701694e4774c2a11bf8d54efc6674ccb5c7b2c6729815'},
 {path:'project/desktop/employee-update-installer.cjs',size:30460,sha256:'96ba3df08a0f706e599da7d452374b1f894d401c0a6ff605fc01255d01445bd0'}
];
const plain=value=>JSON.parse(JSON.stringify(value));
function fields(value,keys){assert(value&&typeof value==='object'&&!Array.isArray(value));assert.deepEqual(Object.keys(value).sort(),keys.slice().sort(),'Exact signed fields required');}
function changedSignature(signature){const bytes=Buffer.from(signature,'base64');assert.equal(bytes.length,64);bytes[0]^=1;return bytes.toString('base64');}
async function readPublic(){
 await u.assertPath(io,INPUT,{directory:true});assert.deepEqual((await io.readdir(INPUT)).sort(),[...Object.keys(FILE_PINS),'manifest.json'].sort(),'Three approved public files and their fixed transport manifest required');
 const transport=await u.readSmall(io,path.join(INPUT,'manifest.json'),16384);assert.equal(sha(transport),'407afaff2d980c2a34d21aab7c106918049808b3430d3e7f0745faef7b9ee339','Public transport manifest changed');const manifest=JSON.parse(transport);assert.equal(manifest.purpose,'original-issuer-162-public-verification-only');assert.equal(manifest.privateKeyIncluded,false);assert.equal(manifest.files.length,3);for(const row of manifest.files){assert.equal(row.sha256,FILE_PINS[row.name]);}const bytes={};
 for(const [name,pin]of Object.entries(FILE_PINS)){const file=path.join(INPUT,name);await u.assertPath(io,file,{root:INPUT});bytes[name]=await u.readSmall(io,file,name.endsWith('.pem')?4096:2097152);assert.equal(sha(bytes[name]),pin,'Fixed public input changed: '+name);}
 return bytes;
}
let original,catalogEnvelope,sourceEnvelope,catalog,sourcePolicy,publicKey;
test.before(async()=>{
 original=await readPublic();const decode=bytes=>new TextDecoder('utf-8',{fatal:true}).decode(bytes);catalogEnvelope=JSON.parse(decode(original['catalog.json']));sourceEnvelope=JSON.parse(decode(original['source-policy-envelope.json']));
 fields(catalogEnvelope,['catalog','signature']);fields(sourceEnvelope,['policy','signature']);assert.equal(sha(Buffer.from(catalogEnvelope.catalog)),CATALOG_SHA);assert.equal(sha(Buffer.from(sourceEnvelope.policy)),POLICY_SHA);catalog=JSON.parse(catalogEnvelope.catalog);sourcePolicy=JSON.parse(sourceEnvelope.policy);
 assert(!original['publisher-public.pem'].toString().includes('PRIVATE KEY'));publicKey=crypto.createPublicKey(original['publisher-public.pem']);assert.equal(publicKey.asymmetricKeyType,'ed25519');assert.equal(sha(publicKey.export({type:'spki',format:'der'})),SPKI);
});
test.after(async()=>{const after=await readPublic();for(const name of Object.keys(FILE_PINS))assert(after[name].equals(original[name]),'Public material changed during contracts');});
function catalogTrust(currentVersion,key=publicKey){return u.createTrustedUpdatePolicy({trustedPublicKey:key,allowedFiles:catalog.files.map(file=>file.path),currentVersion,platform:'win32',arch:'x64'});}

test('S01 fixed real signed metadata binds exact162 ASAR,161/162 source identities, engine and ten tools',()=>{
 fields(catalog,['schemaVersion','app','channel','version','sourceVersions','platform','arch','sequence','publishedAt','expiresAt','archive','files']);
 assert.equal(catalog.schemaVersion,1);assert.equal(catalog.app,'xjy-jewelry-offline');assert.equal(catalog.channel,'stable');assert.equal(catalog.version,'1.6.2');assert.deepEqual(catalog.sourceVersions,['1.6.1','1.6.2']);assert.equal(catalog.platform,'win32');assert.equal(catalog.arch,'x64');assert.equal(catalog.sequence,8);assert.equal(catalog.publishedAt,'2026-10-18T07:46:37.256Z');assert.equal(catalog.expiresAt,'2027-04-16T07:46:37.259Z');assert.deepEqual(catalog.archive,{size:163521368,sha256:'f629a566956b87f6041e8428ee1747d108f7620e7ef4c1f2648b8f9dd57eaea6'});
 assert.equal(catalog.files.length,1007);assert.equal(new Set(catalog.files.map(file=>file.path.toLowerCase())).size,1007);for(const file of catalog.files){fields(file,['path','size','sha256']);assert(u.safeRelative(file.path)&&file.path.startsWith('resources/'));assert(Number.isSafeInteger(file.size)&&file.size>=0);assert.match(file.sha256,/^[a-f0-9]{64}$/);}
 assert.deepEqual(catalog.files.find(file=>file.path==='resources/app.asar'),{path:'resources/app.asar',size:12569953,sha256:'02a3dc5128203889fa88205020c39970f08305b4496e64507ca5ec5eab7f7568'});
 assert.deepEqual(sourcePolicy,{schemaVersion:1,purpose:'xjy-repeat-program-patch',app:'xjy-jewelry-offline',targetVersion:'1.6.2',catalogSha256:CATALOG_SHA,publisherPublicKeySha256:SPKI,executableName:'鑫金源珠宝报价.exe',engine:ENGINE,sourcePrograms:SOURCE_PROGRAMS,tools:TOOLS});
});
test('S02 original issuer catalog verifies for both approved current161 and current162',()=>{
 for(const currentVersion of ['1.6.1','1.6.2'])assert.deepEqual(plain(u.verifySignedCatalog(catalogEnvelope,catalogTrust(currentVersion))),catalog);
});
test('S03 catalog text/signature tampering and unrelated RAM public key are rejected',()=>{
 const trust=catalogTrust('1.6.1');assert.throws(()=>u.verifySignedCatalog({...catalogEnvelope,catalog:catalogEnvelope.catalog+' '},trust),error=>error.code==='BAD_SIGNATURE');
 assert.throws(()=>u.verifySignedCatalog({...catalogEnvelope,signature:changedSignature(catalogEnvelope.signature)},trust),error=>error.code==='BAD_SIGNATURE');
 // Only an unrelated test public key is used; no issuer key is available here.
 const wrong=crypto.generateKeyPairSync('ed25519').publicKey;assert.throws(()=>u.verifySignedCatalog(catalogEnvelope,catalogTrust('1.6.1',wrong)),error=>error.code==='BAD_SIGNATURE');
});
test('S04 signed catalog rejects current160 with the original SOURCE_UNSUPPORTED API code',()=>{
 assert.throws(()=>u.verifySignedCatalog(catalogEnvelope,catalogTrust('1.6.0')),error=>error.code==='SOURCE_UNSUPPORTED');
});
test('S05 original issuer source policy verifies in repeat mode and rejects initial mode',()=>{
 assert.deepEqual(plain(core.verifySourcePolicy(sourceEnvelope,publicKey,{upgradeMode:'repeat'})),sourcePolicy);
 assert.throws(()=>core.verifySourcePolicy(sourceEnvelope,publicKey,{upgradeMode:'initial'}),error=>error.code==='BAD_SOURCE_POLICY');
 assert.throws(()=>core.verifySourcePolicy(sourceEnvelope,publicKey),error=>error.code==='BAD_SOURCE_POLICY');
});
test('S06 source policy text/signature tampering and unrelated RAM public key are rejected',()=>{
 assert.throws(()=>core.verifySourcePolicy({...sourceEnvelope,policy:sourceEnvelope.policy+' '},publicKey,{upgradeMode:'repeat'}),error=>error.code==='BAD_SOURCE_SIGNATURE');
 assert.throws(()=>core.verifySourcePolicy({...sourceEnvelope,signature:changedSignature(sourceEnvelope.signature)},publicKey,{upgradeMode:'repeat'}),error=>error.code==='BAD_SOURCE_SIGNATURE');
 const wrong=crypto.generateKeyPairSync('ed25519').publicKey;assert.throws(()=>core.verifySourcePolicy(sourceEnvelope,wrong,{upgradeMode:'repeat'}),error=>error.code==='BAD_SOURCE_SIGNATURE');
});

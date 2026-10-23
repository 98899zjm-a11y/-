'use strict';
// Original issuer Ed25519 publication signatures, NOT Windows Authenticode.
// Public local artifact only. Full-tree checks hash public program/PE bytes;
// no process/EXE execution, database API, issuer/private key, approval or install.
const fs=require('node:fs'),io=fs.promises,path=require('node:path'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'..'),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
if(process.platform!=='win32'||ROOT.toLowerCase()!=='c:\\xjy-work\\xjy-web-stage1')throw Error('FIXED_ACTUAL_GUEST_REQUIRED');
const test=require('node:test'),assert=require('node:assert/strict');
const SELF_PIN=process.env.XJY_SIGNED162_A3_PUBLIC_LOCAL_TEST_SHA256;
assert.match(SELF_PIN||'',/^[a-f0-9]{64}$/,'PRECONDITION: Root must provide this test source SHA');assert.equal(sha(fs.readFileSync(__filename)),SELF_PIN,'PRECONDITION: test source changed');
const PINS={
 'stage1/guest-candidate-cdp.cjs':'59840b638d8797fb55241616cd0b8e4098075a76834a201b0e93c1a748f1bb32',
 'stage1/sandbox-context.py':'09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249',
 'stage1/validate-sandbox-context.py':'867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207',
 'project/desktop/employee-update-cache.cjs':'5cb70079bf161a002a2701694e4774c2a11bf8d54efc6674ccb5c7b2c6729815',
 'project/desktop/employee-update-installer.cjs':'96ba3df08a0f706e599da7d452374b1f894d401c0a6ff605fc01255d01445bd0',
 'delivery-tools/initial-patch-core.cjs':'0f9de31c8ad8ec7e1b870a92d025909f4606363801a31ee3582b903c5704bbce'
};
for(const [name,pin]of Object.entries(PINS))assert.equal(sha(fs.readFileSync(path.join(ROOT,name))),pin,'PRECONDITION: original source changed: '+name);
const guard=require('../stage1/guest-candidate-cdp.cjs').actualGuard;guard();
const u=require('../project/desktop/employee-update-cache.cjs'),core=require('../delivery-tools/initial-patch-core.cjs');
const ARTIFACT=path.join(ROOT,'runtime/employee162-a3-native-materials-a1/artifact'),NAMESPACE='36fcbe9c-ece1-4be3-af35-309a2ee19e05';
const FILE_PINS={'publisher-public.pem':'bc6c3d2b42871e42d3eb91371034b410d507a228eeccb1d714acca60e8141b30','catalog-envelope.json':'7bf84752606118dde33f26c294aa8ce1be142af99c9e9c63de7f22c036a7262b','source-policy-envelope.json':'db195137d14814c8bba4c541b5b9b185bbcfc4fd1889a703505a72322ea6f75c'};
const SPKI='6e8b9cadb59aeb53f30d41f4471f70f644f0dfc7376ffb9d8a4c62defb98458c',CATALOG='37f7b97d7361c1c13384b8f9e8bf5603dc1064309748dc271ef49acea0e6d888',POLICY='5c4eda1e13020d4a551041e8ba4c8a22fa93cc098819266f3d9f793e59faaf61',TREE='580bc730bdd6e3572dd8a61efd65535ef6d2f8e56a580f488e2ac34c773b4c3c';
const ENGINE={size:246302720,sha256:'db3ad2066a55546f9b6737da3c7f011370e4856fb36888055b544d45653e4f40',electronRunAsNode:true,nodeSqliteBackup:true};
const SOURCE_PROGRAMS=[{version:'1.6.1',main:'release-entry.cjs',asarSize:12541824,asarSha256:'7e4b04ef51c741f7da66da7e55cd5a280b792f32cd0a0fe8d19606f0996de07d'},{version:'1.6.2',main:'release-entry.cjs',asarSize:12570266,asarSha256:'e97ec984734ecfc5dc530ab6f9a8aada2f5da9bb5ad65c97a7c641eeeb3d93a8'}];
const TOOLS=[
 {path:'delivery-tools/initial-patch-core.cjs',size:40767,sha256:'0f9de31c8ad8ec7e1b870a92d025909f4606363801a31ee3582b903c5704bbce'},
 {path:'delivery-tools/initial-patch-backup.cjs',size:33497,sha256:'f2d7262eae5ba3b3048e42753f96e49cd53746940ea22bbe32b0b1f93f3de8e0'},
 {path:'delivery-tools/initial-patch-entry.cjs',size:21710,sha256:'4c0008c6f070c22255f3a2819ac82e9be774fbaf631030bb414c95bbcac6b161'},
 {path:'delivery-tools/Initial-Full-Upgrade.ps1',size:14600,sha256:'8146ff58511478e55361e1ee2aa94b242323ed09f12fc54b3ccb7ff483cbec6c'},
 {path:'delivery-tools/Initial-Path-Guard.ps1',size:2459,sha256:'47b1bfe622460f2d0240702c9757544218c249f1b2be092bf5aecafd6789293e'},
 {path:'delivery-tools/Initial-Source-Lock.ps1',size:2729,sha256:'18c08ffad7cdd87c598692719cdfe5a9cdfef806f79a141fc6bd8a080723beb9'},
 {path:'delivery-tools/initial-source-lease.cjs',size:3713,sha256:'5a6a84eaaae2e10c11c1473a2da8ef6b9ba70f41378094e83054ee67ae7d6ce2'},
 {path:'一键完整升级.cmd',size:200,sha256:'e277a10b691b9d0a102a0c8fd714253e45fb5b7186e5ae8a430a8277d1b970b5'},
 {path:'project/desktop/employee-update-cache.cjs',size:17326,sha256:'5cb70079bf161a002a2701694e4774c2a11bf8d54efc6674ccb5c7b2c6729815'},
 {path:'project/desktop/employee-update-installer.cjs',size:30460,sha256:'96ba3df08a0f706e599da7d452374b1f894d401c0a6ff605fc01255d01445bd0'}
];
const plain=v=>JSON.parse(JSON.stringify(v));
function fields(v,keys){assert(v&&typeof v==='object'&&!Array.isArray(v));assert.deepEqual(Object.keys(v).sort(),keys.slice().sort());}
function flipped(signature){const b=Buffer.from(signature,'base64');assert.equal(b.length,64);b[0]^=1;return b.toString('base64');}
async function publicBytes(){
 try{await u.assertPath(io,ARTIFACT,{directory:true,root:ROOT});const result={};for(const [name,pin]of Object.entries(FILE_PINS)){const file=path.join(ARTIFACT,name);await u.assertPath(io,file,{root:ARTIFACT});const b=await u.readSmall(io,file,name.endsWith('.pem')?4096:2097152);assert.equal(sha(b),pin,'PRECONDITION: public byte pin changed: '+name);result[name]=b;}return result;}
 catch(error){throw new Error('PRECONDITION_FAILED: fixed local a3 public artifact is absent, unsafe, incomplete or changed: '+error.message,{cause:error});}
}
let original,catalogEnvelope,policyEnvelope,catalog,policy,key;
test.before(async()=>{
 guard();assert.equal(JSON.parse(await u.readSmall(io,path.join(ROOT,'isolation-identity.json'),4096)).namespace,NAMESPACE,'PRECONDITION: Root36 namespace');original=await publicBytes();
 catalogEnvelope=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(original['catalog-envelope.json']));policyEnvelope=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(original['source-policy-envelope.json']));fields(catalogEnvelope,['catalog','signature']);fields(policyEnvelope,['policy','signature']);
 assert.equal(sha(Buffer.from(catalogEnvelope.catalog)),CATALOG);assert.equal(sha(Buffer.from(policyEnvelope.policy)),POLICY);catalog=JSON.parse(catalogEnvelope.catalog);policy=JSON.parse(policyEnvelope.policy);key=crypto.createPublicKey(original['publisher-public.pem']);
});
test.after(async()=>{if(original){const after=await publicBytes();for(const name of Object.keys(FILE_PINS))assert(after[name].equals(original[name]),'Public inputs changed during verification');}guard();});
function trust(version){return u.createTrustedUpdatePolicy({trustedPublicKey:key,allowedFiles:catalog.files.map(r=>r.path),currentVersion:version,platform:'win32',arch:'x64'});}

test('S01 fixed original issuer public PEM/DER is Ed25519 publication trust, not Windows Authenticode',()=>{
 assert.equal(original['publisher-public.pem'].length,113);assert(!original['publisher-public.pem'].includes(Buffer.from('PRIVATE KEY')));assert.equal(key.type,'public');assert.equal(key.asymmetricKeyType,'ed25519');assert.equal(sha(key.export({type:'spki',format:'der'})),SPKI);
});
test('S02 real sequence9 catalog verifies for installed161 and162 with exact1007 program resources',()=>{
 fields(catalog,['schemaVersion','app','channel','version','sourceVersions','platform','arch','sequence','publishedAt','expiresAt','archive','files']);assert.equal(catalog.schemaVersion,1);assert.equal(catalog.app,'xjy-jewelry-offline');assert.equal(catalog.channel,'stable');assert.equal(catalog.version,'1.6.2');assert.equal(catalog.platform,'win32');assert.equal(catalog.arch,'x64');assert.equal(catalog.sequence,9);assert.deepEqual(catalog.sourceVersions,['1.6.1','1.6.2']);assert.equal(catalog.publishedAt,'2026-10-19T05:10:00.000Z');assert.equal(catalog.expiresAt,'2027-04-17T05:10:00.000Z');assert.deepEqual(catalog.archive,{size:163521681,sha256:'fb15ac85319044c1ac5bcfc961f2fcd6c7e1c5a65e46090a683d97cd52656859'});
 assert.equal(catalog.files.length,1007);assert.equal(new Set(catalog.files.map(r=>r.path.toLowerCase())).size,1007);const {programPath}=require('../project/desktop/employee-update-installer.cjs');for(const r of catalog.files){fields(r,['path','size','sha256']);assert(programPath(r.path));assert(Number.isSafeInteger(r.size)&&r.size>=0);assert.match(r.sha256,/^[a-f0-9]{64}$/);}
 assert.deepEqual(catalog.files.find(r=>r.path==='resources/app.asar'),{path:'resources/app.asar',size:12570266,sha256:SOURCE_PROGRAMS[1].asarSha256});for(const version of ['1.6.1','1.6.2'])assert.deepEqual(plain(u.verifySignedCatalog(catalogEnvelope,trust(version))),catalog);assert.throws(()=>u.verifySignedCatalog(catalogEnvelope,trust('1.6.0')),e=>e.code==='SOURCE_UNSUPPORTED');
});
test('S03 real original issuer policy verifies only in repeat mode and binds exact161/162 ASARs and ten tools',()=>{
 assert.deepEqual(policy,{schemaVersion:1,purpose:'xjy-repeat-program-patch',app:'xjy-jewelry-offline',targetVersion:'1.6.2',catalogSha256:CATALOG,publisherPublicKeySha256:SPKI,executableName:'鑫金源珠宝报价.exe',engine:ENGINE,sourcePrograms:SOURCE_PROGRAMS,tools:TOOLS});assert.deepEqual(plain(core.verifySourcePolicy(policyEnvelope,key,{upgradeMode:'repeat'})),policy);assert.throws(()=>core.verifySourcePolicy(policyEnvelope,key,{upgradeMode:'initial'}),e=>e.code==='BAD_SOURCE_POLICY');assert.throws(()=>core.verifySourcePolicy(policyEnvelope,key),e=>e.code==='BAD_SOURCE_POLICY');
});
test('S04 fixed local artifact has exactly10 tools,1007 payload resources,3 public metadata and original tree580',async()=>{
 const rows=[...TOOLS,...catalog.files.map(r=>({...r,path:'payload/'+r.path})),...Object.entries(FILE_PINS).map(([name,pin])=>({path:name,size:original[name].length,sha256:pin}))],wanted=new Map(rows.map(r=>[r.path,r]));assert.equal(wanted.size,1020);
 // Reject unknown paths/directories BEFORE hashing files; never inspect an
 // unrelated file dropped into the artifact, including any business database.
 const dirs=new Set(),seen=new Set();for(const name of wanted.keys()){const p=name.split('/');for(let n=1;n<p.length;n++)dirs.add(p.slice(0,n).join('/'));}
 async function names(dir,prefix=''){for(const entry of await io.readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name),relative=prefix+entry.name;if(entry.isDirectory()){assert(dirs.has(relative),'Unexpected artifact directory');await u.assertPath(io,file,{directory:true,root:ARTIFACT});await names(file,relative+'/');}else{assert(wanted.has(relative),'Unexpected artifact file; refusing to read it');await u.assertPath(io,file,{root:ARTIFACT});seen.add(relative);}}}
 await names(ARTIFACT);assert.equal(seen.size,1020,'PRECONDITION: full artifact missing files');const actual=await core.inspectArtifactTree({artifactDir:ARTIFACT});assert.equal(actual.files.length,1020);assert.equal(actual.sha256,TREE);for(const r of actual.files){const expected=wanted.get(r.path);assert(expected);assert.equal(r.size,expected.size);assert.equal(r.sha256,expected.sha256);}guard();
});
test('S05 real catalog text or signature tampering is rejected by the original verifier',()=>{
 assert.throws(()=>u.verifySignedCatalog({...catalogEnvelope,catalog:catalogEnvelope.catalog+' '},trust('1.6.1')),e=>e.code==='BAD_SIGNATURE');assert.throws(()=>u.verifySignedCatalog({...catalogEnvelope,signature:flipped(catalogEnvelope.signature)},trust('1.6.1')),e=>e.code==='BAD_SIGNATURE');
});
test('S06 real source-policy text or signature tampering is rejected by the original core',()=>{
 assert.throws(()=>core.verifySourcePolicy({...policyEnvelope,policy:policyEnvelope.policy+' '},key,{upgradeMode:'repeat'}),e=>e.code==='BAD_SOURCE_SIGNATURE');assert.throws(()=>core.verifySourcePolicy({...policyEnvelope,signature:flipped(policyEnvelope.signature)},key,{upgradeMode:'repeat'}),e=>e.code==='BAD_SOURCE_SIGNATURE');
});

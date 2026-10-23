'use strict';
// Guest-only source/protocol contracts. No PS execution, installer invocation,
// business imports, SQLite, EXE, approvals, private keys or installed writes.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'..'),sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
if(process.platform!=='win32'||ROOT.toLowerCase()!=='c:\\xjy-work\\xjy-web-stage1')throw Error('Fixed actual Guest required');
const GUARD=path.join(ROOT,'stage1/guest-candidate-cdp.cjs');
if(sha(fs.readFileSync(GUARD))!=='59840b638d8797fb55241616cd0b8e4098075a76834a201b0e93c1a748f1bb32')throw Error('Actual Guest guard changed');
require(GUARD).actualGuard();
const test=require('node:test'),assert=require('node:assert/strict');
const SUBJECT=path.join(ROOT,'audit-tools/seal-host-patch-162-a3.cjs');
const TEMPLATE=path.join(ROOT,'audit-tools/host-repeat-162.ps1.in');
const CORE=path.join(ROOT,'delivery-tools/initial-patch-core.cjs');
const PATH_GUARD=path.join(ROOT,'delivery-tools/Initial-Path-Guard.ps1');
for(const [file,pin]of [[CORE,'0f9de31c8ad8ec7e1b870a92d025909f4606363801a31ee3582b903c5704bbce'],[PATH_GUARD,'4b51ba8e7300e0ce8875dcb2a3b060622d84f81459b8cc758d16c4f94eb3f8d7']])assert.equal(sha(fs.readFileSync(file)),pin,'Original dependency changed');
const PUBLISHER='6e8b9cadb59aeb53f30d41f4471f70f644f0dfc7376ffb9d8a4c62defb98458c';
const ENGINE={size:246302720,sha256:'db3ad2066a55546f9b6737da3c7f011370e4856fb36888055b544d45653e4f40',electronRunAsNode:true,nodeSqliteBackup:true};
const TOOL_PATHS=['delivery-tools/initial-patch-core.cjs','delivery-tools/initial-patch-backup.cjs','delivery-tools/initial-patch-entry.cjs','delivery-tools/Initial-Full-Upgrade.ps1','delivery-tools/Initial-Path-Guard.ps1','delivery-tools/Initial-Source-Lock.ps1','delivery-tools/initial-source-lease.cjs','一键完整升级.cmd','project/desktop/employee-update-cache.cjs','project/desktop/employee-update-installer.cjs'];
function subject(){assert(fs.existsSync(SUBJECT),'HOST_REPEAT_162_DRAFT_REQUIRED');const mod=require(SUBJECT);for(const name of ['buildHostRepeatPolicy','argumentsOf','renderRepeatShell'])assert.equal(typeof mod[name],'function','HOST_REPEAT_162_DRAFT_REQUIRED: '+name);return mod;}
function pinned(file,pin){const body=fs.readFileSync(file);assert.equal(sha(body),pin,'Public fixture metadata changed');return JSON.parse(body);}
function fixture(){
 const sourceManifest=pinned('C:/xjy-input/native-installed-162-a1/public-materials/metadata/161-release-manifest.json','e1ff037d5fdb819561719c44487455c676fb90f8e8c18ff54509fbe155828095');
 const targetManifest=pinned('C:/xjy-results/release-162-artifact-a3/release-manifest.json','a62ef80fed2e0eb31abe5e0458752c1d0acb315aaa7bb61850635b3f3afc5a02');
 // Literal synthetic catalog protocol, not the Root proposal/signature. The
 // 1007 file rows come only from the pinned public program metadata above.
 const catalog={schemaVersion:1,app:'xjy-jewelry-offline',channel:'stable',version:'1.6.2',sourceVersions:['1.6.1','1.6.2'],platform:'win32',arch:'x64',sequence:9,publishedAt:'2026-10-19T05:10:00.000Z',expiresAt:'2027-04-17T05:10:00.000Z',archive:{size:123,sha256:sha(Buffer.from('synthetic-protocol-archive-not-installable'))},files:targetManifest.files};
 const tools=TOOL_PATHS.map(name=>({path:name,size:10,sha256:sha(Buffer.from('synthetic-protocol-tool:'+name))}));
 return{catalog,sourceManifest,targetManifest,tools};
}
function build(mod,f){return mod.buildHostRepeatPolicy({catalogRaw:JSON.stringify(f.catalog),sourceManifest:f.sourceManifest,targetManifest:f.targetManifest,tools:f.tools});}
function plain(value){return JSON.parse(JSON.stringify(value));}

test('H01 exact unsigned policy binds repeat/162, the 161 and 162 ASAR identities, engine and ten tools',()=>{
 const mod=subject(),f=fixture(),policy=build(mod,f);
 assert.deepEqual(plain(policy),{
  schemaVersion:1,purpose:'xjy-repeat-program-patch',app:'xjy-jewelry-offline',targetVersion:'1.6.2',catalogSha256:sha(Buffer.from(JSON.stringify(f.catalog))),publisherPublicKeySha256:PUBLISHER,executableName:'鑫金源珠宝报价.exe',engine:ENGINE,
  sourcePrograms:[{version:'1.6.1',main:'release-entry.cjs',asarSize:12541824,asarSha256:'7e4b04ef51c741f7da66da7e55cd5a280b792f32cd0a0fe8d19606f0996de07d'},{version:'1.6.2',main:'release-entry.cjs',asarSize:12570266,asarSha256:'e97ec984734ecfc5dc530ab6f9a8aada2f5da9bb5ad65c97a7c641eeeb3d93a8'}],tools:f.tools
 });
 assert(!Object.hasOwn(policy,'approvalId'));assert(!Object.hasOwn(policy,'installationDir'));assert(!Object.hasOwn(policy,'osUser'));
});

test('H02 no implicit action, arbitrary roots/versions or missing data-build authorization; wrong source/target metadata stops',()=>{
 const mod=subject(),pin='a'.repeat(64),template='b'.repeat(64),proposal='c'.repeat(64);
 const valid=['proposal','--source-sha256',pin,'--template-sha256',template,'--catalog-proposal-sha256',proposal];
 assert.equal(mod.argumentsOf(valid).phase,'proposal');
 const bad=[[],['sign'],valid.concat('--source-versions','1.6.0'),valid.concat('--output','F:/unexpected'),valid.concat('--source-sha256',pin),['seal','--source-sha256',pin,'--template-sha256',template,'--approved-preparation-sha256',proposal,'--source-policy-envelope-sha256',proposal],['prepare','--source-sha256',pin,'--template-sha256',template,'--approved-proposal-sha256',proposal,'--signed-feed-report-sha256',proposal]];
 for(const argv of bad)assert.throws(()=>mod.argumentsOf(argv),'Unsupported/missing authority arguments must reject');
 const original=fixture();
 for(const change of [f=>{f.catalog.sourceVersions=['1.6.0','1.6.2'];},f=>{f.catalog.version='1.6.3';},f=>{f.sourceManifest.programVersion='1.6.0';},f=>{f.targetManifest.files.find(x=>x.path==='resources/app.asar').sha256='0'.repeat(64);},f=>{f.tools.push({path:'delivery-tools/extra.cjs',size:1,sha256:pin});}]){
  const f=structuredClone(original);change(f);assert.throws(()=>build(mod,f));
 }
});

test('H03 dedicated host shell renders original path guard and fixed publication; external approval only, original upgrade intent',()=>{
 const mod=subject();assert(fs.existsSync(TEMPLATE),'HOST_REPEAT_162_SHELL_REQUIRED');
 const templateBytes=fs.readFileSync(TEMPLATE),pathGuardBytes=fs.readFileSync(PATH_GUARD),catalogSha256=sha(Buffer.from('synthetic-publication-only'));
 const output=mod.renderRepeatShell({templateBytes,pathGuardBytes,catalogSha256});
 assert(Buffer.isBuffer(output));const text=output.toString('utf8');
 assert.equal(text.split(pathGuardBytes.toString('utf8')).length,2,'Complete original path guard appears exactly once');
 assert(!text.includes('@@'));assert(text.includes(catalogSha256));
 assert.match(text,/鑫金源珠宝补丁审定-/);assert.match(text,/initial-upgrade-approval\.json/);
 assert.match(text,/\$record\.purpose\s+-cne\s+'xjy-repeat-program-patch'/);assert.match(text,/\$record\.role\s+-cne\s+'host'/);
 assert.match(text,/\$policy\.targetVersion\s+-cne\s+'1\.6\.2'/);assert.match(text,/\$policy\.catalogSha256\s+-cne\s+\$ExpectedPublicationId/);
 assert.match(text,/\$mode\s*=\s*'--upgrade'/);assert.match(text,/\['XJY_INITIAL_ROLE'\]\s*=\s*'host'/);
 assert(!text.includes("'--install'"));assert(!text.includes("'--recover'"));assert(!text.includes('recovery-status.json'));assert(!text.includes("'journal.json'"));
 assert(!/WriteAllText|Set-Content|Out-File|Start-Process|taskkill|Stop-Process|\.Kill\(/i.test(text),'Shell cannot write its own approval or kill/replace the original lifecycle');
 assert.throws(()=>mod.renderRepeatShell({templateBytes,pathGuardBytes,catalogSha256:'../unknown'}));
});

test('H04 actual frozen core accepts RAM-signed planned repeat policy only in repeat mode; tampering is rejected',()=>{
 const mod=subject(),f=fixture(),policy=build(mod,f),core=require(CORE),keys=crypto.generateKeyPairSync('ed25519');
 const raw=JSON.stringify(policy),envelope={policy:raw,signature:crypto.sign(null,Buffer.from(raw),keys.privateKey).toString('base64')};
 assert.deepEqual(plain(core.verifySourcePolicy(envelope,keys.publicKey,{upgradeMode:'repeat'})),plain(policy));
 assert.throws(()=>core.verifySourcePolicy(envelope,keys.publicKey),error=>error.code==='BAD_SOURCE_POLICY');
 assert.throws(()=>core.verifySourcePolicy({...envelope,policy:raw+' '},keys.publicKey,{upgradeMode:'repeat'}),error=>error.code==='BAD_SOURCE_SIGNATURE');
 const bad=structuredClone(policy);bad.tools[0].path='delivery-tools/unapproved.exe';const badRaw=JSON.stringify(bad);
 assert.throws(()=>core.verifySourcePolicy({policy:badRaw,signature:crypto.sign(null,Buffer.from(badRaw),keys.privateKey).toString('base64')},keys.publicKey,{upgradeMode:'repeat'}),error=>error.code==='BAD_SOURCE_POLICY');
 // RAM signature validates schema/bytes only. It is not the original issuer,
 // external approval, file-copy, backup, native PS, install or GUI acceptance.
});

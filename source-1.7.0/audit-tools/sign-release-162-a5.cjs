'use strict';
// Source-review draft: no implicit action. proposal is data-only; sign requires
// fresh external authorization plus exact proposal/self pins. Never publishes.
const fs0=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..'),EXPECTED='E:\\codex\\2026-10-15\\work\\xjy-v16-deep-audit';
const SELF='audit-tools/sign-release-162-a5.cjs',VERSION='1.6.2',SOURCES=Object.freeze(['1.6.0','1.6.1','1.6.2']);
const PIN='6e8b9cadb59aeb53f30d41f4471f70f644f0dfc7376ffb9d8a4c62defb98458c';
const EXPORT=path.join(ROOT,'sandbox/results/native-installed-162-a1/release-162-artifact-a4');
const BASELINE=path.join(ROOT,'sandbox/results/release-161-artifact-a1/release-manifest.json');
const WORK=path.join(ROOT,'release-work/initial-162-signing-proposal-a5'),CLEAN=path.join(WORK,'resource-input');
const ZIP=path.join(WORK,'package.zip'),RAW=path.join(WORK,'catalog-to-sign.json'),PROPOSAL=path.join(WORK,'proposal.json');
const FEED=path.join(ROOT,'release-work/initial-162-feed-a5'),REPORT=path.join(ROOT,'reports/release-162-signed-feed-a5.json');
const ISSUER_ROOT='E:\\codex\\2026-10-13\\work\\xjy-web-stage1';
// Root已按实际a3输出核对以下固定摘要，旧占位草稿保留在qa-history。
const INPUT_PINS={manifest:'17859011d627eb2b24446d088e1e9c25304e477fa28123cec6ce6c7a83f9d767',proof:'91dd55f0b20e27a9186a02c31b3a649900e9b7109ca42cbb6930b2374769b268',asar:'28e24d0dea9416258b67edc2b6fe6aca8683c68d02c9fc305626660dd4c55e6f',baseline:'e1ff037d5fdb819561719c44487455c676fb90f8e8c18ff54509fbe155828095'};
const CODE_PINS={
 'project/desktop/employee-update-cache.cjs':'5cb70079bf161a002a2701694e4774c2a11bf8d54efc6674ccb5c7b2c6729815',
 'project/desktop/employee-update-installer.cjs':'96ba3df08a0f706e599da7d452374b1f894d401c0a6ff605fc01255d01445bd0',
 'delivery-tools/initial-patch-core.cjs':'0f9de31c8ad8ec7e1b870a92d025909f4606363801a31ee3582b903c5704bbce',
 'stage1/build-initial-patch.cjs':'f540ab35e1fccac96234f0ef63b652347e54c726c93ff6e210dec2d3d3414abb',
 'delivery-tools/fresh-employee-install.cjs':'2b4652f6b0ed33d6ef71e3330e74ce2f083de5aafcbb6f56c2c9b18f3537e65c',
};
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex'),json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
let signingAttempted=false;
function hashSource(relative,pin){assert.match(pin||'',/^[a-f0-9]{64}$/);const file=path.join(ROOT,...relative.split('/'));for(let p=file;;p=path.dirname(p)){const stat=fs0.lstatSync(p);assert(!stat.isSymbolicLink()&&(!stat.isFile()||stat.nlink===1),'Ordinary source required');if(p===path.dirname(p))break;}const stat=fs0.lstatSync(file);assert(stat.isFile()&&stat.size<=2097152);assert.equal(sha(fs0.readFileSync(file)),pin,'Reviewed source changed: '+relative);}
function sourcePins(selfPin){hashSource(SELF,selfPin);for(const [file,pin]of Object.entries(CODE_PINS))hashSource(file,pin);}
function argumentsOf(argv){
 const phase=argv[0];assert(['proposal','sign'].includes(phase),'No default action. Explicit proposal or separately authorized sign is required.');
 const required=phase==='proposal'?['source-sha256','source-versions','sequence','published-at','expires-at']:['source-sha256','approved-proposal-sha256'];
 const allowed=new Set([...required,...(phase==='sign'?['authorized-original-issuer-signing']:[])]),result={phase};
 for(let n=1;n<argv.length;n++){const key=argv[n]?.slice(2);assert(argv[n]?.startsWith('--')&&allowed.has(key)&&!Object.hasOwn(result,key),'Unknown or duplicate argument');if(key==='authorized-original-issuer-signing'){result[key]=true;continue;}assert(n+1<argv.length&&!argv[n+1].startsWith('--'),'Explicit argument value required');result[key]=argv[++n];}
 for(const key of required)assert(typeof result[key]==='string'&&result[key],'Missing '+key);
 assert.match(result['source-sha256'],/^[a-f0-9]{64}$/);
 if(phase==='sign'){assert.equal(result['authorized-original-issuer-signing'],true,'This invocation has no original-issuer signing authorization');assert.match(result['approved-proposal-sha256'],/^[a-f0-9]{64}$/);}
 return result;
}
function catalogShape(catalog){
 assert.equal(catalog.version,VERSION);assert.deepEqual(catalog.sourceVersions,SOURCES);
 assert(Number.isSafeInteger(catalog.sequence)&&catalog.sequence>3,'Root must explicitly seal a new sequence above the known161 sequence3; live high-water remains an external review');
 assert.equal(catalog.sequence,11,'Only this reviewed employee160/161 sequence11 publication is admitted');
 const published=Date.parse(catalog.publishedAt),expires=Date.parse(catalog.expiresAt),now=Date.now();
 assert(Number.isFinite(published)&&Number.isFinite(expires)&&new Date(published).toISOString()===catalog.publishedAt&&new Date(expires).toISOString()===catalog.expiresAt,'Canonical ISO dates required');
 assert(published<=now+300000&&expires>now&&expires>published,'Root-reviewed catalog dates are invalid/expired; never renew automatically');
}
async function runtime(selfPin){
 assert(process.platform==='win32'&&ROOT.toLowerCase()===EXPECTED.toLowerCase(),'Fixed isolated signing workspace required');
 sourcePins(selfPin);
 const fs=require('node:fs/promises'),u=require('../project/desktop/employee-update-cache.cjs'),core=require('../delivery-tools/initial-patch-core.cjs'),build=require('../stage1/build-initial-patch.cjs');
 sourcePins(selfPin);return{fs,u,core,build};
}
async function fresh(rt,file){await rt.u.assertPath(rt.fs,file,{missing:true,root:ROOT});try{await rt.fs.lstat(file);throw Error('CreateNew output already exists: '+file);}catch(error){if(error.code!=='ENOENT')throw error;}}
async function writeNew(rt,file,body){await rt.core.mkdirs(rt.fs,ROOT,path.relative(ROOT,path.dirname(file)).split(path.sep).join('/'));const opened=await rt.u.openChecked(rt.fs,file,'wx+',{missing:true,root:ROOT});try{await rt.u.writeExactly(opened.handle,0,body);await opened.handle.sync();await rt.u.assertHandle(rt.fs,opened,{snapshot:false,root:ROOT});}finally{await opened.handle.close();}const value=await rt.core.fileHash(rt.fs,file,ROOT);assert.equal(value.size,body.length);assert.equal(value.sha256,sha(body));return{file,size:value.size,sha256:value.sha256};}
async function pinnedJson(rt,file,pin){await rt.u.assertPath(rt.fs,file,{root:ROOT});const bytes=await rt.u.readSmall(rt.fs,file,2097152);assert.equal(sha(bytes),pin,'Fixed metadata changed');return JSON.parse(bytes);}
async function exactResources(rt,root,files){const tree=await rt.core.inspectArtifactTree({artifactDir:path.join(root,'resources')}),map=new Map(files.map(file=>[file.path,file]));assert.equal(tree.files.length,1007);for(const file of tree.files){const expected=map.get('resources/'+file.path);assert(expected,'Extra resource');assert.equal(file.size,expected.size);assert.equal(file.sha256,expected.sha256);}return tree.sha256;}
async function inputs(rt){
 const manifest=await pinnedJson(rt,path.join(EXPORT,'release-manifest.json'),INPUT_PINS.manifest),proof=await pinnedJson(rt,path.join(EXPORT,'data-free-proof.json'),INPUT_PINS.proof),baseline=await pinnedJson(rt,BASELINE,INPUT_PINS.baseline);
 assert.equal(manifest.programVersion,VERSION);assert.equal(manifest.resourcesOnly,true);assert.equal(manifest.fileCount,1007);assert.equal(manifest.files.length,1007);assert.equal(manifest.asar.sha256,INPUT_PINS.asar);assert.equal(manifest.asar.allEntriesExtracted,true);
 assert.equal(baseline.programVersion,'1.6.1');assert.equal(baseline.publicPins.publisherPublicKeySha256,PIN);assert.equal(manifest.publicPins.publisherPublicKeySha256,PIN);
 assert.deepEqual([...baseline.publicPins.allowedFiles].sort(),manifest.files.map(file=>file.path).sort());assert.deepEqual(proof.files,manifest.files);assert.equal(proof.dataIncluded,false);assert.equal(proof.signed,false);
 const programPath=require('../project/desktop/employee-update-installer.cjs').programPath;assert(manifest.files.every(file=>programPath(file.path)));assert.equal(new Set(manifest.files.map(file=>file.path.toLowerCase())).size,1007);
 const publicBytes=Buffer.from(manifest.publicPins.publisherPublicKey),publicKey=crypto.createPublicKey(publicBytes);assert.equal(publicKey.asymmetricKeyType,'ed25519');assert.equal(sha(publicKey.export({type:'spki',format:'der'})),PIN);assert(!publicBytes.includes(Buffer.from('PRIVATE KEY')));
 await exactResources(rt,EXPORT,manifest.files);return{manifest,publicBytes,publicKey};
}
async function propose(rt,options){
 assert.equal(options['source-versions'],'1.6.0,1.6.1,1.6.2','Explicit combined160/161/162 employee scope required');
 assert.match(options.sequence,/^[1-9]\d*$/);const sequence=Number(options.sequence);
 catalogShape({version:VERSION,sourceVersions:[...SOURCES],sequence,publishedAt:options['published-at'],expiresAt:options['expires-at']});
 const selected=await inputs(rt);await fresh(rt,WORK);await rt.core.mkdirs(rt.fs,ROOT,'release-work');await rt.fs.mkdir(WORK);await rt.u.assertPath(rt.fs,WORK,{directory:true,root:ROOT});await rt.fs.mkdir(CLEAN);
 for(const file of selected.manifest.files){await rt.core.mkdirs(rt.fs,CLEAN,file.path.split('/').slice(0,-1).join('/'));await rt.core.copy(rt.fs,path.join(EXPORT,...file.path.split('/')),path.join(CLEAN,...file.path.split('/')),file,EXPORT,CLEAN);}
 const resourceTreeSha256=await exactResources(rt,CLEAN,selected.manifest.files),archive=await rt.build.writeStoredZip({artifactDir:CLEAN,archiveFile:ZIP});
 const catalog={schemaVersion:1,app:'xjy-jewelry-offline',channel:'stable',version:VERSION,sourceVersions:[...SOURCES],platform:'win32',arch:'x64',sequence,publishedAt:options['published-at'],expiresAt:options['expires-at'],archive:{size:archive.size,sha256:archive.sha256},files:selected.manifest.files};
 catalogShape(catalog);const raw=Buffer.from(JSON.stringify(catalog)),rawRecord=await writeNew(rt,RAW,raw);await writeNew(rt,path.join(WORK,'publisher-public.pem'),selected.publicBytes);
 await inputs(rt);sourcePins(options['source-sha256']);
 const proposal={version:1,purpose:'release-162-catalog-signing-proposal',status:'UNSIGNED_NOT_PUBLISHABLE',sourceSha256:options['source-sha256'],codePins:CODE_PINS,inputPins:INPUT_PINS,programVersion:VERSION,publisherPublicKeySha256:PIN,sourceVersions:[...SOURCES],sequence,publishedAt:catalog.publishedAt,expiresAt:catalog.expiresAt,resourceRoot:CLEAN,resourceTreeSha256,archive:{file:ZIP,size:archive.size,sha256:archive.sha256},catalog:{file:RAW,size:raw.length,sha256:rawRecord.sha256},privateKeyRead:false,signed:false,published:false,installed:false,programExecuted:false,externalSigningAuthorizationRequired:true,liveHighWaterReviewedByTool:false};
 const output=await writeNew(rt,PROPOSAL,json(proposal));console.log(JSON.stringify({...output,phase:'proposal',signed:false,published:false,installed:false}));
}
async function reviewedProposal(rt,options){
 const proposal=await pinnedJson(rt,PROPOSAL,options['approved-proposal-sha256']),selected=await inputs(rt);
 assert.equal(proposal.version,1);assert.equal(proposal.purpose,'release-162-catalog-signing-proposal');assert.equal(proposal.status,'UNSIGNED_NOT_PUBLISHABLE');assert.equal(proposal.sourceSha256,options['source-sha256']);assert.equal(proposal.programVersion,VERSION);assert.equal(proposal.publisherPublicKeySha256,PIN);
 assert.deepEqual(proposal.codePins,CODE_PINS);assert.deepEqual(proposal.inputPins,INPUT_PINS);assert.equal(proposal.resourceRoot,CLEAN);assert.equal(proposal.archive.file,ZIP);assert.equal(proposal.catalog.file,RAW);assert.equal(proposal.signed,false);assert.equal(proposal.published,false);assert.equal(proposal.installed,false);
 const raw=await rt.u.readSmall(rt.fs,RAW,2097152);assert.equal(raw.length,proposal.catalog.size);assert.equal(sha(raw),proposal.catalog.sha256);const catalog=JSON.parse(raw);catalogShape(catalog);assert.deepEqual(catalog.files,selected.manifest.files);assert.deepEqual(catalog.sourceVersions,proposal.sourceVersions);assert.equal(catalog.sequence,proposal.sequence);assert.equal(catalog.publishedAt,proposal.publishedAt);assert.equal(catalog.expiresAt,proposal.expiresAt);assert.deepEqual(catalog.archive,{size:proposal.archive.size,sha256:proposal.archive.sha256});
 assert.equal(await exactResources(rt,CLEAN,catalog.files),proposal.resourceTreeSha256);const archive=await rt.core.fileHash(rt.fs,ZIP,WORK);assert.equal(archive.size,proposal.archive.size);assert.equal(archive.sha256,proposal.archive.sha256);assert((await rt.u.readSmall(rt.fs,path.join(WORK,'publisher-public.pem'),8192)).equals(selected.publicBytes));
 return{proposal,selected,raw,catalog};
}
async function sign(rt,options){
 // This flag is not a grant. Root must separately obtain the human authorization
 // before invoking this phase; no authorization record is generated by this tool.
 assert.equal(options['authorized-original-issuer-signing'],true);const checked=await reviewedProposal(rt,options);await fresh(rt,FEED);await fresh(rt,REPORT);sourcePins(options['source-sha256']);
 signingAttempted=true;const privateFile=path.join(ISSUER_ROOT,'config/release-signing/issuer-private.pem');await rt.u.assertPath(rt.fs,privateFile,{root:ISSUER_ROOT});
 const bytes=await rt.u.readSmall(rt.fs,privateFile,4096);let privateKey;
 try{privateKey=crypto.createPrivateKey(bytes);}finally{bytes.fill(0);}
 assert.equal(sha(crypto.createPublicKey(privateKey).export({type:'spki',format:'der'})),PIN,'Original issuer pair required');
 const envelope={catalog:checked.raw.toString('utf8'),signature:crypto.sign(null,checked.raw,privateKey).toString('base64')};privateKey=null;
 for(const currentVersion of SOURCES)rt.u.verifySignedCatalog(envelope,rt.u.createTrustedUpdatePolicy({trustedPublicKey:checked.selected.publicKey,allowedFiles:checked.catalog.files.map(file=>file.path),currentVersion,platform:'win32',arch:'x64'}));
 await reviewedProposal(rt,options);sourcePins(options['source-sha256']);await rt.fs.mkdir(FEED);await rt.u.assertPath(rt.fs,FEED,{directory:true,root:ROOT});
 await rt.core.copy(rt.fs,ZIP,path.join(FEED,'package.zip'),checked.proposal.archive,WORK,FEED);
 const catalogRecord=await writeNew(rt,path.join(FEED,'catalog.json'),Buffer.from(JSON.stringify(envelope))),publicRecord=await writeNew(rt,path.join(FEED,'publisher-public.pem'),checked.selected.publicBytes);
 const result={version:1,purpose:'root-signed-162-resource-feed',programVersion:VERSION,sourceSha256:options['source-sha256'],approvedProposalSha256:options['approved-proposal-sha256'],directory:FEED,resourceRoot:CLEAN,manifestSha256:INPUT_PINS.manifest,asarSha256:INPUT_PINS.asar,sourceVersions:[...SOURCES],sequence:checked.catalog.sequence,publishedAt:checked.catalog.publishedAt,expiresAt:checked.catalog.expiresAt,publisherPublicKeySha256:PIN,catalogSha256:sha(checked.raw),catalogEnvelopeSha256:catalogRecord.sha256,archive:checked.catalog.archive,publicKeyFileSha256:publicRecord.sha256,fileCount:1007,signatureVerified:true,signed:true,published:false,installed:false,programExecuted:false,privateKeyRead:true,privateKeyIncluded:false,signingAuthorizationIsExternal:true};
 await reviewedProposal(rt,options);sourcePins(options['source-sha256']);const output=await writeNew(rt,REPORT,json(result));console.log(JSON.stringify({...output,phase:'sign',signed:true,published:false,installed:false}));
}
async function main(){const options=argumentsOf(process.argv.slice(2)),rt=await runtime(options['source-sha256']);return options.phase==='proposal'?propose(rt,options):sign(rt,options);}
if(require.main===module)main().catch(error=>{console.error(JSON.stringify({purpose:'release-162-signing-draft',passed:false,error:error.message,signingAttempted,signingCompleted:false,published:false,installed:false,programExecuted:false}));process.exitCode=1;});


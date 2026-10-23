'use strict';
// Root-only Guest component QA. Real pinned72 engine +1007 a2 resources;
// test publisher private key remains in RAM, launch is explicit DI only.
// Never CLI/wrapper/EXE/ASAR payload, service, business database or Host run.
const fs0=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..'),sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
if(process.platform!=='win32'||ROOT.toLowerCase()!=='c:\\xjy-work\\xjy-web-stage1')throw Error('Fixed actual Guest required before product import');
const args=process.argv.slice(2);
assert(args.length===2&&args[0]==='--source-sha256'&&/^[a-f0-9]{64}$/.test(args[1]),'Only Root-pinned source SHA is accepted');
function code(relative,pin){const file=path.join(ROOT,...relative.split('/'));for(let p=file;;p=path.dirname(p)){const s=fs0.lstatSync(p);assert(!s.isSymbolicLink()&&(!s.isFile()||s.nlink===1),'Ordinary source required');if(p===path.dirname(p))break;}const stat=fs0.lstatSync(file);assert(stat.isFile()&&stat.size<=2097152);assert.equal(sha(fs0.readFileSync(file)),pin,'Frozen source changed: '+relative);return file;}
const SOURCE_PINS={
 'stage1/guest-candidate-cdp.cjs':'59840b638d8797fb55241616cd0b8e4098075a76834a201b0e93c1a748f1bb32',
 'stage1/sandbox-context.py':'09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249',
 'stage1/validate-sandbox-context.py':'867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207',
 'delivery-tools/fresh-employee-install.cjs':'2b4652f6b0ed33d6ef71e3330e74ce2f083de5aafcbb6f56c2c9b18f3537e65c',
 'delivery-tools/initial-patch-core.cjs':'0f9de31c8ad8ec7e1b870a92d025909f4606363801a31ee3582b903c5704bbce',
 'delivery-tools/initial-patch-entry.cjs':'4c0008c6f070c22255f3a2819ac82e9be774fbaf631030bb414c95bbcac6b161',
 'project/desktop/employee-update-cache.cjs':'5cb70079bf161a002a2701694e4774c2a11bf8d54efc6674ccb5c7b2c6729815',
 'project/desktop/employee-update-installer.cjs':'96ba3df08a0f706e599da7d452374b1f894d401c0a6ff605fc01255d01445bd0',
 'tests/employee-update-fixtures.cjs':'c8b7b124ea0523257c564161dcea18698ab8a0a00db9f73ebcb4fea333eab572',
};
function sourcesPinned(){code('audit-tools/fresh-employee-real162.cjs',args[1]);for(const [file,pin]of Object.entries(SOURCE_PINS))code(file,pin);}
sourcesPinned();
const actualContext=require('../stage1/guest-candidate-cdp.cjs').actualGuard();
const fs=process.versions.electron?require('original-fs').promises:require('node:fs/promises');
const core=require('../delivery-tools/initial-patch-core.cjs'),u=require('../project/desktop/employee-update-cache.cjs');
const {installFreshEmployee}=require('../delivery-tools/fresh-employee-install.cjs');
const {programPath}=require('../project/desktop/employee-update-installer.cjs'),{zip}=require('../tests/employee-update-fixtures.cjs');
const INPUT=path.join(ROOT,'release-work/employee-real162-a1'),BASE=path.join(INPUT,'public161/安装文件');
const TRUST=path.join(INPUT,'public161/安装组件/delivery-tools/fresh-employee-trust.json'),BASE_MANIFEST=path.join(INPUT,'baseline161-manifest.json');
const TARGET='C:/xjy-results/release-162-artifact-a2',RUN=path.join(ROOT,'release-work/fresh-employee-real162-a1'),RESULT='C:/xjy-results/fresh-employee-real162-a1.json';
const PINS={baseManifest:'e1ff037d5fdb819561719c44487455c676fb90f8e8c18ff54509fbe155828095',trust:'03e9a804fd6b34af15e267cac159c839bed791ab735a0a2dfb6f56151310d18f',targetManifest:'fe20ea7d83f2e2200624bf81364078ca8b206d1efcc8dbad03b1841d0fab9da2',targetProof:'1a1e0aa79ec55125c847bb6c4151b24e7807c733397ba7d58b526c420ece26c7',targetAsar:'02a3dc5128203889fa88205020c39970f08305b4496e64507ca5ec5eab7f7568',engine:'db3ad2066a55546f9b6737da3c7f011370e4856fb36888055b544d45653e4f40'};
async function absent(file){try{await fs.lstat(file);return false;}catch(error){if(error.code==='ENOENT')return true;throw error;}}
async function pinnedJson(file,pin,root){await u.assertPath(fs,file,{root});const bytes=await u.readSmall(fs,file,2097152);assert.equal(sha(bytes),pin);return JSON.parse(bytes);}
async function checked(file,spec,root){const result=await core.fileHash(fs,file,root);assert.equal(result.size,spec.size,file);assert.equal(result.sha256,spec.sha256,file);return result;}
function resourcesOf(manifest,version){assert.equal(manifest.version,1);assert.equal(manifest.programVersion,version);assert.equal(manifest.resourcesOnly,true);assert.equal(manifest.fileCount,1007);assert.equal(manifest.files.length,1007);assert.equal(new Set(manifest.files.map(file=>file.path.toLowerCase())).size,1007);for(const file of manifest.files)assert(programPath(file.path)&&Number.isSafeInteger(file.size)&&file.size>=0&&/^[a-f0-9]{64}$/.test(file.sha256));return manifest.files;}
async function exactFiles(root,expected){
 const tree=await core.inspectArtifactTree({artifactDir:root}),map=new Map(expected.map(file=>[file.path,file])),wantedDirs=new Set(),seenDirs=new Set();
 assert.equal(tree.files.length,expected.length,'Exact complete file inventory');for(const file of tree.files){const wanted=map.get(file.path);assert(wanted,'Extra file: '+file.path);assert.equal(file.size,wanted.size,file.path);assert.equal(file.sha256,wanted.sha256,file.path);}
 for(const file of expected){const parts=file.path.split('/');for(let n=1;n<parts.length;n++)wantedDirs.add(parts.slice(0,n).join('/'));}
 async function directories(directory,prefix=''){for(const name of await fs.readdir(directory)){const file=path.join(directory,name),relative=prefix+name,stat=await fs.lstat(file);await u.assertPath(fs,file,{root,directory:stat.isDirectory()});if(stat.isDirectory()){assert(wantedDirs.has(relative),'Extra or empty directory: '+relative);seenDirs.add(relative);await directories(file,relative+'/');}}}
 await directories(root);assert.deepEqual([...seenDirs].sort(),[...wantedDirs].sort());return tree;
}
async function selectedInputs(){
 const baseline=await pinnedJson(BASE_MANIFEST,PINS.baseManifest,INPUT),reference=await pinnedJson(TRUST,PINS.trust,INPUT),target=await pinnedJson(path.join(TARGET,'release-manifest.json'),PINS.targetManifest,path.resolve(TARGET)),proof=await pinnedJson(path.join(TARGET,'data-free-proof.json'),PINS.targetProof,path.resolve(TARGET));
 const oldFiles=resourcesOf(baseline,'1.6.1'),targetFiles=resourcesOf(target,'1.6.2');
 assert.equal(target.asar.sha256,PINS.targetAsar);assert.deepEqual(proof.files,targetFiles);assert.equal(proof.dataIncluded,false);assert.equal(proof.signed,false);assert.equal(proof.installed,false);assert.equal(proof.fileCount,1007);
 assert.equal(reference.targetVersion,'1.6.1');assert.equal(reference.engineVersion,'44.7.0');assert.equal(reference.executableName,'鑫金源珠宝报价.exe');assert.equal(reference.engineFiles.length,72);assert.equal(reference.publisherPublicKeySha256,'6e8b9cadb59aeb53f30d41f4471f70f644f0dfc7376ffb9d8a4c62defb98458c');
 assert.deepEqual([...reference.allowedResourceFiles].sort(),oldFiles.map(file=>file.path).sort());assert.deepEqual(oldFiles.map(file=>file.path).sort(),targetFiles.map(file=>file.path).sort());
 const engineFiles=reference.engineFiles;assert.equal(new Set(engineFiles.map(file=>file.path.toLowerCase())).size,72);
 for(const file of engineFiles)assert(u.safeRelative(file.path)&&Number.isSafeInteger(file.size)&&file.size>=0&&/^[a-f0-9]{64}$/.test(file.sha256));
 const exe=engineFiles.find(file=>file.path===reference.executableName);assert.equal(exe.size,246302720);assert.equal(exe.sha256,PINS.engine);
 await exactFiles(path.join(BASE,'engine'),engineFiles);await exactFiles(path.join(TARGET,'resources'),targetFiles.map(file=>({...file,path:file.path.slice('resources/'.length)})));
 const pkg=await core.packageIdentity(fs,path.join(TARGET,'resources/app.asar'),path.resolve(TARGET));assert.equal(pkg.version,'1.6.2');assert.equal(pkg.main,'release-entry.cjs');
 return{reference,engineFiles,targetFiles};
}
async function put(root,relative,body){const file=path.join(root,...relative.split('/'));await core.mkdirs(fs,root,relative.split('/').slice(0,-1).join('/'));await fs.writeFile(file,body,{flag:'wx'});return{path:relative,size:body.length,sha256:sha(body)};}
async function copyFiles(sourceRoot,destinationRoot,files,prefix=''){for(const file of files){const name=prefix+file.path;await core.mkdirs(fs,destinationRoot,name.split('/').slice(0,-1).join('/'));await core.copy(fs,path.join(sourceRoot,...file.path.split('/')),path.join(destinationRoot,...name.split('/')),file,sourceRoot,destinationRoot);}}
function inside(root,file){const value=path.relative(root,file);return value!==''&&value!=='..'&&!value.startsWith('..'+path.sep)&&!path.isAbsolute(value);}

async function main(){
 const began=Date.now();assert(await absent(RESULT),'CreateNew result required');assert(await absent(RUN),'CreateNew owned fresh-install run required');
 const input=await selectedInputs(),{reference,engineFiles,targetFiles}=input;
 await core.mkdirs(fs,ROOT,'release-work');await fs.mkdir(RUN);await u.assertPath(fs,RUN,{directory:true,root:ROOT});
 await put(RUN,'owner.json',Buffer.from(JSON.stringify({purpose:'fresh-real162-api-component',sourceSha256:args[1],syntheticLocalAppData:true,programExecuted:false})+'\n'));
 const artifact=await core.mkdirs(fs,RUN,'artifact'),local=await core.mkdirs(fs,RUN,'local-app-data');
 console.log(JSON.stringify({stage:'copying-public-engine-and-a2-resources',engineFiles:72,resourceFiles:1007,programExecuted:false}));
 await copyFiles(path.join(BASE,'engine'),artifact,engineFiles,'engine/');await copyFiles(path.resolve(TARGET),artifact,targetFiles);
 // Catalog archive identity is a real RAM-only ZIP of exactly these resources.
 // Fresh installation consumes the unpacked artifact; no ZIP file is installed.
 const entries=[];for(const file of targetFiles){const body=await u.readSmall(fs,path.join(artifact,...file.path.split('/')),Math.max(1,file.size));assert.equal(body.length,file.size);assert.equal(sha(body),file.sha256);entries.push({path:file.path,body});}
 let archive=zip(entries);entries.length=0;const archiveIdentity={size:archive.length,sha256:sha(archive)};archive=null;
 const keys=crypto.generateKeyPairSync('ed25519'),publisher=Buffer.from(keys.publicKey.export({type:'spki',format:'pem'})),publisherSha=sha(keys.publicKey.export({type:'spki',format:'der'})),now=Date.now();
 const catalog={schemaVersion:1,app:'xjy-jewelry-offline',channel:'stable',version:'1.6.2',sourceVersions:['1.6.2'],platform:'win32',arch:'x64',sequence:1,publishedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+86400000).toISOString(),archive:archiveIdentity,files:targetFiles};
 const raw=JSON.stringify(catalog),envelope={catalog:raw,signature:crypto.sign(null,Buffer.from(raw),keys.privateKey).toString('base64')},envelopeBytes=Buffer.from(JSON.stringify(envelope));
 const testTrust=u.freeze({...reference,targetVersion:'1.6.2',publisherPublicKeySha256:publisherSha,engineFiles:engineFiles.map(file=>({...file})),allowedResourceFiles:targetFiles.map(file=>file.path)});
 assert.deepEqual(u.verifySignedCatalog(envelope,u.createTrustedUpdatePolicy({trustedPublicKey:keys.publicKey,allowedFiles:testTrust.allowedResourceFiles,currentVersion:'1.6.2',now:()=>now})),catalog);
 const publicRecord=await put(artifact,'publisher-public.pem',publisher),catalogRecord=await put(artifact,'catalog-envelope.json',envelopeBytes);
 const program=[...engineFiles,...targetFiles],artifactRecords=[...engineFiles.map(file=>({...file,path:'engine/'+file.path})),...targetFiles,publicRecord,catalogRecord];
 assert.equal(program.length,1079);assert.equal(artifactRecords.length,1081);const artifactBefore=await exactFiles(artifact,artifactRecords);
 const install=path.join(local,'鑫金源珠宝','员工程序'),marker=path.join(install,'xjy-install-activation.json'),launches=[],writes=[];
 let markerOpens=0,completeBeforeActivation=false,completeAtLaunch=false;
 const io={...fs,open:async(file,flags,...extra)=>{
  if(typeof file==='string'&&typeof flags==='string'&&/[wax+]/.test(flags)&&inside(install,file)){
   const name=path.relative(install,file).replaceAll('\\','/');
   if(name==='xjy-install-activation.json'){assert(await absent(marker));await exactFiles(install,program);completeBeforeActivation=true;markerOpens++;}
   writes.push(name);
  }
  return fs.open(file,flags,...extra);
 }};
 const expectedActivation={version:1,product:'xjy-jewelry-offline',programVersion:'1.6.2',role:'employee',installationDir:install};
 const options={artifactDir:artifact,localAppData:local,trust:testTrust,now:()=>now,fileSystem:io,launch:async request=>{
  assert.equal(completeBeforeActivation,true);assert.equal(markerOpens,1);assert.equal(writes.at(-1),'xjy-install-activation.json');
  const activation=await u.readSmall(fs,marker,4096);assert.deepEqual(JSON.parse(activation),expectedActivation);
  const actual=await exactFiles(install,[...program,{path:'xjy-install-activation.json',size:activation.length,sha256:sha(activation)}]);assert.equal(actual.files.length,1080);completeAtLaunch=true;
  assert.deepEqual(request,{executablePath:path.join(install,reference.executableName),args:['--employee-client'],role:'employee'});launches.push(request);return{started:true};
 }};
 console.log(JSON.stringify({stage:'actual-fresh-api-copy',programFiles:1079,launchIsDI:true,programExecuted:false}));
 const result=await installFreshEmployee(options);
 assert.equal(result.installed,true);assert.equal(result.role,'employee');assert.equal(result.version,'1.6.2');assert.equal(result.installationDir,install);assert.equal(result.launched,true);
 assert.equal(completeBeforeActivation,true);assert.equal(completeAtLaunch,true);assert.equal(markerOpens,1);assert.equal(launches.length,1);assert.equal(writes.at(-1),'xjy-install-activation.json');
 const activationBytes=await u.readSmall(fs,marker,4096),installedExpected=[...program,{path:'xjy-install-activation.json',size:activationBytes.length,sha256:sha(activationBytes)}],installedBefore=await exactFiles(install,installedExpected);
 const pkg=await core.packageIdentity(fs,path.join(install,'resources/app.asar'),install);assert.equal(pkg.version,'1.6.2');assert.equal(pkg.main,'release-entry.cjs');
 const writesBeforeRepeat=writes.length;await assert.rejects(installFreshEmployee(options),error=>error.code==='EXISTING_INSTALLATION');
 const installedAfter=await exactFiles(install,installedExpected);assert.equal(installedAfter.sha256,installedBefore.sha256);assert.deepEqual(await u.readSmall(fs,marker,4096),activationBytes);assert.equal(launches.length,1);assert.equal(writes.length,writesBeforeRepeat);
 assert.equal((await exactFiles(artifact,artifactRecords)).sha256,artifactBefore.sha256);await selectedInputs();sourcesPinned();
 const report={passed:true,purpose:'fresh-real162-api-component',sourceSha256:args[1],actualContext,inputPins:PINS,sourcePins:SOURCE_PINS,ownedRun:RUN,artifact,installationDir:install,
  scenarios:[{name:'complete-real-byte-fresh-install',passed:true,engineFiles:72,resourceFiles:1007,programFiles:1079,installedFiles:1080,completeBeforeActivation:true,activationCreatedOnce:true,activationLastProgramWrite:true,completeAtLaunch:true,activationVersion:'1.6.2',activationRole:'employee'},
   {name:'repeat-same-directory-refused',passed:true,code:'EXISTING_INSTALLATION',installedTreeUnchanged:true,activationUnchanged:true,newWrites:0,newLaunchRequests:0}],scenarioCount:2,
  selectedInputTreesUnchanged:true,source161ResourcesNotUsed:true,fixtureArtifactUnchanged:true,noExtraInstalledFiles:true,noExtraInstalledPaths:true,noBusinessPathsInstalled:true,
  archiveIdentity,archiveRamOnly:true,temporarySigningKeyRamOnly:true,testTrustInjected:true,signatureVerificationDisabled:false,productionPublisherTrustVerified:false,
  launchRequestsDI:launches.length,launchArgs:['--employee-client'],wrapperRun:false,nativeGuiVerified:false,exeExecuted:false,helperProcessExecuted:false,businessDatabaseOpened:false,installedOnProduction:false,failedArtifactsPreserved:true,elapsedMs:Date.now()-began};
 await u.assertPath(fs,RESULT,{missing:true});await fs.writeFile(RESULT,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
}
main().catch(error=>{console.error(JSON.stringify({purpose:'fresh-real162-api-component',passed:false,code:error.code||'ASSERTION_OR_INPUT_FAILURE',message:error.message,exeExecuted:false,installedOnProduction:false,failedArtifactsPreserved:true}));process.exitCode=1;});

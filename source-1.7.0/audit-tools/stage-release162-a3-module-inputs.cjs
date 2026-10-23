'use strict';
// Fixed Guest data copy only. Root reviews/pins this source before execution.
// No compilation, module/EXE execution, product install, signing, retry or cleanup.
const fs=require('node:fs'),io=fs.promises,path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const ROOT='C:\\xjy-work\\xjy-web-stage1',SELF=path.join(ROOT,'audit-tools/stage-release162-a3-module-inputs.cjs');
if(process.platform!=='win32'||os.userInfo().username!=='WDAGUtilityAccount'||path.resolve(__filename).toLowerCase()!==SELF.toLowerCase()||path.resolve(process.execPath).toLowerCase()!==path.join(ROOT,'stage1/tools/node.exe').toLowerCase())throw Error('ACTUAL_FIXED_GUEST_NODE_REQUIRED');
if(process.argv.length!==2||process.env.NODE_OPTIONS||process.env.NODE_PATH||process.env.ELECTRON_RUN_AS_NODE||globalThis.__xjyStage1Guard)throw Error('NO_PARAMETERS_OR_EXECUTION_OVERRIDE_ALLOWED');
const NAMESPACE='36fcbe9c-ece1-4be3-af35-309a2ee19e05';
const PUBLIC='C:\\xjy-input\\native-installed-162-a1\\public-materials',SOURCE=path.join(PUBLIC,'v162/resources/release-modules');
const RELEASE_MANIFEST=path.join(PUBLIC,'metadata/162-release-manifest.json');
const PROOF_ROOT='C:\\xjy-input\\release162-a3-module-proof-a1',PROOF_SOURCE=path.join(PROOF_ROOT,'candidate-proof.json');
const RUN=path.join(ROOT,'release-work/platinum-ledger-repack-a2'),TARGET=path.join(RUN,'modules-input'),PROOF_TARGET=path.join(RUN,'candidate-proof.json');
const RESULTS='C:\\xjy-results',REPORT=path.join(RESULTS,'release-162-module-stage-a3-a1.json');
const PIN=Object.freeze({manifest:'a32e4fd6ffa7da5842b5e5364396736c6b80d4775d3b5ebd10a9d78465418d16',proof:'186619f9af8678165f1d21a3e0c67fc494a99d860bd0d767fb1539096477a36b',release:'fe20ea7d83f2e2200624bf81364078ca8b206d1efcc8dbad03b1841d0fab9da2',tree:'95a6b75192a879c7bb06d87528feff13487ce6bef11328422e9f09c1d595a7f6',ledger:'58a654849f11bc7e8bdd12e1b48a24f4cef0b6cacef89be307c95d238e557945',template:'3b574daa8d6969d87dd2401b09f325f8a6c1ca25f0db21251bae0867831ca57f'});
const CODE=Object.freeze({
 'stage1/tools/node.exe':'ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32',
 'stage1/guest-candidate-cdp.cjs':'59840b638d8797fb55241616cd0b8e4098075a76834a201b0e93c1a748f1bb32',
 'stage1/sandbox-context.py':'09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249',
 'stage1/validate-sandbox-context.py':'867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207',
 'stage1/isolation.cjs':'dd1eea05233607ca20bf19d931e4a5bd10dccd2cbe80ef4697685b6a4fdf759a',
 'stage1/build-full-release.cjs':'943e69bd503d43c7b7fc816f3c0a39ee1f00a8ab4cc63a8196cddd743239bc01',
 'delivery-tools/initial-patch-core.cjs':'0f9de31c8ad8ec7e1b870a92d025909f4606363801a31ee3582b903c5704bbce',
 'project/desktop/employee-update-cache.cjs':'5cb70079bf161a002a2701694e4774c2a11bf8d54efc6674ccb5c7b2c6729815',
 'project/desktop/employee-update-installer.cjs':'96ba3df08a0f706e599da7d452374b1f894d401c0a6ff605fc01255d01445bd0'
});
const SOURCES=Object.freeze({
 'project/desktop/legacy-source/ledger/finance.py':'56bcb389a21ada8c5d650e6f7ea1e81781b446f3af0a4e9b19e019930df63096',
 'project/desktop/legacy-source/ledger/inventory_dashboard.py':'5a2616a55beadf3a4b89c380074e83daa0fb2e99c3b639d01e2df56cf34101ad',
 'project/desktop/legacy-source/sidecar_release.py':'380dd17d8c1eee99faba7fce67ff3eb68326d5bef2e35c329d59784fabb0f9f5',
 'project/desktop/legacy-source/ledger/app/templates/stock.html':PIN.template
});
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const need=(value,code)=>{if(!value)throw Error(code);};
const same=(a,b)=>path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
const stamp=s=>[s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs,s.nlink,s.birthtimeNs].map(String).join(':');
function plain(file,directory=false){
 need(path.isAbsolute(file)&&!/^[/\\]{2}/.test(file)&&!file.slice(2).includes(':'),'ORDINARY_LOCAL_PATH_REQUIRED');
 for(let p=file;;p=path.dirname(p)){const s=fs.lstatSync(p);need(!s.isSymbolicLink()&&same(fs.realpathSync.native(p),p)&&(p===file?(directory?s.isDirectory():s.isFile()&&s.nlink===1):s.isDirectory()),'ORDINARY_CANONICAL_PATH_REQUIRED');if(p===path.dirname(p))break;}return file;
}
function read(file,pin,max=1048576){
 plain(file);const before=fs.lstatSync(file,{bigint:true});need(before.size<=BigInt(max),'BOUNDED_INPUT_REQUIRED');const fd=fs.openSync(file,'r');
 try{const opened=fs.fstatSync(fd,{bigint:true}),common=['dev','ino','size','mtimeNs','nlink','birthtimeNs'];need(common.every(k=>before[k]===opened[k]),'INPUT_CHANGED_BEFORE_READ');const bytes=fs.readFileSync(fd),end=fs.fstatSync(fd,{bigint:true}),after=fs.lstatSync(plain(file),{bigint:true});need(stamp(opened)===stamp(end)&&stamp(before)===stamp(after)&&bytes.length===Number(opened.size),'INPUT_CHANGED_DURING_READ');need(!pin||hash(bytes)===pin,'INPUT_PIN_CHANGED');return bytes;}finally{fs.closeSync(fd);}
}
function pinnedSources(){for(const [name,pin]of Object.entries({...CODE,...SOURCES}))read(path.join(ROOT,name),pin,name.endsWith('.exe')?134217728:1048576);}
const sourceBytes=read(SELF),sourceSha256=hash(sourceBytes);pinnedSources();
const {actualGuard}=require(path.join(ROOT,'stage1/guest-candidate-cdp.cjs'));
function actual(){
 // The pinned original guard reads its intentionally mapped RO marker and
 // requires synthetic=true plus equality with this owned ROOT identity.
 const proof=actualGuard(),identity=JSON.parse(read(path.join(ROOT,'isolation-identity.json')));
 need(identity.namespace===NAMESPACE,'EXACT_ROOT36_SYNTHETIC_NAMESPACE_REQUIRED');return proof;
}
actual();
const u=require(path.join(ROOT,'project/desktop/employee-update-cache.cjs')),core=require(path.join(ROOT,'delivery-tools/initial-patch-core.cjs')),builder=require(path.join(ROOT,'stage1/build-full-release.cjs'));
pinnedSources();
async function absent(file){try{await io.lstat(file);}catch(error){if(error.code==='ENOENT')return;throw error;}throw Error('CREATE_NEW_TARGET_REQUIRED: '+file);}
function rowsOf(manifestBytes,releaseBytes){
 const manifest=JSON.parse(manifestBytes),release=JSON.parse(releaseBytes);need(manifest.version===1&&Array.isArray(manifest.modules)&&manifest.modules.length===2&&new Set(manifest.modules.map(m=>m.id)).size===2,'EXACT_TWO_MODULE_MANIFEST_REQUIRED');
 const rows=[{path:'manifest.json',size:99514,sha256:PIN.manifest}];
 for(const id of ['ledger','inventory']){const m=manifest.modules.find(row=>row.id===id);need(m?.purpose==='desktop-release'&&m.runtimeMode==='onedir'&&m.file==='xjy-'+id+'.exe'&&Array.isArray(m.files),'EXACT_ORIGINAL_MODULE_REQUIRED');for(const row of m.files)rows.push({path:'xjy-'+id+'/'+row.path,size:row.size,sha256:row.sha256});}
 need(rows.length===497&&new Set(rows.map(row=>row.path.toLowerCase())).size===497,'EXACT_497_UNIQUE_FILES_REQUIRED');
 for(const row of rows)need(u.safeRelative(row.path)&&Number.isSafeInteger(row.size)&&row.size>=0&&/^[a-f0-9]{64}$/.test(row.sha256),'CANONICAL_MODULE_ROW_REQUIRED');
 const sort=a=>a.slice().sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);rows.splice(0,rows.length,...sort(rows));
 need(release.programVersion==='1.6.2'&&release.resourcesOnly===true&&Array.isArray(release.files)&&release.files.length===1007,'EXACT_PUBLIC_162_RELEASE_REQUIRED');
 const selected=release.files.filter(row=>row.path.startsWith('resources/release-modules/')).map(row=>({path:row.path.slice('resources/release-modules/'.length),size:row.size,sha256:row.sha256}));
 need(JSON.stringify(sort(selected))===JSON.stringify(rows),'ORIGINAL_RELEASE_AND_MODULE_MANIFEST_MUST_AGREE');return rows;
}
async function tree(root,rows){
 await u.assertPath(io,root,{directory:true});const result=await core.inspectArtifactTree({artifactDir:root}),wanted=new Map(rows.map(row=>[row.path,row]));need(result.files.length===rows.length,'EXACT_FILE_SET_REQUIRED');
 for(const row of result.files){const expected=wanted.get(row.path);need(expected&&row.size===expected.size&&row.sha256===expected.sha256,'EXACT_FILE_BYTES_REQUIRED');}
 const dirs=new Set();for(const name of wanted.keys()){const parts=name.split('/');for(let at=1;at<parts.length;at++)dirs.add(parts.slice(0,at).join('/'));}
 const seen=new Set();async function walk(dir,prefix=''){for(const entry of await io.readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name),relative=prefix+entry.name;if(entry.isDirectory()){need(dirs.has(relative)&&!seen.has(relative.toLowerCase()),'EXTRA_OR_DUPLICATE_DIRECTORY_REFUSED');seen.add(relative.toLowerCase());await u.assertPath(io,file,{directory:true,root});await walk(file,relative+'/');}else await u.assertPath(io,file,{root});}}
 await walk(root);need(seen.size===dirs.size,'EXACT_DIRECTORY_SET_REQUIRED');return result;
}
async function inputs(){
 const manifest=read(path.join(SOURCE,'manifest.json'),PIN.manifest),release=read(RELEASE_MANIFEST,PIN.release),proofBytes=read(PROOF_SOURCE,PIN.proof),proof=JSON.parse(proofBytes);
 need(manifest.length===99514&&release.length===332353&&proofBytes.length===155721,'EXACT_METADATA_SIZES_REQUIRED');
 need(proof.candidateExeSha256===PIN.ledger&&proof.candidateSize===8522437&&proof.programFileCount===496&&proof.unchangedOriginalProgramFiles===494&&proof.unknownCodeObjectsVerified===925&&proof.namespacesVerified===6&&proof.prefixExceptChecksumIdentical===true&&proof.archivePayloadExecuted===false&&proof.businessModulesImported===false&&proof.originalInputsUnchanged===true,'EXACT_ORIGINAL_REPACK_PROOF_REQUIRED');
 need(proof.sourcePins?.newFinance===SOURCES['project/desktop/legacy-source/ledger/finance.py']&&proof.sourcePins?.newInventory===SOURCES['project/desktop/legacy-source/ledger/inventory_dashboard.py']&&proof.sourcePins?.newSidecar===SOURCES['project/desktop/legacy-source/sidecar_release.py']&&proof.sourcePins?.newTemplate===PIN.template,'ORIGINAL_PROOF_AND_STATIC_SOURCES_MUST_AGREE');
 const rows=rowsOf(manifest,release),source=await tree(SOURCE,rows),proofTree=await tree(PROOF_ROOT,[{path:'candidate-proof.json',size:155721,sha256:PIN.proof}]);need(source.sha256===PIN.tree&&source.files.reduce((n,row)=>n+row.size,0)===71837079,'EXACT_COMPLETE_MODULE_TREE_REQUIRED');
 const collected=builder.collectModuleResources(SOURCE).map(row=>({path:row.relative.slice('resources/release-modules/'.length),size:row.size,sha256:row.sha256})).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 need(JSON.stringify(collected)===JSON.stringify(rows),'ORIGINAL_BUILDER_REJECTED_MODULE_INPUT');pinnedSources();
 need(read(path.join(SOURCE,'manifest.json'),PIN.manifest).equals(manifest)&&read(RELEASE_MANIFEST,PIN.release).equals(release)&&read(PROOF_SOURCE,PIN.proof).equals(proofBytes),'SOURCE_METADATA_CHANGED');
 return{rows,source,proofTree,manifestSha256:PIN.manifest,proofSha256:PIN.proof,releaseSha256:PIN.release};
}
async function writeReport(value){
 const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n');await absent(REPORT);const opened=await u.openChecked(io,REPORT,'wx+',{missing:true,root:RESULTS});
 try{await u.writeExactly(opened.handle,0,bytes);await opened.handle.sync();await u.assertHandle(io,opened,{snapshot:false,root:RESULTS});}finally{await opened.handle.close();}
 const verified=await core.fileHash(io,REPORT,RESULTS);need(verified.size===bytes.length&&verified.sha256===hash(bytes),'CREATE_NEW_REPORT_READBACK_FAILED');return{file:REPORT,size:verified.size,sha256:verified.sha256};
}
async function main(){
 const start=new Date().toISOString(),initialGuest=actual();await u.assertPath(io,ROOT,{directory:true});await u.assertPath(io,path.join(ROOT,'release-work'),{directory:true});await u.assertPath(io,RESULTS,{directory:true});
 await absent(RUN);await absent(REPORT);const source=await inputs();need(read(SELF).equals(sourceBytes),'STAGER_SOURCE_CHANGED');actual();pinnedSources();await absent(RUN);await absent(REPORT);
 await io.mkdir(RUN,{mode:0o700});await u.assertPath(io,RUN,{directory:true,root:ROOT});const runIdentity=u.statIdentity(await u.assertPath(io,RUN,{directory:true,root:ROOT}));await core.mkdirs(io,RUN,'modules-input');
 for(const row of source.rows){await core.mkdirs(io,TARGET,row.path.split('/').slice(0,-1).join('/'));await core.copy(io,path.join(SOURCE,...row.path.split('/')),path.join(TARGET,...row.path.split('/')),row,SOURCE,TARGET);}
 await core.copy(io,PROOF_SOURCE,PROOF_TARGET,{size:155721,sha256:PIN.proof},PROOF_ROOT,RUN);
 const target=await tree(TARGET,source.rows);need(target.sha256===PIN.tree,'DESTINATION_MODULE_TREE_CHANGED');
 const runRows=[...source.rows.map(row=>({...row,path:'modules-input/'+row.path})),{path:'candidate-proof.json',size:155721,sha256:PIN.proof}],runTree=await tree(RUN,runRows);
 const collected=builder.collectModuleResources(TARGET).map(row=>({path:row.relative.slice('resources/release-modules/'.length),size:row.size,sha256:row.sha256})).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);need(JSON.stringify(collected)===JSON.stringify(source.rows),'ORIGINAL_BUILDER_DESTINATION_CHECK_FAILED');
 const finalSource=await inputs();need(JSON.stringify(finalSource)===JSON.stringify(source),'SOURCE_TREE_IDENTITY_OR_BYTES_CHANGED');need((await core.fileHash(io,PROOF_TARGET,RUN)).sha256===PIN.proof&&read(SELF).equals(sourceBytes),'PROOF_OR_STAGER_SOURCE_CHANGED');
 pinnedSources();const finalGuest=actual();need(u.statIdentity(await u.assertPath(io,RUN,{directory:true,root:ROOT}))===runIdentity,'DESTINATION_ROOT_IDENTITY_CHANGED');need(JSON.stringify(await tree(RUN,runRows))===JSON.stringify(runTree),'DESTINATION_CHANGED_AFTER_VERIFICATION');await absent(REPORT);
 const result=await writeReport({version:1,purpose:'release162-a3-fixed-original-module-input-staging',namespace:NAMESPACE,startedAt:start,completedAt:new Date().toISOString(),sourceSha256,sourceRoot:SOURCE,proofSource:PROOF_SOURCE,moduleRun:RUN,moduleTarget:TARGET,proofTarget:PROOF_TARGET,sourceTreeSha256:source.source.sha256,targetTreeSha256:target.sha256,runTreeSha256:runTree.sha256,fileCount:497,totalModuleBytes:71837079,proofBytes:155721,proofSha256:PIN.proof,manifestSha256:PIN.manifest,releaseManifestSha256:PIN.release,codePins:CODE,staticSourcePins:SOURCES,initialGuest,finalGuest,allSourceAndTargetBytesVerified:true,createNewOnly:true,moduleExecuted:false,moduleImported:false,pycCompiled:false,programExecuted:false,servicesStarted:false,databaseOpened:false,privateKeyRead:false,signed:false,installed:false});console.log(JSON.stringify({...result,passed:true,fileCount:497,moduleExecuted:false,programExecuted:false}));
}
main().catch(error=>{console.error(JSON.stringify({purpose:'release162-a3-fixed-original-module-input-staging',passed:false,error:error.message,moduleExecuted:false,moduleImported:false,pycCompiled:false,programExecuted:false,installed:false,failedObjectsRetained:true}));process.exitCode=1;});

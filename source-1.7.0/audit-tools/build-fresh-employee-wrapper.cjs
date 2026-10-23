'use strict';
// Root-only data build. No tool/engine/installer execution and no downloads.
// Root stages and packages only the fixed reviewed sources below: node this-file.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const W=path.resolve(__dirname,'..'),u=require('../project/desktop/employee-update-cache.cjs'),core=require('../delivery-tools/initial-patch-core.cjs'),zip=require('../stage1/build-initial-patch.cjs');
const INPUT=path.join(W,'release-work/initial-fresh-employee-input-a1'),OUTPUT=path.join(W,'release-work/initial-fresh-employee-package-a1'),ARCHIVE=path.join(W,'release/initial-fresh-employee-161-a1.zip');
const R='E:\\codex\\2026-10-13\\work\\xjy-web-stage1',ENGINE=path.join(R,'sandbox/input/package-v10/release-candidate'),ENGINE_MANIFEST=path.join(ENGINE,'engine-allowlist.json');
const RESOURCES=path.join(W,'release-work/initial-161-resource-input-a1'),FEED=path.join(W,'release-work/initial-161-feed-a1');
const SEALED=path.join(W,'sandbox/results/release-161-artifact-a1/release-manifest.json');
const TRUST='安装组件/delivery-tools/fresh-employee-trust.json',PIN='6e8b9cadb59aeb53f30d41f4471f70f644f0dfc7376ffb9d8a4c62defb98458c';
const TOOLS=['delivery-tools/fresh-employee-install.cjs','delivery-tools/initial-patch-core.cjs','delivery-tools/initial-patch-entry.cjs','project/desktop/employee-update-cache.cjs','project/desktop/employee-update-installer.cjs'];
function check(value,message){if(!value)throw Error(message)}
async function create(file,bytes,root=OUTPUT){await core.mkdirs(fs,root,path.relative(root,path.dirname(file)).split(path.sep).join('/'));const opened=await u.openChecked(fs,file,'wx+',{missing:true,root});try{await u.writeExactly(opened.handle,0,bytes);await opened.handle.sync();await u.assertHandle(fs,opened,{snapshot:false,root});}finally{await opened.handle.close();}}
async function main(){
 check(process.platform==='win32'&&W.toLowerCase()==='e:\\codex\\2026-10-15\\work\\xjy-v16-deep-audit','Fixed Root data build workspace required');
 check(process.argv.length===2,'No source or trust override arguments allowed');
 const engineBytes=await u.readSmall(fs,ENGINE_MANIFEST,2097152);check(u.digest(engineBytes)==='6893a279e6ab2ccaae36c9c66fd8c840ef4dacddc9cd9c78c24f87dd3f311ea4','Reviewed engine72 metadata changed');const engine=JSON.parse(engineBytes);
 const sealedBytes=await u.readSmall(fs,SEALED,2097152);check(u.digest(sealedBytes)==='e1ff037d5fdb819561719c44487455c676fb90f8e8c18ff54509fbe155828095','Reviewed sealed161 metadata changed');const sealed=JSON.parse(sealedBytes);
 const envelopeBytes=await u.readSmall(fs,path.join(FEED,'catalog.json'),2097152);check(u.digest(envelopeBytes)==='68255c8157b5be98bba5c3376a3b06605272123a3536638a74b1fd713d2257e8','Reviewed signed161 catalog changed');
 check(engine.executableName==='鑫金源珠宝报价.exe'&&engine.files.length===72&&sealed.programVersion==='1.6.1'&&sealed.files.length===1007,'Fixed actual engine72/sealed161 required');
 const trust={targetVersion:'1.6.1',executableName:engine.executableName,publisherPublicKeySha256:PIN,engineVersion:'44.7.0',engineFiles:engine.files.map(({path,size,sha256})=>({path,size,sha256})),allowedResourceFiles:sealed.files.map(f=>f.path)};
 const trustBytes=Buffer.from(JSON.stringify(trust,null,2)+'\n'),trustSha=u.digest(trustBytes);
 const sourcePublic=crypto.createPublicKey(await u.readSmall(fs,path.join(FEED,'publisher-public.pem'),8192));check(u.digest(sourcePublic.export({type:'spki',format:'der'}))===PIN,'Original signed-feed publisher required');
 const sourceCatalog=u.verifySignedCatalog(JSON.parse(envelopeBytes),u.createTrustedUpdatePolicy({trustedPublicKey:sourcePublic,allowedFiles:trust.allowedResourceFiles,currentVersion:'1.6.1',platform:'win32',arch:'x64'}));
 const sealedMap=new Map(sealed.files.map(f=>[f.path,f]));check(sourceCatalog.version==='1.6.1'&&sourceCatalog.files.length===1007&&sourceCatalog.files.every(f=>sealedMap.get(f.path)?.size===f.size&&sealedMap.get(f.path)?.sha256===f.sha256),'Signed feed and sealed resources differ');
 await core.mkdirs(fs,W,'release-work');await fs.mkdir(INPUT);await u.assertPath(fs,INPUT,{directory:true,root:W});
 for(const file of trust.engineFiles){const name='安装文件/engine/'+file.path;check(u.safeRelative(name),'Unsafe engine input');await core.mkdirs(fs,INPUT,name.split('/').slice(0,-1).join('/'));await core.copy(fs,path.join(ENGINE,...file.path.split('/')),path.join(INPUT,...name.split('/')),file,ENGINE,INPUT)}
 for(const file of sealed.files){const name='安装文件/'+file.path;await core.mkdirs(fs,INPUT,name.split('/').slice(0,-1).join('/'));await core.copy(fs,path.join(RESOURCES,...file.path.split('/')),path.join(INPUT,...name.split('/')),file,RESOURCES,INPUT)}
 for(const relative of TOOLS){const value=await core.fileHash(fs,path.join(W,...relative.split('/')),W),name='安装组件/'+relative;await core.mkdirs(fs,INPUT,name.split('/').slice(0,-1).join('/'));await core.copy(fs,path.join(W,...relative.split('/')),path.join(INPUT,...name.split('/')),value,W,INPUT)}
 await create(path.join(INPUT,...TRUST.split('/')),trustBytes,INPUT);
 for(const [from,name]of [[path.join(FEED,'publisher-public.pem'),'安装文件/publisher-public.pem'],[path.join(FEED,'catalog.json'),'安装文件/catalog-envelope.json']]){const value=await core.fileHash(fs,from,FEED);await core.copy(fs,from,path.join(INPUT,...name.split('/')),value,FEED,INPUT)}
 check(trust.targetVersion==='1.6.1'&&trust.engineVersion==='44.7.0'&&trust.executableName==='鑫金源珠宝报价.exe'&&trust.publisherPublicKeySha256===PIN&&Array.isArray(trust.engineFiles)&&trust.engineFiles.length===72,'Fixed employee161/engine72/original publisher trust required');
 const pub=crypto.createPublicKey(await u.readSmall(fs,path.join(INPUT,'安装文件/publisher-public.pem'),8192));check(pub.asymmetricKeyType==='ed25519'&&u.digest(pub.export({type:'spki',format:'der'}))===PIN,'Original publisher required');
 const envelope=JSON.parse(await u.readSmall(fs,path.join(INPUT,'安装文件/catalog-envelope.json'),2097152));const catalog=u.verifySignedCatalog(envelope,u.createTrustedUpdatePolicy({trustedPublicKey:pub,allowedFiles:trust.allowedResourceFiles,currentVersion:'1.6.1',platform:'win32',arch:'x64'}));
 check(catalog.version==='1.6.1'&&catalog.files.length===trust.allowedResourceFiles.length&&catalog.files.every(f=>require('../project/desktop/employee-update-installer.cjs').programPath(f.path)),'Exact signed resources required');
 const expected=new Map();function add(name,size,sha256){check(u.safeRelative(name)&&Number.isSafeInteger(size)&&size>=0&&/^[a-f0-9]{64}$/.test(sha256)&&!expected.has(name.toLowerCase()),'Invalid/duplicate fixed package member');expected.set(name.toLowerCase(),{path:name,size,sha256});}
 for(const file of trust.engineFiles){check(u.safeRelative(file.path),'Unsafe engine member');add('安装文件/engine/'+file.path,file.size,file.sha256)}
 for(const file of catalog.files)add('安装文件/'+file.path,file.size,file.sha256);
 for(const relative of TOOLS){const current=await core.fileHash(fs,path.join(W,...relative.split('/')),W);if(relative==='delivery-tools/fresh-employee-install.cjs')check(current.sha256==='70b715c874e5fb2f23f5cd41d3cc96a0da9f1c8b7a9bc2398983e2134badd806','Reviewed fresh tool changed');add('安装组件/'+relative,current.size,current.sha256)}
 for(const name of [TRUST,'安装文件/publisher-public.pem','安装文件/catalog-envelope.json']){const value=await core.fileHash(fs,path.join(INPUT,...name.split('/')),INPUT);add(name,value.size,value.sha256)}
 const before=await core.inspectArtifactTree({artifactDir:INPUT});check(before.files.length===expected.size&&before.files.every(f=>{const e=expected.get(f.path.toLowerCase());return e&&f.path===e.path&&f.size===e.size&&f.sha256===e.sha256}),'Staged package has extra/missing/changed files');
 await core.mkdirs(fs,W,'release-work');await fs.mkdir(OUTPUT);await u.assertPath(fs,OUTPUT,{directory:true,root:W});
 for(const file of before.files){await core.mkdirs(fs,OUTPUT,file.path.split('/').slice(0,-1).join('/'));await core.copy(fs,path.join(INPUT,...file.path.split('/')),path.join(OUTPUT,...file.path.split('/')),file,INPUT,OUTPUT)}
 const guard=await u.readSmall(fs,path.join(W,'delivery-tools/Initial-Path-Guard.ps1'),65536),template=await u.readSmall(fs,path.join(W,'audit-tools/fresh-employee-wrapper.ps1.in'),1048576);
 const rows=before.files.map(({identity,...value})=>value),payload=Buffer.from(JSON.stringify(rows)).toString('base64');let ps=template.toString('utf8');
 for(const [token,value]of [['@@PATH_GUARD@@',guard.toString('utf8')],['@@FILES_BASE64@@',payload],['@@TRUST_SHA@@',trustSha]]){check(ps.split(token).length===2,'Exactly one fixed wrapper placeholder required');ps=ps.replace(token,()=>value)}
 const psBytes=Buffer.from(ps,'utf8'),psSha=u.digest(psBytes);await create(path.join(OUTPUT,'安装组件/fresh-employee-wrapper.ps1'),psBytes);
 // Path is data in an environment variable. Read once, hash the exact bytes,
 // then execute those same UTF8 bytes; no ExecutionPolicy setting is changed.
 const command="$p=Join-Path $env:XJY_FRESH_PACKAGE_ROOT '安装组件\\fresh-employee-wrapper.ps1';$b=[IO.File]::ReadAllBytes($p);$h=[Security.Cryptography.SHA256]::Create();try{$s=([BitConverter]::ToString($h.ComputeHash($b))).Replace('-','').ToLowerInvariant()}finally{$h.Dispose()};if($s -cne '"+psSha+"'){throw '安装包装器校验失败'};& ([ScriptBlock]::Create([Text.Encoding]::UTF8.GetString($b))) -PackageRoot $env:XJY_FRESH_PACKAGE_ROOT";
 const cmd='@echo off\r\nchcp 65001 >nul\r\nsetlocal DisableDelayedExpansion\r\nset "XJY_FRESH_PACKAGE_ROOT=%~dp0"\r\n"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoLogo -NoProfile -NonInteractive -STA -Command "'+command+'"\r\nset "XJY_FRESH_EXIT=%ERRORLEVEL%"\r\nif not "%XJY_FRESH_EXIT%"=="0" pause\r\nendlocal & exit /b %XJY_FRESH_EXIT%\r\n';
 await create(path.join(OUTPUT,'安装员工端.cmd'),Buffer.from(cmd,'utf8'));
 check((await core.inspectArtifactTree({artifactDir:INPUT})).sha256===before.sha256,'Source changed while packaging');const tree=await core.inspectArtifactTree({artifactDir:OUTPUT});check(tree.files.length===before.files.length+2,'Wrapper package extra files');
 await core.mkdirs(fs,W,'release');const archive=await zip.writeStoredZip({artifactDir:OUTPUT,archiveFile:ARCHIVE});
 const proof={version:'1.6.1',purpose:'fresh-employee-zip-wrapper',directory:OUTPUT,archiveFile:ARCHIVE,archive,treeSha256:tree.sha256,trustSha256:trustSha,wrapperSha256:psSha,engineFiles:72,fileCount:tree.files.length,toolFiles:TOOLS,unsigned:true,authenticodeSigned:false,installed:false,programExecuted:false,downloadedTools:false,executionPolicyChanged:false};
 const report=path.join(W,'reports/fresh-employee-wrapper-build-a1.json'),opened=await u.openChecked(fs,report,'wx+',{missing:true,root:W});try{await u.writeExactly(opened.handle,0,Buffer.from(JSON.stringify(proof,null,2)+'\n'));await opened.handle.sync()}finally{await opened.handle.close()};console.log(JSON.stringify(proof));
}
main().catch(error=>{console.error(error.stack);process.exitCode=1});

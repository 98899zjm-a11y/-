'use strict';
// Fresh program copy primitive for an explicit host/employee role. The outside wrapper must authenticate this
// complete helper closure, the trust bytes and all 72 engine files BEFORE it
// executes the packaged engine in RUN_AS_NODE mode. No business DB initialization.
const fs=process.versions.electron?require('original-fs').promises:require('node:fs/promises');
const path=require('node:path'),crypto=require('node:crypto');
const core=require('./initial-patch-core.cjs');
const u=require('../project/desktop/employee-update-cache.cjs');
const {programPath}=require('../project/desktop/employee-update-installer.cjs');

const VERSIONS=Object.freeze(['1.7.0']),ENGINE='44.9.0',EXE='鑫金源珠宝报价.exe';
const PUBLISHER='6e8b9cadb59aeb53f30d41f4471f70f644f0dfc7376ffb9d8a4c62defb98458c';
const MARKER='xjy-install-activation.json',SHA=/^[a-f0-9]{64}$/;
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&Object.keys(v).every(k=>keys.includes(k));
const inside=(root,value)=>{const r=path.relative(root,value);return r===''||r!=='..'&&!r.startsWith('..'+path.sep)&&!path.isAbsolute(r);};
function existing(){u.fail('EXISTING_INSTALLATION','目标目录已经存在。已装员工端请使用软件内一键升级；已有主机请使用主机补丁，不覆盖原目录。');}

function readTrust(value){
 if(!exact(value,['targetVersion','executableName','publisherPublicKeySha256','engineVersion','engineFiles','allowedResourceFiles'])||!VERSIONS.includes(value.targetVersion)||value.engineVersion!==ENGINE||value.executableName!==EXE||!SHA.test(value.publisherPublicKeySha256||'')||!Array.isArray(value.engineFiles)||value.engineFiles.length!==72||!Array.isArray(value.allowedResourceFiles)||!value.allowedResourceFiles.length||value.allowedResourceFiles.length>4096)u.fail('BAD_TRUST','固定员工完整包信任清单不完整');
 const files=value.engineFiles.map(f=>{
  if(!exact(f,['path','size','sha256'])||!u.safeRelative(f.path)||!Number.isSafeInteger(f.size)||f.size<0||f.size>u.MAX_ARCHIVE||!SHA.test(f.sha256||'')||f.path.split('/').some(p=>/^(resources|data|profiles?|private|credentials|backups?)$/i.test(p))||/\.(db(?:-wal|-shm)?|sqlite3?|pem|pfx|key)$/i.test(f.path)||f.path.toLowerCase()===MARKER)u.fail('BAD_TRUST','引擎清单含不允许的路径或摘要');
  return{path:f.path,size:f.size,sha256:f.sha256};
 });
 const resources=value.allowedResourceFiles.slice(),all=[...files.map(f=>f.path),...resources];
 if(resources.some(f=>!programPath(f))||!resources.includes('resources/app.asar')||!files.some(f=>f.path===EXE)||new Set(all.map(f=>f.toLowerCase())).size!==all.length)u.fail('BAD_TRUST','程序路径不完整、重复或冲突');
 const total=files.reduce((n,f)=>n+f.size,0);if(!Number.isSafeInteger(total)||total>1073741824)u.fail('BAD_TRUST','引擎总大小超过上限');
 return u.freeze({...value,engineFiles:files,allowedResourceFiles:resources});
}

async function absent(io,file){try{await io.lstat(file,{bigint:true});return false;}catch(e){if(e.code==='ENOENT')return true;throw e;}}
async function ordinaryParent(io,target){
 // Locate an existing ordinary ancestor without creating anything. assertPath
 // checks every ancestor and rejects junctions, aliases and symbolic links.
 for(let p=path.dirname(target);;p=path.dirname(p)){
  try{await u.assertPath(io,p,{directory:true});return p;}catch(e){if(e.code!=='ENOENT')throw e;}
  if(p===path.dirname(p))u.fail('UNSAFE_PATH','安装目录没有可核验的普通父目录');
 }
}
function directoryNames(files){const dirs=new Set();for(const f of files){let p=path.posix.dirname(f.path);while(p!=='.'){dirs.add(p);p=path.posix.dirname(p);}}return dirs;}
async function exactTree(io,root,files){
 const tree=await core.inspectArtifactTree({artifactDir:root,fileSystem:io});
 const expected=new Map(files.map(f=>[f.path,f]));
 if(tree.files.length!==expected.size||tree.files.some(f=>{const e=expected.get(f.path);return!e||e.size!==f.size||e.sha256!==f.sha256;}))u.fail('ARTIFACT_CHANGED','完整程序树有缺失、额外文件或摘要不符');
 // The shared file-tree hash intentionally hashes files only. Reject extra
 // empty directories as well, rather than accepting an undeclared profile.
 const allowedDirs=directoryNames(files);
 async function walk(dir,relative=''){
  for(const name of await io.readdir(dir)){
   const rel=relative+name,p=path.join(dir,name),s=await io.lstat(p,{bigint:true});
   if(s.isDirectory()){
    if(!allowedDirs.has(rel))u.fail('ARTIFACT_CHANGED','完整程序树含未声明目录');
    await u.assertPath(io,p,{directory:true,root});await walk(p,rel+'/');
   }
  }
 }
 await walk(root);return tree;
}
async function verifyArtifact(io,artifact,trust,now){
 const VERSION=trust.targetVersion;
 const first=await core.inspectArtifactTree({artifactDir:artifact,fileSystem:io});
 const pem=await u.readSmall(io,path.join(artifact,'publisher-public.pem'),4096);
 if(pem.toString('utf8').includes('PRIVATE KEY'))u.fail('BAD_PUBLIC_KEY','完整包不得携带私钥');
 let key;try{key=crypto.createPublicKey(pem);}catch{u.fail('BAD_PUBLIC_KEY','发布公钥无效');}
 if(key.asymmetricKeyType!=='ed25519'||u.digest(key.export({type:'spki',format:'der'}))!==trust.publisherPublicKeySha256)u.fail('BAD_PUBLIC_KEY','发布公钥与包外固定信任根不符');
 let envelope;const envelopeBytes=await u.readSmall(io,path.join(artifact,'catalog-envelope.json'),2097152);
 try{envelope=JSON.parse(envelopeBytes);}catch{u.fail('BAD_CATALOG','签名目录无法读取');}
 const policy=u.createTrustedUpdatePolicy({trustedPublicKey:key,currentVersion:VERSION,allowedFiles:trust.allowedResourceFiles,platform:'win32',arch:'x64',now});
 const catalog=u.verifySignedCatalog(envelope,policy);
 if(catalog.version!==VERSION||catalog.files.length!==trust.allowedResourceFiles.length||catalog.files.some(f=>!programPath(f.path)))u.fail('BAD_CATALOG','资源必须是完整'+VERSION+'员工程序');
 const program=[...trust.engineFiles,...catalog.files];
 const source=[...trust.engineFiles.map(f=>({...f,path:'engine/'+f.path})),...catalog.files,
  {path:'publisher-public.pem',size:pem.length,sha256:u.digest(pem)},
  {path:'catalog-envelope.json',size:envelopeBytes.length,sha256:u.digest(envelopeBytes)}];
 const checked=await exactTree(io,artifact,source);
 if(checked.sha256!==first.sha256)u.fail('ARTIFACT_CHANGED','读取期间完整包已经变化');
 const pkg=await core.packageIdentity(io,path.join(artifact,'resources/app.asar'),artifact);
 if(pkg.version!==VERSION||pkg.main!=='release-entry.cjs')u.fail('BAD_PROGRAM','目标ASAR不是固定'+VERSION+'发布入口');
 return{program,source,treeSha256:checked.sha256};
}

async function installFreshProgram(options){
 if(!options||typeof options!=='object'||Object.keys(options).some(k=>!['artifactDir','installDir','localAppData','trust','now','launch','fileSystem','role','commit'].includes(k))||typeof options.launch!=='function'||typeof options.commit!=='function'||!['host','employee'].includes(options.role)||options.now!==undefined&&typeof options.now!=='function')u.fail('BAD_INSTALL','必须明确主机或员工角色及受信提交接口');
 const role=options.role,io=options.fileSystem||fs,trust=readTrust(options.trust),VERSION=trust.targetVersion,now=options.now||Date.now;
 const artifact=u.safeAbsolute(options.artifactDir),local=u.safeAbsolute(options.localAppData);
 const target=u.safeAbsolute(options.installDir===undefined?path.join(local,'鑫金源珠宝',role==='host'?'主机程序':'员工程序'):options.installDir);
 if(inside(artifact,target)||inside(target,artifact)||u.samePath(target,local)||target===path.parse(target).root||target.split(/[\\/]/).some(p=>/^(data|profiles?|private|credentials|backups?|员工本地设置|员工客户端缓存|鑫金源珠宝员工端)$/i.test(p))||['F:\\自制软件','F:\\鑫金源珠宝资料'].some(p=>inside(p,target)))u.fail('UNSAFE_PATH','请使用普通的新员工程序目录，不要选择安装包、业务资料或个人配置目录');
 await u.assertPath(io,local,{directory:true});await u.assertPath(io,artifact,{directory:true});
 if(!await absent(io,target))existing();
 const anchor=await ordinaryParent(io,target),anchorIdentity=u.statIdentity(await u.assertPath(io,anchor,{directory:true}));
 const verified=await verifyArtifact(io,artifact,trust,now);
 // Nothing above this line creates a destination or a profile.
 const directories=new Map([[anchor,anchorIdentity]]);
 async function checkDirectories(){for(const [p,id]of directories){if(u.statIdentity(await u.assertPath(io,p,{directory:true}))!==id)u.fail('FILE_CHANGED','安装目录身份已变化');}}
 async function makeDirectory(p,{exclusive=false}={}){
  await checkDirectories();
  try{await io.mkdir(p,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;if(exclusive)existing();}
  const stat=await u.assertPath(io,p,{directory:true});directories.set(p,u.statIdentity(stat));
 }
 let parent=anchor;
 const relParent=path.relative(anchor,path.dirname(target));
 for(const name of relParent.split(path.sep).filter(Boolean)){parent=path.join(parent,name);await makeDirectory(parent);}
 await checkDirectories();if(!await absent(io,target))existing();await makeDirectory(target,{exclusive:true});
 const rootIdentity=directories.get(target);
 async function programParent(relative){
  let p=target;
  for(const name of relative.split('/').filter(Boolean)){
   p=path.join(p,name);if(!directories.has(p))await makeDirectory(p);
  }
 }
 for(const file of verified.program){
  await programParent(path.posix.dirname(file.path)==='.'?'':path.posix.dirname(file.path));await checkDirectories();
  const source=trust.engineFiles.some(f=>f.path===file.path)?path.join(artifact,'engine',...file.path.split('/')):path.join(artifact,...file.path.split('/'));
  await core.copy(io,source,path.join(target,...file.path.split('/')),file,artifact,target);
 }
 await checkDirectories();await exactTree(io,target,verified.program);
 if((await exactTree(io,artifact,verified.source)).sha256!==verified.treeSha256)u.fail('ARTIFACT_CHANGED','复制期间完整包已经变化，未启用新程序');
 const pkg=await core.packageIdentity(io,path.join(target,'resources/app.asar'),target);
 if(pkg.version!==VERSION||pkg.main!=='release-entry.cjs')u.fail('BAD_PROGRAM','复制后的发布入口不符');
 await checkDirectories();
 if(u.statIdentity(await u.assertPath(io,target,{directory:true}))!==rootIdentity)u.fail('FILE_CHANGED','新安装目录已被替换');
 const activation={version:1,product:core.PRODUCT,programVersion:VERSION,role,installationDir:target};
 const marker=path.join(target,MARKER),bytes=Buffer.from(JSON.stringify(activation)+'\n');let opened;
 try{
  opened=await u.openChecked(io,marker,'wx+',{missing:true,root:target});
  await u.writeExactly(opened.handle,0,bytes);await opened.handle.sync();
  const stat=await u.assertHandle(io,opened,{snapshot:false,root:target});
  if(stat.size!==BigInt(bytes.length)||(await u.readExactly(opened.handle,0,bytes.length)).compare(bytes)!==0)u.fail('BAD_ACTIVATION','员工启用标记写入不完整');
  await opened.handle.close();opened.handle=null;
  await checkDirectories();
  const actual=await exactTree(io,target,[...verified.program,{path:MARKER,size:bytes.length,sha256:u.digest(bytes)}]);
  if(actual.files.length!==verified.program.length+1)u.fail('BAD_ACTIVATION','员工安装树不完整');
 }catch(error){
  // Remove only the marker whose newly-created identity we still own. Never
  // remove/retry another process's object or recursively clean a partial tree.
  if(opened){try{await opened.handle?.close();}catch(closeError){error.activationCloseError=closeError.code||closeError.message;}
   try{const s=await u.assertPath(io,marker,{root:target});if(u.statIdentity(s)!==opened.identity)u.fail('FILE_CHANGED','启用标记已被替换');await io.unlink(marker);}catch(cleanupError){error.activationCleanupError=cleanupError.code||cleanupError.message;}}
  throw error;
 }
 const committed=await options.commit({installationDir:target,role,version:VERSION,engineVersion:ENGINE});
 if(!committed||committed.committed!==true||committed.version!==VERSION||committed.engineVersion!==ENGINE||committed.role!==role||!u.samePath(committed.installationDir,target)||!u.UUID.test(committed.transactionId||''))u.fail('FRESH_COMMIT_REQUIRED','完整程序尚未取得真实受信提交收据，未启动。');
 const request={executablePath:path.join(target,trust.executableName),args:role==='employee'?['--employee-client']:[],role};
 // Installation completion and process spawn are separate facts. A launch
 // failure must not invite overwriting the successfully installed directory.
 try{const result=await options.launch(request);return{installed:true,version:VERSION,role,installationDir:target,launched:result?.started===true,...(result?.started===true?{}:{launchError:'LAUNCH_NOT_CONFIRMED'})};}
 catch(error){return{installed:true,version:VERSION,role,installationDir:target,launched:false,launchError:error.code||'LAUNCH_FAILED'};}
}

module.exports={installFreshProgram};

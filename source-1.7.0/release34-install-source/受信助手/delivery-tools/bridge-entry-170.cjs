'use strict';
// This exact file becomes the maintenance-only ASAR release-entry.cjs and a
// signed, non-executed copy in the outside worker. It never imports business.
const path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const nativeFs=process.versions.electron?require('original-fs'):require('node:fs'),vfs=require('node:fs');
const SHA=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const KEY_SHA='6e8b9cadb59aeb53f30d41f4471f70f644f0dfc7376ffb9d8a4c62defb98458c';
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function fail(code,message){throw Object.assign(Error(message),{code});}
function exact(value,keys){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));}
function spec(value,name){if(!exact(value,['path','size','sha256'])||value.path!==name||!Number.isSafeInteger(value.size)||value.size<1||value.size>805306368||!SHA.test(value.sha256||''))fail('BRIDGE_CONFIG','升级材料说明不完整');return value;}
function validateConfig(value){
 if(!exact(value,['version','purpose','publicationId','targetCatalogSha256','bindingSha256','payload','manifest','extractor','bootstrap'])||value.version!==1||value.purpose!=='xjy-bridge170'||['publicationId','targetCatalogSha256','bindingSha256'].some(k=>!SHA.test(value[k]||'')))fail('BRIDGE_CONFIG','升级衔接配置不完整');
 spec(value.payload,'bridge-assets/bundle.zip');spec(value.manifest,'bridge-assets/bundle-manifest.json');spec(value.extractor,'bridge-assets/Extract-Bridge170.ps1');spec(value.bootstrap,'安装组件/native-delivery-170.ps1');
 if(value.manifest.size>4194304||value.extractor.size>262144||value.bootstrap.size>4194304)fail('BRIDGE_CONFIG','升级说明超过上限');return value;
}
async function originalCommit({u,io,installDir,profileDir,publicKey,allowedFiles}){
 const journal=await u.authenticatedRead(io,path.join(installDir,'.xjy-employee-updates/journal.json'),profileDir,8388608);
 const status=await u.authenticatedRead(io,path.join(installDir,'.xjy-employee-updates/recovery-status.json'),profileDir,4096);
 if(journal.version!==1||journal.phase!=='committed'||!UUID.test(journal.transactionId||'')||!['1.6.0','1.6.1','1.6.2'].includes(journal.expectedVersion)||!u.samePath(journal.installDir,installDir)||!exact(status,['version','phase','transactionId','expectedVersion','targetVersion'])||status.version!==1||status.phase!=='committed'||status.transactionId!==journal.transactionId||status.expectedVersion!==journal.expectedVersion||status.targetVersion!=='1.7.0')fail('BRIDGE_NOT_COMMITTED','第一段更新尚未确认，请保留原更新记录');
 const policy=u.createTrustedUpdatePolicy({trustedPublicKey:publicKey,currentVersion:journal.expectedVersion,allowedFiles,platform:'win32',arch:'x64'});
 const catalog=u.verifySignedCatalog(journal.envelope,policy);
 if(catalog.version!=='1.7.0'||catalog.files.length!==allowedFiles.length)fail('BRIDGE_WRONG_RELEASE','不是本次完整衔接资源');
 const row=catalog.files.find(x=>x.path==='resources/app.asar');if(!row)fail('BRIDGE_WRONG_RELEASE','缺少签名程序身份');
 const opened=await u.openChecked(io,path.join(installDir,'resources/app.asar'),'r',{root:installDir});
 try{const s=await u.assertHandle(io,opened,{root:installDir});if(Number(s.size)!==row.size||await u.hashHandle(opened.handle,row.size)!==row.sha256)fail('BRIDGE_CHANGED','衔接程序与已批准的更新不一致');await u.assertHandle(io,opened,{root:installDir});}finally{await opened.handle.close();}
 return {journal,catalog};
}
async function copyPacked({u,io,root,source,spec:expected,target}){
 const destination=path.join(root,target);await u.assertPath(io,root,{directory:true});
 try{const opened=await u.openChecked(io,destination,'r',{root});try{const s=await u.assertHandle(io,opened,{root});if(Number(s.size)!==expected.size||await u.hashHandle(opened.handle,expected.size)!==expected.sha256)fail('BRIDGE_CACHE_CHANGED','上次升级材料未完整保存，请保留现场并联系管理员');await u.assertHandle(io,opened,{root});return destination;}finally{await opened.handle.close();}}catch(e){if(e.code!=='ENOENT')throw e;}
 const opened=await u.openChecked(io,destination,'wx+',{missing:true,root}),digest=crypto.createHash('sha256');let position=0;
 try{for await(const bytes of vfs.createReadStream(source)){if(position+bytes.length>expected.size)fail('BRIDGE_PAYLOAD_CHANGED','升级材料大小不符');digest.update(bytes);await u.writeExactly(opened.handle,position,bytes);position+=bytes.length;}if(position!==expected.size||digest.digest('hex')!==expected.sha256)fail('BRIDGE_PAYLOAD_CHANGED','升级材料校验失败');await opened.handle.sync();await u.assertHandle(io,opened,{snapshot:false,root});}finally{await opened.handle.close();}
 return destination;
}
function runPs(scriptFile,parameters,environment,{wait=true,expectedSha}={}){
 // Reuse the installed launchers' UTF-8 ScriptBlock mechanism, with a held,
 // hash-verified read-only script handle. Never change execution policy.
 if(!SHA.test(expectedSha||'')||!parameters||Object.keys(parameters).some(k=>!['OperationRoot','ArchiveSha256','ManifestSha256','PackageRoot','Action'].includes(k))||Object.values(parameters).some(v=>typeof v!=='string'||/[\x00-\x1f]/.test(v)))fail('BRIDGE_PS','原生启动参数不规范');
 const quote=value=>"'"+value.replaceAll("'","''")+"'";
 const values=Object.entries(parameters).map(([k,v])=>k+'='+quote(v)).join(';');
 const command="$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$stream=$null;try{$stream=[IO.File]::Open("+quote(scriptFile)+",[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);if($stream.Length -gt 4194304){throw 'Script size refused'};$hash=[Security.Cryptography.SHA256]::Create();try{$actual=([BitConverter]::ToString($hash.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}finally{$hash.Dispose()};if($actual -cne "+quote(expectedSha)+"){throw 'Script digest changed'};$stream.Position=0;$reader=New-Object IO.StreamReader($stream,[Text.UTF8Encoding]::new($false,$true),$true,4096,$true);try{$source=$reader.ReadToEnd()}finally{$reader.Dispose()};$call=@{"+values+"};& ([ScriptBlock]::Create($source)) @call}catch{[Console]::Error.WriteLine($_.Exception.Message);exit 1}finally{if($stream){$stream.Dispose()}}";
 const argv=['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(command,'utf16le').toString('base64')];
 if(!wait)return cp.spawn('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',argv,{env:environment,windowsHide:true,shell:false,stdio:'ignore',detached:true});
 return new Promise((resolve,reject)=>cp.execFile('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',argv,{env:environment,windowsHide:true,shell:false,encoding:'utf8',maxBuffer:65536},(error,stdout)=>error?reject(error):resolve(stdout)));
}
function knownLocal(environment){
 const script="[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);[Console]::Write([Environment]::GetFolderPath('LocalApplicationData'))";
 return new Promise((resolve,reject)=>cp.execFile('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{env:environment,windowsHide:true,shell:false,encoding:'utf8',maxBuffer:8192},(error,out)=>error?reject(error):resolve(out.trim())));
}
function cleanEnvironment(source){const env={};for(const key of ['SystemRoot','WINDIR','TEMP','TMP','LOCALAPPDATA','APPDATA','USERPROFILE','COMSPEC'])if(typeof source[key]==='string')env[key]=source[key];return env;}
function verifyActualSandbox(root){
 if(path.resolve(root).toLowerCase()!=='c:\\xjy-work\\xjy-web-stage1')fail('BRIDGE_ISOLATION','不是固定隔离根');
 const python='C:/Python314/python.exe',validator=path.join(root,'stage1/validate-sandbox-context.py');
 if(sha(nativeFs.readFileSync(python))!=='434b361fe0c5960d404974feed493db47f2603a1ace2574312104fbed0182c6f'||sha(nativeFs.readFileSync(validator))!=='867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207')fail('BRIDGE_ISOLATION','隔离验证工具变化');
 const result=cp.spawnSync(python,['-I','-B','-S',validator],{cwd:root,windowsHide:true,shell:false,encoding:'utf8',maxBuffer:65536});if(result.error||result.status!==0)fail('BRIDGE_ISOLATION','实际隔离验证未通过');JSON.parse(result.stdout);return{sandbox:true};
}
function progressWindow(electron){
 const {BrowserWindow}=electron,win=new BrowserWindow({width:540,height:260,resizable:false,title:'鑫金源珠宝 · 正在升级',backgroundColor:'#fcf9f3',autoHideMenuBar:true,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,partition:'xjy-maintenance-'+crypto.randomUUID()}});let allowClose=false;
 const html='<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><style>body{margin:34px;background:#fcf9f3;color:#35322e;font:15px/1.7 "Microsoft YaHei",sans-serif}h2{color:#7a1f2b;font-size:21px}.bar{height:5px;background:#e8ddd4;overflow:hidden}.bar:after{content:"";display:block;width:35%;height:100%;background:#7a1f2b;animation:move 1.4s ease-in-out infinite alternate}@keyframes move{to{transform:translateX(185%)}}@media(prefers-reduced-motion:reduce){.bar:after{animation:none}}</style><h2>正在准备完整升级</h2><p>程序会自动继续下一步，请保留升级窗口。<br>公司资料和员工身份仍按原设置保留。</p><div class="bar"></div>';
 const url='data:text/html;charset=utf-8,'+encodeURIComponent(html);win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',(event,target)=>{if(target!==url)event.preventDefault();});win.webContents.session.setPermissionRequestHandler((_w,_p,done)=>done(false));
 win.on('close',event=>{if(!allowClose){event.preventDefault();win.minimize();}});void win.loadURL(url);
 return {setStage:text=>{if(!win.isDestroyed())win.setTitle('鑫金源珠宝 · '+text);},close:()=>{allowClose=true;if(!win.isDestroyed())win.close();}};
}
async function verifyBridgeAck({ack,handoff,config,worker,parentPid,adapter,u,bundle,workerRel}){
 if(!exact(ack,['version','purpose','operationId','publicationId','targetCatalogSha256','helperPid','helperParentPid','helperCreationMarker','helperExecutableSha256'])||ack.version!==1||ack.purpose!=='xjy-engine-bridge-accepted170'||ack.operationId!==handoff.operationId||ack.publicationId!==config.publicationId||ack.targetCatalogSha256!==config.targetCatalogSha256||ack.helperExecutableSha256!==worker.sha256||!Number.isSafeInteger(ack.helperPid)||ack.helperPid<=0||!Number.isSafeInteger(ack.helperParentPid)||ack.helperParentPid<=0||typeof ack.helperCreationMarker!=='string'||ack.helperCreationMarker.length===0)fail('BRIDGE_ACK','升级交接记录不匹配');
 const live=await adapter.inspect(ack.helperPid);
 if(ack.helperParentPid!==parentPid){
  // The authenticated previous ACK may outlive its helper. Preserve it and
  // wait for this launch to replace it; a reused PID is not the old process.
  if(live&&live.creationMarker===ack.helperCreationMarker)fail('BRIDGE_BUSY','上一次升级助手仍在运行，请等待它完成');
  return false;
 }
 if(!live||live.parentPid!==parentPid||live.creationMarker!==ack.helperCreationMarker||!u.samePath(live.executablePath,path.join(bundle,...workerRel.split('/'))))fail('BRIDGE_PROCESS','升级进程身份未确认');
 return true;
}
async function startBridge(){
 const electron=require('electron'),{app,dialog}=electron,u=require('./employee-update-cache.cjs'),io=nativeFs.promises;
 let view=null,child=null;
 try{
  if(process.platform!=='win32'||process.arch!=='x64'||!app.isPackaged||app.getVersion()!=='1.7.0'||process.versions.electron!=='44.7.0'||process.env.ELECTRON_RUN_AS_NODE||process.env.NODE_OPTIONS||process.env.NODE_PATH)fail('BRIDGE_RUNTIME','请从已安装的员工软件继续升级');
  const installDir=u.safeAbsolute(path.dirname(app.getPath('exe')));await u.assertPath(io,installDir,{directory:true});
  const activation=JSON.parse(await u.readSmall(io,path.join(installDir,'xjy-install-activation.json'),4096));
  if(!exact(activation,['version','product','programVersion','role','installationDir'])||activation.version!==1||activation.product!=='xjy-jewelry-offline'||activation.programVersion!=='1.7.0'||activation.role!=='employee'||!u.samePath(activation.installationDir,installDir))fail('BRIDGE_ROLE','升级衔接只接受原来的员工身份');
  const admission=require('./release-admission.cjs').admitRelease({isPackaged:app.isPackaged,codeDir:__dirname,environment:process.env,activation,programVersion:app.getVersion(),validateSandbox:verifyActualSandbox});
  if(admission.mode==='sandbox')fail('BRIDGE_ISOLATED_ADAPTER_REQUIRED','开发副本需使用经核验的隔离交接测试入口，不使用实际用户目录');
  const profileDir=await require('./employee-recovery-entry.cjs').resolveKnownEmployeeProfile({clientRole:'employee',legacyProfile:app.getPath('userData'),portableDirectory:installDir});if(!profileDir)fail('BRIDGE_PROFILE','没有找到原员工设置，未新建空工作室');await u.assertPath(io,profileDir,{directory:true});
  app.setPath('userData',profileDir);if(!app.requestSingleInstanceLock()){app.quit();return;}
  const pins=require('./generated/release-pins.cjs'),publicKey=crypto.createPublicKey(pins.publisherPublicKey);if(publicKey.asymmetricKeyType!=='ed25519'||sha(publicKey.export({type:'spki',format:'der'}))!==KEY_SHA)fail('BRIDGE_KEY','发行身份不一致');
  const {journal}=await originalCommit({u,io,installDir,profileDir,publicKey,allowedFiles:pins.allowedFiles});
  const configFile=path.join(__dirname,'bridge-config.json');if(vfs.statSync(configFile).size>1048576)fail('BRIDGE_CONFIG','升级配置超过上限');const config=validateConfig(JSON.parse(vfs.readFileSync(configFile,'utf8')));
  await app.whenReady();view=progressWindow(electron);
  const environment=cleanEnvironment(process.env),local=u.safeAbsolute(await knownLocal(environment));await u.assertPath(io,local,{directory:true});
  let root=local;for(const name of ['XJY','Upgrade',journal.transactionId]){const next=path.join(root,name);try{await io.mkdir(next);}catch(e){if(e.code!=='EEXIST')throw e;}await u.assertPath(io,next,{directory:true,root:local});root=next;}
  if(u.samePath(root,installDir)||path.relative(installDir,root).split(path.sep)[0]!=='..'&&!path.isAbsolute(path.relative(installDir,root)))fail('BRIDGE_LOCATION','升级助手必须放在原程序之外');
  const ownerFile=path.join(root,'operation-owner.json'),owner={version:1,purpose:'xjy-bridge-operation170',operationId:journal.transactionId,installationDir:installDir,profileDir,publicationId:config.publicationId,targetCatalogSha256:config.targetCatalogSha256};
  try{const saved=await u.authenticatedRead(io,ownerFile,profileDir,16384);if(JSON.stringify(saved)!==JSON.stringify(owner))fail('BRIDGE_OWNER','此升级目录属于另一项操作');}catch(e){if(e.code!=='ENOENT')throw e;if((await io.readdir(root)).length!==0)fail('BRIDGE_OWNER','已有升级目录缺少完整所有权记录，已保留现场');await u.authenticatedWrite(io,ownerFile,owner,profileDir,root);}
  for(const [kind,name]of [['payload','payload.zip'],['manifest','payload-manifest.json'],['extractor','Extract-Bridge170.ps1']])await copyPacked({u,io,root,source:path.join(__dirname,...config[kind].path.split('/')),spec:config[kind],target:name});
  view.setStage('正在校验完整程序');
  await runPs(path.join(root,'Extract-Bridge170.ps1'),{OperationRoot:root,ArchiveSha256:config.payload.sha256,ManifestSha256:config.manifest.sha256},environment,{expectedSha:config.extractor.sha256});
  const bundle=path.join(root,'bundle');await u.assertPath(io,bundle,{directory:true,root});
  const binding=await u.readSmall(io,path.join(bundle,'engine-native170-binding.json'),4194304);if(sha(binding)!==config.bindingSha256)fail('BRIDGE_BINDING','完整升级绑定不一致');
  const bootstrap=await u.readSmall(io,path.join(bundle,...config.bootstrap.path.split('/')),4194304);if(sha(bootstrap)!==config.bootstrap.sha256||bootstrap.length!==config.bootstrap.size)fail('BRIDGE_BOOTSTRAP','原生升级入口不一致');
  const manifest=JSON.parse(vfs.readFileSync(path.join(__dirname,...config.manifest.path.split('/')),'utf8')),workerRel='受信助手/鑫金源珠宝报价.exe',worker=Array.isArray(manifest.files)?manifest.files.find(x=>x.path===workerRel):null;if(!worker||!SHA.test(worker.sha256||''))fail('BRIDGE_MANIFEST','缺少受信升级助手');
  const handoff={version:1,purpose:'xjy-engine-bridge-handoff170',operationId:journal.transactionId,installationDir:installDir,profileDir,role:'employee',sourceVersion:journal.expectedVersion,bridgeCatalogSha256:sha(Buffer.from(journal.envelope.catalog)),publicationId:config.publicationId,targetCatalogSha256:config.targetCatalogSha256};
  await u.authenticatedWrite(io,path.join(bundle,'engine-bridge-handoff.json'),handoff,profileDir,bundle);
  child=runPs(path.join(bundle,...config.bootstrap.path.split('/')),{PackageRoot:bundle,Action:'Bridge'},environment,{wait:false,expectedSha:config.bootstrap.sha256});
  let childError=null;child.on('error',e=>{childError=e;});const parentPid=child.pid;if(!Number.isSafeInteger(parentPid))fail('BRIDGE_START','升级窗口没有正常启动');
  const adapter=require('./updater-helper.cjs').createWindowsUpdateProcessAdapter({executablePath:path.join(bundle,...workerRel.split('/'))});
  const started=Date.now();while(Date.now()-started<120000){
   if(childError)throw childError;if(child.exitCode!==null||child.signalCode!==null)fail('BRIDGE_STOPPED','升级助手提前退出，请保留升级记录');
   let ack;try{ack=await u.authenticatedRead(io,path.join(bundle,'engine-bridge-accepted.json'),profileDir,16384);}catch(e){if(e.code!=='ENOENT')throw e;}
   if(ack&&await verifyBridgeAck({ack,handoff,config,worker,parentPid,adapter,u,bundle,workerRel})){
    view.close();view=null;child.unref();app.quit();return {handedOff:true,operationId:handoff.operationId};
   }
   await new Promise(resolve=>setTimeout(resolve,250));
  }
  fail('BRIDGE_TIMEOUT','尚未确认升级交接，请保留窗口和升级记录');
 }catch(error){view?.close();dialog.showErrorBox('升级尚未完成',String(error.message||error)+'\n请保留原程序、升级目录及备份，不要重复覆盖安装。');app.quit();return{handedOff:false,code:error.code||'FAILED'};}
}
if(require.main===module)void startBridge().catch(error=>{process.stderr.write(String(error.message||error));process.exitCode=1;});
module.exports={validateConfig,originalCommit,copyPacked,cleanEnvironment,verifyBridgeAck,startBridge};

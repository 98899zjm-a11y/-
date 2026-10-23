'use strict';
// Entry owns only admission/recovery/single-instance coordination. Business is
// imported once every branch has passed its data-free gates.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
function same(a,b){return path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();}
function canonical(value,io,{missing=false,directory=false}={}){
 if(typeof value!=='string'||!path.isAbsolute(value)||/^[\\/]{2}/.test(value)||/[\x00-\x1f]/.test(value)||process.platform==='win32'&&value.slice(2).includes(':')||value.slice(path.parse(value).root.length).split(/[\\/]/).some(p=>p==='.'||p==='..'||/[. ]$/.test(p)))throw new Error('发布入口路径必须为规范本机目录');const target=path.resolve(value);
 for(let p=target;;p=path.dirname(p)){if(io.existsSync(p)){const s=io.lstatSync(p);if(s.isSymbolicLink()||p!==target&&!s.isDirectory()||!same(io.realpathSync.native(p),p))throw new Error('发布入口路径不能使用链接或别名');}if(p===path.dirname(p))break;}
 if(!io.existsSync(target)){if(!missing)throw new Error('发布入口文件或目录缺失');return target;}const s=io.lstatSync(target);if(directory?!s.isDirectory():!s.isFile()||s.nlink!==1)throw new Error('发布入口文件身份无效');return target;
}
function isolated(io,codeDir){for(let p=path.resolve(codeDir);;p=path.dirname(p)){if(io.existsSync(path.join(p,'isolation-identity.json')))return true;if(p===path.dirname(p))return false;}}
function readActivation(io,installDir){
 const file=path.join(installDir,'xjy-install-activation.json');if(!io.existsSync(file))return undefined;canonical(file,io);const before=io.lstatSync(file);if(before.size>4096)throw new Error('安装记录过大');const fd=io.openSync(file,'r');let bytes;
 try{const start=io.fstatSync(fd);bytes=io.readFileSync(fd);const end=io.fstatSync(fd),current=io.lstatSync(file);for(const key of ['dev','ino','size','mtimeMs','ctimeMs','nlink'])if(start[key]!==end[key]||start[key]!==current[key])throw new Error('安装记录读取期间发生变化');if(start.dev!==before.dev||start.ino!==before.ino||start.nlink!==1)throw new Error('安装记录文件身份发生变化');}finally{io.closeSync(fd);}
 const record=JSON.parse(bytes);if(record.version!==1||record.product!=='xjy-jewelry-offline'||!['host','employee'].includes(record.role)||typeof record.programVersion!=='string'||!same(canonical(record.installationDir,io,{directory:true}),installDir))throw new Error('安装记录不是此程序的可信安装位置');return record;
}
async function startReleaseEntry(options={}){
 const requireProgram=options.requireProgram||require,argv=options.argv||process.argv,environment=options.environment||process.env,io=options.fileSystem||fs,codeDir=options.codeDir||__dirname,globals=options.globalObject||globalThis;
 const printing=argv.includes('--xjy-print-worker');
 const electron=options.app?null:require('electron'),app=options.app||electron.app,dialog=options.dialog||electron?.dialog;
 try{
  const protocol=options.protocol===undefined?electron?.protocol:options.protocol;
  if(!printing&&(!protocol||typeof protocol.registerSchemesAsPrivileged!=='function'))throw new Error('发布入口协议注册接口缺失，未启动业务');
  // Electron requires this before any asynchronous employee recovery can yield.
  if(!printing)protocol.registerSchemesAsPrivileged([{ scheme: 'jewelry', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
  const programVersion=app.getVersion(),sandbox=!app.isPackaged||Boolean(environment.XJY_RELEASE_TEST_ROOT)||isolated(io,codeDir),admit=requireProgram('./release-admission.cjs').admitRelease;let admission,activation,profileDir=null;
  if(!sandbox&&(environment.XJY_DATA_DIR||environment.XJY_STAGE1_ROOT||environment.XJY_STAGE1_NAMESPACE))throw new Error('正式发布入口不接受遗留测试环境路径');
  function validateSandbox(root){if(typeof options.validateSandbox==='function')return options.validateSandbox(root);if(!same(root,'C:/xjy-work/xjy-web-stage1'))throw new Error('实际 Sandbox 根必须验证');const result=(options.spawnSync||spawnSync)('C:/Python314/python.exe',['-I','-B',path.join(root,'stage1','validate-sandbox-context.py')],{cwd:root,windowsHide:true,shell:false,encoding:'utf8',timeout:30000});if(result.error||result.status!==0)throw new Error('实际 Windows Sandbox 验证失败，未启动业务');JSON.parse(result.stdout);return {sandbox:true};}
  // Sandbox proof always precedes profile/activation/F-drive access.
  if(sandbox)admission=admit({isPackaged:app.isPackaged,codeDir,environment,programVersion,validateSandbox});
  const exe=canonical(app.getPath('exe'),io),installDir=canonical(path.dirname(exe),io,{directory:true});
  if(!sandbox)activation=readActivation(io,installDir);
  if(!sandbox&&programVersion==='1.7.0'){
   const engineGate=options.engineUpgradeGate||requireProgram('./engine-startup-gate.cjs').readEngineStartupGate;
   const engineStatus=engineGate({installDir,programVersion,installedRole:activation?.role});
   if(!engineStatus||engineStatus.blocked!==false)throw new Error(engineStatus?.message||'完整升级尚未获确认，业务和打印暂未启动');
  }
  const initialGate=options.initialUpgradeGate||requireProgram('./initial-upgrade-gate.cjs').readInitialUpgradeGate,initialStatus=initialGate({installDir,installedRole:sandbox?(argv.includes('--employee-client')?'employee':'host'):activation?.role,fileSystem:io});if(initialStatus?.blocked)throw new Error(initialStatus.message||'初次完整升级恢复尚未完成');
  if(printing){await requireProgram('./print-worker-entry.cjs').runStandalone();return {mode:'worker'};}
  const employee=sandbox?argv.includes('--employee-client'):activation?.role==='employee';
  if(employee){const recovery=requireProgram('./employee-recovery-entry.cjs');profileDir=sandbox?path.join(admission.root,'config','employee-profile'):await recovery.resolveKnownEmployeeProfile({clientRole:'employee',legacyProfile:app.getPath('userData'),portableDirectory:installDir});
   if(profileDir&&io.existsSync(profileDir)){canonical(profileDir,io,{directory:true});app.setPath('userData',profileDir);if(!app.requestSingleInstanceLock()){app.quit();return {mode:'duplicate'};}Object.defineProperty(globals,'__xjyReleaseOwnsInstanceLock',{value:true,writable:false,configurable:false});}
   let pins;try{pins=requireProgram('./generated/release-pins.cjs');}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;}
   const result=await recovery.runEmployeeRecoveryGate({clientRole:'employee',currentVersion:programVersion,profileDir,installDir,executablePath:exe,trustedPublicKey:pins?.publisherPublicKey,requestExit:()=>app.quit()});if(result?.blocked)throw new Error(result.message||'员工更新恢复校验未通过，尚未加载业务');if(result?.requiresExit)return result;
  }
  if(!sandbox)admission=admit({isPackaged:app.isPackaged,codeDir,environment,activation,programVersion,validateSandbox});
  if(!employee){profileDir=sandbox?path.join(admission.root,'config','desktop-profile'):'F:\\鑫金源珠宝资料\\程序设置';if(io.existsSync(profileDir)){canonical(profileDir,io,{directory:true});app.setPath('userData',profileDir);if(!app.requestSingleInstanceLock()){app.quit();return {mode:'duplicate'};}Object.defineProperty(globals,'__xjyReleaseOwnsInstanceLock',{value:true,writable:false,configurable:false});}}
  if(!sandbox&&admission.role==='employee'&&!argv.includes('--employee-client'))argv.push('--employee-client');
  Object.defineProperty(globals,'__xjyReleaseAdmission',{value:admission,writable:false,configurable:false});requireProgram('./release-app.cjs');return admission;
 }catch(error){dialog?.showErrorBox('鑫金源升级包尚未启动',error.message);app.exit(1);return {mode:'blocked',blocked:true};}
}
if(require.main===module)startReleaseEntry().catch(error=>{process.stderr.write('发布程序未启动：'+error.message+'\n');process.exitCode=1;});
module.exports={startReleaseEntry};

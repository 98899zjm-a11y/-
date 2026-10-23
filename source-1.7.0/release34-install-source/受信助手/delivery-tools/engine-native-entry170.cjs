'use strict';
// Fixed outside-worker entry. The existing CMD/PS bootstrap must verify its
// complete worker tree BEFORE executing this file. No arbitrary path argument.
const fs=(process.versions.electron?require('original-fs'):require('node:fs')).promises,path=require('node:path');
const u=require('../project/desktop/employee-update-cache.cjs');
const core=require('./initial-patch-core.cjs'),entry=require('./initial-patch-entry.cjs');
const SHA=/^[a-f0-9]{64}$/;
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&Object.keys(value).every(key=>keys.includes(key));
const fail=(code,message)=>{throw Object.assign(Error(message),{code});};
const NAMES=Object.freeze({artifactDir:'补丁文件',archiveFile:'鑫金源珠宝1.7.0员工升级补丁.zip',engineArtifactDir:'完整程序',workerRoot:'受信助手'});
function bindingValue(raw,{bundleRoot,workerRoot}){
 let value;try{value=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(raw));}catch{fail('BAD_BINDING','发布绑定不是完整UTF8 JSON');}
 if(!exact(value,['schemaVersion','purpose','native','fresh'])||value.schemaVersion!==1||value.purpose!=='xjy-engine-native-binding170'||!value.native||!exact(value.native.paths,Object.keys(NAMES))||Object.entries(NAMES).some(([key,name])=>value.native.paths[key]!==name)||!exact(value.fresh,['artifactDir','trust'])||value.fresh.artifactDir!=='首次安装材料')fail('BAD_BINDING','仅允许固定完整包目录与已审原生绑定');
 if(!u.samePath(workerRoot,path.join(bundleRoot,NAMES.workerRoot)))fail('EXTERNAL_ASSISTANT_REQUIRED','维护入口不在固定受信助手目录');
 const native={...value.native,paths:Object.fromEntries(Object.entries(NAMES).map(([key,name])=>[key,path.join(bundleRoot,name)]))};
 const fresh={...value.fresh,artifactDir:path.join(bundleRoot,value.fresh.artifactDir)};
 return{native,fresh};
}
async function chooseCandidate(candidates){
 if(!Array.isArray(candidates)||candidates.length<2||candidates.length>256||candidates.some(c=>!/^([a-f0-9]{8}):([a-f0-9]{16})$/.test(c.identity||'')))fail('BAD_CANDIDATES','候选身份不完整');
 // One bounded Chinese selection. The result is a physical identity, not a
 // caller-controlled installation path. The worker revalidates it afterwards.
 const script="[Console]::InputEncoding=[Text.UTF8Encoding]::new($false);[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$ErrorActionPreference='Stop';$r=@([Console]::In.ReadToEnd()|ConvertFrom-Json);Add-Type -AssemblyName System.Windows.Forms;Add-Type -AssemblyName System.Drawing;$f=New-Object Windows.Forms.Form;$f.Text='选择要升级的鑫金源程序';$f.Size=New-Object Drawing.Size(760,330);$f.StartPosition='CenterScreen';$l=New-Object Windows.Forms.ListBox;$l.Location=New-Object Drawing.Point(15,20);$l.Size=New-Object Drawing.Size(715,210);foreach($c in $r){[void]$l.Items.Add(($c.role+'  '+$c.version+'  '+$c.installationDir))};$b=New-Object Windows.Forms.Button;$b.Text='升级所选程序';$b.Location=New-Object Drawing.Point(470,240);$b.Size=New-Object Drawing.Size(140,32);$b.Add_Click({if($l.SelectedIndex -ge 0){$f.DialogResult=[Windows.Forms.DialogResult]::OK;$f.Close()}});$x=New-Object Windows.Forms.Button;$x.Text='取消';$x.Location=New-Object Drawing.Point(620,240);$x.Add_Click({$f.DialogResult=[Windows.Forms.DialogResult]::Cancel;$f.Close()});$f.Controls.AddRange(@($l,$b,$x));if($f.ShowDialog() -eq [Windows.Forms.DialogResult]::OK){@{selectedIdentity=$r[$l.SelectedIndex].identity}|ConvertTo-Json -Compress}else{'{\"selectedIdentity\":null}'}";
 const raw=await new Promise((resolve,reject)=>{const child=require('node:child_process').execFile('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,shell:false,encoding:'utf8',maxBuffer:65536,env:{SystemRoot:'C:\\Windows',WINDIR:'C:\\Windows',SystemDrive:'C:',PATHEXT:'.EXE'}},(error,stdout)=>error?reject(error):resolve(stdout));child.stdin.on('error',reject);child.stdin.end(JSON.stringify(candidates));});
 let result;try{result=JSON.parse(raw);}catch{fail('BAD_CANDIDATE_SELECTION','选择窗口返回无效结果');}
 if(!exact(result,['selectedIdentity'])||result.selectedIdentity!==null&&!candidates.some(c=>c.identity===result.selectedIdentity))fail('BAD_CANDIDATE_SELECTION','选择结果不是本次已核程序');
 return result.selectedIdentity;
}
async function launchFresh(request,authority){
 const environment={...entry.cleanInitialEnvironment(process.env),SystemRoot:'C:\\Windows',WINDIR:'C:\\Windows',LOCALAPPDATA:authority.local,APPDATA:authority.roaming};
 return new Promise((resolve,reject)=>{const child=require('node:child_process').spawn(request.executablePath,request.args,{cwd:path.dirname(request.executablePath),env:environment,windowsHide:false,shell:false,detached:true,stdio:'ignore'});child.once('error',reject);child.once('spawn',()=>{child.unref();resolve({started:true});});});
}
async function dispatchEmployeeSlotAction(provider,mode){
 if(!['--employee-slot','--employee-slot-recover'].includes(mode))fail('BAD_SLOT_ACTION','员工slot动作无效');
 const recovery=mode==='--employee-slot-recover',method=recovery?'recoverEmployeeSlot170':'updateEmployeeSlot170';
 if(typeof provider.resolveEmployeeSlotSource170!=='function'||typeof provider[method]!=='function')fail('SLOT_UNAVAILABLE','本发布尚未接通受信员工slot入口');
 // Resolver authenticates the fixed default/active source (or the signed
 // publication's pending recovery source). Never take a CLI install directory.
 const selected=await provider.resolveEmployeeSlotSource170(recovery?{recovery:true}:{});
 if(!exact(selected,['installationDir','role'])||selected.role!=='employee')fail('BAD_SLOT_SOURCE','没有核验明确的员工slot来源');
 const installationDir=u.safeAbsolute(selected.installationDir),result=await provider[method]({installationDir});
 if(!result||typeof result!=='object'||Array.isArray(result)||result.role!==undefined&&result.role!=='employee'||result.version!==undefined&&result.version!=='1.7.0'||result.engineVersion!==undefined&&result.engineVersion!=='44.9.0')fail('BAD_SLOT_RESULT','员工slot返回身份不符');
 if(recovery&&result.recovered!==true){if(result.committed===true&&result.rollbackForbidden===true)fail('SLOT_ALREADY_COMMITTED','本次员工slot已提交并放行业务，禁止退回旧程序；请使用已验证的新员工入口。');fail('SLOT_RECOVERY_UNCONFIRMED','员工slot恢复尚未确认，请保留现场。');}
 if(!recovery&&result.completed===true&&(result.role!=='employee'||result.version!=='1.7.0'||result.engineVersion!=='44.9.0'||result.activated!==true))fail('BAD_SLOT_RESULT','员工slot完成记录缺少真实目标身份或切换确认');
 return{...result,role:'employee',version:'1.7.0',engineVersion:'44.9.0'};
}
async function runBoundNative170(args=process.argv.slice(2)){
 if(args.length!==3||args[0]!=='--binding-sha256'||!SHA.test(args[1]||'')||!['--upgrade','--recover','--recover-start','--fresh-host','--fresh-employee','--continue-bridge','--employee-slot','--employee-slot-recover'].includes(args[2]))fail('UNTRUSTED_LAUNCH','请从固定中文安装入口启动，不提供任意路径或启动授权参数');
 if(process.platform!=='win32'||process.arch!=='x64'||process.env.ELECTRON_RUN_AS_NODE!=='1'||process.versions.electron!=='44.7.0'||process.env.NODE_OPTIONS||process.env.NODE_PATH)fail('UNTRUSTED_NATIVE_RUNTIME','仅允许包装器完整核验后的外置原引擎维护助手');
 const workerRoot=path.resolve(__dirname,'..'),bundleRoot=path.dirname(workerRoot),file=path.join(bundleRoot,'engine-native170-binding.json');
 const before=await core.fileHash(fs,file,bundleRoot),raw=await u.readSmall(fs,file,4194304);
 if(before.sha256!==args[1]||u.digest(raw)!==args[1])fail('BINDING_CHANGED','包外固定发布绑定摘要不符');
 const bound=bindingValue(raw,{bundleRoot,workerRoot}),provider=require('./engine-tree-runtime170.cjs').createNativeEngineTreeProvider170(bound.native);
 if((await core.fileHash(fs,file,bundleRoot)).sha256!==before.sha256)fail('BINDING_CHANGED','读取期间发布绑定发生变化');
 if(args[2]==='--employee-slot'||args[2]==='--employee-slot-recover')return dispatchEmployeeSlotAction(provider,args[2]);
 if(args[2]==='--continue-bridge')return provider.continueCommittedBridge();
 if(args[2]==='--recover'||args[2]==='--recover-start')return provider.recoverApproved({restartTarget:args[2]==='--recover-start'});
 const publication=bound.native.publication,paths={artifactDir:bound.native.paths.artifactDir,archiveFile:bound.native.paths.archiveFile,reviewerDir:path.join(bundleRoot,'审批工具')};
 if(args[2].startsWith('--fresh-')){
  const role=args[2]==='--fresh-host'?'host':'employee',authority=await entry.resolveInitialNativeAuthority(),installationDir=path.join(authority.local,'鑫金源珠宝',role==='host'?'主机程序':'员工程序');
  await provider.verifyFreshDestination({role,installationDir});
  const result=await require('./fresh-program-install-170.cjs').installFreshProgram({artifactDir:bound.fresh.artifactDir,installDir:installationDir,localAppData:authority.local,role,trust:bound.fresh.trust,commit:request=>provider.initializeFreshInstalled({role:request.role,installationDir:request.installationDir}),launch:request=>launchFresh(request,authority)});
  return{...result,completed:result.installed===true&&result.launched===true,engineVersion:'44.9.0'};
 }
 // The signed worker envelope, independently verified by the provider before
 // any approval write, fixes the existing reviewer's exact code bytes.
 const workerCatalog=JSON.parse(bound.native.workerEnvelope.catalog),reviewerPins={};
 for(const name of ['Prepare-Repeat-Approval-170.ps1','approval-core-170.cjs','approval-io-170.cjs','approval-archive-170.cjs']){
  const rows=workerCatalog.files.filter(row=>row.path==='delivery-approval/'+name);if(rows.length!==1)fail('BAD_HELPER','已签完整助手缺少独立审定器');reviewerPins[name]=rows[0].sha256;
 }
 paths.reviewerPins=reviewerPins;
 const worker=require('./universal-worker-170.cjs').createUniversalWorker170({publication,paths,engineTree:provider,native:{chooseCandidate},onProgress:value=>process.stdout.write(JSON.stringify({type:'progress',...value})+'\n')});
 return worker.run({mode:'maintenance'});
}
async function finishNativeResult(result){
 // runBoundNative170 has awaited commit, launch-spawn acknowledgement and
 // provider cleanup before returning. Never force process.exit while a
 // transaction or output write is still pending.
 if(result?.completed===true&&result.role==='host'){
  try{
   const shortcut=await require('./native-shortcut-170.cjs').ensureHostShortcut({role:'host',commitVerified:true,installationDir:result.installationDir});
   return{...result,shortcut};
  }catch(error){return{...result,shortcut:{error:error.code||'SHORTCUT_FAILED',message:error.message}};}
 }
 return result;
}
async function writeNativeResult(result){
 const completed=await finishNativeResult(result);
 const code=completed?.completed===false||completed?.launched===false||completed?.shortcut?.error?1:0;
 if(completed?.shortcut?.error)process.stderr.write('程序已提交，但桌面快捷方式创建失败：'+completed.shortcut.error+' '+String(completed.shortcut.message||'')+'；请保留已装程序，不要覆盖重装。\n');
 await new Promise((resolve,reject)=>process.stdout.write(JSON.stringify({...completed,type:'result'})+'\n',error=>error?reject(error):resolve()));
 process.exitCode=code;
}
if(require.main===module)runBoundNative170().then(writeNativeResult).catch(error=>{process.stderr.write('安装或升级已停止：'+(error.code||'FAILED')+' '+error.message+'\n');process.exitCode=1;});
module.exports={bindingValue,runBoundNative170,dispatchEmployeeSlotAction,finishNativeResult,writeNativeResult};

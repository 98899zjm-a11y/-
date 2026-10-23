'use strict';
// Read-only metadata for the one admitted offline C6 fixture. No product/SQLite,
// config writes, process signals, registry changes, or F: file access.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const LOCAL=String.raw`C:\Users\WDAGUtilityAccount\AppData\Local`,NODE=String.raw`C:\XjyNode\node.exe`,ENTRY='tools/probe-c22-host-test-admission.cjs';
const same=(a,b)=>path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function need(v,m){if(!v)throw Error(m);}
function plain(p,dir){let first;for(let q=path.resolve(p);;q=path.dirname(q)){const s=fs.lstatSync(q,{bigint:true});need(!s.isSymbolicLink()&&same(fs.realpathSync.native(q),q),'ORDINARY_C_ONLY');if(!first){need(dir?s.isDirectory():s.isFile()&&s.nlink===1n,'EXPECTED_TYPE');first=s;}else need(s.isDirectory(),'DIRECTORY_ANCESTOR');if(q===path.dirname(q))break;}return first;}
function id(s){return[s.dev,s.ino,s.birthtimeNs].map(String).join(':');}
async function main(){
 const a=process.argv.slice(2);need(a.length===4&&a[0]==='--run-root'&&a[2]==='--self-sha256'&&/^[a-f0-9]{64}$/.test(a[3]),'EXACT_ARGS');
 need(process.platform==='win32'&&process.arch==='x64'&&os.userInfo().username.toLowerCase()==='wdagutilityaccount'&&os.hostname()==='fe0b3f51-3704-4e3e-a876-8c6d64ce551f'&&same(process.execPath,NODE)&&!process.env.NODE_OPTIONS&&!process.env.NODE_PATH&&!process.env.ELECTRON_RUN_AS_NODE,'FIXED_C6_ONLY');
 const root=path.resolve(a[1]),uuid=path.basename(root);need(/^[a-f0-9-]{36}$/.test(uuid)&&same(root,path.join(LOCAL,'XjyGuestRun',uuid))&&same(process.cwd(),root)&&same(__filename,path.join(root,ENTRY)),'CURRENT_PRIVATE_BRIDGE_ROOT');plain(root,true);plain(__filename,false);need(hash(fs.readFileSync(__filename))===a[3],'EXACT_SELF');
 const ps=String.raw`$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$ips=@(Get-NetIPAddress|Where-Object{$_.AddressState -eq 'Preferred' -and $_.IPAddress -ne '::1' -and $_.IPAddress -notlike '127.*'}|Select-Object -ExpandProperty IPAddress);$target=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'XjyGenuine150Host-a2\program\鑫金源珠宝报价.exe';@{hardware=(Get-CimInstance Win32_ComputerSystemProduct).UUID;sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;local=[Environment]::GetFolderPath('LocalApplicationData');ips=$ips;fPresent=(Test-Path -LiteralPath 'F:\');processes=@(Get-CimInstance Win32_Process|Where-Object{$_.ExecutablePath -ieq $target}|ForEach-Object{@{pid=[int]$_.ProcessId;parentPid=[int]$_.ParentProcessId}})}|ConvertTo-Json -Compress -Depth 4`;
 const proof=await new Promise((resolve,reject)=>{
  const c=spawn(String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`,['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(ps,'utf16le').toString('base64')],{shell:false,windowsHide:true,env:{SystemRoot:'C:\\Windows',WINDIR:'C:\\Windows',SystemDrive:'C:',PSModulePath:'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules'},stdio:['ignore','pipe','pipe']});
  let out='',err='',done=false;const timer=setTimeout(()=>finish(Error('READONLY_PROBE_PENDING_NO_SIGNAL')),30000);
  function finish(e){if(done)return;done=true;clearTimeout(timer);if(e){c.stdout.destroy();c.stderr.destroy();c.unref();reject(e);}else{try{resolve(JSON.parse(out.replace(/^\uFEFF/,'')));}catch(e){reject(e);}}}
  c.on('error',finish);c.stdout.on('data',b=>{out+=b.toString('utf8');if(out.length>8192)finish(Error('READONLY_RESULT_BOUND'));});c.stderr.on('data',b=>{err+=b.toString('utf8');if(err.length>8192)finish(Error('READONLY_ERROR_BOUND'));});c.once('close',(code,sig)=>finish(code!==0||sig||err.trim()?Error('READONLY_QUERY_FAILED:'+code+':'+err.slice(-1500)):null));
 });
 need(proof.hardware==='24648BA5-EA92-47DA-8EDA-AFC423CBC10C'&&proof.sid==='S-1-5-21-2047949552-857980807-821054962-504'&&same(proof.local,LOCAL)&&Array.isArray(proof.ips)&&proof.ips.length===0,'C6_HW_SID_OFFLINE');
 const install=path.join(LOCAL,'XjyGenuine150Host-a2/program'),before=plain(install,true),after=plain(install,true);need(id(before)===id(after),'IDENTITY_CHANGED');
 console.log(JSON.stringify({result:'C6_HOST_TEST_ADMISSION_METADATA_ONLY',guestIdBoundByExternalBridge:'c6b4f1f6-411e-4272-b4a4-a1ca62701e39',installationDir:install,installationIdentity:id(after),processes:proof.processes,expectedFPresent:proof.fPresent,sqlExecuted:false,productExecuted:false,configurationWritten:false,fFilesOpened:false}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});

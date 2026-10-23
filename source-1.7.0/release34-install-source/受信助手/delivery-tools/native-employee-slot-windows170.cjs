'use strict';
const path=require('node:path'),{execFile}=require('node:child_process');
const u=require('../project/desktop/employee-update-cache.cjs');
const EXE='鑫金源珠宝报价.exe',LINK='鑫金源珠宝（员工端）.lnk';
const PS='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const SCRIPT=String.raw`[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$ErrorActionPreference='Stop'
$r=[Console]::In.ReadToEnd()|ConvertFrom-Json
if($r.action -ceq 'health'){
 $p=Get-Process -Id ([int]$r.pid) -ErrorAction Stop
 if($p.MainWindowHandle -eq [IntPtr]::Zero -or !$p.Responding){throw 'TARGET_WINDOW_UNAVAILABLE'}
 @{pid=$p.Id;windowHandle=$p.MainWindowHandle.ToInt64().ToString();responding=$true}|ConvertTo-Json -Compress
 exit 0
}
$desktop=[Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory)
if([string]::IsNullOrWhiteSpace($desktop) -or !(Test-Path -LiteralPath $desktop -PathType Container)){throw 'DESKTOP_UNAVAILABLE'}
$link=Join-Path $desktop '鑫金源珠宝（员工端）.lnk'
$shell=New-Object -ComObject WScript.Shell
try{
 if($r.action -ceq 'snapshot'){
  $result=@{desktop=$desktop;path=$link;exists=$false;target=$null;arguments=$null;workingDirectory=$null}
  if(Test-Path -LiteralPath $link){
   if(!(Test-Path -LiteralPath $link -PathType Leaf)){throw 'SHORTCUT_TYPE'}
   $l=$shell.CreateShortcut($link)
   try{$result.exists=$true;$result.target=[string]$l.TargetPath;$result.arguments=[string]$l.Arguments;$result.workingDirectory=[string]$l.WorkingDirectory}finally{[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($l)}
  }
  $result|ConvertTo-Json -Compress
 }elseif($r.action -ceq 'render'){
  if(Test-Path -LiteralPath ([string]$r.temporaryPath)){
   $existing=$shell.CreateShortcut([string]$r.temporaryPath)
   try{if([string]$existing.TargetPath -ine [string]$r.executablePath -or [string]$existing.Arguments -cne '--employee-client' -or [string]$existing.WorkingDirectory -ine [string]$r.installationDir){throw 'SHORTCUT_TEMP_CONFLICT'}}finally{[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($existing)}
   @{rendered=$true;reused=$true}|ConvertTo-Json -Compress
   exit 0
  }
  $l=$shell.CreateShortcut([string]$r.temporaryPath)
  try{$l.TargetPath=[string]$r.executablePath;$l.Arguments='--employee-client';$l.WorkingDirectory=[string]$r.installationDir;$l.Save()}finally{[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($l)}
  @{rendered=$true}|ConvertTo-Json -Compress
 }else{throw 'INVALID_FIXED_ACTION'}
}finally{[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell)}`;
function run(payload){return new Promise((resolve,reject)=>{const child=execFile(PS,['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(SCRIPT,'utf16le').toString('base64')],{windowsHide:true,shell:false,encoding:'utf8',timeout:15000,maxBuffer:16384,env:{SystemRoot:'C:\\Windows',WINDIR:'C:\\Windows',SystemDrive:'C:',PATHEXT:'.EXE'}},(error,out)=>{if(error)return reject(Object.assign(Error('员工slot固定Windows检查失败'),{code:'SLOT_WINDOWS_REFUSED',cause:error}));try{resolve(JSON.parse(out));}catch(cause){reject(Object.assign(Error('员工slot检查回执无效'),{code:'BAD_SLOT_WINDOWS_REPLY',cause}));}});child.stdin.on('error',reject);child.stdin.end(Buffer.from(JSON.stringify(payload)));});}
async function snapshotShortcut(){const r=await run({action:'snapshot'});if(!r||typeof r.exists!=='boolean'||!u.samePath(r.path,path.join(u.safeAbsolute(r.desktop),LINK)))u.fail('BAD_SHORTCUT','员工快捷方式KnownFolder回执不符');return r;}
async function renderShortcut({installationDir,temporaryPath}){const install=u.safeAbsolute(installationDir),file=u.safeAbsolute(temporaryPath);if(path.basename(file)!=='target-shortcut.lnk')u.fail('BAD_SHORTCUT_TEMP','快捷方式只在slot专属事务文件创建');return run({action:'render',installationDir:install,executablePath:path.join(install,EXE),temporaryPath:file});}
async function windowHealth(pid){if(!Number.isSafeInteger(pid)||pid<1)u.fail('BAD_PROCESS','新员工进程PID无效');const r=await run({action:'health',pid});if(r?.pid!==pid||r.responding!==true||!/^\d+$/.test(r.windowHandle||'')||r.windowHandle==='0')u.fail('SLOT_HEALTH_UNCERTAIN','新员工实际窗口未确认');return r;}
module.exports={snapshotShortcut,renderShortcut,windowHealth};

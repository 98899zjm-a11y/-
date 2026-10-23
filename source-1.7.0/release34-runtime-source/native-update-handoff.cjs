'use strict';
const fs=process.versions.electron?require('original-fs').promises:require('node:fs/promises');
const path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const u=require('./employee-update-cache.cjs');
const PS='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
function cleanEnvironment(input){const out={SystemRoot:'C:\\Windows',WINDIR:'C:\\Windows',SystemDrive:'C:',PATHEXT:'.EXE',PSModulePath:'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules'};for(const n of ['TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','COMSPEC'])if(typeof input[n]==='string')out[n]=input[n];return out;}
async function systemPowerShell(){const st=await fs.lstat(PS);if(!st.isFile()||st.isSymbolicLink())u.fail('UNSAFE_PATH','System PowerShell must be a plain file');const real=await fs.realpath(PS);if(real.toLowerCase()!==PS.toLowerCase())u.fail('UNSAFE_PATH','System PowerShell path redirected');return PS;}
async function resolveNativeAuthority(){
 await systemPowerShell();
 const script="[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);@{local=[Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData);osUser=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value}|ConvertTo-Json -Compress";
 const raw=await new Promise((resolve,reject)=>cp.execFile(PS,['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{shell:false,windowsHide:true,encoding:'utf8',timeout:15000,maxBuffer:8192,env:cleanEnvironment(process.env)},(e,out)=>e?reject(e):resolve(out)));
 const value=JSON.parse(raw.replace(/^\uFEFF/,''));if(Object.keys(value).length!==2||typeof value.local!=='string'||typeof value.osUser!=='string'||!/^S-1-\d+(?:-\d+)+$/.test(value.osUser))u.fail('BAD_NATIVE_AUTHORITY','本机用户目录或SID无法核验');const local=u.safeAbsolute(value.local);await u.assertPath(fs,local,{directory:true});return{local,osUser:value.osUser};
}
async function resolveKnownLocal(){return(await resolveNativeAuthority()).local;}
const NATIVE_PARENT=String.raw`Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public sealed class XjyNativeParentLease : IDisposable {
 [StructLayout(LayoutKind.Sequential)] struct FileTime {public uint low;public uint high;public long Value{get{return unchecked((long)(((ulong)high<<32)|low));}}}
 [DllImport("kernel32.dll",SetLastError=true)] static extern SafeProcessHandle OpenProcess(uint access,bool inherit,uint pid);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetProcessTimes(SafeProcessHandle h,out FileTime creation,out FileTime exit,out FileTime kernel,out FileTime user);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool QueryFullProcessImageNameW(SafeProcessHandle h,uint flags,StringBuilder name,ref uint size);
 [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForSingleObject(SafeProcessHandle h,uint milliseconds);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetExitCodeProcess(SafeProcessHandle h,out uint code);
 readonly SafeProcessHandle handle;readonly long creation;
 XjyNativeParentLease(SafeProcessHandle h,long ft){handle=h;creation=ft;}
 static long Creation(SafeProcessHandle h){FileTime c,e,k,u;if(!GetProcessTimes(h,out c,out e,out k,out u))throw new IOException("PARENT_TIMES_"+Marshal.GetLastWin32Error());return c.Value;}
 public static XjyNativeParentLease Open(uint pid,string expectedExe,long wmiCreationFileTime){
  // QUERY_LIMITED_INFORMATION | SYNCHRONIZE only. Never TERMINATE or VM_WRITE.
  var h=OpenProcess(0x00101000,false,pid);if(h.IsInvalid){int error=Marshal.GetLastWin32Error();h.Dispose();throw new IOException("PARENT_OPEN_"+error);}
  try{var value=new StringBuilder(32768);uint size=32768;if(!QueryFullProcessImageNameW(h,0,value,ref size))throw new IOException("PARENT_IMAGE_"+Marshal.GetLastWin32Error());if(!String.Equals(Path.GetFullPath(value.ToString()),Path.GetFullPath(expectedExe),StringComparison.OrdinalIgnoreCase))throw new IOException("PARENT_IMAGE_CHANGED");long ft=Creation(h);
   // Original adapter uses WMI CreationDate ISO 'o', whose DMTF input has
   // microsecond precision. Do not demand equal native 100ns precision.
   // Bind the WMI microsecond interval, then retain/recheck the full native FT.
   if(ft<=0||wmiCreationFileTime<=0||ft/10!=wmiCreationFileTime/10)throw new IOException("PARENT_CREATION_CHANGED");
   return new XjyNativeParentLease(h,ft);
  }catch{h.Dispose();throw;}
 }
 public uint Wait(uint milliseconds){if(Creation(handle)!=creation)throw new IOException("PARENT_HANDLE_CREATION_CHANGED");uint result=WaitForSingleObject(handle,milliseconds);if(result!=0&&result!=258)throw new IOException("PARENT_WAIT_"+Marshal.GetLastWin32Error());return result;}
 public void RequireZeroExit(){if(Wait(0)!=0)throw new IOException("PARENT_NOT_EXITED");uint code;if(!GetExitCodeProcess(handle,out code))throw new IOException("PARENT_EXIT_QUERY_"+Marshal.GetLastWin32Error());if(code!=0)throw new IOException("PARENT_EXIT_NOT_ZERO_"+code);}
 public void Dispose(){handle.Dispose();}
}
'@`;

const QUOTE=value=>"'"+String(value).replace(/'/g,"''")+"'";
function handoffScript({bundleRoot,bootstrapSha256,readyFile,requestHash,parent,executablePath}){
 if(!Number.isSafeInteger(parent.pid)||parent.pid<1||typeof parent.creationMarker!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}Z$/.test(parent.creationMarker)||!u.samePath(parent.executablePath,executablePath))u.fail('BAD_PROCESS','当前员工进程无法确认');
 return [
 "$ErrorActionPreference='Stop';Set-StrictMode -Version Latest;[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)",
 NATIVE_PARENT,
 '$parentId='+parent.pid+';$marker='+QUOTE(parent.creationMarker)+';$expectedExe='+QUOTE(executablePath),
 "$bundle="+QUOTE(bundleRoot)+";$scriptFile=Join-Path $bundle '安装组件\\native-delivery-170.ps1';$expectedSha="+QUOTE(bootstrapSha256),
 "$ready="+QUOTE(readyFile)+";$requestHash="+QUOTE(requestHash),
 "function Parent { $p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$parentId);if($null -eq $p){return $null};if(!$p.CreationDate -or $p.CreationDate.ToUniversalTime().ToString('o') -cne $marker -or ![StringComparer]::OrdinalIgnoreCase.Equals([string]$p.ExecutablePath,$expectedExe)){throw 'Parent identity changed'};return $p }",
 "function Plain([string]$name){$walk=[IO.Path]::GetFullPath($name);while($walk){$item=Get-Item -LiteralPath $walk -Force;if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $item.LinkType){throw 'Handoff path is a link'};$p=[IO.Directory]::GetParent($walk);if(!$p){break};$walk=$p.FullName}}",
 "Plain $scriptFile;Plain ([IO.Path]::GetDirectoryName($ready));$parentRecord=Parent;if($null -eq $parentRecord){throw 'Parent exited before ready'};$pin=$null;$lease=[XjyNativeParentLease]::Open([uint32]$parentId,$expectedExe,$parentRecord.CreationDate.ToUniversalTime().ToFileTimeUtc());if($null -eq (Parent) -or $lease.Wait(0) -ne 258){$lease.Dispose();throw 'Parent exited before ready'}",
 "try{$pin=[IO.File]::Open($scriptFile,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)",
 "$hash=[Security.Cryptography.SHA256]::Create();try{$actual=([BitConverter]::ToString($hash.ComputeHash($pin))).Replace('-','').ToLowerInvariant()}finally{$hash.Dispose()};if($actual -cne $expectedSha){throw 'Signed native wrapper changed'}",
 "$secret=$env:XJY_NATIVE_HANDOFF_SECRET;if($secret -cnotmatch '^[a-f0-9]{64}$'){throw 'Missing handoff capability'};$key=New-Object byte[] 32;for($i=0;$i -lt 32;$i++){$key[$i]=[Convert]::ToByte($secret.Substring($i*2,2),16)};$h=New-Object Security.Cryptography.HMACSHA256 (,$key);try{$mac=([BitConverter]::ToString($h.ComputeHash([Text.Encoding]::UTF8.GetBytes($requestHash)))).Replace('-','').ToLowerInvariant()}finally{$h.Dispose()};$bytes=[Text.Encoding]::UTF8.GetBytes((@{requestHash=$requestHash;mac=$mac}|ConvertTo-Json -Compress));$f=[IO.File]::Open($ready,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None);try{$f.Write($bytes,0,$bytes.Length);$f.Flush($true)}finally{$f.Dispose()}",
 "$deadline=[DateTime]::UtcNow.AddMinutes(3);while($lease.Wait(100) -ne 0){if([DateTime]::UtcNow -ge $deadline){throw 'Employee did not exit normally; nothing installed'}};$lease.RequireZeroExit()",
 "Plain $scriptFile;$pin.Position=0;$hash=[Security.Cryptography.SHA256]::Create();try{$again=([BitConverter]::ToString($hash.ComputeHash($pin))).Replace('-','').ToLowerInvariant()}finally{$hash.Dispose()};if($again -cne $expectedSha){throw 'Native wrapper changed before handoff'};$pin.Position=0;$reader=New-Object IO.StreamReader($pin,[Text.UTF8Encoding]::new($false,$true),$true,4096,$true);try{$source=$reader.ReadToEnd()}finally{$reader.Dispose()};Remove-Item Env:XJY_NATIVE_HANDOFF_SECRET -ErrorAction SilentlyContinue;& ([ScriptBlock]::Create($source)) -PackageRoot $bundle -Action 'EmployeeSlot'",
 '}finally{if($pin){$pin.Dispose()};if($lease){$lease.Dispose()}}'
 ].join('\n');
}
async function launchNativeHandoff({bundleRoot,stageRoot,bootstrapSha256,parent,executablePath,manifestSha256}){
 await systemPowerShell();const readyFile=path.join(stageRoot,'native-ready.json'),secret=crypto.randomBytes(32).toString('hex');
 const requestHash=u.digest(Buffer.from(JSON.stringify({bundleRoot,bootstrapSha256,parent,executablePath,manifestSha256}))),script=handoffScript({bundleRoot,bootstrapSha256,readyFile,requestHash,parent,executablePath});
 const sourceFile=path.join(stageRoot,'native-handoff-'+crypto.randomUUID()+'.ps1'),scriptBytes=Buffer.from(script,'utf8'),scriptSha=u.digest(scriptBytes);
 // Source is generated by this trusted main module. It contains no capability
 // value; final PowerShell inherits that only from the clean process environment.
 const sourceHandle=await u.openChecked(fs,sourceFile,'wx+',{missing:true,root:stageRoot});try{await u.writeExactly(sourceHandle.handle,0,scriptBytes);await sourceHandle.handle.sync();await u.assertHandle(fs,sourceHandle,{root:stageRoot,snapshot:false});}finally{await sourceHandle.handle.close();}
 const finalBoot="$ErrorActionPreference='Stop';Set-StrictMode -Version Latest;$name="+QUOTE(sourceFile)+";$expected="+QUOTE(scriptSha)+";$trustedStage="+QUOTE(stageRoot)+";if(![StringComparer]::OrdinalIgnoreCase.Equals([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($name)),[IO.Path]::GetFullPath($trustedStage))){throw 'Handoff source stage changed'};function AssertSourcePlain([string]$p){$w=[IO.Path]::GetFullPath($p);while($w){$i=Get-Item -LiteralPath $w -Force;if(($i.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $i.LinkType){throw 'Handoff source path changed'};$d=[IO.Directory]::GetParent($w);if(!$d){break};$w=$d.FullName}};AssertSourcePlain $name;$handoffSourcePin=[IO.File]::Open($name,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);try{if($handoffSourcePin.Length -lt 1 -or $handoffSourcePin.Length -gt 131072){throw 'Handoff source size'};$hash=[Security.Cryptography.SHA256]::Create();try{$actual=([BitConverter]::ToString($hash.ComputeHash($handoffSourcePin))).Replace('-','').ToLowerInvariant()}finally{$hash.Dispose()};if($actual -cne $expected){throw 'Handoff source changed'};$handoffSourcePin.Position=0;$reader=[IO.StreamReader]::new($handoffSourcePin,[Text.UTF8Encoding]::new($false,$true),$false,4096,$true);try{$text=$reader.ReadToEnd()}finally{$reader.Dispose()};& ([ScriptBlock]::Create($text))}finally{$handoffSourcePin.Dispose()}";
 const finalBootBase64=Buffer.from(finalBoot,'utf16le').toString('base64'),finalArgs=['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',finalBootBase64];if(PS.length+finalArgs.join(' ').length>=7000)u.fail('BAD_NATIVE_HANDOFF','最终原生交接命令长度超限');
 const configBytes=Buffer.from(JSON.stringify({finalBootBase64,stageRoot}),'utf8'),configSha=u.digest(configBytes);
 const launcher=String.raw`[Console]::InputEncoding=[Text.UTF8Encoding]::new($false);$ErrorActionPreference='Stop';Set-StrictMode -Version Latest;$raw=[Console]::In.ReadToEnd();$hash=[Security.Cryptography.SHA256]::Create();try{$actual=([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($raw)))).Replace('-','').ToLowerInvariant()}finally{$hash.Dispose()};if($actual -cne '__CONFIG_SHA256__'){throw 'Handoff config changed'};$r=$raw|ConvertFrom-Json;$names=@($r.PSObject.Properties.Name|Sort-Object);if(($names -join ',') -cne 'finalBootBase64,stageRoot' -or $r.finalBootBase64 -isnot [string] -or $r.stageRoot -isnot [string]){throw 'Fixed handoff launcher schema'};$stage=[IO.Path]::GetFullPath($r.stageRoot);if($stage.StartsWith('\\') -or $stage.Substring(2).Contains(':') -or ![StringComparer]::OrdinalIgnoreCase.Equals($stage,[IO.Path]::GetFullPath([Environment]::CurrentDirectory))){throw 'Fixed handoff launcher stage'};$item=Get-Item -LiteralPath $stage -Force;if(!$item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Fixed handoff launcher directory'};$b64=$r.finalBootBase64;if($b64.Length -lt 4 -or $b64.Length -gt 6500 -or $b64 -cnotmatch '^[A-Za-z0-9+/]+={0,2}$'){throw 'Fixed handoff launcher encoding'};$bytes=[Convert]::FromBase64String($b64);if([Convert]::ToBase64String($bytes) -cne $b64 -or $bytes.Length%2 -ne 0){throw 'Fixed handoff launcher encoding'};[void]([Text.UnicodeEncoding]::new($false,$false,$true).GetString($bytes));$exe='C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe';$args=@('-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',$b64);if($exe.Length+($args -join ' ').Length -ge 7000){throw 'Fixed handoff launcher command length'};Start-Process -FilePath $exe -ArgumentList $args -WorkingDirectory $stage -WindowStyle Hidden|Out-Null`.replace('__CONFIG_SHA256__',configSha);
 const args=['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(launcher,'utf16le').toString('base64')];if(PS.length+args.join(' ').length>=7000)u.fail('BAD_NATIVE_HANDOFF','原生交接启动命令长度超限');
 const child=cp.spawn(PS,args,{cwd:stageRoot,shell:false,windowsHide:true,detached:false,stdio:['pipe','ignore','ignore'],env:{...cleanEnvironment(process.env),XJY_NATIVE_HANDOFF_SECRET:secret}});let inputError=null;child.stdin.on('error',error=>{inputError=error;});child.stdin.end(configBytes);
 await new Promise((resolve,reject)=>{child.once('error',reject);child.once('spawn',resolve);});child.unref();
 const until=Date.now()+15000;
 while(Date.now()<until){if(inputError)u.fail('NATIVE_HANDOFF_INPUT','原生交接源码未完整传输');try{const value=JSON.parse(await u.readSmall(fs,readyFile,4096));if(!value||Object.keys(value).length!==2||value.requestHash!==requestHash||typeof value.mac!=='string'||!/^[a-f0-9]{64}$/.test(value.mac)||!crypto.timingSafeEqual(Buffer.from(value.mac,'hex'),crypto.createHmac('sha256',Buffer.from(secret,'hex')).update(requestHash).digest()))u.fail('BAD_NATIVE_HANDOFF','原生助手就绪记录认证失败');return{ready:true,requestHash};}catch(e){if(e.code!=='ENOENT'&&e.code!=='EBUSY')throw e;}await new Promise(r=>setTimeout(r,100));}
 u.fail('NATIVE_HANDOFF_TIMEOUT','原生助手未确认就绪，员工程序保持打开；未结束任何进程');
}
module.exports={resolveKnownLocal,resolveNativeAuthority,launchNativeHandoff,handoffScript,cleanEnvironment};
 
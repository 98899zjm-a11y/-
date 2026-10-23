# Trusted first-delivery entry. The independent trust pins are fixed by Root;
# they are never learned from the payload, a local JSON file or CLI overrides.
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class XjyOneClickPathGuard {
 [StructLayout(LayoutKind.Sequential)] struct Info { public uint attributes; public uint creationLow; public uint creationHigh; public uint accessLow; public uint accessHigh; public uint writeLow; public uint writeHigh; public uint volume; public uint sizeHigh; public uint sizeLow; public uint links; public uint indexHigh; public uint indexLow; }
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle h,out Info info);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern uint GetFinalPathNameByHandle(SafeFileHandle h,StringBuilder value,uint size,uint flags);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern SafeFileHandle CreateFileW(string path,uint access,uint share,IntPtr security,uint creation,uint flags,IntPtr template);
 public static void Check(SafeFileHandle handle,string expected,bool directory) { Info info;if(!GetFileInformationByHandle(handle,out info))throw new IOException("Cannot inspect installer input");if((info.attributes&0x400)!=0||(directory?(info.attributes&0x10)==0:(info.attributes&0x10)!=0||info.links!=1))throw new IOException("Link or unexpected file identity");var text=new StringBuilder(32768);uint n=GetFinalPathNameByHandle(handle,text,32768,0);if(n==0||n>=32768)throw new IOException("Cannot canonicalize installer input");string actual=text.ToString();if(actual.StartsWith(@"\\?\"))actual=actual.Substring(4);if(!String.Equals(Path.GetFullPath(expected),actual,StringComparison.OrdinalIgnoreCase))throw new IOException("Path changed or alias used"); }
 public static SafeFileHandle Directory(string name) { var h=CreateFileW(name,0x80,1,IntPtr.Zero,3,0x02000000,IntPtr.Zero);if(h.IsInvalid)throw new IOException("Cannot pin installer directory");try{Check(h,name,true);return h;}catch{h.Dispose();throw;} }
}
'@
$held=New-Object 'Collections.Generic.List[IDisposable]'
$pinnedDirs=New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
function Assert-FixedWindowsDirectory([string]$Value){
 if(![StringComparer]::OrdinalIgnoreCase.Equals($Value,'C:\Windows')){throw '此安装包暂不支持当前 Windows 系统目录，请联系开发者。'}
}
function Plain([string]$Name,[bool]$Directory=$false){
 if(!$Name -or ![IO.Path]::IsPathRooted($Name) -or $Name.StartsWith('\') -or $Name.Substring(2).Contains(':')){throw '请把安装包完整解压到普通本机文件夹。'}
 foreach($part in $Name.Substring([IO.Path]::GetPathRoot($Name).Length).Split([char[]]'\/')){if($part -in @('.','..') -or $part -match '[. ]$|[\x00-\x1f"<>|?*]' -or $part -match '^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)'){throw '安装路径含不支持的别名或字符。'}}
 $p=[IO.Path]::GetFullPath($Name);$walk=$p
 while($walk){$item=Get-Item -LiteralPath $walk -Force;if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $item.LinkType){throw '安装路径不能经过链接或重解析点。'};$parent=[IO.Directory]::GetParent($walk);if(!$parent){break};$walk=$parent.FullName}
 $last=Get-Item -LiteralPath $p -Force;if($Directory -ne [bool]$last.PSIsContainer){throw '安装包文件或目录类型不正确。'};return $p
}
function Pin-Parents([string]$Dir){$walk=$Dir;while($walk){if($pinnedDirs.Add($walk)){$held.Add([XjyOneClickPathGuard]::Directory($walk))};$parent=[IO.Directory]::GetParent($walk);if(!$parent){break};$walk=$parent.FullName}}
function Pin-File([string]$Name,[string]$Sha){
 $p=Plain $Name;Pin-Parents ([IO.Path]::GetDirectoryName($p));$f=[IO.File]::Open($p,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
 try{[XjyOneClickPathGuard]::Check($f.SafeFileHandle,$p,$false);$hash=[Security.Cryptography.SHA256]::Create();try{$actual=([BitConverter]::ToString($hash.ComputeHash($f))).Replace('-','').ToLowerInvariant()}finally{$hash.Dispose()};if($actual -cne $Sha){throw '安装文件校验不通过，请重新取得本对话提供的完整安装包。'};$f.Position=0;$held.Add($f)}catch{$f.Dispose();throw}
}
function Assert-OneClickApprovalReceipt($Receipt,[string]$OsUser){
 $keys=@('purpose','written','artifactSha256','publisherPublicKeySha256','installationDir','osUser','role','approvalId','expiresAt')
 if($null -eq $Receipt -or $Receipt -isnot [pscustomobject] -or @($Receipt.PSObject.Properties).Count -ne $keys.Count){throw '安装准备没有返回完整确认记录，升级未开始。'}
 foreach($key in $keys){if($null -eq $Receipt.PSObject.Properties[$key]){throw '安装准备缺少确认字段，升级未开始。'}}
 if($Receipt.purpose -cne 'xjy-oneclick-approval-written' -or $Receipt.written -isnot [bool] -or !$Receipt.written -or $Receipt.artifactSha256 -cne '8b829f7c46e2e4b45d1553da2a47a876c49b4d7f12c1babfe87c8cc1a7f77bd4' -or $Receipt.publisherPublicKeySha256 -cne '6e8b9cadb59aeb53f30d41f4471f70f644f0dfc7376ffb9d8a4c62defb98458c' -or $Receipt.osUser -cne $OsUser -or !(@('host','employee') -ccontains $Receipt.role) -or $Receipt.approvalId -notmatch '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'){throw '安装准备的文件、用户或角色与本次交付不符，升级未开始。'}
 $dir=$Receipt.installationDir
 if($dir -isnot [string] -or $dir -notmatch '^[A-Za-z]:\\' -or $dir.Substring(2).Contains(':') -or $dir -cne [IO.Path]::GetFullPath($dir)){throw '安装准备返回了不规范的程序位置。'}
 foreach($part in $dir.Substring(3).Split('\')){if(!$part -or $part -in @('.','..') -or $part -match '[. ]$|[\x00-\x1f"<>|?*]' -or $part -match '^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)'){throw '安装准备返回了不安全的程序位置。'}}
 $expires=[DateTimeOffset]::MinValue
 if($Receipt.expiresAt -isnot [string] -or ![DateTimeOffset]::TryParse($Receipt.expiresAt,[ref]$expires) -or $expires -le [DateTimeOffset]::UtcNow -or $expires -gt [DateTimeOffset]::UtcNow.AddHours(24).AddMinutes(1)){throw '安装准备记录已经过期或有效期不正确。'}
}
function Invoke-OneClickInstallSequence([scriptblock]$Review,[scriptblock]$Install,[string]$OsUser){
 $result=& $Review
 if(!$result -or $result.processExited -isnot [bool] -or !$result.processExited){throw '安装准备进程未正常退出，升级未开始。'}
 if($result.exitCode -eq 2){return [pscustomobject]@{cancelled=$true;launcherFinished=$false}}
 if($result.exitCode -ne 0){throw ('安装准备没有完成，升级未开始。'+[Environment]::NewLine+$result.stderr)}
 try{$receipt=ConvertFrom-Json -InputObject $result.stdout -ErrorAction Stop}catch{throw '安装准备未确认写入受保护记录，升级未开始。'}
 Assert-OneClickApprovalReceipt $receipt $OsUser
 # The reviewer has exited and disposed all of its old-ASAR file handles.
 $installed=& $Install
 if(!$installed -or $installed.processExited -ne $true -or $installed.exitCode -ne 0){throw ('升级窗口未正常结束。请保留原软件，按提示重试。'+[Environment]::NewLine+$installed.stderr)}
 # Exit zero can also mean the user cancelled the shipping role dialog.
 # Only the shipping launcher's verified completion UI asserts installation.
 return [pscustomobject]@{cancelled=$false;launcherFinished=$true;installationConfirmed=$false}
}
function Invoke-FixedPowerShell([string]$File,[bool]$Guided=$false){
 $psi=New-Object Diagnostics.ProcessStartInfo;$psi.FileName='C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe';$psi.Arguments='-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+$File+'"';if($Guided){$psi.Arguments+=' -OneClick'}
 $psi.UseShellExecute=$false;$psi.CreateNoWindow=$true;$psi.RedirectStandardOutput=$Guided;$psi.RedirectStandardError=$Guided
 if($Guided){$psi.StandardOutputEncoding=[Text.UTF8Encoding]::new($false);$psi.StandardErrorEncoding=[Text.UTF8Encoding]::new($false)}
 $psi.EnvironmentVariables.Clear()
 $psi.EnvironmentVariables['SystemRoot']='C:\Windows';$psi.EnvironmentVariables['WINDIR']='C:\Windows';$psi.EnvironmentVariables['SystemDrive']='C:';$psi.EnvironmentVariables['PATHEXT']='.EXE';$psi.EnvironmentVariables['LOCALAPPDATA']=[Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData);$psi.EnvironmentVariables['APPDATA']=[Environment]::GetFolderPath([Environment+SpecialFolder]::ApplicationData);$psi.EnvironmentVariables['USERPROFILE']=[Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile);$psi.EnvironmentVariables['TEMP']=$script:temp;$psi.EnvironmentVariables['TMP']=$script:temp;$psi.WorkingDirectory=$script:bundle
 $p=[Diagnostics.Process]::Start($psi)
 try{
  if($Guided){$o=$p.StandardOutput.ReadToEndAsync();$e=$p.StandardError.ReadToEndAsync();$p.WaitForExit();return [pscustomobject]@{processExited=$true;exitCode=$p.ExitCode;stdout=$o.Result;stderr=$e.Result}}
  $p.WaitForExit()
  return [pscustomobject]@{processExited=$true;exitCode=$p.ExitCode;stdout='';stderr=''}
 }finally{$p.Dispose()}
}
try{
 Assert-FixedWindowsDirectory ([Environment]::GetFolderPath([Environment+SpecialFolder]::Windows))
 $script:bundle=Plain ([IO.Directory]::GetParent($PSScriptRoot).FullName) $true;Pin-Parents $script:bundle
 $pins=ConvertFrom-Json -InputObject '__PINNED_REVIEWER_JSON__'
 foreach($pin in $pins){Pin-File (Join-Path $script:bundle $pin.path) $pin.sha256}
 $script:temp=Join-Path $script:bundle '安装临时文件';if(!(Test-Path -LiteralPath $script:temp)){[void][IO.Directory]::CreateDirectory($script:temp)};[void](Plain $script:temp $true)
 $reviewer=Plain (Join-Path $script:bundle '安装组件\审定工具\Prepare-Initial-Approval.ps1')
 $shipping=Plain (Join-Path $script:bundle '安装组件\补丁文件\delivery-tools\Initial-Full-Upgrade.ps1')
 $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
 [void](Invoke-OneClickInstallSequence {Invoke-FixedPowerShell $reviewer $true} {Invoke-FixedPowerShell $shipping $false} $sid)
}catch{[void][Windows.Forms.MessageBox]::Show($_.Exception.Message,'安装更新未完成',[Windows.Forms.MessageBoxButtons]::OK,[Windows.Forms.MessageBoxIcon]::Error);exit 1}finally{for($i=$held.Count-1;$i -ge 0;$i--){$held[$i].Dispose()}}

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
# Fixed data-free path/FD guard shared by the two reviewed native launchers.
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class XjyInitialPathGuard {
 [StructLayout(LayoutKind.Sequential)] struct Info { public uint attributes; public uint creationLow; public uint creationHigh; public uint accessLow; public uint accessHigh; public uint writeLow; public uint writeHigh; public uint volume; public uint sizeHigh; public uint sizeLow; public uint links; public uint indexHigh; public uint indexLow; }
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle h,out Info info);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern uint GetFinalPathNameByHandle(SafeFileHandle h,StringBuilder value,uint size,uint flags);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern SafeFileHandle CreateFileW(string path,uint access,uint share,IntPtr security,uint creation,uint flags,IntPtr template);
 public static void Check(SafeFileHandle handle,string expected,bool directory) { Info info;if(!GetFileInformationByHandle(handle,out info))throw new IOException("Cannot inspect fixed handle");if((info.attributes&0x400)!=0||(directory?(info.attributes&0x10)==0:(info.attributes&0x10)!=0||info.links!=1))throw new IOException("Link or unexpected file identity");var text=new StringBuilder(32768);uint n=GetFinalPathNameByHandle(handle,text,32768,0);if(n==0||n>=32768)throw new IOException("Cannot canonicalize handle");string actual=text.ToString();if(actual.StartsWith(@"\\?\"))actual=actual.Substring(4);if(!String.Equals(Path.GetFullPath(expected),actual,StringComparison.OrdinalIgnoreCase))throw new IOException("Path changed or alias used"); }
 public static SafeFileHandle Directory(string name) { var h=CreateFileW(name,0x80,1,IntPtr.Zero,3,0x02000000,IntPtr.Zero);if(h.IsInvalid)throw new IOException("Cannot pin fixed directory");try{Check(h,name,true);return h;}catch{h.Dispose();throw;} }
}
'@
function Pin-PlainFile([string]$Name) { $f=[IO.File]::Open($Name,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);try{[XjyInitialPathGuard]::Check($f.SafeFileHandle,$Name,$false);return $f}catch{$f.Dispose();throw} }
function Pin-PlainDirectory([string]$Name) { return [XjyInitialPathGuard]::Directory($Name) }

$ExpectedPublicationId='230b9825c9c05749d193d9fdcb30906b084186fe7fdee3a22884085399001000'
$held=New-Object 'Collections.Generic.List[IDisposable]'
$pinnedDirs=New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
function Pin-Parents([string]$Dir) { $walk=$Dir;while($walk){if($pinnedDirs.Add($walk)){$held.Add((Pin-PlainDirectory $walk))};$parent=[IO.Directory]::GetParent($walk);if(!$parent){break};$walk=$parent.FullName} }
# This fixed Host publication still needs the original independent, package-
# external approval for the current Windows SID and this exact catalog leaf.
function Plain([string]$Name,[bool]$Directory=$false) {
 if (!$Name -or ![IO.Path]::IsPathRooted($Name) -or $Name.StartsWith('\\') -or $Name.Substring(2).Contains(':')) { throw '路径必须为普通本机绝对路径。' }
 $parts=$Name.Substring([IO.Path]::GetPathRoot($Name).Length).Split([char[]]'\/')
 foreach($part in $parts) { if($part -eq '.' -or $part -eq '..' -or $part -match '[. ]$|[\x00-\x1f]' -or $part -match '^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)') { throw '路径别名或保留名称被拒绝。' } }
 $p=[IO.Path]::GetFullPath($Name);$walk=$p
 while($walk) { $item=Get-Item -LiteralPath $walk -Force; if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $item.LinkType) { throw '路径不能经过链接、硬链接或重解析点。' };if($walk -ne $p -and !$item.PSIsContainer) { throw '父路径不是普通目录。' };$parent=[IO.Directory]::GetParent($walk);if(!$parent){break};$walk=$parent.FullName }
 $last=Get-Item -LiteralPath $p -Force;if($Directory -ne [bool]$last.PSIsContainer){throw '文件或目录类型不符。'};return $p
}
function Get-FixedApprovalRoot([string]$Common,[string]$Sid){
 if($Sid -cnotmatch '^S-1-\d+(?:-\d+)+$' -or !$Common -or $Common -notmatch '^[A-Za-z]:\\' -or $Common.Substring(2).Contains(':') -or $Common -cne [IO.Path]::GetFullPath($Common)){throw '当前 Windows 公共目录或 SID 不规范，停止。'}
 $suffix=$Common.Substring(3)
 if($suffix){foreach($part in $suffix.Split('\')){if(!$part -or $part -in @('.','..') -or $part -match '[. ]$|[\\/\x00-\x1f"<>|?*]' -or $part -match '^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)'){throw '当前 Windows 公共目录含路径别名，停止。'}}}
 return Join-Path (Join-Path $Common ('鑫金源珠宝补丁审定-'+$Sid)) $ExpectedPublicationId
}
function Bytes([string]$Name,[int]$Limit=2097152) { $p=Plain $Name; $f=[IO.File]::Open($p,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);try { [XjyInitialPathGuard]::Check($f.SafeFileHandle,$p,$false);if($f.Length -gt $Limit){throw '审定元数据过大。'};$b=New-Object byte[] ([int]$f.Length);$n=0;while($n -lt $b.Length){$r=$f.Read($b,$n,$b.Length-$n);if(!$r){throw '读取不完整。'};$n+=$r};[XjyInitialPathGuard]::Check($f.SafeFileHandle,$p,$false);return ,$b } finally {$f.Dispose()} }
function SHA([byte[]]$b){$h=[Security.Cryptography.SHA256]::Create();try{return ([BitConverter]::ToString($h.ComputeHash($b))).Replace('-','').ToLowerInvariant()}finally{$h.Dispose()}}
function TreeSHA([string]$root) { $root=Plain $root $true;Pin-Parents $root; $list=New-Object 'Collections.Generic.List[string]';$byName=@{};$stack=New-Object 'Collections.Generic.Stack[string]';$stack.Push($root);while($stack.Count){$dir=$stack.Pop();foreach($item in Get-ChildItem -LiteralPath $dir -Force){$p=Plain $item.FullName ([bool]$item.PSIsContainer);if($item.PSIsContainer){Pin-Parents $p;$stack.Push($p)}else{$relative=$p.Substring($root.Length+1).Replace('\','/');if($relative -match '[\x00-\x1f]' -or $byName.ContainsKey($relative)){throw '补丁含不规范或重复名称。'};$pin=Pin-PlainFile $p;$held.Add($pin);$byName[$relative]=@($p,$pin);$list.Add($relative)}}};$list.Sort([StringComparer]::Ordinal);$s=New-Object Text.StringBuilder;foreach($r in $list){$pair=$byName[$r];$f=$pair[1];$f.Position=0;$h=[Security.Cryptography.SHA256]::Create();try{$hash=([BitConverter]::ToString($h.ComputeHash($f))).Replace('-','').ToLowerInvariant()}finally{$h.Dispose()};[XjyInitialPathGuard]::Check($f.SafeFileHandle,$pair[0],$false);[void]$s.Append($r).Append([char]0).Append($f.Length.ToString([Globalization.CultureInfo]::InvariantCulture)).Append([char]0).Append($hash).Append("`n")};return SHA ([Text.Encoding]::UTF8.GetBytes($s.ToString())) }
try {
 $root=Plain ([IO.Directory]::GetParent($PSScriptRoot).FullName) $true
 $local=[Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
 $common=[Environment]::GetFolderPath([Environment+SpecialFolder]::CommonApplicationData);$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
 $approvalRoot=Plain (Get-FixedApprovalRoot $common $sid) $true
 $approvalFile=Join-Path $approvalRoot 'initial-upgrade-approval.json';Pin-Parents $approvalRoot;$approvalPin=Pin-PlainFile $approvalFile;$held.Add($approvalPin)
 $record=([Text.Encoding]::UTF8.GetString((Bytes $approvalFile 8192))) | ConvertFrom-Json
 $fields=@('schemaVersion','purpose','approvalId','artifactSha256','treeSha256','publisherPublicKeySha256','sourcePolicySha256','verifiedPublisherName','role','installationDir','osUser','engine','approvedAt','expiresAt')
 $names=@($record.PSObject.Properties.Name);if($names.Count -ne 14){throw '独立审定记录字段不完整。'};foreach($name in $names){if($name -cnotin $fields){throw '独立审定记录含未知字段。'}}
 if(!($record.schemaVersion -is [long] -or $record.schemaVersion -is [int]) -or $record.schemaVersion -ne 1 -or $record.purpose -cne 'xjy-repeat-program-patch' -or $record.role -cne 'host' -or $record.osUser -cne $sid -or $record.approvalId -cnotmatch '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' -or !($record.verifiedPublisherName -is [string]) -or !$record.verifiedPublisherName.Trim() -or $record.verifiedPublisherName.Length -gt 160){throw '请先由负责人独立审定本次主机补丁、发行者和此机安装位置。包内文件不能自行批准安装。'}
 foreach($name in @('artifactSha256','treeSha256','publisherPublicKeySha256','sourcePolicySha256')){if($record.$name -cnotmatch '^[a-f0-9]{64}$'){throw '独立审定摘要不完整。'}}
 $approved=[DateTime]::Parse($record.approvedAt).ToUniversalTime();$expires=[DateTime]::Parse($record.expiresAt).ToUniversalTime();$now=[DateTime]::UtcNow
 if($approved -gt $now.AddMinutes(5) -or $expires -le $now -or $expires -le $approved -or $record.publisherPublicKeySha256 -cne '6e8b9cadb59aeb53f30d41f4471f70f644f0dfc7376ffb9d8a4c62defb98458c'){throw '独立审定已过期、时间无效或发行者不符。'}
 if((TreeSHA $root) -cne $record.treeSha256){throw '完整补丁文件与包外审定摘要不符。'}
 $install=Plain $record.installationDir $true;Pin-Parents $install
 $signed=([Text.Encoding]::UTF8.GetString((Bytes (Join-Path $root 'source-policy-envelope.json')))) | ConvertFrom-Json
 if((SHA ([Text.Encoding]::UTF8.GetBytes([string]$signed.policy))) -cne $record.sourcePolicySha256){throw '旧引擎策略与独立审定不符。'}
 $policy=$signed.policy | ConvertFrom-Json
 if($policy.purpose -cne 'xjy-repeat-program-patch' -or $policy.targetVersion -cne '1.6.2' -or $policy.catalogSha256 -cne $ExpectedPublicationId -or $policy.publisherPublicKeySha256 -cne $record.publisherPublicKeySha256){throw '本入口仅接纳本次独立审定的1.6.2主机补丁。'}
 foreach($engine in @($record.engine,$policy.engine)){
  $engineNames=@($engine.PSObject.Properties.Name);if($engineNames.Count -ne 4 -or @($engineNames | Where-Object {$_ -cnotin @('size','sha256','electronRunAsNode','nodeSqliteBackup')}).Count -ne 0 -or !($engine.size -is [long] -or $engine.size -is [int]) -or $engine.size -ne 246302720 -or $engine.sha256 -cne 'db3ad2066a55546f9b6737da3c7f011370e4856fb36888055b544d45653e4f40' -or !($engine.electronRunAsNode -is [bool]) -or $engine.electronRunAsNode -ne $true -or !($engine.nodeSqliteBackup -is [bool]) -or $engine.nodeSqliteBackup -ne $true){throw '没有核验完整旧EXE引擎能力，不执行任何程序。'}
 }
 if(($record.engine | ConvertTo-Json -Compress) -cne ($policy.engine | ConvertTo-Json -Compress)){throw '独立审定与源策略的完整引擎记录不一致。'}
 if($policy.executableName -cne '鑫金源珠宝报价.exe'){throw '原引擎名称不符。'}
 $exe=Plain (Join-Path $install $policy.executableName);$enginePin=Pin-PlainFile $exe;$held.Add($enginePin);$enginePin.Position=0;$engineHasher=[Security.Cryptography.SHA256]::Create();try{$engineSha=([BitConverter]::ToString($engineHasher.ComputeHash($enginePin))).Replace('-','').ToLowerInvariant()}finally{$engineHasher.Dispose()};[XjyInitialPathGuard]::Check($enginePin.SafeFileHandle,$exe,$false)
 if($enginePin.Length -ne $record.engine.size -or $engineSha -cne $record.engine.sha256){throw '旧EXE引擎完整摘要不符；ASAR摘要不能代替EXE核验。'}
 $answer=[Windows.Forms.MessageBox]::Show("鑫金源珠宝主机1.6.2内部补丁`n`n独立审定发布者：$($record.verifiedPublisherName)`n安装位置：$install`n`n请正常关闭旧软件、财务和库管程序。`n本机必须已经独立核实为主机；原助手会核验三库与资料备份。`n确认后由原助手完成升级或认证恢复。",'确认本机主机升级',[Windows.Forms.MessageBoxButtons]::OKCancel,[Windows.Forms.MessageBoxIcon]::Information)
 if($answer -ne [Windows.Forms.DialogResult]::OK){exit 0}
 # Recovery decisions remain in the original authenticated entry/core chain.
 $mode='--upgrade'
 $entry=Plain (Join-Path $root 'delivery-tools\initial-patch-entry.cjs')
 $psi=New-Object Diagnostics.ProcessStartInfo;$psi.FileName=$exe;$psi.Arguments='"'+$entry+'" '+$mode;$psi.WorkingDirectory=$install;$psi.UseShellExecute=$false;$psi.CreateNoWindow=$true;$psi.RedirectStandardOutput=$true;$psi.RedirectStandardError=$true;$psi.StandardOutputEncoding=[Text.UTF8Encoding]::new($false);$psi.StandardErrorEncoding=[Text.UTF8Encoding]::new($false);$psi.EnvironmentVariables.Clear()
 foreach($key in @('SystemRoot','WINDIR','TEMP','TMP','LOCALAPPDATA','APPDATA','USERPROFILE')){$value=[Environment]::GetEnvironmentVariable($key,'Process');if($value){$psi.EnvironmentVariables[$key]=$value}}
 $psi.EnvironmentVariables['LOCALAPPDATA']=$local;$psi.EnvironmentVariables['APPDATA']=[Environment]::GetFolderPath([Environment+SpecialFolder]::ApplicationData);$psi.EnvironmentVariables['SystemRoot']=[Environment]::GetFolderPath([Environment+SpecialFolder]::Windows);$psi.EnvironmentVariables['WINDIR']=$psi.EnvironmentVariables['SystemRoot']
 $psi.EnvironmentVariables['ELECTRON_RUN_AS_NODE']='1';$psi.EnvironmentVariables['XJY_INITIAL_APPROVAL_LAUNCH']='1';$psi.EnvironmentVariables['XJY_INITIAL_ROLE']='host';$psi.EnvironmentVariables['XJY_INITIAL_OS_USER']=$sid
 [XjyInitialPathGuard]::Check($enginePin.SafeFileHandle,$exe,$false);$proc=[Diagnostics.Process]::Start($psi);$outTask=$proc.StandardOutput.ReadToEndAsync();$errTask=$proc.StandardError.ReadToEndAsync();$proc.WaitForExit();$out=$outTask.Result;$err=$errTask.Result;if($proc.ExitCode -ne 0){throw $err};$result=$out.Trim()|ConvertFrom-Json
 if($result.completed -or $result.alreadyInstalled){[void][Windows.Forms.MessageBox]::Show('已核验本次主机升级完成记录，现在可正常打开程序。','已核验')}elseif($result.recovered){[void][Windows.Forms.MessageBox]::Show('原助手已恢复旧程序，资料快照仍保留。请保留本次材料并联系负责人审查后续操作。','已恢复')}elseif($result.installed){[void][Windows.Forms.MessageBox]::Show('完整主机程序资源已升级。旧程序备份和升级前资料快照已保留。','完成')}else{throw '助手没有确认升级或恢复完成。'}
} catch { [void][Windows.Forms.MessageBox]::Show($_.Exception.Message,'主机升级未开始或未完成',[Windows.Forms.MessageBoxButtons]::OK,[Windows.Forms.MessageBoxIcon]::Error);exit 1 } finally { for($i=$held.Count-1;$i -ge 0;$i--){$held[$i].Dispose()} }

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

$held=New-Object 'Collections.Generic.List[IDisposable]'
$pinnedDirs=New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
function Pin-Parents([string]$Dir) { $walk=$Dir;while($walk){if($pinnedDirs.Add($walk)){$held.Add((Pin-PlainDirectory $walk))};$parent=[IO.Directory]::GetParent($walk);if(!$parent){break};$walk=$parent.FullName} }
# This is the first-install boundary. A PEM bundled in a ZIP does not prove who
# published it. Root's separately audited record must already exist outside it.
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
 return Join-Path $Common ('鑫金源珠宝初次升级审定-'+$Sid)
}
function Bytes([string]$Name,[int]$Limit=2097152) { $p=Plain $Name; $f=[IO.File]::Open($p,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);try { if($f.Length -gt $Limit){throw '审定元数据过大。'};$b=New-Object byte[] ([int]$f.Length);$n=0;while($n -lt $b.Length){$r=$f.Read($b,$n,$b.Length-$n);if(!$r){throw '读取不完整。'};$n+=$r};return ,$b } finally {$f.Dispose()} }
function SHA([byte[]]$b){$h=[Security.Cryptography.SHA256]::Create();try{return ([BitConverter]::ToString($h.ComputeHash($b))).Replace('-','').ToLowerInvariant()}finally{$h.Dispose()}}
function FileSHA([string]$p){$p=Plain $p;$f=[IO.File]::Open($p,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);$h=[Security.Cryptography.SHA256]::Create();try{return ([BitConverter]::ToString($h.ComputeHash($f))).Replace('-','').ToLowerInvariant()}finally{$h.Dispose();$f.Dispose()}}
function TreeSHA([string]$root) { $root=Plain $root $true;Pin-Parents $root; $list=New-Object 'Collections.Generic.List[string]';$byName=@{};$stack=New-Object 'Collections.Generic.Stack[string]';$stack.Push($root);while($stack.Count){$dir=$stack.Pop();foreach($item in Get-ChildItem -LiteralPath $dir -Force){$p=Plain $item.FullName ([bool]$item.PSIsContainer);if($item.PSIsContainer){Pin-Parents $p;$stack.Push($p)}else{$relative=$p.Substring($root.Length+1).Replace('\','/');if($relative -match '[\x00-\x1f]' -or $byName.ContainsKey($relative)){throw '补丁含不规范或重复名称。'};$pin=Pin-PlainFile $p;$held.Add($pin);$byName[$relative]=@($p,$pin);$list.Add($relative)}}};$list.Sort([StringComparer]::Ordinal);$s=New-Object Text.StringBuilder;foreach($r in $list){$pair=$byName[$r];$f=$pair[1];$f.Position=0;$h=[Security.Cryptography.SHA256]::Create();try{$hash=([BitConverter]::ToString($h.ComputeHash($f))).Replace('-','').ToLowerInvariant()}finally{$h.Dispose()};[XjyInitialPathGuard]::Check($f.SafeFileHandle,$pair[0],$false);[void]$s.Append($r).Append([char]0).Append($f.Length.ToString([Globalization.CultureInfo]::InvariantCulture)).Append([char]0).Append($hash).Append("`n")};return SHA ([Text.Encoding]::UTF8.GetBytes($s.ToString())) }
try {
 $root=Plain ([IO.Directory]::GetParent($PSScriptRoot).FullName) $true
 $local=[Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
 $common=[Environment]::GetFolderPath([Environment+SpecialFolder]::CommonApplicationData);$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
 $approvalRoot=Plain (Get-FixedApprovalRoot $common $sid) $true
 $approvalFile=Join-Path $approvalRoot 'initial-upgrade-approval.json';Pin-Parents $approvalRoot;$approvalPin=Pin-PlainFile $approvalFile;$held.Add($approvalPin)
 $record=([Text.Encoding]::UTF8.GetString((Bytes $approvalFile 8192))) | ConvertFrom-Json
 if($record.schemaVersion -ne 1 -or $record.purpose -ne 'xjy-initial-full-upgrade' -or $record.osUser -ne $sid -or $record.role -notin @('host','employee') -or !$record.verifiedPublisherName -or [DateTime]::Parse($record.expiresAt).ToUniversalTime() -le [DateTime]::UtcNow){throw '请先由负责人独立审定补丁摘要、公钥和这台电脑的安装角色。包内文件不能自行批准安装。'}
 if((TreeSHA $root) -ne $record.treeSha256){throw '完整补丁文件与包外审定摘要不符。'}
 $install=Plain $record.installationDir $true;Pin-Parents $install
 $signed=([Text.Encoding]::UTF8.GetString((Bytes (Join-Path $root 'source-policy-envelope.json')))) | ConvertFrom-Json
 if((SHA ([Text.Encoding]::UTF8.GetBytes([string]$signed.policy))) -ne $record.sourcePolicySha256){throw '旧引擎策略与独立审定不符。'}
 $policy=$signed.policy | ConvertFrom-Json
 if($policy.executableName -match '[/\\:]' -or !$policy.executableName -or $policy.engine.sha256 -ne $record.engine.sha256 -or $policy.engine.size -ne $record.engine.size -or !$policy.engine.electronRunAsNode -or !$policy.engine.nodeSqliteBackup){throw '没有核验完整旧EXE引擎能力，不执行任何程序。'}
 $exe=Plain (Join-Path $install $policy.executableName);$enginePin=Pin-PlainFile $exe;$held.Add($enginePin);$enginePin.Position=0;$engineHasher=[Security.Cryptography.SHA256]::Create();try{$engineSha=([BitConverter]::ToString($engineHasher.ComputeHash($enginePin))).Replace('-','').ToLowerInvariant()}finally{$engineHasher.Dispose()};[XjyInitialPathGuard]::Check($enginePin.SafeFileHandle,$exe,$false)
 if($enginePin.Length -ne $record.engine.size -or $engineSha -ne $record.engine.sha256){throw '旧EXE引擎完整摘要不符；ASAR摘要不能代替EXE核验。'}
 $form=New-Object Windows.Forms.Form;$form.Text='鑫金源珠宝完整升级';$form.Size=New-Object Drawing.Size(560,300);$form.StartPosition='CenterScreen';$form.FormBorderStyle='FixedDialog';$form.MaximizeBox=$false
 $label=New-Object Windows.Forms.Label;$label.Location=New-Object Drawing.Point(20,20);$label.Size=New-Object Drawing.Size(510,145);$label.Text="独立审定发布者：$($record.verifiedPublisherName)`n安装位置：$install`n`n请正常关闭旧软件、财务和库管程序，选择这台电脑的角色。`n主机先完整备份三库和资料；员工端不需要F盘。`n原EXE、客户资料和账号不会被搬动。";$form.Controls.Add($label)
 $script:selected=$null
 foreach($choice in @(@('host','这是主机',25),@('employee','这是员工电脑',195))){$button=New-Object Windows.Forms.Button;$button.Text=$choice[1];$button.Tag=$choice[0];$button.Location=New-Object Drawing.Point($choice[2],185);$button.Size=New-Object Drawing.Size(150,40);$button.Add_Click({$script:selected=[string]$this.Tag;$form.Close()});$form.Controls.Add($button)}
 [void]$form.ShowDialog();if(!$script:selected){exit 0};if($script:selected -ne $record.role){throw '所选角色与独立审定记录不符，升级已停止。'}
 $mode='--install';$status=Join-Path $install '.xjy-initial-upgrade\recovery-status.json';$journal=Join-Path $install '.xjy-initial-upgrade\journal.json';if((Test-Path -LiteralPath $journal) -and !(Test-Path -LiteralPath $status)){$mode='--recover'};if(Test-Path -LiteralPath $status){$st=([Text.Encoding]::UTF8.GetString((Bytes $status 8192)))|ConvertFrom-Json;$payload=$st.payload|ConvertFrom-Json;if($payload.phase -in @('prepared','mutating','committed')){$mode='--recover'}}
 $entry=Plain (Join-Path $root 'delivery-tools\initial-patch-entry.cjs')
 $psi=New-Object Diagnostics.ProcessStartInfo;$psi.FileName=$exe;$psi.Arguments='"'+$entry+'" '+$mode;$psi.WorkingDirectory=$install;$psi.UseShellExecute=$false;$psi.CreateNoWindow=$true;$psi.RedirectStandardOutput=$true;$psi.RedirectStandardError=$true;$psi.StandardOutputEncoding=[Text.UTF8Encoding]::new($false);$psi.StandardErrorEncoding=[Text.UTF8Encoding]::new($false);$psi.EnvironmentVariables.Clear()
 foreach($key in @('SystemRoot','WINDIR','TEMP','TMP','LOCALAPPDATA','APPDATA','USERPROFILE')){$value=[Environment]::GetEnvironmentVariable($key,'Process');if($value){$psi.EnvironmentVariables[$key]=$value}}
 $psi.EnvironmentVariables['LOCALAPPDATA']=$local;$psi.EnvironmentVariables['APPDATA']=[Environment]::GetFolderPath([Environment+SpecialFolder]::ApplicationData);$psi.EnvironmentVariables['SystemRoot']=[Environment]::GetFolderPath([Environment+SpecialFolder]::Windows);$psi.EnvironmentVariables['WINDIR']=$psi.EnvironmentVariables['SystemRoot']
 $psi.EnvironmentVariables['ELECTRON_RUN_AS_NODE']='1';$psi.EnvironmentVariables['XJY_INITIAL_APPROVAL_LAUNCH']='1';$psi.EnvironmentVariables['XJY_INITIAL_ROLE']=$script:selected;$psi.EnvironmentVariables['XJY_INITIAL_OS_USER']=$sid
 [XjyInitialPathGuard]::Check($enginePin.SafeFileHandle,$exe,$false);$proc=[Diagnostics.Process]::Start($psi);$outTask=$proc.StandardOutput.ReadToEndAsync();$errTask=$proc.StandardError.ReadToEndAsync();$proc.WaitForExit();$out=$outTask.Result;$err=$errTask.Result;if($proc.ExitCode -ne 0){throw $err};$result=$out.Trim()|ConvertFrom-Json
 if($result.completed){[void][Windows.Forms.MessageBox]::Show('已核验完整升级完成记录，现在可正常打开程序。','已核验')}elseif($result.recovered){[void][Windows.Forms.MessageBox]::Show('已恢复旧程序，资料快照仍保留。请再双击此入口进行完整升级。','已恢复')}elseif($result.installed){[void][Windows.Forms.MessageBox]::Show('完整程序资源已升级。旧程序备份和升级前资料快照已保留。','完成')}else{throw '助手没有确认安装或恢复完成。'}
} catch { [void][Windows.Forms.MessageBox]::Show($_.Exception.Message,'升级未开始或未完成',[Windows.Forms.MessageBoxButtons]::OK,[Windows.Forms.MessageBoxIcon]::Error);exit 1 } finally { for($i=$held.Count-1;$i -ge 0;$i--){$held[$i].Dispose()} }

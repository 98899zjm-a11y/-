# Source for separately approved final delivery. Do not run during development.
# The only write target is the current OS SID's fixed CommonApplicationData approval leaf.
param([switch]$OneClick)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class XjyReviewerPathGuard {
 [StructLayout(LayoutKind.Sequential)] struct Info { public uint attributes; public uint creationLow; public uint creationHigh; public uint accessLow; public uint accessHigh; public uint writeLow; public uint writeHigh; public uint volume; public uint sizeHigh; public uint sizeLow; public uint links; public uint indexHigh; public uint indexLow; }
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle h,out Info info);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern uint GetFinalPathNameByHandle(SafeFileHandle h,StringBuilder value,uint size,uint flags);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern SafeFileHandle CreateFileW(string path,uint access,uint share,IntPtr security,uint creation,uint flags,IntPtr template);
 public static void Check(SafeFileHandle handle,string expected,bool directory) { Info info;if(!GetFileInformationByHandle(handle,out info))throw new IOException("Cannot inspect reviewer handle");if((info.attributes&0x400)!=0||(directory?(info.attributes&0x10)==0:(info.attributes&0x10)!=0||info.links!=1))throw new IOException("Link or unexpected file identity");var text=new StringBuilder(32768);uint n=GetFinalPathNameByHandle(handle,text,32768,0);if(n==0||n>=32768)throw new IOException("Cannot canonicalize reviewer handle");string actual=text.ToString();if(actual.StartsWith(@"\\?\"))actual=actual.Substring(4);if(!String.Equals(Path.GetFullPath(expected),actual,StringComparison.OrdinalIgnoreCase))throw new IOException("Path changed or alias used"); }
 public static SafeFileHandle Directory(string name) { var h=CreateFileW(name,0x80,1,IntPtr.Zero,3,0x02000000,IntPtr.Zero);if(h.IsInvalid)throw new IOException("Cannot pin reviewer directory");try{Check(h,name,true);return h;}catch{h.Dispose();throw;} }
}
'@
$engineSize = 246302720
$engineSha = 'db3ad2066a55546f9b6737da3c7f011370e4856fb36888055b544d45653e4f40'
$held=New-Object 'Collections.Generic.List[IDisposable]'
$pinnedDirs=New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
# These pins come from the separately reviewed conversation delivery, never from
# ZIP metadata, environment variables, a sidecar JSON or editable GUI fields.
function Get-OneClickPreset([string]$ToolRoot){
 if(!$ToolRoot -or ![IO.Path]::IsPathRooted($ToolRoot) -or $ToolRoot.StartsWith('\\')){throw '一键准备工具必须位于普通本机目录。'}
 $parent=[IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($ToolRoot.TrimEnd([char[]]'\/')))
 if(!$parent){throw '一键准备工具必须位于交付目录的独立子目录。'}
 return @{
  zip=[IO.Path]::Combine($parent,'鑫金源珠宝1.6.0完整升级补丁.zip')
  tree=[IO.Path]::Combine($parent,'补丁文件')
  zipHash='8b829f7c46e2e4b45d1553da2a47a876c49b4d7f12c1babfe87c8cc1a7f77bd4'
  keyHash='6e8b9cadb59aeb53f30d41f4471f70f644f0dfc7376ffb9d8a4c62defb98458c'
  publisher='鑫金源珠宝软件'
 }
}
function Assert-OneClickPreset($Preset,$Values){
 $keys=@('zip','tree','zipHash','keyHash','publisher')
 if(!$Preset -or !$Values -or @($Preset.Keys).Count -ne $keys.Count -or @($Values.Keys).Count -ne $keys.Count){throw '一键安装的固定核验参数缺失，已停止。'}
 foreach($key in $keys){if(!$Preset.ContainsKey($key) -or !$Values.Contains($key) -or $Values[$key] -cne $Preset[$key]){throw '一键安装的固定核验参数已变化，已停止。'}}
}
function Get-OneClickWrittenResult($Record,[bool]$Written=$false){
 if(!$Written -or !$Record){throw '审定记录尚未完成写入，不能确认成功。'}
 return [pscustomobject][ordered]@{
  purpose='xjy-oneclick-approval-written';written=$true
  artifactSha256=$Record.artifactSha256;publisherPublicKeySha256=$Record.publisherPublicKeySha256
  installationDir=$Record.installationDir;osUser=$Record.osUser;role=$Record.role
  approvalId=$Record.approvalId;expiresAt=$Record.expiresAt
 }
}
function Plain([string]$Name,[bool]$Directory=$false) {
 if(!$Name -or ![IO.Path]::IsPathRooted($Name) -or $Name.StartsWith('\') -or $Name.Substring(2).Contains(':')) { throw '只能选择普通本机绝对路径。' }
 $parts=$Name.Substring([IO.Path]::GetPathRoot($Name).Length).Split([char[]]'\/')
 foreach($part in $parts){if($part -eq '.' -or $part -eq '..' -or $part -match '[. ]$|[\x00-\x1f]' -or $part -match '^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)'){throw '路径别名或保留名称被拒绝。'}}
 $p=[IO.Path]::GetFullPath($Name);$walk=$p
 while($walk){$item=Get-Item -LiteralPath $walk -Force;if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $item.LinkType){throw '路径不能经过链接或重解析点。'};$parent=[IO.Directory]::GetParent($walk);if(!$parent){break};$walk=$parent.FullName}
 $last=Get-Item -LiteralPath $p -Force;if($Directory -ne [bool]$last.PSIsContainer){throw '文件或目录类型不符。'};return $p
}
function Pin-Parents([string]$Dir){$walk=$Dir;while($walk){if($pinnedDirs.Add($walk)){$held.Add([XjyReviewerPathGuard]::Directory($walk))};$parent=[IO.Directory]::GetParent($walk);if(!$parent){break};$walk=$parent.FullName}}
function Pin-File([string]$Name){$p=Plain $Name;Pin-Parents ([IO.Path]::GetDirectoryName($p));$f=[IO.File]::Open($p,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);try{[XjyReviewerPathGuard]::Check($f.SafeFileHandle,$p,$false);$held.Add($f);return $f}catch{$f.Dispose();throw}}
function Hash-Stream($Stream){$Stream.Position=0;$h=[Security.Cryptography.SHA256]::Create();try{return ([BitConverter]::ToString($h.ComputeHash($Stream))).Replace('-','').ToLowerInvariant()}finally{$h.Dispose();$Stream.Position=0}}
function Stream-Bytes($Stream,[int]$Limit=8192){if($Stream.Length -gt $Limit){throw '元数据过大。'};$Stream.Position=0;$b=New-Object byte[] ([int]$Stream.Length);$n=0;while($n -lt $b.Length){$r=$Stream.Read($b,$n,$b.Length-$n);if(!$r){throw '读取不完整。'};$n+=$r};$Stream.Position=0;return ,$b}
function Pin-Tree([string]$Root,$FilePaths){$allowed=New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal);$dirs=New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal);foreach($relative in $FilePaths){[void]$allowed.Add([string]$relative);$parts=([string]$relative).Split('/');for($n=1;$n -lt $parts.Length;$n++){[void]$dirs.Add(($parts[0..($n-1)] -join '/'))}};$stack=New-Object 'Collections.Generic.Stack[string]';$stack.Push($Root);$count=0;while($stack.Count){$dir=$stack.Pop();Pin-Parents $dir;foreach($item in Get-ChildItem -LiteralPath $dir -Force){$p=Plain $item.FullName ([bool]$item.PSIsContainer);$r=$p.Substring($Root.Length+1).Replace('\','/');if($item.PSIsContainer){if(!$dirs.Contains($r)){throw '解包目录出现额外目录，未进入。'};$stack.Push($p)}else{if(!$allowed.Contains($r)){throw '解包目录出现额外文件，未打开。'};$count++;if($count -gt 8192){throw '补丁文件过多。'};[void](Pin-File $p)}}};if($count -ne $allowed.Count){throw '解包目录缺少已核验文件。'}}
function Overlaps([string]$A,[string]$B){$a=$A.TrimEnd('\')+'\';$b=$B.TrimEnd('\')+'\';return $a.StartsWith($b,[StringComparison]::OrdinalIgnoreCase) -or $b.StartsWith($a,[StringComparison]::OrdinalIgnoreCase)}
function Test-TrustedWindowsRoot([string]$Name,[bool]$Ancestor){return ($Ancestor -and [StringComparer]::OrdinalIgnoreCase.Equals($Name,'C:\'))}
function Assert-AclPolicy([string]$Owner,$Rules,[string]$Sid,[bool]$Ancestor=$false,[bool]$TrustedWindowsRoot=$false){
 $allowed=@($Sid,'S-1-5-18','S-1-5-32-544')
 # The fixed system volume is already canonicalized and pinned by the caller.
 # Its Windows servicing owner is trusted only at this root ancestor, never
 # at an approval directory/file, user directory or arbitrary service SID.
 if($Ancestor -and $TrustedWindowsRoot){$allowed+=@('S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')}
 if($Owner -notin $allowed){throw '审定路径所有者不属于当前用户或允许的受信 Windows 系统身份。'}
 # Parent creation rights alone cannot replace an existing pinned child. In
 # particular, Windows volume-root Users CreateDirectories is allowed here.
 $danger=[Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership
 if(!$Ancestor){$danger=$danger -bor [Security.AccessControl.FileSystemRights]::Write}
 foreach($rule in $Rules){if(!$rule.allow -or ($Ancestor -and $rule.inheritOnly)){continue};if($rule.sid -notin $allowed -and ($rule.rights -band $danger) -ne 0){throw '审定路径允许其他 Windows 身份替换或修改受保护对象，停止；不会修改现有 ACL。'}}
}
function Assert-ApprovalAcl([string]$Name,[string]$Sid,[bool]$Ancestor=$false){
 $acl=Get-Acl -LiteralPath $Name;$owner=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value;$rules=@()
 foreach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){$rules+=@{sid=$rule.IdentityReference.Value;rights=$rule.FileSystemRights;allow=($rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow);inheritOnly=(($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0)}}
 Assert-AclPolicy $owner $rules $Sid $Ancestor (Test-TrustedWindowsRoot $Name $Ancestor)
}
function New-ApprovalAcl([string]$Sid){
 $acl=New-Object Security.AccessControl.DirectorySecurity;$acl.SetAccessRuleProtection($true,$false);$acl.SetOwner((New-Object Security.Principal.SecurityIdentifier($Sid)))
 foreach($who in @($Sid,'S-1-5-18','S-1-5-32-544')){$rule=New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier($who)),[Security.AccessControl.FileSystemRights]::FullControl,([Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit),[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow);$acl.AddAccessRule($rule)};return $acl
}
function Create-ApprovalDirectory([string]$Name,$Acl){[void][IO.Directory]::CreateDirectory($Name,$Acl)}
function Get-FixedApprovalRoot([string]$Common,[string]$Sid){
 if($Sid -cnotmatch '^S-1-\d+(?:-\d+)+$' -or !$Common -or $Common -notmatch '^[A-Za-z]:\\' -or $Common.Substring(2).Contains(':') -or $Common -cne [IO.Path]::GetFullPath($Common)){throw '当前 Windows 公共目录或 SID 不规范，停止。'}
 $suffix=$Common.Substring(3)
 if($suffix){foreach($part in $suffix.Split('\')){if(!$part -or $part -in @('.','..') -or $part -match '[. ]$|[\\/\x00-\x1f"<>|?*]' -or $part -match '^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)'){throw '当前 Windows 公共目录含路径别名，停止。'}}}
 return Join-Path $Common ('鑫金源珠宝初次升级审定-'+$Sid)
}
function Fixed-ApprovalDirectory([string]$Common,[string]$Sid){
 $target=Get-FixedApprovalRoot $Common $Sid
 $parent=Plain $Common $true;$walk=$parent
 while($walk){$checked=Plain $walk $true;Pin-Parents $checked;Assert-ApprovalAcl $checked $Sid $true;$above=[IO.Directory]::GetParent($walk);if(!$above){break};$walk=$above.FullName}
 if(!(Test-Path -LiteralPath $target)){Create-ApprovalDirectory $target (New-ApprovalAcl $Sid)}
 $parent=Plain $target $true;Pin-Parents $parent;Assert-ApprovalAcl $parent $Sid $false
 return $parent
}
function Run-Review([string]$Exe,[string]$Entry,$Request){
 $psi=New-Object Diagnostics.ProcessStartInfo;$psi.FileName=$Exe;$psi.Arguments='"'+$Entry+'" --review';$psi.WorkingDirectory=$PSScriptRoot;$psi.UseShellExecute=$false;$psi.CreateNoWindow=$true;$psi.RedirectStandardInput=$true;$psi.RedirectStandardOutput=$true;$psi.RedirectStandardError=$true;$psi.StandardOutputEncoding=[Text.Encoding]::UTF8;$psi.StandardErrorEncoding=[Text.Encoding]::UTF8;$psi.EnvironmentVariables.Clear()
 foreach($name in @('TEMP','TMP','USERPROFILE')){$v=[Environment]::GetEnvironmentVariable($name,'Process');if($v){$psi.EnvironmentVariables[$name]=$v}}
 $psi.EnvironmentVariables['SystemDrive']='C:';$psi.EnvironmentVariables['PATHEXT']='.EXE'
 $psi.EnvironmentVariables['SystemRoot']=[Environment]::GetFolderPath([Environment+SpecialFolder]::Windows);$psi.EnvironmentVariables['WINDIR']=$psi.EnvironmentVariables['SystemRoot'];$psi.EnvironmentVariables['LOCALAPPDATA']=[Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData);$psi.EnvironmentVariables['APPDATA']=[Environment]::GetFolderPath([Environment+SpecialFolder]::ApplicationData);$psi.EnvironmentVariables['ELECTRON_RUN_AS_NODE']='1';$psi.EnvironmentVariables['XJY_INDEPENDENT_APPROVAL_REVIEW']='1'
 $bytes=([Text.UTF8Encoding]::new($false)).GetBytes(($Request|ConvertTo-Json -Compress -Depth 8));$priorInputEncoding=[Console]::InputEncoding
 try{[Console]::InputEncoding=[Text.UTF8Encoding]::new($false);$p=[Diagnostics.Process]::Start($psi)}finally{[Console]::InputEncoding=$priorInputEncoding}
 try{$outTask=$p.StandardOutput.ReadToEndAsync();$errTask=$p.StandardError.ReadToEndAsync();try{$stdin=$p.StandardInput.BaseStream;$stdin.Write($bytes,0,$bytes.Length);$stdin.Flush()}finally{$p.StandardInput.Close()};$p.WaitForExit();$out=$outTask.Result;$err=$errTask.Result;if($p.ExitCode -ne 0){throw $err};return ($out|ConvertFrom-Json)}finally{$p.Dispose()}
}
function Choose-File($Box,[string]$Filter){$dialog=New-Object Windows.Forms.OpenFileDialog;$dialog.Filter=$Filter;$dialog.CheckFileExists=$true;if($dialog.ShowDialog() -eq [Windows.Forms.DialogResult]::OK){$Box.Text=$dialog.FileName};$dialog.Dispose()}
$approvalWritten=$false;$oneClickReceipt=$null
try{
 $toolRoot=Plain $PSScriptRoot $true;Pin-Parents $toolRoot;foreach($name in @('Prepare-Initial-Approval.ps1','approval-core.cjs','approval-archive.cjs','approval-io.cjs')){[void](Pin-File (Join-Path $toolRoot $name))}
 $form=New-Object Windows.Forms.Form;$form.StartPosition='CenterScreen';$form.FormBorderStyle='FixedDialog';$form.MaximizeBox=$false
 $boxes=@{};$role=New-Object Windows.Forms.ComboBox;$role.DropDownStyle='DropDownList';[void]$role.Items.AddRange(@('请选择这台电脑的明确角色','这是主机','这是员工电脑'));$role.SelectedIndex=0
 $renew=New-Object Windows.Forms.CheckBox
 if($OneClick){
  $preset=Get-OneClickPreset $toolRoot
  $form.Text='鑫金源珠宝一键完整安装';$form.Size=New-Object Drawing.Size(770,355)
  $intro=New-Object Windows.Forms.Label;$intro.Location=New-Object Drawing.Point(20,15);$intro.Size=New-Object Drawing.Size(715,55);$intro.Text='请选择这台电脑现有的软件，并明确选择主机或员工电脑。'+"`n"+'请先保存单据并正常关闭旧软件；核验通过后继续备份和完整升级。';$form.Controls.Add($intro)
  foreach($key in @('zip','tree','zipHash','keyHash','publisher')){$box=New-Object Windows.Forms.TextBox;$box.ReadOnly=$true;$box.Visible=$false;$box.Text=$preset[$key];$boxes[$key]=$box}
  $label=New-Object Windows.Forms.Label;$label.Location=New-Object Drawing.Point(20,80);$label.Size=New-Object Drawing.Size(715,22);$label.Text='现有软件 EXE（安装位置由所选文件确定）';$form.Controls.Add($label)
  $box=New-Object Windows.Forms.TextBox;$box.Location=New-Object Drawing.Point(20,105);$box.Size=New-Object Drawing.Size(605,25);$boxes['exe']=$box;$form.Controls.Add($box)
  $knownExe='F:\自制软件\xjy-jewelry-offline\鑫金源珠宝报价.exe';if(Test-Path -LiteralPath $knownExe -PathType Leaf){$boxes['exe'].Text=$knownExe}
  $browse=New-Object Windows.Forms.Button;$browse.Text='选择软件';$browse.Location=New-Object Drawing.Point(635,102);$browse.Size=New-Object Drawing.Size(100,29);$browse.Add_Click({Choose-File $boxes['exe'] '现有程序|*.exe'});$form.Controls.Add($browse)
  $role.Location=New-Object Drawing.Point(20,150);$role.Size=New-Object Drawing.Size(350,28);$form.Controls.Add($role)
  $notice=New-Object Windows.Forms.Label;$notice.Location=New-Object Drawing.Point(20,195);$notice.Size=New-Object Drawing.Size(715,45);$notice.Text='安装会核验原程序和补丁，保留资料及旧程序备份。'+"`n"+'已有同一补丁的审定记录时，会在最终确认中说明重新审定。';$form.Controls.Add($notice)
  $accept=New-Object Windows.Forms.Button;$accept.Text='开始核验并安装';$accept.Location=New-Object Drawing.Point(185,255);$accept.Size=New-Object Drawing.Size(220,38)
  $cancel=New-Object Windows.Forms.Button;$cancel.Text='取消';$cancel.Location=New-Object Drawing.Point(425,255);$cancel.Size=New-Object Drawing.Size(130,38);$cancel.Add_Click({$form.Close()});$form.Controls.Add($cancel);$form.CancelButton=$cancel
 }else{
  $form.Text='负责人：首次完整升级独立审定';$form.Size=New-Object Drawing.Size(810,610)
  $intro=New-Object Windows.Forms.Label;$intro.Location=New-Object Drawing.Point(20,15);$intro.Size=New-Object Drawing.Size(760,55);$intro.Text='在实际使用者的 Windows 账号下办理。工具须由独立渠道取得并核验自身摘要。'+"`n"+'从本对话独立取得 ZIP SHA256 与公钥指纹；不要从补丁包内复制这两个值。';$form.Controls.Add($intro)
  $specs=@(@('zip','最终 ZIP 文件',80),@('tree','完整解包文件夹',125),@('exe','现有软件 EXE（选择后自动确定安装位置）',170),@('zipHash','本对话独立提供的 ZIP SHA256',215),@('keyHash','本对话独立提供的公钥 SPKI DER SHA256',260),@('publisher','独立核实的发布者名称',305))
  foreach($s in $specs){$label=New-Object Windows.Forms.Label;$label.Location=New-Object Drawing.Point(20,$s[2]);$label.Size=New-Object Drawing.Size(760,18);$label.Text=$s[1];$form.Controls.Add($label);$box=New-Object Windows.Forms.TextBox;$box.Location=New-Object Drawing.Point(20,($s[2]+18));$box.Size=New-Object Drawing.Size(660,24);$form.Controls.Add($box);$boxes[$s[0]]=$box}
  foreach($s in @(@('zip',98,'ZIP 文件|*.zip'),@('exe',188,'现有程序|*.exe'))){$b=New-Object Windows.Forms.Button;$b.Text='选择';$b.Location=New-Object Drawing.Point(690,$s[1]);$b.Size=New-Object Drawing.Size(80,25);$b.Tag=@($boxes[$s[0]],$s[2]);$b.Add_Click({Choose-File $this.Tag[0] $this.Tag[1]});$form.Controls.Add($b)}
  $browse=New-Object Windows.Forms.Button;$browse.Text='选择';$browse.Location=New-Object Drawing.Point(690,143);$browse.Size=New-Object Drawing.Size(80,25);$browse.Add_Click({$d=New-Object Windows.Forms.FolderBrowserDialog;if($d.ShowDialog() -eq [Windows.Forms.DialogResult]::OK){$boxes['tree'].Text=$d.SelectedPath};$d.Dispose()});$form.Controls.Add($browse)
  $role.Location=New-Object Drawing.Point(20,365);$role.Size=New-Object Drawing.Size(310,28);$form.Controls.Add($role)
  $renew.Location=New-Object Drawing.Point(20,405);$renew.Size=New-Object Drawing.Size(750,40);$renew.Text='重新审定原补丁（已有记录／过期时）：再次授权恢复及随后重新安装；并非仅恢复';$form.Controls.Add($renew)
  $notice=New-Object Windows.Forms.Label;$notice.Location=New-Object Drawing.Point(20,450);$notice.Size=New-Object Drawing.Size(750,50);$notice.Text='此工具只写包外审定记录，不安装补丁、不启动业务、不打开三库。正式安装必须已获得单独批准。'+"`n"+'重新审定保留原审批编号和全部绑定；换包、换用户、换安装位置或换角色必须停止处理。';$form.Controls.Add($notice)
  $accept=New-Object Windows.Forms.Button;$accept.Text='核验并查看最终审定';$accept.Location=New-Object Drawing.Point(260,515);$accept.Size=New-Object Drawing.Size(260,38)
 }
 $script:accepted=$false;$accept.Add_Click({$script:accepted=$true;$form.Close()});$form.Controls.Add($accept);[void]$form.ShowDialog();if(!$script:accepted){if($OneClick){exit 2};exit 0};if($role.SelectedIndex -lt 1){throw '请明确选择主机或员工角色。'}
 if($OneClick){$presetValues=@{};foreach($key in @('zip','tree','zipHash','keyHash','publisher')){$presetValues[$key]=$boxes[$key].Text};Assert-OneClickPreset $preset $presetValues}
 $zip=Plain $boxes['zip'].Text;$tree=Plain $boxes['tree'].Text $true;$exe=Plain $boxes['exe'].Text;$install=Plain ([IO.Path]::GetDirectoryName($exe)) $true
 if((Overlaps $tree $toolRoot) -or (Overlaps $tree $install) -or (Overlaps $toolRoot $install)){throw '独立工具、解包补丁和现有安装必须位于互不包含的目录。'}
 $zipHash=$boxes['zipHash'].Text.Trim().ToLowerInvariant();$keyHash=$boxes['keyHash'].Text.Trim().ToLowerInvariant();if($zipHash -notmatch '^[a-f0-9]{64}$' -or $keyHash -notmatch '^[a-f0-9]{64}$'){throw '两个独立 SHA256 均须为 64 位十六进制。'}
 $enginePin=Pin-File $exe;if($enginePin.Length -ne $engineSize -or (Hash-Stream $enginePin) -ne $engineSha){throw '现有 EXE 与独立固定引擎摘要不符，不执行任何程序。'}
 $zipPin=Pin-File $zip;if((Hash-Stream $zipPin) -ne $zipHash){throw 'ZIP 与本对话独立提供的摘要不符。'}
 $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;$common=[Environment]::GetFolderPath([Environment+SpecialFolder]::CommonApplicationData);$approvalRoot=Get-FixedApprovalRoot $common $sid;$approvalFile=Join-Path $approvalRoot 'initial-upgrade-approval.json';$priorPin=$null;$priorBytes=$null
 if(Test-Path -LiteralPath $approvalFile){Assert-ApprovalAcl $approvalFile $sid;$priorPin=Pin-File $approvalFile;$priorBytes=Stream-Bytes $priorPin}
 if($OneClick){$renew.Checked=[bool]$priorPin}
 if($renew.Checked -and !$priorPin){throw '重新审定必须保留原包外审定记录。'};if(!$renew.Checked -and $priorPin){throw '已有审定记录，不能按首次审定覆盖。'}
 if(!$renew.Checked){[void](Pin-File (Join-Path $install 'resources\app.asar'))}
 $request=@{operation=$(if($renew.Checked){'reapprove-original'}else{'initial'});archiveFile=$zip;artifactDir=$tree;executablePath=$exe;osUser=$sid;role=$(if($role.SelectedIndex -eq 1){'host'}else{'employee'});expectedArtifactSha256=$zipHash;expectedPublisherPublicKeySha256=$keyHash;verifiedPublisherName=$boxes['publisher'].Text.Trim();previousApprovalBase64=$(if($priorBytes){[Convert]::ToBase64String($priorBytes)}else{$null})}
 $entry=Join-Path $toolRoot 'approval-io.cjs';[XjyReviewerPathGuard]::Check($enginePin.SafeFileHandle,$exe,$false);$result=Run-Review $exe $entry $request;Pin-Tree $tree $result.filePaths
 $nextStep='确认后写入固定包外记录；它不会安装程序。';if($OneClick){$nextStep='确认后写入审定记录，并继续备份和完整升级。安装器还会核对角色。'}
 $summary=$result.confirmation+"`n`n"+'发布者：'+$result.record.verifiedPublisherName+"`n"+'安装位置：'+$result.record.installationDir+"`n"+'Windows SID：'+$result.record.osUser+"`n"+'角色：'+$role.Text+"`n"+'版本：'+$result.targetVersion+"`n"+'审定有效期：'+$result.record.expiresAt+"`n`n"+$nextStep
 if($result.catalogExpired){$summary+="`n资源清单已过期：此次审定仅使原事务可进入恢复；新安装仍会被资源清单有效期阻止。"}
 if([Windows.Forms.MessageBox]::Show($summary,'负责人最终确认',[Windows.Forms.MessageBoxButtons]::YesNo,[Windows.Forms.MessageBoxIcon]::Warning) -ne [Windows.Forms.DialogResult]::Yes){if($OneClick){exit 2};exit 0}
 # Recheck every signature/hash immediately before the fixed write, with all inputs pinned.
 [XjyReviewerPathGuard]::Check($enginePin.SafeFileHandle,$exe,$false);$second=Run-Review $exe $entry $request;foreach($key in @('artifactSha256','treeSha256','publisherPublicKeySha256','sourcePolicySha256','installationDir','osUser','role')){if($result.record.$key -ne $second.record.$key){throw '确认期间绑定变化，未写入。'}}
 $approvalRoot=Fixed-ApprovalDirectory $common $sid;$approvalFile=Join-Path $approvalRoot 'initial-upgrade-approval.json';$bytes=(New-Object Text.UTF8Encoding($false)).GetBytes(($result.record|ConvertTo-Json -Compress -Depth 8))
 if($priorPin){
  # Reopen exclusively, verify original bytes through that exact handle, then write.
  # A crash fails closed as invalid JSON; no automatic recovery or fresh approval follows.
  $priorPin.Dispose();$f=[IO.File]::Open($approvalFile,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
  try{[XjyReviewerPathGuard]::Check($f.SafeFileHandle,$approvalFile,$false);$current=Stream-Bytes $f;if([Convert]::ToBase64String($current) -ne [Convert]::ToBase64String($priorBytes)){throw '原审定记录已变化，拒绝覆盖。'};$f.Position=0;$f.Write($bytes,0,$bytes.Length);$f.SetLength($bytes.Length);$f.Flush($true);[XjyReviewerPathGuard]::Check($f.SafeFileHandle,$approvalFile,$false)}finally{$f.Dispose()}
 }else{
  $f=[IO.File]::Open($approvalFile,[IO.FileMode]::CreateNew,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None);try{[XjyReviewerPathGuard]::Check($f.SafeFileHandle,$approvalFile,$false);$f.Write($bytes,0,$bytes.Length);$f.Flush($true)}finally{$f.Dispose()}
 }
 $approvalWritten=$true
 if($OneClick){$oneClickReceipt=Get-OneClickWrittenResult $result.record $approvalWritten}else{[void][Windows.Forms.MessageBox]::Show('包外审定记录已写入。审批编号：'+$result.record.approvalId+"`n"+'下一步由已获单独安装批准的使用者运行补丁根目录“一键完整升级.cmd”。过期后须重新完整审定。','审定完成')}
}catch{[void][Windows.Forms.MessageBox]::Show($_.Exception.Message,'审定未完成',[Windows.Forms.MessageBoxButtons]::OK,[Windows.Forms.MessageBoxIcon]::Error);exit 1}finally{for($idx=$held.Count-1;$idx -ge 0;$idx--){$held[$idx].Dispose()}}
if($OneClick){$oneClickReceipt|ConvertTo-Json -Compress;exit 0}

param([string]$Mode='', [string]$SourceSha256='', [string]$BindingStateSha256='')
$ErrorActionPreference='Stop'
# This must precede every source/context/target/result filesystem access.
$earlyIdentity=[Security.Principal.WindowsIdentity]::GetCurrent()
if($earlyIdentity.Name -notmatch '^[^\\]+\\WDAGUtilityAccount$'){
 [Console]::Error.WriteLine('NATIVE162_PROBE_REFUSED:ACTUAL_WDAG_REQUIRED');exit 37
}
Set-StrictMode -Version Latest
$ExpectedContextSha256='0df120703e71a1fcf03d24f598a2c9e875190e00f964f22bfee4b3751e2ae8b7'
$ExpectedNamespace='fb483e74-1d05-4fe7-a6d9-85660ead2344'
$ExpectedLabel='XJY162_FB483E74'
$SourceFile='C:\xjy-input\native-installed-162-a1\native162-vhd-probe.ps1'
$ContextFile='C:\xjy-input\native-installed-162-a1\bound-context.json'
$GuestRoot='C:\xjy-native-acceptance-a1'
$VhdFile='C:\xjy-native-acceptance-a1\host162.vhdx'
$StateFile='C:\xjy-native-acceptance-a1\vhd-binding-a1.json'
$OwnerFile='F:\.xjy-native162-volume-owner.json'
$ResultsRoot='C:\xjy-results'
$MaximumBytes=[uint64]536870912
$DiskPart='C:\Windows\System32\diskpart.exe'
$WindowsPowerShell='C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
$OriginalPathGuardSha256='4b51ba8e7300e0ce8875dcb2a3b060622d84f81459b8cc758d16c4f94eb3f8d7'
$held=New-Object 'Collections.Generic.List[IDisposable]'
$pinnedDirs=New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
$nativeRecords=New-Object 'Collections.Generic.List[object]'
$storageRecords=New-Object 'Collections.Generic.List[object]'
$script:CanWriteResult=$false
$script:MutationAttempted=$false
$script:Stage='arguments'
$resultFile=$null
$guestProof=$null
$context=$null
$exitStatus=1

function Need([bool]$Condition,[string]$Code){if(!$Condition){throw $Code}}
function Sha([byte[]]$Bytes){$h=[Security.Cryptography.SHA256]::Create();try{return ([BitConverter]::ToString($h.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant()}finally{$h.Dispose()}}
function Json([object]$Value){return ConvertTo-Json -InputObject $Value -Depth 20 -Compress}
function Same([string]$A,[string]$B){return [string]::Equals($A,$B,[StringComparison]::OrdinalIgnoreCase)}
function ExactKeys([object]$Value,[string[]]$Keys){if($null -eq $Value){return $false};$names=@($Value.PSObject.Properties.Name);if($names.Count -ne $Keys.Count){return $false};foreach($name in $names){if($name -cnotin $Keys){return $false}};return $true}
function Assert-ActualGuest {
 $who=[Security.Principal.WindowsIdentity]::GetCurrent()
 Need ($who.Name -match '^[^\\]+\\WDAGUtilityAccount$') 'ACTUAL_WDAG_REQUIRED'
 Need ($who.User.Value -match '^S-1-\d+(?:-\d+)+$') 'ACTUAL_SID_REQUIRED'
 Need (Same ([Environment]::GetFolderPath([Environment+SpecialFolder]::Windows)) 'C:\Windows') 'FIXED_WINDOWS_REQUIRED'
 Need ($PSVersionTable.PSVersion.Major -eq 5 -and $PSVersionTable.PSVersion.Minor -eq 1 -and [Environment]::Is64BitProcess -and (Same ([Diagnostics.Process]::GetCurrentProcess().MainModule.FileName) $WindowsPowerShell)) 'FIXED_NATIVE_POWERSHELL51_REQUIRED'
 Need (Same ([Environment]::MachineName) ($who.Name.Split('\')[0])) 'ACTUAL_MACHINE_NAME_REQUIRED'
 $env:PSModulePath='C:\Windows\System32\WindowsPowerShell\v1.0\Modules'
 $computer=CimCmdlets\Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction Stop
 Need ($computer.Model -ceq 'Virtual Machine') 'ACTUAL_VIRTUAL_MACHINE_REQUIRED'
 $addresses=@(NetTCPIP\Get-NetIPAddress -ErrorAction Stop | Where-Object {$_.IPAddress -notlike '127.*' -and $_.IPAddress -ne '::1'})
 Need ($addresses.Count -eq 0) 'OFFLINE_GUEST_REQUIRED'
 $principal=New-Object Security.Principal.WindowsPrincipal($who)
 Need ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) 'GUEST_ADMIN_TOKEN_REQUIRED'
 return [ordered]@{userName=$who.Name;sid=$who.User.Value;computerName=[Environment]::MachineName;model=[string]$computer.Model;nonLoopbackAddressCount=$addresses.Count;windows='C:\Windows'}
}

# Complete original data-free native path guard text; source SHA above.
function Install-PathGuard {
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
 Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Runtime.InteropServices;
public static class XjyNative162Volume {
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateDirectoryW(string p,IntPtr s);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern uint QueryDosDeviceW(string p,StringBuilder b,uint n);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool GetVolumeNameForVolumeMountPointW(string p,StringBuilder b,uint n);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool GetVolumeInformationW(string p,StringBuilder label,uint ln,out uint serial,out uint maximum,out uint flags,StringBuilder fs,uint fn);
 public static void NewDirectory(string p){if(!CreateDirectoryW(p,IntPtr.Zero))throw new IOException("CreateNew directory refused: "+Marshal.GetLastWin32Error());}
 public static string DosTarget(string p){var b=new StringBuilder(32768);if(QueryDosDeviceW(p,b,32768)==0){int e=Marshal.GetLastWin32Error();if(e==2)return null;throw new IOException("Cannot inspect DOS device: "+e);}return b.ToString();}
 public static string[] Volume(){var g=new StringBuilder(32768);if(!GetVolumeNameForVolumeMountPointW(@"F:\",g,32768))throw new IOException("Cannot inspect F volume GUID");var l=new StringBuilder(256);var f=new StringBuilder(256);uint s,m,a;if(!GetVolumeInformationW(g.ToString(),l,256,out s,out m,out a,f,256))throw new IOException("Cannot inspect F native volume identity");return new string[]{g.ToString(),s.ToString("x8"),l.ToString(),f.ToString(),DosTarget("F:")};}
}
'@
}
function Pin-PlainFile([string]$Name){$f=[IO.File]::Open($Name,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);try{[XjyInitialPathGuard]::Check($f.SafeFileHandle,$Name,$false);return $f}catch{$f.Dispose();throw}}
function Pin-PlainDirectory([string]$Name){return [XjyInitialPathGuard]::Directory($Name)}
function Assert-PlainPath([string]$Name,[bool]$Directory=$false,[bool]$Missing=$false){
 Need ($Name -match '^[A-Za-z]:\\' -and !$Name.Substring(2).Contains(':') -and !$Name.StartsWith('\\')) 'ORDINARY_ABSOLUTE_PATH_REQUIRED'
 Need (Same ([IO.Path]::GetFullPath($Name)) $Name) 'PATH_ALIAS_REFUSED'
 if($Name.Length -gt 3){foreach($part in $Name.Substring(3).Split('\')){Need ($part -and $part -notin @('.','..') -and $part -notmatch '[. ]$|[\x00-\x1f"<>|?*]' -and $part -notmatch '^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)') 'PATH_COMPONENT_REFUSED'}}
 $walk=$Name
 while($walk){
  $exists=[IO.Directory]::Exists($walk) -or [IO.File]::Exists($walk)
  if(!$exists){Need ($Missing -and (Same $walk $Name)) 'PATH_MISSING'}else{
   $item=Microsoft.PowerShell.Management\Get-Item -LiteralPath $walk -Force -ErrorAction Stop
   Need (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0 -and !$item.LinkType) 'PATH_LINK_REFUSED'
   if(!(Same $walk $Name) -or $Directory){Need $item.PSIsContainer 'PATH_DIRECTORY_REQUIRED';$p=Pin-PlainDirectory $walk}else{Need (!$item.PSIsContainer) 'PATH_FILE_REQUIRED';$p=Pin-PlainFile $walk};$p.Dispose()
  }
  $parent=[IO.Directory]::GetParent($walk);if(!$parent){break};$walk=$parent.FullName
 }
}
function Pin-Parents([string]$Directory){$walk=$Directory;while($walk){if($pinnedDirs.Add($walk)){[void]$held.Add((Pin-PlainDirectory $walk))};$parent=[IO.Directory]::GetParent($walk);if(!$parent){break};$walk=$parent.FullName}}
function Read-Bytes([string]$File,[int]$Limit=1048576,[string]$Pin='',[bool]$KeepPin=$true){
 Assert-PlainPath $File;$f=Pin-PlainFile $File;if($KeepPin){[void]$held.Add($f)}
 try{
  Need ($f.Length -le $Limit) 'BOUNDED_INPUT_REQUIRED';$b=New-Object byte[] ([int]$f.Length);$at=0
  while($at -lt $b.Length){$n=$f.Read($b,$at,$b.Length-$at);Need ($n -gt 0) 'INCOMPLETE_INPUT';$at+=$n};[XjyInitialPathGuard]::Check($f.SafeFileHandle,$File,$false)
  if($Pin){Need ((Sha $b) -ceq $Pin) 'PINNED_INPUT_CHANGED'};return ,$b
 }finally{if(!$KeepPin){$f.Dispose()}}
}
function Read-Json([string]$File,[string]$Pin='',[bool]$KeepPin=$true){return ([Text.UTF8Encoding]::new($false,$true).GetString((Read-Bytes $File 1048576 $Pin $KeepPin)) | ConvertFrom-Json)}
function Write-NewJson([string]$File,[object]$Value){
 Assert-PlainPath ([IO.Path]::GetDirectoryName($File)) $true;Assert-PlainPath $File $false $true
 $raw=[Text.UTF8Encoding]::new($false).GetBytes((Json $Value)+"`n");$f=[IO.File]::Open($File,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try{$f.Write($raw,0,$raw.Length);$f.Flush($true);[XjyInitialPathGuard]::Check($f.SafeFileHandle,$File,$false)}finally{$f.Dispose()};return Sha $raw
}
function Assert-Context([object]$Proof){
 Need (ExactKeys $context @('schemaVersion','purpose','synthetic','namespace','volumeLabel','expectedUserName','expectedSid','expectedComputerName','createdAt','expiresAt')) 'EXACT_BOUND_CONTEXT_REQUIRED'
 Need ($context.schemaVersion -eq 1 -and $context.purpose -ceq 'native162-vhd-capability-probe' -and $context.synthetic -is [bool] -and $context.synthetic) 'BOUND_CONTEXT_PURPOSE_REQUIRED'
 Need ($context.namespace -ceq $ExpectedNamespace -and $context.volumeLabel -ceq $ExpectedLabel) 'EXACT_NAMESPACE_LABEL_REQUIRED'
 Need ($context.expectedUserName -ceq $Proof.userName -and $context.expectedSid -ceq $Proof.sid -and $context.expectedComputerName -ceq $Proof.computerName) 'BOUND_GUEST_IDENTITY_REQUIRED'
 Need ($context.createdAt -match 'Z$' -and $context.expiresAt -match 'Z$') 'UTC_CONTEXT_REQUIRED'
 $created=[DateTimeOffset]::Parse($context.createdAt,[Globalization.CultureInfo]::InvariantCulture);$expires=[DateTimeOffset]::Parse($context.expiresAt,[Globalization.CultureInfo]::InvariantCulture);$now=[DateTimeOffset]::UtcNow
 Need ($created -le $now.AddMinutes(5) -and $expires -gt $now -and $expires -gt $created -and ($expires-$created).TotalHours -le 8.01) 'CONTEXT_TIME_INVALID'
}
function Fresh-Guest {$p=Assert-ActualGuest;Assert-Context $p;return $p}
function Assert-NoF {Need ([string]::IsNullOrEmpty([XjyNative162Volume]::DosTarget('F:')) -and ![IO.Directory]::Exists('F:\') -and ![IO.File]::Exists('F:\')) 'INITIAL_NO_F_REQUIRED'}
function Assert-CFreeSpace {
 $drive=[IO.DriveInfo]::new('C:\');Need ($drive.IsReady -and (Same $drive.Name 'C:\')) 'ACTUAL_C_DRIVE_REQUIRED'
 $available=[uint64]$drive.AvailableFreeSpace;Need ($available -ge [uint64]2147483648) 'C_FREE_SPACE_BELOW_2GIB'
 return [ordered]@{drive='C:\';availableBytes=$available;minimumRequiredBytes=[uint64]2147483648}
}
function Partition-Row([object]$P){return [ordered]@{number=[uint32]$P.PartitionNumber;offset=[uint64]$P.Offset;size=[uint64]$P.Size;type=[string]$P.Type;mbrType=[uint16]$P.MbrType;gptType=[string]$P.GptType;driveLetter=[string]$P.DriveLetter;isBoot=[bool]$P.IsBoot;isSystem=[bool]$P.IsSystem;isActive=[bool]$P.IsActive;isReadOnly=[bool]$P.IsReadOnly}}
function Disk-Row([object]$D,[object[]]$AllPartitions){
 $layout=@($AllPartitions | Where-Object {$_.DiskNumber -eq $D.Number} | Sort-Object PartitionNumber | ForEach-Object {Partition-Row $_})
 return [ordered]@{number=[uint32]$D.Number;uniqueId=[string]$D.UniqueId;path=[string]$D.Path;size=[uint64]$D.Size;partitionStyle=[string]$D.PartitionStyle;isBoot=[bool]$D.IsBoot;isSystem=[bool]$D.IsSystem;partitions=$layout}
}
function All-Disks {$allPartitions=@(Storage\Get-Partition -ErrorAction Stop);return @(Storage\Get-Disk -ErrorAction Stop | Sort-Object Number | ForEach-Object {Disk-Row $_ $allPartitions})}
function Assert-Baseline([object[]]$Baseline,[string]$AdditionalId=''){
 $all=@(All-Disks);$expected=$Baseline.Count;if($AdditionalId){$expected++};Need ($all.Count -eq $expected) 'UNEXPECTED_DISK_SET'
 foreach($old in $Baseline){$current=@($all | Where-Object {$_.uniqueId -ceq $old.uniqueId});Need ($current.Count -eq 1 -and (Json $current[0]) -ceq (Json $old)) 'BASELINE_DISK_CHANGED'}
 if($AdditionalId){Need (@($all | Where-Object {$_.uniqueId -ceq $AdditionalId}).Count -eq 1 -and @($Baseline | Where-Object {$_.uniqueId -ceq $AdditionalId}).Count -eq 0) 'NEW_DISK_ID_REQUIRED'}
 return ,$all
}
function Assert-Receipt([object]$R,[string]$ReceiptMode){Need ($R.passed -eq $true -and $R.mode -ceq $ReceiptMode -and $R.namespace -ceq $ExpectedNamespace -and $R.contextSha256 -ceq $ExpectedContextSha256 -and $R.sourceSha256 -ceq $SourceSha256 -and $R.guest.sid -ceq $guestProof.sid -and $R.guest.computerName -ceq $guestProof.computerName) 'MATCHING_SUCCESS_RECEIPT_REQUIRED'}
function Pin-Vhd {
 # A mounted image has a native writer; ordinary context files remain read-share
 # only, while this one fixed image must allow that writer but deny replacement.
 Assert-PlainPath ([IO.Path]::GetDirectoryName($VhdFile)) $true;Need ([IO.File]::Exists($VhdFile)) 'EXISTING_VHD_FILE_REQUIRED'
 $a=[IO.File]::GetAttributes($VhdFile);Need (($a -band ([IO.FileAttributes]::ReparsePoint -bor [IO.FileAttributes]::Compressed -bor [IO.FileAttributes]::Encrypted)) -eq 0) 'UNCOMPRESSED_UNENCRYPTED_ORDINARY_VHD_REQUIRED'
 $f=[IO.File]::Open($VhdFile,[IO.FileMode]::Open,[IO.FileAccess]::Read,([IO.FileShare]::ReadWrite));try{[XjyInitialPathGuard]::Check($f.SafeFileHandle,$VhdFile,$false);Need ($f.Length -gt 0 -and $f.Length -le ($MaximumBytes+33554432)) 'BOUNDED_VHD_FILE_REQUIRED';[void]$held.Add($f);return $f}catch{$f.Dispose();throw}
}
function Hash-Vhd([IO.FileStream]$File){$File.Position=0;$h=[Security.Cryptography.SHA256]::Create();try{$hash=([BitConverter]::ToString($h.ComputeHash($File))).Replace('-','').ToLowerInvariant();[XjyInitialPathGuard]::Check($File.SafeFileHandle,$VhdFile,$false);return $hash}finally{$h.Dispose()}}
function Image-Disk {
 $images=@(Storage\Get-DiskImage -ImagePath $VhdFile -ErrorAction Stop);Need ($images.Count -eq 1 -and (Same ([string]$images[0].ImagePath) $VhdFile) -and $images[0].Attached) 'EXACT_ATTACHED_IMAGE_REQUIRED'
 $disks=@($images[0] | Storage\Get-Disk -ErrorAction Stop);Need ($disks.Count -eq 1) 'ONE_IMAGE_DISK_REQUIRED';$d=$disks[0]
 Need (![string]::IsNullOrWhiteSpace([string]$d.UniqueId) -and !$d.IsBoot -and !$d.IsSystem -and [uint64]$d.Size -eq $MaximumBytes) 'NON_SYSTEM_EXACT_SIZE_DISK_REQUIRED'
 return $d
}
function Disk-Identity([object]$D){return [ordered]@{number=[uint32]$D.Number;uniqueId=[string]$D.UniqueId;path=[string]$D.Path;size=[uint64]$D.Size;isBoot=[bool]$D.IsBoot;isSystem=[bool]$D.IsSystem}}
function Assert-ExactImageDisk([object[]]$Baseline,[object]$Expected){
 $disk=Image-Disk;[void](Assert-Baseline $Baseline ([string]$disk.UniqueId))
 Need ((Json (Disk-Identity $disk)) -ceq (Json $Expected)) 'EXACT_IMAGE_DISK_IDENTITY_CHANGED'
 return $disk
}
function Partition-Identity([object]$P){return [ordered]@{diskNumber=[uint32]$P.DiskNumber;partitionNumber=[uint32]$P.PartitionNumber;offset=[uint64]$P.Offset;size=[uint64]$P.Size;driveLetter=[string]$P.DriveLetter;objectId=[string]$P.ObjectId}}
function Assert-ExactNewPartition([object]$Disk,[object]$Expected){
 $partitions=@($Disk | Storage\Get-Partition -ErrorAction Stop);Need ($partitions.Count -eq 1) 'ONE_NEW_PARTITION_BEFORE_FORMAT_REQUIRED'
 $reverse=@(Storage\Get-Partition -DriveLetter F -ErrorAction Stop);Need ($reverse.Count -eq 1) 'ONE_REVERSE_F_PARTITION_BEFORE_FORMAT_REQUIRED'
 $partition=$partitions[0];Need ((Json (Partition-Identity $partition)) -ceq (Json $Expected) -and (Json (Partition-Identity $reverse[0])) -ceq (Json $Expected)) 'EXACT_RETURNED_PARTITION_CHANGED'
 Need ($partition.DiskNumber -eq $Disk.Number -and $partition.DriveLetter -ceq 'F') 'EXACT_PARTITION_DISK_AND_F_REQUIRED'
 $reverseDisk=@($reverse[0] | Storage\Get-Disk -ErrorAction Stop);Need ($reverseDisk.Count -eq 1 -and (Json (Disk-Identity $reverseDisk[0])) -ceq (Json (Disk-Identity $Disk))) 'REVERSE_NEW_PARTITION_DISK_MISMATCH'
 return $partition
}
function Initialize-ExactImagePartition([object[]]$Baseline,[object]$ExpectedDisk){
 # Root ruling: no DiskPart partition focus is inferred. All three writes use
 # freshly proved, exact image-associated CIM objects, never a disk index.
 [void](Fresh-Guest);$disk=Assert-ExactImageDisk $Baseline $ExpectedDisk
 $before=@(Storage\Get-Partition -ErrorAction Stop | Where-Object {$_.DiskNumber -eq $disk.Number})
 Need ($before.Count -eq 0 -and [string]$disk.PartitionStyle -ceq 'RAW') 'EXACT_RAW_IMAGE_BEFORE_INITIALIZE_REQUIRED'
 $script:Stage='initialize-exact-image-cim';$record=[ordered]@{operation='Initialize-Disk';imagePath=$VhdFile;startedAt=[DateTime]::UtcNow.ToString('o');target=(Disk-Identity $disk);status='attempted';returnedIdentity=$null;error=''};[void]$storageRecords.Add($record);$script:MutationAttempted=$true
 try{
  $returned=@(Storage\Initialize-Disk -InputObject $disk -PartitionStyle MBR -PassThru -Confirm:$false -ErrorAction Stop)
  Need ($returned.Count -eq 1) 'ONE_INITIALIZED_CIM_DISK_REQUIRED';$record.returnedIdentity=Disk-Identity $returned[0];Need ((Json $record.returnedIdentity) -ceq (Json $ExpectedDisk)) 'INITIALIZE_RETURNED_WRONG_DISK';$record.status='returned'
 }catch{$record.status='failed';$record.error=$_.Exception.Message;throw}
 $disk=Assert-ExactImageDisk $Baseline $ExpectedDisk;$before=@(Storage\Get-Partition -ErrorAction Stop | Where-Object {$_.DiskNumber -eq $disk.Number})
 Need ($before.Count -eq 0 -and [string]$disk.PartitionStyle -ceq 'MBR') 'EXACT_EMPTY_MBR_IMAGE_AFTER_INITIALIZE_REQUIRED'

 [void](Fresh-Guest);Assert-NoF;$disk=Assert-ExactImageDisk $Baseline $ExpectedDisk
 $before=@(Storage\Get-Partition -ErrorAction Stop | Where-Object {$_.DiskNumber -eq $disk.Number});Need ($before.Count -eq 0 -and [string]$disk.PartitionStyle -ceq 'MBR') 'EXACT_EMPTY_MBR_IMAGE_BEFORE_PARTITION_REQUIRED'
 $script:Stage='new-partition-exact-image-cim';$record=[ordered]@{operation='New-Partition';imagePath=$VhdFile;startedAt=[DateTime]::UtcNow.ToString('o');target=(Disk-Identity $disk);status='attempted';returnedIdentity=$null;error=''};[void]$storageRecords.Add($record)
 try{
  $returned=@(Storage\New-Partition -InputObject $disk -UseMaximumSize -DriveLetter F -ErrorAction Stop)
  Need ($returned.Count -eq 1) 'ONE_RETURNED_NEW_PARTITION_REQUIRED';$createdPartition=$returned[0];$partitionIdentity=Partition-Identity $createdPartition;Need (![string]::IsNullOrWhiteSpace($partitionIdentity.objectId)) 'NATIVE_PARTITION_OBJECT_ID_REQUIRED';$record.returnedIdentity=$partitionIdentity;$record.status='returned'
 }catch{$record.status='failed';$record.error=$_.Exception.Message;throw}
 $disk=Assert-ExactImageDisk $Baseline $ExpectedDisk;[void](Assert-ExactNewPartition $disk $partitionIdentity)

 [void](Fresh-Guest);$disk=Assert-ExactImageDisk $Baseline $ExpectedDisk;$currentPartition=Assert-ExactNewPartition $disk $partitionIdentity
 Need ([uint64]$currentPartition.Offset -ge 1048576 -and [uint64]$currentPartition.Size -ge 503316480 -and ([uint64]$currentPartition.Offset+[uint64]$currentPartition.Size) -le $MaximumBytes) 'NEW_PARTITION_BOUNDS_BEFORE_FORMAT_REQUIRED'
 $volumes=@($currentPartition | Storage\Get-Volume -ErrorAction Stop);Need ($volumes.Count -eq 1 -and [string]$volumes[0].FileSystem -cin @('','RAW')) 'NEW_UNFORMATTED_VOLUME_REQUIRED'
 $backImages=@(Storage\Get-DiskImage -Volume $volumes[0] -ErrorAction Stop);Need ($backImages.Count -eq 1 -and $backImages[0].Attached -and (Same ([string]$backImages[0].ImagePath) $VhdFile)) 'NEW_PARTITION_REVERSE_IMAGE_BEFORE_FORMAT_REQUIRED'
 $script:Stage='format-returned-partition-cim';$record=[ordered]@{operation='Format-Volume';imagePath=$VhdFile;startedAt=[DateTime]::UtcNow.ToString('o');target=$partitionIdentity;status='attempted';returnedIdentity=$null;error=''};[void]$storageRecords.Add($record)
 try{
  $returned=@(Storage\Format-Volume -Partition $createdPartition -FileSystem NTFS -NewFileSystemLabel $ExpectedLabel -Confirm:$false -ErrorAction Stop)
  Need ($returned.Count -eq 1) 'ONE_FORMATTED_RETURN_VOLUME_REQUIRED';$record.returnedIdentity=[ordered]@{driveLetter=[string]$returned[0].DriveLetter;uniqueId=[string]$returned[0].UniqueId;fileSystem=[string]$returned[0].FileSystem;volumeLabel=[string]$returned[0].FileSystemLabel;size=[uint64]$returned[0].Size};$record.status='returned'
 }catch{$record.status='failed';$record.error=$_.Exception.Message;throw}
 $disk=Assert-ExactImageDisk $Baseline $ExpectedDisk;[void](Assert-ExactNewPartition $disk $partitionIdentity)
}
function Binding([object[]]$Baseline){
 $d=Image-Disk;[void](Assert-Baseline $Baseline ([string]$d.UniqueId))
 Need ([string]$d.PartitionStyle -ceq 'MBR') 'ONE_BASIC_MBR_DISK_REQUIRED'
 $parts=@($d | Storage\Get-Partition -ErrorAction Stop);Need ($parts.Count -eq 1 -and $parts[0].DriveLetter -ceq 'F') 'ONE_NEW_F_PARTITION_REQUIRED';$p=$parts[0]
 Need ([uint64]$p.Offset -ge 1048576 -and [uint64]$p.Size -ge 503316480 -and ([uint64]$p.Offset+[uint64]$p.Size) -le $MaximumBytes) 'PARTITION_BOUNDS_REQUIRED'
 $reverse=@(Storage\Get-Partition -DriveLetter F -ErrorAction Stop);Need ($reverse.Count -eq 1 -and $reverse[0].DiskNumber -eq $d.Number -and $reverse[0].PartitionNumber -eq $p.PartitionNumber -and $reverse[0].Offset -eq $p.Offset -and $reverse[0].Size -eq $p.Size) 'REVERSE_F_PARTITION_MISMATCH'
 $reverseDisk=@($reverse[0] | Storage\Get-Disk -ErrorAction Stop);Need ($reverseDisk.Count -eq 1 -and $reverseDisk[0].UniqueId -ceq $d.UniqueId -and $reverseDisk[0].Number -eq $d.Number) 'REVERSE_F_DISK_MISMATCH'
 $volumes=@($p | Storage\Get-Volume -ErrorAction Stop);Need ($volumes.Count -eq 1) 'ONE_F_VOLUME_REQUIRED';$v=$volumes[0]
 Need ($v.DriveLetter -ceq 'F' -and $v.FileSystem -ceq 'NTFS' -and $v.FileSystemLabel -ceq $ExpectedLabel -and [uint64]$v.Size -ge 503316480 -and [uint64]$v.Size -le [uint64]$p.Size) 'EXPECTED_NTFS_VOLUME_REQUIRED'
 $backImages=@(Storage\Get-DiskImage -Volume $v -ErrorAction Stop);Need ($backImages.Count -eq 1 -and $backImages[0].Attached -and (Same ([string]$backImages[0].ImagePath) $VhdFile)) 'REVERSE_VOLUME_IMAGE_MISMATCH'
 $n=@([XjyNative162Volume]::Volume());Need ($n.Count -eq 5 -and $n[0] -match '^\\\\\?\\Volume\{[a-fA-F0-9-]{36}\}\\$' -and (Same $n[0] ([string]$v.UniqueId)) -and $n[1] -match '^[a-f0-9]{8}$' -and $n[2] -ceq $ExpectedLabel -and $n[3] -ceq 'NTFS' -and $n[4] -match '^\\Device\\HarddiskVolume\d+$') 'NATIVE_VOLUME_IDENTITY_MISMATCH'
 return [ordered]@{imagePath=$VhdFile;diskUniqueId=[string]$d.UniqueId;diskNumber=[uint32]$d.Number;diskPath=[string]$d.Path;diskSize=[uint64]$d.Size;partitionNumber=[uint32]$p.PartitionNumber;partitionOffset=[uint64]$p.Offset;partitionSize=[uint64]$p.Size;volumeGuid=$n[0];volumeSerial=$n[1];fileSystem='NTFS';volumeLabel=$ExpectedLabel;volumeSize=[uint64]$v.Size;dosDevice=$n[4]}
}
function Same-Binding([object]$Actual,[object]$Expected){foreach($key in @('imagePath','diskUniqueId','diskSize','partitionNumber','partitionOffset','partitionSize','volumeGuid','volumeSerial','fileSystem','volumeLabel','volumeSize')){Need ([string]$Actual.$key -ceq [string]$Expected.$key) ('BOUND_VOLUME_CHANGED_'+$key)}}
function Read-State {
 $create=Read-Json (Join-Path $ResultsRoot 'vhd-create-a1.json');Assert-Receipt $create 'create'
 Need ($create.proof.bindingStateSha256 -cmatch '^[a-f0-9]{64}$') 'PINNED_BINDING_STATE_SHA_REQUIRED'
 $state=Read-Json $StateFile ([string]$create.proof.bindingStateSha256)
 if($BindingStateSha256){Need ($BindingStateSha256 -cmatch '^[a-f0-9]{64}$' -and $BindingStateSha256 -ceq $create.proof.bindingStateSha256) 'INDEPENDENT_BINDING_STATE_PIN_MISMATCH'}
 Need ($state.schemaVersion -eq 1 -and $state.purpose -ceq 'native162-vhd-probe-binding' -and $state.namespace -ceq $ExpectedNamespace -and $state.contextSha256 -ceq $ExpectedContextSha256 -and $state.sourceSha256 -ceq $SourceSha256 -and $state.guest.sid -ceq $guestProof.sid -and $state.imagePath -ceq $VhdFile -and $state.maximumBytes -eq $MaximumBytes) 'EXACT_BINDING_STATE_REQUIRED'
 return $state
}
function Owner([object]$B){return [ordered]@{schemaVersion=1;purpose='native162-vhd-volume-owner';synthetic=$true;namespace=$ExpectedNamespace;contextSha256=$ExpectedContextSha256;imagePath=$VhdFile;diskUniqueId=$B.diskUniqueId;volumeGuid=$B.volumeGuid;volumeSerial=$B.volumeSerial;volumeLabel=$ExpectedLabel}}
function Assert-Owner([object]$B){
 # No F-volume handle may survive this check into a detach operation.
 Need ((Json (Read-Json $OwnerFile '' $false)) -ceq (Json (Owner $B))) 'VOLUME_OWNER_MISMATCH'
}
function Invoke-FixedDiskPart([string]$Step){
 [void](Fresh-Guest);Assert-PlainPath $DiskPart;Pin-Parents ([IO.Path]::GetDirectoryName($DiskPart));$exePin=Pin-PlainFile $DiskPart;[void]$held.Add($exePin)
 if($Step -ceq 'create'){[void](Assert-CFreeSpace)}
 $select='select vdisk file="'+$VhdFile+'"'
 switch -CaseSensitive ($Step){
  'create' {$lines=@(('create vdisk file="'+$VhdFile+'" maximum=512 type=expandable'),$select,'attach vdisk','detail vdisk','exit')}
  'detach' {$lines=@($select,'detach vdisk','exit')}
  'attach' {$lines=@($select,'attach vdisk','detail vdisk','exit')}
  default {throw 'FIXED_DISKPART_STEP_REQUIRED'}
 }
 $text=($lines -join "`r`n")+"`r`n";Need ($text -notmatch '(?im)^\s*(clean|select\s+disk|automount|san)\b|\bnoerr\b') 'DISKPART_POLICY_REFUSED'
 $scriptFile=Join-Path $GuestRoot ('diskpart-'+$Step+'-a1.txt');Assert-PlainPath $scriptFile $false $true
 $bytes=[Text.Encoding]::ASCII.GetBytes($text);$f=[IO.File]::Open($scriptFile,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None);try{$f.Write($bytes,0,$bytes.Length);$f.Flush($true);[XjyInitialPathGuard]::Check($f.SafeFileHandle,$scriptFile,$false)}finally{$f.Dispose()};$scriptPin=Pin-PlainFile $scriptFile;[void]$held.Add($scriptPin)
 $psi=New-Object Diagnostics.ProcessStartInfo;$psi.FileName=$DiskPart;$psi.Arguments='/s "'+$scriptFile+'"';$psi.WorkingDirectory=$GuestRoot;$psi.UseShellExecute=$false;$psi.CreateNoWindow=$true;$psi.RedirectStandardOutput=$true;$psi.RedirectStandardError=$true;$psi.EnvironmentVariables.Clear()
 $psi.EnvironmentVariables['SystemRoot']='C:\Windows';$psi.EnvironmentVariables['WINDIR']='C:\Windows';$psi.EnvironmentVariables['SystemDrive']='C:';$psi.EnvironmentVariables['TEMP']=[Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)+'\Temp'
 $script:MutationAttempted=$true;$process=[Diagnostics.Process]::Start($psi);$stdout=New-Object IO.MemoryStream;$stderr=New-Object IO.MemoryStream;$outTask=$process.StandardOutput.BaseStream.CopyToAsync($stdout);$errTask=$process.StandardError.BaseStream.CopyToAsync($stderr);$finished=$process.WaitForExit(30000)
 $record=[ordered]@{step=$Step;executable=$DiskPart;pid=$process.Id;scriptSha256=(Sha $bytes);exitCode=$null;timedOut=(!$finished);processMayStillRun=(!$finished);outputComplete=$false;stdoutBase64='';stderrBase64='';stdoutText='';stderrText=''}
 if(!$finished){try{$record.stdoutBase64=[Convert]::ToBase64String($stdout.ToArray());$record.stderrBase64=[Convert]::ToBase64String($stderr.ToArray())}catch{};[void]$nativeRecords.Add($record);throw 'NATIVE_DISKPART_TIMEOUT_NO_KILL_NO_FURTHER_ACTION'}
 $outTask.GetAwaiter().GetResult();$errTask.GetAwaiter().GetResult();$o=$stdout.ToArray();$e=$stderr.ToArray();Need ($o.Length -le 1048576 -and $e.Length -le 1048576) 'NATIVE_OUTPUT_LIMIT_EXCEEDED'
 $record.exitCode=$process.ExitCode;$record.outputComplete=$true;$record.stdoutBase64=[Convert]::ToBase64String($o);$record.stderrBase64=[Convert]::ToBase64String($e);$encoding=[Text.Encoding]::GetEncoding([Globalization.CultureInfo]::CurrentCulture.TextInfo.OEMCodePage);$record.stdoutText=$encoding.GetString($o);$record.stderrText=$encoding.GetString($e);[void]$nativeRecords.Add($record);$process.Dispose();$stdout.Dispose();$stderr.Dispose()
 Need ($record.exitCode -eq 0) 'NATIVE_DISKPART_NONZERO_EXIT'
}
function New-Result([bool]$Passed,[object]$Proof,[string]$Failure=''){
 return [ordered]@{schemaVersion=1;purpose='native162-vhd-capability-probe';mode=$Mode;passed=$Passed;namespace=$ExpectedNamespace;contextSha256=$ExpectedContextSha256;sourceSha256=$SourceSha256;originalPathGuardSourceSha256=$OriginalPathGuardSha256;guest=$guestProof;recordedAt=[DateTime]::UtcNow.ToString('o');stage=$script:Stage;mutationAttempted=$script:MutationAttempted;productExecuted=$false;productionMapped=$false;hostFeaturesChanged=$false;servicesConfigured=$false;nativeProcesses=@($nativeRecords.ToArray());storageOperations=@($storageRecords.ToArray());proof=$Proof;failure=$Failure}
}

try {
 Need ($Mode -cin @('preflight','create','verify','detach','attach','check')) 'EXPLICIT_FIXED_MODE_REQUIRED'
 Need ($SourceSha256 -cmatch '^[a-f0-9]{64}$') 'REVIEWED_SOURCE_SHA_REQUIRED'
 if($Mode -ceq 'check'){Need ($BindingStateSha256 -cmatch '^[a-f0-9]{64}$') 'INDEPENDENT_BINDING_STATE_PIN_REQUIRED'}elseif($BindingStateSha256){Need ($BindingStateSha256 -cmatch '^[a-f0-9]{64}$') 'BINDING_STATE_PIN_INVALID'}
 Need ($ExpectedContextSha256 -cmatch '^[a-f0-9]{64}$') 'ROOT_BOUND_CONTEXT_FREEZE_REQUIRED'
 $script:Stage='actual-guest';$guestProof=Assert-ActualGuest
 Install-PathGuard
 Need (Same $PSCommandPath $SourceFile) 'FIXED_GUEST_SOURCE_REQUIRED'
 Assert-PlainPath $SourceFile;Pin-Parents ([IO.Path]::GetDirectoryName($SourceFile));[void](Read-Bytes $SourceFile 1048576 $SourceSha256)
 Assert-PlainPath $ContextFile;$context=Read-Json $ContextFile $ExpectedContextSha256;Assert-Context $guestProof
 Assert-PlainPath $WindowsPowerShell;Assert-PlainPath $ResultsRoot $true;Pin-Parents $ResultsRoot
 if($Mode -cne 'check'){$resultFile=Join-Path $ResultsRoot ('vhd-'+$Mode+'-a1.json');Assert-PlainPath $resultFile $false $true;Need (![IO.File]::Exists($resultFile)) 'CREATENEW_RESULT_ALREADY_EXISTS';$script:CanWriteResult=$true}
 $script:Stage='mode-preconditions'
 if($Mode -ceq 'preflight'){
  Assert-NoF;Assert-PlainPath $GuestRoot $true $true;Need (![IO.Directory]::Exists($GuestRoot) -and ![IO.File]::Exists($GuestRoot)) 'CREATENEW_ROOT_REQUIRED'
  $cFreeSpace=Assert-CFreeSpace
  $baseline=@(All-Disks);Need ($baseline.Count -gt 0 -and @($baseline | Where-Object {[string]::IsNullOrWhiteSpace($_.uniqueId)}).Count -eq 0) 'BASELINE_DISK_IDENTITIES_REQUIRED'
  $proof=[ordered]@{initialNoF=$true;ownedRootAbsent=$true;imageAbsent=$true;cFreeSpace=$cFreeSpace;baselineDisks=$baseline;maximumBytes=$MaximumBytes;imagePath=$VhdFile}
 }elseif($Mode -ceq 'create'){
  $preflight=Read-Json (Join-Path $ResultsRoot 'vhd-preflight-a1.json');Assert-Receipt $preflight 'preflight';$baseline=@($preflight.proof.baselineDisks);Need ($baseline.Count -gt 0) 'BASELINE_REQUIRED';[void](Assert-Baseline $baseline)
  Assert-NoF;Assert-PlainPath $GuestRoot $true $true;Need (![IO.Directory]::Exists($GuestRoot) -and ![IO.File]::Exists($GuestRoot)) 'CREATENEW_ROOT_REQUIRED'
  $cFreeSpace=Assert-CFreeSpace
  $script:Stage='create-owned-root';[XjyNative162Volume]::NewDirectory($GuestRoot);Assert-PlainPath $GuestRoot $true;Pin-Parents $GuestRoot
  Need (([IO.File]::GetAttributes($GuestRoot) -band ([IO.FileAttributes]::Compressed -bor [IO.FileAttributes]::Encrypted)) -eq 0) 'UNCOMPRESSED_UNENCRYPTED_ROOT_REQUIRED'
  Assert-PlainPath $VhdFile $false $true;Need (![IO.File]::Exists($VhdFile) -and ![IO.Directory]::Exists($VhdFile)) 'CREATENEW_IMAGE_REQUIRED'
  $script:Stage='create-and-attach-image';Invoke-FixedDiskPart 'create';$imagePin=Pin-Vhd;$disk=Image-Disk;[void](Assert-Baseline $baseline ([string]$disk.UniqueId));$rawPartitions=@(Storage\Get-Partition -ErrorAction Stop | Where-Object {$_.DiskNumber -eq $disk.Number});Need ($rawPartitions.Count -eq 0 -and [string]$disk.PartitionStyle -ceq 'RAW') 'NEW_RAW_UNPARTITIONED_DISK_REQUIRED';$rawDiskProof=Disk-Row $disk $rawPartitions
  Assert-NoF;Initialize-ExactImagePartition $baseline (Disk-Identity $disk);$binding=Binding $baseline
  $script:Stage='publish-owned-binding';[void](Write-NewJson $OwnerFile (Owner $binding));Assert-Owner $binding
  $state=[ordered]@{schemaVersion=1;purpose='native162-vhd-probe-binding';namespace=$ExpectedNamespace;contextSha256=$ExpectedContextSha256;sourceSha256=$SourceSha256;guest=$guestProof;imagePath=$VhdFile;maximumBytes=$MaximumBytes;baselineDisks=$baseline;binding=$binding};$stateSha=Write-NewJson $StateFile $state
  $proof=[ordered]@{binding=$binding;bindingStateSha256=$stateSha;initialNoF=$true;imageCreateNew=$true;cFreeSpaceBeforeCreate=$cFreeSpace;rawDiskBeforePartition=$rawDiskProof;baselineDisks=$baseline}
 }else{
  Assert-PlainPath $GuestRoot $true;Pin-Parents $GuestRoot;$state=Read-State;$baseline=@($state.baselineDisks);$imagePin=Pin-Vhd
  if($Mode -ceq 'attach'){
   Assert-NoF;[void](Assert-Baseline $baseline);$image=@(Storage\Get-DiskImage -ImagePath $VhdFile -ErrorAction Stop);Need ($image.Count -eq 1 -and !$image[0].Attached -and (Same ([string]$image[0].ImagePath) $VhdFile)) 'EXACT_DETACHED_IMAGE_REQUIRED'
   $detached=Read-Json (Join-Path $ResultsRoot 'vhd-detach-a1.json');Assert-Receipt $detached 'detach';Need ((Hash-Vhd $imagePin) -ceq $detached.proof.detachedImageSha256) 'DETACHED_IMAGE_CHANGED'
   $script:Stage='attach-exact-bound-image';Invoke-FixedDiskPart 'attach';$binding=Binding $baseline;Same-Binding $binding $state.binding;Assert-Owner $binding;$proof=[ordered]@{binding=$binding;reattachedSameVolume=$true;bindingStateSha256=(Sha (Read-Bytes $StateFile))}
  }else{
   $binding=Binding $baseline;Same-Binding $binding $state.binding;Assert-Owner $binding
   if($Mode -cin @('verify','check')){$proof=[ordered]@{binding=$binding;bindingStateSha256=(Sha (Read-Bytes $StateFile));verifiedOnly=$true;reusableReadOnly=($Mode -ceq 'check')}}
   else{
    $script:Stage='detach-exact-bound-image';Invoke-FixedDiskPart 'detach';Assert-NoF;[void](Assert-Baseline $baseline);$image=@(Storage\Get-DiskImage -ImagePath $VhdFile -ErrorAction Stop);Need ($image.Count -eq 1 -and !$image[0].Attached -and (Same ([string]$image[0].ImagePath) $VhdFile)) 'DETACH_NOT_PROVED'
    $proof=[ordered]@{previousBinding=$binding;detachedImageSha256=(Hash-Vhd $imagePin);fAbsent=$true;imageAttached=$false;baselineDisks=$baseline}
   }
  }
 }
 [void](Fresh-Guest);$script:Stage='complete';$result=New-Result $true $proof
 if($Mode -ceq 'check'){[Console]::Out.WriteLine((Json $result))}else{[void](Write-NewJson $resultFile $result);[Console]::Out.WriteLine((Json @{passed=$true;mode=$Mode;result=$resultFile;productExecuted=$false}))};$exitStatus=0
}catch{
 $failure=$_.Exception.Message;if($failure.Length -gt 4096){$failure=$failure.Substring(0,4096)}
 if($script:CanWriteResult){try{[void](Write-NewJson $resultFile (New-Result $false $null $failure))}catch{[Console]::Error.WriteLine('RESULT_CREATENEW_WRITE_REFUSED:'+ $_.Exception.Message)}}
 [Console]::Error.WriteLine('NATIVE162_PROBE_REFUSED:'+ $failure)
}finally{for($i=$held.Count-1;$i -ge 0;$i--){$held[$i].Dispose()}}
exit $exitStatus

param(
 [Parameter(Mandatory=$true)][ValidateSet('c6b4f1f6-411e-4272-b4a4-a1ca62701e39')][string]$ConfirmedGuestId,
 [Parameter(Mandatory=$true)][string]$ExpectedComputerName,
 [Parameter(Mandatory=$true)][ValidatePattern('^S-1-\d+(?:-\d+)+$')][string]$ExpectedSid,
 [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{64}$')][string]$SourceSha256,
 [Parameter(Mandatory=$true)][string]$SourceFile
)
# Read-only capability source. No DLL load, dynamic compilation, device opens,
# VHD operations, subprocesses, service/configuration changes, output files or ACL writes.
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
function Need([bool]$Value,[string]$Code){if(!$Value){throw $Code}}
function Sha([byte[]]$Bytes){$h=[Security.Cryptography.SHA256]::Create();try{return ([BitConverter]::ToString($h.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant()}finally{$h.Dispose()}}
function Read-Ordinary([string]$File,[int]$Limit){
 Need ([IO.Path]::IsPathRooted($File) -and [string]::Equals([IO.Path]::GetFullPath($File),$File,[StringComparison]::OrdinalIgnoreCase)) 'FIXED_ORDINARY_PATH_REQUIRED'
 $walk=$File
 while($walk){$entry=Get-Item -LiteralPath $walk -Force -ErrorAction Stop;Need (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) 'INPUT_REPARSE_REJECTED';$parent=[IO.Directory]::GetParent($walk);if(!$parent){break};$walk=$parent.FullName}
 $s=[IO.File]::Open($File,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
 try{Need ($s.Length -gt 0 -and $s.Length -le $Limit) 'READ_BOUND';$b=New-Object byte[] ([int]$s.Length);$at=0;while($at -lt $b.Length){$n=$s.Read($b,$at,$b.Length-$at);Need ($n -gt 0) 'INCOMPLETE_READ';$at+=$n};Need ($s.Length -eq $b.Length) 'FILE_CHANGED';return ,$b}finally{$s.Dispose()}
}
function U16([byte[]]$B,[int]$At){Need ($At -ge 0 -and $At+2 -le $B.Length) 'PE_BOUND';return [BitConverter]::ToUInt16($B,$At)}
function U32([byte[]]$B,[int]$At){Need ($At -ge 0 -and $At+4 -le $B.Length) 'PE_BOUND';return [BitConverter]::ToUInt32($B,$At)}
function Pe-ExportNames([byte[]]$B){
 Need ((U16 $B 0) -eq 0x5a4d) 'PE_MZ';$pe=[int](U32 $B 0x3c);Need ((U32 $B $pe) -eq 0x4550) 'PE_SIGNATURE'
 $sectionCount=[int](U16 $B ($pe+6));$optionalSize=[int](U16 $B ($pe+20));$optional=$pe+24
 Need ($sectionCount -gt 0 -and $sectionCount -le 96 -and $optionalSize -ge 120 -and (U16 $B $optional) -eq 0x20b) 'PE64_REQUIRED'
 $exportRva=[uint32](U32 $B ($optional+112));$exportSize=[uint32](U32 $B ($optional+116));Need ($exportRva -gt 0 -and $exportSize -gt 0) 'PE_EXPORT_REQUIRED'
 $sections=New-Object 'Collections.Generic.List[object]'
 for($i=0;$i -lt $sectionCount;$i++){$at=$optional+$optionalSize+40*$i;[void](U32 $B ($at+36));$sections.Add(@{va=[uint64](U32 $B ($at+12));size=[uint64](U32 $B ($at+16));raw=[uint64](U32 $B ($at+20))})}
 function Offset([uint32]$Rva){foreach($s in $sections){$v=[uint64]$Rva;if($v -ge $s.va -and $v -lt ($s.va+$s.size)){$at=$s.raw+$v-$s.va;Need ($at -lt $B.Length) 'PE_RVA_BOUND';return [int]$at}};throw 'PE_RVA_UNMAPPED'}
 $directory=Offset $exportRva;$count=[int](U32 $B ($directory+24));Need ($count -gt 0 -and $count -le 4096) 'PE_EXPORT_COUNT';$names=Offset (U32 $B ($directory+32));$answer=New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
 for($i=0;$i -lt $count;$i++){$at=Offset (U32 $B ($names+4*$i));$end=$at;while($end -lt $B.Length -and $end-$at -le 256 -and $B[$end] -ne 0){Need ($B[$end] -lt 128) 'PE_EXPORT_ASCII';$end++};Need ($end -lt $B.Length -and $end-$at -le 256) 'PE_EXPORT_NAME_BOUND';[void]$answer.Add([Text.Encoding]::ASCII.GetString($B,$at,$end-$at))}
 return ,$answer
}
try{
 # Fail before source/DLL/Storage access unless the real guest facts match Root's binding.
 $who=[Security.Principal.WindowsIdentity]::GetCurrent()
 Need ($who.Name -match '^[^\\]+\\WDAGUtilityAccount$') 'ACTUAL_WDAG_REQUIRED'
 Need ($ExpectedComputerName -and [string]::Equals([Environment]::MachineName,$ExpectedComputerName,[StringComparison]::OrdinalIgnoreCase) -and $who.User.Value -ceq $ExpectedSid) 'ROOT_BOUND_GUEST_IDENTITY_REQUIRED'
 Need ([Environment]::Is64BitProcess -and $PSVersionTable.PSVersion.Major -eq 5 -and $PSVersionTable.PSVersion.Minor -eq 1) 'NATIVE_PS51_X64_REQUIRED'
 Need ([Environment]::GetFolderPath([Environment+SpecialFolder]::Windows) -ceq 'C:\Windows') 'FIXED_WINDOWS_REQUIRED'
 $computer=CimCmdlets\Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction Stop
 Need ($computer.Model -ceq 'Virtual Machine') 'ACTUAL_VM_REQUIRED'
 $addresses=@(NetTCPIP\Get-NetIPAddress -ErrorAction Stop | Where-Object {$_.IPAddress -notlike '127.*' -and $_.IPAddress -ne '::1'})
 Need ($addresses.Count -eq 0) 'OFFLINE_GUEST_REQUIRED'
 $nativeLetters=@([Environment]::GetLogicalDrives());$psLetters=@(Get-PSDrive -PSProvider FileSystem | Select-Object -ExpandProperty Name)
 Need (@($nativeLetters | Where-Object {$_ -ieq 'F:\'}).Count -eq 0 -and 'F' -notin $psLetters) 'INITIAL_NO_F_REQUIRED'
 Need ($SourceFile -match '^C:\\' -and [IO.Path]::GetFileName($SourceFile) -ceq 'guest-c6-virtdisk-readonly-capability-a1.ps1') 'FIXED_SOURCE_NAME_REQUIRED'
 $source=Read-Ordinary $SourceFile 65536;Need ((Sha $source) -ceq $SourceSha256) 'SOURCE_PIN_CHANGED'
 $dll='C:\Windows\System32\virtdisk.dll';$raw=Read-Ordinary $dll 16777216;$exportNames=Pe-ExportNames $raw
 $wanted=@('CreateVirtualDisk','OpenVirtualDisk','AttachVirtualDisk','DetachVirtualDisk','GetVirtualDiskInformation','GetVirtualDiskPhysicalPath','GetStorageDependencyInformation');$exports=[ordered]@{}
 foreach($name in $wanted){$exports[$name]=$exportNames.Contains($name)}
 $drivers=@(foreach($name in @('vhdmp.sys','vhdparser.sys')){$file='C:\Windows\System32\drivers\'+$name;$exists=[IO.File]::Exists($file);[ordered]@{path=$file;exists=$exists}})
 $storage=New-Object 'Collections.Generic.List[object]'
 foreach($class in @('MSFT_Disk','MSFT_Partition','MSFT_Volume','MSFT_DiskImage')){try{$items=@(CimCmdlets\Get-CimInstance -Namespace 'root/Microsoft/Windows/Storage' -ClassName $class -ErrorAction Stop);$entry=[ordered]@{class=$class;status='queried';count=$items.Count};if($class -ceq 'MSFT_Disk'){$entry.disks=@($items | ForEach-Object {[ordered]@{number=$_.Number;uniqueId=[string]$_.UniqueId;size=[string]$_.Size;isBoot=[bool]$_.IsBoot;isSystem=[bool]$_.IsSystem}})};$storage.Add($entry)}catch{$storage.Add([ordered]@{class=$class;status='unavailable';errorType=$_.Exception.GetType().FullName;error=$_.Exception.Message})}}
 $principal=New-Object Security.Principal.WindowsPrincipal($who)
 [ordered]@{schemaVersion=1;purpose='guest-c6-virtdisk-readonly-capability';passed=$true;rootConfirmedTransportGuestId=$ConfirmedGuestId;vmGuidProvenByScript=$false;requiresRootTransportBinding=$true;guest=[ordered]@{computerName=[Environment]::MachineName;userName=$who.Name;sid=$who.User.Value;model=[string]$computer.Model;administrator=$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator);nonLoopbackAddressCount=0;initialNoF=$true};sourceSha256=$SourceSha256;virtdisk=[ordered]@{path=$dll;sha256=(Sha $raw);exportCheck='PE export names only; DLL not loaded and no APIs invoked';exports=$exports};driverFiles=$drivers;storage=@($storage.ToArray());mutationAttempted=$false;createAttempted=$false;attachAttempted=$false;deviceHandleOpened=$false;servicesStarted=$false;aclChanged=$false;productExecuted=$false;wroteOutputFile=$false;vhdOperationalCapabilityProven=$false;recordedAt=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json -Depth 9 -Compress
 exit 0
}catch{
 [Console]::Error.WriteLine('READONLY_CAPABILITY_REFUSED:'+ $_.Exception.Message)
 exit 37
}

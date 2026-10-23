param([Parameter(Mandatory=$true)][string]$RequestFile)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'Initial-Path-Guard.ps1')
$held=New-Object 'Collections.Generic.List[IDisposable]'
try {
 if($RequestFile -notmatch '\\.xjy-initial-upgrade\\source-lease-[a-f0-9-]{36}\.json$'){throw 'Only fixed initial source lease requests are accepted'}
 $requestPin=Pin-PlainFile $RequestFile;$held.Add($requestPin);if($requestPin.Length -gt 16384){throw 'Lease request oversized'};$rdr=New-Object IO.StreamReader($requestPin,[Text.Encoding]::UTF8,$true,1024,$true);$raw=$rdr.ReadToEnd();$rdr.Dispose();$r=$raw|ConvertFrom-Json
 if($r.version -ne 1 -or $r.root -cne 'F:\鑫金源珠宝资料' -or @($r.databases).Count -ne 3){throw 'Only the fixed existing Host root and three sources may be locked'}
 $names=@{sales='jewelry.sqlite';ledger='ledger.db';inventory='stockcheck.db'};$seen=@{}
 foreach($db in $r.databases){if(!$names.ContainsKey([string]$db.module) -or $seen.ContainsKey([string]$db.module)){throw 'Unknown or duplicate database'};$seen[[string]$db.module]=$true;$p=[IO.Path]::GetFullPath([string]$db.source);if(!$p.StartsWith($r.root+'\',[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($p) -cne $names[[string]$db.module] -or $p.Substring(2).Contains(':') -or $db.source -ne $p){throw 'Database path escaped fixed role namespace'}
  $dir=[IO.Path]::GetDirectoryName($p);while($dir -and $dir.StartsWith($r.root,[StringComparison]::OrdinalIgnoreCase)){$held.Add((Pin-PlainDirectory $dir));$parent=[IO.Directory]::GetParent($dir);if(!$parent){break};$dir=$parent.FullName};$held.Add((Pin-PlainFile $p))
 }
 $cap=$env:XJY_INITIAL_SOURCE_CAP;if($cap -notmatch '^[a-f0-9]{64}$'){throw 'Native source lease capability missing'};$key=New-Object byte[] 32;for($i=0;$i -lt 32;$i++){$key[$i]=[Convert]::ToByte($cap.Substring($i*2,2),16)};$sha=[Security.Cryptography.SHA256]::Create();$requestHash=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($raw)))).Replace('-','').ToLowerInvariant();$sha.Dispose();$h=New-Object Security.Cryptography.HMACSHA256 (,$key);$mac=([BitConverter]::ToString($h.ComputeHash([Text.Encoding]::UTF8.GetBytes($requestHash)))).Replace('-','').ToLowerInvariant();$h.Dispose();[Console]::Out.WriteLine((@{ready=$true;requestHash=$requestHash;mac=$mac}|ConvertTo-Json -Compress));[Console]::Out.Flush()
 # The owned parent releases via its pipe. Parent crash closes stdin. There is
 # no process name lookup/kill and no source content write, checkpoint or SQL.
 [void][Console]::In.ReadLine()
}catch{[Console]::Error.WriteLine('SOURCE_LEASE_REFUSED');exit 1}finally{for($i=$held.Count-1;$i -ge 0;$i--){$held[$i].Dispose()}}

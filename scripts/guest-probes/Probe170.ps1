$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
$root = 'C:\Users\WDAGUtilityAccount\AppData\Local'
$out = [ordered]@{}
$out.at = (Get-Date).ToString('o')
$out.user = $env:USERNAME
$out.computer = $env:COMPUTERNAME
$out.fDrive = (Test-Path 'F:\')

function Get-TreeInfo($p) {
  $files = @(Get-ChildItem -LiteralPath $p -Recurse -File -Force -ErrorAction SilentlyContinue)
  $bytes = 0
  $newest = $null
  foreach ($f in $files) {
    $bytes = $bytes + $f.Length
    if ($null -eq $newest -or $f.LastWriteTime -gt $newest) { $newest = $f.LastWriteTime }
  }
  $nw = $null
  if ($null -ne $newest) { $nw = $newest.ToString('o') }
  return [ordered]@{ files = $files.Count; bytes = $bytes; newestWrite = $nw }
}

$procs = @()
foreach ($p in (Get-Process -ErrorAction SilentlyContinue)) {
  $nm = $p.ProcessName
  if ($nm -match 'xjy|Xjy|upgrade|Upgrade|node|electron|powershell|cmd|cscript|wscript') {
    $st = $null
    try { $st = $p.StartTime.ToString('o') } catch { }
    $procs += [ordered]@{ id = $p.Id; name = $nm; cpu = $p.CPU; start = $st; ws = $p.WorkingSet64 }
  }
}
$out.processes = $procs

$cmds = @()
foreach ($c in (Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)) {
  if ($c.CommandLine -and $c.CommandLine -match 'Xjy|一键|upgrade') {
    $cl = $c.CommandLine
    if ($cl.Length -gt 300) { $cl = $cl.Substring(0, 300) }
    $cmds += [ordered]@{ id = $c.ProcessId; name = $c.Name; cmd = $cl }
  }
}
$out.commandLines = $cmds

$out.installs = @()
foreach ($i in (Get-ChildItem -LiteralPath $root -Directory -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -like 'Xjy*' })) {
  $entry = [ordered]@{}
  $entry.path = $i.FullName
  $entry.lastWrite = $i.LastWriteTime.ToString('o')
  $entry.children = @()
  foreach ($c in (Get-ChildItem -LiteralPath $i.FullName -Force -ErrorAction SilentlyContinue)) {
    $row = [ordered]@{}
    $row.name = $c.Name
    $row.isDir = [bool]$c.PSIsContainer
    $row.lastWrite = $c.LastWriteTime.ToString('o')
    if ($c.PSIsContainer) {
      $t = Get-TreeInfo $c.FullName
      $row.files = $t.files
      $row.bytes = $t.bytes
      $row.newestWrite = $t.newestWrite
    } else {
      $row.length = $c.Length
    }
    $entry.children += $row
  }
  $state = Join-Path $i.FullName '.program.xjy-engine-state'
  if (Test-Path -LiteralPath $state) {
    $srow = [ordered]@{ path = $state; entries = @() }
    foreach ($s in (Get-ChildItem -LiteralPath $state -Force -ErrorAction SilentlyContinue)) {
      $sr = [ordered]@{ name = $s.Name; isDir = [bool]$s.PSIsContainer; lastWrite = $s.LastWriteTime.ToString('o') }
      if (-not $s.PSIsContainer) { $sr.length = $s.Length }
      else { $t2 = Get-TreeInfo $s.FullName; $sr.files = $t2.files; $sr.bytes = $t2.bytes }
      $srow.entries += $sr
    }
    $jp = Join-Path $state 'journal.json'
    if (Test-Path -LiteralPath $jp) {
      $srow.journalPresent = $true
      try {
        $srow.journalLength = (Get-Item -LiteralPath $jp).Length
        Copy-Item -LiteralPath $jp -Destination 'C:\XjyReleaseResults\journal-copy.json' -Force -ErrorAction Stop
        $srow.journalCopy = 'C:\XjyReleaseResults\journal-copy.json'
        $raw = Get-Content -LiteralPath $jp -Raw -ErrorAction Stop
        if ($raw.Length -gt 600) { $raw = $raw.Substring(0, 600) }
        $srow.journalHead = $raw
      } catch { $srow.journalError = $_.Exception.Message }
    } else {
      $srow.journalPresent = $false
    }
    $entry.state = $srow
  } else {
    $entry.state = 'ABSENT'
  }
  $mk = Join-Path $i.FullName 'program\xjy-install-activation.json'
  if (Test-Path -LiteralPath $mk) {
    try { $entry.marker = Get-Content -LiteralPath $mk -Raw -ErrorAction Stop } catch { $entry.markerError = $_.Exception.Message }
  } else {
    $entry.marker = 'ABSENT'
  }
  $exe = Get-ChildItem -LiteralPath (Join-Path $i.FullName 'program') -Filter '*.exe' -File -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($exe) { $entry.exeVersion = $exe.VersionInfo.FileVersion }
  $out.installs += $entry
}

$stamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
$jsonPath = Join-Path 'C:\XjyReleaseResults' ("probe-" + $stamp + ".json")
$out | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $jsonPath -Encoding UTF8
Write-Output ("WROTE " + $jsonPath)

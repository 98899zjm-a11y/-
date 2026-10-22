$ErrorActionPreference = 'Continue'
$ResultDir = 'C:\XjyReleaseResults'
$install = 'C:\Users\WDAGUtilityAccount\AppData\Local\XjyGenuine150Host-a2\program'
$state = 'C:\Users\WDAGUtilityAccount\AppData\Local\XjyGenuine150Host-a2\.program.xjy-engine-state'
$res = [ordered]@{}
$res.at = (Get-Date).ToString('o')
$sw = [Diagnostics.Stopwatch]::StartNew()
$Prog = Join-Path $ResultDir 'verify-progress.log'
function Note($m) { Add-Content -LiteralPath $Prog -Value ((Get-Date).ToString('HH:mm:ss') + ' ' + $m) -Encoding UTF8 }
trap {
  Note ('TRAP ' + $_.Exception.GetType().FullName + ': ' + $_.Exception.Message + ' @ line ' + $_.InvocationInfo.ScriptLineNumber)
  break
}
Note 'start'
Note ('psversion=' + $PSVersionTable.PSVersion.ToString())

$envs = Get-Content -LiteralPath (Join-Path $state 'journal.json') -Raw | ConvertFrom-Json
$rec = $envs.payload | ConvertFrom-Json
$res.phase = $rec.phase
$res.role = $rec.role
$res.sourceVersion = $rec.sourceVersion
$res.targetVersion = $rec.targetVersion
$res.sourceEngineVersion = $rec.sourceEngineVersion
$res.targetEngineVersion = $rec.targetEngineVersion
$res.transactionId = $rec.transactionId
$res.targetFileCount = @($rec.targetFiles).Count
Note ('journal ok phase=' + $rec.phase + ' targetFiles=' + $res.targetFileCount)

$sp = Join-Path $state 'engine-startup-status.json'
if (Test-Path -LiteralPath $sp) { $res.startupStatus = (Get-Content -LiteralPath $sp -Raw) }

$mk = Join-Path $install 'xjy-install-activation.json'
if (Test-Path -LiteralPath $mk) { $res.marker = (Get-Content -LiteralPath $mk -Raw) }

$exeFiles = @(Get-ChildItem -LiteralPath $install -Filter '*.exe' -File -ErrorAction SilentlyContinue)
$res.exeNames = @($exeFiles | ForEach-Object { $_.Name })
foreach ($e in $exeFiles) {
  if ($e.Name -notmatch 'unins') { $res.mainExeVersion = $e.VersionInfo.FileVersion; $res.mainExeName = $e.Name; break }
}

function Get-FileDigest($full) {
  $fs = $null
  try {
    $lp = '\\?\' + $full
    $fs = [System.IO.File]::Open($lp, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    $len = $fs.Length
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $bytes = $sha.ComputeHash($fs)
    $sb = New-Object System.Text.StringBuilder
    foreach ($b in $bytes) { [void]$sb.Append($b.ToString('x2')) }
    return [pscustomobject]@{ len = $len; sha = $sb.ToString() }
  } catch {
    return [pscustomobject]@{ error = $_.Exception.Message }
  } finally {
    if ($fs) { $fs.Close() }
  }
}

$expected = @{}
foreach ($f in $rec.targetFiles) { $expected[($f.path -replace '/', '\').ToLowerInvariant()] = $f }

$lines = @(& robocopy $install 'C:\__probe_dummy__' /L /S /BYTES /FP /NC /NDL /NJH /NJS /NP)
$seen = @{}
$mismatch = @()
$extra = @()
$hashed = 0
$hashBytes = [int64]0
foreach ($ln in $lines) {
  if (-not ($ln -match '^\s+(\d+)\s+(.+?)\s*$')) { continue }
  $full = $Matches[2]
  if (-not $full.StartsWith($install, [System.StringComparison]::OrdinalIgnoreCase)) { continue }
  $rel = $full.Substring($install.Length).TrimStart('\')
  $key = $rel.ToLowerInvariant()
  $seen[$key] = $true
  $d = Get-FileDigest $full
  $hashed++
  if ($d.PSObject.Properties.Name -contains 'error') { if ($mismatch.Count -lt 50) { $mismatch += [ordered]@{ path = $rel; reason = 'HASH_ERROR'; error = $d.error } }; continue }
  $hashBytes += $d.len
  $exp = $expected[$key]
  if ($null -eq $exp) { if ($extra.Count -lt 50) { $extra += $rel }; continue }
  if ($d.len -ne [int64]$exp.size -or $d.sha -ne $exp.sha256) {
    if ($mismatch.Count -lt 50) { $mismatch += [ordered]@{ path = $rel; expectedSize = $exp.size; actualSize = $d.len; expectedSha = $exp.sha256; actualSha = $d.sha } }
  }
}
$missing = @()
foreach ($k in $expected.Keys) { if (-not $seen.ContainsKey($k)) { if ($missing.Count -lt 50) { $missing += $k } } }
$res.program = [ordered]@{ hashed = $hashed; bytes = $hashBytes; mismatchCount = $mismatch.Count; mismatchSamples = $mismatch; extraCount = $extra.Count; extraSamples = $extra; missingExpectedCount = $missing.Count; missingSamples = $missing }
$res.programSeconds = [math]::Round($sw.Elapsed.TotalSeconds, 1)
Note ('program done hashed=' + $hashed + ' bytes=' + $hashBytes + ' mismatch=' + $mismatch.Count + ' extra=' + $extra.Count + ' missing=' + $missing.Count)

$beforePath = Join-Path $ResultDir 'before.json'
$dataReport = [ordered]@{}
if (Test-Path -LiteralPath $beforePath) {
  $before = Get-Content -LiteralPath $beforePath -Raw | ConvertFrom-Json
  $dataRoot = $before.data.root
  $dataReport.root = $dataRoot
  $dataReport.rootExists = (Test-Path -LiteralPath $dataRoot)
  $dataReport.expected = @($before.data.files).Count
  if ($dataReport.rootExists) {
    $dsw = [Diagnostics.Stopwatch]::StartNew()
    $dmis = @()
    $dmissing = @()
    $dsame = 0
    foreach ($f in $before.data.files) {
      $p = Join-Path $dataRoot $f.path
      if (-not (Test-Path -LiteralPath $p)) { if ($dmissing.Count -lt 50) { $dmissing += $f.path }; continue }
      $d = Get-FileDigest $p
      if ($d.PSObject.Properties.Name -contains 'error') { if ($dmis.Count -lt 50) { $dmis += [ordered]@{ path = $f.path; reason = 'HASH_ERROR'; error = $d.error } }; continue }
      if ($d.sha -ne $f.sha256 -or $d.len -ne [int64]$f.size) {
        if ($dmis.Count -lt 50) { $dmis += [ordered]@{ path = $f.path; expectedSize = $f.size; actualSize = $d.len; expectedSha = $f.sha256; actualSha = $d.sha } }
      } else { $dsame++ }
    }
    $dataReport.same = $dsame
    $dataReport.mismatchCount = $dmis.Count
    $dataReport.mismatchSamples = $dmis
    $dataReport.missingCount = $dmissing.Count
    $dataReport.missingSamples = $dmissing
    $dataReport.seconds = [math]::Round($dsw.Elapsed.TotalSeconds, 1)
  }
} else {
  $dataReport.error = 'beforeMissing'
}
$res.data = $dataReport
Note ('data done same=' + $dataReport.same + ' mismatch=' + $dataReport.mismatchCount + ' missing=' + $dataReport.missingCount + ' error=' + $dataReport.error)

$stamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
$out = Join-Path $ResultDir ('verify-' + $stamp + '.json')
$res | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $out -Encoding UTF8
Note ('wrote ' + $out)
Write-Output ('WROTE ' + $out)
Write-Output ('program hashed=' + $res.program.hashed + ' mismatch=' + $res.program.mismatchCount + ' extra=' + $res.program.extraCount + ' missingExpected=' + $res.program.missingExpectedCount)
Write-Output ('data same=' + $res.data.same + ' mismatch=' + $res.data.mismatchCount + ' missing=' + $res.data.missingCount)

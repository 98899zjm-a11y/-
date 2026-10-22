#requires -Version 5.1
<#
  04-collect.ps1  --  HOST side, step 4 of the 1.7.0 power-loss recovery drill.

  Copies the files that belong to this drill out of the sandbox result mapping and writes an index:

      <guest results>  ->  <evidence dir>
      C:\XjyResults\*      D:\Codex\xjy-release-20261022\evidence-s4-recovery\

  Nothing is deleted, nothing outside the whitelist is copied (the sandbox VHD, the seeded program
  tree and the business data never leave the guest mapping).

  Produced:
    * evidence-s4-recovery\<drill artefact>.json / .log / .txt
    * evidence-s4-recovery\scripts\01-seed.ps1 ... (the exact scripts that were used)
    * evidence-s4-recovery\collect-manifest.json
    * evidence-s4-recovery\INDEX.md          (ASCII index, sha256 of every copied file)

  Contract:
    * pure ASCII source and pure ASCII output.
    * a failed drill is still evidence: this script never omits or rewrites an artefact because the
      verdict is bad, and it never re-installs anything to "repair" a run.
    * marker line: "COLLECT-DONE <copied> <missing>".
#>

[CmdletBinding()]
param(
  [string] $GuestResults = 'D:\Codex\xjy-release-20261022\guest-results',
  [string] $OutDir       = 'D:\Codex\xjy-release-20261022\evidence-s4-recovery',
  [string] $DrillDir     = '',
  [switch] $NoScripts
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$script:Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
if ([string]::IsNullOrWhiteSpace($DrillDir)) { $DrillDir = $PSScriptRoot }

function Write-TextFile {
  param([string] $Path, [string] $Text)
  [System.IO.File]::WriteAllText($Path, $Text, $script:Utf8NoBom)
}

function Get-Sha256File {
  param([string] $Path)
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Read-JsonFile {
  param([string] $Path)
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  try { return (Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json) } catch { return $null }
}

function Get-Field {
  param([object] $Object, [string] $Name)
  if ($null -eq $Object) { return $null }
  $p = $Object.PSObject.Properties[$Name]
  if ($null -eq $p) { return $null }
  return $p.Value
}

function Format-Bytes {
  param([int64] $Bytes)
  return ('{0:N0}' -f $Bytes)
}

# ---------------------------------------------------------------------------------------------
# whitelist: only what this drill produces or consumes
# ---------------------------------------------------------------------------------------------
# required: every valid round must produce these
$required = @(
  @{ name = 'seed-result.json';    kind = 'seed' },
  @{ name = 'seed.log';            kind = 'seed' },
  @{ name = 'watch-trace.log';     kind = 'watch' },
  @{ name = 'recover-verify.json'; kind = 'verify' },
  @{ name = 'verify.log';          kind = 'verify' }
)

# optional: copied when present, never reported as a defect (the round decides which of the
# prepared-* files exists, and the recovery step may write its output under either name)
$optional = @(
  @{ name = 'prepared-hit.json';     kind = 'watch' },
  @{ name = 'journal-prepared.json'; kind = 'watch' },
  @{ name = 'prepared-missed.json';  kind = 'watch' },
  @{ name = 'prepared-timeout.json'; kind = 'watch' },
  @{ name = 'regkey.json';           kind = 'seed' },
  @{ name = 'acl.log';               kind = 'seed' },
  @{ name = 'recover-stdout.txt';    kind = 'recover-log' },
  @{ name = 'recover-stderr.txt';    kind = 'recover-log' },
  @{ name = 'recover-exit.txt';      kind = 'recover-log' },
  @{ name = 'recover-console.txt';   kind = 'recover-log' },
  @{ name = 'startup-restore.log';   kind = 'recover-log' },
  @{ name = 'upgrade-stdout.txt';    kind = 'upgrade-log' },
  @{ name = 'upgrade-stderr.txt';    kind = 'upgrade-log' },
  @{ name = 'upgrade-exit.txt';      kind = 'upgrade-log' },
  @{ name = 'host-stop-at.txt';      kind = 'host' }
)

if (-not (Test-Path -LiteralPath $GuestResults)) { throw ('guest result mapping not found: ' + $GuestResults) }
if (-not (Test-Path -LiteralPath $OutDir)) { New-Item -ItemType Directory -Path $OutDir -Force | Out-Null }

$copied  = New-Object System.Collections.ArrayList
$missing = New-Object System.Collections.ArrayList

foreach ($item in $required) {
  $src = Join-Path $GuestResults $item.name
  if (Test-Path -LiteralPath $src -PathType Leaf) {
    $dst = Join-Path $OutDir $item.name
    Copy-Item -LiteralPath $src -Destination $dst -Force
    $info = New-Object System.IO.FileInfo $dst
    [void] $copied.Add([pscustomobject]@{
      name = $item.name; kind = $item.kind; required = $true; bytes = $info.Length
      lastWriteAt = $info.LastWriteTimeUtc.ToString('o'); sha256 = (Get-Sha256File $dst)
    })
  } else {
    [void] $missing.Add([pscustomobject]@{ name = $item.name; kind = $item.kind })
  }
}

foreach ($item in $optional) {
  $src = Join-Path $GuestResults $item.name
  if (Test-Path -LiteralPath $src -PathType Leaf) {
    $dst = Join-Path $OutDir $item.name
    Copy-Item -LiteralPath $src -Destination $dst -Force
    $info = New-Object System.IO.FileInfo $dst
    [void] $copied.Add([pscustomobject]@{
      name = $item.name; kind = $item.kind; required = $false; bytes = $info.Length
      lastWriteAt = $info.LastWriteTimeUtc.ToString('o'); sha256 = (Get-Sha256File $dst)
    })
  }
}

# any additional *recover* / *restore* artefact the delivery produced on the host mapping
$extra = @{}
foreach ($pattern in @('*recover*.log', '*recover*.txt', '*restore*.log', '*restore*.txt', 'wsb-*.log', 'host-*.log')) {
  foreach ($file in [System.IO.Directory]::GetFiles($GuestResults, $pattern)) {
    $name = [System.IO.Path]::GetFileName($file)
    if ($extra.ContainsKey($name)) { continue }
    $already = @($copied | Where-Object { $_.name -eq $name }).Count -gt 0
    if ($already) { continue }
    $extra[$name] = $true
    $dst = Join-Path $OutDir $name
    Copy-Item -LiteralPath $file -Destination $dst -Force
    $info = New-Object System.IO.FileInfo $dst
    [void] $copied.Add([pscustomobject]@{
      name = $name; kind = 'extra-log'; bytes = $info.Length
      lastWriteAt = $info.LastWriteTimeUtc.ToString('o'); sha256 = (Get-Sha256File $dst)
    })
  }
}

# the drill scripts themselves, so the evidence bundle is self describing
$scriptRows = New-Object System.Collections.ArrayList
$scriptNames = @('README.md', '01-seed.ps1', '02-watch-prepared.ps1', '03-verify-after.ps1', '04-collect.ps1')
if (-not $NoScripts) {
  $scriptOut = Join-Path $OutDir 'scripts'
  if (-not (Test-Path -LiteralPath $scriptOut)) { New-Item -ItemType Directory -Path $scriptOut -Force | Out-Null }
  if (Test-Path -LiteralPath $DrillDir) {
    foreach ($name in $scriptNames) {
      $src = Join-Path $DrillDir $name
      if (-not (Test-Path -LiteralPath $src -PathType Leaf)) { continue }
      $dst = Join-Path $scriptOut $name
      Copy-Item -LiteralPath $src -Destination $dst -Force
      $info = New-Object System.IO.FileInfo $dst
      [void] $scriptRows.Add([pscustomobject]@{ name = $name; bytes = $info.Length; sha256 = (Get-Sha256File $dst) })
    }
  }
}

# ---------------------------------------------------------------------------------------------
# verdict summary (read only, never repaired)
# ---------------------------------------------------------------------------------------------
$verify   = Read-JsonFile (Join-Path $OutDir 'recover-verify.json')
$hit      = Read-JsonFile (Join-Path $OutDir 'prepared-hit.json')
$missed   = Read-JsonFile (Join-Path $OutDir 'prepared-missed.json')
$timedout = Read-JsonFile (Join-Path $OutDir 'prepared-timeout.json')
$seed     = Read-JsonFile (Join-Path $OutDir 'seed-result.json')

$verdictKind = 'no-verify-file'
if ($null -ne $verify) { $verdictKind = [string] (Get-Field (Get-Field $verify 'verdict') 'verdict') }
$hitKind = 'none'
if ($null -ne $hit)      { $hitKind = 'prepared-hit' }
elseif ($null -ne $missed)   { $hitKind = 'prepared-missed (round invalid: window left before prepared)' }
elseif ($null -ne $timedout) { $hitKind = 'prepared-timeout (no window observed)' }

$seedOk = $false
if ($null -ne $seed) { $seedOk = [bool] (Get-Field $seed 'ok') }

$summary = [ordered]@{
  schema      = 'xjy-recovery-drill-collect/1'
  collectedAt = [DateTime]::UtcNow.ToString('o')
  guestResults = $GuestResults
  outDir       = $OutDir
  drillDir     = $DrillDir
  watchOutcome = $hitKind
  seedOk       = $seedOk
  verdict      = $verdictKind
  recovered    = [bool] (Get-Field (Get-Field $verify 'verdict') 'recovered')
  backTo162    = [bool] (Get-Field (Get-Field $verify 'verdict') 'backTo162')
  dataIntact   = [bool] (Get-Field (Get-Field $verify 'verdict') 'dataIntact')
  copied       = $copied
  missing      = $missing
  scripts      = $scriptRows
}
$manifestPath = Join-Path $OutDir 'collect-manifest.json'
Write-TextFile $manifestPath (($summary | ConvertTo-Json -Depth 10) + "`r`n")

# ---------------------------------------------------------------------------------------------
# INDEX.md (ASCII)
# ---------------------------------------------------------------------------------------------
$sb = New-Object System.Text.StringBuilder
function Add-Line { param([string] $Line) [void] $sb.Append($Line + "`r`n") }

Add-Line '# S4 recovery drill evidence index (1.7.0 power-loss recovery)'
Add-Line ''
Add-Line ('- generated (UTC): ' + [DateTime]::UtcNow.ToString('o'))
Add-Line ('- guest result mapping: `' + $GuestResults + '`')
Add-Line ('- evidence directory: `' + $OutDir + '`')
Add-Line '- drill definition: `recovery-170-drill/README.md` (Chinese runbook)'
Add-Line ''
Add-Line '## Outcome'
Add-Line ''
Add-Line '| field | value |'
Add-Line '| --- | --- |'
Add-Line ('| watch outcome | ' + $hitKind + ' |')
Add-Line ('| seed result | ' + $(if ($seedOk) { 'ok' } else { 'not ok / missing' }) + ' |')
Add-Line ('| verify verdict | ' + $verdictKind + ' |')
Add-Line ('| recovered (journal rolledback + marker 1.6.2 + version 44.7.0) | ' + [string] $summary.recovered + ' |')
Add-Line ('| back to 1.6.2 | ' + [string] $summary.backTo162 + ' |')
Add-Line ('| business data equals the read only seed | ' + [string] $summary.dataIntact + ' |')
Add-Line ''
Add-Line 'A drill that fails is still evidence. Nothing in this directory has been repaired, re-run or'
Add-Line 'overwritten to look better, and no re-install was used in place of a real recovery. If the watch'
Add-Line 'outcome is `prepared-missed` or `prepared-timeout`, the round did NOT exercise the prepared state'
Add-Line 'and must not be reported as a successful recovery drill.'
Add-Line ''
Add-Line '## Files copied from the guest result mapping'
Add-Line ''
Add-Line '| file | kind | required | bytes | last write (UTC) | sha256 |'
Add-Line '| --- | --- | --- | --- | --- | --- |'
foreach ($row in $copied) {
  Add-Line ('| `' + $row.name + '` | ' + $row.kind + ' | ' + $(if ($row.required) { 'yes' } else { 'optional' }) + ' | ' + (Format-Bytes $row.bytes) + ' | ' + $row.lastWriteAt + ' | `' + $row.sha256 + '` |')
}
if ($copied.Count -eq 0) { Add-Line '| (nothing) | - | - | - | - | - |' }
Add-Line ''
Add-Line '## Required artefacts that are missing'
Add-Line ''
if ($missing.Count -eq 0) {
  Add-Line 'None. Every artefact the drill definition requires was found.'
} else {
  Add-Line '| file | kind | meaning |'
  Add-Line '| --- | --- | --- |'
  $meaning = @{
    'seed-result.json'    = 'seed step did not run or did not write its report'
    'seed.log'            = 'seed step did not log'
    'watch-trace.log'     = 'watcher never ran'
    'recover-verify.json' = 'post recovery collection did not run'
    'verify.log'          = 'post recovery collection did not log'
    'journal-prepared.json' = 'prepared window was not captured'
    'prepared-hit.json'     = 'prepared window was not captured'
  }
  foreach ($row in $missing) {
    $why = 'not produced in this round'
    if ($meaning.ContainsKey($row.name)) { $why = $meaning[$row.name] }
    Add-Line ('| `' + $row.name + '` | ' + $row.kind + ' | ' + $why + ' |')
  }
}
Add-Line ''
Add-Line '## Drill scripts used (copied to ./scripts)'
Add-Line ''
Add-Line '| file | bytes | sha256 |'
Add-Line '| --- | --- | --- |'
foreach ($row in $scriptRows) {
  Add-Line ('| `' + $row.name + '` | ' + (Format-Bytes $row.bytes) + ' | `' + $row.sha256 + '` |')
}
if ($scriptRows.Count -eq 0) { Add-Line '| (not copied; -NoScripts) | - | - |' }
Add-Line ''
Add-Line '## How to read this bundle'
Add-Line ''
Add-Line '1. `seed-result.json` proves what the guest disk contained before the upgrade: program tree,'
Add-Line '   data root, uninstall key, volume.'
Add-Line '2. `prepared-hit.json` plus `journal-prepared.json` prove the power cut landed while the native'
Add-Line '   transaction journal said `phase = prepared`, i.e. before the commit point.'
Add-Line '3. `recover-verify.json` proves what the next boot actually produced: journal phase, activation'
Add-Line '   marker, version file, program/data trees, leftover transaction directories, recovery logs.'
Add-Line '4. `collect-manifest.json` is the machine readable twin of this index.'
Add-Line ''

Write-TextFile (Join-Path $OutDir 'INDEX.md') ($sb.ToString())

Write-Output ('COLLECT-DONE ' + $copied.Count + ' ' + $missing.Count + ' verdict=' + $verdictKind + ' watch=' + $hitKind)
exit 0

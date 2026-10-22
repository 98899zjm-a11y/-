#requires -Version 5.1
<#
  03-verify-after.ps1  --  Windows Sandbox guest side, step 3 of the 1.7.0 power-loss recovery drill.

  Run this AFTER the recovery entry has been executed on the restarted sandbox. It only reads and
  reports; it never repairs, never re-installs and never touches the host production directories.

  Collected evidence -> C:\XjyResults\recover-verify.json
    * activation marker   xjy-install-activation.json (raw text + parsed + sha256)
    * engine version file  <install>\version          (raw text + sha256)
    * journal             phase / rollbackForbidden / runtimeWrites / transactionId / versions / paths
    * startup receipt     engine-startup-status.json  (parsed from its authenticated envelope)
    * install root        file count + byte count (+ top level entry count)
    * data root           file count + byte count (+ comparison against the read only seed)
    * transaction dirs    leftover .xjy-jewelry-offline.engine-stage-*/backup-*/failed-*
    * recovery logs       every *recover* / *restore* style log or txt under C:\XjyResults,
                          with the tail of each one (bounded)
    * still running       any process whose image lives inside the install root
    * verdict             one of ROLLED-BACK-162 | COMMITTED-170 | ROLLBACK-FAILED | NO-JOURNAL |
                          OTHER:<phase>

  Contract:
    * pure ASCII source, Chinese path segments built from Unicode code points.
    * a failed drill is still evidence: this script reports what is on disk, it never "repairs"
      the state so that the report looks better.
    * marker line: "VERIFY-DONE <verdict>".
#>

[CmdletBinding()]
param(
  [string] $ResultDir   = 'C:\XjyResults',
  [string] $InstallName = 'xjy-jewelry-offline',
  [string] $InstallRoot = '',
  [string] $InstallParent = '',
  [string] $StateDir    = '',
  [string] $DataRoot    = '',
  [string] $SeedProgram = 'C:\XjyResults\seedclean',
  [string] $SeedData    = 'C:\XjySeedData',
  [int]    $LogTailChars = 4000
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$script:Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function New-Text {
  param([int[]] $CodePoints)
  $sb = New-Object System.Text.StringBuilder
  foreach ($cp in $CodePoints) { [void] $sb.Append([char] $cp) }
  return $sb.ToString()
}

$Soft     = New-Text @(0x81EA, 0x5236, 0x8F6F, 0x4EF6)
$DataName = New-Text @(0x946B, 0x91D1, 0x6E90, 0x73E0, 0x5B9D, 0x8D44, 0x6599)
if ([string]::IsNullOrWhiteSpace($InstallParent)) { $InstallParent = 'F:\' + $Soft }
if ([string]::IsNullOrWhiteSpace($InstallRoot))   { $InstallRoot   = $InstallParent + '\' + $InstallName }
if ([string]::IsNullOrWhiteSpace($StateDir))      { $StateDir      = $InstallParent + '\.' + $InstallName + '.xjy-engine-state' }
if ([string]::IsNullOrWhiteSpace($DataRoot))      { $DataRoot      = 'F:\' + $DataName }

$MarkerPath = Join-Path $InstallRoot 'xjy-install-activation.json'
$VersionPath = Join-Path $InstallRoot 'version'
$JournalPath = Join-Path $StateDir 'journal.json'
$StatusPath  = Join-Path $StateDir 'engine-startup-status.json'
$OutPath     = Join-Path $ResultDir 'recover-verify.json'
$LogPath     = Join-Path $ResultDir 'verify.log'
$TxnPrefix   = '.' + $InstallName + '.engine-'

function Log {
  param([string] $Message)
  $line = ('{0:yyyy-MM-ddTHH:mm:ss.fffZ} {1}' -f [DateTime]::UtcNow, $Message)
  try { [System.IO.File]::AppendAllText($LogPath, $line + "`r`n", $script:Utf8NoBom) } catch { }
  Write-Output $line
}

function Write-JsonFile {
  param([string] $Path, [object] $Value)
  $json = $Value | ConvertTo-Json -Depth 12
  [System.IO.File]::WriteAllText($Path, $json + "`r`n", $script:Utf8NoBom)
}

function Get-Sha256Hex {
  param([byte[]] $Bytes)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { return ([System.BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-', '').ToLowerInvariant() }
  finally { $sha.Dispose() }
}

function Get-Sha256File {
  param([string] $Path)
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Read-BytesShared {
  param([string] $Path)
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  try {
    $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read,
      ([System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete))
    try {
      $ms = New-Object System.IO.MemoryStream
      $stream.CopyTo($ms)
      return $ms.ToArray()
    }
    finally { $stream.Dispose() }
  }
  catch { return $null }
}

function Read-TextShared {
  param([string] $Path)
  $bytes = Read-BytesShared $Path
  if ($null -eq $bytes) { return $null }
  return $script:Utf8NoBom.GetString($bytes)
}

# journal and startup receipt are both {"payload":"<json>","mac":"<hex>"} envelopes
function Get-EnvelopeRecord {
  param([string] $Text)
  if ($null -eq $Text -or $Text.Length -eq 0) { return $null }
  try {
    $outer = $Text | ConvertFrom-Json
    if ($null -ne $outer -and ($null -ne $outer.PSObject.Properties['payload']) -and ($outer.payload -is [string])) {
      return ($outer.payload | ConvertFrom-Json)
    }
    return $outer
  }
  catch { return $null }
}

function Get-Field {
  param([object] $Object, [string] $Name)
  if ($null -eq $Object) { return $null }
  $p = $Object.PSObject.Properties[$Name]
  if ($null -eq $p) { return $null }
  return $p.Value
}

function Get-TreeStats {
  param([string] $Path)
  if (-not (Test-Path -LiteralPath $Path)) {
    return [pscustomobject]@{ exists = $false; files = 0; bytes = [int64] 0; topLevel = 0 }
  }
  $files = 0
  $bytes = [int64] 0
  foreach ($f in [System.IO.Directory]::EnumerateFiles($Path, '*', [System.IO.SearchOption]::AllDirectories)) {
    $files = $files + 1
    $bytes = $bytes + (New-Object System.IO.FileInfo $f).Length
  }
  $top = [System.IO.Directory]::GetFileSystemEntries($Path).Length
  return [pscustomobject]@{ exists = $true; files = $files; bytes = $bytes; topLevel = $top }
}

function Get-TransactionDirs {
  param([string] $Parent, [string] $Prefix)
  $out = New-Object System.Collections.ArrayList
  if (-not (Test-Path -LiteralPath $Parent)) { return @() }
  foreach ($dir in [System.IO.Directory]::GetDirectories($Parent)) {
    $name = [System.IO.Path]::GetFileName($dir)
    if (-not $name.StartsWith($Prefix, [System.StringComparison]::OrdinalIgnoreCase)) { continue }
    $kind = 'other'
    if ($name -like '*.engine-stage-*')  { $kind = 'stage' }
    if ($name -like '*.engine-backup-*') { $kind = 'backup' }
    if ($name -like '*.engine-failed-*') { $kind = 'failed' }
    $stats = Get-TreeStats $dir
    [void] $out.Add([pscustomobject]@{ name = $name; kind = $kind; files = $stats.files; bytes = $stats.bytes })
  }
  return $out.ToArray()
}

function Get-RecoveryLogs {
  param([string] $Dir, [int] $TailChars)
  $out = New-Object System.Collections.ArrayList
  if (-not (Test-Path -LiteralPath $Dir)) { return @() }
  $patterns = @('*recover*.log', '*recover*.txt', '*restore*.log', '*restore*.txt', 'startup-*.log', 'startup-*.txt')
  $seen = @{}
  foreach ($pattern in $patterns) {
    foreach ($file in [System.IO.Directory]::GetFiles($Dir, $pattern)) {
      $lower = $file.ToLowerInvariant()
      if ($seen.ContainsKey($lower)) { continue }
      $seen[$lower] = $true
      $info = New-Object System.IO.FileInfo $file
      $text = Read-TextShared $file
      $tail = ''
      if ($null -ne $text) { if ($text.Length -gt $TailChars) { $tail = $text.Substring($text.Length - $TailChars) } else { $tail = $text } }
      [void] $out.Add([pscustomobject]@{
        name        = $info.Name
        bytes       = $info.Length
        lastWriteAt = $info.LastWriteTimeUtc.ToString('o')
        sha256      = (Get-Sha256File $file)
        tail        = $tail
      })
    }
  }
  return $out.ToArray()
}

function Get-InstallProcesses {
  param([string] $Root)
  $out = New-Object System.Collections.ArrayList
  if (-not (Test-Path -LiteralPath $Root)) { return @() }
  $prefix = $Root.TrimEnd('\') + '\'
  try {
    foreach ($p in Get-CimInstance -ClassName Win32_Process -ErrorAction Stop) {
      if ($null -eq $p.ExecutablePath) { continue }
      if ($p.ExecutablePath.ToLowerInvariant().StartsWith($prefix.ToLowerInvariant())) {
        [void] $out.Add([pscustomobject]@{ pid = $p.ProcessId; name = $p.Name; executablePath = $p.ExecutablePath })
      }
    }
  }
  catch { }
  return $out.ToArray()
}

# ---------------------------------------------------------------------------------------------
# collect
# ---------------------------------------------------------------------------------------------
Log ('verify start installRoot=' + $InstallRoot + ' dataRoot=' + $DataRoot + ' stateDir=' + $StateDir)

$result = [ordered]@{
  schema      = 'xjy-recovery-drill-verify/1'
  collectedAt = [DateTime]::UtcNow.ToString('o')
  host        = $env:COMPUTERNAME
  user        = $env:USERNAME
  paths       = [ordered]@{
    installRoot = $InstallRoot; installParent = $InstallParent; dataRoot = $DataRoot
    stateDir = $StateDir; journal = $JournalPath; marker = $MarkerPath; version = $VersionPath
  }
}

# ---- marker + version ----------------------------------------------------------------------
$markerText = Read-TextShared $MarkerPath
$marker = $null
if ($null -ne $markerText) { try { $marker = $markerText.Trim() | ConvertFrom-Json } catch { $marker = $null } }
$versionText = Read-TextShared $VersionPath
if ($null -ne $versionText) { $versionText = $versionText.Trim() }
$result.marker = [ordered]@{
  present          = ($null -ne $markerText)
  path             = $MarkerPath
  raw              = $markerText
  programVersion   = (Get-Field $marker 'programVersion')
  product          = (Get-Field $marker 'product')
  role             = (Get-Field $marker 'role')
  installationDir  = (Get-Field $marker 'installationDir')
  sha256           = (Get-Sha256File $MarkerPath)
}
$result.version = [ordered]@{
  present = ($null -ne $versionText)
  path    = $VersionPath
  raw     = $versionText
  sha256  = (Get-Sha256File $VersionPath)
}

# ---- journal -------------------------------------------------------------------------------
$journalBytes = Read-BytesShared $JournalPath
$journalText = $null
if ($null -ne $journalBytes) { $journalText = $script:Utf8NoBom.GetString($journalBytes) }
$journal = Get-EnvelopeRecord $journalText
$journalPhase = $null
if ($null -ne $journal) { $journalPhase = Get-Field $journal 'phase' }
if ($null -eq $journalPhase -and $null -ne $journalText) {
  $m = [regex]::Match($journalText, '"phase"\s*:\s*"([A-Za-z][A-Za-z0-9-]*)"')
  if ($m.Success) { $journalPhase = $m.Groups[1].Value }
}
$journalPaths = Get-Field $journal 'paths'
$result.journal = [ordered]@{
  present            = ($null -ne $journalBytes)
  path               = $JournalPath
  bytes              = $(if ($null -eq $journalBytes) { 0 } else { $journalBytes.Length })
  sha256             = $(if ($null -eq $journalBytes) { $null } else { Get-Sha256Hex $journalBytes })
  phase              = $journalPhase
  transactionId      = (Get-Field $journal 'transactionId')
  sourceVersion      = (Get-Field $journal 'sourceVersion')
  targetVersion      = (Get-Field $journal 'targetVersion')
  role               = (Get-Field $journal 'role')
  runtimeWrites      = (Get-Field $journal 'runtimeWrites')
  rollbackForbidden  = (Get-Field $journal 'rollbackForbidden')
  stageDir           = (Get-Field $journal 'stageDir')
  backupDir          = (Get-Field $journal 'backupDir')
  failedDir          = (Get-Field $journal 'failedDir')
  dataDir            = (Get-Field $journalPaths 'dataDir')
  profileDir         = (Get-Field $journalPaths 'profileDir')
  stateDir           = (Get-Field $journalPaths 'stateDir')
}

# ---- startup receipt (only 1.7.0 writes it; stale after a rollback is expected) -------------
$statusText = Read-TextShared $StatusPath
$status = Get-EnvelopeRecord $statusText
$result.startupStatus = [ordered]@{
  present           = ($null -ne $statusText)
  path              = $StatusPath
  phase             = (Get-Field $status 'phase')
  programVersion    = (Get-Field $status 'programVersion')
  engineVersion     = (Get-Field $status 'engineVersion')
  rollbackForbidden = (Get-Field $status 'rollbackForbidden')
  transactionId     = (Get-Field $status 'transactionId')
  journalSha256     = (Get-Field $status 'journalSha256')
  businessReleased  = (Get-Field $status 'businessReleased')
  staleNote         = 'written by the 1.7.0 start path only; after a rollback it may still describe the aborted transaction, that is expected and is itself evidence'
}

# ---- trees ---------------------------------------------------------------------------------
$installCounts = Get-TreeStats $InstallRoot
$dataCounts    = Get-TreeStats $DataRoot
$seedProgramCounts = Get-TreeStats $SeedProgram
$seedDataCounts    = Get-TreeStats $SeedData
$result.installRoot = [ordered]@{
  path          = $InstallRoot
  exists        = $installCounts.exists
  files         = $installCounts.files
  bytes         = $installCounts.bytes
  topLevel      = $installCounts.topLevel
  seedFiles     = $seedProgramCounts.files
  seedBytes     = $seedProgramCounts.bytes
  matchesSeed   = ($seedProgramCounts.exists -and $installCounts.files -eq $seedProgramCounts.files -and $installCounts.bytes -eq $seedProgramCounts.bytes)
}
$result.dataRoot = [ordered]@{
  path          = $DataRoot
  exists        = $dataCounts.exists
  files         = $dataCounts.files
  bytes         = $dataCounts.bytes
  topLevel      = $dataCounts.topLevel
  seedFiles     = $seedDataCounts.files
  seedBytes     = $seedDataCounts.bytes
  matchesSeed   = ($seedDataCounts.exists -and $dataCounts.files -eq $seedDataCounts.files -and $dataCounts.bytes -eq $seedDataCounts.bytes)
}
$result.transactionDirs = @(Get-TransactionDirs $InstallParent $TxnPrefix)
$result.recoveryLogs = @(Get-RecoveryLogs $ResultDir $LogTailChars)
$result.runningFromInstall = @(Get-InstallProcesses $InstallRoot)

# ---- verdict -------------------------------------------------------------------------------
$backTo162 = (($null -ne $result.marker.programVersion) -and ([string] $result.marker.programVersion -eq '1.6.2') -and ($null -ne $versionText) -and ($versionText -eq '44.7.0'))
$still170  = (($null -ne $result.marker.programVersion) -and ([string] $result.marker.programVersion -eq '1.7.0') -and ($null -ne $versionText) -and ($versionText -eq '44.9.0'))
$verdict = 'OTHER:' + [string] $journalPhase
if ($null -eq $journalBytes) { $verdict = 'NO-JOURNAL' }
elseif ($journalPhase -eq 'rolledback' -and $backTo162) { $verdict = 'ROLLED-BACK-162' }
elseif ($journalPhase -eq 'rolledback' -and $still170)  { $verdict = 'OTHER:rolledback-but-1.7.0-on-disk' }
elseif ($journalPhase -eq 'committed' -and $still170)   { $verdict = 'COMMITTED-170' }
elseif ($journalPhase -eq 'committed' -and $backTo162)  { $verdict = 'OTHER:committed-but-1.6.2-on-disk' }
elseif ($journalPhase -eq 'rollback-failed')            { $verdict = 'ROLLBACK-FAILED' }

$result.verdict = [ordered]@{
  verdict              = $verdict
  journalPhase         = $journalPhase
  backTo162            = $backTo162
  still170             = $still170
  installMatchesSeed   = $result.installRoot.matchesSeed
  dataMatchesSeed      = $result.dataRoot.matchesSeed
  rollbackForbidden    = $result.journal.rollbackForbidden
  recovered            = ($verdict -eq 'ROLLED-BACK-162')
  installIntact162     = ($verdict -eq 'ROLLED-BACK-162' -and $result.installRoot.matchesSeed)
  dataIntact           = $result.dataRoot.matchesSeed
  notes                = 'recovered means: journal phase rolledback AND marker says 1.6.2 AND version file says 44.7.0. Seed tree equality is reported separately because the program tree legitimately keeps identical bytes to the seed only when the rollback restored it exactly.'
}

Write-JsonFile $OutPath $result
Log ('recover-verify.json written verdict=' + $verdict + ' backTo162=' + $backTo162 + ' dataMatchesSeed=' + $result.dataRoot.matchesSeed)
Log ('VERIFY-DONE ' + $verdict)
exit 0

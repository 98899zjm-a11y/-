#requires -Version 5.1
<#
  02-watch-prepared.ps1  --  Windows Sandbox guest side, step 2 of the 1.7.0 power-loss recovery drill.

  Job: sit next to a running upgrade and catch the short window in which the native transaction
  journal says phase = "prepared". The moment that state is seen:

    1. copy journal.json byte for byte          -> C:\XjyResults\journal-prepared.json
    2. list the transaction directories under   -> F:\<soft>\.xjy-jewelry-offline.engine-*
       (stage / backup / failed) with file count, byte count and newest write time
    3. write C:\XjyResults\prepared-hit.json    -> the host then stops the sandbox immediately
    4. exit 0

  Other exits:
    C:\XjyResults\prepared-missed.json   journal reached phase "committed" (or any non-prepared
                                         terminal phase) before "prepared" was observed.
                                         The power cut would land AFTER the commit point, the
                                         drill round is INVALID, do not report it as success.
    C:\XjyResults\prepared-timeout.json  no journal activity at all for the whole timeout.

  Facts this script relies on (measured, do not "fix" them):
    * engine state dir  = <install parent>\.<install dir name>.xjy-engine-state
                          = F:\<soft>\.xjy-jewelry-offline.xjy-engine-state
                          (sibling of the install dir, NOT inside it)
    * journal file      = <state dir>\journal.json
    * journal on disk   = {"payload":"<json record>","mac":"<hex>"}  (HMAC-SHA256 envelope)
                          sometimes a plain json record is observed too -> handle both, plus a
                          last resort regex on "phase":"..."
    * transaction dirs  = <install parent>\.xjy-jewelry-offline.engine-stage-<uuid>
                          <install parent>\.xjy-jewelry-offline.engine-backup-<uuid>
                          <install parent>\.xjy-jewelry-offline.engine-failed-<uuid>

  Contract:
    * pure ASCII source, Chinese path segments built from Unicode code points.
    * read only: this script never writes to F: and never blocks the upgrade worker.
    * marker lines: "WATCH-END <kind>" where kind is prepared | missed | timeout.
#>

[CmdletBinding()]
param(
  [string] $ResultDir      = 'C:\XjyResults',
  [int]    $TimeoutMinutes = 40,
  [int]    $PollMs         = 500,
  [string] $InstallParent  = '',
  [string] $InstallName    = 'xjy-jewelry-offline',
  [string] $StateDir       = '',
  [switch] $DoNotExitOnCommitted
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

$Soft = New-Text @(0x81EA, 0x5236, 0x8F6F, 0x4EF6)   # zi zhi ruan jian
if ([string]::IsNullOrWhiteSpace($InstallParent)) { $InstallParent = 'F:\' + $Soft }
if ([string]::IsNullOrWhiteSpace($StateDir)) {
  $StateDir = $InstallParent + '\.' + $InstallName + '.xjy-engine-state'
}

$journalPath = Join-Path $StateDir 'journal.json'
$tracePath   = Join-Path $ResultDir 'watch-trace.log'
$preparedOut = Join-Path $ResultDir 'journal-prepared.json'
$hitPath     = Join-Path $ResultDir 'prepared-hit.json'
$missPath    = Join-Path $ResultDir 'prepared-missed.json'
$timeoutPath = Join-Path $ResultDir 'prepared-timeout.json'
$statusPath  = Join-Path $StateDir 'engine-startup-status.json'
$txnPrefix   = '.' + $InstallName + '.engine-'

function Log {
  param([string] $Message)
  $line = ('{0:yyyy-MM-ddTHH:mm:ss.fffZ} {1}' -f [DateTime]::UtcNow, $Message)
  try { [System.IO.File]::AppendAllText($tracePath, $line + "`r`n", $script:Utf8NoBom) } catch { }
  Write-Output $line
}

function Write-JsonFile {
  param([string] $Path, [object] $Value)
  $json = $Value | ConvertTo-Json -Depth 10
  [System.IO.File]::WriteAllText($Path, $json + "`r`n", $script:Utf8NoBom)
}

function Get-Sha256Hex {
  param([byte[]] $Bytes)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { return ([System.BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-', '').ToLowerInvariant() }
  finally { $sha.Dispose() }
}

# The upgrade worker keeps the journal open only for the duration of an atomic rename, but be
# tolerant anyway: share read/write/delete and retry a few times.
function Read-JournalBytes {
  param([string] $Path)
  for ($i = 0; $i -lt 6; $i++) {
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
    catch [System.IO.IOException] { Start-Sleep -Milliseconds 100 }
    catch [System.UnauthorizedAccessException] { Start-Sleep -Milliseconds 100 }
  }
  return $null
}

function Get-JournalPhase {
  param([byte[]] $Bytes)
  $text = $script:Utf8NoBom.GetString($Bytes)
  $record = $null
  try {
    $outer = $text | ConvertFrom-Json
    if ($null -ne $outer -and ($null -ne $outer.PSObject.Properties['payload']) -and ($outer.payload -is [string])) {
      $record = $outer.payload | ConvertFrom-Json
    } else {
      $record = $outer
    }
  }
  catch { $record = $null }
  if ($null -ne $record) {
    $p = $record.PSObject.Properties['phase']
    if ($null -ne $p -and $null -ne $p.Value) { return [string] $p.Value }
  }
  $m = [regex]::Match($text, '"phase"\s*:\s*"([A-Za-z][A-Za-z0-9-]*)"')
  if ($m.Success) { return $m.Groups[1].Value }
  return 'unreadable'
}

function Get-JournalRecord {
  param([byte[]] $Bytes)
  $text = $script:Utf8NoBom.GetString($Bytes)
  try {
    $outer = $text | ConvertFrom-Json
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
  $files = 0
  $bytes = [int64] 0
  $newest = $null
  if (Test-Path -LiteralPath $Path) {
    foreach ($f in [System.IO.Directory]::EnumerateFiles($Path, '*', [System.IO.SearchOption]::AllDirectories)) {
      $files = $files + 1
      $info = New-Object System.IO.FileInfo $f
      $bytes = $bytes + $info.Length
      if ($null -eq $newest -or $info.LastWriteTimeUtc -gt $newest) { $newest = $info.LastWriteTimeUtc }
    }
  }
  return [pscustomobject]@{
    path          = $Path
    exists        = (Test-Path -LiteralPath $Path)
    files         = $files
    bytes         = $bytes
    newestWriteAt = $(if ($null -eq $newest) { $null } else { $newest.ToString('o') })
  }
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
    [void] $out.Add([pscustomobject]@{
      name          = $name
      kind          = $kind
      files         = $stats.files
      bytes         = $stats.bytes
      newestWriteAt = $stats.newestWriteAt
    })
  }
  return $out.ToArray()
}

function Get-StateFiles {
  param([string] $StateDir)
  $out = New-Object System.Collections.ArrayList
  if (-not (Test-Path -LiteralPath $StateDir)) { return @() }
  foreach ($file in [System.IO.Directory]::GetFiles($StateDir)) {
    $info = New-Object System.IO.FileInfo $file
    [void] $out.Add([pscustomobject]@{
      name          = $info.Name
      bytes         = $info.Length
      lastWriteAt   = $info.LastWriteTimeUtc.ToString('o')
    })
  }
  return $out.ToArray()
}

# ---------------------------------------------------------------------------------------------
# watch loop
# ---------------------------------------------------------------------------------------------
$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
$deadline  = (Get-Date).AddMinutes($TimeoutMinutes)
$pollCount = 0
$phases    = New-Object System.Collections.ArrayList
$lastPhase = ''
$firstSeen = $null
$lastSeen  = $null
$kind      = 'timeout'

Log ('watch start journal=' + $journalPath + ' timeoutMinutes=' + $TimeoutMinutes + ' pollMs=' + $PollMs)

while ((Get-Date) -lt $deadline) {
  $pollCount = $pollCount + 1
  $bytes = Read-JournalBytes $journalPath
  if ($null -ne $bytes -and $bytes.Length -gt 0) {
    $phase = Get-JournalPhase $bytes
    if ($null -eq $firstSeen) { $firstSeen = [DateTime]::UtcNow }
    $lastSeen = [DateTime]::UtcNow
    if ($phase -ne $lastPhase) {
      $lastPhase = $phase
      [void] $phases.Add([pscustomobject]@{ at = [DateTime]::UtcNow.ToString('o'); phase = $phase; journalBytes = $bytes.Length })
      Log ('phase=' + $phase + ' journalBytes=' + $bytes.Length)
    }

    if ($phase -eq 'prepared') {
      $kind = 'prepared'
      $record = Get-JournalRecord $bytes
      $sha = Get-Sha256Hex $bytes
      # 1. byte exact copy of the authenticated journal
      [System.IO.File]::WriteAllBytes($preparedOut, $bytes)
      $copyBytes = [System.IO.File]::ReadAllBytes($preparedOut)
      $copySha = Get-Sha256Hex $copyBytes
      Log ('journal copied to ' + $preparedOut + ' bytes=' + $copyBytes.Length + ' sha256=' + $copySha + ' identical=' + ($copySha -eq $sha))
      # 2. transaction directories and the state banner
      $txns = @(Get-TransactionDirs $InstallParent $txnPrefix)
      foreach ($t in $txns) { Log ('txn ' + $t.kind + ' ' + $t.name + ' files=' + $t.files + ' bytes=' + $t.bytes) }
      $stateFiles = @(Get-StateFiles $StateDir)
      # 3. hit record (written last: the host polls for this file)
      Write-JsonFile $hitPath ([ordered]@{
        schema           = 'xjy-recovery-drill-prepared-hit/1'
        kind             = 'prepared'
        hitAtUtc         = [DateTime]::UtcNow.ToString('o')
        installParent    = $InstallParent
        installName      = $InstallName
        stateDir         = $StateDir
        journalPath      = $journalPath
        journalBytes     = $bytes.Length
        journalSha256    = $sha
        journalCopyPath  = $preparedOut
        journalCopyBytes = $copyBytes.Length
        journalCopySha256= $copySha
        journalCopyExact = ($copySha -eq $sha)
        pollCount        = $pollCount
        elapsedSeconds   = [math]::Round($stopwatch.Elapsed.TotalSeconds, 3)
        timeoutMinutes   = $TimeoutMinutes
        journal          = [ordered]@{
          transactionId     = (Get-Field $record 'transactionId')
          phase             = (Get-Field $record 'phase')
          sourceVersion     = (Get-Field $record 'sourceVersion')
          targetVersion     = (Get-Field $record 'targetVersion')
          role              = (Get-Field $record 'role')
          runtimeWrites     = (Get-Field $record 'runtimeWrites')
          rollbackForbidden = (Get-Field $record 'rollbackForbidden')
          stageDir          = (Get-Field $record 'stageDir')
          backupDir         = (Get-Field $record 'backupDir')
          failedDir         = (Get-Field $record 'failedDir')
        }
        transactionDirs  = $txns
        stateFiles       = $stateFiles
      })
      Log 'prepared-hit.json written'
      break
    }

    if (-not $DoNotExitOnCommitted -and $phase -ne 'prepared' -and $phase -ne 'unreadable' -and $phase -ne 'prepared-pending') {
      # anything that is not a pre-commit phase means the window has already been left
      $kind = 'missed'
      Write-JsonFile $missPath ([ordered]@{
        schema         = 'xjy-recovery-drill-prepared-missed/1'
        kind           = 'missed'
        endedAtUtc     = [DateTime]::UtcNow.ToString('o')
        observedPhase  = $phase
        reason         = 'journal left the pre-commit phases before phase=prepared was observed; the power cut would land after the commit point, this drill round is invalid'
        pollCount      = $pollCount
        elapsedSeconds = [math]::Round($stopwatch.Elapsed.TotalSeconds, 3)
        phases         = $phases
        journalBytes   = $bytes.Length
        journalSha256  = (Get-Sha256Hex $bytes)
      })
      Log ('prepared-missed.json written observedPhase=' + $phase)
      break
    }
  }

  Start-Sleep -Milliseconds $PollMs
}

if ($kind -eq 'timeout') {
  $statusBytes = $null
  if (Test-Path -LiteralPath $statusPath) { $statusBytes = Read-JournalBytes $statusPath }
  Write-JsonFile $timeoutPath ([ordered]@{
    schema         = 'xjy-recovery-drill-prepared-timeout/1'
    kind           = 'timeout'
    endedAtUtc     = [DateTime]::UtcNow.ToString('o')
    installParent  = $InstallParent
    stateDir       = $StateDir
    journalPath    = $journalPath
    journalPresent = (Test-Path -LiteralPath $journalPath)
    lastPhase      = $lastPhase
    firstSeenAtUtc = $(if ($null -eq $firstSeen) { $null } else { $firstSeen.ToString('o') })
    lastSeenAtUtc  = $(if ($null -eq $lastSeen) { $null } else { $lastSeen.ToString('o') })
    pollCount      = $pollCount
    timeoutMinutes = $TimeoutMinutes
    elapsedSeconds = [math]::Round($stopwatch.Elapsed.TotalSeconds, 3)
    phases         = $phases
    startupStatusPresent = ($null -ne $statusBytes)
  })
  Log 'prepared-timeout.json written'
}

Log ('WATCH-END ' + $kind)
exit 0

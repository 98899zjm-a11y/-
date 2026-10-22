<#
.SYNOPSIS
  S4 power-cut drill: guest-side journal phase watcher (READ-ONLY on the install tree).

.DESCRIPTION
  Polls <InstallRoot>\.program.xjy-engine-state\journal.json until the engine
  transaction reaches phase "prepared".  On the first observation of
  "prepared" it:

    1. records the observation time,
    2. copies journal.json byte-for-byte to <ResultsDir>\journal-prepared.json,
    3. enumerates every .program.engine-stage-* directory (file count + bytes),
    4. writes <ResultsDir>\phase-prepared.json,
    5. EXITS (exit code 0).

  This script NEVER stops the sandbox, NEVER kills a process, NEVER writes
  inside the install tree.  Stopping the machine is the host-side operator's
  job (wsb stop --id <id>), see README.md.

  On timeout it writes <ResultsDir>\phase-timeout.json and exits with code 2.
  If the transaction advances past "prepared" before the first poll sees it,
  it writes <ResultsDir>\phase-missed.json and exits with code 3.

  Journal shape (engine-tree-runtime170.cjs):
      { "payload": "<JSON string>", "mac": "..." }
  and the payload string carries  ...,"phase":"prepared",...

.NOTES
  ASCII-ONLY ON PURPOSE: Windows PowerShell 5.1 decodes a BOM-less UTF-8 file
  as ANSI, so every Chinese literal is rebuilt at run time from code points
  through New-Text.  Do not paste raw CJK characters into this file.

  PS 5.1 compatible.  Exit codes: 0 prepared, 2 timeout, 3 missed window, 1 error.

.EXAMPLE
  powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File C:\XjyResults\watch-phase.ps1
#>
[CmdletBinding()]
param(
  # Product install root.  Empty = F:\<install-dir>\xjy-jewelry-offline
  [string] $InstallRoot = '',

  # Shared host/guest results folder (mapped rw from the host).
  [string] $ResultsDir = 'C:\XjyResults',

  # Give up after this many minutes.
  [int] $TimeoutMinutes = 40,

  # Poll interval in seconds.
  [int] $PollSeconds = 2
)

$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Chinese text rebuilt from code points (ASCII-only source file).
# ---------------------------------------------------------------------------
function New-Text {
  param([int[]] $CodePoints)
  $sb = New-Object System.Text.StringBuilder
  foreach ($cp in $CodePoints) { [void]$sb.Append([char]$cp) }
  return $sb.ToString()
}

if ([string]::IsNullOrWhiteSpace($InstallRoot)) {
  $InstallRoot = 'F:\' + ((New-Text @(0x81EA,0x5236,0x8F6F,0x4EF6))) + '\xjy-jewelry-offline'
}

$StateName    = '.program.xjy-engine-state'
$StageGlob    = '.program.engine-stage-*'
$JournalName  = 'journal.json'

$StateDir     = Join-Path $InstallRoot $StateName
$JournalPath  = Join-Path $StateDir $JournalName

$PreparedJson = Join-Path $ResultsDir 'phase-prepared.json'
$TimeoutJson  = Join-Path $ResultsDir 'phase-timeout.json'
$MissedJson   = Join-Path $ResultsDir 'phase-missed.json'
$ErrorJson    = Join-Path $ResultsDir 'phase-watch-error.json'
$JournalCopy  = Join-Path $ResultsDir 'journal-prepared.json'
$WatchLog     = Join-Path $ResultsDir 'phase-watch.log'

$Utf8NoBom    = New-Object System.Text.UTF8Encoding($false)

# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------
function Write-JsonFile {
  param([string] $Path, $Object)
  $json = $Object | ConvertTo-Json -Depth 8
  [System.IO.File]::WriteAllText($Path, $json, $Utf8NoBom)
}

function Add-WatchLog {
  param([string] $Line)
  try {
    $stamp = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ss.fffzzz')
    $enc   = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::AppendAllText($WatchLog, ('[' + $stamp + '] ' + $Line + [Environment]::NewLine), $enc)
  } catch {
    # logging must never break the watcher
  }
}

function Get-Stamp {
  return (Get-Date).ToString('yyyy-MM-ddTHH:mm:ss.fffzzz')
}

# Read the journal with a shared-read handle so a concurrent replace by the
# engine cannot turn into a hard failure.  Returns bytes or $null.
function Read-JournalBytes {
  param([string] $Path, [int] $Attempts = 5)

  $lastError = ''
  for ($i = 1; $i -le $Attempts; $i++) {
    $fs = $null
    try {
      if (-not (Test-Path -LiteralPath $Path)) { return $null }
      $share = [System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete
      $fs = New-Object System.IO.FileStream -ArgumentList @(
        $Path,
        [System.IO.FileMode]::Open,
        [System.IO.FileAccess]::Read,
        [System.IO.FileShare]$share
      )
      $ms = New-Object System.IO.MemoryStream
      try {
        $fs.CopyTo($ms)
        $bytes = $ms.ToArray()
      } finally {
        $ms.Dispose()
      }
      if ($null -ne $bytes -and $bytes.Length -gt 0) { return $bytes }
      $lastError = 'empty-read'
    } catch {
      $lastError = $_.Exception.Message
    } finally {
      if ($null -ne $fs) { $fs.Dispose() }
    }
    Start-Sleep -Milliseconds 150
  }
  if ($lastError -ne '') { Add-WatchLog ('journal read failed: ' + $lastError) }
  return $null
}

# Pull the interesting fields out of the journal envelope.  Envelope:
#   { "payload": "<json string>", "mac": "..." }
# Fallbacks keep working even if the file is briefly truncated mid-write.
function Get-JournalInfo {
  param([string] $Raw)

  $info = [ordered]@{
    parseMethod   = 'none'
    phase         = ''
    transactionId = ''
    purpose       = ''
    role          = ''
    sourceVersion = ''
    targetVersion = ''
    rollbackForbidden = ''
    runtimeWrites     = ''
    parseError    = ''
  }

  if ([string]::IsNullOrWhiteSpace($Raw)) {
    $info.parseError = 'empty'
    return $info
  }

  $outer = $null
  try {
    $outer = $Raw | ConvertFrom-Json -ErrorAction Stop
  } catch {
    $info.parseError = $_.Exception.Message
  }

  $payloadText = ''
  $inner       = $null

  if ($null -ne $outer) {
    $p = $null
    try { $p = $outer.payload } catch { $p = $null }
    if ($p -is [string]) {
      $payloadText = [string]$p
    } else {
      # Defensive: a flat (non-enveloped) journal.
      $names = @()
      try { $names = @($outer.PSObject.Properties.Name) } catch { $names = @() }
      if ($names -contains 'phase') {
        $info.parseMethod = 'flat-json'
        $info.phase = [string]$outer.phase
        if ($names -contains 'transactionId') { $info.transactionId = [string]$outer.transactionId }
        if ($names -contains 'purpose')       { $info.purpose = [string]$outer.purpose }
        if ($names -contains 'role')          { $info.role = [string]$outer.role }
        if ($names -contains 'sourceVersion') { $info.sourceVersion = [string]$outer.sourceVersion }
        if ($names -contains 'targetVersion') { $info.targetVersion = [string]$outer.targetVersion }
        if ($names -contains 'rollbackForbidden') { $info.rollbackForbidden = $outer.rollbackForbidden }
        if ($names -contains 'runtimeWrites')     { $info.runtimeWrites = $outer.runtimeWrites }
        return $info
      }
    }
  }

  if (-not [string]::IsNullOrEmpty($payloadText)) {
    try {
      $inner = $payloadText | ConvertFrom-Json -ErrorAction Stop
      if ($null -ne $inner) {
        $info.parseMethod = 'inner-json'
        $ip = @($inner.PSObject.Properties.Name)
        if ($ip -contains 'phase')         { $info.phase = [string]$inner.phase }
        if ($ip -contains 'transactionId') { $info.transactionId = [string]$inner.transactionId }
        if ($ip -contains 'purpose')       { $info.purpose = [string]$inner.purpose }
        if ($ip -contains 'role')          { $info.role = [string]$inner.role }
        if ($ip -contains 'sourceVersion') { $info.sourceVersion = [string]$inner.sourceVersion }
        if ($ip -contains 'targetVersion') { $info.targetVersion = [string]$inner.targetVersion }
        if ($ip -contains 'rollbackForbidden') { $info.rollbackForbidden = $inner.rollbackForbidden }
        if ($ip -contains 'runtimeWrites')     { $info.runtimeWrites = $inner.runtimeWrites }
        if (-not [string]::IsNullOrEmpty($info.phase)) { return $info }
      }
    } catch {
      if ($info.parseError -eq '') { $info.parseError = 'payload: ' + $_.Exception.Message }
    }
  }

  # Last resort: regex over the de-escaped text.  Phase values are [a-z-] only.
  $flat = ''
  if (-not [string]::IsNullOrEmpty($payloadText)) { $flat = $payloadText } else { $flat = $Raw }
  $flat = $flat.Replace('\', '')
  $info.parseMethod = 'regex'

  $patterns = @{
    phase         = '"phase"\s*:\s*"([A-Za-z0-9._-]+)"'
    transactionId = '"transactionId"\s*:\s*"([A-Za-z0-9._-]+)"'
    purpose       = '"purpose"\s*:\s*"([A-Za-z0-9._-]+)"'
    role          = '"role"\s*:\s*"([A-Za-z0-9._-]+)"'
    sourceVersion = '"sourceVersion"\s*:\s*"([A-Za-z0-9._-]+)"'
    targetVersion = '"targetVersion"\s*:\s*"([A-Za-z0-9._-]+)"'
  }
  foreach ($key in $patterns.Keys) {
    $m = [regex]::Match($flat, $patterns[$key])
    if ($m.Success -and [string]::IsNullOrEmpty($info[$key])) { $info[$key] = $m.Groups[1].Value }
  }
  return $info
}

# Enumerate the stage directories left by a prepared transaction, fully
# read-only.  Never touches or removes anything.
function Get-StageReport {
  param([string] $Root)

  $dirs = New-Object System.Collections.ArrayList
  if (-not (Test-Path -LiteralPath $Root)) {
    return @{ dirs = @(); dirCount = 0; fileCount = 0; bytes = 0; scanError = 'install-root-missing' }
  }

  $scanError  = ''
  $stageDirs  = @()
  try {
    $stageDirs = @(Get-ChildItem -LiteralPath $Root -Directory -Force -ErrorAction Stop |
                   Where-Object { $_.Name -like $StageGlob })
  } catch {
    $scanError = $_.Exception.Message
  }

  $totalFiles = 0
  $totalBytes = [int64]0

  foreach ($d in $stageDirs) {
    $fileCount = 0
    $byteCount = [int64]0
    $err       = ''
    try {
      $files = @(Get-ChildItem -LiteralPath $d.FullName -Recurse -File -Force -ErrorAction SilentlyContinue)
      $fileCount = $files.Count
      foreach ($f in $files) { $byteCount += [int64]$f.Length }
    } catch {
      $err = $_.Exception.Message
    }
    $totalFiles += $fileCount
    $totalBytes += $byteCount
    [void]$dirs.Add([ordered]@{
      name      = $d.Name
      path      = $d.FullName
      fileCount = $fileCount
      bytes     = $byteCount
      lastWrite = $d.LastWriteTime.ToString('yyyy-MM-ddTHH:mm:ss.fffzzz')
      scanError = $err
    })
  }

  return @{
    dirs      = @($dirs)
    dirCount  = $stageDirs.Count
    fileCount = $totalFiles
    bytes     = $totalBytes
    scanError = $scanError
  }
}

function Get-Sha256Hex {
  param([byte[]] $Bytes)
  if ($null -eq $Bytes) { return '' }
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $hash = $sha.ComputeHash($Bytes)
  } finally {
    $sha.Dispose()
  }
  $sb = New-Object System.Text.StringBuilder
  foreach ($b in $hash) { [void]$sb.Append($b.ToString('x2')) }
  return $sb.ToString()
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
$startedAt = Get-Date
$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()

if (-not (Test-Path -LiteralPath $ResultsDir)) {
  New-Item -ItemType Directory -Path $ResultsDir -Force | Out-Null
}

Add-WatchLog ('watcher start; installRoot=' + $InstallRoot + ' journal=' + $JournalPath +
              ' timeoutMinutes=' + $TimeoutMinutes + ' pollSeconds=' + $PollSeconds)

$history  = New-Object System.Collections.ArrayList
$polled   = 0
$lastInfo = $null
$hit      = $false
$lastRaw  = $null
$lastBytes = $null

try {
  while (-not $hit) {

    if ($stopwatch.Elapsed.TotalMinutes -ge $TimeoutMinutes) { break }

    $polled++

    $bytes = Read-JournalBytes -Path $JournalPath
    if ($null -eq $bytes) {
      if ($polled % 30 -eq 1) { Add-WatchLog ('poll ' + $polled + ': journal not readable yet') }
      Start-Sleep -Seconds $PollSeconds
      continue
    }

    $raw  = [System.Text.Encoding]::UTF8.GetString($bytes)
    $raw  = $raw.TrimStart([char]0xFEFF)
    $info = Get-JournalInfo -Raw $raw

    $lastRaw   = $raw
    $lastBytes = $bytes
    $lastInfo  = $info

    $entry = [ordered]@{
      at         = (Get-Stamp)
      poll       = $polled
      phase      = $info.phase
      bytes      = $bytes.Length
      sha256     = (Get-Sha256Hex -Bytes $bytes)
      parseMethod = $info.parseMethod
    }
    [void]$history.Add($entry)

    if ($info.phase -eq 'prepared') { $hit = $true; break }

    # The window was skipped between two polls: report it instead of silently
    # waiting for a phase that will never come back.
    if ($info.phase -in @('old-renamed', 'new-published', 'committed', 'rolling-back', 'rolledback', 'rollback-failed')) {
      $missed = [ordered]@{
        at            = (Get-Stamp)
        startedAt     = $startedAt.ToString('yyyy-MM-ddTHH:mm:ss.fffzzz')
        elapsedSeconds = [math]::Round($stopwatch.Elapsed.TotalSeconds, 3)
        missedWindow  = $true
        observedPhase = $info.phase
        installRoot   = $InstallRoot
        journalPath   = $JournalPath
        pollCount     = $polled
        pollSeconds   = $PollSeconds
        history       = @($history)
        note          = ((New-Text @(0x8F6E,0x8BE2,0x95F4,0x9694,0x5185,0x5DF2,0x8D8A,0x8FC7)) + ' prepared' + (New-Text @(0xFF1A,0x672C,0x8F6E,0x65E0,0x6CD5,0x5728)) + ' prepared ' + (New-Text @(0x65F6,0x523B,0x65AD,0x7535,0xFF0C,0x8BF7,0x628A)) + ' PollSeconds ' + (New-Text @(0x8C03,0x5C0F,0xFF08,0x4F8B,0x5982)) + ' 1' + (New-Text @(0xFF09,0x6216,0x6539,0x7528,0x66F4,0x5FEB,0x7684,0x89E6,0x53D1,0x65B9,0x5F0F,0x91CD,0x505A,0x57FA,0x7EBF,0x540E,0x91CD,0x8DD1,0x3002)))
      }
      Write-JsonFile -Path $MissedJson -Object $missed
      Add-WatchLog ('MISSED WINDOW: phase advanced to ' + $info.phase + ' at poll ' + $polled)
      Write-Output ('PHASE-WATCH-MISSED ' + $info.phase)
      $stopwatch.Stop()
      exit 3
    }

    if ($polled % 15 -eq 0) {
      Add-WatchLog ('poll ' + $polled + ': phase="' + $info.phase + '" bytes=' + $bytes.Length + ' method=' + $info.parseMethod)
    }

    Start-Sleep -Seconds $PollSeconds
  }

  if ($hit) {
    # -------- prepared captured --------
    $preparedAt = Get-Date
    $stages     = Get-StageReport -Root $InstallRoot

    # 1) byte-exact copy of the journal as observed at the prepared moment
    $copyWritten = $false
    $copyError   = ''
    $copySha     = ''
    try {
      [System.IO.File]::WriteAllBytes($JournalCopy, $lastBytes)
      $copySha     = (Get-FileHash -LiteralPath $JournalCopy -Algorithm SHA256).Hash.ToLowerInvariant()
      $copyWritten = $true
    } catch {
      $copyError = $_.Exception.Message
    }

    # 2) stage listing (captured after the copy so a racing engine cannot
    #    change what the journal copy says)
    $stagesAfter = Get-StageReport -Root $InstallRoot

    $prepared = [ordered]@{
      at              = $preparedAt.ToString('yyyy-MM-ddTHH:mm:ss.fffzzz')
      startedAt       = $startedAt.ToString('yyyy-MM-ddTHH:mm:ss.fffzzz')
      elapsedSeconds  = [math]::Round($stopwatch.Elapsed.TotalSeconds, 3)
      phase           = 'prepared'
      phaseRaw        = $lastInfo.phase
      parseMethod     = $lastInfo.parseMethod
      transactionId   = $lastInfo.transactionId
      purpose         = $lastInfo.purpose
      role            = $lastInfo.role
      sourceVersion   = $lastInfo.sourceVersion
      targetVersion   = $lastInfo.targetVersion
      rollbackForbidden = $lastInfo.rollbackForbidden
      runtimeWrites     = $lastInfo.runtimeWrites
      installRoot     = $InstallRoot
      journalPath     = $JournalPath
      journalBytes    = $lastBytes.Length
      journalSha256   = (Get-Sha256Hex -Bytes $lastBytes)
      journalCopy     = $JournalCopy
      journalCopySha256 = $copySha
      journalCopyOk   = $copyWritten
      journalCopyError = $copyError
      pollCount       = $polled
      pollSeconds     = $PollSeconds
      stageDirCount   = $stages.dirCount
      stageFileCount  = $stages.fileCount
      stageBytes      = $stages.bytes
      stageScanError  = $stages.scanError
      stageDirs       = @($stages.dirs)
      stageDirCountAfterCopy = $stagesAfter.dirCount
      stageFileCountAfterCopy = $stagesAfter.fileCount
      stageBytesAfterCopy = $stagesAfter.bytes
      history         = @($history)
      resultsDir      = $ResultsDir
      note            = ((New-Text @(0x6B64,0x523B,0x8D77,0x5FC5,0x987B,0x5728,0x5BBF,0x4E3B,0x4FA7,0x7ACB,0x523B)) + ' wsb stop --id <id>' + (New-Text @(0xFF1B,0x672C,0x811A,0x672C,0x4E0D,0x4F1A,0x4E5F,0x4E0D,0x5E94,0x8BE5,0x505C,0x673A,0x5668,0x3002)))
    }

    if (-not $copyWritten) {
      $prepared['journalCopyOk'] = $false
    }

    Write-JsonFile -Path $PreparedJson -Object $prepared
    Add-WatchLog ('PREPARED captured at poll ' + $polled +
                  '; journal bytes=' + $lastBytes.Length +
                  '; stageDirs=' + $stages.dirCount +
                  '; stageFiles=' + $stages.fileCount +
                  '; stageBytes=' + $stages.bytes +
                  '; copyOk=' + $copyWritten)

    Write-Output ('PHASE-WATCH-PREPARED ' + $PreparedJson)
    Write-Output ('journal-copy=' + $JournalCopy)
    Write-Output ('stage-dirs=' + $stages.dirCount + ' stage-files=' + $stages.fileCount + ' stage-bytes=' + $stages.bytes)
    Write-Output 'DO NOT stop the sandbox from here: the host-side operator runs wsb stop --id <id>.'
    $stopwatch.Stop()
    exit 0
  }

  # -------- timeout --------
  $timeoutInfo = $null
  if ($null -ne $lastInfo) {
    $timeoutInfo = [ordered]@{
      phase         = $lastInfo.phase
      parseMethod   = $lastInfo.parseMethod
      transactionId = $lastInfo.transactionId
      sourceVersion = $lastInfo.sourceVersion
      targetVersion = $lastInfo.targetVersion
    }
  }

  $stages = Get-StageReport -Root $InstallRoot

  $timeoutObj = [ordered]@{
    at              = (Get-Stamp)
    startedAt       = $startedAt.ToString('yyyy-MM-ddTHH:mm:ss.fffzzz')
    elapsedSeconds  = [math]::Round($stopwatch.Elapsed.TotalSeconds, 3)
    timedOut        = $true
    phase           = 'timeout'
    timeoutMinutes  = $TimeoutMinutes
    installRoot     = $InstallRoot
    journalPath     = $JournalPath
    journalExists   = (Test-Path -LiteralPath $JournalPath)
    stateDirExists  = (Test-Path -LiteralPath $StateDir)
    lastPhase       = $(if ($null -ne $timeoutInfo) { $timeoutInfo.phase } else { '' })
    lastJournal     = $timeoutInfo
    pollCount       = $polled
    pollSeconds     = $PollSeconds
    stageDirCount   = $stages.dirCount
    stageFileCount  = $stages.fileCount
    stageBytes      = $stages.bytes
    stageDirs       = @($stages.dirs)
    history         = @($history)
    resultsDir      = $ResultsDir
    note            = ((New-Text @(0x8D85,0x65F6,0x672A,0x89C2,0x6D4B,0x5230)) + ' prepared' + (New-Text @(0x3002,0x8BF7,0x786E,0x8BA4,0x5347,0x7EA7,0x662F,0x5426,0x771F,0x7684,0x542F,0x52A8,0xFF08,0x5BA1,0x6279,0x7A97,0x4F53,0x662F,0x5426,0x5DF2,0x70B9,0x51FB,0xFF09,0x3001)) + 'journal ' + (New-Text @(0x8DEF,0x5F84,0x662F,0x5426,0x6B63,0x786E,0xFF0C,0x518D,0x51B3,0x5B9A,0x662F,0x5426,0x91CD,0x94FA,0x57FA,0x7EBF,0x3002)))
  }

  Write-JsonFile -Path $TimeoutJson -Object $timeoutObj
  Add-WatchLog ('TIMEOUT after ' + [math]::Round($stopwatch.Elapsed.TotalSeconds, 1) + 's; polls=' + $polled +
                '; lastPhase="' + $(if ($null -ne $timeoutInfo) { $timeoutInfo.phase } else { '' }) + '"')
  Write-Output ('PHASE-WATCH-TIMEOUT ' + $TimeoutJson)
  $stopwatch.Stop()
  exit 2
}
catch {
  $errObj = [ordered]@{
    at            = (Get-Stamp)
    error         = $true
    exception     = $_.Exception.GetType().FullName
    message       = $_.Exception.Message
    position      = $_.InvocationInfo.PositionMessage
    scriptStack   = $_.ScriptStackTrace
    installRoot   = $InstallRoot
    journalPath   = $JournalPath
    pollCount     = $polled
    elapsedSeconds = [math]::Round($stopwatch.Elapsed.TotalSeconds, 3)
    history       = @($history)
  }
  try { Write-JsonFile -Path $ErrorJson -Object $errObj } catch { }
  Add-WatchLog ('ERROR: ' + $_.Exception.Message)
  Write-Output ('PHASE-WATCH-ERROR ' + $_.Exception.Message)
  $stopwatch.Stop()
  exit 1
}

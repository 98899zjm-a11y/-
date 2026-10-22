<#
.SYNOPSIS
  S4 recovery drill: guest-side read-only state verification.

.DESCRIPTION
  Collects (and ONLY collects) the post-recovery evidence under
  <ResultsDir>\verify-install.json:

    - <InstallRoot>\xjy-install-activation.json  (raw text + parsed payload)
    - <InstallRoot>\version                      (raw text)
    - <InstallRoot>\<StateDir>\journal.json      (exists / phase / payload fields)
    - <InstallRoot>                                (file count, total bytes, top level)
    - F:\<DataDir>                                 (file count, total bytes, top level)
    - <ResultsDir>\*.log                          (last N lines each)
    - worker outputs in <ResultsDir>              (recovered / completed / rolledBack / phase / code)

  Nothing is written inside the install tree, nothing is deleted, no process
  is started or stopped.  Exit code is 0 whenever the JSON report was written,
  including when parts of the system are missing (those become errors[]).

.NOTES
  ASCII-ONLY ON PURPOSE: Windows PowerShell 5.1 decodes a BOM-less UTF-8 file
  as ANSI, so every Chinese literal is rebuilt at run time from code points
  through New-Text.  Do not paste raw CJK characters into this file.

  PS 5.1 compatible.

.EXAMPLE
  powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File C:\XjyResults\verify-install.ps1
#>
[CmdletBinding()]
param(
  # Product install root.  Empty = F:\<install-dir>\xjy-jewelry-offline
  [string] $InstallRoot = '',

  # Business data root.  Empty = F:\<data-dir>
  [string] $DataRoot = '',

  # Shared host/guest results folder.
  [string] $ResultsDir = 'C:\XjyResults',

  # Lines of each *.log to keep.
  [int] $LogTail = 30,

  # Cap on the number of engine-state files listed.
  [int] $MaxStateFiles = 400,

  # Cap on the number of top-level entries listed per root.
  [int] $MaxTopLevel = 80,

  # Cap on characters kept per raw text blob (version file, activation json).
  [int] $MaxTextChars = 20000
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
if ([string]::IsNullOrWhiteSpace($DataRoot)) {
  $DataRoot = 'F:\' + ((New-Text @(0x946B,0x91D1,0x6E90,0x73E0,0x5B9D,0x8D44,0x6599)))
}

$StateName       = '.program.xjy-engine-state'
$StageGlob       = '.program.engine-stage-*'
$InitialUpgrade  = '.xjy-initial-upgrade'
$ActivationNames = @('xjy-install-activation.json', '.xjy-install-activation.json')
$VersionNames    = @('version', 'VERSION')

$StateDir       = Join-Path $InstallRoot $StateName
$JournalPath    = Join-Path $StateDir 'journal.json'
$InitialDir     = Join-Path $InstallRoot $InitialUpgrade
$OutPath        = Join-Path $ResultsDir 'verify-install.json'

$Utf8NoBom      = New-Object System.Text.UTF8Encoding($false)
$errors         = New-Object System.Collections.ArrayList

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
function Add-Err {
  param([string] $Section, [string] $Message)
  [void]$errors.Add([ordered]@{ at = (Get-Stamp); section = $Section; message = $Message })
}

function Get-Stamp {
  return (Get-Date).ToString('yyyy-MM-ddTHH:mm:ss.fffzzz')
}

function Write-JsonFile {
  param([string] $Path, $Object)
  $json = $Object | ConvertTo-Json -Depth 10
  [System.IO.File]::WriteAllText($Path, $json, $Utf8NoBom)
}

# Shared-read text read; returns $null when the file is absent.
function Read-TextShared {
  param([string] $Path, [int] $Attempts = 4)

  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  $lastError = ''
  for ($i = 1; $i -le $Attempts; $i++) {
    $fs = $null
    try {
      $share = [System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete
      $fs = New-Object System.IO.FileStream -ArgumentList @(
        $Path,
        [System.IO.FileMode]::Open,
        [System.IO.FileAccess]::Read,
        [System.IO.FileShare]$share
      )
      $ms = New-Object System.IO.MemoryStream
      try { $fs.CopyTo($ms); $bytes = $ms.ToArray() } finally { $ms.Dispose() }
      $text = [System.Text.Encoding]::UTF8.GetString($bytes)
      return $text.TrimStart([char]0xFEFF)
    } catch {
      $lastError = $_.Exception.Message
    } finally {
      if ($null -ne $fs) { $fs.Dispose() }
    }
    Start-Sleep -Milliseconds 120
  }
  throw ('read failed: ' + $lastError)
}

# Envelope-aware field extraction.  The engine stores
#   { "payload": "<json string>", "mac": "..." }
# so plain JSON access needs two parses; this falls back to regex.
function Get-EnvelopeFields {
  param(
    [string] $Raw,
    [string[]] $Names
  )

  $result = [ordered]@{}
  foreach ($n in $Names) { $result[$n] = $null }
  if ([string]::IsNullOrWhiteSpace($Raw)) { return $result }

  $outer       = $null
  $payloadText = ''
  $inner       = $null

  try { $outer = $Raw | ConvertFrom-Json -ErrorAction Stop } catch { $outer = $null }

  if ($null -ne $outer) {
    $p = $null
    try { $p = $outer.payload } catch { $p = $null }
    if ($p -is [string]) {
      $payloadText = [string]$p
      try { $inner = $payloadText | ConvertFrom-Json -ErrorAction Stop } catch { $inner = $null }
    } else {
      $inner = $outer
      $payloadText = $Raw
    }
  }

  if ($null -ne $inner) {
    $names = @()
    try { $names = @($inner.PSObject.Properties.Name) } catch { $names = @() }
    foreach ($n in $Names) {
      if ($names -contains $n) {
        $v = $null
        try { $v = $inner.$n } catch { $v = $null }
        if ($null -eq $v) { continue }
        if (($v -is [string]) -or ($v -is [bool]) -or ($v -is [int]) -or ($v -is [long]) -or ($v -is [double])) {
          $result[$n] = $v
        } else {
          $result[$n] = [string]$v
        }
      }
    }
    $missing = @($Names | Where-Object { $null -eq $result[$_] })
    if ($missing.Count -eq 0) { return $result }
  }

  $flat = $payloadText
  if ([string]::IsNullOrWhiteSpace($flat)) { $flat = $Raw }
  $flat = $flat.Replace('\', '')

  foreach ($n in $Names) {
    if ($null -ne $result[$n]) { continue }
    $m = [regex]::Match($flat, ('"' + [regex]::Escape($n) + '"\s*:\s*"([^"]*)"'))
    if ($m.Success) { $result[$n] = $m.Groups[1].Value }
  }
  return $result
}

# File count + byte total + capped top-level listing for one root.
function Get-TreeSummary {
  param([string] $Root, [int] $MaxEntries = 80)

  $summary = [ordered]@{
    path        = $Root
    exists      = $false
    fileCount   = 0
    dirCount    = 0
    bytes       = [int64]0
    topLevel    = @()
    topLevelTruncated = $false
    scanError   = ''
  }

  if (-not (Test-Path -LiteralPath $Root)) { return $summary }
  $summary.exists = $true

  try {
    $files = @(Get-ChildItem -LiteralPath $Root -Recurse -File -Force -ErrorAction SilentlyContinue)
    $summary.fileCount = $files.Count
    foreach ($f in $files) { $summary.bytes += [int64]$f.Length }
  } catch {
    $summary.scanError = 'files: ' + $_.Exception.Message
    Add-Err -Section ('tree:' + $Root) -Message $_.Exception.Message
  }

  try {
    $dirs = @(Get-ChildItem -LiteralPath $Root -Recurse -Directory -Force -ErrorAction SilentlyContinue)
    $summary.dirCount = $dirs.Count
  } catch {
    if ($summary.scanError -eq '') { $summary.scanError = 'dirs: ' + $_.Exception.Message }
  }

  try {
    $top = @(Get-ChildItem -LiteralPath $Root -Force -ErrorAction SilentlyContinue | Sort-Object Name)
    $take = $top
    if ($top.Count -gt $MaxEntries) {
      $take = $top[0..($MaxEntries - 1)]
      $summary.topLevelTruncated = $true
    }
    $listed = New-Object System.Collections.ArrayList
    foreach ($t in $take) {
      $entry = [ordered]@{
        name    = $t.Name
        isDir   = [bool]$t.PSIsContainer
        bytes   = [int64]0
        children = 0
        lastWrite = ''
      }
      try { $entry.lastWrite = $t.LastWriteTime.ToString('yyyy-MM-ddTHH:mm:ss.fffzzz') } catch { }
      if ([bool]$t.PSIsContainer) {
        $kids = @(Get-ChildItem -LiteralPath $t.FullName -Force -ErrorAction SilentlyContinue)
        $entry.children = $kids.Count
        $kidFiles = @(Get-ChildItem -LiteralPath $t.FullName -Recurse -File -Force -ErrorAction SilentlyContinue)
        foreach ($kf in $kidFiles) { $entry.bytes += [int64]$kf.Length }
      } else {
        $entry.bytes = [int64]$t.Length
      }
      [void]$listed.Add($entry)
    }
    $summary.topLevel = @($listed)
  } catch {
    Add-Err -Section ('topLevel:' + $Root) -Message $_.Exception.Message
  }

  return $summary
}

# The stage directories a prepared transaction leaves behind.  Read-only.
function Get-StageReport {
  param([string] $Root)

  $out = [ordered]@{ dirCount = 0; fileCount = 0; bytes = [int64]0; dirs = @(); scanError = '' }
  if (-not (Test-Path -LiteralPath $Root)) {
    $out.scanError = 'install-root-missing'
    return $out
  }

  $stageDirs = @()
  try {
    $stageDirs = @(Get-ChildItem -LiteralPath $Root -Directory -Force -ErrorAction Stop |
                   Where-Object { $_.Name -like $StageGlob })
  } catch {
    $out.scanError = $_.Exception.Message
    return $out
  }

  $listed = New-Object System.Collections.ArrayList
  $files = 0
  $bytes = [int64]0
  foreach ($d in $stageDirs) {
    $fc = 0
    $bc = [int64]0
    $err = ''
    try {
      $kids = @(Get-ChildItem -LiteralPath $d.FullName -Recurse -File -Force -ErrorAction SilentlyContinue)
      $fc = $kids.Count
      foreach ($k in $kids) { $bc += [int64]$k.Length }
    } catch {
      $err = $_.Exception.Message
    }
    $files += $fc
    $bytes += $bc
    [void]$listed.Add([ordered]@{
      name      = $d.Name
      path      = $d.FullName
      fileCount = $fc
      bytes     = $bc
      lastWrite = $d.LastWriteTime.ToString('yyyy-MM-ddTHH:mm:ss.fffzzz')
      scanError = $err
    })
  }

  $out.dirCount  = $stageDirs.Count
  $out.fileCount = $files
  $out.bytes     = $bytes
  $out.dirs      = @($listed)
  return $out
}

function Get-TruncatedText {
  param($Text, [int] $Limit = 20000)
  if ($null -eq $Text) { return $null }
  if ($Text.Length -le $Limit) { return $Text }
  return $Text.Substring(0, $Limit)
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
$report = [ordered]@{
  tool        = 'verify-install.ps1'
  at          = (Get-Stamp)
  machine     = [ordered]@{}
  parameters  = [ordered]@{
    installRoot = $InstallRoot
    dataRoot    = $DataRoot
    resultsDir  = $ResultsDir
    logTail     = $LogTail
  }
  installRoot    = $null
  marker         = [ordered]@{}
  engineState    = [ordered]@{}
  stages         = $null
  initialUpgrade = [ordered]@{}
  dataRoot       = $null
  logs           = @()
  workerOutputs  = @()
  errors         = @()
  outPath        = $OutPath
}

if (-not (Test-Path -LiteralPath $ResultsDir)) {
  try { New-Item -ItemType Directory -Path $ResultsDir -Force | Out-Null } catch { }
}

# 0) who / where ------------------------------------------------------------
try {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $report.machine = [ordered]@{
    computerName = $env:COMPUTERNAME
    userName     = $env:USERNAME
    userDomain   = $env:USERDOMAIN
    userSid      = $id.User.Value
    isSystem     = ($id.User.Value -eq 'S-1-5-18')
    psVersion    = $PSVersionTable.PSVersion.ToString()
    psEdition    = [string]$PSVersionTable.PSEdition
    osVersion    = [string][System.Environment]::OSVersion.VersionString
    isElevated   = $false
    cwd          = (Get-Location).Path
    appData      = $env:APPDATA
  }
  try {
    $wi = New-Object Security.Principal.WindowsPrincipal($id)
    $report.machine.isElevated = $wi.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  } catch { }
} catch {
  Add-Err -Section 'machine' -Message $_.Exception.Message
}

# 1) install root tree ------------------------------------------------------
try {
  $report.installRoot = Get-TreeSummary -Root $InstallRoot -MaxEntries $MaxTopLevel
  if (-not $report.installRoot.exists) {
    Add-Err -Section 'installRoot' -Message 'install root does not exist (F: volume missing?)'
  }
} catch {
  Add-Err -Section 'installRoot' -Message $_.Exception.Message
}

# 2) marker files -----------------------------------------------------------
try {
  $marker = $report.marker
  $marker['installRoot']  = $InstallRoot
  $marker['versionFiles'] = @()
  $marker['activationFile'] = $null
  $marker['activationText'] = $null
  $marker['activationFields'] = $null

  $vfList = New-Object System.Collections.ArrayList
  foreach ($vn in $VersionNames) {
    $vp = Join-Path $InstallRoot $vn
    if (Test-Path -LiteralPath $vp) {
      $raw = $null
      try { $raw = Read-TextShared -Path $vp } catch { Add-Err -Section 'version' -Message $_.Exception.Message }
      [void]$vfList.Add([ordered]@{
        name  = $vn
        path  = $vp
        bytes = (Get-Item -LiteralPath $vp).Length
        text  = (Get-TruncatedText -Text $raw -Limit 4000)
        firstLine = $(if ($null -ne $raw) { ([string]($raw -split "`r?`n")[0]) } else { $null })
      })
    }
  }
  $marker['versionFiles'] = @($vfList)

  foreach ($an in $ActivationNames) {
    $ap = Join-Path $InstallRoot $an
    if (Test-Path -LiteralPath $ap) {
      $raw = $null
      try { $raw = Read-TextShared -Path $ap } catch { Add-Err -Section 'activation' -Message $_.Exception.Message }
      $marker['activationFile'] = $ap
      $marker['activationBytes'] = (Get-Item -LiteralPath $ap).Length
      $marker['activationText'] = (Get-TruncatedText -Text $raw -Limit $MaxTextChars)
      if ($null -ne $raw) {
        $f = Get-EnvelopeFields -Raw $raw -Names @('product','version','targetVersion','sourceVersion','installationDir','channel','installedAt','transactionId','role','phase','osUserNamespace','buildId')
        $marker['activationFields'] = $f
      }
      break
    }
  }

  if ($null -eq $marker['activationFile']) {
    Add-Err -Section 'activation' -Message 'no xjy-install-activation.json found under install root'
  }
} catch {
  Add-Err -Section 'marker' -Message $_.Exception.Message
}

# 3) engine state -----------------------------------------------------------
try {
  $state = $report.engineState
  $state['stateDir']      = $StateDir
  $state['stateDirExists'] = (Test-Path -LiteralPath $StateDir)
  $state['journalPath']   = $JournalPath
  $state['journalExists'] = (Test-Path -LiteralPath $JournalPath)
  $state['journalBytes']  = $null
  $state['phase']         = $null
  $state['payloadFields'] = $null
  $state['journalRaw']    = $null
  $state['files']         = @()
  $state['filesTruncated'] = $false

  if ($state['journalExists']) {
    $jraw = $null
    try { $jraw = Read-TextShared -Path $JournalPath } catch { Add-Err -Section 'journal' -Message $_.Exception.Message }
    if ($null -ne $jraw) {
      $jb = (Get-Item -LiteralPath $JournalPath).Length
      $state['journalBytes'] = $jb
      $state['journalRaw']   = (Get-TruncatedText -Text $jraw -Limit $MaxTextChars)
      $f = Get-EnvelopeFields -Raw $jraw -Names @('version','purpose','transactionId','phase','runtimeWrites','rollbackForbidden','role','sourceVersion','targetVersion','sourceEngineVersion','targetEngineVersion','installationDir','stateDir','dataDir','artifactDir','isolationRoot','profileDir')
      $state['payloadFields'] = $f
      $state['phase'] = $f['phase']
      $state['runtimeWrites'] = $f['runtimeWrites']
      $state['rollbackForbidden'] = $f['rollbackForbidden']
      $state['transactionId'] = $f['transactionId']
      $state['sourceVersion'] = $f['sourceVersion']
      $state['targetVersion'] = $f['targetVersion']
    }
  } else {
    Add-Err -Section 'journal' -Message 'journal.json not present under engine state dir'
  }

  if ($state['stateDirExists']) {
    $sf = @(Get-ChildItem -LiteralPath $StateDir -Force -ErrorAction SilentlyContinue | Sort-Object Name)
    $take = $sf
    if ($sf.Count -gt $MaxStateFiles) {
      $take = $sf[0..($MaxStateFiles - 1)]
      $state['filesTruncated'] = $true
    }
    $listed = New-Object System.Collections.ArrayList
    foreach ($s in $take) {
      $e = [ordered]@{ name = $s.Name; isDir = [bool]$s.PSIsContainer; bytes = [int64]0; lastWrite = '' }
      try { $e.lastWrite = $s.LastWriteTime.ToString('yyyy-MM-ddTHH:mm:ss.fffzzz') } catch { }
      if (-not [bool]$s.PSIsContainer) { $e.bytes = [int64]$s.Length }
      [void]$listed.Add($e)
    }
    $state['files'] = @($listed)
    $state['fileTotal'] = $sf.Count
  }
} catch {
  Add-Err -Section 'engineState' -Message $_.Exception.Message
}

# 4) stage directories left by a prepared transaction -----------------------
try {
  $report['stages'] = Get-StageReport -Root $InstallRoot
} catch {
  Add-Err -Section 'stages' -Message $_.Exception.Message
}

# 5) initial-upgrade bookkeeping ------------------------------------------
try {
  $init = $report.initialUpgrade
  $init['dir']       = $InitialDir
  $init['exists']    = (Test-Path -LiteralPath $InitialDir)
  $init['files']     = @()
  $init['recoveryStatusPath'] = (Join-Path $InitialDir 'recovery-status.json')
  $init['recoveryStatusFields'] = $null
  $init['journalPath'] = (Join-Path $InitialDir 'journal.json')
  $init['journalFields'] = $null

  if ($init['exists']) {
    $fl = @(Get-ChildItem -LiteralPath $InitialDir -Force -ErrorAction SilentlyContinue | Sort-Object Name)
    $listed = New-Object System.Collections.ArrayList
    foreach ($x in $fl) {
      $e = [ordered]@{ name = $x.Name; isDir = [bool]$x.PSIsContainer; bytes = [int64]0; lastWrite = '' }
      try { $e.lastWrite = $x.LastWriteTime.ToString('yyyy-MM-ddTHH:mm:ss.fffzzz') } catch { }
      if (-not [bool]$x.PSIsContainer) { $e.bytes = [int64]$x.Length }
      [void]$listed.Add($e)
    }
    $init['files'] = @($listed)

    if (Test-Path -LiteralPath $init['recoveryStatusPath']) {
      $raw = $null
      try { $raw = Read-TextShared -Path $init['recoveryStatusPath'] } catch { Add-Err -Section 'recoveryStatus' -Message $_.Exception.Message }
      if ($null -ne $raw) {
        $init['recoveryStatusFields'] = Get-EnvelopeFields -Raw $raw -Names @('version','product','installationDir','role','targetVersion','transactionId','phase','osUserNamespace')
      }
    }
    if (Test-Path -LiteralPath $init['journalPath']) {
      $raw = $null
      try { $raw = Read-TextShared -Path $init['journalPath'] } catch { Add-Err -Section 'initialJournal' -Message $_.Exception.Message }
      if ($null -ne $raw) {
        $init['journalFields'] = Get-EnvelopeFields -Raw $raw -Names @('transactionId','phase','sourceVersion','targetVersion','role')
      }
    }
  } else {
    Add-Err -Section 'initialUpgrade' -Message '.xjy-initial-upgrade not present (upgrade marker bookkeeping missing)'
  }
} catch {
  Add-Err -Section 'initialUpgrade' -Message $_.Exception.Message
}

# 6) business data root ----------------------------------------------------
try {
  $report['dataRoot'] = Get-TreeSummary -Root $DataRoot -MaxEntries $MaxTopLevel
  if (-not $report.dataRoot.exists) {
    Add-Err -Section 'dataRoot' -Message 'business data root does not exist (F: volume missing?)'
  }
} catch {
  Add-Err -Section 'dataRoot' -Message $_.Exception.Message
}

# 7) log tails -------------------------------------------------------------
try {
  $logs = @()
  if (Test-Path -LiteralPath $ResultsDir) {
    $logs = @(Get-ChildItem -LiteralPath $ResultsDir -File -Filter '*.log' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime)
  }
  $listed = New-Object System.Collections.ArrayList
  foreach ($lg in $logs) {
    $tailLines = @()
    $err = ''
    try {
      # cmd redirection writes ANSI, so the default encoding is the right one.
      $rawLines = @(Get-Content -LiteralPath $lg.FullName -Tail $LogTail -Encoding Default -ErrorAction Stop)
      # PS 5.1 hazard: ConvertTo-Json never returns while serialising the string
      # instances Get-Content hands back (verified: the same text as a literal or
      # as a rebuilt string serialises in milliseconds). Rebuild each line first.
      foreach ($ln in $rawLines) {
        if ($null -eq $ln) {
          $tailLines += ''
        } else {
          $tailLines += [string]::new($ln.ToCharArray())
        }
      }
    } catch {
      $err = $_.Exception.Message
    }
    [void]$listed.Add([ordered]@{
      name      = $lg.Name
      path      = $lg.FullName
      bytes     = [int64]$lg.Length
      lastWrite = $lg.LastWriteTime.ToString('yyyy-MM-ddTHH:mm:ss.fffzzz')
      tailLines = @($tailLines)
      readError = $err
    })
  }
  $report['logs'] = @($listed)
} catch {
  Add-Err -Section 'logs' -Message $_.Exception.Message
}

# 8) worker outputs (recovered / completed / rolledBack / code) -----------
try {
  $candidates = @()
  if (Test-Path -LiteralPath $ResultsDir) {
    $all = @(Get-ChildItem -LiteralPath $ResultsDir -File -Filter '*.json' -ErrorAction SilentlyContinue)
    $candidates = @($all | Where-Object {
      $_.Name -match '(?i)(upgrade|recover|verify|phase|approve|yes|click|wins|dialog)' -and
      $_.Name -ne 'verify-install.json'
    })
  }
  $listed = New-Object System.Collections.ArrayList
  foreach ($c in $candidates) {
    $entry = [ordered]@{
      name      = $c.Name
      bytes     = [int64]$c.Length
      lastWrite = $c.LastWriteTime.ToString('yyyy-MM-ddTHH:mm:ss.fffzzz')
      recovered = $null
      completed = $null
      rolledBack = $null
      phase     = $null
      code      = $null
      errorCodesSeen = @()
      readError = ''
    }
    try {
      $raw = $null
      if ($c.Length -le 8000000) { $raw = Read-TextShared -Path $c.FullName }
      if ($null -ne $raw) {
        $flat = $raw.Replace('\', '')
        foreach ($pair in @(
            @('recovered',  '"recovered"\s*:\s*(true|false)'),
            @('completed',  '"completed"\s*:\s*(true|false)'),
            @('rolledBack', '"rolledBack"\s*:\s*(true|false)')
          )) {
          $m = [regex]::Match($flat, $pair[1])
          if ($m.Success) { $entry[$pair[0]] = $m.Groups[1].Value }
        }
        $mp = [regex]::Match($flat, '"phase"\s*:\s*"([A-Za-z0-9._-]+)"')
        if ($mp.Success) { $entry['phase'] = $mp.Groups[1].Value }
        $mc = [regex]::Match($flat, '"code"\s*:\s*"([A-Z][A-Z0-9_]+)"')
        if ($mc.Success) { $entry['code'] = $mc.Groups[1].Value }
        $known = New-Object System.Collections.ArrayList
        foreach ($codeName in @('RECOVERY_REQUIRED','STAGE_OWNERSHIP_UNPROVEN','NATIVE_ACL_REFUSED','ROLLBACK_FORBIDDEN','UNCERTAIN_DISK_STATE')) {
          if ($flat.Contains($codeName)) { [void]$known.Add($codeName) }
        }
        $entry['errorCodesSeen'] = @($known)
      }
    } catch {
      $entry['readError'] = $_.Exception.Message
    }
    [void]$listed.Add($entry)
  }
  $report['workerOutputs'] = @($listed)
} catch {
  Add-Err -Section 'workerOutputs' -Message $_.Exception.Message
}

# 9) flat hints (no judgement, just the values the README table needs) -----
try {
  $recoveredValues = @($report.workerOutputs | Where-Object { $null -ne $_.recovered } |
                       ForEach-Object { ($_.name + ':' + $_.recovered) })
  $report['hints'] = [ordered]@{
    installRootExists   = $(if ($null -ne $report.installRoot) { $report.installRoot.exists } else { $false })
    journalPhase        = $report.engineState['phase']
    stageDirCount       = $(if ($null -ne $report['stages']) { $report['stages'].dirCount } else { $null })
    stageFileCount      = $(if ($null -ne $report['stages']) { $report['stages'].fileCount } else { $null })
    installFileCount    = $(if ($null -ne $report.installRoot) { $report.installRoot.fileCount } else { $null })
    installBytes        = $(if ($null -ne $report.installRoot) { $report.installRoot.bytes } else { $null })
    dataFileCount       = $(if ($null -ne $report.dataRoot) { $report.dataRoot.fileCount } else { $null })
    dataBytes           = $(if ($null -ne $report.dataRoot) { $report.dataRoot.bytes } else { $null })
    recoveredSeen       = $recoveredValues
    errorCount          = $errors.Count
  }
} catch {
  Add-Err -Section 'hints' -Message $_.Exception.Message
}

$report['errors'] = @($errors)

try {
  Write-JsonFile -Path $OutPath -Object $report
  Write-Output ('VERIFY-OK ' + $OutPath)
  Write-Output ('VERIFY-ERRORS ' + $errors.Count)
  if ($null -ne $report['hints']) {
    Write-Output ('VERIFY-PHASE ' + $report['hints']['journalPhase'])
    Write-Output ('VERIFY-STAGES ' + $report['hints']['stageDirCount'])
    Write-Output ('VERIFY-INSTALL-FILES ' + $report['hints']['installFileCount'])
    Write-Output ('VERIFY-DATA-FILES ' + $report['hints']['dataFileCount'])
  }
  exit 0
} catch {
  Write-Output ('VERIFY-FATAL ' + $_.Exception.Message)
  exit 1
}

<#
.SYNOPSIS
  S4 recovery drill: host-side evidence collector.

.DESCRIPTION
  Copies the S4 (power-cut during "prepared") evidence out of the shared
  guest folder into a frozen host-side evidence directory and writes INDEX.md.

      source : D:\Codex\xjy-release-20261022\guest-results      (= guest C:\XjyResults)
      target : D:\Codex\xjy-release-20261022\evidence-s4-recovery

  Only reads the source folder and only writes inside the target folder.
  Each copied file gets its size / timestamp / SHA256 in INDEX.md so the
  evidence set can be proven unchanged later.

  -IncludeBaseline also copies the pre-S4 historical logs (kept for contrast,
  never as proof of this drill).

.NOTES
  ASCII-ONLY ON PURPOSE: Windows PowerShell 5.1 decodes a BOM-less UTF-8 file
  as ANSI, so every Chinese literal is rebuilt at run time from code points
  through New-Text.  Do not paste raw CJK characters into this file.

  PS 5.1 compatible.  Exit codes: 0 ok, 1 fatal.
#>
[CmdletBinding()]
param(
  # Shared folder the running sandbox maps to C:\XjyResults.
  [string] $SourceDir = 'D:\Codex\xjy-release-20261022\guest-results',

  # Frozen evidence directory.
  [string] $OutDir = 'D:\Codex\xjy-release-20261022\evidence-s4-recovery',

  # Also copy pre-S4 baseline logs / probes.
  [switch] $IncludeBaseline,

  # Do not (re)write INDEX.md.
  [switch] $NoIndex
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

$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$errors    = New-Object System.Collections.ArrayList

# ---------------------------------------------------------------------------
# Evidence table.
#   Group    : core      = must exist for a valid S4 run
#              support   = explains an approval / diagnostic step
#              baseline  = pre-S4 history, only with -IncludeBaseline
#   Pattern  : Get-ChildItem -Filter pattern
#   Multi    : $true when the pattern may match several files
# ---------------------------------------------------------------------------
$table = @(
  [ordered]@{ Pattern = 'phase-prepared.json';  Group = 'core';    Multi = $false; What = ((New-Text @(0x65AD,0x7535,0x7A97,0x53E3,0x8BC1,0x636E,0xFF1A)) + 'prepared ' + (New-Text @(0x9996,0x6B21,0x89C2,0x6D4B,0x65F6,0x95F4,0x3001)) + 'journal ' + (New-Text @(0x9010,0x5B57,0x8282,0x526F,0x672C,0x7684)) + ' sha256' + (New-Text @(0x3001)) + 'stage ' + (New-Text @(0x76EE,0x5F55,0x6E05,0x5355))) }
  [ordered]@{ Pattern = 'journal-prepared.json'; Group = 'core';   Multi = $false; What = ('prepared ' + (New-Text @(0x65F6,0x523B)) + ' journal.json ' + (New-Text @(0x7684,0x9010,0x5B57,0x8282,0x526F,0x672C,0xFF08,0x6062,0x590D,0x540E,0x636E,0x6B64,0x5224,0x65AD)) + ' phase ' + (New-Text @(0x662F,0x5426,0x88AB,0x56DE,0x9000,0xFF09))) }
  [ordered]@{ Pattern = 'verify-install.json';  Group = 'core';    Multi = $false; What = ((New-Text @(0x6062,0x590D,0x540E,0x53EA,0x8BFB,0x91C7,0x96C6,0xFF1A)) + 'version/activation/journal.phase/' + (New-Text @(0x5B89,0x88C5,0x6839)) + '/' + (New-Text @(0x4E1A,0x52A1,0x6570,0x636E)) + '/' + (New-Text @(0x65E5,0x5FD7,0x5C3E,0x90E8)) + '/worker ' + (New-Text @(0x7ED3,0x679C))) }
  [ordered]@{ Pattern = 'phase-watch.log';      Group = 'core';    Multi = $false; What = ((New-Text @(0x8F6E,0x8BE2,0x5FC3,0x8DF3,0x4E0E)) + ' prepared ' + (New-Text @(0x6355,0x83B7,0x8BB0,0x5F55,0xFF08,0x7EAF,0x6587,0x672C,0xFF0C,0x9644,0x6BCF,0x6B21,0x89C2,0x6D4B,0x7684)) + ' phase ' + (New-Text @(0x4E0E)) + ' sha256' + (New-Text @(0xFF09))) }
  [ordered]@{ Pattern = 'phase-timeout.json';   Group = 'core';    Multi = $false; What = ((New-Text @(0x8D85,0x65F6,0x62A5,0x544A,0xFF1A,0x9650,0x65F6,0x5185,0x672A,0x89C2,0x6D4B,0x5230)) + ' prepared' + (New-Text @(0xFF0C,0x672C,0x8F6E,0x672A,0x5F62,0x6210,0x65AD,0x7535,0x7A97,0x53E3))) }
  [ordered]@{ Pattern = 'phase-missed.json';    Group = 'core';    Multi = $false; What = ((New-Text @(0x8F6E,0x8BE2,0x9519,0x8FC7,0x7A97,0x53E3,0xFF1A)) + 'phase ' + (New-Text @(0x5DF2,0x8D8A,0x8FC7)) + ' prepared' + (New-Text @(0xFF0C,0x672C,0x8F6E,0x65E0,0x6CD5,0x5728)) + ' prepared ' + (New-Text @(0x65F6,0x523B,0x65AD,0x7535))) }
  [ordered]@{ Pattern = 'phase-watch-error.json'; Group = 'core';  Multi = $false; What = ((New-Text @(0x76D1,0x89C6,0x811A,0x672C,0x81EA,0x8EAB,0x5F02,0x5E38,0xFF08,0x8BFB,0x5199)) + ' journal ' + (New-Text @(0x5931,0x8D25,0x65F6,0x7684,0x73B0,0x573A,0xFF09))) }
  [ordered]@{ Pattern = 's4-host-stop.json';    Group = 'core';    Multi = $false; What = (((New-Text @(0x5BBF,0x4E3B,0x4FA7,0x65AD,0x7535,0x65F6,0x523B))) + ' (wsb stop ' + ((New-Text @(0x65F6,0x95F4,0x6233))) + ')' + ((New-Text @(0xFF1B,0x4E0E))) + ' phase-prepared.json ' + ((New-Text @(0x7684))) + ' at ' + ((New-Text @(0x5B57,0x6BB5,0x5BF9,0x7167,0xFF0C,0x786E,0x8BA4,0x65AD,0x7535,0x53D1,0x751F,0x5728))) + ' prepared ' + ((New-Text @(0x4E4B,0x540E)))) }

  [ordered]@{ Pattern = 'upgrade*.log';         Group = 'support'; Multi = $true;  What = ((New-Text @(0x5347,0x7EA7,0x6216,0x6062,0x590D)) + ' worker ' + (New-Text @(0x7684)) + ' stdout ' + (New-Text @(0x65E5,0x5FD7,0xFF08)) + 'recovered/completed/rolledBack ' + (New-Text @(0x4E0E,0x9519,0x8BEF,0x7801,0x7684,0x539F,0x59CB,0x51FA,0x5904,0xFF09))) }
  [ordered]@{ Pattern = 'upgrade*.json';        Group = 'support'; Multi = $true;  What = ((New-Text @(0x5347,0x7EA7,0x6216,0x6062,0x590D)) + ' worker ' + (New-Text @(0x7684,0x7ED3,0x6784,0x5316,0x8F93,0x51FA))) }
  [ordered]@{ Pattern = 'click2.json';          Group = 'support'; Multi = $false; What = ((New-Text @(0x5BA1,0x5B9A,0x7A97,0x4F53,0x201C,0x5F00,0x59CB,0x6838,0x9A8C,0x5E76,0x5B89,0x88C5,0x201D,0x6309,0x94AE,0x70B9,0x51FB,0x8BC1,0x636E))) }
  [ordered]@{ Pattern = 'yes.json';             Group = 'support'; Multi = $false; What = ((New-Text @(0x6700,0x7EC8,0x786E,0x8BA4,0x5BF9,0x8BDD,0x6846,0x201C,0x662F,0x201D,0x6309,0x94AE,0x70B9,0x51FB,0x8BC1,0x636E))) }
  [ordered]@{ Pattern = 'dialog.json';          Group = 'support'; Multi = $false; What = ((New-Text @(0x5BA1,0x5B9A,0x7A97,0x4F53,0x6587,0x672C,0x5FEB,0x7167))) }
  [ordered]@{ Pattern = 'wins*.json';           Group = 'support'; Multi = $true;  What = ((New-Text @(0x9876,0x5C42,0x7A97,0x53E3,0x4E0E,0x5B50,0x63A7,0x4EF6,0x679A,0x4E3E,0x5FEB,0x7167,0xFF08,0x6309,0x94AE,0x6587,0x6848,0x4E0E,0x63A7,0x4EF6)) + ' id' + (New-Text @(0xFF09))) }
  [ordered]@{ Pattern = 's3-b.json';            Group = 'support'; Multi = $false; What = ((New-Text @(0x73AF,0x5883,0x63A2,0x9488,0xFF1A,0x8FDB,0x7A0B,0x5217,0x8868,0x3001)) + 'LOCALAPPDATA ' + (New-Text @(0x4E0B,0x7684)) + ' Xjy*' + (New-Text @(0x3001)) + 'F: ' + (New-Text @(0x76EE,0x5F55,0x4E0E,0x5269,0x4F59,0x7A7A,0x95F4))) }
  [ordered]@{ Pattern = 'bootstrap*.json';      Group = 'baseline'; Multi = $true; What = ((New-Text @(0x57FA,0x7EBF,0x94FA,0x9648,0x9636,0x6BB5,0x8F93,0x51FA,0xFF08)) + 'S4 ' + (New-Text @(0x524D,0x7F6E,0x6761,0x4EF6,0xFF0C,0x4E0D,0x662F,0x6062,0x590D,0x8BC1,0x636E,0xFF09))) }
  [ordered]@{ Pattern = 'fresh-host-local*.log'; Group = 'baseline'; Multi = $true; What = ((New-Text @(0x5386,0x53F2,0x4E3B,0x673A,0x8EAB,0x4EFD,0x94FA,0x9648,0x65E5,0x5FD7,0xFF08,0x542B)) + ' NATIVE_ACL_REFUSED ' + (New-Text @(0x5148,0x4F8B,0xFF09))) }
  [ordered]@{ Pattern = 'upgrade-out2.log';     Group = 'baseline'; Multi = $false; What = ((New-Text @(0x5386,0x53F2,0x5347,0x7EA7,0x65E5,0x5FD7,0xFF08,0x542B)) + ' RECOVERY_REQUIRED ' + (New-Text @(0x5148,0x4F8B,0xFF09))) }
  [ordered]@{ Pattern = 'journal*.json';        Group = 'baseline'; Multi = $true;  What = ((New-Text @(0x5386,0x53F2)) + ' journal ' + (New-Text @(0x526F,0x672C,0xFF08,0x4EC5,0x4F5C,0x683C,0x5F0F,0x5BF9,0x7167,0xFF0C,0x4E0D,0x4F5C,0x4E3A,0x672C,0x6B21,0x8BC1,0x636E,0xFF09))) }
  [ordered]@{ Pattern = 'verify-*.json';        Group = 'baseline'; Multi = $true;  What = ((New-Text @(0x5386,0x53F2,0x8BCA,0x65AD,0x63A2,0x9488,0x8F93,0x51FA,0xFF08)) + 'installationDir ' + (New-Text @(0x53EF,0x80FD,0x662F,0x6D4B,0x8BD5,0x6839,0xFF0C,0x4E0D,0x662F)) + ' F: ' + (New-Text @(0x4EA7,0x54C1,0x6839,0xFF09))) }
  [ordered]@{ Pattern = 'status*.json';         Group = 'baseline'; Multi = $true;  What = ((New-Text @(0x5386,0x53F2,0x72B6,0x6001,0x91C7,0x96C6,0x8F93,0x51FA,0xFF0C,0x7528,0x4F5C,0x5B57,0x6BB5,0x5BF9,0x7167))) }
)

$includeGroups = @('core', 'support')
if ($IncludeBaseline) { $includeGroups += 'baseline' }

function Get-Sha256First {
  param([string] $Path, [int] $Chars = 16)
  try {
    $h = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($h.Length -gt $Chars) { return $h.Substring(0, $Chars) }
    return $h
  } catch {
    return ''
  }
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
$startedAt = (Get-Date)
Write-Output ('collect source : ' + $SourceDir)
Write-Output ('collect target : ' + $OutDir)
Write-Output ('include groups : ' + ($includeGroups -join ','))

if (-not (Test-Path -LiteralPath $SourceDir)) {
  Write-Output ('COLLECT-ERROR source folder missing: ' + $SourceDir)
  exit 1
}

if (-not (Test-Path -LiteralPath $OutDir)) {
  New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
}

$rows    = New-Object System.Collections.ArrayList
$missing = New-Object System.Collections.ArrayList
$seen    = @{}

foreach ($spec in $table) {
  $group = [string]$spec['Group']
  if ($includeGroups -notcontains $group) { continue }

  $pattern = [string]$spec['Pattern']
  $hits = @()
  try {
    $hits = @(Get-ChildItem -LiteralPath $SourceDir -File -Filter $pattern -ErrorAction SilentlyContinue | Sort-Object Name)
  } catch {
    [void]$errors.Add('scan ' + $pattern + ': ' + $_.Exception.Message)
  }

  if ($hits.Count -eq 0) {
    [void]$missing.Add([ordered]@{
      pattern = $pattern
      group   = $group
      what    = [string]$spec['What']
    })
    continue
  }

  foreach ($h in $hits) {
    if ($seen.ContainsKey($h.Name)) { continue }
    $seen[$h.Name] = $true

    $dest = Join-Path $OutDir $h.Name
    $copied = $false
    $copyError = ''
    try {
      Copy-Item -LiteralPath $h.FullName -Destination $dest -Force -ErrorAction Stop
      $copied = $true
    } catch {
      $copyError = $_.Exception.Message
      [void]$errors.Add('copy ' + $h.Name + ': ' + $copyError)
    }

    $size = [int64]0
    $sha  = ''
    if ($copied) {
      try { $size = (Get-Item -LiteralPath $dest).Length } catch { $size = [int64]$h.Length }
      $sha = Get-Sha256First -Path $dest
    }

    [void]$rows.Add([ordered]@{
      name      = $h.Name
      pattern   = $pattern
      group     = $group
      what      = [string]$spec['What']
      bytes     = $size
      sourceDate = $h.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')
      sha256_16 = $sha
      copied    = $copied
      error     = $copyError
    })
  }
}

# ---- console summary ------------------------------------------------------
$coreRows    = @($rows    | Where-Object { $_.group -eq 'core' })
$supportRows = @($rows    | Where-Object { $_.group -eq 'support' })
$baselineRows = @($rows   | Where-Object { $_.group -eq 'baseline' })
$coreMissing = @($missing | Where-Object { $_.group -eq 'core' })

Write-Output ('COLLECT-FILES core=' + $coreRows.Count + ' support=' + $supportRows.Count + ' baseline=' + $baselineRows.Count)
Write-Output ('COLLECT-MISSING-CORE ' + $coreMissing.Count)
foreach ($r in $rows) { Write-Output ('  + [' + $r.group + '] ' + $r.name + ' (' + $r.bytes + ' bytes)') }
foreach ($m in $missing) { Write-Output ('  - missing [' + $m.group + '] ' + $m.pattern) }
if ($errors.Count -gt 0) {
  foreach ($e in $errors) { Write-Output ('  ! ' + $e) }
}

# ---- INDEX.md -------------------------------------------------------------
if (-not $NoIndex) {
  $indexPath = Join-Path $OutDir 'INDEX.md'
  $sb = New-Object System.Text.StringBuilder

  $phasePrepared = Test-Path -LiteralPath (Join-Path $OutDir 'phase-prepared.json')
  $journalCopy   = Test-Path -LiteralPath (Join-Path $OutDir 'journal-prepared.json')
  $verifyInstall = Test-Path -LiteralPath (Join-Path $OutDir 'verify-install.json')
  $timeoutSeen   = Test-Path -LiteralPath (Join-Path $OutDir 'phase-timeout.json')
  $missedSeen    = Test-Path -LiteralPath (Join-Path $OutDir 'phase-missed.json')

  [void]$sb.Append('# S4 ' + ((New-Text @(0x65AD,0x7535,0x5F0F,0x771F,0x5B9E,0x5931,0x8D25,0x6062,0x590D,0x2014,0x2014,0x8BC1,0x636E,0x7D22,0x5F15))) + "`r`n`r`n")
  [void]$sb.Append('- ' + ((New-Text @(0x751F,0x6210,0x65F6,0x95F4))) + ': ' + $startedAt.ToString('yyyy-MM-dd HH:mm:ss zzz') + "`r`n")
  [void]$sb.Append('- ' + ((New-Text @(0x91C7,0x96C6,0x811A,0x672C))) + ': collect-host.ps1' + "`r`n")
  [void]$sb.Append('- ' + ((New-Text @(0x6765,0x6E90,0x76EE,0x5F55))) + ': `' + $SourceDir + '`' + "`r`n")
  [void]$sb.Append('- ' + ((New-Text @(0x76EE,0x6807,0x76EE,0x5F55))) + ': `' + $OutDir + '`' + "`r`n")
  [void]$sb.Append('- ' + ((New-Text @(0x662F,0x5426,0x542B,0x57FA,0x7EBF,0x6587,0x4EF6))) + ': ' + $(if ($IncludeBaseline) { ((New-Text @(0x662F))) } else { ((New-Text @(0x5426))) }) + "`r`n")
  [void]$sb.Append("`r`n")

  [void]$sb.Append('## 0. ' + ((New-Text @(0x672C,0x8F6E,0x8BC1,0x636E,0x5B8C,0x6574,0x6027))) + "`r`n`r`n")
  [void]$sb.Append('| ' + ((New-Text @(0x68C0,0x67E5,0x9879))) + ' | ' + ((New-Text @(0x7ED3,0x679C))) + ' |' + "`r`n")
  [void]$sb.Append('| --- | --- |' + "`r`n")
  [void]$sb.Append('| phase-prepared.json' + ((New-Text @(0xFF08)) + 'prepared ' + (New-Text @(0x65F6,0x523B,0x5DF2,0x6355,0x83B7,0xFF09))) + ' | ' + $(if ($phasePrepared) { ((New-Text @(0x6709))) } else { ((New-Text @(0x65E0))) }) + ' |' + "`r`n")
  [void]$sb.Append('| journal-prepared.json' + ((New-Text @(0xFF08)) + 'journal ' + (New-Text @(0x9010,0x5B57,0x8282,0x526F,0x672C,0xFF09))) + ' | ' + $(if ($journalCopy) { ((New-Text @(0x6709))) } else { ((New-Text @(0x65E0))) }) + ' |' + "`r`n")
  [void]$sb.Append('| verify-install.json' + ((New-Text @(0xFF08,0x6062,0x590D,0x540E,0x72B6,0x6001,0x91C7,0x96C6,0xFF09))) + ' | ' + $(if ($verifyInstall) { ((New-Text @(0x6709))) } else { ((New-Text @(0x65E0))) }) + ' |' + "`r`n")
  [void]$sb.Append('| phase-timeout.json' + ((New-Text @(0xFF08,0x9650,0x65F6,0x5185,0x6CA1,0x6293,0x5230)) + ' prepared' + (New-Text @(0xFF09))) + ' | ' + $(if ($timeoutSeen) { ((New-Text @(0x6709,0x2014,0x2014,0x672C,0x8F6E,0x672A,0x5F62,0x6210,0x65AD,0x7535,0x7A97,0x53E3))) } else { ((New-Text @(0x65E0))) }) + ' |' + "`r`n")
  [void]$sb.Append('| phase-missed.json' + ((New-Text @(0xFF08,0x8F6E,0x8BE2,0x8D8A,0x8FC7)) + ' prepared' + (New-Text @(0xFF09))) + ' | ' + $(if ($missedSeen) { ((New-Text @(0x6709,0x2014,0x2014,0x672C,0x8F6E,0x672A,0x80FD,0x5728)) + ' prepared ' + (New-Text @(0x65F6,0x523B,0x65AD,0x7535))) } else { ((New-Text @(0x65E0))) }) + ' |' + "`r`n")
  [void]$sb.Append("`r`n")
  [void]$sb.Append('> ' + ((New-Text @(0x5224,0x5B9A,0x89C4,0x5219,0xFF1A)) + 'phase-prepared.json ' + (New-Text @(0x4E0E)) + ' journal-prepared.json ' + (New-Text @(0x540C,0x65F6,0x5728,0xFF0C,0x4E14)) + ' journal ' + (New-Text @(0x5185)) + ' phase ' + (New-Text @(0x4E3A)) + ' prepared' + (New-Text @(0xFF0C,0x624D,0x7B97,0x5F62,0x6210,0x201C,0x65AD,0x7535,0x5F0F,0x771F,0x5B9E,0x5931,0x8D25,0x201D,0x73B0,0x573A,0xFF1B,0x4E24,0x8005,0x7F3A,0x4E00,0xFF0C,0x672C,0x8F6E)) + ' S4 ' + (New-Text @(0x4E0D,0x6210,0x7ACB,0xFF0C,0x4E0D,0x5F97,0x628A,0x201C,0x91CD,0x65B0,0x94FA,0x4E00,0x904D,0x518D,0x5347,0x7EA7,0x6210,0x529F,0x201D,0x5F53,0x4F5C,0x6062,0x590D,0x8BC1,0x636E,0x3002))) + "`r`n`r`n")

  [void]$sb.Append('## 1. ' + ((New-Text @(0x5EFA,0x8BAE,0x5224,0x8BFB,0x987A,0x5E8F))) + "`r`n`r`n")
  [void]$sb.Append('1. `phase-prepared.json` ' + ((New-Text @(0x2014))) + ' ' + ((New-Text @(0x786E,0x8BA4,0x6355,0x83B7,0x65F6,0x95F4,0x3001)) + 'journal sha256' + (New-Text @(0x3001)) + 'stage ' + (New-Text @(0x76EE,0x5F55,0x6570,0x4E0E,0x5B57,0x8282,0x6570))) + "`r`n")
  [void]$sb.Append('2. `journal-prepared.json` ' + ((New-Text @(0x2014))) + ' ' + ((New-Text @(0x786E,0x8BA4)) + ' phase ' + (New-Text @(0x5C31,0x662F)) + ' prepared' + (New-Text @(0xFF08,0x4E0D,0x662F)) + ' old-renamed/new-published/committed' + (New-Text @(0xFF09))) + "`r`n")
  [void]$sb.Append('3. `phase-watch.log` ' + ((New-Text @(0x2014))) + ' ' + ((New-Text @(0x786E,0x8BA4,0x65AD,0x7535,0x524D,0x6700,0x540E,0x4E00,0x6B21,0x5FC3,0x8DF3,0x65F6,0x95F4,0x4E0E,0x5BBF,0x4E3B,0x4FA7)) + ' stop ' + (New-Text @(0x65F6,0x95F4,0x7684,0x524D,0x540E,0x5173,0x7CFB))) + "`r`n")
  [void]$sb.Append('4. `verify-install.json` ' + ((New-Text @(0x2014))) + ' ' + ('hints.journalPhase / hints.stageDirCount / dataFileCount / workerOutputs.recovered') + "`r`n")
  [void]$sb.Append('5. ' + ((New-Text @(0x5931,0x8D25,0x7801,0x68C0,0x7D22))) + ' ' + ((New-Text @(0x2014))) + ' ' + ((New-Text @(0x5728)) + ' `upgrade*.log` ' + (New-Text @(0x4E0E)) + ' `verify-install.json` ' + (New-Text @(0x7684)) + ' `workerOutputs.errorCodesSeen` ' + (New-Text @(0x91CC,0x627E)) + ' RECOVERY_REQUIRED / STAGE_OWNERSHIP_UNPROVEN / NATIVE_ACL_REFUSED') + "`r`n`r`n")

  [void]$sb.Append('## 2. ' + ((New-Text @(0x6587,0x4EF6,0x6E05,0x5355))) + "`r`n`r`n")
  if ($rows.Count -eq 0) {
    [void]$sb.Append([string]((New-Text @(0xFF08,0x672C,0x6B21,0x672A,0x590D,0x5236,0x5230,0x4EFB,0x4F55,0x6587,0x4EF6,0xFF09))) + "`r`n`r`n")
  } else {
    [void]$sb.Append('| ' + ((New-Text @(0x6587,0x4EF6))) + ' | ' + ((New-Text @(0x5206,0x7C7B))) + ' | ' + ((New-Text @(0x4F5C,0x7528))) + ' | ' + ((New-Text @(0x5B57,0x8282))) + ' | ' + ((New-Text @(0x6E90,0x6587,0x4EF6,0x4FEE,0x6539,0x65F6,0x95F4))) + ' | SHA256(' + ((New-Text @(0x524D)) + '16' + (New-Text @(0x4F4D))) + ') |' + "`r`n")
    [void]$sb.Append('| --- | --- | --- | --- | --- | --- |' + "`r`n")
    foreach ($r in $rows) {
      [void]$sb.Append('| `' + $r.name + '` | ' + $r.group + ' | ' + $r.what + ' | ' + $r.bytes + ' | ' + $r.sourceDate + ' | `' + $r.sha256_16 + '` |' + "`r`n")
    }
    [void]$sb.Append("`r`n")
  }

  [void]$sb.Append('## 3. ' + ((New-Text @(0x7F3A,0x5931,0x9879))) + "`r`n`r`n")
  if ($missing.Count -eq 0) {
    [void]$sb.Append([string]((New-Text @(0xFF08,0x65E0,0xFF1A,0x6E05,0x5355,0x5185,0x6240,0x6709,0x6761,0x76EE,0x90FD,0x547D,0x4E2D,0xFF09))) + "`r`n`r`n")
  } else {
    foreach ($m in $missing) {
      [void]$sb.Append('- `' + $m.pattern + '` [' + $m.group + '] ' + ((New-Text @(0x2014))) + ' ' + $m.what + "`r`n")
    }
    [void]$sb.Append("`r`n")
  }

  [void]$sb.Append('## 4. ' + ((New-Text @(0x5224,0x8BFB,0x8981,0x70B9,0xFF08,0x4E0E)) + ' README.md ' + (New-Text @(0x7B2C)) + ' 8 ' + (New-Text @(0x8282,0x4E00,0x81F4,0xFF09))) + "`r`n`r`n")
  [void]$sb.Append('- `recovered:true` ' + ((New-Text @(0x53EA,0x8BF4,0x660E,0x6062,0x590D,0x6D41,0x7A0B,0x8DD1,0x8FC7,0xFF1B,0x5FC5,0x987B,0x518D,0x5206))) + ' `completed:true`' + ((New-Text @(0xFF08))) + ((New-Text @(0x505C,0x5728)) + ' 1.7.0') + ((New-Text @(0xFF09))) + ((New-Text @(0x4E0E))) + ' `rolledBack:true`' + ((New-Text @(0xFF08))) + ((New-Text @(0x56DE,0x5230)) + ' 1.6.2') + ((New-Text @(0xFF09,0x3002))) + "`r`n")
  [void]$sb.Append('- `RECOVERY_REQUIRED` ' + ((New-Text @(0x2014))) + ' ' + ((New-Text @(0x6062,0x590D,0x8BB0,0x5F55,0x672A,0x77E5)) + '/' + (New-Text @(0x4E0D,0x5B8C,0x6574)) + '/' + (New-Text @(0x7ED1,0x5B9A,0x51B2,0x7A81,0xFF0C,0x6216,0x8865,0x4E01,0x4E8B,0x52A1,0x76EE,0x5F55,0x5728,0x800C,0x95E8,0x7981,0x7F3A,0x5931,0x3002,0x6293,0xFF1A)) + 'journal.json' + (New-Text @(0x3001)) + '.xjy-initial-upgrade\recovery-status.json' + (New-Text @(0x3001)) + 'upgrade*.log ' + (New-Text @(0x5168,0x6587,0x3002))) + "`r`n")
  [void]$sb.Append('- `STAGE_OWNERSHIP_UNPROVEN` ' + ((New-Text @(0x2014))) + ' ' + ('mkdir ' + (New-Text @(0x7A97,0x53E3,0x5185,0x51FA,0x73B0,0x76EE,0x5F55,0x4F46,0x65E0,0x6CD5,0x8BC1,0x660E,0x5F52,0x5C5E,0x3002,0x6293,0xFF1A)) + 'phase-prepared.json ' + (New-Text @(0x7684)) + ' stageDirs ' + (New-Text @(0x6E05,0x5355)) + ' + ' + (New-Text @(0x65AD,0x7535,0x540E)) + ' F: ' + (New-Text @(0x6839,0x76EE,0x5F55)) + ' listing' + (New-Text @(0x3002))) + "`r`n")
  [void]$sb.Append('- `NATIVE_ACL_REFUSED` ' + ((New-Text @(0x2014))) + ' ' + ((New-Text @(0x539F,0x751F)) + ' ACL ' + (New-Text @(0x5199,0x5165,0x88AB,0x62D2,0x3002,0x6293,0xFF1A)) + 'verify-install.json ' + (New-Text @(0x7684)) + ' machine.userSid/isElevated' + (New-Text @(0x3001,0x5B89,0x88C5,0x6839)) + ' topLevel' + (New-Text @(0x3001,0x5BF9,0x5E94,0x65E5,0x5FD7,0x5C3E,0x90E8,0x3002))) + "`r`n")
  [void]$sb.Append('- ' + ((New-Text @(0x4E1A,0x52A1,0x6570,0x636E))) + ' ' + ((New-Text @(0x2014))) + ' `verify-install.json` ' + ((New-Text @(0x7684))) + ' `dataFileCount` / `dataBytes` ' + ((New-Text @(0x5FC5,0x987B,0x4E0E,0x57FA,0x7EBF,0x4E00,0x81F4,0xFF1B,0x4E0D,0x4E00,0x81F4,0x5373,0x89C6,0x4E3A,0x6570,0x636E,0x9762,0x53D7,0x635F,0xFF0C,0x65E0,0x8BBA,0x5347,0x7EA7,0x662F,0x5426,0x6210,0x529F,0x3002))) + "`r`n")
  [void]$sb.Append('- ' + ((New-Text @(0x6B8B,0x7559)) + ' stage') + ' ' + ((New-Text @(0x2014))) + ' ' + ('`hints.stageDirCount` > 0 ' + (New-Text @(0x65F6,0xFF0C,0x5FC5,0x987B,0x786E,0x8BA4,0x6CA1,0x6709,0x4EFB,0x4F55)) + ' stage ' + (New-Text @(0x76EE,0x5F55,0x88AB,0x5F53,0x4F5C,0x65B0,0x7684,0x6709,0x6548,0x5B89,0x88C5,0x76EE,0x6807,0xFF08,0x5B89,0x88C5,0x6839,0x4ECD,0x6307,0x5411)) + ' xjy-jewelry-offline' + (New-Text @(0xFF0C,0x800C,0x4E0D,0x662F)) + ' .program.engine-stage-*' + (New-Text @(0xFF09,0x3002))) + "`r`n`r`n")

  [void]$sb.Append('## 5. ' + ((New-Text @(0x91C7,0x96C6,0x65F6,0x7684,0x9519,0x8BEF))) + "`r`n`r`n")
  if ($errors.Count -eq 0) {
    [void]$sb.Append([string]((New-Text @(0xFF08,0x65E0,0xFF09))) + "`r`n")
  } else {
    foreach ($e in $errors) { [void]$sb.Append('- ' + $e + "`r`n") }
  }

  [System.IO.File]::WriteAllText($indexPath, $sb.ToString(), $Utf8NoBom)
  Write-Output ('COLLECT-INDEX ' + $indexPath)
}

exit 0

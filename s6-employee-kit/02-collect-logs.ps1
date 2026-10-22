#requires -version 5.1
<#
  02-collect-logs.ps1 -- xjy 1.7.0 employee in-app upgrade acceptance: LOG PACKER.

  Runs ON THE EMPLOYEE PC, in a normal user shell, AFTER 01-check.ps1.

  It is strictly read-only towards the installed program:
    * writes exactly one file: %USERPROFILE%\Desktop\xjy-logs.zip
    * reads the JSON produced by 01-check.ps1 and every log it listed
    * never starts, stops, kills or restarts any process
    * never writes registry, never copies or touches the program folder
    * NEVER packs the customer business database or its backups
      (business-data, .xjy-patches, .xjy-initial-upgrade, *.sqlite, *.db, *.xlsx,
       *.zip volumes are hard-excluded, only their paths are named in manifest.txt)

  What goes into the zip
    manifest.txt            what was collected, what was skipped and why
    xjy-check.json          the collector output (if 01-check.ps1 was run first)
    <scope>/<file>          recent *.json / *.log / *.txt / *.ndjson from the
                            product profile folders, the updater folder and the
                            employee-update-cache (the high-water sequence file)

  Usage (employee PC, no admin needed):
    powershell -NoProfile -ExecutionPolicy Bypass -File .\02-collect-logs.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File .\02-collect-logs.ps1 -LogDays 60
    powershell -NoProfile -ExecutionPolicy Bypass -File .\02-collect-logs.ps1 -OutZip D:\xjy-logs.zip

  Source file is pure ASCII; Chinese text is rebuilt at run time from [char]0xXXXX,
  and is written into the zip as real UTF-8, so Chinese file names stay readable.

  Exit code: 0 = zip written, 1 = zip could not be written.
#>
[CmdletBinding()]
param(
  [string]$CheckJson = '',
  [string]$OutZip = '',
  [int]$LogDays = 30,
  [int64]$MaxFileBytes = 8388608,
  [int64]$MaxTotalBytes = 67108864,
  [int]$MaxFiles = 120
)

$ErrorActionPreference = 'Continue'
$ProgressPreference    = 'SilentlyContinue'
$WarningPreference     = 'SilentlyContinue'

# --------------------------------------------------------------- constants ---
function CN { param([int[]]$C) -join ($C | ForEach-Object { [char]$_ }) }

$T_XJY      = CN 0x946B,0x91D1,0x6E90
$T_PRODUCT  = CN 0x946B,0x91D1,0x6E90,0x73E0,0x5B9D,0x62A5,0x4EF7
$T_AUDIT    = CN 0x8865,0x4E01,0x5BA1,0x5B9A
$T_FIRST    = CN 0x521D,0x6B21,0x5347,0x7EA7,0x5BA1,0x5B9A
$T_DONE     = CN 0x5B8C,0x6210
$T_WRITTEN  = CN 0x5DF2,0x5199,0x5165
$T_NEIJI    = CN 0x5185,0x5E10

$PROFILE_ID = 'xjy-jewelry-offline'
$CACHE_DIR  = 'employee-update-cache'
$LOG_RE     = '(?i)(' + $T_PRODUCT + '|xjy)'
$MARKER     = 'xjy-install-activation.json'
$LOG_EXTS   = @('.json', '.log', '.txt', '.ndjson', '.jsonl', '.trace')

# path fragments that are business data or binary volumes -- never packed
$EXCLUDE_FRAGMENTS = @(
  '\business-data\',
  '\.xjy-patches\',
  '\.xjy-initial-upgrade\',
  ('\' + $T_NEIJI + '\'),
  '\Cache\', '\Code Cache\', '\GPUCache\', '\GPUShaderCache\', '\ShaderCache\',
  '\DawnGraphiteCache\', '\DawnWebGPUCache\', '\GrShaderCache\', '\Local Storage\',
  '\Session Storage\', '\blob_storage\', '\Network\', '\Dictionaries\', '\Crashpad\',
  '\crashpad\', '\Shared Dictionary\', '\Service Worker\', '\Partitions\', '\node_modules\'
)
$EXCLUDE_EXTS = @('.sqlite', '.sqlite3', '.db', '.db-wal', '.db-shm', '.xlsx', '.xls',
                  '.zip', '.7z', '.rar', '.bak', '.png', '.jpg', '.jpeg', '.webp', '.gif',
                  '.pdf', '.docx', '.doc', '.exe', '.dll', '.asar', '.bin', '.pak', '.dat')

$notes    = New-Object System.Collections.Generic.List[string]
$skipped  = New-Object System.Collections.Generic.List[object]
$picked   = New-Object System.Collections.Generic.List[object]
$seenPath = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
$seenName = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)

function Note { param([string]$m) if ($m) { $notes.Add([string]$m) } }
function Write-Step { param([string]$m) Write-Host ('[.] ' + $m) }

function Test-Leaf { param([string]$Path) if (-not $Path) { return $false } try { return [System.IO.File]::Exists($Path) } catch { return $false } }
function Test-Dir  { param([string]$Path) if (-not $Path) { return $false } try { return [System.IO.Directory]::Exists($Path) } catch { return $false } }

function Get-Desktop {
  $desk = [Environment]::GetFolderPath('Desktop')
  if (-not $desk) { $desk = Join-Path $env:USERPROFILE 'Desktop' }
  return $desk
}

if (-not $CheckJson) { $CheckJson = Join-Path (Get-Desktop) 'xjy-check.json' }
if (-not $OutZip)    { $OutZip    = Join-Path (Get-Desktop) 'xjy-logs.zip' }

# --------------------------------------------------------------- zip engine ---
try { Add-Type -AssemblyName System.IO.Compression        -ErrorAction Stop } catch { }
try { Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction Stop } catch { }
$zipType = ('System.IO.Compression.ZipFile' -as [type])
if (-not $zipType) {
  Write-Host '[X] System.IO.Compression.ZipFile is not available in this PowerShell'
  exit 1
}

# ------------------------------------------------------------- source model ---
$scopeLabels = @{}   # full scope path -> ascii entry folder
$usedLabels  = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
$scopeSeq    = 0

# Zip entry names are kept pure ASCII on purpose: .NET Framework writes UTF-8 names
# WITHOUT the UTF-8 flag, so Explorer would show Chinese folder names as mojibake.
# The original Chinese path of every entry is recorded in manifest.txt instead.
function ConvertTo-AsciiName {
  param([string]$Text)
  if (-not $Text) { return 'x' }
  $sb = New-Object System.Text.StringBuilder
  foreach ($ch in $Text.ToCharArray()) {
    if ([int][char]$ch -lt 128) { [void]$sb.Append($ch) } else { [void]$sb.Append('_') }
  }
  $r = $sb.ToString() -replace '_+', '_'
  $r = $r.Trim('_', ' ', '.', '-')
  if (-not $r) { $r = 'x' }
  if ($r.Length -gt 64) { $r = $r.Substring(0, 64) }
  return $r
}

function Get-ScopeLabel {
  param([string]$Root)
  if (-not $Root) { return 'scope' }
  if ($scopeLabels.ContainsKey($Root)) { return $scopeLabels[$Root] }
  $leaf = ''
  try { $leaf = [System.IO.Path]::GetFileName($Root.TrimEnd('\')) } catch { }
  $label = $null
  if ($leaf -and ($leaf -match '^[\x20-\x7e]+$')) {
    $cand = ConvertTo-AsciiName $leaf
    if (-not $usedLabels.Contains($cand)) { $label = $cand }
  }
  if (-not $label) {
    # keep the readable ASCII tail of a Chinese folder name (usually the SID), prefixed
    # with a stable index so two differently-named folders can never collide
    $tail = ($leaf -replace '[^\x20-\x7e]', '') -replace '^[^A-Za-z0-9]+', ''
    $tail = $tail -replace '[^A-Za-z0-9]+', '-'
    $tail = $tail.Trim('-')
    if ($tail.Length -gt 44) { $tail = $tail.Substring(0, 44).Trim('-') }
    $guard = 0
    do {
      $script:scopeSeq++
      $label = 'd' + $script:scopeSeq
      if ($tail -and $tail.Length -ge 4) { $label = $label + '-' + $tail }
      $guard++
    } while ($usedLabels.Contains($label) -and $guard -lt 60)
  }
  [void]$usedLabels.Add($label)
  $scopeLabels[$Root] = $label
  return $label
}

function Get-RelPath {
  param([string]$Root, [string]$Path)
  try {
    $r = [System.IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
    if ($Path.StartsWith($r, [System.StringComparison]::OrdinalIgnoreCase)) {
      return $Path.Substring($r.Length)
    }
  } catch { }
  return [System.IO.Path]::GetFileName($Path)
}

function Test-Excluded {
  param([string]$Path)
  $full = '\' + $Path.Replace('/', '\').Trim('\') + '\'
  foreach ($f in $EXCLUDE_FRAGMENTS) {
    if ($full.IndexOf($f, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) { return 'excluded path: ' + $f.Trim('\') }
  }
  $ext = ''
  try { $ext = [System.IO.Path]::GetExtension($Path).ToLowerInvariant() } catch { }
  if ($EXCLUDE_EXTS -contains $ext) { return 'excluded type: ' + $ext }
  return $null
}

function Add-Source {
  param([string]$Path, [string]$ScopeRoot, [string]$Kind)
  if (-not $Path) { return }
  if (-not (Test-Leaf $Path)) { return }
  try { $Path = [System.IO.Path]::GetFullPath($Path) } catch { return }
  if ($seenPath.Contains($Path)) { return }
  $why = Test-Excluded -Path $Path
  if ($why) { $skipped.Add([ordered]@{ path = $Path; reason = $why }); return }
  $fi = $null
  try { $fi = New-Object System.IO.FileInfo($Path) } catch { return }
  if (-not $fi.Exists) { return }
  $totalNow = 0
  foreach ($p in $picked) { $totalNow += [int64]$p.size }
  if ($fi.Length -gt $MaxFileBytes) {
    $skipped.Add([ordered]@{ path = $Path; reason = ('too large: ' + $fi.Length + ' bytes') })
    return
  }
  if (($totalNow + $fi.Length) -gt $MaxTotalBytes) {
    $skipped.Add([ordered]@{ path = $Path; reason = 'total size budget reached' })
    return
  }
  if ($picked.Count -ge $MaxFiles) {
    $skipped.Add([ordered]@{ path = $Path; reason = 'file count limit reached' })
    return
  }
  $label = Get-ScopeLabel ([string]$ScopeRoot)
  $rel = (Get-RelPath -Root $ScopeRoot -Path $Path) -replace '\\', '/'
  $relParts = @()
  foreach ($seg in ($rel -split '/')) { $relParts += (ConvertTo-AsciiName $seg) }
  $relAscii = ($relParts -join '/')
  if (-not $relAscii) { $relAscii = ConvertTo-AsciiName $fi.Name }
  $entry = $label + '/' + $relAscii
  $entry = $entry -replace '[\x00-\x1f]', ''
  $base = $entry
  $i = 1
  while ($seenName.Contains($entry)) {
    $i++
    $entry = $base + '.' + $i
    if ($i -gt 50) { $skipped.Add([ordered]@{ path = $Path; reason = 'name collision' }); return }
  }
  [void]$seenPath.Add($Path)
  [void]$seenName.Add($entry)
  $picked.Add([ordered]@{
    path      = $Path
    entry     = $entry
    size      = $fi.Length
    lastWrite = $fi.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')
    kind      = $Kind
  })
}

function Add-Tree {
  param([string]$Root, [int]$Depth = 3, [int]$CutoffDays = 30)
  if (-not (Test-Dir $Root)) { return }
  $cutoff = (Get-Date).AddDays(-1 * [Math]::Abs($CutoffDays))
  $queue = New-Object System.Collections.Generic.Queue[object]
  $queue.Enqueue([pscustomobject]@{ path = $Root; depth = 0 })
  $visited = 0
  while ($queue.Count -gt 0) {
    if ($visited -gt 800) { Note ('folder walk limit reached under ' + $Root); break }
    $cur = $queue.Dequeue()
    if (-not (Test-Dir $cur.path)) { continue }
    $visited++
    try {
      foreach ($f in (Get-ChildItem -LiteralPath $cur.path -File -ErrorAction SilentlyContinue)) {
        $ext = ''
        try { $ext = $f.Extension.ToLowerInvariant() } catch { }
        if ($LOG_EXTS -notcontains $ext) { continue }
        if ($f.LastWriteTime -lt $cutoff) { continue }
        Add-Source -Path $f.FullName -ScopeRoot $Root -Kind 'log'
      }
    } catch { }
    if ($cur.depth -ge $Depth) { continue }
    try {
      foreach ($sub in (Get-ChildItem -LiteralPath $cur.path -Directory -ErrorAction SilentlyContinue)) {
        if ($sub.Name -in @('Cache','Code Cache','GPUCache','GPUShaderCache','ShaderCache','Local Storage','Session Storage','blob_storage','Network','Dictionaries','Crashpad','crashpad','Partitions','Service Worker','Temp','tmp','node_modules','.git')) { continue }
        if ($sub.Name -eq 'business-data' -or $sub.Name -eq '.xjy-patches' -or $sub.Name -eq '.xjy-initial-upgrade') { continue }
        $queue.Enqueue([pscustomobject]@{ path = $sub.FullName; depth = $cur.depth + 1 })
      }
    } catch { }
  }
}

# ------------------------------------------------------ 1. read check json -----
Write-Step 'reading xjy-check.json'
$check = $null
$checkEntryAdded = $false
if (Test-Leaf $CheckJson) {
  try {
    $txt = [System.IO.File]::ReadAllText($CheckJson, [System.Text.Encoding]::UTF8)
    $check = $txt | ConvertFrom-Json
    Note ('check json read: ' + $CheckJson)
  } catch {
    Note ('check json unreadable, falling back to a fresh scan: ' + $_.Exception.Message)
    $check = $null
  }
} else {
  Note ('check json missing, falling back to a fresh scan: ' + $CheckJson)
}

# the json itself is the single most important piece of evidence
if (Test-Leaf $CheckJson) {
  $fi = New-Object System.IO.FileInfo($CheckJson)
  [void]$seenPath.Add([System.IO.Path]::GetFullPath($CheckJson))
  [void]$seenName.Add('xjy-check.json')
  $picked.Add([ordered]@{
    path      = [System.IO.Path]::GetFullPath($CheckJson)
    entry     = 'xjy-check.json'
    size      = $fi.Length
    lastWrite = $fi.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')
    kind      = 'check-json'
  })
  $checkEntryAdded = $true
}

# --------------------------------------------- 2. every log named in the json ---
if ($check) {
  Write-Step 'collecting logs listed in xjy-check.json'
  try {
    foreach ($row in @($check.logs.files)) {
      if (-not $row) { continue }
      $scope = [string]$row.scope
      if (-not $scope) { $scope = [System.IO.Path]::GetDirectoryName([string]$row.path) }
      Add-Source -Path ([string]$row.path) -ScopeRoot $scope -Kind 'log'
    }
  } catch { Note ('log list unreadable in check json: ' + $_.Exception.Message) }

  try {
    foreach ($cd in @($check.logs.updateCache)) {
      if (-not $cd) { continue }
      $root = [string]$cd.path
      if (-not (Test-Dir $root)) { continue }
      foreach ($f in (Get-ChildItem -LiteralPath $root -File -ErrorAction SilentlyContinue)) {
        if ($LOG_EXTS -notcontains $f.Extension.ToLowerInvariant()) {
          $skipped.Add([ordered]@{ path = $f.FullName; reason = 'cache item not a text log' })
          continue
        }
        Add-Source -Path $f.FullName -ScopeRoot $root -Kind 'update-cache'
      }
    }
  } catch { Note ('update cache list unreadable in check json: ' + $_.Exception.Message) }

  try {
    foreach ($pd in @($check.programData.folders)) {
      if (-not $pd) { continue }
      $root = [string]$pd.path
      if (-not (Test-Dir $root)) { continue }
      $n = 0
      foreach ($e in (Get-ChildItem -LiteralPath $root -Recurse -File -ErrorAction SilentlyContinue)) {
        if ($n -ge 40) { break }
        $n++
        if ($e.Length -gt 262144) { continue }
        if ($LOG_EXTS -notcontains $e.Extension.ToLowerInvariant()) { continue }
        Add-Source -Path $e.FullName -ScopeRoot $root -Kind 'programdata-audit'
      }
    }
  } catch { Note ('program data audit list unreadable in check json: ' + $_.Exception.Message) }
}

# --------------------------------------------- 3. fallback / always-known set ---
Write-Step 'scanning known product folders'
$fallbackBases = New-Object System.Collections.Generic.List[object]
$fallbackBases.Add((Join-Path $env:APPDATA $PROFILE_ID))
$fallbackBases.Add((Join-Path $env:LOCALAPPDATA $PROFILE_ID))
$fallbackBases.Add((Join-Path $env:LOCALAPPDATA ($PROFILE_ID + '-updater')))
$fallbackBases.Add((Join-Path $env:APPDATA (Join-Path $PROFILE_ID $CACHE_DIR)))
$fallbackBases.Add((Join-Path $env:LOCALAPPDATA (Join-Path $PROFILE_ID $CACHE_DIR)))

foreach ($b in @($env:APPDATA, $env:LOCALAPPDATA)) {
  if (-not $b -or -not (Test-Dir $b)) { continue }
  try {
    foreach ($d in (Get-ChildItem -LiteralPath $b -Directory -ErrorAction SilentlyContinue)) {
      if ($d.Name -match $LOG_RE) { $fallbackBases.Add($d.FullName) }
    }
  } catch { }
}

foreach ($b in $fallbackBases) {
  if ($b -and (Test-Dir $b)) { Add-Tree -Root $b -Depth 3 -CutoffDays $LogDays }
}

# native-sequence.json (the high-water mark) may sit one level deeper
foreach ($b in $fallbackBases) {
  if (-not $b) { continue }
  $cd = Join-Path $b $CACHE_DIR
  if (Test-Dir $cd) {
    foreach ($f in (Get-ChildItem -LiteralPath $cd -File -ErrorAction SilentlyContinue)) {
      Add-Source -Path $f.FullName -ScopeRoot $cd -Kind 'high-water'
    }
  }
}

# ------------------------------------------------------- 4. build manifest -----
Write-Step 'building manifest'
$now = Get-Date
$ml = New-Object System.Collections.Generic.List[string]
$ml.Add('xjy 1.7.0 ' + $T_PRODUCT + ' employee in-app upgrade - log bundle')
$ml.Add('====================================================')
$ml.Add('')
$ml.Add('created     : ' + $now.ToString('yyyy-MM-dd HH:mm:ss zzz'))
$ml.Add('computer    : ' + $env:COMPUTERNAME)
$ml.Add('user        : ' + $env:USERDOMAIN + '\' + $env:USERNAME)
$ml.Add('powershell  : ' + $PSVersionTable.PSVersion.ToString())
$ml.Add('logDays     : ' + $LogDays)
$ml.Add('checkJson   : ' + $CheckJson + ' (packed: ' + $checkEntryAdded + ')')
$ml.Add('')
if ($check) {
  $ml.Add('--- identity from xjy-check.json ---')
  $ml.Add('userSid     : ' + [string]$check.identity.userSid)
  $ml.Add('isAdmin     : ' + [string]$check.identity.isAdmin)
  $ml.Add('os          : ' + [string]$check.identity.os)
  $ml.Add('machineGuid : ' + [string]$check.identity.machineGuid)
  $ml.Add('collectedAt : ' + [string]$check.identity.collectedAt)
  $ml.Add('')
  $ml.Add('--- install from xjy-check.json ---')
  $ml.Add('installRoot    : ' + [string]$check.install.chosen)
  $ml.Add('programVersion : ' + [string]$check.install.programVersion)
  $ml.Add('engineVersion  : ' + [string]$check.install.engineVersion)
  $ml.Add('activationRole : ' + [string]$check.install.activationRole)
  $ml.Add('appAsarSha256  : ' + [string]$check.install.appAsarSha256)
  $ml.Add('isR2Client     : ' + [string]$check.install.isR2Client + '  (expected r2 = ' + [string]$check.install.expectedR2Sha256 + ')')
  $ml.Add('')
  $ml.Add('--- patch audit trail (folder names only) ---')
  try {
    foreach ($pa in @($check.install.patchAudit)) {
      if (-not $pa) { continue }
      $ml.Add('[' + [string]$pa.name + ']  ' + [string]$pa.lastWrite)
      foreach ($it in @($pa.items)) { if ($it) { $ml.Add('  ' + [string]$it.name + '   ' + [string]$it.lastWrite + '   subDirs=' + [string]$it.subDirs) } }
    }
  } catch { $ml.Add('(patch audit list unreadable)') }
  $ml.Add('')
  $ml.Add('--- verdict ---')
  $ml.Add('canUpgradeInApp: ' + [string]$check.verdict.canUpgradeInApp)
  $ml.Add('hint           : ' + [string]$check.verdict.hint)
  $ml.Add('')
  if (@($check.notes).Count -gt 0) {
    $ml.Add('--- collector notes ---')
    foreach ($n in @($check.notes)) { $ml.Add('* ' + [string]$n) }
    $ml.Add('')
  }
}
$ml.Add('--- entry folders (name inside zip -> original folder) ---')
foreach ($k in ($scopeLabels.Keys | Sort-Object)) {
  $ml.Add([string]$scopeLabels[$k] + '  ->  ' + [string]$k)
}
$ml.Add('')
$ml.Add('--- files packed (' + $picked.Count + ') ---')
foreach ($p in $picked) {
  $ml.Add(('{0,12}  {1}  {2}  <<  {3}' -f [int64]$p.size, [string]$p.lastWrite, [string]$p.entry, [string]$p.path))
}
$ml.Add('')
$ml.Add('--- files skipped (' + $skipped.Count + ') ---')
foreach ($s in $skipped) { $ml.Add([string]$s.reason + '  <<  ' + [string]$s.path) }
$ml.Add('')
$ml.Add('--- rules ---')
$ml.Add('* read-only: this tool wrote only this zip, no registry write, no process control')
$ml.Add('* business data is NEVER packed: business-data, .xjy-patches, .xjy-initial-upgrade,')
$ml.Add('  *.sqlite, *.db, *.xlsx, *.zip volumes are excluded by name and by type')
$ml.Add('* only text logs and json are packed, each at most ' + $MaxFileBytes + ' bytes')
$ml.Add('* if a log is missing here, run 01-check.ps1 and this script again right after')
$ml.Add('  the failing click, while the panel is still open')
$ml.Add('')
$ml.Add('--- notes ---')
if ($notes.Count -eq 0) { $ml.Add('(none)') } else { foreach ($n in $notes) { $ml.Add('* ' + [string]$n) } }
$manifestText = ($ml -join "`r`n") + "`r`n"

# ------------------------------------------------------------ 5. write zip -----
Write-Step 'writing zip'
if (Test-Leaf $OutZip) {
  try { Remove-Item -LiteralPath $OutZip -Force -ErrorAction Stop }
  catch { Note ('old zip could not be removed: ' + $_.Exception.Message) }
}
$dir = [System.IO.Path]::GetDirectoryName($OutZip)
if ($dir -and -not (Test-Dir $dir)) {
  try { [void][System.IO.Directory]::CreateDirectory($dir) } catch { }
}

$ok = $false
$zipped = 0
try {
  $fs = [System.IO.File]::Open($OutZip, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
  try {
    $enc = New-Object System.Text.UTF8Encoding($false)
    $zip = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Create, $true, $enc)
    try {
      # manifest first, so a half-written zip still explains itself
      $ms = $zip.CreateEntry('manifest.txt', [System.IO.Compression.CompressionLevel]::Optimal)
      $st = $ms.Open()
      try {
        $sw = New-Object System.IO.StreamWriter($st, $enc)
        try { $sw.Write($manifestText); $sw.Flush() } finally { $sw.Dispose() }
      } finally { try { $st.Dispose() } catch { } }

      foreach ($p in $picked) {
        try {
          [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
            $zip, [string]$p.path, [string]$p.entry,
            [System.IO.Compression.CompressionLevel]::Optimal)
          $zipped++
        } catch {
          Note ('entry failed: ' + [string]$p.entry + ' :: ' + $_.Exception.Message)
        }
      }
    } finally { $zip.Dispose() }
  } finally { $fs.Dispose() }
  $ok = $true
} catch {
  Write-Host ('[X] could not write zip: ' + $_.Exception.Message)
  Note ('zip write failed: ' + $_.Exception.Message)
}

if ($ok) {
  $size = 0
  try { $size = (New-Object System.IO.FileInfo($OutZip)).Length } catch { }
  Write-Host ('[' + $T_DONE + '] ' + $T_WRITTEN + ' ' + $OutZip + ' (' + $size + ' bytes)')
  Write-Host ('      entries = ' + ($zipped + 1) + '   logs = ' + $zipped + '   skipped = ' + $skipped.Count)
  if (-not $checkEntryAdded) { Write-Host '      note: xjy-check.json was not found, run 01-check.ps1 first for full evidence' }
  exit 0
}
Write-Host '[X] xjy-logs.zip was not written'
exit 1

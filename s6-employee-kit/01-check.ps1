#requires -version 5.1
<#
  01-check.ps1 -- xjy 1.7.0 employee in-app upgrade acceptance: READ-ONLY collector.

  Runs ON THE EMPLOYEE PC, in a normal user shell. It is strictly read-only:
    * writes exactly one file: %USERPROFILE%\Desktop\xjy-check.json
    * reads registry (Uninstall keys) but NEVER writes registry
    * never starts, stops, kills or restarts any process
    * never touches the installed program files (no copy, no delete, no rename)

  What it collects
    1. identity        : computer name, user, active SID, elevation, OS, PowerShell
    2. install root    : Uninstall keys whose DisplayName matches /(xjy)|(product CN)/i,
                         then every plausible install folder, checked for
                         xjy-install-activation.json / version / <product>.exe
    3. client identity : sha256 of <root>\resources\app.asar, compared with the known
                         r2 client hash (r2 = the build that carries the in-app upgrade)
    4. update evidence : recent *.json / *.log / *.txt under %APPDATA% and %LOCALAPPDATA%
                         that belong to the product, with the last 20 lines of each
    5. audit folders   : %ProgramData%\<patch audit>-<SID> and the first-install variant

  The source file is pure ASCII; every Chinese literal is rebuilt at run time from
  [char]0xXXXX code points, so the script is safe on any code page and survives
  copy/paste through chat, mail or a USB stick.

  Usage (employee PC, no admin needed):
    powershell -NoProfile -ExecutionPolicy Bypass -File .\01-check.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File .\01-check.ps1 -OutFile D:\xjy-check.json
    powershell -NoProfile -ExecutionPolicy Bypass -File .\01-check.ps1 -LogDays 60

  Exit code: 0 = JSON written, 1 = JSON could not be written.
#>
[CmdletBinding()]
param(
  [string]$OutFile = '',
  [int]$LogDays = 30,
  [int]$MaxLogFiles = 80,
  [int]$LogTailLines = 20,
  [int]$ScanBudgetSeconds = 25,
  [int]$MaxCandidateRoots = 16,
  [int]$MaxLineChars = 400,
  [int]$MaxLogChars = 150000
)

$ErrorActionPreference = 'Continue'
$ProgressPreference    = 'SilentlyContinue'
$WarningPreference     = 'SilentlyContinue'

# --------------------------------------------------------------- constants ---
function CN { param([int[]]$C) -join ($C | ForEach-Object { [char]$_ }) }

$T_XJY      = CN 0x946B,0x91D1,0x6E90                                            # short product name
$T_PRODUCT  = CN 0x946B,0x91D1,0x6E90,0x73E0,0x5B9D,0x62A5,0x4EF7                # full product name
$T_AUDIT    = CN 0x8865,0x4E01,0x5BA1,0x5B9A                                    # "patch audit"
$T_FIRST    = CN 0x521D,0x6B21,0x5347,0x7EA7,0x5BA1,0x5B9A                      # "first install audit"
$T_HELPER   = CN 0x53D7,0x4FE1,0x52A9,0x624B                                    # trusted helper folder
$T_UPDATE   = CN 0x5458,0x5DE5,0x5347,0x7EA7                                    # employee update folder
$T_DONE     = CN 0x5B8C,0x6210                                                  # "done"
$T_WRITTEN  = CN 0x5DF2,0x5199,0x5165                                            # "written to"

$MARKER     = 'xjy-install-activation.json'
$EXE_NAME   = $T_PRODUCT + '.exe'
$NAME_RE    = '(?i)(' + $T_XJY + '|xjy)'
# Log folders are filtered much more tightly: several unrelated products share the
# same brand word, and their data files are not upgrade evidence.
$LOG_RE     = '(?i)(' + $T_PRODUCT + '|xjy)'
$PROFILE_ID = 'xjy-jewelry-offline'
$CACHE_DIR  = 'employee-update-cache'
$R2_SHA     = '9593b161f7091f5b471ce4918afee480097105b5668abbe154eb60075b1025a4'

$notes = New-Object System.Collections.Generic.List[string]
function Note { param([string]$m) if ($m) { $notes.Add([string]$m) } }

function Write-Step { param([string]$m) Write-Host ('[.] ' + $m) }

if (-not $OutFile) {
  $desk = [Environment]::GetFolderPath('Desktop')
  if (-not $desk) { $desk = Join-Path $env:USERPROFILE 'Desktop' }
  $OutFile = Join-Path $desk 'xjy-check.json'
}

# ---------------------------------------------------------------- helpers ---
function Test-Leaf { param([string]$Path) if (-not $Path) { return $false } try { return [System.IO.File]::Exists($Path) } catch { return $false } }
function Test-Dir  { param([string]$Path) if (-not $Path) { return $false } try { return [System.IO.Directory]::Exists($Path) } catch { return $false } }

function Try-ReadText {
  param([string]$Path, [int]$MaxChars = 65536)
  try {
    $t = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
    if ($null -eq $t) { return '' }
    if ($t.Length -gt $MaxChars) { return $t.Substring(0, $MaxChars) }
    return $t
  } catch { return $null }
}

function Try-ReadJson {
  param([string]$Path)
  $t = Try-ReadText -Path $Path -MaxChars 131072
  if (-not $t) { return $null }
  # tolerate a UTF-8 BOM read as a stray character
  $t = $t.TrimStart([char]0xFEFF)
  try { return ($t | ConvertFrom-Json) } catch { return $null }
}

function Get-Sha256 {
  param([string]$Path)
  try {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
      $fs = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
      try { return ([System.BitConverter]::ToString($sha.ComputeHash($fs)) -replace '-', '').ToLowerInvariant() }
      finally { $fs.Dispose() }
    } finally { $sha.Dispose() }
  } catch { Note ('sha256 failed: ' + $Path + ' :: ' + $_.Exception.Message); return $null }
}

function Get-TailLines {
  param([string]$Path, [int]$Lines = 20, [int]$MaxBytes = 262144, [int]$MaxLine = 400)
  $res = New-Object System.Collections.Generic.List[string]
  $trunc = $false
  try {
    $fi = New-Object System.IO.FileInfo($Path)
    if (-not $fi.Exists) { return [ordered]@{ lines = @(); truncated = $false; error = 'missing' } }
    if ($fi.Length -eq 0) { return [ordered]@{ lines = @(); truncated = $false; error = $null } }
    $take = [int][System.Math]::Min([int64]$MaxBytes, $fi.Length)
    if ($take -lt $fi.Length) { $trunc = $true }
    $fs = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    try {
      if ($take -lt $fi.Length) { [void]$fs.Seek(-1 * [int64]$take, [System.IO.SeekOrigin]::End) }
      $buf = New-Object byte[] $take
      $read = $fs.Read($buf, 0, $take)
      $text = [System.Text.Encoding]::UTF8.GetString($buf, 0, $read)
    } finally { $fs.Dispose() }
    $arr = @($text -split "`r?`n")
    $start = 0
    if ($arr.Count -gt $Lines) { $start = $arr.Count - $Lines }
    for ($i = $start; $i -lt $arr.Count; $i++) {
      $ln = [string]$arr[$i]
      if ($MaxLine -gt 0 -and $ln.Length -gt $MaxLine) {
        $ln = $ln.Substring(0, $MaxLine) + '...'
        $trunc = $true
      }
      $res.Add($ln)
    }
  } catch {
    $res.Add('(unreadable: ' + $_.Exception.Message + ')')
    return [ordered]@{ lines = $res.ToArray(); truncated = $true; error = $_.Exception.Message }
  }
  return [ordered]@{ lines = $res.ToArray(); truncated = $trunc; error = $null }
}

function Get-FileRow {
  param([string]$Path, [string]$Kind)
  try {
    $fi = New-Object System.IO.FileInfo($Path)
    if (-not $fi.Exists) { return $null }
    return [ordered]@{
      kind      = $Kind
      path      = $fi.FullName
      size      = $fi.Length
      lastWrite = $fi.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')
    }
  } catch { return $null }
}

# ------------------------------------------------------------ 1. identity ----
Write-Step 'identity'
$id = [ordered]@{
  computerName = $env:COMPUTERNAME
  userName     = $env:USERNAME
  userDomain   = $env:USERDOMAIN
  userSid      = $null
  isAdmin      = $null
  machineGuid  = $null
  os           = $null
  powershell   = $PSVersionTable.PSVersion.ToString()
  culture      = (Get-Culture).Name
  collectedAt  = (Get-Date).ToString('o')
  desktop      = [Environment]::GetFolderPath('Desktop')
}

try {
  $wi = [System.Security.Principal.WindowsIdentity]::GetCurrent()
  if ($wi -and $wi.User) { $id.userSid = $wi.User.Value }
  $pr = New-Object System.Security.Principal.WindowsPrincipal($wi)
  $id.isAdmin = $pr.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)
} catch { Note ('identity: ' + $_.Exception.Message) }

try { $id.os = (Get-CimInstance Win32_OperatingSystem -ErrorAction Stop).Caption } catch {
  try { $id.os = [System.Environment]::OSVersion.VersionString } catch { Note 'os version unavailable' }
}
try { $id.machineGuid = (Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Cryptography' -Name MachineGuid -ErrorAction Stop).MachineGuid } catch { Note 'MachineGuid unavailable' }

# --------------------------------------------------- 2. uninstall registry ----
Write-Step 'uninstall registry (read only)'
$regRows = New-Object System.Collections.Generic.List[object]
$regPaths = @(
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
)
foreach ($rp in $regPaths) {
  try {
    foreach ($item in (Get-ItemProperty -Path $rp -ErrorAction SilentlyContinue)) {
      $dn = $null
      try { $dn = [string]$item.DisplayName } catch { $dn = $null }
      if (-not $dn) { continue }
      if ($dn -notmatch $NAME_RE) { continue }
      $hive = 'unknown'
      $psp = [string]$item.PSPath
      if ($psp -match 'HKEY_LOCAL_MACHINE') { $hive = 'HKLM' }
      elseif ($psp -match 'HKEY_CURRENT_USER') { $hive = 'HKCU' }
      $regRows.Add([ordered]@{
        hive            = $hive
        key             = $(if ($psp) { $psp -replace '^.*Uninstall\\', '' } else { $null })
        displayName     = $dn
        displayVersion  = [string]$item.DisplayVersion
        installLocation = [string]$item.InstallLocation
        displayIcon     = [string]$item.DisplayIcon
        uninstallString = [string]$item.UninstallString
        publisher       = [string]$item.Publisher
      })
    }
  } catch { Note ('registry path unreadable: ' + $rp + ' :: ' + $_.Exception.Message) }
}
if ($regRows.Count -eq 0) { Note 'no Uninstall entry matched the product name (portable or cleaned-up install)' }

# ---------------------------------------------------- 3. install root hunt ----
Write-Step 'install root'
$candRoots = New-Object System.Collections.Generic.List[object]
$seenRoot  = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)

function Add-Cand {
  param([string]$Path, [string]$Why)
  if (-not $Path) { return }
  $p = [string]$Path
  $p = $p.Trim()
  $p = $p.Trim('"')
  if (-not $p) { return }
  # DisplayIcon often looks like "C:\x\app.exe,0" -- strip the icon index
  $comma = $p.LastIndexOf(',')
  if ($comma -gt 2) {
    $tail = $p.Substring($comma + 1)
    if ($tail -match '^-?\d+$') { $p = $p.Substring(0, $comma).Trim() }
  }
  if (-not $p) { return }
  $p = $p.Trim('"')
  try {
    if ([System.IO.File]::Exists($p)) { $p = [System.IO.Path]::GetDirectoryName($p) }
  } catch { return }
  if (-not $p) { return }
  try { $p = [System.IO.Path]::GetFullPath($p).TrimEnd('\') } catch { return }
  if (-not (Test-Dir $p)) { return }
  if ($seenRoot.Add($p)) { $candRoots.Add([ordered]@{ root = $p; why = $Why }) }
}

foreach ($r in $regRows) {
  Add-Cand -Path $r.installLocation -Why 'registry InstallLocation'
  Add-Cand -Path $r.displayIcon     -Why 'registry DisplayIcon'
  Add-Cand -Path $r.uninstallString -Why 'registry UninstallString'
}

# name based scan, bounded: usual bases plus every fixed drive root
$bases = New-Object System.Collections.Generic.List[string]
foreach ($b in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, (Join-Path $env:LOCALAPPDATA 'Programs'), $env:USERPROFILE)) {
  if ($b -and (Test-Dir $b)) { $bases.Add($b) }
}
try {
  foreach ($dr in (Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue)) {
    if ($dr.Root -and $dr.Root -match '^[A-Za-z]:\\$') { if (-not $bases.Contains($dr.Root.TrimEnd('\'))) { $bases.Add($dr.Root.TrimEnd('\')) } }
  }
} catch { Note 'drive enumeration failed' }

$sw = [System.Diagnostics.Stopwatch]::StartNew()
foreach ($b in $bases) {
  if ($candRoots.Count -ge $MaxCandidateRoots) { break }
  if ($sw.Elapsed.TotalSeconds -gt $ScanBudgetSeconds) { Note ('install scan stopped at budget ' + $ScanBudgetSeconds + ' s'); break }
  if (-not (Test-Dir $b)) { continue }
  try {
    foreach ($d in (Get-ChildItem -LiteralPath $b -Directory -ErrorAction SilentlyContinue)) {
      if ($sw.Elapsed.TotalSeconds -gt $ScanBudgetSeconds) { break }
      if ($d.Name -match $NAME_RE) {
        Add-Cand -Path $d.FullName -Why 'folder name match'
        if ($candRoots.Count -lt $MaxCandidateRoots) {
          foreach ($sub in (Get-ChildItem -LiteralPath $d.FullName -Directory -ErrorAction SilentlyContinue)) {
            if (Test-Leaf (Join-Path $sub.FullName $EXE_NAME) -or (Test-Leaf (Join-Path $sub.FullName $MARKER))) {
              Add-Cand -Path $sub.FullName -Why 'folder name match, one level deeper'
            }
            if ($candRoots.Count -ge $MaxCandidateRoots) { break }
          }
        }
      }
    }
  } catch { Note ('folder scan failed under ' + $b + ' :: ' + $_.Exception.Message) }
}

# ------------------------------------------------------- 4. per-root probe ----
Write-Step 'install artifacts'
$detail = New-Object System.Collections.Generic.List[object]
foreach ($c in $candRoots) {
  $root  = $c.root
  $row   = [ordered]@{ root = $root; detectedBy = $c.why; score = 0 }
  $markerPath = Join-Path $root $MARKER
  $exePath    = Join-Path $root $EXE_NAME
  $verPath    = Join-Path $root 'version'
  $asarPath   = Join-Path $root 'resources\app.asar'

  $row.hasMarker = Test-Leaf $markerPath
  $row.hasExe    = Test-Leaf $exePath
  $row.hasAsar   = Test-Leaf $asarPath
  $row.hasVersionFile = Test-Leaf $verPath

  if ($row.hasMarker) { $row.score += 8 }
  if ($row.hasAsar)   { $row.score += 4 }
  if ($row.hasExe)    { $row.score += 2 }
  if ($row.hasVersionFile) { $row.score += 1 }

  $row.activationRaw = $null
  $row.activation = $null
  if ($row.hasMarker) {
    $row.activationRaw = Try-ReadText -Path $markerPath -MaxChars 4096
    $row.activation = Try-ReadJson -Path $markerPath
  }

  $row.versionFile = $null
  if ($row.hasVersionFile) {
    $row.versionFile = [ordered]@{
      path    = $verPath
      content = (Try-ReadText -Path $verPath -MaxChars 256)
      size    = $null
    }
    try { $row.versionFile.size = (New-Object System.IO.FileInfo($verPath)).Length } catch { }
  }

  $row.executables = @()
  $exePaths = New-Object System.Collections.Generic.List[string]
  if ($row.hasExe) { $exePaths.Add($exePath) }
  $helperDir = Join-Path $root $T_HELPER
  if (Test-Dir $helperDir) {
    try {
      foreach ($f in (Get-ChildItem -LiteralPath $helperDir -Filter '*.exe' -File -ErrorAction SilentlyContinue | Select-Object -First 4)) {
        if (-not $exePaths.Contains($f.FullName)) { $exePaths.Add($f.FullName) }
      }
    } catch { }
  }
  foreach ($ep in $exePaths) {
    try {
      $vi = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($ep)
      $fi = New-Object System.IO.FileInfo($ep)
      $row.executables += [ordered]@{
        path           = $ep
        fileVersion    = $vi.FileVersion
        productVersion = $vi.ProductVersion
        productName    = $vi.ProductName
        company        = $vi.CompanyName
        size           = $fi.Length
        lastWrite      = $fi.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')
      }
    } catch { Note ('exe version unreadable: ' + $ep) }
  }

  $row.appAsar = $null
  if ($row.hasAsar) {
    $fi = $null
    try { $fi = New-Object System.IO.FileInfo($asarPath) } catch { }
    $sha = Get-Sha256 -Path $asarPath
    $row.appAsar = [ordered]@{
      path      = $asarPath
      size      = $(if ($fi) { $fi.Length } else { $null })
      lastWrite = $(if ($fi) { $fi.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss') } else { $null })
      sha256    = $sha
      isR2      = $(if ($sha) { ($sha -eq $R2_SHA) } else { $null })
    }
  }

  $row.keyFolders = @()
  foreach ($kd in @($T_UPDATE, 'resources', 'logs', 'data', 'update-helper', '.xjy-patches', '.xjy-initial-upgrade')) {
    $kp = Join-Path $root $kd
    if (Test-Dir $kp) { $row.keyFolders += [ordered]@{ name = $kd; path = $kp; kind = 'dir' } }
    elseif (Test-Leaf $kp) { $row.keyFolders += [ordered]@{ name = $kd; path = $kp; kind = 'file' } }
  }

  # Patch audit trail: folder NAMES only (each name is a content hash). The files inside
  # are the customer's business database and backups, so they are never read or copied.
  $row.patchAudit = @()
  foreach ($pa in @('.xjy-patches', '.xjy-initial-upgrade')) {
    $pap = Join-Path $root $pa
    if (-not (Test-Dir $pap)) { continue }
    $paRow = [ordered]@{ name = $pa; path = $pap; lastWrite = $null; items = @() }
    try { $paRow.lastWrite = (Get-Item -LiteralPath $pap -Force).LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss') } catch { }
    $pn = 0
    try {
      foreach ($it in (Get-ChildItem -LiteralPath $pap -Directory -ErrorAction SilentlyContinue)) {
        if ($pn -ge 20) { break }
        $pn++
        $subs = 0
        try { $subs = @(Get-ChildItem -LiteralPath $it.FullName -Directory -ErrorAction SilentlyContinue).Count } catch { }
        $paRow.items += [ordered]@{
          name      = $it.Name
          lastWrite = $it.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')
          subDirs   = $subs
        }
      }
    } catch { }
    $row.patchAudit += $paRow
  }

  $detail.Add($row)
}

$chosen = $null
foreach ($d in $detail) {
  if (-not $chosen) { $chosen = $d; continue }
  if ([int]$d.score -gt [int]$chosen.score) { $chosen = $d }
}
if (-not $chosen) { Note 'install root not found; program version and asar hash are unknown (pass the real folder to -InstallRoot next time)' }

$install = [ordered]@{
  registryEntries = $regRows.ToArray()
  candidates      = $detail.ToArray()
  chosen          = $(if ($chosen) { $chosen.root } else { $null })
  chosenBy        = $(if ($chosen) { $chosen.detectedBy } else { $null })
  programVersion  = $(if ($chosen -and $chosen.activation -and $chosen.activation.programVersion) { [string]$chosen.activation.programVersion } else { $null })
  activationRole  = $(if ($chosen -and $chosen.activation -and $chosen.activation.role) { [string]$chosen.activation.role } else { $null })
  engineVersion   = $(if ($chosen -and $chosen.versionFile) { [string]$chosen.versionFile.content } else { $null })
  appAsarSha256   = $(if ($chosen -and $chosen.appAsar) { $chosen.appAsar.sha256 } else { $null })
  isR2Client      = $(if ($chosen -and $chosen.appAsar) { $chosen.appAsar.isR2 } else { $null })
  patchAudit      = $(if ($chosen) { $chosen.patchAudit } else { @() })
  expectedR2Sha256 = $R2_SHA
}

# ----------------------------------------------------------- 5. update logs ---
Write-Step 'update logs and json'
$logBases = New-Object System.Collections.Generic.List[string]
foreach ($b in @($env:APPDATA, $env:LOCALAPPDATA)) {
  if (-not $b -or -not (Test-Dir $b)) { continue }
  try {
    foreach ($d in (Get-ChildItem -LiteralPath $b -Directory -ErrorAction SilentlyContinue)) {
      if ($d.Name -match $LOG_RE) { if (-not $logBases.Contains($d.FullName)) { $logBases.Add($d.FullName) } }
    }
  } catch { Note ('log base scan failed: ' + $b) }
}
# the two folders the shipped client documents, even when the name check above missed them
foreach ($known in @((Join-Path $env:APPDATA $PROFILE_ID), (Join-Path $env:LOCALAPPDATA ($PROFILE_ID + '-updater')))) {
  if ((Test-Dir $known) -and -not $logBases.Contains($known)) { $logBases.Add($known) }
}

$cacheDirs = New-Object System.Collections.Generic.List[object]
foreach ($b in @($env:APPDATA, $env:LOCALAPPDATA)) {
  if (-not $b) { continue }
  $cd = Join-Path $b ($PROFILE_ID + '\' + $CACHE_DIR)
  if (Test-Dir $cd) {
    $entry = [ordered]@{ path = $cd; files = @() }
    try {
      foreach ($f in (Get-ChildItem -LiteralPath $cd -File -ErrorAction SilentlyContinue)) {
        $entry.files += [ordered]@{
          name      = $f.Name
          size      = $f.Length
          lastWrite = $f.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')
          content   = (Try-ReadText -Path $f.FullName -MaxChars 2048)
        }
      }
    } catch { Note ('update cache unreadable: ' + $cd) }
    $cacheDirs.Add($entry)
  }
}

$skipDirs = @('Cache','Code Cache','GPUCache','GPUShaderCache','ShaderCache','DawnGraphiteCache','DawnWebGPUCache',
              'GrShaderCache','Local Storage','Session Storage','blob_storage','Network','Dictionaries','Crashpad',
              'crashpad','Temp','tmp','node_modules','.git','Partitions','Service Worker')
$logExts  = @('.json','.log','.txt','.ndjson','.trace','.jsonl')
$cutoff   = (Get-Date).AddDays(-1 * [Math]::Abs($LogDays))
$logRows  = New-Object System.Collections.Generic.List[object]
$visited  = 0
$logChars = 0
$budgetHit = $false

foreach ($baseDir in $logBases) {
  if ($budgetHit) { break }
  $queue = New-Object System.Collections.Generic.Queue[object]
  $queue.Enqueue([pscustomobject]@{ path = $baseDir; depth = 0 })
  while ($queue.Count -gt 0) {
    if ($visited -gt 4000) { Note 'log walk hit the 4000 folder limit'; break }
    $cur = $queue.Dequeue()
    if (-not (Test-Dir $cur.path)) { continue }
    $visited++
    try {
      foreach ($f in (Get-ChildItem -LiteralPath $cur.path -File -ErrorAction SilentlyContinue)) {
        if ($logRows.Count -ge $MaxLogFiles) { break }
        if ($f.Length -gt 2097152) { continue }
        if ($logExts -notcontains $f.Extension.ToLowerInvariant()) { continue }
        if ($f.LastWriteTime -lt $cutoff) { continue }
        $lines = @()
        $truncated = $false
        $omitted = $false
        if (-not $budgetHit) {
          $tail = Get-TailLines -Path $f.FullName -Lines $LogTailLines -MaxLine $MaxLineChars
          $lines = @($tail.lines)
          $truncated = [bool]$tail.truncated
          $chars = 0
          foreach ($ln in $lines) { $chars += ([string]$ln).Length }
          if (($logChars + $chars) -gt $MaxLogChars) {
            $budgetHit = $true
            $lines = @()
            $omitted = $true
            $truncated = $true
            Note ('log text budget of ' + $MaxLogChars + ' chars reached; later files are listed without content')
          } else {
            $logChars += $chars
          }
        } else {
          $omitted = $true
          $truncated = $true
        }
        $row = [ordered]@{
          path        = $f.FullName
          name        = $f.Name
          size        = $f.Length
          lastWrite   = $f.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')
          scope       = $baseDir
          lines       = $lines
          truncated   = $truncated
          textOmitted = $omitted
        }
        $logRows.Add($row)
      }
    } catch { }
    if ($cur.depth -ge 3) { continue }
    try {
      foreach ($sub in (Get-ChildItem -LiteralPath $cur.path -Directory -ErrorAction SilentlyContinue)) {
        if ($skipDirs -contains $sub.Name) { continue }
        $queue.Enqueue([pscustomobject]@{ path = $sub.FullName; depth = $cur.depth + 1 })
      }
    } catch { }
  }
}

$sortedLogs = @($logRows | Sort-Object { $_.lastWrite } -Descending)

$logs = [ordered]@{
  scannedBases   = $logBases.ToArray()
  days           = $LogDays
  updateCache    = $cacheDirs.ToArray()
  fileCount      = $sortedLogs.Count
  textChars      = $logChars
  maxLogChars    = $MaxLogChars
  maxLineChars   = $MaxLineChars
  files          = $sortedLogs
}

# ---------------------------------------------------------- 6. audit folders --
Write-Step 'program data audit folders'
$pdRows = New-Object System.Collections.Generic.List[object]
if ($env:ProgramData -and (Test-Dir $env:ProgramData)) {
  try {
    foreach ($d in (Get-ChildItem -LiteralPath $env:ProgramData -Directory -ErrorAction SilentlyContinue)) {
      $isAudit = $false
      if ($d.Name -like ('*' + $T_AUDIT + '*')) { $isAudit = $true }
      if ($d.Name -like ('*' + $T_FIRST + '*')) { $isAudit = $true }
      if (-not $isAudit) { continue }
      $sid = $null
      $m = [regex]::Match($d.Name, 'S-1-5-\d+(-\d+)+')
      if ($m.Success) { $sid = $m.Value }
      $row = [ordered]@{
        path         = $d.FullName
        name         = $d.Name
        matchedSid   = $sid
        sidIsCurrent = $(if ($sid -and $id.userSid) { ($sid -eq $id.userSid) } else { $null })
        lastWrite    = $d.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')
        entries      = @()
      }
      $count = 0
      try {
        foreach ($e in (Get-ChildItem -LiteralPath $d.FullName -ErrorAction SilentlyContinue)) {
          if ($count -ge 40) { break }
          $count++
          $entry = [ordered]@{
            name      = $e.Name
            kind      = $(if ($e.PSIsContainer) { 'dir' } else { 'file' })
            size      = $(if ($e.PSIsContainer) { $null } else { $e.Length })
            lastWrite = $e.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')
            children  = @()
          }
          if ($e.PSIsContainer) {
            $cc = 0
            try {
              foreach ($c in (Get-ChildItem -LiteralPath $e.FullName -ErrorAction SilentlyContinue)) {
                if ($cc -ge 20) { break }
                $cc++
                $entry.children += [ordered]@{
                  name      = $c.Name
                  kind      = $(if ($c.PSIsContainer) { 'dir' } else { 'file' })
                  size      = $(if ($c.PSIsContainer) { $null } else { $c.Length })
                  lastWrite = $c.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')
                }
              }
            } catch { }
          }
          $row.entries += $entry
        }
      } catch { Note ('audit folder unreadable: ' + $d.FullName) }
      $pdRows.Add($row)
    }
  } catch { Note ('ProgramData scan failed: ' + $_.Exception.Message) }
}
if ($pdRows.Count -eq 0) { Note 'no patch-audit folder under ProgramData (expected before the first audited upgrade)' }

# ---------------------------------------------------------------- 7. verdict --
$verdict = [ordered]@{
  isR2Client     = $install.isR2Client
  r2Expected     = $R2_SHA
  asarSha256     = $install.appAsarSha256
  programVersion = $install.programVersion
  engineVersion  = $install.engineVersion
  role           = $install.activationRole
  installRoot    = $install.chosen
  canUpgradeInApp = $(if ($install.isR2Client -eq $true) { $true } elseif ($install.isR2Client -eq $false) { $false } else { $null })
  hint           = $null
}
if ($install.isR2Client -eq $true) {
  $verdict.hint = 'r2 client: the in-app upgrade panel is present in this build'
} elseif ($install.isR2Client -eq $false) {
  $verdict.hint = 'NOT the r2 client: this build has no usable in-app upgrade path, the panel will say the entry is unavailable'
} else {
  $verdict.hint = 'app.asar not found: cannot decide the client build; check the install root by hand'
}

$result = [ordered]@{
  schemaVersion = 1
  tool          = [ordered]@{ name = 'xjy-check'; version = '1.0'; readOnly = $true }
  identity      = $id
  install       = $install
  logs          = $logs
  programData   = [ordered]@{ scannedRoot = $env:ProgramData; folders = $pdRows.ToArray() }
  verdict       = $verdict
  notes         = $notes.ToArray()
}

Write-Step 'writing json'
$ok = $false
try {
  $json = $result | ConvertTo-Json -Depth 10
  # Windows PowerShell escapes non-ASCII as \uXXXX; turn those back into real characters
  # so the file stays readable in any text editor. Control characters keep their escape.
  $evaluator = [System.Text.RegularExpressions.MatchEvaluator]{
    param($m)
    $v = [Convert]::ToInt32($m.Groups[1].Value, 16)
    if ($v -ge 128) { return [string][char]$v }
    return $m.Value
  }
  $json = [regex]::Replace($json, '\\u([0-9a-fA-F]{4})', $evaluator)
  $enc = New-Object System.Text.UTF8Encoding($false)
  $dir = [System.IO.Path]::GetDirectoryName($OutFile)
  if ($dir -and -not (Test-Dir $dir)) { [void][System.IO.Directory]::CreateDirectory($dir) }
  [System.IO.File]::WriteAllText($OutFile, $json, $enc)
  $ok = $true
} catch {
  Write-Host ('[X] could not write json: ' + $_.Exception.Message)
  Note ('write failed: ' + $_.Exception.Message)
}

if ($ok) {
  $size = 0
  try { $size = (New-Object System.IO.FileInfo($OutFile)).Length } catch { }
  Write-Host ('[' + $T_DONE + '] ' + $T_WRITTEN + ' ' + $OutFile + ' (' + $size + ' bytes)')
  Write-Host ('      installRoot = ' + $install.chosen)
  Write-Host ('      programVersion = ' + $install.programVersion + '   engine = ' + $install.engineVersion)
  Write-Host ('      isR2Client = ' + $install.isR2Client)
  Write-Host ('      log files = ' + $sortedLogs.Count + '   audit folders = ' + $pdRows.Count)
  exit 0
}
Write-Host '[X] xjy-check.json was not written'
exit 1

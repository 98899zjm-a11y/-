#requires -version 5.1
<#
  employee-collect.ps1  --  xjy in-app upgrade acceptance: EMPLOYEE side, READ ONLY.

  Runs ON THE EMPLOYEE PC. Reads only, changes nothing, starts nothing, kills nothing,
  and writes exactly one file: the diagnostic JSON on the desktop.

  What it gathers
    1. machine identity   : computer name, user, user SID, machine SID (best effort),
                            MachineGuid, OS build, PowerShell version, elevation
    2. installation       : install root (auto-detected), xjy-install-activation.json,
                            version file(s), EXE file versions
    3. processes          : every process that looks like the product (name/path/cmdline),
                            including the Electron helpers
    4. sequence evidence  : the JSON files under %APPDATA% / %LOCALAPPDATA% whose name or
                            content carries the accepted release sequence (the client keeps
                            employee-update-cache/accepted-sequence.json) plus the native
                            install receipt if it can be found
    5. network            : TCP reachability of the host on the update port (31831),
                            local IPv4 addresses, and an HTTP probe of the manifest endpoint
    6. logs               : the last 200 lines of the newest application log, if any

  Nothing is decoded from Chinese literals in this file: every non-ASCII string is built
  from code points with CN, so the script stays pure ASCII and safe on any code page.

  Usage (employee PC, normal user shell is enough):
    powershell -NoProfile -ExecutionPolicy Bypass -File .\employee-collect.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File .\employee-collect.ps1 -HostAddress 192.168.1.10
    powershell -NoProfile -ExecutionPolicy Bypass -File .\employee-collect.ps1 -InstallRoot "D:\XinJinYuan" -LogLines 400

  Exit code: 0 = JSON written, 1 = could not write the JSON.
#>
[CmdletBinding()]
param(
  [string]$HostAddress = '',
  [int]$Port = 31831,
  [int[]]$ExtraPorts = @(),
  [string]$OutFile = '',
  [string]$InstallRoot = '',
  [int]$LogLines = 200,
  [int]$MaxScanDepth = 3,
  [int]$ScanBudgetMs = 45000,
  [switch]$SkipNet,
  [switch]$SkipHttp,
  [switch]$SkipLogs
)

$ErrorActionPreference = 'Continue'
$ProgressPreference    = 'SilentlyContinue'
$WarningPreference     = 'SilentlyContinue'

# --------------------------------------------------------------- constants ---
function CN { param([int[]]$C) -join ($C | ForEach-Object { [char]$_ }) }

$N_XJY      = CN 0x946B,0x91D1,0x6E90                                     # product short name
$N_PRODUCT  = CN 0x946B,0x91D1,0x6E90,0x73E0,0x5B9D,0x62A5,0x4EF7         # product name
$N_MAINEXE  = $N_PRODUCT + '.exe'
$N_HELPER   = CN 0x53D7,0x4FE1,0x52A9,0x624B                              # trusted helper folder
$N_SVC      = CN 0x5458,0x5DE5,0x5347,0x7EA7                              # served release folder
$N_PATCH    = CN 0x8865,0x4E01,0x6587,0x4EF6                              # patch folder
$N_VERDIR   = CN 0x7248,0x672C                                            # "version" label
$N_SCRIPT   = (CN 0x5458,0x5DE5,0x673A) + '-' + (CN 0x91C7,0x96C6) + '.ps1' # this file's own name

$MARKER     = 'xjy-install-activation.json'
$PROFILE_ID = 'xjy-jewelry-offline'
$CACHE_DIR  = 'employee-update-cache'
$ACCEPTED   = 'accepted-sequence.json'

$notes = New-Object System.Collections.Generic.List[string]

function Add-Note { param([string]$m) $notes.Add($m) }

if (-not $OutFile) {
  $desk = [Environment]::GetFolderPath('Desktop')
  if (-not $desk) { $desk = Join-Path $env:USERPROFILE 'Desktop' }
  $OutFile = Join-Path $desk 'xjy-inapp-diag.json'
}

function Try-ReadText {
  param([string]$Path, [int]$MaxChars = 65536)
  $t = $null
  try {
    # ReadAllText returns a plain String; Get-Content -Raw returns a String carrying
    # PSPath/PSDrive note properties, and ConvertTo-Json then serialises the whole
    # FileSystem provider (megabytes of noise). Never feed note-property strings to ConvertTo-Json.
    $t = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
  } catch {
    try { $t = [string](Get-Content -LiteralPath $Path -Raw -Encoding UTF8 -ErrorAction Stop) } catch { return $null }
  }
  if ($null -eq $t) { return '' }
  if ($t.Length -gt $MaxChars) { return $t.Substring(0, $MaxChars) }
  return $t
}

function Try-ReadJson {
  param([string]$Path)
  $t = Try-ReadText $Path
  if (-not $t) { return $null }
  try { return ($t | ConvertFrom-Json) } catch { return $null }
}

# ------------------------------------------------------------ 1. identity ----
Write-Host '[1/6] machine identity ...'
$id = [ordered]@{
  computerName = $env:COMPUTERNAME
  userName     = $env:USERNAME
  userDomain   = $env:USERDOMAIN
  userSid      = $null
  machineSid   = $null
  machineSidMethod = $null
  machineGuid  = $null
  os           = $null
  osBuild      = $null
  powershell   = $PSVersionTable.PSVersion.ToString()
  isAdmin      = $null
  timeZone     = (Get-TimeZone).Id
  culture      = (Get-Culture).Name
  collectedAt  = (Get-Date).ToString('o')
}

try {
  $who = (& whoami /user 2>$null) | Out-String
  $m = [regex]::Match($who, 'S-1-5-21-\d+-\d+-\d+-\d+')
  if ($m.Success) {
    $id.userSid = $m.Value
    $parts = $m.Value.Split('-')
    if ($parts.Length -ge 5) {
      $id.machineSid = ($parts[0..($parts.Length - 2)] -join '-')
      $id.machineSidMethod = 'userSid minus RID (local account heuristic)'
    }
  }
} catch { Add-Note ('user SID: ' + $_.Exception.Message) }

try {
  $mg = (Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Cryptography' -Name MachineGuid -ErrorAction Stop).MachineGuid
  $id.machineGuid = $mg
} catch { Add-Note ('MachineGuid unreadable: ' + $_.Exception.Message) }

try {
  $os = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop
  $id.os      = ($os.Caption + ' ' + $os.Version)
  $id.osBuild = ($os.BuildNumber + ' / ' + $os.OSArchitecture)
} catch { Add-Note ('OS info: ' + $_.Exception.Message) }

try {
  $wp = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  $id.isAdmin = $wp.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
} catch { $id.isAdmin = $null }

# ------------------------------------------------------ 2. install location ---
Write-Host '[2/6] locating the installation ...'

function Test-InstallRoot {
  param([string]$Dir)
  if (-not $Dir) { return $false }
  if (Test-Path -LiteralPath (Join-Path $Dir $MARKER) -PathType Leaf) { return $true }
  if (Test-Path -LiteralPath (Join-Path $Dir $N_MAINEXE) -PathType Leaf) { return $true }
  if (Test-Path -LiteralPath (Join-Path $Dir $N_HELPER) -PathType Container) { return $true }
  return $false
}

$foundRoot  = $null
$foundHow   = $null
if ($InstallRoot) {
  if (Test-Path -LiteralPath $InstallRoot -PathType Container) { $foundRoot = (Resolve-Path -LiteralPath $InstallRoot).Path; $foundHow = 'given with -InstallRoot' }
  else { Add-Note ('-InstallRoot does not exist: ' + $InstallRoot) }
}

if (-not $foundRoot) {
  # pass 1 (fast): folders whose NAME looks like the product, one level below the usual bases
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $namePat = ('(?i)' + [regex]::Escape($N_XJY) + '|^xjy|' + [regex]::Escape($N_PATCH))
  $cands = New-Object System.Collections.Generic.List[string]
  $basesFast = New-Object System.Collections.Generic.List[string]
  foreach ($b in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, (Join-Path $env:LOCALAPPDATA 'Programs'), $env:USERPROFILE, (Join-Path $env:USERPROFILE 'Desktop'))) {
    if ($b -and (Test-Path -LiteralPath $b -PathType Container)) { $basesFast.Add($b) }
  }
  foreach ($dr in @(Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue)) {
    if ($dr.Root -match '^[A-Za-z]:\\$') { $basesFast.Add($dr.Root) }
  }
  foreach ($b in $basesFast) {
    if ($sw.ElapsedMilliseconds -gt 12000) { break }
    foreach ($d in (Get-ChildItem -LiteralPath $b -Directory -ErrorAction SilentlyContinue)) {
      if ($d.Name -match $namePat) { $cands.Add($d.FullName) }
    }
  }
  foreach ($c in $cands) {
    if (Test-InstallRoot $c) { $foundRoot = $c; $foundHow = 'folder-name match (' + (Split-Path -Leaf $c) + ')'; break }
    foreach ($d in (Get-ChildItem -LiteralPath $c -Directory -ErrorAction SilentlyContinue)) {
      if (Test-InstallRoot $d.FullName) { $foundRoot = $d.FullName; $foundHow = 'folder-name match, one level deeper'; break }
    }
    if ($foundRoot) { break }
  }

  # pass 2 (bounded): shallow breadth-first over the usual bases only
  if (-not $foundRoot) {
    $skip = @('Windows', 'System32', 'SysWOW64', 'WinSxS', '$Recycle.Bin', 'System Volume Information',
              'node_modules', '.git', 'Temp', 'tmp', 'Cache', 'cache', 'Microsoft', 'Packages', 'Installer',
              'assembly', 'servicing', 'DriverStore', 'WindowsApps', 'Common Files', 'Internet Explorer')
    $queue = New-Object System.Collections.Generic.Queue[object]
    foreach ($b in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, (Join-Path $env:LOCALAPPDATA 'Programs'), $env:USERPROFILE)) {
      if ($b -and (Test-Path -LiteralPath $b -PathType Container)) { $queue.Enqueue([pscustomobject]@{ path = $b; depth = 0 }) }
    }
    $visited = 0
    $truncated = $false
    while ($queue.Count -gt 0) {
      if ($sw.ElapsedMilliseconds -gt $ScanBudgetMs) { $truncated = $true; break }
      $cur = $queue.Dequeue()
      if (-not (Test-Path -LiteralPath $cur.path -PathType Container)) { continue }
      if (Test-InstallRoot $cur.path) { $foundRoot = $cur.path; $foundHow = ('auto-detected at depth ' + $cur.depth); break }
      if ($cur.depth -ge $MaxScanDepth) { continue }
      $visited++
      if ($visited -gt 1200) { $truncated = $true; break }
      foreach ($sub in (Get-ChildItem -LiteralPath $cur.path -Directory -ErrorAction SilentlyContinue)) {
        if ($skip -contains $sub.Name) { continue }
        $queue.Enqueue([pscustomobject]@{ path = $sub.FullName; depth = $cur.depth + 1 })
      }
    }
    if ($truncated) { Add-Note ('install-root scan stopped early (budget ' + $ScanBudgetMs + ' ms / 1200 dirs); pass -InstallRoot to be exact') }
  }
  if (-not $foundRoot) { Add-Note 'install root not found; marker/version/exe/log sections will be empty (pass -InstallRoot to be exact)' }
}

$install = [ordered]@{
  root      = $foundRoot
  detectedBy = $foundHow
  marker    = $null
  markerRaw = $null
  versionFiles = @()
  executables  = @()
  keyDirs      = @()
  receiptCandidates = @()
}

if ($foundRoot) {
  $mp = Join-Path $foundRoot $MARKER
  if (Test-Path -LiteralPath $mp -PathType Leaf) {
    $install.markerRaw = Try-ReadText $mp 4096
    $install.marker = Try-ReadJson $mp
  }

  # version file(s): the launcher keeps a tiny "version" file next to the program
  $verCandidates = @('version', 'VERSION', 'version.txt', 'Version.txt', 'engine-version',
                     'engine-version.txt', 'app-version', 'package-version')
  foreach ($vc in $verCandidates) {
    $vp = Join-Path $foundRoot $vc
    if (Test-Path -LiteralPath $vp -PathType Leaf) {
      $install.versionFiles += [pscustomobject]@{ path = $vp; content = (Try-ReadText $vp 256); size = (Get-Item -LiteralPath $vp).Length }
    }
  }

  # executables: the main exe plus anything else obvious in the root and one level down
  $exePaths = New-Object System.Collections.Generic.List[string]
  $mainExe = Join-Path $foundRoot $N_MAINEXE
  if (Test-Path -LiteralPath $mainExe -PathType Leaf) { $exePaths.Add($mainExe) }
  foreach ($f in (Get-ChildItem -LiteralPath $foundRoot -Filter '*.exe' -File -ErrorAction SilentlyContinue)) { if (-not $exePaths.Contains($f.FullName)) { $exePaths.Add($f.FullName) } }
  $helperDir = Join-Path $foundRoot $N_HELPER
  if (Test-Path -LiteralPath $helperDir -PathType Container) {
    foreach ($f in (Get-ChildItem -LiteralPath $helperDir -Filter '*.exe' -File -ErrorAction SilentlyContinue | Select-Object -First 5)) {
      if (-not $exePaths.Contains($f.FullName)) { $exePaths.Add($f.FullName) }
    }
  }
  foreach ($ep in $exePaths) {
    try {
      $vi = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($ep)
      $fi = Get-Item -LiteralPath $ep
      $install.executables += [pscustomobject]@{
        path = $ep; fileVersion = $vi.FileVersion; productVersion = $vi.ProductVersion
        productName = $vi.ProductName; company = $vi.CompanyName
        size = $fi.Length; lastWrite = $fi.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')
      }
    } catch { Add-Note ('exe version unreadable: ' + $ep) }
  }

  foreach ($kd in @($N_SVC, $N_PATCH, 'resources', 'logs', 'data', $CACHE_DIR, '.xjy-employee-updates')) {
    $kp = Join-Path $foundRoot $kd
    if (Test-Path -LiteralPath $kp) {
      $install.keyDirs += [pscustomobject]@{ name = $kd; path = $kp; kind = $(if (Test-Path -LiteralPath $kp -PathType Container) { 'dir' } else { 'file' }) }
    }
  }
}

# ------------------------------------------------------------ 3. processes ---
Write-Host '[3/6] processes ...'
$procRows = @()
try {
  foreach ($p in (Get-CimInstance Win32_Process -ErrorAction Stop)) {
    $hit = $false
    if ($p.Name -and ($p.Name -like ('*' + $N_XJY + '*'))) { $hit = $true }
    if ($p.ExecutablePath -and ($p.ExecutablePath -like ('*' + $N_XJY + '*'))) { $hit = $true }
    if ($p.CommandLine -and ($p.CommandLine -like ('*' + $N_XJY + '*'))) { $hit = $true }
    if (-not $hit -and $foundRoot -and $p.ExecutablePath -and $p.ExecutablePath.StartsWith($foundRoot, [System.StringComparison]::OrdinalIgnoreCase)) { $hit = $true }
    if ($hit) {
      $procRows += [pscustomobject]@{
        pid = $p.ProcessId; parentPid = $p.ParentProcessId; name = $p.Name
        executablePath = $p.ExecutablePath; commandLine = $p.CommandLine
        created = $(if ($p.CreationDate) { ([datetime]$p.CreationDate).ToString('yyyy-MM-dd HH:mm:ss') } else { $null })
      }
    }
  }
} catch { Add-Note ('process list: ' + $_.Exception.Message) }
if ($procRows.Count -eq 0) { Add-Note 'no product process is running (the app is closed)' }

# ----------------------------------------------- 4. accepted-sequence proof ---
Write-Host '[4/6] accepted-sequence evidence ...'
$seqFound = @()
$seqDirs  = @()
$seqBases = @($env:APPDATA, $env:LOCALAPPDATA)
if ($env:ProgramData) { $seqBases += $env:ProgramData }

$nameRe = '(?i)(sequence|accepted|receipt|install-activation|gate|state|native-manifest)\.json$'
$sw2 = [System.Diagnostics.Stopwatch]::StartNew()
$seqSkip = @('Temp', 'tmp', 'Cache', 'cache', 'Microsoft', 'Packages', 'Google', 'Mozilla', 'D3DSCache',
             'Crashpad', 'CrashDumps', 'node_modules', '.git', 'INetCache', 'WebCache', 'WER')
foreach ($base in $seqBases) {
  if (-not $base -or -not (Test-Path -LiteralPath $base -PathType Container)) { continue }
  $queue = New-Object System.Collections.Generic.Queue[object]
  $queue.Enqueue([pscustomobject]@{ path = $base; depth = 0 })
  $visited = 0
  while ($queue.Count -gt 0) {
    if ($sw2.ElapsedMilliseconds -gt 15000) { Add-Note ('sequence scan stopped early under ' + $base); break }
    $cur = $queue.Dequeue()
    if (-not (Test-Path -LiteralPath $cur.path -PathType Container)) { continue }
    $visited++
    if ($visited -gt 900) { break }
    # explicit app folders are always worth recording
    $leaf = Split-Path -Leaf $cur.path
    if ($leaf -eq $CACHE_DIR -or $leaf -eq $PROFILE_ID -or $leaf -eq '.xjy-employee-updates' -or $leaf -eq $N_SVC) {
      $seqDirs += [pscustomobject]@{ path = $cur.path; kind = $leaf }
    }
    foreach ($f in (Get-ChildItem -LiteralPath $cur.path -File -Filter '*.json' -ErrorAction SilentlyContinue)) {
      $hit = $false
      if ($f.Name -match $nameRe) { $hit = $true }
      if (-not $hit -and $leaf -eq $CACHE_DIR) { $hit = $true }
      if (-not $hit -and $f.Name -eq $ACCEPTED) { $hit = $true }
      if ($hit) {
        $txt = Try-ReadText $f.FullName 8192
        $proj = $null
        if ($txt) {
          try {
            $j2 = $txt | ConvertFrom-Json
            $proj = [pscustomobject]@{
              version = $j2.version; sequence = $j2.sequence
              programVersion = $j2.programVersion; product = $j2.product; role = $j2.role
              catalogSha256 = $j2.catalogSha256; fullTargetCatalogSha256 = $j2.fullTargetCatalogSha256
              targetVersion = $j2.targetVersion; engineVersion = $j2.engineVersion
              installationDir = $j2.installationDir; publishedAt = $j2.publishedAt
            }
          } catch { $proj = $null }
        }
        $rawShort = $null
        if ($txt) { $rawShort = $txt.Substring(0, [Math]::Min(600, $txt.Length)) }
        if ($seqFound.Count -lt 60) {
          $seqFound += [pscustomobject]@{
            path = $f.FullName; size = $f.Length; lastWrite = $f.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')
            parsed = $proj
            rawPrefix = $rawShort
          }
        }
      }
    }
    if ($cur.depth -ge 3) { continue }
    foreach ($sub in (Get-ChildItem -LiteralPath $cur.path -Directory -ErrorAction SilentlyContinue)) {
      if ($seqSkip -contains $sub.Name) { continue }
      $queue.Enqueue([pscustomobject]@{ path = $sub.FullName; depth = $cur.depth + 1 })
    }
  }
}

# direct probe of the paths the shipped client documents
$directProbes = @()
foreach ($base in @($env:APPDATA, $env:LOCALAPPDATA)) {
  if (-not $base) { continue }
  $p = Join-Path $base ($PROFILE_ID + '\' + $CACHE_DIR + '\' + $ACCEPTED)
  $directProbes += [pscustomobject]@{ path = $p; exists = (Test-Path -LiteralPath $p -PathType Leaf); content = $(if (Test-Path -LiteralPath $p -PathType Leaf) { Try-ReadText $p 2048 } else { $null }) }
}

$sequence = [ordered]@{
  acceptedJsonDirect = $directProbes
  folders            = $seqDirs
  candidates         = $seqFound
  hint               = 'the client answers STALE_CATALOG when catalog.sequence < accepted-sequence.json.sequence; the native channel compares against the install receipt (sequence + catalogSha256)'
}

# -------------------------------------------------------------- 5. network ---
Write-Host '[5/6] network ...'
$net = [ordered]@{
  target = $HostAddress
  port   = $Port
  ports  = @()
  localIpv4 = @()
  endpoints = @()
}

try {
  foreach ($ni in (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop | Where-Object { $_.IPAddress -notlike '127.*' })) {
    $net.localIpv4 += [pscustomobject]@{ ip = $ni.IPAddress; prefix = $ni.PrefixLength; ifAlias = $ni.InterfaceAlias }
  }
} catch {
  try {
    foreach ($a in ([System.Net.Dns]::GetHostAddresses($env:COMPUTERNAME) | Where-Object { $_.AddressFamily -eq 'InterNetwork' })) {
      $net.localIpv4 += [pscustomobject]@{ ip = $a.IPAddressToString; prefix = $null; ifAlias = $null }
    }
  } catch { Add-Note 'local IP enumeration failed' }
}

function Test-TcpPort {
  param([string]$Target, [int]$P)
  $row = [ordered]@{ port = $P; tcpOk = $false; method = 'TcpClient'; error = $null; tnc = $null }
  try {
    $c = New-Object System.Net.Sockets.TcpClient
    $iar = $c.BeginConnect($Target, $P, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne(4000)
    if (-not $ok) { throw 'connect timeout after 4000 ms' }
    $c.EndConnect($iar)
    $row.tcpOk = $true
    $c.Close()
  } catch {
    $row.error = $_.Exception.Message
  }
  try {
    $tn = Test-NetConnection -ComputerName $Target -Port $P -ErrorAction Stop -WarningAction SilentlyContinue
    $row.tnc = [pscustomobject]@{
      tcpTestSucceeded = $tn.TcpTestSucceeded
      pingSucceeded    = $tn.PingSucceeded
      sourceAddress    = $(if ($tn.SourceAddress) { $tn.SourceAddress.IPAddress } else { $null })
      remoteAddress    = $tn.RemoteAddress
      interfaceAlias   = $tn.InterfaceAlias
    }
  } catch {
    if (-not $row.error) { $row.error = ('Test-NetConnection: ' + $_.Exception.Message) }
  }
  return [pscustomobject]$row
}

if (-not $SkipNet) {
  if (-not $HostAddress) {
    Add-Note 'no -HostAddress given: port/HTTP probes were skipped (run again with the host LAN address)'
  } else {
    $portsToTest = @($Port)
    foreach ($ep in $ExtraPorts) { if ($portsToTest -notcontains $ep) { $portsToTest += $ep } }

    $pingOk = $null
    try { $pingOk = (Test-Connection -ComputerName $HostAddress -Count 2 -Quiet -ErrorAction Stop) } catch { $pingOk = $null }
    $net.ping = $pingOk

    foreach ($tp in ($portsToTest | Select-Object -First 6)) {
      $net.ports += (Test-TcpPort -Target $HostAddress -P $tp)
    }

    if (-not $SkipHttp -and $net.ports.Count -gt 0 -and $net.ports[0].tcpOk) {
      $base = ('http://' + $HostAddress + ':' + $net.ports[0].port)
      foreach ($path in @('/api/employee-updates/native-manifest', '/api/employee-updates/catalog')) {
        $url = $base + $path
        $row = [ordered]@{ url = $url; status = $null; bytes = $null; ok = $false; error = $null; summary = $null }
        try {
          $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
          $row.status = [int]$resp.StatusCode
          $row.ok = $true
          if ($resp.Content) {
            $row.bytes = $resp.Content.Length
            if ($resp.Content.Length -lt 400000) {
              try {
                $j = $resp.Content | ConvertFrom-Json
                if ($j.manifest) { $inner = ($j.manifest | ConvertFrom-Json) } else { $inner = $j }
                $row.summary = [pscustomobject]@{
                  sequence = $inner.sequence; targetVersion = $inner.targetVersion; engineVersion = $inner.engineVersion
                  purpose = $inner.purpose; role = $inner.role; version = $inner.version
                }
              } catch { $row.summary = $resp.Content.Substring(0, [Math]::Min(300, $resp.Content.Length)) }
            }
          }
        } catch {
          $we = $_.Exception
          if ($we.Response) { try { $row.status = [int]$we.Response.StatusCode } catch { } }
          $row.error = $we.Message
        }
        $net.endpoints += [pscustomobject]$row
      }
    }
  }
}

# ----------------------------------------------------------------- 6. logs ---
Write-Host '[6/6] application log ...'
$logs = [ordered]@{ file = $null; lines = 0; tail = @(); candidates = @() }
if (-not $SkipLogs) {
  $logFiles = New-Object System.Collections.Generic.List[object]
  $logDirs = New-Object System.Collections.Generic.List[string]
  if ($foundRoot) { $logDirs.Add((Join-Path $foundRoot 'logs')); $logDirs.Add((Join-Path $foundRoot 'data\logs')) }
  foreach ($b in @($env:APPDATA, $env:LOCALAPPDATA)) {
    if ($b) { $logDirs.Add((Join-Path $b ($PROFILE_ID + '\logs'))); $logDirs.Add((Join-Path $b ($PROFILE_ID + '\log'))) }
  }
  foreach ($ld in $logDirs) {
    if (-not (Test-Path -LiteralPath $ld -PathType Container)) { continue }
    foreach ($f in (Get-ChildItem -LiteralPath $ld -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -match '^\.(log|txt)$' })) {
      $logFiles.Add($f)
    }
  }
  if ($foundRoot) {
    foreach ($f in (Get-ChildItem -LiteralPath $foundRoot -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -match '^\.(log|txt)$' })) { $logFiles.Add($f) }
  }
  $logs.candidates = @($logFiles | Sort-Object LastWriteTime -Descending | Select-Object -First 12 | ForEach-Object {
      [pscustomobject]@{ path = $_.FullName; size = $_.Length; lastWrite = $_.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss') }
    })
  $newest = $logFiles | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($newest) {
    $logs.file = $newest.FullName
    try {
      $raw = @(Get-Content -LiteralPath $newest.FullName -Tail $LogLines -Encoding UTF8 -ErrorAction Stop)
      $tail = @()
      foreach ($ln in $raw) {
        $plain = [string]$ln
        if ($plain.Length -gt 4000) { $plain = $plain.Substring(0, 4000) + ' ...[truncated]' }
        $tail += $plain
      }
      $logs.tail = $tail
      $logs.lines = $tail.Count
    } catch {
      Add-Note ('log read failed: ' + $_.Exception.Message)
    }
  } else {
    Add-Note 'no application log file found in the usual places'
  }
}

# ------------------------------------------------------------------ output ---
$doc = [ordered]@{
  schemaVersion = 1
  collector     = $N_SCRIPT
  generatedAt   = (Get-Date).ToString('o')
  note          = 'read-only diagnostic for the xjy in-app upgrade acceptance; nothing was modified'
  identity      = $id
  install       = $install
  processes     = $procRows
  sequence      = $sequence
  network       = $net
  logs          = $logs
  notes         = $notes
}

Write-Host ''
Write-Host '--- summary ---'
Write-Host ('  install root : ' + $(if ($foundRoot) { $foundRoot } else { '(not found)' }))
Write-Host ('  processes    : ' + $procRows.Count)
Write-Host ('  seq files    : ' + $seqFound.Count)
Write-Host ('  ports tested : ' + $net.ports.Count)
Write-Host ('  log lines    : ' + $logs.lines)

try {
  $json = $doc | ConvertTo-Json -Depth 8
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($OutFile, $json, $utf8)
  Write-Host ('  json         : ' + $OutFile)
  exit 0
} catch {
  Write-Host ('  [FAIL] cannot write json: ' + $_.Exception.Message)
  exit 1
}

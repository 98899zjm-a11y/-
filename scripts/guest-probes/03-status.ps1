# 03-status.ps1 - READ-ONLY post-install status collection.
#
# Collects, without changing anything on disk:
#   1. every %LOCALAPPDATA%\Xjy* directory: file count + total bytes
#   2. F:\<install root>\xjy-jewelry-offline: top-level entries + xjy-install-activation.json
#   3. .program.xjy-engine-state: present or not, plus its file list
#   4. the last 40 lines of C:\XjyResults\fresh-host-local.log
# Writes C:\XjyResults\status.json (UTF-8, no BOM, so the host can parse it directly).
#
# Every section is wrapped in its own try/catch: a broken section is reported in
# "errors" and the JSON is still written. Exit code is 0 whenever the file was
# written (this script never installs or repairs anything).
#
# ASCII-ONLY ON PURPOSE (PS 5.1 mis-decodes BOM-less UTF-8 as ANSI). The CJK path
# segment for the install root is assembled from [char]0xXXXX code points.

$ErrorActionPreference = 'Continue'

# [char]0x81EA 0x5236 0x8F6F 0x4EF6 = install-root level 1 ("zi zhi ruan jian")
function New-Text([int[]] $CodePoints) {
  $sb = New-Object System.Text.StringBuilder
  foreach ($cp in $CodePoints) { [void]$sb.Append([char]$cp) }
  return $sb.ToString()
}

$SelfMadeText = New-Text @(0x81EA, 0x5236, 0x8F6F, 0x4EF6)

# ---------------------------------------------------------------- JSON writer
# Windows PowerShell 5.1 ships a ConvertTo-Json that is unsafe here: serializing a
# bare string inflates it enormously (a 136-char string came out as 31031 chars) and
# serializing this report payload stalled for minutes. status.json is therefore
# written by this tiny deterministic writer (dict/array/scalar only, invariant
# numbers, proper string escaping). It never recurses past 24 levels.
function ConvertTo-JsonText([string] $s) {
  if ($null -eq $s) { return 'null' }
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.Append('"')
  foreach ($ch in $s.ToCharArray()) {
    $c = [int]$ch
    if ($c -eq 34) { [void]$sb.Append('\"') }
    elseif ($c -eq 92) { [void]$sb.Append('\\') }
    elseif ($c -eq 10) { [void]$sb.Append('\n') }
    elseif ($c -eq 13) { [void]$sb.Append('\r') }
    elseif ($c -eq 9) { [void]$sb.Append('\t') }
    elseif ($c -lt 32 -or $c -eq 127) { [void]$sb.Append('\u00' + $c.ToString('x2')) }
    else { [void]$sb.Append($ch) }
  }
  [void]$sb.Append('"')
  return $sb.ToString()
}

function ConvertTo-JsonString {
  param($Value, [int] $Depth = 0)
  if ($Depth -gt 24) { return '"..."' }
  if ($null -eq $Value) { return 'null' }
  if ($Value -is [bool]) { if ($Value) { return 'true' } else { return 'false' } }
  if ($Value -is [string]) { return (ConvertTo-JsonText $Value) }
  $pad  = ' ' * (2 * $Depth)
  $pad2 = ' ' * (2 * ($Depth + 1))
  if ($Value -is [System.Collections.IDictionary]) {
    if ($Value.Count -eq 0) { return '{}' }
    $parts = New-Object System.Collections.ArrayList
    foreach ($k in @($Value.Keys)) {
      [void]$parts.Add($pad2 + (ConvertTo-JsonText ([string]$k)) + ': ' + (ConvertTo-JsonString $Value[$k] ($Depth + 1)))
    }
    return ('{' + [char]10 + ($parts -join (',' + [char]10)) + [char]10 + $pad + '}')
  }
  if ($Value -is [System.Collections.IEnumerable]) {
    $parts = New-Object System.Collections.ArrayList
    foreach ($e in $Value) { [void]$parts.Add($pad2 + (ConvertTo-JsonString $e ($Depth + 1))) }
    if ($parts.Count -eq 0) { return '[]' }
    return ('[' + [char]10 + ($parts -join (',' + [char]10)) + [char]10 + $pad + ']')
  }
  if ($Value -is [System.ValueType]) {
    $numNames = @('System.Int16', 'System.Int32', 'System.Int64', 'System.UInt16', 'System.UInt32',
                  'System.UInt64', 'System.Double', 'System.Single', 'System.Decimal', 'System.Byte', 'System.SByte')
    if ($numNames -contains $Value.GetType().FullName) {
      return [string][System.Convert]::ToString($Value, [System.Globalization.CultureInfo]::InvariantCulture)
    }
    return (ConvertTo-JsonText ([string]$Value))
  }
  $props = @($Value.PSObject.Properties)
  if ($props.Count -gt 0) {
    $parts = New-Object System.Collections.ArrayList
    foreach ($p in $props) {
      [void]$parts.Add($pad2 + (ConvertTo-JsonText ([string]$p.Name)) + ': ' + (ConvertTo-JsonString $p.Value ($Depth + 1)))
    }
    return ('{' + [char]10 + ($parts -join (',' + [char]10)) + [char]10 + $pad + '}')
  }
  return (ConvertTo-JsonText ([string]$Value))
}

$ResultsDir   = 'C:\XjyResults'
$InstallRoot  = 'F:\' + $SelfMadeText + '\xjy-jewelry-offline'
$LogPath      = Join-Path $ResultsDir 'fresh-host-local.log'
$ExitPath     = Join-Path $ResultsDir 'fresh-host-exit.txt'
$JsonPath     = Join-Path $ResultsDir 'status.json'
$EngineName   = '.program.xjy-engine-state'
$ActivationName = 'xjy-install-activation.json'

$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$script:Errors = New-Object System.Collections.ArrayList

function Add-Err([string] $Where, [string] $Message) {
  [void]$script:Errors.Add([ordered]@{ where = $Where; message = $Message })
}

if (-not (Test-Path -LiteralPath $ResultsDir)) {
  New-Item -ItemType Directory -Path $ResultsDir -Force | Out-Null
}

# ---------------------------------------------------------------- 1. LOCALAPPDATA\Xjy*
$localAppDataXjy = @()
try {
  $lad = $env:LOCALAPPDATA
  if ([string]::IsNullOrWhiteSpace($lad) -or -not (Test-Path -LiteralPath $lad)) {
    Add-Err 'localAppData' ("LOCALAPPDATA not usable: '" + [string]$lad + "'")
  } else {
    $dirs = @(Get-ChildItem -LiteralPath $lad -Directory -Force -ErrorAction SilentlyContinue |
              Where-Object { $_.Name -like 'Xjy*' })
    $list = New-Object System.Collections.ArrayList
    foreach ($d in $dirs) {
      $files = @(Get-ChildItem -LiteralPath $d.FullName -Recurse -File -Force -ErrorAction SilentlyContinue)
      $bytes = [int64]0
      foreach ($f in $files) { $bytes += [int64]$f.Length }
      [void]$list.Add([ordered]@{
        name      = $d.Name
        path      = $d.FullName
        fileCount = $files.Count
        bytes     = $bytes
        lastWrite = $d.LastWriteTime.ToString('o')
      })
    }
    $localAppDataXjy = @($list)
  }
} catch {
  Add-Err 'localAppData' $_.Exception.Message
}

# ---------------------------------------------------------------- 2. install root
$install = [ordered]@{
  path             = $InstallRoot
  exists           = $false
  topLevel         = @()
  activationPath   = (Join-Path $InstallRoot $ActivationName)
  activationExists = $false
  activationJson   = $null
  activationRaw    = ''
  activationError  = ''
}
try {
  $install.exists = Test-Path -LiteralPath $InstallRoot
  if ($install.exists) {
    $top = New-Object System.Collections.ArrayList
    foreach ($e in @(Get-ChildItem -LiteralPath $InstallRoot -Force -ErrorAction SilentlyContinue)) {
      $isDir = [bool]$e.PSIsContainer
      $len = $null
      if (-not $isDir) { $len = [int64]$e.Length }
      [void]$top.Add([ordered]@{
        name        = $e.Name
        isDirectory = $isDir
        length      = $len
        lastWrite   = $e.LastWriteTime.ToString('o')
      })
    }
    $install.topLevel = @($top)

    $actPath = Join-Path $InstallRoot $ActivationName
    $install.activationPath = $actPath
    $install.activationExists = Test-Path -LiteralPath $actPath
    if ($install.activationExists) {
      $raw = Get-Content -LiteralPath $actPath -Raw -ErrorAction Stop
      if ($raw.Length -gt 16000) { $install.activationRaw = $raw.Substring(0, 16000) }
      else { $install.activationRaw = $raw }
      try {
        $install.activationJson = ($raw | ConvertFrom-Json -ErrorAction Stop)
      } catch {
        $install.activationError = $_.Exception.Message
      }
    }
  }
} catch {
  Add-Err 'installRoot' $_.Exception.Message
}

# ---------------------------------------------------------------- 3. engine state dir
$engine = [ordered]@{
  name          = $EngineName
  found         = $false
  searchedRoots = @()
  matches       = @()
}
try {
  $roots = New-Object System.Collections.ArrayList
  if ($install.exists) { [void]$roots.Add($InstallRoot) }
  foreach ($d in $localAppDataXjy) { [void]$roots.Add([string]$d['path']) }
  $engine.searchedRoots = @($roots)

  $matches = New-Object System.Collections.ArrayList
  foreach ($r in @($roots)) {
    if (-not (Test-Path -LiteralPath $r)) { continue }
    $hits = @(Get-ChildItem -LiteralPath $r -Directory -Force -Recurse -Depth 2 -ErrorAction SilentlyContinue |
              Where-Object { $_.Name -eq $EngineName })
    foreach ($h in $hits) {
      $fileList = New-Object System.Collections.ArrayList
      $all = @(Get-ChildItem -LiteralPath $h.FullName -Recurse -File -Force -ErrorAction SilentlyContinue)
      $truncated = $false
      $limit = 500
      $i = 0
      foreach ($f in $all) {
        if ($i -ge $limit) { $truncated = $true; break }
        $rel = $f.FullName
        if ($rel.StartsWith($h.FullName)) { $rel = $rel.Substring($h.FullName.Length).TrimStart('\') }
        [void]$fileList.Add([ordered]@{
          name     = $f.Name
          relative = $rel
          length   = [int64]$f.Length
          lastWrite = $f.LastWriteTime.ToString('o')
        })
        $i++
      }
      [void]$matches.Add([ordered]@{
        path        = $h.FullName
        parent      = $r
        fileCount   = $all.Count
        truncated   = $truncated
        lastWrite   = $h.LastWriteTime.ToString('o')
        files       = @($fileList)
      })
    }
  }
  $engine.matches = @($matches)
  $engine.found = (@($matches).Count -gt 0)
} catch {
  Add-Err 'engineState' $_.Exception.Message
}

# ---------------------------------------------------------------- 4. fresh-host log tail
$log = [ordered]@{
  path      = $LogPath
  exists    = $false
  length    = $null
  lastWrite = ''
  tail40    = @()
  exitPath  = $ExitPath
  exitCode  = $null
}
try {
  if (Test-Path -LiteralPath $LogPath) {
    $fi = Get-Item -LiteralPath $LogPath -Force -ErrorAction Stop
    $log.exists = $true
    $log.length = [int64]$fi.Length
    $log.lastWrite = $fi.LastWriteTime.ToString('o')
    # the log was produced by cmd/powershell redirection: read it with the ANSI code page
    $log.tail40 = @(Get-Content -LiteralPath $LogPath -Tail 40 -Encoding Default -ErrorAction SilentlyContinue)
  }
  if (Test-Path -LiteralPath $ExitPath) {
    $first = Get-Content -LiteralPath $ExitPath -TotalCount 1 -Encoding Default -ErrorAction SilentlyContinue
    $parsed = 0
    $txt = ([string]$first).Trim()
    if ([int]::TryParse($txt, [ref]$parsed)) { $log.exitCode = $parsed }
  }
} catch {
  Add-Err 'freshHostLog' $_.Exception.Message
}

# ---------------------------------------------------------------- write
$payload = [ordered]@{
  generatedAt     = (Get-Date).ToString('o')
  computerName    = $env:COMPUTERNAME
  user            = $env:USERNAME
  localAppData    = $env:LOCALAPPDATA
  localAppDataXjy = @($localAppDataXjy)
  installRoot     = $install
  engineState     = $engine
  freshHostLog    = $log
  errors          = @($script:Errors)
}

try {
  $json = ConvertTo-JsonString $payload 0
  [System.IO.File]::WriteAllText($JsonPath, ($json + [Environment]::NewLine), $Utf8NoBom)
} catch {
  Write-Host ('status.json write FAILED: ' + $_.Exception.Message)
  exit 1
}

Write-Host ("status.json              -> $JsonPath")
Write-Host ("LOCALAPPDATA\\Xjy* dirs   = " + @($localAppDataXjy).Count)
Write-Host ("installRoot.exists       = " + $install.exists)
Write-Host ("activation json present  = " + $install.activationExists)
Write-Host ("engine state dir found   = " + $engine.found)
Write-Host ("fresh-host log lines kept= " + @($log.tail40).Count)
Write-Host ("fresh-host exit code     = " + [string]$log.exitCode)
Write-Host ("collection errors        = " + @($script:Errors).Count)
Write-Host 'STATUS-OK'
exit 0

param([string]$Out = "$env:USERPROFILE\Desktop\xjy-emp-diag.json")
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
$json = [ordered]@{}
$json.at = (Get-Date).ToString('o')
$json.computer = $env:COMPUTERNAME
$json.user = $env:USERNAME
$json.isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$json.sid = ([Security.Principal.WindowsIdentity]::GetCurrent()).User.Value

# 1) 找安装位置：注册表卸载键 + 常见目录
$cands = New-Object System.Collections.ArrayList
foreach ($root in @('HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall','HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall')) {
  Get-ChildItem $root -ErrorAction SilentlyContinue | ForEach-Object {
    $p = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
    if ($p.DisplayName -and ($p.DisplayName -match 'xjy|鑫金源')) {
      [void]$cands.Add([pscustomobject]@{ source = 'registry'; name = $p.DisplayName; version = $p.DisplayVersion; location = $p.InstallLocation; icon = $p.DisplayIcon })
    }
  }
}
$json.registry = $cands

$roots = New-Object System.Collections.ArrayList
foreach ($dir in @($env:LOCALAPPDATA, 'C:\Program Files', 'C:\Program Files (x86)', 'D:\', 'E:\', 'F:\')) {
  if ($dir -and (Test-Path $dir)) {
    Get-ChildItem $dir -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'xjy|鑫金源|自制软件' } | ForEach-Object { [void]$roots.Add($_.FullName) }
  }
}

$notes = New-Object System.Collections.ArrayList
foreach ($r in $roots) {
  $markers = @(Get-ChildItem $r -Filter 'xjy-install-activation.json' -Recurse -Depth 3 -File -ErrorAction SilentlyContinue)
  foreach ($m in $markers) {
    $body = ''
    try { $body = Get-Content $m.FullName -Raw } catch { }
    $inst = $m.DirectoryName
    $exe = Join-Path (Split-Path $inst -Parent) '鑫金源珠宝报价.exe'
    if (-not (Test-Path $exe)) { $exe = Join-Path $inst '鑫金源珠宝报价.exe' }
    $ver = ''
    try { $ver = (Get-Content (Join-Path $inst 'version') -Raw).Trim() } catch { }
    [void]$notes.Add([pscustomobject]@{ markerFile = $m.FullName; marker = $body; versionFile = $ver; exe = $exe; exeExists = (Test-Path $exe) })
  }
}
$json.installations = $notes

# 2) 审定目录
$base = Join-Path 'C:\ProgramData' ('鑫金源珠宝补丁审定-' + $json.sid)
$json.approvalBase = $base
$json.approvalBaseExists = (Test-Path $base)
if (Test-Path $base) {
  $json.approvalLeaves = @(Get-ChildItem $base -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    $f = Join-Path $_.FullName 'initial-upgrade-approval.json'
    [pscustomobject]@{ leaf = $_.Name; fileExists = (Test-Path $f); file = $(if (Test-Path $f) { try { Get-Content $f -Raw } catch { '' } } else { '' }) }
  })
} else { $json.approvalLeaves = @() }

# 3) 进程
$json.processes = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match '鑫金源|xjy|electron' } | Select-Object Id, ProcessName, StartTime)

$json | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $Out -Encoding UTF8
Write-Output ('WROTE ' + $Out)

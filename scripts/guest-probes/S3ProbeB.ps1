$ErrorActionPreference = 'Continue'
$out = [ordered]@{}
$out.at = (Get-Date).ToString('o')
$procs = @()
foreach ($p in (Get-Process -ErrorAction SilentlyContinue)) {
  if ($p.ProcessName -match 'Xjy|powershell|node|cmd') {
    $t = ''
    try { $t = $p.MainWindowTitle } catch { }
    $st = ''
    try { $st = $p.StartTime.ToString('HH:mm:ss') } catch { }
    $procs += [ordered]@{ id = $p.Id; name = $p.ProcessName; cpu = $p.CPU; start = $st; title = $t }
  }
}
$out.procs = $procs
$roots = @()
$base = Join-Path $env:LOCALAPPDATA ''
foreach ($d in (Get-ChildItem -LiteralPath $env:LOCALAPPDATA -Directory -Force -ErrorAction SilentlyContinue)) {
  if ($d.Name -like 'Xjy*') {
    $files = @(Get-ChildItem -LiteralPath $d.FullName -Recurse -File -Force -ErrorAction SilentlyContinue)
    $sum = 0
    foreach ($f in $files) { $sum = $sum + $f.Length }
    $roots += [ordered]@{ path = $d.FullName; files = $files.Count; bytes = $sum }
  }
}
$out.localRoots = $roots
$fd = @()
if (Test-Path -LiteralPath 'F:\') {
  foreach ($p in ([System.IO.Directory]::GetDirectories('F:\'))) { $fd += $p }
}
$out.fDirs = $fd
$out.fFreeGB = $null
if (Test-Path -LiteralPath 'F:\') {
  try { $out.fFreeGB = [math]::Round((New-Object System.IO.DriveInfo('F')).AvailableFreeSpace / 1GB, 1) } catch { }
}
$out | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath 'C:\XjyResults\s3-b.json' -Encoding UTF8
Write-Output 'B-WRITTEN'

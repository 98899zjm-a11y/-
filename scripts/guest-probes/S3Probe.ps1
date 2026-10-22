$ErrorActionPreference = 'Continue'
$out = [ordered]@{}
$out.at = (Get-Date).ToString('o')
$out.procs = @()
foreach ($p in (Get-Process -ErrorAction SilentlyContinue)) {
  $path = ''
  try { $path = $p.Path } catch { }
  $title = ''
  try { $title = $p.MainWindowTitle } catch { }
  if ($p.ProcessName -match 'Xjy|powershell|node|cmd' -or $path -match 'Xjy') {
    $st = ''
    try { $st = $p.StartTime.ToString('o') } catch { }
    $out.procs += [ordered]@{ id = $p.Id; name = $p.ProcessName; cpu = $p.CPU; start = $st; title = $title; path = $path }
  }
}
$out.titles = @()
foreach ($p in (Get-Process -ErrorAction SilentlyContinue)) {
  $t = ''
  try { $t = $p.MainWindowTitle } catch { }
  if ($t) { $out.titles += [ordered]@{ pid = $p.Id; title = $t } }
}
$roots = @()
foreach ($r in @('C:\自制软件\xjy-jewelry-offline', 'C:\XjyPackage', 'C:\鑫金源珠宝资料')) {
  $e = [ordered]@{ path = $r; exists = (Test-Path -LiteralPath $r); files = 0; bytes = 0 }
  if ($e.exists) {
    $all = @(Get-ChildItem -LiteralPath $r -Recurse -File -Force -ErrorAction SilentlyContinue)
    $e.files = $all.Count
    $sum = 0
    foreach ($f in $all) { $sum = $sum + $f.Length }
    $e.bytes = $sum
  }
  $roots += $e
}
$out.roots = $roots
$out.stateDir = (Test-Path -LiteralPath 'C:\自制软件\xjy-jewelry-offline\.program.xjy-engine-state')
$out | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath 'C:\XjyResults\s3-status.json' -Encoding UTF8
Write-Output 'STATUS-WRITTEN'

$ErrorActionPreference = 'Continue'
$out = [ordered]@{}
$out.at = (Get-Date).ToString('o')
$out.procs = @()
foreach ($p in (Get-Process -ErrorAction SilentlyContinue)) {
  $path = ''
  try { $path = $p.Path } catch { }
  $title = ''
  try { $title = $p.MainWindowTitle } catch { }
  if ($p.ProcessName -match 'Xjy|powershell|node|cmd') {
    $st = ''
    try { $st = $p.StartTime.ToString('HH:mm:ss') } catch { }
    $out.procs += [ordered]@{ id = $p.Id; name = $p.ProcessName; cpu = $p.CPU; start = $st; title = $title; path = $path }
  }
}
$out.titles = @()
foreach ($p in (Get-Process -ErrorAction SilentlyContinue)) {
  $t = ''
  try { $t = $p.MainWindowTitle } catch { }
  if ($t) { $out.titles += [ordered]@{ pid = $p.Id; title = $t } }
}
$out | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath 'C:\XjyResults\s3-status.json' -Encoding UTF8
Write-Output 'STATUS-WRITTEN'

$res = [ordered]@{ at = (Get-Date).ToString('o'); procs = @(); exitFile = 'ABSENT' }
$rows = @()
foreach ($p in @(Get-Process -ErrorAction SilentlyContinue)) {
  $pp = $null
  try { $pp = $p.Path } catch { }
  if ($pp -and ($pp -like '*Xjy*' -or $pp -like '*鑫金源*')) {
    $st = $null; try { $st = $p.StartTime.ToString('HH:mm:ss') } catch { }
    $c = $null; try { $c = [math]::Round($p.CPU, 1) } catch { }
    $rows += [ordered]@{ id = $p.Id; name = $p.ProcessName; cpu = $c; start = $st; path = $pp }
  }
}
$res.procs = $rows
$ef = 'C:\XjyReleaseResults\manual-upgrade-exit.txt'
if (Test-Path -LiteralPath $ef) { $res.exitFile = (Get-Content -LiteralPath $ef -Raw) }
$stamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
$res | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath ('C:\XjyReleaseResults\procs-' + $stamp + '.json') -Encoding UTF8
Write-Output ('WROTE procs-' + $stamp + '.json count=' + $rows.Count + ' exit=' + $res.exitFile)

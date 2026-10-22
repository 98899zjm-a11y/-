$sample = @{}
foreach ($p in @(Get-Process -ErrorAction SilentlyContinue)) {
  try { $sample[$p.Id] = @{ name = $p.ProcessName; cpu = $p.CPU } } catch { }
}
Start-Sleep -Seconds 6
$rows = @()
foreach ($p in @(Get-Process -ErrorAction SilentlyContinue)) {
  $prev = $sample[$p.Id]
  $c = $null
  try { $c = $p.CPU } catch { continue }
  if ($null -eq $c) { continue }
  $base = 0
  if ($prev) { $base = $prev.cpu }
  $delta = [math]::Round($c - $base, 2)
  $total = [math]::Round($c, 1)
  $path = $null
  try { $path = $p.Path } catch { }
  $rows += [ordered]@{ id = $p.Id; name = $p.ProcessName; delta6s = $delta; totalCpu = $total; path = $path }
}
$top = @($rows | Sort-Object -Property delta6s -Descending | Select-Object -First 10)
$out = [ordered]@{ at = (Get-Date).ToString('o'); intervalSeconds = 6; top = $top }
$stamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
$out | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath ('C:\XjyReleaseResults\topcpu-' + $stamp + '.json') -Encoding UTF8
Write-Output ('WROTE topcpu-' + $stamp + '.json top=' + $top[0].name + ' delta=' + $top[0].delta6s)

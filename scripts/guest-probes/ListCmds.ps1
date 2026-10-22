$res = [ordered]@{ at = (Get-Date).ToString('o'); rows = @(); exitFile = 'ABSENT' }
$rows = @()
foreach ($c in @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)) {
  $cl = $null
  try { $cl = $c.CommandLine } catch { }
  $ep = $null
  try { $ep = $c.ExecutablePath } catch { }
  $hit = $false
  if ($cl -and ($cl -like '*Xjy*' -or $cl -like '*鑫金源*' -or $cl -like '*engine-native*' -or $cl -like '*一键*')) { $hit = $true }
  if ($ep -and ($ep -like '*Xjy*' -or $ep -like '*鑫金源*')) { $hit = $true }
  if (-not $hit) { continue }
  $short = $cl
  if ($short -and $short.Length -gt 260) { $short = $short.Substring(0, 260) }
  $cpu = $null
  try { $cpu = [math]::Round((Get-Process -Id $c.ProcessId -ErrorAction Stop).CPU, 1) } catch { }
  $rows += [ordered]@{ id = $c.ProcessId; ppid = $c.ParentProcessId; name = $c.Name; cpu = $cpu; created = ([string]$c.CreationDate); cmd = $short }
}
$res.rows = $rows
$ef = 'C:\XjyReleaseResults\manual-upgrade-exit.txt'
if (Test-Path -LiteralPath $ef) { $res.exitFile = (Get-Content -LiteralPath $ef -Raw) }
$stamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
$res | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath ('C:\XjyReleaseResults\cmds-' + $stamp + '.json') -Encoding UTF8
Write-Output ('WROTE cmds-' + $stamp + '.json rows=' + $rows.Count + ' exit=' + $res.exitFile)

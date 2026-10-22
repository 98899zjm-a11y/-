param([string]$LogName = 'upgrade11-out.log')
$w = 'C:\Users\Administrator\AppData\Local\Microsoft\WindowsApps\wsb.exe'
$id = '47e17cfd-bb28-41fa-891f-b5619fffc608'
$res = 'D:\Codex\xjy-release-20261022\guest-results'
$log = Join-Path $res '_ctl3.log'
$outLog = Join-Path $res $LogName
$sw = [Diagnostics.Stopwatch]::StartNew()
while ($sw.Elapsed.TotalMinutes -lt 55) {
  Start-Sleep -Seconds 12
  $len = 0
  if (Test-Path $outLog) { $len = (Get-Item $outLog).Length }
  & $w exec --id $id -c 'powershell -NoProfile -ExecutionPolicy Bypass -File C:\XjyResults\AutoClick.ps1' -r ExistingLogin --raw 2>$null | Out-Null
  Start-Sleep -Seconds 2
  $act = 'unknown'
  try { $a = Get-Content (Join-Path $res 'autoclick.json') -Raw -ErrorAction Stop | ConvertFrom-Json; $act = [string]$a.action } catch { }
  Add-Content $log ("{0} len={1} act={2}" -f (Get-Date -Format HH:mm:ss), $len, $act)
  if ($act -eq 'clicked') { Start-Sleep -Seconds 4; continue }
  if ($len -gt 40) { Add-Content $log ("{0} ENDED len={1}" -f (Get-Date -Format HH:mm:ss), $len); break }
}
Add-Content $log 'ctl3-end'

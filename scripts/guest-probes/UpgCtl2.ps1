$w = 'C:\Users\Administrator\AppData\Local\Microsoft\WindowsApps\wsb.exe'
$id = '47e17cfd-bb28-41fa-891f-b5619fffc608'
$res = 'D:\Codex\xjy-release-20261022\guest-results'
$log = Join-Path $res '_ctl2.log'
$outLog = Join-Path $res 'upgrade10-out.log'
$sw = [Diagnostics.Stopwatch]::StartNew()
while ($sw.Elapsed.TotalMinutes -lt 50) {
  Start-Sleep -Seconds 15
  $len = 0
  if (Test-Path $outLog) { $len = (Get-Item $outLog).Length }
  $r = & $w exec --id $id -c 'powershell -NoProfile -ExecutionPolicy Bypass -File C:\XjyResults\AutoClick.ps1' -r ExistingLogin --raw 2>$null
  $act = 'err'
  if (Test-Path (Join-Path $res 'autoclick.json')) {
    try { $j = Get-Content (Join-Path $res 'autoclick.json') -Raw | ConvertFrom-Json; $act = $j.action + ':' + $j.clicked } catch { }
  }
  Add-Content $log ("{0} len={1} act={2}" -f (Get-Date -Format HH:mm:ss), $len, $act)
  if ($len -gt 40 -and $act -eq 'none') { Add-Content $log ("{0} DONE len={1}" -f (Get-Date -Format HH:mm:ss), $len); break }
}
Add-Content $log 'ctl-end'

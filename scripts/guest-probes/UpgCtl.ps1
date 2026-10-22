$w = 'C:\Users\Administrator\AppData\Local\Microsoft\WindowsApps\wsb.exe'
$id = '47e17cfd-bb28-41fa-891f-b5619fffc608'
$res = 'D:\Codex\xjy-release-20261022\guest-results'
$log = Join-Path $res '_upgctl.log'
$outLog = Join-Path $res 'upgrade10-out.log'
$approveTitle = [string][char]0x91CD + [char]0x590D + [char]0x5347 + [char]0x7EA7 + [char]0x5BA1 + [char]0x5B9A
$confirmTitle = [string][char]0x8D1F + [char]0x8D23 + [char]0x4EBA + [char]0x6700 + [char]0x7EC8 + [char]0x786E + [char]0x8BA4
$sw = [Diagnostics.Stopwatch]::StartNew()
while ($sw.Elapsed.TotalMinutes -lt 45) {
  Start-Sleep -Seconds 15
  $len = 0
  if (Test-Path $outLog) { $len = (Get-Item $outLog).Length }
  & $w exec --id $id -c 'powershell -NoProfile -ExecutionPolicy Bypass -File C:\XjyResults\DumpWins.ps1' -r ExistingLogin --raw 2>$null | Out-Null
  Start-Sleep -Seconds 2
  $titles = @()
  try {
    $j = Get-Content (Join-Path $res 'wins2.json') -Raw -ErrorAction Stop | ConvertFrom-Json
    $titles = @($j | Where-Object { $_.title } | ForEach-Object { $_.title })
  } catch { }
  $joined = $titles -join ' | '
  Add-Content $log ("{0} logLen={1} wins={2}" -f (Get-Date -Format HH:mm:ss), $len, $joined)
  if ($titles -contains $confirmTitle) {
    & $w exec --id $id -c 'powershell -NoProfile -ExecutionPolicy Bypass -File C:\XjyResults\ClickYes.ps1' -r ExistingLogin --raw 2>$null | Out-Null
    Add-Content $log ("{0} CLICK-YES" -f (Get-Date -Format HH:mm:ss))
    Start-Sleep -Seconds 5
    continue
  }
  if ($titles -contains $approveTitle) {
    & $w exec --id $id -c 'powershell -NoProfile -ExecutionPolicy Bypass -File C:\XjyResults\ClickApprove2.ps1' -r ExistingLogin --raw 2>$null | Out-Null
    Add-Content $log ("{0} CLICK-APPROVE" -f (Get-Date -Format HH:mm:ss))
    Start-Sleep -Seconds 6
    continue
  }
  if ($len -gt 40) { Add-Content $log ("{0} DONE len={1}" -f (Get-Date -Format HH:mm:ss), $len); break }
}
Add-Content $log 'ctl-end'

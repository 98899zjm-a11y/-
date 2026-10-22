$ErrorActionPreference = 'Continue'
$res = 'C:\XjyResults'
$root = 'F:\' + [string][char]0x81EA + [char]0x5236 + [char]0x8F6F + [char]0x4EF6 + '\xjy-jewelry-offline'
$q = Join-Path $res 'quarantine'
if (-not (Test-Path $q)) { New-Item -ItemType Directory -Path $q | Out-Null }
$moved = @()
foreach ($f in (Get-ChildItem -LiteralPath $root -File -Force | Where-Object { $_.Name -like 'Uninstall*' })) {
  try {
    Move-Item -LiteralPath $f.FullName -Destination (Join-Path $q $f.Name) -Force -ErrorAction Stop
    $moved += $f.Name
  } catch {
    $moved += ('ERR ' + $f.Name + ' :: ' + $_.Exception.Message)
  }
}
$count = (Get-ChildItem -LiteralPath $root -File -Force).Count
$out = [ordered]@{ root = $root; moved = $moved; rootFileCount = $count; at = (Get-Date).ToString('o') }
$out | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $res 'move-uninstall.json') -Encoding UTF8
Write-Output ('MOVED=' + $moved.Count + ' FILES=' + $count)

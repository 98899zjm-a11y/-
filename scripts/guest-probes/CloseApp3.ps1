$ErrorActionPreference = 'Continue'
$root = 'F:\' + [string][char]0x81EA + [char]0x5236 + [char]0x8F6F + [char]0x4EF6 + '\xjy-jewelry-offline'
$rows = @()
foreach ($p in (Get-Process -ErrorAction SilentlyContinue)) {
  $path = $null
  try { $path = $p.Path } catch { }
  if ($path -and $path.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
    $closed = $false
    try { $closed = $p.CloseMainWindow() } catch { }
    $rows += [ordered]@{ id = $p.Id; name = $p.ProcessName; path = $path; closeMain = $closed }
  }
}
Start-Sleep -Seconds 6
$still = @()
foreach ($p in (Get-Process -ErrorAction SilentlyContinue)) {
  $path = $null
  try { $path = $p.Path } catch { }
  if ($path -and $path.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) { $still += $p.Id }
}
foreach ($id in $still) { try { Stop-Process -Id $id -Force -ErrorAction Stop } catch { } }
Start-Sleep -Seconds 4
$after = @()
foreach ($p in (Get-Process -ErrorAction SilentlyContinue)) {
  $path = $null
  try { $path = $p.Path } catch { }
  if ($path -and $path.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) { $after += $p.Id }
}
$r = [ordered]@{ at = (Get-Date).ToString('o'); seen = $rows; killedIds = $still; remaining = $after }
$r | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath 'C:\XjyResults\closeapp3.json' -Encoding UTF8
Write-Output ('seen=' + $rows.Count + ' killed=' + $still.Count + ' remaining=' + $after.Count)

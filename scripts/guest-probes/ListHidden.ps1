$ErrorActionPreference = 'Continue'
$soft = [string]([char]0x81EA) + [string]([char]0x5236) + [string]([char]0x8F6F) + [string]([char]0x4EF6)
$root = 'F:\' + $soft + '\xjy-jewelry-offline'
$out = [ordered]@{}
$out.root = $root
$out.exists = (Test-Path -LiteralPath $root)
$rows = @()
if ($out.exists) {
  foreach ($e in (Get-ChildItem -LiteralPath $root -Force -ErrorAction SilentlyContinue)) {
    $r = [ordered]@{ name = $e.Name; isDir = [bool]$e.PSIsContainer; lastWrite = $e.LastWriteTime.ToString('o') }
    if ($e.PSIsContainer) {
      $f = @(Get-ChildItem -LiteralPath $e.FullName -Recurse -File -Force -ErrorAction SilentlyContinue)
      $s = 0
      foreach ($x in $f) { $s = $s + $x.Length }
      $r.files = $f.Count
      $r.bytes = $s
    } else { $r.length = $e.Length }
    $rows += $r
  }
}
$out.entries = $rows
$st = $root + '\.program.xjy-engine-state'
$out.stateExists = (Test-Path -LiteralPath $st)
$stl = @()
if ($out.stateExists) {
  foreach ($e in (Get-ChildItem -LiteralPath $st -Force -ErrorAction SilentlyContinue)) {
    $stl += [ordered]@{ name = $e.Name; isDir = [bool]$e.PSIsContainer; length = $(if ($e.PSIsContainer) { $null } else { $e.Length }); lastWrite = $e.LastWriteTime.ToString('o') }
  }
}
$out.stateEntries = $stl
$out.journalExists = (Test-Path -LiteralPath ($st + '\journal.json'))
$out | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath 'C:\XjyResults\hidden.json' -Encoding UTF8
Write-Output 'HIDDEN-DONE'

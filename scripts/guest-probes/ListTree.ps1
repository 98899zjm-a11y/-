$all = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
$map = @{}
foreach ($c in $all) { $map[[int]$c.ProcessId] = $c }
function Show-Chain($id) {
  $out = @()
  $cur = $id
  $guard = 0
  while ($cur -and $guard -lt 12) {
    $c = $map[[int]$cur]
    if (-not $c) { break }
    $cl = $null
    try { $cl = $c.CommandLine } catch { }
    if ($cl -and $cl.Length -gt 200) { $cl = $cl.Substring(0, 200) }
    $cpu = $null
    try { $cpu = [math]::Round((Get-Process -Id $c.ProcessId -ErrorAction Stop).CPU, 1) } catch { }
    $out += [ordered]@{ id = [int]$c.ProcessId; ppid = [int]$c.ParentProcessId; name = $c.Name; cpu = $cpu; created = ([string]$c.CreationDate); cmd = $cl }
    $cur = [int]$c.ParentProcessId
    $guard++
  }
  return $out
}
$kids = @()
foreach ($c in $all) {
  if ([int]$c.ParentProcessId -eq 5184) { $kids += (Show-Chain $c.ProcessId) }
}
$root = Show-Chain 5184
$res = [ordered]@{ at = (Get-Date).ToString('o'); root5184 = $root; children = $kids }
$stamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
$res | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath ('C:\XjyReleaseResults\tree-' + $stamp + '.json') -Encoding UTF8
Write-Output ('WROTE tree-' + $stamp + '.json children=' + $kids.Count)

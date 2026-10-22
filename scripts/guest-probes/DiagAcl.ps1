$ErrorActionPreference = 'Continue'
$out = [ordered]@{ at = (Get-Date).ToString('o'); paths = @() }
function Dump($p) {
  $row = [ordered]@{ path = $p; exists = (Test-Path -LiteralPath $p); owner = $null; rules = @() }
  if ($row.exists) {
    try {
      $acl = Get-Acl -LiteralPath $p
      $row.owner = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
      foreach ($r in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
        $row.rules += [ordered]@{ sid = $r.IdentityReference.Value; rights = [string]$r.FileSystemRights; allow = ($r.AccessControlType -eq 'Allow'); inherited = $r.IsInherited }
      }
    } catch { $row.error = $_.Exception.Message }
  }
  return $row
}
$pd = 'C:\ProgramData'
$out.paths += Dump $pd
$needle = [string][char]0x5BA1 + [char]0x5B9A
foreach ($d in (Get-ChildItem -LiteralPath $pd -Directory -Force -ErrorAction SilentlyContinue)) {
  if ($d.Name.Contains($needle)) {
    $out.paths += Dump $d.FullName
    foreach ($e in (Get-ChildItem -LiteralPath $d.FullName -Directory -Force -ErrorAction SilentlyContinue)) {
      $out.paths += Dump $e.FullName
    }
  }
}
$sid = ([Security.Principal.WindowsIdentity]::GetCurrent()).User.Value
$out.sid = $sid
$out | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath 'C:\XjyResults\acldiag.json' -Encoding UTF8
Write-Output ('WROTE acldiag sid=' + $sid)

$ErrorActionPreference = 'Stop'
$log = 'C:\XjyResults\acl4.txt'
$paths = @('C:\XjyLocal')
$cmd = Get-ChildItem -LiteralPath 'C:\XjyLocal' -Filter '*.cmd' -File | Select-Object -First 1
if ($cmd) { $paths += $cmd.FullName }
$out = @()
foreach ($p in $paths) {
  $acl = Get-Acl -LiteralPath $p
  $out += "PATH $p owner=$($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value) protect=$($acl.AreAccessRulesProtected)"
  foreach ($r in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
    $out += "  $($r.AccessControlType) $($r.IdentityReference.Value) $($r.FileSystemRights) inherit=$($r.IsInherited) propagation=$($r.PropagationFlags)"
  }
}
$out += "WHOAMI-CAN-READ: " + (Test-Path -LiteralPath $cmd.FullName)
$out | Set-Content -LiteralPath $log -Encoding UTF8
Write-Output 'DONE'

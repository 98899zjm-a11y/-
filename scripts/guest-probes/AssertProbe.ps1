$ErrorActionPreference = 'Stop'
$log = 'C:\XjyResults\assertprobe.txt'
$sid = ([Security.Principal.WindowsIdentity]::GetCurrent()).User.Value
$dangerBase = [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership
$allowed = @($sid, 'S-1-5-18', 'S-1-5-32-544')
"sid=$sid" | Set-Content -LiteralPath $log -Encoding UTF8
foreach ($p in @('C:\', 'C:\ProgramData')) {
  $acl = Get-Acl -LiteralPath $p
  $owner = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
  $ancestor = $true
  $danger = $dangerBase
  $trusted = ($ancestor -and [StringComparer]::OrdinalIgnoreCase.Equals($p, 'C:\'))
  $ok = $allowed
  if ($trusted) { $ok = $allowed + @('S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464') }
  "PATH $p owner=$owner ownerOk=$($owner -in $ok) trusted=$trusted" | Add-Content -LiteralPath $log -Encoding UTF8
  foreach ($r in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
    $s = $r.IdentityReference.Value
    $rights = $r.FileSystemRights
    $allow = ($r.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow)
    $inheritOnly = (($r.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0)
    $skip = (-not $allow) -or ($ancestor -and $inheritOnly)
    $hit = ($s -notin $ok) -and (($rights -band $danger) -ne 0)
    "  RULE $s rights=$rights allow=$allow inheritOnly=$inheritOnly skip=$skip dangerHit=$hit bits=$([int]($rights -band $danger))" | Add-Content -LiteralPath $log -Encoding UTF8
  }
}
"== end" | Add-Content -LiteralPath $log -Encoding UTF8
Write-Output 'PROBE-DONE'

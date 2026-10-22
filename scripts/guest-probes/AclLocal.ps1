$ErrorActionPreference = 'Stop'
$log = 'C:\XjyResults\acllocal.log'
$sid = ([Security.Principal.WindowsIdentity]::GetCurrent()).User.Value
"sid=$sid" | Set-Content -LiteralPath $log -Encoding UTF8
$targets = @('C:\XjyLocal')
foreach ($t in $targets) {
  if (-not (Test-Path -LiteralPath $t)) { "SKIP $t (absent)" | Add-Content -LiteralPath $log; continue }
  $ic = & icacls $t /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" "*${sid}:(OI)(CI)F" /T /C /Q 2>&1
  ($ic | Out-String) | Add-Content -LiteralPath $log
  $acl = Get-Acl -LiteralPath $t
  $bad = @()
  foreach ($r in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
    $s = $r.IdentityReference.Value
    $bits = [int]($r.FileSystemRights -band ([Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership -bor [Security.AccessControl.FileSystemRights]::Write))
    if ($s -notin @($sid, 'S-1-5-18', 'S-1-5-32-544') -and $bits -ne 0) { $bad += "$s/$($r.FileSystemRights)" }
  }
  "TARGET $t badRules=$($bad.Count) $($bad -join ';')" | Add-Content -LiteralPath $log
}
"== end" | Add-Content -LiteralPath $log
Write-Output 'ACLLOCAL-DONE'

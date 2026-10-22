$ErrorActionPreference = 'Continue'
$log = 'C:\XjyResults\aclfix.log'
"== aclfix $(Get-Date -Format o)" | Set-Content -LiteralPath $log -Encoding UTF8
foreach ($target in @('C:\ProgramData')) {
  $r = & icacls $target /remove:g '*S-1-3-0' 2>&1
  ($r -join "`n") | Add-Content -LiteralPath $log -Encoding UTF8
}
$acl = Get-Acl -LiteralPath 'C:\ProgramData'
$rows = @()
foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
  $rows += ('{0} | {1} | allow={2} | inh={3}' -f $rule.IdentityReference.Value, $rule.FileSystemRights, ($rule.AccessControlType -eq 'Allow'), $rule.IsInherited)
}
$rows | Add-Content -LiteralPath $log -Encoding UTF8
"== done" | Add-Content -LiteralPath $log -Encoding UTF8
Write-Output 'ACLFIX-DONE'

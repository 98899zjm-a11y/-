param([string]$Phase = 'export')
$ErrorActionPreference = 'Stop'
$root = 'D:\Codex\xjy-release-20261022\s5-tools'
$paths = @('F:\', 'F:\自制软件', 'F:\自制软件\xjy-jewelry-offline', 'F:\鑫金源珠宝资料')
$store = Join-Path $root 'prod-acl-original.json'
if ($Phase -eq 'export') {
  $rows = @()
  foreach ($p in $paths) {
    if (-not (Test-Path -LiteralPath $p)) { $rows += [ordered]@{ path = $p; exists = $false }; continue }
    $acl = Get-Acl -LiteralPath $p
    $rows += [ordered]@{ path = $p; exists = $true; owner = $acl.Owner; sddl = $acl.Sddl; protect = $acl.AreAccessRulesProtected }
  }
  $obj = [ordered]@{ at = (Get-Date).ToString('o'); host = $env:COMPUTERNAME; entries = $rows }
  $obj | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $store -Encoding UTF8
  "EXPORTED $store"
  foreach ($r in $rows) { "{0} exists={1} protect={2} sddl={3}" -f $r.path, $r.exists, $r.protect, $r.sddl }
  exit 0
}
if ($Phase -eq 'rollback') {
  $obj = Get-Content -LiteralPath $store -Raw | ConvertFrom-Json
  foreach ($e in $obj.entries) {
    if (-not $e.exists) { continue }
    $sec = New-Object System.Security.AccessControl.DirectorySecurity
    $sec.SetSecurityDescriptorSddlForm($e.sddl)
    Set-Acl -LiteralPath $e.path -AclObject $sec
    "RESTORED $($e.path)"
  }
  exit 0
}
if ($Phase -eq 'tighten') {
  $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $log = @()
  foreach ($p in @('F:\', 'F:\自制软件', 'F:\自制软件\xjy-jewelry-offline', 'F:\鑫金源珠宝资料')) {
    if (-not (Test-Path -LiteralPath $p)) { continue }
    $acl = Get-Acl -LiteralPath $p
    $removed = 0
    foreach ($r in @($acl.Access)) {
      if ($r.IsInherited) { continue }
      if ($r.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -eq 'S-1-5-11') {
        [void]$acl.RemoveAccessRuleSpecific($r)
        $removed++
      }
    }
    if ($removed -gt 0) { Set-Acl -LiteralPath $p -AclObject $acl }
    $log += [ordered]@{ path = $p; removedAUExplicit = $removed }
    "TIGHTENED $p removedExplicitAU=$removed"
  }
  $log | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $root 'prod-acl-tighten.json') -Encoding UTF8
  exit 0
}
Write-Error "unknown phase $Phase"

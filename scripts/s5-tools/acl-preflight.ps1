$ErrorActionPreference = 'Stop'
$Out = 'D:\Codex\xjy-release-20261022\guest-results\prod-acl-preflight.json'
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$allowed = @($sid, 'S-1-5-18', 'S-1-5-32-544')
$danger = 0x10000 -bor 0x40 -bor 0x40000 -bor 0x80000
$write = 0x2 -bor 0x4 -bor 0x10 -bor 0x100
$checks = New-Object System.Collections.ArrayList
$fail = 0
$paths = @(
  @{ p = 'F:\'; a = $true },
  @{ p = 'F:\自制软件'; a = $true },
  @{ p = 'F:\自制软件\xjy-jewelry-offline'; a = $false },
  @{ p = 'F:\鑫金源珠宝资料'; a = $false },
  @{ p = 'C:\'; a = $true },
  @{ p = 'C:\ProgramData'; a = $true }
)
foreach ($it in $paths) {
  $path = $it.p; $ancestor = $it.a
  $row = [ordered]@{ path = $path; ancestor = $ancestor; exists = (Test-Path -LiteralPath $path); ownerOk = $null; owner = $null; bad = @(); error = $null }
  if (-not $row['exists']) { $row['error'] = 'missing'; [void]$checks.Add($row); continue }
  try {
    $acl = Get-Acl -LiteralPath $path
    $ownerSid = (New-Object System.Security.Principal.NTAccount($acl.Owner)).Translate([System.Security.Principal.SecurityIdentifier]).Value
    $okOwners = @($sid, 'S-1-5-18', 'S-1-5-32-544')
    if ($ancestor -and ($path -eq 'C:\')) { $okOwners += 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464' }
    $row['owner'] = $ownerSid
    $row['ownerOk'] = ($okOwners -contains $ownerSid)
    $badList = New-Object System.Collections.ArrayList
    foreach ($r in $acl.Access) {
      if ($r.AccessControlType -ne 'Allow') { continue }
      if ($ancestor -and (($r.PropagationFlags -band [System.Security.AccessControl.PropagationFlags]::InheritOnly) -eq [System.Security.AccessControl.PropagationFlags]::InheritOnly)) { continue }
      $bits = [int]$r.FileSystemRights
      $isSid = $r.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
      $hit = 0
      if (($bits -band $danger) -ne 0) { $hit = $bits -band $danger }
      if (-not $ancestor -and (($bits -band $write) -ne 0)) { $hit = $hit -bor ($bits -band $write) }
      if ($hit -ne 0 -and ($allowed -notcontains $isSid)) {
        [void]$badList.Add([ordered]@{ sid = $isSid; name = $r.IdentityReference.Value; rights = $r.FileSystemRights.ToString(); inherited = $r.IsInherited; hit = $hit })
      }
    }
    $row['bad'] = $badList.ToArray()
    if (-not $row['ownerOk']) { $fail++ }
    if ($badList.Count -gt 0) { $fail++ }
  } catch { $row['error'] = $_.Exception.Message }
  [void]$checks.Add($row)
}
$verdict = 'PASS'
if ($fail -ne 0) { $verdict = 'FAIL' }
$result = [ordered]@{ at = (Get-Date).ToString('o'); sid = $sid; verdict = $verdict; failCount = $fail; checks = $checks.ToArray() }
$result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $Out -Encoding UTF8
foreach ($c in $checks) { "{0} anc={1} exists={2} ownerOk={3} owner={4} bad={5} err={6}" -f $c['path'], $c['ancestor'], $c['exists'], $c['ownerOk'], $c['owner'], $c['bad'].Count, $c['error'] }
Write-Output ("VERDICT=" + $result['verdict'])

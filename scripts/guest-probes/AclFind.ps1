$ErrorActionPreference = 'Stop'
$log = 'C:\XjyResults\aclf.txt'
$sid = ([Security.Principal.WindowsIdentity]::GetCurrent()).User.Value
$src = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'XjyLocal\placeholder') -ErrorAction SilentlyContinue
$ps1 = 'C:\XjyLocal\' + [string][char]0x5BA1 + [string][char]0x6279 + [string][char]0x5DE5 + [string][char]0x5177 + '\Prepare-Repeat-Approval-170.ps1'
$text = (Get-Content -LiteralPath $ps1 -Raw) -replace "`r`n", "`n"
$a = $text.IndexOf('function Test-TrustedWindowsRoot')
$b = $text.IndexOf('function New-ApprovalAcl')
$c = $text.IndexOf('function Get-FixedApprovalBase')
if ($a -lt 0 -or $b -lt 0 -or $c -lt 0) { 'EXTRACT-FAILED' | Set-Content -LiteralPath $log; exit 1 }
$body = $text.Substring($a, $c - $a)
. ([scriptblock]::Create($body))
$pub = 'f2a76c739b5b78975d03c82ac6bacb8e65719c8d0d5192f2bf69ae62955fe0b3'
$base = 'C:\ProgramData\' + [string][char]0x946B + [string][char]0x91D1 + [string][char]0x6E90 + [string][char]0x73E0 + [string][char]0x5B9D + [string][char]0x8865 + [string][char]0x4E01 + [string][char]0x5BA1 + [string][char]0x5B9A + '-' + $sid
$root = Join-Path $base $pub
$cands = @()
$cands += $root
$cands += (Join-Path $root 'initial-upgrade-approval.json')
$cands += 'C:\XjyLocal'
$cands += 'C:\XjyLocal\' + [string][char]0x53D7 + [string][char]0x4FE1 + [string][char]0x52A9 + [string][char]0x624B
$cands += 'C:\XjyLocal\' + [string][char]0x5B8C + [string][char]0x6574 + [string][char]0x7A0B + [string][char]0x5E8F
$cands += 'F:\' + [string][char]0x81EA + [string][char]0x5236 + [string][char]0x8F6F + [string][char]0x4EF6 + '\xjy-jewelry-offline'
$cands += 'F:\' + [string][char]0x81EA + [string][char]0x5236 + [string][char]0x8F6F + [string][char]0x4EF6
$cands += 'F:\'
$cands += 'C:\'
$out = @()
foreach ($p in $cands) {
  if (-not (Test-Path -LiteralPath $p)) { $out += "SKIP $p (absent)"; continue }
  foreach ($anc in @($true, $false)) {
    try {
      Assert-ApprovalAcl $p $sid $anc
      $out += "PASS $p ancestor=$anc"
    } catch {
      $out += "FAIL $p ancestor=$anc :: $($_.Exception.Message)"
      try {
        $acl = Get-Acl -LiteralPath $p
        foreach ($r in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
          $out += "    rule $($r.AccessControlType) $($r.IdentityReference.Value) $($r.FileSystemRights) inheritOnly=$((($r.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0)) inherited=$($r.IsInherited)"
        }
      } catch { $out += "    (acl read failed)" }
    }
  }
}
$out | Set-Content -LiteralPath $log -Encoding UTF8
Write-Output 'ACLF-DONE'

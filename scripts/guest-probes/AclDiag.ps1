$ErrorActionPreference = 'Stop'
$log = 'C:\XjyResults\acldiag.txt'
function Note($m) { Add-Content -LiteralPath $log -Value ((Get-Date).ToString('HH:mm:ss') + ' ' + $m) }
Set-Content -LiteralPath $log -Value 'acldiag start'
try {
  $worker = 'C:\XjyLocal\' + [string][char]0x53D7 + [string][char]0x4FE1 + [string][char]0x52A9 + [string][char]0x624B
  $ap = Join-Path $worker 'delivery-approval\Prepare-Repeat-Approval-170.ps1'
  Note ('approval-ps exists=' + (Test-Path -LiteralPath $ap))
  $src = [System.IO.File]::ReadAllText($ap)
  $src = $src.Replace("`r`n", "`n")
  $i1 = $src.IndexOf('function Test-TrustedWindowsRoot')
  $i2 = $src.IndexOf('function New-ApprovalAcl')
  $i3 = $src.IndexOf('function Get-FixedApprovalBase')
  Note ("idx=" + $i1 + ',' + $i2 + ',' + $i3)
  $policy = $src.Substring($i1, $i2 - $i1)
  $creation = $src.Substring($i2, $i3 - $i2)
  . ([ScriptBlock]::Create($policy + $creation))
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  Note ('sid=' + $sid)
  foreach ($t in @('F:\', 'C:\XjyLocal')) {
    try { Assert-ApprovalAcl $t $sid $false; Note ('ASSERT-OK ' + $t) }
    catch { Note ('ASSERT-FAIL ' + $t + ' :: ' + $_.Exception.Message) }
  }
  $dataRoot = 'F:\' + [string][char]0x946B + [string][char]0x91D1 + [string][char]0x6E90 + [string][char]0x73E0 + [string][char]0x5B9D + [string][char]0x8D44 + [string][char]0x6599
  Note ('dataRoot=' + $dataRoot + ' exists=' + (Test-Path -LiteralPath $dataRoot))
  try { Assert-ApprovalAcl 'F:\' $sid $true; Note 'ASSERT-OK ancestor F:\' } catch { Note ('ASSERT-FAIL ancestor F:\ :: ' + $_.Exception.Message) }
  try {
    Create-ApprovalDirectory $dataRoot (New-ApprovalAcl $sid)
    Note 'CREATE-OK dataRoot'
    Assert-ApprovalAcl $dataRoot $sid $false
    Note 'ASSERT-OK dataRoot'
    Remove-Item -LiteralPath $dataRoot -Force -Recurse
    Note 'cleanup dataRoot'
  } catch { Note ('CREATE-FAIL dataRoot :: ' + $_.Exception.Message) }
} catch { Note ('FATAL :: ' + $_.Exception.Message) }
Note 'acldiag end'

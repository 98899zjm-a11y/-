# Guest-only wrapper for existing data-free PowerShell regression tests.
# This does not run the reviewer GUI, compile its guard, or apply an ACL.
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$guestRoot='C:\xjy-work\xjy-web-stage1'
if($PSScriptRoot -cne ($guestRoot+'\stage1')){throw 'FIXED_GUEST_ROOT_REQUIRED: no pure test child started'}
$contextText=& 'C:\Python314\python.exe' -I -B (Join-Path $PSScriptRoot 'validate-sandbox-context.py')
if($LASTEXITCODE -ne 0){throw 'ACTUAL_SANDBOX_GUARD_REFUSED: no pure test child started'}
$actualContext=($contextText -join [Environment]::NewLine)|ConvertFrom-Json
$systemPS='C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
$record=[ordered]@{version=1;purpose='candidate-delivery-approval-pure-ps-tests';passed=$false;actualCheckPassed=$false;actualContext=$actualContext;pureTestChildren=0;nativeGuardCompiled=$false;knownFolderOrAclAccess=$false;tests=@();error=$null}
function Invoke-PureTest([string]$Name,[string]$Script,[string[]]$Extra=@()){
 $path=Join-Path (Join-Path $guestRoot 'tests') $Script
 $output=@(& $systemPS -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $path @Extra)
 $childExit=$LASTEXITCODE
 if($childExit -ne 0){throw ('PURE_PS_CHILD_FAILED: '+$Name+'; exit='+$childExit+'; '+($output -join [Environment]::NewLine))}
 $data=($output -join [Environment]::NewLine)|ConvertFrom-Json
 if($data -isnot [pscustomobject] -or $data.passed -isnot [bool] -or !$data.passed -or $data.knownFolderOrAclAccess -isnot [bool] -or $data.knownFolderOrAclAccess){throw ('PURE_PS_RESULT_REFUSED: '+$Name)}
 switch -CaseSensitive ($Name){
  'reviewer-paths' {if($data.plainPathCases -ne 3 -or $data.overlapCases -ne 5 -or $data.singleBackslashTree -ne $true -or $data.unexpectedDirectoryRefused -ne $true -or $data.nativeGuardCompiled -ne $false){throw 'REVIEWER_PATH_COVERAGE_REFUSED'}}
  'installer-plain' {if($data.plainPathCases -ne 3 -or $data.source -cne '..\delivery-tools\Initial-Full-Upgrade.ps1' -or $data.nativeGuardCompiled -ne $false){throw 'INSTALLER_PLAIN_COVERAGE_REFUSED'}}
  'reviewer-acl-policy' {if($data.aclPolicyCases -ne 10 -or $data.atomicCreationFlow -ne $true -or $data.existingAclUnchanged -ne $true -or $data.pathSetAclAbsent -ne $true){throw 'REVIEWER_POLICY_COVERAGE_REFUSED'}}
  default {throw 'UNEXPECTED_PURE_PS_TEST'}
 }
 return [pscustomobject]@{name=$Name;passed=$true;exitCode=$childExit;result=$data}
}
try{
 $record.tests+=@(Invoke-PureTest 'reviewer-paths' 'delivery-approval-ps-paths.test.ps1')
 $record.pureTestChildren++
 $record.tests+=@(Invoke-PureTest 'installer-plain' 'delivery-approval-ps-paths.test.ps1' @('-SourceRelativePath','..\delivery-tools\Initial-Full-Upgrade.ps1','-PlainOnly'))
 $record.pureTestChildren++
 $record.tests+=@(Invoke-PureTest 'reviewer-acl-policy' 'delivery-approval-ps-acl.test.ps1')
 $record.pureTestChildren++
 if($record.pureTestChildren -ne 3 -or $record.tests.Count -ne 3){throw 'THREE_PURE_PS_RESULTS_REQUIRED'}
 $record.passed=$true
 $record.actualCheckPassed=$true
}catch{
 $record.error=$_.Exception.Message
}
$record|ConvertTo-Json -Depth 12 -Compress
if($record.passed){exit 0}else{exit 1}

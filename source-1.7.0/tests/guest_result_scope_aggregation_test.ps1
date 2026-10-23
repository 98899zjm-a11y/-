param([string]$FixtureRoot)
$ErrorActionPreference='Stop'
$root=$FixtureRoot;if(-not $root){$root=Split-Path -Parent $PSScriptRoot}
$counts=@{passed=0;failed=0}
function Assert-Equal($Actual,$Expected,[string]$Why){if($Actual -cne $Expected){throw ($Why+': expected '+$Expected+', got '+$Actual)}}
function Assert-True($Value,[string]$Why){if($Value -isnot [bool] -or $Value -ne $true){throw $Why}}
function Assert-False($Value,[string]$Why){if($Value -isnot [bool] -or $Value -ne $false){throw $Why}}
function Case([string]$Name,[scriptblock]$Body){try{& $Body;$counts.passed++;[Console]::WriteLine('PASS '+$Name)}catch{$counts.failed++;[Console]::WriteLine('FAIL '+$Name+': '+$_.Exception.Message)}}
function Json($Value){ConvertTo-Json -InputObject $Value -Depth 20 -Compress}
function Process([int]$Exit=0){[pscustomobject]@{processStarted=$true;exitCode=$Exit;timedOut=$false;streamsComplete=$true}}
function Report([string]$Scope='desktop'){
 $rows=[Collections.Generic.List[object]]::new()
 foreach($name in @('engine-capabilities','candidate-host-startup','candidate-offline-fullmodules','candidate-fakehardware-worker','candidate-updater-toy-recovery','candidate-three-database-attachments-restore')){
  if($Scope -ceq 'desktop' -and $name -ceq 'candidate-offline-fullmodules'){$rows.Add([pscustomobject]@{name=$name;status='deferred';passed=$null;exitCode=$null;reason='Phone browser work is explicitly deferred by the owner.'});continue}
  $proof=[pscustomobject]@{actualCheckPassed=$true}
  if($name -ceq 'engine-capabilities'){$proof=[pscustomobject]@{runAsNodeObserved=$true;backupSupported=$true;backupIntegrity='ok'}}
  if($name -ceq 'candidate-fakehardware-worker'){$proof=[pscustomobject]@{actualCheckPassed=$true;realPassiveHtmlPrepared=$true;realPassivePdfPrepared=$true;deviceApiCalls=0;nativeDelegations=0}}
  $rows.Add([pscustomobject]@{name=$name;status='passed';passed=$true;exitCode=0;evidence=$proof})
 }
 return [pscustomobject]@{scope=$Scope;passed=$true;checks=$rows.ToArray();normalDefaultHostShutdown=[pscustomobject]@{passed=$true;forcedStop=$false;listenersClosed=$true;observedOwnDescendantsExited=$true}}
}
function Summary($Value,[string]$Scope='desktop',$Proc=(Process)){Get-GuestScopedCandidateResultSummary -Json (Json $Value) -Process $Proc -Scope $Scope}
function Baseline{
 $rows=[Collections.Generic.List[object]]::new()
 foreach($name in @('node-unit','python-guard','launcher-boundaries','os-access-gate','sandbox-context','erp-values','erp-reports_pure','erp-attachments','smoke','finance-test','backup-test','daily-test','lan-test','numbers-test','collaboration-test','customers-test','export-test','security-test','restore-test','erp-test')){$rows.Add([pscustomobject]@{name=$name;startedAt='2026-10-15T02:00:00Z';endedAt='2026-10-15T02:00:01Z';exitCode=0;passed=$true;log=('C:\xjy-work\xjy-web-stage1\reports\final-'+$name+'.log')})}
 foreach($name in @('os-read-boundary','sandbox-config')){$rows.Add([pscustomobject]@{name=$name;passed=$null;exitCode=$null;status='not-applicable-in-guest';reason='host only'})}
 Get-GuestBaselineResultSummary -Json (Json $rows.ToArray()) -Process (Process) -CheckLog {param($p) $true}
}
. ([scriptblock]::Create([IO.File]::ReadAllText((Join-Path $root 'stage1\guest-result-aggregation.ps1'),[Text.Encoding]::UTF8)))
$scopeFile=Join-Path $root 'stage1\guest-result-scope-aggregation.ps1'
if(-not (Test-Path -LiteralPath $scopeFile -PathType Leaf)){
 Case 'closed-desktop-scope-module-exists' {Assert-True $false 'Desktop-only strict aggregation is missing'}
 [Console]::WriteLine('RESULT '+$counts.passed+' passed; '+$counts.failed+' failed');exit 1
}
. ([scriptblock]::Create([IO.File]::ReadAllText($scopeFile,[Text.Encoding]::UTF8)))
Case 'desktop-counts-five-real-pass-and-one-deferred' {
 $report=Report;$before=Json $report;$sum=Summary $report
 Assert-True $sum.passed 'desktop passes only its exact scope';Assert-True $sum.desktopAcceptancePassed 'desktop flag';Assert-False $sum.fullAcceptancePassed 'desktop never implies full pass'
 Assert-Equal $sum.candidateGroupsExecuted 5 'actual groups';Assert-Equal $sum.candidateGroupsPassed 5 'real PASS count';Assert-Equal $sum.deferredGroupNames.Count 1 'one deferred';Assert-Equal $sum.deferredGroupNames[0] 'candidate-offline-fullmodules' 'only browser deferred'
 Assert-Equal $sum.recordedGroupNames.Count 6 'all six explicit rows';Assert-Equal (Json $report) $before 'input immutable'
}
Case 'full-still-requires-six-actual-pass' {
 $sum=Summary (Report 'full') 'full';Assert-True $sum.passed 'full exact';Assert-True $sum.fullAcceptancePassed 'full flag';Assert-Equal $sum.candidateGroupsPassed 6 'all six actual PASS';Assert-Equal $sum.deferredGroupNames.Count 0 'no full defer'
}
foreach($mutation in @('scope-missing','scope-mismatch','browser-pass','browser-failed','deferred-false','deferred-exit-zero','empty-reason','extra-deferred-field','defer-worker','worker-failed','missing-row','wrong-case','duplicate','string-top','nonzero-process','forced-shutdown','string-native-count','top-flag-contradiction')){
 $current=$mutation
 Case ('desktop-rejects-'+$mutation) {
  $report=Report;$proc=Process
  switch($current){
   'scope-missing' {$report.PSObject.Properties.Remove('scope')} 'scope-mismatch' {$report.scope='full'}
   'browser-pass' {$report.checks[2]=(Report 'full').checks[2]}
   'browser-failed' {$report.checks[2].passed=$false;$report.checks[2].exitCode=1;$report.checks[2].status='failed'}
   'deferred-false' {$report.checks[2].passed=$false} 'deferred-exit-zero' {$report.checks[2].exitCode=0} 'empty-reason' {$report.checks[2].reason=''}
   'extra-deferred-field' {$report.checks[2]|Add-Member evidence ([pscustomobject]@{actualCheckPassed=$true})}
   'defer-worker' {$report.checks[3]=[pscustomobject]@{name='candidate-fakehardware-worker';passed=$null;exitCode=$null;status='deferred';reason='skip'}}
   'worker-failed' {$report.checks[3].passed=$false;$report.checks[3].exitCode=1;$report.checks[3].status='failed'}
   'missing-row' {$report.checks=$report.checks[0..4]} 'wrong-case' {$report.checks[2].name='Candidate-offline-fullmodules'}
   'duplicate' {$report.checks[5].name=$report.checks[0].name} 'string-top' {$report.passed='true'}
   'nonzero-process' {$proc.exitCode=1} 'forced-shutdown' {$report.normalDefaultHostShutdown.forcedStop=$true}
   'string-native-count' {$report.checks[3].evidence.deviceApiCalls='0'}
   'top-flag-contradiction' {$report|Add-Member fullAcceptancePassed $true}
  }
  $sum=Summary $report 'desktop' $proc;Assert-False $sum.passed 'invalid desktop cannot pass';Assert-True ($sum.validationErrors.Count -gt 0) 'explicit rejection';Assert-False $sum.fullAcceptancePassed 'no full claim'
 }
}
Case 'full-cannot-relabel-browser-deferred' {
 $report=Report;$report.scope='full';$sum=Summary $report 'full';Assert-False $sum.passed 'full needs browser actual test';Assert-False $sum.fullAcceptancePassed 'no full pass'
}
Case 'scope-is-closed-no-arbitrary-exclusion-list' {
 $threw=$false;try{Get-GuestScopedCandidateResultSummary -Json (Json (Report)) -Process (Process) -Scope 'skip-all'}catch{$threw=$true};Assert-True $threw 'arbitrary scope refused'
}
Case 'desktop-acceptance-still-requires-full-baseline' {
 $base=Baseline;$base.passed=$false;$sum=Get-GuestScopedAcceptanceResultSummary -Baseline $base -Candidate (Summary (Report)) -Scope 'desktop';Assert-False $sum.passed 'baseline failure remains fatal';Assert-False $sum.desktopAcceptancePassed 'no desktop claim'
}
Case 'valid-desktop-acceptance-is-not-full-acceptance' {
 $sum=Get-GuestScopedAcceptanceResultSummary -Baseline (Baseline) -Candidate (Summary (Report)) -Scope 'desktop';Assert-True $sum.passed 'desktop scope complete';Assert-True $sum.desktopAcceptancePassed 'desktop accepted';Assert-False $sum.fullAcceptancePassed 'full explicitly incomplete';Assert-Equal $sum.deferredGroupNames.Count 1 'one deferred recorded'
}
[Console]::WriteLine('RESULT '+$counts.passed+' passed; '+$counts.failed+' failed; PowerShell '+$PSVersionTable.PSVersion.ToString())
if($counts.failed){exit 1}

param([string]$FixtureRoot)
$ErrorActionPreference='Stop'
$testRoot=$FixtureRoot
if(-not $testRoot){$testRoot=Split-Path -Parent $PSScriptRoot}
$testModule=Join-Path $testRoot 'stage1\guest-result-aggregation.ps1'
$testCounts=@{passed=0;failed=0}
function Assert-Equal($Actual,$Expected,[string]$Message){
 if($Actual -cne $Expected){throw ($Message+': expected '+$Expected+', got '+$Actual)}
}
function Assert-True($Actual,[string]$Message){if(-not ($Actual -is [bool]) -or $Actual -ne $true){throw $Message}}
function Assert-False($Actual,[string]$Message){if(-not ($Actual -is [bool]) -or $Actual -ne $false){throw $Message}}
function Test-Case([string]$Name,[scriptblock]$Body){
 try{& $Body;$testCounts.passed++;[Console]::WriteLine('PASS '+$Name)}catch{$testCounts.failed++;[Console]::WriteLine('FAIL '+$Name+': '+$_.Exception.Message)}
}
function Encode-Json($Value){ConvertTo-Json -InputObject $Value -Depth 20 -Compress}
function Copy-Json($Value){ConvertFrom-Json -InputObject (Encode-Json $Value)}
function New-Process([int]$Code=0){[pscustomobject]@{processStarted=$true;exitCode=$Code;timedOut=$false;streamsComplete=$true}}
function New-Baseline{
 $rows=[Collections.Generic.List[object]]::new()
 foreach($name in @('node-unit','python-guard','launcher-boundaries','os-access-gate','sandbox-context','erp-values','erp-reports_pure','erp-attachments','smoke','finance-test','backup-test','daily-test','lan-test','numbers-test','collaboration-test','customers-test','export-test','security-test','restore-test','erp-test')){
  $rows.Add([pscustomobject]@{name=$name;startedAt='2026-10-14T17:00:00.0000000Z';endedAt='2026-10-14T17:00:01.0000000Z';exitCode=0;passed=$true;log=('C:\xjy-work\xjy-web-stage1\reports\final-'+$name+'.log')})
 }
 foreach($name in @('os-read-boundary','sandbox-config')){$rows.Add([pscustomobject]@{name=$name;passed=$null;exitCode=$null;status='not-applicable-in-guest';reason='Host check is recorded separately.'})}
 return ,$rows.ToArray()
}
function New-Candidate{
 $checks=[Collections.Generic.List[object]]::new()
 foreach($name in @('engine-capabilities','candidate-host-startup','candidate-offline-fullmodules','candidate-fakehardware-worker','candidate-updater-toy-recovery','candidate-three-database-attachments-restore')){
  $evidence=[pscustomobject]@{actualCheckPassed=$true}
  if($name -ceq 'engine-capabilities'){$evidence=[pscustomobject]@{runAsNodeObserved=$true;backupSupported=$true;backupIntegrity='ok'}}
  if($name -ceq 'candidate-fakehardware-worker'){$evidence=[pscustomobject]@{actualCheckPassed=$true;realPassiveHtmlPrepared=$true;realPassivePdfPrepared=$true;deviceApiCalls=0;nativeDelegations=0}}
  $checks.Add([pscustomobject]@{name=$name;status='passed';exitCode=0;passed=$true;evidence=$evidence})
 }
 return [pscustomobject]@{passed=$true;checks=$checks.ToArray();normalDefaultHostShutdown=[pscustomobject]@{passed=$true;forcedStop=$false;listenersClosed=$true;observedOwnDescendantsExited=$true}}
}
function Baseline($Json,$Process=(New-Process),$LogProof={param($Path) $true}){Get-GuestBaselineResultSummary -Json $Json -Process $Process -CheckLog $LogProof}
function Candidate($Json,$Process=(New-Process)){Get-GuestCandidateResultSummary -Json $Json -Process $Process}
if(-not (Test-Path -LiteralPath $testModule -PathType Leaf)){throw 'Strict aggregation module absent'}
. ([scriptblock]::Create([IO.File]::ReadAllText($testModule,[Text.Encoding]::UTF8)))
Test-Case 'real-v6-report-preserves-eight-pass-one-fail-two-NA' {
 $json=[IO.File]::ReadAllText((Join-Path $testRoot 'sandbox\results\full-verify-v6\guest-final-test-results.json'),[Text.Encoding]::UTF8)
 $summary=Baseline $json (New-Process 1)
 Assert-Equal $summary.passedChecks 8 'real PASS count'
 Assert-Equal $summary.failedChecks 1 'real FAIL count'
 Assert-Equal $summary.notApplicableChecks 2 'real NA count'
 Assert-Equal $summary.actualExecutedChecks 9 'real executed count'
 Assert-Equal $summary.recordedChecks 11 'recorded array row count'
 Assert-Equal $summary.notRunCheckNames.Count 11 'missing baseline groups'
 Assert-Equal ($summary.failedCheckNames -join '|') 'smoke' 'real failed name'
 Assert-False $summary.passed 'v6 cannot pass'
}
Test-Case 'complete-baseline-is-exact-twenty-plus-two' {
 $summary=Baseline (Encode-Json (New-Baseline))
 Assert-Equal $summary.passedChecks 20 'PASS count';Assert-Equal $summary.notApplicableChecks 2 'NA count'
 Assert-Equal $summary.recordedCheckNames.Count 22 'flat names';Assert-Equal $summary.validationErrors.Count 0 'schema errors'
 Assert-True $summary.passed 'complete exact baseline'
}
foreach($shape in @('object','string','number','null','nested-array','broken-json')){
 $caseShape=$shape
 Test-Case ('reject-top-level-'+$shape) {
  $json=switch($caseShape){'object' {'{"name":"node-unit","passed":true,"exitCode":0}'} 'string' {'"[{}]"'} 'number' {'1'} 'null' {'null'} 'nested-array' {'[[{"name":"node-unit","passed":true,"exitCode":0}]]'} 'broken-json' {'['}}
  $summary=Baseline $json
  Assert-False $summary.passed 'bad top-level cannot pass';Assert-True ($summary.validationErrors.Count -gt 0) 'explicit validation error required'
 }
}
foreach($mutation in @('string-pass','number-pass','string-exit','duplicate','wrong-case','unknown','missing','nested-row','log-path','missing-log','exit-contradiction','NA-boolean','NA-status','capture-error','timeout','unstarted','incomplete-streams','nonzero-process','string-process-exit')){
 $caseMutation=$mutation
 Test-Case ('baseline-rejects-'+$mutation) {
  $rows=New-Baseline;$process=New-Process;$logProof={param($Path) $true}
  switch($caseMutation){
   'string-pass' {$rows[0].passed='true'} 'number-pass' {$rows[0].passed=1} 'string-exit' {$rows[0].exitCode='0'}
   'duplicate' {$rows+=@((Copy-Json $rows[0]))} 'wrong-case' {$rows[0].name='NODE-unit'} 'unknown' {$rows[0].name='unexpected'}
   'missing' {$rows=$rows[1..21]} 'nested-row' {$rows[0]=@($rows[0])} 'log-path' {$rows[0].log='C:\other\final-node-unit.log'}
   'missing-log' {$logProof={param($Path) $false}} 'exit-contradiction' {$rows[0].exitCode=1}
   'NA-boolean' {$rows[20].passed=$false} 'NA-status' {$rows[20].status='passed'}
   'capture-error' {$process|Add-Member captureError 'fixture-error'} 'timeout' {$process.timedOut=$true}
   'unstarted' {$process.processStarted=$false} 'incomplete-streams' {$process.streamsComplete=$false}
   'nonzero-process' {$process.exitCode=1} 'string-process-exit' {$process.exitCode='0'}
  }
  $summary=Baseline (Encode-Json $rows) $process $logProof
  Assert-False $summary.passed 'incomplete/invalid baseline refused';Assert-True ($summary.validationErrors.Count -gt 0) 'invalid reason required'
 }
}
Test-Case 'complete-candidate-requires-six-and-normal-shutdown' {
 $summary=Candidate (Encode-Json (New-Candidate))
 Assert-True $summary.passed 'six exact groups';Assert-Equal $summary.candidateGroupsPassed 6 'six PASS';Assert-Equal $summary.candidateGroupNames.Count 6 'flat candidate names'
}
foreach($mutation in @('wrapped-object','single-check','missing','duplicate','order','string-pass','string-exit','failed','not-run','false-top','string-top','shutdown-forced','shutdown-missing','nonzero-process')){
 $caseMutation=$mutation
 Test-Case ('candidate-rejects-'+$mutation) {
  $report=New-Candidate;$process=New-Process
  switch($caseMutation){
   'single-check' {$report.checks=$report.checks[0]} 'missing' {$report.checks=$report.checks[0..4]} 'duplicate' {$report.checks[1].name=$report.checks[0].name}
   'order' {$hold=$report.checks[0];$report.checks[0]=$report.checks[1];$report.checks[1]=$hold}
   'string-pass' {$report.checks[0].passed='true'} 'string-exit' {$report.checks[0].exitCode='0'}
   'failed' {$report.checks[0].passed=$false;$report.checks[0].exitCode=1;$report.checks[0].status='failed';$report.passed=$false}
   'not-run' {$report.checks[5].passed=$false;$report.checks[5].exitCode=$null;$report.checks[5].status='not-run';$report.passed=$false}
   'false-top' {$report.passed=$false} 'string-top' {$report.passed='true'}
   'shutdown-forced' {$report.normalDefaultHostShutdown.forcedStop=$true} 'shutdown-missing' {$report.PSObject.Properties.Remove('normalDefaultHostShutdown')}
   'nonzero-process' {$process.exitCode=1}
  }
  $json=Encode-Json $report;if($caseMutation -eq 'wrapped-object'){$json='['+$json+']'}
  $summary=Candidate $json $process
  Assert-False $summary.passed 'invalid candidate cannot pass';Assert-True ($summary.validationErrors.Count -gt 0) 'candidate rejection reason required'
 }
}
Test-Case 'all-zero-exit-with-missing-candidate-still-refused' {
 $summary=Get-GuestAcceptanceResultSummary -Baseline (Baseline (Encode-Json (New-Baseline))) -Candidate (Candidate '')
 Assert-False $summary.passed 'missing candidate cannot produce PASS'
 Assert-Equal $summary.candidate.notRunGroupNames.Count 6 'six groups not run'
}
Test-Case 'exact-baseline-and-candidate-can-pass' {
 $summary=Get-GuestAcceptanceResultSummary -Baseline (Baseline (Encode-Json (New-Baseline))) -Candidate (Candidate (Encode-Json (New-Candidate)))
 Assert-True $summary.passed 'all actual process facts and exact names required'
}
[Console]::WriteLine('RESULT '+$testCounts.passed+' passed; '+$testCounts.failed+' failed; PowerShell '+$PSVersionTable.PSVersion.ToString())
if($testCounts.failed -ne 0){exit 1}

# Data-free Windows PowerShell 5.1 result validation. No filesystem or process API.
# Keep parsed arrays inside an object property. Wrapping ConvertFrom-Json's
# pipeline output with @() creates a nested array on Windows PowerShell 5.1.
function Test-GuestResultObject($Value){return ($null -ne $Value -and $Value -is [pscustomobject] -and $Value -isnot [array])}
function Test-GuestResultInteger($Value){return ($Value -is [int] -or $Value -is [long])}
function Test-GuestResultKeys($Row,[string[]]$Expected){
 if(-not (Test-GuestResultObject $Row)){return $false}
 $actual=@($Row.PSObject.Properties | ForEach-Object {$_.Name})
 if($actual.Count -ne $Expected.Count){return $false}
 foreach($key in $Expected){if(-not ($actual -ccontains $key)){return $false}}
 return $true
}
function Read-GuestStrictJson([string]$Json,[string]$Shape){
 if([string]::IsNullOrWhiteSpace($Json)){throw 'Result JSON absent; no result is treated as passed'}
 if($Json.Length -gt 16777216){throw 'Result JSON exceeds its bounded test-report size'}
 $text=$Json.TrimStart([char]0xfeff).Trim()
 if($Shape -ceq 'array'){
  if(-not $text.StartsWith('[') -or -not $text.EndsWith(']')){throw 'Result JSON must be a top-level array'}
 }elseif($Shape -ceq 'object'){
  if(-not $text.StartsWith('{') -or -not $text.EndsWith('}')){throw 'Result JSON must be a top-level object'}
 }else{throw 'Unknown result JSON shape'}
 # Direct assignment is intentional; do not change to @($text | ConvertFrom-Json).
 $parsed=ConvertFrom-Json -InputObject $text -ErrorAction Stop
 if($Shape -ceq 'array' -and $parsed -isnot [array]){throw 'Parsed report lost its required top-level array'}
 if($Shape -ceq 'object' -and -not (Test-GuestResultObject $parsed)){throw 'Parsed report lost its required top-level object'}
 return [pscustomobject]@{value=$parsed}
}
function Get-GuestProcessResultErrors($Process){
 $errors=[Collections.Generic.List[string]]::new()
 if(-not (Test-GuestResultObject $Process)){$errors.Add('Real process capture record absent')}
 else{
  if($Process.processStarted -isnot [bool] -or $Process.processStarted -ne $true){$errors.Add('Real process was not confirmed started')}
  if(-not (Test-GuestResultInteger $Process.exitCode) -or $Process.exitCode -ne 0){$errors.Add('Real process exit code is not integer zero')}
  if($Process.timedOut -isnot [bool] -or $Process.timedOut -ne $false){$errors.Add('Process timeout state is not explicitly false')}
  if($Process.streamsComplete -isnot [bool] -or $Process.streamsComplete -ne $true){$errors.Add('Process streams were not completely captured')}
  foreach($key in @('captureError','stdoutFlushError','stderrFlushError')){
   if($null -ne $Process.PSObject.Properties[$key] -and $null -ne $Process.$key){$errors.Add('Process capture contains '+$key)}
  }
 }
 return [pscustomobject]@{errors=$errors.ToArray()}
}
function Get-GuestBaselineResultSummary{
 param([AllowEmptyString()][string]$Json,$Process,[scriptblock]$CheckLog)
 $executables=[string[]]@('node-unit','python-guard','launcher-boundaries','os-access-gate','sandbox-context','erp-values','erp-reports_pure','erp-attachments','smoke','finance-test','backup-test','daily-test','lan-test','numbers-test','collaboration-test','customers-test','export-test','security-test','restore-test','erp-test')
 $notApplicable=[string[]]@('os-read-boundary','sandbox-config')
 $errors=[Collections.Generic.List[string]]::new()
 $rows=[object[]]@();$names=[Collections.Generic.List[string]]::new();$failed=[Collections.Generic.List[string]]::new()
 $seen=[Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
 $passCount=0;$failCount=0;$naCount=0;$executedCount=0
 try{$rows=(Read-GuestStrictJson $Json 'array').value}catch{$errors.Add('Baseline parse rejected: '+$_.Exception.Message)}
 foreach($row in $rows){
  if(-not (Test-GuestResultObject $row) -or $row.name -isnot [string] -or [string]::IsNullOrWhiteSpace($row.name)){$errors.Add('Baseline row must be an object with one string name');continue}
  $name=$row.name;$names.Add($name)
  if(-not $seen.Add($name)){$errors.Add('Duplicate baseline name: '+$name);continue}
  if($executables -ccontains $name){
   $schema=Test-GuestResultKeys $row @('name','startedAt','endedAt','exitCode','passed','log')
   if(-not $schema){$errors.Add('Execution row keys differ: '+$name)}
   $isBoolean=$row.passed -is [bool];$isInteger=Test-GuestResultInteger $row.exitCode
   if(-not $isBoolean -or -not $isInteger){$errors.Add('Execution row boolean/integer types invalid: '+$name)}
   else{
    $executedCount++
    if($row.passed){$passCount++}else{$failCount++;$failed.Add($name)}
    if($row.passed -ne ($row.exitCode -eq 0)){$errors.Add('Execution row boolean/exit code disagree: '+$name)}
    if(-not $row.passed){$errors.Add('Execution check failed: '+$name)}
   }
   $start=[DateTimeOffset]::MinValue;$end=[DateTimeOffset]::MinValue
   if($row.startedAt -isnot [string] -or $row.endedAt -isnot [string] -or -not [DateTimeOffset]::TryParse($row.startedAt,[ref]$start) -or -not [DateTimeOffset]::TryParse($row.endedAt,[ref]$end) -or $end -lt $start){$errors.Add('Execution row timestamps invalid: '+$name)}
   $expectedLog='C:\xjy-work\xjy-web-stage1\reports\final-'+$name+'.log'
   if($row.log -isnot [string] -or $row.log -cne $expectedLog){$errors.Add('Execution row exact log path differs: '+$name)}
   elseif($null -eq $CheckLog){$errors.Add('Required ordinary log-file proof callback absent: '+$name)}
   else{
    try{$logProof=& $CheckLog $expectedLog;if($logProof -isnot [bool] -or $logProof -ne $true){throw 'Log proof was not boolean true'}}catch{$errors.Add('Execution log absent or unsafe: '+$name+': '+$_.Exception.Message)}
   }
  }elseif($notApplicable -ccontains $name){
   if(-not (Test-GuestResultKeys $row @('name','passed','exitCode','status','reason')) -or $null -ne $row.passed -or $null -ne $row.exitCode -or $row.status -cne 'not-applicable-in-guest' -or $row.reason -isnot [string] -or [string]::IsNullOrWhiteSpace($row.reason)){$errors.Add('Explicit Guest NA row schema invalid: '+$name)}
   else{$naCount++}
  }else{$errors.Add('Unexpected baseline name: '+$name)}
 }
 $missing=[Collections.Generic.List[string]]::new()
 foreach($name in @($executables+$notApplicable)){if(-not $seen.Contains($name)){$missing.Add($name);$errors.Add('Expected baseline row absent: '+$name)}}
 foreach($errorText in (Get-GuestProcessResultErrors $Process).errors){$errors.Add($errorText)}
 if($rows.Count -ne 22 -or $passCount -ne 20 -or $failCount -ne 0 -or $naCount -ne 2 -or $executedCount -ne 20){$errors.Add('Complete baseline requires exactly 20 passed executions and 2 explicit Guest NA rows')}
 return [pscustomobject]@{version=1;purpose='strict-guest-baseline-summary';passed=($errors.Count -eq 0);recordedChecks=$rows.Count;passedChecks=$passCount;failedChecks=$failCount;notApplicableChecks=$naCount;actualExecutedChecks=$executedCount;recordedCheckNames=$names.ToArray();failedCheckNames=$failed.ToArray();notRunCheckNames=@($executables | Where-Object {-not $seen.Contains($_)});missingReportNames=$missing.ToArray();validationErrors=$errors.ToArray();rows=$rows}
}
function Get-GuestCandidateResultSummary{
 param([AllowEmptyString()][string]$Json,$Process)
 $expected=[string[]]@('engine-capabilities','candidate-host-startup','candidate-offline-fullmodules','candidate-fakehardware-worker','candidate-updater-toy-recovery','candidate-three-database-attachments-restore')
 $errors=[Collections.Generic.List[string]]::new();$names=[Collections.Generic.List[string]]::new();$failed=[Collections.Generic.List[string]]::new()
 $seen=[Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
 $report=$null;$rows=[object[]]@();$passed=0;$executed=0;$notRun=[Collections.Generic.List[string]]::new()
 try{
  $report=(Read-GuestStrictJson $Json 'object').value
  if($report.checks -isnot [array]){throw 'Candidate checks must be an actual JSON array'}
  $rows=$report.checks
 }catch{$errors.Add('Candidate parse rejected: '+$_.Exception.Message)}
 foreach($row in $rows){
  if(-not (Test-GuestResultObject $row) -or $row.name -isnot [string]){$errors.Add('Candidate check must be an object with string name');continue}
  $name=$row.name;$names.Add($name)
  if(-not $seen.Add($name)){$errors.Add('Duplicate candidate name: '+$name);continue}
  if(-not ($expected -ccontains $name)){$errors.Add('Unexpected candidate name: '+$name);continue}
  if($row.status -ceq 'not-run'){
   $notRun.Add($name)
   if($row.passed -isnot [bool] -or $row.passed -ne $false -or $null -ne $row.exitCode){$errors.Add('Candidate not-run row is inconsistent: '+$name)}
   $errors.Add('Candidate group was not run: '+$name);continue
  }
  $executed++
  if($row.passed -isnot [bool] -or -not (Test-GuestResultInteger $row.exitCode) -or $row.passed -ne $true -or $row.exitCode -ne 0 -or $row.status -cne 'passed'){$failed.Add($name);$errors.Add('Candidate actual result did not pass: '+$name);continue}
  if($null -ne $row.PSObject.Properties['timedOut'] -and ($row.timedOut -isnot [bool] -or $row.timedOut -ne $false)){$failed.Add($name);$errors.Add('Candidate group timed out or has invalid timeout type: '+$name);continue}
  if(-not (Test-GuestResultObject $row.evidence)){$errors.Add('Candidate evidence object absent: '+$name);continue}
  if($name -ceq 'engine-capabilities'){
   if($row.evidence.runAsNodeObserved -isnot [bool] -or $row.evidence.runAsNodeObserved -ne $true -or $row.evidence.backupSupported -isnot [bool] -or $row.evidence.backupSupported -ne $true -or $row.evidence.backupIntegrity -cne 'ok'){$errors.Add('Candidate engine capability evidence invalid');continue}
  }elseif($row.evidence.actualCheckPassed -isnot [bool] -or $row.evidence.actualCheckPassed -ne $true){$errors.Add('Candidate actual evidence was not boolean true: '+$name);continue}
  if($name -ceq 'candidate-fakehardware-worker'){
   if($row.evidence.realPassiveHtmlPrepared -isnot [bool] -or $row.evidence.realPassiveHtmlPrepared -ne $true -or $row.evidence.realPassivePdfPrepared -isnot [bool] -or $row.evidence.realPassivePdfPrepared -ne $true -or -not (Test-GuestResultInteger $row.evidence.deviceApiCalls) -or $row.evidence.deviceApiCalls -ne 0 -or -not (Test-GuestResultInteger $row.evidence.nativeDelegations) -or $row.evidence.nativeDelegations -ne 0){$errors.Add('Candidate worker real rendering / zero native device evidence invalid');continue}
  }
  $passed++
 }
 foreach($name in $expected){if(-not $seen.Contains($name)){$notRun.Add($name);$errors.Add('Expected candidate group absent: '+$name)}}
 if(($names.ToArray() -join '|') -cne ($expected -join '|')){$errors.Add('Candidate exact six group names/order differ')}
 if($null -eq $report -or $report.passed -isnot [bool] -or $report.passed -ne $true){$errors.Add('Candidate overall result is not boolean true')}
 $shutdown=$null;if($null -ne $report){$shutdown=$report.normalDefaultHostShutdown}
 if(-not (Test-GuestResultObject $shutdown) -or $shutdown.passed -isnot [bool] -or $shutdown.passed -ne $true -or $shutdown.forcedStop -isnot [bool] -or $shutdown.forcedStop -ne $false -or $shutdown.listenersClosed -isnot [bool] -or $shutdown.listenersClosed -ne $true -or $shutdown.observedOwnDescendantsExited -isnot [bool] -or $shutdown.observedOwnDescendantsExited -ne $true){$errors.Add('Owned default host normal shutdown evidence missing or invalid')}
 foreach($errorText in (Get-GuestProcessResultErrors $Process).errors){$errors.Add($errorText)}
 if($rows.Count -ne 6 -or $executed -ne 6 -or $passed -ne 6){$errors.Add('Exactly six actually executed and passed candidate groups required')}
 return [pscustomobject]@{version=1;purpose='strict-guest-candidate-summary';passed=($errors.Count -eq 0);candidateGroupsExecuted=$executed;candidateGroupsPassed=$passed;candidateGroupNames=$names.ToArray();failedGroupNames=$failed.ToArray();notRunGroupNames=$notRun.ToArray();validationErrors=$errors.ToArray();normalDefaultHostShutdown=$shutdown;report=$report}
}
function Get-GuestAcceptanceResultSummary($Baseline,$Candidate){
 $good=(Test-GuestResultObject $Baseline) -and $Baseline.purpose -ceq 'strict-guest-baseline-summary' -and $Baseline.passed -is [bool] -and $Baseline.passed -eq $true -and $Baseline.validationErrors -is [array] -and $Baseline.validationErrors.Count -eq 0 -and $Baseline.recordedChecks -eq 22 -and $Baseline.passedChecks -eq 20 -and $Baseline.failedChecks -eq 0 -and $Baseline.actualExecutedChecks -eq 20 -and $Baseline.notApplicableChecks -eq 2 -and (Test-GuestResultObject $Candidate) -and $Candidate.purpose -ceq 'strict-guest-candidate-summary' -and $Candidate.passed -is [bool] -and $Candidate.passed -eq $true -and $Candidate.validationErrors -is [array] -and $Candidate.validationErrors.Count -eq 0 -and $Candidate.candidateGroupsExecuted -eq 6 -and $Candidate.candidateGroupsPassed -eq 6
 return [pscustomobject]@{version=1;purpose='strict-guest-acceptance-summary';passed=[bool]$good;baseline=$Baseline;candidate=$Candidate}
}

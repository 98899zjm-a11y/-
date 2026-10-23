# Pure closed-scope validation. Load the unchanged guest-result-aggregation.ps1
# definitions first. Desktop defers one fixed browser group; no other exclusion.
function Get-GuestScopedCandidateResultSummary{
 param([AllowEmptyString()][string]$Json,$Process,[ValidateSet('full','desktop')][string]$Scope='full')
 $all=[string[]]@('engine-capabilities','candidate-host-startup','candidate-offline-fullmodules','candidate-fakehardware-worker','candidate-updater-toy-recovery','candidate-three-database-attachments-restore')
 $browser='candidate-offline-fullmodules'
 $active=[string[]]@($all | Where-Object {$Scope -ceq 'full' -or $_ -cne $browser})
 $errors=[Collections.Generic.List[string]]::new();$names=[Collections.Generic.List[string]]::new()
 $deferred=[Collections.Generic.List[string]]::new();$failed=[Collections.Generic.List[string]]::new();$notRun=[Collections.Generic.List[string]]::new()
 $seen=[Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
 $report=$null;$rows=[object[]]@();$passed=0;$executed=0;$shutdown=$null
 try{
  $report=(Read-GuestStrictJson $Json 'object').value
  if($report.scope -isnot [string] -or $report.scope -cne $Scope){throw 'Report scope must exactly match the fixed requested scope'}
  if($report.checks -isnot [array]){throw 'Scoped checks must be an actual JSON array'}
  $rows=$report.checks
 }catch{$errors.Add('Scoped candidate parse rejected: '+$_.Exception.Message)}
 if($Scope -ceq 'full'){
  $full=Get-GuestCandidateResultSummary -Json $Json -Process $Process
  foreach($text in $full.validationErrors){$errors.Add($text)}
  $passed=$full.candidateGroupsPassed;$executed=$full.candidateGroupsExecuted;$shutdown=$full.normalDefaultHostShutdown
  foreach($name in $full.candidateGroupNames){$names.Add($name)}
  foreach($name in $full.failedGroupNames){$failed.Add($name)}
  foreach($name in $full.notRunGroupNames){$notRun.Add($name)}
 }else{
  foreach($row in $rows){
   if(-not (Test-GuestResultObject $row) -or $row.name -isnot [string]){$errors.Add('Scoped candidate row requires an object and string name');continue}
   $name=$row.name;$names.Add($name)
   if(-not $seen.Add($name)){$errors.Add('Duplicate scoped candidate name: '+$name);continue}
   if(-not ($all -ccontains $name)){$errors.Add('Unexpected scoped candidate name: '+$name);continue}
   if($name -ceq $browser){
    if(-not (Test-GuestResultKeys $row @('name','status','passed','exitCode','reason')) -or $row.status -cne 'deferred' -or $null -ne $row.passed -or $null -ne $row.exitCode -or $row.reason -isnot [string] -or [string]::IsNullOrWhiteSpace($row.reason)){$errors.Add('Desktop requires one explicit deferred browser row with null pass/exit and nonempty reason')}
    else{$deferred.Add($name)}
    continue
   }
   if($row.status -ceq 'not-run'){$notRun.Add($name);$errors.Add('Required desktop group was not run: '+$name);continue}
   $executed++
   if($row.passed -isnot [bool] -or $row.passed -ne $true -or -not (Test-GuestResultInteger $row.exitCode) -or $row.exitCode -ne 0 -or $row.status -cne 'passed'){$failed.Add($name);$errors.Add('Required desktop actual group did not pass: '+$name);continue}
   if($null -ne $row.PSObject.Properties['timedOut'] -and ($row.timedOut -isnot [bool] -or $row.timedOut -ne $false)){$errors.Add('Desktop group timeout/type invalid: '+$name);continue}
   if(-not (Test-GuestResultObject $row.evidence)){$errors.Add('Desktop actual evidence object absent: '+$name);continue}
   if($name -ceq 'engine-capabilities'){
    if($row.evidence.runAsNodeObserved -isnot [bool] -or $row.evidence.runAsNodeObserved -ne $true -or $row.evidence.backupSupported -isnot [bool] -or $row.evidence.backupSupported -ne $true -or $row.evidence.backupIntegrity -cne 'ok'){$errors.Add('Desktop engine actual capability evidence invalid');continue}
   }elseif($row.evidence.actualCheckPassed -isnot [bool] -or $row.evidence.actualCheckPassed -ne $true){$errors.Add('Desktop actual evidence must be boolean true: '+$name);continue}
   if($name -ceq 'candidate-fakehardware-worker'){
    if($row.evidence.realPassiveHtmlPrepared -isnot [bool] -or $row.evidence.realPassiveHtmlPrepared -ne $true -or $row.evidence.realPassivePdfPrepared -isnot [bool] -or $row.evidence.realPassivePdfPrepared -ne $true -or -not (Test-GuestResultInteger $row.evidence.deviceApiCalls) -or $row.evidence.deviceApiCalls -ne 0 -or -not (Test-GuestResultInteger $row.evidence.nativeDelegations) -or $row.evidence.nativeDelegations -ne 0){$errors.Add('Desktop worker actual rendering / zero device evidence invalid');continue}
   }
   $passed++
  }
  foreach($name in $active){if(-not $seen.Contains($name)){$notRun.Add($name);$errors.Add('Required desktop group absent: '+$name)}}
  if(($names.ToArray() -join '|') -cne ($all -join '|')){$errors.Add('Desktop must retain the exact six original row names/order')}
  if($rows.Count -ne 6 -or $executed -ne 5 -or $passed -ne 5 -or $deferred.Count -ne 1 -or $deferred[0] -cne $browser){$errors.Add('Desktop requires five actual passed groups plus one fixed explicitly deferred browser group')}
  if($null -eq $report -or $report.passed -isnot [bool] -or $report.passed -ne $true){$errors.Add('Desktop overall scope result must be boolean true')}
  if($null -ne $report){$shutdown=$report.normalDefaultHostShutdown}
  if(-not (Test-GuestResultObject $shutdown) -or $shutdown.passed -isnot [bool] -or $shutdown.passed -ne $true -or $shutdown.forcedStop -isnot [bool] -or $shutdown.forcedStop -ne $false -or $shutdown.listenersClosed -isnot [bool] -or $shutdown.listenersClosed -ne $true -or $shutdown.observedOwnDescendantsExited -isnot [bool] -or $shutdown.observedOwnDescendantsExited -ne $true){$errors.Add('Desktop owned default host normal shutdown evidence missing or invalid')}
  foreach($text in (Get-GuestProcessResultErrors $Process).errors){$errors.Add($text)}
 }
 if($null -ne $report){
  foreach($key in @('fullAcceptancePassed','desktopAcceptancePassed')){
   if($null -ne $report.PSObject.Properties[$key]){
    $expectedFlag=($key -ceq 'fullAcceptancePassed' -and $Scope -ceq 'full') -or ($key -ceq 'desktopAcceptancePassed' -and $Scope -ceq 'desktop')
    if($report.$key -isnot [bool] -or $report.$key -ne $expectedFlag){$errors.Add('Driver acceptance flag contradicts its closed scope: '+$key)}
   }
  }
  if($null -ne $report.PSObject.Properties['actualExecutedGroups'] -and (-not (Test-GuestResultInteger $report.actualExecutedGroups) -or $report.actualExecutedGroups -ne $executed)){$errors.Add('Driver actual executed count differs from actual recorded groups')}
  if($null -ne $report.PSObject.Properties['expectedExecutedGroups'] -and ($report.expectedExecutedGroups -isnot [array] -or ($report.expectedExecutedGroups -join '|') -cne ($active -join '|'))){$errors.Add('Driver expected executed groups differ from the closed scope')}
  if($null -ne $report.PSObject.Properties['deferredGroups'] -and ($report.deferredGroups -isnot [array] -or ($report.deferredGroups -join '|') -cne ($deferred.ToArray() -join '|'))){$errors.Add('Driver deferred group list differs from the one fixed browser allowance')}
 }
 $ok=($errors.Count -eq 0)
 return [pscustomobject]@{version=1;purpose='strict-guest-scoped-candidate-summary';scope=$Scope;passed=$ok;desktopAcceptancePassed=($ok -and $Scope -ceq 'desktop');fullAcceptancePassed=($ok -and $Scope -ceq 'full');candidateGroupsExecuted=$executed;candidateGroupsPassed=$passed;candidateGroupNames=$active;recordedGroupNames=$names.ToArray();deferredGroupNames=$deferred.ToArray();failedGroupNames=$failed.ToArray();notRunGroupNames=$notRun.ToArray();validationErrors=$errors.ToArray();normalDefaultHostShutdown=$shutdown}
}
function Get-GuestScopedAcceptanceResultSummary{
 param($Baseline,$Candidate,[ValidateSet('full','desktop')][string]$Scope='full')
 $baselineGood=(Test-GuestResultObject $Baseline) -and $Baseline.purpose -ceq 'strict-guest-baseline-summary' -and $Baseline.passed -is [bool] -and $Baseline.passed -eq $true -and $Baseline.validationErrors -is [array] -and $Baseline.validationErrors.Count -eq 0 -and $Baseline.recordedChecks -eq 22 -and $Baseline.passedChecks -eq 20 -and $Baseline.failedChecks -eq 0 -and $Baseline.actualExecutedChecks -eq 20 -and $Baseline.notApplicableChecks -eq 2
 $expectedCount=6;if($Scope -ceq 'desktop'){$expectedCount=5}
 $candidateGood=(Test-GuestResultObject $Candidate) -and $Candidate.purpose -ceq 'strict-guest-scoped-candidate-summary' -and $Candidate.scope -ceq $Scope -and $Candidate.passed -is [bool] -and $Candidate.passed -eq $true -and $Candidate.validationErrors -is [array] -and $Candidate.validationErrors.Count -eq 0 -and $Candidate.candidateGroupsExecuted -eq $expectedCount -and $Candidate.candidateGroupsPassed -eq $expectedCount
 $ok=[bool]($baselineGood -and $candidateGood)
 $deferred=[string[]]@();if($Scope -ceq 'desktop'){$deferred=[string[]]@('candidate-offline-fullmodules')}
 return [pscustomobject]@{version=1;purpose='strict-guest-scoped-acceptance-summary';scope=$Scope;passed=$ok;desktopAcceptancePassed=($ok -and $Scope -ceq 'desktop');fullAcceptancePassed=($ok -and $Scope -ceq 'full');deferredGroupNames=$deferred;baseline=$Baseline;candidate=$Candidate}
}

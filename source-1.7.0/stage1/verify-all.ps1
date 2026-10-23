param([switch]$SandboxGuest)
$ErrorActionPreference='Stop'
$stageRoot=Split-Path -Parent $PSScriptRoot
$stageNode=Join-Path $PSScriptRoot 'tools/node.exe'
$stagePython='C:\Python314\python.exe'
if($SandboxGuest){
 if($stageRoot -ne 'C:\xjy-work\xjy-web-stage1'){throw 'Windows Sandbox guest work path required'}
 Push-Location -LiteralPath $stageRoot
 try{
  & $stagePython -I -B 'stage1/validate-sandbox-context.py'
  if($LASTEXITCODE -ne 0){throw 'Actual Windows Sandbox context required before tests'}
 }finally{Pop-Location}
}
if(Test-Path -LiteralPath (Join-Path $stageRoot 'runtime/host-ready.json')){throw 'Stop the isolated host before sequential integration verification.'}
$results=[System.Collections.Generic.List[object]]::new()
function Invoke-StageCheck([string]$Name,[string]$Program,[string[]]$Arguments){
 $logPath=Join-Path $stageRoot ('reports/final-'+$Name+'.log')
 $started=(Get-Date).ToUniversalTime().ToString('o')
 if(-not (Test-Path -LiteralPath $Program -PathType Leaf)){throw ('Verifier program absent: '+$Name)}
 # Native stderr is diagnostic output on Windows PowerShell 5.1. Preserve it
 # completely and judge the real process exit code, including ordinary warnings.
 $stagePreviousErrorAction=$ErrorActionPreference
 try{
  $ErrorActionPreference='Continue'
  & $Program @Arguments *> $logPath
  $code=$LASTEXITCODE
 }catch{
  $code=1
  $_ | Out-File -LiteralPath $logPath -Append -Encoding utf8
 }finally{$ErrorActionPreference=$stagePreviousErrorAction}
 $results.Add([pscustomobject]@{name=$Name;startedAt=$started;endedAt=(Get-Date).ToUniversalTime().ToString('o');exitCode=$code;passed=($code -eq 0);log=$logPath})
 $results | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $stageRoot 'reports/final-test-results.json') -Encoding utf8
 Write-Output ($Name+': '+ $(if($code -eq 0){'PASS'}else{'FAIL'}))
 if($code -ne 0){Get-Content -LiteralPath $logPath -Tail 20;throw ('Verification failed: '+$Name)}
}
Push-Location -LiteralPath $stageRoot
try{
 $testFiles=Get-ChildItem -LiteralPath (Join-Path $stageRoot 'tests') -Filter '*.test.cjs' | ForEach-Object {$_.FullName}
 Invoke-StageCheck 'node-unit' $stageNode (@('--test','--test-reporter=tap')+$testFiles)
 Invoke-StageCheck 'python-guard' $stagePython @('-B','tests/python_guard_test.py')
 Invoke-StageCheck 'launcher-boundaries' $stagePython @('-B','tests/launcher_boundaries_test.py')
 Invoke-StageCheck 'os-access-gate' $stagePython @('-B','tests/os_access_gate_test.py')
 Invoke-StageCheck 'sandbox-context' $stagePython @('-B','tests/sandbox_context_test.py')
 if($SandboxGuest){
  foreach($hostOnlyName in @('os-read-boundary','sandbox-config')){
   $results.Add([pscustomobject]@{name=$hostOnlyName;passed=$null;exitCode=$null;status='not-applicable-in-guest';reason='Host ACL and WSB artifact checks are recorded on the physical host, not replayed against guest paths.'})
  }
 }else{
  Invoke-StageCheck 'os-read-boundary' $stagePython @('-B','tests/os_read_boundary_check_test.py')
  Invoke-StageCheck 'sandbox-config' $stagePython @('-B','tests/sandbox_config_check.py')
 }
 foreach($pureErpTest in @('values','reports_pure','attachments')){
  Invoke-StageCheck ('erp-'+$pureErpTest) $stagePython @('-B',('tests/erp_'+$pureErpTest+'_test.py'))
 }
 foreach($mode in @('smoke','finance-test','backup-test','daily-test','lan-test','numbers-test','collaboration-test','customers-test','export-test','security-test','restore-test','erp-test')){
  $guestModeArguments=@('-B','stage1/run-restricted.py','--script','stage1/host.cjs','--mode',$mode)
  if($SandboxGuest){$guestModeArguments+=@('--sandbox-guest')}
  Invoke-StageCheck $mode $stagePython $guestModeArguments
 }
}finally{Pop-Location}

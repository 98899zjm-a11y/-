param([switch]$Open)
$ErrorActionPreference='Stop'
$taskRoot=$PSScriptRoot
$nodePath='D:\Codex\xjy-agent-sales-media\openclaw-isolated\runtime\node-v24.22.1-win-x64\node.exe'
$candidateUrl='http://127.0.0.1:21963'
$taskLogs=Join-Path $taskRoot 'runtime'
if(-not(Test-Path -LiteralPath $nodePath -PathType Leaf)){throw 'D drive Node runtime not found.'}
$manifestPath=Join-Path $taskRoot 'source-manifest.json'
if(Test-Path -LiteralPath $manifestPath){
  & $nodePath (Join-Path $taskRoot 'freeze-manifest.mjs') --verify
  if($LASTEXITCODE -ne 0){throw 'Candidate source manifest verification failed.'}
}
function Test-CandidateHealth {
  $health=Invoke-RestMethod -Uri ($candidateUrl+'/api/health') -TimeoutSec 5
  if($health.ok -ne $true -or $health.candidate -ne $true -or $health.model -ne 'qwen3-vl:4b'){throw 'Unexpected service identity on port 21963.'}
  return $true
}
$ready=$false
try{$ready=Test-CandidateHealth}catch{
  $listener=Get-NetTCPConnection -LocalPort 21963 -State Listen -ErrorAction SilentlyContinue
  if($listener){throw 'Port 21963 is occupied or unhealthy; no process was stopped.'}
}
if(-not $ready){
  New-Item -ItemType Directory -Path (Join-Path $taskLogs 'tmp') -Force | Out-Null
  $priorTemp=$env:TEMP; $priorTmp=$env:TMP
  $runStamp=Get-Date -Format 'yyyyMMdd-HHmmss-fff'
  $stdout=Join-Path $taskLogs ($runStamp+'.stdout.log');$stderr=Join-Path $taskLogs ($runStamp+'.stderr.log')
  try{
    $env:TEMP=Join-Path $taskLogs 'tmp';$env:TMP=$env:TEMP
    $worker=Start-Process -FilePath $nodePath -ArgumentList @((Join-Path $taskRoot 'entry.mjs')) -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
  }finally{$env:TEMP=$priorTemp;$env:TMP=$priorTmp}
  for($attempt=0;$attempt -lt 20;$attempt++){
    Start-Sleep -Milliseconds 250
    $worker.Refresh()
    if($worker.HasExited){throw ('Candidate entry exited; inspect '+$stderr)}
    try{$ready=Test-CandidateHealth;if($ready){break}}catch{}
  }
  if(-not $ready){throw ('Health check timed out; no process was killed. Inspect '+$stderr)}
  @{pid=$worker.Id;url=$candidateUrl;startedAt=(Get-Date).ToString('o');permissionBoundary='local-candidate';entry='entry.mjs'} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskLogs ($runStamp+'.process.json')) -Encoding UTF8
}
Write-Output ('Local candidate ready: '+$candidateUrl+' (not production employee authorization)')
if($Open){Start-Process $candidateUrl}

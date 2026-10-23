param([switch]$Open)
$ErrorActionPreference='Stop'
$taskRoot=$PSScriptRoot
$nodePath='D:\Codex\xjy-agent-sales-media\openclaw-isolated\runtime\node-v24.22.1-win-x64\node.exe'
$candidateUrl='http://127.0.0.1:21964'
if(-not(Test-Path -LiteralPath $nodePath -PathType Leaf)){throw 'D drive Node runtime not found.'}
# Freeze is deliberately mandatory; review first, then explicitly generate it.
& $nodePath (Join-Path $taskRoot 'source-freeze.mjs') --verify
if($LASTEXITCODE -ne 0){throw 'Reviewed source manifest is missing or has changed; no service was started.'}
function Test-StaffCandidateHealth {
 $health=Invoke-RestMethod -Uri ($candidateUrl+'/api/health') -TimeoutSec 5
 if($health.ok -ne $true -or $health.candidate -ne $true -or $health.authenticationRequired -ne $true -or $health.model -ne 'qwen3-vl:4b-instruct'){throw 'Port 21964 is not the authenticated staff candidate.'}
 return $true
}
$ready=$false
try{$ready=Test-StaffCandidateHealth}catch{
 $listener=Get-NetTCPConnection -LocalPort 21964 -State Listen -ErrorAction SilentlyContinue
 if($listener){throw 'Port 21964 occupied or unhealthy; no process was stopped.'}
}
if(-not $ready){
 $taskLogs=Join-Path $taskRoot 'runtime';$taskTmp=Join-Path $taskLogs 'tmp';New-Item -ItemType Directory -Path $taskTmp -Force|Out-Null
 $stamp=Get-Date -Format 'yyyyMMdd-HHmmss-fff';$stdout=Join-Path $taskLogs ($stamp+'.stdout.log');$stderr=Join-Path $taskLogs ($stamp+'.stderr.log')
 $priorTemp=$env:TEMP;$priorTmp=$env:TMP
 try{$env:TEMP=$taskTmp;$env:TMP=$taskTmp;$worker=Start-Process -FilePath $nodePath -ArgumentList @((Join-Path $taskRoot 'entry.mjs')) -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru}
 finally{$env:TEMP=$priorTemp;$env:TMP=$priorTmp}
 for($attempt=0;$attempt -lt 20;$attempt++){
  Start-Sleep -Milliseconds 250;$worker.Refresh();if($worker.HasExited){throw ('Candidate entry exited; inspect '+$stderr)}
  try{$ready=Test-StaffCandidateHealth;if($ready){break}}catch{}
 }
 if(-not $ready){throw ('Candidate did not become healthy; no process was killed. Inspect '+$stderr)}
 @{pid=$worker.Id;url=$candidateUrl;startedAt=(Get-Date).ToString('o');authenticationRequired=$true;productionConnected=$false} |ConvertTo-Json|Set-Content -LiteralPath (Join-Path $taskLogs ($stamp+'.process.json')) -Encoding utf8
}
Write-Output ('Authenticated staff candidate: '+$candidateUrl+'; independent synthetic accounts only')
if($Open){Start-Process $candidateUrl}

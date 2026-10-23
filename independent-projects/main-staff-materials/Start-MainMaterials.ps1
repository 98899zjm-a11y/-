param([switch]$Open)
$ErrorActionPreference='Stop'
$taskRoot='D:\Codex\xjy-main-staff-session-20261023'
$taskCandidate=Join-Path $taskRoot 'candidate'
$taskNode='D:\Codex\xjy-agent-sales-media\openclaw-isolated\runtime\node-v24.22.1-win-x64\node.exe'
$taskEntry=Join-Path $taskCandidate 'start-candidate.mjs'
$taskOrigin='http://127.0.0.1:21965'
$taskListeners=@(Get-NetTCPConnection -State Listen -LocalPort 21965 -ErrorAction SilentlyContinue)
if($taskListeners.Count){throw '21965已被占用；本次未启动或复用任何进程。请核对D盘候选实例，已有页面可直接打开。'}
if((Get-FileHash -LiteralPath $taskNode).Hash -ne 'D702DAA815EABBFF763C7D3808E235CF031CF2CA70211B56847BC72F51E240E5'){throw '候选Node运行时已变，停止启动'}
$taskLogs=Join-Path $taskRoot 'evidence'
$taskStamp=Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$taskSavedTemp=$env:TEMP;$taskSavedTmp=$env:TMP
try{
 $env:TEMP=Join-Path $taskCandidate 'runtime\tmp';$env:TMP=$env:TEMP
 $taskProcess=Start-Process -FilePath $taskNode -ArgumentList @($taskEntry) -WorkingDirectory $taskCandidate -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskLogs "$taskStamp.stdout.log") -RedirectStandardError (Join-Path $taskLogs "$taskStamp.stderr.log")
}finally{$env:TEMP=$taskSavedTemp;$env:TMP=$taskSavedTmp}
$taskReady=$false
for($taskAttempt=0;$taskAttempt -lt 40;$taskAttempt++){
 $taskProcess.Refresh();if($taskProcess.HasExited){throw "候选未能启动，见D盘 $taskStamp.stderr.log；未操作正式版"}
 try{$taskInstance=Get-Content -LiteralPath (Join-Path $taskCandidate 'runtime\instance.json') -Raw | ConvertFrom-Json;$taskHealth=Invoke-RestMethod -Uri "$taskOrigin/health" -TimeoutSec 2;if($taskInstance.pid -eq $taskProcess.Id -and $taskInstance.origin -eq $taskOrigin -and $taskInstance.mainSystemSession -eq $true -and $taskHealth.ok -eq $true){$taskReady=$true;break}}catch{}
 Start-Sleep -Milliseconds 200
}
if(!$taskReady){throw '新候选尚未通过启动验收；保留进程与D盘日志，不强制终止'}
[pscustomobject]@{origin=$taskOrigin;pid=$taskProcess.Id;mainSystemSession=$true;productionConnected=$false}
if($Open){Start-Process $taskOrigin}

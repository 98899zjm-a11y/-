param([switch]$Open)
$ErrorActionPreference='Stop'
$taskRoot=$PSScriptRoot
$nodePath='D:\Codex\xjy-agent-sales-media\openclaw-isolated\runtime\node-v24.22.1-win-x64\node.exe'
$candidateUrl='http://127.0.0.1:21963'
$runtimePath=Join-Path $taskRoot 'runtime'
New-Item -ItemType Directory -Path (Join-Path $runtimePath 'tmp') -Force | Out-Null
$env:TEMP=Join-Path $runtimePath 'tmp'
$env:TMP=$env:TEMP
$ready=$false
try {
  $health=Invoke-RestMethod -Uri ($candidateUrl+'/api/health') -TimeoutSec 4
  if ($health.candidate -eq $true -and $health.model -eq 'qwen3-vl:4b') {$ready=$true} else {throw 'Port 21963 belongs to another application.'}
} catch {
  $listener=Get-NetTCPConnection -LocalPort 21963 -State Listen -ErrorAction SilentlyContinue
  if ($listener) {throw 'Port 21963 is occupied; no process was stopped.'}
}
if (-not $ready) {
  if (-not (Test-Path -LiteralPath $nodePath -PathType Leaf)) {throw 'Isolated D drive Node runtime not found.'}
  $stdout=Join-Path $runtimePath 'server.stdout.log'
  $stderr=Join-Path $runtimePath 'server.stderr.log'
  $worker=Start-Process -FilePath $nodePath -ArgumentList @((Join-Path $taskRoot 'server.mjs')) -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
  for ($attempt=0;$attempt -lt 20;$attempt++) {
    Start-Sleep -Milliseconds 250
    if ($worker.HasExited) {throw ('Candidate failed to start. Read '+$stderr)}
    try {$health=Invoke-RestMethod -Uri ($candidateUrl+'/api/health') -TimeoutSec 3;if($health.candidate -eq $true){$ready=$true;break}} catch {}
  }
  if (-not $ready) {throw 'Candidate did not become ready; inspect D drive runtime logs.'}
  @{pid=$worker.Id;url=$candidateUrl;startedAt=(Get-Date).ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtimePath 'server-process.json') -Encoding UTF8
}
Write-Output ('Sales materials candidate: '+$candidateUrl)
if ($Open) {Start-Process $candidateUrl}

# XjyWorkerResult.Tests.ps1 — 真实进程测试（Windows PowerShell 5.1，UTF-8 带 BOM）
# 只用虚构进程与临时目录；不接触真实安装、真实账套、正式数据；结束前关闭虚构进程、保留样本。
# 用法：powershell.exe -NoProfile -File XjyWorkerResult.Tests.ps1
param()
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'XjyWorkerResult.ps1')

$script:pass = 0; $script:fail = 0
$script:cleanupPids = New-Object System.Collections.ArrayList
$script:root = Join-Path ([System.IO.Path]::GetTempPath()) ('xjy-worker-test-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $script:root | Out-Null
Write-Host ('临时目录：' + $script:root)

function Write-Result { param([string]$Name, [bool]$Ok, [string]$Detail)
    if ($Ok) { $script:pass++; Write-Host ('[PASS] ' + $Name + ' ' + $Detail) } else { $script:fail++; Write-Host ('[FAIL] ' + $Name + ' ' + $Detail) } }
function New-WorkerScript { param([string]$Name, [string]$Content)
    $path = Join-Path $script:root $Name; Set-Content -LiteralPath $path -Value $Content -Encoding ASCII; return $path }
function Start-TestWorker { param([string]$ScriptPath)
    $exe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    if (-not (Test-Path -LiteralPath $exe)) { throw '找不到 powershell.exe' }
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $exe; $psi.Arguments = '-NoProfile -File "' + $ScriptPath + '"'
    $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
    $process = [System.Diagnostics.Process]::Start($psi); [void]$script:cleanupPids.Add($process.Id); return $process }
function Get-DescendantPid { param([string]$StderrText)
    foreach ($line in ($StderrText -split "\r?\n")) { if ($line -match '^DESC_PID=(\d+)$') { return [int]$Matches[1] } } return 0 }
function Stop-FictitiousProcess { param([int]$Id)
    if ($Id -le 0) { return }
    try { $proc = Get-Process -Id $Id -ErrorAction Stop; $proc.Kill(); [void]$proc.WaitForExit(3000) } catch { } }

try {
    # J01：后代进程持有 worker 的 stdout/stderr 写端（EOF 迟到）——修复后仍成功，不等待 EOF
    $workerA = @'
$descPsi = New-Object System.Diagnostics.ProcessStartInfo
$descPsi.FileName = 'powershell.exe'
$descPsi.Arguments = '-NoProfile -Command "Start-Sleep -Seconds 120"'
$descPsi.UseShellExecute = $false
$descPsi.CreateNoWindow = $true
$descPsi.RedirectStandardInput = $true
$descPsi.RedirectStandardOutput = $true
$descPsi.RedirectStandardError = $true
$desc = [System.Diagnostics.Process]::Start($descPsi)
[Console]::Error.WriteLine('DESC_PID=' + $desc.Id)
[Console]::Out.WriteLine('{"type":"result","completed":true,"version":"1.7.0","engineVersion":"1.7.0.0","role":"employee"}')
[Console]::Out.Flush()
[Console]::Error.Flush()
Start-Sleep -Milliseconds 300
exit 0
'@
    $pA = Start-TestWorker -ScriptPath (New-WorkerScript -Name 'worker-a.ps1' -Content $workerA)
    $watchA = [System.Diagnostics.Stopwatch]::StartNew()
    $outcomeA = Wait-XjyWorkerResult -Process $pA -ExpectedVersion '1.7.0' -ExpectedEngineVersion '1.7.0.0' -ExpectedRole 'employee' -ProcessTimeoutMs 15000 -DrainQuietMs 400 -DrainMaxMs 3000
    $watchA.Stop()
    $descA = Get-DescendantPid -StderrText $outcomeA.Stderr
    [void]$script:cleanupPids.Add($descA)
    $descAliveA = $false
    if ($descA -gt 0) { $descAliveA = [bool](Get-Process -Id $descA -ErrorAction SilentlyContinue) }
    $okA = ($outcomeA.Phase -eq 'Success') -and (-not $outcomeA.EofObserved) -and $descAliveA -and ($watchA.ElapsedMilliseconds -lt 10000)
    Write-Result 'J01 长寿命后代持有管道：成功返回且不等待 EOF' $okA ('Phase=' + $outcomeA.Phase + ' EOF=' + $outcomeA.EofObserved + ' 后代存活=' + $descAliveA + ' 用时=' + $watchA.ElapsedMilliseconds + 'ms')

    # J02：唯一正确结果 + worker 正常退出（无后代）——成功且观察到 EOF
    $workerB = @'
[Console]::Out.WriteLine('{"type":"result","completed":true,"version":"1.7.0","engineVersion":"1.7.0.0","role":"employee"}')
[Console]::Out.Flush()
Start-Sleep -Milliseconds 200
exit 0
'@
    $pB = Start-TestWorker -ScriptPath (New-WorkerScript -Name 'worker-b.ps1' -Content $workerB)
    $watchB = [System.Diagnostics.Stopwatch]::StartNew()
    $outcomeB = Wait-XjyWorkerResult -Process $pB -ExpectedVersion '1.7.0' -ExpectedEngineVersion '1.7.0.0' -ExpectedRole 'employee' -ProcessTimeoutMs 15000 -DrainQuietMs 400 -DrainMaxMs 3000
    $watchB.Stop()
    $okB = ($outcomeB.Phase -eq 'Success') -and $outcomeB.EofObserved -and ($watchB.ElapsedMilliseconds -lt 10000)
    Write-Result 'J02 唯一正确结果+正常退出：成功且观察到 EOF' $okB ('Phase=' + $outcomeB.Phase + ' EOF=' + $outcomeB.EofObserved + ' 用时=' + $watchB.ElapsedMilliseconds + 'ms')

    # J03：结果正确但退出码 3——失败关闭
    $workerC = @'
[Console]::Out.WriteLine('{"type":"result","completed":true,"version":"1.7.0","engineVersion":"1.7.0.0","role":"employee"}')
[Console]::Out.Flush()
Start-Sleep -Milliseconds 100
exit 3
'@
    $pC = Start-TestWorker -ScriptPath (New-WorkerScript -Name 'worker-c.ps1' -Content $workerC)
    $outcomeC = Wait-XjyWorkerResult -Process $pC -ExpectedVersion '1.7.0' -ExpectedEngineVersion '1.7.0.0' -ExpectedRole 'employee' -ProcessTimeoutMs 15000 -DrainQuietMs 300 -DrainMaxMs 2000
    Write-Result 'J03 非零退出码：失败关闭' (($outcomeC.Phase -eq 'FailExitCode') -and ($outcomeC.ExitCode -eq 3)) ('Phase=' + $outcomeC.Phase + ' ExitCode=' + $outcomeC.ExitCode)

    # J04：无结果输出
    $pD = Start-TestWorker -ScriptPath (New-WorkerScript -Name 'worker-d.ps1' -Content "Start-Sleep -Milliseconds 100`nexit 0`n")
    $outcomeD = Wait-XjyWorkerResult -Process $pD -ExpectedVersion '1.7.0' -ExpectedEngineVersion '1.7.0.0' -ExpectedRole 'employee' -ProcessTimeoutMs 15000 -DrainQuietMs 300 -DrainMaxMs 2000
    Write-Result 'J04 缺失结果：失败关闭' (($outcomeD.Phase -eq 'FailResult') -and ($outcomeD.Reason -eq 'stdout 缺少 result')) ('Phase=' + $outcomeD.Phase + ' 原因=' + $outcomeD.Reason)

    # J05：重复结果
    $workerE = @'
[Console]::Out.WriteLine('{"type":"result","completed":true,"version":"1.7.0","engineVersion":"1.7.0.0","role":"employee"}')
[Console]::Out.WriteLine('{"type":"result","completed":true,"version":"1.7.0","engineVersion":"1.7.0.0","role":"employee"}')
[Console]::Out.Flush()
exit 0
'@
    $pE = Start-TestWorker -ScriptPath (New-WorkerScript -Name 'worker-e.ps1' -Content $workerE)
    $outcomeE = Wait-XjyWorkerResult -Process $pE -ExpectedVersion '1.7.0' -ExpectedEngineVersion '1.7.0.0' -ExpectedRole 'employee' -ProcessTimeoutMs 15000 -DrainQuietMs 300 -DrainMaxMs 2000
    Write-Result 'J05 重复结果：失败关闭' (($outcomeE.Phase -eq 'FailResult') -and ($outcomeE.Reason -eq 'stdout 出现重复 result')) ('Phase=' + $outcomeE.Phase + ' 原因=' + $outcomeE.Reason)

    # J06：角色不符
    $workerF = @'
[Console]::Out.WriteLine('{"type":"result","completed":true,"version":"1.7.0","engineVersion":"1.7.0.0","role":"host"}')
[Console]::Out.Flush()
exit 0
'@
    $pF = Start-TestWorker -ScriptPath (New-WorkerScript -Name 'worker-f.ps1' -Content $workerF)
    $outcomeF = Wait-XjyWorkerResult -Process $pF -ExpectedVersion '1.7.0' -ExpectedEngineVersion '1.7.0.0' -ExpectedRole 'employee' -ProcessTimeoutMs 15000 -DrainQuietMs 300 -DrainMaxMs 2000
    Write-Result 'J06 角色不符：失败关闭' (($outcomeF.Phase -eq 'FailResult') -and ($outcomeF.Reason -eq 'role 不符')) ('Phase=' + $outcomeF.Phase + ' 原因=' + $outcomeF.Reason)

    # J07：completed 不为 true
    $workerG = @'
[Console]::Out.WriteLine('{"type":"result","completed":false,"version":"1.7.0","engineVersion":"1.7.0.0","role":"employee"}')
[Console]::Out.Flush()
exit 0
'@
    $pG = Start-TestWorker -ScriptPath (New-WorkerScript -Name 'worker-g.ps1' -Content $workerG)
    $outcomeG = Wait-XjyWorkerResult -Process $pG -ExpectedVersion '1.7.0' -ExpectedEngineVersion '1.7.0.0' -ExpectedRole 'employee' -ProcessTimeoutMs 15000 -DrainQuietMs 300 -DrainMaxMs 2000
    Write-Result 'J07 completed 不为 true：失败关闭' (($outcomeG.Phase -eq 'FailResult') -and ($outcomeG.Reason -eq 'completed 不为 true')) ('Phase=' + $outcomeG.Phase + ' 原因=' + $outcomeG.Reason)

    # J08：worker 仍存活——有界超时失败，且不结束该进程
    $workerH = @'
Start-Sleep -Seconds 5
[Console]::Out.WriteLine('{"type":"result","completed":true,"version":"1.7.0","engineVersion":"1.7.0.0","role":"employee"}')
[Console]::Out.Flush()
exit 0
'@
    $pH = Start-TestWorker -ScriptPath (New-WorkerScript -Name 'worker-h.ps1' -Content $workerH)
    $watchH = [System.Diagnostics.Stopwatch]::StartNew()
    $outcomeH = Wait-XjyWorkerResult -Process $pH -ExpectedVersion '1.7.0' -ExpectedEngineVersion '1.7.0.0' -ExpectedRole 'employee' -ProcessTimeoutMs 600 -DrainQuietMs 200 -DrainMaxMs 1000
    $watchH.Stop()
    $aliveH = [bool](Get-Process -Id $pH.Id -ErrorAction SilentlyContinue)
    Write-Result 'J08 worker 存活：有界超时失败且未杀进程' (($outcomeH.Phase -eq 'FailProcessTimeout') -and $aliveH -and ($watchH.ElapsedMilliseconds -lt 5000)) ('Phase=' + $outcomeH.Phase + ' worker存活=' + $aliveH + ' 用时=' + $watchH.ElapsedMilliseconds + 'ms')

    # J09：stdout 混入非 result 行
    $workerI = @'
[Console]::Out.WriteLine('{"type":"log","message":"starting"}')
[Console]::Out.WriteLine('{"type":"result","completed":true,"version":"1.7.0","engineVersion":"1.7.0.0","role":"employee"}')
[Console]::Out.Flush()
exit 0
'@
    $pI = Start-TestWorker -ScriptPath (New-WorkerScript -Name 'worker-i.ps1' -Content $workerI)
    $outcomeI = Wait-XjyWorkerResult -Process $pI -ExpectedVersion '1.7.0' -ExpectedEngineVersion '1.7.0.0' -ExpectedRole 'employee' -ProcessTimeoutMs 15000 -DrainQuietMs 300 -DrainMaxMs 2000
    Write-Result 'J09 非 result 行：失败关闭' (($outcomeI.Phase -eq 'FailResult') -and ($outcomeI.Reason -eq 'stdout 含非 result 行')) ('Phase=' + $outcomeI.Phase + ' 原因=' + $outcomeI.Reason)
}
catch { $script:fail++; Write-Host ('[FAIL] 未预期异常：' + $_.Exception.Message) }
finally {
    foreach ($pidValue in $script:cleanupPids) { Stop-FictitiousProcess -Id $pidValue }
    Write-Host ('合计 9 项：PASS ' + $script:pass + '，FAIL ' + $script:fail + '。样本保留：' + $script:root)
}
if ($script:fail -gt 0) { exit 1 }
exit 0
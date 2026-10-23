# XjyWorkerResult.ps1 — 安装器 worker 结果接收（Windows PowerShell 5.1，UTF-8 带 BOM）
# 只读 worker 的 stdout/stderr/退出码：不结束进程、不删文件、不写文件、不联网。
# 成功规则与旧代码同义：退出码 0；stdout 必须且仅有一个 type=result；completed=true；
# version/engineVersion/role 与期望完全一致；缺失/重复/错误一律失败关闭。
# 关键改动：不再无限等待 EOF。worker 退出后最多再收集一个有限静默窗口。
#ROOT-INPUT：本文件与 .Tests.ps1 一起放到原安装脚本同目录；原脚本顶部加一行 dot-source。

function New-XjyPipeReader {
    param([Parameter(Mandatory = $true)][System.IO.Stream]$Stream)
    return [pscustomobject]@{
        Stream = $Stream; Buffer = New-Object 'byte[]' 8192; Task = $null; Pending = $false
        Eof = $false; Text = New-Object System.Text.StringBuilder
        Decoder = [System.Text.Encoding]::UTF8.GetDecoder()
    }
}

function Step-XjyPipeReader {
    param([Parameter(Mandatory = $true)]$Reader, [int]$WaitMs = 0)
    if ($Reader.Eof) { return 'eof' }
    if (-not $Reader.Pending) {
        try { $Reader.Task = $Reader.Stream.ReadAsync($Reader.Buffer, 0, $Reader.Buffer.Length); $Reader.Pending = $true }
        catch { $Reader.Eof = $true; return 'error' }
    }
    $finished = $false
    try { $finished = $Reader.Task.Wait($WaitMs) } catch { $Reader.Eof = $true; $Reader.Pending = $false; return 'error' }
    if (-not $finished) { return 'pending' }
    $Reader.Pending = $false
    try { $count = $Reader.Task.Result } catch { $Reader.Eof = $true; return 'error' }
    if ($count -le 0) { $Reader.Eof = $true; return 'eof' }
    $chars = New-Object 'char[]' ($Reader.Decoder.GetCharCount($Reader.Buffer, 0, $count))
    [void]$Reader.Decoder.GetChars($Reader.Buffer, 0, $count, $chars, 0)
    [void]$Reader.Text.Append($chars)
    return 'data'
}

function Read-XjyPipeReaderAvailable {
    param([Parameter(Mandatory = $true)]$Reader)
    $total = 0
    for ($i = 0; $i -lt 64; $i++) {
        $state = Step-XjyPipeReader -Reader $Reader -WaitMs 0
        if ($state -ne 'data') { break }
        $total = $total + 1
    }
    return $total
}

function Wait-XjyWorkerResult {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][System.Diagnostics.Process]$Process,
        [Parameter(Mandatory = $true)][string]$ExpectedVersion,
        [Parameter(Mandatory = $true)][string]$ExpectedEngineVersion,
        [Parameter(Mandatory = $true)][string]$ExpectedRole,
        [int]$ProcessTimeoutMs = 180000,
        [int]$DrainQuietMs = 750,
        [int]$DrainMaxMs = 10000,
        [scriptblock]$OnTick
    )
    if ($null -eq $Process) { throw '缺少 worker 进程对象' }
    if (-not $Process.StartInfo.RedirectStandardOutput -or -not $Process.StartInfo.RedirectStandardError) {
        throw 'worker 进程未重定向 stdout/stderr，无法按合同判定'
    }
    if ($ProcessTimeoutMs -le 0) { $ProcessTimeoutMs = 180000 }
    if ($DrainQuietMs -lt 0) { $DrainQuietMs = 750 }
    if ($DrainMaxMs -lt 0) { $DrainMaxMs = 10000 }

    $readerOut = New-XjyPipeReader -Stream $Process.StandardOutput.BaseStream
    $readerErr = New-XjyPipeReader -Stream $Process.StandardError.BaseStream
    $totalWatch = [System.Diagnostics.Stopwatch]::StartNew()

    $timedOut = $false
    while (-not $Process.HasExited) {
        [void](Read-XjyPipeReaderAvailable -Reader $readerOut)
        [void](Read-XjyPipeReaderAvailable -Reader $readerErr)
        if ($null -ne $OnTick) { try { & $OnTick } catch { } }
        if ($totalWatch.ElapsedMilliseconds -ge $ProcessTimeoutMs) { $timedOut = $true; break }
        Start-Sleep -Milliseconds 10
    }

    if ($timedOut) {
        return [pscustomobject]@{ Phase = 'FailProcessTimeout'; ExitCode = $null; Result = $null
            Stdout = $readerOut.Text.ToString(); Stderr = $readerErr.Text.ToString()
            Reason = ('worker 进程在 ' + $ProcessTimeoutMs + ' 毫秒内未退出；未结束进程，保留现场')
            ElapsedMs = $totalWatch.ElapsedMilliseconds; EofObserved = $false }
    }

    [void]$Process.WaitForExit()
    $exitCode = $Process.ExitCode

    $drainWatch = [System.Diagnostics.Stopwatch]::StartNew()
    $quietWatch = [System.Diagnostics.Stopwatch]::StartNew()
    while ($true) {
        $dataOut = Read-XjyPipeReaderAvailable -Reader $readerOut
        $dataErr = Read-XjyPipeReaderAvailable -Reader $readerErr
        if (($dataOut + $dataErr) -gt 0) { $quietWatch.Restart() }
        if ($readerOut.Eof -and $readerErr.Eof) { break }
        if ($drainWatch.ElapsedMilliseconds -ge $DrainMaxMs) { break }
        if ($quietWatch.ElapsedMilliseconds -ge $DrainQuietMs) { break }
        if ($null -ne $OnTick) { try { & $OnTick } catch { } }
        Start-Sleep -Milliseconds 10
    }

    $eofObserved = ($readerOut.Eof -and $readerErr.Eof)
    $stdout = $readerOut.Text.ToString().TrimStart([char]0xFEFF)
    $stderr = $readerErr.Text.ToString()
    $elapsed = $totalWatch.ElapsedMilliseconds

    if ($exitCode -ne 0) {
        return [pscustomobject]@{ Phase = 'FailExitCode'; ExitCode = $exitCode; Result = $null
            Stdout = $stdout; Stderr = $stderr
            Reason = ('worker 退出码为 ' + $exitCode + '，不等于 0')
            ElapsedMs = $elapsed; EofObserved = $eofObserved }
    }

    $resultObject = $null; $resultCount = 0; $parseReason = $null
    foreach ($line in @($stdout -split "\r?\n")) {
        $text = $line.Trim()
        if ($text.Length -eq 0) { continue }
        $parsedLine = $null
        try { $parsedLine = ConvertFrom-Json -InputObject $text } catch { $parseReason = 'stdout 含无法解析为 JSON 的行'; break }
        if ($null -eq $parsedLine) { $parseReason = 'stdout 含空 JSON 值'; break }
        $typeProperty = $parsedLine.PSObject.Properties['type']
        if ($null -eq $typeProperty -or ([string]($typeProperty.Value)) -cne 'result') { $parseReason = 'stdout 含非 result 行'; break }
        $resultCount = $resultCount + 1
        if ($resultCount -gt 1) { $parseReason = 'stdout 出现重复 result'; break }
        $resultObject = $parsedLine
    }
    if ($null -eq $parseReason -and $resultCount -eq 0) { $parseReason = 'stdout 缺少 result' }

    if ($null -ne $parseReason) {
        return [pscustomobject]@{ Phase = 'FailResult'; ExitCode = $exitCode; Result = $null
            Stdout = $stdout; Stderr = $stderr; Reason = $parseReason; ElapsedMs = $elapsed; EofObserved = $eofObserved }
    }

    $fieldReason = $null
    $completedProperty = $resultObject.PSObject.Properties['completed']
    if ($null -eq $completedProperty) { $fieldReason = 'completed 缺失' }
    elseif (-not ($completedProperty.Value -is [bool])) { $fieldReason = 'completed 不是布尔值' }
    elseif ($completedProperty.Value -ne $true) { $fieldReason = 'completed 不为 true' }
    elseif (([string]($resultObject.version)) -cne $ExpectedVersion) { $fieldReason = 'version 不符' }
    elseif (([string]($resultObject.engineVersion)) -cne $ExpectedEngineVersion) { $fieldReason = 'engineVersion 不符' }
    elseif (([string]($resultObject.role)) -cne $ExpectedRole) { $fieldReason = 'role 不符' }

    if ($null -ne $fieldReason) {
        return [pscustomobject]@{ Phase = 'FailResult'; ExitCode = $exitCode; Result = $resultObject
            Stdout = $stdout; Stderr = $stderr; Reason = $fieldReason; ElapsedMs = $elapsed; EofObserved = $eofObserved }
    }

    return [pscustomobject]@{ Phase = 'Success'; ExitCode = $exitCode; Result = $resultObject
        Stdout = $stdout; Stderr = $stderr; Reason = ''; ElapsedMs = $elapsed; EofObserved = $eofObserved }
}
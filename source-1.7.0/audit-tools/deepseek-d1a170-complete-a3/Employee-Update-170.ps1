# delivery-tools/Employee-Update-170.ps1
# 员工一键升级包装器：只读包外审批取安装位置，以已装 EXE 的 RUN_AS_NODE 启动 Node 启动器。
# 所有严格校验（包树、v2 策略、已装 EXE、物理身份、fresh 基线）由 Node 启动器完成。
# 不使用 -ExecutionPolicy Bypass；策略不允许时明确失败，不降级。
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
try {
    $root = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
    $common = [Environment]::GetFolderPath([Environment+SpecialFolder]::CommonApplicationData)
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $policyText = [Text.Encoding]::UTF8.GetString([IO.File]::ReadAllBytes((Join-Path $root 'source-policy-envelope.json')))
    $policyWrapper = $policyText | ConvertFrom-Json
    $policy = $policyWrapper.policy | ConvertFrom-Json
    if ($policy.schemaVersion -ne 2 -or $policy.purpose -cne 'xjy-repeat-program-patch' -or $policy.targetVersion -cne '1.7.0') { throw '本入口只承接 V2 员工同版补丁。' }
    $publicationId = [string]$policy.catalogSha256
    if ($publicationId -cnotmatch '^[a-f0-9]{64}$') { throw '补丁发布身份无效。' }
    $approvalRoot = Join-Path (Join-Path $common ('鑫金源珠宝补丁审定-' + $sid)) $publicationId
    $approvalFile = Join-Path $approvalRoot 'initial-upgrade-approval.json'
    if (!(Test-Path -LiteralPath $approvalFile -PathType Leaf)) { throw '缺少包外独立审定记录；请先由负责人审定本次补丁。' }
    $record = ([Text.Encoding]::UTF8.GetString([IO.File]::ReadAllBytes($approvalFile))) | ConvertFrom-Json
    if ($record.purpose -cne 'xjy-repeat-program-patch' -or $record.role -cne 'employee' -or $record.osUser -cne $sid) { throw '包外审定记录不是本机员工补丁。' }
    if (![IO.Path]::IsPathRooted([string]$record.installationDir)) { throw '包外审定安装位置无效。' }
    $exe = Join-Path ([string]$record.installationDir) '鑫金源珠宝报价.exe'
    if (!(Test-Path -LiteralPath $exe -PathType Leaf)) { throw '找不到已装员工程序；请保留现场并联系管理员。' }

    $psi = New-Object Diagnostics.ProcessStartInfo
    $psi.FileName = $exe
    $psi.Arguments = '"' + (Join-Path $root 'delivery-tools\Employee-Update-Launch-170.cjs') + '" --artifact-dir "' + $root + '"'
    $psi.WorkingDirectory = $root
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.StandardOutputEncoding = [Text.UTF8Encoding]::new($false)
    $psi.StandardErrorEncoding = [Text.UTF8Encoding]::new($false)
    $psi.EnvironmentVariables.Clear()
    foreach ($key in @('SystemRoot','WINDIR','TEMP','TMP','LOCALAPPDATA','APPDATA','USERPROFILE')) {
        $value = [Environment]::GetEnvironmentVariable($key, 'Process')
        if ($value) { $psi.EnvironmentVariables[$key] = $value }
    }
    $psi.EnvironmentVariables['ELECTRON_RUN_AS_NODE'] = '1'
    $psi.EnvironmentVariables['XJY_INITIAL_APPROVAL_LAUNCH'] = '1'
    $psi.EnvironmentVariables['XJY_INITIAL_ROLE'] = 'employee'
    $psi.EnvironmentVariables['XJY_INITIAL_OS_USER'] = $sid

    $process = [Diagnostics.Process]::Start($psi)
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $process.WaitForExit()
    $stdout = $stdoutTask.Result
    $stderr = $stderrTask.Result
    if ($process.ExitCode -ne 0) { throw $stderr }
    $result = $stdout.Trim() | ConvertFrom-Json
    if ($result.result.installed -eq $true -or $result.result.alreadyInstalled -eq $true) {
        [void][Windows.Forms.MessageBox]::Show('本次员工补丁已完成并通过核验。','鑫金源珠宝1.7')
    } elseif ($result.result.recovered -eq $true) {
        [void][Windows.Forms.MessageBox]::Show('原助手已恢复旧程序，资料快照保留；请保留材料并联系管理员。','已恢复')
    } else {
        throw '助手没有确认升级或恢复完成。'
    }
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
# XjyEmployeeShortcut.ps1 — 员工端桌面快捷方式（Windows PowerShell 5.1，UTF-8 带 BOM）
# 前置（调用方保证）：安装已完整提交，且角色已确认为员工。只创建一个 .lnk：
# 不改注册表、不改权限、不删桌面其他文件、不按盘符推断角色；同名不同目标一律拒绝覆盖。
#ROOT-INPUT：目标程序文件名（当前按 鑫金源珠宝报价.exe 写死）须与已核程序清单/installationDir 实际一致，不一致请只改这一行常量。
function New-XjyEmployeeShortcut {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$InstallationDir,
        [Parameter(Mandatory = $true)][switch]$CommitVerified,
        [Parameter(Mandatory = $true)][string]$VerifiedRole,
        [string]$DesktopDirectory
    )
    if (-not $CommitVerified) { throw '调用前置不成立：安装提交尚未验证，拒绝创建快捷方式' }
    if ($VerifiedRole -cne 'employee') { throw ('调用前置不成立：已验证角色为 ' + $VerifiedRole + '，不是 employee') }

    $installRoot = [System.IO.Path]::GetFullPath($InstallationDir).TrimEnd('\')
    $exeName = '鑫金源珠宝报价.exe'
    $exePath = [System.IO.Path]::GetFullPath((Join-Path $installRoot $exeName))
    if (-not (Test-Path -LiteralPath $exePath -PathType Leaf)) { throw ('目标程序不存在，拒绝创建快捷方式：' + $exePath) }

    if ([string]::IsNullOrWhiteSpace($DesktopDirectory)) {
        $DesktopDirectory = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::Desktop)
    }
    if (-not (Test-Path -LiteralPath $DesktopDirectory -PathType Container)) { throw ('桌面目录不存在，拒绝创建快捷方式：' + $DesktopDirectory) }
    $desktopRoot = [System.IO.Path]::GetFullPath($DesktopDirectory).TrimEnd('\')
    $linkPath = Join-Path $desktopRoot '鑫金源珠宝（员工端）.lnk'
    $expectedArguments = '--employee-client'
    $shell = New-Object -ComObject WScript.Shell

    if (Test-Path -LiteralPath $linkPath -PathType Leaf) {
        $existing = $shell.CreateShortcut($linkPath)
        $sameTarget = $false; $sameWorkDir = $false
        if (-not [string]::IsNullOrWhiteSpace([string]$existing.TargetPath)) {
            $sameTarget = ([System.IO.Path]::GetFullPath([string]$existing.TargetPath).TrimEnd('\')) -ieq $exePath
        }
        if (-not [string]::IsNullOrWhiteSpace([string]$existing.WorkingDirectory)) {
            $sameWorkDir = ([System.IO.Path]::GetFullPath([string]$existing.WorkingDirectory).TrimEnd('\')) -ieq $installRoot
        }
        $sameArguments = ([string]$existing.Arguments) -ieq $expectedArguments
        if (-not ($sameTarget -and $sameArguments -and $sameWorkDir)) {
            throw ('桌面已有同名但目标不同的快捷方式，拒绝覆盖：' + $linkPath)
        }
        return [pscustomobject]@{ Created = $false; Reused = $true; Path = $linkPath; Target = $exePath; Arguments = $expectedArguments; WorkingDirectory = $installRoot }
    }

    $link = $shell.CreateShortcut($linkPath)
    $link.TargetPath = $exePath
    $link.Arguments = $expectedArguments
    $link.WorkingDirectory = $installRoot
    $link.Save()

    $check = $shell.CreateShortcut($linkPath)
    if (-not (([System.IO.Path]::GetFullPath([string]$check.TargetPath).TrimEnd('\')) -ieq $exePath)) { throw '快捷方式回读校验失败：TargetPath 不符' }
    if (-not (([string]$check.Arguments) -ieq $expectedArguments)) { throw '快捷方式回读校验失败：Arguments 不符' }
    if (-not (([System.IO.Path]::GetFullPath([string]$check.WorkingDirectory).TrimEnd('\')) -ieq $installRoot)) { throw '快捷方式回读校验失败：WorkingDirectory 不符' }

    return [pscustomobject]@{ Created = $true; Reused = $false; Path = $linkPath; Target = $exePath; Arguments = $expectedArguments; WorkingDirectory = $installRoot }
}
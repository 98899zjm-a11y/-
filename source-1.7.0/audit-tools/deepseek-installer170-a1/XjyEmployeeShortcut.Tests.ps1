# XjyEmployeeShortcut.Tests.ps1 — 合成新目录测试（Windows PowerShell 5.1，UTF-8 带 BOM）
# 只使用临时目录与虚构文件/.lnk；不触碰真实桌面、真实安装目录或正式数据；样本保留。
# 用法：powershell.exe -NoProfile -File XjyEmployeeShortcut.Tests.ps1
param()
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'XjyEmployeeShortcut.ps1')

$script:pass = 0; $script:fail = 0
$script:base = Join-Path ([System.IO.Path]::GetTempPath()) ('xjy-shortcut-test-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $script:base | Out-Null
Write-Host ('临时目录：' + $script:base)

function Write-Result { param([string]$Name, [bool]$Ok, [string]$Detail)
    if ($Ok) { $script:pass++; Write-Host ('[PASS] ' + $Name + ' ' + $Detail) } else { $script:fail++; Write-Host ('[FAIL] ' + $Name + ' ' + $Detail) } }
function New-Fixture { param([string]$Name)
    $root = Join-Path $script:base $Name; $install = Join-Path $root 'install'; $desktop = Join-Path $root 'desktop'
    New-Item -ItemType Directory -Path $install, $desktop | Out-Null
    $exe = Join-Path $install '鑫金源珠宝报价.exe'
    [System.IO.File]::WriteAllBytes($exe, [byte[]](1, 2, 3, 4))
    return [pscustomobject]@{ Root = $root; Install = $install; Desktop = $desktop; Exe = $exe; Shell = (New-Object -ComObject WScript.Shell) } }
function Get-LinkPath { param($Fixture) return (Join-Path $Fixture.Desktop '鑫金源珠宝（员工端）.lnk') }

try {
    # K01：提交未验证 → 拒绝且不创建
    $f = New-Fixture 'k01'; $threw = $false
    try { [void](New-XjyEmployeeShortcut -InstallationDir $f.Install -CommitVerified:$false -VerifiedRole 'employee' -DesktopDirectory $f.Desktop) } catch { $threw = $true }
    $link = Get-LinkPath -Fixture $f
    Write-Result 'K01 提交未验证：拒绝且不创建' ($threw -and (-not (Test-Path -LiteralPath $link))) ('threw=' + $threw)

    # K02：角色不是员工 → 拒绝且不创建
    $f = New-Fixture 'k02'; $threw = $false
    try { [void](New-XjyEmployeeShortcut -InstallationDir $f.Install -CommitVerified -VerifiedRole 'host' -DesktopDirectory $f.Desktop) } catch { $threw = $true }
    $link = Get-LinkPath -Fixture $f
    Write-Result 'K02 非员工角色：拒绝且不创建' ($threw -and (-not (Test-Path -LiteralPath $link))) ('threw=' + $threw)

    # K03：首次创建 → 名称/目标/参数/工作目录正确
    $f = New-Fixture 'k03'
    $outcome = New-XjyEmployeeShortcut -InstallationDir $f.Install -CommitVerified -VerifiedRole 'employee' -DesktopDirectory $f.Desktop
    $link = Get-LinkPath -Fixture $f
    $exists = Test-Path -LiteralPath $link -PathType Leaf
    $read = $f.Shell.CreateShortcut($link)
    $targetOk = ([System.IO.Path]::GetFullPath([string]$read.TargetPath).TrimEnd('\')) -ieq ([System.IO.Path]::GetFullPath($f.Exe).TrimEnd('\'))
    $argsOk = ([string]$read.Arguments) -ieq '--employee-client'
    $workOk = ([System.IO.Path]::GetFullPath([string]$read.WorkingDirectory).TrimEnd('\')) -ieq ([System.IO.Path]::GetFullPath($f.Install).TrimEnd('\'))
    Write-Result 'K03 首次创建：名称/目标/参数/工作目录正确' ($exists -and $outcome.Created -and $targetOk -and $argsOk -and $workOk) ('目标=' + $targetOk + ' 参数=' + $argsOk + ' 工作目录=' + $workOk)

    # K04：同目标重复调用 → 复用，不重写文件
    $hashBefore = (Get-FileHash -LiteralPath $link -Algorithm SHA256).Hash
    $timeBefore = (Get-Item -LiteralPath $link).LastWriteTimeUtc
    $again = New-XjyEmployeeShortcut -InstallationDir $f.Install -CommitVerified -VerifiedRole 'employee' -DesktopDirectory $f.Desktop
    $hashAfter = (Get-FileHash -LiteralPath $link -Algorithm SHA256).Hash
    $timeAfter = (Get-Item -LiteralPath $link).LastWriteTimeUtc
    Write-Result 'K04 同目标重复：复用且文件不变' ((-not $again.Created) -and $again.Reused -and ($hashBefore -eq $hashAfter) -and ($timeBefore -eq $timeAfter)) ('哈希一致=' + ($hashBefore -eq $hashAfter))

    # K05：同名不同目标 → 拒绝覆盖，旧链接原样保留
    $f = New-Fixture 'k05'
    $otherExe = Join-Path $f.Install '备用程序.exe'
    [System.IO.File]::WriteAllBytes($otherExe, [byte[]](9, 9))
    $link = Get-LinkPath -Fixture $f
    $existing = $f.Shell.CreateShortcut($link)
    $existing.TargetPath = $otherExe; $existing.Arguments = '--employee-client'; $existing.WorkingDirectory = $f.Install; $existing.Save()
    $hashBefore = (Get-FileHash -LiteralPath $link -Algorithm SHA256).Hash
    $threw = $false
    try { [void](New-XjyEmployeeShortcut -InstallationDir $f.Install -CommitVerified -VerifiedRole 'employee' -DesktopDirectory $f.Desktop) } catch { $threw = $true }
    $read = $f.Shell.CreateShortcut($link)
    $hashAfter = (Get-FileHash -LiteralPath $link -Algorithm SHA256).Hash
    $preserved = ([System.IO.Path]::GetFullPath([string]$read.TargetPath).TrimEnd('\')) -ieq ([System.IO.Path]::GetFullPath($otherExe).TrimEnd('\'))
    Write-Result 'K05 同名不同目标：拒绝覆盖且旧链接保留' ($threw -and $preserved -and ($hashBefore -eq $hashAfter)) ('threw=' + $threw + ' 旧目标保留=' + $preserved)

    # K06：目标程序缺失 → 拒绝且不创建
    $f = New-Fixture 'k06'
    Remove-Item -LiteralPath $f.Exe -Force
    $threw = $false
    try { [void](New-XjyEmployeeShortcut -InstallationDir $f.Install -CommitVerified -VerifiedRole 'employee' -DesktopDirectory $f.Desktop) } catch { $threw = $true }
    $link = Get-LinkPath -Fixture $f
    Write-Result 'K06 目标程序缺失：拒绝且不创建' ($threw -and (-not (Test-Path -LiteralPath $link))) ('threw=' + $threw)

    # K07：桌面其他文件不动，只新增唯一链接
    $f = New-Fixture 'k07'
    $note = Join-Path $f.Desktop '说明.txt'; [System.IO.File]::WriteAllText($note, '保留')
    $otherLink = Join-Path $f.Desktop '其他链接.lnk'
    $ol = $f.Shell.CreateShortcut($otherLink); $ol.TargetPath = $f.Exe; $ol.Save()
    $noteHashBefore = (Get-FileHash -LiteralPath $note -Algorithm SHA256).Hash
    $otherHashBefore = (Get-FileHash -LiteralPath $otherLink -Algorithm SHA256).Hash
    $namesBefore = @(Get-ChildItem -LiteralPath $f.Desktop -Force | ForEach-Object { $_.Name } | Sort-Object)
    $outcome = New-XjyEmployeeShortcut -InstallationDir $f.Install -CommitVerified -VerifiedRole 'employee' -DesktopDirectory $f.Desktop
    $noteHashAfter = (Get-FileHash -LiteralPath $note -Algorithm SHA256).Hash
    $otherHashAfter = (Get-FileHash -LiteralPath $otherLink -Algorithm SHA256).Hash
    $namesAfter = @(Get-ChildItem -LiteralPath $f.Desktop -Force | ForEach-Object { $_.Name } | Sort-Object)
    $expectedNames = @(($namesBefore + '鑫金源珠宝（员工端）.lnk') | Sort-Object)
    $namesOk = (($namesAfter -join '|') -eq ($expectedNames -join '|'))
    Write-Result 'K07 桌面其他文件不动：只新增唯一链接' ($outcome.Created -and ($noteHashBefore -eq $noteHashAfter) -and ($otherHashBefore -eq $otherHashAfter) -and $namesOk) ('目录项一致=' + $namesOk)
}
catch { $script:fail++; Write-Host ('[FAIL] 未预期异常：' + $_.Exception.Message) }
finally { Write-Host ('合计 7 项：PASS ' + $script:pass + '，FAIL ' + $script:fail + '。样本保留：' + $script:base) }
if ($script:fail -gt 0) { exit 1 }
exit 0
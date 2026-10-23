# Windows PowerShell 5.1. The packager writes this file as UTF-8 with BOM.
[CmdletBinding()]
param(
  [ValidateSet('Update','Rollback','Check','Employee','EmployeeUpdate')][string]$Action = 'Update',
  [ValidateSet('Auto','Host','Employee')][string]$Role = 'Auto',
  [string]$InstallDir = '',
  [string]$BackupRoot = '',
  [string]$BackupId = ''
)
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
# A CMD launched from PowerShell 7 can inherit its module search paths.
# Load the Windows PowerShell utility module explicitly for hashes and JSON.
Import-Module ([IO.Path]::Combine($PSHOME,'Modules','Microsoft.PowerShell.Utility','Microsoft.PowerShell.Utility.psd1')) -ErrorAction Stop
$taskEncoding = New-Object System.Text.UTF8Encoding($false)

function Get-SafePath([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value) -or $Value -notmatch '^[A-Za-z]:[\\/]' -or $Value.Substring(2).Contains(':') -or $Value.Contains('"')) { throw '请填写本机磁盘上的完整目录，不能使用网络、设备或特殊路径。' }
  foreach ($part in ($Value.Substring(3) -split '[\\/]')) {
    if ($part -eq '.' -or $part -eq '..' -or ($part.Length -gt 0 -and ($part.EndsWith('.') -or $part.EndsWith(' ')))) { throw '目录中不能包含跳转、末尾空格或末尾点。' }
  }
  $full = [IO.Path]::GetFullPath($Value)
  if ($full.Length -gt 3) { $full = $full.TrimEnd('\','/') }
  $walk = $full
  while ($walk) {
    if (Test-Path -LiteralPath $walk) {
      $item = Get-Item -LiteralPath $walk -Force
      if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw ('拒绝链接或目录联接：' + $walk) }
    }
    if ($walk -eq [IO.Path]::GetPathRoot($full)) { break }
    $walk = [IO.Path]::GetDirectoryName($walk)
  }
  return $full
}
function Join-Safe([string]$Root,[string]$Leaf) {
  if ($Leaf -notmatch '^[\p{L}\p{N}._ -]+$' -or $Leaf -eq '.' -or $Leaf -eq '..' -or $Leaf -match '^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)') { throw '补丁文件名称无效。' }
  $joined = Get-SafePath ([IO.Path]::Combine($Root,$Leaf))
  if ([IO.Path]::GetDirectoryName($joined) -ne $Root) { throw '文件路径超出指定目录。' }
  return $joined
}
function Assert-Digest([string]$File,$Expected) {
  [void](Get-SafePath $File)
  if (-not (Test-Path -LiteralPath $File -PathType Leaf) -or $Expected.sha256 -notmatch '^[a-fA-F0-9]{64}$') { throw ('文件或校验信息缺失：' + [IO.Path]::GetFileName($File)) }
  if ((Get-Item -LiteralPath $File).Length -ne [long]$Expected.size) { throw ('文件大小校验失败：' + [IO.Path]::GetFileName($File)) }
  $digest = (Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash
  if ($digest -ne $Expected.sha256) { throw ('文件校验失败，未更新程序：' + [IO.Path]::GetFileName($File)) }
}
function Read-Exactly([IO.Stream]$Stream,[int]$Count) {
  $buffer = New-Object byte[] $Count
  $offset = 0
  while ($offset -lt $Count) {
    $read = $Stream.Read($buffer,$offset,$Count-$offset)
    if ($read -le 0) { throw '程序包文件不完整。' }
    $offset += $read
  }
  return ,$buffer
}
function Read-AsarIdentity([string]$File) {
  [void](Get-SafePath $File)
  $stream = [IO.File]::Open($File,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
  try {
    $first = Read-Exactly $stream 8
    if ([BitConverter]::ToUInt32($first,0) -ne 4) { throw '不是有效的程序包。' }
    $headerSize = [BitConverter]::ToUInt32($first,4)
    if ($headerSize -lt 8 -or $headerSize -gt 33554432 -or $headerSize + 8 -gt $stream.Length) { throw '程序包目录格式无效。' }
    $headerBytes = Read-Exactly $stream ([int]$headerSize)
    $jsonSize = [BitConverter]::ToUInt32($headerBytes,4)
    if ($jsonSize -gt $headerSize - 8) { throw '程序包目录长度无效。' }
    $header = [Text.Encoding]::UTF8.GetString($headerBytes,8,[int]$jsonSize) | ConvertFrom-Json
    $entry = $header.files.PSObject.Properties['package.json'].Value
    if (-not $entry -or $entry.PSObject.Properties['link'] -or ($entry.PSObject.Properties['unpacked'] -and $entry.unpacked)) { throw '程序包身份文件无效。' }
    $size = [long]$entry.size
    $position = [long]8 + [long]$headerSize + [long]$entry.offset
    if ($size -le 0 -or $size -gt 1048576 -or $position -lt 8 + $headerSize -or $position + $size -gt $stream.Length) { throw '程序包身份位置无效。' }
    [void]$stream.Seek($position,[IO.SeekOrigin]::Begin)
    $bytes = Read-Exactly $stream ([int]$size)
    $identity = [Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json
    if ($identity.name -ne 'xjy-jewelry-offline' -or $identity.main -ne 'main.cjs') { throw '所选安装目录不是鑫金源珠宝程序。' }
    return [pscustomobject]@{name=$identity.name;version=$identity.version}
  } finally { $stream.Dispose() }
}
function Assert-PatchableEngine([string]$File) {
  $stream = [IO.File]::OpenRead($File)
  try {
    $first = Read-Exactly $stream 2
    if ($first[0] -ne 77 -or $first[1] -ne 90) { throw '主程序格式无效。' }
    [void]$stream.Seek(0,[IO.SeekOrigin]::Begin)
    $marker = 'dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX'
    $tail = ''; $buffer = New-Object byte[] 1048576; $found = $false
    while (($read=$stream.Read($buffer,0,$buffer.Length)) -gt 0) {
      $text = $tail + [Text.Encoding]::ASCII.GetString($buffer,0,$read)
      $index = $text.IndexOf($marker,[StringComparison]::Ordinal)
      if ($index -ge 0 -and $index + $marker.Length + 7 -le $text.Length) {
        $wire = $index + $marker.Length
        if ([int][char]$text[$wire] -ne 1 -or [int][char]$text[$wire+1] -lt 5 -or $text[$wire+6] -ne '0') { throw '此旧版运行环境不能只替换程序包，请使用兼容的旧版安装。' }
        $found = $true; break
      }
      $tail = $text.Substring([Math]::Max(0,$text.Length-80))
    }
    if (-not $found) { throw '没有找到兼容的运行环境标记，原文件未修改。' }
  } finally { $stream.Dispose() }
}
function Assert-Closed([string]$Exe,[string]$Asar) {
  foreach ($process in @(Get-Process -ErrorAction SilentlyContinue)) {
    $processPath = $null
    try { $processPath = $process.Path } catch { }
    if ($processPath -and [string]::Equals([IO.Path]::GetFullPath($processPath),$Exe,[StringComparison]::OrdinalIgnoreCase)) { throw ('请先在窗口内退出 ' + [IO.Path]::GetFileName($Exe) + '（包括主机和员工窗口），再重新运行补丁。程序不会强制结束进程。') }
  }
  foreach ($file in @($Exe,$Asar)) {
    try { $lease = [IO.File]::Open($file,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None); $lease.Dispose() }
    catch { throw ('程序文件仍被占用或当前账户不能写入，请关闭指定程序后重试：' + [IO.Path]::GetFileName($file)) }
  }
}
function Write-Json([string]$File,$Value) {
  [IO.File]::WriteAllText($File,($Value | ConvertTo-Json -Depth 12),$taskEncoding)
}
function Remember-Target([string]$Root,[string]$Installation,[string]$Backup,[string]$UseRole) {
  try { Write-Json (Join-Safe $Root 'target-state.json') ([pscustomobject]@{machine=[Environment]::MachineName;user=[Environment]::UserName;installDir=$Installation;backupRoot=$Backup;role=$UseRole}) }
  catch { Write-Host '本次安装路径未记忆；下次请按提示输入安装目录。' }
}
function Get-InstalledCandidates($Patch) {
  $possible = New-Object 'System.Collections.Generic.List[string]'
  foreach ($hive in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')) {
    foreach ($key in @(Get-ChildItem -LiteralPath $hive -ErrorAction SilentlyContinue)) {
      try {
        $info = Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction Stop
        $display = $info.PSObject.Properties['DisplayName']
        if (-not $display -or $display.Value -notmatch '鑫金源|xjy.jewelry') { continue }
        $location = $info.PSObject.Properties['InstallLocation']
        if ($location -and -not [string]::IsNullOrWhiteSpace($location.Value)) { $possible.Add([string]$location.Value) }
        $icon = $info.PSObject.Properties['DisplayIcon']
        if ($icon -and $icon.Value -match '^"?(.+\.exe)"?(?:,\s*-?\d+)?$') { $possible.Add([IO.Path]::GetDirectoryName($Matches[1])) }
      } catch { }
    }
  }
  if ($env:LOCALAPPDATA) {
    foreach ($leaf in @('xjy-jewelry-offline','鑫金源珠宝报价','鑫金源珠宝工作室')) { $possible.Add([IO.Path]::Combine($env:LOCALAPPDATA,'Programs',$leaf)) }
  }
  foreach ($disk in @('F','D','E','C')) {
    foreach ($leaf in @('自制软件\xjy-jewelry-offline','软件\xjy-jewelry-offline','xjy-jewelry-offline','鑫金源珠宝报价')) { $possible.Add($disk + ':\' + $leaf) }
  }
  foreach ($programs in @($env:ProgramFiles,[Environment]::GetEnvironmentVariable('ProgramFiles(x86)'))) {
    if ($programs) { foreach ($leaf in @('xjy-jewelry-offline','鑫金源珠宝报价')) { $possible.Add([IO.Path]::Combine($programs,$leaf)) } }
  }
  $seen = @{}
  foreach ($candidate in $possible) {
    try {
      $safe = Get-SafePath $candidate
      if ($seen.ContainsKey($safe) -or -not (Test-Path -LiteralPath $safe -PathType Container)) { continue }
      $seen[$safe] = $true
      $engine = Join-Safe $safe $Patch.app.executable
      $asar = Join-Safe (Get-SafePath ([IO.Path]::Combine($safe,'resources'))) 'app.asar'
      Assert-Digest $engine ([pscustomobject]@{sha256=$Patch.app.engineSha256;size=$Patch.app.engineSize})
      $identity = Read-AsarIdentity $asar
      if ($identity.name -eq $Patch.app.name) { Write-Output $safe }
    } catch { }
  }
}
function Start-Employee([string]$Exe,[string]$Root) {
  Start-Process -FilePath $Exe -ArgumentList '--employee-client' -WorkingDirectory $Root -WindowStyle Hidden
  Write-Host '已打开员工入口；请连接店内主机，并使用主机上的员工账号登录。员工端不会建立本地客户或报价数据库。'
}
function Restore-Atomic([string]$Source,[string]$Target,$Expected) {
  Assert-Digest $Source $Expected
  $directory = Get-SafePath ([IO.Path]::GetDirectoryName($Target))
  $temp = Join-Safe $directory ('app.asar.restore-' + [Guid]::NewGuid().ToString('N') + '.tmp')
  $previousTemp = Join-Safe $directory ('app.asar.previous-' + [Guid]::NewGuid().ToString('N') + '.tmp')
  try {
    [IO.File]::Copy($Source,$temp,$false); Assert-Digest $temp $Expected
    [IO.File]::Replace($temp,$Target,$previousTemp)
    Assert-Digest $Target $Expected
  } finally { foreach ($cleanupFile in @($temp,$previousTemp)) { if (Test-Path -LiteralPath $cleanupFile) { [void](Get-SafePath $cleanupFile); Remove-Item -LiteralPath $cleanupFile -Force } } }
}
try {
  $packageRoot = Get-SafePath $PSScriptRoot
  $manifestPath = Join-Safe $packageRoot 'manifest.json'
  $manifestHashPath = Join-Safe $packageRoot 'manifest.sha256'
  $expectedManifest = [IO.File]::ReadAllText($manifestHashPath).Trim()
  if ($expectedManifest -notmatch '^[a-fA-F0-9]{64}$' -or (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash -ne $expectedManifest) { throw '补丁清单校验失败，请重新解压完整更新包。' }
  $manifest = [IO.File]::ReadAllText($manifestPath,[Text.Encoding]::UTF8) | ConvertFrom-Json
  if ($manifest.schemaVersion -ne 1 -or $manifest.app.name -ne 'xjy-jewelry-offline' -or $manifest.app.executable -ne '鑫金源珠宝报价.exe' -or $manifest.app.targetVersion -notmatch '^\d+\.\d+\.\d+$' -or $manifest.payload.file -ne 'app.asar') { throw '补丁清单不属于此程序。' }
  $seen = @{}
  foreach ($entry in @($manifest.files)) {
    if ($seen.ContainsKey($entry.path)) { throw '补丁清单包含重复文件。' }
    $seen[$entry.path] = $true; Assert-Digest (Join-Safe $packageRoot $entry.path) $entry
  }
  if (-not $seen.ContainsKey('Update-Jewelry.ps1')) { throw '补丁缺少更新脚本的校验信息。' }
  $payload = Join-Safe $packageRoot $manifest.payload.file
  Assert-Digest $payload $manifest.payload
  $newIdentity = Read-AsarIdentity $payload
  if ($newIdentity.version -ne $manifest.app.targetVersion) { throw '新程序包的版本与清单不一致。' }
  $targetState = Join-Safe $packageRoot 'target-state.json'
  $savedTarget = $null
  $startAfterUpdate = $Action -eq 'EmployeeUpdate'
  if ($Action -eq 'Employee' -or $startAfterUpdate) { $Role = 'Employee' }
  if ($startAfterUpdate) { $Action = 'Update' }
  if (Test-Path -LiteralPath $targetState -PathType Leaf) {
    try {
      if ((Get-Item -LiteralPath $targetState).Length -lt 8192) {
        $savedTarget = [IO.File]::ReadAllText($targetState,[Text.Encoding]::UTF8) | ConvertFrom-Json
        if ($savedTarget.machine -eq [Environment]::MachineName -and $savedTarget.user -eq [Environment]::UserName) {
          if (-not $PSBoundParameters.ContainsKey('InstallDir') -and (Test-Path -LiteralPath $savedTarget.installDir -PathType Container)) { $InstallDir = Get-SafePath $savedTarget.installDir }
        } else { $savedTarget = $null }
      }
    } catch { $savedTarget = $null; Write-Host '之前记忆的安装目录无效，将重新核对。' }
  }
  if ([string]::IsNullOrWhiteSpace($InstallDir)) {
    $installed = @(Get-InstalledCandidates $manifest)
    if ($installed.Count -eq 1) { $InstallDir = $installed[0] }
    elseif ($installed.Count -gt 1) {
      Write-Host '找到多个鑫金源安装目录，请选择本次要更新的程序：'
      foreach ($candidate in $installed) { Write-Host ('  ' + $candidate) }
      $InstallDir = Read-Host '请输入其中一个完整安装目录'
    }
    elseif ($startAfterUpdate) {
      if (-not $env:LOCALAPPDATA) { throw '无法找到此用户的本地程序目录。请使用 -InstallDir 指定员工安装目录。' }
      $InstallDir = [IO.Path]::Combine($env:LOCALAPPDATA,'Programs','xjy-jewelry-offline')
    }
    else { $InstallDir = Read-Host '请输入已经安装旧版程序的完整文件夹（不是下载的补丁文件夹）' }
  }
  $installRoot = Get-SafePath $InstallDir
  if ($Role -eq 'Auto') {
    $savedRole = if ($savedTarget) { $savedTarget.PSObject.Properties['role'] } else { $null }
    if ($savedRole -and $savedRole.Value -in @('Host','Employee') -and [string]::Equals($savedTarget.installDir,$installRoot,[StringComparison]::OrdinalIgnoreCase)) { $Role = $savedRole.Value }
    elseif ([string]::Equals($installRoot,'F:\自制软件\xjy-jewelry-offline',[StringComparison]::OrdinalIgnoreCase)) { $Role = 'Host' }
    else { $Role = 'Employee' }
  }
  if ([string]::IsNullOrWhiteSpace($BackupRoot)) {
    $savedRole = if ($savedTarget) { $savedTarget.PSObject.Properties['role'] } else { $null }
    if ($savedRole -and $savedRole.Value -eq $Role -and [string]::Equals($savedTarget.installDir,$installRoot,[StringComparison]::OrdinalIgnoreCase)) { $BackupRoot = $savedTarget.backupRoot }
    elseif ($Role -eq 'Employee') {
      if (-not $env:LOCALAPPDATA) { throw '无法找到员工本地备份目录，请使用 -BackupRoot 指定。' }
      $BackupRoot = [IO.Path]::Combine($env:LOCALAPPDATA,'XJYJewelryClient','程序更新备份')
    }
    else { $BackupRoot = 'F:\鑫金源珠宝资料\程序更新备份' }
  }
  $exe = Get-SafePath ([IO.Path]::Combine($installRoot,$manifest.app.executable))
  if (-not (Test-Path -LiteralPath $exe -PathType Leaf) -and $startAfterUpdate) {
    if (Test-Path -LiteralPath $installRoot) {
      if (-not (Test-Path -LiteralPath $installRoot -PathType Container) -or @(Get-ChildItem -LiteralPath $installRoot -Force).Count -gt 0) { throw '目标目录已有其他文件，请选择空的员工程序安装目录。原文件未修改。' }
    }
    $installerProperty = $manifest.PSObject.Properties['installer']
    if (-not $installerProperty) { throw '新电脑还没有完整运行环境。请先安装原 1.2.0 完整版，再运行员工更新入口。补丁不能独立运行。' }
    $installer = $installerProperty.Value
    $installerPath = Join-Safe $packageRoot $installer.file
    if (-not (Test-Path -LiteralPath $installerPath -PathType Leaf)) { throw ('新电脑请将原 1.2.0 完整安装程序放在本补丁同一文件夹：' + $installer.file + '。已有旧版的员工电脑不需要此安装程序。') }
    Assert-Digest $installerPath $installer
    Write-Host ('正在安装员工运行环境：' + $installRoot + '。不会打开旧版主机窗口。')
    $installation = Start-Process -FilePath $installerPath -ArgumentList @('/S',('/D=' + $installRoot)) -Wait -PassThru -WindowStyle Hidden
    if ($installation.ExitCode -ne 0) { throw ('旧版完整安装程序未成功完成，退出码：' + $installation.ExitCode + '。请核对目录权限后重试。') }
  }
  if (-not (Test-Path -LiteralPath $installRoot -PathType Container)) { throw '旧版安装目录不存在；新电脑请使用“员工安装更新并启动.cmd”，并将原完整安装程序放在补丁旁边。' }
  $resources = Get-SafePath ([IO.Path]::Combine($installRoot,'resources'))
  $live = Join-Safe $resources 'app.asar'
  Assert-Digest $exe ([pscustomobject]@{sha256=$manifest.app.engineSha256;size=$manifest.app.engineSize})
  Assert-PatchableEngine $exe
  foreach ($file in @('chrome_100_percent.pak','chrome_200_percent.pak','resources.pak','icudtl.dat','ffmpeg.dll','snapshot_blob.bin','v8_context_snapshot.bin','version')) { [void](Get-SafePath ([IO.Path]::Combine($installRoot,$file))); if (-not (Test-Path -LiteralPath ([IO.Path]::Combine($installRoot,$file)) -PathType Leaf)) { throw '旧版运行环境不完整，请选择原来的完整安装文件夹。' } }
  $current = Read-AsarIdentity $live
  $currentHash = (Get-FileHash -LiteralPath $live -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($Action -eq 'Employee') {
    if ($current.version -ne $manifest.app.targetVersion -or $currentHash -ne $manifest.payload.sha256) { throw '请先完成程序更新，再使用员工入口。' }
    Remember-Target $packageRoot $installRoot $BackupRoot $Role
    Start-Employee $exe $installRoot
    exit 0
  }
  if ($Action -eq 'Check') {
    Write-Host ('已验证安装目录：' + $installRoot)
    Write-Host ('当前版本：' + $current.version + '；补丁版本：' + $manifest.app.targetVersion)
    Write-Host '仅检查完成，没有修改程序或业务数据。'
    exit 0
  }
  if ($Action -eq 'Update' -and $current.version -eq $manifest.app.targetVersion -and $currentHash -eq $manifest.payload.sha256) {
    Remember-Target $packageRoot $installRoot $BackupRoot $Role
    Write-Host '此电脑已经安装同一补丁，无需重复更新。'
    if ($startAfterUpdate) { Start-Employee $exe $installRoot }
    exit 0
  }
  $source = @($manifest.app.sourcePackages | Where-Object { $_.version -eq $current.version -and $_.sha256 -eq $currentHash -and [long]$_.size -eq (Get-Item -LiteralPath $live).Length })
  if ($Action -eq 'Update' -and $source.Count -ne 1) { throw '旧程序版本或校验值不受此补丁支持，原文件未修改。' }
  Assert-Closed $exe $live
  if ($Role -eq 'Host' -and -not (Test-Path -LiteralPath ([IO.Path]::GetPathRoot($BackupRoot))) -and -not $PSBoundParameters.ContainsKey('BackupRoot')) { throw '主机程序备份默认保存在F盘，请接好F盘。员工电脑请使用员工安装更新入口。' }
  $backupRootPath = Get-SafePath $BackupRoot
  if ($Role -eq 'Host' -and [IO.Path]::GetPathRoot($backupRootPath) -eq 'C:\') { throw '主机请使用F盘或其他非C盘保存程序备份。员工端可使用自己的C盘本地目录。' }
  if ($backupRootPath -eq $resources -or $backupRootPath.StartsWith($resources + '\',[StringComparison]::OrdinalIgnoreCase)) { throw '备份目录不能位于运行中的resources文件夹内。' }
  if ($Action -eq 'Rollback') {
    if (-not (Test-Path -LiteralPath $backupRootPath -PathType Container)) { throw '没有找到程序更新备份。' }
    if ($BackupId) { $backupFolder = Join-Safe $backupRootPath $BackupId }
    else {
      $candidates = @(Get-ChildItem -LiteralPath $backupRootPath -Directory | Where-Object { $_.Name -match '^xjy-\d{8}T\d{6}-[a-f0-9]{32}$' } | Sort-Object Name -Descending)
      $backupFolder = $null
      foreach ($candidate in $candidates) {
        [void](Get-SafePath $candidate.FullName)
        $recordFile = Join-Safe $candidate.FullName 'backup.json'
        if (-not (Test-Path -LiteralPath $recordFile -PathType Leaf)) { continue }
        $candidateInfo = [IO.File]::ReadAllText($recordFile,[Text.Encoding]::UTF8) | ConvertFrom-Json
        if ([string]::Equals($candidateInfo.installDir,$installRoot,[StringComparison]::OrdinalIgnoreCase)) { $backupFolder = $candidate.FullName; break }
      }
      if (-not $backupFolder) { throw '没有找到这个安装目录的程序备份。' }
    }
    [void](Get-SafePath $backupFolder)
    $backup = [IO.File]::ReadAllText((Join-Safe $backupFolder 'backup.json'),[Text.Encoding]::UTF8) | ConvertFrom-Json
    if ($backup.schemaVersion -ne 1 -or $backup.appName -ne $manifest.app.name -or -not [string]::Equals($backup.installDir,$installRoot,[StringComparison]::OrdinalIgnoreCase)) { throw '备份不属于这个安装目录。' }
    $old = Join-Safe $backupFolder 'app.asar'; Assert-Digest $old $backup.original
    $oldIdentity = Read-AsarIdentity $old
    if ($oldIdentity.version -ne $backup.original.version) { throw '备份程序版本不一致。' }
    if ($currentHash -eq $backup.original.sha256) { Write-Host '程序已回退到此备份，无需再次操作。'; exit 0 }
    if ($currentHash -ne $backup.updated.sha256) { throw '当前程序并非这次备份对应的版本，不能覆盖其他更新。' }
    Assert-Closed $exe $live
    Restore-Atomic $old $live $backup.original
    Write-Host ('程序文件已回退到 ' + $oldIdentity.version + '。客户、报价、图片及账号数据未回退或删除。')
    exit 0
  }
  if (-not (Test-Path -LiteralPath $backupRootPath)) { [IO.Directory]::CreateDirectory($backupRootPath) | Out-Null }
  [void](Get-SafePath $backupRootPath)
  $backupName = 'xjy-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmss') + '-' + [Guid]::NewGuid().ToString('N')
  $backupFolder = Join-Safe $backupRootPath $backupName
  [IO.Directory]::CreateDirectory($backupFolder) | Out-Null
  [void](Get-SafePath $backupFolder)
  $old = Join-Safe $backupFolder 'app.asar'
  $original = [pscustomobject]@{version=$current.version;sha256=$currentHash;size=(Get-Item -LiteralPath $live).Length}
  [IO.File]::Copy($live,$old,$false); Assert-Digest $old $original
  Write-Json (Join-Safe $backupFolder 'backup.json') ([pscustomobject]@{schemaVersion=1;appName=$manifest.app.name;installDir=$installRoot;role=$Role;createdUtc=[DateTime]::UtcNow.ToString('o');original=$original;updated=$manifest.payload})
  $temp = Join-Safe $resources ('app.asar.stage-' + [Guid]::NewGuid().ToString('N') + '.tmp')
  $previousTemp = Join-Safe $resources ('app.asar.previous-' + [Guid]::NewGuid().ToString('N') + '.tmp')
  $replacementCommitted = $false
  try {
    [IO.File]::Copy($payload,$temp,$false); Assert-Digest $temp $manifest.payload
    Assert-Closed $exe $live
    [void](Get-SafePath $live)
    [IO.File]::Replace($temp,$live,$previousTemp)
    $replacementCommitted = $true
    Assert-Digest $live $manifest.payload
    Remember-Target $packageRoot $installRoot $backupRootPath $Role
    Write-Host ('已更新到 ' + $manifest.app.targetVersion + '。')
    Write-Host ('旧程序备份：' + $backupFolder)
    Write-Host '主机仍从原来的桌面入口打开；员工从“员工连接主机.cmd”打开。客户、报价和主机业务数据未修改。'
  } catch {
    $failure = $_.Exception.Message
    if ($replacementCommitted) {
      try { Restore-Atomic $old $live $original; throw ('更新未完成，旧程序已恢复：' + $failure) }
      catch { if ((Get-FileHash -LiteralPath $live -Algorithm SHA256).Hash -eq $currentHash) { throw ('更新未完成，旧程序已恢复：' + $failure) }; throw ('无法确认程序恢复状态，请保留备份并运行 Rollback.cmd。备份位置：' + $backupFolder) }
    }
    throw $failure
  } finally { foreach ($cleanupFile in @($temp,$previousTemp)) { if (Test-Path -LiteralPath $cleanupFile) { [void](Get-SafePath $cleanupFile); Remove-Item -LiteralPath $cleanupFile -Force } } }
  if ($startAfterUpdate) { Start-Employee $exe $installRoot }
} catch {
  Write-Host ('操作未完成：' + $_.Exception.Message) -ForegroundColor Red
  Write-Host '未删除或修改客户、报价、账号、图片等业务数据。'
  exit 1
}

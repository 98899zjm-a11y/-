#requires -Version 5.1
<#
  01-seed.ps1  --  Windows Sandbox guest side, step 1 of the 1.7.0 power-loss recovery drill.

  What it does (Mode=Fresh, first boot):
    1. preflight   : result mapping, seed trees, no stray F:
    2. vhd         : create C:\XjyResults\XjyF.vhdx (expandable) + attach + partition + NTFS + F:
    3. acl         : icacls C:\ /remove:g *S-1-5-11 (as specified) and harden F:\
    4. seed-program: robocopy <seedclean> -> F:\<soft>\xjy-jewelry-offline  (1.6.2 / engine 44.7.0)
    5. seed-data   : robocopy C:\XjySeedData -> F:\<data>                   (business data root)
    6. acl-again   : recursive de-authentication + explicit file level grants
    7. uninstall   : HKLM+HKCU Uninstall key for 1.6.2 (MakeUninstallKey.ps1 style)
    8. stage-pkg   : robocopy C:\XjyPackage -> F:\XjyLocal  (delivery must NOT run from a reparse mapping)
    9. report      : C:\XjyResults\seed-result.json

  Mode=Attach (second boot, after the power cut):
    re-attach the same VHD as F: (the VHD lives on the host-mapped C:\XjyResults so it survives
    `wsb stop`), then verify the seeded tree is still intact. No formatting, no copying.

  Contract:
    * pure ASCII source. Chinese path literals are built from Unicode code points.
    * no production path is touched: everything happens on the F: VHD created inside the sandbox,
      plus the host-mapped C:\XjyResults directory.
    * marker lines for the host side: "SEED-OK" or "SEED-FAIL <reason>".

  Result file: C:\XjyResults\seed-result.json
  Log file   : C:\XjyResults\seed.log
#>

[CmdletBinding()]
param(
  [ValidateSet('Fresh', 'Attach')] [string] $Mode = 'Fresh',
  [string] $VhdPath       = 'C:\XjyResults\XjyF.vhdx',
  [int]    $DiskMB        = 10240,
  [string] $ResultDir     = 'C:\XjyResults',
  [string] $SeedProgram   = 'C:\XjyResults\seedclean',
  [string] $SeedData      = 'C:\XjySeedData',
  [string] $PackageSource = 'C:\XjyPackage',
  [switch] $Reset,
  [switch] $SkipPackageStage
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# ---------------------------------------------------------------------------------------------
# ascii helpers
# ---------------------------------------------------------------------------------------------
$script:Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$script:Steps     = New-Object System.Collections.ArrayList
$script:LogPath   = Join-Path $ResultDir 'seed.log'
$script:FailText  = ''

function New-Text {
  param([int[]] $CodePoints)
  $sb = New-Object System.Text.StringBuilder
  foreach ($cp in $CodePoints) { [void] $sb.Append([char] $cp) }
  return $sb.ToString()
}

function Log {
  param([string] $Message)
  $line = ('{0:yyyy-MM-ddTHH:mm:ss.fffZ} {1}' -f [DateTime]::UtcNow, $Message)
  try { [System.IO.File]::AppendAllText($script:LogPath, $line + "`r`n", $script:Utf8NoBom) } catch { }
  Write-Output $line
}

function Add-Step {
  param([string] $Name, [string] $State, [string] $Detail)
  [void] $script:Steps.Add([pscustomobject]@{ name = $Name; state = $State; detail = $Detail })
  Log ('step ' + $Name + ' => ' + $State + ' :: ' + $Detail)
}

function Assert-True {
  param([bool] $Condition, [string] $Message)
  if (-not $Condition) { throw $Message }
}

function Write-JsonFile {
  param([string] $Path, [object] $Value)
  $json = $Value | ConvertTo-Json -Depth 10
  [System.IO.File]::WriteAllText($Path, $json + "`r`n", $script:Utf8NoBom)
}

function Get-TreeCounts {
  param([string] $Path)
  if (-not (Test-Path -LiteralPath $Path)) {
    return [pscustomobject]@{ exists = $false; files = 0; bytes = [int64] 0 }
  }
  $files = 0
  $bytes = [int64] 0
  foreach ($f in [System.IO.Directory]::EnumerateFiles($Path, '*', [System.IO.SearchOption]::AllDirectories)) {
    $files = $files + 1
    $bytes = $bytes + (New-Object System.IO.FileInfo $f).Length
  }
  return [pscustomobject]@{ exists = $true; files = $files; bytes = $bytes }
}

function Join-Native {
  param([string] $File, [string[]] $Argv)
  $out = & $File @Argv 2>&1 | Out-String
  $code = $LASTEXITCODE
  return [pscustomobject]@{ exitCode = $code; text = $out }
}

# ---------------------------------------------------------------------------------------------
# fixed names (all Chinese built from code points, never from literals)
# ---------------------------------------------------------------------------------------------
$Soft        = New-Text @(0x81EA, 0x5236, 0x8F6F, 0x4EF6)                         # zi zhi ruan jian
$Jewel       = New-Text @(0x946B, 0x91D1, 0x6E90, 0x73E0, 0x5B9D, 0x62A5, 0x4EF7) # xin jin yuan zhu bao bao jia
$DataName    = New-Text @(0x946B, 0x91D1, 0x6E90, 0x73E0, 0x5B9D, 0x8D44, 0x6599) # xin jin yuan zhu bao zi liao
$TrustedDir  = New-Text @(0x53D7, 0x4FE1, 0x52A9, 0x624B)                         # shou xin zhu shou
$InstallAsm  = New-Text @(0x5B89, 0x88C5, 0x7EC4, 0x4EF6)                         # an zhuang zu jian

$InstallName   = 'xjy-jewelry-offline'
$InstallParent = 'F:\' + $Soft
$InstallRoot   = $InstallParent + '\' + $InstallName
$DataRoot      = 'F:\' + $DataName
$ExePath       = $InstallRoot + '\' + $Jewel + '.exe'
$MarkerPath    = $InstallRoot + '\xjy-install-activation.json'
$VersionPath   = $InstallRoot + '\version'
$LocalPackage  = 'F:\XjyLocal'
$StateDir      = $InstallParent + '\.' + $InstallName + '.xjy-engine-state'

# ---------------------------------------------------------------------------------------------
# helper functions that talk to the OS
# ---------------------------------------------------------------------------------------------
function Test-VhdPathSafe {
  param([string] $Path)
  $full = [System.IO.Path]::GetFullPath($Path)
  if ($full -notlike 'C:\XjyResults\*.vhdx') {
    throw ('vhd must live under C:\XjyResults (host mapped) so it survives "wsb stop": ' + $full)
  }
  return $full
}

function Invoke-Diskpart {
  param([string] $Name, [string] $Script)
  $file = Join-Path $env:TEMP ('xjy-diskpart-' + $Name + '.txt')
  [System.IO.File]::WriteAllText($file, ($Script -replace "`r`n", "`n") + "`n", [System.Text.Encoding]::ASCII)
  Log ('diskpart script ' + $file + ': ' + ($Script -replace "(`r)?`n", ' | '))
  $r = Join-Native 'diskpart.exe' @('/s', $file)
  Add-Step ('diskpart-' + $Name) 'run' ('exit=' + $r.exitCode)
  if ($r.text) { Log ('diskpart output: ' + ($r.text -replace "(`r)?`n", ' / ')) }
  return $r
}

function Wait-Drive {
  param([string] $Letter, [int] $TimeoutSeconds = 40)
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-Path -LiteralPath ($Letter + ':\')) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

function Get-VolumeName {
  param([string] $Letter)
  try {
    $disk = Get-CimInstance -ClassName Win32_LogicalDisk -Filter ("DeviceID='" + $Letter + ":'") -ErrorAction Stop
    if ($null -ne $disk) { return [string] $disk.VolumeName }
  } catch { }
  try {
    $vol = Get-Volume -DriveLetter $Letter -ErrorAction Stop
    if ($null -ne $vol) { return [string] $vol.FileSystemLabel }
  } catch { }
  return ''
}

function Invoke-Robocopy {
  param([string] $Source, [string] $Target, [string] $Label)
  $argv = @($Source, $Target, '/E', '/COPY:DAT', '/DCOPY:T', '/R:2', '/W:2', '/NFL', '/NDL', '/NP', '/NJH', '/NJS')
  $r = Join-Native 'robocopy.exe' $argv
  Add-Step ('robocopy-' + $Label) 'run' ('exit=' + $r.exitCode + ' ' + $Source + ' -> ' + $Target)
  if ($r.exitCode -gt 7) {
    Log ('robocopy output: ' + ($r.text -replace "(`r)?`n", ' / '))
    throw ('robocopy failed for ' + $Label + ' (exit ' + $r.exitCode + ')')
  }
  return $r
}

function Remove-AuthenticatedUsers {
  param([string] $Root, [string] $Label, [switch] $Recurse)
  $argv = @($Root, '/remove:g', '*S-1-5-11')
  if ($Recurse) { $argv = $argv + @('/T', '/C', '/Q') }
  $r = Join-Native 'icacls.exe' $argv
  Add-Step ('acl-deauth-' + $Label) 'run' ('exit=' + $r.exitCode)
  if ($r.exitCode -ne 0) { Log ('icacls deauth ' + $Label + ' exit ' + $r.exitCode + ' (benign when the SID is absent): ' + ($r.text -replace "(`r)?`n", ' / ')) }
}

function Assert-NoAuthenticatedUsers {
  param([string] $Root, [string] $Label)
  $r = Join-Native 'icacls.exe' @($Root)
  $bad = ($r.text -match 'S-1-5-11|NT AUTHORITY\\Authenticated Users|Authenticated Users')
  Add-Step ('acl-check-' + $Label) ($(if ($bad) { 'fail' } else { 'ok' })) 'authenticated-users-present=' + $bad
  return (-not $bad)
}

function Set-HardAcl {
  param([string] $Root, [string] $Label)
  $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $grantOi = '*S-1-5-18:(OI)(CI)F'
  $grantAd = '*S-1-5-32-544:(OI)(CI)F'
  $grantMe = '*' + $sid + ':(OI)(CI)F'
  $r1 = Join-Native 'icacls.exe' @($Root, '/inheritance:r', '/grant:r', $grantOi, $grantAd, $grantMe, '/T', '/C', '/Q')
  Add-Step ('acl-inherit-' + $Label) 'run' ('exit=' + $r1.exitCode + ' sid=' + $sid)
  if ($r1.exitCode -ne 0) { throw ('icacls inheritance/grant failed on ' + $Root + ' (exit ' + $r1.exitCode + '): ' + ($r1.text -replace "(`r)?`n", ' / ')) }
  # second pass: files inherit nothing, so every file needs an explicit F as well
  $r2 = Join-Native 'icacls.exe' @($Root, '/grant:r', '*S-1-5-18:F', '*S-1-5-32-544:F', ('*' + $sid + ':F'), '/T', '/C', '/Q')
  Add-Step ('acl-explicit-' + $Label) 'run' ('exit=' + $r2.exitCode)
  if ($r2.exitCode -ne 0) { throw ('icacls explicit grant failed on ' + $Root + ' (exit ' + $r2.exitCode + '): ' + ($r2.text -replace "(`r)?`n", ' / ')) }
}

function Set-UninstallKey {
  param([string] $Hive)
  $key = $Hive + '\Software\Microsoft\Windows\CurrentVersion\Uninstall\xjy-jewelry-offline'
  New-Item -Path $key -Force | Out-Null
  Set-ItemProperty -Path $key -Name DisplayName     -Value 'xjy-jewelry-offline host'
  Set-ItemProperty -Path $key -Name Publisher       -Value 'xjy-jewelry'
  Set-ItemProperty -Path $key -Name DisplayVersion  -Value '1.6.2'
  Set-ItemProperty -Path $key -Name InstallLocation -Value $InstallRoot
  Set-ItemProperty -Path $key -Name DisplayIcon     -Value $ExePath
  return $key
}

# ---------------------------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------------------------
$script:CreatedVhd = $false
$script:Result = [ordered]@{
  schema        = 'xjy-recovery-drill-seed/1'
  mode          = $Mode
  startedAtUtc  = [DateTime]::UtcNow.ToString('o')
  host          = $env:COMPUTERNAME
  user          = $env:USERNAME
  paths         = [ordered]@{
    vhd = $VhdPath; installParent = $InstallParent; installRoot = $InstallRoot
    dataRoot = $DataRoot; marker = $MarkerPath; version = $VersionPath
    stateDir = $StateDir; localPackage = $LocalPackage
  }
  steps         = $null
  counts        = $null
  registry      = $null
  marker        = $null
  version       = $null
  finishedAtUtc = $null
  ok            = $false
  error         = $null
}

try {
  if (-not (Test-Path -LiteralPath $ResultDir)) { throw ('result mapping missing: ' + $ResultDir) }
  $VhdPath = Test-VhdPathSafe $VhdPath
  Log ('01-seed start mode=' + $Mode + ' user=' + $env:USERNAME + ' host=' + $env:COMPUTERNAME)

  # ---- preflight ---------------------------------------------------------------------------
  $fBefore = Get-CimInstance -ClassName Win32_LogicalDisk -Filter "DeviceID='F:'" -ErrorAction SilentlyContinue
  if ($Mode -eq 'Fresh' -and $null -ne $fBefore) {
    throw 'F: already exists in this session; use -Mode Attach for an existing VHD, or stop the sandbox and retry'
  }
  if ($Mode -eq 'Fresh' -and -not (Test-Path -LiteralPath $SeedProgram)) {
    if (Test-Path -LiteralPath 'C:\XjySeedRoot') {
      $SeedProgram = 'C:\XjySeedRoot'
      Log ('seed program fallback -> ' + $SeedProgram)
    } else {
      throw ('seed program tree missing: ' + $SeedProgram + ' (expected C:\XjyResults\seedclean or C:\XjySeedRoot)')
    }
  }
  Add-Step 'preflight' 'ok' ('vhd=' + $VhdPath + ' diskMB=' + $DiskMB + ' reset=' + [bool] $Reset)

  # sandbox system volume: drop Authenticated Users, exactly like the established bootstrap does.
  # Non recursive and best effort: an already clean C:\ legitimately returns a non zero exit code.
  Remove-AuthenticatedUsers 'C:\' 'system-root'

  # ---- vhd --------------------------------------------------------------------------------
  if ($Mode -eq 'Fresh') {
    if (Test-Path -LiteralPath $VhdPath) {
      if (-not $Reset) { throw ('vhd already exists: ' + $VhdPath + ' -- pass -Reset to rebuild the sandbox disk') }
      Log 'reset requested: detaching and deleting the previous sandbox vhd'
      Invoke-Diskpart 'detach-old' ('select vdisk file="' + $VhdPath + '"' + "`n" + 'detach vdisk') | Out-Null
      Start-Sleep -Seconds 1
      Remove-Item -LiteralPath $VhdPath -Force
      Add-Step 'reset' 'ok' ('removed ' + $VhdPath)
    }
    $create = @(
      ('create vdisk file="' + $VhdPath + '" maximum=' + $DiskMB + ' type=expandable'),
      ('select vdisk file="' + $VhdPath + '"'),
      'attach vdisk',
      'create partition primary',
      'format fs=ntfs quick label=XJYF',
      'assign letter=F'
    ) -join "`n"
    Invoke-Diskpart 'create' $create | Out-Null
    $script:CreatedVhd = $true
    if (-not (Wait-Drive 'F' 60)) { throw 'F: did not appear after diskpart create/attach' }
    $label = Get-VolumeName 'F'
    Add-Step 'vhd' 'ok' ('label=' + $label + ' size=' + $DiskMB + 'MB')
    if ($label -ne 'XJYF') { Log ('warning: unexpected volume label "' + $label + '"') }
    # a freshly formatted volume carries the default Authenticated Users ACE
    Remove-AuthenticatedUsers 'F:\' 'root-before-copy' -Recurse
    Set-HardAcl 'F:\' 'root-before-copy'
  }
  else {
    if (-not (Test-Path -LiteralPath $VhdPath)) { throw ('vhd missing, nothing to attach: ' + $VhdPath) }
    # F: is only usable when it is really our volume: another session (or Windows itself) may have
    # attached the VHD under a different letter, so detach first and re-attach on F: explicitly.
    $fReady = (Wait-Drive 'F' 2) -and (Test-Path -LiteralPath $VersionPath)
    if (-not $fReady) {
      $detach = @(
        ('select vdisk file="' + $VhdPath + '"'),
        'detach vdisk'
      ) -join "`n"
      Invoke-Diskpart 'detach' $detach | Out-Null
      Start-Sleep -Seconds 1
      $attach = @(
        ('select vdisk file="' + $VhdPath + '"'),
        'attach vdisk',
        'select partition 1',
        'assign letter=F'
      ) -join "`n"
      Invoke-Diskpart 'attach' $attach | Out-Null
      if (-not (Wait-Drive 'F' 60)) { throw 'F: did not appear after diskpart attach' }
    }
    $label = Get-VolumeName 'F'
    Add-Step 'vhd' 'ok' ('attached label=' + $label)
    if (-not (Test-Path -LiteralPath $InstallRoot)) { throw ('attached volume does not contain the seeded install root: ' + $InstallRoot) }
    if (-not (Test-Path -LiteralPath $VersionPath)) { throw ('attached volume does not contain the seeded version file: ' + $VersionPath) }
  }

  # ---- seed program + data ----------------------------------------------------------------
  if ($Mode -eq 'Fresh') {
    if (-not (Test-Path -LiteralPath $InstallParent)) { New-Item -ItemType Directory -Path $InstallParent -Force | Out-Null }
    if (-not (Test-Path -LiteralPath $DataRoot))      { New-Item -ItemType Directory -Path $DataRoot      -Force | Out-Null }
    $srcProgram = Get-TreeCounts $SeedProgram
    Add-Step 'source-program' 'ok' ('files=' + $srcProgram.files + ' bytes=' + $srcProgram.bytes)
    Invoke-Robocopy $SeedProgram $InstallRoot 'program' | Out-Null
    $dstProgram = Get-TreeCounts $InstallRoot
    Add-Step 'seed-program' ($(if ($dstProgram.files -eq $srcProgram.files -and $dstProgram.bytes -eq $srcProgram.bytes) { 'ok' } else { 'fail' })) ('files=' + $dstProgram.files + ' bytes=' + $dstProgram.bytes + ' expected files=' + $srcProgram.files + ' bytes=' + $srcProgram.bytes)
    if ($dstProgram.files -ne $srcProgram.files -or $dstProgram.bytes -ne $srcProgram.bytes) { throw 'seeded program tree does not match its source' }

    Assert-True (Test-Path -LiteralPath $SeedData) ('seed data tree missing: ' + $SeedData)
    $srcData = Get-TreeCounts $SeedData
    Add-Step 'source-data' 'ok' ('files=' + $srcData.files + ' bytes=' + $srcData.bytes)
    Invoke-Robocopy $SeedData $DataRoot 'data' | Out-Null
    $dstData = Get-TreeCounts $DataRoot
    Add-Step 'seed-data' ($(if ($dstData.files -eq $srcData.files -and $dstData.bytes -eq $srcData.bytes) { 'ok' } else { 'fail' })) ('files=' + $dstData.files + ' bytes=' + $dstData.bytes + ' expected files=' + $srcData.files + ' bytes=' + $srcData.bytes)
    if ($dstData.files -ne $srcData.files -or $dstData.bytes -ne $srcData.bytes) { throw 'seeded data tree does not match its source' }
  }
  else {
    $dstProgram = Get-TreeCounts $InstallRoot
    $dstData = Get-TreeCounts $DataRoot
    Add-Step 'attach-counts' 'ok' ('program files=' + $dstProgram.files + ' bytes=' + $dstProgram.bytes + ' ; data files=' + $dstData.files + ' bytes=' + $dstData.bytes)
  }

  # ---- baseline identity ------------------------------------------------------------------
  $markerText = ''
  if (Test-Path -LiteralPath $MarkerPath) { $markerText = [System.IO.File]::ReadAllText($MarkerPath, $script:Utf8NoBom).Trim() }
  $versionText = ''
  if (Test-Path -LiteralPath $VersionPath) { $versionText = [System.IO.File]::ReadAllText($VersionPath, $script:Utf8NoBom).Trim() }
  $marker = $null
  try { if ($markerText) { $marker = $markerText | ConvertFrom-Json } } catch { }
  Add-Step 'baseline' 'ok' ('version=' + $versionText + ' marker=' + $markerText)
  if ($versionText -ne '44.7.0') { Log ('warning: version file is "' + $versionText + '", the 1.6.2 baseline is expected to read 44.7.0') }
  if ($null -eq $marker -or [string] $marker.programVersion -ne '1.6.2') { Log 'warning: activation marker does not report programVersion 1.6.2' }
  if (-not (Test-Path -LiteralPath $ExePath)) { Log ('warning: program exe missing: ' + $ExePath) }

  # ---- acl again (a fresh copy creates files that only inherit) ----------------------------
  if ($Mode -eq 'Fresh') {
    Remove-AuthenticatedUsers 'F:\' 'tree' -Recurse
    Set-HardAcl 'F:\' 'tree'
  }
  $aclClean = Assert-NoAuthenticatedUsers $InstallParent 'install-parent'
  if (-not $aclClean) { Log 'warning: Authenticated Users still listed on the install parent' }

  # ---- uninstall key ----------------------------------------------------------------------
  $reg = [ordered]@{ }
  foreach ($hive in @('Registry::HKEY_LOCAL_MACHINE', 'Registry::HKEY_CURRENT_USER')) {
    try { $k = Set-UninstallKey $hive; $reg[$hive] = 'OK:' + $k } catch { $reg[$hive] = 'FAIL:' + $_.Exception.Message; Log ('uninstall key ' + $hive + ' failed: ' + $_.Exception.Message) }
  }
  $regFail = @($reg.Values | Where-Object { $_ -like 'FAIL:*' }).Count -gt 0
  $regText = (@($reg.Keys | ForEach-Object { $_ + '=' + $reg[$_] }) -join ' ; ')
  Add-Step 'uninstall-key' ($(if ($regFail) { 'warn' } else { 'ok' })) $regText

  # ---- stage the delivery package onto the persistent volume -------------------------------
  # Attach mode only stages when the package is not on the volume yet, so a plain re-attach
  # after the power cut stays a pure "verify the seeded disk" step.
  $stageNeeded = $true
  if ($Mode -eq 'Attach' -and (Test-Path -LiteralPath (Join-Path $LocalPackage 'engine-native170-binding.json'))) { $stageNeeded = $false }
  if ($SkipPackageStage) { $stageNeeded = $false }
  if ($stageNeeded) {
    if (Test-Path -LiteralPath (Join-Path $PackageSource 'engine-native170-binding.json')) {
      if (-not (Test-Path -LiteralPath $LocalPackage)) { New-Item -ItemType Directory -Path $LocalPackage -Force | Out-Null }
      Invoke-Robocopy $PackageSource $LocalPackage 'package' | Out-Null
      $binding = Join-Path $LocalPackage 'engine-native170-binding.json'
      $trusted = Join-Path $LocalPackage $TrustedDir
      $asm     = Join-Path $LocalPackage $InstallAsm
      Assert-True (Test-Path -LiteralPath $binding) ('staged package lost its binding file: ' + $binding)
      Assert-True (Test-Path -LiteralPath $trusted) ('staged package lost its trusted helper dir: ' + $trusted)
      Assert-True (Test-Path -LiteralPath $asm)     ('staged package lost its install component dir: ' + $asm)
      $hash = (Get-FileHash -LiteralPath $binding -Algorithm SHA256).Hash.ToLowerInvariant()
      Add-Step 'stage-package' 'ok' ('local=' + $LocalPackage + ' bindingSha256=' + $hash)
      if ($hash -ne 'c9cf3895d692d205149968c8e5c763f163c95e9e0328256550e78a68b1f8acd1') { Log 'warning: binding hash differs from the pinned release value' }
    } else {
      Add-Step 'stage-package' 'skip' ('package mapping not present: ' + $PackageSource)
    }
  }

  if (-not $stageNeeded) { Add-Step 'stage-package' 'skip' ('already on volume or skipped: ' + $LocalPackage) }

  $script:Result.counts = [ordered]@{ install = $dstProgram; data = $dstData }
  $script:Result.marker = $markerText
  $script:Result.version = $versionText
  $script:Result.registry = $reg
  $script:Result.ok = $true
}
catch {
  $script:FailText = $_.Exception.Message
  Add-Step 'fatal' 'fail' $script:FailText
  $script:Result.error = $script:FailText
  $script:Result.ok = $false
}
finally {
  $script:Result.finishedAtUtc = [DateTime]::UtcNow.ToString('o')
  $script:Result.steps = $script:Steps
  try { Write-JsonFile (Join-Path $ResultDir 'seed-result.json') $script:Result } catch { Log ('cannot write seed-result.json: ' + $_.Exception.Message) }
  if ($script:Result.ok) {
    Log 'SEED-OK'
  } else {
    Log ('SEED-FAIL ' + $script:FailText)
  }
}

if (-not $script:Result.ok) { exit 1 }
exit 0

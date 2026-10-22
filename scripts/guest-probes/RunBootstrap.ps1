$ErrorActionPreference = 'Continue'
$R = 'C:\XjyResults'
$soft = [string][char]0x81EA + [char]0x5236 + [char]0x8F6F + [char]0x4EF6
$dataName = [string][char]0x946B + [char]0x91D1 + [char]0x6E90 + [char]0x73E0 + [char]0x5B9D + [char]0x8D44 + [char]0x6599
$install = 'F:\' + $soft + '\xjy-jewelry-offline'
$dataRoot = 'F:\' + $dataName
$steps = @()
function Step($name, $block) {
  $ok = $true; $out = ''
  try { $out = (& $block | Out-String).Trim() } catch { $ok = $false; $out = $_.Exception.Message }
  $script:steps += [ordered]@{ step = $name; ok = $ok; out = $out }
  Write-Output ('[' + $(if ($ok) { 'OK' } else { 'FAIL' }) + '] ' + $name + ' :: ' + $out)
}

$sid = ([Security.Principal.WindowsIdentity]::GetCurrent()).User.Value

Step 'vhd' {
  $mk = 'C:\XjyResults\mkf.txt'
  if (-not (Test-Path 'F:\')) {
    $lines = @(
      'create vdisk file=C:\XjyF.vhdx maximum=8192 type=expandable',
      'select vdisk file=C:\XjyF.vhdx',
      'attach vdisk',
      'create partition primary',
      'format fs=ntfs quick label=XjyF',
      'assign letter=F'
    )
    Set-Content -LiteralPath $mk -Value $lines -Encoding ASCII
    $r = & diskpart /s $mk 2>&1
    ($r | Out-String).Trim()
  } else { 'already' }
}

Step 'acl-c-root' { (& icacls 'C:\' /remove:g '*S-1-5-11' 2>&1 | Out-String).Trim() }
Step 'format-f' { (& cmd /c 'format F: /FS:NTFS /Q /Y /V:XjyF' 2>&1 | Out-String).Trim() }
Step 'mkdir' { & cmd /c "mkdir `"F:\$soft`" 2>nul & mkdir `"$install`" 2>nul & echo MKDONE" }
Step 'acl-f-root' { (& icacls 'F:\' /remove:g '*S-1-5-11' /T /C /Q 2>&1 | Out-String).Trim() }

Step 'seed-install' {
  $r = & robocopy 'C:\XjyResults\seedclean' $install /E /MT:16 /NFL /NDL /NJH /NJS /NP /R:1 /W:1
  'rc=' + $LASTEXITCODE
}

Step 'registry' {
  if (Test-Path 'C:\XjyResults\MakeUninstallKey.ps1') {
    (& powershell -NoProfile -ExecutionPolicy Bypass -File 'C:\XjyResults\MakeUninstallKey.ps1' 2>&1 | Out-String).Trim()
  } else { 'no-script' }
}

Step 'copy-package' {
  $r = & robocopy 'C:\XjyPackage' 'C:\XjyLocal' /E /MT:16 /NFL /NDL /NJH /NJS /NP /R:1 /W:1
  'rc=' + $LASTEXITCODE
}

Step 'acl-local' {
  & icacls 'C:\XjyLocal' /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" "*$($sid):(OI)(CI)F" /T /C /Q | Out-Null
  & icacls 'C:\XjyLocal' /grant:r "*S-1-5-18:F" "*S-1-5-32-544:F" "*$($sid):F" /T /C /Q | Out-Null
  'done'
}

Step 'selfcheck' {
  $a = Get-Acl 'C:\'; $b = Get-Acl 'F:\'; $c = Get-Acl 'C:\XjyLocal'
  $bad = @()
  foreach ($pair in @(@('C:\', $a), @('F:\', $b), @('C:\XjyLocal', $c))) {
    foreach ($rule in $pair[1].Access) {
      $rid = $rule.IdentityReference.Value
      if ($rule.AccessControlType -eq 'Allow' -and $rid -notin @($sid, 'S-1-5-18', 'S-1-5-32-544', 'NT AUTHORITY\SYSTEM', 'BUILTIN\Administrators')) {
        $rights = [string]$rule.FileSystemRights
        if ($rights -match 'Write|Modify|Delete|ChangePermissions|TakeOwnership|FullControl') { $bad += ($pair[0] + ' :: ' + $rid + ' :: ' + $rights) }
      }
    }
  }
  'bad=' + $bad.Count + ' ' + ($bad -join ' | ')
}

Step 'final-list' { (& cmd /c "dir /a /b `"$install`" 2>&1 | Out-String").Trim() }

$summary = [ordered]@{ at = (Get-Date).ToString('o'); sid = $sid; install = $install; dataRoot = $dataRoot; steps = $steps; ok = (($steps | Where-Object { -not $_.ok }) -eq $null) }
$summary | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath 'C:\XjyResults\bootstrap.json' -Encoding UTF8
Write-Output 'BOOTSTRAP-WRITTEN'

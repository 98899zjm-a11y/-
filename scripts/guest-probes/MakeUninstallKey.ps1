$ErrorActionPreference = 'Stop'
$soft = [string]([char]0x81EA) + [string]([char]0x5236) + [string]([char]0x8F6F) + [string]([char]0x4EF6)
$root = 'F:\' + $soft + '\xjy-jewelry-offline'
$exe = $root + '\' + [string]([char]0x946B) + [string]([char]0x91D1) + [string]([char]0x6E90) + [string]([char]0x73E0) + [string]([char]0x5B9D) + [string]([char]0x62A5) + [string]([char]0x4EF7) + '.exe'
$out = [ordered]@{}
$out.root = $root
$out.exeExists = (Test-Path -LiteralPath $exe)
$out.markerExists = (Test-Path -LiteralPath ($root + '\xjy-install-activation.json'))
foreach ($hive in @('Registry::HKEY_LOCAL_MACHINE', 'Registry::HKEY_CURRENT_USER')) {
  $path = $hive + '\Software\Microsoft\Windows\CurrentVersion\Uninstall\xjy-jewelry-offline'
  try {
    New-Item -Path $path -Force | Out-Null
    Set-ItemProperty -Path $path -Name DisplayName -Value 'xjy-jewelry-offline host'
    Set-ItemProperty -Path $path -Name Publisher -Value 'xjy-jewelry'
    Set-ItemProperty -Path $path -Name DisplayVersion -Value '1.6.2'
    Set-ItemProperty -Path $path -Name InstallLocation -Value $root
    Set-ItemProperty -Path $path -Name DisplayIcon -Value $exe
    $out[$hive] = 'OK'
  } catch {
    $out[$hive] = 'FAIL: ' + $_.Exception.Message
  }
}
$out | ConvertTo-Json | Set-Content -LiteralPath 'C:\XjyResults\regkey.json' -Encoding UTF8
Write-Output 'REGKEY-DONE'

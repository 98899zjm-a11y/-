$ErrorActionPreference = 'Continue'
$name = [string][char]0x946B + [char]0x91D1 + [char]0x6E90 + [char]0x73E0 + [char]0x5B9D + [char]0x8D44 + [char]0x6599
$dst = 'F:\' + $name
$src = 'C:\XjySeedData'
$sid = ([Security.Principal.WindowsIdentity]::GetCurrent()).User.Value
$out = @()
if (-not (Test-Path -LiteralPath $dst)) { $null = New-Item -ItemType Directory -Path $dst -Force }
$r = & robocopy $src $dst /E /MT:16 /NFL /NDL /NJH /NJS /NP /R:1 /W:1
$out += 'robocopy rc=' + $LASTEXITCODE
& icacls $dst /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" "*$($sid):(OI)(CI)F" /T /C /Q | Out-Null
& icacls $dst /grant:r "*S-1-5-18:F" "*S-1-5-32-544:F" "*$($sid):F" /T /C /Q | Out-Null
$out += 'acl done'
$files = @(Get-ChildItem -LiteralPath $dst -Recurse -File -Force -ErrorAction SilentlyContinue)
$out += 'files=' + $files.Count + ' bytes=' + (($files | Measure-Object Length -Sum).Sum)
$out -join ' | ' | Set-Content -LiteralPath 'C:\XjyResults\seeddata.log' -Encoding UTF8
Write-Output ($out -join ' | ')

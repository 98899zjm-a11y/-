[CmdletBinding()]
param(
  [string]$OutFile = "$env:USERPROFILE\Desktop\xjy-after-update.json"
)
$ErrorActionPreference = 'Continue'
$res = [ordered]@{ at=(Get-Date).ToString('o'); computer=$env:COMPUTERNAME; user=$env:USERNAME; roots=@(); asarSha256=$null; asarIsR2=$null; ok=$false; notes=@() }
$targets = New-Object System.Collections.ArrayList
# Registry uninstall keys
foreach($k in @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*','HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*')){
  Get-ItemProperty $k -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match 'xjy|鑫金源' } | ForEach-Object {
    $ip = $_.InstallLocation
    if($ip){ $p = $ip.TrimEnd('\'); if(Test-Path -LiteralPath $p){ [void]$targets.Add($p) } }
    if($_.DisplayIcon){ $d = $_.DisplayIcon -replace ',\d+$',''; $dir = Split-Path -Parent $d; if($dir -and (Test-Path -LiteralPath $dir)){ [void]$targets.Add($dir) } }
  }
}
# Common candidates
foreach($p in @("F:\自制软件\xjy-jewelry-offline","D:\自制软件\xjy-jewelry-offline","$env:LOCALAPPDATA\Programs\xjy-jewelry-offline","C:\自制软件\xjy-jewelry-offline")){ if(Test-Path -LiteralPath $p){ [void]$targets.Add($p) } }
$uniq = @($targets | Select-Object -Unique)
foreach($root in $uniq){
  $row = [ordered]@{ root=$root; marker=$null; markerVersion=$null; markerRole=$null; versionFile=$null; asar=$null; asarSha256=$null; exe=$null; exeSize=$null; note=$null }
  $mk = Join-Path $root 'xjy-install-activation.json'
  if(Test-Path -LiteralPath $mk){ try{ $row.marker = [System.IO.File]::ReadAllText($mk).Trim() }catch{} }
  if($row.marker){ try{ $m = $row.marker | ConvertFrom-Json; $row.markerVersion=$m.programVersion; $row.markerRole=$m.role }catch{ $row.note='marker parse failed' } }
  $vf = Join-Path $root 'version'; if(Test-Path -LiteralPath $vf){ try{ $row.versionFile = ([System.IO.File]::ReadAllText($vf)).Trim() }catch{} }
  $exe = Join-Path $root '鑫金源珠宝报价.exe'
  if(-not (Test-Path -LiteralPath $exe)){ $exe = (Get-ChildItem -LiteralPath $root -Filter '*.exe' -ErrorAction SilentlyContinue | Select-Object -First 1).FullName }
  if($exe -and (Test-Path -LiteralPath $exe)){ $row.exe=$exe; $row.exeSize=(Get-Item -LiteralPath $exe).Length }
  $asar = Join-Path $root 'resources\app.asar'
  if(Test-Path -LiteralPath $asar){
    $row.asar = $asar
    try{ $row.asarSha256 = (Get-FileHash -LiteralPath $asar -Algorithm SHA256).Hash.ToLower() }catch{ $row.note = 'ascii hash failed: ' + $_.Exception.Message }
  }
  $res.roots += $row
}
$r2 = '9593b161f7091f5b471ce4918afee480097105b5668abbe154eb60075b1025a4'
$match = @($res.roots | Where-Object { $_.asarSha256 })
if($match.Count -gt 0){ $res.asarSha256 = $match[0].asarSha256; $res.asarIsR2 = ($res.asarSha256 -eq $r2) }
$procs = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match '鑫金源|xjy' })
$res.processes = @($procs | ForEach-Object { [ordered]@{ id=$_.Id; name=$_.ProcessName; start=$_.StartTime.ToString('s') } })
$res.ok = [bool]($res.asarIsR2 -and ($match.Count -gt 0))
$json = $res | ConvertTo-Json -Depth 8
[System.IO.File]::WriteAllText($OutFile, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Output $OutFile

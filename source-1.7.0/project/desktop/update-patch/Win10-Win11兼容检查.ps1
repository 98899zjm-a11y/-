[CmdletBinding()] param([string]$InstallDir='')
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Utility/Microsoft.PowerShell.Utility.psd1') -ErrorAction Stop
if(-not $InstallDir){
 $state=Join-Path $PSScriptRoot 'target-state.json'
 if(Test-Path -LiteralPath $state){$remembered=Get-Content -LiteralPath $state -Encoding UTF8 -Raw|ConvertFrom-Json;if($remembered.machine -eq [Environment]::MachineName -and $remembered.user -eq [Environment]::UserName){$InstallDir=$remembered.installDir}}
}
if(-not $InstallDir){$InstallDir=Read-Host '请输入已安装鑫金源珠宝程序的完整文件夹'}
$root=[IO.Path]::GetFullPath($InstallDir)
$manifestFile=Join-Path $PSScriptRoot 'manifest.json'
$manifestHash=(Get-Content -LiteralPath (Join-Path $PSScriptRoot 'manifest.sha256') -Raw).Trim()
if($manifestHash -notmatch '^[a-fA-F0-9]{64}$' -or (Get-FileHash -LiteralPath $manifestFile -Algorithm SHA256).Hash -ne $manifestHash){throw '补丁清单校验失败，请重新完整解压原补丁'}
$manifest=Get-Content -LiteralPath $manifestFile -Encoding UTF8 -Raw|ConvertFrom-Json
if($manifest.schemaVersion -ne 1 -or $manifest.app.name -ne 'xjy-jewelry-offline' -or $manifest.app.executable -ne '鑫金源珠宝报价.exe' -or $manifest.payload.file -ne 'app.asar'){throw '补丁程序身份不匹配'}
$exe=Join-Path $root $manifest.app.executable
if((Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash -ne $manifest.app.engineSha256 -or (Get-Item -LiteralPath $exe).Length -ne $manifest.app.engineSize){throw '运行环境校验失败，请选择正确安装目录'}
$asar=Join-Path $root 'resources\app.asar'
if((Get-FileHash -LiteralPath $asar -Algorithm SHA256).Hash -ne $manifest.payload.sha256 -or (Get-Item -LiteralPath $asar).Length -ne $manifest.payload.size){throw '请先成功应用本补丁，再运行兼容检查；当前程序版本尚未通过核对'}
$directory=Join-Path ([IO.Path]::GetTempPath()) ('XJY-Compatibility-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $directory|Out-Null
$env:XJY_DATA_DIR=Join-Path $directory 'isolated-business-must-not-exist'
$env:XJY_SELF_CHECK_OUTPUT=Join-Path $directory 'results'
$process=Start-Process -FilePath $exe -ArgumentList @('--employee-client','--self-check','--disable-gpu') -WorkingDirectory $root -PassThru -Wait -WindowStyle Hidden
$os=Get-CimInstance Win32_OperatingSystem|Select-Object Caption,Version,BuildNumber,OSArchitecture
$checkFile=Join-Path $env:XJY_SELF_CHECK_OUTPUT 'startup-check.json'
$startup=if(Test-Path -LiteralPath $checkFile){Get-Content -LiteralPath $checkFile -Encoding UTF8 -Raw|ConvertFrom-Json}else{$null}
$result=[pscustomobject]@{OperatingSystem=$os;ExitCode=$process.ExitCode;Startup=$startup;BusinessDirCreated=(Test-Path -LiteralPath $env:XJY_DATA_DIR);Note='只测试隔离员工入口，不修改门店业务或启动真实打印。此检查不代替Epson驱动及Windows10实机功能验收。'}
$result|ConvertTo-Json -Depth 12|Set-Content -LiteralPath (Join-Path $directory '兼容检查结果.json') -Encoding UTF8
Write-Host ('报告位置：'+$directory)
if($process.ExitCode -eq 0 -and $startup.ok -and -not $result.BusinessDirCreated){Write-Host '离线启动检查通过。'}else{Write-Host '启动检查未通过，请保留此目录报告。';exit 1}

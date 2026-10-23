$ErrorActionPreference = 'Stop'
$stageRoot = Split-Path -Parent $PSScriptRoot
$stagePython = 'C:\Python314\python.exe'
& (Join-Path $PSScriptRoot 'tools/node.exe') (Join-Path $PSScriptRoot 'supervisor.cjs')
if ($LASTEXITCODE -ne 0) { throw '隔离测试服务启动或运行失败，请查看 reports 和 logs；不会回退到正式软件入口。' }

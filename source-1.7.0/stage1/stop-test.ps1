$ErrorActionPreference = 'Stop'
$stageRoot = Split-Path -Parent $PSScriptRoot
$stageTarget = Join-Path $stageRoot 'runtime\stop-request.json'
$stageResolved = [IO.Path]::GetFullPath($stageTarget)
if (-not $stageResolved.StartsWith([IO.Path]::GetFullPath($stageRoot) + '\',[StringComparison]::OrdinalIgnoreCase)) { throw '拒绝越界停止请求' }
$stageCursor = Split-Path -Parent $stageResolved
while ($stageCursor) {
    $stageInfo = Get-Item -LiteralPath $stageCursor -Force
    if ($stageInfo.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw '停止请求目录存在目录联接，已拒绝' }
    $stageParent = Split-Path -Parent $stageCursor
    if ($stageParent -eq $stageCursor) { break }
    $stageCursor = $stageParent
}
$stageIdentity = Get-Content -LiteralPath (Join-Path $stageRoot 'isolation-identity.json') -Raw | ConvertFrom-Json
$stageStopJson = @{namespace=$stageIdentity.namespace; requestedAt=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json
[IO.File]::WriteAllText($stageResolved,$stageStopJson,(New-Object System.Text.UTF8Encoding($false)))
Write-Output '已请求隔离服务停止。此操作不关闭正式 EXE。'

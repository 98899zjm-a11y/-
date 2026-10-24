param([switch]$Open,[switch]$Stop)
$ErrorActionPreference='Stop'
$node='D:/Codex/xjy-agent-sales-media/openclaw-isolated/runtime/node-v24.22.1-win-x64/node.exe'
$entry='D:/Codex/xjy-main-staff-session-20261023/candidate/start-profile-candidate.mjs'
$expected='D702DAA815EABBFF763C7D3808E235CF031CF2CA70211B56847BC72F51E240E5'
if(-not (Test-Path -LiteralPath $node -PathType Leaf)){throw '固定Node运行时缺失，未启动素材候选'}
$hash=(Get-FileHash -LiteralPath $node -Algorithm SHA256).Hash
if($hash -ne $expected){throw '固定Node运行时校验失败，未启动素材候选'}
if($Stop -and $Open){throw '停止与打开不能同时使用'}
if($Stop){& $node $entry --stop}
elseif($Open){& $node $entry --launch --open}
else{& $node $entry --launch}
if($LASTEXITCODE -ne 0){throw ('固定Node动作返回 '+$LASTEXITCODE)}

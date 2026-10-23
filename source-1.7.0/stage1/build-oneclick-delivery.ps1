# Data-free packaging only. Does not execute installer, EXE or business services.
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$root='E:\codex\2026-10-13\work\xjy-web-stage1'
$output=Join-Path $root 'release\initial-1.6.0-一键安装-v8'
$reportPath=Join-Path $root 'reports\oneclick-delivery-build-v8.json'
function Ordinary([string]$Name){$item=Get-Item -LiteralPath $Name -Force;while($item){if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $item.LinkType){throw 'Linked packaging input refused'};if($item.FullName.TrimEnd('\') -eq $root){return};$parent=Split-Path -Parent $item.FullName;if(!$parent -or $parent -eq $item.FullName){throw 'Outside isolated packaging root'};$item=Get-Item -LiteralPath $parent -Force};throw 'Isolated boundary missing'}
function Target([string]$Name){$full=[IO.Path]::GetFullPath($Name);if(!$full.StartsWith($output+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Output escaped new delivery tree'};return $full}
function Directory([string]$Name){[void](Target ($Name+'\.probe'));if(!(Test-Path -LiteralPath $Name)){[void][IO.Directory]::CreateDirectory($Name)};Ordinary $Name}
function Bytes([string]$Name,[byte[]]$Data){$Name=Target $Name;Directory ([IO.Path]::GetDirectoryName($Name));$s=[IO.File]::Open($Name,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None);try{$s.Write($Data,0,$Data.Length);$s.Flush($true)}finally{$s.Dispose()};Ordinary $Name}
function Copy-PinnedFile([string]$Source,[string]$Destination,[string]$Sha,[long]$Size){Ordinary $Source;if((Get-Item -LiteralPath $Source).Length -ne $Size -or (Get-FileHash -LiteralPath $Source -Algorithm SHA256).Hash.ToLowerInvariant() -cne $Sha){throw ('Input changed: '+$Source)};$Destination=Target $Destination;Directory ([IO.Path]::GetDirectoryName($Destination));$i=[IO.File]::Open($Source,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);try{$o=[IO.File]::Open($Destination,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None);try{$i.CopyTo($o,4194304);$o.Flush($true)}finally{$o.Dispose()}}finally{$i.Dispose()};Ordinary $Destination;if((Get-Item -LiteralPath $Destination).Length -ne $Size -or (Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash.ToLowerInvariant() -cne $Sha){throw 'Copy digest mismatch'}}
if((Test-Path -LiteralPath $output) -or (Test-Path -LiteralPath $reportPath)){throw 'Fresh delivery and report required'}
Ordinary (Join-Path $root 'release');[void][IO.Directory]::CreateDirectory($output);Ordinary $output
$m=Get-Content -LiteralPath (Join-Path $root 'reports\root-initial-common-store-v8.json') -Raw -Encoding UTF8|ConvertFrom-Json
if($m.artifactSha256 -cne '8b829f7c46e2e4b45d1553da2a47a876c49b4d7f12c1babfe87c8cc1a7f77bd4' -or $m.treeSha256 -cne 'cc0c24e4b6db62d6dc1c567d0b84d0ccbf80e01f8d2b27d9faa02795fef048e4' -or $m.files.Count -ne 1020){throw 'Known signed candidate identity differs'}
$source=Join-Path $root 'release\initial-1.6.0-安全一键内层-v8'
$payload=Join-Path $output '安装组件\补丁文件'
$allowed=New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
foreach($f in $m.files){if($f.path -match '[\\:\x00-\x1f]' -or $f.path.Split('/') -contains '..' -or !$allowed.Add($f.path)){throw 'Unsafe payload file list'};Copy-PinnedFile (Join-Path $source $f.path.Replace('/','\')) (Join-Path $payload $f.path.Replace('/','\')) $f.sha256 $f.size}
if(@(Get-ChildItem -LiteralPath $payload -Recurse -File -Force).Count -ne 1020){throw 'Payload file count differs'}
$zip=Join-Path $output '安装组件\鑫金源珠宝1.6.0完整升级补丁.zip'
Copy-PinnedFile (Join-Path $root 'release\initial-1.6.0-安全一键内层-v8.zip') $zip $m.artifactSha256 $m.artifactSize
$pins=@();$reviewer=@()
foreach($name in @('Prepare-Initial-Approval.ps1','approval-core.cjs','approval-archive.cjs','approval-io.cjs')){$p=Join-Path $root ('delivery-approval\'+$name);Ordinary $p;$sha=(Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant();if($name -eq 'Prepare-Initial-Approval.ps1' -and $sha -cne '34b9a885f2c5c36fe9aadf21e27d204a3da04294fd70448824b4295b985c92dd'){throw 'Approved guided reviewer source changed'};$relative='安装组件\审定工具\'+$name;Copy-PinnedFile $p (Join-Path $output $relative) $sha (Get-Item -LiteralPath $p).Length;$pins+=@{path=$relative;sha256=$sha};$reviewer+=@{path=$name;sha256=$sha}}
$pins+=@{path='安装组件\鑫金源珠宝1.6.0完整升级补丁.zip';sha256=$m.artifactSha256}
$pins+=@{path='安装组件\补丁文件\delivery-tools\Initial-Full-Upgrade.ps1';sha256='315054577e707ab2c8f7130e981f866aa7511dc534de416f94fa1405a7c60e89'}
$template=Join-Path $root 'delivery-installer\Start-Install.template.ps1';Ordinary $template;$start=[IO.File]::ReadAllText($template,[Text.Encoding]::UTF8)
if([regex]::Matches($start,'__PINNED_REVIEWER_JSON__').Count -ne 1){throw 'One fixed pin slot required'}
$start=$start.Replace('__PINNED_REVIEWER_JSON__',($pins|ConvertTo-Json -Compress))
$utf8=[Text.UTF8Encoding]::new($false);$bom=[byte[]]@(239,187,191)
Bytes (Join-Path $output '安装组件\Start-Install.ps1') ([byte[]]($bom+$utf8.GetBytes($start)))
$cmd=Join-Path $root 'delivery-installer\一键安装.cmd';Ordinary $cmd;Bytes (Join-Path $output '一键安装.cmd') $utf8.GetBytes(([IO.File]::ReadAllText($cmd,[Text.Encoding]::UTF8) -replace '\r?\n',"`r`n"))
$guide=@'
鑫金源珠宝 1.6.0：一键完整升级

只需打开本文件夹中的“一键安装.cmd”。
1. 先保存正在填写的单据，正常关闭旧软件、财务、库管和托盘后台。
2. 双击“一键安装.cmd”，核对现有软件位置，选择“主机”或“员工电脑”。
3. 按窗口确认。程序自动校验、完成首次准备、备份、升级；失败会停止并说明原因。

不用自己建目录、不用填写校验码、不用打开沙盒、不用分别运行组件。
本包适用于已核验的原始 1.5.0 正式版本。来源版本不符会停止，不清空资料。
主机保留原资料目录；员工电脑不需要 F 盘。角色必须明确选择，插 U 盘不会自动成为主机。
核验完成后，原安装器还会再次核对角色；以其“完成／已核验”窗口为准。
保留“安装组件”文件夹，勿只单独转发一个 CMD。

这是电脑版升级；不会自动开通互联网入口或手机远程。
真实打印机的纸张与套打位置仍需现场验收。
首次入口没有 Windows 发布者签名，请只使用本对话直接交付的完整文件；后续资源仍按固定发行公钥验签。
'@
Bytes (Join-Path $output '使用说明.txt') ([byte[]]($bom+$utf8.GetBytes($guide)))
$files=@(Get-ChildItem -LiteralPath $output -Recurse -File -Force|ForEach-Object {Ordinary $_.FullName;[pscustomobject][ordered]@{path=$_.FullName.Substring($output.Length+1).Replace('\','/');size=$_.Length;sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()}})
$report=[ordered]@{purpose='Data-free one-click wrapper around signed Common store and persistent readonly inventory package';at=[DateTime]::UtcNow.ToString('o');directory=$output;fileCount=$files.Count;bytes=($files|Measure-Object -Property size -Sum).Sum;originalPayloadFiles=1020;originalPayloadUnchanged=$true;artifactSha256=$m.artifactSha256;reviewer=$reviewer;launcherTemplateSha256=(Get-FileHash -LiteralPath $template -Algorithm SHA256).Hash.ToLowerInvariant();files=$files;installerExecuted=$false;productionTouched=$false;privateKeysRead=$false;firstTrust='Direct delivery from this conversation; no Authenticode claim'}
$stream=[IO.File]::Open($reportPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None);try{$data=$utf8.GetBytes(($report|ConvertTo-Json -Depth 8));$stream.Write($data,0,$data.Length);$stream.Flush($true)}finally{$stream.Dispose()}
[pscustomobject]@{directory=$output;fileCount=$files.Count;bytes=$report.bytes;report=$reportPath}|ConvertTo-Json -Compress

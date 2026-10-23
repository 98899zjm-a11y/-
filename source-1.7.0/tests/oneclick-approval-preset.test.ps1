# Pure extraction only: never dot-source the reviewer, show GUI, compile native
# guards, access KnownFolders, inspect real ACLs or execute an engine.
param([string]$SourcePath)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if(!$SourcePath){$SourcePath=Join-Path $PSScriptRoot '..\delivery-approval\Prepare-Initial-Approval.ps1'}
$errors=$null;$tokens=$null
$source=[IO.File]::ReadAllText($SourcePath,[Text.Encoding]::UTF8)
$ast=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Reviewer source did not parse.'}
foreach($name in @('Get-OneClickPreset','Assert-OneClickPreset','Get-OneClickWrittenResult')){
 $found=@($ast.FindAll({param($node)$node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name},$true))
 if($found.Count -ne 1){throw ('Missing pure oneclick function: '+$name)}
 if($found[0].Extent.Text -match 'Add-Type|GetFolderPath|Get-Content|ReadAll|Get-Acl|Get-Item|Test-Path|Process|CreateDirectory|File\]::|Environment'){throw ('Oneclick helper must remain data-only: '+$name)}
 . ([ScriptBlock]::Create($found[0].Extent.Text))
}
function Rejects([scriptblock]$Work){$rejected=$false;try{& $Work | Out-Null}catch{$rejected=$true};if(!$rejected){throw 'Untrusted or unwritten oneclick state was accepted.'}}
$tool='C:\Synthetic OneClick\独立准备工具'
$preset=Get-OneClickPreset $tool
$expected=[ordered]@{
 zip='C:\Synthetic OneClick\鑫金源珠宝1.6.0完整升级补丁.zip'
 tree='C:\Synthetic OneClick\补丁文件'
 zipHash='8b829f7c46e2e4b45d1553da2a47a876c49b4d7f12c1babfe87c8cc1a7f77bd4'
 keyHash='6e8b9cadb59aeb53f30d41f4471f70f644f0dfc7376ffb9d8a4c62defb98458c'
 publisher='鑫金源珠宝软件'
}
if(@($preset.Keys).Count -ne $expected.Count){throw 'Preset exposes unexpected override or identity fields.'}
foreach($key in $expected.Keys){if($preset[$key] -cne $expected[$key]){throw ('Fixed preset differs: '+$key)}}
$trailing=Get-OneClickPreset ($tool+'\')
foreach($key in $expected.Keys){if($trailing[$key] -cne $expected[$key]){throw 'Trailing separator changed the delivery root.'}}
Assert-OneClickPreset $preset $expected
$refused=0
foreach($key in $expected.Keys){$changed=@{};foreach($k in $expected.Keys){$changed[$k]=$expected[$k]};$changed[$key]+='-untrusted';Rejects {Assert-OneClickPreset $preset $changed};$refused++}
$record=[pscustomobject]@{artifactSha256=$expected.zipHash;publisherPublicKeySha256=$expected.keyHash;installationDir='C:\Synthetic Installed';osUser='S-1-5-21-123-456-789-1001';role='employee';approvalId='11111111-1111-4111-8111-111111111111';expiresAt='2026-10-16T12:00:00.000Z'}
Rejects {Get-OneClickWrittenResult $record $false}
Rejects {Get-OneClickWrittenResult $record}
Rejects {Get-OneClickWrittenResult $null $true}
$receipt=Get-OneClickWrittenResult $record $true
$json=$receipt|ConvertTo-Json -Compress
if($json -match "`r|`n"){throw 'Machine success must be one JSON line.'}
$decoded=$json|ConvertFrom-Json
$keys=@('purpose','written','artifactSha256','publisherPublicKeySha256','installationDir','osUser','role','approvalId','expiresAt')
if(@($decoded.PSObject.Properties).Count -ne $keys.Count -or @($decoded.PSObject.Properties | Where-Object {$_.Name -cnotin $keys}).Count){throw 'Machine result contract changed.'}
if($decoded.purpose -cne 'xjy-oneclick-approval-written' -or $decoded.written -isnot [bool] -or !$decoded.written){throw 'Machine success purpose or type is invalid.'}
foreach($key in $keys | Where-Object {$_ -notin @('purpose','written')}){if($decoded.$key -cne $record.$key){throw ('Machine result lost reviewed binding: '+$key)}}
[pscustomobject]@{passed=$true;fixedPresetFields=$expected.Count;presetTamperingRejected=$refused;unwrittenSuccessRejected=3;machineReceiptFields=$keys.Count;nativeGuardCompiled=$false;knownFolderOrAclAccess=$false;guiShown=$false;engineExecuted=$false}|ConvertTo-Json -Compress

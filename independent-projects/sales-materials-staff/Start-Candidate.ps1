param([switch]$Open)
$ErrorActionPreference='Stop'
$checkedLauncher='D:\Codex\xjy-main-integration-20261023\sales-materials-staff-integration\Start-StaffMaterials.ps1'
if(-not(Test-Path -LiteralPath $checkedLauncher -PathType Leaf)){throw 'Checked staff candidate launcher not found.'}
& $checkedLauncher -Open:$Open
if(-not $?){exit 1}

# Pure PowerShell behavior tests. Extract only path function definitions; never
# dot-source the GUI, compile its native guard, inspect ACLs, or touch KnownFolders.
param([string]$SourceRelativePath='..\delivery-approval\Prepare-Initial-Approval.ps1',[switch]$PlainOnly)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$sourcePath=Join-Path $PSScriptRoot $SourceRelativePath
$parseErrors=$null;$tokens=$null
$source=[IO.File]::ReadAllText($sourcePath,[Text.Encoding]::UTF8)
$ast=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$parseErrors)
if($parseErrors.Count){throw 'Reviewer source did not parse.'}
$names=@('Plain');if(!$PlainOnly){$names+=@('Pin-Tree','Overlaps')};foreach($name in $names){$function=$ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name},$true);if(@($function).Count -ne 1){throw 'Expected exactly one function.'};. ([ScriptBlock]::Create($function[0].Extent.Text))}
$script:pinnedFiles=New-Object 'Collections.Generic.List[string]'
function Get-Item([string]$LiteralPath,[switch]$Force){$isFile=$LiteralPath -in @('C:\SyntheticPatch\root.txt','C:\SyntheticPatch\delivery-tools\helper.cjs');return [pscustomobject]@{PSIsContainer=(!$isFile);Attributes=$(if($isFile){[IO.FileAttributes]::Normal}else{[IO.FileAttributes]::Directory});LinkType=$null}}
function Pin-Parents([string]$Dir){}
function Pin-File([string]$Name){$script:pinnedFiles.Add($Name)}
function Get-ChildItem([string]$LiteralPath,[switch]$Force){switch -CaseSensitive ($LiteralPath){
 'C:\SyntheticPatch' {return @([pscustomobject]@{FullName='C:\SyntheticPatch\delivery-tools';PSIsContainer=$true},[pscustomobject]@{FullName='C:\SyntheticPatch\root.txt';PSIsContainer=$false})}
 'C:\SyntheticPatch\delivery-tools' {return @([pscustomobject]@{FullName='C:\SyntheticPatch\delivery-tools\helper.cjs';PSIsContainer=$false})}
 default {throw 'Test attempted an unknown enumeration.'}
}}
$cases=@(@('C:\XJY','C:\XJY\payload',$true),@('C:\XJY\payload','C:\XJY',$true),@('C:\XJY','c:\xjy\',$true),@('C:\XJY','C:\XJY-other',$false),@('C:\XJY','D:\XJY',$false))
if((Plain 'C:\alpha\beta' $true) -ne 'C:\alpha\beta'){throw 'Plain directory rejected a normal single-backslash Windows path.'}
if((Plain 'C:\SyntheticPatch\root.txt') -ne 'C:\SyntheticPatch\root.txt'){throw 'Plain file rejected a normal single-backslash Windows path.'}
$aliasRejected=$false;try{[void](Plain 'C:\alpha\..\beta' $true)}catch{$aliasRejected=$true};if(!$aliasRejected){throw 'Plain accepted a dot-dot alias.'}
if($PlainOnly){[pscustomobject]@{passed=$true;plainPathCases=3;source=$SourceRelativePath;nativeGuardCompiled=$false;knownFolderOrAclAccess=$false}|ConvertTo-Json -Compress;exit 0}
foreach($c in $cases){if((Overlaps $c[0] $c[1]) -ne $c[2]){throw ('Overlap boundary failed: '+$c[0]+' / '+$c[1])}}
Pin-Tree 'C:\SyntheticPatch' @('root.txt','delivery-tools/helper.cjs')
if($script:pinnedFiles.Count -ne 2 -or !$script:pinnedFiles.Contains('C:\SyntheticPatch\delivery-tools\helper.cjs') -or !$script:pinnedFiles.Contains('C:\SyntheticPatch\root.txt')){throw 'Real single-backslash paths did not match signed slash paths.'}
$script:pinnedFiles.Clear();$rejected=$false
try{Pin-Tree 'C:\SyntheticPatch' @('root.txt')}catch{$rejected=$true}
if(!$rejected -or $script:pinnedFiles.Count -ne 0){throw 'Unexpected directory was entered or pinned.'}
[pscustomobject]@{passed=$true;plainPathCases=3;overlapCases=$cases.Count;singleBackslashTree=$true;unexpectedDirectoryRefused=$true;nativeGuardCompiled=$false;knownFolderOrAclAccess=$false}|ConvertTo-Json -Compress

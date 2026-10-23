# Pure policy/flow regression. No GUI, native guard, KnownFolder, Get-Acl, ACL
# construction/application or filesystem mutation runs on this machine.
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$p=Join-Path $PSScriptRoot '..\delivery-approval\Prepare-Initial-Approval.ps1';$errors=$null;$tokens=$null
$source=[IO.File]::ReadAllText($p,[Text.Encoding]::UTF8);$ast=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errors);if($errors.Count){throw 'Source parse failed.'}
foreach($name in @('Assert-AclPolicy','Get-FixedApprovalRoot','Fixed-ApprovalDirectory')){$f=$ast.FindAll({param($node)$node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name},$true);if(@($f).Count -ne 1){throw ('Missing security behavior: '+$name)};. ([ScriptBlock]::Create($f[0].Extent.Text))}
$sid='S-1-5-21-123-456-789-1001';$stranger='S-1-5-21-123-456-789-1002'
function Rule([string]$Identity,[Security.AccessControl.FileSystemRights]$Rights,[bool]$InheritOnly=$false){return [pscustomobject]@{sid=$Identity;rights=$Rights;allow=$true;inheritOnly=$InheritOnly}}
function Rejects($Work){$failed=$false;try{& $Work}catch{$failed=$true};if(!$failed){throw 'Expected an ACL policy refusal.'}}
# Current Windows identities and inherited read/execute are allowed.
Assert-AclPolicy $sid @((Rule $stranger ([Security.AccessControl.FileSystemRights]::ReadAndExecute))) $sid $true
# Default drive-root Users CreateDirectories is additive, not replacement authority.
Assert-AclPolicy 'S-1-5-32-544' @((Rule 'S-1-5-32-545' ([Security.AccessControl.FileSystemRights]::CreateDirectories))) $sid $true
# Inherit-only grants do not affect this ancestor; each actual child is checked.
Assert-AclPolicy $sid @((Rule $stranger ([Security.AccessControl.FileSystemRights]::Modify) $true)) $sid $true
foreach($right in @('DeleteSubdirectoriesAndFiles','Delete','ChangePermissions','TakeOwnership')){$r=[Security.AccessControl.FileSystemRights]::$right;Rejects {Assert-AclPolicy $sid @((Rule $stranger $r)) $sid $true}}
Rejects {Assert-AclPolicy $stranger @() $sid $true}
Rejects {Assert-AclPolicy $sid @((Rule $stranger ([Security.AccessControl.FileSystemRights]::Write) $true)) $sid $false}
Assert-AclPolicy $sid @((Rule 'S-1-5-18' ([Security.AccessControl.FileSystemRights]::FullControl)),(Rule 'S-1-5-32-544' ([Security.AccessControl.FileSystemRights]::FullControl))) $sid $false
$script:log=New-Object 'Collections.Generic.List[string]';$script:existing=New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
foreach($dir in @('C:\','C:\ProgramData')){[void]$script:existing.Add($dir)}
function Plain([string]$Name,[bool]$Directory=$false){$script:log.Add('plain|'+$Name);if(!$script:existing.Contains($Name)){throw 'Missing synthetic directory.'};return $Name}
function Pin-Parents([string]$Dir){$script:log.Add('pin|'+$Dir)}
function Assert-ApprovalAcl([string]$Dir,[string]$Sid,[bool]$Ancestor=$false){$script:log.Add('audit|'+$Dir+'|'+$Ancestor);if($script:blockedDirectory -eq $Dir){throw 'Synthetic ACL refusal.'}}
function Test-Path([string]$LiteralPath){return $script:existing.Contains($LiteralPath)}
function New-ApprovalAcl([string]$Sid){$script:log.Add('descriptor');return 'protected-descriptor'}
function Create-ApprovalDirectory([string]$Name,$Acl){if($Acl -ne 'protected-descriptor'){throw 'Creation did not receive its protected descriptor.'};$script:log.Add('atomic-create|'+$Name);[void]$script:existing.Add($Name)}
$script:blockedDirectory=$null
$common='C:\ProgramData';$target='C:\ProgramData\鑫金源珠宝初次升级审定-S-1-5-21-123-456-789-1001';$actual=Fixed-ApprovalDirectory $common $sid
if($actual -ne $target){throw 'Fixed KnownFolder suffix changed.'}
foreach($dir in @($target)){$create=$script:log.IndexOf('atomic-create|'+$dir);$plain=$script:log.IndexOf('plain|'+$dir);$pin=$script:log.IndexOf('pin|'+$dir);$audit=$script:log.IndexOf('audit|'+$dir+'|False');if($create -lt 0 -or $plain -le $create -or $pin -le $plain -or $audit -le $pin){throw ('New-directory atomic-create/plain/pin/audit order regressed: '+$dir+'; '+($script:log -join ', '))}}
if(@($script:log|Where-Object{$_ -like 'atomic-create|*'}).Count -ne 1){throw 'Only one SID-specific approval leaf may be created.'}
foreach($ancestor in @('C:\','C:\ProgramData')){$audit=$script:log.IndexOf('audit|'+$ancestor+'|True');if($audit -lt 0 -or $audit -gt $script:log.IndexOf('atomic-create|'+$target)){throw 'Ancestor was not audited before creation.'}}
$script:log.Clear();[void](Fixed-ApprovalDirectory $common $sid);if(@($script:log|Where-Object{$_ -like 'atomic-create|*' -or $_ -eq 'descriptor'}).Count){throw 'Existing directory ACL was modified.'}
$script:blockedDirectory=$common;$script:log.Clear();Rejects {Fixed-ApprovalDirectory $common $sid};if(@($script:log|Where-Object{$_ -like 'atomic-create|*' -or $_ -eq 'descriptor'}).Count){throw 'Unsafe common ancestor reached directory creation.'}
$script:blockedDirectory=$target;$script:log.Clear();Rejects {Fixed-ApprovalDirectory $common $sid};if(@($script:log|Where-Object{$_ -like 'atomic-create|*' -or $_ -eq 'descriptor'}).Count){throw 'Unsafe existing SID leaf ACL was modified.'}
$script:blockedDirectory=$null
$setAcl=$ast.FindAll({param($node)$node -is [Management.Automation.Language.InvokeMemberExpressionAst] -and $node.Member.Value -eq 'SetAccessControl'},$true);if(@($setAcl).Count){throw 'Path-based post-creation ACL mutation is forbidden.'}
$createFunction=$ast.FindAll({param($node)$node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Create-ApprovalDirectory'},$true);$createCalls=$createFunction[0].FindAll({param($node)$node -is [Management.Automation.Language.InvokeMemberExpressionAst] -and $node.Member.Value -eq 'CreateDirectory'},$true);if(@($createCalls).Count -ne 1 -or $createCalls[0].Arguments.Count -ne 2){throw 'Directory creation must carry its security descriptor atomically.'}
[pscustomobject]@{passed=$true;aclPolicyCases=10;atomicCreationFlow=$true;existingAclUnchanged=$true;pathSetAclAbsent=$true;knownFolderOrAclAccess=$false}|ConvertTo-Json -Compress

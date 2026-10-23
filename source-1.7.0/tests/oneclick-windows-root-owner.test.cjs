'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{spawnSync}=require('node:child_process');
test('only the pinned Windows volume root trusts the fixed OS installer service while unsafe ancestor grants still stop installation',()=>{
 const source=Buffer.from(path.resolve(__dirname,'../delivery-approval/Prepare-Initial-Approval.ps1')).toString('base64');
 const code=`$ErrorActionPreference='Stop';Set-StrictMode -Version Latest;[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${source}'));$e=$null;$t=$null;$a=[Management.Automation.Language.Parser]::ParseInput([IO.File]::ReadAllText($p,[Text.Encoding]::UTF8),[ref]$t,[ref]$e);if($e.Count){throw 'Reviewer parse failed'}
$f=@($a.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Assert-AclPolicy'},$true));if($f.Count -ne 1){throw 'ACL policy absent'};. ([ScriptBlock]::Create($f[0].Extent.Text))
$sid='S-1-5-21-123-456-789-1001';$ti='S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464'
function Rule($who,$rights){[pscustomobject]@{sid=$who;rights=[Security.AccessControl.FileSystemRights]$rights;allow=$true;inheritOnly=$false}}
function Reject($action){$failed=$false;try{& $action}catch{$failed=$true};if(!$failed){throw 'Unsafe owner or grant was accepted'}}
# Observed Host shape: TrustedInstaller owns the system volume; ordinary users
# may create a new directory there, but cannot replace existing children.
$hostRules=@((Rule 'S-1-5-11' 'CreateDirectories'),(Rule 'S-1-5-32-545' 'ReadAndExecute'))
Assert-AclPolicy $ti $hostRules $sid $true $true
Assert-AclPolicy $sid @((Rule $ti 'FullControl')) $sid $true $true
Reject {Assert-AclPolicy $ti $hostRules $sid $true $false}
Reject {Assert-AclPolicy $ti $hostRules $sid $false $true}
Reject {Assert-AclPolicy 'S-1-5-80-1-2-3-4-5' @() $sid $true $true}
Reject {Assert-AclPolicy $sid @((Rule $ti 'FullControl')) $sid $false $true}
foreach($rights in @('DeleteSubdirectoriesAndFiles','Delete','ChangePermissions','TakeOwnership','Modify')){Reject {Assert-AclPolicy $ti @((Rule 'S-1-5-11' $rights)) $sid $true $true}}
$g=@($a.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Test-TrustedWindowsRoot'},$true));if($g.Count -ne 1){throw 'Root recognition helper absent'};. ([ScriptBlock]::Create($g[0].Extent.Text))
if(!(Test-TrustedWindowsRoot 'C:\\' $true) -or !(Test-TrustedWindowsRoot 'c:\\' $true)){throw 'Pinned OS root not recognized'}
foreach($name in @('C:\\Users','C:\\Users\\Synthetic','F:\\','C:\\.','\\\\server\\share')){if(Test-TrustedWindowsRoot $name $true){throw 'Ordinary directory accepted as Windows root'}}
if(Test-TrustedWindowsRoot 'C:\\' $false){throw 'A leaf can never acquire OS-root trust'}
@{passed=$true;trustedRootPositive=2;unsafeOwnerOrGrantRejected=9;rootPathNegative=6;aclChanged=$false;nativeGuardOrGuiExecuted=$false}|ConvertTo-Json -Compress`;
 const r=spawnSync('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,shell:false,timeout:20000});assert.equal(r.status,0,r.stderr);const v=JSON.parse(r.stdout.replace(/^\uFEFF/,''));assert.equal(v.passed,true);assert.equal(v.unsafeOwnerOrGrantRejected,9);assert.equal(v.rootPathNegative,6);assert.equal(v.aclChanged,false);
});

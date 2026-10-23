'use strict';
// Synthetic authority values and one AST-extracted pure function only.
// Never execute the installer, GUI, native guard, engine or database code.
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{spawnSync}=require('node:child_process');
const entry=require('../delivery-tools/initial-patch-entry.cjs');
const positive=['C:\\WINDOWS','c:\\windows','c:\\WiNdOwS'];
const negative=['Z:\\Windows','\\\\server\\Windows','C:/Windows','C:\\Windows.','C:\\Windows ','C:\\Windows:alias','C:\\Windows2','C:\\Nested\\Windows','C:\\Other\\..\\Windows','C:\\Windows\\',null,{}];
const native=windows=>({common:'C:\\ProgramData',local:'C:\\Users\\Synthetic\\AppData\\Local',roaming:'C:\\Users\\Synthetic\\AppData\\Roaming',windows,sid:'S-1-5-21-123-456-789-1001'});

test('native authority accepts only the fixed Windows directory with ordinal case differences',()=>{
 for(const value of positive){
  const actual=entry.initialApprovalAuthorityFromNative(native(value));
  assert.equal(actual.approvalRoot,'C:\\ProgramData\\鑫金源珠宝初次升级审定-S-1-5-21-123-456-789-1001');
  assert.equal(actual.osUser,native(value).sid);assert.equal(actual.local,native(value).local);assert.equal(actual.roaming,native(value).roaming);
 }
});

test('native authority rejects alternate directories, aliases and non-string Windows fields',()=>{
 for(const value of negative)assert.throws(()=>entry.initialApprovalAuthorityFromNative(native(value)),error=>error.code==='BAD_NATIVE_AUTHORITY',JSON.stringify(value));
});

test('PowerShell 5 pure Windows guard accepts case differences and top-level call uses native KnownFolder',()=>{
 const source=Buffer.from(path.resolve(__dirname,'../delivery-installer/Start-Install.template.ps1')).toString('base64');
 const cases=Buffer.from(JSON.stringify({positive,negative})).toString('base64');
 const script=`$ErrorActionPreference='Stop';Set-StrictMode -Version Latest;[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
if($PSVersionTable.PSVersion.Major -ne 5){throw 'This test requires Windows PowerShell 5'}
$sourcePath=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${source}'))
$tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseInput([IO.File]::ReadAllText($sourcePath,[Text.Encoding]::UTF8),[ref]$tokens,[ref]$errors);if($errors.Count){throw 'Installer template parse failed'}
$functions=@($ast.FindAll({param($node)$node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Assert-FixedWindowsDirectory'},$true))
if($functions.Count -ne 1){throw 'Missing pure Assert-FixedWindowsDirectory function'}
$function=$functions[0];$parameters=$function.Parameters;if($null -eq $parameters -and $null -ne $function.Body.ParamBlock){$parameters=$function.Body.ParamBlock.Parameters}
if($null -eq $parameters -or $parameters.Count -ne 1 -or $parameters[0].Name.VariablePath.UserPath -cne 'Value' -or $parameters[0].StaticType -ne [string]){throw 'Expected Assert-FixedWindowsDirectory([string]$Value)'}
$commands=@($function.Body.FindAll({param($node)$node -is [Management.Automation.Language.CommandAst]},$true));if($commands.Count){throw 'Windows guard must be command-free and data-only'}
$types=@($function.Body.FindAll({param($node)$node -is [Management.Automation.Language.TypeExpressionAst]},$true));foreach($type in $types){if($type.TypeName.FullName -notin @('StringComparer','StringComparison','string','System.StringComparer','System.StringComparison','System.String')){throw 'Windows guard must not access native, filesystem or GUI types'}}
if($function.Extent.Text -match '\\$env:|GetFolderPath|GetEnvironmentVariable'){throw 'Pure guard must use only its supplied value'}
$calls=@($ast.FindAll({param($node)
 if($node -isnot [Management.Automation.Language.CommandAst] -or $node.GetCommandName() -cne 'Assert-FixedWindowsDirectory'){return $false}
 $parent=$node.Parent;while($parent){if($parent -is [Management.Automation.Language.FunctionDefinitionAst]){return $false};$parent=$parent.Parent};return $true
},$true))
if($calls.Count -ne 1 -or $calls[0].CommandElements.Count -ne 2){throw 'Top-level installer must call the fixed Windows guard exactly once'}
$argument=($calls[0].CommandElements[1].Extent.Text -replace '\\s','')
if($argument -cne '([Environment]::GetFolderPath([Environment+SpecialFolder]::Windows))'){throw 'Top-level Windows authority must come directly from native KnownFolder without overrides'}
# Load only the verified pure function definition. The template is never dot-sourced.
. ([ScriptBlock]::Create($function.Extent.Text))
$cases=ConvertFrom-Json -InputObject ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${cases}')))
foreach($value in $cases.positive){Assert-FixedWindowsDirectory $value}
foreach($value in $cases.negative){$refused=$false;try{Assert-FixedWindowsDirectory $value}catch{$refused=$true};if(!$refused){throw 'Unsafe Windows directory was accepted'}}
@{passed=$true;positiveCount=$cases.positive.Count;negativeCount=$cases.negative.Count;nativeAuthorityCallVerified=$true;installerOrGuiOrNativeGuardExecuted=$false;businessOrDatabaseExecuted=$false}|ConvertTo-Json -Compress`;
 const result=spawnSync('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,shell:false,timeout:20000});
 assert.equal(result.status,0,result.stderr||result.stdout);
 const proof=JSON.parse(result.stdout.replace(/^\uFEFF/,''));assert.equal(proof.passed,true);assert.equal(proof.positiveCount,positive.length);assert.equal(proof.negativeCount,negative.length);assert.equal(proof.nativeAuthorityCallVerified,true);assert.equal(proof.installerOrGuiOrNativeGuardExecuted,false);assert.equal(proof.businessOrDatabaseExecuted,false);
});

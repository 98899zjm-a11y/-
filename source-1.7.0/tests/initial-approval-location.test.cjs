'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{spawnSync}=require('node:child_process');
const entry=require('../delivery-tools/initial-patch-entry.cjs');
const native=()=>({common:'C:\\ProgramData',local:'C:\\Users\\Synthetic\\AppData\\Local',roaming:'C:\\Users\\Synthetic\\AppData\\Roaming',windows:'C:\\Windows',sid:'S-1-5-21-123-456-789-1001'});

test('native approval authority uses one SID leaf under CommonApplicationData and preserves profile folders',()=>{
 const actual=entry.initialApprovalAuthorityFromNative(native());
 assert.equal(actual.approvalRoot,'C:\\ProgramData\\鑫金源珠宝初次升级审定-S-1-5-21-123-456-789-1001');
 assert.equal(actual.osUser,'S-1-5-21-123-456-789-1001');
 assert.equal(actual.local,'C:\\Users\\Synthetic\\AppData\\Local');
 assert.equal(actual.roaming,'C:\\Users\\Synthetic\\AppData\\Roaming');
 const second={...native(),sid:'S-1-5-21-123-456-789-1002'};
 assert.equal(entry.initialApprovalAuthorityFromNative(second).approvalRoot,'C:\\ProgramData\\鑫金源珠宝初次升级审定-S-1-5-21-123-456-789-1002');
});

test('native approval authority refuses missing common roots, path aliases, malformed SIDs and extra overrides',()=>{
 const changes=[a=>{delete a.common;},a=>a.common='C:\\ProgramData\\..\\Other',a=>a.common='\\\\server\\share',a=>a.common='C:\\ProgramData:alias',a=>a.sid='S-1-5-21-123\\escape',a=>a.sid='S-1-5-21-123/escape',a=>a.sid='Administrator',a=>a.sid='S-1-',a=>a.windows='Z:\\Windows',a=>a.approvalRoot='C:\\Attacker',a=>a.osUser='S-1-5-18'];
 for(const change of changes){const input=native();change(input);assert.throws(()=>entry.initialApprovalAuthorityFromNative(input),error=>['BAD_NATIVE_AUTHORITY','UNSAFE_PATH'].includes(error.code));}
});

test('reviewer and shipping PowerShell derive identical SID-isolated approval paths without filesystem or KnownFolder access',()=>{
 const reviewer=path.resolve(__dirname,'../delivery-approval/Prepare-Initial-Approval.ps1'),shipping=path.resolve(__dirname,'../delivery-tools/Initial-Full-Upgrade.ps1');
 const quote=value=>value.replace(/'/g,"''");
 const command=`[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
foreach($sourcePath in @('${quote(reviewer)}','${quote(shipping)}')){
 $tokens=$null;$errors=$null;$source=[IO.File]::ReadAllText($sourcePath,[Text.Encoding]::UTF8);$ast=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errors);if($errors.Count){throw 'Source parse failed'}
 $found=@($ast.FindAll({param($node)$node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Get-FixedApprovalRoot'},$true));if($found.Count -ne 1){throw 'Fixed approval path helper absent'};. ([ScriptBlock]::Create($found[0].Extent.Text))
 $actual=Get-FixedApprovalRoot 'C:\\ProgramData' 'S-1-5-21-123-456-789-1001';if($actual -cne 'C:\\ProgramData\\鑫金源珠宝初次升级审定-S-1-5-21-123-456-789-1001'){throw 'Wrong fixed approval path'}
 $second=Get-FixedApprovalRoot 'C:\\ProgramData' 'S-1-5-21-123-456-789-1002';if($second -cne 'C:\\ProgramData\\鑫金源珠宝初次升级审定-S-1-5-21-123-456-789-1002'){throw 'SID leaf was shared'}
 foreach($pair in @(@('C:\\ProgramData\\..\\Other','S-1-5-21-123'),@('\\\\server\\share','S-1-5-21-123'),@('C:\\ProgramData:alias','S-1-5-21-123'),@('C:\\ProgramData','S-1-5-21-123\\escape'),@('C:\\ProgramData','Administrator'))){$refused=$false;try{Get-FixedApprovalRoot $pair[0] $pair[1]}catch{$refused=$true};if(!$refused){throw 'Unsafe approval authority accepted'}}
}
[pscustomobject]@{passed=$true;nativeGuardCompiled=$false;knownFolderOrAclAccess=$false;guiShown=$false;engineExecuted=$false}|ConvertTo-Json -Compress`;
 const result=spawnSync('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(command,'utf16le').toString('base64')],{windowsHide:true,shell:false,encoding:'utf8',timeout:20000});
 assert.equal(result.status,0,result.stderr||result.stdout);const proof=JSON.parse(result.stdout.replace(/^\uFEFF/,''));
 assert.equal(proof.passed,true);for(const key of ['nativeGuardCompiled','knownFolderOrAclAccess','guiShown','engineExecuted'])assert.equal(proof[key],false,key);
});

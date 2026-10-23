'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{spawnSync}=require('node:child_process');
const entry=require('../delivery-tools/initial-patch-entry.cjs');
const reviewer=path.resolve(__dirname,'../delivery-approval/Prepare-Repeat-Approval-170.ps1');
function runPowerShell(body){const result=spawnSync('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(body,'utf16le').toString('base64')],{windowsHide:true,shell:false,encoding:'utf8',timeout:20000});assert.equal(result.status,0,result.stderr||result.stdout);return JSON.parse(result.stdout.trim());}

test('170 approval leaf exactly matches the existing repeat authority SID/publication leaf without writing files',()=>{
  const file=reviewer.replace(/'/g,"''"),publication='a'.repeat(64),sid='S-1-5-21-123-456-789-1001';
  const script=`$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$source=[IO.File]::ReadAllText('${file}',[Text.Encoding]::UTF8);$tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errors);if($errors.Count){throw 'Parse failed'};foreach($name in @('Get-FixedApprovalBase','Get-FixedApprovalRoot')){$f=@($ast.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name},$true));if($f.Count -ne 1){throw 'Missing '+$name};. ([ScriptBlock]::Create($f[0].Extent.Text))};$path=Get-FixedApprovalRoot 'C:\\ProgramData' '${sid}' '${publication}';$result=@{path=$path;badPublication=$false;badSid=$false};try{Get-FixedApprovalRoot 'C:\\ProgramData' '${sid}' 'not-a-hash'}catch{$result.badPublication=$true};try{Get-FixedApprovalRoot 'C:\\ProgramData' 'Administrator' '${publication}'}catch{$result.badSid=$true};$result|ConvertTo-Json -Compress`;
  const actual=runPowerShell(script);
  const expected=entry.repeatApprovalAuthorityFromNative({common:'C:\\ProgramData',local:'C:\\Local',roaming:'C:\\Roaming',windows:'C:\\Windows',sid},publication).approvalRoot;
  assert.equal(actual.path,expected);
  assert.equal(actual.badPublication,true);
  assert.equal(actual.badSid,true);
});

test('170 preparer is separate from the old initial reviewer and uses a publication-bound repeat leaf',()=>{
  const source=require('node:fs').readFileSync(reviewer,'utf8'),core=require('node:fs').readFileSync(path.resolve(__dirname,'../delivery-approval/approval-core-170.cjs'),'utf8');
  assert(source.includes('Get-FixedApprovalRoot $common $sid $publicationId'));
  assert(source.includes('publicationId=$PublicationId'));
  assert(!source.includes('鑫金源珠宝初次升级审定-'));
  assert(!source.includes('F:\\自制软件\\xjy-jewelry-offline'));
  assert(core.includes("PURPOSE='xjy-repeat-program-patch'"));
});

test('170 preparer parses under Windows PowerShell 5.1 without executing the reviewer',()=>{
  const file=reviewer.replace(/'/g,"''");
  const script="$s=[IO.File]::ReadAllText('"+file+"',[Text.Encoding]::UTF8);$tokens=$null;$errors=$null;[Management.Automation.Language.Parser]::ParseInput($s,[ref]$tokens,[ref]$errors)|Out-Null;if($errors.Count){$errors|ForEach-Object{[Console]::Error.WriteLine($_.Message)};exit 1};'{\"passed\":true,\"executed\":false}'";
  const r=spawnSync('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,shell:false,encoding:'utf8',timeout:20000});
  assert.equal(r.status,0,r.stderr||r.stdout);assert.deepEqual(JSON.parse(r.stdout.trim()),{passed:true,executed:false});
});

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{spawnSync}=require('node:child_process');
test('one click installation stops on cancellation, incomplete approval and changed identity before starting the shipping installer',()=>{
 const file=Buffer.from(path.resolve(__dirname,'../delivery-installer/Start-Install.template.ps1')).toString('base64');
 const script=`$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$path=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${file}'))
if(!(Test-Path -LiteralPath $path)){throw 'One-click launcher not implemented yet'}
$errors=$null;$tokens=$null;$ast=[Management.Automation.Language.Parser]::ParseInput([IO.File]::ReadAllText($path,[Text.Encoding]::UTF8),[ref]$tokens,[ref]$errors);if($errors.Count){throw 'Launcher parse failed'}
foreach($name in @('Assert-OneClickApprovalReceipt','Invoke-OneClickInstallSequence')){$f=@($ast.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name},$true));if($f.Count -ne 1){throw ('Missing function '+$name)};. ([ScriptBlock]::Create($f[0].Extent.Text))}
$sid='S-1-5-21-123-456-789-1001'
function Receipt{return [pscustomobject]@{purpose='xjy-oneclick-approval-written';written=$true;artifactSha256='8b829f7c46e2e4b45d1553da2a47a876c49b4d7f12c1babfe87c8cc1a7f77bd4';publisherPublicKeySha256='6e8b9cadb59aeb53f30d41f4471f70f644f0dfc7376ffb9d8a4c62defb98458c';installationDir='C:\\Synthetic\\Jewelry';osUser=$sid;role='employee';approvalId='11111111-1111-4111-8111-111111111111';expiresAt=[DateTime]::UtcNow.AddHours(23).ToString('o')}}
Assert-OneClickApprovalReceipt (Receipt) $sid
$changes=@({param($r)$r.written=$false},{param($r)$r.written='true'},{param($r)$r.purpose='other'},{param($r)$r.artifactSha256='0'*64},{param($r)$r.publisherPublicKeySha256='0'*64},{param($r)$r.osUser='S-1-5-18'},{param($r)$r.role='administrator'},{param($r)$r.installationDir='relative'},{param($r)$r.installationDir='C:\\Synthetic\\..\\Other'},{param($r)$r.installationDir='\\\\server\\share'},{param($r)$r.approvalId='invalid'},{param($r)$r.expiresAt=[DateTime]::UtcNow.AddMinutes(-1).ToString('o')},{param($r)$r.expiresAt=[DateTime]::UtcNow.AddDays(3).ToString('o')})
foreach($change in $changes){$r=Receipt;& $change $r;$rejected=$false;try{Assert-OneClickApprovalReceipt $r $sid}catch{$rejected=$true};if(!$rejected){throw 'Unsafe approval receipt accepted'}}
$script:installs=0
$cancel=Invoke-OneClickInstallSequence {return [pscustomobject]@{processExited=$true;exitCode=2;stdout='';stderr=''}} {$script:installs++} $sid
if(!$cancel.cancelled -or $script:installs -ne 0){throw 'Cancellation started installation'}
foreach($bad in @([pscustomobject]@{processExited=$true;exitCode=0;stdout='';stderr=''},[pscustomobject]@{processExited=$true;exitCode=1;stdout='';stderr='Synthetic write failure'},[pscustomobject]@{processExited=$false;exitCode=0;stdout=((Receipt)|ConvertTo-Json -Compress);stderr=''})){$script:bad=$bad;$rejected=$false;try{Invoke-OneClickInstallSequence {$script:bad} {$script:installs++} $sid}catch{$rejected=$true};if(!$rejected -or $script:installs -ne 0){throw 'Unconfirmed approval reached installation'}}
$script:reviewReturned=$false
$good=Invoke-OneClickInstallSequence {$script:reviewReturned=$true;return [pscustomobject]@{processExited=$true;exitCode=0;stdout=((Receipt)|ConvertTo-Json -Compress);stderr=''}} {if(!$script:reviewReturned){throw 'Approval process has not returned'};$script:installs++;return [pscustomobject]@{processExited=$true;exitCode=0;stdout='';stderr=''}} $sid
if($script:installs -ne 1 -or !$good.launcherFinished){throw 'Confirmed approval failed to call one fixed installer'}
@{passed=$true;receiptNegativeCases=$changes.Count;cancelStops=$true;failedOrIncompleteReviewStops=3;installCalls=$script:installs;businessOrGuiExecuted=$false}|ConvertTo-Json -Compress`;
 const r=spawnSync('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,shell:false,timeout:20000});assert.equal(r.status,0,r.stderr);const data=JSON.parse(r.stdout.replace(/^\uFEFF/,''));assert.equal(data.passed,true);assert.equal(data.receiptNegativeCases,13);assert.equal(data.installCalls,1);assert.equal(data.businessOrGuiExecuted,false);
});

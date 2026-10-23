'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{spawnSync}=require('node:child_process');
test('the shipping launcher decodes Chinese Node failures as UTF8 even under a legacy Windows codepage',()=>{
 const expected='升级未完成：请先正常关闭软件；资料不会被替换。',payload=Buffer.from(expected).toString('base64');
 const source=Buffer.from(path.resolve(__dirname,'../delivery-tools/Initial-Full-Upgrade.ps1')).toString('base64'),node=Buffer.from(process.execPath).toString('base64');
 const emit=Buffer.from(`process.stdout.write(Buffer.from('${payload}','base64'));process.stderr.write(Buffer.from('${payload}','base64'));`).toString('base64');
 const script=`[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${source}'))
$tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseInput([IO.File]::ReadAllText($p,[Text.Encoding]::UTF8),[ref]$tokens,[ref]$errors);if($errors.Count){throw 'Invalid launcher source'}
$psi=[Diagnostics.ProcessStartInfo]::new();$psi.UseShellExecute=$false;$psi.CreateNoWindow=$true;$psi.RedirectStandardOutput=$true;$psi.RedirectStandardError=$true
$psi.StandardOutputEncoding=[Text.Encoding]::GetEncoding(936);$psi.StandardErrorEncoding=[Text.Encoding]::GetEncoding(936)
$assignments=@($ast.FindAll({param($a) $a -is [Management.Automation.Language.AssignmentStatementAst] -and $a.Left.Extent.Text -match '^\\$psi\\.Standard(Output|Error)Encoding$'},$true))
foreach($a in $assignments){if($a.Extent.Text -notmatch '^\\$psi\\.Standard(Output|Error)Encoding\\s*=\\s*\\[Text\\.UTF8Encoding\\]::new\\(\\$false\\)$'){throw 'Unexpected codec configuration'};$psi.($a.Left.Member.Value)=[Text.UTF8Encoding]::new($false)}
$psi.FileName=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${node}'));$code=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${emit}'));$psi.Arguments='--eval "'+$code+'"'
$child=[Diagnostics.Process]::Start($psi);$o=$child.StandardOutput.ReadToEndAsync();$e=$child.StandardError.ReadToEndAsync();$child.WaitForExit()
@{exitCode=$child.ExitCode;stdout=$o.Result;stderr=$e.Result;applied=$assignments.Count}|ConvertTo-Json -Compress`;
 // Parse only checked codec declarations. Never run the launcher or business EXE.
 const r=spawnSync('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,shell:false,encoding:'utf8',timeout:20000});
 assert.equal(r.status,0,r.stderr);const data=JSON.parse(r.stdout.replace(/^\uFEFF/,''));assert.equal(data.exitCode,0);assert.equal(data.stdout,expected);assert.equal(data.stderr,expected);assert.equal(data.applied,2);
});

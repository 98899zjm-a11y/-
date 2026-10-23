'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const reviewer=path.resolve(__dirname,'../delivery-approval/Prepare-Initial-Approval.ps1');
test('oneclick presets and written receipt are pure and refuse trust changes or unwritten success',()=>{
 const helper=path.resolve(__dirname,'oneclick-approval-preset.test.ps1');
 // Read the test as UTF8 and extract only data helpers from the reviewer.
 // Neither script is dot-sourced or launched as the production GUI.
 const command=`[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); & ([scriptblock]::Create([IO.File]::ReadAllText('${helper.replace(/'/g,"''")}',[Text.Encoding]::UTF8))) -SourcePath '${reviewer.replace(/'/g,"''")}'`;
 const result=spawnSync('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(command,'utf16le').toString('base64')],{windowsHide:true,shell:false,encoding:'utf8',timeout:20000});
 assert.equal(result.status,0,result.stderr||result.stdout);const proof=JSON.parse(result.stdout.replace(/^\uFEFF/,''));
 assert.equal(proof.passed,true);assert.equal(proof.fixedPresetFields,5);assert.equal(proof.presetTamperingRejected,5);assert.equal(proof.unwrittenSuccessRejected,3);assert.equal(proof.machineReceiptFields,9);
 for(const key of ['nativeGuardCompiled','knownFolderOrAclAccess','guiShown','engineExecuted'])assert.equal(proof[key],false,key);
});
test('oneclick uses a switch without trust overrides and keeps write-before-receipt order',()=>{
 const source=fs.readFileSync(reviewer,'utf8');
 assert.match(source,/param\(\[switch\]\$OneClick\)/);
 assert.match(source,/if\(\$OneClick\)\{exit 2\}/);
 assert.match(source,/Assert-OneClickPreset\s+\$preset/);
 const receipt=source.lastIndexOf('Get-OneClickWrittenResult $result.record $approvalWritten');
 assert(receipt>source.lastIndexOf('$f.Flush($true)'),'Receipt must follow both approval write/flush branches');
 assert(source.indexOf('$approvalWritten=$true')>source.lastIndexOf('$f.Flush($true)'),'Written flag must follow completed writes');
 assert.match(source,/\$psi\.EnvironmentVariables\['SystemDrive'\]='C:'/);
 assert.match(source,/\$psi\.EnvironmentVariables\['PATHEXT'\]='\.EXE'/);
 assert(!/\$psi\.EnvironmentVariables\['NODE_(?:OPTIONS|PATH)'\]/.test(source));
});

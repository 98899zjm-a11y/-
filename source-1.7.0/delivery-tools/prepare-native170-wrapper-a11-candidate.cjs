'use strict';
// Source preparation only. Does not execute a product, sign, install or change Windows.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root='E:/codex/2026-10-15/work/xjy-v16-deep-audit';
const dev=path.join(root,'release-work/deepseek-stage1-development-a1');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function need(v,m){if(!v)throw Error(m);}
function once(s,from,to){need(s.split(from).length===2,'Expected one exact source fragment');return s.replace(from,()=>to);}
function read(file,pin){const b=fs.readFileSync(file);need(hash(b)===pin,'Frozen source changed: '+file);return b;}
const originalHelper=read(path.join(dev,'root-wrapper-overlay-a11/control/XjyWorkerResult-a10.ps1'),'15c14e6dfcde3aa6c66b5bdd8f31ef37b27cff204571a0e96e06216e1ece6ad5');
const originalWrapper=read(path.join(dev,'root-wrapper-overlay-a6/delivery-tools/Native-Delivery-170.ps1.in'),'a79f0ee195efbd43ebd5d4dfc53b0d020797e6303026e39f5898463a726e6ff4');
const evidence=fs.readFileSync(path.join(dev,'results/guest-runs/59771f1e-1283-4e4b-aa28-f3d7dd9ddf40/stdout.log'),'utf8');
need(evidence.includes('[FAIL] T1 ')&&evidence.includes('Phase=FailProcessTimeout')&&evidence.includes("The property 'version' cannot be found"),'Actual old receiver RED evidence required');
let helper=originalHelper.toString('utf8');
need(helper.charCodeAt(0)===0xfeff,'Keep original helper UTF8 BOM');
const eol=helper.includes('\r\n')?'\r\n':'\n';
helper=once(helper,'        [int]$ProcessTimeoutMs = 180000,','        [int]$ProcessTimeoutMs = 180000,'+eol+'        [switch]$KeepWaitingWhileProcessRuns,');
helper=once(helper,'if ($watch.ElapsedMilliseconds -ge $ProcessTimeoutMs) { $timedOut = $true; break }','if ($watch.ElapsedMilliseconds -ge $ProcessTimeoutMs -and -not $KeepWaitingWhileProcessRuns) { $timedOut = $true; break }');
helper=once(helper,"elseif (([string]$result.version) -cne $ExpectedVersion)","elseif ($null -eq $result.PSObject.Properties['version'] -or $result.version -isnot [string] -or ([string]$result.version) -cne $ExpectedVersion)");
helper=once(helper,"elseif (([string]$result.engineVersion) -cne $ExpectedEngineVersion)","elseif ($null -eq $result.PSObject.Properties['engineVersion'] -or $result.engineVersion -isnot [string] -or ([string]$result.engineVersion) -cne $ExpectedEngineVersion)");
helper=once(helper,"elseif ($AllowedRoles -notcontains ([string]$result.role))","elseif ($null -eq $result.PSObject.Properties['role'] -or $result.role -isnot [string] -or $AllowedRoles -notcontains ([string]$result.role))");
let wrapper=originalWrapper.toString('utf8');
const oldCall=" $outcome=Wait-XjyWorkerResult -Process $p -ResultKind $resultKind -ExpectedVersion '1.7.0' -ExpectedEngineVersion '44.9.0' -AllowedRoles $allowedRoles -OnTick { [Windows.Forms.Application]::DoEvents() }";
const newCall=[
" $workerWatch=[Diagnostics.Stopwatch]::StartNew()",
" $workerViewState=@{LastSecond=-1}",
" # Keep source handles held until this worker really exits; slow copying is not a failed install.",
" $outcome=Wait-XjyWorkerResult -Process $p -ResultKind $resultKind -ExpectedVersion '1.7.0' -ExpectedEngineVersion '44.9.0' -AllowedRoles $allowedRoles -KeepWaitingWhileProcessRuns -OnTick {",
"  $elapsedSeconds=[int][Math]::Floor($workerWatch.Elapsed.TotalSeconds)",
"  if($elapsedSeconds -ne $workerViewState.LastSecond){",
"   $workerViewState.LastSecond=$elapsedSeconds",
"   $minutes=[int][Math]::Floor($elapsedSeconds/60);$seconds=$elapsedSeconds%60",
"   Set-XjyProgressView -View $progressView -Detail ('正在安装及校验，已用 '+$minutes+' 分 '+$seconds+' 秒。请不要重复运行；完成后会明确提示结果。')",
"  }",
"  [Windows.Forms.Application]::DoEvents()",
" }"
].join(wrapper.includes('\r\n')?'\r\n':'\n');
wrapper=once(wrapper,oldCall,newCall);
const directory=path.join(dev,'root-wrapper-overlay-a11/delivery-tools');
const entries=[['XjyWorkerResult.ps1',Buffer.from(helper,'utf8')],['Native-Delivery-170.ps1.in',Buffer.from(wrapper,'utf8')]];
for(const [name]of entries)need(!fs.existsSync(path.join(directory,name)),'Preserve existing candidate: '+name);
fs.mkdirSync(directory,{recursive:true});
const report=[];for(const [name,b]of entries){const file=path.join(directory,name),fd=fs.openSync(file,'wx');try{fs.writeFileSync(fd,b);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}need(hash(fs.readFileSync(file))===hash(b),'Candidate write mismatch');report.push({path:file,size:b.length,sha256:hash(b)});}
console.log(JSON.stringify({purpose:'source-only-a11-slow-worker-candidate',files:report,originalsPreserved:true,productExecuted:false,privateKeyRead:false,installed:false}));

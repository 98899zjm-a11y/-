'use strict';
// Read-only Guest diagnostic: run only the frozen fixed inventory command.
// Does not load the helper, run an application, write files, or kill a process.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'..'),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
if(process.platform!=='win32'||ROOT.toLowerCase()!=='c:\\xjy-work\\xjy-web-stage1')throw Error('Fixed actual no-F Guest required');
if(hash(fs.readFileSync(path.join(ROOT,'stage1/guest-candidate-cdp.cjs')))!=='59840b638d8797fb55241616cd0b8e4098075a76834a201b0e93c1a748f1bb32')throw Error('Original guard pin changed');
require('../stage1/guest-candidate-cdp.cjs').actualGuard();
if(hash(fs.readFileSync(__filename))!==process.env.XJY_PERSISTENT_DIAG_SHA256)throw Error('Root must freeze diagnostic');
const source=fs.readFileSync(path.join(ROOT,'audit-tools/updater-helper-persistent.cjs'));
if(hash(source)!=='72420afae57db1f63f5de68f13bb13800aaa6205e73226f695907722bef26dab')throw Error('Frozen helper changed');
const text=source.toString('utf8'),match=text.match(/ const command=("[^\r\n]*");\r?\n const encoded=/);
if(!match)throw Error('Fixed command literal absent');
const command=JSON.parse(match[1]);
if(!command.startsWith('[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);')||!command.includes('Get-CimInstance Win32_Process'))throw Error('Fixed command policy mismatch');
const environment={};for(const key of ['SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','PATH'])if(typeof process.env[key]==='string')environment[key]=process.env[key];
const powershell=path.resolve(environment.SystemRoot||'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),started=Date.now();
const proc=require('node:child_process').spawn(powershell,['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(command,'utf16le').toString('base64')],{windowsHide:true,shell:false,env:environment,stdio:['pipe','pipe','pipe']});
const stdout=[],stderr=[],events=[];let outSize=0,errSize=0,ending=false,timedOut=false,done=false;
function end(){if(!ending){ending=true;proc.stdin.end();}}
function report(code,signal,reason){if(done)return;done=true;clearTimeout(timer);clearTimeout(closeTimer);const out=Buffer.concat(stdout),err=Buffer.concat(stderr);let inventory;try{const rows=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(out));inventory={array:Array.isArray(rows),count:Array.isArray(rows)?rows.length:null,currentPidPresent:Array.isArray(rows)&&rows.some(r=>r.ProcessId===process.pid)};}catch(e){inventory={jsonError:e.message};}process.stdout.write(JSON.stringify({scope:'actual-Guest-frozen-persistent-probe-readonly',helperSha256:hash(source),commandSha256:hash(Buffer.from(command)),powershell,elapsedMs:Date.now()-started,code,signal,reason,timedOut,events,stdoutBytes:outSize,stdoutSha256:hash(out),inventory,stderrBytes:errSize,stderrUtf8:err.toString('utf8'),stderrBase64:err.toString('base64')})+'\n');if(reason||timedOut||code!==0||signal||err.length)process.exitCode=1;}
proc.once('spawn',()=>{events.push('spawn');proc.stdin.write(Buffer.from('list\n','ascii'),e=>{if(e){events.push('stdin-write-error:'+e.message);end();}});});
proc.stdout.on('data',chunk=>{outSize+=chunk.length;if(outSize<=4194304)stdout.push(chunk);if(chunk.includes(10)||outSize>4194304)end();});
proc.stderr.on('data',chunk=>{errSize+=chunk.length;if(errSize<=4194304)stderr.push(chunk);end();});
for(const [name,stream] of [['stdin',proc.stdin],['stdout',proc.stdout],['stderr',proc.stderr]])stream.on('error',e=>{events.push(name+'-error:'+e.message);end();});
proc.once('error',e=>{events.push('process-error:'+e.message);end();});
proc.once('exit',(code,signal)=>events.push('exit:'+code+':'+signal));
proc.once('close',(code,signal)=>report(code,signal,null));
let closeTimer;const timer=setTimeout(()=>{timedOut=true;events.push('request-timeout');end();closeTimer=setTimeout(()=>{for(const stream of [proc.stdin,proc.stdout,proc.stderr])stream.destroy();proc.unref();report(null,null,'normal-close-timeout');},15000);},15000);

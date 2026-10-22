'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync,spawn}=require('node:child_process'),assert=require('node:assert/strict');
const R='D:/Codex/xjy-release-20261022',G='c6b4f1f6-411e-4272-b4a4-a1ca62701e39',WSB='C:/Users/Administrator/AppData/Local/Microsoft/WindowsApps/wsb.exe';
const signed=JSON.parse(fs.readFileSync(R+'/outer-finalize-status.json'));assert.equal(signed.status,'SIGNED_INTERNAL_VERIFIED');
function run(args){const r=spawnSync(WSB,args,{windowsHide:true,shell:false,encoding:'utf8',maxBuffer:1024*1024});fs.appendFileSync(R+'/sandbox-stage.log',(r.stdout||'')+(r.stderr||''));if(r.error||r.status!==0)throw Error('Sandbox step failed: '+args[0]);}
run(['share','--id',G,'--host-path',R+'/candidate','--sandbox-path','C:\\XjyReleaseCandidate','--raw']);
run(['share','--id',G,'--host-path',R+'/public','--sandbox-path','C:\\XjyReleaseControl','--raw']);
run(['share','--id',G,'--host-path',R+'/guest-results','--sandbox-path','C:\\XjyReleaseResults','--allow-write','--raw']);
console.log('Preparing the isolated test package. Keep Windows Sandbox visible.');
const p=spawn(WSB,['exec','--id',G,'--run-as','ExistingLogin','--working-directory','C:\\XjyReleaseControl','--command','C:\\XjyNode\\node.exe C:\\XjyReleaseControl\\ROOT_GUEST_RELEASE_STAGE.cjs','--raw'],{windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});
for(const stream of[p.stdout,p.stderr])stream.on('data',d=>{process.stdout.write(d);fs.appendFileSync(R+'/sandbox-stage.log',d);});
p.on('close',code=>{console.log('Sandbox observer exit code: '+code);process.exitCode=code===0?0:1;});

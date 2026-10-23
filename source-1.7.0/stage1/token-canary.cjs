'use strict';
const fs=require('node:fs'),path=require('node:path'),net=require('node:net');
const root=path.resolve(__dirname,'..');
const cp=require('node:child_process');
for(const [name,program,args] of [['owned-node',path.join(root,'stage1','tools','node.exe'),['--version']],['python','C:\\Python314\\python.exe',['-B',path.join(root,'stage1','token-info.py')]]]){
 try{const result=cp.spawnSync(program,args,{cwd:root,windowsHide:true,stdio:'pipe'});fs.writeFileSync(path.join(root,'logs','spawn-canary-'+name+'.json'),JSON.stringify({status:result.status,error:result.error?{code:result.error.code,errno:result.error.errno,message:result.error.message}:null,stdout:result.stdout?.toString(),stderr:result.stderr?.toString()}));}catch(e){fs.writeFileSync(path.join(root,'logs','spawn-canary-'+name+'.json'),JSON.stringify({error:e.message}));}
}
const input=path.join(root,'runtime','child-input.txt');fs.writeFileSync(input,'');
const handles=[fs.openSync(input,'r'),fs.openSync(path.join(root,'logs','child-stdout.txt'),'w'),fs.openSync(path.join(root,'logs','child-stderr.txt'),'w')];
try{const result=cp.spawnSync('C:\\Python314\\python.exe',['-B',path.join(root,'stage1','token-info.py')],{cwd:root,windowsHide:true,stdio:handles});fs.writeFileSync(path.join(root,'logs','spawn-canary-files.json'),JSON.stringify({status:result.status,error:result.error?{code:result.error.code,errno:result.error.errno}:null}));}finally{handles.forEach(x=>fs.closeSync(x));}
fs.writeFileSync(path.join(root,'runtime','sandbox-write-canary.txt'),'synthetic isolated write');
let codeWriteDenied=false;try{fs.writeFileSync(path.join(root,'stage1','forbidden-runtime-code-write.txt'),'must be denied');}catch(error){if(!['EACCES','EPERM'].includes(error.code))throw error;codeWriteDenied=true;}
if(!codeWriteDenied)throw new Error('OS write restriction failed for code directory');
const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>{fs.writeFileSync(path.join(root,'logs','token-canary-result.json'),JSON.stringify({isolatedWrite:true,codeWriteDenied,loopbackListener:true,port}));});});

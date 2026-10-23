'use strict';
async function runSupervisor({launch,delay,limit=3,onAttempt=()=>{}}){
 for(let attempt=1;attempt<=limit;attempt++){onAttempt(attempt);const code=await launch();if(code===0)return{stopped:true,attempts:attempt};if(attempt<limit)await delay(Math.min(1000*2**(attempt-1),8000));}return{failed:true,attempts:limit};
}
if(require.main===module){(async()=>{
 const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..'),guard=require('./isolation.cjs').createIsolationGuard(root);
 const policy=require('./io-guard.cjs').install({root,writeDirs:['data','config','cache','logs','runtime','backups'].map(x=>path.join(root,x)),readDirs:['C:\\Python314'],childPrograms:[{program:'C:\\Python314\\python.exe',validate:a=>JSON.stringify(a)===JSON.stringify(['-B',path.join(root,'stage1','run-restricted.py'),'--script','stage1/host.cjs','--mode','serve'])}]});
 const cp=require('node:child_process'),log=guard.assertPath(path.join(root,'logs','supervisor-events.jsonl'));
 const launch=()=>new Promise((resolve,reject)=>{const files=['runtime/supervisor-stdin','logs/supervisor-host.stdout','logs/supervisor-host.stderr'].map(x=>policy.check(path.join(root,x),true));fs.writeFileSync(files[0],'');const handles=files.map((x,i)=>fs.openSync(x,i===0?'r':'a'));let child;try{child=cp.spawn('C:\\Python314\\python.exe',['-B',path.join(root,'stage1','run-restricted.py'),'--script','stage1/host.cjs','--mode','serve'],{cwd:root,env:{TEMP:path.join(root,"runtime","tmp"),TMP:path.join(root,"runtime","tmp"),PYTHONNOUSERSITE:"1",PYTHONDONTWRITEBYTECODE:"1",PYTHONUTF8:"1",PYTHONIOENCODING:"utf-8"},windowsHide:true,stdio:handles});}finally{handles.forEach(x=>fs.closeSync(x));}child.on('error',reject);child.on('exit',code=>resolve(code??1));});
 const result=await runSupervisor({launch,delay:n=>new Promise(r=>setTimeout(r,n)),onAttempt:attempt=>fs.appendFileSync(log,JSON.stringify({at:new Date().toISOString(),attempt})+'\n')});fs.appendFileSync(log,JSON.stringify({at:new Date().toISOString(),...result})+'\n');if(result.failed)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});}
module.exports={runSupervisor};

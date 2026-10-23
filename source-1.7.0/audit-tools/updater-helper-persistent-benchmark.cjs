'use strict';
// Guest-only real OS read-only benchmark. No DI, application launch or file writes.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'..'),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
if(process.platform!=='win32'||ROOT.toLowerCase()!=='c:\\xjy-work\\xjy-web-stage1')throw Error('Fixed actual no-F Guest required');
if(hash(fs.readFileSync(path.join(ROOT,'stage1/guest-candidate-cdp.cjs')))!=='59840b638d8797fb55241616cd0b8e4098075a76834a201b0e93c1a748f1bb32')throw Error('Original guard pin changed');
require('../stage1/guest-candidate-cdp.cjs').actualGuard();
if(hash(fs.readFileSync(__filename))!==process.env.XJY_PERSISTENT_BENCH_SHA256)throw Error('Root must freeze benchmark');
const subjects=[['e60','project/desktop/updater-helper.cjs','e60b4c84413e215f06f50f3320b5621ba5d1b439ab0167e2a1d4ab810a6bcb90'],['persistent-a2','audit-tools/updater-helper-persistent-a2.cjs','d7c7c877dc8bcec3bb07250a252485d8f81b943ed9fb5ddb73f7364912bc2e5c']];
for(const [,file,pin]of subjects)if(hash(fs.readFileSync(path.join(ROOT,file)))!==pin)throw Error('Frozen benchmark subject changed');
const now=()=>Number(process.hrtime.bigint())/1e6;
async function measure([name,file,sha256]){
 const adapter=require(path.join(ROOT,file)).createWindowsUpdateProcessAdapter({executablePath:process.execPath}),times=[],start=now();let marker,operationError,closeMs=0;
 try{for(let i=0;i<10;i++){const before=now(),p=await adapter.inspect(process.pid);times.push(now()-before);if(!p||p.pid!==process.pid||typeof p.creationMarker!=='string'||!p.creationMarker||path.resolve(p.executablePath).toLowerCase()!==path.resolve(process.execPath).toLowerCase()||marker&&marker!==p.creationMarker)throw Error('Real current process identity changed');marker=p.creationMarker;}}
 catch(e){operationError=e;}
 finally{const before=now();try{if(typeof adapter.close==='function')await adapter.close();}catch(e){if(!operationError)operationError=e;}closeMs=now()-before;}
 return{name,sha256,queriesCompleted:times.length,identityVerified:!operationError,queryMs:times.map(v=>Math.round(v*1000)/1000),totalMs:Math.round((now()-start)*1000)/1000,closeMs:Math.round(closeMs*1000)/1000,...(operationError?{code:operationError.code||'BENCHMARK_FAILED',message:operationError.message}:{})};
}
(async()=>{const results=[];for(const subject of subjects)results.push(await measure(subject));const verified=results.every(r=>r.identityVerified&&r.queriesCompleted===10);process.stdout.write(JSON.stringify({scope:'actual-Guest-real-CIM-10-queries-each-no-DI',verified,results,...(verified?{totalSpeedup:results[0].totalMs/results[1].totalMs}:{})})+'\n');if(!verified)process.exitCode=1;})().catch(e=>{process.stderr.write((e.code||'BENCHMARK_FAILED')+': '+e.message+'\n');process.exitCode=1;});

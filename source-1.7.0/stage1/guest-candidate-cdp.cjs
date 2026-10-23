'use strict';
// Guest test protocol only. No application import, debugger startup, or host use.
const path=require('node:path'),fs=require('node:fs'),{spawnSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'),GUEST=path.resolve('C:/xjy-work/xjy-web-stage1');
function actualGuard(){
 if(process.platform!=='win32'||ROOT.toLowerCase()!==GUEST.toLowerCase())throw Error('CDP requires fixed actual Sandbox guest before connection');
 const p=spawnSync('C:/Python314/python.exe',['-I','-B',path.join(ROOT,'stage1/validate-sandbox-context.py')],{cwd:ROOT,windowsHide:true,encoding:'utf8',shell:false,timeout:30000});
 if(p.error||p.status!==0)throw Error('Actual Sandbox context refused before debugger connection: '+String(p.stderr||p.error));
 const proof=JSON.parse(p.stdout);if(proof.model!=='Virtual Machine'||proof.productionDrivePresent!==false||proof.nonLoopbackAddressCount!==0||!String(proof.userName).toLowerCase().endsWith('\\wdagutilityaccount'))throw Error('Actual Sandbox proof refused');return proof;
}
function validateTarget(target){
 if(target?.type!=='page')throw Error('Actual native page target required');
 const page=new URL(target.url),socket=new URL(target.webSocketDebuggerUrl);
 if(page.protocol!=='jewelry:'||page.hostname!=='app'||page.port||page.username||page.password||socket.protocol!=='ws:'||socket.hostname!=='127.0.0.1'||socket.port!=='42791'||socket.username||socket.password||!socket.pathname.startsWith('/devtools/page/'))throw Error('Only owned native page and fixed loopback debugger accepted');return socket.href;
}
function validateLoopbackListener(rows,port,pid){
 if(!Number.isInteger(pid)||pid<1||![42791,42831].includes(port)||!Array.isArray(rows)||!rows.length||rows.some(row=>row.LocalAddress!=='127.0.0.1'||Number(row.LocalPort)!==port||Number(row.OwningProcess)!==pid))throw Error('Fixed debugger/gateway must listen only on loopback in the actual owned host process');return rows;
}
function unwrap(response){
 if(response?.exceptionDetails)throw Error('Actual page exception: '+JSON.stringify(response.exceptionDetails));
 const value=response?.result;if(!value||value.subtype==='error'||!Object.hasOwn(value,'value'))throw Error('Actual page result absent/error: '+JSON.stringify(response));return value.value;
}
function listeners(port,pid){
 actualGuard();if(!Number.isInteger(pid)||pid<1)throw Error('Actual owned native PID required');
 const p=spawnSync('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoProfile','-Command',`$ErrorActionPreference='Stop'; @(Get-NetTCPConnection -State Listen -LocalPort ${port} | Select-Object LocalAddress,LocalPort,OwningProcess) | ConvertTo-Json -Compress`],{windowsHide:true,encoding:'utf8',shell:false,timeout:20000});
 if(p.status!==0||p.error)throw Error('Cannot prove actual loopback listener: '+String(p.stderr||p.error));const rows=JSON.parse(p.stdout);return validateLoopbackListener(Array.isArray(rows)?rows:[rows],port,pid);
}
async function connectNative({pid,timeoutMs=30000}={}){
 const proof=actualGuard();if(!Number.isInteger(pid)||pid<1)throw Error('Actual owned host PID required');
 if(typeof WebSocket!=='function')throw Error('Original engine WebSocket support unavailable');
 const deadline=Date.now()+timeoutMs;let target,last;
 while(Date.now()<deadline){try{const response=await fetch('http://127.0.0.1:42791/json/list',{signal:AbortSignal.timeout(2500)});if(!response.ok)throw Error('Debugger listing status '+response.status);const targets=await response.json();target=targets.find(row=>row.type==='page'&&String(row.url).startsWith('jewelry://app/'));if(target){validateTarget(target);break;}}catch(error){last=error;}await new Promise(resolve=>setTimeout(resolve,250));}
 if(!target)throw Error('Actual native debugger not ready: '+String(last||''));
 const listenerEvidence=listeners(42791,pid),gatewayListenerEvidence=listeners(42831,pid),socket=new WebSocket(validateTarget(target));let next=0,closed=false;const pending=new Map(),events=[];
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Owned debugger websocket timed out')),5000);socket.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});socket.addEventListener('error',error=>{clearTimeout(timer);reject(error);},{once:true});});
 socket.addEventListener('message',event=>{let row;try{row=JSON.parse(String(event.data));}catch(error){events.push({method:'invalid-json',error:error.message});return;}if(row.id&&pending.has(row.id)){const item=pending.get(row.id);pending.delete(row.id);clearTimeout(item.timer);row.error?item.reject(Error(JSON.stringify(row.error))):item.resolve(row.result);}else if(row.method)events.push(row);});
 socket.addEventListener('close',()=>{closed=true;for(const item of pending.values()){clearTimeout(item.timer);item.reject(Error('Owned debugger connection closed'));}pending.clear();});
 async function send(method,params={},wait=30000,sessionId){if(closed)throw Error('Debugger already closed');if(sessionId!==undefined&&(typeof sessionId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(sessionId)))throw Error('Owned child debugger session ID invalid');const id=++next;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP operation timed out: '+method));},wait);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});}
 await send('Runtime.enable');await send('Log.enable');await send('Network.enable');
 async function evaluate(expression,timeout=30000){if(typeof expression!=='string'||expression.length>256000)throw Error('Owned fixture expression limit');return unwrap(await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true},timeout));}
 async function evaluateSession(sessionId,expression,timeout=30000){if(typeof expression!=='string'||expression.length>256000)throw Error('Owned fixture expression limit');return unwrap(await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true},timeout,sessionId));}
 return{proof,target,listenerEvidence,gatewayListenerEvidence,events,send,evaluate,evaluateSession,close(){if(!closed)socket.close();}};
}
async function closeHost(pid){
 const cdp=await connectNative({pid});try{const login=await cdp.evaluate(`window.jewelryDesktop.request({path:'/auth/login',method:'POST',body:{username:'demo-admin',password:'DemoAdmin-2026!'}})`);if(!login?.ok)throw Error('Owned fake administrator login refused before normal exit');const result=await cdp.evaluate('window.jewelryDesktop.exitHost()');if(result?.ok!==true)throw Error('Existing native exitHost did not accept normal shutdown');console.log(JSON.stringify({actualCheckPassed:true,action:'existing native exitHost',result,listenerEvidence:cdp.listenerEvidence,proof:cdp.proof}));}finally{cdp.close();}
}
if(require.main===module){const pid=Number(process.argv[2]);closeHost(pid).catch(error=>{console.error(error.stack||String(error));process.exitCode=1;});}
module.exports={actualGuard,validateTarget,validateLoopbackListener,unwrap,listeners,connectNative};

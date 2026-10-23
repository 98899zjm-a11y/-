'use strict';
// Fixed optional Host normal-exit recovery only. No employee/connection acceptance.
const fs=require('original-fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..'),BASE=path.join(ROOT,'release-work/engine-4490-a1'),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
assert.equal(ROOT.toLowerCase(),'c:\\xjy-work\\xjy-web-stage1');
assert.equal(process.platform,'win32');assert.equal(process.versions.electron,'44.9.0');assert.equal(process.env.ELECTRON_RUN_AS_NODE,'1');
assert.equal(process.argv.length,3);const pid=Number(process.argv[2]);assert(Number.isSafeInteger(pid)&&pid>0);
for(const [name,pin]of Object.entries({
 'stage1/guest-candidate-cdp.cjs':'59840b638d8797fb55241616cd0b8e4098075a76834a201b0e93c1a748f1bb32',
 'stage1/isolation.cjs':'dd1eea05233607ca20bf19d931e4a5bd10dccd2cbe80ef4697685b6a4fdf759a',
 'stage1/sandbox-context.py':'09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249',
 'stage1/validate-sandbox-context.py':'867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207',
}))assert.equal(sha(fs.readFileSync(path.join(ROOT,name))),pin);
const helper=require('../stage1/guest-candidate-cdp.cjs'),proof=helper.actualGuard();
const guard=require('../stage1/isolation.cjs').createIsolationGuard(ROOT),read=file=>fs.readFileSync(guard.assertPath(file));
assert.equal(JSON.parse(read(path.join(ROOT,'isolation-identity.json'))).namespace,'2c48091c-c205-41b4-88a9-5ebdd24b24a9');
assert.equal(sha(read(path.join(BASE,'runtime-manifest.json'))),'c70dab515150a84327f49c032240858741cd97a78c25f714f642b4fc72e2c6d7');
assert.equal(path.resolve(process.execPath).toLowerCase(),path.join(BASE,'program/鑫金源珠宝报价.exe').toLowerCase());
assert.equal(sha(read(process.execPath)),'c99a56d653220a8bf209b0b9ae2424ec1f1580946d1bf3395a968eb211a4f1b5');
for(const name of ['NODE_OPTIONS','NODE_PATH','PYTHONPATH','PYTHONHOME','NAPI_RS_NATIVE_LIBRARY_PATH'])assert(!process.env[name]);
const output=guard.assertPath(path.join(ROOT,'reports/engine-4490-native-control-close-a1'));assert(!fs.existsSync(output));fs.mkdirSync(output);
const previous=path.join(ROOT,'reports/engine-4490-native-host-selfcheck-a1');
const launched=JSON.parse(read(path.join(previous,'launch.json'))),initial=JSON.parse(read(path.join(previous,'root-start.json'))).processes.find(row=>row.ProcessId===pid);
assert.equal(launched.pid,pid);assert(initial?.CreationUtc);
assert.deepEqual(launched.argv,[process.execPath,'--remote-debugging-address=127.0.0.1','--remote-debugging-port=42791','--self-check']);
async function currentIdentity(){
 const {spawn}=require('node:child_process'),ps='C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
 const command=`$ErrorActionPreference='Stop'; Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}' | Select-Object ProcessId,ParentProcessId,ExecutablePath,@{n='CreationUtc';e={$_.CreationDate.ToUniversalTime().ToString('o')}} | ConvertTo-Json -Compress`;
 const env={SystemRoot:'C:\\Windows',WINDIR:'C:\\Windows',PATH:'C:\\Windows\\System32',PSModulePath:'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules'};
 const child=spawn(ps,['-NoLogo','-NoProfile','-NonInteractive','-Command',command],{cwd:ROOT,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 let body='',over=false;child.stdout.on('data',chunk=>{if(body.length+chunk.length>16384)over=true;else body+=chunk;});child.stderr.on('data',()=>{});
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});assert.equal(code,0);assert(!over);
 const row=JSON.parse(body);assert.equal(row.ProcessId,pid);assert.equal(row.ParentProcessId,initial.ParentProcessId);assert.equal(row.CreationUtc,initial.CreationUtc);
 assert.equal(path.resolve(row.ExecutablePath).toLowerCase(),path.resolve(process.execPath).toLowerCase());return row;
}
async function main(){
 let cdp;const result={purpose:'engine-4490-existing-host-exit',pid,passed:false,proof,harnessForcedStop:false,rootExitObserved:false};
 try{
  result.actualCim=await currentIdentity();
  cdp=await helper.connectNative({pid});
  const login=await cdp.evaluate("window.jewelryDesktop.request({path:'/auth/login',method:'POST',body:{username:'demo-admin',password:'DemoAdmin-2026!'}})");
  assert.equal(login?.ok,true);assert.equal(login?.data?.authenticated,true);
  const reply=await cdp.evaluate('window.jewelryDesktop.exitHost()');assert.equal(reply?.ok,true);
  result.passed=true;result.normalExitRequested=true;
 }catch(error){result.errorType=error.name;result.error='Existing Host normal exit request was not confirmed';}
 finally{cdp?.close();fs.writeFileSync(guard.assertPath(path.join(output,'result.json')),JSON.stringify(result,null,2)+'\n',{flag:'wx'});}
 process.stdout.write(JSON.stringify({passed:result.passed,normalExitRequested:result.normalExitRequested===true,rootExitObserved:false})+'\n');process.exitCode=result.passed?0:1;
}
main().catch(()=>{process.stderr.write('Fixed Host exit control failed; no termination issued\n');process.exitCode=1;});

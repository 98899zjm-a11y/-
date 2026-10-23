'use strict';
// Explicit package-external compatibility entry. The copied161 helper remains
// byte-for-byte original; only its supported processAdapter argument is set to
// the reviewed UTF8 adapter that still queries and launches the actual OS.
const fs=process.versions.electron?require('original-fs'):require('node:fs');
const io=fs.promises,path=require('node:path'),crypto=require('node:crypto');
const core=require('../delivery-tools/initial-patch-core.cjs'),u=require('../project/desktop/employee-update-cache.cjs');
const UTF8_SOURCE=path.resolve(__dirname,'../project/desktop/updater-helper.cjs');
const UTF8_SHA='e60b4c84413e215f06f50f3320b5621ba5d1b439ab0167e2a1d4ab810a6bcb90';
const ENGINE={size:246302720,sha256:'db3ad2066a55546f9b6737da3c7f011370e4856fb36888055b544d45653e4f40'};
const FILES=Object.freeze([
 {name:'updater-helper.cjs',size:12823,sha256:'adb25b58eaa56b022e6c758cfc2bde7a7fe437a5688dc942e1bdb67aacc9e830'},
 {name:'employee-update-installer.cjs',size:30460,sha256:'96ba3df08a0f706e599da7d452374b1f894d401c0a6ff605fc01255d01445bd0'},
 {name:'employee-update-cache.cjs',size:17326,sha256:'5cb70079bf161a002a2701694e4774c2a11bf8d54efc6674ccb5c7b2c6729815'},
 {name:'bootstrap.json',size:87430,sha256:'7f3362659908e5cedc1c8bf846901778bb622544c4b1c615c02d87c441cc54fa'}
].map(Object.freeze));
const SHA=/^[a-f0-9]{64}$/;
function need(value,code,message){if(!value)u.fail(code,message);}
function exact(value,keys){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&Object.keys(value).every(key=>keys.includes(key));}
async function runEmployee161Utf8Compat(input){
 need(exact(input,['requestPath','sourceSha256'])&&SHA.test(input.sourceSha256||''),'INVALID_COMPAT_INPUT','Only the original request path and sealed entry SHA are accepted');
 need(process.platform==='win32'&&process.arch==='x64'&&process.versions.electron==='44.7.0'&&process.versions.node==='24.21.0'&&process.env.ELECTRON_RUN_AS_NODE==='1'&&!process.env.NODE_OPTIONS&&!process.env.NODE_PATH,'UNTRUSTED_LAUNCH','Original clean Electron Node engine required');
 const own=await core.fileHash(io,__filename,path.dirname(__filename));
 need(own.sha256===input.sourceSha256&&own.size>0&&own.size<=1048576,'COMPAT_SOURCE_CHANGED','Sealed compatibility entry changed');
 const fixed=await core.fileHash(io,UTF8_SOURCE,path.dirname(UTF8_SOURCE));
 need(fixed.sha256===UTF8_SHA&&fixed.size>0&&fixed.size<=1048576,'COMPAT_SOURCE_CHANGED','Reviewed UTF8 OS adapter changed');
 const requestPath=u.safeAbsolute(input.requestPath),handoff=path.dirname(requestPath),id=path.basename(handoff);
 need(path.basename(requestPath)==='request.json'&&u.UUID.test(id)&&path.basename(path.dirname(handoff))==='employee-update-handoffs','BAD_HANDOFF','Original UUID request handoff required');
 const capability=process.env.XJY_UPDATE_CAPABILITY;
 need(SHA.test(capability||''),'BAD_REQUEST','Original handoff capability required');
 const record=JSON.parse(await u.readSmall(io,requestPath,4194304));
 need(exact(record,['request','mac'])&&typeof record.request==='string'&&SHA.test(record.mac||'')&&crypto.timingSafeEqual(crypto.createHmac('sha256',Buffer.from(capability,'hex')).update(record.request).digest(),Buffer.from(record.mac,'hex')),'BAD_REQUEST','Original helper request authentication failed');
 const request=JSON.parse(record.request);
 need(exact(request,['version','operation','installDir','profileDir','executablePath','currentVersion','currentProcess','stage','employee','expectedVersion'])&&request.version===1&&request.operation==='install'&&request.employee===true&&request.currentVersion==='1.6.1'&&request.expectedVersion==='1.6.1','BAD_REQUEST','Only the original typed161 install request is permitted');
 const install=u.safeAbsolute(request.installDir),profile=u.safeAbsolute(request.profileDir),exe=u.safeAbsolute(request.executablePath);
 need(u.samePath(exe,path.join(install,'鑫金源珠宝报价.exe'))&&u.samePath(process.execPath,exe)&&u.samePath(handoff,path.join(profile,'employee-update-handoffs',id))&&Number.isSafeInteger(request.currentProcess?.pid)&&request.currentProcess.pid>0&&request.currentProcess.pid!==process.pid&&typeof request.currentProcess.creationMarker==='string'&&request.currentProcess.creationMarker,'BAD_PROCESS','Request must name the original installed employee parent');
 await u.assertPath(io,handoff,{directory:true,root:profile});
 const engine=await core.fileHash(io,exe,install);need(engine.size===ENGINE.size&&engine.sha256===ENGINE.sha256,'SOURCE_ENGINE_MISMATCH','Original installed engine changed');
 for(const pin of FILES){const value=await core.fileHash(io,path.join(handoff,pin.name),profile);need(value.size===pin.size&&value.sha256===pin.sha256,'BAD_HELPER','Original copied helper changed: '+pin.name);}
 // These imports occur only after their source pins were checked. No process
 // results, ready records, signatures or actor identities are manufactured.
 const corrected=require(UTF8_SOURCE),original=require(path.join(handoff,'updater-helper.cjs'));
 need(typeof corrected.createWindowsUpdateProcessAdapter==='function'&&typeof original.runUpdaterHelper==='function','BAD_HELPER','Reviewed original helper API required');
 const processAdapter=corrected.createWindowsUpdateProcessAdapter({executablePath:exe});
 return original.runUpdaterHelper({requestPath,processAdapter});
}
module.exports={runEmployee161Utf8Compat};
if(require.main===module){
 const args=process.argv.slice(2);
 const input=args.length===4&&args[0]==='--source-sha256'&&SHA.test(args[1]||'')&&args[2]==='--request-path'?{sourceSha256:args[1],requestPath:args[3]}:null;
 const task=input?runEmployee161Utf8Compat(input):Promise.reject(Object.assign(Error('Fixed compatibility invocation required'),{code:'INVALID_COMPAT_INPUT'}));
 task.then(result=>{console.log(JSON.stringify({compatibilityEntry:true,installed:result?.installed===true,version:result?.version,restarted:result?.restarted===true}));},error=>{console.error(JSON.stringify({compatibilityEntry:true,failed:true,code:/^[A-Z0-9_]{1,80}$/.test(error?.code||'')?error.code:'COMPAT_FAILED'}));process.exitCode=1;});
}

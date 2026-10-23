'use strict';
// Only the trusted main process calls this lifecycle helper. No renderer paths,
// environment overrides or sandbox flags are accepted by an IPC handler.
function physicalFileSystem(){return process.versions.electron?require('original-fs'):require('node:fs');}
// These checks admit OS paths, so Electron's virtual ASAR stats are unsuitable.
const fs=physicalFileSystem(),path=require('node:path'),crypto=require('node:crypto');
function requireHostAdmission(admission,assertAdmission){
 if(typeof assertAdmission!=='function'||assertAdmission(admission)!==true)throw Error('主机启动准入未通过');
 if(!admission||!Object.isFrozen(admission)||admission.publicAccess!==false||!['sandbox','installed'].includes(admission.mode)||admission.mode==='installed'&&admission.role!=='host'||admission.mode==='sandbox'&&(!path.isAbsolute(admission.root||'')))throw Error('主机启动准入无效');
 return admission;
}
function plainPath(value){
 if(typeof value!=='string'||!path.isAbsolute(value)||/^[\\/]{2}/.test(value)||/[\x00-\x1f]/.test(value)||process.platform==='win32'&&value.slice(2).includes(':'))throw Error('只接受普通本地绝对路径');
 for(const part of value.replaceAll('/','\\').split('\\'))if(/[ .]$/.test(part)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))throw Error('目录名称无效');
 return path.resolve(value);
}
function inspectPath(value){const target=plainPath(value);for(let p=target;;p=path.dirname(p)){if(fs.existsSync(p)){const stat=fs.lstatSync(p);if(stat.isSymbolicLink())throw Error('目录或文件不能使用链接');if(stat.isFile()&&stat.nlink!==1)throw Error('文件不能使用硬链接');}if(p===path.dirname(p))break;}return target;}
function createOwnedPathGuard(value){
 const root=inspectPath(value);if(!fs.existsSync(root)||!fs.statSync(root).isDirectory())throw Error('现有主机资料根目录缺失');
 const realRoot=fs.realpathSync.native(root),identity=fs.statSync(realRoot,{bigint:true});
 const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino;
 function check(input){const target=inspectPath(input),relative=path.relative(realRoot.toLowerCase(),target.toLowerCase());if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('路径不在本机资料范围内');if(!same(identity,fs.statSync(realRoot,{bigint:true})))throw Error('资料根目录身份已变化');let found=false;for(let p=target;;p=path.dirname(p)){if(fs.existsSync(p)&&same(identity,fs.statSync(p,{bigint:true})))found=true;if(p===path.dirname(p))break;}if(!found)throw Error('实际目录越过主机资料范围');let ancestor=target,tail=[];while(!fs.existsSync(ancestor)){tail.unshift(path.basename(ancestor));ancestor=path.dirname(ancestor);}const resolved=path.resolve(fs.realpathSync.native(ancestor),...tail),r=path.relative(realRoot.toLowerCase(),resolved.toLowerCase());if(r==='..'||r.startsWith('..'+path.sep)||path.isAbsolute(r))throw Error('实际路径越过主机资料范围');return resolved;}
 return Object.freeze({root:realRoot,check});
}
function safeEnvironment(environment){const out={};for(const key of ['SystemRoot','SYSTEMROOT','WINDIR','SystemDrive','ComSpec','COMSPEC','PATH','Path','PATHEXT','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','PROGRAMDATA','HOMEDRIVE','HOMEPATH','USERNAME','COMPUTERNAME'])if(typeof environment[key]==='string')out[key]=environment[key];return out;}
async function launchManagedPrintWorker({admission,assertAdmission,storageRoot,executable=process.execPath,isPackaged=admission?.mode==='installed',codeDir,resourcesDir,profileDir,environment=process.env,spawn=require('node:child_process').spawn,clientFactory=require('./print-worker-client.cjs').createPrintWorkerClient,readyTimeoutMs=15000,stopTimeoutMs=5000}){
 requireHostAdmission(admission,assertAdmission);
 if(!Number.isInteger(readyTimeoutMs)||readyTimeoutMs<1||readyTimeoutMs>60000||!Number.isInteger(stopTimeoutMs)||stopTimeoutMs<1||stopTimeoutMs>15000)throw Error('打印代理等待设置无效');
 const guard=createOwnedPathGuard(admission.mode==='sandbox'?admission.root:storageRoot),profile=guard.check(profileDir),exe=inspectPath(executable),code=inspectPath(codeDir),resources=inspectPath(resourcesDir);
 const codeStat=fs.statSync(code),archivePath=isPackaged===true&&code.toLowerCase()===path.join(resources,'app.asar').toLowerCase(),archiveCode=archivePath&&codeStat.isFile()&&codeStat.nlink===1;
 if(!fs.existsSync(profile)||!fs.statSync(profile).isDirectory()||!fs.statSync(exe).isFile()||archivePath&&!archiveCode||!codeStat.isDirectory()&&!archiveCode||!fs.statSync(resources).isDirectory())throw Error('打印代理所需本机目录不存在');
 const expected=guard.check(path.join(guard.root,'后台运行','打印缓存'));if(profile.toLowerCase()!==expected.toLowerCase())throw Error('打印代理只能使用专属缓存目录');
 if(typeof isPackaged!=='boolean'||admission.mode==='installed'&&!isPackaged)throw Error('打印代理打包状态无效');
 const args=['--xjy-print-worker'];if(!isPackaged){const entry=inspectPath(path.join(code,'print-worker-entry.cjs'));if(!fs.statSync(entry).isFile())throw Error('打印代理入口不存在');args.unshift(entry);}
 const secret=crypto.randomBytes(32).toString('hex'),endpoint=process.platform==='win32'?'\\\\.\\pipe\\xjy-print-worker-'+crypto.randomUUID():path.join(profile,'xjy-print-worker-'+crypto.randomUUID()+'.sock');
 const bootstrap={version:1,endpoint,secret,sandbox:admission.mode==='sandbox',profileDir:profile,pdfDependenciesRoot:inspectPath(path.join(resources,'print-dependencies','node_modules'))};
 const env=safeEnvironment(environment);env.XJY_CENTRAL_PRINT_WORKER_BOOTSTRAP=JSON.stringify(bootstrap);
 const child=spawn(exe,args,{cwd:archiveCode?resources:code,env,stdio:['ignore','pipe','pipe'],windowsHide:true,shell:false,detached:false});
 child?.on?.('error',()=>{}); // Spawn failures with no PID still emit asynchronously.
 if(!child||!Number.isSafeInteger(child.pid)||child.pid<=0||!child.stdout||!child.stderr)throw Error('无法确认打印代理进程身份');
 const ownedPid=child.pid;let exited=false,state='starting',client,closePromise;const death=new Promise(resolve=>{child.once('exit',(code,signal)=>{exited=true;state='exited';resolve({code,signal});});});
 function killOwned(){if(!exited&&child.pid===ownedPid)child.kill();}
 async function awaitExit(){if(exited)return;let timer;await Promise.race([death,new Promise(resolve=>{timer=setTimeout(resolve,stopTimeoutMs);})]);clearTimeout(timer);}
 const ready=new Promise((resolve,reject)=>{
  let buffer='',bytes=0,errorBytes=0,done=false;const timer=setTimeout(()=>finish(Error('打印代理启动超时')),readyTimeoutMs);
  function finish(error){if(done)return;done=true;clearTimeout(timer);child.stdout.off('data',onData);child.stderr.off('data',onErrorData);child.off('error',onError);child.off('exit',onExit);error?reject(error):resolve();}
  function onError(){finish(Error('打印代理启动失败'));}function onExit(){finish(Error('打印代理在准备完成前退出'));}
  function onErrorData(chunk){errorBytes+=Buffer.byteLength(chunk);if(errorBytes>65536)finish(Error('打印代理错误输出过大'));}
  function onData(chunk){bytes+=Buffer.byteLength(chunk);if(bytes>65536)return finish(Error('打印代理准备输出过大'));buffer+=chunk.toString('utf8');let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i).trim();buffer=buffer.slice(i+1);let value;try{value=JSON.parse(line);}catch{continue;}if(value.event==='xjy-print-worker-ready'){if(value.sandbox!==bootstrap.sandbox)return finish(Error('打印代理运行模式不一致'));finish();return;}}}
  child.stdout.on('data',onData);child.stderr.on('data',onErrorData);child.once('error',onError);child.once('exit',onExit);
 });
 try{await ready;if(exited)throw Error('打印代理已经退出');client=clientFactory({endpoint,secret});if(!client||typeof client.getDevices!=='function'||typeof client.print!=='function'||typeof client.close!=='function')throw Error('打印代理通信接口无效');state='ready';}catch(error){killOwned();await awaitExit();throw error;}
 // Keep pipe streams drained after readiness without retaining documents or secrets.
 child.stdout.on('data',()=>{});child.stderr.on('data',()=>{});child.on('error',()=>{state='failed';});
 function active(){if(state!=='ready'||exited)throw Error('打印代理已退出，请在主机检查打印任务后重新启动；不会自动重发');guard.check(profile);}
 return Object.freeze({status:()=>({state,pid:ownedPid,sandbox:bootstrap.sandbox}),async getDevices(){active();return client.getDevices();},async print(...input){active();return client.print(...input);},close(){if(closePromise)return closePromise;closePromise=(async()=>{state='closing';let timer;try{await Promise.race([Promise.resolve().then(()=>client.close()).catch(()=>{}),new Promise(resolve=>{timer=setTimeout(resolve,stopTimeoutMs);})]);}finally{clearTimeout(timer);}if(!exited){await awaitExit();if(!exited){killOwned();await awaitExit();}}if(!exited)throw Error('打印代理未退出，拒绝继续关闭或替换资料');state='closed';})();return closePromise;}});
}
module.exports={launchManagedPrintWorker,requireHostAdmission,createOwnedPathGuard};

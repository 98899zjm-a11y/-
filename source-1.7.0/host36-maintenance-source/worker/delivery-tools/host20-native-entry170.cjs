'use strict';
// This entry must be invoked only after the existing trusted outer bootstrap
// has verified the entire signed worker, its EXE and this exact entry bytes.
// No path, role, database, function callback or install strategy is a CLI input.
const native=process.versions.electron?require('original-fs'):require('node:fs'),fs=native.promises,path=require('node:path'),crypto=require('node:crypto');
const u=require('../project/desktop/employee-update-cache.cjs'),startup=require('../project/desktop/engine-startup-gate.cjs'),auth=require('./host20-native-authority170.cjs');
const {assertNoOtherHostMaintenance170}=require('./host20-preflight170.cjs');
const fail=(code,message)=>{throw Object.assign(Error(message),{code});};
async function findOwnedOperation(token){
 await assertNoOtherHostMaintenance170();
 const f=await auth.revalidateHost20NativePublication170(token),state=startup.stateDirectory(f.installationDir),folder=path.join(state,'host-program-updates'),key=await u.readSmall(fs,path.join(state,'journal-key.bin'),32);let entries;
 try{await u.assertPath(fs,folder,{directory:true});entries=await fs.readdir(folder);}catch(e){if(e.code==='ENOENT')return null;throw e;}
 if(entries.length>256)fail('HOST_RECOVERY_REQUIRED','Too many historical operations; preserve the current state for review');
 const matches=[];
 for(const name of entries){if(!u.UUID.test(name))fail('HOST_RECOVERY_REQUIRED','Unknown operation directory must be preserved');const directory=path.join(folder,name);await u.assertPath(fs,directory,{directory:true});let bytes;try{bytes=await u.readSmall(fs,path.join(directory,'operation.json'),2097152);}catch(e){if(e.code!=='ENOENT')throw e;await require('./host20-state-io170.cjs').archiveUnstartedHost20Snapshot170({facts:f,operationId:name,assertNoOtherAssistant:assertNoOtherHostMaintenance170});continue;}const raw=JSON.parse(bytes);if(typeof raw.payload!=='string'||!/^[a-f0-9]{64}$/.test(raw.mac||'')||Object.keys(raw).sort().join(',')!=='mac,payload'||!crypto.timingSafeEqual(crypto.createHmac('sha256',key).update('xjy-host-program-update170-v1\0').update(raw.payload).digest(),Buffer.from(raw.mac,'hex')))fail('HOST_RECOVERY_REQUIRED','Historical operation authentication failed');const operation=JSON.parse(raw.payload);if(operation.operationId!==name||operation.purpose!=='xjy-host-program-update170-v1'||!u.samePath(operation.installationDir,f.installationDir)||!u.samePath(operation.stateDir,state)||operation.sourceCatalogSha256!==f.policy.source.catalogSha256)fail('HOST_RECOVERY_REQUIRED','Historical operation belongs to another source/role');if(operation.targetCatalogSha256!==f.policy.target.catalogSha256||operation.phase==='source-restored')continue;if(operation.phase==='source-snapshotted'&&operation.coreState===null){await require('./host20-state-io170.cjs').archiveUnstartedHost20Snapshot170({facts:f,operationId:name,assertNoOtherAssistant:assertNoOtherHostMaintenance170});continue;}matches.push(name);}
 if(matches.length>1)fail('HOST_RECOVERY_REQUIRED','Multiple pending operations cannot be auto-selected');return matches[0]||null;
}
async function runBoundHost20Native170(args=process.argv.slice(2)){
 if(args.length!==3||args[0]!=='--binding-sha256'||!/^[a-f0-9]{64}$/.test(args[1]||'')||!['--upgrade','--recover'].includes(args[2]))fail('UNTRUSTED_HOST_LAUNCH','Use the fixed Chinese host update entrance; arbitrary paths and roles are not accepted');
 await assertNoOtherHostMaintenance170();
 const workerRoot=path.resolve(__dirname,'..'),bundleRoot=path.dirname(workerRoot),file=path.join(bundleRoot,'host-program170-binding.json'),bytes=await u.readSmall(fs,file,4194304),publicationToken=await auth.verifyNativeHost20Publication170({bindingBytes:bytes,bindingSha256:args[1],bundleRoot,workerRoot,recovery:args[2]==='--recover'});
 const facts=auth.readHost20NativePublication170(publicationToken),existing=facts.recoveryOnly?facts.recoveryOperationId:await findOwnedOperation(publicationToken),recovery=existing!==null;if(args[2]==='--recover'&&!recovery)fail('HOST_RECOVERY_NOT_FOUND','No matching authenticated pending host update exists');
 let operation;try{
  const operationId=existing||crypto.randomUUID();process.stdout.write(JSON.stringify({type:'progress',phase:recovery?'recovering':'checking',message:recovery?'正在核验原主机恢复记录。':'正在核验原主机并制作三库完整备份。',operationId})+'\n');
  operation=await require('./host20-guest-operation170.cjs').createNativeHost20Operation170({publicationToken,operationId,recovery,checkpoint:async phase=>process.stdout.write(JSON.stringify({type:'progress',phase,operationId})+'\n')});
  let result;if(recovery)result=await operation.runtime.recover({restartTarget:true});else{result=await operation.runtime.install();await operation.runtime.assertStartupHeld();result={...result,release:await operation.runtime.startCommitted(),completed:true};}
  return{...result,completed:result.rolledBack===true?false:result.completed===true,role:'host',version:'1.7.0',engineVersion:'44.9.0',installationDir:auth.readHost20NativePublication170(publicationToken).installationDir,operationId};
 }finally{await operation?.close();}
}
function host20NativeExitCode170(result,mode){if(!result||result.role!=='host'||result.version!=='1.7.0'||result.engineVersion!=='44.9.0')return 1;if(mode==='--recover')return result.recovered===true&&(result.completed===true||result.rolledBack===true)?0:1;return mode==='--upgrade'&&result.completed===true?0:1;}
if(require.main===module)runBoundHost20Native170().then(result=>{process.stdout.write(JSON.stringify({type:'result',...result})+'\n');process.exitCode=host20NativeExitCode170(result,process.argv[4]);}).catch(error=>{process.stderr.write('主机升级尚未完成：'+(error.code||'FAILED')+' '+error.message+'\n');process.exitCode=1;});
module.exports={runBoundHost20Native170,findOwnedOperation,host20NativeExitCode170};

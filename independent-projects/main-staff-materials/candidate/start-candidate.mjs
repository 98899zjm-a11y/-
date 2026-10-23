import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {randomBytes,randomUUID} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {openLibrary} from './materials/lib/library.mjs';
import {createClassifier} from './materials/lib/classifier.mjs';
import {createReviewFirstClassifier} from './materials/lib/review-first.mjs';
import {createMountedMaterials} from './mounted-materials.mjs';
const require=createRequire(import.meta.url),{createBackend}=require('./project/desktop/backend.cjs'),{createGateway}=require('./stage1/web-gateway.cjs');
export const candidateRoot=path.dirname(fileURLToPath(import.meta.url));
const fixedRoot=path.resolve('D:/Codex/xjy-main-staff-session-20261023/candidate');
const kind='xjy-main-materials-synthetic-candidate-v1';
export const mainMaterialDataRoot=path.join(candidateRoot,'materials','runtime','main-session-data');
async function checked(file,{missing=false}={}){
 const full=path.resolve(file),relative=path.relative(fixedRoot,full);if(path.resolve(candidateRoot)!==fixedRoot||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('Only fixed D candidate paths are allowed');
 let cursor=path.parse(full).root;for(const part of full.slice(cursor.length).split(path.sep).filter(Boolean)){cursor=path.join(cursor,part);let st;try{st=await fs.lstat(cursor);}catch(error){if(missing&&error.code==='ENOENT')return;throw error;}if(st.isSymbolicLink()||st.isFile()&&st.nlink!==1)throw Error('Candidate path aliases are refused');}
 return full;
}
async function directory(file){await checked(file,{missing:true});await fs.mkdir(file,{recursive:true});await checked(file);}
export async function prepareSyntheticMaterialStore(root){
 const full=path.resolve(root),runtimeRoot=path.join(candidateRoot,'materials','runtime'),relative=path.relative(runtimeRoot,full);
 if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('Synthetic material store must remain within the candidate materials runtime');
 await directory(full);
 for(const name of ['library.sqlite','library.sqlite-journal','library.sqlite-wal','library.sqlite-shm','images'])await checked(path.join(full,name),{missing:true});
 try{const images=await fs.lstat(path.join(full,'images'));if(!images.isDirectory())throw Error('Material images path must be a directory');}catch(error){if(error.code!=='ENOENT')throw error;}
 const marker=path.join(full,'synthetic-main-session-materials.json');
 try{await checked(marker);const record=JSON.parse(await fs.readFile(marker,'utf8'));if(record?.kind!=='xjy-main-session-materials-v1'||record.synthetic!==true||record.dataRoot!==full)throw Error('Synthetic material marker is invalid');}
 catch(error){if(error.code!=='ENOENT')throw error;if((await fs.readdir(full)).length)throw Error('Existing unmarked material store refused');await fs.writeFile(marker,JSON.stringify({kind:'xjy-main-session-materials-v1',synthetic:true,dataRoot:full})+'\n',{flag:'wx',mode:0o600});await checked(marker);}
 return full;
}
export async function writeCandidateInstanceRecord(record,{file=path.join(candidateRoot,'runtime','instance.json')}={}){
 const full=path.resolve(file),runtimeRoot=path.join(candidateRoot,'runtime'),relative=path.relative(runtimeRoot,full);
 if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative)||path.basename(full)!=='instance.json')throw Error('Instance record must use a candidate runtime instance.json path');
 if(!record||typeof record!=='object'||Array.isArray(record))throw TypeError('Instance record must be an object');
 const bytes=JSON.stringify(record,null,2)+'\n';if(Buffer.byteLength(bytes)>8192)throw Error('Instance record too large');
 const inspect=async()=>{await checked(full,{missing:true});try{if(!(await fs.lstat(full)).isFile())throw Error('Instance record must be a regular file');}catch(error){if(error.code!=='ENOENT')throw error;}};
 await directory(path.dirname(full));await inspect();
 const temporary=path.join(path.dirname(full),'.instance-'+randomUUID()+'.tmp');let handle,created=false;
 try{handle=await fs.open(temporary,'wx',0o600);created=true;await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;await checked(temporary);await inspect();await fs.rename(temporary,full);created=false;await checked(full);return full;}
 finally{if(handle)await handle.close();if(created)try{await checked(temporary);await fs.unlink(temporary);}catch{}}
}
export async function loadMainCandidateAccounts(){
 const privateFile=path.join(candidateRoot,'runtime','main-candidate-accounts.json');await directory(path.dirname(privateFile));
 try{await checked(privateFile);return JSON.parse(await fs.readFile(privateFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
 const accounts=[['main_admin','主系统测试管理员','admin','manage'],['main_view','主系统查看测试员工','employee','view'],['main_operate','主系统整理测试员工','employee','operate'],['main_manage','主系统素材测试管理','employee','manage']].map(([username,name,role,level])=>({username,name,role,level,password:randomBytes(24).toString('base64url')}));
 await fs.writeFile(privateFile,JSON.stringify(accounts,null,2)+'\n',{flag:'wx',mode:0o600});await checked(privateFile);return accounts;
}
export async function startMainMaterialsCandidate({port=21965,classify}={}){
 if(![0,21965].includes(port)||classify!==undefined&&typeof classify!=='function')throw TypeError('Fixed candidate port and internal classifier required');
 await checked(candidateRoot);const server=http.createServer();
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen({port,host:'127.0.0.1',exclusive:true},resolve);});
 let backend,library,gateway,closing;
 const origin='http://127.0.0.1:'+server.address().port;
 async function close(){if(closing)return closing;closing=(async()=>{const errors=[];for(const action of [()=>gateway?.close(),()=>library?.close(),()=>backend?.close(),()=>new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()))])try{await action();}catch(error){errors.push(error);}if(errors.length)throw new AggregateError(errors,'候选部分服务未正常关闭');})();return closing;}
 try{
  await directory(path.join(candidateRoot,'logs'));
  const mainData=path.join(candidateRoot,'runtime','main-data'),marker=path.join(mainData,'synthetic-candidate.json');await directory(mainData);
  for(const name of ['jewelry.sqlite','jewelry.sqlite-wal','jewelry.sqlite-shm','images'])await checked(path.join(mainData,name),{missing:true});
  let hasDatabase=false;try{await fs.stat(path.join(mainData,'jewelry.sqlite'));hasDatabase=true;}catch(error){if(error.code!=='ENOENT')throw error;}
  try{await checked(marker);const record=JSON.parse(await fs.readFile(marker,'utf8'));if(record.kind!==kind)throw Error('Unmarked main candidate data refused');}catch(error){if(error.code!=='ENOENT')throw error;if(hasDatabase)throw Error('Existing unmarked database refused');await fs.writeFile(marker,JSON.stringify({kind,synthetic:true})+'\n',{flag:'wx'});}
  const accounts=await loadMainCandidateAccounts();
  if(!Array.isArray(accounts)||accounts.length!==4||accounts.some(a=>typeof a.password!=='string'||a.password.length<24))throw Error('Private candidate account file is invalid');
  backend=createBackend({dataDir:mainData,migrationDir:path.join(candidateRoot,'project','desktop','migrations')});
  if(backend.auth.status().needsSetup){const owner=accounts.find(a=>a.role==='admin');if(!owner)throw Error('Candidate owner missing');backend.auth.setup(owner);for(const account of accounts.filter(a=>a!==owner)){const user=backend.auth.createUser(account);backend.administration.updatePermissions(backend.auth.status().user,{staffId:user.id,moduleAccess:{sales:account.level}},()=>backend.auth.listUsers());}backend.auth.logout();}
  const dataRoot=await prepareSyntheticMaterialStore(mainMaterialDataRoot);
  library=await openLibrary({root:dataRoot,classify:classify??createReviewFirstClassifier(createClassifier({model:'qwen3-vl:4b-instruct'}))});
  const mounted=createMountedMaterials({library,origin});
  gateway=createGateway({backend,server,root:candidateRoot,appVersion:'1.7.0',allowLocalControls:false,sessionCookiePrefix:'xjy_materials_candidate_20261023',materialsHandler:mounted});
  return {origin,server,backend,library,gateway,close};
 }catch(error){try{await close();}catch(cleanup){error.cleanupError=cleanup.message;}throw error;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 if(process.argv.length!==2)throw Error('Candidate accepts no path, account or port overrides');
 const app=await startMainMaterialsCandidate(),instanceId=randomUUID();
 const instance={kind,instanceId,pid:process.pid,origin:app.origin,startedAt:new Date().toISOString(),mainSystemSession:true,productionConnected:false};
 try{await writeCandidateInstanceRecord(instance);}catch(error){try{await app.close();}catch(cleanup){error.cleanupError=cleanup.message;}throw error;}console.log(JSON.stringify(instance));
 let stopping=false;const stop=async()=>{if(stopping)return;stopping=true;clearInterval(timer);await app.close();console.log('Main-session candidate closed normally');};
 const timer=setInterval(async()=>{const stopFile=path.join(candidateRoot,'runtime','stop-request.json');try{await checked(stopFile);const request=JSON.parse(await fs.readFile(stopFile,'utf8'));if(request.instanceId===instanceId)await stop();}catch(error){if(error.code!=='ENOENT')console.error('Candidate stop request was refused');}},1000);
 process.once('SIGINT',()=>stop().catch(()=>{process.exitCode=1;}));process.once('SIGTERM',()=>stop().catch(()=>{process.exitCode=1;}));
}

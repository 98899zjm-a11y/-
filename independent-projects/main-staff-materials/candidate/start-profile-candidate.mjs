import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID,timingSafeEqual} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {createMaterialRuntimeSuite} from './materials-runtime-entry.mjs';
const require=createRequire(import.meta.url);
const {createBackend}=require('./project/desktop/backend.cjs');
const {createGateway}=require('./stage1/web-gateway.cjs');
const {startLanServer}=require('./project/desktop/lan.cjs');
const {createOwnedPathGuard}=require('./project/desktop/managed-print-worker.cjs');
export const candidateRoot=path.dirname(fileURLToPath(import.meta.url));
const FIXED_CANDIDATE_ROOT='D:/Codex/xjy-main-staff-session-20261023/candidate';
const FIXED_NODE='D:/Codex/xjy-agent-sales-media/openclaw-isolated/runtime/node-v24.22.1-win-x64/node.exe';
const NODE_SHA='D702DAA815EABBFF763C7D3808E235CF031CF2CA70211B56847BC72F51E240E5';
const INSTANCE_KIND='xjy-profile-materials-candidate-v1';
const MARKER_KIND='xjy-profile-materials-synthetic-candidate-v1';
const STOP_KIND='xjy-profile-materials-stop-request-v1';
const MAIN_KIND='xjy-main-materials-synthetic-candidate-v1';
const PROFILE_HOME_NAME='profile-materials-candidate';
const PROFILE_DIR_NAME='销售素材';
const MARKER_NAME='synthetic-profile-candidate.json';
const INSTANCE_NAME='instance.json';
const CONNECTION_NAME='connection.json';
const IDENTITY_NAME='lan-identity.json';
const STOP_NAME='stop-request.json';
const OWNER_CLAIM_NAME='owner-claim.json';
const OWNER_CLAIM_KIND='xjy-profile-materials-owner-claim-v1';
const SOURCE_HASH_SCOPE='selected-startup-sources-v1';
const WORKER_FLAG='--owned-child';
const FIXTURE_BASE=path.join(candidateRoot,'runtime','profile-candidate-tests');
const DEMO_PROFILE_HOME=path.join(candidateRoot,'runtime',PROFILE_HOME_NAME);
const MIGRATION_DIR=path.join(candidateRoot,'project','desktop','migrations');
const SOURCE_FILES=Object.freeze([
 ['entry','start-profile-candidate.mjs'],
 ['runtimeEntry','materials-runtime-entry.mjs'],
 ['transport','materials-session-transport.mjs'],
 ['mounted','mounted-materials.mjs'],
 ['lan','project/desktop/lan.cjs'],
 ['gateway','stage1/web-gateway.cjs'],
 ['backend','project/desktop/backend.cjs'],
 ['library','materials/lib/library.mjs'],
 ['storageProfile','materials/lib/storage-profile.mjs']
]);
const ALLOWED_HOME=new Set([MARKER_NAME,PROFILE_DIR_NAME,'logs',INSTANCE_NAME,CONNECTION_NAME,IDENTITY_NAME,STOP_NAME,OWNER_CLAIM_NAME]);
const ALLOWED_START_KEYS=new Set(['port','lanPort','fixtureRoot','classify']);
const ALLOWED_STOP_KEYS=new Set(['fixtureRoot','nonce']);
const EXPECTED_ACCOUNTS=Object.freeze([
 ['main_admin','admin','manage'],
 ['main_view','employee','view'],
 ['main_operate','employee','operate'],
 ['main_manage','employee','manage']
]);
function assertFixedCandidateRoot(){
 const resolved=path.resolve(candidateRoot),expected=path.resolve(FIXED_CANDIDATE_ROOT);
 if(resolved.toLowerCase()!==expected.toLowerCase())throw Error('素材候选只能从固定D盘目录运行');
 const real=fsSync.realpathSync.native(resolved);
 if(real.toLowerCase()!==resolved.toLowerCase())throw Error('素材候选目录必须是固定真实目录');
 const stat=fsSync.lstatSync(real);
 if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('素材候选目录无效');
}
function isUuid(value){
 if(typeof value!=='string'||value.length!==36)return false;
 for(let index=0;index<36;index++){
  const code=value.charCodeAt(index);
  if(index===8||index===13||index===18||index===23){if(code!==45)return false;}
  else if(!(code>=48&&code<=57)&&!(code>=97&&code<=102))return false;
 }
 return true;
}
function isCode(value){
 if(typeof value!=='string'||value.length!==32)return false;
 for(let index=0;index<32;index++){
  const code=value.charCodeAt(index);
  if(!(code>=48&&code<=57)&&!(code>=65&&code<=90)&&!(code>=97&&code<=122)&&code!==45&&code!==95)return false;
 }
 return true;
}
function isSha(value){
 if(typeof value!=='string'||value.length!==64)return false;
 for(let index=0;index<64;index++){
  const code=value.charCodeAt(index);
  if(!(code>=48&&code<=57)&&!(code>=97&&code<=102))return false;
 }
 return true;
}
function sameSecret(a,b){
 if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;
 return timingSafeEqual(Buffer.from(a),Buffer.from(b));
}
function samePath(a,b){
 if(typeof a!=='string'||typeof b!=='string')return false;
 try{return path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();}catch{return false;}
}
function delay(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
function validateStartOptions(options){
 if(options===null||typeof options!=='object'||Array.isArray(options))throw TypeError('候选启动参数无效');
 for(const key of Object.keys(options))if(!ALLOWED_START_KEYS.has(key))throw TypeError('候选启动不接受额外参数');
 const port=options.port===undefined?21965:options.port;
 const lanPort=options.lanPort===undefined?21966:options.lanPort;
 const fixtureRoot=options.fixtureRoot;
 const classify=options.classify;
 if(port!==0&&port!==21965)throw TypeError('候选端口只能是0或21965');
 if(lanPort!==0&&lanPort!==21966)throw TypeError('局域网端口只能是0或21966');
 if(fixtureRoot===undefined){
  if(port!==21965||lanPort!==21966)throw TypeError('临时端口必须提供受检fixture');
 }else{
  if(port!==0||lanPort!==0)throw TypeError('fixture只能使用两个临时端口');
 }
 if(classify!==undefined&&typeof classify!=='function')throw TypeError('分类器必须是可信内部函数');
 return {port,lanPort,fixtureRoot,classify};
}
function validateStopOptions(options){
 if(options===null||typeof options!=='object'||Array.isArray(options))throw TypeError('停止参数无效');
 for(const key of Object.keys(options))if(!ALLOWED_STOP_KEYS.has(key))throw TypeError('停止不接受额外参数');
 if(typeof options.nonce!=='string'||!isUuid(options.nonce))throw TypeError('停止凭据无效');
 return {fixtureRoot:options.fixtureRoot,nonce:options.nonce};
}
function rejectPathText(value,label){
 if(typeof value!=='string'||!value)throw Error(label+'无效');
 if(!path.isAbsolute(value))throw Error(label+'必须是绝对路径');
 if(value[0]===path.sep||value[0]==='/'||value[1]===path.sep||value[1]==='/')throw Error(label+'不能是UNC路径');
 for(let index=0;index<value.length;index++)if(value.charCodeAt(index)<32)throw Error(label+'包含控制字符');
 const parsed=path.parse(value);
 if(parsed.root.length<3||parsed.root[1]!==':')throw Error(label+'必须是盘符绝对路径');
 const rest=value.slice(parsed.root.length);
 if(rest.includes(':'))throw Error(label+'不能包含备用数据流');
 if(path.normalize(value)!==value)throw Error(label+'必须是规范路径');
}
function assertFixtureRoot(value){
 rejectPathText(value,'fixtureRoot');
 const lexicalBase=path.resolve(FIXTURE_BASE).toLowerCase();
 const lexicalTarget=path.resolve(value).toLowerCase();
 const lexicalRelative=path.relative(lexicalBase,lexicalTarget);
 if(!lexicalRelative||lexicalRelative==='..'||lexicalRelative.startsWith('..'+path.sep)||path.isAbsolute(lexicalRelative))throw Error('受检fixture必须位于固定测试目录内');
 if(lexicalRelative.includes(path.sep)||lexicalRelative.includes('/'))throw Error('受检fixture必须是测试目录下的新子目录');
 let baseReal;
 try{baseReal=fsSync.realpathSync.native(FIXTURE_BASE);}catch{throw Error('受检fixture根目录尚未建立');}
 const baseStat=fsSync.lstatSync(baseReal);
 if(!baseStat.isDirectory()||baseStat.isSymbolicLink())throw Error('受检fixture基础目录无效');
 if(path.resolve(baseReal)!==path.resolve(FIXTURE_BASE))throw Error('受检fixture基础目录不是规范路径');
 let rootStat;
 try{rootStat=fsSync.lstatSync(value);}catch{throw Error('受检fixture目录必须已经存在');}
 if(!rootStat.isDirectory()||rootStat.isSymbolicLink())throw Error('受检fixture目录无效');
 const rootReal=fsSync.realpathSync.native(value);
 if(path.resolve(rootReal)!==path.resolve(value))throw Error('受检fixture不能使用大小写或短名别名');
 const relative=path.relative(baseReal,rootReal);
 if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('受检fixture必须位于固定测试目录内');
 if(relative.includes(path.sep)||relative.includes('/'))throw Error('受检fixture必须是测试目录下的新子目录');
 const identity=fsSync.statSync(rootReal,{bigint:true});
 const baseIdentity=fsSync.statSync(baseReal,{bigint:true});
 if(identity.dev===baseIdentity.dev&&identity.ino===baseIdentity.ino)throw Error('受检fixture不能是测试基础目录');
 return {root:rootReal,base:baseReal};
}
async function readJsonIfExists(file,max,guard,label){
 const full=guard.check(file);
 let stat;
 try{stat=await fs.lstat(full);}catch(error){if(error.code==='ENOENT')return null;throw error;}
 if(stat.isSymbolicLink()||!stat.isFile()||stat.nlink!==1||stat.size<1||stat.size>max)throw Error(label+'无效');
 let handle=null;
 let text;
 try{
  handle=await fs.open(full,'r');
  const opened=await handle.stat();
  if(!opened.isFile()||opened.nlink!==1||opened.size<1||opened.size>max)throw Error(label+'无效');
  const bytes=await handle.readFile();
  if(bytes.length<1||bytes.length>max)throw Error(label+'无效');
  text=bytes.toString('utf8');
 }catch(error){
  if(error.code==='ENOENT')return null;
  if(error.message===label+'无效')throw error;
  throw Error(label+'无效');
 }finally{if(handle)await handle.close().catch(()=>{});}
 guard.check(full);
 let value;
 try{value=JSON.parse(text);}catch{throw Error(label+'无效');}
 if(value===null||typeof value!=='object')throw Error(label+'无效');
 return value;
}
async function writeJsonAtomic(file,value,{guard,max=8192,label='私有记录',mustNotExist=false,validateExisting}={}){
 const target=guard.check(file);
 const dir=path.dirname(target);
 const text=JSON.stringify(value);
 if(typeof text!=='string'||Buffer.byteLength(text)>max)throw Error(label+'过大');
 let prior=null;
 try{prior=await fs.lstat(target);}catch(error){if(error.code!=='ENOENT')throw error;}
 if(prior){
  if(mustNotExist)throw Error(label+'已存在');
  if(prior.isSymbolicLink()||!prior.isFile()||prior.nlink!==1)throw Error(label+'目标无效');
  const old=await readJsonIfExists(target,max,guard,label);
  if(old===null)throw Error(label+'目标无效');
  if(validateExisting)await validateExisting(old);
 }
 const temp=path.join(dir,'.'+path.basename(target)+'.'+randomUUID()+'.tmp');
 let handle=null;
 let created=false;
 try{
  handle=await fs.open(temp,'wx',0o600);
  created=true;
  await handle.writeFile(text);
  await handle.sync();
  await handle.close();
  handle=null;
  guard.check(temp);
  if(prior){
   const now=await fs.lstat(target);
   if(now.dev!==prior.dev||now.ino!==prior.ino||now.isSymbolicLink()||!now.isFile()||now.nlink!==1)throw Error(label+'目标已变化');
  }else{
   try{await fs.lstat(target);throw Error(label+'目标已出现');}catch(error){if(error.code!=='ENOENT')throw error;}
  }
  await fs.rename(temp,target);
  created=false;
  guard.check(target);
  return target;
 }finally{
  if(handle)await handle.close().catch(()=>{});
  if(created)try{await fs.unlink(temp);}catch{}
 }
}
async function ensureOwnedDirectory(directory,guard){
 const full=guard.check(directory);
 let stat=null;
 try{stat=await fs.lstat(full);}catch(error){if(error.code!=='ENOENT')throw error;}
 if(stat){
  if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('私有目录无效');
 }else{
  await fs.mkdir(full,{recursive:true,mode:0o700});
 }
 const after=await fs.lstat(full);
 if(after.isSymbolicLink()||!after.isDirectory())throw Error('私有目录无效');
 return guard.check(full);
}
async function acquireOwnerClaim(home,guard,nonce){
 const file=guard.check(path.join(home,OWNER_CLAIM_NAME));
 let prior=null;
 try{prior=await fs.lstat(file);}catch(error){if(error.code!=='ENOENT')throw error;}
 if(prior)throw Error('候选占用声明已存在，未知现场保留，需受检恢复；不自动接管');
 const value={kind:OWNER_CLAIM_KIND,version:1,pid:process.pid,nonce};
 let handle=null;
 let claim=null;
 try{
  handle=await fs.open(file,'wx',0o600);
  const opened=await handle.stat({bigint:true});
  claim={file,dev:opened.dev,ino:opened.ino,nonce};
  await handle.writeFile(JSON.stringify(value));
  await handle.sync();
  await handle.close();
  handle=null;
  const now=await fs.lstat(file,{bigint:true});
  if(now.isSymbolicLink()||!now.isFile()||now.nlink!==1n||now.dev!==opened.dev||now.ino!==opened.ino)throw Error('候选占用声明写入未完成，未知现场保留，需受检恢复');
  return claim;
 }catch(error){
  if(handle)await handle.close().catch(()=>{});
  let released=false;
  if(claim)try{await releaseOwnerClaim(claim,guard);released=true;}catch{}
  if(!released&&error&&typeof error==='object'&&error.message!=='候选占用声明写入未完成，未知现场保留，需受检恢复')error.message='候选占用声明写入未完成，未知现场保留，需受检恢复';
  throw error;
 }
}
async function releaseOwnerClaim(claim,guard){
 if(!claim)return;
 const file=guard.check(claim.file);
 const stat=await fs.lstat(file,{bigint:true}).catch(()=>null);
 if(!stat||stat.isSymbolicLink()||!stat.isFile()||stat.nlink!==1n||stat.dev!==claim.dev||stat.ino!==claim.ino)throw Error('候选占用声明已被替换，未知现场保留，需受检恢复');
 const record=await readJsonIfExists(file,4096,guard,'候选占用声明');
 if(!record||record.kind!==OWNER_CLAIM_KIND||record.version!==1||record.nonce!==claim.nonce||record.pid!==process.pid)throw Error('候选占用声明凭据不匹配，未知现场保留，需受检恢复');
 await fs.unlink(file);
}
async function assertNoActiveInstance(home,guard){
 const file=path.join(home,INSTANCE_NAME);
 const record=await readJsonIfExists(file,8192,guard,'候选实例记录');
 if(!record)return;
 if(record.kind!==INSTANCE_KIND||typeof record.nonce!=='string'||!isUuid(record.nonce))throw Error('已有候选实例记录无效');
 if(record.state==='close_failed')throw Error('上次关闭未完成（close_failed），未知现场保留，需受检恢复；不自动接管');
 if(record.state!=='closed')throw Error('候选实例已经运行，拒绝双owner');
}
async function validateMainSystem({mainDataRoot,accountsFile,guard}){
 const main=guard.check(mainDataRoot);
 const marker=await readJsonIfExists(path.join(main,'synthetic-candidate.json'),4096,guard,'主系统候选标记');
 if(!marker)throw Error('主系统候选标记缺失，拒绝启动');
 if(marker.kind!==MAIN_KIND||marker.synthetic!==true)throw Error('主系统候选标记无效，拒绝启动');
 const database=path.join(main,'jewelry.sqlite');
 guard.check(database);
 let handle=null;
 try{
  handle=await fs.open(database,'r');
  const stat=await handle.stat();
  if(!stat.isFile()||stat.nlink!==1||stat.size<16)throw Error('主系统业务数据库无效');
  const header=Buffer.alloc(16);
  const read=await handle.read(header,0,16,0);
  if(read.bytesRead!==16||!header.equals(Buffer.from([0x53,0x51,0x4c,0x69,0x74,0x65,0x20,0x66,0x6f,0x72,0x6d,0x61,0x74,0x20,0x33,0x00])))throw Error('主系统业务数据库无效');
 }catch(error){
  if(error.message==='主系统业务数据库无效')throw error;
  throw Error('主系统业务数据库无效');
 }finally{if(handle)await handle.close().catch(()=>{});}
 guard.check(database);
 const accounts=await readJsonIfExists(accountsFile,65536,guard,'主系统候选账号文件');
 if(!accounts)throw Error('主系统候选账号文件缺失，拒绝启动');
 if(!Array.isArray(accounts)||accounts.length!==EXPECTED_ACCOUNTS.length)throw Error('主系统候选账号文件无效');
 const found=new Map();
 for(const account of accounts){
  if(!account||typeof account!=='object'||typeof account.username!=='string')throw Error('主系统候选账号文件无效');
  if(found.has(account.username))throw Error('主系统候选账号文件无效');
  found.set(account.username,account);
 }
 for(const entry of EXPECTED_ACCOUNTS){
  const account=found.get(entry[0]);
  if(!account||account.role!==entry[1]||account.level!==entry[2])throw Error('主系统候选账号文件无效');
  if(typeof account.password!=='string'||account.password.length<24||account.password.length>512)throw Error('主系统候选账号文件无效');
 }
 return {main,accounts,admin:found.get('main_admin')};
}
async function prepareProfileHome({home,mainDataRoot,profileRoot,guard}){
 await ensureOwnedDirectory(home,guard);
 const entries=await fs.readdir(home);
 for(const name of entries)if(!ALLOWED_HOME.has(name))throw Error('素材候选私有目录包含未知内容');
 const markerFile=path.join(home,MARKER_NAME);
 const marker=await readJsonIfExists(markerFile,4096,guard,'素材候选标记');
 if(marker){
  if(marker.kind!==MARKER_KIND||marker.version!==1||marker.synthetic!==true||!samePath(marker.mainDataRoot,mainDataRoot)||!samePath(marker.profileRoot,profileRoot))throw Error('素材候选标记不匹配');
 }else{
  if(entries.length!==0)throw Error('素材候选私有目录非空，拒绝写入标记');
  const value={kind:MARKER_KIND,version:1,synthetic:true,mainDataRoot:path.resolve(mainDataRoot),profileRoot:path.resolve(profileRoot)};
  await writeJsonAtomic(markerFile,value,{guard,max:4096,label:'素材候选标记',mustNotExist:true});
 }
 for(const name of [INSTANCE_NAME,CONNECTION_NAME,IDENTITY_NAME,STOP_NAME,OWNER_CLAIM_NAME]){
  const file=path.join(home,name);
  try{
   const stat=await fs.lstat(file);
   if(stat.isSymbolicLink()||!stat.isFile()||stat.nlink!==1)throw Error('素材候选私有文件无效');
  }catch(error){if(error.code!=='ENOENT')throw error;}
 }
 for(const name of [PROFILE_DIR_NAME,'logs']){
  const dir=path.join(home,name);
  try{
   const stat=await fs.lstat(dir);
   if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('素材候选私有目录无效');
  }catch(error){if(error.code!=='ENOENT')throw error;}
 }
 guard.check(markerFile);
 return {markerFile};
}
async function collectSourceHashes(guard){
 const result={};
 for(const [name,relative] of SOURCE_FILES){
  const file=guard.check(path.join(candidateRoot,relative));
  const stat=await fs.lstat(file);
  if(stat.isSymbolicLink()||!stat.isFile()||stat.nlink!==1||stat.size<1||stat.size>8*1024*1024)throw Error('候选公开源码文件无效');
  const bytes=await fs.readFile(file);
  if(bytes.length<1||bytes.length>8*1024*1024)throw Error('候选公开源码文件无效');
  result[name]=createHash('sha256').update(bytes).digest('hex');
 }
 return result;
}
function listenOn(server,port){
 return new Promise((resolve,reject)=>{
  let settled=false;
  const cleanup=()=>{server.off('error',onError);server.off('listening',onListening);};
  const onError=error=>{if(settled)return;settled=true;cleanup();reject(error);};
  const onListening=()=>{if(settled)return;settled=true;cleanup();resolve();};
  server.once('error',onError);
  server.once('listening',onListening);
  try{server.listen({port,host:'127.0.0.1',exclusive:true});}catch(error){onError(error);}
 });
}
function closeServer(server){
 return new Promise((resolve,reject)=>{
  if(!server||!server.listening){resolve();return;}
  let done=false;
  const finish=error=>{if(done)return;done=true;error?reject(error):resolve();};
  try{
   server.close(error=>finish(error||null));
   if(typeof server.closeIdleConnections==='function')server.closeIdleConnections();
  }catch(error){finish(error);}
 });
}
async function reservePorts(httpPort,lanPort){
 const server=http.createServer();
 try{await listenOn(server,httpPort);}catch(error){await closeServer(server).catch(()=>{});throw error;}
 server.on('error',()=>{});
 let tcp=null;
 try{
  tcp=net.createServer(socket=>socket.destroy());
  await listenOn(tcp,lanPort);
  tcp.on('error',()=>{});
 }catch(error){await closeServer(tcp).catch(()=>{});await closeServer(server).catch(()=>{});throw error;}
 const actualHttp=server.address().port;
 const actualLan=tcp.address().port;
 if(actualHttp===actualLan||actualHttp===31831||actualLan===31831){await closeServer(tcp);await closeServer(server);throw Error('候选端口不可使用31831或重复端口');}
 return {server,httpPort:actualHttp,lanPort:actualLan,lanReservation:{server:tcp,port:actualLan}};
}
async function assertProfileStorage(profileRoot,guard){
 const full=guard.check(profileRoot);
 const stat=await fs.lstat(full);
 if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('素材存储根目录无效');
 guard.check(full);
 return full;
}
async function writeConnection(file,lan,guard){
 if(!lan||!Number.isInteger(lan.port)||!isCode(lan.code))throw Error('局域网连接信息无效');
 const value={host:'127.0.0.1',port:lan.port,code:lan.code};
 await writeJsonAtomic(file,value,{guard,max:4096,label:'局域网连接记录',validateExisting:old=>{
  if(old.host!=='127.0.0.1'||!Number.isInteger(old.port)||!isCode(old.code))throw Error('局域网连接记录无效');
 }});
}
async function writeInstance(file,record,guard){
 await writeJsonAtomic(file,record,{guard,max:8192,label:'候选实例记录',validateExisting:old=>{
  if(!old||old.kind!==INSTANCE_KIND||typeof old.nonce!=='string'||!isUuid(old.nonce))throw Error('候选实例记录无效');
  if(old.state!=='closed'&&old.nonce!==record.nonce)throw Error('候选实例已经运行，拒绝双owner');
 }});
}
async function loginRootAdmin(backend,account){
 try{await backend.auth.login({username:account.username,password:account.password});}
 catch{try{await backend.auth.logout();}catch{}throw Error('主系统管理员登录未通过');}
 const status=backend.auth.status();
 if(!status||status.authenticated!==true||status.user?.role!=='admin'){try{await backend.auth.logout();}catch{}throw Error('主系统管理员登录未通过');}
}
async function logoutRootAdmin(backend){
 await backend.auth.logout();
 const status=backend.auth.status();
 if(status&&status.authenticated===true)throw Error('主系统管理员会话未退出');
}
async function withRootAdmin(backend,account,action){
 await loginRootAdmin(backend,account);
 let result;
 let actionError;
 try{result=await action();}catch(error){actionError=error;}
 let logoutError;
 try{await logoutRootAdmin(backend);}catch(error){logoutError=error;}
 if(actionError){
  if(logoutError&&typeof actionError==='object')actionError.logoutError=logoutError.message;
  throw actionError;
 }
 if(logoutError)throw logoutError;
 return result;
}
export async function startProfileMaterialsCandidate(options={}){
 const {port,lanPort,fixtureRoot,classify}=validateStartOptions(options);
 assertFixedCandidateRoot();
 const fixtureInfo=fixtureRoot===undefined?null:assertFixtureRoot(fixtureRoot);
 const guard=createOwnedPathGuard(candidateRoot);
 const profileHome=fixtureInfo?path.join(fixtureInfo.root,PROFILE_HOME_NAME):DEMO_PROFILE_HOME;
 const profileRoot=path.join(profileHome,PROFILE_DIR_NAME);
 const mainDataRoot=fixtureInfo?path.join(fixtureInfo.root,'main-data'):path.join(candidateRoot,'runtime','main-data');
 const accountsFile=fixtureInfo?path.join(fixtureInfo.root,'main-candidate-accounts.json'):path.join(candidateRoot,'runtime','main-candidate-accounts.json');
 const instanceFile=path.join(profileHome,INSTANCE_NAME);
 const connectionFile=path.join(profileHome,CONNECTION_NAME);
 let httpServer=null;
 let lanReservation=null;
 let backend=null;
 let suite=null;
 let gateway=null;
 let lan=null;
 let ownerClaim=null;
 let httpPort=0;
 let record=null;
 let closing=null;
 let stopTimer=null;
 let stopChecking=false;
 let state='starting';
 const nonce=randomUUID();
 let stoppedResolve,stoppedReject;
 const stopped=new Promise((resolve,reject)=>{stoppedResolve=resolve;stoppedReject=reject;});
 stopped.catch(()=>{});
 async function close(){
  if(closing)return closing;
  closing=(async()=>{
   state='closing';
   if(record)record.state='closing';
   if(stopTimer){clearInterval(stopTimer);stopTimer=null;}
   const errors=[];
   const attempt=async action=>{try{await action();}catch(error){errors.push(error);}};
   const httpClosing=closeServer(httpServer);
   httpClosing.catch(()=>{});
   await attempt(()=>gateway&&typeof gateway.stopAccepting==='function'?gateway.stopAccepting():undefined);
   await attempt(()=>gateway?gateway.close():undefined);
   await attempt(()=>lan?lan.stop():undefined);
   await attempt(()=>suite?suite.close():undefined);
   await attempt(()=>backend?backend.close():undefined);
   if(lanReservation){
    const reservation=lanReservation;
    try{await closeServer(reservation.server);lanReservation=null;}catch(error){errors.push(error);}
   }
   await attempt(()=>httpClosing);
   if(record){
    record.state=errors.length?'close_failed':'closed';
    await attempt(()=>writeInstance(instanceFile,record,guard));
   }
   if(!errors.length&&ownerClaim){
    const claim=ownerClaim;
    await attempt(()=>releaseOwnerClaim(claim,guard));
    if(!errors.length)ownerClaim=null;
   }
   if(errors.length&&record&&record.state!=='close_failed'){
    record.state='close_failed';
    await attempt(()=>writeInstance(instanceFile,record,guard));
   }
   if(errors.length){
    state='close_failed';
    const failure=new AggregateError(errors,'素材候选未能完整关闭');
    stoppedReject(failure);
    throw failure;
   }
   state='closed';
   stoppedResolve();
  })();
  return closing;
 }
 try{
  const reserved=await reservePorts(port,lanPort);
  httpServer=reserved.server;
  lanReservation=reserved.lanReservation;
  httpPort=reserved.httpPort;
  const reservedLanPort=reserved.lanPort;
  if(!Number.isInteger(reservedLanPort)||reservedLanPort<1||reservedLanPort>65535||reservedLanPort===31831)throw Error('候选局域网端口无效');
  const origin='http://127.0.0.1:'+httpPort;
  await prepareProfileHome({home:profileHome,mainDataRoot,profileRoot,guard});
  ownerClaim=await acquireOwnerClaim(profileHome,guard,nonce);
  await assertNoActiveInstance(profileHome,guard);
  const mainInfo=await validateMainSystem({mainDataRoot,accountsFile,guard});
  const logDir=path.join(profileHome,'logs');
  await ensureOwnedDirectory(logDir,guard);
  backend=createBackend({dataDir:mainInfo.main,migrationDir:MIGRATION_DIR});
  const authStatus=backend.auth.status();
  if(!authStatus||authStatus.needsSetup!==false)throw Error('主系统尚未完成初始化，拒绝启动');
  if(authStatus.authenticated===true)throw Error('主系统候选后台不得携带登录会话');
  const suiteOptions={origin,dataRoot:profileRoot};
  if(classify!==undefined)suiteOptions.classify=classify;
  suite=await createMaterialRuntimeSuite(suiteOptions);
  await assertProfileStorage(profileRoot,guard);
  const sourceHashes=await collectSourceHashes(guard);
  gateway=createGateway({backend,server:httpServer,root:candidateRoot,appVersion:'1.7.0',allowLocalControls:false,sessionCookiePrefix:'xjy_profile_candidate_20261024',logDir,materialsHandler:suite.handle});
  const identityFile=path.join(profileHome,IDENTITY_NAME);
  const identity=await readJsonIfExists(identityFile,8192,guard,'局域网身份文件');
  await withRootAdmin(backend,mainInfo.admin,async()=>{
   if(lanReservation){const reservation=lanReservation;await closeServer(reservation.server);lanReservation=null;}
   lan=await startLanServer({backend,host:'127.0.0.1',port:reservedLanPort,identityFile,identity:identity??undefined,materialsHandler:suite.sessionRequest});
  });
  if(!lan||lan.port!==reservedLanPort)throw Error('局域网端口未能正常绑定');
  if(!isCode(lan.code))throw Error('局域网连接码无效');
  await writeConnection(connectionFile,lan,guard);
  record={kind:INSTANCE_KIND,pid:process.pid,nonce,origin,lanPort:lan.port,state:'ready',startedAt:new Date().toISOString(),sourceHashes,sourceHashesScope:SOURCE_HASH_SCOPE,productionConnected:false,mainSystemSession:true};
  await writeInstance(instanceFile,record,guard);
  state='ready';
  stopTimer=setInterval(()=>{
   if(state!=='ready'||stopChecking)return;
   stopChecking=true;
   (async()=>{
    const request=await readJsonIfExists(path.join(profileHome,STOP_NAME),4096,guard,'候选停止请求');
    if(request&&request.kind===STOP_KIND&&typeof request.nonce==='string'&&sameSecret(request.nonce,nonce))await close();
   })().catch(()=>{}).finally(()=>{stopChecking=false;});
  },200);
  if(stopTimer.unref)stopTimer.unref();
  return Object.freeze({origin,lanPort:lan.port,profileRoot,instance:record,instanceFile,connectionFile,backend,close,stopped});
 }catch(error){
  try{await close();}catch(cleanup){if(error&&typeof error==='object')error.cleanupError=cleanup.message;}
  throw error;
 }
}
export async function requestProfileCandidateStop(options={}){
 const {fixtureRoot,nonce}=validateStopOptions(options);
 assertFixedCandidateRoot();
 const fixtureInfo=fixtureRoot===undefined?null:assertFixtureRoot(fixtureRoot);
 const guard=createOwnedPathGuard(candidateRoot);
 const home=fixtureInfo?path.join(fixtureInfo.root,PROFILE_HOME_NAME):DEMO_PROFILE_HOME;
 const fullHome=guard.check(home);
 let stat;
 try{stat=await fs.lstat(fullHome);}catch{throw Error('素材候选实例不存在');}
 if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('素材候选实例不存在');
 const instanceFile=path.join(fullHome,INSTANCE_NAME);
 const record=await readJsonIfExists(instanceFile,8192,guard,'候选实例记录');
 if(!record)throw Error('素材候选实例不存在');
 if(record.kind!==INSTANCE_KIND||typeof record.nonce!=='string'||!isUuid(record.nonce))throw Error('候选实例记录无效');
 if(!sameSecret(record.nonce,nonce))throw Error('停止凭据不匹配');
 if(record.state==='close_failed')throw Error('上次关闭未完成（close_failed），未知现场保留，需受检恢复；本次不写停止请求');
 if(record.state==='closed')return {accepted:true,state:'closed'};
 const request={kind:STOP_KIND,nonce,requestedAt:new Date().toISOString()};
 await writeJsonAtomic(path.join(fullHome,STOP_NAME),request,{guard,max:4096,label:'候选停止请求',validateExisting:old=>{
  if(!old||old.kind!==STOP_KIND||typeof old.nonce!=='string'||!isUuid(old.nonce))throw Error('候选停止请求无效');
 }});
 return {accepted:true,state:'requested'};
}
async function hashFile(file){
 const hash=createHash('sha256');
 const stream=fsSync.createReadStream(file);
 for await(const chunk of stream)hash.update(chunk);
 return hash.digest('hex');
}
async function verifyFixedNode(){
 let stat;
 try{stat=await fs.lstat(FIXED_NODE);}catch{throw Error('固定Node运行时缺失，拒绝启动');}
 if(stat.isSymbolicLink()||!stat.isFile()||stat.nlink!==1)throw Error('固定Node运行时无效');
 const digest=await hashFile(FIXED_NODE);
 if(digest.toUpperCase()!==NODE_SHA)throw Error('固定Node运行时校验失败，拒绝启动');
}
const CANCEL_WAIT_MS=5000;
const ADOPT_ACK_MS=5000;
const LAUNCH_OPTION_KEYS=new Set(['open','fixtureRoot','readyTimeoutMs','leaseMs','openerTimeoutMs','afterSpawn','beforeAdopt']);
function waitExit(child,timeoutMs){
 return new Promise(resolve=>{
  if(!child||child.exitCode!==null||child.signalCode!==null)return resolve(true);
  let done=false;
  const finish=value=>{if(done)return;done=true;clearTimeout(timer);child.off('exit',onExit);child.off('close',onClose);resolve(value);};
  const timer=setTimeout(()=>finish(false),timeoutMs);
  function onExit(){finish(true);}
  function onClose(){finish(true);}
  child.once('exit',onExit);
  child.once('close',onClose);
 });
}
function isLoopbackOrigin(origin){
 if(typeof origin!=='string'||!origin.startsWith('http://127.0.0.1:'))return false;
 const portText=origin.slice('http://127.0.0.1:'.length);
 if(!/^[1-9][0-9]{0,4}$/.test(portText))return false;
 const port=Number(portText);
 return port>=1&&port<=65535&&port!==31831;
}
async function spawnCandidateChild({fixtureRoot,guard}){
 const logDir=guard.check(fixtureRoot?path.join(fixtureRoot,'profile-candidate-launch-logs'):path.join(candidateRoot,'runtime','logs'));
 await ensureOwnedDirectory(logDir,guard);
 const tmpDir=guard.check(fixtureRoot?path.join(fixtureRoot,'profile-candidate-launch-tmp'):path.join(candidateRoot,'runtime','tmp'));
 await ensureOwnedDirectory(tmpDir,guard);
 const stamp=Date.now()+'-'+randomUUID();
 const env={};
 for(const key of ['SystemRoot','SYSTEMROOT','WINDIR','SystemDrive','ComSpec','COMSPEC','PATH','Path','PATHEXT','USERPROFILE','APPDATA','LOCALAPPDATA','PROGRAMDATA','HOMEDRIVE','HOMEPATH','USERNAME','COMPUTERNAME'])if(typeof process.env[key]==='string')env[key]=process.env[key];
 env.TEMP=tmpDir;
 env.TMP=tmpDir;
 let outHandle=null,errHandle=null,child=null;
 try{
  outHandle=await fs.open(guard.check(path.join(logDir,'owned-child-'+stamp+'.stdout.log')),'wx',0o600);
  errHandle=await fs.open(guard.check(path.join(logDir,'owned-child-'+stamp+'.stderr.log')),'wx',0o600);
  child=spawn(FIXED_NODE,[path.join(candidateRoot,'start-profile-candidate.mjs'),WORKER_FLAG],{cwd:candidateRoot,env,windowsHide:true,detached:true,shell:false,stdio:['ignore',outHandle.fd,errHandle.fd,'ipc']});
  if(child)child.once('error',()=>{});
  if(!child||!Number.isSafeInteger(child.pid)||child.pid<=0)throw Error('无法确认新素材候选进程身份');
  if(child.unref)child.unref();
  return child;
 }finally{
  if(outHandle)await outHandle.close().catch(()=>{});
  if(errHandle)await errHandle.close().catch(()=>{});
 }
}
async function openFixedOrigin(origin,timeoutMs){
 if(!isLoopbackOrigin(origin))throw Error('固定页面地址无效');
 const systemRoot=[process.env.SystemRoot,process.env.SYSTEMROOT,process.env.WINDIR].find(value=>typeof value==='string'&&value.length>=3&&value[1]===':'&&(value.charCodeAt(2)===92||value.charCodeAt(2)===47));
 if(!systemRoot)throw Error('系统目录无效，无法打开固定页面');
 const executable=path.join(systemRoot,'System32','rundll32.exe');
 let stat=null;
 try{stat=await fs.lstat(executable);}catch{throw Error('系统页面打开程序缺失');}
 if(stat.isSymbolicLink()||!stat.isFile())throw Error('系统页面打开程序无效');
 let opener=null;
 try{opener=spawn(executable,['url.dll,FileProtocolHandler',origin],{windowsHide:true,detached:false,stdio:'ignore',shell:false});}catch{throw Error('固定页面打开请求失败');}
 if(opener)opener.on('error',()=>{});
 if(!opener||!Number.isSafeInteger(opener.pid)||opener.pid<=0)throw Error('固定页面打开请求失败');
 if(opener.unref)opener.unref();
 const opened=await new Promise(resolve=>{
  let done=false;
  const timer=setTimeout(()=>finish(Error('固定页面打开请求未在限时内确认')),timeoutMs);
  function finish(error){
   if(done)return;done=true;clearTimeout(timer);
   opener.off('spawn',onSpawn);opener.off('error',onError);
   resolve(error?{error}:{ok:true});
  }
  function onSpawn(){finish(null);}
  function onError(error){finish(error instanceof Error?error:Error('固定页面打开请求失败'));}
  opener.once('spawn',onSpawn);
  opener.once('error',onError);
 });
 if(opened.error)throw opened.error;
 return true;
}
export async function launchProfileMaterialsCandidate(options={}){
 if(options===null||typeof options!=='object'||Array.isArray(options))throw TypeError('素材候选启动参数无效');
 for(const key of Object.keys(options))if(!LAUNCH_OPTION_KEYS.has(key))throw TypeError('素材候选启动不接受额外参数');
 assertFixedCandidateRoot();
 const fixtureInfo=options.fixtureRoot===undefined?null:assertFixtureRoot(options.fixtureRoot);
 const open=options.open===undefined?false:options.open;
 if(typeof open!=='boolean')throw TypeError('素材候选打开选项无效');
 const boundedValue=(value,fallback,min,max,label)=>{if(value===undefined)return fallback;if(!fixtureInfo)throw TypeError(label+'只能用于受检fixture');if(!Number.isInteger(value)||value<min||value>max)throw TypeError(label+'无效');return value;};
 const readyTimeoutMs=boundedValue(options.readyTimeoutMs,30000,1,30000,'就绪等待');
 const leaseMs=boundedValue(options.leaseMs,60000,100,60000,'父进程租约');
 const openerTimeoutMs=boundedValue(options.openerTimeoutMs,5000,10,10000,'页面打开等待');
 for(const hook of ['afterSpawn','beforeAdopt'])if(options[hook]!==undefined&&typeof options[hook]!=='function')throw TypeError('可信内部钩子无效');
 if(!fixtureInfo&&(options.afterSpawn!==undefined||options.beforeAdopt!==undefined))throw TypeError('内部钩子只能用于受检fixture');
 assertFixedCandidateRoot();
 await verifyFixedNode();
 const guard=createOwnedPathGuard(candidateRoot);
 const home=guard.check(fixtureInfo?path.join(fixtureInfo.root,PROFILE_HOME_NAME):DEMO_PROFILE_HOME);
 const instanceFile=path.join(home,INSTANCE_NAME);
 const prior=await readJsonIfExists(instanceFile,8192,guard,'候选实例记录');
 if(prior){
  if(prior.kind!==INSTANCE_KIND||typeof prior.nonce!=='string'||!isUuid(prior.nonce))throw Error('已有候选实例记录无效，未知现场保留');
  if(prior.state==='close_failed')throw Error('上次关闭未完成（close_failed），未知现场保留，需受检恢复');
  if(prior.state!=='closed')throw Error('已有候选实例正在运行，拒绝复用或覆盖');
 }
 const baseline=await collectSourceHashes(guard);
 const nonce=randomUUID();
 const child=await spawnCandidateChild({fixtureRoot:fixtureInfo?fixtureInfo.root:null,guard});
 let adopted=false;
 let verified=null;
 async function cancel(){
  try{if(child.connected)child.send({type:'cancel',nonce});}catch{}
  const reaped=await waitExit(child,CANCEL_WAIT_MS);
  try{if(child.connected)child.disconnect();}catch{}
  return reaped;
 }
 function boundedHook(action,label,limitMs){
  return new Promise((resolve,reject)=>{
   let done=false;
   const timer=setTimeout(()=>finish(Error(label+'等待超时')),limitMs);
   function onExit(){finish(Error(label+'期间已知自有子进程已退出'));}
   function finish(error,value){
    if(done)return;done=true;clearTimeout(timer);
    child.off('exit',onExit);
    error?reject(error):resolve(value);
   }
   if(child.exitCode!==null||child.signalCode!==null){finish(Error(label+'期间已知自有子进程已退出'));return;}
   child.once('exit',onExit);
   let result;
   try{result=action();}catch(error){finish(error instanceof Error?error:Error(label+'失败'));return;}
   Promise.resolve(result).then(value=>finish(null,value),error=>finish(error instanceof Error?error:Error(label+'失败')));
  });
 }
 try{
  const outcomePromise=new Promise(resolve=>{
   let done=false;
   const timer=setTimeout(()=>finish({kind:'timeout'}),readyTimeoutMs);
   function finish(value){if(done)return;done=true;clearTimeout(timer);child.off('message',onMessage);child.off('exit',onExit);child.off('close',onClose);resolve(value);}
   function onMessage(message){if(message&&typeof message==='object'&&message.nonce===nonce){if(message.type==='ready')return finish({kind:'ready',message});if(message.type==='failed')return finish({kind:'failed'});}}
   function onExit(){finish({kind:'exit'});}
   function onClose(){finish({kind:'exit'});}
   child.on('message',onMessage);
   child.once('exit',onExit);
   child.once('close',onClose);
  });
  let queued=false;
  for(let attempt=0;attempt<100&&!queued;attempt++){
   try{child.send({type:'init',nonce,fixtureRoot:fixtureInfo?fixtureInfo.root:undefined,leaseMs});queued=true;}
   catch{await delay(20);}
  }
  if(!queued)throw Error('无法建立受检私有进程通道');
  if(typeof options.afterSpawn==='function')await boundedHook(()=>options.afterSpawn(Object.freeze({pid:child.pid})),'就绪前钩子',readyTimeoutMs);
  const outcome=await outcomePromise;
  if(outcome.kind==='timeout')throw Error('新素材候选未在限时内完成就绪核验');
  if(outcome.kind==='exit')throw Error('新素材候选在就绪前退出，请核对D盘日志');
  if(outcome.kind==='failed')throw Error('新素材候选启动失败，请核对D盘日志');
  const message=outcome.message;
  if(message.pid!==child.pid||!isUuid(message.instanceNonce)||!isLoopbackOrigin(message.origin)||!Number.isInteger(message.lanPort)||message.lanPort<1||message.lanPort>65535||message.lanPort===31831)throw Error('新素材候选就绪回执无效');
  const record=await readJsonIfExists(instanceFile,8192,guard,'候选实例记录');
  if(!record||record.kind!==INSTANCE_KIND||record.pid!==child.pid||record.nonce!==message.instanceNonce||record.state!=='ready')throw Error('新素材候选实例记录未通过核验');
  if(record.sourceHashesScope!==SOURCE_HASH_SCOPE||record.origin!==message.origin||record.lanPort!==message.lanPort)throw Error('新素材候选实例记录未通过核验');
  if(!record.sourceHashes||typeof record.sourceHashes!=='object'||Array.isArray(record.sourceHashes)||Object.keys(record.sourceHashes).length!==SOURCE_FILES.length)throw Error('新素材候选源码指纹缺失');
  const expected=await collectSourceHashes(guard);
  for(const [name] of SOURCE_FILES)if(record.sourceHashes[name]!==baseline[name]||record.sourceHashes[name]!==expected[name])throw Error('新素材候选源码指纹不匹配');
  verified=record;
  if(typeof options.beforeAdopt==='function')await boundedHook(()=>options.beforeAdopt(Object.freeze({pid:child.pid,nonce:record.nonce,origin:record.origin})),'采纳前钩子',readyTimeoutMs);
  const rechecked=await collectSourceHashes(guard);
  for(const [name] of SOURCE_FILES)if(rechecked[name]!==baseline[name])throw Error('素材候选源码在采纳前发生变化');
  let openRequested=false;
  if(open){await openFixedOrigin(record.origin,openerTimeoutMs);openRequested=true;}
  try{child.send({type:'adopt',nonce});}catch{throw Error('素材候选未能确认父进程采纳');}
  const ack=await new Promise(resolve=>{
   let done=false;
   const timer=setTimeout(()=>finish(false),ADOPT_ACK_MS);
   function finish(value){if(done)return;done=true;clearTimeout(timer);child.off('message',onAdopted);child.off('exit',onExit);resolve(value);}
   function onAdopted(message){if(message&&typeof message==='object'&&message.nonce===nonce&&message.type==='adopted')finish(true);}
   function onExit(){finish(false);}
   child.on('message',onAdopted);
   child.once('exit',onExit);
  });
  if(!ack)throw Error('素材候选未能确认父进程采纳');
  adopted=true;
  try{if(child.connected)child.disconnect();}catch{}
  if(child.unref)child.unref();
  return Object.freeze({kind:INSTANCE_KIND,pid:child.pid,nonce:record.nonce,origin:record.origin,lanPort:record.lanPort,state:'ready',openRequested});
 }catch(error){
  if(!adopted){
   try{
    let reaped=false;
    try{reaped=await cancel();}catch{}
    if(!reaped){
     if(verified){try{await requestProfileCandidateStop({...(fixtureInfo?{fixtureRoot:fixtureInfo.root}:{}),nonce:verified.nonce});}catch{}}
     let reapedByStop=false;
     try{reapedByStop=await waitExit(child,CANCEL_WAIT_MS);}catch{}
     if(!reapedByStop&&error&&typeof error==='object'){
      error.ownerPending=true;
      error.message=error.message+'（自有子进程退出未确认，owner pending，需受检恢复）';
     }
    }
   }catch{}
  }
  throw error;
 }
}
async function launchViaCli(open){
 const receipt=await launchProfileMaterialsCandidate({open});
 console.log(JSON.stringify({origin:receipt.origin,pid:receipt.pid,state:receipt.state,openRequested:receipt.openRequested}));
}
async function stopCandidate(){
 assertFixedCandidateRoot();
 const guard=createOwnedPathGuard(candidateRoot);
 const instanceFile=path.join(DEMO_PROFILE_HOME,INSTANCE_NAME);
 const record=await readJsonIfExists(instanceFile,8192,guard,'候选实例记录');
 if(!record||record.kind!==INSTANCE_KIND||typeof record.nonce!=='string'||!isUuid(record.nonce))throw Error('未找到可停止的素材候选实例');
 if(record.state==='close_failed')throw Error('上次关闭未完成（close_failed），未知现场保留，需受检恢复；本次不发送停止请求');
 if(record.state==='closed'){console.log(JSON.stringify({state:'closed',pid:record.pid}));return;}
 const receipt=await requestProfileCandidateStop({nonce:record.nonce});
 if(receipt.state==='closed'){console.log(JSON.stringify({state:'closed',pid:record.pid}));return;}
 const deadline=Date.now()+15000;
 while(Date.now()<deadline){
  await delay(200);
  let current=null;
  try{current=await readJsonIfExists(instanceFile,8192,guard,'候选实例记录');}catch{current=null;}
  if(current&&current.state==='close_failed')throw Error('候选关闭失败（close_failed），未知现场保留，需受检恢复；不虚报已关闭');
  if(current&&current.nonce===record.nonce&&current.state==='closed'){console.log(JSON.stringify({state:'closed',pid:current.pid}));return;}
 }
 throw Error('停止请求已发送但未在限时内确认关闭');
}
async function runOwnedChild(){
 if(typeof process.send!=='function'||process.connected!==true)throw Error('自有子进程必须由固定启动器通过受检私有通道启动，拒绝独立运行');
 const initKeys=new Set(['type','nonce','fixtureRoot','leaseMs']);
 const init=await new Promise((resolve,reject)=>{
  let done=false;
  const timer=setTimeout(()=>{if(done)return;done=true;cleanup();reject(Error('未收到受检父进程初始化，已退出'));},15000);
  function cleanup(){clearTimeout(timer);process.off('message',onMessage);process.off('disconnect',onDisconnect);}
  function onDisconnect(){if(done)return;done=true;cleanup();reject(Error('父进程在初始化前断开，未启动素材候选'));}
  function onMessage(message){
   if(done||!message||typeof message!=='object'||message.type!=='init')return;
   for(const key of Object.keys(message))if(!initKeys.has(key))return;
   if(typeof message.nonce!=='string'||!isUuid(message.nonce))return;
   done=true;cleanup();resolve(message);
  }
  process.on('message',onMessage);
  process.once('disconnect',onDisconnect);
 });
 const parentNonce=init.nonce;
 let leaseMs=60000;
 if(init.leaseMs!==undefined){if(!Number.isInteger(init.leaseMs)||init.leaseMs<100||init.leaseMs>60000)throw Error('受检父进程租约无效');leaseMs=init.leaseMs;}
 let fixtureRoot;
 if(init.fixtureRoot!==undefined){if(typeof init.fixtureRoot!=='string')throw Error('受检父进程fixture无效');fixtureRoot=assertFixtureRoot(init.fixtureRoot).root;}
 let adopted=false,cancelRequested=false,app=null,leaseTimer=null,closePromise=null;
 function sendMessage(value){try{if(process.connected)process.send(value);}catch{}}
 function clearLease(){if(leaseTimer){clearTimeout(leaseTimer);leaseTimer=null;}}
 async function shutdown(){
  if(closePromise)return closePromise;
  if(app===null){cancelRequested=true;return;}
  closePromise=(async()=>{
   clearLease();
   process.off('message',onControl);
   let outcome='closed';
   try{if(app)await app.close();}catch{outcome='close_failed';}
   sendMessage({type:outcome==='closed'?'stopped':'failed',nonce:parentNonce});
   process.exitCode=outcome==='closed'?0:1;
   try{if(process.connected)process.disconnect();}catch{}
  })();
  return closePromise;
 }
 function requestCancel(){cancelRequested=true;if(app)void shutdown();}
 function onControl(message){
  if(!message||typeof message!=='object'||message.nonce!==parentNonce)return;
  if(message.type==='cancel'&&!adopted)requestCancel();
  else if(message.type==='adopt'&&!adopted&&!cancelRequested&&!closePromise&&app&&app.instance&&app.instance.state==='ready'){
   adopted=true;
   clearLease();
   sendMessage({type:'adopted',nonce:parentNonce});
  }
 }
 process.on('message',onControl);
 process.once('disconnect',()=>{if(!adopted)requestCancel();});
 process.once('SIGINT',()=>{void shutdown();});
 process.once('SIGTERM',()=>{void shutdown();});
 leaseTimer=setTimeout(()=>{if(!adopted)requestCancel();},leaseMs);
 if(leaseTimer.unref)leaseTimer.unref();
 const options=fixtureRoot!==undefined?{port:0,lanPort:0,fixtureRoot}:{};
 try{app=await startProfileMaterialsCandidate(options);}catch(error){clearLease();sendMessage({type:'failed',nonce:parentNonce});throw error;}
 if(cancelRequested){await shutdown();return;}
 sendMessage({type:'ready',nonce:parentNonce,pid:process.pid,instanceNonce:app.instance.nonce,origin:app.origin,lanPort:app.lanPort});
}
async function main(){
 const args=process.argv.slice(2);
 if(args.length===1&&args[0]===WORKER_FLAG){await runOwnedChild();return;}
 if(args.length===0){
  const app=await startProfileMaterialsCandidate();
  const summary={origin:app.origin,lanPort:app.lanPort,profileRoot:app.profileRoot,pid:app.instance.pid,instanceFile:app.instanceFile,connectionFile:app.connectionFile,state:app.instance.state};
  console.log(JSON.stringify(summary));
  let stopping=false;
  const shutdown=()=>{if(stopping)return;stopping=true;app.close().catch(()=>{process.exitCode=1;});};
  process.once('SIGINT',shutdown);
  process.once('SIGTERM',shutdown);
  return;
 }
 if(args.length===1&&args[0]==='--stop'){await stopCandidate();return;}
 if(args.length===1&&args[0]==='--launch'){await launchViaCli(false);return;}
 if(args.length===2&&args[0]==='--launch'&&args[1]==='--open'){await launchViaCli(true);return;}
 throw Error('素材候选不接受路径、账号、端口或回执参数');
}
const invoked=process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href;
if(invoked)main().catch(error=>{console.error(String(error?.message||'素材候选启动失败'));process.exitCode=1;});

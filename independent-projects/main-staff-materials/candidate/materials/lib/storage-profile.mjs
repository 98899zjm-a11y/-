import * as fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {openLibrary} from './library.mjs';

const require=createRequire(import.meta.url);
const {createOwnedPathGuard}=require('../../project/desktop/managed-print-worker.cjs');
const LEAF='销售素材';
const MARKER_NAME='materials-profile.json';
const MARKER_KIND='xjy-sales-materials-profile';
const MARKER_VERSION=1;
const MAX_MARKER_BYTES=4096;
const DB_NAME='library.sqlite';
const SIDECAR_NAMES=new Set([DB_NAME+'-journal',DB_NAME+'-wal',DB_NAME+'-shm']);
const ALLOWED_NAMES=new Set([MARKER_NAME,DB_NAME,...SIDECAR_NAMES,'images']);
const UUID_FILE=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](?:jpg|tmp)$/;
const stores=new WeakMap();

export function verifyProfileStore(token,root){
 const record=typeof token==='object'&&token!==null?stores.get(token):undefined;
 if(!record||record.root!==root)throw new Error('profileStore 能力无效或路径不匹配');
 return record;
}

function plainProfilePath(value){
 if(typeof value!=='string'||!path.isAbsolute(value))throw new Error('素材存储需要普通本机绝对路径');
 if(value.startsWith(path.sep+path.sep))throw new Error('素材存储不接受 UNC 或设备路径');
 for(const ch of value)if(ch.charCodeAt(0)<32)throw new Error('素材存储路径包含控制字符');
 if(path.basename(value)!==LEAF)throw new Error('素材存储目录必须为销售素材');
 if(path.dirname(value)===value)throw new Error('素材存储目录不能是根目录');
 if(process.platform==='win32'&&value.slice(2).includes(':'))throw new Error('素材存储不接受 ADS 或非规范绝对路径');
 const parts=process.platform==='win32'?value.replaceAll('/',path.sep).split(path.sep):value.split(path.sep);
 for(const part of parts){
  if(!part||/^[A-Za-z]:$/.test(part))continue;
  if(part.endsWith('.')||part.endsWith(' '))throw new Error('目录名不能以点或空格结尾');
  if(/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:[.]|$)/i.test(part))throw new Error('目录名无效');
 }
 return path.resolve(value);
}

export async function openProfileLibrary({dataRoot,classify}={}){
 if(classify!==undefined&&typeof classify!=='function')throw new TypeError('classify 必须为可信函数');
 const resolved=plainProfilePath(dataRoot);
 const guard=createOwnedPathGuard(path.dirname(resolved));
 const canonical=guard.check(resolved);
 if(dataRoot!==canonical)throw new Error('销售素材路径必须与主机 guard 检查后的 canonical 绝对路径一致');
 const root=canonical;
 const marker=path.join(root,MARKER_NAME);
 const images=path.join(root,'images');
 const database=path.join(root,DB_NAME);
 const check=target=>guard.check(target);
 async function lstatOrNull(target){
  check(target);
  try{
   const stat=await fs.lstat(target);
   check(target);
   return stat;
  }catch(error){
   if(error.code==='ENOENT'){check(target);return null;}
   throw error;
  }
 }
 async function readdirChecked(target){check(target);const names=await fs.readdir(target);check(target);return names;}
 async function readFileChecked(target){check(target);const bytes=await fs.readFile(target);check(target);return bytes;}
 async function createDirectory(){
  check(root);
  try{await fs.mkdir(root,{mode:0o700});}
  catch(error){if(error.code!=='EEXIST')throw error;}
  finally{check(root);}
 }
 async function writeMarker(payload){
  check(marker);
  const handle=await fs.open(marker,'wx',0o600);
  try{
   check(marker);
   await handle.writeFile(payload,{encoding:'utf8'});
   await handle.sync();
   check(marker);
  }finally{await handle.close();}
  check(marker);
 }
 function validateRegular(stat,label){
  if(stat.isSymbolicLink())throw new Error(label+'不能使用链接');
  if(!stat.isFile())throw new Error(label+'必须是常规文件');
  if(stat.nlink!==1)throw new Error(label+'不能使用硬链接或别名');
 }
 async function validateMarker(stat){
  if(!stat||stat.isSymbolicLink())throw new Error('素材库标记不能使用链接');
  if(!stat.isFile())throw new Error('素材库标记必须是常规文件');
  if(stat.nlink!==1)throw new Error('素材库标记不能使用硬链接或别名');
  if(stat.size<1||stat.size>MAX_MARKER_BYTES)throw new Error('素材库标记大小无效');
  const bytes=await readFileChecked(marker);
  let value;
  try{value=JSON.parse(bytes.toString('utf8'));}
  catch{throw new Error('素材库标记 JSON 格式损坏');}
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('素材库标记格式损坏');
  const keys=Object.keys(value);
  if(keys.length!==3||!keys.includes('kind')||!keys.includes('version')||!keys.includes('dataRoot'))throw new Error('素材库标记包含未知字段');
  if(typeof value.kind!=='string'||value.kind!==MARKER_KIND||!Number.isInteger(value.version)||value.version!==MARKER_VERSION||typeof value.dataRoot!=='string'||value.dataRoot!==root)throw new Error('素材库标记与当前路径绑定不一致');
 }
 async function inspectImages(){
  const stat=await lstatOrNull(images);
  if(!stat)return null;
  if(stat.isSymbolicLink())throw new Error('素材 images 不能使用链接');
  if(!stat.isDirectory())throw new Error('素材 images 必须为目录');
  const names=await readdirChecked(images);
  for(const name of names){
   if(!UUID_FILE.test(name))throw new Error('素材图片目录包含未知文件或别名，已保留拒绝');
   const file=path.join(images,name);
   const info=await lstatOrNull(file);
   if(!info||info.isSymbolicLink())throw new Error('素材图片不能使用链接');
   if(!info.isFile())throw new Error('素材图片目录不能包含子目录');
   if(info.nlink!==1)throw new Error('素材图片不能使用硬链接或别名');
  }
  return names;
 }
 let rootStat=await lstatOrNull(root);
 if(!rootStat){
  await createDirectory();
  rootStat=await lstatOrNull(root);
 }
 if(!rootStat||rootStat.isSymbolicLink()||!rootStat.isDirectory())throw new Error('销售素材根目录无效');
 check(root);
 let markerStat=await lstatOrNull(marker);
 if(!markerStat){
  const names=await readdirChecked(root);
  if(names.length!==0)throw new Error('未标记的素材目录非空，拒绝接管未知数据');
  const payload=JSON.stringify({kind:MARKER_KIND,version:MARKER_VERSION,dataRoot:root});
  if(Buffer.byteLength(payload,'utf8')>MAX_MARKER_BYTES)throw new Error('素材库标记过大');
  await writeMarker(payload);
  markerStat=await lstatOrNull(marker);
 }
 await validateMarker(markerStat);
 const names=await readdirChecked(root);
 for(const name of names){
  if(!ALLOWED_NAMES.has(name))throw new Error('素材目录包含未知目录项，已保留拒绝');
  if(SIDECAR_NAMES.has(name))throw new Error('素材目录可能仍被占用或留有 SQLite 日志/sidecar 现场，已保留拒绝');
 }
 let databaseStat=null;
 if(names.includes(DB_NAME)){
  databaseStat=await lstatOrNull(database);
  if(!databaseStat)throw new Error('素材数据库文件丢失');
  validateRegular(databaseStat,'素材数据库');
 }
 const imageNames=await inspectImages();
 if(databaseStat&&imageNames===null)throw new Error('已有素材数据库缺少 images 目录，已保留拒绝');
 if(!databaseStat&&(imageNames?.length??0)>0)throw new Error('素材数据库丢失但 images 非空，拒绝用空库覆盖失联资料');
 const token=Object.freeze({});
 stores.set(token,Object.freeze({root,guard}));
 return openLibrary({root,classify,profileStore:token});
}

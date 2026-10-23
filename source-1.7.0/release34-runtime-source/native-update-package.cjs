'use strict';
// Native package extractor derived narrowly from employee-update-installer's
// bounded ZIP reader. An independent signed native manifest supplies the exact
// whole-package allowlist. Old resource programPath/policy is never broadened.
const fs=process.versions.electron?require('original-fs').promises:require('node:fs/promises');
const path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const {Readable,Writable}=require('node:stream'),{pipeline}=require('node:stream/promises');
const u=require('./employee-update-cache.cjs'),CHUNK=4194304,UTF8=new TextDecoder('utf8',{fatal:true});
function fail(message){u.fail('BAD_NATIVE_PACKAGE',message);}
function crcStep(crc,bytes){for(const b of bytes){crc^=b;for(let j=0;j<8;j++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return crc>>>0;}
async function dirs(io,root,relative){let p=root;await u.assertPath(io,p,{directory:true});for(const n of relative.split('/').filter(Boolean)){if(!u.safeRelative(n))fail('目录路径不规范');p=path.join(p,n);try{await io.mkdir(p,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}await u.assertPath(io,p,{directory:true,root});}return p;}
async function extractNativePackage({archiveFile,stageRoot,destination,manifest,fileSystem=fs}){
 const io=fileSystem,opened=await u.openChecked(io,archiveFile,'r',{root:stageRoot});
 try{
  const stat=await u.assertHandle(io,opened,{root:stageRoot});
  if(Number(stat.size)!==manifest.archive.size||await u.hashHandle(opened.handle,manifest.archive.size)!==manifest.archive.sha256)fail('完整包摘要不符');
  await u.assertPath(io,destination,{directory:true,root:stageRoot});
  const tail=await u.readExactly(opened.handle,manifest.archive.size-22,22);
  if(tail.readUInt32LE(0)!==0x06054b50||tail.readUInt16LE(4)||tail.readUInt16LE(6)||tail.readUInt16LE(20))fail('仅接受无尾注单卷ZIP');
  const count=tail.readUInt16LE(10),dirSize=tail.readUInt32LE(12),dirAt=tail.readUInt32LE(16);
  if(count!==manifest.files.length||count!==tail.readUInt16LE(8)||dirSize>4194304||dirAt+dirSize!==manifest.archive.size-22)fail('ZIP目录范围不符');
  const central=await u.readExactly(opened.handle,dirAt,dirSize),expected=new Map(manifest.files.map(f=>[f.path,f])),seen=new Set(),ranges=[];let at=0;
  for(let n=0;n<count;n++){
   if(at+46>central.length||central.readUInt32LE(at)!==0x02014b50)fail('ZIP目录截断');
   const flags=central.readUInt16LE(at+8),method=central.readUInt16LE(at+10),crc=central.readUInt32LE(at+16),packed=central.readUInt32LE(at+20),size=central.readUInt32LE(at+24),nameSize=central.readUInt16LE(at+28),extra=central.readUInt16LE(at+30),comment=central.readUInt16LE(at+32),attrs=central.readUInt32LE(at+38),localAt=central.readUInt32LE(at+42),end=at+46+nameSize+extra+comment;
   if(end>central.length||!nameSize||extra||comment||flags&~0x808||![0,8].includes(method)||central.readUInt16LE(at+34)||attrs&0x10||![0,0x8000].includes((attrs>>>16)&0xf000))fail('拒绝目录、链接、加密、ZIP64或未知字段');
   const nameBytes=central.subarray(at+46,at+46+nameSize);let name;try{name=UTF8.decode(nameBytes);}catch{fail('ZIP文件名非UTF8');}
   const row=expected.get(name);if(!row||!u.safeRelative(name)||seen.has(name.toLowerCase())||size!==row.size||localAt+30>dirAt)fail('ZIP不是签名完整包文件集合');
   const local=await u.readExactly(opened.handle,localAt,30),dataAt=localAt+30+local.readUInt16LE(26)+local.readUInt16LE(28);
   if(local.readUInt32LE(0)!==0x04034b50||local.readUInt16LE(28)||local.readUInt16LE(6)!==flags||local.readUInt16LE(8)!==method||local.readUInt16LE(26)!==nameSize||dataAt+packed>dirAt||!(await u.readExactly(opened.handle,localAt+30,nameSize)).equals(nameBytes))fail('本地ZIP头不符');
   if(!(flags&8)&&(local.readUInt32LE(14)!==crc||local.readUInt32LE(18)!==packed||local.readUInt32LE(22)!==size))fail('本地ZIP大小不符');
   if(ranges.some(([a,b])=>localAt<b&&dataAt+packed>a))fail('ZIP文件范围重叠');ranges.push([localAt,dataAt+packed]);seen.add(name.toLowerCase());
   await dirs(io,destination,name.split('/').slice(0,-1).join('/'));
   const target=path.join(destination,...name.split('/')),out=await u.openChecked(io,target,'wx+',{missing:true,root:destination});let length=0,sum=0xffffffff;const hash=crypto.createHash('sha256');
   const sink=new Writable({write(bytes,_enc,done){const pos=length;length+=bytes.length;if(length>row.size)return done(Object.assign(Error('解压超过签名大小'),{code:'BAD_NATIVE_PACKAGE'}));sum=crcStep(sum,bytes);hash.update(bytes);u.writeExactly(out.handle,pos,bytes).then(()=>done(),done);}});
   const input=Readable.from((async function*(){for(let pos=0;pos<packed;pos+=CHUNK)yield await u.readExactly(opened.handle,dataAt+pos,Math.min(CHUNK,packed-pos));})());
   try{if(method===8)await pipeline(input,zlib.createInflateRaw(),sink);else await pipeline(input,sink);if(length!==row.size||hash.digest('hex')!==row.sha256||((sum^0xffffffff)>>>0)!==crc)fail('逐文件摘要或CRC不符');await out.handle.sync();await u.assertHandle(io,out,{snapshot:false,root:destination});}finally{await out.handle.close();}
   at=end;
  }
  if(at!==central.length||seen.size!==expected.size)fail('ZIP目录不完整');await u.assertHandle(io,opened,{root:stageRoot});
  return{verified:true,destination,fileCount:seen.size};
 }finally{await opened.handle.close();}
}
module.exports={extractNativePackage,dirs};

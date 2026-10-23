'use strict';
// Bounded, read-only parsers. Injected byte readers permit pure synthetic tests.
const crypto=require('node:crypto'),{safeRelative}=require('./approval-core-170.cjs');
const UTF8=new TextDecoder('utf8',{fatal:true}),CHUNK=4194304;
function fail(code,message){const e=new Error(message);e.code=code;throw e;}
async function readExact(source,offset,length){if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(length)||offset<0||length<0||offset+length>source.size)fail('BAD_ZIP','读取范围越界。');const b=await source.read(offset,length);if(!Buffer.isBuffer(b)||b.length!==length)fail('INCOMPLETE_FILE','输入文件未完整读取。');return b;}
function crcStep(crc,bytes){for(const byte of bytes){crc^=byte;for(let j=0;j<8;j++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return crc>>>0;}
async function inspectStoredZip(source){
 if(!source||!Number.isSafeInteger(source.size)||source.size<22||source.size>805306368||typeof source.read!=='function')fail('BAD_ZIP','ZIP 大小或读取方式无效。');
 const end=await readExact(source,source.size-22,22);if(end.readUInt32LE(0)!==0x06054b50||end.readUInt16LE(4)!==0||end.readUInt16LE(6)!==0||end.readUInt16LE(20)!==0)fail('BAD_ZIP','仅接受单卷、无尾注的最终 stored ZIP。');
 const count=end.readUInt16LE(10),length=end.readUInt32LE(12),start=end.readUInt32LE(16);if(!count||count>8192||count!==end.readUInt16LE(8)||length<46*count||length>4194304||start+length!==source.size-22)fail('BAD_ZIP','ZIP 中央目录范围或数量无效。');
 const central=await readExact(source,start,length),seen=new Set(),files=[];let cursor=0,nextOffset=0;
 for(let n=0;n<count;n++){
  if(cursor+46>central.length||central.readUInt32LE(cursor)!==0x02014b50)fail('BAD_ZIP','中央目录截断或标记无效。');
  const header=central.subarray(cursor,cursor+46),nameLength=header.readUInt16LE(28),extra=header.readUInt16LE(30),comment=header.readUInt16LE(32),packed=header.readUInt32LE(20),size=header.readUInt32LE(24),offset=header.readUInt32LE(42),crc=header.readUInt32LE(16);
  if(header.readUInt16LE(8)!==0x800||header.readUInt16LE(10)!==0||extra||comment||header.readUInt16LE(34)!==0||header.readUInt16LE(36)!==0||header.readUInt32LE(38)!==0x80000000||!nameLength||nameLength>720||cursor+46+nameLength>central.length||packed!==size||offset!==nextOffset)fail('BAD_ZIP','ZIP 不是受支持的精确普通文件 stored 格式。');
  const nameBytes=central.subarray(cursor+46,cursor+46+nameLength);let name;try{name=UTF8.decode(nameBytes);}catch{fail('UNSAFE_ZIP_PATH','ZIP 文件名不是 UTF8。');}if(!safeRelative(name)||seen.has(name.toLowerCase()))fail('UNSAFE_ZIP_PATH','ZIP 含路径穿越、目录项或大小写重复文件。');seen.add(name.toLowerCase());
  const local=await readExact(source,offset,30);if(local.readUInt32LE(0)!==0x04034b50||local.readUInt16LE(6)!==0x800||local.readUInt16LE(8)!==0||local.readUInt32LE(14)!==crc||local.readUInt32LE(18)!==size||local.readUInt32LE(22)!==size||local.readUInt16LE(26)!==nameLength||local.readUInt16LE(28)!==0)fail('BAD_ZIP','ZIP 本地头与中央目录不一致。');
  const localName=await readExact(source,offset+30,nameLength);if(!localName.equals(nameBytes))fail('BAD_ZIP','ZIP 本地文件名不一致。');const dataOffset=offset+30+nameLength;if(dataOffset+size>start)fail('BAD_ZIP','ZIP 文件重叠或越过中央目录。');
  const h=crypto.createHash('sha256');let sum=0xffffffff;for(let at=0;at<size;at+=CHUNK){const bytes=await readExact(source,dataOffset+at,Math.min(CHUNK,size-at));h.update(bytes);sum=crcStep(sum,bytes);}if(((sum^0xffffffff)>>>0)!==crc)fail('BAD_ZIP_CRC','ZIP 内容 CRC 校验失败。');files.push({path:name,size,sha256:h.digest('hex')});
  nextOffset=dataOffset+size;cursor+=46+nameLength;
 }
 if(cursor!==central.length||nextOffset!==start)fail('BAD_ZIP','ZIP 含额外本地文件、间隙或目录字节。');
 const outer=crypto.createHash('sha256');for(let at=0;at<source.size;at+=CHUNK)outer.update(await readExact(source,at,Math.min(CHUNK,source.size-at)));return{sha256:outer.digest('hex'),files};
}
async function readPackedIdentity(source){
 if(!source||!Number.isSafeInteger(source.size)||source.size<16||source.size>1073741824)fail('BAD_ASAR','ASAR 文件范围无效。');
 const first=await readExact(source,0,8),size=first.readUInt32LE(4);if(first.readUInt32LE(0)!==4||size<8||size>33554432||size+8>source.size)fail('BAD_ASAR','ASAR 头无效。');
 const head=await readExact(source,8,size),jsonSize=head.readUInt32LE(4);if(jsonSize>size-8)fail('BAD_ASAR','ASAR 目录越界。');let tree;try{tree=JSON.parse(UTF8.decode(head.subarray(8,8+jsonSize)));}catch{fail('BAD_ASAR','ASAR 目录无效。');}
 const entry=tree.files?.['package.json'];if(!entry||entry.link||entry.unpacked||typeof entry.offset!=='string'||!/^\d+$/.test(entry.offset)||!Number.isSafeInteger(entry.size)||entry.size<1||entry.size>1048576)fail('BAD_ASAR','package.json 必须是实际 packed 文件。');
 const at=8+size+Number(entry.offset);if(!Number.isSafeInteger(at)||at+entry.size>source.size)fail('BAD_ASAR','package.json 范围无效。');let pkg;try{pkg=JSON.parse(UTF8.decode(await readExact(source,at,entry.size)));}catch{fail('BAD_ASAR','package.json 编码无效。');}return{name:pkg.name,version:pkg.version,main:pkg.main};
}
module.exports={inspectStoredZip,readPackedIdentity};

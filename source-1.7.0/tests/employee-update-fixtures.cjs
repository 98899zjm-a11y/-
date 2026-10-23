'use strict';
const fs = process.versions.electron?require('original-fs').promises:require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto'), zlib = require('node:zlib');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function asar(version,body='toy program bytes'){const pkg=Buffer.from(JSON.stringify({name:'xjy-jewelry-offline',version,main:'release-entry.cjs'})),tree=Buffer.from(JSON.stringify({files:{'package.json':{size:pkg.length,offset:'0'}}})),headerSize=8+tree.length,first=Buffer.alloc(8),header=Buffer.alloc(headerSize);first.writeUInt32LE(4);first.writeUInt32LE(headerSize,4);header.writeUInt32LE(headerSize-4);header.writeUInt32LE(tree.length,4);tree.copy(header,8);return Buffer.concat([first,header,pkg,Buffer.from(body)]);}
function crc32(bytes) { let value=0xffffffff; for (const byte of bytes) { value^=byte; for(let i=0;i<8;i++) value=(value>>>1)^((value&1)?0xedb88320:0); } return (value^0xffffffff)>>>0; }
function zip(entries) {
 const locals=[],centrals=[];let offset=0;
 for(const entry of entries) {
  const name=Buffer.from(entry.path),body=Buffer.from(entry.body),compressed=entry.deflate?zlib.deflateRawSync(body):body,method=entry.deflate?8:0,crc=crc32(body),local=Buffer.alloc(30),central=Buffer.alloc(46);
  local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt16LE(method,8);local.writeUInt32LE(crc,14);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(body.length,22);local.writeUInt16LE(name.length,26);
  central.writeUInt32LE(0x02014b50);central.writeUInt16LE(0x314,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x800,8);central.writeUInt16LE(method,10);central.writeUInt32LE(crc,16);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(body.length,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE(((entry.link?0xa000:0x8000)<<16)>>>0,38);central.writeUInt32LE(offset,42);
  locals.push(local,name,compressed);centrals.push(central,name);offset+=local.length+name.length+compressed.length;
 }
 const dir=Buffer.concat(centrals),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(dir.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...locals,dir,end]);
}
async function fixture(t, options={}) {
 const owned=path.resolve(__dirname,'../runtime/employee-update-tests');await fs.mkdir(owned,{recursive:true});const root=await fs.mkdtemp(path.join(owned,'toy-'));
 t.after(async()=>{if(path.dirname(root)!==owned)throw new Error('Unsafe test cleanup');await fs.rm(root,{recursive:true,force:true});});
 const profile=path.join(root,'profile'),install=path.join(root,'program');await fs.mkdir(profile);await fs.mkdir(install);await fs.mkdir(path.join(install,'resources'));
 const keys=crypto.generateKeyPairSync('ed25519'),now=options.now??Date.now(),entries=options.entries||[{path:'resources/app.asar',body:asar(options.catalog?.version||'1.6.1'),deflate:true},{path:'resources/print-dependencies/fake.txt',body:'new fake dependency'}],archive=zip(entries);
 const catalog={schemaVersion:1,app:'xjy-jewelry-offline',channel:'stable',version:'1.6.1',sourceVersions:['1.5.0','1.5.1','1.6.0'],platform:'win32',arch:'x64',sequence:4,publishedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+86400000).toISOString(),archive:{size:archive.length,sha256:hash(archive)},files:entries.map(e=>({path:e.path,size:Buffer.byteLength(e.body),sha256:hash(e.body)})),...options.catalog};
 const raw=JSON.stringify(catalog),envelope={catalog:raw,signature:crypto.sign(null,Buffer.from(raw),keys.privateKey).toString('base64')},allowedFiles=options.allowedFiles||entries.map(e=>e.path),currentVersion=options.currentVersion||'1.6.0';
 const cacheOptions={profileDir:profile,trustedPublicKey:keys.publicKey,allowedFiles,currentVersion,platform:'win32',arch:'x64',resolveCatalogEnvelope:async()=>envelope,now:()=>now};
 return {root,profile,install,keys,now,entries,archive,catalog,envelope,allowedFiles,currentVersion,cacheOptions,proof:{archiveSha256:catalog.archive.sha256,sequence:catalog.sequence,version:catalog.version,fileCount:entries.length}};
}
module.exports={fixture,hash,zip,asar};

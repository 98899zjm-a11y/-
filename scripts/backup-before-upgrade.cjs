'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const dest=path.resolve(process.argv[2]||'');assert(dest.toLowerCase().startsWith('d:\\codex\\xjy-private-backups\\pre170-'));
assert(fs.statSync(dest).isDirectory());const rows=[];
function state(s){return[s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs].join(':');}
function walk(src,kind,rel=''){
 const dir=path.join(src,rel);const ds=fs.lstatSync(dir);assert(ds.isDirectory()&&!ds.isSymbolicLink());assert.equal(fs.realpathSync.native(dir).toLowerCase(),dir.toLowerCase(),'source alias');
 const names=fs.readdirSync(dir).sort();
 for(const name of names){const r=path.join(rel,name),f=path.join(src,r),s=fs.lstatSync(f,{bigint:true});assert(!s.isSymbolicLink(),'source reparse');if(s.isDirectory()){walk(src,kind,r);continue;}assert(s.isFile());
  const to=path.join(dest,kind,r);assert(to.toLowerCase().startsWith(dest.toLowerCase()+path.sep));fs.mkdirSync(path.dirname(to),{recursive:true});
  const fd=fs.openSync(f,'r'),out=fs.openSync(to,'wx'),hash=crypto.createHash('sha256'),buf=Buffer.alloc(4*1024*1024);let size=0;
  try{assert.equal(state(s),state(fs.fstatSync(fd,{bigint:true})));for(;;){const n=fs.readSync(fd,buf,0,buf.length,null);if(!n)break;hash.update(buf.subarray(0,n));let at=0;while(at<n)at+=fs.writeSync(out,buf,at,n-at);size+=n;}fs.fsyncSync(out);assert.equal(size,Number(s.size));assert.equal(state(s),state(fs.fstatSync(fd,{bigint:true})));assert.equal(state(s),state(fs.statSync(f,{bigint:true})));}finally{fs.closeSync(fd);fs.closeSync(out);}
  const digest=hash.digest('hex'),verify=crypto.createHash('sha256'),vfd=fs.openSync(to,'r');try{for(;;){const n=fs.readSync(vfd,buf,0,buf.length,null);if(!n)break;verify.update(buf.subarray(0,n));}}finally{fs.closeSync(vfd);}assert.equal(verify.digest('hex'),digest,'backup readback');rows.push({kind,path:r,size,sha256:digest});
 }
 assert.deepEqual(fs.readdirSync(dir).sort(),names,'source directory changed');
}
walk('F:\\自制软件\\xjy-jewelry-offline','program');walk('F:\\鑫金源珠宝资料','data');
fs.writeFileSync(path.join(dest,'manifest.json'),JSON.stringify({createdAt:new Date().toISOString(),sourceUnchangedDuringCopy:true,readbackVerified:true,files:rows},null,2),{flag:'wx'});
console.log(JSON.stringify({backup:dest,files:rows.length,bytes:rows.reduce((n,r)=>n+r.size,0),readbackVerified:true}));

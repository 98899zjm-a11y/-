import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import nativeFs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const candidate=path.resolve(import.meta.dirname,'..');
await fs.mkdir(path.join(candidate,'runtime','storage-profile-tests'),{recursive:true});
const {openProfileLibrary}=await import(pathToFileURL(path.join(candidate,'materials/lib/storage-profile.mjs')).href);
const bytes=Buffer.from([255,216,255,224,0,2,255,217]);
const hash=value=>createHash('sha256').update(value).digest('hex');
const classify=async({sha256})=>({sha256,decision:'jewelry',category:'戒指',tags:['简约'],reason:'虚构类型复检'});
test('N1 profile row recheck requires its final JPEG path to remain a regular single-link file',async t=>{
 const host=await fs.mkdtemp(path.join(candidate,'runtime','storage-profile-tests','type-recheck-')),dataRoot=path.join(host,'销售素材');
 const original=await openProfileLibrary({dataRoot,classify}),row=await original.enqueue({bytes,sha256:hash('synthetic N1 original'),name:'虚构类型.jpg'});await original.idle();await original.close();
 const database=path.join(dataRoot,'library.sqlite'),image=path.join(dataRoot,'images',row.id+'.jpg'),retained=path.join(host,'retained-original.jpg'),lstat=nativeFs.lstatSync;
 let sawImage=false,injected=false,opened,error;
 nativeFs.lstatSync=function(value,...args){
  const info=lstat.call(this,value,...args),target=path.resolve(value);
  if(target===image)sawImage=true;
  if(!injected&&sawImage&&target===database){injected=true;nativeFs.renameSync(image,retained);nativeFs.mkdirSync(image);}
  return info;
 };
 try{opened=await openProfileLibrary({dataRoot,classify});}catch(value){error=value;}finally{nativeFs.lstatSync=lstat;}
 t.after(()=>opened?.close());let laterReadRejected=false;if(opened)try{await opened.file(row.id);}catch{laterReadRejected=true;}
 console.log(JSON.stringify({finding:'N1',injected,accepted:!!opened,error:error?.message,laterReadRejected,retainedOriginalUnchanged:hash(await fs.readFile(retained))===hash(bytes),finalPathIsDirectory:(await fs.lstat(image)).isDirectory()}));
 assert.equal(injected,true);assert.ok(error,'startup must reject an image path replaced with a directory after storage preflight');assert.match(error.message,/常规|文件|目录/);assert.equal(hash(await fs.readFile(retained)),hash(bytes));assert.equal((await fs.lstat(image)).isDirectory(),true);
});

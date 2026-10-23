'use strict';
// Metadata traversal must not acquire content, enumeration or write authority.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const project=path.resolve(__dirname,'..'),fixture=path.join(project,'runtime','ancestor-metadata-tests',crypto.randomUUID());
const privateParent=path.join(fixture,'private-parent'),root=path.join(privateParent,'workspace'),codeParent=path.join(fixture,'code-parent'),code=path.join(codeParent,'registered-code');
const external=path.join(fixture,'unregistered'),externalFile=path.join(external,'synthetic-only.txt'),hardlink=path.join(fixture,'outside-hardlink.txt');
for(const directory of [root,code,external])fs.mkdirSync(directory,{recursive:true});
fs.writeFileSync(path.join(root,'own.txt'),'OWN-FICTITIOUS');fs.writeFileSync(path.join(code,'module.txt'),'CODE-FICTITIOUS');fs.writeFileSync(externalFile,'EXTERNAL-FICTITIOUS');fs.linkSync(externalFile,hardlink);
const rawRename=fs.renameSync.bind(fs),rawLink=fs.symlinkSync.bind(fs),rawUnlink=fs.unlinkSync.bind(fs),rawMkdir=fs.mkdirSync.bind(fs),rawRmdir=fs.rmdirSync.bind(fs);
const api=require('../stage1/io-guard.cjs');

test('registered roots expose only exact ordinary ancestor lstat metadata and reject changed ancestry',async()=>{
 const policy=api.install({root,writeDirs:[root],readDirs:[code],childPrograms:[]});
 // This is the real central-print path-check shape, without opening any business module.
 for(let cursor=root;;cursor=path.dirname(cursor)){
  assert.equal(fs.lstatSync(cursor).isDirectory(),true);
  assert.equal(fs.lstatSync(cursor,{bigint:true}).isSymbolicLink(),false);
  if(cursor===path.dirname(cursor))break;
 }
 assert.equal(fs.lstatSync(codeParent).isDirectory(),true);
 assert.equal(fs.readFileSync(path.join(root,'own.txt'),'utf8'),'OWN-FICTITIOUS');
 assert.equal(fs.readFileSync(path.join(code,'module.txt'),'utf8'),'CODE-FICTITIOUS');
 for(const name of ['readFileSync','readdirSync','statSync','statfsSync','existsSync','accessSync','opendirSync','realpathSync','readlinkSync'])assert.throws(()=>fs[name](privateParent),/ISOLATION/,name+' must not inherit metadata authority');
 assert.throws(()=>fs.openSync(privateParent,'r'),/ISOLATION/);
 assert.throws(()=>fs.writeFileSync(path.join(privateParent,'new.txt'),'NO'),/ISOLATION/);
 assert.throws(()=>fs.writeFileSync(path.join(code,'module.txt'),'NO'),/ISOLATION/);
 for(const entry of [external,externalFile,hardlink,path.join(privateParent,'missing'),path.dirname(root)+'-similar',path.join(root,'..','..','unregistered')])assert.throws(()=>fs.lstatSync(entry),/ISOLATION/);
 for(const entry of ['F:\\鑫金源珠宝资料','f:\\鑫金源珠宝资料\\工作室数据\\jewelry.sqlite','F:\\','F:ledger.db','\\\\server\\share','\\\\?\\F:\\','file:///F:/ledger.db',privateParent+path.sep+'..'+path.sep+path.basename(privateParent),privateParent+' ',privateParent+'.'])assert.throws(()=>fs.lstatSync(entry),/ISOLATION/);
 await assert.rejects(fs.promises.lstat(privateParent),/ISOLATION/);
 assert.throws(()=>fs.lstat(privateParent,()=>assert.fail('forbidden metadata callback must not run')),/ISOLATION/);
 // A root/parent swapped to a directory junction after registration cannot inherit trust.
 const moved=privateParent+'-moved';rawRename(privateParent,moved);rawLink(external,privateParent,'junction');
 try{assert.throws(()=>fs.lstatSync(privateParent),/ISOLATION/);assert.throws(()=>fs.lstatSync(fixture),/ISOLATION/);}finally{rawUnlink(privateParent);rawRename(moved,privateParent);}
 // Preserving the root object does not authorize a replacement ordinary parent.
 rawRename(privateParent,moved);rawMkdir(privateParent);rawRename(path.join(moved,'workspace'),root);
 try{assert.throws(()=>fs.lstatSync(privateParent),/ISOLATION/);}finally{rawRename(root,path.join(moved,'workspace'));rawRmdir(privateParent);rawRename(moved,privateParent);}
 assert.equal(fs.lstatSync(privateParent).isDirectory(),true);
 assert.equal(policy.installed,true);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import nativeFs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {openLibrary} from '../materials/lib/library.mjs';

const candidate=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const base=path.join(candidate,'runtime','storage-profile-tests');
await fs.mkdir(base,{recursive:true});
const storage=await import('../materials/lib/storage-profile.mjs').catch(error=>({loadError:error}));
const service=await import('../profile-materials.mjs').catch(error=>({loadError:error}));
const bytes=Buffer.from([255,216,255,224,0,2,255,217]);
const hash=value=>createHash('sha256').update(value).digest('hex');
const classify=async value=>({sha256:value.sha256,decision:'jewelry',category:'戒指',tags:['简约'],reason:'虚构像素测试'});
const input=()=>({bytes,sha256:hash('synthetic original'),name:'虚构戒指.jpg',sourceLabel:'虚构测试'});
function api(){assert.equal(typeof storage.openProfileLibrary,'function','openProfileLibrary must be implemented');return storage.openProfileLibrary;}
async function fixture(){const root=await fs.mkdtemp(path.join(base,'host-'));return {root,dataRoot:path.join(root,'销售素材')};}
async function files(root){const result=[];async function scan(directory){for(const name of (await fs.readdir(directory)).sort()){const file=path.join(directory,name),stat=await fs.lstat(file);result.push([path.relative(root,file),stat.isFile()?hash(await fs.readFile(file)):'directory']);if(stat.isDirectory())await scan(file);}}await scan(root);return result;}

test('profile storage and service expose only the agreed trusted composition API',()=>{
 assert.equal(typeof storage.openProfileLibrary,'function',storage.loadError?.message);
 assert.equal(typeof service.createProfileMaterialsService,'function',service.loadError?.message);
});

test('default library still rejects a profile path and a forged capability object',async()=>{
 const {dataRoot}=await fixture();
 await assert.rejects(openLibrary({root:dataRoot,classify}),/runtime/);
 await assert.rejects(openLibrary({root:dataRoot,classify,profileStore:{root:dataRoot,check:value=>value}}),/runtime|profile|资料/);
 await assert.rejects(fs.stat(dataRoot),{code:'ENOENT'});
});

test('trusted profile initializes only material state, preserves JPEG and record through close/reopen',async t=>{
 const {root,dataRoot}=await fixture();let lib=await api()({dataRoot,classify});t.after(()=>lib.close());
 const row=await lib.enqueue(input());await lib.idle();assert.equal(lib.get(row.id).status,'imported');
 assert.deepEqual((await lib.file(row.id)).bytes,bytes);await lib.close();
 const snapshot=await files(dataRoot);lib=await api()({dataRoot,classify});await lib.idle();
 assert.equal(lib.list().length,1);assert.equal(lib.get(row.id).name,'虚构戒指.jpg');
 assert.deepEqual((await lib.file(row.id)).bytes,bytes);await lib.close();assert.deepEqual(await files(dataRoot),snapshot);
 assert.deepEqual(await fs.readdir(root),['销售素材']);
 assert.equal((await files(root)).some(([name])=>/jewelry\.sqlite|ledger\.db|stockcheck\.db/.test(name)),false);
});

test('second active profile owner is rejected, then normal close permits reopen',async t=>{
 const {dataRoot}=await fixture(),first=await api()({dataRoot,classify});t.after(()=>first.close());
 await assert.rejects(api()({dataRoot,classify}),/locked|busy|占用|owner/i);
 await first.close();const next=await api()({dataRoot,classify});await next.close();
});

test('unknown nonempty store is refused without creating a marker or changing bytes',async()=>{
 const {dataRoot}=await fixture();await fs.mkdir(dataRoot);await fs.writeFile(path.join(dataRoot,'library.sqlite'),'synthetic unknown database');
 const before=await files(dataRoot);await assert.rejects(api()({dataRoot,classify}),/unmarked|unknown|未知|标记/);assert.deepEqual(await files(dataRoot),before);
});

test('wrong leaf and missing parent are rejected without making a tree',async()=>{
 const {root}=await fixture(),wrong=path.join(root,'arbitrary'),absent=path.join(root,'missing','销售素材');
 await assert.rejects(api()({dataRoot:wrong,classify}));await assert.rejects(api()({dataRoot:absent,classify}));assert.deepEqual(await fs.readdir(root),[]);
});

test('relative, UNC, ADS, trailing dot, and Windows case aliases fail before mutation',async()=>{
 const {root,dataRoot}=await fixture();
 for(const value of ['runtime/销售素材','\\\\localhost\\share\\销售素材',dataRoot+':hidden',path.join(root,'销售素材.'),root.replace('host-','HOST-')+path.sep+'销售素材'])await assert.rejects(api()({dataRoot:value,classify}),undefined,value);
 assert.deepEqual(await fs.readdir(root),[]);
});

test('linked ancestor is refused and the synthetic target is unchanged',async()=>{
 const {root}=await fixture(),target=path.join(root,'target'),alias=path.join(root,'alias');await fs.mkdir(target);await fs.symlink(target,alias,'junction');
 await assert.rejects(api()({dataRoot:path.join(alias,'销售素材'),classify}),/alias|link|链接|路径/);assert.deepEqual(await fs.readdir(target),[]);
});

test('marker corruption is preserved and refused without resetting a valid library',async()=>{
 const {dataRoot}=await fixture(),lib=await api()({dataRoot,classify});await lib.close();
 const names=await fs.readdir(dataRoot),marker=names.find(name=>name.endsWith('.json'));assert.ok(marker,'profile marker must be JSON');
 await fs.writeFile(path.join(dataRoot,marker),'synthetic invalid marker');const before=await files(dataRoot);
 await assert.rejects(api()({dataRoot,classify}),/marker|标记|JSON|Unexpected|格式/);assert.deepEqual(await files(dataRoot),before);
});

for(const type of ['symlink','hardlink'])test('profile marker '+type+' is rejected without changing its target',async()=>{
 const {root,dataRoot}=await fixture(),lib=await api()({dataRoot,classify});await lib.close();
 const name=(await fs.readdir(dataRoot)).find(value=>value.endsWith('.json')),marker=path.join(dataRoot,name),target=path.join(root,'synthetic-marker.json');
 await fs.rename(marker,target);if(type==='symlink')await fs.symlink(target,marker,'file');else await fs.link(target,marker);
 const before=await fs.readFile(target);await assert.rejects(api()({dataRoot,classify}),/alias|link|链接/);assert.deepEqual(await fs.readFile(target),before);
});

for(const type of ['symlink','hardlink'])test('profile database '+type+' is rejected before opening shared storage',async()=>{
 const source=await fixture(),lib=await api()({dataRoot:source.dataRoot,classify});await lib.close();
 const target=await fixture(),next=await api()({dataRoot:target.dataRoot,classify});await next.close();
 const database=path.join(source.dataRoot,'library.sqlite'),alias=path.join(target.dataRoot,'library.sqlite');await fs.unlink(alias);
 if(type==='symlink')await fs.symlink(database,alias,'file');else await fs.link(database,alias);
 const before=await fs.readFile(database);await assert.rejects(api()({dataRoot:target.dataRoot,classify}),/alias|link|链接/);assert.deepEqual(await fs.readFile(database),before);
});

for(const type of ['symlink','hardlink'])test('profile image '+type+' is rejected and source bytes remain intact',async()=>{
 const {root,dataRoot}=await fixture(),lib=await api()({dataRoot,classify}),row=await lib.enqueue(input());await lib.idle();await lib.close();
 const target=path.join(root,'synthetic-source.jpg'),image=path.join(dataRoot,'images',row.id+'.jpg');await fs.rename(image,target);
 if(type==='symlink')await fs.symlink(target,image,'file');else await fs.link(target,image);
 const before=await fs.readFile(target);await assert.rejects(api()({dataRoot,classify}),/alias|link|链接/);assert.deepEqual(await fs.readFile(target),before);
});

for(const suffix of ['-journal','-wal','-shm'])test('profile rejects and preserves '+suffix+' crash residue',async()=>{
 const {dataRoot}=await fixture(),lib=await api()({dataRoot,classify});await lib.close();
 await fs.writeFile(path.join(dataRoot,'library.sqlite'+suffix),'synthetic crash residue');const before=await files(dataRoot);
 await assert.rejects(api()({dataRoot,classify}),/日志|journal|wal|shm|现场/i);assert.deepEqual(await files(dataRoot),before);
});

test('images regular file is preserved and rejected before database creation',async()=>{
 const {dataRoot}=await fixture(),lib=await api()({dataRoot,classify});await lib.close();
 await fs.unlink(path.join(dataRoot,'library.sqlite'));await fs.rmdir(path.join(dataRoot,'images'));await fs.writeFile(path.join(dataRoot,'images'),'synthetic keep');
 const before=await files(dataRoot);await assert.rejects(api()({dataRoot,classify}),/directory|目录/);assert.deepEqual(await files(dataRoot),before);
});

test('marked store with an unexpected entry is retained and rejected',async()=>{
 const {dataRoot}=await fixture(),lib=await api()({dataRoot,classify});await lib.close();await fs.writeFile(path.join(dataRoot,'unknown-business.dat'),'synthetic unfamiliar data');
 const before=await files(dataRoot);await assert.rejects(api()({dataRoot,classify}),/unknown|未知|目录项|内容|文件/);assert.deepEqual(await files(dataRoot),before);
});

test('catalog loss with material files cannot silently initialize an empty replacement',async()=>{
 const {dataRoot}=await fixture(),lib=await api()({dataRoot,classify});await lib.enqueue(input());await lib.idle();await lib.close();await fs.unlink(path.join(dataRoot,'library.sqlite'));
 const before=await files(dataRoot);await assert.rejects(api()({dataRoot,classify}),/missing|丢失|缺失|重建|非空|素材/);assert.deepEqual(await files(dataRoot),before);
});

test('corrupt owned catalog is retained without rebuilding it',async()=>{
 const {dataRoot}=await fixture(),lib=await api()({dataRoot,classify});await lib.close();await fs.writeFile(path.join(dataRoot,'library.sqlite'),'synthetic corrupt SQLite');
 const before=await files(dataRoot);await assert.rejects(api()({dataRoot,classify}),/corrupt|损坏|格式/);assert.deepEqual(await files(dataRoot),before);
});

test('post-open image junction is rejected before writing to its synthetic target',async t=>{
 const {root,dataRoot}=await fixture(),lib=await api()({dataRoot,classify});t.after(()=>lib.close());
 const images=path.join(dataRoot,'images'),target=path.join(root,'synthetic-target');await fs.mkdir(target);await fs.rmdir(images);await fs.symlink(target,images,'junction');
 await assert.rejects(lib.enqueue(input()),/alias|link|链接/);assert.deepEqual(await fs.readdir(target),[]);assert.equal(lib.list().length,0);
});

test('post-open image hardlink is rejected on reads without exposing its bytes',async t=>{
 const {root,dataRoot}=await fixture(),lib=await api()({dataRoot,classify});t.after(()=>lib.close());
 const row=await lib.enqueue(input());await lib.idle();const image=path.join(dataRoot,'images',row.id+'.jpg'),target=path.join(root,'synthetic-hardlink.jpg');await fs.link(image,target);
 const before=await fs.readFile(target);await assert.rejects(lib.file(row.id),/alias|link|链接/);assert.deepEqual(await fs.readFile(target),before);
});

test('post-constructor guard failure closes its SQLite handle exactly once and preserves rejected file',async()=>{
 const {dataRoot}=await fixture(),database=path.join(dataRoot,'library.sqlite'),lstat=nativeFs.lstatSync,close=DatabaseSync.prototype.close;
 let injected=false,closeCalls=0;
 nativeFs.lstatSync=function(value,...args){
  const stat=lstat.call(this,value,...args);
  if(!injected&&path.resolve(value)===database&&stat.isFile()&&stat.size===0){injected=true;throw Error('synthetic post-constructor path identity failure');}
  return stat;
 };
 DatabaseSync.prototype.close=function(...args){closeCalls++;return close.apply(this,args);};
 try{await assert.rejects(api()({dataRoot,classify}),/synthetic post-constructor path identity failure/);}
 finally{nativeFs.lstatSync=lstat;DatabaseSync.prototype.close=close;}
 assert.equal(injected,true);assert.equal(closeCalls,1,'rejected initialization must explicitly close its created database');
 assert.equal((await fs.stat(database)).size,0);const before=await files(dataRoot);
 await assert.rejects(api()({dataRoot,classify}),/损坏|格式/);assert.deepEqual(await files(dataRoot),before);
});

test('factory returns a closable mounted service and rejects external origin before storage writes',async t=>{
 assert.equal(typeof service.createProfileMaterialsService,'function');const {dataRoot}=await fixture();
 await assert.rejects(service.createProfileMaterialsService({origin:'https://example.test',dataRoot,classify}));await assert.rejects(fs.stat(dataRoot),{code:'ENOENT'});
 const mounted=await service.createProfileMaterialsService({origin:'http://127.0.0.1:21966',dataRoot,classify});t.after(()=>mounted.close());
 assert.equal(typeof mounted.handle,'function');assert.equal(typeof mounted.close,'function');await Promise.all([mounted.close(),mounted.close()]);await mounted.close();
 const next=await api()({dataRoot,classify});await next.close();
});

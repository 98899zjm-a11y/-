import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import nativeFs from 'node:fs';
import path from 'node:path';
import {createRequire,syncBuiltinESMExports} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {Readable} from 'node:stream';
const candidate=path.resolve(import.meta.dirname,'..');
const {openProfileLibrary}=await import(pathToFileURL(path.join(candidate,'materials/lib/storage-profile.mjs')).href);
const {createMaterialRequestHandler}=await import(pathToFileURL(path.join(candidate,'materials/server.mjs')).href);
const {createMaterialAccessAdapter}=await import(pathToFileURL(path.join(candidate,'materials/auth/lib/access-adapter.mjs')).href);
const {createCandidateAuthorityHost}=await import(pathToFileURL(path.join(candidate,'materials/auth/candidate-authority-host.mjs')).href);
const require=createRequire(import.meta.url),promises=require('node:fs/promises'),sharp=require(path.join(candidate,'materials/node_modules/sharp'));
const base=path.join(candidate,'runtime','storage-profile-tests');
await fs.mkdir(base,{recursive:true});
const bytes=Buffer.from([255,216,255,224,0,2,255,217]);
const hash=value=>createHash('sha256').update(value).digest('hex');
const classify=async({sha256})=>({sha256,decision:'jewelry',category:'戒指',tags:['简约'],reason:'虚构审查回归'});
const input=label=>({bytes,sha256:hash('synthetic '+label),name:'虚构-'+label+'.jpg'});
async function fixture(){const root=await fs.mkdtemp(path.join(base,'review-'));return{root,dataRoot:path.join(root,'销售素材')};}
async function snapshot(root){const out=[];async function walk(directory){for(const name of(await fs.readdir(directory)).sort()){const file=path.join(directory,name),stat=await fs.lstat(file);out.push([path.relative(root,file),stat.isDirectory()?'directory':hash(await fs.readFile(file))]);if(stat.isDirectory())await walk(file);}}await walk(root);return out;}

test('S1 profile refuses a journal appearing after its preflight scan',async t=>{
 const {dataRoot}=await fixture(),first=await openProfileLibrary({dataRoot,classify});await first.close();
 const database=path.join(dataRoot,'library.sqlite'),journal=database+'-journal',lstat=nativeFs.lstatSync;let injected=false,opened,error;
 nativeFs.lstatSync=function(value,...args){const info=lstat.call(this,value,...args);if(!injected&&path.resolve(value)===database){injected=true;nativeFs.writeFileSync(journal,Buffer.alloc(0));}return info;};
 try{opened=await openProfileLibrary({dataRoot,classify});}catch(value){error=value;}finally{nativeFs.lstatSync=lstat;}
 t.after(()=>opened?.close());console.log(JSON.stringify({finding:'S1',injected,accepted:!!opened,error:error?.message,journalRetained:nativeFs.existsSync(journal)}));
 assert.equal(injected,true);assert.ok(error,'profile must reject all journals, including a post-scan journal');assert.match(error.message,/日志|journal|现场/i);assert.deepEqual(await fs.readFile(journal),Buffer.alloc(0));
});

test('S2 an already queued enqueue stops after a preceding durable-write fatal',async t=>{
 const {dataRoot}=await fixture(),lib=await openProfileLibrary({dataRoot,classify});t.after(()=>lib.close());
 const prepare=DatabaseSync.prototype.prepare;let injected=false;
 DatabaseSync.prototype.prepare=function(sql,...args){if(!injected&&typeof sql==='string'&&sql.startsWith('INSERT INTO assets')){injected=true;throw Error('synthetic one-shot INSERT failure');}return prepare.call(this,sql,...args);};
 let outcomes;try{outcomes=await Promise.allSettled([lib.enqueue(input('fatal-first')),lib.enqueue(input('fatal-second'))]);}finally{DatabaseSync.prototype.prepare=prepare;}
 const images=(await fs.readdir(path.join(dataRoot,'images'))).sort();console.log(JSON.stringify({finding:'S2',injected,statuses:outcomes.map(value=>value.status),images}));
 assert.equal(injected,true);assert.equal(outcomes[0].status,'rejected');assert.equal(outcomes[1].status,'rejected','already queued second write must not report success after fatal');assert.equal(images.length,1,'only the first rejected transaction may leave its owned isolated file');assert.throws(()=>lib.list(),/写入异常/);
});

test('close still drains accepted queued work when there is no fatal',async()=>{
 const {dataRoot}=await fixture(),lib=await openProfileLibrary({dataRoot,classify});
 const first=lib.enqueue(input('drain-first')),second=lib.enqueue(input('drain-second')),closing=lib.close();
 const outcomes=await Promise.allSettled([first,second]);await closing;assert.deepEqual(outcomes.map(value=>value.status),['fulfilled','fulfilled']);
 const reopened=await openProfileLibrary({dataRoot,classify});try{await reopened.idle();assert.equal(reopened.list().length,2);}finally{await reopened.close();}
});

test('S3 corrupt catalog with missing images refuses without creating a directory',async()=>{
 const {dataRoot}=await fixture(),lib=await openProfileLibrary({dataRoot,classify});await lib.close();
 await fs.rmdir(path.join(dataRoot,'images'));await fs.writeFile(path.join(dataRoot,'library.sqlite'),'synthetic corrupt SQLite with missing images');
 const before=await snapshot(dataRoot);await assert.rejects(openProfileLibrary({dataRoot,classify}));const after=await snapshot(dataRoot);
 console.log(JSON.stringify({finding:'S3-corrupt',before,after}));assert.deepEqual(after,before);
});

for(const kind of ['missing','empty'])test('S3 catalog rows with '+kind+' image storage cannot open as a healthy profile',async t=>{
 const {root,dataRoot}=await fixture(),lib=await openProfileLibrary({dataRoot,classify});const row=await lib.enqueue(input('lost-'+kind));await lib.idle();await lib.close();
 if(kind==='missing')await fs.rename(path.join(dataRoot,'images'),path.join(root,'retained-images'));else await fs.rename(path.join(dataRoot,'images',row.id+'.jpg'),path.join(root,'retained-original.jpg'));
 const before=await snapshot(dataRoot);let opened,error;try{opened=await openProfileLibrary({dataRoot,classify});}catch(value){error=value;}t.after(()=>opened?.close());
 const after=await snapshot(dataRoot);console.log(JSON.stringify({finding:'S3-'+kind,accepted:!!opened,error:error?.message,before,after}));assert.ok(error,'a catalog with missing referenced bytes must refuse');assert.deepEqual(after,before);
});

test('S4 external file appearing during marker creation stays untouched and prevents opening',async()=>{
 const {dataRoot}=await fixture(),marker=path.join(dataRoot,'materials-profile.json'),unknown=path.join(dataRoot,'synthetic-unowned.dat'),open=promises.open;let injected=false;
 promises.open=function(file,...args){if(!injected&&path.resolve(file)===marker&&args[0]==='wx'){injected=true;nativeFs.writeFileSync(unknown,'synthetic unknown retained');}return open.call(this,file,...args);};syncBuiltinESMExports();
 try{await assert.rejects(openProfileLibrary({dataRoot,classify}),/未知|目录项/);}finally{promises.open=open;syncBuiltinESMExports();}
 const names=(await fs.readdir(dataRoot)).sort();console.log(JSON.stringify({finding:'S4',injected,names,classification:'external-writer check/open race; refused and retained; no automatic cleanup'}));
 assert.equal(injected,true);assert.equal(await fs.readFile(unknown,'utf8'),'synthetic unknown retained');await assert.rejects(fs.stat(path.join(dataRoot,'library.sqlite')),{code:'ENOENT'});await assert.rejects(openProfileLibrary({dataRoot,classify}),/未知|目录项/);
});

function response(){return{status:0,headers:{},headersSent:false,setHeader(name,value){this.headers[name.toLowerCase()]=value;},writeHead(status,headers={}){this.status=status;for(const[name,value]of Object.entries(headers))this.setHeader(name,value);this.headersSent=true;},end(body=''){this.bytes=Buffer.isBuffer(body)?body:Buffer.from(body);}};}
function client(handler,origin){let cookie='';return async(url,{method='GET',body,headers={}}={})=>{const req=Readable.from(body===undefined?[]:[Buffer.isBuffer(body)?body:Buffer.from(JSON.stringify(body))]);req.url=url;req.method=method;req.headers={host:new URL(origin).host,origin,...(cookie?{cookie}:{}),...headers};const res=response();await handler(req,res);if(res.headers['set-cookie'])cookie=res.headers['set-cookie'].split(';')[0];let data;try{data=JSON.parse(res.bytes.toString('utf8'));}catch{}return{status:res.status,data,bytes:res.bytes};};}
test('S5 accepted orphan policy keeps final authorization after async work: real handler 403 and API 404',async t=>{
 const {root,dataRoot}=await fixture(),origin='http://127.0.0.1:21967',username='synthetic_profile_operator',password='Synthetic-profile-review-only!';
 const host=createCandidateAuthorityHost({origin,accounts:[{username,password,level:'operate'}]});t.after(()=>host.close());
 let lib=await openProfileLibrary({dataRoot,classify});t.after(()=>lib.close());let checks=0;
 const serving={...lib,enqueue:(value,options)=>lib.enqueue(value,{beforeCommit:()=>{if(++checks===2)host.testControl.setGrant(username,'view');return options.beforeCommit();}})};
 const access=createMaterialAccessAdapter({origin,resolveAuthority:host.resolveAuthority});let handler=createMaterialRequestHandler({library:serving,origin,access,authorityHost:host});
 const request=client((req,res)=>handler(req,res),origin),initial=await request('/staff-auth/status');
 assert.equal(initial.status,200);assert.equal((await request('/staff-auth/login',{method:'POST',body:{username,password},headers:{'content-type':'application/json','x-auth-csrf-token':initial.data.authCsrfToken}})).status,200);
 const boot=await request('/api/bootstrap');assert.equal(boot.status,200);
 const original=await sharp({create:{width:16,height:16,channels:3,background:'#ddd'}}).jpeg().toBuffer(),originalFile=path.join(root,'synthetic-original.jpg');await fs.writeFile(originalFile,original);const originalHash=hash(original);
 const upload=await request('/api/assets?name=synthetic-original.jpg',{method:'POST',body:original,headers:{'content-type':'application/octet-stream','x-csrf-token':boot.data.csrfToken}});
 assert.equal(upload.status,403);assert.notEqual(upload.data.accepted,true);assert.equal(checks,2);assert.deepEqual(lib.list(),[]);
 const images=(await fs.readdir(path.join(dataRoot,'images'))).filter(value=>value.endsWith('.jpg'));assert.equal(images.length,1);const id=images[0].slice(0,-4);assert.equal(lib.get(id),null);assert.equal(await lib.file(id),null);
 assert.deepEqual((await request('/api/assets')).data.assets,[]);assert.equal((await request('/api/search?q=戒指')).data.total,0);assert.equal((await request('/api/assets/'+id+'/image')).status,404);assert.equal(hash(await fs.readFile(originalFile)),originalHash);
 await lib.close();lib=await openProfileLibrary({dataRoot,classify});handler=createMaterialRequestHandler({library:lib,origin,access,authorityHost:host});assert.deepEqual(lib.list(),[]);assert.equal((await request('/api/assets/'+id+'/image')).status,404);assert.equal(hash(await fs.readFile(originalFile)),originalHash);
 console.log(JSON.stringify({finding:'S5',uploadStatus:upload.status,dbRows:0,listRows:0,searchTotal:0,imageStatus:404,restartImageStatus:404,orphanFiles:images.length,originalUnchanged:true,transport:'real HTTP handler plus real memory-only candidate auth/admin; no listener opened'}));
});

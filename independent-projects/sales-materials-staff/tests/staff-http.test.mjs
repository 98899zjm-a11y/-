import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import sharp from 'sharp';
import {randomUUID} from 'node:crypto';
import {createApplication,projectRoot} from '../server.mjs';
import {openLibrary} from '../lib/library.mjs';
import {fixtureAccounts,login} from './staff-helper.mjs';
const classify=async x=>({sha256:x.sha256,decision:'jewelry',category:'戒指',tags:['简约'],reason:'可见戒圈'});
async function start(t,options={}){const accounts=fixtureAccounts();const app=await createApplication({port:0,accounts,dataRoot:path.join(projectRoot,'runtime','http-staff-'+randomUUID()),classify,...options});t.after(()=>app.close());return {app,accounts};}
const payload=()=>sharp({create:{width:45,height:45,channels:3,background:'#efeddf'}}).jpeg().toBuffer();
const patch=(client,id,value)=>client.fetch('/api/assets/'+id,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(value)});
test('no principal or a claimed role cannot read any asset data',async t=>{
 const {app}=await start(t);for(const endpoint of ['/api/bootstrap','/api/assets','/api/search?q=戒指','/api/assets/fake/image'])assert.equal((await fetch(app.origin+endpoint,{headers:{'X-Role':'admin','X-Staff-Id':'claimed'}})).status,401);
 assert.equal((await fetch(app.origin+'/api/health')).status,200);
});
test('view sees only imported display fields; operate cannot change supply or review',async t=>{
 const {app,accounts}=await start(t);const manager=await login(app,accounts.find(a=>a.level==='manage'));
 let r=await manager.fetch('/api/assets?name=private-name.jpg&sourceLabel=supplier-label',{method:'POST',headers:{'content-type':'application/octet-stream'},body:await payload()});assert.equal(r.status,202);const {asset}=await r.json();await app.library.idle();
 await patch(manager,asset.id,{availability:'reference_only',evidence:'虚构核实记录',confirmed:true});
 const view=await login(app,accounts.find(a=>a.level==='view')),operate=await login(app,accounts.find(a=>a.level==='operate'));
 const data=await(await view.fetch('/api/assets')).json();assert.equal(data.assets.length,1);for(const key of ['name','sourceLabel','sha256','reason','evidence','error'])assert.equal(Object.hasOwn(data.assets[0],key),false,key);
 assert.equal((await view.fetch('/api/assets',{method:'POST',headers:{'content-type':'application/octet-stream'},body:await payload()})).status,403);
 assert.equal((await patch(operate,asset.id,{tags:['细款']})).status,200);
 assert.equal((await patch(operate,asset.id,{availability:'in_stock',evidence:'尝试越权',confirmed:true})).status,403);
 assert.equal((await patch(operate,asset.id,{reviewDecision:'not_jewelry',confirmed:true})).status,403);
 assert.equal((await patch(operate,asset.id,{evidence:'仅改依据也须管理',confirmed:true})).status,403);
 assert.equal(app.library.get(asset.id).availability,'reference_only');
 const hidden=await app.library.enqueue({bytes:Buffer.from([255,216,255,224,0]),sha256:'f'.repeat(64),name:'内部暂存',sourceLabel:'fixture'});await app.library.idle();await app.library.update(hidden.id,{reviewDecision:'not_jewelry',confirmed:true});
 assert.equal((await view.fetch('/api/assets/'+hidden.id+'/image')).status,403);assert.equal((await(await view.fetch('/api/assets')).json()).assets.length,1);
});
test('manager needs confirmed evidence and old cookie loses access after logout',async t=>{
 const {app,accounts}=await start(t);const manager=await login(app,accounts.find(a=>a.level==='manage'));
 const r=await manager.fetch('/api/assets?name=fixture.jpg',{method:'POST',headers:{'content-type':'application/octet-stream'},body:await payload()}),{asset}=await r.json();await app.library.idle();
 assert.equal((await patch(manager,asset.id,{availability:'in_stock',evidence:'虚构依据'})).status,400);
 assert.equal((await patch(manager,asset.id,{availability:'in_stock',confirmed:true})).status,400);
 assert.equal((await patch(manager,asset.id,{availability:'in_stock',evidence:'虚构依据',confirmed:true})).status,200);
 const oldCookie=manager.cookie;assert.equal((await manager.logout()).status,200);
 assert.equal((await fetch(app.origin+'/api/assets',{headers:{cookie:oldCookie}})).status,401);
});
test('authorization is checked inside the queued upload immediately before commit',async t=>{
 let host,revoked=false;
 const {app,accounts}=await start(t,{libraryFactory:async opts=>{
   const library=await openLibrary(opts);
   return {...library,enqueue:async(input,context)=>{
     if(!revoked){revoked=true;host.testControl.setGrant('fixture_operate','view');}
     return library.enqueue(input,context);
   }};
 }});host=app.authorityHost;
 const operator=await login(app,accounts.find(a=>a.level==='operate'));
 const r=await operator.fetch('/api/assets?name=fixture.jpg',{method:'POST',headers:{'content-type':'application/octet-stream'},body:await payload()});assert.equal(r.status,403);assert.equal(app.library.list().length,0);
});
test('disabled grants and absent trusted authority fail closed',async t=>{
 const {app,accounts}=await start(t,{resolveAuthority:()=>null});const client=await login(app,accounts.find(a=>a.level==='manage'));assert.equal(client.boot.code,'LOGIN_REQUIRED');
 const r=await client.fetch('/api/assets');assert.equal(r.status,401);
});
test('an operator cannot undo a manager rejection by requesting reclassification',async t=>{
 const {app,accounts}=await start(t);const manager=await login(app,accounts.find(a=>a.level==='manage')),operator=await login(app,accounts.find(a=>a.level==='operate'));
 const r=await manager.fetch('/api/assets?name=fixture.jpg',{method:'POST',headers:{'content-type':'application/octet-stream'},body:await payload()}),{asset}=await r.json();await app.library.idle();
 assert.equal((await patch(manager,asset.id,{reviewDecision:'not_jewelry',confirmed:true})).status,200);
 assert.equal((await operator.fetch('/api/assets/'+asset.id+'/retry',{method:'POST'})).status,403);
 assert.equal((await manager.fetch('/api/assets/'+asset.id+'/retry',{method:'POST'})).status,403);
 await app.library.idle();assert.equal(app.library.get(asset.id).status,'skipped');
 assert.equal((await patch(manager,asset.id,{reviewDecision:'jewelry',confirmed:true})).status,200);assert.equal(app.library.get(asset.id).status,'imported');
});
test('an image read cannot complete after the operator is downgraded to view',async t=>{
 let host,onRead;
 const {app,accounts}=await start(t,{classify:async x=>({sha256:x.sha256,decision:'uncertain',category:'戒指',tags:[],reason:'待核对'}),libraryFactory:async opts=>{const lib=await openLibrary(opts);return{...lib,file:async id=>{const file=await lib.file(id);await onRead?.(id);return file;}};}});host=app.authorityHost;
 const manager=await login(app,accounts.find(a=>a.level==='manage')),operator=await login(app,accounts.find(a=>a.level==='operate'));
 const r=await manager.fetch('/api/assets?name=fixture.jpg',{method:'POST',headers:{'content-type':'application/octet-stream'},body:await payload()}),{asset}=await r.json();await app.library.idle();
 onRead=()=>{host.testControl.setGrant('fixture_operate','view');onRead=null;};
 assert.equal((await operator.fetch('/api/assets/'+asset.id+'/image')).status,403);
});
test('a view image read cannot complete after the manager rejects that image',async t=>{
 let onRead;
 const {app,accounts}=await start(t,{libraryFactory:async opts=>{const lib=await openLibrary(opts);return{...lib,file:async id=>{const file=await lib.file(id);await onRead?.(id);return file;}};}});
 const manager=await login(app,accounts.find(a=>a.level==='manage')),viewer=await login(app,accounts.find(a=>a.level==='view'));
 const r=await manager.fetch('/api/assets?name=fixture.jpg',{method:'POST',headers:{'content-type':'application/octet-stream'},body:await payload()}),{asset}=await r.json();await app.library.idle();
 onRead=async id=>{onRead=null;assert.equal((await patch(manager,id,{reviewDecision:'not_jewelry',confirmed:true})).status,200);};
 assert.equal((await viewer.fetch('/api/assets/'+asset.id+'/image')).status,403);
});

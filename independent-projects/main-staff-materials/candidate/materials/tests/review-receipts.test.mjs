import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import sharp from '../node_modules/sharp/dist/index.mjs';
import {createApplication,projectRoot} from '../server.mjs';
import {openLibrary} from '../lib/library.mjs';
import {fixtureAccounts,login} from './staff-helper.mjs';
const bytes=await sharp({create:{width:16,height:16,channels:3,background:'#ddd'}}).jpeg().toBuffer();
for(const operation of ['enqueue','update','retry'])test('F2 '+operation+' returns minimal success after commit even when grants change before response',async t=>{
 let host,committed=false;const accounts=fixtureAccounts();const app=await createApplication({port:0,accounts,dataRoot:path.join(projectRoot,'runtime','receipt-'+randomUUID()),classify:async({sha256})=>({sha256,decision:'uncertain',category:'戒指',tags:['简约'],reason:'synthetic'}),libraryFactory:async options=>{const lib=await openLibrary(options);return {...lib,[operation]:async(...args)=>{const result=await lib[operation](...args);if(committed){host.testControl.setGrant('fixture_manage','disabled');await Promise.resolve();}return result;}}}});host=app.authorityHost;t.after(()=>app.close());const client=await login(app,accounts.find(a=>a.level==='manage'));
 let response,id;if(operation==='enqueue'){committed=true;response=await client.fetch('/api/assets?name=synthetic.jpg',{method:'POST',headers:{'content-type':'application/octet-stream'},body:bytes});}
 else{const initial=await client.fetch('/api/assets?name=synthetic.jpg',{method:'POST',headers:{'content-type':'application/octet-stream'},body:bytes});id=(await initial.json()).asset.id;await app.library.idle();committed=true;response=operation==='retry'?await client.fetch('/api/assets/'+id+'/retry',{method:'POST'}):await client.fetch('/api/assets/'+id,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({tags:['花形']})});}
 const data=await response.json();assert.equal(response.status,operation==='update'?200:202);assert.equal(data.accepted,true);assert.deepEqual(Object.keys(data.asset),['id']);assert.equal(typeof data.asset.id,'string');if(operation==='enqueue')assert.equal(data.duplicate,false);if(operation==='update')assert.deepEqual(app.library.get(id).tags,['花形']);assert.equal((await client.fetch('/api/assets')).status,403);
});
test('F2 duplicate is also authorized at its final acceptance and callback failure cannot return accepted',async t=>{const root=path.join(projectRoot,'runtime','duplicate-'+randomUUID()),lib=await openLibrary({root,classify:async({sha256})=>({sha256,decision:'uncertain',category:'戒指',tags:[],reason:'synthetic'})});t.after(()=>lib.close());const sha256=(await import('node:crypto')).createHash('sha256').update(bytes).digest('hex');const input={bytes,sha256,name:'synthetic'};await lib.enqueue(input);await lib.idle();let calls=0;await assert.rejects(lib.enqueue(input,{beforeCommit:()=>{if(++calls===2)throw Error('revoked before duplicate receipt');return{staffId:'synthetic'}}}),/revoked/);assert.equal(calls,2);assert.equal(lib.list().length,1);});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import http from 'node:http';
import { createApplication,projectRoot } from '../server.mjs';
import {fixtureAccounts,login} from './staff-helper.mjs';

test('real HTTP upload, local gate, dedupe, search and confirmed supply status',async()=>{
  const root=path.join(projectRoot,'runtime','test-http-'+Date.now());
  const accounts=fixtureAccounts();const app=await createApplication({port:0,accounts,dataRoot:root,classify:async({sha256})=>({sha256,decision:'jewelry',category:'戒指',tags:['简约','金色'],reason:'环形首饰'})});
  try {
    const client=await login(app,accounts.find(x=>x.level==='manage'));const nativeFetch=globalThis.fetch;const fetch=(url,options)=>url.startsWith(app.origin)?client.fetch(url.slice(app.origin.length),options):nativeFetch(url,options);
    const headers={};
    let r=await fetch(app.origin+'/api/assets?name=ring.jpg',{method:'POST',headers:{...headers,'content-type':'application/octet-stream'},body:Buffer.from('broken')});assert.equal(r.status,422);
    const bytes=await sharp({create:{width:40,height:40,channels:3,background:'#c9a252'}}).jpeg().toBuffer();
    r=await fetch(app.origin+'/api/assets?name=ring.jpg',{method:'POST',headers:{...headers,'content-type':'application/octet-stream'},body:bytes});assert.equal(r.status,202);const added=await r.json();assert.equal(added.duplicate,false);
    await app.library.idle();
    r=await fetch(app.origin+'/api/assets?name=copy.jpg',{method:'POST',headers:{...headers,'content-type':'application/octet-stream'},body:bytes});assert.equal((await r.json()).duplicate,true);
    const results=await(await fetch(app.origin+'/api/search?q='+encodeURIComponent('想看简约戒指'))).json();assert.equal(results.total,1);assert.equal(results.items[0].availability,'unknown');
    assert.equal((await fetch(app.origin+'/api/assets/'+added.asset.id+'/image')).status,200);
    r=await fetch(app.origin+'/api/assets/'+added.asset.id,{method:'PATCH',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({status:'imported'})});assert.equal(r.status,400);
    r=await fetch(app.origin+'/api/assets/'+added.asset.id,{method:'PATCH',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({availability:'in_stock'})});assert.equal(r.status,400);
    r=await fetch(app.origin+'/api/assets/'+added.asset.id,{method:'PATCH',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({availability:'in_stock',evidence:'虚构验收资料，人工确认',confirmed:true})});assert.equal(r.status,200);
    assert.equal((await(await fetch(app.origin+'/api/search?q='+encodeURIComponent('现货戒指'))).json()).total,1);
    const list=await(await fetch(app.origin+'/api/assets')).text();assert.doesNotMatch(list,/[A-Z]:\\|runtime[\\/]/);assert.equal(JSON.parse(list).counts.imported,1);
  }finally{await app.close();}
});
test('image HTTP sends the already verified buffer instead of reopening a filesystem path',async()=>{
  const expected=Buffer.from([255,216,255,224,0,1,2,3]);
  const accounts=fixtureAccounts();const app=await createApplication({port:0,accounts,libraryFactory:async()=>({get:()=>({id:'proof',status:'imported'}),file:async()=>({path:'D:/never-open-an-unverified-path.jpg',mime:'image/jpeg',bytes:expected}),close:async()=>{}})});
  try{const client=await login(app,accounts.find(x=>x.level==='view'));const response=await client.fetch('/api/assets/proof/image');assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),expected);}finally{await app.close();}
});
test('reject cross origin, missing CSRF, field injection and host rebinding',async()=>{
  const root=path.join(projectRoot,'runtime','test-security-'+Date.now());
  const app=await createApplication({port:0,dataRoot:root,classify:async()=>{throw Error('unused');}});
  try {
    assert.equal((await fetch(app.origin+'/api/bootstrap',{headers:{Origin:'https://example.invalid'}})).status,403);
    const rebound=await new Promise((resolve,reject)=>{http.get(app.origin+'/api/bootstrap',{headers:{Host:'evil.invalid'}},r=>{r.resume();resolve(r.statusCode);}).on('error',reject);});
    assert.equal(rebound,403);
    assert.equal((await fetch(app.origin+'/api/assets',{method:'POST',headers:{Origin:app.origin,'content-type':'application/octet-stream'},body:'x'})).status,401);
    assert.equal((await fetch(app.origin+'/config/openclaw.json')).status,404);
    assert.equal((await fetch(app.origin+'/../server.mjs')).status,404);
    const r=await fetch(app.origin+'/');assert.equal(r.status,200);assert.match(r.headers.get('content-security-policy'),/object-src 'none'/);
  }finally{await app.close();}
});

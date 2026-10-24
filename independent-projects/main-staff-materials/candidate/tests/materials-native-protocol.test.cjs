'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {createMaterialNativeProtocol}=require('../project/desktop/materials-native-protocol.cjs');
const assetsRoot=path.resolve(__dirname,'../materials/public');
const envelope=(status,body,headers={'content-type':'application/json; charset=utf-8'})=>({status,headers,bodyBase64:Buffer.from(typeof body==='string'?body:JSON.stringify(body)).toString('base64')});
test('native serves only fixed local material assets and keeps other app routes outside hook',async()=>{
 const calls=[],network={async materialsRequest(input){calls.push(input);return envelope(200,{authenticated:true,user:{name:'虚构员工'},authCsrfToken:'a'.repeat(64)});}};
 const handle=createMaterialNativeProtocol({network,assetsRoot,getGeneration:()=>0});
 assert.equal(await handle(new Request('jewelry://app/home')),null);
 assert.equal((await handle(new Request('https://attacker.invalid/materials/'))).status,403);
 const document=await handle(new Request('jewelry://app/materials/'));assert.equal(document.status,200);assert.match(await document.text(),/客户要求/);assert.ok(calls.some(input=>input.path==='/materials/staff-auth/status'));
 const script=await handle(new Request('jewelry://app/materials/app.js'));assert.equal(script.status,200);assert.equal(await script.text(),await fs.readFile(path.join(assetsRoot,'app.js'),'utf8'));
 assert.equal((await handle(new Request('jewelry://app/materials/not-whitelisted.js'))).status,404);
});
test('native forwards bounded body and only the three expected headers; no network secrets enter renderer',async()=>{
 let captured;const handle=createMaterialNativeProtocol({assetsRoot,getGeneration:()=>0,network:{async materialsRequest(input){captured=input;return envelope(202,{accepted:true,asset:{id:'synthetic'}});}}});
 const response=await handle(new Request('jewelry://app/materials/api/assets?name=fixture.jpg',{method:'POST',headers:{'content-type':'application/octet-stream','x-xjy-csrf':'b'.repeat(64),'x-csrf-token':'synthetic-csrf'},body:Buffer.from([1,2,3])}));
 assert.equal(response.status,202);assert.deepEqual(Buffer.from(captured.bodyBase64,'base64'),Buffer.from([1,2,3]));assert.deepEqual(Object.keys(captured.headers).sort(),['content-type','x-csrf-token','x-xjy-csrf']);assert.equal(captured.path,'/materials/api/assets?name=fixture.jpg');
 const big=await handle(new Request('jewelry://app/materials/api/assets',{method:'POST',body:Buffer.alloc(20*1024*1024+1)}));assert.equal(big.status,413);
});
test('native drops late read response after login generation changes and rejects hostile response headers',async()=>{
 let generation=0,release;const entered=new Promise(resolve=>{release=resolve;});
 const handle=createMaterialNativeProtocol({assetsRoot,getGeneration:()=>generation,network:{async materialsRequest(){await entered;return envelope(200,Buffer.from([1,2]).toString('base64'));}}});
 const response=handle(new Request('jewelry://app/materials/api/assets/test/image'));generation++;release();assert.equal((await response).status,401);
 const bad=createMaterialNativeProtocol({assetsRoot,getGeneration:()=>0,network:{async materialsRequest(){return envelope(200,{secret:false},{'set-cookie':'bad=1','content-type':'application/json'});}}});
 assert.equal((await bad(new Request('jewelry://app/materials/api/assets'))).status,502);
});
test('native allows a legitimate large binary response without recursive regex failure',async()=>{
 const bytes=Buffer.alloc(5*1024*1024,7);const handle=createMaterialNativeProtocol({assetsRoot,getGeneration:()=>0,network:{async materialsRequest(){return{status:200,headers:{'content-type':'image/jpeg'},bodyBase64:bytes.toString('base64')};}}});
 const response=await handle(new Request('jewelry://app/materials/api/assets/synthetic/image'));assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
});
test('native query values may contain encoded separators while total route stays bounded',async()=>{
 const handle=createMaterialNativeProtocol({assetsRoot,getGeneration:()=>0,network:{async materialsRequest(){return envelope(200,{items:[],total:0});}}});
 assert.equal((await handle(new Request('jewelry://app/materials/api/search?'+new URLSearchParams({q:'戒指/吊坠'})))).status,200);
 assert.equal((await handle(new Request('jewelry://app/materials/api/search?q='+('x'.repeat(4096))))).status,400);
});
test('native asset root refuses a directory alias rather than silently following it',async()=>{
 const temporary=await fs.mkdtemp(path.resolve(__dirname,'../runtime/native-assets-alias-')),alias=path.join(temporary,'linked-assets');await fs.symlink(assetsRoot,alias,'junction');
 const handle=createMaterialNativeProtocol({assetsRoot:alias,getGeneration:()=>0,network:{async materialsRequest(){return envelope(200,{authenticated:true,authCsrfToken:'a'.repeat(64)});}}});
 assert.equal((await handle(new Request('jewelry://app/materials/'))).status,404);
});
test('native permits absent browser initiator but rejects explicit opaque or empty initiator',async()=>{
 let calls=0;const handle=createMaterialNativeProtocol({assetsRoot,getGeneration:()=>0,network:{async materialsRequest(){calls++;return envelope(200,{items:[],total:0});}}});
 for(const initiator of [null,'','null','https://attacker.invalid']){const request=new Request('jewelry://app/materials/api/assets');Object.defineProperty(request,'initiatorOrigin',{value:initiator});assert.equal((await handle(request)).status,403);}
 assert.equal(calls,0);assert.equal((await handle(new Request('jewelry://app/materials/api/assets'))).status,200);assert.equal(calls,1);
});

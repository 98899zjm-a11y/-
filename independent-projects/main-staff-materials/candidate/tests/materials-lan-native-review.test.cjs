'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {createMaterialNativeProtocol}=require('../project/desktop/materials-native-protocol.cjs');
const {normalizeMaterialsInput}=require('../project/desktop/lan.cjs');
const assetsRoot=path.resolve(__dirname,'../materials/public'),seal=Symbol.for('xjy.materials.finalizeRead');
const envelope=(status,body,fn)=>Object.defineProperty({status,headers:{'content-type':'application/json'},bodyBase64:Buffer.from(JSON.stringify(body)).toString('base64')},seal,{value:fn});
function handleWith(value){return createMaterialNativeProtocol({assetsRoot,getGeneration:()=>0,network:{materialsRequest:async()=>value}});}
test('native API rejects a Promise-returning normal read finalizer before publishing collected data',async()=>{
 const handle=handleWith(envelope(200,{private:'synthetic-collected-only'},()=>Promise.resolve()));
 const result=await handle(new Request('jewelry://app/materials/api/assets'));assert.equal(result.status,503);assert.doesNotMatch(await result.text(),/synthetic-collected-only/);
});
test('native API rejects a rejected Promise-returning read finalizer without publishing collected data',async()=>{
 const handle=handleWith(envelope(200,{private:'synthetic-collected-only'},()=>{const result=Promise.reject(Object.assign(Error('synthetic denied'),{status:403}));result.catch(()=>{});return result;}));
 const result=await handle(new Request('jewelry://app/materials/api/assets'));assert.equal(result.status,503);assert.doesNotMatch(await result.text(),/synthetic-collected-only/);
});
test('native static file rejects a Promise-returning auth finalizer at its final send boundary',async()=>{
 const handle=handleWith(envelope(200,{authenticated:true,authCsrfToken:'a'.repeat(64)},()=>Promise.resolve()));
 const result=await handle(new Request('jewelry://app/materials/'));assert.equal(result.status,503);assert.doesNotMatch(await result.text(),/<!doctype html/i);
});
test('native POST acknowledgement never invokes a supplied read finalizer after commit',async()=>{
 let calls=0;const handle=handleWith(envelope(202,{accepted:true,asset:{id:'synthetic-proof'}},()=>{calls++;throw Object.assign(Error('synthetic grant changed after commit'),{status:403});}));
 const result=await handle(new Request('jewelry://app/materials/api/assets/synthetic-proof/retry',{method:'POST'}));assert.equal(result.status,202);assert.deepEqual(await result.json(),{accepted:true,asset:{id:'synthetic-proof'}});assert.equal(calls,0);
});
test('native PATCH acknowledgement never invokes a supplied read finalizer after commit',async()=>{
 let calls=0;const handle=handleWith(envelope(200,{accepted:true,asset:{id:'synthetic-proof'}},()=>{calls++;throw Object.assign(Error('synthetic session ended after commit'),{status:401});}));
 const result=await handle(new Request('jewelry://app/materials/api/assets/synthetic-proof',{method:'PATCH',headers:{'content-type':'application/json'},body:'{}'}));assert.equal(result.status,200);assert.deepEqual(await result.json(),{accepted:true,asset:{id:'synthetic-proof'}});assert.equal(calls,0);
});
test('native write acknowledgement does not depend on an accidentally async read-seal field',async()=>{
 let calls=0;const handle=handleWith(envelope(202,{accepted:true,asset:{id:'synthetic-proof'}},async()=>{calls++;}));
 const result=await handle(new Request('jewelry://app/materials/api/assets/synthetic-proof/retry',{method:'POST'}));assert.equal(result.status,202);assert.equal((await result.json()).accepted,true);assert.equal(calls,0);
});
test('native write acknowledgement does not read an accidentally accessor read-seal field',async()=>{
 let calls=0;const value=Object.defineProperty({status:202,headers:{'content-type':'application/json'},bodyBase64:Buffer.from('{"accepted":true,"asset":{"id":"synthetic-proof"}}').toString('base64')},seal,{get(){calls++;throw Error('read seal is irrelevant to a committed write');}});
 const handle=handleWith(value),result=await handle(new Request('jewelry://app/materials/api/assets/synthetic-proof/retry',{method:'POST'}));assert.equal(result.status,202);assert.equal((await result.json()).accepted,true);assert.equal(calls,0);
});
test('health remains outside the original material LAN and native route scope',async()=>{
 let calls=0;assert.throws(()=>normalizeMaterialsInput({path:'/materials/api/health',method:'GET'}),error=>error.status===400);
 const handle=createMaterialNativeProtocol({assetsRoot,getGeneration:()=>0,network:{materialsRequest:async()=>{calls++;return{status:200,headers:{},bodyBase64:''};}}});
 const result=await handle(new Request('jewelry://app/materials/api/health'));assert.equal(result.status,404);assert.equal(calls,0);
});

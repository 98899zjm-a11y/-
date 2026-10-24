'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function load({native=false,host='app',request,fetch}){
 const source=fs.readFileSync(path.join(__dirname,'../materials/public/app.js'),'utf8');
 const begin=source.indexOf('async function mainAuthRequest('),end=source.indexOf('\nasync function api(',begin);
 assert.ok(begin>=0&&end>begin,'main auth request must preserve the native preload route');
 const context={location:{protocol:native?'jewelry:':'http:',host:native?host:'127.0.0.1:21965'},window:{jewelryDesktop:{request}},fetch,Response,Error};vm.createContext(context);
 vm.runInContext(source.slice(begin,end)+';globalThis.call=mainAuthRequest;',context);return context.call;
}
test('material native logout uses existing main preload once and forwards no CSRF or LAN credential into IPC',async()=>{
 const calls=[];const call=load({native:true,request:async input=>{calls.push(input);return{ok:true,status:200,data:{authenticated:false}};},fetch:()=>assert.fail('native auth must not use HTTP fetch')});
 const response=await call('/auth/logout',{method:'POST',headers:{'X-XJY-CSRF':'synthetic-token'},body:'{}'});assert.equal(response.status,200);assert.equal((await response.json()).authenticated,false);assert.equal(calls.length,1);assert.deepEqual(JSON.parse(JSON.stringify(calls[0])),{path:'/auth/logout',method:'POST',body:{}});
 await assert.rejects(()=>call('/auth/login',{method:'POST'}));assert.equal(calls.length,1);
});
test('material web logout keeps original same-origin HTTP flow even if a fake preload object exists',async()=>{
 const calls=[];const call=load({request:()=>assert.fail('web content may not select preload path'),fetch:async(...args)=>{calls.push(args);return new Response('{}',{status:200});}});
 const options={method:'POST',headers:{'X-XJY-CSRF':'synthetic-token'},body:'{}'};assert.equal((await call('/auth/logout',options)).status,200);assert.equal(calls[0][0],'/auth/logout');assert.equal(calls[0][1],options);
});
test('native auth rejects wrong host and preserves explicit main transport failure',async()=>{
 const wrong=load({native:true,host:'other',request:()=>assert.fail('wrong native authority'),fetch:()=>assert.fail('wrong native origin')});await assert.rejects(()=>wrong('/auth/logout',{method:'POST'}));
 const failed=load({native:true,request:async()=>({ok:false,status:401,data:{error:'Synthetic expired session'}}),fetch:()=>assert.fail()});const response=await failed('/auth/logout',{method:'POST'});assert.equal(response.status,401);assert.equal((await response.json()).error,'Synthetic expired session');
});

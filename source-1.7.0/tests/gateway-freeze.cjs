'use strict';
const assert=require('node:assert/strict'),http=require('node:http');
async function verify(host){
 const session=await fetch(host.origin+'/session');const value=await session.json(),cookie=session.headers.get('set-cookie').split(';')[0];
 const headers={cookie,origin:host.origin,'content-type':'application/json','x-xjy-csrf':value.csrf};
 const logged=await fetch(host.origin+'/auth/login',{method:'POST',headers,body:JSON.stringify({username:'demo-admin',password:'DemoAdmin-2026!'})});assert.equal(logged.status,200);
 headers.cookie=logged.headers.get('set-cookie').split(';')[0];headers['x-xjy-csrf']=(await logged.json()).csrf;
 const payload=JSON.stringify({name:'不应穿越维护冻结的虚构客户',phone:'',notes:'slow-request-fixture'});let request,gotResponse;
 const response=new Promise((resolve,reject)=>{request=http.request(host.origin+'/api/customers',{method:'POST',headers:{...headers,'content-length':Buffer.byteLength(payload)}},res=>{gotResponse=true;res.resume();res.on('end',()=>resolve(res.statusCode));});request.on('error',reject);request.write(payload.slice(0,15));});
 await new Promise(r=>setTimeout(r,50));let ran=false;const frozen=host.gateway.withFrozen(()=>{ran=true;});
 await new Promise(r=>setTimeout(r,50));assert.equal(ran,false,'freeze must drain handlers still reading their body');request.end(payload.slice(15));assert.equal(await response,503);await frozen;assert.equal(ran,true);assert.equal(host.backend.runtime.sqlite.prepare('SELECT COUNT(*) AS n FROM customers WHERE notes=?').get('slow-request-fixture').n,0);
 assert.equal((await fetch(host.origin+'/api/bootstrap',{headers:{cookie:headers.cookie}})).status,200,'normal requests resume after maintenance');
}
module.exports={verify};

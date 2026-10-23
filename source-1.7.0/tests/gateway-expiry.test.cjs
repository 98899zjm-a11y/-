'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),path=require('node:path');
test('unreturned expired browser sessions are reclaimed before capacity checks',async()=>{
 let clock=0,closed=0;const backend={createSession:()=>({auth:{status:()=>({authenticated:false})},close:async()=>{closed++;}})},server=http.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const gateway=require('../stage1/web-gateway.cjs').createGateway({backend,server,root:path.resolve(__dirname,'..'),clock:()=>clock,sessionLimit:4,sessionTtlMs:100});
 try{for(let i=0;i<4;i++)assert.equal((await fetch(origin+'/session')).status,200);assert.equal((await fetch(origin+'/session')).status,429);clock=101;assert.equal((await fetch(origin+'/session')).status,200);assert.equal(closed,4);}finally{await gateway.close();await new Promise(r=>server.close(r));}
});

'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
async function verify(host){
 const{startLanServer,createLanClient}=require('../project/desktop/lan.cjs');
 host.backend.auth.login({username:'demo-admin',password:'DemoAdmin-2026!'});
 const server=await startLanServer({backend:host.backend,host:'127.0.0.1',port:0,identityFile:path.join(host.root,'config','synthetic-lan-identity.json')});
 const client=createLanClient({host:'127.0.0.1',port:server.port,code:server.code});
 try{
  assert.equal((await client.dispatch({path:'/auth/login',method:'POST',body:{username:'demo-sales-a',password:'DemoEmployee-A-2026!'}})).status,200);
  const result=await client.dispatch({path:'/api/media',method:'POST',body:{syntheticOversize:'x'.repeat(100*1024*1024)}});
  assert.equal(result.status,413,'wire-size rejection must not look like cannot-connect503');assert.match(result.data.error,/128MB/);
  assert.equal(client.connected,true,'local size rejection must retain the authenticated connection');
  assert.equal((await client.dispatch({path:'/api/bootstrap',method:'GET'})).status,200);
 }finally{await client.close();await server.stop();host.backend.auth.logout();}
}
module.exports={verify};

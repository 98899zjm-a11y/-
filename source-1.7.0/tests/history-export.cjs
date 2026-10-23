'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
async function verify(host){
 const session=host.backend.createSession();session.auth.login({username:'demo-admin',password:'DemoAdmin-2026!'});
 try{const employee=host.backend.createSession();employee.auth.login({username:'demo-sales-a',password:'DemoEmployee-A-2026!'});
  try{const others=host.backend.runtime.sqlite.prepare("SELECT id FROM staff_users WHERE name='虚构员工乙'").get();assert.equal((await employee.dispatch({path:'/api/quotes?staffId='+others.id+'&status=confirmed',method:'GET'})).status,403,'employees must not silently ignore a request for another employee');assert.equal((await employee.dispatch({path:'/api/exports/logs',method:'GET'})).status,403);}finally{await employee.close();}
  const date=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}),unconfirmed=await session.dispatch({path:'/api/quotes?from='+date+'&to='+date+'&status=unconfirmed&pageSize=200',method:'GET'});assert.equal(unconfirmed.status,200);assert.ok(unconfirmed.data.quotes.every(q=>!q.saleConfirmation));
  const r=await session.dispatch({path:'/api/exports/history?from='+date+'&to='+date,method:'GET'});assert.equal(r.status,200);assert.equal(r.data.contentType,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');const bytes=Buffer.from(r.data.base64,'base64');assert.equal(bytes.readUInt16LE(0),0x4b50);fs.writeFileSync(path.join(host.root,'data','documents','export-fixture.xlsx'),bytes);await host.verifyExports();
 }finally{await session.close();}
}
module.exports={verify};

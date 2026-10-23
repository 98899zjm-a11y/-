'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto');
async function verify(host){
 host.backend.auth.login({username:'demo-admin',password:'DemoAdmin-2026!'});
 try{
  const customer=await host.backend.dispatch({path:'/api/customers',method:'POST',body:{name:'虚构单号验收客户',phone:'0000'+crypto.randomUUID().replaceAll('-','').slice(0,12),notes:'隔离数据，不对应真实客户'}});
  assert.equal(customer.status,201);const id=customer.data.customer.id;
  const results=await Promise.all(Array.from({length:4},(_,i)=>host.backend.dispatch({path:'/api/quotes',method:'POST',body:{type:'sale',customerId:id,title:'虚构铂金商品'+i,material:'Pt950',weight:1,goldPrice:500,laborPrice:20,note:'仅供隔离单号和备份恢复测试'}})));
  for(const result of results)assert.equal(result.status,201);
  const numbers=results.map(x=>x.data.quote.number);assert.equal(new Set(numbers).size,4);
  numbers.forEach(number=>assert.match(number,/^S\d{8}-\d{6}$/,'new saved quotes must use continuous company-wide numbers'));
  const sequence=numbers.map(x=>Number(x.split('-')[1])).sort((a,b)=>a-b);assert.equal(sequence[3]-sequence[0],3);
  const quote=results[0].data.quote;
  const removed=await host.backend.dispatch({path:'/api/quotes/'+quote.id+'/delete',method:'POST',body:{}});assert.equal(removed.status,200);
  const retained=host.backend.runtime.sqlite.prepare('SELECT status FROM document_number_ledger WHERE quote_id=?').get(quote.id);assert.equal(retained.status,'void','void number must remain auditable');
  const audit=host.backend.runtime.sqlite.prepare("SELECT new_value FROM audit_logs WHERE entity_id=? AND action='create'").get(quote.id);
  assert.equal(JSON.parse(audit.new_value).number,quote.number,'audit must contain the actual allocated number');
 }finally{host.backend.auth.logout();}
}
module.exports={verify};

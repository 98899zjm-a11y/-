'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto');
async function verify(host){
 const sessions=['demo-admin','demo-sales-a','demo-sales-b'].map(username=>{const s=host.backend.createSession();s.auth.login({username,password:{'demo-admin':'DemoAdmin-2026!','demo-sales-a':'DemoEmployee-A-2026!','demo-sales-b':'DemoEmployee-B-2026!'}[username]});return s;});const[admin,a,b]=sessions;
 const phone='000'+crypto.randomInt(10000000,99999999),input={name:'虚构企业共享客户',phone,notes:'仅供公司客户负责人和协作权限隔离验收'};
 try{
  const first=await a.dispatch({path:'/api/customers',method:'POST',body:input});assert.equal(first.status,201);const customer=first.data.customer;
  const duplicate=await b.dispatch({path:'/api/customers',method:'POST',body:input});assert.equal(duplicate.status,409,'same phone must not create a second private customer');assert.equal(duplicate.data.customer,undefined,'invisible existing customer data must not leak');
  const grant=await admin.dispatch({path:'/api/customers/'+customer.id+'/collaborators',method:'POST',body:{staffId:b.auth.status().user.id,granted:true,revision:customer.revision}});assert.equal(grant.status,200);
  const found=await b.dispatch({path:'/api/customers/search?q='+phone,method:'GET'});assert.equal(found.status,200);assert.equal(found.data.customers[0].id,customer.id);assert.equal(found.data.customers[0].access.canEdit,false);
  assert.equal((await b.dispatch({path:'/api/customers',method:'PATCH',body:{id:customer.id,notes:'协作者不应修改档案'}})).status,403);
  async function quote(s,title){const r=await s.dispatch({path:'/api/quotes',method:'POST',body:{type:'sale',customerId:customer.id,title,weight:1,goldPrice:500,laborPrice:20}});assert.equal(r.status,201);return r.data.quote;}
  const old=await quote(a,'虚构负责人报价'),collaborator=await quote(b,'虚构协作报价');assert.ok([403,404].includes((await b.dispatch({path:'/api/quotes/'+old.id,method:'GET'})).status),'customer cooperation must not broaden quote ownership');
  const fresh=await admin.dispatch({path:'/api/customers/search?q='+phone,method:'GET'});const state=fresh.data.customers.find(x=>x.id===customer.id);
  const transferred=await admin.dispatch({path:'/api/customers/'+customer.id+'/transfer',method:'POST',body:{ownerId:b.auth.status().user.id,expectedOwnerId:state.ownerId,revision:state.revision,reason:'虚构离职交接测试'}});assert.equal(transferred.status,200);
  const historic=await a.dispatch({path:'/api/quotes/'+old.id,method:'GET'});assert.equal(historic.status,200);assert.equal(historic.data.quote.ownerId,a.auth.status().user.id);
  const activity=await b.dispatch({path:'/api/customers/'+customer.id+'/activity',method:'GET'});assert.equal(activity.status,200);assert.ok(activity.data.orders.every(x=>x.ownerId===b.auth.status().user.id));
  assert.equal((await a.dispatch({path:'/api/customers/'+customer.id+'/activity',method:'GET'})).status,404);
  const stale=await admin.dispatch({path:'/api/customers',method:'PATCH',body:{id:customer.id,notes:'过时编辑不得覆盖',revision:customer.revision}});assert.equal(stale.status,409);
  const oldDuplicates=host.backend.runtime.sqlite.prepare("SELECT customer_ids FROM customer_identity_conflicts WHERE status='open' LIMIT 1").get();
  if(oldDuplicates){const id=JSON.parse(oldDuplicates.customer_ids)[0],updated=await admin.dispatch({path:'/api/customers',method:'PATCH',body:{id,notes:'旧重复档案保留待核对'}});assert.equal(updated.status,200);assert.equal(host.backend.runtime.sqlite.prepare('SELECT phone_key FROM customers WHERE id=?').get(id).phone_key,null,'editing a legacy duplicate must not arbitrarily make it the company unique customer');}
 }finally{await Promise.all(sessions.map(x=>x.close()));}
}
module.exports={verify};

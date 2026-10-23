'use strict';
// API-level ERP evidence through the same signed legacy proxy used by the app.
// Every object is synthetic and every file is inside the isolated host root.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
async function verify(host){
 const prefix='ERP-'+crypto.randomUUID().slice(0,8),sessions=[];
 const login=(username,password)=>{const s=host.backend.createSession();s.auth.login({username,password});sessions.push(s);return s;};
 let maker=login('demo-admin','DemoAdmin-2026!'),checker=login('demo-reviewer','DemoReviewer-2026!'),employee=login('demo-sales-a','DemoEmployee-A-2026!');
 const failures=[],passed=[];
 const run=async(name,action)=>{try{await action();passed.push(name);console.log('PASS ERP '+name);}catch(error){failures.push(name+': '+error.message);console.error('FAIL ERP '+name+': '+error.message);}};
 async function call(session,address,body,method=body===undefined?'GET':'POST'){
  const result=await session.dispatch({path:'/api/internal-modules/proxy',method:'POST',body:{module:'ledger',path:address,method,...(body!==undefined?{headers:{'content-type':'application/json'},bodyBase64:Buffer.from(JSON.stringify(body)).toString('base64')}:{})}});
  if(result.status!==200)return{status:result.status,data:result.data};
  const raw=Buffer.from(result.data.bodyBase64||'','base64');let data;
  try{data=JSON.parse(raw.toString('utf8'));}catch{data={raw};}
  return{status:result.data.status,data,headers:result.data.headers||{}};
 }
 async function good(session,address,body,method){const result=await call(session,address,body,method);assert.ok(result.status>=200&&result.status<300,address+' returned '+result.status+': '+JSON.stringify(result.data));assert.notEqual(result.data.ok,false);return result.data;}
 const create=async(kind,party,more={})=>(await good(maker,'/erp/api/documents',{requestId:crypto.randomUUID(),kind,partyId:party.id,date:'2026-10-02',note:'仅用于隔离ERP验收',...more})).document;
 const submit=async(doc)=>(await good(maker,'/erp/api/documents/'+doc.id+'/submit',{revision:doc.revision})).document;
 const review=async(doc,session=checker,more={})=>(await good(session,'/erp/api/documents/'+doc.id+'/review',{revision:doc.revision,hash:doc.hash,decision:'approve',note:'另一名员工独立核对',...more})).document;
 const confirm=async(doc)=>review(await submit(doc));
 const bootstrap=async(session=maker)=>(await good(session,'/erp/api/bootstrap')).bills;
 const bill=async(id)=>(await bootstrap()).find(row=>row.id===id);
 const report=async(asOf,party)=>(await good(maker,'/erp/api/reports?asOf='+asOf+'&partyId='+encodeURIComponent(party.id))).report;
 const balance=(r,id)=>{const row=r.rows.find(row=>row.id===id);assert.ok(row,'Report needs traceable bill '+id);return row.balanceCents;};
 let legacy;
 try{
  assert.equal(typeof host.verifyErp,'function','Restricted host must register fixed verify-erp.py modes');
  await host.verifyErp('values');legacy=JSON.parse(await host.verifyErp('baseline'));
  await run('bootstrap keeps old actionable drafts after more than one thousand newer records',async()=>{
   const checkpoint=await host.backupService.create({kind:'manual'});
   try{const volume=JSON.parse(await host.verifyErp('volume'));const large=await good(maker,'/erp/api/bootstrap');assert.ok(large.documents.some(row=>row.id===volume.oldId),'Old actionable draft must not silently disappear');assert.equal(volume.createdCount,1001);}
   finally{await host.restoreService.restore(checkpoint.file,'ledger');maker=login('demo-admin','DemoAdmin-2026!');checker=login('demo-reviewer','DemoReviewer-2026!');employee=login('demo-sales-a','DemoEmployee-A-2026!');}
  });
  const boot=await good(maker,'/erp/api/bootstrap');assert.ok(boot.actor.capabilities.includes('erp.purchase.review'));
  const parties=[];
  for(const [kind,label] of [['supplier','供应商甲'],['supplier','供应商乙'],['customer','客户甲'],['customer','客户乙']]){
   parties.push((await good(maker,'/erp/api/parties',{requestId:crypto.randomUUID(),kind,name:prefix+label,contact:'虚构联系人',phone:'00000000000',termsDays:30,note:'虚构测试单位'})).party);
  }
  const[supplier,otherSupplier,customer,otherCustomer]=parties;
  await run('browser ERP routes have independent sessions, CSRF and bounded payloads',async()=>{
   for(const address of ['/erp/','/erp/static/erp.js','/erp/api/bootstrap','/erp/api/export.xlsx'])assert.equal((await fetch(host.origin+address)).status,401);
   const browser={cookie:'',csrf:''};
   async function http(address,body,extra={}){const response=await fetch(host.origin+address,{method:body?'POST':'GET',headers:{cookie:browser.cookie,...(body?{'content-type':'application/json',origin:host.origin,'x-xjy-csrf':browser.csrf}:{}),...extra},...(body?{body:JSON.stringify(body)}:{})});const cookie=response.headers.get('set-cookie');if(cookie)browser.cookie=cookie.split(';')[0];const raw=await response.text();let data;try{data=JSON.parse(raw);}catch{data={raw};}if(data.csrf)browser.csrf=data.csrf;return{status:response.status,data};}
   await http('/session');await http('/auth/login',{username:'demo-admin',password:'DemoAdmin-2026!'});
   assert.equal((await http('/erp/api/bootstrap')).status,200);assert.equal((await http('/erp/')).status,200);
   assert.equal((await http('/erp/api/parties',{requestId:crypto.randomUUID(),kind:'customer',name:'虚构CSRF拒绝'}, {'x-xjy-csrf':'wrong'})).status,403);
   assert.equal((await http('/erp/api/parties',{requestId:crypto.randomUUID(),kind:'customer',name:'虚构Origin拒绝'}, {origin:'http://other.invalid'})).status,403);
   assert.equal((await http('/erp/api/documents',{requestId:crypto.randomUUID(),kind:[],partyId:customer.id,date:'2026-10-02'})).status,400);
   assert.equal((await http('/erp/api/attachments',{requestId:crypto.randomUUID(),name:'too-big.png',mime:'image/png',bodyBase64:'a'.repeat(3*1024*1024)})).status,413);
   assert.equal((await http('/erp/api/delete-everything')).status,400);
   await http('/auth/logout',{});
  });
  await run('parties retain IDs, duplicate request protection and stale edit rejection',async()=>{
   const payload={requestId:crypto.randomUUID(),kind:'customer',name:'=ERP-EXPORT-'+prefix,contact:'虚构导出客户',phone:'000',termsDays:15,note:'公式字符串必须按普通文字导出'};
   const first=(await good(maker,'/erp/api/parties',payload)).party,next=(await good(maker,'/erp/api/parties',payload)).party;assert.equal(first.id,next.id);
   assert.equal((await call(maker,'/erp/api/parties',{...payload,name:payload.name+'changed'})).status,409);
   const update=(await good(maker,'/erp/api/parties',{requestId:crypto.randomUUID(),kind:first.kind,id:first.id,name:first.name,contact:first.contact,phone:first.phone,termsDays:first.termsDays,active:true,note:'新备注',revision:first.revision})).party;
   assert.equal(update.id,first.id);assert.ok(update.revision>first.revision);
   assert.equal((await call(maker,'/erp/api/parties',{requestId:crypto.randomUUID(),kind:first.kind,id:first.id,name:first.name,contact:first.contact,phone:first.phone,termsDays:first.termsDays,note:'旧页面不能覆盖',active:true,revision:first.revision})).status,409);
   const debt=await confirm(await create('receivable',first,{amount:'12.34',dueDate:'2026-10-02'}));assert.ok(debt.billId);
  });
  await run('module authorization alone does not grant ERP capabilities and revocation is immediate',async()=>{
   const actor=maker.auth.status().user,staff=employee.auth.status().user;
   const old=host.backend.administration.access(staff);
   try{
    host.backend.administration.updatePermissions(actor,{staffId:staff.id,moduleAccess:{ledger:'view'}},()=>maker.auth.listUsers());
    assert.equal((await call(employee,'/erp/api/bootstrap')).status,403);
    host.backend.administration.updateCapabilities(actor,{staffId:staff.id,capabilities:{'erp.read':true,'erp.reports.view':true}},()=>maker.auth.listUsers());
    assert.equal((await call(employee,'/erp/api/bootstrap')).status,200);
    assert.equal((await call(employee,'/erp/api/documents',{requestId:crypto.randomUUID(),kind:'receivable',partyId:customer.id,date:'2026-10-02',amount:'1.00',dueDate:'2026-10-20'})).status,403);
    host.backend.administration.updateCapabilities(actor,{staffId:staff.id,capabilities:{'erp.read':false}},()=>maker.auth.listUsers());
    assert.equal((await call(employee,'/erp/api/bootstrap')).status,403);
   }finally{
    host.backend.administration.updatePermissions(actor,{staffId:staff.id,moduleAccess:old.moduleAccess},()=>maker.auth.listUsers());
    host.backend.administration.updateCapabilities(actor,{staffId:staff.id,capabilities:old.capabilities},()=>maker.auth.listUsers());
   }
  });
  await run('multi-item purchase creates no payable until independently accepted receipts',async()=>{
   const purchase=await create('purchase',supplier,{businessType:'own',dueDate:'2026-10-31',lines:[{description:'虚构铂金链',material:'铂金',purity:'Pt950',quantity:3,estimatedWeight:'15.0000',amount:'3000.00'},{description:'虚构金戒',material:'黄金',purity:'足金',quantity:2,estimatedWeight:'4.0000',amount:'2000.00'}]});
   assert.equal(purchase.lines.length,2);const pending=await submit(purchase);
   assert.equal((await call(maker,'/erp/api/documents/'+purchase.id+'/submit',{revision:purchase.revision})).status,409,'Stale revision cannot submit twice');
   assert.equal((await call(maker,'/erp/api/documents/'+pending.id+'/review',{revision:pending.revision,hash:pending.hash,decision:'approve',note:'自审必须拒绝'})).status,403);
   assert.equal((await call(checker,'/erp/api/documents/'+pending.id+'/review',{revision:pending.revision,hash:'0'.repeat(64),decision:'approve',note:'错误版本必须拒绝'})).status,409);
   const order=await review(pending);assert.equal(order.status,'confirmed');assert.ok(!(await bootstrap()).some(row=>row.sourceId===order.id),'Purchase approval cannot create payable');
   assert.match(supplier.id,/^SUP:\d+$/,'Supplier extension must reuse original supplier primary key');assert.equal(order.partyName,supplier.name);
   const renamed=(await good(maker,'/erp/api/parties',{requestId:crypto.randomUUID(),id:supplier.id,revision:supplier.revision,kind:'supplier',name:supplier.name+'更名',contact:supplier.contact,phone:supplier.phone,termsDays:supplier.termsDays,note:'供应商更名不回写确认单',active:true})).party;
   assert.equal(renamed.id,supplier.id);assert.equal((await good(maker,'/erp/api/documents/'+order.id)).document.partyName,order.partyName,'Confirmed purchase keeps supplier name snapshot');
   const first=await create('receipt',supplier,{sourceId:order.id,date:'2026-10-03',dueDate:'2026-10-31',lines:[{purchaseLineId:order.lines[0].id,quantity:1,actualWeight:'5.1000',amount:'1000.00'}]});
   assert.ok(!(await bootstrap()).some(row=>row.sourceId===first.id),'Draft receipt cannot create payable');
   const received=await confirm(first);assert.ok(received.billId);assert.equal((await bill(received.billId)).amountCents,100000);
   assert.equal((await call(checker,'/erp/api/documents/'+received.id+'/review',{revision:received.revision,hash:received.hash,decision:'approve',note:'重复审核不得重复起账'})).status,409);
   assert.equal((await bootstrap()).filter(row=>row.sourceId===received.id).length,1);
   const second=await confirm(await create('receipt',supplier,{sourceId:order.id,date:'2026-10-04',dueDate:'2026-10-31',lines:[{purchaseLineId:order.lines[0].id,quantity:1,actualWeight:'4.9500',amount:'900.00'}]}));
   assert.equal((await bill(second.billId)).amountCents,90000);
   const earlyOrder=(await report('2026-10-02',supplier)).purchase.find(row=>row.id===order.id),laterOrder=(await report('2026-10-04',supplier)).purchase.find(row=>row.id===order.id);
   assert.equal(earlyOrder.lines[0].receivedQuantity,0);assert.equal(earlyOrder.lines[0].remainingQuantity,3);assert.equal(laterOrder.lines[0].receivedQuantity,2);assert.equal(laterOrder.lines[0].remainingQuantity,1);
   const over=await call(maker,'/erp/api/documents',{requestId:crypto.randomUUID(),kind:'receipt',partyId:supplier.id,date:'2026-10-05',sourceId:order.id,dueDate:'2026-10-31',lines:[{purchaseLineId:order.lines[0].id,quantity:2,actualWeight:'10.0000',amount:'1800.00'}]});
   if(over.status<300){const pendingOver=await submit(over.data.document);assert.equal((await call(checker,'/erp/api/documents/'+pendingOver.id+'/review',{revision:pendingOver.revision,hash:pendingOver.hash,decision:'approve',note:'超收数量拒绝'})).status,409);}else assert.ok([400,409].includes(over.status));
   const mismatch=await call(maker,'/erp/api/documents',{requestId:crypto.randomUUID(),kind:'receipt',partyId:otherSupplier.id,date:'2026-10-05',sourceId:order.id,dueDate:'2026-10-31',lines:[{purchaseLineId:order.lines[1].id,quantity:1,actualWeight:'2',amount:'1000'}]});assert.equal(mismatch.status,400);
   // Only confirmed settlement allocations affect debt; draft rejected amounts do not.
   const partial=await confirm(await create('settlement',supplier,{date:'2026-10-06',direction:'pay',amount:'200.00',account:'虚构银行账户',allocations:[{billId:received.billId,amount:'200.00'}]}));
   assert.equal((await bill(received.billId)).balanceCents,80000);
   const crossParty=await call(maker,'/erp/api/documents',{requestId:crypto.randomUUID(),kind:'settlement',partyId:otherSupplier.id,date:'2026-10-06',direction:'pay',amount:'1.00',account:'虚构账户',allocations:[{billId:received.billId,amount:'1.00'}]});assert.equal(crossParty.status,400);
   const crossDirection=await call(maker,'/erp/api/documents',{requestId:crypto.randomUUID(),kind:'settlement',partyId:supplier.id,date:'2026-10-06',direction:'receive',amount:'1.00',account:'虚构账户',allocations:[{billId:received.billId,amount:'1.00'}]});assert.equal(crossDirection.status,400);
   const overpay=await call(maker,'/erp/api/documents',{requestId:crypto.randomUUID(),kind:'settlement',partyId:supplier.id,date:'2026-10-06',direction:'pay',amount:'801.00',account:'虚构账户',allocations:[{billId:received.billId,amount:'801.00'}]});
   if(overpay.status<300){const pendingOver=await submit(overpay.data.document);assert.equal((await call(checker,'/erp/api/documents/'+pendingOver.id+'/review',{revision:pendingOver.revision,hash:pendingOver.hash,decision:'approve',note:'超付拒绝'})).status,409);}else assert.equal(overpay.status,409);
   const pending1=await submit(await create('settlement',supplier,{date:'2026-10-07',direction:'pay',amount:'500.00',account:'虚构账户',allocations:[{billId:received.billId,amount:'500.00'}]})),pending2=await submit(await create('settlement',supplier,{date:'2026-10-07',direction:'pay',amount:'500.00',account:'虚构账户',allocations:[{billId:received.billId,amount:'500.00'}]}));
   const attempts=await Promise.all([pending1,pending2].map(doc=>call(checker,'/erp/api/documents/'+doc.id+'/review',{revision:doc.revision,hash:doc.hash,decision:'approve',note:'并发最后余额核销'})));
   assert.deepEqual(attempts.map(row=>row.status).sort(),[200,409],'Only one of the two overlapping settlements may commit');assert.equal((await bill(received.billId)).balanceCents,30000);
   const locked=await create('reversal',supplier,{targetId:received.id,date:'2026-10-09',note:'有核销的债务不可直接冲销'});const lockedPending=await submit(locked);assert.equal((await call(checker,'/erp/api/documents/'+lockedPending.id+'/review',{revision:lockedPending.revision,hash:lockedPending.hash,decision:'approve',note:'债务存在核销拒绝'})).status,409);
   const reversal=await confirm(await create('reversal',supplier,{targetId:partial.id,date:'2026-10-10',note:'虚构误记付款，追加相反分录'}));assert.equal(reversal.status,'confirmed');assert.equal((await bill(received.billId)).balanceCents,50000);
   assert.equal(balance(await report('2026-10-05',supplier),received.billId),100000);assert.equal(balance(await report('2026-10-08',supplier),received.billId),30000);assert.equal(balance(await report('2026-10-11',supplier),received.billId),50000);
   const original=(await good(maker,'/erp/api/documents/'+partial.id)).document;assert.equal(original.amountCents,20000,'Reversal cannot rewrite the confirmed amount');assert.ok(original.events.length>=3,'Original approval trail is retained');
  });
  await run('consignment acceptance does not post owned payable',async()=>{
   const order=await confirm(await create('purchase',otherSupplier,{businessType:'consignment',dueDate:'2026-10-31',lines:[{description:'虚构寄售货品',material:'黄金',purity:'足金',quantity:1,estimatedWeight:'1.0000',amount:'500.00'}]}));
   const receipt=await confirm(await create('receipt',otherSupplier,{sourceId:order.id,dueDate:'2026-10-31',lines:[{purchaseLineId:order.lines[0].id,quantity:1,actualWeight:'1.0010',amount:'500.00'}]}));assert.ok(!receipt.billId);assert.ok(!(await bootstrap()).some(row=>row.sourceId===receipt.id));
  });
  await run('explicit receivable source, opening evidence and multi-bill partial collections',async()=>{
   const first=await confirm(await create('receivable',customer,{amount:'500.00',dueDate:'2026-10-02',sourceSaleId:legacy.legacySaleId})),second=await confirm(await create('receivable',customer,{amount:'300.00',dueDate:'2026-10-31'})),unrelated=await confirm(await create('receivable',otherCustomer,{amount:'100.00',dueDate:'2026-10-31'}));
   assert.equal(first.payload.sourceSaleId,legacy.legacySaleId);assert.equal(String(first.payload.sourceSnapshot?.amount_c),'500.37','Confirmed receivable retains original financial amount evidence');assert.equal(String(first.payload.sourceSnapshot?.received),'123.45');assert.ok(!Object.keys(first.payload.sourceSnapshot).some(key=>/cost|profit|comm/i.test(key)),'Source snapshot cannot disclose costs or profit');
   assert.equal((await call(maker,'/erp/api/documents',{requestId:crypto.randomUUID(),kind:'receivable',partyId:customer.id,date:'2026-10-02',amount:'500.00',dueDate:'2026-10-31',sourceSaleId:legacy.legacySaleId})).status,409,'Same old financial row must not create duplicate receivable');
   assert.equal((await call(maker,'/erp/api/documents',{requestId:crypto.randomUUID(),kind:'opening_payable',partyId:otherSupplier.id,date:'2026-10-02',amount:'77.55',dueDate:'2026-10-31'})).status,400,'Opening balance needs an explicit basis');
   const opening=await confirm(await create('opening_payable',otherSupplier,{amount:'77.55',dueDate:'2026-10-31',evidence:'虚构上期期末双方确认记录'}));assert.equal((await bill(opening.billId)).amountCents,7755);
   const payload={requestId:crypto.randomUUID(),kind:'settlement',partyId:customer.id,date:'2026-10-08',direction:'receive',amount:'400.00',account:'虚构现金账户',note:'一笔收款分配两张单',allocations:[{billId:first.billId,amount:'250.00'},{billId:second.billId,amount:'150.00'}]};
   const created=(await good(maker,'/erp/api/documents',payload)).document;assert.equal((await good(maker,'/erp/api/documents',payload)).document.id,created.id);assert.equal((await call(maker,'/erp/api/documents',{...payload,amount:'399.00'})).status,409);
   await confirm(created);assert.equal((await bill(first.billId)).balanceCents,25000);assert.equal((await bill(second.billId)).balanceCents,15000);assert.equal((await bill(unrelated.billId)).balanceCents,10000);
   const r=await report('2026-10-14',customer);assert.equal(balance(r,first.billId),25000);assert.equal(balance(r,second.billId),15000);assert.ok(r.aging.length,'Report must separate due/overdue categories');
  });
  await run('server filters sensitive payable data and produces actual safe XLSX',async()=>{
   const actor=maker.auth.status().user,staff=employee.auth.status().user,old=host.backend.administration.access(staff);
   try{
    host.backend.administration.updatePermissions(actor,{staffId:staff.id,moduleAccess:{ledger:'view'}},()=>maker.auth.listUsers());host.backend.administration.updateCapabilities(actor,{staffId:staff.id,capabilities:{'erp.read':true,'erp.reports.view':true,'erp.reports.sensitive':false}},()=>maker.auth.listUsers());
    const limited=await good(employee,'/erp/api/bootstrap');assert.ok(limited.bills.every(row=>row.kind!=='payable'),'AP money cannot leak through bootstrap');
    const hasMoney=value=>value&&typeof value==='object'&&Object.entries(value).some(([key,child])=>['amount','amountCents','balanceCents','settledCents','totalCents','cost'].includes(key)||hasMoney(child));
    for(const row of limited.documents){const sensitive=['purchase','receipt','opening_payable'].includes(row.kind)||row.kind==='settlement'&&row.payload?.direction==='pay';if(sensitive)assert.ok(!hasMoney(row),'Nested payload cannot bypass sensitive-column filtering');}
    const limitedReport=(await good(employee,'/erp/api/reports?asOf=2026-10-14')).report;assert.ok(limitedReport.rows.every(row=>row.kind!=='payable'),'AP money cannot leak through report');
    const exported=await call(maker,'/erp/api/export.xlsx?asOf=2026-10-14');assert.equal(exported.status,200);assert.ok(Buffer.isBuffer(exported.data.raw));assert.equal(exported.data.raw.subarray(0,2).toString(),'PK');
    const owned=host.policy.guard.assertPath(path.join(host.root,'data','documents','erp-report-fixture.xlsx'));fs.writeFileSync(owned,exported.data.raw);await host.verifyErp('exports');
   }finally{host.backend.administration.updatePermissions(actor,{staffId:staff.id,moduleAccess:old.moduleAccess},()=>maker.auth.listUsers());host.backend.administration.updateCapabilities(actor,{staffId:staff.id,capabilities:old.capabilities},()=>maker.auth.listUsers());}
  });
  await run('controlled attachments reject traversal, scripts and mismatched file content',async()=>{
   const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNoaGj4DwAFhAKAjM1mJgAAAABJRU5ErkJggg==';
   const input={requestId:crypto.randomUUID(),name:'虚构凭证.png',mime:'image/png',bodyBase64:png};
   const stored=(await good(maker,'/erp/api/attachments',input)).attachment;assert.ok(stored.id);assert.ok(stored.size>0);
   const downloaded=await call(maker,'/erp/api/attachments/'+stored.id);assert.equal(downloaded.status,200);assert.deepEqual(downloaded.data.raw,Buffer.from(png,'base64'));
   assert.equal((await call(maker,'/erp/api/attachments',{...input,requestId:crypto.randomUUID(),name:'../escape.png'})).status,400);
   assert.equal((await call(maker,'/erp/api/attachments',{...input,requestId:crypto.randomUUID(),name:'unsafe.html',mime:'text/html',bodyBase64:Buffer.from('<script>alert(1)</script>').toString('base64')})).status,400);
   assert.equal((await call(maker,'/erp/api/attachments',{...input,requestId:crypto.randomUUID(),bodyBase64:Buffer.from('not an image').toString('base64')})).status,400);
   const linked=await confirm(await create('receivable',customer,{amount:'1.00',dueDate:'2026-10-31',attachments:[stored.id]}));assert.ok(linked.billId);
   const stranger=host.backend.createSession();sessions.push(stranger);assert.equal((await call(stranger,'/erp/api/attachments/'+stored.id)).status,401);
  });
  await run('backdated debt reversal cannot make an intervening historical balance negative',async()=>{
   const source=await confirm(await create('receivable',customer,{date:'2026-10-01',amount:'10.00',dueDate:'2026-10-31'}));
   const collected=await confirm(await create('settlement',customer,{date:'2026-10-03',direction:'receive',amount:'10.00',account:'虚构现金账户',allocations:[{billId:source.billId,amount:'10.00'}]}));
   await confirm(await create('reversal',customer,{date:'2026-10-10',targetId:collected.id,note:'先冲销资金'}));
   const reversal=await submit(await create('reversal',customer,{date:'2026-10-05',targetId:source.id,note:'倒填欠款冲销必须拒绝'}));
   assert.equal((await call(checker,'/erp/api/documents/'+reversal.id+'/review',{revision:reversal.revision,hash:reversal.hash,decision:'approve',note:'历史日期余额检查'})).status,409);
   assert.equal(balance(await report('2026-10-06',customer),source.billId),0);
   assert.equal(balance(await report('2026-10-11',customer),source.billId),1000);
  });
  await run('sensitive reversal needs target permission for rejection and submission after revocation',async()=>{
   const actor=maker.auth.status().user,staff=employee.auth.status().user,old=host.backend.administration.access(staff);
   const payable=await confirm(await create('opening_payable',otherSupplier,{amount:'5.00',dueDate:'2026-10-31',evidence:'仅用于敏感冲销权限的虚构期初'}));
   try{
    host.backend.administration.updatePermissions(actor,{staffId:staff.id,moduleAccess:{ledger:'manage'}},()=>maker.auth.listUsers());
    host.backend.administration.updateCapabilities(actor,{staffId:staff.id,capabilities:{'erp.read':true,'erp.reversal.prepare':true,'erp.reversal.review':true,'erp.reports.sensitive':false}},()=>maker.auth.listUsers());
    const pending=await submit(await create('reversal',otherSupplier,{date:'2026-10-14',targetId:payable.id,note:'复核目标敏感权限验收'}));
    assert.equal((await call(employee,'/erp/api/documents/'+pending.id+'/review',{revision:pending.revision,hash:pending.hash,decision:'reject',note:'无成本权限应拒绝退回操作'})).status,403);
    host.backend.administration.updateCapabilities(actor,{staffId:staff.id,capabilities:{'erp.reports.sensitive':true}},()=>maker.auth.listUsers());
    const owned=(await good(employee,'/erp/api/documents',{requestId:crypto.randomUUID(),kind:'reversal',partyId:otherSupplier.id,date:'2026-10-14',targetId:payable.id,note:'撤权后不可提交'})).document;
    host.backend.administration.updateCapabilities(actor,{staffId:staff.id,capabilities:{'erp.reports.sensitive':false}},()=>maker.auth.listUsers());
    assert.equal((await call(employee,'/erp/api/documents/'+owned.id+'/submit',{revision:owned.revision})).status,403);
   }finally{host.backend.administration.updatePermissions(actor,{staffId:staff.id,moduleAccess:old.moduleAccess},()=>maker.auth.listUsers());host.backend.administration.updateCapabilities(actor,{staffId:staff.id,capabilities:old.capabilities},()=>maker.auth.listUsers());}
  });
  await run('backup and restore reject ERP voucher files inconsistent with database evidence',async()=>{
   const stored=(await good(maker,'/erp/api/attachments',{requestId:crypto.randomUUID(),name:'备份一致性.png',mime:'image/png',bodyBase64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNoaGj4DwAFhAKAjM1mJgAAAABJRU5ErkJggg=='})).attachment;
   await confirm(await create('receivable',customer,{amount:'1.00',dueDate:'2026-10-31',attachments:[stored.id]}));
   const filename=host.policy.guard.assertPath(path.join(host.layout.ledgerDir,'erp-attachments',stored.id+'.bin')),original=fs.readFileSync(filename);
   const badFixture=host.policy.guard.assertPath(path.join(host.root,'logs','erp-invalid-backup-fixture.json'));
   try{fs.writeFileSync(filename,'broken synthetic voucher');await assert.rejects(async()=>{const invalid=await host.backupService.create({kind:'manual'});fs.writeFileSync(badFixture,JSON.stringify({name:path.basename(invalid.file),syntheticOnly:true}));},/ERP.*attachment|ERP.*voucher/i);}
   finally{fs.writeFileSync(filename,original);}
   if(fs.existsSync(badFixture)){
    const bad=JSON.parse(fs.readFileSync(badFixture)),target=host.policy.guard.assertPath(path.join(host.layout.backupDir,bad.name));assert.equal(bad.syntheticOnly,true);assert.equal(bad.name,path.basename(bad.name));
    const current=fs.readFileSync(host.policy.guard.assertPath(path.join(host.layout.ledgerDir,'ledger.db')));
    await assert.rejects(host.backupService.verifyAndStage(target),/ERP.*attachment|ERP.*voucher/i);
    await assert.rejects(host.restoreService.restore(target,'ledger'),/ERP.*attachment|ERP.*voucher/i);
    assert.deepEqual(fs.readFileSync(host.policy.guard.assertPath(path.join(host.layout.ledgerDir,'ledger.db'))),current,'Refused staging never publishes over live ledger');
    assert.equal(maker.auth.status().authenticated,true);
   }
  });
  await run('legacy stored finance values, sales and stock remain unchanged',async()=>{const outcome=JSON.parse(await host.verifyErp('check'));assert.equal(outcome.passed,true);});
  await run('unified encrypted backup restores ERP attachments without reusing document numbers',async()=>{
   const saved=await host.backupService.create({kind:'manual'});assert.equal(saved.encrypted,true);
   const staged=await host.backupService.verifyAndStage(saved.file);assert.equal(staged.databases.length,3);assert.ok(staged.databases.every(row=>row.integrity==='ok'));
   const freshPayload={requestId:crypto.randomUUID(),kind:'receivable',partyId:customer.id,date:'2026-10-12',amount:'1.23',dueDate:'2026-10-31',note:'回退前的已知编号不得再次使用'};
   const before=(await good(maker,'/erp/api/documents',freshPayload)).document;
   await host.restoreService.restore(saved.file,'ledger');
   assert.equal((await call(maker,'/erp/api/bootstrap')).status,401,'Restore requires a fresh browser/software login');
   const freshMaker=login('demo-admin','DemoAdmin-2026!');
   const after=(await good(freshMaker,'/erp/api/documents',{...freshPayload,requestId:crypto.randomUUID()})).document;
   assert.notEqual(after.number,before.number,'Financial restore cannot reuse an already known ERP number');
   const n=number=>{const match=String(number).match(/(\d+)$/);assert.ok(match,'ERP number needs a continuous numeric suffix');return BigInt(match[1]);};assert.ok(n(after.number)>n(before.number));
   const restoredBoot=await good(freshMaker,'/erp/api/bootstrap');const linked=restoredBoot.documents.find(row=>row.payload?.attachments?.length);
   assert.ok(linked,'ERP voucher source survives restored ledger');
   const restoredAttachment=await call(freshMaker,'/erp/api/attachments/'+linked.payload.attachments[0]);assert.equal(restoredAttachment.status,200);assert.equal(restoredAttachment.data.raw.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
   assert.equal(JSON.parse(await host.verifyErp('check')).passed,true);
  });
 }catch(error){failures.push('ERP setup or finalization: '+error.message);}
 finally{
  const closed=await Promise.allSettled(sessions.map(s=>s.close()));
  for(const result of closed)if(result.status==='rejected')failures.push('Session cleanup: '+result.reason.message);
  fs.writeFileSync(host.policy.guard.assertPath(path.join(host.root,'logs','erp-integration-results.json')),JSON.stringify({at:new Date().toISOString(),passed,failures,total:passed.length+failures.length,success:failures.length===0},null,2));
 }
 console.log('ERP INTEGRATION '+passed.length+' passed, '+failures.length+' failed');assert.equal(failures.length,0,failures.join('\n'));
}
module.exports={verify};

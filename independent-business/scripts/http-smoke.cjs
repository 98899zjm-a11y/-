'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {clients,approvedReceivable}=require('./http-fixtures.cjs');
const BASE=path.resolve(__dirname,'..'),root=path.join(BASE,'runtime','http-'+crypto.randomUUID()),port=31842,origin='http://127.0.0.1:'+port;
(async()=>{const report={started:new Date().toISOString(),checks:[]};let child;
try{
 child=spawn('C:/Python314/python.exe',['-B','-m','host','--root',root,'--port',String(port),'--demo-init','--parent-watch'],{cwd:BASE,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',PYTHONIOENCODING:'utf-8',TEMP:path.join(BASE,'runtime-temp'),TMP:path.join(BASE,'runtime-temp')},windowsHide:true,stdio:['pipe','pipe','pipe']});child.stderr.resume();
 await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('测试服务未就绪')),20000);child.once('error',reject);child.once('exit',code=>reject(Error('测试服务退出 '+code)));child.stdout.on('data',chunk=>{text+=chunk.toString();for(const line of text.split('\n')){try{const v=JSON.parse(line);if(v.type==='ready'){assert.equal(v.pid,child.pid);assert.equal(v.port,port);clearTimeout(timer);resolve();}}catch(error){if(error.code==='ERR_ASSERTION'){clearTimeout(timer);reject(error);}}}});});
 const c=await clients(origin,JSON.parse(fs.readFileSync(path.join(root,'demo-credentials.json'),'utf8'))),{document,party}=await approvedReceivable(c);
 const release=(await c.finance_reviewer.call('/erp/api/cashier-source-releases',{requestId:crypto.randomUUID(),billId:document.id,revision:document.revision,hash:document.hash,note:'虚构发布'})).release;
 const account=(await c.admin.call('/cashier/api/accounts',{requestId:crypto.randomUUID(),code:'HTTP-TEST',name:'虚构并发现金账户',kind:'cash',currency:'CNY'})).account;
 for(const name of ['cashier_maker','cashier_reviewer'])await c.admin.call('/cashier/api/accounts/'+account.id+'/scopes',{requestId:crypto.randomUUID(),staffId:c[name].user.staffId,level:name==='cashier_maker'?'operate':'manage',revision:0,note:'虚构授权'});
 const submit=async(client,d)=>(await client.call('/cashier/api/documents/'+d.id+'/submit',{requestId:crypto.randomUUID(),revision:d.revision})).document;
 const approve=async(client,d,status=200)=>client.call('/cashier/api/documents/'+d.id+'/review',{requestId:crypto.randomUUID(),revision:d.revision,hash:d.frozenHash,decision:'approve',note:'虚构复核'},'POST',status);
 const opening=(await c.cashier_reviewer.call('/cashier/api/documents',{requestId:crypto.randomUUID(),accountId:account.id,kind:'opening',businessDate:'2026-10-23',amountCents:'10000',note:'虚构开账',evidence:'虚构现金100.00元'})).document;
 await approve(c.admin,await submit(c.cashier_reviewer,opening));
 const pending=[];for(let i=0;i<2;i++){const draft=(await c.cashier_maker.call('/cashier/api/documents',{requestId:crypto.randomUUID(),accountId:account.id,kind:'receive',businessDate:'2026-10-23',amountCents:'7000',note:'虚构并发收款',partyId:party.id,allocations:[{releaseId:release.id,amountCents:'7000'}]})).document;pending.push(await submit(c.cashier_maker,draft));}
 // Independent real HTTP sessions through Waitress, not Flask test_client.
 const reviewerA=c.cashier_reviewer;
 const results=await Promise.allSettled(pending.map(d=>approve(reviewerA,d)));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
 assert.equal(results.find(r=>r.status==='rejected').reason.actual,409,'被拒绝的并发核销应为余额冲突，而非其他服务错误');
 const bill=(await c.finance_reviewer.call('/erp/api/bootstrap')).bills.find(b=>b.id===document.id);assert.equal(bill.balanceCents,3000);
 report.checks.push('真实Waitress HTTP多会话登录、来源发布、期初与资金复核','两笔70元并发收款仅一笔成功，100元应收剩30元');report.passed=true;
}catch(error){report.passed=false;report.error=error.message;process.exitCode=1;}
finally{if(child&&child.exitCode===null){child.stdin.end();await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('测试子服务未正常结束')),15000);child.once('exit',code=>{clearTimeout(timer);report.serverExit=code;resolve();});}).catch(error=>{report.shutdownError=error.message;report.passed=false;process.exitCode=1;});}report.ended=new Date().toISOString();fs.writeFileSync(path.join(BASE,'artifacts/http-smoke-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}})();

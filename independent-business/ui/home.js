'use strict';
(async()=>{
  const set=(id,value)=>{document.getElementById(id).textContent=value;};
  document.getElementById('logout').addEventListener('click',async()=>{try{const response=await fetch('/auth/logout',{method:'POST'});if(!response.ok)throw Error();location.replace('/login');}catch{set('load-notice','退出未确认，请重试。');}});
  set('today',new Intl.DateTimeFormat('zh-CN',{dateStyle:'full',timeZone:'Asia/Shanghai'}).format(new Date()));
  try{const response=await fetch('/auth/me',{cache:'no-store'});if(!response.ok){location.replace('/login');return;}const me=await response.json();set('current-user',me.name||me.username||me.user?.name||me.user?.username||'当前账户');if(!['finance_reviewer','admin'].includes(me.role||me.user?.role))document.querySelector('a[href="/finance-handoff"]').hidden=true;}
  catch{set('current-user','账户读取失败');}
  const load=async url=>{const response=await fetch(url,{cache:'no-store'});const value=await response.json();if(!response.ok||value.ok===false)throw Error(value.error||'未授权');return value;};
  const [erp,cashier]=await Promise.allSettled([load('/erp/api/bootstrap'),load('/cashier/api/bootstrap')]);
  if(erp.status==='fulfilled'){const rows=erp.value.documents||[];set('erp-documents',`${rows.length} 张单据`);set('erp-pending',`${rows.filter(d=>d.status==='pending').length} 张待审核`);}
  else{set('erp-documents','当前账户无权查看或服务暂不可用');set('erp-pending','');}
  if(cashier.status==='fulfilled'){set('cashier-accounts',`${(cashier.value.accounts||[]).length} 个授权账户`);try{const documents=await load('/cashier/api/documents?limit=100');const count=(documents.documents||[]).length;set('cashier-documents',`${count} 张${count===100?'当前页':''}资金凭证`);}catch{set('cashier-documents','凭证暂不可读取');}}
  else{set('cashier-accounts','当前账户无权查看或服务暂不可用');set('cashier-documents','');}
  if(erp.status==='rejected'||cashier.status==='rejected')set('load-notice','仅展示当前账户有权读取的数据；缺少授权时请联系独立工作台管理员。');
})();

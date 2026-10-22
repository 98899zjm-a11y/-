'use strict';
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
async function loginClient(origin,username,password){
  const response=await fetch(origin+'/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({username,password}),signal:AbortSignal.timeout(15000)});
  const login=await response.json();assert.equal(response.status,200,'虚构测试登录失败');
  const cookie=response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
  const call=async(url,body,method=body?'POST':'GET',status=200)=>{const r=await fetch(origin+url,{method,headers:{Origin:origin,Cookie:cookie,'X-CSRF-Token':login.csrfToken,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});const value=await r.json();assert.equal(r.status,status,url+': '+(value.error||r.status));return value;};
  return{call,user:login.user};
}
async function clients(origin,credentials){const result={};for(const name of ['finance_maker','finance_reviewer','cashier_maker','cashier_reviewer','admin'])result[name]=await loginClient(origin,name,credentials[name].password);return result;}
async function approvedReceivable(c){const maker=c.finance_maker.call,reviewer=c.finance_reviewer.call;
  const party=(await maker('/erp/api/parties',{requestId:randomUUID(),kind:'customer',name:'虚构界面客户-'+randomUUID().slice(0,8)})).party;
  let document=(await maker('/erp/api/documents',{requestId:randomUUID(),kind:'receivable',partyId:party.id,date:'2026-10-23',amount:'100.00'})).document;
  document=(await maker('/erp/api/documents/'+document.id+'/submit',{revision:document.revision})).document;
  document=(await reviewer('/erp/api/documents/'+document.id+'/review',{revision:document.revision,hash:document.hash,decision:'approve',note:'虚构测试复核'})).document;
  return{party,document};
}
module.exports={clients,approvedReceivable};

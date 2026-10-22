'use strict';
(() => {
  const $=id=>document.getElementById(id);let bills=[],releases=[];
  const notice=text=>{$('release-status').textContent=text;};
  async function api(url,body){const response=await fetch(url,{method:body?'POST':'GET',credentials:'same-origin',headers:body?{'Content-Type':'application/json'}:{},...(body?{body:JSON.stringify(body)}:{})});const result=await response.json();if(!response.ok||result.ok===false)throw Error(result.error||'操作未确认');return result;}
  async function load(){
    const [data,history]=await Promise.all([api('/erp/api/bootstrap'),api('/integration/api/releases')]);bills=data.bills;releases=history.releases;
    $('bill').replaceChildren(new Option('请选择未发布的已审核往来单',''));
    const published=new Set(releases.filter(row=>row.status==='published').map(row=>row.billId));
    for(const bill of bills.filter(row=>row.balanceCents>0&&!published.has(row.id)))$('bill').add(new Option(`${bill.number} / ${bill.partyName}`,bill.id));
    $('release-rows').replaceChildren();
    for(const row of releases){const tr=document.createElement('tr');for(const value of [row.number,row.partyName,row.status==='published'?'已发布':'已撤回']){const td=document.createElement('td');td.textContent=value;td.style.padding='14px 8px';tr.append(td);}const td=document.createElement('td');if(row.status==='published'){const button=document.createElement('button');button.type='button';button.textContent='撤回';button.className='quiet';button.addEventListener('click',()=>act(async()=>{const note=$('release-note').value.trim();if(!note)throw Error('请先填写撤回原因。');await api('/erp/api/cashier-source-releases/'+row.id+'/revoke',{requestId:crypto.randomUUID(),revision:row.revision,note});await load();notice('已撤回，历史收付款与记录保留。');}));td.append(button);}tr.append(td);$('release-rows').append(tr);}
  }
  async function act(task){try{await task();}catch(error){notice(error.message);}}
  $('release-form').addEventListener('submit',event=>{event.preventDefault();void act(async()=>{const id=$('bill').value,note=$('release-note').value.trim();if(!id||!note)throw Error('请选择单据并填写交接说明。');const {document}=await api('/erp/api/documents/'+encodeURIComponent(id));await api('/erp/api/cashier-source-releases',{requestId:crypto.randomUUID(),billId:id,revision:document.revision,hash:document.hash,note});await load();notice('已发布给出纳，尚未收付款。');});});
  void act(load);
})();

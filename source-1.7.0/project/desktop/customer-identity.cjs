'use strict';
function normalizePhone(value){
 const raw=String(value||'').normalize('NFKC').trim();if(!raw)return null;
 if(!/^[+\d\s().-]+$/.test(raw))return'raw:'+raw.toLowerCase();
 let compact=raw.replace(/[\s().-]/g,'');if(/^00[1-9]\d{6,14}$/.test(compact))compact='+'+compact.slice(2);
 if(/^\+?86(1\d{10})$/.test(compact))compact=compact.replace(/^\+?86/,'');
 if(/^1\d{10}$/.test(compact))return'e164:+86'+compact;
 if(/^\+[1-9]\d{6,14}$/.test(compact))return'e164:'+compact;
 return'local:'+compact;
}
function reconcile(sqlite){
 const rows=sqlite.prepare('SELECT id,phone FROM customers WHERE deleted_at IS NULL').all(),groups=new Map();
 for(const row of rows){const key=normalizePhone(row.phone);if(key){if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row.id);}}
 sqlite.exec('BEGIN IMMEDIATE');try{
  for(const[key,ids]of groups){if(ids.length===1){sqlite.prepare('UPDATE customers SET phone_key=? WHERE id=? AND (phone_key IS NULL OR phone_key<>?)').run(key,ids[0],key);}else{
   for(const id of ids)sqlite.prepare('UPDATE customers SET phone_key=NULL WHERE id=?').run(id);
   const old=sqlite.prepare('SELECT customer_ids,status FROM customer_identity_conflicts WHERE phone_key=?').get(key),value=JSON.stringify(ids.sort());
   if(!old||old.customer_ids!==value||old.status!=='open')sqlite.prepare("INSERT INTO customer_identity_conflicts(phone_key,customer_ids,status,detected_at) VALUES(?,?,'open',?) ON CONFLICT(phone_key) DO UPDATE SET customer_ids=excluded.customer_ids,status='open',detected_at=excluded.detected_at").run(key,value,new Date().toISOString());
  }}sqlite.exec('COMMIT');
 }catch(error){sqlite.exec('ROLLBACK');throw error;}
}
module.exports={normalizePhone,reconcile};

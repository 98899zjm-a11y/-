'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
test('crash recovery at each dataset swap boundary restores a complete old dataset and is idempotent',()=>{
 const base=path.resolve(__dirname,'..'),guard=require('../stage1/isolation.cjs').createIsolationGuard(base);
 for(let swapped=0;swapped<=3;swapped++)for(const published of [false,true]){
  const root=guard.assertPath(path.join(base,'data','restore-crash-'+crypto.randomUUID())),id=crypto.randomUUID(),namespace=crypto.randomUUID(),stage=path.join(root,'runtime','restore-stage',crypto.randomUUID());fs.mkdirSync(stage,{recursive:true});fs.writeFileSync(path.join(root,'isolation-identity.json'),JSON.stringify({namespace}));
  const names=['sales','ledger','inventory'],slots=Object.fromEntries(names.map(n=>[n,path.join(root,'data',n)])),previous=path.join(root,'runtime','restorations',id);fs.mkdirSync(previous,{recursive:true});
  for(const [i,n]of names.entries()){fs.mkdirSync(slots[n],{recursive:true});fs.writeFileSync(path.join(slots[n],'proof'),'old-'+n);fs.mkdirSync(path.join(stage,n));fs.writeFileSync(path.join(stage,n,'proof'),'new-'+n);if(i<swapped){fs.renameSync(slots[n],path.join(previous,'previous-'+n));if(published)fs.renameSync(path.join(stage,n),slots[n]);}}
  fs.writeFileSync(path.join(root,'runtime','restore-transaction.json'),JSON.stringify({version:1,namespace,id,stage,selected:names,state:'SWAPPING'}));
  const localGuard=require('../stage1/isolation.cjs').createIsolationGuard(root),policy={check:(p)=>localGuard.assertPath(p)};const service=require('../stage1/restore-service.cjs').createRestoreService({root,layout:{dataDir:slots.sales,ledgerDir:slots.ledger,inventoryDir:slots.inventory},policy});
  assert.equal(service.recover().recovered,true);for(const n of names)assert.equal(fs.readFileSync(path.join(slots[n],'proof'),'utf8'),'old-'+n);assert.equal(service.recover().recovered,false);
 }
});

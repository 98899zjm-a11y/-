'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
async function verify(host){
 assert.equal(typeof host.restoreService?.restore,'function','a guarded publication service is required, staging alone is not recovery');
 const files={sales:path.join(host.layout.dataDir,'restore-proof.txt'),ledger:path.join(host.layout.ledgerDir,'restore-proof.txt'),inventory:path.join(host.layout.inventoryDir,'restore-proof.txt')};
 for(const file of Object.values(files))fs.writeFileSync(file,'虚构备份前');
 const saved=await host.backupService.create({kind:'manual'});
 for(const file of Object.values(files))fs.writeFileSync(file,'虚构备份后');
 const printed=host.layout.dataDir+'.print-ledger.json',current=fs.existsSync(printed)?JSON.parse(fs.readFileSync(printed)):{version:1,jobs:[]};const sent={id:crypto.randomUUID(),actorId:crypto.randomUUID(),requestId:crypto.randomUUID(),quoteId:crypto.randomUUID(),kind:'warranty',paramsHash:'0'.repeat(64),status:'submitted',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};current.jobs.push(sent);fs.writeFileSync(printed,JSON.stringify(current));
 const db=host.backend.runtime.sqlite,scope='S20300101';db.prepare('INSERT INTO document_sequences(scope,last_value) VALUES(?,?) ON CONFLICT(scope) DO UPDATE SET last_value=max(last_value,excluded.last_value)').run(scope,73);
 await host.restoreService.restore(saved.file,'ledger');
 assert.equal(fs.readFileSync(files.ledger,'utf8'),'虚构备份前');assert.equal(fs.readFileSync(files.sales,'utf8'),'虚构备份后');assert.equal(fs.readFileSync(files.inventory,'utf8'),'虚构备份后');
 await host.restoreService.restore(saved.file,'sales');assert.equal(fs.readFileSync(files.sales,'utf8'),'虚构备份前');assert.equal(host.backend.runtime.sqlite.prepare('SELECT last_value FROM document_sequences WHERE scope=?').get(scope).last_value,73);assert.equal(JSON.parse(fs.readFileSync(printed)).jobs.find(x=>x.id===sent.id).status,'submitted');
 for(const file of Object.values(files))fs.writeFileSync(file,'虚构失败前完整数据');
 await assert.rejects(host.restoreService.restore(saved.file,'allBusiness',{fault:'after-first-publish'}),/injected/);
 for(const file of Object.values(files))assert.equal(fs.readFileSync(file,'utf8'),'虚构失败前完整数据','failed multi-dataset publication must restore the complete previous datasets');
 await assert.rejects(host.restoreService.restore(saved.file,'config'),/selection/);
 const r=await host.restoreService.restore(saved.file,'inventory');assert.ok(r.preRestore);assert.equal(fs.readFileSync(files.inventory,'utf8'),'虚构备份前');
 host.backend.auth.login({username:'demo-admin',password:'DemoAdmin-2026!'});assert.equal((await host.backend.dispatch({path:'/api/bootstrap',method:'GET'})).status,200);host.backend.auth.logout();
 assert.ok(host.backupService.list().some(x=>x.kind==='pre-restore'));
 const documents=path.join(host.root,'data','documents');for(const name of fs.readdirSync(documents)){const target=host.policy.check(path.join(documents,name),true);if(fs.lstatSync(target).isFile())fs.unlinkSync(target);else throw new Error('Unexpected test document subdirectory');}
 const empty=await host.backupService.create({kind:'manual'});await host.restoreService.restore(empty.file,'allBusiness');assert.deepEqual(fs.readdirSync(documents),[],'a valid empty documents dataset must restore as empty');
}
module.exports={verify};

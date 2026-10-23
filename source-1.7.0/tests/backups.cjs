'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
async function verify({root,layout,policy,backend,withFrozen}){
 const backups=require('../stage1/backups.cjs');
 assert.equal(typeof backups.createBackupService,'function','unified encrypted backup service required');
 const service=backups.createBackupService({root,layout,policy,withFrozen,salesDatabase:()=>backend.runtime.sqlite});
 const attachment=path.join(layout.dataDir,'backup-fixture.txt');fs.writeFileSync(attachment,'虚构附件-备份前');
 const saved=await service.create({kind:'manual'});
 assert.equal(fs.readdirSync(path.join(root,'runtime','snapshots')).length,0,'plaintext database snapshot scratch must be removed after creating encrypted archive');
 const bytes=fs.readFileSync(saved.file);assert.equal(bytes.includes(Buffer.from('虚构附件-备份前')),false,'archive must actually encrypt content');
 const restored=await service.verifyAndStage(saved.file);
 assert.equal(fs.readFileSync(path.join(restored.directory,'sales','backup-fixture.txt'),'utf8'),'虚构附件-备份前');
 assert.deepEqual(restored.databases.map(x=>x.integrity),['ok','ok','ok']);
 assert.equal(restored.databases.length,3,'all three databases must be included');
 const tampered=path.join(layout.backupDir,'tampered.xjybak');const modified=Buffer.from(bytes);modified[modified.length-20]^=1;fs.writeFileSync(tampered,modified);
 await assert.rejects(service.verifyAndStage(tampered),/authenticate|integrity|JSON|archive|record/i);
 assert.equal(fs.readFileSync(attachment,'utf8'),'虚构附件-备份前','failed restore must leave active data untouched');
 const oldAuto=await service.create({kind:'auto',now:new Date(Date.now()-8*86400000)});
 const oldManual=await service.create({kind:'manual',now:new Date(Date.now()-9*86400000)});
 const futureAuto=await service.create({kind:'auto',now:new Date(Date.now()+86400000)});
 const removed=await service.cleanup();assert.ok(removed.includes(oldAuto.file));assert.ok(!fs.existsSync(oldAuto.file));assert.ok(fs.existsSync(oldManual.file));assert.ok(fs.existsSync(futureAuto.file));assert.ok(fs.existsSync(tampered));
 const user=backend.auth.login({username:'demo-admin',password:'DemoAdmin-2026!'}).user;
 const resumed=await backend.dispatch({path:'/api/internal-modules/proxy',method:'POST',body:{module:'ledger',path:'/algorithms/api',method:'GET'}});
 assert.equal(resumed.status,200);assert.equal(resumed.data.status,200,'finance module must reopen after a frozen backup');backend.auth.logout();
}
module.exports={verify};

'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
async function verify(host){
 const{createDailyBackups,dayKey}=require('../stage1/daily-backup.cjs');
 assert.equal(dayKey(new Date('2026-10-13T16:05:00Z')),'2026-10-14','daily boundary must use China time');
 const scheduler=createDailyBackups({service:host.backupService,root:host.root,policy:host.policy,markerName:'daily-backup-test.json'});
 const markerFile=path.join(host.root,'config','daily-backup-test.json');if(fs.existsSync(markerFile))fs.unlinkSync(markerFile);
 const now=new Date('2030-01-02T12:00:00Z'),first=await scheduler.tick(now),second=await scheduler.tick(now);
 assert.equal(first.created,true);assert.equal(second.created,false);
 const marker=JSON.parse(fs.readFileSync(path.join(host.root,'config','daily-backup-test.json'),'utf8'));
 assert.equal(marker.day,'2030-01-02');assert.ok(fs.existsSync(marker.file));
 const bytes=fs.readFileSync(marker.file);bytes[bytes.length-20]^=1;fs.writeFileSync(marker.file,bytes);assert.equal((await scheduler.tick(now)).created,true,'an intact header alone must not count as a valid daily backup');
 assert.equal((await scheduler.tick(new Date('2030-01-03T12:00:00Z'))).created,true);
 await scheduler.stop();
}
module.exports={verify};

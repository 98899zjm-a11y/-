'use strict';
// Formal post-install verification only; no installer, process controls or live SQL.
const fs=require('original-fs'),io=fs.promises,path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..'),ART=path.join(ROOT,'release-work/initial-162-host-sealed-a4'),INSTALL=path.resolve('F:/自制软件/xjy-jewelry-offline');
const CAT='898e15209abeddd038eeb353a27dd1cb3526148419558ea6f1d53c298a3aa9a8';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const PINS={'delivery-tools/initial-patch-core.cjs':'0f9de31c8ad8ec7e1b870a92d025909f4606363801a31ee3582b903c5704bbce','delivery-tools/initial-patch-entry.cjs':'4c0008c6f070c22255f3a2819ac82e9be774fbaf631030bb414c95bbcac6b161','delivery-tools/initial-patch-backup.cjs':'f2d7262eae5ba3b3048e42753f96e49cd53746940ea22bbe32b0b1f93f3de8e0','project/desktop/employee-update-cache.cjs':'5cb70079bf161a002a2701694e4774c2a11bf8d54efc6674ccb5c7b2c6729815','project/desktop/initial-upgrade-gate.cjs':'b74a80b83dfaf78f493671bf4bc339f68eeec4f2f89a71410e6cd7d7f78a1980'};
async function main(){
 assert.equal(ROOT.toLowerCase(),'e:\\codex\\2026-10-15\\work\\xjy-v16-deep-audit');assert.equal(process.platform,'win32');assert.equal(process.versions.electron,'44.7.0');assert.equal(process.env.ELECTRON_RUN_AS_NODE,'1');assert(!process.env.NODE_OPTIONS&&!process.env.NODE_PATH);
 assert(process.argv.length===4&&process.argv[2]==='--source-sha256');assert.equal(hash(fs.readFileSync(__filename)),process.argv[3]);
 for(const[f,p]of Object.entries(PINS))assert.equal(hash(fs.readFileSync(path.join(ROOT,f))),p);
 const core=require('../delivery-tools/initial-patch-core.cjs'),entry=require('../delivery-tools/initial-patch-entry.cjs'),u=require('../project/desktop/employee-update-cache.cjs');
 const a=await entry.resolveRepeatNativeAuthority({artifactDir:ART});assert.equal(a.publicationId,CAT);
 const barrier=entry.createInitialProcessBarrier({installationDir:INSTALL,executablePath:process.execPath,role:'host',helperPid:process.pid,artifactDir:ART,environment:process.env});let trusted;
 try{trusted=await core.createInitialPatchInstaller({upgradeMode:'repeat',artifactDir:ART,approvalRoot:a.approvalRoot,approvalFile:path.join(a.approvalRoot,'initial-upgrade-approval.json'),osUser:a.osUser,osUserNamespace:entry.osNamespace(),confirmRole:async()=> 'host',processBarrier:barrier}).inspect({recovery:true});}finally{await barrier.close();}
 assert.equal(trusted.upgrade.phase,'committed');assert.equal(trusted.catalog.sequence,10);assert(u.samePath(trusted.exe,process.execPath));
 const pkg=await core.packageIdentity(io,path.join(INSTALL,'resources/app.asar'),INSTALL);assert.equal(pkg.version,'1.6.2');
 const activation=JSON.parse(await u.readSmall(io,path.join(INSTALL,'xjy-install-activation.json'),4096));assert.equal(activation.role,'host');assert.equal(activation.programVersion,'1.6.2');assert(u.samePath(activation.installationDir,INSTALL));
 for(const row of trusted.catalog.files){const live=await core.fileHash(io,path.join(INSTALL,...row.path.split('/')),INSTALL);assert.equal(live.size,row.size);assert.equal(live.sha256,row.sha256);}
 const key=await u.readSmall(io,path.join(INSTALL,'.xjy-initial-upgrade/.journal-key'),32),wrapped=JSON.parse(await u.readSmall(io,path.join(INSTALL,'.xjy-patches',CAT,'journal.json'),2097152));assert.equal(key.length,32);
 assert(crypto.timingSafeEqual(crypto.createHmac('sha256',key).update(wrapped.payload).digest(),Buffer.from(wrapped.mac,'hex')));
 const j=JSON.parse(wrapped.payload);assert.equal(j.phase,'committed');assert.equal(j.role,'host');assert.equal(j.targetVersion,'1.6.2');assert.equal(j.sourcePolicySha256,trusted.approval.sourcePolicySha256);assert.equal(j.treeSha256,trusted.approval.treeSha256);assert.equal(j.oldFiles.length,1007);
 const programBackupDirectory=path.join(INSTALL,'.xjy-patches',CAT,j.transactionId,'program-backup');let oldFiles=0;
 for(const row of j.oldFiles){assert(row.existed);const old=await core.fileHash(io,path.join(programBackupDirectory,...row.path.split('/')),INSTALL);assert.equal(old.sha256,row.sha256);assert.equal(old.size,row.size);oldFiles++;}
 const backup=require('../delivery-tools/initial-patch-backup.cjs'),sqlite=require('node:sqlite');
 const verified=await backup.verifyInitialBackup({backupDir:j.dataBackup.directory,expectedManifestSha256:j.dataBackup.manifestSha256,verifyDatabases:backup.createNodeSqliteVerifier({sqlite,assertEngineApproved:()=>u.samePath(process.execPath,trusted.exe)&&trusted.sourcePolicy.engine.sha256==='db3ad2066a55546f9b6737da3c7f011370e4856fb36888055b544d45653e4f40'})});assert.equal(verified.databases.length,3);
 const gate=require('../project/desktop/initial-upgrade-gate.cjs').readInitialUpgradeGate({installDir:INSTALL,installedRole:'host'});assert.equal(gate.blocked,false);assert.equal(gate.phase,'committed');
 console.log(JSON.stringify({verified:true,version:pkg.version,role:activation.role,committed:true,liveResourceFilesVerified:trusted.catalog.files.length,oldProgramBackupFilesVerified:oldFiles,databaseSnapshotsVerified:verified.databases.length,dataBackupFilesVerified:verified.files,dataBackupBytes:verified.bytes,dataBackupDirectory:j.dataBackup.directory,programBackupDirectory,engineUnchanged:true,startupGateBlocked:gate.blocked,liveBusinessDatabaseOpened:false,manualBusinessDataChanges:false}));
}
main().catch(e=>{console.error(JSON.stringify({verified:false,code:e.code||'VERIFY_FAILED',message:e.message}));process.exitCode=1;});

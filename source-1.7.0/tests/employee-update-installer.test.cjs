'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=process.versions.electron?require('original-fs').promises:require('node:fs/promises'),path=require('node:path');
const {fixture,asar,hash}=require('./employee-update-fixtures.cjs');
const {createEmployeeUpdateCache}=require('../project/desktop/employee-update-cache.cjs');
const {createEmployeeUpdateRunner,createEmployeeUpdateInstaller}=require('../project/desktop/employee-update-installer.cjs');
async function program(t,options={}) {
 const f=await fixture(t,options);f.exe=path.join(f.install,'Toy Jewelry.exe');await fs.writeFile(f.exe,'MZ fictional executable - never executed');f.old=asar(f.currentVersion,'old bytes');await fs.writeFile(path.join(f.install,'resources/app.asar'),f.old);
 await fs.mkdir(path.join(f.install,'resources/print-dependencies'));await fs.writeFile(path.join(f.install,'resources/print-dependencies/fake.txt'),'old dependency');await fs.mkdir(path.join(f.install,'data'));await fs.writeFile(path.join(f.install,'data/business.sqlite'),'BUSINESS MUST SURVIVE');
 f.activation={version:1,product:'xjy-jewelry-offline',programVersion:f.currentVersion,role:'employee',installationDir:f.install};f.activationBytes=JSON.stringify(f.activation);await fs.writeFile(path.join(f.install,'xjy-install-activation.json'),f.activationBytes);
 f.cache=createEmployeeUpdateCache(f.cacheOptions);t.after(()=>f.cache.close());f.id=await f.cache.begin(f.catalog);await f.cache.write(f.id,0,f.archive);await f.cache.seal(f.id,f.proof);f.stage=await f.cache.getInstallStage(f.id);
 f.restarts=[];f.processAdapter={inspect:async()=>null,listForInstallation:async()=>[],restart:async input=>{f.restarts.push(input);return {started:true};}};
 f.runnerOptions={...f.cacheOptions,profileDir:f.profile,installDir:f.install,executablePath:f.exe,clientRole:'employee',currentProcess:{pid:4123,creationMarker:'fake-start'},processAdapter:f.processAdapter};
 f.input={stageId:f.id,verifiedCatalog:f.catalog,expectedVersion:f.currentVersion,employee:true,closeEmployeeApp:true,requiresBackup:true,stopHost:false};
 f.request={stage:f.stage,expectedVersion:f.currentVersion,currentProcess:{pid:4123,creationMarker:'fake-start'},employee:true};return f;
}
test('real signed ZIP is extracted into toy program with old hashes, activation and employee-only restart',async t=>{
 const f=await program(t),runner=createEmployeeUpdateRunner(f.runnerOptions),result=await runner.run(f.request);assert.equal(result.installed,true);assert.equal(result.version,'1.6.1');assert.deepEqual(await fs.readFile(path.join(f.install,'resources/app.asar')),Buffer.from(f.entries[0].body));
 assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.install,'xjy-install-activation.json'),'utf8')),{...f.activation,programVersion:'1.6.1'});assert.deepEqual(await fs.readFile(path.join(result.backupDir,'resources/app.asar')),f.old);assert.equal((await fs.readFile(path.join(f.install,'data/business.sqlite'))).toString(),'BUSINESS MUST SURVIVE');assert.equal(f.restarts.length,1);assert.deepEqual(f.restarts[0].args,['--employee-client']);
});
test('host role, wrong current process marker or another installation process cannot mutate program or restart',async t=>{
 for(const mode of ['host','pid','other']){const f=await program(t);if(mode==='host')f.runnerOptions.clientRole='host';if(mode==='pid')f.processAdapter.inspect=async()=>({pid:4123,creationMarker:'reused',executablePath:f.exe});if(mode==='other')f.processAdapter.listForInstallation=async()=>[{pid:55,creationMarker:'host-running',executablePath:f.exe,args:['--xjy-print-worker']}];
  await assert.rejects(createEmployeeUpdateRunner(f.runnerOptions).run(f.request));assert.deepEqual(await fs.readFile(path.join(f.install,'resources/app.asar')),f.old);assert.equal(f.restarts.length,0);
 }
});
test('tampered archive, sealed proof or unsupported source fails before program mutation',async t=>{
 for(const mode of ['bytes','proof','source']){const f=await program(t);if(mode==='bytes'){const b=Buffer.from(f.archive);b[40]^=1;await fs.writeFile(f.stage.archivePath,b);}if(mode==='proof')f.request.stage={...f.stage,envelope:{...f.envelope,catalog:f.envelope.catalog+' '}};if(mode==='source')f.request.expectedVersion='1.5.9';
  await assert.rejects(createEmployeeUpdateRunner(f.runnerOptions).run(f.request));assert.deepEqual(await fs.readFile(path.join(f.install,'resources/app.asar')),f.old);assert.equal(await fs.readFile(path.join(f.install,'xjy-install-activation.json'),'utf8'),f.activationBytes);assert.equal(f.restarts.length,0);
 }
});
test('signed zip-slip, link or case alias paths never write outside approved files',async t=>{
 for(const entry of [{path:'../outside.exe',body:asar('1.6.1')},{path:'resources/app.asar',body:asar('1.6.1'),link:true},{path:'resources/APP.ASAR',body:asar('1.6.1')}]){const f=await program(t,{entries:[entry],allowedFiles:['resources/app.asar'],catalog:{files:[{path:'resources/app.asar',size:entry.body.length,sha256:hash(entry.body)}]}});await assert.rejects(createEmployeeUpdateRunner(f.runnerOptions).run(f.request));assert.deepEqual(await fs.readFile(path.join(f.install,'resources/app.asar')),f.old);}
});
test('live program junction or hardlink refuses replacement and keeps data and external target',async t=>{
 for(const mode of ['junction','hardlink']){const f=await program(t);if(mode==='hardlink')await fs.link(path.join(f.install,'resources/app.asar'),path.join(f.root,'external-link'));else{const external=path.join(f.root,'external');await fs.mkdir(external);await fs.writeFile(path.join(external,'fake.txt'),'EXTERNAL');await fs.rename(path.join(f.install,'resources/print-dependencies'),path.join(f.install,'resources/old-deps'));await fs.symlink(external,path.join(f.install,'resources/print-dependencies'),'junction');}
  await assert.rejects(createEmployeeUpdateRunner(f.runnerOptions).run(f.request));assert.deepEqual(await fs.readFile(path.join(f.install,'resources/app.asar')),f.old);assert.equal(f.restarts.length,0);
 }
});
test('per-file replacement failure restores every old file and exact previous activation',async t=>{
 const f=await program(t);let failed=false;const fileSystem={...fs,rename:async(from,to)=>{if(!failed&&to===path.join(f.install,'resources/print-dependencies/fake.txt')){failed=true;throw new Error('injected replacement failure');}return fs.rename(from,to);}};
 await assert.rejects(createEmployeeUpdateRunner({...f.runnerOptions,fileSystem}).run(f.request));assert.equal(failed,true);assert.deepEqual(await fs.readFile(path.join(f.install,'resources/app.asar')),f.old);assert.equal(await fs.readFile(path.join(f.install,'resources/print-dependencies/fake.txt'),'utf8'),'old dependency');assert.equal(await fs.readFile(path.join(f.install,'xjy-install-activation.json'),'utf8'),f.activationBytes);
});
test('power loss after first atomic replacement leaves journal and fresh runner recovers old program',async t=>{
 const f=await program(t);let count=0;const runner=createEmployeeUpdateRunner({...f.runnerOptions,checkpoint:async name=>{if(name==='file-replaced'&&++count===1){const e=new Error('toy power loss');e.code='SIMULATED_POWER_LOSS';throw e;}}});
 await assert.rejects(runner.run(f.request));assert.notDeepEqual(await fs.readFile(path.join(f.install,'resources/app.asar')),f.old);const recovered=await createEmployeeUpdateRunner(f.runnerOptions).recover();assert.equal(recovered.recovered,true);assert.deepEqual(await fs.readFile(path.join(f.install,'resources/app.asar')),f.old);assert.equal(await fs.readFile(path.join(f.install,'xjy-install-activation.json'),'utf8'),f.activationBytes);assert.equal(f.restarts.length,0);
});
test('power loss after activation switch can recover with target-version code and restore the exact source marker',async t=>{
 const f=await program(t);await assert.rejects(createEmployeeUpdateRunner({...f.runnerOptions,checkpoint:async name=>{if(name==='activation-replaced'){const e=new Error('power loss');e.code='SIMULATED_POWER_LOSS';throw e;}}}).run(f.request));assert.equal(JSON.parse(await fs.readFile(path.join(f.install,'xjy-install-activation.json'),'utf8')).programVersion,'1.6.1');const result=await createEmployeeUpdateRunner({...f.runnerOptions,currentVersion:'1.6.1'}).recover();assert.equal(result.recovered,true);assert.deepEqual(await fs.readFile(path.join(f.install,'resources/app.asar')),f.old);assert.equal(await fs.readFile(path.join(f.install,'xjy-install-activation.json'),'utf8'),f.activationBytes);
});
test('failed update removes only newly added approved files and retains prior unrelated program resources',async t=>{
 const f=await program(t,{entries:[{path:'resources/print-dependencies/added.txt',body:'new file'},{path:'resources/app.asar',body:asar('1.6.1')}]});let failed=false;const fileSystem={...fs,rename:async(from,to)=>{if(!failed&&to===path.join(f.install,'resources/app.asar')){failed=true;throw new Error('file switch failed');}return fs.rename(from,to);}};await assert.rejects(createEmployeeUpdateRunner({...f.runnerOptions,fileSystem}).run(f.request));await assert.rejects(fs.access(path.join(f.install,'resources/print-dependencies/added.txt')));assert.deepEqual(await fs.readFile(path.join(f.install,'resources/app.asar')),f.old);assert.equal(await fs.readFile(path.join(f.install,'resources/print-dependencies/fake.txt'),'utf8'),'old dependency');assert.deepEqual(f.restarts[0].args,['--employee-client']);
});
test('explicit multi-source version catalog upgrades each supported installed release and reports restart failure separately',async t=>{
 for(const source of ['1.6.0','1.6.1']){const f=await program(t,{currentVersion:source,catalog:{version:'1.6.2',sourceVersions:['1.6.0','1.6.1']}});f.processAdapter.restart=async()=>{throw new Error('toy desktop unavailable');};const result=await createEmployeeUpdateRunner(f.runnerOptions).run(f.request);assert.equal(result.installed,true);assert.equal(result.restarted,false);assert.equal(JSON.parse(await fs.readFile(path.join(f.install,'xjy-install-activation.json'),'utf8')).programVersion,'1.6.2');}
});
test('tampered rollback backup is refused during crash recovery and never starts a Host',async t=>{
 const f=await program(t);await assert.rejects(createEmployeeUpdateRunner({...f.runnerOptions,checkpoint:async name=>{if(name==='file-replaced'){const e=new Error('power loss');e.code='SIMULATED_POWER_LOSS';throw e;}}}).run(f.request));
 const record=JSON.parse(await fs.readFile(path.join(f.install,'.xjy-employee-updates/journal.json'),'utf8')),journal=JSON.parse(record.payload);await fs.writeFile(path.join(f.install,'.xjy-employee-updates',journal.transactionId,'backup/resources/app.asar'),'tampered old file');await assert.rejects(createEmployeeUpdateRunner(f.runnerOptions).recover());assert.equal(f.restarts.length,0);
});
test('modified journal cannot authorize forged backup hashes or activation changes',async t=>{
 const f=await program(t);await assert.rejects(createEmployeeUpdateRunner({...f.runnerOptions,checkpoint:async name=>{if(name==='file-replaced'){const e=new Error('power loss');e.code='SIMULATED_POWER_LOSS';throw e;}}}).run(f.request));
 const file=path.join(f.install,'.xjy-employee-updates/journal.json'),record=JSON.parse(await fs.readFile(file,'utf8'));const j=record.payload?JSON.parse(record.payload):record,forged=Buffer.alloc(j.oldFiles[0].size,0x58);j.oldFiles[0].sha256=hash(forged);await fs.writeFile(path.join(f.install,'.xjy-employee-updates',j.transactionId,'backup/resources/app.asar'),forged);await fs.writeFile(file,JSON.stringify(record.payload?{...record,payload:JSON.stringify(j)}:j));await assert.rejects(createEmployeeUpdateRunner(f.runnerOptions).recover(),error=>error.code==='BAD_METADATA');
});
test('normal Electron renderer descendants may exit with employee parent while unrelated worker is refused',async t=>{
 const f=await program(t);let tick=0;f.processAdapter.inspect=async()=>tick<2?{pid:4123,creationMarker:'fake-start',executablePath:f.exe,args:['--employee-client']}:null;f.processAdapter.listForInstallation=async()=>tick<3?[{pid:4123,parentPid:1,creationMarker:'fake-start',executablePath:f.exe,args:['--employee-client']}, {pid:4124,parentPid:4123,creationMarker:'renderer-start',executablePath:f.exe,args:['--type=renderer']}].filter(p=>tick<2||p.pid===4124):[];
 const result=await createEmployeeUpdateRunner({...f.runnerOptions,wait:async()=>{tick++;},exitTimeoutMs:1000}).run(f.request);assert.equal(result.installed,true);assert.equal(tick,3);assert.equal(f.restarts.length,1);
});
test('catalog expiry during normal-exit wait preserves original files and never restarts',async t=>{
 const f=await program(t);let now=f.now,running=true;f.processAdapter.inspect=async()=>running?{pid:4123,creationMarker:'fake-start',executablePath:f.exe}:null;
 await assert.rejects(createEmployeeUpdateRunner({...f.runnerOptions,now:()=>now,wait:async()=>{now+=86400001;running=false;}}).run(f.request),e=>e.code==='EXPIRED_CATALOG');assert.deepEqual(await fs.readFile(path.join(f.install,'resources/app.asar')),f.old);assert.equal(f.restarts.length,0);
});
test('staged release superseded before helper execution is refused despite a valid old signature',async t=>{
 const f=await program(t);await f.cache.setAcceptedSequence(f.catalog.sequence+1);await assert.rejects(createEmployeeUpdateRunner(f.runnerOptions).run(f.request),e=>e.code==='STALE_CATALOG');assert.deepEqual(await fs.readFile(path.join(f.install,'resources/app.asar')),f.old);assert.equal(f.restarts.length,0);
});
test('native scheduler rejects renderer paths, copies a hash-pinned helper bundle and requests normal employee exit',async t=>{
 const f=await program(t),helperRoot=path.join(f.install,'resources/update-helper');await fs.mkdir(helperRoot);const names=['updater-helper.cjs','employee-update-installer.cjs','employee-update-cache.cjs','bootstrap.json'];const helperFiles=[];
 for(const name of names){const bytes=Buffer.from('trusted toy '+name);await fs.writeFile(path.join(helperRoot,name),bytes);helperFiles.push({name,sourcePath:path.join(helperRoot,name),sha256:hash(bytes)});}
 let launch,exit=0;const installer=createEmployeeUpdateInstaller({...f.runnerOptions,cache:f.cache,helperFiles,processAdapter:{...f.processAdapter,inspect:async()=>({pid:4123,creationMarker:'fake-start',executablePath:f.exe}),launchHelper:async value=>{launch=value;return {ready:true};},requestExit:async()=>{exit++;}}});
 await assert.rejects(installer.install({...f.input,path:'E:/forbidden'}));assert.equal(exit,0);const result=await installer.install(f.input);assert.equal(result.scheduled,true);assert.equal(exit,1);assert.equal(launch.env.ELECTRON_RUN_AS_NODE,'1');assert.equal(launch.shell,false);assert.equal(launch.windowsHide,true);assert.equal(launch.executablePath,f.exe);assert.ok(launch.args[0].startsWith(f.profile));assert.equal(launch.args.length,2);assert.deepEqual(await fs.readFile(path.join(f.install,'resources/app.asar')),f.old);
});
test('native recovery reads small status then schedules trusted helper, never replaces the currently running employee',async t=>{
 const f=await program(t);await assert.rejects(createEmployeeUpdateRunner({...f.runnerOptions,checkpoint:async name=>{if(name==='file-replaced'){const e=new Error('power loss');e.code='SIMULATED_POWER_LOSS';throw e;}}}).run(f.request));
 const helperRoot=path.join(f.install,'resources/update-helper');await fs.mkdir(helperRoot);const helperFiles=[];for(const name of ['updater-helper.cjs','employee-update-installer.cjs','employee-update-cache.cjs','bootstrap.json']){const bytes=Buffer.from('toy '+name);await fs.writeFile(path.join(helperRoot,name),bytes);helperFiles.push({name,sourcePath:path.join(helperRoot,name),sha256:hash(bytes)});}let launch,exits=0;
 const installer=createEmployeeUpdateInstaller({...f.runnerOptions,cache:f.cache,helperFiles,processAdapter:{...f.processAdapter,inspect:async()=>({pid:4123,creationMarker:'fake-start',executablePath:f.exe}),launchHelper:async input=>{launch=input;return {ready:true};},requestExit:async()=>{exits++;}}});const before=await fs.readFile(path.join(f.install,'resources/app.asar')),result=await installer.recover();assert.equal(result.scheduled,true);assert.equal(result.recovery,true);assert.equal(exits,1);assert.deepEqual(await fs.readFile(path.join(f.install,'resources/app.asar')),before);const record=JSON.parse(await fs.readFile(launch.args[1],'utf8'));assert.equal(JSON.parse(record.request).operation,'recover');
});

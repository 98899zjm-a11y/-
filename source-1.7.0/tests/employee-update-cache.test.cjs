'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {fixture}=require('./employee-update-fixtures.cjs');
const {createEmployeeUpdateCache}=require('../project/desktop/employee-update-cache.cjs');
test('opaque cache stage accepts sequential bytes, verified seal and a native-only fixed descriptor',async t=>{
 const f=await fixture(t),cache=createEmployeeUpdateCache(f.cacheOptions),id=await cache.begin(f.catalog);t.after(()=>cache.close());
 assert.match(id,/^[a-f0-9-]{36}$/);await cache.write(id,0,f.archive);assert.equal(await cache.size(id),f.archive.length);assert.deepEqual(await cache.read(id,0,f.archive.length),f.archive);
 await cache.seal(id,f.proof);const stage=await cache.getInstallStage(id);assert.equal(stage.stageId,id);assert.equal(stage.envelope.signature,f.envelope.signature);assert.equal(stage.catalog.version,'1.6.1');assert.equal(path.dirname(stage.archivePath),stage.stageDir);assert.equal(Object.isFrozen(stage),true);
 await assert.rejects(cache.write(id,f.archive.length,Buffer.from('x')));await cache.remove(id);await assert.rejects(cache.getInstallStage(id));
});
test('accepted sequence survives cache recreation and normal boot never opens large archives',async t=>{
 const f=await fixture(t),cache=createEmployeeUpdateCache(f.cacheOptions);await cache.setAcceptedSequence(4);await assert.rejects(cache.setAcceptedSequence(3));await cache.close();
 let opens=[];const fileSystem={...fs,open:async(file,...args)=>{opens.push(file);return fs.open(file,...args);}};
 const next=createEmployeeUpdateCache({...f.cacheOptions,fileSystem});assert.equal(await next.getAcceptedSequence(),4);assert.ok(opens.every(file=>!file.endsWith('archive.zip')));await next.close();
});
test('invalid catalog signature or different parsed catalog is rejected before stage creation',async t=>{
 const f=await fixture(t),cache=createEmployeeUpdateCache({...f.cacheOptions,resolveCatalogEnvelope:async()=>({...f.envelope,signature:Buffer.alloc(64).toString('base64')})});await assert.rejects(cache.begin(f.catalog));
 const good=createEmployeeUpdateCache(f.cacheOptions);await assert.rejects(good.begin({...f.catalog,sequence:999}));await good.close();await cache.close();
});
test('cache rejects unknown stage, backward offset, too large chunks and incomplete or false proof',async t=>{
 const f=await fixture(t),cache=createEmployeeUpdateCache(f.cacheOptions);t.after(()=>cache.close());const id=await cache.begin(f.catalog);
 await assert.rejects(cache.read('../program',0,1));await assert.rejects(cache.write(id,1,Buffer.from('x')));await assert.rejects(cache.write(id,0,Buffer.alloc(4194305)));await cache.write(id,0,f.archive.subarray(0,10));await assert.rejects(cache.seal(id,f.proof));await cache.write(id,10,f.archive.subarray(10));await assert.rejects(cache.seal(id,{...f.proof,sequence:5}));
});
test('path alias and junction cache root cannot escape the verified local profile',async t=>{
 const f=await fixture(t);assert.throws(()=>createEmployeeUpdateCache({...f.cacheOptions,profileDir:f.profile+path.sep+'..'+path.sep+'profile'}));
 const external=path.join(f.root,'outside');await fs.mkdir(external);await fs.symlink(external,path.join(f.profile,'employee-update-cache'),'junction');const cache=createEmployeeUpdateCache(f.cacheOptions);await assert.rejects(cache.begin(f.catalog));assert.deepEqual(await fs.readdir(external),[]);await cache.close();
});
test('archive hardlink and replacement are rejected by descriptor identity',async t=>{
 const f=await fixture(t),cache=createEmployeeUpdateCache(f.cacheOptions);t.after(()=>cache.close());const id=await cache.begin(f.catalog);await cache.write(id,0,f.archive);await cache.seal(id,f.proof);const stage=await cache.getInstallStage(id);
 const extra=path.join(f.root,'hardlink.zip');await fs.link(stage.archivePath,extra);await assert.rejects(cache.read(id,0,1));await fs.unlink(extra);
 await fs.rename(stage.archivePath,stage.archivePath+'.old');await fs.writeFile(stage.archivePath,f.archive);await assert.rejects(cache.getInstallStage(id));
});
test('partial write failure poisons only its own stage and retained stages survive',async t=>{
 const f=await fixture(t);let fail=false;const fileSystem={...fs,open:async(file,...args)=>{const h=await fs.open(file,...args);if(file.endsWith('archive.zip')){const write=h.write.bind(h);h.write=async(...input)=>{if(fail){await write(input[0],input[1],1,input[3]);throw new Error('injected disk failure');}return write(...input);};}return h;}};
 const cache=createEmployeeUpdateCache({...f.cacheOptions,fileSystem});t.after(()=>cache.close());const kept=await cache.begin(f.catalog);await cache.write(kept,0,f.archive);await cache.seal(kept,f.proof);const broken=await cache.begin(f.catalog);fail=true;await assert.rejects(cache.write(broken,0,f.archive));await assert.rejects(cache.seal(broken,f.proof));await cache.remove(broken);assert.equal((await cache.getInstallStage(kept)).catalog.sequence,4);
});
test('accepted sequence and seal authentication detects metadata tampering without scanning archives',async t=>{
 const f=await fixture(t),cache=createEmployeeUpdateCache(f.cacheOptions);t.after(()=>cache.close());await cache.setAcceptedSequence(4);const file=path.join(f.profile,'employee-update-cache/accepted-sequence.json'),record=JSON.parse(await fs.readFile(file,'utf8'));record.payload=JSON.stringify({version:1,sequence:0});await fs.writeFile(file,JSON.stringify(record));await assert.rejects(cache.getAcceptedSequence(),e=>e.code==='BAD_METADATA');
});

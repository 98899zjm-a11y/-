import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import * as api from '../lib/library.mjs';
const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../runtime/library-tests'); await fs.mkdir(base,{recursive:true});
const bytes=Buffer.from([255,216,255,224,0,2,255,217]);
const sha256=createHash('sha256').update('fictional-original').digest('hex');
const input=(sha=sha256)=>({bytes,sha256:sha,name:'虚构戒指.jpg',sourceLabel:'测试素材'});
const positive=async x=>({sha256:x.sha256,decision:'jewelry',category:'戒指',tags:['简约','细款'],reason:'可见首饰'});
async function setup(t,classify=positive){assert.equal(typeof api.openLibrary,'function','library API missing');const root=await fs.mkdtemp(path.join(base,'case-'));const lib=await api.openLibrary({root,classify});t.after(()=>lib.close());return {root,lib};}
test('enqueue returns immediately and serial worker imports only classified jewelry',async t=>{
 let release;const gate=new Promise(r=>{release=r});let active=0,max=0;
 const {lib}=await setup(t,async x=>{active++;max=Math.max(max,active);await gate;active--;return positive(x)});
 const a=await lib.enqueue(input());const b=await lib.enqueue(input('b'.repeat(64)));assert.equal(a.status,'queued');assert.equal(b.status,'queued');
 release();await lib.idle();assert.equal(max,1);assert.equal(lib.get(a.id).status,'imported');assert.equal(lib.get(a.id).availability,'unknown');assert.equal(lib.list().length,2);
});
test('concurrent duplicate original hash produces one durable asset',async t=>{const {lib}=await setup(t);const [a,b]=await Promise.all([lib.enqueue(input()),lib.enqueue(input())]);assert.equal(a.id,b.id);assert.equal([a.duplicate,b.duplicate].filter(Boolean).length,1);await lib.idle();assert.equal(lib.list().length,1);});
test('non-jewelry uncertainty and model failure retain images but never import',async t=>{
 for(const [decision,want] of [['not_jewelry','skipped'],['uncertain','needs_review'],['error','awaiting_model']]){
 const {lib}=await setup(t,async x=>{if(decision==='error')throw new Error('secret D:/sensitive/file');return {sha256:x.sha256,decision,category:'其他首饰',tags:[],reason:'待判断'}});
 const a=await lib.enqueue(input());await lib.idle();const saved=lib.get(a.id);assert.equal(saved.status,want);assert.ok(await lib.file(a.id));assert.ok(!JSON.stringify(saved).includes('D:/'));}
});
test('wrong model hash cannot import',async t=>{const {lib}=await setup(t,async()=>({sha256:'b'.repeat(64),decision:'jewelry'}));const a=await lib.enqueue(input());await lib.idle();assert.equal(lib.get(a.id).status,'awaiting_model');});
test('manual jewelry review requires confirmation and supply evidence',async t=>{const {lib}=await setup(t,async x=>({sha256:x.sha256,decision:'uncertain',category:'其他首饰',tags:[],reason:'模糊'}));const a=await lib.enqueue(input());await lib.idle();
 await assert.rejects(lib.update(a.id,{reviewDecision:'jewelry'}),/确认/);
 const reviewed=await lib.update(a.id,{reviewDecision:'jewelry',confirmed:true,evidence:'员工核实为首饰'});assert.equal(reviewed.status,'imported');assert.equal(reviewed.availability,'unknown');
 await assert.rejects(lib.update(a.id,{availability:'in_stock',confirmed:true}),/依据/);
 await assert.rejects(lib.update(a.id,{availability:'in_stock',evidence:'库存单测试'}),/确认/);
 assert.equal((await lib.update(a.id,{availability:'in_stock',confirmed:true,evidence:'库存单测试'})).availability,'in_stock');
});
test('metadata updates persist and immutable identities cannot be overwritten',async t=>{const {root,lib}=await setup(t);const a=await lib.enqueue(input());await lib.idle();
 await assert.rejects(lib.update(a.id,{sha256:'b'.repeat(64)}),/字段/);
 await lib.update(a.id,{category:'手链',tags:['链节'],sourceLabel:'核实来源',evidence:'员工纠正',confirmed:true});await lib.close();const next=await api.openLibrary({root,classify:positive});t.after(()=>next.close());assert.equal(next.get(a.id).category,'手链');assert.deepEqual(next.get(a.id).tags,['链节']);});
test('retry same asset after model recovery preserves original hash',async t=>{let fail=true;const {lib}=await setup(t,async x=>{if(fail)throw new Error('offline');return positive(x)});const a=await lib.enqueue(input());await lib.idle();fail=false;const retry=await lib.retry(a.id);assert.equal(retry.id,a.id);await lib.idle();assert.equal(lib.get(a.id).status,'imported');assert.equal(lib.get(a.id).sha256,sha256);});
test('reopen resets interrupted queued/classifying assets for fresh classification',async t=>{const {root,lib}=await setup(t);const a=await lib.enqueue(input());await lib.idle();await lib.close();const db=new DatabaseSync(path.join(root,'library.sqlite'));db.prepare("UPDATE assets SET status='classifying' WHERE id=?").run(a.id);db.close();let calls=0;const next=await api.openLibrary({root,classify:async x=>{calls++;return positive(x)}});t.after(()=>next.close());await next.idle();assert.equal(calls,1);assert.equal(next.get(a.id).status,'imported');});
test('names cannot determine image path and public assets reveal no internal paths',async t=>{const {lib,root}=await setup(t);const a=await lib.enqueue({...input(),name:'../../outside.jpg'});await lib.idle();const file=await lib.file(a.id);assert.ok(file.path.startsWith(path.join(root,'images')+path.sep));assert.ok(!JSON.stringify(lib.list()).includes(root));assert.equal(await lib.file('../anything'),null);});
test('image symbolic link is rejected and cannot escape storage',async t=>{const {lib,root}=await setup(t);const a=await lib.enqueue(input());await lib.idle();const target=(await lib.file(a.id)).path;const original=path.join(root,'original.jpg');await fs.rename(target,original);await fs.symlink(original,target,'file');await assert.rejects(lib.file(a.id),/链接/);});
test('corrupt existing library and unsupported schema are retained and rejected',async t=>{const {root,lib}=await setup(t);await lib.close();const file=path.join(root,'library.sqlite');const invalid=Buffer.from('broken-library');await fs.writeFile(file,invalid);await assert.rejects(api.openLibrary({root,classify:positive}),/损坏|格式/);assert.deepEqual(await fs.readFile(file),invalid);});

test('model cannot assign supply status or replace original identity',async t=>{const {lib}=await setup(t,async x=>({...await positive(x),availability:'in_stock',evidence:'model guess',id:'model-id'}));const a=await lib.enqueue(input());await lib.idle();const saved=lib.get(a.id);assert.equal(saved.availability,'unknown');assert.equal(saved.evidence,'');assert.equal(saved.id,a.id);});
test('additional database trigger is rejected without modifying database',async t=>{const {root,lib}=await setup(t);await lib.close();const file=path.join(root,'library.sqlite');const db=new DatabaseSync(file);db.exec('CREATE TRIGGER extra AFTER INSERT ON assets BEGIN SELECT 1; END');db.close();const before=await fs.readFile(file);await assert.rejects(api.openLibrary({root,classify:positive}),/结构/);assert.ok((await fs.readFile(file)).equals(before));});
test('library directory outside candidate runtime is never accepted',async()=>{await assert.rejects(api.openLibrary({root:'D:/Windows',classify:positive}),/runtime/);});
test('confirmed manual rejection removes asset from imported status',async t=>{const {lib}=await setup(t);const a=await lib.enqueue(input());await lib.idle();await assert.rejects(lib.update(a.id,{reviewDecision:'not_jewelry',confirmed:false}),/确认/);const saved=await lib.update(a.id,{reviewDecision:'not_jewelry',confirmed:true,evidence:'人工发现误收'});assert.equal(saved.status,'skipped');});
test('second library owner is rejected instead of restarting active work',async t=>{let release;const wait=new Promise(r=>{release=r});const {root,lib}=await setup(t,async x=>{await wait;return positive(x)});const a=await lib.enqueue(input());try{await assert.rejects(api.openLibrary({root,classify:positive}),/locked|busy/i);}finally{release();await lib.idle();}assert.equal(lib.get(a.id).status,'imported');});
test('burst uploads all drain without leaving queued work stranded',async t=>{const {lib}=await setup(t);await Promise.all(Array.from({length:20},(_,i)=>lib.enqueue(input(createHash('sha256').update(String(i)).digest('hex')))));await lib.idle();assert.equal(lib.list().filter(a=>a.status==='imported').length,20);});
test('evidence-only edit cannot bypass explicit confirmation or clear supply evidence',async t=>{const {lib}=await setup(t);const a=await lib.enqueue(input());await lib.idle();await lib.update(a.id,{availability:'in_stock',evidence:'原库存依据',confirmed:true});await assert.rejects(lib.update(a.id,{evidence:'擅自替换'}),/确认/);await assert.rejects(lib.update(a.id,{evidence:'',confirmed:true}),/依据/);assert.equal(lib.get(a.id).evidence,'原库存依据');assert.equal((await lib.update(a.id,{evidence:'新核实依据',confirmed:true})).evidence,'新核实依据');});
test('persisted absolute path metadata is rejected rather than exposed',async t=>{for(const field of ['name','source_label','reason','evidence','tags']){const {root,lib}=await setup(t);const a=await lib.enqueue(input());await lib.idle();await lib.close();const file=path.join(root,'library.sqlite');const db=new DatabaseSync(file);const bad='D:\\private\\secret';db.prepare(`UPDATE assets SET ${field}=? WHERE id=?`).run(field==='tags'?JSON.stringify([bad]):bad,a.id);db.close();const before=await fs.readFile(file);await assert.rejects(api.openLibrary({root,classify:positive}),/路径|损坏/);assert.ok((await fs.readFile(file)).equals(before));}});

test('manual review preserves verified supply facts and restoration still needs confirmation',async t=>{
 const {lib}=await setup(t);const a=await lib.enqueue(input());await lib.idle();
 await lib.update(a.id,{availability:'in_stock',evidence:'虚构库存核实单 fixture-001',confirmed:true});
 const approved=await lib.update(a.id,{reviewDecision:'jewelry',confirmed:true});
 assert.equal(approved.availability,'in_stock');assert.equal(approved.evidence,'虚构库存核实单 fixture-001');
 const rejected=await lib.update(a.id,{reviewDecision:'not_jewelry',confirmed:true});
 assert.equal(rejected.status,'skipped');assert.equal(rejected.availability,'in_stock');assert.equal(rejected.evidence,'虚构库存核实单 fixture-001');
 await assert.rejects(lib.update(a.id,{reviewDecision:'jewelry'}),/确认/);assert.equal(lib.get(a.id).status,'skipped');
 const restored=await lib.update(a.id,{reviewDecision:'jewelry',confirmed:true});assert.equal(restored.status,'imported');assert.equal(restored.availability,'in_stock');assert.equal(restored.evidence,'虚构库存核实单 fixture-001');
});
test('forward-slash UNC path is rejected in uploads edits and persisted metadata',async t=>{
 const {lib,root}=await setup(t);await assert.rejects(lib.enqueue({...input(),sourceLabel:'//server/share/private'}),/路径/);
 const a=await lib.enqueue(input());await lib.idle();await assert.rejects(lib.update(a.id,{sourceLabel:'//server/share/private'}),/路径/);
 await lib.close();const file=path.join(root,'library.sqlite');const db=new DatabaseSync(file);db.prepare('UPDATE assets SET source_label=? WHERE id=?').run('//server/share/private',a.id);db.close();
 const before=await fs.readFile(file);await assert.rejects(api.openLibrary({root,classify:positive}),/路径|损坏/);assert.ok((await fs.readFile(file)).equals(before));
});
test('file returns the verified buffer so server need not reread a changed path',async t=>{
 const {lib}=await setup(t);const a=await lib.enqueue(input());await lib.idle();const verified=await lib.file(a.id);
 assert.ok(Buffer.isBuffer(verified.bytes));assert.deepEqual(verified.bytes,bytes);assert.equal(verified.mime,'image/jpeg');assert.equal(typeof verified.path,'string');
 await fs.writeFile(verified.path,Buffer.from('replaced-after-read'));
 assert.deepEqual(verified.bytes,bytes);await assert.rejects(lib.file(a.id),/校验/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {openLibrary} from '../lib/library.mjs';
const base=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../runtime/commit-access-tests');await fs.mkdir(base,{recursive:true});
const bytes=Buffer.from([255,216,255,224,0,2,255,217]);const sha256=createHash('sha256').update(bytes).digest('hex');
const deny=()=>{throw Object.assign(Error('permission revoked'),{status:403});};
const input={bytes,sha256,name:'虚构候选首饰',sourceLabel:'测试'};
const classify=async x=>({sha256:x.sha256,decision:'jewelry',category:'戒指',tags:['简约'],reason:'可见环形'});
test('revocation after enqueue preparation cannot create a catalog asset',async t=>{
 const lib=await openLibrary({root:await fs.mkdtemp(path.join(base,'upload-')),classify});t.after(()=>lib.close());
 let n=0;await assert.rejects(lib.enqueue(input,{beforeCommit:()=>{if(++n>=2)deny();return{staffId:'fictional-staff'};}}),/revoked/);
 assert.equal(lib.list().length,0);assert.ok(n>=2);assert.equal((await lib.enqueue(input)).duplicate,false);await lib.idle();
});
test('revocation during manual image check cannot save review or supply facts',async t=>{
 const lib=await openLibrary({root:await fs.mkdtemp(path.join(base,'review-')),classify:async x=>({sha256:x.sha256,decision:'uncertain',category:'戒指',tags:[],reason:'待核对'})});t.after(()=>lib.close());
 const a=await lib.enqueue(input);await lib.idle();
 await assert.rejects(lib.update(a.id,{reviewDecision:'jewelry',availability:'in_stock',evidence:'虚构核实依据',confirmed:true},{beforeCommit:deny}),/revoked/);
 assert.equal(lib.get(a.id).status,'needs_review');assert.equal(lib.get(a.id).availability,'unknown');
});
test('retry requires the final permission check and cannot enqueue after revocation',async t=>{
 const lib=await openLibrary({root:await fs.mkdtemp(path.join(base,'retry-')),classify:async()=>{throw Error('unavailable');}});t.after(()=>lib.close());
 const a=await lib.enqueue(input);await lib.idle();assert.equal(lib.get(a.id).status,'awaiting_model');
 await assert.rejects(lib.retry(a.id,{beforeCommit:deny}),/revoked/);assert.equal(lib.get(a.id).status,'awaiting_model');
});

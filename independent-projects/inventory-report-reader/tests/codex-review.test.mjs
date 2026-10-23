import test from 'node:test';
import assert from 'node:assert/strict';
import {createInventoryReportReader} from '../inventory-report-reader.mjs';
const ID='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const stamp='2026-10-23T11:59:00.000Z';
const now=Date.parse('2026-10-23T12:00:00.000Z');
const input={reportId:ID,kind:'product',code:'000Ａa'};
const row=(extra={})=>({sourceId:'synthetic-product',sourceKind:'product',code:'000Ａa',name:'虚构细链',category:'项链',spec:'简约',unit:'克',quantity:'-0.000000000000000000123400',...extra});
const doc=(over={},rows=[row()])=>({report:{id:ID,status:'approved',revision:1,capturedAt:stamp,sourceInstance:'synthetic-snapshot',sourceVersion:'v-test',snapshot:{capturedAt:stamp,balances:rows},...over}});
const reader=(document=doc(),options={})=>createInventoryReportReader({maxAgeMs:60000,clock:()=>now,authorize:async()=>({check(){}}),loadReport:async()=>document,...options});

test('REGRESSION invalid February calendar date must not be normalized to a different month',async()=>{
 const impossible='2026-02-30T11:59:00.000Z';
 const r=reader(doc({capturedAt:impossible,snapshot:{capturedAt:impossible,balances:[row()]}}),{clock:()=>Date.parse('2026-03-02T12:00:00.000Z')});
 await assert.rejects(r.lookup(input),/timestamp|date|valid/i);
});
test('REGRESSION sourceInstance/sourceVersion must identify a nonblank source',async()=>{
 for(const [key,value]of [['sourceInstance',''],['sourceInstance','   '],['sourceVersion',''],['sourceVersion','\t']])await assert.rejects(reader(doc({[key]:value})).lookup(input),/source|invalid/i);
});
test('delayed authorization abort prevents any load and preserves AbortError',async()=>{
 const controller=new AbortController();let loads=0;
 const r=reader(doc(),{authorize:async()=>{await Promise.resolve();controller.abort();return{check(){}}},loadReport:async()=>{loads++;return doc()}});
 await assert.rejects(r.lookup(input,{signal:controller.signal}),{name:'AbortError'});assert.equal(loads,0);
});
test('final authorization refusal after projection prevents output and preserves error object',async()=>{
 let checks=0;const denied=new Error('synthetic revoked at final check');const r=reader(doc(),{authorize:async()=>({check(){if(++checks===3)throw denied}})});
 await assert.rejects(r.lookup(input),e=>e===denied);assert.equal(checks,3);
});
test('preload async authorization check is rejected before load even when rejected promise',async()=>{
 let loads=0;const r=reader(doc(),{authorize:async()=>({check:()=>Promise.reject(Error('synthetic async failure'))}),loadReport:async()=>{loads++;return doc()}});
 await assert.rejects(r.lookup(input),/synchronous/);assert.equal(loads,0);
});
test('exact code does not NFKC-fold identifiers; q intentionally normalizes for fuzzy search',async()=>{
 const r=reader(doc({},[row(),row({sourceId:'second',code:'000aa',quantity:'+3.000'})]));
 const exact=await r.lookup(input);assert.equal(exact.total,1);assert.equal(exact.items[0].code,'000Ａa');assert.equal(exact.items[0].quantity,'-0.000000000000000000123400');assert.equal(exact.items[0].unit,'克');
 const fuzzy=await r.lookup({reportId:ID,kind:'product',q:'000aa'});assert.equal(fuzzy.total,2);assert.equal((await r.lookup({...input,code:'000aa'})).total,1);
});
test('valid 20000 boundary returns total before paging; invalid nonmatching row is still rejected',async()=>{
 const rows=Array.from({length:20000},(_,i)=>row({sourceId:'synthetic-'+i}));const out=await reader(doc({},rows)).lookup({...input,pageSize:1});assert.equal(out.total,20000);assert.equal(out.items.length,1);
 const bad=doc({},[row(),row({sourceKind:'material',quantity:'NaN'})]);await assert.rejects(reader(bad).lookup(input),/quantity/);
});
test('no leakage from report, snapshot, row, or moves; frozen inputs remain unchanged',async()=>{
 const r=row({supplier:'synthetic supplier',cost:'19.00',operator:'synthetic operator',amountCents:900});Object.freeze(r);const d=doc({comment:'synthetic private note'},[r]);d.report.snapshot.moves=[row({quantity:'999'})];d.report.snapshot.countDiffs=[row({quantity:'888'})];Object.freeze(d.report.snapshot.balances);Object.freeze(d.report.snapshot);Object.freeze(d.report);Object.freeze(d);const out=await reader(d).lookup(Object.freeze({...input}));assert.equal(out.total,1);assert.equal(out.items[0].quantity,r.quantity);assert.equal(out.isLive,false);assert.equal(out.supplyStatus,'unknown');const json=JSON.stringify(out);for(const token of ['supplier','cost','operator','amountCents','comment','moves','countDiffs'])assert.equal(json.includes(token),false);
});

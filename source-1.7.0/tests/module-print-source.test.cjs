'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const helperPath = path.resolve(__dirname, '../project/desktop/module-print-source.cjs');
const normalizeModulePrintLocation = fs.existsSync(helperPath) ? require(helperPath).normalizeModulePrintLocation : () => null;
const DOCUMENT = '20000000-0000-4000-8000-000000000002';

test('trusted ERP document location becomes an ID recipe without retaining its URL', () => {
  assert.deepEqual(normalizeModulePrintLocation('ledger', '/erp/api/documents/' + DOCUMENT), {type:'erp-document-a4',id:DOCUMENT});
  assert.deepEqual(normalizeModulePrintLocation('ledger', '/erp/doc/' + DOCUMENT), {type:'erp-document-a4',id:DOCUMENT});
  assert.equal(normalizeModulePrintLocation('ledger', '/erp/'), null);
  assert.equal(normalizeModulePrintLocation('ledger', '/erp/print-source?id=' + DOCUMENT), null);
});

test('ledger report preserves explicit selected filters rather than making a generic report', () => {
  const want = {type:'ledger-report-a4',filters:{configured:'1',title:'虚构汇报',start:'2026-10-01',end:'2026-10-14',domain:['sales','stock'],sales_metric:['count','amount'],stock_metric:['count'],details:['sales'],sales_scope:'completed'}};
  assert.deepEqual(normalizeModulePrintLocation('ledger', '/reports/print?configured=1&title=%E8%99%9A%E6%9E%84%E6%B1%87%E6%8A%A5&start=2026-10-01&end=2026-10-14&domain=sales&domain=stock&sales_metric=count&sales_metric=amount&stock_metric=count&details=sales&sales_scope=completed'), want);
  assert.deepEqual(normalizeModulePrintLocation('ledger', '/reports/pdf?all_time=1&domain=material&material_metric=grams'), {type:'ledger-report-a4',filters:{all_time:'1',domain:['material'],material_metric:['grams']}});
  assert.deepEqual(normalizeModulePrintLocation('ledger','/reports/print?title=%3Cscript%3E&domain=sales&sales_metric=count'),{type:'ledger-report-a4',filters:{title:'<script>',domain:['sales'],sales_metric:['count']}});
});

test('inventory count source uses a bounded integer and fixed original choices', () => {
  assert.deepEqual(normalizeModulePrintLocation('inventory', '/sessions/12/print?filter=diff&sort=code&blind=1&mode=blank'), {type:'inventory-count-a4',id:12,filter:'diff',sort:'code',blind:'1',mode:'blank'});
  assert.deepEqual(normalizeModulePrintLocation('inventory', '/sessions/9/print'), {type:'inventory-count-a4',id:9});
  for (const value of ['/sessions/0/print','/sessions/01/print','/sessions/9007199254740992/print','/sessions/1/print?filter=all&filter=diff','/sessions/1/print?sort=diff','/sessions/1/print?mode=html','/sessions/1/print?url=/api/users']) assert.equal(normalizeModulePrintLocation('inventory',value),null,value);
});

test('inventory report supports only its registered time range and metal page', () => {
  for (const value of ['30','90','365','all']) {
    assert.deepEqual(normalizeModulePrintLocation('inventory','/reports?r='+value),{type:'inventory-report-a4',range:value});
    assert.deepEqual(normalizeModulePrintLocation('inventory','/reports?range='+value),{type:'inventory-report-a4',range:value});
  }
  assert.deepEqual(normalizeModulePrintLocation('inventory','/metal-stats'),{type:'inventory-metal-a4'});
  for (const value of ['/reports','/reports?r=7','/reports?r=30&range=90','/reports?r=30&since=2000-01-01','/metal-stats?x=1']) assert.equal(normalizeModulePrintLocation('inventory',value),null,value);
});

test('relative-location conversion fails closed for unknown, ambiguous or encoded paths', () => {
  for (const value of ['https://attacker/reports?r=30','//attacker/reports?r=30','reports?r=30','/reports?r=30#x','/reports\\?r=30','/sessions/%31/print','/sessions/1/../2/print','/sessions/1//print','/sessions/1/print?sort=code%26blind%3D0','/reports?r=30&%72=90','/reports?r=30\n']) assert.equal(normalizeModulePrintLocation('inventory',value),null,value);
  for (const value of ['/reports/print?configured=1&configured=0&domain=sales','/reports/print?configured=1&domain=sales&domain=sales','/reports/print?domain=unknown','/reports/pdf?start=2026-02-30','/reports/print?start=2026-11-01&end=2026-10-14','/erp/api/documents/'+DOCUMENT+'?x=1']) assert.equal(normalizeModulePrintLocation('ledger',value),null,value);
  for (const module of ['sales','ledger-admin','',null]) assert.equal(normalizeModulePrintLocation(module,'/metal-stats'),null);
});

let rendererPromise;
async function rendererExports() {
  if (!rendererPromise) rendererPromise = Promise.resolve().then(()=>require('./renderer-test-loader.cjs').loadRenderer('remote-print'));
  return rendererPromise;
}

test('sales UI resolves fixed per-kind devices and keeps one offline printer independent', async () => {
  const ui = await rendererExports();
  assert.equal(typeof ui.printOptionForKind,'function','fixed kind routing helper is missing');
  const options={available:true,defaultPrinterId:'epson',printers:[{id:'epson',label:'EPSON'},{id:'deli',label:'Deli'}],defaults:{},types:{warranty:{available:true,printerId:'epson',label:'EPSON',routingRevision:4,paper:{width:190,height:140}},'quotation-a4':{available:false,printerId:'deli',label:'Deli',reason:'A4 离线',routingRevision:4,paper:{size:'A4'}}}};
  assert.equal(ui.printOptionForKind(options,'warranty').printerId,'epson');
  assert.equal(ui.printOptionForKind(options,'warranty').available,true);
  assert.equal(ui.printOptionForKind(options,'quotation-a4').printerId,'deli');
  assert.equal(ui.printOptionForKind(options,'quotation-a4').available,false);
  assert.equal(ui.printOptionForKind(options,'quotation-a4').reason,'A4 离线');
});

test('sales UI never enables legacy default or another printer when type binding is absent', async () => {
  const ui = await rendererExports();
  assert.equal(typeof ui.printOptionForKind,'function','fixed kind routing helper is missing');
  const legacy={available:true,printers:[{id:'wrong',label:'unbound'}],defaultPrinterId:'wrong',defaults:{}};
  const absent=ui.printOptionForKind(legacy,'quotation-a4');
  assert.equal(absent.available,false); assert.equal(absent.printerId,''); assert.match(absent.reason,/升级/);
  const missing=ui.printOptionForKind({...legacy,types:{warranty:{available:true,printerId:'wrong',label:'EPSON'}}},'quotation-a4');
  assert.equal(missing.available,false); assert.equal(missing.printerId,'');
});

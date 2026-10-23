'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ui = require('../project/desktop/legacy-source/ledger/app/static/erp.js');

test('ERP UI retains exact decimal money and rejects invalid precision', () => {
  assert.equal(ui.moneyCents('10.01'), 1001n);
  assert.equal(ui.moneyCents('90000000000.00'), 9000000000000n);
  assert.equal(ui.centsText(1001n), '10.01');
  for (const invalid of ['1.001', 'NaN', '1e3', '-1', '', '90000000000.01']) {
    assert.throws(() => ui.moneyCents(invalid));
  }
});

test('ERP UI creates receipt rows using original stable purchase line ids', () => {
  const payload = ui.documentPayload('receipt', {
    requestId:'idempotent-id',partyId:'SUP:1',date:'2026-10-14',note:'test',
    sourceId:'purchase-id',dueDate:'2026-10-30',
    lines:[{purchaseLineId:'line-id',quantity:'2',actualWeight:'4.125',amount:'800.05'}]
  });
  assert.equal(payload.lines[0].purchaseLineId, 'line-id');
  assert.equal(payload.lines[0].quantity, 2);
  assert.equal(payload.lines[0].amount, '800.05');
  assert.equal(payload.lines[0].actualWeight, '4.125');
  assert.equal('authorId' in payload, false);
  assert.equal('status' in payload, false);
  assert.throws(() => ui.documentPayload('receipt', {lines:[{purchaseLineId:'line-id',quantity:'2',actualWeight:'4.12345',amount:'1.00'}]}), /克重/);
  assert.throws(() => ui.documentPayload('receipt', {lines:[{purchaseLineId:'line-id',quantity:'1000001',actualWeight:'1.00',amount:'1.00'}]}), /件数/);
});

test('ERP UI settlement total is exact and cannot silently accept an allocation difference', () => {
  assert.deepEqual(ui.allocationSummary('0.30', [{amount:'0.10'}, {amount:'0.20'}]), {total:30n,difference:0n});
  assert.deepEqual(ui.allocationSummary('10.00', [{amount:'3.33'}, {amount:'6.66'}]), {total:999n,difference:1n});
  assert.throws(() => ui.documentPayload('settlement', {requestId:'x',partyId:'CUS:1',date:'2026-10-14',direction:'receive',account:'现金',amount:'10.00',allocations:[{billId:'b',amount:'9.99'}]}), /核销/);
});

test('ERP UI gates independent approval and sensitive purchase actions', () => {
  const actor = {staffId:7,capabilities:['erp.read','erp.purchase.review','erp.reports.sensitive']};
  assert.equal(ui.canReview(actor, {kind:'purchase',status:'pending',authorId:7}), false);
  assert.equal(ui.canReview(actor, {kind:'purchase',status:'pending',authorId:8}), true);
  assert.equal(ui.canReview({...actor,capabilities:['erp.purchase.review']}, {kind:'purchase',status:'pending',authorId:8}), false);
  assert.equal(ui.canReview(actor, {kind:'purchase',status:'confirmed',authorId:8}), false);
  const reversalActor={staffId:7,capabilities:['erp.read','erp.reversal.review']};
  assert.equal(ui.canReview(reversalActor,{kind:'reversal',status:'pending',authorId:8,sensitiveTarget:true}),false);
  assert.equal(ui.canReview(reversalActor,{kind:'reversal',status:'pending',authorId:8,redacted:true}),false);
  assert.equal(ui.canReview({...reversalActor,capabilities:[...reversalActor.capabilities,'erp.reports.sensitive']},{kind:'reversal',status:'pending',authorId:8,sensitiveTarget:true}),true);
});

test('ERP UI computes partial receipt availability only from confirmed matching receipts', () => {
  const purchase = {id:'p',lines:[{id:'line',quantity:5}]};
  const documents = [
    {kind:'receipt',status:'confirmed',payload:{sourceId:'p'},lines:[{purchaseLineId:'line',quantity:2}]},
    {kind:'receipt',status:'pending',payload:{sourceId:'p'},lines:[{purchaseLineId:'line',quantity:1}]},
    {kind:'receipt',status:'confirmed',payload:{sourceId:'other'},lines:[{purchaseLineId:'line',quantity:1}]}
  ];
  assert.equal(ui.remainingQuantity(purchase, 'line', documents), 3);
});

test('ERP UI uses server receipt availability instead of incomplete bootstrap history', () => {
  const purchase={id:'p',lines:[{id:'line',quantity:12,remainingQuantity:0,receivedQuantity:12}]};
  assert.equal(ui.remainingQuantity(purchase,'line',[]),0);
  purchase.lines[0].remainingQuantity=2;
  assert.equal(ui.remainingQuantity(purchase,'line',[{kind:'receipt',status:'confirmed',payload:{sourceId:'p'},lines:[{purchaseLineId:'line',quantity:1}]}]),2);
});

test('ERP UI edits server-normalized cents without losing purchase or allocation amounts', () => {
  const purchase=ui.editableValues({kind:'purchase',partyId:'SUP:1',date:'2026-10-14',note:'n',payload:{businessType:'own',lines:[{id:'stable',description:'链',quantity:2,estimatedWeight:'1.2500',amountCents:123456}]}});
  assert.equal(purchase.lines[0].amount,'1234.56');
  const settlement=ui.editableValues({kind:'settlement',payload:{amountCents:1501,direction:'receive',allocations:[{billId:'bill',amountCents:1501}]}});
  assert.equal(settlement.amount,'15.01');
  assert.equal(settlement.allocations[0].amount,'15.01');
});

test('ERP UI shows separate estimated and received weights with an exact four-place difference', () => {
  assert.deepEqual(ui.detailWeights('purchase',{estimatedWeight:'5.60',actualWeight:'0.0000'}),{estimated:'5.6000',actual:'—',difference:'—'});
  assert.deepEqual(ui.detailWeights('receipt',{estimatedWeight:'99999999.9999',actualWeight:'100000000.0000'}),{estimated:'99999999.9999',actual:'100000000.0000',difference:'+0.0001'});
  assert.deepEqual(ui.detailWeights('receipt',{estimatedWeight:'1.2000',actualWeight:'1.0001'}),{estimated:'1.2000',actual:'1.0001',difference:'-0.1999'});
  assert.deepEqual(ui.detailWeights('receipt',{actualWeight:'1.2500'}),{estimated:'—',actual:'1.2500',difference:'—'});
});

test('ERP UI excludes a hidden prior sales source when changing to an opening balance', () => {
  const base={requestId:'req',partyId:'CUS:1',date:'2026-10-14',amount:'12.34',dueDate:'2026-10-14',sourceSaleId:'123',evidence:'期初确认依据'};
  assert.equal(ui.documentPayload('receivable',base).sourceSaleId,123);
  assert.equal('sourceSaleId' in ui.documentPayload('opening_receivable',base),false);
  assert.equal('sourceSaleId' in ui.documentPayload('opening_payable',{...base,partyId:'SUP:1'}),false);
});

test('ERP UI shows only the saved allowed sales snapshot values and marks missing old snapshots', () => {
  const result=ui.sourceSnapshotRows({sourceSaleId:12,sourceSnapshot:{id:12,date:'2026-10-14',product:'链<script>',status:'已成交',weight:'1.5000',sell_gram_price:'420.25',labor:'20.5',received:'500.01',amount_c:'1000.37',cost:'secret',profit:'secret'}});
  assert.ok(result.rows.some(([label,value])=>label==='原收入金额' && value==='1000.37 元'));
  assert.ok(result.rows.some(([label,value])=>label==='原已到账' && value==='500.01 元'));
  assert.ok(result.rows.some(([label,value])=>label==='商品' && value==='链<script>'));
  assert.equal(JSON.stringify(result).includes('secret'),false);
  assert.match(ui.sourceSnapshotRows({sourceSaleId:12}).warning,/旧记录未保存来源快照/);
  assert.equal(ui.sourceSnapshotRows({}),null);
});

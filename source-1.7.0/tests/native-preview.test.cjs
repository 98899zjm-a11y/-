'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
test('native design preview stays authenticated and read-only and rewrites only local paths',()=>{
 const{parsePreview,rewriteHtml}=require('../stage1/native-preview.cjs');assert.deepEqual(parsePreview('/native/ledger/sales?month=2026-10'),{module:'ledger',path:'/sales?month=2026-10'});assert.equal(parsePreview('/native/inventory/moves?mode=in').path,'/moves?mode=in');
 assert.deepEqual(parsePreview('/native/ledger/annotations/list?scope=form&path=%2Fnative%2Fledger%2Fsales&form=1'),{module:'ledger',path:'/annotations/list?scope=form&path=%2Fnative%2Fledger%2Fsales&form=1'},'encoded parameter values must not be mistaken for encoded routing separators');
 for(const uri of ['/native/ledger/../sales','/native/ledger/%2fapi','/native/ledger/../../auth/setup','/native/ledger/unsafe-execute','/native/inventory/sessions/1/delete'])assert.throws(()=>parsePreview(uri),/preview|Preview/);
 const html=rewriteHtml('<html><head></head><body><a href="/sales">销售</a><script src="/static/app.js"></script><script>fetch("/api/calculate")</script><form method="post" action="/sales/add"></form></body></html>','ledger','testnonce');assert.match(html,/href="\/native\/ledger\/sales"/);assert.match(html,/nonce="testnonce"/);assert.match(html,/\/native\/ledger\/static\/app.js/);assert.match(html,/虚构账套/);
});

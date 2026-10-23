'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),policy=require('../project/desktop/erp-policy.cjs');
const id='11111111-1111-4111-8111-111111111111';
test('supplier OCR paths stay fixed, with no caller path, URL or approval route',()=>{
 for(const [address,method]of [['/erp/api/ocr/capabilities','GET'],['/erp/api/ocr/imports','POST'],['/erp/api/ocr/imports/'+id,'GET'],['/erp/api/ocr/imports/'+id+'/draft','POST']])assert.ok(policy.routeFor(address,method));
 for(const address of ['/erp/api/ocr/imports/'+id+'?path=C:/file','/erp/api/ocr/imports/'+id+'/approve','/erp/api/ocr/imports/../private'])assert.throws(()=>policy.routeFor(address,'POST'));
});
test('creating or confirming an OCR draft requires procurement and image privileges',()=>{
 const grants={moduleAccess:{ledger:'operate'},capabilities:{'erp.read':true,'erp.purchase.prepare':true,'erp.attachments.write':true,'erp.reports.sensitive':true}};
 const input={module:'ledger',path:'/erp/api/ocr/imports',method:'POST',headers:{'content-type':'application/json'},bodyBase64:Buffer.from(JSON.stringify({attachmentId:id})).toString('base64')};
 assert.ok(policy.authorizeRequest(input,grants));
 for(const key of ['erp.purchase.prepare','erp.attachments.write','erp.reports.sensitive'])assert.throws(()=>policy.authorizeRequest(input,{...grants,capabilities:{...grants.capabilities,[key]:false}}));
 assert.throws(()=>policy.authorizeRequest(input,{...grants,moduleAccess:{ledger:'view'}}));
});

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
let api;try{api=require('../stage1/browser-module-proxy.cjs');}catch{api={};}
const origin='http://127.0.0.1:41831',csrf='a'.repeat(64),id='11111111-1111-4111-8111-111111111111';
function fixture(response={status:200,headers:{'content-type':'text/html'},bodyBase64:Buffer.from('<html><head></head><body><a href="/sales">销售</a><form action="/save" method="post"></form><script>fetch("/api/dashboard")</script></body></html>').toString('base64')}){
 assert.equal(typeof api.createBrowserModuleProxy,'function','browser module proxy is missing');const calls=[],intents=[];let user={id,active:true,role:'employee',moduleAccess:{ledger:'operate',inventory:'operate'}};
 const proxy=api.createBrowserModuleProxy({origin,getCsrf:()=>csrf,session:{auth:{status:()=>({authenticated:true,user})},dispatch:async input=>{calls.push(input);return{ok:true,status:200,data:response};}},registerPrintIntent:(source,module)=>{intents.push({source,module});return id;}});
 return{proxy,calls,intents,setUser:value=>{user=value;}};
}
test('module full page routes preserve signed original business transport and private HTML namespace',async()=>{
 const f=fixture();const result=await f.proxy.handle({url:'/modules/ledger/sales',method:'GET',headers:{},bytes:Buffer.alloc(0)});
 assert.equal(f.calls[0].path,'/api/internal-modules/proxy');assert.equal(f.calls[0].body.module,'ledger');assert.equal(f.calls[0].body.path,'/sales');
 assert.equal(result.headers['cache-control'],'no-store');assert.equal(result.bytes.toString().includes('href="/modules/ledger/sales"'),true);assert.equal(result.bytes.toString().includes('action="/modules/ledger/save"'),true);
});
test('absolute addresses, normalized traversal and cross-module redirects are denied before original dispatch',async()=>{
 const f=fixture();for(const url of ['https://evil.invalid/modules/ledger/','/modules/ledger/../inventory/','/modules/ledger/%2e%2e/','/modules/ledger/%2fsecret','/modules/not-real/','/modules/ledger//secret'])await assert.rejects(f.proxy.handle({url,method:'GET',headers:{},bytes:Buffer.alloc(0)}));assert.equal(f.calls.length,0);
 const redirected=fixture({status:302,headers:{location:'https://evil.invalid/'},bodyBase64:''});await assert.rejects(redirected.proxy.handle({url:'/modules/ledger/',method:'GET',headers:{},bytes:Buffer.alloc(0)}));
});
test('same module redirects are scoped and cannot escape into main API',async()=>{
 const f=fixture({status:302,headers:{location:'/sales?month=2026-10'},bodyBase64:''});const result=await f.proxy.handle({url:'/modules/ledger/save',method:'POST',headers:{origin,'content-type':'application/json','x-xjy-csrf':csrf},bytes:Buffer.from('{}')});assert.equal(result.headers.location,'/modules/ledger/sales?month=2026-10');
});
test('urlencoded legacy writes validate then strip only gateway CSRF while retaining original fields',async()=>{
 const f=fixture();await f.proxy.handle({url:'/modules/inventory/skus/save',method:'POST',headers:{origin,'content-type':'application/x-www-form-urlencoded'},bytes:Buffer.from('name=%E8%99%9A%E6%9E%84&_xjy_csrf='+csrf+'&qty=3')});
 const body=f.calls[0].body;assert.equal(body.method,'POST');assert.equal(Buffer.from(body.bodyBase64,'base64').toString(),'name=%E8%99%9A%E6%9E%84&qty=3');assert.equal(body.headers['content-type'],'application/x-www-form-urlencoded');
});
test('multipart imports retain genuine file bytes while removing gateway token',async()=>{
 const boundary='----fake-test-boundary';const content=Buffer.from('--'+boundary+'\r\nContent-Disposition: form-data; name="_xjy_csrf"\r\n\r\n'+csrf+'\r\n--'+boundary+'\r\nContent-Disposition: form-data; name="file"; filename="fake.xlsx"\r\nContent-Type: application/octet-stream\r\n\r\nFAKE-EXCEL-BYTES\r\n--'+boundary+'--\r\n');
 const f=fixture();await f.proxy.handle({url:'/modules/inventory/books/import',method:'POST',headers:{origin,'content-type':'multipart/form-data; boundary='+boundary},bytes:content});const out=Buffer.from(f.calls[0].body.bodyBase64,'base64');assert.equal(out.includes(Buffer.from('FAKE-EXCEL-BYTES')),true);assert.equal(out.includes(Buffer.from(csrf)),false);assert.equal(out.includes(Buffer.from('filename="fake.xlsx"')),true);
});
test('missing, duplicate or foreign-origin gateway CSRF does not reach original module',async()=>{
 const f=fixture();for(const headers of [{origin,'content-type':'application/json'},{origin:'https://evil.invalid','content-type':'application/json','x-xjy-csrf':csrf}])await assert.rejects(f.proxy.handle({url:'/modules/ledger/save',method:'POST',headers,bytes:Buffer.from('{}')}));
 await assert.rejects(f.proxy.handle({url:'/modules/ledger/save',method:'POST',headers:{origin,'content-type':'application/x-www-form-urlencoded'},bytes:Buffer.from('_xjy_csrf='+csrf+'&_xjy_csrf='+csrf)}));assert.equal(f.calls.length,0);
});
test('legacy cookies stay within one module and one browser proxy and never include gateway cookie',async()=>{
 const f=fixture({status:200,headers:{'content-type':'application/json','set-cookie':['xjy_ledger_session=private; Path=/; HttpOnly']},bodyBase64:Buffer.from('{}').toString('base64')});
 const first=await f.proxy.handle({url:'/modules/ledger/',method:'GET',headers:{cookie:'xjy_stage1=never-forward'},bytes:Buffer.alloc(0)});assert.equal(first.headers['set-cookie'],undefined);assert.equal(f.calls[0].body.headers.cookie,undefined);
 await f.proxy.handle({url:'/modules/ledger/sales',method:'GET',headers:{},bytes:Buffer.alloc(0)});assert.equal(f.calls[1].body.headers.cookie,'xjy_ledger_session=private');
 await f.proxy.handle({url:'/modules/inventory/',method:'GET',headers:{},bytes:Buffer.alloc(0)});assert.equal(f.calls[2].body.headers.cookie,undefined);
});
test('revoked module access and native-maintenance paths cannot be proxied',async()=>{
 const f=fixture();f.setUser({id,active:true,role:'employee',moduleAccess:{ledger:'disabled',inventory:'operate'}});await assert.rejects(f.proxy.handle({url:'/modules/ledger/',method:'GET',headers:{},bytes:Buffer.alloc(0)}));assert.equal(f.calls.length,0);
});
test('browser printing produces opaque intent from typed source and rejects an unrelated sales source',async()=>{
 const f=fixture();const result=await f.proxy.handle({url:'/modules/inventory/_central-print',method:'POST',headers:{origin,'content-type':'application/json','x-xjy-csrf':csrf},bytes:Buffer.from(JSON.stringify({source:{type:'inventory-count-a4',id:12,filter:'diff',sort:'code',blind:'0',mode:'filled'}}))});assert.equal(JSON.parse(result.bytes).intent,id);assert.equal(f.intents[0].source.id,12);assert.equal(f.calls.length,0);
 await assert.rejects(f.proxy.handle({url:'/modules/inventory/_central-print',method:'POST',headers:{origin,'content-type':'application/json','x-xjy-csrf':csrf},bytes:Buffer.from(JSON.stringify({source:{type:'quotation-a4',quoteId:id}}))}));
});
test('proxy never grants its nonce to an external or entity-obfuscated script address',async()=>{for(const src of ['https://evil.invalid/x.js','//evil.invalid/x.js','&#x2f;&#x2f;evil.invalid/x.js']){const f=fixture({status:200,headers:{'content-type':'text/html'},bodyBase64:Buffer.from('<html><head><script src="'+src+'"></script></head></html>').toString('base64')});await assert.rejects(f.proxy.handle({url:'/modules/ledger/',method:'GET',headers:{},bytes:Buffer.alloc(0)}),/脚本|同源/);}});
test('module runtime scopes real fetch and popup calls and never follows an external URL',async()=>{const vm=require('node:vm'),calls=[],opens=[],listeners={};function Xhr(){}Xhr.prototype.open=function(){};Xhr.prototype.send=function(){};const document={readyState:'loading',forms:[],documentElement:{style:{}},addEventListener:()=>{},hidden:false,hasFocus:()=>true,body:{replaceChildren:()=>{} }};const context={URL,Headers,XMLHttpRequest:Xhr,document,location:{origin,href:origin+'/modules/ledger/sales',assign:()=>{},reload:()=>{}},Date,setInterval:()=>1,clearInterval:()=>{},window:null};context.window={fetch:async(url,input)=>{calls.push({url,input});return new Response('{}',{headers:{'content-type':'application/json'}});},open:(...args)=>opens.push(args),addEventListener:(name,callback)=>{(listeners[name] ||= []).push(callback);},removeEventListener:()=>{},alert:()=>{}};vm.runInNewContext('('+api.moduleBrowserRuntime.toString()+')('+JSON.stringify({module:'ledger',csrf,source:null,actorId:id,grantRevision:0})+')',context);await context.window.fetch('/erp/api/documents',{method:'POST',body:'{}'});assert.equal(calls[0].url,origin+'/modules/ledger/erp/api/documents');assert.equal(calls[0].input.headers.get('x-xjy-csrf'),csrf);context.window.open('/reports/print');assert.equal(opens[0][0],origin+'/modules/ledger/reports/print');assert.throws(()=>context.window.fetch('https://evil.invalid/api'));assert.equal(calls.length,1);for(const callback of listeners.pagehide)callback({});assert.equal(document.documentElement.style.visibility,'hidden');});

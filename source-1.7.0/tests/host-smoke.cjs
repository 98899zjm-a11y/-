'use strict';
const assert=require('node:assert/strict');
async function verify(host){
 const a={cookie:'',csrf:''},b={cookie:'',csrf:''};
 async function call(browser,address,body,extra={}){const response=await fetch(host.origin+address,{method:body?'POST':'GET',headers:{cookie:browser.cookie,...(body?{origin:host.origin,'content-type':'application/json','x-xjy-csrf':browser.csrf}:{}),...extra},...(body?{body:JSON.stringify(body)}:{})});if(response.headers.get('set-cookie'))browser.cookie=response.headers.get('set-cookie').split(';')[0];const result=await response.json();if(result.csrf)browser.csrf=result.csrf;return{status:response.status,data:result};}
 assert.equal((await call(a,'/health')).status,200);
 assert.equal((await call(a,'/api/customers')).status,401);
 assert.equal((await fetch(host.origin+'/native/ledger/sales')).status,401,'native HTML and static assets require their own authenticated browser session');
 assert.equal((await fetch(host.origin+'/native/inventory/static/xjy-theme.css')).status,401);
 await call(a,'/session');await call(b,'/session');
 const anonymousCookie=a.cookie;
 assert.equal((await call(a,'/auth/login',{username:'demo-admin',password:'DemoAdmin-2026!'},{origin:'http://malicious.invalid'})).status,403);
 assert.equal((await call(a,'/auth/login',{username:'demo-admin',password:'DemoAdmin-2026!'})).status,200);
 assert.notEqual(a.cookie,anonymousCookie,'login must rotate browser session identifiers');
 assert.equal((await call(b,'/api/customers')).status,401,'other browser must not inherit admin identity');
 assert.equal((await call(b,'/auth/login',{username:'demo-sales-a',password:'DemoEmployee-A-2026!'})).status,200);
 assert.equal((await call(b,'/api/admin/module-permissions')).status,403);
 assert.equal((await call(a,'/api/bootstrap')).status,200);
 assert.equal((await call(a,'/api/customers')).status,200);
 const native=await call(a,'/api/internal-modules/proxy',{module:'ledger',path:'/algorithms/api',method:'GET'});
 assert.equal(native.status,200,'Financial bridge rejected the synthetic administrator request: '+JSON.stringify(native.data));assert.equal(native.data.status,200,'Financial module returned a non-success response: '+JSON.stringify(native.data));
 const algorithms=JSON.parse(Buffer.from(native.data.bodyBase64,'base64').toString('utf8'));
 assert.ok(algorithms.catalog.length>=6,'original finance algorithm domains must be inspectable');
 const denied=await call(b,'/api/internal-modules/proxy',{module:'ledger',path:'/algorithms/api',method:'GET'});assert.equal(denied.status,403);
 assert.equal((await fetch(host.origin+'/native/ledger/sales',{headers:{cookie:b.cookie}})).status,403,'sales-only employee cannot read financial native views');
 const nativePage=await fetch(host.origin+'/native/ledger/sales',{headers:{cookie:a.cookie}});assert.equal(nativePage.status,200);const nativeHtml=await nativePage.text();assert.match(nativeHtml,/虚构账套/);assert.match(nativeHtml,/\/native\/ledger\/static\/xjy-theme\.css/);assert.match(nativeHtml,/label for="w_date"/);
 assert.equal((await fetch(host.origin+'/native/ledger/annotations/list?scope=form&path=%2Fnative%2Fledger%2Fsales&form=1',{headers:{cookie:a.cookie}})).status,200,'native annotation reads must accept encoded query parameter values');
 assert.equal((await call(a,'/native/ledger/sales',{ignored:true})).status,405,'preview never forwards a mutation, including a correctly authenticated CSRF request');
 assert.equal((await call(a,'/native/inventory/sessions/1/delete')).status,400,'unknown or destructive native paths are denied before proxying');
 assert.equal((await call(b,'/auth/logout',{})).status,200);
 assert.equal((await call(a,'/api/users')).status,200,'employee logout must not close admin session');
 assert.equal((await call(b,'/api/users')).status,401);
}
module.exports={verify};

'use strict';
// Real restricted Host -> real session/backend -> newly compiled sidecar.
// Fictional accounts only. No SQLite handle, application stub or code import.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),cp=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
assert.equal(process.platform,'win32');assert.equal(ROOT.toLowerCase(),'c:\\xjy-work\\xjy-web-stage1');
const arg={};for(let i=2;i<process.argv.length;i+=2){assert(['--self-sha256','--expected-namespace'].includes(process.argv[i]));arg[process.argv[i]]=process.argv[i+1];}
function bytes(relative,empty=false){const file=path.join(ROOT,relative);assert(path.relative(ROOT,file)&&!path.relative(ROOT,file).startsWith('..'));for(let q=file;;q=path.dirname(q)){const st=fs.lstatSync(q);assert(!st.isSymbolicLink());if(q===file){assert(st.isFile()&&st.nlink===1&&st.size<=128*1024*1024&&(empty||st.size>0));}else assert(st.isDirectory());if(q===path.dirname(q))break;}return fs.readFileSync(file);}
function pin(relative,sha,empty=false){const b=bytes(relative,empty);assert.equal(hash(b),sha,relative);return b;}
pin('audit-tools/cashier170-real-http-a1.cjs',arg['--self-sha256']);
pin('stage1/guest-candidate-cdp.cjs','59840b638d8797fb55241616cd0b8e4098075a76834a201b0e93c1a748f1bb32');
const admission=require('../stage1/guest-candidate-cdp.cjs').actualGuard();
const identity=JSON.parse(bytes('isolation-identity.json').toString('utf8').replace(/^\uFEFF/,''));assert.equal(identity.namespace,arg['--expected-namespace']);
const pins=JSON.parse(pin('audit-tools/cashier170-adapter-transport-a2-pins.json','7ac109f9c4cd4cc6f35ab853f5f77269f2e7e179cd5e841d37a924e2750397bf')).literalRequireAndMigrationClosure;
for(const [file,sha] of Object.entries(pins))pin(file,sha);
pin('stage1/host.cjs','887191c81ca04087ac64246ea2422e31305965c7312261504fab8ea341622d5f');
const ready=JSON.parse(pin('runtime/host-ready.json','184ae6bbf6c3e9d0ad214d73cd90e861a1542bead165a7ec8172735a8abc0b61'));
assert.equal(ready.namespace,identity.namespace);assert.equal(ready.host,'127.0.0.1');assert.equal(ready.port,41831);assert.equal(ready.pid,7104);assert.equal(ready.productionDeployment,false);
for(const slot of ['sales','ledger','inventory']){const m=JSON.parse(bytes('data/'+slot+'/synthetic-fixture.json'));assert.equal(m.synthetic,true);assert.equal(m.namespace,identity.namespace);}
const manifest=JSON.parse(pin('project/desktop/legacy-modules/manifest.json','a00843f1e3a880c99763330a10095bf5d92f44edd56d3abd6a146d9bddf243df'));
const entry=manifest.modules.find(x=>x.id==='ledger');assert.equal(entry.sha256,'a7dd90f4b0e293ecb928f94a118fc237911caf5099c1b012cae378fea72e4202');
for(const item of entry.files){assert(item.path.split('/').every(x=>x&&x!=='.'&&x!=='..'&&!/[\\:]/.test(x)));assert.equal(pin('project/desktop/legacy-modules/xjy-ledger/'+item.path,item.sha256,true).length,item.size);}
const observation=cp.spawnSync('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoProfile','-NonInteractive','-Command',"[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); @(Get-NetTCPConnection -State Listen -LocalPort 41831 | Select-Object LocalAddress,OwningProcess) | ConvertTo-Json -Compress"],{encoding:'utf8',windowsHide:true,shell:false});assert.equal(observation.status,0);
const seen=JSON.parse(observation.stdout);assert([].concat(seen).length>0);assert([].concat(seen).every(x=>x.LocalAddress==='127.0.0.1'&&x.OwningProcess===ready.pid));
const out='C:/xjy-results/cashier170-real-http-a1';fs.mkdirSync(out);
const result={admission,namespace:identity.namespace,hostPid:ready.pid,ledgerExeSha256:entry.sha256,realHttp:true,applicationStub:false,databaseOpenedByClient:false,electronUiVerified:false,nativeRestoreCliVerified:false,requests:[],passed:[],success:false};
function client(){let cookie='',csrf='';return{async call(address,body,method=body===undefined?'GET':'POST'){
 assert(address.startsWith('/api/')||['/session','/auth/login','/auth/logout'].includes(address));
 const response=await fetch(ready.origin+address,{method,redirect:'manual',headers:{cookie,...(body===undefined?{}:{'content-type':'application/json',origin:ready.origin,'x-xjy-csrf':csrf})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(65000)});
 const set=response.headers.get('set-cookie');if(set)cookie=set.split(';')[0];const text=await response.text();assert(Buffer.byteLength(text)<=2*1024*1024);let data;try{data=JSON.parse(text);}catch{data={};}if(data.csrf)csrf=data.csrf;
 result.requests.push({path:address,status:response.status});return{status:response.status,data};
}};}
async function good(c,address,body,method){const r=await c.call(address,body,method);assert.equal(r.status,200,address+': '+String(r.data?.error||r.status));return r.data;}
async function proxy(c,address,body,method=body===undefined?'GET':'POST',module='cashier'){
 const r=await c.call('/api/internal-modules/proxy',{module,path:address,method,...(body===undefined?{}:{headers:{'content-type':'application/json'},bodyBase64:Buffer.from(JSON.stringify(body)).toString('base64')})});
 if(r.status!==200)return r;assert(Number.isInteger(r.data.status)&&typeof r.data.bodyBase64==='string');const raw=Buffer.from(r.data.bodyBase64,'base64').toString('utf8');let data;try{data=JSON.parse(raw);}catch{data={};}return{status:r.data.status,data,raw};
}
async function cash(c,address,body,method){const r=await proxy(c,address,body,method);assert.equal(r.status,200,address+': '+String(r.data?.error||r.status));assert.equal(r.data.ok,true);return r.data;}
const mark=name=>{result.passed.push(name);console.log('PASS '+name);};
const admin=client(),reviewer=client(),employee=client();
(async()=>{try{
 assert.equal((await proxy(client(),'/cashier/api/bootstrap')).status,401);
 for(const [c,username,password] of [[admin,'demo-admin','DemoAdmin-2026!'],[reviewer,'demo-reviewer','DemoReviewer-2026!'],[employee,'demo-sales-a','DemoEmployee-A-2026!']]){await good(c,'/session');await good(c,'/auth/login',{username,password});}
 const a=(await good(admin,'/session')).user,b=(await good(reviewer,'/session')).user;assert(a?.id&&b?.id&&a.id!==b.id);mark('H01 real independent sessions and anonymous denial');
 assert.equal((await proxy(employee,'/cashier/api/bootstrap')).status,403);
 assert.equal((await proxy(admin,'/cashier/api/bootstrap',undefined,'GET','ledger')).status,403);
 assert([400,403].includes((await proxy(admin,'/erp/api/bootstrap')).status));mark('H02 employee and cross-module authority denial');
 const html=await proxy(admin,'/cashier/');assert.equal(html.status,200);assert.match(html.raw,/\/cashier\/static\/cashier\.js/);
 for(const name of ['cashier.css','cashier.js']){const asset=await proxy(admin,'/cashier/static/'+name);assert.equal(asset.status,200);assert(asset.raw.length>100);}
 assert.equal((await cash(admin,'/cashier/api/bootstrap')).actor.staffId,a.id);mark('H03 actual original App, page, assets and cashier bootstrap');
 const account=(await cash(admin,'/cashier/api/accounts',{requestId:crypto.randomUUID(),code:'native-'+crypto.randomUUID(),name:'隔离测试现金柜',kind:'cash',currency:'CNY',maskedReference:'',note:'仅虚构测试'})).account;
 await cash(admin,'/cashier/api/accounts/'+account.id+'/scopes',{requestId:crypto.randomUUID(),staffId:b.id,level:'manage',revision:0,note:'虚构第二人复核范围'});
 const draft=(await cash(admin,'/cashier/api/documents',{requestId:crypto.randomUUID(),kind:'opening',accountId:account.id,businessDate:'2026-10-19',amountCents:'10000',evidence:'虚构期初盘点凭证',note:'不是真实款项'})).document;
 const pending=(await cash(admin,'/cashier/api/documents/'+draft.id+'/submit',{requestId:crypto.randomUUID(),revision:draft.revision})).document;
 assert.equal((await proxy(admin,'/cashier/api/documents/'+draft.id+'/review',{requestId:crypto.randomUUID(),revision:pending.revision,hash:pending.frozenHash,decision:'approve',note:'本人不得审批'})).status,403);mark('H04 actual scope setup, draft, submit and self-review denial');
 const review={requestId:crypto.randomUUID(),revision:pending.revision,hash:pending.frozenHash,decision:'approve',note:'虚构第二人审核'};
 const posted=(await cash(reviewer,'/cashier/api/documents/'+draft.id+'/review',review)).document;assert.equal(posted.status,'confirmed');
 assert.equal((await cash(reviewer,'/cashier/api/documents/'+draft.id+'/review',review)).document.id,posted.id);
 assert.equal((await cash(admin,'/cashier/api/accounts')).accounts.find(x=>x.id===account.id).balanceCents,10000);mark('H05 distinct approval, identical retry and exact balance');
 await cash(admin,'/cashier/api/accounts/'+account.id+'/scopes',{requestId:crypto.randomUUID(),staffId:b.id,level:'disabled',revision:1,note:'虚构即时撤权'});
 assert.equal((await proxy(reviewer,'/cashier/api/documents/'+draft.id)).status,403);
 assert.equal((await cash(admin,'/cashier/api/accounts')).accounts.find(x=>x.id===account.id).balanceCents,10000);mark('H06 live account revocation preserves the balance');
 for(const [file,sha] of Object.entries(pins))pin(file,sha);pin('project/desktop/legacy-modules/manifest.json','a00843f1e3a880c99763330a10095bf5d92f44edd56d3abd6a146d9bddf243df');result.success=true;
}catch(error){result.error={message:error.message,stack:error.stack};process.exitCode=1;console.error(error.message);}finally{
 for(const c of [admin,reviewer,employee])try{await c.call('/auth/logout',{});}catch{}
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({success:result.success,passed:result.passed.length,requests:result.requests.length,resultFile:path.join(out,'results.json')}));
}})();

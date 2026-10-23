'use strict';
// Root-only client for an ALREADY running original restricted stage1 host.
// Starts no service and imports no product/business modules. Actual browser
// cookie + CSRF -> unchanged gateway -> signed original ledger HTTP service.
// Readable-source pins do not by themselves prove compiled EXE equivalence.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..'),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
if(process.platform!=='win32'||ROOT.toLowerCase()!=='c:\\xjy-work\\xjy-web-stage1')throw Error('Fixed actual Guest required; Host refused');
const GUARDS={
 'stage1/guest-candidate-cdp.cjs':'59840b638d8797fb55241616cd0b8e4098075a76834a201b0e93c1a748f1bb32',
 'stage1/sandbox-context.py':'09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249',
 'stage1/validate-sandbox-context.py':'867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207',
 'stage1/tools/node.exe':'ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32',
};
const SOURCES={
 'stage1/host.cjs':'887191c81ca04087ac64246ea2422e31305965c7312261504fab8ea341622d5f',
 'stage1/run-restricted.py':'742e25f5405f69a345c7557e19bfa674a490ae0e57c9d5c957922a9e41b6b1bc',
 'stage1/web-gateway.cjs':'3fb5521a94ff5e8fcac514a48d3cfccaf293017c43b54c43b6c26b0041c0a515',
 'stage1/erp-web-adapter.cjs':'eda0fc55a3bd59e976cc429bc679440727aa4758e0ab8dc6e67f76e7daa8140b',
 'project/desktop/erp-policy.cjs':'e2b12960405ac0f39a3bc8d8dec1c689972d12f89de2e8387d1cea6c968880e2',
 'project/desktop/legacy-source/ledger/finance.py':'56bcb389a21ada8c5d650e6f7ea1e81781b446f3af0a4e9b19e019930df63096',
 'project/desktop/legacy-source/ledger/sidecar.py':'9f4dddb973609100fed52e4f3c0ec941186c89644fcf68ad27509c0512bb8d1e',
 'project/desktop/legacy-source/ledger/erp.py':'cb3e1c463029e719939f8cf718b2218a99e08831fcb4bc3c4d1199eb8bfc28a0',
 'project/desktop/legacy-source/ledger/erp_values.py':'e7be9186775fcdf935322d40a7de1757bd1e91b4ad5b69f4090239d1b0a74419',
 'project/desktop/legacy-source/ledger/erp_documents.py':'fd60ca35b92371092c81654b99697ca5ca151978cd4b8e8b65acecb891c1004f',
 'project/desktop/legacy-source/ledger/erp_settlement.py':'2ee5872aa2ed660c2a41f2326eea6a97e8a4e6c5dd60cf5e6890b59c2d3a32c7',
 'project/desktop/legacy-source/ledger/erp_common.py':'7a682328bb61aecd664a9ae507a30dfbb37c8aa0d551298b5639a926c2f963ab',
 'project/desktop/legacy-source/ledger/erp_reports.py':'fc316d96468da729438129586deae8c2003f5ae1075757832644cccf3d292a1d',
 'project/desktop/legacy-source/ledger/erp_schema.py':'427dadf39f697e206cbc5b95c16c88048a641232ee85b77e8f8bd008a305fb96',
 'project/desktop/legacy-source/ledger/erp_suppliers.py':'d5100befc966344fa6d027c88c2feca31c27625d93ca4e30bd9940decf411a17',
};
function ordinary(file,directory=false){
 assert(path.isAbsolute(file)&&!/^[/\\]{2}/.test(file)&&!/[\x00-\x1f]/.test(file));
 const absolute=path.resolve(file);assert(!absolute.slice(3).includes(':'));
 for(let current=absolute;;current=path.dirname(current)){const s=fs.lstatSync(current);assert(!s.isSymbolicLink()&&(!s.isFile()||s.nlink===1),'Links refused');if(current!==absolute)assert(s.isDirectory());if(current===path.dirname(current))break;}
 assert.equal(fs.realpathSync.native(absolute).toLowerCase(),absolute.toLowerCase());
 assert(directory?fs.lstatSync(absolute).isDirectory():fs.lstatSync(absolute).isFile());return absolute;
}
function read(file,max=4*1024*1024,allowEmpty=false){
 ordinary(file);const a=fs.lstatSync(file,{bigint:true});assert((allowEmpty?a.size>=0n:a.size>0n)&&a.size<=BigInt(max));const fd=fs.openSync(file,'r');
 try{const b=fs.fstatSync(fd,{bigint:true}),bytes=fs.readFileSync(fd),c=fs.fstatSync(fd,{bigint:true}),d=fs.lstatSync(file,{bigint:true});for(const key of ['dev','ino','size','mtimeNs','nlink']){assert.equal(a[key],b[key]);assert.equal(b[key],c[key]);assert.equal(c[key],d[key]);}for(const key of ['ctimeNs','birthtimeNs']){assert.equal(a[key],d[key]);assert.equal(b[key],c[key]);}assert.equal(BigInt(bytes.length),a.size);return bytes;}finally{fs.closeSync(fd);}
}
function pinned(relative,pin,max){assert.match(pin,/^[a-f0-9]{64}$/);const bytes=read(path.join(ROOT,...relative.split('/')),max);assert.equal(sha(bytes),pin,'Frozen input changed: '+relative);return bytes;}
for(const [name,pin]of Object.entries(GUARDS))pinned(name,pin,128*1024*1024);
assert.equal(path.resolve(process.execPath).toLowerCase(),path.join(ROOT,'stage1/tools/node.exe').toLowerCase());
const actualContext=require('../stage1/guest-candidate-cdp.cjs').actualGuard();
const argv=process.argv.slice(2),options={};assert.equal(argv.length,8,'Four exact option/value pairs required');
for(let i=0;i<argv.length;i+=2){assert(['--self-sha256','--expected-namespace','--ready-sha256','--legacy-manifest-sha256'].includes(argv[i]));assert(!Object.hasOwn(options,argv[i]));options[argv[i]]=argv[i+1];}
assert.match(options['--expected-namespace'],/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
pinned('audit-tools/finance-erp-round2-http-a2.cjs',options['--self-sha256']);
for(const [name,pin]of Object.entries(SOURCES))pinned(name,pin);
const identity=JSON.parse(read(path.join(ROOT,'isolation-identity.json')).toString('utf8').replace(/^\uFEFF/,''));
assert.equal(identity.namespace,options['--expected-namespace']);
const ready=JSON.parse(pinned('runtime/host-ready.json',options['--ready-sha256']));
assert.equal(ready.namespace,identity.namespace);assert.equal(ready.host,'127.0.0.1');assert.equal(ready.productionDeployment,false);
assert(Number.isInteger(ready.pid)&&ready.pid>0);assert(Number.isInteger(ready.port)&&ready.port>=1024&&ready.port<=65535&&ready.port!==31831);
assert.equal(ready.origin,'http://127.0.0.1:'+ready.port);
for(const relative of ['data/sales/synthetic-fixture.json','data/ledger/synthetic-fixture.json','data/inventory/synthetic-fixture.json']){
 const marker=JSON.parse(read(path.join(ROOT,relative)));assert.equal(marker.synthetic,true);assert.equal(marker.namespace,identity.namespace);
}
// The original factory checks its module manifest when it loads the service.
// Independently bind and verify the currently admitted public module tree too.
const manifest=JSON.parse(pinned('project/desktop/legacy-modules/manifest.json',options['--legacy-manifest-sha256']));
assert.equal(manifest.version,1);assert.equal(manifest.modules.length,2);
const ledger=manifest.modules.find(x=>x.id==='ledger');assert(ledger&&ledger.file==='xjy-ledger.exe'&&Array.isArray(ledger.files));
const moduleDir=path.join(ROOT,'project/desktop/legacy-modules/xjy-ledger'),seen=new Set();
for(const item of ledger.files){assert.match(item.path,/^[A-Za-z0-9_./ -]+$/);assert(item.path.split('/').every(part=>part&&part!=='.'&&part!=='..'&&!/[ .]$/.test(part))&&!seen.has(item.path.toLowerCase()));seen.add(item.path.toLowerCase());const bytes=read(path.join(moduleDir,...item.path.split('/')),64*1024*1024,true);assert.equal(bytes.length,item.size);assert.equal(sha(bytes),item.sha256);}
function scan(dir,base=''){const names=[];for(const entry of fs.readdirSync(ordinary(dir,true),{withFileTypes:true})){const key=base+entry.name;ordinary(path.join(dir,entry.name),entry.isDirectory());if(entry.isDirectory())names.push(...scan(path.join(dir,entry.name),key+'/'));else names.push(key.toLowerCase());}return names;}
assert.deepEqual(scan(moduleDir).sort(),[...seen].sort());assert.equal(sha(read(path.join(moduleDir,ledger.file),64*1024*1024)),ledger.sha256);
const cp=require('node:child_process');
const listener=cp.spawnSync('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoProfile','-NonInteractive','-Command',`$ErrorActionPreference='Stop'; @(Get-NetTCPConnection -State Listen -LocalPort ${ready.port} | Select-Object LocalAddress,LocalPort,OwningProcess) | ConvertTo-Json -Compress`],{windowsHide:true,shell:false,encoding:'utf8',timeout:20000});
assert.equal(listener.status,0);const rows=JSON.parse(listener.stdout),listeners=Array.isArray(rows)?rows:[rows];assert(listeners.length>0);assert(listeners.every(x=>x.LocalAddress==='127.0.0.1'&&Number(x.LocalPort)===ready.port&&Number(x.OwningProcess)===ready.pid));
const output=path.join(ROOT,'runtime','finance-erp-round2-http-'+crypto.randomUUID());ordinary(path.dirname(output),true);fs.mkdirSync(output);ordinary(output,true);
const result={purpose:'finance-erp-round2-real-browser-http',namespace:identity.namespace,actualContext,readySha256:options['--ready-sha256'],legacyManifestSha256:options['--legacy-manifest-sha256'],ledgerExeSha256:ledger.sha256,sourcePins:SOURCES,selfSha256:options['--self-sha256'],compiledSourceEquivalenceEstablishedByThisVerifier:false,originalServiceHttp:true,physicalUiVerified:false,passed:[],failures:[],requests:[],artifacts:[],success:false};
function client(){let cookie='',csrf='';return{async call(address,body,extraHeaders={}){assert(address.startsWith('/erp/')||['/session','/auth/login','/auth/logout'].includes(address));const response=await fetch(ready.origin+address,{method:body===undefined?'GET':'POST',redirect:'manual',headers:{cookie,...(body===undefined?{}:{'content-type':'application/json',origin:ready.origin,'x-xjy-csrf':csrf}),...extraHeaders},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)});const set=response.headers.get('set-cookie');if(set)cookie=set.split(';')[0];const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;assert(size<=4*1024*1024,'Bounded original HTTP result required');chunks.push(Buffer.from(chunk));}const bytes=Buffer.concat(chunks);let data;try{data=JSON.parse(bytes.toString('utf8'));}catch{data=null;}if(data?.csrf)csrf=data.csrf;result.requests.push({path:address,status:response.status});return{status:response.status,data,bytes,headers:response.headers};}};}
const maker=client(),checker=client();
async function good(session,address,body){const value=await session.call(address,body);assert.equal(value.status,200,address+' '+JSON.stringify(value.data));assert(value.data&&value.data.ok!==false);return value.data;}
const mark=name=>{result.passed.push(name);console.log('PASS '+name);};
let party;
const report=async(day,extra='')=>(await good(maker,'/erp/api/reports?asOf='+day+'&partyId='+encodeURIComponent(party.id)+extra)).report;
async function debt(day,amount,extra=''){const r=await report(day,extra);assert.equal(r.totals.payableCents,amount);assert.equal(r.rows.reduce((s,row)=>s+row.balanceCents,0),amount);assert.equal(r.aging.reduce((s,row)=>s+row.payableCents,0),amount);assert(r.rows.every(row=>row.partyId===party.id&&row.kind==='payable'));return r;}
const create=async(kind,more={})=>(await good(maker,'/erp/api/documents',{requestId:crypto.randomUUID(),kind,partyId:party.id,date:'2026-10-02',...(['settlement','reversal'].includes(kind)?{}:{dueDate:'2026-10-31'}),note:'独立第二轮虚构合同',...more})).document;
const submit=async doc=>(await good(maker,'/erp/api/documents/'+doc.id+'/submit',{revision:doc.revision})).document;
const reviewBody=(doc,hash=doc.hash)=>({revision:doc.revision,hash,decision:'approve',note:'独立员工复核虚构合同'});
const review=async doc=>(await good(checker,'/erp/api/documents/'+doc.id+'/review',reviewBody(doc))).document;
const confirm=async doc=>review(await submit(doc));
function xmlText(value){return value.replace(/&#(x[0-9a-f]+|[0-9]+);/gi,(_,n)=>String.fromCodePoint(n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n))).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');}
function workbook(bytes){
 // Bounded in-memory OOXML assertion reader; no extraction, formulas or macros.
 const zlib=require('node:zlib');let end=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(bytes.readUInt32LE(i)===0x06054b50){end=i;break;}assert(end>=0);assert.equal(bytes.readUInt16LE(end+4),0);assert.equal(bytes.readUInt16LE(end+6),0);const count=bytes.readUInt16LE(end+10);assert(count>0&&count<=64);let at=bytes.readUInt32LE(end+16);const centralEnd=at+bytes.readUInt32LE(end+12);assert(centralEnd<=end);const entries=new Map();let total=0;
 for(let i=0;i<count;i++){assert(at+46<=centralEnd);assert.equal(bytes.readUInt32LE(at),0x02014b50);const flags=bytes.readUInt16LE(at+8),method=bytes.readUInt16LE(at+10),compressed=bytes.readUInt32LE(at+20),size=bytes.readUInt32LE(at+24),nameLen=bytes.readUInt16LE(at+28),extra=bytes.readUInt16LE(at+30),comment=bytes.readUInt16LE(at+32),offset=bytes.readUInt32LE(at+42);assert(!(flags&1)&&[0,8].includes(method)&&size<=1024*1024);assert(at+46+nameLen+extra+comment<=centralEnd);const name=bytes.subarray(at+46,at+46+nameLen).toString('utf8');assert(!name.startsWith('/')&&!name.split('/').includes('..')&&!entries.has(name));assert(offset+30<=bytes.length);assert.equal(bytes.readUInt32LE(offset),0x04034b50);const start=offset+30+bytes.readUInt16LE(offset+26)+bytes.readUInt16LE(offset+28);assert(start+compressed<=bytes.length);const packed=bytes.subarray(start,start+compressed),body=method===0?packed:zlib.inflateRawSync(packed,{maxOutputLength:Math.max(1,size)});assert.equal(body.length,size);total+=size;assert(total<=4*1024*1024);entries.set(name,body.toString('utf8'));at+=46+nameLen+extra+comment;}
 assert.equal(at,centralEnd);assert(entries.has('[Content_Types].xml')&&entries.has('xl/workbook.xml'));const names=[...entries.get('xl/workbook.xml').matchAll(/<sheet\b[^>]*\bname="([^"]+)"/g)].map(x=>xmlText(x[1]));assert.deepEqual(names,['往来余额','汇总','账龄','收付款','采购验收','筛选条件']);
 const sheets=[];for(let n=1;n<=6;n++){const xml=entries.get('xl/worksheets/sheet'+n+'.xml');assert(xml&&!/<!DOCTYPE|<!ENTITY|<(?:[A-Za-z_]+:)?f(?:\s|>)/i.test(xml));const rows=[];for(const match of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)){const values=[];values.cellTypes=[];for(const cell of match[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)){const coordinate=/\br="([A-Z]+)[0-9]+"/.exec(cell[1]);assert(coordinate);const index=[...coordinate[1]].reduce((s,c)=>s*26+c.charCodeAt(0)-64,0)-1;const type=/\bt="([^"]+)"/.exec(cell[1])?.[1];values.cellTypes[index]=type;if(type==='inlineStr')values[index]=xmlText([...cell[2].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(x=>x[1]).join(''));else{assert(!type||type==='n');values[index]=/<v>([^<]*)<\/v>/.exec(cell[2])?.[1]??'';}}rows.push(values);}sheets.push(rows);}return sheets;
}
async function exportCheck(day,expected,payment,first,second){
 const response=await maker.call('/erp/api/export.xlsx?asOf='+day+'&partyId='+encodeURIComponent(party.id));assert.equal(response.status,200);assert.match(response.headers.get('content-type')||'',/application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/);
 const sheets=workbook(response.bytes),balances=sheets[0].slice(1);assert.equal(balances.length,2);const byNumber=new Map(balances.map(row=>[row[0],row]));assert.deepEqual(byNumber.get(first.number).slice(5,8),day==='2026-10-08'?['1000.00','200.00','800.00']:['1000.00','0.00','1000.00']);assert.deepEqual(byNumber.get(second.number).slice(5,8),['900.00','0.00','900.00']);assert(balances.every(row=>row[2]===party.name&&row.cellTypes[2]==='inlineStr'&&row.cellTypes.slice(5,8).every(type=>type==='inlineStr')));const totals=new Map(sheets[1].slice(1).map(row=>[row[0],row[1]]));assert.equal(totals.get('未结应付 / 元'),expected);assert.equal(totals.get('净确认付款 / 元'),payment);assert(sheets[1].filter(row=>['未结应付 / 元','净确认付款 / 元'].includes(row[0])).every(row=>row.cellTypes[1]==='inlineStr'));const filters=new Map(sheets[5].slice(1).map(row=>[row[0],row[1]]));assert.equal(filters.get('asOf'),day);assert.equal(filters.get('partyId'),party.id);
 const file=path.join(output,'asof-'+day+'.xlsx');fs.writeFileSync(file,response.bytes,{flag:'wx'});result.artifacts.push({file:path.relative(ROOT,file).replaceAll('\\','/'),sha256:sha(response.bytes),bytes:response.bytes.length,exactCentsAndTextVerified:true});
}
async function main(){
 try{
  assert.equal((await maker.call('/erp/api/bootstrap')).status,401);await good(maker,'/session');await good(maker,'/auth/login',{username:'demo-admin',password:'DemoAdmin-2026!'});await good(checker,'/session');await good(checker,'/auth/login',{username:'demo-reviewer',password:'DemoReviewer-2026!'});
  const boot=await good(maker,'/erp/api/bootstrap'),checked=await good(checker,'/erp/api/bootstrap');assert.notEqual(boot.actor.staffId,checked.actor.staffId);assert(boot.actor.capabilities.includes('erp.reports.sensitive'));
  const deniedParty={requestId:crypto.randomUUID(),kind:'supplier',name:'ERP-ROUND2-DENIED-'+crypto.randomUUID()};assert.equal((await maker.call('/erp/api/parties',deniedParty,{'x-xjy-csrf':'wrong'})).status,403);assert.equal((await maker.call('/erp/api/parties',deniedParty,{origin:'http://other.invalid'})).status,403);assert(!(await good(maker,'/erp/api/parties')).parties.some(row=>row.name===deniedParty.name));
  for(const endpoint of ['/erp/api/reports','/erp/api/export.xlsx']){assert.equal((await maker.call(endpoint+'?asOf=2026-10-19')).status,200);for(const query of ['asOf=2026-10-19&asOf=2026-10-01','asOf=2026-10-19&asOf=2026-10-19','status=confirmed&status=pending','partyId=SUP%3A1&partyId=SUP%3A2'])assert.equal((await maker.call(endpoint+'?'+query)).status,400,'Original JS policy must reject duplicate filters');}
  mark('J01 browser auth plus normal/duplicate report and export controls');
  party=(await good(maker,'/erp/api/parties',{requestId:crypto.randomUUID(),kind:'supplier',name:'=ERP-ROUND2-'+crypto.randomUUID().slice(0,8),contact:'虚构联系人',phone:'000',termsDays:30,note:'独立虚构ERP'})).party;
  const pendingOrder=await submit(await create('purchase',{businessType:'own',lines:[{description:'虚构真实结构无关的验收货',material:'铂金',purity:'Pt950',quantity:2,estimatedWeight:'10.0000',amount:'1900.00'}]}));
  assert.equal((await maker.call('/erp/api/documents/'+pendingOrder.id+'/review',reviewBody(pendingOrder))).status,403);assert.equal((await checker.call('/erp/api/documents/'+pendingOrder.id+'/review',reviewBody(pendingOrder,'0'.repeat(64)))).status,409);await debt('2026-10-02',0);const order=await review(pendingOrder);assert.equal(order.status,'confirmed');assert.equal(order.authorId,boot.actor.staffId);assert.equal(order.reviewerId,checked.actor.staffId);await debt('2026-10-02',0);mark('J02 purchase self-review/hash rejection and approved purchase creates no payable');
  const receipt=async(date,amount,actualWeight)=>create('receipt',{date,sourceId:order.id,lines:[{purchaseLineId:order.lines[0].id,quantity:1,actualWeight,amount}]});
  const firstDraft=await receipt('2026-10-03','1000.00','5.1000');await debt('2026-10-03',0);const firstPending=await submit(firstDraft);await debt('2026-10-03',0);const first=await review(firstPending);assert.equal(first.amountCents,100000);await debt('2026-10-03',100000);const second=await confirm(await receipt('2026-10-04','900.00','4.9500'));assert.equal(second.amountCents,90000);await debt('2026-10-04',190000);const later=await report('2026-10-04');const purchase=later.purchase.find(row=>row.id===order.id);assert.equal(purchase.lines[0].receivedQuantity,2);assert.equal(purchase.lines[0].remainingQuantity,0);mark('J03 two independently reviewed partial receipts create exactly 190000 cents payable');
  const partialPending=await submit(await create('settlement',{date:'2026-10-06',direction:'pay',amount:'200.00',account:'虚构银行账户',allocations:[{billId:first.billId,amount:'200.00'}]}));await debt('2026-10-08',190000);assert.equal((await maker.call('/erp/api/documents/'+partialPending.id+'/review',reviewBody(partialPending))).status,403);await debt('2026-10-08',190000);const partial=await review(partialPending);const paid=await debt('2026-10-08',170000);assert.equal(paid.totals.paidCents,20000);assert.equal(paid.rows.find(row=>row.id===first.billId).settledCents,20000);assert.equal(paid.rows.find(row=>row.id===first.billId).balanceCents,80000);mark('J04 pending/self-reviewed payment has no effect and other reviewer commits partial payment');
  const locked=await submit(await create('reversal',{date:'2026-10-09',targetId:first.id,note:'存在有效核销不可冲销验收债务'}));assert.equal((await checker.call('/erp/api/documents/'+locked.id+'/review',reviewBody(locked))).status,409);await debt('2026-10-08',170000);await exportCheck('2026-10-08','1700.00','200.00',first,second);
  const undo=await confirm(await create('reversal',{date:'2026-10-10',targetId:partial.id,note:'追加相反分录，保留原付款金额'}));assert.equal(undo.status,'confirmed');const original=(await good(maker,'/erp/api/documents/'+partial.id)).document;assert.equal(original.amountCents,20000);assert.equal(original.status,'reversed');assert(original.events.length>=3);const restored=await debt('2026-10-11',190000);assert.equal(restored.totals.paidCents,0);assert.deepEqual(restored.cash.map(row=>row.amountCents),[20000,-20000]);mark('J05 allocated debt reversal fails; payment reversal appends opposite posting and preserves original');
  await debt('2026-10-02',0);await debt('2026-10-03',100000);await debt('2026-10-04',190000);await debt('2026-10-05',190000);await debt('2026-10-08',170000);await debt('2026-10-11',190000);const sourceFiltered=await debt('2026-10-08',80000,'&from=2026-10-03&to=2026-10-03');assert.equal(sourceFiltered.rows.length,1);assert.equal(sourceFiltered.rows[0].settledCents,20000);mark('J06 as-of balances remain historical and source-date filtering retains later allocation');
  await exportCheck('2026-10-11','1900.00','0.00',first,second);mark('J07 actual OOXML exact bill cents, payment totals, formula-text safety and filters');
  for(const [name,pin]of Object.entries(SOURCES))pinned(name,pin);pinned('runtime/host-ready.json',options['--ready-sha256']);pinned('project/desktop/legacy-modules/manifest.json',options['--legacy-manifest-sha256']);result.success=true;
 }catch(error){result.failures.push({stage:result.passed.length,message:error.message});process.exitCode=1;}
 finally{for(const session of [maker,checker])try{await session.call('/auth/logout',{});}catch(error){result.failures.push({stage:'logout',message:error.message});result.success=false;process.exitCode=1;}const file=path.join(output,'result.json');fs.writeFileSync(file,JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify({success:result.success,passed:result.passed.length,failures:result.failures.length,resultFile:file,sha256:sha(read(file)),compiledSourceEquivalenceEstablishedByThisVerifier:false}));}
}
main().catch(error=>{process.exitCode=1;console.error(error.stack);});

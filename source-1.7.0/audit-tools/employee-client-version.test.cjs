'use strict';
// Root-only actual Guest. Real backend/auth/administration + memory SQLite;
// actual renderer definitions/React JSX, never hooks, a DOM or a native updater.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'..'),sha=body=>crypto.createHash('sha256').update(body).digest('hex');
if(process.platform!=='win32'||ROOT.toLowerCase()!=='c:\\xjy-work\\xjy-web-stage1')throw Error('Fixed actual Guest required before business/native evaluation');
function read(relative,max=1024*1024){const file=path.join(ROOT,...relative.split('/'));for(let p=file;;p=path.dirname(p)){const s=fs.lstatSync(p);if(s.isSymbolicLink()||s.isFile()&&s.nlink!==1)throw Error('Reviewed input link refused');if(p===path.dirname(p))break;}const s=fs.statSync(file);if(!s.isFile()||s.size>max)throw Error('Bounded ordinary input required');return fs.readFileSync(file);}
const GUARDS={
 'stage1/guest-candidate-cdp.cjs':'59840b638d8797fb55241616cd0b8e4098075a76834a201b0e93c1a748f1bb32',
 'stage1/sandbox-context.py':'09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249',
 'stage1/validate-sandbox-context.py':'867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207',
};
for(const [file,pin]of Object.entries(GUARDS))if(sha(read(file))!==pin)throw Error('Original actual Guest guard changed');
const actualContext=require('../stage1/guest-candidate-cdp.cjs').actualGuard();
const assert=require('node:assert/strict'),test=require('node:test'),vm=require('node:vm');
const {createRequire}=require('node:module'),{AsyncLocalStorage}=require('node:async_hooks'),{DatabaseSync}=require('node:sqlite');
const INPUTS=['project/desktop/backend.cjs','project/desktop/administration.cjs','project/desktop/renderer/presence-heartbeat.ts','project/desktop/renderer/admin-management.tsx','project/desktop/renderer/bridge.ts'];
const TEST_SHA=process.env.XJY_CLIENT_VERSION_TEST_SHA256,PINS=JSON.parse(process.env.XJY_CLIENT_VERSION_SOURCE_PINS||'null');
assert.match(TEST_SHA||'',/^[a-f0-9]{64}$/,'Root-pinned test SHA required');
assert.equal(sha(read('audit-tools/employee-client-version.test.cjs')),TEST_SHA);
assert(PINS&&typeof PINS==='object'&&!Array.isArray(PINS));assert.deepEqual(Object.keys(PINS).sort(),[...INPUTS].sort());
for(const file of INPUTS){assert.match(PINS[file]||'',/^[a-f0-9]{64}$/);assert.equal(sha(read(file)),PINS[file],'Root-pinned source changed: '+file);}
assert.equal(sha(read('project/desktop/migrations/0004_module_administration.sql')),'22b8aa86f01a5adf502c6677abce58408b9f6c5f9b183853b036ace632cf0789');
assert.equal(sha(read('project/desktop/migrations/0005_workspace_collaboration.sql')),'fa7d398171a2b85c3a86814e91b6e427695e75f56ae966263b3200da29d5ee4c');
const DEPS=path.join(ROOT,'audit-tools/dependencies/node_modules');
const publicCompiler=JSON.parse(read('audit-tools/dependencies/node_modules/esbuild/package.json'));
assert.equal(publicCompiler.name,'esbuild');assert.equal(publicCompiler.version,'0.28.0');
const esbuild=require(path.join(DEPS,'esbuild'));
const inside=(root,file)=>{const rel=path.relative(root,file);return rel===''||rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel);};
const rendererProof=[];
function renderer(relative){
 const entry=path.join(ROOT,relative),result=esbuild.buildSync({absWorkingDir:ROOT,entryPoints:[entry],bundle:true,write:false,metafile:true,platform:'node',format:'cjs',target:'node24',jsx:'automatic',loader:{'.css':'empty'},alias:{'@':path.join(ROOT,'project')},nodePaths:[DEPS],logLevel:'silent'});
 const sources=Object.keys(result.metafile.inputs).map(name=>path.resolve(name));
 for(const file of sources){assert(inside(path.join(ROOT,'project'),file)||inside(DEPS,file),'Compiler input escaped reviewed project/deps');const rel=path.relative(ROOT,file).replaceAll('\\','/');read(rel,8*1024*1024);}
 for(const file of INPUTS)assert.equal(sha(read(file)),PINS[file],'Source changed during in-memory compilation');
 const bytes=result.outputFiles[0].contents,record={exports:{}};
 vm.runInNewContext(Buffer.from(bytes).toString('utf8'),{module:record,exports:record.exports,require:createRequire(entry),__dirname:path.dirname(entry),process,Buffer,URL,URLSearchParams,TextEncoder,TextDecoder,setTimeout,clearTimeout,setInterval,clearInterval,console},{filename:entry+'[reviewed-Guest-contract]'});
 rendererProof.push({entry:relative,compiledSha256:sha(bytes),sources:sources.filter(file=>inside(path.join(ROOT,'project'),file)).map(file=>({file:path.relative(ROOT,file).replaceAll('\\','/'),sha256:sha(fs.readFileSync(file))}))});
 return record.exports;
}
const presence=renderer('project/desktop/renderer/presence-heartbeat.ts'),adminUi=renderer('project/desktop/renderer/admin-management.tsx');
const CODE=path.join(ROOT,'project/desktop/backend.cjs'),BACKEND={exports:{}},realRequire=createRequire(CODE);
// Same trap as central-backend.test.cjs: the original file-DB factory can never
// run, including when an absent-feature RED assertion fails later.
vm.runInNewContext(read('project/desktop/backend.cjs').toString('utf8'),{module:BACKEND,exports:BACKEND.exports,require:address=>address==='./runtime.cjs'?{createRuntime:()=>{throw Error('FILE_DATABASE_RUNTIME_MUST_NOT_RUN');}}:realRequire(address),__dirname:path.dirname(CODE),Buffer,Request,Response,URL,URLSearchParams,setImmediate,setTimeout,clearTimeout,console},{filename:CODE});
const {createBackend}=BACKEND.exports;
const STAFF={admin:'11000000-0000-4000-8000-000000000001',employee:'11000000-0000-4000-8000-000000000002',other:'11000000-0000-4000-8000-000000000003'};
const A='22000000-0000-4000-8000-000000000001',B='22000000-0000-4000-8000-000000000002';
const PASSWORD='Fictional-Version-2026!',SALT='fictional-client-version-salt',HASH=crypto.scryptSync(PASSWORD,SALT,64).toString('hex');
const REGISTRY=id=>'client-versions:v1:'+id;
const client=(deviceId=A,clientVersion='1.6.1',kind='desktop')=>({schemaVersion:1,deviceId,kind,clientVersion,versionSource:kind==='web'?'host-web':'local-app'});
const heartbeat=(session,extra={})=>session.dispatch({path:'/api/presence/heartbeat',method:'POST',body:{module:'home',active:false,...extra}});
const usage=session=>session.dispatch({path:'/api/admin/usage',method:'GET'});
async function fixture(t){
 const parent=path.join(ROOT,'runtime','employee-client-version-contracts');
 if(!fs.existsSync(parent))fs.mkdirSync(parent);for(let p=parent;;p=path.dirname(p)){assert(!fs.lstatSync(p).isSymbolicLink());if(p===ROOT)break;}
 const directory=fs.mkdtempSync(path.join(parent,'run-'));assert.equal(path.dirname(directory),parent);
 const db=new DatabaseSync(':memory:');
 for(const name of fs.readdirSync(path.join(ROOT,'project/desktop/migrations')).filter(name=>/^\d+_[\w-]+\.sql$/.test(name)).sort())db.exec(read('project/desktop/migrations/'+name).toString('utf8'));
 db.exec('CREATE TABLE local_accounts(staff_id TEXT PRIMARY KEY,username TEXT UNIQUE,password_salt TEXT,password_hash TEXT,created_at TEXT,updated_at TEXT);');
 for(const [name,id]of Object.entries(STAFF)){const at='2026-10-18T00:00:00.000Z';db.prepare('INSERT INTO staff_users VALUES(?,?,?,?,?,?,?,?)').run(id,'local-'+id,name,'虚构-'+name,name==='admin'?'admin':'employee',1,at,at);db.prepare('INSERT INTO local_accounts VALUES(?,?,?,?,?,?)').run(id,name,SALT,HASH,at,at);}
 const context=new AsyncLocalStorage();let closed=false;
 const runtime={sqlite:db,dataDir:directory,withIdentity:(identity,action)=>context.run(identity,action),getIdentity:()=>context.getStore()??null,close(){if(!closed){closed=true;db.close();}}};
 const backend=createBackend({dataDir:directory,migrationDir:path.join(ROOT,'project/desktop/migrations'),runtimeFactory:()=>runtime,businessCore:{api:async action=>Response.json(await action())},moduleAdapter:{proxy:async()=>{throw Error('NO_MODULE_OR_UPDATER_CALL');}},pollsAdapter:{},aiAdapter:{}});
 t.after(()=>backend.close());
 async function login(name){const session=backend.createSession({sourcePeer:'owned-version-contract'}),reply=await session.dispatch({path:'/auth/login',method:'POST',body:{username:name,password:PASSWORD}});assert.equal(reply.status,200);return session;}
 const sessions={};for(const name of Object.keys(STAFF))sessions[name]=await login(name);
 return{db,backend,sessions,login};
}
function hasFeature(reply){assert.equal(reply.status,200);assert.equal(reply.data.clientMetadataVersion,1,'EMPLOYEE_CLIENT_VERSION_REQUIRED: actual backend does not advertise optional client metadata');}
function permissions(db){return JSON.stringify(Object.fromEntries(['staff_users','module_permissions','staff_capabilities'].map(name=>[name,db.prepare('SELECT * FROM '+name+' ORDER BY 1').all()])));}
const employee=(reply,id=STAFF.employee)=>reply.data.employees.find(row=>row.staffId===id);
const plain=value=>JSON.parse(JSON.stringify(value));
console.log(JSON.stringify({purpose:'employee-client-version-contracts',actualContext,testSha256:TEST_SHA,sourcePins:PINS,methods:4,rendererProof,memorySqliteOnly:true,realBackendAuth:true,reactHooksRun:false,domVerified:false,updaterRun:false}));

test('V01 real backend records separate clients under the authenticated staff and only a current admin can read them',async t=>{
 const f=await fixture(t);hasFeature(await heartbeat(f.sessions.employee));
 const before=permissions(f.db),one=await f.login('employee'),two=await f.login('employee'),start=Date.now();
 const first=await heartbeat(one,{client:client(A,'1.6.1')}),second=await heartbeat(two,{client:client(B,'1.6.2','web')});
 assert.equal(first.status,200);assert.equal(first.data.clientMetadataAccepted,true);assert.equal(second.data.clientMetadataAccepted,true);
 const view=await usage(f.sessions.admin);assert.equal(view.status,200);const row=employee(view);assert(Array.isArray(row.clients));
 assert.deepEqual(plain(row.clients.map(item=>[item.deviceId,item.kind,item.clientVersion,item.versionSource]).sort()),[[A,'desktop','1.6.1','local-app'],[B,'web','1.6.2','host-web']]);
 for(const item of row.clients){assert(Date.parse(item.lastReportedAt)>=start&&Date.parse(item.lastReportedAt)<=Date.now());assert.deepEqual(Object.keys(item).sort(),['clientVersion','deviceId','kind','lastReportedAt','versionSource']);}
 assert.equal(row.unreportedSessions,1,'An old active session stays explicitly unknown despite another device reporting');
 assert.equal(employee(view,STAFF.other).clients.length,0);assert.equal((await usage(f.sessions.employee)).status,403);
 const again=await f.login('employee');assert.equal((await heartbeat(again,{client:client(A,'1.6.3')})).data.clientMetadataAccepted,true);
 const latest=employee(await usage(f.sessions.admin));assert.equal(latest.clients.length,2);assert.equal(latest.clients.find(item=>item.deviceId===A).clientVersion,'1.6.3');assert.equal(latest.clients.find(item=>item.deviceId===B).clientVersion,'1.6.2');
 const anonymous=f.backend.createSession({sourcePeer:'owned-version-contract-anonymous'});assert.equal((await usage(anonymous)).status,401);assert.equal((await heartbeat(anonymous,{client:client(A,'9.9.9')})).status,401);
 assert.equal(permissions(f.db),before,'Version metadata cannot change accounts or permissions');
 for(const record of f.db.prepare('SELECT id FROM usage_sessions').all())assert(!JSON.stringify(view.data).includes(record.id),'Do not expose authenticated usage-session IDs');
 f.db.prepare("UPDATE staff_users SET role='employee' WHERE id=?").run(STAFF.admin);assert.equal((await usage(f.sessions.admin)).status,403,'An old admin session must recheck its current role');
});

test('V02 legacy presence survives bounded protocol and corrupted metadata without overwriting unrelated or prior records',async t=>{
 const f=await fixture(t);hasFeature(await heartbeat(f.sessions.employee));
 const actor=(await f.sessions.employee.dispatch({path:'/auth/status'})).data.user,before=permissions(f.db);
 for(const bad of [{...client(),schemaVersion:2},{...client(),clientVersion:'x'.repeat(65)},{...client(),clientVersion:'<img src=x onerror=1>'},{...client(),deviceId:'../private'},{...client(),role:'admin'},{...client(),staffId:STAFF.other},{...client(),lastReportedAt:'2099-01-01T00:00:00Z'},{...client(),versionSource:'signed-and-authorized'}])assert.throws(()=>f.backend.administration.reportHeartbeat(crypto.randomUUID(),actor,{module:'home',active:false,client:bad}),error=>error.status===400);
 assert.throws(()=>f.backend.administration.reportHeartbeat(crypto.randomUUID(),actor,{module:'home',active:false,client:client(),role:'admin'}),error=>error.status===400);
 const key=REGISTRY(STAFF.employee),unrelated=f.db.prepare("SELECT value FROM administration_meta WHERE name='legacy-audits-imported'").get().value;
 for(const malformed of ['{bad PRIVATE_SENTINEL',' '.repeat(65537),JSON.stringify({schemaVersion:2,devices:[]})]){
  f.db.prepare('INSERT INTO administration_meta(name,value) VALUES(?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value').run(key,malformed);
  const reply=f.backend.administration.reportHeartbeat(crypto.randomUUID(),actor,{module:'home',active:false,client:client()});assert.equal(reply.accepted,true);assert.equal(reply.clientMetadataAccepted,false);assert.equal(f.db.prepare('SELECT value FROM administration_meta WHERE name=?').get(key).value,malformed);
  const result=await usage(f.sessions.admin);assert.equal(result.status,200);assert.deepEqual(plain(employee(result).clients),[]);assert(employee(result).clientMetadataWarning);assert(!JSON.stringify(result.data).includes('PRIVATE_SENTINEL'));
 }
 const devices=Array.from({length:32},(_,index)=>({deviceId:'33000000-0000-4000-8000-'+String(index).padStart(12,'0'),kind:'desktop',clientVersion:'1.6.1',versionSource:'local-app',lastReportedAt:'2026-10-18T00:00:00.000Z'})),full=JSON.stringify({schemaVersion:1,devices});
 f.db.prepare('UPDATE administration_meta SET value=? WHERE name=?').run(full,key);
 const atCapacity=await usage(f.sessions.admin);assert.equal(atCapacity.status,200);assert.equal(employee(atCapacity).clients.length,32);assert(!employee(atCapacity).clientMetadataWarning,'A valid registry at the stated capacity is readable');
 const capped=f.backend.administration.reportHeartbeat(crypto.randomUUID(),actor,{module:'home',active:false,client:client(A)});assert.equal(capped.accepted,true);assert.equal(capped.clientMetadataAccepted,false);assert.equal(f.db.prepare('SELECT value FROM administration_meta WHERE name=?').get(key).value,full);
 const legacy=f.backend.administration.reportHeartbeat(crypto.randomUUID(),actor,{module:'home',active:false});assert.equal(legacy.accepted,true);assert.equal(legacy.clientMetadataVersion,1);assert.equal(f.db.prepare('SELECT value FROM administration_meta WHERE name=?').get(key).value,full);
 assert.equal(f.db.prepare("SELECT value FROM administration_meta WHERE name='legacy-audits-imported'").get().value,unrelated);assert.equal(permissions(f.db),before);
});

function storage(value=A){const saved=new Map(value?[['xjy-client-device-id-v1',value]]:[]);return{getItem:key=>saved.get(key)??null,setItem:(key,item)=>saved.set(key,item)};}
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};}
test('V03 actual reporter negotiates old bodies and truthful app versions and rejects stale disposed or unstable-device metadata',async()=>{
 assert.equal(typeof presence.createPresenceClientReporter,'function','EMPLOYEE_CLIENT_VERSION_REQUIRED: actual reporter missing');
 const bodies=[],request=async body=>{bodies.push(plain(body));return{accepted:true,clientMetadataVersion:1};};
 const reporter=presence.createPresenceClientReporter({request,getAppInfo:async()=>({appVersion:'1.6.2'}),storage:storage(),surface:'desktop',createDeviceId:()=>B});
 await reporter.send({module:'home',active:false});assert.deepEqual(bodies,[{module:'home',active:false}]);
 await reporter.send({module:'home',active:true});assert.deepEqual(bodies[1],{module:'home',active:true,client:client(A,'1.6.2')});reporter.dispose();
 for(const variant of ['old-host','missing-version','storage-failed','web']){
  const calls=[],local=variant==='storage-failed'?{getItem(){throw Error('synthetic unavailable storage');},setItem(){throw Error('synthetic unavailable storage');}}:storage();
  const model=presence.createPresenceClientReporter({request:async body=>{calls.push(plain(body));return variant==='old-host'?{accepted:true}:{accepted:true,clientMetadataVersion:1};},getAppInfo:async()=>variant==='missing-version'?{}:{appVersion:'1.6.2'},storage:local,surface:variant==='web'?'web':'desktop',createDeviceId:()=>B});
  await model.send({module:'home',active:false});await model.send({module:'home',active:false});
  assert.deepEqual(calls[0],{module:'home',active:false});assert.deepEqual(calls[1],variant==='web'?{module:'home',active:false,client:client(A,'1.6.2','web')}:{module:'home',active:false});model.dispose();
 }
 const waiting=deferred(),calls=[],late=presence.createPresenceClientReporter({request:async body=>{calls.push(plain(body));return{clientMetadataVersion:1};},getAppInfo:()=>waiting.promise,storage:storage(),surface:'desktop',createDeviceId:()=>B});
 await late.send({module:'home',active:false});const pending=late.send({module:'home',active:false});late.dispose();waiting.resolve({appVersion:'9.9.9'});await pending;assert.deepEqual(calls,[{module:'home',active:false}]);
 const changed=[],downgraded=presence.createPresenceClientReporter({request:async body=>{changed.push(plain(body));if(body.client)throw Error('synthetic old-host schema rejection');return changed.length===1?{clientMetadataVersion:1}:{accepted:true};},getAppInfo:async()=>({appVersion:'1.6.2'}),storage:storage(),surface:'desktop',createDeviceId:()=>B});
 await downgraded.send({module:'home',active:false});await downgraded.send({module:'home',active:false}).catch(()=>{});await downgraded.send({module:'home',active:false});assert.equal(changed.length,3);assert.deepEqual(changed[2],{module:'home',active:false},'After a metadata error, the next presence must fall back to the legacy body');downgraded.dispose();
});

function nodes(value){if(value===null||value===undefined||typeof value==='boolean')return[];if(Array.isArray(value))return value.flatMap(nodes);if(typeof value!=='object')return[value];return[value,...nodes(value.props?.children)];}
function text(value){return nodes(value).filter(item=>typeof item==='string'||typeof item==='number').join(' ');}
test('V04 actual stateless administrator child labels unknown clients separately and never presents reports as installed success',()=>{
 assert.equal(typeof adminUi.EmployeeClientVersions,'function','EMPLOYEE_CLIENT_VERSION_REQUIRED: actual administrator child missing');
 const unknown=adminUi.EmployeeClientVersions({clients:undefined,unreportedSessions:1});assert.match(text(unknown),/未上报|设备未知/);assert.doesNotMatch(text(unknown),/最新|已安装|全部已更新/);
 const clients=[{deviceId:A,kind:'desktop',clientVersion:'1.6.1',versionSource:'local-app',lastReportedAt:'2026-10-18T00:00:00.000Z'},{deviceId:B,kind:'web',clientVersion:'1.6.2',versionSource:'host-web',lastReportedAt:'2026-10-18T00:01:00.000Z'}];
 const before=JSON.stringify(clients),view=adminUi.EmployeeClientVersions({clients:Object.freeze(clients.map(item=>Object.freeze({...item}))),unreportedSessions:1});
 assert.match(text(view),/1\.6\.1/);assert.match(text(view),/1\.6\.2/);assert.match(text(view),/桌面/);assert.match(text(view),/网页|手机/);assert.match(text(view),/最近上报/);assert.match(text(view),/未上报|设备未知/);assert.match(text(view),/2026/);assert.doesNotMatch(text(view),/安装成功|升级完成|全部已更新|当前最新/);assert.equal(JSON.stringify(clients),before);
 for(const node of nodes(view).filter(item=>item&&typeof item==='object')){assert(!node.props?.dangerouslySetInnerHTML);assert.notEqual(node.type,'button','The child only displays metadata; it cannot trigger an updater or permissions action');}
 const known=adminUi.EmployeeClientVersions({clients,unreportedSessions:0});assert.doesNotMatch(text(known),/未上报|设备未知/,'Only actual missing reports should display unknown');
 const broken=adminUi.EmployeeClientVersions({clients:[],unreportedSessions:1,clientMetadataWarning:'CLIENT_METADATA_UNAVAILABLE'});assert.match(text(broken),/待核对|暂不可用|未上报/);assert.doesNotMatch(text(broken),/最新|已安装/);
});

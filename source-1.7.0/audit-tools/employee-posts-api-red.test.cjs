'use strict';
// Target 1.7.0. Root-only actual offline Guest. No file-backed DB or media,
// no service/listener/EXE. This exercises the existing real profile router.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'..'),sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
if(process.platform!=='win32'||ROOT.toLowerCase()!=='c:\\xjy-work\\xjy-web-stage1')throw Error('Fixed actual Guest required');
function read(relative,max=4*1024*1024){const file=path.join(ROOT,...relative.split('/')),rel=path.relative(ROOT,file);if(rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))throw Error('Source escaped Root');for(let current=file;;current=path.dirname(current)){const stat=fs.lstatSync(current);if(stat.isSymbolicLink()||stat.isFile()&&stat.nlink!==1)throw Error('Links refused');if(current===path.dirname(current))break;}const stat=fs.statSync(file);if(!stat.isFile()||stat.size>max)throw Error('Bounded ordinary source required');return fs.readFileSync(file);}
for(const [file,pin]of Object.entries({'stage1/guest-candidate-cdp.cjs':'59840b638d8797fb55241616cd0b8e4098075a76834a201b0e93c1a748f1bb32','stage1/sandbox-context.py':'09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249','stage1/validate-sandbox-context.py':'867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207'}))if(sha(read(file))!==pin)throw Error('Original admission changed');
const actualContext=require('../stage1/guest-candidate-cdp.cjs').actualGuard();
const test=require('node:test'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite');
const REQUIRED=['project/desktop/employee-profile.cjs','project/desktop/workspace-collaboration.cjs','project/desktop/administration.cjs','project/desktop/erp-policy.cjs','project/desktop/migrations/0004_module_administration.sql','project/desktop/migrations/0005_workspace_collaboration.sql','project/desktop/migrations/0007_collaboration_review_versions.sql','project/desktop/migrations/0009_employee_profiles.sql'];
const OPTIONAL=['project/desktop/employee-posts.cjs','project/desktop/employee-post-media.cjs','project/desktop/migrations/0011_employee_posts.sql'];
const pin=process.env.XJY_EMPLOYEE_POSTS_TEST_SHA256,pins=JSON.parse(process.env.XJY_EMPLOYEE_POSTS_SOURCE_PINS||'null');
assert.match(pin||'',/^[a-f0-9]{64}$/);assert.equal(sha(read('audit-tools/employee-posts-api-red.test.cjs')),pin);assert(pins&&typeof pins==='object'&&!Array.isArray(pins));for(const name of REQUIRED)assert(Object.hasOwn(pins,name),'Required source pin '+name);for(const [name,expected]of Object.entries(pins)){assert([...REQUIRED,...OPTIONAL].includes(name),'Unreviewed post input '+name);assert.match(expected,/^[a-f0-9]{64}$/);assert.equal(sha(read(name)),expected);}
console.log(JSON.stringify({purpose:'employee-posts-real-profile-router-red',targetVersion:'1.7.0',actualContext,testSha256:pin,sourcePins:pins,methods:9,fileBackedDb:false,mediaInMemoryOnly:true,actualUiVerified:false}));
const {createAdministration}=require('../project/desktop/administration.cjs'),{createEmployeeProfile}=require('../project/desktop/employee-profile.cjs');
const ids={a:'10000000-0000-4000-8000-00000000000a',b:'10000000-0000-4000-8000-00000000000b',admin:'10000000-0000-4000-8000-00000000000c',inactive:'10000000-0000-4000-8000-00000000000d'};
const client=n=>'30000000-0000-4000-8000-'+String(n).padStart(12,'0');
function fixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec('PRAGMA foreign_keys=ON; CREATE TABLE staff_users(id TEXT PRIMARY KEY,name TEXT NOT NULL,role TEXT NOT NULL,active INTEGER NOT NULL); CREATE TABLE local_accounts(staff_id TEXT PRIMARY KEY,username TEXT); CREATE TABLE audit_logs(id TEXT,entity_type TEXT,entity_id TEXT,action TEXT,actor_id TEXT,actor_name TEXT,created_at TEXT);');
 for(const name of Object.keys(pins).filter(name=>name.endsWith('.sql')).sort())db.exec(read(name).toString('utf8'));
 for(const [key,id]of Object.entries(ids))db.prepare('INSERT INTO staff_users VALUES(?,?,?,?)').run(id,'虚构'+key,key==='admin'?'admin':'employee',key==='inactive'?0:1);
 db.prepare("INSERT INTO module_permissions VALUES(?,'disabled','disabled','disabled',1,?)").run(ids.a,'2026-10-19');db.prepare('INSERT INTO staff_capabilities VALUES(?,?,?)').run(ids.a,JSON.stringify({'personal.sales.view':false,'personal.sales.profit':false,'messages.post':false,'messages.moderate':false}),'2026-10-19');
 const bucket=()=>{const objects=new Map();return{objects,async put(key,bytes,metadata){objects.set(key,{body:Buffer.from(bytes),...metadata});},async get(key){return objects.get(key)||null;},async delete(key){objects.delete(key);}};};
 const avatars=bucket(),media=bucket(),runtime={sqlite:db,env:{BUCKET:avatars,PROFILE_MEDIA_BUCKET:media}};let time=Date.parse('2026-10-19T01:00:00Z');const clock=()=>time;
 const administration=createAdministration({runtime,clock}),service=createEmployeeProfile({runtime,administration,clock}),user=key=>({id:ids[key],name:'虚构'+key,role:key==='admin'?'admin':'employee'});
 const call=async(actor,url,method='GET',body)=>{try{return await service.handle(actor,{path:'/api/employee-profiles'+url,method,body});}catch(error){return{ok:false,status:error.status||500,data:{error:error.message}};}};
 const create=async(key='a',text='虚构个人故事',n=1)=>{time+=1000;const response=await call(user(key),'/'+ids[key]+'/posts','POST',{text,mediaIds:[],clientRequestId:client(n)});assert.equal(response.status,200,'A real accepted post must be created, not an unsupported-route 404');assert(response.data.post?.id);return response.data.post;};
 return{db,call,user,create,media,avatars,tick:milliseconds=>{time+=milliseconds;}};
}

test('D01 active employees can browse public profile posts with sales, personal sales and messages permissions all revoked',async t=>{const f=fixture(t),reply=await f.call(f.user('a'),'/'+ids.b+'/posts?limit=20');assert.equal(reply.status,200);assert.deepEqual(reply.data.posts,[]);assert.equal(reply.data.nextCursor,null);});
test('D02 owner publishes plain text; other active employees see only public post fields',async t=>{
 const f=fixture(t),body='一次服务的故事\n<img src=x onerror=alert(1)>',post=await f.create('a',body);assert.equal(post.staffId,ids.a);assert.equal(post.text,body);assert.equal(post.revision,1);assert.deepEqual(post.media,[]);assert.equal(post.canDelete,true);
 const reply=await f.call(f.user('b'),'/'+ids.a+'/posts?limit=20');assert.equal(reply.status,200);assert.equal(reply.data.posts.length,1);const item=reply.data.posts[0];assert.equal(item.id,post.id);assert.equal(item.canDelete,false);assert.deepEqual(Object.keys(item).sort(),['id','staffId','authorName','text','media','revision','createdAt','canDelete'].sort());assert.equal(/customer|orderNo|profit|snapshot|sourceId|storageKey|uploadId|token/i.test(JSON.stringify(reply.data)),false,'Public posts cannot carry financial or storage fields');
});
test('D03 neither another employee nor a real administrator can impersonate the profile owner when publishing',async t=>{
 const f=fixture(t);for(const actor of [f.user('b'),{...f.user('b'),role:'admin'},f.user('admin')]){const reply=await f.call(actor,'/'+ids.a+'/posts','POST',{text:'不得冒名发布',mediaIds:[],clientRequestId:client(2)});assert.equal(reply.status,403);}
 assert.equal((await f.call(f.user('b'),'/'+ids.a+'/posts')).data.posts.length,0);
});
test('D04 duplicate publish requests return the same post while changed payload under the same request id is rejected',async t=>{
 const f=fixture(t),post=await f.create('a','只发布一次',4),again=await f.call(f.user('a'),'/'+ids.a+'/posts','POST',{text:'只发布一次',mediaIds:[],clientRequestId:client(4)});assert.equal(again.status,200);assert.equal(again.data.post.id,post.id);assert.equal(again.data.duplicate,true);assert.equal((await f.call(f.user('a'),'/'+ids.a+'/posts','POST',{text:'相同标识但不同正文',mediaIds:[],clientRequestId:client(4)})).status,409);assert.equal((await f.call(f.user('b'),'/'+ids.a+'/posts')).data.posts.length,1);
});
test('D05 empty, oversized, control characters, invented owner and raw HTML fields are rejected before publishing',async t=>{
 const f=fixture(t);for(const body of [{text:' ',mediaIds:[],clientRequestId:client(5)},{text:'a'.repeat(3001),mediaIds:[],clientRequestId:client(5)},{text:'x\u0000y',mediaIds:[],clientRequestId:client(5)},{text:'虚构',mediaIds:[],staffId:ids.b,clientRequestId:client(5)},{html:'<b>raw</b>',mediaIds:[],clientRequestId:client(5)},{text:'虚构',mediaIds:[],clientRequestId:'../../outside'}])assert.equal((await f.call(f.user('a'),'/'+ids.a+'/posts','POST',body)).status,400);
});
test('D06 only owner or live administrator can delete; stale admin role and unrelated employee do not manage posts',async t=>{
 const f=fixture(t),post=await f.create();assert.equal((await f.call(f.user('b'),'/posts/'+post.id+'/delete','POST',{revision:1})).status,404);assert.equal((await f.call({...f.user('b'),role:'admin'},'/posts/'+post.id+'/delete','POST',{revision:1})).status,404);
 const removed=await f.call(f.user('admin'),'/posts/'+post.id+'/delete','POST',{revision:1,reason:'虚构管理员管理原因'});assert.equal(removed.status,200);assert.equal(removed.data.deleted,true);assert.deepEqual((await f.call(f.user('a'),'/'+ids.a+'/posts')).data.posts,[]);
 const log=f.db.prepare("SELECT * FROM operation_logs WHERE action='employee-post.delete' AND resource=?").get(post.id);assert(log);assert.equal(log.actor_id,ids.admin);assert.equal(log.success,1);assert.equal(log.summary.includes('虚构个人故事'),false,'Audit records operation metadata, not post body');
});
test('D07 deleting with a stale revision is rejected and leaves the published post visible',async t=>{
 const f=fixture(t),post=await f.create();assert.equal((await f.call(f.user('a'),'/posts/'+post.id+'/delete','POST',{revision:0})).status,409);assert.equal((await f.call(f.user('b'),'/'+ids.a+'/posts')).data.posts.length,1);assert.equal((await f.call(f.user('a'),'/posts/'+post.id+'/delete','POST',{revision:1})).status,200);
});
test('D08 stable cursor pagination never repeats or omits posts and rejects malformed cursors',async t=>{
 const f=fixture(t);for(let i=1;i<=3;i++)await f.create('a','虚构动态'+i,10+i);const first=await f.call(f.user('b'),'/'+ids.a+'/posts?limit=2');assert.equal(first.status,200);assert.equal(first.data.posts.length,2);assert.equal(typeof first.data.nextCursor,'string');const second=await f.call(f.user('b'),'/'+ids.a+'/posts?limit=2&before='+encodeURIComponent(first.data.nextCursor));assert.equal(second.status,200);assert.equal(second.data.posts.length,1);assert.equal(second.data.nextCursor,null);assert.equal(new Set([...first.data.posts,...second.data.posts].map(post=>post.id)).size,3);for(const query of ['limit=0','limit=21','limit=2&before=../../private','limit=2&unknown=1'])assert.equal((await f.call(f.user('b'),'/'+ids.a+'/posts?'+query)).status,400);
});
test('D09 anonymous or disabled actors cannot read; employees lose a disabled colleague while live admin retains management',async t=>{
 const f=fixture(t),post=await f.create();assert.equal((await f.call(null,'/'+ids.a+'/posts')).status,401);assert.equal((await f.call(f.user('inactive'),'/'+ids.a+'/posts')).status,401);f.db.prepare('UPDATE staff_users SET active=0 WHERE id=?').run(ids.a);assert.equal((await f.call(f.user('b'),'/'+ids.a+'/posts')).status,404);assert.equal((await f.call(f.user('admin'),'/'+ids.a+'/posts')).status,200);assert.equal((await f.call(f.user('admin'),'/posts/'+post.id+'/delete','POST',{revision:1})).status,200);
});

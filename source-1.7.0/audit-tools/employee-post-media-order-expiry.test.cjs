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
const pin=process.env.XJY_EMPLOYEE_POST_MEDIA_EXTENSION_TEST_SHA256,pins=JSON.parse(process.env.XJY_EMPLOYEE_POST_MEDIA_EXTENSION_SOURCE_PINS||'null');
assert.match(pin||'',/^[a-f0-9]{64}$/);assert.equal(sha(read('audit-tools/employee-post-media-order-expiry.test.cjs')),pin);assert(pins&&typeof pins==='object'&&!Array.isArray(pins));for(const name of REQUIRED)assert(Object.hasOwn(pins,name),'Required source pin '+name);for(const [name,expected]of Object.entries(pins)){assert([...REQUIRED,...OPTIONAL].includes(name),'Unreviewed post input '+name);assert.match(expected,/^[a-f0-9]{64}$/);assert.equal(sha(read(name)),expected);}
console.log(JSON.stringify({purpose:'employee-post-media-order-expiry-extension',targetVersion:'1.7.0',actualContext,testSha256:pin,sourcePins:pins,methods:2,fileBackedDb:false,mediaInMemoryOnly:true,actualUiVerified:false}));
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

const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex'),status=(response,expected)=>assert.equal(response.status,expected,JSON.stringify(response.data));
function crc(bytes){let value=0xffffffff;for(const byte of bytes){value^=byte;for(let i=0;i<8;i++)value=(value>>>1)^((value&1)?0xedb88320:0);}return(value^0xffffffff)>>>0;}
function png(width=1,height=1){const chunk=(name,data)=>{const type=Buffer.from(name),out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);type.copy(out,4);data.copy(out,8);out.writeUInt32BE(crc(Buffer.concat([type,data])),out.length-4);return out;},header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;const pixels=crypto.randomBytes((width*4+1)*height);for(let row=0;row<height;row++)pixels[row*(width*4+1)]=0;return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',require('node:zlib').deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);}
async function start(f,bytes,key='a',mime='image/png'){const reply=await f.call(f.user(key),'/post-uploads','POST',{mime,byteLength:bytes.length,sha256:hash(bytes)});status(reply,200);assert.match(reply.data.uploadId,/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);assert.equal(reply.data.chunkBytes,1048576);assert(Number.isFinite(Date.parse(reply.data.expiresAt)));return reply.data.uploadId;}
const chunk=(f,id,bytes,offset=0,key='a')=>f.call(f.user(key),'/post-uploads/'+id+'/chunk','POST',{offset,bodyBase64:bytes.toString('base64'),sha256:hash(bytes)});
async function ready(f,bytes=png(),key='a'){const uploadId=await start(f,bytes,key);for(let offset=0;offset<bytes.length;offset+=1048576)status(await chunk(f,uploadId,bytes.subarray(offset,offset+1048576),offset,key),200);const reply=await f.call(f.user(key),'/post-uploads/'+uploadId+'/complete','POST',{});status(reply,200);assert(reply.data.media?.id);return{media:reply.data.media,uploadId,bytes};}
async function attach(f,mediaIds,key='a',n=50){const reply=await f.call(f.user(key),'/'+ids[key]+'/posts','POST',{text:'虚构产品学习动态',mediaIds,clientRequestId:client(n)});status(reply,200);assert(reply.data.post?.id);return reply.data.post;}
const content=(f,id,key='b',offset=0,length=1048576)=>f.call(f.user(key),'/post-media/'+id+'?offset='+offset+'&length='+length);

test('E01 a post preserves the owner-selected image order even when upload completion order differs',async t=>{
 const f=fixture(t),first=await ready(f),second=await ready(f),selected=[second.media.id,first.media.id],post=await attach(f,selected);
 assert.deepEqual(post.media.map(item=>item.id),selected,'Returned post must preserve mediaIds order');const listed=await f.call(f.user('b'),'/'+ids.a+'/posts');status(listed,200);assert.deepEqual(listed.data.posts[0].media.map(item=>item.id),selected,'Public timeline must use the same saved selection order');
});
test('E02 a completed but unpublished media asset cannot be attached after its original upload expiry',async t=>{
 const f=fixture(t),asset=await ready(f);f.tick(24*3600000+1);const response=await f.call(f.user('a'),'/'+ids.a+'/posts','POST',{text:'过期草稿媒体不能直接发布',mediaIds:[asset.media.id],clientRequestId:client(99)});status(response,409);const listed=await f.call(f.user('b'),'/'+ids.a+'/posts');status(listed,200);assert.deepEqual(listed.data.posts,[]);
});


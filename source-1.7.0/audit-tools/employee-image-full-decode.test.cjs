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
const pin=process.env.XJY_EMPLOYEE_IMAGE_DECODE_TEST_SHA256,pins=JSON.parse(process.env.XJY_EMPLOYEE_IMAGE_DECODE_SOURCE_PINS||'null');
assert.match(pin||'',/^[a-f0-9]{64}$/);assert.equal(sha(read('audit-tools/employee-image-full-decode.test.cjs')),pin);assert(pins&&typeof pins==='object'&&!Array.isArray(pins));for(const name of REQUIRED)assert(Object.hasOwn(pins,name),'Required source pin '+name);for(const [name,expected]of Object.entries(pins)){assert([...REQUIRED,...OPTIONAL].includes(name),'Unreviewed post input '+name);assert.match(expected,/^[a-f0-9]{64}$/);assert.equal(sha(read(name)),expected);}
console.log(JSON.stringify({purpose:'employee-image-full-decode-contract',targetVersion:'1.7.0',actualContext,testSha256:pin,sourcePins:pins,methods:5,fileBackedDb:false,mediaInMemoryOnly:true,actualUiVerified:false}));
const {createAdministration}=require('../project/desktop/administration.cjs'),{createEmployeeProfile}=require('../project/desktop/employee-profile.cjs');
const ids={a:'10000000-0000-4000-8000-00000000000a',b:'10000000-0000-4000-8000-00000000000b',admin:'10000000-0000-4000-8000-00000000000c',inactive:'10000000-0000-4000-8000-00000000000d'};
const client=n=>'30000000-0000-4000-8000-'+String(n).padStart(12,'0');
function fixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec('PRAGMA foreign_keys=ON; CREATE TABLE staff_users(id TEXT PRIMARY KEY,name TEXT NOT NULL,role TEXT NOT NULL,active INTEGER NOT NULL); CREATE TABLE local_accounts(staff_id TEXT PRIMARY KEY,username TEXT); CREATE TABLE audit_logs(id TEXT,entity_type TEXT,entity_id TEXT,action TEXT,actor_id TEXT,actor_name TEXT,created_at TEXT);');
 for(const name of Object.keys(pins).filter(name=>name.endsWith('.sql')).sort())db.exec(read(name).toString('utf8'));
 for(const [key,id]of Object.entries(ids))db.prepare('INSERT INTO staff_users VALUES(?,?,?,?)').run(id,'虚构'+key,key==='admin'?'admin':'employee',key==='inactive'?0:1);
 db.prepare("INSERT INTO module_permissions VALUES(?,'disabled','disabled','disabled',1,?)").run(ids.a,'2026-10-19');db.prepare('INSERT INTO staff_capabilities VALUES(?,?,?)').run(ids.a,JSON.stringify({'personal.sales.view':false,'personal.sales.profit':false,'messages.post':false,'messages.moderate':false}),'2026-10-19');
 const bucket=()=>{const objects=new Map();return{objects,async put(key,bytes,metadata){objects.set(key,{body:Buffer.from(bytes),...metadata});},async get(key){return objects.get(key)||null;},async delete(key){objects.delete(key);}};};
 const avatars=bucket(),media=bucket(),runtime={sqlite:db,env:{BUCKET:avatars,PROFILE_MEDIA_BUCKET:media},imageDecoder:{decode:decodeForFixture}};let time=Date.parse('2026-10-19T01:00:00Z');const clock=()=>time;
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

// Root transports exactly these existing public packages to the fixed Guest
// material directory. Missing/changed dependencies are a precondition failure.
for(const name of ['NODE_OPTIONS','NODE_PATH','NAPI_RS_NATIVE_LIBRARY_PATH','NAPI_RS_FORCE_WASI'])assert(!process.env[name],'Unexpected decoder execution override: '+name);
assert.equal(process.arch,'x64');assert.notEqual(process.config?.variables?.shlib_suffix,'dll.a');assert.notEqual(process.config?.variables?.node_target_type,'shared_library');
const materialFile='audit-tools/employee-image-full-decode-dependencies.json',materialPin=process.env.XJY_EMPLOYEE_IMAGE_DECODE_DEPENDENCY_MANIFEST_SHA256;
assert.match(materialPin||'',/^[a-f0-9]{64}$/);const materialBytes=read(materialFile);assert.equal(sha(materialBytes),materialPin);const materials=JSON.parse(materialBytes);
assert.equal(materials.version,1);assert.equal(materials.purpose,'employee-image-existing-offline-canvas');assert.equal(materials.packageVersion,'0.1.100');assert.equal(materials.guestRelativeRoot,'runtime/employee-image-decode-a1/print-dependencies/node_modules');assert.equal(materials.files.length,15);
const materialRoot=path.join(ROOT,...materials.guestRelativeRoot.split('/')),actualFiles=[];
function materialTree(directory,prefix=''){const stat=fs.lstatSync(directory);assert(stat.isDirectory()&&!stat.isSymbolicLink());for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const file=path.join(directory,entry.name),relative=prefix+entry.name;if(entry.isDirectory())materialTree(file,relative+'/');else{assert(entry.isFile(),'Only regular public dependency files');actualFiles.push(relative);}}}
materialTree(materialRoot);assert.deepEqual(actualFiles.sort(),materials.files.map(item=>item.path).sort());
for(const item of materials.files){assert(/^@napi-rs\/(?:canvas|canvas-win32-x64-msvc)\/[A-Za-z0-9._-]+$/.test(item.path));const value=read(materials.guestRelativeRoot+'/'+item.path,32*1024*1024);assert.equal(value.length,item.size);assert.equal(sha(value),item.sha256);}
assert([undefined,'1'].includes(process.env.DISABLE_SYSTEM_FONTS_LOAD));process.env.DISABLE_SYSTEM_FONTS_LOAD='1';
const canvas=require(path.join(materialRoot,'@napi-rs','canvas'));
const MALFORMED=Buffer.from('5249464612000000574542505650384c060000002f0000000000','hex');
const PIXELS=Uint8Array.from([255,0,0,255,0,255,0,255,0,0,255,255,255,255,255,255]);
function knownSurface(){const surface=canvas.createCanvas(2,2),context=surface.getContext('2d'),image=context.createImageData(2,2);image.data.set(PIXELS);context.putImageData(image,0,0);return surface;}
function containsLossless(bytes){assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.toString('ascii',8,12),'WEBP');assert.equal(bytes.readUInt32LE(4),bytes.length-8);let offset=12,found=false;while(offset+8<=bytes.length){const length=bytes.readUInt32LE(offset+4),end=offset+8+length;assert(end<=bytes.length);if(bytes.toString('ascii',offset,offset+4)==='VP8L')found=true;offset=end+length%2;}assert.equal(offset,bytes.length);return found;}
async function decodedPixels(buffer){assert(Buffer.isBuffer(buffer),'Decoder oracle accepts Buffer only');const image=await canvas.loadImage(Buffer.from(buffer));assert.equal(image.complete,true);assert.equal(image.width,2);assert.equal(image.height,2);const target=canvas.createCanvas(2,2),context=target.getContext('2d');context.drawImage(image,0,0);return Buffer.from(context.getImageData(0,0,2,2).data);}
// Proposed runtime port for a later reviewed implementation. The current a1
// product ignores it; no product file is changed by this contract.
async function decodeForFixture(buffer,limits){assert(Buffer.isBuffer(buffer));assert(limits&&['image/png','image/jpeg','image/webp'].includes(limits.mime));assert([2097152,4194304].includes(limits.maxBytes));assert.equal(limits.maxEdge,2048);assert.equal(limits.maxPixels,4194304);assert(buffer.length>0&&buffer.length<=limits.maxBytes);const pixels=await decodedPixels(buffer);return{width:2,height:2,sourceSha256:hash(buffer),rgbaSha256:hash(pixels)};}
const dataUri=bytes=>'data:image/webp;base64,'+bytes.toString('base64');

test('I00 fixed offline decoder rejects the 26-byte VP8L and truly round-trips PNG JPEG and lossless WebP Buffers',async()=>{
 assert.equal(MALFORMED.length,26);await assert.rejects(canvas.loadImage(Buffer.from(MALFORMED)));
 const surface=knownSurface(),pngBytes=surface.encodeSync('png'),jpegBytes=surface.encodeSync('jpeg',90),webpBytes=surface.encodeSync('webp',100);assert(containsLossless(webpBytes),'Quality100 fixture must contain genuine VP8L');assert.deepEqual(await decodedPixels(pngBytes),Buffer.from(PIXELS));assert.equal((await decodedPixels(jpegBytes)).length,16);assert.deepEqual(await decodedPixels(webpBytes),Buffer.from(PIXELS));
 console.log(JSON.stringify({oracle:'existing-0.1.100-real-buffer-decode',materialSha256:materialPin,malformedSha256:hash(MALFORMED),legalLosslessWebpSha256:hash(webpBytes),legalLosslessWebpBytes:webpBytes.length,pixelSha256:hash(Buffer.from(PIXELS)),urlLoaded:false,systemFontsLoaded:false}));
});
test('I01 malformed VP8L upload completion returns 400 without a ready media row or successful completion audit',async t=>{
 const f=fixture(t),id=await start(f,MALFORMED,'a','image/webp');status(await chunk(f,id,MALFORMED),200);const completed=await f.call(f.user('a'),'/post-uploads/'+id+'/complete','POST',{});status(completed,400);assert.equal(completed.data.media,undefined);assert.equal(f.db.prepare('SELECT count(*) n FROM staff_post_media WHERE upload_id=?').get(id).n,0);assert.equal(f.db.prepare("SELECT count(*) n FROM operation_logs WHERE action='employee-post.upload.complete'").get().n,0);status(await f.call(f.user('a'),'/post-uploads/'+id+'/cancel','POST',{}),200);
});
test('I02 a genuine decoded lossless WebP remains supported through upload, publish and authenticated retrieval',async t=>{
 const f=fixture(t),value=knownSurface().encodeSync('webp',100);assert(containsLossless(value));assert.deepEqual(await decodedPixels(value),Buffer.from(PIXELS));const id=await start(f,value,'a','image/webp');status(await chunk(f,id,value),200);const completed=await f.call(f.user('a'),'/post-uploads/'+id+'/complete','POST',{});status(completed,200);assert.equal(completed.data.media.mime,'image/webp');assert.equal(completed.data.media.width,2);assert.equal(completed.data.media.height,2);await attach(f,[completed.data.media.id]);const downloaded=await content(f,completed.data.media.id);status(downloaded,200);assert.equal(downloaded.data.bodyBase64,value.toString('base64'));assert.deepEqual(await decodedPixels(Buffer.from(downloaded.data.bodyBase64,'base64')),Buffer.from(PIXELS));
});
test('I03 malformed VP8L cannot be saved as an avatar and leaves profile revision and successful avatar audit untouched',async t=>{
 const f=fixture(t),result=await f.call(f.user('a'),'/'+ids.a+'/avatar','POST',{revision:0,image:dataUri(MALFORMED)});status(result,400);assert.equal(f.db.prepare('SELECT count(*) n FROM staff_profile_avatars WHERE staff_id=?').get(ids.a).n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM staff_profiles WHERE staff_id=?').get(ids.a).n,0);assert.equal(f.db.prepare("SELECT count(*) n FROM operation_logs WHERE action='employee-profile.avatar'").get().n,0);
});
test('I04 genuine lossless WebP remains supported as the current authenticated avatar',async t=>{
 const f=fixture(t),value=knownSurface().encodeSync('webp',100);assert(containsLossless(value));const saved=await f.call(f.user('a'),'/'+ids.a+'/avatar','POST',{revision:0,image:dataUri(value)});status(saved,200);assert.equal(saved.data.profile.revision,1);const loaded=await f.call(f.user('b'),'/avatars/'+saved.data.profile.avatar.id);status(loaded,200);assert.equal(loaded.data.image,dataUri(value));assert.deepEqual(await decodedPixels(Buffer.from(loaded.data.image.split(',')[1],'base64')),Buffer.from(PIXELS));
});


'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const load=()=>{assert.ok(fs.existsSync(path.resolve(__dirname,'../project/desktop/renderer/employee-profile.tsx')),'Employee profile UI feature is missing');return require('./renderer-test-loader.cjs').loadRenderer('employee-profile');};
function renderedText(node){if(node===null||node===undefined||typeof node==='boolean')return '';if(typeof node==='string'||typeof node==='number')return String(node);if(Array.isArray(node))return node.map(renderedText).join(' ');return renderedText(node.props?.children);}
test('profile editor accepts optional age and biography but cannot submit achievement or avatar path fields',()=>{
  const {profileUpdateInput}=load();assert.deepEqual(profileUpdateInput(4,'28','珠宝顾问'),{revision:4,age:28,bio:'珠宝顾问'});assert.deepEqual(profileUpdateInput(0,'',''),{revision:0,age:null,bio:''});
  for(const age of ['0','121','28.5','abc'])assert.throws(()=>profileUpdateInput(0,age,'简介'));assert.throws(()=>profileUpdateInput(0,'28','x'.repeat(601)));
});
test('avatar file reader rejects unsupported MIME and size before reading any user file',async()=>{
  const {readEmployeeAvatar}=load();await assert.rejects(readEmployeeAvatar({type:'image/svg+xml',size:4}),/PNG|JPEG|WebP/);await assert.rejects(readEmployeeAvatar({type:'image/png',size:12582913}),/12MB/);await assert.rejects(readEmployeeAvatar({type:'image/heic',name:'IMG_0001.HEIC',size:4}),/HEIC|HEIF/);
});

// These controlled browser adapters exercise client flow only. They do not prove real Canvas or Safari/iPhone behavior.
function pngHeader(width,height){const bytes=Buffer.alloc(33);Buffer.from('89504e470d0a1a0a','hex').copy(bytes);bytes.writeUInt32BE(13,8);bytes.write('IHDR',12);bytes.writeUInt32BE(width,16);bytes.writeUInt32BE(height,20);return bytes;}
function jpegHeader(width,height){const bytes=Buffer.from([255,216,255,192,0,11,8,0,0,0,0,1,1,17,0]);bytes.writeUInt16BE(height,7);bytes.writeUInt16BE(width,9);return bytes;}
function webpHeader(width,height){const bytes=Buffer.alloc(30);bytes.write('RIFF',0);bytes.writeUInt32LE(22,4);bytes.write('WEBPVP8X',8);bytes.writeUInt32LE(10,16);bytes.writeUIntLE(width-1,24,3);bytes.writeUIntLE(height-1,27,3);return bytes;}
function avatarFixture(options={}){
  const calls=[],state={disposed:0};const file={type:options.type||'image/png',name:'fictional-photo.png',size:options.size||5*1024*1024};const header=options.header||({'image/png':pngHeader,'image/jpeg':jpegHeader,'image/webp':webpHeader})[file.type](options.width||4000,options.height||3000);
  const browser={
    async readHeader(target,limit){assert.equal(target,file);assert.equal(limit,65536);calls.push('header');if(options.readError)throw Error('fictional header read error');return header;},
    async decode(target){assert.equal(target,file);calls.push('decode');if(options.decodeError)throw Error('fictional image decode unsupported');return {image:{synthetic:true},width:options.decodedWidth||options.width||4000,height:options.decodedHeight||options.height||3000,dispose(){state.disposed++;}};},
    async encode(image,width,height,mime){assert.equal(image.synthetic,true);calls.push({width,height,mime});if(options.encodeError)throw Error('fictional encode error');return {mime,bytes:options.outputBytes||new Uint8Array([1,2,3])};}
  };return {file,browser,calls,state};
}
test('large phone photos are normalized locally to a proportional 512-pixel avatar within the server byte limit',async()=>{
  const {readEmployeeAvatar}=load(),f=avatarFixture();const result=await readEmployeeAvatar(f.file,f.browser);assert.equal(result,'data:image/png;base64,AQID');assert.deepEqual(f.calls,['header','decode',{width:512,height:384,mime:'image/png'}]);assert.equal(f.state.disposed,1);assert.equal(Buffer.from(result.split(',')[1],'base64').length<=2097152,true);
});
test('small PNG avatars are re-encoded to strip original metadata without enlarging their natural dimensions',async()=>{
  const {readEmployeeAvatar}=load(),f=avatarFixture({width:100,height:80,size:500});assert.equal(await readEmployeeAvatar(f.file,f.browser),'data:image/png;base64,AQID');assert.deepEqual(f.calls.at(-1),{width:100,height:80,mime:'image/png'});assert.equal(f.state.disposed,1);
});
test('portrait JPEG and WebP photos preserve shape and normalize to JPEG with no original file data in the result',async()=>{
  const {readEmployeeAvatar}=load();for(const type of ['image/jpeg','image/webp']){const f=avatarFixture({type,width:3000,height:4000});const result=await readEmployeeAvatar(f.file,f.browser);assert.equal(result,'data:image/jpeg;base64,AQID');assert.deepEqual(f.calls.at(-1),{width:384,height:512,mime:'image/jpeg'});assert.equal(result.includes('fictional'),false);}
});
test('known image headers reject over-24-megapixel photos before browser decoding or Canvas allocation',async()=>{
  const {readEmployeeAvatar,inspectAvatarHeader}=load();for(const type of ['image/png','image/jpeg','image/webp']){const f=avatarFixture({type,width:6000,height:4001});await assert.rejects(readEmployeeAvatar(f.file,f.browser),/2400万|24MP/);assert.deepEqual(f.calls,['header']);}assert.deepEqual(inspectAvatarHeader(pngHeader(6000,4001)),{mime:'image/png',width:6000,height:4001});
});
test('JPEG metadata beyond the bounded header probe still receives a postdecode pixel guard before encoding',async()=>{
  const {readEmployeeAvatar}=load(),f=avatarFixture({type:'image/jpeg',header:Buffer.from([255,216,255,225,255,255]),decodedWidth:6000,decodedHeight:5000});await assert.rejects(readEmployeeAvatar(f.file,f.browser),/2400万|24MP/);assert.deepEqual(f.calls,['header','decode']);assert.equal(f.state.disposed,1);
});
test('file reading and unsupported decoder failures are reported in Chinese without creating a canvas',async()=>{
  const {readEmployeeAvatar}=load();const read=avatarFixture({readError:true}),decode=avatarFixture({decodeError:true});await assert.rejects(readEmployeeAvatar(read.file,read.browser),/读取失败/);assert.deepEqual(read.calls,['header']);await assert.rejects(readEmployeeAvatar(decode.file,decode.browser),/无法解码|无法读取|不支持/);assert.deepEqual(decode.calls,['header','decode']);
});
test('failed encoders and oversized encoded output release the temporary image and never return an upload payload',async()=>{
  const {readEmployeeAvatar}=load();for(const options of [{encodeError:true},{outputBytes:new Uint8Array(2097153)}]){const f=avatarFixture(options);await assert.rejects(readEmployeeAvatar(f.file,f.browser),/编码失败|2MB/);assert.equal(f.state.disposed,1);}
});
test('the default file probe reads only a bounded slice and turns asynchronous file access failures into a clear error',async()=>{
  const {readEmployeeAvatar}=load();let slices=0;const file={type:'image/png',name:'fictional.png',size:500,slice(from,to){assert.equal(from,0);assert.equal(to,65536);slices++;return{arrayBuffer:async()=>{throw Error('fictional file access failed');}};}};await assert.rejects(readEmployeeAvatar(file),/读取失败/);assert.equal(slices,1);
});
test('invalid empty sources and disguised unsupported image bytes fail before any image decoder runs',async()=>{
  const {readEmployeeAvatar}=load();for(const size of [0,-1,NaN]){const f=avatarFixture();f.file.size=size;await assert.rejects(readEmployeeAvatar(f.file,f.browser),/12MB/);assert.deepEqual(f.calls,[]);}const f=avatarFixture({header:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')});await assert.rejects(readEmployeeAvatar(f.file,f.browser),/无法识别/);assert.deepEqual(f.calls,['header']);
});
test('public profile card renders published aggregates and only offers editing when the server grants canEdit',()=>{
  const {EmployeeProfileCard}=load();const reply={profile:{staffId:'fictional',name:'虚构同事',age:28,bio:'喜欢铂金\n用心服务',role:'employee',active:true,revision:1,avatar:null,canEdit:false},month:'2026-10',published:true,publication:{month:'2026-10',version:2,publishedAt:'2026-10-14T00:00:00Z',publishedName:'财务核定'},sourceNote:'已核定发布',summary:{orderCount:5,amount:500.25,amountCents:'50025',weight:12.345678,weightMicros:'12345678'}};
  const html=renderedText(EmployeeProfileCard({reply}));assert.match(html,/虚构同事/);assert.match(html,/28/);assert.match(html,/500.25/);assert.match(html,/12.345678/);assert.match(html,/V2/);assert.equal(html.includes('编辑资料'),false);assert.equal(html.includes('更换头像'),false);assert.equal(/利润|客户|PRIVATE/.test(html),false);
  const own=renderedText(EmployeeProfileCard({reply:{...reply,profile:{...reply.profile,canEdit:true}}}));assert.match(own,/编辑资料/);assert.match(own,/更换头像/);
});
test('unpublished profile card communicates waiting for finance instead of presenting zeros as sales achievements',()=>{
  const {EmployeeProfileCard}=load();const html=renderedText(EmployeeProfileCard({reply:{profile:{name:'虚构同事',age:null,bio:'',active:true,revision:0,avatar:null,canEdit:false},month:'2026-10',published:false,publication:null,summary:{orderCount:0,amount:0,weight:0},sourceNote:''}}));assert.match(html,/等待财务发布|尚未发布/);assert.equal(html.includes('¥0.00'),false);
});

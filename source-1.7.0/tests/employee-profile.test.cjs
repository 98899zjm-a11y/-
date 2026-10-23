'use strict';
// All business state and image objects in this suite are owned, synthetic and in memory.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib');
const { DatabaseSync } = require('node:sqlite');
const { createAdministration } = require('../project/desktop/administration.cjs');
const { createWorkspaceCollaboration } = require('../project/desktop/workspace-collaboration.cjs');
const SOURCE = path.resolve(__dirname, '../project/desktop/employee-profile.cjs');
function implementation() { assert.ok(fs.existsSync(SOURCE), 'Employee profile feature is missing'); return require(SOURCE); }
const ids = { a: '10000000-0000-4000-8000-00000000000a', b: '10000000-0000-4000-8000-00000000000b', admin: '10000000-0000-4000-8000-00000000000c', inactive: '10000000-0000-4000-8000-00000000000d' };
function fixture(t) {
  const module = implementation(), db = new DatabaseSync(':memory:');
  t.after(() => db.close()); db.exec('PRAGMA foreign_keys=ON');
  db.exec('CREATE TABLE staff_users(id TEXT PRIMARY KEY,name TEXT NOT NULL,role TEXT NOT NULL,active INTEGER NOT NULL); CREATE TABLE local_accounts(staff_id TEXT PRIMARY KEY,username TEXT); CREATE TABLE audit_logs(id TEXT,entity_type TEXT,entity_id TEXT,action TEXT,actor_id TEXT,actor_name TEXT,created_at TEXT);');
  for (const migration of ['0004_module_administration.sql','0005_workspace_collaboration.sql','0007_collaboration_review_versions.sql','0009_employee_profiles.sql']) db.exec(fs.readFileSync(path.resolve(__dirname,'../project/desktop/migrations',migration),'utf8'));
  for (const [key, id] of Object.entries(ids)) db.prepare('INSERT INTO staff_users VALUES(?,?,?,?)').run(id, '虚构' + key, key === 'admin' ? 'admin' : 'employee', key === 'inactive' ? 0 : 1);
  const objects = new Map();
  const bucket = { async put(key, bytes, metadata) { objects.set(key,{body:Buffer.from(bytes),...metadata}); }, async get(key) { return objects.get(key) || null; }, async delete(key) { objects.delete(key); } };
  const runtime = { sqlite: db, env: { BUCKET: bucket } }, administration = createAdministration({ runtime, clock: () => Date.parse('2026-10-14T00:00:00Z') });
  const service = module.createEmployeeProfile({ runtime, administration, clock: () => Date.parse('2026-10-14T00:00:00Z') });
  const user = key => ({ id: ids[key], name: '虚构' + key, role: key === 'admin' ? 'admin' : 'employee', active: key !== 'inactive' });
  const handle = (actor, url, method = 'GET', body) => service.handle(actor, { path: '/api/employee-profiles' + url, method, body });
  return { module, db, objects, user, handle, administration, runtime };
}
const status = number => error => error.status === number;
function published(f, { version = 1, state = 'published', rows, mappings } = {}) {
  const key = 'staff:' + 'b'.repeat(64), other = 'staff:' + 'c'.repeat(64), sales = rows || [
    { sourceId: 'fake-line-a', date: '2026-10-01', orderNo: 'PRIVATE-ORDER', product: 'PRIVATE-PRODUCT', customer: 'PRIVATE-CUSTOMER', salespersonKey: key, salespersonName: '虚构a', amountCents: '12500', amountRaw: '125.00', receivedCents: '9000', weightMicros: '1234567', weightRaw: '1.234567', itemsCount: 1, profitCents: '8888' },
    { sourceId: 'fake-line-b', date: '2026-10-02', salespersonKey: other, salespersonName: '虚构b', amountCents: '30000', receivedCents: '20000', weightMicros: '2000000', itemsCount: 1, profitCents: '7777' }
  ];
  const snapshot = { sales, profitIncluded: true, capturedAt: '2026-10-03T00:00:00Z', instance: 'a'.repeat(64) };
  f.db.prepare('INSERT INTO sales_publications(id,month,content_hash,snapshot,mappings,status,revision,version,created_by,created_name,created_at,published_name,published_at) VALUES(?,?,?,?,?,?,1,?,?,?,?,?,?)').run('pub-' + version + '-' + state, '2026-10', String(version).repeat(64), JSON.stringify(snapshot), JSON.stringify(mappings || {[key]:ids.a,[other]:ids.b}), state, state === 'published' ? version : null, ids.admin, '虚构admin', '2026-10-03T00:00:00Z', '虚构核定人', '2026-10-03T00:00:00Z');
}
function crc(bytes) { let sum=0xffffffff; for(const byte of bytes){sum^=byte; for(let i=0;i<8;i++)sum=(sum>>>1)^((sum&1)?0xedb88320:0);} return (sum^0xffffffff)>>>0; }
function png(width=1,height=1) { const chunk=(name,data)=>{const type=Buffer.from(name), out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);type.copy(out,4);data.copy(out,8);out.writeUInt32BE(crc(Buffer.concat([type,data])),out.length-4);return out;}; const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6; const pixels=Buffer.alloc((width*4+1)*height);return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]); }
const image = bytes => 'data:image/png;base64,' + bytes.toString('base64');

test('all active company employees can browse profiles even when every sales capability is revoked', async t => {
  const f=fixture(t);f.db.prepare('INSERT INTO staff_capabilities VALUES(?,?,?)').run(ids.a,JSON.stringify({'personal.sales.view':false,'personal.sales.profit':false}),'2026-10-14');f.db.prepare("INSERT INTO module_permissions VALUES(?,'disabled','disabled','disabled',1,?)").run(ids.a,'2026-10-14');
  const reply=await f.handle(f.user('a'),'');assert.deepEqual(reply.data.profiles.map(x=>x.staffId).sort(),[ids.a,ids.b,ids.admin].sort());assert.equal(reply.data.profiles[0].bio,'');assert.equal(reply.data.profiles[0].revision,0);
  assert.equal((await f.handle(f.user('a'),'/' + ids.b)).data.profile.staffId,ids.b);
  await assert.rejects(f.handle(null,''),status(401));await assert.rejects(f.handle(f.user('inactive'),''),status(401));await assert.rejects(f.handle(f.user('a'),'/' + ids.inactive),status(404));
});
test('employees edit their own age and biography and stale edits leave the newer profile intact', async t => {
  const f=fixture(t),first=await f.handle(f.user('a'),'/' + ids.a,'PATCH',{revision:0,age:28,bio:'  珠宝顾问\n喜欢铂金。  '});assert.equal(first.data.profile.age,28);assert.equal(first.data.profile.bio,'珠宝顾问\n喜欢铂金。');assert.equal(first.data.profile.revision,1);
  await assert.rejects(f.handle(f.user('a'),'/' + ids.a,'PATCH',{revision:0,bio:'旧内容'}),status(409));assert.equal((await f.handle(f.user('b'),'/' + ids.a)).data.profile.bio,'珠宝顾问\n喜欢铂金。');
  const cleared=await f.handle(f.user('a'),'/' + ids.a,'PATCH',{revision:1,age:null,bio:''});assert.equal(cleared.data.profile.age,null);assert.equal(cleared.data.profile.bio,'');
});
test('only the real live admin role can edit another employee and each accepted edit is audited', async t => {
  const f=fixture(t);await assert.rejects(f.handle({...f.user('a'),role:'admin'},'/' + ids.b,'PATCH',{revision:0,age:22}),status(403));
  await f.handle(f.user('admin'),'/' + ids.b,'PATCH',{revision:0,age:22,bio:'由管理员核对'});const log=f.db.prepare("SELECT * FROM operation_logs WHERE action='employee-profile.update'").get();assert.equal(log.actor_id,ids.admin);assert.equal(log.actor_name,'虚构admin');assert.equal(log.resource,ids.b);assert.equal(log.success,1);assert.equal((await f.handle(f.user('a'),'/' + ids.b)).data.profile.age,22);
  f.db.prepare("UPDATE staff_users SET role='employee' WHERE id=?").run(ids.admin);await assert.rejects(f.handle(f.user('admin'),'/' + ids.b,'PATCH',{revision:1,age:23}),status(403));
});
test('profile input rejects score forgery, arbitrary avatar paths, invalid ages and control characters', async t => {
  const f=fixture(t);for(const body of [{revision:0,orderCount:999},{revision:0,avatarId:'../../private'},{revision:0,age:'28'},{revision:0,age:121},{revision:0,age:0},{revision:0,age:2.5},{revision:0,bio:'a'.repeat(601)},{revision:0,bio:'x\u0000y'},{age:28},{revision:0}]) await assert.rejects(f.handle(f.user('a'),'/' + ids.a,'PATCH',body),status(400));
  assert.equal(f.db.prepare('SELECT count(*) n FROM staff_profiles').get().n,0);
});
test('public achievements select the latest approved published month and never expose customer, order or profit data', async t => {
  const f=fixture(t);published(f);published(f,{version:2,rows:[{sourceId:'line-v2',date:'2026-10-06',salespersonKey:'staff:'+'b'.repeat(64),amountCents:'50000',receivedCents:'1',weightMicros:'3500000',itemsCount:4,profitCents:'55555',orderNo:'SECRET-2'}]});published(f,{version:3,state:'draft',rows:[]});
  const r=(await f.handle(f.user('b'),'/' + ids.a+'?month=2026-10')).data;assert.deepEqual(r.summary,{orderCount:1,amountCents:'50000',amount:500,weightMicros:'3500000',weight:3.5});assert.equal(r.publication.version,2);assert.equal(r.published,true);for(const text of ['profit','SECRET-2','sourceId','salespersonKey','PRIVATE'])assert.equal(JSON.stringify(r).includes(text),false);
  const none=(await f.handle(f.user('a'),'/' + ids.b+'?month=2026-09')).data;assert.equal(none.published,false);assert.deepEqual(none.summary,{orderCount:0,amountCents:'0',amount:0,weightMicros:'0',weight:0});
});
test('public summaries round original financial values once after aggregation and ignore unmapped sales', async t => {
  const f=fixture(t),key='staff:'+'b'.repeat(64);published(f,{rows:[{sourceId:'1',salespersonKey:key,amountCents:'1',amountRaw:'0.005',weightMicros:'1',weightRaw:'0.0000005'},{sourceId:'2',salespersonKey:key,amountCents:'1',amountRaw:'0.005',weightMicros:'1',weightRaw:'0.0000005'},{sourceId:'3',salespersonKey:'unmatched',amountCents:'999999',weightMicros:'999999'}]});
  assert.deepEqual((await f.handle(f.user('a'),'/' + ids.a+'?month=2026-10')).data.summary,{orderCount:2,amountCents:'1',amount:0.01,weightMicros:'1',weight:0.000001});
});
test('private personal sales still reject another employee and profit remains separately authorized', async t => {
  const f=fixture(t);published(f);const personal=createWorkspaceCollaboration({runtime:f.runtime,administration:f.administration});assert.throws(()=>personal.handle(f.user('a'),{path:'/api/collaboration/personal-sales?month=2026-10&staffId='+ids.b,method:'GET'}),status(403));
  const mine=personal.handle(f.user('a'),{path:'/api/collaboration/personal-sales?month=2026-10',method:'GET'}).data;assert.equal(mine.details.length,1);assert.equal(JSON.stringify(mine).includes('profitCents'),false);assert.equal(mine.summary.profitAvailable,false);
});
test('avatar upload uses company image bucket UUIDs and colleagues need authentication to retrieve it', async t => {
  const f=fixture(t),r=await f.handle(f.user('a'),'/' + ids.a+'/avatar','POST',{revision:0,image:image(png())}),avatar=r.data.profile.avatar;assert.match(avatar.id,/^[a-f0-9-]{36}$/);assert.match(avatar.url,/^\/api\/employee-profiles\/avatars\/[a-f0-9-]{36}$/);assert.deepEqual([...f.objects.keys()],['images/'+avatar.id]);
  const bytes=(await f.handle(f.user('b'),'/avatars/'+avatar.id)).data;assert.equal(bytes.image,image(png()));assert.equal(bytes.mime,'image/png');assert.equal(bytes.width,1);assert.equal(bytes.height,1);assert.equal(JSON.stringify(bytes).includes('images/'),false);await assert.rejects(f.handle(null,'/avatars/'+avatar.id),status(401));
  await assert.rejects(f.handle(f.user('b'),'/' + ids.a+'/avatar','POST',{revision:1,image:image(png())}),status(403));await assert.rejects(f.handle(f.user('a'),'/avatars/../../private'),status(404));
});
test('invalid, oversized, forged and huge-dimension avatars never create image objects or profile records', async t => {
  const f=fixture(t),valid=image(png()),fakeJpeg='data:image/jpeg;base64,'+png().toString('base64');for(const src of [fakeJpeg,'data:image/svg+xml;base64,PHN2Zy8+','data:image/png;base64,YQ==','data:image/png;base64,@@@@',image(png(2049,1)),image(Buffer.alloc(2*1024*1024+1)),valid.slice(0,-4)]) await assert.rejects(f.handle(f.user('a'),'/' + ids.a+'/avatar','POST',{revision:0,image:src}),e=>[400,413].includes(e.status));
  assert.equal(f.objects.size,0);assert.equal(f.db.prepare('SELECT count(*) n FROM staff_profiles').get().n,0);const broken=png();broken[broken.length-1]^=1;await assert.rejects(f.handle(f.user('a'),'/' + ids.a+'/avatar','POST',{revision:0,image:image(broken)}),status(400));
});
test('avatar updates recheck live identity after storage and remove their newly owned object on conflict', async t => {
  const f=fixture(t),bucket=f.runtime.env.BUCKET,original=bucket.put;bucket.put=async (...args)=>{await original(...args);f.db.prepare('UPDATE staff_users SET active=0 WHERE id=?').run(ids.a);};await assert.rejects(f.handle(f.user('a'),'/' + ids.a+'/avatar','POST',{revision:0,image:image(png())}),status(401));assert.equal(f.objects.size,0);
});
test('real static JPEG and WebP fixtures pass while truncated containers and MIME mismatches are refused',()=>{
  const {validateAvatar}=implementation();
  const jpeg='/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCxRRRXmnuH/9k=';
  const webp='UklGRjYAAABXRUJQVlA4ICoAAACwAQCdASoBAAEAAUAmJZgCdLoABiIAAP6k1+hRsomKf/xDnQ50OZJAAAA=';
  for(const [mime,encoded] of [['image/jpeg',jpeg],['image/webp',webp]]){const result=validateAvatar('data:'+mime+';base64,'+encoded);assert.equal(result.width,1);assert.equal(result.height,1);assert.equal(result.mime,mime);assert.throws(()=>validateAvatar('data:'+mime+';base64,'+Buffer.from(encoded,'base64').subarray(0,-2).toString('base64')),status(400));assert.throws(()=>validateAvatar('data:image/png;base64,'+encoded),status(400));}
});
test('unknown avatars and profiles from another company are unavailable even with a syntactically valid UUID', async t => {
  const a=fixture(t),b=fixture(t),r=await a.handle(a.user('a'),'/' + ids.a+'/avatar','POST',{revision:0,image:image(png())});await assert.rejects(b.handle(b.user('a'),'/avatars/'+r.data.profile.avatar.id),status(404));
  await assert.rejects(a.handle(a.user('a'),'/'+'99999999-0000-4000-8000-000000000000'),status(404));await assert.rejects(a.handle(a.user('a'),'/' + ids.a+'?month=2026-13'),status(400));await assert.rejects(a.handle(a.user('a'),'/' + ids.a+'?staffId='+ids.b),status(400));
});

'use strict';
const { randomUUID, createHash } = require('node:crypto');
const { inflateSync } = require('node:zlib');
const { SALES_SOURCE_NOTE } = require('./workspace-collaboration.cjs');
const { createEmployeePosts, isEmployeePostPath } = require('./employee-posts.cjs');
const PREFIX = '/api/employee-profiles';
const UUID = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const AVATAR_BYTES = 2 * 1024 * 1024, AVATAR_EDGE = 2048;
function fail(status, message) { const problem = new Error(message); problem.status = status; throw problem; }
function object(value, keys) { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) fail(400, '个人资料参数无效'); return value; }
function revision(value) { if (!Number.isInteger(value) || value < 0 || value >= Number.MAX_SAFE_INTEGER) fail(400, '请提供当前个人资料版本'); return value; }
function dimensions(width, height) { if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) fail(400, '头像尺寸无效'); if (width > AVATAR_EDGE || height > AVATAR_EDGE || width * height > AVATAR_EDGE ** 2) fail(413, '头像尺寸最多为2048×2048像素'); return { width, height }; }
function crc(bytes) { let sum = 0xffffffff; for (const byte of bytes) { sum ^= byte; for (let i = 0; i < 8; i++) sum = (sum >>> 1) ^ ((sum & 1) ? 0xedb88320 : 0); } return (sum ^ 0xffffffff) >>> 0; }
function png(bytes) {
  if (!bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) fail(400, 'PNG头像文件无效');
  let offset = 8, frame, palette = false, end = false; const data = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset), name = bytes.toString('ascii', offset + 4, offset + 8), next = offset + length + 12;
    if (next > bytes.length || !/^[A-Za-z]{4}$/.test(name) || crc(bytes.subarray(offset + 4, next - 4)) !== bytes.readUInt32BE(next - 4)) fail(400, 'PNG头像文件损坏');
    const body = bytes.subarray(offset + 8, next - 4);
    if (name === 'IHDR') {
      if (frame || offset !== 8 || length !== 13) fail(400, 'PNG头像结构无效');
      frame = { ...dimensions(body.readUInt32BE(0), body.readUInt32BE(4)), depth: body[8], color: body[9], interlace: body[12] };
      const depths = { 0: [1,2,4,8,16], 2: [8,16], 3: [1,2,4,8], 4: [8,16], 6: [8,16] };
      if (!depths[frame.color]?.includes(frame.depth) || body[10] !== 0 || body[11] !== 0 || frame.interlace > 1) fail(400, 'PNG头像编码无效');
    } else if (!frame) fail(400, 'PNG头像缺少图像信息');
    else if (name === 'PLTE') { if (!length || length % 3 || length > 768) fail(400, 'PNG调色板无效'); palette = true; }
    else if (name === 'IDAT') data.push(body);
    else if (name === 'IEND') { if (length || next !== bytes.length) fail(400, 'PNG头像结尾无效'); end = true; break; }
    else if (name[0] === name[0].toUpperCase() || ['acTL','fcTL','fdAT'].includes(name)) fail(400, '头像请选择静态PNG图片');
    offset = next;
  }
  if (!frame || !end || !data.length || frame.color === 3 && !palette) fail(400, 'PNG头像不完整');
  const channels = { 0:1, 2:3, 3:1, 4:2, 6:4 }[frame.color], bits = channels * frame.depth;
  const passes = frame.interlace ? [[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]] : [[0,0,1,1]];
  const scans = passes.map(([x,y,dx,dy]) => ({ columns: Math.max(0,Math.ceil((frame.width-x)/dx)), rows: Math.max(0,Math.ceil((frame.height-y)/dy)) })).filter(pass => pass.columns && pass.rows).map(pass => ({ rows: pass.rows, stride: 1 + Math.ceil(pass.columns * bits / 8) }));
  const expected = scans.reduce((sum, pass) => sum + pass.rows * pass.stride, 0); let pixels;
  try { pixels = inflateSync(Buffer.concat(data), { maxOutputLength: expected + 1 }); } catch { fail(400, 'PNG头像像素数据损坏'); }
  if (pixels.length !== expected) fail(400, 'PNG头像像素数据不完整');
  let position = 0; for (const pass of scans) for (let row = 0; row < pass.rows; row++, position += pass.stride) if (pixels[position] > 4) fail(400, 'PNG头像扫描线无效');
  return dimensions(frame.width, frame.height);
}
function jpeg(bytes) {
  if (bytes.length < 20 || bytes[0] !== 255 || bytes[1] !== 216) fail(400, 'JPEG头像文件无效');
  let offset = 2, frame, quantization = false, huffman = false, scans = 0, entropy = 0;
  while (offset < bytes.length) {
    if (bytes[offset++] !== 255) fail(400, 'JPEG头像标记损坏');
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker === 217) { if (offset !== bytes.length || !frame || !quantization || !huffman || !scans || !entropy) fail(400, 'JPEG头像不完整'); return frame; }
    if (marker === 0 || marker === 216 || marker >= 208 && marker <= 215 || offset + 2 > bytes.length) fail(400, 'JPEG头像结构无效');
    const length = bytes.readUInt16BE(offset), end = offset + length;
    if (length < 2 || end > bytes.length) fail(400, 'JPEG头像数据截断');
    const body = bytes.subarray(offset + 2, end);
    if ([192,193,194].includes(marker)) { if (frame || body.length < 6 || body[0] !== 8 || ![1,3,4].includes(body[5]) || body.length !== 6 + 3 * body[5]) fail(400, 'JPEG头像图像信息无效'); frame = dimensions(body.readUInt16BE(3), body.readUInt16BE(1)); }
    else if (marker === 219) { if (body.length < 65) fail(400, 'JPEG量化表无效'); quantization = true; }
    else if (marker === 196) { if (body.length < 18) fail(400, 'JPEG编码表无效'); huffman = true; }
    offset = end;
    if (marker === 218) {
      if (!frame || body.length < 6 || body.length !== 4 + 2 * body[0]) fail(400, 'JPEG扫描数据无效'); scans++;
      while (offset < bytes.length) { if (bytes[offset] !== 255) { offset++; entropy++; continue; } if (bytes[offset+1] === 0 || bytes[offset+1] >= 208 && bytes[offset+1] <= 215) { offset += 2; entropy++; continue; } break; }
    }
  }
  fail(400, 'JPEG头像缺少结束标记');
}
function webp(bytes) {
  if (bytes.length < 26 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP' || bytes.readUInt32LE(4) !== bytes.length - 8) fail(400, 'WebP头像文件无效');
  let offset = 12, frame, extended;
  while (offset + 8 <= bytes.length) {
    const kind = bytes.toString('ascii', offset, offset + 4), length = bytes.readUInt32LE(offset + 4), end = offset + 8 + length, padded = end + length % 2;
    if (padded > bytes.length) fail(400, 'WebP头像容器截断'); const body = bytes.subarray(offset + 8, end);
    if (kind === 'ANIM' || kind === 'ANMF') fail(400, '头像请选择静态WebP图片');
    if (kind === 'VP8X') { if (length !== 10 || extended || body[0] & 2) fail(400, 'WebP头像扩展信息无效'); extended = dimensions(1+body.readUIntLE(4,3),1+body.readUIntLE(7,3)); }
    else if (kind === 'VP8 ') { if (frame || length <= 10 || body[0] & 1 || !body.subarray(3,6).equals(Buffer.from([157,1,42])) || (body.readUIntLE(0,3) >>> 5) > length - 10) fail(400, 'WebP头像帧无效'); frame = dimensions(body.readUInt16LE(6)&16383,body.readUInt16LE(8)&16383); }
    else if (kind === 'VP8L') { if (frame || length <= 5 || body[0] !== 47 || body[4] & 224) fail(400, 'WebP头像无损帧无效'); const bits = body.readUInt32LE(1); frame = dimensions((bits&16383)+1,((bits>>>14)&16383)+1); }
    offset = padded;
  }
  if (offset !== bytes.length || !frame || extended && (extended.width !== frame.width || extended.height !== frame.height)) fail(400, 'WebP头像图像信息不完整'); return frame;
}
function validateAvatar(source, maximum = AVATAR_BYTES) {
  if (![AVATAR_BYTES, 4 * 1024 * 1024].includes(maximum)) throw new TypeError('Internal image byte budget invalid');
  if (typeof source !== 'string') fail(400, '请选择PNG、JPEG或WebP头像文件');
  if (source.length > Math.ceil(maximum / 3) * 4 + 64) fail(413, maximum === AVATAR_BYTES ? '头像文件最多2MB' : '动态图片最多4MiB');
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(source);
  if (!match || match[2].length % 4) fail(400, '头像图片格式无效');
  const bytes = Buffer.from(match[2], 'base64'); if (!bytes.length || bytes.toString('base64') !== match[2]) fail(400, '头像图片编码无效'); if (bytes.length > maximum) fail(413, maximum === AVATAR_BYTES ? '头像文件最多2MB' : '动态图片最多4MiB');
  const dimensions = ({ 'image/png': png, 'image/jpeg': jpeg, 'image/webp': webp })[match[1]](bytes);
  return { bytes, mime: match[1], ...dimensions, sha256: createHash('sha256').update(bytes).digest('hex') };
}
function month(value) { if (typeof value !== 'string' || !/^(?:20\d\d|21\d\d|2200)-(?:0[1-9]|1[0-2])$/.test(value)) fail(400, '月份须为2000至2200年的有效年月'); return value; }
function scaled(value, scale) {
  if (typeof value !== 'string' || !/^-?\d{1,15}(?:\.\d{1,18})?$/.test(value)) fail(502, '已发布金额或克重格式无效');
  const negative = value.startsWith('-'), [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.'); return (negative ? -1n : 1n) * BigInt(whole + fraction.padEnd(scale, '0'));
}
function raw(row, field, fallback, digits) {
  if (row[field] !== undefined) return scaled(row[field], 18);
  if (typeof row[fallback] !== 'string' || !/^-?\d{1,22}$/.test(row[fallback])) fail(502, '已发布金额或克重精度无效'); return BigInt(row[fallback]) * 10n ** BigInt(18 - digits);
}
function rounded(value, digits) { const divisor = 10n ** BigInt(18 - digits), negative = value < 0n; const result = ((negative ? -value : value) + divisor / 2n) / divisor; if (result > BigInt(Number.MAX_SAFE_INTEGER)) fail(502, '已发布合计超过支持范围'); return (negative ? -result : result).toString(); }
function publicSummary(rows) { let amount = 0n, weight = 0n; for (const row of rows) { amount += raw(row,'amountRaw','amountCents',2); weight += raw(row,'weightRaw','weightMicros',6); } const amountCents = rounded(amount,2), weightMicros = rounded(weight,6); return { orderCount: rows.length, amountCents, amount: Number(amountCents)/100, weightMicros, weight: Number(weightMicros)/1000000 }; }

function createEmployeeProfile({ runtime, administration, clock = Date.now }) {
  const db = runtime.sqlite, bucket = runtime.env?.BUCKET, now = () => new Date(clock()).toISOString();
  const posts = createEmployeePosts({ runtime, administration, clock, validateImage: source => validateAvatar(source, 4 * 1024 * 1024) });
  const currentMonth = () => new Date(clock() + 8 * 3600000).toISOString().slice(0, 7);
  function live(user) { if (!user?.id) fail(401, '请先登录公司账号'); const row = db.prepare('SELECT id,name,role,active FROM staff_users WHERE id=?').get(user.id); if (!row?.active) fail(401, '账号已停用，请重新登录'); return row; }
  function transaction(action) { db.exec('BEGIN IMMEDIATE'); try { const result = action(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } }
  const query = 'SELECT s.id,s.name,s.role,s.active,p.age,p.bio,p.avatar_id,p.revision,p.updated_at FROM staff_users s LEFT JOIN staff_profiles p ON p.staff_id=s.id';
  function record(row, actor) { return { staffId: row.id, name: row.name, role: row.role, active: Boolean(row.active), age: row.age ?? null, bio: row.bio || '', avatar: row.avatar_id ? { id: row.avatar_id, url: PREFIX + '/avatars/' + row.avatar_id } : null, revision: row.revision || 0, updatedAt: row.updated_at || null, canEdit: actor.id === row.id || actor.role === 'admin' }; }
  function staff(actor, id) { const row = db.prepare(query + ' WHERE s.id=?').get(id); if (!row || !row.active && actor.role !== 'admin') fail(404, '员工个人主页不存在'); return row; }
  function editable(user, id, expected) { const actor = live(user); if (actor.id !== id && actor.role !== 'admin') fail(403, '只能修改自己的个人资料'); const row = staff(actor,id); if ((row.revision || 0) !== expected) fail(409, '个人资料已更新，请刷新后再保存'); return { actor, row }; }
  function audit(user, action, id, summary) { administration.noteAction(user, { module: 'home', action: 'employee-profile.' + action, label: action === 'avatar' ? '修改员工头像' : '修改员工个人资料', resource: id, summary }); }
  function update(user, id, input) {
    object(input,['revision','age','bio']); const expected = revision(input.revision); if (input.age === undefined && input.bio === undefined) fail(400, '请填写需要修改的个人资料');
    if (input.age !== undefined && input.age !== null && (!Number.isInteger(input.age) || input.age < 1 || input.age > 120)) fail(400, '年龄须为1至120的整数，或留空');
    if (input.bio !== undefined && (typeof input.bio !== 'string' || input.bio.length > 600 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input.bio))) fail(400, '简介最多600字，不能包含控制字符');
    return transaction(() => { const { actor,row } = editable(user,id,expected), age = input.age === undefined ? row.age ?? null : input.age, bio = input.bio === undefined ? row.bio || '' : input.bio.trim();
      db.prepare('INSERT INTO staff_profiles(staff_id,age,bio,revision,updated_by,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(staff_id) DO UPDATE SET age=excluded.age,bio=excluded.bio,revision=excluded.revision,updated_by=excluded.updated_by,updated_at=excluded.updated_at').run(id,age,bio,expected+1,actor.id,now());
      audit(actor,'update',id,'个人年龄或简介已保存；不改变销售成果'); return { profile: record(staff(actor,id),actor) }; });
  }
  async function avatar(user, id, input) {
    object(input,['revision','image']); const expected = revision(input.revision); editable(user,id,expected); const image = validateAvatar(input.image);
    if (!bucket?.put || !bucket?.get || !bucket?.delete) fail(503, '公司头像存储尚未就绪'); const assetId = randomUUID(), key = 'images/' + assetId;
    try {
      await bucket.put(key,image.bytes,{ httpMetadata: { contentType:image.mime }, customMetadata: { purpose:'staff-avatar',staffId:id,sha256:image.sha256 } });
      return transaction(() => { const {actor,row} = editable(user,id,expected); db.prepare('INSERT INTO staff_profile_avatars(id,staff_id,mime,byte_length,width,height,sha256,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(assetId,id,image.mime,image.bytes.length,image.width,image.height,image.sha256,actor.id,now());
        db.prepare('INSERT INTO staff_profiles(staff_id,age,bio,avatar_id,revision,updated_by,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(staff_id) DO UPDATE SET avatar_id=excluded.avatar_id,revision=excluded.revision,updated_by=excluded.updated_by,updated_at=excluded.updated_at').run(id,row.age??null,row.bio||'',assetId,expected+1,actor.id,now());
        audit(actor,'avatar',id,'员工头像已保存至销售图片备份范围'); return { profile: record(staff(actor,id),actor) }; });
    } catch (error) { try { await bucket.delete(key); } catch { /* The unreferenced UUID is never exposed by the authenticated retrieval route. */ } throw error; }
  }
  async function avatarContent(user,id) {
    let actor = live(user), row = db.prepare('SELECT a.*,s.active FROM staff_profile_avatars a JOIN staff_profiles p ON p.avatar_id=a.id AND p.staff_id=a.staff_id JOIN staff_users s ON s.id=a.staff_id WHERE a.id=?').get(id);
    if (!row || !row.active && actor.role !== 'admin') fail(404, '员工头像不存在'); const stored = await bucket?.get?.('images/'+id); actor = live(user);
    // A profile may have changed while the bucket was being read. Do not reveal a detached avatar.
    row = db.prepare('SELECT a.*,s.active FROM staff_profile_avatars a JOIN staff_profiles p ON p.avatar_id=a.id AND p.staff_id=a.staff_id JOIN staff_users s ON s.id=a.staff_id WHERE a.id=?').get(id);
    if (!row || !row.active && actor.role !== 'admin' || !stored) fail(404, '员工头像不存在');
    const bytes = Buffer.from(stored.body); if (bytes.length !== row.byte_length || createHash('sha256').update(bytes).digest('hex') !== row.sha256) fail(502, '员工头像文件校验失败');
    return { image: 'data:'+row.mime+';base64,'+bytes.toString('base64'), mime:row.mime, width:row.width, height:row.height };
  }
  function detail(actor, id, selectedMonth) {
    const row = staff(actor,id), publication = db.prepare("SELECT * FROM sales_publications WHERE month=? AND status='published' ORDER BY version DESC LIMIT 1").get(selectedMonth); let rows = [];
    if (publication) { const snapshot = JSON.parse(publication.snapshot), mappings = JSON.parse(publication.mappings); rows = snapshot.sales.filter(item => mappings[item.salespersonKey] === id); }
    return { profile:record(row,actor), month:selectedMonth, published:Boolean(publication), publication:publication ? { month:publication.month, version:publication.version, publishedAt:publication.published_at, publishedName:publication.published_name } : null, sourceNote:SALES_SOURCE_NOTE, summary:publicSummary(rows) };
  }
  async function handle(user,input) {
    const actor = live(user), url = new URL(input.path,'http://offline.invalid'), endpoint = url.pathname, method = String(input.method||'GET').toUpperCase(); let data;
    if (isEmployeePostPath(endpoint)) return posts.handle(user, input);
    const content = new RegExp('^'+PREFIX+'/avatars/('+UUID+')$').exec(endpoint), upload = new RegExp('^'+PREFIX+'/('+UUID+')/avatar$').exec(endpoint), profile = new RegExp('^'+PREFIX+'/('+UUID+')$').exec(endpoint);
    if (url.search && (!profile || method !== 'GET' || [...url.searchParams.keys()].some(key => key !== 'month') || url.searchParams.getAll('month').length !== 1)) fail(400, '个人主页查询参数无效');
    if (endpoint === PREFIX && method === 'GET') data = { profiles: db.prepare(query + (actor.role === 'admin' ? '' : ' WHERE s.active=1') + ' ORDER BY s.name,s.id').all().map(row => record(row,actor)) };
    else if (content && method === 'GET') data = await avatarContent(user,content[1]);
    else if (upload && method === 'POST') data = await avatar(user,upload[1],input.body);
    else if (profile && method === 'GET') data = detail(actor,profile[1],month(url.searchParams.get('month') || currentMonth()));
    else if (profile && method === 'PATCH') data = update(user,profile[1],input.body);
    else fail(404, '员工个人主页功能不存在');
    return { ok:true, status:200, data };
  }
  return { handle };
}
module.exports = { createEmployeeProfile, validateAvatar, publicSummary };

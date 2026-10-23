'use strict';
const { randomUUID, createHash } = require('node:crypto');
const CHUNK = 1024 * 1024, IMAGE_BYTES = 4 * CHUNK, VIDEO_BYTES = 20 * CHUNK, PENDING_BYTES = 40 * CHUNK, LIFETIME = 24 * 3600000, MAX_CHUNKS = 64;
const SHA = /^[a-f0-9]{64}$/, PREFIX = '/api/employee-profiles';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function fail(status, message) { const error = new Error(message); error.status = status; throw error; }
function object(value, allowed) { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) fail(400, '动态媒体参数无效'); return value; }

function createEmployeePostMedia({ runtime, live, transaction, audit, clock = Date.now, validateImage }) {
  const db = runtime.sqlite, bucket = runtime.env?.PROFILE_MEDIA_BUCKET, now = () => new Date(clock()).toISOString(), key = id => 'profile-media/' + id;
  function storage() { if (!bucket || ['put', 'get', 'delete'].some(method => typeof bucket[method] !== 'function')) fail(503, '个人动态媒体存储尚未接通，请联系管理员'); return bucket; }
  function owned(user, id, pending = true) {
    const actor = live(user), row = db.prepare('SELECT * FROM staff_post_uploads WHERE id=?').get(id);
    if (!row || row.staff_id !== actor.id) fail(404, '上传不存在');
    if (pending && (row.state !== 'pending' || row.expires_at <= now())) fail(409, '上传已结束或过期，请重新选择文件');
    return { actor, row };
  }
  function record(row) { return { id: row.id, kind: row.kind, mime: row.mime, byteLength: row.byte_length, width: row.width, height: row.height, sha256: row.sha256, ...(row.duration_ms !== null ? { durationMs: row.duration_ms } : {}), url: PREFIX + '/post-media/' + row.id }; }
  async function discardUnreferenced(id) {
    // Compensation only touches the new server UUID created by this operation.
    // Existing or attached object names are never taken from a client request.
    try { if (!db.prepare('SELECT 1 FROM staff_post_upload_chunks WHERE object_id=?').get(id) && !db.prepare('SELECT 1 FROM staff_post_media WHERE id=?').get(id)) await bucket.delete(key(id)); } catch { /* An orphan object has no public retrieval route. */ }
  }
  function bytes(stored, expected, maximum) {
    if (!stored || !(stored.body instanceof Uint8Array)) fail(502, '动态媒体文件缺失或无效');
    const value = Buffer.from(stored.body); if (value.length !== expected.byte_length || value.length > maximum || digest(value) !== expected.sha256) fail(502, '动态媒体文件校验失败'); return value;
  }
  function start(user, value) {
    live(user); const input = object(value, ['mime', 'byteLength', 'sha256']);
    if (!['image/png', 'image/jpeg', 'image/webp', 'video/mp4'].includes(input.mime) || !Number.isSafeInteger(input.byteLength) || input.byteLength < 1 || !SHA.test(input.sha256 || '')) fail(400, '请选择有效的动态图片或MP4文件');
    if (input.byteLength > (input.mime === 'video/mp4' ? VIDEO_BYTES : IMAGE_BYTES)) fail(413, input.mime === 'video/mp4' ? '视频文件最多20MiB' : '处理后的动态图片最多4MiB');
    storage();
    return transaction(() => {
      const current = live(user), createdAt = now();
      db.prepare("UPDATE staff_post_uploads SET state='expired' WHERE staff_id=? AND state='pending' AND expires_at<=?").run(current.id, createdAt);
      const reserved = db.prepare("SELECT count(*) AS count,coalesce(sum(declared_bytes),0) AS bytes FROM staff_post_uploads WHERE staff_id=? AND state='pending'").get(current.id);
      if (reserved.count >= 2 || reserved.bytes + input.byteLength > PENDING_BYTES) fail(429, '最多同时上传2个文件，请先完成或取消已有上传');
      const id = randomUUID(), expiresAt = new Date(clock() + LIFETIME).toISOString();
      db.prepare("INSERT INTO staff_post_uploads(id,staff_id,mime,declared_bytes,received_bytes,sha256,state,created_at,expires_at) VALUES(?,?,?,?,0,?,'pending',?,?)").run(id, current.id, input.mime, input.byteLength, input.sha256, createdAt, expiresAt);
      audit(current, 'upload.start', id, '已建立本人动态媒体上传；声明字节数' + input.byteLength);
      return { uploadId: id, chunkBytes: CHUNK, expiresAt };
    });
  }
  async function chunk(user, id, value) {
    const initial = owned(user, id), input = object(value, ['offset', 'bodyBase64', 'sha256']);
    if (!Number.isSafeInteger(input.offset) || input.offset < 0 || typeof input.bodyBase64 !== 'string' || input.bodyBase64.length > Math.ceil(CHUNK / 3) * 4 || !SHA.test(input.sha256 || '') || !/^[A-Za-z0-9+/]+={0,2}$/.test(input.bodyBase64) || input.bodyBase64.length % 4) fail(400, '媒体分片参数无效');
    const part = Buffer.from(input.bodyBase64, 'base64'); if (!part.length || part.length > CHUNK || part.toString('base64') !== input.bodyBase64 || digest(part) !== input.sha256) fail(400, '媒体分片编码或摘要无效');
    if (input.offset + part.length > initial.row.declared_bytes) fail(413, '媒体分片超出声明大小');
    function repeated(row) { const prior = db.prepare('SELECT * FROM staff_post_upload_chunks WHERE upload_id=? AND offset=?').get(id, input.offset); if (!prior || prior.byte_length !== part.length || prior.sha256 !== input.sha256) fail(409, '上传片段已变化，不能覆盖已有内容'); return { receivedBytes: row.received_bytes }; }
    if (input.offset < initial.row.received_bytes) return repeated(initial.row);
    if (input.offset !== initial.row.received_bytes) fail(409, '媒体分片顺序无效，请从当前进度继续');
    if (db.prepare('SELECT count(*) AS count FROM staff_post_upload_chunks WHERE upload_id=?').get(id).count >= MAX_CHUNKS) fail(413, '媒体分片数量超过限制，请重新上传');
    const target = randomUUID();
    try {
      await storage().put(key(target), part, { httpMetadata: { contentType: 'application/octet-stream' }, customMetadata: { purpose: 'staff-post-chunk', staffId: initial.actor.id, sha256: input.sha256 } });
      return transaction(() => {
        const { row } = owned(user, id); if (input.offset < row.received_bytes) return repeated(row);
        if (row.received_bytes !== input.offset || db.prepare('SELECT count(*) AS count FROM staff_post_upload_chunks WHERE upload_id=?').get(id).count >= MAX_CHUNKS) fail(409, '上传进度刚被更新');
        db.prepare('INSERT INTO staff_post_upload_chunks(upload_id,offset,object_id,byte_length,sha256) VALUES(?,?,?,?,?)').run(id, input.offset, target, part.length, input.sha256);
        const changed = db.prepare("UPDATE staff_post_uploads SET received_bytes=received_bytes+? WHERE id=? AND staff_id=? AND state='pending' AND received_bytes=?").run(part.length, id, initial.actor.id, input.offset); if (changed.changes !== 1) fail(409, '上传进度刚被更新');
        return { receivedBytes: input.offset + part.length };
      });
    } catch (error) { await discardUnreferenced(target); throw error; }
    finally { await discardUnreferenced(target); }
  }
  function inspect(value, mime) {
    if (mime === 'video/mp4') {
      if (value.length < 24 || value.toString('ascii', 4, 8) !== 'ftyp' || value.readUInt32BE(0) < 16 || value.readUInt32BE(0) > value.length) fail(400, 'MP4视频容器无效');
      // No metadata-only or extension-based pass: legal video/audio parsing and
      // real playback are a separate acceptance stage, not yet implemented.
      fail(415, '视频解析与播放尚未验收，当前请先发布文字或图片动态');
    }
    if (typeof validateImage !== 'function') fail(503, '动态图片校验尚未就绪');
    try { return { ...validateImage('data:' + mime + ';base64,' + value.toString('base64')), kind: 'image', durationMs: null }; }
    catch (error) { if ([400, 413].includes(error.status)) fail(error.status, '动态图片校验未通过：' + error.message.replace(/头像/g, '图片')); throw error; }
  }
  async function complete(user, id, value) {
    object(value, []); const initial = owned(user, id, false);
    if (initial.row.state === 'complete') { const done = db.prepare('SELECT * FROM staff_post_media WHERE id=? AND staff_id=?').get(initial.row.completed_media_id, initial.actor.id); if (!done) fail(502, '已完成媒体记录缺失'); return { media: record(done) }; }
    owned(user, id); if (initial.row.received_bytes !== initial.row.declared_bytes) fail(409, '文件尚未全部上传');
    const chunks = db.prepare('SELECT * FROM staff_post_upload_chunks WHERE upload_id=? ORDER BY offset').all(id), parts = []; let offset = 0;
    if (!chunks.length || chunks.length > MAX_CHUNKS) fail(502, '上传分片清单无效');
    for (const item of chunks) {
      if (item.offset !== offset || item.byte_length < 1 || item.byte_length > CHUNK || offset + item.byte_length > initial.row.declared_bytes) fail(502, '上传分片清单不完整');
      const stored = await storage().get(key(item.object_id)); const current = owned(user, id); if (current.row.received_bytes !== initial.row.declared_bytes || current.row.sha256 !== initial.row.sha256) fail(409, '上传内容刚被更新');
      parts.push(bytes(stored, item, CHUNK)); offset += item.byte_length;
    }
    if (offset !== initial.row.declared_bytes) fail(502, '上传分片总量无效');
    const body = Buffer.concat(parts); if (digest(body) !== initial.row.sha256) fail(400, '完整文件摘要与上传声明不一致');
    const image = inspect(body, initial.row.mime), mediaId = randomUUID();
    try {
      await storage().put(key(mediaId), body, { httpMetadata: { contentType: image.mime }, customMetadata: { purpose: 'staff-post-media', staffId: initial.actor.id, sha256: image.sha256 } });
      return transaction(() => {
        const { actor, row } = owned(user, id); if (row.received_bytes !== body.length || row.sha256 !== image.sha256) fail(409, '上传内容刚被更新');
        db.prepare("INSERT INTO staff_post_media(id,staff_id,upload_id,kind,mime,byte_length,sha256,width,height,duration_ms,state,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,'ready',?)").run(mediaId, actor.id, id, image.kind, image.mime, body.length, image.sha256, image.width, image.height, image.durationMs, now());
        const changed = db.prepare("UPDATE staff_post_uploads SET state='complete',completed_media_id=? WHERE id=? AND staff_id=? AND state='pending'").run(mediaId, id, actor.id); if (changed.changes !== 1) fail(409, '上传状态刚被更新');
        audit(actor, 'upload.complete', mediaId, '本人动态图片已校验完成，尚待发布关联'); return { media: record(db.prepare('SELECT * FROM staff_post_media WHERE id=?').get(mediaId)) };
      });
    } catch (error) { await discardUnreferenced(mediaId); throw error; }
  }
  function cancel(user, id, value) {
    object(value, []);
    return transaction(() => { const { actor, row } = owned(user, id, false); if (row.state === 'complete') fail(409, '已完成上传不能取消，请在动态中管理媒体'); if (row.state !== 'cancelled') { db.prepare("UPDATE staff_post_uploads SET state='cancelled' WHERE id=? AND staff_id=?").run(id, actor.id); audit(actor, 'upload.cancel', id, '已取消本人未发布媒体上传并释放预留额度'); } return { cancelled: true }; });
  }
  function visible(user, id) {
    const actor = live(user), row = db.prepare('SELECT m.*,p.staff_id AS post_staff_id,p.deleted_at,s.active AS author_active FROM staff_post_media m JOIN staff_posts p ON p.id=m.post_id JOIN staff_users s ON s.id=p.staff_id WHERE m.id=?').get(id);
    if (!row || row.state !== 'attached' || row.deleted_at || row.staff_id !== row.post_staff_id || !row.author_active && actor.role !== 'admin') fail(404, '动态媒体不存在'); return row;
  }
  async function content(user, id, parameters) {
    let row = visible(user, id);
    if ([...parameters.keys()].some(name => !['offset', 'length'].includes(name)) || parameters.getAll('offset').length > 1 || parameters.getAll('length').length > 1) fail(400, '媒体读取参数无效');
    const offsetText = parameters.get('offset') ?? '0', lengthText = parameters.get('length') ?? String(CHUNK);
    if (!/^(?:0|[1-9]\d{0,9})$/.test(offsetText) || !/^[1-9]\d{0,9}$/.test(lengthText)) fail(400, '媒体读取范围无效');
    const offset = Number(offsetText), length = Number(lengthText); if (length > CHUNK) fail(413, '每次最多读取1MiB媒体'); if (offset >= row.byte_length) fail(400, '媒体读取范围超出文件');
    const initial = row, stored = await storage().get(key(id)); row = visible(user, id);
    if (row.staff_id !== initial.staff_id || row.post_id !== initial.post_id || row.byte_length !== initial.byte_length || row.sha256 !== initial.sha256 || row.mime !== initial.mime) fail(409, '动态媒体已变化，请重新读取');
    const body = bytes(stored, row, row.kind === 'video' ? VIDEO_BYTES : IMAGE_BYTES), part = body.subarray(offset, Math.min(offset + length, body.length));
    return { bodyBase64: part.toString('base64'), offset, length: part.length, totalBytes: row.byte_length, sha256: row.sha256, mime: row.mime };
  }
  async function handle(user, id, operation, value) { if (!id && !operation) return start(user, value); if (operation === 'chunk') return chunk(user, id, value); if (operation === 'complete') return complete(user, id, value); if (operation === 'cancel') return cancel(user, id, value); fail(404, '媒体上传功能不存在'); }
  return { handle, content, record };
}
module.exports = { createEmployeePostMedia };

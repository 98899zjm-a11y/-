'use strict';
const { randomUUID, createHash } = require('node:crypto');
const { createEmployeePostMedia } = require('./employee-post-media.cjs');
const PREFIX = '/api/employee-profiles';
const UUID = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}', ID = new RegExp('^' + UUID + '$');
const POST = new RegExp('^' + PREFIX + '/(' + UUID + ')/posts$'), DELETE = new RegExp('^' + PREFIX + '/posts/(' + UUID + ')/delete$');
const UPLOAD = new RegExp('^' + PREFIX + '/post-uploads(?:/(' + UUID + ')/(chunk|complete|cancel))?$'), CONTENT = new RegExp('^' + PREFIX + '/post-media/(' + UUID + ')$');
function fail(status, message) { const error = new Error(message); error.status = status; throw error; }
function object(value, allowed) { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) fail(400, '动态参数无效'); return value; }
function text(value, maximum, label) { if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) fail(400, label + '格式或长度无效'); return value.trim(); }
function isEmployeePostPath(pathname) { return POST.test(pathname) || DELETE.test(pathname) || UPLOAD.test(pathname) || CONTENT.test(pathname); }

function createEmployeePosts({ runtime, administration, clock = Date.now, validateImage }) {
  const db = runtime.sqlite, now = () => new Date(clock()).toISOString();
  // user is supplied by the existing authenticated backend, never request body.
  // Every decision uses the current database row, including after async I/O.
  function live(user) { if (!user || typeof user.id !== 'string' || !ID.test(user.id)) fail(401, '请先登录公司账号'); const actor = db.prepare('SELECT id,name,role,active FROM staff_users WHERE id=?').get(user.id); if (!actor?.active) fail(401, '账号已停用，请重新登录'); return actor; }
  function transaction(action) { db.exec('BEGIN IMMEDIATE'); try { const result = action(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } }
  function staff(actor, id) { const row = db.prepare('SELECT id,active FROM staff_users WHERE id=?').get(id); if (!row || !row.active && actor.role !== 'admin') fail(404, '员工动态不存在'); return row; }
  function audit(actor, action, id, summary) { administration.noteAction(actor, { module: 'home', action: 'employee-post.' + action, label: ({ create: '发布个人动态', delete: '删除个人动态', 'upload.start': '开始上传动态媒体', 'upload.complete': '完成动态媒体上传', 'upload.cancel': '取消动态媒体上传' })[action] || '个人动态操作', resource: id, summary }); }
  const media = createEmployeePostMedia({ runtime, live, transaction, audit, clock, validateImage });
  function record(row, actor) {
    return { id: row.id, staffId: row.staff_id, authorName: row.author_name, text: row.text, media: db.prepare("SELECT * FROM staff_post_media WHERE post_id=? AND state='attached' ORDER BY rowid").all(row.id).map(media.record), revision: row.revision, createdAt: row.created_at, canDelete: actor.id === row.staff_id || actor.role === 'admin' };
  }
  function paging(parameters) {
    if ([...parameters.keys()].some(key => !['limit', 'before'].includes(key)) || parameters.getAll('limit').length > 1 || parameters.getAll('before').length > 1) fail(400, '动态分页参数无效');
    const raw = parameters.get('limit') ?? '20'; if (!/^(?:[1-9]|1\d|20)$/.test(raw)) fail(400, '每页动态须为1至20条');
    let cursor = null; const before = parameters.get('before');
    if (before !== null) {
      if (before.length > 256 || !/^[A-Za-z0-9_-]+$/.test(before)) fail(400, '动态游标无效');
      const bytes = Buffer.from(before, 'base64url'); if (bytes.toString('base64url') !== before) fail(400, '动态游标编码无效');
      try { cursor = JSON.parse(bytes.toString('utf8')); } catch { fail(400, '动态游标无效'); }
      if (!Array.isArray(cursor) || cursor.length !== 2 || typeof cursor[0] !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(cursor[0]) || !Number.isFinite(Date.parse(cursor[0])) || typeof cursor[1] !== 'string' || !ID.test(cursor[1])) fail(400, '动态游标无效');
    }
    return { limit: Number(raw), cursor };
  }
  function list(user, id, parameters) {
    const actor = live(user); staff(actor, id); const { limit, cursor } = paging(parameters);
    const args = [id], condition = cursor ? ' AND (created_at<? OR (created_at=? AND id<?))' : '';
    if (cursor) args.push(cursor[0], cursor[0], cursor[1]); args.push(limit + 1);
    const rows = db.prepare('SELECT * FROM staff_posts WHERE staff_id=? AND deleted_at IS NULL' + condition + ' ORDER BY created_at DESC,id DESC LIMIT ?').all(...args), visible = rows.slice(0, limit), last = visible.at(-1);
    return { posts: visible.map(row => record(row, actor)), nextCursor: rows.length > limit ? Buffer.from(JSON.stringify([last.created_at, last.id])).toString('base64url') : null };
  }
  function create(user, id, value) {
    const actor = live(user); if (actor.id !== id) fail(403, '只能在本人的主页发布动态');
    const input = object(value, ['text', 'mediaIds', 'clientRequestId']), body = text(input.text, 3000, '动态正文');
    if (!Array.isArray(input.mediaIds) || input.mediaIds.length > 9 || input.mediaIds.some(mediaId => typeof mediaId !== 'string' || !ID.test(mediaId)) || new Set(input.mediaIds).size !== input.mediaIds.length || typeof input.clientRequestId !== 'string' || !ID.test(input.clientRequestId) || !body && !input.mediaIds.length) fail(400, '请填写动态文字或选择本人上传的媒体');
    const digest = createHash('sha256').update(JSON.stringify({ text: body, mediaIds: input.mediaIds })).digest('hex');
    return transaction(() => {
      const currentActor = live(user); if (currentActor.id !== id) fail(403, '只能发布自己的动态');
      const prior = db.prepare('SELECT * FROM staff_posts WHERE staff_id=? AND client_request_id=?').get(id, input.clientRequestId);
      if (prior) { if (prior.payload_hash !== digest || prior.deleted_at) fail(409, '此发布标识已用于其它内容或已删除的动态'); return { post: record(prior, currentActor), duplicate: true }; }
      const attachments = input.mediaIds.map(mediaId => { const asset = db.prepare('SELECT * FROM staff_post_media WHERE id=?').get(mediaId); if (!asset || asset.staff_id !== id) fail(404, '动态媒体不存在'); if (asset.state !== 'ready' || asset.post_id) fail(409, '媒体已被使用，请重新选择'); return asset; });
      if (attachments.some(asset => asset.kind === 'video') && (attachments.length !== 1 || attachments[0].kind !== 'video')) fail(400, '每条动态请选择最多9张图片或1段视频，不能混合');
      const postId = randomUUID(), createdAt = now();
      db.prepare('INSERT INTO staff_posts(id,staff_id,author_name,text,revision,client_request_id,payload_hash,created_at) VALUES(?,?,?,?,1,?,?,?)').run(postId, id, currentActor.name, body, input.clientRequestId, digest, createdAt);
      for (const asset of attachments) { const changed = db.prepare("UPDATE staff_post_media SET state='attached',post_id=? WHERE id=? AND staff_id=? AND state='ready' AND post_id IS NULL").run(postId, asset.id, id); if (changed.changes !== 1) fail(409, '媒体归属刚被更新，请重新选择'); }
      audit(currentActor, 'create', postId, '个人动态已发布；媒体数' + attachments.length + '；不读取客户或财务明细');
      return { post: record(db.prepare('SELECT * FROM staff_posts WHERE id=?').get(postId), currentActor), duplicate: false };
    });
  }
  function remove(user, id, value) {
    const input = object(value, ['revision', 'reason']); if (!Number.isSafeInteger(input.revision) || input.revision < 0) fail(400, '请提供当前动态版本');
    const reason = input.reason === undefined ? '' : text(input.reason, 300, '管理原因');
    return transaction(() => {
      const actor = live(user), row = db.prepare('SELECT * FROM staff_posts WHERE id=?').get(id); if (!row || actor.id !== row.staff_id && actor.role !== 'admin') fail(404, '动态不存在');
      if (row.deleted_at) return { id, deleted: true, revision: row.revision };
      if (row.revision !== input.revision) fail(409, '动态已更新，请刷新后操作');
      const changed = db.prepare('UPDATE staff_posts SET deleted_at=?,deleted_by=?,delete_reason=?,revision=revision+1 WHERE id=? AND deleted_at IS NULL AND revision=?').run(now(), actor.id, reason, id, input.revision); if (changed.changes !== 1) fail(409, '动态状态刚被更新');
      db.prepare("UPDATE staff_post_media SET state='deleted' WHERE post_id=? AND state='attached'").run(id);
      audit(actor, 'delete', id, '动态已从公开主页移除；原媒体保留于受控备份范围'); return { id, deleted: true, revision: row.revision + 1 };
    });
  }
  async function handle(user, input) {
    live(user); const url = new URL(input.path, 'http://offline.invalid'), method = String(input.method || 'GET').toUpperCase(), endpoint = url.pathname;
    if (url.origin !== 'http://offline.invalid' || input.path !== endpoint + url.search || /%2f|%5c|%00|\\/i.test(input.path)) fail(400, '动态请求地址无效');
    const profile = POST.exec(endpoint), deletion = DELETE.exec(endpoint), upload = UPLOAD.exec(endpoint), content = CONTENT.exec(endpoint); let data;
    if (url.search && !(profile && method === 'GET' || content && method === 'GET')) fail(400, '此动态操作不接受查询参数');
    if (profile && method === 'GET') data = list(user, profile[1], url.searchParams);
    else if (profile && method === 'POST') data = create(user, profile[1], input.body);
    else if (deletion && method === 'POST') data = remove(user, deletion[1], input.body);
    else if (upload && method === 'POST') data = await media.handle(user, upload[1], upload[2], input.body);
    else if (content && method === 'GET') data = await media.content(user, content[1], url.searchParams);
    else fail(404, '个人动态功能不存在');
    return { ok: true, status: 200, data };
  }
  return { handle };
}
module.exports = { createEmployeePosts, isEmployeePostPath };

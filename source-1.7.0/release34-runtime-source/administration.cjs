'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { CAPABILITIES: ERP_CAPABILITIES } = require('./erp-policy.cjs');
const LEVELS = Object.freeze(['disabled', 'view', 'operate', 'manage']);
const MODULES = Object.freeze([{ id: 'sales', label: '销售报价' }, { id: 'ledger', label: '财务系统' }, { id: 'inventory', label: '库管管理' }]);
const CAPABILITIES = Object.freeze([
  { key: 'messages.post', label: '发布留言', module: 'home', level: 'view', description: '发布及删除自己的留言', default: true },
  { key: 'messages.moderate', label: '管理留言板', module: 'home', level: 'view', description: '删除其他员工的留言', default: false },
  { key: 'notes.use', label: '私人备忘录', module: 'home', level: 'view', description: '仅查看和编辑本人的备忘录', default: true },
  { key: 'inventory.reports.create', label: '生成库存汇报', module: 'inventory', level: 'operate', description: '从库管生成只读汇报快照', default: false },
  { key: 'inventory.reports.review', label: '审核库存汇报', module: 'ledger', level: 'operate', description: '人工审核收录；不生成财务凭证', default: false },
  { key: 'sales.publications.prepare', label: '编制个人销售表', module: 'ledger', level: 'operate', description: '从内帐读取月度销售并手动绑定员工', default: false },
  { key: 'sales.publications.publish', label: '核对发布个人销售表', module: 'ledger', level: 'operate', description: '核对后发布不可变版本', default: false },
  { key: 'personal.sales.view', label: '查看个人销售报表', module: 'home', level: 'view', description: '员工仅查看本人已发布数据', default: true },
  { key: 'personal.sales.profit', label: '查看已发布利润数据', module: 'home', level: 'view', description: '需另有个人销售查看权限且本期来源提供利润', default: false },
  ...ERP_CAPABILITIES,
]);
const cached = new WeakMap();
const safeText = value => String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[API密钥已省略]').replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, '[授权内容已省略]').replace(/(?:password|密码|token|cookie|authorization|密钥)\s*[:=]\s*[^\s,;]+/gi, '[敏感内容已省略]').replace(/\b\d{12,19}\b/g, '[长号码已省略]').slice(0, 500);
function fail(status, message) { const error = new Error(message); error.status = status; throw error; }
function object(input) { if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, '操作参数格式无效'); return input; }
function integer(value, fallback, maximum) { const result = value === undefined || value === null || value === '' ? fallback : Number(value); if (!Number.isInteger(result) || result < 1 || result > maximum) fail(400, '分页参数无效'); return result; }
function dateBoundary(value, end) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) fail(400, '日期须为年月日格式');
  const day = new Date(value + 'T00:00:00.000Z');
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== value) fail(400, '日期无效');
  return new Date(day.getTime() - 8 * 3600000 + (end ? 86400000 : 0)).toISOString();
}
const CLIENT_META_PREFIX = 'client-versions:v1:', CLIENT_META_BYTES = 64 * 1024, CLIENT_META_DEVICES = 32;
const CLIENT_UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function clientVersionInput(value) {
  const input = object(value), keys = ['schemaVersion', 'deviceId', 'kind', 'clientVersion', 'versionSource'];
  if (Object.keys(input).length !== keys.length || Object.keys(input).some(key => !keys.includes(key)) || input.schemaVersion !== 1 ||
      typeof input.deviceId !== 'string' || input.deviceId.length !== 36 || !CLIENT_UUID.test(input.deviceId) || typeof input.clientVersion !== 'string' || input.clientVersion.trim() !== input.clientVersion || !/^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/.test(input.clientVersion) ||
      !['desktop', 'web'].includes(input.kind) || input.versionSource !== (input.kind === 'web' ? 'host-web' : 'local-app')) fail(400, '客户端版本上报格式无效');
  return { deviceId: input.deviceId.toLowerCase(), kind: input.kind, clientVersion: input.clientVersion, versionSource: input.versionSource };
}

function createAdministration({ runtime, clock = Date.now } = {}) {
  const db = runtime.sqlite;
  // Standalone auth tests/older prepared migration directories remain usable.
  db.exec(fs.readFileSync(path.join(__dirname, 'migrations', '0004_module_administration.sql'), 'utf8'));
  db.exec(fs.readFileSync(path.join(__dirname, 'migrations', '0005_workspace_collaboration.sql'), 'utf8'));
  const now = () => new Date(clock()).toISOString();
  const heartbeats = new Map();
  const clientSessions = new Map();
  function clientRegistry(staffId) {
    try {
      const row = db.prepare('SELECT value FROM administration_meta WHERE name=?').get(CLIENT_META_PREFIX + staffId);
      if (!row) return { raw: null, devices: [], warning: null };
      if (typeof row.value !== 'string' || Buffer.byteLength(row.value, 'utf8') > CLIENT_META_BYTES) throw Error('Invalid client metadata');
      const data = JSON.parse(row.value);
      if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length !== 2 || Object.keys(data).some(key => !['schemaVersion', 'devices'].includes(key)) || data.schemaVersion !== 1 || !Array.isArray(data.devices) || data.devices.length > CLIENT_META_DEVICES) throw Error('Unknown client metadata');
      const seen = new Set(), devices = data.devices.map(item => {
        if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).length !== 5 || Object.keys(item).some(key => !['deviceId', 'kind', 'clientVersion', 'versionSource', 'lastReportedAt'].includes(key))) throw Error('Unknown client record');
        const client = clientVersionInput({ schemaVersion: 1, deviceId: item.deviceId, kind: item.kind, clientVersion: item.clientVersion, versionSource: item.versionSource });
        if (seen.has(client.deviceId) || typeof item.lastReportedAt !== 'string' || !Number.isFinite(Date.parse(item.lastReportedAt)) || new Date(item.lastReportedAt).toISOString() !== item.lastReportedAt) throw Error('Invalid client record');
        seen.add(client.deviceId); return { ...client, lastReportedAt: item.lastReportedAt };
      });
      return { raw: row.value, devices, warning: null };
    } catch { return { raw: null, devices: [], warning: 'CLIENT_METADATA_UNAVAILABLE' }; }
  }
  function saveClientVersion(staffId, client) {
    const current = clientRegistry(staffId);
    if (current.warning) return { accepted: false, code: current.warning };
    const devices = [...current.devices], index = devices.findIndex(item => item.deviceId === client.deviceId);
    if (index < 0 && devices.length >= CLIENT_META_DEVICES) return { accepted: false, code: 'CLIENT_DEVICE_LIMIT' };
    const report = { ...client, lastReportedAt: now() };
    if (index < 0) devices.push(report); else devices[index] = report;
    const value = JSON.stringify({ schemaVersion: 1, devices });
    if (Buffer.byteLength(value, 'utf8') > CLIENT_META_BYTES) return { accepted: false, code: 'CLIENT_METADATA_LIMIT' };
    try {
      // Compare-and-set keeps a concurrent writer's valid registry intact.
      const result = current.raw === null ? db.prepare('INSERT OR IGNORE INTO administration_meta(name,value) VALUES(?,?)').run(CLIENT_META_PREFIX + staffId, value) : db.prepare('UPDATE administration_meta SET value=? WHERE name=? AND value=?').run(value, CLIENT_META_PREFIX + staffId, current.raw);
      return result.changes === 1 || result.changes === 1n ? { accepted: true } : { accepted: false, code: 'CLIENT_METADATA_CHANGED' };
    } catch { return { accepted: false, code: 'CLIENT_METADATA_UNAVAILABLE' }; }
  }
  function requireAdmin(user) { if (!user?.active) fail(401, '请先登录账号'); const current = db.prepare('SELECT role,active FROM staff_users WHERE id=?').get(user.id); if (!current?.active || current.role !== 'admin') fail(403, '只有总管理员可以使用此功能'); }
  function access(user) {
    const current = db.prepare('SELECT role,active FROM staff_users WHERE id=?').get(user.id);
    if (!current) fail(404, '账号不存在');
    db.prepare("INSERT OR IGNORE INTO module_permissions(staff_id,sales,ledger,inventory,revision,updated_at) VALUES(?,'operate','disabled','disabled',1,?)").run(user.id, now());
    const row = db.prepare('SELECT * FROM module_permissions WHERE staff_id=?').get(user.id);
    const saved = db.prepare('SELECT data FROM staff_capabilities WHERE staff_id=?').get(user.id);
    const configured = saved ? JSON.parse(saved.data) : {};
    const capabilities = Object.fromEntries(CAPABILITIES.map(item => [item.key, current.role === 'admin' || (typeof configured[item.key] === 'boolean' ? configured[item.key] : item.default)]));
    return { moduleAccess: current.role === 'admin' ? { sales: 'manage', ledger: 'manage', inventory: 'manage' } : { sales: row.sales, ledger: row.ledger, inventory: row.inventory }, grantRevision: row.revision, capabilities };
  }
  function decorate(user) { return { ...user, ...access(user) }; }
  function requireAccess(user, module, level = 'view') {
    if (!MODULES.some(item => item.id === module) || !LEVELS.includes(level)) fail(400, '模块或权限级别无效');
    if (!db.prepare('SELECT active FROM staff_users WHERE id=?').get(user.id)?.active) fail(401, '账号已停用，请重新登录');
    const granted = access(user);
    if (LEVELS.indexOf(granted.moduleAccess[module]) < LEVELS.indexOf(level)) fail(403, granted.moduleAccess[module] === 'disabled' ? '管理员尚未授权此模块' : '当前账号只有查看权限，不能执行此操作');
    return granted;
  }
  function requireCapability(user, key, { readOnly = false } = {}) {
    const capability = CAPABILITIES.find(item => item.key === key); if (!capability) fail(400, '未知的操作能力');
    if (!db.prepare('SELECT active FROM staff_users WHERE id=?').get(user.id)?.active) fail(401, '账号已停用，请重新登录');
    const granted = access(user);
    if (!granted.capabilities[key]) fail(403, '管理员尚未授权此操作能力');
    if (capability.module !== 'home') requireAccess(user, capability.module, readOnly ? 'view' : capability.level);
    return granted;
  }
  function capabilitySettings(user, listUsers) {
    const current = db.prepare('SELECT role,active FROM staff_users WHERE id=?').get(user.id); if (!current?.active) fail(401, '请先登录账号');
    return { catalog: CAPABILITIES.map(({ default: initial, ...item }) => ({ ...item, default: initial })), capabilities: access(user).capabilities, user: decorate(user), users: current.role === 'admin' ? listUsers().map(decorate) : [] };
  }
  function updateCapabilities(user, value, listUsers) {
    requireAdmin(user); const input = object(value);
    if (Object.keys(input).some(key => !['staffId', 'capabilities'].includes(key)) || typeof input.staffId !== 'string') fail(400, '能力权限参数无效');
    const target = db.prepare('SELECT id,role,active FROM staff_users WHERE id=?').get(input.staffId); if (!target) fail(404, '员工不存在');
    const patch = object(input.capabilities);
    if (!Object.keys(patch).length || Object.keys(patch).some(key => !CAPABILITIES.some(item => item.key === key) || typeof patch[key] !== 'boolean')) fail(400, '操作能力无效');
    if (target.role === 'admin' && Object.values(patch).some(value => !value)) fail(400, '总管理员的操作能力不能撤销');
    const previous = access(target), changed = { ...previous.capabilities, ...patch };
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('INSERT INTO staff_capabilities(staff_id,data,updated_at) VALUES(?,?,?) ON CONFLICT(staff_id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at').run(target.id, JSON.stringify(changed), now());
      db.prepare('UPDATE module_permissions SET revision=revision+1,updated_at=? WHERE staff_id=?').run(now(), target.id);
      noteAction(user, { module: 'system', action: 'capabilities.update', label: '调整员工操作能力', resource: target.id, summary: Object.keys(patch).map(key => CAPABILITIES.find(item => item.key === key).label + '：' + (changed[key] ? '允许' : '禁止')).join('；') });
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return { user: decorate(listUsers().find(item => item.id === target.id)) };
  }
  function noteAction(user, input) {
    const module = ['sales', 'ledger', 'inventory', 'home', 'system'].includes(input.module) ? input.module : 'system';
    const status = Number.isInteger(input.status) ? input.status : 200;
    const row = { id: input.id || randomUUID(), createdAt: now(), actorId: user?.id || null, actorName: safeText(user?.name || '未登录账号'), module,
      action: safeText(input.action || 'operation'), label: safeText(input.label || '操作'), resource: safeText(input.resource || ''), success: typeof input.success === 'boolean' ? input.success : status >= 200 && status < 400, status, summary: safeText(input.summary || '') };
    db.prepare('INSERT OR IGNORE INTO operation_logs(id,created_at,actor_id,actor_name,module,action,label,resource,success,status,summary) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(row.id, row.createdAt, row.actorId, row.actorName, row.module, row.action, row.label, row.resource, row.success ? 1 : 0, row.status, row.summary);
    return row;
  }
  function noteReloginAttempt({ operationId, initiator, usageSessionId, status, verifiedUser }) {
    const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
    const success = status === 200;
    if (!uuid.test(operationId || '') || typeof initiator?.id !== 'string' || !initiator.id || !uuid.test(usageSessionId || '') || !Number.isInteger(status) || status !== 200 && (status < 400 || status > 599) || success && (typeof verifiedUser?.id !== 'string' || !verifiedUser.id) || !success && verifiedUser) throw new TypeError('Invalid internal relogin audit');
    const priorUsage = db.prepare('SELECT staff_id FROM usage_sessions WHERE id=?').get(usageSessionId);
    if (priorUsage?.staff_id !== initiator.id) throw new Error('Relogin usage ownership does not match its captured initiator');
    const actor = success ? verifiedUser : initiator, actorName = safeText(actor.name || '未登录账号'), initiatorName = safeText(initiator.name || '未登录账号');
    const oldValue = JSON.stringify({ usageSessionId }), newValue = JSON.stringify({ status, success, verifiedStaffId: success ? verifiedUser.id : null });
    db.exec('BEGIN IMMEDIATE');
    try {
      const previous = db.prepare('SELECT * FROM operation_logs WHERE id=?').get(operationId);
      const links = db.prepare("SELECT * FROM audit_logs WHERE entity_type='auth-relogin' AND entity_id=?").all(operationId);
      if (previous || links.length) {
        if (!previous || links.length !== 1 || previous.action !== 'auth.login' || previous.resource !== '/auth/login' || previous.actor_id !== actor.id || previous.actor_name !== actorName || previous.status !== status || Boolean(previous.success) !== success || links[0].action !== 'auth.relogin-attempt' || links[0].actor_id !== initiator.id || links[0].actor_name !== initiatorName || links[0].old_value !== oldValue || links[0].new_value !== newValue) throw new Error('Conflicting relogin audit record');
        db.exec('COMMIT'); return previous;
      }
      const operation = noteAction(actor, { id: operationId, module: 'system', action: 'auth.login', label: success ? '登录成功' : '登录失败', resource: '/auth/login', status, success, summary: success ? '请求已完成' : '请求被拒绝或未完成' });
      const stored = db.prepare('SELECT * FROM operation_logs WHERE id=?').get(operationId);
      if (!stored || stored.action !== 'auth.login' || stored.resource !== '/auth/login' || stored.actor_id !== actor.id || stored.actor_name !== actorName || stored.status !== status || Boolean(stored.success) !== success) throw new Error('Relogin operation was not stored consistently');
      db.prepare('INSERT INTO audit_logs(id,entity_type,entity_id,action,actor_id,actor_name,old_value,new_value,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(randomUUID(), 'auth-relogin', operationId, 'auth.relogin-attempt', initiator.id, initiatorName, oldValue, newValue, now());
      const storedLinks = db.prepare("SELECT * FROM audit_logs WHERE entity_type='auth-relogin' AND entity_id=?").all(operationId);
      if (storedLinks.length !== 1 || storedLinks[0].action !== 'auth.relogin-attempt' || storedLinks[0].actor_id !== initiator.id || storedLinks[0].actor_name !== initiatorName || storedLinks[0].old_value !== oldValue || storedLinks[0].new_value !== newValue) throw new Error('Relogin association was not stored consistently');
      db.exec('COMMIT'); return operation;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  if (!db.prepare("SELECT value FROM administration_meta WHERE name='legacy-audits-imported'").get()) {
    const labels = { create: '保存', update: '修改', delete: '删除', 'confirm-sale': '确认成交', 'cancel-sale': '撤销成交', 'local-setup': '创建管理员', 'local-create': '新增员工', 'local-update': '修改员工', 'local-update-password': '重置员工密码', 'attach-images': '保存报价图片', 'attach-image-page': '保存报价图片页' };
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const old of db.prepare('SELECT id,entity_type,entity_id,action,actor_id,actor_name,created_at FROM audit_logs').all()) {
        db.prepare('INSERT OR IGNORE INTO operation_logs(id,created_at,actor_id,actor_name,module,action,label,resource,success,status,summary) VALUES(?,?,?,?,?,?,?,?,1,200,?)').run('legacy:' + old.id, old.created_at, old.actor_id, safeText(old.actor_name), 'sales', 'legacy.' + safeText(old.action), '历史记录：' + (labels[old.action] || '业务操作'), safeText(old.entity_type + ':' + old.entity_id), '由旧版审计记录导入；未复制原始业务内容');
      }
      db.prepare("INSERT INTO administration_meta(name,value) VALUES('legacy-audits-imported',?)").run(now()); db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  // A restarted process cannot prove that an old session remains online.
  db.prepare("UPDATE usage_sessions SET ended_at=last_seen,ended_reason='host-restarted' WHERE ended_at IS NULL").run();
  function listPermissions(user, listUsers) { requireAdmin(user); return { users: listUsers().map(decorate), levels: [...LEVELS], modules: MODULES.map(item => ({ ...item })) }; }
  function updatePermissions(user, value, listUsers) {
    requireAdmin(user); const input = object(value);
    if (Object.keys(input).some(key => !['staffId', 'moduleAccess'].includes(key)) || typeof input.staffId !== 'string') fail(400, '请选择员工和模块权限');
    const target = db.prepare('SELECT id,role,active,name FROM staff_users WHERE id=?').get(input.staffId);
    if (!target) fail(404, '员工不存在');
    const patch = object(input.moduleAccess);
    if (!Object.keys(patch).length || Object.keys(patch).some(key => !MODULES.some(module => module.id === key) || !LEVELS.includes(patch[key]))) fail(400, '模块权限无效');
    if (target.role === 'admin' && Object.values(patch).some(level => level !== 'manage')) fail(400, '总管理员的模块管理权限不能降级');
    const old = access(target), changed = { ...old.moduleAccess, ...patch };
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('UPDATE module_permissions SET sales=?,ledger=?,inventory=?,revision=revision+1,updated_at=? WHERE staff_id=?').run(changed.sales, changed.ledger, changed.inventory, now(), target.id);
      noteAction(user, { module: 'system', action: 'permissions.update', label: '调整员工模块权限', resource: target.id, summary: MODULES.map(module => `${module.label}：${old.moduleAccess[module.id]}→${changed[module.id]}`).join('；') });
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return { user: decorate(listUsers().find(item => item.id === target.id)) };
  }
  function startSession(id, user) {
    const savepoint = 'usage_start_' + randomUUID().replace(/-/g, '');
    db.exec('SAVEPOINT ' + savepoint);
    try {
      const matches = row => row && row.id === id && row.staff_id === user.id && row.ended_at === null;
      const previous = db.prepare('SELECT id,staff_id,ended_at FROM usage_sessions WHERE id=?').get(id);
      if (previous) {
        if (!matches(previous)) fail(500, '使用会话身份不一致，未完成登录');
      } else {
        const result = db.prepare('INSERT OR IGNORE INTO usage_sessions(id,staff_id,started_at,last_seen,last_module,active) VALUES(?,?,?,?,?,0)').run(id, user.id, now(), now(), 'home');
        const stored = db.prepare('SELECT id,staff_id,ended_at FROM usage_sessions WHERE id=?').get(id);
        if ((result.changes !== 1 && result.changes !== 1n) || !matches(stored)) fail(500, '使用会话未能保存，未完成登录');
      }
      db.exec('RELEASE SAVEPOINT ' + savepoint);
    } catch (error) {
      try { db.exec('ROLLBACK TO SAVEPOINT ' + savepoint); }
      catch (rollbackError) { throw new AggregateError([error, rollbackError], '使用会话未能回退，请联系管理员'); }
      try { db.exec('RELEASE SAVEPOINT ' + savepoint); }
      catch (releaseError) { throw new AggregateError([error, releaseError], '使用会话回退后未能释放，请联系管理员'); }
      throw error;
    }
  }
  function touch(id, user, module = 'home', active = true) {
    if (!db.prepare('SELECT active FROM staff_users WHERE id=?').get(user.id)?.active) { endSession(id, user, 'disabled'); fail(401, '账号已停用，请重新登录'); }
    let previous = db.prepare('SELECT * FROM usage_sessions WHERE id=?').get(id);
    if (!previous) { startSession(id, user); previous = db.prepare('SELECT * FROM usage_sessions WHERE id=?').get(id); }
    if (previous.ended_at || previous.staff_id !== user.id) fail(401, '账号会话已经结束');
    const currentTime = clock(), elapsed = (currentTime - Date.parse(previous.last_seen)) / 1000;
    const seconds = elapsed > 0 && elapsed <= 90 ? Math.min(elapsed, 60) : 0;
    if (seconds) db.prepare('INSERT INTO usage_intervals(session_id,staff_id,started_at,ended_at,online_seconds,active_seconds) VALUES(?,?,?,?,?,?)').run(id, user.id, new Date(currentTime - seconds * 1000).toISOString(), now(), seconds, previous.active && active ? seconds : 0);
    db.prepare('UPDATE usage_sessions SET last_seen=?,last_module=?,active=? WHERE id=?').run(now(), module, active ? 1 : 0, id);
  }
  function endSession(id, user, reason = 'logout') {
    clientSessions.delete(id);
    const row = db.prepare('SELECT * FROM usage_sessions WHERE id=? AND ended_at IS NULL').get(id); if (!row) return;
    db.prepare('UPDATE usage_sessions SET ended_at=?,ended_reason=? WHERE id=?').run(now(), reason, id);
    heartbeats.delete(id);
    noteAction(user, { module: 'home', action: reason === 'logout' ? 'auth.logout' : 'auth.session-ended', label: reason === 'logout' ? '退出登录' : '会话结束', status: 200, summary: ['timeout', 'disabled', 'password-reset'].includes(reason) ? reason : '' });
  }
  function reportHeartbeat(id, user, value) {
    const input = object(value);
    if (Object.keys(input).some(key => !['module', 'active', 'client'].includes(key)) || !['sales', 'ledger', 'inventory', 'home'].includes(input.module) || typeof input.active !== 'boolean') fail(400, '使用状态格式无效');
    const client = input.client === undefined ? null : clientVersionInput(input.client);
    if (input.module !== 'home') requireAccess(user, input.module);
    if (heartbeats.has(id) && clock() - heartbeats.get(id) < 15000) return { accepted: false, intervalSeconds: 30, clientMetadataVersion: 1 };
    heartbeats.set(id, clock());
    touch(id, user, input.module, input.active);
    if (!client) return { accepted: true, intervalSeconds: 30, clientMetadataVersion: 1 };
    const saved = saveClientVersion(user.id, client);
    if (saved.accepted) clientSessions.set(id, { staffId: user.id, deviceId: client.deviceId });
    return { accepted: true, intervalSeconds: 30, clientMetadataVersion: 1, clientMetadataAccepted: saved.accepted, ...(saved.code ? { clientMetadataCode: saved.code } : {}) };
  }
  function range(parameters) {
    const today = new Date(clock() + 8 * 3600000).toISOString().slice(0, 10);
    const from = parameters.get('from') || today.slice(0, 7) + '-01', to = parameters.get('to') || today;
    const start = dateBoundary(from, false), end = dateBoundary(to, true);
    if (start >= end || Date.parse(end) - Date.parse(start) > 366 * 86400000) fail(400, '请选择不超过一年的有效日期范围');
    return { from, to, start, end };
  }
  function operationLogs(user, parameters) {
    requireAdmin(user); const { start, end } = range(parameters);
    importPollAudits();
    const page = integer(parameters.get('page'), 1, 100000), pageSize = integer(parameters.get('pageSize'), 50, 100);
    const where = ['created_at>=?', 'created_at<?'], args = [start, end];
    const q = parameters.get('q') || ''; if (q.length > 120) fail(400, '搜索内容过长');
    if (q) { where.push('(actor_name LIKE ? ESCAPE \'\\\' OR label LIKE ? ESCAPE \'\\\' OR summary LIKE ? ESCAPE \'\\\')'); const match = '%' + q.replace(/[\\%_]/g, '\\$&') + '%'; args.push(match, match, match); }
    for (const [field, column] of [['module', 'module'], ['staffId', 'actor_id']]) { const value = parameters.get(field); if (value) { if (value.length > 120) fail(400, '筛选参数无效'); where.push(column + '=?'); args.push(value); } }
    const action = parameters.get('action'); if (action) { if (action.length > 80) fail(400, '操作筛选无效'); where.push('(action LIKE ? ESCAPE \'\\\' OR label LIKE ? ESCAPE \'\\\')'); const match = '%' + action.replace(/[\\%_]/g, '\\$&') + '%'; args.push(match, match); }
    const filter = where.join(' AND '), count = db.prepare('SELECT count(*) AS total,coalesce(sum(success),0) AS succeeded FROM operation_logs WHERE ' + filter).get(...args);
    const logs = db.prepare('SELECT * FROM operation_logs WHERE ' + filter + ' ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?').all(...args, pageSize, (page - 1) * pageSize).map(row => ({ id: row.id, createdAt: row.created_at, actorId: row.actor_id, actorName: row.actor_name, module: row.module, action: row.action, label: row.label, resource: row.resource, success: Boolean(row.success), status: row.status, summary: row.summary }));
    return { logs, total: count.total, page, pageSize, summary: { total: count.total, success: count.succeeded, failed: count.total - count.succeeded }, staffOptions: db.prepare('SELECT s.id,s.name,a.username FROM staff_users s LEFT JOIN local_accounts a ON a.staff_id=s.id ORDER BY s.name').all().map(row => ({ staffId: row.id, name: row.name, username: row.username || '' })) };
  }
  function usage(user, parameters) {
    requireAdmin(user); const period = range(parameters), startMs = Date.parse(period.start), endMs = Date.parse(period.end);
    importPollAudits();
    const staff = db.prepare('SELECT s.id,s.name,s.active,a.username FROM staff_users s LEFT JOIN local_accounts a ON a.staff_id=s.id ORDER BY s.name').all();
    const activeStaff = new Set(staff.filter(row => row.active).map(row => row.id));
    const employees = staff.map(row => { const registry = clientRegistry(row.id); return { staffId: row.id, name: row.name, username: row.username || '', online: false, lastSeen: null, lastModule: 'home', onlineSeconds: 0, activeSeconds: 0, loginCount: 0, actionCount: 0, clients: registry.devices, unreportedSessions: 0, clientMetadataWarning: registry.warning }; });
    const byId = new Map(employees.map(item => [item.staffId, item]));
    for (const interval of db.prepare('SELECT * FROM usage_intervals WHERE ended_at>? AND started_at<?').all(period.start, period.end)) {
      const target = byId.get(interval.staff_id); if (!target) continue;
      const duration = Date.parse(interval.ended_at) - Date.parse(interval.started_at), overlap = Math.max(0, Math.min(endMs, Date.parse(interval.ended_at)) - Math.max(startMs, Date.parse(interval.started_at)));
      if (duration > 0) { target.onlineSeconds += interval.online_seconds * overlap / duration; target.activeSeconds += interval.active_seconds * overlap / duration; }
    }
    for (const row of db.prepare('SELECT * FROM usage_sessions ORDER BY last_seen ASC').all()) {
      const target = byId.get(row.staff_id); if (!target) continue;
      target.lastSeen = row.last_seen; target.lastModule = row.last_module;
      if (activeStaff.has(row.staff_id) && !row.ended_at && clock() - Date.parse(row.last_seen) <= 90000) {
        target.online = true;
        const reported = clientSessions.get(row.id);
        if (!reported || reported.staffId !== row.staff_id || !target.clients.some(client => client.deviceId === reported.deviceId)) target.unreportedSessions++;
      }
      if (row.started_at >= period.start && row.started_at < period.end) target.loginCount++;
    }
    for (const row of db.prepare("SELECT actor_id,count(*) AS total FROM operation_logs WHERE created_at>=? AND created_at<? AND action NOT LIKE 'auth.%' AND action NOT LIKE 'legacy.%' AND actor_id IS NOT NULL GROUP BY actor_id").all(period.start, period.end)) { const target = byId.get(row.actor_id); if (target) target.actionCount = row.total; }
    for (const target of employees) { target.onlineSeconds = Math.round(target.onlineSeconds); target.activeSeconds = Math.round(target.activeSeconds); }
    const totals = { employeeCount: employees.length, onlineCount: employees.filter(item => item.online).length, onlineSeconds: 0, activeSeconds: 0, loginCount: 0, actionCount: 0 };
    for (const target of employees) for (const key of ['onlineSeconds', 'activeSeconds', 'loginCount', 'actionCount']) totals[key] += target[key];
    return { employees, totals, from: period.from, to: period.to, sourceNote: '在线与活跃时长是软件使用估算，断线间隔不累计，不作为工资或考勤记录' };
  }
  function importPollAudits() {
    const labels = { 'poll-create': '创建投票', 'poll-vote': '提交投票', 'poll-close': '结束投票', 'poll-delete': '删除投票' };
    for (const row of db.prepare("SELECT id,actor_id,actor_name,action,entity_id,created_at FROM audit_logs WHERE entity_type='workplace-poll' AND NOT EXISTS(SELECT 1 FROM operation_logs WHERE operation_logs.id='poll:'||audit_logs.id)").all()) {
      db.prepare('INSERT OR IGNORE INTO operation_logs(id,created_at,actor_id,actor_name,module,action,label,resource,success,status,summary) VALUES(?,?,?,?,?,?,?,?,1,200,?)').run('poll:' + row.id, row.created_at, row.actor_id, safeText(row.actor_name), 'home', row.action, labels[row.action] || '投票操作', row.entity_id, '投票业务与原审计记录在同一事务中保存');
    }
  }
  function loginKeys(loginName, sessionId, sourcePeer) { return ['username:' + loginName, 'session:' + sessionId, 'source:' + (sourcePeer || 'local')].map(value => createHash('sha256').update(value).digest('hex')); }
  function checkLogin(loginName, sessionId, sourcePeer) {
    const keys = loginKeys(loginName, sessionId, sourcePeer), time = clock();
    let pause = 0;
    for (const key of keys) pause = Math.max(pause, (db.prepare('SELECT blocked_until FROM login_failures WHERE key=?').get(key)?.blocked_until || 0) - time);
    if (pause > 0) fail(429, `登录尝试过多，请等待${Math.ceil(pause / 1000)}秒后重试`);
    return keys;
  }
  function loginFailed(keys) {
    db.prepare('DELETE FROM login_failures WHERE last_failed<? AND blocked_until<?').run(clock() - 600000, clock());
    keys.forEach((key, index) => {
      const time = clock(), old = db.prepare('SELECT * FROM login_failures WHERE key=?').get(key), reset = !old || time - old.window_start > 300000;
      const failures = reset ? 1 : old.failures + 1, threshold = index === 2 ? 20 : index === 0 ? 6 : 10;
      const blocked = failures >= threshold ? time + (index === 2 ? 60000 : 30000) : 0;
      db.prepare('INSERT INTO login_failures(key,window_start,failures,blocked_until,last_failed) VALUES(?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET window_start=excluded.window_start,failures=excluded.failures,blocked_until=excluded.blocked_until,last_failed=excluded.last_failed').run(key, reset ? time : old.window_start, failures, blocked, time);
    });
  }
  function loginSucceeded(keys) { for (const key of keys) db.prepare('DELETE FROM login_failures WHERE key=?').run(key); }
  function resetLoginFailures(loginName) { db.prepare('DELETE FROM login_failures WHERE key=?').run(createHash('sha256').update('username:' + loginName).digest('hex')); }
  return { decorate, access, requireAccess, requireAdmin, requireCapability, capabilitySettings, updateCapabilities, listPermissions, updatePermissions, noteAction, noteReloginAttempt, startSession, touch, endSession, reportHeartbeat, operationLogs, usage, checkLogin, loginFailed, loginSucceeded, resetLoginFailures };
}
function getAdministration(runtime) { if (!cached.has(runtime)) cached.set(runtime, createAdministration({ runtime })); return cached.get(runtime); }
module.exports = { createAdministration, getAdministration, LEVELS, MODULES, CAPABILITIES };

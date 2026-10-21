'use strict';

const { randomBytes, randomUUID, scryptSync, timingSafeEqual } = require('node:crypto');

class LocalAuthError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new LocalAuthError(status, message); };
const timestamp = () => new Date().toISOString();
function accountInput(value) { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, '账号信息格式无效'); return value; }
function username(value) {
  if (typeof value !== 'string') fail(400, '请输入本机账号');
  const result = value.trim().normalize('NFKC').toLowerCase();
  if (!/^[\p{L}\p{N}._-]{2,48}$/u.test(result)) fail(400, '账号须为2至48位中文字母数字或._-，不使用邮箱');
  return result;
}
function password(value) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128) fail(400, '密码长度须为8至128位');
  return value;
}
function name(value, fallback) {
  if (value === undefined || value === '') return fallback;
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 80) fail(400, '姓名须为1至80字');
  return value.trim();
}
function passwordRecord(value) {
  const salt = randomBytes(24).toString('hex');
  return { salt, hash: scryptSync(password(value), salt, 64).toString('hex') };
}
function record(row) {
  return { id: row.id, userId: row.user_id, email: row.email, username: row.username, name: row.name, role: row.role, active: Boolean(row.active), createdAt: row.created_at, updatedAt: row.updated_at };
}
const selectUser = 'SELECT s.*,a.username,a.password_hash FROM staff_users s JOIN local_accounts a ON a.staff_id=s.id';

function createAuth(runtime) {
  const db = runtime.sqlite;
  let currentStaffId = null;
  let currentPasswordHash = null;
  const byId = id => db.prepare(selectUser + ' WHERE s.id=?').get(id);
  function current() {
    const row = currentStaffId ? byId(currentStaffId) : null;
    if (!row?.active || row.password_hash !== currentPasswordHash) { currentStaffId = null; currentPasswordHash = null; return null; }
    return record(row);
  }
  function requireAdmin() { const user = current(); if (!user) fail(401, '请先登录本机账号'); if (user.role !== 'admin') fail(403, '只有管理员可以管理本机账号'); return user; }
  function transaction(fn) { db.exec('BEGIN IMMEDIATE'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } }
  function audit(actor, target, action, oldValue, newValue) {
    db.prepare('INSERT INTO audit_logs(id,entity_type,entity_id,action,actor_id,actor_name,old_value,new_value,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(randomUUID(), 'user', target, action, actor.id, actor.name, oldValue === null ? null : JSON.stringify(oldValue), JSON.stringify(newValue), timestamp());
  }
  function insertAccount(input, role) {
    const loginName = username(input.username), displayName = name(input.name, loginName), credentials = passwordRecord(input.password);
    if (db.prepare('SELECT staff_id FROM local_accounts WHERE username=?').get(loginName)) fail(409, '该本机账号已存在');
    const id = randomUUID(), time = timestamp();
    db.prepare('INSERT INTO staff_users(id,user_id,email,name,role,active,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?)').run(id, 'local-' + id, loginName, displayName, role, time, time);
    db.prepare('INSERT INTO local_accounts(staff_id,username,password_salt,password_hash,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id, loginName, credentials.salt, credentials.hash, time, time);
    return record(byId(id));
  }
  return {
    status() { const user = current(); return { needsSetup: !db.prepare('SELECT staff_id FROM local_accounts LIMIT 1').get(), authenticated: Boolean(user), ...(user ? { user } : {}) }; },
    setup(input = {}) {
      accountInput(input);
      const user = transaction(() => {
        if (db.prepare('SELECT staff_id FROM local_accounts LIMIT 1').get() || db.prepare('SELECT id FROM staff_users LIMIT 1').get()) fail(409, '本机管理员已经创建，请使用账号登录');
        const created = insertAccount(input, 'admin');
        audit(created, created.id, 'local-setup', null, created);
        return created;
      });
      currentStaffId = user.id;
      currentPasswordHash = byId(user.id).password_hash;
      return this.status();
    },
    login(input = {}) {
      currentStaffId = null;
      currentPasswordHash = null;
      accountInput(input);
      const loginName = username(input.username);
      if (typeof input.password !== 'string' || input.password.length > 128) fail(401, '账号或密码不正确');
      const row = db.prepare('SELECT s.*,a.username,a.password_salt,a.password_hash FROM staff_users s JOIN local_accounts a ON a.staff_id=s.id WHERE a.username=?').get(loginName);
      // A dummy derivation preserves the password check cost for unknown users.
      const derived = scryptSync(input.password, row?.password_salt || 'local-account-not-found', 64);
      const known = row ? Buffer.from(row.password_hash, 'hex') : Buffer.alloc(64);
      if (!row || known.length !== derived.length || !timingSafeEqual(known, derived) || !row.active) fail(401, '账号或密码不正确，或该账号已停用');
      currentStaffId = row.id;
      currentPasswordHash = row.password_hash;
      return this.status();
    },
    logout() { currentStaffId = null; currentPasswordHash = null; return this.status(); },
    identity() { const user = current(); return user ? { userId: user.userId, email: user.username, displayName: user.name } : null; },
    listUsers() { requireAdmin(); return db.prepare(selectUser + ' ORDER BY s.created_at,s.id').all().map(record); },
    findUsername(id) { const row = byId(id); return row?.username || ''; },
    createUser(input = {}) {
      const actor = requireAdmin();
      accountInput(input);
      if (input.role !== undefined && !['admin', 'employee'].includes(input.role)) fail(400, '账号角色无效');
      return transaction(() => { const user = insertAccount(input, input.role || 'employee'); audit(actor, user.id, 'local-create', null, user); return user; });
    },
    updateUser(input = {}) {
      const actor = requireAdmin();
      accountInput(input);
      if (typeof input.id !== 'string') fail(400, '请选择需要修改的本机账号');
      return transaction(() => {
        const row = byId(input.id); if (!row) fail(404, '本机账号不存在');
        const old = record(row);
        const changed = { ...old, username: input.username === undefined ? old.username : username(input.username), name: input.name === undefined ? old.name : name(input.name, old.username), role: input.role === undefined ? old.role : input.role, active: input.active === undefined ? old.active : input.active, updatedAt: timestamp() };
        if (!['admin', 'employee'].includes(changed.role) || typeof changed.active !== 'boolean') fail(400, '账号角色或启用状态无效');
        if (actor.id === old.id && (!changed.active || changed.role !== 'admin')) fail(400, '不能停用或降级当前管理员账号');
        if (old.active && old.role === 'admin' && (!changed.active || changed.role !== 'admin') && Number(db.prepare("SELECT COUNT(*) AS count FROM staff_users WHERE role='admin' AND active=1").get().count) < 2) fail(400, '至少保留一名启用的管理员');
        if (changed.username !== old.username && db.prepare('SELECT staff_id FROM local_accounts WHERE username=? AND staff_id<>?').get(changed.username, old.id)) fail(409, '该本机账号已存在');
        const credentials = input.password === undefined || input.password === '' ? null : passwordRecord(input.password);
        db.prepare('UPDATE staff_users SET email=?,name=?,role=?,active=?,updated_at=? WHERE id=?').run(changed.username, changed.name, changed.role, changed.active ? 1 : 0, changed.updatedAt, old.id);
        db.prepare('UPDATE local_accounts SET username=?,updated_at=? WHERE staff_id=?').run(changed.username, changed.updatedAt, old.id);
        if (credentials) db.prepare('UPDATE local_accounts SET password_salt=?,password_hash=? WHERE staff_id=?').run(credentials.salt, credentials.hash, old.id);
        const result = record(byId(old.id));
        audit(actor, old.id, credentials ? 'local-update-password' : 'local-update', old, { ...result, passwordChanged: Boolean(credentials) });
        return result;
      });
    },
  };
}

module.exports = { createAuth, LocalAuthError };

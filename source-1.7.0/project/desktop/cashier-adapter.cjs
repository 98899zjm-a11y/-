'use strict';

const policy = require('./cashier-policy.cjs');
const INPUT_KEYS = Object.freeze(['module', 'path', 'method', 'headers', 'bodyBase64']);
function failure(message, status = 400) { const error = new Error(message); error.status = status; return error; }
function snapshotRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !INPUT_KEYS.includes(key))) throw failure('出纳请求参数无效。');
  if (input.module !== 'cashier') throw failure('出纳入口需要独立出纳身份。', 403);
  const route = policy.routeFor(input.path, input.method || 'GET');
  if (input.headers !== undefined && (!input.headers || typeof input.headers !== 'object' || Array.isArray(input.headers) || Object.values(input.headers).some(value => typeof value !== 'string'))) throw failure('出纳请求头无效。');
  if (input.bodyBase64 !== undefined && typeof input.bodyBase64 !== 'string') throw failure('出纳正文编码无效。');
  return Object.freeze({ module: 'cashier', path: route.path, method: route.method,
    ...(input.headers === undefined ? {} : { headers: Object.freeze({ ...input.headers }) }),
    ...(input.bodyBase64 === undefined ? {} : { bodyBase64: input.bodyBase64 }) });
}
function authorizeRequest(input, user, administration) {
  const route = policy.routeFor(input.path, input.method);
  const grants = administration.requireAccess(user, 'cashier', route.method === 'GET' ? 'view' : 'operate');
  const approved = policy.authorizeRequest(input, grants);
  const actor = { staffId: user.id, userId: user.userId, name: user.name, role: user.role,
    access: grants.moduleAccess.cashier, grantRevision: grants.grantRevision, module: 'cashier',
    protocolVersion: 3, authorityModule: 'cashier', storageModule: 'ledger', capabilities: [...approved.capabilities] };
  policy.validateCapabilities(actor);
  return { actor, grants, route: approved.route };
}
function storageRequest(input) {
  // The storage destination is internal and never selected by renderer input.
  return Object.freeze({ ...input, module: 'ledger' });
}
function statusFor(result, user) {
  const source = Array.isArray(result?.modules) ? result.modules : [];
  const modules = source.filter(item => ['ledger', 'inventory'].includes(item.id)).map(item => {
    const access = user.moduleAccess?.[item.id] || 'disabled';
    if (access === 'disabled') return { id: item.id, label: item.label, version: item.version, access, configured: false, running: false };
    return { ...item, access };
  });
  const ledger = source.find(item => item.id === 'ledger');
  const access = user.moduleAccess?.cashier || 'disabled', visible = access !== 'disabled';
  const cashier = { id: 'cashier', label: '出纳系统', version: '1.7.0', access,
    configured: visible && ledger?.configured === true, running: visible && ledger?.running === true };
  if (visible && (!ledger || ledger.error || result?.error)) cashier.error = '出纳暂未就绪，请管理员检查已关联的财务模块。';
  else if (visible && !cashier.configured) cashier.error = '请管理员先关联已有财务资料；出纳不会自动新建账套。';
  modules.push(cashier);
  // No top-level directory, legacy user or storage diagnostic is relayed.
  return { modules, ...(result?.error ? { error: '当前主机整合模块暂未就绪。' } : {}) };
}
module.exports = { snapshotRequest, authorizeRequest, storageRequest, statusFor };

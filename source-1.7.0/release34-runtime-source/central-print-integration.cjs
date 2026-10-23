'use strict';
const path = require('node:path');
const { AsyncLocalStorage } = require('node:async_hooks');
const { createHash } = require('node:crypto');
const { createCentralPrintJobs, createLegacyPrintHistory, readCentralPrintHistory, publicPrintJob } = require('./central-print-jobs.cjs');
const { fingerprintPrintPayload } = require('./print-agent.cjs');
const TYPES = ['warranty', 'quotation-a4', 'erp-document-a4', 'erp-report-a4', 'ledger-report-a4', 'inventory-count-a4', 'inventory-report-a4', 'inventory-metal-a4'];
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const unavailable = '主机统一打印代理尚未接入；未启用实体打印，请由主机管理员完成接入';
function fail(status, message) { const error = new Error(message); error.status = status; throw error; }
function isPrintPath(address) { const pathname = typeof address === 'string' ? address.split('?')[0] : ''; return pathname === '/api/print-options' || pathname === '/api/print-jobs' || pathname.startsWith('/api/print-jobs/'); }
function createCentralPrintIntegration({ runtime, core, administration, enqueue, printServices, isSessionLive }) {
  const context = new AsyncLocalStorage(), db = runtime.sqlite;
  function loadActor(id, sessionRef = '') {
    if (!UUID.test(id || '')) return null;
    if (sessionRef && !isSessionLive(id, sessionRef)) return null;
    const row = db.prepare('SELECT s.*,a.username,a.password_hash FROM staff_users s JOIN local_accounts a ON a.staff_id=s.id WHERE s.id=?').get(id);
    if (!row || !row.active) return null;
    const user = administration.decorate({ id: row.id, userId: row.user_id, email: row.email, username: row.username, name: row.name, role: row.role, active: Boolean(row.active), createdAt: row.created_at, updatedAt: row.updated_at });
    return { ...user, credential: row.password_hash, identity: { userId: row.user_id, email: row.username, displayName: row.name }, ...(sessionRef ? { sessionRef } : {}) };
  }
  function authenticate() {
    const scope = context.getStore();
    if (!scope || !scope.live() || !scope.auth.identity()) fail(401, '打印登录会话已结束，请重新登录');
    const user = scope.auth.status().user;
    if (!user || user.id !== scope.staffId || scope.auth.sessionId !== scope.sessionRef) fail(401, '打印账号已切换，请重新登录');
    const actor = loadActor(user.id, scope.sessionRef); if (!actor) fail(401, '打印员工账号已失效'); return actor;
  }
  function authorizeActor(actor, source) {
    if (!TYPES.includes(source?.type)) fail(400, '打印来源类型无效');
    const module = ['warranty', 'quotation-a4'].includes(source.type) ? 'sales' : source.type.startsWith('inventory-') ? 'inventory' : 'ledger';
    administration.requireAccess(actor, module, 'operate');
    if (source.type.startsWith('erp-')) administration.requireCapability(actor, 'erp.read', { readOnly: true });
    if (source.type === 'erp-report-a4') administration.requireCapability(actor, 'erp.reports.view', { readOnly: true });
    return true;
  }
  const services = typeof printServices === 'function' ? printServices({ runtime, core, administration, enqueue, loadActor, authorizeActor, withIdentity: runtime.withIdentity.bind(runtime) }) : printServices;
  let queue;
  if (services?.sources && services?.routing && services?.agent) queue = createCentralPrintJobs({
    runtime, sources: services.sources, routing: services.routing, agent: services.agent, authenticate, loadActor, authorizeActor, enqueue,
    retainedFile: services.retainedFile || path.resolve(runtime.dataDir) + '.central-print-ledger.json', legacyRetainedFile: services.legacyRetainedFile || path.resolve(runtime.dataDir) + '.print-ledger.json', legacyMetadataFile: services.legacyMetadataFile || path.resolve(runtime.dataDir) + '.print-ledger.metadata.json',
    capturePresentation: services.capturePresentation || ((kind, value) => { if (kind === 'warranty') fail(503, '主机质保模板快照尚未接入'); return { language: value.language }; }), fingerprintPayload: services.fingerprintPayload || fingerprintPrintPayload,
    agentTimeoutMs: services.agentTimeoutMs ?? 60000,
    assertDispatchAuthorized: ({ actorId, credentialHash, sessionRef, source, prepared }) => { const actor = loadActor(actorId, sessionRef); if (!actor || createHash('sha256').update(actor.credential).digest('hex') !== credentialHash) fail(403, '员工账号或打印会话已失效'); authorizeActor(actor, source); const requirements = prepared.permissionRequirements; if (requirements) { administration.requireAccess(actor, requirements.module, 'operate'); for (const key of requirements.capabilities || []) administration.requireCapability(actor, key, { readOnly: true }); } return true; },
    audit: event => { const type = event.after?.type || event.before?.type, module = ['warranty', 'quotation-a4'].includes(type) ? 'sales' : type?.startsWith('inventory-') ? 'inventory' : 'ledger'; administration.noteAction({ id: event.actorId, name: event.actorName }, { module, action: event.action, label: '主机打印任务', resource: event.jobId, summary: event.after?.status || '', status: event.after?.status === 'failed' ? 409 : 200 }); },
  });
  else {
    const history = createLegacyPrintHistory({ db, file: services?.legacyRetainedFile || path.resolve(runtime.dataDir) + '.print-ledger.json', metadataFile: services?.legacyMetadataFile || path.resolve(runtime.dataDir) + '.print-ledger.metadata.json', readOnly: true });
    const allHistory = () => { const combined = new Map(history.all().map(item => [item.id, item])); for (const item of readCentralPrintHistory({ db, file: services?.retainedFile || path.resolve(runtime.dataDir) + '.central-print-ledger.json' })) combined.set(item.id, item); return [...combined.values()]; };
    queue = {
    getOptions: () => enqueue(() => { authenticate(); return { available: false, printers: [], defaultPrinterId: '', defaults: { phone: '', standard: '', afterSalesWechat: '' }, sourceTypes: [], reason: unavailable, types: Object.fromEntries(TYPES.map(type => [type, { available: false, printerId: '', label: '', reason: unavailable }])) }; }),
    submit: () => enqueue(() => { authenticate(); fail(503, unavailable); }),
    get: id => enqueue(() => { const actor = authenticate(), item = allHistory().find(item => item.id === id); if (!UUID.test(id || '') || !item || actor.role !== 'admin' && item.actorId !== actor.id) fail(404, '打印任务不存在或无权查看'); return { job: publicPrintJob(item) }; }),
    byRequest: requestId => enqueue(() => { const actor = authenticate(), item = allHistory().find(item => item.requestId === requestId && item.actorId === actor.id); if (!UUID.test(requestId || '') || !item) fail(404, '打印任务不存在'); return { job: publicPrintJob(item) }; }),
    list: (filters = {}) => enqueue(() => { const actor = authenticate(), limit = filters.limit ?? 100, offset = filters.offset ?? 0; if (!Number.isInteger(limit) || limit < 1 || limit > 500 || !Number.isSafeInteger(offset) || offset < 0 || filters.type && !TYPES.includes(filters.type) || filters.status && !['queued', 'printing', 'submitted', 'failed', 'uncertain'].includes(filters.status)) fail(400, '打印历史筛选无效'); if (actor.role !== 'admin' && filters.actorId && filters.actorId !== actor.id) fail(403, '只能查看本人的打印任务'); const items = allHistory().filter(item => (actor.role === 'admin' || item.actorId === actor.id) && (!filters.actorId || item.actorId === filters.actorId) && (!filters.type || item.type === filters.type) && (!filters.status || item.status === filters.status)).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)); return { jobs: items.slice(offset, offset + limit).map(publicPrintJob), total: items.length, limit, offset, unavailable: true }; }),
    withPaused: action => action(), drain: async () => {}, close: async () => {},
    };
  }
  function listFilters(parameters) {
    const values = {}, allowed = ['status', 'type', 'actorId', 'from', 'to', 'limit', 'offset'];
    for (const [key, value] of parameters) { if (!allowed.includes(key) || Object.hasOwn(values, key)) fail(400, '打印队列筛选参数无效或重复'); values[key] = ['limit', 'offset'].includes(key) ? Number(value) : value; }
    return values;
  }
  async function execute(input) {
    const url = new URL(input.path, 'http://offline.invalid'), method = String(input.method || 'GET').toUpperCase(), pathname = url.pathname;
    if (input.path.length > 2500 || url.origin !== 'http://offline.invalid' || /[\\#\x00-\x1f\x7f]/.test(input.path) || pathname !== input.path.split('?')[0] || /%2f|%5c|%00/i.test(pathname)) fail(400, '打印请求地址须为规范地址');
    if (input.body !== undefined && Buffer.byteLength(JSON.stringify(input.body)) > 128 * 1024) fail(413, '打印申请参数过大');
    if (pathname === '/api/print-options' && method === 'GET' && !url.search) return { ok: true, status: 200, data: await queue.getOptions() };
    if (pathname === '/api/print-jobs' && method === 'POST' && !url.search) return { ok: true, status: 201, data: await queue.submit(input.body) };
    if (['/api/print-jobs', '/api/print-jobs/list'].includes(pathname) && method === 'GET') return { ok: true, status: 200, data: await queue.list(listFilters(url.searchParams)) };
    const request = /^\/api\/print-jobs\/by-request\/([a-f0-9-]{36})$/.exec(pathname), job = /^\/api\/print-jobs\/([a-f0-9-]{36})$/.exec(pathname);
    if (method === 'GET' && !url.search && request) return { ok: true, status: 200, data: await queue.byRequest(request[1]) };
    if (method === 'GET' && !url.search && job) return { ok: true, status: 200, data: await queue.get(job[1]) };
    fail(['GET', 'POST'].includes(method) ? 404 : 405, '打印功能地址或方法不存在');
  }
  async function dispatch(sessionAuth, live, input) {
    try {
      // Release the ordinary backend queue before asking the central queue to
      // enqueue its own SQL section. Never await central methods inside enqueue.
      const scope = await enqueue(() => {
        const identity = live() ? sessionAuth.identity() : null, user = identity ? sessionAuth.status().user : null;
        if (!identity || !user) fail(401, '打印登录会话已结束，请重新登录');
        sessionAuth.touch(); administration.touch(sessionAuth.sessionId, user, 'home', true);
        return { auth: sessionAuth, live, identity, staffId: user.id, sessionRef: sessionAuth.sessionId };
      });
      return await context.run(scope, () => runtime.withIdentity(scope.identity, () => execute(input)));
    } catch (error) { const status = Number.isInteger(error.status) ? error.status : 500; return { ok: false, status, data: { error: status === 500 ? '统一打印请求未完成，请查询原请求后重试' : error.message } }; }
  }
  async function getWarrantyPreferences() {
    const value = await core.getWarrantyPreferences();
    if (!value.inherited) return value;
    const provider = services?.getWarrantyDefaults || services?.defaultsProvider;
    const defaults = typeof provider === 'function' ? await provider() : { phone: '', afterSalesWechat: '' };
    return { phone: defaults?.phone || '', afterSalesWechat: defaults?.afterSalesWechat || '', inherited: true };
  }
  return { dispatch, getWarrantyPreferences, loadActor, ...Object.fromEntries(['withPaused', 'drain', 'close'].map(name => [name, (...args) => queue[name](...args)])), available: Boolean(services?.sources && services?.routing && services?.agent) };
}
module.exports = { createCentralPrintIntegration, isPrintPath };

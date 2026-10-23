'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { createRuntime } = require('./runtime.cjs');
const { createAuth } = require('./local-auth.cjs');
const { createCentralPrintIntegration, isPrintPath } = require('./central-print-integration.cjs');
const { createUpdateDistributionApi, isEmployeeUpdatePath } = require('./update-distribution.cjs');
const { getAdministration } = require('./administration.cjs');
const { createWorkspaceCollaboration } = require('./workspace-collaboration.cjs');
const { createEmployeeProfile } = require('./employee-profile.cjs');
const erpPolicy = require('./erp-policy.cjs');

function createBackend({ dataDir, migrationDir, businessPath = path.join(__dirname, 'generated', 'business.cjs'), businessCore, runtimeFactory = createRuntime, printServices, updateServices, printAdapter, printDomainPath, moduleAdapter, pollsAdapter, aiAdapter }) {
  const runtime = runtimeFactory({ dataDir, migrationDir });
  const administration = getAdministration(runtime);
  if (!pollsAdapter && fs.existsSync(path.join(__dirname, 'workplace-polls.cjs'))) pollsAdapter = require('./workplace-polls.cjs').createWorkplacePolls({ runtime });
  if (!aiAdapter && fs.existsSync(path.join(__dirname, 'ai-adapter.cjs'))) aiAdapter = require('./ai-adapter.cjs').createAiAdapter({ audit: event => administration.noteAction(event.actor, { ...event, label: '生成AI建议', status: event.success ? 200 : 502 }) });
  const auth = createAuth(runtime, { administration });
  const sessions = new Set();
  const sessionStates = new WeakMap(), reloginTickets = new WeakMap(), reloginTargets = new WeakMap(), reloginSources = new WeakMap();
  const pendingRelogins = new Set(), reloginAuditFailures = new WeakSet();
  const printSessions = new Map();
  const moduleInflight = new Set();
  let core;
  try { core = businessCore || require(businessPath); } catch (error) { runtime.close(); throw error; }
  let queue = Promise.resolve(), closed = false, accepting = true, closing = null;
  const enqueue = action => {
    if (closed) return Promise.reject(new Error('本机程序正在关闭'));
    const result = queue.then(action); queue = result.catch(() => {}); return result;
  };
  function reloginRecord(ticket) {
    const record = ticket && reloginTickets.get(ticket);
    if (!record) throw new TypeError('Untrusted internal relogin ticket');
    return record;
  }
  function releaseRelogin(record) {
    pendingRelogins.delete(record);
    if (record.target) reloginTargets.delete(record.target);
    if (reloginSources.get(record.source) === record) reloginSources.delete(record.source);
  }
  // This function is synchronous for callers already inside enqueue. The
  // gateway's external failure path uses the separate queued wrapper below.
  function completeRelogin(record, status, verifiedUser = null) {
    if (record.phase === 'completed') return;
    if (record.phase === 'failed') throw record.auditError;
    try {
      administration.noteReloginAttempt({ operationId: record.operationId, initiator: record.initiator, usageSessionId: record.usageSessionId, status, verifiedUser: status === 200 ? { id: verifiedUser.id, name: verifiedUser.name } : null });
    } catch (cause) {
      const error = new Error('重登录审计未能保存，未完成登录，请管理员正常重启主机后重试', { cause }); error.status = 503;
      reloginAuditFailures.add(error); record.phase = 'failed'; record.auditError = error; releaseRelogin(record); throw error;
    }
    record.phase = 'completed'; releaseRelogin(record);
  }
  const reloginAudit = Object.freeze({
    capture(source) {
      const state = sessionStates.get(source);
      if (closed || !accepting || !state || !sessions.has(source) || state.closed || !state.loginScopeId || reloginSources.has(source)) throw new Error('Relogin source is not an owned live session');
      const user = state.auth.status().user, usageSessionId = state.auth.sessionId;
      if (!user) return null;
      const usage = runtime.sqlite.prepare('SELECT staff_id,ended_at FROM usage_sessions WHERE id=?').get(usageSessionId);
      if (!usage || usage.staff_id !== user.id || usage.ended_at) throw new Error('Relogin source usage is not live and owned');
      const ticket = Object.freeze(Object.create(null)), record = { source, target: null, initiator: Object.freeze({ id: user.id, name: user.name }), usageSessionId, operationId: randomUUID(), loginScopeId: state.loginScopeId, sourcePeer: state.sourcePeer, phase: 'captured', dispatched: false };
      reloginTickets.set(ticket, record); reloginSources.set(source, record); pendingRelogins.add(record); return ticket;
    },
    closeSource(ticket) {
      const record = reloginRecord(ticket), state = sessionStates.get(record.source);
      if (record.phase === 'closing') return state.closeForRelogin();
      if (closed || record.phase !== 'captured' || !state || state.closed) throw new Error('Relogin source cannot be closed twice');
      record.phase = 'closing'; return state.closeForRelogin();
    },
    attach(ticket, target) {
      const record = reloginRecord(ticket), source = sessionStates.get(record.source), state = sessionStates.get(target);
      if (closed || !accepting || record.phase !== 'closing' || !source?.closeComplete || !state || state.closed || !sessions.has(target) || target === record.source || reloginTargets.has(target) || state.loginScopeId !== record.loginScopeId || state.sourcePeer !== record.sourcePeer || state.auth.status().authenticated) throw new Error('Relogin target is not an independent owned session');
      record.target = target; record.phase = 'attached'; reloginTargets.set(target, record);
    },
    fail(ticket, status = 500) {
      const record = reloginRecord(ticket);
      if (record.phase === 'completed') return Promise.resolve();
      if (record.phase === 'failed') return Promise.reject(record.auditError);
      const failureStatus = Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
      return enqueue(() => completeRelogin(record, failureStatus));
    },
    isFailure(error) { return reloginAuditFailures.has(error); },
  });
  const collaboration = createWorkspaceCollaboration({ runtime, administration });
  const employeeProfiles = createEmployeeProfile({ runtime, administration });
  let printJobs;
  try { printJobs = createCentralPrintIntegration({ runtime, core, administration, enqueue, printServices,
    isSessionLive: (id, sessionRef) => [...printSessions.entries()].some(([sessionAuth, live]) => live() && sessionAuth.sessionId === sessionRef && sessionAuth.status().user?.id === id) }); }
  catch (error) { runtime.close(); throw error; }
  const updates = createUpdateDistributionApi({ runtime, administration, enqueue, updateServices });
  function augmentUser(sessionAuth, user) { return administration.decorate({ ...user, username: sessionAuth.findUsername(user.id) }); }
  function guardSales(user, pathname, method) { administration.requireAccess(user, 'sales', method === 'GET' ? 'view' : 'operate'); }
  function actorFor(user, module, access) { return { staffId: user.id, userId: user.userId, name: user.name, role: user.role, access, module, grantRevision: user.grantRevision }; }
  function auditRequest(sessionAuth, input, result, fallbackUser) {
    const pathname = String(input.path || '').split('?')[0], method = String(pathname === '/api/internal-modules/proxy' ? input.body?.method || 'GET' : input.method || 'GET').toUpperCase();
    if (['/auth/status', '/api/bootstrap', '/api/presence/heartbeat', '/api/internal-modules/status'].includes(pathname) || /^\/api\/print-jobs\//.test(pathname) || pathname === '/auth/logout') return;
    if (method === 'GET' && result.ok && ['/api/admin/usage', '/api/collaboration/capabilities'].includes(pathname)) return;
    if (pathname.startsWith('/api/polls') && method !== 'GET' && result.ok) return;
    if (pathname.startsWith('/api/collaboration') && method !== 'GET' && result.ok) return;
    if (pathname.startsWith('/api/employee-profiles') && method !== 'GET' && result.ok) return;
    if (pathname === '/api/admin/module-permissions' && method === 'PATCH' && result.ok) return;
    const module = pathname === '/api/internal-modules/proxy' && ['ledger', 'inventory'].includes(input.body?.module) ? input.body.module : pathname.startsWith('/auth/') || pathname.startsWith('/api/admin/') || pathname.startsWith('/api/ai/') ? 'system' : pathname.startsWith('/api/polls') || pathname.startsWith('/api/collaboration') || pathname.startsWith('/api/employee-profiles') ? 'home' : 'sales';
    const resource = pathname === '/api/internal-modules/proxy' ? String(input.body?.path || '/').split('?')[0] : pathname;
    if (module !== 'sales' && /^\/(?:static\/|favicon)|\.(?:css|js|png|jpe?g|webp|ico|woff2?)$/i.test(resource)) return;
    let label = method === 'GET' ? '查看资料' : '保存业务';
    if (pathname === '/auth/login') label = result.ok ? '登录成功' : '登录失败';
    else if (pathname === '/auth/setup') label = '创建总管理员';
    else if (/delete/.test(resource)) label = '删除业务记录';
    else if (/cancel-sale/.test(resource)) label = '撤销成交';
    else if (/confirm-sale/.test(resource)) label = '确认成交';
    else if (/export|download|\.xlsx?|\.pdf|\.csv|\/print/.test(resource)) label = '导出或打印';
    else if (/images/.test(resource)) label = '保存报价图片';
    else if (/quotes/.test(resource)) label = method === 'GET' ? '查看报价' : '保存报价';
    else if (/customers/.test(resource)) label = method === 'GET' ? '查看客户' : '保存客户资料';
    else if (/operation-logs/.test(resource)) label = '查看操作日志';
    else if (/usage/.test(resource)) label = '查看软件使用统计';
    else if (/module-permissions/.test(resource)) label = method === 'GET' ? '查看模块权限' : '调整模块权限';
    else if (/users/.test(resource)) label = '管理员工账号';
    const internalModule = ['ledger', 'inventory'].includes(module);
    // Only the owned sidecar response produces this value. Input headers/body
    // cannot claim a successful operation or hide a validation failure.
    const outcome = internalModule && ['success', 'rejected', 'warning'].includes(result.data?.outcome) ? result.data.outcome : null;
    let summary = result.ok && result.status < 400 ? '请求已完成' : '请求被拒绝或未完成';
    if (outcome === 'rejected') summary = '模块业务校验未通过，请核对页面提示；未确认业务保存';
    else if (outcome === 'warning' || internalModule && !['GET', 'HEAD', 'OPTIONS'].includes(method) && !outcome && result.status < 400) summary = '请求已完成，但业务保存结果需要核对；请查看模块页面提示';
    else if (internalModule && result.status >= 300 && result.status < 400) summary = '请求已完成并跳转，请核对模块页面的提交提示';
    const actor = pathname === '/auth/login' && (!result.ok || result.status !== 200) ? fallbackUser : sessionAuth.status().user || fallbackUser;
    administration.noteAction(actor, { module, action: pathname.startsWith('/auth/') ? 'auth.' + pathname.slice(6) : method.toLowerCase() + '.' + resource.replace(/[^\p{L}\p{N}._/-]/gu, '').slice(1, 180), label, resource, status: result.status, success: outcome === 'rejected' ? false : result.status >= 200 && result.status < 400, summary });
  }
  function request(method, address, body) {
    return new Request('http://offline.invalid' + address, { method, ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  }
  async function handle(auth, { path: address, method = 'GET', body }) {
    if (typeof address !== 'string' || !address.startsWith('/') || address.startsWith('//') || address.includes('\\') || address.length > 2500) return { ok: false, status: 400, data: { error: '本机请求地址无效' } };
    const url = new URL(address, 'http://offline.invalid'), pathname = url.pathname;
    if (url.origin !== 'http://offline.invalid' || address.includes('#') || url.pathname !== address.split('?')[0] || /%2f|%5c|%00/i.test(url.pathname)) return { ok: false, status: 400, data: { error: '本机请求地址须为规范地址' } };
    method = String(method).toUpperCase();
    if (!['GET', 'POST', 'PATCH'].includes(method)) return { ok: false, status: 405, data: { error: '不支持此操作方式' } };
    try {
      if (body !== undefined) {
        let size; try { size = Buffer.byteLength(JSON.stringify(body)); } catch { return { ok: false, status: 400, data: { error: '操作参数格式无效' } }; }
        if (size > (pathname.startsWith('/auth/') ? 8192 : 96 * 1024 * 1024)) return { ok: false, status: 413, data: { error: '上传内容超过本机允许范围' } };
      }
      const authActions = {
        'GET /auth/status': () => auth.status(),
        'POST /auth/setup': () => auth.setup(body),
        'POST /auth/login': () => auth.login(body),
        'POST /auth/logout': () => auth.logout(),
      };
      const authAction = authActions[method + ' ' + pathname];
      if (authAction) return { ok: true, status: 200, data: authAction() };
      const identity = auth.identity();
      if (!identity) return { ok: false, status: 401, data: { error: '请先登录本机账号' } };
      const user = auth.status().user;
      if (pathname === '/api/presence/heartbeat' && method === 'POST') { if (body?.active) auth.touch(); return { ok: true, status: 200, data: administration.reportHeartbeat(auth.sessionId, user, body) }; }
      const passiveMetadata = method === 'GET' && ['/api/admin/usage', '/api/collaboration/capabilities'].includes(pathname);
      if (!passiveMetadata) auth.touch();
      const homeRequest = pathname === '/api/bootstrap' || pathname === '/api/users' || pathname.startsWith('/api/admin/') || pathname.startsWith('/api/polls') || pathname.startsWith('/api/ai/') || pathname.startsWith('/api/collaboration') || pathname.startsWith('/api/employee-profiles') || pathname === '/api/internal-modules/status';
      if (!passiveMetadata) administration.touch(auth.sessionId, user, homeRequest ? 'home' : 'sales', !['/api/bootstrap', '/api/internal-modules/status', '/api/ai/capabilities'].includes(pathname));
      if (pathname === '/api/admin/module-permissions') {
        if (method === 'GET') return { ok: true, status: 200, data: administration.listPermissions(user, () => auth.listUsers()) };
        if (method === 'PATCH') return { ok: true, status: 200, data: administration.updatePermissions(user, body, () => auth.listUsers()) };
      }
      if (pathname === '/api/admin/operation-logs' && method === 'GET') return { ok: true, status: 200, data: administration.operationLogs(user, url.searchParams) };
      if (pathname === '/api/admin/usage' && method === 'GET') return { ok: true, status: 200, data: administration.usage(user, url.searchParams) };
      if (pathname.startsWith('/api/collaboration/')) return collaboration.handle(user, { path: address, method, body });
      if (pathname === '/api/employee-profiles' || pathname.startsWith('/api/employee-profiles/')) return await employeeProfiles.handle(user, { path: address, method, body });
      if (pathname.startsWith('/api/polls')) { if (!pollsAdapter) return { ok: false, status: 503, data: { error: '投票模块尚未就绪' } }; return pollsAdapter.handle(user, { path: address, method, body }); }
      if (pathname.startsWith('/api/ai/')) { if (!(pathname === '/api/ai/capabilities' && method === 'GET')) administration.requireAdmin(user); if (!aiAdapter) return { ok: false, status: 503, data: { error: 'AI服务尚未配置' } }; return aiAdapter.handle(user, { path: address, method, body },{read:async(tool,args)=>{administration.requireAccess(user,'sales','view');return runtime.withIdentity(identity,()=>{const query=new URLSearchParams(Object.entries(args).map(([k,v])=>[k,String(v)]));if(tool==='customers.search')return core.searchCustomers(request('GET','/api/customers/search?'+query));if(tool==='quotes.history')return core.quotePage(request('GET','/api/quotes?'+query));throw new Error('AI tool is not registered');});}}); }
      if(pathname==='/api/internal-modules/status'&&method==='GET') { const result = moduleAdapter ? await moduleAdapter.status() : { modules: [], error: '当前主机未安装整合模块' }; return {ok:true,status:200,data:{...result,modules:result.modules.map(item=>({...item,access:user.moduleAccess[item.id]||'disabled'}))}}; }
      if (pathname === '/api/users') {
        if (method === 'GET') return { ok: true, status: 200, data: { users: auth.listUsers() } };
        if (method === 'POST') return { ok: true, status: 201, data: { user: auth.createUser(body) } };
        if (method === 'PATCH') return { ok: true, status: 200, data: { user: auth.updateUser(body) } };
      }
      if (pathname !== '/api/bootstrap') guardSales(user, pathname, method);
      return await runtime.withIdentity(identity, async () => {
        const exporting=/^\/api\/exports\/(history|sales|logs)$/.exec(pathname);
        if(exporting&&method==='GET'){const data=await require('./xlsx-export.cjs').exportData({kind:exporting[1],parameters:url.searchParams,core,administration,user,request});return{ok:true,status:200,data};}
        const req = request(method, address, body);
        const actions = {
          'GET /api/bootstrap': async () => { const result = await core.bootstrap(); if (user.moduleAccess.sales === 'disabled') return { user: augmentUser(auth, result.user), settings: { brand: result.settings.brand, home: result.settings.home }, users: [], styles: [], customers: [], quotes: [], media: [], paymentMethods: [] }; return { ...result, user: augmentUser(auth, result.user), users: result.users.map(user => augmentUser(auth, user)) }; },
          'GET /api/customers': async () => ({ customers: (await core.bootstrap()).customers }),
          'GET /api/customers/search': () => core.searchCustomers(req),
          'POST /api/customers': () => core.createCustomer(req),
          'PATCH /api/customers': () => core.updateCustomer(req),
          'GET /api/quotes': () => core.quotePage(req),
          'POST /api/quotes': () => core.createQuote(req),
          'GET /api/reports/sales': () => core.salesReport(req),
          'GET /api/warranty-preferences': () => printJobs.getWarrantyPreferences(),
          'PATCH /api/warranty-preferences': async () => { await core.updateWarrantyPreferences(req); return printJobs.getWarrantyPreferences(); },
          'PATCH /api/settings': () => core.updateSettings(req),
          'POST /api/styles': () => core.createStyle(req),
          'GET /api/styles/search': () => core.searchStyles(req),
          'PATCH /api/styles': () => core.updateStyle(req),
          'GET /api/media': () => core.getMedia(),
          'POST /api/media': () => core.createMedia(req),
          'PATCH /api/media': () => core.updateMedia(req),
          'GET /api/preferences': () => core.getPreferences(),
          'PATCH /api/preferences': () => core.updatePreferences(req),
        };
        let action = actions[method + ' ' + pathname];
        const quote = /^\/api\/quotes\/([a-f0-9-]{36})$/.exec(pathname);
        const attachment = /^\/api\/quotes\/([a-f0-9-]{36})\/images$/.exec(pathname);
        const imagePage = /^\/api\/quotes\/([a-f0-9-]{36})\/images\/page$/.exec(pathname);
        const quoteAction = /^\/api\/quotes\/([a-f0-9-]{36})\/(delete|confirm-sale|cancel-sale)$/.exec(pathname);
        const customerDelete = /^\/api\/customers\/([a-f0-9-]{36})\/delete$/.exec(pathname);
        const customerActivity = /^\/api\/customers\/([a-f0-9-]{36})\/activity$/.exec(pathname);
        const customerTransfer = /^\/api\/customers\/([a-f0-9-]{36})\/transfer$/.exec(pathname), customerCollaborators = /^\/api\/customers\/([a-f0-9-]{36})\/collaborators$/.exec(pathname);
        if (customerTransfer && method === 'POST') action = () => core.transferCustomer(req, customerTransfer[1]);
        if (customerCollaborators && method === 'POST') action = () => core.manageCustomerCollaborator(req, customerCollaborators[1]);
        if (customerCollaborators && method === 'GET') action = () => core.listCustomerCollaborators(customerCollaborators[1]);
        if (quote && method === 'GET') action = () => core.getQuote(quote[1]);
        if (attachment && method === 'POST') action = () => core.attachQuoteImages(req, attachment[1]);
        if (imagePage && method === 'POST') action = () => core.attachQuoteImagePage(req, imagePage[1]);
        if (quoteAction && method === 'POST') action = () => ({ 'delete': core.deleteQuote, 'confirm-sale': core.confirmSale, 'cancel-sale': core.cancelSale })[quoteAction[2]](req, quoteAction[1]);
        if (customerDelete && method === 'POST') action = () => core.deleteCustomer(req, customerDelete[1]);
        if (customerActivity && method === 'GET') action = () => core.customerActivity(req, customerActivity[1]);
        if (!action) return { ok: false, status: 404, data: { error: '本机功能不存在' } };
        const response = await core.api(action, quoteAction || customerDelete || customerTransfer || customerCollaborators ? 200 : method === 'POST' && !pathname.endsWith('/images') ? 201 : 200);
        return { ok: response.ok, status: response.status, data: await response.json() };
      });
    } catch (error) {
      const status = Number.isInteger(error.status) ? error.status : 500;
      return { ok: false, status, data: { error: status === 500 ? '本机操作未完成，请重试' : error.message } };
    }
  }
  function session(sessionAuth, { sourcePeer = 'local', loginScopeId = null } = {}) {
    let sessionClosed = false, sessionClosing = null, sessionCloseComplete = false;
    function closeSession(reason) {
      if (sessionClosing) return sessionClosing;
      sessionClosed = true; printSessions.delete(sessionAuth);
      sessionClosing = (async () => {
        if (!closed) { await queue; if (!closed) { if (reason === 'switch-user') sessionAuth.revokeForRelogin(); else sessionAuth.logout(); } }
        sessions.delete(result); sessionCloseComplete = true;
      })();
      return sessionClosing;
    }
    const result = {
      auth: sessionAuth,
      dispatch(input) {
        if (closed) return Promise.resolve({ ok: false, status: 401, data: { error: '主机会话已失效，请重新登录' } });
        if (!accepting) return Promise.resolve({ ok: false, status: 503, data: { error: '主机正在关闭' } });
        if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.path !== 'string') return Promise.resolve({ ok: false, status: 400, data: { error: '请求参数或地址格式无效' } });
        if (isEmployeeUpdatePath(input.path)) {
          const pending = updates.dispatch(sessionAuth, () => !sessionClosed && !closed && accepting, input);
          moduleInflight.add(pending); return pending.finally(() => moduleInflight.delete(pending));
        }
        if (isPrintPath(input.path)) {
          const pending = printJobs.dispatch(sessionAuth, () => !sessionClosed && !closed && accepting, input);
          moduleInflight.add(pending); return pending.finally(() => moduleInflight.delete(pending));
        }
        if (['/api/collaboration/inventory-reports', '/api/collaboration/sales-publications'].includes(input?.path?.split('?')[0]) && String(input.method || 'GET').toUpperCase() === 'POST') {
          let actor, originalUser, spec;
          const pending = enqueue(() => {
            const address = new URL(input.path, 'http://offline.invalid'); if (address.origin !== 'http://offline.invalid' || input.path.includes('#') || input.path.includes('\\') || address.pathname !== input.path.split('?')[0]) { const error = new Error('请求地址须为规范地址'); error.status = 400; throw error; }
            if (sessionClosed || !sessionAuth.identity()) { const error = new Error('请先登录账号'); error.status = 401; throw error; }
            originalUser = sessionAuth.status().user;
            spec = collaboration.preparation(originalUser, { ...input, method: 'POST' });
            if (!moduleAdapter?.collaborationSnapshot) { const error = new Error('主机尚未安装可信来源汇报接口'); error.status = 503; throw error; }
            const grants = administration.requireCapability(originalUser, spec.capability);
            actor = actorFor(originalUser, spec.module, grants.moduleAccess[spec.module]); sessionAuth.touch(); administration.touch(sessionAuth.sessionId, originalUser, spec.module, true);
          }).then(() => moduleAdapter.collaborationSnapshot(spec.module, { actor, from: spec.from, to: spec.to, includeProfit: Boolean(spec.includeProfit), getActor: () => enqueue(() => {
            const current = sessionClosed ? null : sessionAuth.status().user;
            if (!current || current.id !== actor.staffId) { const error = new Error('账号会话已经结束，请重新登录'); error.status = 401; throw error; }
            const grants = administration.requireCapability(current, spec.capability); if (spec.includeProfit) administration.requireAdmin(current);
            actor = actorFor(current, spec.module, grants.moduleAccess[spec.module]); return actor;
          }) })).then(snapshot => enqueue(() => {
            const current = sessionClosed ? null : sessionAuth.status().user;
            if (!current || current.id !== actor.staffId) { const error = new Error('账号会话已经结束，请重新登录'); error.status = 401; throw error; }
            const grants = administration.requireCapability(current, spec.capability);
            if (grants.grantRevision !== actor.grantRevision) { const error = new Error('操作能力刚被调整，请重新生成汇报'); error.status = 403; throw error; }
            return { ok: true, status: 201, data: collaboration.storeSnapshot(current, spec, snapshot) };
          })).catch(error => enqueue(() => { const result = { ok: false, status: error.status || 500, data: { error: error.status ? error.message : '汇报生成未完成，请重试' } }; auditRequest(sessionAuth, input, result, originalUser); return result; }));
          moduleInflight.add(pending); return pending.finally(() => moduleInflight.delete(pending));
        }
        if(input?.path==='/api/internal-modules/proxy'&&String(input.method||'GET').toUpperCase()==='POST'){
          let actor, originalUser, erpRequest;
          const pending = enqueue(() => {
            if (Buffer.byteLength(JSON.stringify(input.body || {})) > 96 * 1024 * 1024) { const error = new Error('模块请求内容过大'); error.status = 413; throw error; }
            const identity = sessionClosed ? null : sessionAuth.identity(); if (!identity) { const error = new Error('请先登录本机账号'); error.status = 401; throw error; }
            originalUser = sessionAuth.status().user;
            const module = input.body?.module, required = ['GET', 'HEAD', 'OPTIONS'].includes(String(input.body?.method || 'GET').toUpperCase()) ? 'view' : 'operate';
            const granted = administration.requireAccess(originalUser, module, required);
            erpRequest = erpPolicy.isErpPath(input.body?.path);
            const erp = erpRequest ? erpPolicy.authorizeRequest(input.body, granted) : null;
            if (!moduleAdapter) { const error = new Error('当前主机未安装整合模块'); error.status = 503; throw error; }
            actor = { ...actorFor(originalUser, module, granted.moduleAccess[module]), ...(erp ? { protocolVersion: 2, capabilities: erp.capabilities } : {}) }; sessionAuth.touch(); administration.touch(sessionAuth.sessionId, originalUser, module, true);
          }).then(() => moduleAdapter.proxy(input.body, { actor, getActor: () => enqueue(() => {
            const current = sessionClosed ? null : sessionAuth.status().user;
            if (!current || current.id !== actor.staffId) { const error = new Error('账号会话已经结束，请重新登录'); error.status = 401; throw error; }
            const needed = ['GET', 'HEAD', 'OPTIONS'].includes(String(input.body?.method || 'GET').toUpperCase()) ? 'view' : 'operate';
            const grants = administration.requireAccess(current, actor.module, needed);
            const erp = erpRequest ? erpPolicy.authorizeRequest(input.body, grants) : null;
            actor = { ...actorFor(current, actor.module, grants.moduleAccess[actor.module]), ...(erp ? { protocolVersion: 2, capabilities: erp.capabilities } : {}) }; return actor;
          }) })).then(data => enqueue(() => {
            if (sessionClosed || sessionAuth.identity()?.userId !== actor.userId) return { ok: false, status: 401, data: { error: '账号会话已经结束，请重新登录' } };
            const current = sessionAuth.status().user, grants = administration.requireAccess(current, actor.module);
            if (grants.grantRevision !== actor.grantRevision) return { ok: false, status: 403, data: { error: '模块权限刚被调整，请重新进入模块' } };
            if (erpRequest) erpPolicy.authorizeRequest(input.body, grants);
            const result = { ok: true, status: 200, data }; auditRequest(sessionAuth, input, { ...result, status: data.status || 200 }, originalUser); return result;
          })).catch(error => enqueue(() => { const result = {ok:false,status:error.status||400,data:{error:error.status===500?'模块暂时未能打开':error.message||'模块暂时未能打开'}}; auditRequest(sessionAuth, input, result, originalUser); return result; }));
          moduleInflight.add(pending);
          return pending.finally(() => moduleInflight.delete(pending));
        }
        const relogin = reloginTargets.get(result);
        if (relogin) {
          if (relogin.dispatched || input.path !== '/auth/login' || String(input.method || 'GET').toUpperCase() !== 'POST') return Promise.reject(new Error('Relogin ticket is limited to one credential check'));
          relogin.dispatched = true;
        }
        return enqueue(async () => {
          const prior = sessionAuth.status().user;
          let response = sessionClosed ? { ok: false, status: 401, data: { error: '账号会话已经结束，请重新登录' } } : await handle(sessionAuth, input || {});
          if (relogin) {
            const verified = response.ok && response.status === 200 ? sessionAuth.status().user : null;
            if (response.status === 200 && !verified || response.status !== 200 && (response.status < 400 || response.status > 599)) response = { ok: false, status: 500, data: { error: '登录验证未建立账号会话，请重试' } };
            completeRelogin(relogin, response.status, verified);
          } else auditRequest(sessionAuth, input || {}, response, prior);
          return response;
        });
      },
      imageResponse(id) {
        if (closed) return Promise.resolve(Response.json({ error: '主机会话已失效，请重新登录' }, { status: 401 }));
        if (!accepting) return Promise.resolve(Response.json({ error: '主机正在关闭' }, { status: 503 }));
        return enqueue(async () => {
          const identity = sessionClosed ? null : sessionAuth.identity();
          if (!identity) return Response.json({ error: '请先登录本机账号' }, { status: 401 });
          const user = sessionAuth.status().user;
          if (user.moduleAccess.sales === 'disabled') {
            const settings = runtime.sqlite.prepare("SELECT data FROM company_settings WHERE id='default'").get();
            const homeImage = settings ? JSON.parse(settings.data).home?.image : '';
            if (homeImage !== '/api/images/' + String(id)) return Response.json({ error: '当前账号无权查看销售图片' }, { status: 403 });
          }
          return runtime.withIdentity(identity, () => core.api(() => core.getImage(String(id))));
        });
      },
      close() { return closeSession('logout'); },
    };
    sessions.add(result);
    sessionStates.set(result, { auth: sessionAuth, sourcePeer, loginScopeId, get closed() { return sessionClosed; }, get closeComplete() { return sessionCloseComplete; }, closeForRelogin: () => closeSession('switch-user') });
    printSessions.set(sessionAuth, () => !sessionClosed && !closed);
    return result;
  }
  const local = session(auth);
  return {
    ...local, runtime, administration, printing: printJobs, reloginAudit,
    // Internal callers may keep one login limiter across provisional auth
    // objects. This identifier is never read from an HTTP request or used as
    // the separately generated authenticated usage-session identifier.
    createSession({ sourcePeer = 'local', loginScopeId = randomUUID() } = {}) {
      if (!accepting) throw new Error('本机程序正在关闭');
      if (typeof loginScopeId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(loginScopeId)) throw new TypeError('Internal login scope must be a server-issued UUID');
      return session(createAuth(runtime, { administration, sessionId: loginScopeId, sourcePeer }), { sourcePeer, loginScopeId });
    },
    exclusive(action) { return printJobs.withPaused(() => enqueue(action)); },
    close() {
      if (!closing) { closing = (async () => {
        accepting = false;
        await Promise.allSettled([...moduleInflight]);
        await printJobs.close();
        await updates.close();
        await queue;
        for (const attempt of pendingRelogins) completeRelogin(attempt, 503);
        closed = true;
        for (const active of sessions) active.auth.logout();
        sessions.clear();
        printSessions.clear();
        runtime.close();
      })(); } return closing;
    },
  };
}

module.exports = { createBackend };

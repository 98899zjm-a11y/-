'use strict';

const path = require('node:path');
const { createRuntime } = require('./runtime.cjs');
const { createAuth } = require('./local-auth.cjs');

function createBackend({ dataDir, migrationDir, businessPath = path.join(__dirname, 'generated', 'business.cjs') }) {
  const runtime = createRuntime({ dataDir, migrationDir });
  const auth = createAuth(runtime);
  const sessions = new Set();
  let core;
  try { core = require(businessPath); } catch (error) { runtime.close(); throw error; }
  let queue = Promise.resolve(), closed = false;
  const enqueue = action => {
    if (closed) return Promise.reject(new Error('本机程序正在关闭'));
    const result = queue.then(action); queue = result.catch(() => {}); return result;
  };
  function augmentUser(sessionAuth, user) { return { ...user, username: sessionAuth.findUsername(user.id) }; }
  function request(method, address, body) {
    return new Request('http://offline.invalid' + address, { method, ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  }
  async function handle(auth, { path: address, method = 'GET', body }) {
    if (typeof address !== 'string' || !address.startsWith('/') || address.startsWith('//') || address.includes('\\') || address.length > 2500) return { ok: false, status: 400, data: { error: '本机请求地址无效' } };
    const url = new URL(address, 'http://offline.invalid'), pathname = url.pathname;
    method = String(method).toUpperCase();
    if (!['GET', 'POST', 'PATCH'].includes(method)) return { ok: false, status: 405, data: { error: '不支持此操作方式' } };
    try {
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
      if (pathname === '/api/users') {
        if (method === 'GET') return { ok: true, status: 200, data: { users: auth.listUsers() } };
        if (method === 'POST') return { ok: true, status: 201, data: { user: auth.createUser(body) } };
        if (method === 'PATCH') return { ok: true, status: 200, data: { user: auth.updateUser(body) } };
      }
      return await runtime.withIdentity(identity, async () => {
        const req = request(method, address, body);
        const actions = {
          'GET /api/bootstrap': async () => { const result = await core.bootstrap(); return { ...result, user: augmentUser(auth, result.user), users: result.users.map(user => augmentUser(auth, user)) }; },
          'GET /api/customers': async () => ({ customers: (await core.bootstrap()).customers }),
          'POST /api/customers': () => core.createCustomer(req),
          'PATCH /api/customers': () => core.updateCustomer(req),
          'GET /api/quotes': () => core.quotePage(req),
          'POST /api/quotes': () => core.createQuote(req),
          'PATCH /api/settings': () => core.updateSettings(req),
          'POST /api/styles': () => core.createStyle(req),
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
        if (quote && method === 'GET') action = () => core.getQuote(quote[1]);
        if (attachment && method === 'POST') action = () => core.attachQuoteImages(req, attachment[1]);
        if (!action) return { ok: false, status: 404, data: { error: '本机功能不存在' } };
        const response = await core.api(action, method === 'POST' && !pathname.endsWith('/images') ? 201 : 200);
        return { ok: response.ok, status: response.status, data: await response.json() };
      });
    } catch (error) {
      const status = Number.isInteger(error.status) ? error.status : 500;
      return { ok: false, status, data: { error: status === 500 ? '本机操作未完成，请重试' : error.message } };
    }
  }
  function session(sessionAuth) {
    let sessionClosed = false;
    const result = {
      auth: sessionAuth,
      dispatch(input) {
        return enqueue(() => sessionClosed ? { ok: false, status: 401, data: { error: '账号会话已经结束，请重新登录' } } : handle(sessionAuth, input || {}));
      },
      imageResponse(id) {
        return enqueue(async () => {
          const identity = sessionClosed ? null : sessionAuth.identity();
          if (!identity) return Response.json({ error: '请先登录本机账号' }, { status: 401 });
          return runtime.withIdentity(identity, () => core.api(() => core.getImage(String(id))));
        });
      },
      async close() {
        if (sessionClosed) return;
        sessionClosed = true;
        await queue;
        sessionAuth.logout();
        sessions.delete(result);
      },
    };
    sessions.add(result);
    return result;
  }
  const local = session(auth);
  return {
    ...local, runtime,
    createSession() { if (closed) throw new Error('本机程序正在关闭'); return session(createAuth(runtime)); },
    exclusive(action) { return enqueue(action); },
    async close() {
      if (!closed) {
        closed = true;
        await queue;
        for (const active of sessions) active.auth.logout();
        sessions.clear();
        runtime.close();
      }
    },
  };
}

module.exports = { createBackend };

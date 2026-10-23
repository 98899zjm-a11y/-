'use strict';

// Cashier authority stays independent of the ledger process that stores it.
// Live account scope and the stored document kind are checked in that ledger
// transaction; neither can be supplied as an authority claim by a client.
const LEVELS = Object.freeze(['disabled', 'view', 'operate', 'manage']);
const CAPABILITIES = Object.freeze([
  ['read', '查看出纳', 'view'], ['amounts.sensitive', '查看资金金额', 'view'],
  ['sources.read', '查看已发布收付来源', 'view'], ['accounts.manage', '管理资金账户和范围', 'manage'],
  ['documents.prepare', '编制收付款', 'operate'], ['documents.review', '审核收付款', 'manage'],
  ['refunds.prepare', '编制退款', 'operate'], ['refunds.review', '审核退款', 'manage'],
  ['transfers.prepare', '编制账户调拨', 'operate'], ['transfers.review', '审核账户调拨', 'manage'],
  ['opening.prepare', '编制账户期初', 'manage'], ['opening.review', '审核账户期初', 'manage'],
  ['reversals.prepare', '申请资金冲销', 'operate'], ['reversals.review', '审核资金冲销', 'manage'],
  ['reconcile.import', '导入银行账单', 'operate'], ['reconcile.match', '匹配银行账单', 'operate'],
  ['reconcile.review', '复核银行对账', 'manage'], ['reports.view', '查看资金报表', 'view'],
  ['reports.export', '导出资金报表和原件', 'view'],
].map(([key, label, level]) => Object.freeze({ key: 'cashier.' + key, label, module: 'cashier', level,
  description: label + '；账户范围在账套事务中核对', default: false })));
const BY_KEY = new Map(CAPABILITIES.map(item => [item.key, item]));
const UUID = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const UUID_RE = new RegExp('^' + UUID + '$');
const KIND_DOMAINS = Object.freeze({ opening: 'opening', receive: 'documents', pay: 'documents',
  refund: 'refunds', refund_out: 'refunds', refund_in: 'refunds', transfer: 'transfers', reversal: 'reversals' });
const STATIC_FILES = Object.freeze(['cashier.css', 'cashier.js']);
const PAGING = Object.freeze(['limit', 'after']);
const REPORT_KEYS = Object.freeze(['accountId', 'from', 'to', 'asOf']);
const DOCUMENT_FIELDS = Object.freeze(['requestId', 'revision', 'kind', 'accountId', 'businessDate', 'amountCents',
  'note', 'partyId', 'allocations', 'toAccountId', 'originalCashDocId', 'refundBasis', 'targetId', 'evidence']);
function failure(message, status = 400) { const error = new Error(message); error.status = status; return error; }
function isCashierPath(value) {
  if (typeof value !== 'string') return false;
  let pathname = value.split('?')[0];
  try { pathname = decodeURIComponent(pathname); } catch { /* routeFor rejects invalid encoding. */ }
  if (pathname === '/cashier' || pathname.startsWith('/cashier/')) return true;
  // Detection is deliberately broader than acceptance: normalization must not
  // let an ordinary ledger actor sign a hidden cashier destination as v1/v2.
  try { pathname = new URL(value, 'http://127.0.0.1').pathname; } catch { return false; }
  return pathname === '/cashier' || pathname.startsWith('/cashier/');
}
function routeFor(address, method = 'GET') {
  if (typeof address !== 'string' || address.length > 8192 || !address.startsWith('/cashier') ||
      /[\\\x00-\x20\x7f#]/.test(address)) throw failure('出纳地址须为规范相对路径。');
  const url = new URL(address, 'http://127.0.0.1');
  if (url.pathname + url.search !== address || url.pathname.includes('%') || url.pathname.includes('//')) throw failure('出纳地址须为规范相对路径。');
  method = String(method).toUpperCase();
  let operation, endpoint, parameters = [];
  const select = (op, name, keys = []) => { operation = op; endpoint = 'cashier.' + name; parameters = keys; };
  if (['/cashier', '/cashier/'].includes(url.pathname) && method === 'GET') select('read', 'page');
  else if (STATIC_FILES.some(name => url.pathname === '/cashier/static/' + name) && method === 'GET') select('read', 'static');
  else if (url.pathname === '/cashier/api/bootstrap' && method === 'GET') select('read', 'bootstrap');
  else if (url.pathname === '/cashier/api/accounts' && ['GET', 'POST'].includes(method)) select(method === 'GET' ? 'read' : 'account_create', 'accounts');
  else if (new RegExp('^/cashier/api/accounts/' + UUID + '$').test(url.pathname) && method === 'PATCH') select('account_update', 'account_update');
  else if (new RegExp('^/cashier/api/accounts/' + UUID + '/scopes$').test(url.pathname) && method === 'POST') select('scopes', 'scopes');
  else if (url.pathname === '/cashier/api/documents' && ['GET', 'POST'].includes(method)) select(method === 'GET' ? 'money_read' : 'create', 'documents', method === 'GET' ? [...PAGING, 'accountId', 'status', 'kind'] : []);
  else if (new RegExp('^/cashier/api/documents/' + UUID + '$').test(url.pathname) && ['GET', 'PATCH'].includes(method)) select(method === 'GET' ? 'money_read' : 'edit', 'document');
  else if (new RegExp('^/cashier/api/documents/' + UUID + '/(submit|withdraw|review)$').test(url.pathname) && method === 'POST') select(url.pathname.endsWith('/review') ? 'review' : 'prepare', url.pathname.split('/').at(-1));
  else if (url.pathname === '/cashier/api/sources' && method === 'GET') select('sources', 'sources');
  else if (['/cashier/api/postings', '/cashier/api/flows', '/cashier/api/reports/balances'].includes(url.pathname) && method === 'GET') select('report', 'report', [...PAGING, ...REPORT_KEYS]);
  else if (url.pathname === '/cashier/api/reports/daily' && method === 'GET') select('report', 'daily', [...PAGING, 'accountId', 'date']);
  else if (['/cashier/api/export.csv', '/cashier/api/reports/export'].includes(url.pathname) && method === 'GET') select('export', 'export', REPORT_KEYS);
  else if (url.pathname === '/cashier/api/statement-imports' && ['GET', 'POST'].includes(method)) select(method === 'GET' ? 'report' : 'import', 'imports', method === 'GET' ? [...PAGING, 'accountId'] : []);
  else if (url.pathname === '/cashier/api/statement-imports/preview' && method === 'POST') select('import', 'import_preview');
  else if (new RegExp('^/cashier/api/statement-imports/' + UUID + '(/original)?$').test(url.pathname) && method === 'GET') select(url.pathname.endsWith('/original') ? 'export' : 'report', 'import');
  else if (url.pathname === '/cashier/api/reconciliations' && ['GET', 'POST'].includes(method)) select(method === 'GET' ? 'report' : 'match', 'reconciliations', method === 'GET' ? ['accountId'] : []);
  else if (new RegExp('^/cashier/api/reconciliations/' + UUID + '/(review|revoke)$').test(url.pathname) && method === 'POST') select('reconcile_review', 'reconcile_review');
  else if (new RegExp('^/cashier/api/requests/' + UUID + '$').test(url.pathname) && method === 'GET') select('read', 'request');
  else throw failure('出纳操作地址或方法不在允许范围。');
  const seen = new Set();
  for (const [key, value] of url.searchParams) {
    if (!parameters.includes(key) || seen.has(key) || !value || value.length > 300 || /[\x00-\x1f\x7f]/.test(value)) throw failure('出纳查询参数无效。');
    seen.add(key);
    if (key === 'limit' && (!/^[1-9]\d{0,2}$/.test(value) || Number(value) > 200) ||
        key === 'after' && (!/^(?:0|[1-9]\d{0,15})$/.test(value) || !Number.isSafeInteger(Number(value))) ||
        key === 'accountId' && !UUID_RE.test(value) ||
        ['from', 'to', 'asOf', 'date'].includes(key) && !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        key === 'status' && !['draft', 'pending', 'confirmed', 'rejected'].includes(value) ||
        key === 'kind' && !Object.hasOwn(KIND_DOMAINS, value)) throw failure('出纳查询参数超出允许范围。');
  }
  return { path: address, method, operation, endpoint, parameters };
}
function capabilitiesFor(grants) {
  const level = LEVELS.indexOf(grants?.moduleAccess?.cashier);
  return CAPABILITIES.filter(item => level >= LEVELS.indexOf(item.level) && grants?.capabilities?.[item.key] === true).map(item => item.key);
}
function validateCapabilities(actor) {
  if (actor?.protocolVersion !== 3 || actor.module !== 'cashier' || actor.authorityModule !== 'cashier' || actor.storageModule !== 'ledger' ||
      !['view', 'operate', 'manage'].includes(actor.access) || Object.hasOwn(actor, 'accountIds') || Object.hasOwn(actor, 'scopeRevision') ||
      !Array.isArray(actor.capabilities) || actor.capabilities.length > CAPABILITIES.length || new Set(actor.capabilities).size !== actor.capabilities.length ||
      actor.capabilities.some(key => typeof key !== 'string' || !BY_KEY.has(key))) throw failure('出纳独立签名权限无效。', 403);
  const level = LEVELS.indexOf(actor.access);
  if (actor.capabilities.some(key => level < LEVELS.indexOf(BY_KEY.get(key).level))) throw failure('出纳权限超出模块级别。', 403);
  if (!actor.capabilities.includes('cashier.read')) throw failure('管理员尚未授权出纳查看。', 403);
  return actor.capabilities;
}
function fields(body, keys) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !keys.includes(key))) throw failure('出纳正文包含不允许的字段。');
}
function requestBody(input, route) {
  if (route.method === 'GET') {
    if (input.bodyBase64 !== undefined && input.bodyBase64 !== '') throw failure('出纳读取请求不能携带正文。');
    return {};
  }
  const headers = input.headers || {};
  if (typeof headers !== 'object' || Array.isArray(headers)) throw failure('出纳请求头无效。');
  const types = Object.entries(headers).filter(([key]) => key.toLowerCase() === 'content-type');
  if (types.length !== 1 || types[0][1] !== 'application/json') throw failure('出纳写入只接受JSON正文。');
  const encoded = input.bodyBase64;
  if (typeof encoded !== 'string' || encoded.length > 20 * 1024 * 1024 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw failure('出纳正文编码无效。');
  let body;
  try { body = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')); } catch { throw failure('出纳正文JSON无效。'); }
  let keys;
  switch (route.operation) {
    case 'account_create': keys = ['requestId', 'code', 'name', 'kind', 'currency', 'maskedReference', 'note']; break;
    case 'account_update': keys = ['requestId', 'revision', 'name', 'maskedReference', 'note', 'active']; break;
    case 'scopes': keys = ['requestId', 'staffId', 'level', 'revision', 'note']; break;
    case 'create': case 'edit': keys = DOCUMENT_FIELDS; break;
    case 'prepare': keys = ['requestId', 'revision', 'note']; break;
    case 'review': keys = ['requestId', 'revision', 'hash', 'decision', 'note']; break;
    case 'import': keys = ['requestId', 'accountId', 'csvBase64', 'encoding', 'mapping', 'previewHash', 'name']; break;
    case 'match': keys = ['requestId', 'accountId', 'matches', 'note']; break;
    case 'reconcile_review': keys = route.path.endsWith('/revoke') ? ['requestId', 'revision', 'note'] : ['requestId', 'revision', 'hash', 'decision', 'note']; break;
    default: throw failure('出纳写入入口无效。');
  }
  fields(body, keys);
  if (body.allocations !== undefined) {
    if (!Array.isArray(body.allocations) || body.allocations.length > 100) throw failure('出纳来源分配无效。');
    for (const item of body.allocations) fields(item, ['releaseId', 'amountCents']);
  }
  if (body.mapping !== undefined) fields(body.mapping, ['date', 'amount', 'externalId', 'description']);
  if (body.matches !== undefined) {
    if (!Array.isArray(body.matches) || body.matches.length > 10000) throw failure('出纳对账匹配无效。');
    for (const item of body.matches) fields(item, ['statementRowId', 'postingId']);
  }
  return body;
}
function authorizeRequest(input, grants) {
  if (input?.module !== 'cashier') throw failure('出纳需要独立模块权限。', 403);
  const route = routeFor(input.path, input.method || 'GET');
  const capabilities = capabilitiesFor(grants), allowed = new Set(capabilities);
  const requireKey = key => { if (!allowed.has(key)) throw failure('管理员尚未授权此出纳操作能力。', 403); };
  requireKey('cashier.read');
  const body = requestBody(input, route);
  if (!['read', 'account_create', 'account_update', 'scopes'].includes(route.operation)) requireKey('cashier.amounts.sensitive');
  if (['account_create', 'account_update', 'scopes'].includes(route.operation)) requireKey('cashier.accounts.manage');
  if (route.operation === 'sources') requireKey('cashier.sources.read');
  if (route.operation === 'report') requireKey('cashier.reports.view');
  if (route.operation === 'export') requireKey('cashier.reports.export');
  if (route.operation === 'import') requireKey('cashier.reconcile.import');
  if (route.operation === 'match') requireKey('cashier.reconcile.match');
  if (route.operation === 'reconcile_review') requireKey('cashier.reconcile.review');
  if (['create', 'edit', 'prepare', 'review'].includes(route.operation)) {
    const stage = route.operation === 'review' ? 'review' : 'prepare';
    const domain = typeof body.kind === 'string' && Object.hasOwn(KIND_DOMAINS, body.kind) ? KIND_DOMAINS[body.kind] : undefined;
    if ((route.operation === 'create' || route.operation === 'edit') && !domain) throw failure('出纳资金凭证类型无效。');
    if (domain) requireKey('cashier.' + domain + '.' + stage);
    // For actions on existing documents Python resolves the stored kind and
    // checks its exact capability, author/reviewer and current account scope.
    else if (!Object.values(KIND_DOMAINS).some(name => allowed.has('cashier.' + name + '.' + stage))) throw failure('管理员尚未授权出纳制单或审核。', 403);
  }
  return { route, capabilities, authorityModule: 'cashier', storageModule: 'ledger' };
}
module.exports = { CAPABILITIES, STATIC_FILES, REPORT_KEYS, isCashierPath, routeFor, capabilitiesFor, validateCapabilities, authorizeRequest };

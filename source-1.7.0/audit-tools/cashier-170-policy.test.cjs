'use strict';

// Contract only. Root runs this in the admitted offline Guest before any
// implementation. This test does not open SQLite, spawn product processes,
// call a bank, read production files, or infer actual money from a sale.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { createHash } = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
if (process.platform !== 'win32' || os.userInfo().username.toLowerCase() !== 'wdagutilityaccount' || ROOT.toLowerCase() !== 'c:\\xjy-work\\xjy-web-stage1') throw Error('Cashier contracts require the fixed actual offline Windows Sandbox');
const guardFile = path.join(ROOT, 'stage1/guest-candidate-cdp.cjs');
if (createHash('sha256').update(fs.readFileSync(guardFile)).digest('hex') !== '59840b638d8797fb55241616cd0b8e4098075a76834a201b0e93c1a748f1bb32') throw Error('Actual Sandbox guard source changed');
require(guardFile).actualGuard();
const guard = require('../stage1/isolation.cjs').createIsolationGuard(ROOT);
const test = require('node:test'), assert = require('node:assert/strict');
const SOURCE = path.join(ROOT, 'project/desktop/cashier-policy.cjs');
const policy = fs.existsSync(SOURCE) ? require(guard.assertPath(SOURCE)) : {};
const ID = '40000000-0000-4000-8000-000000000001';
const REQUEST = '40000000-0000-4000-8000-000000000002';
const ACCOUNT = '40000000-0000-4000-8000-000000000003';
const HASH = 'a'.repeat(64);
const keyList = [
  'cashier.read', 'cashier.amounts.sensitive', 'cashier.sources.read',
  'cashier.accounts.manage', 'cashier.documents.prepare', 'cashier.documents.review',
  'cashier.refunds.prepare', 'cashier.refunds.review', 'cashier.transfers.prepare', 'cashier.transfers.review',
  'cashier.opening.prepare', 'cashier.opening.review', 'cashier.reversals.prepare', 'cashier.reversals.review',
  'cashier.reconcile.import', 'cashier.reconcile.match', 'cashier.reconcile.review',
  'cashier.reports.view', 'cashier.reports.export',
];
function feature() {
  for (const name of ['routeFor', 'capabilitiesFor', 'validateCapabilities', 'authorizeRequest']) assert.equal(typeof policy[name], 'function', `FEATURE_REQUIRED: independent cashier ${name}`);
  assert(Array.isArray(policy.CAPABILITIES), 'FEATURE_REQUIRED: explicit cashier capability catalog');
  return policy;
}
function grants(level = 'operate', keys = ['cashier.read', 'cashier.amounts.sensitive', 'cashier.documents.prepare']) {
  return { moduleAccess: { cashier: level, sales: 'disabled', ledger: 'disabled', inventory: 'disabled' }, grantRevision: 3, capabilities: Object.fromEntries(keys.map(key => [key, true])) };
}
function request(url, method = 'GET', body) {
  return { module: 'cashier', path: url, method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, bodyBase64: Buffer.from(JSON.stringify(body)).toString('base64') }) };
}
function receive(extra = {}) {
  return { requestId: REQUEST, kind: 'receive', accountId: ACCOUNT, businessDate: '2026-10-19', amountCents: '12345', allocations: [{ releaseId: ID, amountCents: '12345' }], note: '虚构合同收款', ...extra };
}
const status = expected => error => error?.status === expected;
function allows(p, r, g) { const out = p.authorizeRequest(r, g); assert.equal(out.authorityModule, 'cashier'); assert.equal(out.storageModule, 'ledger'); assert(out.capabilities.includes('cashier.read')); assert(out.capabilities.every(key => key.startsWith('cashier.'))); return out; }

test('C01 capability catalog is independent and explicit with no default employee grant', () => {
  const p = feature(), actual = p.CAPABILITIES;
  assert.deepEqual(actual.map(x => x.key).sort(), [...keyList].sort());
  assert.equal(new Set(actual.map(x => x.key)).size, actual.length);
  for (const item of actual) { assert.equal(item.module, 'cashier'); assert.equal(item.default, false); assert(['view', 'operate', 'manage'].includes(item.level)); }
  for (const key of ['cashier.accounts.manage', 'cashier.opening.prepare', 'cashier.opening.review', 'cashier.documents.review', 'cashier.reconcile.review']) assert.equal(actual.find(x => x.key === key).level, 'manage');
});

test('C02 cashier operator with all other modules disabled can prepare a receipt without fabricated ledger authority', () => {
  const p = feature(), g = grants(), before = JSON.stringify(g);
  const out = allows(p, request('/cashier/api/documents', 'POST', receive()), g);
  assert.equal(out.route.path, '/cashier/api/documents'); assert.equal(out.route.method, 'POST');
  assert.equal(JSON.stringify(g), before, 'authorizer must not grant ledger operate as a side effect');
});

test('C03 full ledger and ERP rights do not substitute for an explicit cashier module grant', () => {
  const p = feature(), g = grants('disabled', keyList); g.moduleAccess.ledger = 'manage';
  g.capabilities['erp.read'] = true; g.capabilities['erp.settlement.review'] = true;
  assert.throws(() => p.authorizeRequest(request('/cashier/api/bootstrap'), g), status(403));
  assert.deepEqual(p.capabilitiesFor(g), []);
});

test('C04 cashier view can read minimal accounts but cannot write even with stale write capability booleans', () => {
  const p = feature(), g = grants('view', keyList);
  allows(p, request('/cashier/api/accounts'), g);
  assert.throws(() => p.authorizeRequest(request('/cashier/api/documents', 'POST', receive()), g), status(403));
  assert(!p.capabilitiesFor(g).includes('cashier.documents.prepare'));
  assert(!p.capabilitiesFor(g).includes('cashier.documents.review'));
});

test('C05 receipt preparation does not grant refund or transfer preparation', () => {
  const p = feature(), g = grants();
  for (const body of [receive({ kind: 'refund_out', originalCashDocId: ID }), receive({ kind: 'transfer', toAccountId: ID })]) assert.throws(() => p.authorizeRequest(request('/cashier/api/documents', 'POST', body), g), status(403));
  const refund = grants('operate', ['cashier.read', 'cashier.amounts.sensitive', 'cashier.refunds.prepare']);
  allows(p, request('/cashier/api/documents', 'POST', { requestId: REQUEST, kind: 'refund_out', originalCashDocId: ID, accountId: ACCOUNT, businessDate: '2026-10-19', amountCents: '100', note: '虚构退款' }), refund);
  assert.throws(() => p.authorizeRequest(request('/cashier/api/documents', 'POST', receive()), refund), status(403));
});

test('C06 opening and review need manage level and explicit capabilities', () => {
  const p = feature(), operate = grants('operate', keyList);
  const opening = request('/cashier/api/documents', 'POST', { requestId: REQUEST, kind: 'opening', accountId: ACCOUNT, businessDate: '2026-10-19', amountCents: '0', note: '虚构零期初', evidence: '虚构人工核对凭证' });
  assert.throws(() => p.authorizeRequest(opening, operate), status(403));
  allows(p, opening, grants('manage', ['cashier.read', 'cashier.amounts.sensitive', 'cashier.opening.prepare']));
  const review = request(`/cashier/api/documents/${ID}/review`, 'POST', { requestId: REQUEST, revision: 2, hash: HASH, decision: 'approve', note: '虚构复核' });
  assert.throws(() => p.authorizeRequest(review, operate), status(403));
  assert.throws(() => p.authorizeRequest(review, grants('manage', ['cashier.read', 'cashier.amounts.sensitive'])), status(403));
  allows(p, review, grants('manage', ['cashier.read', 'cashier.amounts.sensitive', 'cashier.documents.review']));
});

test('C07 lack of sensitive amount authority blocks money queries exports and amount writes', () => {
  const p = feature(), g = grants('manage', keyList.filter(key => key !== 'cashier.amounts.sensitive'));
  allows(p, request('/cashier/api/bootstrap'), g);
  for (const url of ['/cashier/api/flows', '/cashier/api/sources', '/cashier/api/reports/daily?date=2026-10-19', '/cashier/api/export.csv']) assert.throws(() => p.authorizeRequest(request(url), g), status(403));
  assert.throws(() => p.authorizeRequest(request('/cashier/api/documents', 'POST', receive()), g), status(403));
});

test('C08 source and export privileges are explicit and cannot be inferred from money visibility', () => {
  const p = feature(), g = grants('view', ['cashier.read', 'cashier.amounts.sensitive']);
  assert.throws(() => p.authorizeRequest(request('/cashier/api/sources'), g), status(403));
  assert.throws(() => p.authorizeRequest(request('/cashier/api/export.csv'), g), status(403));
  allows(p, request('/cashier/api/sources'), grants('view', ['cashier.read', 'cashier.amounts.sensitive', 'cashier.sources.read']));
  allows(p, request('/cashier/api/reports/daily?date=2026-10-19'), grants('view', ['cashier.read', 'cashier.amounts.sensitive', 'cashier.reports.view']));
});

test('C09 cashier capability cannot address financial pages ERP routes inventory or remote URLs', () => {
  const p = feature(), g = grants('manage', keyList);
  for (const url of ['/erp/api/bootstrap', '/erp/api/documents', '/finance', '/api/sales-orders', '/inventory', 'http://127.0.0.1/cashier/api/accounts', '//example.test/cashier/api/accounts']) assert.throws(() => p.authorizeRequest(request(url), g));
  assert.throws(() => p.authorizeRequest({ ...request('/cashier/api/accounts'), module: 'ledger' }, g), status(403));
});

test('C10 canonical route parsing rejects encoded traversal double slashes fragments and unknown verbs', () => {
  const p = feature();
  for (const url of ['/cashier//api/accounts', '/cashier/api/%61ccounts', '/cashier/api/../api/accounts', '/cashier/api/%2e%2e/erp', '/cashier/api/accounts#x', '/cashier/api/accounts\\x', '/cashier/api/accounts\u0000']) assert.throws(() => p.routeFor(url, 'GET'), status(400));
  for (const method of ['DELETE', 'PUT', 'TRACE', 'CONNECT']) assert.throws(() => p.routeFor('/cashier/api/documents', method), status(400));
  assert.throws(() => p.routeFor(`/cashier/api/documents/${ID}/review`, 'GET'), status(400));
});

test('C11 query parsing rejects duplicate unknown and out of range pagination', () => {
  const p = feature();
  for (const url of ['/cashier/api/documents?limit=20&limit=30', '/cashier/api/documents?limit=201', '/cashier/api/documents?limit=-1', '/cashier/api/documents?path=/erp/api/bootstrap', '/cashier/api/documents?actorId=' + ID]) assert.throws(() => p.routeFor(url, 'GET'), status(400));
  assert.equal(p.routeFor('/cashier/api/documents?limit=25&after=17', 'GET').method, 'GET');
});

test('C12 client authority fields are refused instead of ignored or signed', () => {
  const p = feature(), g = grants();
  for (const extra of [{ actor: { staffId: ID, role: 'admin' } }, { capabilities: keyList }, { grants: { ledger: 'manage' } }, { authorityModule: 'ledger' }, { storageModule: 'ledger' }, { protocolVersion: 3 }, { principal: 'forged' }]) assert.throws(() => p.authorizeRequest(request('/cashier/api/documents', 'POST', receive(extra)), g), status(400));
  assert.throws(() => p.authorizeRequest({ ...request('/cashier/api/documents', 'POST', receive()), headers: { 'content-type': 'text/plain' } }, g), status(400));
  assert.throws(() => p.authorizeRequest({ ...request('/cashier/api/documents', 'POST', receive()), bodyBase64: '%%%invalid' }, g), status(400));
});

test('C13 cashier principal validation requires exact independent domain and compatible known capabilities', () => {
  const p = feature();
  const actor = { protocolVersion: 3, module: 'cashier', authorityModule: 'cashier', storageModule: 'ledger', access: 'operate', capabilities: ['cashier.read', 'cashier.amounts.sensitive', 'cashier.documents.prepare'] };
  assert.deepEqual(p.validateCapabilities(actor), actor.capabilities);
  for (const patch of [{ protocolVersion: 2 }, { module: 'ledger' }, { authorityModule: 'ledger' }, { storageModule: 'inventory' }, { capabilities: ['cashier.read', 'erp.read'] }, { capabilities: ['cashier.read', 'cashier.unknown'] }, { capabilities: ['cashier.read', 'cashier.read'] }, { capabilities: ['cashier.read', 'cashier.documents.review'] }, { capabilities: ['cashier.documents.prepare'] }, { access: 'disabled' }]) assert.throws(() => p.validateCapabilities({ ...actor, ...patch }), status(403));
});

test('C14 capability projection cannot carry ledger or over-level grants to the cash process', () => {
  const p = feature(), g = grants('operate', [...keyList, 'erp.read', 'erp.reports.sensitive', 'sales.orders.review']);
  const caps = p.capabilitiesFor(g);
  assert(caps.includes('cashier.documents.prepare')); assert(caps.every(key => key.startsWith('cashier.')));
  for (const key of ['cashier.accounts.manage', 'cashier.documents.review', 'cashier.opening.prepare', 'cashier.reconcile.review']) assert(!caps.includes(key));
});

test('C15 review does not trust a client kind to select weaker authority than the stored document', () => {
  const p = feature(), g = grants('manage', keyList);
  assert.throws(() => p.authorizeRequest(request(`/cashier/api/documents/${ID}/review`, 'POST', { requestId: REQUEST, revision: 2, hash: HASH, decision: 'approve', note: '虚构', kind: 'receive' }), g), status(400));
  assert.throws(() => p.authorizeRequest(request(`/cashier/api/documents/${ID}/review`, 'POST', { requestId: REQUEST, revision: 2, hash: HASH, decision: 'approve', note: '虚构', authorId: ID }), g), status(400));
});

test('C16 import and matching authority never implies reconciliation approval', () => {
  const p = feature(), g = grants('operate', ['cashier.read', 'cashier.amounts.sensitive', 'cashier.reconcile.import', 'cashier.reconcile.match']);
  allows(p, request('/cashier/api/statement-imports/preview', 'POST', { requestId: REQUEST, accountId: ACCOUNT, csvBase64: Buffer.from('date,amount\n2026-10-19,1.00\n').toString('base64'), mapping: { date: 'date', amount: 'amount' } }), g);
  assert.throws(() => p.authorizeRequest(request(`/cashier/api/reconciliations/${ID}/review`, 'POST', { requestId: REQUEST, revision: 1, hash: HASH, decision: 'approve', note: '虚构对账' }), g), status(403));
});

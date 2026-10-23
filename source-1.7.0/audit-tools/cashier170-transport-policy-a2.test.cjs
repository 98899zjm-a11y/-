'use strict';

// Exact saved proxy and its real canonical/body/header/signer helpers. Only
// owned process startup and loopback I/O are DI ports: no EXE, socket or DB.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
if (process.platform !== 'win32' || os.userInfo().username.toLowerCase() !== 'wdagutilityaccount' || ROOT.toLowerCase() !== 'c:\\xjy-work\\xjy-web-stage1') throw Error('Cashier transport contracts require the fixed actual offline Windows Sandbox');
const guardFile = path.join(ROOT, 'stage1/guest-candidate-cdp.cjs');
if (crypto.createHash('sha256').update(fs.readFileSync(guardFile)).digest('hex') !== '59840b638d8797fb55241616cd0b8e4098075a76834a201b0e93c1a748f1bb32') throw Error('Actual Sandbox guard source changed');
require(guardFile).actualGuard();
const guard = require('../stage1/isolation.cjs').createIsolationGuard(ROOT);
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), { createRequire } = require('node:module');
const CODE = guard.assertPath(path.join(ROOT, 'project/desktop/legacy-modules.cjs')), source = fs.readFileSync(CODE, 'utf8');
const prefixEnd = source.indexOf('function createLegacyModules('), begin = source.indexOf('  async function proxy(input, authority = {}) {'), end = source.indexOf('\n  function close(', begin);
assert(prefixEnd > 0 && begin > prefixEnd && end > begin, 'Exact proxy extraction markers required');
const loaded = { exports: {} }, realRequire = createRequire(CODE);
const harness = source.slice(0, prefixEnd) + '\nmodule.exports = function(ports) { const {start,requestLocal} = ports;\n' + source.slice(begin, end) + '\nreturn proxy; };\n';
vm.runInThisContext('(function(require,module,exports,__filename,__dirname){\n' + harness + '\n})', { filename: CODE })(realRequire, loaded, loaded.exports, CODE, path.dirname(CODE));
const erp = require(guard.assertPath(path.join(ROOT, 'project/desktop/erp-policy.cjs')));
const ID = '40000000-0000-4000-8000-000000000010', OTHER = '40000000-0000-4000-8000-000000000011';
const TOKEN = 'transport-contract-only-not-a-key';
const CASH_CAPS = ['cashier.read', 'cashier.amounts.sensitive', 'cashier.documents.prepare'];
const actor = patch => ({ protocolVersion: 3, module: 'cashier', authorityModule: 'cashier', storageModule: 'ledger', staffId: ID, userId: ID, name: '虚构出纳', role: 'employee', access: 'operate', grantRevision: 7, capabilities: CASH_CAPS, ...patch });
const ledgerActor = patch => ({ protocolVersion: 2, module: 'ledger', staffId: OTHER, userId: OTHER, name: '虚构财务', role: 'employee', access: 'manage', grantRevision: 9, capabilities: ['erp.read', 'erp.cashier.release'], ...patch });
function input(url = '/cashier/api/bootstrap', method = 'GET', body) { return { module: 'ledger', path: url, method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, bodyBase64: Buffer.from(JSON.stringify(body)).toString('base64') }) }; }
const receipt = () => ({ requestId: OTHER, kind: 'receive', accountId: ID, businessDate: '2026-10-19', amountCents: '100', allocations: [{ releaseId: ID, amountCents: '100' }], note: '仅传输合同' });
function fixture(response = {}) {
  const starts = [], calls = [], hooks = {}, child = { exitCode: null, signalCode: null, killed: false };
  const proxy = loaded.exports({ async start(...args) { starts.push(args); if (hooks.start) await hooks.start(); return { child, ready: true, port: 41919, token: TOKEN }; },
    async requestLocal(port, token, request) { calls.push({ port, token, request }); return { status: response.status || 200, headers: response.headers || {}, bytes: Buffer.from('{}') }; } });
  return { proxy, starts, calls, hooks };
}
const rejected = status => error => error?.status === status;

test('T01 exact proxy signs cashier v3 for ledger storage and starts the ordinary existing module once', async () => {
  const f = fixture(), original = input('/cashier/api/documents', 'POST', receipt());
  await f.proxy(original, { actor: actor(), getActor: async () => actor() });
  assert.deepEqual(f.starts, [['ledger']]); assert.equal(f.calls.length, 1);
  const { request, token } = f.calls[0], encoded = request.headers['x-xjy-principal'], signed = JSON.parse(Buffer.from(encoded, 'base64url'));
  assert.equal(signed.module, 'cashier'); assert.equal(signed.authorityModule, 'cashier'); assert.equal(signed.storageModule, 'ledger'); assert.equal(signed.protocolVersion, 3);
  assert.equal(signed.decodedPath, original.path); assert.equal(signed.bodySha256, crypto.createHash('sha256').update(Buffer.from(original.bodyBase64, 'base64')).digest('hex'));
  assert.equal(request.headers['x-xjy-principal-signature'], crypto.createHmac('sha256', token).update('xjy-cashier-principal-v1\0').update(encoded, 'ascii').digest('hex'));
});
test('T02 ordinary ledger actor and wrong storage namespace cannot enter cashier', async () => {
  for (const [value, principal] of [[input(), ledgerActor()], [{ ...input(), module: 'inventory' }, actor()], [input(), actor({ authorityModule: 'ledger' })], [input(), actor({ storageModule: 'inventory' })]]) {
    const f = fixture(); await assert.rejects(f.proxy(value, { actor: principal }), rejected(403)); assert.equal(f.starts.length, 0); assert.equal(f.calls.length, 0);
  }
});
test('T03 cashier actor never reaches financial ERP lifecycle or arbitrary routes', async () => {
  for (const url of ['/finance', '/erp/api/bootstrap', '/erp/api/cashier-source-releases', '/_xjy/initialize', '/_xjy/shutdown', '/static/cashier.js', '/xjy/collaboration/source']) {
    const f = fixture(); await assert.rejects(f.proxy(input(url), { actor: actor() }), rejected(403)); assert.equal(f.starts.length, 0); assert.equal(f.calls.length, 0);
  }
});
test('T04 fresh actor must keep issuer identity domain and exact money capability', async () => {
  for (const [fresh, code] of [[actor({ staffId: OTHER, userId: OTHER }), 401], [actor({ storageModule: 'inventory' }), 403], [actor({ capabilities: ['cashier.read'] }), 403], [ledgerActor(), 403]]) {
    const f = fixture(); await assert.rejects(f.proxy(input('/cashier/api/documents', 'POST', receipt()), { actor: actor(), getActor: async () => fresh }), rejected(code)); assert.equal(f.calls.length, 0);
  }
});
test('T05 cashier redirects stay on a precise allowed GET destination', async () => {
  for (const target of ['/cashier/', '/cashier/api/accounts']) {
    const f = fixture({ status: 302, headers: { location: target } }); assert.equal((await f.proxy(input(), { actor: actor() })).headers.location, target);
  }
  for (const target of ['/finance', '/erp/api/bootstrap', '/_xjy/shutdown', '/static/cashier.js', '/cashier/unknown', '/cashier/api/%61ccounts', '/cashier/api/accounts#fragment', 'https://example.invalid/cashier/']) {
    const f = fixture({ status: 302, headers: { location: target } }); await assert.rejects(f.proxy(input(), { actor: actor() }), rejected(502), target);
  }
});
test('T06 both source operations retain ledger v2 manage and the legacy MAC', async () => {
  for (const [url, body] of [['/erp/api/cashier-source-releases', { requestId: ID, billId: OTHER, revision: 1, hash: 'a'.repeat(64), note: '虚构发布' }], ['/erp/api/cashier-source-releases/' + ID + '/revoke', { requestId: OTHER, revision: 1, note: '虚构撤回' }]]) {
    const f = fixture(); await f.proxy(input(url, 'POST', body), { actor: ledgerActor(), getActor: async () => ledgerActor() });
    const headers = f.calls[0].request.headers, signed = JSON.parse(Buffer.from(headers['x-xjy-principal'], 'base64url'));
    assert.equal(signed.protocolVersion, 2); assert.equal(signed.module, 'ledger'); assert.equal(signed.access, 'manage'); assert(signed.capabilities.includes('erp.cashier.release')); assert(!Object.hasOwn(signed, 'authorityModule'));
    assert.equal(headers['x-xjy-principal-signature'], crypto.createHmac('sha256', TOKEN).update(headers['x-xjy-principal']).digest('hex'));
  }
});
test('T07 source grants routes methods queries and authority fields remain explicit', () => {
  const value = input('/erp/api/cashier-source-releases', 'POST', { requestId: ID, billId: OTHER, revision: 1, hash: 'a'.repeat(64), note: '虚构' });
  const grants = (level, keys) => ({ moduleAccess: { ledger: level, cashier: 'manage' }, capabilities: Object.fromEntries(keys.map(key => [key, true])) });
  assert.doesNotThrow(() => erp.authorizeRequest(value, grants('manage', ['erp.read', 'erp.cashier.release'])));
  for (const g of [grants('operate', ['erp.read', 'erp.cashier.release']), grants('manage', ['erp.read']), grants('manage', ['erp.cashier.release']), grants('disabled', ['cashier.read', 'cashier.documents.review'])]) assert.throws(() => erp.authorizeRequest(value, g), rejected(403));
  assert.throws(() => erp.authorizeRequest({ ...value, module: 'cashier' }, grants('manage', ['erp.read', 'erp.cashier.release'])), rejected(403));
  for (const [url, method] of [[value.path, 'GET'], [value.path + '?actorId=' + ID, 'POST'], [value.path + '/unknown/revoke', 'POST'], [value.path + '/' + ID + '/revoke', 'DELETE']]) assert.throws(() => erp.routeFor(url, method), rejected(400));
  const forged = { requestId: ID, billId: OTHER, revision: 1, hash: 'a'.repeat(64), note: '虚构', actor: { role: 'admin' } };
  assert.throws(() => erp.authorizeRequest(input(value.path, 'POST', forged), grants('manage', ['erp.read', 'erp.cashier.release'])), rejected(400));
});
test('T08 source catalog addition preserves each of the prior fifteen minimum levels', () => {
  const expected = [['read','view'],['parties.manage','operate'],['purchase.prepare','operate'],['purchase.review','manage'],['receipt.prepare','operate'],['receipt.review','manage'],['bill.prepare','operate'],['bill.review','manage'],['settlement.prepare','operate'],['settlement.review','manage'],['reversal.prepare','operate'],['reversal.review','manage'],['reports.view','view'],['reports.sensitive','view'],['attachments.write','operate'],['cashier.release','manage']];
  assert.deepEqual(erp.CAPABILITIES.map(item => [item.key, item.level]), expected.map(([key, level]) => ['erp.' + key, level]));
  assert(erp.CAPABILITIES.every(item => item.module === 'ledger' && item.default === false));
});
test('T09 caller mutation during startup cannot weaken the original cash request recheck', async () => {
  const f = fixture(), value = input('/cashier/api/documents', 'POST', receipt());
  f.hooks.start = () => { value.path = '/cashier/api/bootstrap'; value.method = 'GET'; delete value.bodyBase64; delete value.headers; };
  await assert.rejects(f.proxy(value, { actor: actor(), getActor: async () => actor({ capabilities: ['cashier.read'] }) }), rejected(403));
  assert.equal(f.calls.length, 0);
});

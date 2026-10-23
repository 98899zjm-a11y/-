'use strict';

// Test the existing transport signer, without starting a module or opening a
// database. Token is a literal test value and never an installation credential.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
if (process.platform !== 'win32' || os.userInfo().username.toLowerCase() !== 'wdagutilityaccount' || ROOT.toLowerCase() !== 'c:\\xjy-work\\xjy-web-stage1') throw Error('Cashier signer contracts require the fixed actual offline Windows Sandbox');
const guardFile = path.join(ROOT, 'stage1/guest-candidate-cdp.cjs');
if (crypto.createHash('sha256').update(fs.readFileSync(guardFile)).digest('hex') !== '59840b638d8797fb55241616cd0b8e4098075a76834a201b0e93c1a748f1bb32') throw Error('Actual Sandbox guard source changed');
require(guardFile).actualGuard();
const guard = require('../stage1/isolation.cjs').createIsolationGuard(ROOT);
const test = require('node:test'), assert = require('node:assert/strict');
const { signPrincipal } = require(guard.assertPath(path.join(ROOT, 'project/desktop/legacy-modules.cjs')));
const TOKEN = 'cashier-contract-only-not-a-secret-2026-10-19';
const NOW = 1792396800000;
const EMPTY = Buffer.alloc(0);
const BODY = Buffer.from('{"requestId":"40000000-0000-4000-8000-000000000002","kind":"receive","amountCents":"12345"}');
const STATUS403 = error => error?.status === 403;
function actor(patch = {}) { return { module: 'cashier', authorityModule: 'cashier', storageModule: 'ledger', protocolVersion: 3, staffId: '40000000-0000-4000-8000-000000000010', userId: '40000000-0000-4000-8000-000000000010', name: '虚构出纳甲', role: 'employee', access: 'operate', grantRevision: 7, capabilities: ['cashier.read', 'cashier.amounts.sensitive', 'cashier.documents.prepare'], ...patch }; }
function decoded(headers) { return JSON.parse(Buffer.from(headers['x-xjy-principal'], 'base64url').toString('utf8')); }

test('S01 signer preserves cashier authority and ledger storage as different signed fields', () => {
  const original = actor(), headers = signPrincipal(TOKEN, original, '/cashier/api/documents', 'POST', BODY, NOW), signed = decoded(headers);
  assert.equal(signed.protocolVersion, 3, 'CASHIER_PRINCIPAL_REQUIRED: generic module authority cannot represent an independent cashier');
  assert.equal(signed.module, 'cashier'); assert.equal(signed.authorityModule, 'cashier'); assert.equal(signed.storageModule, 'ledger');
  assert.deepEqual(signed.capabilities, original.capabilities); assert.equal(signed.staffId, original.staffId); assert.equal(signed.grantRevision, 7);
  assert.equal(signed.issuedAt, NOW); assert.equal(signed.expiresAt, NOW + 30000);
});

test('S02 cash MAC uses its own domain and cannot equal a generic ledger MAC', () => {
  const headers = signPrincipal(TOKEN, actor(), '/cashier/api/documents', 'POST', BODY, NOW), encoded = headers['x-xjy-principal'];
  const expected = crypto.createHmac('sha256', TOKEN).update('xjy-cashier-principal-v1\0', 'utf8').update(encoded, 'ascii').digest('hex');
  const generic = crypto.createHmac('sha256', TOKEN).update(encoded, 'ascii').digest('hex');
  assert.equal(headers['x-xjy-principal-signature'], expected, 'CASHIER_MAC_DOMAIN_REQUIRED');
  assert.notEqual(headers['x-xjy-principal-signature'], generic);
});

test('S03 cash principal is refused for all noncash financial and internal lifecycle routes', () => {
  for (const url of ['/', '/finance', '/erp/api/bootstrap', '/xjy/collaboration/source', '/_xjy/initialize', '/_xjy/shutdown']) assert.throws(() => signPrincipal(TOKEN, actor(), url, 'GET', EMPTY, NOW), STATUS403, url);
});

test('S04 regular ledger principal cannot be used to enter cashier routes', () => {
  const principal = actor({ module: 'ledger', authorityModule: undefined, storageModule: undefined, protocolVersion: 2, capabilities: ['erp.read'] });
  assert.throws(() => signPrincipal(TOKEN, principal, '/cashier/api/accounts', 'GET', EMPTY, NOW), STATUS403);
});

test('S05 missing forged or wrong storage domains fail before signing', () => {
  for (const patch of [{ protocolVersion: 2 }, { authorityModule: 'ledger' }, { authorityModule: undefined }, { storageModule: 'inventory' }, { storageModule: undefined }]) assert.throws(() => signPrincipal(TOKEN, actor(patch), '/cashier/api/accounts', 'GET', EMPTY, NOW), STATUS403);
});

test('S06 unknown duplicate ERP and over-level cash capabilities cannot be signed', () => {
  for (const capabilities of [['cashier.read', 'erp.read'], ['cashier.read', 'cashier.unknown'], ['cashier.read', 'cashier.read'], ['cashier.read', 'cashier.documents.review'], ['cashier.documents.prepare']]) assert.throws(() => signPrincipal(TOKEN, actor({ capabilities }), '/cashier/api/accounts', 'GET', EMPTY, NOW), STATUS403);
});

test('S07 signed cash request binds exact method path query bytes body and distinct nonce', () => {
  const a = signPrincipal(TOKEN, actor(), '/cashier/api/documents?limit=25&after=17', 'GET', EMPTY, NOW);
  const b = signPrincipal(TOKEN, actor(), '/cashier/api/documents', 'POST', BODY, NOW);
  const x = decoded(a), y = decoded(b);
  assert.equal(x.protocolVersion, 3); assert.equal(x.method, 'GET'); assert.equal(x.decodedPath, '/cashier/api/documents'); assert.equal(x.query, 'limit=25&after=17');
  assert.equal(y.bodySha256, crypto.createHash('sha256').update(BODY).digest('hex')); assert.equal(y.method, 'POST'); assert.equal(y.query, '');
  assert.notEqual(x.nonce, y.nonce); assert.notEqual(a['x-xjy-principal-signature'], b['x-xjy-principal-signature']);
});

test('S08 original ledger and ERP signatures retain their exact legacy MAC domain', () => {
  const base = { module: 'ledger', staffId: '40000000-0000-4000-8000-000000000011', userId: '40000000-0000-4000-8000-000000000011', name: '虚构财务乙', role: 'employee', access: 'view', grantRevision: 2 };
  for (const [principal, url, version] of [[base, '/', undefined], [{ ...base, protocolVersion: 2, capabilities: ['erp.read'] }, '/erp/api/bootstrap', 2]]) {
    const headers = signPrincipal(TOKEN, principal, url, 'GET', EMPTY, NOW), signed = decoded(headers);
    assert.equal(signed.module, 'ledger'); assert.equal(signed.protocolVersion, version); assert(!Object.hasOwn(signed, 'authorityModule')); assert(!Object.hasOwn(signed, 'storageModule'));
    assert.equal(headers['x-xjy-principal-signature'], crypto.createHmac('sha256', TOKEN).update(headers['x-xjy-principal']).digest('hex'));
  }
});

test('S09 cashier signer rejects noncanonical and remote path before URL normalization', () => {
  for (const url of ['/cashier/api/../api/accounts', '/cashier/api/%61ccounts', '/cashier//api/accounts', '/cashier/api/accounts#other', 'https://example.test/cashier/api/accounts']) assert.throws(() => signPrincipal(TOKEN, actor(), url, 'GET', EMPTY, NOW), error => [400, 403].includes(error?.status));
});

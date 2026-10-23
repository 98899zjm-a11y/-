'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const compositionFile = path.join(__dirname, '../project/desktop/print-composition.cjs');
const { createPrintRoutingAdapter, createTrustedPrintModuleProxy, createPrintComposition, toAgentPresentation } = fs.existsSync(compositionFile) ? require(compositionFile) : {};
const { createPrintSources } = require('../project/desktop/print-sources.cjs');
const Q = '10000000-0000-4000-8000-000000000001';
const D = '20000000-0000-4000-8000-000000000002';
const I = '30000000-0000-4000-8000-000000000003';
const EPSON = '\\\\192.168.1.196\\EPSON LQ-630K ESC/P2';
const DELI = 'Deli M2500ADW-35J04Y(WLAN)';
const status = number => error => error.status === number;
const json = value => ({ status: 200, headers: { 'content-type': 'application/json' }, bodyBase64: Buffer.from(JSON.stringify(value)).toString('base64') });
const html = value => ({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, bodyBase64: Buffer.from(value).toString('base64') });
const actor = () => ({ id: 'staff-a', userId: 'local-staff-a', name: '虚构财务', role: 'employee', active: true, credential: 'fake-password-hash', identity: { userId: 'local-staff-a', email: 'fake-a', displayName: '虚构财务' }, moduleAccess: { sales: 'disabled', ledger: 'view', inventory: 'view' }, capabilities: { 'erp.read': true, 'erp.reports.view': true }, grantRevision: 3 });
function routingFixture(extras = {}) {
  let profiles = { revision: 5, warranty: { deviceName: EPSON, paper: { widthMm: 180, heightMm: 240 } }, a4: { deviceName: DELI, paper: 'A4' } };
  let devices = [{ name: EPSON, displayName: '质保设备' }, { name: DELI, displayName: 'A4设备' }, { name: 'Unbound Device', isDefault: true }];
  return { routing: { getProfiles: () => profiles, getOptions: async () => ({ profiles: { warranty: { label: '质保设备' }, a4: { label: 'A4设备' } }, printers: [{ id: 'unbound_default', label: '不应猜选的默认设备' }], canManage: false }) }, enumerate: async () => devices, setProfiles: value => { profiles = value; }, setDevices: value => { devices = value; }, ...extras };
}

test('routing composition resolves only each exact binding and produces compatible types', async () => {
  assert.equal(typeof createPrintRoutingAdapter, 'function');
  const f = routingFixture(), route = createPrintRoutingAdapter({ routing: f.routing, enumerate: f.enumerate, defaultsProvider: () => ({ phone: '010-123', standard: '原标准', afterSalesWechat: 'fake-wechat' }) });
  const a4 = await route.resolve('quotation-a4', actor());
  assert.equal(a4.deviceName, DELI); assert.equal(a4.paper, 'A4'); assert.equal(a4.routingRevision, 5);
  const warranty = await route.resolve('warranty', actor());
  assert.equal(warranty.deviceName, EPSON); assert.deepEqual(warranty.paper, { widthMm: 180, heightMm: 240 });
  const options = await route.getOptions(actor());
  assert.equal(options.types.warranty.printerId, warranty.printerId);
  assert.equal(options.types['quotation-a4'].printerId, a4.printerId);
  assert.equal(options.types['inventory-report-a4'].printerId, a4.printerId);
  assert.equal(options.types['quotation-a4'].routingRevision, 5);
  assert.equal(options.defaultPrinterId, warranty.printerId);
  assert.deepEqual(options.defaults, { phone: '010-123', standard: '原标准', afterSalesWechat: 'fake-wechat' });
  assert.equal(options.canManage, false); assert.equal(options.profiles.a4.label, 'A4设备');
});

test('an unavailable A4 route does not choose a default or disable warranty', async () => {
  assert.equal(typeof createPrintRoutingAdapter, 'function');
  const f = routingFixture(); f.setDevices([{ name: EPSON }, { name: DELI, offline: true }, { name: 'Other A4', isDefault: true }]);
  const route = createPrintRoutingAdapter(f), options = await route.getOptions(actor());
  assert.equal(options.types.warranty.available, true); assert.equal(options.types['quotation-a4'].available, false);
  await assert.rejects(route.resolve('quotation-a4', actor()), status(503));
  f.setProfiles({ revision: 6, warranty: { deviceName: '', paper: { widthMm: 180, heightMm: 240 } }, a4: { deviceName: '', paper: 'A4' } });
  const empty = await route.getOptions(actor()); assert.equal(empty.defaultPrinterId, ''); assert.equal(empty.available, false);
});

test('async enumeration cannot silently adopt a changed binding revision', async () => {
  assert.equal(typeof createPrintRoutingAdapter, 'function');
  const f = routingFixture();
  const route = createPrintRoutingAdapter({ routing: f.routing, enumerate: async () => { f.setProfiles({ revision: 6, warranty: { deviceName: EPSON, paper: { widthMm: 180, heightMm: 240 } }, a4: { deviceName: DELI, paper: 'A4' } }); return [{ name: EPSON }, { name: DELI }]; } });
  await assert.rejects(route.resolve('quotation-a4', actor()), status(409));
});

test('the typed module proxy signs the fresh employee through the original two-argument adapter', async () => {
  assert.equal(typeof createTrustedPrintModuleProxy, 'function');
  const initial = actor(); let current = actor(), received, identitySeen, getActorCalls = 0;
  const proxy = createTrustedPrintModuleProxy({
    moduleAdapter: { proxy: async (request, authority) => { received = request; const principal = await authority.getActor(); getActorCalls++; assert.equal(principal.staffId, 'staff-a'); assert.equal(principal.access, 'view'); assert.equal(principal.protocolVersion, 2); assert.deepEqual(principal.capabilities, ['erp.read', 'erp.reports.view']); return json({ ok: true, document: { id: D, kind: 'receivable', payload: {}, lines: [] } }); } },
    loadActor: async id => { assert.equal(id, 'staff-a'); return current; },
    authorizeModule: async (employee, requirement) => { assert.equal(employee.role, 'employee'); assert.deepEqual(requirement, { module: 'ledger', level: 'view' }); return { moduleAccess: employee.moduleAccess, capabilities: employee.capabilities }; },
    withIdentity: (identity, action) => { identitySeen = identity; return action(); },
  });
  current = { ...current, name: '实时姓名' };
  await proxy(initial, { module: 'ledger', path: '/erp/api/documents/' + D, method: 'GET' });
  assert.deepEqual(received, { module: 'ledger', path: '/erp/api/documents/' + D, method: 'GET' });
  assert.equal(identitySeen.userId, 'local-staff-a'); assert.equal(getActorCalls, 1);
});

test('the typed module proxy rejects arbitrary paths, supplied principals and request bodies', async () => {
  assert.equal(typeof createTrustedPrintModuleProxy, 'function');
  let reads = 0; const value = actor();
  const proxy = createTrustedPrintModuleProxy({ moduleAdapter: { proxy: async () => { reads++; return json({}); } }, loadActor: async () => value, authorizeModule: async () => ({ moduleAccess: value.moduleAccess, capabilities: value.capabilities }), withIdentity: (_identity, action) => action() });
  for (const request of [{ module: 'ledger', path: '/api/users', method: 'GET' }, { module: 'ledger', path: '/erp/api/documents/' + D, method: 'GET', actor: { role: 'admin' } }, { module: 'inventory', path: '/reports?range=30&since=2026-09-14&url=https://x', method: 'GET' }, { module: 'inventory', path: '/api/metal-stats', method: 'GET', bodyBase64: 'e30=' }, { module: 'inventory', path: '/sessions/12/print?filter=diff&filter=all', method: 'GET' }]) await assert.rejects(proxy(value, request), status(400));
  assert.equal(reads, 0);
});

test('module authority is explicit and cannot be borrowed from an admin role', async () => {
  assert.equal(typeof createTrustedPrintModuleProxy, 'function');
  let reads = 0, current = { ...actor(), role: 'admin' };
  const proxy = createTrustedPrintModuleProxy({ moduleAdapter: { proxy: async () => { reads++; return html('<html>test</html>'); } }, loadActor: async () => current, authorizeModule: async () => ({ moduleAccess: { inventory: 'disabled' }, capabilities: {} }), withIdentity: (_identity, action) => action() });
  await assert.rejects(proxy(current, { module: 'inventory', path: '/api/metal-stats', method: 'GET' }), status(403)); assert.equal(reads, 0);
});

test('fresh proxy callbacks reject password and grant changes before or after module I/O', async () => {
  assert.equal(typeof createTrustedPrintModuleProxy, 'function');
  const initial = actor(); let current = actor(), mode = 'password';
  const proxy = createTrustedPrintModuleProxy({ moduleAdapter: { proxy: async (_request, authority) => { if (mode === 'password') { current = { ...current, credential: 'new-password-hash' }; await authority.getActor(); } else { current = { ...current, grantRevision: 4 }; } return html('<html>test</html>'); } }, loadActor: async () => current, authorizeModule: async user => ({ moduleAccess: user.moduleAccess, capabilities: user.capabilities }), withIdentity: (_identity, action) => action() });
  await assert.rejects(proxy(initial, { module: 'inventory', path: '/api/metal-stats', method: 'GET' }), status(403));
  mode = 'grant'; current = actor(); await assert.rejects(proxy(initial, { module: 'inventory', path: '/api/metal-stats', method: 'GET' }), status(403));
});

test('inventory report transport maps its fixed range to the native r parameter', async () => {
  assert.equal(typeof createTrustedPrintModuleProxy, 'function');
  const paths = [], value = actor();
  const proxy = createTrustedPrintModuleProxy({ moduleAdapter: { proxy: async request => { paths.push(request.path); return html('<html>report</html>'); } }, loadActor: async () => value, authorizeModule: async () => ({ moduleAccess: value.moduleAccess, capabilities: value.capabilities }), withIdentity: (_identity, action) => action() });
  for (const [range, since] of [['30', '2026-09-14'], ['90', '2026-07-16'], ['365', '2025-10-14'], ['all', '']]) await proxy(value, { module: 'inventory', path: '/reports?range=' + range + '&since=' + since, method: 'GET' });
  assert.deepEqual(paths, ['/reports?r=30&since=2026-09-14', '/reports?r=90&since=2026-07-16', '/reports?r=365&since=2025-10-14', '/reports?r=all&since=']);
});

test('agent presentation preserves server paper and template edits without business-value overrides', () => {
  assert.equal(typeof toAgentPresentation, 'function');
  const settings = { deviceName: 'Old ignored device', copies: 9, mode: 'fields', widthMm: 210, heightMm: 297, offsetXmm: 1.2, offsetYmm: -2, scalePercent: 95, phone: '010-old', standard: '原执行标准', afterSalesWechat: 'old-wechat', layoutOffsets: { '1042': { xMm: 1, yMm: 2 } }, fontSizes: { '1042': 10 } };
  const route = { deviceName: EPSON, paper: { widthMm: 180, heightMm: 240 } };
  const input = { language: 'zh', warranty: { itemIndexes: [1], overrides: [{ itemIndex: 1, goodsNumber: '货号2', productName: '素链', phone: '020-new', afterSalesWechat: 'new-wechat' }] }, layoutOffsets: { '1042': { xMm: 3, yMm: 4 } }, fontSizes: { '1042': 12 } };
  const output = toAgentPresentation('warranty', input, { settings, route, copies: 2 });
  assert.deepEqual(Object.keys(output).sort(), ['language', 'settings', 'warranty']);
  assert.equal(output.settings.deviceName, EPSON); assert.equal(output.settings.copies, 2); assert.equal(output.settings.widthMm, 180); assert.equal(output.settings.heightMm, 240); assert.equal(output.settings.mode, 'fields');
  assert.equal(output.settings.offsetXmm, 1.2); assert.equal(output.settings.standard, '原执行标准'); assert.deepEqual(output.settings.layoutOffsets['1042'], { xMm: 3, yMm: 4 }); assert.equal(output.settings.fontSizes['1042'], 12);
  assert.equal(output.warranty.overrides[0].phone, '020-new'); assert.equal(settings.deviceName, 'Old ignored device'); assert.equal(settings.fontSizes['1042'], 10);
  for (const edited of [{ ...input, copies: 1 }, { ...input, settings: { deviceName: 'attacker' } }, { ...input, fontSizes: { unknown: 10 } }, { ...input, fontSizes: { '1042': Infinity } }, { ...input, warranty: { itemIndexes: [1], overrides: [{ itemIndex: 1, weight: 1, amount: 1 }] } }]) assert.throws(() => toAgentPresentation('warranty', edited, { settings, route, copies: 2 }), status(400));
  assert.deepEqual(toAgentPresentation('erp-report-a4', { language: 'en' }, { route: { deviceName: DELI, paper: 'A4' }, copies: 1 }), { language: 'en' });
});

test('source metadata records accepted absolute dates without mutating original idempotency input', async () => {
  const sources = createPrintSources({ authorize: () => true, moduleProxy: async () => html('<html>report</html>'), clock: () => new Date('2026-10-14T01:00:00Z') });
  const input = { type: 'inventory-report-a4', range: '30' }, before = JSON.stringify(input), prepared = await sources.prepare(actor(), input);
  assert.deepEqual(prepared.acceptedSource, { type: 'inventory-report-a4', range: '30', asOf: '2026-10-14', since: '2026-09-15' });
  assert.equal(prepared.requestMeta.asOf, '2026-10-14'); assert.equal(prepared.requestMeta.comparison, 'immutable-snapshot'); assert.equal(prepared.requestMeta.sourceType, 'inventory-report-a4'); assert.equal(prepared.requestMeta.fingerprint, prepared.fingerprint);
  assert(Object.isFrozen(prepared.requestMeta)); assert(Object.isFrozen(prepared.acceptedSource)); assert.equal(JSON.stringify(input), before); assert.deepEqual(prepared.requestedSource, input);
  assert.throws(() => { prepared.requestMeta.asOf = '2026-10-15'; }, TypeError);
});

test('opaque documents stay bound to accepted bytes even when current generation changes', async () => {
  let text = '<html>first document</html>';
  const sources = createPrintSources({ authorize: () => true, moduleProxy: async () => html(text), clock: () => new Date('2026-10-14T01:00:00Z') });
  const p = await sources.prepare(actor(), { type: 'inventory-count-a4', id: 12 }); text = '<html>later generation</html>';
  assert.equal(await sources.revalidate(actor(), p), true); assert.equal(Buffer.from(p.document.bodyBase64, 'base64').toString(), '<html>first document</html>');
  const changed = JSON.parse(JSON.stringify(p)); changed.document.bodyBase64 = Buffer.from('<html>replacement</html>').toString('base64');
  await assert.rejects(sources.revalidate(actor(), changed), status(409));
});

test('revalidation refuses missing accepted metadata or a changed document format', async () => {
  const sources = createPrintSources({ authorize: () => true, moduleProxy: async () => html('<html>original</html>'), clock: () => new Date('2026-10-14T01:00:00Z') });
  const p = await sources.prepare(actor(), { type: 'inventory-report-a4', range: '30' });
  const missing = JSON.parse(JSON.stringify(p)); delete missing.requestMeta;
  await assert.rejects(sources.revalidate(actor(), missing), status(409));
  const altered = JSON.parse(JSON.stringify(p)); altered.document.format = 'quotation';
  await assert.rejects(sources.revalidate(actor(), altered), status(409));
});

test('quote images are read through fixed core IDs and supplied to a no-network agent', async () => {
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]); let imageReads = 0;
  const quote = { id: Q, type: 'sale', snapshot: { image: '/api/images/' + I, saleItems: [{ productName: '素链', image: '/api/images/' + I, weight: 1.234, amount: 456.78 }], total: 456.78, images: [] }, createdAt: '2026-10-14' };
  const sources = createPrintSources({ authorize: () => true, core: { getQuote: async () => ({ quote }), getImage: async id => { assert.equal(id, I); imageReads++; return new Response(bytes, { headers: { 'content-type': 'image/png' } }); } } });
  const p = await sources.prepare(actor(), { type: 'quotation-a4', quoteId: Q });
  assert.equal(p.document.quote.snapshot.image, 'data:image/png;base64,iVBORw0KGgoB'); assert.equal(p.document.quote.snapshot.saleItems[0].image, 'data:image/png;base64,iVBORw0KGgoB'); assert.equal(p.document.quote.snapshot.saleItems[0].weight, 1.234); assert.equal(imageReads, 1);
  assert.equal(quote.snapshot.image, '/api/images/' + I);
  quote.snapshot.image = 'https://attacker/image.png'; await assert.rejects(sources.prepare(actor(), { type: 'quotation-a4', quoteId: Q }), status(400)); assert.equal(imageReads, 1);
});

test('warranty does not fetch unrelated product imagery and retains the original business values', async () => {
  let imageReads = 0;
  const quote = { id: Q, type: 'sale', snapshot: { image: 'https://unused/image', saleItems: [{ image: '/api/images/' + I, weight: 1.234, amount: 456.78 }], total: 456.78, images: [] }, createdAt: '2026-10-14' };
  const sources = createPrintSources({ authorize: () => true, core: { getQuote: async () => ({ quote }), getImage: async () => { imageReads++; throw new Error('not needed'); } } });
  const p = await sources.prepare(actor(), { type: 'warranty', quoteId: Q }); assert.equal(p.document.quote.snapshot.image, ''); assert.equal(p.document.quote.snapshot.saleItems[0].image, ''); assert.equal(p.document.quote.snapshot.total, 456.78); assert.equal(imageReads, 0);
});

test('composition prepares a finance-only source with fresh authority and fixed module transport', async () => {
  assert.equal(typeof createPrintComposition, 'function');
  const value = actor(), f = routingFixture(); let pathSeen, identity;
  const composed = createPrintComposition({ ...f, loadActor: async () => value, authorizeSource: (employee, rule) => employee.moduleAccess[rule.module] === 'view', authorizeModule: employee => ({ moduleAccess: employee.moduleAccess, capabilities: employee.capabilities }), withIdentity: (next, action) => { identity = next; return action(); }, moduleAdapter: { proxy: async (request, authority) => { pathSeen = request.path; assert.equal((await authority.getActor()).role, 'employee'); return json({ ok: true, report: { asOf: '2026-10-14', amountCents: 45678, rows: [] } }); } }, clock: () => new Date('2026-10-14T01:00:00Z') });
  const p = await composed.sources.prepare(value, { type: 'erp-report-a4', filters: {} });
  assert.equal(pathSeen, '/erp/api/reports?asOf=2026-10-14'); assert.equal(identity.userId, 'local-staff-a'); assert.equal(p.document.data.amountCents, 45678); assert.equal(p.acceptedSource.filters.asOf, '2026-10-14');
  await assert.rejects(composed.sources.prepare(value, { type: 'quotation-a4', quoteId: Q }), status(403));
});

test('accepted source metadata carries the hash of the actual original legacy PDF', async () => {
  const body = Buffer.from('%PDF-1.7\noriginal report\n%%EOF');
  const sources = createPrintSources({ authorize: () => true, moduleProxy: async () => ({ status: 200, headers: { 'content-type': 'application/pdf' }, bodyBase64: body.toString('base64') }), clock: () => new Date('2026-10-14T01:00:00Z') });
  const prepared = await sources.prepare(actor(), { type: 'ledger-report-a4', filters: {} });
  assert(prepared.acceptedSource, 'accepted source metadata is required'); assert.equal(prepared.acceptedSource.filters.start, '2026-10-01'); assert.equal(prepared.acceptedSource.filters.end, '2026-10-14');
  assert.equal(prepared.requestMeta.fingerprint, createHash('sha256').update(body).digest('hex')); assert.equal(prepared.requestMeta.module, 'ledger'); assert(!Object.hasOwn(prepared.requestMeta, 'bodyBase64'));
});

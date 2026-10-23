'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePrintSource, createPrintSources } = require('../project/desktop/print-sources.cjs');
const Q = '10000000-0000-4000-8000-000000000001';
const D = '20000000-0000-4000-8000-000000000002';
const actor = { id: 'test-finance', role: 'employee' };
const rejectsStatus = status => error => error.status === status;
const jsonResponse = value => ({ status: 200, headers: { 'content-type': 'application/json' }, bodyBase64: Buffer.from(JSON.stringify(value)).toString('base64') });

test('normalizes fixed sources and rejects address/identity injection before reading anything', () => {
  assert.deepEqual(normalizePrintSource({ type: 'quotation-a4', quoteId: Q }), { type: 'quotation-a4', quoteId: Q });
  for (const source of [
    { type: 'https://attacker/' }, { type: 'quotation-a4', quoteId: Q, url: '/api/users' },
    { type: 'warranty', quoteId: Q, role: 'admin' }, { type: 'erp-document-a4', id: '../ledger.db' },
    { type: 'inventory-count-a4', id: 0 }, { type: 'inventory-metal-a4', html: '<script>print()</script>' },
    { type: 'erp-report-a4', filters: { asOf: ['2026-10-14', '2026-10-15'] } },
    { type: 'ledger-report-a4', filters: 'domain=sales&domain=payroll' },
    { type: 'inventory-report-a4', range: '30&since=2000-01-01' },
  ]) assert.throws(() => normalizePrintSource(source), rejectsStatus(400));
});

test('ledger report sends complete permitted preferences with no remembered sensitive defaults', async () => {
  const calls = [], permissions = [];
  const sources = createPrintSources({
    authorize: async (user, rule) => { assert.equal(user, actor); permissions.push(rule); },
    moduleProxy: async (user, request) => {
      assert.equal(user, actor); calls.push(request);
      return { status: 200, headers: { 'content-type': 'application/pdf' }, bodyBase64: Buffer.from('%PDF-1.7\nFAKE\n%%EOF').toString('base64') };
    }, clock: () => new Date('2026-10-14T01:00:00Z'),
  });
  const prepared = await sources.prepare(actor, { type: 'ledger-report-a4', filters: { domain: ['sales'], sales_metric: ['amount', 'count'] } });
  assert.equal(prepared.module, 'ledger');
  assert.equal(prepared.document.format, 'trusted-pdf');
  assert.equal(prepared.comparison, 'immutable-snapshot');
  const query = new URL(calls[0].path, 'http://localhost').searchParams;
  assert.equal(calls[0].method, 'GET');
  assert.equal(query.get('configured'), '1');
  assert.equal(query.get('start'), '2026-10-01');
  assert.equal(query.get('end'), '2026-10-14');
  assert.deepEqual(query.getAll('domain'), ['sales']);
  assert.deepEqual(query.getAll('sales_metric'), ['count', 'amount']);
  assert.equal(query.getAll('stock_metric').length, 0);
  assert(!permissions.some(rule => rule.capabilities.includes('erp.reports.sensitive')));
});

test('legacy finance cost, payroll, platinum and financial details require separate sensitive grant', async () => {
  let reads = 0;
  const sources = createPrintSources({
    authorize: (_user, rule) => !rule.capabilities.includes('erp.reports.sensitive'),
    moduleProxy: () => { reads++; throw new Error('must not be read'); },
  });
  for (const filters of [
    { domain: ['sales'], sales_metric: ['profit'] },
    { domain: ['payroll'], payroll_metric: ['count'] },
    { domain: ['platinum'], platinum_metric: ['fine_grams'] },
    { domain: ['stock'], stock_metric: ['cost'] },
    { domain: ['sales'], details: ['sales'], sales_metric: ['count'] },
  ]) await assert.rejects(sources.prepare(actor, { type: 'ledger-report-a4', filters }), rejectsStatus(403));
  assert.equal(reads, 0);
});

test('ERP source returns original safe values and fixed GET while redacted documents cannot print', async () => {
  const calls = [];
  let document = { id: D, kind: 'receivable', status: 'confirmed', amountCents: 50037, payload: { note: '2026-10-14 原日期 500.37' }, lines: [], revision: 1 };
  const sources = createPrintSources({ authorize: () => true, moduleProxy: async (user, request) => { assert.equal(user, actor); calls.push(request); return jsonResponse({ ok: true, document }); } });
  const prepared = await sources.prepare(actor, { type: 'erp-document-a4', id: D });
  assert.deepEqual(calls[0], { module: 'ledger', path: '/erp/api/documents/' + D, method: 'GET' });
  assert.equal(prepared.document.format, 'erp-json');
  assert.equal(prepared.document.data.amountCents, 50037);
  assert.equal(prepared.document.data.payload.note, '2026-10-14 原日期 500.37');
  document = { ...document, redacted: true };
  await assert.rejects(sources.prepare(actor, { type: 'erp-document-a4', id: D }), rejectsStatus(403));
});

test('sensitive ERP document is re-authorized after actual kind resolution', async () => {
  const sources = createPrintSources({ authorize: (_user, rule) => !rule.capabilities.includes('erp.reports.sensitive'), moduleProxy: async () => jsonResponse({ ok: true, document: { id: D, kind: 'receipt', status: 'confirmed', amountCents: 300000, payload: {}, lines: [] } }) });
  await assert.rejects(sources.prepare(actor, { type: 'erp-document-a4', id: D }), rejectsStatus(403));
});

test('ERP report fixes the as-of date and rejects invalid filters instead of clipping them', async () => {
  let request;
  const sources = createPrintSources({ authorize: () => true, moduleProxy: async (_actor, value) => { request = value; return jsonResponse({ ok: true, report: { filters: { asOf: '2026-10-14' }, balances: [], total: 12345, generated_at: 'noise' } }); }, clock: () => new Date('2026-10-14T01:00:00Z') });
  const prepared = await sources.prepare(actor, { type: 'erp-report-a4', filters: { from: '2026-10-01', partyId: 'SUP:22' } });
  assert.equal(new URL(request.path, 'http://localhost').searchParams.get('asOf'), '2026-10-14');
  assert.equal(prepared.sourceRef.filters.asOf, '2026-10-14');
  for (const filters of [{ asOf: '2026-02-30' }, { asOf: '2026-10-14', from: '2026-11-01' }, { partyId: 'SUP:22&creatorId=admin' }, { status: 'all&asOf=2026-01-01' }, { path: '/api/users' }]) assert.throws(() => normalizePrintSource({ type: 'erp-report-a4', filters }), rejectsStatus(400));
});

test('inventory IDs and query choices map only to registered print endpoints', async () => {
  const requests = [];
  const sources = createPrintSources({ authorize: () => true, moduleProxy: async (_actor, value) => { requests.push(value); return { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, bodyBase64: Buffer.from('<html><body>虚构盘点</body></html>').toString('base64') }; }, clock: () => new Date('2026-10-14T01:00:00Z') });
  const p = await sources.prepare(actor, { type: 'inventory-count-a4', id: 12, filter: 'diff', sort: 'code', blind: '1', mode: 'blank' });
  assert.equal(p.document.format, 'trusted-html');
  assert.equal(requests[0].path, '/sessions/12/print?filter=diff&sort=code&blind=1&mode=blank');
  await sources.prepare(actor, { type: 'inventory-report-a4', range: '30' });
  const query = new URL(requests[1].path, 'http://localhost').searchParams;
  assert.equal(query.get('range'), '30');
  // Existing inventory reports include the report day in the 30-day window.
  assert.equal(query.get('since'), '2026-09-15');
  for (const value of [{ id: 1, filter: 'diff&blind=0' }, { id: '1' }, { id: 9007199254740992 }, { id: 1, mode: 'html' }]) assert.throws(() => normalizePrintSource({ type: 'inventory-count-a4', ...value }), rejectsStatus(400));
});

test('quote access is read as the employee and requires only sales permission', async () => {
  let quote = { id: Q, kind: 'sales', snapshot: { saleItems: [{ name: '虚构铂金素链', weight: 1.2345, unitPrice: 456.78 }], total: 789.01 }, createdAt: '2026-10-01' };
  const sources = createPrintSources({ core: { getQuote: async (id, user) => { assert.equal(id, Q); assert.equal(user, actor); return { quote }; } }, authorize: (_user, rule) => rule.module === 'sales' });
  const p = await sources.prepare(actor, { type: 'quotation-a4', quoteId: Q });
  assert.equal(p.document.format, 'quotation');
  assert.equal(p.document.quote.snapshot.total, 789.01);
  quote = { ...quote, snapshot: { ...quote.snapshot, total: 789.02 } };
  await assert.rejects(sources.revalidate(actor, p), rejectsStatus(409));
});

test('revalidation checks current permissions and detects JSON business changes without date noise stripping', async () => {
  let allowed = true, generated = '2026-10-14T01:00:00', amount = 100, note = '业务日期2026-10-14';
  const sources = createPrintSources({ authorize: () => allowed, moduleProxy: async () => jsonResponse({ ok: true, report: { generated_at: generated, balances: [{ amountCents: amount, note }], filters: { asOf: '2026-10-14' } } }) });
  const p = await sources.prepare(actor, { type: 'erp-report-a4', filters: { asOf: '2026-10-14' } });
  generated = '2026-10-14T02:00:00';
  assert.equal(await sources.revalidate(actor, p), true);
  note = '业务日期2026-10-15';
  await assert.rejects(sources.revalidate(actor, p), rejectsStatus(409));
  allowed = false;
  await assert.rejects(sources.revalidate(actor, p), rejectsStatus(403));
});

test('source payload corruption and explicit size limits fail instead of silently trimming', async () => {
  let response = { status: 200, headers: { 'content-type': 'application/json' }, bodyBase64: Buffer.from('{invalid').toString('base64') };
  const sources = createPrintSources({ authorize: () => true, moduleProxy: async () => response });
  await assert.rejects(sources.prepare(actor, { type: 'erp-report-a4', filters: { asOf: '2026-10-14' } }), rejectsStatus(502));
  response = jsonResponse({ ok: true, report: { note: 'x'.repeat(20 * 1024 * 1024 + 1) } });
  await assert.rejects(sources.prepare(actor, { type: 'erp-report-a4', filters: { asOf: '2026-10-14' } }), rejectsStatus(413));
  response = { status: 403, headers: { 'content-type': 'text/html' }, bodyBase64: Buffer.from('<html>拒绝</html>').toString('base64') };
  await assert.rejects(sources.prepare(actor, { type: 'inventory-count-a4', id: 12 }), rejectsStatus(403));
});

test('legacy binary snapshots remain immutable while current source access is checked again', async () => {
  let text = '%PDF-1.7\nGenerated A\n%%EOF', status = 200;
  const sources = createPrintSources({ authorize: () => true, moduleProxy: async () => ({ status, headers: { 'content-type': 'application/pdf' }, bodyBase64: Buffer.from(text).toString('base64') }) });
  const p = await sources.prepare(actor, { type: 'ledger-report-a4', filters: { start: '2026-10-01', end: '2026-10-14' } });
  text = '%PDF-1.7\nGenerated B\n%%EOF';
  assert.equal(await sources.revalidate(actor, p), true);
  assert.equal(Buffer.from(p.document.bodyBase64, 'base64').toString(), '%PDF-1.7\nGenerated A\n%%EOF');
  assert.equal(p.comparison, 'immutable-snapshot');
  status = 404;
  await assert.rejects(sources.revalidate(actor, p), rejectsStatus(404));
});

test('free report title is retained as text without interpreting it as a source or executing it', () => {
  const recipe = normalizePrintSource({ type: 'ledger-report-a4', filters: { title: '<script>print()</script> 虚构汇报' } });
  assert.equal(recipe.filters.title, '<script>print()</script> 虚构汇报');
  assert.throws(() => normalizePrintSource({ type: 'ledger-report-a4', html: '<script>print()</script>' }), rejectsStatus(400));
});

test('a payable report row cannot impersonate an ERP document kind', async () => {
  const sources = createPrintSources({ authorize: () => true, moduleProxy: async () => jsonResponse({ ok: true, document: { id: D, kind: 'payable', payload: {}, lines: [], amountCents: 100 } }) });
  await assert.rejects(sources.prepare(actor, { type: 'erp-document-a4', id: D }), rejectsStatus(502));
});

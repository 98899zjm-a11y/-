import test from 'node:test';
import assert from 'node:assert/strict';
import { createInventoryReportReader } from './inventory-report-reader.mjs';

const ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const TS = '2026-10-23T11:59:00.000Z';
const NOW = Date.parse('2026-10-23T12:00:00.000Z');
const BASE = { reportId: ID, kind: 'product', code: '000123' };

function row(over = {}) {
  return {
    sourceId: 's1',
    sourceKind: 'product',
    code: '000123',
    name: 'Widget',
    category: 'cat',
    spec: 'spec',
    unit: 'pcs',
    quantity: '1.2500',
    supplier: 'fixture-supplier',
    cost: '9.99',
    operator: 'fixture-user',
    amountCents: 123,
    ...over,
  };
}

function reportDoc(balances = [row()], reportOver = {}, snapshotOver = {}) {
  const capturedAt = reportOver.capturedAt ?? TS;
  return {
    report: {
      id: ID,
      status: 'approved',
      revision: 1,
      sourceInstance: 'fixture-instance',
      sourceVersion: 'v1',
      ...reportOver,
      capturedAt,
      snapshot: { capturedAt, balances, ...snapshotOver },
    },
  };
}

function makeReader(doc = reportDoc(), over = {}) {
  return createInventoryReportReader({
    maxAgeMs: over.maxAgeMs ?? 60000,
    clock: over.clock ?? (() => NOW),
    authorize: over.authorize ?? (async () => ({ check: () => {} })),
    loadReport: over.loadReport ?? (async () => doc),
  });
}

test('authorize rejection prevents loading', async () => {
  let loads = 0;
  const reader = makeReader(reportDoc(), {
    authorize: async () => { throw new Error('denied by host'); },
    loadReport: async () => { loads += 1; return reportDoc(); },
  });
  await assert.rejects(reader.lookup(BASE), /denied by host/);
  assert.equal(loads, 0);
});

test('revocation during async load stops output', async () => {
  let loads = 0;
  let revoked = false;
  const reader = makeReader(reportDoc(), {
    authorize: async () => ({ check: () => { if (revoked) throw new Error('authorization revoked'); } }),
    loadReport: async () => { loads += 1; revoked = true; return reportDoc(); },
  });
  await assert.rejects(reader.lookup(BASE), /authorization revoked/);
  assert.equal(loads, 1);
});

test('exact code keeps leading zeros and quantity text stays exact', async () => {
  const reader = makeReader(reportDoc([
    row({ code: '000123', quantity: '-0.0000000000000000001234' }),
    row({ sourceId: 's2', code: '123', quantity: '5' }),
  ]));
  const exact = await reader.lookup({ ...BASE, code: ' 000123 ' });
  assert.equal(exact.total, 1);
  assert.equal(exact.items[0].quantity, '-0.0000000000000000001234');
  const short = await reader.lookup({ ...BASE, code: '123' });
  assert.equal(short.total, 1);
  assert.equal(short.items[0].quantity, '5');
});

test('kinds stay separate and pagination follows filtered total', async () => {
  const reader = makeReader(reportDoc([
    row({ sourceId: 'p1', code: 'P-1', name: 'Part one' }),
    row({ sourceId: 'p2', code: 'P-2', name: 'ＰＡＲＴ two' }),
    row({ sourceId: 'p3', code: 'P-3', name: 'other', spec: 'PART spec' }),
    row({ sourceId: 'm1', sourceKind: 'material', code: 'M-1', name: 'Part material' }),
    row({ sourceId: 'x1', sourceKind: 'service', code: 'S-1', name: 'Part service' }),
  ]));
  const first = await reader.lookup({ reportId: ID, kind: 'product', q: 'ＰＡＲＴ', page: 1, pageSize: 2 });
  assert.equal(first.total, 3);
  assert.deepEqual(first.items.map((item) => item.sourceId), ['p1', 'p2']);
  const second = await reader.lookup({ reportId: ID, kind: 'product', q: 'PART', page: 2, pageSize: 2 });
  assert.equal(second.total, 3);
  assert.deepEqual(second.items.map((item) => item.sourceId), ['p3']);
  const material = await reader.lookup({ reportId: ID, kind: 'material', q: 'part' });
  assert.equal(material.total, 1);
  assert.equal(material.items[0].sourceKind, 'material');
  const none = await reader.lookup({ reportId: ID, kind: 'product', q: 'missing' });
  assert.equal(none.total, 0);
  assert.deepEqual(none.items, []);
});

test('unsupported fields and invalid pagination are rejected before auth', async () => {
  let auths = 0;
  let loads = 0;
  const reader = createInventoryReportReader({
    maxAgeMs: 60000,
    clock: () => NOW,
    authorize: async () => { auths += 1; return { check: () => {} }; },
    loadReport: async () => { loads += 1; return reportDoc(); },
  });
  const bad = [
    { ...BASE, host: 'evil.example' },
    { reportId: ID, kind: 'product', code: '000123', q: 'widget' },
    { reportId: ID, kind: 'product' },
    { ...BASE, reportId: 'not-a-uuid' },
    { ...BASE, kind: 'PRODUCT' },
    { ...BASE, page: 0 },
    { ...BASE, pageSize: 101 },
    { ...BASE, code: 'x'.repeat(101) },
    { ...BASE, code: '   ' },
    { ...BASE, page: '1' },
  ];
  for (const input of bad) await assert.rejects(reader.lookup(input));
  assert.equal(auths, 0);
  assert.equal(loads, 0);
});

test('stale, future, unapproved, mismatched, and malformed reports are rejected', async () => {
  const docs = [
    reportDoc([row()], { capturedAt: '2026-10-23T11:50:00.000Z' }),
    reportDoc([row()], { capturedAt: '2026-10-23T12:01:00.000Z' }),
    reportDoc([row()], { status: 'draft' }),
    reportDoc([row()], { id: OTHER_ID }),
    reportDoc([row()], {}, { capturedAt: '2026-10-23T11:58:00.000Z' }),
    reportDoc([row()], { capturedAt: 'not-a-date' }),
  ];
  for (const doc of docs) await assert.rejects(makeReader(doc).lookup(BASE));
});

test('oversized or explicitly truncated snapshots are rejected', async () => {
  await assert.rejects(makeReader(reportDoc(new Array(20001))).lookup(BASE), /20000|exceeds/i);
  await assert.rejects(makeReader(reportDoc([row()], {}, { truncated: true })).lookup(BASE), /truncated/i);
  await assert.rejects(makeReader(reportDoc([row()], {}, { limits: { truncated: true } })).lookup(BASE), /truncated/i);
});

test('results are whitelisted, sensitive fields are omitted, and inputs are untouched', async () => {
  const input = { ...BASE, page: 1, pageSize: 20 };
  const inputBefore = structuredClone(input);
  const doc = reportDoc([row({ supplier: 'supplier-x', cost: '123.45', operator: 'operator-x', amountCents: 777 })]);
  const docBefore = structuredClone(doc);
  const result = await makeReader(doc).lookup(input);
  assert.deepEqual(input, inputBefore);
  assert.deepEqual(doc, docBefore);
  assert.deepEqual(Object.keys(result).sort(), ['asOf', 'isLive', 'items', 'kind', 'page', 'pageSize', 'reportId', 'source', 'supplyStatus', 'total']);
  assert.deepEqual(result.source, { instance: 'fixture-instance', version: 'v1', basis: 'saved_approved_snapshot' });
  assert.equal(result.isLive, false);
  assert.equal(result.supplyStatus, 'unknown');
  assert.deepEqual(result.items[0], {
    sourceId: 's1', sourceKind: 'product', code: '000123', name: 'Widget', category: 'cat', spec: 'spec', unit: 'pcs', quantity: '1.2500',
  });
  for (const key of ['supplier', 'cost', 'operator', 'amountCents']) assert.equal(Object.hasOwn(result.items[0], key), false);
});

test('pre-aborted and mid-load cancellation throw AbortError', async () => {
  const pre = new AbortController();
  let auths = 0;
  let loads = 0;
  const reader = makeReader(reportDoc(), {
    authorize: async () => { auths += 1; return { check: () => {} }; },
    loadReport: async () => { loads += 1; return reportDoc(); },
  });
  pre.abort();
  await assert.rejects(reader.lookup(BASE, { signal: pre.signal }), (error) => error.name === 'AbortError');
  assert.equal(auths, 0);
  assert.equal(loads, 0);

  const during = new AbortController();
  let duringLoads = 0;
  const reader2 = makeReader(reportDoc(), {
    loadReport: async () => { duringLoads += 1; during.abort(); return reportDoc(); },
  });
  await assert.rejects(reader2.lookup(BASE, { signal: during.signal }), (error) => error.name === 'AbortError');
  assert.equal(duringLoads, 1);
});

test('authorization check must be a synchronous authority', async () => {
  const denied = makeReader(reportDoc(), { authorize: async () => ({ check: () => false }) });
  await assert.rejects(denied.lookup(BASE), /Authorization denied/);
  const asyncCheck = makeReader(reportDoc(), { authorize: async () => ({ check: () => Promise.resolve(true) }) });
  await assert.rejects(asyncCheck.lookup(BASE), /synchronous/);
  const malformed = makeReader(reportDoc(), { authorize: async () => ({}) });
  await assert.rejects(malformed.lookup(BASE), /check/);
});

test('invalid calendar dates, times, and zones are rejected', async () => {
  const bad = [
    '2026-02-29T11:59:00.000Z',
    '2026-02-30T11:59:00.000Z',
    '2026-04-31T11:59:00.000Z',
    '2026-13-01T11:59:00.000Z',
    '2026-00-01T11:59:00.000Z',
    '2026-01-00T11:59:00.000Z',
    '2026-10-23T24:00:00.000Z',
    '2026-10-23T11:60:00.000Z',
    '2026-10-23T11:59:60.000Z',
    '2026-10-23T11:59:00.000',
    '2026-10-23 11:59:00.000Z',
    '2026-10-23',
    '2026-10-23T11:59:00.000+24:00',
    '2026-10-23T11:59:00.000+05:60',
    '2026-10-23T11:59:00.000Z ',
  ];
  for (const capturedAt of bad) {
    await assert.rejects(makeReader(reportDoc([row()], { capturedAt })).lookup(BASE), /timestamp|date|valid/i);
  }
});

test('Gregorian leap-year dates are accepted and asOf is preserved', async () => {
  for (const capturedAt of ['2024-02-29T00:00:00.000Z', '2000-02-29T00:00:00.000Z']) {
    const out = await makeReader(reportDoc([row()], { capturedAt }), { clock: () => Date.parse(capturedAt) }).lookup(BASE);
    assert.equal(out.asOf, capturedAt);
  }
  await assert.rejects(
    makeReader(reportDoc([row()], { capturedAt: '1900-02-29T00:00:00.000Z' }), { clock: () => Date.parse('1900-03-01T00:00:00.000Z') }).lookup(BASE),
    /timestamp|date|valid/i,
  );
});

test('explicit offsets and fractional seconds are accepted without rewriting asOf', async () => {
  const cases = [
    ['2026-10-23T19:59:00+08:00', '2026-10-23T11:59:00.000Z'],
    ['2026-10-23T06:59:00-05:00', '2026-10-23T11:59:00.000Z'],
    ['2026-10-23T11:59:00+00:00', '2026-10-23T11:59:00.000Z'],
    ['2026-10-23T11:59:00.123456789Z', '2026-10-23T11:59:01.000Z'],
    ['2026-10-23T13:59:00.5+02:00', '2026-10-23T11:59:01.000Z'],
  ];
  for (const [capturedAt, nowIso] of cases) {
    const reader = makeReader(reportDoc([row()], { capturedAt }), { clock: () => Date.parse(nowIso) });
    const out = await reader.lookup(BASE);
    assert.equal(out.asOf, capturedAt);
    assert.equal(out.total, 1);
  }
});

test('source fields must be nonblank and are returned verbatim', async () => {
  const bad = [
    ['sourceInstance', ''],
    ['sourceInstance', '   '],
    ['sourceVersion', ''],
    ['sourceVersion', '   '],
  ];
  for (const [key, value] of bad) {
    await assert.rejects(makeReader(reportDoc([row()], { [key]: value })).lookup(BASE), /source|invalid/i);
  }
  const sourceInstance = ' fixture-instance ';
  const sourceVersion = ' v1 ';
  const out = await makeReader(reportDoc([row()], { sourceInstance, sourceVersion })).lookup(BASE);
  assert.deepEqual(out.source, { instance: sourceInstance, version: sourceVersion, basis: 'saved_approved_snapshot' });
});
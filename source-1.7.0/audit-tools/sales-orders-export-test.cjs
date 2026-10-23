'use strict';
// Artifact generation and business adapters remain Guest-only, even though
// these fixtures use no database, device, network or production files.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const ROOT = path.resolve(__dirname, '..');
if (process.platform !== 'win32' || os.userInfo().username.toLowerCase() !== 'wdagutilityaccount' || ROOT.toLowerCase() !== 'c:\\xjy-work\\xjy-web-stage1') throw Error('Sales order export tests require the fixed actual Windows Sandbox');
const guard = require('../stage1/isolation.cjs').createIsolationGuard(ROOT);
const proof = require('node:child_process').spawnSync('C:\\Python314\\python.exe', ['-I', '-B', guard.assertPath(path.join(ROOT, 'stage1/validate-sandbox-context.py'))], { cwd: ROOT, windowsHide: true, encoding: 'utf8' });
if (proof.status !== 0) throw Error('Unchanged actual Sandbox admission failed');
const test = require('node:test'), assert = require('node:assert/strict');
const { exportData } = require('../project/desktop/xlsx-export.cjs');
const q = (n, extra = {}) => ({ id: 'SYNTHETIC-QUOTE-' + n, number: 'QUOTE-' + n, type: 'sale', customerName: '虚构导出客户', ownerId: 'synthetic-staff', title: '虚构素链' + n, total: 519.99, createdAt: '2026-10-19T09:00:00.000Z', saleConfirmation: null, ...extra });
const request = (method, address) => new Request('http://fixture.invalid' + address, { method });
const invalidPage = error => error?.status === 502;
function runHistory(quotePage, parameters = {}) { return exportData({ kind: 'history', parameters: new URLSearchParams(parameters), core: { quotePage }, administration: {}, user: { id: 'synthetic-admin' }, request }); }
const decode = value => value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
function sheets(result) {
  const bytes = Buffer.from(result.base64, 'base64'), files = new Map(); let offset = 0;
  while (offset + 30 <= bytes.length && bytes.readUInt32LE(offset) === 0x04034b50) {
    assert.equal(bytes.readUInt16LE(offset + 8), 0, 'the existing writer stores plain OOXML entries');
    const size = bytes.readUInt32LE(offset + 18), length = bytes.readUInt16LE(offset + 26), extra = bytes.readUInt16LE(offset + 28), start = offset + 30 + length + extra;
    files.set(bytes.subarray(offset + 30, offset + 30 + length).toString('utf8'), bytes.subarray(start, start + size).toString('utf8')); offset = start + size;
  }
  return [...files].filter(([name]) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name)).map(([, xml]) => [...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map(row => [...row[1].matchAll(/<c\b[^>]*>([\s\S]*?)<\/c>/g)].map(cell => { const text = /<t\b[^>]*>([\s\S]*?)<\/t>/.exec(cell[1]), number = /<v>([\s\S]*?)<\/v>/.exec(cell[1]); return text ? decode(text[1]) : number ? number[1] : ''; })));
}

test('history export uses order pending approved states and ignores legacy quotation confirmation', async () => {
  const rows = [q(1, { salesOrder: { id: 'order-1', number: 'SO-1', status: 'pending' } }), q(2, { salesOrder: { id: 'order-2', number: 'SO-2', status: 'approved' } }), q(3, { saleConfirmation: { id: 'legacy-only' }, legacySaleConfirmation: { id: 'legacy-only' }, salesOrder: null })];
  const exported = await runHistory(async () => ({ quotes: rows, total: 3, page: 1, pageSize: 200 })), sheet = sheets(exported)[0], column = sheet[0].findIndex(value => /成交状态|开单状态/.test(value));
  assert(column >= 0); assert.equal(sheet[1][column], '待审核'); assert.equal(sheet[2][column], '已审核'); assert.equal(sheet[3][column], '未开单');
});

test('history export traverses complete stable pages while preserving actual filters and row count', async () => {
  const rows = Array.from({ length: 201 }, (_, index) => q(index + 1)), calls = [], original = new URLSearchParams({ from: '2026-10-01', to: '2026-10-31', status: 'confirmed' });
  const result = await runHistory(async req => { const parameters = new URL(req.url).searchParams, page = Number(parameters.get('page')); calls.push(Object.fromEntries(parameters)); return { quotes: rows.slice((page - 1) * 200, page * 200), total: 201, page, pageSize: 200 }; }, Object.fromEntries(original));
  assert.equal(result.rows, 201); assert.equal(sheets(result)[0].length, 202); assert.equal(calls.length, 2); assert(calls.every(call => call.from === '2026-10-01' && call.to === '2026-10-31' && call.status === 'confirmed')); assert.equal(original.get('page'), null);
});

test('missing total cannot silently export an incomplete first page', async () => { await assert.rejects(runHistory(async () => ({ quotes: [q(1)], page: 1, pageSize: 200 })), invalidPage); });
test('nonnumeric or fractional total is a source protocol failure', async () => { for (const total of ['1', -1, 1.5, null, NaN]) await assert.rejects(runHistory(async () => ({ quotes: [q(1)], total, page: 1, pageSize: 200 })), invalidPage); });
test('declared zero or an empty first page cannot disagree with actual rows and a positive total', async () => { await assert.rejects(runHistory(async () => ({ quotes: [q(1)], total: 0, page: 1, pageSize: 200 })), invalidPage); await assert.rejects(runHistory(async () => ({ quotes: [], total: 3, page: 1, pageSize: 200 })), invalidPage); });
test('changing page totals cannot turn an export into a different source set halfway through', async () => { const rows = Array.from({ length: 202 }, (_, i) => q(i + 1)); await assert.rejects(runHistory(async req => { const page = Number(new URL(req.url).searchParams.get('page')); return { quotes: rows.slice((page - 1) * 200, page * 200), total: page === 1 ? 201 : 202, page, pageSize: 200 }; }), invalidPage); });
test('repeated pages cannot duplicate rows beyond the declared complete total', async () => { const rows = Array.from({ length: 200 }, (_, i) => q(i + 1)); await assert.rejects(runHistory(async req => ({ quotes: rows, total: 201, page: Number(new URL(req.url).searchParams.get('page')), pageSize: 200 })), invalidPage); });

test('unavailable saved complete-goods value renders as unavailable rather than zero blank or saved subtotal', async () => {
  const amountBreakdown = { grossNewJewelryValue: { available: false, reason: 'not-saved' }, savedSubtotal: 123.45 }, row = { id: 'SYNTHETIC-ORDER-1', number: 'SO-1', customerName: '虚构换新客户', ownerName: '虚构员工', date: '2026-10-19', title: '虚构克换克', weight: 2, itemCount: 1, grossNewJewelryValue: null, discount: 0, netBalance: 100, oldCredit: 0, amountBreakdown };
  const result = await exportData({ kind: 'sales', parameters: new URLSearchParams({ basis: 'confirmed' }), core: { salesReport: async () => ({ orders: [row], total: 1, page: 1, pageSize: 200, staff: [{ ...row, staffName: '虚构员工', orderCount: 1 }], daily: [{ ...row, orderCount: 1 }], metadata: { source: 'sales-orders', amountBreakdown } }) }, administration: {}, user: { id: 'synthetic-admin' }, request });
  for (const sheet of sheets(result)) { const column = sheet[0].findIndex(value => /新货.*金额|新首饰.*原价|完整新货/.test(value)); assert(column >= 0); assert(['未保存', '—'].includes(sheet[1][column]), 'unavailable gross must be explicit in detail and each summary sheet'); assert.notEqual(sheet[1][column], '123.45'); }
});

test('known saved zero remains numeric zero and is distinct from unavailable value', async () => {
  const row = { id: 'SYNTHETIC-ZERO', number: 'SO-ZERO', customerName: '虚构客户', ownerName: '虚构员工', date: '2026-10-19', title: '虚构零值', weight: 1, itemCount: 1, grossNewJewelryValue: 0, discount: 0, netBalance: 0, oldCredit: 0, amountBreakdown: { grossNewJewelryValue: { available: true, source: 'saved' } } };
  const result = await exportData({ kind: 'sales', parameters: new URLSearchParams({ basis: 'confirmed' }), core: { salesReport: async () => ({ orders: [row], total: 1, page: 1, pageSize: 200, staff: [], daily: [] }) }, administration: {}, user: { id: 'synthetic-admin' }, request });
  const sheet = sheets(result)[0], column = sheet[0].findIndex(value => /新货.*金额|新首饰.*原价|完整新货/.test(value)); assert.equal(sheet[1][column], '0');
});

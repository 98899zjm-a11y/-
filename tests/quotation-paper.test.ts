import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
// @ts-ignore Node's native TypeScript loader requires the explicit extension.
import { quoteInputSchema, defaultSettings } from '../lib/domain.ts';

const source = readFileSync(resolve('components/quote-card.tsx'), 'utf8').replace('from "@/lib/domain";', `from ${JSON.stringify(pathToFileURL(resolve('lib/domain.ts')).href)};`);
const script = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText.replace('from "react/jsx-runtime";', `from ${JSON.stringify(import.meta.resolve('react/jsx-runtime'))};`) + '\n//# sourceURL=jewelry-paper-under-review.mjs';
const { createQuotePages, calculateQuote: paperCalculate } = await import('data:text/javascript;base64,' + Buffer.from(script).toString('base64'));
const repair = (patch: Record<string, unknown> = {}) => quoteInputSchema.parse({ type: 'repair', customerId: 'customer-a', title: '首饰维修', repairItems: [{ id: 'resize', categoryId: 'ring-size', name: '指圈调整', mode: 'fixed', quantity: 1, price: 120 }], insured: false, insuredValue: 5000, insuranceRate: 6, ...patch });

test('维修报价纸面逐项金额与合计在半分边界使用相同精确舍入', () => {
  const q = repair({ repairItems: [{ id: 'gold', categoryId: 'add-metal', name: '加金操作', mode: 'gram', quantity: 2.005, price: 1001, note: '' }] });
  const papers = createQuotePages(q, defaultSettings);
  assert.equal(papers[0].lines[0].value, '2,007.01 元');
  assert.equal(papers[0].total, 2007.01);
});

test('销售纸面允许减免精确舍入后的全部合计金额', () => {
  const q = quoteInputSchema.parse({ type: 'sale', customerId: 'customer-a', title: '定制', weight: 2.005, goldPrice: 1001, laborPrice: 0, extras: [], discountType: 'amount', discountValue: 2007.01 });
  const result = paperCalculate(q);
  assert.equal(result.validationMessage, '');
  assert.equal(result.total, 0);
});

test('客户纸面/PNG共同数据：未勾选保价时完全省略保价、比例、确认价值', () => {
  const papers = createQuotePages(repair(), defaultSettings, { customerName: '客户A', number: 'M20261010-TEST' });
  const printed = JSON.stringify(papers);
  assert.doesNotMatch(printed, /保价|确认价值|5000|6%/);
  assert.equal(papers[0].total, 120);
  assert.deepEqual(papers[0].parameters, [{ label: '维修项目', value: '1 项' }]);
});

test('勾选保价的纸面展示确认价值、比例、保价费和总价', () => {
  const papers = createQuotePages(repair({ insured: true }), defaultSettings, { customerName: '客户A', number: 'M20261010-TEST' });
  assert.deepEqual(papers[0].parameters, [{ label: '维修项目', value: '1 项' }, { label: '确认价值', value: '5,000.00 元' }, { label: '保价比例', value: '6%' }]);
  assert.ok(papers[0].lines.some((line: { label: string; value: string }) => line.label === '保价费' && line.value === '300.00 元'));
  assert.equal(papers[0].total, 420);
});

test('30个维修项分成10页，每项完整保留，编号/总价一致，保价只在最终合计', () => {
  const items = Array.from({ length: 30 }, (_, i) => ({ id: `item-${i}`, categoryId: 'other', name: `维修${i + 1}`, mode: 'fixed', quantity: 1, price: i + 1 }));
  const papers = createQuotePages(repair({ repairItems: items, insured: true }), defaultSettings, { customerName: '客户A', number: 'M20261010-TEST' });
  assert.equal(papers.length, 10);
  assert.equal(papers.flatMap((paper: { lines: { label: string }[] }) => paper.lines).filter((line: { label: string }) => /^维修\d/.test(line.label)).length, 30);
  papers.forEach((paper: { number: string; page: number; pages: number; total: number }, i: number) => { assert.equal(paper.number, 'M20261010-TEST'); assert.equal(paper.page, i + 1); assert.equal(paper.pages, 10); assert.equal(paper.total, 765); });
  assert.equal(papers.flatMap((paper: { lines: { label: string }[] }) => paper.lines).filter((line: { label: string }) => line.label === '保价费').length, 1);
});

test('30条销售附加费完整分页，折扣只展示一次，所有页使用最终总价', () => {
  const q = quoteInputSchema.parse({ type: 'sale', customerId: 'customer-a', title: '定制戒指', weight: 3.2, goldPrice: 450, laborPrice: 80, extras: Array.from({ length: 30 }, (_, i) => ({ id: `extra-${i}`, name: `附加${i + 1}`, amount: 10 })), discountType: 'amount', discountValue: 100 });
  const papers = createQuotePages(q, defaultSettings, { number: 'S20261010-TEST' });
  assert.equal(papers.length, 8);
  assert.equal(papers.flatMap((paper: { lines: { label: string }[] }) => paper.lines).filter((line: { label: string }) => /^附加\d/.test(line.label)).length, 30);
  assert.equal(papers.flatMap((paper: { lines: { label: string }[] }) => paper.lines).filter((line: { label: string }) => line.label === '优惠减免').length, 1);
  papers.forEach((paper: { total: number; number: string }) => { assert.equal(paper.total, 1896); assert.equal(paper.number, 'S20261010-TEST'); });
});

test('销售纸面金料和每克工费明细与总价可核对', () => {
  const q = quoteInputSchema.parse({ type: 'sale', customerId: 'customer-a', title: '铂金戒指', weight: 3.2, goldPrice: 450, laborPrice: 80, extras: [{ id: 'diamond', name: '钻石附加费', amount: 900 }, { id: 'accessory', name: '配件', amount: 150 }], discountType: 'amount', discountValue: 200 });
  const pages = createQuotePages(q, defaultSettings, { number: 'S20261010-TEST' });
  const lines = pages.flatMap((page: { lines: { label: string; value: string }[] }) => page.lines);
  assert.equal(lines.find((line: { label: string }) => line.label === '金料费').value, '1,440.00 元');
  assert.equal(lines.find((line: { label: string }) => line.label === '加工费').value, '256.00 元');
  assert.equal(lines.find((line: { label: string }) => line.label === '报价合计').value, '2,746.00 元');
  assert.equal(pages[0].total, 2546);
});

test('历史回收报价纸面使用快照材质名称，不受公司改名影响', () => {
  const q = { ...quoteInputSchema.parse({ type: 'recycling', customerId: 'customer-a', title: '铂金回收', material: 'platinum', weight: 3.2, goldPrice: 450, recyclingCoefficient: 0.94 }), recyclingName: 'Pt950铂金' };
  const changed = structuredClone(defaultSettings);
  changed.recycling[1].name = '改名后的铂金';
  const paper = createQuotePages(q, changed, { number: 'R20261010-TEST' })[0];
  assert.equal(paper.lines.find((line: { label: string }) => line.label === '回收材质').value, 'Pt950铂金');
  assert.equal(paper.total, 1353.6);
});

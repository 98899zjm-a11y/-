import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';
// @ts-ignore Node's native TypeScript loader requires the explicit extension.
import { quoteInputSchema, defaultSettings } from '../lib/domain.ts';

const source = readFileSync(resolve('components/quote-card.tsx'), 'utf8').replace('import "./quote-paper.css";', '').replace('from "@/lib/domain";', `from ${JSON.stringify(pathToFileURL(resolve('lib/domain.ts')).href)};`);
const script = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText.replace('from "react/jsx-runtime";', `from ${JSON.stringify(import.meta.resolve('react/jsx-runtime'))};`) + '\n//# sourceURL=jewelry-paper-under-review.mjs';
const paperModuleUrl = 'data:text/javascript;base64,' + Buffer.from(script).toString('base64');
const { createQuotePages, calculateQuote: paperCalculate, default: QuoteCard } = await import(paperModuleUrl);
const repair = (patch: Record<string, unknown> = {}) => quoteInputSchema.parse({ type: 'repair', customerId: 'customer-a', title: '首饰维修', repairItems: [{ id: 'resize', categoryId: 'ring-size', name: '指圈调整', mode: 'fixed', quantity: 1, price: 120 }], insured: false, insuredValue: 5000, insuranceRate: 6, ...patch });

test('旧定制草稿残留销售数组不导致预览崩溃，也不把错误商品费用显示给客户', () => {
  const base = quoteInputSchema.parse({ type: 'custom', customerId: 'customer-a', title: '定制金链', weight: 2, goldPrice: 450, laborPrice: 80 });
  const oldDraft = { ...base, saleItems: [{ id: 'stale', title: '错误残留商品', material: '黄金', specs: '', image: '', weight: 100, goldPrice: 999, laborPrice: 0, extras: [], quantity: 1 }] };
  const papers = createQuotePages(oldDraft, defaultSettings);
  assert.equal(papers[0].total, 1060);
  assert.equal(papers.flatMap((paper: { products?: unknown[] }) => paper.products || []).length, 0);
  assert.doesNotMatch(JSON.stringify(papers), /错误残留商品|99,900/);
});

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

const sale = (patch: Record<string, unknown> = {}) => quoteInputSchema.parse({ type: 'sale', customerId: 'customer-a', title: '珠宝报价', material: 'Pt950', weight: 3.2, goldPrice: 450, laborPrice: 80, extras: [], ...patch });
const flatLines = (pages: { lines: { label: string; value: string }[] }[]) => pages.flatMap(page => page.lines);
const paymentMethods = [
  { id: 'wechat', name: '微信', details: '收款人：鑫金源', image: 'data:image/png;base64,AAA=' },
  { id: 'alipay', name: '支付宝', details: '收款人：鑫金源', image: 'data:image/png;base64,BBB=' },
  { id: 'bank', name: '银行卡', details: '工商银行 6222001234567890123', image: '' },
  { id: 'cash', name: '现金', details: '门店收款', image: '' },
];

test('所有客户纸面与网页隐藏计算方式、公式、乘号和回收系数，只显示实际回收单价', () => {
  const pages = createQuotePages(sale({ type: 'recycling', material: 'platinum', recyclingCoefficient: 0.9417 }), defaultSettings);
  const customerData = JSON.stringify(pages);
  const html = pages.map((paper: object) => renderToStaticMarkup(QuoteCard({ paper }))).join('');
  assert.doesNotMatch(customerData + html, /计算方式|参考金价|回收系数|recyclingCoefficient|0\.9417|×/);
  assert.equal(pages[0].parameters.find((parameter: { label: string }) => parameter.label === '实际回收单价').value, '423.765 元/克');
  const repairPages = createQuotePages(repair({ repairItems: [{ id: 'weld', categoryId: 'welding', name: '焊接', mode: 'count', quantity: 2, price: 80 }] }), defaultSettings);
  assert.equal(repairPages[0].lines[0].detail, '2 次');
  assert.doesNotMatch(JSON.stringify(repairPages), /×|basis|计算方式/);
});

for (const type of ['sale', 'custom', 'tradein']) test(`${type}收款方式仅用当次快照，每页最多两项且二维码原地址完整保留`, () => {
  const pages = createQuotePages(sale({ type, tradeIn: { mode: 'gram', oldMaterial: 'gold', oldWeight: 2, depreciationPrice: 20, excessMode: 'recycle', excessGoldPrice: 450, excessCoefficient: .99 }, paymentMethods }), defaultSettings, { number: 'TEST-PAYMENT' });
  const paymentPages = pages.filter((paper: { payments?: object[] }) => paper.payments?.length);
  assert.equal(paymentPages.length, 2);
  assert.equal(paymentPages[0].paymentPlacement, 'inline');
  assert.ok(paymentPages[0].lines.length <= 2);
  assert.deepEqual(paymentPages.flatMap((paper: { payments: { id: string }[] }) => paper.payments.map(method => method.id)), ['wechat', 'alipay', 'bank', 'cash']);
  assert.equal(paymentPages[0].payments[0].image, paymentMethods[0].image);
  paymentPages.forEach((paper: { payments: object[]; number: string }) => { assert.ok(paper.payments.length <= 2); assert.equal(paper.number, 'TEST-PAYMENT'); });
});

test('明确空收款方式和旧快照缺少收款字段均不继承后来公司的默认值', () => {
  const configured = { ...defaultSettings, paymentMethods };
  const q = sale({ paymentMethods: [] });
  const { paymentMethods: _snapshotMethods, ...legacy } = q;
  assert.ok(createQuotePages(q, configured).every((paper: { payments?: object[] }) => !paper.payments?.length));
  assert.ok(createQuotePages(legacy, configured).every((paper: { payments?: object[] }) => !paper.payments?.length));
});

test('定制长要求、收款长详情与备注自动完整续页，不裁掉信息', () => {
  const customDetails = '按客户确认的尺寸制作并保留戒臂纹理。'.repeat(30);
  const details = '收款账户的户名和完整银行信息应与客户确认。'.repeat(20);
  const note = '交付前确认客户选择的规格。'.repeat(15);
  const q = sale({ type: 'custom', customDetails, note, paymentMethods: [{ ...paymentMethods[2], details }] });
  const pages = createQuotePages(q, defaultSettings, { number: 'CUSTOM-LONG' });
  assert.ok(pages.length > 3);
  const text = pages.flatMap((paper: { continuation?: string[] }) => paper.continuation || []).join('');
  assert.ok(text.includes(customDetails));
  assert.ok(text.includes(details));
  assert.ok(text.includes(note));
  assert.ok(pages.every((paper: { continuation?: string[]; typeLabel: string }) => !paper.continuation || paper.continuation.length <= 11));
  assert.ok(pages.every((paper: { typeLabel: string }) => paper.typeLabel === '定制报价单'));
});

test('克换克折旧、补金和旧金多余回收抵扣均用权威金额，不展示任何系数', () => {
  const q = sale({ type: 'tradein', weight: 3, goldPrice: 450, laborPrice: 80, tradeIn: { mode: 'gram', oldMaterial: 'gold', oldWeight: 2, depreciationPrice: 20, excessMode: 'recycle', excessGoldPrice: 450, excessCoefficient: .9876 } });
  const pages = createQuotePages(q, defaultSettings);
  const lines = flatLines(pages);
  assert.equal(lines.find(line => line.label === '折旧费')?.value, '40.00 元');
  assert.equal(lines.find(line => line.label === '加工费')?.value, '240.00 元');
  assert.equal(lines.find(line => line.label === '补金费用')?.value, '450.00 元');
  assert.equal(pages[0].total, 730);
  assert.equal(pages[0].totalLabel, '客户应补金额');
  assert.doesNotMatch(JSON.stringify(pages), /系数|0\.9876|计算方式|×/);
  const refund = createQuotePages(sale({ type: 'tradein', weight: 2, laborPrice: 80, tradeIn: { mode: 'gram', oldMaterial: 'gold', oldWeight: 3, depreciationPrice: 20, excessMode: 'recycle', excessGoldPrice: 450, excessCoefficient: .99 } }), defaultSettings);
  assert.equal(refund[0].total, 245.5);
  assert.equal(refund[0].totalLabel, '应退客户金额');
  assert.equal(flatLines(refund).find(line => line.label === '多余旧金回收抵扣')?.value, '− 445.50 元');
});

test('异材质按价值换新：正常新首饰价减整件旧料回收抵扣，没有折旧费', () => {
  const pages = createQuotePages(sale({ type: 'tradein', weight: 2, goldPrice: 450, laborPrice: 80, tradeIn: { mode: 'value', oldMaterial: 'platinum', oldWeight: 3, depreciationPrice: 20, excessMode: 'recycle', excessGoldPrice: 450, excessCoefficient: .94 } }), defaultSettings);
  const lines = flatLines(pages);
  assert.equal(lines.find(line => line.label === '新首饰价')?.value, '1,060.00 元');
  assert.equal(lines.find(line => line.label === '旧料回收抵扣')?.value, '− 1,269.00 元');
  assert.ok(!lines.some(line => line.label === '折旧费'));
  assert.equal(pages[0].total, 209);
  assert.equal(pages[0].totalLabel, '应退客户金额');
});

test('两款销售放同一张纸面，完整照片/重量/数量/各项金额；根旧字段不重复计算', () => {
  const items = [
    { id: 'one', title: '铂金戒指', material: 'Pt950', specs: '圈号12', image: 'data:image/png;base64,AAA=', weight: 3, goldPrice: 450, laborPrice: 80, quantity: 2, extras: [{ id: 'diamond', name: '钻石附加费', amount: 100 }] },
    { id: 'two', title: '黄金吊坠', material: '黄金', specs: '圆形', image: 'data:image/png;base64,BBB=', weight: 2, goldPrice: 600, laborPrice: 50, quantity: 1, extras: [] },
  ];
  const pages = createQuotePages(sale({ saleItems: items, weight: 999, goldPrice: 999, laborPrice: 999, extras: [{ id: 'legacy', name: '旧根附加费', amount: 999 }], discountType: 'amount', discountValue: 200 }), defaultSettings, { number: 'MULTI-SALE' });
  assert.equal(pages.length, 1);
  assert.deepEqual(pages[0].products.map((product: { id: string }) => product.id), ['one', 'two']);
  assert.equal(pages[0].products[0].image, items[0].image);
  assert.equal(pages[0].products[0].total, 3380);
  assert.equal(pages[0].products[1].total, 1300);
  assert.equal(pages[0].total, 4480);
  assert.equal(pages[0].lines.filter((line: { label: string }) => line.label === '优惠减免').length, 1);
  assert.doesNotMatch(JSON.stringify(pages), /旧根附加费|计算方式|×/);
});

test('多件回收各自材质/重量/实际单价/金额完整呈现，整单总价只由条目相加', () => {
  const items = [
    { id: 'gold', title: '黄金手链', material: 'gold', specs: '实心', image: '', weight: 3, goldPrice: 450, recyclingCoefficient: .99 },
    { id: 'pt', title: '铂金戒指', material: 'platinum', specs: 'Pt950', image: '', weight: 2, goldPrice: 300, recyclingCoefficient: .94 },
    { id: 'silver', title: '银镯', material: 'silver', specs: '白银', image: '', weight: 20, goldPrice: 5, recyclingCoefficient: .9 },
  ];
  const pages = createQuotePages(sale({ type: 'recycling', recyclingItems: items, weight: 999, goldPrice: 999, material: 'gold', recyclingCoefficient: 9 }), defaultSettings, { number: 'MULTI-RECYCLE' });
  const products = pages.flatMap((paper: { products?: object[] }) => paper.products || []);
  assert.equal(products.length, 3);
  assert.deepEqual(products.map((product: { id: string }) => product.id), ['gold', 'pt', 'silver']);
  assert.equal(products[0].parameters.find((parameter: { label: string }) => parameter.label === '实际单价').value, '445.5 元/克');
  assert.equal(products[1].total, 564);
  assert.equal(pages[0].total, 1990.5);
  assert.ok(pages.every((paper: { number: string }) => paper.number === 'MULTI-RECYCLE'));
  assert.doesNotMatch(JSON.stringify(pages), /系数|参考金价|计算方式|×/);
});

test('多件销售较多附加费仍完整保留，每款只出现一次，整单优惠及付款只一次', () => {
  const extras = Array.from({ length: 8 }, (_, i) => ({ id: `extra-${i}`, name: `附加费用${i}`, amount: i + 1 }));
  const items = Array.from({ length: 5 }, (_, i) => ({ id: `product-${i}`, title: `商品${i}`, material: '黄金', specs: '', image: '', weight: 1, goldPrice: 450, laborPrice: 80, quantity: 1, extras }));
  const pages = createQuotePages(sale({ saleItems: items, discountType: 'amount', discountValue: 100, paymentMethods: [paymentMethods[0]] }), defaultSettings);
  assert.equal(pages.flatMap((paper: { products?: object[] }) => paper.products || []).length, 5);
  const all = pages.flatMap((paper: { lines: object[]; products?: { lines: object[] }[] }) => [...paper.lines, ...(paper.products || []).flatMap(product => product.lines)]);
  for (let i = 0; i < 8; i++) assert.equal(all.filter((line: { label: string }) => line.label === `附加费用${i}`).length, 5);
  assert.equal(flatLines(pages).filter(line => line.label === '优惠减免').length, 1);
  assert.equal(pages.flatMap((paper: { payments?: object[] }) => paper.payments || []).length, 1);
  assert.equal(pages[0].total, 2730);
});

test('多件付款与说明续页只显示真实款数、件数和合计重量，不显示根草稿99999或0参数', () => {
  const items = [
    { id: 'a', title: '戒指', material: '黄金', specs: '', image: '', weight: 2, goldPrice: 450, laborPrice: 80, quantity: 2, extras: [] },
    { id: 'b', title: '吊坠', material: '黄金', specs: '', image: '', weight: 1, goldPrice: 450, laborPrice: 80, quantity: 3, extras: [] },
  ];
  const pages = createQuotePages(sale({ saleItems: items, weight: 99999, goldPrice: 99999, laborPrice: 0, paymentMethods }), defaultSettings);
  const paymentPages = pages.filter((paper: { payments?: object[] }) => paper.payments?.length);
  assert.ok(paymentPages.length > 0);
  for (const paper of paymentPages) {
    assert.deepEqual(paper.parameters, [{ label: '商品款数', value: '2 款' }, { label: '件数', value: '5 件' }, { label: '合计金重', value: '7.000 克' }]);
    assert.doesNotMatch(JSON.stringify(paper.parameters), /99999|0\.000 克|金价|每克工费/);
  }
  const recyclingItems = [
    { id: 'gold', title: '黄金首饰', material: 'gold', specs: '', image: '', weight: 4, goldPrice: 450, recyclingCoefficient: .99 },
    { id: 'pt', title: '铂金首饰', material: 'platinum', specs: '', image: '', weight: 1.5, goldPrice: 300, recyclingCoefficient: .94 },
  ];
  const recycling = createQuotePages(sale({ type: 'recycling', material: 'gold', recyclingItems, weight: 0, goldPrice: 99999, note: '客户已确认各件回收首饰信息。'.repeat(12) }), defaultSettings);
  const continuation = recycling.filter((paper: { continuation?: string[] }) => paper.continuation?.length);
  assert.ok(continuation.length > 0);
  for (const paper of continuation) {
    assert.deepEqual(paper.parameters, [{ label: '回收物品', value: '2 件' }, { label: '合计重量', value: '5.500 克' }]);
    assert.doesNotMatch(JSON.stringify(paper.parameters), /99999|0\.000 克|单价|系数/);
  }
});

test('PNG绘制使用相同纸面数据，固定1080x1920并保留付款二维码清晰尺寸', async () => {
  const imageSource = readFileSync(resolve('lib/quote-image.ts'), 'utf8').replace(/import type[^;]+;/, '').replace('from "@/components/quote-card";', `from ${JSON.stringify(paperModuleUrl)};`);
  const imageScript = ts.transpileModule(imageSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText + '\n//# sourceURL=jewelry-image-under-review.mjs';
  const { createQuoteImage } = await import('data:text/javascript;base64,' + Buffer.from(imageScript).toString('base64'));
  const texts: string[] = [], drawings: number[][] = [], canvases: { width: number; height: number }[] = [];
  const globals = globalThis as unknown as Record<string, unknown>;
  const previousDocument = globals.document, previousImage = globals.Image;
  globals.Image = class { naturalWidth = 300; naturalHeight = 300; crossOrigin = ''; onload?: () => void; set src(_value: string) { queueMicrotask(() => this.onload?.()); } };
  globals.document = { fonts: { ready: Promise.resolve() }, createElement() { const canvas = { width: 0, height: 0, getContext: () => ({ scale() {}, fillRect() {}, save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, drawImage(_image: object, ...args: number[]) { drawings.push(args); }, fillText(value: string) { texts.push(value); }, measureText(value: string) { return { width: value.length * 6 }; } }), toDataURL: () => 'data:image/png;base64,TEST' }; canvases.push(canvas); return canvas; } };
  try {
    const paper = createQuotePages(sale({ paymentMethods: paymentMethods.slice(0, 2) }), defaultSettings).find((page: { payments?: object[] }) => page.payments?.length);
    await createQuoteImage(paper);
    assert.deepEqual(canvases.map(canvas => [canvas.width, canvas.height]), [[1080, 1920]]);
    assert.equal(drawings.filter(args => args[2] === 100 && args[3] === 100).length, 2);
    assert.ok(texts.includes('收款方式'));
    assert.doesNotMatch(texts.join(''), /计算方式|参考金价|回收系数|×/);
  } finally { if (previousDocument === undefined) delete globals.document; else globals.document = previousDocument; if (previousImage === undefined) delete globals.Image; else globals.Image = previousImage; }
});

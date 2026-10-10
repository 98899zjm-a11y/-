import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';
// @ts-ignore Native Node TypeScript needs the explicit extension.
import { defaultSettings, quoteInputSchema } from '../lib/domain.ts';

function moduleSource(path: string) {
  const source = readFileSync(resolve(path), 'utf8').replace(/import "\.\/[^"\n]+\.css";/g, '').replace('from "@/lib/domain";', `from ${JSON.stringify(pathToFileURL(resolve('lib/domain.ts')).href)};`);
  return ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText
    .replace('from "react/jsx-runtime";', `from ${JSON.stringify(import.meta.resolve('react/jsx-runtime'))};`)
    .replace('from "react";', `from ${JSON.stringify(import.meta.resolve('react'))};`)
    .replace('from "react-dom";', `from ${JSON.stringify(import.meta.resolve('react-dom'))};`);
}
const paperScript = moduleSource('components/quote-card.tsx') + '\n//# sourceURL=a4-paper-data-under-review.mjs';
const { createQuotePages } = await import('data:text/javascript;base64,' + Buffer.from(paperScript).toString('base64'));
const a4Script = moduleSource('components/a4-quotation.tsx') + '\n//# sourceURL=a4-print-under-review.mjs';
const { A4Document, printA4Document } = await import('data:text/javascript;base64,' + Buffer.from(a4Script).toString('base64'));
const render = (papers: object[]) => renderToStaticMarkup(A4Document({ papers }));
const base = (patch: Record<string, unknown> = {}) => quoteInputSchema.parse({ type: 'sale', customerId: 'client', title: '铂金戒指', material: 'Pt950', weight: 3.2, goldPrice: 450, laborPrice: 80, extras: [], ...patch });

test('A4重新排版真实文字和照片，保留报价编号、客户、日期、费用、最终价及页码', () => {
  const papers = createQuotePages(base({ discountType: 'amount', discountValue: 100 }), defaultSettings, { customerName: '客户甲', date: '2026-10-10', number: 'S20261010-CANONICAL' });
  const html = render(papers);
  assert.match(html, /A4 第1页/);
  for (const value of ['鑫金源', '客户甲', '2026-10-10', 'S20261010-CANONICAL', '金料费', '加工费', '优惠减免', '1,596.00']) assert.ok(html.includes(value));
  assert.match(html, /<table>/);
  assert.doesNotMatch(html, /class="quote-paper|class="qp-paper|canvas|1080|1920/);
  assert.equal((html.match(/class="a4-preview-page"/g) || []).length, papers.length);
});

test('A4遵守客户隐私显示：不展示计算方式、参考金价、系数和未选保价', () => {
  const recycling = render(createQuotePages(base({ type: 'recycling', material: 'platinum', recyclingCoefficient: .9417 }), defaultSettings));
  assert.match(recycling, /实际回收单价/);
  assert.doesNotMatch(recycling, /计算方式|参考金价|系数|0\.9417|×/);
  const repair = render(createQuotePages(base({ type: 'repair', insured: false, insuredValue: 5000, insuranceRate: 6, repairItems: [{ id: 'w', categoryId: 'welding', name: '焊接', mode: 'count', quantity: 2, price: 80 }] }), defaultSettings));
  assert.match(repair, /2 次/);
  assert.doesNotMatch(repair, /保价|确认价值|6%|5000|×/);
});

test('A4多件完整呈现每件照片、规格、数量、明细和小计，优惠只出现一次', () => {
  const saleItems = [{ id: 'a', title: '戒指甲', material: 'Pt950', specs: '圈号12', image: 'data:image/png;base64,AAA=', weight: 2, goldPrice: 450, laborPrice: 80, quantity: 2, extras: [{ id: 'stone', name: '钻石', amount: 100 }] }, { id: 'b', title: '吊坠乙', material: '黄金', specs: '圆形', image: 'data:image/png;base64,BBB=', weight: 1, goldPrice: 600, laborPrice: 50, quantity: 1, extras: [] }];
  const html = render(createQuotePages(base({ saleItems, discountType: 'amount', discountValue: 100 }), defaultSettings, { number: 'MULTI-A4' }));
  for (const value of ['戒指甲', '吊坠乙', '圈号12', '圆形', 'data:image/png;base64,AAA=', 'data:image/png;base64,BBB=', '钻石', '2,320.00', '650.00', '2,870.00']) assert.ok(html.includes(value), value);
  assert.equal((html.match(/优惠减免/g) || []).length, 1);
});

test('A4原始收款二维码、长说明与补充页完整保留，所有页使用正式编号', () => {
  const customDetails = '依据客户确定的规格制作首饰并记录交付要求。'.repeat(25);
  const papers = createQuotePages(base({ type: 'custom', customDetails, paymentMethods: [{ id: 'wechat', name: '微信', details: '收款人：鑫金源', image: 'data:image/png;base64,PAYMENT=' }] }), defaultSettings, { number: 'C20261010-A4' });
  const html = render(papers);
  assert.ok(papers.length > 1);
  assert.match(html, /data:image\/png;base64,PAYMENT=/);
  assert.match(html, /class="a4-qr"/);
  const plain = [...html.matchAll(/class="a4-continuation">[\s\S]*?<p>([\s\S]*?)<\/p>/g)].map(match => match[1]).join('').replace(/\n/g, '');
  assert.ok(plain.includes(customDetails));
  assert.equal((html.match(/data-quote-number="C20261010-A4"/g) || []).length, papers.length);
  assert.equal((html.match(/class="a4-preview-page"/g) || []).length, papers.length);
});

test('A4以旧换新退款方向与金额保留，打印不重新套销售价格', () => {
  const papers = createQuotePages(base({ type: 'tradein', weight: 2, goldPrice: 450, laborPrice: 80, tradeIn: { mode: 'value', oldMaterial: 'platinum', oldWeight: 3, depreciationPrice: 20, excessMode: 'recycle', excessGoldPrice: 450, excessCoefficient: .94 } }), defaultSettings);
  const html = render(papers);
  assert.match(html, /应退客户金额/);
  assert.match(html, /209\.00/);
  assert.match(html, /旧料回收抵扣/);
  assert.doesNotMatch(html, /折旧费|系数|计算方式|×/);
});

test('A4打印合同：真实纸张、单层12mm留白、打印隔离、二维码至少25mm、末页无额外分页', () => {
  const css = readFileSync(resolve('components/a4-quotation.css'), 'utf8');
  assert.match(css, /@page\s*\{size:A4 portrait;margin:0\}/);
  assert.match(css, /width:210mm!important;min-height:297mm!important;height:auto!important;padding:12mm!important/);
  assert.match(css, /body:has\(\.a4-print-root\)>\*:not\(\.a4-print-root\)\{display:none!important\}/);
  assert.match(css, /\.a4-print-root \.a4-toolbar\{display:none!important\}/);
  assert.match(css, /\.a4-preview-page:last-child\{break-after:auto;page-break-after:auto\}/);
  assert.match(css, /\.a4-qr\{width:28mm!important;height:28mm!important;object-fit:contain\}/);
  assert.match(css, /width:min\(100%,210mm\)/);
  const printStyles = css.slice(css.indexOf('@media print'));
  assert.doesNotMatch(printStyles, /overflow:hidden|height:297mm!important;overflow:hidden/);
});

test('A4打印必须等待字体与照片/二维码解码完成，已有缓存照片不重解码', async () => {
  const events: string[] = [];
  const root = { isConnected: true, ownerDocument: { fonts: { ready: Promise.resolve().then(() => events.push('fonts')) } }, querySelectorAll: () => [{ complete: true, naturalWidth: 300, decode: () => { throw new Error('不应重复解码缓存图片'); } }, { complete: false, naturalWidth: 300, decode: async () => { await Promise.resolve(); events.push('image-decoded'); } }] };
  await printA4Document(root, () => events.push('print'));
  assert.deepEqual(events, ['fonts', 'image-decoded', 'print']);
});

test('A4二维码解码失败或预览已关闭时拒绝打印，防止空二维码或打印工作台', async () => {
  let prints = 0;
  const failed = { isConnected: true, ownerDocument: { fonts: { ready: Promise.resolve() } }, querySelectorAll: () => [{ complete: false, naturalWidth: 0, decode: async () => { throw new Error('加载失败'); } }] };
  await assert.rejects(() => printA4Document(failed, () => prints++), /二维码未能加载/);
  const closed = { isConnected: false, ownerDocument: { fonts: { ready: Promise.resolve() } }, querySelectorAll: () => [] };
  await assert.rejects(() => printA4Document(closed, () => prints++), /打印预览已关闭/);
  assert.equal(prints, 0);
});

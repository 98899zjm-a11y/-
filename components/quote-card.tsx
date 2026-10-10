"use client";

import { calculateQuote as domainCalculate, type QuoteInput, type QuoteType, type PriceMode, type Settings } from "@/lib/domain";
export type QuoteKind = QuoteType;
export type FeeMode = PriceMode;
export type QuoteDraft = QuoteInput & { recyclingName?: string };
export type AppSettings = Settings;
export type PaperLine = { label: string; value: string; basis?: string; divider?: boolean };
export type QuotePaper = {
  brand: AppSettings["brand"]; customerName: string; date: string; typeLabel: string;
  title: string; specs: string; image: string; parameters: { label: string; value: string }[];
  lines: PaperLine[]; total: number; totalLabel: string; note: string; page: number; pages: number; number: string; continuation?: string[];
};
export const money = (value: number) => Number(value || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const n = (value: number) => Math.max(0, Number(value) || 0);
export function calculateQuote(q: QuoteDraft) {
  const subtotal = round(q.weight * (q.goldPrice + q.laborPrice) + q.extras.reduce((sum, item) => sum + item.amount, 0));
  const invalid = q.type === "sale" && q.discountType === "amount" && q.discountValue > subtotal;
  const invalidPercent = q.type === "sale" && q.discountType === "percent" && q.discountValue > 100;
  const safe = { ...q, discountValue: invalid ? subtotal : invalidPercent ? 100 : q.discountValue };
  const result = domainCalculate(safe);
  return { ...result, base: result.subtotal, validationMessage: invalid ? "减免金额不能大于报价合计" : invalidPercent ? "实付比例不能超过100%" : "" };
}
export function wrapQuoteText(value: string, width = 26): string[] {
  const result: string[] = []; let current = "", used = 0;
  for (const char of value) { const size = char.charCodeAt(0) > 255 ? 1 : .58; if (char === "\n") { result.push(current); current = ""; used = 0; continue; } if (used + size > width && current) { result.push(current); current = ""; used = 0; } current += char; used += size; }
  if (current) result.push(current); return result;
}
export function createQuotePages(q: QuoteDraft, settings: AppSettings, meta: { customerName?: string; date?: string; number?: string } = {}): QuotePaper[] {
  const t = calculateQuote(q);
  const supplemental: string[] = [];
  const shorten = (value: string, label: string, width: number) => { if (wrapQuoteText(value, width).length <= 1) return value; supplemental.push(...wrapQuoteText(`${label}：${value}`, 25), ""); return `${wrapQuoteText(value, width - 5)[0]}（见续页）`; };
  const displayTitle = shorten(q.title || "珠宝报价", "报价名称", 22);
  const displaySpecs = shorten(q.specs || (q.type === "recycling" ? q.recyclingName || ({ gold: "黄金", platinum: "Pt950铂金", silver: "白银", kgold: "K金" } as Record<string, string>)[q.material] : q.material), "规格说明", 32);
  const displayCustomer = shorten(meta.customerName || "未填写客户", "客户姓名", 14);
  const fullNote = q.note || settings.brand.note || "";
  const displayNote = wrapQuoteText(fullNote, 26).length > 2 ? "完整备注见补充说明续页" : fullNote;
  if (displayNote !== fullNote) supplemental.push(...wrapQuoteText(`备注：${fullNote}`, 25), "");
  const label = q.type === "sale" ? "珠宝报价单" : q.type === "repair" ? "维修报价单" : "回收报价单";
  const parameters = q.type === "sale" ? [{ label: "金重", value: `${n(q.weight).toFixed(3)} 克` }, { label: "金价", value: `${money(q.goldPrice)} 元/克` }, { label: "每克工费", value: `${money(q.laborPrice)} 元/克` }] : q.type === "recycling" ? [{ label: "重量", value: `${n(q.weight).toFixed(3)} 克` }, { label: "参考金价", value: `${money(q.goldPrice)} 元/克` }, { label: "回收系数", value: String(q.recyclingCoefficient) }] : [{ label: "维修项目", value: `${q.repairItems.length} 项` }, ...(q.insured ? [{ label: "确认价值", value: `${money(q.insuredValue)} 元` }, { label: "保价比例", value: `${q.insuranceRate}%` }] : [])];
  let source: PaperLine[];
  if (q.type === "sale") source = [{ label: "金料费", value: `${money(t.metal)} 元` }, { label: "加工费", value: `${money(t.labor)} 元` }, ...q.extras.map((item, index) => ({ label: shorten(item.name || "附加费", `附加费${index + 1}名称`, 23), value: `${money(item.amount)} 元` }))];
  else if (q.type === "repair") source = q.repairItems.map((item, index) => { if (item.note) supplemental.push(...wrapQuoteText(`维修项目${index + 1}备注：${item.note}`, 25), ""); return { label: shorten(item.name, `维修项目${index + 1}名称`, 23), value: `${money(round(item.price * (item.mode === "fixed" ? 1 : item.quantity)))} 元`, basis: item.mode === "fixed" ? undefined : `${item.quantity} ${item.mode === "gram" ? "克" : "次"} × ${money(item.price)} 元` }; });
  else source = [{ label: "回收材质", value: q.recyclingName || ({ gold: "黄金", platinum: "Pt950铂金", silver: "白银", kgold: "K金" } as Record<string, string>)[q.material] || q.material }, { label: "回收单价", value: `${Number(t.recyclingUnitPrice.toFixed(6))} 元/克` }, { label: "计算方式", value: "重量 × 参考金价 × 系数" }, { label: "回收金额", value: `${money(t.base)} 元`, divider: true }];
  if (supplemental.length && fullNote && displayNote === fullNote) supplemental.push(...wrapQuoteText(`备注：${fullNote}`, 25), "");
  const size = q.type === "repair" ? 3 : 4;
  const chunks: PaperLine[][] = [];
  for (let i = 0; i < source.length; i += size) chunks.push(source.slice(i, i + size));
  if (!chunks.length) chunks.push([]);
  const pages = chunks.map((chunk, index) => {
    const lines = [...chunk];
    if (index === chunks.length - 1) {
      if (q.type === "sale") {
        lines.push({ label: "报价合计", value: `${money(t.base)} 元`, divider: true });
        if (q.discountType !== "none") lines.push({ label: q.discountType === "percent" ? `整单折扣 · ${Number((q.discountValue / 10).toFixed(3))} 折` : "优惠减免", value: `− ${money(t.discount)} 元` });
      } else if (q.type === "repair") {
        lines.push({ label: "维修费用合计", value: `${money(t.base)} 元`, divider: true });
        if (q.insured) lines.push({ label: "保价费", value: `${money(t.insurance)} 元` });
      }
    }
    return { brand: settings.brand, customerName: displayCustomer, date: meta.date || new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" }), number: meta.number || "DRAFT", typeLabel: label, title: displayTitle, specs: displaySpecs, image: q.image || "/ring.jpg", parameters, lines, total: t.total, totalLabel: q.type === "recycling" ? "客户实收金额" : q.type === "repair" ? "维修总价" : "优惠后总价", note: supplemental.length ? "另有补充说明，请一并查看续页" : displayNote, page: index + 1, pages: chunks.length } as QuotePaper;
  });
  for (let index = 0; index < supplemental.length; index += 11) pages.push({ ...pages[0], lines: [], continuation: supplemental.slice(index, index + 11), note: "" });
  return pages.map((paper, index) => ({ ...paper, page: index + 1, pages: pages.length }));
}
export default function QuoteCard({ paper }: { paper: QuotePaper }) {
  return <div className="paper-frame"><article className="quote-paper" aria-label={`${paper.typeLabel} 第${paper.page}页`}>
    <header className="paper-brand"><div style={{ fontSize: `${Math.min(6.4, 88 / Math.max(1, (paper.brand.english || "XIN JIN YUAN").length * .68))}cqw` }}>{paper.brand.english || "XIN JIN YUAN"}</div><span>{paper.brand.name || "鑫金源"}</span></header>
    <div className="paper-meta"><span>客户：{paper.customerName}</span><span>{paper.date}</span></div>
    <section className="paper-product"><img src={paper.image} alt={paper.title} /><div><p>{paper.typeLabel}</p><h3>{paper.title}</h3><span>{paper.specs}</span></div></section>
    <section className={`paper-parameters ${paper.parameters.length === 1 ? "single" : ""}`}>{paper.parameters.map(item => <div key={item.label}><span>{item.label}</span><strong>{item.value}</strong></div>)}</section>
    <section className="paper-details"><h4>{paper.continuation ? "补充说明" : "费用明细"}</h4>{paper.continuation ? <p className="paper-continuation">{paper.continuation.join("\n")}</p> : <dl>{paper.lines.map((line, index) => <div className={`paper-line ${line.divider ? "divider" : ""}`} key={index}><dt>{line.label}{line.basis && <small>{line.basis}</small>}</dt><dd>{line.value}</dd></div>)}</dl>}</section>
    <div className="paper-total"><span>{paper.totalLabel}</span><strong className={money(paper.total).length > 12 ? "long" : ""}>{money(paper.total)}<small>元</small></strong></div>
    <div className="paper-note">{paper.note}</div><footer className="paper-footer"><span>{paper.number}</span><span>{paper.pages > 1 ? `${paper.page} / ${paper.pages}` : paper.brand.contact || "专属报价"}</span></footer>
  </article></div>;
}

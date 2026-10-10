"use client";

import { calculateQuote as domainCalculate, defaultTradeIn, type QuoteInput, type QuoteType, type PriceMode, type Settings, type PaymentMethod } from "@/lib/domain";
import "./quote-paper.css";

export type QuoteKind = QuoteType;
export type FeeMode = PriceMode;
export type QuoteDraft = QuoteInput & { recyclingName?: string; tradeInMaterialName?: string };
export type AppSettings = Settings;
export type PaperLine = { label: string; value: string; detail?: string; divider?: boolean };
export type PaperPayment = { id: string; name: string; detailLines: string[]; image: string };
export type PaperProduct = { id: string; title: string; specs: string; image: string; parameters: { label: string; value: string }[]; lines: PaperLine[]; total: number; totalLabel: string };
export type QuotePaper = {
  brand: AppSettings["brand"]; customerName: string; date: string; typeLabel: string;
  title: string; specs: string; image: string; parameters: { label: string; value: string }[];
  lines: PaperLine[]; total: number; totalLabel: string; note: string; page: number; pages: number;
  number: string; continuation?: string[]; continuationTitle?: string;
  payments?: PaperPayment[]; paymentPlacement?: "inline" | "page"; products?: PaperProduct[];
};
export const money = (value: number) => Number(value || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const weight = (value: number) => `${Math.max(0, value || 0).toFixed(3)} 克`;
const metalNames: Record<string, string> = { gold: "黄金", platinum: "Pt950铂金", silver: "白银", kgold: "K金" };
const saleKinds = ["sale", "custom", "tradein"];

export function calculateQuote(q: QuoteDraft) {
  const subtotal = domainCalculate({ ...q, discountType: "none" }).subtotal;
  const saleLike = saleKinds.includes(q.type);
  const invalid = saleLike && q.discountType === "amount" && q.discountValue > subtotal;
  const invalidPercent = saleLike && q.discountType === "percent" && q.discountValue > 100;
  const result = domainCalculate({ ...q, discountValue: invalid ? subtotal : invalidPercent ? 100 : q.discountValue });
  return { ...result, base: result.subtotal, validationMessage: invalid ? "减免金额不能大于报价合计" : invalidPercent ? "实付比例不能超过100%" : "" };
}
export function wrapQuoteText(value: string, width = 26): string[] {
  const result: string[] = []; let current = "", used = 0;
  for (const char of value) {
    const size = char.charCodeAt(0) > 255 ? 1 : .58;
    if (char === "\n") { result.push(current); current = ""; used = 0; continue; }
    if (used + size > width && current) { result.push(current); current = ""; used = 0; }
    current += char; used += size;
  }
  if (current) result.push(current);
  return result;
}
export function createQuotePages(q: QuoteDraft, settings: AppSettings, meta: { customerName?: string; date?: string; number?: string } = {}): QuotePaper[] {
  const t = calculateQuote(q), trade = { ...defaultTradeIn, ...q.tradeIn };
  const itemizedSale = (q.type === "sale" || q.type === "custom") && !!q.saleItems?.length;
  const itemizedRecycling = q.type === "recycling" && !!q.recyclingItems?.length;
  const supplemental: string[] = [];
  const appendText = (label: string, value: string) => { if (value) supplemental.push(`${label}：`, ...wrapQuoteText(value, 25), ""); };
  const shorten = (value: string, label: string, width: number) => {
    if (wrapQuoteText(value, width).length <= 1) return value;
    appendText(label, value);
    return `${wrapQuoteText(value, width - 6)[0]}（见续页）`;
  };
  const displayTitle = shorten(q.title || "珠宝报价", "报价名称", 22);
  const displaySpecs = shorten(itemizedSale ? `共 ${q.saleItems!.length} 款珠宝` : itemizedRecycling ? `共 ${q.recyclingItems!.length} 件回收首饰` : q.specs || (q.type === "recycling" ? q.recyclingName || metalNames[q.material] || q.material : q.material), "规格说明", 32);
  const displayCustomer = shorten(meta.customerName || "未填写客户", "客户姓名", 14);
  const fullNote = q.note || settings.brand.note || "";
  const displayNote = wrapQuoteText(fullNote, 26).length > 2 ? "完整备注见补充说明续页" : fullNote;
  if (displayNote !== fullNote) appendText("备注", fullNote);
  if (q.type === "custom" && q.customDetails) appendText("定制要求", q.customDetails);
  const typeLabels: Record<QuoteType, string> = { sale: "珠宝报价单", custom: "定制报价单", tradein: "以旧换新报价单", repair: "维修报价单", recycling: "回收报价单" };
  const aggregateWeight = t.itemTotals.reduce((sum, item) => sum + Math.round(item.weight * 1000) * item.quantity, 0) / 1000;
  const parameters = itemizedSale
    ? [{ label: "商品款数", value: `${t.itemTotals.length} 款` }, { label: "件数", value: `${t.itemTotals.reduce((sum, item) => sum + item.quantity, 0)} 件` }, { label: "合计金重", value: weight(aggregateWeight) }]
    : itemizedRecycling
      ? [{ label: "回收物品", value: `${t.itemTotals.length} 件` }, { label: "合计重量", value: weight(aggregateWeight) }]
      : q.type === "recycling"
    ? [{ label: "重量", value: weight(q.weight) }, { label: "实际回收单价", value: `${Number(t.recyclingUnitPrice.toFixed(6))} 元/克` }]
    : q.type === "tradein"
      ? [{ label: "新金重", value: weight(q.weight) }, { label: "旧金重", value: weight(trade.oldWeight) }, trade.mode === "gram" ? { label: "抵换金重", value: weight(t.exchangeWeight) } : { label: "旧料材质", value: q.tradeInMaterialName || metalNames[trade.oldMaterial] }]
      : q.type === "repair"
        ? [{ label: "维修项目", value: `${q.repairItems.length} 项` }, ...(q.insured ? [{ label: "确认价值", value: `${money(q.insuredValue)} 元` }, { label: "保价比例", value: `${q.insuranceRate}%` }] : [])]
        : [{ label: "金重", value: weight(q.weight) }, { label: "金价", value: `${money(q.goldPrice)} 元/克` }, { label: "每克工费", value: `${money(q.laborPrice)} 元/克` }];
  const extraLines = itemizedSale ? [] : q.extras.map((item, index) => ({ label: shorten(item.name || "附加费", `附加费${index + 1}名称`, 15), value: `${money(item.amount)} 元` }));
  let source: PaperLine[];
  const ending: PaperLine[] = [];
  if (q.type === "repair") {
    source = q.repairItems.map((item, index) => {
      if (item.note) appendText(`维修项目${index + 1}备注`, item.note);
      return { label: shorten(item.name, `维修项目${index + 1}名称`, 15), value: `${money(domainCalculate({ ...q, repairItems: [item], insured: false }).repair)} 元`, ...(item.mode === "fixed" ? {} : { detail: item.mode === "gram" ? weight(item.quantity) : `${item.quantity} 次` }) };
    });
    ending.push({ label: "维修费用合计", value: `${money(t.base)} 元`, divider: true });
    if (q.insured) ending.push({ label: "保价费", value: `${money(t.insurance)} 元` });
  } else if (q.type === "recycling") {
    source = [{ label: "回收材质", value: q.recyclingName || metalNames[q.material] || q.material }, { label: "回收金额", value: `${money(t.base)} 元`, divider: true }];
  } else {
    source = q.type === "tradein" && trade.mode === "gram"
      ? [{ label: "折旧费", value: `${money(t.depreciation)} 元`, detail: weight(t.exchangeWeight) }, { label: "加工费", value: `${money(t.labor)} 元` }, ...(t.additionalWeight > 0 ? [{ label: "补金费用", value: `${money(t.metal)} 元`, detail: weight(t.additionalWeight) }] : []), ...extraLines]
      : [{ label: "金料费", value: `${money(t.metal)} 元` }, { label: "加工费", value: `${money(t.labor)} 元` }, ...extraLines];
    const adjustment = round(t.base - (t.metal + t.labor + t.extras + (q.type === "tradein" ? t.depreciation : 0)));
    if (adjustment) source.push({ label: "金额调整", value: `${adjustment < 0 ? "− " : ""}${money(Math.abs(adjustment))} 元` });
    ending.push({ label: q.type === "tradein" && trade.mode === "value" ? "新首饰价" : "报价合计", value: `${money(t.base)} 元`, divider: true });
    if (q.discountType !== "none") ending.push({ label: q.discountType === "percent" ? `整单折扣 · ${Number((q.discountValue / 10).toFixed(3))} 折` : "优惠减免", value: `− ${money(t.discount)} 元` });
    if (q.type === "tradein") {
      if (trade.mode === "gram" && trade.excessMode === "return" && t.excessWeight > 0) ending.push({ label: "多余旧金退回", value: weight(t.excessWeight) });
      if (trade.mode === "value" || t.exchangeCredit > 0) ending.push({ label: trade.mode === "value" ? "旧料回收抵扣" : "多余旧金回收抵扣", value: `− ${money(t.exchangeCredit)} 元`, detail: weight(trade.mode === "value" ? trade.oldWeight : t.excessWeight) });
    }
  }
  const products: PaperProduct[] = [];
  const productDetails: { product: PaperProduct; lines: PaperLine[] }[] = [];
  if (itemizedSale) {
    q.saleItems!.forEach((item, index) => {
      const totals = t.itemTotals.find(value => value.id === item.id);
      if (!totals) throw new Error("商品明细未能完成计算，请重新填写报价");
      const fullLines: PaperLine[] = [{ label: "金料费", value: `${money(totals.metal)} 元` }, { label: "加工费", value: `${money(totals.labor)} 元` }, ...item.extras.map((extra, i) => ({ label: shorten(extra.name, `商品${index + 1}附加费${i + 1}名称`, 15), value: `${money(extra.amount * totals.quantity)} 元` }))];
      const adjustment = round(totals.subtotal - totals.metal - totals.labor - totals.extras);
      if (adjustment) fullLines.push({ label: "金额调整", value: `${adjustment < 0 ? "− " : ""}${money(Math.abs(adjustment))} 元` });
      const product: PaperProduct = { id: item.id, title: shorten(item.title, `商品${index + 1}名称`, 17), specs: shorten([item.material, item.specs].filter(Boolean).join(" · "), `商品${index + 1}规格`, 24), image: item.image || "/ring.jpg", parameters: [{ label: "单件重量", value: weight(item.weight) }, { label: "数量", value: `${totals.quantity} 件` }], lines: fullLines.slice(0, 4), total: totals.subtotal, totalLabel: totals.quantity > 1 ? "款式合计" : "单件小计" };
      products.push(product);
      if (fullLines.length > 4) productDetails.push({ product, lines: fullLines.slice(4) });
    });
    source = [];
  } else if (itemizedRecycling) {
    q.recyclingItems!.forEach((item, index) => {
      const totals = t.itemTotals.find(value => value.id === item.id);
      if (!totals) throw new Error("回收明细未能完成计算，请重新填写报价");
      products.push({ id: item.id, title: shorten(item.title, `回收商品${index + 1}名称`, 17), specs: shorten(item.specs || metalNames[item.material] || item.material, `回收商品${index + 1}规格`, 24), image: item.image || "/ring.jpg", parameters: [{ label: "重量", value: weight(item.weight) }, { label: "实际单价", value: `${Number((totals.unitPrice || 0).toFixed(6))} 元/克` }], lines: [{ label: "回收材质", value: metalNames[item.material] || item.material }], total: totals.subtotal, totalLabel: "回收金额" });
    });
    source = [];
  }
  // A snapshot's empty list means no payment section, even when defaults change.
  const methods: PaymentMethod[] = saleKinds.includes(q.type) ? q.paymentMethods ?? [] : [];
  const payments: PaperPayment[] = methods.map(method => {
    const name = shorten(method.name, "收款方式名称", 14);
    const details = wrapQuoteText(method.details || "", 15);
    if (details.length > 2) { appendText(`${method.name}收款信息`, method.details); return { id: method.id, name, detailLines: ["完整收款信息见续页"], image: method.image || "" }; }
    return { id: method.id, name, detailLines: details, image: method.image || "" };
  });
  const signedTotal = t.total;
  const totalLabel = q.type === "tradein" ? signedTotal < 0 ? "应退客户金额" : "客户应补金额" : q.type === "recycling" ? "客户实收金额" : q.type === "repair" ? "维修总价" : "优惠后总价";
  const common: Omit<QuotePaper, "lines" | "page" | "pages"> = { brand: settings.brand, customerName: displayCustomer, date: meta.date || new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" }), number: meta.number || "DRAFT", typeLabel: typeLabels[q.type], title: displayTitle, specs: displaySpecs, image: q.image || "/ring.jpg", parameters, total: Math.abs(signedTotal), totalLabel, note: supplemental.length ? "另有补充说明，请一并查看续页" : displayNote };
  const pages: QuotePaper[] = [];
  const addPage = (value: Partial<QuotePaper> & { lines: PaperLine[] }) => pages.push({ ...common, ...value, page: 0, pages: 0 });
  if (products.length) {
    for (let index = 0; index < products.length; index += 2) addPage({ lines: [], products: products.slice(index, index + 2) });
    for (const detail of productDetails) for (let index = 0; index < detail.lines.length; index += 4) addPage({ title: detail.product.title, specs: detail.product.specs, image: detail.product.image, parameters: detail.product.parameters, lines: detail.lines.slice(index, index + 4) });
    if (!payments.length && ending.length <= 2) pages[products.length % 2 ? Math.floor(products.length / 2) : products.length / 2 - 1].lines = ending;
  }
  if (!payments.length && !products.length) {
    const size = q.type === "repair" ? 3 : 4;
    const chunks: PaperLine[][] = [];
    for (let i = 0; i < source.length; i += size) chunks.push(source.slice(i, i + size));
    if (!chunks.length) chunks.push([]);
    chunks.forEach((chunk, index) => addPage({ lines: index === chunks.length - 1 ? [...chunk, ...ending] : chunk }));
  } else if (payments.length) {
    const remaining = [...source, ...ending];
    while (remaining.length > 2) addPage({ lines: remaining.splice(0, Math.min(4, remaining.length - 2)) });
    addPage({ lines: remaining, payments: payments.slice(0, 2), paymentPlacement: "inline" });
    for (let index = 2; index < payments.length; index += 2) addPage({ lines: [], payments: payments.slice(index, index + 2), paymentPlacement: "page" });
  }
  for (let index = 0; index < supplemental.length; index += 11) addPage({ lines: [], continuation: supplemental.slice(index, index + 11), continuationTitle: "补充说明", note: "" });
  return pages.map((paper, index) => ({ ...paper, page: index + 1, pages: pages.length }));
}

export default function QuoteCard({ paper }: { paper: QuotePaper }) {
  const rowHeight = paper.paymentPlacement === "inline" ? 28 : Math.min(42, 212 / Math.max(1, paper.lines.length));
  return <div className="paper-frame"><article className={`quote-paper qp-paper ${paper.paymentPlacement ? `qp-payment-${paper.paymentPlacement}` : ""} ${paper.products ? "qp-multi" : ""}`} aria-label={`${paper.typeLabel} 第${paper.page}页`}>
    <header className="paper-brand"><div style={{ fontSize: `${Math.min(6.4, 88 / Math.max(1, (paper.brand.english || "XIN JIN YUAN").length * .68))}cqw` }}>{paper.brand.english || "XIN JIN YUAN"}</div><span>{paper.brand.name || "鑫金源"}</span></header>
    <div className="paper-meta"><span>客户：{paper.customerName}</span><span>{paper.date}</span></div>
    {paper.products ? <><section className="qp-product-stack">{paper.products.map((product, index) => <section className="qp-compact-product" key={product.id} style={{ top: `${index * 195 / 3.6}cqw` }}><img src={product.image} alt={product.title} /><div className="qp-compact-heading"><h3>{product.title}</h3><p>{product.specs}</p></div><div className="qp-compact-parameters">{product.parameters.map(parameter => <span key={parameter.label}>{parameter.label}：{parameter.value}</span>)}</div><dl>{product.lines.map((item, i) => <div key={i}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl><div className="qp-item-total"><span>{product.totalLabel}</span><strong>{money(product.total)} 元</strong></div></section>)}</section><div className="qp-multi-summary">{paper.lines.map((item, index) => <div key={index}><span>{item.label}</span><span>{item.value}</span></div>)}</div></> : <><section className="paper-product"><img src={paper.image} alt={paper.title} /><div><p>{paper.typeLabel}</p><h3>{paper.title}</h3><span>{paper.specs}</span></div></section><section className="paper-parameters" style={{ gridTemplateColumns: `repeat(${paper.parameters.length}, minmax(0, 1fr))` }}>{paper.parameters.map(item => <div key={item.label}><span>{item.label}</span><strong>{item.value}</strong></div>)}</section></>}
    {!paper.products && paper.paymentPlacement !== "page" && <section className="paper-details"><h4>{paper.continuation ? paper.continuationTitle || "补充说明" : "费用明细"}</h4>{paper.continuation ? <p className="paper-continuation">{paper.continuation.join("\n")}</p> : <dl>{paper.lines.map((item, index) => <div className={`paper-line ${item.divider ? "divider" : ""}`} key={index} style={{ top: `${(28 + index * rowHeight) / 3.6}cqw` }}><dt>{item.label}{item.detail && <small>{item.detail}</small>}</dt><dd>{item.value}</dd></div>)}</dl>}</section>}
    {!!paper.payments?.length && <section className="qp-payments" aria-label="收款方式"><h4>收款方式</h4><div className="qp-payment-grid">{paper.payments.map(method => <div className="qp-payment-card" key={method.id}><h5>{method.name}</h5><p>{method.detailLines.join("\n")}</p>{method.image && <img src={method.image} alt={`${method.name}收款二维码`} />}</div>)}</div></section>}
    <div className="paper-total"><span>{paper.totalLabel}</span><strong className={money(paper.total).length > 12 ? "long" : ""}>{money(paper.total)}<small>元</small></strong></div>
    <div className="paper-note">{paper.note}</div><footer className="paper-footer"><span>{paper.number}</span><span>{paper.pages > 1 ? `${paper.page} / ${paper.pages}` : paper.brand.contact || "专属报价"}</span></footer>
  </article></div>;
}

"use client";

import { calculateQuote as domainCalculate, defaultTradeIn, type QuoteType, type PriceMode, type Settings, type PaymentMethod } from "@/lib/domain";
import { emptyQuoteTotals, readSavedQuotePresentation, type QuotePresentationInput } from "@/lib/quote-presentation";
import "./quote-paper.css";

export type QuoteKind = QuoteType;
export type FeeMode = PriceMode;
export type QuoteDraft = QuotePresentationInput & { recyclingName?: string; tradeInMaterialName?: string };
export type AppSettings = Settings;
export type PaperLine = { label: string; value: string; detail?: string; divider?: boolean };
export type PaperPayment = { id: string; name: string; detailLines: string[]; image: string };
export type PaperProduct = { id: string; title: string; specs: string; image: string; parameters: { label: string; value: string }[]; lines: PaperLine[]; total: number; totalLabel: string };
export type QuotePaper = {
  language?: "zh-CN" | "en";
  brand: AppSettings["brand"]; customerName: string; date: string; typeLabel: string;
  title: string; specs: string; image: string; parameters: { label: string; value: string }[];
  lines: PaperLine[]; total: number; totalLabel: string; note: string; page: number; pages: number;
  number: string; continuation?: string[]; continuationTitle?: string;
  payments?: PaperPayment[]; paymentPlacement?: "inline" | "page" | "attached"; products?: PaperProduct[];
};
export const money = (value: number) => Number(value || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const weight = (value: number) => `${Math.max(0, value || 0).toFixed(3)} 克`;
const metalNames: Record<string, string> = { gold: "黄金", platinum: "Pt950铂金", silver: "白银", kgold: "K金" };
const saleKinds = ["sale", "custom", "tradein"];

export function quotePaperLayout(paper: QuotePaper) {
  const attached = paper.paymentPlacement === "attached";
  const paymentCount = paper.payments?.length || 0;
  const columns = paymentCount <= 2 ? Math.max(1, paymentCount) : Math.min(4, paymentCount);
  const rows = Math.ceil(paymentCount / columns);
  const qrSize = paper.payments?.some(method => method.image) ? paymentCount <= 2 ? 80 : 60 : 0;
  const cardHeight = paymentCount <= 2 ? 35 + qrSize : 34 + qrSize;
  const paymentHeight = paymentCount ? 18 + rows * cardHeight + Math.max(0, rows - 1) * 8 : 0;
  const paymentTop = 530 - paymentHeight;
  const productHeight = attached ? 112 : 188, productGap = attached ? 6 : 7;
  const productTop = 105;
  const contentBottom = paper.products?.length ? productTop + paper.products.length * (productHeight + productGap) - productGap : attached ? 201 : 290;
  const linesTop = paper.products?.length ? contentBottom + 6 : attached ? 207 : 316;
  let next = linesTop;
  const linePositions = paper.lines.map(line => { const position = next; next += (attached || paper.products ? 16 : Math.min(42, 212 / Math.max(1, paper.lines.length))) + (line.detail && (attached || paper.products) ? 10 : 0); return position; });
  const paymentWidth = (320 - Math.max(0, columns - 1) * 8) / columns;
  return { attached, productTop, productHeight, productGap, contentBottom, linesTop, linePositions, lineBottom: next, paymentTop, paymentHeight, columns, rows, qrSize, cardHeight, paymentWidth, paymentGridTop: paymentTop + 18 };
}

function fitsQuoteContent(paper: QuotePaper) {
  const layout = quotePaperLayout(paper);
  return layout.lineBottom <= (paper.payments?.length ? layout.paymentTop - 8 : 532);
}

export function calculateQuote(q: QuoteDraft) {
  const saved = readSavedQuotePresentation(q);
  if (saved) return { ...saved.totals, base: saved.totals.subtotal, validationMessage: "" };
  try {
    const subtotal = domainCalculate({ ...q, discountType: "none" }).subtotal;
    const saleLike = saleKinds.includes(q.type);
    const invalid = saleLike && q.discountType === "amount" && q.discountValue > subtotal;
    const invalidPercent = saleLike && q.discountType === "percent" && q.discountValue > 100;
    const result = domainCalculate({ ...q, discountValue: invalid ? subtotal : invalidPercent ? 100 : q.discountValue });
    return { ...result, base: result.subtotal, validationMessage: invalid ? "减免金额不能大于报价合计" : invalidPercent ? "实付比例不能超过100%" : "" };
  } catch (error) {
    if (!(error instanceof Error) || (error as Error & { code?: string }).code !== "TRADEIN_GRAM_MATERIAL_MISMATCH") throw error;
    return { ...emptyQuoteTotals(), base: 0, validationMessage: error.message };
  }
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
  const saved = readSavedQuotePresentation(q), t = calculateQuote(q), trade = { ...defaultTradeIn, ...q.tradeIn };
  if (t.validationMessage) throw new Error(t.validationMessage);
  if (saved && q.brand) settings = { ...settings, brand: q.brand };
  const missingDetails = !!saved && (!saved.itemDetailsComplete || !saved.amountsConsistent);
  const itemizedSale = q.type === "sale" && !!q.saleItems?.length && !missingDetails;
  const itemizedTradeIn = q.type === "tradein" && !!q.tradeInItems?.length && !missingDetails;
  const itemizedRecycling = q.type === "recycling" && !!q.recyclingItems?.length && !missingDetails;
  const supplemental: string[] = [];
  const appendText = (label: string, value: string) => { if (value) supplemental.push(`${label}：`, ...wrapQuoteText(value, 25), ""); };
  if (missingDetails) {
    appendText("历史金额明细未保存完整或与整单不一致", "本次仅展示已保存整单金额，不按当前规则补算商品金额。");
    for (const item of q.type === "sale" ? q.saleItems || [] : q.type === "tradein" ? q.tradeInItems || [] : q.recyclingItems || []) appendText("原单商品", `${item.title} · ${item.material} · ${weight(item.weight)}${"quantity" in item ? ` · ${item.quantity} 件` : ""}`);
  }
  const shorten = (value: string, label: string, width: number) => {
    if (wrapQuoteText(value, width).length <= 1) return value;
    appendText(label, value);
    return `${wrapQuoteText(value, width - 6)[0]}（见续页）`;
  };
  const displayTitle = shorten(q.title || "珠宝报价", "报价名称", 22);
  const displaySpecs = shorten(itemizedSale ? `共 ${q.saleItems!.length} 款珠宝` : itemizedTradeIn ? `共 ${q.tradeInItems!.length} 款新珠宝` : itemizedRecycling ? `共 ${q.recyclingItems!.length} 件回收首饰` : q.specs || (q.type === "recycling" ? q.recyclingName || metalNames[q.material] || q.material : q.material), "规格说明", 32);
  const displayCustomer = shorten(meta.customerName || "未填写客户", "客户姓名", 14);
  const fullNote = q.note || settings.brand.note || "";
  const displayNote = wrapQuoteText(fullNote, 26).length > 2 ? "完整备注见补充说明续页" : fullNote;
  if (displayNote !== fullNote) appendText("备注", fullNote);
  if (q.type === "custom" && q.customDetails) appendText("定制要求", q.customDetails);
  const typeLabels: Record<QuoteType, string> = { sale: "珠宝报价单", custom: "定制报价单", tradein: "以旧换新报价单", repair: "维修报价单", recycling: "回收报价单" };
  const aggregateWeight = t.itemTotals.reduce((sum, item) => sum + Math.round(item.weight * 1000) * item.quantity, 0) / 1000;
  const parameters = itemizedSale || itemizedTradeIn
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
  const extraLines = itemizedSale || itemizedTradeIn ? [] : q.extras.map((item, index) => ({ label: shorten(item.name || "附加费", `附加费${index + 1}名称`, 15), value: `${money(item.amount)} 元` }));
  let source: PaperLine[];
  const ending: PaperLine[] = [];
  if (q.type === "repair") {
    source = q.repairItems.map((item, index) => {
      if (item.note) appendText(`维修项目${index + 1}备注`, item.note);
      return { label: shorten(item.name, `维修项目${index + 1}名称`, 15), value: saved ? `原单单价 ${money(item.price)} 元` : `${money(domainCalculate({ ...q, repairItems: [item], insured: false }).repair)} 元`, ...(item.mode === "fixed" ? {} : { detail: item.mode === "gram" ? weight(item.quantity) : `${item.quantity} 次` }) };
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
    if (itemizedTradeIn) ending.push({ label: `旧料 · ${q.tradeInMaterialName || metalNames[trade.oldMaterial]}`, value: weight(trade.oldWeight) });
    ending.push({ label: q.type === "tradein" && trade.mode === "value" ? "新首饰价" : "报价合计", value: `${money(t.base)} 元`, divider: true });
    if (q.discountType !== "none") ending.push({ label: q.discountType === "percent" ? `整单折扣 · ${Number((q.discountValue / 10).toFixed(3))} 折` : "优惠减免", value: `− ${money(t.discount)} 元` });
    if (q.type === "tradein") {
      if (trade.mode === "gram" && trade.excessMode === "return" && t.excessWeight > 0) ending.push({ label: "多余旧金退回", value: weight(t.excessWeight) });
      if (trade.mode === "value" || t.exchangeCredit > 0) ending.push({ label: trade.mode === "value" ? "旧料回收抵扣" : "多余旧金回收抵扣", value: `− ${money(t.exchangeCredit)} 元`, detail: weight(trade.mode === "value" ? trade.oldWeight : t.excessWeight) });
    }
  }
  if (missingDetails) {
    // Unknown historical fields must never appear as calculated zero prices,
    // exchange weights or fees. Keep only the authoritative saved order total.
    parameters.length = 0;
    source = [{ label: "历史金额明细", value: "未保存完整；仅展示整单金额" }];
    ending.length = 0;
  }
  const products: PaperProduct[] = [];
  const productDetails: { product: PaperProduct; lines: PaperLine[] }[] = [];
  if (itemizedSale || itemizedTradeIn) {
    (itemizedTradeIn ? q.tradeInItems! : q.saleItems!).forEach((item, index) => {
      const totals = t.itemTotals.find(value => value.id === item.id);
      if (!totals) throw new Error("商品明细未能完成计算，请重新填写报价");
      const fullLines: PaperLine[] = [...(itemizedTradeIn && trade.mode === "gram" ? [{ label: "折旧费", value: `${money(totals.depreciation || 0)} 元` }, ...(totals.additionalWeight ? [{ label: "补金费用", value: `${money(totals.metal)} 元` }] : [])] : [{ label: "金料费", value: `${money(totals.metal)} 元` }]), { label: "加工费", value: `${money(totals.labor)} 元` }, ...item.extras.map((extra, i) => ({ label: shorten(extra.name, `商品${index + 1}附加费${i + 1}名称`, 15), value: `${money(extra.amount * totals.quantity)} 元` }))];
      const adjustment = round(totals.subtotal - totals.metal - totals.labor - totals.extras - (itemizedTradeIn ? totals.depreciation || 0 : 0));
      if (adjustment) fullLines.push({ label: "金额调整", value: `${adjustment < 0 ? "− " : ""}${money(Math.abs(adjustment))} 元` });
      const product: PaperProduct = { id: item.id, title: shorten(item.title, `商品${index + 1}名称`, 17), specs: shorten([item.material, item.specs].filter(Boolean).join(" · "), `商品${index + 1}规格`, 24), image: item.image || "/ring.jpg", parameters: [{ label: "单件重量", value: weight(item.weight) }, { label: "数量", value: `${totals.quantity} 件` }, ...(itemizedTradeIn && trade.mode === "gram" ? [{ label: "抵换", value: weight(totals.exchangeWeight || 0) }, ...(totals.additionalWeight ? [{ label: "补金", value: weight(totals.additionalWeight) }] : [])] : [])], lines: fullLines.slice(0, 4), total: totals.subtotal, totalLabel: itemizedTradeIn ? "本款换新费用" : totals.quantity > 1 ? "款式合计" : "单件小计" };
      if (q.paymentMethods?.length) product.lines = product.lines.map(line => { if (wrapQuoteText(line.label,7).length <= 1) return line; appendText(`商品${index + 1}费用名称`,line.label); return { ...line,label:`${wrapQuoteText(line.label,5)[0]}…` }; });
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
    const compact = methods.length > 2;
    let name = method.name;
    const maxName = compact ? 7 : 14;
    if (wrapQuoteText(name,maxName).length > 1) { appendText("收款方式名称", name); name = `${wrapQuoteText(name,compact ? 5 : 11)[0]}…`; }
    const details = wrapQuoteText(method.details || "", compact ? 7 : 15);
    if (details.length > 2) { appendText(`${method.name}收款信息`, method.details); return { id: method.id, name, detailLines: [compact ? "详见补充说明" : "完整收款信息见续页"], image: method.image || "" }; }
    return { id: method.id, name, detailLines: details, image: method.image || "" };
  });
  const signedTotal = t.total;
  const totalLabel = q.type === "tradein" ? signedTotal < 0 ? "应退客户金额" : "客户应补金额" : q.type === "recycling" ? "客户实收金额" : q.type === "repair" ? "维修总价" : "优惠后总价";
  const common: Omit<QuotePaper, "lines" | "page" | "pages"> = { brand: settings.brand, customerName: displayCustomer, date: meta.date || new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" }), number: meta.number || "DRAFT", typeLabel: typeLabels[q.type], title: displayTitle, specs: displaySpecs, image: q.image || "/ring.jpg", parameters, total: Math.abs(signedTotal), totalLabel, note: supplemental.length ? "另有补充说明，请一并查看续页" : displayNote };
  const pages: QuotePaper[] = [];
  const addPage = (value: Partial<QuotePaper> & { lines: PaperLine[] }) => pages.push({ ...common, ...value, page: 0, pages: 0 });
  if (products.length) {
    const paymentPart = payments.length ? { payments, paymentPlacement: "attached" as const } : {};
    const two = { ...common, ...paymentPart, lines: ending, products: products.slice(-2), page: 0, pages: 0 };
    const capacity = fitsQuoteContent(two) && payments.length <= 2 ? 2 : 1;
    const lastCount = Math.min(capacity, products.length % 2 || 2);
    const finalStart = products.length - lastCount;
    for (let index = 0; index < finalStart; index += 2) addPage({ lines: [], products: products.slice(index, Math.min(index + 2, finalStart)) });
    const last = { ...common, ...paymentPart, lines: ending, products: products.slice(finalStart), page: 0, pages: 0 };
    if (!fitsQuoteContent(last)) throw new Error("商品费用与收款信息过多，请精简备注或收款方式后重新生成");
    addPage({ ...paymentPart, lines: ending, products: products.slice(finalStart) });
    for (const detail of productDetails) for (let index = 0; index < detail.lines.length; index += 4) addPage({ title: detail.product.title, specs: detail.product.specs, image: detail.product.image, parameters: detail.product.parameters, lines: detail.lines.slice(index, index + 4) });
  } else if (!payments.length) {
    const size = q.type === "repair" ? 3 : 4;
    const chunks: PaperLine[][] = [];
    for (let i = 0; i < source.length; i += size) chunks.push(source.slice(i, i + size));
    if (!chunks.length) chunks.push([]);
    chunks.forEach((chunk, index) => addPage({ lines: index === chunks.length - 1 ? [...chunk, ...ending] : chunk }));
  } else if (payments.length) {
    const remaining = [...source];
    while (!fitsQuoteContent({ ...common, lines: [...remaining, ...ending], payments, paymentPlacement: "attached", page:0, pages:0 }) && remaining.length) addPage({ lines: remaining.splice(0, Math.min(4, remaining.length)) });
    if (!fitsQuoteContent({ ...common, lines: [...remaining, ...ending], payments, paymentPlacement: "attached", page:0, pages:0 })) throw new Error("费用与收款信息无法完整放入报价单，请减少收款方式后重新生成");
    addPage({ lines: [...remaining, ...ending], payments, paymentPlacement: "attached" });
  }
  for (let index = 0; index < supplemental.length; index += 11) addPage({ lines: [], continuation: supplemental.slice(index, index + 11), continuationTitle: "补充说明", note: "" });
  return pages.map((paper, index) => ({ ...paper, page: index + 1, pages: pages.length }));
}

export type QuoteImageFormat = { mode: "phone" } | { mode: "a4" } | { mode: "custom"; width: number; height: number };
export type QuoteLanguage = "zh-CN" | "en";
const englishLabels: Record<string, string> = { "销售报价": "Sales quote", "定制报价": "Custom quote", "以旧换新报价": "Trade-in quote", "回收报价": "Buyback quote", "维修报价": "Repair quote", "金料费": "Metal cost", "加工费": "Labor", "工费": "Labor", "每克工费": "Labor/g", "附加费": "Extras", "附加项目": "Extras", "费用合计": "Subtotal", "商品合计": "Item total", "报价合计": "Subtotal", "优惠减免": "Discount", "折扣优惠": "Discount", "优惠金额": "Discount", "优惠后总价": "Discounted total", "总价": "Total", "报价总额": "Total", "客户补差": "Amount due", "应退客户": "Refund", "客户实收": "Customer receives", "回收金额": "Buyback value", "回收单价": "Buyback/g", "单件小计": "Item subtotal", "本件小计": "Item subtotal", "换新小计": "Trade-in subtotal", "折旧费": "Depreciation", "补金费用": "Added metal", "新金料费": "New metal", "新首饰工费": "New item labor", "旧料折价抵扣": "Old metal credit", "旧金回收抵扣": "Old metal credit", "多余旧金回收抵扣": "Excess metal credit", "保价费": "Insurance", "保价比例": "Insurance rate", "确认价值": "Declared value", "首饰确认价值": "Declared value", "金重": "Metal weight", "重量": "Weight", "单件重量": "Unit weight", "合计重量": "Total weight", "合计数量": "Total quantity", "数量": "Quantity", "件数": "Quantity", "材质": "Material", "维修项目": "Repair services", "维修费用": "Repair costs", "回收物品": "Buyback items", "抵换克重": "Exchange weight", "需补新金": "Added weight", "旧料重量": "Old metal weight", "新首饰重量": "New item weight", "金价": "Metal price", "单价": "Unit price", "原价": "Original price", "微信收款": "WeChat", "支付宝收款": "Alipay", "现金": "Cash", "银行转账": "Bank transfer", "补充说明": "Additional details", "最终报价": "Final quote" };
Object.assign(englishLabels, { "款式合计": "Item subtotal", "本款换新费用": "Trade-in subtotal", "商品款数": "Item styles", "合计金重": "Total metal weight", "实际回收单价": "Buyback/g", "实际单价": "Unit price", "新金重": "New metal weight", "旧金重": "Old metal weight", "抵换金重": "Exchange weight", "旧料材质": "Old metal type", "回收材质": "Metal type", "维修费用合计": "Repair subtotal", "金额调整": "Adjustment", "新首饰价": "New jewelry price", "旧料回收抵扣": "Old metal credit", "多余旧金退回": "Excess old metal returned", "抵换": "Exchange", "补金": "Added metal", "应退客户金额": "Refund", "客户应补金额": "Amount due", "客户实收金额": "Customer receives", "维修总价": "Repair total", "详见补充说明": "See additional details", "完整收款信息见续页": "Full payment details on next page", "客户姓名": "Customer name", "报价名称": "Quote title", "备注说明": "Notes", "收款方式名称": "Payment method name" });
export function quoteLabels(language: QuoteLanguage = "zh-CN") {
  return language === "en" ? { customer: "Customer", payment: "Payment methods", details: "Price details", currency: "CNY", privateQuote: "Private quotation", additional: "Additional details" } : { customer: "客户", payment: "收款方式", details: "费用明细", currency: "元", privateQuote: "专属报价", additional: "补充说明" };
}
export function localizeQuotePaper(paper: QuotePaper, language: QuoteLanguage = "zh-CN"): QuotePaper {
  if (language === "zh-CN") return { ...paper, language };
  const label = (value: string) => englishLabels[value] || value.replace(/^整单折扣 · (.+) 折$/, "Order discount · $1/10").replace(/^旧料 · /, "Old metal · ");
  const units = (value: string) => value.replace(/(\d)\s*元/g, "$1 CNY").replace(/(\d)\s*克/g, "$1 g").replace(/(\d)\s*件/g, "$1 pcs").replace(/(\d)\s*款/g, "$1 styles").replace(/(\d)\s*项/g, "$1 items").replace(/(\d)\s*次/g, "$1 times").replace(/\/克/g, "/g");
  const line = (item: PaperLine): PaperLine => ({ ...item, label: label(item.label), value: units(item.value) });
  const parameters = (items: QuotePaper["parameters"]) => items.map(item => ({ label: label(item.label), value: units(item.value) }));
  return { ...paper, language, typeLabel: label(paper.typeLabel), totalLabel: label(paper.totalLabel), note: paper.note === "另有补充说明，请一并查看续页" ? "Additional details continue on the following pages." : paper.note, continuationTitle: label(paper.continuationTitle || "补充说明"), lines: paper.lines.map(line), parameters: parameters(paper.parameters), products: paper.products?.map(product => ({ ...product, parameters: parameters(product.parameters), lines: product.lines.map(line), totalLabel: label(product.totalLabel) })), payments: paper.payments?.map(method => ({ ...method, name: label(method.name), detailLines: method.detailLines.map(value => label(value).replace(/^收款人[：:]/, "Payee: ").replace(/^账号[：:]/, "Account: ").replace(/^开户行[：:]/, "Bank: ")) })) };
}
export function quoteExportLayout(format: QuoteImageFormat = { mode: "phone" }) {
  const width = format.mode === "phone" ? 1080 : format.mode === "a4" ? 1120 : format.width;
  const height = format.mode === "phone" ? 1920 : format.mode === "a4" ? 1584 : format.height;
  if (format.mode === "custom") {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 720 || width > 1600 || height < 960 || height > 2400) throw new Error("自定义宽度须为720–1600像素，高度须为960–2400像素，均为整数。");
    if (width * height > 2_000_000) throw new Error("自定义尺寸最多200万像素，请减小宽度或高度，保证每页图片小于8MiB。");
  }
  const scale = Math.min(width / 360, height / 640), contentWidth = 360 * scale, contentHeight = 640 * scale;
  if (scale < 1.5) throw new Error("此尺寸的内容过小，请增加宽度或高度。");
  return { width, height, scale, contentWidth, contentHeight, x: (width - contentWidth) / 2, y: (height - contentHeight) / 2, whiteBackground: format.mode === "a4", label: format.mode === "phone" ? "9:16 · 1080×1920" : format.mode === "a4" ? "A4 · 210×297mm" : `自定义 · ${width}×${height}px`, direction: width === height ? "方形" : width > height ? "横向" : "竖向" };
}
export function quotePaperForFormat(paper: QuotePaper, format: QuoteImageFormat = { mode: "phone" }): QuotePaper {
  return format.mode !== "phone" && paper.pages > 1 ? { ...paper, totalLabel: `${paper.totalLabel}${paper.language === "en" ? " (order)" : "（整单）"}` } : paper;
}
export default function QuoteCard({ paper: original, format = { mode: "phone" }, language = "zh-CN", displayWidth }: { paper: QuotePaper; format?: QuoteImageFormat; language?: QuoteLanguage; displayWidth?: number }) {
  const size = quoteExportLayout(format), paper = quotePaperForFormat(localizeQuotePaper(original, language), format), labels = quoteLabels(language);
  const rowHeight = paper.paymentPlacement === "inline" ? 28 : Math.min(42, 212 / Math.max(1, paper.lines.length));
  const layout = quotePaperLayout(paper), cq = (value: number) => `${value / 3.6}cqw`;
  return <div className={`quote-format-frame quote-format-${format.mode}`} data-output-width={size.width} data-output-height={size.height} style={{ aspectRatio: `${size.width}/${size.height}`, ...(displayWidth ? { width: displayWidth, maxWidth: "none" } : {}) }}><div className="quote-format-content" style={{ left: `${size.x / size.width * 100}%`, top: `${size.y / size.height * 100}%`, width: `${size.contentWidth / size.width * 100}%`, height: `${size.contentHeight / size.height * 100}%` }}><div className="paper-frame"><article className={`quote-paper qp-paper ${paper.paymentPlacement ? `qp-payment-${paper.paymentPlacement}` : ""} ${paper.products ? "qp-multi" : ""}`} aria-label={`${paper.typeLabel} 第${paper.page}页`}>
    <header className="paper-brand"><div style={{ fontSize: `${Math.min(6.4, 88 / Math.max(1, (paper.brand.english || "XIN JIN YUAN").length * .68))}cqw` }}>{paper.brand.english || "XIN JIN YUAN"}</div><span>{paper.brand.name || "鑫金源"}</span></header>
    <div className="paper-meta"><span>{labels.customer}：{paper.customerName}</span><span>{paper.date}</span></div>
    {layout.attached ? <>
      {paper.products?.length ? paper.products.map((product,index) => <section className="qp-attached-product" key={product.id} style={{top:cq(layout.productTop+index*(layout.productHeight+layout.productGap)),height:cq(layout.productHeight)}}><img src={product.image} alt={product.title}/><div className="qp-attached-heading"><h3>{product.title}</h3><p>{product.specs}</p></div><div className="qp-attached-parameters">{product.parameters.map(parameter=><span key={parameter.label}>{parameter.label}：{parameter.value}</span>)}</div><dl className="qp-attached-fees">{product.lines.map((line,index)=><div key={index}><dt>{line.label}</dt><dd>{line.value}</dd></div>)}</dl><div className="qp-attached-subtotal"><span>{product.totalLabel}</span><strong>{money(product.total)} {labels.currency}</strong></div></section>) : <section className="qp-attached-single"><img src={paper.image} alt={paper.title}/><div><h3>{paper.title}</h3><p>{paper.specs}</p></div><dl>{paper.parameters.map(parameter=><div key={parameter.label}><dt>{parameter.label}</dt><dd>{parameter.value}</dd></div>)}</dl></section>}
      <dl className="qp-attached-summary">{paper.lines.map((line,index)=><div className={line.divider ? "divider" : ""} key={index} style={{top:cq(layout.linePositions[index])}}><dt>{line.label}{line.detail&&<small>{line.detail}</small>}</dt><dd>{line.value}</dd></div>)}</dl>
      <section className="qp-attached-payments" aria-label="收款方式" style={{top:cq(layout.paymentTop),height:cq(layout.paymentHeight)}}><h4>{labels.payment}</h4><div className="qp-attached-payment-grid" style={{gridTemplateColumns:`repeat(${layout.columns},minmax(0,1fr))`,gap:cq(8)}}>{paper.payments!.map(method=><div className="qp-attached-payment" key={method.id} style={{height:cq(layout.cardHeight)}}><h5 style={{fontSize:cq(paper.payments!.length>2?8.5:10)}}>{method.name}</h5><p>{method.detailLines.join("\n")}</p>{method.image&&<img src={method.image} alt={`${method.name}收款二维码`} style={{width:cq(layout.qrSize),height:cq(layout.qrSize)}}/>}</div>)}</div></section>
    </> : <>
      {paper.products ? <><section className="qp-product-stack">{paper.products.map((product, index) => <section className="qp-compact-product" key={product.id} style={{ top: `${index * 195 / 3.6}cqw` }}><img src={product.image} alt={product.title} /><div className="qp-compact-heading"><h3>{product.title}</h3><p>{product.specs}</p></div><div className="qp-compact-parameters">{product.parameters.map(parameter => <span key={parameter.label}>{parameter.label}：{parameter.value}</span>)}</div><dl>{product.lines.map((item, i) => <div key={i}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl><div className="qp-item-total"><span>{product.totalLabel}</span><strong>{money(product.total)} {labels.currency}</strong></div></section>)}</section><div className="qp-multi-summary" style={{top:cq(layout.linesTop)}}>{paper.lines.map((item, index) => <div key={index}><span>{item.label}{item.detail&&<small>{item.detail}</small>}</span><span>{item.value}</span></div>)}</div></> : <><section className="paper-product"><img src={paper.image} alt={paper.title} /><div><p>{paper.typeLabel}</p><h3>{paper.title}</h3><span>{paper.specs}</span></div></section><section className="paper-parameters" style={{ gridTemplateColumns: `repeat(${paper.parameters.length}, minmax(0, 1fr))` }}>{paper.parameters.map(item => <div key={item.label}><span>{item.label}</span><strong>{item.value}</strong></div>)}</section></>}
      {!paper.products && paper.paymentPlacement !== "page" && <section className="paper-details"><h4>{paper.continuation ? paper.continuationTitle || labels.additional : labels.details}</h4>{paper.continuation ? <p className="paper-continuation">{paper.continuation.join("\n")}</p> : <dl>{paper.lines.map((item, index) => <div className={`paper-line ${item.divider ? "divider" : ""}`} key={index} style={{ top: `${(28 + index * rowHeight) / 3.6}cqw` }}><dt>{item.label}{item.detail && <small>{item.detail}</small>}</dt><dd>{item.value}</dd></div>)}</dl>}</section>}
      {!!paper.payments?.length && <section className="qp-payments" aria-label="收款方式"><h4>{labels.payment}</h4><div className="qp-payment-grid">{paper.payments.map(method => <div className="qp-payment-card" key={method.id}><h5>{method.name}</h5><p>{method.detailLines.join("\n")}</p>{method.image && <img src={method.image} alt={`${method.name}收款二维码`} />}</div>)}</div></section>}
    </>}
    <div className="paper-total"><span>{paper.totalLabel}</span><strong className={money(paper.total).length > 12 ? "long" : ""}>{money(paper.total)}<small>{labels.currency}</small></strong></div>
    <div className="paper-note">{paper.note}</div><footer className="paper-footer"><span>{paper.number}</span><span>{paper.pages > 1 ? `${paper.page} / ${paper.pages}` : paper.brand.contact || labels.privateQuote}</span></footer>
  </article></div></div></div>;
}

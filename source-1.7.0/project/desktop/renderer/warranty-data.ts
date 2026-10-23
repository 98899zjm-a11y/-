import { calculateQuote, defaultTradeIn } from "../../lib/domain";
import { parseQuotePresentationInput, readSavedQuotePresentation, type QuotePresentationInput } from "../../lib/quote-presentation";
export { WARRANTY_LAYOUT, WARRANTY_LAYOUT_IDS, WARRANTY_FONT_IDS, warrantyTextValue, twipsPerMm, WARRANTY_AFTERSALES_SHIFT_MM, normalizeWarrantyLayoutOffsets, normalizeWarrantyFontSizes, effectiveWarrantyFontSize } from "./warranty-layout";
export type { WarrantyLayoutOffsets, WarrantyFontSizes } from "./warranty-layout";

export type WarrantyData = { phone: string; date: string; goodsNumber: string; productName: string; weight: string; standard: string; quantity: string; amount: string; total: string; afterSalesWechat: string; tradeInNote?: string };
export type WarrantyDefaults = Pick<WarrantyData, "phone" | "afterSalesWechat"> & { standard?: string };
export type WarrantyPreferences = Pick<WarrantyData, "phone" | "afterSalesWechat">;
export type WarrantySheet = { id: string; data: WarrantyData; amountSource?: "saved" | "derived-v1" | "calculated-draft" };
export const warrantyProductNames = ["铂金素链", "铂金套链", "铂金手链", "铂金耳饰", "铂金戒指"] as const;
export const warrantyFields: { key: Exclude<keyof WarrantyData, "tradeInNote">; label: string; maximum: number; readonly?: boolean }[] = [
  { key: "phone", label: "电话", maximum: 50 }, { key: "date", label: "日期", maximum: 20, readonly: true },
  { key: "goodsNumber", label: "货品编号", maximum: 60 }, { key: "productName", label: "品名", maximum: 100 },
  { key: "weight", label: "重量", maximum: 30, readonly: true }, { key: "standard", label: "执行标准（报价时每克金价）", maximum: 100, readonly: true },
  { key: "quantity", label: "件数", maximum: 20, readonly: true }, { key: "amount", label: "金额", maximum: 30, readonly: true },
  { key: "total", label: "合计", maximum: 30, readonly: true }, { key: "afterSalesWechat", label: "售后微信", maximum: 50 },
];
const cents = (value: number) => BigInt(Math.round(value * 100));
const money = (value: bigint) => (Number(value) / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const mass = (value: number) => `${value.toFixed(3)} 克`;

// Allocate the order discount in integer cents. For trade-ins this allocates
// payable new-item charges, before the order's old-metal credit; never balance.
export function allocatePayableCents(subtotals: number[], paid: number): bigint[] {
  const zero = BigInt(0), rows = subtotals.map(cents), total = rows.reduce((sum, value) => sum + value, zero), payable = cents(paid);
  if (payable < zero || payable > total || rows.some(value => value < zero)) throw new Error("质保单金额不在有效范围内");
  if (!total) return rows.map(() => zero);
  const amounts = rows.map(value => value * payable / total);
  const order = rows.map((value, index) => ({ index, remainder: value * payable % total })).sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1);
  const remainder = Number(payable - amounts.reduce((sum, value) => sum + value, zero));
  for (let index = 0; index < remainder; index++) amounts[order[index].index] += BigInt(1);
  return amounts;
}
export function createWarrantySheets(input: QuotePresentationInput & { tradeInMaterialName?: string }, defaults: WarrantyDefaults, meta: { date?: string } = {}): WarrantySheet[] {
  // Certificates do not use photographs; private references expanded for A4
  // must not affect this text-only mapping or its input-size validation.
  const source = { ...input, image: "", images: [], paymentMethods: [], customConfirmations: [], customerId: input.customerId || "warranty-preview", saleItems: input.saleItems?.map(item => ({ ...item, image: "" })), tradeInItems: input.tradeInItems?.map(item => ({ ...item, image: "" })), recyclingItems: input.recyclingItems?.map(item => ({ ...item, image: "" })) };
  const quote = parseQuotePresentationInput(source);
  if (!["sale", "custom", "tradein"].includes(quote.type)) throw new Error("此质保模板用于销售、定制和以旧换新首饰");
  const saved = readSavedQuotePresentation(quote), totals = saved?.totals || calculateQuote(quote);
  if (saved && (!saved.itemDetailsComplete || !saved.amountsConsistent)) throw new Error("历史报价保存的商品金额明细缺失或与整单不一致，无法确定质保单金额，请核对原始单据");
  const items = quote.type === "sale" && quote.saleItems?.length ? quote.saleItems : quote.type === "tradein" && quote.tradeInItems?.length ? quote.tradeInItems : [{ id: "single", title: quote.title, material: quote.material, specs: quote.specs, image: "", weight: quote.weight, goldPrice: quote.goldPrice, laborPrice: quote.laborPrice, extras: quote.extras, quantity: 1 }];
  const amounts = totals.itemTotals.length ? items.map(item => { const row = totals.itemTotals.find(total => total.id === item.id); if (!row) throw new Error("报价商品金额明细不完整"); return row.subtotal; }) : [totals.subtotal];
  const payable = allocatePayableCents(amounts, Number(cents(totals.subtotal) - cents(totals.discount)) / 100);
  const amountSource = !saved ? "calculated-draft" : items.length > 1 && totals.discount > 0 ? "derived-v1" : "saved";
  let tradeInNote: string | undefined;
  if (quote.type === "tradein") {
    const trade = { ...defaultTradeIn, ...quote.tradeIn };
    const metal = input.tradeInMaterialName?.trim() || { gold: "黄金", platinum: "Pt950铂金", silver: "白银", kgold: "K金" }[trade.oldMaterial];
    tradeInNote = `整单换新信息（各证重复列示，请勿叠加）：旧料 ${metal} ${mass(trade.oldWeight)}；${trade.mode === "gram" ? `抵换 ${mass(totals.exchangeWeight)}；` : "整件折价换新；"}旧金折价抵扣 ${money(cents(totals.exchangeCredit))} 元；${totals.balance < 0 ? "应退客户" : "客户补差"} ${money(cents(Math.abs(totals.balance)))} 元。\n本证金额为本款优惠后${trade.mode === "gram" ? "换新计价（含本款折旧、工费及补金等）" : "新首饰计价"}，尚未扣除整单旧金抵扣。`;
  }
  return items.map((item, index) => {
    const weight = mass(Math.round(item.weight * 1000) * item.quantity / 1000);
    return { id: item.id, amountSource, data: { phone: defaults.phone, afterSalesWechat: defaults.afterSalesWechat, date: meta.date || new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" }), goodsNumber: "", productName: item.title, weight, standard: `${money(cents(item.goldPrice))} 元/克`, quantity: String(item.quantity), amount: money(payable[index]), total: money(payable[index]), ...(tradeInNote ? { tradeInNote } : {}) } };
  });
}
export function validateWarrantyData(data: WarrantyData): void {
  for (const field of warrantyFields) if (typeof data[field.key] !== "string" || data[field.key].length > field.maximum || /[\x00-\x1f]/.test(data[field.key])) throw new Error(`${field.label}内容过长或格式无效`);
  for (const key of ["productName", "date", "goodsNumber", "weight", "standard", "quantity", "amount", "total"] as const) if (!data[key].trim()) throw new Error(`请填写${warrantyFields.find(field => field.key === key)!.label}`);
  const unitGoldPrice = data.standard.trim().replace(/\s*元\/克$/, "").replace(/,/g, "");
  if (!/\s元\/克$/.test(data.standard) || !/^\d+(?:\.\d{1,2})?$/.test(unitGoldPrice) || !Number.isFinite(Number(unitGoldPrice)) || Number(unitGoldPrice) > 1_000_000) throw new Error("执行标准栏须显示报价时的每克金价（元/克），不能填写克重或其它标准");
  if (data.tradeInNote !== undefined && (typeof data.tradeInNote !== "string" || data.tradeInNote.length > 700 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(data.tradeInNote))) throw new Error("旧金信息内容无效");
  if (!/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(data.date)) throw new Error("日期请使用年月日格式，如2026-10-10");
  const [year, month, day] = data.date.split(/[-/.]/).map(Number), actual = new Date(Date.UTC(year, month - 1, day));
  if (year < 1900 || actual.getUTCFullYear() !== year || actual.getUTCMonth() !== month - 1 || actual.getUTCDate() !== day) throw new Error("请填写有效的年月日");
  const metalWeight = data.weight.trim().replace(/\s*(?:克|g)$/i, "");
  if (!/^\d+(?:\.\d{1,3})?$/.test(metalWeight) || Number(metalWeight) <= 0 || Number(metalWeight) > 100_000_000) throw new Error("重量须为大于0的克重，最多三位小数");
  if (!/^\d+(?:\.\d{1,2})?$/.test(data.amount.replace(/,/g, "")) || !/^\d+(?:\.\d{1,2})?$/.test(data.total.replace(/,/g, ""))) throw new Error("金额和合计须为非负金额，最多两位小数");
  if ([data.amount, data.total].some(value => Number(value.replace(/,/g, "")) > 1_000_000_000)) throw new Error("金额超出当前支持范围");
  if (!/^\d+$/.test(data.quantity) || Number(data.quantity) < 1 || Number(data.quantity) > 999) throw new Error("件数须为1至999的整数");
}

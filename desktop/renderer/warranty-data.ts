import { calculateQuote, quoteInputSchema, type QuoteInput } from "../../lib/domain";

export type WarrantyData = { phone: string; date: string; goodsNumber: string; productName: string; weight: string; standard: string; quantity: string; amount: string; total: string; afterSalesWechat: string };
export type WarrantyDefaults = Pick<WarrantyData, "phone" | "standard" | "afterSalesWechat">;
export type WarrantySheet = { id: string; data: WarrantyData };
export const warrantyFields: { key: keyof WarrantyData; label: string; maximum: number }[] = [
  { key: "phone", label: "电话", maximum: 50 }, { key: "date", label: "日期", maximum: 20 },
  { key: "goodsNumber", label: "货品编号", maximum: 60 }, { key: "productName", label: "品名", maximum: 100 },
  { key: "weight", label: "重量", maximum: 30 }, { key: "standard", label: "执行标准", maximum: 100 },
  { key: "quantity", label: "件数", maximum: 20 }, { key: "amount", label: "金额", maximum: 30 },
  { key: "total", label: "合计", maximum: 30 }, { key: "afterSalesWechat", label: "售后微信", maximum: 50 },
];
const cents = (value: number) => BigInt(Math.round(value * 100));
const money = (value: bigint) => (Number(value) / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Allocate order discounts in integer cents, using largest remainders. Totals
// printed on separate product certificates must exactly match the order paid.
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
export function createWarrantySheets(input: QuoteInput, defaults: WarrantyDefaults, meta: { date?: string } = {}): WarrantySheet[] {
  const quote = quoteInputSchema.parse({ ...input, customerId: input.customerId || "warranty-preview" });
  if (!["sale", "custom"].includes(quote.type)) throw new Error("此质保模板用于销售和定制首饰");
  const totals = calculateQuote(quote);
  const items = quote.type === "sale" && quote.saleItems.length ? quote.saleItems : [{ id: "single", title: quote.title, material: quote.material, specs: quote.specs, image: quote.image, weight: quote.weight, goldPrice: quote.goldPrice, laborPrice: quote.laborPrice, extras: quote.extras, quantity: 1 }];
  const payable = allocatePayableCents(totals.itemTotals.length ? totals.itemTotals.map(item => item.subtotal) : [totals.subtotal], totals.total);
  return items.map((item, index) => ({ id: item.id, data: { ...defaults, date: meta.date || new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" }), goodsNumber: "", productName: item.title, weight: `${(Math.round(item.weight * 1000) * item.quantity / 1000).toFixed(3)} 克`, quantity: String(item.quantity), amount: money(payable[index]), total: money(payable[index]) } }));
}
export function validateWarrantyData(data: WarrantyData): void {
  for (const field of warrantyFields) if (typeof data[field.key] !== "string" || data[field.key].length > field.maximum || /[\x00-\x1f]/.test(data[field.key])) throw new Error(`${field.label}内容过长或格式无效`);
  for (const key of ["productName", "date", "goodsNumber", "weight", "standard", "quantity", "amount", "total"] as const) if (!data[key].trim()) throw new Error(`请填写${warrantyFields.find(field => field.key === key)!.label}`);
  if (!/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(data.date)) throw new Error("日期请使用年月日格式，如2026-10-10");
  const [year, month, day] = data.date.split(/[-/.]/).map(Number), actual = new Date(Date.UTC(year, month - 1, day));
  if (year < 1900 || actual.getUTCFullYear() !== year || actual.getUTCMonth() !== month - 1 || actual.getUTCDate() !== day) throw new Error("请填写有效的年月日");
  const metalWeight = data.weight.trim().replace(/\s*(?:克|g)$/i, "");
  if (!/^\d+(?:\.\d{1,3})?$/.test(metalWeight) || Number(metalWeight) <= 0 || Number(metalWeight) > 100_000_000) throw new Error("重量须为大于0的克重，最多三位小数");
  if (!/^\d+(?:\.\d{1,2})?$/.test(data.amount.replace(/,/g, "")) || !/^\d+(?:\.\d{1,2})?$/.test(data.total.replace(/,/g, ""))) throw new Error("金额和合计须为非负金额，最多两位小数");
  if ([data.amount, data.total].some(value => Number(value.replace(/,/g, "")) > 1_000_000_000)) throw new Error("金额超出当前支持范围");
  if (!/^\d+$/.test(data.quantity) || Number(data.quantity) < 1 || Number(data.quantity) > 999) throw new Error("件数须为1至999的整数");
}

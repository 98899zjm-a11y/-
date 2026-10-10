import { z } from "zod";

export const quoteTypes = ["sale", "recycling", "repair"] as const;
export type QuoteType = (typeof quoteTypes)[number];
export type Role = "admin" | "employee";
export type PriceMode = "fixed" | "count" | "gram";
export type DiscountType = "none" | "percent" | "amount";
export type RecyclingMetal = "gold" | "platinum" | "silver" | "kgold";

export type StaffUser = {
  id: string; userId: string | null; email: string; name: string;
  role: Role; active: boolean; createdAt: string; updatedAt: string;
};
export type Customer = {
  id: string; name: string; phone: string; notes: string; ownerId: string;
  createdAt: string; updatedAt: string;
};
export type RepairCategory = { id: string; name: string; mode: PriceMode; price: number };
export type Settings = {
  brand: { name: string; english: string; contact: string; note: string };
  sale: { goldPrice: number; laborPrice: number };
  recycling: { id: RecyclingMetal; name: string; price: number; coefficient: number }[];
  repair: { categories: RepairCategory[]; insuranceRate: number };
};
export type Style = {
  id: string; name: string; material: string; specs: string; image: string;
  weight: number; extras: Extra[]; active: boolean; createdAt: string; updatedAt: string;
};
export type Extra = { id: string; name: string; amount: number };
export type RepairItem = {
  id: string; categoryId: string; name: string; mode: PriceMode;
  quantity: number; price: number; note: string;
};
export type QuoteInput = {
  type: QuoteType; customerId: string; title: string; material: string; specs: string;
  image: string; images: string[]; weight: number; goldPrice: number; laborPrice: number;
  extras: Extra[]; discountType: DiscountType; discountValue: number;
  recyclingCoefficient: number; repairItems: RepairItem[];
  insured: boolean; insuredValue: number; insuranceRate: number; note: string;
  baseQuoteId?: string;
};
export type QuoteTotals = {
  metal: number; labor: number; extras: number; repair: number;
  subtotal: number; discount: number; insurance: number;
  recyclingUnitPrice: number; total: number;
};
export type QuoteSnapshot = QuoteInput & {
  customer: { id: string; name: string; phone: string };
  brand: Settings["brand"];
  issuedBy: { id: string; name: string }; calculation: QuoteTotals;
  recyclingName?: string;
};
export type QuoteRecord = {
  id: string; number: string; type: QuoteType; customerId: string;
  customerName: string; ownerId: string; title: string;
  snapshot: QuoteSnapshot; totals: QuoteTotals; total: number;
  data: QuoteSnapshot; images: string[];
  rootId: string; baseQuoteId: string | null; version: number; createdAt: string;
};
export type AuditLog = {
  id: string; entityType: string; entityId: string; action: string;
  actorId: string; actorName: string; oldValue: unknown; newValue: unknown; createdAt: string;
};
export type Bootstrap = {
  user: StaffUser; settings: Settings; styles: Style[];
  customers: Customer[]; quotes: QuoteRecord[]; users: StaffUser[];
};

export const defaultSettings: Settings = {
  brand: { name: "鑫金源", english: "XIN JIN YUAN", contact: "", note: "" },
  sale: { goldPrice: 450, laborPrice: 80 },
  recycling: [
    { id: "gold", name: "黄金", price: 450, coefficient: 0.99 },
    { id: "platinum", name: "Pt950铂金", price: 450, coefficient: 0.94 },
    { id: "silver", name: "白银", price: 450, coefficient: 1 },
    { id: "kgold", name: "K金", price: 450, coefficient: 1 },
  ],
  repair: {
    insuranceRate: 6,
    categories: [
      { id: "ring-size", name: "指圈调整", mode: "fixed", price: 120 },
      { id: "add-metal", name: "加金操作", mode: "gram", price: 560 },
      { id: "setting", name: "镶石操作", mode: "count", price: 80 },
      { id: "welding", name: "焊接", mode: "count", price: 80 },
      { id: "sandblast", name: "喷砂、拉沙", mode: "fixed", price: 100 },
      { id: "length", name: "手镯、项链改长短", mode: "fixed", price: 150 },
      { id: "engraving", name: "激光刻字", mode: "fixed", price: 100 },
      { id: "clasp", name: "换弹簧扣、鱼钩扣", mode: "fixed", price: 90 },
      { id: "refinish", name: "翻新", mode: "fixed", price: 120 },
      { id: "other", name: "其它首饰维修", mode: "fixed", price: 80 },
    ],
  },
};

const precision = (digits: number) => (value: number) => Math.abs(value * 10 ** digits - Math.round(value * 10 ** digits)) < 0.000001;
const money = z.number().finite().min(0).max(1_000_000).refine(precision(2), "金额最多保留两位小数");
const quantity = z.number().finite().min(0).max(100_000).refine(precision(3), "重量最多保留三位小数");
const coefficient = z.number().finite().min(0).max(10).refine(precision(4), "系数最多保留四位小数");
const shortText = z.string().trim().max(120);
const identifier = z.string().min(1).max(100);
export const imageSchema = z.string().max(1_500_000).refine(
  (value) => value === "" || /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value) || /^\/api\/images\/[a-f0-9-]{36}$/.test(value),
  "图片必须为PNG、JPEG、WebP或已上传的图片",
);
export const extraSchema = z.object({ id: identifier, name: shortText.min(1), amount: money });
export const repairItemSchema = z.object({
  id: identifier, categoryId: identifier, name: shortText.min(1),
  mode: z.enum(["fixed", "count", "gram"]), quantity, price: money,
  note: z.string().trim().max(500).default(""),
}).superRefine((item, ctx) => {
  if (item.mode !== "fixed" && item.quantity <= 0) ctx.addIssue({ code: "custom", path: ["quantity"], message: "维修数量或重量必须大于0" });
  if (item.mode === "count" && !Number.isInteger(item.quantity)) ctx.addIssue({ code: "custom", path: ["quantity"], message: "按次收费的数量须为整数" });
});
export const quoteInputSchema = z.object({
  type: z.enum(quoteTypes), customerId: identifier, title: shortText.min(1),
  material: shortText.default(""), specs: z.string().trim().max(800).default(""),
  image: imageSchema.default(""), images: z.array(imageSchema).max(3).default([]),
  weight: quantity.default(0), goldPrice: money.default(0), laborPrice: money.default(0),
  extras: z.array(extraSchema).max(30).default([]),
  discountType: z.enum(["none", "percent", "amount"]).default("none"),
  discountValue: money.default(0), recyclingCoefficient: coefficient.default(1),
  repairItems: z.array(repairItemSchema).max(30).default([]),
  insured: z.boolean().default(false), insuredValue: money.default(0),
  insuranceRate: z.number().finite().min(0).max(100).refine(precision(2), "保价比例最多保留两位小数").default(6),
  note: z.string().trim().max(2000).default(""), baseQuoteId: identifier.optional(),
}).superRefine((quote, ctx) => {
  if (new Set(quote.extras.map(item => item.id)).size !== quote.extras.length) ctx.addIssue({ code: "custom", path: ["extras"], message: "附加费编号不得重复" });
  if (new Set(quote.repairItems.map(item => item.id)).size !== quote.repairItems.length) ctx.addIssue({ code: "custom", path: ["repairItems"], message: "维修明细编号不得重复" });
  if (quote.type !== "repair" && quote.weight <= 0) ctx.addIssue({ code: "custom", path: ["weight"], message: "重量必须大于0" });
  if (quote.type === "sale" && quote.discountType === "percent" && quote.discountValue > 100) ctx.addIssue({ code: "custom", path: ["discountValue"], message: "实付比例必须为0至100，90表示九折" });
  const boundedMoney = (value: number) => Number.isFinite(value) && value >= 0 && value <= 1_000_000;
  if (quote.type === "sale" && quote.discountType === "amount" && Number.isFinite(quote.weight) && quote.weight >= 0 && quote.weight <= 100_000 && [quote.goldPrice, quote.laborPrice, quote.discountValue, ...quote.extras.map(item => item.amount)].every(boundedMoney) && scaled(quote.discountValue, 100) > saleSubtotalCents(quote)) ctx.addIssue({ code: "custom", path: ["discountValue"], message: "减免金额不得超过报价合计" });
  if (quote.type === "recycling" && !["gold", "platinum", "silver", "kgold"].includes(quote.material)) ctx.addIssue({ code: "custom", path: ["material"], message: "回收材质仅限黄金、Pt950铂金、白银、K金" });
  if (quote.type === "repair" && quote.repairItems.length === 0) ctx.addIssue({ code: "custom", path: ["repairItems"], message: "至少选择一个维修项目" });
  if (quote.type === "repair" && quote.insured && quote.insuredValue <= 0) ctx.addIssue({ code: "custom", path: ["insuredValue"], message: "请选择客户确认的首饰价值" });
  if (quote.image.length + quote.images.reduce((sum, image) => sum + image.length, 0) > 2_500_000) ctx.addIssue({ code: "custom", path: ["images"], message: "报价图片总大小超限，请压缩图片" });
});
export const customerInputSchema = z.object({
  name: z.string().trim().min(1).max(80), phone: z.string().trim().max(50).default(""),
  notes: z.string().trim().max(2000).default(""),
});
export const styleInputSchema = z.object({
  name: shortText.min(1), material: shortText.default(""), specs: z.string().trim().max(800).default(""),
  image: imageSchema.default(""), weight: quantity.default(0),
  extras: z.array(extraSchema).max(30).default([]), active: z.boolean().default(true),
});
export const settingsSchema = z.object({
  brand: z.object({ name: shortText.min(1), english: shortText, contact: shortText, note: z.string().trim().max(2000) }),
  sale: z.object({ goldPrice: money, laborPrice: money }),
  recycling: z.array(z.object({ id: z.enum(["gold", "platinum", "silver", "kgold"]), name: shortText.min(1), price: money, coefficient })).length(4),
  repair: z.object({ categories: z.array(z.object({ id: identifier, name: shortText.min(1), mode: z.enum(["fixed", "count", "gram"]), price: money })).min(1).max(50), insuranceRate: z.number().finite().min(0).max(100).refine(precision(2), "保价比例最多保留两位小数") }),
}).superRefine((value, ctx) => {
  if (new Set(value.recycling.map(i => i.id)).size !== 4) ctx.addIssue({ code: "custom", path: ["recycling"], message: "四种回收材质不得重复" });
  if (new Set(value.repair.categories.map(i => i.id)).size !== value.repair.categories.length) ctx.addIssue({ code: "custom", path: ["repair", "categories"], message: "维修项目编号不得重复" });
});
export const inviteSchema = z.object({ email: z.string().trim().email().max(254).transform(value => value.toLowerCase()), name: z.string().trim().max(80).default(""), role: z.enum(["admin", "employee"]).default("employee") });
export const userPatchSchema = z.object({ id: identifier, name: z.string().trim().max(80).optional(), role: z.enum(["admin", "employee"]).optional(), active: z.boolean().optional() });

export function roundMoney(value: number): number { return Math.round((value + Number.EPSILON) * 100) / 100; }
const scaled = (value: number, factor: number): bigint => BigInt(Math.round(value * factor));
const roundedDivide = (numerator: bigint, denominator: bigint): bigint => (numerator + denominator / BigInt(2)) / denominator;
const fromCents = (value: bigint): number => Number(value) / 100;
function saleSubtotalCents(input: Pick<QuoteInput, "weight" | "goldPrice" | "laborPrice" | "extras">): bigint {
  const metalAndLabor = roundedDivide(scaled(input.weight, 1000) * (scaled(input.goldPrice, 100) + scaled(input.laborPrice, 100)), BigInt(1000));
  return metalAndLabor + input.extras.reduce((sum, item) => sum + scaled(item.amount, 100), BigInt(0));
}
export function calculateQuote(input: QuoteInput): QuoteTotals {
  const result: QuoteTotals = { metal: 0, labor: 0, extras: 0, repair: 0, subtotal: 0, discount: 0, insurance: 0, recyclingUnitPrice: 0, total: 0 };
  if (input.type === "sale") {
    const weight = scaled(input.weight, 1000), subtotal = saleSubtotalCents(input), deduction = scaled(input.discountValue, 100);
    result.metal = fromCents(roundedDivide(weight * scaled(input.goldPrice, 100), BigInt(1000)));
    result.labor = fromCents(roundedDivide(weight * scaled(input.laborPrice, 100), BigInt(1000)));
    result.extras = fromCents(input.extras.reduce((sum, extra) => sum + scaled(extra.amount, 100), BigInt(0)));
    result.subtotal = fromCents(subtotal);
    if (input.discountType === "amount" && deduction > subtotal) throw new RangeError("减免金额不得超过报价合计");
    const payable = input.discountType === "percent" ? roundedDivide(subtotal * deduction, BigInt(10000)) : subtotal - (input.discountType === "amount" ? deduction : BigInt(0));
    result.total = fromCents(payable);
    result.discount = fromCents(subtotal - payable);
  } else if (input.type === "recycling") {
    const unitNumerator = scaled(input.goldPrice, 100) * scaled(input.recyclingCoefficient, 10000);
    result.recyclingUnitPrice = Number(unitNumerator) / 1_000_000;
    result.subtotal = fromCents(roundedDivide(scaled(input.weight, 1000) * unitNumerator, BigInt(10_000_000)));
    result.total = result.subtotal;
  } else {
    const repair = input.repairItems.reduce((sum, item) => sum + (item.mode === "fixed" ? scaled(item.price, 100) : roundedDivide(scaled(item.quantity, 1000) * scaled(item.price, 100), BigInt(1000))), BigInt(0));
    result.repair = fromCents(repair);
    result.subtotal = result.repair;
    const insurance = input.insured ? roundedDivide(scaled(input.insuredValue, 100) * scaled(input.insuranceRate, 100), BigInt(10000)) : BigInt(0);
    result.insurance = fromCents(insurance);
    result.total = fromCents(repair + insurance);
  }
  return result;
}
export function canAccessOwned(user: Pick<StaffUser, "id" | "role" | "active">, ownerId: string): boolean { return user.active && (user.role === "admin" || user.id === ownerId); }
export function canManage(user: Pick<StaffUser, "role" | "active">): boolean { return user.active && user.role === "admin"; }

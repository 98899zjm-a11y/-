import { z } from "zod";

export const quoteTypes = ["sale", "custom", "tradein", "recycling", "repair"] as const;
export type QuoteType = (typeof quoteTypes)[number];
export type Role = "admin" | "employee";
export type PriceMode = "fixed" | "count" | "gram";
export type DiscountType = "none" | "percent" | "amount";
export type RecyclingMetal = "gold" | "platinum" | "silver" | "kgold";
export const tradeInGramMaterialMessage = "克换克须使用相同材质及成色；不同材质请选择折价抵扣";
export class TradeInGramMaterialError extends RangeError {
  readonly code = "TRADEIN_GRAM_MATERIAL_MISMATCH";
  constructor() { super(tradeInGramMaterialMessage); this.name = "TradeInGramMaterialError"; }
}
export class QuoteAmountPrecisionError extends RangeError {
  readonly code = "QUOTE_AMOUNT_PRECISION_UNSAFE";
  constructor() { super("报价金额超出精确计算范围，请减少数量或拆分报价"); this.name = "QuoteAmountPrecisionError"; }
}
export type PaymentMethod = { id: string; name: string; details: string; image: string };
export type TradeInParameters = {
  mode: "gram" | "value"; oldMaterial: RecyclingMetal; oldWeight: number;
  depreciationPrice: number; excessMode: "return" | "recycle";
  excessGoldPrice: number; excessCoefficient: number;
};
export type MediaAsset = { id: string; name: string; category: string; url: string; ownerId: string; ownerName: string; createdAt: string; active: boolean };
export type SaleItem = { id: string; title: string; material: string; specs: string; image: string; weight: number; goldPrice: number; laborPrice: number; extras: Extra[]; quantity: number };
export type RecyclingItem = { id: string; title: string; material: RecyclingMetal; specs: string; image: string; weight: number; goldPrice: number; recyclingCoefficient: number };
export type QuoteItemTotal = { id: string; metal: number; labor: number; extras: number; subtotal: number; total: number; unitPrice?: number; weight: number; quantity: number; depreciation?: number; exchangeWeight?: number; additionalWeight?: number };
export type CustomConfirmation = { id: string; name: string; image: string; createdAt?: string };

export type StaffUser = {
  id: string; userId: string | null; email: string; name: string;
  role: Role; active: boolean; createdAt: string; updatedAt: string;
};
export type Customer = {
  id: string; name: string; phone: string; notes: string; ownerId: string;
  createdAt: string; updatedAt: string;
  revision?: number; access?: { canEdit: boolean; canManage: boolean; relation: "admin" | "owner" | "collaborator" };
};
export type CustomerRecordCounts = { quoteVersionCount: number; confirmedRecordCount: number };
export type CustomerSearchPage = {
  customers: Customer[]; total: number; page: number; pageSize: number;
  // Older hosts may omit statistics; clients must display them as unavailable.
  counts?: Record<string, CustomerRecordCounts>;
};
export type RepairCategory = { id: string; name: string; mode: PriceMode; price: number };
export type Settings = {
  brand: { name: string; english: string; contact: string; note: string };
  sale: { goldPrice: number; laborPrice: number };
  recycling: { id: RecyclingMetal; name: string; price: number; coefficient: number }[];
  repair: { categories: RepairCategory[]; insuranceRate: number };
  tradeIn: { depreciationPrice: number };
  paymentMethods: PaymentMethod[];
  home: { headline: string; introduction: string; announcements: string; notices: string; workflow: string; image: string };
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
export type RepairItemTotal = { id: string; subtotal: number };
export type QuoteInput = {
  type: QuoteType; customerId: string; title: string; material: string; specs: string;
  image: string; images: string[]; weight: number; goldPrice: number; laborPrice: number;
  extras: Extra[]; discountType: DiscountType; discountValue: number;
  recyclingCoefficient: number; repairItems: RepairItem[];
  insured: boolean; insuredValue: number; insuranceRate: number; note: string;
  paymentMethods?: PaymentMethod[]; customDetails?: string; tradeIn?: TradeInParameters;
  saleItems?: SaleItem[]; recyclingItems?: RecyclingItem[]; tradeInItems?: SaleItem[];
  customConfirmations?: CustomConfirmation[];
  baseQuoteId?: string;
};
export type QuoteTotals = {
  metal: number; labor: number; extras: number; repair: number;
  subtotal: number; discount: number; insurance: number;
  recyclingUnitPrice: number; total: number;
  depreciation: number; exchangeWeight: number; additionalWeight: number; excessWeight: number;
  exchangeCredit: number; balance: number;
  itemTotals: QuoteItemTotal[];
  repairItemTotals?: RepairItemTotal[];
};
export type QuoteSnapshot = QuoteInput & {
  customer: { id: string; name: string; phone: string };
  brand: Settings["brand"];
  issuedBy: { id: string; name: string }; calculation: QuoteTotals;
  recyclingName?: string;
  tradeInMaterialName?: string;
};
export type QuoteRecord = {
  id: string; number: string; type: QuoteType; customerId: string;
  customerName: string; ownerId: string; title: string;
  snapshot: QuoteSnapshot; totals: QuoteTotals; total: number;
  data: QuoteSnapshot; images: string[];
  rootId: string; baseQuoteId: string | null; version: number; createdAt: string;
  saleConfirmation?: SaleConfirmation | null;
  imageUpload?: { total: number; uploadedIndexes: number[]; complete: boolean } | null;
};
export type SaleConfirmation = { id: string; rootId: string; quoteId: string; confirmedAt: string; confirmedBy: string };
export type SavedAmountAvailability = { available: true; source: "saved" | "not-applicable" | "empty" } | { available: false; reason: "not-saved" };
export type SalesMetrics = { orderCount: number; itemCount: number; weight: number; total: number; discount: number; grossNewJewelryValue: number | null; netBalance: number; oldCredit: number; refund: number; amountDue: number; oldWeight: number; depreciation: number | null; amountBreakdown?: { savedSubtotal: number; grossNewJewelryValue: SavedAmountAvailability; depreciation: SavedAmountAvailability } };
export type SalesReportItem = { id: string; title: string; material: string; weight: number; quantity: number; goldPrice: number; laborPrice: number; extras: number; subtotal: number; unitPrice?: number; mode?: PriceMode; billQuantity?: number };
export type SalesReportOrder = SalesMetrics & { id: string; rootId: string; number: string; version: number; customerId: string; customerName: string; ownerId: string; ownerName: string; date: string; createdAt: string; confirmedAt: string | null; type: QuoteType; title: string; items: SalesReportItem[]; saleConfirmation: SaleConfirmation | null };
export type SalesReport = { month: string; basis: "quotes" | "confirmed"; summary: SalesMetrics; staff: (SalesMetrics & { staffId: string; staffName: string })[]; daily: (SalesMetrics & { date: string })[]; orders: SalesReportOrder[]; total: number; page: number; pageSize: number; metadata: { sourceNote: string; versionNote: string; timeZone: string; start: string; end: string; scope: "all" | "staff"; staffId: string | null; amountNote: string } };
export type CustomerActivityItem = Omit<SalesReportItem, "subtotal"> & { subtotal: number | null; amountSource?: "saved" | "unavailable" };
export type CustomerActivityOrder = Omit<SalesReportOrder, "items"> & {
  items: CustomerActivityItem[]; amountLabel: string; weightLabel: string; insurance: number;
  repairBreakdown?: { source: "saved"; subtotal: number; insurance: number; itemsComplete: boolean };
};
export type CustomerActivity = { customer: Customer; basis: "quotes" | "confirmed"; orders: CustomerActivityOrder[]; total: number; page: number; pageSize: number; summary: SalesMetrics; byType: (SalesMetrics & { type: QuoteType; weightLabel: string; amountLabel: string })[]; metadata: { sourceNote: string; weightNote: string } };
export type AuditLog = {
  id: string; entityType: string; entityId: string; action: string;
  actorId: string; actorName: string; oldValue: unknown; newValue: unknown; createdAt: string;
};
export type Bootstrap = {
  user: StaffUser; settings: Settings; styles: Style[];
  customers: Customer[]; quotes: QuoteRecord[]; users: StaffUser[];
  media: MediaAsset[]; paymentMethods: PaymentMethod[];
  protocolCapabilities?: { customerActivityRepairAmounts?: 1 };
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
  tradeIn: { depreciationPrice: 20 },
  paymentMethods: [],
  home: {
    image: "/home-necklace.png",
    headline: "每一份报价，清晰呈现",
    introduction: "销售、定制、维修、回收与以旧换新，在同一工作台完成。",
    announcements: "报价前请核对当前金价、工费及材质参数。",
    notices: "确认重量、优惠及附加费后，再生成客户报价单。",
    workflow: "选择业务，关联客户\n选取照片，填写商品或维修项目\n核对重量、价格、优惠和收款方式\n保存报价，生成图片或现场展示",
  },
};
export const defaultTradeIn: TradeInParameters = { mode: "gram", oldMaterial: "gold", oldWeight: 0, depreciationPrice: 20, excessMode: "recycle", excessGoldPrice: 0, excessCoefficient: 0.99 };
export function mergeSettings(value: unknown): Settings {
  const old = value && typeof value === "object" && !Array.isArray(value) ? value as Partial<Settings> : {};
  const base = structuredClone(defaultSettings);
  return { ...base, ...old, brand: { ...base.brand, ...old.brand }, sale: { ...base.sale, ...old.sale }, repair: { ...base.repair, ...old.repair }, tradeIn: { ...base.tradeIn, ...old.tradeIn }, home: { ...base.home, ...old.home }, paymentMethods: old.paymentMethods ?? base.paymentMethods, recycling: old.recycling ?? base.recycling };
}

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
// Generated customer quotations are full-resolution documents, separate from
// ordinary product/media uploads. One page stays below the encrypted LAN limit.
export const QUOTE_SCREENSHOT_MAX_BYTES = 8 * 1024 * 1024;
export const QUOTE_SCREENSHOT_MAX_PAGES = 30;
export const quoteScreenshotSchema = z.string().max(22 + 4 * Math.ceil(QUOTE_SCREENSHOT_MAX_BYTES / 3), "单页报价原图最多8MiB").refine(value => {
  const content = value.slice(22), padding = content.endsWith("==") ? 2 : content.endsWith("=") ? 1 : 0;
  // Avoid a repeated capturing/grouped pattern: V8 can overflow its regexp
  // stack on several megabytes of otherwise valid base64.
  return value.startsWith("data:image/png;base64,") && content.length > 0 && content.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(content) && content.length / 4 * 3 - padding <= QUOTE_SCREENSHOT_MAX_BYTES;
}, "报价原图须为有效PNG编码，单页最多8MiB");
export const homeImageSchema = imageSchema.or(z.enum(["/home-necklace.png", "/ring.jpg"]));
export const customConfirmationSchema = z.object({ id: identifier, name: shortText.min(1), image: imageSchema.refine(value => value.length > 0, "请上传客户确认截图"), createdAt: z.string().datetime().optional() });
export const paymentMethodSchema = z.object({ id: identifier, name: shortText.min(1), details: z.string().trim().max(500).default(""), image: imageSchema.default("") });
export const paymentMethodsSchema = z.array(paymentMethodSchema).max(8).superRefine((items, ctx) => {
  if (new Set(items.map(item => item.id)).size !== items.length) ctx.addIssue({ code: "custom", message: "收款方式编号不得重复" });
  if (items.reduce((sum, item) => sum + item.image.length, 0) > 12_000_000) ctx.addIssue({ code: "custom", message: "收款图片总大小超限，请上传到素材图库后引用" });
});
export const tradeInSchema = z.object({
  mode: z.enum(["gram", "value"]).default("gram"), oldMaterial: z.enum(["gold", "platinum", "silver", "kgold"]).default("gold"), oldWeight: quantity.default(0),
  depreciationPrice: money.default(20), excessMode: z.enum(["return", "recycle"]).default("recycle"),
  excessGoldPrice: money.default(0), excessCoefficient: coefficient.default(0.99),
});
export const extraSchema = z.object({ id: identifier, name: shortText.min(1), amount: money });
export const saleItemSchema = z.object({ id: identifier, title: shortText.min(1), material: shortText.default(""), specs: z.string().trim().max(800).default(""), image: imageSchema.default(""), weight: quantity.refine(value => value > 0, "商品金重必须大于0"), goldPrice: money, laborPrice: money, extras: z.array(extraSchema).max(30).default([]), quantity: z.number().int().min(1).max(999).default(1) }).superRefine((item, ctx) => { if (new Set(item.extras.map(value => value.id)).size !== item.extras.length) ctx.addIssue({ code: "custom", path: ["extras"], message: "附加费编号不得重复" }); });
export const recyclingItemSchema = z.object({ id: identifier, title: shortText.min(1), material: z.enum(["gold", "platinum", "silver", "kgold"]), specs: z.string().trim().max(800).default(""), image: imageSchema.default(""), weight: quantity.refine(value => value > 0, "回收金重必须大于0"), goldPrice: money, recyclingCoefficient: coefficient });
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
  paymentMethods: paymentMethodsSchema.default([]), customDetails: z.string().trim().max(2000).default(""), tradeIn: tradeInSchema.default(defaultTradeIn),
  saleItems: z.array(saleItemSchema).max(30).default([]), recyclingItems: z.array(recyclingItemSchema).max(30).default([]), tradeInItems: z.array(saleItemSchema).max(30).default([]),
  customConfirmations: z.array(customConfirmationSchema).max(20).default([]),
}).superRefine((quote, ctx) => {
  if (quote.type !== "sale" && quote.saleItems.length) ctx.addIssue({ code: "custom", path: ["saleItems"], message: "多件销售明细仅用于销售报价，定制与换新请填写单件参数" });
  if (quote.type !== "recycling" && quote.recyclingItems.length) ctx.addIssue({ code: "custom", path: ["recyclingItems"], message: "多件回收明细仅用于回收报价" });
  if (quote.type !== "tradein" && quote.tradeInItems.length) ctx.addIssue({ code: "custom", path: ["tradeInItems"], message: "换新商品明细仅用于以旧换新报价" });
  if (quote.type !== "custom" && quote.customConfirmations.length) ctx.addIssue({ code: "custom", path: ["customConfirmations"], message: "客户确认截图仅用于定制报价" });
  if (new Set(quote.customConfirmations.map(item => item.id)).size !== quote.customConfirmations.length) ctx.addIssue({ code: "custom", path: ["customConfirmations"], message: "客户确认截图编号不得重复" });
  for (const key of ["saleItems", "recyclingItems", "tradeInItems"] as const) if (new Set(quote[key].map(item => item.id)).size !== quote[key].length) ctx.addIssue({ code: "custom", path: [key], message: "商品明细编号不得重复" });
  if (new Set(quote.extras.map(item => item.id)).size !== quote.extras.length) ctx.addIssue({ code: "custom", path: ["extras"], message: "附加费编号不得重复" });
  if (new Set(quote.repairItems.map(item => item.id)).size !== quote.repairItems.length) ctx.addIssue({ code: "custom", path: ["repairItems"], message: "维修明细编号不得重复" });
  const multi = quote.type === "sale" && quote.saleItems.length > 0 || quote.type === "recycling" && quote.recyclingItems.length > 0 || quote.type === "tradein" && quote.tradeInItems.length > 0;
  if (quote.type !== "repair" && !multi && quote.weight <= 0) ctx.addIssue({ code: "custom", path: ["weight"], message: "重量必须大于0" });
  const sales = ["sale", "custom", "tradein"].includes(quote.type);
  if (sales && quote.discountType === "percent" && quote.discountValue > 100) ctx.addIssue({ code: "custom", path: ["discountValue"], message: "实付比例必须为0至100，90表示九折" });
  const boundedMoney = (value: number) => Number.isFinite(value) && value >= 0 && value <= 1_000_000;
  const validSaleItems = [...quote.saleItems, ...quote.tradeInItems].every(item => Number.isFinite(item.weight) && item.weight >= 0 && item.weight <= 100_000 && Number.isInteger(item.quantity) && item.quantity >= 1 && item.quantity <= 999 && [item.goldPrice, item.laborPrice, ...item.extras.map(extra => extra.amount)].every(boundedMoney));
  if (sales && quote.discountType === "amount" && Number.isFinite(quote.weight) && quote.weight >= 0 && quote.weight <= 100_000 && validSaleItems && [quote.goldPrice, quote.laborPrice, quote.discountValue, ...quote.extras.map(item => item.amount)].every(boundedMoney) && (quote.type !== "tradein" || Number.isFinite(quote.tradeIn.oldWeight) && quote.tradeIn.oldWeight >= 0 && quote.tradeIn.oldWeight <= 100_000 && boundedMoney(quote.tradeIn.depreciationPrice)) && scaled(quote.discountValue, 100) > (quote.type === "tradein" ? tradeInSubtotalCents(quote) : salesSubtotalCents(quote))) ctx.addIssue({ code: "custom", path: ["discountValue"], message: "减免金额不得超过报价合计" });
  if (quote.type === "tradein" && quote.tradeIn.oldWeight <= 0) ctx.addIssue({ code: "custom", path: ["tradeIn", "oldWeight"], message: "以旧换新须填写大于0的旧金重量" });
  if (quote.type === "tradein" && quote.tradeIn.mode === "gram") {
    if (quote.tradeInItems.length) quote.tradeInItems.forEach((item, index) => {
      if (!isTradeInGramMaterial(item.material, quote.tradeIn.oldMaterial)) ctx.addIssue({ code: "custom", path: ["tradeInItems", index, "material"], message: tradeInGramMaterialMessage });
    });
    else if (!isTradeInGramMaterial(quote.material, quote.tradeIn.oldMaterial)) ctx.addIssue({ code: "custom", path: ["material"], message: tradeInGramMaterialMessage });
  }
  if (quote.type === "recycling" && !multi && !["gold", "platinum", "silver", "kgold"].includes(quote.material)) ctx.addIssue({ code: "custom", path: ["material"], message: "回收材质仅限黄金、Pt950铂金、白银、K金" });
  if (quote.type === "repair" && quote.repairItems.length === 0) ctx.addIssue({ code: "custom", path: ["repairItems"], message: "至少选择一个维修项目" });
  if (quote.type === "repair" && quote.insured && quote.insuredValue <= 0) ctx.addIssue({ code: "custom", path: ["insuredValue"], message: "请选择客户确认的首饰价值" });
  if (quote.image.length + quote.images.reduce((sum, image) => sum + image.length, 0) + quote.paymentMethods.reduce((sum, item) => sum + item.image.length, 0) + [...quote.saleItems, ...quote.recyclingItems, ...quote.tradeInItems, ...quote.customConfirmations].reduce((sum, item) => sum + item.image.length, 0) > 10_000_000) ctx.addIssue({ code: "custom", path: ["images"], message: "报价图片过多，请先上传素材图库后引用，原图合计最多10MB" });
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
  tradeIn: z.object({ depreciationPrice: money }).default(defaultSettings.tradeIn),
  paymentMethods: paymentMethodsSchema.default([]),
  home: z.object({ headline: shortText, introduction: z.string().trim().max(2000), announcements: z.string().trim().max(4000), notices: z.string().trim().max(4000), workflow: z.string().trim().max(4000), image: homeImageSchema.default(defaultSettings.home.image) }).default(defaultSettings.home),
}).superRefine((value, ctx) => {
  if (new Set(value.recycling.map(i => i.id)).size !== 4) ctx.addIssue({ code: "custom", path: ["recycling"], message: "四种回收材质不得重复" });
  if (new Set(value.repair.categories.map(i => i.id)).size !== value.repair.categories.length) ctx.addIssue({ code: "custom", path: ["repair", "categories"], message: "维修项目编号不得重复" });
});
export const inviteSchema = z.object({ email: z.string().trim().email().max(254).transform(value => value.toLowerCase()), name: z.string().trim().max(80).default(""), role: z.enum(["admin", "employee"]).default("employee") });
export const userPatchSchema = z.object({ id: identifier, name: z.string().trim().max(80).optional(), role: z.enum(["admin", "employee"]).optional(), active: z.boolean().optional() });

export function roundMoney(value: number): number { return Math.round((value + Number.EPSILON) * 100) / 100; }
const scaled = (value: number, factor: number): bigint => BigInt(Math.round(value * factor));
const roundedDivide = (numerator: bigint, denominator: bigint): bigint => (numerator + denominator / BigInt(2)) / denominator;
const maximumCents = BigInt(Number.MAX_SAFE_INTEGER);
// Read only money already produced by fromCents. Multiplying its public
// Number by 100 can add a cent near the boundary even if its decimal is exact.
function centsFromPublicAmount(value: number): bigint {
  if (!Number.isFinite(value)) throw new QuoteAmountPrecisionError();
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value.toString());
  if (!match) throw new QuoteAmountPrecisionError();
  const magnitude = BigInt(match[2]) * BigInt(100) + BigInt((match[3] || "").padEnd(2, "0"));
  const cents = match[1] ? -magnitude : magnitude;
  if (cents > maximumCents || cents < -maximumCents) throw new QuoteAmountPrecisionError();
  return cents;
}
const fromCents = (value: bigint): number => {
  if (value > maximumCents || value < -maximumCents) throw new QuoteAmountPrecisionError();
  const amount = Number(value) / 100;
  // Use the decimal amount clients receive. Exact float-product equality fails
  // for normal 0.29; rounding the product can hide a lost cent at this magnitude.
  if (centsFromPublicAmount(amount) !== value) throw new QuoteAmountPrecisionError();
  return amount;
};
function saleSubtotalCents(input: Pick<QuoteInput, "weight" | "goldPrice" | "laborPrice" | "extras">): bigint {
  const metalAndLabor = roundedDivide(scaled(input.weight, 1000) * (scaled(input.goldPrice, 100) + scaled(input.laborPrice, 100)), BigInt(1000));
  return metalAndLabor + input.extras.reduce((sum, item) => sum + scaled(item.amount, 100), BigInt(0));
}
function saleItemSubtotalCents(item: SaleItem): bigint {
  const extras = item.extras.reduce((sum, extra) => sum + scaled(extra.amount, 100), BigInt(0));
  return roundedDivide((scaled(item.weight, 1000) * (scaled(item.goldPrice, 100) + scaled(item.laborPrice, 100)) + extras * BigInt(1000)) * BigInt(item.quantity), BigInt(1000));
}
function salesSubtotalCents(input: QuoteInput): bigint { return input.type === "sale" && input.saleItems?.length ? input.saleItems.reduce((sum, item) => sum + saleItemSubtotalCents(item), BigInt(0)) : saleSubtotalCents(input); }
/** Explicit same-grade aliases only; arbitrary strings such as Au750/Pt900 never match gold/Pt950. */
export function isTradeInGramMaterial(material: string, oldMaterial: RecyclingMetal): boolean {
  const key = material.normalize("NFKC").replace(/\s+/g, "").toUpperCase();
  const aliases: Record<RecyclingMetal, string[]> = {
    gold: ["金", "黄金", "足金", "AU999", "AU9999", "足金999", "足金9999", "黄金AU999", "黄金AU9999"],
    platinum: ["铂金", "PT950", "PT950铂金", "铂金PT950"],
    silver: ["银", "白银", "足银", "AG999", "S999", "足银999", "白银AG999"],
    kgold: ["K金"],
  };
  return aliases[oldMaterial].includes(key);
}
function balanceCents(subtotal: bigint, extras: bigint, metal: bigint, labor: bigint, depreciation: bigint) {
  const cents = { metal, labor, depreciation }, difference = subtotal - extras - metal - labor - depreciation;
  if (difference >= BigInt(0)) cents.labor += difference;
  else {
    let deduction = -difference;
    const laborDeduction = deduction < cents.labor ? deduction : cents.labor;
    cents.labor -= laborDeduction; deduction -= laborDeduction;
    const order: ("depreciation" | "metal")[] = cents.depreciation >= cents.metal ? ["depreciation", "metal"] : ["metal", "depreciation"];
    for (const key of order) { const amount = deduction < cents[key] ? deduction : cents[key]; cents[key] -= amount; deduction -= amount; }
  }
  return cents;
}
function tradeInItemLedger(input: QuoteInput) {
  const trade = { ...defaultTradeIn, ...input.tradeIn }, items = input.tradeInItems || [];
  let remaining = trade.mode === "gram" ? scaled(trade.oldWeight, 1000) : BigInt(0);
  const rows = items.map(item => {
    const weight = scaled(item.weight, 1000) * BigInt(item.quantity), matched = remaining < weight ? remaining : weight;
    remaining -= matched;
    const additional = weight - matched;
    const extras = item.extras.reduce((sum, extra) => sum + scaled(extra.amount, 100) * BigInt(item.quantity), BigInt(0));
    const metalAndLabor = roundedDivide(additional * scaled(item.goldPrice, 100) + weight * scaled(item.laborPrice, 100), BigInt(1000));
    const metal = roundedDivide(additional * scaled(item.goldPrice, 100), BigInt(1000)), labor = metalAndLabor - metal;
    const depreciation = roundedDivide(matched * scaled(trade.depreciationPrice, 100), BigInt(1000));
    return { item, weight, matched, additional, extras, subtotal: metalAndLabor + extras + depreciation, metal, labor, depreciation };
  });
  // Depreciation is charged once against all matched grams. Allocate its penny
  // remainder to the last matching line; deductions never make a line negative.
  const matched = rows.reduce((sum, row) => sum + row.matched, BigInt(0));
  const target = roundedDivide(matched * scaled(trade.depreciationPrice, 100), BigInt(1000));
  let difference = target - rows.reduce((sum, row) => sum + row.depreciation, BigInt(0));
  for (let index = rows.length - 1; index >= 0 && difference !== BigInt(0); index--) {
    const row = rows[index];
    if (!row.matched) continue;
    const adjustment = difference > BigInt(0) ? difference : -((-difference < row.depreciation) ? -difference : row.depreciation);
    row.depreciation += adjustment; row.subtotal += adjustment; difference -= adjustment;
  }
  return rows;
}
function tradeInSubtotalCents(input: QuoteInput): bigint {
  if (input.tradeInItems?.length) return tradeInItemLedger(input).reduce((sum, item) => sum + item.subtotal, BigInt(0));
  const trade = { ...defaultTradeIn, ...input.tradeIn };
  if (trade.mode === "value") return saleSubtotalCents(input);
  const newWeight = scaled(input.weight, 1000), oldWeight = scaled(trade.oldWeight, 1000), matched = newWeight < oldWeight ? newWeight : oldWeight;
  const numerator = (newWeight - matched) * scaled(input.goldPrice, 100) + newWeight * scaled(input.laborPrice, 100) + matched * scaled(trade.depreciationPrice, 100);
  return roundedDivide(numerator, BigInt(1000)) + input.extras.reduce((sum, item) => sum + scaled(item.amount, 100), BigInt(0));
}
function balanceFeeLedger(result: QuoteTotals): void {
  const cents = balanceCents(centsFromPublicAmount(result.subtotal), centsFromPublicAmount(result.extras), centsFromPublicAmount(result.metal), centsFromPublicAmount(result.labor), centsFromPublicAmount(result.depreciation));
  result.metal = fromCents(cents.metal); result.labor = fromCents(cents.labor); result.depreciation = fromCents(cents.depreciation);
}
export function calculateQuote(input: QuoteInput): QuoteTotals {
  const result: QuoteTotals = { metal: 0, labor: 0, extras: 0, repair: 0, subtotal: 0, discount: 0, insurance: 0, recyclingUnitPrice: 0, total: 0, depreciation: 0, exchangeWeight: 0, additionalWeight: 0, excessWeight: 0, exchangeCredit: 0, balance: 0, itemTotals: [] };
  if (["sale", "custom", "tradein"].includes(input.type)) {
    const trade = { ...defaultTradeIn, ...input.tradeIn };
    if (input.type === "tradein" && trade.mode === "gram") {
      const materials = input.tradeInItems?.length ? input.tradeInItems.map(item => item.material) : [input.material];
      if (materials.some(material => !isTradeInGramMaterial(material, trade.oldMaterial))) throw new TradeInGramMaterialError();
    }
    const tradeItems = input.type === "tradein" && input.tradeInItems?.length ? tradeInItemLedger(input) : [];
    const weight = tradeItems.length ? tradeItems.reduce((sum, item) => sum + item.weight, BigInt(0)) : scaled(input.weight, 1000);
    const oldWeight = input.type === "tradein" ? scaled(trade.oldWeight, 1000) : BigInt(0);
    const gram = input.type === "tradein" && trade.mode === "gram", matched = gram ? (weight < oldWeight ? weight : oldWeight) : BigInt(0);
    const additional = gram ? weight - matched : weight, excess = gram ? oldWeight - matched : BigInt(0);
    const subtotal = input.type === "tradein" ? tradeInSubtotalCents(input) : salesSubtotalCents(input), deduction = scaled(input.discountValue, 100);
    result.metal = fromCents(roundedDivide(additional * scaled(input.goldPrice, 100), BigInt(1000)));
    result.labor = fromCents(roundedDivide(weight * scaled(input.laborPrice, 100), BigInt(1000)));
    result.extras = fromCents(input.extras.reduce((sum, extra) => sum + scaled(extra.amount, 100), BigInt(0)));
    if (input.type === "sale" && input.saleItems?.length) {
      result.itemTotals = input.saleItems.map(item => { const rowWeight = scaled(item.weight, 1000) * BigInt(item.quantity), subtotal = saleItemSubtotalCents(item), metal = roundedDivide(rowWeight * scaled(item.goldPrice, 100), BigInt(1000)), extras = item.extras.reduce((sum, extra) => sum + scaled(extra.amount, 100) * BigInt(item.quantity), BigInt(0)); return { id: item.id, metal: fromCents(metal), labor: fromCents(subtotal - metal - extras), extras: fromCents(extras), subtotal: fromCents(subtotal), total: fromCents(subtotal), weight: item.weight, quantity: item.quantity }; });
      result.metal = fromCents(result.itemTotals.reduce((sum, item) => sum + centsFromPublicAmount(item.metal), BigInt(0))); result.labor = fromCents(result.itemTotals.reduce((sum, item) => sum + centsFromPublicAmount(item.labor), BigInt(0))); result.extras = fromCents(result.itemTotals.reduce((sum, item) => sum + centsFromPublicAmount(item.extras), BigInt(0)));
    }
    if (tradeItems.length) {
      result.itemTotals = tradeItems.map(row => ({ id: row.item.id, metal: fromCents(row.metal), labor: fromCents(row.labor), extras: fromCents(row.extras), depreciation: fromCents(row.depreciation), subtotal: fromCents(row.subtotal), total: fromCents(row.subtotal), weight: row.item.weight, quantity: row.item.quantity, exchangeWeight: Number(row.matched) / 1000, additionalWeight: Number(row.additional) / 1000 }));
      result.metal = fromCents(tradeItems.reduce((sum, row) => sum + row.metal, BigInt(0))); result.labor = fromCents(tradeItems.reduce((sum, row) => sum + row.labor, BigInt(0))); result.extras = fromCents(tradeItems.reduce((sum, row) => sum + row.extras, BigInt(0))); result.depreciation = fromCents(tradeItems.reduce((sum, row) => sum + row.depreciation, BigInt(0)));
    }
    result.subtotal = fromCents(subtotal);
    if (input.discountType === "amount" && deduction > subtotal) throw new RangeError("减免金额不得超过报价合计");
    const payable = input.discountType === "percent" ? roundedDivide(subtotal * deduction, BigInt(10000)) : subtotal - (input.discountType === "amount" ? deduction : BigInt(0));
    let credit = BigInt(0);
    if (input.type === "tradein") {
      result.exchangeWeight = Number(matched) / 1000; result.additionalWeight = Number(additional) / 1000; result.excessWeight = Number(excess) / 1000;
      if (!tradeItems.length) result.depreciation = gram ? fromCents(roundedDivide(matched * scaled(trade.depreciationPrice, 100), BigInt(1000))) : 0;
      const creditedWeight = trade.mode === "value" ? oldWeight : trade.excessMode === "recycle" ? excess : BigInt(0);
      credit = roundedDivide(creditedWeight * scaled(trade.excessGoldPrice, 100) * scaled(trade.excessCoefficient, 10000), BigInt(10_000_000));
      result.exchangeCredit = fromCents(credit);
    }
    result.total = fromCents(payable - credit);
    result.discount = fromCents(subtotal - payable);
    balanceFeeLedger(result);
  } else if (input.type === "recycling") {
    const unitNumerator = scaled(input.goldPrice, 100) * scaled(input.recyclingCoefficient, 10000);
    result.recyclingUnitPrice = Number(unitNumerator) / 1_000_000;
    result.subtotal = fromCents(roundedDivide(scaled(input.weight, 1000) * unitNumerator, BigInt(10_000_000)));
    result.total = result.subtotal;
    if (input.recyclingItems?.length) {
      result.itemTotals = input.recyclingItems.map(item => { const unitNumerator = scaled(item.goldPrice, 100) * scaled(item.recyclingCoefficient, 10000), subtotal = fromCents(roundedDivide(scaled(item.weight, 1000) * unitNumerator, BigInt(10_000_000))); return { id: item.id, metal: subtotal, labor: 0, extras: 0, subtotal, total: subtotal, unitPrice: Number(unitNumerator) / 1_000_000, weight: item.weight, quantity: 1 }; });
      result.subtotal = fromCents(result.itemTotals.reduce((sum, item) => sum + centsFromPublicAmount(item.subtotal), BigInt(0))); result.total = result.subtotal; result.recyclingUnitPrice = 0;
    }
  } else {
    const repairRows = input.repairItems.map(item => ({ id: item.id, cents: item.mode === "fixed" ? scaled(item.price, 100) : roundedDivide(scaled(item.quantity, 1000) * scaled(item.price, 100), BigInt(1000)) }));
    const repair = repairRows.reduce((sum, item) => sum + item.cents, BigInt(0));
    result.repairItemTotals = repairRows.map(item => ({ id: item.id, subtotal: fromCents(item.cents) }));
    result.repair = fromCents(repair);
    result.subtotal = result.repair;
    const insurance = input.insured ? roundedDivide(scaled(input.insuredValue, 100) * scaled(input.insuranceRate, 100), BigInt(10000)) : BigInt(0);
    result.insurance = fromCents(insurance);
    result.total = fromCents(repair + insurance);
  }
  result.balance = result.total;
  return result;
}
export function canAccessOwned(user: Pick<StaffUser, "id" | "role" | "active">, ownerId: string): boolean { return user.active && (user.role === "admin" || user.id === ownerId); }
export function canManage(user: Pick<StaffUser, "role" | "active">): boolean { return user.active && user.role === "admin"; }

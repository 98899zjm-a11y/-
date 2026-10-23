import { defaultTradeIn, quoteInputSchema, type QuoteInput, type QuoteSnapshot, type QuoteTotals, type QuoteItemTotal, type RepairItemTotal } from "./domain";

export type QuotePresentationInput = QuoteInput & Partial<Pick<QuoteSnapshot, "calculation" | "customer" | "brand" | "issuedBy">>;
export type SavedQuotePresentation = { totals: QuoteTotals; itemDetailsComplete: boolean; repairItemDetailsComplete: boolean; amountsConsistent: boolean };

export function emptyQuoteTotals(): QuoteTotals {
  return { metal: 0, labor: 0, extras: 0, repair: 0, subtotal: 0, discount: 0, insurance: 0, recyclingUnitPrice: 0, total: 0, depreciation: 0, exchangeWeight: 0, additionalWeight: 0, excessWeight: 0, exchangeCredit: 0, balance: 0, itemTotals: [] };
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const owns = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
export class HistoricalQuotePresentationError extends Error {
  constructor(detail: string) {
    super(`历史报价保存的金额快照${detail}，请核对原始单据，不能按当前规则重算`);
    this.name = "HistoricalQuotePresentationError";
  }
}
function fail(detail: string): never { throw new HistoricalQuotePresentationError(detail); }
function money(value: unknown, signed = false): value is number {
  return typeof value === "number" && Number.isFinite(value) && (signed || value >= 0) && Number.isSafeInteger(Math.round(value * 100)) && Math.abs(value * 100 - Math.round(value * 100)) < 0.000001;
}
const cents = (value: number) => BigInt(Math.round(value * 100));

/** A missing historical amount is not permission to price the old order again. */
export function readSavedQuotePresentation(input: QuotePresentationInput): SavedQuotePresentation | null {
  const saved = owns(input, "calculation") || (owns(input, "customer") && owns(input, "brand") && owns(input, "issuedBy"));
  if (!saved) return null;
  const raw: unknown = input.calculation;
  if (!object(raw)) fail("缺失");
  const required = ["subtotal", "discount", "total", ...(["sale", "custom", "tradein"].includes(input.type) ? ["metal", "labor", "extras"] : []), ...(input.type === "repair" ? ["repair", "insurance"] : []), ...(input.type === "tradein" ? ["exchangeCredit"] : [])];
  for (const key of required) if (!owns(raw, key) || !money(raw[key], key === "total" && input.type === "tradein")) fail("缺失或金额无效");
  for (const key of ["metal", "labor", "extras", "repair", "subtotal", "discount", "insurance", "total", "depreciation", "exchangeCredit", "balance"]) {
    if (owns(raw, key) && !money(raw[key], input.type === "tradein" && ["total", "balance"].includes(key))) fail("金额无效");
  }
  for (const key of ["recyclingUnitPrice", "exchangeWeight", "additionalWeight", "excessWeight"]) {
    if (owns(raw, key) && (typeof raw[key] !== "number" || !Number.isFinite(raw[key]) || raw[key] < 0)) fail("明细无效");
  }
  if (input.type === "repair") {
    if (!Array.isArray(input.repairItems)) fail("维修项目结构无效");
    const serviceIds = new Set<string>();
    for (const item of input.repairItems as unknown[]) {
      if (!object(item) || typeof item.id !== "string" || !item.id || serviceIds.has(item.id) || typeof item.name !== "string" || typeof item.mode !== "string" || !["fixed", "count", "gram"].includes(item.mode) || typeof item.quantity !== "number" || !Number.isFinite(item.quantity) || item.quantity < 0 || !money(item.price)) fail("维修项目结构无效");
      serviceIds.add(item.id);
    }
  }
  const repairRows: RepairItemTotal[] = [], repairIds = new Set<string>();
  if (input.type === "repair" && owns(raw, "repairItemTotals")) {
    if (!Array.isArray(raw.repairItemTotals)) fail("维修金额明细无效");
    for (const row of raw.repairItemTotals) {
      if (!object(row) || typeof row.id !== "string" || !row.id || repairIds.has(row.id) || !money(row.subtotal)) fail("维修金额明细无效");
      repairIds.add(row.id); repairRows.push({ id: row.id, subtotal: row.subtotal });
    }
  }
  if (raw.itemTotals !== undefined && !Array.isArray(raw.itemTotals)) fail("商品金额明细无效");
  const rows: QuoteItemTotal[] = [], ids = new Set<string>();
  for (const row of (raw.itemTotals || []) as unknown[]) {
    if (!object(row) || typeof row.id !== "string" || !row.id || ids.has(row.id)) fail("商品金额明细无效");
    for (const key of ["metal", "labor", "extras", "subtotal"]) if (!money(row[key])) fail("商品金额明细无效");
    for (const key of ["total", "depreciation"]) if (owns(row, key) && !money(row[key])) fail("商品金额明细无效");
    if (typeof row.weight !== "number" || !Number.isFinite(row.weight) || row.weight < 0 || !Number.isInteger(row.quantity) || Number(row.quantity) < 1) fail("商品金额明细无效");
    for (const key of ["unitPrice", "exchangeWeight", "additionalWeight"]) if (owns(row, key) && (typeof row[key] !== "number" || !Number.isFinite(row[key]) || row[key] < 0)) fail("商品金额明细无效");
    ids.add(row.id); rows.push({ ...row } as QuoteItemTotal);
  }
  // Defaults cover fields introduced after scalar-only snapshots. They never
  // create item amounts or replace a saved monetary field.
  const totals = { ...emptyQuoteTotals(), ...raw, balance: raw.balance ?? raw.total, itemTotals: rows, ...(input.type === "repair" && owns(raw, "repairItemTotals") ? { repairItemTotals: repairRows } : {}) } as QuoteTotals;
  const items = input.type === "sale" ? input.saleItems : input.type === "tradein" ? input.tradeInItems : input.type === "recycling" ? input.recyclingItems : [];
  const recorded = (value: object, keys: string[]) => keys.every(key => owns(value, key));
  const lineAmountsComplete = !items?.length || rows.length === items.length && items.every(item => ids.has(item.id)) && rows.reduce((sum, row) => sum + cents(row.subtotal), BigInt(0)) === cents(totals.subtotal);
  // A compatibility default is only meaningful for fields irrelevant to the
  // order type. Missing historical unit prices/exchange figures are unknown,
  // not saved zeros; the caller must hide those details and keep the total.
  const recyclingDetailsComplete = input.type !== "recycling" || (items?.length ? rows.every(row => owns(row, "unitPrice")) : owns(raw, "recyclingUnitPrice"));
  const effectiveTradeMode = input.tradeIn?.mode ?? defaultTradeIn.mode;
  const gramDetailsComplete = input.type !== "tradein" || effectiveTradeMode !== "gram" || recorded(raw, ["depreciation", "exchangeWeight", "additionalWeight", "excessWeight"]) && (!items?.length || rows.every(row => recorded(row, ["depreciation", "exchangeWeight", "additionalWeight"])));
  const itemDetailsComplete = lineAmountsComplete && recyclingDetailsComplete && gramDetailsComplete;
  // Historical service prices/quantities are not saved service amounts.
  // Only a complete ID-matched saved ledger can supply those subtotals.
  const repairCents = repairRows.reduce((sum, row) => sum + cents(row.subtotal), BigInt(0));
  const repairItemDetailsComplete = input.type !== "repair" || owns(raw, "repairItemTotals") && repairRows.length === input.repairItems.length && input.repairItems.every(item => repairIds.has(item.id)) && repairCents === cents(totals.repair) && repairCents === cents(totals.subtotal);
  const expected = input.type === "repair" ? cents(totals.subtotal) + cents(totals.insurance) : input.type === "recycling" ? cents(totals.subtotal) : cents(totals.subtotal) - cents(totals.discount) - (input.type === "tradein" ? cents(totals.exchangeCredit) : BigInt(0));
  const amountsConsistent = cents(totals.discount) <= cents(totals.subtotal) && expected === cents(totals.total) && cents(totals.balance) === cents(totals.total);
  return { totals, itemDetailsComplete, repairItemDetailsComplete, amountsConsistent };
}

/** Historical structure is checked without applying today's business rules. */
export function parseQuotePresentationInput(input: QuotePresentationInput): QuotePresentationInput {
  const saved = readSavedQuotePresentation(input);
  if (!saved) return quoteInputSchema.parse(input);
  return { ...quoteInputSchema.innerType().parse(input), calculation: input.calculation, customer: input.customer, brand: input.brand, issuedBy: input.issuedBy };
}

/** Preserve every quote input while removing metadata that marks a saved order. */
export function stripSavedQuoteCalculation<T extends object>(input: T): T {
  const draft = { ...input } as T & Partial<QuoteSnapshot>;
  delete draft.calculation; delete draft.customer; delete draft.brand; delete draft.issuedBy;
  return draft;
}

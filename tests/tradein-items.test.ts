import test from "node:test";
import assert from "node:assert/strict";
// @ts-ignore Native Node TypeScript loader requires explicit extensions.
import { calculateQuote, defaultTradeIn, quoteInputSchema, isTradeInGramMaterial, type QuoteInput, type SaleItem } from "../lib/domain.ts";
// @ts-ignore Native Node TypeScript loader requires explicit extensions.
import { ensureProductItems, restoreSavedProductItems, removeProductById, hasEmptyProductList } from "../lib/client-drafts.ts";

const item = (id: string, patch: Partial<SaleItem> = {}): SaleItem => ({ id, title: id, material: "黄金", specs: "", image: "", weight: 2, goldPrice: 450, laborPrice: 80, extras: [{ id: "diamond", name: "配件", amount: 100 }], quantity: 1, ...patch });
const quote = (patch: Partial<QuoteInput> = {}) => quoteInputSchema.parse({ type: "tradein", customerId: "customer-1", title: "多件换新", material: "legacy", weight: 999, goldPrice: 999, laborPrice: 999, extras: [{ id: "ignored", name: "旧字段", amount: 999 }], tradeIn: { ...defaultTradeIn, oldWeight: 3, excessGoldPrice: 450 }, tradeInItems: [item("a"), item("b", { weight: 3, goldPrice: 600, laborPrice: 100, extras: [] })], ...patch });
function balanced(input: QuoteInput) {
  const result = calculateQuote(input), cents = (value: number) => Math.round(value * 100), sum = (field: "metal" | "labor" | "extras" | "depreciation" | "subtotal") => result.itemTotals.reduce((total, row) => total + cents(row[field] || 0), 0);
  for (const field of ["metal", "labor", "extras", "depreciation", "subtotal"] as const) assert.equal(sum(field), cents(result[field]), field);
  for (const row of result.itemTotals) assert.equal(cents(row.subtotal), cents(row.metal) + cents(row.labor) + cents(row.extras) + cents(row.depreciation || 0));
  return result;
}

test("多件克换克按条目顺序分旧金，分别用自己的价格补新金，不计旧根字段", () => {
  const result = balanced(quote());
  assert.equal(result.subtotal, 1820); assert.equal(result.total, 1820);
  assert.equal(result.exchangeWeight, 3); assert.equal(result.additionalWeight, 2); assert.equal(result.excessWeight, 0);
  assert.equal(result.depreciation, 60); assert.equal(result.labor, 460); assert.equal(result.metal, 1200);
  assert.deepEqual(result.itemTotals.map(row => [row.id, row.exchangeWeight, row.additionalWeight, row.subtotal]), [["a", 2, 0, 300], ["b", 1, 2, 1520]]);
});
test("多件旧金多于新金：折旧全匹配克重一次，余金抵扣一次并保留退款方向", () => {
  const result = balanced(quote({ tradeIn: { ...defaultTradeIn, oldWeight: 7, excessGoldPrice: 450 }, discountType: "amount", discountValue: 50 }));
  assert.equal(result.subtotal, 660); assert.equal(result.depreciation, 100); assert.equal(result.excessWeight, 2); assert.equal(result.exchangeCredit, 891);
  assert.equal(result.discount, 50); assert.equal(result.total, -281); assert.equal(result.balance, -281);
  const returned = calculateQuote(quote({ tradeIn: { ...defaultTradeIn, oldWeight: 7, excessGoldPrice: 450, excessMode: "return" } }));
  assert.equal(returned.exchangeCredit, 0); assert.equal(returned.total, 660);
});
test("换新商品数量乘单件重量、工费及附加费，旧金总重不会乘商品件数", () => {
  const result = balanced(quote({ tradeIn: { ...defaultTradeIn, oldWeight: 2, excessGoldPrice: 450 }, tradeInItems: [item("a", { weight: 1.5, quantity: 2, goldPrice: 400, laborPrice: 60 }), item("b", { weight: 2, goldPrice: 600 })] }));
  assert.equal(result.subtotal, 2280); assert.equal(result.exchangeWeight, 2); assert.equal(result.additionalWeight, 3);
  assert.equal(result.extras, 300); assert.equal(result.itemTotals[0].quantity, 2); assert.equal(result.itemTotals[0].subtotal, 820);
});
test("跨材质多件折价换新：新件正常售价、整单优惠一次、旧料整重回收一次", () => {
  const result = balanced(quote({ discountType: "percent", discountValue: 90, tradeIn: { ...defaultTradeIn, mode: "value", oldMaterial: "platinum", oldWeight: 5, excessGoldPrice: 400, excessCoefficient: .94 }, tradeInItems: [item("gold"), item("platinum", { material: "Pt950", weight: 3, goldPrice: 300, laborPrice: 60, extras: [] })] }));
  assert.equal(result.subtotal, 2240); assert.equal(result.discount, 224); assert.equal(result.exchangeCredit, 1880); assert.equal(result.total, 136);
  assert.equal(result.depreciation, 0); assert.equal(result.exchangeWeight, 0);
});
test("整单减免按多件实际合计校验，能全减免并继续计算应退旧料款", () => {
  assert.equal(calculateQuote(quote({ discountType: "amount", discountValue: 1820 })).total, 0);
  assert.throws(() => quote({ discountType: "amount", discountValue: 1820.01 }));
  const value = quote({ discountType: "amount", discountValue: 2240, tradeIn: { ...defaultTradeIn, mode: "value", oldMaterial: "platinum", oldWeight: 5, excessGoldPrice: 400, excessCoefficient: .94 }, tradeInItems: [item("gold"), item("platinum", { material: "Pt950", weight: 3, goldPrice: 300, laborPrice: 60, extras: [] })] });
  assert.equal(calculateQuote(value).total, -1880);
});
test("折旧尾差归最后匹配行；减尾差不产生负项，合计逐分平衡", () => {
  const small = (id: string, weight: number) => item(id, { weight, goldPrice: 1, laborPrice: 0, extras: [] });
  const added = balanced(quote({ tradeIn: { ...defaultTradeIn, oldWeight: .005, depreciationPrice: 1 }, tradeInItems: [small("a", .003), small("b", .002)] }));
  assert.equal(added.depreciation, .01); assert.equal(added.subtotal, .01); assert.equal(added.itemTotals[1].depreciation, .01);
  const deducted = balanced(quote({ tradeIn: { ...defaultTradeIn, oldWeight: .015, depreciationPrice: 1 }, tradeInItems: [small("a", .005), small("b", .005), small("c", .005)] }));
  assert.equal(deducted.depreciation, .02); assert.deepEqual(deducted.itemTotals.map(row => row.depreciation), [.01, .01, 0]);
  assert.ok(deducted.itemTotals.every(row => row.depreciation! >= 0 && row.labor >= 0 && row.metal >= 0));
});
test("明确同材质别名才能多件克换克，Pt950及18K不会被误认足金", () => {
  for (const material of ["金", "黄金", "足金", "au999", "Au9999"]) assert.doesNotThrow(() => quote({ tradeInItems: [item("same", { material })] }));
  assert.equal(isTradeInGramMaterial("Pt950", "platinum"), true); assert.equal(isTradeInGramMaterial("Pt900", "platinum"), false);
  for (const material of ["Pt950", "18K", "Au750", "足金镀层", ""]) assert.throws(() => quote({ tradeInItems: [item("mixed", { material })] }), /克换克/);
  const unsafe = { ...quote(), tradeInItems: [item("mixed", { material: "Pt950" })] };
  assert.throws(() => calculateQuote(unsafe), /折价抵扣/);
});
test("换新数组只适用换新，商品id/重量/数量及图片合计经过验证", () => {
  for (const patch of [{ type: "sale" }, { tradeInItems: [item("same"), item("same")] }, { tradeInItems: [item("zero", { weight: 0 })] }, { tradeInItems: [item("zero", { quantity: 0 })] }, { tradeInItems: [item("bad", { quantity: 1.2 })] }]) assert.throws(() => quote(patch as Partial<QuoteInput>));
  assert.doesNotThrow(() => quote({ weight: 0 }));
});
test("历史单件换新缺省或空数组继续使用原公式，不改变历史材质字段", () => {
  const legacy = quoteInputSchema.parse({ type: "tradein", customerId: "old", title: "旧单", material: "Pt950", weight: 5, goldPrice: 450, laborPrice: 80, extras: [{ id: "e", name: "配件", amount: 100 }], tradeIn: { ...defaultTradeIn, oldWeight: 3 } });
  assert.deepEqual(legacy.tradeInItems, []); assert.equal(calculateQuote(legacy).total, 1460); assert.equal(calculateQuote({ ...legacy, tradeInItems: undefined }).total, 1460);
});
test("换新删除商品保留旧料及整单信息；删除最后一件不能复活旧根金额", () => {
  const input = quote({ material: "黄金" });
  const first = removeProductById(input, "a", 1); assert.equal(first.activeIndex, 0); assert.equal(first.draft.tradeInItems![0].id, "b");
  const last = removeProductById(first.draft, "b", 0).draft;
  assert.equal(hasEmptyProductList(last), true); assert.equal(last.weight, 0); assert.equal(last.goldPrice, 0); assert.deepEqual(last.extras, []);
  assert.equal(last.tradeIn!.oldWeight, 3); assert.equal(last.customerId, input.customerId);
  assert.deepEqual(restoreSavedProductItems(last, () => "must-not-create").tradeInItems, []); assert.equal(quoteInputSchema.safeParse(last).success, false);
});
test("旧换新快照缺数组或parser空数组均完整迁移，明确空稿不迁移", () => {
  const legacy: QuoteInput = { ...quote({ material: "黄金" }), tradeInItems: undefined };
  const migrated = ensureProductItems(legacy, () => "migrated");
  assert.equal(migrated.tradeInItems![0].weight, 999); assert.equal(migrated.tradeInItems![0].extras[0].amount, 999); assert.equal(migrated.tradeIn!.oldWeight, 3);
  const saved: QuoteInput = { ...legacy, tradeInItems: [] };
  assert.equal(restoreSavedProductItems(saved, () => "copied").tradeInItems![0].id, "copied");
  const empty = ensureProductItems({ ...legacy, tradeInItems: [] }, () => "never"); assert.equal(empty.weight, 0); assert.deepEqual(empty.tradeInItems, []);
});
test("定制确认截图限类型、20张、唯一编号、有效图片与时间，不混进换新商品", () => {
  const picture = { id: "confirmation", name: "客户确认款式", image: "/api/images/12345678-1234-1234-1234-123456789012", createdAt: "2026-10-10T08:30:00.000Z" };
  const custom = { type: "custom", customerId: "custom", title: "定制", weight: 1, goldPrice: 450, customConfirmations: [picture] };
  assert.equal(quoteInputSchema.parse(custom).customConfirmations[0].image, picture.image);
  assert.equal(calculateQuote(quoteInputSchema.parse(custom)).total, 450);
  for (const patch of [{ type: "sale" }, { customConfirmations: [picture, picture] }, { customConfirmations: [{ ...picture, image: "" }] }, { customConfirmations: [{ ...picture, createdAt: "wrong-date" }] }, { customConfirmations: [{ ...picture, name: "a".repeat(121) }] }, { customConfirmations: Array.from({ length: 21 }, (_, i) => ({ ...picture, id: String(i) })) }]) assert.equal(quoteInputSchema.safeParse({ ...custom, ...patch }).success, false);
  const huge = "data:image/png;base64," + "A".repeat(1_499_960);
  assert.equal(quoteInputSchema.safeParse({ ...custom, customConfirmations: Array.from({ length: 7 }, (_, i) => ({ ...picture, id: String(i), image: huge })) }).success, false);
  assert.equal(quoteInputSchema.safeParse({ ...custom, customConfirmations: Array.from({ length: 20 }, (_, i) => ({ ...picture, id: String(i) })) }).success, true);
});

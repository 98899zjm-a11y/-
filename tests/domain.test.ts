import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore Node's native TypeScript loader requires the explicit extension.
import { calculateQuote, quoteInputSchema, settingsSchema, canAccessOwned, canManage, defaultSettings, type QuoteInput } from "../lib/domain.ts";

const input = (patch: Partial<QuoteInput> = {}) => quoteInputSchema.parse({ type: "sale", customerId: "customer-1", title: "测试报价", material: "Pt950", weight: 3.2, goldPrice: 450, laborPrice: 80, extras: [{ id: "stone", name: "培育钻石", amount: 900 }, { id: "accessory", name: "配件", amount: 150 }], ...patch });

test("sale: formula and amount discount use all extras", () => {
  const value = calculateQuote(input({ discountType: "amount", discountValue: 200 }));
  assert.equal(value.subtotal, 2746); assert.equal(value.discount, 200); assert.equal(value.total, 2546);
});
test("sale: 90 percent is the amount payable, currency rounds at final price", () => {
  const value = calculateQuote(input({ discountType: "percent", discountValue: 90 }));
  assert.equal(value.total, 2471.4); assert.equal(value.discount, 274.6);
});
test("prices round decimal half cents correctly even at larger amounts", () => {
  const sale = calculateQuote(input({ weight: 2.005, goldPrice: 1001, laborPrice: 0, extras: [] }));
  assert.equal(sale.total, 2007.01);
  const recovery = calculateQuote(input({ type: "recycling", material: "gold", weight: 2.005, goldPrice: 1001, recyclingCoefficient: 1 }));
  assert.equal(recovery.total, 2007.01);
});
test("recycling: gold and Pt950 use exactly the configured coefficients", () => {
  assert.equal(calculateQuote(input({ type: "recycling", material: "gold", recyclingCoefficient: 0.99 })).total, 1425.6);
  assert.equal(calculateQuote(input({ type: "recycling", material: "platinum", recyclingCoefficient: 0.94 })).total, 1353.6);
  assert.equal(calculateQuote(input({ type: "recycling", material: "kgold", weight: 2.345, goldPrice: 410.3, recyclingCoefficient: 0.7567 })).recyclingUnitPrice, 310.47401);
  assert.equal(calculateQuote(input({ type: "recycling", material: "kgold", weight: 2.345, goldPrice: 410.3, recyclingCoefficient: 0.7567 })).total, 728.06);
});
test("repair: fixed, count, gram and optional insurance", () => {
  const quote = input({ type: "repair", repairItems: [
    { id: "one", categoryId: "ring-size", name: "指圈调整", mode: "fixed", quantity: 5, price: 120, note: "" },
    { id: "two", categoryId: "welding", name: "焊接", mode: "count", quantity: 2, price: 80, note: "" },
    { id: "three", categoryId: "add-metal", name: "加金", mode: "gram", quantity: 0.125, price: 560, note: "" },
  ], insured: true, insuredValue: 5000, insuranceRate: 6 });
  assert.equal(calculateQuote(quote).repair, 350); assert.equal(calculateQuote(quote).insurance, 300); assert.equal(calculateQuote(quote).total, 650);
  assert.equal(calculateQuote({ ...quote, insured: false }).total, 350);
});
test("invalid inputs cannot become saved quotes", () => {
  for (const patch of [
    { weight: -1 }, { weight: 0 }, { weight: 1.0001 }, { goldPrice: 0.001 }, { goldPrice: Infinity, discountType: "amount", discountValue: 1 },
    { recyclingCoefficient: 0.99999 }, { discountType: "percent", discountValue: 101 },
    { discountType: "amount", discountValue: 999999 }, { type: "recycling", material: "diamond" },
    { image: "https://evil.example/picture.svg" },
    { type: "repair", repairItems: [] },
    { type: "repair", insured: true, insuredValue: 0, repairItems: [{ id: "one", categoryId: "repair", name: "焊接", mode: "count", quantity: 1.5, price: 1, note: "" }] },
  ]) assert.throws(() => input(patch as Partial<QuoteInput>));
});
test("client totals and ownership fields are discarded", () => {
  const parsed = quoteInputSchema.parse({ ...input(), total: 1, ownerId: "other-employee" });
  assert.equal("total" in parsed, false); assert.equal("ownerId" in parsed, false); assert.equal(calculateQuote(parsed).total, 2746);
});
test("employees see their own records; active admins see all", () => {
  const employee = { id: "employee-a", role: "employee" as const, active: true };
  assert.equal(canAccessOwned(employee, "employee-a"), true); assert.equal(canAccessOwned(employee, "employee-b"), false); assert.equal(canManage(employee), false);
  assert.equal(canAccessOwned({ ...employee, role: "admin" }, "employee-b"), true); assert.equal(canManage({ ...employee, role: "admin" }), true);
  assert.equal(canAccessOwned({ ...employee, role: "admin", active: false }, "employee-a"), false); assert.equal(canManage({ ...employee, role: "admin", active: false }), false);
});
test("settings preserve four independent material coefficients and category ids", () => {
  assert.doesNotThrow(() => settingsSchema.parse(defaultSettings));
  assert.throws(() => settingsSchema.parse({ ...defaultSettings, recycling: [defaultSettings.recycling[0], ...defaultSettings.recycling.slice(0, 3)] }));
  assert.throws(() => settingsSchema.parse({ ...defaultSettings, repair: { ...defaultSettings.repair, categories: [defaultSettings.repair.categories[0], defaultSettings.repair.categories[0]] } }));
});

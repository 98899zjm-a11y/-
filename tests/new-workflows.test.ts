import test from "node:test";
import assert from "node:assert/strict";
// @ts-ignore Node's native TypeScript loader requires the explicit extension.
import { calculateQuote, quoteInputSchema, mergeSettings, defaultSettings } from "../lib/domain.ts";

const quote = (patch: Record<string, unknown>) => quoteInputSchema.parse({ type: "sale", customerId: "customer-a", title: "整单报价", material: "足金", weight: 6, goldPrice: 500, laborPrice: 80, extras: [], ...patch });
const trade = (patch: Record<string, unknown> = {}) => ({ mode: "gram", oldMaterial: "gold", oldWeight: 5, depreciationPrice: 20, excessMode: "recycle", excessGoldPrice: 500, excessCoefficient: .99, ...patch });

test("同材质克换克：抵换克重折旧20元，新金全部收工费，新增克重按金价补差", () => {
  const result = calculateQuote(quote({ type: "tradein", tradeIn: trade(), extras: [{ id: "stone", name: "钻石", amount: 100 }] }));
  assert.equal(result.exchangeWeight, 5);
  assert.equal(result.additionalWeight, 1);
  assert.equal(result.depreciation, 100);
  assert.equal(result.labor, 480);
  assert.equal(result.metal, 500);
  assert.equal(result.total, 1180);
});
test("多余旧金回收抵扣：整单优惠后扣旧料金额，退款金额保留方向", () => {
  const result = calculateQuote(quote({ type: "tradein", weight: 5, tradeIn: trade({ oldWeight: 7 }), discountType: "amount", discountValue: 50 }));
  assert.equal(result.excessWeight, 2);
  assert.equal(result.exchangeCredit, 990);
  assert.equal(result.subtotal, 500);
  assert.equal(result.discount, 50);
  assert.equal(result.total, -540);
});
test("跨材质换新：旧料整件折价抵扣新饰正常售价，不收克换克折旧", () => {
  const result = calculateQuote(quote({ type: "tradein", tradeIn: trade({ mode: "value", oldMaterial: "platinum", oldWeight: 5, excessGoldPrice: 400, excessCoefficient: .94 }) }));
  assert.equal(result.subtotal, 3480);
  assert.equal(result.depreciation, 0);
  assert.equal(result.exchangeCredit, 1880);
  assert.equal(result.total, 1600);
});
test("定制沿用销售价格规则且保留定制需求和收款信息", () => {
  const input = quote({ type: "custom", customDetails: "圈口14号，培育钻石，交期另议", paymentMethods: [{ id: "bank", name: "银行转账", details: "账号由客户核对", image: "" }], discountType: "percent", discountValue: 90 });
  assert.equal(calculateQuote(input).total, 3132);
  assert.equal(input.customDetails, "圈口14号，培育钻石，交期另议");
  assert.equal(input.paymentMethods[0].name, "银行转账");
});
test("多件销售：商品数量和附加费只计一次，整单折扣仅作用一次", () => {
  const input = quote({ weight: 0, goldPrice: 999999, extras: [{ id: "ignored", name: "旧字段不能重复计入", amount: 10000 }], saleItems: [
    { id: "ring", title: "黄金戒指", material: "足金", specs: "圈口14", image: "", weight: 2, goldPrice: 500, laborPrice: 50, extras: [{ id: "a", name: "配件", amount: 100 }], quantity: 2 },
    { id: "necklace", title: "铂金项链", material: "Pt950", specs: "45cm", image: "", weight: 3, goldPrice: 300, laborPrice: 80, extras: [], quantity: 1 },
  ], discountType: "percent", discountValue: 90 });
  const result = calculateQuote(input);
  assert.equal(result.subtotal, 3540);
  assert.equal(result.discount, 354);
  assert.equal(result.total, 3186);
  assert.equal(input.saleItems.length, 2);
});
test("多件回收：不同材质各按自己的单价和系数，根字段不重复计算", () => {
  const input = quote({ type: "recycling", weight: 0, material: "diamond", goldPrice: 999999, recyclingItems: [
    { id: "gold", title: "黄金戒指", material: "gold", specs: "", image: "", weight: 5, goldPrice: 500, recyclingCoefficient: .99 },
    { id: "platinum", title: "铂金项链", material: "platinum", specs: "", image: "", weight: 3, goldPrice: 400, recyclingCoefficient: .94 },
  ] });
  assert.equal(calculateQuote(input).total, 3603);
  assert.equal(input.recyclingItems.length, 2);
});
test("多商品条目验证：每件重量必须有效，销售数量必须为正整数", () => {
  const item = { id: "a", title: "戒指", material: "足金", specs: "", image: "", weight: 2, goldPrice: 500, laborPrice: 50, extras: [], quantity: 1 };
  for (const patch of [{ weight: 0 }, { weight: -1 }, { weight: 2.0001 }, { quantity: 0 }, { quantity: 1.5 }, { image: "https://evil.invalid/x.svg" }]) assert.throws(() => quote({ saleItems: [{ ...item, ...patch }] }));
});
test("旧公司设置升级保留原金价、维修价格及回收系数，补齐首页和折旧默认", () => {
  const legacy = { brand: { ...defaultSettings.brand, name: "公司原名称" }, sale: { goldPrice: 780, laborPrice: 123 }, recycling: defaultSettings.recycling.map(item => ({ ...item, coefficient: .88 })), repair: { ...defaultSettings.repair, insuranceRate: 3 } };
  const upgraded = mergeSettings(legacy);
  assert.equal(upgraded.sale.goldPrice, 780);
  assert.equal(upgraded.sale.laborPrice, 123);
  assert.equal(upgraded.repair.insuranceRate, 3);
  assert.equal(upgraded.recycling[0].coefficient, .88);
  assert.equal(upgraded.tradeIn.depreciationPrice, 20);
  assert.ok(upgraded.home.headline);
  assert.deepEqual(upgraded.paymentMethods, []);
});

import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Node's native TypeScript loader requires the explicit extension.
import { calculateQuote, canAccessOwned, canManage, defaultSettings, quoteInputSchema, settingsSchema, repairItemSchema } from '../lib/domain.ts';

const quote = (overrides: Record<string, unknown> = {}) => quoteInputSchema.parse({
  type: 'sale', customerId: 'customer-a', title: '铂金定制戒指',
  weight: 3.2, goldPrice: 450, laborPrice: 80,
  extras: [{ id: 'diamond', name: '培育钻石', amount: 900 }, { id: 'accessory', name: '配件', amount: 150 }],
  ...overrides,
});

test('员工只访问自己的客户、报价和图片，管理员访问全部，停用账号访问全部拒绝', () => {
  const a = { id: 'employee-a', role: 'employee' as const, active: true };
  const b = { id: 'employee-b', role: 'employee' as const, active: true };
  const admin = { id: 'admin', role: 'admin' as const, active: true };
  assert.equal(canAccessOwned(a, a.id), true);
  assert.equal(canAccessOwned(a, b.id), false);
  assert.equal(canAccessOwned(b, a.id), false);
  assert.equal(canAccessOwned(admin, a.id), true);
  assert.equal(canAccessOwned({ ...admin, active: false }, a.id), false);
  assert.equal(canAccessOwned({ ...a, active: false }, a.id), false);
  assert.equal(canManage(a), false);
  assert.equal(canManage(admin), true);
  assert.equal(canManage({ ...admin, active: false }), false);
});

test('销售附加费只计算一次；金重×（金价＋每克工费）＋附加费', () => {
  assert.deepEqual(calculateQuote(quote()), {
    metal: 1440, labor: 256, extras: 1050, repair: 0,
    subtotal: 2746, discount: 0, insurance: 0, recyclingUnitPrice: 0, total: 2746,
  });
});

test('整单减免与九折使用单一优惠模式', () => {
  assert.equal(calculateQuote(quote({ discountType: 'amount', discountValue: 200 })).total, 2546);
  const result = calculateQuote(quote({ discountType: 'percent', discountValue: 90 }));
  assert.equal(result.total, 2471.4);
  assert.equal(result.discount, 274.6);
});

test('非法优惠与超额减免服务端拒绝', () => {
  assert.throws(() => quote({ discountType: 'percent', discountValue: 101 }));
  assert.throws(() => quote({ discountType: 'amount', discountValue: 2746.01 }));
  assert.equal(calculateQuote(quote({ discountType: 'amount', discountValue: 2746 })).total, 0);
});

test('黄金回收只乘0.99，Pt950只乘0.94，不再乘0.95', () => {
  const gold = calculateQuote(quote({ type: 'recycling', material: 'gold', recyclingCoefficient: 0.99 }));
  const platinum = calculateQuote(quote({ type: 'recycling', material: 'platinum', recyclingCoefficient: 0.94 }));
  assert.equal(gold.recyclingUnitPrice, 445.5);
  assert.equal(gold.total, 1425.6);
  assert.equal(platinum.recyclingUnitPrice, 423);
  assert.equal(platinum.total, 1353.6);
  assert.equal(platinum.discount, 0);
  assert.equal(platinum.extras, 0);
});

test('回收按完整参考单价和系数计算，到手金额最后舍入到分', () => {
  const result = calculateQuote(quote({ type: 'recycling', material: 'kgold', weight: 0.125, goldPrice: 123.45, recyclingCoefficient: 0.8765 }));
  assert.equal(result.recyclingUnitPrice, 108.203925);
  assert.equal(result.total, 13.53);
});

test('只允许四种回收材质；每类公司参数独立且不得重复', () => {
  assert.throws(() => quote({ type: 'recycling', material: 'diamond' }));
  const settings = structuredClone(defaultSettings);
  settings.recycling[1].price = 100;
  assert.equal(settingsSchema.parse(settings).recycling[0].price, 450);
  settings.recycling[1].id = 'gold';
  assert.throws(() => settingsSchema.parse(settings));
});

const repairItems = [
  { id: 'resize', categoryId: 'ring-size', name: '指圈调整', mode: 'fixed', quantity: 10, price: 120 },
  { id: 'weld', categoryId: 'welding', name: '焊接', mode: 'count', quantity: 2, price: 80 },
  { id: 'metal', categoryId: 'add-metal', name: '加金操作', mode: 'gram', quantity: 0.5, price: 560 },
];

test('维修固定价忽略数量；按次与按克分别计算，无重复焊接费用', () => {
  const result = calculateQuote(quote({ type: 'repair', weight: 0, repairItems }));
  assert.equal(result.repair, 560);
  assert.equal(result.total, 560);
});

test('保价未勾选时费用为0；默认6%可临时调整', () => {
  assert.equal(defaultSettings.repair.insuranceRate, 6);
  const off = calculateQuote(quote({ type: 'repair', repairItems, insured: false, insuredValue: 5000, insuranceRate: 6 }));
  const on = calculateQuote(quote({ type: 'repair', repairItems, insured: true, insuredValue: 5000, insuranceRate: 6 }));
  const modified = calculateQuote(quote({ type: 'repair', repairItems, insured: true, insuredValue: 5000, insuranceRate: 5 }));
  assert.equal(off.insurance, 0);
  assert.equal(off.total, 560);
  assert.equal(on.insurance, 300);
  assert.equal(on.total, 860);
  assert.equal(modified.total, 810);
});

test('维修项目至少一个；保价必须有客户确认价值', () => {
  assert.throws(() => quote({ type: 'repair', repairItems: [] }));
  assert.throws(() => quote({ type: 'repair', repairItems, insured: true, insuredValue: 0 }));
});

test('按次数量为正整数；按克最多3位小数；金额最多2位', () => {
  assert.throws(() => repairItemSchema.parse({ ...repairItems[1], quantity: 1.5 }));
  assert.throws(() => repairItemSchema.parse({ ...repairItems[1], quantity: 0 }));
  assert.throws(() => repairItemSchema.parse({ ...repairItems[2], quantity: 0.0001 }));
  assert.throws(() => repairItemSchema.parse({ ...repairItems[2], price: 0.001 }));
  assert.throws(() => quote({ weight: 1.2345 }));
});

test('非法数字、负价格、零金重服务端拒绝', () => {
  assert.throws(() => quote({ weight: 0 }));
  assert.throws(() => quote({ goldPrice: -1 }));
  assert.throws(() => quote({ laborPrice: Infinity }));
  assert.throws(() => quote({ recyclingCoefficient: NaN }));
});

test('客户端不能注入owner、版本、合计、品牌或客户快照', () => {
  const validated = quote({ ownerId: 'employee-b', total: 1, version: 999, brand: { name: '伪造品牌' }, customer: { name: '伪造客户' } });
  assert.equal('ownerId' in validated, false);
  assert.equal('total' in validated, false);
  assert.equal('version' in validated, false);
  assert.equal('brand' in validated, false);
  assert.equal('customer' in validated, false);
  assert.equal(calculateQuote(validated).total, 2746);
});

test('员工临时改价和重算不改写公司默认参数或既有输入', () => {
  const defaultsBefore = JSON.stringify(defaultSettings);
  const draft = quote({ goldPrice: 460, laborPrice: 75 });
  const draftBefore = JSON.stringify(draft);
  calculateQuote(draft);
  calculateQuote(quote({ type: 'recycling', material: 'gold', recyclingCoefficient: 0.98 }));
  calculateQuote(quote({ type: 'repair', repairItems, insured: true, insuredValue: 5000, insuranceRate: 5 }));
  assert.equal(JSON.stringify(defaultSettings), defaultsBefore);
  assert.equal(JSON.stringify(draft), draftBefore);
});

test('非法远程图片、SVG和过大图片服务端拒绝', () => {
  assert.throws(() => quote({ image: 'https://example.com/private-photo.jpg' }));
  assert.throws(() => quote({ image: 'data:image/svg+xml;base64,AAA=' }));
  assert.throws(() => quote({ image: 'data:image/png;base64,' + 'A'.repeat(1_500_000) }));
});

'use strict';

// Synthetic text fixtures only. Shapes come from QuoteSnapshot/QuoteTotals and
// server.ts save/normalize code in the frozen source, never from a real DB.
const brand = { name: '虚构测试珠宝', english: 'SYNTHETIC', contact: '', note: '' };
const customer = { id: 'history-customer', name: '虚构历史客户', phone: '' };
const item = (id, title, goldPrice, laborPrice = 0) => ({ id, title, material: '足金', specs: '', image: '', weight: 1, goldPrice, laborPrice, extras: [], quantity: 1 });
function input() {
  return { type: 'sale', customerId: customer.id, title: '虚构历史报价', material: '足金', specs: '', image: '', images: [], weight: 1, goldPrice: 500, laborPrice: 20, extras: [], discountType: 'none', discountValue: 0, recyclingCoefficient: 1, repairItems: [], insured: false, insuredValue: 0, insuranceRate: 6, note: '', paymentMethods: [], customDetails: '', customConfirmations: [], saleItems: [], tradeInItems: [], recyclingItems: [] };
}
function totals(overrides = {}) {
  return { metal: 499.99, labor: 20, extras: 0, repair: 0, subtotal: 519.99, discount: 0, insurance: 0, recyclingUnitPrice: 0, total: 519.99, depreciation: 0, exchangeWeight: 0, additionalWeight: 0, excessWeight: 0, exchangeCredit: 0, balance: 519.99, itemTotals: [], ...overrides };
}
function saved(overrides = {}) {
  return { ...input(), customer, brand, issuedBy: { id: 'history-staff', name: '虚构员工' }, calculation: totals(), ...overrides };
}
function singleItem() {
  return saved({ saleItems: [item('saved-a', '虚构保存款甲', 500, 20)], calculation: totals({ itemTotals: [{ id: 'saved-a', metal: 499.99, labor: 20, extras: 0, subtotal: 519.99, total: 519.99, weight: 1, quantity: 1 }] }) });
}
function discountedMulti() {
  return saved({ discountType: 'amount', discountValue: 20.02, saleItems: [item('saved-a', '虚构保存款甲', 300), item('saved-b', '虚构保存款乙', 220)], calculation: totals({ metal: 520.01, labor: 0, subtotal: 520.01, discount: 20.02, total: 499.99, balance: 499.99, itemTotals: [{ id: 'saved-a', metal: 300.01, labor: 0, extras: 0, subtotal: 300.01, total: 300.01, weight: 1, quantity: 1 }, { id: 'saved-b', metal: 220, labor: 0, extras: 0, subtotal: 220, total: 220, weight: 1, quantity: 1 }] }) });
}
function negativeTradeIn() {
  return saved({ type: 'tradein', discountType: 'amount', discountValue: 19.99, tradeIn: { mode: 'value', oldMaterial: 'gold', oldWeight: 2, depreciationPrice: 20, excessMode: 'recycle', excessGoldPrice: 400, excessCoefficient: 1 }, calculation: totals({ discount: 19.99, total: -200.01, balance: -200.01, exchangeCredit: 700.01, additionalWeight: 1 }) });
}
function legacySingle() {
  // Before newer trade-in/itemized fields, the saved scalar calculation still
  // contained the monetary result; missing optional fields are not a new draft.
  const quote = saved();
  quote.calculation = { metal: 499.99, labor: 20, extras: 0, repair: 0, subtotal: 519.99, discount: 0, insurance: 0, recyclingUnitPrice: 0, total: 519.99 };
  delete quote.saleItems; delete quote.tradeInItems; delete quote.recyclingItems;
  return quote;
}
function record(snapshot) {
  return { id: '22ac6522-74a2-428d-8590-adcdd43b5329', number: 'XS-SYNTHETIC-HISTORY', createdAt: '2026-10-12T12:00:00Z', type: snapshot.type, total: snapshot.calculation.total, totals: snapshot.calculation, snapshot };
}
module.exports = { brand, input, totals, saved, item, singleItem, discountedMulti, negativeTradeIn, legacySingle, record };

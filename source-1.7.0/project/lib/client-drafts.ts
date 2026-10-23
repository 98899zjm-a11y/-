import type { QuoteInput, RecyclingItem, SaleItem } from "./domain";

/** A deliberately empty list must never fall back to the old single-item price. */
export function hasEmptyProductList(q: QuoteInput): boolean {
  return q.type === "sale" ? Array.isArray(q.saleItems) && q.saleItems.length === 0 : q.type === "recycling" ? Array.isArray(q.recyclingItems) && q.recyclingItems.length === 0 : q.type === "tradein" ? Array.isArray(q.tradeInItems) && q.tradeInItems.length === 0 : false;
}
export function clearLegacyProductFields<T extends QuoteInput>(q: T): T {
  return { ...q, weight: 0, goldPrice: 0, laborPrice: 0, extras: [], material: "", specs: "", image: "", images: [], recyclingCoefficient: 1 };
}
/** Migrate only a missing list; an explicit [] is a user's empty draft. */
export function ensureProductItems<T extends QuoteInput>(q: T, makeId: () => string): T {
  if (hasEmptyProductList(q)) return clearLegacyProductFields(q);
  if (q.type === "sale" && !Array.isArray(q.saleItems)) {
    const item: SaleItem = { id: makeId(), title: q.title || "珠宝商品", material: q.material, specs: q.specs, image: q.image === "/ring.jpg" ? "" : q.image, weight: q.weight, goldPrice: q.goldPrice, laborPrice: q.laborPrice, extras: q.extras.map(extra => ({ ...extra })), quantity: 1 };
    return { ...q, saleItems: [item] };
  }
  if (q.type === "tradein" && !Array.isArray(q.tradeInItems)) {
    const item: SaleItem = { id: makeId(), title: q.title || "换新商品", material: q.material, specs: q.specs, image: q.image === "/ring.jpg" ? "" : q.image, weight: q.weight, goldPrice: q.goldPrice, laborPrice: q.laborPrice, extras: q.extras.map(extra => ({ ...extra })), quantity: 1 };
    return { ...q, tradeInItems: [item] };
  }
  if (q.type === "recycling" && !Array.isArray(q.recyclingItems)) {
    const item: RecyclingItem = { id: makeId(), title: q.title || "回收物品", material: ["gold", "platinum", "silver", "kgold"].includes(q.material) ? q.material as RecyclingItem["material"] : "gold", specs: q.specs, image: q.image === "/ring.jpg" ? "" : q.image, weight: q.weight, goldPrice: q.goldPrice, recyclingCoefficient: q.recyclingCoefficient };
    return { ...q, recyclingItems: [item] };
  }
  return q;
}
/** Saved old single-item snapshots sometimes contain parser-default [] lists. */
export function restoreSavedProductItems<T extends QuoteInput>(q: T, makeId: () => string): T {
  if (q.type === "sale" && Array.isArray(q.saleItems) && !q.saleItems.length && q.weight > 0) return ensureProductItems({ ...q, saleItems: undefined }, makeId);
  if (q.type === "recycling" && Array.isArray(q.recyclingItems) && !q.recyclingItems.length && q.weight > 0) return ensureProductItems({ ...q, recyclingItems: undefined }, makeId);
  if (q.type === "tradein" && Array.isArray(q.tradeInItems) && !q.tradeInItems.length && q.weight > 0) return ensureProductItems({ ...q, tradeInItems: undefined }, makeId);
  return ensureProductItems(q, makeId);
}
export function removeProductById<T extends QuoteInput>(q: T, id: string, activeIndex: number): { draft: T; activeIndex: number } {
  const items = q.type === "sale" ? q.saleItems || [] : q.type === "recycling" ? q.recyclingItems || [] : q.type === "tradein" ? q.tradeInItems || [] : [];
  const removedIndex = items.findIndex(item => item.id === id);
  if (removedIndex < 0) return { draft: q, activeIndex };
  const activeId = items[Math.max(0, Math.min(activeIndex, items.length - 1))]?.id;
  const next = items.filter(item => item.id !== id);
  const retainedIndex = next.findIndex(item => item.id === activeId);
  const nextActive = retainedIndex >= 0 ? retainedIndex : Math.min(removedIndex, Math.max(0, next.length - 1));
  const draft = q.type === "sale" ? { ...q, saleItems: next as SaleItem[] } : q.type === "tradein" ? { ...q, tradeInItems: next as SaleItem[] } : { ...q, recyclingItems: next as RecyclingItem[] };
  return { draft: next.length ? draft as T : clearLegacyProductFields(draft as T), activeIndex: nextActive };
}

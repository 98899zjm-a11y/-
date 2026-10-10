import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import ts from "typescript";
// @ts-ignore Native Node TypeScript imports require explicit extensions.
import { defaultSettings, homeImageSchema, mergeSettings, quoteInputSchema, calculateQuote, type QuoteInput } from "../lib/domain.ts";

test("首页旧设置补齐默认图片，不覆盖已保存收费与文本", () => {
  const old = { ...defaultSettings, sale: { goldPrice: 622, laborPrice: 45 }, home: { headline: "原首页", introduction: "原介绍", announcements: "原公告", notices: "原注意事项", workflow: "原流程" } };
  const upgraded = mergeSettings(old);
  assert.equal(upgraded.home.image, "/home-necklace.png");
  assert.equal(upgraded.home.headline, "原首页"); assert.equal(upgraded.sale.goldPrice, 622);
  for (const value of ["/home-necklace.png", "/ring.jpg", "/api/images/00000000-0000-0000-0000-000000000001"]) assert.doesNotThrow(() => homeImageSchema.parse(value));
  for (const value of ["https://remote.invalid/image.png", "javascript:alert(1)", "/outside.png", "data:image/svg+xml;base64,PHN2Zz4="]) assert.equal(homeImageSchema.safeParse(value).success, false);
});
test("报价业务拒绝跨类型商品数组，旧单缺省数组仍兼容", () => {
  const original = { type: "custom", customerId: "one", title: "定制", material: "Pt950", weight: 1, goldPrice: 100, laborPrice: 1 };
  assert.doesNotThrow(() => quoteInputSchema.parse(original));
  const item = { id: "item", title: "戒指", material: "Pt950", weight: 1, goldPrice: 100, laborPrice: 1, extras: [], quantity: 1 };
  assert.equal(quoteInputSchema.safeParse({ ...original, saleItems: [item] }).success, false);
  const recovery = { id: "recovery", title: "旧金", material: "gold", weight: 1, goldPrice: 100, recyclingCoefficient: 0.99 };
  assert.equal(quoteInputSchema.safeParse({ ...original, type: "sale", recyclingItems: [recovery] }).success, false);
  assert.equal(quoteInputSchema.safeParse({ ...original, type: "recycling", material: "gold", saleItems: [item] }).success, false);
});
test("单件定制与换新费用明细按分相加等于原公式合计", () => {
  const base = { type: "custom", customerId: "one", title: "定制", material: "Pt950", weight: 1.005, goldPrice: 1, laborPrice: 1, extras: [] };
  const cases = [base, { ...base, type: "tradein", weight: 0.01, laborPrice: 0, tradeIn: { mode: "gram", oldWeight: 0.005, depreciationPrice: 1 } }, { ...base, type: "tradein", tradeIn: { mode: "value", oldWeight: 3, excessGoldPrice: 1, excessCoefficient: 1 } }];
  for (const value of cases) {
    const totals = calculateQuote(quoteInputSchema.parse(value) as QuoteInput);
    assert.equal(Math.round((totals.metal + totals.labor + totals.depreciation + totals.extras) * 100), Math.round(totals.subtotal * 100));
    assert.ok(totals.metal >= 0 && totals.labor >= 0 && totals.depreciation >= 0);
    assert.equal(Math.round(totals.balance * 100), Math.round((totals.subtotal - totals.discount - totals.exchangeCredit) * 100));
  }
  assert.equal(calculateQuote(quoteInputSchema.parse(base)).subtotal, 2.01);
  assert.equal(calculateQuote(quoteInputSchema.parse(cases[2])).balance, -0.99);
});

test("真实SQLite：首页图片确认保存、共享读取、历史引用与权限", async () => {
  const sqlite = new DatabaseSync(":memory:");
  for (const name of readdirSync(resolve("drizzle")).filter(name => name.endsWith(".sql")).sort()) sqlite.exec(readFileSync(resolve("drizzle", name), "utf8"));
  const db = {
    prepare(sql: string) { let values: (string | number | null)[] = []; return { bind(...bindings: (string | number | null)[]) { values = bindings; return this; }, async first() { return sqlite.prepare(sql).get(...values) || null; }, async all() { return { results: sqlite.prepare(sql).all(...values) }; }, async run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }; } }; },
    async batch(statements: { run(): Promise<unknown> }[]) { sqlite.exec("BEGIN"); try { const rows = []; for (const statement of statements) rows.push(await statement.run()); sqlite.exec("COMMIT"); return rows; } catch (error) { sqlite.exec("ROLLBACK"); throw error; } },
  };
  type Stored = { body: Uint8Array; httpMetadata?: { contentType: string }; customMetadata: Record<string, string> };
  const objects = new Map<string, Stored>();
  const storage = { async put(key: string, body: Uint8Array, options: Omit<Stored, "body">) { objects.set(key, { body, ...options }); }, async head(key: string) { return objects.get(key) || null; }, async get(key: string) { return objects.get(key) || null; }, async delete(key: string) { objects.delete(key); } };
  const context = { env: { DB: db, BUCKET: storage }, identity: { userId: "home-admin", email: "home-admin@test.invalid", displayName: "管理员" } };
  const key = "__jewelryHomeRegression"; (globalThis as unknown as Record<string, unknown>)[key] = context;
  let source = readFileSync(resolve("lib/server.ts"), "utf8");
  source = source.replace('import { env } from "cloudflare:workers";', `const { env } = globalThis.${key};`).replace('import { getChatGPTUser } from "@/app/chatgpt-auth";', `const getChatGPTUser = async () => globalThis.${key}.identity;`).replace('from "./domain";', `from ${JSON.stringify(pathToFileURL(resolve("lib/domain.ts")).href)};`).replace('from "zod";', `from ${JSON.stringify(import.meta.resolve("zod"))};`);
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const api = await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));
  const request = (value: unknown) => new Request("https://jewelry.test/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json", Origin: "https://jewelry.test" }, body: JSON.stringify(value) });
  const png = "data:image/png;base64," + Buffer.from([137,80,78,71,13,10,26,10,...Array(24).fill(0)]).toString("base64");
  try {
    await api.bootstrap(); await api.inviteUser(request({ email: "home-staff@test.invalid", name: "员工" }));
    const before = await api.bootstrap(); assert.equal(before.settings.home.image, "/home-necklace.png"); assert.equal(objects.size, 0);
    const first = await api.updateSettings(request({ home: { image: png } }));
    assert.equal(first.settings.sale.goldPrice, before.settings.sale.goldPrice); assert.equal(first.settings.home.headline, before.settings.home.headline);
    assert.match(first.settings.home.image, /^\/api\/images\//); assert.equal(objects.size, 1);
    const firstId = first.settings.home.image.split("/").pop();
    context.identity = { userId: "home-staff", email: "home-staff@test.invalid", displayName: "员工" };
    assert.equal((await api.getImage(firstId)).headers.get("Content-Type"), "image/png");
    await assert.rejects(() => api.updateSettings(request({ home: { image: "/ring.jpg" } })), (error: unknown) => error instanceof api.ApiError && (error as { status: number }).status === 403);
    context.identity = { userId: "home-admin", email: "home-admin@test.invalid", displayName: "管理员" };
    await api.updateSettings(request({ home: { image: "/home-necklace.png", announcements: "更新公告" } }));
    context.identity = { userId: "home-staff", email: "home-staff@test.invalid", displayName: "员工" };
    assert.equal((await api.getImage(firstId)).status, 200, "旧首页图仍共享，字节保留");
    assert.equal(objects.size, 1);
    context.identity = { userId: "home-admin", email: "home-admin@test.invalid", displayName: "管理员" };
    const invalid = await api.api(() => api.updateSettings(request({ home: { image: "https://evil.invalid/image.png" } })));
    assert.equal(invalid.status, 400); assert.equal((await api.bootstrap()).settings.home.image, "/home-necklace.png");
  } finally { sqlite.close(); delete (globalThis as unknown as Record<string, unknown>)[key]; }
});

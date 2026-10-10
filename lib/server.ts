import { env } from "cloudflare:workers";
import { z } from "zod";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import {
  type StaffUser, type Customer, type Settings, type Style, type QuoteRecord,
  type QuoteSnapshot, type QuoteTotals, type AuditLog, type Bootstrap, type PaymentMethod, type MediaAsset,
  calculateQuote, canAccessOwned, canManage, defaultSettings, quoteInputSchema,
  customerInputSchema, settingsSchema, styleInputSchema, inviteSchema, userPatchSchema, paymentMethodsSchema, mergeSettings, defaultTradeIn, quoteTypes, imageSchema,
} from "./domain";

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
type Row = Record<string, unknown>;
const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
function database(): D1Database { if (!env.DB) throw new ApiError(503, "数据库尚未连接，请完成部署配置"); return env.DB; }
function bucket(): R2Bucket { if (!env.BUCKET) throw new ApiError(503, "图片存储尚未连接，请完成部署配置"); return env.BUCKET; }
function parse<T>(value: unknown): T { return JSON.parse(String(value)) as T; }
function userRecord(row: Row): StaffUser { return { id: String(row.id), userId: row.user_id ? String(row.user_id) : null, email: String(row.email), name: String(row.name), role: row.role === "admin" ? "admin" : "employee", active: Boolean(row.active), createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; }
function customerRecord(row: Row): Customer { return { id: String(row.id), name: String(row.name), phone: String(row.phone), notes: String(row.notes), ownerId: String(row.owner_id), createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; }
function styleRecord(row: Row): Style { return { ...parse<Omit<Style, "id" | "createdAt" | "updatedAt">>(row.data), id: String(row.id), active: Boolean(row.active), createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; }
function mediaRecord(row: Row): MediaAsset { return { id: String(row.id), name: String(row.name), category: String(row.category), url: String(row.url), ownerId: String(row.owner_id), ownerName: String(row.owner_name), createdAt: String(row.created_at), active: Boolean(row.active) }; }
function normalizeTotals(value: Partial<QuoteTotals>, total: number): QuoteTotals { return { metal: 0, labor: 0, extras: 0, repair: 0, subtotal: 0, discount: 0, insurance: 0, recyclingUnitPrice: 0, depreciation: 0, exchangeWeight: 0, additionalWeight: 0, excessWeight: 0, exchangeCredit: 0, ...value, total, balance: value.balance ?? total, itemTotals: value.itemTotals ?? [] }; }
function quoteRecord(row: Row, full = true): QuoteRecord {
  const original = parse<QuoteSnapshot>(row.snapshot), total = Number(row.total_cents) / 100;
  const snapshot: QuoteSnapshot = { ...original, paymentMethods: original.paymentMethods ?? [], customDetails: original.customDetails ?? "", tradeIn: { ...defaultTradeIn, ...original.tradeIn }, calculation: normalizeTotals(original.calculation ?? {}, total) };
  if (!full) { snapshot.image = ""; snapshot.images = []; }
  return { id: String(row.id), number: String(row.number), type: row.type as QuoteRecord["type"], customerId: String(row.customer_id), customerName: String(row.customer_name), ownerId: String(row.owner_id), title: String(row.title), snapshot, data: snapshot, totals: normalizeTotals(parse<QuoteTotals>(row.totals), total), total, rootId: String(row.root_id), baseQuoteId: row.base_quote_id ? String(row.base_quote_id) : null, version: Number(row.version), createdAt: String(row.created_at), images: row.attached_images ? parse<string[]>(row.attached_images) : [] };
}
function auditRecord(row: Row): AuditLog { return { id: String(row.id), entityType: String(row.entity_type), entityId: String(row.entity_id), action: String(row.action), actorId: String(row.actor_id), actorName: String(row.actor_name), oldValue: row.old_value ? parse(row.old_value) : null, newValue: row.new_value ? parse(row.new_value) : null, createdAt: String(row.created_at) }; }
function logStatement(db: D1Database, user: StaffUser, entityType: string, entityId: string, action: string, oldValue: unknown, newValue: unknown, onlyIfChanged = false) {
  return db.prepare("INSERT INTO audit_logs(id,entity_type,entity_id,action,actor_id,actor_name,old_value,new_value,created_at) " + (onlyIfChanged ? "SELECT ?,?,?,?,?,?,?,?,? WHERE changes()>0" : "VALUES (?,?,?,?,?,?,?,?,?)")).bind(uid(), entityType, entityId, action, user.id, user.name, oldValue === null ? null : JSON.stringify(oldValue), newValue === null ? null : JSON.stringify(newValue), now());
}

export async function authenticated(): Promise<{ db: D1Database; user: StaffUser }> {
  const identity = await getChatGPTUser();
  if (!identity) throw new ApiError(401, "请先使用ChatGPT账号登录");
  const db = database();
  const email = identity.email.trim().toLowerCase();
  let row = await db.prepare("SELECT * FROM staff_users WHERE user_id=?").bind(identity.userId).first<Row>();
  if (!row) {
    const id = uid(), time = now();
    // The conditional insert is a single atomic D1 write. Only the first request can find no users.
    await db.prepare("INSERT OR IGNORE INTO staff_users(id,user_id,email,name,role,active,created_at,updated_at) SELECT ?,?,?,?,'admin',1,?,? WHERE NOT EXISTS(SELECT 1 FROM staff_users)").bind(id, identity.userId, email, identity.displayName, time, time).run();
    row = await db.prepare("SELECT * FROM staff_users WHERE user_id=?").bind(identity.userId).first<Row>();
  }
  if (!row) {
    await db.prepare("UPDATE staff_users SET user_id=?,updated_at=? WHERE email=? AND user_id IS NULL AND active=1").bind(identity.userId, now(), email).run();
    row = await db.prepare("SELECT * FROM staff_users WHERE user_id=?").bind(identity.userId).first<Row>();
  }
  if (!row || !row.active) throw new ApiError(403, "此账号尚未获邀请或已停用，请联系管理员");
  const user = userRecord(row);
  await db.prepare("INSERT OR IGNORE INTO company_settings(id,data,updated_by,updated_at) VALUES('default',?,?,?)").bind(JSON.stringify(defaultSettings), user.id, now()).run();
  return { db, user };
}
export function assertAdmin(user: StaffUser) { if (!canManage(user)) throw new ApiError(403, "只有管理员可以执行此操作"); }
export function assertOwner(user: StaffUser, ownerId: string) { if (!canAccessOwned(user, ownerId)) throw new ApiError(404, "记录不存在或无权访问"); }
export async function body(request: Request, limit = 3_000_000): Promise<unknown> {
  const origin = request.headers.get("origin");
  if (origin && new URL(request.url).origin !== origin) throw new ApiError(403, "请求来源无效");
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > limit) throw new ApiError(413, "内容过大，请压缩图片后重试");
  const value = await request.text();
  if (new TextEncoder().encode(value).byteLength > limit) throw new ApiError(413, "内容过大，请压缩图片后重试");
  try { return JSON.parse(value); } catch { throw new ApiError(400, "请求内容格式无效"); }
}
export async function api(action: () => Promise<unknown>, status = 200): Promise<Response> {
  try { const result = await action(); return result instanceof Response ? result : Response.json(result, { status, headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) {
    if (error instanceof ApiError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof z.ZodError) return Response.json({ error: error.issues[0]?.message || "输入无效", issues: error.issues.map(issue => ({ field: issue.path.join("."), message: issue.message })) }, { status: 400 });
    console.error("Jewelry API request failed", error instanceof Error ? error.message : "Unknown error");
    return Response.json({ error: "操作未完成，请重试或联系管理员" }, { status: 500 });
  }
}
async function getSettings(db: D1Database): Promise<Settings> { const row = await db.prepare("SELECT data FROM company_settings WHERE id='default'").first<Row>(); return mergeSettings(row ? parse<unknown>(row.data) : null); }
async function readPreferences(db: D1Database, user: StaffUser, settings?: Settings): Promise<{ paymentMethods: PaymentMethod[]; inherited: boolean }> {
  const row = await db.prepare("SELECT payment_methods FROM staff_preferences WHERE staff_id=?").bind(user.id).first<Row>();
  return row ? { paymentMethods: parse<PaymentMethod[]>(row.payment_methods), inherited: false } : { paymentMethods: structuredClone((settings ?? await getSettings(db)).paymentMethods), inherited: true };
}
export async function getPreferences() { const { db, user } = await authenticated(); return readPreferences(db, user); }
export async function updatePreferences(request: Request) {
  const { db, user } = await authenticated(), { paymentMethods } = z.object({ paymentMethods: paymentMethodsSchema.nullable() }).parse(await body(request, 13_000_000));
  const old = await db.prepare("SELECT payment_methods FROM staff_preferences WHERE staff_id=?").bind(user.id).first<Row>();
  if (paymentMethods === null) {
    if (old) {
      const result = await db.batch([db.prepare("DELETE FROM staff_preferences WHERE staff_id=? AND payment_methods=?").bind(user.id, String(old.payment_methods)), logStatement(db, user, "preferences", user.id, "use-company-default", { paymentMethods: parse(old.payment_methods) }, null, true)]);
      if (!result[0].meta.changes) throw new ApiError(409, "个人收款方式刚被修改，请刷新后重试");
    }
    return readPreferences(db, user);
  }
  await assertImagesOwned(user, paymentMethods.map(item => item.image));
  const stored = await persistImages(paymentMethods.map(item => item.image), user.id);
  const methods = paymentMethods.map((item, index) => ({ ...item, image: stored.urls[index] })), data = JSON.stringify(methods), time = now();
  try {
    const write = old ? db.prepare("UPDATE staff_preferences SET payment_methods=?,updated_at=? WHERE staff_id=? AND payment_methods=?").bind(data, time, user.id, String(old.payment_methods)) : db.prepare("INSERT INTO staff_preferences(staff_id,payment_methods,updated_at) SELECT ?,?,? WHERE NOT EXISTS(SELECT 1 FROM staff_preferences WHERE staff_id=?)").bind(user.id, data, time, user.id);
    const result = await db.batch([write, logStatement(db, user, "preferences", user.id, "update", old ? { paymentMethods: parse(old.payment_methods) } : null, { paymentMethods: methods }, true)]);
    if (!result[0].meta.changes) throw new ApiError(409, "个人收款方式刚被修改，请刷新后重试");
    return { paymentMethods: methods, inherited: false };
  } catch (error) { await cleanupImages(stored.keys); throw error; }
}
const SUMMARY_SNAPSHOT = "json_set(q.snapshot,'$.image','','$.images',json('[]'),'$.paymentMethods',json((SELECT json_group_array(json_set(p.value,'$.image','')) FROM json_each(q.snapshot,'$.paymentMethods') p)),'$.saleItems',json((SELECT json_group_array(json_set(s.value,'$.image','')) FROM json_each(q.snapshot,'$.saleItems') s)),'$.recyclingItems',json((SELECT json_group_array(json_set(r.value,'$.image','')) FROM json_each(q.snapshot,'$.recyclingItems') r)))";
async function customerById(db: D1Database, user: StaffUser, id: string): Promise<Customer> { const row = await db.prepare("SELECT * FROM customers WHERE id=?").bind(id).first<Row>(); if (!row) throw new ApiError(404, "客户不存在"); const customer = customerRecord(row); assertOwner(user, customer.ownerId); return customer; }
const QUOTE_SELECT = "SELECT q.*,a.images AS attached_images FROM quotes q LEFT JOIN quote_attachments a ON a.quote_id=q.id";
async function quoteById(db: D1Database, user: StaffUser, id: string): Promise<QuoteRecord> { const row = await db.prepare(QUOTE_SELECT + " WHERE q.id=?").bind(id).first<Row>(); if (!row) throw new ApiError(404, "报价不存在"); const quote = quoteRecord(row); assertOwner(user, quote.ownerId); return quote; }
export async function listQuotes(db: D1Database, user: StaffUser): Promise<QuoteRecord[]> {
  // Extract all small JSON fields but omit embedded photographs before loading rows into the Worker.
  const fields = `q.id,q.number,q.type,q.customer_id,q.customer_name,q.owner_id,q.title,${SUMMARY_SNAPSHOT} AS snapshot,q.totals,q.total_cents,q.root_id,q.base_quote_id,q.version,q.created_at,a.images AS attached_images`;
  const query = `SELECT ${fields} FROM quotes q LEFT JOIN quote_attachments a ON a.quote_id=q.id${user.role === "admin" ? "" : " WHERE q.owner_id=?"} ORDER BY q.created_at DESC,q.id DESC LIMIT 200`;
  const rows = await (user.role === "admin" ? db.prepare(query) : db.prepare(query).bind(user.id)).all<Row>();
  return (rows.results || []).map(row => quoteRecord(row, false));
}
export async function quotePage(request: Request) {
  const { db, user } = await authenticated();
  const params = new URL(request.url).searchParams;
  if (!params.toString()) return { quotes: await listQuotes(db, user) };
  const filter = z.object({
    search: z.string().trim().max(120).default(""), type: z.enum(["all", ...quoteTypes]).default("all"),
    date: z.string().default("").refine(value => value === "" || /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(value + "T00:00:00Z").getTime()) && new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value, "日期格式应为YYYY-MM-DD"),
    page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(50),
    customerId: z.string().max(100).optional(),
  }).parse(Object.fromEntries(params));
  const where: string[] = [], args: (string | number)[] = [];
  if (user.role !== "admin") { where.push("q.owner_id=?"); args.push(user.id); }
  if (filter.customerId) { await customerById(db, user, filter.customerId); where.push("q.customer_id=?"); args.push(filter.customerId); }
  if (filter.type !== "all") { where.push("q.type=?"); args.push(filter.type); }
  if (filter.search) { where.push("(instr(lower(q.title),lower(?))>0 OR instr(lower(q.customer_name),lower(?))>0 OR instr(lower(q.number),lower(?))>0)"); args.push(filter.search, filter.search, filter.search); }
  if (filter.date) {
    const start = new Date(filter.date + "T00:00:00+08:00");
    where.push("q.created_at>=? AND q.created_at<?"); args.push(start.toISOString(), new Date(start.getTime() + 86_400_000).toISOString());
  }
  const clause = where.length ? " WHERE " + where.join(" AND ") : "";
  const totalRow = await db.prepare("SELECT COUNT(*) AS total FROM quotes q" + clause).bind(...args).first<Row>();
  const fields = `q.id,q.number,q.type,q.customer_id,q.customer_name,q.owner_id,q.title,${SUMMARY_SNAPSHOT} AS snapshot,q.totals,q.total_cents,q.root_id,q.base_quote_id,q.version,q.created_at,a.images AS attached_images`;
  const rows = await db.prepare("SELECT " + fields + " FROM quotes q LEFT JOIN quote_attachments a ON a.quote_id=q.id" + clause + " ORDER BY q.created_at DESC,q.id DESC LIMIT ? OFFSET ?").bind(...args, filter.pageSize, (filter.page - 1) * filter.pageSize).all<Row>();
  return { quotes: rows.results.map(row => quoteRecord(row, false)), total: Number(totalRow?.total || 0), page: filter.page, pageSize: filter.pageSize };
}
export async function bootstrap(): Promise<Bootstrap> {
  const { db, user } = await authenticated();
  const customerQuery = user.role === "admin" ? db.prepare("SELECT * FROM customers ORDER BY updated_at DESC LIMIT 1000") : db.prepare("SELECT * FROM customers WHERE owner_id=? ORDER BY updated_at DESC LIMIT 1000").bind(user.id);
  const [settings, styleRows, customerRows, quotes, users, mediaRows] = await Promise.all([
    getSettings(db), db.prepare(`SELECT * FROM styles${user.role === "admin" ? "" : " WHERE active=1"} ORDER BY updated_at DESC LIMIT 300`).all<Row>(),
    customerQuery.all<Row>(), listQuotes(db, user), user.role === "admin" ? db.prepare("SELECT * FROM staff_users ORDER BY created_at").all<Row>() : Promise.resolve({ results: [] as Row[] }), (user.role === "admin" ? db.prepare("SELECT * FROM media_assets ORDER BY created_at DESC,id DESC LIMIT 1000") : db.prepare("SELECT * FROM media_assets WHERE active=1 OR owner_id=? ORDER BY created_at DESC,id DESC LIMIT 1000").bind(user.id)).all<Row>(),
  ]);
  const preference = await readPreferences(db, user, settings);
  return { user, settings, styles: styleRows.results.map(styleRecord), customers: customerRows.results.map(customerRecord), quotes, users: users.results.map(userRecord), media: mediaRows.results.map(mediaRecord), paymentMethods: preference.paymentMethods };
}
export const getBootstrap = bootstrap;
export async function createCustomer(request: Request) {
  const { db, user } = await authenticated(), input = customerInputSchema.parse(await body(request));
  const time = now(), customer: Customer = { id: uid(), ...input, ownerId: user.id, createdAt: time, updatedAt: time };
  await db.batch([db.prepare("INSERT INTO customers(id,name,phone,notes,owner_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").bind(customer.id, customer.name, customer.phone, customer.notes, customer.ownerId, time, time), logStatement(db, user, "customer", customer.id, "create", null, customer)]);
  return { customer };
}
export async function updateCustomer(request: Request) {
  const { db, user } = await authenticated(), value = await body(request), input = z.object({ id: z.string().min(1) }).parse(value);
  const old = await customerById(db, user, input.id), patch = customerInputSchema.partial().parse(value), customer = { ...old, ...patch, updatedAt: now() };
  const result = await db.batch([db.prepare("UPDATE customers SET name=?,phone=?,notes=?,updated_at=? WHERE id=? AND name=? AND phone=? AND notes=?").bind(customer.name, customer.phone, customer.notes, customer.updatedAt, customer.id, old.name, old.phone, old.notes), logStatement(db, user, "customer", customer.id, "update", old, customer, true)]);
  if (!result[0].meta.changes) throw new ApiError(409, "客户资料刚被修改，请刷新后重试");
  return { customer };
}
async function canReadImage(user: StaffUser, image: string, ownerId: string): Promise<boolean> {
  if (canAccessOwned(user, ownerId)) return true;
  // Shared media is permanent: retiring an asset removes it from the picker, not from saved quotations.
  const sharedMedia = await database().prepare("SELECT id FROM media_assets WHERE url=? LIMIT 1").bind(image).first();
  if (sharedMedia) return true;
  const companyPayment = await database().prepare("SELECT id FROM company_settings WHERE EXISTS(SELECT 1 FROM json_each(data,'$.paymentMethods') p WHERE json_extract(p.value,'$.image')=?) LIMIT 1").bind(image).first();
  if (companyPayment) return true;
  const ownPreference = await database().prepare("SELECT staff_id FROM staff_preferences WHERE staff_id=? AND EXISTS(SELECT 1 FROM json_each(payment_methods) p WHERE json_extract(p.value,'$.image')=?) LIMIT 1").bind(user.id, image).first();
  if (ownPreference) return true;
  const sharedStyle = await database().prepare("SELECT id FROM styles WHERE active=1 AND json_extract(data,'$.image')=? LIMIT 1").bind(image).first();
  if (sharedStyle) return true;
  // A style may later be retired. A photograph already frozen into this employee's quote remains readable.
  const historicalQuote = await database().prepare("SELECT id FROM quotes WHERE owner_id=? AND (json_extract(snapshot,'$.image')=? OR EXISTS(SELECT 1 FROM json_each(snapshot,'$.paymentMethods') p WHERE json_extract(p.value,'$.image')=?) OR EXISTS(SELECT 1 FROM json_each(snapshot,'$.saleItems') p WHERE json_extract(p.value,'$.image')=?) OR EXISTS(SELECT 1 FROM json_each(snapshot,'$.recyclingItems') p WHERE json_extract(p.value,'$.image')=?)) LIMIT 1").bind(user.id, image, image, image, image).first();
  return Boolean(historicalQuote);
}
async function assertImagesOwned(user: StaffUser, images: string[]) {
  for (const image of images.filter(value => value.startsWith("/api/images/"))) {
    const object = await bucket().head("images/" + image.split("/").pop());
    if (!object) throw new ApiError(400, "图片不存在");
    if (!(await canReadImage(user, image, object.customMetadata?.ownerId || ""))) throw new ApiError(404, "图片不存在或无权访问");
  }
}
function decodePhoto(image: string): { bytes: Uint8Array; contentType: string } {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(image);
  if (!match || image.length > 1_500_000) throw new ApiError(400, "请上传PNG、JPEG或WebP图片，压缩后的图片不超过1.5MB");
  let raw: string; try { raw = atob(match[2]); } catch { throw new ApiError(400, "图片编码无效"); }
  const bytes = Uint8Array.from(raw, character => character.charCodeAt(0));
  const valid = match[1] === "image/png" ? bytes.length >= 24 && [137,80,78,71,13,10,26,10].every((byte, index) => bytes[index] === byte) : match[1] === "image/jpeg" ? bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 : bytes.length >= 12 && String.fromCharCode(...bytes.slice(0,4)) === "RIFF" && String.fromCharCode(...bytes.slice(8,12)) === "WEBP";
  if (!valid) throw new ApiError(400, "图片格式与内容不符，请重新上传");
  return { bytes, contentType: match[1] };
}
async function cleanupImages(keys: string[]) { if (keys.length) await Promise.allSettled(keys.map(key => bucket().delete(key))); }
async function persistImages(images: string[], ownerId: string): Promise<{ urls: string[]; keys: string[] }> {
  const map = new Map<string, string>(), keys: string[] = [];
  try {
    const urls: string[] = [];
    for (const source of images) {
      if (!source.startsWith("data:")) { urls.push(source); continue; }
      const known = map.get(source); if (known) { urls.push(known); continue; }
      const { bytes, contentType } = decodePhoto(source), id = uid(), key = "images/" + id, url = "/api/images/" + id;
      await bucket().put(key, bytes, { httpMetadata: { contentType }, customMetadata: { ownerId } });
      keys.push(key); map.set(source, url); urls.push(url);
    }
    return { urls, keys };
  } catch (error) { await cleanupImages(keys); throw error; }
}
export async function getMedia() {
  const { db, user } = await authenticated();
  const rows = await (user.role === "admin" ? db.prepare("SELECT * FROM media_assets ORDER BY created_at DESC,id DESC LIMIT 1000") : db.prepare("SELECT * FROM media_assets WHERE active=1 OR owner_id=? ORDER BY created_at DESC,id DESC LIMIT 1000").bind(user.id)).all<Row>();
  return { media: rows.results.map(mediaRecord) };
}
export async function createMedia(request: Request) {
  const { db, user } = await authenticated(), input = z.object({ name: z.string().trim().min(1).max(120).default("素材图片"), category: z.string().trim().min(1).max(80).default("商品照片"), image: imageSchema.refine(value => value.startsWith("data:"), "请上传图片文件") }).parse(await body(request));
  const { bytes, contentType } = decodePhoto(input.image), id = uid(), url = "/api/images/" + id, key = "images/" + id;
  const asset: MediaAsset = { id, name: input.name, category: input.category, url, ownerId: user.id, ownerName: user.name, createdAt: now(), active: true };
  await bucket().put(key, bytes, { httpMetadata: { contentType }, customMetadata: { ownerId: user.id, mediaId: id } });
  try {
    await db.batch([db.prepare("INSERT INTO media_assets(id,name,category,url,owner_id,owner_name,created_at,active) VALUES(?,?,?,?,?,?,?,1)").bind(id, asset.name, asset.category, url, user.id, user.name, asset.createdAt), logStatement(db, user, "media", id, "upload", null, asset)]);
    return { asset };
  } catch (error) { await cleanupImages([key]); throw error; }
}
export async function updateMedia(request: Request) {
  const { db, user } = await authenticated(), input = z.object({ id: z.string().min(1).max(100), name: z.string().trim().min(1).max(120).optional(), category: z.string().trim().min(1).max(80).optional(), active: z.boolean().optional() }).parse(await body(request));
  const row = await db.prepare("SELECT * FROM media_assets WHERE id=?").bind(input.id).first<Row>(); if (!row) throw new ApiError(404, "素材不存在");
  const old = mediaRecord(row); assertOwner(user, old.ownerId);
  const asset = { ...old, ...input };
  const result = await db.batch([db.prepare("UPDATE media_assets SET name=?,category=?,active=? WHERE id=? AND name=? AND category=? AND active=?").bind(asset.name, asset.category, asset.active ? 1 : 0, asset.id, old.name, old.category, old.active ? 1 : 0), logStatement(db, user, "media", asset.id, "update", old, asset, true)]);
  if (!result[0].meta.changes) throw new ApiError(409, "素材刚被修改，请刷新后重试");
  return { asset };
}
function logSnapshot(quote: QuoteRecord) { const snapshot = { ...quote.snapshot, image: quote.snapshot.image ? "[图片已保存在不可变报价快照]" : "", images: [], paymentMethods: quote.snapshot.paymentMethods?.map(item => ({ ...item, image: item.image.startsWith("data:") ? "[收款图片已保存在不可变报价快照]" : item.image })) ?? [] }; return { id: quote.id, number: quote.number, rootId: quote.rootId, version: quote.version, snapshot, total: quote.total }; }
function priceOverrides(input: QuoteSnapshot, settings: Settings): { field: string; oldValue: number | string | null; newValue: number | string }[] {
  const values: { field: string; oldValue: number | string | null; newValue: number | string }[] = [];
  const compare = (field: string, original: number | string | null, current: number | string) => { if (original !== current) values.push({ field, oldValue: original, newValue: current }); };
  if (["sale", "custom", "tradein"].includes(input.type)) {
    if (input.type === "sale" && input.saleItems?.length) { for (const item of input.saleItems) { compare(`saleItems.${item.id}.goldPrice`, settings.sale.goldPrice, item.goldPrice); compare(`saleItems.${item.id}.laborPrice`, settings.sale.laborPrice, item.laborPrice); } }
    else { compare("goldPrice", settings.sale.goldPrice, input.goldPrice); compare("laborPrice", settings.sale.laborPrice, input.laborPrice); }
    if (input.type === "tradein") {
      const trade = { ...defaultTradeIn, ...input.tradeIn }, metal = settings.recycling.find(value => value.id === trade.oldMaterial);
      if (trade.mode === "gram") compare("tradeIn.depreciationPrice", settings.tradeIn.depreciationPrice, trade.depreciationPrice);
      if (trade.mode === "value" || trade.excessMode === "recycle") { compare("tradeIn.excessGoldPrice", metal?.price ?? null, trade.excessGoldPrice); compare("tradeIn.excessCoefficient", metal?.coefficient ?? null, trade.excessCoefficient); }
    }
  } else if (input.type === "recycling") {
    if (input.recyclingItems?.length) { for (const item of input.recyclingItems) { const metal = settings.recycling.find(value => value.id === item.material); compare(`recyclingItems.${item.id}.goldPrice`, metal?.price ?? null, item.goldPrice); compare(`recyclingItems.${item.id}.recyclingCoefficient`, metal?.coefficient ?? null, item.recyclingCoefficient); } }
    else { const metal = settings.recycling.find(value => value.id === input.material); compare("goldPrice", metal?.price ?? null, input.goldPrice); compare("recyclingCoefficient", metal?.coefficient ?? null, input.recyclingCoefficient); }
  } else {
    for (const item of input.repairItems) {
      const category = settings.repair.categories.find(value => value.id === item.categoryId);
      compare(`repairItems.${item.id}.price`, category?.price ?? null, item.price); compare(`repairItems.${item.id}.mode`, category?.mode ?? null, item.mode);
    }
    if (input.insured) compare("insuranceRate", settings.repair.insuranceRate, input.insuranceRate);
  }
  return values;
}
export async function createQuote(request: Request) {
  const { db, user } = await authenticated(), input = quoteInputSchema.parse(await body(request, 12_000_000));
  const customer = await customerById(db, user, input.customerId), settings = await getSettings(db);
  // Exported customer images are attached once after the authoritative number is allocated.
  if (input.images.length) throw new ApiError(400, "请先保存报价，再生成并保存报价图片");
  const sourceImages = [input.image, ...input.paymentMethods.map(item => item.image), ...input.saleItems.map(item => item.image), ...input.recyclingItems.map(item => item.image)];
  await assertImagesOwned(user, sourceImages);
  const base = input.baseQuoteId ? await quoteById(db, user, input.baseQuoteId) : null;
  if (base && base.type !== input.type) throw new ApiError(400, "报价新版本必须使用原业务类型");
  if (base && base.customerId !== customer.id) throw new ApiError(400, "报价新版本须保留原客户，复制给其他客户请新建报价");
  const totals = calculateQuote(input);
  if (!Number.isFinite(totals.total) || Math.abs(totals.total) > 1_000_000_000 || totals.subtotal > 1_000_000_000 || totals.exchangeCredit > 1_000_000_000) throw new ApiError(400, "报价金额超出支持范围");
  const persisted = await persistImages(sourceImages, base?.ownerId || user.id); let imageIndex = 0;
  input.image = persisted.urls[imageIndex++]; for (const method of input.paymentMethods) method.image = persisted.urls[imageIndex++]; for (const item of input.saleItems) item.image = persisted.urls[imageIndex++]; for (const item of input.recyclingItems) item.image = persisted.urls[imageIndex++];
  const snapshot: QuoteSnapshot = { ...input, customer: { id: customer.id, name: customer.name, phone: customer.phone }, brand: settings.brand, issuedBy: { id: user.id, name: user.name }, calculation: totals, ...(input.type === "recycling" ? { recyclingName: settings.recycling.find(value => value.id === input.material)?.name || input.material } : {}), ...(input.type === "tradein" ? { tradeInMaterialName: settings.recycling.find(value => value.id === input.tradeIn.oldMaterial)?.name || input.tradeIn.oldMaterial } : {}) };
  try {
  for (let attempt = 0; attempt < 3; attempt++) {
    const id = uid(), time = now(), rootId = base?.rootId || id;
    const latest = base ? await db.prepare("SELECT MAX(version) AS version FROM quotes WHERE root_id=?").bind(rootId).first<Row>() : null;
    const version = base ? Number(latest?.version || 0) + 1 : 1;
    const dateParts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(time));
    const businessDate = ["year", "month", "day"].map(part => dateParts.find(value => value.type === part)?.value).join("");
    const prefix = { sale: "S", custom: "C", tradein: "T", repair: "M", recycling: "R" }[input.type];
    const number = `${prefix}${businessDate}-${id.slice(0,8).toUpperCase()}`;
    const quote: QuoteRecord = { id, number, type: input.type, customerId: customer.id, customerName: customer.name, ownerId: base?.ownerId || user.id, title: input.title, snapshot, data: snapshot, totals, total: totals.total, rootId, baseQuoteId: base?.id || null, version, createdAt: time, images: [] };
    try {
      await db.batch([db.prepare("INSERT INTO quotes(id,number,type,customer_id,customer_name,owner_id,title,snapshot,totals,total_cents,root_id,base_quote_id,version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(id, number, input.type, customer.id, customer.name, quote.ownerId, input.title, JSON.stringify(snapshot), JSON.stringify(totals), Math.round(totals.total * 100), rootId, base?.id || null, version, time), logStatement(db, user, "quote", id, base ? "new-version" : "create", base ? logSnapshot(base) : null, logSnapshot(quote)), ...priceOverrides(snapshot, settings).map(value => logStatement(db, user, "quote", id, "default-price-override", { field: value.field, value: value.oldValue, source: "company-default" }, { field: value.field, value: value.newValue, number, version }))]);
      return { quote };
    } catch (error) {
      if (attempt < 2 && error instanceof Error && (error.message + String(error.cause)).includes("UNIQUE constraint failed: quotes.root_id")) continue;
      throw error;
    }
  }
  throw new ApiError(409, "报价版本冲突，请重试");
  } catch (error) { await cleanupImages(persisted.keys); throw error; }
}
export async function getQuote(id: string) {
  const { db, user } = await authenticated(), quote = await quoteById(db, user, id);
  const rows = await db.prepare("SELECT * FROM audit_logs WHERE entity_type='quote' AND entity_id=? ORDER BY created_at,id").bind(id).all<Row>();
  return { quote, logs: rows.results.map(auditRecord) };
}
export async function updateSettings(request: Request) {
  const { db, user } = await authenticated(); assertAdmin(user);
  const row = await db.prepare("SELECT data FROM company_settings WHERE id='default'").first<Row>();
  if (!row) throw new ApiError(503, "公司设置尚未初始化");
  const old = mergeSettings(parse<unknown>(row.data)), patch = await body(request, 13_000_000);
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new ApiError(400, "设置格式无效");
  const value = patch as Partial<Settings>;
  const settings = settingsSchema.parse({ ...old, ...value, brand: { ...old.brand, ...value.brand }, sale: { ...old.sale, ...value.sale }, repair: { ...old.repair, ...value.repair }, tradeIn: { ...old.tradeIn, ...value.tradeIn }, home: { ...old.home, ...value.home } });
  await assertImagesOwned(user, settings.paymentMethods.map(item => item.image));
  const persisted = await persistImages(settings.paymentMethods.map(item => item.image), user.id);
  settings.paymentMethods = settings.paymentMethods.map((item, index) => ({ ...item, image: persisted.urls[index] }));
  try {
  const result = await db.batch([db.prepare("UPDATE company_settings SET data=?,updated_by=?,updated_at=? WHERE id='default' AND data=?").bind(JSON.stringify(settings), user.id, now(), String(row.data)), logStatement(db, user, "settings", "default", "update", old, settings, true)]);
  if (!result[0].meta.changes) throw new ApiError(409, "公司设置刚被修改，请刷新后重试");
  return { settings };
  } catch (error) { await cleanupImages(persisted.keys); throw error; }
}
export async function createStyle(request: Request) {
  const { db, user } = await authenticated(); assertAdmin(user);
  const input = styleInputSchema.parse(await body(request)); await assertImagesOwned(user, [input.image]);
  const time = now(), style: Style = { ...input, id: uid(), createdAt: time, updatedAt: time };
  await db.batch([db.prepare("INSERT INTO styles(id,data,active,created_at,updated_at) VALUES(?,?,?,?,?)").bind(style.id, JSON.stringify(input), input.active ? 1 : 0, time, time), logStatement(db, user, "style", style.id, "create", null, style)]);
  return { style };
}
export async function updateStyle(request: Request) {
  const { db, user } = await authenticated(); assertAdmin(user);
  const value = await body(request), { id } = z.object({ id: z.string().min(1) }).parse(value);
  const row = await db.prepare("SELECT * FROM styles WHERE id=?").bind(id).first<Row>(); if (!row) throw new ApiError(404, "款式不存在");
  const old = styleRecord(row), patch = styleInputSchema.partial().parse(value), input = styleInputSchema.parse({ ...old, ...patch }); await assertImagesOwned(user, [input.image]);
  const style: Style = { ...old, ...input, updatedAt: now() };
  const result = await db.batch([db.prepare("UPDATE styles SET data=?,active=?,updated_at=? WHERE id=? AND data=?").bind(JSON.stringify(input), style.active ? 1 : 0, style.updatedAt, id, String(row.data)), logStatement(db, user, "style", id, "update", old, style, true)]);
  if (!result[0].meta.changes) throw new ApiError(409, "款式刚被修改，请刷新后重试");
  return { style };
}
export async function inviteUser(request: Request) {
  const { db, user } = await authenticated(); assertAdmin(user);
  const input = inviteSchema.parse(await body(request)), existing = await db.prepare("SELECT id FROM staff_users WHERE email=?").bind(input.email).first();
  if (existing) throw new ApiError(409, "该邮箱已存在，可在员工管理中修改或启用");
  const time = now(), invited: StaffUser = { id: uid(), userId: null, email: input.email, name: input.name || input.email, role: input.role, active: true, createdAt: time, updatedAt: time };
  await db.batch([db.prepare("INSERT INTO staff_users(id,user_id,email,name,role,active,created_at,updated_at) VALUES(?,NULL,?,?,?,1,?,?)").bind(invited.id, invited.email, invited.name, invited.role, time, time), logStatement(db, user, "user", invited.id, "invite", null, invited)]);
  return { user: invited };
}
export async function updateUser(request: Request) {
  const { db, user } = await authenticated(); assertAdmin(user);
  const input = userPatchSchema.parse(await body(request)), row = await db.prepare("SELECT * FROM staff_users WHERE id=?").bind(input.id).first<Row>(); if (!row) throw new ApiError(404, "员工不存在");
  const old = userRecord(row), changed: StaffUser = { ...old, ...input, updatedAt: now() };
  if (user.id === old.id && (!changed.active || changed.role !== "admin")) throw new ApiError(400, "不能停用或降级当前管理员账号");
  const removesAdmin = old.active && old.role === "admin" && (!changed.active || changed.role !== "admin");
  const update = db.prepare("UPDATE staff_users SET name=?,role=?,active=?,updated_at=? WHERE id=? AND name=? AND role=? AND active=? AND (?=0 OR (SELECT COUNT(*) FROM staff_users WHERE role='admin' AND active=1)>1)").bind(changed.name, changed.role, changed.active ? 1 : 0, changed.updatedAt, changed.id, old.name, old.role, old.active ? 1 : 0, removesAdmin ? 1 : 0);
  const audit = db.prepare("INSERT INTO audit_logs(id,entity_type,entity_id,action,actor_id,actor_name,old_value,new_value,created_at) SELECT ?,'user',?,'update',?,?,?,?,? WHERE changes()>0").bind(uid(), changed.id, user.id, user.name, JSON.stringify(old), JSON.stringify(changed), now());
  const results = await db.batch([update, audit]);
  if (!results[0].meta.changes) throw new ApiError(409, "员工资料刚被修改或操作将移除最后一名管理员，请刷新后重试");
  return { user: changed };
}

const attachmentSchema = z.object({ images: z.array(z.string().max(12_000_000, "单张报价图片过大").regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/, "报价图片须为PNG格式")).min(1, "至少保存一张报价图片").max(30, "报价图片最多30页，请精简内容后重试") });
export async function attachQuoteImages(request: Request, id: string) {
  const { db, user } = await authenticated(), quote = await quoteById(db, user, id);
  const existing = await db.prepare("SELECT quote_id FROM quote_attachments WHERE quote_id=?").bind(id).first();
  if (existing) throw new ApiError(409, "此报价图片已保存，历史图片不可覆盖");
  const { images } = attachmentSchema.parse(await body(request, 30_000_000));
  const storage = bucket(), objects: { key: string; url: string }[] = [];
  try {
    for (const image of images) {
      const encoded = image.slice(image.indexOf(",") + 1), raw = atob(encoded), bytes = Uint8Array.from(raw, character => character.charCodeAt(0));
      if (bytes.length > 8_000_000 || bytes.length < 24 || ![137,80,78,71,13,10,26,10].every((byte, index) => bytes[index] === byte)) throw new ApiError(400, "报价图片必须是有效PNG，单张不超过8MB");
      const imageId = uid(), key = "images/" + imageId, url = "/api/images/" + imageId;
      await storage.put(key, bytes, { httpMetadata: { contentType: "image/png" }, customMetadata: { ownerId: quote.ownerId, quoteId: id } });
      objects.push({ key, url });
    }
    const urls = objects.map(object => object.url);
    await db.batch([db.prepare("INSERT INTO quote_attachments(quote_id,images,created_by,created_at) VALUES(?,?,?,?)").bind(id, JSON.stringify(urls), user.id, now()), logStatement(db, user, "quote", id, "attach-images", [], urls)]);
    return { quote: { ...quote, images: urls } };
  } catch (error) {
    await Promise.allSettled(objects.map(object => storage.delete(object.key)));
    if (error instanceof Error && (error.message + String(error.cause)).includes("UNIQUE constraint failed: quote_attachments")) throw new ApiError(409, "此报价图片已保存，历史图片不可覆盖");
    throw error;
  }
}
export async function getImage(id: string): Promise<Response> {
  const { user } = await authenticated();
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new ApiError(404, "图片不存在");
  const object = await bucket().get("images/" + id); if (!object) throw new ApiError(404, "图片不存在");
  if (!(await canReadImage(user, "/api/images/" + id, object.customMetadata?.ownerId || ""))) throw new ApiError(404, "图片不存在或无权访问");
  const contentType = object.httpMetadata?.contentType;
  return new Response(object.body, { headers: { "Content-Type": contentType && ["image/png", "image/jpeg", "image/webp"].includes(contentType) ? contentType : "image/png", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}

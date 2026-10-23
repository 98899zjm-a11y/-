import { env } from "cloudflare:workers";
import { z } from "zod";
import { normalizePhone } from "../desktop/customer-identity.cjs";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { HistoricalQuotePresentationError, readSavedQuotePresentation } from "./quote-presentation";
import {
  type StaffUser, type Customer, type CustomerRecordCounts, type CustomerSearchPage, type Settings, type Style, type QuoteRecord,
  type QuoteSnapshot, type QuoteTotals, type AuditLog, type Bootstrap, type PaymentMethod, type MediaAsset, type SaleConfirmation, type SalesMetrics, type SavedAmountAvailability, type SalesReportOrder, type SalesReport, type CustomerActivityItem, type CustomerActivityOrder, type CustomerActivity,
  calculateQuote, QuoteAmountPrecisionError, canAccessOwned, canManage, defaultSettings, quoteInputSchema,
  customerInputSchema, settingsSchema, styleInputSchema, inviteSchema, userPatchSchema, paymentMethodsSchema, mergeSettings, defaultTradeIn, quoteTypes, imageSchema, quoteScreenshotSchema, QUOTE_SCREENSHOT_MAX_BYTES, QUOTE_SCREENSHOT_MAX_PAGES,
} from "./domain";

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
type Row = Record<string, unknown>;
const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
function database(): D1Database { if (!env.DB) throw new ApiError(503, "数据库尚未连接，请完成部署配置"); return env.DB; }
function bucket(): R2Bucket { if (!env.BUCKET) throw new ApiError(503, "图片存储尚未连接，请完成部署配置"); return env.BUCKET; }
function parse<T>(value: unknown): T { return JSON.parse(String(value)) as T; }
function userRecord(row: Row): StaffUser { return { id: String(row.id), userId: row.user_id ? String(row.user_id) : null, email: String(row.email), name: String(row.name), role: row.role === "admin" ? "admin" : "employee", active: Boolean(row.active), createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; }
function customerRecord(row: Row): Customer { return { id: String(row.id), name: String(row.name), phone: String(row.phone), notes: String(row.notes), ownerId: String(row.owner_id), createdAt: String(row.created_at), updatedAt: String(row.updated_at), revision: Number(row.revision || 1) }; }
function styleRecord(row: Row): Style { return { ...parse<Omit<Style, "id" | "createdAt" | "updatedAt">>(row.data), id: String(row.id), active: Boolean(row.active), createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; }
function mediaRecord(row: Row): MediaAsset { return { id: String(row.id), name: String(row.name), category: String(row.category), url: String(row.url), ownerId: String(row.owner_id), ownerName: String(row.owner_name), createdAt: String(row.created_at), active: Boolean(row.active) }; }
function normalizeTotals(value: Partial<QuoteTotals>, total: number): QuoteTotals { return { metal: 0, labor: 0, extras: 0, repair: 0, subtotal: 0, discount: 0, insurance: 0, recyclingUnitPrice: 0, depreciation: 0, exchangeWeight: 0, additionalWeight: 0, excessWeight: 0, exchangeCredit: 0, ...value, total, balance: value.balance ?? total, itemTotals: value.itemTotals ?? [] }; }
function confirmationRecord(row: Row): SaleConfirmation { return { id: String(row.id), rootId: String(row.root_id), quoteId: String(row.quote_id), confirmedAt: String(row.confirmed_at), confirmedBy: String(row.confirmed_by) }; }
function quoteConfirmation(row: Row): SaleConfirmation | null { return row.confirmation_id ? { id: String(row.confirmation_id), rootId: String(row.root_id), quoteId: String(row.confirmation_quote_id), confirmedAt: String(row.confirmation_at), confirmedBy: String(row.confirmation_by) } : null; }
function quoteRecord(row: Row, full = true): QuoteRecord {
  const original = parse<QuoteSnapshot>(row.snapshot), storedTotals = parse<QuoteTotals>(row.totals), total = Number(row.total_cents) / 100;
  // A missing calculation can use the other saved copy. Keep absent monetary
  // details absent so historical presentation can explain incomplete records.
  const snapshot: QuoteSnapshot = { ...original, paymentMethods: original.paymentMethods ?? [], customDetails: original.customDetails ?? "", customConfirmations: original.customConfirmations ?? [], tradeIn: { ...defaultTradeIn, ...original.tradeIn }, calculation: { ...(original.calculation ?? storedTotals), total } };
  if (!full) { snapshot.image = ""; snapshot.images = []; }
  const uploadedIndexes = row.image_upload_indexes ? parse<number[]>(row.image_upload_indexes).sort((a, b) => a - b) : [];
  const imageUpload = row.image_upload_total ? { total: Number(row.image_upload_total), uploadedIndexes, complete: uploadedIndexes.length === Number(row.image_upload_total) && Boolean(row.attached_images) } : null;
  const record: QuoteRecord = { id: String(row.id), number: String(row.number), type: row.type as QuoteRecord["type"], customerId: String(row.customer_id), customerName: String(row.customer_name), ownerId: String(row.owner_id), title: String(row.title), snapshot, data: snapshot, totals: normalizeTotals(storedTotals, total), total, rootId: String(row.root_id), baseQuoteId: row.base_quote_id ? String(row.base_quote_id) : null, version: Number(row.version), createdAt: String(row.created_at), images: row.attached_images ? parse<string[]>(row.attached_images) : [], saleConfirmation: null, imageUpload };
  // Old confirmations remain explicitly historical metadata. A quotation is
  // not a transaction; its effective order association has a separate identity.
  return Object.assign(record, { legacySaleConfirmation: quoteConfirmation(row), salesOrder: row.sales_order_id ? { id: String(row.sales_order_id), number: String(row.sales_order_number), status: String(row.sales_order_status), sourceQuoteId: String(row.sales_order_quote_id), sourceRootId: String(row.root_id), sourceQuoteVersion: Number(row.sales_order_quote_version), submittedAt: String(row.sales_order_submitted_at) } : null });
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
    if (error instanceof QuoteAmountPrecisionError) return Response.json({ error: error.message }, { status: 400 });
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
const SUMMARY_SNAPSHOT = "json_set(q.snapshot,'$.image','','$.images',json('[]'),'$.paymentMethods',json((SELECT json_group_array(json_set(p.value,'$.image','')) FROM json_each(q.snapshot,'$.paymentMethods') p)),'$.saleItems',json((SELECT json_group_array(json_set(s.value,'$.image','')) FROM json_each(q.snapshot,'$.saleItems') s)),'$.tradeInItems',json((SELECT json_group_array(json_set(t.value,'$.image','')) FROM json_each(q.snapshot,'$.tradeInItems') t)),'$.customConfirmations',json((SELECT json_group_array(json_set(c.value,'$.image','')) FROM json_each(q.snapshot,'$.customConfirmations') c)),'$.recyclingItems',json((SELECT json_group_array(json_set(r.value,'$.image','')) FROM json_each(q.snapshot,'$.recyclingItems') r)))";
function customerScope(user: StaffUser) { return user.role === "admin" ? { clause: "", args: [] as string[] } : { clause: " AND (customers.owner_id=? OR EXISTS(SELECT 1 FROM customer_collaborators cc WHERE cc.customer_id=customers.id AND cc.staff_id=? AND cc.active=1))", args: [user.id,user.id] }; }
function accessibleCustomer(row: Row,user:StaffUser):Customer { return { ...customerRecord(row),access:{canEdit:user.role==="admin"||row.owner_id===user.id,canManage:user.role==="admin",relation:user.role==="admin"?"admin":row.owner_id===user.id?"owner":"collaborator"} }; }
async function customerById(db: D1Database, user: StaffUser, id: string): Promise<Customer> { const scope=customerScope(user),row=await db.prepare("SELECT * FROM customers WHERE id=? AND deleted_at IS NULL"+scope.clause).bind(id,...scope.args).first<Row>();if(!row)throw new ApiError(404,"客户不存在或未获协作授权");return accessibleCustomer(row,user); }
const CONFIRMATION_FIELDS = "c.id AS confirmation_id,c.quote_id AS confirmation_quote_id,c.confirmed_at AS confirmation_at,c.confirmed_by AS confirmation_by,so.id AS sales_order_id,so.number AS sales_order_number,so.status AS sales_order_status,so.source_quote_id AS sales_order_quote_id,so.source_quote_version AS sales_order_quote_version,so.submitted_at AS sales_order_submitted_at";
const QUOTE_JOINS = " LEFT JOIN quote_attachments a ON a.quote_id=q.id LEFT JOIN sale_confirmations c ON c.root_id=q.root_id AND c.cancelled_at IS NULL LEFT JOIN sales_orders so ON so.source_root_id=q.root_id AND so.status IN('pending','approved')";
// Source-quotation access does not confer access to an order assigned elsewhere.
function quoteOrderScope(user: StaffUser) { return user.role === "admin" ? { clause: "", args: [] as string[] } : { clause: " AND so.owner_id=?", args: [user.id] }; }
const QUOTE_SELECT = "SELECT q.*,a.images AS attached_images," + CONFIRMATION_FIELDS + ",(SELECT total_pages FROM quote_image_uploads WHERE quote_id=q.id) AS image_upload_total,(SELECT json_group_array(page_index) FROM quote_image_pages WHERE quote_id=q.id) AS image_upload_indexes FROM quotes q";
async function quoteById(db: D1Database, user: StaffUser, id: string): Promise<QuoteRecord> { const scope = quoteOrderScope(user), row = await db.prepare(QUOTE_SELECT + QUOTE_JOINS + scope.clause + " WHERE q.id=? AND q.deleted_at IS NULL").bind(...scope.args, id).first<Row>(); if (!row) throw new ApiError(404, "报价不存在或已删除"); const quote = quoteRecord(row); assertOwner(user, quote.ownerId); return quote; }
export async function listQuotes(db: D1Database, user: StaffUser): Promise<QuoteRecord[]> {
  // Extract all small JSON fields but omit embedded photographs before loading rows into the Worker.
  const fields = `q.id,q.number,q.type,q.customer_id,q.customer_name,q.owner_id,q.title,${SUMMARY_SNAPSHOT} AS snapshot,q.totals,q.total_cents,q.root_id,q.base_quote_id,q.version,q.created_at,a.images AS attached_images`;
  const scope = quoteOrderScope(user), query = `SELECT ${fields},${CONFIRMATION_FIELDS} FROM quotes q${QUOTE_JOINS}${scope.clause} WHERE q.deleted_at IS NULL${user.role === "admin" ? "" : " AND q.owner_id=?"} ORDER BY q.created_at DESC,q.id DESC LIMIT 200`;
  const rows = await db.prepare(query).bind(...scope.args, ...(user.role === "admin" ? [] : [user.id])).all<Row>();
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
    from:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),to:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),staffId:z.string().uuid().optional(),status:z.enum(['all','confirmed','unconfirmed']).default('all'),
  }).parse(Object.fromEntries(params));
  const scope = quoteOrderScope(user), where: string[] = ["q.deleted_at IS NULL"], args: (string | number)[] = [];
  if (user.role !== "admin") { where.push("q.owner_id=?"); args.push(user.id); }
  if(filter.staffId){if(user.role!=="admin"&&filter.staffId!==user.id)throw new ApiError(403,"员工只能查询自己的历史记录");where.push("q.owner_id=?");args.push(filter.staffId);}
  for(const[key,inclusive]of [["from",false],["to",true]] as const){const value=filter[key];if(value){const start=new Date(value+"T00:00:00+08:00");if(!Number.isFinite(start.getTime())||new Date(value+"T00:00:00Z").toISOString().slice(0,10)!==value)throw new ApiError(400,"日期范围无效");where.push(inclusive?"q.created_at<?":"q.created_at>=?");args.push(new Date(start.getTime()+(inclusive?86400000:0)).toISOString());}}
  if(filter.from&&filter.to&&filter.from>filter.to)throw new ApiError(400,"开始日期不能晚于结束日期");
  if (filter.status !== "all") { where.push((filter.status === "confirmed" ? "" : "NOT ") + "EXISTS(SELECT 1 FROM sales_orders so WHERE so.source_root_id=q.root_id AND so.status IN('pending','approved')" + scope.clause + ")"); args.push(...scope.args); }
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
  const rows = await db.prepare("SELECT " + fields + "," + CONFIRMATION_FIELDS + " FROM quotes q" + QUOTE_JOINS + scope.clause + clause + " ORDER BY q.created_at DESC,q.id DESC LIMIT ? OFFSET ?").bind(...scope.args, ...args, filter.pageSize, (filter.page - 1) * filter.pageSize).all<Row>();
  return { quotes: rows.results.map(row => quoteRecord(row, false)), total: Number(totalRow?.total || 0), page: filter.page, pageSize: filter.pageSize };
}
export async function bootstrap(): Promise<Bootstrap> {
  const { db, user } = await authenticated();
  const scope=customerScope(user),customerQuery=db.prepare("SELECT * FROM customers WHERE deleted_at IS NULL"+scope.clause+" ORDER BY updated_at DESC LIMIT 1000").bind(...scope.args);
  const [settings, styleRows, customerRows, quotes, users, mediaRows] = await Promise.all([
    getSettings(db), db.prepare(`SELECT * FROM styles${user.role === "admin" ? "" : " WHERE active=1"} ORDER BY updated_at DESC LIMIT 300`).all<Row>(),
    customerQuery.all<Row>(), listQuotes(db, user), user.role === "admin" ? db.prepare("SELECT * FROM staff_users ORDER BY created_at").all<Row>() : Promise.resolve({ results: [] as Row[] }), (user.role === "admin" ? db.prepare("SELECT * FROM media_assets ORDER BY created_at DESC,id DESC LIMIT 1000") : db.prepare("SELECT * FROM media_assets WHERE active=1 OR owner_id=? ORDER BY created_at DESC,id DESC LIMIT 1000").bind(user.id)).all<Row>(),
  ]);
  const preference = await readPreferences(db, user, settings);
  return { user, settings, styles: styleRows.results.map(styleRecord), customers: customerRows.results.map(row=>accessibleCustomer(row,user)), quotes, users: users.results.map(userRecord), media: mediaRows.results.map(mediaRecord), paymentMethods: preference.paymentMethods, protocolCapabilities: { customerActivityRepairAmounts: 1 } };
}
export const getBootstrap = bootstrap;
export async function listCustomerCollaborators(id:string){
  const{db,user}=await authenticated();assertAdmin(user);const customer=await customerById(db,user,id);
  const result=await db.prepare("SELECT staff_id,active,granted_at,revoked_at FROM customer_collaborators WHERE customer_id=?").bind(id).all<Row>();
  return{customer,collaborators:result.results.map(row=>({staffId:String(row.staff_id),active:Boolean(row.active),grantedAt:row.granted_at,revokedAt:row.revoked_at}))};
}
export async function manageCustomerCollaborator(request:Request,id:string){
  const{db,user}=await authenticated();if(user.role!=="admin")throw new ApiError(403,"只有管理员可以授权客户协作");
  const input=z.object({staffId:z.string().min(1),granted:z.boolean(),revision:z.number().int().positive()}).strict().parse(await body(request)),old=await customerById(db,user,id);
  if(old.revision!==input.revision)throw new ApiError(409,"客户归属刚被调整，请刷新后重试");const target=await db.prepare("SELECT id,active FROM staff_users WHERE id=?").bind(input.staffId).first<Row>();if(!target||input.granted&&!target.active)throw new ApiError(400,"请选择有效员工");
  const time=now();const result=await db.batch([db.prepare("UPDATE customers SET revision=revision+1,updated_at=? WHERE id=? AND revision=? AND deleted_at IS NULL").bind(time,id,input.revision),db.prepare("INSERT INTO customer_collaborators(customer_id,staff_id,active,granted_by,granted_at,revoked_by,revoked_at) SELECT ?,?,?,?,?,?,? WHERE changes()>0 ON CONFLICT(customer_id,staff_id) DO UPDATE SET active=excluded.active,granted_by=excluded.granted_by,granted_at=excluded.granted_at,revoked_by=excluded.revoked_by,revoked_at=excluded.revoked_at").bind(id,input.staffId,input.granted?1:0,user.id,time,input.granted?null:user.id,input.granted?null:time),logStatement(db,user,"customer",id,input.granted?"collaborator-grant":"collaborator-revoke",{revision:old.revision},{staffId:input.staffId,granted:input.granted,revision:input.revision+1},true)]);
  if(!result[0].meta.changes)throw new ApiError(409,"客户权限刚被调整，请刷新后重试");return{customer:await customerById(db,user,id)};
}
export async function transferCustomer(request:Request,id:string){
  const{db,user}=await authenticated();if(user.role!=="admin")throw new ApiError(403,"只有管理员可以转交客户负责人");
  const input=z.object({ownerId:z.string().min(1),expectedOwnerId:z.string().min(1),revision:z.number().int().positive(),reason:z.string().trim().min(1).max(1000)}).strict().parse(await body(request)),old=await customerById(db,user,id);
  const target=await db.prepare("SELECT id,active FROM staff_users WHERE id=?").bind(input.ownerId).first<Row>();if(!target?.active)throw new ApiError(400,"请选择启用的员工");
  if(old.ownerId!==input.expectedOwnerId||old.revision!==input.revision)throw new ApiError(409,"客户归属已变化，请刷新后重试");
  const time=now(),result=await db.batch([db.prepare("UPDATE customers SET owner_id=?,revision=revision+1,updated_at=? WHERE id=? AND owner_id=? AND revision=? AND deleted_at IS NULL").bind(input.ownerId,time,id,old.ownerId,input.revision),logStatement(db,user,"customer",id,"responsibility-transfer",old,{ownerId:input.ownerId,revision:input.revision+1,reason:input.reason},true)]);
  if(!result[0].meta.changes)throw new ApiError(409,"客户归属刚被调整，请刷新后重试");return{customer:await customerById(db,user,id)};
}
export async function createCustomer(request: Request) {
  const { db, user } = await authenticated(), input = customerInputSchema.parse(await body(request));
  const key=normalizePhone(input.phone);
  if(key){if(await db.prepare("SELECT phone_key FROM customer_identity_conflicts WHERE phone_key=? AND status='open'").bind(key).first())throw new ApiError(409,"此客户信息需管理员核对现有重复档案");const existing=await db.prepare("SELECT id FROM customers WHERE phone_key=? AND deleted_at IS NULL").bind(key).first<Row>();if(existing){try{return {customer:await customerById(db,user,String(existing.id)),duplicate:true};}catch{throw new ApiError(409,"已有客户档案，请申请协作授权后使用");}}}
  const time = now(), customer: Customer = { id: uid(), ...input, ownerId: user.id, createdAt: time, updatedAt: time, revision:1 };
  try{await db.batch([db.prepare("INSERT INTO customers(id,name,phone,notes,owner_id,created_at,updated_at,phone_key,revision) VALUES(?,?,?,?,?,?,?,?,1)").bind(customer.id, customer.name, customer.phone, customer.notes, customer.ownerId, time, time,key), logStatement(db, user, "customer", customer.id, "create", null, customer)]);}catch(error){if(String(error).includes("customers.phone_key"))throw new ApiError(409,"已有客户档案，请申请授权后使用");throw error;}
  return { customer:{...customer,access:{canEdit:true,canManage:user.role==="admin",relation:user.role==="admin"?"admin":"owner"}} };
}
export async function updateCustomer(request: Request) {
  const { db, user } = await authenticated(), value = await body(request), input = z.object({ id: z.string().min(1), revision:z.number().int().positive().optional() }).parse(value);
  const old = await customerById(db, user, input.id);if(!old.access?.canEdit)throw new ApiError(403,"协作者可报价，修改客户档案需负责人或管理员");if(input.revision!==undefined&&input.revision!==old.revision)throw new ApiError(409,"客户资料刚被修改，请刷新后重试");const patch = customerInputSchema.partial().parse(value), customer = { ...old, ...patch, updatedAt: now(), revision:(old.revision||1)+1 };let key=normalizePhone(customer.phone);const conflict=key?await db.prepare("SELECT phone_key FROM customer_identity_conflicts WHERE phone_key=? AND status='open'").bind(key).first():null;if(key&&customer.phone!==old.phone&&(await db.prepare("SELECT id FROM customers WHERE phone_key=? AND id<>? AND deleted_at IS NULL").bind(key,customer.id).first()||conflict))throw new ApiError(409,"此电话已关联其它客户，请联系管理员核对");if(conflict)key=null;
  const result = await db.batch([db.prepare("UPDATE customers SET name=?,phone=?,notes=?,updated_at=?,phone_key=?,revision=revision+1 WHERE id=? AND name=? AND phone=? AND notes=? AND owner_id=? AND revision=?").bind(customer.name, customer.phone, customer.notes, customer.updatedAt,key, customer.id, old.name, old.phone, old.notes,old.ownerId,old.revision||1), logStatement(db, user, "customer", customer.id, "update", old, customer, true)]);
  if (!result[0].meta.changes) throw new ApiError(409, "客户资料刚被修改，请刷新后重试");
  return { customer };
}
async function canReadImage(user: StaffUser, image: string, ownerId: string): Promise<boolean> {
  // Shared media is permanent: retiring an asset removes it from the picker, not from saved quotations.
  const sharedMedia = await database().prepare("SELECT id FROM media_assets WHERE url=? LIMIT 1").bind(image).first();
  if (sharedMedia) return true;
  const companyPayment = await database().prepare("SELECT id FROM company_settings WHERE json_extract(data,'$.home.image')=? OR EXISTS(SELECT 1 FROM json_each(data,'$.paymentMethods') p WHERE json_extract(p.value,'$.image')=?) LIMIT 1").bind(image, image).first();
  if (companyPayment) return true;
  const historicalHome = await database().prepare("SELECT id FROM audit_logs WHERE entity_type='settings' AND entity_id='default' AND action='update' AND (json_extract(old_value,'$.home.image')=? OR json_extract(new_value,'$.home.image')=?) LIMIT 1").bind(image, image).first();
  if (historicalHome) return true;
  const ownPreference = await database().prepare("SELECT staff_id FROM staff_preferences WHERE staff_id=? AND EXISTS(SELECT 1 FROM json_each(payment_methods) p WHERE json_extract(p.value,'$.image')=?) LIMIT 1").bind(user.id, image).first();
  if (ownPreference) return true;
  const sharedStyle = await database().prepare("SELECT id FROM styles WHERE active=1 AND json_extract(data,'$.image')=? LIMIT 1").bind(image).first();
  if (sharedStyle) return true;
  // A style may later be retired. A photograph already frozen into this employee's quote remains readable.
  const references = await database().prepare("SELECT q.owner_id,q.deleted_at FROM quotes q LEFT JOIN quote_attachments a ON a.quote_id=q.id WHERE json_extract(q.snapshot,'$.image')=? OR EXISTS(SELECT 1 FROM json_each(q.snapshot,'$.paymentMethods') p WHERE json_extract(p.value,'$.image')=?) OR EXISTS(SELECT 1 FROM json_each(q.snapshot,'$.saleItems') p WHERE json_extract(p.value,'$.image')=?) OR EXISTS(SELECT 1 FROM json_each(q.snapshot,'$.recyclingItems') p WHERE json_extract(p.value,'$.image')=?) OR EXISTS(SELECT 1 FROM json_each(q.snapshot,'$.tradeInItems') p WHERE json_extract(p.value,'$.image')=?) OR EXISTS(SELECT 1 FROM json_each(q.snapshot,'$.customConfirmations') p WHERE json_extract(p.value,'$.image')=?) OR EXISTS(SELECT 1 FROM json_each(a.images) p WHERE p.value=?) OR EXISTS(SELECT 1 FROM quote_image_pages p WHERE p.quote_id=q.id AND p.image_url=?)").bind(image, image, image, image, image, image, image, image).all<Row>();
  if (references.results.some(row => !row.deleted_at && canAccessOwned(user, String(row.owner_id)))) return true;
  // Keep archived bytes for audit/backup, while a private photograph referenced
  // exclusively by deleted quotations cannot still be opened using its old URL.
  if (references.results.length && references.results.every(row => row.deleted_at)) return false;
  return canAccessOwned(user, ownerId);
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
    else if (input.type === "tradein" && input.tradeInItems?.length) { for (const item of input.tradeInItems) { compare(`tradeInItems.${item.id}.goldPrice`, settings.sale.goldPrice, item.goldPrice); compare(`tradeInItems.${item.id}.laborPrice`, settings.sale.laborPrice, item.laborPrice); } }
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
  const sourceImages = [input.image, ...input.paymentMethods.map(item => item.image), ...input.saleItems.map(item => item.image), ...input.recyclingItems.map(item => item.image), ...(input.tradeInItems || []).map(item => item.image), ...(input.customConfirmations || []).map(item => item.image)];
  await assertImagesOwned(user, sourceImages);
  const base = input.baseQuoteId ? await quoteById(db, user, input.baseQuoteId) : null;
  if (base && base.type !== input.type) throw new ApiError(400, "报价新版本必须使用原业务类型");
  if (base && base.customerId !== customer.id) throw new ApiError(400, "报价新版本须保留原客户，复制给其他客户请新建报价");
  const totals = calculateQuote(input);
  if (!Number.isFinite(totals.total) || Math.abs(totals.total) > 1_000_000_000 || totals.subtotal > 1_000_000_000 || totals.exchangeCredit > 1_000_000_000) throw new ApiError(400, "报价金额超出支持范围");
  const persisted = await persistImages(sourceImages, base?.ownerId || user.id); let imageIndex = 0;
  input.image = persisted.urls[imageIndex++]; for (const method of input.paymentMethods) method.image = persisted.urls[imageIndex++]; for (const item of input.saleItems) item.image = persisted.urls[imageIndex++]; for (const item of input.recyclingItems) item.image = persisted.urls[imageIndex++];
  for (const item of input.tradeInItems || []) item.image = persisted.urls[imageIndex++];
  for (const item of input.customConfirmations || []) {
    const previous = base?.snapshot.customConfirmations?.find(old => old.id === item.id && old.image === item.image);
    item.image = persisted.urls[imageIndex++]; item.createdAt = previous?.createdAt || now();
  }
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
      return { quote: await quoteById(db, user, id) };
    } catch (error) {
      if (attempt < 2 && error instanceof Error && (error.message + String(error.cause)).includes("UNIQUE constraint failed: quotes.root_id")) continue;
      throw error;
    }
  }
  throw new ApiError(409, "报价版本冲突，请重试");
  } catch (error) { await cleanupImages(persisted.keys); throw error; }
}
export async function getQuote(id: string) {
  const { db, user } = await authenticated(); let quote = await quoteById(db, user, id);
  // Recover a fully uploaded set left by an earlier interrupted uploader. No
  // pixels change: only publish the ordered immutable URLs, under the same ACL.
  if (quote.imageUpload && !quote.imageUpload.complete && quote.imageUpload.uploadedIndexes.length === quote.imageUpload.total) {
    await db.batch(completeImageUploadStatements(db, user, id)); quote = await quoteById(db, user, id);
  }
  const rows = await db.prepare("SELECT * FROM audit_logs WHERE entity_type='quote' AND entity_id=? ORDER BY created_at,id").bind(id).all<Row>();
  return { quote, logs: rows.results.map(auditRecord) };
}
async function actionBody(request: Request) { return request.body === null ? {} : body(request); }
export async function deleteQuote(request: Request, id: string) {
  const { db, user } = await authenticated(); assertAdmin(user);
  const { reason } = z.object({ reason: z.string().trim().max(500).default("") }).strict().parse(await actionBody(request));
  const quote = await quoteById(db, user, id), time = now();
  const versions = await db.prepare("SELECT id FROM quotes WHERE root_id=? AND deleted_at IS NULL").bind(quote.rootId).all<Row>();
  const confirmation = await db.prepare("SELECT * FROM sale_confirmations WHERE root_id=? AND cancelled_at IS NULL").bind(quote.rootId).first<Row>();
  const statements = [db.prepare("UPDATE quotes SET deleted_at=?,deleted_by=? WHERE root_id=? AND deleted_at IS NULL").bind(time, user.id, quote.rootId),
    ...versions.results.map(row => logStatement(db, user, "quote", String(row.id), "delete", { rootId: quote.rootId, deleted: false }, { rootId: quote.rootId, deleted: true, deletedAt: time, reason }))];
  if (confirmation) statements.push(db.prepare("UPDATE sale_confirmations SET cancelled_at=?,cancelled_by=? WHERE id=? AND cancelled_at IS NULL").bind(time, user.id, String(confirmation.id)), logStatement(db, user, "quote", String(confirmation.quote_id), "cancel-sale-on-delete", confirmationRecord(confirmation), { cancelledAt: time, reason }));
  await db.batch(statements);
  return { deleted: true, rootId: quote.rootId, quoteIds: versions.results.map(row => String(row.id)) };
}
export async function deleteCustomer(request: Request, id: string) {
  const { db, user } = await authenticated(); assertAdmin(user);
  const { reason } = z.object({ reason: z.string().trim().max(500).default("") }).strict().parse(await actionBody(request));
  const customer = await customerById(db, user, id), time = now();
  await db.batch([db.prepare("UPDATE customers SET deleted_at=?,deleted_by=?,updated_at=? WHERE id=? AND deleted_at IS NULL").bind(time, user.id, time, id), logStatement(db, user, "customer", id, "delete", customer, { deleted: true, deletedAt: time, reason })]);
  return { deleted: true, customerId: id };
}
export async function searchCustomers(request: Request): Promise<CustomerSearchPage> {
  const { db, user } = await authenticated(), filter = z.object({ q: z.string().trim().max(120).default(""), page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(50) }).strict().parse(Object.fromEntries(new URL(request.url).searchParams));
  const scope=customerScope(user),clause="deleted_at IS NULL"+scope.clause+(filter.q?" AND (instr(lower(name),lower(?))>0 OR instr(phone,?)>0 OR instr(phone_key,?)>0 OR instr(lower(notes),lower(?))>0)":""),args=[...scope.args,...(filter.q?[filter.q,filter.q,normalizePhone(filter.q)||filter.q,filter.q]:[])];
  const total = await db.prepare("SELECT COUNT(*) AS n FROM customers WHERE " + clause).bind(...args).first<Row>(), rows = await db.prepare("SELECT * FROM customers WHERE " + clause + " ORDER BY updated_at DESC,id DESC LIMIT ? OFFSET ?").bind(...args, filter.pageSize, (filter.page - 1) * filter.pageSize).all<Row>();
  const customers = rows.results.map(row => accessibleCustomer(row, user));
  const counts: Record<string, CustomerRecordCounts> = Object.fromEntries(customers.map(customer => [customer.id, { quoteVersionCount: 0, confirmedRecordCount: 0 }]));
  if (customers.length) {
    // The customer grant does not grant another employee's quote history.
    // Bound each group below D1's 100-parameter limit, including the staff ID.
    const statements: D1PreparedStatement[] = [];
    for (let offset = 0; offset < customers.length; offset += 40) {
      const ids = customers.slice(offset, offset + 40).map(customer => customer.id), placeholders = ids.map(() => "?").join(",");
      statements.push(db.prepare("SELECT q.customer_id,'quotes' AS kind,COUNT(*) AS n FROM quotes q WHERE q.deleted_at IS NULL AND q.customer_id IN(" + placeholders + ")" + (user.role === "admin" ? "" : " AND q.owner_id=?") + " GROUP BY q.customer_id UNION ALL SELECT o.customer_id,'orders' AS kind,COUNT(*) AS n FROM sales_orders o WHERE o.status IN('pending','approved') AND o.customer_id IN(" + placeholders + ")" + (user.role === "admin" ? "" : " AND o.owner_id=?") + " GROUP BY o.customer_id").bind(...ids, ...(user.role === "admin" ? [] : [user.id]), ...ids, ...(user.role === "admin" ? [] : [user.id])));
    }
    for (const group of await db.batch<Row>(statements)) for (const row of group.results) {
      const id = String(row.customer_id), count = Number(row.n);
      if (!Object.hasOwn(counts, id) || !Number.isSafeInteger(count) || count < 0 || !['quotes','orders'].includes(String(row.kind))) throw new ApiError(500, "客户记录统计暂时无法读取，请重试");
      counts[id] = { ...counts[id], [row.kind === 'quotes' ? 'quoteVersionCount' : 'confirmedRecordCount']: count };
    }
  }
  return { customers, counts, total: Number(total?.n || 0), page: filter.page, pageSize: filter.pageSize };
}
export async function searchStyles(request: Request) {
  const { db, user } = await authenticated(), filter = z.object({ q: z.string().trim().max(120).default(""), page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(50), includeInactive: z.literal("1").optional() }).strict().parse(Object.fromEntries(new URL(request.url).searchParams));
  if (filter.includeInactive) assertAdmin(user);
  const clause = (filter.includeInactive ? "1=1" : "active=1") + (filter.q ? " AND (instr(lower(json_extract(data,'$.name')),lower(?))>0 OR instr(lower(json_extract(data,'$.material')),lower(?))>0 OR instr(lower(json_extract(data,'$.specs')),lower(?))>0)" : ""), args = filter.q ? [filter.q, filter.q, filter.q] : [];
  const total = await db.prepare("SELECT COUNT(*) AS n FROM styles WHERE " + clause).bind(...args).first<Row>(), rows = await db.prepare("SELECT * FROM styles WHERE " + clause + " ORDER BY updated_at DESC,id DESC LIMIT ? OFFSET ?").bind(...args, filter.pageSize, (filter.page - 1) * filter.pageSize).all<Row>();
  return { styles: rows.results.map(styleRecord), total: Number(total?.n || 0), page: filter.page, pageSize: filter.pageSize };
}
const activityLabels = (type: QuoteRecord["type"]) => ({ amountLabel: type === "recycling" ? "客户回收实收" : type === "repair" ? "维修报价" : type === "tradein" ? "换新净补差（负值为退款）" : "客户报价", weightLabel: type === "recycling" ? "回收总重" : type === "repair" ? "按克维修计价量" : "新首饰总重" });
const orderActivityLabels = (type: QuoteRecord['type']) => ({ amountLabel: type === 'tradein' ? '开单净补差（负值为退款）' : '销售开单金额', weightLabel: '开单保存新首饰金重' });
function activityMetrics(quote: QuoteRecord): { items: CustomerActivityItem[]; metrics: SalesMetrics; repairBreakdown?: CustomerActivityOrder["repairBreakdown"] } {
  if (["sale", "custom", "tradein"].includes(quote.type)) return metricsFor(quote);
  const q = quote.snapshot;
  let savedRepair: ReturnType<typeof readSavedQuotePresentation> = null;
  if (q.type === "repair") {
    try { savedRepair = readSavedQuotePresentation(q); }
    catch (problem) {
      if (problem instanceof HistoricalQuotePresentationError) throw new ApiError(500, problem.message);
      throw problem;
    }
  }
  if (q.type === "repair" && (!savedRepair || !savedRepair.amountsConsistent)) throw new ApiError(500, "历史维修报价保存的金额快照不完整或不一致，请核对原始单据，不能按当前规则重算");
  const repairBreakdown: CustomerActivityOrder["repairBreakdown"] = savedRepair ? { source: "saved", subtotal: savedRepair.totals.subtotal, insurance: savedRepair.totals.insurance, itemsComplete: savedRepair.repairItemDetailsComplete } : undefined;
  const items: CustomerActivityItem[] = q.type === "recycling" ? (q.recyclingItems?.length ? q.recyclingItems : [{ id: "single", title: q.title, material: q.material, weight: q.weight, goldPrice: q.goldPrice, recyclingCoefficient: q.recyclingCoefficient }]).map((item, index) => ({ id: item.id, title: item.title, material: item.material, weight: item.weight, quantity: 1, goldPrice: item.goldPrice, laborPrice: 0, extras: 0, subtotal: quote.totals.itemTotals[index]?.subtotal ?? quote.total, unitPrice: quote.totals.itemTotals[index]?.unitPrice ?? quote.totals.recyclingUnitPrice })) : q.repairItems.map(item => {
    const row = savedRepair?.repairItemDetailsComplete ? savedRepair.totals.repairItemTotals?.find(row => row.id === item.id) : undefined;
    return { id: item.id, title: item.name, material: "", weight: item.mode === "gram" ? item.quantity : 0, quantity: item.mode === "count" ? item.quantity : 1, goldPrice: 0, laborPrice: 0, extras: 0, subtotal: row?.subtotal ?? null, amountSource: row ? "saved" : "unavailable", unitPrice: item.price, mode: item.mode, billQuantity: item.mode === "fixed" ? 1 : item.quantity };
  });
  return { items, repairBreakdown, metrics: { orderCount: 1, itemCount: items.reduce((sum, item) => sum + item.quantity, 0), weight: items.reduce((sum, item) => sum + Math.round(item.weight * 1000), 0) / 1000, total: quote.total, discount: savedRepair?.totals.discount ?? quote.totals.discount, grossNewJewelryValue: 0, netBalance: quote.total, oldCredit: 0, refund: 0, amountDue: quote.type === "repair" ? quote.total : 0, oldWeight: 0, depreciation: 0 } };
}
export async function customerActivity(request: Request, id: string): Promise<CustomerActivity> {
  const { db, user } = await authenticated(), parameters = new URL(request.url).searchParams;
  if (parameters.getAll("presentation").length > 1) throw new ApiError(400, "客户明细展示参数重复，请重新打开客户明细");
  const filter = z.object({ basis: z.enum(["quotes", "confirmed"]).default("quotes"), page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(50), presentation: z.literal("repair-saved-v1").optional() }).strict().parse(Object.fromEntries(parameters));
  const customer=await customerById(db,user,id);
  if (filter.basis === "confirmed") {
    const args: (string | number)[] = [id], where = ["o.customer_id=?", "o.status IN('pending','approved')"];
    if (user.role !== "admin") { where.push("o.owner_id=?"); args.push(user.id); }
    const selected = await orderHistoryRows(db, where, args, filter.page, filter.pageSize);
    const orders = selected.pageRows.map(row => ({ ...orderHistoryRecord(row), insurance: 0, ...orderActivityLabels(row.type as QuoteRecord['type']) }));
    return { customer, basis: "confirmed", orders, total: selected.rows.length, page: filter.page, pageSize: filter.pageSize, summary: sumMetrics(selected.rows.map(orderHistoryMetrics)), byType: quoteTypes.filter(type => selected.rows.some(row => row.type === type)).map(type => ({ type, ...sumMetrics(selected.rows.filter(row => row.type === type).map(orderHistoryMetrics)), ...orderActivityLabels(type) })), metadata: { sourceNote: "成交记录来自有效销售开单的不可变快照；待审核与已审核分别标注，退回和作废不计有效成交，金额不是实际收款账务。", weightNote: "按开单保存的新首饰金重，不使用现价或当前报价版本重算。" } };
  }
  const fields = `q.id,q.number,q.type,q.customer_id,q.customer_name,q.owner_id,q.title,${SUMMARY_SNAPSHOT} AS snapshot,q.totals,q.total_cents,q.root_id,q.base_quote_id,q.version,q.created_at,${CONFIRMATION_FIELDS},u.name AS owner_name`;
  const scope = quoteOrderScope(user), where = "q.customer_id=? AND q.deleted_at IS NULL" + (user.role === "admin" ? "" : " AND q.owner_id=?"), args = [id, ...(user.role === "admin" ? [] : [user.id])];
  const rows = (await db.prepare("SELECT " + fields + " FROM quotes q" + QUOTE_JOINS + scope.clause + " JOIN staff_users u ON u.id=q.owner_id WHERE " + where + " ORDER BY q.created_at DESC,q.id DESC LIMIT 100001").bind(...scope.args, ...args).all<Row>()).results;
  if (rows.length > 100000) throw new ApiError(413, "该客户记录过多，请按月份查看销售统计");
  const orders: CustomerActivityOrder[] = rows.map(row => { const quote = quoteRecord(row, false), { metrics, items, repairBreakdown } = activityMetrics(quote), eventTime = quote.createdAt; return { ...metrics, id: quote.id, rootId: quote.rootId, number: quote.number, version: quote.version, customerId: quote.customerId, customerName: quote.customerName, ownerId: quote.ownerId, ownerName: String(row.owner_name), date: new Date(eventTime).toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" }), createdAt: quote.createdAt, confirmedAt: null, type: quote.type, title: quote.title, items, saleConfirmation: null, insurance: repairBreakdown?.insurance ?? quote.totals.insurance, ...(repairBreakdown ? { repairBreakdown } : {}), ...activityLabels(quote.type) }; });
  const pageOrders = orders.slice((filter.page - 1) * filter.pageSize, filter.page * filter.pageSize);
  if (filter.presentation !== "repair-saved-v1" && pageOrders.some(order => order.type === "repair" && order.items.some(item => item.subtotal === null || item.amountSource !== "saved"))) throw new ApiError(409, "此界面暂不能安全显示未保存的维修逐项金额。手机请刷新网页，电脑员工端请使用经管理员核验的新版后查看；也可先从报价历史核对原始单据。原单和保存总价没有改动。");
  return { customer, basis: filter.basis, orders: pageOrders, total: orders.length, page: filter.page, pageSize: filter.pageSize, summary: sumMetrics(orders), byType: quoteTypes.filter(type => orders.some(order => order.type === type)).map(type => ({ type, ...sumMetrics(orders.filter(order => order.type === type)), ...activityLabels(type) })), metadata: { sourceNote: "全部保存的客户报价版本明细；同一业务单各版本分别展示，金额合计不是订单数或实际收款统计。", weightNote: "销售、定制和换新显示新首饰总重；回收显示回收总重；维修显示按克收费项目的计价量，不作为首饰实重或销售金重。" } };
}
export async function confirmSale(request: Request, id: string) {
  const { db, user } = await authenticated(); z.object({}).strict().parse(await actionBody(request));
  const quote = await quoteById(db, user, id);
  if (!["sale", "custom", "tradein"].includes(quote.type)) throw new ApiError(400, "只可确认销售、定制和以旧换新成交");
  throw new ApiError(409, "成交记录以销售开单为准，请进入销售开单开具并提交审核；旧报价标记保持历史。");
}
export async function cancelSale(request: Request, id: string) {
  const { db, user } = await authenticated(); z.object({}).strict().parse(await actionBody(request));
  await quoteById(db, user, id);
  throw new ApiError(409, "成交取消以销售开单为准，请进入销售开单核对审核状态并办理作废；旧报价标记保持历史。");
}
function metricsFor(quote: QuoteRecord): { metrics: SalesMetrics; items: SalesReportOrder["items"] } {
  const q = quote.snapshot, source = q.type === "sale" && q.saleItems?.length ? q.saleItems : q.type === "tradein" && q.tradeInItems?.length ? q.tradeInItems : [{ id: "single", title: q.title, material: q.material, weight: q.weight, goldPrice: q.goldPrice, laborPrice: q.laborPrice, extras: q.extras, quantity: 1 }];
  const items = source.map((item, index) => ({ id: item.id, title: item.title, material: item.material, weight: item.weight, quantity: item.quantity, goldPrice: item.goldPrice, laborPrice: item.laborPrice, extras: item.extras.reduce((sum, extra) => sum + Math.round(extra.amount * 100) * item.quantity, 0) / 100, subtotal: quote.totals.itemTotals[index]?.subtotal ?? quote.totals.subtotal }));
  const gross = calculateQuote({ ...q, type: "sale", saleItems: source.map(item => ({ ...item, image: "", specs: "" })), tradeInItems: [], discountType: "none", discountValue: 0 }).subtotal;
  return { items, metrics: { orderCount: 1, itemCount: source.reduce((sum, item) => sum + item.quantity, 0), weight: source.reduce((sum, item) => sum + Math.round(item.weight * 1000) * item.quantity, 0) / 1000, total: quote.total, discount: quote.totals.discount, grossNewJewelryValue: gross, netBalance: quote.total, oldCredit: q.type === "tradein" ? quote.totals.exchangeCredit : 0, refund: Math.max(-quote.total, 0), amountDue: Math.max(quote.total, 0), oldWeight: q.type === "tradein" ? q.tradeIn?.oldWeight || 0 : 0, depreciation: quote.totals.depreciation } };
}
function savedAmountAvailability(value: number | null, source: "saved" | "not-applicable" | "empty" = "saved"): SavedAmountAvailability { return value === null ? { available: false, reason: "not-saved" } : { available: true, source }; }
function sumMetrics(rows: SalesMetrics[]): SalesMetrics {
  const precisionError = () => new ApiError(413, "汇总超过可安全显示的精度，请按月份或员工缩小筛选范围");
  const maximum = BigInt(Number.MAX_SAFE_INTEGER);
  const sum = (read: (row: SalesMetrics) => number, factor: number) => {
    const total = rows.reduce((total, row) => {
      const value = Math.round(read(row) * factor);
      if (!Number.isSafeInteger(value)) throw precisionError();
      return total + BigInt(value);
    }, BigInt(0));
    if (total > maximum || total < -maximum) throw precisionError();
    const value = Number(total) / factor, digits = Math.log10(factor);
    // Even safe integer cents can lose a cent after division into a Number.
    // Verify the decimal value clients receive without rounding that loss away.
    const [whole, fraction = ""] = Math.abs(value).toString().split(".");
    if (fraction.length > digits) throw precisionError();
    const restored = (BigInt(whole) * BigInt(factor) + BigInt(fraction.padEnd(digits, "0") || "0")) * (value < 0 ? -BigInt(1) : BigInt(1));
    if (restored !== total) throw precisionError();
    return value;
  };
  const field = (key: Exclude<keyof SalesMetrics, "amountBreakdown">, factor: number) => sum(row => { const value = row[key]; if (typeof value !== "number") throw precisionError(); return value; }, factor);
  const optional = (key: "grossNewJewelryValue" | "depreciation") => rows.some(row => row[key] === null) ? null : field(key, 100);
  const grossNewJewelryValue = optional("grossNewJewelryValue"), depreciation = optional("depreciation");
  const amountBreakdown = rows.every(row => row.amountBreakdown !== undefined) ? { savedSubtotal: sum(row => row.amountBreakdown!.savedSubtotal, 100), grossNewJewelryValue: savedAmountAvailability(grossNewJewelryValue, rows.length ? "saved" : "empty"), depreciation: savedAmountAvailability(depreciation, rows.length ? "saved" : "empty") } : undefined;
  return { orderCount: field("orderCount", 1), itemCount: field("itemCount", 1), weight: field("weight", 1000000), total: field("total", 100), discount: field("discount", 100), grossNewJewelryValue, netBalance: field("netBalance", 100), oldCredit: field("oldCredit", 100), refund: field("refund", 100), amountDue: field("amountDue", 100), oldWeight: field("oldWeight", 1000000), depreciation, ...(amountBreakdown ? { amountBreakdown } : {}) };
}

const ORDER_METRIC_FIELDS = "o.id,o.number,o.source_quote_id,o.source_root_id,o.source_quote_version,o.customer_id,o.customer_name,o.owner_id,o.owner_name,o.type,o.business_date,o.amount_cents,o.weight_micros,o.item_count,o.status,o.submitted_at,o.reviewed_at,json_extract(o.totals_json,'$.subtotal') AS saved_subtotal,json_extract(o.totals_json,'$.grossNewJewelryValue') AS saved_gross,json_type(o.totals_json,'$.grossNewJewelryValue') AS saved_gross_type,json_extract(o.totals_json,'$.discount') AS saved_discount,json_extract(o.totals_json,'$.exchangeCredit') AS saved_credit,json_extract(o.totals_json,'$.depreciation') AS saved_depreciation,json_type(o.totals_json,'$.depreciation') AS saved_depreciation_type,json_extract(o.snapshot_json,'$.tradeIn.oldWeight') AS saved_old_weight";
const ORDER_SNAPSHOT = SUMMARY_SNAPSHOT.replaceAll('q.snapshot', 'o.snapshot_json');
function orderScaledNumber(input: unknown, factor: number): number {
  if (!/^-?\d{1,16}$/.test(String(input))) throw new ApiError(409, "销售开单保存的整数精度无效");
  const scaled = BigInt(String(input)), maximum = BigInt(Number.MAX_SAFE_INTEGER);
  if (scaled < -maximum || scaled > maximum) throw new ApiError(413, "销售开单保存金额或金重超过安全范围");
  const value = Number(scaled) / factor, digits = Math.log10(factor), [whole, fraction = ''] = Math.abs(value).toString().split('.');
  if (fraction.length > digits || (BigInt(whole) * BigInt(factor) + BigInt(fraction.padEnd(digits, '0') || '0')) * (value < 0 ? -BigInt(1) : BigInt(1)) !== scaled) throw new ApiError(413, "销售开单保存金额或金重不能准确显示");
  return value;
}
function savedOrderMoney(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isSafeInteger(Math.round(value * 100)) || Math.abs(value * 100 - Math.round(value * 100)) > 0.000001) throw new ApiError(409, "销售开单保存金额明细缺失或无效，不能按现价补算");
  return orderScaledNumber(String(Math.round(value * 100)), 100);
}
function savedOrderOptionalMoney(value: unknown, jsonType: unknown): number | null {
  // json_type distinguishes an absent property from explicit zero, null,
  // booleans and strings; only absence means a detail was not saved.
  if (jsonType === null || jsonType === undefined) return null;
  if (jsonType !== "integer" && jsonType !== "real") throw new ApiError(409, "销售开单已保存金额明细格式无效，不能按现价补算");
  return savedOrderMoney(value);
}
function orderHistoryMetrics(row: Row): SalesMetrics {
  const total = orderScaledNumber(row.amount_cents, 100), itemCount = Number(row.item_count), weight = orderScaledNumber(row.weight_micros, 1000000);
  if (!Number.isSafeInteger(itemCount) || itemCount < 1 || weight <= 0) throw new ApiError(409, "销售开单保存件数或金重无效");
  const oldWeight = row.type === 'tradein' ? Number(row.saved_old_weight) : 0;
  if (!Number.isFinite(oldWeight) || oldWeight < 0) throw new ApiError(409, "销售开单保存旧金重量无效");
  const grossNewJewelryValue = savedOrderOptionalMoney(row.saved_gross, row.saved_gross_type), depreciation = row.type === 'tradein' ? savedOrderOptionalMoney(row.saved_depreciation, row.saved_depreciation_type) : 0;
  return { orderCount: 1, itemCount, weight, total, discount: savedOrderMoney(row.saved_discount), grossNewJewelryValue, netBalance: total, oldCredit: row.type === 'tradein' ? savedOrderMoney(row.saved_credit) : 0, refund: Math.max(-total, 0), amountDue: Math.max(total, 0), oldWeight, depreciation, amountBreakdown: { savedSubtotal: savedOrderMoney(row.saved_subtotal), grossNewJewelryValue: savedAmountAvailability(grossNewJewelryValue), depreciation: savedAmountAvailability(depreciation, row.type === 'tradein' ? "saved" : "not-applicable") } };
}
type OrderHistoryRecord = SalesReportOrder & { sourceQuoteId: string; sourceRootId: string; sourceQuoteVersion: number; status: 'pending' | 'approved'; submittedAt: string; reviewedAt: string | null };
function orderHistoryRecord(row: Row): OrderHistoryRecord {
  const snapshot = parse<QuoteSnapshot>(row.order_snapshot), totals = parse<QuoteTotals>(row.order_totals), metrics = orderHistoryMetrics(row);
  const source = snapshot.type === 'sale' && snapshot.saleItems?.length ? snapshot.saleItems : snapshot.type === 'tradein' && snapshot.tradeInItems?.length ? snapshot.tradeInItems : [{ id: 'single', title: snapshot.title, material: snapshot.material, weight: snapshot.weight, goldPrice: snapshot.goldPrice, laborPrice: snapshot.laborPrice, quantity: 1 }];
  const items = source.map(item => { const line = totals.itemTotals?.find(saved => saved.id === item.id); if (source.length > 1 && !line) throw new ApiError(409, "销售开单保存商品金额不完整，不能重新计价"); return { id: item.id, title: item.title, material: item.material, weight: item.weight, quantity: item.quantity, goldPrice: item.goldPrice, laborPrice: item.laborPrice, extras: savedOrderMoney(line?.extras ?? totals.extras), subtotal: savedOrderMoney(line?.subtotal ?? totals.subtotal) }; });
  return { ...metrics, id: String(row.id), rootId: String(row.source_root_id), number: String(row.number), version: Number(row.source_quote_version), customerId: String(row.customer_id), customerName: String(row.customer_name), ownerId: String(row.owner_id), ownerName: String(row.owner_name), date: String(row.business_date), createdAt: String(row.submitted_at), confirmedAt: null, type: row.type as QuoteRecord['type'], title: snapshot.title, items, saleConfirmation: null, sourceQuoteId: String(row.source_quote_id), sourceRootId: String(row.source_root_id), sourceQuoteVersion: Number(row.source_quote_version), status: row.status as 'pending' | 'approved', submittedAt: String(row.submitted_at), reviewedAt: row.reviewed_at ? String(row.reviewed_at) : null };
}
async function orderHistoryRows(db: D1Database, where: string[], args: (string | number)[], page: number, pageSize: number) {
  const clause = ' WHERE ' + where.join(' AND '), ordering = ' ORDER BY o.business_date DESC,o.submitted_at DESC,o.id DESC';
  // Summary rows contain only exact saved metrics. Large product photographs
  // and frozen detail snapshots are fetched for this page in SQL, not sliced
  // after loading the entire month's detail into application memory.
  const results = await db.batch<Row>([
    db.prepare('SELECT ' + ORDER_METRIC_FIELDS + ' FROM sales_orders o' + clause + ordering + ' LIMIT 100001').bind(...args),
    db.prepare('SELECT ' + ORDER_METRIC_FIELDS + ',' + ORDER_SNAPSHOT + ' AS order_snapshot,o.totals_json AS order_totals FROM sales_orders o' + clause + ordering + ' LIMIT ? OFFSET ?').bind(...args, pageSize, (page - 1) * pageSize),
  ]);
  if (results[0].results.length > 100000) throw new ApiError(413, "开单历史超过完整统计范围，请按员工或月份缩小范围");
  return { rows: results[0].results, pageRows: results[1].results };
}
export async function salesReport(request: Request): Promise<SalesReport> {
  const { db, user } = await authenticated(), params = Object.fromEntries(new URL(request.url).searchParams);
  const currentMonth = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" }).slice(0, 7);
  const filter = z.object({ month: z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/).default(currentMonth).refine(value => Number(value.slice(0, 4)) >= 1900 && Number(value.slice(0, 4)) <= 9998, "月份范围无效"), basis: z.enum(["quotes", "confirmed"]).default("quotes"), page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(50), staffId: z.string().uuid().optional() }).strict().parse(params);
  if (user.role !== "admin" && filter.staffId && filter.staffId !== user.id) throw new ApiError(403, "员工只能查看自己的销售统计");
  const staffId = user.role === "admin" ? filter.staffId || null : user.id;
  if (staffId && !(await db.prepare("SELECT id FROM staff_users WHERE id=?").bind(staffId).first())) throw new ApiError(404, "员工不存在");
  const [year, month] = filter.month.split("-").map(Number), start = new Date(Date.UTC(year, month - 1, 1, -8)).toISOString(), end = new Date(Date.UTC(year, month, 1, -8)).toISOString();
  if (filter.basis === 'confirmed') {
    const from = filter.month + '-01', to = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10), where = ["o.status IN('pending','approved')", 'o.business_date>=?', 'o.business_date<=?'], args: (string | number)[] = [from, to];
    if (staffId) { where.push('o.owner_id=?'); args.push(staffId); }
    const selected = await orderHistoryRows(db, where, args, filter.page, filter.pageSize), summaries = selected.rows.map(row => ({ ...orderHistoryMetrics(row), ownerId: String(row.owner_id), ownerName: String(row.owner_name), date: String(row.business_date) })), staffIds = [...new Set(summaries.map(row => row.ownerId))], dates = [...new Set(summaries.map(row => row.date))].sort();
    return { month: filter.month, basis: 'confirmed', summary: sumMetrics(summaries), staff: staffIds.map(id => ({ staffId: id, staffName: summaries.find(row => row.ownerId === id)!.ownerName, ...sumMetrics(summaries.filter(row => row.ownerId === id)) })), daily: dates.map(date => ({ date, ...sumMetrics(summaries.filter(row => row.date === date)) })), orders: selected.pageRows.map(orderHistoryRecord), total: selected.rows.length, page: filter.page, pageSize: filter.pageSize, metadata: { sourceNote: '销售开单保存金额，非实际收款账务；待审核与已审核按明细状态分别呈现。', versionNote: '以有效销售开单为唯一成交来源，按开单业务日期统计；报价版本不重复计单，退回与作废不计有效成交。', timeZone: 'Asia/Shanghai', start, end, scope: staffId ? 'staff' : 'all', staffId, amountNote: '所有金额均取开单保存快照，不按现价重新计价；负净额表示应退客户。' } };
  }
  const fields = `q.id,q.number,q.type,q.customer_id,q.customer_name,q.owner_id,q.title,${SUMMARY_SNAPSHOT} AS snapshot,q.totals,q.total_cents,q.root_id,q.base_quote_id,q.version,q.created_at,${CONFIRMATION_FIELDS},u.name AS owner_name`;
  const scope = quoteOrderScope(user), statement = db.prepare(`SELECT ${fields} FROM (SELECT *,ROW_NUMBER() OVER(PARTITION BY root_id ORDER BY version DESC,created_at DESC,id DESC) AS root_rank FROM quotes WHERE deleted_at IS NULL AND type IN('sale','custom','tradein') AND created_at>=? AND created_at<?${staffId ? " AND owner_id=?" : ""}) q LEFT JOIN sale_confirmations c ON c.root_id=q.root_id AND c.cancelled_at IS NULL LEFT JOIN sales_orders so ON so.source_root_id=q.root_id AND so.status IN('pending','approved')${scope.clause} JOIN staff_users u ON u.id=q.owner_id WHERE q.root_rank=1 ORDER BY q.created_at DESC,q.id DESC LIMIT 100001`).bind(start, end, ...(staffId ? [staffId] : []), ...scope.args);
  const rows = (await statement.all<Row>()).results;
  if (rows.length > 100000) throw new ApiError(413, "该月记录过多，请按员工查看统计");
  const orders: SalesReportOrder[] = rows.map(row => { const quote = quoteRecord(row, false), { metrics, items } = metricsFor(quote), eventTime = quote.createdAt; return { ...metrics, id: quote.id, rootId: quote.rootId, number: quote.number, version: quote.version, customerId: quote.customerId, customerName: quote.customerName, ownerId: quote.ownerId, ownerName: String(row.owner_name), date: new Date(eventTime).toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" }), createdAt: quote.createdAt, confirmedAt: null, type: quote.type, title: quote.title, items, saleConfirmation: null }; });
  const staffIds = [...new Set(orders.map(order => order.ownerId))], dates = [...new Set(orders.map(order => order.date))].sort();
  return { month: filter.month, basis: filter.basis, summary: sumMetrics(orders), staff: staffIds.map(id => ({ staffId: id, staffName: orders.find(order => order.ownerId === id)!.ownerName, ...sumMetrics(orders.filter(order => order.ownerId === id)) })), daily: dates.map(date => ({ date, ...sumMetrics(orders.filter(order => order.date === date)) })), orders: orders.slice((filter.page - 1) * filter.pageSize, filter.page * filter.pageSize), total: orders.length, page: filter.page, pageSize: filter.pageSize, metadata: { sourceNote: "报价金额，非实际收款账务", versionNote: "同一业务单在该月仅统计最新保存版本一次", timeZone: "Asia/Shanghai", start, end, scope: staffId ? "staff" : "all", staffId, amountNote: "新首饰原价按正常售价计算；净额为本单应付或换新补差，负值为退款。旧金抵扣指折价或多余旧金折现，不重复叠加克换克抵换重量。" } };
}
export async function getWarrantyPreferences() {
  const { db, user } = await authenticated(), row = await db.prepare("SELECT phone,after_sales_wechat FROM warranty_preferences WHERE staff_id=?").bind(user.id).first<Row>();
  return row ? { phone: String(row.phone), afterSalesWechat: String(row.after_sales_wechat), inherited: false } : { phone: "", afterSalesWechat: "", inherited: true };
}
export async function updateWarrantyPreferences(request: Request) {
  const { db, user } = await authenticated(), input = z.object({ phone: z.string().trim().max(50).refine(value => !/[<>\x00-\x1f]/.test(value)), afterSalesWechat: z.string().trim().max(50).refine(value => !/[<>\x00-\x1f]/.test(value)) }).strict().parse(await body(request));
  const old = await getWarrantyPreferences();
  await db.batch([db.prepare("INSERT INTO warranty_preferences(staff_id,phone,after_sales_wechat,updated_at) VALUES(?,?,?,?) ON CONFLICT(staff_id) DO UPDATE SET phone=excluded.phone,after_sales_wechat=excluded.after_sales_wechat,updated_at=excluded.updated_at").bind(user.id, input.phone, input.afterSalesWechat, now()), logStatement(db, user, "warranty-preferences", user.id, "update", old, input)]);
  return { ...input, inherited: false };
}
export async function updateSettings(request: Request) {
  const { db, user } = await authenticated(); assertAdmin(user);
  const row = await db.prepare("SELECT data FROM company_settings WHERE id='default'").first<Row>();
  if (!row) throw new ApiError(503, "公司设置尚未初始化");
  const old = mergeSettings(parse<unknown>(row.data)), patch = await body(request, 13_000_000);
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new ApiError(400, "设置格式无效");
  const value = patch as Partial<Settings>;
  const settings = settingsSchema.parse({ ...old, ...value, brand: { ...old.brand, ...value.brand }, sale: { ...old.sale, ...value.sale }, repair: { ...old.repair, ...value.repair }, tradeIn: { ...old.tradeIn, ...value.tradeIn }, home: { ...old.home, ...value.home } });
  await assertImagesOwned(user, [settings.home.image, ...settings.paymentMethods.map(item => item.image)]);
  const persisted = await persistImages([settings.home.image, ...settings.paymentMethods.map(item => item.image)], user.id);
  settings.home.image = persisted.urls[0];
  settings.paymentMethods = settings.paymentMethods.map((item, index) => ({ ...item, image: persisted.urls[index + 1] }));
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

const attachmentSchema = z.object({ images: z.array(quoteScreenshotSchema).min(1, "至少保存一张报价图片").max(QUOTE_SCREENSHOT_MAX_PAGES, "报价图片最多30页，请精简内容后重试") });
function decodeScreenshot(image: string): Uint8Array {
  let raw: string; try { raw = atob(image.slice(22)); } catch { throw new ApiError(400, "报价图片编码无效"); }
  const bytes = Uint8Array.from(raw, character => character.charCodeAt(0));
  if (bytes.length > QUOTE_SCREENSHOT_MAX_BYTES || bytes.length < 24 || ![137,80,78,71,13,10,26,10].every((byte, index) => bytes[index] === byte)) throw new ApiError(400, "报价图片必须是有效PNG，单页最多8MiB");
  return bytes;
}
export async function attachQuoteImages(request: Request, id: string) {
  const { db, user } = await authenticated(), quote = await quoteById(db, user, id);
  const existing = await db.prepare("SELECT quote_id FROM quote_attachments WHERE quote_id=?").bind(id).first();
  if (existing) throw new ApiError(409, "此报价图片已保存，历史图片不可覆盖");
  if (await db.prepare("SELECT quote_id FROM quote_image_uploads WHERE quote_id=?").bind(id).first()) throw new ApiError(409, "此报价已有分页原图，请继续补存未完成的页");
  const { images } = attachmentSchema.parse(await body(request, 30_000_000));
  const storage = bucket(), objects: { key: string; url: string }[] = [];
  try {
    for (const image of images) {
      const bytes = decodeScreenshot(image);
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
const attachmentPageSchema = z.object({ index: z.number().int().min(0).max(QUOTE_SCREENSHOT_MAX_PAGES - 1), total: z.number().int().min(1).max(QUOTE_SCREENSHOT_MAX_PAGES), image: quoteScreenshotSchema }).strict().refine(value => value.index < value.total, "原图页码须小于总页数");
function completeImageUploadStatements(db: D1Database, user: StaffUser, id: string) {
  return [
    db.prepare("INSERT OR IGNORE INTO quote_attachments(quote_id,images,created_by,created_at) SELECT u.quote_id,(SELECT json_group_array(image_url) FROM (SELECT image_url FROM quote_image_pages WHERE quote_id=u.quote_id ORDER BY page_index)),?,? FROM quote_image_uploads u JOIN quotes q ON q.id=u.quote_id WHERE u.quote_id=? AND q.deleted_at IS NULL AND (SELECT COUNT(*) FROM quote_image_pages WHERE quote_id=u.quote_id)=u.total_pages").bind(user.id, now(), id),
    db.prepare("INSERT INTO audit_logs(id,entity_type,entity_id,action,actor_id,actor_name,old_value,new_value,created_at) SELECT ?,'quote',?,'attach-images',?,?,'[]',images,? FROM quote_attachments WHERE quote_id=? AND changes()>0").bind(uid(), id, user.id, user.name, now(), id),
  ];
}
export async function attachQuoteImagePage(request: Request, id: string) {
  const { db, user } = await authenticated(), quote = await quoteById(db, user, id);
  const input = attachmentPageSchema.parse(await body(request, 12_000_000)), bytes = decodeScreenshot(input.image);
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer))).map(value => value.toString(16).padStart(2, "0")).join("");
  const existing = await db.prepare("SELECT * FROM quote_image_uploads WHERE quote_id=?").bind(id).first<Row>();
  if (existing && Number(existing.total_pages) !== input.total) throw new ApiError(409, "原图总页数已固定，请保留原总页数或新建报价版本");
  const previous = await db.prepare("SELECT * FROM quote_image_pages WHERE quote_id=? AND page_index=?").bind(id, input.index).first<Row>();
  if (previous && String(previous.sha256) !== sha256) throw new ApiError(409, "此页原图已保存且不可覆盖，请补存其他页或新建报价版本");
  if (!existing && await db.prepare("SELECT quote_id FROM quote_attachments WHERE quote_id=?").bind(id).first()) throw new ApiError(409, "此报价原图已完整保存，历史图片不可覆盖");
  if (!previous) {
    const imageId = uid(), key = "images/" + imageId, url = "/api/images/" + imageId, time = now();
    await bucket().put(key, bytes, { httpMetadata: { contentType: "image/png" }, customMetadata: { ownerId: quote.ownerId, quoteId: id } });
    try {
      const result = await db.batch([
        db.prepare("INSERT OR IGNORE INTO quote_image_uploads(quote_id,total_pages,created_by,created_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM quotes WHERE id=? AND deleted_at IS NULL)").bind(id, input.total, user.id, time, id),
        db.prepare("INSERT OR IGNORE INTO quote_image_pages(quote_id,page_index,image_url,sha256,created_by,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM quote_image_uploads WHERE quote_id=? AND total_pages=?) AND EXISTS(SELECT 1 FROM quotes WHERE id=? AND deleted_at IS NULL) AND NOT EXISTS(SELECT 1 FROM quote_attachments WHERE quote_id=?)").bind(id, input.index, url, sha256, user.id, time, id, input.total, id, id),
        logStatement(db, user, "quote", id, "attach-image-page", null, { index: input.index, total: input.total, image: url, sha256 }, true),
        ...completeImageUploadStatements(db, user, id),
      ]);
      if (!result[1].meta.changes) {
        await cleanupImages([key]);
        const concurrent = await db.prepare("SELECT sha256 FROM quote_image_pages WHERE quote_id=? AND page_index=?").bind(id, input.index).first<Row>();
        if (!concurrent || String(concurrent.sha256) !== sha256) throw new ApiError(409, "原图页数或内容刚被修改，请重新读取保存状态");
      }
    } catch (error) { await cleanupImages([key]); throw error; }
  }
  await quoteById(db, user, id);
  const pages = (await db.prepare("SELECT page_index,image_url FROM quote_image_pages WHERE quote_id=? ORDER BY page_index").bind(id).all<Row>()).results;
  const uploadedIndexes = pages.map(row => Number(row.page_index)), complete = pages.length === input.total;
  if (complete) {
    await db.batch(completeImageUploadStatements(db, user, id));
  }
  return { quote: await quoteById(db, user, id), uploadedIndexes, complete, total: input.total };
}
export async function getImage(id: string): Promise<Response> {
  const { user } = await authenticated();
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new ApiError(404, "图片不存在");
  const object = await bucket().get("images/" + id); if (!object) throw new ApiError(404, "图片不存在");
  if (!(await canReadImage(user, "/api/images/" + id, object.customMetadata?.ownerId || ""))) throw new ApiError(404, "图片不存在或无权访问");
  const contentType = object.httpMetadata?.contentType;
  return new Response(object.body, { headers: { "Content-Type": contentType && ["image/png", "image/jpeg", "image/webp"].includes(contentType) ? contentType : "image/png", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}

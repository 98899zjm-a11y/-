import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, FileCheck2, FileText, Loader2, RefreshCw } from "lucide-react";
import type { QuoteInput, QuoteRecord, QuoteTotals } from "@/lib/domain";
import { api } from "./bridge";
import { collaborationError, collaborationTime, type CollaborationUser } from "./collaboration-types";
import { normalizedAccess, mayOperate, type AccessUser } from "./module-access";
import "./collaboration.css";

export type SalesOrderStatus = "pending" | "approved" | "rejected" | "voided";
export type SalesOrderFilter = SalesOrderStatus | "effective" | "all";
export type SalesOrderMetrics = { orderCount: number; itemCount: number; amountCents: string; weightMicros: string; amount: number; weight: number };
export type SalesOrderSummary = Record<SalesOrderStatus | "effective", SalesOrderMetrics>;
export type SalesOrderListItem = {
  id: string; number: string; ownerId: string; ownerName: string; createdBy: string;
  sourceQuoteId: string; sourceRootId: string; sourceQuoteVersion: number;
  type: "sale" | "custom" | "tradein"; customerId: string; customerName: string;
  businessDate: string; status: SalesOrderStatus; revision: number; contentHash: string;
  amountCents: string; amount: number; weightMicros: string; weight: number; itemCount: number;
  reviewedBy?: string | null; reviewedName?: string | null; reviewedAt?: string | null; reviewNote?: string; createdAt: string;
};
export type SalesOrder = SalesOrderListItem & { snapshot: QuoteInput; totals: QuoteTotals };
export type SalesOrderEvent = { id?: string; action: string; actorName?: string; createdAt: string; note?: string };
export type SalesOrderReply = { order: SalesOrder; events?: SalesOrderEvent[] };
export type SalesOrderListReply = { orders: SalesOrderListItem[]; total: number; page: number; pageSize: number; summary: SalesOrderSummary; asOf?: string };
export type PersonalSalesOrdersReply = SalesOrderListReply & { source: "sales-orders"; asOf: string; series: (SalesOrderMetrics & { date: string })[]; byStaff: (SalesOrderMetrics & { staffId: string; name: string })[] };
export type CreateSalesOrderInput = { requestId: string; quoteId: string; businessDate: string; note?: string; salesStaffId?: string };
export type SalesOrderRequestReply = { request: { id: string; state: 'issued'|'cancelled'|'restored'; cancelledAt?: string }; order: SalesOrder|null; receipt?: { orderId:string;number:string;sourceQuoteId:string;sourceHash:string;businessDate:string } };
type OrderAttempt = { version: 1; input: CreateSalesOrderInput };
type SalesActor = CollaborationUser & AccessUser;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const salesOrderStatusLabels: Record<SalesOrderStatus, string> = { pending: "待财务审核", approved: "财务已审核", rejected: "财务已驳回", voided: "已作废" };
export const currentSalesMonth = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" }).slice(0, 7);
export function salesOrderMoney(value: string): string {
  if (!/^-?\d+$/.test(value)) return "—";
  const number = BigInt(value), absolute = (number < BigInt(0) ? -number : number).toString().padStart(3, "0");
  return `${number < BigInt(0) ? "-" : ""}${absolute.slice(0, -2)}.${absolute.slice(-2)}`;
}
export function salesOrderWeight(value: string): string {
  if (!/^-?\d+$/.test(value)) return "—";
  const number = BigInt(value), absolute = (number < BigInt(0) ? -number : number).toString().padStart(7, "0"), fraction = absolute.slice(-6).replace(/0+$/, "");
  return `${number < BigInt(0) ? "-" : ""}${absolute.slice(0, -6)}${fraction ? "." + fraction : ""}`;
}
export function validateSalesOrderList(value: SalesOrderListReply): SalesOrderListReply {
  if (!value || !Array.isArray(value.orders) || !Number.isSafeInteger(value.total) || !Number.isSafeInteger(value.page) || !Number.isSafeInteger(value.pageSize) || value.total < 0 || value.page < 1 || value.pageSize < 1) throw new Error("销售开单列表不完整，请刷新后重试。");
  for (const key of ["pending", "approved", "effective", "rejected", "voided"] as const) {
    const metric = value.summary?.[key];
    if (!metric || !Number.isSafeInteger(metric.orderCount) || !Number.isSafeInteger(metric.itemCount) || !/^-?\d+$/.test(metric.amountCents) || !/^-?\d+$/.test(metric.weightMicros)) throw new Error("销售开单汇总不完整，当前没有显示未经确认的合计。");
  }
  if (value.orders.some(order => !UUID.test(order.id) || !Object.hasOwn(salesOrderStatusLabels, order.status) || !/^-?\d+$/.test(order.amountCents) || !/^-?\d+$/.test(order.weightMicros))) throw new Error("销售开单明细不完整，请重新读取。");
  return value;
}
export function SalesOrderMetricsPanel({ summary }: { summary: SalesOrderSummary }) {
  return <><p className="muted-note">以下合计均为当前月份、员工与状态筛选范围内的数据。</p><div className="personal-sales-metrics">{([
    ["effective", "有效开单", "待审核与已审核开单；驳回、作废不计入"],
    ["pending", "待财务审核", "尚未完成财务审核"],
    ["approved", "财务已审核", "已通过财务审核"],
    ["rejected", "财务已驳回", "单列保留，不计有效开单"],
  ] as const).map(([key, label, note]) => <section key={key}><small>{label} · {summary[key].orderCount} 单</small><strong>¥{salesOrderMoney(summary[key].amountCents)}</strong><span>{salesOrderWeight(summary[key].weightMicros)} 克 · {summary[key].itemCount} 件</span><span>{note}</span></section>)}</div></>;
}
export function SalesOrderTable({ orders, onOpenOrder }: { orders: SalesOrderListItem[]; onOpenOrder?: (id: string) => void }) {
  return <div className="personal-sales-table"><table><thead><tr><th>业务日期／销售单号</th><th>客户</th><th>开单员工</th><th>件数</th><th>金重</th><th>开单金额</th><th>财务审核</th><th>报价来源</th></tr></thead><tbody>{orders.map(order => <tr key={order.id}><td>{order.businessDate}<small>{onOpenOrder ? <button className="text-button" onClick={() => onOpenOrder(order.id)}>{order.number}</button> : order.number}</small></td><td>{order.customerName}</td><td>{order.ownerName}</td><td>{order.itemCount}</td><td>{salesOrderWeight(order.weightMicros)} 克</td><td>¥{salesOrderMoney(order.amountCents)}</td><td><span className="tag">{salesOrderStatusLabels[order.status]}</span>{order.reviewedAt && <small>{collaborationTime(order.reviewedAt)}</small>}</td><td>V{order.sourceQuoteVersion}<small>详情可查原报价</small></td></tr>)}</tbody></table>{!orders.length && <p className="collaboration-empty">当前范围没有销售开单。</p>}</div>;
}
function readAttempt(key: string): OrderAttempt | null {
  const raw = localStorage.getItem(key); if (!raw) return null;
  const value = JSON.parse(raw) as OrderAttempt;
  if (value?.version !== 1 || !value.input || Object.keys(value.input).some(field => !["requestId", "quoteId", "businessDate", "note", "salesStaffId"].includes(field)) || !UUID.test(value.input.requestId) || !UUID.test(value.input.quoteId) || !/^\d{4}-\d{2}-\d{2}$/.test(value.input.businessDate) || value.input.note !== undefined && typeof value.input.note !== "string" || value.input.salesStaffId !== undefined && !UUID.test(value.input.salesStaffId)) throw new Error("本机保留的开单请求无法核对，请联系管理员；当前没有重复开单。");
  return value;
}
export default function SalesOrders({ user, users, sourceQuoteId, initialOrderId, scopeKey, revision = 0, onChooseQuote, onOpenQuote, onOpenWarranty, onSourceQuoteConsumed }: {
  user: SalesActor; users: { id: string; name: string; active?: boolean }[]; sourceQuoteId?: string | null; initialOrderId?: string | null; scopeKey?: string; revision?: number;
  onChooseQuote: () => void; onOpenQuote: (id: string) => void; onOpenWarranty?: (orderId: string) => void; onSourceQuoteConsumed?: () => void;
}) {
  const access = normalizedAccess(user).sales, canRead = access !== "disabled", canWrite = mayOperate(access), admin = user.role === "admin";
  const [month, setMonth] = useState(currentSalesMonth), [status, setStatus] = useState<SalesOrderFilter>("effective"), [staffId, setStaffId] = useState(""), [page, setPage] = useState(1), [reload, setReload] = useState(0);
  const [list, setList] = useState<SalesOrderListReply | null>(null), [quote, setQuote] = useState<QuoteRecord | null>(null), [detail, setDetail] = useState<SalesOrderReply | null>(null), [orderId, setOrderId] = useState(initialOrderId || "");
  const [businessDate, setBusinessDate] = useState(() => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" })), [note, setNote] = useState(""), [attempt, setAttempt] = useState<OrderAttempt | null>(null), [attemptReady, setAttemptReady] = useState(false);
  const [salesStaffId, setSalesStaffId] = useState(user.id);
  const [loading, setLoading] = useState(false), [sourceLoading, setSourceLoading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const busyRef = useRef(false), alive = useRef(true), canWriteRef = useRef(canWrite), attemptRef = useRef<OrderAttempt | null>(null);
  canWriteRef.current = canWrite;
  const attemptKey = `sales-order-attempt-v1:${scopeKey || user.id}`;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { setAttemptReady(false); try { const saved = readAttempt(attemptKey); attemptRef.current = saved; setAttempt(saved); setAttemptReady(true); } catch (problem) { setError(collaborationError(problem)); } }, [attemptKey]);
  useEffect(() => { setOrderId(initialOrderId || ""); }, [initialOrderId]);
  useEffect(() => {
    if (!canRead) { setList(null); return; } let current = true; setLoading(true); setError("");
    const query = new URLSearchParams({ month, status: status === "all" ? "" : status, page: String(page), pageSize: "30" }); if (admin && staffId) query.set("staffId", staffId);
    void api<SalesOrderListReply>(`/api/sales-orders?${query}`).then(value => { if (current) setList(validateSalesOrderList(value)); }).catch(problem => { if (current) { setList(null); setError(collaborationError(problem)); } }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [month, status, staffId, page, reload, revision, user.id, user.grantRevision, canRead, admin]);
  useEffect(() => {
    if (!canWrite || !sourceQuoteId) { setQuote(null); return; } let current = true; setQuote(null); setSourceLoading(true);
    void api<{ quote: QuoteRecord }>(`/api/quotes/${sourceQuoteId}`).then(value => { if (!current) return; if (!value.quote || value.quote.id !== sourceQuoteId || !["sale", "custom", "tradein"].includes(value.quote.type)) throw new Error("请选择已保存的销售、定制或换新报价。"); setQuote(value.quote); }).catch(problem => { if (current) setError(collaborationError(problem)); }).finally(() => { if (current) setSourceLoading(false); });
    return () => { current = false; };
  }, [sourceQuoteId, canWrite, user.id, user.grantRevision]);
  useEffect(() => {
    if (!canRead || !orderId) { setDetail(null); return; } let current = true; setDetail(null);
    void api<SalesOrderReply>(`/api/sales-orders/${orderId}`).then(value => { if (current) setDetail(value); }).catch(problem => { if (current) setError(collaborationError(problem)); });
    return () => { current = false; };
  }, [orderId, reload, user.id, user.grantRevision, canRead]);
  useEffect(() => { const refresh = () => { if (!document.hidden) setReload(value => value + 1); }; const timer = setInterval(refresh, 30000); window.addEventListener("focus", refresh); return () => { clearInterval(timer); window.removeEventListener("focus", refresh); }; }, [user.id, user.grantRevision]);
  const clearAttempt = () => {
    localStorage.removeItem(attemptKey);
    if (localStorage.getItem(attemptKey) !== null) throw new Error('本机仍保留旧请求，不能发起下一笔开单，请继续核对主机结果。');
    attemptRef.current = null; setAttempt(null);
  };
  const acceptOrder = (value: SalesOrderReply) => {
    if (!value?.order || !UUID.test(value.order.id) || !Object.hasOwn(salesOrderStatusLabels, value.order.status)) throw new Error("主机尚未返回可核对的销售单，请查询本次开单结果。");
    clearAttempt(); setDetail(value); setOrderId(value.order.id); setQuote(null); setNote(""); onSourceQuoteConsumed?.();
    setNotice(`销售单 ${value.order.number}：${salesOrderStatusLabels[value.order.status]}`); setReload(current => current + 1);
  };
  const acceptRequest = (value: SalesOrderRequestReply, current: OrderAttempt) => {
    if (attemptRef.current?.input.requestId !== current.input.requestId || value?.request?.id !== current.input.requestId) throw new Error('主机返回的请求编号不一致，原请求已保留。');
    if (value.request.state === 'issued') {
      if (!value.order || value.order.createdBy !== user.id) throw new Error('主机返回的开单人无法核对，原请求已保留。');
      acceptOrder({order:value.order}); return;
    }
    if (value.order !== null) throw new Error('主机返回的终态无法核对，原请求已保留。');
    if (value.request.state === 'cancelled') {
      if (typeof value.request.cancelledAt !== 'string' || !Number.isFinite(Date.parse(value.request.cancelledAt))) throw new Error('主机尚未确认取消时间，原请求已保留。');
      clearAttempt(); setNotice('本次未开单请求已安全结束。没有作废任何销售单；如需继续，请重新选择并明确开具下一单。');
    } else if (value.request.state === 'restored') {
      const receipt=value.receipt;
      if (!receipt || !UUID.test(receipt.orderId) || !UUID.test(receipt.sourceQuoteId) || !/^[a-f0-9]{64}$/.test(receipt.sourceHash) || typeof receipt.number!=='string' || !receipt.number || !/^\d{4}-\d{2}-\d{2}$/.test(receipt.businessDate)) throw new Error('已回退订单的历史凭据不完整，原请求已保留。');
      clearAttempt(); setNotice(`请求曾开具销售单 ${receipt.number}，但该单已随业务资料恢复而回退。它不计当前有效成交；请核对后再决定是否重新开单。`);
    } else throw new Error('主机尚未确认本次请求终态，原请求已保留。');
    setQuote(null); setNote(''); onSourceQuoteConsumed?.(); setReload(value=>value+1);
  };
  const sendAttempt = async (current: OrderAttempt) => {
    if (busyRef.current || !canWriteRef.current) return; busyRef.current = true; setBusy(true); setError(""); setNotice("");
    try { const result = await api<SalesOrderReply>("/api/sales-orders", "POST", current.input); if (alive.current && canWriteRef.current) acceptOrder(result); }
    catch (problem) { if (alive.current) setError(`${collaborationError(problem)} 请先查询本次开单结果；重试会继续同一个请求编号。`); }
    finally { busyRef.current = false; if (alive.current) setBusy(false); }
  };
  const issue = () => {
    if (busyRef.current || !canWriteRef.current || !quote || !attemptReady || attemptRef.current) return;
    try {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) throw new Error("请填写开单业务日期。");
      if (admin && (!UUID.test(salesStaffId) || salesStaffId!==user.id && !users.some(staff=>staff.id===salesStaffId&&staff.active!==false))) throw new Error('请选择当前启用的所属销售员工。');
      const value: OrderAttempt = { version: 1, input: { requestId: crypto.randomUUID(), quoteId: quote.id, businessDate, ...(admin ? {salesStaffId} : {}), ...(note.trim() ? { note: note.trim() } : {}) } };
      const encoded=JSON.stringify(value); localStorage.setItem(attemptKey,encoded);
      if(localStorage.getItem(attemptKey)!==encoded)throw new Error('开单编号尚未可靠保存，本次没有向主机提交。');
      attemptRef.current = value; setAttempt(value); void sendAttempt(value);
    } catch (problem) { setError(`开单请求尚未发出：${collaborationError(problem)}`); }
  };
  const queryAttempt = async () => {
    const current = attemptRef.current; if (!current || busyRef.current) return; busyRef.current = true; setBusy(true); setError("");
    try { const result = await api<SalesOrderRequestReply>(`/api/sales-orders/by-request/${current.input.requestId}`); if (alive.current && canWriteRef.current) acceptRequest(result,current); }
    catch (problem) { if (alive.current) setError(`${collaborationError(problem)} 当前仍保留原请求编号，没有新增开单。`); }
    finally { busyRef.current = false; if (alive.current) setBusy(false); }
  };
  const cancelAttempt = async () => {
    const current=attemptRef.current; if(!current||busyRef.current||!canWriteRef.current)return;
    busyRef.current=true;setBusy(true);setError('');
    try{const result=await api<SalesOrderRequestReply>(`/api/sales-orders/by-request/${current.input.requestId}/cancel`,'POST',{});if(alive.current&&canWriteRef.current)acceptRequest(result,current);}
    catch(problem){if(alive.current)setError(`${collaborationError(problem)} 原请求已保留，请查询结果或用同一编号再次核对；不会自动重新开单。`);}
    finally{busyRef.current=false;if(alive.current)setBusy(false);}
  };
  if (!canRead) return <div className="collaboration-empty">销售开单未获准查看，请联系管理员。</div>;
  return <div className="collaboration-page sales-orders"><header className="collaboration-heading"><div><span>SALES ORDERS</span><h2><FileCheck2 size={22}/>销售开单</h2><p>按已保存报价开具销售单，并送财务审核。报价、销售单与财务审核状态分别保留；开单金额不等于实际收款。</p></div><button className="button" disabled={busy || loading} onClick={() => setReload(value => value + 1)}><RefreshCw size={15}/>刷新开单</button></header>
    {!canWrite && <p className="access-readonly-note">当前为只查看权限，可核对销售单；开单和质保操作已关闭。</p>}
    {error && <p className="collaboration-feedback error" role="alert">{error}</p>}{notice && <p className="collaboration-feedback" role="status">{notice}</p>}
    {canWrite && <section className="panel"><div className="panel-title"><h2>从已保存报价开单</h2></div>{sourceLoading ? <p role="status">正在核对已保存报价…</p> : quote ? <p><strong>{quote.number} · V{quote.version} · {quote.customerName}</strong><br/>{quote.title} · 报价金额 ¥{quote.total.toFixed(2)}</p> : <p className="muted-note">先从报价历史选择一份已保存报价，再核对并开单。修改报价后须选择最新版本。</p>}<button className="button" disabled={busy || !!attempt} onClick={onChooseQuote}>选择报价开单</button><fieldset disabled={busy || !!attempt} style={{ border: 0, padding: 0, marginTop: 18 }}><div className="form-grid">{admin && <label className="field"><span>所属销售员工</span><select aria-label="所属销售员工" value={salesStaffId} onChange={event=>setSalesStaffId(event.target.value)}>{!users.some(staff=>staff.id===user.id)&&<option value={user.id}>本人（当前账号）</option>}{users.filter(staff=>staff.active!==false).map(staff=><option key={staff.id} value={staff.id}>{staff.name}</option>)}</select><small>业绩归属由财务审核确认，实际开单人另行留痕。</small></label>}<label className="field"><span>业务日期</span><input type="date" aria-label="销售开单业务日期" value={businessDate} onChange={event => setBusinessDate(event.target.value)}/></label><label className="field"><span>开单说明</span><textarea maxLength={1000} value={note} onChange={event => setNote(event.target.value)} placeholder="可填写交付或需财务核对的说明"/></label></div></fieldset><button className="button primary" disabled={busy || !quote || !attemptReady || !!attempt} onClick={issue}>开单并送财务审核</button><p className="muted-note">金额、客户及商品内容由主机冻结保存；开单后可在下方核对财务审核状态。</p>{attempt && <div className="collaboration-feedback"><p>本次开单请求编号：{attempt.input.requestId}。结果确认前，保留相同编号，避免重复开单。</p><button className="button" disabled={busy} onClick={() => void queryAttempt()}>查询本次开单结果</button><button className="button" disabled={busy} onClick={() => void sendAttempt(attempt)}>使用原请求重试开单</button><button className="button" disabled={busy || !canWrite} onClick={() => void cancelAttempt()}>核对并结束本次请求</button><p>主机未开单时安全结束请求；已开单则显示原单，不会作废或退款。没有收到明确结果时，继续保留原请求编号。</p></div>}</section>}
    <div className="personal-sales-filters"><label>业务月份<input type="month" value={month} onChange={event => { setMonth(event.target.value); setPage(1); }}/></label><label>订单状态<select value={status} onChange={event => { setStatus(event.target.value as SalesOrderFilter); setPage(1); }}>{([['effective','有效开单'],['all','全部状态'],['pending','待财务审核'],['approved','财务已审核'],['rejected','财务已驳回'],['voided','已作废']] as const).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>{admin && <label>开单员工<select value={staffId} onChange={event => { setStaffId(event.target.value); setPage(1); }}><option value="">全部员工</option>{users.map(staff => <option key={staff.id} value={staff.id}>{staff.name}</option>)}</select></label>}</div>
    {loading && <p role="status"><Loader2 size={16} className="spin"/>正在读取销售单…</p>}{list && <><SalesOrderMetricsPanel summary={list.summary}/><section className="panel"><h2>销售开单明细</h2><SalesOrderTable orders={list.orders} onOpenOrder={setOrderId}/><div className="collaboration-pagination"><button aria-label="上一页销售开单" disabled={page <= 1 || loading} onClick={() => setPage(value => value - 1)}><ChevronLeft size={16}/></button><span>第 {list.page} 页 · 共 {list.total} 单</span><button aria-label="下一页销售开单" disabled={page * list.pageSize >= list.total || loading} onClick={() => setPage(value => value + 1)}><ChevronRight size={16}/></button></div></section></>}
    {detail && <section className="panel"><div className="panel-title"><h2>{detail.order.number} · {salesOrderStatusLabels[detail.order.status]}</h2><button className="text-button" onClick={() => { setOrderId(""); setDetail(null); }}>收起详情</button></div><p>{detail.order.businessDate} · {detail.order.customerName} · 开单员工 {detail.order.ownerName}</p><p>开单金额 ¥{salesOrderMoney(detail.order.amountCents)} · {salesOrderWeight(detail.order.weightMicros)} 克 · {detail.order.itemCount} 件</p>{detail.order.reviewNote && <p className="collaboration-feedback">财务意见：{detail.order.reviewNote}</p>}<div className="page-actions"><button className="button" onClick={() => onOpenQuote(detail.order.sourceQuoteId)}>查看报价来源 V{detail.order.sourceQuoteVersion}</button><button className="button primary" disabled={!canWrite || !onOpenWarranty || !['pending','approved'].includes(detail.order.status)} onClick={() => { if (canWriteRef.current && onOpenWarranty) onOpenWarranty(detail.order.id); }}><FileText size={15}/>开具／打印订单质保</button></div>{canWrite && !onOpenWarranty && <p className="muted-note">当前主机暂不支持订单质保，请更新完整程序后再开具。</p>}{detail.events?.map((event,index) => <p className="muted-note" key={event.id || index}>{collaborationTime(event.createdAt)} · {event.actorName || ""} · {({ create: "开具销售单", approve: "财务审核通过", reject: "财务审核驳回", void: "作废销售单" } as Record<string, string>)[event.action] || "销售单操作"}{event.note ? ` · ${event.note}` : ""}</p>)}</section>}
  </div>;
}

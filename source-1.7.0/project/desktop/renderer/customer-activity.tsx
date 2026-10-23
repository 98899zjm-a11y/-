import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import type { CustomerActivity as Activity, CustomerActivityOrder } from "@/lib/domain";
import { api } from "./bridge";
import "./customer-picker.css";

const money = (value: number) => Number(value || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const savedAmount = (value: number | null) => typeof value === "number" && Number.isFinite(value) ? `¥${money(value)}` : "未保存";
const knownMoney = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const types: Record<string, string> = { sale: "销售", custom: "定制", tradein: "以旧换新", recycling: "回收", repair: "维修" };
type OrderActivity = CustomerActivityOrder & {
  sourceQuoteId?: string; sourceQuoteVersion?: number; status?: string;
  salesOrder?: { id: string; number: string; status: string };
};
const reviewLabels: Record<string, string> = { pending: "待财务审核", approved: "财务已审核", rejected: "财务已驳回", voided: "已作废" };

function ActivityDetails({ order }: { order: CustomerActivityOrder }) {
  const repair = order.type === "repair", candidate = order.repairBreakdown;
  const breakdown = repair && candidate?.source === "saved" && knownMoney(candidate.subtotal) && knownMoney(candidate.insurance) && typeof candidate.itemsComplete === "boolean" ? candidate : null;
  return <details><summary>{order.items.length} 项明细</summary>
    {repair && (!breakdown || !breakdown.itemsComplete) && <p>逐项金额未保存或不完整，保留原单单价和计费量。</p>}
    {order.items.map((item, index) => {
      const savedServiceSubtotal = repair && breakdown?.itemsComplete && item.amountSource === "saved" && knownMoney(item.subtotal) ? item.subtotal : null;
      return <p key={`${item.id}-${index}`}><strong>{item.title}</strong><br/>
        {item.mode ? `${item.mode === "gram" ? "按克" : item.mode === "count" ? "按次" : "固定价"} · 计价量 ${item.billQuantity ?? item.quantity} · 单价 ${knownMoney(item.unitPrice) ? `¥${money(item.unitPrice)}` : "—"}` : `${item.material} · ${item.quantity} 件 · ${item.weight.toFixed(3)} 克 · 金价 ¥${money(item.goldPrice)}/克 · 工费 ¥${money(item.laborPrice)}/克`}
        <br/>{repair ? savedServiceSubtotal !== null ? <>小计 ¥{money(savedServiceSubtotal)}</> : <>逐项金额未保存／暂不可用</> : <>附加费 ¥{money(item.extras)} · 小计 {item.subtotal === null ? "—" : `¥${money(item.subtotal)}`}</>}
      </p>;
    })}
    {repair && <p><strong>原单维修费用合计</strong> {breakdown ? `¥${money(breakdown.subtotal)}` : "—"}<br/>原单保价费 {breakdown ? `¥${money(breakdown.insurance)}` : "—"}<br/>保存总价 ¥{money(order.total)}{!breakdown && <><br/>原单金额分解暂不可用</>}</p>}
  </details>;
}

export default function CustomerActivity({ customerId, revision, repairAmountsPresentation, onOpen, onOpenOrder }: { customerId: string; revision: number; repairAmountsPresentation?: 1; onOpen: (id: string) => void; onOpenOrder?: (id: string) => void }) {
  const [basis, setBasis] = useState<"quotes" | "confirmed">("quotes"), [page, setPage] = useState(1), [result, setResult] = useState<Activity | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState("");
  useEffect(() => {
    let active = true; setLoading(true); setError(""); setResult(null);
    const params = new URLSearchParams({ basis, page: String(page), pageSize: "20" });
    if (repairAmountsPresentation === 1) params.set("presentation", "repair-saved-v1");
    void api<Activity>(`/api/customers/${customerId}/activity?${params}`).then(data => { if (active) setResult(data); }).catch(problem => { if (active) setError(problem instanceof Error ? problem.message : "客户明细暂时无法读取"); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [customerId, basis, page, revision, repairAmountsPresentation]);
  return <section className="customer-activity">
    <div className="customer-activity-tabs">{([['quotes', '报价明细'], ['confirmed', '成交明细']] as const).map(([key, title]) => <button className={basis === key ? "active" : ""} key={key} onClick={() => { setBasis(key); setPage(1); }}>{title}</button>)}</div>
    {loading && <p><Loader2 size={16} className="spin"/>正在读取客户完整明细…</p>}
    {error && <p className="feedback error" role="alert">{error}</p>}
    {result && <>
      <p className="customer-activity-note">{basis === "quotes" ? "按已保存版本逐条查看；不同版本可属于同一张订单，归档合计不等于实际成交合计。" : "以销售开单保存的记录为准，待财务审核与已审核分别标明；退回及作废不计有效成交。"}{result.metadata.sourceNote}</p>
      <div className="customer-activity-summary"><span>{basis === "quotes" ? "归档记录" : "成交单数"}<strong>{result.summary.orderCount}</strong></span><span>商品件数<strong>{result.summary.itemCount}</strong></span><span>优惠合计<strong>¥{money(result.summary.discount)}</strong></span><span>净金额／补退差额<strong>¥{money(result.summary.netBalance)}</strong></span></div>
      <div className="customer-activity-scroll"><table><thead><tr><th>{basis === "confirmed" ? "销售开单／来源报价" : "报价／版本"}</th><th>业务</th><th>保存／成交日期</th><th>件数</th><th>重量／计价量</th><th>报价金额／客户到手金额</th><th>优惠</th><th>净金额／补退差额</th><th>明细</th></tr></thead><tbody>{result.orders.map(value => { const order = value as OrderActivity; return <tr key={order.id}>
        <td><button disabled={basis === "confirmed" && !onOpenOrder} onClick={() => { if (basis === "confirmed") onOpenOrder?.(order.id); else onOpen(order.id); }}>{order.title}<small>{order.number}{basis === "confirmed" ? Number.isSafeInteger(order.sourceQuoteVersion) && (order.sourceQuoteVersion ?? 0) > 0 ? ` · 原报价 V${order.sourceQuoteVersion}` : " · 原报价版本未保存" : ` · V${order.version}`}</small></button></td>
        <td>{types[order.type]}{basis === "confirmed" && <small>{reviewLabels[order.status || order.salesOrder?.status || ""] || "审核状态待核对"}</small>}</td><td>{new Date(order.createdAt).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })}{order.confirmedAt && <small>开单：{new Date(order.confirmedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</small>}</td>
        <td>{order.itemCount}</td><td>{order.weight.toFixed(3)}<small>{order.weightLabel}</small></td>
        <td>¥{money(order.total)}<small>{order.amountLabel}{order.type === "tradein" && ` · 新首饰原价 ${savedAmount(order.grossNewJewelryValue)}`}</small></td>
        <td>¥{money(order.discount)}</td><td>¥{money(order.netBalance)}</td><td><ActivityDetails order={order}/></td>
      </tr>; })}</tbody></table>{!result.orders.length && <p className="customer-activity-note">暂无符合条件的明细</p>}</div>
      <p className="customer-activity-note">{result.metadata.weightNote}</p>
      <div className="pagination"><button disabled={page <= 1} onClick={() => setPage(value => value - 1)} aria-label="上一页客户明细">‹</button><span>第 {result.page} 页 · 共 {result.total} 条</span><button disabled={page * result.pageSize >= result.total} onClick={() => setPage(value => value + 1)} aria-label="下一页客户明细">›</button></div>
    </>}
  </section>;
}

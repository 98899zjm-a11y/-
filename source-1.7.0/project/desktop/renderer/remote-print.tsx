import { useEffect, useRef, useState } from "react";
import { Check, FileText, Loader2, Printer, RefreshCw, X } from "lucide-react";
import { quoteInputSchema, type QuoteRecord } from "@/lib/domain";
import { api } from "./bridge";
import type { SalesOrder } from "./sales-orders";
import { createWarrantySheets, validateWarrantyData, warrantyProductNames, type WarrantyData, type WarrantyDefaults, type WarrantyPreferences, type WarrantySheet } from "./warranty-data";
import "./remote-print.css";

type PrintKind = "quotation-a4" | "warranty";
type PrintStatus = "queued" | "printing" | "submitted" | "failed" | "uncertain";
type PrintTypeOption = { available: boolean; printerId: string; label: string; reason?: string; routingRevision?: number; paper?: unknown };
type PrintOptions = { available: boolean; printers: { id: string; label: string }[]; defaultPrinterId: string; defaults: WarrantyDefaults; reason?: string; types?: Partial<Record<PrintKind, PrintTypeOption>> };
type PrintJob = { id: string; status: PrintStatus; error?: string; createdAt: string; quoteId: string; kind: PrintKind; printerLabel?: string; routingRevision?: number; requestMeta?: { asOf?: string; acceptedSource?: unknown; comparison?: string; reprintOf?: string } };
type EditableKey = "goodsNumber" | "productName" | "phone" | "afterSalesWechat";
export type WarrantyPrintPresentation = { itemIndexes: number[]; overrides: ({ itemIndex: number } & Pick<WarrantyData, EditableKey>)[]; layoutOffsets?: Record<string,{xMm:number;yMm:number}>; fontSizes?: Record<string,number> };
type PrintIdentity = { quoteId: string; salesOrderId?: never } | { salesOrderId: string; quoteId?: never };
type PrintRequest = PrintIdentity & { version?: 2; requestId: string; kind: PrintKind; printerId: string; copies: number; warranty?: { itemIndexes: number[]; overrides: ({ itemIndex: number } & Pick<WarrantyData, EditableKey>)[] }; layoutOffsets?: WarrantyPrintPresentation['layoutOffsets']; fontSizes?: WarrantyPrintPresentation['fontSizes']; reprintOf?: string; reprintConfirmed?: true };
type Attempt = { input: PrintRequest; job?: PrintJob };
const editableFields: { key: EditableKey; label: string; maximum: number }[] = [
  { key: "goodsNumber", label: "货品编号", maximum: 60 }, { key: "productName", label: "品名", maximum: 100 },
  { key: "phone", label: "电话", maximum: 50 }, { key: "afterSalesWechat", label: "售后微信", maximum: 50 },
];
const statusText: Record<PrintStatus, string> = { queued: "主机已接收，等待打印", printing: "主机正在准备打印", submitted: "已提交主机打印队列，请核对出纸", failed: "主机未能提交打印", uncertain: "打印结果暂不确定，请先到主机核对是否出纸。程序不会自动重复打印。" };
const terminal = (job?: PrintJob) => !!job && ["submitted", "failed", "uncertain"].includes(job.status);
export function centralSalePrintRequest(input: PrintRequest) {
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const hasQuote = Object.hasOwn(input, 'quoteId'), hasOrder = Object.hasOwn(input, 'salesOrderId');
  if (hasQuote === hasOrder || !uuid.test(String(hasOrder ? input.salesOrderId : input.quoteId)) || !['quotation-a4', 'warranty'].includes(input.kind)) throw new Error('打印单据来源无效，请重新读取已保存单据。');
  if (hasOrder && (input.kind !== 'warranty' || input.version !== 2)) throw new Error('销售开单仅通过统一质保单来源打印。');
  if(input.version!==2)return input;
  return {version:2,requestId:input.requestId,source:hasOrder?{type:'warranty',salesOrderId:input.salesOrderId}:{type:input.kind,quoteId:input.quoteId},copies:input.copies,presentation:{language:'zh',...(input.kind==='warranty'?{warranty:input.warranty,...(input.layoutOffsets?{layoutOffsets:input.layoutOffsets}:{}),...(input.fontSizes?{fontSizes:input.fontSizes}:{})}:{})},...(input.reprintOf?{reprintOf:input.reprintOf,reprintConfirmed:true}:{})};
}

// Unified printing never guesses a device from an old default or printer list.
// Keep the legacy fields readable for defaults and restored jobs, but require
// an explicit per-type binding before enabling a new physical print request.
export function printOptionForKind(options: PrintOptions | null, kind: PrintKind): PrintTypeOption {
  if (!options?.types) return { available: false, printerId: "", label: "尚未读取统一打印绑定", reason: "主机打印服务需升级到统一打印版本，再由管理员绑定质保单和 A4 设备。" };
  const route = options.types[kind];
  if (!route) return { available: false, printerId: "", label: "该类型尚未绑定", reason: "管理员尚未设置这类单据的主机打印设备。" };
  return { ...route, available: !!route.available && !!route.printerId };
}

// Schema normalization strips snapshot metadata. Image attachments and version
// ancestry do not alter what the canonical saved quotation will print.
export function quotePrintFingerprint(value: unknown): string | null {
  const result = quoteInputSchema.safeParse(value);
  if (!result.success) return null;
  const { images: _images, baseQuoteId: _baseQuoteId, ...quote } = result.data;
  return JSON.stringify(quote);
}
export function isCurrentSavedQuote(draft: unknown, saved: (QuoteRecord & { data?: unknown }) | null): boolean {
  if (!saved) return false;
  const current = quotePrintFingerprint(draft);
  return current !== null && current === quotePrintFingerprint(saved.data || saved.snapshot);
}

function restoreAttempt(key: string, identity: PrintIdentity): Attempt | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null") as Attempt | null;
    if (!value?.input || !/^[0-9a-f-]{36}$/i.test(value.input.requestId)) return null;
    const same = identity.salesOrderId ? value.input.salesOrderId === identity.salesOrderId && !Object.hasOwn(value.input, 'quoteId') : value.input.quoteId === identity.quoteId && !Object.hasOwn(value.input, 'salesOrderId');
    return same ? value : null;
  } catch { return null; }
}

type RemotePrintProps = ({ quote: QuoteRecord; salesOrder?: never } | { salesOrder: SalesOrder; quote?: never }) & { scope: string; onClose: () => void; initialKind?: PrintKind; initialWarranty?: WarrantyPrintPresentation; allowedKinds?: PrintKind[] };
export default function RemotePrint({ quote, salesOrder, scope, onClose, initialKind='quotation-a4', initialWarranty, allowedKinds }: RemotePrintProps) {
  const record = salesOrder || quote;
  const identity: PrintIdentity = salesOrder ? { salesOrderId: salesOrder.id } : { quoteId: quote!.id };
  const cacheKey = salesOrder ? `jewelry-remote-print-order-v1-${scope}-${salesOrder.id}` : `jewelry-remote-print-v1-${scope}-${quote!.id}`;
  const intrinsicKinds: PrintKind[] = salesOrder ? (['pending', 'approved'].includes(salesOrder.status) ? ['warranty'] : []) : ['sale', 'custom', 'tradein'].includes(record.type) ? ['quotation-a4', 'warranty'] : ['quotation-a4'];
  const permittedKinds = intrinsicKinds.filter(value => allowedKinds === undefined || allowedKinds.includes(value));
  const policy = useRef({ cacheKey, permittedKinds });
  policy.current = { cacheKey, permittedKinds };
  const maySubmitKind = (value: PrintKind) => policy.current.cacheKey === cacheKey && policy.current.permittedKinds.includes(value);
  const [attempt, setAttempt] = useState<Attempt | null>(() => restoreAttempt(cacheKey, identity));
  const attemptRef = useRef(attempt);
  const alive = useRef(true), pendingCall = useRef(false);
  const [options, setOptions] = useState<PrintOptions | null>(null), [loading, setLoading] = useState(true), [sending, setSending] = useState(false);
  const [error, setError] = useState(""), [checking, setChecking] = useState(false), [verifiedNoPaper, setVerifiedNoPaper] = useState(false);
  const [kind, setKind] = useState<PrintKind>(attempt?.input.kind || (permittedKinds.includes(initialKind) ? initialKind : permittedKinds[0]) || initialKind), [printerId, setPrinterId] = useState(attempt?.input.printerId || ""), [copies, setCopies] = useState(attempt?.input.copies || 1);
  const [sheets, setSheets] = useState<WarrantySheet[]>([]), [selected, setSelected] = useState<number[]>([]), [warrantyError, setWarrantyError] = useState("");
  const sheetsRef = useRef<WarrantySheet[]>([]), contacts = useRef<WarrantyPreferences>({ phone: "", afterSalesWechat: "" }), contactsDirty = useRef(false), preferenceQueue = useRef<Promise<unknown>>(Promise.resolve()), closingRef = useRef(false);
  const [closing, setClosing] = useState(false);
  const warrantyAllowed = permittedKinds.includes('warranty');
  const locked = !!attempt;
  const route = printOptionForKind(options, kind);
  const available = maySubmitKind(kind) && route.available && route.printerId === printerId;
  const printerLabel = locked && printerId !== route.printerId ? options?.printers.find(printer => printer.id === printerId)?.label || "已有请求保留的原绑定设备" : route.label;
  const chooseKind = (next: PrintKind) => {
    if (pendingCall.current || attemptRef.current || closingRef.current || !maySubmitKind(next)) return;
    setKind(next); setPrinterId(printOptionForKind(options, next).printerId);
  };
  useEffect(() => {
    if (!attemptRef.current && !maySubmitKind(kind) && permittedKinds.length) {
      setKind(permittedKinds[0]); setPrinterId(printOptionForKind(options, permittedKinds[0]).printerId);
    }
  }, [permittedKinds.join(','), kind, options]);
  const editWarranty = (at: number, key: EditableKey, value: string) => {
    if (pendingCall.current || attemptRef.current || closingRef.current) return;
    const shared = key === "phone" || key === "afterSalesWechat";
    const next = sheetsRef.current.map((item, index) => index === at || shared ? { ...item, data: { ...item.data, [key]: value } } : item);
    sheetsRef.current = next; setSheets(next);
    if (shared) { contacts.current = { ...contacts.current, [key]: value }; contactsDirty.current = true; }
  };
  const savePreferences = (force = false) => {
    if (!contactsDirty.current && !force) return preferenceQueue.current;
    const value = { ...contacts.current };
    const pending = preferenceQueue.current.catch(() => {}).then(() => api<WarrantyPreferences>("/api/warranty-preferences", "PATCH", value)).then(() => {
      if (contacts.current.phone === value.phone && contacts.current.afterSalesWechat === value.afterSalesWechat) contactsDirty.current = false;
    });
    preferenceQueue.current = pending; return pending;
  };
  const rememberContacts = () => { void savePreferences().catch(problem => { if (alive.current) setError(problem instanceof Error ? problem.message : "电话与售后微信暂时未能记住"); }); };
  const close = async () => {
    if (closingRef.current) return;
    closingRef.current = true; setClosing(true);
    try { await savePreferences(); if (alive.current) onClose(); }
    catch (problem) { if (alive.current) setError(problem instanceof Error ? problem.message : "电话与售后微信未能记住，请重试后关闭"); }
    finally { closingRef.current = false; if (alive.current) setClosing(false); }
  };

  const saveAttempt = (value: Attempt | null): boolean => {
    const previous = attemptRef.current;
    try {
      if (value) {
        if (previous && previous.input.requestId !== value.input.requestId) throw new Error("不能覆盖未清除的打印请求");
        const encoded = JSON.stringify(value);
        localStorage.setItem(cacheKey, encoded);
        if (localStorage.getItem(cacheKey) !== encoded) throw new Error("请求编号未能保存");
      } else {
        localStorage.removeItem(cacheKey);
        if (localStorage.getItem(cacheKey) !== null) throw new Error("旧请求记录未能清除");
      }
      attemptRef.current = value;
      if (alive.current) setAttempt(value);
      return true;
    } catch {
      // Status persistence may fail after the host has accepted. Keep the old
      // durable input/id, while showing the received status in this window.
      if (value && previous?.input.requestId === value.input.requestId) {
        attemptRef.current = value;
        if (alive.current) setAttempt(value);
      }
      if (alive.current) setError(!value ? "手机未能清除旧请求记录，不能创建新的打印请求。请继续核对主机状态，恢复手机存储后重试。" : previous ? "主机状态已收到，但手机未能保存状态更新。原请求编号仍保留，请继续查询主机状态，不要重复下单。" : "手机未能保存打印请求编号，本次未向主机提交。请恢复手机存储空间或权限后重试。");
      return false;
    }
  };
  const loadOptions = async () => {
    setLoading(true); setError("");
    try {
      const [result, preferences] = await Promise.all([api<PrintOptions>("/api/print-options"), warrantyAllowed ? api<WarrantyPreferences>("/api/warranty-preferences") : Promise.resolve(null)]);
      if (!alive.current) return;
      setOptions(result);
      if (!attemptRef.current) setPrinterId(printOptionForKind(result, kind).printerId);
      if (warrantyAllowed) {
        try {
          const initial = createWarrantySheets(record.snapshot, { ...result.defaults, ...preferences }, { date: new Date(record.createdAt).toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" }) });
          const previous = attemptRef.current?.input.warranty || initialWarranty;
          if (!sheetsRef.current.length) {
            const next = initial.map((sheet, index) => {
              const override = previous?.overrides.find(item => item.itemIndex === index);
              const allowed = Object.fromEntries(editableFields.flatMap(field => override?.[field.key] !== undefined ? [[field.key, override[field.key]]] : []));
              return { ...sheet, data: { ...sheet.data, ...allowed, standard: sheet.data.standard } };
            });
            sheetsRef.current = next; setSheets(next);
            contacts.current = { phone: next[0]?.data.phone || "", afterSalesWechat: next[0]?.data.afterSalesWechat || "" };
          }
          setSelected(current => current.length ? current : previous?.itemIndexes || initial.map((_sheet, index) => index));
          setWarrantyError("");
        } catch (problem) { setWarrantyError(problem instanceof Error ? problem.message : "此报价无法生成质保单"); }
      }
    } catch (problem) { if (alive.current) setError(problem instanceof Error ? problem.message : "主机打印设置暂时无法读取"); }
    finally { if (alive.current) setLoading(false); }
  };
  useEffect(() => {
    alive.current = true;
    void loadOptions();
    return () => { alive.current = false; };
    // This dialog is keyed by canonical quote id and account scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checkStatus = async () => {
    const current = attemptRef.current;
    if (!current || pendingCall.current) return;
    pendingCall.current = true; if (alive.current) setChecking(true);
    try {
      const lookup = current.job?.id ? `/api/print-jobs/${current.job.id}` : `/api/print-jobs/by-request/${current.input.requestId}`;
      const result = await api<{ job: PrintJob }>(lookup);
      if (!alive.current) return;
      if (saveAttempt({ ...current, job: result.job })) setError("");
    } catch (problem) {
      if (alive.current) setError(`${problem instanceof Error ? problem.message : "状态暂时无法查询"}。本次请求已保留，请恢复连接后查询或继续提交同一请求。`);
    } finally { pendingCall.current = false; if (alive.current) setChecking(false); }
  };
  useEffect(() => {
    if (!attempt || terminal(attempt.job)) return;
    let canceled = false, timer: ReturnType<typeof setTimeout>;
    const poll = async () => { await checkStatus(); if (!canceled && alive.current && !terminal(attemptRef.current?.job)) timer = setTimeout(() => void poll(), 3500); };
    timer = setTimeout(() => void poll(), 1200);
    return () => { canceled = true; clearTimeout(timer); };
    // Avoid restarting the polling loop after each unchanged host status.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt?.input.requestId, attempt?.job?.status]);

  const submit = async () => {
    if (pendingCall.current || sending || closingRef.current) return;
    pendingCall.current = true; setSending(true);
    setError("");
    try {
      if (!maySubmitKind(attemptRef.current?.input.kind || kind)) throw new Error('此入口已不允许提交这类单据。原请求仍可查询，请到销售开单办理质保。');
      if (!available) throw new Error(route.reason || "当前单据的固定主机打印设备不可用，请由管理员核对；不会转到其他设备。");
      let current = attemptRef.current;
      if (current?.job) throw new Error("此请求已有主机作业，请查询状态后处理。");
      if (!current) {
        if (kind === "warranty" && (!warrantyAllowed || warrantyError || !selected.length)) throw new Error(warrantyError || "请选择至少一件需要质保单的商品");
        const indexes = [...selected].sort((a, b) => a - b);
        if (kind === "warranty") { indexes.forEach(index => validateWarrantyData(sheetsRef.current[index].data)); await savePreferences(true); }
        if (!alive.current || closingRef.current) return;
        current = { input: { version:2, requestId: crypto.randomUUID(), ...identity, kind, printerId, copies, ...(kind === "warranty" ? { warranty: { itemIndexes: indexes, overrides: indexes.map(index => ({ itemIndex: index, ...Object.fromEntries(editableFields.map(field => [field.key, sheetsRef.current[index].data[field.key]])) as Pick<WarrantyData, EditableKey> })) }, ...(initialWarranty?.layoutOffsets?{layoutOffsets:initialWarranty.layoutOffsets}:{}), ...(initialWarranty?.fontSizes?{fontSizes:initialWarranty.fontSizes}:{}) } : {}) } };
        // Store before sending: a timeout may occur after the host has accepted.
        if (!saveAttempt(current)) return;
      }
      if (!maySubmitKind(current.input.kind)) throw new Error('打印入口已变更，本次请求已保留，请只查询原任务状态。');
      const result = await api<{ job: PrintJob }>("/api/print-jobs", "POST", centralSalePrintRequest(current.input));
      saveAttempt({ ...current, job: result.job });
    } catch (problem) {
      if (alive.current) setError(`${problem instanceof Error ? problem.message : "打印请求尚未确认"}${attemptRef.current ? "。本次请求已保留，请先查询状态；再次提交将沿用同一请求编号。" : ""}`);
    } finally { pendingCall.current = false; if (alive.current) setSending(false); }
  };
  const newIntent = () => { const previous=attemptRef.current;if(previous&&!maySubmitKind(previous.input.kind)){setError('此入口不允许补打该单据，请保留原任务并到销售开单核对。');return;}if(!previous?.job||!terminal(previous.job)||!verifiedNoPaper){setError('请先核对原任务及出纸情况，再确认补打。');return;}const next:Attempt={input:{...previous.input,version:2,requestId:crypto.randomUUID(),reprintOf:previous.job.id,reprintConfirmed:true}};try{const encoded=JSON.stringify(next);localStorage.setItem(cacheKey,encoded);if(localStorage.getItem(cacheKey)!==encoded)throw Error('未能保存');attemptRef.current=next;setAttempt(next);setError('');setVerifiedNoPaper(false);}catch{setError('新的关联补打编号未能保存，不能提交。原任务仍需核对。');} };

  return <div className="remote-print-backdrop"><section className="remote-print-dialog" role="dialog" aria-modal="true" aria-labelledby="remote-print-title"><header><div><span>WORKSTUDIO PRINT</span><h2 id="remote-print-title">主机打印</h2></div><button className="remote-print-icon" disabled={closing} onClick={() => void close()} aria-label="关闭主机打印"><X size={20}/></button></header>
    <div className="remote-print-body"><div className="remote-print-quote"><FileText size={19}/><div><strong>{record.snapshot.title}</strong><span>{record.customerName} · {record.number} · {salesOrder ? `修订 ${salesOrder.revision}` : `V${quote!.version}`}</span></div></div><p className="remote-print-note">打印使用这份已保存{salesOrder ? '销售单' : '报价'}。关闭窗口只停止查询，不会取消已交给主机的打印。</p>
      {error && <div className="remote-print-feedback error" role="alert">{error}</div>}
      {loading && <p className="remote-print-loading"><Loader2 size={17} className="spin"/>正在读取主机打印设置…</p>}
      {!loading && !available && <div className="remote-print-feedback">{locked && printerId !== route.printerId ? "主机绑定已变化。本次请求仍保留原设备，请先查询已有请求状态；不能改设备后重复提交。" : route.reason || "这类单据的主机打印设备暂不可用。"}<p>质保单和 A4 各使用管理员绑定的固定设备。单台设备不可用时，不会改用另一台打印机。</p><button className="remote-print-button" onClick={() => void loadOptions()} disabled={sending}><RefreshCw size={16}/>重新读取设置</button></div>}
      <fieldset className="remote-print-form" disabled={locked || loading || sending || closing}><div className="remote-print-kinds">{permittedKinds.includes("quotation-a4") && <button className={kind === "quotation-a4" ? "selected" : ""} onClick={() => chooseKind("quotation-a4")}><FileText size={18}/>A4 报价单</button>}{warrantyAllowed && <button className={kind === "warranty" ? "selected" : ""} onClick={() => chooseKind("warranty")}><Check size={18}/>质保单</button>}</div><div className="remote-print-grid"><label>主机绑定设备<input readOnly value={printerLabel}/></label><label>每份打印次数<select value={copies} onChange={event => setCopies(Number(event.target.value))}>{[1, 2, 3].map(value => <option key={value} value={value}>{value} 份</option>)}</select></label></div>
        {kind === "quotation-a4" && <p className="remote-print-note">商品、费用和收款信息按已保存报价打印；多页报价会完整打印。</p>}
        {kind === "warranty" && <><p className="remote-print-note">每个选中商品／款式一张质保单。重量、执行标准栏每克金价、件数、金额和日期自动取自已保存{salesOrder ? '销售单' : '报价'}；品名可选择或自定义，仅修改本次质保单。电话与微信自动记住。</p>{warrantyError && <div className="remote-print-feedback error">{warrantyError}</div>}{sheets.length > 1 && <div className="remote-print-selection"><button onClick={() => setSelected(sheets.map((_sheet, index) => index))}>全选</button><button onClick={() => setSelected([])}>清空选择</button><span>已选 {selected.length} 项</span></div>}{sheets.map((sheet, index) => <section className="remote-print-item" key={sheet.id}><label className="remote-print-item-title"><input type="checkbox" checked={selected.includes(index)} onChange={event => setSelected(current => event.target.checked ? [...current, index] : current.filter(value => value !== index))}/><strong>{index + 1}. {sheet.data.productName}</strong></label><div className="remote-print-facts"><span>重量：{sheet.data.weight}</span><span>执行标准：{sheet.data.standard}</span><span>件数：{sheet.data.quantity}</span><span>金额：¥{sheet.data.amount}</span><span>合计：¥{sheet.data.total}</span><span>日期：{sheet.data.date}</span></div>{sheet.data.tradeInNote && <p className="remote-print-note" style={{whiteSpace:"pre-wrap"}}>{sheet.data.tradeInNote}</p>}{selected.includes(index) && <div className="remote-print-grid">{editableFields.map(field => <label key={field.key}>{field.label}{field.key === "productName" && <select aria-label={`选择第${index + 1}款质保品名`} value={warrantyProductNames.includes(sheet.data.productName as typeof warrantyProductNames[number]) ? sheet.data.productName : "custom"} onChange={event => editWarranty(index, "productName", event.target.value === "custom" ? "" : event.target.value)}><option value="custom">报价品名 / 自定义</option>{warrantyProductNames.map(name => <option key={name} value={name}>{name}</option>)}</select>}<input maxLength={field.maximum} value={sheet.data[field.key]} onChange={event => editWarranty(index, field.key, event.target.value)} onBlur={field.key === "phone" || field.key === "afterSalesWechat" ? rememberContacts : undefined}/></label>)}</div>}</section>)}</>}
      </fieldset>
      {attempt && <section className={`remote-print-job ${attempt.job?.status || "pending"}`} role="status"><strong>{attempt.job ? statusText[attempt.job.status] : "请求尚未确认，请先查询主机状态"}</strong>{attempt.job?.error && <p>{attempt.job.error}</p>}<small>同一请求的再次提交会保留编号，避免重复下单。</small>{attempt.job?.requestMeta && <><p>受理时点：{attempt.job.requestMeta.asOf} · 固定设备：{attempt.job.printerLabel} · 修订：{attempt.job.routingRevision}</p>{attempt.job.requestMeta.reprintOf&&<p>补打关联原任务：{attempt.job.requestMeta.reprintOf}</p>}<details><summary>受理来源与筛选</summary><pre>{JSON.stringify(attempt.job.requestMeta.acceptedSource,null,2)}</pre></details></>}<button className="remote-print-button" disabled={sending || checking} onClick={() => void checkStatus()}><RefreshCw size={16}/>{checking ? "正在查询…" : "查询主机状态"}</button>{terminal(attempt.job) && maySubmitKind(attempt.input.kind) && <label className="remote-print-verify"><input type="checkbox" checked={verifiedNoPaper} onChange={event => setVerifiedNoPaper(event.target.checked)}/>我已在主机核对原任务和出纸情况，确认需要有记录的补打</label>}</section>}
    </div><footer><button className="remote-print-button" disabled={closing} onClick={() => void close()}>关闭</button>{(!attempt || !attempt.job) && <button className="remote-print-button primary" disabled={closing || loading || sending || checking || !available || kind === "warranty" && (!!warrantyError || !selected.length)} onClick={() => void submit()}>{sending ? <Loader2 size={17} className="spin"/> : <Printer size={17}/>}<span>{attempt ? "继续提交同一请求" : "提交主机打印"}</span></button>}{terminal(attempt?.job) && maySubmitKind(attempt!.input.kind) && <button className="remote-print-button" disabled={closing || !verifiedNoPaper || checking || sending} onClick={newIntent}>建立有记录的关联补打</button>}</footer>
  </section></div>;
}

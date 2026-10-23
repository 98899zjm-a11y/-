import { useEffect, useRef, useState } from "react";
import { canHandleModalKey } from "./modal-focus";
import { Check, FileText, Loader2, Printer, RefreshCw, Save, ShieldCheck, X } from "lucide-react";
import "./host-print-settings.css";

type BindingKey = "warrantyDeviceName" | "a4DeviceName";
type RouteKey = "warranty" | "a4";
type PrinterChoice = { id: string; deviceName: string; label: string };
type PrintProfile = { deviceName?: string; printerId: string; label: string; available: boolean; reason?: string; paper: "A4" | { widthMm: number; heightMm: number } | null };
export type HostPrintOptions = {
  routingRevision: number; canManage: boolean; profiles: Record<RouteKey, PrintProfile>; printers: PrinterChoice[];
  changes?: { revision: number; at: string; actorId: string; before: Record<BindingKey, string>; after: Record<BindingKey, string> }[];
  auditWarning?: string;
};
type RoutingResult = HostPrintOptions | { ok: boolean; options?: HostPrintOptions; error?: string; auditWarning?: string };
export type HostPrintBridge = {
  getHostPrintRouting?: () => Promise<RoutingResult>;
  saveHostPrintRouting?: (input: { expectedRevision: number } & Record<BindingKey, string>) => Promise<RoutingResult>;
  getPrinters: () => Promise<{ name: string; displayName?: string; isDefault?: boolean }[]>;
};
export type HostPrintSettingsState = { loading: boolean; saving: boolean; options: HostPrintOptions | null; printers: PrinterChoice[]; draft: Record<BindingKey, string>; error: string; notice: string; auditWarning: string };
const initialState = (): HostPrintSettingsState => ({ loading: true, saving: false, options: null, printers: [], draft: { warrantyDeviceName: "", a4DeviceName: "" }, error: "", notice: "", auditWarning: "" });
const problemText = (problem: unknown, fallback: string) => problem instanceof Error ? problem.message : fallback;

function unpackRouting(result: RoutingResult): HostPrintOptions {
  if (!result || typeof result !== "object") throw new Error("主机打印设置返回无效，请重新读取。");
  if ("ok" in result && !result.ok) throw new Error(result.error || "打印绑定未能保存，请刷新后重试。");
  const value = "ok" in result ? result.options : result;
  if (!value || !Number.isSafeInteger(value.routingRevision) || value.routingRevision < 0 || typeof value.canManage !== "boolean" || !value.profiles?.warranty || !value.profiles?.a4 || !Array.isArray(value.printers)) throw new Error("主机打印服务需更新到统一打印版本。");
  if (value.canManage && [value.profiles.warranty.deviceName, value.profiles.a4.deviceName].some(name => typeof name !== "string" || name.length > 240 || /[\x00-\x1f\x7f]/.test(name))) throw new Error("主机打印绑定数据无效，请重新读取。");
  return { ...value, auditWarning: value.auditWarning || result.auditWarning || "" };
}

// The same controller drives the modal and its asynchronous contract tests.
// It owns no database or printer API beyond the three authenticated IPC calls.
export function createHostPrintSettingsController({ bridge, onChange }: { bridge: HostPrintBridge; onChange: (state: HostPrintSettingsState) => void }) {
  let state = initialState(), alive = true, generation = 0;
  const emit = (next: Partial<HostPrintSettingsState>) => { if (!alive) return; state = { ...state, ...next }; onChange(state); };
  const draftOf = (options: HostPrintOptions) => ({ warrantyDeviceName: options.profiles.warranty.deviceName || "", a4DeviceName: options.profiles.a4.deviceName || "" });
  return {
    async load() {
      if (!alive || state.saving) return;
      const turn = ++generation;
      emit({ loading: true, error: "", notice: "", auditWarning: "" });
      try {
        if (!bridge.getHostPrintRouting || !bridge.getPrinters) throw new Error("当前程序需更新到统一主机打印版本。");
        const [result, native] = await Promise.all([bridge.getHostPrintRouting(), bridge.getPrinters()]);
        if (!alive || turn !== generation) return;
        const options = unpackRouting(result);
        if (!Array.isArray(native)) throw new Error("本机打印设备枚举无效，请重新读取。");
        const counts = new Map<string, number>();
        native.forEach(device => { if (typeof device?.name === "string") counts.set(device.name, (counts.get(device.name) || 0) + 1); });
        const printers = options.printers.filter(device => typeof device?.deviceName === "string" && device.deviceName && counts.get(device.deviceName) === 1);
        emit({ options, printers, draft: draftOf(options), error: options.canManage ? "" : "只有本机主机管理员可以修改设备绑定，请重新登录。", auditWarning: options.auditWarning || "" });
      } catch (problem) {
        if (alive && turn === generation) emit({ options: null, printers: [], error: problemText(problem, "主机打印绑定暂时无法读取。") });
      } finally { if (alive && turn === generation) emit({ loading: false }); }
    },
    edit(key: BindingKey, value: string) {
      if (!alive || state.loading || state.saving || !state.options?.canManage || !["warrantyDeviceName", "a4DeviceName"].includes(key)) return;
      emit({ draft: { ...state.draft, [key]: value }, error: "", notice: "", auditWarning: "" });
    },
    async save() {
      if (!alive || state.loading || state.saving) return;
      if (!state.options?.canManage) { emit({ error: "只有本机主机管理员可以修改设备绑定。" }); return; }
      const input = { expectedRevision: state.options.routingRevision, ...state.draft };
      if ([input.warrantyDeviceName, input.a4DeviceName].some(name => name && !state.printers.some(device => device.deviceName === name))) { emit({ error: "请选择当前主机枚举到的实体设备；不能改用默认打印机。", notice: "" }); return; }
      const turn = generation;
      emit({ saving: true, error: "", notice: "", auditWarning: "" });
      try {
        if (!bridge.saveHostPrintRouting) throw new Error("当前程序需更新到统一主机打印版本。");
        const options = unpackRouting(await bridge.saveHostPrintRouting(input));
        if (!alive || turn !== generation) return;
        emit({ options, draft: draftOf(options), notice: options.canManage ? "双设备绑定已保存，后续任务按这次绑定排队。" : "", error: options.canManage ? "" : "主机管理员权限已变化，请重新登录。", auditWarning: options.auditWarning || "" });
      } catch (problem) { if (alive && turn === generation) emit({ error: problemText(problem, "打印绑定未能保存，请刷新后重新选择。") }); }
      finally { if (alive && turn === generation) emit({ saving: false }); }
    },
    dispose() { alive = false; generation++; },
  };
}

export function hostPrintRouteStatus(options: HostPrintOptions | null, key: RouteKey) {
  const profile = options?.profiles[key];
  const paper = key === "a4" ? "A4 · 210 × 297 mm" : profile?.paper && typeof profile.paper === "object" ? `${profile.paper.widthMm} × ${profile.paper.heightMm} mm` : "按原质保单套打设置";
  return { available: !!profile?.available, label: profile?.label || profile?.deviceName || "未绑定", reason: profile?.available ? "可接受此类打印任务" : profile?.reason || "请先绑定此类打印设备", paper };
}

export default function HostPrintSettings({ onClose, bridge }: { onClose: () => void; bridge?: HostPrintBridge }) {
  const [state, setState] = useState<HostPrintSettingsState>(initialState);
  const controller = useRef<ReturnType<typeof createHostPrintSettingsController> | null>(null), modal = useRef<HTMLElement>(null), busy = useRef(false), closeRef = useRef(onClose);
  closeRef.current = onClose; busy.current = state.saving;
  useEffect(() => {
    const instance = createHostPrintSettingsController({ bridge: bridge || window.jewelryDesktop as unknown as HostPrintBridge, onChange: setState });
    controller.current = instance; void instance.load();
    const lost = () => { instance.dispose(); closeRef.current(); };
    window.addEventListener("desktop-auth-lost", lost);
    return () => { instance.dispose(); if (controller.current === instance) controller.current = null; window.removeEventListener("desktop-auth-lost", lost); };
  }, [bridge]);
  useEffect(() => {
    modal.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (!canHandleModalKey(event, modal.current)) return;
      if (event.key === "Escape" && !busy.current) { event.preventDefault(); closeRef.current(); }
      if (event.key !== "Tab") return;
      const choices = [...modal.current?.querySelectorAll<HTMLElement>("button:not(:disabled),select:not(:disabled),summary,[tabindex='0']") || []].filter(node => node.getClientRects().length);
      if (!choices.length) { event.preventDefault(); return; }
      const at = choices.indexOf(document.activeElement as HTMLElement), next = event.shiftKey ? at <= 0 ? choices.length - 1 : at - 1 : at < 0 || at === choices.length - 1 ? 0 : at + 1;
      event.preventDefault(); choices[next].focus();
    };
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, []);
  const locked = state.loading || state.saving || !state.options?.canManage;
  const routeCards: { key: RouteKey; binding: BindingKey; heading: string; subheading: string; icon: typeof Printer }[] = [
    { key: "warranty", binding: "warrantyDeviceName", heading: "质保单", subheading: "沿用原模板、纸张、套打位置及字体", icon: Printer },
    { key: "a4", binding: "a4DeviceName", heading: "A4 报价单", subheading: "完整报价与收款信息，按 A4 输出", icon: FileText },
  ];
  return <div className="host-print-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !state.saving) onClose(); }}><section ref={modal} className="host-print-modal" role="dialog" aria-modal="true" aria-labelledby="host-print-title" tabIndex={-1}>
    <header><div><span>WORKSTUDIO PRINT</span><h2 id="host-print-title">主机打印设备</h2><p>全体员工提交到这台主机，按单据类型统一排队。</p></div><button type="button" className="host-print-icon" disabled={state.saving} onClick={onClose} aria-label="关闭主机打印设置"><X size={20}/></button></header>
    <div className="host-print-body">
      <div className="host-print-access"><ShieldCheck size={17}/><span>本机主机管理员专用</span>{state.options && <small>绑定修订 {state.options.routingRevision}</small>}</div>
      {state.error && <div className="host-print-feedback error" role="alert">{state.error}</div>}
      {state.notice && <div className="host-print-feedback success" role="status"><Check size={16}/>{state.notice}</div>}
      {state.auditWarning && <div className="host-print-feedback warning" role="status">{state.auditWarning}</div>}
      {state.loading && <p className="host-print-loading"><Loader2 size={17} className="spin"/>正在读取主机绑定与 Windows 设备…</p>}
      <div className="host-print-routes">{routeCards.map(card => {
        const status = hostPrintRouteStatus(state.options, card.key), selected = state.draft[card.binding], listed = state.printers.some(printer => printer.deviceName === selected);
        return <section className="host-print-route" key={card.key}><div className="host-print-route-heading"><card.icon size={21} strokeWidth={1.4}/><div><h3>{card.heading}</h3><p>{card.subheading}</p></div><span className={`host-print-status ${status.available ? "available" : "unavailable"}`}>{status.available ? "可用" : "待检查"}</span></div><label>固定主机打印设备<select value={selected} disabled={locked} onChange={event => controller.current?.edit(card.binding, event.target.value)}><option value="">暂不绑定（此类打印不可用）</option>{selected && !listed && <option value={selected}>{selected} · 当前未枚举到</option>}{state.printers.map(printer => <option key={printer.deviceName} value={printer.deviceName}>{printer.label} · {printer.deviceName}</option>)}</select></label><div className="host-print-route-facts"><span>纸张：{status.paper}</span><span>{status.reason}</span></div></section>;
      })}</div>
      <aside className="host-print-help"><h3>主机与共享设备</h3><p>质保单使用 EPSON LQ-630K，A4 使用 Deli M2500ADW。绑定按 Windows 队列名称精确匹配，不会回退到系统默认打印机。</p><p>EPSON 若连接在另一台共享电脑，该电脑和本机都需保持开机，并接入同一局域网。单台设备不可用只影响它负责的单据。</p><p>本页只保存设备绑定。质保纸张、字体与套打调整沿用原质保设置；保存不会发送测试页。</p></aside>
      {!!state.options?.changes?.length && <details className="host-print-history"><summary>最近绑定记录（{state.options.changes.length}）</summary><ul>{state.options.changes.slice(-5).reverse().map(change => <li key={change.revision}><strong>修订 {change.revision}</strong><span>{change.at} · {change.actorId}</span><p>质保单：{change.after.warrantyDeviceName || "未绑定"}<br/>A4：{change.after.a4DeviceName || "未绑定"}</p></li>)}</ul></details>}
    </div>
    <footer><button type="button" className="host-print-button" disabled={state.loading || state.saving} onClick={() => void controller.current?.load()}><RefreshCw size={16}/>重新读取</button><div><button type="button" className="host-print-button" disabled={state.saving} onClick={onClose}>关闭</button><button type="button" className="host-print-button primary" disabled={locked} onClick={() => void controller.current?.save()}>{state.saving ? <Loader2 size={16} className="spin"/> : <Save size={16}/>}<span>{state.saving ? "正在保存…" : "保存双设备绑定"}</span></button></div></footer>
  </section></div>;
}

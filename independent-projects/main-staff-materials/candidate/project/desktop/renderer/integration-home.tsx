import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, BookOpen, Download, Gem, Loader2, PackageCheck, RefreshCw, Settings2, Wallet } from "lucide-react";
import type { NativeResult } from "./bridge";
import { accessLabels, type AccessLevel, type ModuleAccess } from "./module-access";
import "./integration-ui.css";

export type ModuleId = "ledger" | "inventory" | "cashier";
export type ModuleInfo = { id: ModuleId; label: string; version: string; configured: boolean; running: boolean; error?: string; access?: AccessLevel };
export type ModuleStatus = { modules: ModuleInfo[]; hostMode: boolean; error?: string };
export type IntegrationBridge = Window["jewelryDesktop"] & {
  getModuleStatus?: () => Promise<ModuleStatus>;
  openModule?: (input: { id: ModuleId }) => Promise<NativeResult>;
  closeModule?: () => Promise<NativeResult>;
  configureModule?: (input: { id: ModuleId }) => Promise<NativeResult>;
  createModuleData?: (input: { id: ModuleId }) => Promise<NativeResult>;
};
export const moduleLabels: Record<ModuleId, string> = { ledger: "财务系统", inventory: "库管管理", cashier: "出纳系统" };
const emptyModules: ModuleInfo[] = [
  { id: "ledger", label: "财务系统", version: "", configured: false, running: false },
  { id: "inventory", label: "库管管理", version: "", configured: false, running: false },
  { id: "cashier", label: "出纳系统", version: "", configured: false, running: false },
];

export function useModuleIntegration(enabled: boolean) {
  const native = window.jewelryDesktop as IntegrationBridge;
  const [status, setStatus] = useState<ModuleStatus>({ modules: emptyModules, hostMode: false });
  const [loading, setLoading] = useState(false), [error, setError] = useState("");
  const [active, setActive] = useState<ModuleId | null>(null), [pending, setPending] = useState<ModuleId | null>(null);
  const [action, setAction] = useState<"opening" | "closing" | "configuring" | null>(null);
  const alive = useRef(true), revision = useRef(0), working = useRef(false), activeRef = useRef<ModuleId | null>(null);
  const available = enabled && !!native.getModuleStatus && !!native.openModule && !!native.closeModule;
  const refresh = useCallback(async () => {
    if (!enabled || !native.getModuleStatus) return;
    const token = ++revision.current; setLoading(true);
    try {
      const result = await native.getModuleStatus();
      if (alive.current && token === revision.current) { setStatus({ ...result, modules: emptyModules.map(fallback => ({ ...fallback, ...result.modules.find(item => item.id === fallback.id) })) }); setError(result.error || ""); }
    } catch (problem) { if (alive.current && token === revision.current) setError(problem instanceof Error ? problem.message : "模块状态暂时无法读取，请重试。"); }
    finally { if (alive.current && token === revision.current) setLoading(false); }
  }, [enabled, native.getModuleStatus]);
  useEffect(() => {
    alive.current = true; void refresh();
    const permissionLost = () => { activeRef.current = null; setActive(null); setPending(null); setError("模块权限已调整，请从首页重新进入已授权模块。"); };
    window.addEventListener("desktop-module-permission-lost", permissionLost);
    return () => { alive.current = false; ++revision.current; window.removeEventListener("desktop-module-permission-lost", permissionLost); if (activeRef.current) void native.closeModule?.().catch(() => {}); };
  }, [refresh]);
  const open = async (id: ModuleId) => {
    if (working.current) return false;
    if (!available || !native.openModule) { setError(enabled ? "当前程序尚未连接业务模块入口，请更新统一版本后重试。" : "当前设备尚未提供此业务入口，请使用电脑统一程序。"); return false; }
    working.current = true; setError(""); setPending(id); setAction("opening");
    try {
      const result = await native.openModule({ id });
      if (!result.ok) { if (!result.canceled) setError(result.error || `未能打开${moduleLabels[id]}，请检查主机资料目录。`); return false; }
      if (alive.current) { activeRef.current = id; setActive(id); }
      await refresh(); return true;
    } catch (problem) { if (alive.current) setError(problem instanceof Error ? problem.message : "模块暂时无法打开，请重试。"); return false; }
    finally { working.current = false; if (alive.current) { setPending(null); setAction(null); } }
  };
  const close = async () => {
    if (working.current) return false;
    if (!activeRef.current) return true;
    if (!native.closeModule) { setError("模块暂时无法关闭，请重新打开程序。"); return false; }
    working.current = true; setAction("closing"); setError("");
    try {
      const result = await native.closeModule();
      if (!result.ok) { setError(result.error || "返回工作台未完成，请重试。"); return false; }
      if (alive.current) { activeRef.current = null; setActive(null); } return true;
    } catch (problem) { if (alive.current) setError(problem instanceof Error ? problem.message : "返回工作台未完成，请重试。"); return false; }
    finally { working.current = false; if (alive.current) setAction(null); }
  };
  const configure = async (id: ModuleId) => {
    if (working.current) return null;
    if (id === "cashier") { setError("出纳共用财务账套，请在财务系统配置资料目录。"); return null; }
    if (!native.configureModule) { setError("请在电脑主机由管理员选择原模块的资料目录。"); return null; }
    working.current = true; setAction("configuring"); setPending(id); setError("");
    try {
      const result = await native.configureModule({ id });
      if (!result.ok && !result.canceled) setError(result.error || "资料目录未能连接，请重试。");
      if (result.ok) await refresh(); return result;
    } catch (problem) { if (alive.current) setError(problem instanceof Error ? problem.message : "资料目录未能连接，请重试。"); return null; }
    finally { working.current = false; if (alive.current) { setAction(null); setPending(null); } }
  };
  const createData = async (id: ModuleId) => {
    if (id === "cashier") { setError("出纳共用财务账套，请在财务系统配置资料目录。"); return null; }
    if (working.current) return null;
    if (!native.createModuleData) { setError("此版本暂未提供新建资料，请更新后重试。"); return null; }
    working.current = true; setAction("configuring"); setPending(id); setError("");
    try { const result = await native.createModuleData({ id }); if (!result.ok && !result.canceled) setError(result.error || "新资料未能建立，请重试。"); if (result.ok) await refresh(); return result; }
    catch (problem) { if (alive.current) setError(problem instanceof Error ? problem.message : "新资料未能建立，请重试。"); return null; }
    finally { working.current = false; if (alive.current) { setAction(null); setPending(null); } }
  };
  return { status, loading, error, clearError: () => setError(""), active, pending, action, available, refresh, open, close, configure, createData };
}

type Props = { modules: ModuleInfo[]; loading: boolean; busy: boolean; client: boolean; mobile: boolean; error: string; access?: ModuleAccess; onClearError: () => void; onSales: () => void; onOpen: (id: ModuleId) => void; onSettings: () => void; onRefresh: () => void; onEmployeeUpdate: () => void };
export default function IntegrationHome({ modules, loading, busy, client, mobile, error, access, onClearError, onSales, onOpen, onSettings, onRefresh, onEmployeeUpdate }: Props) {
  return <section className="integration-home" aria-label="工作台四大模块">
    <div className="integration-section-heading"><div><span>THE XIN JIN YUAN WORKSPACE</span><h2>一个工作台，协同每一笔业务。</h2></div><div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", gap: 12 }}><button type="button" className="integration-subtle-button" onClick={onEmployeeUpdate} disabled={busy}><Download size={15} />{mobile ? "更新页面" : "一键升级"}</button><button type="button" className="integration-subtle-button" onClick={onRefresh} disabled={busy || loading} aria-label="刷新模块状态">{loading ? <Loader2 size={15} className="integration-spin" /> : <RefreshCw size={15} />}刷新状态</button></div></div>
    <div className="integration-module-grid">
      <button type="button" className={`integration-module-card integration-sales ${access?.sales === "disabled" ? "access-unavailable" : ""}`} onClick={onSales} disabled={busy || access?.sales === "disabled"} title={access?.sales === "disabled" ? "请联系管理员开通销售权限" : undefined}><span className="integration-card-number">01 / JEWELRY SERVICE</span><Gem className="integration-card-icon" size={29} strokeWidth={1.1} /><h3>销售报价</h3><p>销售、回收、维修与定制<br />精致呈现每一份客户报价</p><span className="integration-card-bottom"><span>{access?.sales === "disabled" ? "销售模块未授权" : access?.sales === "view" ? "查看销售资料" : "进入销售工作室"}</span><ArrowUpRight size={22} strokeWidth={1.2}/></span></button>
      {(["ledger", "inventory", "cashier"] as ModuleId[]).map((id, index) => { const module = modules.find(item => item.id === id), Icon = id === "ledger" ? BookOpen : id === "cashier" ? Wallet : PackageCheck; return <button type="button" key={id} className={`integration-module-card integration-${id} ${access?.[id] === "disabled" ? "access-unavailable" : ""}`} onClick={() => onOpen(id)} disabled={busy || access?.[id] === "disabled"} title={access?.[id] === "disabled" ? "请联系管理员开通此模块权限" : undefined}><span className="integration-card-number">0{index + 2} / {id === "ledger" ? "FINANCIAL RECORDS" : id === "cashier" ? "CASH & PAYMENTS" : "INVENTORY MANAGEMENT"}</span><Icon className="integration-card-icon" size={29} strokeWidth={1.1}/><h3>{moduleLabels[id]}</h3><p>{id === "ledger" ? <>原有财务与账务流程<br />按分配权限，清楚核对每笔记录</> : id === "cashier" ? <>收付款、资金流水与银行核对<br />独立授权，制单与复核分离</> : <>商品、物料与盘点核对<br />保留原有材质统计和库存流程</>}</p><span className="integration-module-status">{access?.[id] === "disabled" ? "此模块未授权" : loading ? "正在读取状态" : mobile ? "手机可按权限进入" : module?.error ? "需要检查主机配置" : module?.configured ? `${module.running ? "已运行" : "已连接资料"}${module.version ? ` · ${module.version}` : ""}` : client ? "请先在主机连接原资料" : "首次使用请连接原资料"}</span><span className="integration-card-bottom"><span>{access?.[id] === "disabled" ? "请联系管理员" : `${access ? accessLabels[access[id]] + " · " : ""}进入${moduleLabels[id]}`}</span><ArrowUpRight size={22} strokeWidth={1.2}/></span></button>; })}
    </div>
    {['view','operate','manage'].includes(access?.sales??'disabled')&&(window.jewelryDesktop as IntegrationBridge&{salesMaterialsAvailable?:boolean})?.salesMaterialsAvailable===true&&<a href="/materials/" className="integration-subtle-button" style={{textDecoration:'none'}} aria-label="销售素材选样">销售素材选样<ArrowUpRight size={15}/></a>}
    <div className="integration-home-footnote"><p>使用本程序账号，按管理员分配权限进入各模块。<br/>历史账号和资料保留，客户、库存与金额分别管理。</p>{!mobile && <button type="button" className="integration-subtle-button" onClick={onSettings} disabled={busy}><Settings2 size={14}/>模块资料设置</button>}</div>
    {error && <div className="integration-inline-error" role="alert"><span>{error}</span><button type="button" onClick={onClearError}>关闭</button></div>}
  </section>;
}

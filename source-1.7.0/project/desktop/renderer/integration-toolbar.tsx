import { ArrowLeft, BookOpen, Gem, Loader2, PackageCheck, Wallet } from "lucide-react";
import { moduleLabels, type ModuleId } from "./integration-home";
import type { ModuleAccess } from "./module-access";

type Props = { access?: ModuleAccess; brand: string; active: ModuleId | null; pending: ModuleId | null; busy: boolean; error: string; onHome: () => void; onSales: () => void; onOpen: (id: ModuleId) => void };
export default function IntegrationToolbar({ brand, active, pending, busy, error, access, onHome, onSales, onOpen }: Props) {
  const current = pending || active;
  return <header className="integration-toolbar" aria-label="统一程序模块切换">
    <button className="integration-home-button" type="button" disabled={busy} onClick={onHome}><ArrowLeft size={17}/><span>返回首页</span></button>
    <div className="integration-toolbar-brand"><strong>{brand}</strong><span>{busy ? <><Loader2 size={11} className="integration-spin"/>正在切换</> : current ? `${moduleLabels[current]} · 已授权模块` : "统一工作台"}</span></div>
    <nav aria-label="四大模块"><button type="button" disabled={busy || access?.sales === "disabled"} onClick={onSales}><Gem size={16}/><span>销售报价</span></button><button type="button" disabled={busy || access?.ledger === "disabled"} className={current === "ledger" ? "active" : ""} aria-current={current === "ledger" ? "page" : undefined} onClick={() => onOpen("ledger")}><BookOpen size={16}/><span>财务系统</span></button><button type="button" disabled={busy || access?.inventory === "disabled"} className={current === "inventory" ? "active" : ""} aria-current={current === "inventory" ? "page" : undefined} onClick={() => onOpen("inventory")}><PackageCheck size={16}/><span>库管管理</span></button><button type="button" disabled={busy || access?.cashier === "disabled"} className={current === "cashier" ? "active" : ""} aria-current={current === "cashier" ? "page" : undefined} onClick={() => onOpen("cashier")}><Wallet size={16}/><span>出纳系统</span></button></nav>
    {error && <p className="integration-toolbar-error" role="alert" title={error}>{error}</p>}
  </header>;
}

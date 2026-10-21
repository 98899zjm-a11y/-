import { useEffect, useRef, useState, type FocusEvent } from "react";
import { ArrowDownUp, ChevronRight, FileText, Gem, House, Images, Loader2, LogOut, Menu, RefreshCw, Settings2, Sparkles, Users, Wifi, WifiOff, Wrench, X } from "lucide-react";
import Workspace from "../../desktop/renderer/workspace";
import type { ConnectionInfo, DesktopBootstrap } from "../../desktop/renderer/bridge";
import "./mobile.css";

export type MobilePage = "home" | "sales" | "tradein" | "recycling" | "repairs" | "custom" | "gallery" | "customers" | "history" | "settings";
const services = [
  { page:"sales", title:"珠宝销售", english:"JEWELRY", icon:Gem },
  { page:"tradein", title:"以旧换新", english:"EXCHANGE", icon:RefreshCw },
  { page:"recycling", title:"贵金属回收", english:"RECYCLE", icon:ArrowDownUp },
  { page:"repairs", title:"珠宝维修", english:"CARE", icon:Wrench },
  { page:"custom", title:"专属定制", english:"BESPOKE", icon:Sparkles },
] as const;
const records = [
  { page:"home", title:"工作室首页", icon:House }, { page:"gallery", title:"素材图库", icon:Images },
  { page:"customers", title:"客户档案", icon:Users }, { page:"history", title:"报价历史", icon:FileText },
  { page:"settings", title:"工作室设置", icon:Settings2 },
] as const;
const allPages = [...services,...records].map(item=>item.page);
function currentPage(fallback:MobilePage="home"):MobilePage { const page=window.location.pathname.split("/")[1]; return allPages.includes(page as MobilePage) ? page as MobilePage : fallback; }
function inputIsEditing(target:EventTarget|null) { return target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target instanceof HTMLInputElement && !["checkbox","radio","file","button","submit"].includes(target.type); }

export type MobileWorkspaceProps = { initial:DesktopBootstrap; onLogout:()=>Promise<void>; connection?:ConnectionInfo|null; initialPage?:MobilePage; onConnectionSettings?:()=>void; onRefresh?:()=>Promise<void>; dataRevision?:number };

export default function MobileWorkspace({ initial,onLogout,connection,initialPage="home",onConnectionSettings,onRefresh,dataRevision=0 }:MobileWorkspaceProps) {
  const startingPage=useRef<MobilePage>(currentPage(initialPage));
  const [page,setPage]=useState<MobilePage>(startingPage.current);
  const [menu,setMenu]=useState<"all"|"quotes"|null>(null),[editing,setEditing]=useState(false),[busy,setBusy]=useState(false),[logoutBusy,setLogoutBusy]=useState(false),[error,setError]=useState("");
  const workspace=useRef<HTMLDivElement>(null),menuRef=useRef<HTMLElement>(null),menuButton=useRef<HTMLButtonElement>(null);
  const linked=connection?.mode==="client"&&connection.running&&!connection.error;
  const brand=initial.settings.brand;
  const refreshPage=()=>setPage(currentPage(initialPage));
  useEffect(()=>{ document.body.classList.add("mobile-client"); const sync=()=>refreshPage(); window.addEventListener("popstate",sync); return()=>{document.body.classList.remove("mobile-client");window.removeEventListener("popstate",sync);}; },[initialPage]);
  useEffect(()=>{
    const element=workspace.current?.querySelector<HTMLFieldSetElement>("fieldset.workspace");if(!element)return;
    const sync=()=>setBusy(element.disabled);sync();const observer=new MutationObserver(sync);observer.observe(element,{attributes:true,attributeFilter:["disabled"]});return()=>observer.disconnect();
  },[initial.user.id,connection?.host,connection?.port,dataRevision]);
  useEffect(()=>{
    if(!menu)return;const previous=document.body.style.overflow;document.body.style.overflow="hidden";menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const keyboard=(event:KeyboardEvent)=>{if(event.key==="Escape"){event.preventDefault();setMenu(null);menuButton.current?.focus();}if(event.key==="Tab"){const buttons=[...menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")||[]];const first=buttons[0],last=buttons.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}};
    window.addEventListener("keydown",keyboard);return()=>{document.body.style.overflow=previous;window.removeEventListener("keydown",keyboard);};
  },[menu]);
  const navigate=(next:MobilePage)=>{
    if(busy||logoutBusy)return;setMenu(null);setError("");if(currentPage(initialPage)===next)return;
    window.history.pushState({ ...window.history.state,jewelryPage:next },"",`/${next}`);
    window.dispatchEvent(new PopStateEvent("popstate"));refreshPage();
  };
  const blur=(_event:FocusEvent)=>queueMicrotask(()=>setEditing(inputIsEditing(document.activeElement)));
  const logout=async()=>{if(busy||logoutBusy)return;setLogoutBusy(true);setError("");try{await onLogout();setMenu(null);}catch(err){setError(err instanceof Error?err.message:"退出未能完成，请重试");}finally{setLogoutBusy(false);}};
  const refresh=async()=>{if(!onRefresh||busy||logoutBusy)return;setLogoutBusy(true);setError("");try{await onRefresh();setMenu(null);}catch(err){setError(err instanceof Error?err.message:"数据暂时未能刷新，请重试");}finally{setLogoutBusy(false);}};
  const quotationActive=services.some(item=>item.page===page);
  return <div className={`mobile-workspace-shell${editing?" mobile-editing":""}`}>
    <header className="mobile-topbar"><button className="mobile-brand" disabled={busy} onClick={()=>navigate("home")} aria-label="返回工作室首页"><span title={brand.english}>{brand.english||"XIN JIN YUAN"}</span><strong>{brand.name||"鑫金源"}</strong></button><div className="mobile-topbar-actions"><span className={`mobile-connection${linked?" linked":""}`} role="status">{linked?<Wifi size={12}/>:<WifiOff size={12}/>}<span>{linked?"店内连接":"未连接"}</span></span><button ref={menuButton} className="mobile-menu-button" aria-label="打开全部菜单" aria-expanded={!!menu} onClick={()=>setMenu("all")} disabled={busy||logoutBusy}><Menu size={23} strokeWidth={1.4}/></button></div></header>
    {error&&!menu&&<div className="mobile-shell-error" role="alert">{error}<button onClick={()=>setError("")} aria-label="关闭错误"><X size={16}/></button></div>}
    <div ref={workspace} className="mobile-workspace-body" onClickCapture={()=>queueMicrotask(refreshPage)} onFocusCapture={event=>{if(inputIsEditing(event.target))setEditing(true);}} onBlurCapture={blur}>
      <Workspace key={`${connection?.host||"mobile"}:${connection?.port||31831}:${initial.user.id}:${dataRevision}`} initial={initial} initialPage={dataRevision ? currentPage(initialPage) : startingPage.current} connection={connection} onLogout={onLogout} mobileSurface/>
    </div>
    <nav className="mobile-dock" aria-label="手机主导航"><button className={page==="home"?"active":""} onClick={()=>navigate("home")} disabled={busy}><House size={20} strokeWidth={1.5}/><span>首页</span></button><button className={quotationActive?"active":""} onClick={()=>setMenu("quotes")} disabled={busy}><Gem size={20} strokeWidth={1.5}/><span>报价</span></button><button className={page==="customers"?"active":""} onClick={()=>navigate("customers")} disabled={busy}><Users size={20} strokeWidth={1.5}/><span>客户</span></button><button className={page==="history"?"active":""} onClick={()=>navigate("history")} disabled={busy}><FileText size={20} strokeWidth={1.5}/><span>记录</span></button><button className={["gallery","settings"].includes(page)?"active":""} onClick={()=>setMenu("all")} disabled={busy}><Menu size={20} strokeWidth={1.5}/><span>更多</span></button></nav>
    {menu&&<div className="mobile-menu-backdrop" onClick={()=>setMenu(null)}><section ref={menuRef} className={`mobile-menu-sheet ${menu==="quotes"?"quotes-only":""}`} role="dialog" aria-modal="true" aria-label={menu==="quotes"?"选择报价业务":"全部功能"} onClick={event=>event.stopPropagation()}><header><div><span>JEWELRY ATELIER</span><h2>{menu==="quotes"?"开始一份专属报价":"你的珠宝工作室"}</h2></div><button className="mobile-menu-button" aria-label="关闭菜单" onClick={()=>setMenu(null)}><X size={21}/></button></header><div className="mobile-services">{services.map(item=><button key={item.page} className={page===item.page?"active":""} onClick={()=>navigate(item.page)} disabled={logoutBusy}><item.icon size={23} strokeWidth={1.35}/><strong>{item.title}</strong><small>{item.english}</small></button>)}</div>{menu==="all"&&<><div className="mobile-record-menu">{records.map(item=><button key={item.page} disabled={logoutBusy} onClick={()=>navigate(item.page)}><item.icon size={17} strokeWidth={1.4}/><span>{item.title}</span><ChevronRight size={15}/></button>)}</div>{onRefresh&&<button className="mobile-host-entry" disabled={logoutBusy} onClick={()=>void refresh()}><RefreshCw size={16} className={logoutBusy?"spin":""}/><span>刷新工作室数据</span><ChevronRight size={15}/></button>}{onConnectionSettings&&<button className="mobile-host-entry" disabled={logoutBusy} onClick={()=>{setMenu(null);onConnectionSettings();}}><Wifi size={16}/><span>连接设置</span><ChevronRight size={15}/></button>}<footer><div className="mobile-account"><span>{initial.user.name?.[0]||"顾"}</span><div><strong>{initial.user.name||initial.user.username}</strong><small>{initial.user.role==="admin"?"管理员":"珠宝顾问"} · {initial.user.username}</small></div></div><button className="mobile-logout" disabled={logoutBusy} onClick={()=>void logout()}>{logoutBusy?<Loader2 size={16} className="spin"/>:<LogOut size={16}/>}退出登录</button></footer></>}{error&&<p className="mobile-menu-error" role="alert">{error}</p>}</section></div>}
  </div>;
}

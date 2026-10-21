import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Gem, Loader2, RefreshCw } from "lucide-react";
import { installMobileBridge } from "../native-bridge";
import { api, type AuthStatus, type ConnectionInfo, type DesktopBootstrap } from "../../desktop/renderer/bridge";
import MobileAccess from "./mobile-access";
import MobileWorkspace from "./mobile-workspace";
import "./mobile.css";

function MobileApp(){
  const [connection,setConnection]=useState<ConnectionInfo|null>(null),[initial,setInitial]=useState<DesktopBootstrap|null>(null),[loading,setLoading]=useState(true),[message,setMessage]=useState(""),[revision,setRevision]=useState(0);
  const load=async()=>{
    setLoading(true);setMessage("");
    try{
      const status=await api<AuthStatus>("/auth/status");
      const info=await window.jewelryDesktop.getConnection();setConnection(info);
      if(status.authenticated)setInitial(await api<DesktopBootstrap>("/api/bootstrap"));else setInitial(null);
      if(status.needsSetup)setMessage("请先在电脑建立工作室管理员，再用员工账号登录手机。");
    }catch(error){setInitial(null);setConnection(await window.jewelryDesktop.getConnection().catch(()=>null));setMessage(error instanceof Error?error.message:"主机暂时无法连接，请检查店内网络。");}
    finally{setLoading(false);}
  };
  useEffect(()=>{
    void load();
    const expired=()=>{setInitial(null);setMessage("登录已失效，请重新登录工作室。");};
    window.addEventListener("desktop-auth-lost",expired);return()=>window.removeEventListener("desktop-auth-lost",expired);
  },[]);
  const logout=async()=>{await api("/auth/logout","POST");setInitial(null);setMessage("");window.history.replaceState({},"","/home");};
  const refresh=async()=>{const next=await api<DesktopBootstrap>("/api/bootstrap");const info=await window.jewelryDesktop.getConnection();setConnection(info);setInitial(next);setRevision(value=>value+1);};
  const changeConnection=()=>{setInitial(null);setConnection(current=>current?{...current,running:false}:null);setMessage("");};
  if(loading)return <main className="mobile-startup"><Gem size={32} strokeWidth={1.2}/><h1>鑫金源珠宝工作室</h1><p><Loader2 className="spin" size={15}/>正在打开手机工作室…</p></main>;
  if(!initial)return <MobileAccess key={`${connection?.host||"unpaired"}:${connection?.port||31831}:${connection?.running?"linked":"unlinked"}`} initialConnection={connection} message={message} onConnected={setConnection} onAuthenticated={(value,info)=>{setInitial(value);setConnection(info);setMessage("");setRevision(0);window.history.replaceState({},"","/home");}}/>;
  return <MobileWorkspace initial={initial} connection={connection} dataRevision={revision} onLogout={logout} onRefresh={refresh} onConnectionSettings={changeConnection}/>;
}

const root=createRoot(document.getElementById("root")!);
void installMobileBridge().then(()=>root.render(<MobileApp/>)).catch(error=>root.render(<main className="mobile-startup"><Gem size={32} strokeWidth={1.2}/><h1>手机工作室暂时无法打开</h1><p>{error instanceof Error?error.message:"手机服务未能启动"}</p><button className="button primary" onClick={()=>window.location.reload()}><RefreshCw size={15}/>重新打开</button></main>));

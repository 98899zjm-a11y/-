import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, Gem, KeyRound, Loader2, LockKeyhole, Wifi } from "lucide-react";
import { api, type AuthStatus, type ConnectionInfo, type DesktopBootstrap } from "../../desktop/renderer/bridge";
import "./mobile.css";

export type MobileAccessProps = { initialConnection?:ConnectionInfo|null; onAuthenticated:(initial:DesktopBootstrap,connection:ConnectionInfo)=>void; onConnected?:(connection:ConnectionInfo)=>void; message?:string };
export default function MobileAccess({ initialConnection,onAuthenticated,onConnected,message }:MobileAccessProps) {
  const [stage,setStage]=useState<"connect"|"login">(initialConnection?.mode==="client"&&initialConnection.host?"login":"connect");
  const [connection,setConnection]=useState<ConnectionInfo|null>(initialConnection||null),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const [form,setForm]=useState({host:initialConnection?.host||"",port:String(initialConnection?.port||31831),code:"",username:"",password:""});
  useEffect(()=>{document.body.classList.add("mobile-client");return()=>document.body.classList.remove("mobile-client");},[]);
  const submit=async(event:FormEvent)=>{
    event.preventDefault();if(busy)return;setError("");setBusy(true);
    try{
      if(!window.jewelryDesktop)throw new Error("手机服务尚未就绪，请重新打开程序。");
      if(stage==="connect"){
        const host=form.host.trim(),parts=host.split(".").map(Number),port=Number(form.port),code=form.code.trim();
        const ipv4=/^\d{1,3}(\.\d{1,3}){3}$/.test(host)&&parts.every(part=>Number.isInteger(part)&&part>=0&&part<=255);
        const local=ipv4&&(parts[0]===10||parts[0]===192&&parts[1]===168||parts[0]===172&&parts[1]>=16&&parts[1]<=31);
        if(!local)throw new Error("请输入店内电脑显示的局域网地址，例如192.168.1.20。");
        if(!Number.isInteger(port)||port<1024||port>65535)throw new Error("端口请输入1024至65535之间的整数。");
        if(!/^[A-Za-z0-9_-]{32}$/.test(code))throw new Error("请粘贴电脑显示的完整32位连接码。");
        const result=await window.jewelryDesktop.setConnection({mode:"client",host,port,code});
        if(!result.ok)throw new Error(result.error||"未能连接电脑，请检查地址和连接码。");
        const info=await window.jewelryDesktop.getConnection();if(info.mode!=="client"||!info.running)throw new Error(info.error||"主机尚未连接，请重试。");
        const status=await api<AuthStatus>("/auth/status");if(status.needsSetup)throw new Error("请先在电脑创建工作室管理员，再用员工账号登录手机。");
        setConnection(info);onConnected?.(info);setForm(current=>({...current,code:"",password:""}));setStage("login");
      }else{
        if(!connection)throw new Error("请先连接店内电脑。");
        const status=await api<AuthStatus>("/auth/login","POST",{username:form.username.trim(),password:form.password});
        if(!status.authenticated)throw new Error("登录未完成，请重试。");
        const initial=await api<DesktopBootstrap>("/api/bootstrap"),info=await window.jewelryDesktop.getConnection();setForm(current=>({...current,password:""}));onAuthenticated(initial,info);
      }
    }catch(err){setError(err instanceof Error?err.message:"操作未完成，请重试。");}finally{setBusy(false);}
  };
  return <main className="mobile-access"><section className="mobile-access-photo"><img src="/home-necklace.png" alt="铂金珠宝佩戴"/><div><span>XIN JIN YUAN</span><strong>鑫金源</strong><small>JEWELRY ATELIER</small></div></section><section className="mobile-access-content"><div className="mobile-access-heading"><Gem size={25} strokeWidth={1.2}/><span>PRIVATE JEWELRY SERVICE</span><h1>{stage==="connect"?"连接店内工作室":"欢迎回到工作室"}</h1><p>{stage==="connect"?"手机与电脑连接同一店内网络。":"使用电脑工作室的用户名和密码。"}</p></div>{(error||message)&&<div className="feedback error" role="alert">{error||message}</div>}<form onSubmit={submit}>{stage==="connect"?<><label className="field"><span>主机地址</span><input required inputMode="decimal" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={15} value={form.host} onChange={event=>setForm({...form,host:event.target.value})} placeholder="例如192.168.1.20"/></label><label className="field"><span>端口</span><input required inputMode="numeric" pattern="[0-9]+" maxLength={5} value={form.port} onChange={event=>setForm({...form,port:event.target.value})}/></label><label className="field"><span>电脑连接码</span><input required type="password" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={32} value={form.code} onChange={event=>setForm({...form,code:event.target.value})} placeholder="粘贴电脑上的32位连接码"/></label></>:<><div className="mobile-connected-host"><Wifi size={14}/><span>{connection?.host}:{connection?.port}</span><button type="button" disabled={busy} onClick={()=>{setStage("connect");setError("");setForm(current=>({...current,password:""}));}}>更换</button></div><label className="field"><span>用户名</span><input required minLength={2} maxLength={48} autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={form.username} onChange={event=>setForm({...form,username:event.target.value})} placeholder="你的工作室用户名"/></label><label className="field"><span>密码</span><input required type="password" maxLength={128} autoComplete="current-password" value={form.password} onChange={event=>setForm({...form,password:event.target.value})} placeholder="请输入账号密码"/></label></>}<button className="button primary mobile-access-submit" disabled={busy} type="submit">{busy?<Loader2 size={17} className="spin"/>:stage==="connect"?<Wifi size={17}/>:<KeyRound size={17}/>}<span>{busy?"正在处理…":stage==="connect"?"连接工作室":"登录工作室"}</span></button></form><div className="mobile-access-note"><LockKeyhole size={13}/><span>数据由店内电脑保存</span><p>{stage==="connect"?"主机地址和连接码可在电脑的“工作室设置 → 局域网”中查看。":"员工账号由电脑工作室管理员添加。"}</p></div>{stage==="login"&&<button className="mobile-access-back" disabled={busy} onClick={()=>{setStage("connect");setError("");setForm(current=>({...current,password:""}));}}><ArrowLeft size={14}/>返回连接设置</button>}</section></main>;
}

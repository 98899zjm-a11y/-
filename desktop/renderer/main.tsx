import { useEffect, useRef, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { Gem, KeyRound, Loader2, Network, ShieldCheck, UserRound } from "lucide-react";
import Workspace from "./workspace";
import { api, type AuthStatus, type ConnectionInfo, type DesktopBootstrap } from "./bridge";
import { connectionLabel, NetworkSettingsModal } from "./network-settings";
import "./styles.css";

const emptyForm = { username: "", name: "", password: "", confirmation: "" };
function DesktopApp() {
  const [auth, setAuth] = useState<AuthStatus | null>(null), [initial, setInitial] = useState<DesktopBootstrap | null>(null);
  const [connection, setConnection] = useState<ConnectionInfo | null>(null), [networkOpen, setNetworkOpen] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [form, setForm] = useState(emptyForm);
  const revision = useRef(0), recovering = useRef(false), alive = useRef(true);
  const load = async () => {
    const request = ++revision.current;
    const [statusResult, infoResult] = await Promise.allSettled([api<AuthStatus>("/auth/status"), window.jewelryDesktop.getConnection()]);
    if (infoResult.status === "fulfilled" && alive.current && request === revision.current) setConnection(infoResult.value);
    if (statusResult.status === "rejected") throw statusResult.reason;
    if (infoResult.status === "rejected") throw infoResult.reason;
    const status = statusResult.value, info = infoResult.value;
    const bootstrap = status.authenticated ? await api<DesktopBootstrap>("/api/bootstrap") : null;
    if (alive.current && request === revision.current) { setConnection(info); setAuth(status); setInitial(bootstrap); }
  };
  useEffect(() => {
    alive.current = true;
    void load().catch(err => { if (alive.current) setError(err instanceof Error ? err.message : "无法读取工作室数据"); });
    const originalPrint = window.print;
    window.print = () => { void window.jewelryDesktop.print().catch(err => { if (alive.current) setError(err instanceof Error ? err.message : "打印未能完成"); }); };
    const authLost = () => {
      if (recovering.current) return;
      recovering.current = true; ++revision.current;
      setInitial(null); setAuth({ needsSetup: false, authenticated: false }); setForm(emptyForm);
      setConnection(current => current ? { ...current, code: undefined } : null);
      setError("登录已失效，请重新登录工作室。");
      void load().catch(err => { if (alive.current) { setInitial(null); setAuth({ needsSetup: false, authenticated: false }); setError(err instanceof Error ? err.message : "登录已失效，请重新登录。"); } }).finally(() => { recovering.current = false; });
    };
    window.addEventListener("desktop-auth-lost", authLost);
    return () => { alive.current = false; ++revision.current; window.print = originalPrint; window.removeEventListener("desktop-auth-lost", authLost); };
  }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (busy || !auth) return; setError("");
    if (auth.needsSetup && form.password !== form.confirmation) { setError("两次输入的密码不一致"); return; }
    setBusy(true);
    try {
      await api<AuthStatus>(auth.needsSetup ? "/auth/setup" : "/auth/login", "POST", { username: form.username.trim(), name: form.name.trim(), password: form.password });
      await load(); setForm(emptyForm); window.history.replaceState({}, "", "/home");
    } catch (err) { setError(err instanceof Error ? err.message : "登录失败，请重试"); }
    finally { setBusy(false); }
  };
  const logout = async () => {
    if (busy) return; setBusy(true); setError(""); ++revision.current;
    try {
      await api("/auth/logout", "POST"); setInitial(null); setAuth({ needsSetup: false, authenticated: false }); setForm(emptyForm);
      setConnection(current => current ? { ...current, code: undefined } : null);
      window.history.replaceState({}, "", "/home");
    } finally { setBusy(false); }
  };
  if (initial && auth?.authenticated) return <Workspace key={initial.user.id} initial={initial} initialPage="home" onLogout={logout} connection={connection} />;
  const setup = auth?.needsSetup, client = connection?.mode === "client";
  return <><main className="desktop-auth">
    <section className="auth-image"><img src="/home-necklace.png" alt="铂金珠宝佩戴" /><div className="auth-brand"><span>XIN JIN YUAN</span><strong>鑫金源</strong><p>JEWELRY ATELIER</p></div><div className="auth-image-caption"><p>一份专属报价</p><h2>让每一件珠宝<br />被悉心对待。</h2></div></section>
    <section className="auth-panel"><div className="auth-content"><div className="auth-emblem"><Gem size={26} strokeWidth={1.3} /></div><p className="auth-eyebrow">JEWELRY STUDIO</p><h1>{setup ? "建立你的珠宝工作室" : "欢迎回到工作室"}</h1><p className="auth-intro">{setup ? "首次单机使用，请设置本机管理员账号。" : client ? "使用主机上的用户名和密码进入。" : "使用本机用户名和密码进入。"}</p>
      {error && <div className="feedback error" role="alert">{error}</div>}
      {!auth ? <div className="auth-loading"><Loader2 className="spin" size={20} /><span>正在打开工作室…</span>{error && <button className="button" onClick={() => { setError(""); void load().catch(err => setError(err instanceof Error ? err.message : "无法打开工作室")); }}>重新打开</button>}</div> : <form onSubmit={submit}>
        <label className="field"><span>用户名</span><div className="auth-input"><UserRound size={16} /><input autoFocus autoComplete="username" minLength={2} maxLength={48} required value={form.username} onChange={event => setForm({ ...form, username: event.target.value })} placeholder="2至48位中文、字母、数字或._-" /></div></label>
        {setup && <label className="field"><span>管理员姓名</span><input required maxLength={80} autoComplete="name" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} placeholder="姓名或称呼" /></label>}
        <label className="field"><span>密码</span><div className="auth-input"><KeyRound size={16} /><input type="password" required minLength={setup ? 8 : undefined} maxLength={128} autoComplete={setup ? "new-password" : "current-password"} value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} placeholder={setup ? "至少8位，妥善记住" : "请输入工作室密码"} /></div></label>
        {setup && <label className="field"><span>确认密码</span><input type="password" required minLength={8} maxLength={128} autoComplete="new-password" value={form.confirmation} onChange={event => setForm({ ...form, confirmation: event.target.value })} placeholder="再次输入密码" /></label>}
        <button className="button primary auth-submit" disabled={busy} type="submit">{busy ? <Loader2 className="spin" size={16} /> : <ShieldCheck size={16} />}{busy ? "正在打开…" : setup ? "创建本机工作室" : "登录工作室"}</button>
      </form>}
      <div className="auth-local-note"><span className="offline-dot" />{connectionLabel(connection)}<p>{client ? "客户和报价保存在店内主机。主机程序需保持打开。" : connection?.mode === "host" ? "客户和报价保存在这台主机，店内其他电脑可通过局域网共享。" : "客户、报价和图片保存在这台电脑。员工账号由本机管理员添加。"}</p><button className="auth-network-entry" type="button" disabled={busy} onClick={() => setNetworkOpen(true)}><Network size={13} />局域网连接设置</button>{setup && <p className="network-auth-context">连接已有主机时，可先打开连接设置，再使用主机账号登录。</p>}</div>
    </div><footer className="auth-footer">XIN JIN YUAN · PRIVATE JEWELRY SERVICE</footer></section>
  </main>{networkOpen && <NetworkSettingsModal admin={false} initialInfo={connection} onClose={() => setNetworkOpen(false)} onApplied={info => { ++revision.current; setConnection(info); setInitial(null); setAuth(null); setForm(emptyForm); setError(""); }} />}</>;
}
createRoot(document.getElementById("root")!).render(<DesktopApp />);

import { useEffect, useRef, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { ArrowUpCircle, Gem, KeyRound, Loader2, Network, ShieldCheck, UserRound } from "lucide-react";
import Workspace from "./workspace";
import { api, type AuthStatus, type ConnectionInfo, type DesktopBootstrap, type LoginMemory } from "./bridge";
import { connectionLabel, NetworkSettingsModal } from "./network-settings";
import "./styles.css";
import AppVersionBadge from "./app-version-badge";
import EmployeeUpdate from "./employee-update";

const emptyForm = { username: "", name: "", password: "", confirmation: "" };
export function DesktopApp() {
  const browserSurface = window.jewelryDesktop?.surface === 'browser';
  const [auth, setAuth] = useState<AuthStatus | null>(null), [initial, setInitial] = useState<DesktopBootstrap | null>(null);
  const [connection, setConnection] = useState<ConnectionInfo | null>(null), [networkOpen, setNetworkOpen] = useState(false), [updateOpen, setUpdateOpen] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [rememberPassword, setRememberPassword] = useState(false), [memory, setMemory] = useState({ available: false, hasPassword: false, scopeKey: "", error: "" }), [memoryNotice, setMemoryNotice] = useState("");
  const memoryRevision = useRef(0), memoryScopeRevision = useRef(0), memoryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const readMemory = async (username?: string): Promise<LoginMemory | null> => {
    if (!window.jewelryDesktop.readLoginMemory) return null;
    const result = await window.jewelryDesktop.readLoginMemory(username === undefined ? undefined : { username });
    if (result.ok === false || typeof result.username !== "string") throw new Error(result.error || "登录记忆暂时无法读取，可继续手动登录");
    return result;
  };
  useEffect(() => {
    const token = ++memoryRevision.current;
    const scopeToken = ++memoryScopeRevision.current;
    if (!connection || auth?.authenticated) return;
    setRememberPassword(false);
    void readMemory(auth?.needsSetup ? "" : undefined).then(result => {
      if (!alive.current || scopeToken !== memoryScopeRevision.current || !result) return;
      if (token !== memoryRevision.current) { setMemory(current => ({ ...current, available: result.available, scopeKey: result.scopeKey })); return; }
      setMemory({ available: result.available, hasPassword: result.hasPassword, scopeKey: result.scopeKey, error: result.error || (!result.available ? "本机安全加密不可用，密码无法记住；可正常手动登录。" : "") });
      setForm(current => ({ ...current, username: auth?.needsSetup ? current.username : result.username, password: auth?.needsSetup ? "" : result.password || "" }));
      setRememberPassword(!auth?.needsSetup && result.hasPassword && !!result.password && result.available);
    }).catch(err => { if (alive.current && token === memoryRevision.current) setMemory({ available: false, hasPassword: false, scopeKey: "", error: err instanceof Error ? err.message : "登录记忆无法读取，可继续手动登录" }); });
    return () => { ++memoryRevision.current; ++memoryScopeRevision.current; if (memoryTimer.current) clearTimeout(memoryTimer.current); };
  }, [connection?.mode, connection?.host, connection?.port, auth?.needsSetup, auth?.authenticated]);
  const changeUsername = (value: string) => {
    setForm(current => ({ ...current, username: value, password: "" })); setRememberPassword(false); setMemory(current => ({ ...current, hasPassword: false, error: "" }));
    const token = ++memoryRevision.current; if (memoryTimer.current) clearTimeout(memoryTimer.current);
    const scopeToken = memoryScopeRevision.current;
    if (value.trim().length < 2 || auth?.needsSetup) return;
    memoryTimer.current = setTimeout(() => { void readMemory(value).then(result => {
      if (!alive.current || scopeToken !== memoryScopeRevision.current || !result) return;
      if (token !== memoryRevision.current) { setMemory(current => ({ ...current, available: result.available, scopeKey: result.scopeKey })); return; }
      setMemory({ available: result.available, hasPassword: result.hasPassword, scopeKey: result.scopeKey, error: result.error || "" }); setForm(current => ({ ...current, password: result.password || "" })); setRememberPassword(result.hasPassword && !!result.password && result.available);
    }).catch(err => { if (alive.current && token === memoryRevision.current) setMemory(current => ({ ...current, error: err instanceof Error ? err.message : "记忆暂时不可读取" })); }); }, 250);
  };
  const forgetPassword = async (clearInput = false) => {
    ++memoryRevision.current; setRememberPassword(false);
    if (clearInput) setForm(current => ({ ...current, password: "" }));
    if (!window.jewelryDesktop.forgetLoginPassword || form.username.trim().length < 2) return;
    try { const result = await window.jewelryDesktop.forgetLoginPassword({ username: form.username, scopeKey: memory.scopeKey }); if (!result.ok) throw new Error(result.error || "记住的密码未能清除"); setMemory(current => ({ ...current, hasPassword: false, error: "记住的密码已清除，用户名保留。" })); }
    catch (err) { setMemory(current => ({ ...current, error: err instanceof Error ? err.message : "记住的密码未能清除" })); }
  };
  useEffect(() => {
    alive.current = true;
    void load().catch(err => { if (alive.current) setError(err instanceof Error ? err.message : "无法读取工作室数据"); });
    const originalPrint = window.print;
    window.print = () => { void window.jewelryDesktop.print().catch(err => { if (alive.current) setError(err instanceof Error ? err.message : "打印未能完成"); }); };
    const authLost = () => {
      if (recovering.current) return;
      recovering.current = true; ++revision.current;
      ++memoryRevision.current; setInitial(null); setAuth({ needsSetup: false, authenticated: false }); setForm(emptyForm);
      setConnection(current => current ? { ...current, code: undefined } : null);
      setError("登录已失效，请重新登录工作室。");
      void load().catch(err => { if (alive.current) { setInitial(null); setAuth({ needsSetup: false, authenticated: false }); setError(err instanceof Error ? err.message : "登录已失效，请重新登录。"); } }).finally(() => { recovering.current = false; });
    };
    window.addEventListener("desktop-auth-lost", authLost);
    return () => { alive.current = false; ++revision.current; window.print = originalPrint; window.removeEventListener("desktop-auth-lost", authLost); };
  }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (busy || !auth) return; setError(""); setMemoryNotice(""); ++memoryRevision.current;
    if (auth.needsSetup && form.password !== form.confirmation) { setError("两次输入的密码不一致"); return; }
    setBusy(true);
    const credentials = { username: form.username.trim(), password: form.password, rememberPassword, scopeKey: memory.scopeKey };
    try {
      const result = await api<AuthStatus>(auth.needsSetup ? "/auth/setup" : "/auth/login", "POST", { username: credentials.username, name: form.name.trim(), password: credentials.password });
      await load(); setForm(emptyForm); window.history.replaceState({}, "", "/home");
      if (window.jewelryDesktop.rememberLogin) {
        try { const saved = await window.jewelryDesktop.rememberLogin({ ...credentials, username: result.user?.username || credentials.username, userId: result.user?.id }); if (!saved.ok) setMemoryNotice(saved.error || "您已登录，登录信息未能记住。"); }
        catch { setMemoryNotice("您已登录，登录信息未能记住；下次可手动输入。"); }
      }
    } catch (err) {
      setError((memory.hasPassword ? "记住的密码可能已更改或账号已停用，请重新输入，也可清除记住的密码。 " : "") + (err instanceof Error ? err.message : "登录失败，请重试"));
      if (window.jewelryDesktop.rememberLoginUsername) void window.jewelryDesktop.rememberLoginUsername({ username: credentials.username, scopeKey: credentials.scopeKey }).catch(() => {});
    }
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
  if (initial && auth?.authenticated) return <><Workspace key={initial.user.id} initial={initial} initialPage="home" onLogout={logout} connection={connection} mobileSurface={browserSurface} />{memoryNotice && <div className="feedback error" role="status" style={{ position: "fixed", right: 24, bottom: 24, zIndex: 10000, maxWidth: 430, background: "white", boxShadow: "0 8px 32px #0002", padding: 16 }}><span>{memoryNotice}</span><button type="button" className="button" onClick={() => setMemoryNotice("")}>知道了</button></div>}</>;
  const setup = auth?.needsSetup, client = connection?.mode === "client";
  return <><main className="desktop-auth">
    <section className="auth-image"><img src="/home-necklace.png" alt="铂金珠宝佩戴" /><div className="auth-brand"><span>XIN JIN YUAN</span><strong>鑫金源</strong><p>JEWELRY ATELIER</p></div><div className="auth-image-caption"><p>一份专属报价</p><h2>让每一件珠宝<br />被悉心对待。</h2></div></section>
    <section className="auth-panel"><div className="auth-content"><div className="auth-emblem"><Gem size={26} strokeWidth={1.3} /></div><p className="auth-eyebrow">JEWELRY STUDIO</p><h1>{setup ? "建立你的珠宝工作室" : "欢迎回到工作室"}</h1><p className="auth-intro">{browserSurface ? "使用公司员工账号登录，资料由公司主机统一保存。" : setup ? "首次单机使用，请设置本机管理员账号。" : client ? "使用主机上的用户名和密码进入。" : "使用本机用户名和密码进入。"}</p>
      {error && <div className="feedback error" role="alert">{error}</div>}
      {!auth ? <div className="auth-loading"><Loader2 className="spin" size={20} /><span>正在打开工作室…</span>{error && <button className="button" onClick={() => { setError(""); void load().catch(err => setError(err instanceof Error ? err.message : "无法打开工作室")); }}>重新打开</button>}</div> : <form onSubmit={submit}>
        <label className="field"><span>用户名</span><div className="auth-input"><UserRound size={16} /><input name="username" autoFocus autoComplete="username" minLength={2} maxLength={48} disabled={busy} required value={form.username} onChange={event => changeUsername(event.target.value)} placeholder="2至48位中文、字母、数字或._-" /></div></label>
        {setup && <label className="field"><span>管理员姓名</span><input required maxLength={80} autoComplete="name" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} placeholder="姓名或称呼" /></label>}
        <label className="field"><span>密码</span><div className="auth-input"><KeyRound size={16} /><input name="password" type="password" required minLength={setup ? 8 : undefined} maxLength={128} disabled={busy} autoComplete={setup ? "new-password" : "current-password"} value={form.password} onChange={event => { ++memoryRevision.current; setForm({ ...form, password: event.target.value }); }} placeholder={setup ? "至少8位，妥善记住" : "请输入工作室密码"} /></div></label>
        {setup && <label className="field"><span>确认密码</span><input type="password" required minLength={8} maxLength={128} autoComplete="new-password" value={form.confirmation} onChange={event => setForm({ ...form, confirmation: event.target.value })} placeholder="再次输入密码" /></label>}
        {browserSurface ? <p style={{ margin: "8px 0 20px", fontSize: 13, color: "#777", lineHeight: 1.6 }}>网页只记住用户名。密码可交给手机系统密码管理器，不在网页中保存。</p> : <div style={{ margin: "8px 0 20px", fontSize: 13 }}><label style={{ display: "flex", alignItems: "center", gap: 8 }}><input type="checkbox" checked={rememberPassword} disabled={busy || !memory.available} style={{ accentColor: "#ad8550", width: 15, height: 15 }} onChange={event => { ++memoryRevision.current; if (event.target.checked) setRememberPassword(true); else void forgetPassword(); }} />记住密码（仅这台电脑当前Windows用户）</label><p style={{ margin: "8px 0", color: "#777", lineHeight: 1.6 }}>用户名会记住；密码需主动勾选。每次打开仍需点击登录。</p>{memory.hasPassword && <button type="button" className="auth-network-entry" disabled={busy} onClick={() => void forgetPassword(true)}>清除这个账号记住的密码</button>}{memory.error && <p role="status" style={{ color: "#8a6842", lineHeight: 1.6 }}>{memory.error}</p>}</div>}
        <button className="button primary auth-submit" disabled={busy} type="submit">{busy ? <Loader2 className="spin" size={16} /> : <ShieldCheck size={16} />}{busy ? "正在打开…" : setup ? "创建本机工作室" : "登录工作室"}</button>
      </form>}
      <div className="auth-local-note"><span className="offline-dot" />{browserSurface ? "手机员工工作室 · 公司主机" : connectionLabel(connection)}<p>{client ? "客户和报价保存在店内主机。主机程序需保持打开。" : connection?.mode === "host" ? "客户和报价保存在这台主机，店内其他电脑可通过局域网共享。" : "客户、报价和图片保存在这台电脑。员工账号由本机管理员添加。"}</p>{!browserSurface && connection?.clientOnly && <p>员工端无需F盘。先打开下方连接设置，再使用主机创建的员工账号登录。</p>}{!browserSurface && <button className="auth-network-entry" type="button" disabled={busy} onClick={() => setNetworkOpen(true)}><Network size={13} />局域网连接设置</button>}{!browserSurface && <button className="auth-network-entry" type="button" data-testid="login-update-entry" disabled={busy} onClick={() => setUpdateOpen(true)}><ArrowUpCircle size={13} />一键升级</button>}{!browserSurface && setup && <p className="network-auth-context">连接已有主机时，可先打开连接设置，再使用主机账号登录。</p>}</div>
    </div><footer className="auth-footer">XIN JIN YUAN · PRIVATE JEWELRY SERVICE</footer></section>
  </main>{networkOpen && <NetworkSettingsModal admin={false} initialInfo={connection} onClose={() => setNetworkOpen(false)} onApplied={info => { ++revision.current; ++memoryRevision.current; ++memoryScopeRevision.current; setConnection(info); setInitial(null); setAuth(null); setForm(emptyForm); setRememberPassword(false); setMemory({ available: false, hasPassword: false, scopeKey: "", error: "" }); setError(""); }} />}{updateOpen && <EmployeeUpdate onClose={() => setUpdateOpen(false)} />}</>;
}
createRoot(document.getElementById("root")!).render(<><DesktopApp /><AppVersionBadge /></>);

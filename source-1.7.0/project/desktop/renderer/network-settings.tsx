import { useEffect, useRef, useState } from "react";
import { Check, Copy, Laptop, Loader2, Network, RefreshCw, Server, X } from "lucide-react";
import type { ConnectionInfo, ConnectionInput, ConnectionMode } from "./bridge";
import "./network-settings.css";

const defaultInfo: ConnectionInfo = { mode: "standalone", host: "", port: 31831, addresses: [], running: false, error: "" };
const modes: { id: ConnectionMode; label: string; detail: string; icon: typeof Laptop }[] = [
  { id: "standalone", label: "单机使用", detail: "只使用这台电脑保存的数据", icon: Laptop },
  { id: "host", label: "本机共享", detail: "让店内其他电脑连接这台主机", icon: Server },
  { id: "client", label: "连接主机", detail: "使用主机上的账号、客户和报价", icon: Network },
];

export function connectionLabel(info: ConnectionInfo | null | undefined): string {
  if (!info || info.mode === "standalone") return "本机独立工作室";
  if (info.mode === "host") return info.running ? "店内共享主机" : "主机服务待启动";
  return info.host ? `店内共享 · ${info.host}:${info.port}` : "店内共享客户端";
}

export function connectionInput(mode: ConnectionMode, host: string, port: string, code: string, info: ConnectionInfo, admin: boolean): ConnectionInput {
  if ((mode === "host" || info.mode === "host") && (!admin || info.mode === "client")) throw new Error("请先在这台主机用管理员账号登录，再修改共享服务。");
  if (mode === "standalone") return { mode };
  const value = Number(port), address = host.trim();
  if (!Number.isInteger(value) || value < 1024 || value > 65535) throw new Error("端口请输入1024至65535之间的整数。");
  const parts = address.split(".").map(Number);
  const ipv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(address) && parts.every(item => Number.isInteger(item) && item >= 0 && item <= 255);
  const privateAddress = ipv4 && (parts[0] === 10 || parts[0] === 192 && parts[1] === 168 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31 || parts[0] === 127);
  if (!privateAddress) throw new Error("请输入店内主机的局域网IPv4地址，例如192.168.1.20。");
  if (mode === "host" && !info.addresses.some(item => item.address === address)) throw new Error("请选择这台电脑的局域网地址，或先连接店内网络后刷新地址。");
  if (mode === "client") {
    const pairingCode = code.trim();
    if (!/^[A-Za-z0-9_-]{32}$/.test(pairingCode)) throw new Error("请粘贴主机显示的完整32位连接码。");
    return { mode, host: address, port: value, code: pairingCode };
  }
  return { mode, host: address, port: value, ...(info.mode === "host" && info.code ? { code: info.code } : {}) };
}

type Props = { admin: boolean; initialInfo?: ConnectionInfo | null; onApplied?: (info: ConnectionInfo) => void; onBusyChange?: (busy: boolean) => void };
export default function NetworkSettings({ admin, initialInfo, onApplied, onBusyChange }: Props) {
  const [info, setInfo] = useState<ConnectionInfo>(initialInfo || defaultInfo);
  const [mode, setMode] = useState<ConnectionMode>(initialInfo?.mode || "standalone");
  const [host, setHost] = useState(initialInfo?.host || ""), [port, setPort] = useState(String(initialInfo?.port || 31831)), [code, setCode] = useState("");
  const [loading, setLoading] = useState(!initialInfo), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const codeInput = useRef<HTMLInputElement>(null), alive = useRef(true);
  const canManageHost = admin && info.mode !== "client";
  const hostLocked = info.mode === "host" && !canManageHost;
  const acceptInfo = (value: ConnectionInfo) => { setInfo(value); setMode(value.mode); setHost(value.host || ""); setPort(String(value.port || 31831)); setCode(""); };
  const refresh = async () => {
    setLoading(true); setError("");
    try { const value = await window.jewelryDesktop.getConnection(); if (alive.current) acceptInfo(value); }
    catch (err) { if (alive.current) setError(err instanceof Error ? err.message : "连接设置暂时不可读取，请重试。"); }
    finally { if (alive.current) setLoading(false); }
  };
  useEffect(() => { alive.current = true; void refresh(); return () => { alive.current = false; }; }, []);
  const chooseMode = (next: ConnectionMode) => {
    setMode(next); setError(""); setNotice(""); setCode("");
    setHost(next === "host" ? info.mode === "host" ? info.host : info.addresses[0]?.address || "" : info.mode === "client" ? info.host : "");
    setPort(String(info.port || 31831));
  };
  const apply = async () => {
    if (busy || loading) return;
    setError(""); setNotice("");
    let input: ConnectionInput;
    try { input = connectionInput(mode, host, port, code, info, admin); }
    catch (err) { setError(err instanceof Error ? err.message : "请检查连接设置。"); return; }
    setBusy(true); onBusyChange?.(true);
    try {
      const result = await window.jewelryDesktop.setConnection(input);
      if (!result.ok) throw new Error(result.error || "连接设置未能保存，请重试。");
      const next = { ...info, ...result, mode: result.mode || input.mode } as ConnectionInfo;
      if (alive.current) { acceptInfo(next); setNotice("设置已保存，正在重新打开工作室，请重新登录。"); onApplied?.(next); }
    } catch (err) { if (alive.current) setError(err instanceof Error ? err.message : "主机连接未通过，请检查地址和连接码。"); }
    finally { if (alive.current) setBusy(false); onBusyChange?.(false); }
  };
  const copyCode = async () => {
    if (!admin || info.mode !== "host" || !info.code) return;
    try { await navigator.clipboard.writeText(info.code); setNotice("连接码已复制，请在店内其他电脑的连接设置中粘贴。"); }
    catch {
      codeInput.current?.focus(); codeInput.current?.select();
      try { if (!document.execCommand("copy")) throw new Error(); setNotice("连接码已复制。"); }
      catch { setNotice("连接码已选中，请按Ctrl+C复制。"); }
    }
  };
  const status = info.mode === "host" ? info.running ? "共享服务运行中" : "共享服务未启动" : info.mode === "client" ? "客户端连接配置" : "本机独立保存";
  return <section className="network-panel">
    <header className="network-heading"><div><span>LOCAL NETWORK</span><h2>店内电脑，共享一个工作室。</h2><p>主机集中保存资料，其他电脑用各自的用户名登录。</p></div><button className="network-refresh" type="button" disabled={busy || loading} onClick={() => void refresh()}><RefreshCw size={14} className={loading ? "spin" : ""} />刷新状态</button></header>
    <div className={`network-status ${info.error ? "has-error" : ""}`}><span className={`network-status-dot ${info.mode === "host" && !info.running ? "stopped" : ""}`} /><strong>{status}</strong>{info.mode !== "standalone" && <span>{info.host || "尚未设置地址"} : {info.port}</span>}</div>
    {info.error && <div className="network-feedback error" role="alert">{info.error}</div>}
    {error && <div className="network-feedback error" role="alert">{error}</div>}
    {notice && <div className="network-feedback success" role="status"><Check size={14} />{notice}</div>}
    {info.mode === "host" && admin && info.code && <section className="network-host-card"><div><h3>这台主机的连接信息</h3><p>在其他电脑的登录页打开“局域网连接设置”，填写以下信息。</p></div><dl><div><dt>主机地址</dt><dd>{info.host}</dd></div><div><dt>端口</dt><dd>{info.port}</dd></div></dl><label className="network-code-label">完整连接码<div><input ref={codeInput} value={info.code} readOnly aria-label="主机完整连接码" /><button type="button" className="button" onClick={() => void copyCode()}><Copy size={13} />复制</button></div></label></section>}
    <div className="network-mode-grid">{modes.filter(item => !info.clientOnly || item.id === 'client').map(item => <button className={`network-mode ${mode === item.id ? "selected" : ""}`} key={item.id} type="button" disabled={busy || loading || hostLocked || item.id === "host" && !canManageHost} onClick={() => chooseMode(item.id)}><item.icon size={20} strokeWidth={1.3} /><strong>{item.label}</strong><span>{item.detail}</span></button>)}</div>
    {hostLocked && <p className="network-help">当前电脑正在提供共享服务。请由这台主机的管理员登录后更改或停止服务。</p>}
    {mode === "host" && <div className="network-form"><label className="field"><span>本机局域网地址</span><select value={host} disabled={busy || !canManageHost} onChange={event => setHost(event.target.value)}><option value="">选择本机网卡地址</option>{info.addresses.map(item => <option key={`${item.name}-${item.address}`} value={item.address}>{item.address} · {item.name}</option>)}</select></label><label className="field"><span>共享端口</span><input type="number" min={1024} max={65535} value={port} disabled={busy || !canManageHost} onChange={event => setPort(event.target.value)} /></label><p className="network-help">开启后，主机程序需保持打开。其他电脑使用主机上的员工账号，客户和报价仍按账号权限显示。</p>{!info.addresses.length && <p className="network-help">未检测到店内局域网地址，请先连接店内网络后刷新地址。</p>}</div>}
    {mode === "client" && <div className="network-form"><label className="field"><span>店内主机IP地址</span><input value={host} maxLength={15} autoComplete="off" disabled={busy} onChange={event => setHost(event.target.value)} placeholder="例如192.168.1.20" /></label><label className="field"><span>主机端口</span><input type="number" min={1024} max={65535} value={port} disabled={busy} onChange={event => setPort(event.target.value)} /></label><label className="field network-span"><span>完整32位连接码</span><input type="password" value={code} maxLength={48} autoComplete="off" disabled={busy} onChange={event => setCode(event.target.value)} placeholder="粘贴主机管理员提供的完整连接码" /></label><p className="network-help">连接通过后，请使用主机管理员创建的用户名和密码登录。连接主机失败时，可在这里修改地址或重新输入连接码。</p></div>}
    {mode === "standalone" && <p className="network-help">使用这台电脑自己的账号、客户和报价。进入此模式后，共享主机上的资料仍保留在主机。</p>}
    <footer className="network-save"><p>保存连接设置后需要重新登录。</p><button className="button primary" type="button" disabled={busy || loading || hostLocked || mode === "host" && (!canManageHost || !info.addresses.length)} onClick={() => void apply()}>{busy ? <Loader2 className="spin" size={14} /> : <Network size={14} />}{busy ? "正在验证连接…" : mode === "client" ? "验证并连接主机" : mode === "host" ? "保存主机共享设置" : "使用本机模式"}</button></footer>
  </section>;
}

export function NetworkSettingsModal({ onClose, ...props }: Props & { onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  useEffect(() => { const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onClose(); }; document.addEventListener("keydown", escape); return () => document.removeEventListener("keydown", escape); }, [busy, onClose]);
  return <div className="network-modal-backdrop" onClick={() => { if (!busy) onClose(); }}><section className="network-modal" role="dialog" aria-modal="true" aria-label="局域网连接设置" onClick={event => event.stopPropagation()}><button className="network-modal-close" type="button" disabled={busy} aria-label="关闭连接设置" onClick={onClose}><X size={19} /></button><NetworkSettings {...props} onBusyChange={setBusy} /></section></div>;
}

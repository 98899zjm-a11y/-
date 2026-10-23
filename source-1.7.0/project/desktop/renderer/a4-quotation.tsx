import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { canHandleModalKey } from "./modal-focus";
import { A4Document, printA4Document } from "@/components/a4-quotation";
import type { QuotePaper } from "@/components/quote-card";

export default function A4Quotation({ papers, onClose, onHostPrint }: { papers: QuotePaper[]; onClose: () => void; onHostPrint?:()=>Promise<void> }) {
  const [mounted, setMounted] = useState(false), [printing, setPrinting] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const root = useRef<HTMLDivElement>(null), printButton = useRef<HTMLButtonElement>(null), closeButton = useRef<HTMLButtonElement>(null);
  const output = async (mode: "print" | "pdf") => {
    if (!root.current || printing) return; const target = root.current;
    setPrinting(true); setError(""); setNotice("");
    try {
      await printA4Document(target, () => {});
      if (mode === "print") { if(!onHostPrint)throw new Error('请从已保存报价的主机打印入口提交。');await onHostPrint(); }
      else {
        const result = await window.jewelryDesktop.exportPdf();
        if (!result.ok && !result.canceled) throw new Error(result.error || "PDF保存失败，请重试");
        if (result.ok) setNotice(`PDF已保存${result.path ? `：${result.path}` : ""}`);
      }
    } catch (err) { if (target.isConnected) setError(err instanceof Error ? err.message : "无法完成打印，请重试"); }
    finally { if (target.isConnected) setPrinting(false); }
  };
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    if (!mounted) return; printButton.current?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (!canHandleModalKey(event, root.current)) return;
      if (event.key === "Escape" && !printing) { event.preventDefault(); onClose(); }
      if (event.key === "Tab" && event.shiftKey && document.activeElement === printButton.current) { event.preventDefault(); closeButton.current?.focus(); }
      else if (event.key === "Tab" && !event.shiftKey && document.activeElement === closeButton.current) { event.preventDefault(); printButton.current?.focus(); }
    };
    document.addEventListener("keydown", keyboard); return () => document.removeEventListener("keydown", keyboard);
  }, [mounted, printing, onClose]);
  if (!mounted) return null;
  return createPortal(<div ref={root} className="a4-print-root" role="dialog" aria-modal="true" aria-labelledby="desktop-a4-title"><header className="a4-toolbar"><div><h2 id="desktop-a4-title">A4 报价单</h2><p>纵向打印 · 共 {papers.length} 页</p>{error && <p className="a4-print-error" role="alert">{error}</p>}{notice && <p className="a4-save-notice" role="status">{notice}</p>}</div><div className="a4-toolbar-actions"><button ref={printButton} disabled={printing} className="a4-toolbar-button a4-print-button" type="button" onClick={() => void output("print")}>{printing ? "正在准备…" : "提交主机打印"}</button><button disabled={printing} className="a4-toolbar-button" type="button" onClick={() => void output("pdf")}>保存PDF</button><button ref={closeButton} disabled={printing} className="a4-toolbar-button" type="button" onClick={onClose}>关闭返回</button></div></header><div className="a4-preview-scroll"><A4Document papers={papers} /></div></div>, document.body);
}

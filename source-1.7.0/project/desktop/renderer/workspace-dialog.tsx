import { useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { useModalFocus } from "./modal-focus";
import "./workspace-dialog.css";

export default function Dialog({ title, children, onClose, wide = false, className = "" }: {
  title: string; children: ReactNode; onClose: () => void; wide?: boolean; className?: string;
}) {
  const root = useRef<HTMLElement>(null), backdrop = useRef<HTMLDivElement>(null), titleId = useId();
  useModalFocus(true, root, backdrop, onClose, "dialog");
  return <div ref={backdrop} className={["dialog-backdrop", "workspace-dialog-backdrop", className].join(" ")}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={root} className={["dialog", wide ? "wide" : ""].join(" ")} role="dialog" aria-modal="true"
      aria-labelledby={titleId} aria-label={title} tabIndex={-1} data-xjy-modal="true" onClick={event => event.stopPropagation()}>
      <header><h2 id={titleId}>{title}</h2><button type="button" className="icon-button" data-modal-close="true" onClick={onClose} aria-label="关闭"><X size={20} /></button></header>
      {children}
    </section>
  </div>;
}

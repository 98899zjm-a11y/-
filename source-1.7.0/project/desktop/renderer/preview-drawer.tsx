import { useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { useModalFocus } from "./modal-focus";
import "./preview-drawer.css";
export default function PreviewDrawer({ open, onClose, children, actions }: { open: boolean; onClose: () => void; children: ReactNode; actions?: ReactNode }) {
  const dialog = useRef<HTMLElement>(null), surface = useRef<HTMLDivElement>(null);
  useModalFocus(open, dialog, surface, onClose, "drawer");
  return <div ref={surface} className={`quote-drawer-shell ${open ? "open" : ""}`} aria-hidden={!open} inert={!open}><button type="button" className="quote-drawer-scrim" tabIndex={-1} onClick={onClose} aria-label="关闭客户预览侧栏"/><section ref={dialog} className="quote-drawer" role="dialog" aria-modal={open} aria-label="客户报价预览" tabIndex={-1} data-xjy-modal="true"><header><div><span>CLIENT QUOTATION</span><h2>客户报价预览</h2><p>完整报价，多页可上下查看。</p></div><button type="button" className="icon-button" data-modal-close="true" aria-label="关闭客户报价预览" onClick={onClose}><X size={20}/></button></header><div className="quote-drawer-tools">{actions}</div><div className="quote-drawer-body">{children}</div></section></div>;
}

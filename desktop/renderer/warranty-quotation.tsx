import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, Printer, Save, X } from "lucide-react";
import type { QuoteInput } from "@/lib/domain";
import type { PrinterSettings } from "./bridge";
import WarrantyDocument, { prepareWarrantyDocument } from "./warranty-document";
import { createWarrantySheets, validateWarrantyData, warrantyFields, type WarrantyData, type WarrantySheet } from "./warranty-data";
import "./warranty-quotation.css";

const initialSettings: PrinterSettings = { deviceName: "", mode: "full", widthMm: 210, heightMm: 297, offsetXmm: 0, offsetYmm: 0, scalePercent: 100, copies: 1, phone: "", standard: "", afterSalesWechat: "" };
export default function WarrantyQuotation({ quote, onClose, date, number }: { quote: QuoteInput; onClose: () => void; date?: string; number?: string }) {
  const [settings, setSettings] = useState<PrinterSettings>(initialSettings), [sheets, setSheets] = useState<WarrantySheet[]>([]), [printers, setPrinters] = useState<{ name: string; displayName: string; isDefault: boolean }[]>([]);
  const [index, setIndex] = useState(0), [all, setAll] = useState(false), [busy, setBusy] = useState(false), [loaded, setLoaded] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let current = true;
    void Promise.all([window.jewelryDesktop.getPrintSettings(), window.jewelryDesktop.getPrinters()]).then(([saved, devices]) => {
      if (!current) return;
      const available = !saved.deviceName || devices.some(device => device.name === saved.deviceName);
      setSettings(available ? saved : { ...saved, deviceName: "" }); setPrinters(devices); setSheets(createWarrantySheets(quote, saved, { date })); setLoaded(true);
      if (!available) setNotice("原先设置的打印机目前不可用，可重新选择打印机或保存PDF。");
    }).catch(err => { if (current) setError(err instanceof Error ? err.message : "打印设置未能读取"); });
    return () => { current = false; };
  }, [quote, date]);
  useEffect(() => { const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onClose(); }; document.addEventListener("keydown", escape); return () => document.removeEventListener("keydown", escape); }, [busy, onClose]);
  const active = sheets[index];
  const edit = (key: keyof WarrantyData, value: string) => {
    setError(""); setNotice("");
    setSheets(previous => previous.map((sheet, position) => position === index || key === "phone" || key === "afterSalesWechat" ? { ...sheet, data: { ...sheet.data, [key]: value } } : sheet));
  };
  const saveSettings = async () => {
    const value = { ...settings, phone: active?.data.phone || "", standard: active?.data.standard || "", afterSalesWechat: active?.data.afterSalesWechat || "" };
    const result = await window.jewelryDesktop.savePrintSettings(value);
    if (!result.ok) throw new Error(result.error || "打印设置未能保存");
    return value;
  };
  const output = async (mode: "print" | "dialog" | "pdf") => {
    if (!root.current || busy || !loaded) return; const target = root.current;
    setBusy(true); setError(""); setNotice("");
    try {
      const selected = all ? sheets : [active];
      if (!selected.length || !selected[0]) throw new Error("请先添加商品");
      selected.forEach(sheet => validateWarrantyData(sheet.data));
      await prepareWarrantyDocument(target); await saveSettings();
      const result = mode === "pdf" ? await window.jewelryDesktop.exportWarrantyPdf() : await window.jewelryDesktop.printWarranty({ showDialog: mode === "dialog" });
      if (!result.ok && !result.canceled) throw new Error(result.error || "质保单输出未完成");
      if (result.ok) setNotice(mode === "pdf" ? `质保单已保存：${result.path || ""}` : "质保单已提交给打印机");
    } catch (err) { setError(err instanceof Error ? err.message : "暂时无法打印质保单"); }
    finally { setBusy(false); }
  };
  const save = async () => { setBusy(true); setError(""); setNotice(""); try { await saveSettings(); setNotice("打印机、纸张位置及常用电话、执行标准、售后微信已保存到本机"); } catch (err) { setError(err instanceof Error ? err.message : "设置未能保存"); } finally { setBusy(false); } };
  return createPortal(<div className="warranty-print-root" ref={root} role="dialog" aria-modal="true" aria-label="珠宝质保单开单打印">
    <style>{`@media print { @page { size: ${settings.widthMm}mm ${settings.heightMm}mm; margin: 0; } }`}</style>
    <header className="warranty-toolbar"><div><span>JEWELRY WARRANTY</span><h2>开单与质保单打印</h2><p>{number ? `报价 ${number} · ` : ""}按你的模板填入信息，核对后打单</p></div><div className="warranty-toolbar-actions"><button className="button primary" disabled={busy || !loaded} onClick={() => void output("print")}><Printer size={15} />{busy ? "正在处理…" : "一键打印"}</button><button className="button" disabled={busy || !loaded} onClick={() => void output("dialog")}>选择打印机</button><button className="button" disabled={busy || !loaded} onClick={() => void output("pdf")}><Download size={15} />保存PDF</button><button className="icon-button" aria-label="关闭质保单" disabled={busy} onClick={onClose}><X size={19} /></button></div></header>
    <div className="warranty-workbench"><aside className="warranty-controls">
      {error && <div className="feedback error" role="alert">{error}</div>}{notice && <div className="feedback success" role="status">{notice}</div>}
      {!loaded && !error && <p>正在导入本次商品信息…</p>}
      {sheets.length > 1 && <><div className="warranty-item-tabs">{sheets.map((sheet, position) => <button className={index === position ? "active" : ""} key={sheet.id} disabled={busy} onClick={() => setIndex(position)}>商品 {position + 1}</button>)}</div><label className="warranty-checkbox"><input type="checkbox" checked={all} disabled={busy} onChange={event => setAll(event.target.checked)} />一次打印全部 {sheets.length} 款商品</label><p className="muted-note">每款一张质保单。重量为该款所有件的合计金重；整单优惠按商品金额分摊，合计与报价一致。</p></>}
      {active && <div className="warranty-input-grid">{warrantyFields.map(field => <label className={`field ${["goodsNumber", "productName", "standard", "afterSalesWechat"].includes(field.key) ? "full" : ""}`} key={field.key}><span>{field.label}</span><input value={active.data[field.key]} disabled={busy} maxLength={field.maximum} onChange={event => edit(field.key, event.target.value)} placeholder={field.key === "goodsNumber" ? "填写并核对货品编号" : field.key === "standard" ? "填写本商品执行标准" : field.label} /></label>)}</div>}
      <details className="warranty-printer-options" open><summary>本机打印设置</summary><div className="warranty-input-grid"><label className="field full"><span>常用打印机</span><select disabled={busy} value={settings.deviceName} onChange={event => setSettings({ ...settings, deviceName: event.target.value })}><option value="">每次选择打印机</option>{printers.map(printer => <option key={printer.name} value={printer.name}>{printer.displayName}{printer.isDefault ? "（默认）" : ""}</option>)}</select></label><label className="field full"><span>纸张模式</span><select disabled={busy} value={settings.mode} onChange={event => setSettings({ ...settings, mode: event.target.value as PrinterSettings["mode"] })}><option value="full">空白纸：打印完整模板</option><option value="fields">预印纸：只套打填写文字</option></select></label>{([{ key: "widthMm", name: "纸宽（毫米）", min: 60, max: 420 }, { key: "heightMm", name: "纸高（毫米）", min: 60, max: 500 }, { key: "offsetXmm", name: "左右微调（毫米）", min: -30, max: 30 }, { key: "offsetYmm", name: "上下微调（毫米）", min: -30, max: 30 }, { key: "scalePercent", name: "模板缩放（%）", min: 60, max: 140 }, { key: "copies", name: "打印份数", min: 1, max: 10 }] as const).map(option => <label className="field" key={option.key}><span>{option.name}</span><input type="number" disabled={busy} step={option.key === "copies" ? 1 : .1} min={option.min} max={option.max} value={settings[option.key]} onChange={event => setSettings({ ...settings, [option.key]: Number(event.target.value) })} /></label>)}</div><p className="muted-note">模板原文件为 A4。填写实际纸张尺寸，正数向右或向下移动；复写联单的份数按实际纸联选择。</p><button className="button" disabled={busy || !loaded} onClick={() => void save()}><Save size={14} />保存本机打印设置</button></details>
    </aside><div className="warranty-preview-scroll">{(all ? sheets : active ? [active] : []).map(sheet => <WarrantyDocument key={sheet.id} data={sheet.data} {...settings} />)}</div></div>
  </div>, document.body);
}

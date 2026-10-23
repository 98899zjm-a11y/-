import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { canHandleModalKey } from "./modal-focus";
import { Download, Printer, Save, X } from "lucide-react";
import type { QuoteInput } from "@/lib/domain";
import type { PrinterSettings } from "./bridge";
import type { WarrantyPrintPresentation } from './remote-print';
import WarrantyDocument, { prepareWarrantyDocument } from "./warranty-document";
import { createWarrantySheets, validateWarrantyData, warrantyFields, warrantyProductNames, type WarrantyData, type WarrantySheet } from "./warranty-data";
import { WARRANTY_LAYOUT, twipsPerMm, normalizeWarrantyFontSizes } from "./warranty-layout";
import "./warranty-quotation.css";

const initialSettings: PrinterSettings = { deviceName: "", mode: "full", widthMm: 210, heightMm: 297, offsetXmm: 0, offsetYmm: 0, scalePercent: 100, copies: 1, phone: "", standard: "", afterSalesWechat: "" };
export default function WarrantyQuotation({ quote, onClose, date, number, onHostPrint }: { quote: QuoteInput; onClose: () => void; date?: string; number?: string; onHostPrint?:(presentation:WarrantyPrintPresentation)=>Promise<void> }) {
  const [settings, setSettings] = useState<PrinterSettings>(initialSettings), [sheets, setSheets] = useState<WarrantySheet[]>([]), [printers, setPrinters] = useState<{ name: string; displayName: string; isDefault: boolean }[]>([]);
  const [loadRevision, setLoadRevision] = useState(0), [printerError, setPrinterError] = useState("");
  const [layoutId,setLayoutId]=useState("1043");
  const [fontInput,setFontInput]=useState("");
  const [index, setIndex] = useState(0), [all, setAll] = useState(false), [busy, setBusy] = useState(false), [loaded, setLoaded] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const root = useRef<HTMLDivElement>(null), settingsRef = useRef(initialSettings), sheetsRef = useRef<WarrantySheet[]>([]), indexRef = useRef(0), loadedRef = useRef(false), busyRef = useRef(false), alive = useRef(true), persistence = useRef<Promise<unknown>>(Promise.resolve());
  const updateSettings = (value: PrinterSettings) => { settingsRef.current = value; setSettings(value); };
  const updateSheets = (change: (current: WarrantySheet[]) => WarrantySheet[]) => { const value = change(sheetsRef.current); sheetsRef.current = value; setSheets(value); };
  const saveSettings = () => {
    const active = sheetsRef.current[indexRef.current], value = { ...settingsRef.current, phone: active?.data.phone || "", afterSalesWechat: active?.data.afterSalesWechat || "", standard: "" };
    const pending = persistence.current.catch(() => {}).then(async () => {
      const result = await window.jewelryDesktop.savePrintSettings(value);
      if (!result.ok) throw new Error(result.error || "打印设置未能保存");
      return value;
    });
    persistence.current = pending; return pending;
  };
  useEffect(() => {
    let current = true; alive.current = true; loadedRef.current = false; setLoaded(false);
    setError(""); setPrinterError("");
    void persistence.current.catch(() => {}).then(() => Promise.allSettled([window.jewelryDesktop.getPrintSettings(), window.jewelryDesktop.getPrinters()])).then(([preference, printerList]) => {
      if (!current) return;
      if (preference.status === "rejected") throw preference.reason;
      const saved = preference.value;
      const devices = printerList.status === "fulfilled" ? printerList.value : [];
      const available = !saved.deviceName || printerList.status === "rejected" || devices.some(device => device.name === saved.deviceName);
      updateSettings(available ? saved : { ...saved, deviceName: "" }); setPrinters(devices); updateSheets(() => createWarrantySheets(quote, saved, { date })); indexRef.current = 0; setIndex(0); loadedRef.current = true; setLoaded(true);
      if (printerList.status === "rejected") setPrinterError("打印机列表暂时读取失败。可填写质保单、保存PDF，或重试加载打印机。");
      else if (!available) setNotice("原先设置的打印机目前不可用，可重新选择打印机或保存PDF。");
    }).catch(err => { if (current) setError(err instanceof Error ? err.message : "打印设置未能读取，请重试加载"); });
    return () => { current = false; alive.current = false; };
  }, [quote, date, loadRevision]);
  const close = async () => {
    if (busyRef.current) return;
    if (!loadedRef.current) { onClose(); return; }
    busyRef.current = true; setBusy(true); setError("");
    try { await saveSettings(); if (alive.current) onClose(); }
    catch (err) { if (alive.current) setError(err instanceof Error ? err.message : "电话与售后微信未能记住，请重试后关闭"); }
    finally { busyRef.current = false; if (alive.current) setBusy(false); }
  };
  useEffect(() => { const escape = (event: KeyboardEvent) => { if (!canHandleModalKey(event, root.current)) return; if (event.key === "Escape") { event.preventDefault(); void close(); } }; document.addEventListener("keydown", escape); return () => document.removeEventListener("keydown", escape); });
  const reloadPrintSettings = async () => {
    if (busyRef.current) return;
    if (!loadedRef.current) { setLoadRevision(value => value + 1); return; }
    busyRef.current = true; setBusy(true);
    try {
      const devices = await window.jewelryDesktop.getPrinters();
      if (!alive.current) return;
      setPrinters(devices); setPrinterError("");
      if (settingsRef.current.deviceName && !devices.some(device => device.name === settingsRef.current.deviceName)) updateSettings({ ...settingsRef.current, deviceName: "" });
      setNotice("打印机列表已更新，本次填写内容已保留");
    } catch { if (alive.current) setPrinterError("打印机列表暂时读取失败。可保存PDF，或再次重试。"); }
    finally { busyRef.current = false; if (alive.current) setBusy(false); }
  };
  const active = sheets[index];
  const layoutBlock=WARRANTY_LAYOUT.find(block=>String(block.id)===layoutId)!;
  const position=settings.layoutOffsets?.[layoutId]||{xMm:0,yMm:0};
  const layoutX=layoutBlock.box[0]/twipsPerMm+position.xMm,layoutY=(layoutBlock.box[1]+layoutBlock.origin)/twipsPerMm+position.yMm;
  const selectedFont=settings.fontSizes?.[layoutId]??layoutBlock.fontPt??10.5;
  const fontEditable=!layoutBlock.background&&(settings.mode==="full"||!!layoutBlock.field||!!layoutBlock.notes);
  useEffect(()=>setFontInput(String(selectedFont)),[layoutId,selectedFont]);
  const changeFont=(raw:string)=>{
    setFontInput(raw);
    if(!fontEditable||!raw.trim())return;
    const value=Number(raw);
    try{normalizeWarrantyFontSizes({[layoutId]:value});}catch{return;}
    updateSettings({...settingsRef.current,fontSizes:{...settingsRef.current.fontSizes,[layoutId]:value}});
    setError("");setNotice("");
  };
  const rememberFont=()=>{
    if(!fontEditable||busyRef.current||!loadedRef.current)return;
    try{if(!fontInput.trim())throw new Error("请选择5至36磅的字号");normalizeWarrantyFontSizes({[layoutId]:Number(fontInput)});}
    catch(err){setFontInput(String(selectedFont));setError(err instanceof Error?err.message:"字号无效");return;}
    void saveSettings().then(()=>{if(alive.current)setNotice("字号已记住");}).catch(err=>{if(alive.current)setError(err instanceof Error?err.message:"字号暂时未能保存");});
  };
  const moveLayout=(axis:"xMm"|"yMm",value:number)=>{
    if(!Number.isFinite(value))return;
    const origin=axis==="xMm"?layoutBlock.box[0]/twipsPerMm:(layoutBlock.box[1]+layoutBlock.origin)/twipsPerMm;
    updateSettings({...settingsRef.current,layoutOffsets:{...settingsRef.current.layoutOffsets,[layoutId]:{...(settingsRef.current.layoutOffsets?.[layoutId]||{xMm:0,yMm:0}),[axis]:value-origin}}});
  };
  const resetLayout=(allBlocks:boolean)=>{
    const next={...settingsRef.current.layoutOffsets},nextFonts={...settingsRef.current.fontSizes};if(allBlocks){updateSettings({...settingsRef.current,layoutOffsets:{},fontSizes:{}});}else{delete next[layoutId];delete nextFonts[layoutId];updateSettings({...settingsRef.current,layoutOffsets:next,fontSizes:nextFonts});}
    void save();
  };
  const edit = (key: keyof WarrantyData, value: string) => {
    if (!["goodsNumber", "productName", "phone", "afterSalesWechat"].includes(key)) return;
    setError(""); setNotice("");
    updateSheets(previous => previous.map((sheet, position) => position === indexRef.current || key === "phone" || key === "afterSalesWechat" ? { ...sheet, data: { ...sheet.data, [key]: value } } : sheet));
  };
  const rememberContacts = () => {
    if (!loadedRef.current || busyRef.current) return;
    void saveSettings().then(value => {
      const latest = sheetsRef.current[indexRef.current]?.data;
      if (alive.current && latest?.phone === value.phone && latest?.afterSalesWechat === value.afterSalesWechat) setNotice("电话与售后微信已自动记住");
    }).catch(err => { if (alive.current) setError(err instanceof Error ? err.message : "电话与售后微信暂时未能保存"); });
  };
  const output = async (mode: "print" | "dialog" | "pdf" | "docx") => {
    if (!root.current || busyRef.current || !loadedRef.current) return;
    const target = root.current; busyRef.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const selected = all ? sheetsRef.current : [sheetsRef.current[indexRef.current]];
      if (!selected.length || !selected[0]) throw new Error("请先添加商品");
      selected.forEach(sheet => validateWarrantyData(sheet.data));
      if(mode==='print'||mode==='dialog'){
        if(!onHostPrint)throw new Error('请从已保存报价的主机打印入口提交质保单。');
        await saveSettings();const indexes=selected.map(sheet=>sheetsRef.current.indexOf(sheet));
        await onHostPrint({itemIndexes:indexes,overrides:indexes.map(itemIndex=>({itemIndex,goodsNumber:sheetsRef.current[itemIndex].data.goodsNumber,productName:sheetsRef.current[itemIndex].data.productName,phone:sheetsRef.current[itemIndex].data.phone,afterSalesWechat:sheetsRef.current[itemIndex].data.afterSalesWechat})),layoutOffsets:settingsRef.current.layoutOffsets||{},fontSizes:settingsRef.current.fontSizes||{}});return;
      }
      await saveSettings(); await prepareWarrantyDocument(target);
      if (mode === "docx" && !window.jewelryDesktop.exportWarrantyDocx) throw new Error("此版本没有Word导出，请更新电脑程序");
      const result = mode === "docx" ? await window.jewelryDesktop.exportWarrantyDocx!({ sheets: selected, number, settings: { mode: settings.mode, widthMm: settings.widthMm, heightMm: settings.heightMm, offsetXmm: settings.offsetXmm, offsetYmm: settings.offsetYmm, scalePercent: settings.scalePercent, layoutOffsets: settings.layoutOffsets || {}, fontSizes: settings.fontSizes || {} } }) : await window.jewelryDesktop.exportWarrantyPdf();
      if (!result.ok && !result.canceled) throw new Error(result.error || "质保单输出未完成");
      if (result.ok && alive.current) setNotice(mode === "docx" ? "可编辑Word已保存：" + (result.path || "") : mode === "pdf" ? `质保单已保存：${result.path || ""}` : "质保单已提交给打印机");
    } catch (err) { if (alive.current) setError(err instanceof Error ? err.message : "暂时无法打印质保单"); }
    finally { busyRef.current = false; if (alive.current) setBusy(false); }
  };
  const save = async () => { if (busyRef.current || !loadedRef.current) return; busyRef.current = true; setBusy(true); setError(""); setNotice(""); try { await saveSettings(); if (alive.current) setNotice("打印设置、常用电话和售后微信已保存到本机"); } catch (err) { if (alive.current) setError(err instanceof Error ? err.message : "设置未能保存"); } finally { busyRef.current = false; if (alive.current) setBusy(false); } };
  return createPortal(<div className="warranty-print-root" ref={root} role="dialog" aria-modal="true" aria-label="珠宝质保单开单打印">
    <style>{`@media print { @page { size: ${settings.widthMm}mm ${settings.heightMm}mm; margin: 0; } }`}</style>
    <header className="warranty-toolbar"><div><span>JEWELRY WARRANTY</span><h2>开单与质保单打印</h2><p>{number ? `报价 ${number} · ` : ""}核对品名与货号，克重和金额自动填入</p></div><div className="warranty-toolbar-actions"><button className="button primary" disabled={busy || !loaded || !!printerError} onClick={() => void output("print")}><Printer size={15} />{busy ? "正在处理…" : "提交主机打印"}</button><button className="button" disabled={busy || !loaded || !!printerError} onClick={() => void output("dialog")}>核对主机打印</button><button className="button" disabled={busy || !loaded} onClick={() => void output("pdf")}><Download size={15} />保存PDF</button><button className="button" disabled={busy || !loaded} onClick={() => void output("docx")}><Download size={15} />导出Word</button><button className="icon-button" aria-label="关闭质保单" disabled={busy} onClick={() => void close()}><X size={19} /></button></div></header>
    <div className="warranty-workbench"><aside className="warranty-controls">
      {error && <div className="feedback error" role="alert">{error}</div>}{notice && <div className="feedback success" role="status">{notice}</div>}{printerError && <p className="muted-note" role="status">{printerError}</p>}{(printerError || !loaded && !!error) && <button className="button" disabled={busy} onClick={() => void reloadPrintSettings()}>重新加载打印设置</button>}
      {!loaded && !error && <p>正在导入本次商品信息…</p>}
      {sheets.length > 1 && <><div className="warranty-item-tabs">{sheets.map((sheet, position) => <button className={index === position ? "active" : ""} key={sheet.id} disabled={busy} onClick={() => { indexRef.current = position; setIndex(position); }}>商品 {position + 1}</button>)}</div><label className="warranty-checkbox"><input type="checkbox" checked={all} disabled={busy} onChange={event => setAll(event.target.checked)} />一次打印全部 {sheets.length} 款商品</label></>}
      <p className="muted-note">重量为该款所有件的合计金重，“执行标准”栏自动显示这款报价时的每克金价（元/克）。品名修改仅用于本次质保单。电话和售后微信会自动记住。</p>
      {active && <div className="warranty-input-grid">{warrantyFields.map(field => <label className={`field ${["goodsNumber", "productName", "standard", "afterSalesWechat"].includes(field.key) ? "full" : ""}`} key={field.key}><span>{field.label}</span>{field.key === "productName" && <select aria-label="选择质保品名" disabled={busy} value={warrantyProductNames.includes(active.data.productName as typeof warrantyProductNames[number]) ? active.data.productName : "custom"} onChange={event => edit("productName", event.target.value === "custom" ? "" : event.target.value)}><option value="custom">报价品名 / 自定义</option>{warrantyProductNames.map(name => <option key={name} value={name}>{name}</option>)}</select>}<input value={active.data[field.key]} disabled={busy} readOnly={field.readonly} maxLength={field.maximum} onChange={event => edit(field.key, event.target.value)} onBlur={field.key === "phone" || field.key === "afterSalesWechat" ? rememberContacts : undefined} placeholder={field.key === "goodsNumber" ? "填写并核对货品编号" : field.key === "productName" ? "选择以上品名或自行填写" : field.label} /></label>)}</div>}
      {active?.data.tradeInNote && <div className="warranty-trade-summary"><strong>旧金与补差信息</strong><p>{active.data.tradeInNote}</p></div>}
      <details className="warranty-layout-options" open><summary>质保单位置与字号</summary><p className="muted-note">可调整文字和图文块的位置，表格格线保持原样。去背景模式保留原模板全部文字、位置和字号；底图图文仅在含背景模式中输出。重量、金额和日期仍来自报价。以下位置以210毫米模板左上角为起点，整体缩放和打印微调会统一应用。</p><div className="warranty-input-grid"><label className="field full"><span>选择布局区块</span><select aria-label="选择布局区块" disabled={busy} value={layoutId} onChange={event=>setLayoutId(event.target.value)}>{WARRANTY_LAYOUT.map(block=><option key={block.id} disabled={!!block.background&&settings.mode==="fields"} value={String(block.id)}>{block.label}{block.background?"（底图图文）":""}</option>)}</select></label><label className="field"><span>左距（毫米）</span><input aria-label="布局左距" type="number" step="0.1" disabled={busy||!!layoutBlock.background&&settings.mode==="fields"} value={Number(layoutX.toFixed(3))} onChange={event=>moveLayout("xMm",Number(event.target.value))}/></label><label className="field"><span>上距（毫米）</span><input aria-label="布局上距" type="number" step="0.1" disabled={busy||!!layoutBlock.background&&settings.mode==="fields"} value={Number(layoutY.toFixed(3))} onChange={event=>moveLayout("yMm",Number(event.target.value))}/></label><label className="field full warranty-font-control"><span>字体大小（磅）</span><input aria-label="质保字号" type="number" min="5" max="36" step="0.5" disabled={busy||!fontEditable} value={layoutBlock.background?"":fontInput} placeholder={layoutBlock.background?"底图图片无法改字号":"5至36磅"} onChange={event=>changeFont(event.target.value)} onBlur={rememberFont}/><small>{layoutBlock.background?"这块是底图图片，只能移动位置，无法改变文字字号。":!fontEditable?"原模板固定文字也会打印；如需调整字号，请切换完整模板设置。":"字号会同步到本机打印、PDF和Word。放不下时会提示，所选字号不会自动缩小。"}</small></label></div><div className="warranty-layout-actions"><button className="button" disabled={busy||!loaded} onClick={()=>void save()}>保存位置与字号</button><button className="button" disabled={busy||!loaded} onClick={()=>resetLayout(false)}>恢复本块默认</button><button className="button" disabled={busy||!loaded} onClick={()=>resetLayout(true)}>恢复全部默认布局</button></div><p className="muted-note">文字越出纸张或放不下时会拒绝输出，请调整位置、纸张或缩放。主机远程打印使用主机保存的布局。</p></details>
      <details className="warranty-printer-options" open><summary>本机打印设置</summary><div className="warranty-input-grid"><label className="field full"><span>常用打印机</span><select disabled={busy} value={settings.deviceName} onChange={event => updateSettings({ ...settingsRef.current, deviceName: event.target.value })}><option value="">每次选择打印机</option>{printers.map(printer => <option key={printer.name} value={printer.name}>{printer.displayName}{printer.isDefault ? "（默认）" : ""}</option>)}</select></label><label className="field full"><span>纸张模式</span><select disabled={busy} value={settings.mode} onChange={event => updateSettings({ ...settingsRef.current, mode: event.target.value as PrinterSettings["mode"] })}><option value="full">空白纸：打印完整模板</option><option value="fields">预印纸：仅去背景，保留全部文字</option></select></label>{([{ key: "widthMm", name: "纸宽（毫米）", min: 60, max: 420 }, { key: "heightMm", name: "纸高（毫米）", min: 60, max: 500 }, { key: "offsetXmm", name: "左右微调（毫米）", min: -30, max: 30 }, { key: "offsetYmm", name: "上下微调（毫米）", min: -30, max: 30 }, { key: "scalePercent", name: "模板缩放（%）", min: 60, max: 140 }, { key: "copies", name: "打印份数", min: 1, max: 10 }] as const).map(option => <label className="field" key={option.key}><span>{option.name}</span><input type="number" disabled={busy} step={option.key === "copies" ? 1 : .1} min={option.min} max={option.max} value={settings[option.key]} onChange={event => updateSettings({ ...settingsRef.current, [option.key]: Number(event.target.value) })} /></label>)}</div><p className="muted-note">模板原位置保留。短纸若容不下旧金信息，请减小缩放或增加纸高，程序会在输出前检查。</p><button className="button" disabled={busy || !loaded} onClick={() => void save()}><Save size={14} />保存本机打印设置</button></details>
    </aside><div className="warranty-preview-scroll">{(all ? sheets : active ? [active] : []).map(sheet => <WarrantyDocument key={sheet.id} data={sheet.data} {...settings} />)}</div></div>
  </div>, document.body);
}

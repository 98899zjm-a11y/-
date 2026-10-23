import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { WarrantyData } from "./warranty-data";
import "./warranty-document.css";

export type { WarrantyData } from "./warranty-data";
export type WarrantyDocumentProps = {
  data: WarrantyData; mode: "full" | "fields"; offsetXmm?: number; offsetYmm?: number;
  widthMm?: number; heightMm?: number; scalePercent?: number;
  layoutOffsets?: WarrantyLayoutOffsets;
  fontSizes?: WarrantyFontSizes;
};
import { WARRANTY_LAYOUT, warrantyTextValue, twipsPerMm, normalizeWarrantyLayoutOffsets, normalizeWarrantyFontSizes, effectiveWarrantyFontSize, type WarrantyLayoutOffsets, type WarrantyFontSizes, type TemplateText } from "./warranty-layout";
export { WARRANTY_LAYOUT } from "./warranty-layout";

function WarrantyText({ template, data, scaleX, scaleY, mode, position, fontSize }: { template: TemplateText; data: WarrantyData; scaleX: number; scaleY: number; mode: WarrantyDocumentProps['mode']; position?: {xMm:number;yMm:number};fontSize?:number }) {
  const element = useRef<HTMLDivElement>(null), [overflow, setOverflow] = useState(false), [ready, setReady] = useState(false);
  const value = warrantyTextValue(template, data), explicitFont=fontSize!==undefined, fontPt=explicitFont?effectiveWarrantyFontSize(fontSize,scaleX):(template.fontPt||10.5)*scaleX;
  useEffect(() => {
    let active = true;
    const fit = async () => {
      await document.fonts.ready;
      if (!active || !element.current) return;
      const box = element.current;
      const minimum = explicitFont?fontPt:(template.fixed || template.notes ? 8 : 7) * scaleX;
      let current = fontPt;
      box.style.fontSize = `${current}pt`;
      const tooLarge = () => box.scrollWidth > box.clientWidth + 1 || box.scrollHeight > box.clientHeight + 1;
      while (tooLarge() && current > minimum) { current = Math.max(minimum, current - .25 * scaleX); box.style.fontSize = `${current}pt`; }
      setOverflow(tooLarge()); setReady(true);
    };
    setReady(false);
    void fit();
    return () => { active = false; };
  }, [value, scaleX, scaleY, fontPt, explicitFont, template, mode]);
  const [left, top, right, bottom] = template.box;
  const style: CSSProperties = {
    left: `${(left / twipsPerMm + (position?.xMm || 0)) * scaleX}mm`, top: `${((top + template.origin) / twipsPerMm + (position?.yMm || 0)) * scaleY}mm`,
    width: `${(right - left) / twipsPerMm * scaleX}mm`, height: `${(bottom - top) / twipsPerMm * scaleY}mm`,
    fontSize: `${fontPt}pt`, fontWeight: template.bold ? 700 : 400,
    textAlign: template.align || "left", whiteSpace: template.multiline ? "pre-wrap" : "pre",
    lineHeight: template.notes ? 1.5 : 1.1,
  };
  return <div ref={element} className={`warranty-text${overflow ? " warranty-overflow" : ""}`} style={style} data-warranty-field={template.label} data-warranty-source-spid={template.id} data-warranty-overflow={overflow ? "true" : "false"} data-warranty-ready={ready ? "true" : "false"}>{value}</div>;
}

function BackgroundMask({ template, scale }: {template:TemplateText;scale:number}) {
  const [left,top,right,bottom]=template.box;
  return <div className="warranty-background-mask" aria-hidden="true" data-warranty-mask={template.id} style={{left:left/twipsPerMm*scale+"mm",top:top/twipsPerMm*scale+"mm",width:(right-left)/twipsPerMm*scale+"mm",height:(bottom-top)/twipsPerMm*scale+"mm"}} />;
}
function BackgroundFragment({template,scale,position}:{template:TemplateText;scale:number;position:{xMm:number;yMm:number}}) {
  const [left,top,right,bottom]=template.box;
  return <div className="warranty-background-fragment" data-warranty-field={template.label} data-warranty-source-spid={template.id} data-warranty-background="true" data-warranty-ready="true" data-warranty-overflow="false" style={{left:(left/twipsPerMm+position.xMm)*scale+"mm",top:(top/twipsPerMm+position.yMm)*scale+"mm",width:(right-left)/twipsPerMm*scale+"mm",height:(bottom-top)/twipsPerMm*scale+"mm"}}><img alt={template.label} src={new URL("./warranty-template.jpg",document.baseURI).href} style={{left:-left/twipsPerMm*scale+"mm",top:-top/twipsPerMm*scale+"mm",width:210*scale+"mm",height:297*scale+"mm"}}/></div>;
}
function TradeInFooter({ text, scale, heightMm, offsetYmm,layoutOffsets }: { text: string; scale: number; heightMm: number; offsetYmm: number;layoutOffsets:WarrantyLayoutOffsets }) {
  const element = useRef<HTMLDivElement>(null), [ready, setReady] = useState(false), [overflow, setOverflow] = useState(false);
  const top = (Math.max(...WARRANTY_LAYOUT.map(item => (item.box[3] + item.origin) / twipsPerMm+(layoutOffsets[String(item.id)]?.yMm||0))) + 1) * scale;
  const available = Math.max(0, Math.min(16 * scale, heightMm - offsetYmm - top - scale));
  useEffect(() => {
    let active = true; setReady(false);
    void document.fonts.ready.then(() => {
      if (!active || !element.current) return;
      const box = element.current; let font = 8 * scale;
      const tooLarge = () => available <= 0 || box.scrollWidth > box.clientWidth + 1 || box.scrollHeight > box.clientHeight + 1;
      box.style.fontSize = `${font}pt`;
      while (tooLarge() && font > 7 * scale) { font = Math.max(7 * scale, font - .25 * scale); box.style.fontSize = `${font}pt`; }
      setOverflow(tooLarge()); setReady(true);
    });
    return () => { active = false; };
  }, [text, scale, available]);
  return <div ref={element} className={`warranty-text warranty-trade-in${overflow ? " warranty-overflow" : ""}`} data-warranty-field="整单旧金信息" data-warranty-trade="true" data-warranty-ready={ready ? "true" : "false"} data-warranty-overflow={overflow ? "true" : "false"} style={{ left: `${10 * scale}mm`, top: `${top}mm`, width: `${190 * scale}mm`, height: `${available}mm`, fontSize: `${8 * scale}pt`, lineHeight: 1.35, whiteSpace: "pre-wrap" }}>{text}</div>;
}

export async function prepareWarrantyDocument(root: HTMLElement): Promise<void> {
  if (!root.isConnected) throw new Error("质保单预览已关闭");
  await root.ownerDocument.fonts.ready;
  await Promise.all([...root.querySelectorAll<HTMLImageElement>("img")].map(async image => { await image.decode(); if (!image.naturalWidth) throw new Error("质保单模板图片未能加载"); }));
  const deadline = Date.now() + 3000;
  while ([...root.querySelectorAll<HTMLElement>("[data-warranty-field]")].some(field => field.dataset.warrantyReady !== "true")) {
    if (Date.now() >= deadline) throw new Error("质保单排版尚未完成，请重试");
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  const failed = [...root.querySelectorAll<HTMLElement>("[data-warranty-field]")].filter(field => field.dataset.warrantyOverflow === "true" || !field.dataset.warrantyBackground&&(field.scrollWidth > field.clientWidth + 1 || field.scrollHeight > field.clientHeight + 1));
  if (failed.some(field => field.dataset.warrantyTrade)) throw new Error("旧金信息无法放入当前纸张，请增加纸张高度或减小模板缩放后打印");
  if (failed.length) throw new Error(`以下文字放不下，请减小字号或精简后输出：${failed.map(field => field.dataset.warrantyField).join("、")}`);
  for (const sheet of [...root.querySelectorAll<HTMLElement>(".warranty-sheet"), ...(root.matches(".warranty-sheet") ? [root] : [])]) {
    const paper = sheet.getBoundingClientRect();
    const outside = [...sheet.querySelectorAll<HTMLElement>("[data-warranty-field]")].filter(field => {
      if (!field.textContent?.trim()) return false;
      const rect = field.getBoundingClientRect();
      return rect.left < paper.left - 1 || rect.top < paper.top - 1 || rect.right > paper.right + 1 || rect.bottom > paper.bottom + 1;
    });
    if (outside.length) throw new Error(`以下字段超出当前纸张，请调整纸张、缩放或偏移：${outside.map(field => field.dataset.warrantyField).join("、")}`);
    for (const footer of sheet.querySelectorAll<HTMLElement>("[data-warranty-trade]")) {
      const lower = footer.getBoundingClientRect();
      const collisions = [...sheet.querySelectorAll<HTMLElement>("[data-warranty-field]:not([data-warranty-trade])")].filter(field => {
        if (!field.textContent?.trim()) return false;
        const rect = field.getBoundingClientRect();
        return rect.left < lower.right - 1 && rect.right > lower.left + 1 && rect.top < lower.bottom - 1 && rect.bottom > lower.top + 1;
      });
      if (collisions.length) throw new Error("旧金信息与原模板内容重叠，请调整纸张或缩放后打印");
    }
  }
}

export function WarrantyDocument({ data, mode, offsetXmm = 0, offsetYmm = 0, widthMm = 210, heightMm = 297, scalePercent = 100,layoutOffsets:inputOffsets,fontSizes:inputFontSizes }: WarrantyDocumentProps) {
  const scaleX = widthMm / 210 * scalePercent / 100, scaleY = scaleX;
  const layoutOffsets=normalizeWarrantyLayoutOffsets(inputOffsets);
  const fontSizes=normalizeWarrantyFontSizes(inputFontSizes);
  const movedBackground=WARRANTY_LAYOUT.filter(block=>block.background&&(layoutOffsets[String(block.id)]?.xMm||layoutOffsets[String(block.id)]?.yMm));
  return <article className={`warranty-sheet warranty-mode-${mode}`} aria-label={mode === "full" ? "质保单完整打印" : "质保单预印纸套打"} style={{ width: `${widthMm}mm`, height: `${heightMm}mm` }}>
    <div className="warranty-overlay" style={{ transform: `translate(${offsetXmm}mm,${offsetYmm}mm)` }}>
      {mode === "full" && <img className="warranty-background" style={{ width: `${210 * scaleX}mm`, height: `${297 * scaleX}mm` }} src={new URL("./warranty-template.jpg", document.baseURI).href} alt="用户提供的珠宝质保单底图" />}
      {mode==="full"&&movedBackground.map(template=><BackgroundMask key={"mask"+template.id} template={template} scale={scaleX}/>)}
      {mode==="full"&&movedBackground.map(template=><BackgroundFragment key={"crop"+template.id} template={template} scale={scaleX} position={layoutOffsets[String(template.id)]}/>)}
      {WARRANTY_LAYOUT.filter(template => !template.background).map(template => <WarrantyText key={template.id} template={template} data={data} scaleX={scaleX} scaleY={scaleY} mode={mode} position={layoutOffsets[String(template.id)]} fontSize={fontSizes[String(template.id)]} />)}
      {data.tradeInNote && <TradeInFooter text={data.tradeInNote} scale={scaleX} heightMm={heightMm} offsetYmm={offsetYmm} layoutOffsets={layoutOffsets} />}
    </div>
    <div className="warranty-validation-hint" role="alert">红框内容过长，请精简后打印。</div>
  </article>;
}

export default WarrantyDocument;

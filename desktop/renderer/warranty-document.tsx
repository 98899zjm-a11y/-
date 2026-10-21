import { useEffect, useRef, useState, type CSSProperties } from "react";
import "./warranty-document.css";

export type WarrantyData = {
  phone: string; date: string; goodsNumber: string; productName: string; weight: string;
  standard: string; quantity: string; amount: string; total: string; afterSalesWechat: string;
};
export type WarrantyDocumentProps = {
  data: WarrantyData; mode: "full" | "fields"; offsetXmm?: number; offsetYmm?: number;
  widthMm?: number; heightMm?: number; scalePercent?: number;
};
type TemplateText = {
  id: number; label: string; box: [number, number, number, number]; origin: number;
  fixed?: string; field?: keyof WarrantyData; prefix?: string; fontPt?: number;
  bold?: boolean; align?: "left" | "center" | "right"; multiline?: boolean; notes?: boolean;
};
const twipsPerMm = 1440 / 25.4;
// X/width/height and font sizes are read from the supplied WPS's FSPA/CHPX.
// WPS's Y values are paragraph-relative. The paragraph origins below reconstruct
// that positioning against its retained A4 background; printer offsets remain explicit.
export const WARRANTY_LAYOUT: TemplateText[] = [
  { id: 1043, label: "店名", box: [2180,141,5346,440], origin:268, fixed:"深圳鑫金源珠宝", fontPt:10.5, bold:true },
  { id: 1044, label: "地址", box: [2151,396,7220,740], origin:268, fixed:"广东省深圳市福田区彩田路中深花园大厦A座8楼", fontPt:7, bold:true },
  { id: 1042, label: "电话", box: [2136,681,5346,935], origin:268, field:"phone", fontPt:10.5, bold:true },
  { id: 1041, label: "销售编号说明", box: [2136,936,5346,1175], origin:268, fixed:"以实际货品编号为准", fontPt:10.5 },
  { id: 1040, label: "日期", box: [8962,252,10582,612], origin:1054, field:"date", fontPt:10.5 },
  { id: 1037, label: "货品编号抬头", box: [879,1387,2258,1746], origin:268, fixed:"货品编号", fontPt:10.5, bold:true, align:"center" },
  { id: 1038, label: "品名抬头", box: [2499,183,3594,557], origin:1534, fixed:"品名", fontPt:10.5, bold:true, align:"center" },
  { id: 1092, label: "重量抬头", box: [4524,1386,5590,1760], origin:268, fixed:"重量", fontPt:10.5, bold:true, align:"center" },
  { id: 1095, label: "执行标准抬头", box: [6324,123,7390,497], origin:1534, fixed:"执行标准", fontPt:10.5, bold:true, align:"center" },
  { id: 1105, label: "件数抬头", box: [7989,123,9055,497], origin:1534, fixed:"件数", fontPt:10.5, bold:true, align:"center" },
  { id: 1039, label: "金额抬头", box: [9561,153,10762,497], origin:1534, fixed:"金额", fontPt:10.5, bold:true, align:"center" },
  { id: 1026, label: "货品编号", box: [852,179,2230,1494], origin:2014, field:"goodsNumber", fontPt:10.5, align:"center", multiline:true },
  { id: 1036, label: "品名", box: [2516,176,4215,1408], origin:2014, field:"productName", fontPt:10.5, align:"center", multiline:true },
  { id: 1096, label: "重量", box: [4708,519,5653,1480], origin:1774, field:"weight", fontPt:10.5, align:"center", multiline:true },
  { id: 1099, label: "执行标准", box: [6402,222,7634,1527], origin:2014, field:"standard", fontPt:10.5, align:"center", multiline:true },
  { id: 1113, label: "件数", box: [8248,190,9298,670], origin:2014, field:"quantity", fontPt:10.5, align:"center" },
  { id: 1035, label: "金额", box: [9759,223,10873,2287], origin:2014, field:"amount", fontPt:10.5, align:"center" },
  { id: 1034, label: "付款方式", box: [2201,4163,5124,4522], origin:268, fixed:"微信支付", fontPt:10.5 },
  { id: 1033, label: "检测结果", box: [6414,4164,8181,4523], origin:268, fixed:"合格", fontPt:10.5 },
  { id: 1032, label: "合计", box: [9799,62,11467,914], origin:4430, field:"total", fontPt:10.5, align:"center" },
  { id: 1029, label: "章印已检查", box: [2918,4017,3231,4271], origin:1054, fixed:"√", fontPt:10.5 },
  { id: 1031, label: "货品已检查", box: [5140,3956,5438,4210], origin:1054, fixed:"√", fontPt:10.5 },
  { id: 1030, label: "内容已解释", box: [7763,3945,8245,4241], origin:1054, fixed:"√", fontPt:10.5 },
  { id: 1028, label: "经手人", box: [2351,4332,4224,4568], origin:1054, fixed:"苗苗", fontPt:10.5 },
  { id: 1027, label: "售后微信", box: [7303,4297,9505,4621], origin:1054, field:"afterSalesWechat", prefix:"售后微信：", fontPt:10.5 },
  { id: 1107, label: "售后说明", box: [1282,250,8465,1890], origin:2254, fontPt:10.5, multiline:true, notes:true },
];

function valueFor(template: TemplateText, data: WarrantyData) {
  if (template.notes) return `售后：加微信${data.afterSalesWechat}发送货品编码可终身补工费以旧换新。\n本店产品为贵重物品，售前已确认非七天无理由产品，\n售出概不退换，请仔细检查清楚。`;
  return template.fixed ?? `${template.prefix || ""}${template.field ? data[template.field] : ""}`;
}

function WarrantyText({ template, data, scaleX, scaleY }: { template: TemplateText; data: WarrantyData; scaleX: number; scaleY: number }) {
  const element = useRef<HTMLDivElement>(null), [overflow, setOverflow] = useState(false), [ready, setReady] = useState(false);
  const value = valueFor(template, data), fontPt = template.fontPt || 10.5;
  useEffect(() => {
    let active = true;
    const fit = async () => {
      await document.fonts.ready;
      if (!active || !element.current) return;
      const box = element.current;
      const minimum = (template.fixed || template.notes ? 8 : 7) * scaleX;
      let current = fontPt * scaleX;
      box.style.fontSize = `${current}pt`;
      const tooLarge = () => box.scrollWidth > box.clientWidth + 1 || box.scrollHeight > box.clientHeight + 1;
      while (tooLarge() && current > minimum) { current = Math.max(minimum, current - .25 * scaleX); box.style.fontSize = `${current}pt`; }
      setOverflow(tooLarge()); setReady(true);
    };
    setReady(false);
    void fit();
    return () => { active = false; };
  }, [value, scaleX, scaleY, fontPt, template]);
  const [left, top, right, bottom] = template.box;
  const style: CSSProperties = {
    left: `${left / twipsPerMm * scaleX}mm`, top: `${(top + template.origin) / twipsPerMm * scaleY}mm`,
    width: `${(right - left) / twipsPerMm * scaleX}mm`, height: `${(bottom - top) / twipsPerMm * scaleY}mm`,
    fontSize: `${fontPt * scaleX}pt`, fontWeight: template.bold ? 700 : 400,
    textAlign: template.align || "left", whiteSpace: template.multiline ? "pre-wrap" : "pre",
    lineHeight: template.notes ? 1.5 : 1.1,
  };
  return <div ref={element} className={`warranty-text${overflow ? " warranty-overflow" : ""}`} style={style} data-warranty-field={template.label} data-warranty-source-spid={template.id} data-warranty-overflow={overflow ? "true" : "false"} data-warranty-ready={ready ? "true" : "false"}>{value}</div>;
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
  const failed = [...root.querySelectorAll<HTMLElement>("[data-warranty-field]")].filter(field => field.dataset.warrantyOverflow === "true" || field.scrollWidth > field.clientWidth + 1 || field.scrollHeight > field.clientHeight + 1);
  if (failed.length) throw new Error(`以下内容过长，请精简后打印：${failed.map(field => field.dataset.warrantyField).join("、")}`);
  for (const sheet of [...root.querySelectorAll<HTMLElement>(".warranty-sheet"), ...(root.matches(".warranty-sheet") ? [root] : [])]) {
    const paper = sheet.getBoundingClientRect();
    const outside = [...sheet.querySelectorAll<HTMLElement>("[data-warranty-field]")].filter(field => {
      if (!field.textContent?.trim()) return false;
      const rect = field.getBoundingClientRect();
      return rect.left < paper.left - 1 || rect.top < paper.top - 1 || rect.right > paper.right + 1 || rect.bottom > paper.bottom + 1;
    });
    if (outside.length) throw new Error(`以下字段超出当前纸张，请调整纸张、缩放或偏移：${outside.map(field => field.dataset.warrantyField).join("、")}`);
  }
}

export function WarrantyDocument({ data, mode, offsetXmm = 0, offsetYmm = 0, widthMm = 210, heightMm = 297, scalePercent = 100 }: WarrantyDocumentProps) {
  const scaleX = widthMm / 210 * scalePercent / 100, scaleY = scaleX;
  return <article className={`warranty-sheet warranty-mode-${mode}`} aria-label={mode === "full" ? "质保单完整打印" : "质保单预印纸套打"} style={{ width: `${widthMm}mm`, height: `${heightMm}mm` }}>
    <div className="warranty-overlay" style={{ transform: `translate(${offsetXmm}mm,${offsetYmm}mm)` }}>
      {mode === "full" && <img className="warranty-background" style={{ width: `${210 * scaleX}mm`, height: `${297 * scaleX}mm` }} src={new URL("./warranty-template.jpg", document.baseURI).href} alt="用户提供的珠宝质保单底图" />}
      {WARRANTY_LAYOUT.map(template => <WarrantyText key={template.id} template={template} data={data} scaleX={scaleX} scaleY={scaleY} />)}
    </div>
    <div className="warranty-validation-hint" role="alert">红框内容过长，请精简后打印。</div>
  </article>;
}

export default WarrantyDocument;

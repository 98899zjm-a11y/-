import type { WarrantyData } from "./warranty-data";
export const WARRANTY_AFTERSALES_SHIFT_MM = 8;
export type TemplateText = {
  id: number; label: string; box: [number, number, number, number]; origin: number;
  fixed?: string; field?: keyof WarrantyData; prefix?: string; fontPt?: number;
  bold?: boolean; align?: "left" | "center" | "right"; multiline?: boolean; notes?: boolean;
  background?: [number, number, number, number];
};
export type WarrantyLayoutOffsets = Record<string, { xMm: number; yMm: number }>;
export type WarrantyFontSizes = Record<string, number>;
export const twipsPerMm = 1440 / 25.4;
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
  { id: 1107, label: "售后说明", box: [1282,250,8465,1640], origin:2254 + WARRANTY_AFTERSALES_SHIFT_MM * twipsPerMm, fontPt:10.5, multiline:true, notes:true },
];
const backgroundBlocks: [number, string, [number, number, number, number]][] = [
  [2001,"店名标签",[73,32,149,46]],[2002,"地址标签",[73,49,167,64]],
  [2003,"电话标签",[73,67,148,82]],[2004,"销售编号标签",[73,84,170,99]],
  [2005,"品牌标志与标语",[326,20,466,101]],[2006,"质保单标题",[532,49,727,79]],
  [2007,"底图单号图文",[532,18,729,45]],[2008,"日期标签",[536,84,598,101]],
  [2009,"付款方式标签",[72,297,172,328]],[2010,"检测结果标签",[366,297,462,328]],
  [2011,"合计标签",[559,297,633,328]],[2012,"章印检查说明",[73,330,207,349]],
  [2013,"货品检查说明",[229,330,363,349]],[2014,"内容解释说明",[392,330,531,349]],
  [2015,"经手人标签",[72,353,158,373]],[2016,"顾客签名标签",[366,353,516,374]],
  [2017,"顾客联图文",[660,345,722,374]],
];
for (const [id,label,background] of backgroundBlocks) {
  const [left,top,right,bottom] = background;
  WARRANTY_LAYOUT.push({ id, label, background, origin: 0, box: [left / 794 * 210 * twipsPerMm,top / 1123 * 297 * twipsPerMm,right / 794 * 210 * twipsPerMm,bottom / 1123 * 297 * twipsPerMm] });
}
export const WARRANTY_LAYOUT_IDS = WARRANTY_LAYOUT.map(block => String(block.id));
export const WARRANTY_FONT_IDS = WARRANTY_LAYOUT.filter(block => !block.background).map(block => String(block.id));
export function normalizeWarrantyFontSizes(value?: unknown): WarrantyFontSizes {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length > WARRANTY_FONT_IDS.length) throw new Error("质保单字号设置格式无效");
  const known = new Set(WARRANTY_FONT_IDS), result: WarrantyFontSizes = {};
  for (const [key,size] of Object.entries(value)) {
    if (!known.has(key)) throw new Error("底图图文或未知区块不能设置文字字号");
    if (typeof size !== "number" || !Number.isFinite(size) || size < 5 || size > 36 || !Number.isInteger(size * 2)) throw new Error("字号须为5至36磅，支持每次0.5磅");
    result[key] = size;
  }
  return result;
}
export function effectiveWarrantyFontSize(size: number, scale: number): number {
  return Math.round(size * scale * 2) / 2;
}
export function normalizeWarrantyLayoutOffsets(value?: unknown): WarrantyLayoutOffsets {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length > 100) throw new Error("质保单布局格式无效");
  const known = new Set(WARRANTY_LAYOUT_IDS), result: WarrantyLayoutOffsets = {};
  for (const [key,position] of Object.entries(value)) {
    if (!known.has(key) || !position || typeof position !== "object" || Array.isArray(position)) throw new Error("质保单布局包含未知字段");
    const fields = position as Record<string,unknown>;
    if (Object.keys(fields).some(field => !["xMm","yMm"].includes(field)) || ![fields.xMm,fields.yMm].every(number => typeof number === "number" && Number.isFinite(number) && Math.abs(number) <= 500)) throw new Error("质保单布局位置超出支持范围");
    result[key] = { xMm: fields.xMm as number, yMm: fields.yMm as number };
  }
  return result;
}

export function warrantyTextValue(template: TemplateText, data: WarrantyData) {
  if (template.notes) return `售后：加微信${data.afterSalesWechat}发送货品编码可终身补工费以旧换新。\n本店产品为贵重物品，售前已确认非七天无理由产品，\n售出概不退换，请仔细检查清楚。`;
  return template.fixed ?? `${template.prefix || ""}${template.field ? data[template.field] : ""}`;
}


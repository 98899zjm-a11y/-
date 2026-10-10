import type { QuotePaper } from "@/components/quote-card";
import { money } from "@/components/quote-card";

const ink = "#27231f", muted = "#746b60", line = "#e3ded5", accent = "#7a2939";
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => { const img = new Image(); img.crossOrigin = "anonymous"; img.onload = () => resolve(img); img.onerror = () => reject(new Error("款式图片加载失败，请重新上传或选择图片")); img.src = src; });
}
export async function createQuoteImage(paper: QuotePaper): Promise<string> {
  await document.fonts.ready;
  const image = await loadImage(paper.image);
  const canvas = document.createElement("canvas"); canvas.width = 1080; canvas.height = 1920;
  const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("此浏览器无法生成报价图片");
  ctx.scale(3, 3); ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, 360, 640);
  const text = (value: string, x: number, y: number, size = 11, color = ink, align: CanvasTextAlign = "left", serif = false) => { ctx.fillStyle = color; ctx.font = `${size}px ${serif ? "Georgia, SimSun" : "'Microsoft YaHei', Arial"}`; ctx.textAlign = align; ctx.fillText(value, x, y); };
  const rule = (y: number, color = line) => { ctx.fillStyle = color; ctx.fillRect(20, y, 320, .6); };
  const wrapped = (value: string, width: number, maxLines: number, size: number) => { ctx.font = `${size}px 'Microsoft YaHei', Arial`; const result: string[] = []; let current = ""; for (const char of value) { if (ctx.measureText(current + char).width > width && current) { result.push(current); current = char; } else current += char; } if (current) result.push(current); if (result.length > maxLines) { result.length = maxLines; result[maxLines - 1] = result[maxLines - 1].slice(0, -1) + "…"; } return result; };
  const wordmark = paper.brand.english || "XIN JIN YUAN";
  text(wordmark, 180, 37, Math.min(23, 316 / Math.max(1, wordmark.length * .68)), ink, "center", true);
  text(paper.brand.name || "鑫金源", 180, 57, 11, ink, "center", true); rule(69);
  text(`客户：${paper.customerName}`, 20, 88, 11, muted); text(paper.date, 340, 88, 11, muted, "right");
  ctx.save(); ctx.beginPath(); ctx.rect(20, 105, 94, 94); ctx.clip();
  const scale = Math.max(94 / image.naturalWidth, 94 / image.naturalHeight), w = image.naturalWidth * scale, h = image.naturalHeight * scale;
  ctx.drawImage(image, 20 + (94 - w) * .34, 105 + (94 - h) * .65, w, h); ctx.restore();
  text(paper.typeLabel, 127, 120, 10, accent);
  const title = wrapped(paper.title, 208, 2, 17); title.forEach((value, i) => text(value, 127, 146 + i * 22, 17, ink, "left", true));
  wrapped(paper.specs.replace(/\n/g, " · "), 208, 2, 11).forEach((value, i) => text(value, 127, 171 + (title.length - 1) * 20 + i * 15, 11, muted));
  rule(214); const col = 320 / paper.parameters.length;
  paper.parameters.forEach((item, i) => { text(item.label, 20 + i * col, 234, 10, muted); text(item.value, 20 + i * col, 251, item.value.length > 15 ? 10 : 11); }); rule(266);
  text(paper.continuation ? "补充说明" : "费用明细", 20, 290, 13, ink, "left", true);
  const available = 212, height = Math.min(42, available / Math.max(paper.lines.length, 1));
  paper.lines.forEach((item, i) => { const y = 316 + i * height; if (item.divider) rule(y - 14); const labelLines = wrapped(item.label, 169, 2, 11); labelLines.forEach((value, index) => text(value, 20, y + index * 14, 11, muted)); text(item.value, 340, y, item.value.length > 23 ? 9 : 11, ink, "right"); if (item.basis) text(item.basis, 20, y + labelLines.length * 14 + 2, 9, muted); });
  paper.continuation?.forEach((value, index) => text(value, 20, 315 + index * 16, 11, muted));
  rule(540, accent); text(paper.totalLabel, 20, 568, 11, muted); const total = money(paper.total); text(`${total} 元`, 340, 577, total.length > 12 ? 20 : 26, ink, "right");
  wrapped(paper.note, 320, 2, 10).forEach((value, i) => text(value, 20, 598 + i * 13, 10, muted));
  text(paper.number, 20, 626, 10, muted); text(paper.pages > 1 ? `${paper.page} / ${paper.pages}` : paper.brand.contact || "专属报价", 340, 626, 10, muted, "right");
  return canvas.toDataURL("image/png");
}
export async function createQuoteImages(papers: QuotePaper[]): Promise<string[]> {
  if (papers.length > 30) throw new Error("报价内容超过30页，请减少项目或精简备注后生成图片");
  const images: string[] = []; for (const paper of papers) images.push(await createQuoteImage(paper)); return images;
}
export function downloadQuoteImage(src: string, filename: string) { const link = document.createElement("a"); link.href = src; link.download = filename; link.click(); }

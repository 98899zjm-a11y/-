import type { QuotePaper } from "@/components/quote-card";
import { money, quotePaperLayout, quoteExportLayout, quotePaperForFormat, localizeQuotePaper, quoteLabels, type QuoteLanguage, type QuoteImageFormat } from "@/components/quote-card";

const ink = "#27231f", muted = "#746b60", line = "#e3ded5", accent = "#7a2939";
export const quoteStationery = { src: "/quote-stationery-v2.png", whiteOverlay: .32 } as const;
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => { const img = new Image(); img.crossOrigin = "anonymous"; img.onload = () => resolve(img); img.onerror = () => reject(new Error("报价图片或收款二维码加载失败，请重新选择图片")); img.src = src; });
}
function a4PhysicalMetadata(source: string): string {
  const raw = atob(source.split(",")[1] || ""), bytes = Uint8Array.from(raw, char => char.charCodeAt(0));
  if (bytes.length < 33 || bytes[0] !== 137 || bytes[1] !== 80) return source;
  const physical = new Uint8Array(21), view = new DataView(physical.buffer); view.setUint32(0, 9);
  physical.set([112, 72, 89, 115], 4); view.setUint32(8, 5333); view.setUint32(12, 5333); physical[16] = 1;
  let crc = 0xffffffff; for (const value of physical.subarray(4, 17)) { crc ^= value; for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ crc >>> 1 : crc >>> 1; } view.setUint32(17, (crc ^ 0xffffffff) >>> 0);
  const chunks: Uint8Array[] = [bytes.subarray(0, 8)]; let offset = 8;
  while (offset + 12 <= bytes.length) { const length = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0), end = offset + length + 12; if (end > bytes.length) return source; const kind = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)); if (kind !== "pHYs") chunks.push(bytes.subarray(offset, end)); if (kind === "IHDR") chunks.push(physical); offset = end; }
  const result = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0)); let at = 0; for (const chunk of chunks) { result.set(chunk, at); at += chunk.length; }
  let encoded = ""; for (let index = 0; index < result.length; index += 8192) encoded += String.fromCharCode(...result.subarray(index, index + 8192));
  return "data:image/png;base64," + btoa(encoded);
}
export async function createQuoteImage(original: QuotePaper, format: QuoteImageFormat = { mode: "phone" }, language: QuoteLanguage = "zh-CN"): Promise<string> {
  const size = quoteExportLayout(format), paper = quotePaperForFormat(localizeQuotePaper(original, language), format), labels = quoteLabels(language);
  await document.fonts.ready;
  const stationery = size.whiteBackground ? null : await loadImage(quoteStationery.src).catch(() => { throw new Error("报价纸纹加载失败，请重新打开程序后再生成，图片尚未生成或保存"); });
  const image = await loadImage(paper.image);
  const paymentImages = await Promise.all((paper.payments || []).map(method => method.image ? loadImage(method.image) : Promise.resolve(null)));
  const productImages = await Promise.all((paper.products || []).map(product => loadImage(product.image)));
  const canvas = document.createElement("canvas"); canvas.width = size.width; canvas.height = size.height;
  const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("此浏览器无法生成报价图片");
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, size.width, size.height);
  if (size.x || size.y) ctx.translate(size.x, size.y);
  ctx.scale(size.scale, size.scale);
  if (stationery) { ctx.drawImage(stationery, 0, 0, 360, 640); ctx.fillStyle = `rgba(255,255,255,${quoteStationery.whiteOverlay})`; ctx.fillRect(0, 0, 360, 640); }
  const text = (value: string, x: number, y: number, size = 11, color = ink, align: CanvasTextAlign = "left", serif = false) => { ctx.fillStyle = color; ctx.font = `${size}px ${serif ? "Georgia, SimSun" : "'Microsoft YaHei', Arial"}`; ctx.textAlign = align; ctx.fillText(value, x, y); };
  const rule = (y: number, color = line) => { ctx.fillStyle = color; ctx.fillRect(20, y, 320, .6); };
  const wrapped = (value: string, width: number, size: number) => { ctx.font = `${size}px 'Microsoft YaHei', Arial`; const result: string[] = []; let current = ""; for (const char of value) { if (char === "\n") { result.push(current); current = ""; } else if (ctx.measureText(current + char).width > width && current) { result.push(current); current = char; } else current += char; } if (current) result.push(current); return result; };
  const coverImage = (source: HTMLImageElement, x: number, y: number, size: number) => { ctx.save(); ctx.beginPath(); ctx.rect(x, y, size, size); ctx.clip(); const scale = Math.max(size / source.naturalWidth, size / source.naturalHeight), w = source.naturalWidth * scale, h = source.naturalHeight * scale; ctx.drawImage(source, x + (size - w) * .34, y + (size - h) * .65, w, h); ctx.restore(); };
  const wordmark = paper.brand.english || "XIN JIN YUAN";
  text(wordmark, 180, 37, Math.min(23, 316 / Math.max(1, wordmark.length * .68)), ink, "center", true);
  text(paper.brand.name || "鑫金源", 180, 57, 11, ink, "center", true); rule(69);
  text(`${labels.customer}：${paper.customerName}`, 20, 88, 11, muted); text(paper.date, 340, 88, 11, muted, "right");
  const layout = quotePaperLayout(paper);
  if (layout.attached) {
    if (paper.products?.length) paper.products.forEach((product,index)=>{
      const y=layout.productTop+index*(layout.productHeight+layout.productGap);
      coverImage(productImages[index],20,y,44);
      wrapped(product.title,258,12).forEach((value,i)=>text(value,74,y+13+i*15,12,ink,"left",true));
      wrapped(product.specs,258,8.5).forEach((value,i)=>text(value,74,y+31+i*11,8.5,muted));
      const parameterWidth=320/Math.max(1,product.parameters.length);
      product.parameters.forEach((parameter,i)=>text(`${parameter.label}：${parameter.value}`,20+i*parameterWidth,y+55,8,muted));
      product.lines.forEach((item,i)=>{const x=20+(i%2)*164,baseline=y+73+Math.floor(i/2)*16;text(item.label,x,baseline,9,muted);text(item.value,x+156,baseline,9,ink,"right");});
      rule(y+92);text(product.totalLabel,20,y+106,10,muted);text(`${money(product.total)} ${labels.currency}`,340,y+106,10,ink,"right");
    });
    else {
      coverImage(image,20,105,52);
      const titleLines=wrapped(paper.title,258,12);titleLines.forEach((value,i)=>text(value,82,118+i*15,12,ink,"left",true));
      wrapped(paper.specs,258,9).forEach((value,i)=>text(value,82,134+(titleLines.length-1)*15+i*11,9,muted));
      const col=320/Math.max(1,paper.parameters.length);
      paper.parameters.forEach((parameter,i)=>{text(parameter.label,20+i*col,179,8,muted);text(parameter.value,20+i*col,192,9);});
    }
    paper.lines.forEach((item,i)=>{const y=layout.linePositions[i]+10;if(item.divider)rule(y-14);text(item.label,20,y,10,muted);text(item.value,340,y,10,ink,"right");if(item.detail)text(item.detail,20,y+11,8,muted);});
    text(labels.payment,20,layout.paymentTop+11,11,ink,"left",true);
    paper.payments?.forEach((method,index)=>{
      const column=index%layout.columns,row=Math.floor(index/layout.columns),x=20+column*(layout.paymentWidth+8),y=layout.paymentGridTop+row*(layout.cardHeight+8);
      text(method.name,x,y+10,paper.payments!.length>2?8.5:10,ink,"left",true);
      method.detailLines.forEach((value,i)=>text(value,x,y+23+i*10,8,muted));
      const source=paymentImages[index];
      if(source){const scale=Math.min(layout.qrSize/source.naturalWidth,layout.qrSize/source.naturalHeight),width=source.naturalWidth*scale,height=source.naturalHeight*scale;ctx.save();ctx.fillStyle="#fff";ctx.fillRect(x+(layout.paymentWidth-layout.qrSize)/2,y+34,layout.qrSize,layout.qrSize);ctx.imageSmoothingEnabled=false;ctx.drawImage(source,x+(layout.paymentWidth-width)/2,y+34+(layout.qrSize-height)/2,width,height);ctx.restore();}
    });
  } else if (paper.products) {
    paper.products.forEach((product, index) => {
      const y = 105 + index * 195;
      coverImage(productImages[index], 20, y, 64);
      wrapped(product.title, 243, 13).forEach((value, i) => text(value, 97, y + 15 + i * 17, 13, ink, "left", true));
      wrapped(product.specs, 243, 10).forEach((value, i) => text(value, 97, y + 37 + i * 14, 10, muted));
      product.parameters.forEach((parameter, i) => text(`${parameter.label}：${parameter.value}`, i === 0 ? 20 : 340, y + 73, 10, muted, i === 0 ? "left" : "right"));
      product.lines.forEach((item, i) => { text(item.label, 20, y + 94 + i * 17, 10, muted); text(item.value, 340, y + 94 + i * 17, 10, ink, "right"); });
      rule(y + 155); text(product.totalLabel, 20, y + 170, 11, muted); text(`${money(product.total)} ${labels.currency}`, 340, y + 170, 11, ink, "right");
    });
    paper.lines.forEach((item, index) => { const y=layout.linePositions[index]+10;text(item.label,20,y,10,muted);text(item.value,340,y,10,ink,"right");if(item.detail)text(item.detail,20,y+11,8,muted); });
  } else {
    coverImage(image, 20, 105, 94);
    text(paper.typeLabel, 127, 120, 10, accent);
    const title = wrapped(paper.title, 208, 16); title.forEach((value, i) => text(value, 127, 146 + i * 21, 16, ink, "left", true));
    wrapped(paper.specs.replace(/\n/g, " · "), 208, 11).forEach((value, i) => text(value, 127, 171 + (title.length - 1) * 20 + i * 15, 11, muted));
    rule(214); const col = 320 / Math.max(1, paper.parameters.length);
    paper.parameters.forEach((item, i) => { text(item.label, 20 + i * col, 234, 10, muted); text(item.value, 20 + i * col, 251, item.value.length > 15 ? 10 : 11); }); rule(266);
    if (paper.paymentPlacement !== "page") {
      text(paper.continuation ? paper.continuationTitle || labels.additional : labels.details, 20, 290, 13, ink, "left", true);
      const height = paper.paymentPlacement === "inline" ? 28 : Math.min(42, 212 / Math.max(paper.lines.length, 1));
      paper.lines.forEach((item, i) => { const y = 316 + i * height; if (item.divider) rule(y - 14); const labelLines = wrapped(item.label, 169, 11); labelLines.forEach((value, index) => text(value, 20, y + index * 14, 11, muted)); text(item.value, 340, y, item.value.length > 23 ? 9 : 11, ink, "right"); if (item.detail) text(item.detail, 20, y + labelLines.length * 14 + 2, 9, muted); });
      paper.continuation?.forEach((value, index) => text(value, 20, 315 + index * 16, 11, muted));
    }
  }
  if (paper.payments?.length && !layout.attached) {
    const inline = paper.paymentPlacement === "inline";
    text(labels.payment, 20, inline ? 370 : 290, 13, ink, "left", true);
    paper.payments.forEach((method, index) => {
      const x = 20 + index * 168, nameY = inline ? 384 : 314;
      wrapped(method.name, 152, 11).forEach((value, i) => text(value, x, nameY + i * 12, 11, ink, "left", true));
      method.detailLines.forEach((value, i) => text(value, x, nameY + 27 + i * 12, 9, muted));
      const paymentImage = paymentImages[index];
      if (paymentImage) {
        const size = inline ? 100 : 120, qrY = inline ? 433 : 370;
        const contain = Math.min(size / paymentImage.naturalWidth, size / paymentImage.naturalHeight), qrWidth = paymentImage.naturalWidth * contain, qrHeight = paymentImage.naturalHeight * contain;
        ctx.save(); ctx.fillStyle = "#fff"; ctx.fillRect(x + (152 - size) / 2, qrY, size, size); ctx.imageSmoothingEnabled = false; ctx.drawImage(paymentImage, x + (152 - qrWidth) / 2, qrY + (size - qrHeight) / 2, qrWidth, qrHeight); ctx.restore();
      }
    });
  }
  rule(540, accent); text(paper.totalLabel, 20, 568, 11, muted); const total = money(paper.total); text(`${total} ${labels.currency}`, 340, 577, total.length > 12 ? 20 : 26, ink, "right");
  wrapped(paper.note, 320, 10).forEach((value, i) => text(value, 20, 598 + i * 13, 10, muted));
  text(paper.number, 20, 626, 10, muted); text(paper.pages > 1 ? `${paper.page} / ${paper.pages}` : paper.brand.contact || labels.privateQuote, 340, 626, 10, muted, "right");
  const nativePng = canvas.toDataURL("image/png"), result = format.mode === "a4" ? a4PhysicalMetadata(nativePng) : nativePng, encoded = result.split(",")[1] || "";
  const bytes = Math.floor(encoded.length * 3 / 4) - (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0);
  if (bytes > 8 * 1024 * 1024) throw new Error("此尺寸生成的图片超过8MiB，请减小自定义宽高后重新生成。");
  return result;
}
export async function createQuoteImages(papers: QuotePaper[], format: QuoteImageFormat = { mode: "phone" }, language: QuoteLanguage = "zh-CN"): Promise<string[]> {
  if (papers.length > 30) throw new Error("报价内容超过30页，请减少项目或精简备注后生成图片");
  const images: string[] = []; for (const paper of papers) images.push(await createQuoteImage(paper, format, language)); return images;
}
export function downloadQuoteImage(src: string, filename: string) { const link = document.createElement("a"); link.href = src; link.download = filename; link.click(); }

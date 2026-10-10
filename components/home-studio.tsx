"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowUpRight, Check, ImagePlus, Images, Pencil, Upload, X } from "lucide-react";
import type { MediaAsset, Settings } from "@/lib/domain";

type Props = {
  brand: Settings["brand"]; content: Settings["home"]; admin: boolean;
  assets?: MediaAsset[]; onUploadImage?: (file: File) => Promise<string>;
  onSave: (content: Partial<Settings["home"]>) => Promise<void>; onNavigate: (page: string) => void;
};
const defaultHomeImage = "/home-necklace.png";
async function compressHomeImage(file: File): Promise<string> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("请选择PNG、JPEG或WebP图片");
  if (file.size > 20_000_000) throw new Error("原图超过20MB，请压缩后上传");
  const source = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => { const picture = new Image(); picture.onload = () => resolve(picture); picture.onerror = () => reject(new Error("图片读取失败，请选择其他图片")); picture.src = source; });
    const scale = Math.min(1, 1000 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d"); if (!context) throw new Error("当前设备无法处理图片，请使用素材图库");
    context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [.84, .72, .6, .48]) { const encoded = canvas.toDataURL("image/jpeg", quality); if (encoded.length <= 1_500_000) return encoded; }
    throw new Error("图片仍然过大，请先压缩后再上传");
  } finally { URL.revokeObjectURL(source); }
}
const services = [
  { page: "sales", name: "珠宝销售", english: "JEWELRY", description: "从心仪款式，开始一份专属报价。" },
  { page: "tradein", name: "以旧换新", english: "EXCHANGE", description: "旧金焕新，细致核对每一项费用。" },
  { page: "recycling", name: "贵金属回收", english: "RECYCLE", description: "确认材质与重量，清晰呈现回收价格。" },
  { page: "repairs", name: "珠宝维修", english: "CARE", description: "为珍爱的珠宝，选择合适的修护。" },
  { page: "custom", name: "专属定制", english: "BESPOKE", description: "记录灵感与细节，让想法成为珠宝。" },
];
const paragraphs = (value: string) => (value || "").split(/\n+/).map(line => line.trim()).filter(Boolean);

export default function HomeStudio({ brand, content, admin, assets = [], onUploadImage, onSave, onNavigate }: Props) {
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState(content);
  const [saving, setSaving] = useState(false), [error, setError] = useState("");
  const [imageEditing, setImageEditing] = useState(false), [imageDraft, setImageDraft] = useState(content.image || defaultHomeImage);
  const [imageSaving, setImageSaving] = useState(false), [imageProcessing, setImageProcessing] = useState(false), [imageReady, setImageReady] = useState(false), [imageError, setImageError] = useState("");
  const [imageSearch, setImageSearch] = useState("");
  const [heroContain, setHeroContain] = useState(false);
  const imageDialog = useRef<HTMLDivElement>(null), imageInput = useRef<HTMLInputElement>(null), imageHeading = useId();
  useEffect(() => { if (!editing) setDraft(content); }, [content, editing]);
  useEffect(() => {
    if (!imageEditing) return;
    const previous = document.activeElement as HTMLElement | null;
    imageDialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !imageSaving) { event.preventDefault(); setImageEditing(false); }
      if (event.key !== "Tab") return;
      const controls = [...(imageDialog.current?.querySelectorAll<HTMLElement>("button,input,select,textarea,a[href]") || [])].filter(element => !element.matches(":disabled") && !element.hasAttribute("hidden"));
      const first = controls[0], last = controls[controls.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keyboard);
    return () => { document.removeEventListener("keydown", keyboard); if (previous && document.contains(previous)) previous.focus(); };
  }, [imageEditing, imageSaving]);
  const save = async () => { setSaving(true); setError(""); try { const { image: _image, ...textContent } = draft; await onSave(textContent); setEditing(false); } catch (err) { setError(err instanceof Error ? err.message : "保存失败，请重试"); } finally { setSaving(false); } };
  const openImageEditor = () => { setImageDraft(content.image || defaultHomeImage); setImageError(""); setImageReady(false); setImageSearch(""); setImageEditing(true); };
  const chooseImage = (image: string) => { if (image !== imageDraft) setImageReady(false); setImageDraft(image); setImageError(""); };
  const selectFile = async (file: File) => {
    setImageProcessing(true); setImageError("");
    try {
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("请选择PNG、JPEG或WebP图片");
      let image = onUploadImage ? await onUploadImage(file) : await compressHomeImage(file);
      if (!/^data:image\/(?:jpeg|png|webp);base64,/.test(image) || image.length > 1_500_000) image = await compressHomeImage(file);
      chooseImage(image);
    } catch (err) { setImageError(err instanceof Error ? err.message : "图片读取失败"); }
    finally { setImageProcessing(false); }
  };
  const saveImage = async () => { setImageSaving(true); setImageError(""); try { await onSave({ image: imageDraft }); setImageEditing(false); } catch (err) { setImageError(err instanceof Error ? err.message : "保存失败，请重试"); } finally { setImageSaving(false); } };
  const selectableAssets = assets.filter(asset => asset.active && (!imageSearch.trim() || `${asset.name} ${asset.category}`.toLowerCase().includes(imageSearch.trim().toLowerCase())));
  return <div className="studio-home">
    <section className="studio-hero">
      <div className="studio-hero-copy">
        <span className="studio-eyebrow">THE JEWELRY ATELIER</span>
        <h2>{(content.headline || "让每一份珍爱，清晰呈现。").split("，").map((part, index, parts) => <span key={index} style={{ display: "block" }}>{part}{index < parts.length - 1 ? "，" : ""}</span>)}</h2>
        <p>{content.introduction || "从珠宝选购到专属定制，以细致服务回应每一份信任。"}</p>
        <button className="studio-text-link" onClick={() => onNavigate("sales")}>开始专属报价 <ArrowUpRight size={17} /></button>
        <div className="studio-hero-signature"><span>{brand.english || "XIN JIN YUAN"}</span><small>{brand.name} · 珠宝工作室</small></div>
      </div>
      <div className="studio-hero-photo"><img src={content.image || defaultHomeImage} alt="珠宝工作室精选首饰" style={{ objectFit: heroContain ? "contain" : "cover" }} onLoad={event => setHeroContain(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight >= .95)} />{admin && <button type="button" className="studio-home-image-change" onClick={openImageEditor}><ImagePlus size={15} />更换首页图片</button>}<div className="studio-photo-caption"><span>THE ART OF JEWELRY</span><small>细节，值得被珍视。</small></div></div>
    </section>
    <div className="studio-section-label"><span>01 / OUR SERVICES</span><h3>从这里开始</h3></div>
    <section className="studio-service-list" aria-label="业务快捷入口">{services.map((service, index) => <button key={service.page} onClick={() => onNavigate(service.page)}><span className="studio-service-index">0{index + 1}</span><span className="studio-service-name"><strong>{service.name}</strong><small>{service.english}</small></span><span className="studio-service-description">{service.description}</span><ArrowUpRight size={21} strokeWidth={1.2} /></button>)}</section>
    <div className="studio-section-label studio-information-heading"><span>02 / STUDIO JOURNAL</span><h3>工作室讯息</h3>{admin && <button className="studio-text-link" onClick={() => setEditing(!editing)}>{editing ? <X size={15} /> : <Pencil size={15} />}{editing ? "取消编辑" : "编辑首页"}</button>}</div>
    {editing ? <section className="studio-home-editor" aria-label="首页内容编辑">
      <div className="studio-editor-grid">
        <label><span>首页标题</span><input value={draft.headline} maxLength={100} onChange={event => setDraft({ ...draft, headline: event.target.value })} /></label>
        <label><span>首页介绍</span><textarea value={draft.introduction} rows={2} maxLength={500} onChange={event => setDraft({ ...draft, introduction: event.target.value })} /></label>
        <label><span>公告</span><textarea value={draft.announcements} rows={5} maxLength={4000} onChange={event => setDraft({ ...draft, announcements: event.target.value })} /><small>每段单独一行，可填写店内通知或服务安排。</small></label>
        <label><span>注意事项</span><textarea value={draft.notices} rows={5} maxLength={4000} onChange={event => setDraft({ ...draft, notices: event.target.value })} /></label>
        <label className="studio-editor-wide"><span>操作流程</span><textarea value={draft.workflow} rows={5} maxLength={4000} onChange={event => setDraft({ ...draft, workflow: event.target.value })} /><small>每个步骤一行，首页自动编号。</small></label>
      </div>{error && <p className="studio-inline-error" role="alert">{error}</p>}<div className="studio-editor-actions"><button className="button" onClick={() => setEditing(false)} disabled={saving}>取消</button><button className="button primary" onClick={save} disabled={saving}><Check size={16} />{saving ? "正在保存" : "保存首页"}</button></div>
    </section> : <div className="studio-journal-grid">
      <section className="studio-announcements"><span className="studio-eyebrow">ANNOUNCEMENTS</span><h3>公告</h3>{paragraphs(content.announcements).length ? paragraphs(content.announcements).map((line, index) => <p key={index}>{line}</p>) : <p className="studio-empty-copy">暂无新公告。</p>}</section>
      <section className="studio-notices"><span className="studio-eyebrow">PLEASE NOTE</span><h3>注意事项</h3>{paragraphs(content.notices).length ? paragraphs(content.notices).map((line, index) => <p key={index}>{line}</p>) : <p className="studio-empty-copy">请在报价前确认客户需求、材质与重量。</p>}</section>
      <section className="studio-workflow"><span className="studio-eyebrow">A THOUGHTFUL SERVICE</span><h3>操作流程</h3><ol>{paragraphs(content.workflow).map((line, index) => <li key={index}><span>{String(index + 1).padStart(2, "0")}</span><p>{line}</p></li>)}</ol></section>
    </div>}
    <footer className="studio-home-footer"><span>{brand.english || "XIN JIN YUAN"}</span><button className="studio-text-link" onClick={() => onNavigate("gallery")}>探索素材图库 <ArrowUpRight size={15} /></button></footer>
    {imageEditing && admin && <div className="studio-media-overlay studio-home-image-overlay" onMouseDown={event => { if (event.target === event.currentTarget && !imageSaving) setImageEditing(false); }}><div ref={imageDialog} className="studio-home-image-dialog" role="dialog" aria-modal="true" aria-labelledby={imageHeading}>
      <header><div><span className="studio-eyebrow">HOMEPAGE IMAGE</span><h3 id={imageHeading}>更换首页图片</h3></div><button type="button" className="icon-button" aria-label="关闭图片窗口" disabled={imageSaving} onClick={() => setImageEditing(false)}><X size={18} /></button></header>
      <div className="studio-home-image-layout"><section className="studio-home-image-preview" aria-label="首页图片预览"><img src={imageDraft} alt="待确认的首页图片" onLoad={() => setImageReady(true)} onError={() => { setImageReady(false); setImageError("图片无法显示，请重新选择图片"); }} /></section><section className="studio-home-image-picker"><div className="studio-home-image-actions"><button type="button" className="button" disabled={imageProcessing || imageSaving} onClick={() => imageInput.current?.click()}><Upload size={15} />{imageProcessing ? "处理图片中" : "上传图片"}</button><button type="button" className="studio-text-link" disabled={imageProcessing || imageSaving} onClick={() => chooseImage(defaultHomeImage)}>使用原首页图片</button><input ref={imageInput} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void selectFile(file); }} /></div><div className="studio-home-image-library"><h4><Images size={15} />从素材图库选择</h4><input aria-label="搜索首页图片素材" placeholder="搜索名称或分类" value={imageSearch} onChange={event => setImageSearch(event.target.value)} disabled={imageSaving} /><div className="studio-home-image-grid">{selectableAssets.map(asset => <button type="button" key={asset.id} aria-pressed={imageDraft === asset.url} disabled={imageProcessing || imageSaving} onClick={() => chooseImage(asset.url)}><img src={asset.url} alt={asset.name} loading="lazy" /><span>{asset.name}</span></button>)}</div>{!selectableAssets.length && <p className="studio-home-image-empty">{imageSearch ? "未找到对应素材。" : "暂无可选素材，可以先上传图片。"}</p>}</div></section></div>
      {imageError && <p className="studio-inline-error" role="alert">{imageError}</p>}<footer><p>选择图片仅预览，点击保存后更新首页。</p><div><button type="button" className="button" disabled={imageSaving} onClick={() => setImageEditing(false)}>取消</button><button type="button" className="button primary" disabled={imageSaving || imageProcessing || !imageReady} onClick={() => void saveImage()}><Check size={15} />{imageSaving ? "正在保存" : "保存首页图片"}</button></div></footer>
    </div></div>}
  </div>;
}

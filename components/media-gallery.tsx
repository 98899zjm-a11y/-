"use client";

import { useMemo, useRef, useState } from "react";
import { ArrowUpRight, Check, ImagePlus, Loader2, Pencil, Search, Upload, X } from "lucide-react";
import type { MediaAsset } from "@/lib/domain";

type Props = {
  assets: MediaAsset[]; userId: string; admin: boolean;
  onUpload: (files: File[], category: string) => Promise<void>;
  onPatch: (asset: MediaAsset, patch: { name?: string; category?: string; active?: boolean }) => Promise<void>;
  onSelect?: (asset: MediaAsset) => void; compact?: boolean;
};
export default function MediaGallery({ assets, userId, admin, onUpload, onPatch, onSelect, compact = false }: Props) {
  const [search, setSearch] = useState(""), [category, setCategory] = useState("全部");
  const [uploading, setUploading] = useState(false), [uploadOpen, setUploadOpen] = useState(false);
  const [uploadCategory, setUploadCategory] = useState("珠宝素材"), [error, setError] = useState("");
  const [preview, setPreview] = useState<MediaAsset | null>(null), [editing, setEditing] = useState<MediaAsset | null>(null);
  const [name, setName] = useState(""), [editCategory, setEditCategory] = useState(""), [saving, setSaving] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const categories = useMemo(() => ["全部", ...new Set(assets.filter(asset => asset.active).map(asset => asset.category || "未分类"))], [assets]);
  const visible = useMemo(() => assets.filter(asset => (asset.active || (showInactive && (admin || asset.ownerId === userId))) && (category === "全部" || asset.category === category) && (!search || (asset.name + " " + asset.category).toLowerCase().includes(search.toLowerCase()))), [assets, category, search, showInactive, admin, userId]);
  const upload = async (files: File[]) => {
    if (!files.length || uploading) return;
    setError("");
    if (files.length > 20) { setError("每次最多上传20张图片，请分批上传。"); return; }
    if (files.some(file => !["image/jpeg", "image/png", "image/webp"].includes(file.type))) { setError("请上传PNG、JPEG或WebP图片。"); return; }
    if (files.some(file => file.size > 20 * 1024 * 1024)) { setError("单张原始图片不能超过20MB。"); return; }
    setUploading(true);
    try { await onUpload(files, uploadCategory.trim() || "未分类"); setUploadOpen(false); setCategory("全部"); } catch (err) { setError(err instanceof Error ? err.message : "上传失败，请重试"); } finally { setUploading(false); if (input.current) input.current.value = ""; }
  };
  const edit = (asset: MediaAsset) => { setEditing(asset); setName(asset.name); setEditCategory(asset.category); setError(""); };
  const save = async () => {
    if (!editing || !name.trim()) { setError("请填写素材名称。"); return; }
    setSaving(true);
    try { await onPatch(editing, { name: name.trim(), category: editCategory.trim() || "未分类" }); setEditing(null); } catch (err) { setError(err instanceof Error ? err.message : "保存失败"); } finally { setSaving(false); }
  };
  const toggle = async (asset: MediaAsset) => {
    setSaving(true); setError("");
    try { await onPatch(asset, { active: !asset.active }); setEditing(null); setPreview(null); } catch (err) { setError(err instanceof Error ? err.message : "操作失败"); } finally { setSaving(false); }
  };
  return <div className={"studio-gallery" + (compact ? " compact" : "")}>
    <div className="studio-gallery-toolbar"><label className="studio-gallery-search"><Search size={17} strokeWidth={1.3} /><input aria-label="搜索素材" placeholder="搜索素材名称或分类" value={search} onChange={event => setSearch(event.target.value)} /></label><button className="button primary" onClick={() => setUploadOpen(!uploadOpen)} disabled={uploading}><ImagePlus size={16} />上传图片</button></div>
    <div className="studio-gallery-categories">{categories.map(item => <button key={item} className={category === item ? "active" : ""} onClick={() => setCategory(item)}>{item}</button>)}{!compact && <label><input type="checkbox" checked={showInactive} onChange={event => setShowInactive(event.target.checked)} />显示已停用</label>}</div>
    {uploadOpen && <section className="studio-upload-panel"><label className="studio-upload-category"><span>素材分类</span><input value={uploadCategory} maxLength={80} placeholder="例如：戒指、项链、设计图、收款码" onChange={event => setUploadCategory(event.target.value)} /></label><button className="studio-dropzone" onClick={() => input.current?.click()} disabled={uploading} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void upload(Array.from(event.dataTransfer.files)); }}><Upload size={25} strokeWidth={1} /><strong>{uploading ? "正在上传图片…" : "选择图片，或拖动到这里"}</strong><small>支持多张PNG、JPEG、WebP图片，每批最多20张。</small></button><input ref={input} type="file" aria-label="上传图库图片" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={event => void upload(Array.from(event.target.files || []))} /><p>照片、设计参考和收款码都可以归入各自分类。图库素材供工作室成员选用。</p></section>}
    {error && <p className="studio-inline-error" role="alert">{error}</p>}
    <div className="studio-gallery-count"><span>{visible.length} 件素材</span>{uploading && <span><Loader2 size={14} className="spin" />正在上传</span>}</div>
    {visible.length ? <div className="studio-media-grid">{visible.map(asset => <article className={"studio-media-card" + (asset.active ? "" : " inactive")} key={asset.id}><button className="studio-media-photo" onClick={() => setPreview(asset)} aria-label={"查看素材 " + asset.name}><img loading="lazy" src={asset.url} alt={asset.name} /><span>查看图片 <ArrowUpRight size={14} /></span></button><div className="studio-media-caption"><div><small>{asset.category || "未分类"}{!asset.active && " · 已停用"}</small><h3>{asset.name}</h3></div>{(admin || asset.ownerId === userId) && <button className="icon-button" aria-label={"编辑素材 " + asset.name} onClick={() => edit(asset)}><Pencil size={15} /></button>}</div>{onSelect && asset.active && <button className="studio-media-select" onClick={() => onSelect(asset)}>选用这张图片 <ArrowUpRight size={14} /></button>}</article>)}</div> : <div className="studio-gallery-empty"><ImagePlus size={38} strokeWidth={.8} /><h3>{search || category !== "全部" ? "没有找到相符素材" : "留存每一份灵感"}</h3><p>上传珠宝照片、设计图或收款码，报价时即可选择。</p><button className="studio-text-link" onClick={() => setUploadOpen(true)}>上传第一张图片 <ArrowUpRight size={16} /></button></div>}
    {preview && <div className="studio-media-overlay" onClick={() => setPreview(null)}><section className="studio-media-preview" role="dialog" aria-modal="true" aria-label={preview.name} onClick={event => event.stopPropagation()}><header><div><small>{preview.category}</small><h3>{preview.name}</h3></div><button className="icon-button" aria-label="关闭图片预览" onClick={() => setPreview(null)}><X size={22} /></button></header><div className="studio-media-large"><img src={preview.url} alt={preview.name} /></div><footer><span>上传人：{preview.ownerName || "工作室成员"}</span>{onSelect && preview.active && <button className="button primary" onClick={() => { onSelect(preview); setPreview(null); }}>选用图片 <Check size={15} /></button>}</footer></section></div>}
    {editing && <div className="studio-media-overlay" onClick={() => !saving && setEditing(null)}><section className="studio-media-editor" role="dialog" aria-modal="true" aria-label="编辑图库素材" onClick={event => event.stopPropagation()}><header><h3>编辑素材</h3><button className="icon-button" aria-label="关闭素材编辑" onClick={() => setEditing(null)} disabled={saving}><X size={20} /></button></header><label><span>素材名称</span><input value={name} maxLength={120} onChange={event => setName(event.target.value)} /></label><label><span>分类</span><input value={editCategory} maxLength={80} onChange={event => setEditCategory(event.target.value)} /></label><p>停用后不再出现在选图列表，已保存的历史报价仍可查看原图。</p>{error && <p role="alert" className="studio-inline-error">{error}</p>}<footer><button className="studio-text-link" onClick={() => void toggle(editing)} disabled={saving}>{editing.active ? "停用素材" : "恢复素材"}</button><button className="button primary" onClick={save} disabled={saving}><Check size={15} />保存</button></footer></section></div>}
  </div>;
}

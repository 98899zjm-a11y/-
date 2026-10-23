"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Check, ImagePlus, Loader2, Pencil, Search, Upload, X } from "lucide-react";
import type { MediaAsset } from "@/lib/domain";

type Props = {
  assets: MediaAsset[]; userId: string; admin: boolean;
  onUpload: (files: File[], category: string, names?: string[]) => Promise<MediaAsset[] | void>;
  onPatch: (asset: MediaAsset, patch: { name?: string; category?: string; active?: boolean }) => Promise<void>;
  onSelect?: (asset: MediaAsset) => void; readOnly?: boolean; compact?: boolean; initialUploadOpen?: boolean;
};
function LocalPhoto({ file }: { file: File }) {
  const [src, setSrc] = useState("");
  useEffect(() => { const url = URL.createObjectURL(file); setSrc(url); return () => URL.revokeObjectURL(url); }, [file]);
  return src ? <img src={src} alt={file.name}/> : null;
}
export default function MediaGallery({ assets, userId, admin, onUpload, onPatch, onSelect, readOnly = false, compact = false, initialUploadOpen = false }: Props) {
  const [search, setSearch] = useState(""), [category, setCategory] = useState("全部");
  const [uploading, setUploading] = useState(false), [uploadOpen, setUploadOpen] = useState(initialUploadOpen);
  const [uploadCategory, setUploadCategory] = useState("自定义素材"), [error, setError] = useState("");
  const [localFiles, setLocalFiles] = useState<File[]>([]), [uploadNames, setUploadNames] = useState<string[]>([]);
  const [preview, setPreview] = useState<MediaAsset | null>(null), [editing, setEditing] = useState<MediaAsset | null>(null);
  const [name, setName] = useState(""), [editCategory, setEditCategory] = useState(""), [saving, setSaving] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (readOnly) { setUploadOpen(false); setEditing(null); } }, [readOnly]);
  const categories = useMemo(() => ["全部", ...new Set(assets.filter(asset => asset.active).map(asset => asset.category || "未分类"))], [assets]);
  const visible = useMemo(() => assets.filter(asset => (asset.active || (showInactive && (admin || asset.ownerId === userId))) && (category === "全部" || asset.category === category) && (!search || (asset.name + " " + asset.category).toLowerCase().includes(search.toLowerCase()))), [assets, category, search, showInactive, admin, userId]);
  const stageFiles = (files: File[]) => {
    if (readOnly || !files.length || uploading) return;
    setError("");
    if (localFiles.length + files.length > 20) { setError("每批最多20张图片，请移除部分图片或分批上传。"); return; }
    if (files.some(file => !["image/jpeg", "image/png", "image/webp"].includes(file.type))) { setError("请上传PNG、JPEG或WebP图片。"); return; }
    if (files.some(file => file.size > 20 * 1024 * 1024)) { setError("单张原始图片不能超过20MB。"); return; }
    setLocalFiles(current => [...current, ...files]);
    setUploadNames(current => [...current, ...files.map((file, index) => file.name.replace(/\.[^.]+$/, "") || `素材 ${localFiles.length + index + 1}`)]);
    if (input.current) input.current.value = "";
  };
  const upload = async () => {
    if (readOnly || uploading || !localFiles.length) return;
    if (uploadNames.some(value => !value.trim())) { setError("请为每张图片填写素材名称。"); return; }
    setUploading(true); setError("");
    try { await onUpload(localFiles, uploadCategory.trim() || "未分类", uploadNames.map(value => value.trim())); setLocalFiles([]); setUploadNames([]); setUploadOpen(false); setCategory("全部"); }
    catch (err) { const count = (err as { uploadedCount?: number })?.uploadedCount || 0; if (count > 0) { setLocalFiles(current => current.slice(count)); setUploadNames(current => current.slice(count)); } setError(err instanceof Error ? err.message : "上传失败，请重试"); }
    finally { setUploading(false); }
  };
  const edit = (asset: MediaAsset) => { if (readOnly) return; setEditing(asset); setName(asset.name); setEditCategory(asset.category); setError(""); };
  const save = async () => {
    if (readOnly) return;
    if (!editing || !name.trim()) { setError("请填写素材名称。"); return; }
    setSaving(true);
    try { await onPatch(editing, { name: name.trim(), category: editCategory.trim() || "未分类" }); setEditing(null); } catch (err) { setError(err instanceof Error ? err.message : "保存失败"); } finally { setSaving(false); }
  };
  const toggle = async (asset: MediaAsset) => {
    if (readOnly) return;
    setSaving(true); setError("");
    try { await onPatch(asset, { active: !asset.active }); setEditing(null); setPreview(null); } catch (err) { setError(err instanceof Error ? err.message : "操作失败"); } finally { setSaving(false); }
  };
  return <div className={"studio-gallery" + (compact ? " compact" : "")}>
    <div className="studio-gallery-toolbar"><label className="studio-gallery-search"><Search size={17} strokeWidth={1.3} /><input aria-label="搜索素材" placeholder="搜索素材名称或分类" value={search} onChange={event => setSearch(event.target.value)} /></label><div className="studio-gallery-sources"><button className="button" onClick={() => { setUploadOpen(false); setCategory("全部"); setSearch(""); }} disabled={uploading}>从图库选取</button><button className="button primary" onClick={() => setUploadOpen(true)} disabled={uploading || readOnly}><ImagePlus size={16} />本机自定义上传</button></div></div>
    <div className="studio-gallery-categories">{categories.map(item => <button key={item} className={category === item ? "active" : ""} onClick={() => setCategory(item)}>{item}</button>)}{!compact && <label><input type="checkbox" checked={showInactive} onChange={event => setShowInactive(event.target.checked)} />显示已停用</label>}</div>
    {uploadOpen && !readOnly && <section className="studio-upload-panel"><h3>本机自定义上传</h3><p>选择本机照片，填写你自己的素材名称和分类，上传后即可从图库选用。</p><label className="studio-upload-category"><span>自定义分类</span><input value={uploadCategory} maxLength={80} placeholder="例如：戒指、项链、设计图、收款码" disabled={uploading} onChange={event => setUploadCategory(event.target.value)} /></label><button className="studio-dropzone" onClick={() => input.current?.click()} disabled={uploading} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); stageFiles(Array.from(event.dataTransfer.files)); }}><Upload size={25} strokeWidth={1} /><strong>{uploading ? "正在上传图片…" : "选择本机图片，或拖动到这里"}</strong><small>支持PNG、JPEG、WebP，每批最多20张，可逐张改名字。</small></button><input ref={input} type="file" aria-label="选择本机自定义图片" accept="image/png,image/jpeg,image/webp" multiple hidden disabled={uploading} onChange={event => stageFiles(Array.from(event.target.files || []))} /><div className="studio-upload-files">{localFiles.map((file, index) => <div className="studio-upload-file" key={`${file.name}-${file.lastModified}-${index}`}><LocalPhoto file={file}/><label><span>素材 {index + 1} · {file.name}</span><input aria-label={`素材 ${index + 1} 名称`} maxLength={120} disabled={uploading} value={uploadNames[index] || ""} onChange={event => setUploadNames(current => current.map((value, at) => at === index ? event.target.value : value))}/></label><button className="icon-button" aria-label={`移除待上传素材 ${index + 1}`} disabled={uploading} onClick={() => { setLocalFiles(current => current.filter((_value, at) => at !== index)); setUploadNames(current => current.filter((_value, at) => at !== index)); }}><X size={17}/></button></div>)}</div><div className="studio-upload-actions"><button className="button primary" disabled={uploading || !localFiles.length} onClick={() => void upload()}>{uploading ? <Loader2 size={16} className="spin"/> : <Upload size={16}/>}上传这 {localFiles.length} 张素材</button><button className="button" disabled={uploading} onClick={() => setUploadOpen(false)}>返回图库选取</button></div></section>}
    {error && <p className="studio-inline-error" role="alert">{error}</p>}
    <div className="studio-gallery-count"><span>{visible.length} 件素材</span>{uploading && <span><Loader2 size={14} className="spin" />正在上传</span>}</div>
    {visible.length ? <div className="studio-media-grid">{visible.map(asset => <article className={"studio-media-card" + (asset.active ? "" : " inactive")} key={asset.id}><button className="studio-media-photo" onClick={() => setPreview(asset)} aria-label={"查看素材 " + asset.name}><img loading="lazy" src={asset.url} alt={asset.name} /><span>查看图片 <ArrowUpRight size={14} /></span></button><div className="studio-media-caption"><div><small>{asset.category || "未分类"}{!asset.active && " · 已停用"}</small><h3>{asset.name}</h3></div>{(!readOnly && (admin || asset.ownerId === userId)) && <button className="icon-button" aria-label={"编辑素材 " + asset.name} onClick={() => edit(asset)}><Pencil size={15} /></button>}</div>{onSelect && asset.active && <button className="studio-media-select" onClick={() => onSelect(asset)}>选用这张图片 <ArrowUpRight size={14} /></button>}</article>)}</div> : <div className="studio-gallery-empty"><ImagePlus size={38} strokeWidth={.8} /><h3>{search || category !== "全部" ? "没有找到相符素材" : "留存每一份灵感"}</h3><p>上传珠宝照片、设计图或收款码，报价时即可选择。</p><button className="studio-text-link" onClick={() => setUploadOpen(true)}>上传第一张图片 <ArrowUpRight size={16} /></button></div>}
    {preview && <div className="studio-media-overlay" onClick={() => setPreview(null)}><section className="studio-media-preview" role="dialog" aria-modal="true" aria-label={preview.name} onClick={event => event.stopPropagation()}><header><div><small>{preview.category}</small><h3>{preview.name}</h3></div><button className="icon-button" aria-label="关闭图片预览" onClick={() => setPreview(null)}><X size={22} /></button></header><div className="studio-media-large"><img src={preview.url} alt={preview.name} /></div><footer><span>上传人：{preview.ownerName || "工作室成员"}</span>{onSelect && preview.active && <button className="button primary" onClick={() => { onSelect(preview); setPreview(null); }}>选用图片 <Check size={15} /></button>}</footer></section></div>}
    {editing && <div className="studio-media-overlay" onClick={() => !saving && setEditing(null)}><section className="studio-media-editor" role="dialog" aria-modal="true" aria-label="编辑图库素材" onClick={event => event.stopPropagation()}><header><h3>编辑素材</h3><button className="icon-button" aria-label="关闭素材编辑" onClick={() => setEditing(null)} disabled={saving}><X size={20} /></button></header><label><span>素材名称</span><input value={name} maxLength={120} onChange={event => setName(event.target.value)} /></label><label><span>分类</span><input value={editCategory} maxLength={80} onChange={event => setEditCategory(event.target.value)} /></label><p>停用后不再出现在选图列表，已保存的历史报价仍可查看原图。</p>{error && <p role="alert" className="studio-inline-error">{error}</p>}<footer><button className="studio-text-link" onClick={() => void toggle(editing)} disabled={saving}>{editing.active ? "停用素材" : "恢复素材"}</button><button className="button primary" onClick={save} disabled={saving}><Check size={15} />保存</button></footer></section></div>}
  </div>;
}

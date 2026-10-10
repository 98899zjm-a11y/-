"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, Check, Pencil, X } from "lucide-react";
import type { Settings } from "@/lib/domain";

type Props = {
  brand: Settings["brand"]; content: Settings["home"]; admin: boolean;
  onSave: (content: Settings["home"]) => Promise<void>; onNavigate: (page: string) => void;
};
const services = [
  { page: "sales", name: "珠宝销售", english: "JEWELRY", description: "从心仪款式，开始一份专属报价。" },
  { page: "tradein", name: "以旧换新", english: "EXCHANGE", description: "旧金焕新，细致核对每一项费用。" },
  { page: "recycling", name: "贵金属回收", english: "RECYCLE", description: "确认材质与重量，清晰呈现回收价格。" },
  { page: "repairs", name: "珠宝维修", english: "CARE", description: "为珍爱的珠宝，选择合适的修护。" },
  { page: "custom", name: "专属定制", english: "BESPOKE", description: "记录灵感与细节，让想法成为珠宝。" },
];
const paragraphs = (value: string) => (value || "").split(/\n+/).map(line => line.trim()).filter(Boolean);

export default function HomeStudio({ brand, content, admin, onSave, onNavigate }: Props) {
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState(content);
  const [saving, setSaving] = useState(false), [error, setError] = useState("");
  useEffect(() => { if (!editing) setDraft(content); }, [content, editing]);
  const save = async () => { setSaving(true); setError(""); try { await onSave(draft); setEditing(false); } catch (err) { setError(err instanceof Error ? err.message : "保存失败，请重试"); } finally { setSaving(false); } };
  return <div className="studio-home">
    <section className="studio-hero">
      <div className="studio-hero-copy">
        <span className="studio-eyebrow">THE JEWELRY ATELIER</span>
        <h2>{(content.headline || "让每一份珍爱，清晰呈现。").split("，").map((part, index, parts) => <span key={index} style={{ display: "block" }}>{part}{index < parts.length - 1 ? "，" : ""}</span>)}</h2>
        <p>{content.introduction || "从珠宝选购到专属定制，以细致服务回应每一份信任。"}</p>
        <button className="studio-text-link" onClick={() => onNavigate("sales")}>开始专属报价 <ArrowUpRight size={17} /></button>
        <div className="studio-hero-signature"><span>{brand.english || "XIN JIN YUAN"}</span><small>{brand.name} · 珠宝工作室</small></div>
      </div>
      <div className="studio-hero-photo"><img src="/ring.jpg" alt="珠宝工作室钻戒" /><div className="studio-photo-caption"><span>THE ART OF JEWELRY</span><small>细节，值得被珍视。</small></div></div>
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
  </div>;
}

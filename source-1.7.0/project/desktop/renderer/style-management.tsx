import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Pencil, Plus, Search } from "lucide-react";
import type { Style } from "@/lib/domain";
import { api } from "./bridge";

type StylePage = { styles: Style[]; total: number; page: number; pageSize: number };
type Props = { revision: number; busy: boolean; onNew: () => void; onEdit: (style: Style) => void };

export default function StyleManagement({ revision, busy, onNew, onEdit }: Props) {
  const [query, setQuery] = useState(""), [page, setPage] = useState(1), [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<StylePage | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [resultEpoch, setResultEpoch] = useState(0), [resultKey, setResultKey] = useState("");
  const epoch = useRef(0), committedKey = useRef("");
  const requestKey = JSON.stringify([revision, query, page, attempt]);
  useLayoutEffect(() => { committedKey.current = requestKey; }, [requestKey]);
  const change = (nextQuery: string, nextPage = 1) => { epoch.current++; setQuery(nextQuery); setPage(nextPage); setResult(null); setLoading(true); setError(""); };
  useEffect(() => {
    const token = ++epoch.current; let active = true;
    setResult(null); setLoading(true); setError("");
    const current = () => active && token === epoch.current && committedKey.current === requestKey;
    const timer = setTimeout(() => {
      const parameters = new URLSearchParams({ includeInactive: "1", q: query.trim(), page: String(page), pageSize: "24" });
      void api<StylePage>(`/api/styles/search?${parameters}`).then(value => {
        if (!current()) return;
        if (!Array.isArray(value.styles) || !Number.isSafeInteger(value.total) || value.total < 0 || !Number.isSafeInteger(value.pageSize) || value.pageSize < 1 || value.pageSize > 200) throw new Error("款式管理结果无效，请重试");
        const lastPage = Math.max(1, Math.ceil(value.total / value.pageSize));
        if (page > lastPage) { epoch.current++; setPage(lastPage); return; }
        setResult(value); setResultEpoch(token); setResultKey(requestKey);
      }).catch(problem => { if (current()) setError(problem instanceof Error ? problem.message : "款式管理暂时无法读取，请重试"); }).finally(() => { if (current()) setLoading(false); });
    }, 200);
    return () => { active = false; clearTimeout(timer); epoch.current++; };
  }, [revision, query, page, attempt]);
  const ready = !loading && !error && result !== null && resultKey === requestKey && resultEpoch === epoch.current;
  const currentResult = () => !loading && !busy && resultEpoch === epoch.current && resultKey === committedKey.current;
  return <section className="panel">
    <div className="list-toolbar"><h2>款式库</h2><button className="button primary" type="button" disabled={busy} onClick={onNew}><Plus size={16}/>新增款式</button></div>
    <div className="search"><Search size={16}/><input aria-label="搜索管理款式名称材质规格" placeholder="搜索款式名称 / 材质 / 规格" maxLength={120} value={query} onChange={event => change(event.target.value)}/></div>
    <p className="muted-note">显示全部启用和停用款式，点击款式可编辑或恢复用于报价。</p>
    {loading && <p role="status"><Loader2 size={16}/>正在读取款式库…</p>}
    {error && <div role="alert"><p>{error}</p><button className="button" type="button" onClick={() => { epoch.current++; setAttempt(value => value + 1); setResult(null); setLoading(true); setError(""); }}>重试</button></div>}
    {ready && result && (result.styles.length ? <div className="style-grid">{result.styles.map(style => <button className={`style-card ${!style.active ? "inactive" : ""}`} key={style.id} type="button" disabled={busy} onClick={() => { if (currentResult()) onEdit(style); }}><img src={style.image || "/ring.jpg"} alt={style.name}/><div><h3>{style.name}</h3><p>{style.material} · {style.weight} 克</p><span>{style.active ? "可用于报价" : "已停用"}</span></div><Pencil size={15}/></button>)}</div> : <p className="muted-note">{query.trim() ? "没有找到相符款式，请调整关键词。" : "暂无款式，可新增照片、材质、规格与默认附加费。"}</p>)}
    <div className="pagination"><button type="button" disabled={!ready || page <= 1} onClick={() => change(query, page - 1)} aria-label="上一页款式管理"><ChevronLeft size={16}/></button><span>第 {page} 页 · 共 {ready && result ? result.total : "—"} 款</span><button type="button" disabled={!ready || !result || page * result.pageSize >= result.total} onClick={() => change(query, page + 1)} aria-label="下一页款式管理"><ChevronRight size={16}/></button></div>
  </section>;
}

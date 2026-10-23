import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Search } from "lucide-react";
import type { Style } from "@/lib/domain";
import { api } from "./bridge";
import "./customer-picker.css";

export default function StylePicker({ styles, onSelect }: { styles: Style[]; onSelect: (style: Style) => void }) {
  const [query, setQuery] = useState(""), [page, setPage] = useState(1), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [result, setResult] = useState<{ styles: Style[]; total: number; pageSize: number }>({ styles: [], total: 0, pageSize: 24 });
  const epoch = useRef(0); const [resultEpoch, setResultEpoch] = useState(0);
  useEffect(() => {
    const token = ++epoch.current; let active = true; setLoading(true); setError(""); setResult({ styles: [], total: 0, pageSize: 24 });
    const timer = setTimeout(() => { const params = new URLSearchParams({ q: query.trim(), page: String(page), pageSize: "24" }); void api<{ styles: Style[]; total: number; pageSize: number }>(`/api/styles/search?${params}`).then(value => { if (active && token === epoch.current) { setResult(value); setResultEpoch(token); } }).catch(problem => { if (active && token === epoch.current) setError(problem instanceof Error ? problem.message : "款式搜索暂时无法读取"); }).finally(() => { if (active && token === epoch.current) setLoading(false); }); }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [query, page]);
  const activeKnown = useMemo(() => styles.filter(style => style.active).length, [styles]);
  return <div className="style-picker"><label className="style-picker-toolbar"><Search size={17}/><input aria-label="按款式名称材质规格搜索" value={query} placeholder="搜索款式名称 / 材质 / 规格" onChange={event => { epoch.current++; setQuery(event.target.value); setPage(1); setResult({ styles: [], total: 0, pageSize: 24 }); setLoading(true); }}/></label><p className="customer-activity-note">按名称、材质或规格查找款式。搜索不会重置当前报价，选中后才应用款式。</p>{loading && <p><Loader2 size={16} className="spin"/>正在搜索款式…</p>}{error && <p role="alert">{error}（当前已知 {activeKnown} 款，可稍后重试。）</p>}<div className="style-picker-grid">{!loading && result.styles.map(style => <button className="style-picker-card" key={style.id} onClick={() => { if (resultEpoch === epoch.current && style.active) onSelect(style); }}><img src={style.image || "/ring.jpg"} alt={style.name}/><span><strong>{style.name}</strong><small>{style.material} · {style.weight.toFixed(3)} 克</small><small>{style.specs || "未填写规格"}</small></span></button>)}</div>{!loading && !error && !result.styles.length && <p className="customer-activity-note">没有找到相符款式，可更换关键词或临时录入定制款。</p>}<div className="pagination"><button disabled={loading || page <= 1} onClick={() => { epoch.current++; setPage(value => value - 1); }} aria-label="上一页款式">‹</button><span>第 {page} 页 · 共 {result.total} 款</span><button disabled={loading || page * result.pageSize >= result.total} onClick={() => { epoch.current++; setPage(value => value + 1); }} aria-label="下一页款式">›</button></div></div>;
}

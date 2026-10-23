import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Plus, Search } from "lucide-react";
import type { Customer } from "@/lib/domain";
import { api } from "./bridge";
import "./customer-picker.css";

export default function CustomerPicker({ value, selected, onSelect, onNew }: { value: string; selected?: Pick<Customer, "id" | "name" | "phone">; onSelect: (customer: Customer) => void; onNew: () => void }) {
  const [query, setQuery] = useState(""), [open, setOpen] = useState(false), [page, setPage] = useState(1), [result, setResult] = useState<{ customers: Customer[]; total: number; pageSize: number }>({ customers: [], total: 0, pageSize: 20 });
  const [loading, setLoading] = useState(false), [error, setError] = useState(""), [resultEpoch, setResultEpoch] = useState(0);
  const epoch = useRef(0);
  const change = (text: string, nextPage = 1) => { epoch.current++; setQuery(text); setPage(nextPage); setOpen(true); setResult({ customers: [], total: 0, pageSize: 20 }); setLoading(true); };
  useEffect(() => {
    if (!open) return;
    const token = ++epoch.current; let active = true; setLoading(true); setError("");
    const timer = setTimeout(() => { const params = new URLSearchParams({ q: query.trim(), page: String(page), pageSize: "20" }); void api<{ customers: Customer[]; total: number; pageSize: number }>(`/api/customers/search?${params}`).then(data => { if (active && token === epoch.current) { setResult(data); setResultEpoch(token); } }).catch(problem => { if (active && token === epoch.current) setError(problem instanceof Error ? problem.message : "客户搜索失败，请重试"); }).finally(() => { if (active && token === epoch.current) setLoading(false); }); }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [query, page, open]);
  return <div className="customer-picker"><div className="customer-picker-selected"><strong>{selected ? selected.name : value ? "已选择客户" : "尚未关联客户"}</strong><small>{selected?.phone || (value ? "当前客户选择保持不变" : "按姓名、电话或备注搜索，结果来自完整客户库")}</small></div><div className="customer-picker-search"><Search size={16}/><input aria-label="按姓名、电话或备注搜索客户" value={query} placeholder="搜索姓名 / 电话 / 备注" onFocus={() => setOpen(true)} onChange={event => change(event.target.value)}/><button type="button" onClick={onNew}><Plus size={15}/>新建</button></div>{open && <section className="customer-picker-results" aria-label="客户搜索结果">{loading && <p><Loader2 size={15} className="spin"/>正在搜索客户…</p>}{error && <p role="alert">{error}</p>}{!loading && !error && !result.customers.length && <p>没有找到客户，可调整姓名／电话／备注或新建。</p>}{!loading && result.customers.map(customer => <button className={value === customer.id ? "selected" : ""} type="button" key={customer.id} onClick={() => { if (resultEpoch !== epoch.current || loading) return; onSelect(customer); setOpen(false); }}><strong>{customer.name}</strong><span>{customer.phone || "未填写电话"}</span></button>)}<footer><button type="button" disabled={loading || page <= 1} onClick={() => change(query, page - 1)} aria-label="上一页客户结果"><ChevronLeft size={16}/></button><span>第 {page} 页 · 共 {result.total} 位</span><button type="button" disabled={loading || page * result.pageSize >= result.total} onClick={() => change(query, page + 1)} aria-label="下一页客户结果"><ChevronRight size={16}/></button><button type="button" onClick={() => { epoch.current++; setOpen(false); }}>收起</button></footer></section>}</div>;
}

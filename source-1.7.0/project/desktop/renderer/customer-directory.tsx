import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Plus, Search, Trash2 } from "lucide-react";
import type { Customer, CustomerRecordCounts, CustomerSearchPage } from "@/lib/domain";
import { api } from "./bridge";
import "./customer-directory.css";

type Props = {
  revision: number; scopeKey: string; admin: boolean; canWriteSales: boolean; busy: boolean;
  onNew: () => void; onOpen: (customer: Customer) => void; onDelete: (customer: Customer) => void;
};

function recordCounts(result: CustomerSearchPage, id: string): CustomerRecordCounts | null {
  const value = result.counts && Object.hasOwn(result.counts, id) ? result.counts[id] : undefined;
  if (!value || !Number.isSafeInteger(value.quoteVersionCount) || value.quoteVersionCount < 0 || !Number.isSafeInteger(value.confirmedRecordCount) || value.confirmedRecordCount < 0 || value.confirmedRecordCount > value.quoteVersionCount) return null;
  return value;
}

export default function CustomerDirectory({ revision, scopeKey, admin, canWriteSales, busy, onNew, onOpen, onDelete }: Props) {
  const [query, setQuery] = useState(""), [page, setPage] = useState(1), [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<CustomerSearchPage | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [resultEpoch, setResultEpoch] = useState(0), [resultKey, setResultKey] = useState("");
  const epoch = useRef(0), liveKey = useRef("");
  const requestKey = JSON.stringify([scopeKey, revision, query, page, attempt]);
  liveKey.current = requestKey;
  const change = (nextQuery: string, nextPage = 1) => {
    epoch.current++; setQuery(nextQuery); setPage(nextPage); setResult(null); setLoading(true); setError("");
  };
  const retry = () => { epoch.current++; setAttempt(value => value + 1); setResult(null); setLoading(true); setError(""); };

  useEffect(() => {
    const token = ++epoch.current; let active = true;
    setLoading(true); setError(""); setResult(null);
    const current = () => active && token === epoch.current && liveKey.current === requestKey;
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ q: query.trim(), page: String(page), pageSize: "20" });
      void api<CustomerSearchPage>(`/api/customers/search?${params}`).then(data => {
        if (!current()) return;
        if (!Array.isArray(data.customers) || !Number.isSafeInteger(data.total) || data.total < 0 || !Number.isSafeInteger(data.pageSize) || data.pageSize < 1 || data.pageSize > 200) throw new Error("客户搜索结果无效，请重试");
        const lastPage = Math.max(1, Math.ceil(data.total / data.pageSize));
        if (page > lastPage) { epoch.current++; setPage(lastPage); return; }
        setResult(data); setResultEpoch(token); setResultKey(requestKey);
      }).catch(problem => { if (current()) setError(problem instanceof Error ? problem.message : "客户搜索失败，请重试"); }).finally(() => { if (current()) setLoading(false); });
    }, 200);
    return () => { active = false; clearTimeout(timer); epoch.current++; };
  }, [query, page, revision, scopeKey, attempt]);

  const ready = !loading && !error && result !== null && resultKey === requestKey && resultEpoch === epoch.current;
  const currentResult = () => !loading && resultEpoch === epoch.current && resultKey === liveKey.current;
  return <section className="panel list-panel customer-directory">
    <div className="list-toolbar">
      <div className="search"><Search size={16}/><input aria-label="搜索客户姓名、电话或备注" maxLength={120} placeholder="搜索姓名、电话或备注" value={query} onChange={event => change(event.target.value)}/></div>
      <button className="button primary" type="button" disabled={!canWriteSales || busy} onClick={onNew}><Plus size={16}/>新建客户</button>
    </div>
    <p className="customer-directory-note">统计仅含当前账号可查看记录。报价记录按保存版本计数；已成交记录按当前有效成交版本计数。</p>
    {loading && <p className="customer-directory-state" role="status"><Loader2 size={16} className="spin"/>正在读取客户档案…</p>}
    {error && <div className="customer-directory-error" role="alert"><p>{error}</p><button className="button" type="button" onClick={retry}>重试</button></div>}
    {ready && result && (result.customers.length ? <div className="customer-grid">{result.customers.map(customer => {
      const counts = recordCounts(result, customer.id);
      return <div className="customer-directory-card" key={customer.id}>
        <button className="customer-directory-open" type="button" onClick={() => { if (currentResult()) onOpen(customer); }}>
          <span className="customer-directory-initial" aria-hidden="true">{customer.name[0] || "客"}</span>
          <span className="customer-directory-copy"><strong>{customer.name}</strong><span>{customer.phone || "未填写电话"}</span><span className="customer-directory-counts"><span>报价记录 {counts?.quoteVersionCount ?? "—"}</span><span>已成交记录 {counts?.confirmedRecordCount ?? "—"}</span></span>{!counts && <small>统计暂不可用</small>}</span>
          <ChevronRight size={16}/>
        </button>
        {admin && <button className="customer-directory-delete" type="button" disabled={!canWriteSales || busy} aria-label={`删除客户 ${customer.name}`} onClick={() => { if (currentResult() && canWriteSales && !busy) onDelete(customer); }}><Trash2 size={16}/></button>}
      </div>;
    })}</div> : <div className="customer-directory-state customer-directory-empty"><strong>{query.trim() ? "没有找到匹配客户" : "还没有客户档案"}</strong><p>{query.trim() ? "请调整姓名、电话或备注后再搜索。" : "新增客户后，可将销售、回收与维修报价关联到同一位客户。"}</p></div>)}
    <div className="pagination">
      <button type="button" disabled={!ready || page <= 1} onClick={() => change(query, page - 1)} aria-label="上一页客户"><ChevronLeft size={16}/></button>
      <span>第 {page} 页 · 共 {ready && result ? result.total : "—"} 位</span>
      <button type="button" disabled={!ready || !result || page * result.pageSize >= result.total} onClick={() => change(query, page + 1)} aria-label="下一页客户"><ChevronRight size={16}/></button>
    </div>
  </section>;
}

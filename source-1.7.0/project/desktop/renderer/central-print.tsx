import { useEffect, useRef, useState } from 'react';
import { FileText, Loader2, Printer, RefreshCw, X } from 'lucide-react';
import { api } from './bridge';
import './remote-print.css';

export type CentralPrintSource = { type: string; quoteId?: string; id?: number|string; filters?: Record<string, unknown>; filter?: string; sort?: string; blind?: string; mode?: string; range?: string };
export type CentralPrintJob = { id: string; requestId: string; type: string; source: CentralPrintSource; requestedSource?: CentralPrintSource; copies: number; status: 'queued'|'printing'|'submitted'|'failed'|'uncertain'; printerLabel?: string; routingRevision?: number; createdAt?: string; actorName?: string; error?: string; requestMeta?: { asOf?: string; comparison?: string; acceptedSource?: unknown; fingerprint?: string; reprintOf?: string } };
type Input = { version: 2; requestId: string; source: CentralPrintSource; copies: number; presentation: { language: 'zh'|'en' }; reprintOf?: string; reprintConfirmed?: true };
type Attempt = { input: Input; job?: CentralPrintJob };
type Options = { sourceTypes?: string[]; types?: Record<string,{available:boolean;label:string;reason?:string;printerId?:string}> };
type State = { source: CentralPrintSource; loading: boolean; busy: boolean; error: string; options: Options|null; attempt: Attempt|null; jobs: CentralPrintJob[]; total: number; offset: number };
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const stable = (value:unknown) => JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const same = (a: unknown,b: unknown) => stable(a)===stable(b);
const terminal = (job?: CentralPrintJob) => !!job&&['submitted','failed','uncertain'].includes(job.status);
export const printSourceLabels: Record<string,string> = { warranty:'珠宝质保单', 'quotation-a4':'A4 销售报价', 'erp-document-a4':'财务 ERP 单据', 'erp-report-a4':'财务 ERP 报表', 'ledger-report-a4':'经营汇报', 'inventory-count-a4':'库存盘点单', 'inventory-report-a4':'库管报表', 'inventory-metal-a4':'金属统计表' };
export const printStatusLabels = { queued:'主机已受理，等待打印', printing:'主机正在准备打印', submitted:'系统已接收，请核对出纸', failed:'主机未能提交', uncertain:'结果不确定，请先核对出纸，不会自动重打' };

export function createCentralPrintController({ source, scope, storage, request, randomId, onChange }: { source: CentralPrintSource; scope: string; storage: Pick<Storage,'getItem'|'setItem'|'removeItem'>; request: <T>(path:string,method?:string,body?:unknown)=>Promise<T>; randomId:()=>string; onChange:(state:State)=>void }) {
  const key=`xjy-central-print-v2-${scope}-${stable(source)}`;
  let alive=true,working=false,state:State={source:clone(source),loading:true,busy:false,error:'',options:null,attempt:null,jobs:[],total:0,offset:0};
  try { const value=JSON.parse(storage.getItem(key)||'null') as Attempt|null;if(value?.input?.version===2&&UUID.test(value.input.requestId)&&same(value.input.source,source)&&Number.isInteger(value.input.copies)&&value.input.copies>=1&&value.input.copies<=3)state.attempt=value; } catch { /* Failure to write later prevents any new physical request. */ }
  const change=(next:Partial<State>)=>{if(alive){state={...state,...next};onChange(clone(state));}};
  const persist=(attempt:Attempt)=>{const text=JSON.stringify(attempt);storage.setItem(key,text);if(storage.getItem(key)!==text)throw Error('请求编号未能保存，本次没有向主机提交。');change({attempt});};
  const route=()=>state.options?.types?.[state.source.type];
  async function task(action:()=>Promise<void>){if(!alive||working)return;working=true;change({busy:true,error:''});try{await action();}catch(error){change({error:error instanceof Error?error.message:'打印操作未完成，请核对原请求后重试。'});}finally{working=false;change({busy:false});}}
  return {
    getState:()=>clone(state),
    async load(){if(!alive)return;change({loading:true});try{const options=await request<Options>('/api/print-options');change({options,error:''});}catch(error){change({error:error instanceof Error?error.message:'主机打印状态未能读取。'});}finally{change({loading:false});}},
    async submit(copies=1,language:'zh'|'en'='zh'){await task(async()=>{
      if(!route()?.available||!state.options?.sourceTypes?.includes(state.source.type))throw Error(route()?.reason||'这类单据的固定主机打印设备尚不可用。');
      let current=state.attempt;
      if(current?.job)throw Error('本次请求已有主机任务，请查询状态后再处理。');
      if(!current){if(!Number.isInteger(copies)||copies<1||copies>3)throw Error('打印份数只允许1至3份。');const requestId=randomId();if(!UUID.test(requestId))throw Error('无法建立可靠请求编号。');current={input:{version:2,requestId,source:clone(state.source),copies,presentation:{language}}};try{persist(current);}catch{throw Error('本机未能保存打印请求编号，本次没有向主机提交。请恢复存储后重试。');}}
      const result=await request<{job:CentralPrintJob}>('/api/print-jobs','POST',current.input);
      try{persist({...current,job:result.job});}catch{change({attempt:{...current,job:result.job},error:'主机已返回任务，但本机状态未能保存。原请求编号仍保留，请继续查询。'});}
    });},
    async query(){await task(async()=>{const current=state.attempt;if(!current)return;const lookup=current.job?.id?'/api/print-jobs/'+current.job.id:'/api/print-jobs/by-request/'+current.input.requestId;const result=await request<{job:CentralPrintJob}>(lookup);try{persist({...current,job:result.job});}catch{change({attempt:{...current,job:result.job},error:'任务已查到，本机未能保存状态；请保留原编号。'});}});},
    async reprint(confirmed:boolean){await task(async()=>{
      const original=state.attempt;if(!terminal(original?.job)||!confirmed)throw Error('请先核对原任务和实际出纸情况，再确认补打。');
      const requested=original!.job!.requestedSource||original!.input.source;
      if(!same(requested,original!.input.source))throw Error('原任务来源与本次不同，请从原单据重新打开。');
      const input:Input={...clone(original!.input),requestId:randomId(),reprintOf:original!.job!.id,reprintConfirmed:true};
      if(!UUID.test(input.requestId)||input.requestId===original!.input.requestId)throw Error('新的补打请求编号无效。');persist({input});
    });},
    async history(filters:Record<string,string|number>={}){await task(async()=>{const query=new URLSearchParams({limit:'20',offset:String(filters.offset??0)});for(const key of ['type','status','actorId','from','to'])if(filters[key])query.set(key,String(filters[key]));const result=await request<{jobs:CentralPrintJob[];total:number}>('/api/print-jobs/list?'+query.toString());change({jobs:result.jobs,total:result.total,offset:Number(filters.offset||0)});});},
    dispose(){alive=false;}
  };
}

export default function CentralPrint({source,scope,onClose,admin=false,historyOnly=false,actors=[]}:{source:CentralPrintSource;scope:string;onClose:()=>void;admin?:boolean;historyOnly?:boolean;actors?:{id:string;name:string}[]}) {
  const [state,setState]=useState<State>({source,loading:true,busy:false,error:'',options:null,attempt:null,jobs:[],total:0,offset:0}),[copies,setCopies]=useState(1),[language,setLanguage]=useState<'zh'|'en'>('zh'),[confirmed,setConfirmed]=useState(false),[queueOpen,setQueueOpen]=useState(historyOnly),[statusFilter,setStatusFilter]=useState(''),[from,setFrom]=useState(''),[to,setTo]=useState(''),[typeFilter,setTypeFilter]=useState(''),[actorFilter,setActorFilter]=useState('');
  const controller=useRef<ReturnType<typeof createCentralPrintController>|null>(null);
  useEffect(()=>{const value=createCentralPrintController({source,scope,storage:localStorage,request:api,randomId:()=>crypto.randomUUID(),onChange:setState});controller.current=value;setState(value.getState());void value.load().then(()=>{if(historyOnly)void value.history();});return()=>{value.dispose();if(controller.current===value)controller.current=null;};},[scope,JSON.stringify(source),historyOnly]);
  useEffect(()=>{if(!state.attempt||terminal(state.attempt.job))return;const timer=setInterval(()=>void controller.current?.query(),3500);return()=>clearInterval(timer);},[state.attempt?.input.requestId,state.attempt?.job?.status]);
  const route=state.options?.types?.[source.type],attempt=state.attempt,job=attempt?.job;
  const loadHistory=(offset=0)=>{setQueueOpen(true);void controller.current?.history({status:statusFilter,type:typeFilter,...(admin&&actorFilter?{actorId:actorFilter}:{}),from,to,offset});};
  return <div className="remote-print-backdrop"><section className="remote-print-dialog" role="dialog" aria-modal="true" aria-labelledby="central-print-title"><header><div><span>WORKSTUDIO PRINT</span><h2 id="central-print-title">{historyOnly?(admin?'所有员工打印任务':'我的打印任务'):'提交主机统一打印'}</h2></div><button className="remote-print-icon" onClick={onClose} aria-label="关闭打印面板"><X size={20}/></button></header><div className="remote-print-body">
    <div className="remote-print-quote"><FileText size={20}/><strong>{historyOnly?'打印任务记录':printSourceLabels[source.type]||'业务单据'}</strong></div><p className="remote-print-note">主机按你的当前权限读取原业务来源，使用管理员绑定的固定设备。关闭窗口不会取消已受理任务。</p>
    {state.error&&<div className="remote-print-feedback error" role="alert">{state.error}</div>}{state.loading&&<p><Loader2 className="spin" size={16}/>正在读取主机设置…</p>}
    {!historyOnly&&<fieldset className="remote-print-form" disabled={state.loading||state.busy||!!attempt}><div className="remote-print-grid"><label>主机绑定设备<input readOnly value={route?.label||'尚未读取'}/></label><label>打印份数<select value={copies} onChange={event=>setCopies(Number(event.target.value))}>{[1,2,3].map(value=><option key={value} value={value}>{value}份</option>)}</select></label>{source.type==='quotation-a4'&&<label>打印语言<select value={language} onChange={event=>setLanguage(event.target.value as 'zh'|'en')}><option value="zh">中文</option><option value="en">英文栏目（业务原文保留）</option></select></label>}</div></fieldset>}
    {!historyOnly&&!route?.available&&!state.loading&&<div className="remote-print-feedback">{route?.reason||'当前类型设备或权限不可用，不会改用另一台打印机。'}</div>}
    {!historyOnly&&<details className="remote-print-note"><summary>本次业务来源与筛选</summary><pre>{JSON.stringify(source,null,2)}</pre></details>}
    {!historyOnly&&attempt&&<section className={`remote-print-job ${job?.status||'pending'}`} role="status"><strong>{job?printStatusLabels[job.status]:'请求尚未确认，请先查询，不要新建另一个请求'}</strong><small>请求编号：{attempt.input.requestId}</small>{job?.error&&<p>{job.error}</p>}{job?.requestMeta&&<><p>受理时点：{job.requestMeta.asOf||'查看原单据日期'} · 设备：{job.printerLabel} · 修订：{job.routingRevision}</p><p>{job.requestMeta.comparison==='immutable-snapshot'?'本次为固定快照；旧报表内容不透明，不承诺原业务仍未变化。':'发送前再次核对业务版本和权限。'}</p>{job.requestMeta.reprintOf&&<p>补打关联原任务：{job.requestMeta.reprintOf}</p>}<details><summary>受理的完整来源条件</summary><pre>{JSON.stringify(job.requestMeta.acceptedSource||job.source,null,2)}</pre></details></>}
    <button className="remote-print-button" disabled={state.busy} onClick={()=>void controller.current?.query()}><RefreshCw size={15}/>查询原请求</button>{terminal(job)&&<label className="remote-print-verify"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/>我已核对原任务和出纸情况，确认需要有记录的补打</label>}</section>}
    <button className="remote-print-button" disabled={state.busy} onClick={()=>loadHistory()}>{admin?'查看所有员工打印任务':'查看我的打印任务'}</button>
    {queueOpen&&<section className="remote-print-job"><div className="remote-print-grid"><label>业务类型<select value={typeFilter} onChange={event=>setTypeFilter(event.target.value)}><option value="">全部</option>{Object.entries(printSourceLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>{admin&&actors.length>0&&<label>员工<select value={actorFilter} onChange={event=>setActorFilter(event.target.value)}><option value="">所有员工</option>{actors.map(actor=><option key={actor.id} value={actor.id}>{actor.name}</option>)}</select></label>}<label>状态<select value={statusFilter} onChange={event=>setStatusFilter(event.target.value)}><option value="">全部</option>{Object.entries(printStatusLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><label>开始日期<input type="date" value={from} onChange={event=>setFrom(event.target.value)}/></label><label>结束日期<input type="date" value={to} onChange={event=>setTo(event.target.value)}/></label></div><button className="remote-print-button" disabled={state.busy} onClick={()=>loadHistory()}>筛选</button>{state.jobs.map(item=><article key={item.id}><strong>{printSourceLabels[item.type]} · {printStatusLabels[item.status]}</strong><p>{item.actorName} · {item.createdAt} · {item.printerLabel}</p><small>任务：{item.id} · 受理时点：{item.requestMeta?.asOf||'原单据'}</small></article>)}<p>共{state.total}条，第{Math.floor(state.offset/20)+1}页</p><button className="remote-print-button" disabled={state.busy||state.offset===0} onClick={()=>loadHistory(Math.max(0,state.offset-20))}>上一页</button><button className="remote-print-button" disabled={state.busy||state.offset+20>=state.total} onClick={()=>loadHistory(state.offset+20)}>下一页</button></section>}
  </div><footer><button className="remote-print-button" onClick={onClose}>关闭</button>{!historyOnly&&(!attempt||!job)&&<button className="remote-print-button primary" disabled={state.busy||state.loading||!route?.available} onClick={()=>void controller.current?.submit(copies,language)}><Printer size={16}/>{state.busy?'正在处理…':attempt?'继续提交同一编号':'提交主机打印'}</button>}{!historyOnly&&terminal(job)&&<button className="remote-print-button" disabled={state.busy||!confirmed} onClick={()=>{void controller.current?.reprint(confirmed);setConfirmed(false);}}>建立关联补打请求</button>}</footer></section></div>;
}

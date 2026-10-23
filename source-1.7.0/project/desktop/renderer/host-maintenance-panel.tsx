import { useEffect, useRef, useState } from 'react';
import { Download, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import type { DailyBackupHealth, HostMaintenanceInfo, HostMaintenanceResult, HostRestoreSelection } from './bridge';
import './host-maintenance-panel.css';
type MaintenanceBridge = Pick<Window['jewelryDesktop'],'getHostMaintenance'|'backup'|'restore'>;
export type HostMaintenanceState = { loading: boolean; working: boolean; action: 'backup'|'restore'|null; info: HostMaintenanceInfo|null; selectedName: string; selection: HostRestoreSelection; notice: string; error: string };
const scopes: { value: HostRestoreSelection; label: string }[] = [{value:'allBusiness',label:'全部业务资料（推荐）'},{value:'sales',label:'销售报价、客户及销售图片'},{value:'ledger',label:'财务资料'},{value:'inventory',label:'库管资料'},{value:'documents',label:'工作文档与相关附件'}];
const initialState=():HostMaintenanceState=>({loading:true,working:false,action:null,info:null,selectedName:'',selection:'allBusiness',notice:'',error:''});
const message=(error:unknown)=>error instanceof Error?error.message:'主机维护未能完成，请重试。';
export function maintenanceWarningText(value:{warnings?:unknown;result?:{warnings?:unknown}}){
 const messages:string[]=[];
 for(const items of [value.warnings,value.result?.warnings])if(Array.isArray(items))for(const item of items){if(messages.length>=20)break;if(item&&typeof item.message==='string'&&item.message.trim()){const text=item.message.replace(/[\x00-\x1f\x7f]/g,'').slice(0,800);if(!messages.includes(text))messages.push(text);}}
 return messages.length?' 注意：'+messages.join('；'):'';
}
function unpack(info:HostMaintenanceInfo){if(!info?.ok)throw Error(info?.error||'主机统一备份暂时无法读取。');if(typeof info.available!=='boolean'||info.retentionDays!==7||info.encrypted!==true||!Array.isArray(info.backups)||!Array.isArray(info.jobs))throw Error('当前主机尚未提供完整加密备份，请更新主机程序。');if(info.backups.some(x=>typeof x.name!=='string'||!x.name||x.name.length>240||/[\\/:\x00-\x1f]/.test(x.name)||typeof x.createdAt!=='string'||typeof x.kind!=='string'))throw Error('主机备份清单无效，请重新读取。');return info;}
function completed(result:HostMaintenanceResult,action:string){if(result.canceled)return false;if(!result.ok)throw Error(result.error||action+'未完成。');if(result.status&&result.status!=='completed')throw Error('主机任务已受理，但尚未确认完成，请检查任务记录。');return true;}
export function createHostMaintenanceController({bridge,onChange,onRestored}:{bridge:MaintenanceBridge;onChange:(state:HostMaintenanceState)=>void;onRestored?:()=>void}){
 let state=initialState(),alive=true,generation=0;
 const emit=(next:Partial<HostMaintenanceState>)=>{if(!alive)return;state={...state,...next};onChange(state);};
 async function readInfo(){if(!bridge.getHostMaintenance)throw Error('当前版本未提供主机统一备份，请更新程序。');return unpack(await bridge.getHostMaintenance());}
 const selectInfo=(info:HostMaintenanceInfo)=>({info,selectedName:info.backups.some(x=>x.name===state.selectedName)?state.selectedName:info.backups[0]?.name||''});
 function allowed(){if(!state.info?.available)throw Error(state.info?.reason||'只能在资料完整的主机上操作统一备份。');}
 return{async load(){if(!alive||state.working)return;const turn=++generation;emit({loading:true,error:''});try{const info=await readInfo();if(alive&&turn===generation)emit({...selectInfo(info),error:info.available?'':info.reason||'主机资料未完整关联。'});}catch(error){if(alive&&turn===generation)emit({info:null,error:message(error)});}finally{if(alive&&turn===generation)emit({loading:false});}},selectBackup(name:string){if(!alive||state.working||state.loading||!state.info?.backups.some(x=>x.name===name))return;emit({selectedName:name,notice:'',error:''});},selectScope(value:HostRestoreSelection){if(!alive||state.working||state.loading||!scopes.some(x=>x.value===value))return;emit({selection:value,notice:'',error:''});},async backup(){if(!alive||state.working||state.loading)return;try{allowed();}catch(error){emit({error:message(error)});return;}const turn=generation;emit({working:true,action:'backup',notice:'',error:''});try{const result=await bridge.backup();if(!alive||turn!==generation)return;if(!completed(result,'备份')){emit({notice:'已取消备份。'});return;}emit({notice:'销售、财务、库管及相关附件的加密备份已完成。'+maintenanceWarningText(result)});try{const info=await readInfo();if(alive&&turn===generation)emit(selectInfo(info));}catch{if(alive&&turn===generation)emit({error:'备份已完成；清单暂未刷新，请点击重新读取。'});}}catch(error){if(alive&&turn===generation)emit({error:message(error)});}finally{if(alive&&turn===generation)emit({working:false,action:null});}},async restore(){if(!alive||state.working||state.loading)return;try{allowed();if(!state.info?.backups.some(x=>x.name===state.selectedName))throw Error('请先选择已有备份。');}catch(error){emit({error:message(error)});return;}const turn=generation,input={name:state.selectedName,selection:state.selection};emit({working:true,action:'restore',notice:'',error:''});try{const result=await bridge.restore(input);if(!alive||turn!==generation)return;if(!completed(result,'恢复')){emit({notice:'已取消恢复，原业务资料保持不变。'});return;}emit({notice:'所选资料已恢复，请重新登录并核对业务记录。'+maintenanceWarningText(result)});onRestored?.();}catch(error){if(alive&&turn===generation)emit({error:message(error)});}finally{if(alive&&turn===generation)emit({working:false,action:null});}},dispose(){alive=false;generation++;}};
}
const dateText=(value:string)=>{const d=new Date(value);return Number.isFinite(d.getTime())?d.toLocaleString('zh-CN',{hour12:false}):'时间待核对';};
const kindText=(value:string)=>value==='auto'?'每日备份':value==='pre-restore'?'恢复前备份':'手动备份';
function isoTime(value:unknown):value is string {
 return typeof value==='string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString()===value;
}
function knownDailyHealth(value:unknown):value is DailyBackupHealth {
 if(!value || typeof value!=='object' || Array.isArray(value))return false;
 const health=value as Record<string,unknown>;
 if(health.version!==1 || typeof health.state!=='string' || !['running','verified-today','failed','unverified'].includes(health.state) || typeof health.day!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(health.day))return false;
 const dayTime=health.day+'T00:00:00.000Z';
 if(!isoTime(dayTime) || !(health.lastAttemptAt===null || isoTime(health.lastAttemptAt)) || !(health.lastVerifiedAt===null || isoTime(health.lastVerifiedAt)))return false;
 if(health.lastError!==null){
  if(!health.lastError || typeof health.lastError!=='object' || Array.isArray(health.lastError))return false;
  const error=health.lastError as Record<string,unknown>;
  if(!isoTime(error.at) || typeof error.code!=='string' || !error.code || error.code.length>80 || typeof error.message!=='string' || !error.message || error.message.length>200)return false;
 }
 if(health.state==='failed' && health.lastError===null)return false;
 if(health.state==='verified-today'){
  if(!isoTime(health.lastVerifiedAt))return false;
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(health.lastVerifiedAt)).map(part=>[part.type,part.value]));
  if(parts.year+'-'+parts.month+'-'+parts.day!==health.day)return false;
 }
 return true;
}
export function DailyBackupStatus({health}:{health?:unknown}){
 if(!knownDailyHealth(health))return <p className="muted-note" role="status">自动备份状态待核对。</p>;
 const label=health.state==='running'?'自动备份运行中':health.state==='verified-today'?'今天自动备份已验证':health.state==='failed'?'自动备份未完成':health.lastVerifiedAt?'今天自动备份尚未验证':'自动备份尚无成功记录';
 return <div className={health.state==='failed'?'maintenance-error':'muted-note'} role={health.state==='failed'?'alert':'status'}><strong>{label}</strong><p>最近尝试：{health.lastAttemptAt?<time dateTime={health.lastAttemptAt}>{dateText(health.lastAttemptAt)}</time>:'尚无尝试记录'}</p><p>最近成功：{health.lastVerifiedAt?<time dateTime={health.lastVerifiedAt}>{dateText(health.lastVerifiedAt)}</time>:'尚无成功记录'}</p>{health.lastError&&<p>最近失败：<time dateTime={health.lastError.at}>{dateText(health.lastError.at)}</time>。自动备份未完成，请稍后重试。</p>}</div>;
}
export default function HostMaintenancePanel({dataPath,onRestored}:{dataPath?:string;onRestored?:()=>void}){
 const [state,setState]=useState(initialState),controller=useRef<ReturnType<typeof createHostMaintenanceController>|null>(null),restored=useRef(onRestored);restored.current=onRestored;
 useEffect(()=>{const current=createHostMaintenanceController({bridge:window.jewelryDesktop,onChange:setState,onRestored:()=>restored.current?.()});controller.current=current;void current.load();return()=>{current.dispose();controller.current=null;};},[]);
 const disabled=state.loading||state.working||!state.info?.available;
 return <section className="panel host-maintenance-panel"><div className="panel-title"><h2>主机统一备份</h2><button className="text-button" disabled={state.working||state.loading} onClick={()=>void controller.current?.load()}><RefreshCw size={14}/>重新读取</button></div><div className="maintenance-promise"><ShieldCheck size={22}/><p>销售、财务、库管及相关图片和附件由主机安排每日加密备份，保留7天。完成情况以自动备份状态为准。</p></div><DailyBackupStatus health={state.info?.dailyBackup}/>{dataPath&&<div className="offline-data-path">{dataPath}</div>}<div className="maintenance-actions"><button className="button primary" disabled={disabled} onClick={()=>void controller.current?.backup()}>{state.working&&state.action==='backup'?<Loader2 className="spin" size={16}/>:<Download size={16}/>}现在备份</button>{state.loading&&<span className="muted-note">正在读取主机备份…</span>}{state.working&&<span className="muted-note">{state.action==='restore'?'正在恢复，完成后需要重新登录。':'正在制作完整加密备份，请等待完成。'}</span>}</div><div className="maintenance-restore-grid"><label>已有备份<select aria-label="已有备份" value={state.selectedName} disabled={disabled||!state.info?.backups.length} onChange={event=>controller.current?.selectBackup(event.target.value)}>{!state.info?.backups.length&&<option value="">暂无可用备份</option>}{state.info?.backups.map(item=><option key={item.name} value={item.name}>{dateText(item.createdAt)} · {kindText(item.kind)}</option>)}</select></label><label>恢复范围<select aria-label="恢复范围" value={state.selection} disabled={disabled} onChange={event=>controller.current?.selectScope(event.target.value as HostRestoreSelection)}>{scopes.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}</select></label><button className="button" disabled={disabled||!state.selectedName} onClick={()=>void controller.current?.restore()}>{state.working&&state.action==='restore'?<Loader2 className="spin" size={16}/>:<RefreshCw size={16}/>}恢复所选备份</button></div><p className="muted-note">恢复前会由主机再次确认，并自动保留当前资料。无需选择文件夹或输入路径。</p>{state.notice&&<p className="maintenance-notice" role="status">{state.notice}</p>}{state.error&&<p className="maintenance-error" role="alert">{state.error}</p>}{!!state.info?.jobs.length&&<div className="maintenance-jobs"><h3>最近维护记录</h3>{state.info.jobs.slice().reverse().slice(0,5).map(job=><div key={job.id}><span>{job.kind==='restore'?'恢复资料':'备份资料'}</span><span>{({queued:'等待处理',running:'处理中',completed:'已完成',failed:'未完成'} as Record<string,string>)[job.status]||'待核对'}</span><small>{job.at?dateText(job.at):''}</small>{job.status==='failed'&&job.error&&<p>{job.error}</p>}{maintenanceWarningText(job)&&<p className="maintenance-error">{maintenanceWarningText(job)}</p>}</div>)}</div>}</section>;
}

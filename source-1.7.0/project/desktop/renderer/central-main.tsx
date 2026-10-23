import { useEffect,useState } from 'react';
import { createRoot } from 'react-dom/client';
import { installBrowserBridge } from './browser-bridge';
import { api,type AuthStatus } from './bridge';
import CentralPrint, { type CentralPrintSource } from './central-print';
import './styles.css';
installBrowserBridge();
function CentralBrowser(){const[value,setValue]=useState<{source:CentralPrintSource;scope:string;admin:boolean}|null>(null),[error,setError]=useState('');useEffect(()=>{let alive=true;const intent=new URL(location.href).searchParams.get('intent');if(!intent||!/^[a-f0-9-]{36}$/.test(intent)){setError('打印来源不存在。');return;}void Promise.all([api<{source:CentralPrintSource}>('/api/browser-print-intents/'+intent),api<AuthStatus>('/auth/status')]).then(([source,auth])=>{if(alive&&auth.authenticated&&auth.user)setValue({source:source.source,scope:location.origin+'-'+auth.user.id,admin:auth.user.role==='admin'});}).catch(e=>{if(alive)setError(e instanceof Error?e.message:'打印来源无法读取。');});return()=>{alive=false;};},[]);const close=()=>window.parent.postMessage({type:'xjy-central-print-close'},location.origin);if(value)return<CentralPrint {...value} onClose={close}/>;return<div className="remote-print-backdrop"><section className="remote-print-dialog"><p>{error||'正在读取你的打印来源…'}</p><button onClick={close}>关闭</button></section></div>;}
createRoot(document.getElementById('root')!).render(<CentralBrowser/>);

import { api } from './bridge';
export async function exportWorkbook(kind:'history'|'sales'|'logs',filters:Record<string,string>={}) {
 const query=new URLSearchParams(Object.entries(filters).filter(([,value])=>Boolean(value)));
 const result=await api<{filename:string;contentType:string;base64:string}>(`/api/exports/${kind}?${query}`);
 const bytes=Uint8Array.from(atob(result.base64),c=>c.charCodeAt(0)),url=URL.createObjectURL(new Blob([bytes],{type:result.contentType}));
 const link=document.createElement('a');link.href=url;link.download=result.filename;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
}

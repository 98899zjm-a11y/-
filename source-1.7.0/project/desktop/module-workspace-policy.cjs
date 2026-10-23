'use strict';
// A module page receives only this narrow bridge. Authentication, capability
// checks and ownership are repeated by the host on every forwarded request.
function authorizeModuleRequest(module,input){
 if(!['ledger','inventory'].includes(module)||!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['path','method','body'].includes(key)))throw new Error('模块协作请求无效');
 const address=input.path,method=String(input.method||'GET').toUpperCase();
 if(typeof address!=='string'||address.length>2500||!address.startsWith('/api/collaboration/')||address.includes('\\')||address.includes('#')||/%2f|%5c|%00/i.test(address.split('?')[0]))throw new Error('模块协作地址无效');
 const url=new URL(address,'http://offline.invalid');
 if(url.origin!=='http://offline.invalid'||url.pathname!==address.split('?')[0]||!['GET','POST','PATCH'].includes(method))throw new Error('模块协作请求无效');
 const pathname=url.pathname,uuid='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
 let allowed=method==='GET'&&pathname==='/api/collaboration/capabilities';
 if(module==='inventory')allowed ||= method==='GET'&&(pathname==='/api/collaboration/inventory-reports'||new RegExp('^/api/collaboration/inventory-reports/'+uuid+'$').test(pathname))||method==='POST'&&pathname==='/api/collaboration/inventory-reports';
 if(module==='ledger')allowed ||= method==='GET'&&(pathname==='/api/collaboration/inventory-reports'||new RegExp('^/api/collaboration/inventory-reports/'+uuid+'$').test(pathname)||pathname==='/api/collaboration/sales-publications'||new RegExp('^/api/collaboration/sales-publications/'+uuid+'$').test(pathname))||method==='POST'&&(new RegExp('^/api/collaboration/inventory-reports/'+uuid+'/review$').test(pathname)||pathname==='/api/collaboration/sales-publications'||new RegExp('^/api/collaboration/sales-publications/'+uuid+'/publish$').test(pathname))||method==='PATCH'&&new RegExp('^/api/collaboration/sales-publications/'+uuid+'/mapping$').test(pathname);
 if(!allowed)throw new Error('此模块不能调用该协作功能');
 if(input.body!==undefined){let size;try{size=Buffer.byteLength(JSON.stringify(input.body));}catch{throw new Error('模块协作参数无效');}if(size>1024*1024)throw new Error('模块协作参数过大');}
 return{path:address,method,...(input.body!==undefined?{body:input.body}:{})};
}
module.exports={authorizeModuleRequest};

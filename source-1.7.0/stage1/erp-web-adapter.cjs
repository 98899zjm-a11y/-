'use strict';
const {routeFor}=require('../project/desktop/erp-policy.cjs');
function createErpAdapter(session){
  if(!session||typeof session.dispatch!=='function')throw new Error('ERP adapter requires an independent authenticated session');
  return async function forward(input){
    const route=routeFor(input.path,input.method||'GET');
    const request={module:'ledger',path:route.path,method:route.method};
    if(route.method!=='GET'){
      if(!input.body||typeof input.body!=='object'||Array.isArray(input.body)){const error=new Error('ERP正文须为JSON对象');error.status=400;throw error;}
      request.headers={'content-type':'application/json'};
      request.bodyBase64=Buffer.from(JSON.stringify(input.body)).toString('base64');
    }
    const result=await session.dispatch({path:'/api/internal-modules/proxy',method:'POST',body:request});
    if(!result.ok)return {status:result.status,headers:{'content-type':'application/json; charset=utf-8'},bytes:Buffer.from(JSON.stringify({ok:false,...result.data}))};
    const value=result.data,headers={};
    for(const key of ['content-type','content-disposition']){const text=value.headers?.[key];if(typeof text==='string'&&!/[\r\n\x00]/.test(text))headers[key]=text;}
    if(route.endpoint==='erp.download'&&value.status>=200&&value.status<300){
      const disposition=headers['content-disposition'];
      headers['content-disposition']=typeof disposition==='string'&&/^(?:inline|attachment)(?:;|$)/i.test(disposition)?disposition.replace(/^(?:inline|attachment)/i,'attachment'):'attachment';
    }
    if(value.headers?.location){const location=value.headers.location;routeFor(location,'GET');headers.location=location;}
    return {status:value.status,headers,bytes:Buffer.from(value.bodyBase64,'base64')};
  };
}
module.exports={createErpAdapter};

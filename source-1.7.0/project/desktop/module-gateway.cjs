'use strict';
const http=require('node:http'),crypto=require('node:crypto');
const LIMIT=48*1024*1024;
const RESPONSE_LIMIT=64*1024*1024;
const allowedHeaders=new Set(['cookie','content-type','accept','accept-language','x-csrf-token','x-requested-with']);
async function createModuleGateway({module,proxy,checkUser}) {
 if(!['ledger','inventory','cashier'].includes(module))throw new Error('模块不存在');
 const token=crypto.randomBytes(32).toString('hex');let closed=false;const sockets=new Set();
 const server=http.createServer(async(req,res)=>{
  const fail=(status,message)=>{if(!res.headersSent){res.writeHead(status,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});res.end(message);}};
  try{
   if(closed||req.headers['x-xjy-gateway-token']!==token){req.resume();return fail(403,'此入口只能由鑫金源程序打开');}
   if(!await checkUser()){req.resume();return fail(401,'主程序登录已结束，请返回首页重新登录');}
   if(!['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'].includes(req.method)||!req.url?.startsWith('/')||req.url.startsWith('//')||req.url.includes('\\')){req.resume();return fail(400,'模块地址无效');}
   if(Number(req.headers['content-length']||0)>LIMIT){req.resume();return fail(413,'文件超过原模块48MB上限');}
   const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>LIMIT){return fail(413,'文件超过原模块48MB上限');}chunks.push(chunk);}
   const headers={};for(const [key,value] of Object.entries(req.headers))if(allowedHeaders.has(key)&&typeof value==='string')headers[key]=value;
   const response=await proxy({module,path:req.url,method:req.method,headers,bodyBase64:Buffer.concat(chunks).toString('base64')});
   if(!await checkUser())return fail(401,'主程序账号已切换，请重新打开模块');
   if(!response||!Number.isInteger(response.status)||response.status<100||response.status>599||typeof response.bodyBase64!=='string'||response.bodyBase64.length>RESPONSE_LIMIT*4/3+4)throw new Error('模块返回内容无效或过大');
   const result=Buffer.from(response.bodyBase64,'base64'),out={};
   for(const [key,value] of Object.entries(response.headers||{})){const lower=key.toLowerCase();if(['connection','transfer-encoding','content-length','keep-alive','upgrade'].includes(lower))continue;if(/^[a-z0-9-]+$/.test(lower)&&(typeof value==='string'||Array.isArray(value)&&value.every(x=>typeof x==='string')))out[lower]=value;}
   if(out.location){const next=new URL(String(out.location),'http://127.0.0.1');if(next.hostname!=='127.0.0.1'||next.username||next.password)throw new Error('模块跳转被拒绝');out.location=next.pathname+next.search+next.hash;}
   out['content-length']=String(result.length);out['x-content-type-options']='nosniff';
   res.writeHead(response.status,out);res.end(req.method==='HEAD'?undefined:result);
  }catch(error){fail(503,error.message||'模块暂时无法连接，请返回首页重试');}
 });
 server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));if(closed)socket.destroy();});
 server.requestTimeout=120000;server.headersTimeout=15000;
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const origin='http://127.0.0.1:'+server.address().port;
 return {origin,token,close(){if(closed)return Promise.resolve();closed=true;return new Promise(resolve=>{server.close(resolve);server.closeAllConnections();for(const socket of sockets)socket.destroy();});}};
}
module.exports={createModuleGateway};

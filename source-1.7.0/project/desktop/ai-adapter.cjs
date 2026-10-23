'use strict';
const {randomUUID}=require('node:crypto');
const tasks=Object.freeze(['explain-quotation','summarize-audit','review-draft']);
function createAiAdapter({audit=()=>{}}={}){
 let provider=null;
 const failure=(status,message)=>({ok:false,status,data:{error:message}});
 async function handle(user,input){
  if(!user?.id||user.active===false)return failure(401,'请先登录工作台');
  const method=String(input.method||'GET').toUpperCase();
  if(input.path==='/api/ai/capabilities'&&method==='GET')return{ok:true,status:200,data:{version:1,enabled:Boolean(provider),tasks:[...tasks],mode:'suggestions-only',writesBusinessData:false}};
  if(input.path!=='/api/ai/requests'||method!=='POST')return failure(404,'AI接口不存在');
  if(user.role!=='admin')return failure(403,'当前仅管理员可以调用AI预留接口');
  const body=input.body;if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['task','text'].includes(key))||!tasks.includes(body.task)||typeof body.text!=='string'||!body.text.trim()||body.text.length>12000)return failure(400,'AI任务格式无效');
  if(!provider)return failure(503,'AI尚未接入，当前程序不会自动连接模型服务');
  const id=randomUUID(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try{
   const result=await Promise.race([provider({id,task:body.task,text:body.text,actor:{id:user.id,name:user.name},signal:controller.signal}),new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(new Error('AI响应超时')),{once:true}))]);
   if(typeof result?.text!=='string'||result.text.length>30000||result.actions!==undefined)throw new Error('AI返回内容无效');
   audit({actor:user,module:'ai',action:'ai-suggestion',resource:id,success:true,summary:body.task});return{ok:true,status:200,data:{id,text:result.text,suggestionOnly:true,requiresHumanReview:true}};
  }catch{audit({actor:user,module:'ai',action:'ai-suggestion',resource:id,success:false,summary:body.task});return failure(502,'AI建议未能生成，请稍后重试');}finally{clearTimeout(timer);}
 }
 // Only application-side integrations can register a provider. Neither the
 // renderer nor model output can supply executable code, URLs, paths or tools.
 function registerProvider(callback){if(callback!==null&&typeof callback!=='function')throw new Error('AI适配器无效');provider=callback;}
 return{handle,registerProvider};
}
module.exports={createAiAdapter};

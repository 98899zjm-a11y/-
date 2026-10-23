'use strict';
// A business-only boundary. Provider configuration is application-side only.
const crypto=require('node:crypto'),tools=Object.freeze(['customers.search','quotes.history']);
function createAiBridge(){let provider=null;const fail=(status,error)=>({ok:false,status,data:{error}});
 return{registerProvider(callback){if(callback!==null&&typeof callback!=='function')throw new Error('Invalid provider');provider=callback;},async handle(user,input,context){
  if(!user?.id||user.active===false)return fail(401,'请先登录');
  if(input.path==='/api/ai/capabilities'&&input.method==='GET')return{ok:true,status:200,data:{providerConfigured:Boolean(provider),localDemo:true,tools,writesBusinessData:false,canModifyCode:false,requiresHumanApproval:true}};
  if(input.path!=='/api/ai/chat'||input.method!=='POST')return fail(404,'AI预留接口不存在');if(user.role!=='admin')return fail(403,'本阶段仅测试管理员可验收AI接口');
  const body=input.body;if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['text','tool','args'].includes(k))||typeof body.text!=='string'||!body.text.trim()||body.text.length>6000)return fail(400,'聊天参数无效');
  if(body.tool&&!tools.includes(body.tool))return fail(403,'AI无代码、系统命令、SQL、审批或发布工具');
  if(body.args!==undefined&&(!body.args||typeof body.args!=='object'||Array.isArray(body.args)))return fail(400,'工具参数无效');
  const allowed=body.tool==='customers.search'?['q','page','pageSize']:['search','from','to','type','status','page','pageSize'];const args=body.args||{};if(Object.keys(args).some(x=>!allowed.includes(x))||Object.values(args).some(x=>!['string','number'].includes(typeof x)||String(x).length>120))return fail(400,'工具参数含不允许内容');
  const data=body.tool?await context.read(body.tool,args):null;let text='尚未连接AI模型；这是本地接口演示。已按当前账号权限读取所选业务资料，AI没有修改程序或业务数据。';
  if(provider){const result=await provider({text:body.text,data,actor:{id:user.id,name:user.name}});if(typeof result?.text!=='string'||result.text.length>30000||result.actions!==undefined)return fail(502,'模型回复不符合只提供建议的接口规范');text=result.text;}
  return{ok:true,status:200,data:{id:crypto.randomUUID(),text,data,providerConfigured:Boolean(provider),suggestionOnly:true,writesBusinessData:false,canModifyCode:false}};
 }};
}
module.exports={createAiBridge};

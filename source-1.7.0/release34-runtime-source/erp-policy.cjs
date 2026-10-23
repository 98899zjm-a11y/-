'use strict';

// Shared by every ERP transport. The browser can request an operation, but
// cannot choose its actor, grants, or the capabilities signed for Python.
const LEVELS = Object.freeze(['disabled', 'view', 'operate', 'manage']);
const CAPABILITIES = Object.freeze([
  ['read','查看财务 ERP','view'], ['parties.manage','维护往来单位','operate'],
  ['purchase.prepare','编制采购单','operate'], ['purchase.review','复核采购单','manage'],
  ['receipt.prepare','编制收货验收单','operate'], ['receipt.review','复核收货验收单','manage'],
  ['bill.prepare','编制往来欠款单','operate'], ['bill.review','复核往来欠款单','manage'],
  ['settlement.prepare','登记收付款','operate'], ['settlement.review','复核收付款','manage'],
  ['reversal.prepare','申请财务冲销','operate'], ['reversal.review','复核财务冲销','manage'],
  ['reports.view','查看往来与采购报表','view'], ['reports.sensitive','查看采购成本及应付金额','view'],
  ['attachments.write','上传财务凭证附件','operate'],
].map(([key,label,level]) => Object.freeze({key:'erp.'+key,label,module:'ledger',level,description:label+'；制单与审核分离',default:false})));
const KEYS = new Set(CAPABILITIES.map(item=>item.key));
const UUID = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const REPORT_KEYS = Object.freeze(['asOf','from','to','partyId','kind','status','creatorId']);
const STATIC_FILES = Object.freeze(['erp.js','erp.css','app.css','workspace.css','xjy-theme.css','xjy-shell.js']);
const KIND_DOMAINS = Object.freeze({purchase:'purchase',receipt:'receipt',receivable:'bill',opening_receivable:'bill',opening_payable:'bill',settlement:'settlement',reversal:'reversal'});
function failure(message,status=400) { const error = new Error(message);error.status=status;return error; }
function isErpPath(value) {
  if(typeof value!=='string') return false;
  let pathname=value.split('?')[0];try{pathname=decodeURIComponent(pathname);}catch{}
  return pathname==='/erp'||pathname.startsWith('/erp/');
}
function routeFor(address,method='GET') {
  if(typeof address!=='string'||address.length>8192||!address.startsWith('/erp/')||/[\\\x00-\x20\x7f#]/.test(address))throw failure('ERP地址须为规范相对路径');
  const url=new URL(address,'http://127.0.0.1');
  if(url.pathname+url.search!==address||url.pathname.includes('%')||url.pathname.includes('//'))throw failure('ERP地址须为规范相对路径');
  method=String(method).toUpperCase();let operation,endpoint,parameters=[];
  if(url.pathname==='/erp/'&&method==='GET'){operation='read';endpoint='erp.page';}
  else if(STATIC_FILES.some(name=>url.pathname==='/erp/static/'+name)&&method==='GET'){operation='read';endpoint='erp.static';}
  else if(url.pathname==='/erp/api/bootstrap'&&method==='GET'){operation='read';endpoint='erp.bootstrap';}
  else if(url.pathname==='/erp/api/parties'&&['GET','POST'].includes(method)){operation=method==='GET'?'read':'parties';endpoint='erp.parties';}
  else if(url.pathname==='/erp/api/documents'&&method==='POST'){operation='create';endpoint='erp.create';}
  else if(new RegExp('^/erp/api/documents/'+UUID+'$').test(url.pathname)&&['GET','PATCH'].includes(method)){operation=method==='GET'?'read':'edit';endpoint=method==='GET'?'erp.document':'erp.update';}
  else if(new RegExp('^/erp/api/documents/'+UUID+'/submit$').test(url.pathname)&&method==='POST'){operation='submit';endpoint='erp.submit';}
  else if(new RegExp('^/erp/api/documents/'+UUID+'/review$').test(url.pathname)&&method==='POST'){operation='review';endpoint='erp.review';}
  else if(['/erp/api/reports','/erp/api/export.xlsx'].includes(url.pathname)&&method==='GET'){operation='report';endpoint=url.pathname.endsWith('xlsx')?'erp.export':'erp.reports';parameters=REPORT_KEYS;}
  else if(url.pathname==='/erp/api/attachments'&&method==='POST'){operation='attachment';endpoint='erp.upload';}
  else if(new RegExp('^/erp/api/attachments/'+UUID+'$').test(url.pathname)&&method==='GET'){operation='read';endpoint='erp.download';}
  else if(url.pathname==='/erp/api/ocr/capabilities'&&method==='GET'){operation='read';endpoint='erp.ocr_capabilities';}
  else if(url.pathname==='/erp/api/ocr/imports'&&method==='POST'){operation='ocr';endpoint='erp.ocr_import';}
  else if(new RegExp('^/erp/api/ocr/imports/'+UUID+'$').test(url.pathname)&&method==='GET'){operation='ocr';endpoint='erp.ocr_get';}
  else if(new RegExp('^/erp/api/ocr/imports/'+UUID+'/draft$').test(url.pathname)&&method==='POST'){operation='ocr';endpoint='erp.ocr_draft';}
  else throw failure('ERP操作地址或方法不在允许范围');
  const seen=new Set();for(const [key,value]of url.searchParams){if(!parameters.includes(key)||seen.has(key)||value.length>300||/[\x00-\x1f\x7f]/.test(value))throw failure('ERP查询参数无效');seen.add(key);}
  return {path:address,method,operation,endpoint,parameters};
}
function capabilitiesFor(grants) {
  const level=LEVELS.indexOf(grants?.moduleAccess?.ledger);
  return CAPABILITIES.filter(item=>level>=LEVELS.indexOf(item.level)&&grants?.capabilities?.[item.key]===true).map(item=>item.key);
}
function validateCapabilities(actor) {
  if(actor?.protocolVersion!==2||!Array.isArray(actor.capabilities)||actor.capabilities.length>CAPABILITIES.length||new Set(actor.capabilities).size!==actor.capabilities.length||actor.capabilities.some(key=>typeof key!=='string'||!KEYS.has(key)))throw failure('ERP签名权限无效',403);
  const level=LEVELS.indexOf(actor.access);
  if(actor.capabilities.some(key=>level<LEVELS.indexOf(CAPABILITIES.find(item=>item.key===key).level)))throw failure('ERP权限超出模块级别',403);
  if(!actor.capabilities.includes('erp.read'))throw failure('管理员尚未授权财务 ERP 查看',403);
  return actor.capabilities;
}
function requestBody(input,route) {
  if(route.method==='GET'){
    if(input.bodyBase64!==undefined&&input.bodyBase64!=='')throw failure('ERP读取请求不能携带正文');
    return {};
  }
  const headers=input.headers||{},type=Object.entries(headers).find(([key])=>key.toLowerCase()==='content-type')?.[1];
  if(type!=='application/json')throw failure('ERP写入只接受JSON正文');
  const encoded=input.bodyBase64;
  if(typeof encoded!=='string'||encoded.length>16*1024*1024||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))throw failure('ERP正文编码无效');
  let body;try{body=JSON.parse(Buffer.from(encoded,'base64').toString('utf8'));}catch{throw failure('ERP正文JSON无效');}
  if(!body||typeof body!=='object'||Array.isArray(body))throw failure('ERP正文须为对象');
  return body;
}
function authorizeRequest(input,grants) {
  const route=routeFor(input.path,input.method||'GET');
  if(input.module!=='ledger')throw failure('财务 ERP 仅属于财务模块',403);
  const capabilities=capabilitiesFor(grants),allowed=new Set(capabilities),body=requestBody(input,route);
  function requireKey(key){if(!allowed.has(key))throw failure('管理员尚未授权此ERP操作能力',403);}
  requireKey('erp.read');
  if(route.operation==='parties')requireKey('erp.parties.manage');
  if(route.operation==='attachment')requireKey('erp.attachments.write');
  if(route.operation==='report')requireKey('erp.reports.view');
  if(route.operation==='ocr'){requireKey('erp.purchase.prepare');requireKey('erp.attachments.write');requireKey('erp.reports.sensitive');}
  if(['create','edit','submit','review'].includes(route.operation)){
    const stage=route.operation==='review'?'review':'prepare',domain=KIND_DOMAINS[body.kind];
    if(route.operation==='create'&&!domain)throw failure('ERP单据类型无效');
    if(body.kind!==undefined&&!domain)throw failure('ERP单据类型无效');
    if(domain)requireKey('erp.'+domain+'.'+stage);
    // Existing document kind is resolved from ledger.db by the signed Python
    // endpoint. This coarse check cannot replace its exact kind/target check.
    else if(!Object.values(KIND_DOMAINS).some(name=>allowed.has('erp.'+name+'.'+stage)))throw failure('管理员尚未授权ERP制单或审核',403);
    if(['purchase','receipt','opening_payable'].includes(body.kind)||body.kind==='settlement'&&body.direction==='pay')requireKey('erp.reports.sensitive');
  }
  return {route,capabilities};
}
module.exports={CAPABILITIES,REPORT_KEYS,STATIC_FILES,isErpPath,routeFor,capabilitiesFor,validateCapabilities,authorizeRequest};

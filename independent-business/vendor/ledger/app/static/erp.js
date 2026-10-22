'use strict';
(function () {
  const kindNames = {purchase:'采购订单',receipt:'收货验收',receivable:'应收确认',opening_receivable:'期初应收',opening_payable:'期初应付',settlement:'收付款核销',reversal:'冲销申请'};
  const statusNames = {draft:'草稿',pending:'待审核',confirmed:'已确认',rejected:'已退回',reversed:'已冲销'};
  const MAX_CENTS = 9000000000000n;
  function moneyCents(value) {
    const text = String(value ?? '').trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new Error('金额请填写非负数字，最多两位小数');
    const [whole,fraction = ''] = text.split('.');
    const result = BigInt(whole) * 100n + BigInt(fraction.padEnd(2,'0'));
    if (result > MAX_CENTS) throw new Error('金额超出允许范围');
    return result;
  }
  function centsText(value) {
    const integer = typeof value === 'bigint' ? value : BigInt(value);
    const negative = integer < 0n,absolute = negative ? -integer : integer;
    return (negative ? '-' : '') + absolute / 100n + '.' + String(absolute % 100n).padStart(2,'0');
  }
  function weightText(value) {
    const text = String(value ?? '').trim();
    if (!/^\d{1,9}(?:\.\d{1,4})?$/.test(text) || Number(text)>100000000) throw new Error('克重请填写非负数字，最多四位小数且不超过一亿克');
    return text;
  }
  function positiveQuantity(value) {
    const text = String(value ?? '').trim();
    if (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text)) || Number(text) < 1 || Number(text)>1000000) throw new Error('件数须为 1 至 1000000 的整数');
    return Number(text);
  }
  function allocationSummary(amount,allocations) {
    const total = allocations.reduce((sum,row) => sum + moneyCents(row.amount),0n);
    return {total,difference:moneyCents(amount) - total};
  }
  function hasCapability(actor,name) { return (actor?.capabilities || []).includes(name); }
  function documentCapability(kind,action) {
    return 'erp.' + ({purchase:'purchase',receipt:'receipt',receivable:'bill',opening_receivable:'bill',opening_payable:'bill',settlement:'settlement',reversal:'reversal'}[kind] || 'unknown') + '.' + action;
  }
  function sensitiveDocument(doc) {
    return ['purchase','receipt','opening_payable'].includes(doc.kind) || (doc.kind === 'settlement' && doc.payload?.direction === 'pay');
  }
  function canReview(actor,doc) {
    return doc.status === 'pending' && String(doc.authorId) !== String(actor?.staffId) && hasCapability(actor,documentCapability(doc.kind,'review')) && (!(sensitiveDocument(doc) || doc.redacted || doc.sensitiveTarget) || hasCapability(actor,'erp.reports.sensitive'));
  }
  function remainingQuantity(purchase,lineId,documents) {
    const source = (purchase.lines || []).find(line => line.id === lineId);
    if (!source) return 0;
    if (Number.isSafeInteger(source.remainingQuantity) && source.remainingQuantity >= 0) return source.remainingQuantity;
    const received = documents.filter(doc => doc.kind === 'receipt' && doc.status === 'confirmed' && (doc.payload?.sourceId || doc.sourceId) === purchase.id)
      .reduce((sum,doc) => sum + (doc.lines || doc.payload?.lines || []).filter(line => line.purchaseLineId === lineId).reduce((count,line) => count + Number(line.quantity || 0),0),0);
    return Math.max(0,Number(source.quantity) - received);
  }
  function documentPayload(kind,value) {
    if (!kindNames[kind]) throw new Error('未知单据种类');
    const payload = {requestId:value.requestId,kind,partyId:value.partyId,date:value.date,note:String(value.note || ''),attachments:value.attachments || []};
    if (kind === 'purchase') {
      payload.businessType=value.businessType;payload.dueDate=value.dueDate;
      payload.lines=(value.lines || []).map(row=>({description:String(row.description || '').trim(),material:String(row.material || '').trim(),purity:String(row.purity || '').trim(),quantity:positiveQuantity(row.quantity),estimatedWeight:weightText(row.estimatedWeight),amount:centsText(moneyCents(row.amount))}));
      if (!payload.lines.length || payload.lines.some(row => !row.description)) throw new Error('请至少填写一件采购商品及品名');
    } else if (kind === 'receipt') {
      payload.sourceId=value.sourceId;payload.dueDate=value.dueDate;
      payload.lines=(value.lines || []).map(row=>({purchaseLineId:row.purchaseLineId,quantity:positiveQuantity(row.quantity),actualWeight:weightText(row.actualWeight),amount:centsText(moneyCents(row.amount))}));
      if (!payload.lines.length) throw new Error('请至少填写一条本次验收明细');
    } else if (kind === 'settlement') {
      payload.direction=value.direction;payload.amount=centsText(moneyCents(value.amount));payload.account=String(value.account || '').trim();
      payload.allocations=(value.allocations || []).map(row=>({billId:row.billId,amount:centsText(moneyCents(row.amount))}));
      if (!payload.account) throw new Error('请填写资金账户');
      if (!payload.allocations.length || allocationSummary(payload.amount,payload.allocations).difference !== 0n) throw new Error('核销金额合计须与本次收付款金额一致');
    } else if (kind === 'reversal') {
      payload.targetId=value.targetId;
      if (!payload.note.trim()) throw new Error('冲销必须说明原因');
    } else {
      payload.amount=centsText(moneyCents(value.amount));payload.dueDate=value.dueDate;
      if (kind==='receivable' && value.sourceSaleId !== '' && value.sourceSaleId != null) {const sourceId=Number(value.sourceSaleId);if(!/^\d+$/.test(String(value.sourceSaleId)) || !Number.isSafeInteger(sourceId) || sourceId<1)throw new Error('销售行 ID 须为正整数');payload.sourceSaleId=sourceId;}
      if (kind.startsWith('opening_')) {payload.evidence=String(value.evidence || '').trim();if (!payload.evidence) throw new Error('期初欠款必须填写依据');}
    }
    return payload;
  }
  function editableValues(doc) {
    const payload=doc.payload || {},result={...payload,kind:doc.kind,partyId:doc.partyId,date:doc.date,note:doc.note || payload.note || ''};
    if(payload.amountCents!=null)result.amount=centsText(payload.amountCents);
    if(payload.lines || doc.lines)result.lines=(payload.lines || doc.lines).map(line=>({...line,...(line.amountCents!=null?{amount:centsText(line.amountCents)}:{})}));
    if(payload.allocations)result.allocations=payload.allocations.map(row=>({...row,...(row.amountCents!=null?{amount:centsText(row.amountCents)}:{})}));
    return result;
  }
  function detailWeights(kind,line) {
    function scaled(value) {
      const text=String(value ?? '').trim();if(!/^\d+(?:\.\d{1,4})?$/.test(text))return null;
      const [whole,fraction='']=text.split('.');return BigInt(whole)*10000n+BigInt(fraction.padEnd(4,'0'));
    }
    function fixed(value,explicitPositive=false) {
      if(value==null)return '—';const negative=value<0n,absolute=negative?-value:value;
      return (negative?'-':explicitPositive&&value>0n?'+':'')+absolute/10000n+'.'+String(absolute%10000n).padStart(4,'0');
    }
    const estimate=scaled(line.estimatedWeight),actual=kind==='purchase'?null:scaled(line.actualWeight);
    return {estimated:fixed(estimate),actual:fixed(actual),difference:estimate==null || actual==null?'—':fixed(actual-estimate,true)};
  }
  function sourceSnapshotRows(payload) {
    if(!payload.sourceSaleId)return null;
    const snapshot=payload.sourceSnapshot,rows=[['原财务销售行 ID',String(payload.sourceSaleId)]];
    if(!snapshot || typeof snapshot!=='object')return {rows,warning:'旧记录未保存来源快照，仅保留来源行 ID。'};
    for(const [key,label,suffix] of [['date','原销售日期',''],['product','商品',''],['status','原成交状态',''],['weight','原克重',' g'],['sell_gram_price','原每克金价',' 元/g'],['labor','原工费',' 元'],['amount_c','原收入金额',' 元'],['received','原已到账',' 元']])rows.push([label,snapshot[key]==null || snapshot[key]===''?'未保存':String(snapshot[key])+suffix]);
    return {rows,warning:'以上为制单时保存的原财务来源。本单欠款金额由财务人工确认。'};
  }
  function ocrDraftPayload(job,input) {
    if(!job || !['ready','draft'].includes(job.status) || !/^[a-f0-9]{64}$/.test(job.imageHash || '') || !/^[a-f0-9]{64}$/.test(job.resultHash || ''))throw new Error('识别结果尚未就绪，请重新读取原图记录');
    if(!input.headerReviewed || String(input.headerReason || '').trim().length<3)throw new Error('请核对供应商、日期、采购类型和合计，并填写核对说明');
    const candidates=job.candidates || {},original=new Map((candidates.rows || []).map(row=>[row.id,row])),decisions=[];
    const reason=String(input.headerReason).trim();
    function decision(path,value,before,why,optional=false){if(value===before && before!=null)decisions.push({path,action:'accept',reason:''});else if(optional && (value==null || value===''))decisions.push({path,action:'omit',reason:why || '原图未列此项，人工确认保留未知'});else{if(String(why || '').trim().length<3)throw new Error('模糊或改动字段须填写对照原图的修正说明：'+path);decisions.push({path,action:'manual',reason:String(why).trim()});}}
    decision('supplier',input.supplierName,candidates.supplierName,reason);decision('date',input.date,candidates.date,reason);decision('businessType',input.businessType,null,reason);
    if(!['own','consignment'].includes(input.businessType))throw new Error('请明确选择采购类型');
    const rows=(input.rows || []).map(row=>{
      if(!row.reviewed)throw new Error('请逐行核对并确认所有明细');
      const old=original.get(row.rowId) || {},line={rowId:row.rowId,description:String(row.description || '').trim(),material:String(row.material || '').trim(),purity:String(row.purity || '').trim(),quantity:positiveQuantity(row.quantity),estimatedWeight:weightText(row.estimatedWeight),amount:centsText(moneyCents(row.amount)),unitPrice:row.unitPrice==null || row.unitPrice===''?null:String(row.unitPrice).trim(),priceBasis:row.priceBasis || null};
      if(!line.description)throw new Error('请填写采购品名');
      if(line.unitPrice!==null && !/^\d+(?:\.\d{1,4})?$/.test(line.unitPrice))throw new Error('识别单价须是已核对的十进制数字');
      if(![null,'per_gram','per_piece'].includes(line.priceBasis))throw new Error('请核对单价单位');
      for(const key of ['description','material','purity','quantity','estimatedWeight','amount','unitPrice','priceBasis'])decision('rows.'+row.rowId+'.'+key,line[key],old[key],row.reason,['material','purity','unitPrice','priceBasis'].includes(key));
      return line;
    });
    if(!rows.length || rows.length>100)throw new Error('请核对1至100条采购明细');
    const total=centsText(moneyCents(input.confirmedTotal)),sum=rows.reduce((value,row)=>value+moneyCents(row.amount),0n);if(moneyCents(total)!==sum)throw new Error('人工确认合计与逐行金额不一致');
    decision('total',total,candidates.invoiceTotal,reason);
    if(candidates.invoiceTotal!=null && total!==candidates.invoiceTotal && String(input.totalDifferenceReason || '').trim().length<3)throw new Error('合计与原图不同，请填写差异原因');
    return {requestId:input.requestId,imageHash:job.imageHash,resultHash:job.resultHash,document:{partyId:input.partyId,businessType:input.businessType,date:input.date,dueDate:input.dueDate,note:String(input.note || ''),lines:rows},review:{decisions,confirmedTotal:total,totalDifferenceReason:String(input.totalDifferenceReason || ''),omittedRows:input.omittedRows || []}};
  }
  const PRINT_UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  function printDate(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number(value.slice(0,4))<1||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)throw new Error('打印报表日期无效，请重新查询');return value;}
  function printReportFilters(value){const allowed=['asOf','from','to','partyId','kind','status','creatorId'];if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!allowed.includes(key)))throw new Error('打印报表筛选无效，请重新查询');const result={};for(const key of allowed){const item=value[key];if(item===undefined||item==='')continue;if(typeof item!=='string'||item.length>300||/[\x00-\x1f\x7f]/.test(item))throw new Error('打印报表筛选无效');if(['asOf','from','to'].includes(key))printDate(item);else if(key==='partyId'&&!/^SUP:[1-9][0-9]{0,18}$/.test(item)&&!(item.startsWith('CUS:')&&PRINT_UUID.test(item.slice(4))))throw new Error('打印报表往来单位无效');else if(key==='kind'&&!['purchase','receipt','receivable','payable','opening_receivable','opening_payable','settlement','reversal'].includes(item))throw new Error('打印报表单据类型无效');else if(key==='status'&&!Object.hasOwn(statusNames,item))throw new Error('打印报表状态无效');else if(key==='creatorId'&&!/^[A-Za-z0-9_-]{1,100}$/.test(item))throw new Error('打印报表制单人无效');result[key]=item;}if(!result.asOf||result.from&&(result.from>(result.to||result.asOf)||result.from>result.asOf))throw new Error('打印报表须有实际截至日与有效日期范围');return result;}
  function erpDocumentPrintSource(doc,actor,expectedId){if(!hasCapability(actor,'erp.read'))throw new Error('没有财务单据查看权限');if(!doc||!PRINT_UUID.test(doc.id||'')||!Object.hasOwn(kindNames,doc.kind))throw new Error('请先打开已有单据详情，再提交打印');if(expectedId!==undefined&&doc.id!==expectedId)throw new Error('单据来源已改变，请重新打开详情');if(doc.redacted)throw new Error('当前单据信息被遮蔽，请先核对查看授权');if((sensitiveDocument(doc)||doc.sensitiveTarget)&&!hasCapability(actor,'erp.reports.sensitive'))throw new Error('打印采购或应付单据须有敏感金额授权');return{type:'erp-document-a4',id:doc.id};}
  function erpReportPrintSource(report,actor,currentFilters){if(!hasCapability(actor,'erp.read')||!hasCapability(actor,'erp.reports.view'))throw new Error('没有财务报表查看权限');if(!report||!report.filters)throw new Error('请先查询报表，再提交打印');const filters=printReportFilters(report.filters);if(printDate(report.asOf)!==filters.asOf)throw new Error('报表截至日与已加载筛选不同，请重新查询');if(currentFilters!==undefined&&JSON.stringify(printReportFilters(currentFilters))!==JSON.stringify(filters))throw new Error('筛选已有修改，请先查询报表后再打印');return{type:'erp-report-a4',filters};}
  async function requestErpPrint(bridge,source){if(!bridge||typeof bridge.print!=='function')throw new Error('当前入口没有接入主机统一打印，请从工作台打开');if(!source||typeof source!=='object'||Array.isArray(source)||!['erp-document-a4','erp-report-a4'].includes(source.type)||Object.keys(source).some(key=>!(source.type==='erp-document-a4'?['type','id']:['type','filters']).includes(key)))throw new Error('财务打印来源无效');const typed=source.type==='erp-document-a4'?{type:source.type,id:source.id}:{type:source.type,filters:printReportFilters(source.filters)};if(typed.type==='erp-document-a4'&&!PRINT_UUID.test(typed.id||''))throw new Error('财务单据编号无效');const result=await bridge.print(typed);if(result?.ok!==true)throw new Error(result?.error||'主机打印入口未能打开，请核对后重试');return result;}
  const helpers = {moneyCents,centsText,allocationSummary,canReview,remainingQuantity,documentPayload,editableValues,detailWeights,sourceSnapshotRows,ocrDraftPayload,erpDocumentPrintSource,erpReportPrintSource,requestErpPrint};
  if (typeof module !== 'undefined' && module.exports) module.exports=helpers;
  if (typeof document === 'undefined') return;

  const $ = id => document.getElementById(id);
  if (!$('erp-app')) return;
  const state = {csrf:'',actor:null,parties:[],documents:[],bills:[],accounts:[],attachments:new Map(),editing:new Map(),requests:new Map(),report:null,busy:0,ocr:null,ocrOmitted:[],printDocument:null,printing:false};
  const n = (tag,text,className) => {const node=document.createElement(tag);if(text != null)node.textContent=String(text);if(className)node.className=className;return node;};
  const currency = cents => cents == null ? '—' : '¥ ' + centsText(cents).replace(/\B(?=(\d{3})+(?!\d))/g,',');
  const cap = name => hasCapability(state.actor,name);
  const message = (text,error=false) => {const target=$('erp-status');target.textContent=text;target.classList.toggle('error',error);target.hidden=!text;};
  const today = () => {const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(part=>[part.type,part.value]));return parts.year+'-'+parts.month+'-'+parts.day;};
  const fieldValue = (form,name) => form.elements.namedItem(name)?.value ?? '';
  const appendCell = (row,value) => {const cell=n('td');if(value instanceof Node)cell.append(value);else cell.textContent=String(value ?? '—');row.append(cell);return cell;};
  const emptyRow = (tbody,columns,text) => {const row=n('tr'),cell=n('td',text,'erp-empty');cell.colSpan=columns;row.append(cell);tbody.append(row);};
  const statusPill = doc => n('span',statusNames[doc.status] || doc.status,'erp-pill ' + doc.status);
  const actionButton = (text,callback,cls='secondary') => {const button=n('button',text,cls);button.type='button';button.addEventListener('click',()=>Promise.resolve().then(callback).catch(error=>message(error.message,true)));return button;};
  function permitted(kind,action='prepare') {return cap(documentCapability(kind,action)) && (!sensitiveDocument({kind,payload:{direction:fieldValue($('settlement-form'),'direction')}}) || cap('erp.reports.sensitive'));}
  async function api(path,body,method) {
    const response=await fetch(path,{credentials:'same-origin',method:method || (body?'POST':'GET'),headers:body?{'content-type':'application/json','x-xjy-csrf':state.csrf}:{},...(body?{body:JSON.stringify(body)}:{})});
    let data;try {data=await response.json();} catch {throw new Error('服务返回异常，请刷新后重试');}
    if (!response.ok || data.ok === false) {
      if (response.status === 401) {clearProtected();throw new Error('登录已失效，请返回工作台重新登录');}
      if (response.status === 403) {clearProtected();throw new Error(data.error || '操作权限已被拒绝，请刷新核对权限');}
      if (response.status === 409) throw new Error((data.error || '数据已更新') + '。请刷新核对，不要重复点击。');
      throw new Error(data.error || '操作未完成（' + response.status + '）');
    }
    return data;
  }
  function clearProtected() {
    clearOcrReview();
    state.actor=null;state.parties=[];state.documents=[];state.bills=[];state.report=null;state.printDocument=null;state.attachments.clear();state.editing.clear();state.requests.clear();
    for(const target of document.querySelectorAll('[data-protected-list]'))target.replaceChildren();
    for(const form of document.querySelectorAll('.erp-form')){form.reset();for(const input of form.querySelectorAll('input,select,button,textarea'))input.disabled=true;}
    for(const panel of document.querySelectorAll('[data-erp-panel]'))panel.hidden=true;
    for(const button of document.querySelectorAll('[data-erp-tab]'))button.disabled=true;
    if($('document-dialog').open)$('document-dialog').close();
    $('erp-actor').textContent='请重新登录';
  }
  async function transaction(task) {
    state.busy++;const buttons=[...document.querySelectorAll('[data-write-action]')];buttons.forEach(button=>button.disabled=true);
    try {await task();} finally {state.busy--;applyPermissions();}
  }
  async function loadData() {
    const result=await api('/erp/api/bootstrap');
    state.actor=result.actor;state.parties=result.parties || [];state.documents=result.documents || [];state.bills=result.bills || [];state.accounts=result.accounts || [];
    for(const form of document.querySelectorAll('.erp-form'))for(const control of form.querySelectorAll('input,select,button,textarea'))control.disabled=false;
    $('party-kind').disabled=state.editing.has('party');
    for(const form of document.querySelectorAll('.erp-document-form'))renderAttachments(form);
    $('erp-actor').textContent=result.actor.name;
    renderParties();renderDocuments();renderBills();renderOverview();updateSelectors();applyPermissions();
    document.querySelectorAll('[data-erp-tab]').forEach(button=>button.disabled=button.dataset.requires?!cap(button.dataset.requires):false);
    if(!document.querySelector('[data-erp-panel]:not([hidden])'))activatePanel('overview');
  }
  function activatePanel(name,keepMenu=false) {
    for(const panel of document.querySelectorAll('[data-erp-panel]'))panel.hidden=panel.dataset.erpPanel!==name;
    for(const button of document.querySelectorAll('[data-erp-tab]')){const active=button.dataset.erpTab===name;button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;}
    if(!keepMenu && window.matchMedia('(max-width:900px)').matches && document.querySelector('[data-module-nav]')?.classList.contains('open')){document.querySelector('[data-menu-toggle]')?.click();const heading=document.querySelector('[data-erp-panel="'+name+'"] h2');if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}}
    if(name==='reports' && cap('erp.reports.view') && !state.report)loadReport().catch(error=>message(error.message,true));
  }
  function applyPermissions() {
    document.querySelectorAll('[data-requires]').forEach(element => {
      const permitted=element.dataset.requires.split(' ').every(cap);
      if(element.tagName==='BUTTON')element.disabled=!permitted || Boolean(state.busy);
      else element.hidden=!permitted;
    });
    for(const [id,kind] of [['purchase-form','purchase'],['receipt-form','receipt'],['bill-form',fieldValue($('bill-form'),'kind')],['settlement-form','settlement'],['reversal-form','reversal']]) {
      const form=$(id),allowed=permitted(kind);
      for(const button of form.querySelectorAll('[data-write-action]'))button.disabled=!allowed || Boolean(state.busy);
      form.querySelector('.erp-permission-hint').textContent=allowed?'': '当前账号没有此类制单权限。';
    }
    for(const input of document.querySelectorAll('[data-attachment-input]'))input.disabled=!cap('erp.attachments.write') || Boolean(state.busy);
    const ocrAllowed=['erp.read','erp.purchase.prepare','erp.attachments.write','erp.reports.sensitive'].every(cap);
    if(!ocrAllowed && state.ocr)clearOcrReview();
    if($('ocr-recognize'))$('ocr-recognize').disabled=!ocrAllowed || Boolean(state.busy) || !$('ocr-source').value || state.editing.has('purchase-form');
    for(const element of document.querySelectorAll('[data-ocr-only]'))element.hidden=!state.ocr;
    document.querySelectorAll('[data-sensitive]').forEach(element=>element.hidden=!cap('erp.reports.sensitive'));
    for(const select of [$('bill-kind'),$('settlement-direction'),$('report-kind')]) {
      for(const option of select.options)if(option.dataset.sensitive)option.disabled=!cap('erp.reports.sensitive');
      if(select.selectedOptions[0]?.disabled)select.selectedIndex=0;
    }
    $('party-save').disabled=!cap('erp.parties.manage') || Boolean(state.busy);
    updatePrintButtons();
  }
  function optionSelect(select,rows,placeholder,labelFn) {
    const previous=select.value;select.replaceChildren();const blank=n('option',placeholder);blank.value='';select.append(blank);
    for(const row of rows){const option=n('option',labelFn(row));option.value=row.id;select.append(option);}
    if(rows.some(row=>row.id===previous))select.value=previous;
  }
  function updateSelectors() {
    const receiptDraft=[...$('receipt-lines').querySelectorAll('[data-receipt-row]')].map(row=>({...Object.fromEntries([...row.querySelectorAll('[data-field]')].map(input=>[input.dataset.field,input.value])),purchaseLineId:row.dataset.lineId}));
    let allocationDraft=[];try{allocationDraft=allocations();}catch{}
    const active=state.parties.filter(party=>party.active!==false && party.active!==0);
    optionSelect($('purchase-party'),active.filter(party=>party.kind==='supplier'),'请选择供应商',party=>party.code+' · '+party.name);
    updateBillParties();updateSettlementParties();
    optionSelect($('receipt-source'),state.documents.filter(doc=>doc.kind==='purchase' && doc.status==='confirmed'),'请选择已确认采购单',doc=>doc.number+' · '+doc.partyName);
    optionSelect($('reversal-target'),state.documents.filter(doc=>doc.status==='confirmed'),'请选择已确认单据',doc=>doc.number+' · '+kindNames[doc.kind]+' · '+doc.partyName);
    optionSelect($('report-party'),state.parties,'全部往来单位',party=>party.code+' · '+party.name);
    const creators=[...new Map(state.documents.map(doc=>[String(doc.authorId),{id:String(doc.authorId),name:doc.authorName}])).values()];
    optionSelect($('report-creator'),creators,'全部制单人',actor=>actor.name || actor.id);
    $('account-options').replaceChildren(...state.accounts.map(account=>{const option=n('option');option.value=typeof account==='string'?account:account.name;return option;}));
    if($('receipt-source').value)renderReceiptLines(receiptDraft);
    if($('settlement-party').value)renderAllocations(allocationDraft);
  }
  function updateBillParties() {
    const supplier=fieldValue($('bill-form'),'kind')==='opening_payable';
    optionSelect($('bill-party'),state.parties.filter(party=>party.kind===(supplier?'supplier':'customer') && party.active!==false && party.active!==0),supplier?'请选择供应商':'请选择财务客户',party=>party.code+' · '+party.name);
    $('opening-evidence-field').hidden=!fieldValue($('bill-form'),'kind').startsWith('opening_');
    $('source-sale-field').hidden=fieldValue($('bill-form'),'kind')!=='receivable';
    $('bill-evidence').required=!$('opening-evidence-field').hidden;
    applyPermissions();
  }
  function updateSettlementParties() {
    const payable=fieldValue($('settlement-form'),'direction')==='pay';
    optionSelect($('settlement-party'),state.parties.filter(party=>party.kind===(payable?'supplier':'customer') && party.active!==false && party.active!==0),payable?'请选择付款供应商':'请选择收款客户',party=>party.code+' · '+party.name);
    renderAllocations();applyPermissions();
  }
  function tableDocumentRows(tbody,documents,columns=7) {
    tbody.replaceChildren();if(!documents.length){emptyRow(tbody,columns,'暂无符合条件的单据');return;}
    for(const doc of documents){const row=n('tr');appendCell(row,doc.number);appendCell(row,kindNames[doc.kind]);appendCell(row,doc.partyName);appendCell(row,doc.date);appendCell(row,currency(doc.amountCents));appendCell(row,statusPill(doc));appendCell(row,actionButton('查看',()=>openDocument(doc.id)));tbody.append(row);}
  }
  function renderDocuments() {
    const search=$('document-search').value.trim().toLocaleLowerCase(),status=$('document-status').value;
    const matches=state.documents.filter(doc=>(!status || doc.status===status) && (!search || [doc.number,doc.partyName,doc.note,doc.authorName].join(' ').toLocaleLowerCase().includes(search)));
    tableDocumentRows($('documents-body'),matches);
    tableDocumentRows($('pending-body'),state.documents.filter(doc=>doc.status==='pending'));
    $('pending-count').textContent=String(state.documents.filter(doc=>doc.status==='pending').length);
  }
  function renderParties() {
    const tbody=$('parties-body'),search=$('party-search').value.trim().toLocaleLowerCase(),kind=$('party-filter').value;
    tbody.replaceChildren();const matches=state.parties.filter(party=>(!kind || party.kind===kind) && (!search || [party.name,party.code,party.contact,party.phone].join(' ').toLocaleLowerCase().includes(search)));
    if(!matches.length){emptyRow(tbody,7,'暂无往来单位，可先建立供应商或财务客户');return;}
    for(const party of matches){const row=n('tr');for(const value of [party.code,party.name,party.kind==='supplier'?'供应商':'财务客户',[party.contact,party.phone].filter(Boolean).join(' · '),String(party.termsDays || 0)+' 天',party.active===false || party.active===0?'已停用':'启用'])appendCell(row,value);const button=actionButton('编辑',()=>editParty(party));button.disabled=!cap('erp.parties.manage');appendCell(row,button);tbody.append(row);}
  }
  function renderBills() {
    const tbody=$('bills-body');tbody.replaceChildren();if(!state.bills.length){emptyRow(tbody,7,'暂无已确认的应收应付');return;}
    for(const bill of state.bills){const row=n('tr');for(const value of [bill.number,bill.kind==='payable'?'应付':'应收',bill.partyName,bill.dueDate,currency(bill.amountCents),currency(bill.settledCents),currency(bill.balanceCents)])appendCell(row,value);tbody.append(row);}
  }
  function renderOverview() {
    const sum = kind => state.bills.filter(bill=>bill.kind===kind).reduce((total,bill)=>total+BigInt(bill.balanceCents || 0),0n);
    $('overview-receivable').textContent=currency(sum('receivable'));
    $('overview-payable').textContent=cap('erp.reports.sensitive')?currency(sum('payable')):'需敏感数据授权';
    $('overview-pending').textContent=String(state.documents.filter(doc=>doc.status==='pending').length);
    $('overview-parties').textContent=String(state.parties.length);
    tableDocumentRows($('recent-body'),state.documents.slice(0,8));
  }
  function editParty(party) {
    const form=$('party-form');state.editing.set('party',party);
    for(const name of ['kind','name','contact','phone','termsDays','note'])form.elements.namedItem(name).value=party[name] ?? '';
    form.elements.namedItem('active').checked=party.active!==false && party.active!==0;
    $('party-form-title').textContent='编辑 '+party.name+' · '+party.code;$('party-cancel').hidden=false;
    $('party-kind').disabled=true;form.elements.namedItem('name').focus();
  }
  function resetParty() {state.editing.delete('party');state.requests.delete('party-form');$('party-form').reset();$('party-kind').disabled=false;$('party-form-title').textContent='新增往来单位';$('party-cancel').hidden=true;}
  function purchaseRow(value={}) {
    const row=n('tr');row.dataset.purchaseRow='';
    if(state.ocr)row.dataset.ocrRowId=value.id || 'manual-'+crypto.randomUUID();
    for(const [name,label,type,defaultValue] of [['description','品名','text',''],['material','材质','text',''],['purity','成色','text',''],['quantity','件数','number','1'],['estimatedWeight','估算克重','text','0'],['amount','约定金额','text','0.00']]) {
      const input=n('input');input.type=type;input.dataset.field=name;input.value=state.ocr?(value[name] ?? ''):(value[name] ?? defaultValue);input.setAttribute('aria-label',label);input.required=state.ocr?['description','quantity','estimatedWeight','amount'].includes(name):true;
      if(type==='number'){input.min='1';input.step='1';}else if(['estimatedWeight','amount'].includes(name))input.inputMode='decimal';
      input.addEventListener('input',purchaseTotal);appendCell(row,input);
    }
    if(state.ocr){const price=n('input');price.dataset.ocrPrice='';price.inputMode='decimal';price.value=value.unitPrice || '';price.setAttribute('aria-label','识别单价');appendCell(row,price);const basis=n('select');basis.dataset.ocrBasis='';for(const [v,label]of [['','原图单位未知'],['per_gram','元 / 克'],['per_piece','元 / 件']]){const option=n('option',label);option.value=v;basis.append(option);}basis.value=value.priceBasis || '';appendCell(row,basis);const review=n('div',undefined,'erp-ocr-row-review'),check=n('input');check.type='checkbox';check.dataset.ocrConfirmed='';const label=n('label','已对照原图核对本行');label.prepend(check);const reason=n('textarea');reason.dataset.ocrReason='';reason.rows=2;reason.maxLength=500;reason.placeholder='模糊字段、手工补填或改动，请说明核对结果';review.append(label,reason);appendCell(row,review);row.addEventListener('input',event=>{if(event.target!==check)check.checked=false;});}
    appendCell(row,actionButton('移除',()=>{if($('purchase-lines').children.length===1){message('至少保留一条采购明细',true);return;}if(state.ocr && state.ocr.candidates.rows.some(item=>item.id===row.dataset.ocrRowId)){const reason=window.prompt('请说明为何省略这条原图识别明细');if(!reason || reason.trim().length<3){message('省略识别明细须逐行填写核对说明',true);return;}state.ocrOmitted.push({rowId:row.dataset.ocrRowId,reason:reason.trim()});}row.remove();purchaseTotal();},'secondary erp-remove'));
    $('purchase-lines').append(row);purchaseTotal();
  }
  function lineValues(target,selector) {return [...target.querySelectorAll(selector)].map(row=>Object.fromEntries([...row.querySelectorAll('[data-field]')].map(input=>[input.dataset.field,input.value])));}
  function purchaseTotal() {try{$('purchase-total').textContent=currency(lineValues($('purchase-lines'),'[data-purchase-row]').reduce((sum,row)=>sum+moneyCents(row.amount),0n));}catch{$('purchase-total').textContent='金额待补全';}}
  function renderReceiptLines(savedLines) {
    const body=$('receipt-lines'),source=state.documents.find(doc=>doc.id===$('receipt-source').value);
    body.replaceChildren();$('receipt-party-name').textContent=source?source.partyName:'选择采购单后显示供应商';
    if(!source){emptyRow(body,7,'先选择一张已确认采购订单');return;}
    for(const line of source.lines || []) {
      const remaining=remainingQuantity(source,line.id,state.documents),saved=(savedLines || []).find(item=>item.purchaseLineId===line.id),row=n('tr');row.dataset.receiptRow='';row.dataset.lineId=line.id;
      appendCell(row,line.description);appendCell(row,String(line.quantity)+' 件');appendCell(row,String(remaining)+' 件');appendCell(row,String(line.estimatedWeight ?? '—')+' g');
      for(const [name,label,defaultValue] of [['quantity','本次件数','0'],['actualWeight','本次实收克重','0'],['amount','本次确认金额','0.00']]) {
        const input=n('input');input.dataset.field=name;input.value=saved?.[name] ?? defaultValue;input.setAttribute('aria-label',line.description+' · '+label);input.type=name==='quantity'?'number':'text';input.inputMode=name==='quantity'?'numeric':'decimal';
        if(name==='quantity'){input.min='0';input.max=String(remaining);input.step='1';}input.addEventListener('input',receiptTotal);appendCell(row,input);
      }
      body.append(row);
    }
    $('receipt-type-hint').textContent=source.payload?.businessType==='consignment'?'寄售采购：验收不会自动形成应付。':'自有采购：本次验收经另一人审核后形成一笔应付。';receiptTotal();
  }
  function receiptTotal() {try{$('receipt-total').textContent=currency(lineValues($('receipt-lines'),'[data-receipt-row]').filter(row=>Number(row.quantity)>0).reduce((sum,row)=>sum+moneyCents(row.amount),0n));}catch{$('receipt-total').textContent='金额待补全';}}
  function renderAllocations(savedAllocations) {
    const body=$('allocation-lines'),partyId=$('settlement-party').value,direction=$('settlement-direction').value;body.replaceChildren();
    const bills=state.bills.filter(bill=>bill.partyId===partyId && bill.kind===(direction==='pay'?'payable':'receivable') && Number(bill.balanceCents)>0);
    if(!bills.length){emptyRow(body,4,partyId?'该单位暂无未结单据':'选择往来单位后显示可核销明细');updateAllocationTotal();return;}
    for(const bill of bills) {const row=n('tr');row.dataset.billId=bill.id;appendCell(row,bill.number);appendCell(row,bill.dueDate);appendCell(row,currency(bill.balanceCents));const input=n('input');input.type='text';input.inputMode='decimal';input.dataset.allocation='';input.value=(savedAllocations || []).find(item=>item.billId===bill.id)?.amount || '0.00';input.setAttribute('aria-label',bill.number+' 本次核销金额');input.addEventListener('input',updateAllocationTotal);appendCell(row,input);body.append(row);}updateAllocationTotal();
  }
  function allocations() {return [...$('allocation-lines').querySelectorAll('[data-bill-id]')].map(row=>({billId:row.dataset.billId,amount:row.querySelector('input').value})).filter(row=>moneyCents(row.amount)>0n);}
  function updateAllocationTotal() {
    try {const result=allocationSummary(fieldValue($('settlement-form'),'amount') || '0',allocations());$('allocation-total').textContent=currency(result.total);$('allocation-difference').textContent=currency(result.difference);$('allocation-difference').classList.toggle('erp-danger',result.difference!==0n);}catch{$('allocation-total').textContent='金额待补全';$('allocation-difference').textContent='—';}
  }
  function nextRequest(id) {if(!state.requests.has(id))state.requests.set(id,crypto.randomUUID());return state.requests.get(id);}
  function values(form) {return Object.fromEntries(new FormData(form).entries());}
  function formKind(form) {return form.id==='bill-form'?fieldValue(form,'kind'):({ 'purchase-form':'purchase','receipt-form':'receipt','settlement-form':'settlement','reversal-form':'reversal'}[form.id]);}
  function resetDocumentForm(form) {
    if(form.id==='purchase-form')clearOcrReview();
    state.editing.delete(form.id);state.requests.delete(form.id);state.attachments.delete(form.id);form.reset();
    form.querySelectorAll('[data-date-default]').forEach(input=>input.value=today());form.querySelector('[data-editing-hint]').textContent='';form.querySelector('[data-cancel-edit]').hidden=true;renderAttachments(form);
    if(form.id==='purchase-form'){$('purchase-lines').replaceChildren();purchaseRow();}
    if(form.id==='receipt-form')renderReceiptLines();if(form.id==='bill-form')updateBillParties();if(form.id==='settlement-form'){updateSettlementParties();updateAllocationTotal();}
  }
  async function saveDocument(event) {
    event.preventDefault();const form=event.currentTarget,kind=formKind(form);if(!permitted(kind))throw new Error('当前账号没有此类制单权限');
    const value=values(form);value.requestId=nextRequest(form.id);value.attachments=(state.attachments.get(form.id) || []).map(item=>item.id);
    if(kind==='purchase')value.lines=lineValues($('purchase-lines'),'[data-purchase-row]');
    if(kind==='receipt') {const source=state.documents.find(doc=>doc.id===value.sourceId);if(!source)throw new Error('请选择已确认采购单');value.partyId=source.partyId;
      value.lines=[...$('receipt-lines').querySelectorAll('[data-receipt-row]')].map(row=>({...Object.fromEntries([...row.querySelectorAll('[data-field]')].map(input=>[input.dataset.field,input.value])),purchaseLineId:row.dataset.lineId})).filter(row=>Number(row.quantity)>0);
    }
    if(kind==='settlement')value.allocations=allocations();
    if(kind==='reversal'){const target=state.documents.find(doc=>doc.id===value.targetId);if(!target)throw new Error('请选择已确认的原单');value.partyId=target.partyId;}
    const payload=documentPayload(kind,value),editing=state.editing.get(form.id),submit=event.submitter?.dataset.submit==='true';
    if(form.id==='purchase-form' && state.ocr){if(submit)throw new Error('图片识别只保存采购草稿，之后按原流程提交与独立审核');await transaction(async()=>{const current=await api('/erp/api/ocr/imports/'+encodeURIComponent(state.ocr.jobId));state.ocr=current.job;const rows=[...$('purchase-lines').querySelectorAll('[data-purchase-row]')].map(row=>({...Object.fromEntries([...row.querySelectorAll('[data-field]')].map(input=>[input.dataset.field,input.value])),rowId:row.dataset.ocrRowId,unitPrice:row.querySelector('[data-ocr-price]')?.value || null,priceBasis:row.querySelector('[data-ocr-basis]')?.value || null,reviewed:row.querySelector('[data-ocr-confirmed]')?.checked===true,reason:row.querySelector('[data-ocr-reason]')?.value || ''}));const supplier=state.parties.find(item=>item.id===value.partyId);const request=ocrDraftPayload(state.ocr,{...value,requestId:nextRequest('ocr-'+state.ocr.jobId),supplierName:supplier?.name || '',rows,headerReviewed:$('ocr-header-confirm').checked,headerReason:$('ocr-header-reason').value,confirmedTotal:$('ocr-confirmed-total').value,totalDifferenceReason:$('ocr-total-difference').value,omittedRows:state.ocrOmitted});const result=await api('/erp/api/ocr/imports/'+encodeURIComponent(state.ocr.jobId)+'/draft',request);message('采购草稿已保存：'+result.document.number+'。尚未提交审核、形成应付或改变库存。');resetDocumentForm(form);await loadData();await openDocument(result.document.id);});return;}
    await transaction(async()=>{const result=editing?await api('/erp/api/documents/'+encodeURIComponent(editing.id),{...payload,revision:editing.revision},'PATCH'):await api('/erp/api/documents',payload);
      let doc=result.document;message('草稿已保存：'+doc.number);
      state.editing.set(form.id,doc);
      if(submit){doc=(await api('/erp/api/documents/'+encodeURIComponent(doc.id)+'/submit',{revision:doc.revision})).document;message('已提交审核：'+doc.number+'。确认后才影响余额。');}
      resetDocumentForm(form);await loadData();await openDocument(doc.id);
    });
  }
  function renderAttachments(form) {
    const target=form.querySelector('[data-attachment-list]');target.replaceChildren();
    for(const attachment of state.attachments.get(form.id) || []) {const item=n('div',undefined,'erp-attachment');const link=n('a',attachment.name || attachment.id);link.href='/erp/api/attachments/'+encodeURIComponent(attachment.id);link.target='_blank';link.rel='noopener';item.append(link,actionButton('移除',()=>{state.attachments.set(form.id,(state.attachments.get(form.id) || []).filter(value=>value.id!==attachment.id));renderAttachments(form);}));target.append(item);}
    if(form.id==='purchase-form' && $('ocr-source')){optionSelect($('ocr-source'),(state.attachments.get(form.id) || []).filter(item=>['image/png','image/jpeg'].includes(item.mime)),'请选择 PNG / JPEG 原图',item=>item.name || '供货单原图');applyPermissions();}
  }
  function clearOcrReview(){state.ocr=null;state.ocrOmitted=[];if($('ocr-review')){$('ocr-review').hidden=true;$('ocr-original-text').value='';$('ocr-original-image').removeAttribute('src');$('ocr-original-link').removeAttribute('href');$('ocr-header-confirm').checked=false;$('ocr-header-reason').value='';$('ocr-confirmed-total').value='';$('ocr-total-difference').value='';$('ocr-issues').textContent='';}for(const element of document.querySelectorAll('[data-ocr-only]'))element.hidden=true;}
  async function recognizePurchase(){if(!['erp.read','erp.purchase.prepare','erp.attachments.write','erp.reports.sensitive'].every(cap))throw new Error('识别供货单须有采购制单、上传和敏感金额权限');if(state.editing.has('purchase-form'))throw new Error('请先取消编辑，再新建图片识别草稿');const attachmentId=$('ocr-source').value;if(!attachmentId)throw new Error('请先上传并选择 PNG / JPEG 原图');await transaction(async()=>{clearOcrReview();const capability=await api('/erp/api/ocr/capabilities');if(!capability.ocr.available){$('ocr-availability').textContent=capability.ocr.reason || '主机中文识别不可用，可继续手工录入';throw new Error($('ocr-availability').textContent);}message('正在主机本地识别，图片不会发送到云端…');const response=await api('/erp/api/ocr/imports',{requestId:nextRequest('ocr-source-'+attachmentId),attachmentId});const result=await api('/erp/api/ocr/imports/'+encodeURIComponent(response.job.jobId));if(result.job.status!=='ready' && !result.job.documentId)throw new Error(result.job.error || '识别未完成，原凭证保留');if(result.job.documentId){message('这张原图已关联采购单，请在原单据中继续处理');await openDocument(result.job.documentId);return;}state.ocr=result.job;state.ocrOmitted=[];const form=$('purchase-form'),candidate=result.job.candidates;form.elements.namedItem('date').value=candidate.date || '';form.elements.namedItem('dueDate').value='';form.elements.namedItem('businessType').value='';const matches=state.parties.filter(item=>item.kind==='supplier' && item.active!==false && item.active!==0 && item.name===candidate.supplierName);form.elements.namedItem('partyId').value=matches.length===1?matches[0].id:'';$('purchase-lines').replaceChildren();for(const row of candidate.rows)purchaseRow(row);if(!candidate.rows.length)purchaseRow();$('ocr-original-text').value=result.job.raw.text;$('ocr-original-link').href='/erp/api/attachments/'+encodeURIComponent(result.job.attachmentId);$('ocr-original-image').src=$('ocr-original-link').href;$('ocr-confirmed-total').value=candidate.invoiceTotal || '';$('ocr-issues').textContent=(candidate.issues || []).join('；')+' 所有字段均需人工核对，系统没有可用的置信分数。';$('ocr-review').hidden=false;message('识别仅填入核对表，请补齐未知字段、逐行确认后保存采购草稿。');applyPermissions();});}
  async function uploadAttachment(input) {
    if(!cap('erp.attachments.write'))throw new Error('没有上传凭证权限');const file=input.files?.[0];if(!file)return;
    if(!['image/png','image/jpeg','application/pdf'].includes(file.type))throw new Error('凭证仅支持 PNG、JPEG 和 PDF');if(file.size>2*1024*1024)throw new Error('单个凭证最多 2MB');
    const form=input.closest('form');input.disabled=true;
    try {const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
      const result=await api('/erp/api/attachments',{requestId:crypto.randomUUID(),name:file.name,mime:file.type,bodyBase64:btoa(binary)});
      state.attachments.set(form.id,[...(state.attachments.get(form.id) || []),result.attachment]);renderAttachments(form);message('凭证已上传，保存单据后关联');
    }finally{input.value='';input.disabled=!cap('erp.attachments.write');}
  }
  function attachDetailValues(target,entries) {for(const [label,value] of entries){const item=n('div');item.append(n('dt',label),n('dd',value));target.append(item);}}
  async function openDocument(id) {
    const result=await api('/erp/api/documents/'+encodeURIComponent(id)),doc=result.document,dialog=$('document-dialog');
    $('detail-title').textContent=kindNames[doc.kind]+' · '+doc.number;$('detail-status').replaceChildren(statusPill(doc));
    const meta=$('detail-meta');meta.replaceChildren();attachDetailValues(meta,[['往来单位',doc.partyName],['业务日期',doc.date],['到期日',doc.dueDate || doc.payload?.dueDate || '—'],['金额',currency(doc.amountCents)],['制单人',doc.authorName],['复核人',doc.reviewerName || '尚未复核'],['备注',doc.note || '—']]);
    const sourceId=doc.payload?.sourceId || doc.payload?.targetId;if(sourceId)attachDetailValues(meta,[['关联原单',state.documents.find(item=>item.id===sourceId)?.number || sourceId]]);
    if(doc.payload?.businessType)attachDetailValues(meta,[['采购类型',doc.payload.businessType==='consignment'?'寄售 / 代卖':'自有采购']]);
    if(doc.payload?.account)attachDetailValues(meta,[['方向 / 账户',(doc.payload.direction==='pay'?'付款':'收款')+' · '+doc.payload.account]]);
    if(doc.payload?.evidence)attachDetailValues(meta,[['期初依据',doc.payload.evidence]]);
    const saleSource=sourceSnapshotRows(doc.payload || {}),saleMeta=$('detail-sale-meta');saleMeta.replaceChildren();$('detail-sale-source').hidden=!saleSource;
    if(saleSource){attachDetailValues(saleMeta,saleSource.rows);$('detail-sale-note').textContent=saleSource.warning;}else $('detail-sale-note').textContent='';
    const body=$('detail-lines');body.replaceChildren();
    for(const line of doc.lines || doc.payload?.lines || []) {
      const row=n('tr'),purchase=state.documents.find(item=>item.id===doc.payload?.sourceId),sourceLine=purchase?.lines?.find(item=>item.id===line.purchaseLineId),weights=detailWeights(doc.kind,line);
      for(const value of [line.description || sourceLine?.description || line.purchaseLineId,line.quantity,weights.estimated,weights.actual,weights.difference,line.amountCents!=null?currency(line.amountCents):line.amount!=null?'¥ '+line.amount:'—'])appendCell(row,value);body.append(row);
    }
    for(const allocation of doc.payload?.allocations || []){const row=n('tr'),bill=state.bills.find(item=>item.id===allocation.billId);for(const value of [bill?.number || allocation.billId,'核销','—','—','—',allocation.amountCents!=null?currency(allocation.amountCents):'¥ '+allocation.amount])appendCell(row,value);body.append(row);}
    $('detail-line-table').hidden=!body.children.length;
    $('detail-attachments').replaceChildren();for(const attachment of doc.payload?.attachments || []){const item=typeof attachment==='string'?{id:attachment}:attachment;const link=n('a',item.name || '查看凭证');link.href='/erp/api/attachments/'+encodeURIComponent(item.id);link.target='_blank';link.rel='noopener';$('detail-attachments').append(link);}
    for(const proof of doc.ocrEvidence || []){const details=n('details',undefined,'erp-ocr-evidence');details.append(n('summary','图片识别与人工核对记录'));if(!proof.valid)details.append(n('p',proof.error || '原识别依据异常，须人工核对完整原图'));else{details.append(n('h4','未改动的原识别文字'),n('pre',proof.rawText),n('h4','保存草稿时的核对明细'));const table=n('table'),body=n('tbody');for(const [index,line]of (proof.accepted?.document?.lines || []).entries()){const row=n('tr');appendCell(row,'第 '+(index+1)+' 行');appendCell(row,line.description);appendCell(row,String(line.quantity)+' 件');appendCell(row,line.estimatedWeight+' g');appendCell(row,line.amount+' 元');body.append(row);}table.append(body);details.append(table);const labels={supplier:'供应商',date:'日期',businessType:'采购类型',total:'单据合计',description:'品名',material:'材质',purity:'成色',quantity:'件数',estimatedWeight:'估算克重',amount:'行合计',unitPrice:'单价',priceBasis:'单价单位'};const list=n('ul');for(const decision of proof.accepted?.review?.decisions || []){const parts=decision.path.split('.'),label=parts[0]==='rows'?'明细 '+(labels[parts.at(-1)] || '字段'):(labels[decision.path] || '字段');list.append(n('li',label+'：'+({accept:'按原图确认',manual:'人工补填或修正',omit:'原图未列，保留未知'}[decision.action] || '已核对')+(decision.reason?'；'+decision.reason:'')));}details.append(list);} $('detail-attachments').append(details);}
    $('detail-events').replaceChildren();for(const event of doc.events || [])$('detail-events').append(n('li',[event.createdAt || event.created_at || event.at,event.actorName || event.actor_name || event.name,event.action || event.event || event.type,event.note].filter(Boolean).join(' · ')));
    const actions=$('detail-actions');actions.replaceChildren();$('review-note-field').hidden=true;state.printDocument=doc;
    const printButton=actionButton('提交主机打印（A4）',async()=>{const latest=await api('/erp/api/documents/'+encodeURIComponent(doc.id));await openErpPrint(erpDocumentPrintSource(latest.document,state.actor,doc.id));if(dialog.open)dialog.close();});printButton.id='print-document-a4';actions.append(printButton);
    if(['draft','rejected'].includes(doc.status) && String(doc.authorId)===String(state.actor.staffId) && permitted(doc.kind)) {
      actions.append(actionButton('编辑草稿',()=>{editDocument(doc);dialog.close();}));
      actions.append(actionButton('提交审核',()=>transaction(async()=>{await api('/erp/api/documents/'+encodeURIComponent(doc.id)+'/submit',{revision:doc.revision});message('已提交，等待另一人审核');await loadData();await openDocument(doc.id);}),''));
    }
    if(canReview(state.actor,doc)) {
      $('review-note-field').hidden=false;$('review-note').value='';
      for(const [decision,label] of [['approve','审核确认'],['reject','退回修改']])actions.append(actionButton(label,()=>transaction(async()=>{const note=$('review-note').value.trim();if(!note)throw new Error('请填写核对结果或退回原因');await api('/erp/api/documents/'+encodeURIComponent(doc.id)+'/review',{revision:doc.revision,hash:doc.hash,decision,note});message(decision==='approve'?'审核已确认并记录':'已退回，原因已记录');await loadData();await openDocument(doc.id);}),decision==='reject'?'secondary':''));
    } else if(doc.status==='pending')actions.append(n('p',String(doc.authorId)===String(state.actor.staffId)?'本单由你编制，需另一位获授权员工审核。':'当前账号没有此类复核权限。','erp-note'));
    if(doc.status==='confirmed' && permitted('reversal'))actions.append(actionButton('申请冲销',()=>{dialog.close();activatePanel('settlement');$('reversal-target').value=doc.id;$('reversal-form').elements.namedItem('note').focus();}));
    updatePrintButtons();if(!dialog.open)dialog.showModal();
  }
  function editDocument(doc) {
    const formId={purchase:'purchase-form',receipt:'receipt-form',receivable:'bill-form',opening_receivable:'bill-form',opening_payable:'bill-form',settlement:'settlement-form',reversal:'reversal-form'}[doc.kind],form=$(formId),payload=editableValues(doc);
    resetDocumentForm(form);state.editing.set(formId,doc);state.requests.set(formId,payload.requestId || crypto.randomUUID());
    for(const [key,value] of Object.entries({...payload,partyId:doc.partyId,date:doc.date,note:doc.note || payload.note || ''})) {const input=form.elements.namedItem(key);if(input && typeof value!=='object')input.value=value ?? '';}
    if(formId==='bill-form'){form.elements.namedItem('kind').value=doc.kind;updateBillParties();$('bill-party').value=doc.partyId;}
    if(formId==='purchase-form'){$('purchase-lines').replaceChildren();for(const line of payload.lines || doc.lines || [])purchaseRow(line);}
    if(formId==='receipt-form'){optionSelect($('receipt-source'),state.documents.filter(item=>item.kind==='purchase' && item.status==='confirmed'),'请选择已确认采购单',item=>item.number+' · '+item.partyName);$('receipt-source').value=payload.sourceId;renderReceiptLines(payload.lines || doc.lines);}
    if(formId==='settlement-form'){updateSettlementParties();$('settlement-party').value=doc.partyId;renderAllocations(payload.allocations);updateAllocationTotal();}
    state.attachments.set(formId,(payload.attachments || []).map(item=>typeof item==='string'?{id:item,name:'已关联凭证'}:item));renderAttachments(form);
    form.querySelector('[data-editing-hint]').textContent='正在编辑 '+doc.number+' · 版本 '+doc.revision;form.querySelector('[data-cancel-edit]').hidden=false;
    activatePanel(formId==='purchase-form'||formId==='receipt-form'?'purchase':formId==='bill-form'?'bills':'settlement');applyPermissions();form.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
  }
  function reportQuery() {const query=new URLSearchParams();for(const [key,value] of new FormData($('report-form')))if(value)query.set(key,String(value));return query.toString();}
  function currentReportFilters(){return Object.fromEntries(new FormData($('report-form')));}
  function updatePrintButtons(){for(const [id,source]of [['print-document-a4',()=>erpDocumentPrintSource(state.printDocument,state.actor)],['print-report-a4',()=>erpReportPrintSource(state.report,state.actor,currentReportFilters())]]){const button=$(id);if(!button)continue;let allowed=typeof window.xjyModulePrint?.print==='function',reason=allowed?'':'请从主机工作台打开统一打印入口';try{source();}catch(error){allowed=false;reason=error.message;}button.disabled=!allowed||Boolean(state.busy)||state.printing;button.title=reason;}}
  async function openErpPrint(source){if(state.printing)throw new Error('正在打开主机打印面板，请稍候');state.printing=true;updatePrintButtons();try{await requestErpPrint(window.xjyModulePrint,source);message('请在主机统一打印面板核对并提交');}finally{state.printing=false;updatePrintButtons();}}
  async function loadReport() {
    if(!cap('erp.reports.view'))throw new Error('没有报表查看权限');const result=await api('/erp/api/reports?'+reportQuery());state.report=result.report;renderReport();
  }
  function renderReport() {
    const report=state.report; $('report-asof-label').textContent='截至 '+report.asOf;
    for(const [id,key] of [['report-receivable','receivableCents'],['report-payable','payableCents'],['report-received','receivedCents'],['report-paid','paidCents']])$(id).textContent=currency(report.totals?.[key]);
    $('report-receivable-count').textContent=String(report.totals?.receivableCount ?? (report.rows || []).filter(row=>row.kind==='receivable').length)+' 笔应收记录';
    $('report-payable-count').textContent=String(report.totals?.payableCount ?? (report.rows || []).filter(row=>row.kind==='payable').length)+' 笔应付记录';
    const body=$('report-bills');body.replaceChildren();for(const row of report.rows || []){const tr=n('tr');for(const value of [row.number,row.kind==='payable'?'应付':'应收',row.partyName,row.date,row.dueDate,currency(row.amountCents),currency(row.settledCents),currency(row.balanceCents)])appendCell(tr,value);body.append(tr);}if(!body.children.length)emptyRow(body,8,'当前筛选没有往来余额明细');
    const cash=$('report-cash');cash.replaceChildren();for(const row of report.cash || []){const tr=n('tr');for(const value of [row.number,row.date,row.direction==='pay'?'付款':'收款',row.partyName,row.account,currency(row.amountCents),row.note])appendCell(tr,value);cash.append(tr);}if(!cash.children.length)emptyRow(cash,7,'当前筛选没有已确认资金记录');
    tableDocumentRows($('report-purchase'),report.purchase || []);
    updatePrintButtons();const aging=$('aging-chart');aging.replaceChildren();const maxima=(report.aging || []).map(row=>Math.max(Number(row.receivableCents || 0),cap('erp.reports.sensitive')?Number(row.payableCents || 0):0)),max=Math.max(1,...maxima);
    for(const row of report.aging || []){const item=n('div',undefined,'erp-aging-row');item.append(n('div',row.label,'erp-aging-label'));const bars=n('div',undefined,'erp-aging-bars');for(const [key,label,className] of [['receivableCents','应收','receivable'],['payableCents','应付','payable']]){if(key==='payableCents'&&!cap('erp.reports.sensitive'))continue;const line=n('div',undefined,'erp-aging-line'),bar=n('meter',undefined,'erp-aging-bar '+className);bar.min=0;bar.max=max;bar.value=Math.max(0,Number(row[key] || 0));bar.setAttribute('aria-label',row.label+' '+label+' '+currency(row[key] || 0));line.append(n('span',label),bar,n('strong',currency(row[key] || 0)));bars.append(line);}item.append(bars);aging.append(item);}if(!aging.children.length)aging.append(n('p','当前筛选没有账龄数据','erp-note'));
  }
  async function exportReport() {
    if(!cap('erp.reports.view'))throw new Error('没有报表导出权限');
    // Keep the protected HTTP download within this click's user gesture.
    const link=n('a');link.href='/erp/api/export.xlsx?'+reportQuery();link.download='财务往来报表-'+fieldValue($('report-form'),'asOf')+'.xlsx';link.hidden=true;document.body.append(link);
    try{link.click();message('已请求导出，请查看浏览器下载位置');}finally{link.remove();}
  }

  document.querySelectorAll('[data-erp-tab]').forEach(button=>button.addEventListener('click',()=>activatePanel(button.dataset.erpTab)));
  document.querySelector('.erp-nav-tabs').addEventListener('keydown',event=>{if(!['ArrowDown','ArrowUp','ArrowRight','ArrowLeft','Home','End'].includes(event.key))return;const tabs=[...document.querySelectorAll('[data-erp-tab]')].filter(button=>!button.disabled && !button.hidden),index=tabs.indexOf(event.target);if(index<0)return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(['ArrowDown','ArrowRight'].includes(event.key)?1:-1)+tabs.length)%tabs.length;activatePanel(tabs[next].dataset.erpTab,true);tabs[next].focus();});
  $('refresh-erp').addEventListener('click',()=>loadData().then(()=>message('数据已刷新')).catch(error=>message(error.message,true)));
  for(const id of ['document-search','document-status'])$(id).addEventListener('input',renderDocuments);
  for(const id of ['party-search','party-filter'])$(id).addEventListener('input',renderParties);
  $('party-cancel').addEventListener('click',resetParty);
  $('party-form').addEventListener('submit',event=>{event.preventDefault();transaction(async()=>{if(!cap('erp.parties.manage'))throw new Error('没有往来单位维护权限');const form=event.currentTarget,value=values(form),editing=state.editing.get('party'),body={requestId:nextRequest(form.id),kind:editing?.kind || value.kind,name:value.name.trim(),contact:value.contact.trim(),phone:value.phone.trim(),termsDays:Number(value.termsDays),note:value.note,active:form.elements.namedItem('active').checked};if(editing){body.id=editing.id;body.revision=editing.revision;}await api('/erp/api/parties',body);resetParty();await loadData();message('往来单位已保存并记录操作');}).catch(error=>message(error.message,true));});
  $('add-purchase-line').addEventListener('click',()=>purchaseRow());
  $('ocr-source')?.addEventListener('change',applyPermissions);$('ocr-recognize')?.addEventListener('click',()=>recognizePurchase().catch(error=>message(error.message,true)));
  $('receipt-source').addEventListener('change',()=>renderReceiptLines());$('bill-kind').addEventListener('change',updateBillParties);$('settlement-direction').addEventListener('change',updateSettlementParties);$('settlement-party').addEventListener('change',()=>renderAllocations());$('settlement-amount').addEventListener('input',updateAllocationTotal);
  document.querySelectorAll('.erp-document-form').forEach(form=>{form.addEventListener('submit',event=>saveDocument(event).catch(error=>message(error.message,true)));form.querySelector('[data-cancel-edit]').addEventListener('click',()=>resetDocumentForm(form));});
  document.querySelectorAll('.erp-form').forEach(form=>form.addEventListener('input',()=>state.requests.delete(form.id)));
  document.querySelectorAll('[data-attachment-input]').forEach(input=>input.addEventListener('change',()=>uploadAttachment(input).catch(error=>message(error.message,true))));
  const reportPrint=actionButton('提交主机打印（A4）',()=>openErpPrint(erpReportPrintSource(state.report,state.actor,currentReportFilters())));reportPrint.id='print-report-a4';reportPrint.disabled=true;reportPrint.dataset.requires='erp.read erp.reports.view';$('export-report').after(reportPrint);
  $('report-form').addEventListener('input',updatePrintButtons);
  $('report-form').addEventListener('submit',event=>{event.preventDefault();loadReport().catch(error=>message(error.message,true));});$('export-report').addEventListener('click',()=>exportReport().catch(error=>message(error.message,true)));
  $('detail-close').addEventListener('click',()=>$('document-dialog').close());
  $('document-dialog').addEventListener('click',event=>{if(event.target===$('document-dialog'))$('document-dialog').close();});
  document.querySelectorAll('[data-date-default]').forEach(input=>input.value=today());purchaseRow();activatePanel('overview');
  api('/session').then(result=>{state.csrf=result.csrf;if(!result.user)throw new Error('请先在工作台登录');return loadData();}).catch(error=>{clearProtected();message(error.message,true);});
})();

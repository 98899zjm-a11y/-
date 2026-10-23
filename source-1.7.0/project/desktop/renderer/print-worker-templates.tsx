import {renderToStaticMarkup} from 'react-dom/server';
import {A4Document} from '../../components/a4-quotation';
import {createQuotePages,localizeQuotePaper} from '../../components/quote-card';
import {defaultSettings} from '../../lib/domain';
import {parseQuotePresentationInput} from '../../lib/quote-presentation';
import WarrantyDocument from './warranty-document';
import {createWarrantySheets,validateWarrantyData} from './warranty-data';
import {WARRANTY_LAYOUT} from './warranty-layout';
// Resolved by the dedicated worker build; template files are compiled fixed
// assets, never paths or URLs supplied by a print request.
// @ts-expect-error worker asset loader
import a4Css from '../../components/a4-quotation.css?worker-inline';
// @ts-expect-error worker asset loader
import warrantyCss from './warranty-document.css?worker-inline';
// @ts-expect-error worker asset loader
import warrantyImage from '../../public/warranty-template.jpg?worker-image';
// @ts-expect-error worker asset loader
import ringImage from '../../public/ring.jpg?worker-image';

export function buildSalesTemplate(payload: any): {html:string;policy:Record<string,unknown>} {
  if(!['warranty','quotation-a4'].includes(payload.kind))throw Error('销售模板类型无效');
  const isOrder=Object.hasOwn(payload.document||{},'salesOrder');
  if(isOrder&&(payload.kind!=='warranty'||Object.hasOwn(payload.document,'quote')))throw Error('销售单只能作为独立质保来源');
  const quote=isOrder?payload.document.salesOrder:payload.document?.quote,original=quote?.snapshot;
  if(isOrder&&!['pending','approved'].includes(quote?.status))throw Error('退回或作废销售单不能打印质保');
  if(!quote?.id||!quote.number||!original||!Number.isFinite(new Date(quote.createdAt).getTime()))throw Error('销售历史快照无效');
  const date=new Date(quote.createdAt).toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});
  // This is an explicit saved record, never a draft. Missing calculation may
  // only be restored from that record's persisted totals, not current prices.
  const savedCalculation=original.calculation??quote.totals;
  const calculation=savedCalculation&&typeof savedCalculation==='object'?{...savedCalculation,...(Number.isFinite(quote.total)?{total:quote.total}:{})}:savedCalculation;
  const snapshot=parseQuotePresentationInput({...original,calculation,image:payload.kind==='warranty'?'':original.image,images:payload.kind==='warranty'?[]:original.images,saleItems:original.saleItems?.map((i:any)=>({...i,image:payload.kind==='warranty'?'':i.image})),tradeInItems:original.tradeInItems?.map((i:any)=>({...i,image:payload.kind==='warranty'?'':i.image})),recyclingItems:original.recyclingItems?.map((i:any)=>({...i,image:payload.kind==='warranty'?'':i.image})),paymentMethods:payload.kind==='warranty'?[]:original.paymentMethods});
  let markup:string,css:string,policy:Record<string,unknown>={};
  if(payload.kind==='quotation-a4'){
    const settings={...defaultSettings,brand:original.brand||defaultSettings.brand};
    const papers=createQuotePages({...snapshot,customer:original.customer,brand:settings.brand} as any,settings,{customerName:original.customer?.name,number:quote.number,date}).map(p=>{const localized=localizeQuotePaper(p,payload.presentation?.language==='en'?'en':'zh-CN');if(payload.presentation?.language==='en')localized.typeLabel={sale:'Jewelry Quotation',custom:'Custom Quotation',tradein:'Trade-in Quotation',repair:'Repair Quotation',recycling:'Buyback Quotation'}[snapshot.type];return localized;});
    // Existing templates use a fixed product placeholder when no photo exists.
    for(const p of papers){if(p.image==='/ring.jpg')p.image=ringImage;for(const product of p.products||[])if(product.image==='/ring.jpg'||!product.image)product.image=ringImage;}
    markup=renderToStaticMarkup(<div className="a4-print-root"><div className="a4-preview-scroll"><A4Document papers={papers}/></div></div>);
    if(payload.presentation?.language==='en'){for(const [a,b] of [['>客户：','>Customer: '],['>日期：','>Date: '],['>报价编号：','>Quote number: '],['>费用明细<','>Price details<'],['>项目<','>Item<'],['>金额 / 明细<','>Amount / details<'],['>商品明细<','>Item details<'],['>整单明细<','>Order details<'],['>收款方式<','>Payment methods<'],['>元<','>CNY<']])markup=markup.replaceAll(a,b);markup=markup.replace(/>第 (\d+) \/ (\d+) 页</g,'>Page $1 / $2<');}
    css=a4Css+'\nhtml:has(.a4-print-root),body:has(.a4-print-root){overflow:visible}.a4-print-root{position:static;display:block;background:#fff;inset:auto;width:210mm}.a4-preview-scroll{display:block;overflow:visible;padding:0}.a4-preview-page{margin:0;box-shadow:none}.a4-sheet{width:210mm;min-height:294mm;height:auto;padding:12mm;display:block;overflow:visible}';
  }else{
    const settings=payload.presentation?.settings,warranty=payload.presentation?.warranty;
    if(!settings||!['full','fields'].includes(settings.mode)||settings.widthMm!==payload.route?.paper?.widthMm||settings.heightMm!==payload.route?.paper?.heightMm)throw Error('已捕获质保纸张与路由不一致');
    if(!warranty||!Array.isArray(warranty.itemIndexes)||!warranty.itemIndexes.length||new Set(warranty.itemIndexes).size!==warranty.itemIndexes.length)throw Error('质保商品选择无效');
    const sheets=createWarrantySheets({...snapshot,tradeInMaterialName:original.tradeInMaterialName} as any,{phone:settings.phone,afterSalesWechat:settings.afterSalesWechat},{date});
    if(warranty.itemIndexes.some((i:number)=>!Number.isInteger(i)||i<0||i>=sheets.length))throw Error('质保商品选择超出范围');
    const seen=new Set();for(const override of warranty.overrides||[]){if(!override||Object.keys(override).some(k=>!['itemIndex','goodsNumber','productName','phone','afterSalesWechat'].includes(k))||!warranty.itemIndexes.includes(override.itemIndex)||seen.has(override.itemIndex))throw Error('质保 override 字段无效');seen.add(override.itemIndex);for(const key of ['goodsNumber','productName','phone','afterSalesWechat'] as const)if(override[key]!==undefined)sheets[override.itemIndex].data[key]=override[key];}
    const selected=warranty.itemIndexes.map((i:number)=>sheets[i]);selected.forEach((s:any)=>validateWarrantyData(s.data));
    const previous=globalThis.document;
    try{
      // WarrantyDocument resolves its one fixed JPG against document.baseURI.
      // SSR performs no DOM effects; the isolated preload measures afterwards.
      Object.defineProperty(globalThis,'document',{value:{baseURI:'xjy-print://template/'},writable:true,configurable:true});
      markup=renderToStaticMarkup(<div className="warranty-print-root">{selected.map((s:any)=><WarrantyDocument key={s.id} data={s.data} {...settings}/>)}</div>).replaceAll('xjy-print://template/warranty-template.jpg',warrantyImage);
    }finally{if(previous===undefined)Reflect.deleteProperty(globalThis,'document');else Object.defineProperty(globalThis,'document',{value:previous,writable:true,configurable:true});}
    css=warrantyCss+`\n@page{size:${settings.widthMm}mm ${settings.heightMm}mm;margin:0}.warranty-print-root{width:${settings.widthMm}mm}`;
    policy={scalePercent:settings.scalePercent,minimumFonts:Object.fromEntries(WARRANTY_LAYOUT.map(t=>[String(t.id),t.fixed||t.notes?8:7]))};
  }
  const base='html,body{margin:0;padding:0;background:#fff;height:auto;overflow:visible}*{box-sizing:border-box}';
  return{html:'<!doctype html><html lang="'+(payload.presentation?.language==='en'?'en':'zh-CN')+'"><head><meta charset="utf-8"><style>'+base+css+'</style></head><body>'+markup+'</body></html>',policy};
}

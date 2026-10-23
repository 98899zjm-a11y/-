'use strict';
// Editable OOXML using Node built-ins only. No HTML, macros or external links.
const zlib=require('node:zlib');
const NS='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const xml=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]));
const mmToPt=72/25.4,mmToTwips=1440/25.4;
function crc32(bytes){let value=0xffffffff;for(const byte of bytes){value^=byte;for(let bit=0;bit<8;bit++)value=(value>>>1)^((value&1)?0xedb88320:0);}return(value^0xffffffff)>>>0;}
function zip(files){
 const local=[],central=[];let offset=0;
 for(const [filename,input]of Object.entries(files)){
  const name=Buffer.from(filename),bytes=Buffer.isBuffer(input)?input:Buffer.from(input),compressed=zlib.deflateRawSync(bytes),crc=crc32(bytes);
  const head=Buffer.alloc(30);head.writeUInt32LE(0x04034b50);head.writeUInt16LE(20,4);head.writeUInt16LE(0x800,6);head.writeUInt16LE(8,8);head.writeUInt16LE(33,12);head.writeUInt32LE(crc,14);head.writeUInt32LE(compressed.length,18);head.writeUInt32LE(bytes.length,22);head.writeUInt16LE(name.length,26);
  const directory=Buffer.alloc(46);directory.writeUInt32LE(0x02014b50);directory.writeUInt16LE(20,4);directory.writeUInt16LE(20,6);directory.writeUInt16LE(0x800,8);directory.writeUInt16LE(8,10);directory.writeUInt16LE(33,14);directory.writeUInt32LE(crc,16);directory.writeUInt32LE(compressed.length,20);directory.writeUInt32LE(bytes.length,24);directory.writeUInt16LE(name.length,28);directory.writeUInt32LE(offset,42);
  local.push(head,name,compressed);central.push(directory,name);offset+=head.length+name.length+compressed.length;
 }
 const tail=Buffer.alloc(22),centralBytes=Buffer.concat(central);tail.writeUInt32LE(0x06054b50);tail.writeUInt16LE(Object.keys(files).length,8);tail.writeUInt16LE(Object.keys(files).length,10);tail.writeUInt32LE(centralBytes.length,12);tail.writeUInt32LE(offset,16);
 return Buffer.concat([...local,centralBytes,tail]);
}
function lineCount(text,widthPt,font){const capacity=widthPt/font;return text.split('\n').reduce((sum,line)=>sum+Math.max(1,Math.ceil([...line].reduce((width,char)=>width+(/[^\x00-\x7f]/.test(char)?1:.55),0)/capacity)),0);}
function textbox({id,text,left,top,width,height,font=10.5,bold=false,align='left',line=1.1,minFont=7,label=''}){
 const minimum=minFont;let fitted=font;
 while(lineCount(text,width,fitted)*fitted*line>height+.2&&fitted>minimum)fitted=Math.max(minimum,fitted-.25);
 if(lineCount(text,width,fitted)*fitted*line>height+.2)throw Error('质保单'+label+'文字放不下，请减小字号或精简文字');
 const runs=text.split('\n').map((part,index)=>(index?'<w:br/>':'')+'<w:t xml:space="preserve">'+xml(part)+'</w:t>').join('');
 return '<w:r><w:pict><v:rect id="'+xml(id)+'" style="position:absolute;margin-left:'+left.toFixed(3)+'pt;margin-top:'+top.toFixed(3)+'pt;width:'+width.toFixed(3)+'pt;height:'+height.toFixed(3)+'pt;z-index:5;mso-position-horizontal-relative:page;mso-position-vertical-relative:page" filled="f" stroked="f"><v:textbox inset="0,0,0,0"><w:txbxContent><w:p><w:pPr><w:jc w:val="'+align+'"/><w:spacing w:before="0" w:after="0" w:line="'+Math.round(fitted*line*20)+'" w:lineRule="exact"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="SimSun"/><w:color w:val="000000"/><w:sz w:val="'+Math.round(fitted*2)+'"/>'+(bold?'<w:b/>':'')+'</w:rPr>'+runs+'</w:r></w:p></w:txbxContent></v:textbox></v:rect></w:pict></w:r>';
}
function createWarrantyDocx(input,{templateBytes,domain:provided}={}){
 const domain=provided||require('./generated/print-domain.cjs'),{WARRANTY_LAYOUT,warrantyTextValue,twipsPerMm,validateWarrantyData,normalizeWarrantyLayoutOffsets,normalizeWarrantyFontSizes,effectiveWarrantyFontSize}=domain;
 if(!input||typeof input!=='object'||!Array.isArray(input.sheets)||input.sheets.length<1||input.sheets.length>30)throw Error('请选取1至30款商品导出Word');
 const settings=input.settings;
 if(!settings||!['full','fields'].includes(settings.mode))throw Error('质保单纸张模式无效');
 for(const [key,min,max]of[['widthMm',60,420],['heightMm',60,500],['offsetXmm',-30,30],['offsetYmm',-30,30],['scalePercent',60,140]])if(typeof settings[key]!=='number'||!Number.isFinite(settings[key])||settings[key]<min||settings[key]>max)throw Error('质保单纸张或校准参数无效');
 if(input.number!==undefined&&(typeof input.number!=='string'||input.number.length>80||/[\x00-\x1f]/.test(input.number)))throw Error('报价编号格式无效');
 if(settings.mode==='full'&&(!Buffer.isBuffer(templateBytes)||templateBytes.length<4||templateBytes.length>5*1024*1024||templateBytes[0]!==255||templateBytes[1]!==216))throw Error('质保单底图未能加载');
 const layoutOffsets=normalizeWarrantyLayoutOffsets(settings.layoutOffsets),fontSizes=normalizeWarrantyFontSizes(settings.fontSizes),scale=settings.widthMm/210*settings.scalePercent/100,pt=mmToPt*scale,fragments=[];
 for(const [page,sheet]of input.sheets.entries()){
  if(!sheet||typeof sheet!=='object'||typeof sheet.id!=='string'||sheet.id.length>100)throw Error('商品质保单格式无效');
  validateWarrantyData(sheet.data);
  const shapes=[];
  if(settings.mode==='full')shapes.push('<w:r><w:pict><v:shape id="template-'+page+'" type="#_x0000_t75" style="position:absolute;margin-left:'+(settings.offsetXmm*mmToPt).toFixed(3)+'pt;margin-top:'+(settings.offsetYmm*mmToPt).toFixed(3)+'pt;width:'+(210*pt).toFixed(3)+'pt;height:'+(297*pt).toFixed(3)+'pt;z-index:-1;mso-position-horizontal-relative:page;mso-position-vertical-relative:page" stroked="f"><v:imagedata r:id="rIdTemplate" o:title="用户珠宝质保单模板"/></v:shape></w:pict></w:r>');
  const movedBackground=WARRANTY_LAYOUT.filter(block=>block.background&&(layoutOffsets[String(block.id)]?.xMm||layoutOffsets[String(block.id)]?.yMm));
  if(settings.mode==='full'){
   for(const block of movedBackground){
    const [l,t,r,b]=block.box,x=(l/twipsPerMm*scale+settings.offsetXmm)*mmToPt,y=(t/twipsPerMm*scale+settings.offsetYmm)*mmToPt,w=(r-l)/twipsPerMm*pt,h=(b-t)/twipsPerMm*pt;
    shapes.push('<w:r><w:pict><v:rect id="mask-'+page+'-'+block.id+'" style="position:absolute;margin-left:'+x.toFixed(3)+'pt;margin-top:'+y.toFixed(3)+'pt;width:'+w.toFixed(3)+'pt;height:'+h.toFixed(3)+'pt;z-index:-1;mso-position-horizontal-relative:page;mso-position-vertical-relative:page" filled="t" fillcolor="#FFFFFF" stroked="f"/></w:pict></w:r>');
   }
   for(const block of movedBackground){
    const [l,t,r,b]=block.box,position=layoutOffsets[String(block.id)],x=(l/twipsPerMm+position.xMm)*scale+settings.offsetXmm,y=(t/twipsPerMm+position.yMm)*scale+settings.offsetYmm,w=(r-l)/twipsPerMm*scale,h=(b-t)/twipsPerMm*scale,[pl,ptop,pr,pb]=block.background;
    if(x<-.2||y<-.2||x+w>settings.widthMm+.2||y+h>settings.heightMm+.2)throw Error('质保单图文超出纸张，请调整位置');
    const cx=Math.round(w*36000),cy=Math.round(h*36000),docId=page*10000+block.id;
    shapes.push('<w:r><w:drawing><wp:anchor xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="'+docId+'" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>'+Math.round(x*36000)+'</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>'+Math.round(y*36000)+'</wp:posOffset></wp:positionV><wp:extent cx="'+cx+'" cy="'+cy+'"/><wp:wrapNone/><wp:docPr id="'+docId+'" name="crop-'+page+'-'+block.id+'" descr="'+xml(block.label)+'"/><wp:cNvGraphicFramePr/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="'+docId+'" name="'+xml(block.label)+'"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdTemplate"/><a:srcRect l="'+Math.round(pl/794*100000)+'" t="'+Math.round(ptop/1123*100000)+'" r="'+Math.round((1-pr/794)*100000)+'" b="'+Math.round((1-pb/1123)*100000)+'"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="'+cx+'" cy="'+cy+'"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>');
   }
  }
  for(const block of WARRANTY_LAYOUT.filter(value=>!value.background)){
   let text=warrantyTextValue(block,sheet.data),[left,top,right,bottom]=block.box;
   const explicitFont=fontSizes[String(block.id)]!==undefined,chosenFont=fontSizes[String(block.id)]??block.fontPt??10.5,printedFont=explicitFont?effectiveWarrantyFontSize(chosenFont,scale):chosenFont*scale;
   let leftMm=left/twipsPerMm,topMm=(top+block.origin)/twipsPerMm,widthMm=(right-left)/twipsPerMm,heightMm=(bottom-top)/twipsPerMm;
   if(!text.trim())continue;
   const position=layoutOffsets[String(block.id)],x=(leftMm+(position?.xMm||0))*scale+settings.offsetXmm,y=(topMm+(position?.yMm||0))*scale+settings.offsetYmm,w=widthMm*scale,h=heightMm*scale;
   if(x<-.2||y<-.2||x+w>settings.widthMm+.2||y+h>settings.heightMm+.2)throw Error('质保单字段超出纸张，请调整纸高、缩放或偏移');
   shapes.push(textbox({id:'p'+page+'-'+(block.notes?'note':block.id),text,left:x*mmToPt,top:y*mmToPt,width:w*mmToPt,height:h*mmToPt,font:printedFont,bold:block.bold,align:block.align,line:block.notes?1.5:1.1,minFont:explicitFont?printedFont:(block.fixed||block.notes?8:7)*scale,label:block.label}));
  }
  if(sheet.data.tradeInNote){
   const top=(Math.max(...WARRANTY_LAYOUT.map(block=>(block.box[3]+block.origin)/twipsPerMm+(layoutOffsets[String(block.id)]?.yMm||0)))+1)*scale+settings.offsetYmm,height=Math.min(16*scale,settings.heightMm-top-scale);
   if(height<=0)throw Error('旧金信息无法放入当前纸张，请增加纸高或减小缩放');
   shapes.push(textbox({id:'p'+page+'-trade-note',text:sheet.data.tradeInNote,left:(10*scale+settings.offsetXmm)*mmToPt,top:top*mmToPt,width:190*pt,height:height*mmToPt,font:8*scale,line:1.35,minFont:7*scale}));
  }
  if(input.number){const top=Math.max(125*scale,Math.max(...WARRANTY_LAYOUT.map(block=>(block.box[3]+block.origin)/twipsPerMm+(layoutOffsets[String(block.id)]?.yMm||0)))*scale+20*scale)+settings.offsetYmm;if(top+4*scale<=settings.heightMm)shapes.push(textbox({id:'p'+page+'-quote-no',text:'报价编号 '+input.number,left:(10*scale+settings.offsetXmm)*mmToPt,top:top*mmToPt,width:190*pt,height:4*pt,font:8*scale}));}
  fragments.push('<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr>'+shapes.join('')+'</w:p>');
  if(page<input.sheets.length-1)fragments.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
 }
 const declaration='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',document=declaration+'<w:document xmlns:w="'+NS+'" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"><w:body>'+fragments.join('')+'<w:sectPr><w:pgSz w:w="'+Math.round(settings.widthMm*mmToTwips)+'" w:h="'+Math.round(settings.heightMm*mmToTwips)+'"/><w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr></w:body></w:document>';
 const files={
  '[Content_Types].xml':declaration+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
  '_rels/.rels':declaration+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdDocument" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  'word/document.xml':document,
  'word/styles.xml':declaration+'<w:styles xmlns:w="'+NS+'"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="SimSun"/><w:sz w:val="21"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="0"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:b/><w:color w:val="000000"/><w:sz w:val="21"/></w:rPr></w:style></w:styles>',
  'word/_rels/document.xml.rels':declaration+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'+(settings.mode==='full'?'<Relationship Id="rIdTemplate" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/warranty-template.jpg"/>':'')+'</Relationships>',
 };
 if(settings.mode==='full')files['word/media/warranty-template.jpg']=templateBytes;
 return zip(files);
}
module.exports={createWarrantyDocx};

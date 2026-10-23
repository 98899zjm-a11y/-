'use strict';
const crypto=require('node:crypto'),path=require('node:path');
const TYPES={'ledger-report-a4':'ledger','inventory-count-a4':'inventory','inventory-report-a4':'inventory','inventory-metal-a4':'inventory'},registries=new WeakSet();
const sha=body=>crypto.createHash('sha256').update(body).digest('hex');
function fail(message){throw Object.assign(new Error(message),{code:'PRINT_RESOURCE_MISSING',status:422});}
function exact(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key)))fail('固定打印资产配置无效');}
function assetPath(value,base='/static/document.css'){
 if(typeof value!=='string'||!value||value.length>500||/[\\%?#:\x00-\x20]/.test(value)||value.startsWith('//')||value.split('/').some(part=>part==='..'))fail('打印资产仅允许登记的本地 static 相对路径');
 let resolved=value.startsWith('/')?value:path.posix.resolve(path.posix.dirname(base),value);
 if(!resolved.startsWith('/static/')||resolved.split('/').some(part=>part==='.'||part==='..')||!/^\/static\/[A-Za-z0-9_./-]+$/.test(resolved))fail('打印资产路径越界');return resolved;
}
function parsers(){try{return require('./generated/print-asset-parsers.cjs');}catch{fail('固定CSS解析器尚未构建，不能丢失原样式后打印');}}
function createPrintAssetRegistry(raw,parse=parsers()){
 exact(raw,['version','sources','templates']);if(raw.version!==1||!raw.sources||typeof raw.sources!=='object'||Array.isArray(raw.sources))fail('固定资产registry版本无效');
 if(typeof parse.postcss?.parse!=='function'||typeof parse.valueParser!=='function')fail('固定CSS解析器不可用');const sources={};let total=0,count=0;
 for(const [kind,source]of Object.entries(raw.sources)){
  exact(source,['module','policy','assets']);exact(source.policy,['landscape','marginsMm']);if(!Object.hasOwn(TYPES,kind)||TYPES[kind]!==source.module||typeof source.policy.landscape!=='boolean'||!source.assets||typeof source.assets!=='object'||Array.isArray(source.assets))fail('打印来源资产与固定模块不符');
  if(source.policy.marginsMm){exact(source.policy.marginsMm,['top','right','bottom','left']);if(['top','right','bottom','left'].some(side=>!Number.isFinite(source.policy.marginsMm[side])||source.policy.marginsMm[side]<0||source.policy.marginsMm[side]>40))fail('固定A4页边距无效');}
  const assets={};for(const [url,asset]of Object.entries(source.assets)){
   if(assetPath(url)!==url||++count>256)fail('固定资产清单范围无效');exact(asset,['mime','size','sha256','bodyBase64']);
   if(!['text/css','image/png','image/jpeg','image/webp','image/gif','font/woff','font/woff2','font/ttf','font/otf'].includes(asset.mime)||!Number.isSafeInteger(asset.size)||asset.size<1||asset.size>8*1024*1024||typeof asset.bodyBase64!=='string'||asset.bodyBase64.length>12*1024*1024||!/^[a-f0-9]{64}$/.test(asset.sha256||''))fail('固定打印资产类型或大小无效');
   const bytes=Buffer.from(asset.bodyBase64,'base64');if(bytes.toString('base64')!==asset.bodyBase64||bytes.length!==asset.size||sha(bytes)!==asset.sha256||(total+=bytes.length)>64*1024*1024)fail('固定打印资产大小或SHA256已变化');
   const record={...asset};if(asset.mime==='text/css'){if(bytes.length>2*1024*1024)fail('打印CSS过大');try{record.text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{fail('固定CSS不是UTF-8');}}
   else{record.uri='data:'+asset.mime+';base64,'+asset.bodyBase64;if(asset.mime.startsWith('image/'))require('./print-worker-passive-dom.cjs').validatePassiveImage(record.uri);else{const magic={'font/woff':'wOFF','font/woff2':'wOF2','font/otf':'OTTO','font/ttf':'\x00\x01\x00\x00'}[asset.mime];if(bytes.subarray(0,4).toString('latin1')!==magic)fail('字体格式与登记类型不符');}}
   assets[url]=Object.freeze(record);
  }
  sources[kind]=Object.freeze({module:source.module,policy:Object.freeze({...source.policy,...(source.policy.marginsMm?{marginsMm:Object.freeze({...source.policy.marginsMm})}:{})}),assets:Object.freeze(assets)});
 }
 const registry=Object.freeze({sources:Object.freeze(sources),parse});registries.add(registry);return registry;
}
let fixed;
function loadFixedPrintRegistry(){if(!fixed){let raw;try{raw=require('./generated/print-source-assets-registry.cjs');}catch{fail('固定原模板资产registry尚未构建');}fixed=createPrintAssetRegistry(raw);}return fixed;}
function sourceFor(kind,registry){if(!registries.has(registry))fail('打印资产必须使用已校验固定registry');const source=registry.sources[kind];if(!source)fail('此原模板未登记固定打印资产');return source;}
function getPrintSourcePolicy(kind,{fixedRegistry=loadFixedPrintRegistry()}={}){const source=sourceFor(kind,fixedRegistry),paper=source.policy.landscape?{widthMm:297,heightMm:210,landscape:true}:{widthMm:210,heightMm:297,landscape:false};if(source.policy.marginsMm){const margins=source.policy.marginsMm;paper.contentWidthMm=paper.widthMm-margins.left-margins.right;paper.contentHeightMm=paper.heightMm-margins.top-margins.bottom;}return paper;}
function applyPageMargins(current,property,value,valueParser){const nodes=valueParser(value).nodes.filter(node=>!['space','comment'].includes(node.type));if(!nodes.length||nodes.length>4||nodes.some(node=>node.type!=='word'||! /^(?:0|\d+(?:\.\d+)?mm)$/.test(node.value)))fail('固定原模板页边距仅支持有限毫米');const values=nodes.map(node=>Number.parseFloat(node.value));if(values.some(number=>number>40))fail('固定原模板页边距过大');const next={...current};if(property==='margin'){const [top,right=top,bottom=top,left=right]=values;Object.assign(next,{top,right,bottom,left});}else{if(values.length!==1)fail('单侧页边距无效');next[property.slice('margin-'.length)]=values[0];}return next;}
function printMedia(params,valueParser){const ast=valueParser(params);let group=[];function rewrite(){const words=group.filter(node=>node.type==='word');let index=0;const prefix=words[0]?.value.toLowerCase();if(prefix==='not'||prefix==='only')index=1;const type=words[index]?.value.toLowerCase();if(type==='print')words[index].value='all';else if(type==='screen'){words[index].value='all';if(prefix==='not')words[0].value='';else if(prefix==='only')words[0].value='not';else words[index].value='not all';}group=[];}for(const node of ast.nodes){if(node.type==='div'&&node.value===',')rewrite();else group.push(node);}rewrite();return ast.toString();}
function compileCss(text,{source,registry,base='/static/document.css',stack=[]}){
 if(typeof text!=='string'||Buffer.byteLength(text)>2*1024*1024||/\\|<\/style/i.test(text))fail('原模板CSS含未允许转义或超出范围');let root;const {postcss,valueParser}=registry.parse;
 try{root=postcss.parse(text,{from:undefined,map:false});}catch{fail('原模板CSS无法完整解析');}
 function lookup(url,type){const name=assetPath(url,base),asset=source.assets[name];if(!asset||type&&asset.mime!==type)fail('原模板固定资产未登记：'+name);return{name,asset};}
 root.walkAtRules(rule=>{
  const name=rule.name.toLowerCase();if(!['import','media','page','font-face','supports','keyframes','-webkit-keyframes','layer','charset'].includes(name))fail('原模板CSS包含未允许的规则');
  if(name==='charset'){rule.remove();return;}
  if(name==='import'){
   const parsed=valueParser(rule.params),nodes=parsed.nodes.filter(node=>!['space','comment'].includes(node.type));let url;
   if(nodes[0]?.type==='string')url=nodes[0].value;else if(nodes[0]?.type==='function'&&nodes[0].value.toLowerCase()==='url'&&nodes[0].nodes.length===1&&['word','string'].includes(nodes[0].nodes[0].type))url=nodes[0].nodes[0].value;else fail('CSS import来源无效');
   const {name:file,asset}=lookup(url,'text/css');if(stack.includes(file)||stack.length>=12)fail('固定CSS依赖循环或过深');
   const imported=postcss.parse(compileCss(asset.text,{source,registry,base:file,stack:[...stack,file]}),{from:undefined,map:false});
   const remaining=parsed.nodes.slice(parsed.nodes.indexOf(nodes[0])+1),media=valueParser.stringify(remaining).trim();
   if(media&&/\b(?:layer|supports)\b/i.test(media))fail('原模板CSS import条件尚未支持');
   if(media){const wrapper=postcss.atRule({name:'media',params:printMedia(media,valueParser)});wrapper.append(imported.nodes);rule.replaceWith(wrapper);}else rule.replaceWith(...imported.nodes);return;
  }
  if(name==='media')rule.params=printMedia(rule.params,valueParser);
  if(name==='page'){
   if(rule.params&&!/^:(?:first|left|right)$/.test(rule.params))fail('原模板只能使用固定A4页');
   for(const declaration of rule.nodes||[])if(declaration.type==='decl'&&declaration.prop.toLowerCase()==='size'){
    const words=valueParser(declaration.value).nodes.filter(node=>node.type!=='space'&&node.type!=='comment');
    if(words.some(node=>node.type!=='word')||!/^A4(?: (?:portrait|landscape))?$/i.test(words.map(node=>node.value).join(' ')))fail('原模板仅允许固定A4纸张');
    const landscape=words.some(node=>node.value.toLowerCase()==='landscape');if(landscape!==source.policy.landscape)fail('原模板方向与固定程序policy不符');
   }
   if(source.policy.marginsMm)for(const declaration of rule.nodes||[])if(declaration.type==='decl'&&/^margin(?:-(?:top|right|bottom|left))?$/.test(declaration.prop.toLowerCase())){const expected=source.policy.marginsMm,actual=applyPageMargins(expected,declaration.prop.toLowerCase(),declaration.value,valueParser);if(Object.keys(expected).some(side=>actual[side]!==expected[side]))fail('原模板页边距与固定程序policy不符');}
  }
 });
 root.walkDecls(declaration=>{
  if(['behavior','-moz-binding'].includes(declaration.prop.toLowerCase()))fail('打印样式包含主动行为');const parsed=valueParser(declaration.value);
  parsed.walk(node=>{
   if(node.type!=='function')return;const name=node.value.toLowerCase();if(['expression','image-set','-webkit-image-set','paint','element','local'].includes(name))fail('打印样式包含未封存资源或主动函数');if(name!=='url')return;
   const nodes=node.nodes.filter(item=>!['space','comment'].includes(item.type));if(nodes.length!==1||!['word','string'].includes(nodes[0].type))fail('CSS url来源不能动态计算');const url=nodes[0].value;let uri;
   if(url.startsWith('data:')){if(/^data:font\/(?:woff2?|ttf|otf);base64,/.test(url)){if(!Object.values(source.assets).some(asset=>asset.uri===url))fail('字体须来自固定registry，不能临时提供');}else require('./print-worker-passive-dom.cjs').validatePassiveImage(url);uri=url;}
   else{const record=lookup(url).asset;if(record.mime==='text/css')fail('CSS URL不能加载嵌套文档');uri=record.uri;}
   node.nodes=[{type:'string',quote:'"',value:uri}];
  });declaration.value=parsed.toString();
 });const result=root.toString();if(Buffer.byteLength(result)>16*1024*1024)fail('固定打印资源内联过大');return result;
}
function decodeAttribute(value){return value.replace(/&([^;\s]+);?/g,(all,entity)=>{const known={amp:'&',quot:'"',apos:"'",lt:'<',gt:'>'};if(Object.hasOwn(known,entity))return known[entity];if(/^#(?:x[0-9a-f]+|\d+)$/i.test(entity)){const code=entity[1].toLowerCase()==='x'?parseInt(entity.slice(2),16):Number(entity.slice(1));if(code>0&&code<=0x10ffff&&!(code>=0xd800&&code<=0xdfff))return String.fromCodePoint(code);}fail('原模板资源属性包含不明确实体');});}
function readTag(html,start){let i=start+1,closing=false;if(html[i]==='/'){closing=true;i++;}const found=/^[A-Za-z][A-Za-z0-9:-]*/.exec(html.slice(i));if(!found)fail('原HTML标签结构不完整');const name=found[0].toLowerCase();i+=found[0].length;const attributes=[];
 while(i<html.length){while(/\s/.test(html[i]||''))i++;if(html[i]==='>')return{name,closing,attributes,end:i+1};if(html[i]==='/'&&html[i+1]==='>')return{name,closing,attributes,end:i+2};if(closing)fail('原HTML结束标签无效');const match=/^[^\s=<>"'`/]+/.exec(html.slice(i));if(!match)fail('原HTML属性结构不完整');const attr=match[0].toLowerCase();i+=match[0].length;while(/\s/.test(html[i]||''))i++;let value='';if(html[i]==='='){i++;while(/\s/.test(html[i]||''))i++;const quote=html[i];if(quote==='"'||quote==="'"){const end=html.indexOf(quote,++i);if(end<0)fail('原HTML属性未闭合');value=html.slice(i,end);i=end+1;}else{const next=/^[^\s<>`"']+/.exec(html.slice(i));if(!next)fail('原HTML属性无效');value=next[0];i+=value.length;}}
 if(attributes.some(item=>item.name===attr))fail('原HTML属性重复');attributes.push({name:attr,value:decodeAttribute(value)});
 }fail('原HTML标签未闭合');}
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
function serialize(tag){return '<'+tag.name+tag.attributes.map(attr=>' '+attr.name+'="'+escape(attr.value)+'"').join('')+'>';}
function preparePrintAssets(document,{fixedRegistry=loadFixedPrintRegistry()}={}){
 if(document?.format!=='trusted-html')return document;
 exact(document,['format','sourceType','contentType','bodyBase64']);if(document.contentType!=='text/html'||typeof document.bodyBase64!=='string'||document.bodyBase64.length>90*1024*1024)fail('原HTML打印文档无效');const bytes=Buffer.from(document.bodyBase64,'base64');if(bytes.toString('base64')!==document.bodyBase64||bytes.length>64*1024*1024)fail('原HTML编码或大小无效');let html;try{html=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{fail('原HTML不是UTF-8');}
 const source=sourceFor(document.sourceType,fixedRegistry),edits=[];let i=0;
 while((i=html.indexOf('<',i))>=0){if(html.startsWith('<!--',i)){const end=html.indexOf('-->',i+4);if(end<0)fail('原HTML注释未闭合');i=end+3;continue;}if(/^<!doctype\s+html/i.test(html.slice(i,i+30))){const end=html.indexOf('>',i);if(end<0)fail('HTML声明未闭合');i=end+1;continue;}const tag=readTag(html,i),start=i;i=tag.end;if(tag.closing)continue;
  const attr=name=>tag.attributes.find(item=>item.name===name);
  if(attr('background'))fail('原模板background资源尚未被动封存，不能直接丢弃');
  if(['style','script','textarea','title'].includes(tag.name)){
   const expression=new RegExp('</'+tag.name+'\\s*>','ig');expression.lastIndex=i;const match=expression.exec(html);if(!match)fail('原HTML文本元素未闭合');if(tag.name==='style'){const css=compileCss(html.slice(i,match.index),{source,registry:fixedRegistry});edits.push({start,end:expression.lastIndex,text:'<style>'+css+'</style>'});}i=expression.lastIndex;continue;
  }
  if(tag.name==='link'){
   if((attr('rel')?.value||'').toLowerCase().split(/\s+/).includes('stylesheet')){const url=assetPath(attr('href')?.value),asset=source.assets[url];if(asset?.mime!=='text/css')fail('原模板CSS未登记：'+url);let css=compileCss(asset.text,{source,registry:fixedRegistry,base:url,stack:[url]});if(attr('media'))css='@media '+printMedia(attr('media').value,fixedRegistry.parse.valueParser)+'{'+css+'}';edits.push({start,end:i,text:'<style>'+css+'</style>'});}
   else edits.push({start,end:i,text:''});continue;
  }
  let changed=false;if(tag.name==='img'){if(attr('srcset'))fail('原模板图片集合尚未固定');const src=attr('src');if(!src)fail('原模板图片来源缺失');if(src.value.startsWith('data:'))require('./print-worker-passive-dom.cjs').validatePassiveImage(src.value);else{const record=source.assets[assetPath(src.value)];if(!record?.mime.startsWith('image/'))fail('原模板图片未登记');src.value=record.uri;changed=true;}}
  if(attr('style')){const root=fixedRegistry.parse.postcss.parse(compileCss('x{'+attr('style').value+'}',{source,registry:fixedRegistry}),{from:undefined,map:false});if(root.nodes.length!==1||root.first.type!=='rule'||root.first.nodes.some(node=>node.type!=='decl'&&node.type!=='comment'))fail('行内打印样式结构无效');attr('style').value=root.first.nodes.map(node=>node.toString()).join(';');changed=true;}
  if(changed)edits.push({start,end:i,text:serialize(tag)});
 }
 // Apply the existing print media while preparing the passive screen. Remove
 // only workspace chrome geometry; business tables and fonts keep their CSS.
 const paper=getPrintSourcePolicy(document.sourceType,{fixedRegistry}),body=source.policy.marginsMm?'html,body{width:'+paper.contentWidthMm+'mm!important;max-width:'+paper.contentWidthMm+'mm!important;margin:0!important;padding:0!important}':'';
 const reset='<style>@page{size:A4 '+(source.policy.landscape?'landscape':'portrait')+'}'+body+' .stock-app main.wrap{width:auto!important;max-width:none!important;margin:0!important;padding:0!important}.topbar,.foot,.no-print,.flashes,.toolbar,.page-actions,.tabs,.report-print-controls{display:none!important}</style>';
 let result='',offset=0;for(const edit of edits){result+=html.slice(offset,edit.start)+edit.text;offset=edit.end;}result+=html.slice(offset);const head=result.toLowerCase().lastIndexOf('</head>');result=head>=0?result.slice(0,head)+reset+result.slice(head):reset+result;if(Buffer.byteLength(result)>64*1024*1024)fail('原打印资产内联后超出范围');return{...document,bodyBase64:Buffer.from(result).toString('base64')};
}
module.exports={createPrintAssetRegistry,loadFixedPrintRegistry,preparePrintAssets,getPrintSourcePolicy,assetPath,applyPageMargins};

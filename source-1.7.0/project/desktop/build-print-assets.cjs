'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createPrintAssetRegistry,preparePrintAssets,applyPageMargins}=require('./print-source-assets.cjs');
const SOURCE=path.join(__dirname,'legacy-source'),OUTPUT=path.join(__dirname,'generated');
const CATALOG=Object.freeze({
 'ledger-report-a4':{module:'ledger',templates:['app/templates/report_print.html'],css:['reports.css']},
 'inventory-count-a4':{module:'inventory',templates:['app/templates/base.html','app/templates/print_sheet.html'],css:['app.css','xjy-theme.css']},
 'inventory-report-a4':{module:'inventory',templates:['app/templates/base.html','app/templates/report.html'],css:['app.css','xjy-theme.css']},
 'inventory-metal-a4':{module:'inventory',templates:['app/templates/base.html','app/templates/metal_stats.html'],css:['app.css','xjy-theme.css']},
});
function fail(message){throw Object.assign(new Error(message),{code:'PRINT_RESOURCE_MISSING'});}
function guardedRead(file,root){file=path.resolve(file);root=path.resolve(root);if(file===root||!file.startsWith(root+path.sep))fail('打印资产必须位于固定程序输入目录');for(let current=file;;current=path.dirname(current)){const info=fs.lstatSync(current);if(info.isSymbolicLink())fail('打印资产不能经过reparse/链接');if(current===path.dirname(current))break;}const info=fs.lstatSync(file);if(!info.isFile()||info.nlink!==1||info.size<1||info.size>8*1024*1024)fail('打印资产不是普通唯一程序文件');const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));try{const before=fs.fstatSync(fd),body=fs.readFileSync(fd),after=fs.fstatSync(fd),current=fs.lstatSync(file);if(before.ino!==info.ino||before.dev!==info.dev||after.nlink!==1||after.size!==body.length||after.mtimeMs!==before.mtimeMs||after.ino!==current.ino||after.dev!==current.dev||current.isSymbolicLink())fail('打印资产读取期间发生变化');return body;}finally{fs.closeSync(fd);}}
function writeGenerated(name,body){const target=path.join(OUTPUT,name);if(path.dirname(target)!==OUTPUT)fail('生成资源输出越界');if(fs.existsSync(target)){const stat=fs.lstatSync(target);if(stat.isSymbolicLink()||!stat.isFile()||stat.nlink!==1)fail('生成资源不能覆写链接文件');}const temp=path.join(OUTPUT,'.print-assets-'+crypto.randomUUID());fs.writeFileSync(temp,body,{flag:'wx'});try{fs.renameSync(temp,target);}catch(error){fs.unlinkSync(temp);throw error;}}
function entry(body,mime){return{mime,size:body.length,sha256:crypto.createHash('sha256').update(body).digest('hex'),bodyBase64:body.toString('base64')};}
async function buildPrintAssets({dependenciesRoot}={}){
 if(typeof dependenciesRoot!=='string'||!path.isAbsolute(dependenciesRoot))throw TypeError('Absolute read-only CSS build dependency root required');
 const esbuild=require(path.join(dependenciesRoot,'esbuild')),parse={postcss:require(path.join(dependenciesRoot,'postcss')),valueParser:require(path.join(dependenciesRoot,'postcss-value-parser'))};
 for(let current=OUTPUT;;current=path.dirname(current)){if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())fail('生成资产目录不能是链接');if(current===path.dirname(current))break;}fs.mkdirSync(OUTPUT,{recursive:true});
 const parserBuild=await esbuild.build({stdin:{contents:"module.exports={postcss:require('postcss'),valueParser:require('postcss-value-parser')};",resolveDir:dependenciesRoot},outfile:path.join(OUTPUT,'print-asset-parsers.cjs'),write:false,bundle:true,platform:'node',format:'cjs',target:'node22',nodePaths:[dependenciesRoot],logLevel:'warning'});
 const raw={version:1,sources:{},templates:[]};const coverage=[];
 for(const [kind,definition]of Object.entries(CATALOG)){
  const assets={},staticRoot=path.join(SOURCE,definition.module,'app/static');
  function add(relative,mime='text/css'){const file=path.join(staticRoot,relative),body=guardedRead(file,SOURCE);assets['/static/'+relative]=entry(body,mime);return body;}
  for(const css of definition.css)add(css);const visited=new Set();
  function graph(relative){if(visited.has(relative))return;if(visited.size>=128)fail('固定CSS graph过大');visited.add(relative);const item=assets['/static/'+relative];if(item.mime!=='text/css')return;const css=Buffer.from(item.bodyBase64,'base64').toString('utf8');if(/\\/.test(css))fail('固定CSS含未允许转义');const root=parse.postcss.parse(css,{from:undefined,map:false}),urls=[];
   root.walkAtRules('import',rule=>{const nodes=parse.valueParser(rule.params).nodes.filter(node=>!['space','comment'].includes(node.type));const first=nodes[0];if(first?.type==='string')urls.push(first.value);else if(first?.type==='function'&&first.value.toLowerCase()==='url'&&first.nodes.length===1)urls.push(first.nodes[0].value);else fail('固定CSS import无法解析');});
   root.walkDecls(rule=>parse.valueParser(rule.value).walk(node=>{if(node.type==='function'&&node.value.toLowerCase()==='url'){const nodes=node.nodes.filter(child=>!['space','comment'].includes(child.type));if(nodes.length!==1||!['word','string'].includes(nodes[0].type))fail('固定CSS资源不能动态计算');urls.push(nodes[0].value);}}));
   for(const url of urls){if(url.startsWith('data:'))continue;const key=require('./print-source-assets.cjs').assetPath(url,'/static/'+relative),next=key.slice('/static/'.length),extension=path.extname(next).toLowerCase(),mime={'.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.otf':'font/otf'}[extension];if(!mime)fail('固定资产类型未被动封存，SVG须另做可信构建光栅化');if(!assets[key])add(next,mime);graph(next);}
  }
  for(const css of definition.css)graph(css);let landscape=false,marginsMm={top:0,right:0,bottom:0,left:0};const pageSizes=[];function pageRules(root){root.walkAtRules('page',rule=>rule.walkDecls(declaration=>{const property=declaration.prop.toLowerCase();if(property==='size')pageSizes.push(declaration.value.trim());else if(/^margin(?:-(?:top|right|bottom|left))?$/.test(property))marginsMm=applyPageMargins(marginsMm,property,declaration.value,parse.valueParser);}));}
  for(const relative of definition.templates){const file=path.join(SOURCE,definition.module,relative),body=guardedRead(file,SOURCE);raw.templates.push({sourceType:kind,path:definition.module+'/'+relative,...entry(body,'text/html')});const text=body.toString('utf8');for(const match of text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi))pageRules(parse.postcss.parse(match[1],{from:undefined,map:false}));}
  for(const asset of Object.values(assets))if(asset.mime==='text/css')pageRules(parse.postcss.parse(Buffer.from(asset.bodyBase64,'base64').toString('utf8'),{from:undefined,map:false}));
  if(pageSizes.some(size=>!/^A4(?: (?:portrait|landscape))?$/i.test(size)))fail('固定原模板不是A4纸张');if(pageSizes.some(size=>/landscape/i.test(size))){if(pageSizes.some(size=>!/landscape/i.test(size)))fail('固定原模板A4方向冲突');landscape=true;}
  raw.sources[kind]={module:definition.module,policy:{landscape,marginsMm},assets};coverage.push({sourceType:kind,templates:definition.templates,assets:Object.entries(assets).map(([url,a])=>({url,mime:a.mime,size:a.size,sha256:a.sha256})),landscape,pageSizes,marginsMm});
 }
 const registry=createPrintAssetRegistry(raw,parse);
 for(const [kind,definition]of Object.entries(CATALOG)){const links=definition.css.map(css=>'<link rel="stylesheet" href="/static/'+css+'">').join('');preparePrintAssets({format:'trusted-html',sourceType:kind,contentType:'text/html',bodyBase64:Buffer.from('<!doctype html><html><head>'+links+'</head><body>仅虚构资源完整性测试</body></html>').toString('base64')},{fixedRegistry:registry});}
 writeGenerated('print-asset-parsers.cjs',parserBuild.outputFiles[0].contents);
 writeGenerated('print-source-assets-registry.cjs','\'use strict\';\nmodule.exports='+JSON.stringify(raw)+';\n');
 const manifest={version:1,coverage,templates:raw.templates.map(({bodyBase64,...meta})=>meta),files:['print-asset-parsers.cjs','print-source-assets-registry.cjs'].map(name=>({path:name,...entry(fs.readFileSync(path.join(OUTPUT,name)),'application/javascript')}))};for(const file of manifest.files)delete file.bodyBase64;
 writeGenerated('print-source-assets-manifest.json',JSON.stringify(manifest,null,2));return manifest;
}
if(require.main===module)buildPrintAssets({dependenciesRoot:process.argv[2]?path.resolve(process.argv[2]):undefined}).then(value=>console.log(JSON.stringify({ok:true,coverage:value.coverage}))).catch(error=>{console.error(error);process.exitCode=1;});
module.exports={buildPrintAssets,guardedRead,CATALOG};

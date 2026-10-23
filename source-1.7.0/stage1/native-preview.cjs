'use strict';
// Transport for existing native-module views. Writes/printing/system actions
// remain unavailable here; every read still goes through the original actor API.
function parsePreview(uri){
 const route=uri.split('?')[0],match=/^\/native\/(ledger|inventory)(\/[^#]*)?$/.exec(uri);if(!match||route.includes('\\')||/%2f|%5c|%00/i.test(route)||route.split('/').some(x=>x==='.'||x==='..'))throw new Error('Invalid native preview path');
 const module=match[1],address=match[2]||'/',pathname=address.split('?')[0];
 const allowed=module==='ledger'?['/','/overview','/sales','/stock','/material','/payroll','/expenses','/algorithms','/algorithms/api','/api/calculate','/api/overview','/api/dashboard','/annotations/list']:['/','/skus','/moves','/moves/stock','/material-moves','/materials','/sessions','/api/dashboard'];
 if(!allowed.includes(pathname)&&!/^\/static\/[A-Za-z0-9_.-]+$/.test(pathname)&&!(module==='inventory'&&/^\/sessions\/\d+\/(entry|entry-mobile)$/.test(pathname)))throw new Error('Native preview action is not allowed');
 return{module,path:address};
}
function rewriteScript(script,module){return script.replace(/(['"])\/(?!\/)([^'"\r\n]*)\1/g,(_m,quote,relative)=>quote+'/native/'+module+'/'+relative+quote);}
function rewriteHtml(html,module,nonce){
 const prefix='/native/'+module;
 const scripts=html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi,(_m,attributes,body)=>'<script nonce="'+nonce+'"'+attributes+'>'+rewriteScript(body,module)+'</script>');
 const rewritten=scripts.replace(/\b(href|src|action)=(['"])\/(?!\/)(.*?)\2/gi,(_m,name,quote,value)=>name+'='+quote+(name.toLowerCase()==='href'&&value==='erp/'?'/erp/':value.startsWith('native/')?'/'+value:prefix+'/'+value)+quote);
 const banner='<div class="xjy-test-preview" role="status" style="position:relative;z-index:999;background:#252620;color:#fff;padding:10px 20px;text-align:center;font:13px/1.5 sans-serif">虚构账套 · 只读设计检测预览 · <a style="color:#fff;text-decoration:underline" href="/">返回统一工作台</a></div>';
 const guard='<script nonce="'+nonce+'">document.addEventListener("submit",function(e){if((e.target.method||"get").toLowerCase()!=="get"){e.preventDefault();window.alert("本设计检测预览只读，未提交业务数据。");}},true);</script>';
 const previewOffsets='<style>.xjy-test-preview{min-height:40px;box-sizing:border-box}.app-sidebar,.stock-app .nav{top:40px!important;height:calc(100dvh - 40px)!important}.workspace-header,.stock-app .topbar{top:40px!important}</style>';
 return rewritten.replace(/(<body\b[^>]*>)/i,'$1'+banner+previewOffsets).replace(/<\/body>/i,guard+'</body>');
}
module.exports={parsePreview,rewriteHtml,rewriteScript};

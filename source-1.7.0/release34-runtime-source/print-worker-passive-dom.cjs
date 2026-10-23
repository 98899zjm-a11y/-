'use strict';
function fail(message) { throw Object.assign(new Error(message), {code:'PRINT_RESOURCE_MISSING'}); }
function validatePassiveImage(value) {
  if (typeof value !== 'string' || value.length > 32 * 1024 * 1024 || !/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) fail('打印图片须由后台预先内联为被动像素，外部图片或 SVG 不可发送');
  const mime = value.slice(11, value.indexOf(';')), raw = atob(value.slice(value.indexOf(',')+1));
  if (mime === 'png' && raw.slice(0,8) !== '\x89PNG\r\n\x1a\n' || mime === 'jpeg' && raw.slice(0,3) !== '\xff\xd8\xff' || mime === 'webp' && (raw.slice(0,4)!=='RIFF'||raw.slice(8,12)!=='WEBP') || mime === 'gif' && !['GIF87a','GIF89a'].includes(raw.slice(0,6))) fail('打印图片编码与像素格式不符');
  return true;
}
function validatePassiveCss(value) {
  if (typeof value !== 'string' || value.length > 2 * 1024 * 1024 || /\\|@import|expression\s*\(|-moz-binding|behavior\s*:/i.test(value)) fail('打印样式依赖未完整内联，不能丢失模板后继续发送');
  for (const match of value.matchAll(/url\s*\(\s*(['"]?)(.*?)\1\s*\)/gi)) {
    const resource = match[2].trim();
    if (/^data:font\/(?:woff2?|ttf|otf);base64,[A-Za-z0-9+/]+={0,2}$/.test(resource)) continue;
    validatePassiveImage(resource);
  }
  return true;
}
function sanitizePassiveDocument(doc) {
  // Chromium parses HTML while page JavaScript, networking, plugins and all
  // navigation are already disabled. The isolated preload then drops active
  // nodes and event attributes before reporting readiness.
  const active = 'script,iframe,frame,frameset,object,embed,applet,webview,base,video,audio,source,track';
  for (const el of doc.querySelectorAll(active)) el.remove();
  for (const el of doc.querySelectorAll('meta[http-equiv]')) if (!['content-type','content-security-policy'].includes(el.getAttribute('http-equiv')?.toLowerCase())) el.remove();
  for (const el of doc.querySelectorAll('link')) { if ((el.getAttribute('rel')||'').toLowerCase()==='stylesheet') fail('原模板外部样式未内联，须先准备固定模板资产'); el.remove(); }
  for (const el of doc.querySelectorAll('form')) el.replaceWith(...el.childNodes);
  for (const el of doc.querySelectorAll('button,input,select,textarea')) { if (el.tagName==='TEXTAREA') el.replaceWith(doc.createTextNode(el.value)); else if(el.tagName==='INPUT' && el.value) el.replaceWith(doc.createTextNode(el.value)); else el.remove(); }
  if (doc.querySelector('svg,math,canvas')) fail('原模板包含未转成被动像素的图表，必须先准备真实页面资源');
  for (const el of doc.querySelectorAll('*')) for (const attribute of [...el.attributes]) {
    const name=attribute.name.toLowerCase();
    if(name.startsWith('on')||['href','action','formaction','srcdoc','ping','download','target','nonce','integrity','srcset','background'].includes(name)) el.removeAttribute(attribute.name);
    else if(name==='src'&&el.tagName!=='IMG') el.removeAttribute(attribute.name);
  }
  for (const style of doc.querySelectorAll('style')) validatePassiveCss(style.textContent || '');
  for (const el of doc.querySelectorAll('[style]')) validatePassiveCss(el.getAttribute('style'));
  for (const image of doc.querySelectorAll('img')) validatePassiveImage(image.getAttribute('src'));
}
async function preparePassiveDocument(doc, policy) {
  sanitizePassiveDocument(doc); await doc.fonts.ready;
  for(const font of doc.fonts)if(font.status==='error')fail('固定打印字体未能完成解码，不能丢失原字形后继续打印');
  await Promise.all([...doc.images].map(async image => { await image.decode(); if (!image.naturalWidth) fail('打印图片未能完成解码'); }));
  const pixelsPerMm=96/25.4, width=(policy.contentWidthMm||policy.widthMm)*pixelsPerMm, height=(policy.contentHeightMm||policy.heightMm)*pixelsPerMm;
  const overflow=(el)=>el.scrollWidth>el.clientWidth+1 || el.scrollHeight>el.clientHeight+1;
  for(const el of doc.querySelectorAll('[data-warranty-field]:not([data-warranty-background])')) {
    const id=el.getAttribute('data-warranty-source-spid'), explicit=Object.hasOwn(policy.fontSizes || {},id);
    let current=parseFloat(getComputedStyle(el).fontSize); const scale=policy.widthMm/210*(policy.scalePercent||100)/100;
    const minimum=explicit?current:((el.hasAttribute('data-warranty-trade')?7:policy.minimumFonts?.[id]||7)*scale*96/72);
    while(overflow(el)&&current>minimum) {current=Math.max(minimum,current-.25*scale*96/72);el.style.fontSize=current+'px';}
    if(overflow(el)) throw Object.assign(new Error('质保字段内容放不下：'+el.getAttribute('data-warranty-field')),{code:'PRINT_LAYOUT_OVERFLOW'});
  }
  for(const page of doc.querySelectorAll('.warranty-sheet,.a4-sheet,.xjy-pdf-page')) {
    const box=page.getBoundingClientRect(); if(box.width>width+2 || box.height>height+2 || page.scrollWidth>width+2 || page.scrollHeight>height+2) throw Object.assign(new Error('打印内容超过已捕获纸张，须调整模板或分页'),{code:'PRINT_LAYOUT_OVERFLOW'});
    for(const el of page.querySelectorAll('[data-warranty-field]')) { if(!el.textContent?.trim())continue;const field=el.getBoundingClientRect(); if(field.left<box.left-1||field.top<box.top-1||field.right>box.right+1||field.bottom>box.bottom+1) throw Object.assign(new Error('质保字段超出纸张：'+el.getAttribute('data-warranty-field')),{code:'PRINT_LAYOUT_OVERFLOW'}); }
    for(const footer of page.querySelectorAll('[data-warranty-trade]')) {const a=footer.getBoundingClientRect(); for(const el of page.querySelectorAll('[data-warranty-field]:not([data-warranty-trade])')) {if(!el.textContent?.trim())continue;const b=el.getBoundingClientRect(); if(b.left<a.right-1&&b.right>a.left+1&&b.top<a.bottom-1&&b.bottom>a.top+1) throw Object.assign(new Error('旧金信息与原模板内容重叠'),{code:'PRINT_LAYOUT_OVERFLOW'});}}
  }
  for(const el of doc.body.querySelectorAll('*')){const style=getComputedStyle(el);if(['hidden','clip'].includes(style.overflowX)&&el.scrollWidth>el.clientWidth+1||['hidden','clip'].includes(style.overflowY)&&el.scrollHeight>el.clientHeight+1)throw Object.assign(new Error('原模板会裁剪打印内容，须调整原排版'),{code:'PRINT_LAYOUT_OVERFLOW'});if((el.tagName==='TR'||style.breakInside==='avoid')&&el.getBoundingClientRect().height>height-1)throw Object.assign(new Error('不可拆分的报表内容超过一页，须调整分页'),{code:'PRINT_LAYOUT_OVERFLOW'});}
  if(doc.documentElement.scrollWidth>width+2) throw Object.assign(new Error('A4 页面横向内容溢出，须调整模板'),{code:'PRINT_LAYOUT_OVERFLOW'});
  return {ok:true,pages:Math.max(1,doc.querySelectorAll('.warranty-sheet,.a4-sheet,.xjy-pdf-page').length)};
}
module.exports={validatePassiveCss,validatePassiveImage,sanitizePassiveDocument,preparePassiveDocument};

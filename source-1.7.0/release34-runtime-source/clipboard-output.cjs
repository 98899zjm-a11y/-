'use strict';
async function copyQuoteImage(bytes,{nativeImage,clipboard,ClipboardItem}) {
 if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>45*1024*1024)throw new Error('图片为空或过大');
 const picture=nativeImage.createFromBuffer(bytes);if(picture.isEmpty())throw new Error('图片无法读取，请重新生成');
 let copied;
 if(typeof ClipboardItem==='function'&&typeof clipboard.write==='function'&&typeof clipboard.read==='function') {
  await clipboard.write([new ClipboardItem({'image/png':new Blob([picture.toPNG()],{type:'image/png'})})]);
  const items=await clipboard.read(), item=items.find(value=>value.types.includes('image/png'));
  if(!item)throw new Error('剪贴板没有图片，请重新复制');
  copied=nativeImage.createFromBuffer(Buffer.from(await(await item.getType('image/png')).arrayBuffer()));
 } else if(typeof clipboard.writeImage==='function'&&typeof clipboard.readImage==='function') {
  await clipboard.clear();await clipboard.writeImage(picture);copied=await clipboard.readImage();
 } else throw new Error('此运行环境不支持图片复制，请更新程序');
 if(copied.isEmpty()||copied.getSize().width!==picture.getSize().width||copied.getSize().height!==picture.getSize().height)throw new Error('图片未成功写入剪贴板，请重试');
 if(await clipboard.readText())throw new Error('剪贴板仍是文字，请重新复制图片');
 return copied.getSize();
}
module.exports={copyQuoteImage};

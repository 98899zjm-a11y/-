'use strict';
const {spawn}=require('node:child_process');
const path=require('node:path');
const fs=require('node:fs');
function fail(code,message){return Object.assign(new Error(message),{code});}
function createPdfRasterizer({dependenciesRoot,executable=process.execPath,timeoutMs=15000,maxInputBytes=64*1024*1024,maxOutputBytes=64*1024*1024}){
  if(typeof dependenciesRoot!=='string'||!path.isAbsolute(dependenciesRoot))throw TypeError('Trusted packaged PDF dependency root required');
  const entry=path.join(dependenciesRoot,'pdfjs-dist/legacy/build/pdf.mjs');
  if(!fs.existsSync(entry)||!fs.existsSync(path.join(dependenciesRoot,'@napi-rs/canvas')))throw fail('PRINT_PDF_RENDERER_UNAVAILABLE','离线PDF和像素依赖未打包');
  return bytes=>new Promise((resolve,reject)=>{
    if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>maxInputBytes){reject(fail('PRINT_PDF_LIMIT','PDF输入超出范围'));return;}
    const environment={ELECTRON_RUN_AS_NODE:'1'};for(const name of ['SystemRoot','WINDIR','PATH','PATHEXT','TEMP','TMP'])if(typeof process.env[name]==='string')environment[name]=process.env[name];
    const child=spawn(executable,['--max-old-space-size=512',path.join(__dirname,'print-worker-pdf-child.cjs'),dependenciesRoot],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:environment});
    let chunks=[],size=0,stderr='',settled=false;const timer=setTimeout(()=>finish(fail('PRINT_PDF_TIMEOUT','离线PDF页面栅格化超时')),timeoutMs);
    function finish(error,value){if(settled)return;settled=true;clearTimeout(timer);if(error){child.kill();reject(error);}else resolve(value);}
    child.on('error',e=>finish(fail('PRINT_PDF_RENDERER_UNAVAILABLE',e.message)));
    child.stdout.on('data',chunk=>{size+=chunk.length;if(size>maxOutputBytes){finish(fail('PRINT_PDF_LIMIT','PDF被动页面像素超出范围'));return;}chunks.push(chunk);});
    child.stderr.on('data',chunk=>{if(stderr.length<8000)stderr+=chunk.toString('utf8').slice(0,8000-stderr.length);});
    child.on('exit',code=>{if(settled)return;if(code!==0){finish(fail('PRINT_PDF_INVALID','PDF页面无法安全读取：'+stderr.slice(-800)));return;}try{const pages=JSON.parse(Buffer.concat(chunks,size).toString('utf8'));if(!Array.isArray(pages)||!pages.length||pages.length>200)throw Error('Invalid PDF pages');finish(null,pages);}catch(e){finish(fail('PRINT_PDF_INVALID',e.message));}});
    child.stdin.on('error',e=>finish(fail('PRINT_PDF_INVALID',e.message)));child.stdin.end(bytes);
  });
}
module.exports={createPdfRasterizer};

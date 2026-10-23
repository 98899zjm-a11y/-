'use strict';
// This fixed entry accepts PDF bytes only on stdin. It never executes PDF JS,
// actions, links, attachments, forms or browser/plugin viewers.
const path=require('node:path');const {pathToFileURL}=require('node:url');
async function run(){
  const dependenciesRoot=process.argv[2];if(!dependenciesRoot||!path.isAbsolute(dependenciesRoot))throw Error('Fixed PDF dependency root missing');
  const canvas=require(path.join(dependenciesRoot,'@napi-rs/canvas'));const pdf=await import(pathToFileURL(path.join(dependenciesRoot,'pdfjs-dist/legacy/build/pdf.mjs')).href);
  let chunks=[],size=0;for await(const chunk of process.stdin){size+=chunk.length;if(size>64*1024*1024)throw Error('PDF input limit');chunks.push(chunk);}
  const data=new Uint8Array(Buffer.concat(chunks,size));
  const loading=pdf.getDocument({data,isEvalSupported:false,disableFontFace:true,enableXfa:false,useSystemFonts:false,useWorkerFetch:false,stopAtErrors:true,maxImageSize:16000000,canvasMaxAreaInBytes:64000000,standardFontDataUrl:path.join(dependenciesRoot,'pdfjs-dist/standard_fonts').replaceAll('\\','/')+'/',cMapUrl:path.join(dependenciesRoot,'pdfjs-dist/cmaps').replaceAll('\\','/')+'/',cMapPacked:true,verbosity:0});
  const doc=await loading.promise,pages=[];let totalPixels=0,totalBytes=0;
  try{if(!doc.numPages||doc.numPages>200)throw Error('PDF page limit');
    for(let number=1;number<=doc.numPages;number++){
      const page=await doc.getPage(number),viewport=page.getViewport({scale:150/72}),width=Math.ceil(viewport.width),height=Math.ceil(viewport.height);
      if(width<1||height<1||width*height>16000000||(totalPixels+=width*height)>64000000)throw Error('PDF raster pixel limit');
      const surface=canvas.createCanvas(width,height),context=surface.getContext('2d');
      await page.render({canvasContext:context,canvas:surface,viewport,annotationMode:pdf.AnnotationMode.DISABLE,background:'rgb(255,255,255)'}).promise;
      const png=surface.toBuffer('image/png');totalBytes+=png.length;if(totalBytes>40*1024*1024)throw Error('PDF raster byte limit');
      const natural=page.getViewport({scale:1});pages.push({widthMm:natural.width*25.4/72,heightMm:natural.height*25.4/72,pngBase64:png.toString('base64')});page.cleanup();surface.width=surface.height=1;
    }
    process.stdout.write(JSON.stringify(pages));
  }finally{await loading.destroy();}
}
run().catch(e=>{process.stderr.write(String(e.message||e).slice(0,800));process.exitCode=1;});

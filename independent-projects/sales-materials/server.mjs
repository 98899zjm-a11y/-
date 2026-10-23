import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { openLibrary } from './lib/library.mjs';
import { searchAssets } from './lib/search.mjs';
import { CATEGORIES, MAX_FILE_BYTES, prepareImage, createClassifier } from './lib/classifier.mjs';

export const projectRoot=path.dirname(fileURLToPath(import.meta.url));
export const AVAILABILITY=[{value:'unknown',label:'状态待核实'},{value:'in_stock',label:'现货'},{value:'order_only',label:'需订货'},{value:'reference_only',label:'仅供参考'}];
const staticFiles=new Map([['/','index.html'],['/app.js','app.js'],['/styles.css','styles.css']]);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
class HttpError extends Error {constructor(status,message){super(message);this.status=status;}}
function readBody(req,limit) {
  return new Promise((resolve,reject)=>{
    let n=0,parts=[],failed=false;
    req.on('data',part=>{n+=part.length;if(n>limit){if(!failed){failed=true;parts=[];reject(new HttpError(413,'文件或请求超过大小限制'));}}else if(!failed)parts.push(part);});
    req.on('end',()=>{if(!failed)resolve(Buffer.concat(parts));});
    req.on('error',reject);req.on('aborted',()=>reject(new HttpError(400,'上传已中断，请重试')));
  });
}
function json(res,status,value) {res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(value));}
function safeAsset(asset) {
  if (!asset) return asset;
  const keys=['id','name','sourceLabel','sha256','status','category','tags','reason','availability','evidence','createdAt','updatedAt','error'];
  return Object.fromEntries(keys.filter(k=>asset[k]!==undefined).map(k=>[k,asset[k]]));
}
export async function createApplication({dataRoot=path.join(projectRoot,'runtime','data'),port=21963,classify=createClassifier(),libraryFactory=openLibrary}={}) {
  const library=await libraryFactory({root:dataRoot,classify});
  const csrf=randomBytes(32).toString('hex');let origin;let uploads=0;
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cross-Origin-Resource-Policy','same-origin');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'self'");
    try {
      if (req.headers.host!==new URL(origin).host || req.headers.origin && req.headers.origin!==origin || req.headers['sec-fetch-site']==='cross-site') throw new HttpError(403,'仅支持本机同源访问');
      const url=new URL(req.url,origin);
      if (['POST','PATCH'].includes(req.method) && req.headers['x-csrf-token']!==csrf) throw new HttpError(403,'页面凭证已失效，请重新加载整个页面后重试');
      if (req.method==='GET'&&staticFiles.has(url.pathname)) {
        const file=staticFiles.get(url.pathname),body=await fs.readFile(path.join(projectRoot,'public',file));
        res.writeHead(200,{'content-type':mime[path.extname(file)],'cache-control':'no-cache'});res.end(body);return;
      }
      if (req.method==='GET'&&url.pathname==='/api/bootstrap') {
        json(res,200,{csrfToken:csrf,model:'qwen3-vl:4b',candidate:true,libraryLabel:'D盘独立候选图库',categories:CATEGORIES,availabilityOptions:AVAILABILITY,maxFileBytes:MAX_FILE_BYTES,maxBatchFiles:300});return;
      }
      if (req.method==='GET'&&url.pathname==='/api/health') {
        let modelReady=false;try{const r=await fetch('http://127.0.0.1:21434/api/tags',{signal:AbortSignal.timeout(2500)});const t=await r.json();modelReady=r.ok&&t.models?.some(x=>x.name==='qwen3-vl:4b')===true;}catch{}
        json(res,200,{ok:true,candidate:true,modelReady,model:'qwen3-vl:4b'});return;
      }
      if (req.method==='GET'&&url.pathname==='/api/assets') {
        const assets=(await library.list()).map(safeAsset),counts={all:assets.length,imported:0,queued:0,classifying:0,needs_review:0,skipped:0,awaiting_model:0};
        for (const a of assets) if(Object.hasOwn(counts,a.status))counts[a.status]++;
        json(res,200,{assets,counts});return;
      }
      if (req.method==='GET'&&url.pathname==='/api/search') {
        const query=url.searchParams.get('q')??'';if(query.length>300)throw new HttpError(400,'客户要求请控制在300字以内');
        let result;
        try{result=searchAssets((await library.list()).map(safeAsset),{query,category:url.searchParams.get('category')??'',availability:url.searchParams.get('availability')??'',offset:Number(url.searchParams.get('offset')??0),limit:Number(url.searchParams.get('limit')??100)});}
        catch(e){if(e instanceof TypeError)throw new HttpError(400,e.message);throw e;}
        json(res,200,result);return;
      }
      if (req.method==='POST'&&url.pathname==='/api/assets') {
        if (req.headers['content-type']?.split(';')[0]!=='application/octet-stream')throw new HttpError(415,'上传格式应为图片二进制');
        if (Number(req.headers['content-length']??0)>MAX_FILE_BYTES)throw new HttpError(413,'图片超过20MB');
        if (uploads>=2)throw new HttpError(429,'正在接收其他图片，请稍后重试');
        const name=url.searchParams.get('name')??'未命名图片',sourceLabel=url.searchParams.get('sourceLabel')??'';
        if (name.length>200||sourceLabel.length>200||/[\x00-\x1f]/.test(name+sourceLabel))throw new HttpError(400,'文件名或来源备注过长或无效');
        uploads++;
        try {
          const original=await readBody(req,MAX_FILE_BYTES);
          let prepared;try{prepared=await prepareImage(original);}catch{throw new HttpError(422,'图片无法完整读取，请使用静态JPG、PNG或WebP（20MB以内）');}
          const result=await library.enqueue({...prepared,name,sourceLabel});
          json(res,202,{asset:safeAsset(result),duplicate:result.duplicate===true});return;
        }finally{uploads--;}
      }
      const match=/^\/api\/assets\/([a-zA-Z0-9_-]{1,100})(?:\/(image|retry))?$/.exec(url.pathname);
      if (match) {
        const [,id,action]=match;
        const asset=await library.get(id);if(!asset)throw new HttpError(404,'未找到该素材');
        if(req.method==='GET'&&action==='image') {
          const file=await library.file(id);if(!file)throw new HttpError(404,'图片尚未就绪');
          const bytes=file.bytes;if(!Buffer.isBuffer(bytes))throw new Error('Verified image buffer unavailable');
          res.writeHead(200,{'content-type':'image/jpeg','content-length':bytes.length,'cache-control':'no-store'});res.end(bytes);return;
        }
        if(req.method==='POST'&&action==='retry') {
          let next;try{next=await library.retry(id);}catch{throw new HttpError(409,'当前素材不能重试，请先等待分类结束');}
          json(res,202,{asset:safeAsset(next)});return;
        }
        if(req.method==='PATCH'&&!action) {
          if(req.headers['content-type']?.split(';')[0]!=='application/json')throw new HttpError(415,'修改请求需使用JSON');
          let patch;try{patch=JSON.parse((await readBody(req,16_384)).toString('utf8'));}catch(e){if(e instanceof HttpError)throw e;throw new HttpError(400,'修改内容格式无效');}
          if (!patch||typeof patch!=='object'||Array.isArray(patch))throw new HttpError(400,'修改内容格式无效');
          const allowed=['category','tags','sourceLabel','availability','evidence','confirmed','reviewDecision'];
          if(Object.keys(patch).some(k=>!allowed.includes(k)))throw new HttpError(400,'修改中包含不支持的字段');
          if(patch.category!==undefined&&!CATEGORIES.includes(patch.category)||patch.availability!==undefined&&!AVAILABILITY.some(x=>x.value===patch.availability))throw new HttpError(400,'品类或供货状态无效');
          let next;try{next=await library.update(id,patch);}catch{throw new HttpError(400,'修改未保存。请检查标签、来源，以及供货状态的确认依据；分类中请稍后再试。');}
          json(res,200,{asset:safeAsset(next)});return;
        }
      }
      throw new HttpError(404,'未找到此功能');
    } catch(e) {
      if(!res.headersSent)json(res,e instanceof HttpError?e.status:500,{error:e instanceof HttpError?e.message:'操作未完成，素材仍保留。请刷新重试或查看候选运行日志。'});
      else res.end();
      if(!(e instanceof HttpError))console.error('Candidate request failed:',e);
    }
  });
  server.requestTimeout=45_000;server.headersTimeout=15_000;
  try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});}
  catch(e){await library.close();throw e;}
  origin=`http://127.0.0.1:${server.address().port}`;
  return {origin,server,library,async close(){await new Promise(resolve=>server.close(resolve));await library.close();}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const app=await createApplication();console.log(`销售素材候选已启动：${app.origin}`);
  let closing=false;const stop=async()=>{if(closing)return;closing=true;await app.close();process.exitCode=0;};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
}

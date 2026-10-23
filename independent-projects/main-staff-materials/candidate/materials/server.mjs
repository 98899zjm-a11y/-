import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { openLibrary } from './lib/library.mjs';
import { searchAssets } from './lib/search.mjs';
import { CATEGORIES, MAX_FILE_BYTES, prepareImage, createClassifier } from './lib/classifier.mjs';
import {createMaterialAccessAdapter,MaterialAuthError} from './auth/lib/access-adapter.mjs';
import {createCandidateAuthorityHost} from './auth/candidate-authority-host.mjs';
import {createReviewFirstClassifier} from './lib/review-first.mjs';

export const projectRoot=path.dirname(fileURLToPath(import.meta.url));
export const SERVICE_MODEL='qwen3-vl:4b-instruct';
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
function safeAsset(asset,level='manage') {
  if (!asset) return asset;
  const keys=['id','name','sourceLabel','sha256','status','category','tags','reason','availability','evidence','createdAt','updatedAt','error'];
  const permitted=level==='view'?['id','status','category','tags','availability','createdAt','updatedAt']:keys.filter(k=>level==='manage'||k!=='evidence');
  return Object.fromEntries(permitted.filter(k=>asset[k]!==undefined).map(k=>[k,asset[k]]));
}
export function createMaterialRequestHandler({library,origin,access,authorityHost=null,basePath=''}) {
  let uploads=0;
  return async(req,res)=>{
    res.setHeader('X-Frame-Options','SAMEORIGIN');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cross-Origin-Resource-Policy','same-origin');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'self'");
    try {
      if (req.headers.host!==new URL(origin).host || req.headers.origin && req.headers.origin!==origin || req.headers['sec-fetch-site']==='cross-site') throw new HttpError(403,'仅支持本机同源访问');
      const raw=req.url; if(basePath&&raw!==basePath&&!raw.startsWith(basePath+'/'))throw new HttpError(404,'未找到此素材入口');
      const relative=basePath?raw.slice(basePath.length)||'/':raw; const url=new URL(relative,origin);
      if(url.origin!==origin||url.pathname!==relative.split('?')[0]||relative.includes('#'))throw new HttpError(400,'素材地址须为规范路径');
      if(authorityHost&&await authorityHost.handle(req,res))return;
      if (req.method==='GET'&&staticFiles.has(url.pathname)) {
        const file=staticFiles.get(url.pathname),body=await fs.readFile(path.join(projectRoot,'public',file));
        res.writeHead(200,{'content-type':mime[path.extname(file)],'cache-control':'no-cache'});res.end(body);return;
      }
      if (req.method==='GET'&&url.pathname==='/api/bootstrap') {
        const credentials=await access.bootstrap(req);
        json(res,200,{...credentials,model:SERVICE_MODEL,candidate:true,classificationMode:'manager_review_required',libraryLabel:'D盘主系统会话候选图库',categories:CATEGORIES,availabilityOptions:AVAILABILITY,maxFileBytes:MAX_FILE_BYTES,maxBatchFiles:300});return;
      }
      if (req.method==='GET'&&url.pathname==='/api/health') {
        let modelReady=false;try{const r=await fetch('http://127.0.0.1:21434/api/tags',{signal:AbortSignal.timeout(2500)});const t=await r.json();modelReady=r.ok&&t.models?.some(x=>x.name===SERVICE_MODEL)===true;}catch{}
        json(res,200,{ok:true,candidate:true,authenticationRequired:true,modelReady,model:SERVICE_MODEL});return;
      }
      if (req.method==='GET'&&url.pathname==='/api/assets') {
        const permission=await access.authorize(req,{action:'read'}),rows=await library.list(),actor=permission.check();
        const assets=rows.filter(a=>actor.level!=='view'||a.status==='imported').map(a=>safeAsset(a,actor.level)),counts={all:assets.length,imported:0,queued:0,classifying:0,needs_review:0,skipped:0,awaiting_model:0};
        for (const a of assets) if(Object.hasOwn(counts,a.status))counts[a.status]++;
        json(res,200,{assets,counts});return;
      }
      if (req.method==='GET'&&url.pathname==='/api/search') {
        const permission=await access.authorize(req,{action:'read'}),rows=await library.list(),actor=permission.check();
        const query=url.searchParams.get('q')??'';if(query.length>300)throw new HttpError(400,'客户要求请控制在300字以内');
        let result;
        try{result=searchAssets(rows.map(a=>safeAsset(a,actor.level)),{query,category:url.searchParams.get('category')??'',availability:url.searchParams.get('availability')??'',offset:Number(url.searchParams.get('offset')??0),limit:Number(url.searchParams.get('limit')??100)});}
        catch(e){if(e instanceof TypeError)throw new HttpError(400,e.message);throw e;}
        json(res,200,result);return;
      }
      if (req.method==='POST'&&url.pathname==='/api/assets') {
        const permission=await access.authorize(req,{action:'import'});
        if (req.headers['content-type']?.split(';')[0]!=='application/octet-stream')throw new HttpError(415,'上传格式应为图片二进制');
        if (Number(req.headers['content-length']??0)>MAX_FILE_BYTES)throw new HttpError(413,'图片超过20MB');
        if (uploads>=2)throw new HttpError(429,'正在接收其他图片，请稍后重试');
        const name=url.searchParams.get('name')??'未命名图片',sourceLabel=url.searchParams.get('sourceLabel')??'';
        if (name.length>200||sourceLabel.length>200||/[\x00-\x1f]/.test(name+sourceLabel))throw new HttpError(400,'文件名或来源备注过长或无效');
        uploads++;
        try {
          const original=await readBody(req,MAX_FILE_BYTES);
          let prepared;try{prepared=await prepareImage(original);}catch{throw new HttpError(422,'图片无法完整读取，请使用静态JPG、PNG或WebP（20MB以内）');}
          const result=await library.enqueue({...prepared,name,sourceLabel},{beforeCommit:permission.check});
          json(res,202,{accepted:true,asset:{id:result.id},duplicate:result.duplicate===true});return;
        }finally{uploads--;}
      }
      const match=/^\/api\/assets\/([a-zA-Z0-9_-]{1,100})(?:\/(image|retry))?$/.exec(url.pathname);
      if (match) {
        const [,id,action]=match;
        const permission=await access.authorize(req,{action:req.method==='GET'?'read':req.method==='POST'&&action==='retry'?'retry':'edit'});
        const asset=await library.get(id);if(!asset)throw new HttpError(404,'未找到该素材');
        if(req.method==='GET'&&action==='image') {
          if(permission.check().level==='view'&&asset.status!=='imported')throw new HttpError(403,'当前账号不能查看待处理素材');
          const file=await library.file(id);if(!file)throw new HttpError(404,'图片尚未就绪');
          const bytes=file.bytes;if(!Buffer.isBuffer(bytes))throw new Error('Verified image buffer unavailable');
          const finalActor=permission.check(),currentAsset=library.get(id);
          if(!currentAsset||currentAsset.id!==id)throw new HttpError(404,'未找到该素材');
          if(typeof currentAsset.then==='function')throw new Error('Asset state must be checked synchronously before response');
          if(finalActor.level==='view'&&currentAsset.status!=='imported')throw new HttpError(403,'素材已变更，当前账号不能查看');
          res.writeHead(200,{'content-type':'image/jpeg','content-length':bytes.length,'cache-control':'no-store'});res.end(bytes);return;
        }
        if(req.method==='POST'&&action==='retry') {
          if(asset.status==='skipped')throw new HttpError(403,'已跳过素材须由管理者人工复核确认，不能通过重新识别恢复');
          let next;try{next=await library.retry(id,{beforeCommit:permission.check});}catch(e){if(e instanceof MaterialAuthError)throw e;throw new HttpError(409,'当前素材不能重试，请先等待分类结束');}
          json(res,202,{accepted:true,asset:{id:next.id}});return;
        }
        if(req.method==='PATCH'&&!action) {
          if(req.headers['content-type']?.split(';')[0]!=='application/json')throw new HttpError(415,'修改请求需使用JSON');
          let patch;try{patch=JSON.parse((await readBody(req,16_384)).toString('utf8'));}catch(e){if(e instanceof HttpError)throw e;throw new HttpError(400,'修改内容格式无效');}
          if (!patch||typeof patch!=='object'||Array.isArray(patch))throw new HttpError(400,'修改内容格式无效');
          const allowed=['category','tags','sourceLabel','availability','evidence','confirmed','reviewDecision'];
          if(Object.keys(patch).some(k=>!allowed.includes(k)))throw new HttpError(400,'修改中包含不支持的字段');
          if(patch.category!==undefined&&!CATEGORIES.includes(patch.category)||patch.availability!==undefined&&!AVAILABILITY.some(x=>x.value===patch.availability))throw new HttpError(400,'品类或供货状态无效');
          const checks=[permission];
          if(Object.hasOwn(patch,'availability')||Object.hasOwn(patch,'evidence'))checks.push(await access.authorize(req,{action:'availability',confirmed:patch.confirmed,evidence:patch.evidence}));
          if(Object.hasOwn(patch,'reviewDecision'))checks.push(await access.authorize(req,{action:'review',confirmed:patch.confirmed}));
          const beforeCommit=()=>{let actor;for(const ticket of checks)actor=ticket.check();return actor;};
          let next;try{next=await library.update(id,patch,{beforeCommit});}catch(e){if(e instanceof MaterialAuthError)throw e;throw new HttpError(400,'修改未保存。请检查标签、来源，以及供货状态的确认依据；分类中请稍后再试。');}
          json(res,200,{accepted:true,asset:{id:next.id}});return;
        }
      }
      throw new HttpError(404,'未找到此功能');
    } catch(e) {
      const known=e instanceof HttpError||e instanceof MaterialAuthError;
      if(!res.headersSent)json(res,known?e.status:500,{error:known?e.message:'操作未完成，素材仍保留。请刷新重试或查看候选运行日志。',...(e instanceof MaterialAuthError?{code:e.code}:{})});
      else res.end();
      if(!known)console.error('Candidate request failed:',e);
    }
  };
}

export async function createApplication({dataRoot=path.join(projectRoot,'runtime','data'),port=21964,classify=createReviewFirstClassifier(createClassifier({model:SERVICE_MODEL})),libraryFactory=openLibrary,accounts=[],resolveAuthority,authorityHostFactory=createCandidateAuthorityHost}={}) {
  const library=await libraryFactory({root:dataRoot,classify});
  let origin,authorityHost,access;
  let requestHandler;
  const server=http.createServer((req,res)=>{if(requestHandler)return requestHandler(req,res);json(res,503,{error:'素材服务正在准备'});});
  server.requestTimeout=45_000;server.headersTimeout=15_000;
  try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});}
  catch(e){await library.close();throw e;}
  origin=`http://127.0.0.1:${server.address().port}`;
  try{authorityHost=authorityHostFactory({origin,accounts});access=createMaterialAccessAdapter({origin,resolveAuthority:resolveAuthority??authorityHost.resolveAuthority});}
  catch(e){await new Promise(resolve=>server.close(resolve));authorityHost?.close();await library.close();throw e;}
  requestHandler=createMaterialRequestHandler({library,origin,access,authorityHost});
  return {origin,server,library,authorityHost,async close(){await new Promise(resolve=>server.close(resolve));await library.close();authorityHost?.close();}};
}
export async function loadCandidateAccounts(){
  const privateFile=path.join(projectRoot,'runtime','candidate-accounts.json');await fs.mkdir(path.dirname(privateFile),{recursive:true});
  let accounts;try{const info=await fs.lstat(privateFile);if(!info.isFile()||info.isSymbolicLink())throw Error('Candidate credential path is invalid');accounts=JSON.parse(await fs.readFile(privateFile,'utf8'));}
  catch(e){if(e.code!=='ENOENT')throw e;accounts=[['candidate_view','仅查看测试员工','view'],['candidate_editor','素材整理测试员工','operate'],['candidate_manager','素材管理测试员工','manage']].map(([username,name,level])=>({username,name,level,password:randomBytes(24).toString('base64url')}));await fs.writeFile(privateFile,JSON.stringify(accounts,null,2),{flag:'wx',mode:0o600});}
  return accounts;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const app=await createApplication({accounts:await loadCandidateAccounts()});console.log(`员工权限素材候选已启动：${app.origin}`);
  let closing=false;const stop=async()=>{if(closing)return;closing=true;await app.close();process.exitCode=0;};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
}

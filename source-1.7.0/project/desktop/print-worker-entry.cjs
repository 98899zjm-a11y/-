'use strict';
const path=require('node:path');
const fs=require('node:fs');
const {createPrintAgent}=require('./print-agent.cjs');
const {createPrintWorkerServer,validateEndpoint}=require('./print-worker-transport.cjs');
const {createElectronPrintRenderer}=require('./print-worker-renderer.cjs');
function diagnostic(code,message){try{process.stderr.write(JSON.stringify({event:'xjy-print-worker-error',code,message:String(message).slice(0,800)})+'\n');}catch{/* A lost parent pipe must never prevent worker cleanup. */}}
function validateBootstrap(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['version','endpoint','secret','sandbox','pdfDependenciesRoot','profileDir'].includes(k))||input.version!==1||typeof input.sandbox!=='boolean')throw Error('打印 worker bootstrap 配置无效');
  validateEndpoint(input.endpoint);if(typeof input.secret!=='string'||Buffer.byteLength(input.secret)<32||Buffer.byteLength(input.secret)>512)throw Error('打印 worker private secret 认证配置无效');
  if(input.pdfDependenciesRoot!==undefined&&(typeof input.pdfDependenciesRoot!=='string'||!path.isAbsolute(input.pdfDependenciesRoot)))throw Error('打印 worker PDF dependency 配置无效');
  if(typeof input.profileDir!=='string'||!path.isAbsolute(input.profileDir)||/^[\\/]{2}|[\x00-\x1f]/.test(input.profileDir)||process.platform==='win32'&&input.profileDir.slice(2).includes(':'))throw Error('打印 worker profile 缓存目录必须明确指定本机普通绝对目录');
  const profile=path.resolve(input.profileDir);for(let current=profile;;current=path.dirname(current)){if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())throw Error('打印 worker profile 缓存目录不能使用链接');if(current===path.dirname(current))break;}
  if(!fs.existsSync(profile)||!fs.lstatSync(profile).isDirectory())throw Error('打印 worker profile 缓存目录不存在，请主机先验证准备');return{...input,profileDir:profile};
}
async function bootPrintWorker({electron,config,rendererFactory=createElectronPrintRenderer}){
  const trusted=validateBootstrap(config),{app,protocol}=electron;
  // A distinct single-instance lock from the business application allows one
  // printing process and one business process, with no second consumer.
  app.setPath('userData',trusted.profileDir);app.setPath('sessionData',trusted.profileDir);
  if(!app.requestSingleInstanceLock()){diagnostic('PRINT_WORKER_ALREADY_RUNNING','打印专属缓存仍由另一打印代理占用，请先核对打印任务并正常关闭旧程序；不会自动重发');app.quit();return null;}
  protocol.registerSchemesAsPrivileged([{scheme:'xjy-print',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
  app.on('window-all-closed',()=>{});await app.whenReady();
  const {buildSalesTemplate}=require('./generated/print-worker-templates.cjs');
  const rasterizePdf=trusted.pdfDependenciesRoot?require('./print-worker-pdf.cjs').createPdfRasterizer({dependenciesRoot:trusted.pdfDependenciesRoot}):undefined;
  const {loadFixedPrintRegistry,getPrintSourcePolicy}=require('./print-source-assets.cjs');
  const fixedRegistry=loadFixedPrintRegistry();
  const renderer=rendererFactory({electron,buildTemplate:buildSalesTemplate,rasterizePdf,getSourcePolicy:kind=>getPrintSourcePolicy(kind,{fixedRegistry})});
  const fakeDevices=[{name:'\\\\192.168.1.196\\EPSON LQ-630K ESC/P2',displayName:'Sandbox fake EPSON',status:0,options:{}},{name:'Deli M2500ADW-35J04Y(WLAN)',displayName:'Sandbox fake Deli',status:0,options:{}}];
  // This mode performs real passive rendering but cannot call either native
  // enumeration or native print. Only explicitly chosen production mode can.
  const agent=createPrintAgent({renderer,enumerate:trusted.sandbox?async()=>fakeDevices:renderer.enumerate,submit:trusted.sandbox?()=>Promise.resolve({status:'submitted'}):renderer.submit});
  let stopPromise;const server=createPrintWorkerServer({endpoint:trusted.endpoint,secret:trusted.secret,agent,onClosed:reason=>{if(reason?.code!=='PRINT_WORKER_CLOSED')diagnostic(reason.code,reason.message);void stop().catch(()=>diagnostic('PRINT_WORKER_CLOSE_FAILED','打印代理关闭未能确认，请先核对打印任务')).finally(()=>app.quit());}});
  function stop(){if(!stopPromise)stopPromise=(async()=>{try{await server.close();}finally{await renderer.close();}})();return stopPromise;}
  app.once('before-quit',()=>{void stop().catch(()=>diagnostic('PRINT_WORKER_CLOSE_FAILED','打印代理关闭未能确认，请先核对打印任务'));});
  try{await server.listen();}catch(error){try{await stop();}catch{}throw error;}return{stop,sandbox:trusted.sandbox};
}
async function readBootstrap(){let text=process.env.XJY_CENTRAL_PRINT_WORKER_BOOTSTRAP;delete process.env.XJY_CENTRAL_PRINT_WORKER_BOOTSTRAP;if(text===undefined){text='';for await(const chunk of process.stdin){text+=chunk.toString('utf8');if(Buffer.byteLength(text)>8192)throw Error('Bootstrap limit');}}if(Buffer.byteLength(text)>8192)throw Error('Bootstrap limit');return validateBootstrap(JSON.parse(text));}
async function runStandalone(){if(!process.argv.includes('--xjy-print-worker'))throw Error('独立打印 worker 只能通过固定受控启动参数启动');const config=await readBootstrap();const worker=await bootPrintWorker({electron:require('electron'),config});if(worker)process.stdout.write(JSON.stringify({event:'xjy-print-worker-ready',sandbox:worker.sandbox})+'\n');}
if(require.main===module||process.versions.electron&&process.type==='browser'&&process.argv.some(arg=>path.resolve(arg)===__filename))runStandalone().catch(()=>{diagnostic('PRINT_WORKER_START_FAILED','打印代理启动失败，请核对程序文件与专属缓存配置');process.exitCode=1;try{require('electron').app.quit();}catch{}});
module.exports={validateBootstrap,bootPrintWorker,runStandalone};

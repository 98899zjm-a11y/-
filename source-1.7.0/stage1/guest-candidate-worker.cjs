'use strict';
// Independent guest-only observer of the sealed candidate's real passive worker.
// Pure exports below never import Electron; the executable entry gates first.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {randomUUID,randomBytes,createHash}=require('node:crypto');
const ROOT=path.resolve(__dirname,'..'),OUT=path.join(ROOT,'reports/candidate-fakehardware-worker');
let admittedApp;
// Readiness from the isolated preload can precede the first compositor surface.
// Only this test observation is retried. No print or queue operation is retried.
async function captureObservedPage(capture,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))){
 const transientErrors=[];
 for(let attempt=1;attempt<=8;attempt++)try{return {image:await capture(),attempts:attempt,transientErrors};}catch(error){
  if(error?.message!=='UnknownVizError'||attempt===8)throw error;
  transientErrors.push(error.message);await wait(180);
 }
}
function createBlockedElectron(actual){
 const counters={deviceApiCalls:0,nativeDelegations:0,windowsProtected:0,deferredWorkerQuitRequests:0};
 const BrowserWindow=new Proxy(actual.BrowserWindow,{construct(Target,args){
  const window=Reflect.construct(Target,args);
  try{for(const api of ['print','getPrintersAsync'])Object.defineProperty(window.webContents,api,{value:function(){counters.deviceApiCalls++;throw Error('Guest device API blocked before native delegation: '+api);},writable:false,configurable:false});counters.windowsProtected++;return window;}
  catch(error){if(typeof window.destroy==='function')window.destroy();throw error;}
 }});
 // The standalone worker normally exits when its authenticated client closes.
 // This independent observer persists cleanup evidence before the real quit.
 // All identity properties (including isPackaged) still reflect the real app.
 const app=actual.app?new Proxy(actual.app,{get(target,key){if(key==='quit')return()=>{counters.deferredWorkerQuitRequests++;};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}}):actual.app;
 return{electron:{...actual,BrowserWindow,...(app?{app}:{})},counters};
}
function minimalPdf(){
 const stream='BT /F1 18 Tf 50 780 Td (Fictitious candidate print) Tj ET\n';
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Count 1 /Kids [3 0 R] >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`];
 let text='%PDF-1.4\n';const positions=[0];objects.forEach((object,index)=>{positions.push(Buffer.byteLength(text));text+=(index+1)+' 0 obj\n'+object+'\nendobj\n';});
 const start=Buffer.byteLength(text);text+='xref\n0 6\n0000000000 65535 f \n'+positions.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+start+'\n%%EOF\n';return Buffer.from(text,'ascii');
}
async function main(){
 // No Electron import, ASAR import, profile mutation or device factory beforehand.
 const actualContext=require('./guest-candidate-cdp.cjs').actualGuard();
 const candidate=path.join(ROOT,'release-candidate'),code=path.join(candidate,'resources/app.asar');
 const original=require('electron'),{electron,counters}=createBlockedElectron(original);
 admittedApp=original.app;
 const guard=require(path.join(code,'managed-print-worker.cjs')).createOwnedPathGuard(ROOT);
 guard.check(OUT);fs.mkdirSync(OUT,{recursive:true});if(fs.existsSync(path.join(OUT,'result.json')))throw Error('Fresh worker result required');
 const profileDir=guard.check(path.join(ROOT,'runtime/candidate-fakehardware-worker/cache'));
 if(fs.existsSync(profileDir))throw Error('Fresh observed worker profile required');fs.mkdirSync(profileDir,{recursive:true});guard.check(profileDir);
 const endpoint='\\\\.\\pipe\\xjy-print-worker-'+randomUUID(),secret=randomBytes(48).toString('base64url');
 const config={version:1,endpoint,secret,sandbox:true,profileDir,pdfDependenciesRoot:path.join(candidate,'resources/print-dependencies/node_modules')};
 const {bootPrintWorker}=require(path.join(code,'print-worker-entry.cjs'));
 const {createElectronPrintRenderer}=require(path.join(code,'print-worker-renderer.cjs'));
 const {createPrintWorkerClient}=require(path.join(code,'print-worker-client.cjs'));
 const {fingerprintPrintPayload}=require(path.join(code,'print-agent.cjs'));
 const prepared=[];let worker,client,gateCalls=0;
 const evidence={actualCheckPassed:false,actualContext,realPassiveHtmlPrepared:false,realPassivePdfPrepared:false,deviceApiCalls:0,nativeDelegations:0,candidateCodeDir:code,appIsPackagedObserved:original.app.isPackaged,productionAppIsPackagedOverridden:false,prepared,tests:[]};
 try{
  worker=await bootPrintWorker({electron,config,rendererFactory:options=>{
   const real=createElectronPrintRenderer(options);
   return{...real,async render(payload){const state=await real.render(payload);assert.equal(state.readiness?.ok,true,'Real isolated preload readiness required');assert.ok(state.readiness.pages>0);assert.equal(state.window.webContents.getURL(),state.url);const observation=await captureObservedPage(()=>state.window.webContents.capturePage()),png=observation.image.toPNG();assert.ok(png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));const name=`prepared-${prepared.length+1}-${payload.kind}.png`;fs.writeFileSync(guard.check(path.join(OUT,name)),png,{flag:'wx'});prepared.push({kind:payload.kind,renderMode:payload.renderMode||'sales-template',readiness:state.readiness,webContentsId:state.window.webContents.id,url:state.url,capture:name,captureSha256:createHash('sha256').update(png).digest('hex'),captureAttempts:observation.attempts,captureTransientErrors:observation.transientErrors});return state;}};
  }});
  assert.equal(worker.sandbox,true,'Actual fixed worker sandbox branch required');
  client=createPrintWorkerClient({endpoint,secret,timeoutMs:60000});const devices=await client.getDevices();assert.equal(devices[0].displayName,'Sandbox fake EPSON');
  const device='Deli M2500ADW-35J04Y(WLAN)',route={printerId:'p_'+createHash('sha256').update('xjy-native-printer:'+device).digest('hex').slice(0,32),deviceName:device,label:'Sandbox fake Deli',routingRevision:1,paper:'A4'};
  async function submit(kind,document,presentation={},selectedRoute=route){const payload={jobId:randomUUID(),kind,document,presentation,route:selectedRoute,copies:1};payload.payloadHash=fingerprintPrintPayload(payload);const result=await client.print(payload,{assertAuthorized:async()=>{gateCalls++;return{jobId:payload.jobId,payloadHash:payload.payloadHash,route:payload.route,copies:1,expiresAt:Date.now()+4000};}});evidence.tests.push({kind,result});assert.equal(result.status,'submitted',JSON.stringify(result));return result;}
  await submit('erp-document-a4',{format:'erp-json',sourceType:'erp-document-a4',data:{number:'FAKE-CANDIDATE',lines:[{name:'虚构铂金素链',weight:'6.300',amountCents:289800}]}});
  await submit('inventory-report-a4',{format:'trusted-html',sourceType:'inventory-report-a4',contentType:'text/html',bodyBase64:Buffer.from('<!doctype html><html><head><meta charset="utf-8"><style>@page{size:A4;margin:14mm}body{margin:0;width:180mm}</style></head><body><script>window.print();throw Error("must remain passive")</script><p>虚构原报表 6.300克</p></body></html>').toString('base64')});
  await submit('ledger-report-a4',{format:'trusted-pdf',sourceType:'ledger-report-a4',contentType:'application/pdf',bodyBase64:minimalPdf().toString('base64')});
  const quote={id:randomUUID(),number:'XS-CANDIDATE-FAKE',createdAt:'2026-10-15T00:00:00Z',snapshot:{type:'sale',customerId:'fake-customer',customer:{name:'虚构客户'},title:'铂金素链',weight:6.3,goldPrice:450,laborPrice:10,material:'platinum',extras:[],discountType:'none',saleItems:[],images:[],image:'',paymentMethods:[]}};
  await submit('quotation-a4',{format:'quotation',quote},{language:'zh'});
  const epson='\\\\192.168.1.196\\EPSON LQ-630K ESC/P2',warrantyRoute={printerId:'p_'+createHash('sha256').update('xjy-native-printer:'+epson).digest('hex').slice(0,32),deviceName:epson,label:'Sandbox fake EPSON',routingRevision:1,paper:{widthMm:210,heightMm:297}};
  await submit('warranty',{format:'warranty',quote},{language:'zh',settings:{mode:'fields',widthMm:210,heightMm:297,offsetXmm:1,offsetYmm:2,scalePercent:100,phone:'虚构电话',afterSalesWechat:'虚构微信',layoutOffsets:{},fontSizes:{'1026':10}},warranty:{itemIndexes:[0],overrides:[{itemIndex:0,goodsNumber:'PT-FAKE'}]}},warrantyRoute);
  assert.equal(gateCalls,5);assert.equal(prepared.length,5);assert.equal(counters.deviceApiCalls,0);assert.equal(counters.nativeDelegations,0);assert.ok(counters.windowsProtected>=5);
  evidence.realPassiveHtmlPrepared=prepared.some(row=>row.renderMode==='passive-html');evidence.realPassivePdfPrepared=prepared.some(row=>row.renderMode==='passive-pdf-pages');evidence.actualCheckPassed=evidence.realPassiveHtmlPrepared&&evidence.realPassivePdfPrepared;
 }catch(error){evidence.error=error.stack||String(error);process.exitCode=1;}
 finally{try{await client?.close();await worker?.stop();if(worker&&client){const deadline=Date.now()+5000;while(counters.deferredWorkerQuitRequests<1&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));assert.ok(counters.deferredWorkerQuitRequests>=1,'Actual worker completion must request its normal quit before observer evidence is written');}}catch(error){evidence.cleanupError=error.stack||String(error);evidence.actualCheckPassed=false;process.exitCode=1;}Object.assign(evidence,counters,{gateCalls});fs.writeFileSync(guard.check(path.join(OUT,'result.json')),JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(evidence));original.app.quit();}
 if(!evidence.actualCheckPassed)process.exitCode=1;
}
function run(){return main().catch(error=>{console.error(error.stack||String(error));process.exitCode=1;admittedApp?.quit();});}
if(require.main===module||process.versions.electron&&process.type==='browser'&&process.argv.some(arg=>path.resolve(arg)===__filename))run();
module.exports={createBlockedElectron,minimalPdf,captureObservedPage,run};

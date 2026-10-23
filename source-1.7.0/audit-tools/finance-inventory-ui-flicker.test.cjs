'use strict';
// Root-only actual Guest lifecycle contracts. No browser, DB, listener or EXE.
// These contracts expose CSS sent to Electron, not computed style or GUI proof.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'..'),sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
if(process.platform!=='win32'||ROOT.toLowerCase()!=='c:\\xjy-work\\xjy-web-stage1')throw Error('Fixed actual Guest required before source evaluation');
function read(relative,max=4*1024*1024){
 const file=path.join(ROOT,...relative.split('/')),rel=path.relative(ROOT,file);
 if(rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))throw Error('Input outside Root');
 for(let p=file;;p=path.dirname(p)){const stat=fs.lstatSync(p);if(stat.isSymbolicLink()||stat.isFile()&&stat.nlink!==1)throw Error('Input links refused');if(p===path.dirname(p))break;}
 const stat=fs.statSync(file);if(!stat.isFile()||stat.size>max)throw Error('Bounded ordinary source required');return fs.readFileSync(file);
}
for(const [file,pin]of Object.entries({
 'stage1/guest-candidate-cdp.cjs':'59840b638d8797fb55241616cd0b8e4098075a76834a201b0e93c1a748f1bb32',
 'stage1/sandbox-context.py':'09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249',
 'stage1/validate-sandbox-context.py':'867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207',
}))if(sha(read(file))!==pin)throw Error('Original admission source changed');
const actualContext=require('../stage1/guest-candidate-cdp.cjs').actualGuard();
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),{EventEmitter}=require('node:events'),Module=require('node:module');
const FILES=[
 'project/desktop/module-views.cjs',
 'project/desktop/assets/integration/ledger-theme.css',
 'project/desktop/assets/integration/inventory-theme.css',
 'project/desktop/legacy-source/xjy-theme.css',
 'project/desktop/legacy-source/ledger/app/static/xjy-theme.css',
 'project/desktop/legacy-source/inventory/app/static/xjy-theme.css',
 'project/desktop/legacy-source/ledger/app/templates/base.html',
 'project/desktop/legacy-source/inventory/app/templates/base.html',
 'project/desktop/legacy-source/collaboration.html',
];
const testPin=process.env.XJY_UI_FLICKER_TEST_SHA256,pins=JSON.parse(process.env.XJY_UI_FLICKER_SOURCE_PINS||'null');
assert.match(testPin||'',/^[a-f0-9]{64}$/);assert.equal(sha(read('audit-tools/finance-inventory-ui-flicker.test.cjs')),testPin);
assert(pins&&typeof pins==='object'&&!Array.isArray(pins));assert.deepEqual(Object.keys(pins).sort(),FILES.slice().sort());
const sources=new Map();for(const file of FILES){assert.match(pins[file]||'',/^[a-f0-9]{64}$/);const bytes=read(file);assert.equal(sha(bytes),pins[file]);sources.set(file,bytes);}
console.log(JSON.stringify({purpose:'finance-inventory-native-theme-lifecycle',actualContext,testSha256:testPin,sourcePins:pins,methods:4,dbOpened:false,listenerStarted:false,browserStarted:false,computedStylesVerified:false,actualUiVerified:false}));

const no=name=>(..._args)=>{throw Error('No actual business/OS port allowed: '+name);};
const FAKE_ROOT=path.join(ROOT,'runtime','ui-flicker-memory-only'),assetsDir=path.join(FAKE_ROOT,'assets');
const canonicalTheme=sources.get('project/desktop/legacy-source/xjy-theme.css').toString('utf8');
function fixture(){
 const inserted=[],views=[],gateways=[],sessions=[];
 class Contents extends EventEmitter{
  constructor(){super();this.mainFrame={};this.id=100+views.length;this.address='';this.destroyed=false;}
  isDestroyed(){return this.destroyed;}
  setWindowOpenHandler(handler){this.popupPolicy=handler;}
  async loadURL(value){this.address=value;this.emit('did-finish-load');}
  getURL(){return this.address;}
  async insertCSS(css){inserted.push({contents:this,css});return 'memory-style';}
  async executeJavaScript(){return true;}
  focus(){}
  close(){this.destroyed=true;}
 }
 class View{constructor(){this.webContents=new Contents();views.push(this);}setBounds(value){this.bounds=value;}}
 const window=new EventEmitter();Object.assign(window,{isDestroyed:()=>false,getContentSize:()=>[1440,980],contentView:{addChildView(){},removeChildView(){}},webContents:{getZoomFactor:()=>1,executeJavaScript:async()=>true},isMinimized:()=>false,isFocused:()=>true});
 const assetSources=new Map(['ledger','inventory'].map(id=>[path.join(assetsDir,id+'-theme.css'),sources.get('project/desktop/assets/integration/'+id+'-theme.css').toString('utf8')]));
 const io={existsSync(file){assert(assetSources.has(file),'Only the declared in-memory presentation asset is readable');return true;},readFileSync(file,encoding){assert.equal(encoding,'utf8');assert(assetSources.has(file),'No filesystem fallback allowed');return assetSources.get(file);}};
 const overrides={
  'node:fs':io,'node:path':path,'node:crypto':crypto,
  './module-gateway.cjs':{createModuleGateway:async options=>{assert(['ledger','inventory'].includes(options.module));const gateway={origin:'http://127.0.0.1:42891',token:'fictional-token',close:async()=>{gateway.closed=true;}};gateways.push(gateway);return gateway;}},
  './module-workspace-policy.cjs':{authorizeModuleRequest:no('workspace request')},
  './module-print-source.cjs':{normalizeModulePrintLocation:no('print location')},
  './print-sources.cjs':{normalizePrintSource:no('print source')},
 };
 const module={exports:{}},sourceFile='project/desktop/module-views.cjs',file=path.join(ROOT,...sourceFile.split('/'));
 const wrapped=vm.runInNewContext(Module.wrap(sources.get(sourceFile).toString('utf8')),{Buffer,URL,Promise,Date,setTimeout,clearTimeout,console},{filename:file});
 wrapped(module.exports,id=>{assert(Object.hasOwn(overrides,id),'Unreviewed import refused: '+id);return overrides[id];},module,file,path.dirname(file));
 const manager=module.exports.createModuleViews({electron:{WebContentsView:View,BrowserWindow:no('BrowserWindow'),session:{fromPartition(){const session=new EventEmitter();Object.assign(session,{setPermissionCheckHandler(){},setPermissionRequestHandler(){},webRequest:{onBeforeRequest(){},onBeforeSendHeaders(){}},cookies:{get:async()=>[],remove:async()=>{}}});sessions.push(session);return session;}},dialog:{}},window,assetsDir,profileDir:path.join(FAKE_ROOT,'profile'),requireLogin:async()=>({id:'fictional-admin',role:'admin'}),network:{info:()=>({mode:'standalone'}),request:async request=>{assert.equal(request.path,'/api/internal-modules/status');return{ok:true,data:{modules:['ledger','inventory'].map(id=>({id,configured:true}))}};}}});
 function popup(){const p=new EventEmitter();p.webContents=new Contents();p.webContents.address=gateways[0].origin+'/reports/print';p.setMenu=()=>{};p.isDestroyed=()=>p.webContents.destroyed;p.destroy=()=>{p.webContents.close();p.emit('closed');};return p;}
 return{manager,inserted,views,gateways,popup};
}
function assertNoCompetingTheme(inserted,phase){
 const competing=inserted.filter(item=>item.css!==canonicalTheme);
 assert.equal(competing.length,0,phase+': a loaded module must retain its canonical static theme; observed competing runtime CSS SHA(s) '+competing.map(item=>sha(item.css)).join(','));
}

test('H00 same-origin navigation and popup guards remain in force while the module is opened',async()=>{
 const f=fixture();try{assert.equal((await f.manager.open('ledger')).ok,true);const contents=f.views[0].webContents;let denied=0;
  contents.emit('will-navigate',{preventDefault(){denied++;}},'https://outside.invalid/');assert.equal(denied,1);
  contents.emit('will-redirect',{preventDefault(){denied++;}},f.gateways[0].origin+'/sales');assert.equal(denied,1);
  assert.equal(contents.popupPolicy({url:'https://outside.invalid/'}).action,'deny');assert.equal(contents.popupPolicy({url:f.gateways[0].origin+'/reports/print'}).action,'allow');
 }finally{await f.manager.close();}
});
test('F01 entering finance does not recolor the loaded static workspace with a competing legacy stylesheet',async()=>{
 const f=fixture();try{await f.manager.open('ledger');assertNoCompetingTheme(f.inserted,'first finance entry');}finally{await f.manager.close();}
});
test('F02 a later inventory navigation keeps the same static workspace theme',async()=>{
 const f=fixture();try{await f.manager.open('inventory');f.inserted.length=0;const contents=f.views[0].webContents;contents.address=f.gateways[0].origin+'/materials';contents.emit('did-finish-load');assertNoCompetingTheme(f.inserted,'inventory next-page load');}finally{await f.manager.close();}
});
test('F03 a same-origin finance popup does not reapply the legacy module theme',async()=>{
 const f=fixture();try{await f.manager.open('ledger');f.inserted.length=0;const popup=f.popup();f.views[0].webContents.emit('did-create-window',popup);popup.webContents.emit('did-finish-load');assertNoCompetingTheme(f.inserted,'finance same-origin popup');}finally{await f.manager.close();}
});

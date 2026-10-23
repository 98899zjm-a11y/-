'use strict';
// Actual EmployeeUpdate function with controlled hooks/JSX objects, not DOM/GUI.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'..'),sha=body=>crypto.createHash('sha256').update(body).digest('hex');
if(process.platform!=='win32'||ROOT.toLowerCase()!=='c:\\xjy-work\\xjy-web-stage1')throw Error('Fixed actual Guest required before view evaluation');
function read(relative,max=4*1024*1024){const file=path.join(ROOT,...relative.split('/')),rel=path.relative(ROOT,file);if(rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))throw Error('Input escaped Root');for(let p=file;;p=path.dirname(p)){const s=fs.lstatSync(p);if(s.isSymbolicLink()||s.isFile()&&s.nlink!==1)throw Error('Ordinary unlinked input required');if(p===path.dirname(p))break;}const s=fs.statSync(file);if(!s.isFile()||s.size>max)throw Error('Input exceeds source bound');return fs.readFileSync(file);}
for(const [file,pin]of Object.entries({
 'stage1/guest-candidate-cdp.cjs':'59840b638d8797fb55241616cd0b8e4098075a76834a201b0e93c1a748f1bb32',
 'stage1/sandbox-context.py':'09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249',
 'stage1/validate-sandbox-context.py':'867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207',
}))if(sha(read(file))!==pin)throw Error('Original actual Guest guard changed');
// Original guard metadata admission is the only subprocess exception.
const actualContext=require('../stage1/guest-candidate-cdp.cjs').actualGuard();
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const sourceFile='project/desktop/renderer/employee-update.tsx',compilerFile='audit-tools/dependencies/node_modules/typescript/lib/typescript.js';
const TEST_SHA=process.env.XJY_UPDATE_VIEW_TEST_SHA256,SOURCE_SHA=process.env.XJY_UPDATE_VIEW_SOURCE_SHA256,COMPILER_SHA=process.env.XJY_UPDATE_VIEW_TYPESCRIPT_SHA256;
for(const value of [TEST_SHA,SOURCE_SHA,COMPILER_SHA])assert.match(value||'',/^[a-f0-9]{64}$/,'Root must freeze test/source/existing public compiler SHA');
assert.equal(sha(read('audit-tools/employee-update-view.test.cjs')),TEST_SHA);const source=read(sourceFile);assert.equal(sha(source),SOURCE_SHA);
assert.equal(sha(read('audit-tools/employee-update-presentation.test.cjs')),'a4426b942f617d3f9acb201a6dcadcec6700a7f05166bec67afab6d4f58d15ca','Frozen four-method contract stays unchanged');
assert.equal(sha(read(compilerFile,16*1024*1024)),COMPILER_SHA);const metadata=JSON.parse(read('audit-tools/dependencies/node_modules/typescript/package.json'));
assert.equal(metadata.name,'typescript');assert.equal(metadata.version,'5.9.3');assert.equal(metadata.license,'Apache-2.0');
const ts=require(path.join(ROOT,...compilerFile.split('/')));assert.equal(ts.version,'5.9.3');
const compiled=ts.transpileModule(source.toString('utf8'),{fileName:path.join(ROOT,sourceFile),reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}});
assert.equal((compiled.diagnostics||[]).filter(row=>row.category===ts.DiagnosticCategory.Error).length,0,'Actual renderer must have no transpile syntax errors');
console.log(JSON.stringify({purpose:'employee-update-controlled-hooks-view',actualContext,testSha256:TEST_SHA,sourceSha256:SOURCE_SHA,compilerSha256:COMPILER_SHA,methods:2,actualFunctionBody:true,controlledHookSnapshot:true,effectsExecuted:false,domVerified:false,guiVerified:false,networkOrBusinessExecuted:false}));

// Small tree/hook pattern already used by customer-directory-ui and backup B04.
const jsx=(type,props,key)=>({type,props:props||{},key}),jsxRuntime={jsx,jsxs:jsx,Fragment:Symbol.for('update-view.fragment')};
function nodes(value,result=[]){if(Array.isArray(value)){for(const child of value)nodes(child,result);}else if(value&&typeof value==='object'&&value.props){result.push(value);nodes(value.props.children,result);}return result;}
function text(value){if(value==null||typeof value==='boolean')return '';if(Array.isArray(value))return value.map(text).join(' ');return typeof value==='object'?text(value.props?.children):String(value);}
const hasClass=(node,name)=>String(node.props?.className||'').split(/\s+/).includes(name);
const nativeStatus=(phase,extra={})=>({phase,currentVersion:'1.6.1',targetVersion:'1.6.2',message:'虚构原生阶段提示',...extra});
function panelState(status,capability={supported:true,canInstall:true,currentVersion:'1.6.1',message:'虚构员工能力'}){return{loading:false,busy:['checking','downloading','verifying','installing','handoff'].includes(status.phase),status,capability,error:'',mobile:false};}
function render(state,{mobile=false,noBridge=false}={}){
 const calls={native:[],reload:0,close:0,stateWrites:0,effects:0},forbidden=name=>(..._args)=>{calls.native.push(name);throw Error('No native operation allowed in a controlled view snapshot: '+name);};
 const bridge=Object.fromEntries(['getEmployeeUpdateCapability','getEmployeeUpdateState','employeeUpdate','request','exitHost','setConnection'].map(name=>[name,forbidden(name)]));let states=0,memos=0;
 const react={useState(){states++;assert.equal(states,1,'Single declared PanelState hook expected');return[state,()=>{calls.stateWrites++;throw Error('Effects and state updates are not run by this snapshot');}];},useMemo(make){memos++;return make();},useEffect(){calls.effects++;}};
 const icons=new Proxy({}, {get:(_target,name)=>props=>jsx('svg',{...props,'data-fixture-icon':String(name)})});
 const module={exports:{}},window={jewelryDesktop:noBridge?undefined:bridge,location:{reload(){assert(mobile,'Desktop view cannot reload');calls.reload++;}},setInterval:forbidden('setInterval'),clearInterval:forbidden('clearInterval')};
 vm.runInNewContext(compiled.outputText,{module,exports:module.exports,window,console,require(name){if(name==='react')return react;if(name==='react/jsx-runtime')return jsxRuntime;if(name==='lucide-react')return icons;if(name==='./employee-update.css')return {};throw Error('Unreviewed renderer import refused: '+name);}},{filename:path.join(ROOT,sourceFile)});
 assert.equal(typeof module.exports.default,'function');const tree=module.exports.default({mobileSurface:mobile,onClose(){calls.close++;}});
 assert.equal(states,1);assert.equal(memos,1);assert.equal(calls.effects,2);assert.equal(calls.stateWrites,0);assert.equal(calls.native.length,0);return{tree,all:nodes(tree),calls};
}
function liveStatus(view){const values=view.all.filter(node=>node.props.role==='status');assert.equal(values.length,1,'Exactly one top-level stage status');assert.equal(values[0].props['aria-live'],'polite');return text(values[0]).trim();}
const buttons=view=>view.all.filter(node=>node.type==='button');
const progress=view=>view.all.filter(node=>node.type==='progress'||node.props.role==='progressbar');

test('U05 host and absent native capability lead the status with their actual reason, while mobile only refreshes',()=>{
 const cases=[
  {message:'仅员工电脑可以在这里升级，主机请由管理员更新。',supported:true,noBridge:false},
  {message:'本机版本尚未提供自动升级入口，请联系管理员。',supported:false,noBridge:true},
 ];
 for(const item of cases){const capability={supported:item.supported,canInstall:false,currentVersion:'1.6.1',message:item.message};const view=render(panelState(nativeStatus('idle',{message:item.message}),capability),{noBridge:item.noBridge});assert.equal(liveStatus(view),item.message,'Capability reason must lead the role=status, not only a bottom muted note');assert.equal(buttons(view).filter(node=>hasClass(node,'employee-update-primary')).length,0);assert.equal(progress(view).length,0);assert.equal(view.calls.native.length,0);assert.equal(view.calls.reload,0);}
 const message='手机无需安装 Windows 程序。',state=panelState(nativeStatus('idle',{message}),{supported:false,canInstall:false,currentVersion:'',message});state.mobile=true;
 const mobile=render(state,{mobile:true});assert.equal(liveStatus(mobile),message);assert.equal(progress(mobile).length,0);const primary=buttons(mobile).filter(node=>hasClass(node,'employee-update-primary'));assert.equal(primary.length,1);assert.match(text(primary[0]),/刷新页面/);assert.doesNotMatch(text(primary[0]),/开始升级|重试升级|安装/);primary[0].props.onClick();assert.equal(mobile.calls.reload,1);assert.equal(mobile.calls.native.length,0);
});

test('U06 actual JSX keeps one truthful native progress, unknown stages and passive hard-error controls',()=>{
 const download=render(panelState(nativeStatus('downloading',{received:5,total:10}))),bars=progress(download);assert.equal(bars.length,1);assert.equal(bars[0].type,'progress');assert.equal(bars[0].props.max,100);assert.equal(bars[0].props.value,50);assert.equal(bars[0].props['aria-label'],'更新包下载进度');assert.match(bars[0].props['aria-valuetext'],/50%/);assert.match(liveStatus(download),/下载/);assert.doesNotMatch(liveStatus(download),/50%/);
 const tracks=download.all.filter(node=>hasClass(node,'employee-update-progress-track'));assert.equal(tracks.length,1);assert([true,'true'].includes(tracks[0].props['aria-hidden']),'Visual-only track must be hidden with a valid React Booleanish true');assert.equal(nodes(tracks[0]).filter(node=>hasClass(node,'employee-update-progress-indicator')).length,1);assert.match(text(download.tree),/50%/);
 for(const phase of ['verifying','handoff']){const view=render(panelState(nativeStatus(phase,{received:10,total:10}))),bar=progress(view);assert.equal(bar.length,1);assert.equal(bar[0].type,'progress');assert.equal(bar[0].props.value,undefined,'Unknown stage omits the actual native value');assert.equal(bar[0].props['aria-valuenow'],undefined);assert.doesNotMatch(bar[0].props['aria-valuetext'],/\d+(?:\.\d+)?%/);assert.doesNotMatch(text(view.tree),/\d+(?:\.\d+)?%|升级完成|安装完成|安装成功|更新成功/);assert.equal(view.calls.native.length,0);}
 for(const [code,message]of [['ACCOUNT_CHANGED',/重新进入员工账号/],['CANCEL_FAILED',/保持程序打开.*联系管理员/]]){const state=panelState(nativeStatus('unavailable',{code,message:'虚构原生失败说明'}));state.error='虚构失败';const view=render(state),primary=buttons(view).filter(node=>hasClass(node,'employee-update-primary'));assert.equal(primary.length,1);assert.equal(primary[0].props.disabled,true,'Hard error has no ordinary retry');const alerts=view.all.filter(node=>node.props.role==='alert');assert.equal(alerts.length,1);assert.match(text(alerts[0]),message);assert.equal(view.calls.native.length,0);assert.equal(view.calls.reload,0);assert.equal(view.calls.close,0);}
});

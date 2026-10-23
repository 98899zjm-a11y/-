'use strict';
// Root alone runs in the original actual Guest. Pure compiled renderer/model only.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'..'),sha=body=>crypto.createHash('sha256').update(body).digest('hex');
if(process.platform!=='win32'||ROOT.toLowerCase()!=='c:\\xjy-work\\xjy-web-stage1')throw Error('Fixed actual Guest required before renderer evaluation');
function read(relative,max=4*1024*1024){const file=path.join(ROOT,...relative.split('/')),inside=path.relative(ROOT,file);if(inside==='..'||inside.startsWith('..'+path.sep)||path.isAbsolute(inside))throw Error('Reviewed input escaped Root');for(let p=file;;p=path.dirname(p)){const s=fs.lstatSync(p);if(s.isSymbolicLink()||s.isFile()&&s.nlink!==1)throw Error('Reviewed input link refused');if(p===path.dirname(p))break;}const s=fs.statSync(file);if(!s.isFile()||s.size>max)throw Error('Bounded ordinary source required');return fs.readFileSync(file);}
const PINS={
 'stage1/guest-candidate-cdp.cjs':'59840b638d8797fb55241616cd0b8e4098075a76834a201b0e93c1a748f1bb32',
 'stage1/sandbox-context.py':'09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249',
 'stage1/validate-sandbox-context.py':'867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207',
};
for(const [file,pin]of Object.entries(PINS))if(sha(read(file))!==pin)throw Error('Original actual Guest guard changed');
// Original guard's fixed metadata admission subprocess is the only process call.
const actualContext=require('../stage1/guest-candidate-cdp.cjs').actualGuard();
const test=require('node:test'),assert=require('node:assert/strict');
const sourcePath='project/desktop/renderer/employee-update.tsx',manifestPath='stage1/test-tools/manifest.json';
const SOURCE_SHA=process.env.XJY_UPDATE_UI_SOURCE_SHA256,MANIFEST_SHA=process.env.XJY_UPDATE_UI_MANIFEST_SHA256,TEST_SHA=process.env.XJY_UPDATE_UI_TEST_SHA256;
for(const value of [SOURCE_SHA,MANIFEST_SHA,TEST_SHA])assert.match(value||'',/^[a-f0-9]{64}$/,'Root-pinned public source/test/compiled manifest SHAs required');
assert.equal(sha(read('audit-tools/employee-update-presentation.test.cjs')),TEST_SHA);
assert.equal(sha(read(sourcePath)),SOURCE_SHA);assert.equal(sha(read(manifestPath)),MANIFEST_SHA);
assert.equal(sha(read('stage1/build-ui-tests.cjs')),'d5b468588e356a43a043c73dfd7ee31ffe64f152ebf086f5f782f22c08d83594');
assert.equal(sha(read('tests/renderer-test-loader.cjs')),'120c83f1f51fc5341f0b81ccb5bd63e3dfada41f1a39bc7841809a1980725823');
assert.equal(sha(read('tests/employee-update.test.cjs')),'4a9feac9da470fb941720b6ae8f2d9c37f59280228c9ceddc1c0f722e97bc3f9','Original update tests remain unchanged');
const metadata=JSON.parse(read(manifestPath)),item=metadata.modules?.['employee-update'];assert(item&&item.file==='employee-update.cjs');
assert.equal(item.sources.find(x=>x.file===sourcePath)?.sha256,SOURCE_SHA,'Compiled renderer must cover this exact actual source');
assert.match(item.sha256,/^[a-f0-9]{64}$/);assert.equal(sha(read('stage1/test-tools/'+item.file,8*1024*1024)),item.sha256);
const ui=require('../tests/renderer-test-loader.cjs').loadRenderer('employee-update');
console.log(JSON.stringify({purpose:'employee-update-presentation-finite-contracts',actualContext,testSha256:TEST_SHA,sourceSha256:SOURCE_SHA,compiledManifestSha256:MANIFEST_SHA,compiledRendererSha256:item.sha256,methods:4,pureModelOnly:true,jsxTreeExamined:false,guiVerified:false,updaterOrDatabaseRun:false}));

const status=(phase,extra={})=>({phase,currentVersion:'1.6.1',targetVersion:'1.6.2',message:'虚构原生状态',...extra});
function presentation(input,loading){
 assert.equal(typeof ui.getEmployeeUpdatePresentation,'function','UPDATE_PRESENTATION_REQUIRED: missing actual exported helper');
 const before={...input},result=ui.getEmployeeUpdatePresentation(Object.freeze(input),loading);
 assert.deepEqual(input,before,'Presentation cannot change native status');
 assert.deepEqual(Object.keys(result).sort(),['complete','kind','label','percent','stage']);
 assert(['determinate','indeterminate','none'].includes(result.kind));assert.equal(typeof result.complete,'boolean');
 assert.equal(typeof result.label,'string');assert(result.label.trim());assert.equal(typeof result.stage,'string');assert(result.stage.trim());
 return result;
}

test('U01 only a real valid downloading numerator and denominator produce the exact observed integer percent',()=>{
 for(const [received,total,percent]of [[0,10,0],[5,10,50],[10,10,100],[1,3,33],[99,100,99],[3.12,8,39]]){
  const input=status('downloading',{received,total}),view=presentation(input);
  assert.equal(view.kind,'determinate');assert.equal(view.percent,percent);assert.equal(view.stage,'downloading');assert.equal(view.complete,false);assert.match(view.label,/下载/);
  assert.deepEqual(view,presentation({...input},false),'Default loading is false; no presentation clock may advance observed progress');
 }
});

test('U02 incomplete nonfinite negative or overflowing download data stays indeterminate without fake zero or completion',()=>{
 const cases=[{}, {received:0}, {total:10}, {received:5,total:0}, {received:5,total:-10},
  {received:-1,total:10}, {received:11,total:10}, {received:NaN,total:10}, {received:5,total:NaN},
  {received:Infinity,total:10}, {received:5,total:Infinity}, {received:-Infinity,total:10},
  {received:'5',total:10}, {received:5,total:'10'}, {received:null,total:10}];
 for(const extra of cases){const view=presentation(status('downloading',extra));assert.equal(view.kind,'indeterminate');assert.equal(view.percent,null);assert.equal(view.stage,'downloading');assert.equal(view.complete,false);assert.match(view.label,/下载/);}
});

test('U03 checking verifying handoff and loading have no percent and ready is separate from latest or installed success',()=>{
 const cases=[
  ['checking','indeterminate',false,/检查/],['verifying','indeterminate',false,/校验/],
  ['installing','indeterminate',false,/助手|交给/],['handoff','indeterminate',false,/助手|重启/],
  ['ready','none',false,/已校验|校验完成/],['latest','none',true,/已是.*最新|已经是.*最新|当前最新版本/],
  ['available','none',false,/可用|新版本|可升级/],['idle','none',false,/检查|等待|升级/],
  ['error','none',false,/未完成|失败|停止|重试/],['unavailable','none',false,/不可用|无法|暂不|未提供|尚未/],
 ];
 for(const [phase,kind,complete,label]of cases){const view=presentation(status(phase,{received:10,total:10}));assert.equal(view.kind,kind);assert.equal(view.percent,null);assert.equal(view.stage,phase);assert.equal(view.complete,complete);assert.match(view.label,label);assert.doesNotMatch(view.label,/升级完成|安装完成|安装成功|更新成功/,'Latest means already current; a scheduled handoff is not completed installation');}
 for(const phase of ['latest','downloading','error']){const view=presentation(status(phase,{received:10,total:10}),true);assert.equal(view.kind,'indeterminate');assert.equal(view.percent,null);assert.equal(view.stage,'reading');assert.equal(view.complete,false);assert.match(view.label,/读取|加载/);}
});

function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};}
test('U04 original controller keeps one install intent retry lock late-poll rejection and dispose after presentation changes',async()=>{
 assert.equal(typeof ui.createEmployeeUpdatePanelController,'function');
 const changes=[],calls=[],first=deferred(),retry=deferred(),latePoll=deferred();let reads=0;
 const bridge={getEmployeeUpdateCapability:async()=>({supported:true,canInstall:true,currentVersion:'1.6.1',message:'虚构员工能力'}),
  getEmployeeUpdateState:()=>++reads===1?Promise.resolve(status('available')):latePoll.promise,
  employeeUpdate:input=>{calls.push({...input});return calls.length===1?first.promise:retry.promise;}};
 const model=ui.createEmployeeUpdatePanelController({bridge,onChange:state=>changes.push(state),refreshPage:()=>assert.fail('Desktop controller must not refresh the page')});
 await model.load();const one=model.upgrade(),duplicate=model.upgrade();assert.deepEqual(calls,[{intent:'install'}]);assert.equal(changes.at(-1).busy,true);
 const poll=model.poll();first.resolve({ok:false,error:'虚构连接失败，可重试',state:status('error')});await Promise.all([one,duplicate]);assert.equal(changes.at(-1).busy,false);assert.equal(changes.at(-1).status.phase,'error');
 latePoll.resolve(status('checking'));await poll;assert.equal(changes.at(-1).busy,false);assert.equal(changes.at(-1).status.phase,'error');assert.match(changes.at(-1).error,/虚构连接失败/);
 const again=model.upgrade(),duplicateRetry=model.upgrade();assert.deepEqual(calls,[{intent:'install'},{intent:'install'}]);assert.equal(changes.at(-1).busy,true);
 model.dispose();const count=changes.length;retry.resolve({ok:true,state:status('handoff')});await Promise.all([again,duplicateRetry]);assert.equal(changes.length,count,'Disposed UI cannot be revived by the retry result');
});

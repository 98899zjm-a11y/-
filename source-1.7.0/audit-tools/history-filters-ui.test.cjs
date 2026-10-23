'use strict';
// Actual history JSX and handlers, admitted only in the fixed offline Guest.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const root=path.resolve(__dirname,'..');
if(process.platform!=='win32'||os.userInfo().username.toLowerCase()!=='wdagutilityaccount'||root.toLowerCase()!=='c:\\xjy-work\\xjy-web-stage1')throw Error('Actual fixed Windows Sandbox required');
const guard=require('../stage1/isolation.cjs').createIsolationGuard(root);
if(require('node:child_process').spawnSync('C:\\Python314\\python.exe',['-I','-B',guard.assertPath(path.join(root,'stage1/validate-sandbox-context.py'))],{cwd:root,windowsHide:true}).status!==0)throw Error('Unchanged actual Guest admission failed');
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const ts=require(guard.assertPath(path.join(root,'audit-tools/dependencies/node_modules/typescript')));
const filename=guard.assertPath(path.join(root,'project/desktop/renderer/workspace.tsx'));
const source=fs.readFileSync(filename,'utf8'),ast=ts.createSourceFile(filename,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let expression;
function visit(node){if(ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.AmpersandAmpersandToken&&node.left.getText(ast)==='activePage === "history"')expression=node.getText(ast);ts.forEachChild(node,visit);}
visit(ast);assert(expression,'Actual history branch required');
const compiled=ts.transpileModule('module.exports=()=>('+expression+');',{fileName:filename,reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}});
assert.equal((compiled.diagnostics||[]).filter(x=>x.category===ts.DiagnosticCategory.Error).length,0);
const jsx=(type,props)=>({type,props:props||{}}),text=node=>Array.isArray(node)?node.map(text).join(' '):node==null||typeof node==='boolean'?'':typeof node==='object'?text(node.props?.children):String(node);
function nodes(node,out=[]){if(Array.isArray(node))node.forEach(x=>nodes(x,out));else if(node&&typeof node==='object'){out.push(node);nodes(node.props?.children,out);}return out;}
function harness({admin=true,busy=false}={}){
 const h={exports:[],state:{search:'虚构客户',typeFilter:'repair',dateFilter:'2026-10-10',fromFilter:'2026-10-01',toFilter:'2026-10-31',staffFilter:'synthetic-staff',statusFilter:'confirmed',historyPage:3}};
 const Field=props=>jsx('label',{children:[jsx('span',{children:props.label}),props.children]}),Button=props=>jsx('button',props),Icon=()=>jsx('svg',{});
 const scope={module:{exports:{}},require:name=>{assert.equal(name,'react/jsx-runtime');return{jsx,jsxs:jsx,Fragment:Symbol.for('fixture.fragment')};},activePage:'history',admin,busy,data:{users:[{id:'synthetic-staff',name:'虚构员工'}]},historyResult:{quotes:[],total:150,pageSize:50},Field,Button,Search:Icon,ChevronLeft:Icon,ChevronRight:Icon,Empty:props=>jsx('section',{children:[props.title,props.text]}),quoteRows:()=>{throw Error('Unexpected quote row execution in this fixture');},run:fn=>fn(),exportWorkbook:(kind,parameters)=>h.exports.push({kind,parameters})};
 for(const key of Object.keys(h.state)){scope[key]=h.state[key];scope['set'+key[0].toUpperCase()+key.slice(1)]=value=>{h.state[key]=value;scope[key]=value;};}
 scope.exports=scope.module.exports;vm.runInNewContext(compiled.outputText,scope,{filename});
 function realize(node){if(Array.isArray(node))return node.map(realize);if(!node||typeof node!=='object')return node;if(typeof node.type==='function')return realize(node.type(node.props));return{...node,props:{...node.props,children:realize(node.props?.children)}};}
 h.render=()=>realize(scope.module.exports());
 h.find=name=>{const control=nodes(h.render()).find(x=>['input','select'].includes(x.type)&&x.props['aria-label']===name);assert(control,'Actual control '+name);return control;};
 return h;
}
test('history dates have visible associated purposes and a note explaining combined conditions',()=>{
 const tree=harness().render(),all=nodes(tree),dates=all.filter(x=>x.type==='input'&&x.props.type==='date');assert.equal(dates.length,3);
 for(const [name,purpose] of [['报价日期',/报价保存日期.*单日/],['开始日期',/开始日期.*含/],['结束日期',/结束日期.*含/]]){
  const control=dates.find(x=>x.props['aria-label']===name);assert(control);
  assert(all.some(x=>x.type==='label'&&nodes(x).includes(control)&&purpose.test(text(x))),'Visible associated date label '+name);
 }
 assert.match(text(tree),/日期条件共同生效.*交集/);
});
test('history search has an explicit accessible purpose and preserves its input behavior',()=>{
 const h=harness(),control=nodes(h.render()).find(x=>x.type==='input'&&x.props.placeholder==='搜索客户、款式或报价编号');assert(control);assert.equal(control.props['aria-label'],'搜索客户、款式或报价编号');
 control.props.onChange({target:{value:'虚构报价123'}});assert.equal(h.state.search,'虚构报价123');assert.equal(h.state.historyPage,1);assert.equal(h.state.fromFilter,'2026-10-01');
});
test('all existing date/type/staff/status handlers reset page without changing other filters',()=>{
 const keys=[['报价类型','typeFilter','sale'],['报价日期','dateFilter','2026-10-12'],['开始日期','fromFilter','2026-10-02'],['结束日期','toFilter','2026-10-20'],['历史员工','staffFilter','other-synthetic'],['成交状态','statusFilter','unconfirmed']];
 for(const[name,key,value]of keys){const h=harness(),before={...h.state};h.find(name).props.onChange({target:{value}});assert.equal(h.state[key],value);assert.equal(h.state.historyPage,1);for(const other of Object.keys(before).filter(x=>x!==key&&x!=='historyPage'))assert.equal(h.state[other],before[other]);}
});
test('staff filtering remains administrator-only and export carries the entire original filter contract',()=>{
 const employee=harness({admin:false});assert(!nodes(employee.render()).some(x=>x.props['aria-label']==='历史员工'));
 const h=harness(),button=nodes(h.render()).find(x=>x.type==='button'&&text(x)==='导出 Excel');assert(button);button.props.onClick();assert.equal(h.exports.length,1);
 assert.equal(JSON.stringify(h.exports[0]),JSON.stringify({kind:'history',parameters:{search:'虚构客户',type:'repair',date:'2026-10-10',from:'2026-10-01',to:'2026-10-31',staffId:'synthetic-staff',status:'confirmed'}}));
});
test('history export retains busy protection and existing pagination remains reachable',()=>{
 const h=harness({busy:true}),all=nodes(h.render());assert.equal(all.find(x=>x.type==='button'&&text(x)==='导出 Excel').props.disabled,true);
 const previous=all.find(x=>x.props['aria-label']==='上一页历史'),next=all.find(x=>x.props['aria-label']==='下一页历史');assert(previous&&next);assert.equal(previous.props.disabled,false);assert.equal(next.props.disabled,true);previous.props.onClick();assert.equal(h.state.historyPage,2);
});

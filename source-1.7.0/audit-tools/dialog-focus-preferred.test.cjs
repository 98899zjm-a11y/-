'use strict';
// Independent supplement. Reuses the frozen fixture, never registers/edits its 19 tests.
// This explicitly schedules a legal parent focus before the real cleanup restoration.
// It is NOT an actual-browser MutationObserver/style or business-flow reproduction.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const root=path.resolve(__dirname,'..');
if(process.platform!=='win32'||os.userInfo().username.toLowerCase()!=='wdagutilityaccount'||root.toLowerCase()!=='c:\\xjy-work\\xjy-web-stage1')throw Error('Dialog preferred-focus supplement requires the fixed actual Windows Sandbox');
const guard=require('../stage1/isolation.cjs').createIsolationGuard(root);
const admission=require('node:child_process').spawnSync('C:\\Python314\\python.exe',['-I','-B',guard.assertPath(path.join(root,'stage1/validate-sandbox-context.py'))],{cwd:root,windowsHide:true,encoding:'utf8'});
if(admission.status!==0)throw Error('Unchanged actual Guest admission failed');
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),crypto=require('node:crypto');
const {createRequire}=require('node:module');
const ts=require(guard.assertPath(path.join(root,'audit-tools/dependencies/node_modules/typescript')));
const fixtureFile=guard.assertPath(path.join(root,'audit-tools/dialog-focus.test.cjs'));
const frozenSource=fs.readFileSync(fixtureFile,'utf8');
assert.equal(crypto.createHash('sha256').update(frozenSource).digest('hex'),'5c01cb512756763beaf8465cc3564e9d44838717c56ffadb8da92215f1a27dab','Reuse exactly the already-admitted fixed19 fixture, not a modified copy');
const fixtureAst=ts.createSourceFile(fixtureFile,frozenSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
assert.equal(fixtureAst.parseDiagnostics.length,0);
const firstTest=fixtureAst.statements.find(node=>ts.isExpressionStatement(node)&&ts.isCallExpression(node.expression)&&ts.isIdentifier(node.expression.expression)&&node.expression.expression.text==='test');
assert(firstTest,'Frozen fixture has a first top-level test registration');
const prelude=frozenSource.slice(0,firstTest.getFullStart());
const moduleScope={exports:{}};
vm.runInNewContext(prelude+'\nmodule.exports={fixture,jsx,external};',{
 module:moduleScope,exports:moduleScope.exports,require:createRequire(fixtureFile),process,__filename:fixtureFile,__dirname:path.dirname(fixtureFile),
 console,Buffer,setTimeout,clearTimeout,queueMicrotask,
},{filename:fixtureFile});
const {fixture,jsx,external}=moduleScope.exports;
assert.equal(typeof fixture,'function');assert.equal(typeof jsx,'function');assert.equal(typeof external,'function');

test('S00 reused frozen fixture observes the declared parent-focus-before-later-microtask schedule',()=>fixture(async env=>{
 const parent=env.create('button',{text:'虚构父层合法按钮'}),order=[];let laterFocus=null;
 queueMicrotask(()=>{parent.focus();order.push('parent-focus');});
 queueMicrotask(()=>{laterFocus=env.document.activeElement;order.push('later-microtask');});
 await env.settle();assert.equal(laterFocus===parent,true);assert.equal(JSON.stringify(order),JSON.stringify(['parent-focus','later-microtask']));
}));

test('S01 real Drawer/page cleanup restores its explicit trigger even if another legal parent control focused first',()=>fixture(async env=>{
 const opener=env.create('button',{text:'虚构打开预览'});opener.focus();
 const drawer=env.mount(env.drawer(),{open:true,onClose:()=>{},children:jsx('button',{id:'page-opener',children:'选择要复制的页'})});
 const trigger=drawer.find('#page-opener');trigger.focus();
 const page=env.mount(env.dialog(),{title:'虚构选页',onClose:()=>{},children:jsx('input',{autoFocus:true})});
 await env.settle();
 assert.equal(env.document.activeElement,page.find('input'),'Precondition: real page modal owns its actual autoFocus input');
 const otherParentControl=drawer.find('section[role="dialog"] button[aria-label]');let focusedBeforeRestore=false;
 // Explicit synthetic interleaving, representing an already-queued focus callback.
 // The product's own register/unregister/restoreFocus and both components remain real.
 queueMicrotask(()=>{otherParentControl.focus();focusedBeforeRestore=env.document.activeElement===otherParentControl;});
 page.dispose();await env.settle();
 assert.equal(focusedBeforeRestore,true,'The legal parent control really received focus before the actual restoration microtask');
 assert.equal(env.document.activeElement===trigger,true,'An explicit connected enabled trigger must take priority over a different currently-focused parent control');
 assert.equal(env.document.body.style.overflow,'hidden','Still-open parent retains its real shared lock');
}));

test('S02 real cleanup does not pull focus away from a newly opened higher external modal',()=>fixture(async env=>{
 const drawer=env.mount(env.drawer(),{open:true,onClose:()=>{},children:jsx('button',{id:'page-opener',children:'选择页'})});
 drawer.find('#page-opener').focus();
 const page=env.mount(env.dialog(),{title:'虚构选页',onClose:()=>{},children:jsx('input',{autoFocus:true})});
 await env.settle();let higher;
 queueMicrotask(()=>{higher=external(env,'a4');});
 page.dispose();await env.settle();
 assert(higher,'Explicit higher-modal fixture was opened before restoration');
 assert.equal(env.document.activeElement,higher.button,'Preferred restoration must still yield to the actual higher owner');
}));

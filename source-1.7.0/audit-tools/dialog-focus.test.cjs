'use strict';
// Guest-only source behavior tests. No Host bypass, product startup, DB or print.
// DOM, hook commit order and z-index values below are controlled model fixtures.
// They cannot prove real browser Tab order, CSS stacking, pixels or phone behavior.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const root=path.resolve(__dirname,'..');
if(process.platform!=='win32'||os.userInfo().username.toLowerCase()!=='wdagutilityaccount'||root.toLowerCase()!=='c:\\xjy-work\\xjy-web-stage1')throw Error('Dialog focus tests require the fixed actual Windows Sandbox');
const guard=require('../stage1/isolation.cjs').createIsolationGuard(root);
const admission=require('node:child_process').spawnSync('C:\\Python314\\python.exe',['-I','-B',guard.assertPath(path.join(root,'stage1/validate-sandbox-context.py'))],{cwd:root,windowsHide:true,encoding:'utf8'});
if(admission.status!==0)throw Error('Unchanged actual Guest admission failed');
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const ts=require(guard.assertPath(path.join(root,'audit-tools/dependencies/node_modules/typescript')));
const project=guard.assertPath(path.join(root,'project'));
const renderer=path.join(project,'desktop/renderer');
const workspaceFile=path.join(renderer,'workspace.tsx');
const jsx=(type,props,key)=>({type,props:props||{},key});
const jsxRuntime={jsx,jsxs:jsx,Fragment:Symbol.for('dialog-test.fragment')};
const same=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((x,i)=>Object.is(x,b[i]));
function compile(source,filename){
 const result=ts.transpileModule(source,{fileName:filename,reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}});
 assert.equal((result.diagnostics||[]).filter(x=>x.category===ts.DiagnosticCategory.Error).length,0,'Actual source must transpile without syntax diagnostics');
 return result.outputText;
}
function astFile(filename){return ts.createSourceFile(filename,fs.readFileSync(guard.assertPath(filename),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);}
function descendants(ast,predicate){const out=[];function visit(node){if(predicate(node))out.push(node);ts.forEachChild(node,visit);}visit(ast);return out;}
function actualClose(name,globals,env){
 const ast=astFile(workspaceFile);
 const tag=descendants(ast,node=>(ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node))&&node.tagName.getText(ast)===name&&(
  name!=='Dialog'||node.attributes.properties.some(prop=>ts.isJsxAttribute(prop)&&prop.name.text==='className'&&prop.initializer&&ts.isStringLiteral(prop.initializer)&&prop.initializer.text==='record-confirm-backdrop')
 ))[0];
 assert(tag,'Actual workspace '+name+' callback source exists');
 const attr=tag.attributes.properties.find(prop=>ts.isJsxAttribute(prop)&&prop.name.text==='onClose');
 assert(attr&&attr.initializer&&ts.isJsxExpression(attr.initializer)&&attr.initializer.expression,'Actual onClose expression exists');
 const context={module:{exports:{}},...env.globals,...globals};context.exports=context.module.exports;
 vm.runInNewContext(compile('module.exports=('+attr.initializer.expression.getText(ast)+');',workspaceFile),context,{filename:workspaceFile});
 return{fn:context.module.exports,context};
}

class FixtureStyle{
 constructor(){this.values=new Map();}
 setProperty(name,value,priority=''){this.values.set(name,{value:String(value),priority:String(priority)});}
 getPropertyValue(name){return this.values.get(name)?.value||'';}
 getPropertyPriority(name){return this.values.get(name)?.priority||'';}
 removeProperty(name){const previous=this.getPropertyValue(name);this.values.delete(name);return previous;}
}
for(const name of ['overflow','display','visibility','zIndex','position','pointerEvents','opacity','transform']){
 const css=name.replace(/[A-Z]/g,c=>'-'+c.toLowerCase());
 Object.defineProperty(FixtureStyle.prototype,name,{get(){return this.getPropertyValue(css);},set(value){this.setProperty(css,value);}});
}
function splitOutside(text,separator){
 const result=[];let round=0,square=0,quote='',start=0;
 for(let i=0;i<text.length;i++){const c=text[i];if(quote){if(c===quote&&text[i-1]!=='\\')quote='';continue;}if(c==='"'||c==="'"){quote=c;continue;}if(c==='(')round++;if(c===')')round--;if(c==='[')square++;if(c===']')square--;if(!round&&!square&&c===separator){result.push(text.slice(start,i).trim());start=i+1;}}
 result.push(text.slice(start).trim());return result.filter(Boolean);
}
function compound(node,selector){
 if(!(node instanceof FixtureElement))return false;
 let rest=selector.trim(),match=rest.match(/^([a-z][\w-]*|\*)/i);
 if(match){if(match[1]!=='*'&&node.localName!==match[1].toLowerCase())return false;rest=rest.slice(match[0].length);}
 while(rest){
  if((match=rest.match(/^([.#])([\w-]+)/))){if(match[1]==='.'?!node.classList.contains(match[2]):node.id!==match[2])return false;rest=rest.slice(match[0].length);continue;}
  if(rest.startsWith(':not(')){
   let depth=1,end=5;for(;end<rest.length&&depth;end++){if(rest[end]==='(')depth++;if(rest[end]===')')depth--;}
   assert.equal(depth,0,'Fixture selector has a balanced :not');
   if(matches(node,rest.slice(5,end-1)))return false;rest=rest.slice(end);continue;
  }
  if((match=rest.match(/^\[([\w-]+)(?:\s*([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+)))?\s*\]/))){
   const value=node.getAttribute(match[1]),expected=match[3]??match[4]??match[5],operator=match[2];
   if(value===null)return false;
   if(operator&&!(operator==='='?value===expected:operator==='^='?value.startsWith(expected):operator==='$='?value.endsWith(expected):operator==='*='?value.includes(expected):operator==='~='?value.split(/\s+/).includes(expected):operator==='|='?value===expected||value.startsWith(expected+'-'):false))return false;
   rest=rest.slice(match[0].length);continue;
  }
  if((match=rest.match(/^:([\w-]+)/))){
   const value=match[1];
   if(value==='disabled'){if(!node.actuallyDisabled())return false;}
   else if(value==='enabled'){if(node.actuallyDisabled())return false;}
   else if(value==='checked'){if(!node.checked)return false;}
   else if(value==='scope'){/* caller scope is separately bounded */}
   else if(value==='focus'){if(node.ownerDocument.activeElement!==node)return false;}
   else throw Error('Unsupported fixture pseudo selector '+value+'; extend the harness explicitly, not a product failure');
   rest=rest.slice(match[0].length);continue;
  }
  throw Error('Unsupported fixture selector '+rest+'; extend the harness explicitly, not a product failure');
 }
 return true;
}
function matches(node,selector){
 return splitOutside(selector,',').some(part=>{
  // Minimal actual selectors supported: compound and descendant. No silent wildcard.
  const pieces=splitOutside(part,' ');let current=node;
  if(!compound(current,pieces.pop()))return false;
  while(pieces.length){const wanted=pieces.pop();current=current.parentElement;while(current&&!compound(current,wanted))current=current.parentElement;if(!current)return false;}
  return true;
 });
}
class FixtureEvent{
 constructor(type,options={}){Object.assign(this,{type,bubbles:true,cancelable:true,key:'',shiftKey:false,isComposing:false,keyCode:0,defaultPrevented:false,_stop:false,_immediate:false,target:null,currentTarget:null,eventPhase:0},options);}
 preventDefault(){if(this.cancelable)this.defaultPrevented=true;}
 stopPropagation(){this._stop=true;}
 stopImmediatePropagation(){this._stop=true;this._immediate=true;}
 composedPath(){return this._path||[];}
}
class FixtureTarget{
 constructor(){this.listeners=new Map();}
 addEventListener(type,fn,options){if(!fn)return;const capture=options===true||!!options?.capture;const list=this.listeners.get(type)||[];if(!list.some(x=>x.fn===fn&&x.capture===capture))list.push({fn,capture,once:!!options?.once});this.listeners.set(type,list);}
 removeEventListener(type,fn,options){const capture=options===true||!!options?.capture;this.listeners.set(type,(this.listeners.get(type)||[]).filter(x=>x.fn!==fn||x.capture!==capture));}
 invoke(event,capture,phase){
  event.currentTarget=this;event.eventPhase=phase;
  for(const entry of [...(this.listeners.get(event.type)||[])]){if(entry.capture!==capture)continue;if(event._immediate)break;if(entry.once)this.removeEventListener(event.type,entry.fn,entry.capture);if(typeof entry.fn==='function')entry.fn(event);else entry.fn.handleEvent(event);}
  if(!capture&&!event._immediate&&this.props){const handler=this.props['on'+event.type[0].toUpperCase()+event.type.slice(1)];if(handler)handler(event);}
 }
}
class FixtureElement extends FixtureTarget{
 constructor(tag,doc){super();this.localName=tag.toLowerCase();this.tagName=this.localName.toUpperCase();this.nodeName=this.tagName;this.nodeType=1;this.ownerDocument=doc;this.parentNode=null;this.children=[];this.attributes=new Map();this.style=new FixtureStyle();this.props={};this.value='';this.checked=false;this._text='';}
 get parentElement(){return this.parentNode instanceof FixtureElement?this.parentNode:null;}
 get childNodes(){return this.children;}
 get firstElementChild(){return this.children[0]||null;}
 get isConnected(){return this===this.ownerDocument.documentElement||!!this.parentNode?.isConnected;}
 get id(){return this.getAttribute('id')||'';}set id(value){this.setAttribute('id',value);}
 get className(){return this.getAttribute('class')||'';}set className(value){this.setAttribute('class',value);}
 get classList(){return{contains:value=>this.className.split(/\s+/).includes(value)};}
 get hidden(){return this.hasAttribute('hidden');}set hidden(value){if(value)this.setAttribute('hidden','');else this.removeAttribute('hidden');}
 get inert(){return this.hasAttribute('inert');}set inert(value){if(value)this.setAttribute('inert','');else this.removeAttribute('inert');}
 get disabled(){return this.hasAttribute('disabled');}set disabled(value){if(value)this.setAttribute('disabled','');else this.removeAttribute('disabled');}
 get tabIndex(){const raw=this.getAttribute('tabindex');if(raw!==null)return Number(raw);return ['button','input','select','textarea','summary'].includes(this.localName)||(this.localName==='a'&&this.hasAttribute('href'))?0:-1;}
 set tabIndex(value){this.setAttribute('tabindex',String(value));}
 get dataset(){const node=this;return new Proxy({},{get(_target,key){return node.getAttribute('data-'+String(key).replace(/[A-Z]/g,c=>'-'+c.toLowerCase()));},set(_target,key,value){node.setAttribute('data-'+String(key).replace(/[A-Z]/g,c=>'-'+c.toLowerCase()),String(value));return true;}});}
 get textContent(){return this._text+this.children.map(x=>x.textContent).join('');}set textContent(value){this._text=String(value);}
 setAttribute(name,value){name=name.toLowerCase();const old=this.attributes.get(name);this.attributes.set(name,String(value));if(old!==String(value))this.ownerDocument.changed(this,'attributes',name);}
 getAttribute(name){return this.attributes.get(name.toLowerCase())??null;}
 hasAttribute(name){return this.attributes.has(name.toLowerCase());}
 removeAttribute(name){name=name.toLowerCase();if(this.attributes.delete(name))this.ownerDocument.changed(this,'attributes',name);}
 appendChild(node){if(node.parentNode)node.parentNode.removeChild(node);node.parentNode=this;this.children.push(node);this.ownerDocument.changed(this,'childList');return node;}
 removeChild(node){const index=this.children.indexOf(node);assert(index>=0,'Fixture removes an actual child');this.children.splice(index,1);node.parentNode=null;if(node.contains(this.ownerDocument.activeElement))this.ownerDocument.activeElement=this.ownerDocument.body;this.ownerDocument.changed(this,'childList');return node;}
 remove(){if(this.parentNode)this.parentNode.removeChild(this);}
 contains(node){return this===node||this.children.some(child=>child.contains(node));}
 matches(selector){return matches(this,selector);}
 closest(selector){for(let node=this;node instanceof FixtureElement;node=node.parentElement)if(node.matches(selector))return node;return null;}
 querySelectorAll(selector){const out=[];for(const child of this.children){if(child.matches(selector))out.push(child);out.push(...child.querySelectorAll(selector));}return out;}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 actuallyDisabled(){if(this.disabled)return true;return ['button','input','select','textarea','fieldset'].includes(this.localName)&&!!this.parentElement?.closest('fieldset[disabled]');}
 visible(){if(this.localName==='input'&&this.getAttribute('type')==='hidden')return false;for(let node=this;node instanceof FixtureElement;node=node.parentElement){if(node.hidden||node.inert||node.getAttribute('aria-hidden')==='true'||node.style.display==='none'||node.style.visibility==='hidden'||(node.classList.contains('quote-drawer-shell')&&!node.classList.contains('open'))||node.classList.contains('integration-module-underlay'))return false;}return this.isConnected;}
 getClientRects(){return this.visible()?[this.getBoundingClientRect()]:[];}
 getBoundingClientRect(){return{x:0,y:0,left:0,top:0,right:400,bottom:300,width:400,height:300};}
 focus(options){this.ownerDocument.focusCalls.push({node:this,options});if(!this.visible()||this.actuallyDisabled()||this.localName==='input'&&this.getAttribute('type')==='hidden')return;if(this.localName!=='body'&&this.tabIndex<0&&!this.hasAttribute('tabindex'))return;const previous=this.ownerDocument.activeElement;this.ownerDocument.activeElement=this;if(previous!==this)this.ownerDocument.dispatchAt(this,new FixtureEvent('focusin',{relatedTarget:previous}));}
 dispatchEvent(event){return this.ownerDocument.dispatchAt(this,event);}
 click(){if(this.actuallyDisabled())return;this.focus();this.dispatchEvent(new FixtureEvent('click'));}
 compareDocumentPosition(other){if(this===other)return 0;if(!this.isConnected||!other.isConnected)return 1;const all=this.ownerDocument.all();return all.indexOf(this)<all.indexOf(other)?4:2;}
}
class FixtureDocument extends FixtureTarget{
 constructor(){super();this.nodeType=9;this.ownerDocument=this;this.isConnected=true;this.focusCalls=[];this.observers=new Set();this.documentElement=new FixtureElement('html',this);this.documentElement.parentNode=this;this.body=new FixtureElement('body',this);this.documentElement.appendChild(this.body);this.activeElement=this.body;this.defaultView=null;}
 all(){return[this.documentElement,...this.documentElement.querySelectorAll('*')];}
 contains(node){return this.documentElement.contains(node);}
 createElement(tag){return new FixtureElement(tag,this);}
 querySelectorAll(selector){return this.documentElement.matches(selector)?[this.documentElement,...this.documentElement.querySelectorAll(selector)]:this.documentElement.querySelectorAll(selector);}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 getElementById(id){return this.all().find(x=>x.id===id)||null;}
 hasFocus(){return true;}
 dispatchEvent(event){return this.dispatchAt(this,event);}
 dispatchAt(target,event){
  event.target=target;const chain=[];for(let at=target;at;at=at.parentNode)chain.push(at);if(!chain.includes(this))chain.push(this);if(this.defaultView)chain.push(this.defaultView);event._path=chain;
  for(let i=chain.length-1;i>=1&&!event._stop;i--)chain[i].invoke(event,true,1);
  if(!event._stop){target.invoke(event,true,2);if(!event._immediate)target.invoke(event,false,2);}
  if(event.bubbles)for(let i=1;i<chain.length&&!event._stop;i++)chain[i].invoke(event,false,3);
  event.currentTarget=null;event.eventPhase=0;return !event.defaultPrevented;
 }
 changed(target,type,attributeName){
  if(!this.observers)return;
  for(const observer of this.observers){if(!observer.root||!(observer.root===target||observer.options?.subtree&&observer.root.contains(target)))continue;if(type==='attributes'&&!observer.options?.attributes||type==='childList'&&!observer.options?.childList)continue;observer.records.push({target,type,attributeName});if(!observer.queued){observer.queued=true;queueMicrotask(()=>{observer.queued=false;const records=observer.takeRecords();if(observer.root&&records.length)observer.callback(records,observer);});}}
 }
}
function environment(){
 const document=new FixtureDocument(),window=new FixtureTarget(),modules=new Map(),instances=new Set();
 const env={document,window,instances,current:null,disposeCallbacks:[]};
 const zRules=[['quote-drawer-shell',90],['dialog-backdrop',100],['warranty-print-root',120],['network-modal-backdrop',140],['remote-print-backdrop',160],['host-print-backdrop',165],['record-confirm-backdrop',190],['a4-print-root',250]];
 const getComputedStyle=node=>{const z=node.style.zIndex||String(zRules.filter(([name])=>node.classList.contains(name)).at(-1)?.[1]??'auto');return{display:node.hidden?'none':node.style.display||'block',visibility:node.visible()?'visible':'hidden',zIndex:z,position:node.style.position||(z!=='auto'?'fixed':'static'),overflow:node.style.overflow,opacity:node.style.opacity||'1',getPropertyValue:name=>name==='z-index'?z:node.style.getPropertyValue(name)};};
 Object.assign(window,{document,getComputedStyle,HTMLElement:FixtureElement,Element:FixtureElement,Node:FixtureElement,addEventListener:window.addEventListener.bind(window),removeEventListener:window.removeEventListener.bind(window)});
 document.defaultView=window;
 const scope=document.createElement('fieldset');scope.className='workspace';document.body.appendChild(scope);env.scope=scope;
 class MutationObserver{
  constructor(callback){this.callback=callback;this.root=null;this.options=null;this.records=[];this.queued=false;document.observers.add(this);}
  observe(root,options){this.root=root;this.options=options;}
  disconnect(){this.root=null;this.records=[];}
  takeRecords(){const result=this.records;this.records=[];return result;}
 }
 const slots=()=>{assert(env.current,'Hooks run only inside the controlled actual component render');return env.current;};
 function hook(kind,create){const instance=slots(),index=instance.cursor++;if(!instance.slots[index])instance.slots[index]={kind,...create()};assert.equal(instance.slots[index].kind,kind,'Stable actual hook order');return instance.slots[index];}
 const react={
  useRef(initial){return hook('ref',()=>({value:{current:initial}})).value;},
  useState(initial){const instance=slots(),state=hook('state',()=>({value:typeof initial==='function'?initial():initial}));return[state.value,update=>{const next=typeof update==='function'?update(state.value):update;if(!Object.is(next,state.value)){state.value=next;instance.dirty=true;}}];},
  useMemo(make,deps){const state=hook('memo',()=>({deps:undefined,value:undefined}));if(!same(state.deps,deps)){state.deps=deps;state.value=make();}return state.value;},
  useCallback(fn,deps){return react.useMemo(()=>fn,deps);},
  useId(){return hook('id',()=>({value:'fixture-title-'+(++env.ids)})).value;},
  useEffect(effect,deps){effectHook('passive',effect,deps);},
  useLayoutEffect(effect,deps){effectHook('layout',effect,deps);},
 };
 env.ids=0;
 function effectHook(phase,effect,deps){const instance=slots(),state=hook(phase,()=>({deps:undefined,cleanup:undefined,effect:undefined}));if(!same(state.deps,deps))instance.pending.push({state,effect,deps,phase});}
 const icons=new Proxy({},{get(_target,name){return props=>jsx('svg',{...props,'data-test-icon':String(name)});}});
 env.globals={document,window,HTMLElement:FixtureElement,HTMLButtonElement:FixtureElement,Element:FixtureElement,Node:FixtureElement,MutationObserver,KeyboardEvent:FixtureEvent,Event:FixtureEvent,getComputedStyle,queueMicrotask,Promise,Map,Set,WeakMap,WeakSet,console,setTimeout,clearTimeout,requestAnimationFrame:fn=>setTimeout(()=>fn(0),0),cancelAnimationFrame:clearTimeout};
 function resolveImport(name,filename){const base=name.startsWith('@/')?path.join(project,name.slice(2)):path.resolve(path.dirname(filename),name);for(const candidate of [base,base+'.ts',base+'.tsx',path.join(base,'index.ts')])if(fs.existsSync(candidate)&&fs.statSync(candidate).isFile())return guard.assertPath(candidate);throw Error('Unresolved actual project import '+name);}
 function localRequire(name,filename){
  if(name==='react')return react;if(name==='react/jsx-runtime')return jsxRuntime;if(name==='lucide-react')return icons;if(name.endsWith('.css'))return{};
  if(name.startsWith('.')||name.startsWith('@/'))return load(resolveImport(name,filename));
  throw Error('Unreviewed dialog test import '+name);
 }
 function execute(source,filename,extra={}){
  const module={exports:{}};const context={...env.globals,...extra,module,exports:module.exports,require:name=>localRequire(name,filename)};
  vm.runInNewContext(compile(source,filename),context,{filename});return module.exports;
 }
 function load(filename){
  filename=guard.assertPath(filename);assert(filename.startsWith(project+path.sep),'Source imports stay in isolated project');
  if(modules.has(filename))return modules.get(filename).exports;
  const module={exports:{}};modules.set(filename,module);
  vm.runInNewContext(compile(fs.readFileSync(filename,'utf8'),filename),{...env.globals,module,exports:module.exports,require:name=>localRequire(name,filename)},{filename});return module.exports;
 }
 env.execute=execute;env.load=load;env.react=react;
 env.dialog=()=>{
  const ast=astFile(workspaceFile),declaration=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='Dialog');
  if(declaration)return execute('import {useEffect,useLayoutEffect,useRef,useState,useId,type ReactNode} from "react"; import {X} from "lucide-react"; '+declaration.getText(ast)+'\nmodule.exports=Dialog;',workspaceFile);
  const imported=ast.statements.find(node=>ts.isImportDeclaration(node)&&node.importClause?.name?.text==='Dialog');
  assert(imported,'Actual local Dialog declaration or default import must exist; review loader if extraction changes');
  return load(resolveImport(imported.moduleSpecifier.text,workspaceFile)).default;
 };
 env.drawer=()=>load(path.join(renderer,'preview-drawer.tsx')).default;
 env.create=(tag,attributes={},parent=scope)=>{const node=document.createElement(tag);for(const[name,value]of Object.entries(attributes))name==='text'?node.textContent=value:name==='style'?Object.assign(node.style,value):node.setAttribute(name,value);if(parent)parent.appendChild(node);return node;};
 env.key=(options={})=>{const event=new FixtureEvent('keydown',{key:'Escape',...options});document.activeElement.dispatchEvent(event);return event;};
 env.settle=async()=>{for(let i=0;i<8;i++){await Promise.resolve();for(const instance of instances)if(instance.dirty)instance.render();}};
 env.listenerCount=()=>[document,window].reduce((n,target)=>n+[...target.listeners.values()].reduce((sum,list)=>sum+list.length,0),0);
 env.mount=(component,props)=>{
  const host=env.create('div',{'data-fixture-host':'mounted'}),instance={cursor:0,slots:[],pending:[],props,dirty:false,hosts:new Map(),host,closed:false};instances.add(instance);
  const bindRef=(ref,node)=>{if(typeof ref==='function')ref(node);else if(ref)ref.current=node;};
  function materialize(value,parent,key,seen,autofocus){
   if(value==null||typeof value==='boolean')return;
   if(Array.isArray(value)){value.forEach((child,index)=>materialize(child,parent,key+'.'+index,seen,autofocus));return;}
   if(typeof value!=='object'){parent._text+=String(value);return;}
   if(value.type===jsxRuntime.Fragment){materialize(value.props.children,parent,key+'.fragment',seen,autofocus);return;}
   if(typeof value.type==='function'){materialize(value.type(value.props),parent,key+'.component',seen,autofocus);return;}
   assert.equal(typeof value.type,'string','Only actual host JSX and controlled icon components are realized');
   let node=instance.hosts.get(key),fresh=false;
   if(!node||node.localName!==value.type){node=document.createElement(value.type);instance.hosts.set(key,node);fresh=true;}
   seen.add(key);if(node.parentNode!==parent)parent.appendChild(node);
   const oldRef=node.props.ref;node.props=value.props;node._text='';
   const previousAttributes=[...node.attributes.keys()];
   for(const name of previousAttributes)if(!name.startsWith('data-fixture-'))node.removeAttribute(name);
   node.style=new FixtureStyle();
   for(const[name,input]of Object.entries(value.props)){
    if(name==='children'||name==='ref'||name==='key'||name==='autoFocus'||/^on[A-Z]/.test(name)||input==null||input===false)continue;
    if(name==='style'){Object.assign(node.style,input);continue;}
    if(name==='value'){node.value=input;continue;}if(name==='checked'){node.checked=!!input;continue;}
    const attribute=name==='className'?'class':name==='tabIndex'?'tabindex':name==='htmlFor'?'for':name.toLowerCase();
    const booleanAttribute=['hidden','inert','disabled','open','multiple','readonly','required','checked','selected'].includes(attribute);
    node.setAttribute(attribute,input===true&&booleanAttribute?'':String(input));
   }
   if(oldRef!==value.props.ref)bindRef(oldRef,null);bindRef(value.props.ref,node);
   materialize(value.props.children,node,key+'.children',seen,autofocus);
   if(fresh&&value.props.autoFocus)autofocus.push(node);
  }
  instance.render=()=>{
   assert(!instance.closed,'Do not render a disposed component');let loops=0;
   do{
    assert(++loops<30,'Actual hook/model render settles');instance.dirty=false;instance.cursor=0;instance.pending=[];env.current=instance;
    let tree;try{tree=component(instance.props);}finally{env.current=null;}
    const seen=new Set(),autofocus=[];host._text='';materialize(tree,host,'root',seen,autofocus);
    for(const[key,node]of instance.hosts)if(!seen.has(key)){bindRef(node.props.ref,null);node.remove();instance.hosts.delete(key);}
    // React-controlled boundary: host autoFocus commit occurs before effects.
    for(const node of autofocus)node.focus();
    for(const phase of ['layout','passive'])for(const entry of instance.pending.filter(x=>x.phase===phase)){
     if(entry.state.cleanup)entry.state.cleanup();entry.state.deps=entry.deps;entry.state.effect=entry.effect;entry.state.cleanup=entry.effect();
    }
   }while(instance.dirty);
  };
  instance.update=patch=>{Object.assign(instance.props,patch);instance.render();};
  instance.strictReplay=()=>{
   // Model only StrictMode's extra effect cleanup/setup, not the whole React engine.
   for(const state of instance.slots)if((state.kind==='layout'||state.kind==='passive')&&state.cleanup){state.cleanup();state.cleanup=undefined;}
   for(const phase of ['layout','passive'])for(const state of instance.slots)if(state.kind===phase&&state.effect)state.cleanup=state.effect();
  };
  instance.dispose=()=>{
   if(instance.closed)return;instance.closed=true;
   for(const state of instance.slots)if(state.kind==='layout'&&state.cleanup){state.cleanup();state.cleanup=undefined;}
   for(const node of instance.hosts.values())bindRef(node.props.ref,null);host.remove();
   for(const state of instance.slots)if(state.kind==='passive'&&state.cleanup){state.cleanup();state.cleanup=undefined;}
   instances.delete(instance);
  };
  instance.find=selector=>{const node=host.querySelector(selector);assert(node,'Actual rendered control '+selector);return node;};
  instance.render();return instance;
 };
 env.keyboardEffect=(filename,locals)=>{
  const ast=astFile(path.join(renderer,filename));
  const effects=descendants(ast,node=>ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='useEffect'&&node.arguments[0]&&descendants(node.arguments[0],child=>ts.isCallExpression(child)&&ts.isPropertyAccessExpression(child.expression)&&child.expression.name.text==='addEventListener'&&ts.isIdentifier(child.expression.expression)&&child.expression.expression.text==='document'&&child.arguments[0]&&ts.isStringLiteral(child.arguments[0])&&child.arguments[0].text==='keydown').length);
  assert.equal(effects.length,1,'Exactly one actual document keydown effect in '+filename);
  // Current real effects are retained; future shared ownership imports may be used.
  const focusImports=ast.statements.filter(node=>ts.isImportDeclaration(node)&&node.moduleSpecifier.text.startsWith('./modal-focus')).map(node=>node.getText(ast)).join('\n');
  const make=execute(focusImports+'\nmodule.exports=()=>('+effects[0].arguments[0].getText(ast)+')();',path.join(renderer,filename),locals);
  const cleanup=make();assert.equal(typeof cleanup,'function','Actual keyboard effect returns cleanup');env.disposeCallbacks.push(cleanup);return cleanup;
 };
 env.dispose=()=>{for(const instance of [...instances])instance.dispose();for(const cleanup of env.disposeCallbacks.splice(0))cleanup();for(const observer of document.observers)observer.disconnect();};
 return env;
}
async function fixture(fn){const env=environment();try{await fn(env);}finally{env.dispose();}}
function closeButton(instance){return instance.find('section[role="dialog"] button[aria-label]');}
function external(env,kind){
 const data={warranty:{className:'warranty-print-root',z:120,portal:true},remote:{className:'remote-print-backdrop',z:160,portal:false},host:{className:'host-print-backdrop',z:165,portal:false},a4:{className:'a4-print-root',z:250,portal:true}}[kind];
 assert(data,'Known explicit synthetic modal boundary');
 const root=env.create('div',{class:data.className,role:'dialog','aria-modal':'true',tabindex:'-1'},data.portal?env.document.body:env.scope);
 const button=env.create('button',{type:'button',text:'虚构外层关闭'},root);
 assert.equal(env.globals.getComputedStyle(root).zIndex,String(data.z),'Controlled z-index fixture baseline, not measured browser CSS');
 button.focus();return{root,button,...data};
}

test('H00 controlled DOM selectors, focus propagation, hook commit and cleanup are functional',()=>fixture(async env=>{
 const enabled=env.create('textarea',{id:'enabled'}),disabled=env.create('textarea',{disabled:''}),hidden=env.create('textarea',{hidden:''});
 assert.deepEqual(env.scope.querySelectorAll('textarea:not(:disabled):not([hidden])'),[enabled]);
 const fieldset=env.create('fieldset',{disabled:''}),child=env.create('input',{},fieldset);assert(child.matches(':disabled'));
 let focusEvents=0;const listener=()=>focusEvents++;env.document.addEventListener('focusin',listener);enabled.focus();disabled.focus();hidden.focus();assert.equal(env.document.activeElement,enabled);assert.equal(focusEvents,1);env.document.removeEventListener('focusin',listener);
 let effects=0,cleanups=0,seen;function Probe(){env.react.useEffect(()=>{effects++;seen=env.document.activeElement;return()=>cleanups++;},[]);return jsx('input',{autoFocus:true,id:'probe'});}
 const probe=env.mount(Probe,{});assert.equal(seen,probe.find('#probe'),'AutoFocus commit precedes the effect in this declared hook model');probe.strictReplay();probe.dispose();assert.equal(effects,2);assert.equal(cleanups,2);assert.equal(env.listenerCount(),0);await env.settle();
}));

test('D01 actual single Dialog moves opening focus to its safe internal close target',()=>fixture(async env=>{
 const trigger=env.create('button',{text:'虚构打开'});trigger.focus();let confirmed=0;
 const dialog=env.mount(env.dialog(),{title:'确认操作',onClose:()=>{},children:jsx('button',{onClick:()=>confirmed++,children:'确认删除'})});
 await env.settle();assert(dialog.host.contains(env.document.activeElement),'Opening focus must enter actual Dialog');assert.equal(env.document.activeElement,closeButton(dialog),'Opening target is the safe close button');assert.equal(confirmed,0);
}));

test('D02 actual Dialog autoFocus closes and restores the real pre-commit trigger',()=>fixture(async env=>{
 const trigger=env.create('button',{text:'虚构新建客户'});trigger.focus();let dialog,closed=0;
 dialog=env.mount(env.dialog(),{title:'新建客户',onClose:()=>{closed++;dialog.dispose();},children:jsx('input',{autoFocus:true,'aria-label':'客户姓名'})});
 const input=dialog.find('input');assert.equal(env.document.activeElement,input,'Actual child autoFocus is committed before effects');
 closeButton(dialog).click();await env.settle();assert.equal(closed,1);assert.equal(env.document.activeElement,trigger,'Restore the external opener, not the unmounted autoFocus input');
}));

test('D03 actual Drawer includes a final textarea in both Tab boundaries',()=>fixture(async env=>{
 const drawer=env.mount(env.drawer(),{open:true,onClose:()=>{},children:jsx('textarea',{'aria-label':'虚构备注'})});await env.settle();
 const first=closeButton(drawer),last=drawer.find('textarea');last.focus();const forward=env.key({key:'Tab'});assert(forward.defaultPrevented);assert.equal(env.document.activeElement,first);
 first.focus();const reverse=env.key({key:'Tab',shiftKey:true});assert(reverse.defaultPrevented);assert.equal(env.document.activeElement,last);
}));

test('D04 actual Drawer Escape uses only the latest callback once',()=>fixture(async env=>{
 let old=0,current=0;const drawer=env.mount(env.drawer(),{open:true,onClose:()=>old++,children:null});
 drawer.update({onClose:()=>current++});env.key();assert.equal(old,0);assert.equal(current,1);
}));

for(const [name,options]of [['IME',{isComposing:true,keyCode:0}],['IME legacy 229',{isComposing:false,keyCode:229}],['already prevented',{defaultPrevented:true}]]){
 test('D05 actual Drawer ignores '+name+' Escape',()=>fixture(async env=>{
  let closed=0;env.mount(env.drawer(),{open:true,onClose:()=>closed++,children:null});env.key(options);assert.equal(closed,0,'Internal/input-method handled Escape must not close any modal');
 }));
}

test('D06 actual workspace Drawer busy callback rejects close without releasing focus or lock',()=>fixture(async env=>{
 const changes=[],actual=actualClose('PreviewDrawer',{busy:true,setCustomerView:value=>changes.push(value)},env);
 const drawer=env.mount(env.drawer(),{open:true,onClose:actual.fn,children:null});env.key();await env.settle();
 assert.deepEqual(changes,[]);assert.equal(env.document.body.style.overflow,'hidden');assert(drawer.host.contains(env.document.activeElement));
 actual.context.busy=false;env.key();assert.deepEqual(changes,[false],'Original callback must still allow ordinary close when not busy');
}));

test('D07 actual nested Dialog sends one Escape to the upper layer and restores its parent trigger',()=>fixture(async env=>{
 let parentClosed=0,childClosed=0,parent,child;const trigger=env.create('button',{text:'虚构客户档案'});trigger.focus();
 parent=env.mount(env.dialog(),{title:'虚构客户详情',onClose:()=>parentClosed++,children:jsx('button',{id:'edit-customer',children:'编辑信息'})});
 const edit=parent.find('#edit-customer');edit.focus();
 child=env.mount(env.dialog(),{title:'编辑客户',onClose:()=>{childClosed++;child.dispose();},children:jsx('input',{autoFocus:true})});
 env.key();await env.settle();assert.equal(childClosed,1);assert.equal(parentClosed,0);assert.equal(env.document.activeElement,edit);assert.equal(env.document.body.style.overflow,'hidden');
}));

test('D08 actual Drawer plus page Dialog closes only the page Dialog on the same Escape',()=>fixture(async env=>{
 let drawerClosed=0,pageClosed=0,page;
 const drawer=env.mount(env.drawer(),{open:true,onClose:()=>drawerClosed++,children:jsx('button',{id:'page-trigger',children:'选择页'})});
 const trigger=drawer.find('#page-trigger');trigger.focus();
 page=env.mount(env.dialog(),{title:'选择一页',onClose:()=>{pageClosed++;page.dispose();},children:jsx('select',{'aria-label':'页'})});
 closeButton(page).focus();env.key();await env.settle();assert.equal(pageClosed,1);assert.equal(drawerClosed,0);assert.equal(env.document.activeElement,trigger);assert.equal(env.document.body.style.overflow,'hidden');
}));

for(const kind of ['warranty','remote','host','a4']){
 test('P01 actual Drawer yields keyboard and focus to synthetic '+kind+' modal boundary',()=>fixture(async env=>{
  let lowerClosed=0,middleClosed=0;env.mount(env.drawer(),{open:true,onClose:()=>lowerClosed++,children:null});
  env.mount(env.dialog(),{title:'虚构底层详情',onClose:()=>middleClosed++,children:null});const top=external(env,kind);
  env.key();assert.equal(lowerClosed,0,'Higher modal owns Escape; its close behavior is deliberately not implemented by this DOM-only boundary');
  assert.equal(middleClosed,0);
  assert.equal(env.document.activeElement,top.button,'Lower trap must not steal focus from the external modal');assert.equal(top.root.parentNode,top.portal?env.document.body:env.scope);
 }));
}

test('P02 actual record-confirm Dialog z190 owns Escape over the Drawer without losing busy policy',()=>fixture(async env=>{
 let drawerClosed=0,record=null;const changes=[],actual=actualClose('Dialog',{busy:true,setRecordAction:value=>changes.push(value)},env);
 env.mount(env.drawer(),{open:true,onClose:()=>drawerClosed++,children:null});
 external(env,'host'); // z165 must not suppress the real higher z190 confirmation.
 record=env.mount(env.dialog(),{className:'record-confirm-backdrop',title:'确认成交',onClose:actual.fn,children:jsx('button',{disabled:true,children:'确认成交'})});
 closeButton(record).focus();assert.equal(env.globals.getComputedStyle(record.find('.record-confirm-backdrop')).zIndex,'190');
 env.key();assert.equal(drawerClosed,0);assert.deepEqual(changes,[]);assert.equal(env.document.body.style.overflow,'hidden');
 actual.context.busy=false;env.key();assert.deepEqual(changes,[null]);assert.equal(drawerClosed,0);
}));

test('E01 actual independent keyboard effects respect the synthetic visible owner instead of listener order',()=>fixture(async env=>{
 // Explicit synthetic cross-layer boundary, NOT a claim all these windows can be
 // opened together in the business UI. In particular openRemotePrint clears A4/
 // Warranty before publishing RemotePrint. Only real old keydown effect bodies run.
 const warranty=external(env,'warranty'),host=external(env,'host'),a4=external(env,'a4');
 let warrantyClosed=0,hostClosed=0,a4Closed=0;
 // Deliberately register the lower listeners first.
 env.keyboardEffect('warranty-quotation.tsx',{root:{current:warranty.root},close:()=>{warrantyClosed++;}});
 env.keyboardEffect('host-print-settings.tsx',{modal:{current:host.root},busy:{current:false},closeRef:{current:()=>hostClosed++}});
 env.keyboardEffect('a4-quotation.tsx',{root:{current:a4.root},mounted:true,printing:false,onClose:()=>a4Closed++,printButton:{current:a4.button},closeButton:{current:a4.button}});
 a4.button.focus();env.key();
 assert.equal(a4Closed,1);assert.equal(warrantyClosed,0,'Covered actual Warranty handler must not request its close/save path');assert.equal(hostClosed,0);
}));

test('L01 actual Drawer and Dialog keep the common lock through non-LIFO unmount',()=>fixture(async env=>{
 env.document.body.style.setProperty('overflow','scroll','important');
 const drawer=env.mount(env.drawer(),{open:true,onClose:()=>{},children:null});
 const dialog=env.mount(env.dialog(),{title:'选页',onClose:()=>{},children:jsx('button',{children:'返回'})});
 drawer.dispose();await env.settle();assert.equal(env.document.body.style.overflow,'hidden','Remaining Dialog must retain the lock after lower Drawer is removed');
 dialog.dispose();await env.settle();assert.equal(env.document.body.style.overflow,'scroll');assert.equal(env.document.body.style.getPropertyPriority('overflow'),'important');assert.equal(env.listenerCount(),0);
}));

test('L02 actual Drawer StrictMode effect replay and final unmount leave no listener or scroll lock',()=>fixture(async env=>{
 const trigger=env.create('button',{text:'虚构预览'});trigger.focus();env.document.body.style.overflow='scroll';
 const drawer=env.mount(env.drawer(),{open:true,onClose:()=>{},children:null});drawer.strictReplay();await env.settle();
 assert.equal(env.document.body.style.overflow,'hidden');assert.equal((env.document.listeners.get('keydown')||[]).length,1,'One active actual keyboard listener after replay');
 drawer.dispose();await env.settle();assert.equal(env.listenerCount(),0);assert.equal(env.document.body.style.overflow,'scroll');assert.equal(env.document.activeElement,trigger);
}));

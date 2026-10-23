'use strict';
// Root runs this only in the admitted offline Guest. Every API/image/browser port
// below is synthetic. No DB, service, network listener, EXE or real user file.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'..'),sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
if(process.platform!=='win32'||ROOT.toLowerCase()!=='c:\\xjy-work\\xjy-web-stage1')throw Error('Fixed actual Guest required before source evaluation');
function read(relative,max=4*1024*1024){
 const file=path.join(ROOT,...relative.split('/')),rel=path.relative(ROOT,file);if(rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))throw Error('Source outside Root');
 for(let current=file;;current=path.dirname(current)){const stat=fs.lstatSync(current);if(stat.isSymbolicLink()||stat.isFile()&&stat.nlink!==1)throw Error('Source links refused');if(current===path.dirname(current))break;}
 const stat=fs.statSync(file);if(!stat.isFile()||stat.size>max)throw Error('Bounded ordinary source required');return fs.readFileSync(file);
}
for(const [file,pin]of Object.entries({
 'stage1/guest-candidate-cdp.cjs':'59840b638d8797fb55241616cd0b8e4098075a76834a201b0e93c1a748f1bb32',
 'stage1/sandbox-context.py':'09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249',
 'stage1/validate-sandbox-context.py':'867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207',
}))if(sha(read(file))!==pin)throw Error('Original admission changed');
const actualContext=require('../stage1/guest-candidate-cdp.cjs').actualGuard();
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const ts=require(path.join(ROOT,'audit-tools/dependencies/node_modules/typescript'));
const FILES=['project/desktop/renderer/employee-profile.tsx','project/desktop/renderer/collaboration-types.ts','project/desktop/renderer/message-board.tsx','project/desktop/renderer/capability-permissions.tsx','project/desktop/renderer/workspace.tsx','project/desktop/renderer/staff-avatar.tsx','project/desktop/renderer/staff-avatar-store.ts'];
const testPin=process.env.XJY_SOCIAL_AVATAR_TEST_SHA256,pins=JSON.parse(process.env.XJY_SOCIAL_AVATAR_SOURCE_PINS||'null');
assert.match(testPin||'',/^[a-f0-9]{64}$/);assert.equal(sha(read('audit-tools/employee-social-avatar-green.test.cjs')),testPin);
assert(pins&&typeof pins==='object'&&!Array.isArray(pins));assert.deepEqual(Object.keys(pins).sort(),FILES.slice().sort());
const sources=new Map();for(const file of FILES){assert.match(pins[file]||'',/^[a-f0-9]{64}$/);const bytes=read(file);assert.equal(sha(bytes),pins[file]);sources.set(file,bytes.toString('utf8'));}
console.log(JSON.stringify({purpose:'employee-social-avatar-shared-scope-green-candidate',targetVersion:'1.7.0',actualContext,testSha256:testPin,sourcePins:pins,methods:21,dbOpened:false,browserStarted:false,realUploadVerified:false,actualUiVerified:false}));

const STAFF='10000000-0000-4000-8000-00000000000a',OTHER='10000000-0000-4000-8000-00000000000b';
const OLD='20000000-0000-4000-8000-000000000001',NEW='20000000-0000-4000-8000-000000000002';
const IMAGE_OLD='data:image/png;base64,AQID',IMAGE_NEW='data:image/png;base64,BAUG';
const avatar=id=>({id,url:'/api/employee-profiles/avatars/'+id});
const profile=(id=STAFF,avatarId=OLD,revision=1)=>({staffId:id,name:id===STAFF?'虚构甲':'虚构乙',role:'employee',active:true,age:null,bio:'虚构简介',avatar:avatar(avatarId),revision,updatedAt:'2026-10-19T00:00:00Z',canEdit:id===STAFF});
const jsx=(type,props,key)=>({type,props:props||{},key});
const jsxRuntime={jsx,jsxs:jsx,Fragment:Symbol.for('fixture.fragment')};
function nodes(node,out=[]){if(Array.isArray(node))node.forEach(child=>nodes(child,out));else if(node&&typeof node==='object'){out.push(node);nodes(node.props?.children,out);}return out;}
function text(node){return Array.isArray(node)?node.map(text).join(' '):node==null||typeof node==='boolean'?'':typeof node==='object'?text(node.props?.children):String(node);}
const classes=node=>String(node.props?.className||'').split(/\s+/);
const oneClass=(tree,name)=>{const found=nodes(tree).find(node=>classes(node).includes(name));assert(found,'Actual rendered '+name+' exists');return found;};
const hasImage=(tree,src)=>nodes(tree).some(node=>node.type==='img'&&node.props.src===src);
function compile(source,file){const result=ts.transpileModule(source,{fileName:file,reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}});assert.equal((result.diagnostics||[]).filter(item=>item.category===ts.DiagnosticCategory.Error).length,0);return result.outputText;}

function harness({feature='employee-profile',uploadFails=false}={}){
 const h={tree:null,requests:[],dirty:true,instances:new Map(),pending:[],disposed:false,actor:{id:STAFF,role:'employee',grantRevision:1,capabilities:{'messages.post':true}},scopeKey:'fictional-host-1',imageOld:IMAGE_OLD,events:new Map()},cache=new Map();let current=null;
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));
 function slot(kind,make){assert(current,'Actual React hook must belong to mounted component');const index=current.cursor++;if(!current.slots[index])current.slots[index]={kind,...make()};assert.equal(current.slots[index].kind,kind);return current.slots[index];}
 const react={
  useState(initial){const state=slot('state',()=>({value:typeof initial==='function'?initial():initial}));return[state.value,value=>{const next=typeof value==='function'?value(state.value):value;if(!Object.is(next,state.value)){state.value=next;h.dirty=true;}}];},
  useRef(initial){return slot('ref',()=>({value:{current:initial}})).value;},
  useEffect(effect,dependencies){const state=slot('effect',()=>({dependencies:undefined,cleanup:null}));if(!same(state.dependencies,dependencies))h.pending.push({state,effect,dependencies});},
  useMemo(make,dependencies){const state=slot('memo',()=>({dependencies:undefined,value:undefined}));if(!same(state.dependencies,dependencies)){state.dependencies=dependencies;state.value=make();}return state.value;},
  useCallback(fn,dependencies){return react.useMemo(()=>fn,dependencies);},
  createContext(value){const context={value};context.Provider={context};return context;},
  useContext(context){return context.value;},
  useSyncExternalStore(subscribe,getSnapshot){const [,force]=react.useState(0);react.useEffect(()=>subscribe(()=>force(value=>value+1)),[subscribe]);return getSnapshot();},
 };
 function load(relative){
  if(cache.has(relative))return cache.get(relative).exports;assert(sources.has(relative),'Unpinned renderer import refused: '+relative);const module={exports:{}};cache.set(relative,module);
  const localRequire=name=>{if(name==='react')return react;if(name==='react/jsx-runtime')return jsxRuntime;if(name==='lucide-react')return new Proxy({},{get:(_target,label)=>props=>jsx('svg',{...props,'data-icon':String(label)})});if(name==='./bridge')return{api:h.api};if(name.endsWith('.css'))return{};if(name.startsWith('.')){const base=path.posix.normalize(path.posix.join(path.posix.dirname(relative),name));for(const ext of ['','.ts','.tsx'])if(sources.has(base+ext))return load(base+ext);}throw Error('Unreviewed renderer test import: '+name);};
  class FixtureImage{set src(_value){this.naturalWidth=1;this.naturalHeight=1;Promise.resolve().then(()=>this.onload?.());}}
  const browserURL=class extends URL{};browserURL.createObjectURL=()=> 'blob:synthetic-owned';browserURL.revokeObjectURL=()=>{};
  const listen=(name,listener)=>{let group=h.events.get(name);if(!group){group=new Set();h.events.set(name,group);}group.add(listener);},unlisten=(name,listener)=>h.events.get(name)?.delete(listener);
  const document={visibilityState:'visible',addEventListener:listen,removeEventListener:unlisten,createElement(tag){assert.equal(tag,'canvas');return{getContext:()=>({drawImage(){}}),toBlob(callback,mime){callback({type:mime,arrayBuffer:async()=>Uint8Array.from([7,8,9]).buffer});}};}};
  const window={setInterval:()=>1,clearInterval(){},addEventListener:listen,removeEventListener:unlisten};
  vm.runInNewContext(compile(sources.get(relative),relative),{module,exports:module.exports,require:localRequire,console,Error,URL:browserURL,URLSearchParams,Promise,Date,DataView,Uint8Array,ArrayBuffer,Number,Math,Image:FixtureImage,document,window,btoa:value=>Buffer.from(value,'binary').toString('base64'),setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){}},{filename:relative});return module.exports;
 }
 let saved=profile();h.api=async(address,method='GET',body)=>{h.requests.push({address,method,body});
  if(address==='/api/employee-profiles'&&method==='GET')return{profiles:[saved,{...profile(OTHER,OLD),avatar:null}]};
  if(address.startsWith('/api/employee-profiles/'+STAFF+'?')&&method==='GET')return{profile:saved,month:'2026-10',published:false,publication:null,sourceNote:'虚构核定来源',summary:{orderCount:0,amount:0,weight:0}};
  if(address==='/api/employee-profiles/'+STAFF+'/avatar'&&method==='POST'){assert.equal(body.revision,1);assert.equal(body.image,'data:image/png;base64,BwgJ');if(uploadFails)throw Error('虚构存储失败');saved=profile(STAFF,NEW,2);return{profile:saved};}
  if(address==='/api/employee-profiles/avatars/'+OLD)return{image:h.imageOld};if(address==='/api/employee-profiles/avatars/'+NEW)return{image:IMAGE_NEW};
  if(address.startsWith('/api/collaboration/messages'))return{messages:[{id:'fictional-message',authorId:STAFF,authorName:'虚构甲',text:'虚构工作留言',createdAt:'2026-10-19T00:00:00Z'}],page:1,pageSize:20,total:1};
  if(address==='/api/collaboration/capabilities')return{catalog:[],capabilities:{},users:[{id:STAFF,name:'虚构甲',username:'fictional',role:'employee',active:true,capabilities:{}}]};
  throw Error('Undeclared synthetic API: '+method+' '+address);
 };
 function invoke(Component,props,key){const previous=current;let instance=h.instances.get(key);if(!instance){instance={slots:[],cursor:0};h.instances.set(key,instance);}instance.cursor=0;current=instance;try{return Component(props);}finally{current=previous;}}
 function realize(node,key){if(Array.isArray(node))return node.map((child,index)=>realize(child,key+'.'+index));if(!node||typeof node!=='object')return node;if(node.type?.context){const previous=node.type.context.value;node.type.context.value=node.props.value;try{return realize(node.props.children,key+'.provider');}finally{node.type.context.value=previous;}}if(typeof node.type==='function')return realize(invoke(node.type,node.props,key),key+'.render');return{...node,props:{...node.props,children:realize(node.props?.children,key+'.children')}};}
 const avatarModule=load('project/desktop/renderer/staff-avatar.tsx'),Component=feature==='avatar-only'?()=>jsx(avatarModule.StaffAvatar,{staffId:STAFF,name:'虚构甲',className:'test-avatar'}):load('project/desktop/renderer/'+feature+'.tsx').default;
 h.render=()=>{h.dirty=false;h.tree=realize(jsx(avatarModule.StaffAvatarProvider,{actor:h.actor,scopeKey:h.scopeKey,children:jsx(Component,{user:h.actor})}),'root');const effects=h.pending.splice(0);for(const item of effects){item.state.cleanup?.();item.state.dependencies=item.dependencies;item.state.cleanup=item.effect();}return h.tree;};
 h.flush=async()=>{for(let i=0;i<60;i++){if(h.dirty||!h.tree)h.render();await Promise.resolve();}if(h.dirty)h.render();return h.tree;};
 h.event=name=>{for(const listener of [...h.events.get(name)||[]])listener();};
 h.dispose=()=>{h.disposed=true;for(const instance of h.instances.values())for(const state of instance.slots)state.cleanup?.();};
 h.upload=async()=>{const input=nodes(h.tree).find(node=>node.type==='input'&&node.props['aria-label']==='更换个人头像');assert(input,'Actual upload input');const header=Buffer.alloc(33);Buffer.from('89504e470d0a1a0a','hex').copy(header);header.write('IHDR',12);header.writeUInt32BE(1,16);header.writeUInt32BE(1,20);input.props.onChange({target:{files:[{type:'image/png',name:'fictional.png',size:33,slice:()=>({arrayBuffer:async()=>header})}]},currentTarget:{value:'fictional.png'}});await h.flush();};
 return h;
}

test('A00 current saved profile avatar is obtained through its authenticated endpoint',async t=>{const h=harness();t.after(h.dispose);await h.flush();assert(hasImage(oneClass(h.tree,'employee-profile-identity'),IMAGE_OLD));assert(h.requests.some(request=>request.address==='/api/employee-profiles/avatars/'+OLD));});
test('A01 profile directory uses the uploaded current avatar for the matching employee',async t=>{const h=harness();t.after(h.dispose);await h.flush();const directory=oneClass(h.tree,'employee-profile-directory'),person=nodes(directory).find(node=>node.type==='button'&&text(node).includes('虚构甲'));assert(person);assert(hasImage(person,IMAGE_OLD),'Profile directory must render the saved avatar, not a separate name initial');});
test('A02 successful upload refreshes both the mounted profile identity and matching directory avatar',async t=>{const h=harness();t.after(h.dispose);await h.flush();await h.upload();assert.equal(h.requests.filter(request=>request.method==='POST').length,1);assert(hasImage(oneClass(h.tree,'employee-profile-identity'),IMAGE_NEW),'Saved profile must show the new server UUID content');const directory=oneClass(h.tree,'employee-profile-directory'),person=nodes(directory).find(node=>node.type==='button'&&text(node).includes('虚构甲'));assert(hasImage(person,IMAGE_NEW),'Already-mounted directory must also show the newly saved avatar');assert.equal(hasImage(h.tree,IMAGE_OLD),false,'No stale saved avatar remains after upload settles');});
test('A03 failed avatar upload keeps the last server-saved profile image and reports failure',async t=>{const h=harness({uploadFails:true});t.after(h.dispose);await h.flush();await h.upload();assert(hasImage(oneClass(h.tree,'employee-profile-identity'),IMAGE_OLD));assert.equal(hasImage(h.tree,IMAGE_NEW),false);assert.match(text(h.tree),/虚构存储失败/);});
test('A04 message author avatars use their current saved profile image',async t=>{const h=harness({feature:'message-board'});t.after(h.dispose);await h.flush();const message=oneClass(h.tree,'message-card');assert(hasImage(message,IMAGE_OLD),'Historical message author must show current saved avatar by authorId');});
test('A05 capability staff list uses the same current saved image without changing management controls',async t=>{const h=harness({feature:'capability-permissions'});t.after(h.dispose);await h.flush();const list=oneClass(h.tree,'capability-staff-list');assert(hasImage(list,IMAGE_OLD));assert.match(text(h.tree),/保存业务能力/);});

// Supplemental wiring contracts execute only the current actual workspace JSX
// subtree. StaffAvatar is a display port here; these do not prove shared cache.
function workspaceAvatar(className){const file='project/desktop/renderer/workspace.tsx',source=sources.get(file),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let expression;
 function visit(node){if(ts.isJsxElement(node)&&node.openingElement.attributes.properties.some(item=>ts.isJsxAttribute(item)&&item.name.text==='className'&&item.initializer&&ts.isStringLiteral(item.initializer)&&item.initializer.text===className))expression=node.getText(ast);ts.forEachChild(node,visit);}visit(ast);assert(expression,'Actual workspace avatar subtree '+className);
 const module={exports:{}},staff={id:STAFF,name:'虚构甲',username:'fictional'},scope={module,exports:module.exports,require:name=>{assert.equal(name,'react/jsx-runtime');return jsxRuntime;},user:staff,staff,admin:false,busy:false,connection:null,connectionLabel:()=> '虚构连接',run:fn=>fn(),onLogout:async()=>{},LogOut:props=>jsx('svg',props),Pencil:props=>jsx('svg',props),Button:props=>jsx('button',props),StaffAvatar:props=>jsx('img',{...props,src:IMAGE_OLD,alt:'虚构甲的头像'})};
 vm.runInNewContext(compile('module.exports=()=>('+expression+');',file),scope,{filename:file});function realize(node){if(Array.isArray(node))return node.map(realize);if(!node||typeof node!=='object')return node;if(typeof node.type==='function')return realize(node.type(node.props));return{...node,props:{...node.props,children:realize(node.props?.children)}};}return realize(module.exports());
}
test('W01 existing workspace sidebar avatar is connected to the current uploaded image display port',()=>{assert(hasImage(workspaceAvatar('side-bottom'),IMAGE_OLD),'Sidebar still renders only a name initial');});
test('W02 existing team-row avatar is connected to the same current image display port',()=>{assert(hasImage(workspaceAvatar('team-row'),IMAGE_OLD),'Team avatar still renders only a name initial');});

// Pure shared store tests exercise actual product code, not an invented cache.
function storeFixture(){
 const file='project/desktop/renderer/staff-avatar-store.ts',module={exports:{}};
 vm.runInNewContext(compile(sources.get(file),file),{module,exports:module.exports,Promise,Map,Set,Object,Array,Number,Error},{filename:file});
 const requests=[],request=address=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});requests.push({address,resolve,reject});return promise;};
 const store=module.exports.createStaffAvatarStore(request),settle=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
 return{store,requests,settle,make:()=>module.exports.createStaffAvatarStore(request)};
}
test('S01 multiple mounted avatars for one employee share one authenticated image request',async()=>{
 const f=storeFixture(),seen=[];f.store.seed([profile()]);const off1=f.store.subscribe(STAFF,()=>seen.push(f.store.get(STAFF).source)),off2=f.store.subscribe(STAFF,()=>seen.push(f.store.get(STAFF).source));
 const one=f.store.ensure(STAFF),two=f.store.ensure(STAFF);await f.settle();assert.equal(f.requests.length,1);assert.equal(f.requests[0].address,avatar(OLD).url);f.requests[0].resolve({image:IMAGE_OLD});await Promise.all([one,two]);assert.equal(f.store.get(STAFF).source,IMAGE_OLD);assert(seen.includes(IMAGE_OLD));off1();off2();
});
test('S02 an older image arriving after a newly published avatar cannot overwrite it',async()=>{
 const f=storeFixture();f.store.seed([profile()]);const off=f.store.subscribe(STAFF,()=>{});void f.store.ensure(STAFF);await f.settle();f.store.publish(profile(STAFF,NEW,2));assert.equal(f.store.get(STAFF).source,'');await f.settle();assert.equal(f.requests.length,2);f.requests[1].resolve({image:IMAGE_NEW});await f.settle();f.requests[0].resolve({image:IMAGE_OLD});await f.settle();assert.equal(f.store.get(STAFF).source,IMAGE_NEW);assert.equal(f.store.get(STAFF).avatarId,NEW);off();
});
test('S03 a directory response started before upload cannot roll the saved profile back',async()=>{
 const f=storeFixture();const refresh=f.store.refresh();await f.settle();f.store.publish(profile(STAFF,NEW,2));f.requests[0].resolve({profiles:[profile()]});await refresh;assert.equal(f.store.get(STAFF).avatarId,NEW);assert.equal(f.store.get(STAFF).source,'');
});
test('S04 suspending a scope clears pixels immediately and discards every earlier in-flight result',async()=>{
 const f=storeFixture();f.store.seed([profile()]);void f.store.ensure(STAFF);await f.settle();f.store.suspend();assert.equal(f.store.get(STAFF).source,'');f.requests[0].resolve({image:IMAGE_OLD});await f.settle();assert.equal(f.store.get(STAFF).source,'');await f.store.refresh();assert.equal(f.requests.length,1);f.store.resume();f.store.seed([profile(STAFF,NEW,2)]);const work=f.store.ensure(STAFF);await f.settle();f.requests[1].resolve({image:IMAGE_NEW});await work;assert.equal(f.store.get(STAFF).source,IMAGE_NEW);
});
test('S05 independent host or user scopes never share cached data or late responses',async()=>{
 const f=storeFixture(),other=f.make();f.store.seed([profile()]);void f.store.ensure(STAFF);await f.settle();f.store.suspend();other.seed([profile(STAFF,NEW,2)]);const next=other.ensure(STAFF);await f.settle();f.requests[0].resolve({image:IMAGE_OLD});await f.settle();assert.equal(other.get(STAFF).source,'');f.requests[1].resolve({image:IMAGE_NEW});await next;assert.equal(other.get(STAFF).source,IMAGE_NEW);assert.equal(f.store.get(STAFF).source,'');
});
test('S06 failed new-avatar retrieval clears old pixels and never accepts SVG or external image addresses',async()=>{
 const f=storeFixture();f.store.seed([profile()]);let work=f.store.ensure(STAFF);await f.settle();f.requests[0].resolve({image:IMAGE_OLD});await work;f.store.publish(profile(STAFF,NEW,2));assert.equal(f.store.get(STAFF).source,'');work=f.store.ensure(STAFF);await f.settle();f.requests[1].reject(Error('fictional revoked request'));await work;assert.equal(f.store.get(STAFF).source,'');assert.equal(f.store.get(STAFF).state,'error');f.store.seed([{...profile(OTHER),avatar:{id:OLD,url:'https://outside.invalid/avatar.png'}}]);await f.store.ensure(OTHER,false);assert.equal(f.requests.length,2);
 const invalid=f.make();invalid.seed([profile()]);work=invalid.ensure(STAFF);await f.settle();f.requests[2].resolve({image:'data:image/svg+xml;base64,PHN2Zz4='});await work;assert.equal(invalid.get(STAFF).source,'');assert.equal(invalid.get(STAFF).state,'error');
});
test('S07 directory removal or authenticated refresh failure clears a previously loaded avatar',async()=>{
 for(const fails of [false,true]){const f=storeFixture();f.store.seed([profile()]);const work=f.store.ensure(STAFF);await f.settle();f.requests[0].resolve({image:IMAGE_OLD});await work;const refresh=f.store.refresh();await f.settle();if(fails)f.requests[1].reject(Object.assign(Error('fictional auth expiry'),{status:403}));else f.requests[1].resolve({profiles:[]});await refresh;assert.equal(f.store.get(STAFF).source,'');}
});
test('S08 deleting an entry then reintroducing the same UUID does not revive its detached read',async()=>{
 const f=storeFixture();f.store.seed([profile()]);void f.store.ensure(STAFF);await f.settle();const refresh=f.store.refresh();await f.settle();f.requests[1].resolve({profiles:[]});await refresh;f.store.seed([profile()]);const next=f.store.ensure(STAFF);await f.settle();assert.equal(f.requests.length,3);f.requests[0].resolve({image:IMAGE_OLD});await f.settle();assert.equal(f.store.get(STAFF).source,'');f.requests[2].resolve({image:IMAGE_NEW});await next;assert.equal(f.store.get(STAFF).source,IMAGE_NEW);
});
test('S09 a transient directory transport failure retains the last verified image and remains retryable',async()=>{
 const f=storeFixture();f.store.seed([profile()]);const work=f.store.ensure(STAFF);await f.settle();f.requests[0].resolve({image:IMAGE_OLD});await work;const before=f.store.get(STAFF),refresh=f.store.refresh();await f.settle();f.requests[1].reject(Error('fictional temporary offline'));await refresh;assert.equal(f.store.get(STAFF),before);const retry=f.store.refresh();await f.settle();assert.equal(f.requests.length,3);f.requests[2].resolve({profiles:[profile()]});await retry;assert.equal(f.store.get(STAFF).source,IMAGE_OLD);
});
test('S10 a legal maximum-sized authenticated avatar is accepted while decoded bytes over 2 MiB are refused',async()=>{
 for(const extra of [0,1]){const f=storeFixture();f.store.seed([profile()]);const work=f.store.ensure(STAFF);await f.settle();const image='data:image/png;base64,'+Buffer.alloc(2*1024*1024+extra).toString('base64');f.requests[0].resolve({image});await work;assert.equal(f.store.get(STAFF).state,extra?'error':'ready');assert.equal(f.store.get(STAFF).source,extra?'':image);}
});
test('P01 real provider clears every mounted avatar when authentication is lost',async t=>{
 const h=harness({feature:'avatar-only'});t.after(h.dispose);await h.flush();assert(hasImage(h.tree,IMAGE_OLD));h.event('desktop-auth-lost');await h.flush();assert.equal(hasImage(h.tree,IMAGE_OLD),false);const count=h.requests.length;h.event('focus');await h.flush();assert.equal(h.requests.length,count,'Suspended auth scope does not restart reads');
});
test('P02 real provider gives changed users, hosts and grant revisions a fresh empty cache',async t=>{
 for(const mode of ['user','host','grant']){const h=harness({feature:'avatar-only'});t.after(h.dispose);await h.flush();assert(hasImage(h.tree,IMAGE_OLD));h.imageOld=IMAGE_NEW;if(mode==='user')h.actor={...h.actor,id:OTHER};else if(mode==='host')h.scopeKey='fictional-host-2';else h.actor={...h.actor,grantRevision:2};h.dirty=true;h.render();assert.equal(hasImage(h.tree,IMAGE_OLD),false,mode+' scope is empty before loading');await h.flush();assert(hasImage(h.tree,IMAGE_NEW),mode+' uses a fresh authenticated request');}
});
test('P03 real provider refreshes metadata on focus without downloading unchanged image content again',async t=>{
 const h=harness({feature:'avatar-only'});t.after(h.dispose);await h.flush();const images=h.requests.filter(request=>request.address===avatar(OLD).url).length,directories=h.requests.filter(request=>request.address==='/api/employee-profiles').length;h.event('focus');await h.flush();assert.equal(h.requests.filter(request=>request.address==='/api/employee-profiles').length,directories+1);assert.equal(h.requests.filter(request=>request.address===avatar(OLD).url).length,images);
});

'use strict';
// Controlled real JSX/effect tests. This is not a browser or native-window test.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'..'),sha=data=>crypto.createHash('sha256').update(data).digest('hex');
if(process.platform!=='win32'||ROOT.toLowerCase()!=='c:\\xjy-work\\xjy-web-stage1')throw Error('Actual isolated Guest required');
function read(relative,max=4*1024*1024){const file=path.join(ROOT,...relative.split('/'));if(path.relative(ROOT,file).startsWith('..'))throw Error('Source escaped');for(let p=file;;p=path.dirname(p)){const s=fs.lstatSync(p);if(s.isSymbolicLink()||s.isFile()&&s.nlink!==1)throw Error('Ordinary unlinked source required');if(p===path.dirname(p))break;}if(fs.statSync(file).size>max)throw Error('Source bound exceeded');return fs.readFileSync(file);}
for(const [file,pin]of Object.entries({'stage1/guest-candidate-cdp.cjs':'59840b638d8797fb55241616cd0b8e4098075a76834a201b0e93c1a748f1bb32','stage1/sandbox-context.py':'09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249','stage1/validate-sandbox-context.py':'867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207'}))if(sha(read(file))!==pin)throw Error('Frozen Guest guard changed');
require('../stage1/guest-candidate-cdp.cjs').actualGuard();
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
assert.equal(sha(read('audit-tools/app-version-badge.test.cjs')),process.env.XJY_VERSION_BADGE_TEST_SHA256);
const compiler='audit-tools/dependencies/node_modules/typescript/lib/typescript.js';assert.equal(sha(read(compiler,16*1024*1024)),'3ae902c92cc44dace175c0e69e13a4b0899f6983c6121d76b9ab8dd5795e7675');
const ts=require(path.join(ROOT,compiler));assert.equal(ts.version,'5.9.3');
const SOURCE='project/desktop/renderer/app-version-badge.tsx';
const text=node=>node==null||typeof node==='boolean'?'':Array.isArray(node)?node.map(text).join(''):typeof node==='object'?text(node.props?.children):String(node);
async function fixture(bridge){
 assert(fs.existsSync(path.join(ROOT,SOURCE)),'Shared AppVersionBadge is not implemented');const source=read(SOURCE);assert.equal(sha(source),process.env.XJY_VERSION_BADGE_SOURCE_SHA256);
 const built=ts.transpileModule(source.toString('utf8'),{fileName:SOURCE,reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}});assert.equal(built.diagnostics?.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);
 let value=null,effect=null,writes=0;const jsx=(type,props)=>({type,props:props||{}}),module={exports:{}};
 vm.runInNewContext(built.outputText,{module,exports:module.exports,window:{jewelryDesktop:bridge},require(name){if(name==='react')return{useState:()=>[value,next=>{value=typeof next==='function'?next(value):next;writes++;}],useEffect:fn=>{effect=fn;}};if(name==='react/jsx-runtime')return{jsx,jsxs:jsx};if(name==='./app-version-badge.css')return{};throw Error('Unreviewed import '+name);}},{filename:SOURCE});
 const Component=module.exports.default;assert.equal(typeof Component,'function');const first=Component(),cleanup=effect?.();await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));
 return{first,view:()=>Component(),cleanup,get writes(){return writes;}};
}
test('V20 common corner shows actual local version or explicit host-web version, with passive unavailable/late failure handling',async()=>{
 let calls=0;const local=await fixture({surface:'desktop',getAppInfo:async()=>{calls++;return{appVersion:'1.6.1'};}});assert.equal(calls,1);assert.match(text(local.view()),/总版本 v1\.6\.1/);assert.doesNotMatch(text(local.view()),/1\.6\.2|主机/);
 const web=await fixture({surface:'browser',getAppInfo:async()=>({appVersion:'1.6.2'})});assert.match(text(web.view()),/主机总版本 v1\.6\.2/);
 for(const bridge of [{},{getAppInfo:async()=>({appVersion:'<script>1.6.2</script>'})},{getAppInfo:async()=>{throw Error('unavailable');}}]){const state=await fixture(bridge);assert.match(text(state.view()),/版本信息暂不可用/);assert.doesNotMatch(text(state.view()),/1\.6\.2|script/);}
 let finish;const pending=await fixture({getAppInfo:()=>new Promise(resolve=>{finish=resolve;})});assert.equal(typeof pending.cleanup,'function');pending.cleanup();const writes=pending.writes;finish({appVersion:'1.6.2'});await new Promise(resolve=>setImmediate(resolve));assert.equal(pending.writes,writes,'Unmounted late response must not update state');
});
test('V21 one outer-frame corner reserves the bottom edge and is excluded from printing',()=>{
 const main=read('project/desktop/renderer/main.tsx').toString('utf8');assert.match(main,/import AppVersionBadge from ["']\.\/app-version-badge["']/);assert.equal((main.match(/<AppVersionBadge\s*\/>/g)||[]).length,1);
 const file='project/desktop/renderer/app-version-badge.css';assert(fs.existsSync(path.join(ROOT,file)),'Frame footer styles are not implemented');const css=read(file).toString('utf8');assert.equal(sha(read(file)),process.env.XJY_VERSION_BADGE_CSS_SHA256);assert.match(css,/--app-version-footer-height\s*:\s*24px/);assert.match(css,/safe-area-inset-bottom/);assert.match(css,/pointer-events\s*:\s*none/);assert.match(css,/@media print[\s\S]*\.app-version-footer\s*\{[^}]*display\s*:\s*none/);assert.match(css,/\.sidebar\s*\{[^}]*bottom\s*:/);assert.match(css,/body\s*\{[^}]*padding-bottom\s*:/);
});

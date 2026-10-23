'use strict';
// Guest-only typed-auth boundary contract. No Host bypass or production input.
// Compiler tests execute the actual backend build-option/plugin expressions only;
// CLI copy/migration, renderer/Vite, ASAR, signing and installation are NOT run.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),Module=require('node:module');
const ROOT=path.resolve(__dirname,'..'),PROJECT=path.join(ROOT,'project'),DESKTOP=path.join(PROJECT,'desktop');
if(process.platform!=='win32'||os.userInfo().username.toLowerCase()!=='wdagutilityaccount'||ROOT.toLowerCase()!=='c:\\xjy-work\\xjy-web-stage1')throw Error('Typed auth tests require the fixed actual Windows Sandbox');
const guard=require('../stage1/isolation.cjs').createIsolationGuard(ROOT);
const proof=require('node:child_process').spawnSync('C:\\Python314\\python.exe',['-I','-B',guard.assertPath(path.join(ROOT,'stage1/validate-sandbox-context.py'))],{cwd:ROOT,windowsHide:true,encoding:'utf8'});
if(proof.status!==0)throw Error('Unchanged actual Guest admission failed');
const test=require('node:test'),assert=require('node:assert/strict');
const DEPS=guard.assertPath(path.join(ROOT,'audit-tools/dependencies/node_modules'));
const ts=require(path.join(DEPS,'typescript')),esbuild=require(path.join(DEPS,'esbuild'));
assert.equal(ts.version,'5.9.3','Same reviewed existing TypeScript compiler');
const zodMetadata=JSON.parse(fs.readFileSync(guard.assertPath(path.join(DEPS,'zod/package.json')),'utf8'));
assert.equal(zodMetadata.version,'3.25.76');assert.equal(zodMetadata.license,'MIT');
const OLD_IMPORT='@/app/chatgpt-auth',ADAPTER_REL='lib/platform/desktop-identity.ts',ADAPTER=path.join(PROJECT,ADAPTER_REL);
const BASELINE_CONFIG={"compilerOptions":{"target":"ES2017","lib":["dom","dom.iterable","esnext"],"allowJs":true,"skipLibCheck":true,"strict":true,"noEmit":true,"esModuleInterop":true,"module":"esnext","moduleResolution":"bundler","resolveJsonModule":true,"isolatedModules":true,"jsx":"react-jsx","incremental":true,"plugins":[{"name":"next"}],"types":["node","@cloudflare/workers-types"]},"include":["next-env.d.ts","**/*.ts","**/*.tsx",".next/types/**/*.ts",".next/dev/types/**/*.ts","**/*.mts"],"exclude":["node_modules","examples"]};
const BASELINE_ROOTS=["project/db/index.ts","project/db/schema.ts","project/desktop/vite.config.ts","project/desktop/renderer/bridge.ts","project/desktop/renderer/browser-bridge.ts","project/desktop/renderer/collaboration-types.ts","project/desktop/renderer/export-workbook.ts","project/desktop/renderer/modal-focus.ts","project/desktop/renderer/module-access.ts","project/desktop/renderer/presence-heartbeat.ts","project/desktop/renderer/warranty-data.ts","project/desktop/renderer/warranty-layout.ts","project/hooks/use-mobile.ts","project/lib/business-bindings.d.ts","project/lib/client-drafts.ts","project/lib/connector-context.ts","project/lib/connector-preview.d.ts","project/lib/connectors.ts","project/lib/domain.ts","project/lib/quote-image.ts","project/lib/quote-presentation.ts","project/lib/server.ts","project/lib/utils.ts","project/components/a4-quotation.tsx","project/components/connector-error.tsx","project/components/home-studio.tsx","project/components/media-gallery.tsx","project/components/quote-card.tsx","project/components/ui/accordion.tsx","project/components/ui/alert-dialog.tsx","project/components/ui/alert.tsx","project/components/ui/aspect-ratio.tsx","project/components/ui/attachment.tsx","project/components/ui/avatar.tsx","project/components/ui/badge.tsx","project/components/ui/breadcrumb.tsx","project/components/ui/bubble.tsx","project/components/ui/button-group.tsx","project/components/ui/button.tsx","project/components/ui/calendar.tsx","project/components/ui/card.tsx","project/components/ui/carousel.tsx","project/components/ui/chart.tsx","project/components/ui/checkbox.tsx","project/components/ui/collapsible.tsx","project/components/ui/combobox.tsx","project/components/ui/command.tsx","project/components/ui/context-menu.tsx","project/components/ui/dialog.tsx","project/components/ui/direction.tsx","project/components/ui/drawer.tsx","project/components/ui/dropdown-menu.tsx","project/components/ui/empty.tsx","project/components/ui/field.tsx","project/components/ui/form.tsx","project/components/ui/hover-card.tsx","project/components/ui/input-group.tsx","project/components/ui/input-otp.tsx","project/components/ui/input.tsx","project/components/ui/item.tsx","project/components/ui/kbd.tsx","project/components/ui/label.tsx","project/components/ui/marker.tsx","project/components/ui/menubar.tsx","project/components/ui/message-scroller.tsx","project/components/ui/message.tsx","project/components/ui/native-select.tsx","project/components/ui/navigation-menu.tsx","project/components/ui/pagination.tsx","project/components/ui/popover.tsx","project/components/ui/progress.tsx","project/components/ui/radio-group.tsx","project/components/ui/resizable.tsx","project/components/ui/scroll-area.tsx","project/components/ui/select.tsx","project/components/ui/separator.tsx","project/components/ui/sheet.tsx","project/components/ui/sidebar.tsx","project/components/ui/skeleton.tsx","project/components/ui/slider.tsx","project/components/ui/sonner.tsx","project/components/ui/spinner.tsx","project/components/ui/switch.tsx","project/components/ui/table.tsx","project/components/ui/tabs.tsx","project/components/ui/textarea.tsx","project/components/ui/toggle-group.tsx","project/components/ui/toggle.tsx","project/components/ui/tooltip.tsx","project/desktop/renderer/a4-quotation.tsx","project/desktop/renderer/admin-management.tsx","project/desktop/renderer/browser-main.tsx","project/desktop/renderer/capability-permissions.tsx","project/desktop/renderer/central-main.tsx","project/desktop/renderer/central-print.tsx","project/desktop/renderer/customer-activity.tsx","project/desktop/renderer/customer-directory.tsx","project/desktop/renderer/customer-picker.tsx","project/desktop/renderer/customer-responsibility.tsx","project/desktop/renderer/employee-profile.tsx","project/desktop/renderer/employee-update.tsx","project/desktop/renderer/home-polls.tsx","project/desktop/renderer/host-maintenance-panel.tsx","project/desktop/renderer/host-print-settings.tsx","project/desktop/renderer/integration-home.tsx","project/desktop/renderer/integration-settings.tsx","project/desktop/renderer/integration-toolbar.tsx","project/desktop/renderer/main.tsx","project/desktop/renderer/message-board.tsx","project/desktop/renderer/network-settings.tsx","project/desktop/renderer/personal-notes.tsx","project/desktop/renderer/personal-sales.tsx","project/desktop/renderer/preview-drawer.tsx","project/desktop/renderer/print-window.tsx","project/desktop/renderer/print-worker-templates.tsx","project/desktop/renderer/remote-print.tsx","project/desktop/renderer/sales-report.tsx","project/desktop/renderer/style-picker.tsx","project/desktop/renderer/warranty-document.tsx","project/desktop/renderer/warranty-quotation.tsx","project/desktop/renderer/workspace-dialog.tsx","project/desktop/renderer/workspace.tsx","project/lib/connector-contract.mts","project/lib/connector-errors.mts"];
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const inside=(base,file)=>{const relative=path.relative(base,file);return relative===''||relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);};
const norm=file=>path.resolve(file).toLowerCase();
const read=file=>fs.readFileSync(guard.assertPath(file));
const parent=guard.assertPath(path.join(ROOT,'runtime/typed-auth-boundary'));
fs.mkdirSync(parent,{recursive:true});
const OWNED=guard.assertPath(fs.mkdtempSync(path.join(parent,'owned-')));
fs.writeFileSync(path.join(OWNED,'qa-owner.json'),JSON.stringify({version:1,purpose:'typed-auth-boundary',productionDataImported:false,servicesStarted:false,runId:crypto.randomUUID()})+'\n',{flag:'wx'});
let buildPromise,fullCompiler,compilerStopped=false,runtimeIO=null,runtimeAdmissionAttempted=false,runtimeAdmitted=false;

function walk(node,predicate,out=[]){if(predicate(node))out.push(node);ts.forEachChild(node,child=>{walk(child,predicate,out);});return out;}
function sourceAst(relative){
 const filename=guard.assertPath(path.join(ROOT,relative)),bytes=read(filename),ast=ts.createSourceFile(filename,bytes.toString('utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
 assert.equal(ast.parseDiagnostics.length,0,'Actual builder parses');
 return{filename,bytes,ast};
}
function fullReleaseCompiler(){
 if(fullCompiler)return fullCompiler;
 const info=sourceAst('stage1/build-full-release.cjs');
 // Read-only audit export of existing private functions, no replacement body.
 // require.main is the test, so the builder's existing CLI guard remains false.
 const compiled=new Module(info.filename,module);compiled.filename=info.filename;compiled.paths=Module._nodeModulePaths(path.dirname(info.filename));
 compiled._compile(info.bytes.toString('utf8')+'\nmodule.exports.__authBoundaryAudit={compilerSourceHashes,read};\n',info.filename);
 fullCompiler=compiled.exports.__authBoundaryAudit;
 assert.equal(typeof fullCompiler.compilerSourceHashes,'function');assert.equal(typeof fullCompiler.read,'function');
 return fullCompiler;
}
function actualBuildOptions(kind,output){
 const relative={dev:'project/desktop/build.cjs',stage1:'stage1/build-business.cjs',release:'stage1/build-full-release.cjs',finance:'audit-tools/finance-guards-build.cjs'}[kind];
 const info=sourceAst(relative);
 const candidates=walk(info.ast,node=>ts.isCallExpression(node)&&node.arguments[0]&&ts.isObjectLiteralExpression(node.arguments[0])&&(
  kind==='release'?ts.isIdentifier(node.expression)&&node.expression.text==='output':
  ts.isPropertyAccessExpression(node.expression)&&ts.isIdentifier(node.expression.expression)&&node.expression.expression.text==='esbuild'&&node.expression.name.text==='build'
 ));
 const call=kind==='finance'?candidates[0]:candidates.find(node=>walk(node.arguments[0],child=>ts.isStringLiteral(child)&&['server.ts','lib/server.ts'].includes(child.text)).length>0);
 assert(call,'Actual '+kind+' backend build options exist; changed extraction is a harness review, not product RED');
 const initial=new Map(['lib/domain.ts','lib/server.ts','components/quote-card.tsx','desktop/customer-identity.cjs','tsconfig.json'].map(relative=>['project/'+relative,sha(read(path.join(PROJECT,relative)))]));
 const bindings={fs,path,root:kind==='dev'?PROJECT:ROOT,project:PROJECT,PROJECT,DESKTOP,__dirname:path.dirname(info.filename),guard,deps:DEPS,output,app:path.join(OWNED,'not-run-app'),source:'lib/server.ts',name:'server',sourceHashes:initial,inside,digest:sha,read:fullReleaseCompiler().read};
 // Same JS realm as esbuild: real RegExp plugin filters must not be VM proxies.
 const make=Function(...Object.keys(bindings),'"use strict"; return ('+call.arguments[0].getText(info.ast)+');');
 const options=make(...Object.values(bindings));
 assert(Array.isArray(options.plugins)&&options.plugins.length,'Actual production/fixture plugin retained');
 return{relative,sourceSHA256:sha(info.bytes),options};
}
async function compileAll(){
 if(buildPromise)return buildPromise;
 assert.equal(runtimeIO,null,'Compiler service cannot restart after runtime IO admission');
 buildPromise=(async()=>{
  try{
  const snapshot=fullReleaseCompiler().compilerSourceHashes(),artifacts={};
  for(const kind of ['dev','stage1','release','finance']){
   const file=guard.assertPath(path.join(OWNED,kind+'-business.cjs')),driver=actualBuildOptions(kind,file);
   // Output/provenance-only adaptation. Keep actual entry/config/plugin callbacks.
   // These defaults equal the real release output wrapper, never an auth stub.
   const options={...driver.options,absWorkingDir:PROJECT,outfile:file,bundle:true,platform:'node',format:'cjs',target:'node22',write:false,metafile:true,nodePaths:[DEPS],logLevel:'warning'};
   const result=await esbuild.build(options);assert.equal(result.outputFiles.length,1);
   const inputs=[];
   for(const name of Object.keys(result.metafile.inputs)){
    if(name.startsWith('offline-platform:')||name.startsWith('finance-fixture:')){inputs.push({input:name,virtual:true});continue;}
    const actual=guard.assertPath(path.resolve(PROJECT,name));
    assert(inside(PROJECT,actual)||inside(DEPS,actual),'Compiler input remains in actual source/public Guest dependencies');
    inputs.push({input:name,file:actual,sha256:sha(read(actual))});
   }
   assert.equal(sha(read(path.join(ROOT,driver.relative))),driver.sourceSHA256,'Actual driver source did not change during compilation');
   fs.writeFileSync(file,result.outputFiles[0].contents,{flag:'wx'});
   artifacts[kind]={file,bytes:Buffer.from(result.outputFiles[0].contents),sha256:sha(result.outputFiles[0].contents),driver:{file:driver.relative,sha256:driver.sourceSHA256},inputs,metafile:result.metafile};
  }
  await esbuild.stop();compilerStopped=true;
  assert.deepEqual(fullReleaseCompiler().compilerSourceHashes(),snapshot,'Actual release source-freeze inputs remain identical through the backend compiles');
  const report={purpose:'typed-auth-boundary-backend-compiles',compiler:{esbuild:esbuild.version,typescript:ts.version,zod:zodMetadata.version,stopped:true},onlyBackendOptions:true,cliStarted:false,rendererBuilt:false,businessExecuted:false,databaseOpened:false,sourceHashes:snapshot,artifacts:Object.fromEntries(Object.entries(artifacts).map(([kind,row])=>[kind,{file:row.file,sha256:row.sha256,driver:row.driver,inputs:row.inputs,metafile:row.metafile}]))};
  fs.writeFileSync(path.join(OWNED,'compiler-evidence.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  return{artifacts,sourceHashes:snapshot};
  }finally{if(!compilerStopped){await esbuild.stop();compilerStopped=true;}}
 })();
 return buildPromise;
}
function inputFor(row,file){return row.inputs.find(input=>input.file&&norm(input.file)===norm(file));}
function configured(){
 const file=path.join(PROJECT,'tsconfig.json'),value=ts.readConfigFile(file,name=>read(name).toString('utf8'));
 assert.equal(value.error,undefined,'Actual config parses');
 const result=ts.parseJsonConfigFileContent(value.config,ts.sys,PROJECT,undefined,file);
 assert.equal(result.errors.length,0,'Actual root discovery succeeds, independent of missing auth module');
 return result;
}
function notImplemented(condition,message){assert(condition,'NEW_TYPED_BOUNDARY_NOT_IMPLEMENTED: '+message);}
function deny(name){return()=>{throw Error('Out-of-scope test service '+name);};}
function admitRuntimeIO(){
 if(runtimeAdmissionAttempted){assert.equal(runtimeAdmitted,true,'A failed runtime IO admission cannot be retried or bypassed');return runtimeIO;}
 runtimeAdmissionAttempted=true;
 assert.equal(compilerStopped,true,'All four backend compiles and esbuild.stop precede real DB admission');
 assert.equal(Object.keys(require.cache).some(file=>inside(PROJECT,file)),false,'No product module may capture FS/SQLite primitives before the original IO guard');
 assert.equal(sha(read(path.join(ROOT,'stage1/io-guard.cjs'))),'28d25feb5340273806823d41e5e0bd95b5120086920711cc80101b85e6074f2c','Unchanged actual IO guard source required');
 runtimeIO=require('../stage1/io-guard.cjs').install({root:OWNED,writeDirs:[OWNED],readDirs:[PROJECT,DEPS,path.join(ROOT,'stage1')],childPrograms:[]});
 assert.equal(runtimeIO.installed,true);
 // Validate denial without opening any old config/profile/key or foreign DB.
 for(const file of [path.join(ROOT,'config/desktop-profile/network.json'),path.join(ROOT,'private/forbidden.key'),path.join(ROOT,'data/sales/jewelry.sqlite')]){
  assert.throws(()=>runtimeIO.check(file,false),error=>error.code==='ISOLATION','Foreign business/config content must be denied even if present');
 }
 const forbiddenNew=path.join(ROOT,'runtime','typed-auth-forbidden-'+crypto.randomUUID()+'.sqlite');
 assert.throws(()=>new (require('node:sqlite').DatabaseSync)(forbiddenNew),error=>error.code==='ISOLATION','Original guard rejects a foreign connection before native SQLite opens it');
 runtimeAdmitted=true;
 return runtimeIO;
}
function newMutablePath(file){
 const value=runtimeIO.guard.assertPath(file);
 assert.equal(fs.existsSync(value),false,'CreateNew path cannot adopt an existing file or directory: '+value);
 return value;
}
function backendPaths(artifacts){
 const directory=newMutablePath(path.join(OWNED,'backend-'+crypto.randomUUID()));fs.mkdirSync(directory);
 const dataDir=path.join(directory,'sales'),printDir=path.join(directory,'print'),logs=path.join(directory,'logs'),inventoryFile=path.join(directory,'path-inventory.json');
 const dbFile=path.join(dataDir,'jewelry.sqlite'),images=path.join(dataDir,'images'),metadata=path.join(images,'metadata.json');
 const printServices={legacyRetainedFile:path.join(printDir,'legacy.json'),legacyMetadataFile:path.join(printDir,'legacy-metadata.json'),retainedFile:path.join(printDir,'central.json')};
 const exact=[dataDir,printDir,logs,inventoryFile,dbFile,dbFile+'-wal',dbFile+'-shm',dbFile+'-journal',images,metadata,path.join(logs,'gateway-errors.log'),...Object.values(printServices),...Object.values(printServices).map(file=>file+'.lock')];
 const first='10000000-0000-4000-8000-000000000001',second='10000000-0000-4000-8000-000000000002';
 const templates=[{base:images,pattern:'<uuid>',sample:path.join(images,first)},{base:images,pattern:'<uuid>.<uuid>.tmp',sample:path.join(images,first+'.'+second+'.tmp')},{base:images,pattern:'metadata.json.<uuid>.tmp',sample:metadata+'.'+first+'.tmp'},...Object.values(printServices).map(file=>({base:path.dirname(file),pattern:path.basename(file)+'.<uuid>.tmp',sample:file+'.'+first+'.tmp'}))];
 for(const file of exact)newMutablePath(file);
 for(const template of templates)newMutablePath(template.sample);
 for(const file of [dataDir,printDir,logs])fs.mkdirSync(file);
 assert.equal(fs.readdirSync(dataDir).length,0,'Real runtime only receives a newly created empty sales directory');
 const migrationDir=path.join(DESKTOP,'migrations');runtimeIO.check(migrationDir,false);
 const dependencies=[...fs.readdirSync(DESKTOP).filter(name=>name.endsWith('.cjs')).map(name=>path.join(DESKTOP,name)),...fs.readdirSync(migrationDir).filter(name=>/^\d+_[\w-]+\.sql$/.test(name)).map(name=>path.join(migrationDir,name)),path.join(PROJECT,'package.json')];
 const codeInputs=dependencies.map(file=>{runtimeIO.check(file,false);return{file,sha256:sha(fs.readFileSync(file))};});
 const ownedArtifacts=Object.values(artifacts).map(row=>{runtimeIO.guard.assertPath(row.file);assert.equal(sha(fs.readFileSync(row.file)),row.sha256,'Only already-compiled owned artifacts may be loaded');return{file:row.file,sha256:row.sha256};});
 const owner=fs.statSync(directory,{bigint:true});
 fs.writeFileSync(inventoryFile,JSON.stringify({purpose:'typed-auth-backend-preopen',directory,owner:{dev:String(owner.dev),ino:String(owner.ino)},exact,templates,codeInputs,ownedArtifacts,readRoots:[PROJECT,DEPS,path.join(ROOT,'stage1')],writeRoot:OWNED,childPrograms:[],productionDataImported:false},null,2)+'\n',{flag:'wx'});
 return{directory,dataDir,printDir,logs,dbFile,images,metadata,printServices,migrationDir,inventoryFile};
}
async function withBackend(t,count,run){
 const {artifacts}=await compileAll();admitRuntimeIO();
 const {dataDir,printServices,migrationDir,dbFile}=backendPaths(artifacts);
 let backend,openedRuntime;
 t.after(async()=>{if(backend)await backend.close();else if(openedRuntime)openedRuntime.close();});
 const {createRuntime}=require('../project/desktop/runtime.cjs');
 const {createBackend}=require('../project/desktop/backend.cjs');
 backend=createBackend({dataDir,migrationDir,businessPath:artifacts.release.file,
  runtimeFactory:options=>{assert.equal(norm(options.dataDir),norm(dataDir));assert.equal(norm(options.migrationDir),norm(migrationDir));assert.equal(norm(runtimeIO.guard.assertPath(path.join(options.dataDir,'jewelry.sqlite'))),norm(dbFile));openedRuntime=createRuntime(options);return openedRuntime;},
  printServices,
  moduleAdapter:{status:deny('module-status'),proxy:deny('module-proxy'),collaborationSnapshot:deny('module-snapshot')},
  pollsAdapter:{handle:deny('polls')},aiAdapter:{handle:deny('AI')},
  updateServices:{getCatalog:deny('update-catalog'),getChunk:deny('update-chunk'),close:async()=>{}}});
 const core=require(artifacts.release.file),runtime=backend.runtime;
 const databases=runtime.sqlite.prepare('PRAGMA database_list').all(),mains=databases.filter(row=>row.name==='main');
 assert.equal(mains.length,1);assert.equal(norm(mains[0].file),norm(path.join(dataDir,'jewelry.sqlite')),'Only the newly created owned synthetic database is open');
 assert(databases.every(row=>row.name==='main'||row.name==='temp'&&row.file===''),'No attached unowned database');
 assert.equal(Object.hasOwn(globalThis,'__financeGuardFixture'),false,'Production runtime must not receive finance fixture identity');
 const employees=[];
 if(count){
  const setup=await backend.dispatch({path:'/auth/setup',method:'POST',body:{username:'typed-admin',name:'虚构边界管理员',password:'Fictitious-Auth-Boundary-2026!'}});
  assert.equal(setup.status,200);
  for(let index=0;index<count;index++){
   const username='typed-employee-'+String(index+1).padStart(2,'0');
   const created=await backend.dispatch({path:'/api/users',method:'POST',body:{username,name:'虚构边界员工'+(index+1),password:'Fictitious-Auth-Boundary-2026!',role:'employee'}});
   assert.equal(created.status,201);
   const session=backend.createSession({sourcePeer:'typed-auth-owned'}),login=await session.dispatch({path:'/auth/login',method:'POST',body:{username,password:'Fictitious-Auth-Boundary-2026!'}});
   assert.equal(login.status,200);employees.push({session,user:login.data.user,identity:session.auth.identity()});
  }
 }
 return run({backend,core,runtime,employees,artifacts});
}

test('A01 concrete typed identity source is a real implementation, not ambient any',()=>{
 notImplemented(fs.existsSync(ADAPTER),'real lib/platform/desktop-identity.ts source is absent; this is an unimplemented source feature, not a proven login defect');
 const bytes=read(ADAPTER),ast=ts.createSourceFile(ADAPTER,bytes.toString('utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
 assert.equal(ast.parseDiagnostics.length,0);assert.equal(walk(ast,node=>node.kind===ts.SyntaxKind.AnyKeyword).length,0,'No type any used to silence the boundary');
 const declared=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='getChatGPTUser');
 assert(declared?.body&&declared.type,'Actual exported function has a body and explicit return contract');
 assert(declared.modifiers?.some(node=>node.kind===ts.SyntaxKind.ExportKeyword));
});

test('A02 old import resolves exactly to the same concrete production typed module',()=>{
 const config=configured(),mapped=config.options.paths?.[OLD_IMPORT];
 notImplemented(Array.isArray(mapped)&&mapped.length===1,'exact old-import target mapping is missing');
 const resolved=ts.resolveModuleName(OLD_IMPORT,path.join(PROJECT,'lib/server.ts'),config.options,ts.sys).resolvedModule;
 notImplemented(!!resolved,'concrete target does not resolve');
 assert.equal(norm(resolved.resolvedFileName),norm(ADAPTER));
});

test('A03 original 124 roots and strict checks are retained rather than excluding server',()=>{
 const config=configured(),actual=new Set(config.fileNames.map(norm));
 const options={...config.raw.compilerOptions};delete options.paths;
 assert.deepEqual(options,BASELINE_CONFIG.compilerOptions,'Only the exact platform path mapping changes compiler options');
 assert.deepEqual(config.raw.include,BASELINE_CONFIG.include);assert.deepEqual(config.raw.exclude,BASELINE_CONFIG.exclude);
 assert.deepEqual(config.options.paths?.['@/*'],['./*']);
 assert.equal(BASELINE_ROOTS.length,124);
 for(const name of BASELINE_ROOTS)assert(actual.has(norm(path.join(ROOT,name))),'Original source root retained: '+name);
 assert.equal(config.options.strict,true);assert.equal(config.options.noEmit,true);assert.notEqual(config.options.noImplicitAny,false);assert.notEqual(config.options.strictNullChecks,false);assert.equal(config.options.allowJs,true);
});

for(const kind of ['dev','stage1','release']){
 test('A04 '+kind+' actual backend compiler consumes the concrete typed module in its metafile',{timeout:120000},async()=>{
  const {artifacts}=await compileAll(),row=artifacts[kind],input=inputFor(row,ADAPTER);
  notImplemented(!!input,kind+' still uses virtual identity rather than the new source; full CLI/renderer workflow is not claimed by this test');
  assert.equal(input.sha256,sha(read(ADAPTER)));assert.equal(row.metafile.inputs[input.input].bytes,read(ADAPTER).length,'Metafile reports the actual full typed source byte length');
  assert(!row.inputs.some(item=>item.input==='offline-platform:identity'),'Legacy duplicate virtual identity must not remain in production compile');
  assert(!row.bytes.includes(Buffer.from('__financeGuardFixture')),'Finance fixture cannot enter production artifact');
 });
}

test('A05 actual release compilerSourceHashes covers the concrete lib identity source',{timeout:120000},async()=>{
 const {sourceHashes}=await compileAll();
 notImplemented(Object.hasOwn(sourceHashes,ADAPTER_REL),'actual source-freeze inventory omits the new typed module');
 assert.equal(sourceHashes[ADAPTER_REL],sha(read(ADAPTER)));
});

test('F01 actual finance compiler remains explicitly synthetic and cannot masquerade as production',{timeout:120000},async()=>{
 const {artifacts}=await compileAll(),finance=artifacts.finance;
 assert(finance.inputs.some(item=>item.input==='finance-fixture:identity'),'Existing finance onResolve still owns its fixture identity');
 assert(!inputFor(finance,ADAPTER),'Finance fixture deliberately does not consume production identity source');
 assert(finance.bytes.includes(Buffer.from('__financeGuardFixture')));
 for(const kind of ['dev','stage1','release'])assert(!artifacts[kind].bytes.includes(Buffer.from('__financeGuardFixture')));
});

test('B01 real release core rejects anonymous identity with 401 and missing ALS context throws',{timeout:120000},async t=>{
 await withBackend(t,0,async({backend,core,runtime})=>{
  const getter=globalThis.__xjyDesktopContext;assert.equal(typeof getter,'function');
  assert.throws(()=>getter(),/上下文/);await assert.rejects(()=>core.authenticated(),/上下文/);
  const before=runtime.sqlite.prepare('SELECT count(*) AS n FROM staff_users').get().n;
  const response=await runtime.withIdentity(null,()=>core.api(()=>core.authenticated()));
  assert.equal(response.status,401);assert.equal(runtime.sqlite.prepare('SELECT count(*) AS n FROM staff_users').get().n,before,'Anonymous request cannot provision a default administrator');
  assert.equal((await backend.dispatch({path:'/api/bootstrap'})).status,401);assert.equal(runtime.getIdentity(),null);
 });
});

test('B02 real release identity is read per invocation across nested A/B/A ALS scopes',{timeout:120000},async t=>{
 await withBackend(t,2,async({core,runtime,employees})=>{
  const [a,b]=employees;await runtime.withIdentity(a.identity,async()=>{
   assert.equal((await core.authenticated()).user.id,a.user.id);
   await runtime.withIdentity(b.identity,async()=>{await Promise.resolve();assert.equal((await core.authenticated()).user.id,b.user.id);});
   await new Promise(resolve=>setImmediate(resolve));assert.equal((await core.authenticated()).user.id,a.user.id);
  });assert.equal(runtime.getIdentity(),null);
 });
});

test('B03 ten actual employee identities stay independent across overlapping awaits',{timeout:120000},async t=>{
 await withBackend(t,10,async({core,runtime,employees})=>{
  let entered=0,release;const allEntered=new Promise(resolve=>{release=resolve;});
  await Promise.all(employees.map(employee=>runtime.withIdentity(employee.identity,async()=>{
   if(++entered===10)release();await allEntered;await new Promise(resolve=>setImmediate(resolve));
   assert.equal(globalThis.__xjyDesktopContext().identity.userId,employee.identity.userId);
   assert.equal((await core.authenticated()).user.id,employee.user.id);
   await Promise.resolve();assert.equal((await core.authenticated()).user.role,'employee');
  })));
  assert.equal(runtime.getIdentity(),null);assert.throws(()=>globalThis.__xjyDesktopContext(),/上下文/);
 });
});

test('B04 actual backend sessions do not accept client actor fields as trusted identity',{timeout:120000},async t=>{
 await withBackend(t,2,async({backend,employees})=>{
  const [a,b]=employees,admin=backend.auth.status().user;
  const reply=await a.session.dispatch({path:'/api/bootstrap',actor:admin,identity:b.identity,headers:{'x-actor-id':admin.id}});
  assert.equal(reply.status,200);assert.equal(reply.data.user.id,a.user.id);assert.equal(reply.data.user.role,'employee');
  const denied=await a.session.dispatch({path:'/api/users',actor:admin,identity:admin,headers:{'x-actor-role':'admin'}});
  assert.equal(denied.status,403,'Current session remains employee despite forged dispatch payload fields');
 });
});

test.after(async()=>{if(!runtimeIO&&!compilerStopped)await esbuild.stop();});

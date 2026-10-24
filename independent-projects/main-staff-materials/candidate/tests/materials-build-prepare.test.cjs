'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{pathToFileURL}=require('node:url');
const ROOT=path.resolve(__dirname,'..'),HELPER=path.join(ROOT,'stage1/prepare-materials-runtime.cjs');
const {prepareMaterialsRuntime,verifyMaterialsRuntime,sourceMaterialsFreeze,auditMaterialsRuntime}=require(HELPER);
const run=path.join(ROOT,'runtime','materials-build-tests-'+crypto.randomUUID());fs.mkdirSync(run,{recursive:true});
const SOURCE_FILES=Object.freeze([
 'materials-runtime-entry.mjs','profile-materials.mjs','mounted-materials.mjs','materials-session-transport.mjs',
 'materials/package.json','materials/package-lock.json','materials/server.mjs',
 'materials/lib/classifier.mjs','materials/lib/library.mjs','materials/lib/review-first.mjs','materials/lib/search.mjs','materials/lib/storage-profile.mjs',
 'materials/auth/lib/access-adapter.mjs','materials/auth/candidate-authority-host.mjs',
 'materials/auth/vendor/desktop/local-auth.cjs','materials/auth/vendor/desktop/administration.cjs','materials/auth/vendor/desktop/erp-policy.cjs','materials/auth/vendor/desktop/cashier-policy.cjs',
 'materials/auth/vendor/desktop/migrations/0004_module_administration.sql','materials/auth/vendor/desktop/migrations/0005_workspace_collaboration.sql','materials/auth/vendor/desktop/migrations/0012_cashier_module_permissions.sql',
 'materials/vendor/intake-state/intake-state.mjs','materials/public/index.html','materials/public/app.js','materials/public/styles.css',
 'project/desktop/lan.cjs','project/desktop/managed-print-worker.cjs','project/desktop/print-worker-client.cjs','project/desktop/print-worker-transport.cjs','project/desktop/print-agent.cjs','project/desktop/print-agent-channel.cjs','project/desktop/print-routing.cjs','project/desktop/materials-capability.cjs','project/desktop/materials-native-protocol.cjs','stage1/prepare-materials-runtime.cjs'
]);
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function files(dir,prefix=''){let out=[];for(const n of fs.readdirSync(dir).sort()){const p=path.join(dir,n),s=fs.lstatSync(p);if(s.isDirectory())out.push(...files(p,prefix+n+'/'));else out.push(prefix+n);}return out;}
function hashes(paths){return Object.fromEntries(paths.map(p=>[p,hash(fs.readFileSync(path.join(ROOT,...p.split('/'))))]));}
function copy(from,to){fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to,fs.constants.COPYFILE_EXCL);}
function fixture(){const root=path.join(run,'source-fixture-'+crypto.randomUUID());for(const name of [...SOURCE_FILES,...files(path.join(ROOT,'materials/node_modules')).map(n=>'materials/node_modules/'+n)])copy(path.join(ROOT,...name.split('/')),path.join(root,...name.split('/')));return{root,helper:require(path.join(root,'stage1/prepare-materials-runtime.cjs'))};}
let prepared;
test('prepare creates a byte-for-byte ESM and fixed native dependency closure without starting services',async()=>{
 const native=files(path.join(ROOT,'materials/node_modules'));assert.equal(native.length,126,'reviewed native source inventory must stay exact');
 const before=hashes([...SOURCE_FILES,...native.map(n=>'materials/node_modules/'+n)]);
 prepared=await prepareMaterialsRuntime({outputDir:path.join(ROOT,'runtime','materials-build-proof-'+crypto.randomUUID())});
 assert.equal(prepared.version,1);assert.equal(prepared.nativeAsarVerified,false);assert.equal(prepared.sealed,false);assert.equal(prepared.installed,false);assert.equal(prepared.servicesStarted,false);
 assert.equal(prepared.parser.name,'typescript');assert.equal(prepared.parser.version,'5.9.3');assert.equal(Object.keys(prepared.parser.files).length,3,'build parser pins remain separate from the 126 shipped native dependencies');
 assert.deepEqual(prepared.sourceHashes,before);assert.equal(prepared.artifacts.resources.length,126);
 for(const source of SOURCE_FILES.filter(n=>!n.startsWith('project/')&&!n.startsWith('stage1/'))){const target=path.join(prepared.app,'materials-runtime',...source.split('/'));assert.deepEqual(fs.readFileSync(target),fs.readFileSync(path.join(ROOT,...source.split('/'))),source);}
 for(const name of ['index.html','app.js','styles.css'])assert.deepEqual(fs.readFileSync(path.join(prepared.app,'assets/sales-materials',name)),fs.readFileSync(path.join(ROOT,'materials/public',name)));
 for(const name of native)assert.deepEqual(fs.readFileSync(path.join(prepared.resources,'print-dependencies/node_modules',...name.split('/'))),fs.readFileSync(path.join(ROOT,'materials/node_modules',...name.split('/'))));
 assert.deepEqual(hashes(Object.keys(before)),before,'prepare must not modify any source byte');
 const suite=await import(pathToFileURL(path.join(prepared.app,'materials-runtime/materials-runtime-entry.mjs')).href);assert.equal(typeof suite.createMaterialRuntimeSuite,'function');
 assert.equal(require(path.join(prepared.app,'materials-runtime/project/desktop/lan.cjs')),require(path.join(prepared.app,'lan.cjs')),'shim must reuse the original module object');
 assert.equal(require(path.join(prepared.app,'materials-runtime/project/desktop/managed-print-worker.cjs')),require(path.join(prepared.app,'managed-print-worker.cjs')));
 const nativeSharp=require(path.join(prepared.resources,'print-dependencies/node_modules/sharp'));const image=await nativeSharp({create:{width:2,height:2,channels:3,background:'#ffffff'}}).png().toBuffer();assert.ok(image.length>8,'actual copied native addon must encode a synthetic image');
 const classifier=await import(pathToFileURL(path.join(prepared.app,'materials-runtime/materials/lib/classifier.mjs')).href),converted=await classifier.prepareImage(image);assert.equal(converted.sha256,hash(image));assert.deepEqual(converted.bytes.subarray(0,3),Buffer.from([255,216,255]),'actual copied classifier must resolve its bare sharp import and produce JPEG without a model call');
 assert.ok(auditMaterialsRuntime({app:prepared.app,resources:prepared.resources,preparation:prepared}));
 assert.ok(verifyMaterialsRuntime(prepared));
});
test('identical preparation is idempotent and the freeze records the actual sources',async()=>{
 assert.ok(prepared);const entry=path.join(prepared.app,'materials-runtime/materials-runtime-entry.mjs'),before=fs.statSync(entry).mtimeMs;
 const again=await prepareMaterialsRuntime({outputDir:prepared.outputDir});assert.deepEqual(again,prepared);assert.equal(fs.statSync(entry).mtimeMs,before);
 const freeze=sourceMaterialsFreeze();assert.deepEqual(freeze.sourceHashes,prepared.sourceHashes);
});
test('unknown destinations and path aliases fail without creating a target',async()=>{
 const unknown=path.join(ROOT,'runtime','other-build-'+crypto.randomUUID());await assert.rejects(Promise.resolve().then(()=>prepareMaterialsRuntime({outputDir:unknown})),/输出|目标|materials|owned|固定/i);assert.equal(fs.existsSync(unknown),false);
 const alias=path.join(ROOT,'runtime','materials-build-alias-'+crypto.randomUUID())+path.sep+'..'+path.sep+'escape';await assert.rejects(Promise.resolve().then(()=>prepareMaterialsRuntime({outputDir:alias})),/路径|别名|canonical|固定/i);
});
test('unknown pre-existing output is preserved and no native files are partially copied',async()=>{
 const outputDir=path.join(ROOT,'runtime','materials-build-occupied-'+crypto.randomUUID());fs.mkdirSync(outputDir);fs.writeFileSync(path.join(outputDir,'keep.txt'),'synthetic occupied output');
 await assert.rejects(Promise.resolve().then(()=>prepareMaterialsRuntime({outputDir})),/未知|额外|output|目标|存在|预期/i);assert.equal(fs.readFileSync(path.join(outputDir,'keep.txt'),'utf8'),'synthetic occupied output');assert.deepEqual(fs.readdirSync(outputDir),['keep.txt']);
});
test('tampering and extra files in the prepared closure fail verification',()=>{
 const f=path.join(prepared.app,'assets/sales-materials/styles.css'),original=fs.readFileSync(f);try{fs.writeFileSync(f,'/* synthetic tamper */');assert.throws(()=>verifyMaterialsRuntime(prepared),/变化|校验|篡改|摘要|不一致|changed/i);}finally{fs.writeFileSync(f,original);}
 const extra=path.join(prepared.app,'materials-runtime','unexpected.mjs');try{fs.writeFileSync(extra,'export const injected=true;');assert.throws(()=>verifyMaterialsRuntime(prepared),/清单|额外|未知|不一致|changed/i);}finally{fs.unlinkSync(extra);}
 assert.ok(verifyMaterialsRuntime(prepared));
});
test('source snapshots, unknown native files, symlinks, and hardlinks are rejected in raw-byte fixtures',async()=>{
 const fx=fixture(),out=()=>path.join(fx.root,'runtime','materials-build-fixture-'+crypto.randomUUID()),receipt=await fx.helper.prepareMaterialsRuntime({outputDir:out()});
 const source=path.join(fx.root,'materials/lib/review-first.mjs'),original=fs.readFileSync(source);try{fs.appendFileSync(source,'\n// synthetic source drift\n');assert.throws(()=>fx.helper.verifyMaterialsRuntime(receipt),/源|变化|不一致|changed/i);}finally{fs.writeFileSync(source,original);}
 const extra=path.join(fx.root,'materials/node_modules/unexpected.log');try{fs.writeFileSync(extra,'synthetic unknown');await assert.rejects(Promise.resolve().then(()=>fx.helper.prepareMaterialsRuntime({outputDir:out()})),/未知|清单|126|依赖|native/i);}finally{fs.unlinkSync(extra);}
 const alias=path.join(fx.root,'runtime','materials-build-link-'+crypto.randomUUID());fs.symlinkSync(path.dirname(receipt.outputDir),alias,'junction');try{await assert.rejects(Promise.resolve().then(()=>fx.helper.prepareMaterialsRuntime({outputDir:alias})),/链接|junction|alias|符号/i);}finally{fs.unlinkSync(alias);}
 const hold=path.join(fx.root,'hardlink-original.mjs');fs.renameSync(source,hold);fs.linkSync(hold,source);try{await assert.rejects(Promise.resolve().then(()=>fx.helper.prepareMaterialsRuntime({outputDir:out()})),/硬链接|hard/i);}finally{fs.unlinkSync(source);fs.renameSync(hold,source);}
});
test('freeze and actual pack input dependency audit bind ESM, sharp, and the fixed source receipt',()=>{
 const builder=require('../stage1/build-full-release.cjs');
 // The real candidate is a source-only export and lacks the original generated
 // print assets. Use untouched source bytes as explicit hashing-only fixture
 // sentinels in those slots; they are never compiled, imported, or packaged.
 const fx=fixture(),desktop=path.join(fx.root,'project/desktop');copy(path.join(ROOT,'stage1/build-full-release.cjs'),path.join(fx.root,'stage1/build-full-release.cjs'));
 for(const name of builder.RUNTIME_FILES){const dest=path.join(desktop,name);if(!fs.existsSync(dest))copy(path.join(ROOT,'project/desktop',name),dest);}
 for(const [slot,source] of [['generated/print-asset-parsers.cjs','project/desktop/print-asset-source-wrapper.cjs'],['generated/print-source-assets-registry.cjs','project/desktop/print-source-assets.cjs'],['generated/print-source-assets-manifest.json','materials/package.json'],['web-runtime/web-gateway.cjs','stage1/web-gateway.cjs'],['assets/fixture.html','materials/public/index.html']])copy(path.join(ROOT,...source.split('/')),path.join(desktop,...slot.split('/')));
 for(const name of files(path.join(ROOT,'project/desktop/migrations')))copy(path.join(ROOT,'project/desktop/migrations',...name.split('/')),path.join(desktop,'migrations',...name.split('/')));
 const fixtureBuilder=require(path.join(fx.root,'stage1/build-full-release.cjs')),freeze=fixtureBuilder.sourceFreeze({programVersion:'1.7.0',materialsRuntime:true});assert.deepEqual(freeze.materials.sourceHashes,prepared.sourceHashes);
 for(const name of ['materials-capability.cjs','materials-native-protocol.cjs'])assert.equal(freeze.files[name],hash(fs.readFileSync(path.join(ROOT,'project/desktop',name))));
 const required=path.join(desktop,'materials-capability.cjs'),hold=required+'.saved';fs.renameSync(required,hold);try{assert.throws(()=>fixtureBuilder.sourceFreeze({programVersion:'1.7.0',materialsRuntime:true}),/缺失|missing/i,'missing Root runtime must never be silently skipped');}finally{fs.renameSync(hold,required);}
 const audit=builder.auditRuntimeDependencies(prepared.app,{materialsPreparation:prepared,resourcesRoot:prepared.resources});assert.ok(audit.materials);
 const entry=path.join(prepared.app,'materials-runtime/materials-runtime-entry.mjs'),old=fs.readFileSync(entry);try{fs.appendFileSync(entry,"\nimport './missing-runtime-dependency.mjs';\n");assert.throws(()=>builder.auditRuntimeDependencies(prepared.app,{materialsPreparation:prepared,resourcesRoot:prepared.resources}),/缺少|变化|校验|篡改|不一致|changed|依赖/i);}finally{fs.writeFileSync(entry,old);}
 assert.throws(()=>builder.assertMaterialsSealReady({materialsRuntime:true,preparation:{materials:prepared},freeze}),/ASAR|原生|native/i,'prepare evidence must never qualify an unverified native ASAR release');
 const worker=path.join(prepared.app,'print-worker-client.cjs'),saved=fs.readFileSync(worker);fs.unlinkSync(worker);try{assert.throws(()=>builder.auditRuntimeDependencies(prepared.app,{materialsPreparation:prepared,resourcesRoot:prepared.resources}),/缺少|缺失|不一致|清单|变化|依赖/i,'a preparation without release-entry cannot bypass missing dependency checks');}finally{fs.writeFileSync(worker,saved,{flag:'wx'});}
});
test('disguised database content and unresolved or computed module loads are rejected in source fixtures',async()=>{
 const fx=fixture(),source=path.join(fx.root,'materials/lib/review-first.mjs'),old=fs.readFileSync(source),out=()=>path.join(fx.root,'runtime','materials-build-negative-'+crypto.randomUUID());
 for(const bad of [Buffer.concat([Buffer.from('SQLite format 3\0'),Buffer.from('synthetic invalid source')]),Buffer.from("export const bad=import('./does-not-exist.mjs');"),Buffer.from("const name='./review-first.mjs'; export const bad=import(name);"),Buffer.from("export {unknown} from './does-not-exist.mjs';")]){fs.writeFileSync(source,bad);try{await assert.rejects(Promise.resolve().then(()=>fx.helper.prepareMaterialsRuntime({outputDir:out()})),/SQLite|数据库|依赖|加载|computed|模块/i);}finally{fs.writeFileSync(source,old);}}
 fs.appendFileSync(source,"\nexport function literalOnly(level='operate'){return level;}\nexport const literalExport='synthetic-package-label';\n");try{assert.ok(fx.helper.prepareMaterialsRuntime({outputDir:out()}),'ordinary exported values must never be treated as module specifiers');}finally{fs.writeFileSync(source,old);}
});
test('the default release path preserves its program allowlist and refuses unsolicited material evidence',()=>{
 const builder=require('../stage1/build-full-release.cjs');assert.equal(builder.assertMaterialsSealReady({}),true);
 assert.throws(()=>builder.assertMaterialsSealReady({preparation:{materials:{}},freeze:{}}),/显式|启用|材料/i);
 assert.throws(()=>builder.assertMaterialsSealReady({materialsRuntime:true,preparation:{},freeze:{}}),/证据|缺失|材料/i);
 assert.equal(builder.assertProgramPath('resources/print-dependencies/node_modules/sharp/dist/index.cjs'),'resources/print-dependencies/node_modules/sharp/dist/index.cjs');
 for(const name of ['resources/materials-dependencies/node_modules/sharp/index.cjs','resources/print-dependencies/node_modules/profile/library.sqlite','resources/print-dependencies/node_modules/sharp/private.key'])assert.throws(()=>builder.assertProgramPath(name),/白名单|业务|密钥|程序|资源/i);
});
test('the real seal entry stops at the material gate before any original release inputs can be used',async()=>{
 const builder=require('../stage1/build-full-release.cjs');
 // Deliberately omit all full-release evidence, work directories and keys. Only
 // the first material gate is reachable; falling through must fail this test.
 await assert.rejects(builder.sealFullRelease({programVersion:'1.7.0',materialsRuntime:true,preparation:{materials:prepared},freeze:{materials:sourceMaterialsFreeze()}}),/sharp原生ASAR尚未验证/);
});
test('native transport CJS source changes invalidate standalone proof',()=>{
 const fx=fixture(),receipt=fx.helper.prepareMaterialsRuntime({outputDir:path.join(fx.root,'runtime','materials-build-native-binding-'+crypto.randomUUID())});
 for(const name of ['materials-capability.cjs','materials-native-protocol.cjs']){
  const source=path.join(fx.root,'project/desktop',name),old=fs.readFileSync(source);fs.appendFileSync(source,'\n// synthetic native source drift\n');
  try{assert.throws(()=>fx.helper.verifyMaterialsRuntime(receipt),/源|变化|不一致|changed/i,'native transport changes must invalidate a previously prepared proof');}finally{fs.writeFileSync(source,old);}
  assert.equal(receipt.sourceHashes['project/desktop/'+name],hash(old));assert.deepEqual(fs.readFileSync(path.join(receipt.app,name)),old);
 }
});
test('review B1 authoritative saved preparation cannot hide materials through caller omission',async()=>{
 const fx=fixture(),sourceBuilder=require('../stage1/build-full-release.cjs');copy(path.join(ROOT,'stage1/build-full-release.cjs'),path.join(fx.root,'stage1/build-full-release.cjs'));copy(path.join(ROOT,'stage1/isolation.cjs'),path.join(fx.root,'stage1/isolation.cjs'));
 const material=fx.helper.prepareMaterialsRuntime({outputDir:path.join(fx.root,'runtime','materials-build-saved-'+crypto.randomUUID())}),work=path.join(fx.root,'release-work','saved-'+crypto.randomUUID());fs.mkdirSync(work,{recursive:true});
 const saved={version:1,product:'xjy-jewelry-offline',programVersion:'1.7.0',workDir:work,app:path.join(work,'app-input'),resources:path.join(work,'resources-input'),materials:material,artifacts:{app:material.artifacts.app,resources:material.artifacts.resources}};fs.writeFileSync(path.join(work,'preparation.json'),JSON.stringify(saved),{flag:'wx'});
 const caller={...saved};delete caller.materials;delete caller.artifacts;const builder=require(path.join(fx.root,'stage1/build-full-release.cjs'));
 await assert.rejects(builder.sealFullRelease({programVersion:'1.7.0',materialsRuntime:false,preparation:caller,freeze:{version:1,purpose:'xjy-full-release-1.7.0',files:{}}}),/材料|ASAR/,'the on-disk material receipt must stop the real seal entry before module/key/update-helper processing');
 const stripped={...saved};delete stripped.materials;assert.throws(()=>sourceBuilder.assertMaterialsSealReady({preparation:{},freeze:{},savedPreparation:stripped}),/材料|ASAR/,'saved artifact witnesses must also prevent flag omission');
 assert.deepEqual(fs.readdirSync(work),['preparation.json'],'rejected seal must create no release/helper output');
});
test('review B2 combined pack inputs audit the fixed shim at its intended resources app.asar placement',()=>{
 const material=prepared||prepareMaterialsRuntime({outputDir:path.join(ROOT,'runtime','materials-build-combined-proof-'+crypto.randomUUID())}),work=path.join(run,'combined-'+crypto.randomUUID()),app=path.join(work,'app-input'),resources=path.join(work,'resources-input');
 for(const item of material.artifacts.app)copy(path.join(material.app,...item.path.split('/')),path.join(app,...item.path.split('/')));
 for(const item of material.artifacts.resources)copy(path.join(material.resources,...item.path.split('/')),path.join(resources,...item.path.split('/')));
 const audit=require('../stage1/build-full-release.cjs').auditRuntimeDependencies(app,{materialsPreparation:material,resourcesRoot:resources});assert.equal(audit.materials.runtimeLayout.app,path.join(resources,'app.asar'));assert.equal(audit.materials.runtimeLayout.sharp,path.join(resources,'print-dependencies/node_modules/sharp'));
});
test('review B3 commented module specifiers are resolved rather than silently ignored',()=>{
 const fx=fixture(),source=path.join(fx.root,'materials/lib/review-first.mjs'),old=fs.readFileSync(source),out=()=>path.join(fx.root,'runtime','materials-build-comments-'+crypto.randomUUID());
 for(const text of ["import './missing-x.mjs' /*c*/;","import x from /*c*/ './missing-y.mjs';","import(/*c*/ './missing-z.mjs');"]){fs.writeFileSync(source,Buffer.concat([old,Buffer.from('\n'+text+'\n')]));try{assert.throws(()=>fx.helper.prepareMaterialsRuntime({outputDir:out()}),/缺少|不在固定|未捆绑/,'comment syntax must not hide an unknown specifier');}finally{fs.writeFileSync(source,old);}}
 fs.writeFileSync(source,Buffer.concat([old,Buffer.from("\nimport /* comment */ {searchAssets as fixtureSearch} from /* specifier */ './search.mjs';\n// import x from './not-code.mjs';\n")]));try{assert.ok(fx.helper.prepareMaterialsRuntime({outputDir:out()}),'known commented import must remain valid and comments are not dependencies');}finally{fs.writeFileSync(source,old);}
 const plainApp=path.join(run,'plain-comment-app-'+crypto.randomUUID());fs.mkdirSync(plainApp);fs.writeFileSync(path.join(plainApp,'entry.cjs'),"module.exports=require(/*comment*/'./missing.cjs');");assert.throws(()=>require('../stage1/build-full-release.cjs').auditRuntimeDependencies(plainApp),/缺少|依赖/,'the existing CJS audit also must resolve literal calls with comments');
});
test('review NB1 regex literals cannot hide real CJS dependencies',()=>{
 const app=path.join(run,'regex-comment-cjs-'+crypto.randomUUID());fs.mkdirSync(app);fs.writeFileSync(path.join(app,'entry.cjs'),"const re=/[/*]/;module.exports=require('./missing.cjs');");assert.throws(()=>require('../stage1/build-full-release.cjs').auditRuntimeDependencies(app),/缺少|依赖/);
});
test('review NB1 regex template and division boundaries preserve the ESM dependency audit',()=>{
 const fx=fixture(),source=path.join(fx.root,'materials/lib/review-first.mjs'),old=fs.readFileSync(source),out=()=>path.join(fx.root,'runtime','materials-build-ast-'+crypto.randomUUID());
 for(const text of ["const re=/[//]/;export {x} from './missing-regex.mjs';","const text=`${import(/*c*/'./missing-template.mjs')}`;","import 'node:missing-fixture-module';","export const broken = ;","const x: number=1;"]){fs.writeFileSync(source,Buffer.concat([old,Buffer.from('\n'+text+'\n')]));try{assert.throws(()=>fx.helper.prepareMaterialsRuntime({outputDir:out()}),/缺少|不在固定|未捆绑|语法|解析|模块/,'regex/template/builtin/syntax cases must remain fail-closed');}finally{fs.writeFileSync(source,old);}}
 const valid="\nconst ratio=12 / /* divide */ 3;const re=/[/*]/;const fake=/require\\('not-a-module'\\)/;const raw=`https://example.invalid/*not-comment*/`;\nimport{searchAssets as fixtureSearch}from/*c*/'./search.mjs';\nexport function fixtureBoundary(){return [ratio,re,fake,raw,fixtureSearch];}\n";fs.writeFileSync(source,Buffer.concat([old,Buffer.from(valid)]));try{assert.ok(fx.helper.prepareMaterialsRuntime({outputDir:out()}),'valid regex, template, division, and compact commented import are accepted');}finally{fs.writeFileSync(source,old);}
});
test('review NB1 build parser availability and provenance cannot be bypassed',()=>{
 const fx=fixture(),outputDir=path.join(fx.root,'runtime','materials-build-parser-missing-'+crypto.randomUUID()),open=fs.openSync,toolPackage=path.resolve('E:/珠宝销售软件/node_modules/typescript/package.json').toLowerCase();
 fs.openSync=function(file,...args){if(typeof file==='string'&&path.resolve(file).toLowerCase()===toolPackage){const error=new Error('synthetic build parser unavailable');error.code='ENOENT';throw error;}return open.call(this,file,...args);};
 try{assert.throws(()=>fx.helper.prepareMaterialsRuntime({outputDir}),/解析器|文件缺失|synthetic/);}finally{fs.openSync=open;}assert.equal(fs.existsSync(outputDir),false,'missing parser must stop before output creation');
 const receipt=fx.helper.prepareMaterialsRuntime({outputDir:path.join(fx.root,'runtime','materials-build-parser-pin-'+crypto.randomUUID())}),tampered=JSON.parse(JSON.stringify(receipt));tampered.parser.files['lib/typescript.js']='0'.repeat(64);assert.throws(()=>fx.helper.verifyMaterialsRuntime(tampered),/回执|解析器|不一致/);
});
test('review N2 invalid new preparation never publishes a success receipt and retains existing evidence',()=>{
 const fx=fixture(),source=path.join(fx.root,'materials/lib/review-first.mjs'),old=fs.readFileSync(source),outputDir=path.join(fx.root,'runtime','materials-build-preflight-'+crypto.randomUUID());fs.writeFileSync(source,Buffer.concat([old,Buffer.from('\nexport const broken = ;\n')]));
 try{assert.throws(()=>fx.helper.prepareMaterialsRuntime({outputDir}),/语法|解析/);assert.equal(fs.existsSync(path.join(outputDir,'materials-preparation.json')),false,'a normal AST rejection must not leave an apparent success receipt');assert.equal(fs.existsSync(outputDir),false,'preflightable source failures should happen before creating a new output');}finally{fs.writeFileSync(source,old);}
 const good=fx.helper.prepareMaterialsRuntime({outputDir}),receipt=path.join(outputDir,'materials-preparation.json'),asset=path.join(good.app,'assets/sales-materials/styles.css');fs.unlinkSync(receipt);fs.unlinkSync(asset);const retry=fx.helper.prepareMaterialsRuntime({outputDir});assert.deepEqual(retry,good,'matching partial program bytes may finish idempotently without deleting evidence');assert.ok(fx.helper.verifyMaterialsRuntime(retry));
});
test('review N3 default seal validates its fixed parser before any release workspace mutation',async()=>{
 const fx=fixture();copy(path.join(ROOT,'stage1/build-full-release.cjs'),path.join(fx.root,'stage1/build-full-release.cjs'));copy(path.join(ROOT,'stage1/isolation.cjs'),path.join(fx.root,'stage1/isolation.cjs'));
 const work=path.join(fx.root,'release-work','tool-first-'+crypto.randomUUID());fs.mkdirSync(work,{recursive:true});const saved={version:1,product:'xjy-jewelry-offline',programVersion:'1.7.0',workDir:work,app:path.join(work,'app-input'),resources:path.join(work,'resources-input'),artifacts:{app:[],resources:[]}};fs.writeFileSync(path.join(work,'preparation.json'),JSON.stringify(saved),{flag:'wx'});
 const open=fs.openSync,toolPackage=path.resolve('E:/珠宝销售软件/node_modules/typescript/package.json').toLowerCase();fs.openSync=function(file,...args){if(typeof file==='string'&&path.resolve(file).toLowerCase()===toolPackage){const error=new Error('synthetic parser preflight unavailable');error.code='ENOENT';throw error;}return open.call(this,file,...args);};
 try{await assert.rejects(require(path.join(fx.root,'stage1/build-full-release.cjs')).sealFullRelease({programVersion:'1.7.0',preparation:saved,freeze:{version:1,purpose:'xjy-full-release-1.7.0',files:{}}}),/解析器|synthetic parser preflight/,'missing parser must be detected before even original release-module inputs are examined');}finally{fs.openSync=open;}
 assert.deepEqual(fs.readdirSync(work),['preparation.json']);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(work,'preparation.json'),'utf8')),saved);
});

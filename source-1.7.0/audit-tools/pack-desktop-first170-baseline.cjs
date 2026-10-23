'use strict';
// Pure program packaging only. Existing public ASAR writer and packaging
// verification helpers are reused; no business entry or database is imported.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{createRequire}=require('node:module');
const ROOT=path.resolve(__dirname,'..'),base=path.join(ROOT,'release-work/desktop-first170-source-a1'),work=path.join(ROOT,'release-work/desktop-first170-work-a1'),out=path.join(ROOT,'release-work/desktop-first170-baseline-artifact-a1');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function need(v,m){if(!v)throw Error(m);}
function ordinary(file,directory=false){for(let p=file;;p=path.dirname(p)){const s=fs.lstatSync(p,{bigint:true});need(!s.isSymbolicLink()&&path.resolve(fs.realpathSync.native(p)).toLowerCase()===path.resolve(p).toLowerCase(),'Alias/link refused');need(p===file&&!directory?s.isFile()&&s.nlink===1n:s.isDirectory(),'Unexpected file type');if(path.dirname(p)===p)break;}}
function read(file){ordinary(file);const before=fs.statSync(file,{bigint:true}),fd=fs.openSync(file,'r');try{const opened=fs.fstatSync(fd,{bigint:true}),b=fs.readFileSync(fd),after=fs.fstatSync(fd,{bigint:true}),now=fs.statSync(file,{bigint:true});for(const k of ['dev','ino','nlink','size','mtimeNs','ctimeNs'])need(before[k]===opened[k]&&opened[k]===after[k]&&after[k]===now[k],'Source changed');need(BigInt(b.length)===before.size,'Read size differs');return b;}finally{fs.closeSync(fd);}}
function write(rel,bytes){const file=path.join(out,...rel.split('/'));need(path.relative(out,file)!=='..'&&!path.relative(out,file).startsWith('..'+path.sep),'Output escaped');fs.mkdirSync(path.dirname(file),{recursive:true});ordinary(path.dirname(file),true);fs.writeFileSync(file,bytes,{flag:'wx'});need(hash(read(file))===hash(bytes),'Written bytes differ');}
async function main(){
 need(ROOT.toLowerCase()==='e:\\codex\\2026-10-15\\work\\xjy-v16-deep-audit','Fixed source root required');ordinary(path.dirname(out),true);need(!fs.existsSync(out),'Fresh artifact directory required');
 const reference=read(path.join(base,'projection-manifest.json'));need(hash(reference)==='599e921e7fa04ab0624909423461584d407be1b93151f6612f583add9c9b642a','Projection proof changed');const manifest=JSON.parse(reference);
 const buildFile=path.join(ROOT,'stage1/build-full-release.cjs'),buildSha=hash(read(buildFile)),packaging=require(buildFile),app=path.join(work,'project/desktop'),sources=packaging.artifactList(app);
 const originals=new Map(manifest.outputs.filter(r=>r.path.startsWith('project/desktop/')).map(r=>[r.path.slice('project/desktop/'.length),r]));
 const changed=new Set(['release-entry.cjs','package.json','generated/release-pins.cjs']);
 need(sources.length===143&&originals.size===142,'Source file set changed');
 for(const row of sources){const original=originals.get(row.path);if(!original)need(row.path==='engine-startup-gate.cjs'&&row.sha256==='d5c9e262ecae5fc763b79d465145c62830cd8096498751db457a90f26f6fa191','Unselected new source');else if(!changed.has(row.path))need(row.sha256===original.sha256,'Unselected business change: '+row.path);}
 need(sources.find(r=>r.path==='release-entry.cjs').sha256==='d55ba705de9866f6aecb329b2fc79809d81f31c6efaa28c79380c63a200cdb0a','Untested entry');
 const pkg=JSON.parse(read(path.join(app,'package.json')));need(pkg.version==='1.7.0'&&pkg.main==='release-entry.cjs','Wrong target identity');
 const audit=packaging.auditRuntimeDependencies(app);
 const deps='E:/珠宝销售软件/desktop/node_modules',packageFile=path.join(deps,'@electron/asar/package.json'),info=JSON.parse(read(packageFile));need(info.name==='@electron/asar'&&info.version==='3.4.1'&&info.license==='MIT','Existing public packager identity changed');const asar=createRequire(path.join(deps,'__xjy_pack__.cjs'))('@electron/asar');
 fs.mkdirSync(out);const rows=manifest.outputs.filter(r=>r.path.startsWith('baseline/resources/'));need(rows.length===1007,'Original resources changed');
 const overrideNames=new Set(['resources/update-helper/bootstrap.json','resources/update-helper/updater-helper.cjs']);
 for(const row of rows){const rel=row.path.slice('baseline/'.length),source=read(path.join(base,...row.path.split('/')));need(hash(source)===row.sha256&&source.length===row.size,'Baseline resource changed');if(rel==='resources/app.asar')continue;const bytes=overrideNames.has(rel)?read(path.join(work,'resources-overrides',...rel.slice('resources/'.length).split('/'))):source;write(rel,bytes);}
 await packaging.createAsarAndWait({asar,app,archive:path.join(out,'resources/app.asar')});
 const entries=packaging.verifyAsarEntries({asar,archive:path.join(out,'resources/app.asar'),app});need(entries.length===143,'ASAR extraction coverage changed');
 const resources=packaging.artifactList(path.join(out,'resources')).map(r=>({...r,path:'resources/'+r.path}));need(resources.length===1007,'Resource count changed');need(JSON.stringify(resources.map(r=>r.path).sort())===JSON.stringify(rows.map(r=>r.path.slice('baseline/'.length)).sort()),'Resource paths changed');
 need(JSON.stringify(packaging.artifactList(app))===JSON.stringify(sources)&&hash(read(buildFile))===buildSha,'Inputs changed during packaging');
 write('artifact-manifest.json',Buffer.from(JSON.stringify({version:1,programVersion:'1.7.0',main:'release-entry.cjs',resourcesOnly:true,developmentOnly:true,releaseReady:false,originalBusinessRetained:true,financialMonthlyFixNotYetIncluded:true,productExecuted:false,productionAccessed:false,sourceProjectionSha256:hash(reference),packager:{name:info.name,version:info.version,license:info.license,buildHelperSha256:buildSha},sourceFiles:sources,dependencyAudit:audit,asarEntriesVerified:143,resources},null,2)));
 console.log(JSON.stringify({complete:true,releaseReady:false,resourceCount:resources.length,asarEntriesVerified:entries.length,manifestSha256:hash(read(path.join(out,'artifact-manifest.json'))),asarSha256:resources.find(r=>r.path==='resources/app.asar').sha256}));
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});

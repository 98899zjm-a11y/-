'use strict';
// Compile verified repo code before packaging. Does not initialize any business service.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
let deps='E:/珠宝销售软件/node_modules';
if(process.env.XJY_BUILD_DEPENDENCIES_ROOT){
 const owned=require('./isolation.cjs').createIsolationGuard(root).assertPath(path.resolve(process.env.XJY_BUILD_DEPENDENCIES_ROOT));
 if(root.toLowerCase()!=='c:\\xjy-work\\xjy-web-stage1'||owned.toLowerCase()!==path.join(root,'audit-tools/dependencies/node_modules').toLowerCase())throw Error('Compiler override is limited to the actual offline audit Guest');
 const proof=require('node:child_process').spawnSync('C:\\Python314\\python.exe',['-I','-B',path.join(root,'stage1/validate-sandbox-context.py')],{cwd:root,windowsHide:true,encoding:'utf8'});
 if(proof.status!==0)throw Error('Actual offline Sandbox compiler boundary required');
 deps=owned;
}
if(path.basename(deps).toLowerCase()!=='node_modules')throw Error('Explicit owned node_modules compiler root required');
const esbuild=require(path.join(deps,'esbuild'));
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const out=path.join(__dirname,'test-tools');
for(let p=out;p!==path.dirname(p);p=path.dirname(p))if(fs.existsSync(p)&&fs.lstatSync(p).isSymbolicLink())throw Error('Test artifact path cannot be a link');
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const modules={};
 for(const name of ['employee-update','remote-print','browser-bridge','central-print','host-maintenance-panel','employee-profile']){
  const entry=path.join(root,'project/desktop/renderer',name+(name==='browser-bridge'?'.ts':'.tsx'));
  if(!fs.existsSync(entry))throw Error('Required test source absent: '+name);
  const result=await esbuild.build({entryPoints:[entry],bundle:true,write:false,metafile:true,platform:'node',format:'cjs',target:'node24',jsx:'automatic',loader:{'.css':'empty'},alias:{'@':path.join(root,'project')},nodePaths:[deps],logLevel:'silent'});
  const file=name+'.cjs',bytes=result.outputFiles[0].contents,destination=path.join(out,file);
  if(fs.existsSync(destination)&&(fs.lstatSync(destination).isSymbolicLink()||fs.statSync(destination).nlink!==1))throw Error('Test artifact replaced by link');
  const project=path.join(root,'project'),inside=(base,file)=>{const rel=path.relative(base,file);return rel!== '..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel);};
  const inputs=Object.keys(result.metafile.inputs).map(p=>path.resolve(p));
  for(const input of inputs)if(!inside(project,input)&&!inside(deps,input))throw Error('Test compiler input escaped project and approved public dependencies');
  const sources=inputs.filter(p=>inside(project,p)&&!inside(deps,p)).sort().map(p=>({file:path.relative(root,p).replaceAll('\\','/'),sha256:sha(fs.readFileSync(p))}));
  if(!sources.some(s=>s.file===path.relative(root,entry).replaceAll('\\','/')))throw Error('Entry missing from provenance');
  fs.writeFileSync(destination,bytes);modules[name]={file,sha256:sha(bytes),sources};
 }
 const manifest=path.join(out,'manifest.json');
 if(fs.existsSync(manifest)&&(fs.lstatSync(manifest).isSymbolicLink()||fs.statSync(manifest).nlink!==1))throw Error('Test manifest replaced by link');
 fs.writeFileSync(manifest,JSON.stringify({version:1,purpose:'data-free-renderer-test-code',modules},null,2));
 process.stdout.write(JSON.stringify({modules:Object.keys(modules),sourceVerified:true,dataIncluded:false,output:out})+'\n');
})().catch(error=>{process.stderr.write(error.stack+'\n');process.exitCode=1;});

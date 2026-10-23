'use strict';
// Development-only compiler: no runtime, migrations or shared dependency writes.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const guard=require('./isolation.cjs').createIsolationGuard(root);
const project=guard.assertPath(path.join(root,'project'));
const deps='E:\\珠宝销售软件\\node_modules';
const depsReal=fs.realpathSync.native(deps);
function allowedInput(name){
 if(name.startsWith('offline-platform:'))return;
 const file=path.resolve(project,name);
 if(file.startsWith(project+path.sep)){guard.assertPath(file);return;}
 const real=fs.realpathSync.native(file);
 if(real.toLowerCase().startsWith(depsReal.toLowerCase()+path.sep))return;
 throw new Error('Unexpected compiler input: '+name);
}
(async()=>{
 const esbuild=require(path.join(deps,'esbuild'));
 const output=guard.assertPath(path.join(project,'desktop','generated','business.cjs'));
 const result=await esbuild.build({absWorkingDir:project,entryPoints:[guard.assertPath(path.join(project,'lib','server.ts'))],outfile:output,bundle:true,platform:'node',format:'cjs',target:'node22',logLevel:'warning',tsconfig:guard.assertPath(path.join(project,'tsconfig.json')),nodePaths:[deps],write:false,metafile:true,plugins:[{
  name:'offline-platform',setup(build){
   build.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'offline-platform'}));
   build.onResolve({filter:/^@\/app\/chatgpt-auth$/},()=>({path:guard.assertPath(path.join(project,'lib/platform/desktop-identity.ts'))}));
   build.onLoad({filter:/^env$/,namespace:'offline-platform'},()=>({contents:'export const env = new Proxy({}, {get(_target,key){return globalThis.__xjyDesktopContext().env[key]}});',loader:'js'}));
   build.onLoad({filter:/[\\/]lib[\\/]server\.ts$/},args=>({contents:fs.readFileSync(guard.assertPath(args.path),'utf8').replace('请先使用ChatGPT账号登录','请先登录本机账号').replace('数据库尚未连接，请完成部署配置','本机数据库尚未打开').replace('图片存储尚未连接，请完成部署配置','本机图片目录尚未打开'),loader:'ts',resolveDir:path.dirname(args.path)}));
  }
 }]});
 for(const name of Object.keys(result.metafile.inputs))allowedInput(name);
 if(result.outputFiles.length!==1||result.outputFiles[0].path!==output)throw new Error('Unexpected compiler output');
 fs.writeFileSync(guard.assertPath(output),result.outputFiles[0].contents);
 const evidence={at:new Date().toISOString(),esbuild:esbuild.version,sourceBaseline:'copied-v1.5.0',output:path.relative(root,output),sha256:crypto.createHash('sha256').update(result.outputFiles[0].contents).digest('hex'),inputs:Object.keys(result.metafile.inputs),migrationsApplied:false,sharedDependenciesModified:false};
 fs.writeFileSync(guard.assertPath(path.join(root,'reports','business-build.json')),JSON.stringify(evidence,null,2));
 process.stdout.write('Isolated business core compiled; no migrations applied.\n');
})().catch(e=>{console.error(e);process.exitCode=1;});

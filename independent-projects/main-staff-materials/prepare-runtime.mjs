import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root='D:/Codex/xjy-main-staff-session-20261023';
const candidate=path.join(root,'candidate');
const staff='D:/Codex/xjy-sales-materials-staff-20261023';
const checkout='D:/Codex/xjy-sales-materials-publish-20261023';
const archive=path.join(checkout,'source-1.7.0');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const records=[];
const runtime=JSON.parse(await fs.readFile(path.join(staff,'evidence','runtime-manifest.json'),'utf8'));
for(const item of runtime.installedFiles){
 if(!item.file.startsWith('node_modules/')||item.file.includes('..'))throw Error('Invalid dependency file');
 const source=path.join(staff,item.file),target=path.join(candidate,'materials',item.file),st=await fs.lstat(source);
 if(!st.isFile()||st.isSymbolicLink())throw Error('Dependency must be a regular file');const bytes=await fs.readFile(source);
 if(bytes.length!==item.bytes||hash(bytes)!==item.sha256)throw Error('Installed dependency changed: '+item.file);
 await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,bytes,{flag:'wx'});if(hash(await fs.readFile(target))!==item.sha256)throw Error('Dependency copy mismatch');records.push({...item,target});
}
const stageFiles=execFileSync('git',['ls-files','-z','source-1.7.0/stage1/'],{cwd:checkout,maxBuffer:4*1024*1024}).toString('utf8').split('\0').filter(file=>file.endsWith('.cjs')&&!file.endsWith('/web-gateway.cjs'));
for(const file of stageFiles){const relative=path.relative(archive,path.join(checkout,file)),source=path.join(archive,relative),target=path.join(candidate,relative);const st=await fs.lstat(source);if(!st.isFile()||st.isSymbolicLink())throw Error('Stage source must be regular');const bytes=await fs.readFile(source);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,bytes,{flag:'wx'});records.push({file:relative,sha256:hash(bytes),bytes:bytes.length,target});}
const sourceProject=path.join(archive,'project'),outfile=path.join(candidate,'project','desktop','generated','business.cjs');
const require=createRequire(import.meta.url),esbuild=require('E:/珠宝销售软件/node_modules/esbuild');
const result=await esbuild.build({entryPoints:[path.join(sourceProject,'lib','server.ts')],outfile,bundle:true,write:false,metafile:true,platform:'node',format:'cjs',target:'node22',logLevel:'warning',tsconfig:path.join(sourceProject,'tsconfig.json'),nodePaths:['E:/珠宝销售软件/node_modules'],plugins:[{name:'existing-offline-platform',setup(build){
 build.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'offline-platform'}));
 build.onResolve({filter:/^@\/app\/chatgpt-auth$/},()=>({path:path.join(sourceProject,'lib','platform','desktop-identity.ts')}));
 build.onLoad({filter:/^env$/,namespace:'offline-platform'},()=>({contents:'export const env = new Proxy({}, {get(_target,key){return globalThis.__xjyDesktopContext().env[key]}});',loader:'js'}));
 build.onLoad({filter:/[\\/]lib[\\/]server\.ts$/},async args=>({contents:(await fs.readFile(args.path,'utf8')).replace('请先使用ChatGPT账号登录','请先登录本机账号').replace('数据库尚未连接，请完成部署配置','本机数据库尚未打开').replace('图片存储尚未连接，请完成部署配置','本机图片目录尚未打开'),loader:'ts',resolveDir:path.dirname(args.path)}));
}}]});
if(result.outputFiles.length!==1||path.resolve(result.outputFiles[0].path)!==path.resolve(outfile))throw Error('Unexpected business compiler output');
const inputs=[];
for(const name of Object.keys(result.metafile.inputs)){if(name.startsWith('offline-platform:'))continue;const file=path.resolve(name),bytes=await fs.readFile(file);if(!file.startsWith(path.resolve(sourceProject)+path.sep)&&!file.startsWith(path.resolve('E:/珠宝销售软件/node_modules')+path.sep))throw Error('Unexpected build input: '+file);if(file.startsWith(path.resolve(sourceProject)+path.sep)){const relative=path.relative(checkout,file).replaceAll('\\','/'),committed=execFileSync('git',['show','87da677:'+relative],{cwd:checkout,maxBuffer:4*1024*1024});if(!bytes.equals(committed))throw Error('Archive input differs from checked commit: '+relative);}inputs.push({file,sha256:hash(bytes),bytes:bytes.length});}
await fs.mkdir(path.dirname(outfile),{recursive:true});await fs.writeFile(outfile,result.outputFiles[0].contents,{flag:'wx'});
const report={at:new Date().toISOString(),scope:'D-only existing dependency byte copy and checked source build; no runtime or production service started',dependencies:records,inputs,output:{file:outfile,sha256:hash(result.outputFiles[0].contents),bytes:result.outputFiles[0].contents.length}};
await fs.writeFile(path.join(root,'evidence','runtime-build.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({dependencyFiles:runtime.installedFiles.length,stageSourceFiles:stageFiles.length,businessInputs:inputs.length,output:report.output}));

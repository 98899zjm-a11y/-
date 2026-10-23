'use strict';
// Build a portable gateway from the reviewed stage source, without loading it.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),guard=require('./isolation.cjs').createIsolationGuard(root);
let dependencies='E:/珠宝销售软件/node_modules';
if(process.env.XJY_BUILD_DEPENDENCIES_ROOT){
 const owned=guard.assertPath(path.resolve(process.env.XJY_BUILD_DEPENDENCIES_ROOT));
 if(root.toLowerCase()!=='c:\\xjy-work\\xjy-web-stage1'||owned.toLowerCase()!==path.join(root,'audit-tools/dependencies/node_modules').toLowerCase())throw Error('Gateway compiler override is limited to the actual offline audit Guest');
 const proof=require('node:child_process').spawnSync('C:\\Python314\\python.exe',['-I','-B',path.join(root,'stage1/validate-sandbox-context.py')],{cwd:root,windowsHide:true,encoding:'utf8'});
 if(proof.status!==0)throw Error('Actual offline Sandbox gateway compiler boundary required');
 dependencies=owned;
}
const esbuild=require(path.join(dependencies,'esbuild'));
const entry=guard.assertPath(path.join(root,'stage1','web-gateway.cjs')),output=guard.assertPath(path.join(root,'project','desktop','web-runtime','web-gateway.cjs'));
(async()=>{
 const result=await esbuild.build({entryPoints:[entry],outfile:output,bundle:true,write:false,metafile:true,platform:'node',format:'cjs',target:'node22',logLevel:'warning',plugins:[{name:'private-release-log-layout',setup(build){build.onLoad({filter:/[\\/]stage1[\\/]web-gateway\.cjs$/},args=>{
  let contents=fs.readFileSync(guard.assertPath(args.path),'utf8');
  const original='browserDefault=false,allowLocalControls})';if(!contents.includes(original))throw Error('Gateway declaration changed; release adaptation needs review');
  contents=contents.replace(original,"browserDefault=false,allowLocalControls,logDir=path.join(root,'logs'),applicationMode='isolated-local'})");
  contents=contents.replace("mode:'isolated-local'","mode:applicationMode");
  contents=contents.replace("path.join(root,'logs','gateway-errors.log')","path.join(logDir,'gateway-errors.log')");
  return{contents,loader:'js',resolveDir:path.dirname(args.path)};
 });}}]});
 for(const source of Object.keys(result.metafile.inputs))guard.assertPath(path.resolve(source));
 if(result.outputFiles.length!==1||result.outputFiles[0].path!==output)throw Error('Unexpected gateway compiler output');
 fs.mkdirSync(guard.assertPath(path.dirname(output)),{recursive:true});if(fs.existsSync(output)&&(fs.lstatSync(output).isSymbolicLink()||fs.lstatSync(output).nlink!==1))throw Error('Gateway artifact alias refused');
 fs.writeFileSync(output,result.outputFiles[0].contents);
 const report={version:1,sourceSha256:crypto.createHash('sha256').update(fs.readFileSync(entry)).digest('hex'),output:path.relative(root,output).replaceAll('\\','/'),sha256:crypto.createHash('sha256').update(result.outputFiles[0].contents).digest('hex'),inputs:Object.keys(result.metafile.inputs),adaptation:['trusted logDir','health mode label'],serviceStarted:false,dataIncluded:false};
 fs.writeFileSync(guard.assertPath(path.join(root,'reports','web-runtime-build.json')),JSON.stringify(report,null,2));process.stdout.write(JSON.stringify({output:report.output,serviceStarted:false,sha256:report.sha256})+'\n');
})().catch(error=>{process.stderr.write(error.stack+'\n');process.exitCode=1;});

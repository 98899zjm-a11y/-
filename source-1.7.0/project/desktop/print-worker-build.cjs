'use strict';
const path=require('node:path');const fs=require('node:fs');
async function buildPrintWorker({dependenciesRoot=path.resolve(__dirname,'../node_modules')}={}){
  if(!path.isAbsolute(dependenciesRoot))throw TypeError('Absolute build dependency root required');
  const esbuild=require(path.join(dependenciesRoot,'esbuild')),root=path.resolve(__dirname,'..');fs.mkdirSync(path.join(__dirname,'generated'),{recursive:true});
  const plugins=[{name:'worker-fixed-assets',setup(build){build.onResolve({filter:/\?worker-(?:inline|image)$/},args=>({path:path.resolve(args.resolveDir,args.path.split('?')[0]),namespace:args.path.endsWith('?worker-image')?'worker-image':'worker-inline'}));build.onLoad({filter:/.*/,namespace:'worker-inline'},args=>({contents:'export default '+JSON.stringify(fs.readFileSync(args.path,'utf8')),loader:'js'}));build.onLoad({filter:/.*/,namespace:'worker-image'},args=>({contents:'export default '+JSON.stringify('data:image/jpeg;base64,'+fs.readFileSync(args.path).toString('base64')),loader:'js'}));build.onLoad({filter:/\.css$/},()=>({contents:'',loader:'js'}));}}];
  await esbuild.build({entryPoints:[path.join(__dirname,'renderer/print-worker-templates.tsx')],outfile:path.join(__dirname,'generated/print-worker-templates.cjs'),bundle:true,platform:'node',format:'cjs',target:'node22',jsx:'automatic',alias:{'@':root},nodePaths:[dependenciesRoot],plugins,logLevel:'warning'});
  await esbuild.build({entryPoints:[path.join(__dirname,'print-worker-preload.cjs')],outfile:path.join(__dirname,'generated/print-worker-preload.cjs'),bundle:true,platform:'node',format:'cjs',target:'node22',external:['electron'],logLevel:'warning'});
}
if(require.main===module)buildPrintWorker({dependenciesRoot:process.argv[2]?path.resolve(process.argv[2]):undefined}).catch(e=>{console.error(e);process.exitCode=1;});
module.exports={buildPrintWorker};

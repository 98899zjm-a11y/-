'use strict';
// Compile real source with the existing release compiler, without sealing,
// signing, installing, starting a product service or loading business exports.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..');
const attempt=process.argv[2]||'initial';
if(!/^[a-z][a-z0-9-]{0,50}$/.test(attempt))throw Error('Bounded build evidence name required');
if(cp.spawnSync('C:\\Python314\\python.exe',['-I','-B',path.join(root,'stage1/validate-sandbox-context.py')],{cwd:root,windowsHide:true}).status!==0)throw Error('Actual offline Guest required');
const guard=require('../stage1/isolation.cjs').createIsolationGuard(root),deps=guard.assertPath(path.join(__dirname,'dependencies/node_modules'));
(async()=>{
 const parent=guard.assertPath(path.join(root,'release-work'));fs.mkdirSync(parent,{recursive:true});
 const work=fs.mkdtempSync(path.join(parent,'audit-code-'));guard.assertPath(work);
 const result=await require('../stage1/build-full-release.cjs').compileAssets({workDir:work,dependenciesRoot:deps});
 const tests=cp.spawnSync(process.execPath,[path.join(root,'stage1/build-ui-tests.cjs')],{cwd:root,env:{...process.env,XJY_BUILD_DEPENDENCIES_ROOT:deps},stdio:'inherit',windowsHide:true});
 if(tests.status!==0)throw Error('Fresh renderer test-tool compilation failed');
 const generated=guard.assertPath(path.join(root,'project/desktop/generated'));fs.mkdirSync(generated,{recursive:true});
 const outputs=[];
 for(const name of ['business.cjs','print-domain.cjs','print-worker-templates.cjs','print-worker-preload.cjs']){
  const bytes=fs.readFileSync(guard.assertPath(path.join(result.app,'generated',name))),dest=guard.assertPath(path.join(generated,name));fs.writeFileSync(dest,bytes);outputs.push({file:'project/desktop/generated/'+name,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
 }
 const report={...result,generated:outputs,unsealed:true,installed:false,serviceStarted:false,dataIncluded:false};
 fs.writeFileSync('C:\\xjy-results\\current-code-build-'+attempt+'.json',JSON.stringify(report,null,2),{flag:'wx'});
 console.log(JSON.stringify({app:result.app,generated:outputs,sourceFiles:Object.keys(result.sourceHashes).length,unsealed:true}));
})().catch(error=>{console.error(error);process.exitCode=1;});

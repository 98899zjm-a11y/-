'use strict';
// Called only by the actual-context-admitted Python Guest runner.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..');
const proof=cp.spawnSync('C:\\Python314\\python.exe',['-I','-B',path.join(root,'stage1/validate-sandbox-context.py')],{cwd:root,encoding:'utf8',windowsHide:true});
if(proof.status!==0)throw Error('Actual offline Sandbox admission required');
const {dependenciesRoot}=require('../tests/renderer-build-tool-loader.cjs').loadRendererBuildTool();
const target=path.join(__dirname,'dependencies/node_modules');
fs.mkdirSync(target,{recursive:true});
for(const row of fs.readdirSync(dependenciesRoot,{withFileTypes:true})){
  const destination=path.join(target,row.name);
  if(fs.existsSync(destination))throw Error('Existing compiler package refused');
  fs.cpSync(path.join(dependenciesRoot,row.name),destination,{recursive:true,errorOnExist:true,force:false});
}
console.log(JSON.stringify({actualGuest:true,publicDependenciesOnly:true,dependenciesRoot:target}));

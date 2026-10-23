import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
export const integrationRoot=path.dirname(fileURLToPath(import.meta.url));
export function validateRegistry(value){
  const expected={schemaVersion:1,moduleId:'sales-materials-local-candidate',entry:'entry.mjs',launcher:'Start-SalesMaterials.ps1',host:'127.0.0.1',port:21963,url:'http://127.0.0.1:21963',sourceModule:'D:/Codex/xjy-sales-materials-20261023/server.mjs',dataRoot:'D:/Codex/xjy-sales-materials-20261023/runtime/data',nodeRuntime:'D:/Codex/xjy-agent-sales-media/openclaw-isolated/runtime/node-v24.22.1-win-x64/node.exe',permissionBoundary:'local-candidate',inheritsProductionEmployeePermissions:false,productionRegistered:false,sourceMode:'independent-module-reference'};
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid module registry');
  for(const [key,wanted] of Object.entries(expected))if(value[key]!==wanted)throw Error(`Module registry boundary mismatch: ${key}`);
  if(Object.keys(value).some(k=>!Object.hasOwn(expected,k)&&k!=='label'))throw Error('Unknown module registry field');
  return Object.freeze({...value});
}
export async function readRegistry(){return validateRegistry(JSON.parse((await fs.readFile(path.join(integrationRoot,'registry.json'),'utf8')).replace(/^\uFEFF/,'')));}
export async function startCandidate({registry,loadModule=url=>import(url)}={}){
  const config=validateRegistry(registry??await readRegistry());
  const {createApplication}=await loadModule(pathToFileURL(config.sourceModule).href);
  if(typeof createApplication!=='function')throw Error('Candidate does not export createApplication');
  const app=await createApplication({dataRoot:config.dataRoot,port:config.port});
  if(app.origin!==config.url){await app.close();throw Error('Candidate origin differs from loopback registry');}
  return app;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  if(process.argv.length!==2)throw Error('This candidate accepts no address, port or data-directory overrides.');
  const manifest=path.join(integrationRoot,'source-manifest.json');
  let hasManifest=true;try{await fs.access(manifest);}catch(error){if(error.code!=='ENOENT')throw error;hasManifest=false;}
  if(hasManifest){const {verifyManifest}=await import('./freeze-manifest.mjs');await verifyManifest(manifest);}else console.log('Source manifest not frozen yet; local candidate only.');
  const app=await startCandidate();
  console.log(`Sales materials candidate entry ready: ${app.origin}; permission boundary: local-candidate`);
  let closing=false;async function stop(){if(closing)return;closing=true;await app.close();process.exitCode=0;}
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
}

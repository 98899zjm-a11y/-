import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {verifyManifest} from './source-freeze.mjs';
export const integrationRoot=path.dirname(fileURLToPath(import.meta.url));
const fixed={schemaVersion:1,moduleId:'sales-materials-staff-candidate',entry:'entry.mjs',launcher:'Start-StaffMaterials.ps1',sourceModule:'D:/Codex/xjy-sales-materials-staff-20261023/server.mjs',dataRoot:'D:/Codex/xjy-sales-materials-staff-20261023/runtime/data',host:'127.0.0.1',port:21964,url:'http://127.0.0.1:21964',model:'qwen3-vl:4b-instruct',authenticationRequired:true,permissionBoundary:'real-auth-code-synthetic-accounts',productionConnected:false,productionEmployeePermissionsInherited:false,nodeRuntime:'D:/Codex/xjy-agent-sales-media/openclaw-isolated/runtime/node-v24.22.1-win-x64/node.exe'};
export function validateRegistry(value){if(!value||typeof value!=='object'||Array.isArray(value))throw TypeError('Invalid module registry');for(const [key,wanted]of Object.entries(fixed))if(value[key]!==wanted)throw Error('Registry boundary mismatch: '+key);if(Object.keys(value).some(key=>key!=='label'&&!Object.hasOwn(fixed,key)))throw Error('Unknown registry field');return Object.freeze({...value});}
export async function readRegistry(){return validateRegistry(JSON.parse((await fs.readFile(path.join(integrationRoot,'registry.json'),'utf8')).replace(/^\uFEFF/,'')));}
export function healthMatches(value){return value?.ok===true&&value?.candidate===true&&value?.authenticationRequired===true&&value?.model===fixed.model;}
export async function startCandidate({registry,loadModule=url=>import(url),verifySource=verifyManifest}={}){
 const config=validateRegistry(registry??await readRegistry());await verifySource();
 const module=await loadModule(pathToFileURL(config.sourceModule).href);
 if(module.SERVICE_MODEL!==config.model||typeof module.loadCandidateAccounts!=='function'||typeof module.createApplication!=='function')throw Error('Staff candidate module interface/model mismatch');
 const accounts=await module.loadCandidateAccounts();
 if(!Array.isArray(accounts))throw Error('Candidate account loader did not return accounts');
 const app=await module.createApplication({dataRoot:config.dataRoot,port:config.port,accounts});
 if(app.origin!==config.url){await app.close();throw Error('Candidate origin mismatch');}
 return app;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 if(process.argv.length!==2)throw Error('Address, port, account and data-directory overrides are not accepted');
 const app=await startCandidate();console.log('Staff materials candidate ready: '+app.origin+'; synthetic accounts, production disconnected');
 let stopping=false;const stop=async()=>{if(stopping)return;stopping=true;await app.close();process.exitCode=0;};process.on('SIGINT',stop);process.on('SIGTERM',stop);
}

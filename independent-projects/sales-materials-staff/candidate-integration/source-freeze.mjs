import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
export const sourceRoot='D:/Codex/xjy-sales-materials-staff-20261023';
const integrationFiles=['registry.json','inventory-reader-registry.json','entry.mjs','Start-StaffMaterials.ps1','source-freeze.mjs'];
const sourceFiles=[
 'server.mjs','lib/classifier.mjs','lib/library.mjs','lib/search.mjs','lib/review-first.mjs',
 'public/index.html','public/app.js','public/styles.css','vendor/intake-state/intake-state.mjs',
 'auth/candidate-authority-host.mjs','auth/lib/access-adapter.mjs',
 'auth/vendor/desktop/local-auth.cjs','auth/vendor/desktop/administration.cjs','auth/vendor/desktop/erp-policy.cjs','auth/vendor/desktop/cashier-policy.cjs',
 'auth/vendor/desktop/migrations/0004_module_administration.sql','auth/vendor/desktop/migrations/0005_workspace_collaboration.sql','auth/vendor/desktop/migrations/0012_cashier_module_permissions.sql',
 'package.json','package-lock.json','Start-Candidate.ps1','打开素材候选.cmd',
 'scripts/prepare-auth-review.mjs','scripts/prepare-auth-recheck.mjs','scripts/pull-instruct.mjs',
 'evaluation/compare-final.mjs','evaluation/run-instruct.mjs','evaluation/run-prompt-v2.mjs','evaluation/run-prompt-v3.mjs','evaluation/run-prompt-v4.mjs','evaluation/single-diagnostic.mjs','evaluation/single-simplified-diagnostic.mjs'
];
export const allowedFiles=Object.freeze([...integrationFiles.map(f=>path.join(root,f)),...sourceFiles.map(f=>path.join(sourceRoot,f))]);
const normal=file=>path.resolve(file).replaceAll('\\','/');
async function readSource(file){const info=await fs.lstat(file);if(!info.isFile()||info.isSymbolicLink())throw Error('Source must be a regular file: '+file);return fs.readFile(file);}
async function digest(file){return createHash('sha256').update(await readSource(file)).digest('hex');}
// Bounded static-source check; no execution, filesystem traversal or runtime reads.
export async function verifyLocalDependencyGraph({files=allowedFiles}={}){
 const allowed=new Set(files.map(normal)),seen=new Set();
 async function visit(file){const key=normal(file);if(seen.has(key))return;seen.add(key);if(!allowed.has(key))throw Error('Runtime source missing from allowlist: '+key);
  if(!/\.(mjs|cjs|js)$/.test(key))return;const content=(await readSource(file)).toString('utf8');
  const refs=[...content.matchAll(/\b(?:import|export)\s+(?:[^'";]*?\s+from\s*)?['"](\.[^'"]+)['"]/g),...content.matchAll(/\b(?:import|require)\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g),...content.matchAll(/\bnew URL\(\s*['"](\.[^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g)];
  for(const match of refs)await visit(path.resolve(path.dirname(file),match[1]));
  for(const match of content.matchAll(/path\.join\(\s*__dirname\s*,\s*['"]migrations['"]\s*,\s*['"]([^'"]+\.sql)['"]\s*\)/g))await visit(path.resolve(path.dirname(file),'migrations',match[1]));
 }
 await visit(path.join(sourceRoot,'server.mjs'));
 for(const f of ['public/index.html','public/app.js','public/styles.css','package.json','package-lock.json'])if(!allowed.has(normal(path.join(sourceRoot,f))))throw Error('Required client/package file missing: '+f);
 return {checkedLocalFiles:seen.size};
}
export async function buildManifest(){await verifyLocalDependencyGraph();return {schemaVersion:1,scope:'staff-candidate-source-only',createdAt:new Date().toISOString(),files:await Promise.all(allowedFiles.map(async file=>({path:normal(file),sha256:await digest(file)})))};}
export async function verifyManifest(file=path.join(root,'source-manifest.json')){
 const manifest=JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,''));
 if(manifest.schemaVersion!==1||manifest.scope!=='staff-candidate-source-only'||!Array.isArray(manifest.files)||manifest.files.length!==allowedFiles.length)throw Error('Source manifest shape mismatch');
 const entries=new Map();for(const e of manifest.files){if(!e||typeof e.path!=='string'||!/^[a-f0-9]{64}$/.test(e.sha256)||entries.has(e.path))throw Error('Invalid source manifest entry');entries.set(e.path,e.sha256);}
 for(const file of allowedFiles)if(entries.get(normal(file))!==await digest(file))throw Error('Source changed or unlisted: '+normal(file));
 await verifyLocalDependencyGraph();return {ok:true,files:allowedFiles.length};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const args=process.argv.slice(2);if(args.length!==1||!['--write','--verify'].includes(args[0]))throw Error('Usage: node source-freeze.mjs --write|--verify');
 if(args[0]==='--write'){const manifest=await buildManifest();await fs.writeFile(path.join(root,'source-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});console.log('Created allowlisted source manifest: '+manifest.files.length+' files; runtime data excluded.');}
 else console.log(JSON.stringify(await verifyManifest()));
}

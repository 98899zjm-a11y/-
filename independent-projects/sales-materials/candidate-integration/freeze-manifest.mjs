import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const source='D:/Codex/xjy-sales-materials-20261023';
export const allowedFiles=Object.freeze([
  ...['registry.json','entry.mjs','Start-SalesMaterials.ps1','freeze-manifest.mjs'].map(file=>path.join(root,file)),
  ...['server.mjs','lib/classifier.mjs','lib/library.mjs','lib/search.mjs','vendor/intake-state/intake-state.mjs','public/index.html','public/app.js','public/styles.css','package.json','package-lock.json'].map(file=>path.join(source,file))
]);
async function digest(file){return createHash('sha256').update(await fs.readFile(file)).digest('hex');}
export async function buildManifest(){return {schemaVersion:1,scope:'reviewed-source-only-no-runtime-no-images-no-secrets',createdAt:new Date().toISOString(),files:await Promise.all(allowedFiles.map(async file=>({path:file.replaceAll('\\','/'),sha256:await digest(file)})))};}
export async function verifyManifest(file=path.join(root,'source-manifest.json')){
  const manifest=JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,''));
  if(manifest.schemaVersion!==1||!Array.isArray(manifest.files)||manifest.files.length!==allowedFiles.length)throw Error('Manifest shape mismatch');
  const entries=new Map();
  for(const entry of manifest.files){if(!entry||typeof entry.path!=='string'||!/^[a-f0-9]{64}$/.test(entry.sha256)||entries.has(entry.path))throw Error('Invalid manifest entry');entries.set(entry.path,entry.sha256);}
  for(const target of allowedFiles){const key=target.replaceAll('\\','/');if(entries.get(key)!==await digest(target))throw Error('Source changed or not listed: '+key);}
  return {ok:true,files:allowedFiles.length};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const args=process.argv.slice(2);
  if(args.length!==1||!['--write','--verify'].includes(args[0]))throw Error('Usage: node freeze-manifest.mjs --write|--verify');
  if(args[0]==='--write'){
    const manifest=await buildManifest();
    await fs.writeFile(path.join(root,'source-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
    console.log('Source manifest created; '+manifest.files.length+' allowlisted source files. No runtime data included.');
  }else console.log(JSON.stringify(await verifyManifest()));
}

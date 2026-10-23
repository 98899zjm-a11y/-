import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import sharp from 'sharp';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
async function digest(file){const h=createHash('sha256');for await(const chunk of createReadStream(file))h.update(chunk);return h.digest('hex');}
const db=new DatabaseSync(':memory:');const sqliteVersion=db.prepare('select sqlite_version() as version').get().version;db.close();
const files=[];async function walk(dir){for(const entry of await fs.readdir(dir,{withFileTypes:true})){const target=path.join(dir,entry.name);if(entry.isSymbolicLink())throw Error('Runtime dependency link is not accepted');if(entry.isDirectory())await walk(target);else if(entry.isFile())files.push({file:path.relative(root,target).replaceAll('\\','/'),sha256:await digest(target),bytes:(await fs.stat(target)).size});}}
await walk(path.join(root,'node_modules'));
const nodeStat=await fs.stat(process.execPath);
const manifest={at:new Date().toISOString(),scope:'observed installed D drive runtime and dependencies; source manifest is a separate gate, not an installer signature',node:{path:process.execPath,version:process.version,sha256:await digest(process.execPath),bytes:nodeStat.size},sqliteVersion,sharp:sharp.versions,lockfileSha256:await digest(path.join(root,'package-lock.json')),installedFiles:files};
await fs.writeFile(path.join(root,'evidence','runtime-manifest.json'),JSON.stringify(manifest,null,2));
console.log(JSON.stringify({node:manifest.node,sqliteVersion,sharp:sharp.versions.sharp,dependencyFiles:files.length,lockfileSha256:manifest.lockfileSha256}));

import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root='D:/Codex/xjy-main-staff-session-20261023';
const checkout='D:/Codex/xjy-sales-materials-publish-20261023';
const archive=path.join(checkout,'source-1.7.0');
const candidate=path.join(root,'candidate');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const tracked=execFileSync('git',['ls-files','-z','source-1.7.0/project/desktop/','source-1.7.0/project/drizzle/'],{cwd:checkout,maxBuffer:4*1024*1024}).toString('utf8').split('\0').filter(Boolean);
const selected=tracked.filter(file=>/\.(?:cjs|sql)$/.test(file)&&!file.includes('/legacy-source/'));
for(const file of ['stage1/web-gateway.cjs','stage1/web/index.html','stage1/web/app.js','stage1/web/style.css','project/desktop/package.json'])selected.push('source-1.7.0/'+file);
const rows=[];
async function copy(source,target){const st=await fs.lstat(source);if(!st.isFile()||st.isSymbolicLink())throw Error('Source is not regular');const bytes=await fs.readFile(source);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,bytes,{flag:'wx'});if(hash(await fs.readFile(target))!==hash(bytes)||hash(await fs.readFile(source))!==hash(bytes))throw Error('Source drift or copy mismatch');rows.push({source,target,sha256:hash(bytes),bytes:bytes.length});}
for(const file of selected){const relative=path.relative(archive,path.join(checkout,file));if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('Unexpected source');await copy(path.join(archive,relative),path.join(candidate,relative));}
const staff='D:/Codex/xjy-sales-materials-staff-20261023';
const exported=JSON.parse(await fs.readFile(path.join(staff,'evidence','stage-source-manifest.json'),'utf8'));
for(const record of exported.files){if(record.generated||!record.source.startsWith(staff+'/'))continue;const relative=path.relative(staff,record.source).replaceAll('\\','/');if(!/^(?:server\.mjs|package(?:-lock)?\.json|\.git(?:ignore|attributes)|(?:lib|public|auth|vendor|tests)\/)/.test(relative))continue;const bytes=await fs.readFile(record.source);if(hash(bytes)!==record.sha256)throw Error('Staff source drift: '+relative);await copy(record.source,path.join(candidate,'materials',relative));}
await fs.mkdir(path.join(root,'evidence'),{recursive:true});
await fs.mkdir(path.join(candidate,'logs'),{recursive:true});
await fs.mkdir(path.join(candidate,'runtime','tmp'),{recursive:true});
const result={at:new Date().toISOString(),baseline:'a970073 source-1.7.0 plus 87da677 staff source; no production data',scope:'checked source only; no credentials DB images model or dependencies copied',files:rows};await fs.writeFile(path.join(root,'evidence','source-baseline.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({files:rows.length,bytes:rows.reduce((sum,row)=>sum+row.bytes,0),candidate}));

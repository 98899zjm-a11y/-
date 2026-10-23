'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const source='E:/codex/2026-10-11/work/jewelry-collaboration-v150',root=path.resolve(__dirname,'..'),target=path.join(root,'project');
if(fs.existsSync(target))throw new Error('Preserve existing project; source copy is one-time');
const include=['lib','db','drizzle','components','hooks','public','vendor','desktop'];
const files=['package.json','package-lock.json','tsconfig.json','postcss.config.mjs','components.json'];
const ignored=new Set(['node_modules','.git','.next','.openai','.sites-runtime','.wrangler','tests','test','__pycache__','patch-stage-work','patch-build','.legacy-build','renderer-dist','release','signing','outputs']);
const excluded=[];const manifest=[];const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function visit(relative){const from=path.join(source,relative),to=path.join(target,relative),stat=fs.lstatSync(from);
 if(stat.isSymbolicLink()||relative.split(path.sep).some(part=>ignored.has(part)||part.startsWith('.'))){excluded.push(relative);return;}
 if(stat.isDirectory()){fs.mkdirSync(to,{recursive:true});for(const entry of fs.readdirSync(from))visit(path.join(relative,entry));return;}
 if(!stat.isFile()||stat.nlink>1){excluded.push(relative);return;}
 if(/\.(?:sqlite(?:-wal|-shm|-journal)?|db(?:-wal|-shm|-journal)?|xls[xmb]?|csv|p12|pfx|key|pem|env|log|zip|asar|exe)$/i.test(relative)||/prepare_sources\.py$|remembered-login|workspace-connection|signing\.local|local\.properties/i.test(relative)){excluded.push(relative);return;}
 const bytes=fs.readFileSync(from);fs.mkdirSync(path.dirname(to),{recursive:true});fs.writeFileSync(to,bytes,{flag:'wx'});manifest.push({path:relative.replaceAll('\\','/'),bytes:bytes.length,sha256:digest(bytes)});
}
fs.mkdirSync(target);for(const name of [...include,...files])if(fs.existsSync(path.join(source,name)))visit(name);
fs.writeFileSync(path.join(root,'reports','source-copy-manifest.json'),JSON.stringify({baseline:source,files:manifest,excluded,productionBusinessDataCopied:false},null,2));
process.stdout.write(JSON.stringify({files:manifest.length,excluded:excluded.length,target,productionBusinessDataCopied:false})+'\n');

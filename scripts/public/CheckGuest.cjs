'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict');
assert.equal(os.userInfo().username,'WDAGUtilityAccount');
const root=path.join(process.env.LOCALAPPDATA,'XjyGenuine150Host-a2'),program=path.join(root,'program'),res='C:/XjyReleaseResults';
const read=p=>{try{return JSON.parse(fs.readFileSync(p,'utf8'));}catch(e){return null;}},hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const out={at:new Date().toISOString(),hostname:os.hostname(),installationDir:program,activation:read(path.join(program,'xjy-install-activation.json')),journal:read(path.join(root,'.program.xjy-engine-state','journal.json')),startup:read(path.join(root,'.program.xjy-engine-state','engine-startup-status.json'))};
try{out.engine=fs.readFileSync(path.join(program,'version'),'utf8').trim();out.asarSha256=hash(path.join(program,'resources/app.asar'));}catch(e){out.error=e.code;}
try{out.installerExit=Number(fs.readFileSync(path.join(res,'manual-upgrade-exit.txt'),'utf8').trim());}catch(e){out.installerExit=null;}
const before=read(path.join(res,'rounds','20261022T013806243Z-1cd189','before.json'));
if(out.activation?.programVersion==='1.7.0'){
 const b=read(path.join(process.env.LOCALAPPDATA,'XjyRootRelease170/program/engine-native170-binding.json'));
 const c=JSON.parse(b.native.targetEnvelope.catalog);const mismatches=[];
 for(const row of c.files){const p=path.join(program,...row.path.split('/'));try{if(fs.statSync(p).size!==row.size||hash(p)!==row.sha256)mismatches.push(row.path);}catch(e){mismatches.push(row.path);}}
 out.programFilesChecked=c.files.length;out.programMismatches=mismatches;
 const changes=[];for(const row of before.data.files){const p=path.join(before.data.root,...row.path.split(/[\\/]/));try{if(fs.statSync(p).size!==row.size||hash(p)!==row.sha256)changes.push(row.path);}catch(e){changes.push(row.path);}}
 out.originalDataFilesChecked=before.data.files.length;out.originalDataChanged=changes;
}
fs.writeFileSync(path.join(res,'manual-check.json'),JSON.stringify(out,null,2));console.log(JSON.stringify({activation:out.activation?.programVersion,role:out.activation?.role,engine:out.engine,installerExit:out.installerExit,mismatches:out.programMismatches?.length,dataChanged:out.originalDataChanged?.length}));

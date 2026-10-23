'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const W=String.raw`E:\codex\2026-10-15\work\xjy-v16-deep-audit`,A=path.join(W,'release-work/native170-c26-full-audit-source-a1/prepare-native170-c26-audit-and-outer-actual-a2.cjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');assert.equal(sha(fs.readFileSync(A)),'1001d74424b3f2f3ab3aca10d753e26b65e5e7e5bb3078de11bf9649a611b092');
const old=JSON.parse(fs.readFileSync(path.join(W,'release-work/native170-known14-and19-target20-worker25-candidate-a1/native-publication/native-manifest-payload.json')));
assert.equal(typeof old.expiresAt,'string');assert.equal(new Date(old.expiresAt).toISOString(),old.expiresAt);
const args=[A,'--archive-sha256','de7d6d3a5fa9025bcb7ad8ca9af8eed942e7cb8169673db959f96690a3616b2b','--assembly-sha256','62ec9be3776fc5a1976a0297c05aa7c4ea8441ededadf266b72a013c7af8829b','--published-at',new Date().toISOString(),'--expires-at',old.expiresAt];
const result=spawnSync(process.execPath,args,{shell:false,windowsHide:true,stdio:'inherit'});if(result.error)throw result.error;process.exitCode=result.status===null?1:result.status;

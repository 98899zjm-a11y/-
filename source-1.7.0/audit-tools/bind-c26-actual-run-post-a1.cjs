'use strict';
// Bind a read-only postcondition observer to the actual C26 run; not execute it.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const W=String.raw`E:\codex\2026-10-15\work\xjy-v16-deep-audit`,source=path.join(W,'release-work/native170-c26-host-post-source-DRAFT-a2/post-c26-host.cjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),b=fs.readFileSync(source);assert.equal(sha(b),'2cc15e34d81e7889b811503de4b6a507e16249db8dbfc385a6d5183d59117b59');
let s=b.toString('utf8');const old="RUN='UNBOUND_ACTUAL_C26_ORIGINAL_CMD_RUN'";assert.equal(s.split(old).length,2);s=s.replace(old,"RUN='dc9ba92e-c5ab-4d1b-a112-c329c11cd88d'");
const dir=path.join(W,'release-work/native170-c26-host-post-root-bound-a1');fs.mkdirSync(dir);const out=path.join(dir,'post-c26-host.cjs'),tool=path.join(W,'release-work/deepseek-stage1-development-a1/tools/post-c26-host.cjs');
for(const f of[out,tool])fs.writeFileSync(f,s,{flag:'wx'});
console.log(JSON.stringify({postSource:out,sha256:sha(Buffer.from(s)),observedInstallRun:'dc9ba92e-c5ab-4d1b-a112-c329c11cd88d',postExecuted:false,successfulInstallInferred:false}));

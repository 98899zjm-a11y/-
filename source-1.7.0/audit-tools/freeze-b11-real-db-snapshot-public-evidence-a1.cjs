'use strict';
// Pure metadata reconstruction of the exact snapshot JSON written by source66df.
// It is pinned again against the original private Guest file before lease tests.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),a=require('node:assert/strict');
const W='E:/codex/2026-10-15/work/xjy-v16-deep-audit',D=path.join(W,'release-work/deepseek-stage1-development-a1'),id='1e6f48bb-5b0c-4dc7-865f-9519a017c203',dir=path.join(D,'results/guest-runs',id),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const r=JSON.parse(fs.readFileSync(path.join(dir,'result.json')));a.equal(r.exitCode,0);a.equal(r.status,'done');a.equal(r.timedOut,false);a.equal(r.runId,id);a.equal(r.argv.at(-1),'66df930facfeca952b6d5c1e076ccf23cab72503e5902c876ed504e787c42d43');
const stdout=fs.readFileSync(path.join(dir,'stdout.log')),v=JSON.parse(stdout);a.equal(v.snapshotRun,id);a.equal(v.apiRun,'c2ebe9b1-2faf-474f-9e64-22659d66ade7');a.equal(v.totalDatabaseHeaderBytesRead,48);a.equal(v.databaseOrFBytesWritten,0);a.equal(v.sqlExecuted,false);a.equal(v.credentialsRead,false);a.equal(v.databases.length,3);delete v.snapshotFile;
const b=Buffer.from(JSON.stringify(v,null,2)+'\n'),out=path.join(D,'control/original150-db-readonly-snapshot.json');fs.writeFileSync(out,b,{flag:'wx',mode:0o600});a(fs.readFileSync(out).equals(b));
const rec={actualSnapshotRun:id,sourceSha256:r.argv.at(-1),stdoutSha256:hash(stdout),originalSnapshotRawExpectedSha256:hash(b),snapshotBytes:b.length,apiEvidence:v.apiEvidence,dbIdentities:Object.fromEntries(v.databases.map(x=>[x.module,x.physicalIdentity])),guestOriginalRawMustMatchBeforeUse:true,dbReadOrWriteOnHost:false};
fs.writeFileSync(path.join(W,'reports/native170-b11-real-db-snapshot-binding-a1.json'),JSON.stringify(rec,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(rec));

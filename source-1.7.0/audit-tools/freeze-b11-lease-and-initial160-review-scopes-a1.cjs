'use strict';
// Root freezes already reviewed fixture sources; never executes Guest or product.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),a=require('node:assert/strict');
const W='E:/codex/2026-10-15/work/xjy-v16-deep-audit',D=path.join(W,'release-work/deepseek-stage1-development-a1'),h=b=>crypto.createHash('sha256').update(b).digest('hex');
function source(rel,pin){const p=path.join(W,rel),b=fs.readFileSync(p);a.equal(h(b),pin);return b.toString('utf8');}
function put(p,b){if(typeof b!=='string'&&!Buffer.isBuffer(b))b=JSON.stringify(b,null,2)+'\n';fs.writeFileSync(p,b,{flag:'wx',mode:0o600});const raw=fs.readFileSync(p);console.log(JSON.stringify({file:p,bytes:raw.length,sha256:h(raw)}));return h(raw);}
a.equal(h(fs.readFileSync(path.join(W,'reports/2026-10-20-autonomous-delivery-user-authorization.md'))),'7dfc073888846668db2be629a35a23a6db8a52fbcfbb9b934a67b4579cbbc9e0');
const lease='905c0f71c4a58873382c87ed05d44e17898fc20c1b19e768bbb5150408b2c2cc';
source('release-work/native170-sourcelease-b11-real-guest-bound-a1/verify-native-sourcelease-b11-real-bound-a1.cjs',lease);
put(path.join(W,'reports/native170-b11-root-real-sourcelease-test-scope-a1.json'),{
 authorityRecordSha256:'7dfc073888846668db2be629a35a23a6db8a52fbcfbb9b934a67b4579cbbc9e0',purpose:'OWNED_B11_FICTIONAL_SOURCELEASE_REAL_FD_TEST_ONLY',approved:true,sourceSha256:lease,
 guestId:'c6b4f1f6-411e-4272-b4a4-a1ca62701e39',ownerPid:6520,ownerFileTime:'01dd60d0cfc350ba',apiRun:'c2ebe9b1-2faf-474f-9e64-22659d66ade7',snapshotRun:'1e6f48bb-5b0c-4dc7-865f-9519a017c203',snapshotRawSha256:'6aa4efe91d553b3143e6febb94dfde218dbbf0972628f692eb4fac98fbab3306',
 allowed:'Original candidate d9e8 with original fixed PS pair; genuine ready HMAC and read-only held FD on exact three original-API synthetic DBs. FileAccess.ReadWrite handle Open/Dispose probes ONLY; zero byte writes, no truncation/SQL. New private C request/control/logs only.',
 forbidden:['Production access','Database/F byte writes or permission changes','Manual key/canonical/activation','Force kill','Claiming after-ready nonzero branch or whole Host acceptance'],afterReadyNonzeroTested:false,finalDeepseekFullAudit:'PENDING'
});
const out=path.join(W,'release-work/native150-to160-root-approval-bound-a1');a(!fs.existsSync(out));fs.mkdirSync(out);
const writer0=source('release-work/native150-to160-outside-approval-source-a2/create-initial160-host-outside-approval.cjs','a5f8376d6be0940fadf4982785caad89e75145011f06294c5004dcf823edee58');
const writer=writer0.replace('const ROOT_APPROVAL_CREATION_BOUND=false,','const ROOT_APPROVAL_CREATION_BOUND=true,');a.notEqual(writer,writer0);a.equal(writer.replace('const ROOT_APPROVAL_CREATION_BOUND=true,','const ROOT_APPROVAL_CREATION_BOUND=false,'),writer0);
const writerSha=put(path.join(out,'create-initial160-host-outside-approval.cjs'),writer);
const parent0=source('release-work/native150-to160-approval-complete-parent-draft-a2/launch-initial160-outside-approval.cjs','73567c5608edcee21adc98b8dc5d8993f1b6e37ed9f1e705c372f934f510e89c');
const parent=parent0.replace("const ROOT_SCOPE_BOUND=false,WRITER_SHA='UNBOUND_ROOT_BOUND_WRITER_SHA';",`const ROOT_SCOPE_BOUND=true,WRITER_SHA='${writerSha}';`);a.notEqual(parent,parent0);
const parentSha=put(path.join(out,'launch-initial160-outside-approval.cjs'),parent);
put(path.join(W,'reports/native150-initial160-root-outside-review-creation-scope-a1.json'),{
 authorityRecordSha256:'7dfc073888846668db2be629a35a23a6db8a52fbcfbb9b934a67b4579cbbc9e0',approved:true,purpose:'INDEPENDENT_TEST_HOST_OUTSIDE_APPROVAL_CREATION_ONLY',writerSha256:writerSha,parentSha256:parentSha,
 guestId:'c6b4f1f6-411e-4272-b4a4-a1ca62701e39',ownerPid:6520,ownerFileTime:'01dd60d0cfc350ba',original150ApiRun:'c2ebe9b1-2faf-474f-9e64-22659d66ade7',initial160Tree:'76c0b0052127f5897de8acb59d1ede56d159257e1c9f661b9664c1942e7aeaba',publicArchiveSha256:'16d12c14cd8ed16bb08dd61c946c3d8739af9231d7928942543f5eb1da3f979d',
 permitted:'Rehydrate missing exact signed504 public dependency files using held flat manifest, verify full1020 tree. Then real original150 EXE independently verifies original initial160 signatures and actual current SID/paths/time, creates one new BA private outside approval in current C runRoot/control/initial160-host-approval; original validateApproval before and after.',
 noBusinessDatabaseReadOrWrite:true,noDefaultApprovalAccess:true,noInstall:true,noCanonicalOrActivation:true,noProductionAccess:true,noKeyRead:true,noPolicyOrNetworkChanges:true,noForceKill:true,
 bindingAuthority:'New exact Root scope under current user delegation, not historical hash click. Future install requires separate scope pinned to actual new approval rawSHA/runRoot.',finalDeepseekFullAudit:'PENDING'
});

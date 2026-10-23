'use strict';
// Data-only Root decision for one fixed internal acceptance envelope.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const W=String.raw`E:\codex\2026-10-15\work\xjy-v16-deep-audit`,R=path.join(W,'release-work/native170-c26-full-audit-source-a1');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),p=path.join(W,'audit-tools/sign-native170-known14-and19-target20-worker26-single-outer-SCOPE-UNBOUND-a1.cjs'),raw=fs.readFileSync(p);
assert.equal(sha(raw),'2ecf573b4e39f3c3ecc9e4547691af767384b0160938fcfe5cf4f520c7ca2b4d');
const scope=JSON.parse(fs.readFileSync(path.join(R,'root-single-outer-scope-C26-DRAFT-NOT-APPROVED.json')));assert.equal(scope.approved,false);
scope.approved=true;scope.templateOnlyNotApproval=false;scope.approvedAt=new Date().toISOString();
scope.rootDecision='Root approves only this exact detached C26 internal outer20 under7dfc current delegation. Actual whole auditor42812 exit0 verified9 signatures,3293 streaming CRC+SHA,149ASAR and7AST; worker99+2 history corecbda/runtime67cf preserve original artifact policy and program. Root RAM38/0, Windows realFS6 named checks and Guest372b complete2185 old source files/17 long history/under8192, independent DS7 actual byte/evidence review. Actual Host/default14/native recovery/in-app/final whole release remain PENDING. No production/feed/archive mutation/other signing/key copy.';
const b=Buffer.from(JSON.stringify(scope,null,2)+'\n'),scopeFile=path.join(W,'reports/native170-known14-and19-target20-worker26-root-single-outer-signing-scope-a1.json');fs.writeFileSync(scopeFile,b,{flag:'wx'});
let s=raw.toString('utf8');function once(a,z){assert.equal(s.split(a).length,2);s=s.replace(a,z);}once("ROOT_SCOPE_SHA='UNBOUND'","ROOT_SCOPE_SHA='"+sha(b)+"'");once('ROOT_SCOPE_BYTES=0','ROOT_SCOPE_BYTES='+b.length);
const out=path.join(W,'audit-tools/sign-native170-known14-and19-target20-worker26-single-outer-final-a1.cjs');fs.writeFileSync(out,s,{flag:'wx'});
console.log(JSON.stringify({scopeSha256:sha(b),scopeBytes:b.length,signer:out,signerSha256:sha(Buffer.from(s)),signed:false,keyRead:false,published:false,installed:false}));

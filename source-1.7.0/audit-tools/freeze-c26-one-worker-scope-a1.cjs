'use strict';
// Root's exact internal test-signing scope under the existing delegation.
// Data-only: no signing/key/Guest/formal operation.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const W=String.raw`E:\codex\2026-10-15\work\xjy-v16-deep-audit`,R=path.join(W,'release-work/native170-c26-history-package-source-a1');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const signerPath=path.join(W,'audit-tools/sign-native170-known14-and19-target20-worker26-one-worker-SCOPE-UNBOUND-a1.cjs');
const source=fs.readFileSync(signerPath);assert.equal(sha(source),'467a37bf88228389f53fd1fa2128e1e01925938b8a3533f2d0d3bc532d54d989');
const scope=JSON.parse(fs.readFileSync(path.join(R,'root-worker26-scope-ACTUAL-INPUTS-NOT-APPROVED-a1.json')));
assert.equal(scope.approved,false);scope.approved=true;scope.templateOnlyNotRootApproval=false;
scope.rootActualEvidenceAndAuthorization='Root current exact internal-candidate signing decision under user delegation7dfc. Actual prepare67511 exit0; independently frozen corecbda/runtime67cf, inverse byte-exact to old0f9/ca4; RAM protectedTrees RED37/1 to GREEN38/0. DeepSeek actual relative handoff byte review at14:24 closed P1-A; P1-B preserved contextual denial. Public artifact/policy core0f9 remains unchanged. This is not release approval; real filesystem count8192, original native install/recovery, default14 and in-app acceptance, final audit, formal install and feed remain PENDING.';
const bytes=Buffer.from(JSON.stringify(scope,null,2)+'\n'),pin=sha(bytes),scopeFile=path.join(W,'reports/native170-known14-and19-target20-worker26-root-one-worker-signing-scope-a1.json');
fs.writeFileSync(scopeFile,bytes,{flag:'wx'});
let s=source.toString('utf8');function once(a,b){assert.equal(s.split(a).length,2,a);s=s.replace(a,b);}
once("ROOT_SCOPE_SHA='UNBOUND'","ROOT_SCOPE_SHA='"+pin+"'");once('ROOT_SCOPE_BYTES=0','ROOT_SCOPE_BYTES='+bytes.length);
once('FIXED only one exact new worker.catalog24 payload','FIXED only one exact new worker.catalog26 payload');
const out=path.join(W,'audit-tools/sign-native170-known14-and19-target20-worker26-one-worker-final-a1.cjs');fs.writeFileSync(out,s,{flag:'wx'});
console.log(JSON.stringify({scopeFile,scopeBytes:bytes.length,scopeSha256:pin,signer:out,signerSha256:sha(Buffer.from(s)),keyRead:false,signed:false,formalTouched:false}));

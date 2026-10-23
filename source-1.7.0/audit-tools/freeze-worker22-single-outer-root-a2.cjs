'use strict';
// Root-only fixed public material preparation. This file never opens a key.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const ROOT='E:/codex/2026-10-15/work/xjy-v16-deep-audit';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function read(rel,pin){const file=path.join(ROOT,rel);for(let p=file;;p=path.dirname(p)){const st=fs.lstatSync(p);assert(!st.isSymbolicLink()&&fs.realpathSync.native(p).toLowerCase()===path.resolve(p).toLowerCase());if(p===path.dirname(p))break;}const b=fs.readFileSync(file);assert.equal(hash(b),pin);return b;}
assert.equal(hash(read('reports/2026-10-20-autonomous-delivery-user-authorization.md','7dfc073888846668db2be629a35a23a6db8a52fbcfbb9b934a67b4579cbbc9e0')),'7dfc073888846668db2be629a35a23a6db8a52fbcfbb9b934a67b4579cbbc9e0');
const draft=read('release-work/native170-c22-single-outer-signing-source-a2/sign-native170-known14-and19-target20-worker22-single-outer-DRAFT-a2.cjs','ee829b73466ceb6dce7b65d4aa5944085af28cb7c4fdbaf76736dce70241932a').toString('utf8');
const template=fs.readFileSync(path.join(ROOT,'release-work/native170-known14-and19-target20-worker22-candidate-a1/outer-signing-source-DRAFT-a1/root-single-outer-scope-UNBOUND-template.json'));
const scope=JSON.parse(template);assert.equal(scope.approved,false);assert.equal(scope.rawPayloadSha256,'39ad0acffc1fcd0b8b5fe90335844683c7b6af5bdc90894f41f5402a427076bd');
scope.approved=true;scope.rootDecision='Root authorizes only the frozen C22 outer payload for isolated internal acceptance under current 7dfc user delegation; no production install, feed publication, archive mutation or final workflow approval.';
scope.rootDecisionAt=new Date().toISOString();scope.reviewedSignerDraftSha256='ee829b73466ceb6dce7b65d4aa5944085af28cb7c4fdbaf76736dce70241932a';scope.archiveContractFix='Exact four-field assembly contract and two-field manifest projection; original failing comparison retained; 15 public tests verified.';
const b=Buffer.from(JSON.stringify(scope,null,2)+'\n'),scopeFile=path.join(ROOT,'reports/native170-known14-and19-target20-worker22-root-single-outer-signing-scope-a1.json');
assert(draft.includes("ROOT_SCOPE_SHA='UNBOUND',ROOT_SCOPE_BYTES=0"));
let final=draft.replace("ROOT_SCOPE_SHA='UNBOUND',ROOT_SCOPE_BYTES=0",`ROOT_SCOPE_SHA='${hash(b)}',ROOT_SCOPE_BYTES=${b.length}`);
assert.equal(final.split("ROOT_SCOPE_SHA='UNBOUND'").length,1);
final=final.replace('// SOURCE DRAFT: one newly authorized detached outer only; no ZIP writes/feed/install.','// Root-bound fixed C22 detached outer only; no ZIP writes/feed/install.');
const finalFile=path.join(ROOT,'audit-tools/sign-native170-known14-and19-target20-worker22-single-outer-final-a2.cjs');
for(const file of[scopeFile,finalFile])assert(!fs.existsSync(file),'CreateNew only');
fs.writeFileSync(scopeFile,b,{flag:'wx'});fs.writeFileSync(finalFile,final,{flag:'wx'});
console.log(JSON.stringify({scopeFile,scopeSha256:hash(b),scopeBytes:b.length,finalFile,signerSha256:hash(Buffer.from(final)),signerBytes:Buffer.byteLength(final),privateKeyRead:false}));

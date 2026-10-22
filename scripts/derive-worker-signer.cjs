'use strict';
const fs=require('node:fs'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const R='D:/Codex/xjy-release-20261022',S=R+'/source',C=R+'/candidate';const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),h=p=>sha(fs.readFileSync(p));
const proposal=JSON.parse(fs.readFileSync(C+'/proposal/proposal-manifest.json')),index=JSON.parse(fs.readFileSync(C+'/proposal/signing-requests.json'));
const spec=require(S+'/prepare-release.cjs');assert.equal(spec.WORKER28_OVERLAYS.length,4);assert.equal(index.unchangedWorkerRows,97);
let src=fs.readFileSync('D:/Codex/xjy-1.7.0/deepseek-delivery-work/host-node-sign-c28-worker28-a1.cjs','utf8');
function one(a,b){assert.equal(src.split(a).length-1,1,a);src=src.replace(a,b);}
one("const P = path.join(D, 'c28-candidate', 'proposal');","const P = "+JSON.stringify(C+'/proposal')+';');
one("const OUT = path.join(D, 'c28-candidate', 'approvals');","const OUT = "+JSON.stringify(C+'/approvals')+';');
one("const RESULT = path.join(D, 'deepseek-delivery-work', 'host-node-results');","const RESULT = "+JSON.stringify(S)+';');
one("const REPORT = path.join(RESULT, 'c28-internal-signing-report-a1.json');","const REPORT = path.join(RESULT, 'worker-signing-report.json');");
for(const [name,value]of Object.entries({PROPOSAL_SHA:h(C+'/proposal/proposal-manifest.json'),INDEX_SHA:h(C+'/proposal/signing-requests.json'),BUILDER_SHA:h(S+'/prepare-release.cjs'),REVIEWED_SHA:h(S+'/reviewed-inputs-ROOT.json')})){const match=src.match(new RegExp('const '+name+" = '[a-f0-9]{64}';"));assert(match);one(match[0],'const '+name+' = '+JSON.stringify(value)+';');}
const expected=spec.WORKER28_OVERLAYS.map(row=>({path:row.path.slice('worker-draft/'.length),size:row.size,sha256:row.sha256})).sort((a,b)=>a.path<b.path?-1:1);
one("assert.deepEqual(changed, [RUNTIME, SLOT], 'delta must be exactly runtime+slot');","assert.deepEqual(changed, "+JSON.stringify(expected)+", 'exact four reviewed delta rows');");
one('report.changedWorkerRows = [RUNTIME, SLOT];','report.changedWorkerRows = '+JSON.stringify(expected)+';');one('report.unchangedWorkerRows = 99;','report.unchangedWorkerRows = 97;');
fs.writeFileSync(S+'/sign-worker-release.cjs',src,{flag:'wx'});fs.writeFileSync(S+'/worker-scope.json',JSON.stringify({approved:true,internalOnly:true,authority:'2026-10-22 user explicitly authorized takeover, build/sign/test and conditional formal upgrade',proposalSha256:h(C+'/proposal/proposal-manifest.json'),builderSha256:h(S+'/prepare-release.cjs'),reviewedInputsSha256:h(S+'/reviewed-inputs-ROOT.json'),requestsSha256:h(C+'/proposal/signing-requests.json'),changedRows:expected,signerSha256:sha(Buffer.from(src)),productionReady:false},null,2),{flag:'wx'});console.log(JSON.stringify({signerSha256:sha(Buffer.from(src)),expectedRows:expected.length}));

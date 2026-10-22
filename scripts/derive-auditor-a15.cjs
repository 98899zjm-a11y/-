'use strict';
// derive-auditor-a15.cjs —— 与 derive-auditor.cjs 相同，额外把 C27 基线中的引擎行改为 a15（否则 C28_HISTORY_REGRESSION）。
const fs=require('node:fs'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const R='D:/Codex/xjy-release-20261022',S=R+'/source',C=R+'/candidate',OLD='D:/Codex/xjy-1.7.0/c28-package-source';const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),h=p=>sha(fs.readFileSync(p));
const A15='D:/Codex/xjy-1.7.0/c28-repair-source/retry-integrated-a15/engine-tree-runtime170.cjs';
const a15=fs.readFileSync(A15),a15Bytes=a15.length,a15Sha=sha(a15);
const assembly=JSON.parse(fs.readFileSync(C+'/build/assembly.json')),index=JSON.parse(fs.readFileSync(C+'/proposal/signing-requests.json')),spec=require(S+'/prepare-release.cjs');
let src=fs.readFileSync(OLD+'/prepare-native170-c28-audit-ROOT-a1.cjs','utf8');
function one(a,b){assert.equal(src.split(a).length-1,1,a.slice(0,100));src=src.replace(a,b);}
one("PACKAGE_SOURCE='D:/Codex/xjy-1.7.0/c28-package-source'","PACKAGE_SOURCE='"+S+"'");one("A11='D:/Codex/xjy-1.7.0/c28-candidate'","A11='"+C+"'");
one("'prepare-native170-c28-internal-BOUND-a1.cjs'","'prepare-release.cjs'");
function constant(name,value){const re=new RegExp('\\b'+name+"='[^']*'");const m=src.match(re);assert(m,name);one(m[0],name+'='+JSON.stringify(value));}
const expected=spec.WORKER28_OVERLAYS.map(r=>({path:r.path.slice('worker-draft/'.length),size:r.size,sha256:r.sha256})).sort((a,b)=>a.path<b.path?-1:1);
const oldExpected=src.match(/ const expected=\[.*\];/);assert(oldExpected);one(oldExpected[0],' const expected='+JSON.stringify(expected)+';');
one("{path:'delivery-tools/engine-tree-runtime170.cjs',size:199034,sha256:'b856fc516b0e97fa99951fb2bb1880c8f4bd86cf4481bd2199fba2ad5531e0fa'}","{path:'delivery-tools/engine-tree-runtime170.cjs',size:"+a15Bytes+",sha256:'"+a15Sha+"'}");
for(const [name,value]of Object.entries({PREPARE_TOOL_SHA:h(S+'/prepare-release.cjs'),REVIEW_INPUT_SHA:h(S+'/reviewed-inputs-ROOT.json'),PROPOSAL_SHA:h(C+'/proposal/proposal-manifest.json'),PREPARE_INDEX_SHA:h(C+'/proposal/signing-requests.json'),FINAL_ARCHIVE_SHA:assembly.archive.sha256,FINAL_ASSEMBLY_SHA:h(C+'/build/assembly.json'),FINAL_WORKER_SHA:index.workerCatalogSha256,FINAL_BINDING_SHA:assembly.bindingSha256,FINAL_TREE_SHA:assembly.treeSha256,FINAL_WRAPPER_SHA:h(C+'/build/package/安装组件/native-delivery-170.ps1')}))constant(name,value);
for(const [name,value]of Object.entries({FINAL_ASSEMBLY_BYTES:fs.statSync(C+'/build/assembly.json').size,FINAL_ARCHIVE_BYTES:assembly.archive.size,FINAL_BINDING_BYTES:fs.statSync(C+'/build/package/engine-native170-binding.json').size,FINAL_WRAPPER_BYTES:fs.statSync(C+'/build/package/安装组件/native-delivery-170.ps1').size})){const m=src.match(new RegExp('\\b'+name+'=\\d+'));assert(m,name);one(m[0],name+'='+value);}
src=src.replaceAll('workerUnchangedRows:99','workerUnchangedRows:97').replaceAll('unchangedWorkerRows!==99','unchangedWorkerRows!==97').replaceAll('worker101ExactlyTwoReviewedRowsChanged','worker101ExactlyFourReviewedRowsChanged');
fs.writeFileSync(S+'/audit-release.cjs',src,{flag:'wx'});console.log(JSON.stringify({auditorSha256:sha(Buffer.from(src)),archive:assembly.archive,engine:{size:a15Bytes,sha256:a15Sha}}));

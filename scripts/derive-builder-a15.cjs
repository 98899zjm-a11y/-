'use strict';
// derive-builder-a15.cjs
// 与 derive-builder.cjs 相同，仅把引擎 overlay 从 a14 换成 a15：
// a15 = a14 + "空目录 + 可写历史前缀" 放行（修 TREE_CHANGED 复查误判）。
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const OLD='D:/Codex/xjy-1.7.0/c28-package-source',R='D:/Codex/xjy-release-20261022',S=R+'/source',C=R+'/candidate';
const CONT='D:/Codex/xjy-1.7.0/deepseek-delivery-work/continuation-20261022';
const A15='D:/Codex/xjy-1.7.0/c28-repair-source/retry-integrated-a15/engine-tree-runtime170.cjs';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),read=p=>fs.readFileSync(p,'utf8');
fs.mkdirSync(S,{recursive:true});
const patches=[
 ['install-location.cjs','root-release-fixed5.cjs',17214,'3e4698f282d521ea9456375f1948ca5032db79783fb5e9b486b8c68fc5f24cba'],
 ['delivery-native-170.cjs','ds-r8-delivery-native-patched-a1.cjs',11527,'c962f1c314866be0a57d7aef819954f47a389998e6eb78dd30562d99b0cb52fc']
];
for(const [name,source,size,digest]of patches){const b=fs.readFileSync(CONT+'/'+source);assert.equal(b.length,size);assert.equal(sha(b),digest);fs.writeFileSync(S+'/'+name,b);}
let src=read(OLD+'/prepare-native170-c28-internal-BOUND-a1.cjs');const changes=[];
function one(a,b){assert.equal(src.split(a).length-1,1,'exact anchor '+a.slice(0,75));src=src.replace(a,b);changes.push({before:a,after:b});}
one("const SOURCE_ROOT='D:/Codex/xjy-1.7.0/c28-package-source'","const SOURCE_ROOT='"+S+"'");
one("const A11='D:/Codex/xjy-1.7.0/c28-candidate'","const A11='"+C+"'");
const baseline=JSON.parse(read('D:/Codex/xjy-1.7.0/c27-candidate/proposal/proposal-manifest.json'));
const existing=require(OLD+'/prepare-native170-c28-internal-BOUND-a1.cjs');
const preimages=[...existing.C28_PREIMAGES,...patches.map(([name])=>{const row=baseline.files.find(r=>r.path==='worker-draft/delivery-tools/'+name);assert(row);return row;})];
const a15Bytes=fs.readFileSync(A15);
const overlays=[...existing.WORKER28_OVERLAYS.map(r=>r.path.endsWith('/engine-tree-runtime170.cjs')?{path:r.path,source:A15,size:a15Bytes.length,sha256:sha(a15Bytes)}:{...r}),...patches.map(([name,_s,size,sha256])=>({path:'worker-draft/delivery-tools/'+name,source:S+'/'+name,size,sha256}))];
assert.equal(overlays.length,4);
one("const ROOT_RUNTIME_SOURCE='D:/Codex/xjy-1.7.0/c28-repair-source/retry-integrated-a14/engine-tree-runtime170.cjs'","const ROOT_RUNTIME_SOURCE='"+A15+"'");
one(src.match(/const C28_PREIMAGES=Object\.freeze\(.*\);/)[0],'const C28_PREIMAGES=Object.freeze('+JSON.stringify(preimages)+');');
one(src.match(/const WORKER28_OVERLAYS=Object\.freeze\(.*\);/)[0],'const WORKER28_OVERLAYS=Object.freeze('+JSON.stringify(overlays)+');');
one('WORKER28_OVERLAYS.length!==2','WORKER28_OVERLAYS.length!==4');
one(",{path:'delivery-tools/delivery-native-170.cjs',size:11123,sha256:'2011ecc3614d0044de189902fac9d8926d08a1d2735567c66a6eb275eab7f287'}",'');
one('unchangedWorkerRows:99','unchangedWorkerRows:97');
src=src.replaceAll('worker101ExactlyTwoReviewedRowsChanged','worker101ExactlyFourReviewedRowsChanged').replaceAll('runtimeAndSlotOnlyRelativeToC27:true','reviewedFourFilesOnlyRelativeToC27:true');
const manifest=JSON.parse(read(OLD+'/reviewed-inputs-ROOT.json'));manifest.files=overlays;
const reviewed=process.argv.includes('--reviewed');
manifest.reviewed=reviewed;
const evidence={schemaVersion:1,oldComponentEvidence:JSON.parse(read(OLD+'/component-tests-ROOT.json')),currentTests:JSON.parse(read(R+'/tests/fixed5-48-results.json')),crossRole:JSON.parse(read(R+'/tests/cross-role-results.json')),previousProductionChain:JSON.parse(read('D:/Codex/xjy-1.7.0/guest-diagnostics-a1/results/ds-r7-prodchain-b1.json')),previousProductionChainScope:'fixed4; fixed5 native test pending',treedChangedFix:{file:A15,size:a15Bytes.length,sha256:sha(a15Bytes),defect:'TREE_CHANGED 完整树含未声明空目录 on post-commit verifyInstalled',test:'tests/engine-empty-dirs-backup.test.cjs',testResult:'5/5 fixed, 5/5 legacy refusal, regression 12/12'},nativeInstallPassed:false};
const reviewPath=CONT+'/INDEPENDENT_REVIEW_FIXED5_SIGNOFF.md';
let review='PENDING independent fixed4 review\n';
if(reviewed){assert(fs.existsSync(reviewPath),'review must exist');review=read(OLD+'/integrated-review-ROOT.txt')+'\n\n--- Independent fixed4 review, retained findings ---\n'+read(CONT+'/INDEPENDENT_REVIEW_FIXED4_FINAL.md')+'\n\n--- Independent final fixed5 disposition ---\n'+read(reviewPath)+'\n\n--- EMPTY_DIRECTORY_ALLOWLIST_170 fix (a15) ---\n'+read('D:/Codex/xjy-1.7.0/c28-repair-source/retry-integrated-a15/final-blockers-change.json');}
fs.writeFileSync(S+'/integrated-review-ROOT.txt',review);fs.writeFileSync(S+'/component-tests-ROOT.json',JSON.stringify(evidence,null,2)+'\n');
manifest.internalPreparation.integratedReviewAccepted=reviewed;
manifest.internalPreparation.integratedReviewEvidenceSha256=sha(Buffer.from(review));manifest.internalPreparation.componentTestsEvidenceSha256=sha(fs.readFileSync(S+'/component-tests-ROOT.json'));
const manifestBytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');fs.writeFileSync(S+'/reviewed-inputs-ROOT.json',manifestBytes);
const newPin="FIXED_INPUTS_PIN='"+sha(manifestBytes)+"'";
const oldPin1="FIXED_INPUTS_PIN='b45ee45f649866319851af915c3102427a839430bf0befb7cc76a31ec16337e0'";
const oldPin2="FIXED_INPUTS_PIN='77151179facf23d9b960c0e4ed0781624a2f3c1b45c2b5d44358e6b27a2b6a6d'";
if(src.includes(oldPin1))one(oldPin1,newPin);else one(oldPin2,newPin);
fs.writeFileSync(S+'/prepare-release.cjs',src);fs.copyFileSync(OLD+'/c27-worker27-baseline.json',S+'/c27-worker27-baseline.json');
fs.writeFileSync(R+'/builder-diff-a15.json',JSON.stringify({source:OLD+'/prepare-native170-c28-internal-BOUND-a1.cjs',sourceSha256:sha(fs.readFileSync(OLD+'/prepare-native170-c28-internal-BOUND-a1.cjs')),output:S+'/prepare-release.cjs',outputSha256:sha(Buffer.from(src)),changes,manifestSha256:sha(manifestBytes),reviewed,overlays},null,2));
console.log(JSON.stringify({reviewed,builderSha256:sha(Buffer.from(src)),manifestSha256:sha(manifestBytes),overlays:4,output:S}));

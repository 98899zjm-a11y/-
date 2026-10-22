'use strict';
// derive-builder-r2.cjs
// Same derivation as derive-builder-a16.cjs (identical anchors, pins, evidence, overlays),
// plus the target-21 / r2-asar fork:
//   a) manifest.purpose = native170-known14-and20-target21-worker28
//   b) manifest.finalAsar = deepseek-r2-a1 final asar (exactly source/size/sha256/reportSource/reportSha256)
//   c) after source/prepare-release.cjs is staged, run make-prepare-r2.cjs (17 edits) via E:/node/node.exe,
//      rename the .tmp over the staged file, then write the new FIXED_INPUTS_PIN over the fork output
//   d) emit builder-r2-diff.json (manifestSha256, prepareSha256, finalAsar, purpose)
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),cp=require('node:child_process');
const OLD='D:/Codex/xjy-1.7.0/c28-package-source',R='D:/Codex/xjy-release-20261022',S=R+'/source',C=R+'/candidate';
const CONT='D:/Codex/xjy-1.7.0/deepseek-delivery-work/continuation-20261022';
const A15='D:/Codex/xjy-1.7.0/c28-repair-source/retry-integrated-a16/engine-tree-runtime170.cjs';
const NODE='E:/node/node.exe',FORK=R+'/make-prepare-r2.cjs',STAGE=S+'/prepare-release.cjs',TMP=STAGE+'.tmp';
const PURPOSE='native170-known14-and20-target21-worker28';
const FINAL_ASAR=Object.freeze({
 source:'E:/codex/2026-10-15/work/xjy-v16-deep-audit/release-work/deepseek-r2-a1/final-asar/app.asar',
 size:13493619,
 sha256:'9593b161f7091f5b471ce4918afee480097105b5668abbe154eb60075b1025a4',
 reportSource:'E:/codex/2026-10-15/work/xjy-v16-deep-audit/release-work/deepseek-r2-a1/final-asar/report.json',
 reportSha256:'139fd30e9afc4324e76a4e571c9bba5b043ddd4fd43bf7cbef004b9c51541c2f'
});
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
src=src.replaceAll('worker101ExactlyTwoReviewedRowsChanged','worker101ExactlyFourReviewedRowsChanged').replaceAll('runtimeAndSlotOnlyRelativeToC27','reviewedFourFilesOnlyRelativeToC27');
// (b) assert the r2 asar really is the pinned bytes before it is trusted in the manifest
const finalAsarBytes=fs.readFileSync(FINAL_ASAR.source),finalReportBytes=fs.readFileSync(FINAL_ASAR.reportSource);
assert.equal(finalAsarBytes.length,FINAL_ASAR.size,'r2 final asar size');
assert.equal(sha(finalAsarBytes),FINAL_ASAR.sha256,'r2 final asar sha256');
assert.equal(sha(finalReportBytes),FINAL_ASAR.reportSha256,'r2 asar report sha256');
const manifest=JSON.parse(read(OLD+'/reviewed-inputs-ROOT.json'));manifest.files=overlays;
// (a) reviewed purpose for the sequence-21 chain
manifest.purpose=PURPOSE;
// (b) exact five-key finalAsar pointing at the deepseek-r2-a1 final asar + report
manifest.finalAsar={...FINAL_ASAR,size:FINAL_ASAR.size};
const reviewed=process.argv.includes('--reviewed');
manifest.reviewed=reviewed;
const evidence={schemaVersion:1,oldComponentEvidence:JSON.parse(read(OLD+'/component-tests-ROOT.json')),currentTests:JSON.parse(read(R+'/tests/fixed5-48-results.json')),crossRole:JSON.parse(read(R+'/tests/cross-role-results.json')),previousProductionChain:JSON.parse(read('D:/Codex/xjy-1.7.0/guest-diagnostics-a1/results/ds-r7-prodchain-b1.json')),previousProductionChainScope:'fixed4; fixed5 native test pending',treedChangedFix:{file:A15,size:a15Bytes.length,sha256:sha(a15Bytes),defect:'TREE_CHANGED full tree included undeclared empty dirs on post-commit verifyInstalled',test:'tests/engine-empty-dirs-backup.test.cjs',testResult:'5/5 fixed, 5/5 legacy refusal, regression 12/12'},nativeInstallPassed:false};
const reviewPath=CONT+'/INDEPENDENT_REVIEW_FIXED5_SIGNOFF.md';
let review='PENDING independent fixed4 review\n';
if(reviewed){assert(fs.existsSync(reviewPath),'review must exist');review=read(OLD+'/integrated-review-ROOT.txt')+'\n\n--- Independent fixed4 review, retained findings ---\n'+read(CONT+'/INDEPENDENT_REVIEW_FIXED4_FINAL.md')+'\n\n--- Independent final fixed5 disposition ---\n'+read(reviewPath)+'\n\n--- EMPTY_DIRECTORY_ALLOWLIST_170 fix (a15) ---\n'+read('D:/Codex/xjy-1.7.0/c28-repair-source/retry-integrated-a16/final-blockers-change.json');}
fs.writeFileSync(S+'/integrated-review-ROOT.txt',review);fs.writeFileSync(S+'/component-tests-ROOT.json',JSON.stringify(evidence,null,2)+'\n');
manifest.internalPreparation.integratedReviewAccepted=reviewed;
manifest.internalPreparation.integratedReviewEvidenceSha256=sha(Buffer.from(review));manifest.internalPreparation.componentTestsEvidenceSha256=sha(fs.readFileSync(S+'/component-tests-ROOT.json'));
const manifestBytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');fs.writeFileSync(S+'/reviewed-inputs-ROOT.json',manifestBytes);
const newPin="FIXED_INPUTS_PIN='"+sha(manifestBytes)+"'";
const oldPin1="FIXED_INPUTS_PIN='b45ee45f649866319851af915c3102427a839430bf0befb7cc76a31ec16337e0'";
const oldPin2="FIXED_INPUTS_PIN='77151179facf23d9b960c0e4ed0781624a2f3c1b45c2b5d44358e6b27a2b6a6d'";
// stage the a16 derivation first: the old pin is still in place at this point
fs.writeFileSync(STAGE,src);
// (c) 17-edit sequence-21/r2-asar fork, applied to the staged file, then renamed over it
assert(fs.existsSync(FORK),'make-prepare-r2.cjs must exist');
const forkStdout=cp.execFileSync(NODE,[FORK,STAGE,TMP],{windowsHide:true,shell:false,encoding:'utf8',timeout:120000,maxBuffer:1048576});
const forkReport=JSON.parse(forkStdout);
assert.equal(forkReport.ok,true,'fork must report ok');
assert.equal(forkReport.edits.length,17,'fork must apply exactly 17 edits');
assert(fs.existsSync(TMP),'fork output must exist');fs.renameSync(TMP,STAGE);
// now write the new FIXED_INPUTS_PIN back over the fork output
src=read(STAGE);
if(src.includes(oldPin1))one(oldPin1,newPin);else one(oldPin2,newPin);
fs.writeFileSync(STAGE,src);
fs.copyFileSync(OLD+'/c27-worker27-baseline.json',S+'/c27-worker27-baseline.json');
// (d) diff record
const prepareBytes=fs.readFileSync(STAGE);
fs.writeFileSync(R+'/builder-r2-diff.json',JSON.stringify({source:OLD+'/prepare-native170-c28-internal-BOUND-a1.cjs',sourceSha256:sha(fs.readFileSync(OLD+'/prepare-native170-c28-internal-BOUND-a1.cjs')),output:STAGE,outputSha256:sha(prepareBytes),prepareSha256:sha(prepareBytes),manifestSha256:sha(manifestBytes),purpose:PURPOSE,finalAsar:FINAL_ASAR,reviewed,overlays,fork:{tool:FORK,toolSha256:sha(fs.readFileSync(FORK)),edits:forkReport.edits,forkedSha256:forkReport.sha256},changes},null,2));
console.log(JSON.stringify({reviewed,purpose:PURPOSE,builderSha256:sha(prepareBytes),manifestSha256:sha(manifestBytes),overlays:4,forkEdits:forkReport.edits.length,finalAsar:FINAL_ASAR,output:STAGE}));

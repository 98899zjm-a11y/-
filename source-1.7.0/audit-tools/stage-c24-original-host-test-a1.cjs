'use strict';
// Root-only staging of public internal material; no product, key or production IO.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const W=String.raw`E:\codex\2026-10-15\work\xjy-v16-deep-audit`,D=path.join(W,'release-work/deepseek-stage1-development-a1');
const C=path.join(W,'release-work/native170-known14-and19-target20-worker24-candidate-a1');
const old=path.join(D,'results/native170-public-c23-w23-a1'),stage=path.join(D,'results/native170-public-c24-w24-a1');
const out=path.join(W,'release-work/native170-c24-original-cmd-root-bound-a1');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const ensure=(v,m)=>{if(!v)throw Error(m);};
async function copy(src,name,expected){const bytes=fs.readFileSync(src);ensure(sha(bytes)===expected,'Pinned public input changed: '+name);fs.writeFileSync(path.join(stage,name),bytes,{flag:'wx'});return{name,size:bytes.length,sha256:expected};}
(async()=>{
 ensure(!fs.existsSync(stage)&&!fs.existsSync(out),'New paths only');fs.mkdirSync(stage);fs.mkdirSync(out);
 const rows=[];
 for(const [src,name,pin] of [
 [path.join(C,'build/native-package.zip'),'native-package.zip','e91703a105e29cbaefecc17e9c8329d5b16b006dc2521c1ebff6968f4e0e8108'],
 [path.join(C,'build/assembly.json'),'assembly.json','abae2571a6a83f6f103242eda2e78a28b7ed80ef27ff271e0c50438b29d1e6d4'],
 [path.join(C,'native-publication/native-manifest.json'),'native-manifest.json','dcee3a38cfa030f38280392b214ae0e4701662ca68cd417f62dfc9c94f8f14a4'],
 [path.join(old,'publisher-public.pem'),'publisher-public.pem','bc6c3d2b42871e42d3eb91371034b410d507a228eeccb1d714acca60e8141b30'],
 [path.join(old,'source-post.json'),'source-post.json','373c7a76c4ed6e0f830831a9c165ae8001ac3ecb8d31b959e7a5a55e97874621'],
 [path.join(old,'source-normal-exit.json'),'source-normal-exit.json','cbd106af9f5278e886cbb482bf508a50a846fa9a82b573300b482923979ead88']]) rows.push(await copy(src,name,pin));
 const scope=JSON.parse(fs.readFileSync(path.join(old,'root-c23-original-cmd-test-scope.json')));
 ensure(scope.authorityRecordSha256==='7dfc073888846668db2be629a35a23a6db8a52fbcfbb9b934a67b4579cbbc9e0'&&scope.operation==='host-upgrade','Prior scope authority differs');
 scope.purpose='native170-c24-original-cmd-internal-test';scope.expiresAt=new Date(Date.now()+90*60000).toISOString();
 scope.archiveSha256=rows[0].sha256;scope.outerEnvelopeSha256=rows[2].sha256;
 scope.rootDecision='Root current C24 internal original-CMD trial only under 7dfc; real C23 preset failure preserved. Fixed C6 genuine162, owned B11, source post and normal-exit remain revalidated. No formal install, no kill, no manual canonical, no in-app acceptance inferred.';
 const bytes=Buffer.from(JSON.stringify(scope,null,2)+'\n'),scopeSha=sha(bytes);fs.writeFileSync(path.join(stage,'root-c24-original-cmd-test-scope.json'),bytes,{flag:'wx'});
 const source=path.join(W,'release-work/native170-c23-original-cmd-root-bound-a1/run-native170-c23-original-cmd-DRAFT-a1.cjs');let s=fs.readFileSync(source,'utf8');
 ensure(sha(Buffer.from(s))==='b1e227cbb4869f717bc8563d62db4fcf2f44c1bcc20053bd301682dce37cfeb3','Prior driver changed');
 const replace=(a,b)=>{ensure(s.split(a).length===2,'Expected one pin: '+a);s=s.replace(a,b);};
 for(const [a,b] of [
 ['c69899d6343235c74e595406dc0768d7309709a91c4ff3b425fe1921af9f9f68',rows[0].sha256],['781501577','781501758'],
 ['e0b1d13dd6f0788790e1fb14eff75c5c99124ec823efedece26ad08960aa394c',rows[1].sha256],
 ['8bf2b873de03c415adf74fbcfa82316415041f242ab04291a165346b1145a492',rows[2].sha256],
 ['27631a543af117997d9bc2b9d8fb8592c2c4d37a11f6e5a0fec9f6db2f161d7f',scopeSha],
 ['9627d2b2f5b98725a06dde493f578aeb9c306932df07446636c2644a8588098f','7168f29eab2fc8ee6aa53bef65d4b1294da7412b8529d2bff9902e331943f7cc'],
 ['7ed4c63947685b7918ea975a35e0742f1219c3cc5940dc5a5c3c8f41cffec6f5','c6d361b4be36de8c4eda3dd981b05491f18b59bd31e8bd5aa3e9aa375e30193f'],
 ['c5c4ac8c8747bf9646af8a95dd7bfe2b718ab330554f5a0e7afb8c3614128d87','f9fc5f990e03e867949c3e50bd71ac103bb6cb4791a05c8f583b1b8f59de9e24'],
 ['07f9c93944f341d609a646ec7f82de268a157255c5ba2d4f585498f9e99faefe','8e4aa8bbd698b91c67410adf35569121c0418b55d0dd1ff9a59c999131123fe6'],
 ['worker.sequence===23','worker.sequence===24']])replace(a,b);
 s=s.replaceAll('c23','c24').replaceAll('C23','C24').replaceAll('w23','w24');
 const file='run-native170-c24-original-cmd-a1.cjs';s=s.replaceAll('run-native170-c24-original-cmd-DRAFT-a1.cjs',file);
 fs.writeFileSync(path.join(out,file),s,{flag:'wx'});fs.writeFileSync(path.join(D,'tools',file),s,{flag:'wx'});
 const result={stage,driver:path.join(out,file),driverSha256:sha(Buffer.from(s)),scopeSha256:scopeSha,rows,onlyInternalStaging:true,formalTouched:false};
 fs.writeFileSync(path.join(out,'staging.json'),JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify(result));
})().catch(e=>{console.error(e.stack);process.exitCode=1;});

'use strict';
// Fixed data-only candidate assembly. No signing key, business import or launch.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..'),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
assert.equal(ROOT.toLowerCase(),'c:\\xjy-work\\xjy-web-stage1');
const actual=require('../stage1/guest-candidate-cdp.cjs').actualGuard();
const g=require('../stage1/isolation.cjs').createIsolationGuard(ROOT),builder=require('../stage1/build-full-release.cjs');
const BASE=path.join(ROOT,'release-work/engine-4490-a1'),stock=path.join(BASE,'engine-stock'),program=path.join(BASE,'program'),resources=path.join(ROOT,'release/engine-4490-a1');
const read=file=>fs.readFileSync(g.assertPath(file));
function put(file,bytes){g.assertPath(file);fs.mkdirSync(g.assertPath(path.dirname(file)),{recursive:true});fs.writeFileSync(g.assertPath(file),bytes,{flag:'wx'});assert.equal(hash(read(file)),hash(bytes));}
assert(!fs.existsSync(program));
const extraction=JSON.parse(read(path.join(BASE,'engine-stock.json'))),candidate=JSON.parse(fs.readFileSync('C:/xjy-results/engine-4490-candidate-a1.json','utf8'));
assert(extraction.passed&&extraction.zipSha256==='88e08039d0ef359bab9f674e8051fa103bd8628ea7c5a5e1daaa610a8a0c6931');
assert(candidate.sealed&&candidate.manifest.asar.allEntriesExtracted&&candidate.financeCsvBinaryUpdateIncluded);
assert.equal(candidate.manifest.outputDir,resources);
const canonical=rows=>rows.slice().sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
assert.deepEqual(canonical(builder.artifactList(stock)),canonical(extraction.files));
const frozen=fs.readFileSync('C:/xjy-results/engine-4490-source-freeze-a1.json');
assert.equal(hash(frozen),candidate.freeze.rootApprovedSha256);
put(path.join(BASE,'source-freeze.json'),frozen);
const engineFiles=[];
for(const row of extraction.files){
 if(row.path==='resources/default_app.asar')continue;
 const bytes=read(path.join(stock,...row.path.split('/')));assert.equal(bytes.length,row.size);assert.equal(hash(bytes),row.sha256);
 const name=row.path==='electron.exe'?'鑫金源珠宝报价.exe':row.path;
 put(path.join(program,...name.split('/')),bytes);engineFiles.push({...row,path:name});
}
for(const row of candidate.manifest.files){
 builder.assertProgramPath(row.path);const bytes=read(path.join(resources,...row.path.split('/')));assert.equal(bytes.length,row.size);assert.equal(hash(bytes),row.sha256);
 put(path.join(program,...row.path.split('/')),bytes);
}
const programFiles=builder.artifactList(program),expected=[...engineFiles,...candidate.manifest.files];
assert.deepEqual(canonical(programFiles),canonical(expected));
const printDependenciesRoot=path.join(program,'resources/print-dependencies/node_modules');
const manifest={version:1,purpose:'xjy-engine-4490-isolated-runtime',engineVersion:'44.9.0',zipSha256:extraction.zipSha256,engineRoot:program,executableName:'鑫金源珠宝报价.exe',engineFiles,programFiles,asarSha256:candidate.manifest.asar.sha256,printDependenciesRoot,printDependencyFiles:builder.artifactList(printDependenciesRoot),candidateRun:'finance-repack-green-a2',candidateManifestSha256:'b249a4d71289246e6c2c1704b64c51e83e3efbe1e41e99e94b505c81a773f12b',sourceCommit:'175b5aa1c7ff24dc84ce709ec10efe1c19a0b5d8',sourceFreezeSha256:hash(frozen),signedForProduction:false,publicAccess:false,actualContext:actual,defaultAppRemoved:true};
const bytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');put(path.join(BASE,'runtime-manifest.json'),bytes);
fs.writeFileSync('C:/xjy-results/engine-4490-runtime-manifest-a1.json',bytes,{flag:'wx'});
console.log(JSON.stringify({passed:true,files:programFiles.length,engineFiles:engineFiles.length,manifestSha256:hash(bytes),exeSha256:engineFiles.find(row=>row.path===manifest.executableName).sha256,program,executableLaunched:false}));

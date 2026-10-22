const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const pkg='D:\\Codex\\xjy-release-20261022\\candidate\\build\\package';
const binding=JSON.parse(fs.readFileSync(path.join(pkg,'engine-native170-binding.json'),'utf8'));
const pem=fs.readFileSync(path.join(pkg,'\u53d7\u4fe1\u52a9\u624b','publisher-public.pem'),'utf8');
const key=crypto.createPublicKey(pem);
const env=binding.native.targetEnvelope;
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const catBuf=Buffer.from(env.catalog,'utf8');
const sigOk=crypto.verify(null,catBuf,key,Buffer.from(env.signature,'base64'));
const cat=JSON.parse(env.catalog);
const pins={catalogSha256:sha(catBuf),trustCatalogSha256:binding.native.trust.target.catalogSha256,
 publicationEngineTreeSha256:binding.native.publication.engineTreeSha256,
 sigOk,version:cat.version,app:cat.app,platform:cat.platform,arch:cat.arch,sequence:cat.sequence,
 filesCount:cat.files.length,archive:cat.archive,expiresAt:cat.expiresAt,publishedAt:cat.publishedAt};
// compare engine tree on disk
const dir=path.join(pkg,'\u5b8c\u6574\u7a0b\u5e8f');
const onDisk=[];
function walk(d,rel){for(const e of fs.readdirSync(d,{withFileTypes:true})){const r=rel?rel+'/'+e.name:e.name;if(e.isDirectory())walk(path.join(d,e.name),r);else onDisk.push(r);}}
walk(dir,'');
const catSet=new Set(cat.files.map(f=>f.path));
const missing=[],extra=[],mismatch=[];
for(const f of cat.files){ if(!onDisk.includes(f.path))missing.push(f.path); }
for(const r of onDisk){ if(!catSet.has(r))extra.push(r); }
for(const f of cat.files){
  const p=path.join(dir,f.path.split('/').join(path.sep));
  let st; try{st=fs.statSync(p);}catch{continue;}
  if(st.size!==f.size){mismatch.push({path:f.path,why:'size',expected:f.size,actual:st.size});continue;}
  const h=sha(fs.readFileSync(p));
  if(h!==f.sha256)mismatch.push({path:f.path,why:'sha',expected:f.sha256,actual:h});
}
console.log(JSON.stringify({pins,onDiskCount:onDisk.length,missingCount:missing.length,extraCount:extra.length,mismatchCount:mismatch.length,missing:missing.slice(0,10),extra:extra.slice(0,10),mismatch:mismatch.slice(0,5)},null,1));
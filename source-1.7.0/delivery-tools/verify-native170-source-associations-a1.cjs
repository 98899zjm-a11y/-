'use strict';
// Data-only verification of fixed E: frozen candidates; no product imports,
// process launches, signing, production directory or private-key access.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT='E:/codex/2026-10-15/work/xjy-v16-deep-audit',OUT=path.join(ROOT,'release-work/native170-source-materials-a1');
const OLD='E:/codex/2026-10-13/work/xjy-web-stage1';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const state=s=>[s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs,s.nlink].join(':');
function check(file,directory=false){const resolved=path.resolve(file);if(!/^[Ee]:[\\/]/.test(resolved))throw Error('Fixed E: inputs only');for(let p=resolved;;p=path.dirname(p)){const s=fs.lstatSync(p,{bigint:true});if(s.isSymbolicLink()||fs.realpathSync.native(p).toLowerCase()!==p.toLowerCase())throw Error('Link/alias rejected');if(p===resolved&&(directory?!s.isDirectory():!s.isFile()||s.nlink!==1n))throw Error('Ordinary file/directory required');if(p===path.dirname(p))break;}return fs.lstatSync(resolved,{bigint:true});}
function raw(file){const before=check(file);if(before.size>4194304n)throw Error('Metadata bound');const b=fs.readFileSync(file);if(state(before)!==state(check(file)))throw Error('Metadata changed');return b;}
function digest(file){const before=check(file),fd=fs.openSync(file,'r'),h=crypto.createHash('sha256'),buffer=Buffer.alloc(4194304);try{if(state(before)!==state(fs.fstatSync(fd,{bigint:true})))throw Error('Opened identity changed');for(;;){const n=fs.readSync(fd,buffer,0,buffer.length,null);if(!n)break;h.update(buffer.subarray(0,n));}if(state(before)!==state(check(file))||state(before)!==state(fs.fstatSync(fd,{bigint:true})))throw Error('Frozen input changed');return{size:Number(before.size),sha256:h.digest('hex')};}finally{fs.closeSync(fd);}}
function list(directory,prefix=''){check(directory,true);const result=[];for(const name of fs.readdirSync(directory)){const file=path.join(directory,name),s=fs.lstatSync(file);if(s.isSymbolicLink())throw Error('Link rejected');if(s.isDirectory())result.push(...list(file,prefix+name+'/'));else{check(file);result.push(prefix+name);}}return result.sort();}
function equal(a,b,message){if(JSON.stringify(a)!==JSON.stringify(b))throw Error(message);}
function tuples(files){return files.map(({path:name,size,sha256})=>({path:name,size,sha256})).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);}
function verify(){
 const indexRaw=raw(path.join(OUT,'materials-index.json'));if(sha(indexRaw)!=='274d9a8a08c642b88366dff22bf564c13f0abb23ec8b556a75226c885428ce07')throw Error('Prepared index pin changed');
 const zipProofRaw=raw(path.join(OUT,'archive-readback.json'));if(sha(zipProofRaw)!=='b16c86198b8ff3cda58eeb870a7f7636dc0528e353cbb92cf99981ecde962d37'||JSON.parse(zipProofRaw).complete!==true)throw Error('Independent ZIP readback missing');
 const index=JSON.parse(indexRaw),publicKey=crypto.createPublicKey(raw(path.join(OUT,'publisher-public.pem')));
 if(sha(publicKey.export({type:'spki',format:'der'}))!=='6e8b9cadb59aeb53f30d41f4471f70f644f0dfc7376ffb9d8a4c62defb98458c')throw Error('Publisher pin changed');
 const report={purpose:'version-specific-frozen-full-program-association',materialsIndexSha256:sha(indexRaw),zipReadbackSha256:sha(zipProofRaw),signed:false,programExecuted:false,productionRead:false,guestAccessed:false,sources:[]};
 for(const source of index.sources){
  const catalogRaw=raw(path.join(OUT,source.catalogFile));if(sha(catalogRaw)!==source.catalogSha256)throw Error('Catalog pin changed');const catalog=JSON.parse(catalogRaw),expected=tuples(catalog.files);let sourceFiles,association;
  if(source.version==='1.6.0'){
   const directory=path.join(OLD,'sandbox/input/package-v10/release-candidate'),extras=['engine-allowlist.json','release-manifest.json'];
   equal(list(directory),[...expected.map(f=>f.path),...extras].sort(),'Frozen160 candidate member set differs');
   const provenance=path.join(OLD,'sandbox/input/package-v10/package-manifest.json'),provenanceHash=digest(provenance);if(provenanceHash.sha256!=='832328a00d26c4e905eb49a1ead21b9b9f1db677d4959cdbcbc8c6d5166dc8a8')throw Error('Frozen160 package provenance differs');
   if(JSON.parse(raw(path.join(directory,'release-manifest.json'))).programVersion!=='1.6.0')throw Error('Frozen160 version differs');
   sourceFiles=expected.map(f=>({row:f,file:path.join(directory,...f.path.split('/'))}));association={physicalRoot:directory,physicalFiles:1081,deliveryMetadataExcluded:extras.map(name=>({path:name,...digest(path.join(directory,name))})),provenanceManifest:provenance,provenanceManifestSha256:provenanceHash.sha256,scope:'1079 program members in frozen160 v10 candidate plus 2 known delivery metadata files; not a production installation read'};
  }else{
   const packageName=source.version==='1.6.1'?'initial-fresh-employee-package-a1':'initial-fresh-employee-162-package-a4',directory=path.join(ROOT,'release-work',packageName,'安装文件'),engine=path.join(directory,'engine');
   equal(list(engine),expected.filter(f=>!f.path.startsWith('resources/')).map(f=>f.path).sort(),'Version-specific engine members differ');equal(list(path.join(directory,'resources')).map(n=>'resources/'+n).sort(),expected.filter(f=>f.path.startsWith('resources/')).map(f=>f.path).sort(),'Version-specific resource members differ');
   const envelopeRaw=raw(path.join(directory,'catalog-envelope.json')),envelope=JSON.parse(envelopeRaw);if(Object.keys(envelope).length!==2||!crypto.verify(null,Buffer.from(envelope.catalog),publicKey,Buffer.from(envelope.signature,'base64')))throw Error('Version-specific fresh public signature rejected');const original=JSON.parse(envelope.catalog);
   if(original.version!==source.version||original.files.length!==1007)throw Error('Fresh version differs');equal(tuples(original.files),expected.filter(f=>f.path.startsWith('resources/')),'Fresh signed resource file table differs');
   const trustPath=path.join(directory,'../安装组件/delivery-tools/fresh-employee-trust.json'),trustRaw=raw(trustPath),trust=JSON.parse(trustRaw);if(trust.targetVersion!==source.version||trust.engineVersion!=='44.7.0'||trust.engineFiles.length!==72)throw Error('Fresh trust version differs');equal(tuples(trust.engineFiles),expected.filter(f=>!f.path.startsWith('resources/')),'Fresh engine trust file table differs');
   sourceFiles=expected.map(f=>({row:f,file:f.path.startsWith('resources/')?path.join(directory,...f.path.split('/')):path.join(engine,...f.path.split('/'))}));association={physicalRoot:directory,programFiles:1079,layout:'engine/72 + resources/1007',trustPath,trustSha256:sha(trustRaw),signedResourceEnvelopeSha256:sha(envelopeRaw),signedResourcePayloadSha256:sha(Buffer.from(envelope.catalog)),signedResourceSequence:original.sequence,originalPublicSignatureVerified:true,preparedResourcePublicationSequence:catalog.sequence,scope:'Version-specific original fresh split package; not a production installation read'};
  }
  for(const {row,file}of sourceFiles){const actual=digest(file);if(actual.size!==row.size||actual.sha256!==row.sha256)throw Error('Version-specific bytes differ: '+source.version+' '+row.path);}
  report.sources.push({version:source.version,programFilesCompared:1079,allProgramBytesMatchPreparedCatalog:true,programTreeSha256:source.programTreeSha256,...association});
 }
 report.complete=true;const result=Buffer.from(JSON.stringify(report,null,2)+'\n'),output=path.join(OUT,'source-association-readback.json'),fd=fs.openSync(output,'wx',0o600);try{fs.writeFileSync(fd,result);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}if(sha(raw(output))!==sha(result))throw Error('Report readback changed');process.stdout.write(JSON.stringify({complete:true,sources:report.sources.length,programFilesCompared:3237,reportSha256:sha(result),programExecuted:false})+'\n');
}
if(require.main===module){try{verify();}catch(error){process.stderr.write(error.stack+'\n');process.exitCode=1;}}
module.exports={verify};

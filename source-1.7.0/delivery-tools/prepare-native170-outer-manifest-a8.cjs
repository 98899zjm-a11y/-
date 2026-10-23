'use strict';
// Data-only detached descriptor preparation. Never imports product code, signs,
// reads private keys, runs EXEs, invokes Guest, publishes, or changes the ZIP.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const {Writable,Readable}=require('node:stream'),{pipeline}=require('node:stream/promises');
const ROOT='E:/codex/2026-10-15/work/xjy-v16-deep-audit',A8=path.join(ROOT,'release-work/native170-package-closure-a8');
const ARCHIVE=path.join(A8,'build/native-package.zip'),ASSEMBLY=path.join(A8,'build/assembly.json'),OUT=path.join(A8,'native-publication');
const PUBLISHER='6e8b9cadb59aeb53f30d41f4471f70f644f0dfc7376ffb9d8a4c62defb98458c',SHA=/^[a-f0-9]{64}$/;
const MAX_ARCHIVE=1610612736,MAX_EXPANDED=3221225472,MAX_FILES=8192,MAX_CENTRAL=4194304,MAX_PAYLOAD=2097152;
const BINDING='engine-native170-binding.json',WRAPPER='安装组件/native-delivery-170.ps1',WORKER='受信助手/鑫金源珠宝报价.exe';
const RESOURCE='补丁文件/catalog-envelope.json',POLICY='补丁文件/source-policy-envelope.json',PEM='补丁文件/publisher-public.pem';
const CAPTURE=new Set([BINDING,RESOURCE,POLICY,PEM,'首次安装材料/catalog-envelope.json','首次安装材料/publisher-public.pem']);
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function fail(code,message){throw Object.assign(Error(message),{code});}
function exact(v,keys){return v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));}
function safe(name){return typeof name==='string'&&name.length>0&&name.length<=240&&!/[\\:*?"<>|\x00-\x1f]/.test(name)&&!name.startsWith('/')&&name.split('/').every(p=>p&&p!=='.'&&p!=='..'&&!/[. ]$/.test(p)&&!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p));}
function state(s){return[s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs,s.nlink].join(':');}
function ordinary(file,directory=false){file=path.resolve(file);if(!file.toLowerCase().startsWith(path.resolve(ROOT).toLowerCase()+path.sep))fail('FIXED_INPUT_SCOPE',file);for(let p=file;;p=path.dirname(p)){const s=fs.lstatSync(p,{bigint:true});if(s.isSymbolicLink()||fs.realpathSync.native(p).toLowerCase()!==p.toLowerCase())fail('ALIAS_REJECTED',p);if(p===file&&(directory?!s.isDirectory():!s.isFile()||s.nlink!==1n))fail('ORDINARY_REQUIRED',p);if(p===path.dirname(p))break;}return file;}
function handleUnchanged(file,fd,before){ordinary(file);const after=fs.fstatSync(fd,{bigint:true}),other=fs.openSync(file,'r');try{const reopened=fs.fstatSync(other,{bigint:true});if(!after.isFile()||!reopened.isFile()||after.nlink!==1n||reopened.nlink!==1n||state(before)!==state(after)||state(before)!==state(reopened))fail('INPUT_CHANGED',file);}finally{fs.closeSync(other);}}
function bytes(file,max=4194304){ordinary(file);const fd=fs.openSync(file,'r');try{const before=fs.fstatSync(fd,{bigint:true});if(!before.isFile()||before.nlink!==1n||before.size>BigInt(max))fail('METADATA_BOUND',file);const b=readAt(fd,0,Number(before.size));handleUnchanged(file,fd,before);return b;}finally{fs.closeSync(fd);}}
function pin(file,expected){if(!SHA.test(expected||''))fail('PIN_REQUIRED',file);const b=bytes(file);if(hash(b)!==expected)fail('INPUT_PIN_CHANGED',file);return b;}
function readAt(fd,at,size){const b=Buffer.alloc(size);let done=0;while(done<size){const n=fs.readSync(fd,b,done,size-done,at+done);if(!n)fail('ZIP_TRUNCATED','ZIP read incomplete');done+=n;}return b;}
const CRC=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);return c>>>0;});
function crcStep(value,data){for(const b of data)value=(value>>>8)^CRC[(value^b)&255];return value>>>0;}
function rows(files){const result=files.map(f=>({path:f.path,size:f.size,sha256:f.sha256})).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);if(new Set(result.map(f=>f.path.toLowerCase())).size!==result.length||result.some(f=>!safe(f.path)||!Number.isSafeInteger(f.size)||f.size<0||f.size>MAX_ARCHIVE||!SHA.test(f.sha256||'')))fail('BAD_ROWS','Invalid complete ZIP file rows');return result;}
function parseCentral(central,count,dirAt){
 const result=[],seen=new Set(),utf8=new TextDecoder('utf8',{fatal:true});let at=0,total=0;
 for(let i=0;i<count;i++){
  if(at+46>central.length||central.readUInt32LE(at)!==0x02014b50)fail('BAD_ZIP','Central directory truncated');
  const flags=central.readUInt16LE(at+8),method=central.readUInt16LE(at+10),crc=central.readUInt32LE(at+16),packed=central.readUInt32LE(at+20),size=central.readUInt32LE(at+24),n=central.readUInt16LE(at+28),extra=central.readUInt16LE(at+30),comment=central.readUInt16LE(at+32),attrs=central.readUInt32LE(at+38),localAt=central.readUInt32LE(at+42),end=at+46+n+extra+comment;
  if(!n||end>central.length||extra||comment||flags!==0x800||![0,8].includes(method)||central.readUInt16LE(at+34)||attrs&0x10||![0,0x8000].includes((attrs>>>16)&0xf000)||localAt+30>dirAt||size>MAX_ARCHIVE)fail('BAD_ZIP','Only exact UTF8 ordinary ZIP32 files without descriptors/extras');
  let name;try{name=utf8.decode(central.subarray(at+46,at+46+n));}catch{fail('BAD_ZIP','Filename UTF8 rejected');}
  if(!safe(name)||seen.has(name.toLowerCase())||/(?:^|\/)(?:native-manifest(?:-payload|-envelope)?\.json|signing-request\.json)$/i.test(name))fail('BAD_ZIP','Unsafe/duplicate/detached-manifest ZIP member');
  seen.add(name.toLowerCase());total+=size;if(total>MAX_EXPANDED)fail('ZIP_EXPANDED_LIMIT','Expanded ZIP exceeds native3GiB');
  result.push({path:name,size,packed,crc,flags,method,localAt,nameBytes:Buffer.from(central.subarray(at+46,at+46+n))});at=end;
 }
 if(at!==central.length)fail('BAD_ZIP','Trailing central bytes');return result;
}
async function scanZip(file,expectedSha){
 if(!SHA.test(expectedSha||''))fail('ARCHIVE_PIN_REQUIRED','Exact final native ZIP SHA');ordinary(file);const fd=fs.openSync(file,'r');
 try{
  const before=fs.fstatSync(fd,{bigint:true}),length=Number(before.size);if(!before.isFile()||before.nlink!==1n||length<22||length>MAX_ARCHIVE)fail('ZIP_ARCHIVE_LIMIT','Native ZIP outside1.5GiB limit');
  const archiveHash=crypto.createHash('sha256'),buffer=Buffer.alloc(4194304);for(let at=0;at<length;){const n=fs.readSync(fd,buffer,0,Math.min(buffer.length,length-at),at);if(!n)fail('ZIP_TRUNCATED','Archive read failed');archiveHash.update(buffer.subarray(0,n));at+=n;}const archiveSha256=archiveHash.digest('hex');if(archiveSha256!==expectedSha)fail('ARCHIVE_PIN_CHANGED','Final ZIP SHA differs');
  const end=readAt(fd,length-22,22),count=end.readUInt16LE(10),dirSize=end.readUInt32LE(12),dirAt=end.readUInt32LE(16);
  if(end.readUInt32LE(0)!==0x06054b50||end.readUInt16LE(4)||end.readUInt16LE(6)||end.readUInt16LE(20)||!count||count>MAX_FILES||count!==end.readUInt16LE(8)||dirSize>MAX_CENTRAL||dirAt+dirSize!==length-22)fail('BAD_ZIP','Exact EOCD/ZIP32 bounds required');
  const entries=parseCentral(readAt(fd,dirAt,dirSize),count,dirAt),captures=new Map(),files=[],ranges=[];
  for(const e of entries){
   const local=readAt(fd,e.localAt,30),nameSize=local.readUInt16LE(26),extra=local.readUInt16LE(28),dataAt=e.localAt+30+nameSize+extra;
   if(local.readUInt32LE(0)!==0x04034b50||extra||local.readUInt16LE(6)!==e.flags||local.readUInt16LE(8)!==e.method||local.readUInt32LE(14)!==e.crc||local.readUInt32LE(18)!==e.packed||local.readUInt32LE(22)!==e.size||nameSize!==e.nameBytes.length||dataAt+e.packed>dirAt||!readAt(fd,e.localAt+30,nameSize).equals(e.nameBytes))fail('BAD_ZIP','Local header differs from central');
   if(e.method===0&&e.packed!==e.size||ranges.some(([a,b])=>e.localAt<b&&dataAt+e.packed>a))fail('BAD_ZIP','ZIP file ranges overlap or STORE sizes differ');ranges.push([e.localAt,dataAt+e.packed]);
   if(CAPTURE.has(e.path)&&e.size>4194304)fail('CAPTURE_BOUND',e.path);
   let got=0,crc=0xffffffff;const h=crypto.createHash('sha256'),chunks=[];
   const sink=new Writable({write(chunk,_encoding,done){got+=chunk.length;if(got>e.size)return done(Object.assign(Error('Inflation exceeds signed row'),{code:'ZIP_INFLATION_LIMIT'}));h.update(chunk);crc=crcStep(crc,chunk);if(CAPTURE.has(e.path))chunks.push(Buffer.from(chunk));done();}});
   const source=Readable.from((async function*(){for(let at=0;at<e.packed;at+=4194304)yield readAt(fd,dataAt+at,Math.min(4194304,e.packed-at));})());
   if(e.method===8)await pipeline(source,zlib.createInflateRaw(),sink);else await pipeline(source,sink);
   if(got!==e.size||((crc^0xffffffff)>>>0)!==e.crc)fail('BAD_ZIP','File length/CRC differs');files.push({path:e.path,size:got,sha256:h.digest('hex')});if(CAPTURE.has(e.path))captures.set(e.path,Buffer.concat(chunks));
  }
  const ordered=ranges.sort((a,b)=>a[0]-b[0]);let finish=0;for(const [start,endAt]of ordered){if(start!==finish)fail('BAD_ZIP','ZIP prepended/gap bytes rejected');finish=endAt;}if(finish!==dirAt)fail('BAD_ZIP','Unbound bytes before central directory');
  handleUnchanged(file,fd,before);return{archive:{size:length,sha256:archiveSha256},files:rows(files),captures};
 }finally{fs.closeSync(fd);}
}
function signed(envelope,field,key){if(!exact(envelope,[field,'signature'])||typeof envelope[field]!=='string'||typeof envelope.signature!=='string'||!/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature))fail('INTERNAL_SIGNATURE_REQUIRED','Exact internal signed envelope');const signature=Buffer.from(envelope.signature,'base64');if(signature.toString('base64')!==envelope.signature||signature.length!==64||!crypto.verify(null,Buffer.from(envelope[field]),key,signature))fail('INTERNAL_SIGNATURE_REQUIRED','Actual original-publisher signature required');return{value:JSON.parse(envelope[field]),sha256:hash(Buffer.from(envelope[field]))};}
function validateInternals(scan){
 const get=name=>{const data=scan.captures.get(name);if(!data)fail('MISSING_INTERNAL',name);return data;},bindingBytes=get(BINDING),binding=JSON.parse(bindingBytes),pem=get(PEM),key=crypto.createPublicKey(pem);
 if(key.asymmetricKeyType!=='ed25519'||hash(key.export({type:'spki',format:'der'}))!==PUBLISHER||!pem.equals(get('首次安装材料/publisher-public.pem'))||!get(RESOURCE).equals(get('首次安装材料/catalog-envelope.json')))fail('PUBLISHER_CHANGED','Original publisher or duplicated resource envelope differs');
 if(binding.schemaVersion!==1||binding.purpose!=='xjy-engine-native-binding170'||!binding.native)fail('BAD_BINDING','Native binding schema rejected');const n=binding.native;
 if(!exact(n.paths,['artifactDir','archiveFile','engineArtifactDir','workerRoot'])||n.paths.artifactDir!=='补丁文件'||n.paths.archiveFile!=='鑫金源珠宝1.7.0员工升级补丁.zip'||n.paths.engineArtifactDir!=='完整程序'||n.paths.workerRoot!=='受信助手')fail('BAD_BINDING','Fixed native package paths required');
 const target=signed(n.targetEnvelope,'catalog',key),worker=signed(n.workerEnvelope,'catalog',key),resource=signed(JSON.parse(get(RESOURCE)),'catalog',key),policy=signed(JSON.parse(get(POLICY)),'policy',key);
 for(const [which,catalog,seq]of [['target',target.value,16],['worker',worker.value,16],['resource',resource.value,15]])if(catalog.schemaVersion!==1||catalog.app!=='xjy-jewelry-offline'||catalog.version!=='1.7.0'||catalog.platform!=='win32'||catalog.arch!=='x64'||catalog.sequence!==seq||!Array.isArray(catalog.files)||!Number.isFinite(Date.parse(catalog.expiresAt))||Date.parse(catalog.expiresAt)<=Date.now())fail('BAD_INTERNAL_CATALOG',which);
 if(target.value.files.length!==1079||resource.value.files.length!==1007||policy.value.schemaVersion!==1||policy.value.purpose!=='xjy-repeat-program-patch'||policy.value.targetVersion!=='1.7.0'||policy.value.catalogSha256!==resource.sha256)fail('BAD_INTERNAL_POLICY','Legacy host policy/resource/target identity differs');
 const actual=new Map(scan.files.map(f=>[f.path,f]));function requireRow(name,row){const got=actual.get(name);if(!got||got.size!==row.size||got.sha256!==row.sha256)fail('INTERNAL_TREE_MISMATCH',name);}
 for(const f of rows(target.value.files)){requireRow('完整程序/'+f.path,f);requireRow('首次安装材料/'+(f.path.startsWith('resources/')?f.path:'engine/'+f.path),f);}
 for(const f of rows(worker.value.files))requireRow('受信助手/'+f.path,f);for(const f of rows(resource.value.files))requireRow('补丁文件/payload/'+f.path,f);for(const f of rows(policy.value.tools))requireRow('补丁文件/'+f.path,f);
 const p=n.publication,artifact=actual.get('鑫金源珠宝1.7.0员工升级补丁.zip');if(!p||p.targetVersion!=='1.7.0'||p.targetEngineVersion!=='44.9.0'||p.engineTreeSha256!==target.sha256||p.publicationId!==resource.sha256||p.sourcePolicySha256!==policy.sha256||p.publisherPublicKeySha256!==PUBLISHER||!artifact||p.artifactSha256!==artifact.sha256||n.workerCatalogSha256!==worker.sha256||n.trust?.target?.catalogSha256!==target.sha256||n.trust?.target?.engineVersion!=='44.9.0')fail('BAD_BINDING','Signed publication/binding relationship differs');
 for(const name of [WRAPPER,BINDING,WORKER,'受信助手/delivery-tools/engine-native-entry170.cjs','delivery-tools/XjyWorkerResult.ps1'])if(!actual.has(name))fail('MISSING_FIXED_ENTRY',name);
 const engine=actual.get(WORKER);if(engine.size!==246302720||engine.sha256!=='db3ad2066a55546f9b6737da3c7f011370e4856fb36888055b544d45653e4f40')fail('WORKER_ENGINE_CHANGED','External maintenance engine44.7 bytes differ');
 return{bindingSha256:hash(bindingBytes),fullTargetCatalogSha256:target.sha256,sequence:target.value.sequence,internalSignaturesVerified:4,resourceCatalogSha256:resource.sha256,workerCatalogSha256:worker.sha256,sourcePolicySha256:policy.sha256};
}
function makePayload(scan,internal,publishedAt,expiresAt,now=Date.now()){
 const published=Date.parse(publishedAt),expires=Date.parse(expiresAt);if(typeof publishedAt!=='string'||typeof expiresAt!=='string'||!Number.isFinite(published)||!Number.isFinite(expires)||published>now+300000||expires<=now||expires<=published||internal.sequence!==16)fail('BAD_PUBLICATION_TIME','Explicit valid publication times and seq16 required');
 if(!SHA.test(internal.fullTargetCatalogSha256||'')||!SHA.test(internal.bindingSha256||'')||!exact(scan.archive,['size','sha256'])||!Number.isSafeInteger(scan.archive.size)||scan.archive.size<22||scan.archive.size>MAX_ARCHIVE||!SHA.test(scan.archive.sha256||'')||!Array.isArray(scan.files)||scan.files.length<1||scan.files.length>MAX_FILES||scan.files.reduce((n,f)=>n+f.size,0)>MAX_EXPANDED)fail('BAD_OUTER_INPUT','Exact native archive/binding/target limits required');
 const payload={schemaVersion:1,purpose:'xjy-native-employee-update-v1',app:'xjy-jewelry-offline',platform:'win32',arch:'x64',role:'employee',targetVersion:'1.7.0',engineVersion:'44.9.0',sequence:16,publishedAt,expiresAt,fullTargetCatalogSha256:internal.fullTargetCatalogSha256,bindingSha256:internal.bindingSha256,archive:{size:scan.archive.size,sha256:scan.archive.sha256},files:rows(scan.files)};
 const raw=Buffer.from(JSON.stringify(payload,null,2)+'\n');if(raw.length>MAX_PAYLOAD)fail('OUTER_DESCRIPTOR_LIMIT','Native manifest exceeds2MiB');return{payload,raw};
}
function put(file,data){ordinary(path.dirname(file),true);const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,data);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}if(!bytes(file).equals(data))fail('OUTPUT_READBACK',file);}
async function prepare({archiveSha256,assemblySha256,publishedAt,expiresAt}){
 if(fs.existsSync(OUT))fail('OUTPUT_EXISTS','CreateNew detached publication required');const assemblyBytes=pin(ASSEMBLY,assemblySha256),assembly=JSON.parse(assemblyBytes),scan=await scanZip(ARCHIVE,archiveSha256),internal=validateInternals(scan);
 if(assembly.archive?.sha256!==scan.archive.sha256||assembly.archive?.size!==scan.archive.size||assembly.bindingSha256!==internal.bindingSha256||JSON.stringify(rows(assembly.files))!==JSON.stringify(scan.files))fail('ASSEMBLY_DIFFERS','Scanned final ZIP differs from Root-pinned build assembly');
 const result=makePayload(scan,internal,publishedAt,expiresAt);ordinary(A8,true);fs.mkdirSync(OUT);ordinary(OUT,true);put(path.join(OUT,'native-manifest-payload.json'),result.raw);
 const request={schemaVersion:1,purpose:'native170-detached-employee-manifest-signing-request',field:'manifest',payloadFile:'native-manifest-payload.json',payloadSha256:hash(result.raw),payloadSize:result.raw.length,manifestPurpose:result.payload.purpose,sequence:16,fullTargetCatalogSha256:internal.fullTargetCatalogSha256,bindingSha256:internal.bindingSha256,archive:scan.archive,publisherPublicKeySha256:PUBLISHER,expectedEnvelopeFile:'native-manifest.json',signed:false,independentNewAuthorizationRequired:true,privateKeyRead:false,programExecuted:false,published:false,detachedFromZip:true,archiveMustRemainUnchanged:true,archiveRebuildRequired:false,signatureScope:'Exact raw manifest payload bytes only; four internally signed payloads remain unchanged',preparationToolSha256:hash(bytes(__filename)),assemblySha256,internalVerification:internal};
 put(path.join(OUT,'signing-request.json'),Buffer.from(JSON.stringify(request,null,2)+'\n'));process.stdout.write(JSON.stringify({directory:OUT,payloadSha256:request.payloadSha256,archiveSha256:scan.archive.sha256,files:scan.files.length,internalSignaturesVerified:4,signed:false,published:false,zipModified:false})+'\n');
}
if(require.main===module){const args=process.argv.slice(2),names=['--archive-sha256','--assembly-sha256','--published-at','--expires-at'];if(args.length!==8||!names.every((n,i)=>args[i*2]===n)){process.stderr.write('USAGE: --archive-sha256 SHA --assembly-sha256 SHA --published-at ISO --expires-at ISO\n');process.exitCode=1;}else prepare({archiveSha256:args[1],assemblySha256:args[3],publishedAt:args[5],expiresAt:args[7]}).catch(e=>{process.stderr.write((e.code||'FAILED')+': '+e.message+'\n');process.exitCode=1;});}
module.exports={safe,rows,parseCentral,scanZip,signed,validateInternals,makePayload,prepare};

'use strict';
// SOURCE_ONLY Guest contracts. No EXE/business launch; Root reviews/runs.
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),crypto=require('node:crypto');
const fs=process.versions.electron?require('original-fs'):require('node:fs'),io=fs.promises;
const ROOT=path.resolve(__dirname,'..'),GUEST='C:\\xjy-work\\xjy-web-stage1';
if(process.platform!=='win32'||ROOT.toLowerCase()!==GUEST.toLowerCase())throw Error('Fixed actual Guest required; no Host test/import');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
for(const [relative,expected]of Object.entries({
 'stage1/sandbox-context.py':'09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249',
 'stage1/validate-sandbox-context.py':'867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207'
}))assert.equal(hash(fs.readFileSync(path.join(ROOT,relative))),expected,'Original actual guard changed');
const PYTHON='C:/Python314/python.exe';
assert.equal(hash(fs.readFileSync(PYTHON)),'434b361fe0c5960d404974feed493db47f2603a1ace2574312104fbed0182c6f');
const proof=JSON.parse(require('node:child_process').execFileSync(PYTHON,['-I','-B',path.join(ROOT,'stage1/validate-sandbox-context.py')],{cwd:ROOT,windowsHide:true,encoding:'utf8'}));
assert.equal(proof.model,'Virtual Machine');assert.equal(proof.productionDrivePresent,false);assert.equal(proof.nonLoopbackAddressCount,0);assert.equal(proof.inputMarkerPresent,true);

const core=require('../delivery-tools/initial-patch-core.cjs'),u=require('../project/desktop/employee-update-cache.cjs');
const {asar}=require('../tests/employee-update-fixtures.cjs');
const SUBJECT=path.join(ROOT,'delivery-tools/fresh-employee-install.cjs');
function subject(){
 if(!fs.existsSync(SUBJECT))throw Object.assign(Error('FRESH_EMPLOYEE_INSTALL_FEATURE_MISSING: planned tool not implemented'),{code:'FRESH_EMPLOYEE_INSTALL_FEATURE_MISSING'});
 const api=require(SUBJECT);assert.equal(typeof api.installFreshEmployee,'function','Actual installer export required');return api.installFreshEmployee;
}
async function absent(file){try{await io.lstat(file);return false;}catch(e){if(e.code==='ENOENT')return true;throw e;}}
async function put(root,relative,bytes){const file=path.join(root,...relative.split('/'));await io.mkdir(path.dirname(file),{recursive:true});await io.writeFile(file,bytes,{flag:'wx'});return{path:relative,size:Buffer.byteLength(bytes),sha256:hash(bytes)};}
async function fixture(t){
 const parent=path.join(ROOT,'runtime/fresh-employee-install-tests');await io.mkdir(parent,{recursive:true});await u.assertPath(io,parent,{directory:true,root:ROOT});
 const root=await io.mkdtemp(path.join(parent,'case-'));
 t.after(async()=>{assert.equal(path.dirname(path.resolve(root)),parent);await u.assertPath(io,root,{directory:true,root:parent});await io.rm(root,{recursive:true,force:true});});
 const artifact=path.join(root,'package-data'),local=path.join(root,'local-app-data');await io.mkdir(artifact);await io.mkdir(local);
 const executableName='鑫金源珠宝报价.exe',engineFiles=[];
 engineFiles.push(await put(artifact,'engine/'+executableName,Buffer.from('MZ synthetic engine: never executed')));
 for(let i=0;i<71;i++)engineFiles.push(await put(artifact,'engine/engine-part-'+String(i).padStart(2,'0')+'.bin',Buffer.from('synthetic engine dependency '+i)));
 for(const f of engineFiles)f.path=f.path.slice('engine/'.length);
 const resources=[{path:'resources/app.asar',body:asar('1.6.1')},{path:'resources/print-dependencies/fixture.txt',body:Buffer.from('synthetic resource')}];
 const files=[];for(const f of resources)files.push(await put(artifact,f.path,f.body));
 const keys=crypto.generateKeyPairSync('ed25519'),pub=keys.publicKey.export({type:'spki',format:'pem'}),publicSha=hash(keys.publicKey.export({type:'spki',format:'der'})),now=Date.UTC(2026,9,16);
 await put(artifact,'publisher-public.pem',Buffer.from(pub));
 const catalog={schemaVersion:1,app:'xjy-jewelry-offline',channel:'stable',version:'1.6.1',sourceVersions:['1.6.0','1.6.1'],platform:'win32',arch:'x64',sequence:7,publishedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+86400000).toISOString(),archive:{size:22,sha256:'a'.repeat(64)},files};
 const sign=()=>{const raw=JSON.stringify(catalog);return{catalog:raw,signature:crypto.sign(null,Buffer.from(raw),keys.privateKey).toString('base64')};};
 await put(artifact,'catalog-envelope.json',Buffer.from(JSON.stringify(sign())));
 const trust=u.freeze({targetVersion:'1.6.1',executableName,publisherPublicKeySha256:publicSha,engineVersion:'44.7.0',engineFiles,allowedResourceFiles:files.map(f=>f.path)});
 const launches=[],installDir=path.join(local,'鑫金源珠宝','员工程序');
 const options={artifactDir:artifact,localAppData:local,trust,now:()=>now,launch:async request=>{launches.push(request);return{started:true};}};
 return{root,artifact,local,installDir,executableName,resources,files,trust,catalog,keys,sign,options,launches};
}

test('F01 existing release admission accepts a fresh employee161 marker and selects no Host database',()=>{
 const {admitRelease}=require('../project/desktop/release-admission.cjs'),{resolveReleaseStorage}=require('../project/desktop/release-storage.cjs');
 // Pure installed-policy input outside the development ancestry; no directory
 // is created there and no packaged Electron runtime is impersonated/launched.
 const synthetic=path.join('C:/xjy-results','fresh-employee-policy-'+crypto.randomUUID());
 const activation={version:1,product:'xjy-jewelry-offline',programVersion:'1.6.1',role:'employee',installationDir:synthetic};
 const admission=admitRelease({isPackaged:true,codeDir:path.join(synthetic,'resources/app.asar'),environment:{},activation,programVersion:'1.6.1'});
 assert.equal(admission.mode,'installed');assert.equal(admission.role,'employee');
 let employeeCalls=0;
 const storage=resolveReleaseStorage({admission,legacyProfile:synthetic,portableDirectory:synthetic,employeeStorage:input=>{employeeCalls++;assert.equal(input.employeeClient,true);return{root:synthetic,profileDir:synthetic,dataDir:null,employeeClient:true};}});
 assert.equal(employeeCalls,1);assert.equal(storage.dataDir,null);assert.equal(storage.employeeClient,true);assert.equal(fs.existsSync(synthetic),false);
 assert.throws(()=>admitRelease({isPackaged:true,codeDir:path.join(synthetic,'resources/app.asar'),environment:{},activation:{...activation,programVersion:'1.6.0'},programVersion:'1.6.1'}));
});

test('F02 new employee installation copies the complete declared engine/resources and writes exact activation before launch',async t=>{
 const install=subject(),f=await fixture(t),before=await core.inspectArtifactTree({artifactDir:f.artifact});
 const result=await install({...f.options,launch:async request=>{
  const marker=JSON.parse(await io.readFile(path.join(f.installDir,'xjy-install-activation.json')));
  assert.deepEqual(marker,{version:1,product:'xjy-jewelry-offline',programVersion:'1.6.1',role:'employee',installationDir:f.installDir});
  assert.equal((await core.packageIdentity(io,path.join(f.installDir,'resources/app.asar'),f.installDir)).version,'1.6.1');
  f.launches.push(request);return{started:true};
 }});
 assert.equal(result.installed,true);assert.equal(result.role,'employee');assert.equal(result.version,'1.6.1');assert.equal(result.installationDir,f.installDir);
 assert.deepEqual(f.launches,[{executablePath:path.join(f.installDir,f.executableName),args:['--employee-client'],role:'employee'}]);
 const actual=await core.inspectArtifactTree({artifactDir:f.installDir}),program=actual.files.filter(x=>x.path!=='xjy-install-activation.json');
 const expected=[...f.trust.engineFiles,...f.files];assert.equal(program.length,74);
 for(const file of expected){const copied=program.find(x=>x.path===file.path);assert.ok(copied,file.path);assert.equal(copied.size,file.size);assert.equal(copied.sha256,file.sha256);}
 assert.equal(actual.files.length,75,'No profile/DB/key/Host workspace is installed');
 assert.equal((await core.inspectArtifactTree({artifactDir:f.artifact})).sha256,before.sha256);
});

test('F03 any existing destination is refused without overwrite and fresh installation has no Host mode',async t=>{
 const install=subject();
 for(const kind of ['empty','employee','host']){
  const f=await fixture(t),target=path.join(f.root,'已有目录');await io.mkdir(target);
  if(kind!=='empty'){await put(target,'xjy-install-activation.json',Buffer.from(JSON.stringify({version:1,product:'xjy-jewelry-offline',programVersion:'1.6.0',role:kind,installationDir:target})));await put(target,'business-sentinel.txt',Buffer.from('KEEP ORIGINAL '+kind));}
  const before=await core.inspectArtifactTree({artifactDir:target});
  await assert.rejects(install({...f.options,installDir:target}),e=>e.code==='EXISTING_INSTALLATION');
  assert.equal((await core.inspectArtifactTree({artifactDir:target})).sha256,before.sha256);assert.deepEqual(f.launches,[]);
 }
});

test('F04 engine/resource/publisher/signature/extra-data failures stop before destination creation',async t=>{
 const install=subject();
 for(const fault of ['engine','resource','publisher','signature','extra-engine','activation','profile']){
  const f=await fixture(t);
  if(fault==='engine')await io.appendFile(path.join(f.artifact,'engine',f.executableName),'tamper');
  if(fault==='resource')await io.appendFile(path.join(f.artifact,'resources/app.asar'),'tamper');
  if(fault==='publisher')await io.writeFile(path.join(f.artifact,'publisher-public.pem'),crypto.generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'}));
  if(fault==='signature'){const envelope=f.sign();envelope.signature=Buffer.alloc(64).toString('base64');await io.writeFile(path.join(f.artifact,'catalog-envelope.json'),JSON.stringify(envelope));}
  if(fault==='extra-engine')await put(f.artifact,'engine/unapproved.dll',Buffer.from('extra'));
  if(fault==='activation')await put(f.artifact,'xjy-install-activation.json',Buffer.from('{}'));
  if(fault==='profile')await put(f.artifact,'profiles/credentials.json',Buffer.from('synthetic forbidden payload'));
  await assert.rejects(install(f.options));assert.equal(await absent(f.installDir),true,fault);assert.deepEqual(f.launches,[]);
 }
});

test('F05 new destination path/link/race and partial-copy failures never activate or launch',async t=>{
 const install=subject();
 for(const kind of ['alias','junction-parent','destination-race','copy-failure','selected-success']){
  const f=await fixture(t);let target=path.join(f.root,'selected-employee161'),fileSystem=io;
  if(kind==='alias')target=path.join(f.root,'unmade')+path.sep+'..'+path.sep+'alias-target';
  if(kind==='junction-parent'){const outside=path.join(f.root,'other-plain');await io.mkdir(outside);const junction=path.join(f.root,'junction');await io.symlink(outside,junction,'junction');target=path.join(junction,'new-install');}
  if(kind==='destination-race')fileSystem={...io,mkdir:async(file,...args)=>{if(path.resolve(file)===target&&await absent(target)){await io.mkdir(target);await put(target,'race-sentinel.txt',Buffer.from('do not overwrite'));}return io.mkdir(file,...args);}};
  if(kind==='copy-failure')fileSystem={...io,open:async(file,...args)=>{if(path.resolve(file)===path.join(target,'resources/app.asar')&&String(args[0]).includes('w'))throw Object.assign(Error('controlled disk failure'),{code:'EACCES'});return io.open(file,...args);}};
  const before=await core.inspectArtifactTree({artifactDir:f.artifact});
  if(kind==='selected-success'){
   const result=await install({...f.options,installDir:target,fileSystem});assert.equal(result.installed,true);assert.equal(result.installationDir,target);
   assert.equal(JSON.parse(await io.readFile(path.join(target,'xjy-install-activation.json'))).installationDir,target);assert.equal(f.launches.length,1);
  }else{
   await assert.rejects(install({...f.options,installDir:target,fileSystem}));assert.equal(await absent(path.join(target,'xjy-install-activation.json')),true);assert.deepEqual(f.launches,[]);
   if(kind==='destination-race')assert.equal(await io.readFile(path.join(target,'race-sentinel.txt'),'utf8'),'do not overwrite');
  }
  assert.equal((await core.inspectArtifactTree({artifactDir:f.artifact})).sha256,before.sha256);
 }
});

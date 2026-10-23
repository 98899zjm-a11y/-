'use strict';
// Guest-only supplement: actual fresh installer + frozen public fixture factory.
// Synthetic MZ/ASAR and RAM test key only; launch is explicit DI, never an EXE.
const fs=process.versions.electron?require('original-fs'):require('node:fs');
const path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm'),{createRequire}=require('node:module');
const ROOT=path.resolve(__dirname,'..'),sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
if(process.platform!=='win32'||ROOT.toLowerCase()!=='c:\\xjy-work\\xjy-web-stage1')throw Error('Fixed actual Guest required; no Host test/import');
function source(relative){const file=path.join(ROOT,...relative.split('/')),rel=path.relative(ROOT,file);if(rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))throw Error('Source escaped fixed Guest');for(let p=file;;p=path.dirname(p)){const stat=fs.lstatSync(p);if(stat.isSymbolicLink()||stat.isFile()&&stat.nlink!==1)throw Error('Ordinary reviewed source required');if(p===path.dirname(p))break;}const stat=fs.statSync(file);if(!stat.isFile()||stat.size>1024*1024)throw Error('Bounded reviewed source required');return fs.readFileSync(file);}
const SELF='audit-tools/fresh-employee-162-contract.test.cjs',SUBJECT='delivery-tools/fresh-employee-install.cjs';
const TEST_SHA=process.env.XJY_FRESH162_TEST_SHA256,SOURCE_SHA=process.env.XJY_FRESH162_SOURCE_SHA256;
for(const pin of [TEST_SHA,SOURCE_SHA])if(!/^[a-f0-9]{64}$/.test(pin||''))throw Error('Root-pinned test and actual installer SHA required');
if(sha(source(SELF))!==TEST_SHA||sha(source(SUBJECT))!==SOURCE_SHA)throw Error('Root-pinned fresh162 source changed');
const FROZEN='audit-tools/fresh-employee-install.test.cjs',FROZEN_SHA='51a193abadc91c630e52a120341482f625e39e7251ee9b2cfd033f3d743008bd';
const frozenBytes=source(FROZEN);if(sha(frozenBytes)!==FROZEN_SHA)throw Error('Frozen original fresh employee tests changed');
if(sha(source('tests/employee-update-fixtures.cjs'))!=='c8b7b124ea0523257c564161dcea18698ab8a0a00db9f73ebcb4fea333eab572')throw Error('Original public ASAR fixture helper changed');
const frozen=frozenBytes.toString('utf8'),marker="test('F01 existing release admission accepts a fresh employee161 marker and selects no Host database',()=>{";
const at=frozen.indexOf(marker),PRELUDE_SHA='59abbd9dacc4b122761489f51e43214c99b86b5513ea0fc32b55ff03147d4fc8';
if(at<1||frozen[at-1]!=='\n'||frozen.indexOf(marker,at+1)!==-1||sha(Buffer.from(frozen.slice(0,at)))!==PRELUDE_SHA)throw Error('Exact frozen admission/factory prelude required');
const loaded={exports:{}};
vm.runInNewContext(frozen.slice(0,at)+'\nmodule.exports={fixture,subject,absent,core,u,io,asar,proof};\n',{
 module:loaded,exports:loaded.exports,require:createRequire(path.join(ROOT,FROZEN)),__dirname,__filename:path.join(ROOT,FROZEN),
 process,Buffer,URL,URLSearchParams,TextEncoder,TextDecoder,setTimeout,clearTimeout,setInterval,clearInterval,console,
},{filename:path.join(ROOT,FROZEN)+'[admission-and-factory-only]'});
// Original prelude verifies Python/guard/validator and actual Guest before any
// installer import or fixture creation. Original F01-F05 are not registered.
const {fixture,subject,absent,core,u,io,asar,proof}=loaded.exports;
const test=require('node:test'),assert=require('node:assert/strict'),plain=value=>JSON.parse(JSON.stringify(value));
console.log(JSON.stringify({purpose:'fresh-employee-162-contract',testSha256:TEST_SHA,installerSourceSha256:SOURCE_SHA,frozenFactorySha256:FROZEN_SHA,preludeSha256:PRELUDE_SHA,actualContext:proof,methods:2,originalTestsRegistered:false,syntheticEngineOnly:true,launchIsExplicitDi:true,executableRun:false,databaseUsed:false}));

async function versionedFixture(t,targetVersion,catalogVersion,asarVersion){
 const f=await fixture(t),appBytes=asar(asarVersion),appFile=path.join(f.artifact,'resources/app.asar'),catalogFile=path.join(f.artifact,'catalog-envelope.json');
 await u.assertPath(io,appFile,{root:f.root});await u.assertPath(io,catalogFile,{root:f.root});
 await io.writeFile(appFile,appBytes);
 const files=f.files.map(file=>file.path==='resources/app.asar'?{path:file.path,size:appBytes.length,sha256:sha(appBytes)}:plain(file));
 const trust=u.freeze({...plain(f.trust),targetVersion}),catalog={...plain(f.catalog),version:catalogVersion,sourceVersions:[targetVersion],files};
 const raw=JSON.stringify(catalog),envelope={catalog:raw,signature:crypto.sign(null,Buffer.from(raw),f.keys.privateKey).toString('base64')};
 await io.writeFile(catalogFile,JSON.stringify(envelope));
 return{...f,files,trust,catalog,options:{...f.options,trust}};
}
async function completeProgram(f){
 const tree=await core.inspectArtifactTree({artifactDir:f.installDir}),expected=[...f.trust.engineFiles,...f.files];
 assert.equal(expected.length,74,'72 declared engine files plus two synthetic resources');
 assert.equal(tree.files.length,74,'Only the complete program may exist before activation');
 for(const item of expected){const copied=tree.files.find(file=>file.path===item.path);assert.ok(copied,item.path);assert.equal(copied.size,item.size,item.path);assert.equal(copied.sha256,item.sha256,item.path);}
 return tree;
}

test('F162 explicitly trusted162 catalog and ASAR install complete files before employee activation and only employee launch',async t=>{
 const install=subject(),f=await versionedFixture(t,'1.6.2','1.6.2','1.6.2'),before=await core.inspectArtifactTree({artifactDir:f.artifact});
 const marker='xjy-install-activation.json',writes=[];let activationOpens=0,programVerifiedBeforeActivation=false,result;
 const fileSystem={...io,open:async(file,flags,...args)=>{
  if(typeof file==='string'&&typeof flags==='string'&&/[wax+]/.test(flags)){
   const relative=path.relative(f.installDir,file);
   if(relative!==''&&relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative)){
    const name=relative.replaceAll('\\','/');
    if(name===marker){assert.equal(await absent(path.join(f.installDir,marker)),true);await completeProgram(f);programVerifiedBeforeActivation=true;activationOpens++;}
    writes.push(name);
   }
  }
  return io.open(file,flags,...args);
 }};
 await assert.doesNotReject(async()=>{result=await install({...f.options,fileSystem,launch:async request=>{
  assert.equal(programVerifiedBeforeActivation,true);assert.equal(activationOpens,1);assert.equal(writes.at(-1),marker);
  const activation=JSON.parse(await io.readFile(path.join(f.installDir,marker),'utf8'));
  assert.deepEqual(activation,{version:1,product:'xjy-jewelry-offline',programVersion:'1.6.2',role:'employee',installationDir:f.installDir});
  assert.equal((await core.packageIdentity(io,path.join(f.installDir,'resources/app.asar'),f.installDir)).version,'1.6.2');
  f.launches.push(plain(request));return{started:true};
 }});},'FRESH_EMPLOYEE_162_REQUIRED: explicitly trusted complete162 must install');
 assert.equal(result.installed,true);assert.equal(result.version,'1.6.2');assert.equal(result.role,'employee');assert.equal(result.launched,true);assert.equal(result.installationDir,f.installDir);
 assert.equal(programVerifiedBeforeActivation,true);assert.equal(activationOpens,1);assert.equal(writes.at(-1),marker);
 assert.deepEqual(plain(f.launches),[{executablePath:path.join(f.installDir,f.executableName),args:['--employee-client'],role:'employee'}]);
 const tree=await core.inspectArtifactTree({artifactDir:f.installDir});assert.equal(tree.files.length,75,'No profile, database or Host workspace may be added');
 assert.equal((await core.inspectArtifactTree({artifactDir:f.artifact})).sha256,before.sha256,'The synthetic package is unchanged');
 assert.equal(sha(source(SUBJECT)),SOURCE_SHA,'Actual installer changed during contract');
});

test('F163 future163 or trusted162 mismatching signed catalog or ASAR161 is refused before destination and launch',async t=>{
 const install=subject();
 for(const [label,target,catalog,app]of [['future163','1.6.3','1.6.3','1.6.3'],['catalog-and-asar161','1.6.2','1.6.1','1.6.1'],['asar161','1.6.2','1.6.2','1.6.1'],['catalog161','1.6.2','1.6.1','1.6.2']]){
  const f=await versionedFixture(t,target,catalog,app),before=await core.inspectArtifactTree({artifactDir:f.artifact});
  await assert.rejects(install(f.options),error=>label==='future163'?error.code==='BAD_TRUST':['BAD_TRUST','BAD_CATALOG','BAD_PROGRAM','SOURCE_UNSUPPORTED','DOWNGRADE_REJECTED'].includes(error.code),label);
  assert.equal(await absent(f.installDir),true,label+' must not create destination');assert.deepEqual(plain(f.launches),[],label+' cannot launch');
  assert.equal((await core.inspectArtifactTree({artifactDir:f.artifact})).sha256,before.sha256,label+' leaves source package unchanged');
 }
 assert.equal(sha(source(SUBJECT)),SOURCE_SHA,'Actual installer changed during contract');
});

'use strict';
// Guest-only supplement: actual fresh installer + frozen public fixture factory.
// Synthetic MZ/ASAR and RAM test key only; launch is explicit DI, never an EXE.
const fs=process.versions.electron?require('original-fs'):require('node:fs');
const path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm'),{createRequire}=require('node:module');
const ROOT=path.resolve(__dirname,'..'),sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
if(process.platform!=='win32'||ROOT.toLowerCase()!=='c:\\xjy-work\\xjy-web-stage1')throw Error('Fixed actual Guest required; no Host test/import');
function source(relative){const file=path.join(ROOT,...relative.split('/')),rel=path.relative(ROOT,file);if(rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))throw Error('Source escaped fixed Guest');for(let p=file;;p=path.dirname(p)){const stat=fs.lstatSync(p);if(stat.isSymbolicLink()||stat.isFile()&&stat.nlink!==1)throw Error('Ordinary reviewed source required');if(p===path.dirname(p))break;}const stat=fs.statSync(file);if(!stat.isFile()||stat.size>1024*1024)throw Error('Bounded reviewed source required');return fs.readFileSync(file);}
const SELF='audit-tools/fresh-employee-version-json.test.cjs',SUBJECT='delivery-tools/fresh-employee-install.cjs';
const TEST_SHA=process.env.XJY_FRESH_VERSION_JSON_TEST_SHA256,SOURCE_SHA=process.env.XJY_FRESH_VERSION_JSON_SOURCE_SHA256;
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
console.log(JSON.stringify({purpose:'fresh-employee-version-json-contract',testSha256:TEST_SHA,installerSourceSha256:SOURCE_SHA,frozenFactorySha256:FROZEN_SHA,preludeSha256:PRELUDE_SHA,actualContext:proof,methods:1,originalTestsRegistered:false,syntheticEngineOnly:true,launchIsExplicitDi:true,executableRun:false,databaseUsed:false}));

// Values become actual JSON before the real installer sees them. Undefined is
// represented only by omission. Boxed String is excluded: JSON makes it valid.
const VECTORS=[
 ['null-trust',null,true],['null-targetVersion',null],['missing-targetVersion',undefined],['number-1.62',1.62],['number-1.6',1.6],
 ['array-single',['1.6.2']],['array-two',['1.6.1','1.6.2']],['object-version',{version:'1.6.2'}],
 ['empty',''],['space',' '],['tab-newline','\t\n'],
 ['leading-space',' 1.6.2'],['trailing-space','1.6.2 '],['both-spaces',' 1.6.2 '],
 ['leading-nbsp','\u00a01.6.2'],['trailing-nbsp','1.6.2\u00a0'],['surrounding-nbsp','\u00a01.6.2\u00a0'],['tab-and-newline','\t1.6.2\n'],
 ['short-version','1.6'],['extra-component161','1.6.1.0'],['extra-component162','1.6.2.0'],
 ['prefix1610','1.6.10'],['prefix1620','1.6.20'],['future163','1.6.3'],['old160','1.6.0'],['old150','1.5.0'],
 ['zero-major','01.6.1'],['zero-minor','1.06.2'],['zero-patch','1.6.01'],
 ['lower-v','v1.6.2'],['upper-v','V1.6.1'],['fullwidth-digits','１.６.２'],['fullwidth-all','１．６．２'],
 ['beta','1.6.1-beta'],['rc','1.6.2-rc.1'],['alpha-suffix','1.6.2-alpha'],['pre-suffix','1.6.2-pre'],['build-suffix','1.6.2+build.5'],
 ['bare-alpha','alpha'],['bare-pre','pre'],['bare-build','+build.5'],
 ['newline-161-162','1.6.1\n1.6.2'],['newline-162-161','1.6.2\n1.6.1'],
 ['comma-161-162','1.6.1,1.6.2'],['comma-162-161','1.6.2,1.6.1'],
];

test('J01 actual JSON trust rejects malformed versions with BAD_TRUST before destination or launch',async t=>{
 const install=subject(),f=await fixture(t),before=await core.inspectArtifactTree({artifactDir:f.artifact}),checked=[];
 assert.equal(await absent(f.installDir),true,'Original fresh fixture has no installation target');
 for(const [label,value,wholeTrust]of VECTORS){
  const candidate=wholeTrust?value:{...plain(f.trust),targetVersion:value},wire=JSON.stringify(candidate),trust=JSON.parse(wire);
  assert.equal(typeof wire,'string');
  if(label==='missing-targetVersion')assert.equal(Object.hasOwn(trust,'targetVersion'),false,'Undefined becomes a missing JSON field, not a JSON value');
  await assert.rejects(install({...f.options,trust}),error=>error.code==='BAD_TRUST',label+' must fail the actual readTrust path');
  assert.equal(await absent(f.installDir),true,label+' cannot create a destination');
  assert.deepEqual(plain(f.launches),[],label+' cannot launch');
  checked.push(label);
 }
 assert.equal(checked.length,VECTORS.length);assert.equal(new Set(checked).size,VECTORS.length);
 assert.equal((await core.inspectArtifactTree({artifactDir:f.artifact})).sha256,before.sha256,'All rejected JSON inputs leave the synthetic source package unchanged');
 assert.equal(sha(source(SUBJECT)),SOURCE_SHA,'Actual installer changed during JSON contract');
 console.log(JSON.stringify({purpose:'fresh-employee-version-json-results',checkedVariants:checked.length,allBadTrust:true,noDestination:true,noLaunch:true,sourcePackageUnchanged:true,boxedStringExcluded:true,undefinedRepresentedByOmission:true,executableRun:false}));
});


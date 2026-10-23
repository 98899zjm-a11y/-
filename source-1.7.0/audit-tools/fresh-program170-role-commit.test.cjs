'use strict';
// Real fictional files, real Ed25519 catalogs and real authenticated receipts.
// Only process launch is DI. No EXE, business/SQLite/native or production use.
const fs=require('node:fs'),io=fs.promises,path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),vm=require('node:vm'),{createRequire}=require('node:module');
const ROOT=path.resolve(__dirname,'..'),FROZEN='audit-tools/engine-commit-before-start170-a2.test.cjs',SELF='audit-tools/fresh-program170-role-commit.test.cjs',SUBJECT='delivery-tools/fresh-program-install-170.cjs',hash=b=>crypto.createHash('sha256').update(b).digest('hex');
if(process.platform!=='win32'||os.userInfo().username.toLowerCase()!=='wdagutilityaccount'||ROOT.toLowerCase()!=='c:\\xjy-work\\xjy-web-stage1')throw Error('Actual fixed offline Guest required');
const raw=fs.readFileSync(path.join(ROOT,FROZEN));if(hash(raw)!=='e1d9c416dcc91d2385348edec22c566584deafbb7c304082e3688b85a8c3057b')throw Error('Frozen original2 changed');
if(hash(fs.readFileSync(path.join(ROOT,SELF)))!==process.env.XJY_FRESH_PROGRAM_TEST_SHA256||hash(fs.readFileSync(path.join(ROOT,SUBJECT)))!==process.env.XJY_FRESH_PROGRAM_SOURCE_SHA256)throw Error('Exact fresh test/source pin required');
const text=raw.toString('utf8'),at=text.indexOf("test('S01");if(at<1||hash(Buffer.from(text.slice(0,at)))!=='1410dd64e391f6f3fbaea024b94a66a82f8646a8c42d992274397cfd5a0c31c1')throw Error('Exact original admission/prelude required');
const loaded={exports:{}};vm.runInThisContext('(function(require,module,exports,__filename,__dirname){\n'+text.slice(0,at)+'\nmodule.exports={revision170,snapshot,signed,api};\n})',{filename:path.join(ROOT,FROZEN)+'[exact-prelude-only]'})(createRequire(path.join(ROOT,FROZEN)),loaded,loaded.exports,path.join(ROOT,FROZEN),path.dirname(path.join(ROOT,FROZEN)));
const {revision170,snapshot,signed,api}=loaded.exports;
const test=require('node:test'),assert=require('node:assert/strict'),core=require('../delivery-tools/initial-patch-core.cjs'),gate=require('../project/desktop/engine-startup-gate.cjs');
const {installFreshProgram:install}=require('../delivery-tools/fresh-program-install-170.cjs');
async function fixture(role){
 const f=await revision170(role),oldExe=f.trust.executableName,fixedExe='鑫金源珠宝报价.exe';
 // The reused engine transaction fixture uses Toy Jewelry.exe. Fresh install
 // intentionally requires the shipped name; adapt fictional files, not policy.
 for(const [dir,catalog,which] of [[f.installationDir,f.sourceCatalog,'source'],[f.artifactDir,f.targetCatalog,'target']]){
  await io.rename(path.join(dir,oldExe),path.join(dir,fixedExe));
  catalog.files.find(row=>row.path===oldExe).path=fixedExe;
  f.trust[which].allowedFiles=f.trust[which].allowedFiles.map(name=>name===oldExe?fixedExe:name);
  f.trust[which].catalogSha256=hash(Buffer.from(JSON.stringify(catalog)));
  f.options[which+'Envelope']=signed(catalog,f.keys.privateKey);
 }
 f.trust.executableName=fixedExe;
 const source=path.join(f.root,'retained-original-source');await io.rename(f.installationDir,source);
 const catalog=JSON.parse(JSON.stringify(f.targetCatalog)),engine=catalog.files.filter(row=>!row.path.startsWith('resources/'));let count=0;
 while(engine.length<72){const name='extra-engine-'+count+++'.bin',bytes=Buffer.from('SYNTHETIC; NEVER EXECUTED '+name),row={path:name,size:bytes.length,sha256:hash(bytes)};await io.writeFile(path.join(f.artifactDir,name),bytes,{flag:'wx'});engine.push(row);catalog.files.push(row);}
 catalog.sourceVersions=['1.7.0'];const envelope=signed(catalog,f.keys.privateKey),target={...f.trust.target,catalogSha256:hash(Buffer.from(envelope.catalog)),allowedFiles:catalog.files.map(row=>row.path)};
 const fresh=path.join(f.root,'fresh-material');await io.mkdir(fresh);
 for(const row of catalog.files){const relative=row.path.startsWith('resources/')?row.path:'engine/'+row.path;await core.mkdirs(io,fresh,path.posix.dirname(relative)==='.'?'':path.posix.dirname(relative));await core.copy(io,path.join(f.artifactDir,...row.path.split('/')),path.join(fresh,...relative.split('/')),row,f.artifactDir,fresh);}
 await io.writeFile(path.join(fresh,'publisher-public.pem'),f.keys.publicKey.export({type:'spki',format:'pem'}),{flag:'wx'});
 const resources=catalog.files.filter(row=>row.path.startsWith('resources/')),resourceCatalog={...catalog,files:resources};await io.writeFile(path.join(fresh,'catalog-envelope.json'),JSON.stringify(signed(resourceCatalog,f.keys.privateKey)),{flag:'wx'});
 const trust={targetVersion:'1.7.0',engineVersion:'44.9.0',executableName:f.trust.executableName,publisherPublicKeySha256:f.trust.publisherPublicKeySha256,engineFiles:engine,allowedResourceFiles:resources.map(row=>row.path)};
 const receipt={installationDir:f.installationDir,stateDir:f.stateDir,role,envelope,trust:{schemaVersion:1,purpose:'xjy-engine-fresh170',publisherPublicKey:f.keys.publicKey,publisherPublicKeySha256:f.trust.publisherPublicKeySha256,executableName:f.trust.executableName,target},now:f.options.now};
 const counts={commit:0,launch:0};const options={artifactDir:fresh,installDir:f.installationDir,localAppData:f.root,role,trust,now:f.options.now,commit:async request=>{counts.commit++;assert.equal(request.role,role);assert.equal(request.installationDir,f.installationDir);return api.initializeFreshEngineReceipt170(receipt);},launch:async request=>{counts.launch++;const g=gate.readEngineStartupGate({installDir:f.installationDir,programVersion:'1.7.0',installedRole:role,trustedPublicKey:f.keys.publicKey});assert.equal(g.blocked,false);assert.equal(g.mode,'fresh');assert.deepEqual(request,{executablePath:path.join(f.installationDir,f.trust.executableName),args:role==='employee'?['--employee-client']:[],role});return{started:true};}};
 return{f,options,counts,receipt,source};
}
test('F01 explicit host and employee each copy complete449 then persist actual receipt before correct-role launch',async()=>{
 for(const role of ['host','employee']){const {f,options,counts,source}=await fixture(role),old=await snapshot(source),r=await install(options);assert.equal(r.installed,true);assert.equal(r.role,role);assert.equal(r.launched,true);assert.deepEqual(counts,{commit:1,launch:1});const a=JSON.parse(await io.readFile(path.join(f.installationDir,'xjy-install-activation.json'),'utf8'));assert.equal(a.role,role);assert.deepEqual(await snapshot(source),old);assert.equal(fs.existsSync(path.join(f.installationDir,'jewelry.sqlite')),false);}
});
test('F02 invalid or missing role/commit stops before any destination or receipt write',async()=>{
 for(const change of [{role:undefined},{role:'unknown'},{commit:undefined}]){const {f,options,counts}=await fixture('employee');await assert.rejects(install({...options,...change}),e=>e.code==='BAD_INSTALL');assert.equal(fs.existsSync(f.installationDir),false);assert.deepEqual(await io.readdir(f.stateDir),[]);assert.deepEqual(counts,{commit:0,launch:0});}
});
test('F03 real invalid full-tree receipt signature preserves copied program but starts nothing',async()=>{
 const {f,options,counts,receipt}=await fixture('employee');receipt.envelope={...receipt.envelope,signature:Buffer.alloc(64).toString('base64')};await assert.rejects(install(options),e=>e.code==='BAD_SIGNATURE');assert.deepEqual(counts,{commit:1,launch:0});assert.equal(fs.existsSync(path.join(f.installationDir,'xjy-install-activation.json')),true);assert.deepEqual(await io.readdir(f.stateDir),[]);assert.equal(gate.readEngineStartupGate({installDir:f.installationDir,programVersion:'1.7.0',installedRole:'employee',trustedPublicKey:f.keys.publicKey}).blocked,true);
});
test('F04 repeat existing fresh target cannot overwrite program or its authenticated journal',async()=>{
 const {f,options,counts}=await fixture('host');await install(options);const program=await snapshot(f.installationDir),state=await snapshot(f.stateDir);await assert.rejects(install(options),e=>e.code==='EXISTING_INSTALLATION');assert.deepEqual(await snapshot(f.installationDir),program);assert.deepEqual(await snapshot(f.stateDir),state);assert.deepEqual(counts,{commit:1,launch:1});
});

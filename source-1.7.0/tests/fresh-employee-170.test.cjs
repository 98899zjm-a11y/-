'use strict';
// Real fictional files and synthetic signed catalog; launch is DI. Reuses only
// the reviewed old fixture factory, never its tests or cleanup registrations.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm'),{createRequire}=require('node:module');
const ROOT=path.resolve(__dirname,'..'),FROZEN='audit-tools/fresh-employee-install.test.cjs';
if(process.platform!=='win32'||ROOT.toLowerCase()!=='c:\\xjy-work\\xjy-web-stage1')throw Error('Actual fixed offline Guest required');
const raw=fs.readFileSync(path.join(ROOT,FROZEN)),sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
if(sha(raw)!=='51a193abadc91c630e52a120341482f625e39e7251ee9b2cfd033f3d743008bd')throw Error('Frozen fresh fixture changed');
const text=raw.toString('utf8'),marker="test('F01 existing release admission accepts a fresh employee161 marker and selects no Host database',()=>{",at=text.indexOf(marker);
if(at<1||sha(Buffer.from(text.slice(0,at)))!=='59abbd9dacc4b122761489f51e43214c99b86b5513ea0fc32b55ff03147d4fc8')throw Error('Exact old admission/factory prelude required');
const loaded={exports:{}};
vm.runInNewContext(text.slice(0,at)+'\nmodule.exports={fixture,core,u,io,asar,absent};\n',{module:loaded,exports:loaded.exports,require:createRequire(path.join(ROOT,FROZEN)),__dirname:path.join(ROOT,'audit-tools'),__filename:path.join(ROOT,FROZEN),process,Buffer,URL,URLSearchParams,TextEncoder,TextDecoder,setTimeout,clearTimeout,setInterval,clearInterval,console},{filename:path.join(ROOT,FROZEN)+'[factory-only]'});
// The original prelude executes unchanged actual Python/runtime/guard admission
// before any installer import or fictional file creation.
const {fixture,core,u,io,asar,absent}=loaded.exports;
const test=require('node:test'),assert=require('node:assert/strict');
const {installFreshEmployee:install}=require('../delivery-tools/fresh-employee-install-170.cjs');
const plain=value=>JSON.parse(JSON.stringify(value));
async function versioned({target='1.7.0',catalog='1.7.0',app='1.7.0',engine='44.9.0'}={}){
 const f=await fixture({after:()=>{}}),appBytes=asar(app);
 await io.writeFile(path.join(f.artifact,'resources/app.asar'),appBytes);
 const files=f.files.map(row=>row.path==='resources/app.asar'?{path:row.path,size:appBytes.length,sha256:sha(appBytes)}:plain(row));
 const trust=u.freeze({...plain(f.trust),targetVersion:target,engineVersion:engine}),c={...plain(f.catalog),version:catalog,sourceVersions:[target],files};
 const payload=JSON.stringify(c);await io.writeFile(path.join(f.artifact,'catalog-envelope.json'),JSON.stringify({catalog:payload,signature:crypto.sign(null,Buffer.from(payload),f.keys.privateKey).toString('base64')}));
 return{...f,files,trust,options:{...f.options,trust}};
}
test('N01 fresh170/449 copies every declared engine/resource before activation and only employee launch',async()=>{
 const f=await versioned(),before=await core.inspectArtifactTree({artifactDir:f.artifact});
 const r=await install({...f.options,launch:async request=>{
  assert.deepEqual(plain(request),{executablePath:path.join(f.installDir,f.executableName),args:['--employee-client'],role:'employee'});
  const marker=JSON.parse(await io.readFile(path.join(f.installDir,'xjy-install-activation.json'),'utf8'));
  assert.deepEqual(marker,{version:1,product:'xjy-jewelry-offline',programVersion:'1.7.0',role:'employee',installationDir:f.installDir});
  const tree=await core.inspectArtifactTree({artifactDir:f.installDir});assert.equal(tree.files.length,75);
  for(const expected of [...f.trust.engineFiles,...f.files]){const row=tree.files.find(row=>row.path===expected.path);assert(row);assert.equal(row.size,expected.size);assert.equal(row.sha256,expected.sha256);}
  return{started:true};
 }});
 assert.equal(r.installed,true);assert.equal(r.version,'1.7.0');assert.equal(r.launched,true);assert.equal((await core.inspectArtifactTree({artifactDir:f.artifact})).sha256,before.sha256);
});
test('N02 old engine, future target or mismatching catalog/ASAR is refused before destination creation',async()=>{
 for(const input of [{engine:'44.7.0'},{target:'1.7.1',catalog:'1.7.1',app:'1.7.1'},{catalog:'1.6.2'},{app:'1.6.2'}]){
  const f=await versioned(input);await assert.rejects(install(f.options),e=>['BAD_TRUST','BAD_CATALOG','BAD_PROGRAM','SOURCE_UNSUPPORTED','DOWNGRADE_REJECTED'].includes(e.code));
  assert.equal(await absent(f.installDir),true);assert.equal(f.launches.length,0);
 }
});
test('N03 fresh launch failure preserves installed tree and retry cannot overwrite it',async()=>{
 const f=await versioned(),r=await install({...f.options,launch:async()=>{throw Error('synthetic employee spawn failed');}});
 assert.equal(r.installed,true);assert.equal(r.launched,false);assert.equal((await core.inspectArtifactTree({artifactDir:f.installDir})).files.length,75);
 await assert.rejects(install(f.options),e=>e.code==='EXISTING_INSTALLATION');assert.equal(f.launches.length,0);
});
test('N04 changed declared engine file is rejected without creating target or starting a process',async()=>{
 const f=await versioned(),engine=f.trust.engineFiles[1];await io.appendFile(path.join(f.artifact,'engine',engine.path),'tamper');
 await assert.rejects(install(f.options),e=>e.code==='ARTIFACT_CHANGED');assert.equal(await absent(f.installDir),true);assert.equal(f.launches.length,0);
});

'use strict';
// Source-level ACK retry contract. No product start, Electron, DB or process launch.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const test=require('node:test'),assert=require('node:assert/strict');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const input=process.env.XJY_ACK_TEST_INPUT,expected=process.env.XJY_ACK_SUBJECT_SHA;
assert.ok(/^C:\\xjy-input\\bridge-ack170-(red|green)-a[0-9]+$/i.test(input||''));
assert.equal(require('node:os').userInfo().username.toLowerCase(),'wdagutilityaccount');
const file=path.join(input,'bridge-entry-170.cjs'),raw=fs.readFileSync(file);assert.equal(hash(raw),expected);
const mod={exports:{}};
vm.runInThisContext('(function(require,module,exports,__dirname){'+raw.toString('utf8')+'\n})',{filename:file})(require,mod,mod.exports,input);
let verify=mod.exports.verifyBridgeAck;
if(!verify){
  // Reproduce the exact existing inline validator without changing its logic.
  const start=raw.toString().indexOf('   if(ack){\n'),end=raw.toString().indexOf('    view.close();view=null;child.unref();');
  assert.ok(start>0&&end>start);
  const body=raw.toString().slice(start+'   if(ack){\n'.length,end);
  const wrapper='(async function({ack,handoff,config,worker,parentPid,adapter,u,bundle,workerRel}){'+body+'return true;})';
  verify=vm.runInNewContext(wrapper,{path,Number,exact:(v,keys)=>v&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k)),fail:(code,message)=>{throw Object.assign(Error(message),{code});}});
}
function fixture(){
 const handoff={operationId:'e819d37c-7b9b-4c39-8f93-5c067d3c2c85'},config={publicationId:'1'.repeat(64),targetCatalogSha256:'2'.repeat(64)},worker={sha256:'3'.repeat(64)},bundle='C:\\synthetic\\bundle',workerRel='受信助手/鑫金源珠宝报价.exe';
 const ack={version:1,purpose:'xjy-engine-bridge-accepted170',operationId:handoff.operationId,publicationId:config.publicationId,targetCatalogSha256:config.targetCatalogSha256,helperPid:42,helperParentPid:100,helperCreationMarker:'20261020041000.000000+480',helperExecutableSha256:worker.sha256};
 const f={ack,handoff,config,worker,parentPid:100,bundle,workerRel,u:{samePath:(a,b)=>path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase()}};
 f.live={pid:42,parentPid:100,creationMarker:ack.helperCreationMarker,executablePath:path.join(bundle,...workerRel.split('/'))};
 f.adapter={inspect:async pid=>{assert.equal(pid,f.ack.helperPid);return f.live;}};return f;
}
test('A01 expired previous helper ACK waits for current helper',async()=>{const f=fixture();f.ack.helperParentPid=90;f.live=null;assert.equal(await verify(f),false);});
test('A02 authenticated ACK matching actual current helper accepts',async()=>{assert.equal(await verify(fixture()),true);});
test('A03 previous authenticated helper still alive is BUSY',async()=>{const f=fixture();f.ack.helperParentPid=90;f.live.parentPid=90;await assert.rejects(verify(f),{code:'BRIDGE_BUSY'});});
test('A04 wrong publication never becomes a retry',async()=>{const f=fixture();f.ack.publicationId='4'.repeat(64);f.ack.helperParentPid=90;f.live=null;await assert.rejects(verify(f),{code:'BRIDGE_ACK'});});
test('A05 current helper with different process identity rejects',async()=>{const f=fixture();f.live.creationMarker='different';await assert.rejects(verify(f),{code:'BRIDGE_PROCESS'});});
test('A06 reused old PID is not the original helper',async()=>{const f=fixture();f.ack.helperParentPid=90;f.live.creationMarker='later-process';assert.equal(await verify(f),false);});
test('A07 process inspection failure does not authorize handoff',async()=>{const f=fixture();f.adapter.inspect=async()=>{throw Object.assign(Error('inspection failed'),{code:'CIM_FAILED'});};await assert.rejects(verify(f),{code:'CIM_FAILED'});});
test('A08 invalid PID is rejected before process lookup',async()=>{const f=fixture();f.ack.helperPid=0;f.adapter.inspect=async()=>{throw Error('must not inspect invalid PID');};await assert.rejects(verify(f),{code:'BRIDGE_ACK'});});

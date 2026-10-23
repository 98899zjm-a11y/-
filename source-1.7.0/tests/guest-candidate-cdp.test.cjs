'use strict';
// Pure protocol/path tests: never connect to a debugger or start an engine.
const test=require('node:test'),assert=require('node:assert/strict');
const {validateTarget,unwrap,validateLoopbackListener}=require('../stage1/guest-candidate-cdp.cjs');
test('CDP only accepts actual native fixture page on the fixed local port',()=>{
 const valid={type:'page',url:'jewelry://app/home',webSocketDebuggerUrl:'ws://127.0.0.1:42791/devtools/page/fixture'};
 assert.equal(validateTarget(valid),valid.webSocketDebuggerUrl);
 for(const row of [{...valid,url:'http://127.0.0.1:42831/home'},{...valid,webSocketDebuggerUrl:'ws://0.0.0.0:42791/devtools/page/fixture'},{...valid,webSocketDebuggerUrl:'ws://127.0.0.1:31831/devtools/page/fixture'},{...valid,webSocketDebuggerUrl:'ws://user@127.0.0.1:42791/devtools/page/fixture'},{...valid,type:'service_worker'}])assert.throws(()=>validateTarget(row));
});
test('CDP exceptions and missing result never become successful evidence',()=>{
 assert.deepEqual(unwrap({result:{type:'object',value:{ok:true}}}),{ok:true});
 for(const result of [{exceptionDetails:{text:'real exception'}},{result:{type:'undefined'}},{result:{type:'object',subtype:'error',description:'failed'}}])assert.throws(()=>unwrap(result));
});
test('Only fixed loopback listener belongs to actual admitted PID',()=>{
 validateLoopbackListener([{LocalAddress:'127.0.0.1',LocalPort:42791,OwningProcess:123}],42791,123);
 for(const rows of [[],[{LocalAddress:'0.0.0.0',LocalPort:42791,OwningProcess:123}],[{LocalAddress:'127.0.0.1',LocalPort:42791,OwningProcess:234}]])assert.throws(()=>validateLoopbackListener(rows,42791,123));
});

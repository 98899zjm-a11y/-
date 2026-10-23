'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
test('headless supervisor retries failed owned hosts with bounded backoff and never restarts a graceful stop',async()=>{
 const{runSupervisor}=require('../stage1/supervisor.cjs');let calls=0;const waits=[];const result=await runSupervisor({launch:async()=>++calls===1?1:0,delay:async n=>waits.push(n),limit:3});assert.equal(result.stopped,true);assert.equal(calls,2);assert.deepEqual(waits,[1000]);
 calls=0;const exhausted=await runSupervisor({launch:async()=>{calls++;return 1;},delay:async()=>{},limit:3});assert.equal(calls,3);assert.equal(exhausted.failed,true);
});

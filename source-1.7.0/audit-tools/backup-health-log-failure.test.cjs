'use strict';
// One actual-Guest, fake-port test. Root alone executes; no product IO/DB/process.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'..'),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
if(process.platform!=='win32'||ROOT.toLowerCase()!=='c:\\xjy-work\\xjy-web-stage1')throw Error('Fixed actual Guest required before product evaluation');
const pins={
 'stage1/guest-candidate-cdp.cjs':'59840b638d8797fb55241616cd0b8e4098075a76834a201b0e93c1a748f1bb32',
 'stage1/sandbox-context.py':'09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249',
 'stage1/validate-sandbox-context.py':'867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207',
};
for(const [relative,pin]of Object.entries(pins)){const file=path.join(ROOT,relative);if(hash(fs.readFileSync(file))!==pin)throw Error('Original actual-Guest guard changed');}
// The unchanged actualGuard's metadata subprocess is the sole admission exception.
const actualContext=require('../stage1/guest-candidate-cdp.cjs').actualGuard();
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const productFile=path.join(ROOT,'project/desktop/business-daily-backup.cjs');
const productBytes=fs.readFileSync(productFile),productSha256=hash(productBytes);
const expectedProductSha=process.env.XJY_DAILY_SOURCE_SHA256;
assert.match(expectedProductSha||'',/^[a-f0-9]{64}$/,'Root must freeze the exact daily source SHA');
assert.equal(productSha256,expectedProductSha,'Daily source changed before VM evaluation');

test('L01 actual timer contains a secondary ENOSPC logger failure and retains sanitized failed health',async()=>{
 const SECRET='SYNTHETIC_NOT_A_REAL_CREDENTIAL',root='C:\\synthetic-backup-health-no-io';
 const layout={configDir:path.join(root,'config'),logDir:path.join(root,'logs')};
 const marker=path.join(layout.configDir,'daily-backup-test.json'),log=path.join(layout.logDir,'daily-backup-errors.log');
 const calls={create:0,append:0,exists:0,probe:0,list:0,cleanup:0,interval:0,unref:0,clear:0};
 let callback=null;
 const fakeContext=Object.freeze({purpose:'enospc-no-real-io'}),timer=Object.freeze({unref(){calls.unref++;}});
 const createError=Object.assign(Error('ENOSPC C:\\synthetic-private\\backup.key token='+SECRET),{code:'ENOSPC'});
 const logError=Object.assign(Error('ENOSPC synthetic log destination'),{code:'ENOSPC'});
 const io={
  existsSync(file){assert.equal(file,marker);calls.exists++;return false;},
  appendFileSync(file,body){assert.equal(file,log);assert.equal(typeof body,'string');calls.append++;throw logError;},
 };
 const policy={io,check(file,missing){assert.equal(file,marker);assert.equal(missing,true);return file;}};
 const service={
  async create(options){assert.equal(options.kind,'auto');assert(options.now instanceof Date);calls.create++;throw createError;},
  async probe(){calls.probe++;throw Error('No verification after failed create');},
  list(){calls.list++;throw Error('No marker/list path in this fixture');},
  async cleanup(){calls.cleanup++;throw Error('No cleanup after failed create');},
 };
 const moduleObject={exports:{}};
 vm.runInNewContext(productBytes.toString('utf8'),{
  module:moduleObject,exports:moduleObject.exports,Date,Intl,
  require(id){
   if(id==='node:path')return path;
   if(id==='node:crypto')return crypto;
   assert.equal(id,'./business-maintenance-layout.cjs','Only original context dependency may be replaced');
   return{requireContext(context){assert.equal(context,fakeContext);return{layout,policy,namespace:'synthetic-log-failure-only'};}};
  },
  setInterval(fn,ms){calls.interval++;assert.equal(calls.interval,1);assert.equal(ms,60000);assert.equal(typeof fn,'function');callback=fn;return timer;},
  clearInterval(value){assert.equal(value,timer);calls.clear++;},
 },{filename:productFile});
 const daily=moduleObject.exports.createBusinessDailyBackups({context:fakeContext,service,markerName:'daily-backup-test.json'});
 let escaped=false,health;
 try{
  assert.equal(daily.getStatus().state,'unverified');
  daily.start();assert.equal(calls.interval,1);assert.equal(calls.unref,1);assert.equal(typeof callback,'function');
  // Attach a rejection observer immediately: this test does not create a real
  // unhandledRejection event or claim that every Node configuration terminates.
  const pending=callback();assert(pending&&typeof pending.then==='function','Actual interval callback must return its Promise');
  await pending.then(()=>{},()=>{escaped=true;});
  health=JSON.parse(JSON.stringify(daily.getStatus()));
  assert.equal(health.state,'failed','A failed backup must never appear successful');
  assert.equal(health.lastVerifiedAt,null);assert.equal(health.lastError.code,'ENOSPC');
  assert.equal(health.lastError.message,'自动备份未完成，请稍后重试。');
  assert(Number.isFinite(Date.parse(health.lastAttemptAt)));assert.equal(health.lastError.at,health.lastAttemptAt);
  assert.doesNotMatch(JSON.stringify(health),/[A-Za-z]:[\\/]|\\\\|SYNTHETIC_NOT_A_REAL_CREDENTIAL|password=|token=|backup\.key/i);
  assert.equal(calls.create,1);assert.equal(calls.append,1);assert.equal(calls.exists,1);
  assert.equal(calls.probe,0);assert.equal(calls.list,0);assert.equal(calls.cleanup,0);
 }finally{await daily.stop();}
 assert.equal(calls.clear,1);
 console.log(JSON.stringify({purpose:'backup-health-secondary-log-failure',productSha256,actualContext,timerPromiseRejected:escaped,healthState:health.state,healthCode:health.lastError.code,realProductIo:false,sqliteOpened:false,realTimerStarted:false}));
 assert.equal(escaped,false,'LOGGER_ENOSPC_MUST_NOT_ESCAPE_THE_INTERVAL_PROMISE');
});

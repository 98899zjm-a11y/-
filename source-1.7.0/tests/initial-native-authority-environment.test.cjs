'use strict';
// Fake exec cases never execute PowerShell, the engine or a KnownFolder write.
// The real old-engine case is opt-in and first requires actual Guest admission.
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const entry=require('../delivery-tools/initial-patch-entry.cjs');
const PS='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const native=()=>({common:'C:\\Native Common Directory',local:'C:\\Users\\Synthetic\\AppData\\Local',roaming:'C:\\Users\\Synthetic\\AppData\\Roaming',windows:'C:\\Windows',sid:'S-1-5-21-123-456-789-1001'});

async function captured(output=native(),extra={}){
 const calls=[];
 const authority=await entry.resolveInitialNativeAuthority({...extra,execFileAdapter:(file,args,options,done)=>{
  calls.push({file,args,options});queueMicrotask(()=>done(null,JSON.stringify(output)));
 }});
 return{authority,calls};
}

test('native authority subprocess has fixed SystemDrive and PATHEXT even when its caller omits or spoofs them',async()=>{
 for(const environment of [undefined,{SystemDrive:'Z:',PATHEXT:'.JS;.PS1',ProgramData:'Z:\\Attacker',ALLUSERSPROFILE:'Z:\\Attacker'}]){
  const actual=await captured(native(),{environment,SystemDrive:'Z:',PATHEXT:'.CMD',ProgramData:'Z:\\Attacker'});
  assert.equal(actual.calls.length,1);const call=actual.calls[0];
  assert.equal(call.file,PS);assert.equal(call.options.shell,false);assert.equal(call.options.windowsHide,true);
  assert.deepEqual(call.args.slice(0,4),['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand']);assert.equal(call.args.length,5);
  assert.deepEqual(call.options.env,{SystemRoot:'C:\\Windows',WINDIR:'C:\\Windows',SystemDrive:'C:',PATHEXT:'.EXE'});
  for(const key of ['ProgramData','PROGRAMDATA','ALLUSERSPROFILE','NODE_OPTIONS','NODE_PATH','PATH'])assert.equal(call.options.env[key],undefined,key);
 }
});

test('the common approval root still comes only from the OS folder response and exact SID leaf',async()=>{
 const result=await captured();
 assert.equal(result.authority.approvalRoot,'C:\\Native Common Directory\\鑫金源珠宝初次升级审定-S-1-5-21-123-456-789-1001');
 assert.equal(result.authority.local,native().local);assert.equal(result.authority.roaming,native().roaming);
 const command=Buffer.from(result.calls[0].args[4],'base64').toString('utf16le');
 assert(command.includes('[Environment+SpecialFolder]::CommonApplicationData'));
 assert(!/C:\\ProgramData|\$env:ProgramData|\$env:ALLUSERSPROFILE|GetEnvironmentVariable\([^)]*(?:ProgramData|ALLUSERSPROFILE)/i.test(command));
});

test('an empty OS common directory or native process failure cannot use environment or literal fallback authority',async()=>{
 await assert.rejects(captured({...native(),common:''},{ProgramData:'C:\\ProgramData'}),error=>['UNSAFE_PATH','BAD_NATIVE_AUTHORITY'].includes(error.code));
 const failed=Object.assign(Error('controlled native metadata failure'),{code:'TOY_NATIVE_FAILURE'});
 await assert.rejects(entry.resolveInitialNativeAuthority({execFileAdapter:(_file,_args,_options,done)=>done(failed),environment:{SystemDrive:'Z:'}}),error=>error===failed);
});

test('actual Guest old engine resolves native folders with SystemDrive and PATHEXT absent from its parent environment',{
 skip:process.env.XJY_NATIVE_AUTHORITY_ACTUAL_GUEST!=='1'
},()=>{
 const root='C:\\xjy-work\\xjy-web-stage1';
 const guard=spawnSync('C:/Python314/python.exe',['-I','-B','-X','utf8',path.win32.join(root,'stage1/validate-sandbox-context.py')],{windowsHide:true,shell:false,encoding:'utf8',timeout:40000});
 assert.equal(guard.status,0,guard.stderr);const context=JSON.parse(guard.stdout);
 assert.equal(context.model,'Virtual Machine');assert.equal(context.productionDrivePresent,false);assert.equal(context.nonLoopbackAddressCount,0);assert.match(context.userName,/\\WDAGUtilityAccount$/i);
 const executable=process.env.XJY_NATIVE_AUTHORITY_EXE;
 assert.equal(typeof executable,'string','Root must supply the approved owned Guest engine fixture');
 assert(path.win32.isAbsolute(executable));assert(executable.toLowerCase().startsWith(path.win32.join(root,'runtime').toLowerCase()+'\\'));
 assert.equal(path.win32.basename(executable),'鑫金源珠宝报价.exe');assert.equal(fs.realpathSync.native(executable).toLowerCase(),executable.toLowerCase());
 const engine=fs.readFileSync(executable);assert.equal(engine.length,246302720);assert.equal(crypto.createHash('sha256').update(engine).digest('hex'),'db3ad2066a55546f9b6737da3c7f011370e4856fb36888055b544d45653e4f40');
 const source=path.resolve(__dirname,'../delivery-tools/initial-patch-entry.cjs');
 // libuv may copy essential Windows variables into an explicit child env. This
 // owned Guest metadata-only process removes both again before loading entry.
 const code="delete process.env.SystemDrive;delete process.env.PATHEXT;const e=require(process.argv[1]);if(Object.hasOwn(process.env,'SystemDrive')||Object.hasOwn(process.env,'PATHEXT'))throw Error('Parent environment was not cleared');e.resolveInitialNativeAuthority().then(authority=>process.stdout.write(JSON.stringify({parentSystemDriveAbsent:true,parentPathextAbsent:true,authority})),error=>{process.stderr.write((error.code||'FAILED')+':'+error.message);process.exitCode=1;});";
 const child=spawnSync(executable,['-e',code,source],{cwd:path.win32.dirname(executable),windowsHide:true,shell:false,encoding:'utf8',timeout:45000,
  env:{SystemRoot:'C:\\Windows',WINDIR:'C:\\Windows',ELECTRON_RUN_AS_NODE:'1'}});
 assert.equal(child.status,0,child.stderr||child.stdout);const proof=JSON.parse(child.stdout.replace(/^\uFEFF/,''));
 assert.equal(proof.parentSystemDriveAbsent,true);assert.equal(proof.parentPathextAbsent,true);
 assert.match(proof.authority.osUser,/^S-1-\d+(?:-\d+)+$/);assert(path.win32.isAbsolute(proof.authority.approvalRoot));
 assert.equal(path.win32.basename(proof.authority.approvalRoot),'鑫金源珠宝初次升级审定-'+proof.authority.osUser);
 assert(!proof.authority.approvalRoot.includes('%'));assert(path.win32.isAbsolute(proof.authority.local));assert(path.win32.isAbsolute(proof.authority.roaming));
});

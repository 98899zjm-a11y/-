'use strict';
// Guest-only adapter behavior contract. The original execFile option supplies
// an explicit PowerShell protocol emulator; no actual CIM/native PASS claim.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'..'),SOURCE=path.join(ROOT,'project/desktop/updater-helper.cjs');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),SHA=/^[a-f0-9]{64}$/;
if(process.platform!=='win32'||ROOT.toLowerCase()!=='c:\\xjy-work\\xjy-web-stage1')throw Error('Fixed actual no-F Guest required');
if(hash(fs.readFileSync(path.join(ROOT,'stage1/guest-candidate-cdp.cjs')))!=='59840b638d8797fb55241616cd0b8e4098075a76834a201b0e93c1a748f1bb32')throw Error('Original guard pin changed');
require('../stage1/guest-candidate-cdp.cjs').actualGuard();
const test=require('node:test'),assert=require('node:assert/strict');
assert.equal(hash(fs.readFileSync(__filename)),process.env.XJY_UPDATER_UTF8_TEST_SHA256,'Root must freeze this contract');
assert(SHA.test(process.env.XJY_UPDATER_UTF8_SOURCE_SHA256||''),'Root must freeze actual updater source');
assert.equal(hash(fs.readFileSync(SOURCE)),process.env.XJY_UPDATER_UTF8_SOURCE_SHA256);
const {createWindowsUpdateProcessAdapter}=require(SOURCE);
const UTF8="[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);";
const EXE=path.join(ROOT,'runtime/中文员工程序','鑫金源珠宝报价.exe'),CREATED='2026-10-19T06:00:00.0000000Z';
function adapter(){
 const calls=[],rows=[{ProcessId:process.pid,ParentProcessId:1,ExecutablePath:EXE,CreationMarker:CREATED,CommandLine:'"'+EXE+'" --employee-client'},{ProcessId:999999,ParentProcessId:1,ExecutablePath:'C:\\other\\other.exe',CreationMarker:CREATED,CommandLine:'"C:\\other\\other.exe"'}];
 const environment={SystemRoot:'C:\\Windows',WINDIR:'C:\\Windows',TEMP:'C:\\Temp',TMP:'C:\\Temp',USERPROFILE:'C:\\Users\\WDAGUtilityAccount',APPDATA:'C:\\Users\\WDAGUtilityAccount\\AppData\\Roaming',LOCALAPPDATA:'C:\\Users\\WDAGUtilityAccount\\AppData\\Local',PATH:'C:\\Windows\\System32',NODE_OPTIONS:'DI-must-not-be-forwarded',NODE_PATH:'DI-must-not-be-forwarded',XJY_UPDATE_CAPABILITY:'DI-must-not-be-forwarded'};
 const execFile=async(file,args,options)=>{
  const script=Buffer.from(args.at(-1),'base64').toString('utf16le');calls.push({file,args,options,script});
  // Explicitly emulate the observed Unicode loss from a PS stdout producer
  // whose encoding was not fixed. The adapter must prevent it at its source.
  const json=JSON.stringify(rows),stdout=script.startsWith(UTF8)?json:json.replace(/[^\x00-\x7f]/g,'\ufffd');
  return{stdout,stderr:''};
 };
 return{native:createWindowsUpdateProcessAdapter({executablePath:EXE,environment,execFile}),calls,environment};
}
test('U01 native inspect retains exact Chinese executable path and original current PID/creation marker',async()=>{
 const f=adapter(),current=await f.native.inspect(process.pid);assert.equal(current.pid,process.pid);assert.equal(current.creationMarker,CREATED);assert.equal(current.executablePath,EXE);assert.deepEqual(current.args,['--employee-client']);assert(!current.executablePath.includes('\ufffd'));
});
test('U02 the fixed Windows PowerShell UTF8 producer uses the original command policy and only its clean environment',async()=>{
 const f=adapter();await f.native.inspect(process.pid);assert.equal(f.calls.length,1);const c=f.calls[0];assert.equal(c.file,path.resolve('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'));assert.deepEqual(c.args.slice(0,-1),['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand']);assert(c.script.startsWith(UTF8),'PowerShell must select UTF8 before producing any process JSON');assert(c.script.includes('Get-CimInstance Win32_Process'));assert(c.script.includes('CreationDate.ToUniversalTime().ToString'));assert(c.script.includes('ConvertTo-Json -InputObject $rows -Compress -Depth 3'));assert.equal(c.options.encoding,'utf8');assert.equal(c.options.shell,false);assert.equal(c.options.windowsHide,true);assert.equal(c.options.timeout,15000);assert.equal(c.options.maxBuffer,4194304);assert.deepEqual(c.options.env,Object.fromEntries(Object.entries(f.environment).filter(([key])=>!['NODE_OPTIONS','NODE_PATH','XJY_UPDATE_CAPABILITY'].includes(key))));
});
test('U03 installation process filtering preserves Chinese directory identity without admitting another executable tree',async()=>{
 const f=adapter(),rows=await f.native.listForInstallation();assert.equal(rows.length,1);assert.equal(rows[0].pid,process.pid);assert.equal(rows[0].executablePath,EXE);assert.equal(rows[0].creationMarker,CREATED);
});

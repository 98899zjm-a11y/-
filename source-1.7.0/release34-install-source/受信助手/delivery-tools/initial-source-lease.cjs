'use strict';
const fs=process.versions.electron?require('original-fs').promises:require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const u=require('../project/desktop/employee-update-cache.cjs');

// Only the original worker PS pair may be loaded; stdin remains owned by RELEASE.
const SOURCE_GUARD_SHA='4b51ba8e7300e0ce8875dcb2a3b060622d84f81459b8cc758d16c4f94eb3f8d7',SOURCE_LOCK_SHA='6a61a66f873ff92646c3a01064619fc3aff405a2d9161edea66fa57c2856b211';
const SOURCE_DOT=". (Join-Path $PSScriptRoot 'Initial-Path-Guard.ps1')",SOURCE_HELD='foreach($sourcePin in $sourcePinsOriginal){[XjyInitialPathGuard]::Check($sourcePin.stream.SafeFileHandle,$sourcePin.path,$false)}';
function sourceLockCommand(context,guard,lock){
 if(!context||Object.keys(context).sort().join(',')!=='artifact,requestFile,script')u.fail('BAD_SOURCE_LEASE','固定源锁载入上下文无效');
 const artifact=u.safeAbsolute(context.artifact),script=u.safeAbsolute(context.script),request=u.safeAbsolute(context.requestFile),same=(a,b)=>path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
 if(!same(script,path.join(artifact,'delivery-tools/Initial-Source-Lock.ps1'))||path.basename(path.dirname(request))!=='.xjy-initial-upgrade'||!/^source-lease-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.json$/.test(path.basename(request)))u.fail('BAD_SOURCE_LEASE','固定源锁脚本或原请求路径无效');
 if(!Buffer.isBuffer(guard)||guard.length!==2456||u.digest(guard)!==SOURCE_GUARD_SHA||!Buffer.isBuffer(lock)||lock.length!==2726||u.digest(lock)!==SOURCE_LOCK_SHA)u.fail('BAD_SOURCE_LEASE','源锁脚本字节与已审worker不符');
 const guardText=new TextDecoder('utf8',{fatal:true}).decode(guard),lockText=new TextDecoder('utf8',{fatal:true}).decode(lock);if(lockText.split(SOURCE_DOT).length!==2||guardText.includes('$PSScriptRoot'))u.fail('BAD_SOURCE_LEASE','源锁载入形状已变化');
 const combined=lockText.replace(SOURCE_DOT,()=>guardText+'\n'+SOURCE_HELD),config={guardFile:path.join(artifact,'delivery-tools/Initial-Path-Guard.ps1'),lockFile:script,guardSha:SOURCE_GUARD_SHA,lockSha:SOURCE_LOCK_SHA,dot:SOURCE_DOT,checkHeld:SOURCE_HELD,combinedSha:u.digest(Buffer.from(combined)),requestFile:request};
 const scriptText=SOURCE_BOOTSTRAP.replace('@@CONFIG@@',()=>Buffer.from(JSON.stringify(config)).toString('base64')),encoded=Buffer.from(scriptText,'utf16le').toString('base64');if(encoded.length>=28000)u.fail('BAD_SOURCE_LEASE','源锁载入参数过长');
 return ['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',encoded];
}
const SOURCE_BOOTSTRAP=String.raw`
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$config=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('@@CONFIG@@'))|ConvertFrom-Json
$sourcePinsOriginal=New-Object 'Collections.Generic.List[object]'
function Read-OriginalSource([string]$file,[string]$expected){
 for($p=$file;$p;){$a=[IO.File]::GetAttributes($p);if(($a -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'SOURCE_ALIAS'};$parent=[IO.Directory]::GetParent($p);if(!$parent){break};$p=$parent.FullName}
 $stream=[IO.File]::Open($file,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
 $sourcePinsOriginal.Add(@{path=$file;stream=$stream})
 if($stream.Length -lt 1 -or $stream.Length -gt 1048576){throw 'SOURCE_BOUND'}
 $sha=[Security.Cryptography.SHA256]::Create();try{$actual=([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
 if($actual -cne $expected){throw 'SOURCE_PIN'};$stream.Position=0
 $reader=[IO.StreamReader]::new($stream,[Text.UTF8Encoding]::new($false,$true),$true,1024,$true);try{return $reader.ReadToEnd()}finally{$reader.Dispose()}
}
try{
 $guard=Read-OriginalSource $config.guardFile $config.guardSha
 $lock=Read-OriginalSource $config.lockFile $config.lockSha
 if($lock.Split([string[]]@($config.dot),[StringSplitOptions]::None).Count -ne 2){throw 'SOURCE_DOT_COUNT'}
 $combined=$lock.Replace([string]$config.dot,($guard+[char]10+[string]$config.checkHeld))
 $sha=[Security.Cryptography.SHA256]::Create();try{$actual=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($combined)))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
 if($actual -cne $config.combinedSha){throw 'COMPOSED_SOURCE_CHANGED'}
 & ([ScriptBlock]::Create($combined)) -RequestFile $config.requestFile
}catch{[Console]::Error.WriteLine('RESTRICTED_SOURCE_LOADER_REFUSED');exit 1}
finally{for($i=$sourcePinsOriginal.Count-1;$i -ge 0;$i--){$sourcePinsOriginal[$i].stream.Dispose()}}
`;
async function createInitialSourceLease(options){const install=u.safeAbsolute(options.installDir),artifact=u.safeAbsolute(options.artifactDir),requestFile=path.join(install,'.xjy-initial-upgrade','source-lease-'+crypto.randomUUID()+'.json');if(options.role!=='host'||options.root!=='F:\\鑫金源珠宝资料'||!Array.isArray(options.databases)||options.databases.length!==3||new Set(options.databases.map(x=>x.module)).size!==3||options.databases.some(x=>!['sales','ledger','inventory'].includes(x.module)||typeof x.file!=='string'))u.fail('BAD_SOURCE_LEASE','仅固定Host三库可持有只读源句柄');const request={version:1,root:options.root,databases:options.databases.map(x=>({module:x.module,source:x.file}))},raw=JSON.stringify(request),requestHash=u.digest(Buffer.from(raw)),cap=crypto.randomBytes(32),script=path.join(artifact,'delivery-tools/Initial-Source-Lock.ps1');await u.assertPath(fs,script,{root:artifact});const guardFile=path.join(artifact,'delivery-tools/Initial-Path-Guard.ps1');await u.assertPath(fs,guardFile,{root:artifact});const command=sourceLockCommand({artifact,script,requestFile},await u.readSmall(fs,guardFile,1048576),await u.readSmall(fs,script,1048576));await u.assertPath(fs,path.dirname(requestFile),{directory:true,root:install});const o=await u.openChecked(fs,requestFile,'wx+',{missing:true,root:install});try{await u.writeExactly(o.handle,0,Buffer.from(raw));await o.handle.sync();}finally{await o.handle.close();}const powershell='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',child=(options.spawnChild||spawn)(powershell,command,{shell:false,windowsHide:true,cwd:artifact,env:{...options.environment,XJY_INITIAL_SOURCE_CAP:cap.toString('hex')},stdio:['pipe','pipe','pipe']});let ended=false,ready=false,closed=false,exitCode=null,exitSignal=null;child.once('exit',(code,signal)=>{ended=true;exitCode=code;exitSignal=signal;});
 await new Promise((resolve,reject)=>{let output='';const timeout=setTimeout(()=>reject(Object.assign(Error('源数据库只读句柄未就绪'),{code:'SOURCE_LOCK_UNAVAILABLE'})),options.readyTimeoutMs||15000);function done(error){clearTimeout(timeout);error?reject(error):resolve();}child.once('error',done);child.once('exit',()=>{if(!ready)done(Object.assign(Error('源数据库存在写入者或拒绝句柄锁'),{code:'SOURCE_LOCK_UNAVAILABLE'}));});child.stdout.on('data',bytes=>{output+=bytes.toString('utf8');if(output.length>8192)return done(Object.assign(Error('源锁响应异常'),{code:'SOURCE_LOCK_UNAVAILABLE'}));if(!output.includes('\n'))return;try{const response=JSON.parse(output.slice(0,output.indexOf('\n')));if(response.ready!==true||response.requestHash!==requestHash||typeof response.mac!=='string'||!/^[a-f0-9]{64}$/.test(response.mac)||!crypto.timingSafeEqual(crypto.createHmac('sha256',cap).update(requestHash).digest(),Buffer.from(response.mac,'hex')))throw Error('源锁证明无效');ready=true;done();}catch(error){done(Object.assign(error,{code:'SOURCE_LOCK_UNAVAILABLE'}));}});}).catch(async error=>{child.stdin.end();try{await u.assertPath(fs,requestFile,{root:install});await fs.unlink(requestFile);}catch{}throw error;});
 return{assertHeld:async()=>ready&&!ended&&!closed,close:async()=>{if(closed)return;closed=true;if(!ended){const exit=new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Object.assign(Error('源锁助手未正常退出，不能启动业务'),{code:'SOURCE_RELEASE_FAILED'})),10000);child.once('exit',(code,signal)=>{clearTimeout(timeout);code===0&&signal===null?resolve():reject(Object.assign(Error('源锁助手退出异常，不能启动业务'),{code:'SOURCE_RELEASE_FAILED'}));});});child.stdin.end('RELEASE\n');await exit;}if(exitCode!==0||exitSignal!==null)throw Object.assign(Error('源锁助手退出异常，不能启动业务'),{code:'SOURCE_RELEASE_FAILED'});await u.assertPath(fs,requestFile,{root:install});await fs.unlink(requestFile);}};
}
module.exports={createInitialSourceLease};

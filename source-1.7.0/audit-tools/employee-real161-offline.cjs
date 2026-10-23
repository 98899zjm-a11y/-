'use strict';
// Actual Guest + real 160/161 program bytes/signature/cache/transaction.
// Actor and process readiness/exit/restart are explicit DI; no EXE is executed.
const fs0=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..'),digest=b=>crypto.createHash('sha256').update(b).digest('hex');
if(process.platform!=='win32'||ROOT.toLowerCase()!=='c:\\xjy-work\\xjy-web-stage1')throw Error('Fixed actual Guest required');
const guard=path.join(ROOT,'stage1/guest-candidate-cdp.cjs');
assert.equal(digest(fs0.readFileSync(guard)),'59840b638d8797fb55241616cd0b8e4098075a76834a201b0e93c1a748f1bb32');
const actualContext=require(guard).actualGuard();
const fs=process.versions.electron?require('original-fs').promises:require('node:fs/promises');
const core=require('../delivery-tools/initial-patch-core.cjs'),u=require('../project/desktop/employee-update-cache.cjs');
const {createUpdateDistribution}=require('../project/desktop/update-distribution.cjs');
const {createNativeEmployeeUpdate}=require('../project/desktop/native-employee-update.cjs');
const BASE='C:/xjy-base/release-candidate',FEED='C:/xjy-input/signed-feed-161-a1';
const ENGINE={size:246302720,sha256:'db3ad2066a55546f9b6737da3c7f011370e4856fb36888055b544d45653e4f40'};
const RAW_SHA='b39a6fda20b038149601177f5af03849efb820548ce15076b87dc8713b726881';
const ENVELOPE_SHA='68255c8157b5be98bba5c3376a3b06605272123a3536638a74b1fd713d2257e8';
const ZIP_SHA='7cb1035c24beb114d890c6088a827e41a6ae77cab3d039e767ffb843303f13c6';
async function checked(file,spec,root){const r=await core.fileHash(fs,file,root);assert.equal(r.size,spec.size);assert.equal(r.sha256,spec.sha256);return r;}
async function put(root,relative,body){await core.mkdirs(fs,root,relative.split('/').slice(0,-1).join('/'));await fs.writeFile(path.join(root,...relative.split('/')),body,{flag:'wx'});}
async function main(){
 const start=Date.now(),baselineBytes=await u.readSmall(fs,path.join(BASE,'release-manifest.json'),2097152);
 assert.equal(digest(baselineBytes),'c82426dc5463f2b5f0b366dd7c7e0ac09ec9d542bc9b81866997ecbc0cf9efd9');
 const baseline=JSON.parse(baselineBytes),pins=baseline.publicPins;assert.equal(baseline.programVersion,'1.6.0');assert.equal(baseline.files.length,1007);
 assert.equal(pins.publisherPublicKeySha256,'6e8b9cadb59aeb53f30d41f4471f70f644f0dfc7376ffb9d8a4c62defb98458c');
 assert.equal(digest(crypto.createPublicKey(pins.publisherPublicKey).export({type:'spki',format:'der'})),pins.publisherPublicKeySha256);
 await u.assertPath(fs,path.resolve(BASE),{directory:true});await u.assertPath(fs,path.resolve(FEED),{directory:true});
 const envelopeBytes=await u.readSmall(fs,path.join(FEED,'catalog.json'),2097152);assert.equal(envelopeBytes.length,195265);assert.equal(digest(envelopeBytes),ENVELOPE_SHA);
 const envelope=JSON.parse(envelopeBytes);assert.equal(digest(Buffer.from(envelope.catalog)),RAW_SHA);
 const policy=u.createTrustedUpdatePolicy({trustedPublicKey:pins.publisherPublicKey,allowedFiles:pins.allowedFiles,currentVersion:'1.6.0',platform:'win32',arch:'x64'}),catalog=u.verifySignedCatalog(envelope,policy);
 assert.equal(catalog.version,'1.6.1');assert.equal(catalog.files.length,1007);assert.equal(catalog.archive.sha256,ZIP_SHA);assert.equal(catalog.archive.size,163493271);
 assert.deepEqual(catalog.files.map(f=>f.path).sort(),baseline.files.map(f=>f.path).sort());await checked(path.join(FEED,'package.zip'),catalog.archive,path.resolve(FEED));
 const parent=await core.mkdirs(fs,ROOT,'runtime/employee-update-tests'),root=path.join(parent,'real161-'+crypto.randomUUID());await fs.mkdir(root);await u.assertPath(fs,root,{directory:true});
 await put(root,'owner.json',JSON.stringify({purpose:'real161-offline-employee-update',syntheticProfile:true,root}));console.log(JSON.stringify({stage:'copying-verified-160',fixtureRoot:root}));
 const install=await core.mkdirs(fs,root,'program'),profile=await core.mkdirs(fs,root,'profile'),exe=path.join(install,pins.executableName);
 for(const f of baseline.files){assert(require('../project/desktop/employee-update-installer.cjs').programPath(f.path));await core.mkdirs(fs,install,f.path.split('/').slice(0,-1).join('/'));await core.copy(fs,path.join(BASE,...f.path.split('/')),path.join(install,...f.path.split('/')),f,path.resolve(BASE),install);}
 await core.copy(fs,path.join(BASE,pins.executableName),exe,ENGINE,path.resolve(BASE),install);
 const activation={version:1,product:'xjy-jewelry-offline',programVersion:'1.6.0',role:'employee',installationDir:install};await put(install,'xjy-install-activation.json',JSON.stringify(activation));
 const settings=Buffer.from('{"mode":"client","fixture":"preserve real161"}'),sentinel=Buffer.from('preserve synthetic employee configuration');
 await put(profile,'workspace-connection.json',settings);await put(install,'config/sentinel.txt',sentinel);
 let native,distribution,launch=null,request=null,exited=false,readyVerified=false,requests=0,restarts=[];
 const current={pid:4123,creationMarker:'di-employee-parent'},helperPid=6123;
 const processAdapter={inspect:async pid=>pid===current.pid?(exited?null:{...current,executablePath:exe,args:['--employee-client']}):pid===helperPid?{pid,creationMarker:'di-helper',executablePath:exe,args:[]}:null,listForInstallation:async()=>[],cancelHelper:async()=>({cancelled:true}),restart:async input=>{assert.equal(input.executablePath,exe);assert.equal(input.role,'employee');assert.deepEqual(input.args,['--employee-client']);restarts.push({role:input.role,args:input.args});return{started:true};}};
 processAdapter.launchHelper=async input=>{
  assert.equal(launch,null);assert.equal(input.executablePath,exe);assert.equal(input.shell,false);assert.equal(input.args.length,2);const handoff=path.dirname(input.args[0]);u.within(profile,handoff);assert.equal(path.basename(input.args[0]),'updater-helper.cjs');assert.equal(path.basename(input.args[1]),'request.json');
  for(const pin of pins.files)assert.equal(digest(await u.readSmall(fs,path.join(handoff,pin.name),1048576)),pin.sha256);
  const record=JSON.parse(await u.readSmall(fs,input.args[1],4194304)),secret=Buffer.from(input.env.XJY_UPDATE_CAPABILITY,'hex');assert.equal(secret.length,32);assert.equal(digest(Buffer.from(record.request)),input.requestHash);assert.equal(crypto.createHmac('sha256',secret).update(record.request).digest('hex'),record.mac);
  request=JSON.parse(record.request);assert.equal(request.operation,'install');assert.equal(request.currentVersion,'1.6.0');assert.equal(request.stage.catalog.version,'1.6.1');assert.equal(request.installDir,install);assert.equal(request.profileDir,profile);
  await fs.writeFile(input.readyPath,JSON.stringify({requestHash:input.requestHash,mac:crypto.createHmac('sha256',secret).update(input.requestHash).digest('hex')}),{flag:'wx'});readyVerified=true;launch=input;return{ready:true};
 };
 try{
  distribution=createUpdateDistribution({catalogFile:path.join(FEED,'catalog.json'),archiveFile:path.join(FEED,'package.zip'),trustedPublicKey:pins.publisherPublicKey,allowedFiles:pins.allowedFiles});
  const network={request:async input=>{requests++;assert.equal(input.method,'GET');assert.equal(input.body,undefined);if(input.path==='/api/employee-updates/catalog')return{ok:true,status:200,data:await distribution.getCatalog()};const url=new URL(input.path,'http://offline.invalid');assert.equal(url.origin,'http://offline.invalid');assert.equal(url.pathname,'/api/employee-updates/chunk');return{ok:true,status:200,data:await distribution.getChunk({sequence:Number(url.searchParams.get('sequence')),sha256:url.searchParams.get('sha256'),offset:Number(url.searchParams.get('offset')),length:Number(url.searchParams.get('length'))})};}};
  const actor={id:'12121212-1212-4121-8121-121212121212',username:'synthetic-real161-employee',active:true,authenticated:true,sessionRef:'di-fixed-login'};
  native=createNativeEmployeeUpdate({employeeClient:true,currentVersion:'1.6.0',profileDir:profile,installDir:install,executablePath:exe,helperPins:pins,network,resolveActor:async()=>actor,currentProcess:current,currentOsUser:'synthetic-real161-os-user',processAdapter,requestExit:async value=>{assert.deepEqual(value,{...current,normalExit:true});exited=true;}});
  assert.equal((await native.capability()).canInstall,true);const handoff=await native.run({intent:'install'});assert.equal(handoff.ok,true,JSON.stringify(handoff));assert.equal(handoff.state.phase,'handoff');assert(launch&&request&&readyVerified&&exited);assert(requests>1);
  const oldAsar=baseline.files.find(f=>f.path==='resources/app.asar');await checked(path.join(install,'resources/app.asar'),oldAsar,install);
  // Execute the actual hash-verified 160 handoff installer module, not its EXE
  // or updater-helper's OS process adapter. Cache extraction/transaction is real.
  const installedRunner=require(path.join(path.dirname(launch.args[0]),'employee-update-installer.cjs'));
  const runner=installedRunner.createEmployeeUpdateRunner({installDir:install,profileDir:profile,executablePath:exe,currentVersion:'1.6.0',clientRole:'employee',trustedPublicKey:pins.publisherPublicKey,allowedFiles:pins.allowedFiles,platform:'win32',arch:'x64',helperPid,processAdapter});
  const transaction=await runner.run({stage:request.stage,expectedVersion:request.expectedVersion,currentProcess:request.currentProcess,employee:true});assert.equal(transaction.installed,true);assert.equal(transaction.version,'1.6.1');assert.equal(transaction.restarted,true);assert.equal(restarts.length,1);
  for(const f of catalog.files)await checked(path.join(install,...f.path.split('/')),f,install);
  assert.equal((await installedRunner.asarIdentity(fs,path.join(install,'resources/app.asar'),install)).version,'1.6.1');
  assert.deepEqual(JSON.parse(await u.readSmall(fs,path.join(install,'xjy-install-activation.json'),4096)),{...activation,programVersion:'1.6.1'});
  await checked(exe,ENGINE,install);await checked(path.join(transaction.backupDir,'resources/app.asar'),oldAsar,install);assert.deepEqual(await fs.readFile(path.join(profile,'workspace-connection.json')),settings);assert.deepEqual(await fs.readFile(path.join(install,'config/sentinel.txt')),sentinel);
  const status=await u.authenticatedRead(fs,path.join(install,'.xjy-employee-updates/recovery-status.json'),profile,4096);assert.equal(status.phase,'committed');
  await native.close();native=null;await distribution.close();distribution=null;
  const result={passed:true,purpose:'real signed 160-to-161 offline employee component integration',actualContext,fixtureRoot:root,verifiedSourceFiles:1007,verifiedTargetFiles:1007,catalogSha256:RAW_SHA,envelopeSha256:ENVELOPE_SHA,zipSha256:ZIP_SHA,networkRequests:requests,readyRequestAuthenticated:readyVerified,targetVersion:'1.6.1',role:'employee',programBackup:transaction.backupDir,configurationPreserved:true,engineUnchanged:true,processHandoffDI:true,processExitDI:true,restartDI:restarts,exeExecuted:false,businessDatabaseOpened:false,nativeGuiVerified:false,elapsedMs:Date.now()-start};
  await fs.writeFile('C:/xjy-results/employee-real161-offline-a1.json',JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify(result));
 }finally{if(native)await native.close();if(distribution)await distribution.close();}
}
main().catch(error=>{console.error(error.stack||String(error));process.exitCode=1;});

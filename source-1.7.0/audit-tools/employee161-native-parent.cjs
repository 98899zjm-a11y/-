'use strict';
// Root-operated Guest probe. Runs inside the unchanged installed161 EXE as
// Node; only the original controller/helper may perform the approved handoff.
const fs=process.versions.electron?require('original-fs'):require('node:fs');
const path=require('node:path'),crypto=require('node:crypto'),os=require('node:os');
const ROOT=path.resolve('C:/xjy-work/xjy-web-stage1'),EMP=path.resolve('C:/xjy-native-installed-a1');
const SELF=path.join(ROOT,'audit-tools/employee161-native-parent.cjs'),CONTROLLER=path.join(ROOT,'audit-tools/employee161-rescue-controller.cjs');
const MATERIALS=path.join(ROOT,'runtime/employee162-a3-native-materials-a1'),ARTIFACT=path.join(MATERIALS,'artifact'),ARCHIVE=path.join(MATERIALS,'package.zip');
const EXE=path.join(EMP,'鑫金源珠宝报价.exe'),NS='36fcbe9c-ece1-4be3-af35-309a2ee19e05';
const CONTROLLER_SHA='ca5bd2200a1923964b6d84b39fb1faaf8c05c7de29021ade5ecd03aa0ae17812';
const CATALOG_SHA='37f7b97d7361c1c13384b8f9e8bf5603dc1064309748dc271ef49acea0e6d888';
const ENGINE={size:246302720,sha256:'db3ad2066a55546f9b6737da3c7f011370e4856fb36888055b544d45653e4f40'};
const ASAR={size:12541824,sha256:'7e4b04ef51c741f7da66da7e55cd5a280b792f32cd0a0fe8d19606f0996de07d'};
const CODE=Object.freeze({
 'stage1/guest-candidate-cdp.cjs':'59840b638d8797fb55241616cd0b8e4098075a76834a201b0e93c1a748f1bb32',
 'stage1/validate-sandbox-context.py':'867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207',
 'stage1/sandbox-context.py':'09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249',
 'delivery-tools/initial-patch-core.cjs':'0f9de31c8ad8ec7e1b870a92d025909f4606363801a31ee3582b903c5704bbce',
 'delivery-tools/initial-patch-entry.cjs':'4c0008c6f070c22255f3a2819ac82e9be774fbaf631030bb414c95bbcac6b161',
 'project/desktop/employee-update-cache.cjs':'5cb70079bf161a002a2701694e4774c2a11bf8d54efc6674ccb5c7b2c6729815',
 'project/desktop/employee-update-installer.cjs':'96ba3df08a0f706e599da7d452374b1f894d401c0a6ff605fc01255d01445bd0',
 'project/desktop/employee-recovery-entry.cjs':'d984126ad08263aa4ae6be3bc547db758e4d75b6b94bd3346ead21f8121f6fce',
 'project/desktop/updater-helper.cjs':'af630bf68db71b74840e591f34f1533e1636928d3fc83f2a09a1d8f76338bf58',
 'project/desktop/initial-upgrade-gate.cjs':'b74a80b83dfaf78f493671bf4bc339f68eeec4f2f89a71410e6cd7d7f78a1980'
});
const SHA=/^[a-f0-9]{64}$/,same=(a,b)=>path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
function need(value,code){if(!value)throw Object.assign(Error(code),{code});}
function optionsOf(argv){
 const out={},keys=['--source-sha256','--controller-sha256','--catalog-sha256'];
 for(let i=0;i<argv.length;i+=2){const key=argv[i];need(keys.includes(key)&&!Object.hasOwn(out,key)&&SHA.test(argv[i+1]||'')&&!/^0+$/.test(argv[i+1]),'EXACT_THREE_SHA_ARGUMENTS_REQUIRED');out[key]=argv[i+1];}
 need(Object.keys(out).length===3&&out['--controller-sha256']===CONTROLLER_SHA&&out['--catalog-sha256']===CATALOG_SHA,'FIXED_CONTROLLER_AND_SEQ9_CATALOG_REQUIRED');return out;
}
// Small ordinary local source checks only. Mapped input is admitted by the
// original guard; all trusted update materials are first copied under ROOT.
function plain(file){
 for(let current=file;;current=path.dirname(current)){
  const s=fs.lstatSync(current);need(!s.isSymbolicLink()&&same(fs.realpathSync.native(current),current)&&(current===file?s.isFile()&&s.nlink===1:s.isDirectory()),'ORDINARY_LOCAL_SOURCE_REQUIRED');
  if(current===path.dirname(current))break;
 }return file;
}
function read(file,pin,max=4194304){
 const before=fs.lstatSync(plain(file),{bigint:true}),fd=fs.openSync(file,'r');
 try{
  const opened=fs.fstatSync(fd,{bigint:true});need(opened.size<=BigInt(max),'BOUNDED_SOURCE_REQUIRED');
  const bytes=fs.readFileSync(fd),ended=fs.fstatSync(fd,{bigint:true}),after=fs.lstatSync(plain(file),{bigint:true});
  const common=s=>[s.dev,s.ino,s.size,s.mtimeNs,s.nlink].map(String).join(':'),stamp=s=>common(s)+':'+s.ctimeNs;
  need(common(before)===common(opened)&&stamp(before)===stamp(after)&&stamp(opened)===stamp(ended)&&bytes.length===Number(opened.size),'SOURCE_CHANGED');
  need(!pin||crypto.createHash('sha256').update(bytes).digest('hex')===pin,'SOURCE_SHA_MISMATCH');return bytes;
 }finally{fs.closeSync(fd);}
}
async function main(){
 need(require.main===module&&process.platform==='win32'&&process.versions.electron==='44.7.0'&&os.userInfo().username==='WDAGUtilityAccount'&&same(__filename,SELF)&&same(process.cwd(),ROOT)&&same(process.execPath,EXE),'FIXED_ORIGINAL161_GUEST_PARENT_REQUIRED');
 need(process.env.ELECTRON_RUN_AS_NODE==='1'&&!process.env.NODE_OPTIONS&&!process.env.NODE_PATH&&!process.env.XJY_UPDATE_CAPABILITY&&!globalThis.__xjyStage1Guard&&process.execArgv.length===0,'CLEAN_ORIGINAL_ELECTRON_NODE_REQUIRED');
 const options=optionsOf(process.argv.slice(2));
 read(SELF,options['--source-sha256']);read(CONTROLLER,CONTROLLER_SHA);
 for(const [name,pin]of Object.entries(CODE))read(path.join(ROOT,name),pin);
 const {actualGuard}=require(path.join(ROOT,'stage1/guest-candidate-cdp.cjs'));
 const proof=actualGuard();need(proof.productionDrivePresent===false&&proof.nonLoopbackAddressCount===0&&proof.model==='Virtual Machine','ORIGINAL_ACTUAL_GUEST_GUARD_REQUIRED');
 need(JSON.parse(read(path.join(ROOT,'isolation-identity.json'))).namespace===NS,'FIXED_ROOT36_NAMESPACE_REQUIRED');
 console.log(JSON.stringify({phase:'actual-guest-admitted',sourceVersion:'1.6.1',targetVersion:'1.6.2',scheduled:false}));
 const core=require(path.join(ROOT,'delivery-tools/initial-patch-core.cjs')),u=require(path.join(ROOT,'project/desktop/employee-update-cache.cjs'));
 for(const [file,pin]of [[EXE,ENGINE],[path.join(EMP,'resources/app.asar'),ASAR]]){
  const info=await core.fileHash(fs.promises,file,EMP);need(info.size===pin.size&&info.sha256===pin.sha256,'ORIGINAL161_ENGINE_AND_ASAR_REQUIRED');
 }
 const envelope=JSON.parse(await u.readSmall(fs.promises,path.join(ARTIFACT,'catalog-envelope.json'),2097152));
 need(typeof envelope.catalog==='string'&&u.digest(Buffer.from(envelope.catalog))===CATALOG_SHA,'FIXED_SEQ9_CATALOG_BYTES_REQUIRED');
 const entry=require(path.join(ROOT,'delivery-tools/initial-patch-entry.cjs'));
 const nativeAuthority=await entry.resolveRepeatNativeAuthority({artifactDir:ARTIFACT});
 need(nativeAuthority.publicationId===CATALOG_SHA,'ACTUAL_PUBLICATION_AUTHORITY_REQUIRED');
 // Recheck executable sources immediately before the only update call. The
 // controller independently verifies approval, role, tuple, profile and ZIP.
 read(SELF,options['--source-sha256']);read(CONTROLLER,CONTROLLER_SHA);
 for(const [name,pin]of Object.entries(CODE))read(path.join(ROOT,name),pin);
 const result=await require(CONTROLLER).runEmployee161Rescue({artifactDir:ARTIFACT,archivePath:ARCHIVE,nativeAuthority});
 need(result?.scheduled===true&&result.requiresNormalExit===true&&result.sourceVersion==='1.6.1'&&result.targetVersion==='1.6.2','ORIGINAL_HANDOFF_NOT_CONFIRMED');
 console.log(JSON.stringify({phase:'original-helper-ready-returning-normally',scheduled:true,requiresNormalExit:true,sourceVersion:result.sourceVersion,targetVersion:result.targetVersion}));
 // No process.exit and no signal: after the original controller closes cache
 // and inventory handles, this actual parent ends naturally for waitClosed.
}
main().catch(error=>{
 const code=typeof error?.code==='string'&&/^[A-Z0-9_]{1,80}$/.test(error.code)?error.code:'NATIVE_PARENT_FAILED';
 console.error(JSON.stringify({phase:'failed',scheduled:false,code}));process.exitCode=1;
});

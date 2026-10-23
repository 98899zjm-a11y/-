'use strict';
// Build-time public-only helper bundle. No private key or business import.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {safeAbsolute,safeRelative,assertPath,openChecked,assertHandle,readSmall,writeExactly,digest,freeze,fail}=require('./employee-update-cache.cjs');
const {programPath}=require('./employee-update-installer.cjs');
const SOURCE_PINS=Object.freeze({
 'employee-update-cache.cjs':'5cb70079bf161a002a2701694e4774c2a11bf8d54efc6674ccb5c7b2c6729815',
 'employee-update-installer.cjs':'96ba3df08a0f706e599da7d452374b1f894d401c0a6ff605fc01255d01445bd0',
 'updater-helper.cjs':'e60b4c84413e215f06f50f3320b5621ba5d1b439ab0167e2a1d4ab810a6bcb90'
});
async function buildUpdateHelper({outputDir,programVersion,executableName,publicKeyFile,allowedFiles}){
 const output=safeAbsolute(outputDir),publicFile=safeAbsolute(publicKeyFile);if(typeof programVersion!=='string'||!/^1\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(programVersion)||programVersion.split('.').some(part=>!Number.isSafeInteger(Number(part)))||typeof executableName!=='string'||!safeRelative(executableName)||!executableName.toLowerCase().endsWith('.exe')||executableName.length>200||/[\\/]/.test(executableName))throw new TypeError('Fixed version and employee executable name required');
 if(!Array.isArray(allowedFiles)||!allowedFiles.length||allowedFiles.length>4096||new Set(allowedFiles.map(v=>typeof v==='string'?v.toLowerCase():v)).size!==allowedFiles.length||allowedFiles.some(v=>!programPath(v))||!allowedFiles.includes('resources/app.asar'))throw new TypeError('Exact data-free program allowlist required');
 await assertPath(fs,path.dirname(output),{directory:true});await assertPath(fs,output,{missing:true});const keyBytes=await readSmall(fs,publicFile,8192);if(!/^-----BEGIN PUBLIC KEY-----\r?\n/.test(keyBytes.toString('utf8'))||keyBytes.includes(Buffer.from('PRIVATE KEY')))fail('PUBLIC_KEY_REQUIRED','Only the approved public key file may enter a helper bundle');const key=crypto.createPublicKey(keyBytes);if(key.asymmetricKeyType!=='ed25519')fail('PUBLIC_KEY_REQUIRED','Ed25519 publisher public key required');const publisherPublicKey=key.export({type:'spki',format:'pem'}),publisherPublicKeySha256=digest(key.export({type:'spki',format:'der'}));
 const bytes={};for(const [name,pin]of Object.entries(SOURCE_PINS)){bytes[name]=await readSmall(fs,path.join(__dirname,name));if(digest(bytes[name])!==pin)fail('SOURCE_CHANGED','Frozen update helper source changed: '+name);}
 const bootstrap={version:1,product:'xjy-jewelry-offline',programVersion,executableName,platform:'win32',arch:'x64',publisherPublicKey,allowedFiles:[...allowedFiles],dependencies:['employee-update-installer.cjs','employee-update-cache.cjs'].map(name=>({name,sha256:digest(bytes[name])}))};bytes['bootstrap.json']=Buffer.from(JSON.stringify(bootstrap));const bootstrapSha256=digest(bytes['bootstrap.json']),token='__XJY_UPDATE_BOOTSTRAP_SHA256__',source=bytes['updater-helper.cjs'].toString('utf8');if(source.split(token).length!==2)fail('SOURCE_CHANGED','Exactly one build bootstrap placeholder required');bytes['updater-helper.cjs']=Buffer.from(source.replace(token,bootstrapSha256));
 // CreateNew directory and files; an existing output is never repaired/overwritten.
 await fs.mkdir(output,{mode:0o700});await assertPath(fs,output,{directory:true});const files=[];for(const name of ['updater-helper.cjs','employee-update-installer.cjs','employee-update-cache.cjs','bootstrap.json']){const file=path.join(output,name),o=await openChecked(fs,file,'wx+',{missing:true,root:output});try{await writeExactly(o.handle,0,bytes[name]);await o.handle.sync();await assertHandle(fs,o,{snapshot:false,root:output});}finally{await o.handle.close();}files.push({name,size:bytes[name].length,sha256:digest(bytes[name])});}
 return freeze({version:1,product:'xjy-jewelry-offline',programVersion,executableName,publisherPublicKey,publisherPublicKeySha256,allowedFiles:[...allowedFiles],bootstrapSha256,files});
}
module.exports={buildUpdateHelper,SOURCE_PINS};

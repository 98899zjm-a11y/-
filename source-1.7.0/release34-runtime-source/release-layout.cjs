'use strict';
// Runtime layout is an authenticated configuration, never an actor grant.
// This module neither opens databases nor creates accounts or directories.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const PURPOSE='xjy-desktop-module',PREFIX='xjy-module-runtime-v1\0',FILE='module-runtime-context.json',MAX=16*1024;
const FIELDS=['codeDir','dataDir','hostId','module','profileDir','purpose','retainedDir','runtimeDir','version'];
const OPTIONS=['codeDir','dataDir','hostId','moduleId','profileDir','runtimeDir','token'];
function fail(message){throw new Error('DESKTOP_RUNTIME: '+message);}
function keys(value,expected){if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).sort().join('\0')!==expected.join('\0'))fail('unexpected fields');}
function tokenKey(token){if(typeof token!=='string'||Buffer.byteLength(token,'utf8')<32||Buffer.byteLength(token,'utf8')>1024||/[\x00-\x1f\x7f]/.test(token))fail('invalid module token');return token;}
function normal(value){
 if(typeof value!=='string'||!value||value.length>4096||/[\x00-\x1f\x7f]/.test(value)||/^[\\/]{2}/.test(value))fail('ordinary local absolute path required');
 const win=process.platform==='win32';
 if(win?!/^[A-Za-z]:[\\/]/.test(value):!path.isAbsolute(value))fail('ordinary local absolute path required');
 const tail=win?value.slice(3):value.slice(1);
 if(tail.includes(':')||(!win&&value.includes('\\'))||tail.split(/[\\/]/).some(x=>x==='.'||x==='..'||/[. ]$/.test(x)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(x)))fail('path alias, stream or device refused');
 return path.resolve(value);
}
function checked(value,kind='directory',allowMissing=false){
 const absolute=normal(value);let selected;
 for(let current=absolute;;current=path.dirname(current)){
  let stat;try{stat=fs.lstatSync(current);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(stat){if(stat.isSymbolicLink())fail('linked path refused');if(current===absolute)selected=stat;if(current!==absolute&&!stat.isDirectory())fail('path ancestor is not a directory');}
  if(current===path.dirname(current))break;
 }
 if(!selected){if(!allowMissing)fail('path must already exist');let parent=absolute;while(!fs.existsSync(parent))parent=path.dirname(parent);return path.resolve(fs.realpathSync.native(parent),path.relative(parent,absolute));}
 if(kind==='directory'&&!selected.isDirectory()||kind==='file'&&(!selected.isFile()||selected.nlink!==1))fail('wrong path type or hardlinked file');
 return fs.realpathSync.native(absolute);
}
function same(a,b){return(process.platform==='win32'?a.toLowerCase():a)===(process.platform==='win32'?b.toLowerCase():b);}
function inside(parent,child){const relative=path.relative(parent,child);return relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative));}
function overlap(a,b){return inside(a,b)||inside(b,a);}
function validate(value){
 keys(value,FIELDS);
 if(value.version!==1||value.purpose!==PURPOSE||!['ledger','inventory'].includes(value.module)||typeof value.hostId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value.hostId))fail('invalid context identity');
 const data=checked(value.dataDir),profile=checked(value.profileDir),runtime=checked(value.runtimeDir),code=checked(value.codeDir),retained=checked(value.retainedDir,'directory',true);
 if(!same(retained,path.join(profile,'retained')))fail('retained directory is fixed');
 if(same(profile,runtime)||!inside(profile,runtime))fail('runtime must be below profile');
 if(overlap(data,profile)||overlap(data,code)||inside(code,profile)||inside(code,runtime)||overlap(code,retained))fail('unsafe directory overlap');
 const contextFile=path.join(runtime,FILE);
 if(inside(code,contextFile))fail('context file cannot be in code');
 checked(contextFile,'file',true);
 return contextFile;
}
function canonical(value){return JSON.stringify(Object.fromEntries(FIELDS.map(key=>[key,value[key]])));}
function signatureFor(json,token){return crypto.createHmac('sha256',tokenKey(token)).update(PREFIX+json,'utf8').digest('hex');}
function createDesktopModuleContext(options){
 keys(options,OPTIONS);tokenKey(options.token);
 const value={version:1,purpose:PURPOSE,module:options.moduleId,hostId:typeof options.hostId==='string'?options.hostId.toLowerCase():options.hostId,dataDir:checked(options.dataDir),profileDir:checked(options.profileDir),runtimeDir:checked(options.runtimeDir),codeDir:checked(options.codeDir)};
 value.retainedDir=path.join(value.profileDir,'retained');const contextFile=validate(value),canonicalJson=canonical(value);
 if(Buffer.byteLength(canonicalJson,'utf8')>MAX)fail('context exceeds 16KiB');
 return Object.freeze({contextFile,canonicalJson,signature:signatureFor(canonicalJson,options.token)});
}
function writeSignedContext(signed,token){
 keys(signed,['canonicalJson','contextFile','signature']);
 if(typeof signed.canonicalJson!=='string'||Buffer.byteLength(signed.canonicalJson,'utf8')>MAX||typeof signed.signature!=='string'||!/^[a-f0-9]{64}$/.test(signed.signature))fail('invalid signed context');
 const expected=signatureFor(signed.canonicalJson,token);if(!crypto.timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(signed.signature,'hex')))fail('context signature mismatch');
 let value;try{value=JSON.parse(signed.canonicalJson);}catch{fail('invalid context JSON');}
 const target=validate(value);if(canonical(value)!==signed.canonicalJson||!same(normal(signed.contextFile),target))fail('noncanonical context or wrong destination');
 const temporary=path.join(value.runtimeDir,'.module-runtime-context-'+crypto.randomUUID()+'.tmp');let descriptor,created;
 try{
  checked(temporary,'file',true);descriptor=fs.openSync(temporary,'wx',0o600);created=fs.fstatSync(descriptor);fs.writeFileSync(descriptor,signed.canonicalJson,'utf8');fs.fsyncSync(descriptor);fs.closeSync(descriptor);descriptor=undefined;
  if(!same(validate(value),target))fail('context destination changed');const stat=fs.lstatSync(checked(temporary,'file'));if(stat.dev!==created.dev||stat.ino!==created.ino)fail('context temporary file changed');
  fs.renameSync(temporary,target);return target;
 }finally{
  if(descriptor!==undefined)fs.closeSync(descriptor);
  // Revalidate before cleanup; never follow a replaced parent or linked file.
  if(created)try{const current=checked(temporary,'file',true);if(fs.existsSync(current)){const stat=fs.lstatSync(current);if(stat.dev===created.dev&&stat.ino===created.ino)fs.unlinkSync(current);}}catch{}
 }
}
module.exports={createDesktopModuleContext,writeSignedContext};

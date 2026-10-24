'use strict';
// A program-side build record, never a user setting or renderer assertion.
const fs=require('node:fs'),path=require('node:path');
function readMaterialsRuntimeCapability({codeDir}={}){
 if(typeof codeDir!=='string'||!path.isAbsolute(codeDir))throw TypeError('Explicit program directory required');
 const directory=path.resolve(codeDir),file=path.join(directory,'materials-runtime-capability.json');
 let before;try{before=fs.lstatSync(file);}catch(error){if(error.code==='ENOENT')return false;throw error;}
 const invalid=()=>{throw Error('素材运行时能力记录未通过程序来源核验');};
 if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.size>1024)invalid();
 const realRoot=fs.realpathSync(directory),realFile=fs.realpathSync(file);
 if(realRoot.toLowerCase()!==directory.toLowerCase()||path.relative(realRoot,realFile)!=='materials-runtime-capability.json')invalid();
 const handle=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
 try{
  const opened=fs.fstatSync(handle);if(!opened.isFile()||opened.nlink!==1||opened.size>1024||opened.dev!==before.dev||opened.ino!==before.ino)invalid();
  const bytes=fs.readFileSync(handle),after=fs.fstatSync(handle),current=fs.lstatSync(file);
  if(bytes.length>1024||after.size!==bytes.length||after.ino!==opened.ino||after.dev!==opened.dev||after.mtimeMs!==opened.mtimeMs||current.isSymbolicLink()||current.nlink!==1||current.ino!==opened.ino||current.dev!==opened.dev)invalid();
  const value=JSON.parse(bytes.toString('utf8'));
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['version','enabled'].includes(key))||value.version!==1||typeof value.enabled!=='boolean')invalid();
  return value.enabled;
 }finally{fs.closeSync(handle);}
}
module.exports={readMaterialsRuntimeCapability};

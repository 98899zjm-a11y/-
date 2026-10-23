'use strict';
// Capture path-inspection primitives before global IO hooks are installed.
const original=require('node:fs'),fs=Object.fromEntries(['existsSync','lstatSync','statSync'].map(k=>[k,original[k].bind(original)])),path=require('node:path');
fs.realpathSync={native:original.realpathSync.native.bind(original)};
class IsolationError extends Error{constructor(message){super('ISOLATION: '+message);this.code='ISOLATION';this.status=403;}}
const fail=message=>{throw new IsolationError(message);};
const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino;
function plain(value){
 if(typeof value!=='string'||!value||/[\x00-\x1f]/.test(value)||/^\\\\|^\/\/|^[a-z]+:\/\//i.test(value))fail('only canonical local paths are accepted');
 if(process.platform==='win32'&&(!/^[a-z]:[\\/]/i.test(value)||value.slice(2).includes(':')))fail('drive-relative, device and alternate streams are forbidden');
 for(const part of value.replaceAll('/','\\').split('\\'))if(/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)||/[ .]$/.test(part))fail('reserved path segment');
 return path.resolve(value);
}
const contained=(root,target)=>{const relative=path.relative(root.toLowerCase(),target.toLowerCase());return relative===''||!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);};
function ancestors(target){const result=[];let cursor=target;while(true){let stat;try{stat=fs.lstatSync(cursor,{bigint:true});}catch(e){if(e.code!=='ENOENT')throw e;}if(stat){if(stat.isSymbolicLink())fail('symbolic link or junction rejected');if(stat.isFile()&&stat.nlink>1)fail('hard-linked data file rejected');result.push({path:cursor,stat});}const parent=path.dirname(cursor);if(parent===cursor)break;cursor=parent;}return result;}
function createIsolationGuard(input){
 const requested=plain(input);ancestors(requested);if(!fs.existsSync(requested)||!fs.statSync(requested).isDirectory())fail('explicit existing isolated directory is required');
 const root=fs.realpathSync.native(requested),identity=fs.statSync(root,{bigint:true});
 if(!identity.ino)fail('filesystem identity cannot be established');
 function assertPath(value){
  const lexical=plain(value);if(!contained(root,lexical))fail('target is outside isolated root');
  if(!same(identity,fs.statSync(root,{bigint:true})))fail('isolated root identity changed');
  const trail=ancestors(lexical);let cursor=lexical,tail=[];
  while(!fs.existsSync(cursor)){tail.unshift(path.basename(cursor));const parent=path.dirname(cursor);if(parent===cursor)fail('cannot resolve physical ancestor');cursor=parent;}
  const resolved=path.resolve(fs.realpathSync.native(cursor),...tail);if(!contained(root,resolved))fail('physical target escaped isolated root');
  // Textual case-insensitive containment is not sufficient on case-sensitive
  // Windows directories: verify the root object in the actual ancestry.
  if(!trail.some(item=>same(item.stat,identity)))fail('target ancestry does not contain isolated root object');
  return resolved;
 }
 function validateLayout(value){if(!value||typeof value!=='object'||Array.isArray(value))fail('explicit layout required');const required=['dataDir','ledgerDir','inventoryDir'];for(const key of required)if(typeof value[key]!=='string')fail('missing '+key);const output={};for(const [key,target]of Object.entries(value)){if(!key.endsWith('Dir')||typeof target!=='string')fail('unexpected layout entry');output[key]=assertPath(target);}return output;}
 function validatePort(port,host){if(host!=='127.0.0.1'||!Number.isInteger(port)||port!==0&&(port<1024||port>65535)||port===31831)fail('only isolated unprivileged loopback ports are allowed');return port;}
 return Object.freeze({root,assertPath,validateLayout,validatePort,assertDatabase:assertPath});
}
module.exports={createIsolationGuard,IsolationError};

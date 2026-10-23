'use strict';
// Root-only read-only CLI probe. Block any F-drive/private-key fs call before
// delegating; only the evidence file is written with a saved standard fs API.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');assert.equal(root.toLowerCase(),'e:\\codex\\2026-10-15\\work\\xjy-v16-deep-audit');
const report=path.join(root,'audit-evidence/publish162-main-check-only-no-f-20261019-a2.json');
const save=fs.writeFileSync.bind(fs),exists=fs.existsSync.bind(fs);assert(!exists(report),'CreateNew evidence only');
let intercepted=0;const blocked=[];
function inspect(args,method){for(const value of args){const name=Buffer.isBuffer(value)?value.toString():typeof value==='string'?value:value instanceof URL?value.href:null;if(!name)continue;intercepted++;if(/^f:[\\/]/i.test(name)||/issuer-private\.pem/i.test(name)){blocked.push({method,path:name});throw Error('PROHIBITED_FILESYSTEM_TARGET');}}}
const names=['access','appendFile','chmod','chown','copyFile','cp','exists','lstat','mkdir','mkdtemp','open','opendir','readFile','readdir','readlink','realpath','rename','rm','rmdir','stat','symlink','truncate','unlink','utimes','watch','writeFile','createReadStream','createWriteStream'];
for(const object of [fs,fs.promises])for(const base of names)for(const name of [base,base+'Sync'])if(typeof object[name]==='function'){const original=object[name];const wrapped=function(...args){inspect(args,name);return original.apply(this,args);};Object.assign(wrapped,original);if(typeof original.native==='function')wrapped.native=function(...args){inspect(args,name+'.native');return original.native.apply(this,args);};object[name]=wrapped;}
process.on('exit',code=>{const value={purpose:'actual162-publisher-main-check-only-filesystem-sensor',exitCode:code,passed:code===0&&blocked.length===0,interceptedPathArguments:intercepted,blockedAttempts:blocked,scope:'exported Node fs and fs.promises methods; independent source review also required',productionProfileAccessed:false,privateKeyRead:false,publicationInvoked:false};save(report,JSON.stringify(value,null,2)+'\n',{flag:'wx'});});

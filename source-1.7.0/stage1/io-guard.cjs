'use strict';
const fs=require('node:fs'),path=require('node:path'),{fileURLToPath}=require('node:url');
const {createIsolationGuard,IsolationError}=require('./isolation.cjs');
let active=false;
function install({root,writeDirs,readDirs=[],childPrograms=[]}){
 if(active)throw new IsolationError('IO guard must be installed once, before business imports');
 const guard=createIsolationGuard(root),writes=writeDirs.map(x=>createIsolationGuard(guard.assertPath(x))),reads=readDirs.map(x=>createIsolationGuard(x));
 const fds=new Map(),children=new Map(childPrograms.map(x=>[path.resolve(x.program).toLowerCase(),x]));
 const deny=m=>{throw new IsolationError(m);};
 const target=v=>v instanceof URL?fileURLToPath(v):Buffer.isBuffer(v)?v.toString():v;
 function check(v,write=false){
  if(typeof v==='number'){const entry=fds.get(v);if(!entry||write&&!entry.write)deny('unknown or read-only file descriptor');return entry.path;}
  v=target(v);if(typeof v!=='string')deny('explicit path required');
  const absolute=path.isAbsolute(v)?v:path.resolve(v);
  if(write){for(const g of writes){try{return g.assertPath(absolute);}catch(e){if(e.code!=='ISOLATION')throw e;}}deny('write outside private mutable directories');}
  try{return guard.assertPath(absolute);}catch(e){if(e.code!=='ISOLATION')throw e;}
  for(const g of reads){try{return g.assertPath(absolute);}catch(e){if(e.code!=='ISOLATION')throw e;}}deny('read outside isolated data or registered code dependency');
 }
 // Some trusted file validators lstat every parent up to the volume root to
 // reject junctions. Those exact directory metadata queries confer no content
 // read, enumeration, handle or write authority on the surrounding filesystem.
 const ancestorOwners=new Map(),lstatSync=fs.lstatSync;
 for(const g of [guard,...reads])for(let p=path.dirname(g.root);p!==g.root;){
  const key=p.toLowerCase(),identity=lstatSync(p,{bigint:true}),entry=ancestorOwners.get(key)||{owners:[],identity};
  if(!identity.isDirectory()||identity.isSymbolicLink()||!identity.ino||entry.identity.dev!==identity.dev||entry.identity.ino!==identity.ino)deny('ambiguous or invalid registered ancestor directory');
  entry.owners.push(g);ancestorOwners.set(key,entry);
  const next=path.dirname(p);if(next===p)break;p=next;
 }
 fs.lstatSync=function(value,...options){
  try{check(value,false);}catch(error){
   if(error.code!=='ISOLATION')throw error;
   const name=target(value);
   if(typeof name!=='string'||!path.isAbsolute(name)||/[\x00-\x1f]/.test(name)||/^\\\\|^\/\/|^[a-z]+:\/\//i.test(name)||process.platform==='win32'&&(!/^[a-z]:[\\/]/i.test(name)||name.slice(2).includes(':')))throw error;
   const canonical=path.resolve(name);
   if(canonical.toLowerCase()!==name.toLowerCase())throw error;
   const entry=ancestorOwners.get(canonical.toLowerCase());if(!entry)throw error;
   // Recheck physical ancestry and the registered root's identity on every
   // exceptional query; a renamed root or replacement junction is never trusted.
   try{for(const owner of entry.owners)owner.assertPath(owner.root);}catch{deny('registered root ancestry or identity changed');}
   const identity=lstatSync.call(this,name,{bigint:true});
   if(!identity.isDirectory()||identity.isSymbolicLink()||entry.identity.dev!==identity.dev||entry.identity.ino!==identity.ino)deny('ancestor directory identity changed');
   const stat=lstatSync.call(this,name,...options);
   if(!stat||!stat.isDirectory()||stat.isSymbolicLink())deny('ancestor metadata requires an ordinary directory');
   return stat;
  }
  return lstatSync.call(this,value,...options);
 };
 const writing=flags=>typeof flags==='number'?(flags&(fs.constants.O_WRONLY|fs.constants.O_RDWR|fs.constants.O_CREAT|fs.constants.O_TRUNC|fs.constants.O_APPEND))!==0:/[wa+]/.test(flags||'r');
 const syncWrite=['writeFileSync','appendFileSync','truncateSync','unlinkSync','rmSync','rmdirSync','mkdirSync','chmodSync','chownSync','utimesSync','lutimesSync','lchownSync','lchmodSync'];
 const syncRead=['readFileSync','readdirSync','readlinkSync','statSync','statfsSync','existsSync','accessSync','opendirSync','realpathSync'];
 const callbackWrite=syncWrite.map(x=>x.replace(/Sync$/,'')),callbackRead=syncRead.filter(x=>x!=='existsSync').map(x=>x.replace(/Sync$/,''));
 for(const [names,write]of [[syncWrite,true],[syncRead,false],[callbackWrite,true],[callbackRead,false]])for(const name of names){
  const original=fs[name];if(!original)continue;
  const wrapped=function(...args){check(args[0],write);return original.apply(this,args);};
  if(original.native)wrapped.native=function(...args){check(args[0],write);return original.native.apply(this,args);};fs[name]=wrapped;
 }
 for(const [names,write]of [[callbackWrite,true],[callbackRead,false]])for(const name of names){const original=fs.promises[name];if(!original)continue;fs.promises[name]=async function(...args){check(args[0],write);return original.apply(this,args);};}
 // Keep callback/promise lstat on the ordinary registered-root read policy.
 const lstat=fs.lstat,pLstat=fs.promises.lstat;
 fs.lstat=function(...args){check(args[0],false);return lstat.apply(this,args);};
 fs.promises.lstat=async function(...args){check(args[0],false);return pLstat.apply(this,args);};
 for(const name of ['copyFileSync','copyFile','renameSync','rename']){
  const original=fs[name];fs[name]=function(...args){check(args[0],name.startsWith('rename'));check(args[1],true);return original.apply(this,args);};
 }
 for(const name of ['copyFile','rename']){const original=fs.promises[name];fs.promises[name]=async function(...args){check(args[0],name==='rename');check(args[1],true);return original.apply(this,args);};}
 for(const name of ['cp','cpSync','symlink','symlinkSync','link','linkSync','watch','watchFile'])if(fs[name])fs[name]=()=>deny('recursive native copy, links and unbounded watchers are not enabled');
 for(const name of ['cp','symlink','link','watch'])if(fs.promises[name])fs.promises[name]=async()=>deny('links and recursive native copies are not enabled');
 const openSync=fs.openSync,open=fs.open,closeSync=fs.closeSync,close=fs.close;
 fs.openSync=function(filename,flags,...args){const resolved=check(filename,writing(flags));const fd=openSync.call(this,filename,flags,...args);fds.set(fd,{path:resolved,write:writing(flags)});return fd;};
 fs.open=function(filename,flags,...args){const resolved=check(filename,writing(flags)),callback=args.pop();return open.call(this,filename,flags,...args,(err,fd)=>{if(!err)fds.set(fd,{path:resolved,write:writing(flags)});callback(err,fd);});};
 fs.closeSync=function(fd){const result=closeSync.call(this,fd);fds.delete(fd);return result;};
 fs.close=function(fd,cb){return close.call(this,fd,err=>{if(!err)fds.delete(fd);cb(err);});};
 for(const [names,write]of [[['readSync','read','readvSync','readv','fstatSync','fstat'],false],[['writeSync','write','writevSync','writev','ftruncateSync','ftruncate','fsyncSync','fsync','fdatasyncSync','fdatasync','fchmodSync','fchmod','fchownSync','fchown','futimesSync','futimes'],true]])for(const name of names){const original=fs[name];if(original)fs[name]=function(...args){check(args[0],write);return original.apply(this,args);};}
 const pOpen=fs.promises.open;fs.promises.open=async function(filename,flags,...args){const resolved=check(filename,writing(flags)),handle=await pOpen.call(this,filename,flags,...args);fds.set(handle.fd,{path:resolved,write:writing(flags)});for(const name of ['appendFile','chmod','chown','datasync','sync','truncate','utimes','write','writeFile','writev','createWriteStream']){const original=handle[name];if(original)handle[name]=function(...values){check(this.fd,true);return original.apply(this,values);};}const originalClose=handle.close;handle.close=async function(){const fd=this.fd;await originalClose.call(this);fds.delete(fd);};return handle;};
 for(const [name,write]of [['createReadStream',false],['createWriteStream',true]]){const original=fs[name];fs[name]=function(filename,options){check(options?.fd??filename,write);return original.call(this,filename,options);};}
 const sqlite=require('node:sqlite'),NativeDB=sqlite.DatabaseSync,rawExec=NativeDB.prototype.exec,rawPrepare=NativeDB.prototype.prepare,rawAuthorizer=NativeDB.prototype.setAuthorizer,rawBackup=sqlite.backup;
 function sqlCheck(sql){if(typeof sql!=='string'||/\b(?:ATTACH|DETACH|load_extension)\b/i.test(sql)||/\bVACUUM\s+(?:[\w"`]+\s+)?INTO\b/i.test(sql))deny('SQL file access is prohibited; use guarded backup API');}
 const authorizer=(custom)=>(action,...args)=>action===sqlite.constants.SQLITE_ATTACH||action===sqlite.constants.SQLITE_DETACH||action===sqlite.constants.SQLITE_FUNCTION&&args.some(x=>String(x).toLowerCase()==='load_extension')?sqlite.constants.SQLITE_DENY:custom?custom(action,...args):sqlite.constants.SQLITE_OK;
 sqlite.DatabaseSync=function IsolatedDatabase(filename,options={}){check(filename,true);const db=new NativeDB(filename,{...options,allowExtension:false});rawAuthorizer.call(db,authorizer());db.enableDefensive(true);return db;};
 sqlite.DatabaseSync.prototype=NativeDB.prototype;Object.defineProperty(NativeDB.prototype,'constructor',{value:sqlite.DatabaseSync,writable:false,configurable:false});
 NativeDB.prototype.exec=function(sql){sqlCheck(sql);return rawExec.call(this,sql);};NativeDB.prototype.prepare=function(sql){sqlCheck(sql);return rawPrepare.call(this,sql);};
 NativeDB.prototype.setAuthorizer=function(fn){if(fn!=null&&typeof fn!=='function')deny('invalid authorizer');return rawAuthorizer.call(this,authorizer(fn));};
 NativeDB.prototype.enableLoadExtension=NativeDB.prototype.loadExtension=NativeDB.prototype.deserialize=()=>deny('native extension and database payload loading prohibited');
 sqlite.backup=async function(db,filename,options={}){check(filename,true);return rawBackup(db,filename,options);};
 const cp=require('node:child_process');
 for(const name of ['exec','execSync','execFileSync','spawnSync','fork','execFile'])cp[name]=()=>deny('shell and unregistered process launch prohibited');
 const spawn=cp.spawn;cp.spawn=function(program,args=[],options={}){
  if(options.shell||options.detached||!Array.isArray(args))deny('shell, detached and invalid process launch');
  const item=children.get(path.resolve(program).toLowerCase());if(!item||!item.validate(args,options))deny('unregistered child process');
  let ownedHandles=[];
  if(options.stdio==='ignore'){const id=require('node:crypto').randomUUID(),input=path.join(root,'runtime','child-'+id+'.stdin');fs.writeFileSync(input,'');ownedHandles=[fs.openSync(input,'r'),fs.openSync(path.join(root,'logs','child-'+id+'.stdout'),'w'),fs.openSync(path.join(root,'logs','child-'+id+'.stderr'),'w')];options={...options,stdio:ownedHandles};}
  if(!Array.isArray(options.stdio)||options.stdio.length!==3)deny('registered children require isolated file-backed stdio');options.stdio.forEach((fd,i)=>check(fd,i>0));
  check(options.cwd);const clean={};for(const name of ['SystemRoot','WINDIR','PATH','PATHEXT'])if(process.env[name])clean[name]=process.env[name];
  for(const [k,v]of Object.entries(options.env||{})){if(!/^(?:XJY_STAGE1_|XJY_MODULE_|LEDGER_|STOCKCHECK_|PYTHONNOUSERSITE$|PYTHONDONTWRITEBYTECODE$|PYTHONIOENCODING$|PYTHONUTF8$|TEMP$|TMP$|APPDATA$|LOCALAPPDATA$)/.test(k))continue;if(/(?:DIR|PATH|HOME|TEMP|TMP|DATA)$/.test(k)&&v)check(v);clean[k]=v;}
  try{return spawn(program,args,{...options,env:clean,windowsHide:true,detached:false,shell:false});}finally{ownedHandles.forEach(x=>fs.closeSync(x));}
 };
 const net=require('node:net'),listen=net.Server.prototype.listen,connect=net.Socket.prototype.connect;
 function socketTarget(args){const x=args[0];return typeof x==='object'?{port:x.port,host:x.host}:{port:x,host:args[1]};}
 net.Server.prototype.listen=function(...args){const{port,host}=socketTarget(args);guard.validatePort(port,host);return listen.apply(this,args);};
 net.Socket.prototype.connect=function(...args){let opts=args[0];if(Array.isArray(opts))opts=opts[0];const{port,host}=typeof opts==='object'?opts:socketTarget(args);guard.validatePort(Number(port),host);return connect.apply(this,args);};
 require('node:dgram').createSocket=()=>deny('UDP not enabled in isolated test host');
 require('node:worker_threads').Worker=class{constructor(){deny('unregistered worker');}};
 require('node:module').syncBuiltinESMExports();active=true;
 return Object.freeze({installed:true,check,guard});
}
module.exports={install};

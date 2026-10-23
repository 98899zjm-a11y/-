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

const contexts=new WeakSet();
function createBusinessMaintenanceContext({root,layout,hostId,profileId,provisionOwner=false}){
 if(typeof hostId!=='string'||!/^[-A-Za-z0-9_]{8,120}$/.test(hostId)||typeof profileId!=='string'||!/^[-A-Za-z0-9_]{3,120}$/.test(profileId))throw Error('Explicit maintenance host/profile identity required');
 const guard=createIsolationGuard(root),checked=guard.validateLayout({...layout,quoteImagesDir:layout?.quoteImagesDir??path.join(guard.root,'报价图片')});
 for(const key of ['dataDir','ledgerDir','inventoryDir','profileDir','configDir','runtimeDir','logDir','backupDir','documentsDir'])if(!checked[key])throw Error('Incomplete validated maintenance layout: '+key);
 const names=['dataDir','ledgerDir','inventoryDir','configDir','runtimeDir','logDir','backupDir','documentsDir','quoteImagesDir'];
 for(const a of names)for(const b of names)if(a!==b&&contained(checked[a],checked[b]))throw Error('Maintenance slots must not overlap');
 for(const key of ['profileDir','configDir','runtimeDir','logDir','backupDir'])if(!fs.existsSync(checked[key])||!fs.statSync(checked[key]).isDirectory())throw Error('Existing maintenance directory required: '+key);
 const native=require('node:fs'),ownerFile=guard.assertPath(path.join(checked.profileDir,'business-maintenance-owner.json'));
 if(!native.existsSync(ownerFile)){if(!provisionOwner)throw Error('Maintenance owner identity missing; explicit provisioning required');native.writeFileSync(ownerFile,JSON.stringify({version:1,hostId,profileId}),{flag:'wx',mode:0o600});}
 const owner=JSON.parse(native.readFileSync(guard.assertPath(ownerFile),'utf8'));if(owner.version!==1||owner.hostId!==hostId||owner.profileId!==profileId)throw Error('Maintenance owner identity mismatch');
 const handles=new Map();
 const io=new Proxy(native,{get(target,key){
  if(key==='openSync')return(filename,...args)=>{const file=guard.assertPath(filename),fd=target.openSync(file,...args);try{const stat=target.fstatSync(fd);if(!stat.isFile()||stat.nlink!==1)throw Error('Business safety: nonregular or hard-linked handle');const physical=target.statSync(guard.assertPath(file));if(stat.dev!==physical.dev||stat.ino!==physical.ino)throw Error('Business safety: file identity changed before open');handles.set(fd,{file,dev:stat.dev,ino:stat.ino});return fd;}catch(e){target.closeSync(fd);throw e;}};
  if(key==='closeSync')return(fd)=>{try{return target.closeSync(fd);}finally{handles.delete(fd);}};
  if(['readSync','writeSync','fsyncSync'].includes(key))return(fd,...args)=>{const state=handles.get(fd),stat=target.fstatSync(fd);if(!state||stat.dev!==state.dev||stat.ino!==state.ino||stat.nlink!==1)throw Error('Business safety: unknown or changed file handle');return target[key](fd,...args);};
  if(['renameSync','copyFileSync'].includes(key))return(from,to,...args)=>target[key](guard.assertPath(from),guard.assertPath(to),...args);
  if(['readFileSync','writeFileSync','appendFileSync','readdirSync','lstatSync','statSync','existsSync','unlinkSync','mkdirSync','rmSync'].includes(key))return(file,...args)=>target[key](guard.assertPath(file),...args);
  const value=target[key];return typeof value==='function'?value.bind(target):value;
 }});
 function OwnedDatabase(filename,options={}){const sqlite=require('node:sqlite'),file=guard.assertPath(filename);if(!native.existsSync(file)||!native.lstatSync(file).isFile())throw Error('Existing owned database required; no empty initialization');const db=new sqlite.DatabaseSync(file,{...options,allowExtension:false}),setAuthorizer=db.setAuthorizer.bind(db);db.setAuthorizer=custom=>{if(custom!=null&&typeof custom!=='function')throw TypeError('Invalid maintenance authorizer');return setAuthorizer((action,...args)=>action===sqlite.constants.SQLITE_ATTACH||action===sqlite.constants.SQLITE_DETACH||action===sqlite.constants.SQLITE_FUNCTION&&args.some(x=>String(x).toLowerCase()==='load_extension')?sqlite.constants.SQLITE_DENY:custom?custom(action,...args):sqlite.constants.SQLITE_OK);};db.setAuthorizer(null);db.enableDefensive(true);db.enableLoadExtension=db.loadExtension=db.deserialize=()=>{throw Error('Maintenance native extensions and payload loading prohibited');};return db;}
 const context=Object.freeze({root:guard.root,layout:Object.freeze(checked),namespace:hostId+':'+profileId,hostId,profileId,policy:Object.freeze({guard,check:(target)=>guard.assertPath(target),io,DatabaseSync:OwnedDatabase})});contexts.add(context);return context;
}
function requireContext(value){if(!contexts.has(value))throw TypeError('Validated owned business maintenance context required');return value;}
module.exports={createBusinessMaintenanceContext,requireContext};

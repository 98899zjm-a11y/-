'use strict';
// QA-only portable compiler input. Never installs packages or starts services.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const packageRoot=path.resolve(__dirname,'..'),MAX=128*1024*1024,SHA=/^[a-f0-9]{64}$/,hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function fail(message){throw Error('Renderer build tool: '+message);}
function relative(name){
 if(typeof name!=='string'||!name||name.length>400||name.split('/').some(part=>!part||part==='.'||part==='..'||/[\\:\x00-\x1f<>"|?*]/.test(part)||/[ .]$/.test(part)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)))fail('invalid manifest path');
 return name;
}
function within(root,file){const r=path.relative(root.toLowerCase(),file.toLowerCase());return r!== '..'&&!r.startsWith('..'+path.sep)&&!path.isAbsolute(r);}
function inspect(file){
 if(!path.isAbsolute(file)||/^[\\/]{2}/.test(file)||/[\x00-\x1f]/.test(file)||process.platform==='win32'&&file.slice(2).includes(':'))fail('invalid physical path');
 for(let p=file;;p=path.dirname(p)){if(fs.existsSync(p)){const s=fs.lstatSync(p);if(s.isSymbolicLink()||s.isFile()&&s.nlink!==1)fail('physical path link rejected');}if(p===path.dirname(p))break;}
 return file;
}
function boundary(root){
 root=path.resolve(inspect(root));if(!fs.statSync(root).isDirectory())fail('missing owned root');const real=fs.realpathSync.native(root),id=fs.statSync(real,{bigint:true});
 function check(file){file=path.resolve(file);if(!within(real,file))fail('path escaped owned boundary');inspect(file);const live=fs.statSync(real,{bigint:true});if(live.dev!==id.dev||live.ino!==id.ino)fail('owned boundary changed');let ancestor=file;while(!fs.existsSync(ancestor))ancestor=path.dirname(ancestor);if(!within(real,fs.realpathSync.native(ancestor)))fail('physical boundary escaped');return file;}
 function mkdir(dir){check(dir);if(!fs.existsSync(dir)){mkdir(path.dirname(dir));fs.mkdirSync(check(dir));}if(!fs.statSync(check(dir)).isDirectory())fail('directory required');return dir;}
 return{root:real,check,mkdir};
}
function readChecked(file,limit=MAX){
 inspect(file);const before=fs.lstatSync(file);if(!before.isFile()||before.size>limit)fail('invalid input file size');const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
 try{const a=fs.fstatSync(fd),bytes=fs.readFileSync(fd),b=fs.fstatSync(fd),live=fs.lstatSync(inspect(file));if(a.dev!==before.dev||a.ino!==before.ino||a.nlink!==1||a.size!==bytes.length||b.dev!==live.dev||b.ino!==live.ino||b.nlink!==1||b.size!==a.size||b.mtimeMs!==a.mtimeMs||live.mtimeMs!==a.mtimeMs)fail('input identity changed');return bytes;}finally{fs.closeSync(fd);}
}
function exact(value,keys){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('|')===keys.slice().sort().join('|');}
function loadRendererBuildTool({root=packageRoot}={}){
 if(process.versions.electron)fail('Node-only QA tool');root=path.resolve(root);if(!within(packageRoot,root))fail('fixture outside package');const guard=boundary(root),toolDir=guard.check(path.join(root,'stage1/test-tools'));
 const metadata=JSON.parse(readChecked(guard.check(path.join(toolDir,'renderer-build-tool-manifest.json')),4*1024*1024));
 if(metadata.version!==1||metadata.purpose!=='data-free-portable-renderer-build-test-tool'||metadata.platform!=='win32'||metadata.arch!=='x64'||metadata.businessSourceIncluded!==false||metadata.dataIncluded!==false||metadata.servicesStarted!==false)fail('manifest purpose/platform invalid');
 for(const [field,file]of [['builder','stage1/build-renderer-build-test-tool.cjs'],['config','project/desktop/vite.config.ts']])if(!exact(metadata[field],['file','sha256'])||metadata[field].file!==file||!SHA.test(metadata[field].sha256)||hash(readChecked(guard.check(path.join(root,file))))!==metadata[field].sha256)fail(field+' source hash changed');
 const archive=metadata.archive;if(!exact(archive,['file','bytes','sha256','payloadBytes'])||archive.file!=='renderer-build-dependencies.blob'||!Number.isSafeInteger(archive.bytes)||archive.bytes<1||archive.bytes>64*1024*1024||!Number.isSafeInteger(archive.payloadBytes)||archive.payloadBytes<12||archive.payloadBytes>MAX||!SHA.test(archive.sha256))fail('archive manifest invalid');
 const packages=metadata.packages,files=metadata.files;if(!Array.isArray(packages)||packages.length<2||packages.length>128||!Array.isArray(files)||!files.length||files.length>12000)fail('manifest entry count invalid');
 const packageNames=new Set();for(const p of packages){if(!exact(p,['directory','name','version','license','licenseFiles'])||!relative(p.directory).startsWith('node_modules/')||typeof p.name!=='string'||typeof p.version!=='string'||typeof p.license!=='string'||!Array.isArray(p.licenseFiles)||packageNames.has(p.directory.toLowerCase()))fail('package manifest invalid');packageNames.add(p.directory.toLowerCase());}
 if(!packages.some(p=>p.directory==='node_modules/vite'&&p.name==='vite'&&p.version==='8.0.13')||!packages.some(p=>p.directory==='node_modules/rolldown'&&p.name==='rolldown'&&p.version==='1.0.1'))fail('compiler package identity changed');
 let previous='',total=0;const seen=new Set();for(const item of files){if(!exact(item,['path','size','sha256'])||!relative(item.path).startsWith('node_modules/')||item.path<=previous||seen.has(item.path.toLowerCase())||!Number.isSafeInteger(item.size)||item.size<0||item.size>32*1024*1024||!SHA.test(item.sha256)||!packages.some(p=>item.path.startsWith(p.directory+'/')))fail('manifest entry path/order/hash invalid');seen.add(item.path.toLowerCase());previous=item.path;total+=item.size;if(total>MAX)fail('manifest total size limit');}
 const directories=new Map();for(const item of files)for(let dir=path.posix.dirname(item.path);dir!=='.';dir=path.posix.dirname(dir)){const key=dir.toLowerCase();if(seen.has(key)||directories.has(key)&&directories.get(key)!==dir)fail('manifest file/directory path alias');directories.set(key,dir);}
 for(const p of packages){if(!seen.has((p.directory+'/package.json').toLowerCase()))fail('package metadata entry missing');for(const license of p.licenseFiles)if(!exact(license,['path','sha256'])||!files.some(item=>item.path===license.path&&item.sha256===license.sha256&&item.path.startsWith(p.directory+'/')))fail('license provenance entry invalid');}
 const compressed=readChecked(guard.check(path.join(toolDir,archive.file)),64*1024*1024);if(compressed.length!==archive.bytes||hash(compressed)!==archive.sha256)fail('archive hash mismatch');
 const payload=zlib.gunzipSync(compressed,{maxOutputLength:MAX});if(payload.length!==archive.payloadBytes||payload.length<12||payload.subarray(0,8).toString()!=='XJYQA001'||payload.readUInt32LE(8)!==files.length)fail('archive entry count/header mismatch');
 let offset=12;const verified=[];for(const expected of files){if(offset+4>payload.length)fail('archive entry truncated');const length=payload.readUInt32LE(offset);offset+=4;if(length<2||length>2048||offset+length>payload.length)fail('archive entry header size invalid');const header=JSON.parse(payload.subarray(offset,offset+length).toString('utf8'));offset+=length;if(!exact(header,['path','size','sha256'])||header.path!==expected.path||header.size!==expected.size||header.sha256!==expected.sha256||offset+expected.size>payload.length)fail('archive entry differs from manifest');const bytes=payload.subarray(offset,offset+expected.size);offset+=expected.size;if(hash(bytes)!==expected.sha256)fail('archive entry hash mismatch');verified.push({expected,bytes});}if(offset!==payload.length)fail('extra archive entry or trailing bytes');
 for(const p of packages){const bytes=verified.find(item=>item.expected.path===p.directory+'/package.json').bytes,info=JSON.parse(bytes.toString('utf8'));if(info.name!==p.name||info.version!==p.version)fail('package metadata identity mismatch');}
 // No directories are created until the complete archive has been checked.
 const base=guard.mkdir(path.join(root,'runtime/renderer-build-tool-tests')),owned=fs.mkdtempSync(path.join(base,'owned-'));guard.check(owned);
 for(const {expected,bytes}of verified){const destination=guard.check(path.join(owned,...expected.path.split('/')));guard.mkdir(path.dirname(destination));const fd=fs.openSync(guard.check(destination),fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|(fs.constants.O_NOFOLLOW||0),0o600);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}if(hash(readChecked(guard.check(destination)))!==expected.sha256)fail('materialized entry hash mismatch');}
 const physical=[];function walk(dir,prefix=''){for(const item of fs.readdirSync(guard.check(dir),{withFileTypes:true})){const file=guard.check(path.join(dir,item.name));if(item.isDirectory()){physical.push(prefix+item.name+'/');walk(file,prefix+item.name+'/');}else if(item.isFile())physical.push(prefix+item.name);else fail('materialized physical entry invalid');}}walk(owned);const expectedTree=[...files.map(item=>item.path),...[...directories.values()].map(dir=>dir+'/')].sort();if(physical.sort().join('\n')!==expectedTree.join('\n'))fail('extra materialized entry');
 return Object.freeze({dependenciesRoot:guard.check(path.join(owned,'node_modules')),viteEntry:guard.check(path.join(owned,'node_modules/vite/dist/node/index.js')),configFile:guard.check(path.join(root,'project/desktop/vite.config.ts'))});
}
module.exports={loadRendererBuildTool,rendererToolBoundary:boundary,readRendererToolInput:readChecked,rendererToolRelative:relative};

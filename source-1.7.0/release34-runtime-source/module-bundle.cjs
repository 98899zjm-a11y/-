'use strict';
// A desktop sidecar is an entire verified onedir bundle, never just its EXE.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function fail(message){throw new Error('内部模块发布包：'+message);}
function checked(value,kind,missing=false){
 if(typeof value!=='string'||!path.isAbsolute(value)||/^[\\/]{2}/.test(value)||/[\x00-\x1f]/.test(value)||process.platform==='win32'&&value.slice(3).includes(':'))fail('路径不允许');
 const resolved=path.resolve(value);let leaf;
 for(let current=resolved;;current=path.dirname(current)){let s;try{s=fs.lstatSync(current);}catch(e){if(e.code!=='ENOENT')throw e;}if(s){if(s.isSymbolicLink())fail('链接路径不允许');if(current===resolved)leaf=s;else if(!s.isDirectory())fail('路径父级无效');}if(current===path.dirname(current))break;}
 if(!leaf){if(!missing)fail('路径不存在');return resolved;}
 if(kind==='file'&&(!leaf.isFile()||leaf.nlink!==1)||kind==='directory'&&!leaf.isDirectory())fail('文件类型或硬链接无效');
 return fs.realpathSync.native(resolved);
}
function relative(value){
 if(typeof value!=='string'||value.length>1024||value.split('/').some(x=>!x||x==='.'||x==='..'||/[\\:\x00-\x1f]/.test(x)||/[. ]$/.test(x)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(x)))fail('清单文件路径无效');return value;
}
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function scan(directory){const result=[];function walk(folder,prefix){checked(folder,'directory');for(const entry of fs.readdirSync(folder,{withFileTypes:true})){const target=checked(path.join(folder,entry.name),entry.isDirectory()?'directory':'file');if(entry.isDirectory())walk(target,prefix+entry.name+'/');else result.push(prefix+entry.name);}}walk(directory,'');return result.sort();}
function verify(directory,files){
 const actual=scan(directory),expected=files.map(x=>x.path).sort();if(JSON.stringify(actual)!==JSON.stringify(expected))fail('文件与清单不一致');
 for(const item of files){const file=checked(path.join(directory,...item.path.split('/')),'file'),bytes=fs.readFileSync(file);if(bytes.length!==item.size||hash(bytes)!==item.sha256)fail('文件校验失败');}
}
function materializeModuleBundle({id,version,packagedDir,runtimeDir}){
 if(!['ledger','inventory'].includes(id)||typeof version!=='string'||!/^\d+\.\d+\.\d+$/.test(version))fail('模块身份无效');
 packagedDir=checked(packagedDir,'directory');runtimeDir=checked(runtimeDir,'directory');
 const manifestFile=checked(path.join(packagedDir,'manifest.json'),'file');if(fs.statSync(manifestFile).size>4*1024*1024)fail('清单过大');
 let manifest;try{manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));}catch{fail('清单损坏');}
 if(manifest.version!==1||!Array.isArray(manifest.modules)||manifest.modules.length>2||new Set(manifest.modules.map(x=>x.id)).size!==manifest.modules.length)fail('清单模块无效');
 const entry=manifest.modules.find(x=>x.id===id);
 if(!entry||entry.version!==version||entry.file!=='xjy-'+id+'.exe'||entry.runtimeMode!=='onedir'||entry.purpose!=='desktop-release')fail('不是对应 desktop release 发布模块');
 if(!Array.isArray(entry.files)||!entry.files.length||entry.files.length>10000)fail('清单文件数量无效');
 let total=0;const seen=new Set();for(const item of entry.files){relative(item.path);const key=item.path.toLowerCase();if(seen.has(key))fail('清单重复 duplicate 路径');seen.add(key);if(!Number.isSafeInteger(item.size)||item.size<0||item.size>256*1024*1024||!/^[a-f0-9]{64}$/.test(item.sha256))fail('清单文件校验值无效');total+=item.size;}
 if(total>512*1024*1024)fail('模块发布包过大');
 const executableItem=entry.files.find(x=>x.path===entry.file);if(!executableItem||executableItem.size!==entry.size||executableItem.sha256!==entry.sha256)fail('EXE清单不一致');
 const source=checked(path.join(packagedDir,'xjy-'+id),'directory');verify(source,entry.files);
 if(fs.readFileSync(checked(path.join(source,entry.file),'file')).subarray(0,2).toString()!=='MZ')fail('EXE格式无效');
 const seal=hash(Buffer.from(JSON.stringify(entry.files.slice().sort((a,b)=>a.path.localeCompare(b.path)))));
 const codeDir=path.join(runtimeDir,id+'-'+version+'-'+seal.slice(0,24));checked(codeDir,'directory',true);
 if(fs.existsSync(codeDir)){verify(codeDir,entry.files);return Object.freeze({executable:path.join(codeDir,entry.file),codeDir,seal});}
 const temporary=path.join(runtimeDir,'.module-publish-'+crypto.randomUUID());fs.mkdirSync(checked(temporary,'directory',true));const created=fs.lstatSync(temporary);
 try{
  for(const item of entry.files){const from=checked(path.join(source,...item.path.split('/')),'file'),to=checked(path.join(temporary,...item.path.split('/')),'file',true);fs.mkdirSync(checked(path.dirname(to),'directory',true),{recursive:true});const bytes=fs.readFileSync(from);if(bytes.length!==item.size||hash(bytes)!==item.sha256)fail('复制前文件校验失败');fs.writeFileSync(to,bytes,{flag:'wx',mode:0o600});}
  verify(temporary,entry.files);checked(codeDir,'directory',true);if(fs.existsSync(codeDir))fail('运行目录已被另一程序创建');fs.renameSync(temporary,codeDir);
 }finally{
  // Only remove our newly created, ordinary scratch directory. Never repair or
  // delete an existing cache, and never traverse a replaced linked directory.
  if(fs.existsSync(temporary)){try{checked(temporary,'directory');const current=fs.lstatSync(temporary);if(current.dev!==created.dev||current.ino!==created.ino)fail('暂存目录身份改变');scan(temporary);fs.rmSync(temporary,{recursive:true});}catch{/* retain suspicious scratch for inspection */}}
 }
 verify(codeDir,entry.files);return Object.freeze({executable:path.join(codeDir,entry.file),codeDir,seal});
}
module.exports={materializeModuleBundle};

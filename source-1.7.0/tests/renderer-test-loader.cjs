'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function checked(file){
 const relative=path.relative(root,file);if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('Renderer test path escaped package');
 for(let p=file;;p=path.dirname(p)){const stat=fs.lstatSync(p);if(stat.isSymbolicLink()||stat.isFile()&&stat.nlink!==1)throw Error('Renderer test code link rejected');if(p===root)break;}
 return file;
}
function loadRenderer(name){
 if(!['employee-update','remote-print','browser-bridge','central-print','host-maintenance-panel','employee-profile'].includes(name))throw Error('Unknown renderer test source');
 const metadata=JSON.parse(fs.readFileSync(checked(path.join(root,'stage1/test-tools/manifest.json')),'utf8'));
 const item=metadata.modules?.[name];if(metadata.version!==1||metadata.purpose!=='data-free-renderer-test-code'||!item||item.file!==name+'.cjs'||!Array.isArray(item.sources)||!item.sources.length)throw Error('Renderer test manifest missing; rebuild before sealing');
 for(const source of item.sources){
  if(typeof source.file!=='string'||!source.file.startsWith('project/')||source.file.split('/').some(p=>!p||p==='.'||p==='..'||/[\\:\x00-\x1f]/.test(p)))throw Error('Unsafe renderer provenance path');
  if(hash(checked(path.join(root,source.file)))!==source.sha256)throw Error('Renderer test source changed; rebuild before sealing');
 }
 const output=checked(path.join(root,'stage1/test-tools',item.file));if(hash(output)!==item.sha256)throw Error('Renderer test artifact changed');
 return require(output);
}
module.exports={loadRenderer};

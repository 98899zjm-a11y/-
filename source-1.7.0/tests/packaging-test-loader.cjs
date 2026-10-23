'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),packageRoot=path.resolve(__dirname,'..'),hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function checked(root,file){const relative=path.relative(root,file);if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('Packaging tool path escaped owned package');for(let p=file;;p=path.dirname(p)){const stat=fs.lstatSync(p);if(stat.isSymbolicLink()||stat.isFile()&&stat.nlink!==1)throw Error('Packaging tool link rejected');if(p===root)break;}return file;}
function safeSource(file){return typeof file==='string'&&!file.startsWith('/')&&file.split('/').every(p=>p&&p!=='.'&&p!=='..'&&!/[\\:\x00-\x1f]/.test(p));}
function loadPackagingTool(name,{root=packageRoot}={}){
 if(!['asar','css-parsers'].includes(name))throw Error('Unknown packaging test tool');root=path.resolve(root);const relative=path.relative(packageRoot,root);if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('Packaging tool fixture outside package');
 const metadata=JSON.parse(fs.readFileSync(checked(root,path.join(root,'stage1/test-tools/packaging-tool-manifest.json'))));
 if(metadata.version!==1||metadata.purpose!=='data-free-portable-packaging-test-tool'||metadata.businessSourceIncluded!==false||metadata.dataIncluded!==false||metadata.builder?.file!=='stage1/build-packaging-test-tool.cjs'||hash(checked(root,path.join(root,metadata.builder.file)))!==metadata.builder.sha256)throw Error('Packaging tool builder source changed or not sealed');
 const item=metadata.tools?.[name];if(!item||item.file!==name+'.cjs'||!Array.isArray(item.sources)||!item.sources.length||item.sources.some(x=>!['authorized-asar-thirdparty','authorized-build-thirdparty'].includes(x.root)||!safeSource(x.file)||! /^[a-f0-9]{64}$/.test(x.sha256)))throw Error('Packaging tool provenance missing or invalid');
 if(name==='asar'&&(item.package?.name!=='@electron/asar'||typeof item.package.version!=='string'))throw Error('Packaging tool package identity invalid');
 const output=checked(root,path.join(root,'stage1/test-tools',item.file));if(fs.statSync(output).size!==item.bytes||hash(output)!==item.sha256)throw Error('Packaging tool artifact hash verification failed');
 const tool=require(output);if(name==='asar'&&['createPackage','extractFile','listPackage'].some(k=>typeof tool[k]!=='function')||name==='css-parsers'&&(!tool.postcss?.parse||typeof tool.valueParser!=='function'))throw Error('Packaging tool API incomplete');return tool;
}
module.exports={loadPackagingTool};

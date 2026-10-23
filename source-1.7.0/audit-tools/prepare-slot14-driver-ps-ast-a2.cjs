'use strict';
// Pure source extraction. It does not import or execute the inspected driver.
const fs=require('node:fs'),crypto=require('node:crypto');
const root='E:/codex/2026-10-15/work/xjy-v16-deep-audit';
const file=root+'/release-work/deepseek-stage1-development-a1/tools/run-native170-employee-slot14-to18-a2.cjs';
const raw=fs.readFileSync(file),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
if(sha(raw)!=='bdb8c5c8ef3d78f82193b0c5f0a494640b18aba819d627f4585ca3cb8d9292d7')throw Error('Frozen source differs');
const text=raw.toString('utf8'),items=[];
for(const m of text.matchAll(/const ([A-Z_0-9]+)=String\.raw`([^`]*)`;/g)){
 if(m[2].includes('${'))throw Error('Interpolation requires separate review');
 const source='param($request);'+m[2].replaceAll('=[Console]::In.ReadToEnd()|ConvertFrom-Json;','=$request;');
 items.push({name:m[1],source,sha256:sha(Buffer.from(source))});
}
if(items.length!==6)throw Error('Expected exactly six fixed PowerShell sources; got '+items.length);
const output=root+'/reports/native170-slot14-driver-a2-exact-ps-inputs.json';
fs.writeFileSync(output,JSON.stringify(items,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({count:items.length,sourceSha256:sha(raw),output,driverExecuted:false}));

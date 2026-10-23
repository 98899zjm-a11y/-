'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const W='E:/codex/2026-10-15/work/xjy-v16-deep-audit',R=path.join(W,'release-work/native170-gui440-rm0-root-bound-a1'),D=path.join(W,'release-work/deepseek-stage1-development-a1'),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const exe=fs.readFileSync(path.join(R,'GuestRmCloseGui440.exe')),source=fs.readFileSync(path.join(R,'GuestRmCloseGui440.cs')),approval=fs.readFileSync(path.join(R,'root-gui440-rm0-approval.json'));
assert.equal(exe.length,28160);assert.equal(hash(exe),'a57ab448dedf961024645daf570c722d0123fcdd2367d135ccfddc9cc1d76f0a');assert.equal(hash(source),'8d2af393de678f7cd5b9285d04ecee84113ebf73ba4c4d69c62ae2f2adb7d963');assert.equal(hash(approval),'e2888b29cbb1e1925138dcb8bfabbfb5cd211ed3a9fa2244e92868c593a23adf');
const raw=fs.readFileSync(path.join(R,'run-gui440-rm0-close.UNBOUND.cjs'));assert.equal(hash(raw),'fd76cd8e2fe1783259e233549b71720f2f0165951124545d4a1102c6fdf55551');
let text=raw.toString('utf8');for(const [a,b]of[['UNBOUND_ROOT_COMPILED_GUI440_SHA',hash(exe)],['NATIVE_SIZE=0','NATIVE_SIZE=28160']]){assert.equal(text.split(a).length,2);text=text.replace(a,b);}
const transport=Buffer.from(text);fs.writeFileSync(path.join(R,'run-gui440-rm0-close.cjs'),transport,{flag:'wx'});
for(const [name,bytes]of [['GuestRmCloseGui440.exe',exe],['run-gui440-rm0-close.cjs',transport]])fs.writeFileSync(path.join(D,'tools',name),bytes,{flag:'wx'});
const review=path.join(D,'handoff-input/gui440-rm0-root-review-a1');fs.mkdirSync(review);
const entries=[['GuestRmCloseGui440.cs',source],['run-gui440-rm0-close.cjs',transport],['root-gui440-rm0-approval.json',approval],['original-readonly-result.json',fs.readFileSync(path.join(D,'results/guest-runs/90d7c7b6-72e3-44e0-83b1-1a9f726e9504/result.json'))],['original-readonly-stdout.log',fs.readFileSync(path.join(D,'results/guest-runs/90d7c7b6-72e3-44e0-83b1-1a9f726e9504/stdout.log'))]];
const index=entries.map(([name,bytes])=>{fs.writeFileSync(path.join(review,name),bytes,{flag:'wx'});return{path:name,size:bytes.length,sha256:hash(bytes)};});fs.writeFileSync(path.join(review,'public-file-index.json'),JSON.stringify(index,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({review,transportSha256:hash(transport),nativeSha256:hash(exe),actualNativeSize:exe.length,stageOnly:true,checkOrRmExecuted:false}));

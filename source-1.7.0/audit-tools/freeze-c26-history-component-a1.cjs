'use strict';
// Root-only data freeze. No key, Guest, production, process or installer call.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const dir=String.raw`E:\codex\2026-10-15\work\xjy-v16-deep-audit\release-work\native170-c26-history-package-source-a1`;
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const draft=path.join(dir,'prepare-native170-known14-and19-target20-worker26-DRAFT-a2.cjs'),before=fs.readFileSync(draft);
assert.equal(hash(before),'23ae072607c06fc96899dd08ca6099b69d1380eac427e46243025577812cb3b8');
const b=require(draft),input=JSON.parse(fs.readFileSync(path.join(dir,'reviewed-inputs-DRAFT-NOT-APPROVED-a2.json')));
assert.equal(input.reviewed,false);assert.equal(input.historyPathComponentReviewed,false);
// The exact program/source policy objects come from the reviewed builder,
// rather than copied JSON path escaping. These are data-only exported values.
input.files=b.WORKER26_OVERLAYS.map(x=>({...x}));input.slotDefaultSource={...b.SLOT_DEFAULT_SOURCE};
for(const f of input.files){const bytes=fs.readFileSync(f.source);assert.equal(bytes.length,f.size);assert.equal(hash(bytes),f.sha256);}
input.reviewed=true;input.historyPathComponentReviewed=true;
const bytes=Buffer.from(JSON.stringify(input,null,2)+'\n'),inputPin=hash(bytes),inputFile=path.join(dir,'reviewed-inputs-ROOT.json');
fs.writeFileSync(inputFile,bytes,{flag:'wx'});
let src=before.toString('utf8');function once(a,z){assert.equal(src.split(a).length,2,a);src=src.replace(a,z);}
once('reviewed:false,executable:false,dataOnly:true','reviewed:true,executable:true,dataOnly:true');
once("FIXED_INPUTS_PIN='UNBOUND'","FIXED_INPUTS_PIN='"+inputPin+"'");
once("historyPathComponentAcceptance:'PENDING_INDEPENDENT_REVIEW'","historyPathComponentAcceptance:'ROOT_38_RAM_PASS_AND_DEEPSEEK_A3_SOURCE_REVIEW'");
const final=path.join(dir,'prepare-native170-known14-and19-target20-worker26-final-a1.cjs');
fs.writeFileSync(final,src,{flag:'wx'});
console.log(JSON.stringify({inputFile,inputPin,builder:final,builderSha256:hash(Buffer.from(src)),workerRowsChanged:2,componentReviewOnly:true,realFilesystemAcceptance:'PENDING',realInstallAcceptance:'PENDING',privateKeyRead:false,guestAccessed:false,formalTouched:false}));

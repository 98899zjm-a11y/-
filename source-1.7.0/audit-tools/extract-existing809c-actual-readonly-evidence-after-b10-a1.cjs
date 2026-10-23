'use strict';
// Pure public diagnostic bytes only. Does not attach disks or execute native/product code.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),dev=path.join(root,'release-work/deepseek-stage1-development-a1');
const input=path.join(dev,'results/guest-runs/0e439159-52af-4b7d-b649-e3728594f243/stdout.log');
const dest=path.join(dev,'handoff-input/existing809c-readonly-report.ndjson');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function need(v,m){if(!v)throw Error(m);}
for(let p=input;;p=path.dirname(p)){need(!fs.lstatSync(p).isSymbolicLink()&&fs.realpathSync.native(p).toLowerCase()===p.toLowerCase(),'PLAIN_DIAGNOSTIC_INPUT');if(p===path.dirname(p))break;}
const raw=fs.readFileSync(input);need(sha(raw)==='8b2902174058b163a1af24593c40a22df8f37483b386d9c3bad9268d79e10e21','ORIGINAL_BRIDGE_STDOUT_CHANGED');
const begin=raw.indexOf(Buffer.from('{"phase":"readonly-existing-privilege-contract"'));
need(begin>=0&&raw.indexOf(Buffer.from('{"phase":"readonly-existing-privilege-contract"'),begin+1)===-1,'UNIQUE_NATIVE_BLOCK');
const block=raw.subarray(begin,begin+2122);need(block.length===2122&&sha(block)==='32c36e9df29548841bd35d9ec966d78387e657a91e346042a0e87ff82a2bb57e','EXACT_NATIVE_STDOUT_BYTES');
const rows=new TextDecoder('utf8',{fatal:true}).decode(block).trim().split(/\r?\n/).map(s=>JSON.parse(s));
const zero=rows.find(r=>r.query==='partition-region-zero'),final=rows.at(-1),fsQuery=rows.find(r=>r.query==='filesystem-readonly');
need(zero?.complete===true&&zero.bytesRead===535822336&&zero.nonzeroBytes===0&&zero.allZero===true,'ACTUAL_FULL_PARTITION_ZERO');
need(final.result==='READONLY_EXISTING809C_REGION_ZERO_VERIFIED'&&final.attached===false&&final.noF===true&&final.stageBWriteAuthorized===false,'ACTUAL_FINAL_READONLY_CONTRACT');
need(fsQuery?.available===false&&fsQuery.win32Status===87&&fsQuery.fileSystem===null,'DO_NOT_INVENT_FILESYSTEM');
if(fs.existsSync(dest))need(fs.readFileSync(dest).equals(block),'EXISTING_EVIDENCE_DIFFERS');else fs.writeFileSync(dest,block,{flag:'wx'});
console.log(JSON.stringify({pureData:true,input,output:dest,bytes:block.length,sha256:sha(block),rows:rows.length,stageBWriteAuthorized:false}));

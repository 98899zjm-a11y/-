import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {prepareImage,createClassifier} from '../lib/classifier.mjs';
import {searchAssets} from '../lib/search.mjs';
const source='D:/Codex/xjy-sales-materials-evaluation-20261023';
const out=new URL('./prompt-v4-result.json',import.meta.url);
try{await fs.access(out);throw Error('Do not overwrite existing evaluation');}catch(e){if(e.code!=='ENOENT')throw e;}
const digest=x=>createHash('sha256').update(x).digest('hex');
const manifestBytes=await fs.readFile(path.join(source,'manifest.json')),manifest=JSON.parse(manifestBytes);
if(digest(manifestBytes)!=='a9efd5cc6d9b305a57690a8a6139d24efee3e191f6a8d89d7931020a5b0d14f3')throw Error('Frozen baseline changed');
const baseline=JSON.parse(await fs.readFile(path.join(source,'baseline-result.json')));
const queries=JSON.parse(await fs.readFile(path.join(source,'queries.json'))).queries;
const result={at:new Date().toISOString(),scope:'Same frozen positive-only 16 image diagnostic; prompt tuned after observed baseline errors, not a hold-out estimate',model:'qwen3-vl:4b',state:'running',manifestSha256:digest(manifestBytes),classifierSha256:digest(await fs.readFile(new URL('../lib/classifier.mjs',import.meta.url))),searchSha256:digest(await fs.readFile(new URL('../lib/search.mjs',import.meta.url))),cases:[],search:[],baselineSummary:baseline.summary};
const save=()=>fs.writeFile(out,JSON.stringify(result,null,2));await save();
for(const sample of manifest.items){const start=Date.now();let rawResponse;
 try{const original=await fs.readFile(sample.localPath);if(digest(original)!==sample.sha256)throw Error('Source hash changed');
 const classify=createClassifier({request:async(url,init)=>{if(url!=='http://127.0.0.1:21434/api/chat')throw Error('Non-local request rejected');const response=await fetch(url,init);try{rawResponse=(await response.clone().json()).message?.content;}catch{}return response;}});
 const output=await classify(await prepareImage(original));result.cases.push({id:sample.id,output,rawResponse,expected:sample.expected,categoryMatched:output.category===sample.expected.category,gateMatched:output.decision===sample.expected.decision,elapsedMs:Date.now()-start});
 }catch(e){result.cases.push({id:sample.id,error:e.message,rawResponse,expected:sample.expected,categoryMatched:false,gateMatched:false,elapsedMs:Date.now()-start});}
 await save();console.log(JSON.stringify(result.cases.at(-1)));
}
const assets=result.cases.map(c=>({id:c.id,name:c.id,status:c.output?.decision==='jewelry'?'imported':'needs_review',category:c.output?.category??'其他首饰',tags:c.output?.tags??[],availability:'unknown'}));
for(const q of queries){const actual=searchAssets(assets,{query:q.query});const ids=actual.items.map(a=>a.id);result.search.push({id:q.id,query:q.query,expectedIds:q.expectedIds,actualIds:ids,missingIds:q.expectedIds.filter(id=>!ids.includes(id)),extraIds:ids.filter(id=>!q.expectedIds.includes(id)),interpretation:actual.interpretation,baselineActualIds:baseline.search.find(x=>x.id===q.id)?.actualIds??[]});}
result.safetyProbe=searchAssets(assets,{query:'现货戒指'});
result.state='completed';result.summary={count:result.cases.length,modelErrors:result.cases.filter(c=>c.error).length,imported:result.cases.filter(c=>c.output?.decision==='jewelry').length,needsReview:result.cases.filter(c=>c.output?.decision==='uncertain').length,categoryMatches:result.cases.filter(c=>c.categoryMatched).length,fullyMatchingQueries:result.search.filter(q=>!q.missingIds.length&&!q.extraIds.length).length,queryCount:result.search.length};
await save();console.log(JSON.stringify({summary:result.summary,search:result.search}));

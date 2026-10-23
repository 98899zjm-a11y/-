import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {prepareImage,createClassifier} from '../lib/classifier.mjs';
import {searchAssets} from '../lib/search.mjs';
const model='qwen3-vl:4b-instruct',source='D:/Codex/xjy-sales-materials-evaluation-20261023';
const out=new URL('./instruct-result.json',import.meta.url);
try{await fs.access(out);throw Error('Refuse to overwrite instruct evaluation');}catch(e){if(e.code!=='ENOENT')throw e;}
const sha=x=>createHash('sha256').update(x).digest('hex');
const manifestBytes=await fs.readFile(path.join(source,'manifest.json')),queryBytes=await fs.readFile(path.join(source,'queries.json'));
if(sha(manifestBytes)!=='a9efd5cc6d9b305a57690a8a6139d24efee3e191f6a8d89d7931020a5b0d14f3'||sha(queryBytes)!=='304d6bf2e79773332c2f9cc061be6d6cc435cee7cafe3ec32f61f5dd1a9c81eb')throw Error('Frozen evaluation baseline changed');
const tags=await (await fetch('http://127.0.0.1:21434/api/tags')).json();const installed=tags.models?.find(x=>x.name===model||x.model===model);if(!installed)throw Error('Official instruct tag not installed; no inference started');
const show=await (await fetch('http://127.0.0.1:21434/api/show',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model})})).json();
const manifest=JSON.parse(manifestBytes),queries=JSON.parse(queryBytes).queries;
const result={at:new Date().toISOString(),scope:'One approved 16-image local-only instruct comparison. Frozen positive-only calibration set, not hold-out/general accuracy. No asset library writes and current app still requires manual confirmation.',model,installed:{name:installed.name,digest:installed.digest,size:installed.size,modified_at:installed.modified_at},localModel:{capabilities:show.capabilities,template:show.template,parameters:show.parameters},manifestSha256:sha(manifestBytes),queriesSha256:sha(queryBytes),classifierSha256:sha(await fs.readFile(new URL('../lib/classifier.mjs',import.meta.url))),searchSha256:sha(await fs.readFile(new URL('../lib/search.mjs',import.meta.url))),state:'running',cases:[],search:[]};
const save=()=>fs.writeFile(out,JSON.stringify(result,null,2));await save();
for(const sample of manifest.items){const started=Date.now();let rawResponse,rawMeta;
 try{const original=await fs.readFile(sample.localPath);if(sha(original)!==sample.sha256)throw Error('Frozen image bytes changed');
 const classifier=createClassifier({model,request:async(url,init)=>{if(url!=='http://127.0.0.1:21434/api/chat')throw Error('Non-local request rejected');const sent=JSON.parse(init.body);if(sent.model!==model||sent.options.num_predict!==1024||sent.options.num_thread!==4||sent.options.num_ctx!==16384||sent.keep_alive!==0)throw Error('Comparison request contract changed');
  const response=await fetch(url,init);try{const raw=await response.clone().json();rawResponse=raw.message?.content;rawMeta={httpStatus:response.status,error:raw.error,done:raw.done,doneReason:raw.done_reason,promptEvalCount:raw.prompt_eval_count,evalCount:raw.eval_count,contentChars:raw.message?.content?.length??0,thinkingChars:raw.message?.thinking?.length??0,thinking:raw.message?.thinking??'',totalDurationNs:raw.total_duration,loadDurationNs:raw.load_duration,promptEvalDurationNs:raw.prompt_eval_duration,evalDurationNs:raw.eval_duration};}catch{}return response;}});
 const output=await classifier(await prepareImage(original));result.cases.push({id:sample.id,output,rawResponse,rawMeta,expected:sample.expected,categoryMatched:output.category===sample.expected.category,gateMatched:output.decision===sample.expected.decision,elapsedMs:Date.now()-started});
 }catch(e){result.cases.push({id:sample.id,error:e.message,rawResponse,rawMeta,expected:sample.expected,categoryMatched:false,gateMatched:false,elapsedMs:Date.now()-started});}
 await save();const c=result.cases.at(-1);console.log(JSON.stringify({id:c.id,output:c.output,error:c.error,rawMeta:c.rawMeta&&{...c.rawMeta,thinking:undefined},elapsedMs:c.elapsedMs}));
}
const assets=result.cases.map(c=>({id:c.id,name:c.id,status:c.output?.decision==='jewelry'?'imported':'needs_review',category:c.output?.category??'其他首饰',tags:c.output?.tags??[],availability:'unknown'}));
for(const q of queries){const actual=searchAssets(assets,{query:q.query});const ids=actual.items.map(x=>x.id);result.search.push({id:q.id,query:q.query,expectedIds:q.expectedIds,actualIds:ids,missingIds:q.expectedIds.filter(id=>!ids.includes(id)),extraIds:ids.filter(id=>!q.expectedIds.includes(id)),interpretation:actual.interpretation});}
result.safetyProbe={query:'现货戒指',total:searchAssets(assets,{query:'现货戒指'}).total};
result.summary={count:result.cases.length,modelErrors:result.cases.filter(c=>c.error).length,modelJewelry:result.cases.filter(c=>c.output?.decision==='jewelry').length,needsReview:result.cases.filter(c=>c.output?.decision==='uncertain').length,notJewelry:result.cases.filter(c=>c.output?.decision==='not_jewelry').length,categoryMatches:result.cases.filter(c=>c.categoryMatched).length,fullyMatchingQueries:result.search.filter(q=>!q.missingIds.length&&!q.extraIds.length).length,queryCount:result.search.length,emptyContent:result.cases.filter(c=>c.rawMeta?.contentChars===0).length,lengthStops:result.cases.filter(c=>c.rawMeta?.doneReason==='length').length,totalThinkingChars:result.cases.reduce((s,c)=>s+(c.rawMeta?.thinkingChars??0),0),totalOutputTokens:result.cases.reduce((s,c)=>s+(c.rawMeta?.evalCount??0),0),totalElapsedMs:result.cases.reduce((s,c)=>s+c.elapsedMs,0)};
result.state='completed';await save();console.log(JSON.stringify({summary:result.summary,search:result.search}));

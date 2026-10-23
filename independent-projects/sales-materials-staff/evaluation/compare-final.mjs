import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createClassifier} from '../lib/classifier.mjs';
import {searchAssets} from '../lib/search.mjs';
const frozen='D:/Codex/xjy-sales-materials-evaluation-20261023/';
const read=async f=>JSON.parse(await fs.readFile(f,'utf8'));
const baseline=await read(frozen+'baseline-result.json'),manifest=await read(frozen+'manifest.json'),queries=(await read(frozen+'queries.json')).queries;
const v2=await read(new URL('./prompt-v2-result.json',import.meta.url)),v4=await read(new URL('./prompt-v4-result.json',import.meta.url));
const finalCases=[];
for(const c of v4.cases){if(c.error){finalCases.push({...c});continue;}
 const output=await createClassifier({request:async()=>new Response(JSON.stringify({done:true,message:{content:c.rawResponse}}))})({bytes:Buffer.from('no-image-deterministic-validation-replay'),sha256:c.output.sha256});
 finalCases.push({...c,output,originalV4Output:c.output});
}
const toAssets=cases=>cases.map(c=>({id:c.id,name:c.id,status:c.output?.decision==='jewelry'?'imported':'needs_review',category:c.output?.category??'其他首饰',tags:c.output?.tags??[],availability:'unknown'}));
const evaluate=assets=>queries.map(q=>{const r=searchAssets(assets,{query:q.query});const ids=r.items.map(x=>x.id);return {id:q.id,query:q.query,expectedIds:q.expectedIds,actualIds:ids,missingIds:q.expectedIds.filter(x=>!ids.includes(x)),extraIds:ids.filter(x=>!q.expectedIds.includes(x)),interpretation:r.interpretation};});
const finalSearch=evaluate(toAssets(finalCases));
const oracleSearch=evaluate(manifest.items.map(x=>({id:x.id,name:x.id,status:'imported',category:x.expected.category,tags:x.expected.tags,availability:'unknown'})));
const complete=qs=>qs.filter(q=>!q.missingIds.length&&!q.extraIds.length).length;
const result={at:new Date().toISOString(),method:'Final deterministic validator/search replay over preserved real v4 model outputs. No new inference, no image transmission, no human correction inserted into automatic results.',classifierSha256:createHash('sha256').update(await fs.readFile(new URL('../lib/classifier.mjs',import.meta.url))).digest('hex'),searchSha256:createHash('sha256').update(await fs.readFile(new URL('../lib/search.mjs',import.meta.url))).digest('hex'),rawSource:'prompt-v4-result.json',cases:finalCases,search:finalSearch,baselineSearch:baseline.search,v2Search:v2.search,visualBaselineTagsOnly:{warning:'Not actual employee-approved data and NOT model success. This isolates retrieval against pre-frozen visual baseline tags only.',search:oracleSearch,fullyMatchingQueries:complete(oracleSearch)},summary:{count:finalCases.length,imported:finalCases.filter(c=>c.output?.decision==='jewelry').length,needsReview:finalCases.filter(c=>c.output?.decision==='uncertain').length,modelErrors:finalCases.filter(c=>c.error).length,categoryMatches:finalCases.filter(c=>c.output?.category===c.expected.category).length,fullyMatchingQueries:complete(finalSearch),queryCount:queries.length,baselineFullyMatchingQueries:complete(baseline.search),v2FullyMatchingQueries:complete(v2.search)},currentStockProbe:searchAssets(toAssets(finalCases),{query:'现货戒指'}).total};
await fs.writeFile(new URL('./final-comparison.json',import.meta.url),JSON.stringify(result,null,2));
console.log(JSON.stringify({summary:result.summary,search:result.search.map(x=>({id:x.id,actual:x.actualIds,expected:x.expectedIds})),visualBaselineTagsOnly:result.visualBaselineTagsOnly.fullyMatchingQueries,currentStockProbe:result.currentStockProbe}));

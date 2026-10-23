import fs from 'node:fs/promises';
import {createClassifier,prepareImage} from '../lib/classifier.mjs';
const manifest=JSON.parse(await fs.readFile('D:/Codex/xjy-sales-materials-evaluation-20261023/manifest.json'));
const item=manifest.items.find(x=>x.id==='S07');
const report={at:new Date().toISOString(),sampleId:item.id,model:'qwen3-vl:4b',purpose:'one diagnostic using unchanged failed v3 call, local only'};
const show=await (await fetch('http://127.0.0.1:21434/api/show',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:'qwen3-vl:4b'})})).json();report.localModel={capabilities:show.capabilities,template:show.template,parameters:show.parameters};
try{report.output=await createClassifier({request:async(url,init)=>{const sent=JSON.parse(init.body);report.requestMeta={think:sent.think,formatType:typeof sent.format,maxTagEnum:sent.format.properties.tags.items.enum?.length,options:sent.options,keep_alive:sent.keep_alive};const response=await fetch(url,init);const raw=await response.clone().json();report.rawResponse=raw;report.counts={contentChars:raw.message?.content?.length??0,thinkingChars:raw.message?.thinking?.length??0,done:raw.done,doneReason:raw.done_reason,promptEvalCount:raw.prompt_eval_count,evalCount:raw.eval_count};return response;}})(await prepareImage(await fs.readFile(item.localPath)));}catch(e){report.error=e.message;}
await fs.writeFile(new URL('./single-diagnostic.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify({counts:report.counts,error:report.error,requestMeta:report.requestMeta}));

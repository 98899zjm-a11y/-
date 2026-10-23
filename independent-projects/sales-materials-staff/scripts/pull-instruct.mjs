import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),pause=path.join(root,'runtime','pause-model-download');
const controller=new AbortController();let lastLog=0;
const monitor=setInterval(async()=>{try{await fs.access(pause);controller.abort(new Error('Download paused to preserve upgrade transfer window'));}catch{}},1000);
const status={model:'qwen3-vl:4b-instruct',approved:true,destination:'D drive isolated Ollama models',upgradeWindow:'Other upgrade chat observed doing isolated host backup/recovery tests; no active transfer observed before start',at:new Date().toISOString(),state:'starting'};
async function save(){await fs.writeFile(path.join(root,'evidence/instruct-pull-status.json'),JSON.stringify(status,null,2));}
try{
 await save();const response=await fetch('http://127.0.0.1:21434/api/pull',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:status.model,stream:true}),signal:controller.signal});
 if(!response.ok)throw Error('Local model pull returned HTTP '+response.status);let buffer='';
 function consume(line){if(!line.trim())return;const event=JSON.parse(line);if(event.error)throw Error(event.error);Object.assign(status,event,{state:event.status==='success'?'completed':'downloading',updatedAt:new Date().toISOString()});}
 for await(const chunk of response.body){buffer+=new TextDecoder().decode(chunk);let n;while((n=buffer.indexOf('\n'))>=0){consume(buffer.slice(0,n));buffer=buffer.slice(n+1);}await save();if(Date.now()-lastLog>15000){console.log(JSON.stringify({status:status.status,completed:status.completed,total:status.total}));lastLog=Date.now();}}
 if(buffer.trim())consume(buffer);if(status.status!=='success')throw Error('Model pull did not return success');
 const tags=await(await fetch('http://127.0.0.1:21434/api/tags')).json(),model=tags.models?.find(x=>x.name===status.model);if(!model)throw Error('New model missing after pull');status.installed={name:model.name,digest:model.digest,size:model.size};await save();console.log(JSON.stringify({state:status.state,installed:status.installed}));
}catch(e){status.state=controller.signal.aborted?'paused':'failed';status.error=e.message;await save();console.error(e.message);process.exitCode=1;}finally{clearInterval(monitor);}

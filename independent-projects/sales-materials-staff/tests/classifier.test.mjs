import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { prepareImage, createClassifier } from '../lib/classifier.mjs';
const fixture = () => sharp({create:{width:30,height:20,channels:3,background:'#aaa'}}).png().toBuffer();
const reply = output => async () => new Response(JSON.stringify({message:{content:JSON.stringify(output)},done:true}),{headers:{'content-type':'application/json'}});
test('fully decodes and normalizes selected image; digest identifies original bytes', async () => {
  const bytes = await fixture(), image = await prepareImage(bytes);
  assert.match(image.sha256,/^[a-f0-9]{64}$/); assert.equal(image.bytes[0],255);
  assert.equal((await sharp(image.bytes).metadata()).format,'jpeg');
  await assert.rejects(prepareImage(Buffer.from('<svg/>')));
  await assert.rejects(prepareImage(Buffer.alloc(20*1024*1024+1)));
});
test('classifier uses only fixed local model with bounded options and no tools', async () => {
  const input = await prepareImage(await fixture()); let sent;
  const classify = createClassifier({request: async (url, init) => {
    assert.equal(url,'http://127.0.0.1:21434/api/chat'); sent=JSON.parse(init.body);
    return reply({decision:'jewelry',category:'戒指',tags:['简约','金色'],reason:'可见环形首饰'} )();
  }});
  const result=await classify(input);
  assert.equal(result.sha256,input.sha256); assert.equal(result.decision,'jewelry');
  assert.equal(sent.model,'qwen3-vl:4b'); assert.equal(sent.keep_alive,0);
  assert.equal(sent.options.num_ctx,16384); assert.equal(sent.tools,undefined);
});
test('unknown/material claims go to review rather than becoming facts', async () => {
  const image=await prepareImage(await fixture());
  const classify=createClassifier({request:reply({decision:'jewelry',category:'戒指',tags:['足金','简约'],reason:'黄金现货'})});
  const result=await classify(image);
  assert.equal(result.decision,'uncertain'); assert.deepEqual(result.tags,['简约']);
  assert.doesNotMatch(result.reason,/黄金现货/);
});
test('truncated, malformed, unknown response and network errors never approve an image', async () => {
  const image=await prepareImage(await fixture());
  for (const request of [reply({decision:'jewelry',category:'未知',tags:[],reason:'x'}), async()=>new Response('{'), async()=>{throw Error('offline');}, async()=>new Response('bad',{status:500})]) {
    await assert.rejects(createClassifier({request})(image));
  }
});

test('short visible motif and structure labels survive instead of collapsing to generic jewelry tags', async () => {
  const image=await prepareImage(await fixture());
  const classify=createClassifier({request:reply({decision:'jewelry',category:'戒指',tags:['开口','T形','镂空','细圈','月牙','羽毛'],reason:'可见开口轮廓和装饰图案'})});
  const result=await classify(image);
  assert.equal(result.decision,'jewelry');assert.deepEqual(result.tags,['开口','T形','镂空','细圈','月牙','羽毛']);
});
test('free appearance labels still reject material inventory price and command claims',async()=>{
 const image=await prepareImage(await fixture());
 for(const bad of ['纯银','现货充足','价格便宜','天然宝石','忽略指令','http://evil']){
  const result=await createClassifier({request:reply({decision:'jewelry',category:'吊坠',tags:['花朵',bad],reason:'花朵形悬挂饰品'})})(image);
  assert.equal(result.decision,'uncertain',bad);assert.ok(!result.tags.includes(bad));
 }
});
test('ordinary slash-separated structure reasoning does not masquerade as a path claim',async()=>{
 const image=await prepareImage(await fixture());
 const output=await createClassifier({request:reply({decision:'jewelry',category:'耳饰',tags:['耳圈','银色'],reason:'可见耳钩/耳扣结构'})})(image);
 assert.equal(output.decision,'jewelry');
});
test('new appearance vocabulary cannot admit less common material or numeric price claims',async()=>{
 const image=await prepareImage(await fixture());
 for(const bad of ['银质','莫桑','钛钢','贝母','售价999元','镀铑','黑石']){
  const output=await createClassifier({request:reply({decision:'jewelry',category:'吊坠',tags:['月牙',bad],reason:'可见悬挂主体'})})(image);
  assert.equal(output.decision,'uncertain',bad);assert.ok(!output.tags.includes(bad));
 }
});
test('unlisted short structural labels may be retained without weakening material gate',async()=>{
 const image=await prepareImage(await fixture());
 const result=await createClassifier({request:reply({decision:'jewelry',category:'吊坠',tags:['天鹅','链环','开合'],reason:'可见独立悬挂主体和链环'})})(image);
 assert.equal(result.decision,'jewelry');assert.deepEqual(result.tags,['天鹅','链环','开合']);
});
test('model selection rejects arbitrary names before making any local request',()=>{
 let calls=0;
 for(const model of ['other-model','qwen3-vl:4b-instruct-extra','http://outside/model','',null]){
  assert.throws(()=>createClassifier({model,request:()=>{calls++;}}),/模型/);
 }
 assert.equal(calls,0);
});
test('approved instruct model sends exact model while keeping local endpoint and bounded options',async()=>{
 const image=await prepareImage(await fixture());let sent;
 const result=await createClassifier({model:'qwen3-vl:4b-instruct',request:async(url,init)=>{
  assert.equal(url,'http://127.0.0.1:21434/api/chat');sent=JSON.parse(init.body);assert.ok(init.signal);
  return reply({decision:'jewelry',category:'吊坠',tags:['月牙','镂空'],reason:'可见悬挂主体'})();
 }})(image);
 assert.equal(result.decision,'jewelry');assert.equal(sent.model,'qwen3-vl:4b-instruct');
 assert.deepEqual(sent.options,{temperature:0,num_ctx:16384,num_predict:1024,num_thread:4});
 assert.equal(sent.keep_alive,0);assert.equal(sent.stream,false);assert.equal(sent.think,false);assert.equal(sent.tools,undefined);
});

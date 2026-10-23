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

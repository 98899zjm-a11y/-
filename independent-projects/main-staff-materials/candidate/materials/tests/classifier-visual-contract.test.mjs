import test from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES, createClassifier } from '../lib/classifier.mjs';

const image={bytes:Buffer.from('synthetic-v2-pixels'),sha256:'d'.repeat(64)};
const reply=content=>async()=>({ok:true,json:async()=>({done:true,message:{content:JSON.stringify(content)}})});
const structure=(patch={})=>({
  view:'full',
  category_evidence:'clear_complete',
  t_cross:{shape:'neither',axis_pattern:'none',visibility:'clear'},
  chain:{carrier:'none',full_chain_visible:'no',pendant_attachment:'unknown'},
  ...patch
});
const v2=(patch={})=>({decision:'jewelry',category:'戒指',features:['开口'],structure:structure(),...patch});
const classify=(output,captured)=>createClassifier({model:'qwen3-vl:4b-instruct',schemaVersion:'visual-v2',request:async(url,init)=>{captured?.push({url,init});return reply(output)(url,init);}})(image);

test('visual-v2 sends strict controlled schema and projects to the four-field external contract', async () => {
  const captured=[];
  const output={decision:'jewelry',category:'戒指',features:['开口','月牙'],structure:structure({t_cross:{shape:'t',axis_pattern:'two_opposite_plus_perpendicular',visibility:'clear'}})};
  const result=await classify(output,captured);
  assert.deepEqual(result,{sha256:image.sha256,decision:'jewelry',category:'戒指',tags:['开口','月牙','T形'],reason:'可见戒指主体；主体结构完整；三个方向结构：两支相对，一支近垂直；可见特征：开口、月牙。'});
  assert.equal(captured.length,1);
  const sent=JSON.parse(captured[0].init.body);
  assert.equal(captured[0].url,'http://127.0.0.1:21434/api/chat');
  assert.equal(sent.model,'qwen3-vl:4b-instruct');
  assert.equal(sent.keep_alive,0);
  assert.equal(sent.stream,false);
  assert.equal(sent.think,false);
  assert.deepEqual(sent.options,{temperature:0,num_ctx:16384,num_predict:1024,num_thread:4});
  assert.equal(Object.hasOwn(sent,'tools'),false);
  assert.deepEqual(sent.format.required,['decision','category','features','structure']);
  assert.equal(sent.format.additionalProperties,false);
  assert.equal(sent.format.properties.tags,undefined);
  assert.equal(sent.format.properties.reason,undefined);
  assert.ok(sent.format.properties.features.items.enum.includes('开口'));
  assert.ok(sent.format.properties.features.items.enum.includes('月牙'));
  assert.deepEqual(sent.format.properties.structure.required,['view','category_evidence','t_cross','chain']);
  assert.deepEqual(sent.format.properties.structure.properties.t_cross.properties.shape.enum,['t','cross','y','neither','unknown']);
  assert.deepEqual(sent.format.properties.structure.properties.chain.properties.pendant_attachment.enum,['present','absent','unknown']);
});

test('T and cross use rotation-free three/four direction evidence and Y is not either', async () => {
  const t=await classify(v2({features:['开口'],structure:structure({t_cross:{shape:'t',axis_pattern:'two_opposite_plus_perpendicular',visibility:'clear'}})}));
  assert.deepEqual(t.tags,['开口','T形']);
  const cross=await classify(v2({category:'吊坠',features:['镂空'],structure:structure({t_cross:{shape:'cross',axis_pattern:'two_opposite_pairs',visibility:'clear'}})}));
  assert.deepEqual(cross.tags,['镂空','十字']);
  const y=await classify(v2({features:['开口'],structure:structure({t_cross:{shape:'y',axis_pattern:'three_non_opposite',visibility:'clear'}})}));
  assert.equal(y.decision,'jewelry');
  assert.deepEqual(y.tags,['开口']);
  const unknown=await classify(v2({features:['开口'],structure:structure({t_cross:{shape:'unknown',axis_pattern:'unknown',visibility:'unclear'}})}));
  assert.equal(unknown.decision,'jewelry');
  assert.deepEqual(unknown.tags,['开口']);
});

test('contradictory or partial T/cross evidence fails closed without shape tags', async () => {
  const tConflict=await classify(v2({features:['开口'],structure:structure({t_cross:{shape:'t',axis_pattern:'two_opposite_pairs',visibility:'clear'}})}));
  assert.equal(tConflict.decision,'uncertain');
  assert.ok(!tConflict.tags.includes('T形'));
  const crossPartial=await classify(v2({category:'吊坠',features:['镂空'],structure:structure({t_cross:{shape:'cross',axis_pattern:'two_opposite_pairs',visibility:'partial'}})}));
  assert.equal(crossPartial.decision,'uncertain');
  assert.ok(!crossPartial.tags.includes('十字'));
  const yConflict=await classify(v2({features:['开口'],structure:structure({t_cross:{shape:'y',axis_pattern:'two_opposite_plus_perpendicular',visibility:'clear'}})}));
  assert.equal(yConflict.decision,'uncertain');
  assert.ok(!yConflict.tags.includes('T形'));
});

test('page-orientation fields are rejected, proving geometry is not bound to top/up', async () => {
  const output=v2({features:['开口'],structure:structure({t_cross:{shape:'t',axis_pattern:'two_opposite_plus_perpendicular',visibility:'clear',top_bar_visible:true}})});
  await assert.rejects(classify(output),/分类结果格式无效/);
});

test('absence is recorded only from complete carrier evidence and never from missing labels', async () => {
  const necklace=await classify(v2({category:'项链',features:['链节'],structure:structure({chain:{carrier:'necklace',full_chain_visible:'yes',pendant_attachment:'absent'}})}));
  assert.deepEqual(necklace.tags,['链节','无吊坠']);
  assert.equal(necklace.reason,'可见项链主体；主体结构完整；完整链身未见悬挂附件；可见特征：链节。');
  const bracelet=await classify(v2({category:'手链',features:['链节'],structure:structure({chain:{carrier:'bracelet',full_chain_visible:'yes',pendant_attachment:'absent'}})}));
  assert.deepEqual(bracelet.tags,['链节','无吊饰']);
  const partial=await classify(v2({category:'项链',features:['链节'],structure:structure({view:'partial',chain:{carrier:'necklace',full_chain_visible:'yes',pendant_attachment:'absent'}})}));
  assert.equal(partial.decision,'uncertain');
  assert.ok(!partial.tags.includes('无吊坠'));
  const unknown=await classify(v2({category:'项链',features:['链节'],structure:structure({chain:{carrier:'necklace',full_chain_visible:'yes',pendant_attachment:'unknown'}})}));
  assert.equal(unknown.decision,'jewelry');
  assert.deepEqual(unknown.tags,['链节']);
  await assert.rejects(classify(v2({category:'项链',features:['无吊坠'],structure:structure({chain:{carrier:'necklace',full_chain_visible:'yes',pendant_attachment:'absent'}})})),/分类结果格式无效/);
  await assert.rejects(classify({...v2(),reason:'可见完整链身无吊坠'}),/分类结果格式无效/);
  const mismatch=await classify(v2({category:'戒指',features:['开口'],structure:structure({chain:{carrier:'necklace',full_chain_visible:'yes',pendant_attachment:'absent'}})}));
  assert.equal(mismatch.decision,'uncertain');
});

test('visual-v2 keeps decision and category consistent', async () => {
  const wrongPositive=await classify(v2({decision:'jewelry',category:'非首饰',features:['圆形']}));
  assert.equal(wrongPositive.decision,'uncertain');
  assert.equal(wrongPositive.category,'其他首饰');
  assert.deepEqual(wrongPositive.tags,['圆形']);
  const wrongNegative=await classify(v2({decision:'not_jewelry',category:'戒指',features:[],structure:structure({category_evidence:'non_jewelry_clear'})}));
  assert.equal(wrongNegative.decision,'uncertain');
  assert.equal(wrongNegative.category,'戒指');
  const negative=await classify(v2({decision:'not_jewelry',category:'非首饰',features:[],structure:structure({category_evidence:'non_jewelry_clear'})}));
  assert.equal(negative.decision,'not_jewelry');
  assert.equal(negative.category,'其他首饰');
  assert.deepEqual(negative.tags,[]);
  assert.equal(negative.reason,'可见明显非首饰物品。');
  const negativeWithFeature=await classify(v2({decision:'not_jewelry',category:'非首饰',features:['圆形'],structure:structure({category_evidence:'non_jewelry_clear'})}));
  assert.equal(negativeWithFeature.decision,'uncertain');
  assert.deepEqual(negativeWithFeature.tags,['圆形']);
});

test('commercial or material slots are rejected instead of silently stripped and promoted', async () => {
  for(const bad of [['现货'],['纯银'],['足金'],['售价999元']]){
    await assert.rejects(classify(v2({features:['月牙',...bad]})),/分类结果格式无效/);
  }
  await assert.rejects(classify({...v2(),tags:['月牙']}),/分类结果格式无效/);
  await assert.rejects(classify({...v2(),reason:'黄金现货'}),/分类结果格式无效/);
});

test('synthesized neutral reason does not contain commercial or unverified material wording', async () => {
  const result=await classify(v2({features:['金色','月牙'],structure:structure({t_cross:{shape:'neither',axis_pattern:'none',visibility:'clear'}})}));
  assert.equal(result.decision,'jewelry');
  assert.deepEqual(result.tags,['金色','月牙']);
  assert.equal(result.reason,'可见戒指主体；主体结构完整；可见特征：金色、月牙。');
  assert.doesNotMatch(result.reason,/材质|库存|现货|纯金|足金/);
});

test('legacy default schema remains unchanged and rejects visual-v2 payloads', async () => {
  const captured=[];
  const legacyOutput={decision:'jewelry',category:'戒指',tags:['开口'],reason:'可见环形'};
  const result=await createClassifier({request:async(url,init)=>{captured.push({url,init});return reply(legacyOutput)(url,init);}})(image);
  assert.deepEqual(result,{sha256:image.sha256,...legacyOutput});
  const sent=JSON.parse(captured[0].init.body);
  assert.deepEqual(sent.format.required,['decision','category','tags','reason']);
  assert.equal(sent.format.properties.structure,undefined);
  await assert.rejects(createClassifier({request:reply(v2())})(image),/分类结果格式无效/);
});

test('unknown visual protocol version is rejected before request',()=>{
  let calls=0;
  assert.throws(()=>createClassifier({schemaVersion:'visual-v3',request:()=>{calls++;}}),/协议版本/);
  assert.equal(calls,0);
});

test('positive jewelry cannot override ambiguous category evidence',async()=>{
  const result=await classify(v2({features:['开口'],structure:structure({category_evidence:'ambiguous'})}));
  assert.equal(result.decision,'uncertain');
  assert.equal(result.category,'戒指');
  assert.deepEqual(result.tags,['开口']);
});

test('positive jewelry cannot override non-jewelry-clear evidence',async()=>{
  const result=await classify(v2({features:['开口'],structure:structure({category_evidence:'non_jewelry_clear'})}));
  assert.equal(result.decision,'uncertain');
  assert.equal(result.category,'戒指');
  assert.deepEqual(result.tags,['开口']);
});

test('unknown view cannot support a positive jewelry decision',async()=>{
  const result=await classify(v2({features:['开口'],structure:structure({view:'unknown',category_evidence:'clear_complete'})}));
  assert.equal(result.decision,'uncertain');
  assert.equal(result.category,'戒指');
  assert.deepEqual(result.tags,['开口']);
});

test('clear complete evidence with non-full view abstains',async()=>{
  const result=await classify(v2({features:['开口'],structure:structure({view:'partial',category_evidence:'clear_complete'})}));
  assert.equal(result.decision,'uncertain');
  assert.equal(result.category,'戒指');
});

test('visible partial subject with clear partial evidence remains a positive jewelry result',async()=>{
  const result=await classify(v2({features:['开口'],structure:structure({view:'partial',category_evidence:'clear_partial'})}));
  assert.equal(result.decision,'jewelry');
  assert.equal(result.category,'戒指');
  assert.deepEqual(result.tags,['开口']);
  assert.match(result.reason,/主体结构局部可见/);
});

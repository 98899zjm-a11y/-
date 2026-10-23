import test from 'node:test';
import assert from 'node:assert/strict';
import {createClassifier} from '../lib/classifier.mjs';

// Metadata-only fictional replies. No image decoding, network or GPU request.
const fixture={bytes:Buffer.from('synthetic-review-fixture'),sha256:'1'.repeat(64)};
const claims={
  availability:['有货','缺货','可订','无货','断货','售罄','可预订'],
  price:['特价','折扣','优惠','打折','促销','降价'],
  authenticity:['高仿','A货','a货','B货','C货','仿品','假货','赝品','保真'],
};
async function classify(patch={}){
  let calls=0;
  const output={decision:'jewelry',category:'吊坠',tags:['月牙','开口'],reason:'可见独立悬挂主体',...patch};
  const result=await createClassifier({model:'qwen3-vl:4b-instruct',request:async(url,init)=>{
    calls++;
    assert.equal(url,'http://127.0.0.1:21434/api/chat');
    const body=JSON.parse(init.body);
    assert.equal(body.model,'qwen3-vl:4b-instruct');assert.equal(body.think,false);assert.equal(body.keep_alive,0);
    assert.equal(body.options.num_thread,4);assert.equal(body.tools,undefined);
    return {ok:true,json:async()=>({done:true,message:{content:JSON.stringify(output)}})};
  }})(fixture);
  assert.equal(calls,1);
  return result;
}

for(const [kind,terms] of Object.entries(claims))for(const term of terms){
  test(`R1 ${kind}: tag '${term}' must be removed and require review`,async()=>{
    const result=await classify({tags:['月牙',term]});
    assert.equal(result.decision,'uncertain');assert.deepEqual(result.tags,['月牙']);
    assert.equal(result.reason,'模型给出的部分描述超出可见外观，需人工复核。');
  });
  test(`R1 ${kind}: reason '${term}' cannot be stated as a visible fact`,async()=>{
    const result=await classify({reason:'可见悬挂主体，'+term});
    assert.equal(result.decision,'uncertain');assert.deepEqual(result.tags,['月牙','开口']);
    assert.equal(result.reason,'模型给出的部分描述超出可见外观，需人工复核。');
  });
}
test('R1 exact reviewer combined reply fails closed without approving any claims',async()=>{
  const result=await classify({tags:['月牙','有货','特价','高仿']});
  assert.equal(result.decision,'uncertain');assert.deepEqual(result.tags,['月牙']);
});
test('visible colors and free short structure labels remain supported',async()=>{
  const tags=['金色','银色','玫瑰金色','月牙','羽毛','T形','链环','镂空','开合','仿古'];
  const reason='可见金色/银色轮廓、玫瑰金色装饰和仿古几何造型';
  const result=await classify({tags,reason});
  assert.equal(result.decision,'jewelry');assert.deepEqual(result.tags,tags);assert.equal(result.reason,reason);
});
test('negative or qualified factual claims still require review',async()=>{
  for(const reason of ['暂无货','没有折扣','不是仿品','疑似高仿'])assert.equal((await classify({reason})).decision,'uncertain');
});
test('new deny terms never coerce an invalid decision into a valid one',async()=>{
  await assert.rejects(classify({decision:'approved',tags:['月牙','有货']}),/分类结果格式无效/);
});

for(const reason of ['售价９９９元','可见主体，９９９元','可见主体，１８Ｋ','成色１８Ｋ',
  '可见主体，９２５','可见主体，２ｇ','可见主体，３０ｃｍ','ｈｔｔｐ：／／invalid.example']){
  test(`NF2 existing unsafe semantics reject NFKC reason '${reason}'`,async()=>{
    const result=await classify({reason});
    assert.equal(result.decision,'uncertain');assert.deepEqual(result.tags,['月牙','开口']);
    assert.equal(result.reason,'模型给出的部分描述超出可见外观，需人工复核。');
  });
}
test('NF2 checking normalization preserves original safe output and color exceptions',async()=>{
  const tags=['T形','金色','银色','玫瑰金色','仿古'];
  const reason='可见Ｔ形金色轮廓与银色链环、玫瑰金色装饰';
  const result=await classify({tags,reason});
  assert.equal(result.decision,'jewelry');assert.deepEqual(result.tags,tags);assert.equal(result.reason,reason);
});

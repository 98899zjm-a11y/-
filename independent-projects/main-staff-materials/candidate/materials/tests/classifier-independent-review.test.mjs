import test from 'node:test';
import assert from 'node:assert/strict';
import { createClassifier } from '../lib/classifier.mjs';

const image={bytes:Buffer.from('synthetic-independent-review-pixels'),sha256:'f'.repeat(64)};
const reply=output=>async()=>({ok:true,json:async()=>({done:true,message:{content:JSON.stringify(output)}})});
const structure=(patch={})=>({
  view:'full',
  category_evidence:'clear_complete',
  t_cross:{shape:'neither',axis_pattern:'none',visibility:'clear'},
  chain:{carrier:'none',full_chain_visible:'no',pendant_attachment:'unknown'},
  ...patch
});
const classify=output=>createClassifier({model:'qwen3-vl:4b-instruct',schemaVersion:'visual-v2',request:reply(output)})(image);

test('R3 carrier none contradicts a visible full chain or a present pendant',async()=>{
  const fullChain=await classify({decision:'jewelry',category:'项链',features:['链节'],structure:structure({chain:{carrier:'none',full_chain_visible:'yes',pendant_attachment:'unknown'}})});
  assert.equal(fullChain.decision,'uncertain');
  assert.equal(fullChain.category,'项链');
  assert.ok(!fullChain.tags.includes('无吊坠'));
  const present=await classify({decision:'jewelry',category:'项链',features:['链节'],structure:structure({chain:{carrier:'none',full_chain_visible:'no',pendant_attachment:'present'}})});
  assert.equal(present.decision,'uncertain');
  assert.ok(!present.tags.includes('吊坠')&&!present.tags.includes('无吊坠'));
  const pendant=await classify({decision:'jewelry',category:'吊坠',features:['爱心'],structure:structure({chain:{carrier:'none',full_chain_visible:'yes',pendant_attachment:'unknown'}})});
  assert.equal(pendant.decision,'uncertain');
});

test('R3 necklace and bracelet categories require a matching carrier or unknown',async()=>{
  for(const [category,features] of [['项链',['链节']],['手链',['链节']]]){
    const result=await classify({decision:'jewelry',category,features,structure:structure({chain:{carrier:'none',full_chain_visible:'no',pendant_attachment:'unknown'}})});
    assert.equal(result.decision,'uncertain',category);
    assert.equal(result.category,category);
    assert.deepEqual(result.tags,features);
  }
  const ring=await classify({decision:'jewelry',category:'戒指',features:['开口'],structure:structure()});
  assert.equal(ring.decision,'jewelry');
  assert.deepEqual(ring.tags,['开口']);
});

test('R3 unknown carrier stays usable and never manufactures absence or pendant tags',async()=>{
  const present=await classify({decision:'jewelry',category:'项链',features:['链节'],structure:structure({chain:{carrier:'unknown',full_chain_visible:'unknown',pendant_attachment:'present'}})});
  assert.equal(present.decision,'jewelry');
  assert.deepEqual(present.tags,['链节']);
  const bare=await classify({decision:'jewelry',category:'项链',features:['链节'],structure:structure({chain:{carrier:'unknown',full_chain_visible:'unknown',pendant_attachment:'unknown'}})});
  assert.equal(bare.decision,'jewelry');
  assert.deepEqual(bare.tags,['链节']);
});

test('R3 explicit absence with a complete matching carrier still records absence',async()=>{
  const necklace=await classify({decision:'jewelry',category:'项链',features:['链节'],structure:structure({chain:{carrier:'necklace',full_chain_visible:'yes',pendant_attachment:'absent'}})});
  assert.equal(necklace.decision,'jewelry');
  assert.ok(necklace.tags.includes('无吊坠'));
  const bracelet=await classify({decision:'jewelry',category:'手链',features:['链节'],structure:structure({chain:{carrier:'bracelet',full_chain_visible:'yes',pendant_attachment:'absent'}})});
  assert.equal(bracelet.decision,'jewelry');
  assert.ok(bracelet.tags.includes('无吊饰'));
});

test('R3 partial visible subject stays a positive classification',async()=>{
  const result=await classify({decision:'jewelry',category:'戒指',features:['开口'],structure:structure({view:'partial',category_evidence:'clear_partial'})});
  assert.equal(result.decision,'jewelry');
  assert.equal(result.category,'戒指');
  assert.deepEqual(result.tags,['开口']);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createReviewFirstClassifier} from '../lib/review-first.mjs';
test('rollout policy preserves suggested labels but does not substitute for manager approval',async()=>{
 const original={sha256:'a'.repeat(64),decision:'jewelry',category:'戒指',tags:['素圈'],reason:'可见环形首饰'};
 const guarded=await createReviewFirstClassifier(async()=>original)({});
 assert.equal(guarded.decision,'uncertain');assert.equal(guarded.category,'戒指');assert.deepEqual(guarded.tags,['素圈']);assert.equal(original.decision,'jewelry');
});
test('non jewelry uncertainty and model errors retain their real outcome',async()=>{
 for(const decision of ['not_jewelry','uncertain'])assert.equal((await createReviewFirstClassifier(async()=>({decision}))({})).decision,decision);
 await assert.rejects(createReviewFirstClassifier(async()=>{throw Error('model unavailable');})({}),/unavailable/);
});

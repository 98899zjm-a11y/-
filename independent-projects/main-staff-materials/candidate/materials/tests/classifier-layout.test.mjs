import test from 'node:test';
import assert from 'node:assert/strict';
import {createClassifier} from '../lib/classifier.mjs';

const image = {bytes: Buffer.from('synthetic pixels'), sha256: 'b'.repeat(64)};
async function classify(reason, extra = {}) {
  const output = {decision: 'jewelry', category: '戒指', tags: ['圆形'], reason, ...extra};
  return createClassifier({request: async () => ({ok: true, json: async () => ({done: true, message: {content: JSON.stringify(output)}})})})(image);
}

test('layout separators cannot turn commercial or availability claims into visible facts', async () => {
  for (const reason of ['有 货', '现\t货', '售\n价', '仿\u200b品', '有\u2060货']) {
    const result = await classify(reason);
    assert.equal(result.decision, 'uncertain', JSON.stringify(reason));
    assert.deepEqual(result.tags, ['圆形']);
    assert.equal(result.reason, '模型给出的部分描述超出可见外观，需人工复核。');
  }
});

test('invisible-only explanations cannot justify skipping a non-jewelry image', async () => {
  for (const reason of ['\u200b', '\u200c\u200d', '\u2060', '\ufeff \u00ad']) {
    const result = await classify(reason, {decision: 'not_jewelry', category: '非首饰', tags: []});
    assert.equal(result.decision, 'uncertain', JSON.stringify(reason));
    assert.equal(result.category, '其他首饰');
    assert.deepEqual(result.tags, []);
  }
});

test('ordinary spacing and visible color exceptions remain available', async () => {
  for (const reason of ['可见金色主体与圆环链节', '可见银色 / 玫瑰金色轮廓']) {
    const result = await classify(reason);
    assert.equal(result.decision, 'jewelry');
    assert.equal(result.reason, reason);
  }
});

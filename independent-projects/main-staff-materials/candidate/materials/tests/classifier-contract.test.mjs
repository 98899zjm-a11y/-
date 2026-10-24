import test from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES, createClassifier } from '../lib/classifier.mjs';
import { createIntakeMachine } from '../vendor/intake-state/intake-state.mjs';
import { searchAssets } from '../lib/search.mjs';

const image = {bytes: Buffer.from('synthetic decoded-image placeholder'), sha256: 'a'.repeat(64)};
async function classify(output) {
  return createClassifier({model: 'qwen3-vl:4b-instruct', request: async () => ({
    ok: true,
    json: async () => ({done: true, message: {content: JSON.stringify(output)}}),
  })})(image);
}

// A contradictory negative must reach a manager instead of silently skipping a picture.
test('negative decisions with a jewelry category require review', async () => {
  for (const category of CATEGORIES) {
    const result = await classify({decision: 'not_jewelry', category, tags: [], reason: '可见装饰轮廓'});
    assert.equal(result.decision, 'uncertain', category);
    assert.equal(result.category, category);
  }
});

test('negative decisions carrying visible jewelry suggestions require review', async () => {
  const result = await classify({decision: 'not_jewelry', category: '非首饰', tags: ['镂空', '链条'], reason: '可见悬挂主体'});
  assert.equal(result.decision, 'uncertain');
  assert.equal(result.category, '其他首饰');
  assert.deepEqual(result.tags, ['镂空', '链条']);
});

test('negative decisions paired with an undecided category require review', async () => {
  const result = await classify({decision: 'not_jewelry', category: '待复核', tags: [], reason: '局部结构不明'});
  assert.equal(result.decision, 'uncertain');
  assert.equal(result.category, '其他首饰');
});

test('negative decisions without a visible reason require review', async () => {
  for (const reason of ['', '  ']) {
    const result = await classify({decision: 'not_jewelry', category: '非首饰', tags: [], reason});
    assert.equal(result.decision, 'uncertain');
    assert.equal(result.category, '其他首饰');
  }
});

test('consistent negative decisions keep the existing non-jewelry path', async () => {
  const result = await classify({decision: 'not_jewelry', category: '非首饰', tags: [], reason: '可见键盘与显示屏'});
  assert.equal(result.decision, 'not_jewelry');
  assert.equal(result.category, '其他首饰');
  assert.deepEqual(result.tags, []);
});

test('normalized storage category cannot promote a consistent negative into intake or search', async () => {
  const output = await classify({decision: 'not_jewelry', category: '非首饰', tags: [], reason: '可见键盘与显示屏'});
  const machine = createIntakeMachine({classify: async () => output});
  const initial = machine.create({taskId: 'synthetic-negative', scopeId: 'synthetic', deviceId: 'synthetic', sha256: image.sha256});
  const task = await machine.evaluate(initial);
  assert.equal(task.state, 'skipped');
  const found = searchAssets([{id: 'synthetic-negative', status: task.state, category: output.category, tags: output.tags, availability: 'unknown'}], {query: '其他首饰'});
  assert.equal(found.total, 0);
});

test('incompatible positive category remains uncertain and preserves safe suggestions', async () => {
  for (const category of ['非首饰', '待复核']) {
    const result = await classify({decision: 'jewelry', category, tags: ['圆形'], reason: '可见环形装饰'});
    assert.equal(result.decision, 'uncertain');
    assert.deepEqual(result.tags, ['圆形']);
  }
});

test('contract fallback cannot retain unsafe commercial or material statements', async () => {
  const result = await classify({decision: 'not_jewelry', category: '吊坠', tags: ['几何', '有货', '纯银'], reason: '售价９９９元'});
  assert.equal(result.decision, 'uncertain');
  assert.equal(result.category, '吊坠');
  assert.deepEqual(result.tags, ['几何']);
  assert.doesNotMatch(result.reason, /售价|９９９|纯银|有货/);
});

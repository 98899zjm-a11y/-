import test from 'node:test';
import assert from 'node:assert/strict';
import { createClassifier, CATEGORIES } from '../lib/classifier.mjs';

const fixture = { bytes: Buffer.from('fictional-image-pixels'), sha256: '0'.repeat(64) };

const expectedSchema = {
  type: 'object',
  properties: {
    decision: { type: 'string', enum: ['jewelry', 'not_jewelry', 'uncertain'] },
    category: { type: 'string', enum: [...CATEGORIES, '非首饰', '待复核'] },
    tags: { type: 'array', maxItems: 10, items: { type: 'string', maxLength: 40 } },
    reason: { type: 'string', maxLength: 300 }
  },
  required: ['decision', 'category', 'tags', 'reason'],
  additionalProperties: false
};

const validOutput = (overrides = {}) => ({
  decision: 'jewelry',
  category: '戒指',
  tags: ['简约', '月牙'],
  reason: '可见环形结构',
  ...overrides
});

const reply = (content, captured = []) => async (url, init) => {
  captured.push({ url, init });
  return {
    ok: true,
    json: async () => ({ done: true, message: { content: JSON.stringify(content) } })
  };
};

test('sends an exact object JSON Schema rather than the string json', async () => {
  const captured = [];
  const result = await createClassifier({ request: reply(validOutput(), captured) })(fixture);
  assert.equal(result.decision, 'jewelry');
  assert.equal(captured.length, 1);
  const { url, init } = captured[0];
  assert.equal(url, 'http://127.0.0.1:21434/api/chat');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['content-type'], 'application/json');
  assert.ok(init.signal);
  const sent = JSON.parse(init.body);
  assert.deepEqual(sent.format, expectedSchema);
  assert.notEqual(sent.format, 'json');
  assert.equal(sent.stream, false);
  assert.equal(sent.think, false);
  assert.equal(sent.keep_alive, 0);
  assert.deepEqual(sent.options, { temperature: 0, num_ctx: 16384, num_predict: 1024, num_thread: 4 });
  assert.equal(Object.hasOwn(sent, 'tools'), false);
});

test('both allowlisted models keep the local endpoint, fixed options and no tools', async () => {
  for (const model of ['qwen3-vl:4b', 'qwen3-vl:4b-instruct']) {
    const captured = [];
    const result = await createClassifier({ model, request: reply(validOutput(), captured) })(fixture);
    assert.equal(result.decision, 'jewelry');
    const { url, init } = captured[0];
    const sent = JSON.parse(init.body);
    assert.equal(url, 'http://127.0.0.1:21434/api/chat');
    assert.equal(sent.model, model);
    assert.deepEqual(sent.format, expectedSchema);
    assert.equal(sent.stream, false);
    assert.equal(sent.think, false);
    assert.equal(sent.keep_alive, 0);
    assert.deepEqual(sent.options, { temperature: 0, num_ctx: 16384, num_predict: 1024, num_thread: 4 });
    assert.equal(Object.hasOwn(sent, 'tools'), false);
    assert.equal(sent.tools, undefined);
  }
});

test('post-validation rejects invalid decisions, categories, shapes and lengths', async () => {
  const bad = [
    validOutput({ decision: 'approved' }),
    validOutput({ category: '未知' }),
    validOutput({ tags: '简约' }),
    validOutput({ tags: ['简'.repeat(41)] }),
    validOutput({ tags: Array.from({ length: 11 }, () => '标签') }),
    validOutput({ tags: ['简约', 7] }),
    validOutput({ reason: 7 }),
    validOutput({ reason: '可'.repeat(301) }),
    [],
    null,
    'jewelry'
  ];
  for (const output of bad) {
    await assert.rejects(
      createClassifier({ request: reply(output) })(fixture),
      /分类结果格式无效/
    );
  }
});

test('safe short free-form appearance labels are kept', async () => {
  const tags = ['月牙', '羽毛', '天鹅', '链环', 'T形', '开口'];
  const output = validOutput({ category: '吊坠', tags, reason: '可见独立悬挂主体和链环' });
  const result = await createClassifier({ request: reply(output) })(fixture);
  assert.equal(result.decision, 'jewelry');
  assert.equal(result.category, '吊坠');
  assert.deepEqual(result.tags, tags);
  assert.equal(result.reason, '可见独立悬挂主体和链环');
});

test('material and inventory tag claims still force review', async () => {
  for (const badTag of ['足金', '纯银', '现货充足', '价格便宜', '天然宝石', '售价999元']) {
    const output = validOutput({ tags: ['月牙', badTag], reason: '可见悬挂主体' });
    const result = await createClassifier({ request: reply(output) })(fixture);
    assert.equal(result.decision, 'uncertain', badTag);
    assert.deepEqual(result.tags, ['月牙'], badTag);
    assert.equal(result.reason, '模型给出的部分描述超出可见外观，需人工复核。', badTag);
  }
});

test('material or inventory reasoning alone still downgrades to review', async () => {
  const output = validOutput({ tags: ['月牙'], reason: '黄金现货' });
  const result = await createClassifier({ request: reply(output) })(fixture);
  assert.equal(result.decision, 'uncertain');
  assert.deepEqual(result.tags, ['月牙']);
  assert.equal(result.reason, '模型给出的部分描述超出可见外观，需人工复核。');
});

test('unknown top-level output fields are rejected', async () => {
  for (const extra of [{ confidence: 0.9 }, { notes: 'x' }, { tools: [] }]) {
    await assert.rejects(
      createClassifier({ request: reply(validOutput(extra)) })(fixture),
      /分类结果格式无效/
    );
  }
});
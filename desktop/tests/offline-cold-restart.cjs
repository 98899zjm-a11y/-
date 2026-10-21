'use strict';

// A fresh Node process proves that no module/session cache supplies persistence.
// Input arrives through stdin and this helper only accepts its dedicated test area.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createBackend } = require('../backend.cjs');
const { blockNetwork } = require('./offline-test-support.cjs');

async function verify() {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'));
  const target = fs.realpathSync(input.dataDir), base = fs.realpathSync(path.join(__dirname, '.acceptance-data')), relative = path.relative(base, target);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), '冷启动只能使用专属验收临时数据');
  assert.ok(fs.existsSync(path.join(target, 'jewelry.sqlite')));
  const guard = blockNetwork();
  let backend;
  try {
    backend = createBackend({ dataDir: target, migrationDir: input.migrationDir, businessPath: input.businessPath });
    const api = async (route, method = 'GET', body) => { const response = await backend.dispatch({ path: route, method, body }); assert.equal(response.ok, true, route + '：' + response.data?.error); return response.data; };
    const status = await api('/auth/status'); assert.equal(status.needsSetup, false); assert.equal(status.authenticated, false);
    await api('/auth/login', 'POST', { username: input.username, password: input.password });
    const data = await api('/api/bootstrap'), first = (await api('/api/quotes/' + input.quoteId)).quote;
    assert.equal(first.total, 4480); assert.equal(first.version, 1); assert.deepEqual(first.snapshot, input.snapshot);
    assert.equal(data.settings.sale.goldPrice, 900); assert.equal(data.settings.brand.name, '本机新品牌');
    assert.ok(!data.quotes.some(quote => quote.id === input.otherEmployeeQuoteId));
    assert.ok((await api('/api/preferences')).paymentMethods.some(method => method.id === 'a-cash'));
    const image = await backend.imageResponse(input.imageId); assert.equal(image.status, 200);
    const hash = require('node:crypto').createHash('sha256').update(Buffer.from(await image.arrayBuffer())).digest('hex');
    assert.equal(hash, input.imageHash);
    assert.deepEqual(guard.attempts, []);
    process.stdout.write(JSON.stringify({ confirmed: true, freshProcess: true, networkAttempts: guard.attempts.length }));
  } finally { if (backend) await backend.close(); guard.restore(); }
}
verify().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });

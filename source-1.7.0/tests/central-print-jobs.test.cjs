'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const { DatabaseSync } = require('node:sqlite');
const { createPrintSources } = require('../project/desktop/print-sources.cjs');
const file = path.resolve(__dirname, '../project/desktop/central-print-jobs.cjs');
function api() { if (!fs.existsSync(file)) assert.fail('The centralized print queue implementation is missing'); return require(file); }
const rejectsStatus = status => error => error.status === status;
const Q = '10000000-0000-4000-8000-000000000001';
const tick = () => new Promise(resolve => setImmediate(resolve));
const request = (extras = {}) => ({ version: 2, requestId: randomUUID(), source: { type: 'quotation-a4', quoteId: Q }, copies: 1, ...extras });
function fixture(t, overrides = {}) {
  const root = path.resolve(__dirname, '../runtime/central-print-tests'); fs.mkdirSync(root, { recursive: true });
  const directory = fs.mkdtempSync(path.join(root, 'run-'));
  const db = new DatabaseSync(path.join(directory, 'test.sqlite'));
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000');
  const context = new AsyncLocalStorage();
  const runtime = { sqlite: db, dataDir: directory, withIdentity: (identity, fn) => context.run(identity, fn), getIdentity: () => context.getStore() ?? null };
  const actors = new Map([
    ['staff-a', { id: 'staff-a', name: '虚构甲', role: 'employee', identity: { userId: 'fake-a' }, credential: 'fake-credential-a', active: true }],
    ['staff-b', { id: 'staff-b', name: '虚构乙', role: 'employee', identity: { userId: 'fake-b' }, credential: 'fake-credential-b', active: true }],
    ['admin', { id: 'admin', name: '虚构管理员', role: 'admin', identity: { userId: 'fake-admin' }, credential: 'fake-admin-credential', active: true }],
  ]);
  let current = 'staff-a', denied = false, revision = 1, total = 789.01;
  const sent = [], audit = [];
  const route = () => ({ printerId: 'p_fake_a4', deviceName: 'Fake A4 device', label: 'Fake A4', routingRevision: revision, paper: 'A4' });
  const sources = createPrintSources({ core: { getQuote: async (id, actor) => { assert.equal(context.getStore().userId, actor.identity.userId); return { quote: { id, type: 'sale', snapshot: { total, saleItems: [{ productName: '虚构素链' }] }, createdAt: '2026-10-14T00:00:00Z' } }; } }, authorize: () => !denied });
  const config = {
    runtime, sources, routing: { resolve: async () => route(), getOptions: async () => ({ profiles: { a4: { available: true, printerId: 'p_fake_a4' } }, routingRevision: revision }) },
    agent: { print: async (payload, { assertAuthorized }) => { await assertAuthorized(); sent.push(payload); return { status: 'submitted' }; } },
    authenticate: async () => actors.get(current), loadActor: async id => actors.get(id), authorizeActor: async () => !denied,
    retainedFile: path.join(directory, 'retained.json'), audit: async event => audit.push(event), ...overrides,
  };
  const queue = api().createCentralPrintJobs(config);
  let closed = false;
  t.after(async () => { if (!closed) await queue.close(); db.close(); });
  return { queue, config, db, sent, audit, directory, actors, setActor: id => { current = id; }, deny: () => { denied = true; }, changeRevision: () => { revision++; }, changeTotal: () => { total = 790; }, close: async () => { await queue.close(); closed = true; } };
}

test('requires trusted identity, runtime, source, routing and retained-file callbacks', () => {
  assert.throws(() => api().createCentralPrintJobs({}), TypeError);
});

test('final authorization leaves clock margin for another Windows process without widening its five-second limit', async t => {
  const issuedAt=Date.now();t.mock.method(Date,'now',()=>issuedAt);
  let checked=false;
  const f=fixture(t,{agent:{print:async(payload,{assertAuthorized})=>{
    const receipt=await assertAuthorized(),receiverNow=issuedAt-25;
    assert.equal(receipt.jobId,payload.jobId);assert.equal(receipt.payloadHash,payload.payloadHash);
    assert(Number.isSafeInteger(receipt.expiresAt));
    assert(receipt.expiresAt>issuedAt);
    if(receipt.expiresAt>receiverNow+5000)throw Error('Receiver rejects a receipt at the exact maximum because its clock is slightly behind');
    checked=true;return{status:'submitted'};
  }}});
  const input=request();await f.queue.submit(input);await f.queue.drain();
  assert.equal((await f.queue.byRequest(input.requestId)).job.status,'submitted');assert.equal(checked,true);
});

test('same employee request is idempotent while changed copies are refused', async t => {
  const f = fixture(t), input = request();
  await f.queue.withPaused(async () => {
    const first = await f.queue.submit(input), again = await f.queue.submit(input);
    assert.equal(first.job.id, again.job.id);
    await assert.rejects(f.queue.submit({ ...input, copies: 2 }), rejectsStatus(409));
  });
  await f.queue.drain();
  const result = await f.queue.byRequest(input.requestId);
  assert.equal(result.job.status, 'submitted');
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].document.quote.snapshot.total, 789.01);
  assert(!JSON.stringify(result).includes('fake-credential'));
  assert(!JSON.stringify(f.audit).includes('789.01'));
});

test('two employee namespaces separate identical request UUIDs and hide each other metadata', async t => {
  const f = fixture(t), input = request(); let first, second;
  await f.queue.withPaused(async () => {
    first = await f.queue.submit(input); f.setActor('staff-b'); second = await f.queue.submit(input);
    assert.notEqual(first.job.id, second.job.id);
    await assert.rejects(f.queue.get(first.job.id), rejectsStatus(404));
    assert.equal((await f.queue.list({})).jobs.length, 1);
    f.setActor('admin'); assert.equal((await f.queue.list({})).jobs.length, 2);
  });
  await f.queue.drain(); assert.equal(f.sent.length, 2);
});

test('one consumer sends different module sources serially and reports actual metadata', async t => {
  let inFlight = 0, maxFlight = 0, count = 0;
  const f = fixture(t, {
    sources: { prepare: async (_actor, source) => ({ module: source.type.startsWith('inventory') ? 'inventory' : 'sales', sourceRef: source, acceptedSource: source, requestMeta: { version: 2, sourceType: source.type, asOf: '2026-10-14', fingerprint: 'a'.repeat(64), comparison: 'immutable-snapshot' }, fingerprint: 'a'.repeat(64), comparison: 'immutable-snapshot', document: { format: 'trusted-html', bodyBase64: Buffer.from('FAKE').toString('base64') }, snapshot: {} }), revalidate: async () => true },
    agent: { print: async (_payload, { assertAuthorized }) => { await assertAuthorized(); inFlight++; maxFlight = Math.max(maxFlight, inFlight); await tick(); count++; inFlight--; return { status: 'submitted' }; } },
  });
  await f.queue.withPaused(async () => {
    await f.queue.submit(request());
    await f.queue.submit(request({ source: { type: 'inventory-count-a4', id: 12 } }));
  });
  await f.queue.drain();
  assert.equal(count, 2); assert.equal(maxFlight, 1);
  assert.deepEqual(new Set((await f.queue.list({})).jobs.map(job => job.type)), new Set(['quotation-a4', 'inventory-count-a4']));
});

test('twenty active requests are global and the twenty-first returns 429', async t => {
  const f = fixture(t);
  await f.queue.withPaused(async () => {
    for (let i = 0; i < 20; i++) { f.setActor(i % 2 ? 'staff-a' : 'staff-b'); await f.queue.submit(request()); }
    await assert.rejects(f.queue.submit(request()), rejectsStatus(429));
    assert.equal(f.db.prepare("SELECT count(*) count FROM central_print_jobs WHERE status='queued'").get().count, 20);
  });
  await f.queue.drain(); assert.equal(f.sent.length, 20);
});

test('pending credential change cancels before sending any paper', async t => {
  const f = fixture(t); let id;
  await f.queue.withPaused(async () => {
    id = (await f.queue.submit(request())).job.id;
    f.actors.set('staff-a', { ...f.actors.get('staff-a'), credential: 'changed-credential' });
  });
  await f.queue.drain();
  assert.equal((await f.queue.get(id)).job.status, 'failed'); assert.equal(f.sent.length, 0);
});

test('pending permission, routing revision and business source changes block sending', async t => {
  for (const change of ['deny', 'changeRevision', 'changeTotal']) {
    const f = fixture(t); let id;
    await f.queue.withPaused(async () => { id = (await f.queue.submit(request())).job.id; f[change](); });
    await f.queue.drain();
    assert.equal((await f.queue.get(id)).job.status, 'failed'); assert.equal(f.sent.length, 0);
  }
});

test('final authorization gate catches a route change during agent rendering', async t => {
  let fakePaper = 0, f;
  f = fixture(t, { agent: { print: async (_payload, { assertAuthorized }) => { f.changeRevision(); await assertAuthorized(); fakePaper++; return { status: 'submitted' }; } } });
  const id = (await f.queue.submit(request())).job.id; await f.queue.drain();
  assert.equal(fakePaper, 0); assert.equal((await f.queue.get(id)).job.status, 'failed');
});

test('an agent crash after the final gate is uncertain and never automatically retried', async t => {
  let fakePaper = 0;
  const f = fixture(t, { agent: { print: async (_payload, { assertAuthorized }) => { await assertAuthorized(); fakePaper++; throw new Error('after-dispatch connection lost'); } } });
  const input = request(), first = await f.queue.submit(input); await f.queue.drain();
  assert.equal((await f.queue.get(first.job.id)).job.status, 'uncertain');
  assert.equal((await f.queue.submit(input)).job.id, first.job.id); await f.queue.drain(); assert.equal(fakePaper, 1);
});

test('an agent that skips the final authorization gate cannot claim submitted', async t => {
  const f = fixture(t, { agent: { print: async () => ({ status: 'submitted' }) } });
  const id = (await f.queue.submit(request())).job.id; await f.queue.drain();
  assert.equal((await f.queue.get(id)).job.status, 'uncertain');
});

test('retained knowledge survives a rollback deleting jobs and prevents resending', async t => {
  const f = fixture(t), input = request();
  const first = await f.queue.submit(input); await f.queue.drain(); await f.close();
  f.db.exec('DELETE FROM central_print_jobs; DELETE FROM central_print_events;');
  const recovered = api().createCentralPrintJobs(f.config);
  try {
    const again = await recovered.submit(input); assert.equal(again.job.id, first.job.id); assert.equal(again.job.status, 'submitted');
    await recovered.drain(); assert.equal(f.sent.length, 1);
  } finally { await recovered.close(); }
});

test('restarting a queued job marks uncertainty and sends nothing', async t => {
  const f = fixture(t), input = request(); let id;
  await f.queue.withPaused(async () => { id = (await f.queue.submit(input)).job.id; await f.close(); });
  const recovered = api().createCentralPrintJobs(f.config);
  try { assert.equal((await recovered.get(id)).job.status, 'uncertain'); await recovered.drain(); assert.equal(f.sent.length, 0); } finally { await recovered.close(); }
});

test('a second queue owner cannot open the same retained ledger concurrently', async t => {
  const f = fixture(t);
  assert.throws(() => api().createCentralPrintJobs(f.config), rejectsStatus(409));
});

test('legacy printer choice must equal the fixed route and safe legacy data remains supported', async t => {
  const f = fixture(t), legacy = { requestId: randomUUID(), quoteId: Q, kind: 'quotation-a4', printerId: 'p_fake_a4', copies: 1 };
  const normalized = api().normalizeLegacy(legacy);
  assert.equal(normalized.source.type, 'quotation-a4'); assert.equal(normalized.source.quoteId, Q);
  await assert.rejects(f.queue.submit({ ...legacy, printerId: 'p_wrong_device' }), rejectsStatus(409));
  const id = (await f.queue.submit(legacy)).job.id; await f.queue.drain();
  assert.equal((await f.queue.get(id)).job.status, 'submitted'); assert.equal(f.sent.length, 1);
});

test('presentation refuses HTML, arbitrary devices, invalid language and unknown layout blocks', async t => {
  const f = fixture(t);
  for (const extras of [
    { actorId: 'admin' }, { printerId: 'arbitrary' }, { copies: 4 }, { presentation: { language: 'de' } },
    { presentation: { html: '<script>print()</script>' } }, { source: { type: 'inventory-metal-a4', path: '/api/users' } },
    { source: { type: 'warranty', quoteId: Q }, presentation: { warranty: { itemIndexes: [0], overrides: [] }, layoutOffsets: { unknown: { xMm: 0, yMm: 0 } } } },
  ]) await assert.rejects(f.queue.submit(request(extras)), rejectsStatus(400));
  assert.equal(f.db.prepare('SELECT count(*) count FROM central_print_jobs').get().count, 0);
});

test('legacy v1 retained jobs are read without borrowing a fake quote for module jobs', async t => {
  const legacy = { requestId: randomUUID(), quoteId: Q, kind: 'quotation-a4', printerId: 'p_fake_a4', copies: 1 };
  const stable = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
  const root = path.resolve(__dirname, '../runtime/central-print-tests'); fs.mkdirSync(root, { recursive: true });
  const oldFile = path.join(fs.mkdtempSync(path.join(root, 'legacy-')), 'old.json'), oldId = randomUUID();
  fs.writeFileSync(oldFile, JSON.stringify({ version: 1, jobs: [{ id: oldId, actorId: 'staff-a', requestId: legacy.requestId, quoteId: Q, kind: legacy.kind, paramsHash: createHash('sha256').update(stable(legacy)).digest('hex'), status: 'submitted', createdAt: '2026-10-14T00:00:00Z', updatedAt: '2026-10-14T00:00:00Z' }] }));
  const f = fixture(t, { legacyRetainedFile: oldFile });
  const result = await f.queue.submit(legacy); await f.queue.drain();
  assert.equal(result.job.id, oldId); assert.equal(result.job.status, 'submitted'); assert.equal(f.sent.length, 0);
  assert.equal(f.db.prepare('SELECT count(*) count FROM central_print_jobs').get().count, 0);
});

test('accepted payload cannot be changed by the agent after its hash is fixed', async t => {
  let printedAmount;
  const f = fixture(t, { agent: { print: async (payload, { assertAuthorized }) => {
    try { payload.document.quote.snapshot.total = 999; } catch (error) { assert(error instanceof TypeError); }
    const receipt = await assertAuthorized();
    assert.equal(receipt.payloadHash, payload.payloadHash);
    assert.equal(receipt.copies, payload.copies);
    printedAmount = payload.document.quote.snapshot.total;
    return { status: 'submitted' };
  } } });
  await f.queue.submit(request()); await f.queue.drain(); assert.equal(printedAmount, 789.01);
});

test('final dispatch authorization is one-use and cannot permit a second paper submission', async t => {
  let count = 0;
  const f = fixture(t, { agent: { print: async (_payload, { assertAuthorized }) => {
    await assertAuthorized(); count++;
    await assert.rejects(assertAuthorized(), rejectsStatus(409));
    return { status: 'submitted' };
  } } });
  const id = (await f.queue.submit(request())).job.id; await f.queue.drain();
  assert.equal(count, 1); assert.equal((await f.queue.get(id)).job.status, 'submitted');
});

test('real passive agent failure before Windows submission is failed instead of uncertain', async t => {
  const { createPrintAgent, fingerprintPrintPayload } = require('../project/desktop/print-agent.cjs');
  let f, paper = 0;
  const agent = createPrintAgent({ enumerate: async () => [], renderer: { render: async payload => {
    assert.equal(fingerprintPrintPayload(payload), payload.payloadHash);
    f.changeTotal(); return { fake: true };
  } }, submit: async () => { paper++; return { status: 'submitted' }; } });
  f = fixture(t, { agent, fingerprintPayload: fingerprintPrintPayload });
  const id = (await f.queue.submit(request())).job.id; await f.queue.drain();
  assert.equal((await f.queue.get(id)).job.status, 'failed'); assert.equal(paper, 0);
});

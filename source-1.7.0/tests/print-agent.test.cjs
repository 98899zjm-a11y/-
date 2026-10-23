'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const agentPath = path.resolve(__dirname, '../project/desktop/print-agent.cjs');
const channelPath = path.resolve(__dirname, '../project/desktop/print-agent-channel.cjs');
const jobId = '22ac6522-74a2-428d-8590-adcdd43b5329';
const secondJob = 'fe78c74a-010c-4e3a-b08a-3b1c4a2ef5ab';
const a4Name = 'Deli M2500ADW-35J04Y(WLAN)';
const a4Id = 'p_00cdbc15a3cb6379e92c9d5128eb6c18';
const knownHash = 'ac1ae5a3d007f280291bf87af52b3e1a9a74d8fb6b96eccc98b63719e3df9a5e';
const agentApi = () => { assert.ok(fs.existsSync(agentPath), 'The passive printing-agent implementation is missing'); return require(agentPath); };
const channelApi = () => { assert.ok(fs.existsSync(channelPath), 'The authenticated printing-channel implementation is missing'); return require(channelPath); };

function basePayload() {
  return { jobId, kind: 'erp-document-a4', document: { format: 'erp-json', sourceType: 'erp-document-a4',
    data: { number: 'SH-1', amountCents: 300000, lines: [{ name: 'Test chain', weight: '6.3000' }] } },
    route: { printerId: a4Id, deviceName: a4Name, label: a4Name, routingRevision: 1, paper: 'A4' }, copies: 1,
    presentation: {}, payloadHash: knownHash };
}

function receipt(payload) {
  return { jobId: payload.jobId, payloadHash: payload.payloadHash, route: structuredClone(payload.route), copies: payload.copies };
}

function fixture(extra = {}) {
  const events = [];
  const agent = agentApi().createPrintAgent({ enumerate: async () => [{ name: a4Name, displayName: a4Name, status: 0, options: {}, description: 'Test physical printer' }],
    renderer: { render: async value => { events.push({ type: 'render', value }); return { handle: 'synthetic-render', pages: 1 }; },
      destroy: async value => events.push({ type: 'destroy', value }) },
    submit: async (rendered, options, prepared) => { events.push({ type: 'submit', rendered, options, prepared }); return { status: 'submitted' }; },
    ...extra });
  return { agent, events };
}

test('payload hash uses the immutable complete payload and is independent of insertion order', () => {
  const { fingerprintPrintPayload } = agentApi();
  const payload = basePayload();
  assert.equal(fingerprintPrintPayload(payload), knownHash);
  assert.equal(fingerprintPrintPayload({ presentation: {}, copies: 1, route: payload.route, document: payload.document, kind: payload.kind, jobId }), knownHash);
});

test('the final authorization receipt is checked between passive render and the sole physical submit', async () => {
  const { agent, events } = fixture();
  const payload = basePayload();
  const result = await agent.print(payload, { assertAuthorized: async () => { events.push({ type: 'authorized' }); return receipt(payload); } });
  assert.equal(result.status, 'submitted');
  assert.deepEqual(events.map(value => value.type), ['render', 'authorized', 'submit', 'destroy']);
  assert.equal(events[2].options.deviceName, a4Name);
  assert.equal(events[2].options.copies, 1);
  assert.equal(events[2].options.pageSize, 'A4');
  assert.equal(events[0].value.policy.javascriptEnabled, false);
  assert.equal(events[0].value.policy.allowWindowPrint, false);
  assert.equal(events[0].value.policy.allowExternalResources, false);
  await agent.close();
});

test('absent or mismatched final authorization can never reach physical submit', async () => {
  for (const mismatch of ['missing', 'job', 'hash', 'route', 'copies']) {
    const { agent, events } = fixture(); const payload = basePayload(); const value = receipt(payload);
    if (mismatch === 'job') value.jobId = secondJob;
    if (mismatch === 'hash') value.payloadHash = '0'.repeat(64);
    if (mismatch === 'route') value.route.deviceName = 'other-device';
    if (mismatch === 'copies') value.copies = 2;
    const control = mismatch === 'missing' ? {} : { assertAuthorized: async () => value };
    const result = await agent.print(payload, control);
    assert.equal(result.status, 'failed');
    assert.equal(events.some(event => event.type === 'submit'), false);
    await agent.close();
  }
});

function rehash(payload) { payload.payloadHash = agentApi().fingerprintPrintPayload(payload); return payload; }

test('agent rejects unsupported kinds, extra address fields, out-of-range copies and mismatched formats', async () => {
  const variants = [value => value.kind = 'file-a4', value => value.url = 'https://must-not-load.example/',
    value => value.filePath = 'F:\\must-not-read', value => value.copies = 0, value => value.copies = 4,
    value => value.document = { format: 'erp-json', sourceType: 'inventory-metal-a4', data: {} },
    value => value.document.path = 'F:\\must-not-read', value => value.document.format = 'trusted-html'];
  for (const change of variants) {
    const payload = basePayload(); change(payload); rehash(payload);
    const { agent, events } = fixture();
    const result = await agent.print(payload, { assertAuthorized: async () => receipt(payload) });
    assert.equal(result.status, 'failed');
    assert.equal(events.some(event => event.type === 'submit'), false);
    await agent.close();
  }
});

test('empty, wrong, virtual, absent and offline routes never fall back to an OS default', async () => {
  for (const mode of ['empty', 'wrong-id', 'absent', 'virtual', 'offline']) {
    const payload = basePayload();
    let list = [{ name: a4Name, displayName: a4Name, status: 0, options: {}, isDefault: true }];
    if (mode === 'empty') payload.route.deviceName = '';
    if (mode === 'wrong-id') payload.route.printerId = 'p_' + '0'.repeat(32);
    if (mode === 'absent') list = [{ name: 'Different physical default', displayName: 'Other', status: 0, isDefault: true }];
    if (mode === 'virtual') list[0].description = 'Microsoft Print to PDF';
    if (mode === 'offline') list[0].status = 128;
    rehash(payload);
    const { agent, events } = fixture({ enumerate: async () => list });
    const result = await agent.print(payload, { assertAuthorized: async () => receipt(payload) });
    assert.equal(result.status, 'failed');
    assert.equal(events.some(event => event.type === 'submit'), false);
    await agent.close();
  }
});

test('routing is enumerated again after rendering, so newly offline devices cannot submit', async () => {
  let calls = 0;
  const { agent, events } = fixture({ enumerate: async () => [{ name: a4Name, displayName: a4Name, status: ++calls === 1 ? 0 : 128, options: {} }] });
  const payload = basePayload();
  assert.equal((await agent.print(payload, { assertAuthorized: async () => receipt(payload) })).status, 'failed');
  assert.equal(events.some(event => event.type === 'submit'), false);
  await agent.close();
});

test('structured A4 markup escapes free text while preserving all supplied business values', () => {
  const document = { format: 'erp-json', sourceType: 'erp-document-a4', data: { number: '<script>window.print()</script>',
    amountCents: 300000, balance: '2400.00', lines: [{ name: 'Test & chain', weight: '6.3000' }] } };
  const html = agentApi().createA4Html(document);
  assert.match(html, /&lt;script&gt;window.print\(\)&lt;\/script&gt;/);
  assert.match(html, /Test &amp; chain/);
  assert.match(html, /300000/);
  assert.match(html, /2400\.00/);
  assert.match(html, /6\.3000/);
  assert.doesNotMatch(html, /<script\b|<iframe\b|<object\b/i);
});

test('legacy HTML remains an original immutable snapshot under a passive policy, not a claimed sanitizer', async () => {
  const original = '<html><script>window.print();fetch("https://must-not-load.example/")</script><body>Original count 7</body></html>';
  const payload = basePayload(); payload.kind = 'inventory-count-a4';
  payload.document = { format: 'trusted-html', sourceType: payload.kind, contentType: 'text/html', bodyBase64: Buffer.from(original).toString('base64') };
  rehash(payload); const { agent, events } = fixture();
  assert.equal((await agent.print(payload, { assertAuthorized: async () => receipt(payload) })).status, 'submitted');
  const prepared = events.find(value => value.type === 'render').value;
  assert.equal(prepared.html, original);
  assert.equal(prepared.policy.javascriptEnabled, false);
  assert.equal(prepared.policy.allowWindowPrint, false);
  assert.match(prepared.policy.csp, /script-src 'none'/);
  assert.match(prepared.policy.csp, /connect-src 'none'/);
  await agent.close();
});

test('trusted PDF and encoded HTML validation rejects corrupt or oversized bytes before render', async () => {
  for (const format of ['trusted-pdf', 'trusted-html']) {
    for (const body of ['%%%not-base64', Buffer.from('not-pdf\xff').toString('base64'), Buffer.from('x'.repeat(90)).toString('base64')]) {
      const payload = basePayload(); payload.kind = format === 'trusted-pdf' ? 'ledger-report-a4' : 'inventory-report-a4';
      payload.document = { format, sourceType: payload.kind, contentType: format === 'trusted-pdf' ? 'application/pdf' : 'text/html', bodyBase64: body };
      rehash(payload); const { agent, events } = fixture({ maxDocumentBytes: 64 });
      const result = await agent.print(payload, { assertAuthorized: async () => receipt(payload) });
      assert.equal(result.status, 'failed');
      assert.equal(events.some(value => value.type === 'render'), false);
      await agent.close();
    }
  }
});

test('PDF descriptor requires passive page rendering with embedded actions and attachments disabled', async () => {
  const payload = basePayload(); payload.kind = 'ledger-report-a4';
  payload.document = { format: 'trusted-pdf', sourceType: payload.kind, contentType: 'application/pdf', bodyBase64: Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n').toString('base64') };
  rehash(payload); const { agent, events } = fixture();
  assert.equal((await agent.print(payload, { assertAuthorized: async () => receipt(payload) })).status, 'submitted');
  const prepared = events.find(value => value.type === 'render').value;
  assert.equal(prepared.renderMode, 'passive-pdf-pages');
  assert.equal(prepared.policy.allowPdfJavaScript, false);
  assert.equal(prepared.policy.allowPdfActions, false);
  assert.equal(prepared.policy.allowPdfAttachments, false);
  await agent.close();
});

test('the agent permits only one active physical sender even for different jobs', async () => {
  let release; let entered; const waiting = new Promise(resolve => { release = resolve; }); const submitting = new Promise(resolve => { entered = resolve; });
  const { agent } = fixture({ submit: async () => { entered(); return waiting; } });
  const first = basePayload(); const second = rehash({ ...basePayload(), jobId: secondJob });
  const pending = agent.print(first, { assertAuthorized: async () => receipt(first) });
  await submitting;
  const otherPending = agent.print(second, { assertAuthorized: async () => receipt(second) });
  const other = await Promise.race([otherPending, new Promise(resolve => setTimeout(() => resolve({ status: 'not-bounded' }), 25))]);
  release({ status: 'submitted' }); await pending; await otherPending;
  assert.equal(other.status, 'failed'); assert.equal(other.code, 'PRINT_AGENT_BUSY'); await agent.close();
});

test('an attempted job cannot physically submit twice after either acceptance or an uncertain error', async () => {
  for (const mode of ['accept', 'throw']) {
    let sends = 0;
    const { agent } = fixture({ submit: async () => { sends++; if (mode === 'throw') throw new Error('Synthetic lost callback'); return { status: 'submitted' }; } });
    const payload = basePayload();
    const first = await agent.print(payload, { assertAuthorized: async () => receipt(payload) });
    assert.equal(first.status, mode === 'throw' ? 'uncertain' : 'submitted');
    const second = await agent.print(payload, { assertAuthorized: async () => receipt(payload) });
    assert.equal(second.status, 'failed'); assert.equal(second.code, 'PRINT_JOB_ALREADY_ATTEMPTED');
    assert.equal(sends, 1); await agent.close();
  }
});

test('render timeout fails before submit and destroys a render handle that arrives late', async () => {
  let release; const waiting = new Promise(resolve => { release = resolve; }); let destroyed = 0; let sends = 0;
  const { agent } = fixture({ renderTimeoutMs: 5, renderer: { render: async () => waiting, destroy: async () => { destroyed++; } }, submit: async () => { sends++; return { status: 'submitted' }; } });
  const payload = basePayload(); const pending = agent.print(payload, { assertAuthorized: async () => receipt(payload) });
  const result = await Promise.race([pending, new Promise(resolve => setTimeout(() => resolve({ status: 'not-bounded' }), 30))]);
  release({ handle: 'late' }); await pending; await new Promise(resolve => setTimeout(resolve, 2));
  assert.equal(result.status, 'failed'); assert.equal(result.code, 'PRINT_RENDER_TIMEOUT'); assert.equal(sends, 0); assert.equal(destroyed, 1); await agent.close();
});

test('submit timeout remains uncertain and never triggers an automatic repeated submit', async () => {
  let release; const waiting = new Promise(resolve => { release = resolve; }); let sends = 0;
  const { agent } = fixture({ submitTimeoutMs: 5, submit: async () => { sends++; return waiting; } });
  const payload = basePayload(); const pending = agent.print(payload, { assertAuthorized: async () => receipt(payload) });
  const result = await Promise.race([pending, new Promise(resolve => setTimeout(() => resolve({ status: 'not-bounded' }), 30))]);
  release({ status: 'submitted' }); await pending;
  assert.equal(result.status, 'uncertain'); assert.equal(result.code, 'PRINT_SUBMIT_TIMEOUT'); assert.equal(sends, 1); await agent.close();
});

test('closing an agent during passive rendering prevents the later physical call', async () => {
  let release; let entered; const waiting = new Promise(resolve => { release = resolve; }); const rendering = new Promise(resolve => { entered = resolve; }); let sends = 0;
  const { agent } = fixture({ renderer: { render: async () => { entered(); return waiting; }, destroy: async () => {} }, submit: async () => { sends++; return { status: 'submitted' }; } });
  const payload = basePayload(); const pending = agent.print(payload, { assertAuthorized: async () => receipt(payload) });
  await rendering; await agent.close(); release({ handle: 'late' });
  assert.equal((await pending).status, 'failed'); assert.equal(sends, 0);
});

test('unknown submit responses remain uncertain instead of claiming actual paper output', async () => {
  const { agent } = fixture({ submit: async () => ({ status: 'printed' }) }); const payload = basePayload();
  assert.equal((await agent.print(payload, { assertAuthorized: async () => receipt(payload) })).status, 'uncertain');
  await agent.close();
});

const channelSecret = 'test-print-agent-secret-32-bytes-only';
const envelope = extra => ({ version: 1, op: 'getDevices', requestId: secondJob, issuedAt: 1000000, nonce: 'test-nonce-0123456789abcdef', ...extra });

test('authenticated fixed getDevices operation returns device data without exposing the shared secret', async () => {
  const { createAuthenticatedPrintChannel, signPrintEnvelope } = channelApi(); const { agent } = fixture();
  const channel = createAuthenticatedPrintChannel({ secret: channelSecret, agent, clock: () => 1000000 });
  const result = await channel.handle(signPrintEnvelope(channelSecret, envelope()));
  assert.equal(result[0].name, a4Name); assert.equal(JSON.stringify(result).includes(channelSecret), false); await agent.close();
});

test('bad MAC, stale timestamps and nonce replays cannot execute a fixed channel operation', async () => {
  const { createAuthenticatedPrintChannel, signPrintEnvelope } = channelApi(); let reads = 0;
  const channel = createAuthenticatedPrintChannel({ secret: channelSecret, clock: () => 1000000, agent: { getDevices: async () => { reads++; return []; } } });
  const good = signPrintEnvelope(channelSecret, envelope());
  await assert.rejects(channel.handle({ ...good, mac: '0'.repeat(64) }), error => error.status === 401);
  await assert.rejects(channel.handle(signPrintEnvelope(channelSecret, envelope({ issuedAt: 960000 }))), error => error.status === 401);
  await channel.handle(good);
  await assert.rejects(channel.handle(good), error => error.code === 'PRINT_CHANNEL_REPLAY');
  assert.equal(reads, 1);
});

test('channel MAC covers the complete print payload and cannot be changed after signing', async () => {
  const { createAuthenticatedPrintChannel, signPrintEnvelope } = channelApi(); let calls = 0;
  const channel = createAuthenticatedPrintChannel({ secret: channelSecret, clock: () => 1000000,
    agent: { print: async () => { calls++; return { status: 'submitted' }; } }, authorizePrint: async payload => receipt(payload) });
  const signed = signPrintEnvelope(channelSecret, envelope({ op: 'print', payload: basePayload() }));
  signed.payload.copies = 2;
  await assert.rejects(channel.handle(signed), error => error.status === 401);
  assert.equal(calls, 0);
});

test('print channel supplies only its trusted live authority callback to the physical agent', async () => {
  const { createAuthenticatedPrintChannel, signPrintEnvelope } = channelApi(); const { agent, events } = fixture(); let checks = 0;
  const channel = createAuthenticatedPrintChannel({ secret: channelSecret, clock: () => 1000000, agent,
    authorizePrint: async payload => { checks++; return receipt(payload); } });
  const result = await channel.handle(signPrintEnvelope(channelSecret, envelope({ op: 'print', payload: basePayload() })));
  assert.equal(result.status, 'submitted'); assert.equal(checks, 1); assert.equal(events.filter(value => value.type === 'submit').length, 1); await agent.close();
});

test('unknown operations and caller identity/path fields cannot enter the authenticated channel', () => {
  const { signPrintEnvelope } = channelApi();
  for (const input of [envelope({ op: 'shell' }), envelope({ role: 'admin' }), envelope({ path: 'F:\\must-not-read' }), envelope({ op: 'getDevices', payload: { html: '<h1>anything</h1>' } })]) {
    assert.throws(() => signPrintEnvelope(channelSecret, input), error => error.status === 400);
  }
});

test('closing a channel requires a separate trusted management decision', async () => {
  const { createAuthenticatedPrintChannel, signPrintEnvelope } = channelApi(); let closes = 0;
  const agent = { close: async () => { closes++; } };
  const blocked = createAuthenticatedPrintChannel({ secret: channelSecret, clock: () => 1000000, agent });
  await assert.rejects(blocked.handle(signPrintEnvelope(channelSecret, envelope({ op: 'close' }))), error => error.status === 403);
  assert.equal(closes, 0);
  const allowed = createAuthenticatedPrintChannel({ secret: channelSecret, clock: () => 1000000, agent, authorizeClose: async () => true });
  await allowed.handle(signPrintEnvelope(channelSecret, envelope({ op: 'close' })));
  assert.equal(closes, 1);
});

test('live nonce capacity rejects excess requests rather than evicting replay protection', async () => {
  const { createAuthenticatedPrintChannel, signPrintEnvelope } = channelApi(); let reads = 0;
  const channel = createAuthenticatedPrintChannel({ secret: channelSecret, clock: () => 1000000, maxNonces: 1, agent: { getDevices: async () => { reads++; return []; } } });
  const first = signPrintEnvelope(channelSecret, envelope());
  await channel.handle(first);
  await assert.rejects(channel.handle(signPrintEnvelope(channelSecret, envelope({ nonce: 'another-test-nonce-0123456789' }))), error => error.status === 429);
  await assert.rejects(channel.handle(first), error => error.code === 'PRINT_CHANNEL_REPLAY');
  assert.equal(reads, 1);
});

test('warranty preserves the saved paper dimensions and maps millimeters to system print units', async () => {
  const name = '\\\\192.168.1.196\\EPSON LQ-630K ESC/P2';
  const id = require('../project/desktop/print-routing.cjs').printerId(name);
  const payload = basePayload(); payload.kind = 'warranty';
  payload.document = { format: 'warranty', quote: { id: secondJob, number: 'XS-1', createdAt: '2026-10-14T00:00:00Z', snapshot: { kind: 'sales', saleItems: [{ productName: 'Test chain', weight: 6.3 }] } } };
  payload.route = { printerId: id, deviceName: name, label: name, routingRevision: 1, paper: { widthMm: 215.9, heightMm: 139.7 } };
  rehash(payload);
  const { agent, events } = fixture({ enumerate: async () => [{ name, displayName: name, status: 0, options: {} }] });
  assert.equal((await agent.print(payload, { assertAuthorized: async () => receipt(payload) })).status, 'submitted');
  assert.deepEqual(events.find(value => value.type === 'submit').options.pageSize, { width: 215900, height: 139700 });
  assert.deepEqual(payload.route.paper, { widthMm: 215.9, heightMm: 139.7 }); await agent.close();
});

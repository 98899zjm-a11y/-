'use strict';

// Guest-only scheduler tests: real owned maintenance context and synthetic
// authenticated attachments, with no database, business account or real key.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const { createBusinessMaintenanceContext } = require('../project/desktop/business-maintenance-layout.cjs');
const { createBusinessDailyBackups, dayKey } = require('../project/desktop/business-daily-backup.cjs');
const NOW = new Date('2030-01-09T12:00:00Z');
const SLOTS = ['sales', 'ledger', 'inventory', 'config', 'documents', 'quoteImages'];
const tick = () => new Promise(resolve => setImmediate(resolve));

test.before(() => {
  assert.equal(process.platform, 'win32', 'These tests require the prepared disconnected Windows Sandbox');
  assert.equal(root.toLowerCase(), 'c:\\xjy-work\\xjy-web-stage1', 'Host execution of daily backup tests is forbidden');
});

function fixture(t) {
  const base = path.join(root, 'runtime', 'daily-cache-tests'); fs.mkdirSync(base, { recursive: true });
  const owned = fs.mkdtempSync(path.join(base, 'owned-')), layout = {};
  for (const [name, directory] of Object.entries({ dataDir: 'sales', ledgerDir: 'ledger', inventoryDir: 'inventory',
    profileDir: 'profile', configDir: 'config', runtimeDir: 'runtime', logDir: 'logs', backupDir: 'backups',
    documentsDir: 'documents', quoteImagesDir: 'quote-images' })) {
    layout[name] = path.join(owned, directory); fs.mkdirSync(layout[name]);
  }
  const context = createBusinessMaintenanceContext({ root: owned, layout, hostId: 'daily-cache-toy-host',
    profileId: 'daily-cache-toy-profile', provisionOwner: true });
  const marker = path.join(layout.configDir, 'daily-backup-test.json');
  const key = crypto.randomBytes(32), rows = new Map();
  const calls = { create: 0, probe: [], cleanup: 0 };
  const behavior = { createFailures: 0, cleanupFailures: 0, probeGate: null, createGate: null, probeError: null };
  const schedulers = [];
  function archive({ now = NOW, slots = SLOTS, kind = 'auto', filename } = {}) {
    const file = filename || path.join(layout.backupDir, (kind === 'auto' ? 'AUTO' : 'MANUAL') + '-' + now.toISOString().slice(0, 10) + '-' + crypto.randomUUID() + '.xjybak');
    const body = Buffer.from(JSON.stringify({ version: 1, slots, attachment: 'synthetic attachment '.repeat(128) }));
    const mac = crypto.createHmac('sha256', key).update(body).digest();
    context.policy.io.writeFileSync(file, Buffer.concat([mac, body]));
    const row = { file, createdAt: now.toISOString(), kind }; rows.set(file, row); return row;
  }
  const service = {
    list: () => [...rows.values()].filter(row => context.policy.io.existsSync(row.file)),
    async create(options) {
      calls.create++; if (behavior.createGate) await behavior.createGate;
      if (behavior.createFailures) { behavior.createFailures--; throw new Error('synthetic create failure'); }
      return archive(options);
    },
    async probe(file, options) {
      calls.probe.push({ file, options });
      assert.equal(options?.requireCurrentSlots, true, 'cached daily validation must require every current slot');
      if (behavior.probeError) { const error = behavior.probeError; behavior.probeError = null; throw error; }
      const bytes = context.policy.io.readFileSync(file), mac = bytes.subarray(0, 32), body = bytes.subarray(32);
      if (mac.length !== 32 || !crypto.timingSafeEqual(mac, crypto.createHmac('sha256', key).update(body).digest())) throw new Error('synthetic archive authentication failed');
      const value = JSON.parse(body.toString('utf8'));
      if (SLOTS.some(slot => !value.slots.includes(slot))) throw new Error('synthetic archive lacks current captured dependencies');
      // Reading before this gate deliberately models a source replacement
      // between a successful full verification and its returned result.
      if (behavior.probeGate) await behavior.probeGate;
      return true;
    },
    async cleanup() {
      calls.cleanup++;
      if (behavior.cleanupFailures) { behavior.cleanupFailures--; throw new Error('synthetic cleanup failure'); }
      return [];
    },
  };
  function scheduler() {
    const daily = createBusinessDailyBackups({ context, service, markerName: 'daily-backup-test.json' });
    schedulers.push(daily); return daily;
  }
  function mark(row, day = '2030-01-09', extra = {}) {
    fs.writeFileSync(marker, JSON.stringify({ version: 1, namespace: context.namespace, day, file: row.file, createdAt: row.createdAt, ...extra }));
  }
  function corrupt(file) {
    const bytes = fs.readFileSync(file); bytes[bytes.length - 1] ^= 1; fs.writeFileSync(file, bytes);
  }
  t.after(async () => { for (const daily of schedulers) await daily.stop(); });
  return { owned, layout, context, marker, calls, behavior, service, archive, scheduler, mark, corrupt,
    state: () => JSON.parse(fs.readFileSync(marker, 'utf8')),
  };
}

test('P2 repeated unchanged same-day ticks perform one full archive verification', async t => {
  const f = fixture(t), daily = f.scheduler();
  assert.equal((await daily.tick(NOW)).created, true);
  for (let i = 0; i < 5; i++) assert.equal((await daily.tick(NOW)).created, false);
  assert.equal(f.calls.create, 1);
  assert.equal(f.calls.probe.length, 1, 'unchanged verified bytes must not be decrypted and staged every minute');
});

test('P2 a new scheduler always verifies an existing marker before warming its process cache', async t => {
  const f = fixture(t), first = f.scheduler(); await first.tick(NOW); await first.tick(NOW); await first.stop();
  const before = f.calls.probe.length, restarted = f.scheduler();
  assert.equal((await restarted.tick(NOW)).created, false);
  assert.equal(f.calls.probe.length, before + 1, 'a marker is not persisted proof of validation');
  await restarted.tick(NOW);
  assert.equal(f.calls.probe.length, before + 1);
});

test('P2 replacement and same-size corruption invalidate a previously verified archive', async t => {
  const f = fixture(t), daily = f.scheduler(); await daily.tick(NOW); await daily.tick(NOW);
  const oldFile = f.state().file, original = fs.readFileSync(oldFile), previous = fs.statSync(oldFile, { bigint: true });
  const replacement = path.join(f.layout.backupDir, 'replacement.tmp'); fs.writeFileSync(replacement, original); fs.renameSync(replacement, oldFile);
  const current = fs.statSync(oldFile, { bigint: true }); assert.notEqual(current.ino, previous.ino, 'replacement fixture must have a different physical identity');
  const probes = f.calls.probe.length; assert.equal((await daily.tick(NOW)).created, false);
  assert.equal(f.calls.probe.length, probes + 1, 'a replacement object must be verified even when its body is identical');
  f.corrupt(oldFile);
  assert.equal((await daily.tick(NOW)).created, true); assert.notEqual(f.state().file, oldFile);
  assert.deepEqual(fs.readFileSync(oldFile).length, original.length, 'the corrupt archive is preserved for diagnosis');
  await daily.tick(NOW); const warm = f.calls.probe.length; await daily.tick(NOW);
  assert.equal(f.calls.probe.length, warm);
});

test('P2 each nanosecond fingerprint field invalidates the cache even when millisecond fields match', async t => {
  const f = fixture(t), daily = f.scheduler(); await daily.tick(NOW); await daily.tick(NOW);
  const file = f.state().file, nativeStat = fs.statSync, nativeLstat = fs.lstatSync;
  let field = null;
  // Only the fingerprint observation is varied. The real context's captured
  // path/ancestor identity primitives and actual authenticated file stay real.
  const instrument = original => function (target, options) {
    const value = original.call(fs, target, options);
    if (path.resolve(String(target)) === file && options?.bigint && field) Object.defineProperty(value, field, { value: value[field] + 1n });
    return value;
  };
  fs.statSync = instrument(nativeStat); fs.lstatSync = instrument(nativeLstat);
  t.after(() => { fs.statSync = nativeStat; fs.lstatSync = nativeLstat; });
  for (const name of ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs']) {
    field = name; const before = f.calls.probe.length;
    assert.equal((await daily.tick(NOW)).created, false);
    assert.equal(f.calls.probe.length, before + 1, name + ' must be part of the verified fingerprint');
    await daily.tick(NOW); assert.equal(f.calls.probe.length, before + 1);
  }
});

test('P2 missing archives and China-date rollover create a fresh complete automatic backup', async t => {
  const f = fixture(t), daily = f.scheduler(); await daily.tick(NOW); await daily.tick(NOW);
  fs.unlinkSync(f.state().file);
  assert.equal((await daily.tick(NOW)).created, true);
  assert.equal((await daily.tick(new Date('2030-01-09T15:59:59Z'))).created, false);
  const next = new Date('2030-01-09T16:00:00Z'); assert.equal(dayKey(next), '2030-01-10');
  assert.equal((await daily.tick(next)).created, true); assert.equal(f.state().day, '2030-01-10');
});

test('P2 an archive missing quotation images never earns the current-slot cache', async t => {
  const f = fixture(t), old = f.archive({ slots: SLOTS.filter(slot => slot !== 'quoteImages') }); f.mark(old);
  const daily = f.scheduler(), result = await daily.tick(NOW);
  assert.equal(result.created, true); assert.notEqual(result.file, old.file);
  assert.equal(f.calls.probe[0].options.requireCurrentSlots, true);
  await daily.tick(NOW); const before = f.calls.probe.length; await daily.tick(NOW);
  assert.equal(f.calls.probe.length, before);
});

test('P2 concurrent ticks share one active verification and stopping waits for it', async t => {
  const f = fixture(t), old = f.archive(); f.mark(old);
  let release; f.behavior.probeGate = new Promise(resolve => { release = resolve; });
  const daily = f.scheduler(), first = daily.tick(NOW), second = daily.tick(NOW);
  assert.equal(first, second, 'the same in-flight task must cover concurrent ticks');
  await tick(); assert.equal(f.calls.probe.length, 1);
  let stopped = false; const stopping = daily.stop().then(() => { stopped = true; });
  await tick(); assert.equal(stopped, false); release(); await first; await stopping;
  assert.equal((await daily.tick(NOW)).stopped, true);
});

test('P2 cleanup failure is retryable without creating another complete backup', async t => {
  const f = fixture(t), daily = f.scheduler(); f.behavior.cleanupFailures = 1;
  await assert.rejects(daily.tick(NOW), /synthetic cleanup failure/);
  const createdFile = f.state().file;
  assert.equal((await daily.tick(NOW)).created, false);
  assert.equal(f.calls.create, 1); assert.equal(f.state().file, createdFile);
  assert.equal(f.calls.cleanup, 2, 'the next tick must retry pending cleanup after publication');
  await daily.tick(NOW); assert.equal(f.calls.cleanup, 2, 'successful cleanup is not repeated each minute');
});

test('P2 failed replacement creation does not make a corrupt archive look verified', async t => {
  const f = fixture(t), daily = f.scheduler(); await daily.tick(NOW); await daily.tick(NOW);
  const oldFile = f.state().file; f.corrupt(oldFile); f.behavior.createFailures = 1;
  await assert.rejects(daily.tick(NOW), /synthetic create failure/);
  assert.equal(f.state().file, oldFile);
  assert.equal((await daily.tick(NOW)).created, true); assert.notEqual(f.state().file, oldFile);
  assert.equal(fs.existsSync(oldFile), true);
});

test('P2 changing a file during successful verification cannot cache the unverified replacement bytes', async t => {
  const f = fixture(t), old = f.archive(); f.mark(old);
  let release; f.behavior.probeGate = new Promise(resolve => { release = resolve; });
  const daily = f.scheduler(), pending = daily.tick(NOW); await tick(); f.corrupt(old.file); release();
  await pending; f.behavior.probeGate = null; await daily.tick(NOW);
  assert.notEqual(f.state().file, old.file, 'changed bytes must be rechecked and replaced, never cached from an earlier probe');
});

test('P2 warm cache never bypasses namespace, marker path or hardlink guards', async t => {
  const f = fixture(t), daily = f.scheduler(); await daily.tick(NOW); await daily.tick(NOW);
  const row = f.state(), creates = f.calls.create;
  f.mark(row, row.day, { namespace: 'foreign:profile' }); await assert.rejects(daily.tick(NOW), /Invalid daily backup state/);
  f.mark(row, row.day, { file: path.join(path.dirname(f.owned), 'outside-root.xjybak') });
  await assert.rejects(daily.tick(NOW), /ISOLATION/);
  f.mark(row); const alias = path.join(f.layout.backupDir, 'hardlink.xjybak'); fs.linkSync(row.file, alias);
  await assert.rejects(daily.tick(NOW), /hard.link|ISOLATION/i); fs.unlinkSync(alias);
  assert.equal(f.calls.create, creates, 'guard failures must not fall back to a replacement backup');
});

test('P2 persisted forged validation fields cannot skip startup integrity verification', async t => {
  const f = fixture(t), row = f.archive(); f.corrupt(row.file);
  f.mark(row, '2030-01-09', { verified: true, fingerprint: { dev: '1', ino: '2', size: '99', mtimeNs: '3', ctimeNs: '4' } });
  assert.equal((await f.scheduler().tick(NOW)).created, true);
  assert.notEqual(f.state().file, row.file); assert.equal(f.calls.probe[0].file, row.file);
});

test('P2 explicit probe isolation and permission denials stop without creating a replacement', async t => {
  const outcomes = [];
  for (const code of ['ISOLATION', 'EACCES', 'EPERM']) {
    const f = fixture(t), row = f.archive(); f.mark(row);
    f.behavior.probeError = Object.assign(new Error('synthetic probe access denied'), { code });
    let rejected = null;
    try { await f.scheduler().tick(NOW); } catch (error) { rejected = error.code; }
    outcomes.push({ rejected, creates: f.calls.create, markerPreserved: f.state().file === row.file });
  }
  assert.deepEqual(outcomes, [
    { rejected: 'ISOLATION', creates: 0, markerPreserved: true },
    { rejected: 'EACCES', creates: 0, markerPreserved: true },
    { rejected: 'EPERM', creates: 0, markerPreserved: true },
  ]);
});

test('P2 a ciphertext read permission denial closes its handle and stops before backup creation', async t => {
  const f = fixture(t), row = f.archive(); f.mark(row);
  const daily = f.scheduler(), nativeRead = fs.readSync, nativeFstat = fs.fstatSync;
  const physical = fs.statSync(row.file, { bigint: true }); let armed = true, rejectedFd = null;
  fs.readSync = function (fd, ...args) {
    const info = nativeFstat.call(fs, fd, { bigint: true });
    if (armed && info.dev === physical.dev && info.ino === physical.ino) {
      armed = false; rejectedFd = fd;
      throw Object.assign(new Error('synthetic archive read permission denied'), { code: 'EACCES' });
    }
    return nativeRead.call(fs, fd, ...args);
  };
  t.after(() => { fs.readSync = nativeRead; });
  await assert.rejects(daily.tick(NOW), error => error.code === 'EACCES');
  assert.equal(f.calls.create, 0); assert.equal(f.state().file, row.file);
  assert.throws(() => nativeFstat.call(fs, rejectedFd), { code: 'EBADF' }, 'the failing archive handle must still close in finally');
  assert.equal((await daily.tick(NOW)).created, false, 'an explicit later retry can validate after access returns');
});

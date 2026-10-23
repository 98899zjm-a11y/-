'use strict';
// Independent Guest-only positive/nested controls. Original 3 and frozen 22
// remain byte-exact. No Host fallback, real/file DB, product entry or printing.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const crypto = require('node:crypto'), vm = require('node:vm'), { createRequire } = require('node:module');
const ROOT = path.resolve(__dirname, '..');
if (process.platform !== 'win32' || os.userInfo().username.toLowerCase() !== 'wdagutilityaccount' || ROOT.toLowerCase() !== 'c:\\xjy-work\\xjy-web-stage1') throw Error('Auth usage savepoint controls require the fixed actual Windows Sandbox');
const FROZEN = path.join(__dirname, 'browser-relogin-audit-records.test.cjs');
for (let current = FROZEN;; current = path.dirname(current)) {
  const info = fs.lstatSync(current);
  if (info.isSymbolicLink() || current === FROZEN && (!info.isFile() || info.nlink !== 1)) throw Error('Frozen RAM fixture must be ordinary');
  if (current === path.dirname(current)) break;
}
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const frozen = fs.readFileSync(FROZEN);
if (sha(frozen) !== '5a931cc85c18ffb3c0e8fd788e99dd559bb910a242c254b4de72548baa1d2c8a') throw Error('Frozen original 22 source changed');
const source = frozen.toString('utf8');
const marker = "test('R1 real success records B as login actor and separately links initiating A plus immutable switch-user usage'";
const at = source.indexOf(marker);
if (at < 1 || source[at - 1] !== '\n' || source.indexOf(marker, at + 1) !== -1) throw Error('Exact checked prelude boundary required');
const prelude = source.slice(0, at);
if (sha(Buffer.from(prelude)) !== '1ba9f523707b8f2678056606462e694359416378da57810743c51345083a5d67') throw Error('Frozen actualGuest/RAM prelude changed');
const loaded = { exports: {} };
vm.runInNewContext(prelude + '\nmodule.exports = { fixture, guard, IDS };\n', {
  module: loaded, exports: loaded.exports, require: createRequire(FROZEN), __dirname, __filename: FROZEN,
  process, Buffer, Request, Response, URL, URLSearchParams, fetch, AbortSignal, AbortController,
  setImmediate, clearImmediate, setTimeout, clearTimeout, console,
}, { filename: FROZEN });
// The unchanged prefix admits actual Guest before product/SQLite/password work.
const { fixture, guard, IDS } = loaded.exports;
const test = require('node:test'), assert = require('node:assert/strict');
const { getAdministration } = require(guard.assertPath(path.join(ROOT, 'project/desktop/administration.cjs')));

async function owned(t) {
  const f = await fixture(t), runtime = f.backend.runtime, administration = f.backend.administration;
  assert.equal(runtime.sqlite, f.db, 'the real backend and control share exactly one RAM connection');
  assert.equal(getAdministration(runtime), administration, 'use the actual cached administration for the same runtime, not a second controller');
  const databases = f.db.prepare('PRAGMA database_list').all();
  assert.equal(databases.length, 1); assert.equal(databases[0].name, 'main'); assert.equal(databases[0].file, '');
  const actor = f.backend.auth.status().user;
  assert.equal(actor.id, IDS.native); assert.equal(actor.role, 'admin');
  return { ...f, runtime, administration, actor };
}
const row = (f, id) => f.db.prepare('SELECT * FROM usage_sessions WHERE id=?').get(id);
function expectRefused(action) {
  assert.throws(action, error => error?.status === 500, 'invalid existing identity/open state is an internal failure, not successful usage');
}
function nativeUnchanged(f) {
  assert.equal(f.backend.auth.status().user.id, IDS.native);
  assert.equal(f.backend.auth.sessionId, f.nativeUsage, 'direct internal controls never publish another auth session');
  assert.equal(row(f, f.nativeUsage).ended_at, null);
}

test('C01 correct existing id/staff/open usage is idempotent and preserves timestamps, module and activity', { timeout: 30000 }, async t => {
  const f = await owned(t), id = crypto.randomUUID();
  f.administration.startSession(id, f.actor);
  f.db.prepare('UPDATE usage_sessions SET started_at=?,last_seen=?,last_module=?,active=? WHERE id=?').run('2026-10-16T03:00:00.000Z', '2026-10-16T03:01:00.000Z', 'inventory', 1, id);
  const before = { ...row(f, id) };
  assert.equal(before.staff_id, f.actor.id); assert.equal(before.ended_at, null);
  f.administration.startSession(id, f.actor);
  assert.deepEqual({ ...row(f, id) }, before, 'an already-correct row is not rewritten into a new start');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM usage_sessions WHERE id=?').get(id).n, 1);
  nativeUnchanged(f);
});

test('C02 existing id owned by another staff is rejected without modifying the original row', { timeout: 30000 }, async t => {
  const f = await owned(t), id = crypto.randomUUID();
  f.administration.startSession(id, f.actor);
  const before = { ...row(f, id) }, other = f.db.prepare('SELECT id,name FROM staff_users WHERE id=?').get(IDS.b);
  assert(other); assert.notEqual(other.id, before.staff_id);
  expectRefused(() => f.administration.startSession(id, other));
  assert.deepEqual({ ...row(f, id) }, before);
  nativeUnchanged(f);
});

test('C03 ended same-staff usage is rejected and its historical timestamps/reason remain immutable', { timeout: 30000 }, async t => {
  const f = await owned(t), id = crypto.randomUUID();
  f.administration.startSession(id, f.actor);
  f.administration.endSession(id, f.actor, 'logout');
  const before = { ...row(f, id) }; assert(before.ended_at); assert.equal(before.ended_reason, 'logout');
  expectRefused(() => f.administration.startSession(id, f.actor));
  assert.deepEqual({ ...row(f, id) }, before, 'an ended record cannot be relabeled as a fresh open session');
  nativeUnchanged(f);
});

test('C04 nested AFTER FAIL rolls back only usage while prior outer marker survives and outer COMMIT remains usable', { timeout: 30000 }, async t => {
  const f = await owned(t), id = crypto.randomUUID();
  f.db.exec('CREATE TABLE qa_usage_outer_marker(id TEXT PRIMARY KEY,note TEXT NOT NULL)');
  f.db.exec("CREATE TRIGGER qa_usage_nested_fail AFTER INSERT ON usage_sessions WHEN NEW.id='" + id + "' BEGIN SELECT RAISE(FAIL,'synthetic nested usage partial failure'); END");
  f.db.exec('BEGIN IMMEDIATE');
  f.db.prepare('INSERT INTO qa_usage_outer_marker(id,note) VALUES(?,?)').run(id, 'outer-before-usage');
  assert.throws(() => f.administration.startSession(id, f.actor), error => typeof error?.message === 'string' && error.message.includes('synthetic nested usage partial failure'), 'the actual AFTER FAIL must be reached inside the outer transaction');
  assert.equal(row(f, id), undefined, 'inner usage and its partial INSERT must be rolled back');
  assert.equal(f.db.prepare('SELECT note FROM qa_usage_outer_marker WHERE id=?').get(id).note, 'outer-before-usage');
  f.db.exec('DROP TRIGGER qa_usage_nested_fail');
  f.db.exec('COMMIT'); // Fails if startSession incorrectly cancelled the outer transaction.
  assert.equal(row(f, id), undefined);
  assert.equal(f.db.prepare('SELECT note FROM qa_usage_outer_marker WHERE id=?').get(id).note, 'outer-before-usage');
  nativeUnchanged(f);
});

test('C05 successful inner RELEASE does not commit the outer transaction or publish auth; outer ROLLBACK still removes both writes', { timeout: 30000 }, async t => {
  const f = await owned(t), id = crypto.randomUUID();
  f.db.exec('CREATE TABLE qa_usage_outer_marker(id TEXT PRIMARY KEY,note TEXT NOT NULL)');
  f.db.exec('BEGIN IMMEDIATE');
  f.db.prepare('INSERT INTO qa_usage_outer_marker(id,note) VALUES(?,?)').run(id, 'outer-before-inner-success');
  f.administration.startSession(id, f.actor);
  const created = row(f, id); assert(created); assert.equal(created.staff_id, f.actor.id); assert.equal(created.ended_at, null);
  assert.equal(f.db.prepare('SELECT note FROM qa_usage_outer_marker WHERE id=?').get(id).note, 'outer-before-inner-success');
  nativeUnchanged(f);
  f.db.exec('ROLLBACK'); // Must still be an active outer transaction after inner success.
  assert.equal(row(f, id), undefined);
  assert.equal(f.db.prepare('SELECT * FROM qa_usage_outer_marker WHERE id=?').get(id), undefined);
  nativeUnchanged(f);
});

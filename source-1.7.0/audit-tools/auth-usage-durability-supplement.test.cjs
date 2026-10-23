'use strict';
// Guest-only independent supplement. The frozen 22-case harness is read-only.
// Only its SHA-checked admission/auth RAM prelude executes; no original test is
// registered here. No Host fallback, file DB, product startup or real credentials.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const crypto = require('node:crypto'), vm = require('node:vm'), { createRequire } = require('node:module');
const ROOT = path.resolve(__dirname, '..');
if (process.platform !== 'win32' || os.userInfo().username.toLowerCase() !== 'wdagutilityaccount' || ROOT.toLowerCase() !== 'c:\\xjy-work\\xjy-web-stage1') throw Error('Auth usage durability supplement requires the fixed actual Windows Sandbox');
const FROZEN = path.join(__dirname, 'browser-relogin-audit-records.test.cjs');
const FROZEN_SHA = '5a931cc85c18ffb3c0e8fd788e99dd559bb910a242c254b4de72548baa1d2c8a';
const PRELUDE_SHA = '1ba9f523707b8f2678056606462e694359416378da57810743c51345083a5d67';
for (let item = FROZEN;; item = path.dirname(item)) {
  const info = fs.lstatSync(item);
  if (info.isSymbolicLink() || item === FROZEN && (!info.isFile() || info.nlink !== 1)) throw Error('Frozen RAM fixture must be an ordinary source file');
  if (item === path.dirname(item)) break;
}
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const frozenBytes = fs.readFileSync(FROZEN);
if (hash(frozenBytes) !== FROZEN_SHA) throw Error('Frozen 22-case auth harness SHA changed; Root must review a new source');
const frozenSource = frozenBytes.toString('utf8');
const marker = "test('R1 real success records B as login actor and separately links initiating A plus immutable switch-user usage'";
const at = frozenSource.indexOf(marker);
if (at < 1 || frozenSource[at - 1] !== '\n' || frozenSource.indexOf(marker, at + 1) !== -1) throw Error('Exact frozen prelude boundary required');
const prelude = frozenSource.slice(0, at);
if (hash(Buffer.from(prelude)) !== PRELUDE_SHA) throw Error('Frozen RAM admission prelude changed');
const loaded = { exports: {} };
vm.runInNewContext(prelude + '\nmodule.exports = { fixture, createBackend, LocalD1, DatabaseSync, guard, IDS, PASSWORD };\n', {
  module: loaded, exports: loaded.exports, require: createRequire(FROZEN), __dirname, __filename: FROZEN,
  process, Buffer, Request, Response, URL, URLSearchParams, fetch, AbortSignal, AbortController,
  setImmediate, clearImmediate, setTimeout, clearTimeout, console,
}, { filename: FROZEN });
// The unchanged prelude performs actual Guest admission before node:sqlite,
// runtime/backend imports, password derivation, or any HTTP/RAM fixture creation.
const { fixture, createBackend, LocalD1, DatabaseSync, guard, IDS, PASSWORD } = loaded.exports;
const test = require('node:test'), assert = require('node:assert/strict');
const loginB = () => ({ path: '/auth/login', method: 'POST', body: { username: 'fictional-b', password: PASSWORD } });

function assertAnonymous(backend) {
  const value = backend.auth.status();
  assert.equal(value.authenticated, false, 'usage establishment failure cannot publish an authenticated identity');
  assert.equal(value.user, undefined);
  assert.equal(backend.auth.sessionId, null, 'no non-persisted or failed usage UUID may remain as session authority');
  assert.equal(backend.auth.identity(), null);
  return value;
}
function assertMemoryOnly(db) {
  const databases = db.prepare('PRAGMA database_list').all();
  assert.equal(databases.length, 1); assert.equal(databases[0].name, 'main'); assert.equal(databases[0].file, '');
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
}

for (const [number, timing, raise] of [
  ['U01', 'BEFORE', 'RAISE(IGNORE)'],
  ['U02', 'AFTER', "RAISE(FAIL,'synthetic usage insert partially failed')"],
]) {
  test(number + ' Native ' + timing + ' usage INSERT fault cannot publish auth or leave open usage', { timeout: 30000 }, async t => {
    const f = await fixture(t); assertMemoryOnly(f.db);
    const prior = { ...f.usage(f.nativeUsage) };
    assert.equal(f.backend.auth.status().user.id, IDS.native);
    assert.equal(f.openUsage(IDS.b).length, 0);
    const name = 'auth_usage_supplement_' + number.toLowerCase();
    f.db.exec('CREATE TRIGGER ' + name + ' ' + timing + " INSERT ON usage_sessions WHEN NEW.staff_id='" + IDS.b + "' BEGIN SELECT " + raise + '; END');
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger' AND name=?").get(name).n, 1);
    try {
      const result = await f.backend.dispatch(loginB());
      assert.equal(result.status, 500, 'a missing/failed durable usage row is a real Native server failure');
      assert.equal(result.ok, false); assert.equal(result.data.user, undefined);
      assertAnonymous(f.backend);
      assert.equal(f.openUsage(IDS.b).length, 0, 'AFTER FAIL may retain statement changes unless the usage operation handles its own failure');
      const ended = f.usage(prior.id);
      assert.equal(ended.id, prior.id); assert.equal(ended.staff_id, prior.staff_id); assert.equal(ended.started_at, prior.started_at);
      assert(ended.ended_at); assert.equal(ended.ended_reason, 'switch-user', 'the prior Native usage is already revoked, never restored');
      assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM staff_users').get().n, 4);
      assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM local_accounts').get().n, 4);
      assertMemoryOnly(f.db);
    } finally {
      f.db.exec('DROP TRIGGER IF EXISTS ' + name);
    }
  });
}

// Setup cannot use the frozen fixture's four pre-seeded accounts. This separate
// fixture only constructs the same real schema/LocalD1/backend on fresh RAM; it
// does not copy auth/account/usage/audit algorithms, and has no HTTP server.
async function freshSetupRam(t) {
  const base = guard.assertPath(path.join(ROOT, 'runtime/auth-usage-durability-supplement'));
  fs.mkdirSync(base, { recursive: true });
  const directory = guard.assertPath(path.join(base, 'owned-' + crypto.randomUUID()));
  fs.mkdirSync(directory); // CreateNew: no existing fixture or file DB is adopted.
  fs.writeFileSync(path.join(directory, 'qa-owner.json'), JSON.stringify({ purpose: 'auth-usage-durability-supplement', memoryOnly: true, productionDataImported: false }) + '\n', { flag: 'wx' });
  const db = new DatabaseSync(':memory:'); let runtimeClosed = false, backend = null;
  const runtime = {
    sqlite: db, dataDir: directory,
    env: { DB: new LocalD1(db), BUCKET: {
      async get() { return null; },
      async put() { throw Error('AUTH_USAGE_TEST_MUST_NOT_WRITE_ATTACHMENTS'); },
      async delete() { throw Error('AUTH_USAGE_TEST_MUST_NOT_DELETE_ATTACHMENTS'); },
    } },
    withIdentity: (_identity, action) => action(),
    close() { if (!runtimeClosed) { runtimeClosed = true; db.close(); } },
  };
  t.after(async () => { try { if (backend) await backend.close(); } finally { runtime.close(); } });
  db.exec('PRAGMA foreign_keys=ON');
  const migrations = guard.assertPath(path.join(ROOT, 'project/desktop/migrations'));
  for (const name of fs.readdirSync(migrations).filter(name => /^\d+_[\w-]+\.sql$/.test(name)).sort()) db.exec(fs.readFileSync(guard.assertPath(path.join(migrations, name)), 'utf8'));
  // Same local auth schema as the checked original RAM fixture, initially empty.
  db.exec('CREATE TABLE local_accounts(staff_id TEXT PRIMARY KEY NOT NULL REFERENCES staff_users(id),username TEXT UNIQUE NOT NULL,password_salt TEXT NOT NULL,password_hash TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)');
  const printServices = { legacyRetainedFile: path.join(directory, 'unused-print.json'), legacyMetadataFile: path.join(directory, 'unused-print-metadata.json'), retainedFile: path.join(directory, 'unused-central-print.json') };
  for (const file of Object.values(printServices)) guard.assertPath(file);
  backend = createBackend({ dataDir: directory, migrationDir: migrations, runtimeFactory: () => runtime, businessCore: {}, pollsAdapter: {}, aiAdapter: {}, printServices,
    updateServices: { getCatalog() { throw Error('AUTH_USAGE_TEST_MUST_NOT_UPDATE'); }, getChunk() { throw Error('AUTH_USAGE_TEST_MUST_NOT_UPDATE'); }, async close() {} } });
  assertMemoryOnly(db);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM staff_users').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM local_accounts').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM usage_sessions').get().n, 0);
  const status = assertAnonymous(backend); assert.equal(status.needsSetup, true);
  return { backend, db, directory, printServices };
}

test('U03 fresh setup usage ABORT preserves the committed account and local-setup audit, then ordinary login recovers', { timeout: 30000 }, async t => {
  const f = await freshSetupRam(t), name = 'auth_usage_supplement_setup_abort';
  const account = { username: 'fictional-usage-setup-admin', name: '虚构使用会话持久化管理员', password: PASSWORD };
  f.db.exec('CREATE TRIGGER ' + name + " BEFORE INSERT ON usage_sessions BEGIN SELECT RAISE(ABORT,'synthetic setup usage start rejected'); END");
  let saved, savedCredential, savedAudit;
  try {
    const result = await f.backend.dispatch({ path: '/auth/setup', method: 'POST', body: account });
    assert.equal(result.status, 500); assert.equal(result.ok, false); assert.equal(result.data.user, undefined);
    const status = assertAnonymous(f.backend); assert.equal(status.needsSetup, false, 'the completed setup account transaction must not be deleted to retry session establishment');
    const users = f.db.prepare('SELECT * FROM staff_users').all(), accounts = f.db.prepare('SELECT * FROM local_accounts').all();
    assert.equal(users.length, 1); assert.equal(accounts.length, 1);
    saved = { ...users[0] }; savedCredential = { ...accounts[0] };
    assert.equal(saved.id, savedCredential.staff_id); assert.equal(saved.role, 'admin'); assert.equal(saved.active, 1);
    assert.equal(savedCredential.username, account.username); assert.equal(saved.name, account.name);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM usage_sessions WHERE ended_at IS NULL').get().n, 0);
    const audits = f.db.prepare("SELECT * FROM audit_logs WHERE entity_type='user' AND action='local-setup'").all();
    assert.equal(audits.length, 1); savedAudit = { ...audits[0] };
    assert.equal(savedAudit.entity_id, saved.id); assert.equal(savedAudit.actor_id, saved.id);
    assert.equal(JSON.parse(savedAudit.new_value).id, saved.id);
    assertMemoryOnly(f.db);
  } finally {
    f.db.exec('DROP TRIGGER IF EXISTS ' + name);
  }
  const recovered = await f.backend.dispatch({ path: '/auth/login', method: 'POST', body: { username: account.username, password: account.password } });
  assert.equal(recovered.status, 200); assert.equal(recovered.ok, true); assert.equal(recovered.data.user.id, saved.id);
  assert.equal(f.backend.auth.status().user.id, saved.id); assert.equal(f.backend.auth.status().needsSetup, false);
  const usageId = f.backend.auth.sessionId;
  assert.match(usageId, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  const open = f.db.prepare('SELECT * FROM usage_sessions WHERE ended_at IS NULL').all();
  assert.equal(open.length, 1); assert.equal(open[0].id, usageId); assert.equal(open[0].staff_id, saved.id);
  // Compare inside the test only; do not print/export the fictitious credentials.
  assert.deepEqual({ ...f.db.prepare('SELECT * FROM staff_users WHERE id=?').get(saved.id) }, saved);
  assert.equal(JSON.stringify({ ...f.db.prepare('SELECT * FROM local_accounts WHERE staff_id=?').get(saved.id) }) === JSON.stringify(savedCredential), true, 'committed credentials remain unchanged; failure diagnostics must not dump salt/hash');
  assert.deepEqual({ ...f.db.prepare("SELECT * FROM audit_logs WHERE entity_type='user' AND action='local-setup'").get() }, savedAudit);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM staff_users').get().n, 1);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM local_accounts').get().n, 1);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE entity_type='user' AND action='local-setup'").get().n, 1);
  for (const file of Object.values(f.printServices)) assert.equal(fs.existsSync(file), false);
  assertMemoryOnly(f.db);
});

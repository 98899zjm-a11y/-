'use strict';
// Root-only admitted offline Guest. Host may use --check, never require/run.
// Actual SQLite/archives/maintenance public handle; every byte and actor is fake.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
if (process.platform !== 'win32' || os.userInfo().username.toLowerCase() !== 'wdagutilityaccount' || ROOT.toLowerCase() !== 'c:\\xjy-work\\xjy-web-stage1') throw Error('Fixed actual offline Guest required before business imports or writes');
const assert = require('node:assert/strict'), hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const SELF = 'audit-tools/strict-round2-maintenance-log-queue.test.cjs';
const GUARDS = Object.freeze({
  'stage1/guest-candidate-cdp.cjs': '59840b638d8797fb55241616cd0b8e4098075a76834a201b0e93c1a748f1bb32',
  'stage1/sandbox-context.py': '09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249',
  'stage1/validate-sandbox-context.py': '867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207',
});
const BASE_FILES = Object.freeze([
  'project/desktop/business-maintenance.cjs', 'project/desktop/business-maintenance-layout.cjs',
  'project/desktop/business-backups.cjs', 'project/desktop/business-restore.cjs',
  'project/desktop/business-daily-backup.cjs', 'project/desktop/business-authority-preserve.cjs',
  'project/desktop/business-erp-backup-integrity.cjs', 'project/desktop/administration.cjs',
  'project/desktop/erp-policy.cjs', 'project/desktop/runtime.cjs',
]);
function read(relative) {
  const file = path.join(ROOT, ...relative.split('/')), local = path.relative(ROOT, file);
  if (local === '..' || local.startsWith('..' + path.sep) || path.isAbsolute(local)) throw Error('Source escaped fixed Root');
  for (let cursor = file;; cursor = path.dirname(cursor)) { const stat = fs.lstatSync(cursor); if (stat.isSymbolicLink() || stat.isFile() && stat.nlink !== 1) throw Error('Source links refused'); if (cursor === path.dirname(cursor)) break; }
  const stat = fs.statSync(file); if (!stat.isFile() || stat.size > 4 * 1024 * 1024) throw Error('Bounded ordinary source required');
  return fs.readFileSync(file);
}
for (const [file, pin] of Object.entries(GUARDS)) assert.equal(hash(read(file)), pin, 'Unchanged actual admission source required');
const selfPin = process.env.XJY_STRICT_ROUND2_MAINTENANCE_LOG_TEST_SHA256;
assert.match(selfPin || '', /^[a-f0-9]{64}$/); assert.equal(hash(read(SELF)), selfPin, 'Exact Root-reviewed new contract required');
const pins = JSON.parse(process.env.XJY_STRICT_ROUND2_MAINTENANCE_LOG_SOURCE_PINS || 'null');
assert(pins && typeof pins === 'object' && !Array.isArray(pins));
const migrations = fs.readdirSync(path.join(ROOT, 'project', 'desktop', 'migrations')).filter(name => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort().map(name => 'project/desktop/migrations/' + name);
assert(migrations.includes('project/desktop/migrations/0010_sales_orders.sql'));
assert.deepEqual(Object.keys(pins).sort(), [...BASE_FILES, ...migrations].sort(), 'Exact dependency and complete migration inventory required');
for (const [file, pin] of Object.entries(pins)) { assert.match(pin || '', /^[a-f0-9]{64}$/); assert.equal(hash(read(file)), pin, 'Frozen candidate changed: ' + file); }
const actualContext = require('../stage1/guest-candidate-cdp.cjs').actualGuard();
const expectedNamespace = process.env.XJY_STRICT_ROUND2_MAINTENANCE_LOG_NAMESPACE;
assert.match(expectedNamespace || '', /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
assert.equal(JSON.parse(read('isolation-identity.json').toString('utf8').replace(/^\uFEFF/, '')).namespace, expectedNamespace, 'Actual handed-back namespace required');
const test = require('node:test'), { DatabaseSync } = require('node:sqlite');
const api = file => { const relative = 'project/desktop/' + file; assert(Object.hasOwn(pins, relative)); return require(path.join(ROOT, ...relative.split('/'))); };
const ACTOR = 'b1000000-0000-4000-8000-000000000001', STAMP = '2030-01-01T00:00:00.000Z';
console.log(JSON.stringify({ purpose: 'strict-round2-public-maintenance-queue-log-failure', actualContext, namespace: expectedNamespace, testSha256: selfPin, sourcePins: pins, methods: 3, productionDataUsed: false, actualHttpVerified: false, nativeExecuted: false }));

function fixture(t) {
  const base = path.join(ROOT, 'runtime', 'strict-round2-maintenance-log-tests'); fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, 'owned-')), layout = {};
  for (const [field, name] of Object.entries({ dataDir: 'sales', ledgerDir: 'ledger', inventoryDir: 'inventory', profileDir: 'profile', configDir: 'config', runtimeDir: 'runtime', logDir: 'logs', backupDir: 'backups', documentsDir: 'documents', quoteImagesDir: 'quote-images' })) { layout[field] = path.join(root, name); fs.mkdirSync(layout[field]); }
  let db = new DatabaseSync(path.join(layout.dataDir, 'jewelry.sqlite')); db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');
  for (const file of migrations) db.exec(read(file).toString('utf8'));
  const local = /sqlite\.exec\(`(CREATE TABLE IF NOT EXISTS local_accounts[\s\S]*?)`\);/.exec(read('project/desktop/runtime.cjs').toString('utf8'));
  assert(local && !local[1].includes('${'), 'Exact known account schema'); db.exec(local[1]);
  db.prepare('INSERT INTO staff_users(id,user_id,email,name,role,active,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?)').run(ACTOR, null, 'maintenance-log@example.invalid', '维护日志虚构管理员', 'admin', STAMP, STAMP);
  db.prepare('INSERT INTO local_accounts VALUES(?,?,?,?,?,?)').run(ACTOR, 'maintenance-log', '01'.repeat(16), 'ab'.repeat(64), STAMP, STAMP);
  db.prepare('INSERT INTO module_permissions VALUES(?,?,?,?,?,?)').run(ACTOR, 'manage', 'disabled', 'disabled', 1, STAMP);
  db.prepare('INSERT INTO staff_capabilities VALUES(?,?,?)').run(ACTOR, '{}', STAMP);
  const proofDDL = "CREATE TABLE strict_round2_maintenance_proof(value TEXT); INSERT INTO strict_round2_maintenance_proof VALUES('archive-before');";
  db.exec(proofDDL);
  for (const [field, filename] of [['ledgerDir', 'ledger.db'], ['inventoryDir', 'stockcheck.db']]) { const other = new DatabaseSync(path.join(layout[field], filename)); other.exec(proofDDL); other.close(); }
  const printing = new Map(); for (const suffix of ['.print-ledger.json', '.print-ledger.metadata.json', '.central-print-ledger.json']) { const file = layout.dataDir + suffix, bytes = Buffer.from('{"version":1,"synthetic":"maintenance-log-before"}'); fs.writeFileSync(file, bytes, { flag: 'wx' }); printing.set(file, bytes); }
  t.after(() => { try { db.close(); } catch { /* An earlier lifecycle failure may already have closed it. */ } });
  const context = api('business-maintenance-layout.cjs').createBusinessMaintenanceContext({ root, layout, hostId: 'strict-maintenance-log-host', profileId: 'strict-maintenance-log-profile', provisionOwner: true });
  const lifecycle = [], actor = { id: ACTOR, name: '维护日志虚构管理员', role: 'admin', active: true };
  function service() {
    return api('business-maintenance.cjs').createBusinessMaintenance({ context, database: () => db,
      authorize: async user => { const row = db.prepare('SELECT role,active FROM staff_users WHERE id=?').get(user.id); return row?.active === 1 && row.role === 'admin' && user.id === ACTOR; },
      withFrozen: action => action(), freeze: action => action(), prepare: action => action(),
      stop: async () => { lifecycle.push('stop'); db.close(); },
      resume: async () => { lifecycle.push('resume'); db = new DatabaseSync(path.join(layout.dataDir, 'jewelry.sqlite')); db.exec('PRAGMA foreign_keys=ON;'); },
      invalidateSessions: async () => lifecycle.push('invalidate'),
    });
  }
  const backup = instance => instance.handle(actor, { path: '/api/local/backups', method: 'POST', body: {} });
  const list = async instance => { const result = await instance.handle(actor, { path: '/api/local/backups', method: 'GET' }); assert.equal(result.status, 200); return result.data; };
  async function seedArchive() {
    const initial = service(), accepted = await backup(initial); assert.equal(accepted.status, 202);
    await initial.close(); const snapshot = await list(initial), job = snapshot.jobs.find(item => item.id === accepted.data.jobId);
    assert.equal(job?.status, 'completed', 'Healthy public backup must work before any fault'); assert(job.result?.file);
    assert(snapshot.backups.some(item => item.name === path.basename(job.result.file))); return job.result.file;
  }
  function blockLog(name) {
    assert(['business-maintenance-events.jsonl', 'business-maintenance-errors.log'].includes(name));
    const file = path.join(layout.logDir, name); let preserved = null;
    if (fs.existsSync(file)) { assert(fs.lstatSync(file).isFile()); const bytes = fs.readFileSync(file), saved = file + '.preserved-' + crypto.randomUUID(); fs.renameSync(file, saved); preserved = { saved, bytes }; }
    fs.mkdirSync(file); return { file, identity: fs.statSync(file), preserved };
  }
  function unchangedLogFault(fault) { const now = fs.statSync(fault.file); assert(now.isDirectory()); assert.equal(now.dev, fault.identity.dev); assert.equal(now.ino, fault.identity.ino); if (fault.preserved) assert.deepEqual(fs.readFileSync(fault.preserved.saved), fault.preserved.bytes); }
  async function queuedPair(filename) {
    const instance = service();
    const denied = await instance.handle({ ...actor, role: 'employee' }, { path: '/api/local/backups', method: 'POST', body: {} }); assert.equal(denied.status, 403);
    const first = await instance.handle(actor, { path: '/api/local/restore', method: 'POST', body: { name: path.basename(filename), selection: 'sales', confirmation: '确认恢复所选业务资料' } }); assert.equal(first.status, 202);
    const second = await backup(instance); assert.equal(second.status, 202);
    // Both are accepted before submit's first setImmediate. Observe close now,
    // before a rejected tail can become an unrelated unhandledRejection. This
    // does not replace Promise/fs/product code or swallow a failed assertion.
    let closeError = null; await instance.close().catch(error => { closeError = error; });
    const snapshot = await list(instance), jobs = [first, second].map(reply => snapshot.jobs.find(item => item.id === reply.data.jobId));
    assert(jobs.every(Boolean));
    console.log(JSON.stringify({ caseEvidence: { jobs, closeError: closeError && { name: closeError.name, code: closeError.code, message: closeError.message }, lifecycle, proof: db.prepare('SELECT value FROM strict_round2_maintenance_proof').get().value } }));
    return { instance, jobs, closeError, snapshot };
  }
  return { root, layout, seedArchive, blockLog, unchangedLogFault, queuedPair, lifecycle, get db() { return db; }, journal: () => JSON.parse(fs.readFileSync(path.join(layout.runtimeDir, 'restore-transaction.json'), 'utf8')), printUnchanged: () => { for (const [file, bytes] of printing) assert.deepEqual(fs.readFileSync(file), bytes); } };
}

function completedBackup(result) { assert.equal(result.jobs[1].kind, 'backup'); assert.equal(result.jobs[1].status, 'completed', 'An accepted following task must run despite a prior diagnostic append failure'); assert(result.jobs[1].result?.file); assert(fs.statSync(result.jobs[1].result.file).isFile()); assert(result.snapshot.backups.some(item => item.name === path.basename(result.jobs[1].result.file))); assert.equal(result.closeError, null, 'Diagnostics must not reject the private maintenance tail or its ordinary drain'); }
function committedRestore(f, result) { const first = result.jobs[0]; assert.equal(first.kind, 'restore'); assert.equal(first.status, 'completed'); assert.equal(first.result?.ok, true); assert.equal(f.journal().state, 'COMMITTED'); assert.equal(f.db.prepare('SELECT value FROM strict_round2_maintenance_proof').get().value, 'archive-before'); assert.deepEqual(f.lifecycle, ['stop', 'invalidate', 'resume']); f.printUnchanged(); }

test('H00 public admin queue performs real restore and a following real backup with healthy diagnostics', { concurrency: false }, async t => {
  const f = fixture(t), saved = await f.seedArchive(); f.db.exec("UPDATE strict_round2_maintenance_proof SET value='live-after'");
  const result = await f.queuedPair(saved); committedRestore(f, result); completedBackup(result);
  const events = fs.readFileSync(path.join(f.layout.logDir, 'business-maintenance-events.jsonl'), 'utf8').trim().split('\n').map(row => JSON.parse(row));
  for (const job of result.jobs) assert(events.some(item => item.id === job.id && item.status === 'completed'));
});

test('L01 a real events-log directory cannot poison the queue after an actually committed restore', { concurrency: false }, async t => {
  const f = fixture(t), saved = await f.seedArchive(), fault = f.blockLog('business-maintenance-events.jsonl');
  f.db.exec("UPDATE strict_round2_maintenance_proof SET value='live-after'"); const result = await f.queuedPair(saved);
  committedRestore(f, result); f.unchangedLogFault(fault); completedBackup(result);
});

test('L02 failed error and events logs preserve the real archive authentication error and allow the next backup', { concurrency: false }, async t => {
  const f = fixture(t), original = await f.seedArchive(), bad = path.join(f.layout.backupDir, 'MANUAL-2030-01-01-' + crypto.randomUUID() + '.xjybak');
  fs.copyFileSync(original, bad, fs.constants.COPYFILE_EXCL); const bytes = fs.readFileSync(bad); assert(bytes.length > 256); bytes[bytes.length - 1] ^= 1; fs.writeFileSync(bad, bytes);
  // Only an invented archive's GCM tag changes; its authenticated header still
  // admits selection through the real public list, then actual staging fails.
  const faults = [f.blockLog('business-maintenance-errors.log'), f.blockLog('business-maintenance-events.jsonl')];
  f.db.exec("UPDATE strict_round2_maintenance_proof SET value='live-after'"); const result = await f.queuedPair(bad), first = result.jobs[0];
  assert.equal(first.status, 'failed'); assert.equal(first.result, undefined);
  assert.match(first.error, /authenticate|authentication|integrity|bad decrypt|unsupported state/i, 'The original business error must survive failed diagnostic writes');
  assert.doesNotMatch(first.error, /business-maintenance-(?:errors|events)|EISDIR|EPERM/);
  assert.equal(f.db.prepare('SELECT value FROM strict_round2_maintenance_proof').get().value, 'live-after'); assert.deepEqual(f.lifecycle, []);
  assert.equal(fs.existsSync(path.join(f.layout.runtimeDir, 'restore-transaction.json')), false); for (const fault of faults) f.unchangedLogFault(fault);
  f.printUnchanged(); completedBackup(result);
});

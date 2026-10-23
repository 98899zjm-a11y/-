'use strict';
// Root-only actual offline Guest contracts. Host may use --check only.
// Real SQLite, authenticated three-database archives and real restore code;
// all identities, quotations, paths and bytes below are newly invented.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..'), sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
if (process.platform !== 'win32' || os.userInfo().username.toLowerCase() !== 'wdagutilityaccount' || ROOT.toLowerCase() !== 'c:\\xjy-work\\xjy-web-stage1') throw Error('Fixed actual Windows Sandbox required before product imports or writes');
const PINS = Object.freeze({
  'stage1/guest-candidate-cdp.cjs': '59840b638d8797fb55241616cd0b8e4098075a76834a201b0e93c1a748f1bb32',
  'stage1/sandbox-context.py': '09426dfd4d699c51570e1f1b10c2e37c00f6feb699b9a472ca710ae5242bf249',
  'stage1/validate-sandbox-context.py': '867a0117d6bc200960df06a355ffafcf639f24532ece3bc4db34f6e397325207',
  'project/desktop/business-maintenance-layout.cjs': 'ac1fe4b4fca70e8e5cfb034dd1cfb309117d16e919b8bad0c3081ce2563e1d0c',
  'project/desktop/business-backups.cjs': '1dfc202309eea605fe6380d66567403c202da3412c2af6e8da6229619038d443',
  'project/desktop/business-restore.cjs': 'c2842116294e6a8d6b9c8ae2725004c6f92ed179c0fb25f4dd91b582f0ed2591',
  'project/desktop/business-authority-preserve.cjs': 'c01bbc2fcf950aa8a69754b25c1cc3e92943c139b2530c842d3960bb429f7739',
  'project/desktop/business-erp-backup-integrity.cjs': 'f8e3106faa7c8a7258cd67d72ab331dd7a09340ad4241c4da25063ddba991aa4',
  'project/desktop/sales-orders.cjs': '42b075f55c123e382de1ad0d4074d37e2b090cfcee8bc5bbe2139959e36afb6c',
  'project/desktop/administration.cjs': '51cad03e5492009e410717659b70b74bb6553b55a40f71f5ee7d80f2718c06ed',
  'project/desktop/runtime.cjs': '2cbeacc186d37da607dcb0f0460518c23835eb290416e4d6b497f97b4f72f8bd',
  'project/desktop/migrations/0000_productive_gabe_jones.sql': 'c2f71684ef7d759723789a1af2117e1dbe699cbb238811b29805d71af6fed112',
  'project/desktop/migrations/0001_cheerful_starfox.sql': 'aebf502e82ff174c4f2e9978fff21d4f31b7314d31ca1ffe8bda6542c49d43cd',
  'project/desktop/migrations/0002_sales_records.sql': '8be5479cb0cd800a27e4d6f9fba26241a9eaaed99e930bbefff52c3e8baf200e',
  'project/desktop/migrations/0003_quote_image_pages.sql': 'b94eb17c12a19b240bf7afd185adce0366369b8b022cf9e07c5edbb0d8c6f39b',
  'project/desktop/migrations/0004_module_administration.sql': '22b8aa86f01a5adf502c6677abce58408b9f6c5f9b183853b036ace632cf0789',
  'project/desktop/migrations/0005_workspace_collaboration.sql': 'fa7d398171a2b85c3a86814e91b6e427695e75f56ae966263b3200da29d5ee4c',
  'project/desktop/migrations/0006_continuous_document_numbers.sql': '229949ce92743955ae1806438dec61243dc7b4292c070323e10e5237313aac59',
  'project/desktop/migrations/0007_collaboration_review_versions.sql': '3bfc68e8cc542a906e14b4f46366019d5c36563e2df7fe5e65ec1d7263b910be',
  'project/desktop/migrations/0008_customer_responsibility.sql': 'ebbb338a8921ff79cde7bb4cd1c42edea0b3cfc35f8c5192e91b744403fe11fa',
  'project/desktop/migrations/0009_employee_profiles.sql': '09e78d25c5b64e3533e329dbfce7e5f0e2326654363722e4b4def2deaa5c0602',
  'project/desktop/migrations/0010_sales_orders.sql': '328d22077a9fbb5e59ee4001a680433aaf2fb4df69773b35bcbb026dd3586356',
  'project/desktop/migrations/0011_employee_posts.sql': '89f2f5ef64f94afc07a3aa2cebebf43dcc65378534049e1f10bd91f0b3e69c9a'
});
function read(relative) {
  if (!Object.hasOwn(PINS, relative) && relative !== 'audit-tools/strict-170-restore.test.cjs') throw Error('Unpinned source read');
  const file = path.join(ROOT, ...relative.split('/'));
  for (let cursor = file; ; cursor = path.dirname(cursor)) { const stat = fs.lstatSync(cursor); if (stat.isSymbolicLink() || stat.isFile() && stat.nlink !== 1) throw Error('Source links refused'); if (cursor === path.dirname(cursor)) break; }
  const stat = fs.statSync(file); if (!stat.isFile() || stat.size > 4 * 1024 * 1024) throw Error('Bounded ordinary source required'); return fs.readFileSync(file);
}
for (const [relative, pin] of Object.entries(PINS)) if (sha(read(relative)) !== pin) throw Error('Frozen strict-170 source changed: ' + relative);
const selfPin = process.env.XJY_STRICT_170_TEST_SHA256;
if (!/^[a-f0-9]{64}$/.test(selfPin || '') || sha(read('audit-tools/strict-170-restore.test.cjs')) !== selfPin) throw Error('Root-reviewed test SHA required');
const actualContext = require('../stage1/guest-candidate-cdp.cjs').actualGuard();
const test = require('node:test'), assert = require('node:assert/strict'), { DatabaseSync } = require('node:sqlite');
const desktop = path.join(ROOT, 'project', 'desktop');
const api = name => { const relative = 'project/desktop/' + name; assert(Object.hasOwn(PINS, relative)); return require(path.join(desktop, name)); };
const { createSalesOrders } = api('sales-orders.cjs');
const ACTOR = 'a1000000-0000-4000-8000-000000000001', CUSTOMER = 'a2000000-0000-4000-8000-000000000001', STAMP = '2030-01-01T00:00:00.000Z';
console.log(JSON.stringify({ purpose: 'strict170-number-retention-and-restore-commit-truth', actualContext, testSha256: selfPin, sourcePins: PINS, methods: 3, productionDataUsed: false, nativeGuiVerified: false }));

function fixture(t) {
  const base = path.join(ROOT, 'runtime', 'strict170-restore-tests'); fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, 'owned-')), layout = {};
  for (const [field, name] of Object.entries({ dataDir: 'sales', ledgerDir: 'ledger', inventoryDir: 'inventory', profileDir: 'profile', configDir: 'config', runtimeDir: 'runtime', logDir: 'logs', backupDir: 'backups', documentsDir: 'documents', quoteImagesDir: 'quote-images' })) { layout[field] = path.join(root, name); fs.mkdirSync(layout[field]); }
  let sales = new DatabaseSync(path.join(layout.dataDir, 'jewelry.sqlite'));
  sales.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');
  for (const relative of Object.keys(PINS).filter(name => name.startsWith('project/desktop/migrations/')).sort()) sales.exec(read(relative).toString('utf8'));
  const local = /sqlite\.exec\(`(CREATE TABLE IF NOT EXISTS local_accounts[\s\S]*?)`\);/.exec(read('project/desktop/runtime.cjs').toString('utf8')); assert(local && !local[1].includes('${'), 'Exact known account schema'); sales.exec(local[1]);
  sales.prepare('INSERT INTO staff_users(id,user_id,email,name,role,active,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?)').run(ACTOR, null, 'strict170@example.invalid', '严格审查虚构管理员', 'admin', STAMP, STAMP);
  sales.prepare('INSERT INTO local_accounts VALUES(?,?,?,?,?,?)').run(ACTOR, 'strict170', '01'.repeat(16), 'ab'.repeat(64), STAMP, STAMP);
  sales.prepare('INSERT INTO module_permissions VALUES(?,?,?,?,?,?)').run(ACTOR, 'manage', 'disabled', 'disabled', 1, STAMP);
  sales.prepare('INSERT INTO staff_capabilities VALUES(?,?,?)').run(ACTOR, '{}', STAMP);
  sales.prepare('INSERT INTO customers(id,name,phone,notes,owner_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(CUSTOMER, '严格审查虚构客户', '00000000000', '', ACTOR, STAMP, STAMP);
  sales.exec("CREATE TABLE strict170_proof(value TEXT);INSERT INTO strict170_proof VALUES('archive-before');");
  for (const [field, filename] of [['ledgerDir', 'ledger.db'], ['inventoryDir', 'stockcheck.db']]) { const db = new DatabaseSync(path.join(layout[field], filename)); db.exec("CREATE TABLE strict170_proof(value TEXT);INSERT INTO strict170_proof VALUES('archive-before');"); db.close(); }
  t.after(() => { try { sales.close(); } catch { /* Already closed at a failed lifecycle boundary. */ } });
  const context = api('business-maintenance-layout.cjs').createBusinessMaintenanceContext({ root, layout, hostId: 'strict170-host-synthetic', profileId: 'strict170-profile', provisionOwner: true });
  const backups = api('business-backups.cjs').createBusinessBackups({ context, salesDatabase: () => sales, withFrozen: action => action() });
  const lifecycle = [];
  const restore = api('business-restore.cjs').createBusinessRestore({ context, backups, freeze: action => action(), prepare: action => action(), database: () => sales, stop: async () => { lifecycle.push('stop'); sales.close(); }, resume: async () => { lifecycle.push('resume'); sales = new DatabaseSync(path.join(layout.dataDir, 'jewelry.sqlite')); sales.exec('PRAGMA foreign_keys=ON'); }, invalidateSessions: async () => lifecycle.push('invalidate') });
  const actor = { id: ACTOR, name: '严格审查虚构管理员', role: 'admin', active: true };
  const administration = { requireAccess(user, module) { assert.equal(user.id, ACTOR); assert.equal(module, 'sales'); }, requireCapability() {}, requireAdmin(user) { assert.equal(user.role, 'admin'); } };
  function quote() {
    const id = crypto.randomUUID(), item = { id: 'strict-line', weight: 1, quantity: 1 }, line = { id: item.id, metal: 100, labor: 0, extras: 0, subtotal: 100, weight: 1, quantity: 1 }, calculation = { metal: 100, labor: 0, extras: 0, subtotal: 100, discount: 0, total: 100, itemTotals: [line] };
    const snapshot = { type: 'sale', customerId: CUSTOMER, saleItems: [item], calculation };
    sales.prepare('INSERT INTO quotes(id,number,type,customer_id,customer_name,owner_id,title,snapshot,totals,total_cents,root_id,base_quote_id,version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, 'STRICT-' + id, 'sale', CUSTOMER, '严格审查虚构客户', ACTOR, '严格审查虚构来源', JSON.stringify(snapshot), JSON.stringify(calculation), 10000, id, null, 1, STAMP);
    return id;
  }
  function issue(quoteId) { return createSalesOrders({ runtime: { sqlite: sales }, administration, clock: () => Date.parse(STAMP) }).handle(actor, { path: '/api/sales-orders', method: 'POST', body: { quoteId, requestId: crypto.randomUUID(), businessDate: '2030-01-01' } }).data.order; }
  return { root, layout, backups, restore, lifecycle, quote, issue, get db() { return sales; }, journal: () => JSON.parse(fs.readFileSync(path.join(layout.runtimeDir, 'restore-transaction.json'), 'utf8')) };
}

test('H00 real accepted sources issue increasing numbers and ordinary restore commits truthfully', { concurrency: false }, async t => {
  const f = fixture(t), first = f.issue(f.quote()), second = f.issue(f.quote());
  assert.equal(first.number, 'SO20300101-000001'); assert.equal(second.number, 'SO20300101-000002');
  const saved = await f.backups.create(); f.db.exec("UPDATE strict170_proof SET value='live-after'");
  const reply = await f.restore.restore(saved.file, 'sales'); assert.equal(reply.ok, true); assert.equal(f.journal().state, 'COMMITTED');
  assert.equal(f.db.prepare('SELECT value FROM strict170_proof').get().value, 'archive-before');
  assert.deepEqual(f.lifecycle, ['stop', 'invalidate', 'resume']);
});

test('R01 restoring an older sales archive must not reuse an already issued SO number for a different order', { concurrency: false }, async t => {
  const f = fixture(t), q1 = f.quote(), q2 = f.quote(), saved = await f.backups.create();
  const issuedBeforeRestore = f.issue(q1); assert.equal(issuedBeforeRestore.number, 'SO20300101-000001');
  await f.restore.restore(saved.file, 'sales');
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM sales_orders').get().n, 0, 'Explicit business rollback is the intended fixture, not a fake delete');
  const issuedAfterRestore = f.issue(q2); assert.notEqual(issuedAfterRestore.id, issuedBeforeRestore.id); assert.notEqual(issuedAfterRestore.sourceQuoteId, issuedBeforeRestore.sourceQuoteId);
  assert.notEqual(issuedAfterRestore.number, issuedBeforeRestore.number, 'A number already handed to a customer must remain reserved outside restored business state');
});

test('R02 an operations-log failure after durable COMMITTED must not report restore failure or enter rollback again', { concurrency: false }, async t => {
  const f = fixture(t), saved = await f.backups.create(); f.db.exec("UPDATE strict170_proof SET value='live-after'");
  // A real ordinary directory at this one owned log filename deterministically
  // makes appendFileSync fail. No fs/SQLite/product implementation is mocked.
  fs.mkdirSync(path.join(f.layout.logDir, 'restore-operations.jsonl'));
  let reply = null, rejection = null; try { reply = await f.restore.restore(saved.file, 'sales'); } catch (error) { rejection = error; }
  assert.equal(f.journal().state, 'COMMITTED', 'This negative case must reach the actual durable commit');
  assert.equal(f.db.prepare('SELECT value FROM strict170_proof').get().value, 'archive-before', 'Actual publication already happened');
  assert.equal(rejection, null, 'Committed restore was misreported as failed because a diagnostic append failed');
  assert.equal(reply?.ok, true); assert.deepEqual(f.lifecycle, ['stop', 'invalidate', 'resume'], 'Postcommit diagnostics must not stop and restart restored business again');
});

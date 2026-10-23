'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { DatabaseSync } = require('node:sqlite');
const { AsyncLocalStorage } = require('node:async_hooks');
const { scryptSync, generateKeyPairSync, sign, createHash } = require('node:crypto');
const { createUpdateDistribution } = require('../project/desktop/update-distribution.cjs');
const FILE = path.resolve(__dirname, '../project/desktop/backend.cjs'), actualRequire = createRequire(FILE), moduleValue = { exports: {} };
vm.runInNewContext(fs.readFileSync(FILE, 'utf8'), { module: moduleValue, exports: moduleValue.exports, require: name => name === './runtime.cjs' ? { createRuntime: () => { throw new Error('NO_FILE_DATABASE_ALLOWED'); } } : actualRequire(name), __dirname: path.dirname(FILE), Buffer, URL, URLSearchParams, Request, Response, setTimeout, clearTimeout, setImmediate, console }, { filename: FILE });
const { createBackend } = moduleValue.exports;
const BASE = path.resolve(__dirname, '../runtime/update-distribution-backend-tests'), PWD = 'OnlySynthetic-2026!', SALT = 'fixture-salt', HASH = scryptSync(PWD, SALT, 64).toString('hex');
const IDS = { admin: '10000000-0000-4000-8000-000000000001', employee: '10000000-0000-4000-8000-000000000002' };
async function fixture(t, updates) {
  fs.mkdirSync(BASE, { recursive: true }); const directory = fs.mkdtempSync(path.join(BASE, 'run-')); assert.equal(path.dirname(directory), BASE);
  const db = new DatabaseSync(':memory:');
  const migrations = path.resolve(__dirname, '../project/desktop/migrations'); for (const name of fs.readdirSync(migrations).filter(name => /^\d+_[\w-]+\.sql$/.test(name)).sort()) db.exec(fs.readFileSync(path.join(migrations, name), 'utf8'));
  db.exec('CREATE TABLE local_accounts(staff_id TEXT PRIMARY KEY,username TEXT UNIQUE,password_salt TEXT,password_hash TEXT,created_at TEXT,updated_at TEXT)');
  for (const [name, id] of Object.entries(IDS)) { db.prepare('INSERT INTO staff_users VALUES(?,?,?,?,?,?,?,?)').run(id, 'local-' + id, name, name, name === 'admin' ? 'admin' : 'employee', 1, '2026-10-14', '2026-10-14'); db.prepare('INSERT INTO local_accounts VALUES(?,?,?,?,?,?)').run(id, name, SALT, HASH, '2026-10-14', '2026-10-14'); db.prepare('INSERT INTO module_permissions VALUES(?,?,?,?,?,?)').run(id, 'disabled', 'view', 'disabled', 1, '2026-10-14'); }
  const context = new AsyncLocalStorage(); let isClosed = false;
  const runtime = { sqlite: db, dataDir: directory, withIdentity: (identity, action) => context.run(identity, action), getIdentity: () => context.getStore(), close: () => { if (!isClosed) { isClosed = true; db.close(); } } };
  const backend = createBackend({ runtimeFactory: () => runtime, businessCore: {}, dataDir: directory, migrationDir: migrations, updateServices: updates, pollsAdapter: {}, aiAdapter: {} }); t.after(() => backend.close());
  const sessions = new Map(); for (const name of Object.keys(IDS)) { const session = backend.createSession(); assert.equal((await session.dispatch({ path: '/auth/login', method: 'POST', body: { username: name, password: PWD } })).status, 200); sessions.set(name, session); }
  return { backend, sessions, db, request: (name, input) => sessions.get(name).dispatch(input) };
}

test('authenticated module-only employee reads unpublished catalog without requiring sales', async t => {
  const f = await fixture(t);
  const result = await f.request('employee', { path: '/api/employee-updates/catalog' }); assert.equal(result.status, 200); assert.equal(result.data.available, false);
  assert.equal((await f.backend.createSession().dispatch({ path: '/api/employee-updates/catalog' })).status, 401);
});

function publication() {
  const catalogFile = path.resolve('X:/owned-publisher/catalog.json'), archiveFile = path.resolve('X:/owned-publisher/program.zip'), archive = Buffer.from('PK-OWNED-SYNTHETIC-PROGRAM-ARCHIVE'), keys = generateKeyPairSync('ed25519'), now = Date.UTC(2026, 9, 14);
  const sha256 = createHash('sha256').update(archive).digest('hex'), catalog = { schemaVersion: 1, app: 'xjy-jewelry-offline', channel: 'stable', version: '1.6.0', sourceVersions: ['1.5.0', '1.5.1', '1.6.0'], platform: 'win32', arch: 'x64', sequence: 5, publishedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 86400000).toISOString(), archive: { size: archive.length, sha256 }, files: [{ path: 'resources/app.asar', size: 3, sha256: 'a'.repeat(64) }] };
  const raw = JSON.stringify(catalog), envelope = { catalog: raw, signature: sign(null, Buffer.from(raw), keys.privateKey).toString('base64') }, data = new Map([[catalogFile, Buffer.from(JSON.stringify(envelope))], [archiveFile, archive]]); let hook, closed = 0;
  const stats = name => ({ dev: 1n, ino: name === catalogFile ? 1n : 2n, nlink: 1n, size: BigInt(data.get(name).length), mtimeNs: 1n, ctimeNs: 1n, isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false });
  const fileSystem = { async lstat(name) { return data.has(name) ? stats(name) : { isDirectory: () => true, isSymbolicLink: () => false }; }, async realpath(name) { return name; }, async open(name) { const bytes = data.get(name); assert(bytes, 'only registered virtual publication files may open'); return { async stat() { return stats(name); }, async read(buffer, offset, length, position) { if (hook) await hook(name); const part = bytes.subarray(position, position + length); part.copy(buffer, offset); return { bytesRead: part.length, buffer }; }, async close() { closed++; } }; } };
  return { distribution: createUpdateDistribution({ catalogFile, archiveFile, allowedFiles: ['resources/app.asar'], trustedPublicKey: keys.publicKey, fileSystem, now: () => now }), envelope, archive, archiveFile, setHook: value => { hook = value; }, chunkPath: '/api/employee-updates/chunk?sequence=5&sha256=' + sha256 + '&offset=0&length=' + archive.length, closed: () => closed };
}

test('actual authenticated session fetches verified fixed catalog and byte chunks', async t => {
  const p = publication(), f = await fixture(t, p.distribution);
  const catalog = await f.request('employee', { path: '/api/employee-updates/catalog' }); assert.equal(catalog.status, 200); assert.equal(catalog.data.catalog, p.envelope.catalog);
  const chunk = await f.request('employee', { path: p.chunkPath }); assert.equal(chunk.status, 200); assert.equal(chunk.data.sequence, 5); assert.equal(Buffer.from(chunk.data.bodyBase64, 'base64').toString(), 'PK-OWNED-SYNTHETIC-PROGRAM-ARCHIVE');
  assert(!JSON.stringify(chunk).includes('X:')); assert(!JSON.stringify(chunk).includes('credential'));
  for (const input of [{ path: p.chunkPath + '&path=F:/business/customer.db' }, { path: p.chunkPath, body: { actor: { role: 'admin' } } }, { path: '/api/employee-updates/chunk?sequence=5&sha256=' + 'a'.repeat(64) + '&offset=0&length=4194305' }]) assert.equal((await f.request('employee', input)).status, input.path.includes('4194305') ? 413 : 400);
});

test('credential reset during file I/O rejects the response without recursively waiting for the SQL queue', async t => {
  const p = publication(), f = await fixture(t, p.distribution); await f.request('employee', { path: '/api/employee-updates/catalog' }); let changed = false;
  p.setHook(async name => { if (name === p.archiveFile && !changed) { changed = true; assert.equal((await f.request('admin', { path: '/api/users', method: 'PATCH', body: { id: IDS.employee, password: 'Reset-Synthetic-2026!' } })).status, 200); } });
  const result = await f.request('employee', { path: p.chunkPath }); assert.equal(result.status, 401); assert.equal(result.data.bodyBase64, undefined);
});

test('logout and a new login to the same account cannot inherit an in-flight chunk response', async t => {
  const p = publication(), f = await fixture(t, p.distribution); await f.request('employee', { path: '/api/employee-updates/catalog' }); let changed = false;
  p.setHook(async name => { if (name === p.archiveFile && !changed) { changed = true; await f.request('employee', { path: '/auth/logout', method: 'POST' }); assert.equal((await f.request('employee', { path: '/auth/login', method: 'POST', body: { username: 'employee', password: PWD } })).status, 200); } });
  const result = await f.request('employee', { path: p.chunkPath }); assert.equal(result.status, 401); assert.equal(result.data.bodyBase64, undefined);
});

test('inactive or closed sessions never receive a catalog or a program chunk', async t => {
  const p = publication(), f = await fixture(t, p.distribution);
  assert.equal((await f.request('admin', { path: '/api/users', method: 'PATCH', body: { id: IDS.employee, active: false } })).status, 200);
  assert.equal((await f.request('employee', { path: '/api/employee-updates/catalog' })).status, 401);
  await f.sessions.get('admin').close(); assert.equal((await f.request('admin', { path: p.chunkPath })).status, 401);
});

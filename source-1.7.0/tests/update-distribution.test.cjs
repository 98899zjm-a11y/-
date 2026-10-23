'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const file = path.resolve(__dirname, '../project/desktop/update-distribution.cjs');
const { createUpdateDistribution } = fs.existsSync(file) ? require(file) : {};
const NOW = Date.UTC(2026, 9, 14);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function fakeFiles(initial) {
  const files = new Map(Object.entries(initial).map(([name, bytes], index) => [path.resolve(name), { bytes: Buffer.from(bytes), ino: BigInt(index + 1), stamp: 1n }]));
  const directories = new Set(); for (const name of files.keys()) { let parent = path.dirname(name); for (;;) { directories.add(parent); const next = path.dirname(parent); if (next === parent) break; parent = next; } }
  const calls = { opened: 0, read: 0, closed: 0 }; let readHook;
  const stats = value => ({ dev: 1n, ino: value.ino, size: BigInt(value.bytes.length), nlink: 1n, mtimeNs: value.stamp, ctimeNs: value.stamp, isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false });
  const get = name => { const value = files.get(path.resolve(name)); if (!value) { const error = new Error('fake missing'); error.code = 'ENOENT'; throw error; } return value; };
  const fileSystem = {
    async lstat(name) { const resolved = path.resolve(name), value = files.get(resolved); if (value) return stats(value); if (directories.has(resolved)) return { isDirectory: () => true, isSymbolicLink: () => false }; const error = new Error('fake missing'); error.code = 'ENOENT'; throw error; },
    async realpath(name) { return path.resolve(name); },
    async open(name) { const value = get(name); calls.opened++; let closed = false; return { async stat() { return stats(value); }, async read(buffer, offset, length, position) { assert.equal(closed, false); calls.read++; readHook?.(name, position); const bytes = value.bytes.subarray(position, position + length); bytes.copy(buffer, offset); return { bytesRead: bytes.length, buffer }; }, async close() { if (!closed) { closed = true; calls.closed++; } } }; },
  };
  return { fileSystem, calls, files, setReadHook: value => { readHook = value; }, replace(name, bytes, preserveStamp = false) { const value = get(name); value.bytes = Buffer.from(bytes); if (!preserveStamp) value.stamp++; } };
}
function fixture(options = {}) {
  const keys = crypto.generateKeyPairSync('ed25519'), archive = options.archive || Buffer.from('PK-FICTIONAL-OWNED-PROGRAM-ARCHIVE'), catalogFile = 'X:/owned-publication/catalog.json', archiveFile = 'X:/owned-publication/program.zip';
  const catalog = { schemaVersion: 1, app: 'xjy-jewelry-offline', channel: 'stable', version: '1.6.0', sourceVersions: ['1.5.0', '1.5.1', '1.6.0'], platform: 'win32', arch: 'x64', sequence: 3, publishedAt: new Date(NOW - 60000).toISOString(), expiresAt: new Date(NOW + 86400000).toISOString(), archive: { size: archive.length, sha256: hash(archive) }, files: [{ path: 'resources/app.asar', size: 10, sha256: 'a'.repeat(64) }], ...options.catalog };
  let envelope; const sign = () => { const raw = JSON.stringify(catalog); return { catalog: raw, signature: crypto.sign(null, Buffer.from(raw), keys.privateKey).toString('base64') }; };
  envelope = sign(); const fake = fakeFiles({ [catalogFile]: JSON.stringify(envelope), [archiveFile]: archive });
  const distribution = createUpdateDistribution({ catalogFile, archiveFile, trustedPublicKey: keys.publicKey, allowedFiles: ['resources/app.asar'], platform: 'win32', arch: 'x64', fileSystem: fake.fileSystem, now: options.now || (() => NOW), minimumSequence: options.minimumSequence || 0 });
  return { distribution, fake, catalog, envelope, archive, catalogFile, archiveFile, sign, chunk: (extras = {}) => ({ sequence: catalog.sequence, sha256: catalog.archive.sha256, offset: 0, length: archive.length, ...extras }) };
}

test('published catalog and program chunks are bound to a real publisher signature and archive digest', async () => {
  assert.equal(typeof createUpdateDistribution, 'function');
  const f = fixture();
  const result = await f.distribution.getCatalog(); assert.equal(result.available, true); assert.equal(result.catalog, f.envelope.catalog); assert.equal(result.signature, f.envelope.signature);
  const chunk = await f.distribution.getChunk(f.chunk()); assert.equal(chunk.sequence, 3); assert.equal(chunk.archiveSha256, f.catalog.archive.sha256); assert.equal(chunk.offset, 0); assert.equal(chunk.length, f.archive.length); assert.equal(Buffer.from(chunk.bodyBase64, 'base64').toString(), 'PK-FICTIONAL-OWNED-PROGRAM-ARCHIVE');
  await f.distribution.close(); assert.equal(f.fake.calls.opened, f.fake.calls.closed);
});

test('unpublished files produce an explicit unavailable result without inventing a signed catalog', async () => {
  const f = fixture(); f.fake.files.delete(path.resolve(f.catalogFile));
  assert.deepEqual(await f.distribution.getCatalog(), { available: false, reason: '主机尚未发布员工更新包，请继续使用当前程序' });
  await assert.rejects(f.distribution.getChunk(f.chunk()), error => error.status === 503); await f.distribution.close();
});

test('invalid, expired and unapproved catalogs are rejected before exposing program bytes', async () => {
  for (const change of [{ signature: Buffer.alloc(64).toString('base64') }, { catalog: { expiresAt: new Date(NOW - 1).toISOString() } }, { catalog: { files: [{ path: 'data/customer.sqlite', size: 10, sha256: 'a'.repeat(64) }] } }]) {
    const f = fixture(change.catalog ? { catalog: change.catalog } : {}); if (change.signature) f.fake.replace(f.catalogFile, JSON.stringify({ ...f.envelope, signature: change.signature }));
    await assert.rejects(f.distribution.getCatalog(), error => error.status === 503); assert.equal(f.fake.calls.opened, 1); await f.distribution.close();
  }
});

test('chunks reject arbitrary paths, stale release bindings and byte ranges over four MiB', async () => {
  const f = fixture({ archive: Buffer.alloc(4 * 1024 * 1024 + 10, 65) });
  for (const input of [f.chunk({ path: 'C:/business/data.db', length: 10 }), f.chunk({ url: 'https://unknown', length: 10 }), f.chunk({ actor: { role: 'admin' }, length: 10 }), f.chunk({ offset: -1, length: 10 })]) await assert.rejects(f.distribution.getChunk(input), error => error.status === 400);
  await assert.rejects(f.distribution.getChunk(f.chunk({ length: 4194305 })), error => error.status === 413);
  await assert.rejects(f.distribution.getChunk(f.chunk({ sequence: 2, length: 10 })), error => error.status === 409);
  await assert.rejects(f.distribution.getChunk(f.chunk({ sha256: 'a'.repeat(64), length: 10 })), error => error.status === 409);
  const bytes = await f.distribution.getChunk(f.chunk({ offset: 4194300, length: 10 })); assert.equal(bytes.length, 10); assert.equal(Buffer.from(bytes.bodyBase64, 'base64').toString(), 'AAAAAAAAAA'); await f.distribution.close();
});

test('unchanged filesystem timestamps cannot hide changed published archive bytes', async () => {
  const f = fixture(); await f.distribution.getCatalog();
  f.fake.replace(f.archiveFile, Buffer.alloc(f.archive.length, 88), true);
  await assert.rejects(f.distribution.getChunk(f.chunk()), error => error.status === 409); await f.distribution.close(); assert.equal(f.fake.calls.opened, f.fake.calls.closed);
});

test('catalog expiration during an asynchronous chunk read stops the response', async () => {
  let current = NOW; const f = fixture({ now: () => current }); await f.distribution.getCatalog();
  f.fake.setReadHook(name => { if (path.resolve(name) === path.resolve(f.archiveFile)) current = NOW + 86400001; });
  await assert.rejects(f.distribution.getChunk(f.chunk()), error => error.status === 503); await f.distribution.close();
});

test('archive digest mismatch, hard links and stale publisher sequences are never downloadable', async () => {
  const mismatch = fixture({ catalog: { archive: { size: 34, sha256: 'a'.repeat(64) } } });
  await assert.rejects(mismatch.distribution.getCatalog(), error => error.status === 503); await mismatch.distribution.close();
  const stale = fixture({ minimumSequence: 4 }); await assert.rejects(stale.distribution.getCatalog(), error => error.status === 409); await stale.distribution.close();
  const linked = fixture(), original = linked.fake.fileSystem.lstat;
  linked.fake.fileSystem.lstat = async (name, options) => { const value = await original(name, options); return path.resolve(name) === path.resolve(linked.archiveFile) ? { ...value, nlink: 2n } : value; };
  await assert.rejects(linked.distribution.getCatalog(), error => error.status === 503); await linked.distribution.close();
});

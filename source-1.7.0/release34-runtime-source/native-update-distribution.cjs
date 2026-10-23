'use strict';
// Complete native packages have their own signed descriptor and limits. They
// never enter the legacy resources-only file allowlist or installation path.
const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const { verifyNativeManifest } = require('./native-update-manifest.cjs');
const CHUNK = 4194304, MAX_DESCRIPTOR = 2097152, MAX_ARCHIVE = 1610612736;
const SHA = /^[a-f0-9]{64}$/;
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const statKey = s => ['dev', 'ino', 'size', 'nlink', 'mtimeNs', 'ctimeNs'].map(k => String(s[k])).join(':');
function fail(status, code, message) { throw Object.assign(Error(message), { status, code }); }

function createNativeUpdateDistribution({ manifestFile, archiveFile, trustedPublicKey, minimumSequence = 0, fileSystem = fs, now = Date.now }) {
  if (![manifestFile, archiveFile].every(p => typeof p === 'string' && path.isAbsolute(p)) ||
      !Number.isSafeInteger(minimumSequence) || minimumSequence < 0 || typeof now !== 'function' ||
      ['lstat', 'realpath', 'open'].some(k => typeof fileSystem[k] !== 'function')) throw new TypeError('Fixed native publication files and clock are required');
  const manifestPath = path.resolve(manifestFile), archivePath = path.resolve(archiveFile);
  const publicKey = trustedPublicKey?.type === 'public' ? trustedPublicKey : crypto.createPublicKey(trustedPublicKey);
  if (publicKey.asymmetricKeyType !== 'ed25519') throw new TypeError('Ed25519 publisher key required');
  let selected = null, closed = false, highWater = minimumSequence, seenManifest = null, serial = Promise.resolve();
  const enqueue = action => { const result = serial.then(action); serial = result.catch(() => {}); return result; };

  async function assertFile(file, maximum) {
    for (let parent = path.dirname(file);; parent = path.dirname(parent)) {
      const s = await fileSystem.lstat(parent, { bigint: true });
      if (!s.isDirectory() || s.isSymbolicLink() || path.resolve(await fileSystem.realpath(parent)).toLowerCase() !== parent.toLowerCase())
        fail(503, 'UNSAFE_NATIVE_PUBLICATION', '完整更新发布目录不是普通目录');
      if (parent === path.dirname(parent)) break;
    }
    const s = await fileSystem.lstat(file, { bigint: true });
    if (!s.isFile() || s.isSymbolicLink() || BigInt(s.nlink) !== 1n || BigInt(s.size) > BigInt(maximum) ||
        path.resolve(await fileSystem.realpath(file)).toLowerCase() !== file.toLowerCase())
      fail(503, 'UNSAFE_NATIVE_PUBLICATION', '完整更新发布文件不符合安全要求');
    return s;
  }
  async function open(file, maximum) {
    const prior = await assertFile(file, maximum), handle = await fileSystem.open(file, 'r');
    try {
      if (statKey(prior) !== statKey(await handle.stat({ bigint: true }))) fail(409, 'NATIVE_PUBLICATION_CHANGED', '完整更新文件在打开时改变');
      return { handle, snapshot: statKey(prior), size: Number(prior.size) };
    } catch (error) { await handle.close(); throw error; }
  }
  async function read(handle, offset, length) {
    const b = Buffer.alloc(length); let done = 0;
    while (done < length) {
      const r = await handle.read(b, done, length - done, offset + done);
      if (!r?.bytesRead) fail(503, 'NATIVE_PUBLICATION_TRUNCATED', '完整更新文件读取不完整');
      done += r.bytesRead;
    }
    return b;
  }
  async function closeSelected() { const old = selected; selected = null; if (old) await old.archive.handle.close(); }
  function validate(envelope) { return verifyNativeManifest(envelope, { publicKey, now, minimumSequence: highWater }); }
  async function unchanged(archive) {
    if (archive.snapshot !== statKey(await archive.handle.stat({ bigint: true })) ||
        archive.snapshot !== statKey(await assertFile(archivePath, MAX_ARCHIVE)))
      fail(409, 'NATIVE_PUBLICATION_CHANGED', '完整更新包已改变，请重新检查更新');
  }
  async function load() {
    if (closed) fail(503, 'NATIVE_DISTRIBUTION_CLOSED', '完整更新分发已关闭');
    let current;
    try { current = await assertFile(manifestPath, MAX_DESCRIPTOR); }
    catch (error) { if (error.code === 'ENOENT') { await closeSelected(); return null; } throw error; }
    if (selected && selected.manifestSnapshot === statKey(current)) {
      try { validate(selected.envelope); await unchanged(selected.archive); return selected; }
      catch (error) { await closeSelected(); throw error; }
    }
    await closeSelected();
    const descriptor = await open(manifestPath, MAX_DESCRIPTOR); let envelope;
    try {
      envelope = JSON.parse((await read(descriptor.handle, 0, descriptor.size)).toString('utf8'));
      if (descriptor.snapshot !== statKey(await descriptor.handle.stat({ bigint: true })) ||
          descriptor.snapshot !== statKey(await assertFile(manifestPath, MAX_DESCRIPTOR)))
        fail(409, 'NATIVE_PUBLICATION_CHANGED', '完整更新清单在读取时改变');
    } finally { await descriptor.handle.close(); }
    const manifest = validate(envelope), manifestSha = digest(Buffer.from(envelope.manifest, 'utf8'));
    if (manifest.sequence === highWater && seenManifest && manifestSha !== seenManifest)
      fail(409, 'NATIVE_SEQUENCE_REUSED', '同一更新序号的内容已被替换');
    let archive;
    try { archive = await open(archivePath, MAX_ARCHIVE); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    try {
      if (archive.size !== manifest.archive.size) fail(503, 'NATIVE_ARCHIVE_MISMATCH', '完整更新包大小与签名不符');
      const blocks = [], hash = crypto.createHash('sha256');
      for (let offset = 0; offset < archive.size; offset += CHUNK) {
        const b = await read(archive.handle, offset, Math.min(CHUNK, archive.size - offset));
        hash.update(b); blocks.push(digest(b));
      }
      if (hash.digest('hex') !== manifest.archive.sha256) fail(503, 'NATIVE_ARCHIVE_MISMATCH', '完整更新包摘要与签名不符');
      await unchanged(archive);
      if (descriptor.snapshot !== statKey(await assertFile(manifestPath, MAX_DESCRIPTOR)))
        fail(409, 'NATIVE_PUBLICATION_CHANGED', '完整更新清单在准备时改变');
      validate(envelope);
      highWater = manifest.sequence; seenManifest = manifestSha;
      selected = { envelope: Object.freeze(envelope), manifest, manifestSnapshot: descriptor.snapshot, archive, blocks };
      return selected;
    } catch (error) { await archive.handle.close(); throw error; }
  }
  function getNativeManifest() { return enqueue(async () => {
    const value = await load();
    return value ? { available: true, manifest: value.envelope.manifest, signature: value.envelope.signature } : { available: false };
  }); }
  function getNativeChunk(input) { return enqueue(async () => {
    const keys = ['sequence', 'sha256', 'offset', 'length'];
    if (!input || ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
        Reflect.ownKeys(input).length !== keys.length || Reflect.ownKeys(input).some(k => typeof k !== 'string' || !keys.includes(k) || !Object.hasOwn(Object.getOwnPropertyDescriptor(input, k), 'value')) ||
        !Number.isSafeInteger(input.sequence) || input.sequence < 1 || !SHA.test(input.sha256 || '') ||
        !Number.isSafeInteger(input.offset) || input.offset < 0 || !Number.isInteger(input.length) || input.length < 1)
      fail(400, 'BAD_NATIVE_CHUNK', '完整更新分块参数无效');
    if (input.length > CHUNK) fail(413, 'BAD_NATIVE_CHUNK', '完整更新分块不能超过4MiB');
    const value = await load();
    if (!value) fail(503, 'NO_NATIVE_PUBLICATION', '主机尚未发布完整更新包');
    if (input.sequence !== value.manifest.sequence || input.sha256 !== value.manifest.archive.sha256)
      fail(409, 'NATIVE_PUBLICATION_CHANGED', '完整更新发布已改变');
    if (input.offset >= value.archive.size || input.length > value.archive.size - input.offset)
      fail(416, 'BAD_NATIVE_CHUNK', '完整更新分块越过包边界');
    const blocks = [], first = Math.floor(input.offset / CHUNK), last = Math.floor((input.offset + input.length - 1) / CHUNK);
    try {
      for (let i = first; i <= last; i++) {
        const b = await read(value.archive.handle, i * CHUNK, Math.min(CHUNK, value.archive.size - i * CHUNK));
        if (digest(b) !== value.blocks[i]) fail(409, 'NATIVE_PUBLICATION_CHANGED', '完整更新包分块已改变');
        blocks.push(b);
      }
      await unchanged(value.archive); validate(value.envelope);
    } catch (error) { await closeSelected(); throw error; }
    const bytes = Buffer.concat(blocks).subarray(input.offset - first * CHUNK, input.offset - first * CHUNK + input.length);
    return { sequence: input.sequence, archiveSha256: input.sha256, offset: input.offset, length: bytes.length, bodyBase64: bytes.toString('base64') };
  }); }
  return { getNativeManifest, getNativeChunk, close: () => enqueue(async () => { closed = true; await closeSelected(); }) };
}
module.exports = { createNativeUpdateDistribution };

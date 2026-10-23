'use strict';

// This controller owns no filesystem, URL, process or renderer-supplied identity.
// Native main injects the pinned publisher key, a fixed cache and the installer.
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { Readable, Writable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { TextDecoder } = require('node:util');
const CHUNK = 4 * 1024 * 1024, MAX_ARCHIVE = 805306368, MAX_FILES = 4096;
const SHA = /^[a-f0-9]{64}$/, UTF8 = new TextDecoder('utf-8', { fatal: true });

class UpdateError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
function fail(code, message) { throw new UpdateError(code, message); }
function plain(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function exactKeys(value, keys) { return plain(value) && Object.keys(value).every(key => keys.includes(key)); }
function version(value, major) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) fail('BAD_MANIFEST', '更新版本格式不正确。');
  const parts = value.split('.').map(Number);
  if (parts.some(part => !Number.isSafeInteger(part)) || parts[0] !== major) fail('BAD_MANIFEST', '此更新不适用于当前软件版本。');
  return parts;
}
function compare(a, b) { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1; return 0; }
function pathIsSafe(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 240 && !/[\\:*?"<>|\x00-\x1f]/.test(value) && !value.startsWith('/') &&
    value.split('/').every(part => part && part !== '.' && part !== '..' && !/[. ]$/.test(part) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}
function freeze(value) { if (plain(value) || Array.isArray(value)) { Object.freeze(value); for (const child of Object.values(value)) freeze(child); } return value; }
function crcStep(crc, bytes) {
  for (const byte of bytes) { crc ^= byte; for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return crc >>> 0;
}

function createEmployeeUpdate(options) {
  if (!plain(options)) throw new TypeError('Trusted update dependencies are required.');
  const major = options.supportedMajor ?? 1, currentVersion = options.currentVersion;
  if (!Number.isSafeInteger(major) || major < 1) throw new TypeError('Invalid trusted major version.');
  const current = version(currentVersion, major), allowed = new Set(options.allowedFiles);
  if (!Array.isArray(options.allowedFiles) || allowed.size < 1 || allowed.size > MAX_FILES || allowed.size !== options.allowedFiles.length || new Set([...allowed].map(path => typeof path === 'string' ? path.toLowerCase() : path)).size !== allowed.size || [...allowed].some(path => !pathIsSafe(path))) throw new TypeError('An exact, safe native filename allowlist is required.');
  const key = options.trustedPublicKey?.type === 'public' ? options.trustedPublicKey : crypto.createPublicKey(options.trustedPublicKey);
  if (key.asymmetricKeyType !== 'ed25519') throw new TypeError('A pinned Ed25519 publisher public key is required.');
  for (const method of ['resolveActor', 'isEmployeeClient', 'fetchCatalog', 'fetchChunk', 'installer']) if (typeof options[method] !== 'function') throw new TypeError('Missing trusted dependency: ' + method);
  for (const method of ['begin', 'write', 'read', 'size', 'seal', 'remove', 'getAcceptedSequence', 'setAcceptedSequence']) if (typeof options.storage?.[method] !== 'function') throw new TypeError('Missing trusted storage method: ' + method);
  const clock = options.now || Date.now, storage = options.storage;
  let state = { phase: 'idle', currentVersion, message: '点击检查升级，软件会自动检查可用版本。' };
  let selected = null, staged = null, busy = false;
  const getState = () => ({ ...state });
  function setState(phase, message, extra = {}) { state = { phase, currentVersion, message, ...extra }; }
  async function authorize() {
    if (!await options.isEmployeeClient()) fail('EMPLOYEE_DEVICE_REQUIRED', '仅员工电脑可以在这里升级，主机请由管理员更新。');
    const actor = await options.resolveActor();
    if (!actor || actor.active !== true || actor.authenticated !== true || typeof actor.id !== 'string' || !actor.id) fail('LOGIN_REQUIRED', '请先使用有效的员工账号登录。');
    return actor;
  }
  async function getCapability() {
    try { await authorize(); return { supported: true, canInstall: true, currentVersion, message: '可一键升级本机员工程序。' }; }
    catch (error) { return { supported: true, canInstall: false, currentVersion, code: error.code || 'UNAVAILABLE', message: error instanceof UpdateError ? error.message : '更新入口暂不可用。' }; }
  }
  async function audit(event, actor, detail) { if (typeof options.audit === 'function') await options.audit({ event, actorId: actor.id, currentVersion, ...detail }); }
  function parseCatalog(envelope) {
    if (!exactKeys(envelope, ['catalog', 'signature']) || typeof envelope.catalog !== 'string' || Buffer.byteLength(envelope.catalog) > 1048576 || typeof envelope.signature !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature)) fail('BAD_SIGNATURE', '更新签名不正确，已停止升级。');
    const raw = Buffer.from(envelope.catalog, 'utf8'), signature = Buffer.from(envelope.signature, 'base64');
    if (signature.length !== 64 || !crypto.verify(null, raw, key, signature)) fail('BAD_SIGNATURE', '更新签名不正确，已停止升级。');
    let catalog; try { catalog = JSON.parse(envelope.catalog); } catch { fail('BAD_MANIFEST', '更新清单无法读取。'); }
    if (!exactKeys(catalog, ['schemaVersion', 'app', 'channel', 'version', 'sourceVersions', 'platform', 'arch', 'sequence', 'publishedAt', 'expiresAt', 'archive', 'files']) || catalog.schemaVersion !== 1 || catalog.app !== 'xjy-jewelry-offline' || catalog.channel !== 'stable' || catalog.platform !== options.platform || catalog.arch !== options.arch) fail('BAD_MANIFEST', '更新清单与本机软件不匹配。');
    const target = version(catalog.version, major);
    if (compare(target, current) < 0) fail('DOWNGRADE_REJECTED', '此更新版本较旧，已停止升级。');
    if (!Array.isArray(catalog.sourceVersions) || catalog.sourceVersions.length < 1 || catalog.sourceVersions.length > 128 || new Set(catalog.sourceVersions).size !== catalog.sourceVersions.length) fail('BAD_MANIFEST', '更新清单未声明支持的原版本。');
    catalog.sourceVersions.forEach(source => version(source, major));
    if (!catalog.sourceVersions.includes(currentVersion)) fail('SOURCE_UNSUPPORTED', '此更新尚未支持本机版本，请联系管理员。');
    if (!Number.isSafeInteger(catalog.sequence) || catalog.sequence < 1) fail('BAD_MANIFEST', '更新发布序号不正确。');
    const published = Date.parse(catalog.publishedAt), expires = Date.parse(catalog.expiresAt), now = clock();
    if (typeof catalog.publishedAt !== 'string' || typeof catalog.expiresAt !== 'string' || !Number.isFinite(published) || !Number.isFinite(expires) || published > now + 300000 || expires <= now || expires <= published) fail('EXPIRED_CATALOG', '更新清单已过期或发布时间不正确，请重新检查。');
    if (!exactKeys(catalog.archive, ['size', 'sha256']) || !Number.isSafeInteger(catalog.archive.size) || catalog.archive.size < 22 || catalog.archive.size > MAX_ARCHIVE || !SHA.test(catalog.archive.sha256)) fail('BAD_MANIFEST', '更新包大小或校验信息不正确。');
    if (!Array.isArray(catalog.files) || catalog.files.length < 1 || catalog.files.length > MAX_FILES) fail('BAD_MANIFEST', '更新文件清单不正确。');
    const paths = new Set(); let total = 0;
    for (const file of catalog.files) {
      if (!exactKeys(file, ['path', 'size', 'sha256']) || !pathIsSafe(file.path) || !allowed.has(file.path) || paths.has(file.path) || !Number.isSafeInteger(file.size) || file.size < 0 || file.size > MAX_ARCHIVE || !SHA.test(file.sha256)) fail('BAD_MANIFEST', '更新包包含未获批准的文件。');
      paths.add(file.path); total += file.size;
    }
    if (total > 1073741824) fail('BAD_MANIFEST', '更新文件总大小超出安全上限。');
    return freeze(catalog);
  }
  async function check(actor) {
    setState('checking', '正在检查管理员发布的更新…');
    const catalog = parseCatalog(await options.fetchCatalog());
    await authorize();
    const accepted = await storage.getAcceptedSequence();
    if (!Number.isSafeInteger(accepted) || accepted < 0 || catalog.sequence < accepted) fail('STALE_CATALOG', '更新清单已被较新的发布取代，请重新检查。');
    await storage.setAcceptedSequence(catalog.sequence);
    selected = catalog;
    if (catalog.version === currentVersion) { setState('latest', '已经是当前最新版本。', { targetVersion: catalog.version }); return false; }
    setState('available', '发现新版本，可点击一键升级。', { targetVersion: catalog.version, total: catalog.archive.size });
    await audit('employee-update.checked', actor, { targetVersion: catalog.version, sequence: catalog.sequence });
    return true;
  }
  async function read(stageId, offset, length) {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || length > CHUNK) fail('BAD_ARCHIVE', '更新缓存读取范围不正确。');
    const bytes = await storage.read(stageId, offset, length);
    if (!Buffer.isBuffer(bytes) || bytes.length !== length) fail('BAD_ARCHIVE', '更新缓存不完整，已停止升级。');
    return bytes;
  }
  async function verifyArchive(stageId, catalog) {
    if (await storage.size(stageId) !== catalog.archive.size) fail('BAD_ARCHIVE', '更新包大小不一致，已停止升级。');
    const digest = crypto.createHash('sha256');
    for (let offset = 0; offset < catalog.archive.size; offset += CHUNK) digest.update(await read(stageId, offset, Math.min(CHUNK, catalog.archive.size - offset)));
    if (digest.digest('hex') !== catalog.archive.sha256) fail('BAD_ARCHIVE', '更新包校验失败，原程序保持不变。');
    const tailSize = Math.min(65557, catalog.archive.size), tail = await read(stageId, catalog.archive.size - tailSize, tailSize);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50 && i + 22 + tail.readUInt16LE(i + 20) === tail.length) { eocd = i; break; }
    if (eocd < 0) fail('BAD_ARCHIVE', '更新包 ZIP 目录不完整。');
    const count = tail.readUInt16LE(eocd + 10), size = tail.readUInt32LE(eocd + 12), offset = tail.readUInt32LE(eocd + 16);
    if (tail.readUInt16LE(eocd + 4) !== 0 || tail.readUInt16LE(eocd + 6) !== 0 || tail.readUInt16LE(eocd + 8) !== count || count !== catalog.files.length || count > MAX_FILES || size > 2097152 || offset + size !== catalog.archive.size - tailSize + eocd) fail('BAD_ARCHIVE', '更新包 ZIP 目录不符合安全要求。');
    const directory = await read(stageId, offset, size), expected = new Map(catalog.files.map(file => [file.path, file])), seen = new Set(), ranges = [];
    let cursor = 0;
    for (let index = 0; index < count; index++) {
      if (cursor + 46 > directory.length || directory.readUInt32LE(cursor) !== 0x02014b50) fail('BAD_ARCHIVE', '更新包文件目录损坏。');
      const flags = directory.readUInt16LE(cursor + 8), method = directory.readUInt16LE(cursor + 10), crc = directory.readUInt32LE(cursor + 16);
      const compressedSize = directory.readUInt32LE(cursor + 20), fileSize = directory.readUInt32LE(cursor + 24), nameSize = directory.readUInt16LE(cursor + 28), extraSize = directory.readUInt16LE(cursor + 30), commentSize = directory.readUInt16LE(cursor + 32);
      const attributes = directory.readUInt32LE(cursor + 38), localOffset = directory.readUInt32LE(cursor + 42), end = cursor + 46 + nameSize + extraSize + commentSize;
      if (end > directory.length || extraSize !== 0 || (flags & ~0x808) !== 0 || ![0, 8].includes(method) || directory.readUInt16LE(cursor + 34) !== 0 || (attributes & 0x10) || ![0, 0x8000].includes((attributes >>> 16) & 0xf000)) fail('BAD_ARCHIVE', '更新包含加密、链接或不支持的文件。');
      let path; const name = directory.subarray(cursor + 46, cursor + 46 + nameSize);
      try { path = UTF8.decode(name); } catch { fail('BAD_ARCHIVE', '更新包文件名编码不正确。'); }
      const file = expected.get(path);
      if (!file || !pathIsSafe(path) || seen.has(path) || fileSize !== file.size || localOffset + 30 > offset) fail('BAD_ARCHIVE', '更新包文件与批准清单不一致。');
      const local = await read(stageId, localOffset, 30);
      const localNameSize = local.readUInt16LE(26), localExtra = local.readUInt16LE(28), dataOffset = localOffset + 30 + localNameSize + localExtra;
      if (local.readUInt32LE(0) !== 0x04034b50 || localExtra !== 0 || local.readUInt16LE(6) !== flags || local.readUInt16LE(8) !== method || dataOffset + compressedSize > offset || localNameSize !== nameSize || !(await read(stageId, localOffset + 30, localNameSize)).equals(name)) fail('BAD_ARCHIVE', '更新包本地文件目录不一致。');
      if (!(flags & 8) && (local.readUInt32LE(14) !== crc || local.readUInt32LE(18) !== compressedSize || local.readUInt32LE(22) !== fileSize)) fail('BAD_ARCHIVE', '更新包文件大小声明不一致。');
      if (ranges.some(([start, endRange]) => localOffset < endRange && dataOffset + compressedSize > start)) fail('BAD_ARCHIVE', '更新包文件范围重叠。');
      ranges.push([localOffset, dataOffset + compressedSize]); seen.add(path);
      let received = 0, checksum = 0xffffffff; const fileDigest = crypto.createHash('sha256');
      const sink = new Writable({ write(bytes, _encoding, done) { received += bytes.length; if (received > file.size) return done(new UpdateError('BAD_ARCHIVE', '更新文件解压大小超出清单。')); fileDigest.update(bytes); checksum = crcStep(checksum, bytes); done(); } });
      const input = Readable.from((async function* () { for (let position = 0; position < compressedSize; position += CHUNK) yield await read(stageId, dataOffset + position, Math.min(CHUNK, compressedSize - position)); })());
      try { if (method === 8) await pipeline(input, zlib.createInflateRaw(), sink); else await pipeline(input, sink); }
      catch (error) { if (error instanceof UpdateError) throw error; fail('BAD_ARCHIVE', '更新文件无法安全解压。'); }
      if (received !== file.size || fileDigest.digest('hex') !== file.sha256 || ((checksum ^ 0xffffffff) >>> 0) !== crc) fail('BAD_ARCHIVE', '更新文件逐项校验失败，已停止升级。');
      cursor = end;
    }
    if (cursor !== directory.length || seen.size !== expected.size) fail('BAD_ARCHIVE', '更新包包含额外目录内容。');
    return { archiveSha256: catalog.archive.sha256, sequence: catalog.sequence, version: catalog.version, fileCount: seen.size };
  }
  async function download(actor) {
    if (!selected && !await check(actor)) return;
    if (selected.version === currentVersion) return;
    if (Date.parse(selected.expiresAt) <= clock()) fail('EXPIRED_CATALOG', '更新清单已过期，请重新检查。');
    const catalog = selected, stageId = await storage.begin(catalog);
    if (typeof stageId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(stageId)) fail('BAD_STORAGE', '更新缓存标识不正确。');
    let received = 0;
    setState('downloading', '正在下载更新，原程序仍可保留。', { targetVersion: catalog.version, received, total: catalog.archive.size });
    try {
      while (received < catalog.archive.size) {
        await authorize();
        const length = Math.min(CHUNK, catalog.archive.size - received), bytes = await options.fetchChunk({ offset: received, length, catalog });
        if (!Buffer.isBuffer(bytes) || bytes.length !== length || bytes.length > CHUNK) fail('BAD_CHUNK', '更新下载数据不完整或超出限制。');
        await storage.write(stageId, received, bytes); received += bytes.length;
        setState('downloading', '正在下载更新…', { targetVersion: catalog.version, received, total: catalog.archive.size });
      }
      setState('verifying', '下载完成，正在检查签名和每个程序文件…', { targetVersion: catalog.version, received, total: catalog.archive.size });
      const proof = await verifyArchive(stageId, catalog); await authorize(); await storage.seal(stageId, proof);
      staged = { stageId, catalog };
      setState('ready', '更新包已校验，可安全退出员工程序后升级。', { targetVersion: catalog.version, received, total: catalog.archive.size });
      await audit('employee-update.downloaded', actor, proof);
    } catch (error) { try { await storage.remove(stageId); } catch {} throw error; }
  }
  async function run(input) {
    if (!exactKeys(input, ['intent']) || !['check', 'download', 'install'].includes(input.intent)) return { ok: false, code: 'INVALID_INTENT', error: '更新操作不正确。', state: getState() };
    if (busy) return { ok: false, code: 'BUSY', error: '升级操作正在进行，请稍候。', state: getState() };
    busy = true;
    try {
      const actor = await authorize();
      if (input.intent === 'check') await check(actor);
      else {
        if (!staged || staged.catalog !== selected) await download(actor);
        if (input.intent === 'install' && state.phase !== 'latest') {
          if (!staged || staged.catalog !== selected) fail('NOT_READY', '请先完成更新包校验。');
          if (Date.parse(staged.catalog.expiresAt) <= clock()) fail('EXPIRED_CATALOG', '更新清单已过期，请重新检查。');
          await authorize(); const proof = await verifyArchive(staged.stageId, staged.catalog); await authorize();
          if (staged.catalog.sequence < await storage.getAcceptedSequence()) fail('STALE_CATALOG', '更新包已被更新的发布取代。');
          setState('installing', '正在交给本机更新助手：退出员工程序、备份并更新…', { targetVersion: staged.catalog.version });
          await audit('employee-update.install-requested', actor, proof);
          const receipt = await options.installer(freeze({ stageId: staged.stageId, verifiedCatalog: staged.catalog, expectedVersion: currentVersion, employee: true, closeEmployeeApp: true, requiresBackup: true, stopHost: false }));
          if (!receipt || receipt.scheduled !== true) fail('INSTALL_NOT_SCHEDULED', '本机更新助手未接收任务，原程序保持不变。');
          setState('handoff', '升级已交给本机更新助手。它会备份原程序，成功后重新打开员工程序。', { targetVersion: staged.catalog.version });
        }
      }
      return { ok: true, state: getState() };
    } catch (error) {
      const code = error instanceof UpdateError ? error.code : 'UPDATE_FAILED', message = error instanceof UpdateError ? error.message : '更新未完成，原程序和已有下载缓存保持不变。请重试或联系管理员。';
      setState('error', message, { code }); return { ok: false, code, error: message, state: getState() };
    } finally { busy = false; }
  }
  return Object.freeze({ getCapability, getState, run });
}

module.exports = { createEmployeeUpdate };

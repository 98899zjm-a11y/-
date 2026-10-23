'use strict';
const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const CHUNK = 4 * 1024 * 1024, MAX_ARCHIVE = 805306368, SHA = /^[a-f0-9]{64}$/;
function fail(status, message, code = 'UPDATE_DISTRIBUTION_INVALID') { const error = new Error(message); error.status = status; error.code = code; throw error; }
function record(value, keys) { if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).some(key => typeof key !== 'string' || !keys.includes(key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))) fail(400, '员工更新参数含未允许的字段'); return value; }
function safePath(value) { return typeof value === 'string' && value.length > 0 && value.length <= 240 && !/[\\:*?"<>|\x00-\x1f]/.test(value) && !value.startsWith('/') && value.split('/').every(part => part && part !== '.' && part !== '..' && !/[. ]$/.test(part) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)); }
function semver(value) { if (typeof value !== 'string' || !/^1\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value) || value.split('.').some(part => !Number.isSafeInteger(Number(part)))) fail(503, '员工更新版本声明无效'); }
function statKey(value) { return ['dev', 'ino', 'size', 'nlink', 'mtimeNs', 'ctimeNs'].map(key => String(value[key])).join(':'); }
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
function createUpdateDistribution({ catalogFile, archiveFile, trustedPublicKey, allowedFiles, platform = 'win32', arch = 'x64', minimumSequence = 0, fileSystem = fs, now = Date.now }) {
  if (![catalogFile, archiveFile].every(value => typeof value === 'string' && path.isAbsolute(value)) || !Array.isArray(allowedFiles) || !allowedFiles.length || allowedFiles.length > 4096 || allowedFiles.some(value => !safePath(value)) || new Set(allowedFiles.map(value => value.toLowerCase())).size !== allowedFiles.length || !Number.isSafeInteger(minimumSequence) || minimumSequence < 0 || typeof now !== 'function' || ['lstat', 'realpath', 'open'].some(name => typeof fileSystem[name] !== 'function')) throw new TypeError('Fixed publication files, publisher trust and an exact program allowlist are required');
  const catalogPath = path.resolve(catalogFile), archivePath = path.resolve(archiveFile), allowed = new Set(allowedFiles), key = trustedPublicKey?.type === 'public' ? trustedPublicKey : crypto.createPublicKey(trustedPublicKey);
  if (key.asymmetricKeyType !== 'ed25519') throw new TypeError('Pinned Ed25519 public key required');
  let closed = false, selected = null, highWater = minimumSequence, serial = Promise.resolve();
  const enqueue = action => { const result = serial.then(action); serial = result.catch(() => {}); return result; };
  async function assertFile(filename, maximum) {
    let parent = path.dirname(filename);
    for (;;) { const stat = await fileSystem.lstat(parent, { bigint: true }); if (!stat.isDirectory() || stat.isSymbolicLink()) fail(503, '员工更新发布目录不允许重解析路径'); const next = path.dirname(parent); if (next === parent) break; parent = next; }
    const stat = await fileSystem.lstat(filename, { bigint: true });
    if (!stat.isFile() || stat.isSymbolicLink() || BigInt(stat.nlink) !== 1n || BigInt(stat.size) > BigInt(maximum) || path.resolve(await fileSystem.realpath(filename)).toLowerCase() !== filename.toLowerCase()) fail(503, '员工更新发布文件不是受信任的固定文件');
    return stat;
  }
  async function open(filename, maximum) { const prior = await assertFile(filename, maximum), handle = await fileSystem.open(filename, 'r'); try { if (statKey(prior) !== statKey(await handle.stat({ bigint: true }))) fail(409, '员工更新发布文件在打开时改变'); return { handle, snapshot: statKey(prior), size: Number(prior.size) }; } catch (error) { await handle.close(); throw error; } }
  async function read(handle, offset, length) { const bytes = Buffer.alloc(length); let received = 0; while (received < length) { const value = await handle.read(bytes, received, length - received, offset + received); if (!value?.bytesRead) fail(503, '员工更新发布文件不完整'); received += value.bytesRead; } return bytes; }
  function parse(envelope) {
    record(envelope, ['catalog', 'signature']);
    if (typeof envelope.catalog !== 'string' || Buffer.byteLength(envelope.catalog) > 1048576 || typeof envelope.signature !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature)) fail(503, '员工更新目录签名格式无效');
    const signature = Buffer.from(envelope.signature, 'base64');
    if (signature.length !== 64 || signature.toString('base64') !== envelope.signature || !crypto.verify(null, Buffer.from(envelope.catalog, 'utf8'), key, signature)) fail(503, '员工更新目录签名校验未通过');
    let catalog; try { catalog = JSON.parse(envelope.catalog); } catch { fail(503, '员工更新目录内容无效'); }
    record(catalog, ['schemaVersion', 'app', 'channel', 'version', 'sourceVersions', 'platform', 'arch', 'sequence', 'publishedAt', 'expiresAt', 'archive', 'files']);
    if (catalog.schemaVersion !== 1 || catalog.app !== 'xjy-jewelry-offline' || catalog.channel !== 'stable' || catalog.platform !== platform || catalog.arch !== arch || !Number.isSafeInteger(catalog.sequence) || catalog.sequence < 1) fail(503, '员工更新目录与程序身份不符');
    semver(catalog.version);
    if (!Array.isArray(catalog.sourceVersions) || !catalog.sourceVersions.length || catalog.sourceVersions.length > 128 || new Set(catalog.sourceVersions).size !== catalog.sourceVersions.length) fail(503, '员工更新原版本声明无效'); catalog.sourceVersions.forEach(semver);
    const published = Date.parse(catalog.publishedAt), expires = Date.parse(catalog.expiresAt);
    if (typeof catalog.publishedAt !== 'string' || typeof catalog.expiresAt !== 'string' || !Number.isFinite(published) || !Number.isFinite(expires) || published > now() + 300000 || expires <= now() || expires <= published) fail(503, '员工更新目录已过期或发布时间无效');
    if (catalog.sequence < highWater) fail(409, '员工更新目录被较新发布取代');
    record(catalog.archive, ['size', 'sha256']); if (!Number.isSafeInteger(catalog.archive.size) || catalog.archive.size < 22 || catalog.archive.size > MAX_ARCHIVE || !SHA.test(catalog.archive.sha256 || '')) fail(503, '员工更新包大小或摘要无效');
    if (!Array.isArray(catalog.files) || !catalog.files.length || catalog.files.length > 4096) fail(503, '员工更新程序清单无效');
    const names = new Set(); let size = 0;
    for (const item of catalog.files) { record(item, ['path', 'size', 'sha256']); if (!safePath(item.path) || !allowed.has(item.path) || names.has(item.path.toLowerCase()) || !Number.isSafeInteger(item.size) || item.size < 0 || item.size > MAX_ARCHIVE || !SHA.test(item.sha256 || '')) fail(503, '员工更新包含未批准的程序文件'); names.add(item.path.toLowerCase()); size += item.size; }
    if (size > 1073741824) fail(503, '员工更新程序清单超过大小限制');
    return catalog;
  }
  async function closeSelected() { const prior = selected; selected = null; if (prior) await prior.archive.handle.close(); }
  async function load() {
    if (closed) fail(503, '员工更新分发已关闭');
    let descriptor;
    try { descriptor = await open(catalogPath, 2097152); } catch (error) { if (error.code === 'ENOENT') { await closeSelected(); return null; } throw error; }
    let envelope;
    try { envelope = JSON.parse((await read(descriptor.handle, 0, descriptor.size)).toString('utf8')); if (descriptor.snapshot !== statKey(await assertFile(catalogPath, 2097152))) fail(409, '员工更新目录在读取时改变'); }
    catch (error) { if (error.status) throw error; fail(503, '员工更新发布目录无法读取'); }
    finally { await descriptor.handle.close(); }
    const catalog = parse(envelope), identity = digest(envelope.catalog + '\n' + envelope.signature);
    if (selected && selected.identity === identity) { if (selected.archive.snapshot !== statKey(await assertFile(archivePath, MAX_ARCHIVE)) || selected.archive.snapshot !== statKey(await selected.archive.handle.stat({ bigint: true }))) { await closeSelected(); fail(409, '员工更新包已改变，请重新检查发布'); } return selected; }
    if (selected && selected.catalog.sequence === catalog.sequence && selected.identity !== identity) fail(409, '同一发布序号不能改换更新内容');
    await closeSelected(); let archive;
    try { archive = await open(archivePath, MAX_ARCHIVE); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    try {
      if (archive.size !== catalog.archive.size) fail(503, '员工更新包大小与签名目录不符');
      const sha = crypto.createHash('sha256'), blocks = [];
      for (let offset = 0; offset < archive.size; offset += CHUNK) { const bytes = await read(archive.handle, offset, Math.min(CHUNK, archive.size - offset)); sha.update(bytes); blocks.push(digest(bytes)); }
      if (sha.digest('hex') !== catalog.archive.sha256 || archive.snapshot !== statKey(await assertFile(archivePath, MAX_ARCHIVE)) || archive.snapshot !== statKey(await archive.handle.stat({ bigint: true }))) fail(503, '员工更新包校验未通过');
      parse(envelope); highWater = Math.max(highWater, catalog.sequence); selected = { identity, envelope, catalog, archive, blocks }; return selected;
    } catch (error) { await archive.handle.close(); throw error; }
  }
  function getCatalog() { return enqueue(async () => { const value = await load(); return value ? { available: true, catalog: value.envelope.catalog, signature: value.envelope.signature } : { available: false, reason: '主机尚未发布员工更新包，请继续使用当前程序' }; }); }
  function getChunk(input) { return enqueue(async () => {
    record(input, ['sequence', 'sha256', 'offset', 'length']);
    if (!Number.isSafeInteger(input.sequence) || input.sequence < 1 || !SHA.test(input.sha256 || '') || !Number.isSafeInteger(input.offset) || input.offset < 0 || !Number.isInteger(input.length) || input.length < 1) fail(400, '员工更新分块申请无效');
    if (input.length > CHUNK) fail(413, '员工更新分块超过4MiB限制');
    const value = await load(); if (!value) fail(503, '主机尚未发布员工更新包');
    if (input.sequence !== value.catalog.sequence || input.sha256 !== value.catalog.archive.sha256) fail(409, '员工更新发布已变化，请重新检查目录');
    if (input.offset >= value.archive.size || input.length > value.archive.size - input.offset) fail(416, '员工更新分块超出程序包范围');
    const first = Math.floor(input.offset / CHUNK), last = Math.floor((input.offset + input.length - 1) / CHUNK), blocks = [];
    for (let index = first; index <= last; index++) { const bytes = await read(value.archive.handle, index * CHUNK, Math.min(CHUNK, value.archive.size - index * CHUNK)); if (digest(bytes) !== value.blocks[index]) { await closeSelected(); fail(409, '员工更新包内容在下载期间改变'); } blocks.push(bytes); }
    if (value.archive.snapshot !== statKey(await assertFile(archivePath, MAX_ARCHIVE)) || value.archive.snapshot !== statKey(await value.archive.handle.stat({ bigint: true }))) { await closeSelected(); fail(409, '员工更新包在下载期间改变'); }
    parse(value.envelope);
    const bytes = Buffer.concat(blocks).subarray(input.offset - first * CHUNK, input.offset - first * CHUNK + input.length);
    return { sequence: input.sequence, archiveSha256: input.sha256, offset: input.offset, length: bytes.length, bodyBase64: bytes.toString('base64') };
  }); }
  return { getCatalog, getChunk, close: () => enqueue(async () => { closed = true; await closeSelected(); }) };
}
function isEmployeeUpdatePath(address) { const value = typeof address === 'string' ? address.split('?')[0] : ''; return value === '/api/employee-updates' || value.startsWith('/api/employee-updates/'); }
function createUpdateDistributionApi({ runtime, administration, enqueue, updateServices }) {
  let services, initializationError;
  try { services = typeof updateServices === 'function' ? updateServices({ runtime, administration, enqueue }) : updateServices; if (services?.then || services && ['getCatalog', 'getChunk'].some(name => typeof services[name] !== 'function')) throw new TypeError('A ready fixed update distributor is required'); }
  catch { initializationError = true; }
  function actor(sessionAuth, live) {
    const identity = live() ? sessionAuth.identity() : null, user = identity ? sessionAuth.status().user : null;
    if (!identity || !user || user.active !== true || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(user.id)) fail(401, '员工更新登录会话已失效，请重新登录');
    const row = runtime.sqlite.prepare('SELECT password_hash FROM local_accounts WHERE staff_id=?').get(user.id); if (!row?.password_hash) fail(401, '员工更新账号已失效');
    return { id: user.id, credential: row.password_hash, sessionRef: sessionAuth.sessionId, userId: identity.userId };
  }
  function parse(input) {
    if (String(input.method || 'GET').toUpperCase() !== 'GET') fail(405, '员工更新分发只允许固定读取');
    if (input.body !== undefined) fail(400, '员工更新分发不接受请求正文或调用者身份');
    if (typeof input.path !== 'string' || input.path.length > 1024 || /[\\#\x00-\x20\x7f]/.test(input.path)) fail(400, '员工更新地址无效');
    const url = new URL(input.path, 'http://offline.invalid'); if (url.origin !== 'http://offline.invalid' || url.pathname !== input.path.split('?')[0] || /%2f|%5c|%00/i.test(url.pathname)) fail(400, '员工更新地址必须为固定规范路径');
    if (url.pathname === '/api/employee-updates/catalog' && !url.search) return { operation: 'catalog' };
    if (url.pathname !== '/api/employee-updates/chunk') fail(404, '员工更新读取入口不存在');
    const values = {}; for (const [key, value] of url.searchParams) { if (!['sequence', 'sha256', 'offset', 'length'].includes(key) || Object.hasOwn(values, key)) fail(400, '员工更新分块查询含未知或重复字段'); values[key] = value; }
    if (!SHA.test(values.sha256 || '') || ['sequence', 'offset', 'length'].some(key => typeof values[key] !== 'string' || !/^(0|[1-9]\d{0,15})$/.test(values[key]) || !Number.isSafeInteger(Number(values[key]))) || Number(values.sequence) < 1 || Number(values.length) < 1) fail(400, '员工更新分块查询无效');
    if (Number(values.length) > CHUNK) fail(413, '员工更新分块不能超过4MiB');
    return { operation: 'chunk', value: { sequence: Number(values.sequence), sha256: values.sha256, offset: Number(values.offset), length: Number(values.length) } };
  }
  async function dispatch(sessionAuth, live, input) {
    try {
      const request = parse(input), scope = await enqueue(() => { const value = actor(sessionAuth, live); sessionAuth.touch(); return value; });
      if (initializationError) fail(503, '主机员工更新发布配置无效，已停止分发');
      const data = !services ? request.operation === 'catalog' ? { available: false, reason: '主机尚未发布员工更新包，请继续使用当前程序' } : fail(503, '主机尚未发布员工更新包') : await (request.operation === 'catalog' ? services.getCatalog() : services.getChunk(request.value));
      return await enqueue(() => { const current = actor(sessionAuth, live); if (current.id !== scope.id || current.credential !== scope.credential || current.sessionRef !== scope.sessionRef || current.userId !== scope.userId) fail(401, '员工更新读取期间账号或会话已变化'); return { ok: true, status: 200, data }; });
    } catch (error) { const status = Number.isInteger(error.status) ? error.status : 503; return { ok: false, status, data: { error: status === 503 && !error.status ? '员工更新包暂不可读取，请继续使用当前程序' : error.message } }; }
  }
  return { dispatch, close: async () => { if (typeof services?.close === 'function') await services.close(); } };
}
module.exports = { createUpdateDistribution, createUpdateDistributionApi, isEmployeeUpdatePath };

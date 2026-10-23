'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { normalizePrintSource } = require('./print-sources.cjs');

class CentralPrintError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new CentralPrintError(status, message); };
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const STATUSES = ['queued', 'printing', 'submitted', 'failed', 'uncertain'];
const TYPES = ['warranty', 'quotation-a4', 'erp-document-a4', 'erp-report-a4', 'ledger-report-a4', 'inventory-count-a4', 'inventory-report-a4', 'inventory-metal-a4'];
const now = () => new Date().toISOString();
const hash = value => createHash('sha256').update(value).digest('hex');
const stable = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
function freeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const item of Object.values(value)) freeze(item); Object.freeze(value); } return value; }
function record(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![null, Object.prototype].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).some(key => typeof key !== 'string' || !keys.includes(key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))) fail(400, '打印请求包含无效或未允许的字段');
  return value;
}
function text(value, limit) {
  if (typeof value !== 'string' || value.length > limit || /[<>\x00-\x1f\x7f]/.test(value)) fail(400, '质保填写文字无效');
  return value.trim();
}
function warranty(value) {
  record(value, ['itemIndexes', 'overrides']);
  if (!Array.isArray(value.itemIndexes) || !value.itemIndexes.length || value.itemIndexes.length > 30 || new Set(value.itemIndexes).size !== value.itemIndexes.length || value.itemIndexes.some(id => !Number.isInteger(id) || id < 0 || id > 29)) fail(400, '质保商品选择无效');
  const input = value.overrides ?? [];
  if (!Array.isArray(input) || input.length > 30) fail(400, '质保填写字段无效');
  const overrides = input.map(item => {
    record(item, ['itemIndex', 'goodsNumber', 'productName', 'phone', 'afterSalesWechat']);
    if (!value.itemIndexes.includes(item.itemIndex)) fail(400, '质保填写不属于所选商品');
    const result = { itemIndex: item.itemIndex };
    for (const [key, limit] of [['goodsNumber', 60], ['productName', 100], ['phone', 50], ['afterSalesWechat', 50]]) if (item[key] !== undefined) result[key] = text(item[key], limit);
    return result;
  });
  if (new Set(overrides.map(item => item.itemIndex)).size !== overrides.length) fail(400, '质保填写商品重复');
  return { itemIndexes: [...value.itemIndexes], overrides };
}
function presentation(value = {}, kind) {
  record(value, ['language', 'warranty', 'layoutOffsets', 'fontSizes']);
  const language = value.language ?? 'zh';
  if (!['zh', 'en'].includes(language)) fail(400, '打印语言仅允许中文或英文');
  const result = { language };
  if (kind === 'warranty') {
    result.warranty = warranty(value.warranty);
    try {
      const domain = require('./generated/print-domain.cjs');
      if (value.layoutOffsets !== undefined) result.layoutOffsets = domain.normalizeWarrantyLayoutOffsets(value.layoutOffsets);
      if (value.fontSizes !== undefined) result.fontSizes = domain.normalizeWarrantyFontSizes(value.fontSizes);
    } catch { fail(400, '质保布局或字号格式无效'); }
  } else if (value.warranty !== undefined || value.layoutOffsets !== undefined || value.fontSizes !== undefined) fail(400, '非质保打印不能携带套打字段');
  if (Buffer.byteLength(stable(result)) > 32768) fail(413, '打印填写内容过多');
  return result;
}
function normalizeLegacy(value) {
  record(value, ['requestId', 'quoteId', 'kind', 'printerId', 'copies', 'warranty']);
  if (!UUID.test(value.requestId || '') || !UUID.test(value.quoteId || '') || !['warranty', 'quotation-a4'].includes(value.kind) || typeof value.printerId !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(value.printerId) || !Number.isInteger(value.copies) || value.copies < 1 || value.copies > 3) fail(400, '旧打印请求编号、类型、份数或设备无效');
  const view = presentation(value.kind === 'warranty' ? { warranty: value.warranty } : {}, value.kind);
  if (value.kind !== 'warranty' && value.warranty !== undefined) fail(400, 'A4打印不接受质保字段');
  return { version: 2, requestId: value.requestId, source: { type: value.kind, quoteId: value.quoteId }, copies: value.copies, presentation: view, legacyPrinterId: value.printerId };
}
function normalizeInput(value) {
  if (value?.version === undefined) return normalizeLegacy(value);
  record(value, ['version', 'requestId', 'source', 'copies', 'presentation', 'reprintOf', 'reprintConfirmed']);
  if (value.version !== 2 || !UUID.test(value.requestId || '') || !Number.isInteger(value.copies) || value.copies < 1 || value.copies > 3) fail(400, '打印版本、请求编号或份数无效');
  const source = normalizePrintSource(value.source);
  if (value.reprintOf !== undefined || value.reprintConfirmed !== undefined) { if (!UUID.test(value.reprintOf || '') || value.reprintConfirmed !== true) fail(400, '补打必须关联原任务并明确声明已核对出纸情况'); }
  return { version: 2, requestId: value.requestId, source, copies: value.copies, presentation: presentation(value.presentation, source.type), ...(value.reprintOf ? { reprintOf: value.reprintOf, reprintConfirmed: true } : {}) };
}
function safeError(error, fallback) {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return message && !/[A-Za-z]:[\\/]|\\\\|\/Users\/|\/home\//.test(message) ? message.replace(/[<>\x00-\x1f\x7f]/g, '').slice(0, 240) : fallback;
}
function publicJob(value) {
  return JSON.parse(stable({ id: value.id, actorId: value.actorId, actorName: value.actorName, requestId: value.requestId, type: value.type, source: value.acceptedSource || value.sourceRef, requestedSource: value.requestedSource || value.sourceRef, ...(value.requestMeta ? { requestMeta: value.requestMeta } : {}), ...(['warranty', 'quotation-a4'].includes(value.type) ? { kind: value.type, ...(value.sourceRef.salesOrderId ? { salesOrderId: value.sourceRef.salesOrderId } : { quoteId: value.sourceRef.quoteId }) } : {}), copies: value.copies, status: value.status, printerId: value.printerId, printerLabel: value.printerLabel, routingRevision: value.routingRevision, comparison: value.comparison, createdAt: value.createdAt, updatedAt: value.updatedAt, ...(value.error ? { error: value.error } : {}) }));
}
function assertParent(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) throw new TypeError('A trusted absolute retained ledger path is required');
  let parent = path.dirname(file);
  for (;;) {
    const stat = fs.lstatSync(parent);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail(503, '打印防重账本目录不允许符号链接或目录联接');
    const next = path.dirname(parent); if (next === parent) break; parent = next;
  }
}
function readFile(file, missing = true) {
  assertParent(file);
  let stat; try { stat = fs.lstatSync(file); } catch (error) { if (missing && error.code === 'ENOENT') return null; throw error; }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 64 * 1024 * 1024) fail(503, '打印防重账本文件无效');
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { fail(503, '打印防重账本损坏，请先核对和恢复'); }
}
function validateRetained(value) {
  if (!value || value.version !== 2 || !Array.isArray(value.jobs) || value.jobs.length > 1000000) fail(503, '打印防重账本版本或数量无效');
  const ids = new Set(), requests = new Set();
  for (const item of value.jobs) {
    if (!item || !UUID.test(item.id || '') || typeof item.actorId !== 'string' || !item.actorId || item.actorId.length > 120 || !UUID.test(item.requestId || '') || !HASH.test(item.paramsHash || '') || !STATUSES.includes(item.status) || !TYPES.includes(item.type) || !Number.isInteger(item.copies) || item.copies < 1 || item.copies > 3 || !Number.isSafeInteger(item.routingRevision) || item.routingRevision < 0 || !['business-json', 'immutable-snapshot'].includes(item.comparison) || !Number.isFinite(Date.parse(item.createdAt)) || !Number.isFinite(Date.parse(item.updatedAt)) || !['not-authorized', 'authorized'].includes(item.dispatchState) || ids.has(item.id) || requests.has(item.actorId + ':' + item.requestId)) fail(503, '打印防重账本记录无效');
    try { normalizePrintSource(item.sourceRef); } catch { fail(503, '打印防重账本来源无效'); }
    if (item.sourceRef.type !== item.type) fail(503, '打印防重账本来源冲突');
    ids.add(item.id); requests.add(item.actorId + ':' + item.requestId);
  }
  return value.jobs;
}
function legacyJobs(file) {
  if (!file) return [];
  const value = readFile(file);
  if (value === null) return [];
  if (value.version !== 1 || !Array.isArray(value.jobs) || value.jobs.length > 1000000) fail(503, '旧打印防重账本格式无效');
  const seen = new Set(), ids = new Set(), keys = ['id', 'actorId', 'requestId', 'quoteId', 'kind', 'paramsHash', 'status', 'createdAt', 'updatedAt'];
  return value.jobs.map(item => {
    if (!item || Object.keys(item).some(key => !keys.includes(key)) || !UUID.test(item.id || '') || typeof item.actorId !== 'string' || !item.actorId || !UUID.test(item.requestId || '') || !UUID.test(item.quoteId || '') || !['warranty', 'quotation-a4'].includes(item.kind) || !HASH.test(item.paramsHash || '') || !STATUSES.includes(item.status) || !Number.isFinite(Date.parse(item.createdAt)) || !Number.isFinite(Date.parse(item.updatedAt)) || seen.has(item.actorId + ':' + item.requestId) || ids.has(item.id)) fail(503, '旧打印防重账本记录无效');
    seen.add(item.actorId + ':' + item.requestId); ids.add(item.id);
    return { ...item, actorName: '', sourceRef: { type: item.kind, quoteId: item.quoteId }, type: item.kind, copies: 1, printerId: '', printerLabel: '', routingRevision: 0, comparison: 'immutable-snapshot', status: ['queued', 'printing'].includes(item.status) ? 'uncertain' : item.status, error: '旧版打印记录；请先核对原任务', legacy: true };
  });
}
function createLegacyPrintHistory({ db, file, metadataFile, readOnly = false }) {
  const baseKeys = ['id', 'actorId', 'requestId', 'quoteId', 'kind', 'paramsHash', 'status', 'createdAt', 'updatedAt'];
  const extraKeys = ['requestParamsHash', 'copies', 'printerId', 'printerLabel', 'routingRevision'];
  const jobs = new Map(legacyJobs(file).map(value => [value.id, value])), extras = new Map(), baseValue = file ? readFile(file) : null;
  const extraFile = metadataFile ? readFile(metadataFile) : null;
  if (extraFile !== null) {
    if (extraFile.version !== 1 || !Array.isArray(extraFile.jobs) || extraFile.jobs.length > 1000000) fail(503, '旧打印元数据账本无效');
    for (const value of extraFile.jobs) {
      if (!value || Object.keys(value).some(key => !['id', 'paramsHash', ...extraKeys].includes(key)) || !UUID.test(value.id || '') || !HASH.test(value.paramsHash || '') || extras.has(value.id) || value.requestParamsHash !== undefined && !HASH.test(value.requestParamsHash) || value.copies !== undefined && (!Number.isInteger(value.copies) || value.copies < 1 || value.copies > 3) || value.printerId !== undefined && (typeof value.printerId !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(value.printerId)) || value.printerLabel !== undefined && (typeof value.printerLabel !== 'string' || value.printerLabel.length > 500 || /[\x00-\x1f\x7f]/.test(value.printerLabel)) || value.routingRevision !== undefined && (!Number.isSafeInteger(value.routingRevision) || value.routingRevision < 0)) fail(503, '旧打印元数据记录无效');
      extras.set(value.id, { ...value });
    }
  }
  function plain(value) { return Object.fromEntries(baseKeys.map(key => [key, value[key]])); }
  function atomicWrite(target, value) {
    assertParent(target); const current = readFile(target), temporary = target + '.' + randomUUID() + '.tmp'; let descriptor;
    try { descriptor = fs.openSync(temporary, 'wx', 0o600); fs.writeFileSync(descriptor, JSON.stringify(value)); fs.fsyncSync(descriptor); fs.closeSync(descriptor); descriptor = undefined; fs.renameSync(temporary, target); }
    catch { fail(503, '旧打印兼容账本保存失败，已停止发送'); }
    finally { if (descriptor !== undefined) fs.closeSync(descriptor); if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
  function persist() {
    if (readOnly || !file) return;
    if (metadataFile) atomicWrite(metadataFile, { version: 1, jobs: [...extras.values()] });
    atomicWrite(file, { version: 1, jobs: [...jobs.values()].map(plain) });
  }
  const oldTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='remote_print_jobs'").get();
  const rows = oldTable ? db.prepare('SELECT * FROM remote_print_jobs').all() : [], updates = [];
  for (const row of rows) {
    if (!UUID.test(row.id || '') || typeof row.actor_id !== 'string' || !row.actor_id || !UUID.test(row.request_id || '') || !UUID.test(row.quote_id || '') || !STATUSES.includes(row.status) || !Number.isFinite(Date.parse(row.created_at)) || !Number.isFinite(Date.parse(row.updated_at))) fail(503, '旧打印数据库历史无效');
    let request, route;
    try { const stored = JSON.parse(row.params_json); if (stored?.version === 2) { record(stored, ['version', 'request', 'route']); request = stored.request; route = stored.route; } else request = stored; normalizeLegacy(request); }
    catch { fail(503, '旧打印数据库请求内容无效'); }
    if (request.quoteId !== row.quote_id || request.kind !== row.kind || request.requestId !== row.request_id || request.copies !== row.copies || request.printerId !== row.printer_id) fail(503, '旧打印数据库字段与保存请求冲突');
    const paramsHash = hash(row.params_json), prior = jobs.get(row.id), extra = extras.get(row.id);
    if (prior && (prior.paramsHash !== paramsHash || prior.actorId !== row.actor_id || prior.requestId !== row.request_id) || [...jobs.values()].some(value => value.id !== row.id && value.actorId === row.actor_id && value.requestId === row.request_id)) fail(503, '旧打印数据库与保留账本冲突');
    if (extra && (extra.paramsHash !== paramsHash || extra.requestParamsHash && extra.requestParamsHash !== hash(stable(request)) || extra.copies !== undefined && extra.copies !== row.copies || extra.printerId !== undefined && extra.printerId !== row.printer_id)) fail(503, '旧打印数据库与元数据账本冲突');
    const savedStatus = prior?.status || row.status, status = ['queued', 'printing'].includes(savedStatus) ? 'uncertain' : savedStatus;
    jobs.set(row.id, { id: row.id, actorId: row.actor_id, actorName: row.actor_name || '', requestId: row.request_id, quoteId: row.quote_id, kind: row.kind, type: row.kind, sourceRef: { type: row.kind, quoteId: row.quote_id }, paramsHash, status, createdAt: prior?.createdAt || row.created_at, updatedAt: prior?.updatedAt || row.updated_at, comparison: 'immutable-snapshot', copies: row.copies, printerId: row.printer_id, printerLabel: route?.label || extra?.printerLabel || '', routingRevision: route?.routingRevision ?? extra?.routingRevision ?? 0, requestParamsHash: hash(stable(request)), legacy: true, error: status === 'uncertain' ? '旧版任务未确认提交结果，未自动续打；请核对原任务' : '' });
    extras.set(row.id, { id: row.id, paramsHash, requestParamsHash: hash(stable(request)), copies: row.copies, printerId: row.printer_id, printerLabel: route?.label || extra?.printerLabel || '', routingRevision: route?.routingRevision ?? extra?.routingRevision ?? 0 });
    if (row.status !== status) updates.push({ id: row.id, status });
  }
  for (const [id, extra] of extras) {
    const value = jobs.get(id); if (!value || value.paramsHash !== extra.paramsHash) fail(503, '旧打印元数据缺少匹配的保留记录');
    Object.assign(value, Object.fromEntries(extraKeys.filter(key => extra[key] !== undefined).map(key => [key, extra[key]])));
  }
  if (!readOnly && (rows.length || baseValue?.jobs.some(value => ['queued', 'printing'].includes(value.status)))) {
    persist(); for (const update of updates) db.prepare('UPDATE remote_print_jobs SET status=?,error=?,updated_at=? WHERE id=?').run(update.status, '旧版记录已迁入统一历史；没有自动续打', now(), update.id);
  }
  function put(row) {
    if (!file || !['warranty', 'quotation-a4'].includes(row.kind)) return;
    const input = JSON.parse(row.params_json), source = input.source;
    // The old compatibility ledger only understands quotation identities.
    // Order jobs are already durable in the typed central retained ledger.
    if (source.salesOrderId) return;
    const request = { requestId: row.request_id, quoteId: source.quoteId, kind: row.kind, printerId: row.printer_id, copies: row.copies };
    if (row.kind === 'warranty') request.warranty = input.presentation.warranty;
    const paramsHash = hash(stable(request)), prior = jobs.get(row.id);
    if (prior && (prior.paramsHash !== paramsHash || prior.actorId !== row.actor_id || prior.requestId !== row.request_id)) fail(503, '新的销售打印与原兼容账本冲突');
    const value = { id: row.id, actorId: row.actor_id, actorName: row.actor_name, requestId: row.request_id, quoteId: source.quoteId, kind: row.kind, type: row.kind, sourceRef: source, paramsHash, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at, comparison: row.comparison, legacy: true };
    jobs.set(row.id, value); extras.set(row.id, { id: row.id, paramsHash, requestParamsHash: paramsHash, copies: row.copies, printerId: row.printer_id, printerLabel: row.printer_label, routingRevision: row.routing_revision });
    persist();
  }
  return { all: () => [...jobs.values()], put };
}
function retainedLedger(file) {
  const lockFile = file + '.lock'; assertParent(file);
  let lock;
  try { lock = fs.openSync(lockFile, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const stale = readFile(lockFile, false); let alive = true;
    if (Number.isInteger(stale?.pid) && stale.pid > 0) { try { process.kill(stale.pid, 0); } catch (failure) { if (failure.code === 'ESRCH') alive = false; } }
    if (alive) fail(409, '另一主机打印队列正在使用防重账本');
    fs.unlinkSync(lockFile); lock = fs.openSync(lockFile, 'wx', 0o600);
  }
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, owner: randomUUID() })); fs.fsyncSync(lock);
  let released = false, jobs;
  function release() { if (!released) { released = true; fs.closeSync(lock); fs.unlinkSync(lockFile); } }
  try { const value = readFile(file); jobs = value === null ? [] : validateRetained(value); } catch (error) { release(); throw error; }
  function put(item) {
    const prior = jobs.find(row => row.id === item.id || row.actorId === item.actorId && row.requestId === item.requestId);
    if (prior && (prior.id !== item.id || prior.paramsHash !== item.paramsHash || prior.actorId !== item.actorId)) fail(503, '打印防重账本和业务记录冲突');
    const next = prior ? jobs.map(row => row.id === item.id ? item : row) : [...jobs, item];
    const json = JSON.stringify({ version: 2, jobs: next }); if (Buffer.byteLength(json) > 64 * 1024 * 1024) fail(503, '打印防重账本达到容量上限，请保留原账本后维护');
    assertParent(file); const current = fs.existsSync(file) ? fs.lstatSync(file) : null;
    if (current && (!current.isFile() || current.isSymbolicLink() || current.nlink !== 1)) fail(503, '打印防重账本被替换，已停止提交');
    const temporary = file + '.' + randomUUID() + '.tmp'; let descriptor;
    try { descriptor = fs.openSync(temporary, 'wx', 0o600); fs.writeFileSync(descriptor, json); fs.fsyncSync(descriptor); fs.closeSync(descriptor); descriptor = undefined; fs.renameSync(temporary, file); jobs = next; }
    catch { fail(503, '打印防重账本保存失败，已停止发送'); }
    finally { if (descriptor !== undefined) fs.closeSync(descriptor); if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
  return { all: () => jobs, byId: id => jobs.find(row => row.id === id), byRequest: (actorId, requestId) => jobs.find(row => row.actorId === actorId && row.requestId === requestId), put, release };
}
function actorValid(actor) {
  if (!actor || typeof actor.id !== 'string' || !actor.id || actor.id.length > 120 || !['employee', 'admin'].includes(actor.role) || actor.active === false || typeof actor.name !== 'string' || actor.name.length > 120 || typeof actor.credential !== 'string' || !actor.credential || actor.credential.length > 4096 || !actor.identity || typeof actor.identity !== 'object' || Array.isArray(actor.identity)) fail(401, '员工登录已失效，请重新登录');
  return actor;
}
function entry(row) {
  const prepared = JSON.parse(row.prepared_json), input = JSON.parse(row.params_json);
  return { id: row.id, actorId: row.actor_id, actorName: row.actor_name, requestId: row.request_id, paramsHash: row.params_hash, type: row.kind, sourceRef: JSON.parse(row.source_json), requestedSource: input.source, ...(prepared.acceptedSource ? { acceptedSource: prepared.acceptedSource } : {}), ...(prepared.requestMeta ? { requestMeta: { ...prepared.requestMeta, ...(input.reprintOf ? { reprintOf: input.reprintOf, reprintConfirmed: true } : {}) } } : {}), copies: row.copies, printerId: row.printer_id, printerLabel: row.printer_label, routingRevision: row.routing_revision, comparison: row.comparison, status: row.status, dispatchState: row.dispatch_state, error: row.error, createdAt: row.created_at, updatedAt: row.updated_at };
}
function readCentralPrintHistory({ db, file }) {
  const value = file ? readFile(file) : null, rows = value === null ? [] : validateRetained(value), combined = new Map(rows.map(item => [item.id, item]));
  if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='central_print_jobs'").get()) for (const row of db.prepare('SELECT * FROM central_print_jobs').all()) {
    const prior = combined.get(row.id); if (prior && (prior.actorId !== row.actor_id || prior.paramsHash !== row.params_hash)) fail(503, '统一打印历史数据库与保留账本冲突');
    if (!prior) combined.set(row.id, entry(row));
  }
  return [...combined.values()].map(item => ['queued', 'printing'].includes(item.status) ? { ...item, status: 'uncertain', error: '打印代理未接入；原任务没有自动续打，请到主机核对' } : item);
}
function createCentralPrintJobs({ runtime, sources, routing, agent, authenticate, loadActor, authorizeActor, enqueue, audit, retainedFile, legacyRetainedFile, legacyMetadataFile, fingerprintPayload, capturePresentation, assertDispatchAuthorized, agentTimeoutMs = 60000 } = {}) {
  if (!runtime?.sqlite || typeof runtime.withIdentity !== 'function' || typeof runtime.getIdentity !== 'function' || typeof sources?.prepare !== 'function' || typeof sources?.revalidate !== 'function' || typeof routing?.resolve !== 'function' || typeof routing?.getOptions !== 'function' || typeof agent?.print !== 'function' || [authenticate, loadActor, authorizeActor].some(fn => typeof fn !== 'function') || typeof retainedFile !== 'string' || !path.isAbsolute(retainedFile) || enqueue !== undefined && typeof enqueue !== 'function' || fingerprintPayload !== undefined && typeof fingerprintPayload !== 'function') throw new TypeError('Trusted identity, data, source, routing, agent and retained-ledger callbacks are required');
  if (assertDispatchAuthorized !== undefined && typeof assertDispatchAuthorized !== 'function' || !Number.isInteger(agentTimeoutMs) || agentTimeoutMs < 1 || agentTimeoutMs > 120000) throw new TypeError('Synchronous final authority and bounded agent timeout are required');
  const db = runtime.sqlite, pending = [], ledger = retainedLedger(retainedFile);
  let compatibility;
  try { compatibility = createLegacyPrintHistory({ db, file: legacyRetainedFile, metadataFile: legacyMetadataFile }); } catch (error) { ledger.release(); throw error; }
  const old = compatibility.all();
  let serial = Promise.resolve(), active = null, pauses = 0, stopped = false, closing = null;
  const serialize = fn => { const run = serial.then(() => enqueue ? enqueue(fn) : fn()); serial = run.catch(() => {}); return run; };
  const byId = id => db.prepare('SELECT * FROM central_print_jobs WHERE id=?').get(id);
  const retainedByRequest = (actorId, requestId) => ledger.byRequest(actorId, requestId) || old.find(row => row.actorId === actorId && row.requestId === requestId);
  function event(row, action, before, after) {
    const value = { id: randomUUID(), jobId: row.id, actorId: row.actor_id, actorName: row.actor_name, action, before, after, at: now() };
    db.prepare('INSERT INTO central_print_events(id,job_id,actor_id,actor_name,action,before_json,after_json,created_at) VALUES(?,?,?,?,?,?,?,?)').run(value.id, value.jobId, value.actorId, value.actorName, action, before === null ? null : JSON.stringify(before), JSON.stringify(after), value.at);
    return value;
  }
  async function publishAudit(value) { if (typeof audit === 'function') { try { await audit(value); } catch { /* The immutable metadata event is already stored transactionally. */ } } }
  function transition(id, status, error = '', dispatchState) {
    const prior = byId(id); if (!prior) fail(503, '打印队列记录丢失，停止发送');
    let savedEvent;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('UPDATE central_print_jobs SET status=?,error=?,dispatch_state=?,updated_at=? WHERE id=?').run(status, error, dispatchState ?? prior.dispatch_state, now(), id);
      const next = byId(id); ledger.put(entry(next)); compatibility.put(next); savedEvent = event(prior, 'print-' + status, publicJob(entry(prior)), publicJob(entry(next))); db.exec('COMMIT');
    } catch (failure) { db.exec('ROLLBACK'); throw failure; }
    return savedEvent;
  }
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS central_print_jobs (
      id TEXT PRIMARY KEY NOT NULL,actor_id TEXT NOT NULL,actor_name TEXT NOT NULL,credential_hash TEXT NOT NULL,
      request_id TEXT NOT NULL,params_hash TEXT NOT NULL,params_json TEXT NOT NULL,source_json TEXT NOT NULL,
      prepared_json TEXT NOT NULL,presentation_json TEXT NOT NULL,route_json TEXT NOT NULL,
      kind TEXT NOT NULL,session_ref TEXT NOT NULL DEFAULT '',copies INTEGER NOT NULL CHECK(copies BETWEEN 1 AND 3),printer_id TEXT NOT NULL,printer_label TEXT NOT NULL,
      routing_revision INTEGER NOT NULL,comparison TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN('queued','printing','submitted','failed','uncertain')),
      dispatch_state TEXT NOT NULL CHECK(dispatch_state IN('not-authorized','authorized')),error TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
      UNIQUE(actor_id,request_id));
      CREATE INDEX IF NOT EXISTS central_print_owner_date ON central_print_jobs(actor_id,created_at);
      CREATE TABLE IF NOT EXISTS central_print_events(id TEXT PRIMARY KEY NOT NULL,job_id TEXT NOT NULL,actor_id TEXT NOT NULL,actor_name TEXT NOT NULL,action TEXT NOT NULL,before_json TEXT,after_json TEXT NOT NULL,created_at TEXT NOT NULL);`);
    if (!db.prepare('PRAGMA table_info(central_print_jobs)').all().some(column => column.name === 'session_ref')) db.exec("ALTER TABLE central_print_jobs ADD COLUMN session_ref TEXT NOT NULL DEFAULT ''");
    // The external ledger is authoritative across a business-data rollback.
    for (const item of [...ledger.all()]) if (['queued', 'printing'].includes(item.status)) ledger.put({ ...item, status: 'uncertain', error: '主机重启前未确认提交结果；请核对后新建补打请求', updatedAt: now() });
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const row of db.prepare('SELECT * FROM central_print_jobs').all()) {
        const saved = ledger.byId(row.id);
        if (saved && (saved.paramsHash !== row.params_hash || saved.actorId !== row.actor_id)) fail(503, '打印数据库与保留账本冲突');
        const next = saved || { ...entry(row), status: ['queued', 'printing'].includes(row.status) ? 'uncertain' : row.status, error: ['queued', 'printing'].includes(row.status) ? '主机未完成确认，未自动重打' : row.error, updatedAt: now() };
        if (!saved) ledger.put(next);
        db.prepare('UPDATE central_print_jobs SET status=?,error=?,dispatch_state=?,updated_at=? WHERE id=?').run(next.status, next.error || '', next.dispatchState, next.updatedAt, row.id);
      }
      db.exec('COMMIT');
    } catch (failure) { db.exec('ROLLBACK'); throw failure; }
  } catch (error) { ledger.release(); throw error; }
  async function actorNow() { return actorValid(await authenticate()); }
  async function permission(actor, source) { if (await authorizeActor(actor, source) === false) fail(403, '员工模块或打印权限已撤销'); }
  async function currentActor(row, source) {
    const actor = actorValid(await loadActor(row.actor_id, row.session_ref || ''));
    if (actor.id !== row.actor_id || hash(actor.credential) !== row.credential_hash) fail(403, '员工账号已停用或密码更改，此打印已取消');
    await permission(actor, source); return actor;
  }
  async function resolve(kind, actor) {
    const result = await routing.resolve(kind, actor);
    if (!result || typeof result.printerId !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(result.printerId) || typeof result.deviceName !== 'string' || !result.deviceName || typeof result.label !== 'string' || result.label.length > 240 || !Number.isSafeInteger(result.routingRevision) || result.routingRevision < 0 || result.paper === undefined) fail(503, '主机打印设备路由无效');
    return JSON.parse(stable(result));
  }
  async function preflight(row) {
    if (!row || !['queued', 'printing'].includes(row.status)) fail(409, '打印任务已处理或未等待发送');
    const source = JSON.parse(row.source_json), actor = await currentActor(row, source), prepared = JSON.parse(row.prepared_json);
    if (!prepared.acceptedSource || !prepared.requestMeta) fail(409, '旧打印记录缺少受理快照元数据，不允许自动续打');
    await runtime.withIdentity(actor.identity, async () => {
      await sources.revalidate(actor, prepared);
      const route = await resolve(source.type, actor);
      if (stable(route) !== row.route_json) fail(409, '打印设备绑定或纸张修订已变化，未切换到其他设备');
    });
    return { actor, prepared, route: JSON.parse(row.route_json) };
  }
  function payloadFor(row, prepared, route) {
    const payload = { jobId: row.id, kind: row.kind, document: prepared.document, route, copies: row.copies, presentation: JSON.parse(row.presentation_json) };
    payload.payloadHash = fingerprintPayload ? fingerprintPayload(payload) : hash(stable(payload));
    if (!HASH.test(payload.payloadHash || '')) fail(503, '打印载荷摘要无效');
    return freeze(payload);
  }
  function kick() {
    if (active || stopped || pauses || !pending.length) return;
    active = (async () => {
      while (!stopped && !pauses && pending.length) {
        const id = pending.shift(); let payload;
        try {
          payload = await serialize(async () => { const row = byId(id), { prepared, route } = await preflight(row); const result = payloadFor(row, prepared, route); await publishAudit(transition(id, 'printing')); return result; });
        } catch (failure) {
          await serialize(async () => { if (byId(id)) await publishAudit(transition(id, 'failed', safeError(failure, '主机打印准备失败，请检查'))); }); continue;
        }
        let gatePassed = false, gateRequested = false, gateFailure = false, status = 'uncertain', error = '主机未能确认提交结果，请核对纸张后再补打';
        const frozenHash = payload.payloadHash;
        let finishDispatch, agentFinished = false, timer;
        const dispatchFinished = new Promise(resolve => { finishDispatch = resolve; });
        try {
          const flight = runtime.withIdentity(null, () => agent.print(payload, {
            assertAuthorized: () => new Promise((resolveReceipt, rejectReceipt) => {
              if (gateRequested || agentFinished) { rejectReceipt(new CentralPrintError(409, '此打印任务的最终授权已请求或代理会话已结束')); return; }
              gateRequested = true;
              const gate = serialize(async () => {
              if (gatePassed) fail(409, '此打印任务的最终发送授权已经使用');
              try {
                if (agentFinished) fail(409, '打印代理会话已结束，不再授权发送');
                const row = byId(id); await preflight(row);
                const fresh = payloadFor(row, JSON.parse(row.prepared_json), JSON.parse(row.route_json));
                if (fresh.payloadHash !== frozenHash) fail(409, '打印载荷在发送前发生变化');
                if (agentFinished) fail(409, '打印代理准备或连接已超时，不再授权发送');
                // Save irreversible authorization knowledge before allowing the
                // agent to call Windows. SQL failure afterwards stays uncertain.
                await publishAudit(transition(id, 'printing', '', 'authorized'));
                if (agentFinished) fail(409, '打印代理连接已结束，不再发送最终授权');
                if (assertDispatchAuthorized) {
                  const decision = assertDispatchAuthorized({ actorId: row.actor_id, credentialHash: row.credential_hash, sessionRef: row.session_ref || '', source: JSON.parse(row.source_json), prepared: JSON.parse(row.prepared_json) });
                  if (decision?.then || decision === false) fail(403, '最终同步打印授权已失效');
                }
                gatePassed = true;
                // Resolve the receipt separately while retaining the shared SQL
                // gate. Promise adoption must not run a queued account/grant
                // mutation before the agent's immediate native submit.
                // Leave one second below the worker's five-second maximum so
                // small per-process clock differences cannot extend that cap.
                resolveReceipt({ jobId: id, payloadHash: frozenHash, route: fresh.route, copies: fresh.copies, expiresAt: Date.now() + 4000 });
                await dispatchFinished;
              } catch (failure) { gateFailure = true; rejectReceipt(failure); throw failure; }
              });
              gate.catch(failure => { gateFailure = true; rejectReceipt(failure); });
            }),
          }));
          const result = await Promise.race([flight, new Promise((_resolve, reject) => { timer = setTimeout(() => { const error = new Error('打印代理响应超时，请到主机核对；没有自动重发'); error.code = 'PRINT_AGENT_TIMEOUT'; reject(error); }, agentTimeoutMs); })]);
          if (result?.status === 'failed' || gatePassed && ['submitted', 'uncertain'].includes(result?.status)) status = result.status;
          if (result?.simulation === true && status === 'submitted') { status = 'uncertain'; error = '测试代理仅模拟提交，未连接实体打印机'; }
          else if (status === 'submitted') error = '';
          else if (status === 'failed') error = safeError(result?.error, '打印代理确认未提交，请检查后新建请求');
          else if (result?.error) error = safeError(result.error, error);
        } catch (failure) {
          status = gateFailure && !gatePassed ? 'failed' : 'uncertain';
          error = safeError(failure, error);
        } finally {
          clearTimeout(timer); agentFinished = true; finishDispatch();
        }
        await serialize(async () => { await publishAudit(transition(id, status, error)); });
      }
    })().catch(() => { stopped = true; }).finally(() => { active = null; if (!stopped && !pauses && pending.length) setImmediate(kick); });
  }
  function legacyFingerprint(input, printerId) {
    if (input.source.salesOrderId || !['warranty', 'quotation-a4'].includes(input.source.type) || input.presentation.language !== 'zh' || input.presentation.layoutOffsets || input.presentation.fontSizes) return null;
    const result = { requestId: input.requestId, quoteId: input.source.quoteId, kind: input.source.type, printerId, copies: input.copies };
    if (input.source.type === 'warranty') result.warranty = input.presentation.warranty;
    return hash(stable(result));
  }
  async function prepareReprint(actor, input) {
    const row = byId(input.reprintOf), original = ledger.byId(input.reprintOf) || old.find(item => item.id === input.reprintOf) || (row ? entry(row) : null);
    if (!original || actor.role !== 'admin' && original.actorId !== actor.id) fail(404, '原打印任务不存在或无权补打');
    if (!['submitted', 'failed', 'uncertain'].includes(original.status)) fail(409, '原任务尚未结束，请先查询状态，不能补打');
    if (input.requestId === original.requestId) fail(409, '补打必须使用新的请求编号');
    if (stable(input.source) !== stable(original.requestedSource || original.sourceRef)) fail(409, '补打来源必须与原任务相同；不同单据请新建普通请求');
    await permission(actor, original.sourceRef);
    if (row) {
      const prepared = JSON.parse(row.prepared_json);
      if (!prepared.acceptedSource || !prepared.requestMeta) fail(409, '原任务缺少可复用内容，请重新核对原单后新建普通请求');
      await runtime.withIdentity(actor.identity, () => sources.revalidate(actor, prepared));
      return prepared;
    }
    const prepared = await runtime.withIdentity(actor.identity, () => sources.prepare(actor, original.sourceRef));
    if (original.requestMeta) {
      if (stable(prepared.acceptedSource) !== stable(original.acceptedSource) || prepared.fingerprint !== original.requestMeta.fingerprint) fail(409, '原任务内容快照暂不可复用，请核对单据后新建普通请求');
      prepared.asOf = original.requestMeta.asOf;
      prepared.requestMeta = { ...prepared.requestMeta, asOf: prepared.asOf };
      await runtime.withIdentity(actor.identity, () => sources.revalidate(actor, prepared));
    } else if (!original.legacy || !['warranty', 'quotation-a4'].includes(original.type)) fail(409, '原任务缺少可复用内容，请核对后新建普通请求');
    return prepared;
  }
  async function submit(value) {
    const input = normalizeInput(value);
    return serialize(async () => {
      const actor = await actorNow();
      if (stopped) fail(503, '主机打印队列正在关闭或需核对，暂不接受新任务');
      await permission(actor, input.source);
      const params = stable(input), paramsHash = hash(params);
      const prior = db.prepare('SELECT * FROM central_print_jobs WHERE actor_id=? AND request_id=?').get(actor.id, input.requestId);
      const retained = retainedByRequest(actor.id, input.requestId);
      if (prior || retained) {
        const stored = retained || entry(prior);
        if (stored.legacy) {
          const selected = input.legacyPrinterId || stored.printerId || (await resolve(input.source.type, actor)).printerId;
          if (legacyFingerprint(input, selected) !== (stored.requestParamsHash || stored.paramsHash)) fail(409, '此请求编号已用于不同的旧版打印内容');
        } else if (stored.paramsHash !== paramsHash) fail(409, '此打印请求编号已用于不同参数，请核对原任务');
        return { job: publicJob(stored) };
      }
      if (db.prepare("SELECT count(*) count FROM central_print_jobs WHERE status IN('queued','printing')").get().count >= 20) fail(429, '主机全局打印队列已满，请稍后再试');
      const prepared = input.reprintOf ? await prepareReprint(actor, input) : await runtime.withIdentity(actor.identity, () => sources.prepare(actor, input.source));
      if (!prepared || !prepared.document || !prepared.acceptedSource || !prepared.requestMeta || prepared.requestMeta.sourceType !== input.source.type || prepared.requestMeta.fingerprint !== prepared.fingerprint || prepared.requestMeta.comparison !== prepared.comparison || !HASH.test(prepared.fingerprint || '') || !['business-json', 'immutable-snapshot'].includes(prepared.comparison)) fail(503, '业务服务未准备可信打印快照和受理元数据');
      const route = await resolve(input.source.type, actor);
      if (input.legacyPrinterId && input.legacyPrinterId !== route.printerId) fail(409, '旧客户端所选设备与本类固定主机设备不同，请更新客户端或核对设备');
      const agentPresentation = capturePresentation ? await capturePresentation(input.source.type, JSON.parse(stable(input.presentation)), freeze(JSON.parse(stable(route))), input.copies, actor) : input.presentation;
      record(agentPresentation, ['language', 'warranty', 'settings', 'size']);
      if (Buffer.byteLength(stable(agentPresentation)) > 65536) fail(413, '打印展示快照过大');
      await currentActor({ actor_id: actor.id, credential_hash: hash(actor.credential), session_ref: actor.sessionRef || '' }, input.source);
      const data = stable(prepared); if (Buffer.byteLength(data) > 64 * 1024 * 1024) fail(413, '打印快照过大，请缩小范围');
      const id = randomUUID(), time = now(); let savedEvent;
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare("INSERT INTO central_print_jobs(id,actor_id,actor_name,credential_hash,request_id,params_hash,params_json,source_json,prepared_json,presentation_json,route_json,kind,session_ref,copies,printer_id,printer_label,routing_revision,comparison,status,dispatch_state,error,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'queued','not-authorized','',?,?)").run(id, actor.id, actor.name, hash(actor.credential), input.requestId, paramsHash, params, stable(prepared.sourceRef || input.source), data, stable(agentPresentation), stable(route), input.source.type, actor.sessionRef || '', input.copies, route.printerId, route.label, route.routingRevision, prepared.comparison, time, time);
        const row = byId(id); ledger.put(entry(row)); compatibility.put(row); savedEvent = event(row, 'print-queued', null, publicJob(entry(row))); db.exec('COMMIT');
      } catch (failure) { db.exec('ROLLBACK'); throw failure; }
      await publishAudit(savedEvent); pending.push(id); setImmediate(kick);
      return { job: publicJob(entry(byId(id))) };
    });
  }
  async function get(id) {
    if (!UUID.test(id || '')) fail(404, '打印任务不存在');
    return serialize(async () => { const actor = await actorNow(), value = ledger.byId(id) || old.find(row => row.id === id) || (byId(id) ? entry(byId(id)) : null); if (!value || actor.role !== 'admin' && value.actorId !== actor.id) fail(404, '打印任务不存在或无权查看'); return { job: publicJob(value) }; });
  }
  async function byRequest(requestId) {
    if (!UUID.test(requestId || '')) fail(404, '打印任务不存在');
    return serialize(async () => { const actor = await actorNow(), row = db.prepare('SELECT * FROM central_print_jobs WHERE actor_id=? AND request_id=?').get(actor.id, requestId), item = retainedByRequest(actor.id, requestId) || (row ? entry(row) : null); if (!item) fail(404, '打印任务不存在'); return { job: publicJob(item) }; });
  }
  async function list(filters = {}) {
    record(filters, ['status', 'type', 'actorId', 'from', 'to', 'limit', 'offset']);
    if (filters.status !== undefined && !STATUSES.includes(filters.status) || filters.type !== undefined && !TYPES.includes(filters.type) || filters.actorId !== undefined && (typeof filters.actorId !== 'string' || !filters.actorId || filters.actorId.length > 120)) fail(400, '打印队列筛选格式无效');
    const limit = filters.limit ?? 100, offset = filters.offset ?? 0;
    if (!Number.isInteger(limit) || limit < 1 || limit > 500 || !Number.isSafeInteger(offset) || offset < 0) fail(400, '打印队列分页无效');
    const endpoints = {};
    for (const key of ['from', 'to']) if (filters[key] !== undefined) { const value = filters[key]; if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value + 'T00:00:00+08:00')) || new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value) fail(400, '打印队列筛选日期无效'); endpoints[key] = new Date(value + 'T00:00:00+08:00').toISOString(); }
    if (endpoints.from && endpoints.to && endpoints.from > endpoints.to) fail(400, '打印队列筛选日期范围无效');
    if (endpoints.to) endpoints.to = new Date(Date.parse(endpoints.to) + 86400000).toISOString();
    return serialize(async () => {
      const actor = await actorNow();
      if (actor.role !== 'admin' && filters.actorId && filters.actorId !== actor.id) fail(403, '只能查看本人的打印任务');
      const combined = new Map(old.map(row => [row.id, row])); for (const row of ledger.all()) combined.set(row.id, row); for (const row of db.prepare('SELECT * FROM central_print_jobs').all()) if (!combined.has(row.id)) combined.set(row.id, entry(row));
      const items = [...combined.values()].filter(row => (actor.role === 'admin' || row.actorId === actor.id) && (!filters.actorId || row.actorId === filters.actorId) && (!filters.status || row.status === filters.status) && (!filters.type || row.type === filters.type) && (!endpoints.from || row.createdAt >= endpoints.from) && (!endpoints.to || row.createdAt < endpoints.to)).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
      return { jobs: items.slice(offset, offset + limit).map(publicJob), total: items.length, limit, offset };
    });
  }
  async function options() {
    return serialize(async () => {
      const actor = await actorNow(), permitted = [];
      for (const type of TYPES) { try { await permission(actor, { type }); permitted.push(type); } catch (failure) { if (![401, 403].includes(failure.status)) throw failure; } }
      const result = await routing.getOptions(actor); await actorNow();
      const types = Object.fromEntries(TYPES.map(type => { const option = result.types?.[type] || result.profiles?.[type === 'warranty' ? 'warranty' : 'a4'] || { available: false, printerId: '', label: '' }; return [type, { ...option, available: Boolean(option.available && permitted.includes(type)), ...(!permitted.includes(type) ? { reason: '当前员工未获此类单据打印操作权限' } : {}) }]; }));
      return { ...result, types, available: Object.values(types).some(value => value.available), sourceTypes: permitted, legacyLedgerConfigured: Boolean(legacyRetainedFile), stopped };
    });
  }
  return {
    submit, get, byRequest, list, options, getOptions: options,
    async withPaused(action) { if (typeof action !== 'function') throw new TypeError('Pause requires an action'); pauses++; try { if (active) await active; await serial; return await action(); } finally { pauses--; if (!stopped && !pauses && pending.length) setImmediate(kick); } },
    async drain() { if (!pauses && !stopped) kick(); while (active || !pauses && !stopped && pending.length) { if (active) await active; else { kick(); await new Promise(resolve => setImmediate(resolve)); } } await serial; },
    close() { if (!closing) { stopped = true; closing = (async () => { try { if (active) await active; await serialize(async () => { for (const id of pending.splice(0)) if (byId(id)?.status === 'queued') await publishAudit(transition(id, 'uncertain', '主机关闭前未确认打印；没有自动重打')); }); } finally { ledger.release(); } })(); } return closing; },
  };
}

module.exports = { createCentralPrintJobs, createLegacyPrintHistory, readCentralPrintHistory, publicPrintJob: publicJob, normalizeLegacy, CentralPrintError };

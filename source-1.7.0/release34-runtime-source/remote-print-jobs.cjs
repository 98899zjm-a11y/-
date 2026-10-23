'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { randomUUID, createHash } = require('node:crypto');
class PrintJobError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new PrintJobError(status, message); };
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const now = () => new Date().toISOString();
function record(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) fail(400, label + '格式无效或含不允许的字段');
  return value;
}
function text(value, length, label, fallback = '') {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || value.length > length || /[<>\x00-\x1f]/.test(value)) fail(400, label + '过长或包含不允许的内容');
  return value.trim();
}
function stable(value) { return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item); }
function inputRecord(value) {
  const input = record(value, ['requestId', 'quoteId', 'kind', 'printerId', 'copies', 'warranty'], '打印请求');
  if (!uuid(input.requestId) || !uuid(input.quoteId) || !['quotation-a4', 'warranty'].includes(input.kind) || typeof input.printerId !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(input.printerId) || !Number.isInteger(input.copies) || input.copies < 1 || input.copies > 3) fail(400, '打印编号、类型、打印机或份数无效');
  const result = { requestId: input.requestId, quoteId: input.quoteId, kind: input.kind, printerId: input.printerId, copies: input.copies };
  if (input.kind === 'quotation-a4') { if (input.warranty !== undefined) fail(400, 'A4报价打印不接受质保字段'); return result; }
  const warranty = record(input.warranty, ['itemIndexes', 'overrides'], '质保打印');
  if (!Array.isArray(warranty.itemIndexes) || !warranty.itemIndexes.length || warranty.itemIndexes.length > 30 || warranty.itemIndexes.some(index => !Number.isInteger(index) || index < 0 || index > 29) || new Set(warranty.itemIndexes).size !== warranty.itemIndexes.length) fail(400, '请选择有效且不重复的商品');
  const overrides = warranty.overrides ?? [];
  if (!Array.isArray(overrides) || overrides.length > 30) fail(400, '质保填写字段无效');
  const fields = overrides.map(value => {
    const item = record(value, ['itemIndex', 'goodsNumber', 'productName', 'phone', 'afterSalesWechat'], '质保填写字段');
    if (!Number.isInteger(item.itemIndex) || !warranty.itemIndexes.includes(item.itemIndex)) fail(400, '质保填写字段须对应已选商品');
    const result = { itemIndex: item.itemIndex };
    for (const [key, maximum] of [['goodsNumber', 60], ['productName', 100], ['phone', 50], ['afterSalesWechat', 50]]) if (item[key] !== undefined) result[key] = text(item[key], maximum, key);
    return result;
  });
  if (new Set(fields.map(item => item.itemIndex)).size !== fields.length) fail(400, '商品填写字段不得重复');
  result.warranty = { itemIndexes: [...warranty.itemIndexes], overrides: fields };
  if (Buffer.byteLength(stable(result)) > 20000) fail(400, '打印填写内容过多');
  return result;
}
function publicJob(row) { return { id: row.id, status: row.status, ...(row.error ? { error: row.error } : {}), createdAt: row.created_at, quoteId: row.quote_id, kind: row.kind }; }
function friendly(error, fallback) {
  const value = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return value && !/[A-Za-z]:[\\/]|\\\\|\/Users\/|\/home\/|\/private\//.test(value) ? value.replace(/[<>\x00-\x1f]/g, '').slice(0, 240) : fallback;
}
// This small, non-content ledger lives outside the business restore directory.
// Rolling back a quote backup must never roll back knowledge that paper was sent.
function createLedger(dataDir) {
  const file = path.resolve(dataDir) + '.print-ledger.json';
  let jobs = [];
  if (fs.existsSync(file)) {
    try {
      if (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) throw new Error();
      const source = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (source.version !== 1 || !Array.isArray(source.jobs) || source.jobs.length > 1000000) throw new Error();
      const keys = ['id', 'actorId', 'requestId', 'quoteId', 'kind', 'paramsHash', 'status', 'createdAt', 'updatedAt'];
      const ids = new Set(), requests = new Set();
      for (const job of source.jobs) {
        if (!job || Object.keys(job).some(key => !keys.includes(key)) || ![job.id, job.actorId, job.requestId, job.quoteId].every(uuid) || !['quotation-a4', 'warranty'].includes(job.kind) || !/^[a-f0-9]{64}$/.test(job.paramsHash) || !['queued', 'printing', 'submitted', 'failed', 'uncertain'].includes(job.status) || !Number.isFinite(Date.parse(job.createdAt)) || !Number.isFinite(Date.parse(job.updatedAt)) || ids.has(job.id) || requests.has(job.actorId + ':' + job.requestId)) throw new Error();
        ids.add(job.id); requests.add(job.actorId + ':' + job.requestId);
      }
      jobs = source.jobs;
    } catch { fail(503, '打印防重账本损坏；请在主机核对并恢复账本，暂不接受打印'); }
  }
  const hash = value => createHash('sha256').update(value).digest('hex');
  function save() {
    const temp = file + '.' + randomUUID() + '.tmp'; let handle;
    try {
      handle = fs.openSync(temp, 'wx', 0o600); fs.writeFileSync(handle, JSON.stringify({ version: 1, jobs })); fs.fsyncSync(handle); fs.closeSync(handle); handle = undefined; fs.renameSync(temp, file);
    } catch { if (handle !== undefined) fs.closeSync(handle); try { fs.unlinkSync(temp); } catch {} fail(503, '打印防重账本不能保存；请检查主机磁盘后重试'); }
  }
  return {
    byRequest: (actorId, requestId) => jobs.find(job => job.actorId === actorId && job.requestId === requestId),
    byId: id => jobs.find(job => job.id === id), hash,
    put(row) {
      const prior = jobs.find(job => job.id === row.id);
      const entry = { id: row.id, actorId: row.actor_id, requestId: row.request_id, quoteId: row.quote_id, kind: row.kind, paramsHash: hash(row.params_json), status: row.status, createdAt: row.created_at, updatedAt: row.updated_at };
      if (prior && (prior.paramsHash !== entry.paramsHash || prior.actorId !== entry.actorId)) fail(503, '打印防重账本记录冲突，请在主机核对');
      const previous = jobs; jobs = prior ? jobs.map(job => job.id === row.id ? entry : job) : [...jobs, entry];
      try { save(); } catch (error) { jobs = previous; throw error; }
    },
    recover() { if (jobs.some(job => ['queued', 'printing'].includes(job.status))) { jobs = jobs.map(job => ['queued', 'printing'].includes(job.status) ? { ...job, status: 'uncertain', updatedAt: now() } : job); save(); } },
  };
}
function publicLedger(job) { return { id: job.id, status: job.status, ...(job.status === 'uncertain' ? { error: '主机未能确认打印结果，请核对纸张后再决定' } : {}), createdAt: job.createdAt, quoteId: job.quoteId, kind: job.kind }; }

function createRemotePrintJobs({ runtime, core, adapter, enqueue, authorizeActor, printDomainPath = path.join(__dirname, 'generated', 'print-domain.cjs') }) {
  const db = runtime.sqlite, pending = [];
  let active = null, stopped = false, pauses = 0, domain = null, closing = null;
  const ledger = createLedger(runtime.dataDir);
  db.exec(`CREATE TABLE IF NOT EXISTS remote_print_jobs (
    id TEXT PRIMARY KEY NOT NULL,
    actor_id TEXT NOT NULL REFERENCES staff_users(id), actor_name TEXT NOT NULL,
    actor_password_hash TEXT NOT NULL, request_id TEXT NOT NULL,
    params_json TEXT NOT NULL, warranty_json TEXT,
    quote_id TEXT NOT NULL REFERENCES quotes(id), kind TEXT NOT NULL,
    copies INTEGER NOT NULL, printer_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN('queued','printing','submitted','failed','uncertain')),
    error TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE(actor_id,request_id)
  ); CREATE INDEX IF NOT EXISTS remote_print_jobs_owner_date ON remote_print_jobs(actor_id,created_at);`);
  db.prepare("UPDATE remote_print_jobs SET status='uncertain',error='主机在完成确认前关闭；请核对纸张后决定是否重新打印',updated_at=? WHERE status IN('queued','printing')").run(now());
  ledger.recover();
  for (const row of db.prepare('SELECT * FROM remote_print_jobs').all()) {
    const retained = ledger.byId(row.id);
    if (retained) {
      if (retained.paramsHash !== ledger.hash(row.params_json) || retained.actorId !== row.actor_id) fail(503, '打印记录与防重账本冲突，请在主机核对');
      db.prepare('UPDATE remote_print_jobs SET status=?,updated_at=? WHERE id=?').run(retained.status, retained.updatedAt, row.id);
    } else ledger.put(row);
  }
  const byId = id => db.prepare('SELECT * FROM remote_print_jobs WHERE id=?').get(id);
  const audit = (row, action, oldValue, newValue) => db.prepare('INSERT INTO audit_logs(id,entity_type,entity_id,action,actor_id,actor_name,old_value,new_value,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(randomUUID(), 'print-job', row.id, action, row.actor_id, row.actor_name, oldValue === null ? null : JSON.stringify(oldValue), JSON.stringify(newValue), now());
  function transition(id, status, error = '') {
    const row = byId(id); if (!row) return;
    db.exec('BEGIN IMMEDIATE');
    try { db.prepare('UPDATE remote_print_jobs SET status=?,error=?,updated_at=? WHERE id=?').run(status, error, now(), id); ledger.put(byId(id)); audit(row, 'print-' + status, publicJob(row), publicJob(byId(id))); db.exec('COMMIT'); }
    catch (failure) { db.exec('ROLLBACK'); throw failure; }
  }
  async function options() {
    if (!adapter || typeof adapter.getOptions !== 'function' || typeof adapter.print !== 'function') return { available: false, printers: [], defaultPrinterId: '', defaults: { phone: '', standard: '', afterSalesWechat: '' }, reason: '请在Windows主机配置Epson打印机' };
    let source;
    try { source = await adapter.getOptions(); } catch { return { available: false, printers: [], defaultPrinterId: '', defaults: { phone: '', standard: '', afterSalesWechat: '' }, reason: '主机打印机暂时不可读取，请在电脑检查' }; }
    const printers = Array.isArray(source?.printers) ? source.printers.filter(item => typeof item?.id === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(item.id)).map(item => ({ id: item.id, label: text(item.label, 120, '打印机名称') })) : [];
    const preference = await core.getWarrantyPreferences();
    const defaults = { phone: text(preference.inherited ? source?.defaults?.phone : preference.phone, 50, '默认电话'), standard: text(source?.defaults?.standard, 100, '执行标准'), afterSalesWechat: text(preference.inherited ? source?.defaults?.afterSalesWechat : preference.afterSalesWechat, 50, '售后微信') };
    return { available: Boolean(source?.available && printers.length), printers, defaultPrinterId: printers.some(item => item.id === source?.defaultPrinterId) ? source.defaultPrinterId : printers[0]?.id || '', defaults, ...(source?.reason ? { reason: friendly(source.reason, '请在主机检查打印机设置') } : {}) };
  }
  function warrantyDomain() { if (!domain) { try { domain = require(printDomainPath); } catch { fail(503, '主机质保模板模块尚未完成构建'); } } return domain; }
  function prepareWarranty(quote, input, defaults) {
    if (!['sale', 'custom', 'tradein'].includes(quote.type)) fail(400, '质保模板仅适用于销售、定制和以旧换新首饰');
    const api = warrantyDomain(), date = new Date(quote.createdAt).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
    const snapshot = imageFreeSnapshot(quote.snapshot);
    let sheets;
    try { sheets = api.createWarrantySheets(snapshot, defaults, { date }); } catch (error) { fail(400, friendly(error, '质保商品信息无效')); }
    const overrides = [];
    for (const itemIndex of input.itemIndexes) {
      if (!sheets[itemIndex]) fail(400, '所选商品不在此报价中');
      const supplied = input.overrides.find(item => item.itemIndex === itemIndex) || {};
      const data = { ...sheets[itemIndex].data };
      for (const key of ['goodsNumber', 'productName', 'phone', 'afterSalesWechat']) if (supplied[key] !== undefined) data[key] = supplied[key];
      try { api.validateWarrantyData(data); } catch (error) { fail(400, friendly(error, '请填写货品编号和执行标准')); }
      overrides.push({ itemIndex, goodsNumber: data.goodsNumber, productName: data.productName, phone: data.phone, afterSalesWechat: data.afterSalesWechat });
    }
    return { itemIndexes: [...input.itemIndexes], overrides };
  }
  function imageFreeSnapshot(input) {
    const snapshot = structuredClone(input); delete snapshot.customConfirmations; snapshot.image = ''; snapshot.images = [];
    for (const rows of [snapshot.saleItems, snapshot.tradeInItems, snapshot.recyclingItems, snapshot.paymentMethods]) for (const item of rows || []) item.image = '';
    return snapshot;
  }
  async function inlineImages(quote, kind) {
    const result = structuredClone(quote), snapshot = result.snapshot;
    delete snapshot.customConfirmations; delete result.customConfirmations;
    snapshot.images = []; result.images = [];
    if (kind === 'warranty') { result.snapshot = imageFreeSnapshot(snapshot); result.data = result.snapshot; return result; }
    const cache = new Map();
    async function picture(source) {
      if (!source || source.startsWith('data:')) return source || '';
      const match = /^\/api\/images\/([a-f0-9-]{36})$/.exec(source);
      if (!match) return source === '/ring.jpg' || source === '/home-necklace.png' ? source : '';
      if (!cache.has(source)) cache.set(source, (async () => { const response = await core.getImage(match[1]); if (!response.ok) fail(response.status, '报价图片不可读取'); const type = response.headers.get('content-type'); if (!['image/png', 'image/jpeg', 'image/webp'].includes(type)) fail(400, '报价图片格式无效'); return 'data:' + type + ';base64,' + Buffer.from(await response.arrayBuffer()).toString('base64'); })());
      return cache.get(source);
    }
    snapshot.image = await picture(snapshot.image);
    for (const rows of [snapshot.saleItems, snapshot.tradeInItems, snapshot.recyclingItems, snapshot.paymentMethods]) for (const item of rows || []) item.image = await picture(item.image);
    result.data = snapshot;
    return result;
  }
  function actorFor(row) {
    const actor = db.prepare('SELECT s.*,a.username,a.password_hash FROM staff_users s JOIN local_accounts a ON a.staff_id=s.id WHERE s.id=?').get(row.actor_id);
    if (!actor?.active || actor.password_hash !== row.actor_password_hash) fail(403, '账号已停用或密码已更改，此打印已取消');
    if (authorizeActor) authorizeActor(actor);
    return { userId: actor.user_id, email: actor.username, displayName: actor.name };
  }
  async function prepare(id) {
    const row = byId(id); if (!row || row.status !== 'queued') return null;
    const identity = actorFor(row);
    return runtime.withIdentity(identity, async () => {
      const quote = (await core.getQuote(row.quote_id)).quote, available = await options();
      if (!available.available || !available.printers.some(printer => printer.id === row.printer_id)) fail(503, available.reason || '所选主机打印机暂时不可用');
      const warranty = row.warranty_json ? JSON.parse(row.warranty_json) : undefined;
      if (warranty) prepareWarranty(quote, warranty, available.defaults);
      const payload = { jobId: row.id, kind: row.kind, copies: row.copies, printerId: row.printer_id, quote: await inlineImages(quote, row.kind), ...(warranty ? { warranty } : {}) };
      transition(id, 'printing');
      return payload;
    });
  }
  function kick() {
    if (active || stopped || pauses || !pending.length) return;
    active = (async () => {
      while (!stopped && !pauses && pending.length) {
        const id = pending.shift(); let payload;
        try { payload = await enqueue(() => prepare(id)); }
        catch (error) { await enqueue(() => transition(id, 'failed', friendly(error, '打印准备失败，请在主机检查'))); continue; }
        if (!payload) continue;
        let status = 'uncertain', error = '主机未能确认打印结果，请核对纸张';
        try {
          const result = await runtime.withIdentity(null, () => adapter.print(payload, {
            assertAuthorized: () => enqueue(async () => { const row = byId(id); const identity = actorFor(row); await runtime.withIdentity(identity, () => core.getQuote(row.quote_id)); }),
          }));
          if (['submitted', 'failed', 'uncertain'].includes(result?.status)) status = result.status;
          else if (result?.ok === true) status = 'submitted';
          if (status === 'submitted') error = '';
          else error = friendly(result?.error, status === 'failed' ? '打印未提交，请在主机检查打印机' : error);
        } catch (failure) { status = failure instanceof PrintJobError ? 'failed' : 'uncertain'; error = friendly(failure, '主机未能确认打印结果，请核对纸张'); }
        await enqueue(() => transition(id, status, error));
      }
    })().catch(() => {}).finally(() => { active = null; if (!stopped && !pauses && pending.length) setImmediate(kick); });
  }
  return {
    async getOptions() { await core.authenticated(); return options(); },
    async getWarrantyPreferences() { const preference = await core.getWarrantyPreferences(); if (!preference.inherited) return preference; const current = await options(); return { phone: current.defaults.phone, afterSalesWechat: current.defaults.afterSalesWechat, inherited: true }; },
    async submit(value) {
      if (stopped) fail(503, '主机正在关闭，暂不接受新打印');
      const { user } = await core.authenticated(), input = inputRecord(value), normalized = stable(input);
      const prior = db.prepare('SELECT * FROM remote_print_jobs WHERE actor_id=? AND request_id=?').get(user.id, input.requestId);
      const retained = ledger.byRequest(user.id, input.requestId);
      if (prior || retained) {
        if (retained ? retained.paramsHash !== ledger.hash(normalized) : prior.params_json !== normalized) fail(409, '此打印请求编号已用于不同参数，请先核对原任务');
        await core.getQuote(input.quoteId);
        return { job: prior ? publicJob(prior) : publicLedger(retained) };
      }
      const quote = (await core.getQuote(input.quoteId)).quote, available = await options();
      if (!available.available) fail(503, available.reason || '主机打印机不可用');
      if (!available.printers.some(printer => printer.id === input.printerId)) fail(400, '请使用主机开放的打印机');
      const preparedWarranty = input.warranty ? prepareWarranty(quote, input.warranty, available.defaults) : undefined;
      const count = db.prepare("SELECT COUNT(*) AS count FROM remote_print_jobs WHERE status IN('queued','printing')").get().count;
      if (count >= 20) fail(429, '主机打印队列已满，请稍后再试');
      const password = db.prepare('SELECT password_hash FROM local_accounts WHERE staff_id=?').get(user.id);
      if (!password) fail(403, '本机账号无效');
      const id = randomUUID(), time = now();
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare("INSERT INTO remote_print_jobs(id,actor_id,actor_name,actor_password_hash,request_id,params_json,warranty_json,quote_id,kind,copies,printer_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'queued',?,?)").run(id, user.id, user.name, password.password_hash, input.requestId, normalized, preparedWarranty ? JSON.stringify(preparedWarranty) : null, input.quoteId, input.kind, input.copies, input.printerId, time, time);
        ledger.put(byId(id));
        audit(byId(id), 'print-queued', null, publicJob(byId(id))); db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      pending.push(id); setImmediate(kick);
      return { job: publicJob(byId(id)) };
    },
    async get(id) { const { user } = await core.authenticated(); if (!uuid(id)) fail(404, '打印任务不存在'); const row = byId(id), retained = ledger.byId(id); if (!(row || retained) || user.role !== 'admin' && (row?.actor_id || retained.actorId) !== user.id) fail(404, '打印任务不存在或无权访问'); await core.getQuote(row?.quote_id || retained.quoteId); return { job: row ? publicJob(row) : publicLedger(retained) }; },
    async byRequest(requestId) { const { user } = await core.authenticated(); if (!uuid(requestId)) fail(404, '打印任务不存在'); const row = db.prepare('SELECT * FROM remote_print_jobs WHERE actor_id=? AND request_id=?').get(user.id, requestId), retained = ledger.byRequest(user.id, requestId); if (!(row || retained)) fail(404, '打印任务不存在'); await core.getQuote(row?.quote_id || retained.quoteId); return { job: row ? publicJob(row) : publicLedger(retained) }; },
    async withPaused(action) { pauses++; try { if (active) await active; return await action(); } finally { pauses--; if (!stopped && !pauses && pending.length) setImmediate(kick); } },
    close() { if (!closing) { stopped = true; closing = (async () => { if (active) await active; await enqueue(() => { for (const id of pending.splice(0)) transition(id, 'uncertain', '主机关闭前尚未完成确认；请核对后再打印'); }); })(); } return closing; },
  };
}

module.exports = { createRemotePrintJobs, PrintJobError };

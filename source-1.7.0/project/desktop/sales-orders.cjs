'use strict';

const { createHash, randomUUID } = require('node:crypto');
const requestKnowledge = require('./sales-request-knowledge.cjs');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const STATUSES = ['pending', 'approved', 'rejected', 'voided'];
const MAX = BigInt(Number.MAX_SAFE_INTEGER);
const SOURCE_LIMIT = 64 * 1024 * 1024;
const LIST_COLUMNS = 'id,number,owner_id,owner_name,created_by,created_name,source_quote_id,source_root_id,source_quote_version,source_hash,customer_id,customer_name,type,business_date,amount_cents,weight_micros,item_count,note,status,revision,content_hash,created_at,submitted_at,reviewed_by,reviewed_name,reviewed_at,review_note,voided_by,voided_name,voided_at,void_note,previous_id';
function fail(status, message) { throw Object.assign(new Error(message), { status }); }
function object(value, allowed, required = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).some(key => typeof key !== 'string' || !allowed.includes(key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')) || required.some(key => !Object.hasOwn(value, key))) fail(400, '销售开单参数格式无效');
  return value;
}
function identifier(value) { if (typeof value !== 'string' || !UUID.test(value)) fail(400, '销售开单编号格式无效'); return value; }
function text(value, maximum, required = false) { if (value === undefined && !required) return ''; if (typeof value !== 'string' || value.length > maximum || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value) || required && !value.trim()) fail(400, '销售开单文字内容无效'); return value.trim(); }
function day(value) { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '2000-01-01' || value > '2200-12-31' || !Number.isFinite(Date.parse(value + 'T00:00:00Z')) || new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value) fail(400, '销售开单业务日期无效'); return value; }
function sorted(value) { if (Array.isArray(value)) return value.map(sorted); if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])); return value; }
function canonical(value) { return JSON.stringify(sorted(value)); }
function digest(value) { return createHash('sha256').update(canonical(value)).digest('hex'); }
function rawJSON(value) { if (typeof value !== 'string' || Buffer.byteLength(value) > SOURCE_LIMIT) fail(409, '来源报价保存快照缺失或超过完整读取范围'); let parsed; try { parsed = JSON.parse(value); } catch { fail(409, '来源报价保存快照格式无效'); } if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail(409, '来源报价保存快照格式无效'); return parsed; }
// Convert the saved decimal representation to scaled integers. This validates
// precision; it never runs a price formula or supplies missing saved amounts.
function scaled(value, digits, signed = false, status = 409) {
  if (typeof value !== 'number' || !Number.isFinite(value) || !signed && value < 0) fail(status, '保存金额或重量无效，不能按当前规则重算');
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(value));
  if (!match || (match[3] || '').length > digits) fail(status, '保存金额或重量超出支持精度');
  const result = (match[1] ? -1n : 1n) * BigInt(match[2] + (match[3] || '').padEnd(digits, '0'));
  if (result < -MAX || result > MAX) fail(status, '保存金额或重量超过安全范围');
  return result;
}
function storedInteger(value) { if (!Number.isSafeInteger(value)) fail(409, '保存报价整数金额超过安全范围'); return BigInt(value); }
function safeNumber(value, digits) { if (value < -MAX || value > MAX) fail(413, '销售开单汇总超过安全范围，请缩小月份或员工范围'); const result = Number(value) / 10 ** digits; if (scaled(result, digits, true, 413) !== value) fail(413, '销售开单汇总超过可准确显示的精度'); return result; }
function quantity(value) { if (!Number.isSafeInteger(value) || value < 1 || value > 1000000) fail(409, '来源报价件数不完整或无效'); return value; }
function validateSavedSource(row) {
  const snapshot = rawJSON(row.snapshot), totals = rawJSON(row.totals), calculation = snapshot.calculation;
  if (!calculation || typeof calculation !== 'object' || Array.isArray(calculation) || snapshot.type !== row.type || snapshot.customerId !== row.customer_id || canonical(calculation) !== canonical(totals)) fail(409, '来源报价的已保存计算快照缺失或不一致，不能重新计价');
  const required = ['metal', 'labor', 'extras', 'subtotal', 'discount', 'total', ...(row.type === 'tradein' ? ['exchangeCredit'] : [])];
  const amounts = {};
  for (const key of required) amounts[key] = scaled(calculation[key], 2, row.type === 'tradein' && key === 'total');
  for (const key of ['repair', 'insurance', 'depreciation', 'exchangeCredit', 'balance']) if (calculation[key] !== undefined) scaled(calculation[key], 2, row.type === 'tradein' && key === 'balance');
  if (amounts.discount > amounts.subtotal || amounts.subtotal - amounts.discount - (row.type === 'tradein' ? amounts.exchangeCredit : 0n) !== amounts.total || calculation.balance !== undefined && scaled(calculation.balance, 2, row.type === 'tradein') !== amounts.total || amounts.total !== storedInteger(row.total_cents)) fail(409, '来源报价保存合计不一致，未开单');
  const products = row.type === 'sale' ? snapshot.saleItems : row.type === 'tradein' ? snapshot.tradeInItems : null;
  if (products !== undefined && products !== null && !Array.isArray(products)) fail(409, '来源报价商品明细格式无效');
  const items = products?.length ? products : [{ id: 'single', weight: snapshot.weight, quantity: 1 }];
  if (items.length > 30) fail(409, '来源报价商品明细超过完整读取范围');
  const rows = calculation.itemTotals;
  if (rows !== undefined && !Array.isArray(rows)) fail(409, '来源报价商品金额明细格式无效');
  if (products?.length && (!rows || rows.length !== products.length)) fail(409, '来源报价商品逐项金额快照不完整，不能按现价补算');
  let weightMicros = 0n, itemCount = 0n, lineSum = 0n; const ids = new Set();
  for (const item of items) {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id || ids.has(item.id)) fail(409, '来源报价商品明细标识无效'); ids.add(item.id);
    const count = quantity(item.quantity), weight = scaled(item.weight, 6);
    if (weight <= 0n) fail(409, '来源报价商品重量无效');
    itemCount += BigInt(count); weightMicros += weight * BigInt(count);
    if (products?.length) {
      const matches = rows.filter(entry => entry?.id === item.id); if (matches.length !== 1) fail(409, '来源报价商品金额标识不一致'); const saved = matches[0];
      for (const key of ['metal', 'labor', 'extras', 'subtotal']) scaled(saved[key], 2);
      if (saved.total !== undefined) scaled(saved.total, 2);
      if (saved.quantity !== count || scaled(saved.weight, 6) !== weight) fail(409, '来源报价商品数量或重量快照不一致');
      lineSum += scaled(saved.subtotal, 2);
    }
  }
  if (products?.length && lineSum !== amounts.subtotal) fail(409, '来源报价逐项金额与保存合计不一致');
  if (weightMicros > MAX || itemCount > MAX) fail(409, '来源报价商品合计超过安全范围');
  safeNumber(amounts.total, 2); safeNumber(weightMicros, 6);
  return { snapshot, totals, amountCents: amounts.total.toString(), weightMicros: weightMicros.toString(), itemCount: Number(itemCount) };
}

function createSalesOrders({ runtime, administration, clock = Date.now } = {}) {
  if (!runtime?.sqlite?.prepare || !runtime.sqlite.exec || typeof administration?.requireAccess !== 'function' || typeof administration.requireCapability !== 'function' || typeof administration.requireAdmin !== 'function') throw new TypeError('Sales orders require the existing central database and administration');
  const db = runtime.sqlite;
  const now = () => { const value = new Date(clock()); if (!Number.isFinite(value.getTime())) throw new TypeError('Invalid sales order clock'); return value.toISOString(); };
  function transaction(action) { db.exec('BEGIN IMMEDIATE'); try { const result = action(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } }
  function live(actor) { if (!actor || typeof actor.id !== 'string') fail(401, '请先登录账号'); const row = db.prepare('SELECT id,name,role,active FROM staff_users WHERE id=?').get(actor.id); if (!row?.active) fail(401, '账号已停用，请重新登录'); return { ...actor, id: row.id, name: row.name, role: row.role, active: true }; }
  function sales(actor, write = false) { const user = live(actor); administration.requireAccess(user, 'sales', write ? 'operate' : 'view'); return user; }
  function finance(actor, write = false) { const user = live(actor); administration.requireCapability(user, 'sales.orders.review', { readOnly: !write }); administration.requireAccess(user, 'ledger', write ? 'manage' : 'view'); return user; }
  function personal(actor) { const user = live(actor); administration.requireCapability(user, 'personal.sales.view'); return user; }
  function byId(id) { const row = db.prepare('SELECT * FROM sales_orders WHERE id=?').get(identifier(id)); if (!row) fail(404, '销售开单记录不存在或无权访问'); return row; }
  function owned(user, row) { if (user.role !== 'admin' && row.owner_id !== user.id) fail(404, '销售开单记录不存在或无权访问'); return row; }
  function publicOrder(row, full = true) {
    return { id: row.id, number: row.number, ownerId: row.owner_id, ownerName: row.owner_name, createdBy: row.created_by, createdName: row.created_name, sourceQuoteId: row.source_quote_id, sourceRootId: row.source_root_id, sourceQuoteVersion: row.source_quote_version, sourceHash: row.source_hash, customerId: row.customer_id, customerName: row.customer_name, type: row.type, businessDate: row.business_date, date: row.business_date, amountCents: row.amount_cents, amount: safeNumber(BigInt(row.amount_cents), 2), weightMicros: row.weight_micros, weight: safeNumber(BigInt(row.weight_micros), 6), itemCount: row.item_count, note: row.note, status: row.status, revision: row.revision, contentHash: row.content_hash, createdAt: row.created_at, submittedAt: row.submitted_at, reviewedBy: row.reviewed_by || null, reviewedName: row.reviewed_name || null, reviewedAt: row.reviewed_at || null, reviewNote: row.review_note, voidedBy: row.voided_by || null, voidedName: row.voided_name || null, voidedAt: row.voided_at || null, voidNote: row.void_note, previousId: row.previous_id || null, ...(full ? { snapshot: rawJSON(row.snapshot_json), totals: rawJSON(row.totals_json) } : {}) };
  }
  function event(user, row, action, previous, requestId, requestHash, note, time) { db.prepare('INSERT INTO sales_order_events(id,order_id,actor_id,actor_name,action,from_status,to_status,revision,content_hash,request_id,request_hash,note,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), row.id, user.id, user.name, action, previous, row.status, row.revision, row.content_hash, requestId, requestHash, note, time); }
  function events(row) { return db.prepare('SELECT id,actor_id,actor_name,action,from_status,to_status,revision,content_hash,note,created_at FROM sales_order_events WHERE order_id=? ORDER BY revision,created_at,id').all(row.id).map(entry => ({ id: entry.id, actorId: entry.actor_id, actorName: entry.actor_name, action: entry.action, fromStatus: entry.from_status, toStatus: entry.to_status, revision: entry.revision, contentHash: entry.content_hash, note: entry.note, createdAt: entry.created_at })); }
  function requestResult(requestId, known) {
    if (known.fact.state === 'cancelled') return { request: { id: requestId, state: 'cancelled', cancelledAt: known.fact.cancelled_at }, order: null };
    if (known.order) return { request: { id: requestId, state: 'issued' }, order: publicOrder(known.order) };
    return { request: { id: requestId, state: 'restored' }, order: null, receipt: requestKnowledge.receipt(known.fact) };
  }
  function getRequest(actor, requestId) {
    const user = sales(actor), known = requestKnowledge.request(db, user.id, identifier(requestId));
    if (!known) fail(404, '该开单请求不存在');
    return requestResult(requestId, known);
  }
  function cancelRequest(actor, requestId, body) {
    identifier(requestId); object(body, []); const user = sales(actor, true);
    return transaction(() => {
      const current = sales(user, true), known = requestKnowledge.request(db, current.id, requestId, { persistLegacy: true });
      if (known) return requestResult(requestId, known);
      if (db.prepare('SELECT 1 FROM sales_order_events WHERE actor_id=? AND request_id=?').get(current.id, requestId)) fail(409, '此请求编号已用于另一销售开单操作');
      const fact = requestKnowledge.recordCancelled(db, current.id, requestId, now());
      return requestResult(requestId, { fact, order: null });
    });
  }
  function source(user, quoteId) {
    const row = db.prepare('SELECT * FROM quotes WHERE id=? AND deleted_at IS NULL').get(quoteId);
    if (!row || user.role !== 'admin' && row.owner_id !== user.id) fail(404, '来源报价不存在或无权开单');
    if (!['sale', 'custom', 'tradein'].includes(row.type)) fail(400, '只可为销售、定制或以旧换新开单');
    const customer = db.prepare('SELECT id,owner_id FROM customers WHERE id=? AND deleted_at IS NULL').get(row.customer_id);
    if (!customer || user.role !== 'admin' && customer.owner_id !== user.id && !db.prepare('SELECT 1 FROM customer_collaborators WHERE customer_id=? AND staff_id=? AND active=1').get(customer.id, user.id)) fail(404, '客户不存在或未获当前协作授权');
    const latest = db.prepare('SELECT id FROM quotes WHERE root_id=? AND deleted_at IS NULL ORDER BY version DESC,created_at DESC,id DESC LIMIT 1').get(row.root_id);
    if (latest?.id !== row.id) fail(409, '来源报价已有新版本，请核对最新报价后开单');
    if (!Number.isSafeInteger(row.version) || row.version < 1 || !UUID.test(row.root_id)) fail(409, '来源报价版本信息不完整');
    return { row, ...validateSavedSource(row) };
  }
  function create(actor, body) {
    const user = sales(actor, true), value = object(body, ['requestId', 'quoteId', 'businessDate', 'note', 'salesStaffId'], ['requestId', 'quoteId', 'businessDate']);
    const input = { requestId: identifier(value.requestId), quoteId: identifier(value.quoteId), businessDate: day(value.businessDate), note: text(value.note, 2000), salesStaffId: Object.hasOwn(value, 'salesStaffId') ? identifier(value.salesStaffId) : user.id }, requestHash = digest({ action: 'create', ...input });
    return transaction(() => {
      const current = sales(user, true);
      if (current.role !== 'admin' && input.salesStaffId !== current.id) fail(403, '只能为本人开具销售单，其他销售归属须由管理员指定');
      const prior = requestKnowledge.request(db, current.id, input.requestId, { persistLegacy: true });
      if (prior) {
        if (prior.fact.state === 'cancelled') fail(409, '此开单请求已确认取消，请显式发起新的开单意图');
        if (prior.fact.request_hash !== requestHash) fail(409, '此开单请求编号已用于不同内容，请核对原单');
        if (!prior.order) fail(409, '此请求曾经开单但已随业务恢复回退，不能自动重建原单');
        return { ...requestResult(input.requestId, prior), duplicate: true };
      }
      if (db.prepare('SELECT 1 FROM sales_order_events WHERE actor_id=? AND request_id=?').get(current.id, input.requestId)) fail(409, '此请求编号已用于另一销售开单操作');
      const owner = db.prepare('SELECT id,name,active FROM staff_users WHERE id=?').get(input.salesStaffId);
      if (!owner?.active) fail(400, '请选择当前启用的所属销售员工');
      const saved = source(current, input.quoteId), q = saved.row;
      if (db.prepare("SELECT id FROM sales_orders WHERE source_root_id=? AND status IN('pending','approved')").get(q.root_id)) fail(409, '该业务已有有效销售开单，请核对原单');
      const time = now(), id = randomUUID(), sourceHash = digest({ quoteId: q.id, rootId: q.root_id, version: q.version, snapshot: saved.snapshot, totals: saved.totals, amountCents: saved.amountCents });
      const contentHash = digest({ id, ownerId: owner.id, sourceHash, businessDate: input.businessDate, note: input.note, amountCents: saved.amountCents, weightMicros: saved.weightMicros, itemCount: saved.itemCount });
      const number = requestKnowledge.allocateNumber(db, input.businessDate);
      const previous = db.prepare('SELECT id FROM sales_orders WHERE source_root_id=? ORDER BY submitted_at DESC,id DESC LIMIT 1').get(q.root_id);
      db.prepare("INSERT INTO sales_orders(id,number,owner_id,owner_name,created_by,created_name,source_quote_id,source_root_id,source_quote_version,source_hash,customer_id,customer_name,type,business_date,snapshot_json,totals_json,amount_cents,weight_micros,item_count,note,status,revision,content_hash,request_id,request_hash,created_at,submitted_at,previous_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',1,?,?,?,?,?,?)").run(id, number, owner.id, owner.name, current.id, current.name, q.id, q.root_id, q.version, sourceHash, q.customer_id, q.customer_name, q.type, input.businessDate, canonical(saved.snapshot), canonical(saved.totals), saved.amountCents, saved.weightMicros, saved.itemCount, input.note, contentHash, input.requestId, requestHash, time, time, previous?.id || null);
      const row = byId(id); event(current, row, 'create', null, input.requestId, requestHash, input.note, time);
      requestKnowledge.recordIssued(db, row);
      return { order: publicOrder(row), duplicate: false, request: { id: input.requestId, state: 'issued' } };
    });
  }
  function actionInput(body, kind, orderId) {
    const input = object(body, ['requestId', 'revision', 'contentHash', ...(kind === 'review' ? ['decision'] : []), 'note'], ['requestId', 'revision', 'contentHash', 'note', ...(kind === 'review' ? ['decision'] : [])]);
    if (!Number.isSafeInteger(input.revision) || input.revision < 1 || typeof input.contentHash !== 'string' || !HASH.test(input.contentHash) || kind === 'review' && !['approve', 'reject'].includes(input.decision)) fail(400, '请提供销售单当前版本、内容及审核决定');
    const value = { requestId: identifier(input.requestId), revision: input.revision, contentHash: input.contentHash, note: text(input.note, 2000, true), ...(kind === 'review' ? { decision: input.decision } : {}) };
    return { value, requestHash: digest({ kind, orderId, ...value }) };
  }
  function change(actor, id, body, kind) {
    identifier(id); const user = kind === 'review' ? finance(actor, true) : sales(actor, true), { value, requestHash } = actionInput(body, kind, id);
    return transaction(() => {
      const current = kind === 'review' ? finance(user, true) : sales(user, true), row = byId(id);
      if (kind === 'review' && (row.created_by === current.id || row.owner_id === current.id)) fail(403, '不能审核自己开具或归属本人的销售单，请另一位获授权财务人员核对');
      if (kind === 'void') { owned(current, row); if (row.status === 'approved') administration.requireAdmin(current); }
      if (requestKnowledge.request(db, current.id, value.requestId)) fail(409, '此请求编号已用于开单或取消请求');
      const prior = db.prepare('SELECT order_id,request_hash FROM sales_order_events WHERE actor_id=? AND request_id=?').get(current.id, value.requestId);
      if (prior) { if (prior.order_id !== id || prior.request_hash !== requestHash) fail(409, '此请求编号已用于不同操作或内容'); return { order: publicOrder(row), duplicate: true }; }
      if (row.revision !== value.revision || row.content_hash !== value.contentHash || kind === 'review' && row.status !== 'pending' || kind === 'void' && row.status === 'voided') fail(409, '销售单状态、版本或内容已变化，请刷新后核对');
      const next = kind === 'review' ? value.decision === 'approve' ? 'approved' : 'rejected' : 'voided', time = now();
      const result = kind === 'review'
        ? db.prepare('UPDATE sales_orders SET status=?,revision=revision+1,reviewed_by=?,reviewed_name=?,reviewed_at=?,review_note=? WHERE id=? AND revision=? AND status=? AND content_hash=?').run(next, current.id, current.name, time, value.note, id, value.revision, 'pending', value.contentHash)
        : db.prepare('UPDATE sales_orders SET status=?,revision=revision+1,voided_by=?,voided_name=?,voided_at=?,void_note=? WHERE id=? AND revision=? AND status=? AND content_hash=?').run(next, current.id, current.name, time, value.note, id, value.revision, row.status, value.contentHash);
      if (Number(result.changes) !== 1) fail(409, '销售单刚被处理，请刷新后核对');
      const updated = byId(id); event(current, updated, kind === 'review' ? value.decision : 'void', row.status, value.requestId, requestHash, value.note, time);
      return { order: publicOrder(updated), duplicate: false };
    });
  }
  function metrics(rows) {
    let amount = 0n, weight = 0n, count = 0n;
    for (const row of rows) { amount += BigInt(row.amount_cents); weight += BigInt(row.weight_micros); count += BigInt(row.item_count); }
    return { orderCount: rows.length, itemCount: safeNumber(count, 0), amountCents: amount.toString(), amount: safeNumber(amount, 2), weightMicros: weight.toString(), weight: safeNumber(weight, 6) };
  }
  function summary(rows) { return Object.fromEntries([...STATUSES.map(status => [status, metrics(rows.filter(row => row.status === status))]), ['effective', metrics(rows.filter(row => row.status === 'pending' || row.status === 'approved'))]]); }
  function filters(parameters, user) {
    const allowed = ['month', 'staffId', 'status', 'page', 'pageSize'], seen = new Set();
    for (const [key] of parameters) { if (!allowed.includes(key) || seen.has(key)) fail(400, '销售开单查询参数无效'); seen.add(key); }
    const month = parameters.get('month') || new Date(Date.parse(now()) + 8 * 3600000).toISOString().slice(0, 7);
    if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month) || month < '2000-01' || month > '2200-12') fail(400, '销售月份无效');
    const [year, numericMonth] = month.split('-').map(Number), from = month + '-01', to = new Date(Date.UTC(year, numericMonth, 0)).toISOString().slice(0, 10);
    const page = Number(parameters.get('page') || 1), pageSize = Number(parameters.get('pageSize') || 30), status = parameters.get('status') || '';
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100 || status && !STATUSES.includes(status) && status !== 'effective') fail(400, '销售开单分页或状态无效');
    const selected = parameters.get('staffId') || '';
    if (selected) identifier(selected);
    if (user.role !== 'admin' && selected && selected !== user.id) fail(403, '只能查看本人的销售开单');
    return { month, from, to, page, pageSize, status, staffId: selected || (user.role === 'admin' ? '' : user.id) };
  }
  function list(actor, parameters, mode) {
    const user = mode === 'finance' ? finance(actor) : mode === 'personal' ? personal(actor) : sales(actor);
    // Financial reviewers can see their authorized queue across all sellers;
    // their ability to review never grants ordinary sales access.
    const filterUser = mode === 'finance' ? { ...user, role: 'admin' } : user, filter = filters(parameters, filterUser);
    if (filter.staffId && !db.prepare('SELECT id FROM staff_users WHERE id=?').get(filter.staffId)) fail(404, '员工不存在');
    const conditions = ['business_date>=?', 'business_date<=?'], args = [filter.from, filter.to];
    if (filter.staffId) { conditions.push('owner_id=?'); args.push(filter.staffId); }
    if (filter.status === 'effective') conditions.push("status IN('pending','approved')"); else if (filter.status) { conditions.push('status=?'); args.push(filter.status); }
    const rows = db.prepare('SELECT ' + LIST_COLUMNS + ' FROM sales_orders WHERE ' + conditions.join(' AND ') + ' ORDER BY submitted_at DESC,id DESC LIMIT 100001').all(...args);
    if (rows.length > 100000) fail(413, '开单记录超过完整查询范围，请缩小员工或月份范围');
    const byDay = new Map(), byStaff = new Map();
    for (const row of rows) { if (!byDay.has(row.business_date)) byDay.set(row.business_date, []); byDay.get(row.business_date).push(row); if (!byStaff.has(row.owner_id)) byStaff.set(row.owner_id, []); byStaff.get(row.owner_id).push(row); }
    const series = [];
    for (let date = Date.parse(filter.from + 'T00:00:00Z'); date <= Date.parse(filter.to + 'T00:00:00Z'); date += 86400000) { const key = new Date(date).toISOString().slice(0, 10), values = summary(byDay.get(key) || []); series.push({ date: key, ...values.effective, ...values }); }
    return { source: 'sales-orders', sourceNote: '销售开单的保存金额与业务日期；待审核和已审核分开，退回与作废不计有效成交。金额不代表实际收款或自动财务记账。', asOf: now(), month: filter.month, staffId: filter.staffId || null, status: filter.status || null, summary: summary(rows), series, byStaff: [...byStaff].map(([staffId, entries]) => { const values = summary(entries); return { staffId, name: entries[0].owner_name, ...values.effective, ...values }; }), orders: rows.slice((filter.page - 1) * filter.pageSize, filter.page * filter.pageSize).map(row => publicOrder(row, false)), total: rows.length, page: filter.page, pageSize: filter.pageSize, staffOptions: user.role === 'admin' || mode === 'finance' ? db.prepare('SELECT id,name,active FROM staff_users ORDER BY name,id').all().map(row => ({ staffId: row.id, id: row.id, name: row.name, active: Boolean(row.active) })) : [] };
  }
  function handle(actor, input) {
    object(input, ['path', 'method', 'body'], ['path']);
    if (typeof input.path !== 'string' || input.path.length > 8192 || !input.path.startsWith('/') || /[\\\x00-\x20\x7f#]/.test(input.path)) fail(400, '销售开单地址须为规范相对地址');
    const address = new URL(input.path, 'http://offline.invalid'); if (address.origin !== 'http://offline.invalid' || address.pathname + address.search !== input.path || address.pathname.includes('%') || address.pathname.includes('//')) fail(400, '销售开单地址格式无效');
    const method = input.method || 'GET', pathname = address.pathname;
    if (!['GET', 'POST'].includes(method) || method === 'GET' && input.body !== undefined || method === 'POST' && address.search) fail(400, '销售开单请求方法或参数无效');
    let data, status = 200, match;
    if (pathname === '/api/sales-orders' && method === 'POST') { data = create(actor, input.body); status = data.duplicate ? 200 : 201; }
    else if (method === 'GET' && ['/api/sales-orders', '/api/finance/sales-orders', '/api/collaboration/personal-sales-orders'].includes(pathname)) data = list(actor, address.searchParams, pathname.includes('/finance/') ? 'finance' : pathname.includes('/collaboration/') ? 'personal' : 'sales');
    else if (method === 'GET' && (match = /^\/api\/sales-orders\/by-request\/([a-f0-9-]{36})$/.exec(pathname))) { if (address.search) fail(400, '开单请求恢复不接受查询参数'); data = getRequest(actor, match[1]); }
    else if (method === 'POST' && (match = /^\/api\/sales-orders\/by-request\/([a-f0-9-]{36})\/cancel$/.exec(pathname))) data = cancelRequest(actor, match[1], input.body);
    else if (method === 'GET' && (match = /^\/api\/(finance\/)?sales-orders\/([a-f0-9-]{36})$/.exec(pathname))) { if (address.search) fail(400, '开单详情不接受查询参数'); const user = match[1] ? finance(actor) : sales(actor), row = byId(match[2]); if (!match[1]) owned(user, row); data = { order: publicOrder(row), events: events(row) }; }
    else if (method === 'POST' && (match = /^\/api\/finance\/sales-orders\/([a-f0-9-]{36})\/review$/.exec(pathname))) data = change(actor, match[1], input.body, 'review');
    else if (method === 'POST' && (match = /^\/api\/sales-orders\/([a-f0-9-]{36})\/void$/.exec(pathname))) data = change(actor, match[1], input.body, 'void');
    else fail(404, '销售开单操作不存在');
    return { ok: true, status, data };
  }
  return { handle, getOrderForPrint(actor, id) { const user = sales(actor, true), row = owned(user, byId(id)); if (!['pending', 'approved'].includes(row.status)) fail(409, '退回或作废销售单不能新建质保打印任务'); return { order: publicOrder(row) }; } };
}
module.exports = { createSalesOrders };

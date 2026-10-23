'use strict';
const { createHash } = require('node:crypto');

class PrintSourceError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new PrintSourceError(status, message); };
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const JSON_LIMIT = 20 * 1024 * 1024;
const BINARY_LIMIT = 64 * 1024 * 1024;
const TYPES = ['warranty', 'quotation-a4', 'erp-document-a4', 'erp-report-a4', 'ledger-report-a4', 'inventory-count-a4', 'inventory-report-a4', 'inventory-metal-a4'];
// These are the original reports.py query options, not another report algorithm.
const METRICS = {
  sales: ['count', 'amount', 'received', 'cost', 'profit', 'commission', 'commission_profit', 'grams'],
  stock: ['count', 'grams', 'cost', 'transit_count', 'transit_grams', 'unknown_count'],
  material: ['count', 'grams', 'amount'], payroll: ['count', 'gross', 'deduction', 'net', 'payment'],
  expenses: ['count', 'amount', 'paid', 'pending'],
  platinum: ['fine_grams', 'pt950_grams', 'board_grams', 'transit_fine', 'unknown_grams'],
};
const GROUPS = {
  sales: ['staff', 'channel', 'template', 'status'], stock: ['supplier', 'category', 'inventory_state'],
  material: ['supplier'], payroll: ['employee', 'status'], expenses: ['employee', 'category', 'status', 'payout'],
  platinum: ['supplier', 'category', 'platinum_bucket'],
};
const DOMAINS = Object.keys(METRICS);
const SAFE_DEFAULTS = { sales: ['count', 'amount', 'received', 'grams'], stock: ['count', 'grams'], material: ['count', 'grams'], payroll: ['count'], expenses: ['count'], platinum: ['fine_grams'] };
const LEDGER_KEYS = ['configured', 'title', 'all_time', 'start', 'end', 'domain', 'details', 'sales_scope', 'payroll_scope', 'expense_scope', ...DOMAINS.flatMap(domain => [domain + '_metric', domain + '_group'])];
const ERP_KEYS = ['asOf', 'from', 'to', 'partyId', 'kind', 'status', 'creatorId'];
const ERP_KINDS = ['purchase', 'receipt', 'receivable', 'payable', 'opening_receivable', 'opening_payable', 'settlement', 'reversal'];
const DOCUMENT_KINDS = ERP_KINDS.filter(kind => kind !== 'payable');

function record(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).some(key => typeof key !== 'string' || !keys.includes(key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))) fail(400, '打印来源含无效或未允许的字段');
  return value;
}
function identifier(value) { if (typeof value !== 'string' || !UUID.test(value)) fail(400, '打印来源编号无效'); return value; }
function choice(value, values, fallback) { if (value === undefined) return fallback; if (typeof value !== 'string' || !values.includes(value)) fail(400, '打印来源筛选值无效'); return value; }
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '0001-01-01' || !Number.isFinite(Date.parse(value + 'T00:00:00Z')) || new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value) fail(400, '打印来源日期无效');
  return value;
}
function list(value, allowed, fallback = []) {
  if (value === undefined) return [...fallback];
  if (!Array.isArray(value) || value.length > allowed.length || new Set(value).size !== value.length || value.some(item => typeof item !== 'string' || !allowed.includes(item))) fail(400, '打印来源多选参数无效或重复');
  return allowed.filter(item => value.includes(item));
}
function ledgerFilters(value = {}) {
  const input = record(value, LEDGER_KEYS);
  if (input.configured !== undefined && input.configured !== '1') fail(400, '经营汇报必须使用完整配置');
  const title = input.title ?? '鑫金源珠宝经营汇报';
  if (typeof title !== 'string' || title.length > 60 || /[\x00-\x1f\x7f]/.test(title)) fail(400, '汇报标题无效');
  const result = { configured: '1', title: title.trim() || '鑫金源珠宝经营汇报', all_time: choice(input.all_time, ['0', '1'], '0') };
  if (input.start !== undefined || input.end !== undefined) {
    if (result.all_time === '1' && input.start === '' && input.end === '') { result.start = ''; result.end = ''; }
    else { result.start = date(input.start); result.end = date(input.end); if (result.start > result.end) fail(400, '汇报开始日期晚于结束日期'); }
  }
  result.domain = list(input.domain, DOMAINS, ['sales']);
  if (!result.domain.length) fail(400, '经营汇报至少需要一个类目');
  result.details = list(input.details, DOMAINS);
  if (result.details.some(domain => !result.domain.includes(domain))) fail(400, '经营汇报明细必须属于所选类目');
  result.sales_scope = choice(input.sales_scope, ['completed', 'all'], 'completed');
  result.payroll_scope = choice(input.payroll_scope, ['confirmed', 'all'], 'confirmed');
  result.expense_scope = choice(input.expense_scope, ['approved', 'all'], 'approved');
  for (const domain of DOMAINS) {
    const active = result.domain.includes(domain);
    result[domain + '_metric'] = list(input[domain + '_metric'], METRICS[domain], active ? SAFE_DEFAULTS[domain] : []);
    result[domain + '_group'] = list(input[domain + '_group'], GROUPS[domain]);
    if (active && !result[domain + '_metric'].length) fail(400, '所选汇报类目必须有指标');
    if (!active && (result[domain + '_metric'].length || result[domain + '_group'].length)) fail(400, '未选择的类目不能设置指标或分组');
  }
  return result;
}
function erpFilters(value = {}) {
  const input = record(value, ERP_KEYS), result = {};
  for (const [key, item] of Object.entries(input)) {
    if (typeof item !== 'string' || item.length > 300 || /[\x00-\x1f\x7f]/.test(item)) fail(400, 'ERP汇报筛选无效');
    if (item === '') continue;
    if (['asOf', 'from', 'to'].includes(key)) result[key] = date(item);
    else if (key === 'kind') result[key] = choice(item, ERP_KINDS);
    else if (key === 'status') result[key] = choice(item, ['draft', 'pending', 'confirmed', 'rejected', 'reversed']);
    else if (key === 'partyId') {
      if (!/^SUP:[1-9][0-9]{0,18}$/.test(item) && !(item.startsWith('CUS:') && UUID.test(item.slice(4)))) fail(400, 'ERP往来单位标识无效');
      result[key] = item;
    } else if (key === 'creatorId') { if (!/^[A-Za-z0-9_-]{1,100}$/.test(item)) fail(400, 'ERP制单人标识无效'); result[key] = item; }
  }
  if (result.from && (result.to && result.from > result.to || result.asOf && result.from > result.asOf)) fail(400, 'ERP报表日期范围无效');
  return result;
}
function normalizePrintSource(value) {
  record(value, ['type', 'quoteId', 'id', 'filters', 'filter', 'sort', 'blind', 'mode', 'range']);
  if (!TYPES.includes(value.type)) fail(400, '打印来源类型无效');
  let keys, result;
  if (['warranty', 'quotation-a4'].includes(value.type)) { keys = ['type', 'quoteId']; result = { type: value.type, quoteId: identifier(value.quoteId) }; }
  else if (value.type === 'erp-document-a4') { keys = ['type', 'id']; result = { type: value.type, id: identifier(value.id) }; }
  else if (value.type === 'erp-report-a4' || value.type === 'ledger-report-a4') { keys = ['type', 'filters']; result = { type: value.type, filters: value.type === 'erp-report-a4' ? erpFilters(value.filters) : ledgerFilters(value.filters) }; }
  else if (value.type === 'inventory-count-a4') {
    keys = ['type', 'id', 'filter', 'sort', 'blind', 'mode'];
    if (!Number.isSafeInteger(value.id) || value.id < 1) fail(400, '盘点来源编号无效');
    result = { type: value.type, id: value.id, filter: choice(value.filter, ['all', 'uncounted', 'counted', 'diff'], 'all'), sort: choice(value.sort, ['location', 'code'], 'location'), blind: choice(value.blind, ['0', '1'], '0'), mode: choice(value.mode, ['blank', 'filled'], 'filled') };
  } else if (value.type === 'inventory-report-a4') { keys = ['type', 'range']; result = { type: value.type, range: choice(value.range, ['30', '90', '365', 'all'], '30') }; }
  else { keys = ['type']; result = { type: value.type }; }
  record(value, keys);
  return result;
}
function canonical(value) {
  const ancestors = new Set(); let count = 0;
  function visit(item, depth) {
    if (++count > 2000000 || depth > 80) fail(413, '打印单据结构超过支持范围');
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number') { if (!Number.isFinite(item) || Number.isInteger(item) && !Number.isSafeInteger(item)) fail(502, '打印单据数值超出可靠范围'); return item; }
    if (!item || typeof item !== 'object' || ancestors.has(item) || !Array.isArray(item) && ![Object.prototype, null].includes(Object.getPrototypeOf(item))) fail(502, '打印单据数据格式无效');
    ancestors.add(item); let result;
    if (Array.isArray(item)) result = item.map(child => visit(child, depth + 1));
    else { result = {}; for (const key of Object.keys(item).sort()) { if (['__proto__', 'prototype', 'constructor'].includes(key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(item, key), 'value')) fail(502, '打印单据数据键无效'); result[key] = visit(item[key], depth + 1); } }
    ancestors.delete(item); return result;
  }
  const result = JSON.stringify(visit(value, 0));
  if (Buffer.byteLength(result) > JSON_LIMIT) fail(413, '打印单据超过20MB，请缩小范围');
  return result;
}
function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function query(values) { const params = new URLSearchParams(); for (const [key, value] of Object.entries(values)) for (const item of Array.isArray(value) ? value : [value]) params.append(key, String(item)); return params.toString(); }
function today(clock) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(clock()); }
function relativeSince(asOf, range) { if (range === 'all') return ''; const value = new Date(asOf + 'T00:00:00Z'); value.setUTCDate(value.getUTCDate() - (Number(range) - 1)); return value.toISOString().slice(0, 10); }
function sensitiveLegacy(filters) {
  // The old report endpoints carry no separate field-level grant. Details may
  // retain original financial columns; conservatively require a sensitive grant.
  return filters.details.length > 0 || filters.domain.some(domain => ['payroll', 'platinum', 'material', 'expenses'].includes(domain)) || filters.domain.some(domain => filters[domain + '_metric'].some(key => ['cost', 'profit', 'commission', 'commission_profit'].includes(key)));
}
function sensitiveDocument(value) { return ['purchase', 'receipt', 'opening_payable'].includes(value.kind) || value.kind === 'settlement' && value.payload?.direction === 'pay' || value.kind === 'reversal' && value.sensitiveTarget !== false; }
function sourceModule(type) { return ['warranty', 'quotation-a4'].includes(type) ? 'sales' : type.startsWith('inventory-') ? 'inventory' : 'ledger'; }
function freezeMetadata(value) { if (value && typeof value === 'object') { for (const child of Object.values(value)) freezeMetadata(child); Object.freeze(value); } return value; }
function acceptedSource(recipe, asOf) {
  const result = JSON.parse(canonical(recipe));
  if (recipe.type === 'inventory-report-a4') { result.asOf = asOf; result.since = relativeSince(asOf, recipe.range); }
  return result;
}

function imageBytes(type, bytes) {
  const correct = type === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) :
    type === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 :
      type === 'image/webp' && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  if (!bytes.length || bytes.length > JSON_LIMIT || !correct) fail(400, '报价打印图片格式无效或过大');
  return 'data:' + type + ';base64,' + bytes.toString('base64');
}

function createPrintSources({ core, moduleProxy, authorize, clock = () => new Date() } = {}) {
  if (typeof authorize !== 'function') throw new TypeError('authorize callback is required');
  async function requireAccess(actor, rule) { if (await authorize(actor, rule) === false) fail(403, '当前员工未获此类单据打印权限'); }
  function requirements(recipe) {
    const module = sourceModule(recipe.type), capabilities = [];
    if (recipe.type.startsWith('erp-')) capabilities.push('erp.read');
    if (recipe.type === 'erp-report-a4') capabilities.push('erp.reports.view');
    if (recipe.type === 'ledger-report-a4' && sensitiveLegacy(recipe.filters)) capabilities.push('erp.reports.sensitive');
    return { module, level: 'view', capabilities };
  }
  function fixedRecipe(input, asOf) {
    const recipe = normalizePrintSource(input);
    if (recipe.type === 'erp-report-a4') recipe.filters = erpFilters({ ...recipe.filters, asOf: recipe.filters.asOf || asOf });
    if (recipe.type === 'ledger-report-a4' && !Object.hasOwn(recipe.filters, 'start')) { recipe.filters.start = recipe.filters.all_time === '1' ? '' : asOf.slice(0, 7) + '-01'; recipe.filters.end = recipe.filters.all_time === '1' ? '' : asOf; }
    return recipe;
  }
  async function printQuote(actor, quote, kind) {
    const result = JSON.parse(canonical(quote)), snapshot = result.snapshot;
    // Attached export pages and confirmation screenshots are not quote-card
    // image inputs. The agent receives only the product images the template uses.
    result.images = []; snapshot.images = []; delete snapshot.customConfirmations;
    const cache = new Map();
    async function picture(value) {
      if (!value) return '';
      if (typeof value !== 'string') fail(400, '报价打印图片来源无效');
      const data = /^data:(image\/(?:png|jpeg|webp));base64,((?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?)$/.exec(value);
      if (data) { const bytes = Buffer.from(data[2], 'base64'); if (bytes.toString('base64') !== data[2]) fail(400, '报价打印图片编码无效'); return imageBytes(data[1], bytes); }
      const fixed = /^\/api\/images\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.exec(value);
      if (!fixed) fail(400, '报价打印只允许保存的商品图片');
      if (typeof core?.getImage !== 'function') fail(503, '销售打印图片来源未接入');
      if (!cache.has(value)) cache.set(value, (async () => {
        const response = await core.getImage(fixed[1], actor);
        if (!response?.ok || typeof response.arrayBuffer !== 'function') fail(Number.isInteger(response?.status) && response.status >= 400 && response.status <= 599 ? response.status : 502, '报价打印图片不可读取');
        const type = String(response.headers?.get?.('content-type') || '').split(';')[0].trim().toLowerCase();
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(type)) fail(400, '报价打印图片格式无效');
        return imageBytes(type, Buffer.from(await response.arrayBuffer()));
      })());
      return cache.get(value);
    }
    snapshot.image = kind === 'warranty' ? '' : await picture(snapshot.image);
    for (const rows of [snapshot.saleItems, snapshot.tradeInItems, snapshot.recyclingItems, snapshot.paymentMethods]) {
      for (const item of rows || []) if (item && typeof item === 'object') item.image = kind === 'warranty' ? '' : await picture(item.image);
    }
    if (Object.hasOwn(result, 'data')) result.data = snapshot;
    canonical(result); return result;
  }
  async function response(actor, module, path, expected) {
    if (typeof moduleProxy !== 'function') fail(503, '模块打印来源未接入');
    const result = await moduleProxy(actor, { module, path, method: 'GET' });
    if (!result || result.status !== 200) fail(Number.isInteger(result?.status) && result.status >= 400 && result.status <= 599 ? result.status : 502, '原业务服务拒绝或未生成打印单据');
    const contentType = String(result.headers?.['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (contentType !== expected) fail(502, '原业务服务返回了不同的单据格式');
    const maximum = expected === 'application/json' ? JSON_LIMIT : BINARY_LIMIT;
    if (typeof result.bodyBase64 !== 'string') fail(502, '原业务服务返回数据格式无效');
    if (result.bodyBase64.length > Math.ceil(maximum / 3) * 4) fail(413, '打印来源文件过大，请缩小范围');
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(result.bodyBase64)) fail(502, '打印来源编码无效');
    const bytes = Buffer.from(result.bodyBase64, 'base64');
    if (bytes.length > maximum) fail(413, '打印来源文件过大，请缩小范围');
    if (!bytes.length) fail(502, '原业务服务未生成单据');
    if (expected === 'application/pdf' && (!bytes.subarray(0, 8).toString('ascii').startsWith('%PDF-') || !bytes.subarray(-1024).toString('ascii').includes('%%EOF'))) fail(502, '原业务服务PDF单据损坏');
    if (expected !== 'application/json') return { contentType, bodyBase64: bytes.toString('base64'), bytes };
    let data; try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { fail(502, '原业务服务JSON单据损坏'); }
    canonical(data); return data;
  }
  async function load(actor, recipe, asOf) {
    let rule = requirements(recipe); await requireAccess(actor, rule);
    let data, document, comparison = 'business-json', fingerprint;
    if (recipe.type === 'warranty' || recipe.type === 'quotation-a4') {
      if (typeof core?.getQuote !== 'function') fail(503, '销售打印来源未接入');
      const result = await core.getQuote(recipe.quoteId, actor);
      const quote = result?.quote;
      if (!quote || quote.id !== recipe.quoteId || !quote.snapshot || typeof quote.snapshot !== 'object') fail(502, '保存报价单据格式无效');
      data = await printQuote(actor, quote, recipe.type);
      document = { format: recipe.type === 'warranty' ? 'warranty' : 'quotation', quote: JSON.parse(canonical(data)) };
      fingerprint = hash(canonical(data));
    } else if (recipe.type === 'erp-document-a4') {
      const result = await response(actor, 'ledger', '/erp/api/documents/' + recipe.id, 'application/json');
      data = result.document;
      if (result.ok !== true || !data || data.id !== recipe.id || !DOCUMENT_KINDS.includes(data.kind) || !data.payload || typeof data.payload !== 'object' || Array.isArray(data.payload) || !Array.isArray(data.lines)) fail(502, 'ERP单据内容无效');
      if (data.redacted === true) fail(403, '被遮蔽的敏感单据不能作为完整打印凭单');
      if (sensitiveDocument(data)) { rule = { ...rule, capabilities: [...rule.capabilities, 'erp.reports.sensitive'] }; await requireAccess(actor, rule); }
      document = { format: 'erp-json', sourceType: recipe.type, data: JSON.parse(canonical(data)) };
      fingerprint = hash(canonical(data));
    } else if (recipe.type === 'erp-report-a4') {
      const result = await response(actor, 'ledger', '/erp/api/reports?' + query(recipe.filters), 'application/json');
      if (result.ok !== true || !result.report || typeof result.report !== 'object' || Array.isArray(result.report)) fail(502, 'ERP汇报内容无效');
      data = result.report; document = { format: 'erp-json', sourceType: recipe.type, data: JSON.parse(canonical(data)) };
      const comparable = { ...data }; delete comparable.generated_at; delete comparable.generatedAt;
      fingerprint = hash(canonical(comparable));
    } else if (recipe.type === 'inventory-metal-a4') {
      data = await response(actor, 'inventory', '/api/metal-stats', 'application/json');
      if (!Array.isArray(data.rows) || !Array.isArray(data.totals) || !Array.isArray(data.grades)) fail(502, '板料汇报内容无效');
      document = { format: 'erp-json', sourceType: recipe.type, data: JSON.parse(canonical(data)) };
      const comparable = { ...data }; delete comparable.generated_at; delete comparable.generatedAt;
      fingerprint = hash(canonical(comparable));
    } else {
      let path, expected;
      if (recipe.type === 'ledger-report-a4') { path = '/reports/pdf?' + query(recipe.filters); expected = 'application/pdf'; }
      else if (recipe.type === 'inventory-count-a4') { path = '/sessions/' + recipe.id + '/print?' + query({ filter: recipe.filter, sort: recipe.sort, blind: recipe.blind, mode: recipe.mode }); expected = 'text/html'; }
      else { path = '/reports?' + query({ range: recipe.range, since: relativeSince(asOf, recipe.range) }); expected = 'text/html'; }
      const result = await response(actor, sourceModule(recipe.type), path, expected);
      // Binary generation metadata and old HTML are not reliable source versions.
      // Keep the accepted bytes immutable; revalidation proves access/existence,
      // not that opaque legacy business content has stayed unchanged.
      comparison = 'immutable-snapshot';
      data = { contentType: result.contentType, bodyBase64: result.bodyBase64 };
      document = { format: expected === 'application/pdf' ? 'trusted-pdf' : 'trusted-html', sourceType: recipe.type, contentType: result.contentType, bodyBase64: result.bodyBase64 };
      fingerprint = hash(result.bytes);
    }
    await requireAccess(actor, rule);
    const accepted = freezeMetadata(acceptedSource(recipe, asOf));
    const requestMeta = freezeMetadata({ version: 2, module: rule.module, sourceType: recipe.type, asOf, acceptedSource: accepted, fingerprint, comparison });
    return { module: rule.module, sourceRef: recipe, acceptedSource: accepted, requestMeta, asOf, snapshot: JSON.parse(canonical(data)), fingerprint, comparison, document, permissionRequirements: rule };
  }
  function assertSnapshot(prepared, recipe, asOf) {
    const document = prepared.document;
    if (!prepared.acceptedSource || !prepared.requestMeta || !document || !prepared.snapshot || typeof prepared.snapshot !== 'object') fail(409, '准备的打印快照或受理元数据缺失');
    const format = recipe.type === 'warranty' ? 'warranty' : recipe.type === 'quotation-a4' ? 'quotation' : recipe.type === 'ledger-report-a4' ? 'trusted-pdf' : ['inventory-count-a4', 'inventory-report-a4'].includes(recipe.type) ? 'trusted-html' : 'erp-json';
    if (document.format !== format || !['warranty', 'quotation-a4'].includes(recipe.type) && document.sourceType !== recipe.type) fail(409, '准备的打印文档格式或来源已改变');
    let data, fingerprint;
    if (prepared.comparison === 'immutable-snapshot') {
      if (document.sourceType !== recipe.type || typeof document.bodyBase64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(document.bodyBase64)) fail(409, '准备的打印文件已改变');
      const bytes = Buffer.from(document.bodyBase64, 'base64');
      if (bytes.toString('base64') !== document.bodyBase64) fail(409, '准备的打印文件编码已改变');
      data = { contentType: document.contentType, bodyBase64: document.bodyBase64 }; fingerprint = hash(bytes);
    } else {
      data = ['warranty', 'quotation-a4'].includes(recipe.type) ? document.quote : document.data;
      if (!data || typeof data !== 'object') fail(409, '准备的打印数据已改变');
      const comparable = { ...data };
      if (['erp-report-a4', 'inventory-metal-a4'].includes(recipe.type)) { delete comparable.generated_at; delete comparable.generatedAt; }
      fingerprint = hash(canonical(comparable));
    }
    if (canonical(data) !== canonical(prepared.snapshot) || fingerprint !== prepared.fingerprint) fail(409, '准备的打印快照或摘要已改变');
    const expected = acceptedSource(recipe, asOf);
    if (prepared.acceptedSource && canonical(prepared.acceptedSource) !== canonical(expected) || prepared.requestMeta && canonical(prepared.requestMeta) !== canonical({ version: 2, module: prepared.module, sourceType: recipe.type, asOf, acceptedSource: expected, fingerprint, comparison: prepared.comparison })) fail(409, '准备的打印时点或来源元数据已改变');
  }
  return {
    async prepare(actor, input) { const requestedSource = freezeMetadata(JSON.parse(canonical(normalizePrintSource(input)))), asOf = today(clock); return { ...await load(actor, fixedRecipe(requestedSource, asOf), asOf), requestedSource }; },
    async revalidate(actor, prepared) {
      if (!prepared || !prepared.sourceRef || !['business-json', 'immutable-snapshot'].includes(prepared.comparison) || !/^[a-f0-9]{64}$/.test(prepared.fingerprint)) fail(400, '准备的打印单据无效');
      const asOf = date(prepared.asOf), recipe = fixedRecipe(prepared.sourceRef, asOf);
      assertSnapshot(prepared, recipe, asOf);
      const current = await load(actor, recipe, asOf);
      if (prepared.module !== current.module || canonical(prepared.sourceRef) !== canonical(current.sourceRef) || prepared.comparison !== current.comparison) fail(409, '准备的打印单据来源改变');
      if (current.comparison === 'business-json' && current.fingerprint !== prepared.fingerprint) fail(409, '业务单据已变化，请重新核对后提交打印');
      return true;
    },
  };
}

module.exports = { normalizePrintSource, createPrintSources, PrintSourceError };

'use strict';

// This module owns no queue, database, process or network transport. Its callers
// supply trusted actor readers and authorization functions without re-entering
// a backend enqueue/exclusive operation already waiting for these callbacks.
const { resolvePrintRoute } = require('./print-routing.cjs');
const { createPrintSources, normalizePrintSource } = require('./print-sources.cjs');
const { validatePrintSettings } = require('./print-settings.cjs');
const { serializePrintValue } = require('./print-agent.cjs');
const erpPolicy = require('./erp-policy.cjs');

const TYPES = ['warranty', 'quotation-a4', 'erp-document-a4', 'erp-report-a4', 'ledger-report-a4', 'inventory-count-a4', 'inventory-report-a4', 'inventory-metal-a4'];
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const REPORT_KEYS = 'configured title all_time start end domain details sales_scope payroll_scope expense_scope sales_metric sales_group stock_metric stock_group material_metric material_group payroll_metric payroll_group expenses_metric expenses_group platinum_metric platinum_group'.split(' ');
const REPORT_MULTI = new Set(REPORT_KEYS.filter(key => key === 'domain' || key === 'details' || key.endsWith('_metric') || key.endsWith('_group')));
function fail(status, message) { const error = new Error(message); error.status = status; throw error; }
function record(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).some(key => typeof key !== 'string' || !keys.includes(key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))) fail(400, '统一打印参数含未允许的字段');
  return value;
}
const copy = value => JSON.parse(serializePrintValue(value));
function frozen(value) { if (value && typeof value === 'object') { for (const child of Object.values(value)) frozen(child); Object.freeze(value); } return value; }
function query(values) { const result = new URLSearchParams(); for (const [key, value] of Object.entries(values)) for (const item of Array.isArray(value) ? value : [value]) result.append(key, String(item)); return result.toString(); }
function fields(parameters, allowed, multi = new Set()) {
  const result = {};
  for (const [key, value] of parameters) {
    if (!allowed.includes(key) || Object.hasOwn(result, key) && !multi.has(key)) fail(400, '打印来源查询参数无效或重复');
    if (multi.has(key)) { result[key] ??= []; if (result[key].includes(value)) fail(400, '打印来源查询选择重复'); result[key].push(value); }
    else result[key] = value;
  }
  return result;
}
function validDate(value, empty = false) {
  if (empty && value === '') return value;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '0001-01-01' || !Number.isFinite(Date.parse(value + 'T00:00:00Z')) || new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value) fail(400, '打印来源绝对日期无效');
  return value;
}

function createPrintRoutingAdapter({ routing, enumerate, defaultsProvider = () => ({ phone: '', standard: '', afterSalesWechat: '' }) }) {
  if (!routing || typeof routing.getProfiles !== 'function' || typeof routing.getOptions !== 'function' || typeof enumerate !== 'function' || typeof defaultsProvider !== 'function') throw new TypeError('Trusted routing, enumerator and defaults provider are required');
  async function snapshot() {
    const profiles = copy(routing.getProfiles()), devices = await enumerate();
    if (!Array.isArray(devices) || devices.length > 1000) fail(503, '主机打印设备枚举无效');
    if (serializePrintValue(profiles) !== serializePrintValue(routing.getProfiles())) fail(409, '打印设备绑定在读取期间改变，请刷新后核对');
    return { profiles, devices: copy(devices) };
  }
  async function resolve(kind) { const { profiles, devices } = await snapshot(); return resolvePrintRoute(kind, profiles, devices); }
  async function getOptions(actor) {
    const base = await routing.getOptions(actor), { profiles, devices } = await snapshot(), types = {};
    for (const kind of TYPES) {
      try { types[kind] = { ...resolvePrintRoute(kind, profiles, devices), available: true }; }
      catch (error) { const binding = kind === 'warranty' ? profiles.warranty : profiles.a4; types[kind] = { available: false, printerId: '', label: binding?.deviceName || '', routingRevision: profiles.revision, paper: kind === 'warranty' ? binding?.paper ?? null : 'A4', code: error.code || 'PRINTER_UNAVAILABLE', reason: error.message }; }
      // Employees see labels and opaque IDs. Device paths remain server data.
      if (base?.canManage !== true) delete types[kind].deviceName;
    }
    const value = await defaultsProvider(actor);
    record(value, ['phone', 'standard', 'afterSalesWechat']);
    const defaults = {};
    for (const [key, maximum] of [['phone', 50], ['standard', 100], ['afterSalesWechat', 50]]) { const item = value[key] ?? ''; if (typeof item !== 'string' || item.length > maximum || /[\x00-\x1f\x7f]/.test(item)) fail(503, '主机质保默认文字无效'); defaults[key] = item.trim(); }
    if (serializePrintValue(profiles) !== serializePrintValue(routing.getProfiles())) fail(409, '打印绑定在读取设置期间改变，请刷新后核对');
    return { ...base, routingRevision: profiles.revision, types, defaults, available: Object.values(types).some(type => type.available), defaultPrinterId: types.warranty.available ? types.warranty.printerId : '', printers: Array.isArray(base?.printers) ? base.printers : [] };
  }
  return { getProfiles: () => routing.getProfiles(), resolve, getOptions, ...(typeof routing.update === 'function' ? { update: (actor, input) => routing.update(actor, input) } : {}) };
}

// Only the fixed source reader may use this wrapper. It cannot proxy arbitrary
// module pages, mutations, resources, URLs, caller identities or body payloads.
function fixedModuleRequest(value) {
  record(value, ['module', 'path', 'method']);
  if (!['ledger', 'inventory'].includes(value.module) || value.method !== 'GET' || typeof value.path !== 'string' || value.path.length > 8192 || !value.path.startsWith('/') || value.path.startsWith('//') || /[\\#\x00-\x20\x7f]/.test(value.path)) fail(400, '打印来源仅允许登记的模块读取');
  const url = new URL(value.path, 'http://offline.invalid');
  if (url.origin !== 'http://offline.invalid' || url.pathname + url.search !== value.path || url.pathname.includes('%') || url.pathname.includes('//')) fail(400, '打印来源地址须为固定规范路径');
  let pathname = url.pathname, parameters;
  if (value.module === 'ledger') {
    const document = /^\/erp\/api\/documents\/([^/]+)$/.exec(pathname);
    if (document && UUID.test(document[1]) && !url.search) parameters = null;
    else if (pathname === '/erp/api/reports') { parameters = normalizePrintSource({ type: 'erp-report-a4', filters: fields(url.searchParams, erpPolicy.REPORT_KEYS) }).filters; if (!parameters.asOf) fail(400, '打印报表必须包含受理后的固定时点'); }
    else if (pathname === '/reports/pdf') { parameters = normalizePrintSource({ type: 'ledger-report-a4', filters: fields(url.searchParams, REPORT_KEYS, REPORT_MULTI) }).filters; if (!Object.hasOwn(parameters, 'start') || !Object.hasOwn(parameters, 'end')) fail(400, '经营汇报必须包含受理后的完整日期'); }
    else fail(400, '未登记此财务打印来源');
  } else {
    const count = /^\/sessions\/([1-9][0-9]*)\/print$/.exec(pathname);
    if (count) { const source = normalizePrintSource({ type: 'inventory-count-a4', id: Number(count[1]), ...fields(url.searchParams, ['filter', 'sort', 'blind', 'mode']) }); parameters = { filter: source.filter, sort: source.sort, blind: source.blind, mode: source.mode }; }
    else if (pathname === '/api/metal-stats' && !url.search) parameters = null;
    else if (pathname === '/reports') {
      const input = fields(url.searchParams, ['range', 'r', 'since']);
      if (Object.hasOwn(input, 'range') === Object.hasOwn(input, 'r')) fail(400, '库存汇报必须只有一个固定范围');
      const source = normalizePrintSource({ type: 'inventory-report-a4', range: input.range ?? input.r });
      validDate(input.since, source.range === 'all');
      if (source.range === 'all' && input.since !== '') fail(400, '全部库存汇报不能带起始日');
      parameters = { r: source.range, since: input.since };
    } else fail(400, '未登记此库管打印来源');
  }
  return { module: value.module, path: pathname + (parameters ? '?' + query(parameters) : ''), method: 'GET' };
}

async function freshActor(original, loadActor) {
  if (!original || typeof original.id !== 'string' || !original.id) fail(401, '打印员工身份无效');
  const current = await loadActor(original.id);
  if (!current || current.id !== original.id || current.active === false || !['admin', 'employee'].includes(current.role) || !current.identity || typeof current.identity.userId !== 'string') fail(401, '打印员工账号已失效');
  if (original.userId && current.userId !== original.userId || original.credential && current.credential !== original.credential) fail(403, '打印员工账号或密码已变化');
  return current;
}
function createTrustedPrintModuleProxy({ moduleAdapter, loadActor, authorizeModule, withIdentity }) {
  if (!moduleAdapter || typeof moduleAdapter.proxy !== 'function' || [loadActor, authorizeModule, withIdentity].some(callback => typeof callback !== 'function')) throw new TypeError('Trusted module adapter, fresh actor, explicit grants and identity wrapper are required');
  return async (original, value) => {
    const input = fixedModuleRequest(value), originalIdentity = { id: original?.id, userId: original?.userId, credential: original?.credential };
    async function authority() {
      const current = await freshActor(originalIdentity, loadActor), grants = await authorizeModule(current, { module: input.module, level: 'view' });
      if (!grants || typeof grants !== 'object' || !['view', 'operate', 'manage'].includes(grants.moduleAccess?.[input.module])) fail(403, '员工未获原模块读取权限');
      const access = grants.moduleAccess[input.module];
      if (current.role === 'admin' && access !== 'manage') fail(403, '管理员模块权限身份无效');
      const principal = { staffId: current.id, userId: current.userId, name: current.name, role: current.role, access, module: input.module, grantRevision: current.grantRevision };
      if (!['staffId', 'userId'].every(key => typeof principal[key] === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(principal[key])) || typeof principal.name !== 'string' || !principal.name.trim() || principal.name.length > 100 || /[\x00-\x1f\x7f]/.test(principal.name) || !Number.isSafeInteger(principal.grantRevision) || principal.grantRevision < 0) fail(403, '员工模块签名身份无效');
      if (erpPolicy.isErpPath(input.path)) { const erp = erpPolicy.authorizeRequest(input, grants); principal.protocolVersion = 2; principal.capabilities = erp.capabilities; }
      return { current, principal };
    }
    const initial = await authority();
    const getActor = async () => { const next = await authority(); if (next.principal.grantRevision !== initial.principal.grantRevision || next.principal.access !== initial.principal.access || serializePrintValue(next.principal.capabilities ?? []) !== serializePrintValue(initial.principal.capabilities ?? [])) fail(403, '打印来源权限在读取期间改变'); return next.principal; };
    const result = await withIdentity(initial.current.identity, () => moduleAdapter.proxy(input, { actor: initial.principal, getActor }));
    await getActor(); return result;
  };
}

function toAgentPresentation(kind, input = {}, { settings, route, copies } = {}) {
  if (!TYPES.includes(kind)) fail(400, '打印展示类型无效');
  record(input, ['language', 'warranty', 'layoutOffsets', 'fontSizes']);
  const language = input.language ?? 'zh'; if (!['zh', 'en'].includes(language)) fail(400, '打印语言无效');
  if (!Number.isInteger(copies) || copies < 1 || copies > 3 || !route || typeof route.deviceName !== 'string' || !route.deviceName || /[\x00-\x1f\x7f]/.test(route.deviceName)) fail(400, '打印展示缺少可信设备或份数');
  if (kind !== 'warranty') { if (route.paper !== 'A4' || input.warranty !== undefined || input.layoutOffsets !== undefined || input.fontSizes !== undefined) fail(400, 'A4打印不允许套打或纸张覆写'); return frozen({ language }); }
  const warranty = record(input.warranty, ['itemIndexes', 'overrides']);
  if (!Array.isArray(warranty.itemIndexes) || !warranty.itemIndexes.length || warranty.itemIndexes.length > 30 || new Set(warranty.itemIndexes).size !== warranty.itemIndexes.length || warranty.itemIndexes.some(index => !Number.isInteger(index) || index < 0 || index > 29)) fail(400, '质保商品选择无效');
  const overrides = warranty.overrides ?? [];
  if (!Array.isArray(overrides) || overrides.length > 30) fail(400, '质保本次填写字段无效');
  const normalized = overrides.map(value => {
    record(value, ['itemIndex', 'goodsNumber', 'productName', 'phone', 'afterSalesWechat']);
    if (!warranty.itemIndexes.includes(value.itemIndex)) fail(400, '质保填写不属于所选商品');
    const result = { itemIndex: value.itemIndex };
    for (const [key, maximum] of [['goodsNumber', 60], ['productName', 100], ['phone', 50], ['afterSalesWechat', 50]]) if (value[key] !== undefined) { if (typeof value[key] !== 'string' || value[key].length > maximum || /[<>\x00-\x1f\x7f]/.test(value[key])) fail(400, '质保填写文字无效'); result[key] = value[key].trim(); }
    return result;
  });
  if (new Set(normalized.map(value => value.itemIndex)).size !== normalized.length) fail(400, '质保本次填写商品重复');
  let selected;
  try {
    const domain = require('./generated/print-domain.cjs');
    const offsets = input.layoutOffsets === undefined ? {} : domain.normalizeWarrantyLayoutOffsets(copy(input.layoutOffsets));
    const fonts = input.fontSizes === undefined ? {} : domain.normalizeWarrantyFontSizes(copy(input.fontSizes));
    if (!settings || !route.paper || typeof route.paper !== 'object') throw new Error('Missing server template');
    selected = validatePrintSettings({ ...settings, deviceName: route.deviceName, copies, widthMm: route.paper.widthMm, heightMm: route.paper.heightMm, layoutOffsets: { ...(settings.layoutOffsets ?? {}), ...offsets }, fontSizes: { ...(settings.fontSizes ?? {}), ...fonts } });
  } catch { fail(400, '主机质保模板或本次布局字号无效'); }
  return frozen({ language, warranty: { itemIndexes: [...warranty.itemIndexes], overrides: normalized }, settings: selected });
}

function createPrintComposition({ routing, enumerate, defaultsProvider, core, getSalesOrder, moduleAdapter, loadActor, authorizeSource, authorizeModule, withIdentity, clock }) {
  if ([loadActor, authorizeSource, withIdentity].some(callback => typeof callback !== 'function')) throw new TypeError('Fresh actor, explicit source authorization and identity wrapper are required');
  const routes = createPrintRoutingAdapter({ routing, enumerate, defaultsProvider });
  const moduleProxy = moduleAdapter ? createTrustedPrintModuleProxy({ moduleAdapter, loadActor, authorizeModule, withIdentity }) : undefined;
  async function permitted(original, rule) { const current = await freshActor(original, loadActor); if (await authorizeSource(current, rule) === false) fail(403, '员工未获此打印来源权限'); return current; }
  const sourceCore = {};
  for (const method of ['getQuote', 'getImage']) if (typeof core?.[method] === 'function') sourceCore[method] = async (id, original) => { const current = await permitted(original, { module: 'sales', level: 'view', capabilities: [] }); return withIdentity(current.identity, () => core[method](id, current)); };
  if (typeof getSalesOrder === 'function') sourceCore.getSalesOrder = async (id, original) => { const current = await permitted(original, { module: 'sales', level: 'operate', capabilities: [] }); return withIdentity(current.identity, () => getSalesOrder(id, current)); };
  const sources = createPrintSources({ core: sourceCore, moduleProxy, authorize: permitted, ...(clock ? { clock } : {}) });
  return { routing: routes, sources, moduleProxy };
}

module.exports = { createPrintRoutingAdapter, createTrustedPrintModuleProxy, createPrintComposition, toAgentPresentation };

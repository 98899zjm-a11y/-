'use strict';
const { createHash } = require('node:crypto');
const { resolvePrintRoute } = require('./print-routing.cjs');
const FORMATS = Object.freeze({ warranty: 'warranty', 'quotation-a4': 'quotation', 'erp-document-a4': 'erp-json', 'erp-report-a4': 'erp-json',
  'ledger-report-a4': 'trusted-pdf', 'inventory-count-a4': 'trusted-html', 'inventory-report-a4': 'trusted-html', 'inventory-metal-a4': 'erp-json' });

const PASSIVE_POLICY = Object.freeze({ javascriptEnabled: false, allowWindowPrint: false, allowExternalResources: false,
  allowNavigation: false, allowForms: false, allowPlugins: false, allowPdfJavaScript: false, allowPdfActions: false, allowPdfAttachments: false,
  csp: "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'" });

function fail(code, message, status = 400) { const error = new Error(message); error.code = code; error.status = status; throw error; }
function stable(value) {
  const ancestors = new Set(); let count = 0;
  function visit(item, depth) {
    if (++count > 200000 || depth > 40) fail('PRINT_PAYLOAD_LIMIT', '打印载荷结构超出范围', 413);
    if (item === null || typeof item === 'boolean' || typeof item === 'string') return item;
    if (typeof item === 'number') {
      if (!Number.isFinite(item) || Number.isInteger(item) && !Number.isSafeInteger(item)) fail('PRINT_PAYLOAD_INVALID', '打印载荷数字无效');
      return item;
    }
    if (!item || typeof item !== 'object' || ancestors.has(item) || !Array.isArray(item) && ![Object.prototype, null].includes(Object.getPrototypeOf(item))) fail('PRINT_PAYLOAD_INVALID', '打印载荷必须为有限 JSON');
    ancestors.add(item); let result;
    if (Array.isArray(item)) result = item.map(child => visit(child, depth + 1));
    else {
      result = {};
      for (const key of Reflect.ownKeys(item).sort()) {
        if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(item, key), 'value')) fail('PRINT_PAYLOAD_INVALID', '打印载荷字段无效');
        result[key] = visit(item[key], depth + 1);
      }
    }
    ancestors.delete(item); return result;
  }
  const result = JSON.stringify(visit(value, 0));
  if (Buffer.byteLength(result, 'utf8') > 96 * 1024 * 1024) fail('PRINT_PAYLOAD_LIMIT', '打印载荷文件过大', 413);
  return result;
}

function fingerprintPrintPayload(payload) {
  const snapshot = JSON.parse(stable(payload));
  const selected = { jobId: snapshot.jobId, kind: snapshot.kind, document: snapshot.document, route: snapshot.route,
    copies: snapshot.copies, presentation: snapshot.presentation ?? {} };
  return createHash('sha256').update(stable(selected)).digest('hex');
}

function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Object.keys(value).some(key => !keys.includes(key))) fail('PRINT_PAYLOAD_INVALID', '打印载荷含未允许的字段');
}
function validRoute(route, kind) {
  exact(route, ['printerId', 'deviceName', 'label', 'routingRevision', 'paper']);
  if (typeof route.printerId !== 'string' || !/^p_[a-f0-9]{32}$/.test(route.printerId) || typeof route.deviceName !== 'string' || !route.deviceName || route.deviceName.length > 240 || /[\x00-\x1f\x7f]/.test(route.deviceName) ||
      typeof route.label !== 'string' || route.label.length > 500 || /[\x00-\x1f\x7f]/.test(route.label) || !Number.isSafeInteger(route.routingRevision) || route.routingRevision < 0) fail('PRINT_ROUTE_INVALID', '主机打印设备绑定无效');
  if (kind === 'warranty') {
    exact(route.paper, ['widthMm', 'heightMm']);
    if (!Number.isFinite(route.paper.widthMm) || route.paper.widthMm < 60 || route.paper.widthMm > 420 || !Number.isFinite(route.paper.heightMm) || route.paper.heightMm < 60 || route.paper.heightMm > 500) fail('PRINT_ROUTE_INVALID', '质保单纸张设置无效');
  } else if (route.paper !== 'A4') fail('PRINT_ROUTE_INVALID', '此单据只能使用 A4 路由');
}
function validateDocument(document, kind, maximum) {
  const format = FORMATS[kind];
  if (!format || document?.format !== format) fail('PRINT_DOCUMENT_INVALID', '打印来源与文档格式不符');
  if (['quotation', 'warranty'].includes(format)) {
    const isOrder = Object.hasOwn(document, 'salesOrder');
    exact(document, isOrder ? ['format', 'salesOrder'] : ['format', 'quote']);
    const saved = isOrder ? document.salesOrder : document.quote;
    if (isOrder && (kind !== 'warranty' || !['pending', 'approved'].includes(saved?.status))) fail('PRINT_DOCUMENT_INVALID', '销售单状态或质保单来源无效');
    if (!saved || typeof saved !== 'object' || Array.isArray(saved) || typeof saved.id !== 'string' || !saved.snapshot || typeof saved.snapshot !== 'object') fail('PRINT_DOCUMENT_INVALID', '销售打印快照无效');
    if (Buffer.byteLength(stable(document)) > Math.min(maximum, 20 * 1024 * 1024)) fail('PRINT_DOCUMENT_LIMIT', '销售打印快照过大', 413);
    return {};
  }
  if (document.sourceType !== kind) fail('PRINT_DOCUMENT_INVALID', '打印文档来源类型不符');
  if (format === 'erp-json') {
    exact(document, ['format', 'sourceType', 'data']);
    if (!document.data || typeof document.data !== 'object' || Array.isArray(document.data)) fail('PRINT_DOCUMENT_INVALID', '结构化打印数据无效');
    if (Buffer.byteLength(stable(document)) > Math.min(maximum, 20 * 1024 * 1024)) fail('PRINT_DOCUMENT_LIMIT', '结构化打印数据过大', 413);
    return { html: createA4Html(document), renderMode: 'passive-html' };
  }
  exact(document, ['format', 'sourceType', 'contentType', 'bodyBase64']);
  const expected = format === 'trusted-pdf' ? 'application/pdf' : 'text/html';
  if (document.contentType !== expected || typeof document.bodyBase64 !== 'string' || document.bodyBase64.length > Math.ceil(maximum / 3) * 4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(document.bodyBase64)) fail('PRINT_DOCUMENT_INVALID', '原业务打印文件编码无效');
  const bytes = Buffer.from(document.bodyBase64, 'base64');
  if (!bytes.length || bytes.length > maximum || bytes.toString('base64') !== document.bodyBase64) fail('PRINT_DOCUMENT_LIMIT', '原业务打印文件大小无效', 413);
  if (format === 'trusted-pdf') {
    if (!bytes.subarray(0, 8).toString('ascii').startsWith('%PDF-') || !bytes.subarray(-1024).toString('ascii').includes('%%EOF')) fail('PRINT_DOCUMENT_INVALID', '原业务 PDF 文件损坏');
    // Header checks are a format boundary, not a PDF security sanitizer. The
    // injected worker must rasterize passive pages and never execute actions.
    return { renderMode: 'passive-pdf-pages' };
  }
  let html; try { html = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { fail('PRINT_DOCUMENT_INVALID', '原业务 HTML 文件不是有效 UTF-8'); }
  if (!/<(?:!doctype\s+html|html)(?:\s|>)/i.test(html)) fail('PRINT_DOCUMENT_INVALID', '原业务 HTML 文件不是完整页面');
  // Preserve the accepted original bytes. Actual script, navigation and network
  // isolation belongs to the passive worker, not a misleading regex cleaner.
  return { html, renderMode: 'passive-html' };
}
function escapeHtml(value) { return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'); }
function createA4Html(document) {
  if (document?.format !== 'erp-json' || !['erp-document-a4', 'erp-report-a4', 'inventory-metal-a4'].includes(document.sourceType) || !document.data || typeof document.data !== 'object' || Array.isArray(document.data)) fail('PRINT_DOCUMENT_INVALID', '仅支持登记的结构化 A4 单据');
  const data = JSON.parse(stable(document.data));
  let count = 0;
  function content(value) {
    if (++count > 50000) fail('PRINT_DOCUMENT_LIMIT', 'A4 单据内容过多，请缩小范围', 413);
    if (value === null) return '<span>—</span>';
    if (Array.isArray(value)) return '<div class="items">' + value.map(item => '<section class="item">' + content(item) + '</section>').join('') + '</div>';
    if (typeof value === 'object') return '<table><tbody>' + Object.entries(value).map(([key, child]) => '<tr><th>' + escapeHtml(key) + '</th><td>' + content(child) + '</td></tr>').join('') + '</tbody></table>';
    return '<span>' + escapeHtml(value) + '</span>';
  }
  const body = content(data);
  if (Buffer.byteLength(body) > 8 * 1024 * 1024) fail('PRINT_DOCUMENT_LIMIT', 'A4 页面内容过大，请缩小范围', 413);
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' + escapeHtml(PASSIVE_POLICY.csp) + '"><title>鑫金源珠宝业务单据</title><style>@page{size:A4;margin:14mm}body{font:12px/1.6 sans-serif;color:#24201b;overflow-wrap:anywhere}h1{font-size:20px;border-bottom:1px solid #b6a17a;padding-bottom:10px}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{text-align:left;vertical-align:top;border:1px solid #ddd;padding:7px}th{width:24%;font-weight:500}tr,.item{break-inside:avoid}.items{display:block}.item{margin:7px 0}span{white-space:pre-wrap}</style></head><body><h1>鑫金源珠宝 · 业务单据</h1><p>数值按原单据单位显示。</p>' + body + '</body></html>';
}
function freeze(value) { if (value && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value)) freeze(child); } return value; }

function createPrintAgent({ renderer, enumerate, submit, maxDocumentBytes = 64 * 1024 * 1024, renderTimeoutMs = 15000, submitTimeoutMs = 30000 }) {
  if (!renderer || typeof renderer.render !== 'function' || typeof enumerate !== 'function' || typeof submit !== 'function') throw new TypeError('Passive renderer, enumerator and controlled submit are required');
  if (!Number.isSafeInteger(maxDocumentBytes) || maxDocumentBytes < 1 || maxDocumentBytes > 64 * 1024 * 1024) throw new TypeError('Document budget is invalid');
  if ([renderTimeoutMs, submitTimeoutMs].some(value => !Number.isSafeInteger(value) || value < 1 || value > 120000)) throw new TypeError('Print timeout budget is invalid');
  let closed = false, active = false;
  const attemptedJobs = new Set();
  async function bounded(promise, milliseconds, code, cleanupLate) {
    let timer, expired = false;
    const timed = new Promise((_resolve, reject) => { timer = setTimeout(() => { expired = true; const error = new Error(code === 'PRINT_RENDER_TIMEOUT' ? '打印页面准备超时' : '打印机提交结果超时，须人工核对是否出纸'); error.code = code; reject(error); }, milliseconds); });
    const observed = Promise.resolve(promise).then(value => {
      if (expired && cleanupLate) Promise.resolve(cleanupLate(value)).catch(() => {});
      return value;
    });
    try { return await Promise.race([observed, timed]); } finally { clearTimeout(timer); }
  }
  async function getDevices() { if (closed) fail('PRINT_AGENT_CLOSED', '打印代理已关闭', 503); return JSON.parse(stable(await enumerate())); }
  async function verifyRoute(payload) {
    const deviceList = await getDevices();
    if (!Array.isArray(deviceList) || deviceList.length > 1000) fail('PRINT_DEVICES_INVALID', '主机打印设备枚举无效', 503);
    const route = payload.route;
    const profiles = { revision: route.routingRevision,
      warranty: { deviceName: payload.kind === 'warranty' ? route.deviceName : '', paper: payload.kind === 'warranty' ? route.paper : null },
      a4: { deviceName: payload.kind === 'warranty' ? '' : route.deviceName, paper: 'A4' } };
    const found = resolvePrintRoute(payload.kind, profiles, deviceList);
    if (found.printerId !== route.printerId || found.deviceName !== route.deviceName) fail('PRINT_ROUTE_CHANGED', '主机设备与已批准路由不一致', 409);
  }
  async function print(input, control = {}) {
    let rendered, attempted = false, ownsActive = false;
    try {
      if (closed) fail('PRINT_AGENT_CLOSED', '打印代理已关闭', 503);
      if (active) fail('PRINT_AGENT_BUSY', '主机正在发送另一项打印任务', 409);
      active = true; ownsActive = true;
      if (typeof control.assertAuthorized !== 'function') fail('PRINT_AUTH_RECEIPT_REQUIRED', '缺少最终打印授权', 403);
      const payload = JSON.parse(stable(input));
      exact(payload, ['jobId', 'kind', 'document', 'route', 'copies', 'presentation', 'payloadHash']);
      if (typeof payload.jobId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(payload.jobId) ||
          !Object.hasOwn(FORMATS, payload.kind) || !Number.isInteger(payload.copies) || payload.copies < 1 || payload.copies > 3 || !/^[a-f0-9]{64}$/.test(payload.payloadHash)) fail('PRINT_PAYLOAD_INVALID', '打印任务编号、类型或份数无效');
      validRoute(payload.route, payload.kind);
      payload.presentation ??= {};
      exact(payload.presentation, ['language', 'warranty', 'settings', 'size']);
      if (Buffer.byteLength(stable(payload.presentation)) > 65536) fail('PRINT_DOCUMENT_LIMIT', '打印展示参数过大', 413);
      const hash = fingerprintPrintPayload(payload);
      if (hash !== payload.payloadHash) fail('PRINT_PAYLOAD_CHANGED', '打印载荷摘要不一致', 403);
      if (attemptedJobs.has(payload.jobId)) fail('PRINT_JOB_ALREADY_ATTEMPTED', '此任务已尝试送往打印机，请先核对出纸，不允许自动重打', 409);
      if (attemptedJobs.size >= 65536) fail('PRINT_AGENT_LIMIT', '打印代理提交记录已满，请核对主机保留账本后维护', 503);
      const content = validateDocument(payload.document, payload.kind, maxDocumentBytes);
      await verifyRoute(payload);
      const prepared = freeze({ ...payload, ...content, policy: PASSIVE_POLICY });
      rendered = await bounded(renderer.render(prepared), renderTimeoutMs, 'PRINT_RENDER_TIMEOUT', typeof renderer.destroy === 'function' ? value => renderer.destroy(value) : null);
      await verifyRoute(payload);
      const receipt = await control.assertAuthorized();
      if (!receipt || receipt.jobId !== payload.jobId || receipt.payloadHash !== hash || receipt.copies !== payload.copies || stable(receipt.route) !== stable(payload.route)) fail('PRINT_AUTH_RECEIPT_INVALID', '最终打印授权与载荷不一致', 403);
      // The real authenticated worker requires a signed 5-second receipt.
      // Keep the pure legacy adapter receipt compatible, but always validate
      // expiry again synchronously immediately before the native submit.
      if (receipt.expiresAt !== undefined) { const now = Date.now(); if (!Number.isSafeInteger(receipt.expiresAt) || receipt.expiresAt <= now || receipt.expiresAt > now + 5000) fail('PRINT_AUTH_RECEIPT_EXPIRED', '最终打印授权已过期', 403); }
      if (closed) fail('PRINT_AGENT_CLOSED', '打印代理已关闭', 503);
      attemptedJobs.add(payload.jobId);
      attempted = true;
      const pageSize = payload.kind === 'warranty' ? { width: Math.round(payload.route.paper.widthMm * 1000), height: Math.round(payload.route.paper.heightMm * 1000) } : 'A4';
      const result = await bounded(submit(rendered, { silent: true, deviceName: payload.route.deviceName, copies: payload.copies, printBackground: true,
        margins: { marginType: 'none' }, pageSize }, prepared), submitTimeoutMs, 'PRINT_SUBMIT_TIMEOUT');
      if (!result || !['submitted', 'failed', 'uncertain'].includes(result.status)) fail('PRINT_SUBMIT_RESULT_INVALID', '打印提交结果未能确定');
      return { status: result.status, ...(typeof result.error === 'string' ? { error: result.error.slice(0, 800) } : {}) };
    } catch (error) {
      return { status: attempted ? 'uncertain' : 'failed', code: error.code || 'PRINT_AGENT_ERROR', error: String(error.message || '打印代理未能处理').slice(0, 800) };
    } finally {
      if (rendered && typeof renderer.destroy === 'function') { try { await renderer.destroy(rendered); } catch { /* Do not rewrite physical submission knowledge. */ } }
      if (ownsActive) active = false;
    }
  }
  async function close() { closed = true; }
  return { getDevices, print, close };
}

module.exports = { createPrintAgent, fingerprintPrintPayload, createA4Html, serializePrintValue: stable };

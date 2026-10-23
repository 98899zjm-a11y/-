'use strict';

// The caller must have validated the module view and stripped its trusted
// gateway origin. This adapter accepts only a relative location and produces
// a fixed source recipe; a location never crosses the print API boundary.
const { normalizePrintSource } = require('./print-sources.cjs');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REPORT_KEYS = new Set('configured title all_time start end domain details sales_scope payroll_scope expense_scope sales_metric sales_group stock_metric stock_group material_metric material_group payroll_metric payroll_group expenses_metric expenses_group platinum_metric platinum_group'.split(' '));
const REPORT_MULTI = new Set([...REPORT_KEYS].filter(key => key === 'domain' || key === 'details' || key.endsWith('_metric') || key.endsWith('_group')));

function queryFields(search, allowed, multi = new Set()) {
  const fields = {};
  for (const [key, value] of new URLSearchParams(search)) {
    if (!allowed.has(key)) return null;
    if (multi.has(key)) {
      if (!Object.hasOwn(fields, key)) fields[key] = [];
      if (fields[key].includes(value)) return null;
      fields[key].push(value);
    } else {
      if (Object.hasOwn(fields, key)) return null;
      fields[key] = value;
    }
  }
  return fields;
}

function normalizeModulePrintLocation(module, relativeUrl) {
  if (!['ledger', 'inventory'].includes(module) || typeof relativeUrl !== 'string' || relativeUrl.length > 8192 || !relativeUrl.startsWith('/') || relativeUrl.startsWith('//') || /[\\#\x00-\x20\x7f]/.test(relativeUrl)) return null;
  const question = relativeUrl.indexOf('?');
  const pathname = question < 0 ? relativeUrl : relativeUrl.slice(0, question);
  const search = question < 0 ? '' : relativeUrl.slice(question + 1);
  if (pathname.includes('%') || pathname.includes('//') || pathname.split('/').some(part => part === '.' || part === '..')) return null;
  let recipe = null;
  if (module === 'ledger') {
    const document = /^\/erp\/(?:api\/documents|doc)\/([^/]+)$/.exec(pathname);
    if (document && UUID.test(document[1]) && !search) recipe = { type: 'erp-document-a4', id: document[1].toLowerCase() };
    else if (pathname === '/reports/print' || pathname === '/reports/pdf') {
      const filters = queryFields(search, REPORT_KEYS, REPORT_MULTI);
      if (filters) recipe = { type: 'ledger-report-a4', filters };
    }
    // /erp/ is a single-page view: its currently selected document cannot be
    // inferred from the location. The ERP button submits its structured ID.
  } else {
    const count = /^\/sessions\/([1-9][0-9]*)\/print$/.exec(pathname);
    if (count) {
      const id = Number(count[1]);
      const filters = queryFields(search, new Set(['filter', 'sort', 'blind', 'mode']));
      if (Number.isSafeInteger(id) && filters) recipe = { type: 'inventory-count-a4', id, ...filters };
    } else if (pathname === '/reports') {
      const filters = queryFields(search, new Set(['r', 'range']));
      if (filters && Object.keys(filters).length === 1) recipe = { type: 'inventory-report-a4', range: filters.r ?? filters.range };
    } else if (pathname === '/metal-stats' && !search) recipe = { type: 'inventory-metal-a4' };
  }
  if (!recipe) return null;
  try { normalizePrintSource(recipe); return recipe; }
  catch { return null; }
}

module.exports = { normalizeModulePrintLocation };

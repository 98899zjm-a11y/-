const MAX_BALANCES = 20000;
const MAX_QUANTITY_LENGTH = 128;
const ALLOWED = new Set(['reportId', 'kind', 'code', 'q', 'page', 'pageSize']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DECIMAL_RE = /^[+-]?[0-9]+(?:[.][0-9]+)?$/;
const TIMESTAMP_RE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})[Tt]([0-9]{2}):([0-9]{2}):([0-9]{2})(?:[.]([0-9]{1,30}))?([Zz]|[+-][0-9]{2}:[0-9]{2})$/;
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function fail(message) {
  throw new Error(message);
}

function aborted() {
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal) {
  if (signal && signal.aborted) throw aborted();
}

function isThenable(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function') && typeof value.then === 'function';
}

function runCheck(check, signal) {
  throwIfAborted(signal);
  const result = check();
  if (result === false) fail('Authorization denied');
  if (isThenable(result)) {
    if (typeof result.catch === 'function') result.catch(() => {});
    fail('Authorization check must be synchronous');
  }
  throwIfAborted(signal);
}

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year, month) {
  return month === 2 && isLeapYear(year) ? 29 : MONTH_DAYS[month - 1];
}

function daysFromCivil(year, month, day) {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = month + (month > 2 ? -3 : 9);
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function parseTimestamp(value, label) {
  if (typeof value !== 'string') fail(label + ' must be a valid timestamp');
  const match = TIMESTAMP_RE.exec(value);
  if (!match) fail(label + ' must be a valid timestamp');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const fraction = match[7];
  const zone = match[8];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month) || hour > 23 || minute > 59 || second > 59) {
    fail(label + ' must be a valid timestamp');
  }
  let offsetMinutes = 0;
  if (zone !== 'Z' && zone !== 'z') {
    const sign = zone[0] === '-' ? -1 : 1;
    const offsetHour = Number(zone.slice(1, 3));
    const offsetMinute = Number(zone.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) fail(label + ' must be a valid timestamp');
    offsetMinutes = sign * (offsetHour * 60 + offsetMinute);
  }
  const fractionMs = fraction ? Number('0.' + fraction) * 1000 : 0;
  const wallMs = daysFromCivil(year, month, day) * 86400000 + hour * 3600000 + minute * 60000 + second * 1000 + fractionMs;
  const timestamp = wallMs - offsetMinutes * 60000;
  if (!Number.isFinite(timestamp)) fail(label + ' must be a valid timestamp');
  return timestamp;
}

function isNonBlank(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseInput(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) fail('input must be an object');
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== 'string' || !ALLOWED.has(key)) fail('input contains an unsupported field');
  }
  if (typeof input.reportId !== 'string' || !UUID_RE.test(input.reportId)) fail('reportId must be a UUID');
  if (input.kind !== 'product' && input.kind !== 'material') fail('kind must be product or material');
  const hasCode = Object.hasOwn(input, 'code');
  const hasQ = Object.hasOwn(input, 'q');
  if (hasCode === hasQ) fail('exactly one of code or q is required');
  const raw = hasCode ? input.code : input.q;
  if (typeof raw !== 'string') fail('query must be a string');
  const value = raw.trim();
  if (value.length === 0 || value.length > 100) fail('query must be 1..100 characters');
  const page = input.page === undefined ? 1 : input.page;
  const pageSize = input.pageSize === undefined ? 20 : input.pageSize;
  if (!Number.isSafeInteger(page) || page < 1) fail('page must be a positive integer');
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) fail('pageSize must be 1..100');
  return { reportId: input.reportId, kind: input.kind, mode: hasCode ? 'code' : 'q', value, page, pageSize };
}

function readReport(loaded, reportId, now, maxAgeMs) {
  if (loaded === null || typeof loaded !== 'object' || Array.isArray(loaded)) fail('loadReport returned an invalid document');
  const report = loaded.report;
  if (report === null || typeof report !== 'object' || Array.isArray(report)) fail('loadReport must return {report}');
  if (report.id !== reportId) fail('report id mismatch');
  if (report.status !== 'approved') fail('only approved reports are readable');
  const capturedAt = report.capturedAt;
  const capturedTime = parseTimestamp(capturedAt, 'report.capturedAt');
  if (capturedTime > now) fail('report.capturedAt is in the future');
  if (now - capturedTime > maxAgeMs) fail('report is older than maxAgeMs');
  if (!isNonBlank(report.sourceInstance) || !isNonBlank(report.sourceVersion)) fail('report source is invalid');
  const snapshot = report.snapshot;
  if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) fail('snapshot is invalid');
  if (snapshot.capturedAt !== capturedAt) fail('snapshot.capturedAt does not match report.capturedAt');
  if (snapshot.truncated) fail('snapshot is truncated');
  if (snapshot.limits && snapshot.limits.truncated) fail('snapshot limits are truncated');
  if (!Array.isArray(snapshot.balances)) fail('snapshot.balances must be an array');
  if (snapshot.balances.length > MAX_BALANCES) fail('snapshot.balances exceeds 20000 rows');
  return { report, snapshot, capturedAt };
}

function readRows(rows) {
  const result = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row === null || typeof row !== 'object' || Array.isArray(row)) fail('balance row ' + index + ' is invalid');
    for (const field of ['sourceId', 'sourceKind', 'code', 'name', 'category', 'spec', 'unit']) {
      if (typeof row[field] !== 'string') fail('balance row ' + index + ' has an invalid ' + field);
    }
    if (row.sourceId.length === 0 || row.sourceKind.length === 0) fail('balance row ' + index + ' is missing an identity');
    if (typeof row.quantity !== 'string' || row.quantity.length === 0 || row.quantity.length > MAX_QUANTITY_LENGTH || !DECIMAL_RE.test(row.quantity)) {
      fail('balance row ' + index + ' has an invalid quantity');
    }
    result.push({
      sourceId: row.sourceId,
      sourceKind: row.sourceKind,
      code: row.code,
      name: row.name,
      category: row.category,
      spec: row.spec,
      unit: row.unit,
      quantity: row.quantity,
    });
  }
  return result;
}

function normalizeText(value) {
  return value.normalize('NFKC').toLowerCase();
}

export function createInventoryReportReader({ loadReport, authorize, clock = Date.now, maxAgeMs } = {}) {
  if (typeof loadReport !== 'function') fail('loadReport must be a function');
  if (typeof authorize !== 'function') fail('authorize must be a function');
  if (typeof clock !== 'function') fail('clock must be a function');
  if (typeof maxAgeMs !== 'number' || !Number.isFinite(maxAgeMs) || maxAgeMs <= 0) fail('maxAgeMs must be a finite positive number');

  async function lookup(input, options = {}) {
    const signal = options ? options.signal : undefined;
    throwIfAborted(signal);
    const request = parseInput(input);
    const authorization = await authorize({ reportId: request.reportId, operation: 'inventory_report_read', signal });
    throwIfAborted(signal);
    if (authorization === null || typeof authorization !== 'object' || Array.isArray(authorization) || typeof authorization.check !== 'function') {
      fail('authorize must return {check: function}');
    }
    const check = authorization.check;
    runCheck(check, signal);
    const loaded = await loadReport(request.reportId, { signal });
    throwIfAborted(signal);
    runCheck(check, signal);
    const now = clock();
    if (typeof now !== 'number' || !Number.isFinite(now)) fail('clock must return a finite number');
    const { report, snapshot, capturedAt } = readReport(loaded, request.reportId, now, maxAgeMs);
    const rows = readRows(snapshot.balances);
    const query = request.mode === 'q' ? normalizeText(request.value) : null;
    const matches = rows.filter((row) => {
      if (row.sourceKind !== request.kind) return false;
      if (request.mode === 'code') return row.code === request.value;
      return [row.code, row.name, row.spec].some((field) => normalizeText(field).includes(query));
    });
    const total = matches.length;
    const start = (request.page - 1) * request.pageSize;
    const items = matches.slice(start, start + request.pageSize).map((row) => ({
      sourceId: row.sourceId,
      sourceKind: row.sourceKind,
      code: row.code,
      name: row.name,
      category: row.category,
      spec: row.spec,
      unit: row.unit,
      quantity: row.quantity,
    }));
    const output = {
      reportId: request.reportId,
      asOf: capturedAt,
      source: { instance: report.sourceInstance, version: report.sourceVersion, basis: 'saved_approved_snapshot' },
      kind: request.kind,
      page: request.page,
      pageSize: request.pageSize,
      total,
      items,
      isLive: false,
      supplyStatus: 'unknown',
    };
    runCheck(check, signal);
    return output;
  }

  return { lookup };
}
'use strict';
// project/desktop/login-entry.asar.a3.test.cjs
// 严格按 @electron/asar 磁盘格式解析，不设任何备用/猜测格式；格式不符 → 退出码 2（阻断），绝不 fail-open。
// 官方 pickle 头：u32@0=4；u32@4=headerSize(H)；头部 pickle 自 8 起：u32@8=H-4，u32@12=JSON字符串长度，
// JSON 自 16 起，字符串 4 字节对齐填充；dataStart=8+H；文件 offset 相对 dataStart，按 4 字节对齐。
// 用法：node login-entry.asar.a3.test.cjs --built <新app.asar> --frozen <旧app.asar> [--results <目录>]
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MARKER = 'login-update-entry';
const LABEL = '一键升级';
const LOGIN_CLASS = 'desktop-auth';
const AUTH_PANEL = 'auth-panel';
const UPDATE_PANEL = 'employee-update-panel';
const markerBuf = Buffer.from(MARKER, 'utf8');
const labelBuf = Buffer.from(LABEL, 'utf8');
const loginBuf = Buffer.from(LOGIN_CLASS, 'utf8');
const authPanelBuf = Buffer.from(AUTH_PANEL, 'utf8');
const updatePanelBuf = Buffer.from(UPDATE_PANEL, 'utf8');
const escapedLabel = /\\u4e00\\u952e\\u5347\\u7ea7/i;

class FormatError extends Error {}
const CHECK = [];
let pass = 0, fail = 0;
function check(id, ok, detail) {
  CHECK.push({ id, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
  if (ok) { pass++; console.log('[PASS] ' + id + (detail ? ' ' + detail : '')); }
  else { fail++; console.log('[FAIL] ' + id + (detail ? ' ' + detail : '')); }
}
function info(text) { console.log('[INFO] ' + text); }

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a || a.slice(0, 2) !== '--') continue;
    const k = a.slice(2);
    const v = (i + 1 < argv.length && argv[i + 1].slice(0, 2) !== '--') ? argv[++i] : 'true';
    out[k] = v;
  }
  return out;
}

function readU32(buf, off, total, what) {
  if (off < 0 || off + 4 > total) throw new FormatError('读取 ' + what + ' 越界：' + off);
  return buf.readUInt32LE(off);
}

function openArchive(filePath) {
  const buf = fs.readFileSync(filePath);
  const total = buf.length;
  if (total < 32) throw new FormatError('文件过小，不是 asar：' + filePath);
  const v0 = readU32(buf, 0, total, 'u32@0');
  if (v0 !== 4) throw new FormatError('u32@0 应为 4（size pickle 载荷大小），实际 ' + v0);
  const headerSize = readU32(buf, 4, total, 'headerSize');
  if (headerSize < 16 || 8 + headerSize > total) throw new FormatError('headerSize 非法：' + headerSize);
  const payload = readU32(buf, 8, total, 'headPicklePayload');
  if (payload !== headerSize - 4) throw new FormatError('头部载荷 ' + payload + ' ≠ headerSize-4 ' + (headerSize - 4));
  const strLen = readU32(buf, 12, total, 'jsonLength');
  const pad = payload - 4 - strLen;
  const expectedPad = (4 - (strLen % 4)) % 4;
  if (pad !== expectedPad) throw new FormatError('字符串填充不合法：pad=' + pad + ' 期望=' + expectedPad);
  const jsonStart = 16, jsonEnd = jsonStart + strLen, dataStart = 8 + headerSize;
  if (jsonEnd + pad !== dataStart) throw new FormatError('JSON 边界与数据区不一致：' + (jsonEnd + pad) + ' ≠ ' + dataStart);
  let header;
  try { header = JSON.parse(buf.subarray(jsonStart, jsonEnd).toString('utf8')); }
  catch (e) { throw new FormatError('头部 JSON 无法解析：' + e.message); }
  if (!header || typeof header !== 'object' || Array.isArray(header)) throw new FormatError('头部不是对象');
  const rootKeys = Object.keys(header);
  if (rootKeys.length !== 1 || rootKeys[0] !== 'files') throw new FormatError('头部根字段应仅 files，实际 [' + rootKeys.join(',') + ']');
  if (!header.files || typeof header.files !== 'object' || Array.isArray(header.files)) throw new FormatError('头部 files 不是对象');

  const dataSize = total - dataStart;
  const stats = { headerSize, payload, jsonLength: strLen, padding: pad, dataStart, dataSize, total, leaves: 0, unpacked: 0, links: 0, offsetAsNumber: 0 };
  const entries = [];
  const walk = (node, prefix) => {
    for (const name of Object.keys(node)) {
      if (!name || name.indexOf('/') >= 0) throw new FormatError('条目名不合法：' + JSON.stringify(name));
      const child = node[name];
      const p = prefix ? prefix + '/' + name : name;
      if (!child || typeof child !== 'object' || Array.isArray(child)) throw new FormatError('条目不是对象：' + p);
      const keys = Object.keys(child);
      if (keys.indexOf('files') >= 0) {
        if (keys.length !== 1) throw new FormatError('目录条目混入其他字段：' + p);
        walk(child.files, p);
        continue;
      }
      if (keys.indexOf('link') >= 0) {
        if (keys.length !== 1 || typeof child.link !== 'string') throw new FormatError('链接条目格式不符：' + p);
        stats.leaves++; stats.links++;
        entries.push({ path: p, link: child.link });
        continue;
      }
      const allowed = ['size', 'offset', 'executable', 'unpacked', 'integrity'];
      for (const k of keys) if (allowed.indexOf(k) < 0) throw new FormatError('文件条目含未登记字段 ' + k + '：' + p);
      if (typeof child.size !== 'number' || !Number.isSafeInteger(child.size) || child.size < 0) throw new FormatError('size 非法：' + p);
      if (keys.indexOf('executable') >= 0 && typeof child.executable !== 'boolean') throw new FormatError('executable 非布尔：' + p);
      if (keys.indexOf('unpacked') >= 0 && typeof child.unpacked !== 'boolean') throw new FormatError('unpacked 非布尔：' + p);
      if (keys.indexOf('integrity') >= 0) {
        const it = child.integrity;
        if (!it || typeof it !== 'object' || Array.isArray(it)) throw new FormatError('integrity 非对象：' + p);
        for (const k of Object.keys(it)) if (['algorithm', 'hash', 'blockSize', 'blocks'].indexOf(k) < 0) throw new FormatError('integrity 含未登记字段 ' + k + '：' + p);
      }
      const unpacked = child.unpacked === true;
      let offset = null;
      if (keys.indexOf('offset') >= 0) {
        const raw = child.offset;
        if (typeof raw === 'string') {
          if (!/^(0|[1-9][0-9]*)$/.test(raw)) throw new FormatError('offset 非规范十进制字符串：' + p + '=' + JSON.stringify(raw));
          offset = Number(raw);
          if (!Number.isSafeInteger(offset)) throw new FormatError('offset 超出安全整数：' + p);
        } else if (typeof raw === 'number') {
          if (!Number.isSafeInteger(raw) || raw < 0) throw new FormatError('offset 数字非法：' + p);
          offset = raw; stats.offsetAsNumber++;
        } else throw new FormatError('offset 类型不支持：' + p);
      } else if (!unpacked) throw new FormatError('缺少 offset：' + p);
      stats.leaves++;
      if (unpacked) { stats.unpacked++; entries.push({ path: p, size: child.size, unpacked: true }); continue; }
      if (offset % 4 !== 0) throw new FormatError('offset 未按 4 字节对齐：' + p + '=' + offset);
      if (offset + child.size > dataSize) throw new FormatError('条目超出数据区：' + p + ' offset=' + offset + ' size=' + child.size + ' dataSize=' + dataSize);
      entries.push({ path: p, size: child.size, offset });
    }
  };
  walk(header.files, '');
  const ranged = entries.filter(e => !e.unpacked && e.link === undefined).sort((a, b) => a.offset - b.offset);
  for (let i = 1; i < ranged.length; i++) {
    const prev = ranged[i - 1], cur = ranged[i];
    if (cur.offset < prev.offset + prev.size) throw new FormatError('数据区重叠：' + prev.path + ' 与 ' + cur.path);
  }
  return { filePath, buf, total, dataStart, dataSize, stats, entries };
}

function scan(archive) {
  const { buf, dataStart } = archive;
  const markerHits = [];
  const loginEntries = [];
  let updatePanelEntries = 0;
  for (const e of archive.entries) {
    if (e.unpacked || e.link !== undefined || e.size === 0) continue;
    const body = buf.subarray(dataStart + e.offset, dataStart + e.offset + e.size);
    const hasLogin = body.includes(loginBuf);
    const hasAuthPanel = body.includes(authPanelBuf);
    if (hasLogin && hasAuthPanel) loginEntries.push(e.path);
    if (body.includes(updatePanelBuf)) updatePanelEntries++;
    if (body.includes(markerBuf)) markerHits.push({ path: e.path, body });
  }
  return { markerHits, loginEntries, updatePanelEntries };
}

function inspectHit(hit) {
  const body = hit.body;
  const at = body.indexOf(markerBuf);
  const win = body.subarray(Math.max(0, at - 800), Math.min(body.length, at + 800));
  const latin = win.toString('latin1');
  return {
    path: hit.path,
    hasLoginClass: body.includes(loginBuf),
    hasAuthPanel: body.includes(authPanelBuf),
    hasUpdatePanel: body.includes(updatePanelBuf),
    hasTestIdAttr: latin.indexOf('data-testid') >= 0,
    hasLabel: win.includes(labelBuf) || escapedLabel.test(latin),
    hasDialogToken: latin.indexOf('dialog') >= 0
  };
}

const args = parseArgs(process.argv.slice(2));
const builtPath = args.built ? path.resolve(args.built) : '';
const frozenPath = args.frozen ? path.resolve(args.frozen) : '';
const resultsDir = args.results ? path.resolve(args.results) : '';
const EVIDENCE = {
  tool: 'login-entry.asar.a3',
  format: '@electron/asar pickle header: u32@0=4, u32@4=headerSize, u32@8=headerSize-4, u32@12=jsonLength, json@16, dataStart=8+headerSize, offset relative & 4-byte aligned',
  generatedAt: new Date().toISOString(),
  inputs: { built: builtPath, frozen: frozenPath },
  packages: {},
  checks: [],
  summary: null,
  blocked: null
};

function writeEvidence() {
  EVIDENCE.checks = CHECK;
  EVIDENCE.summary = { pass, fail };
  if (!resultsDir) return;
  try {
    if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = path.join(resultsDir, 'asar-a3-' + stamp + '.json');
    fs.writeFileSync(target, JSON.stringify(EVIDENCE, null, 2), 'utf8');
    console.log('[INFO] 证据 JSON：' + target);
  } catch (e) {
    console.log('[INFO] 证据写入失败：' + e.message);
  }
}

function blocked(message) {
  EVIDENCE.blocked = message;
  console.log('[BLOCKED] ' + message);
  writeEvidence();
  process.exit(2);
}

function describe(a) {
  const s = a.stats;
  return 'sha256=' + crypto.createHash('sha256').update(a.buf).digest('hex') +
    ' total=' + s.total + ' headerSize=' + s.headerSize + ' 载荷=' + s.payload + ' jsonLen=' + s.jsonLength +
    ' pad=' + s.padding + ' dataStart=' + s.dataStart + ' dataSize=' + s.dataSize +
    ' 条目=' + s.leaves + ' unpacked=' + s.unpacked + ' link=' + s.links + ' offset数字=' + s.offsetAsNumber;
}

(function main() {
  if (!builtPath || !frozenPath) blocked('必须同时提供 --built 与 --frozen（新旧包差分不允许跳过）');
  for (const p of [builtPath, frozenPath]) if (!fs.existsSync(p)) blocked('文件不存在：' + p);

  let built, frozen;
  try { built = openArchive(builtPath); }
  catch (e) { blocked('新包格式不符（' + builtPath + '）：' + (e instanceof FormatError ? e.message : e.stack)); }
  try { frozen = openArchive(frozenPath); }
  catch (e) { blocked('旧包格式不符（' + frozenPath + '）：' + (e instanceof FormatError ? e.message : e.stack)); }

  info('新包 ' + describe(built));
  info('旧包 ' + describe(frozen));
  EVIDENCE.packages.new = { path: builtPath, ...built.stats, sha256: crypto.createHash('sha256').update(built.buf).digest('hex') };
  EVIDENCE.packages.frozen = { path: frozenPath, ...frozen.stats, sha256: crypto.createHash('sha256').update(frozen.buf).digest('hex') };

  const sNew = scan(built);
  const sOld = scan(frozen);
  info('新包 标记条目=' + sNew.markerHits.length + ' 升级面板条目=' + sNew.updatePanelEntries + ' 登录页条目=[' + sNew.loginEntries.join('; ') + ']');
  info('旧包 标记条目=' + sOld.markerHits.length + ' 升级面板条目=' + sOld.updatePanelEntries + ' 登录页条目=[' + sOld.loginEntries.join('; ') + ']');

  check('B1 官方格式解析：u32@0=4 / u32@8=H-4 / json@16 / dataStart=8+H（新包）',
    built.stats.dataStart === 8 + built.stats.headerSize && built.stats.payload === built.stats.headerSize - 4,
    'dataStart=' + built.stats.dataStart + ' H=' + built.stats.headerSize);
  check('B2 官方格式解析（旧包）',
    frozen.stats.dataStart === 8 + frozen.stats.headerSize && frozen.stats.payload === frozen.stats.headerSize - 4,
    'dataStart=' + frozen.stats.dataStart);
  check('B3 数据区无越界无重叠（新包）', Number.isSafeInteger(built.dataSize) && built.dataSize >= 0, 'dataSize=' + built.dataSize);
  check('B4 数据区无越界无重叠（旧包）', Number.isSafeInteger(frozen.dataSize) && frozen.dataSize >= 0, 'dataSize=' + frozen.dataSize);

  check('F1 新包含 login 专属标记条目', sNew.markerHits.length >= 1, '命中=' + sNew.markerHits.length);
  if (sNew.markerHits.length >= 1) {
    const hit = inspectHit(sNew.markerHits[0]);
    EVIDENCE.markerHit = hit;
    check('F2 标记条目同时含登录页结构（desktop-auth + auth-panel）', hit.hasLoginClass && hit.hasAuthPanel, hit.path);
    check('F3 标记邻近含 data-testid 属性', hit.hasTestIdAttr, hit.path);
    check('F4 标记邻近含“一键升级”文案', hit.hasLabel, hit.path);
    check('F5 标记条目含升级面板结构', hit.hasUpdatePanel && hit.hasDialogToken, hit.path);
    check('F6 标记条目为脚本/HTML 且非 unpacked', /\.(js|mjs|cjs|html?)$/i.test(hit.path), hit.path);
    const allStructured = sNew.markerHits.every(h => inspectHit(h).hasLoginClass);
    check('F7 所有标记条目均属登录页脚本（无游离标记）', allStructured, '命中=' + sNew.markerHits.length);
  }

  check('F8 旧包不存在 login 专属标记', sOld.markerHits.length === 0, '命中=' + sOld.markerHits.length + (sOld.markerHits.length ? ' [' + sOld.markerHits.map(h => h.path).join('; ') + ']' : ''));
  check('F9 旧包含登录页基线结构（证明差分是入口而非整页缺失）', sOld.loginEntries.length >= 1, '条目=[' + sOld.loginEntries.slice(0, 3).join('; ') + ']');
  check('F10 新旧包均含同一升级面板结构（对照升级组件未缺失）', sNew.updatePanelEntries >= 1 && sOld.updatePanelEntries >= 1,
    '新=' + sNew.updatePanelEntries + ' 旧=' + sOld.updatePanelEntries);
  check('F11 新旧包内容不同（非同一文件）',
    EVIDENCE.packages.new.sha256 !== EVIDENCE.packages.frozen.sha256,
    EVIDENCE.packages.new.sha256.slice(0, 12) + ' vs ' + EVIDENCE.packages.frozen.sha256.slice(0, 12));

  writeEvidence();
  console.log('合计 ' + (pass + fail) + ' 项：PASS ' + pass + '，FAIL ' + fail);
  process.exit(fail === 0 ? 0 : 1);
})();
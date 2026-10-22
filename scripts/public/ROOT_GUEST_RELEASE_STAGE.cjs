'use strict';
/*
 * ROOT_GUEST_RELEASE_STAGE — C6 host 1.6.2 -> 1.7.0 release staging + real-UI observation.
 *
 * Run inside the existing C6 Windows Sandbox as WDAGUtilityAccount.
 * Root/operator executes; the user performs all UI clicks.
 * No UIAutomation, no SendKeys, no synthetic clicks, no approval creation.
 *
 * Writes only to the new staging tree and C:\XjyReleaseResults.
 * Never writes F:, host program, employee slots, approvals or journals.
 * Never kills a process. Installer stdout/stderr are files, not inherited pipes.
 *
 *   node ROOT_GUEST_RELEASE_STAGE.cjs
 *   node ROOT_GUEST_RELEASE_STAGE.cjs finalize [--state FILE] [--popup-text TEXT] [--popup-exit-code N]
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const os = require('node:os');

const RES = 'C:\\XjyReleaseResults';
const CAND = 'C:\\XjyReleaseCandidate';
const ASSEMBLY = path.join(CAND, 'build', 'assembly.json');
const PKG = path.join(CAND, 'build', 'package');
const LOCAL = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const HOST_ROOT = path.join(LOCAL, 'XjyGenuine150Host-a2');
const HOST = path.join(HOST_ROOT, 'program');
const STAGE_ROOT = path.join(LOCAL, 'XjyRootRelease170');
const STAGE = path.join(STAGE_ROOT, 'program');
const UPGRADE = path.join(STAGE, '一键升级.cmd');
const DATA = 'F:\\鑫金源珠宝资料';
const C6_ID = 'c6b4f1f6-411e-4272-b4a4-a1ca62701e39';
const C6_HOSTNAMES = new Set(['fe0b3f51-3704-4e3e-a876-8c6d64ce551f', C6_ID]);
const MEMBER_COUNT = 3293;
const TARGET_VERSION = '1.7.0';
const OBSERVE_MS = 20 * 60 * 1000;
const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const COMSPEC = 'C:\\Windows\\System32\\cmd.exe';

const RUN_ID = new Date().toISOString().replace(/[-:.]/g, '') + '-' + crypto.randomBytes(3).toString('hex');
const ROUND_DIR = path.join(RES, 'rounds', RUN_ID);
const DB_COPY_DIR = path.join(RES, 'db-wal-copies', RUN_ID);
const EXIT_FILE = path.join(ROUND_DIR, 'installer-exit.txt');
const STDOUT_LOG = path.join(RES, 'stdout-' + RUN_ID + '.log');
const STDERR_LOG = path.join(RES, 'stderr-' + RUN_ID + '.log');

const run = {
  schemaVersion: 1,
  purpose: 'ROOT_GUEST_RELEASE_STAGE',
  runId: RUN_ID,
  node: process.version,
  startedAt: new Date().toISOString(),
  status: 'STARTING',
  ok: false,
  passed: false,
  pending: false,
  failure: false,
  c6: { sandboxId: C6_ID, hostname: os.hostname(), user: os.userInfo().username, wdag: false },
  paths: {
    results: RES,
    round: ROUND_DIR,
    before: path.join(ROUND_DIR, 'before.json'),
    beforeCurrent: path.join(RES, 'before.json'),
    state: path.join(ROUND_DIR, 'state.json'),
    stateCurrent: path.join(RES, 'state.json'),
    final: path.join(ROUND_DIR, 'final.json'),
    stdout: STDOUT_LOG,
    stderr: STDERR_LOG,
    exitFile: EXIT_FILE,
    host: HOST,
    hostRoot: HOST_ROOT,
    stage: STAGE,
    stageRoot: STAGE_ROOT,
    data: DATA,
    candidate: CAND
  },
  guard: null,
  package: null,
  target: null,
  before: null,
  cmd: null,
  targetState: null,
  failurePopup: null,
  error: null
};

const now = () => new Date().toISOString();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function fail(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  throw error;
}
function errInfo(error) {
  return {
    code: (error && (error.code || error.name)) || 'ERROR',
    message: String((error && error.message) || error),
    ...(error && error.details ? { details: error.details } : {})
  };
}
function exists(p) { try { fs.lstatSync(p); return true; } catch (e) { return false; } }
function canon(p) {
  let s;
  try { s = path.resolve(String(p)); } catch (e) { return ''; }
  if (s.startsWith('\\\\?\\')) s = s.slice(4);
  if (s.startsWith('\\??\\')) s = s.slice(4);
  return s.replace(/\//g, '\\').toLowerCase();
}
function samePath(a, b) { return !!a && !!b && canon(a) === canon(b); }
function inside(child, parent) {
  const c = canon(child), p = canon(parent);
  return !!c && !!p && (c === p || c.startsWith(p.endsWith('\\') ? p : p + '\\'));
}
function shaBytes(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function shaFile(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const s = fs.createReadStream(file);
    let settled = false;
    s.on('data', b => h.update(b));
    s.once('error', e => { if (!settled) { settled = true; reject(e); } });
    s.once('end', () => { if (!settled) { settled = true; resolve(h.digest('hex')); } });
  });
}
function readText(file, maxBytes) {
  const limit = Math.max(1, maxBytes || 65536);
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = Math.min(fs.fstatSync(fd).size, limit);
    const buf = Buffer.alloc(size);
    const n = size ? fs.readSync(fd, buf, 0, size, 0) : 0;
    return buf.subarray(0, n).toString('utf8').replace(/^\uFEFF/, '');
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch (e) { /* ignore */ } }
  }
}
function readJson(file) { return JSON.parse(readText(file, 64 * 1024 * 1024)); }
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}
function tail(file, maxBytes) {
  try {
    const st = fs.statSync(file), len = Math.min(st.size, maxBytes || 8192);
    const buf = Buffer.alloc(len);
    const fd = fs.openSync(file, 'r');
    try { fs.readSync(fd, buf, 0, len, Math.max(0, st.size - len)); }
    finally { fs.closeSync(fd); }
    return buf.toString('utf8');
  } catch (e) { return ''; }
}

function ensureResults() {
  fs.mkdirSync(RES, { recursive: true });
  if (!fs.statSync(RES).isDirectory()) fail('RESULTS_NOT_DIR', '结果目录不是目录：' + RES);
  const probe = path.join(RES, '.write-test-' + process.pid + '-' + Date.now());
  fs.writeFileSync(probe, 'ok', { encoding: 'utf8', flag: 'wx' });
  fs.unlinkSync(probe);
  fs.mkdirSync(ROUND_DIR, { recursive: true });
  fs.mkdirSync(DB_COPY_DIR, { recursive: true });
}

function writeProgress(phase, status, extra) {
  try {
    writeJson(path.join(RES, 'progress.json'), {
      schemaVersion: 1, purpose: 'ROOT_GUEST_RELEASE_STAGE_PROGRESS', runId: RUN_ID,
      phase: phase, status: status, at: now(), ...(extra || {})
    });
  } catch (e) { run.progressError = String(e.code || e.message || e); }
}

function relParts(rel) {
  if (typeof rel !== 'string' || rel.length < 1 || rel.length > 1024) fail('MEMBER_PATH_INVALID', '包成员路径长度无效。', { path: rel });
  if (rel !== rel.normalize('NFC')) fail('MEMBER_PATH_ALIAS', '包成员路径不是规范 Unicode。', { path: rel });
  if (rel.includes('\\')) fail('MEMBER_PATH_ALIAS', '包成员路径含反斜杠别名。', { path: rel });
  if (rel.startsWith('/') || rel.endsWith('/') || rel.includes('//')) fail('MEMBER_PATH_ALIAS', '包成员路径不是规范相对路径。', { path: rel });
  if (/^[A-Za-z]:/.test(rel) || /[\x00-\x1f<>:"|?*]/.test(rel)) fail('MEMBER_PATH_UNSAFE', '包成员路径含不安全字符。', { path: rel });
  const parts = rel.split('/');
  for (const part of parts) {
    if (!part || part === '.' || part === '..' || /[. ]$/.test(part)) fail('MEMBER_PATH_UNSAFE', '包成员路径含空段/点段/尾随点或空格。', { path: rel });
    if (Buffer.byteLength(part, 'utf8') > 255) fail('MEMBER_PATH_UNSAFE', '包成员路径段过长。', { path: rel });
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(part)) fail('MEMBER_PATH_UNSAFE', '包成员路径含 Windows 保留名。', { path: rel });
  }
  if (path.posix.normalize(rel) !== rel) fail('MEMBER_PATH_ALIAS', '包成员路径可被规范化，拒绝别名。', { path: rel });
  return parts;
}

function checkDir(p, label, allowRootLink) {
  let lst;
  try { lst = fs.lstatSync(p); } catch (e) { fail(label + '_MISSING', label + ' 不存在。', { path: p }); }
  let st = lst;
  if (lst.isSymbolicLink()) {
    if (!allowRootLink) fail(label + '_REPARSE', label + ' 是 reparse/symlink。', { path: p });
    try { st = fs.statSync(p); } catch (e) { fail(label + '_UNRESOLVED', label + ' reparse 目标不可用。', { path: p }); }
  }
  if (!st.isDirectory()) fail(label + '_NOT_DIR', label + ' 不是目录。', { path: p });
  let real;
  try { real = fs.realpathSync.native(p); } catch (e) { fail(label + '_UNRESOLVED', label + ' 无法解析真实路径。', { path: p }); }
  return { path: p, real: real, stat: lst };
}

function psJson(script, timeoutMs) {
  return new Promise(resolve => {
    let child;
    try {
      child = cp.spawn(POWERSHELL, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
        { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) { resolve({ error: String(e.message), stdout: '', stderr: '' }); return; }
    let so = '', se = '', done = false;
    const finish = value => { if (done) return; done = true; clearTimeout(timer); resolve(value); };
    const timer = setTimeout(() => {
      try { child.stdout.destroy(); child.stderr.destroy(); child.unref(); } catch (e) { /* observer only */ }
      finish({ timeout: true, status: null, stdout: so, stderr: se });
    }, timeoutMs || 30000);
    child.stdout.on('data', b => { so += b.toString('utf8'); if (so.length > 2 * 1024 * 1024) so = so.slice(-2 * 1024 * 1024); });
    child.stderr.on('data', b => { se += b.toString('utf8'); if (se.length > 256 * 1024) se = se.slice(-256 * 1024); });
    child.once('error', e => finish({ error: String(e.message), stdout: so, stderr: se }));
    child.once('close', code => finish({ status: code, stdout: so, stderr: se }));
  });
}

async function collectMaintenance() {
  const script = "$ErrorActionPreference='SilentlyContinue';" +
    "$rows=@(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and ($_.CommandLine -match '(?i)native-delivery|engine-native-entry|一键升级\\.cmd|Prepare-Repeat-Approval|首次安装主机|安装组件') } | ForEach-Object { [pscustomobject]@{pid=[int]$_.ProcessId;ppid=[int]$_.ParentProcessId;name=[string]$_.Name;cmd=([string]$_.CommandLine)} });" +
    "$rows|ConvertTo-Json -Compress -Depth 4";
  const r = await psJson(script, 30000);
  if (r.timeout) fail('MAINTENANCE_CHECK_TIMEOUT', '维护进程检查超时，不能确认无活动维护。');
  if (r.error) fail('MAINTENANCE_CHECK_ERROR', '维护进程检查失败：' + r.error);
  if (r.status !== 0) fail('MAINTENANCE_CHECK_ERROR', '维护进程检查 PowerShell 退出码非 0。', { status: r.status, stderr: (r.stderr || '').slice(-1000) });
  let rows;
  try { rows = JSON.parse((r.stdout || '').replace(/^\uFEFF/, '') || '[]'); }
  catch (e) { fail('MAINTENANCE_CHECK_PARSE', '维护进程检查输出无法解析。', { raw: (r.stdout || '').slice(0, 1000) }); }
  if (!Array.isArray(rows)) rows = rows ? [rows] : [];
  return rows.filter(x => x && x.pid !== process.pid).map(x => ({
    pid: Number(x.pid), ppid: Number(x.ppid), name: String(x.name || ''), cmd: String(x.cmd || '').slice(0, 2000)
  }));
}

function findLocks(roots) {
  const hits = [], reparse = [], seen = new Set();
  let visited = 0, truncated = false;
  const max = 60000;
  for (const root of roots) {
    if (!root || !exists(root) || seen.has(canon(root))) continue;
    seen.add(canon(root));
    let rst;
    try { rst = fs.lstatSync(root); } catch (e) { continue; }
    if (rst.isSymbolicLink()) { reparse.push({ path: root, reason: 'ROOT_REPARSE' }); continue; }
    if (!rst.isDirectory()) continue;
    const stack = [{ dir: root, depth: 0 }];
    while (stack.length) {
      const cur = stack.pop();
      let entries;
      try { entries = fs.readdirSync(cur.dir, { withFileTypes: true }); } catch (e) { continue; }
      for (const ent of entries) {
        if (++visited > max) { truncated = true; break; }
        const full = path.join(cur.dir, ent.name);
        let st;
        try { st = fs.lstatSync(full); } catch (e) { continue; }
        if (st.isSymbolicLink()) { reparse.push({ path: full }); continue; }
        if (st.isFile() && /\.(lock|lck)$/i.test(ent.name)) hits.push({ path: full, reason: 'LOCK' });
        else if (st.isDirectory() && cur.depth < 5) stack.push({ dir: full, depth: cur.depth + 1 });
      }
      if (truncated) break;
    }
    if (truncated) break;
  }
  return { hits, reparse, truncated };
}

function findSlots() {
  const found = [], bad = [];
  const add = p => {
    let st;
    try { st = fs.lstatSync(p); } catch (e) { return; }
    if (st.isSymbolicLink()) { bad.push({ path: p, reason: 'REPARSE' }); return; }
    if (st.isDirectory() && !found.some(x => samePath(x, p))) found.push(p);
  };
  const stack = [{ dir: LOCAL, depth: 0 }];
  let seen = 0;
  while (stack.length && seen < 800) {
    const cur = stack.pop();
    let entries;
    try { entries = fs.readdirSync(cur.dir, { withFileTypes: true }); } catch (e) { continue; }
    for (const ent of entries) {
      if (++seen > 800) break;
      if (!ent.isDirectory()) continue;
      const full = path.join(cur.dir, ent.name);
      if (/^员工程序-slot-/i.test(ent.name)) { add(full); continue; }
      if (cur.depth === 0 && /^Xjy|^鑫金源|员工程序/i.test(ent.name)) stack.push({ dir: full, depth: 1 });
    }
  }
  if (bad.length) fail('EMPLOYEE_SLOT_REPARSE', '员工 slot 根是 reparse/symlink，拒绝继续。', { slots: bad });
  if (!found.length) fail('EMPLOYEE_SLOT_MISSING', '未找到必须保留的员工程序 slot。');
  return found.sort();
}

async function snapshotSlot(root) {
  const entries = [], keyPaths = [];
  const stack = [{ dir: root, rel: '', depth: 0 }];
  let dirs = 0, bytes = 0, seen = 0;
  while (stack.length) {
    const cur = stack.pop();
    let ents;
    try { ents = fs.readdirSync(cur.dir, { withFileTypes: true }); } catch (e) { fail('SLOT_READ_FAILED', '员工 slot 读取失败。', { path: cur.dir }); }
    for (const ent of ents) {
      if (++seen > 60000) fail('SLOT_TOO_LARGE', '员工 slot 条目过多。', { path: root });
      const full = path.join(cur.dir, ent.name);
      const rel = cur.rel ? cur.rel + '/' + ent.name : ent.name;
      let st;
      try { st = fs.lstatSync(full); } catch (e) { fail('SLOT_READ_FAILED', '员工 slot 条目读取失败。', { path: full }); }
      if (st.isSymbolicLink()) {
        let target = '';
        try { target = fs.readlinkSync(full); } catch (e) { target = '?'; }
        entries.push([rel, 'l', 0, 0, target]);
        continue;
      }
      if (st.isDirectory()) {
        dirs++;
        if (cur.depth < 64) stack.push({ dir: full, rel: rel, depth: cur.depth + 1 });
      } else if (st.isFile()) {
        bytes += st.size;
        entries.push([rel, 'f', st.size, Math.round(st.mtimeMs)]);
        if (/^(xjy-install-activation\.json|version)$/i.test(ent.name)) keyPaths.push({ rel: rel, full: full });
      } else {
        entries.push([rel, 'o', st.size, 0]);
      }
    }
  }
  entries.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  keyPaths.sort((a, b) => a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0);
  const keys = {};
  for (const k of keyPaths.slice(0, 8)) keys[k.rel] = await shaFile(k.full);
  const marker = (() => { try { return readJson(path.join(root, 'xjy-install-activation.json')); } catch (e) { return null; } })();
  let version = null;
  try { version = readText(path.join(root, 'version'), 4096).trim(); } catch (e) { version = null; }
  return {
    path: root, files: entries.length, dirs: dirs, bytes: bytes,
    entriesHash: shaBytes(entries.map(e => e.join('\0')).join('\n')),
    keys: keys, keysHash: shaBytes(JSON.stringify(keys)), marker: marker, version: version
  };
}

async function snapshotSlots() {
  const roots = findSlots(), slots = [];
  for (const root of roots) slots.push(await snapshotSlot(root));
  return slots;
}

function readMarker() {
  const p = path.join(HOST, 'xjy-install-activation.json');
  try {
    const st = fs.lstatSync(p);
    if (!st.isFile() || st.isSymbolicLink()) return { exists: false, path: p, error: 'NOT_REGULAR' };
    const value = readJson(p);
    return { ...value, exists: true, path: p };
  } catch (e) { return { exists: false, path: p, error: String(e.code || e.message || e) }; }
}
function markerMatches(marker, version) {
  return !!marker && marker.exists === true && marker.programVersion === version && marker.role === 'host' && samePath(marker.installationDir, HOST);
}

function readJournal() {
  const candidates = [path.join(HOST_ROOT, '.program.xjy-engine-state', 'journal.json'), path.join(HOST, '.program.xjy-engine-state', 'journal.json')];
  for (const p of candidates) {
    if (!exists(p)) continue;
    try {
      const st = fs.lstatSync(p);
      if (st.isSymbolicLink() || !st.isFile()) return { exists: true, path: p, error: 'NOT_REGULAR', committed: false, phase: null, active: true };
      const raw = fs.readFileSync(p), j = JSON.parse(raw.toString('utf8').replace(/^\uFEFF/, ''));
      let payload = j && j.payload;
      if (typeof payload === 'string') { try { payload = JSON.parse(payload); } catch (e) { payload = null; } }
      if (!payload || typeof payload !== 'object') payload = {};
      const phaseRaw = payload.phase !== undefined ? payload.phase : (j && j.phase !== undefined ? j.phase : (j && j.state));
      const phase = phaseRaw === undefined || phaseRaw === null ? null : String(phaseRaw).toLowerCase();
      const terminal = ['committed', 'rolled-back', 'rolledback', 'aborted', 'failed', 'cancelled', 'canceled'];
      const committed = phase === 'committed' || (phase === null && j && j.committed === true);
      return {
        exists: true, path: p, sha256: shaBytes(raw), phase: phase, committed: committed,
        terminal: terminal.includes(phase), active: !committed && !terminal.includes(phase),
        targetVersion: payload.targetVersion || payload.version || null,
        role: payload.role || null, transactionId: payload.transactionId || null
      };
    } catch (e) {
      return { exists: true, path: p, error: String(e.code || e.message || e), committed: false, phase: null, active: true };
    }
  }
  return { exists: false, path: candidates[0], phase: null, committed: false, active: false, terminal: false };
}

function inspectTarget() {
  const marker = readMarker(), journal = readJournal();
  const version = (() => { try { return readText(path.join(HOST, 'version'), 4096).trim(); } catch (e) { return null; } })();
  const markerOk = markerMatches(marker, TARGET_VERSION);
  const journalTargetOk = journal.committed && (!journal.targetVersion || journal.targetVersion === TARGET_VERSION) && (!journal.role || journal.role === 'host');
  return { at: now(), marker: marker, markerOk: markerOk, version: version, journal: journal, committed: journalTargetOk };
}

async function collectGuard() {
  const user = os.userInfo().username, hostname = os.hostname(), marker = readMarker(), journal = readJournal(), slots = findSlots();
  const g = {
    at: now(),
    identity: {
      hostname: hostname, hostnameLower: hostname.toLowerCase(), user: user, wdag: /^WDAGUtilityAccount$/i.test(user),
      sandboxId: C6_ID, hostnameAccepted: C6_HOSTNAMES.has(hostname.toLowerCase())
    },
    hostMarker: marker,
    hostVersion: (() => { try { return readText(path.join(HOST, 'version'), 4096).trim(); } catch (e) { return null; } })(),
    journal: journal, employeeSlots: slots, maintenance: [], locks: [], checks: []
  };
  run.guard = g;
  const check = (name, ok, detail) => { g.checks.push({ name: name, ok: !!ok, ...(detail === undefined ? {} : { detail: detail }) }); };
  check('WDAGUtilityAccount', g.identity.wdag, user);
  check('known C6 hostname', g.identity.hostnameAccepted, hostname);
  check('host marker 1.6.2/host', markerMatches(marker, '1.6.2'), marker);
  check('host marker installationDir', !!(marker && marker.exists && samePath(marker.installationDir, HOST)), HOST);
  check('employee slot present', slots.length > 0, slots);
  check('staging target absent (CreateNew)', !exists(STAGE), STAGE);

  const maintenance = await collectMaintenance();
  g.maintenance = maintenance;
  check('no active maintenance process', maintenance.length === 0, maintenance);

  const locks = findLocks([HOST_ROOT, path.join(LOCAL, '鑫金源珠宝'), path.join(LOCAL, '鑫金源珠宝安装'), STAGE_ROOT, ...slots]);
  g.locks = locks;
  check('no .lock in scanned roots', locks.hits.length === 0 && locks.truncated === false, locks.hits);

  const journalOk = !journal.exists || journal.committed || journal.terminal;
  check('no active journal', journalOk, journal);
  check('journal consistent with 1.6.2 host', !(journal.exists && journal.committed && !markerMatches(marker, '1.6.2')), journal);
  check('journal readable', !journal.error, journal);
  g.pass = g.checks.every(c => c.ok);
  if (!g.pass) fail('GUARD_FAILED', 'C6/主机保护性预检未通过；未复制、未启动安装器。', { checks: g.checks });
  return g;
}

async function loadPackage() {
  const cand = checkDir(CAND, 'CANDIDATE', true);
  const pkg = checkDir(PKG, 'PACKAGE_ROOT', false);
  if (!inside(pkg.real, cand.real)) fail('PACKAGE_OUTSIDE_CANDIDATE', 'package 根不在 candidate 内。', { package: pkg.real, candidate: cand.real });
  let ast;
  try { ast = fs.lstatSync(ASSEMBLY); } catch (e) { fail('ASSEMBLY_MISSING', 'assembly.json 不存在。', { path: ASSEMBLY }); }
  if (!ast.isFile() || ast.isSymbolicLink()) fail('ASSEMBLY_REPARSE', 'assembly.json 不是普通文件。', { path: ASSEMBLY });
  if (!inside(fs.realpathSync.native(ASSEMBLY), cand.real)) fail('ASSEMBLY_OUTSIDE_CANDIDATE', 'assembly.json 真实路径越界。');
  const asmSha = await shaFile(ASSEMBLY), asm = readJson(ASSEMBLY);
  if (!asm || typeof asm !== 'object' || !Array.isArray(asm.files)) fail('ASSEMBLY_SCHEMA', 'assembly.json 缺少 files 数组。');
  if (asm.files.length !== MEMBER_COUNT) fail('MEMBER_COUNT_MISMATCH', 'package 成员数不是 ' + MEMBER_COUNT + '。', { actual: asm.files.length });
  if (asm.publication && asm.publication.targetVersion && asm.publication.targetVersion !== TARGET_VERSION) {
    fail('ASSEMBLY_TARGET_VERSION', 'assembly 目标版本不是 1.7.0。', { targetVersion: asm.publication.targetVersion });
  }
  const rows = [], seen = new Set();
  let totalBytes = 0;
  for (const row of asm.files) {
    if (!row || typeof row !== 'object') fail('MEMBER_SCHEMA', 'package 成员不是对象。');
    const parts = relParts(row.path), key = parts.join('/').toLowerCase();
    if (seen.has(key)) fail('MEMBER_PATH_ALIAS', 'package 成员路径大小写重复/别名。', { path: row.path });
    seen.add(key);
    if (!Number.isSafeInteger(row.size) || row.size < 0) fail('MEMBER_SIZE', 'package 成员 size 无效。', { path: row.path });
    const sha = String(row.sha256 || '').toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(sha)) fail('MEMBER_SHA', 'package 成员 sha256 无效。', { path: row.path });
    rows.push({ path: row.path, parts: parts, size: row.size, sha256: sha });
    totalBytes += row.size;
  }
  rows.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  run.package = { assembly: ASSEMBLY, assemblySha256: asmSha, packageRoot: PKG, memberCount: rows.length, totalBytes: totalBytes };
  return { assembly: ASSEMBLY, assemblySha256: asmSha, packageRoot: PKG, packageReal: pkg.real, rows: rows, totalBytes: totalBytes };
}

function ensureTargetParent(dir) {
  const rel = path.relative(STAGE, dir);
  if (rel.startsWith('..') || path.isAbsolute(rel)) fail('TARGET_PATH_ESCAPE', '目标父目录越界。', { dir: dir });
  let cur = STAGE;
  for (const part of rel.split(path.sep)) {
    if (!part || part === '.') continue;
    cur = path.join(cur, part);
    if (exists(cur)) {
      const st = fs.lstatSync(cur);
      if (!st.isDirectory() || st.isSymbolicLink()) fail('TARGET_REPARSE', '目标父目录是 reparse/symlink。', { path: cur });
    } else fs.mkdirSync(cur);
  }
}

function auditTarget() {
  const files = [], stack = [{ dir: STAGE, depth: 0 }];
  while (stack.length) {
    const cur = stack.pop();
    for (const ent of fs.readdirSync(cur.dir, { withFileTypes: true })) {
      const full = path.join(cur.dir, ent.name), st = fs.lstatSync(full);
      if (st.isSymbolicLink()) fail('TARGET_REPARSE', '目标含 reparse/symlink。', { path: full });
      if (st.isDirectory()) { if (cur.depth > 64) fail('TARGET_TOO_DEEP', '目标目录过深。'); stack.push({ dir: full, depth: cur.depth + 1 }); }
      else if (st.isFile()) files.push({ path: full, size: st.size });
      else fail('TARGET_SPECIAL_FILE', '目标含非普通文件。', { path: full });
    }
  }
  return { files: files.length, bytes: files.reduce((a, x) => a + x.size, 0) };
}

async function stagePackage(pkg) {
  if (exists(STAGE)) fail('STAGE_TARGET_EXISTS', '目标 program 已存在；CreateNew 不覆盖、不删除旧目录。', { path: STAGE });
  fs.mkdirSync(STAGE_ROOT, { recursive: true });
  const rootStat = fs.lstatSync(STAGE_ROOT);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail('STAGE_ROOT_REPARSE', 'staging 根不是普通目录。', { path: STAGE_ROOT });
  fs.mkdirSync(STAGE);
  const stageReal = fs.realpathSync.native(STAGE);
  if (!samePath(stageReal, STAGE)) fail('TARGET_REPARSE', 'staging 目标真实路径不一致。', { path: STAGE, real: stageReal });
  let done = 0, bytes = 0;
  for (const row of pkg.rows) {
    const src = path.join(PKG, ...row.parts);
    let sst;
    try { sst = fs.lstatSync(src); } catch (e) { fail('SOURCE_MISSING', '源成员缺失。', { path: row.path }); }
    if (!sst.isFile() || sst.isSymbolicLink()) fail('SOURCE_NOT_REGULAR', '源成员不是普通文件。', { path: row.path });
    if (sst.nlink > 1) fail('SOURCE_HARDLINK_ALIAS', '源成员是硬链接别名。', { path: row.path, nlink: sst.nlink });
    if (!samePath(fs.realpathSync.native(src), path.join(pkg.packageReal, ...row.parts))) fail('SOURCE_REPARSE_OR_ALIAS', '源成员真实路径不一致（reparse/8.3/别名）。', { path: row.path });
    if (sst.size !== row.size) fail('SOURCE_SIZE_MISMATCH', '源成员 size 与 assembly 不一致。', { path: row.path, actual: sst.size, expected: row.size });
    const srcSha = await shaFile(src);
    if (srcSha !== row.sha256) fail('SOURCE_HASH_MISMATCH', '源成员 hash 与 assembly 不一致。', { path: row.path, actual: srcSha, expected: row.sha256 });
    const dst = path.join(STAGE, ...row.parts);
    ensureTargetParent(path.dirname(dst));
    try { fs.copyFileSync(src, dst, fs.constants.COPYFILE_EXCL); }
    catch (e) { fail('TARGET_CREATE_FAILED', 'CreateNew 复制失败。', { path: row.path, code: e.code }); }
    let dstStat;
    try { dstStat = fs.lstatSync(dst); } catch (e) { fail('TARGET_MISSING_AFTER_COPY', '复制后目标缺失。', { path: row.path }); }
    if (!dstStat.isFile() || dstStat.isSymbolicLink() || dstStat.size !== row.size) fail('TARGET_NOT_REGULAR_OR_SIZE', '目标不是等尺寸普通文件。', { path: row.path });
    if (!samePath(fs.realpathSync.native(dst), dst)) fail('TARGET_REPARSE', '目标真实路径不一致。', { path: row.path });
    const dstSha = await shaFile(dst);
    if (dstSha !== srcSha) fail('TARGET_HASH_MISMATCH', '目标 hash 与源不相等。', { path: row.path, actual: dstSha, expected: srcSha });
    done++; bytes += row.size;
    if (done === 1 || done % 25 === 0 || done === pkg.rows.length) {
      writeProgress('STAGING', 'RUNNING', { stagedFiles: done, totalFiles: pkg.rows.length, stagedBytes: bytes, totalBytes: pkg.totalBytes });
    }
  }
  const audit = auditTarget();
  if (audit.files !== MEMBER_COUNT || audit.bytes !== pkg.totalBytes) {
    fail('TARGET_AUDIT', '目标文件数/字节数与 assembly 不一致。', { files: audit.files, bytes: audit.bytes, expectedFiles: MEMBER_COUNT, expectedBytes: pkg.totalBytes });
  }
  if (!exists(UPGRADE)) fail('UPGRADE_CMD_MISSING', '目标中缺少真实 一键升级.cmd。', { path: UPGRADE });
  const ust = fs.lstatSync(UPGRADE);
  if (!ust.isFile() || ust.isSymbolicLink()) fail('UPGRADE_CMD_NOT_REGULAR', '一键升级.cmd 不是普通文件。', { path: UPGRADE });
  return { path: STAGE, real: stageReal, files: audit.files, bytes: audit.bytes, upgrade: UPGRADE, upgradeSize: ust.size, upgradeSha256: await shaFile(UPGRADE) };
}

function isDbWal(rel) {
  return /\.(?:db|sqlite|sqlite3|mdb|accdb)(?:-(?:wal|shm))?$/i.test(rel) || /\.(?:db|sqlite|sqlite3)-(?:wal|shm)$/i.test(rel);
}

async function snapshotData(copyDb) {
  const dataStat = fs.lstatSync(DATA);
  if (!dataStat.isDirectory() || dataStat.isSymbolicLink()) fail('DATA_ROOT', 'F: 数据根不是普通目录。', { path: DATA });
  const files = [], dbWal = [], stack = [{ dir: DATA, rel: '', depth: 0 }];
  let dirs = 0, bytes = 0, visited = 0;
  while (stack.length) {
    const cur = stack.pop();
    let ents;
    try { ents = fs.readdirSync(cur.dir, { withFileTypes: true }); }
    catch (e) { fail('DATA_READ_FAILED', '数据目录读取失败；未写入。', { path: cur.dir }); }
    for (const ent of ents) {
      if (++visited > 200000) fail('DATA_TREE_TOO_LARGE', '数据树条目过多，停止。');
      const full = path.join(cur.dir, ent.name), rel = cur.rel ? cur.rel + '/' + ent.name : ent.name;
      const st = fs.lstatSync(full);
      if (st.isSymbolicLink()) fail('DATA_REPARSE', '数据树含 reparse/symlink，停止；未写入。', { path: full });
      if (st.isDirectory()) { dirs++; if (cur.depth < 64) stack.push({ dir: full, rel: rel, depth: cur.depth + 1 }); continue; }
      if (!st.isFile()) fail('DATA_SPECIAL_FILE', '数据树含非普通文件，停止。', { path: full });
      if (files.length >= 100000) fail('DATA_TOO_MANY_FILES', '数据文件过多，停止。');
      const h = await shaFile(full), st2 = fs.lstatSync(full);
      if (!st2.isFile() || st2.size !== st.size || st2.mtimeMs !== st.mtimeMs) fail('DATA_CHANGED_DURING_READ', '哈希期间数据文件发生变化。', { path: rel });
      files.push({ path: rel, size: st.size, sha256: h, mtime: st.mtime.toISOString() });
      bytes += st.size;
      if (copyDb && isDbWal(rel)) {
        const cpPath = path.join(DB_COPY_DIR, ...rel.split('/'));
        fs.mkdirSync(path.dirname(cpPath), { recursive: true });
        try { fs.copyFileSync(full, cpPath, fs.constants.COPYFILE_EXCL); }
        catch (e) { fail('DB_COPY_FAILED', 'DB/WAL 副本创建失败。', { path: rel, code: e.code }); }
        const cpStat = fs.lstatSync(cpPath);
        if (!cpStat.isFile() || cpStat.isSymbolicLink() || cpStat.size !== st.size) fail('DB_COPY_MISMATCH', 'DB/WAL 副本尺寸不符。', { path: rel });
        const csha = await shaFile(cpPath);
        if (csha !== h) fail('DB_COPY_HASH_MISMATCH', 'DB/WAL 副本 hash 不符。', { path: rel });
        dbWal.push({ path: rel, size: st.size, sha256: h, copyPath: cpPath, copySha256: csha });
      }
    }
  }
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return {
    root: DATA, at: now(), files: files, fileCount: files.length, dirs: dirs, bytes: bytes,
    treeHash: shaBytes(files.map(f => f.path + '\0' + f.size + '\0' + f.sha256).join('\n')), dbWal: dbWal
  };
}

function compareData(beforeFiles, afterFiles) {
  const b = new Map(beforeFiles.map(f => [f.path.toLowerCase(), f])), a = new Map(afterFiles.map(f => [f.path.toLowerCase(), f]));
  const diff = [];
  for (const [k, x] of b) {
    const y = a.get(k);
    if (!y) diff.push({ path: x.path, kind: 'missing', beforeSha256: x.sha256 });
    else if (y.size !== x.size || y.sha256 !== x.sha256) diff.push({ path: x.path, kind: 'changed', beforeSize: x.size, afterSize: y.size, beforeSha256: x.sha256, afterSha256: y.sha256 });
  }
  for (const [k, y] of a) if (!b.has(k)) diff.push({ path: y.path, kind: 'added', afterSha256: y.sha256, afterSize: y.size });
  diff.sort((x, y) => x.path < y.path ? -1 : x.path > y.path ? 1 : 0);
  return diff;
}

function compareSlots(beforeSlots, afterSlots) {
  const b = new Map(beforeSlots.map(s => [canon(s.path), s])), a = new Map(afterSlots.map(s => [canon(s.path), s]));
  const diff = [];
  for (const [k, x] of b) {
    const y = a.get(k);
    if (!y) diff.push({ path: x.path, kind: 'missing' });
    else if (y.entriesHash !== x.entriesHash || y.keysHash !== x.keysHash) diff.push({ path: x.path, kind: 'changed' });
  }
  for (const [k, y] of a) if (!b.has(k)) diff.push({ path: y.path, kind: 'added' });
  return diff;
}

function writeBefore(pkg, target, data, slots) {
  const before = {
    schemaVersion: 1, purpose: 'ROOT_GUEST_RELEASE_STAGE_BEFORE', runId: RUN_ID, at: now(),
    c6: run.c6, guard: run.guard,
    package: {
      assembly: pkg.assembly, assemblySha256: pkg.assemblySha256, packageRoot: pkg.packageRoot,
      memberCount: pkg.rows.length, totalBytes: pkg.totalBytes,
      members: pkg.rows.map(r => ({ path: r.path, size: r.size, sha256: r.sha256 }))
    },
    target: target, data: data, slots: slots
  };
  writeJson(path.join(ROUND_DIR, 'before.json'), before);
  writeJson(path.join(RES, 'before.json'), before);
  run.before = {
    at: before.at, dataTreeHash: data.treeHash, dataFiles: data.fileCount, dataBytes: data.bytes,
    dataDbWal: data.dbWal.length,
    slots: slots.map(s => ({ path: s.path, files: s.files, bytes: s.bytes, entriesHash: s.entriesHash, keysHash: s.keysHash })),
    memberCount: pkg.rows.length
  };
}

async function readExitFile(file, attempts) {
  const n = Math.max(1, attempts || 1);
  for (let i = 0; i < n; i++) {
    try {
      const text = readText(file, 64).trim();
      if (/^-?\d+$/.test(text)) {
        const value = Number(text);
        if (Number.isSafeInteger(value)) return value;
      }
    } catch (e) { /* not written yet */ }
    if (i + 1 < n) await sleep(100);
  }
  return null;
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === 'EPERM'; }
}

function readPopup(startedAt) {
  const p = path.join(RES, 'popup.json');
  if (!exists(p)) return null;
  try {
    const st = fs.lstatSync(p), o = readJson(p);
    if (!o || typeof o !== 'object') return { text: 'UNKNOWN', exitCode: 'UNKNOWN', source: 'popup.json', error: 'NOT_OBJECT' };
    if (o.runId && o.runId !== RUN_ID) return null;
    if (!o.runId) {
      const at = Date.parse(o.at || ''), started = Date.parse(startedAt || '');
      if (Number.isFinite(at) && Number.isFinite(started) && at < started - 60000) return null;
      if (!Number.isFinite(at) && Number.isFinite(started) && st.mtimeMs < started - 60000) return null;
    }
    const text = typeof o.text === 'string' && o.text.trim() ? o.text.trim().slice(0, 4000) : 'UNKNOWN';
    let exitCode = 'UNKNOWN';
    if (Number.isInteger(o.exitCode)) exitCode = o.exitCode;
    else if (typeof o.exitCode === 'string' && /^-?\d+$/.test(o.exitCode)) exitCode = Number(o.exitCode);
    return { text: text, exitCode: exitCode, button: typeof o.button === 'string' ? o.button : null, at: o.at || null, source: 'popup.json' };
  } catch (e) { return { text: 'UNKNOWN', exitCode: 'UNKNOWN', source: 'popup.json', error: String(e.code || e.message || e) }; }
}

function failurePopup(exitCode, startedAt) {
  const p = readPopup(startedAt);
  if (p) {
    const knownPopupExit = Number.isInteger(p.exitCode);
    return {
      text: p.text || 'UNKNOWN',
      exitCode: knownPopupExit ? p.exitCode : (Number.isInteger(exitCode) ? exitCode : 'UNKNOWN'),
      button: p.button || null, at: p.at || null, source: p.source || 'popup.json',
      ...(knownPopupExit ? {} : { popupExitCode: 'UNKNOWN' }),
      ...(p.error ? { error: p.error } : {})
    };
  }
  return {
    text: 'UNKNOWN', exitCode: Number.isInteger(exitCode) ? exitCode : 'UNKNOWN', button: null,
    source: 'UNKNOWN', note: '用户未提供 popup.json；不猜测弹窗文字。'
  };
}

function uiInstructions(slots) {
  console.log('');
  console.log('=== 需要用户真实 UI 操作（脚本不会点击）===');
  console.log('测试 host（必须选择）：' + HOST + '  [1.6.2 / host]');
  if (slots && slots.length) console.log('员工 slot（必须保留，绝不可选择）：' + slots.join(' ; '));
  console.log('请在真实安装器 UI 中：1) 选择上述测试 host；2) 完成两次批准/确认。');
  console.log('失败弹窗：请先把真实原文写入 ' + path.join(RES, 'popup.json') + '（可含 runId/text/exitCode/at），再点“确定”。');
  console.log('脚本不等待业务子进程；最长观察 20 分钟，若仍在运行会返回 pending，不杀进程。');
  console.log('');
}

async function launchInstaller() {
  if (!exists(UPGRADE)) fail('UPGRADE_CMD_MISSING', '缺少真实 一键升级.cmd。', { path: UPGRADE });
  const env = { ...process.env, SystemRoot: 'C:\\Windows', WINDIR: 'C:\\Windows', SystemDrive: 'C:', PATHEXT: '.COM;.EXE;.BAT;.CMD', COMSPEC: COMSPEC };
  const command = 'call "' + UPGRADE + '" & set "XJY_EXIT=!ERRORLEVEL!" & echo !XJY_EXIT!>"' + EXIT_FILE + '" & exit /b !XJY_EXIT!';
  let outFd, errFd, child;
  try {
    outFd = fs.openSync(STDOUT_LOG, 'wx');
    errFd = fs.openSync(STDERR_LOG, 'wx');
    child = cp.spawn(COMSPEC, ['/d', '/v:on', '/c', command], { cwd: STAGE, env: env, windowsHide: false, shell: false, stdio: ['ignore', outFd, errFd] });
  } catch (e) {
    try { if (outFd !== undefined) fs.closeSync(outFd); } catch (x) { /* ignore */ }
    try { if (errFd !== undefined) fs.closeSync(errFd); } catch (x) { /* ignore */ }
    fail('SPAWN_FAILED', '无法启动真实 一键升级.cmd：' + String(e.message), { code: e.code });
  } finally {
    try { if (outFd !== undefined) fs.closeSync(outFd); } catch (e) { /* ignore */ }
    try { if (errFd !== undefined) fs.closeSync(errFd); } catch (e) { /* ignore */ }
  }
  const cmd = {
    pid: child.pid, startedAt: now(), command: command, cwd: STAGE,
    stdout: STDOUT_LOG, stderr: STDERR_LOG, exitFile: EXIT_FILE,
    exited: false, exitCode: null, signal: null, spawnError: null, timedOut: false, elapsedMs: null
  };
  run.cmd = cmd;
  persistStage('INSTALLER', 'STARTED');
  uiInstructions(run.guard ? run.guard.employeeSlots : []);

  let exited = false, exitCode = null, signal = null, spawnError = null;
  const done = new Promise(resolve => {
    child.once('error', e => { if (!exited) { exited = true; spawnError = String(e.message || e); resolve(); } });
    child.once('exit', (code, sig) => { if (!exited) { exited = true; exitCode = code; signal = sig; resolve(); } });
  });
  let timer;
  const deadline = new Promise(resolve => { timer = setTimeout(() => resolve('timeout'), OBSERVE_MS); });
  const outcome = await Promise.race([done.then(() => 'done'), deadline]);
  clearTimeout(timer);
  const timedOut = outcome === 'timeout';
  if (timedOut) { try { child.unref(); } catch (e) { /* never kill */ } }
  if (exited) await sleep(80);

  const exitFromFile = await readExitFile(EXIT_FILE, exited ? 20 : 3);
  if (exited && exitCode === null && exitFromFile !== null) exitCode = exitFromFile;

  let target = inspectTarget();
  if (exited && exitCode === 0) {
    const until = Date.now() + 15000;
    while (Date.now() < until && !(target.markerOk && target.committed)) { await sleep(1000); target = inspectTarget(); }
  }
  const soTail = tail(STDOUT_LOG, 8000), seTail = tail(STDERR_LOG, 8000);
  cmd.exited = exited; cmd.exitCode = exitCode; cmd.signal = signal || null; cmd.spawnError = spawnError;
  cmd.timedOut = timedOut; cmd.elapsedMs = Date.now() - Date.parse(cmd.startedAt); cmd.exitFromFile = exitFromFile;
  cmd.stdoutTail = soTail; cmd.stderrTail = seTail;

  let status, pending = false, failure = false;
  if (!exited) {
    status = target.markerOk && target.committed ? 'APPLICATION_STARTED_WAITING_FOR_USER_EXIT' : 'PENDING_OBSERVATION_WINDOW';
    pending = true;
  } else if (exitCode !== 0) { status = 'INSTALLER_EXIT_NONZERO'; failure = true; }
  else if (target.markerOk && target.committed) { status = 'COMMITTED_WAITING_FOR_USER_EXIT'; pending = true; }
  else if (target.markerOk && !target.committed) { status = 'TARGET_WITHOUT_COMMITTED_JOURNAL'; failure = true; }
  else { status = 'INSTALL_NOT_COMMITTED'; failure = true; }

  return { status: status, pending: pending, failure: failure, passed: false, cmd: cmd, target: target, failurePopup: failure ? failurePopup(exitCode, run.startedAt) : null };
}

function persistStage(phase, status) {
  try {
    const rec = { ...run, phase: phase, status: status, updatedAt: now(), completedAt: run.completedAt };
    writeJson(path.join(ROUND_DIR, 'state.json'), rec);
    writeJson(path.join(RES, 'state.json'), rec);
    writeJson(path.join(ROUND_DIR, 'round.json'), rec);
    writeJson(path.join(RES, 'round.json'), rec);
  } catch (e) { run.persistError = String(e.code || e.message || e); }
  writeProgress(phase, status, {
    ok: run.ok, passed: run.passed, pending: run.pending, failure: run.failure,
    ...(run.package ? { package: run.package } : {}),
    ...(run.target ? { target: run.target } : {}),
    ...(run.cmd ? { cmd: { pid: run.cmd.pid, exited: run.cmd.exited, exitCode: run.cmd.exitCode, timedOut: run.cmd.timedOut } } : {}),
    ...(run.targetState ? { targetState: { markerOk: run.targetState.markerOk, committed: run.targetState.committed, version: run.targetState.version } } : {}),
    ...(run.error ? { error: run.error } : {})
  });
}

async function stage() {
  try {
    ensureResults();
    run.c6.wdag = /^WDAGUtilityAccount$/i.test(run.c6.user);
    persistStage('GUARD', 'RUNNING');
    const guard = await collectGuard();
    run.guard = guard;
    persistStage('GUARD', 'PASS');
    const pkg = await loadPackage();
    persistStage('PACKAGE', 'VALIDATED');
    const target = await stagePackage(pkg);
    run.target = target;
    persistStage('STAGED', 'STAGED');
    writeProgress('DATA', 'HASHING');
    const data = await snapshotData(true), slots = await snapshotSlots();
    writeBefore(pkg, target, data, slots);
    run.before = {
      dataTreeHash: data.treeHash, dataFiles: data.fileCount, dataBytes: data.bytes, dataDbWal: data.dbWal.length,
      slots: slots.map(s => ({ path: s.path, files: s.files, bytes: s.bytes, entriesHash: s.entriesHash, keysHash: s.keysHash }))
    };
    persistStage('READY', 'READY_FOR_USER_UI');
    const launched = await launchInstaller();
    run.cmd = launched.cmd; run.targetState = launched.target; run.status = launched.status;
    run.pending = launched.pending; run.failure = launched.failure; run.passed = false;
    run.ok = !launched.failure; run.failurePopup = launched.failurePopup;
    persistStage('OBSERVED', run.status);
  } catch (e) {
    run.error = errInfo(e);
    run.status = 'FAILED';
    run.ok = false; run.passed = false; run.failure = true;
    try { persistStage('FAILED', run.status); } catch (x) { /* ignore */ }
  } finally {
    run.completedAt = now();
    try { persistStage('DONE', run.status); } catch (e) { /* ignore */ }
    console.log(JSON.stringify({
      runId: RUN_ID, status: run.status, ok: run.ok, passed: run.passed, pending: run.pending, failure: run.failure,
      results: RES,
      cmd: run.cmd ? { pid: run.cmd.pid, exited: run.cmd.exited, exitCode: run.cmd.exitCode, timedOut: run.cmd.timedOut } : null,
      target: run.targetState ? { markerOk: run.targetState.markerOk, committed: run.targetState.committed, version: run.targetState.version } : null,
      error: run.error
    }, null, 2));
    process.exitCode = run.failure ? 1 : 0;
  }
}

function writeFinal(fin, roundDir) {
  try {
    writeJson(path.join(roundDir, 'final.json'), fin);
    writeJson(path.join(RES, 'final.json'), fin);
    writeJson(path.join(RES, 'progress.json'), { ...fin, phase: 'FINAL', status: fin.status, updatedAt: now() });
  } catch (e) { console.error('FINAL_WRITE_ERROR ' + String(e.code || e.message || e)); }
}

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

async function finalize() {
  ensureResults();
  const stateFile = argValue('--state') || path.join(RES, 'state.json');
  let state;
  try { state = readJson(stateFile); }
  catch (e) {
    const fin = { schemaVersion: 1, purpose: 'ROOT_GUEST_RELEASE_STAGE_FINAL', runId: 'UNKNOWN', status: 'STATE_UNREADABLE', ok: false, passed: false, pending: false, failure: true, error: String(e.code || e.message || e) };
    writeFinal(fin, path.join(RES, 'rounds', 'UNKNOWN'));
    console.log(JSON.stringify(fin, null, 2));
    process.exitCode = 1;
    return;
  }
  const runId = state.runId || 'UNKNOWN', roundDir = path.join(RES, 'rounds', runId);
  fs.mkdirSync(roundDir, { recursive: true });
  const fin = {
    schemaVersion: 1, purpose: 'ROOT_GUEST_RELEASE_STAGE_FINAL', runId: runId, at: now(),
    stageStatus: state.status || null, c6: state.c6 || null,
    status: 'STARTING', ok: false, passed: false, pending: false, failure: false,
    target: null, journal: null, data: null, slots: null, installer: null, failurePopup: null, error: null
  };
  try {
    const user = os.userInfo().username, hostname = os.hostname();
    if (!/^WDAGUtilityAccount$/i.test(user) || !C6_HOSTNAMES.has(hostname.toLowerCase())) {
      fail('C6_IDENTITY_MISMATCH', 'finalize 不在已知 C6/WDAG 环境。', { hostname: hostname, user: user });
    }
    fin.c6 = { ...(fin.c6 || {}), hostname: hostname, user: user, wdag: true, sandboxId: C6_ID };
    const before = readJson(state.paths && state.paths.before ? state.paths.before : path.join(roundDir, 'before.json'));
    const cmd = state.cmd || {};
    let exitCode = Number.isInteger(cmd.exitCode) ? cmd.exitCode : null;
    let exitSource = cmd.exited ? 'stage' : 'UNKNOWN';
    if (exitCode === null) {
      const ef = await readExitFile(state.paths && state.paths.exitFile ? state.paths.exitFile : path.join(roundDir, 'installer-exit.txt'), 20);
      if (ef !== null) { exitCode = ef; exitSource = 'exit-file'; cmd.exited = true; }
    }
    if (!cmd.exited && cmd.pid && pidAlive(cmd.pid)) {
      fin.status = 'WAITING_FOR_USER_EXIT';
      fin.ok = true; fin.pending = true; fin.failure = false;
      fin.installer = { pid: cmd.pid, exited: false, exitCode: 'UNKNOWN', source: 'process-alive' };
      fin.target = inspectTarget();
      writeFinal(fin, roundDir);
      console.log(JSON.stringify({ runId: runId, status: fin.status, pending: true, ok: true, results: RES }, null, 2));
      process.exitCode = 0;
      return;
    }
    const target = inspectTarget();
    fin.target = target; fin.journal = target.journal;
    const dataAfter = await snapshotData(false), dataDiff = compareData(before.data.files, dataAfter.files);
    const dataUnchanged = dataDiff.length === 0 && dataAfter.treeHash === before.data.treeHash;
    let slotsAfter = [], slotError = null;
    try { slotsAfter = await snapshotSlots(); } catch (e) { slotError = errInfo(e); }
    const slotDiff = slotError ? [{ path: '*', kind: 'snapshot-error', error: slotError }] : compareSlots(before.slots, slotsAfter);
    const slotsUnchanged = !slotError && slotDiff.length === 0;
    fin.data = {
      beforeTreeHash: before.data.treeHash, afterTreeHash: dataAfter.treeHash,
      beforeFiles: before.data.fileCount, afterFiles: dataAfter.fileCount,
      beforeBytes: before.data.bytes, afterBytes: dataAfter.bytes,
      dbWalBefore: before.data.dbWal.length, dbWalAfter: dataAfter.dbWal.length,
      unchanged: dataUnchanged, diff: dataDiff.slice(0, 200), diffCount: dataDiff.length
    };
    fin.slots = { before: before.slots.length, after: slotsAfter.length, unchanged: slotsUnchanged, diff: slotDiff.slice(0, 50), ...(slotError ? { error: slotError } : {}) };
    fin.installer = { pid: cmd.pid || null, exited: cmd.exited === true, exitCode: exitCode, source: exitSource, timedOut: cmd.timedOut === true };
    const exitKnown = exitCode !== null, installerOk = exitKnown && exitCode === 0;
    let status;
    if (!installerOk) status = exitKnown ? 'FAILED_INSTALLER_EXIT' : 'INSTALLER_EXIT_UNKNOWN';
    else if (!target.markerOk) status = 'FAILED_TARGET_MARKER';
    else if (!target.committed) status = 'FAILED_COMMITTED_JOURNAL';
    else if (!dataUnchanged) status = 'FAILED_DATA_CHANGED';
    else if (!slotsUnchanged) status = 'FAILED_EMPLOYEE_SLOT_CHANGED';
    else status = 'PASS';
    fin.status = status; fin.passed = status === 'PASS'; fin.ok = fin.passed; fin.pending = false; fin.failure = !fin.passed;
    if (fin.failure) {
      let popup = failurePopup(exitCode, state.startedAt);
      const cliText = argValue('--popup-text'), cliExit = argValue('--popup-exit-code');
      if (cliText) popup = { text: cliText.slice(0, 4000), exitCode: cliExit && /^-?\d+$/.test(cliExit) ? Number(cliExit) : popup.exitCode, button: null, source: 'cli' };
      fin.failurePopup = popup;
    }
    writeFinal(fin, roundDir);
    console.log(JSON.stringify({
      runId: runId, status: fin.status, passed: fin.passed, installer: fin.installer,
      target: { markerOk: target.markerOk, committed: target.committed, version: target.version },
      dataUnchanged: dataUnchanged, slotsUnchanged: slotsUnchanged, results: RES
    }, null, 2));
    process.exitCode = fin.passed ? 0 : 1;
  } catch (e) {
    fin.error = errInfo(e); fin.status = 'FINALIZE_ERROR'; fin.ok = false; fin.passed = false; fin.failure = true;
    writeFinal(fin, roundDir);
    console.log(JSON.stringify({ runId: runId, status: fin.status, error: fin.error }, null, 2));
    process.exitCode = 1;
  }
}

function usage() {
  console.log('用法:');
  console.log('  node ROOT_GUEST_RELEASE_STAGE.cjs');
  console.log('  node ROOT_GUEST_RELEASE_STAGE.cjs finalize [--state FILE] [--popup-text TEXT] [--popup-exit-code N]');
}

if (require.main === module) {
  const mode = process.argv[2] || 'stage';
  if (mode === 'finalize') finalize().catch(e => { console.error(String(e && e.message || e)); process.exitCode = 1; });
  else if (mode === 'stage' || mode === 'run') stage().catch(e => { console.error(String(e && e.message || e)); process.exitCode = 1; });
  else { usage(); process.exitCode = 2; }
} else {
  module.exports = { stage: stage, finalize: finalize };
}

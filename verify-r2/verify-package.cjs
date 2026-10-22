'use strict';
/*
 * verify-package.cjs — 新构建整包独立校验器（只读 / 不启动程序 / 不运行构建）
 *
 * 用法：
 *   node verify-package.cjs --build <candidate\build> --expect-asar <sha> --expect-engine <size>:<sha> --executable 0|1
 *
 * 行为：
 *   a) assembly.json 的 files[] 数量 + 逐文件 sha256 与磁盘一致（\\?\ 长路径 + 流式 sha256）
 *   b) archive（默认 native-package.zip）size/sha256 与 assembly 记录一致
 *   c) 包内 完整程序/resources/app.asar 的 sha256 是否等于 --expect-asar（判断 r2 是否真的进包）
 *   d) 完整程序/鑫金源珠宝报价.exe 与 受信助手/delivery-tools/engine-tree-runtime170.cjs 的 size/sha256
 *   e) --executable 0 时断言没有启动过应用（本工具绝不 spawn 产品进程；额外用 Win32_Process 取证）
 *
 * 退出码：0 = 全部通过（可能含 warning）；2 = 有 mismatch；1 = 参数/环境错误。
 * 本文件不写、不移动、不删除 --build 目录中的任何东西。
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const SHA_RE = /^[a-f0-9]{64}$/;
const HASH_CHUNK = 4 * 1024 * 1024;
const MAX_DETAIL = 200;

const ASAR_REL = '完整程序/resources/app.asar';
const ENGINE_EXE_REL = '完整程序/鑫金源珠宝报价.exe';
const ENGINE_TREE_REL = '受信助手/delivery-tools/engine-tree-runtime170.cjs';
const DEFAULT_ARCHIVE_FILE = 'native-package.zip';

class Mismatch {
  constructor(code, target, detail, expected, actual) {
    this.code = code;
    this.target = target;
    this.detail = detail;
    if (expected !== undefined) this.expected = expected;
    if (actual !== undefined) this.actual = actual;
  }
}

function longPath(p) {
  const abs = path.resolve(p);
  if (abs.startsWith('\\\\?\\')) return abs;
  if (abs.startsWith('\\\\')) return '\\\\?\\UNC\\' + abs.slice(2);
  return '\\\\?\\' + abs;
}

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// \\?\ 长路径 + 4MiB 流式 sha256；返回实际读到的字节数
function streamSha256(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    let n = 0;
    const rs = fs.createReadStream(longPath(file), { highWaterMark: HASH_CHUNK });
    rs.on('error', reject);
    rs.on('data', (chunk) => { h.update(chunk); n += chunk.length; });
    rs.on('end', () => resolve({ sha256: h.digest('hex'), size: n }));
  });
}

function statLong(file) {
  try {
    const s = fs.statSync(longPath(file));
    return { exists: true, isFile: s.isFile(), size: s.size, mtimeMs: s.mtimeMs };
  } catch (e) {
    if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) return { exists: false };
    throw e;
  }
}

function readBytes(file) {
  return fs.readFileSync(longPath(file));
}

// 递归枚举 package 目录（相对路径统一用 '/'），不跟随符号链接/联接点
function walk(dir, rootRel = '', out = [], links = []) {
  const entries = fs.readdirSync(longPath(dir), { withFileTypes: true });
  for (const ent of entries) {
    const rel = rootRel ? rootRel + '/' + ent.name : ent.name;
    const abs = path.join(dir, ent.name);
    if (ent.isSymbolicLink()) { links.push(rel); continue; }
    if (ent.isDirectory()) walk(abs, rel, out, links);
    else if (ent.isFile()) out.push({ rel, abs });
    else links.push(rel);
  }
  return { files: out, links };
}

function parseEngineSpec(raw, flag) {
  if (raw == null) return null;
  const text = String(raw).trim();
  const m = /^(?:(\d+):)?([0-9a-fA-F]{64})$/.exec(text);
  if (!m) throw usageError(`${flag} 需要 <size>:<sha256>，收到 "${raw}"`);
  const size = m[1] === undefined ? null : Number(m[1]);
  if (size !== null && (!Number.isSafeInteger(size) || size < 0)) throw usageError(`${flag} 的 size 非法`);
  return { size, sha256: m[2].toLowerCase() };
}

function parseAsarSpec(raw, flag) {
  if (raw == null) return null;
  const text = String(raw).trim().toLowerCase().replace(/^sha256:/, '');
  if (!SHA_RE.test(text)) throw usageError(`${flag} 需要 64 位 sha256，收到 "${raw}"`);
  return text;
}

function usageError(msg) {
  const e = new Error(msg);
  e.code = 'USAGE';
  return e;
}

const USAGE = [
  'USAGE:',
  '  node verify-package.cjs --build <candidate\\build 目录>',
  '                          --expect-asar <sha256>',
  '                          --expect-engine <size>:<sha256>',
  '                          [--expect-engine-tree <size>:<sha256>]',
  '                          [--expect-archive <size>:<sha256>]',
  '                          [--executable 0|1] [--process-check 0|1]',
  '',
  '本工具只读 --build，不启动任何产品进程，不运行构建。',
].join('\n');

function parseArgs(argv) {
  const known = new Set(['--build', '--expect-asar', '--expect-engine', '--expect-engine-tree', '--expect-archive', '--executable', '--process-check']);
  const raw = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') return { help: true };
    if (!known.has(a)) throw usageError(`未知参数 ${a}`);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw usageError(`参数 ${a} 缺少取值`);
    raw[a] = v;
    i++;
  }
  if (!raw['--build']) throw usageError('缺少必填参数 --build');

  const execRaw = raw['--executable'] === undefined ? '0' : raw['--executable'];
  if (execRaw !== '0' && execRaw !== '1') throw usageError('--executable 只能是 0 或 1');
  const procRaw = raw['--process-check'] === undefined ? '1' : raw['--process-check'];
  if (procRaw !== '0' && procRaw !== '1') throw usageError('--process-check 只能是 0 或 1');

  return {
    build: path.resolve(raw['--build']),
    expectAsar: parseAsarSpec(raw['--expect-asar'], '--expect-asar'),
    expectEngine: parseEngineSpec(raw['--expect-engine'], '--expect-engine'),
    expectEngineTree: parseEngineSpec(raw['--expect-engine-tree'], '--expect-engine-tree'),
    expectArchive: parseEngineSpec(raw['--expect-archive'], '--expect-archive'),
    executable: Number(execRaw),
    processCheck: procRaw === '1',
  };
}

// 取证：枚举进程，找 ExecutablePath 落在 build 目录内的实例。绝不启动任何东西。
function scanRunningFromBuild(buildDir, enabled) {
  const result = { checked: false, available: false, running: [], error: null };
  if (!enabled) { result.error = 'process check disabled'; return result; }
  if (process.platform !== 'win32') { result.error = 'non-win32'; return result; }
  const needle = buildDir.replace(/'/g, "''");
  const ps = [
    "$ErrorActionPreference='Stop'",
    `$root='${needle}'`,
    "$p=Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($root,[System.StringComparison]::OrdinalIgnoreCase) } | Select-Object ProcessId,Name,ExecutablePath",
    'ConvertTo-Json -InputObject @($p) -Compress -Depth 3',
  ].join('; ');
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', timeout: 30000, windowsHide: true });
  result.checked = true;
  if (r.error || r.status !== 0) {
    result.error = (r.error && r.error.message) || (r.stderr || '').trim().slice(0, 300) || `exit ${r.status}`;
    return result;
  }
  const text = (r.stdout || '').trim();
  if (!text) { result.available = true; return result; }
  try {
    const parsed = JSON.parse(text);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    result.available = true;
    result.running = arr.filter(Boolean).map((p) => ({ pid: p.ProcessId, name: p.Name, path: p.ExecutablePath }));
  } catch (e) {
    result.error = 'process json parse failed: ' + e.message;
  }
  return result;
}

async function hashPinned(name, file, declaredRow, expect, mismatches, opts = {}) {
  const disk = statLong(file);
  const out = {
    name,
    path: file,
    exists: !!disk.exists,
    size: disk.exists ? disk.size : null,
    sha256: null,
    declared: declaredRow ? { size: declaredRow.size, sha256: declaredRow.sha256 } : null,
    expect: expect || null,
    match: { declared: null, expect: null },
    stable: null,
  };
  if (!disk.exists) {
    mismatches.push(new Mismatch(opts.missingCode || 'MISSING', name, `文件不存在：${file}`));
    return out;
  }
  if (!disk.isFile) {
    mismatches.push(new Mismatch(opts.missingCode || 'MISSING', name, `不是普通文件：${file}`));
    out.match.declared = false;
    return out;
  }
  const got = await streamSha256(file);
  out.sha256 = got.sha256;
  out.size = got.size;
  const after = statLong(file);
  out.stable = !!(after.exists && after.size === got.size && after.mtimeMs === disk.mtimeMs);
  if (!out.stable) {
    mismatches.push(new Mismatch('CHANGED_DURING_READ', name, `读取期间文件发生变化：${file}`));
  }
  if (declaredRow) {
    const sizeOk = declaredRow.size === got.size;
    const shaOk = String(declaredRow.sha256).toLowerCase() === got.sha256;
    out.match.declared = sizeOk && shaOk;
    if (!sizeOk) mismatches.push(new Mismatch(opts.declaredSizeCode || 'DECLARED_SIZE', name, `与 assembly 记录的 size 不一致（记录 ${declaredRow.size}，实测 ${got.size}）`, declaredRow.size, got.size));
    if (!shaOk) mismatches.push(new Mismatch(opts.declaredShaCode || 'DECLARED_SHA', name, `与 assembly 记录的 sha256 不一致（记录 ${declaredRow.sha256}，实测 ${got.sha256}）`, declaredRow.sha256, got.sha256));
  }
  if (expect) {
    const sizeOk = expect.size === null || expect.size === got.size;
    const shaOk = expect.sha256 === got.sha256;
    out.match.expect = sizeOk && shaOk;
    if (!sizeOk) mismatches.push(new Mismatch(opts.expectSizeCode || 'EXPECT_SIZE', name, `与期望 size 不一致（期望 ${expect.size}，实测 ${got.size}）`, expect.size, got.size));
    if (!shaOk) mismatches.push(new Mismatch(opts.expectShaCode || 'EXPECT_SHA', name, `与期望 sha256 不一致（期望 ${expect.sha256}，实测 ${got.sha256}）`, expect.sha256, got.sha256));
  }
  return out;
}

function collectDeclaredRows(assembly, mismatches) {
  const byPath = new Map();
  const rows = [];
  if (!Array.isArray(assembly.files)) {
    mismatches.push(new Mismatch('ASSEMBLY_INVALID', 'assembly.json', 'files 不是数组'));
    return { rows, byPath };
  }
  let bad = 0;
  for (const f of assembly.files) {
    const ok = f && typeof f.path === 'string' && f.path.length > 0 && !f.path.startsWith('/') && !f.path.includes('\\') &&
      !f.path.split('/').some((s) => s === '' || s === '.' || s === '..') &&
      Number.isSafeInteger(f.size) && f.size >= 0 && typeof f.sha256 === 'string' && SHA_RE.test(f.sha256.toLowerCase());
    if (!ok) {
      bad++;
      if (bad <= MAX_DETAIL) mismatches.push(new Mismatch('ASSEMBLY_ROW_INVALID', String(f && f.path), 'assembly.files 行字段非法（path/size/sha256）'));
      continue;
    }
    const key = f.path.toLowerCase();
    if (byPath.has(key)) {
      mismatches.push(new Mismatch('ASSEMBLY_DUPLICATE', f.path, 'assembly.files 中路径重复（大小写不敏感）'));
      continue;
    }
    const row = { path: f.path, size: f.size, sha256: f.sha256.toLowerCase() };
    byPath.set(key, row);
    rows.push(row);
  }
  return { rows, byPath, invalidRows: bad };
}

async function verify(options) {
  const mismatches = [];
  const report = {
    tool: 'verify-package.cjs',
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    build: options.build,
    options: {
      expectAsar: options.expectAsar,
      expectEngine: options.expectEngine,
      expectEngineTree: options.expectEngineTree,
      expectArchive: options.expectArchive,
      executable: options.executable,
      processCheck: options.processCheck,
    },
    programExecuted: false,
    executableMode: options.executable,
    ok: false,
    exitCode: 1,
    checks: {},
    mismatches,
  };

  // ---- 0. build 目录必须存在且可读 ----
  const buildStat = statLong(options.build);
  if (!buildStat.exists) {
    mismatches.push(new Mismatch('BUILD_UNREADABLE', 'build', `build 目录不存在：${options.build}`));
    report.mismatches = mismatches;
    report.exitCode = 2;
    return report;
  }

  // ---- 1. assembly.json ----
  const assemblyPath = path.join(options.build, 'assembly.json');
  const assembly = { path: assemblyPath, exists: false, size: null, sha256: null, schemaVersion: null, files: 0, treeSha256: null, publication: null, archive: null };
  let asm = null;
  const asmStat = statLong(assemblyPath);
  if (!asmStat.exists) {
    mismatches.push(new Mismatch('ASSEMBLY_MISSING', 'assembly.json', `找不到 ${assemblyPath}`));
  } else {
    const bytes = readBytes(assemblyPath);
    assembly.exists = true;
    assembly.size = asmStat.size;
    assembly.sha256 = sha256Hex(bytes);
    try {
      asm = JSON.parse(bytes.toString('utf8'));
    } catch (e) {
      mismatches.push(new Mismatch('ASSEMBLY_INVALID', 'assembly.json', '不是合法 JSON: ' + e.message));
    }
  }
  if (asm) {
    assembly.schemaVersion = asm.schemaVersion ?? null;
    if (asm.schemaVersion !== 1) mismatches.push(new Mismatch('ASSEMBLY_SCHEMA', 'assembly.json', `schemaVersion 期望 1，实际 ${JSON.stringify(asm.schemaVersion)}`));
    assembly.files = Array.isArray(asm.files) ? asm.files.length : 0;
    assembly.treeSha256 = asm.treeSha256 ?? null;
    assembly.bindingSha256 = asm.bindingSha256 ?? null;
    assembly.publication = asm.publication ?? null;
    assembly.archive = asm.archive ?? null;
    assembly.fileSha256 = assembly.sha256;
  }
  report.checks.assembly = assembly;

  // ---- 2. files[] 与磁盘逐文件比对 ----
  const pkgDir = path.join(options.build, 'package');
  const filesCheck = {
    packageDir: pkgDir,
    declared: 0,
    onDisk: 0,
    verified: 0,
    declaredBytes: 0,
    diskBytes: 0,
    countOk: false,
    allMatch: false,
    hashFailures: 0,
    missing: [],
    extra: [],
    changed: [],
    symlinks: [],
    mismatchedRows: 0,
  };
  const declared = collectDeclaredRows(asm || {}, mismatches);
  filesCheck.declared = declared.rows.length;
  filesCheck.declaredBytes = declared.rows.reduce((n, r) => n + r.size, 0);

  const pkgStat = statLong(pkgDir);
  let diskFiles = [];
  if (!pkgStat.exists) {
    mismatches.push(new Mismatch('PACKAGE_DIR_MISSING', 'package', `找不到包目录 ${pkgDir}`));
  } else {
    try {
      const walked = walk(pkgDir);
      diskFiles = walked.files;
      filesCheck.symlinks = walked.links.slice(0, MAX_DETAIL);
      for (const l of walked.links) mismatches.push(new Mismatch('PACKAGE_LINK', l, '包目录中存在符号链接/联接点，拒绝按文件校验'));
    } catch (e) {
      mismatches.push(new Mismatch('PACKAGE_UNREADABLE', 'package', `枚举包目录失败：${e.message}`));
    }
  }
  filesCheck.onDisk = diskFiles.length;
  filesCheck.diskBytes = diskFiles.reduce((n, f) => { try { return n + fs.statSync(longPath(f.abs)).size; } catch { return n; } }, 0);

  const diskByKey = new Map();
  for (const f of diskFiles) diskByKey.set(f.rel.toLowerCase(), f);

  const hashQueue = [];
  for (const row of declared.rows) {
    const hit = diskByKey.get(row.path.toLowerCase());
    if (!hit) {
      filesCheck.missing.push(row.path);
      if (filesCheck.missing.length <= MAX_DETAIL) mismatches.push(new Mismatch('FILE_MISSING', row.path, 'assembly 声明但磁盘不存在'));
      continue;
    }
    hashQueue.push({ row, file: hit });
  }
  for (const [key, f] of diskByKey) {
    const hit = declared.byPath.get(key);
    if (!hit) {
      filesCheck.extra.push(f.rel);
      if (filesCheck.extra.length <= MAX_DETAIL) mismatches.push(new Mismatch('FILE_EXTRA', f.rel, '磁盘存在但 assembly 未声明'));
    }
  }

  const changedCap = MAX_DETAIL;
  for (const { row, file } of hashQueue) {
    let st;
    try { st = statLong(file.abs); } catch (e) {
      filesCheck.hashFailures++;
      if (filesCheck.changed.length < changedCap) filesCheck.changed.push({ path: row.path, reason: 'stat: ' + e.message });
      mismatches.push(new Mismatch('FILE_UNREADABLE', row.path, 'stat 失败：' + e.message));
      continue;
    }
    if (!st.exists || !st.isFile) {
      filesCheck.hashFailures++;
      filesCheck.missing.push(row.path);
      mismatches.push(new Mismatch('FILE_MISSING', row.path, '声明为文件但磁盘上不是普通文件'));
      continue;
    }
    let got;
    try { got = await streamSha256(file.abs); } catch (e) {
      filesCheck.hashFailures++;
      if (filesCheck.changed.length < changedCap) filesCheck.changed.push({ path: row.path, reason: 'read: ' + e.message });
      mismatches.push(new Mismatch('FILE_UNREADABLE', row.path, '读取失败：' + e.message));
      continue;
    }
    const sizeOk = got.size === row.size;
    const shaOk = got.sha256 === row.sha256;
    if (sizeOk && shaOk) { filesCheck.verified++; continue; }
    filesCheck.hashFailures++;
    filesCheck.mismatchedRows++;
    if (filesCheck.changed.length < changedCap) filesCheck.changed.push({ path: row.path, sizeOk, shaOk, declaredSize: row.size, actualSize: got.size, declaredSha256: row.sha256, actualSha256: got.sha256 });
    mismatches.push(new Mismatch('FILE_SHA', row.path, `内容与 assembly 记录不一致（size ${sizeOk ? '=' : '≠'}，sha256 ${shaOk ? '=' : '≠'}）`, { size: row.size, sha256: row.sha256 }, { size: got.size, sha256: got.sha256 }));
  }
  filesCheck.countOk = filesCheck.declared === filesCheck.onDisk;
  if (!filesCheck.countOk) {
    mismatches.push(new Mismatch('FILE_COUNT', 'package', `assembly 声明 ${filesCheck.declared} 个文件，磁盘 ${filesCheck.onDisk} 个`, filesCheck.declared, filesCheck.onDisk));
  }
  filesCheck.allMatch = filesCheck.countOk && filesCheck.missing.length === 0 && filesCheck.extra.length === 0 && filesCheck.mismatchedRows === 0 && filesCheck.hashFailures === 0;
  report.checks.files = filesCheck;

  // ---- 3. archive ----
  const declaredArchive = (asm && (asm.archive || (asm.publication && asm.publication.archive))) || null;
  const archiveName = declaredArchive && typeof declaredArchive.path === 'string' ? declaredArchive.path : DEFAULT_ARCHIVE_FILE;
  const archivePath = path.resolve(options.build, archiveName);
  const archiveOut = await hashPinned('archive', archivePath,
    declaredArchive ? { size: declaredArchive.size, sha256: String(declaredArchive.sha256 || '').toLowerCase() } : null,
    options.expectArchive, mismatches,
    { missingCode: 'ARCHIVE_MISSING' });
  archiveOut.declared = declaredArchive ? { size: declaredArchive.size, sha256: declaredArchive.sha256, compression: declaredArchive.compression ?? null, maximumBytes: declaredArchive.maximumBytes ?? null } : null;
  if (declaredArchive && (!Number.isSafeInteger(declaredArchive.size) || !SHA_RE.test(String(declaredArchive.sha256 || '').toLowerCase()))) {
    mismatches.push(new Mismatch('ARCHIVE_UNDECLARED', 'assembly.json', 'assembly 中的 archive 记录缺少合法 size/sha256'));
  }
  if (declaredArchive && Number.isSafeInteger(declaredArchive.maximumBytes) && archiveOut.size > declaredArchive.maximumBytes) {
    mismatches.push(new Mismatch('ARCHIVE_TOO_LARGE', 'archive', `archive 超过 assembly 记录的 maximumBytes ${declaredArchive.maximumBytes}`, declaredArchive.maximumBytes, archiveOut.size));
  }
  report.checks.archive = archiveOut;

  // ---- 4. app.asar（r2 是否进包的唯一判据）----
  const asarPath = path.join(pkgDir, ASAR_REL);
  const asarRow = declared.byPath.get(ASAR_REL.toLowerCase()) || null;
  const asarOut = await hashPinned('app.asar', asarPath, asarRow,
    options.expectAsar ? { size: null, sha256: options.expectAsar } : null, mismatches,
    { missingCode: 'ASAR_MISSING', declaredSizeCode: 'ASAR_SIZE', declaredShaCode: 'ASAR_ASSEMBLY_SHA', expectSizeCode: 'ASAR_EXPECT_SIZE', expectShaCode: 'ASAR_EXPECT_SHA' });
  asarOut.relPath = ASAR_REL;
  asarOut.r2InPackage = options.expectAsar ? asarOut.sha256 === options.expectAsar : null;
  asarOut.assemblyInSync = asarRow && asarOut.sha256 ? asarOut.sha256 === asarRow.sha256 : null;
  if (options.expectAsar && asarOut.sha256 && !asarOut.r2InPackage) {
    asarOut.verdict = asarOut.assemblyInSync ? 'asar 与 assembly 一致，但都不是 --expect-asar（新 r2 尚未进包）' : 'asar 与 assembly、--expect-asar 均不一致（包被改动/构建未完成）';
  } else if (options.expectAsar && asarOut.r2InPackage) {
    asarOut.verdict = 'r2 已进包：包内 app.asar 命中 --expect-asar';
  } else {
    asarOut.verdict = options.expectAsar ? '无法判定' : '未提供 --expect-asar，仅按 assembly 记录校验';
  }
  report.checks.asar = asarOut;

  // ---- 5. engine（程序 exe + engine-tree-runtime170.cjs）----
  const engineExeRow = declared.byPath.get(ENGINE_EXE_REL.toLowerCase()) || null;
  const engineTreeRow = declared.byPath.get(ENGINE_TREE_REL.toLowerCase()) || null;
  const engineExe = await hashPinned('engine.exe', path.join(pkgDir, ENGINE_EXE_REL), engineExeRow, options.expectEngine, mismatches,
    { missingCode: 'ENGINE_MISSING', declaredSizeCode: 'ENGINE_SIZE', declaredShaCode: 'ENGINE_ASSEMBLY_SHA', expectSizeCode: 'ENGINE_EXPECT_SIZE', expectShaCode: 'ENGINE_EXPECT_SHA' });
  engineExe.relPath = ENGINE_EXE_REL;
  const engineTree = await hashPinned('engine-tree-runtime170.cjs', path.join(pkgDir, ENGINE_TREE_REL), engineTreeRow, options.expectEngineTree, mismatches,
    { missingCode: 'ENGINE_TREE_MISSING', declaredSizeCode: 'ENGINE_TREE_SIZE', declaredShaCode: 'ENGINE_TREE_ASSEMBLY_SHA', expectSizeCode: 'ENGINE_TREE_EXPECT_SIZE', expectShaCode: 'ENGINE_TREE_EXPECT_SHA' });
  engineTree.relPath = ENGINE_TREE_REL;
  if (options.expectEngine && !options.expectEngineTree) engineTree.note = '未提供 --expect-engine-tree，仅对 assembly 记录校验（同一 <size>:<sha> 不可能同时匹配两个不同文件）';
  report.checks.engine = {
    exe: engineExe,
    treeRuntime: engineTree,
    assemblyDeclaresBoth: !!(engineExeRow && engineTreeRow),
  };

  // ---- 6. 未启动应用的取证（绝不 spawn 产品）----
  const procs = scanRunningFromBuild(options.build, options.processCheck);
  report.checks.processes = procs;
  if (options.executable === 0) {
    if (procs.running.length > 0) {
      mismatches.push(new Mismatch('PROGRAM_RUNNING', 'process', `--executable 0 要求未启动，但检测到 ${procs.running.length} 个进程从 build 目录运行：${procs.running.map((p) => p.name + '#' + p.pid).join(', ')}`));
    } else if (!procs.available) {
      report.checks.processes.warning = '进程取证不可用，programExecuted:false 仅代表本工具自身未启动产品';
    }
  }
  report.checks.execution = {
    launchedByTool: false,
    launchAttempted: false,
    executableMode: options.executable,
    programExecuted: false,
    assertion: options.executable === 0
      ? 'strict: 本工具不 spawn 任何产品进程；--executable 0 断言校验期间应用未运行'
      : 'permissive: --executable 1 仅表示允许应用被运行；本工具按“只做文件校验”策略仍然不启动 exe',
  };

  // ---- 7. 结论 ----
  const deduped = [];
  const seen = new Set();
  for (const m of mismatches) {
    const key = m.code + '|' + m.target;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(m);
  }
  report.mismatches = deduped;
  report.mismatchCount = deduped.length;
  report.ok = deduped.length === 0;
  report.exitCode = report.ok ? 0 : 2;
  report.summary = buildSummary(report);
  return report;
}

function buildSummary(r) {
  const parts = [];
  parts.push(r.ok ? 'PASS' : 'FAIL(' + r.mismatchCount + ')');
  const f = r.checks.files;
  if (f) parts.push(`files ${f.verified}/${f.declared} (disk ${f.onDisk})`);
  const a = r.checks.archive;
  if (a) parts.push(`archive ${a.match.declared === true ? 'ok' : 'diff'}`);
  const s = r.checks.asar;
  if (s && s.sha256) parts.push(`asar ${s.sha256.slice(0, 12)}${s.r2InPackage === null ? '' : s.r2InPackage ? '=r2' : '!=r2'}`);
  const e = r.checks.engine;
  if (e && e.exe && e.exe.sha256) parts.push(`engine ${e.exe.sha256.slice(0, 12)}`);
  parts.push(`executed:${r.programExecuted}`);
  return parts.join(' | ');
}

function emit(report) {
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (e) {
    if (e.code === 'USAGE') {
      process.stderr.write('错误: ' + e.message + '\n\n' + USAGE + '\n');
      process.stdout.write(JSON.stringify({ tool: 'verify-package.cjs', ok: false, exitCode: 1, error: { code: 'USAGE', message: e.message } }, null, 2) + '\n');
      process.exitCode = 1;
      return;
    }
    throw e;
  }
  if (options.help) { process.stdout.write(USAGE + '\n'); process.exitCode = 0; return; }
  const report = await verify(options);
  emit(report);
  process.exitCode = report.exitCode;
}

if (require.main === module) {
  main().catch((e) => {
    process.stderr.write('FATAL: ' + (e && e.stack || e) + '\n');
    process.stdout.write(JSON.stringify({ tool: 'verify-package.cjs', ok: false, exitCode: 1, error: { code: 'FATAL', message: String(e && e.message || e) } }, null, 2) + '\n');
    process.exitCode = 1;
  });
}

module.exports = { verify, parseArgs, ASAR_REL, ENGINE_EXE_REL, ENGINE_TREE_REL };

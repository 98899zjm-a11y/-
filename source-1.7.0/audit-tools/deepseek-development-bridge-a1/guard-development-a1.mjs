// guard-development-a1.mjs
// 最小受限权限桥（隔离开发用）。只开放 xjy_read / xjy_list / xjy_write / xjy_check 四个文件工具。
// 写入范围唯一：E:\codex\2026-10-15\work\xjy-v16-deep-audit\release-work\deepseek-stage1-development-a1
// 不执行任意 host shell、不联网、不读私钥/生产数据、不删文件、不改正式桌面 profile。
// 工具错误返回 JSON 字符串，不结束循环；原 stdin 正常退出机制保留。

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

// ============================== 常量 ==============================

const WRITE_ROOT = 'E:\\codex\\2026-10-15\\work\\xjy-v16-deep-audit\\release-work\\deepseek-stage1-development-a1';
const OFFICIAL_NODE = 'C:\\Users\\Administrator\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\bin\\node.exe';
const CORDIS_URL = 'file:///E:/deepseek/resources/app.asar/dsh/node_modules/@deepseek-ai/cordis/lib/index.js';
const TOOLS_URL = 'file:///E:/deepseek/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js';

const ALLOWED_TOOLS = Object.freeze(['xjy_read', 'xjy_list', 'xjy_write', 'xjy_check']);
const STOP_TOKEN = 'XJY_COLLABORATION_STOP_A3';
const STRICT_STREAM = process.env.XJY_GUARD_LENIENT_STREAM !== '1';

const DEFAULT_LIMITS = Object.freeze({
  readBytes: 1024 * 1024,
  writeBytes: 512 * 1024,
  checkBytes: 512 * 1024,
  maxLines: 500,
  defaultLines: 200
});

const RESERVED_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
]);

const BLOCKED_EXTENSIONS = new Set([
  '.key', '.pem', '.pfx', '.p12', '.crt', '.cer', '.der', '.csr', '.jks', '.keystore',
  '.sqlite', '.sqlite3', '.db', '.db-wal', '.db-shm', '.db-journal', '.mdb', '.accdb',
  '.exe', '.dll', '.node', '.sys', '.drv', '.msi', '.msp', '.msix', '.appx', '.appxbundle',
  '.asar', '.zip', '.7z', '.rar', '.tar', '.gz', '.tgz', '.bz2', '.xz', '.iso', '.img', '.vhd', '.vhdx', '.wim',
  '.bin', '.dat', '.pak', '.wasm', '.so', '.dylib', '.a', '.lib', '.obj', '.o',
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.ico', '.tif', '.tiff', '.psd',
  '.mp3', '.mp4', '.avi', '.mov', '.wav', '.flac', '.ogg',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.lnk', '.url'
]);

const BLOCKED_BASENAMES = new Set([
  '.env', '.netrc', '.pgpass', '.npmrc',
  'id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519',
  'authorized_keys', 'known_hosts',
  'privatekey', 'private-key', 'credentials', 'credentials.json',
  'secrets', 'secrets.json'
]);

const BLOCKED_NAME_PATTERN = /(?:^|[._-])(credential|secret|private[._-]?key)(?:[._-]|$)/i;
const CONTROL_CHARS = /[\u0000-\u001f]/;
const WINDOWS_INVALID = /[<>:"|?*]/;

class GuardError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// ============================== 路径与敏感检查 ==============================

function normalizeSegments(input, { allowEmpty }) {
  if (typeof input !== 'string') throw new GuardError('BAD_PATH', 'path 必须为字符串');
  let value = input.trim();
  if (!value) {
    if (allowEmpty) return [];
    throw new GuardError('BAD_PATH', 'path 不能为空');
  }
  if (value.length > 1024) throw new GuardError('BAD_PATH', 'path 过长（>1024）');
  if (CONTROL_CHARS.test(value)) throw new GuardError('BAD_PATH', 'path 含控制字符');
  if (/^[\\/]{2}/.test(value)) throw new GuardError('BAD_PATH', '禁止 UNC 路径');
  if (/^[A-Za-z]:/.test(value)) throw new GuardError('BAD_PATH', '禁止绝对路径（盘符）');
  if (value.startsWith('/') || value.startsWith('\\')) throw new GuardError('BAD_PATH', '禁止绝对路径');
  value = value.replace(/\\/g, '/');
  if (value.includes(':')) throw new GuardError('BAD_PATH', '禁止数据流(ADS)');
  const segments = [];
  for (const raw of value.split('/')) {
    if (raw === '') continue;
    if (raw === '.' || raw === '..') throw new GuardError('BAD_PATH', '禁止 . 或 .. 段');
    if (raw.length > 255) throw new GuardError('BAD_PATH', '路径段过长（>255）');
    if (WINDOWS_INVALID.test(raw)) throw new GuardError('BAD_PATH', '路径段含 Windows 非法字符');
    if (CONTROL_CHARS.test(raw)) throw new GuardError('BAD_PATH', '路径段含控制字符');
    if (/[. ]$/.test(raw)) throw new GuardError('BAD_PATH', '路径段以点或空格结尾');
    const base = raw.split('.')[0].toUpperCase();
    if (RESERVED_NAMES.has(base)) throw new GuardError('BAD_PATH', '保留设备名：' + raw);
    segments.push(raw);
  }
  if (!segments.length && !allowEmpty) throw new GuardError('BAD_PATH', 'path 未指向任何文件');
  return segments;
}

function assertNotBlockedFile(absPath) {
  const base = path.basename(absPath).toLowerCase();
  const ext = path.extname(base);
  if (BLOCKED_EXTENSIONS.has(ext)) throw new GuardError('BLOCKED_EXTENSION', '拒绝敏感/二进制扩展名：' + ext);
  if (BLOCKED_BASENAMES.has(base)) throw new GuardError('BLOCKED_NAME', '拒绝敏感文件名：' + base);
  if (BLOCKED_NAME_PATTERN.test(base)) throw new GuardError('BLOCKED_NAME', '拒绝敏感文件名模式：' + base);
}

function isInside(rootReal, candidateReal) {
  const root = rootReal.toLowerCase();
  const cand = candidateReal.toLowerCase();
  return cand === root || cand.startsWith(root + path.sep);
}

async function realpathRoot(root) {
  try {
    return await fsp.realpath(root);
  } catch (e) {
    throw new GuardError('ROOT_UNAVAILABLE', '工作根不存在或不可访问：' + root);
  }
}

async function resolveEntry(root, segments, { allowMissingLeaf }) {
  const rootReal = await realpathRoot(root);
  if (!segments.length) {
    const stat = await fsp.lstat(rootReal);
    return { abs: rootReal, exists: true, stat };
  }
  let parent = rootReal;
  for (let i = 0; i < segments.length; i++) {
    const next = path.join(parent, segments[i]);
    let stat;
    try {
      stat = await fsp.lstat(next);
    } catch (e) {
      if (e.code === 'ENOENT' && allowMissingLeaf && i === segments.length - 1) {
        return { abs: next, exists: false, stat: null };
      }
      throw new GuardError('NOT_FOUND', '路径不存在：' + segments.slice(0, i + 1).join('/'));
    }
    if (stat.isSymbolicLink()) throw new GuardError('REPARSE_REJECTED', '拒绝符号链接/junction：' + segments.slice(0, i + 1).join('/'));
    if (i < segments.length - 1) {
      if (!stat.isDirectory()) throw new GuardError('NOT_DIRECTORY', '中间段不是目录：' + segments.slice(0, i + 1).join('/'));
      parent = next;
      continue;
    }
    if (!stat.isFile() && !stat.isDirectory()) throw new GuardError('UNSUPPORTED_TYPE', '不是普通文件或目录');
    const real = await fsp.realpath(next);
    if (!isInside(rootReal, real)) throw new GuardError('ESCAPE', '路径逃逸工作根');
    return { abs: real, exists: true, stat };
  }
  throw new GuardError('BAD_PATH', '路径解析失败');
}

function relativeToRoot(root, abs) {
  return path.relative(root, abs).split(path.sep).join('/');
}

async function fileSha256(abs) {
  const bytes = await fsp.readFile(abs);
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

async function writeAtomic(abs, bytes) {
  const dir = path.dirname(abs);
  const tmp = path.join(dir, '.xjy-guard-' + crypto.randomUUID() + '.tmp');
  let handle;
  try {
    handle = await fsp.open(tmp, 'wx', 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
  try {
    await fsp.rename(tmp, abs);
  } catch (e) {
    try { await fsp.unlink(tmp); } catch { /* 忽略 */ }
    throw new GuardError('WRITE_FAILED', '原子替换失败：' + e.message);
  }
}

async function backupToPrivate(root, abs, currentSha) {
  const dir = path.join(root, '.xjy-guard', 'backups');
  await fsp.mkdir(dir, { recursive: true });
  const rel = relativeToRoot(root, abs).replace(/[\\/]/g, '__');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(dir, stamp + '__' + currentSha.slice(0, 12) + '__' + rel);
  await fsp.copyFile(abs, target);
  const verify = await fileSha256(target);
  if (verify !== currentSha) throw new GuardError('BACKUP_MISMATCH', '备份回读摘要不符');
  return relativeToRoot(root, target);
}

// ============================== 四工具核心 ==============================

async function coreRead(root, limits, args) {
  const segments = normalizeSegments(args.path, { allowEmpty: false });
  assertNotBlockedFile(path.join(root, ...segments));
  const resolved = await resolveEntry(root, segments, { allowMissingLeaf: false });
  if (!resolved.stat.isFile()) throw new GuardError('NOT_FILE', '不是普通文件');
  if (resolved.stat.size > limits.readBytes) throw new GuardError('TOO_LARGE', '文件超过读取上限：' + resolved.stat.size + ' > ' + limits.readBytes);
  const buffer = await fsp.readFile(resolved.abs);
  if (buffer.includes(0)) throw new GuardError('BINARY_REJECTED', '文件含 NUL 字节（疑似二进制）');
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new GuardError('BINARY_REJECTED', '文件不是合法 UTF-8 文本（疑似二进制）');
  }
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const allLines = text.split(/\r\n|\n|\r/);
  const totalLines = allLines.length;
  const startRaw = Number(args.startLine);
  const startLine = Number.isSafeInteger(startRaw) && startRaw >= 1 ? startRaw : 1;
  const maxRaw = Number(args.maxLines);
  const maxLines = Math.min(limits.maxLines, Number.isSafeInteger(maxRaw) && maxRaw >= 1 ? maxRaw : limits.defaultLines);
  const endLine = Math.min(totalLines, startLine + maxLines - 1);
  const body = startLine <= totalLines ? allLines.slice(startLine - 1, endLine).join('\n') : '';
  const truncated = startLine + maxLines - 1 < totalLines;
  const header = [
    'SHA256: ' + sha256,
    'SIZE: ' + buffer.length,
    'LINES: ' + totalLines + ' (showing ' + startLine + '-' + endLine + ' of ' + totalLines + ')',
    'PATH: ' + segments.join('/'),
    'TRUNCATED: ' + (truncated ? 'true' : 'false'),
    '---CONTENT---'
  ].join('\n');
  return header + '\n' + body;
}

async function coreList(root, limits, args) {
  const raw = typeof args.path === 'string' ? args.path : '';
  const segments = normalizeSegments(raw, { allowEmpty: true });
  const resolved = await resolveEntry(root, segments, { allowMissingLeaf: false });
  if (!resolved.stat.isDirectory()) throw new GuardError('NOT_DIRECTORY', '不是目录');
  const names = await fsp.readdir(resolved.abs);
  const entries = [];
  for (const name of names.sort((a, b) => a.localeCompare(b, 'en'))) {
    if (name === '.xjy-guard') continue;
    const child = path.join(resolved.abs, name);
    let stat;
    try { stat = await fsp.lstat(child); } catch { continue; }
    if (stat.isSymbolicLink()) { entries.push({ name, type: 'link', size: null }); continue; }
    if (stat.isDirectory()) { entries.push({ name, type: 'dir', size: null }); continue; }
    if (stat.isFile()) { entries.push({ name, type: 'file', size: stat.size }); continue; }
    entries.push({ name, type: 'other', size: null });
  }
  return JSON.stringify({ ok: true, path: segments.join('/') || '.', count: entries.length, entries });
}

async function coreWrite(root, limits, args) {
  const segments = normalizeSegments(args.path, { allowEmpty: false });
  assertNotBlockedFile(path.join(root, ...segments));
  const content = args.content;
  if (typeof content !== 'string') throw new GuardError('BAD_CONTENT', 'content 必须为字符串');
  const bytes = Buffer.from(content, 'utf8');
  if (bytes.length > limits.writeBytes) throw new GuardError('TOO_LARGE', '内容超过写入上限：' + bytes.length + ' > ' + limits.writeBytes);
  if (bytes.toString('utf8') !== content) throw new GuardError('ENCODING', '内容含无法以 UTF-8 往返的字符');
  if (content.includes('\u0000')) throw new GuardError('CONTENT_NUL', '内容含 NUL 字节');
  const newSha = crypto.createHash('sha256').update(bytes).digest('hex');
  const resolved = await resolveEntry(root, segments, { allowMissingLeaf: true });
  if (resolved.exists) {
    if (!resolved.stat.isFile()) throw new GuardError('NOT_FILE', '目标是目录或特殊文件');
    const expected = typeof args.expectedSha256 === 'string' ? args.expectedSha256.trim().toLowerCase() : '';
    if (!/^[a-f0-9]{64}$/.test(expected)) throw new GuardError('MUST_READ_FIRST', '覆盖已有文件必须先 read 取得 SHA256，并作为 expectedSha256 传入');
    const current = await fileSha256(resolved.abs);
    if (current !== expected) throw new GuardError('SHA_MISMATCH', 'expectedSha256 与当前文件不符，请重新 read');
    const backup = await backupToPrivate(root, resolved.abs, current);
    await writeAtomic(resolved.abs, bytes);
    if ((await fileSha256(resolved.abs)) !== newSha) throw new GuardError('WRITE_VERIFY', '写入后摘要不符');
    return JSON.stringify({ ok: true, path: segments.join('/'), updated: true, size: bytes.length, sha256: newSha, backup });
  }
  if (args.expectedAbsent !== true) throw new GuardError('MUST_DECLARE_ABSENT', '新建文件必须显式 expectedAbsent:true');
  const parent = path.dirname(resolved.abs);
  const parentStat = await fsp.lstat(parent).catch(() => null);
  if (!parentStat || !parentStat.isDirectory()) throw new GuardError('PARENT_MISSING', '父目录不存在（不自动创建）：' + relativeToRoot(root, parent));
  await writeAtomic(resolved.abs, bytes);
  if ((await fileSha256(resolved.abs)) !== newSha) throw new GuardError('WRITE_VERIFY', '写入后摘要不符');
  return JSON.stringify({ ok: true, path: segments.join('/'), created: true, size: bytes.length, sha256: newSha });
}

function runNodeCheck(nodeExe, file) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(nodeExe, ['--check', file], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      resolve({ exitCode: -1, stdout: '', stderr: String(e.message || e) });
      return;
    }
    let stdout = '';
    let stderr = '';
    let done = false;
    const finish = (code) => {
      if (done) return;
      done = true;
      resolve({ exitCode: typeof code === 'number' ? code : -1, stdout, stderr });
    };
    child.stdout.on('data', (d) => { if (stdout.length < 65536) stdout += d.toString('utf8'); });
    child.stderr.on('data', (d) => { if (stderr.length < 65536) stderr += d.toString('utf8'); });
    child.once('error', (e) => { stderr += String(e.message || e); finish(-1); });
    child.once('close', (code) => finish(code));
    const timer = setTimeout(() => { try { child.kill(); } catch { /* 忽略 */ } finish(-1); }, 20000);
    child.once('close', () => clearTimeout(timer));
  });
}

async function coreCheck(root, limits, args, nodeExe) {
  const segments = normalizeSegments(args.path, { allowEmpty: false });
  const resolved = await resolveEntry(root, segments, { allowMissingLeaf: false });
  if (!resolved.stat.isFile()) throw new GuardError('NOT_FILE', '不是普通文件');
  const ext = path.extname(resolved.abs).toLowerCase();
  if (ext === '.cmd' || ext === '.bat' || ext === '.ps1') {
    return JSON.stringify({ ok: true, executed: false, type: ext, path: segments.join('/'), message: '该类型不执行语法检查（不 spawn）' });
  }
  if (ext !== '.cjs' && ext !== '.mjs') throw new GuardError('UNSUPPORTED_TYPE', 'check 只支持 .cjs/.mjs（收到 ' + (ext || '(无扩展名)') + '）');
  assertNotBlockedFile(resolved.abs);
  if (resolved.stat.size > limits.checkBytes) throw new GuardError('TOO_LARGE', '文件超过检查上限：' + resolved.stat.size);
  const dir = path.join(root, '.xjy-guard', 'checks');
  await fsp.mkdir(dir, { recursive: true });
  const copy = path.join(dir, 'check-' + crypto.randomUUID() + ext);
  try {
    await fsp.copyFile(resolved.abs, copy);
    const result = await runNodeCheck(nodeExe, copy);
    return JSON.stringify({
      ok: result.exitCode === 0,
      executed: true,
      type: ext,
      path: segments.join('/'),
      exitCode: result.exitCode,
      stdout: result.stdout.slice(0, 4000),
      stderr: result.stderr.slice(0, 4000)
    });
  } finally {
    try { await fsp.unlink(copy); } catch { /* 忽略 */ }
  }
}

// ============================== 日志 ==============================

function appendLog(root, entry) {
  try {
    const dir = path.join(root, '.xjy-guard', 'logs');
    fs.mkdirSync(dir, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    const line = JSON.stringify(Object.assign({ at: new Date().toISOString() }, entry));
    fs.appendFileSync(path.join(dir, 'guard-' + day + '.log'), line + '\n', 'utf8');
  } catch { /* 日志失败不影响工具 */ }
}

function summarizeArgs(args) {
  if (!args || typeof args !== 'object') return {};
  const out = {};
  for (const [key, value] of Object.entries(args)) {
    if (key === 'content') {
      const text = String(value ?? '');
      out.content = '[len=' + text.length + '] ' + text.slice(0, 120);
    } else if (typeof value === 'string' && value.length > 200) {
      out[key] = value.slice(0, 200) + '…';
    } else {
      out[key] = value;
    }
  }
  return out;
}

// ============================== 工具定义 ==============================

const TOOL_DEFS = Object.freeze({
  xjy_read: {
    description: '读取工作根内 UTF-8 文本文件。返回 SHA256（覆盖写入前必须先 read 取得）、字节数、行数与分页内容。',
    parameters: {
      path: { type: 'string', required: true },
      startLine: { type: 'number', required: false },
      maxLines: { type: 'number', required: false }
    }
  },
  xjy_list: {
    description: '列出工作根内某目录的直接子项（名称/类型/大小），不返回文件内容、不列出桥私有目录。',
    parameters: {
      path: { type: 'string', required: false }
    }
  },
  xjy_write: {
    description: '写入工作根内 UTF-8 文本文件。新建须 expectedAbsent:true；覆盖须 expectedSha256（先 read 取得），桥自动备份旧版本。',
    parameters: {
      path: { type: 'string', required: true },
      content: { type: 'string', required: true },
      expectedSha256: { type: 'string', required: false },
      expectedAbsent: { type: 'boolean', required: false }
    }
  },
  xjy_check: {
    description: '用固定官方 Node --check 检查 .cjs/.mjs 语法（副本执行，不执行产品）；.cmd/.bat/.ps1 不执行。',
    parameters: {
      path: { type: 'string', required: true }
    }
  }
});

function buildToolDefinition(name, core, kind) {
  const meta = TOOL_DEFS[name];
  return {
    name,
    description: meta.description,
    parameters: meta.parameters,
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value ?? '') }]
    },
    async execute(args) {
      const started = Date.now();
      const safeArgs = summarizeArgs(args);
      try {
        const value = await core[kind](args || {});
        const text = String(value);
        appendLog(core.root, { tool: name, args: safeArgs, ok: true, ms: Date.now() - started, resultPreview: text.slice(0, 400) });
        return text;
      } catch (e) {
        const code = e && e.code ? e.code : 'TOOL_FAILED';
        const message = String((e && e.message) || e);
        const payload = JSON.stringify({ ok: false, code, message });
        appendLog(core.root, { tool: name, args: safeArgs, ok: false, code, message, ms: Date.now() - started });
        return payload;
      }
    }
  };
}

// ============================== Guard Core 工厂（测试用） ==============================

export function createGuardCore(root, options = {}) {
  const rootAbs = path.resolve(root);
  const nodeExe = options.nodeExe || OFFICIAL_NODE;
  const limits = Object.freeze({
    readBytes: options.readBytes || DEFAULT_LIMITS.readBytes,
    writeBytes: options.writeBytes || DEFAULT_LIMITS.writeBytes,
    checkBytes: options.checkBytes || DEFAULT_LIMITS.checkBytes,
    maxLines: DEFAULT_LIMITS.maxLines,
    defaultLines: DEFAULT_LIMITS.defaultLines
  });
  return Object.freeze({
    root: rootAbs,
    limits,
    read: (args) => coreRead(rootAbs, limits, args),
    list: (args) => coreList(rootAbs, limits, args),
    write: (args) => coreWrite(rootAbs, limits, args),
    check: (args) => coreCheck(rootAbs, limits, args, nodeExe),
    normalizeSegments,
    isInside,
    appendLog: (entry) => appendLog(rootAbs, entry)
  });
}

// ============================== 官方模块加载（测试可失败隔离） ==============================

let Service = null;
let defineTool = null;
let officialError = null;
try {
  const cordis = await import(CORDIS_URL);
  Service = cordis.Service || (cordis.default && cordis.default.Service) || null;
  const toolsModule = await import(TOOLS_URL);
  defineTool = toolsModule.defineTool || (toolsModule.default && toolsModule.default.defineTool) || null;
  if (!Service) throw new Error('cordis 模块未导出 Service');
  if (!defineTool) throw new Error('dsh-tools 模块未导出 defineTool');
} catch (e) {
  officialError = String((e && e.message) || e);
}

function extractToolName(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return null;
  if (typeof value.name === 'string') return value.name;
  if (value.schema && typeof value.schema === 'object' && typeof value.schema.name === 'string') return value.schema.name;
  if (typeof value.toolName === 'string') return value.toolName;
  return null;
}

class FallbackService {
  constructor(ctx, name) {
    this.ctx = ctx;
    this.name = name;
  }
}

const BaseService = Service || FallbackService;

// ============================== Service ==============================

export class XjyDevelopmentGuard extends BaseService {
  static inject = ['tools', 'llm'];

  constructor(ctx) {
    super(ctx, 'xjyReviewGuard');
    this.root = WRITE_ROOT;
    this.core = createGuardCore(this.root);
    appendLog(this.root, {
      event: 'guard-loaded',
      root: this.root,
      allowedTools: ALLOWED_TOOLS.slice(),
      strictStream: STRICT_STREAM,
      officialError
    });
    this.installTools(ctx);
    this.installStreamGuard(ctx);
    this.installStdinExit(ctx);
  }

  installTools(ctx) {
    if (!defineTool) {
      appendLog(this.root, { event: 'guard-disabled', reason: 'defineTool 不可用', officialError });
      return;
    }
    const defs = [
      buildToolDefinition('xjy_read', this.core, 'read'),
      buildToolDefinition('xjy_list', this.core, 'list'),
      buildToolDefinition('xjy_write', this.core, 'write'),
      buildToolDefinition('xjy_check', this.core, 'check')
    ];
    for (const def of defs) {
      try {
        const tool = defineTool(def);
        ctx.tools.register(tool);
        appendLog(this.root, { event: 'tool-registered', tool: def.name });
      } catch (e) {
        appendLog(this.root, { event: 'tool-register-failed', tool: def.name, message: String((e && e.message) || e) });
      }
    }
  }

  installStreamGuard(ctx) {
    if (typeof ctx.on !== 'function') {
      appendLog(this.root, { event: 'stream-guard-skipped', reason: 'ctx.on 不可用' });
      return;
    }
    try {
      ctx.on('llm/stream', (session, request) => {
        try {
          const tools = request && Array.isArray(request.tools) ? request.tools : null;
          if (!tools || tools.length === 0) return;
          const names = tools.map(extractToolName);
          const bad = names.filter((name) => typeof name !== 'string' || !ALLOWED_TOOLS.includes(name));
          if (tools.length !== ALLOWED_TOOLS.length || bad.length) {
            appendLog(this.root, { event: 'llm-stream-reject', names, expected: ALLOWED_TOOLS.slice() });
            if (STRICT_STREAM) {
              const err = new Error('xjy-guard: 工具集合必须恰好是 ' + ALLOWED_TOOLS.join(','));
              err.code = 'XJY_GUARD_TOOL_SET';
              throw err;
            }
            return;
          }
          appendLog(this.root, { event: 'llm-stream-allow', names });
        } catch (e) {
          if (e && e.code === 'XJY_GUARD_TOOL_SET') throw e;
          appendLog(this.root, { event: 'stream-guard-error', message: String((e && e.message) || e) });
        }
      });
    } catch (e) {
      appendLog(this.root, { event: 'stream-guard-skipped', message: String((e && e.message) || e) });
    }
  }

  installStdinExit(ctx) {
    const stdin = process.stdin;
    if (!stdin || typeof stdin.on !== 'function') return;
    try {
      stdin.setEncoding('utf8');
      let buffer = '';
      stdin.on('data', (chunk) => {
        buffer += chunk;
        let at;
        while ((at = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, at).replace(/\r$/, '').trim();
          buffer = buffer.slice(at + 1);
          if (line !== STOP_TOKEN) continue;
          appendLog(this.root, { event: 'stdin-stop-requested' });
          let exited = false;
          try {
            const exit = typeof ctx.get === 'function' ? ctx.get('appExit') : null;
            if (typeof exit === 'function') { exit(0); exited = true; }
          } catch (e) {
            appendLog(this.root, { event: 'stdin-stop-exit-failed', message: String((e && e.message) || e) });
          }
          if (!exited) {
            try { process.exit(0); } catch { /* 忽略 */ }
          }
        }
      });
    } catch (e) {
      appendLog(this.root, { event: 'stdin-hook-skipped', message: String((e && e.message) || e) });
    }
  }
}

export default XjyDevelopmentGuard;
export {
  ALLOWED_TOOLS,
  WRITE_ROOT,
  OFFICIAL_NODE,
  DEFAULT_LIMITS,
  GuardError,
  normalizeSegments,
  assertNotBlockedFile,
  isInside,
  STOP_TOKEN
};
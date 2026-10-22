'use strict';
/**
 * accept-harness.cjs — 离线判断「某台已装某个 sequence 的 1.7.0 员工机」会不会接受
 * 我们准备发布的这份原生更新（native-manifest.json + native-package.zip）。
 *
 * 设计原则：不重写校验逻辑，判定权全部交给**从现网 app.asar 里取出的真实客户端模块**：
 *   native-update-manifest.cjs  → verifyNativeManifest / validateManifestPayload / publicationDecision
 *   native-publication-update.cjs → 客户端真正的分发入口（它 re-export 上面这组函数并驱动 check()）
 * 本工具只做三件事：把模块取到临时目录 require、把「已装收据」参数化喂进去、把失败点翻译成
 * 人可执行的下一步。模块不做的事（例如整包摘要核对）才在工具里补，且用真实模块的 archive 字段做基准。
 *
 * 只读：app.asar / 生产目录只读；解包与夹具一律落在 %TEMP% 或工具目录。
 *
 * 用法：
 *   node accept-harness.cjs --manifest <native-manifest.json> [--archive <native-package.zip>]
 *        [--installed-sequence 20] [--installed-catalog-sha <64hex>]
 *        [--app-asar <app.asar>] [--public-key-pem <publisher-public.pem>]
 *        [--high-water-sequence 0] [--now <iso|ms>] [--live-manifest <path>] [--asar-cache-dir <dir>]
 *
 * 退出码：0 = 接受；2 = 被拒（打印 reason）；1 = 工具错误。
 * 输出：单 JSON {manifestOk, signatureOk, identityOk, sequenceGate, archiveMatches, decision, reason, nextAction}
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

// 现网客户端在 native-update-manifest.cjs:5 硬编码的发行公钥（SPKI-DER sha256）。
const PINNED_PUBLISHER = '6e8b9cadb59aeb53f30d41f4471f70f644f0dfc7376ffb9d8a4c62defb98458c';
// 客户端 verifyNativeManifest 先验签名再验 payload：抛出这三种码，说明签名已经通过。
const SIGNATURE_PASSED_CODES = new Set(['BAD_NATIVE_MANIFEST', 'EXPIRED_NATIVE_MANIFEST', 'STALE_NATIVE_MANIFEST']);
const SHA = /^[a-f0-9]{64}$/;
const NPX_CLI = 'E:\\node\\node_modules\\npm\\bin\\npx-cli.js';
const NPX_CMD = 'E:\\node\\npx.cmd';

const DEFAULTS = {
  appAsar: 'F:\\自制软件\\xjy-jewelry-offline\\resources\\app.asar',
  publicKeyPem: 'D:\\Codex\\xjy-release-20261022\\candidate\\proposal\\worker-draft\\publisher-public.pem',
  installedSequence: 20,
  highWater: 0,
  // 现网当前发布的原生清单（只读）。仅在未显式给 --installed-catalog-sha、且其 sequence
  // 与 --installed-sequence 相等时，用来推断「已装完整目录摘要」——那种情况说明本机装的
  // 就是现网这一版。
  liveManifest: 'F:\\鑫金源珠宝资料\\程序设置\\员工升级\\native-manifest.json'
};

const NEXT = {
  BAD_NATIVE_SIGNATURE:
    '确认 --manifest 是审计器产出的 {manifest,signature} 包装、签名对象是 manifest 的原始 UTF-8 字节（Ed25519），且 --public-key-pem 与签名私钥成对。',
  BAD_NATIVE_OPTIONS: '检查命令行参数：--installed-sequence / --high-water-sequence 必须是非负整数，--now 必须可解析。',
  BAD_NATIVE_IDENTITY:
    '现网 1.7.0 客户端硬校验 targetVersion=1.7.0 且 engineVersion=44.9.0（native-update-manifest.cjs:16）。要发布 1.7.1 必须先用新的客户端替换这两处硬编码，否则任何 1.7.0 员工机都会拒绝这份清单。',
  EXPIRED_NATIVE_MANIFEST:
    '把 expiresAt 改到未来、publishedAt 不得晚于当前时间 5 分钟，然后用发行私钥重签这份清单。',
  STALE_NATIVE_MANIFEST:
    'sequence 必须严格大于已装 sequence（--installed-sequence）：要下发更新就得提升 sequence，并让 fullTargetCatalogSha256 指向真实的完整目标目录。',
  BAD_NATIVE_MANIFEST:
    '按现网契约修正清单结构：schemaVersion=1、purpose=xjy-native-employee-update-v1、app/platform/arch/role=xjy-jewelry-offline/win32/x64/employee，文件表须含固定维护入口，worker 必须是 246302720 / db3ad206…，bindingSha256 必须等于 engine-native170-binding.json 的摘要。',
  NATIVE_SOURCE_UNVERIFIED:
    '--installed-sequence / --installed-catalog-sha 必须描述真实的已装收据（摘要为 64 位十六进制）。',
  ARCHIVE_MISMATCH:
    '--archive 必须与 manifest.archive.size / sha256 逐位一致（同一个构建产物）。不要拿 package.zip 或别次构建的包来配这份清单。',
  ARCHIVE_NOT_PROVIDED: '补上 --archive <native-package.zip>：发布前必须核对整包摘要，否则下游分块下载一定失败。',
  LATEST_ALREADY_INSTALLED:
    '这份发布对「已装该 sequence 且目录摘要相同」的机器是空操作（客户端回答 latest，不会下发更新）。要真正下发必须同时做两件事：提升 sequence、更换 fullTargetCatalogSha256。',
  AVAILABLE: '可以发布：客户端会把这份清单判为 available 并开始分块下载，交给受信原生助手。'
};

class ToolError extends Error {
  constructor(code, message, nextAction) {
    super(message);
    this.code = code;
    this.nextAction = nextAction || '';
  }
}

// ---------------------------------------------------------------- CLI

function parseArgs(argv) {
  const out = { ...DEFAULTS };
  const map = {
    '--app-asar': 'appAsar',
    '--manifest': 'manifest',
    '--archive': 'archive',
    '--installed-sequence': 'installedSequence',
    '--installed-catalog-sha': 'installedCatalogSha',
    '--public-key-pem': 'publicKeyPem',
    '--high-water-sequence': 'highWater',
    '--now': 'now',
    '--live-manifest': 'liveManifest',
    '--asar-cache-dir': 'cacheDir'
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { out.help = true; continue; }
    const key = map[a];
    if (!key) throw new ToolError('BAD_ARGS', `未知参数 ${a}`, '运行 --help 查看用法。');
    const v = argv[++i];
    if (v === undefined) throw new ToolError('BAD_ARGS', `${a} 缺少取值`, '运行 --help 查看用法。');
    out[key] = key === 'installedSequence' || key === 'highWater' ? Number(v) : v;
    if (key === 'publicKeyPem') out.publicKeyPemExplicit = true;
  }
  if (out.help) return out;
  if (!out.manifest) throw new ToolError('BAD_ARGS', '必须提供 --manifest <native-manifest.json>', '运行 --help 查看用法。');
  if (!Number.isSafeInteger(out.installedSequence) || out.installedSequence < 0) {
    throw new ToolError('BAD_ARGS', `--installed-sequence 必须是非负整数（收到 ${argv.includes('--installed-sequence') ? out.installedSequence : '默认 20'}）`, '例如 --installed-sequence 20');
  }
  if (!Number.isSafeInteger(out.highWater) || out.highWater < 0) {
    throw new ToolError('BAD_ARGS', '--high-water-sequence 必须是非负整数', '默认 0；只有本机已记录过更高序号时才需要传。');
  }
  if (out.installedCatalogSha !== undefined && !SHA.test(out.installedCatalogSha)) {
    throw new ToolError('BAD_ARGS', '--installed-catalog-sha 必须是 64 位小写十六进制', '取已装收据的完整目录摘要（catalogSha256）。');
  }
  return out;
}

function resolveNow(raw) {
  if (raw === undefined) return Date.now();
  const n = /^\d+$/.test(raw) ? Number(raw) : Date.parse(raw);
  if (!Number.isFinite(n)) throw new ToolError('BAD_ARGS', `--now 无法解析：${raw}`, '传 ISO 时间（2026-10-22T00:00:00Z）或毫秒时间戳。');
  return n;
}

// ---------------------------------------------------------------- 取真实客户端模块

function npxAsar(args, cwd) {
  const full = ['--yes', '@electron/asar', ...args];
  try {
    if (fs.existsSync(NPX_CLI)) {
      execFileSync(process.execPath, [NPX_CLI, ...full], { cwd, stdio: 'pipe', timeout: 600000, windowsHide: true });
    } else {
      execFileSync(NPX_CMD, full, { cwd, stdio: 'pipe', timeout: 600000, windowsHide: true, shell: true });
    }
  } catch (e) {
    throw new ToolError('ASAR_EXTRACT_FAILED', `从 app.asar 取 ${args[1]} 失败：${e.message.split('\n')[0]}`, '确认 --app-asar 指向真实 app.asar，且 E:\\node\\npx 可用。');
  }
}

function loadModules(asarPath, cacheDir) {
  if (!fs.existsSync(asarPath)) throw new ToolError('ASAR_MISSING', `找不到 app.asar：${asarPath}`, '用 --app-asar 指向员工机上真实安装的 resources/app.asar。');
  const st = fs.statSync(asarPath);
  const key = crypto.createHash('sha256').update(`${asarPath}|${st.size}|${st.mtimeMs}`).digest('hex').slice(0, 16);
  const root = path.join(cacheDir || path.join(os.tmpdir(), 'xjy-s6-accept-asar'), key);
  const single = path.join(root, 'single');
  const app = path.join(root, 'app');

  const manifestFile = path.join(single, 'native-update-manifest.cjs');
  const publicationFile = path.join(single, 'native-publication-update.cjs');
  fs.mkdirSync(single, { recursive: true });
  // 按任务约定用 extract-file 精确取目标模块（先取核心校验模块，它零依赖，永远可用）
  if (!fs.existsSync(manifestFile)) npxAsar(['extract-file', asarPath, 'native-update-manifest.cjs'], single);
  if (!fs.existsSync(publicationFile)) npxAsar(['extract-file', asarPath, 'native-publication-update.cjs'], single);

  let manifestMod;
  try { manifestMod = require(manifestFile); }
  catch (e) { throw new ToolError('ASAR_MODULE_UNAVAILABLE', `native-update-manifest.cjs 无法 require：${e.code || ''} ${e.message}`, '确认 app.asar 完整（可先手工 asar extract 一次）。'); }

  // native-publication-update.cjs 依赖同目录多个模块，单独取文件 require 会缺依赖 → 整包解：
  let pubMod = null;
  try { pubMod = require(publicationFile); } catch { /* 缺依赖，走整包解 */ }
  if (!pubMod) {
    const appFile = path.join(app, 'native-publication-update.cjs');
    if (!fs.existsSync(appFile)) {
      fs.rmSync(app, { recursive: true, force: true });
      fs.mkdirSync(app, { recursive: true });
      npxAsar(['extract', asarPath, app], root);
    }
    try { pubMod = require(path.join(app, 'native-publication-update.cjs')); }
    catch (e) { throw new ToolError('ASAR_MODULE_UNAVAILABLE', `native-publication-update.cjs 无法 require：${e.code || ''} ${e.message}`, '确认 app.asar 完整；该模块是客户端真正走的分发路径，缺它就无法声称“按客户端判定”。'); }
  }
  for (const fn of ['verifyNativeManifest', 'validateManifestPayload', 'publicationDecision']) {
    if (typeof manifestMod[fn] !== 'function') throw new ToolError('ASAR_MODULE_SHAPE', `native-update-manifest.cjs 缺少 ${fn}`, 'app.asar 里换过实现？先确认版本。');
  }
  if (typeof pubMod.verifyNativeManifest !== 'function' || typeof pubMod.publicationDecision !== 'function') {
    throw new ToolError('ASAR_MODULE_SHAPE', 'native-publication-update.cjs 未导出 verifyNativeManifest/publicationDecision', 'app.asar 里换过实现？先确认版本。');
  }
  return { manifestMod, pubMod, manifestFile, publicationFile: path.join(app, 'native-publication-update.cjs') };
}

// 发行公钥的落点会随提案目录重建而变（candidate/proposal 会被重新打包），所以按顺序找：
// 显式参数 → 默认路径 → 清单同目录 / 上一级目录的 publisher-public.pem。找到的必须与客户端 pin 一致。
function resolvePublicKey(args) {
  const tries = [];
  if (args.publicKeyPemExplicit) tries.push(args.publicKeyPem);
  if (!tries.includes(DEFAULTS.publicKeyPem)) tries.push(DEFAULTS.publicKeyPem);
  if (args.manifest) {
    const dir = path.dirname(path.resolve(args.manifest));
    tries.push(path.join(dir, 'publisher-public.pem'), path.join(path.dirname(dir), 'publisher-public.pem'));
  }
  const existing = tries.filter(p => p && fs.existsSync(p));
  if (!existing.length) {
    throw new ToolError('PUBLIC_KEY_MISSING', `找不到发行公钥，已找过：${tries.join(' / ')}`, '用 --public-key-pem 指向提案里的 publisher-public.pem（必须是客户端 pin 的那把）。');
  }
  return existing[0];
}

function loadPublicKey(pemPath) {
  if (!fs.existsSync(pemPath)) throw new ToolError('PUBLIC_KEY_MISSING', `找不到发行公钥：${pemPath}`, '用 --public-key-pem 指向客户端 pin 的那把发行公钥（publisher-public.pem）。');
  const text = fs.readFileSync(pemPath, 'utf8');
  let key;
  let der;
  try {
    key = crypto.createPublicKey(text);
    der = crypto.createHash('sha256').update(key.export({ format: 'der', type: 'spki' })).digest('hex');
  } catch (e) {
    throw new ToolError('BAD_PUBLIC_KEY', `发行公钥无法解析：${e.message}`, '传 PEM 编码的 Ed25519 公钥（publisher-public.pem）。');
  }
  if (der !== PINNED_PUBLISHER) {
    throw new ToolError('BAD_PUBLIC_KEY', `发行公钥 SPKI-DER sha256=${der}，与现网客户端硬编码的 pin ${PINNED_PUBLISHER} 不符`, '换回客户端 pin 的那把公钥；用别的密钥验签无法代表现网机器的判定。');
  }
  // 注意：客户端 verifyNativeManifest 收的是 PEM **文本**（内部直接 createPublicKey），不是路径。
  return { text, key, der };
}

// ---------------------------------------------------------------- 身份门：直接读部署模块自己的硬编码

// 现网 app.asar 里 native-update-manifest.cjs:16 的硬校验是唯一权威。为避免把常量抄进本工具
// 造成漂移，这里从**被 require 的那个模块源码**里取它要求的身份值。
function requiredIdentity(moduleFile) {
  let src;
  try { src = fs.readFileSync(moduleFile, 'utf8'); } catch { return null; }
  const pick = re => { const m = src.match(re); return m ? m[1] : null; };
  const schema = src.match(/m\.schemaVersion!==(\d+)/);
  const req = {
    schemaVersion: schema ? Number(schema[1]) : null,
    purpose: pick(/m\.purpose!=='([^']+)'/),
    app: pick(/m\.app!=='([^']+)'/),
    platform: pick(/m\.platform!=='([^']+)'/),
    arch: pick(/m\.arch!=='([^']+)'/),
    role: pick(/m\.role!=='([^']+)'/),
    targetVersion: pick(/m\.targetVersion!=='([^']+)'/),
    engineVersion: pick(/m\.engineVersion!=='([^']+)'/)
  };
  return Object.values(req).some(v => v === null) ? null : req;
}

function identityCheck(req, payload) {
  if (!req) return { known: false, ok: false, mismatched: [], req: null };
  if (!payload || typeof payload !== 'object') return { known: true, ok: false, mismatched: Object.keys(req), req };
  const mismatched = Object.keys(req).filter(k => payload[k] !== req[k]);
  return { known: true, ok: mismatched.length === 0, mismatched, req };
}

function describeIdentity(detail, payload) {
  if (!detail.req) return '无法从 app.asar 模块里读出身份硬校验';
  return detail.mismatched
    .map(k => `${k}: 清单是 ${JSON.stringify(payload ? payload[k] : null)}，客户端要求 ${JSON.stringify(detail.req[k])}`)
    .join('; ');
}

// ---------------------------------------------------------------- 已装收据

function resolveInstalled(manifestMod, args) {
  if (args.installedCatalogSha) return { sha: args.installedCatalogSha, source: 'arg' };
  const live = args.liveManifest;
  if (!live || !fs.existsSync(live)) {
    throw new ToolError('MISSING_INSTALLED_CATALOG', '未给 --installed-catalog-sha，且现网发布清单不可读，无法推断这台机器的已装完整目录摘要', '显式传 --installed-catalog-sha <64hex>（已装收据的 catalogSha256）。');
  }
  let seq = null;
  let sha = null;
  try {
    const env = JSON.parse(fs.readFileSync(live, 'utf8'));
    const m = JSON.parse(env.manifest);
    seq = m.sequence;
    sha = m.fullTargetCatalogSha256;
  } catch {
    throw new ToolError('MISSING_INSTALLED_CATALOG', `现网发布清单无法解析：${live}`, '显式传 --installed-catalog-sha。');
  }
  if (seq !== args.installedSequence) {
    throw new ToolError('MISSING_INSTALLED_CATALOG',
      `现网发布清单 sequence=${seq} 与 --installed-sequence=${args.installedSequence} 不一致，无法用它的摘要代表已装状态`,
      '已装序号与现网发布不同时，请显式传 --installed-catalog-sha <64hex>（并确认它对应的是已装那一版）。');
  }
  if (!SHA.test(sha || '')) throw new ToolError('MISSING_INSTALLED_CATALOG', '现网发布清单的 fullTargetCatalogSha256 不合法', '显式传 --installed-catalog-sha。');
  return { sha, source: `live-manifest(sequence=${seq})` };
}

// ---------------------------------------------------------------- 整包摘要

async function archiveDigest(file) {
  const h = crypto.createHash('sha256');
  const stream = fs.createReadStream(file);
  for await (const chunk of stream) h.update(chunk);
  return h.digest('hex');
}

async function checkArchive(archivePath, declared) {
  if (!archivePath) return { provided: false, matches: false, size: null, sha256: null, sizeMatches: false, shaMatches: false };
  if (!fs.existsSync(archivePath)) return { provided: true, missing: true, matches: false, size: null, sha256: null, sizeMatches: false, shaMatches: false };
  const size = fs.statSync(archivePath).size;
  const sizeMatches = size === declared.size;
  const sha256 = sizeMatches ? await archiveDigest(archivePath) : null;
  const shaMatches = sha256 !== null && sha256 === declared.sha256;
  return { provided: true, matches: sizeMatches && shaMatches, size, sha256, sizeMatches, shaMatches };
}

// ---------------------------------------------------------------- 判定

async function run(args) {
  const now = resolveNow(args.now);
  const { manifestMod, pubMod, manifestFile } = loadModules(args.appAsar, args.cacheDir);
  const pemPath = resolvePublicKey(args);
  if (args.publicKeyPemExplicit && pemPath !== args.publicKeyPem) {
    throw new ToolError('PUBLIC_KEY_MISSING', `指定的发行公钥不存在：${args.publicKeyPem}`, '指向真实存在的 publisher-public.pem。');
  }
  if (!args.publicKeyPemExplicit && pemPath !== DEFAULTS.publicKeyPem) process.stderr.write(`[accept-harness] 默认公钥路径不可用，已按清单目录找到：${pemPath}\n`);
  const publisher = loadPublicKey(pemPath);

  // 1) 签名门：先用 node:crypto 独立验一次，再与客户端 verifyNativeManifest 的结论对账。
  //    客户端 verifyNativeManifest 先验签名（:29-30）再验 payload（:31），所以它只抛出
  //    BAD_NATIVE_MANIFEST / EXPIRED_NATIVE_MANIFEST / STALE_NATIVE_MANIFEST 就说明签名已经过了。
  let envelope;
  try { envelope = JSON.parse(fs.readFileSync(args.manifest, 'utf8')); }
  catch (e) { throw new ToolError('MANIFEST_UNREADABLE', `--manifest 无法读取或不是 JSON：${e.message}`, '传审计器产出的 native-manifest.json（外层 {manifest,signature}）。'); }

  const manifestBytes = typeof envelope.manifest === 'string' ? Buffer.from(envelope.manifest) : null;
  const sigOkMine = !!(manifestBytes && typeof envelope.signature === 'string'
    && crypto.verify(null, manifestBytes, publisher.key, Buffer.from(envelope.signature, 'base64')));

  let sigOkClient = null;
  let sigCode = null;
  let sigMessage = null;
  try {
    manifestMod.verifyNativeManifest(envelope, { publicKey: publisher.text, now });
    sigOkClient = true;
  } catch (e) {
    const code = e.code || 'VERIFY_FAILED';
    if (code === 'BAD_NATIVE_SIGNATURE') { sigOkClient = false; sigCode = code; sigMessage = e.message; }
    else if (SIGNATURE_PASSED_CODES.has(code)) { sigOkClient = true; }
    else {
      throw new ToolError('ASAR_VERIFY_UNEXPECTED', `客户端 verifyNativeManifest 抛出不认识的错误码 ${code}：${e.message}`, '确认 --public-key-pem 指向 PEM 文件、app.asar 与现网同版本；本工具不敢在这种情形下给判定。');
    }
  }
  const signatureOk = sigOkMine && sigOkClient === true;
  if (sigOkClient !== sigOkMine) {
    throw new ToolError('ASAR_SIGNATURE_DISAGREEMENT', `node:crypto 判签名 ${sigOkMine ? '通过' : '不通过'}，app.asar 里的客户端模块判 ${sigOkClient ? '通过' : '不通过'}`, '两者不一致说明 asar 里的验签实现被改过，先查清再谈接受与否。');
  }
  if (!signatureOk && !sigCode) { sigCode = 'BAD_NATIVE_SIGNATURE'; sigMessage = '清单签名与 manifest 正文不匹配（被改过或用别的密钥签的）'; }

  // 2) 清单结构门：直接用客户端的 payload 校验（schema/身份/archive 声明/文件表/worker/binding）
  let payload = null;
  let payloadOk = false;
  let payloadCode = null;
  let payloadMessage = null;
  try { payload = JSON.parse(envelope.manifest); }
  catch { payloadCode = 'BAD_NATIVE_MANIFEST'; payloadMessage = '原生更新清单不是 JSON'; }
  if (payload) {
    try { manifestMod.validateManifestPayload(payload, now); payloadOk = true; }
    catch (e) { payloadCode = e.code || 'ERROR'; payloadMessage = e.message; }
  }

  const identity = identityCheck(requiredIdentity(manifestFile), payload);
  const identityOk = identity.known ? identity.ok : payloadOk;

  // 3) 序号门：客户端的 publicationDecision(manifest, installed, highWater)
  const installed = resolveInstalled(manifestMod, args);
  const gate = {
    installedSequence: args.installedSequence,
    installedCatalogSha256: installed.sha,
    installedShaSource: installed.source,
    manifestSequence: payload && Number.isSafeInteger(payload.sequence) ? payload.sequence : null,
    manifestCatalogSha256: payload && typeof payload.fullTargetCatalogSha256 === 'string' ? payload.fullTargetCatalogSha256 : null,
    highWaterSequence: args.highWater,
    verdict: null,
    accepted: false,
    code: null,
    message: null
  };
  if (payloadOk) {
    const installedReceipt = { sequence: args.installedSequence, fullTargetCatalogSha256: installed.sha };
    let mine = null;
    try { mine = { ok: true, verdict: manifestMod.publicationDecision(payload, installedReceipt, args.highWater) }; }
    catch (e) { mine = { ok: false, code: e.code || 'ERROR', message: e.message }; }
    // 客户端真正走的是 native-publication-update.cjs 里的同一个函数，交叉核对一次：
    let wire = null;
    try { wire = { ok: true, verdict: pubMod.publicationDecision(payload, installedReceipt, args.highWater) }; }
    catch (e) { wire = { ok: false, code: e.code || 'ERROR', message: e.message }; }
    if (JSON.stringify(mine) !== JSON.stringify(wire)) {
      throw new ToolError('ASAR_DECISION_INCONSISTENT', `两个客户端模块对同一输入判定不一致：${JSON.stringify(mine)} vs ${JSON.stringify(wire)}`, 'app.asar 内部实现不一致，先修 asar 再谈接受与否。');
    }
    gate.accepted = mine.ok;
    gate.verdict = mine.ok ? mine.verdict : null;
    gate.code = mine.ok ? null : mine.code;
    gate.message = mine.ok ? null : mine.message;
  }

  // 4) 整包摘要门（客户端下载时会按 archive.size/sha256 逐块校验，发布前必须同源）
  const archive = payload && payload.archive && Number.isSafeInteger(payload.archive.size) && SHA.test(payload.archive.sha256 || '')
    ? await checkArchive(args.archive, payload.archive)
    : { provided: !!args.archive, matches: false, unknown: true };

  // 5) 结论：按客户端门的顺序给第一个阻塞原因
  let decision = 'ACCEPT';
  let reasonCode = null;
  let reasonMessage = null;
  let nextAction = null;

  if (!signatureOk) {
    decision = 'REJECT'; reasonCode = sigCode; reasonMessage = sigMessage; nextAction = NEXT[sigCode] || NEXT.BAD_NATIVE_SIGNATURE;
  } else if (!payloadOk) {
    decision = 'REJECT';
    if (!identityOk) {
      reasonCode = 'BAD_NATIVE_IDENTITY';
      reasonMessage = `${payloadMessage || '身份不符'}｜${describeIdentity(identity, payload)}`;
      nextAction = NEXT.BAD_NATIVE_IDENTITY;
    } else {
      reasonCode = payloadCode; reasonMessage = payloadMessage; nextAction = NEXT[payloadCode] || NEXT.BAD_NATIVE_MANIFEST;
    }
  } else if (!gate.accepted) {
    decision = 'REJECT'; reasonCode = gate.code; reasonMessage = gate.message; nextAction = NEXT[gate.code] || NEXT.BAD_NATIVE_MANIFEST;
  } else if (!archive.provided) {
    decision = 'REJECT'; reasonCode = 'ARCHIVE_NOT_PROVIDED'; reasonMessage = '未提供 --archive，整包摘要未核对'; nextAction = NEXT.ARCHIVE_NOT_PROVIDED;
  } else if (archive.missing) {
    decision = 'REJECT'; reasonCode = 'ARCHIVE_MISMATCH'; reasonMessage = `--archive 指向的文件不存在：${args.archive}`; nextAction = NEXT.ARCHIVE_MISMATCH;
  } else if (!archive.matches) {
    decision = 'REJECT'; reasonCode = 'ARCHIVE_MISMATCH';
    reasonMessage = `manifest 声明 ${payload.archive.size} 字节 / ${payload.archive.sha256}，磁盘文件是 ${archive.size} 字节 / ${archive.sha256 || '(大小不符，未计算摘要)'}`;
    nextAction = NEXT.ARCHIVE_MISMATCH;
  } else if (gate.verdict === 'latest') {
    reasonCode = 'LATEST_ALREADY_INSTALLED';
    reasonMessage = `sequence=${payload.sequence} 与已装 ${args.installedSequence} 相同且完整目录摘要一致，客户端会回答 latest（不下发更新）`;
    nextAction = NEXT.LATEST_ALREADY_INSTALLED;
  } else {
    reasonCode = 'AVAILABLE';
    reasonMessage = `sequence=${payload.sequence} > 已装 ${args.installedSequence}，且 fullTargetCatalogSha256 已更换：客户端会判 available 并开始下载`;
    nextAction = NEXT.AVAILABLE;
  }
  if (!reasonCode && decision === 'ACCEPT') reasonCode = 'AVAILABLE';

  const report = {
    manifestOk: payloadOk,
    signatureOk,
    identityOk,
    sequenceGate: gate,
    archiveMatches: !!archive.matches,
    decision,
    reason: `${reasonCode}: ${reasonMessage}`,
    nextAction
  };
  return { report, exitCode: decision === 'ACCEPT' ? 0 : 2 };
}

function errorReport(e) {
  const code = e.code || 'TOOL_ERROR';
  return {
    report: {
      manifestOk: false,
      signatureOk: false,
      identityOk: false,
      sequenceGate: null,
      archiveMatches: false,
      decision: 'ERROR',
      reason: `${code}: ${e.message}`,
      nextAction: e.nextAction || '修正上面的工具错误后重跑。'
    },
    exitCode: 1
  };
}

function printUsage() {
  console.log([
    'accept-harness.cjs — 离线判断现网 1.7.0 员工机会不会接受这份原生更新',
    '',
    'node accept-harness.cjs --manifest <native-manifest.json> [选项]',
    '',
    '  --manifest <path>               要发布的 native-manifest.json（外层 {manifest,signature}），必填',
    '  --archive <path>                native-package.zip，用来核对 manifest.archive.size/sha256',
    '  --installed-sequence <n>        目标机器已装序号，默认 20',
    '  --installed-catalog-sha <sha>   已装收据的完整目录摘要；不给则用现网发布清单推断（仅当序号相同）',
    '  --app-asar <path>               现网 app.asar，默认 F:\\自制软件\\xjy-jewelry-offline\\resources\\app.asar',
    '  --public-key-pem <path>         发行公钥，默认 …\\candidate\\proposal\\worker-draft\\publisher-public.pem',
    '  --high-water-sequence <n>       客户端本机记录的最高已见序号，默认 0',
    '  --now <iso|ms>                  用指定时间代替当前时间（测过期用）',
    '  --live-manifest <path>          现网发布清单（只读），用于推断已装摘要',
    '  --asar-cache-dir <dir>          asar 解包缓存目录，默认 %TEMP%\\xjy-s6-accept-asar',
    '',
    '退出码：0=接受，2=被拒，1=工具错误。'
  ].join('\n'));
}

// ---------------------------------------------------------------- main

(async () => {
  let parsed;
  try { parsed = parseArgs(process.argv.slice(2)); }
  catch (e) { const r = errorReport(e); console.log(JSON.stringify(r.report, null, 2)); process.exitCode = r.exitCode; return; }
  if (parsed.help) { printUsage(); process.exitCode = 0; return; }
  try {
    const { report, exitCode } = await run(parsed);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = exitCode;
  } catch (e) {
    const r = errorReport(e);
    console.log(JSON.stringify(r.report, null, 2));
    process.exitCode = r.exitCode;
  }
})();

'use strict';
/**
 * publish-seq21.cjs — 可复用的「发布 sequence N」脚本（纯 node，无依赖）。
 *
 * 产出（写到 --out，默认 D:\Codex\xjy-release-20261022\publish-seq21\out）：
 *   catalog.json               已签员工补丁更新目录 {catalog:<string>, signature:<base64>}
 *   native-manifest-SOURCE.txt 说明：native manifest 由 audit-release 产出后拷贝（本脚本不拼结构）
 *   package.zip                --patch 的副本（员工补丁，catalog.archive 指向它）
 *   native-package.zip         --archive 的副本（完整原生包，供 audit-release/native 清单引用）
 *   SHA256SUMS.txt             上述文件摘要
 *
 * 安全：只读生产目录，绝不写入 F:\鑫金源珠宝资料 下任何路径（有硬断言）。
 *
 * 用法：
 *   node publish-seq21.cjs \
 *     --archive <native-package.zip> --patch <员工补丁.zip> --out <输出目录> \
 *     --sequence 21 --target-version 1.7.0 --engine-version 44.9.0
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

// ---------------------------------------------------------------- 常量 / 契约
const DEFAULTS = {
  archive: 'D:\\Codex\\xjy-release-20261022\\candidate\\build\\native-package.zip',
  patch: 'D:\\Codex\\xjy-release-20261022\\candidate\\build\\package\\鑫金源珠宝1.7.0员工升级补丁.zip',
  out: 'D:\\Codex\\xjy-release-20261022\\publish-seq21\\out',
  sequence: 21,
  targetVersion: '1.7.0',
  engineVersion: '44.9.0'
};
const SIGNING_KEY = 'E:\\codex\\2026-10-13\\work\\xjy-web-stage1\\config\\release-signing\\issuer-private.pem';
const PUBLISHER_PUBLIC_PEM = 'D:\\Codex\\xjy-release-20261022\\candidate\\proposal\\worker-draft\\publisher-public.pem';
// 现网 1.7.0 客户端 generated/release-pins.cjs 里 pin 的发布公钥 SPKI-DER sha256
const CLIENT_PINNED_PUBLISHER_SHA256 = '6e8b9cadb59aeb53f30d41f4471f70f644f0dfc7376ffb9d8a4c62defb98458c';
const PRODUCTION_DIR = 'F:\\鑫金源珠宝资料';
// 客户端 employee-update-cache.cjs:62 / employee-update.cjs:67 要求 catalog 键集“恰好”是这 12 个
const CATALOG_KEYS = ['schemaVersion', 'app', 'channel', 'version', 'sourceVersions', 'platform', 'arch', 'sequence', 'publishedAt', 'expiresAt', 'archive', 'files'];
const SOURCE_VERSIONS = ['1.6.0', '1.6.1', '1.6.2'];
const MAX_EXPANDED = 1073741824; // 客户端 verifySignedCatalog 上限 1 GiB

// ---------------------------------------------------------------- 小工具
const sha256Buf = b => crypto.createHash('sha256').update(b).digest('hex');
function sha256File(file) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(1 << 20);
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
  } finally { fs.closeSync(fd); }
  return h.digest('hex');
}
function die(code, message) { throw Object.assign(new Error(message), { code }); }

// 硬断言：绝不写生产目录
function assertNotProduction(dir) {
  const resolved = path.resolve(dir);
  const prod = path.resolve(PRODUCTION_DIR);
  const lower = resolved.toLowerCase(), prodLower = prod.toLowerCase();
  if (lower === prodLower || lower.startsWith(prodLower + path.sep)) {
    die('REFUSE_PRODUCTION_WRITE', `拒绝写入生产目录：${resolved}`);
  }
}

// ---------------------------------------------------------------- 极简 zip 读取
function readZipEntries(zipPath) {
  const buf = fs.readFileSync(zipPath);
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) die('BAD_ZIP', '找不到 zip end-of-central-directory');
  let count = buf.readUInt16LE(eocd + 10);
  let cdOffset = buf.readUInt32LE(eocd + 16);
  let cdSize = buf.readUInt32LE(eocd + 12);

  // ZIP64：EOCD 记为 0xFFFF/0xFFFFFFFF 时改读 ZIP64 EOCD locator
  if (count === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) {
    const loc = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x06, 0x07])); // ZIP64 EOCD locator
    if (loc < 0) die('BAD_ZIP', 'ZIP64 locator 缺失');
    const z64 = Number(buf.readBigUInt64LE(loc + 8));
    if (buf.readUInt32LE(z64) !== 0x06064b50) die('BAD_ZIP', 'ZIP64 EOCD 记录无效');
    count = Number(buf.readBigUInt64LE(z64 + 32));
    cdSize = Number(buf.readBigUInt64LE(z64 + 40));
    cdOffset = Number(buf.readBigUInt64LE(z64 + 48));
  }

  const files = [];
  let off = cdOffset;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) die('BAD_ZIP', '中央目录头无效 @' + off);
    const method = buf.readUInt16LE(off + 10);
    const crc = buf.readUInt32LE(off + 16);
    let csize = buf.readUInt32LE(off + 20);
    let usize = buf.readUInt32LE(off + 24);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    let localOff = buf.readUInt32LE(off + 42);
    const name = buf.slice(off + 46, off + 46 + nameLen).toString('utf8');
    const extra = buf.slice(off + 46 + nameLen, off + 46 + nameLen + extraLen);

    // ZIP64 扩展字段（0x0001）：按需按序补齐 usize / csize / localOff
    if (usize === 0xffffffff || csize === 0xffffffff || localOff === 0xffffffff) {
      let p = 0;
      while (p + 4 <= extra.length) {
        const id = extra.readUInt16LE(p), len = extra.readUInt16LE(p + 2);
        if (id === 0x0001) {
          let q = p + 4;
          if (usize === 0xffffffff) { usize = Number(extra.readBigUInt64LE(q)); q += 8; }
          if (csize === 0xffffffff) { csize = Number(extra.readBigUInt64LE(q)); q += 8; }
          if (localOff === 0xffffffff) { localOff = Number(extra.readBigUInt64LE(q)); }
          break;
        }
        p += 4 + len;
      }
    }
    off += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue; // 目录项

    if (buf.readUInt32LE(localOff) !== 0x04034b50) die('BAD_ZIP', '本地文件头无效 @' + localOff);
    const lnameLen = buf.readUInt16LE(localOff + 26);
    const lextraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lnameLen + lextraLen;
    const raw = buf.subarray(start, start + csize);

    let data;
    if (method === 0) data = raw;
    else if (method === 8) data = zlib.inflateRawSync(raw);
    else die('BAD_ZIP', `不支持的压缩方式 ${method}（${name}）`);
    if (data.length !== usize) die('BAD_ZIP', `解开后大小不符：${name}`);
    // CRC 校验（Node 自带 crc32 时才做；否则跳过，避免依赖）
    if (typeof zlib.crc32 === 'function' && (zlib.crc32(data) >>> 0) !== (crc >>> 0)) {
      die('BAD_ZIP', `CRC 不符：${name}`);
    }
    files.push({ path: name, size: data.length, sha256: sha256Buf(data) });
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { buf, files, count };
}

// ---------------------------------------------------------------- 参数
function parseArgs(argv) {
  const out = { ...DEFAULTS };
  const map = {
    '--archive': 'archive', '--patch': 'patch', '--out': 'out',
    '--sequence': 'sequence', '--target-version': 'targetVersion', '--engine-version': 'engineVersion'
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { out.help = true; continue; }
    const key = map[a];
    if (!key) die('BAD_ARGS', `未知参数 ${a}`);
    const v = argv[++i];
    if (v === undefined) die('BAD_ARGS', `${a} 缺少取值`);
    out[key] = key === 'sequence' ? Number(v) : v;
  }
  if (!Number.isSafeInteger(out.sequence) || out.sequence < 1) die('BAD_ARGS', '--sequence 必须是 >=1 的整数');
  if (!/^1\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(out.targetVersion)) die('BAD_ARGS', '--target-version 需形如 1.7.0');
  if (!/^\d+\.\d+\.\d+$/.test(out.engineVersion)) die('BAD_ARGS', '--engine-version 需形如 44.9.0');
  return out;
}

const USAGE = `用法：node publish-seq21.cjs [选项]
  --archive <native-package.zip>   完整原生包（默认 ${DEFAULTS.archive}）
  --patch   <员工补丁.zip>          员工补丁包，catalog.archive 指向它（默认 ${DEFAULTS.patch}）
  --out     <输出目录>              默认 ${DEFAULTS.out}
  --sequence <N>                    发布序号，默认 ${DEFAULTS.sequence}
  --target-version <v>              目标版本，默认 ${DEFAULTS.targetVersion}
  --engine-version <v>              引擎版本（写入 SOURCE 说明/校验），默认 ${DEFAULTS.engineVersion}
`;

// ---------------------------------------------------------------- 主流程
function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { process.stdout.write(USAGE); return; }
  const out = path.resolve(args.out);
  assertNotProduction(out); // 硬断言：不写生产目录

  const checks = [];
  const add = (name, ok, detail) => { checks.push({ name, ok: !!ok, detail }); if (!ok) die('SELF_CHECK_FAILED', `自校验失败：${name} → ${detail}`); };

  for (const [label, p] of [['archive', args.archive], ['patch', args.patch]]) {
    if (!fs.existsSync(p)) die('MISSING_INPUT', `${label} 不存在：${p}`);
    if (!fs.statSync(p).isFile()) die('MISSING_INPUT', `${label} 不是文件：${p}`);
  }

  fs.mkdirSync(out, { recursive: true });

  // ---- 1. 解析员工补丁 zip，生成 files[] ----
  const { buf: patchBuf, files } = readZipEntries(args.patch);
  const patchSize = fs.statSync(args.patch).size;
  if (patchBufferMismatch(patchBuf, patchSize)) die('BAD_ZIP', '补丁包读取大小与 stat 不一致');
  const patchSha = sha256Buf(patchBuf);
  const expandedTotal = files.reduce((a, f) => a + f.size, 0);
  if (!files.length) die('BAD_ZIP', '补丁包内没有文件');
  if (files.length > 4096) die('BAD_CATALOG', `文件数 ${files.length} 超过客户端上限 4096`);
  if (expandedTotal > MAX_EXPANDED) die('BAD_CATALOG', `展开总大小 ${expandedTotal} 超过 1 GiB 上限`);

  // ---- 2. 组 catalog（键顺序/键集严格对齐客户端契约）----
  const now = Date.now();
  const draft = {
    schemaVersion: 1,
    app: 'xjy-jewelry-offline',
    channel: 'stable',
    version: args.targetVersion,
    sourceVersions: SOURCE_VERSIONS.slice(),
    platform: 'win32',
    arch: 'x64',
    sequence: args.sequence,
    publishedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 90 * 86400000).toISOString(),
    archive: { size: patchSize, sha256: patchSha },
    files
  };
  const catalog = {};
  for (const k of CATALOG_KEYS) catalog[k] = draft[k];
  const catalogKeys = Object.keys(catalog);
  add('catalog 键集恰好为客户端要求的 12 键',
    catalogKeys.length === CATALOG_KEYS.length && CATALOG_KEYS.every((k, i) => catalogKeys[i] === k),
    catalogKeys.join(','));
  add('sequence / version / sourceVersions 正确',
    catalog.sequence === args.sequence && catalog.version === args.targetVersion &&
    JSON.stringify(catalog.sourceVersions) === JSON.stringify(SOURCE_VERSIONS),
    `sequence=${catalog.sequence} version=${catalog.version} sourceVersions=${JSON.stringify(catalog.sourceVersions)}`);
  add('archive 指向补丁包真实 size+sha256',
    catalog.archive.size === patchSize && catalog.archive.sha256 === patchSha,
    `${catalog.archive.size} ${catalog.archive.sha256}`);

  // ---- 3. 签名（Ed25519，null 算法 = 对原始字节签名）----
  const payload = Buffer.from(JSON.stringify(catalog), 'utf8');
  const keyBytes = fs.readFileSync(SIGNING_KEY);
  let priv;
  try { priv = crypto.createPrivateKey(keyBytes); } finally { keyBytes.fill(0); }
  if (priv.asymmetricKeyType !== 'ed25519') die('BAD_KEY', '签名私钥不是 Ed25519');
  const signature = crypto.sign(null, payload, priv);
  const envelope = { catalog: payload.toString('utf8'), signature: signature.toString('base64') };

  // ---- 4. 自校验：用 publisher 公钥验签 ----
  const pub = crypto.createPublicKey(fs.readFileSync(PUBLISHER_PUBLIC_PEM));
  const verified = crypto.verify(null, Buffer.from(envelope.catalog), pub, Buffer.from(envelope.signature, 'base64'));
  add('catalog 用 publisher-public.pem 验签通过', verified, `verified=${verified}`);
  const sigDerSha = crypto.createHash('sha256').update(pub.export({ format: 'der', type: 'spki' })).digest('hex');
  add('发布公钥 DER sha256 == 现网客户端 pin', sigDerSha === CLIENT_PINNED_PUBLISHER_SHA256, sigDerSha);
  add('签名 base64 形如客户端要求（86+==, 64 字节）',
    /^[A-Za-z0-9+/]{86}==$/.test(envelope.signature) && Buffer.from(envelope.signature, 'base64').length === 64,
    `len=${envelope.signature.length}`);
  add('envelope 只有 catalog/signature 两键且 catalog 是字符串',
    Object.keys(envelope).length === 2 && typeof envelope.catalog === 'string' && typeof envelope.signature === 'string',
    Object.keys(envelope).join(','));

  // ---- 5. 写 catalog.json ----
  fs.writeFileSync(path.join(out, 'catalog.json'), JSON.stringify(envelope));
  const written = JSON.parse(fs.readFileSync(path.join(out, 'catalog.json'), 'utf8'));
  add('落盘后重新解析 + 验签一致',
    crypto.verify(null, Buffer.from(written.catalog), pub, Buffer.from(written.signature, 'base64')) &&
    JSON.stringify(JSON.parse(written.catalog)) === JSON.stringify(catalog),
    'reparse ok');

  // ---- 6. native manifest 只写 SOURCE 说明（结构由 audit-release 产出）----
  const sourceTxt = [
    '# native-manifest-SOURCE.txt',
    '',
    '本文件不是 native manifest，也不应被拷成 native-manifest.json。',
    'native manifest 的结构必须由 audit-release 审计器产出（它绑定真实构建产物与 binding 摘要），',
    '发布时把审计器产出的文件**原样拷贝**为 native-manifest.json。本脚本刻意不拼它的结构。',
    '',
    `## 本次发布期望参数（publish-seq21.cjs --sequence ${args.sequence}）`,
    `- sequence:            ${args.sequence}   ← 必须 > 现网已装 sequence(20)，否则 STALE_NATIVE_MANIFEST`,
    `- targetVersion:       ${args.targetVersion}（客户端硬校验必须等于 1.7.0，否则 BAD_NATIVE_MANIFEST）`,
    `- engineVersion:       ${args.engineVersion}（客户端硬校验必须等于 44.9.0）`,
    '- purpose:             xjy-native-employee-update-v1',
    '- app / platform / arch / role: xjy-jewelry-offline / win32 / x64 / employee',
    '- schemaVersion:       1',
    '',
    '## 来自本脚本产出的输入（audit-release 应引用这些值）',
    `- 完整原生包 archive.size:   ${fs.statSync(args.archive).size}`,
    `- 完整原生包 archive.sha256: ${sha256File(args.archive)}`,
    `- 员工补丁 catalog.archive.size:   ${catalog.archive.size}`,
    `- 员工补丁 catalog.archive.sha256: ${catalog.archive.sha256}`,
    `- catalog 文件: ${path.join(out, 'catalog.json')}`,
    '',
    '## 换 sequence 21 前必须确认的两件事（现网实测契约，见 accept-check.cjs）',
    '1. publicationDecision 在 manifest.fullTargetCatalogSha256 === 已装值 时，要求 sequence 也相等；',
    '   若沿用旧的 fullTargetCatalogSha256（现网 4d78cbba…）却把 sequence 抬到 21，会抛 BAD_NATIVE_MANIFEST',
    '   （"目标目录与发布序号矛盾"）。所以 sequence 21 必须配**新的** fullTargetCatalogSha256。',
    '2. native-publication-update.cjs 还要求 targetEnvelope.catalog.sequence === manifest.sequence，',
    '   即原生清单序号、目标完整目录序号、发布序号三者一致。',
    '',
    '## 签名包装（客户端 native-update-manifest.cjs 要求）',
    '- 外层恰好 { manifest: <JSON 字符串>, signature: <base64, 86+== 结尾, 64 字节> }',
    '- 对 manifest 的**原始 UTF-8 字节**做 Ed25519 签名（crypto.sign(null, ...)）',
    `- 发布公钥 SPKI-DER sha256 必须是 ${CLIENT_PINNED_PUBLISHER_SHA256}`,
    ''
  ].join('\n');
  fs.writeFileSync(path.join(out, 'native-manifest-SOURCE.txt'), sourceTxt);

  // ---- 7. 复制两个 zip + SHA256SUMS.txt ----
  const patchCopy = path.join(out, 'package.zip');
  const archiveCopy = path.join(out, 'native-package.zip');
  fs.copyFileSync(args.patch, patchCopy);
  fs.copyFileSync(args.archive, archiveCopy);

  const copiedPatchSha = sha256File(patchCopy);
  const copiedArchiveSha = sha256File(archiveCopy);
  add('复制后的 package.zip 摘要 == catalog.archive.sha256',
    copiedPatchSha === catalog.archive.sha256 && fs.statSync(patchCopy).size === catalog.archive.size,
    copiedPatchSha);
  add('复制后的 native-package.zip 摘要 == 源 archive 摘要',
    copiedArchiveSha === sha256File(args.archive),
    copiedArchiveSha);

  const sums = [
    `${sha256File(path.join(out, 'catalog.json'))}  catalog.json`,
    `${catalog.archive.sha256}  package.zip`,
    `${sha256File(path.join(out, 'native-manifest-SOURCE.txt'))}  native-manifest-SOURCE.txt`,
    `${copiedArchiveSha}  native-package.zip`,
    ''
  ].join('\n');
  fs.writeFileSync(path.join(out, 'SHA256SUMS.txt'), sums);

  // ---- 8. 汇总 ----
  const report = {
    ok: true,
    out,
    sequence: catalog.sequence,
    version: catalog.version,
    sourceVersions: catalog.sourceVersions,
    publishedAt: catalog.publishedAt,
    expiresAt: catalog.expiresAt,
    archive: catalog.archive,
    fileCount: catalog.files.length,
    expandedBytes: expandedTotal,
    signatureVerified: verified,
    publisherKeyDerSha256: sigDerSha,
    publisherMatchesClientPin: sigDerSha === CLIENT_PINNED_PUBLISHER_SHA256,
    nativeArchive: { path: args.archive, size: fs.statSync(args.archive).size, sha256: copiedArchiveSha },
    outputs: fs.readdirSync(out).sort(),
    checks
  };
  console.log(JSON.stringify(report, null, 2));
}

function patchBufferMismatch(buf, size) { return buf.length !== size; }

try { main(); } catch (e) {
  console.error(JSON.stringify({ ok: false, code: e.code || 'ERROR', message: e.message }, null, 2));
  process.exitCode = 1;
}

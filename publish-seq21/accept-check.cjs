'use strict';
/**
 * accept-check.cjs — 离线验证「现网 1.7.0 客户端/发布端会不会接受这份 sequence 21 发布」。
 *
 * 不重写校验逻辑：直接从现网 app.asar 解出**真实客户端模块** require：
 *   - employee-update-cache.cjs  → createTrustedUpdatePolicy / verifySignedCatalog（客户端收 catalog）
 *   - update-distribution.cjs     → createUpdateDistribution（发布点服务端校验，L43 同一套 allowed 规则）
 *   - native-update-manifest.cjs  → verifyNativeManifest / publicationDecision（原生包序号门）
 *   - generated/release-pins.cjs  → 现网 pin 的公钥与 allowedFiles(1007)
 *
 * 只读：asar 只解到临时目录；生产目录只读。
 *
 * 用法：node accept-check.cjs [--catalog <catalog.json>] [--prod-catalog <path>]
 *        [--archive <package.zip>] [--asar <app.asar>] [--installed-sequence 20] [--current-version 1.6.2]
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const DEFAULTS = {
  asar: 'F:\\自制软件\\xjy-jewelry-offline\\resources\\app.asar',
  catalog: 'D:\\Codex\\xjy-release-20261022\\publish-seq21\\out\\catalog.json',
  prodCatalog: 'F:\\鑫金源珠宝资料\\程序设置\\员工升级\\catalog.json',
  archive: 'D:\\Codex\\xjy-release-20261022\\publish-seq21\\out\\package.zip',
  installedSequence: 20,
  currentVersion: '1.6.2'
};
const PROD_NATIVE_MANIFEST = 'F:\\鑫金源珠宝资料\\程序设置\\员工升级\\native-manifest.json';
const NPX_CLI = 'E:\\node\\node_modules\\npm\\bin\\npx-cli.js';

function parseArgs(argv) {
  const out = { ...DEFAULTS };
  const map = {
    '--catalog': 'catalog', '--prod-catalog': 'prodCatalog', '--archive': 'archive',
    '--asar': 'asar', '--installed-sequence': 'installedSequence',
    '--current-version': 'currentVersion', '--asar-extract-dir': 'extractDir'
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { out.help = true; continue; }
    const key = map[a];
    if (!key) throw Object.assign(new Error(`未知参数 ${a}`), { code: 'BAD_ARGS' });
    const v = argv[++i];
    if (v === undefined) throw Object.assign(new Error(`${a} 缺少取值`), { code: 'BAD_ARGS' });
    out[key] = key === 'installedSequence' ? Number(v) : v;
  }
  return out;
}

function ensureExtracted(asarPath, extractDir) {
  const appDir = path.join(extractDir, 'app');
  const probe = path.join(appDir, 'native-update-manifest.cjs');
  if (fs.existsSync(probe) && fs.existsSync(path.join(appDir, 'employee-update-cache.cjs'))) {
    return { appDir, reused: true };
  }
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });
  const asarArgs = ['--yes', '@electron/asar', 'extract', asarPath, appDir];
  if (fs.existsSync(NPX_CLI)) {
    execFileSync(process.execPath, [NPX_CLI, ...asarArgs], {
      stdio: 'pipe', cwd: extractDir, timeout: 300000, windowsHide: true
    });
  } else {
    execFileSync('E:\\node\\npx.cmd', asarArgs, {
      stdio: 'pipe', cwd: extractDir, timeout: 300000, windowsHide: true, shell: true
    });
  }
  if (!fs.existsSync(probe)) throw Object.assign(new Error('asar 解包后缺少 native-update-manifest.cjs'), { code: 'ASAR_BAD' });
  return { appDir, reused: false };
}

const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const readEnvelope = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const parseCatalog = env => JSON.parse(env.catalog);

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log('见文件头注释'); return; }

  const { appDir, reused } = ensureExtracted(args.asar, args.extractDir || path.join(os.tmpdir(), 'xjy-seq21-accept-asar'));
  const cacheMod = require(path.join(appDir, 'employee-update-cache.cjs'));
  const manifestMod = require(path.join(appDir, 'native-update-manifest.cjs'));
  const pins = require(path.join(appDir, 'generated', 'release-pins.cjs'));

  const rows = [];
  const add = (id, expected, actual, detail) => rows.push({ id, expected, actual, verdict: expected === actual ? 'MATCH' : 'DIFF', detail });

  const env = readEnvelope(args.catalog);
  const cat = parseCatalog(env);
  const prodEnv = fs.existsSync(args.prodCatalog) ? readEnvelope(args.prodCatalog) : null;
  const prodCat = prodEnv ? parseCatalog(prodEnv) : null;

  const mkPolicy = allowedFiles => cacheMod.createTrustedUpdatePolicy({
    allowedFiles, trustedPublicKey: pins.publisherPublicKey,
    currentVersion: args.currentVersion, platform: 'win32', arch: 'x64'
  });
  const verify = (envelope, allowedFiles) => {
    try { return { ok: true, value: cacheMod.verifySignedCatalog(envelope, mkPolicy(allowedFiles)) }; }
    catch (e) { return { ok: false, code: e.code || 'ERROR', message: e.message }; }
  };

  // ---------- 1. 严格模式：直接用现网 pin 的 1007 条 allowedFiles ----------
  const strictMine = verify(env, pins.allowedFiles);
  const strictProd = prodEnv ? verify(prodEnv, pins.allowedFiles) : null;

  // ---------- 2. 形状假设：给 allowlist 补 payload/ 前缀，并补齐 13 个辅助文件 ----------
  // catalog 实际布局：payload/<1007 条 resources/*> + 13 个交付/取证文件
  const auxPaths = cat.files.map(f => f.path).filter(p => !p.startsWith('payload/'));
  const prefixed = [
    ...pins.allowedFiles.map(p => 'payload/' + p),
    ...auxPaths
  ];
  const shapeMine = verify(env, prefixed);
  const shapeProd = prodEnv ? verify(prodEnv, prefixed) : null;

  // ---------- 3. 差分：我的 catalog 与生产 catalog 的文件表是否逐条一致 ----------
  let diff = null;
  if (prodCat) {
    const same = prodCat.files.length === cat.files.length &&
      prodCat.files.every((f, i) => {
        const g = cat.files[i];
        return g && g.path === f.path && g.size === f.size && g.sha256 === f.sha256;
      });
    const sum = cat.files.reduce((a, f) => a + f.size, 0);
    const prodSum = prodCat.files.reduce((a, f) => a + f.size, 0);
    diff = {
      filesIdentical: same,
      count: { mine: cat.files.length, prod: prodCat.files.length },
      expandedBytes: { mine: sum, prod: prodSum },
      onlyDiffFields: ['sequence', 'publishedAt', 'expiresAt'],
      sequence: { mine: cat.sequence, prod: prodCat.sequence },
      archiveIdentical: JSON.stringify(cat.archive) === JSON.stringify(prodCat.archive),
      archive: cat.archive
    };
  }

  // ---------- 4. archive 与磁盘文件一致 ----------
  let archiveCheck = { skipped: true };
  if (fs.existsSync(args.archive)) {
    const st = fs.statSync(args.archive);
    const h = crypto.createHash('sha256');
    const fd = fs.openSync(args.archive, 'r');
    const buf = Buffer.allocUnsafe(8 * 1024 * 1024);
    let read;
    try { while ((read = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, read)); }
    finally { fs.closeSync(fd); }
    const digest = h.digest('hex');
    archiveCheck = {
      path: args.archive, size: st.size, diskSha256: digest,
      catalogSha256: cat.archive.sha256, sizeMatches: st.size === cat.archive.size,
      shaMatches: digest === cat.archive.sha256, verdict: (st.size === cat.archive.size && digest === cat.archive.sha256) ? 'PASS' : 'FAIL'
    };
  }

  // ---------- 5. 原生包序号门（这是 sequence 21 的真正判据）----------
  const installed = { sequence: args.installedSequence, fullTargetCatalogSha256: 'x'.repeat(0) };
  const prodNativeEnv = readEnvelope(PROD_NATIVE_MANIFEST);
  const prodNative = manifestMod.verifyNativeManifest(prodNativeEnv, { publicKey: pins.publisherPublicKey });
  installed.fullTargetCatalogSha256 = prodNative.fullTargetCatalogSha256;

  const NEW_SHA = sha256(Buffer.from('published-full-target-catalog'));
  const decision = (seq, targetSha) => {
    try { return manifestMod.publicationDecision({ sequence: seq, fullTargetCatalogSha256: targetSha }, installed, args.installedSequence); }
    catch (e) { return e.code || 'ERROR'; }
  };
  const nativeCases = [
    ['sequence=21 + 新 fullTargetCatalogSha256（正确）', 21, NEW_SHA],
    ['sequence=21 + 沿用旧 fullTargetCatalogSha256（陷阱）', 21, prodNative.fullTargetCatalogSha256],
    ['sequence 未升，仍=20 + 新 sha', 20, NEW_SHA],
    ['sequence 回退到 19', 19, NEW_SHA]
  ].map(([label, seq, sha]) => ({ label, sequence: seq, decision: decision(seq, sha) }));

  let minimumSeq = null;
  try {
    manifestMod.verifyNativeManifest(prodNativeEnv, { publicKey: pins.publisherPublicKey, minimumSequence: 21 });
    minimumSeq = { accepted: true };
  } catch (e) {
    minimumSeq = { accepted: false, code: e.code, message: e.message };
  }

  const summary = {
    out_catalog: args.catalog,
    sequence: cat.sequence,
    version: cat.version,
    sourceVersions: cat.sourceVersions,
    publishedAt: cat.publishedAt,
    expiresAt: cat.expiresAt,
    fileCount: cat.files.length,
    allowlistSize: pins.allowedFiles.length,
    publisherKeyDerSha256: pins.publisherPublicKeySha256
  };

  const report = {
    asar: { path: args.asar, extractedTo: appDir, reused },
    summary,
    checks: {
      strictAllowlist: {
        mine: strictMine.ok ? 'PASS' : `${strictMine.code}: ${strictMine.message}`,
        prod: strictProd ? (strictProd.ok ? 'PASS' : `${strictProd.code}: ${strictProd.message}`) : 'n/a'
      },
      payloadPrefixedAllowlist: {
        mine: shapeMine.ok ? `PASS sequence=${shapeMine.value.sequence} files=${shapeMine.value.files.length}` : `${shapeMine.code}: ${shapeMine.message}`,
        prod: shapeProd ? (shapeProd.ok ? `PASS sequence=${shapeProd.value.sequence} files=${shapeProd.value.files.length}` : `${shapeProd.code}: ${shapeProd.message}`) : 'n/a'
      },
      differentialVsProduction: diff,
      archive: archiveCheck
    },
    nativeSequenceGate: {
      installedSequence: args.installedSequence,
      productionManifestSequence: prodNative.sequence,
      productionManifestVerify: 'PASS',
      productionFullTargetCatalogSha256: prodNative.fullTargetCatalogSha256,
      decisionCases: nativeCases,
      minimumSequence21OnCurrentManifest: minimumSeq
    }
  };
  console.log(JSON.stringify(report, null, 2));
}

try { main(); } catch (e) {
  console.error(JSON.stringify({ ok: false, code: e.code || 'ERROR', message: e.message, stack: String(e.stack || '').split('\n').slice(0, 4) }, null, 2));
  process.exitCode = 1;
}

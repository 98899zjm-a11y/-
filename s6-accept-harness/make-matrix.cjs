'use strict';
/**
 * make-matrix.cjs — 生成 matrix.md 的判定矩阵（开发/复核用，不参与发布）。
 *
 * 做两件事：
 *   1. 在 %TEMP%\\xjy-s6-accept-fixtures 下生成一批**合成夹具**（文件名一律 TEST- 前缀，不是发布件）：
 *      用发行私钥对构造好的 manifest 签名，从而让客户端的门（签名→payload→身份→序号→整包摘要）
 *      能逐格压出来，而不必动真实构建产物。
 *   2. 逐个调用 accept-harness.cjs，把每条**实际输出**写成表格，落到同目录的 matrix.md。
 *
 * 用法：node make-matrix.cjs [--sign-key <pem>] [--out <matrix.md>]
 * 注意：夹具里的 archive 只是 64 字节占位文件（大小/摘要与清单一致），用来单独验证「整包摘要门」，
 *       不能证明真实 780MB 包的内容正确——真实包用 README 里那条命令验。
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const HERE = __dirname;
const HARNESS = path.join(HERE, 'accept-harness.cjs');
const FIXTURES = path.join(os.tmpdir(), 'xjy-s6-accept-fixtures');
const DEFAULT_KEY = 'E:\\codex\\2026-10-13\\work\\xjy-web-stage1\\config\\release-signing\\issuer-private.pem';
const LIVE_MANIFEST = 'F:\\鑫金源珠宝资料\\程序设置\\员工升级\\native-manifest.json';
const PINNED_PUBLISHER = '6e8b9cadb59aeb53f30d41f4471f70f644f0dfc7376ffb9d8a4c62defb98458c';

const WORKER = '受信助手/鑫金源珠宝报价.exe';
const WORKER_SIZE = 246302720;
const WORKER_SHA = 'db3ad2066a55546f9b6737da3c7f011370e4856fb36888055b544d45653e4f40';
const BINDING = 'engine-native170-binding.json';
const FIXED = [
  '安装组件/native-delivery-170.ps1',
  '受信助手/delivery-tools/engine-native-entry170.cjs',
  'delivery-tools/XjyWorkerResult.ps1'
];

const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const fakeSha = label => sha256(Buffer.from(`TEST-fixture-${label}`));

function parseArgs(argv) {
  const out = { key: DEFAULT_KEY, out: path.join(HERE, 'matrix.md') };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--sign-key') out.key = argv[++i];
    else if (argv[i] === '--out') out.out = argv[++i];
  }
  return out;
}

function loadOldSha() {
  try {
    const env = JSON.parse(fs.readFileSync(LIVE_MANIFEST, 'utf8'));
    const m = JSON.parse(env.manifest);
    if (/^[a-f0-9]{64}$/.test(m.fullTargetCatalogSha256)) return { sha: m.fullTargetCatalogSha256, source: '现网发布清单 sequence=' + m.sequence };
  } catch { /* 现网不可读时退回常量 */ }
  return { sha: '4d78cbbac07b05f267fabb870a10376a2c1158a8b4623ba4ea35d3334cb828ef', source: '常量（现网清单不可读）' };
}

function makeArchive(dir) {
  const okBytes = Buffer.alloc(64, 0x41);
  const badBytes = Buffer.alloc(64, 0x42); // 同尺寸、不同内容：专门压「大小对但摘要不对」
  const ok = path.join(dir, 'TEST-archive-ok.bin');
  const bad = path.join(dir, 'TEST-archive-wrong.bin');
  fs.writeFileSync(ok, okBytes);
  fs.writeFileSync(bad, badBytes);
  return { ok, bad, okSha: sha256(okBytes), badSha: sha256(badBytes) };
}

function buildManifest(o) {
  const bindingSha = fakeSha('binding-' + o.label);
  const files = [
    { path: WORKER, size: WORKER_SIZE, sha256: WORKER_SHA },
    { path: BINDING, size: 4096, sha256: bindingSha },
    ...FIXED.map((p, i) => ({ path: p, size: 1024 + i, sha256: fakeSha('fixed-' + i) }))
  ];
  const identity = {
    schemaVersion: 1,
    purpose: 'xjy-native-employee-update-v1',
    app: 'xjy-jewelry-offline',
    platform: 'win32',
    arch: 'x64',
    role: 'employee'
  };
  return {
    ...identity,
    targetVersion: o.targetVersion,
    engineVersion: o.engineVersion || '44.9.0',
    sequence: o.sequence,
    publishedAt: '2026-10-22T09:00:00.000Z',
    expiresAt: '2027-01-20T09:00:00.000Z',
    fullTargetCatalogSha256: o.catalogSha,
    bindingSha256: bindingSha,
    archive: { size: 64, sha256: o.archiveSha },
    files
  };
}

function writeFixture(dir, priv, o) {
  const manifest = buildManifest(o);
  const text = JSON.stringify(manifest, null, 2);
  const signature = crypto.sign(null, Buffer.from(text), priv).toString('base64');
  const file = path.join(dir, `TEST-${o.label}.json`);
  fs.writeFileSync(file, JSON.stringify({ manifest: text, signature }, null, 2));
  return { file, manifest, signature };
}

let PUBLIC_PEM = null;

function runHarness(args) {
  const argv = PUBLIC_PEM ? ['--public-key-pem', PUBLIC_PEM, ...args] : args;
  const r = spawnSync(process.execPath, [HARNESS, ...argv], { encoding: 'utf8', timeout: 300000, windowsHide: true });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* 留给下面判定 */ }
  return { exit: r.status, stdout: r.stdout.trim(), json, stderr: (r.stderr || '').trim() };
}

function cell(v) {
  if (v === null || v === undefined) return 'null';
  return String(v).replace(/\|/g, '\\|');
}

function codeOf(reason) {
  const m = /^([A-Z_]+):/.exec(reason || '');
  return m ? m[1] : '—';
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(args.key)) throw Object.assign(new Error(`找不到签名私钥：${args.key}`), { code: 'NO_KEY' });
  const priv = crypto.createPrivateKey(fs.readFileSync(args.key));
  const pubDer = crypto.createHash('sha256').update(crypto.createPublicKey(priv).export({ format: 'der', type: 'spki' })).digest('hex');
  if (pubDer !== PINNED_PUBLISHER) throw Object.assign(new Error(`签名私钥对应的公钥不是现网 pin：${pubDer}`), { code: 'KEY_MISMATCH' });

  fs.mkdirSync(FIXTURES, { recursive: true });
  // 公钥从私钥现导（与 pin 一致，上面已校验）：提案目录会被反复重建，不能依赖它的落点。
  PUBLIC_PEM = path.join(FIXTURES, 'TEST-issuer-public.pem');
  fs.writeFileSync(PUBLIC_PEM, crypto.createPublicKey(priv).export({ type: 'spki', format: 'pem' }));
  const old = loadOldSha();
  const NEW_SHA = fakeSha('new-full-target-catalog');
  const arch = makeArchive(FIXTURES);

  const variants = [];
  for (const sequence of [19, 20, 21]) {
    for (const targetVersion of ['1.7.0', '1.7.1']) {
      variants.push({
        label: `seq${sequence}-${targetVersion}`, sequence, targetVersion,
        catalogSha: NEW_SHA, archiveSha: arch.okSha, kind: 'grid'
      });
    }
  }
  variants.push({
    label: 'seq21-1.7.0-oldsha', sequence: 21, targetVersion: '1.7.0',
    catalogSha: old.sha, archiveSha: arch.okSha, kind: 'trap'
  });
  const fixtures = {};
  for (const v of variants) fixtures[v.label] = writeFixture(FIXTURES, priv, v);

  const rows = [];
  const push = (spec) => {
    const f = fixtures[spec.fixture];
    const res = runHarness([
      '--manifest', f.file,
      '--archive', spec.archive,
      '--installed-sequence', String(spec.installed),
      '--installed-catalog-sha', spec.installedSha
    ]);
    rows.push({ spec, res });
  };
  for (const installed of [20, 21]) {
    const installedSha = installed === 20 ? old.sha : NEW_SHA;
    for (const sequence of [19, 20, 21]) {
      for (const targetVersion of ['1.7.0', '1.7.1']) {
        for (const a of ['ok', 'wrong']) {
          push({
            fixture: `seq${sequence}-${targetVersion}`, installed, installedSha, sequence, targetVersion,
            archive: a === 'ok' ? arch.ok : arch.bad, archiveLabel: a === 'ok' ? '匹配' : '同尺寸错摘要',
            kind: 'grid'
          });
        }
      }
    }
  }
  for (const installed of [20, 21]) {
    push({
      fixture: 'seq21-1.7.0-oldsha', installed, installedSha: installed === 20 ? old.sha : NEW_SHA,
      sequence: 21, targetVersion: '1.7.0', archive: arch.ok, archiveLabel: '匹配', kind: 'trap'
    });
  }

  // ---- 工具自身边界（签名被改、清单过期、没给包、参数错、公钥不是 pin）----
  const good = fixtures['seq21-1.7.0'];
  const tampered = path.join(FIXTURES, 'TEST-tampered-signature.json');
  {
    const env = JSON.parse(fs.readFileSync(good.file, 'utf8'));
    const sig = env.signature;
    env.signature = sig.slice(0, 10) + (sig[10] === 'A' ? 'B' : 'A') + sig.slice(11);
    fs.writeFileSync(tampered, JSON.stringify(env, null, 2));
  }
  const throwawayKey = path.join(FIXTURES, 'TEST-throwaway-public.pem');
  fs.writeFileSync(throwawayKey, crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }));

  const baseArgs = ['--manifest', good.file, '--archive', arch.ok, '--installed-sequence', '20', '--installed-catalog-sha', old.sha];
  const edges = [
    { label: '签名被改一个字符', args: ['--manifest', tampered, '--archive', arch.ok, '--installed-sequence', '20', '--installed-catalog-sha', old.sha], expect: 'BAD_NATIVE_SIGNATURE', exit: 2 },
    { label: '清单已过期（--now 2028）', args: [...baseArgs, '--now', '2028-06-01T00:00:00Z'], expect: 'EXPIRED_NATIVE_MANIFEST', exit: 2 },
    { label: '没给 --archive', args: ['--manifest', good.file, '--installed-sequence', '20', '--installed-catalog-sha', old.sha], expect: 'ARCHIVE_NOT_PROVIDED', exit: 2 },
    { label: '公钥不是客户端 pin 的那把', args: [...baseArgs, '--public-key-pem', throwawayKey], expect: 'BAD_PUBLIC_KEY', exit: 1 },
    { label: '缺 --manifest（工具错误）', args: [], expect: 'BAD_ARGS', exit: 1 }
  ].map(e => {
    const res = runHarness(e.args);
    return { ...e, res, got: res.json ? codeOf(res.json.reason) : null };
  });
  const edgeBad = edges.filter(e => !e.res.json || e.res.exit !== e.exit || e.got !== e.expect);

  // ---- 真实形态自检：拿现网 3293 文件表改序号/换目录摘要，配真实 781MB 包和真实 app.asar ----
  const LIVE_ZIP = 'F:\\鑫金源珠宝资料\\程序设置\\员工升级\\native-package.zip';
  const SIM_SHA = crypto.createHash('sha256').update('SIMULATED-seq21-full-target-catalog').digest('hex');
  const realRows = [];
  if (fs.existsSync(LIVE_MANIFEST) && fs.existsSync(LIVE_ZIP)) {
    const srcEnv = JSON.parse(fs.readFileSync(LIVE_MANIFEST, 'utf8'));
    const sim = JSON.parse(srcEnv.manifest);
    const prodSequence = sim.sequence;
    const prodCatalogSha = sim.fullTargetCatalogSha256;
    const simPath = path.join(FIXTURES, 'simulated-seq21-manifest.json');
    {
      const m = { ...sim, sequence: 21, fullTargetCatalogSha256: SIM_SHA };
      const text = JSON.stringify(m, null, 2);
      fs.writeFileSync(simPath, JSON.stringify({ manifest: text, signature: crypto.sign(null, Buffer.from(text), priv).toString('base64') }, null, 2));
    }
    const liveProd = (installed) => ({
      label: `现网清单 seq${prodSequence} + 真实包`, installed,
      args: ['--manifest', LIVE_MANIFEST, '--archive', LIVE_ZIP, '--installed-sequence', String(installed), '--installed-catalog-sha', prodCatalogSha],
      expectVerdict: 'latest'
    });
    const liveSim = {
      label: '模拟 seq21（真实 3293 文件表 + 新目录摘要）+ 真实包', installed: 20,
      args: ['--manifest', simPath, '--archive', LIVE_ZIP, '--installed-sequence', '20', '--installed-catalog-sha', prodCatalogSha],
      expectVerdict: 'available'
    };
    for (const c of [liveProd(prodSequence), liveSim]) {
      const res = runHarness(c.args);
      realRows.push({ ...c, res });
    }
  }
  const realBad = realRows.filter(r => !r.res.json || r.res.exit !== 0 || (r.res.json.sequenceGate && r.res.json.sequenceGate.verdict) !== r.expectVerdict || !r.res.json.archiveMatches);

  const bad = rows.filter(r => !r.res.json || (r.res.exit !== 0 && r.res.exit !== 2));
  if (bad.length || edgeBad.length || realBad.length) {
    console.error('矩阵不可信（出现非预期退出码/拒绝码）：');
    for (const b of bad) console.error(b.spec.fixture, b.res.exit, b.res.stdout.slice(0, 400), b.res.stderr.slice(0, 400));
    for (const e of edgeBad) console.error('EDGE', e.label, 'exit', e.res.exit, 'code', e.got, 'expect', e.exit, e.expect, e.res.stdout.slice(0, 300), e.res.stderr.slice(0, 300));
    for (const r of realBad) console.error('REAL', r.label, 'exit', r.res.exit, r.res.stdout.slice(0, 300), r.res.stderr.slice(0, 300));
    process.exitCode = 1;
    return;
  }

  const L = [];
  L.push('# 判定矩阵（真实输出）');
  L.push('');
  L.push('本表每一行都是 `node accept-harness.cjs …` 的**实际输出**，由 `node make-matrix.cjs` 自动生成。');
  L.push('判定权在现网 app.asar 里的 `native-update-manifest.cjs` / `native-publication-update.cjs`，本工具没有重写任何一条规则。');
  L.push('');
  L.push(`- 现网已装（sequence 20）完整目录摘要 \`${old.sha}\`（来源：${old.source}）`);
  L.push(`- 本次候选发布的完整目录摘要 \`${NEW_SHA}\`，即夹具里的「新 sha」`);
  L.push('- 「已装 21」一行组按定义把已装摘要设为新 sha（= 这台机器已经装过 seq21 那一版）');
  L.push('- 夹具清单 64 字节占位包：`TEST-archive-ok.bin`（摘要与清单一致）/ `TEST-archive-wrong.bin`（同尺寸、不同摘要）');
  L.push('');
  L.push('## 1. 四维网格（installed 20/21 × sequence 19/20/21 × targetVersion 1.7.0/1.7.1 × archive 匹配/不匹配）');
  L.push('');
  L.push('| # | 已装 seq | 清单 seq | targetVersion | archive | 退出码 | manifestOk | signatureOk | identityOk | 序号门 verdict | decision | reason 代码 |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
  rows.filter(r => r.spec.kind === 'grid').forEach((r, i) => {
    const j = r.res.json;
    L.push(`| ${i + 1} | ${r.spec.installed} | ${r.spec.sequence} | ${r.spec.targetVersion} | ${r.spec.archiveLabel} | ${r.res.exit} | ${cell(j.manifestOk)} | ${cell(j.signatureOk)} | ${cell(j.identityOk)} | ${cell(j.sequenceGate && j.sequenceGate.verdict)} | ${cell(j.decision)} | \`${codeOf(j.reason)}\` |`);
  });
  L.push('');
  L.push('## 2. 补充：换 sequence 却不换完整目录摘要（真实陷阱）');
  L.push('');
  L.push('| # | 已装 seq | 清单 seq | targetVersion | archive | 退出码 | 序号门 verdict | decision | reason 代码 |');
  L.push('|---|---|---|---|---|---|---|---|---|');
  rows.filter(r => r.spec.kind === 'trap').forEach((r, i) => {
    const j = r.res.json;
    L.push(`| T${i + 1} | ${r.spec.installed} | ${r.spec.sequence} | ${r.spec.targetVersion} + 旧 sha | ${r.spec.archiveLabel} | ${r.res.exit} | ${cell(j.sequenceGate && j.sequenceGate.verdict)} | ${cell(j.decision)} | \`${codeOf(j.reason)}\` |`);
  });
  L.push('');
  L.push('## 3. 工具自身边界（拒绝码能不能分清，以及工具错误长什么样）');
  L.push('');
  L.push('| 场景 | 退出码 | decision | 实际 reason 代码 | 期望 |');
  L.push('|---|---|---|---|---|');
  for (const e of edges) {
    const got = e.res.json ? codeOf(e.res.json.reason) : '（无 JSON）';
    const mark = (e.res.exit === e.exit && got === e.expect) ? '✅' : '❌';
    L.push(`| ${e.label} | ${e.res.exit} | ${cell(e.res.json && e.res.json.decision)} | \`${got}\` | ${mark} \`${e.expect}\` / exit ${e.exit} |`);
  }
  L.push('');
  L.push('退出码 1 = 工具自己没法判定（参数/公钥/asar 读不出来），**不是**「客户端会拒」；退出码 2 才是客户端真会拒。');
  L.push('');
  L.push('## 4. 真实形态自检（真清单 3293 个文件 + 真 781MB 包 + 真 app.asar）');
  L.push('');
  if (!realRows.length) {
    L.push('（本机没有现网发布清单或 `native-package.zip`，本节跳过。）');
  } else {
    L.push('| # | 清单 | 已装 seq | 退出码 | 序号门 verdict | archiveMatches | decision | reason 代码 |');
    L.push('|---|---|---|---|---|---|---|---|');
    realRows.forEach((r, i) => {
      const j = r.res.json;
      L.push(`| R${i + 1} | ${r.label} | ${r.installed} | ${r.res.exit} | ${cell(j.sequenceGate && j.sequenceGate.verdict)} | ${cell(j.archiveMatches)} | ${cell(j.decision)} | \`${codeOf(j.reason)}\` |`);
    });
    L.push('');
    L.push('R1 是**现在线上那份**：把生产清单拿去问生产已装状态，答案必然是 `latest`（同序号同目录摘要），');
    L.push('它的价值是证明「整条链在真 781MB 包上跑通、摘要逐位对上」，而不是证明有更新可下。');
    L.push('R2 是**发布形态**：现网 3293 个文件的清单、序号改 21、目录摘要换成新的、用发行私钥重签，');
    L.push('配真实 781MB 包 → `available`。它证明的是清单结构与各道门本身没问题；');
    L.push(`R2 里那个新目录摘要（\`${SIM_SHA}\`）是**模拟值**，真实发布必须由审计器算出真实的完整目标目录摘要。`);
  }
  L.push('');
  L.push('## 5. 读表要点');
  L.push('');
  const pick = (inst, seq, ver, archOk) => rows.find(r => r.spec.kind === 'grid' && r.spec.installed === inst && r.spec.sequence === seq && r.spec.targetVersion === ver && (r.spec.archiveLabel === (archOk ? '匹配' : '同尺寸错摘要')));
  const ok = pick(20, 21, '1.7.0', true);
  const stale = pick(20, 19, '1.7.0', true);
  const same = pick(20, 20, '1.7.0', true);
  const ident = pick(20, 21, '1.7.1', true);
  const lat21 = pick(21, 21, '1.7.0', true);
  L.push(`- **能真正下发（available）的路只有一条**：\`已装 20 + 清单 seq21 + 1.7.0 + 新目录摘要 + 整包匹配\` → \`${ok.res.json.decision}\` / \`${codeOf(ok.res.json.reason)}\`，退出码 ${ok.res.exit}。`);
  L.push(`- 序号不升（seq19）→ \`${codeOf(stale.res.json.reason)}\`，退出码 ${stale.res.exit}：客户端连下载都不会开始。`);
  L.push(`- 序号不升但换了目录摘要（seq20 + 新 sha）→ \`${codeOf(same.res.json.reason)}\`：同一序号不允许替换完整程序。`);
  L.push(`- targetVersion 写成 1.7.1 → \`${codeOf(ident.res.json.reason)}\`，**先于**序号门发生：现网客户端硬编码只认 1.7.0，改清单没用，必须换客户端。`);
  L.push(`- 已装 21 的机器再收到 seq21（同 sha）→ \`${codeOf(lat21.res.json.reason)}\`，退出码 ${lat21.res.exit}：**ACCEPT 但不下发**，客户端认为已经装过（工具用它表示"接受清单、无更新可做"）。`);
  L.push(`- archive 同尺寸但摘要不对 → \`${codeOf(pick(20, 21, '1.7.0', false).res.json.reason)}\`，退出码 ${pick(20, 21, '1.7.0', false).res.exit}：这类错误只有本工具（发布前）能拦，客户端要等整包下载完才发现。`);
  L.push('- 1.7.1 的行里 archive 维度不起作用，这是**真实优先级**：payload/身份门在整包摘要门之前。');
  L.push('');
  L.push('## 6. 代表性完整输出');
  L.push('');
  for (const [title, r] of [['可以下发（ACCEPT / AVAILABLE）', ok], ['序号太旧（REJECT / STALE）', stale], ['targetVersion 不是 1.7.0（REJECT / 身份）', ident], ['陷阱：seq21 沿用旧目录摘要（REJECT）', rows.filter(x => x.spec.kind === 'trap')[0]]]) {
    L.push(`### ${title}`);
    L.push('');
    L.push('```json');
    L.push(JSON.stringify(r.res.json, null, 2));
    L.push('```');
    L.push('');
  }
  L.push('## 7. 夹具与复跑');
  L.push('');
  L.push(`夹具目录：\`${FIXTURES}\``);
  L.push('');
  L.push('| 夹具 | 说明 |');
  L.push('|---|---|');
  for (const v of variants) L.push(`| \`TEST-${v.label}.json\` | sequence=${v.sequence}, targetVersion=${v.targetVersion}, ${v.kind === 'trap' ? '沿用旧目录摘要' : '新目录摘要'} |`);
  L.push('');
  L.push('另有几个配套文件（不是清单，别拿去发布）：');
  L.push('');
  L.push('| 文件 | 用途 |');
  L.push('|---|---|');
  L.push('| `TEST-issuer-public.pem` | 由发行私钥现导的公钥（等于现网 pin），矩阵所有行都用它验签 |');
  L.push('| `TEST-tampered-signature.json` | 签名被改一个字符，用来确认签名门单独可辨（第 3 节） |');
  L.push('| `TEST-throwaway-public.pem` | 随机新生成的公钥，用来确认「公钥非 pin」是工具错误而非拒绝（第 3 节） |');
  L.push('| `TEST-archive-ok.bin` / `TEST-archive-wrong.bin` | 64 字节占位包，同尺寸不同摘要（第 1、2 节） |');
  if (realRows.length) L.push('| `simulated-seq21-manifest.json` | 现网真清单改 seq=21 + 换目录摘要后重签，配真实 781MB 包（第 4 节 R2） |');
  L.push('');
  L.push('复跑：`node make-matrix.cjs`（需要发行私钥；夹具与 matrix.md 都会重新生成）。');
  L.push('夹具是**合成**的：`files[]` 里只有 worker/binding/固定入口的声明，archive 是 64 字节占位包。');
  L.push('它们只能证明各道门的判定，不能替代真实 780MB 包的摘要核对——那一步用 README 里的真实命令。');
  L.push('');

  fs.writeFileSync(args.out, L.join('\n'));
  console.log(JSON.stringify({
    ok: true,
    matrix: args.out,
    fixtures: FIXTURES,
    rows: rows.length,
    gridRows: rows.filter(r => r.spec.kind === 'grid').length,
    trapRows: rows.filter(r => r.spec.kind === 'trap').length,
    accepts: rows.filter(r => r.res.exit === 0).length,
    rejects: rows.filter(r => r.res.exit === 2).length
  }, null, 2));
}

try { main(); } catch (e) {
  console.error(JSON.stringify({ ok: false, code: e.code || 'ERROR', message: e.message }, null, 2));
  process.exitCode = 1;
}
